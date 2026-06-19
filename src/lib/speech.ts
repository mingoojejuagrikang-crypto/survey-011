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
  /** v0.11.0 post-TTS 가드: TTS가 끝난(unmuteForTts) 시각(ms). 스피커폰 모드에서 onend 직후
   *  스피커 잔향/리버브가 마이크로 새어 들어와 가짜 final로 수락되는 빈틈을 닫기 위해,
   *  useVoiceSession이 종료 후 짧은 가드 윈도우 동안 입력을 추가로 차단한다. 0 = TTS 종료 이력 없음. */
  private ttsEndedAt = 0;

  constructor(cb: SpeechCallbacks) {
    this.cb = cb;
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
    }
  }

  /** Called when TTS utterance ends — STT was never aborted so no restart needed.
   *  즉시 unmute는 유지(이어폰 barge-in 경로 불변). 종료 시각만 찍어 post-TTS 가드의 기준점으로 쓴다. */
  unmuteForTts() {
    this.ttsMuted = false;
    this.ttsEndedAt = Date.now();
  }

  /** True while TTS is actively playing — used by handleFinal to filter value inputs. */
  isTtsMuted(): boolean {
    return this.ttsMuted;
  }

  /** v0.11.0 post-TTS 가드: 마지막 TTS 종료(unmuteForTts) 이후 경과 ms. 종료 이력이 없으면(0)
   *  매우 큰 값을 반환해 가드가 절대 걸리지 않게 한다. */
  msSinceTtsEnd(): number {
    if (this.ttsEndedAt === 0) return Number.POSITIVE_INFINITY;
    return Date.now() - this.ttsEndedAt;
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
    try {
      this.rec.start();
    } catch (e) {
      // recognition already started — schedule restart
      this.scheduleRestart();
    }
  }

  stop() {
    this.active = false;
    this.ttsMuted = false;
    this.ttsEndedAt = 0;
    if (this.restartingTimer !== null) {
      window.clearTimeout(this.restartingTimer);
      this.restartingTimer = null;
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
      const e = raw as SREvent;
      const r = e.results[e.results.length - 1];
      const final = r.isFinal;
      const text = (r[0]?.transcript || '').trim();
      const confidence = r[0]?.confidence ?? 1;
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
      const err = (e as unknown as { error?: string }).error || 'unknown';
      this.cb.onError?.(err);
    };
    const onStart = () => this.cb.onStart?.();
    const onEnd = () => {
      this.cb.onEnd?.();
      if (this.active) this.scheduleRestart();
    };

    rec.addEventListener('result', onResult);
    rec.addEventListener('error', onError);
    rec.addEventListener('start', onStart);
    rec.addEventListener('end', onEnd);
  }

  private scheduleRestart(delay = 100) {
    // v5.2: STT must keep running during TTS so command keywords still work.
    // ttsMuted is no longer a guard here — handleFinal filters non-command results during TTS.
    if (this.restartingTimer !== null) return;
    this.restartingTimer = window.setTimeout(() => {
      this.restartingTimer = null;
      if (!this.active) return;
      try {
        this.rec = createRecognition();
        if (this.rec) {
          this.bind();
          this.rec.start();
        }
      } catch { /* try again next tick */ }
    }, delay);
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
    logger.log({ type: 'app', extra: `tts_voices_loaded:total=${total},ko=${ko}` });
  }
  // v0.6.0 (Pax iOS research): per-device diagnostic of WHICH voices the OS actually exposes to
  // the web (iOS hides Enhanced/Premium/Siri/Personal Voice — only isSystemVoice surfaces). Record
  // the full name/lang/localService list once per distinct snapshot to analyze device patterns.
  // Hash-gated so a stable list logs only once (no aggressive-repoll spam).
  const hash = voicesCache.map((v) => `${v.name}|${v.lang}|${v.localService ? 1 : 0}`).join(';;');
  if (hash !== _lastVoicesSnapshotHash) {
    _lastVoicesSnapshotHash = hash;
    const list = voicesCache.map((v) => `${v.name}~${v.lang}~${v.localService ? 'L' : 'R'}`).join(', ');
    logger.log({ type: 'app', extra: `tts_voices_snapshot:total=${total},ko=${ko}`, text: list });
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
