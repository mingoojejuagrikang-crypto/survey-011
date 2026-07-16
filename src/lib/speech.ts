/* eslint-disable max-lines -- [ENV-12] 기존 초과 파일(GL-006 §5 도입 시점), STT 컨트롤러 — 분리 경계 검토 후 해소. 해소 시 이 주석 제거. */
/**
 * Web Speech API wrapper:
 *  - SpeechRecognition: continuous, interim, ko-KR
 *  - SpeechSynthesis: queue + interrupt + onend
 *
 * Notes:
 *  - Auto-restart on `onend` while active (browsers cut off after silence)
 *  - When TTS speaks, new STT results during TTS still come in (mic is always on)
 *  - On user request to interrupt TTS, we cancel synthesis queue
 */

import { logger } from './logger';
import { kv } from './logEvents';

type SRCtor = new () => SpeechRecognitionLike;

type WindowWithSR = Window & typeof globalThis & {
  SpeechRecognition?: SRCtor;
  webkitSpeechRecognition?: SRCtor;
};

interface SRAlternative {
  transcript: string;
  confidence: number;
}
interface SRResult {
  isFinal: boolean;
  length: number;
  [index: number]: SRAlternative;
}
interface SRResultList {
  length: number;
  [index: number]: SRResult;
}

interface SREvent extends Event {
  resultIndex: number;
  results: SRResultList;
}

export interface SpeechRecognitionLike {
  start: () => void;
  stop: () => void;
  abort: () => void;
  addEventListener: (type: string, cb: (e: Event) => void) => void;
  removeEventListener: (type: string, cb: (e: Event) => void) => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
}

export function isSpeechSupported(): boolean {
  const w = window as WindowWithSR;
  return typeof w.SpeechRecognition !== 'undefined' || typeof w.webkitSpeechRecognition !== 'undefined';
}

export function createRecognition(): SpeechRecognitionLike | null {
  const w = window as WindowWithSR;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  r.lang = 'ko-KR';
  r.maxAlternatives = 3;
  return r;
}

export interface SpeechCallbacks {
  onFinal: (text: string, alts: string[], confidence: number) => void;
  onInterim?: (text: string) => void;
  onError?: (kind: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

/** A long-running recognition controller that auto-restarts. */
export class SpeechController {
  private rec: SpeechRecognitionLike | null = null;
  private cb: SpeechCallbacks;
  private active = false;
  private restartingTimer: number | null = null;
  /** True while TTS is speaking — prevents STT restart to avoid echo feedback */
  private ttsMuted = false;
  /** P0(영구 인식사멸): muteForTts가 대기 중 재시작 타이머를 취소하면 true — TTS 종료
   *  (unmuteForTts) 시 반드시 재예약해야 한다. 이 플래그가 없던 시절, iOS가 TTS 재생 중
   *  인식기를 죽이면(end→100ms 타이머) 그 타이머를 mute가 취소한 채 아무도 되살리지 않아
   *  세션 끝까지 STT 무음이었다(실기기 로그: "이전" 재진입 TTS 연발 → 5분 STT 0건). */
  private restartPendingAfterTts = false;
  /** 인식기 실제 가동 여부: 'start' 이벤트에 true, 'end'에 false. ('error' 후엔 스펙상
   *  항상 'end'가 따라오므로 error에선 건드리지 않는다.) watchdog의 좀비 판정 근거. */
  private recRunning = false;
  /** 마지막 rec.start() 시도 시각(ms). watchdog이 "시도 후 응답 없음" 판정에 쓴다. */
  private lastStartAttemptAt = 0;
  /** 재시작 지연(ms). 기본 base에서 시작, start() throw마다 ×2(상한 5000), 'start' 성공 시 리셋. */
  private restartDelayMs: number;
  private readonly baseRestartDelayMs: number;
  private readonly watchdogIntervalMs: number;
  private watchdogTimer: number | null = null;
  /** lifecycle 텔레메트리 스로틀 상태 (kind별 마지막 기록 시각 + 억제 카운트). */
  private lifecycleLastLoggedAt: Record<string, number> = {};
  private lifecycleSuppressed: Record<string, number> = {};

  constructor(cb: SpeechCallbacks, opts?: { restartDelayMs?: number; watchdogIntervalMs?: number }) {
    this.cb = cb;
    this.baseRestartDelayMs = opts?.restartDelayMs ?? 100;
    this.restartDelayMs = this.baseRestartDelayMs;
    this.watchdogIntervalMs = opts?.watchdogIntervalMs ?? 4000;
  }

  /** 인식기 수명주기 텔레메트리. 사멸 시그니처(항상 기록)와 고빈도 이벤트(10초 스로틀 +
   *  suppressed 카운트 동봉 — 2000엔트리 링버퍼 보호, v0.15.0 stt_early_commit의 전이-시에만
   *  기록 패턴 계보)를 구분한다. row/colId는 의도적으로 붙이지 않는다(clipsManifest의
   *  row+colId 조인을 오염시키지 않기 위해). */
  private logLifecycle(kind: string, always = false) {
    if (always) {
      logger.log({ type: 'stt', extra: `lifecycle:${kind}` });
      return;
    }
    const now = Date.now();
    const last = this.lifecycleLastLoggedAt[kind] ?? 0;
    if (now - last < 10_000) {
      this.lifecycleSuppressed[kind] = (this.lifecycleSuppressed[kind] ?? 0) + 1;
      return;
    }
    const suppressed = this.lifecycleSuppressed[kind] ?? 0;
    this.lifecycleLastLoggedAt[kind] = now;
    this.lifecycleSuppressed[kind] = 0;
    logger.log({
      type: 'stt',
      extra: `lifecycle:${kind}${suppressed > 0 ? `,suppressed=${suppressed}` : ''}`,
    });
  }

  /** Called when TTS utterance starts — marks STT muted but keeps recognition alive
   *  so command keywords (수정/정정/스킵/종료) can still be detected during playback.
   *  handleFinal in useVoiceSession ignores non-command results while synth.speaking=true. */
  muteForTts() {
    this.ttsMuted = true;
    // Cancel any pending STT restart from a previous unmuteForTts()
    if (this.restartingTimer !== null) {
      window.clearTimeout(this.restartingTimer);
      this.restartingTimer = null;
      // P0: 취소한 재시작은 unmuteForTts에서 반드시 재예약한다 — 이 플래그 없이는
      // 인식기 죽음+타이머 취소 조합이 영구 STT 사멸로 이어진다(사멸 시그니처, 항상 기록).
      this.restartPendingAfterTts = true;
      this.logLifecycle('restart_cancelled_by_mute', true);
    }
  }

  /** Called when TTS utterance ends — STT was never aborted so no restart needed.
   *  즉시 unmute는 유지(이어폰 barge-in 경로 불변). */
  unmuteForTts() {
    this.ttsMuted = false;
    // P0: muteForTts가 취소했던 재시작을 여기서 되살린다.
    if (this.active && this.restartPendingAfterTts) {
      this.restartPendingAfterTts = false;
      this.logLifecycle('restart_resched_after_tts', true);
      this.scheduleRestart();
    }
  }

  /** True while TTS is actively playing — used by handleFinal to filter value inputs. */
  isTtsMuted(): boolean {
    return this.ttsMuted;
  }

  start() {
    if (this.active) return;
    this.rec = createRecognition();
    if (!this.rec) {
      this.cb.onError?.('unsupported');
      return;
    }
    this.active = true;
    this.bind();
    this.startWatchdog();
    try {
      this.lastStartAttemptAt = Date.now();
      this.rec.start();
    } catch {
      // recognition already started — schedule restart
      this.scheduleRestart();
    }
  }

  stop() {
    this.active = false;
    this.ttsMuted = false;
    this.restartPendingAfterTts = false;
    this.recRunning = false;
    this.restartDelayMs = this.baseRestartDelayMs;
    if (this.restartingTimer !== null) {
      window.clearTimeout(this.restartingTimer);
      this.restartingTimer = null;
    }
    if (this.watchdogTimer !== null) {
      window.clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.rec = null;
  }

  /** v0.9.0 조기확정(빠른 인식): interim 안정화로 값을 이미 커밋했을 때, 같은 발화에 대해 곧
   *  도착할 브라우저 final을 폐기하기 위해 현재 인식기를 abort한다. abort()는 결과 없이 종료하므로
   *  in-flight 발화의 final이 발생하지 않아 이중 커밋을 막는다. active=true이므로 onEnd 핸들러가
   *  다음 필드용으로 인식기를 자동 재시작한다(scheduleRestart). */
  restartRecognition() {
    if (!this.active) return;
    try { this.rec?.abort(); } catch { /* ignore — onEnd→scheduleRestart가 복구 */ }
  }

  private bind() {
    if (!this.rec) return;
    const rec = this.rec;

    const onResult = (raw: Event) => {
      // stale-instance 가드: 버려진 구 인식기 인스턴스의 늦은 이벤트가 중복 재시작(이중 start)을
      // 예약하지 못하게, 현재 인스턴스가 아니면 무시한다(onError/onStart/onEnd 동일).
      if (this.rec !== rec) return;
      const e = raw as SREvent;
      const r = e.results[e.results.length - 1];
      const final = r.isFinal;
      const text = (r[0]?.transcript || '').trim();
      // v0.20.0 Phase 5 #1 (Pax HIGH) — RAW confidence 가시화. iOS Safari가 confidence를 비우거나
      // 0으로 돌려주면 신뢰도 게이트 전체가 무의미해진다(Pax 우려) → 온디바이스 검증이 필요하다.
      // 여기서 `?? 1` 폴백 **전에** 엔진이 준 원시값을 그대로 로그한다: raw=<숫자> 또는 raw=absent
      // (필드 부재 = "엔진이 점수를 안 줌"). 게이트가 쓰는 보정값(`?? 1`)과 구별해 다음 로그가
      // "엔진이 0.0을 줬다" vs "아무것도 안 줬다"를 정량화하게 한다. **final에만** 기록(게이트가
      // final에서만 판정 + interim 폭주 방지 — 한 발화당 interim 수십 회라 로그 링버퍼를 잠식).
      const rawConf = r[0]?.confidence;
      const confAbsent = typeof rawConf !== 'number' || Number.isNaN(rawConf);
      if (final) {
        logger.log({
          type: 'stt',
          extra: `raw_confidence:${confAbsent ? 'absent' : rawConf}`,
          ...(confAbsent ? {} : { confidence: rawConf }),
          text,
        });
      }
      const confidence = rawConf ?? 1;
      const alts: string[] = [];
      for (let i = 0; i < r.length; i++) alts.push(r[i].transcript.trim());
      // barge-in TTS 컷 (interim 단계). 이어폰(기본): 명령어든 값이든 사용자가 말하기 시작하면
      // (interim 비어있지 않음) 즉시 TTS 중단 → v0.4.5 I2: 값도 final까지 기다리지 않고 즉시 끊는다.
      // 값 커밋은 handleFinal에서. (v0.15.0 A6: 스피커폰 모드 삭제 — interim 컷 억제 분기 제거.)
      if (!final && this.ttsMuted && text.length > 0) {
        synth?.cancel();
      }
      if (final) this.cb.onFinal(text, alts, confidence);
      else this.cb.onInterim?.(text);
    };
    const onError = (e: Event) => {
      if (this.rec !== rec) return;
      const err = (e as unknown as { error?: string }).error || 'unknown';
      this.logLifecycle(`error:${err}`, true);
      this.cb.onError?.(err);
    };
    const onStart = () => {
      if (this.rec !== rec) return;
      this.recRunning = true;
      // 성공적으로 가동됐으니 백오프를 기본값으로 리셋.
      this.restartDelayMs = this.baseRestartDelayMs;
      this.logLifecycle('start');
      this.cb.onStart?.();
    };
    const onEnd = () => {
      if (this.rec !== rec) return;
      // 'error' 후엔 스펙상 항상 'end'가 따라오므로 recRunning은 여기서만 내린다.
      this.recRunning = false;
      this.logLifecycle('end');
      this.cb.onEnd?.();
      if (this.active) this.scheduleRestart();
    };

    rec.addEventListener('result', onResult);
    rec.addEventListener('error', onError);
    rec.addEventListener('start', onStart);
    rec.addEventListener('end', onEnd);
  }

  private scheduleRestart(delay = this.restartDelayMs) {
    // v5.2: STT must keep running during TTS so command keywords still work.
    // ttsMuted is no longer a guard here — handleFinal filters non-command results during TTS.
    if (this.restartingTimer !== null) return;
    this.restartingTimer = window.setTimeout(() => {
      this.restartingTimer = null;
      if (!this.active) return;
      this.attemptStart();
    }, delay);
    this.logLifecycle('restart_scheduled');
  }

  /** 인식기 재생성+start 본체 (scheduleRestart 타이머와 watchdog이 공유).
   *  P0-2: 구 코드는 rec.start() throw를 빈 catch로 삼키고 재시도하지 않아("try again next
   *  tick"이라는 주석과 달리 다음 tick이 없음) 두 번째 영구사멸 경로였다. 실패 시 백오프
   *  (×2, 상한 5000ms)로 **무한** 재예약한다 — 재시도 상한을 두면 사멸 경로가 되살아난다. */
  private attemptStart() {
    try {
      this.rec = createRecognition();
      if (!this.rec) throw new Error('createRecognition failed');
      this.bind();
      this.lastStartAttemptAt = Date.now();
      this.rec.start();
    } catch {
      this.restartDelayMs = Math.min(this.restartDelayMs * 2, 5000);
      this.logLifecycle(`restart_retry:delay=${this.restartDelayMs}`, true);
      this.scheduleRestart(this.restartDelayMs);
    }
  }

  /** 최후 방어선 watchdog: "재시작 예약도, TTS 대기도 없는데 인식기가 죽어 있는" 상태 —
   *  즉 어떤 이벤트도 다시 오지 않아 스스로 복구 불가능한 좀비 — 를 주기적으로 감지해 강제
   *  부활시킨다. 의도적으로 visibilitychange 리스너는 두지 않는다: iOS에서 포그라운드 복귀
   *  시 OS가 죽인 인식기는 다음 tick이 어차피 되살리고, 리스너는 해제 누수 표면만 늘린다. */
  private startWatchdog() {
    if (this.watchdogTimer !== null) return;
    this.watchdogTimer = window.setInterval(() => this.watchdogTick(), this.watchdogIntervalMs);
  }

  private watchdogTick() {
    if (!this.active) return;                    // 세션 꺼짐
    if (this.ttsMuted) return;                   // TTS 재생 중 — unmute 경로가 처리
    if (this.restartingTimer !== null) return;   // 이미 재시작 예약됨
    if (this.restartPendingAfterTts) return;     // unmuteForTts가 재예약할 예정
    if (this.recRunning) return;                 // 정상 가동 중
    if (Date.now() - this.lastStartAttemptAt <= this.watchdogIntervalMs) return; // 시도 직후 유예
    this.logLifecycle('watchdog_restart', true);
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.attemptStart();
  }

  /** v0.33.0 항목4 — 워치독 1회 즉시 실행(외부 트리거). 포그라운드 복귀(visibilitychange/pageshow)
   *  시 useVoiceSession이 호출해, 다음 watchdog tick(최대 4초)을 기다리지 않고 죽은 인식기를 즉시
   *  되살린다. 판정 가드는 watchdogTick과 동일(정상 가동/재시작 예약 중이면 no-op — 복귀마다 맹목
   *  재시작해 churn을 만들지 않는다). 판정 결과를 문자열로 반환해 호출자가 `kick_result:*` 텔레메트리에
   *  싣는다. 재시작이 실제 발생하면 lifecycle:kick_restart(항상 기록 — watchdog_restart 카운트와 분리,
   *  SOP-003의 "watchdog 0이 이상적" 판독을 오염시키지 않기 위해). */
  kick(): string {
    if (!this.active) return 'inactive';
    if (this.ttsMuted) return 'tts_muted';
    if (this.restartingTimer !== null) return 'restart_scheduled';
    if (this.restartPendingAfterTts) return 'pending_after_tts';
    if (this.recRunning) return 'running';
    if (Date.now() - this.lastStartAttemptAt <= this.watchdogIntervalMs) return 'recent_attempt';
    this.logLifecycle('kick_restart', true);
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.attemptStart();
    return 'restarted';
  }
}

// ─── Active controller reference (for TTS mute integration) ───
let _activeController: SpeechController | null = null;
export function setActiveController(ctrl: SpeechController | null) {
  _activeController = ctrl;
}

// ─── TTS ───────────────────────────────────────────────────────
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voicesCache: SpeechSynthesisVoice[] = [];

const isKo = (v: SpeechSynthesisVoice) => v.lang?.toLowerCase().startsWith('ko');

/** v0.5.0 W1: re-pull the synth voice list on demand. iOS Safari populates getVoices()
 *  lazily (often only after a speak/warmup or app foreground), and `voiceschanged` is
 *  unreliable there — so callers (TtsVoiceSelector mount/visibilitychange/새로고침 버튼,
 *  session start()) re-poll explicitly. Logs `tts_voices_loaded {total,ko}` (type:'app',
 *  '__app__' sentinel — W7) only when the counts actually change, so boot + late-arrival
 *  each produce exactly one telemetry event. */
/** Stable hash of the current voice list (name|lang|localService each), so we emit the diagnostic
 *  snapshot exactly once per distinct list rather than on every poll (iOS re-polls aggressively). */
let _lastVoicesSnapshotHash = '';

export function refreshVoices(): { total: number; ko: number } {
  if (!synth) return { total: 0, ko: 0 };
  const prevTotal = voicesCache.length;
  const prevKo = voicesCache.filter(isKo).length;
  voicesCache = synth.getVoices();
  const total = voicesCache.length;
  const ko = voicesCache.filter(isKo).length;
  if (total !== prevTotal || ko !== prevKo) {
    logger.log({ type: 'app', extra: `tts_voices_loaded:${kv({ total, ko })}` });
  }
  // v0.6.0 (Pax iOS research): per-device diagnostic of WHICH voices the OS actually exposes to
  // the web (iOS hides Enhanced/Premium/Siri/Personal Voice — only isSystemVoice surfaces). Record
  // the full name/lang/localService list once per distinct snapshot to analyze device patterns.
  // Hash-gated so a stable list logs only once (no aggressive-repoll spam).
  const hash = voicesCache.map((v) => `${v.name}|${v.lang}|${v.localService ? 1 : 0}`).join(';;');
  if (hash !== _lastVoicesSnapshotHash) {
    _lastVoicesSnapshotHash = hash;
    const list = voicesCache.map((v) => `${v.name}~${v.lang}~${v.localService ? 'L' : 'R'}`).join(', ');
    logger.log({ type: 'app', extra: `tts_voices_snapshot:${kv({ total, ko })}`, text: list });
  }
  return { total, ko };
}

if (synth) {
  refreshVoices();
  synth.onvoiceschanged = refreshVoices;
}

let _preferredVoiceName = '';
export function setPreferredVoiceName(name: string) { _preferredVoiceName = name; }

/** Names iOS exposes for its built-in Korean voice even when lang isn't reported as ko-*.
 *  Used only as a fallback when no isKo voice is present (rare; some iOS builds mislabel lang). */
const KO_VOICE_NAME_RE = /yuna|korean|한국/i;

function pickKoreanVoice(): SpeechSynthesisVoice | null {
  const candidates = voicesCache.filter(isKo);
  if (_preferredVoiceName) {
    const preferred = candidates.find((v) => v.name === _preferredVoiceName);
    if (preferred) return preferred;
  }
  if (candidates[0]) return candidates[0];
  // Fallback: 0 lang-tagged Korean voices. Try a name-matched Korean voice (e.g. Yuna) the OS
  // exposed without a ko-* lang tag; otherwise null → speak() relies on u.lang='ko-KR'.
  const named = voicesCache.find((v) => KO_VOICE_NAME_RE.test(v.name));
  return named || null;
}

/** Returns all available Korean voices. */
export function getKoreanVoices(): SpeechSynthesisVoice[] {
  return voicesCache.filter(isKo);
}

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Cancel any currently-speaking utterance before starting */
  interrupt?: boolean;
  /** Called when the TTS engine actually starts playback. Receives delay in ms from enqueue → start. */
  onStart?: (startDelayMs: number) => void;
}

/** Speak text. Returns a Promise that resolves when finished. */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (!synth) return;
  if (opts.interrupt) {
    synth.cancel();
    // iOS Safari: cancel() 직후 speak()하면 onend 미발생 버그 완화
    await new Promise((r) => setTimeout(r, 50));
  }
  const enqueuedAt = Date.now();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickKoreanVoice();
    if (v) try { u.voice = v; } catch { /* ignore — plain-object voice in test/mock env */ }
    u.lang = 'ko-KR';
    u.rate = opts.rate ?? 1.05;
    u.pitch = opts.pitch ?? 1;
    u.volume = opts.volume ?? 1;

    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      if (settled) return;
      settled = true;
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      _activeController?.unmuteForTts();
      resolve();
    };

    u.onstart = () => {
      if (settled) return;
      opts.onStart?.(Date.now() - enqueuedAt);
    };
    u.onend = done;
    u.onerror = done;

    // iOS Safari 안전장치: onend/onerror 미발생 시 10초 후 강제 resolve
    watchdog = setTimeout(done, 10_000);

    // synth.speak → onstart 사이 50~500ms 갭 동안 STT 값이 필터링 안 되는 버그 수정:
    // muteForTts를 onstart가 아닌 synth.speak 직전에 호출
    _activeController?.muteForTts();
    synth.speak(u);
  });
}

export function cancelTts() {
  if (synth) synth.cancel();
}

/** v0.33.0 항목4 — 포그라운드 복귀 시 TTS 엔진 해동. iOS Safari는 백그라운드 전환 시 synthesis를
 *  paused로 얼려두는 경우가 있어(다음 speak()가 무음으로 씹힘), 복귀 직후 resume()을 불러준다.
 *  paused가 아니면 no-op(무해). */
export function resumeTtsEngine() {
  try { synth?.resume(); } catch { /* ignore — 미지원/모의 환경 */ }
}

/** Pre-warm the TTS engine to reduce first-utterance delay.
 *  Uses a near-silent '0' utterance — stronger iOS cold-start warm than an empty string. */
export function warmupTts() {
  if (!synth) return;
  const u = new SpeechSynthesisUtterance('0');
  const v = pickKoreanVoice();
  if (v) try { u.voice = v; } catch { /* ignore — plain-object voice in test/mock env */ }
  u.lang = 'ko-KR';
  u.volume = 0.01;
  u.rate = 1.5;
  synth.speak(u);
}

/**
 * Format a number for natural TTS reading: '35.1' → '삼십오 점 일' is too robotic;
 * the native synthesis voice handles arabic digits well, so just pass-through.
 */
export function formatForTts(value: string): string {
  return value;
}
