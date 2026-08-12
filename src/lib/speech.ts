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
import { kv, zombieRestart } from './logEvents';

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
  /** §5-1 ② — confidence는 엔진이 interim에 점수를 준 경우에만 실린다(대개 미보고 → undefined).
   *  빈 final barge-in의 폴백(stt_barge_in text/confidence 채움)이 유일한 소비자다. */
  onInterim?: (text: string, confidence?: number) => void;
  onError?: (kind: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

/** 좀비(started-but-silent) 인식기 판정 임계값(ms). recRunning=true인데 onresult가 이 시간을
 *  넘게 0건이면, iOS 자연 무음→end 순환을 넘겨 recRunning=true로 고착된 좀비로 본다(실기기 로그
 *  FB#3: audio-capture 후 fresh 인스턴스가 start까지 성공했으나 57초간 onresult 0건 → 영구 사망).
 *  ⚠️ device-gated: 소스에서 도출 불가, 다음 실기기 로그로 튜닝. watchdog interval(4000ms)의 3배 =
 *  정상 iOS 무음→end 주기(수 초)를 확실히 초과하는 보수적 시작값(순진한 stale-only는 정상 무음
 *  중 인식기를 들쑤신다 — 임계값이 자연 순환 주기보다 커야 오발동을 막는다).
 *  [STT-18] 이 값은 백오프(연속 좀비 시 ×2, cap)의 **기본값**이며, 판정 자체는 에러 이력 있는
 *  무결과 인스턴스에만 적용된다(restartIfZombie 참조 — 에러 없는 건강한 장기 무음은 면제). */
const DEFAULT_ZOMBIE_STALE_MS = 12_000;

/** [STT-18] 좀비 백오프 상한(ms). 연속 좀비 재시작(결과 0건 반복)마다 유효 임계가 ×2로 커지되
 *  (12→24→48s) 이 값을 넘지 않는다 — 에러 직후 진짜 무음 대기가 길어질 때 12초마다 인식기를
 *  들쑤시는 잔여 churn 방지와 "영영 안 되살림" 사이의 절충. onresult가 오면 기본값으로 리셋. */
const ZOMBIE_BACKOFF_CAP_MS = 60_000;

// ── v0.44.0 §D1 — barge-in(말끊기) 설정, 모듈 레벨 플래그 ──────────────────────
// settingsStore를 여기서 import하지 않는다: postTtsGuard/speech-lifecycle 스펙이 이 모듈을
// Node에서 직접 import하는데, 스토어는 import 시점에 persist 하이드레이션(localStorage/IDB)을
// 돌려 Node에서 깨진다. 대신 preferredVoiceName과 같은 setter 패턴 — 변경 지점(입력탭 서랍
// 토글·세션 시작·설정 초기화)이 setBargeInEnabled로 동기화한다. 기본 true(이어폰 barge-in).
let _bargeInEnabled = true;
export function setBargeInEnabled(v: boolean) { _bargeInEnabled = v; }

/** A long-running recognition controller that auto-restarts. */
export class SpeechController {
  private rec: SpeechRecognitionLike | null = null;
  private cb: SpeechCallbacks;
  private active = false;
  private restartingTimer: number | null = null;
  /** True while TTS is speaking — prevents STT restart to avoid echo feedback */
  private ttsMuted = false;
  /** TTS mute가 시작된 시각. stale liveness에서 **mute 구간만** 제외하기 위한 앵커다. */
  private ttsMutedAt: number | null = null;
  /** P0(영구 인식사멸): muteForTts가 대기 중 재시작 타이머를 취소하면 true — TTS 종료
   *  (unmuteForTts) 시 반드시 재예약해야 한다. 이 플래그가 없던 시절, iOS가 TTS 재생 중
   *  인식기를 죽이면(end→100ms 타이머) 그 타이머를 mute가 취소한 채 아무도 되살리지 않아
   *  세션 끝까지 STT 무음이었다(실기기 로그: "이전" 재진입 TTS 연발 → 5분 STT 0건). */
  private restartPendingAfterTts = false;
  /** v0.44.0 §D1 — half-duplex 래치. barge-in OFF 상태에서 muteForTts가 세우고 unmuteForTts/
   *  stop이 내린다. 서 있는 동안: ① 인식기를 abort(물리 중지 — 스피커폰 에코의 마이크 되먹임
   *  차단), ② abort 경합으로 새어든 결과를 onResult에서 폐기(논리 차단), ③ onEnd의 재시작
   *  예약을 restartPendingAfterTts로 미룬다(unmuteForTts의 기존 P0 재예약 경로에 합류 — 새
   *  복구 경로를 만들지 않는다). 🔴 이 래치는 **TTS 스코프 전용**이며 useVoiceSession의 UI
   *  서스펜드 래치(uiSuspendRef — suspendRecognitionForUi/resumeRecognitionForUi)와 완전히
   *  독립이다: 그 래치는 모달 수명, 이것은 utterance 수명을 산다(R3-FIX-1 계열 회귀 방지).
   *  mute 시점 설정값을 캡처하므로 재생 중 토글 변경은 다음 TTS부터 적용된다(결정론). */
  private halfDuplexHold = false;
  /** 인식기 실제 가동 여부: 'start' 이벤트에 true, 'end'에 false. ('error' 후엔 스펙상
   *  항상 'end'가 따라오므로 error에선 건드리지 않는다.) watchdog의 좀비 판정 근거. */
  private recRunning = false;
  /** 마지막 rec.start() 시도 시각(ms). watchdog이 "시도 후 응답 없음" 판정에 쓴다. */
  private lastStartAttemptAt = 0;
  /** 마지막 liveness 시각(ms): onStart(가동 시작) + onresult(interim 포함) 시 갱신. watchdog의
   *  좀비 판정 근거(recRunning=true인데 이 값이 zombieStaleMs 넘게 정체 = started-but-silent). */
  private lastResultAt = 0;
  /** [STT-18] 현 인스턴스가 onresult(interim 포함)를 한 건이라도 냈는가. onStart에서 false 리셋.
   *  lastResultAt의 onStart 앵커는 유예용 타임스탬프일 뿐이므로, "앵커"와 "실제 결과"를 구분하는
   *  것이 이 필드의 목적 — 좀비 판정은 실제 결과 0건인 인스턴스만 대상으로 한다. */
  private hadResultSinceStart = false;
  /** [STT-18] 마지막 onresult 이후 `audio-capture` 에러가 있었는가. 실기기 사망 사례의 확인된
   *  시그니처만 좀비 자격으로 쓴다. no-speech/aborted/권한 오류 같은 정상·사용자 유도 이벤트는
   *  fresh 인스턴스까지 자격을 운반하지 않는다. 에러 이력이 전혀 없는 건강한
   *  인식기의 장기 무음(Web Speech 명세는 continuous 무음 중 end 발생을 보장하지 않는다)을
   *  좀비로 오판해 abort→재시작 churn(경계 발화 절단 위험)을 만들지 않기 위한 판별자.
   *  onStart에서 리셋하지 않는다 — 진짜 좀비가 재시작 후에도 무결과면 이 플래그가 유지되어
   *  재시도 루프가 계속된다(백오프로 간격만 늘어남). */
  private erroredSinceLastResult = false;
  /** [STT-18] 결과 없이 반복된 연속 좀비 재시작 횟수 — 유효 임계 백오프(×2, cap)의 지수.
   *  onresult에서 0으로 리셋. 텔레메트리에 n=<count>로 동봉된다. */
  private zombieRestartStreak = 0;
  /** 재시작 지연(ms). 기본 base에서 시작, start() throw마다 ×2(상한 5000), 'start' 성공 시 리셋. */
  private restartDelayMs: number;
  private readonly baseRestartDelayMs: number;
  private readonly watchdogIntervalMs: number;
  private readonly zombieStaleMs: number;
  private watchdogTimer: number | null = null;
  /** lifecycle 텔레메트리 스로틀 상태 (kind별 마지막 기록 시각 + 억제 카운트). */
  private lifecycleLastLoggedAt: Record<string, number> = {};
  private lifecycleSuppressed: Record<string, number> = {};

  constructor(cb: SpeechCallbacks, opts?: { restartDelayMs?: number; watchdogIntervalMs?: number; zombieStaleMs?: number }) {
    this.cb = cb;
    this.baseRestartDelayMs = opts?.restartDelayMs ?? 100;
    this.restartDelayMs = this.baseRestartDelayMs;
    this.watchdogIntervalMs = opts?.watchdogIntervalMs ?? 4000;
    this.zombieStaleMs = opts?.zombieStaleMs ?? DEFAULT_ZOMBIE_STALE_MS;
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
    if (!this.ttsMuted) this.ttsMutedAt = Date.now();
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
    // v0.44.0 §D1 — barge-in OFF면 half-duplex: TTS 재생 동안 인식기를 물리적으로 내린다.
    // 스피커폰에서 echoCancellation ON으로도 못 막은 TTS 에코 되먹임(08-02 실측: stt_barge_in
    // 167건 전부 TTS 재생창 안, 45셀에 771발화)의 처방. abort의 'end'는 onEnd가 받아
    // restartPendingAfterTts로 미루고, unmuteForTts가 기존 P0 경로로 fresh 재시작한다.
    if (!_bargeInEnabled && this.active) {
      this.halfDuplexHold = true;
      this.logLifecycle('half_duplex_stt_stop', true);
      try { this.rec?.abort(); } catch { /* ignore — 미기동 인스턴스 abort는 무해 */ }
    }
  }

  /** Called when TTS utterance ends — STT was never aborted so no restart needed.
   *  즉시 unmute는 유지(이어폰 barge-in 경로 불변). */
  unmuteForTts() {
    const now = Date.now();
    // [STT-18] liveness 이력을 unmute 시점으로 덮지 않고, watchdog이 보지 못한 TTS mute **구간만**
    // stale에서 뺀다. 반복 TTS가 이미 누적된 실제 무응답 시간을 매번 0으로 만들면 좀비 복구를
    // 무기한 미룰 수 있다. mute 중 결과가 왔다면 그 결과 이후 남은 mute 구간만 제외한다.
    if (this.ttsMutedAt !== null && this.lastResultAt > 0) {
      const excludedFrom = Math.max(this.ttsMutedAt, this.lastResultAt);
      this.lastResultAt += Math.max(0, now - excludedFrom);
    }
    this.ttsMutedAt = null;
    this.ttsMuted = false;
    // v0.44.0 §D1 — half-duplex 래치 해제. 이 아래의 기존 P0 재예약이 abort됐던 인식기를
    // fresh로 되살린다(onEnd가 hold 동안 restartPendingAfterTts를 세워 뒀다).
    this.halfDuplexHold = false;
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

  /** 계측 H — 현재 인식기 인스턴스가 실제 start 이벤트를 받은 상태인지 읽는다. */
  getRecognitionState(): 'idle' | 'listening' {
    return this.active && this.recRunning ? 'listening' : 'idle';
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
    this.ttsMutedAt = null;
    this.halfDuplexHold = false; // §D1 — 세션 경계에서 half-duplex 래치도 리셋(오차단 방지)
    this.restartPendingAfterTts = false;
    this.recRunning = false;
    this.hadResultSinceStart = false;
    this.erroredSinceLastResult = false;
    this.zombieRestartStreak = 0;
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
      // v0.44.0 §D1 — half-duplex(말끊기 OFF) 동안의 결과는 **여기서 폐기**한다(논리 차단).
      // abort는 비동기라 in-flight 결과가 새어들 수 있고, 그 한 건이면 TTS 에코 오커밋이
      // 재발한다. 텔레메트리(raw_confidence)·liveness·barge-in 컷·onFinal 전부 도달 전 컷 —
      // 커밋/파싱 경로 0건이 §D1의 오라클이다(v0440-d1-bargein T2).
      if (this.halfDuplexHold) {
        this.logLifecycle('result_dropped_half_duplex');
        return;
      }
      // 좀비 감지용 liveness 갱신 — interim 포함(가장 이르고 잦은 liveness 증거; final-only는
      // 지연됨). watchdog이 recRunning=true인데 이 값이 오래 정체되면 좀비로 판정한다.
      this.lastResultAt = Date.now();
      // [STT-18] 실제 결과 1건 = 인식기 건강 증명: 에러 이력·좀비 streak을 모두 해제한다.
      this.hadResultSinceStart = true;
      this.erroredSinceLastResult = false;
      this.zombieRestartStreak = 0;
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
      // §5-1 ② — interim에도 엔진 원시 confidence를 실어 보낸다(미보고면 undefined — `?? 1`
      // 보정값을 흘리면 "엔진이 안 준 것"이 1.0으로 둔갑한다). 빈 final barge-in의 폴백 근거.
      else this.cb.onInterim?.(text, confAbsent ? undefined : rawConf);
    };
    const onError = (e: Event) => {
      if (this.rec !== rec) return;
      const err = (e as unknown as { error?: string }).error || 'unknown';
      // [STT-18] 확인된 사망 시그니처(audio-capture)만 좀비 자격을 연다. no-speech/aborted/
      // permission 계열은 정상 무음·앱 abort·사용자 조치 오류라 stale 재시작 근거가 아니다.
      this.erroredSinceLastResult = err === 'audio-capture';
      this.logLifecycle(`error:${err}`, true);
      this.cb.onError?.(err);
    };
    const onStart = () => {
      if (this.rec !== rec) return;
      this.recRunning = true;
      // recRunning=true가 되는 순간을 liveness 기준점으로 앵커링한다 — 갓 시작해 아직 결과가
      // 없는 정상 무음 인식기를 좀비로 오판(lastResultAt=0 → 즉시 stale)하지 않도록.
      this.lastResultAt = Date.now();
      // [STT-18] 새 인스턴스 수명 시작: 아직 실제 결과 0건. (erroredSinceLastResult는 의도적으로
      // 유지 — 에러→재시작으로 태어난 인스턴스가 무결과면 좀비 재시도 루프가 이어져야 한다.)
      this.hadResultSinceStart = false;
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
      if (this.active) {
        // v0.44.0 §D1 — half-duplex 동안(muteForTts의 abort 포함)은 즉시 재시작하지 않고
        // 기존 P0 플래그에 합류한다: unmuteForTts가 TTS 종료 시 재예약한다. 여기서 그냥
        // scheduleRestart하면 TTS 재생 중 인식기가 되살아나 half-duplex가 무의미해진다.
        if (this.halfDuplexHold) {
          this.restartPendingAfterTts = true;
          this.logLifecycle('restart_deferred_half_duplex', true);
        } else {
          this.scheduleRestart();
        }
      }
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
    const now = Date.now();
    // recRunning=true지만 결과가 안 오는 좀비면 restartIfZombie가 처리, 아니면 정상 가동 → no-op.
    if (this.recRunning) { this.restartIfZombie(now); return; }
    if (now - this.lastStartAttemptAt <= this.watchdogIntervalMs) return; // 시도 직후 유예
    this.logLifecycle('watchdog_restart', true);
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.attemptStart();
  }

  /** [STT-18] 백오프 반영 유효 좀비 임계(ms): 연속 좀비 재시작(zombieRestartStreak)마다 ×2
   *  (12→24→48s), ZOMBIE_BACKOFF_CAP_MS 상한. onresult가 오면 streak 리셋으로 기본값 복귀. */
  private effectiveZombieStaleMs(): number {
    return Math.min(this.zombieStaleMs * 2 ** this.zombieRestartStreak, ZOMBIE_BACKOFF_CAP_MS);
  }

  /** 좀비(started-but-silent) 감지 공통 로직 (watchdog + kick SSOT). [STT-18] 정밀화(r1 3모델
   *  공통 지적): 좀비 = "에러 후 재시작으로 태어난 인스턴스(erroredSinceLastResult)가 실제 결과
   *  0건(!hadResultSinceStart)으로 유효 임계(백오프 반영)를 초과". Web Speech 명세는 continuous
   *  무음 중 end 발생을 보장하지 않으므로, 에러 이력 없는 건강한 장기 무음은 stale이 아무리
   *  커도 절대 발동하지 않는다(abort→재시작 churn의 경계 발화 절단 방지). 감지 시 abort 후
   *  fresh 재시작하고 true 반환. 재시작 직후 gap(새 인스턴스 onStart 미도착 + recRunning=true·
   *  옛 앵커 잔존)에서의 오판 방지용 lastStartAttemptAt 유예는 유지. */
  private restartIfZombie(now: number): boolean {
    if (!this.recRunning) return false;
    if (!this.erroredSinceLastResult || this.hadResultSinceStart) return false;
    const threshold = this.effectiveZombieStaleMs();
    const stale = now - this.lastResultAt;
    if (stale <= threshold) return false;
    if (now - this.lastStartAttemptAt <= threshold) return false;
    this.zombieRestartStreak++;
    logger.log({ type: 'stt', extra: zombieRestart(stale, this.zombieRestartStreak) });
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.attemptStart();
    return true;
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
    const now = Date.now();
    // recRunning=true여도 좀비면 재시작(포그라운드 복귀가 죽은 좀비를 즉시 되살림), 아니면 running.
    if (this.recRunning) return this.restartIfZombie(now) ? 'restarted' : 'running';
    if (now - this.lastStartAttemptAt <= this.watchdogIntervalMs) return 'recent_attempt';
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

/** 2단(종료 감시) 워치독 상한 — **`onstart` 시각 기준**. `onend`/`onerror`가 끝내 안 오는
 *  경우의 무한 hang만 막는 안전망이고, 정상 재생을 자르는 것은 임무가 아니다.
 *
 *  🔑 근거(08-12 실기기, iOS 26.6, rate 1.05, 정상 종료 143건의 재생시간 = `durationMs - startDelayMs`):
 *  글자수 구간별 p50이 **1-4자 458ms · 5-9자 750 · 10-14자 1062 · 15-19자 1639 · 20-24자 2168 ·
 *  25-29자 2341** 로 거의 선형이다 → **절편 ≈ 400ms + 75ms/글자**.
 *  여기에 **3배 + 1초**를 얹는다. 3배인 이유: 재생시간은 글자수만의 함수가 아니다 —
 *  숫자·기호가 음절로 펼쳐진다(`-78%` 4자 → "마이너스 칠십팔 퍼센트"). 실측에서 같은 12자
 *  `범위 알람 : -78%`의 재생이 2.2초여서 회귀 추정(1.3초)의 1.7배였다. 오탐이 곧 「문장이
 *  중간에 끊긴다」이므로 여유를 크게 잡는다.
 *  `rate`는 사용자 설정(`ttsRate`)이라 실측 기준 1.05로 정규화한다 — 느리게 설정하면 그만큼 길어진다.
 *  ⚠️ 20초 clamp는 안전망의 안전망이다. 이 값에 도달했다는 것은 엔진이 죽었다는 뜻이고,
 *     그때는 `tts_watchdog_fired:...,stage=end`가 로그에 남는다. */
function ttsEndWatchdogMs(textLen: number, rate: number): number {
  const estPlayMs = 400 + 75 * textLen;
  const budget = (estPlayMs * 3 + 1_000) * (1.05 / Math.max(0.1, rate));
  return Math.min(20_000, Math.max(2_500, budget));
}

/** 🔴 v0.49 fix49 — 아직 종결되지 않은 `speak()` 인스턴스들의 `done` 핸들.
 *
 *  `cancelTts()`가 이걸 드레인한다. **왜 필요한가**(실측 근거):
 *  엔진이 `cancel()`에 `onend`를 안 쏘면(iOS Safari 알려진 버그 — :626-627이 50ms로 완화 중)
 *  잘린 발화의 **2단 워치독이 그대로 살아남는다.** 그 다음 안내가 재생되는 도중 그 워치독이
 *  만료되면 `done()`이 `unmuteForTts()`를 불러 **재생 중인 TTS가 STT로 새는 창**이 열린다
 *  (= 물림·자기입력). 실측: A 발화(12자, 2단 상한 ~5.1s) → `cancelTts()` → B 발화 재생 중
 *  A의 워치독 만료 → `muted=false`. B는 아직 재생 중이었다.
 *  같은 이유로 `await say(...)` 체인도 워치독까지(최대 20초) 매달렸다(실측 4.9초/12자).
 *
 *  드레인은 **새 동작이 아니다** — 정상 브라우저에서 `cancel()`은 `onend`를 쏘므로 `done()`이
 *  어차피 그 시점에 돈다. iOS 버그 케이스를 정상 경로와 같게 맞추는 것이다.
 *  `epoch`·큐 계약은 건드리지 않는다(큐는 `synth.cancel()`이 이미 비웠고, epoch는
 *  useVoiceSession 소유다).
 *
 *  🔴 v0.49 fix49b(max 리뷰 #1·#11) — 이 집합이 담는 것이 **넓어졌다.** 종전엔 「재생 중인
 *  발화의 done」뿐이었는데, 그 정의로는 두 구멍이 남았다:
 *   ① 드레인이 `cancelTts()` 안에만 있었다 — 그런데 엔진을 자르는 곳은 거기만이 아니다.
 *      `speak({interrupt:true})`가 매 호출 `engine.cancel()`을 부르고 `say()`의 기본값이
 *      그것이다. **주 발화 경로 전체**가 드레인 없이 엔진을 잘랐다.
 *   ② `interrupt:true`의 50ms 대기 창(:642)에 있는 발화는 아직 아무 데도 등록돼 있지 않아
 *      **취소도 드레인도 안 됐다** — 「취소됐다」고 답한 뒤 50ms 후에 유령처럼 말을 시작했다.
 *  그래서 지금 이 집합은 **「엔진 cancel이 일어나면 종결해야 하는 핸들」**이다 —
 *  재생 중인 발화의 `done`과, 아직 말하지 않았지만 곧 말할 발화의 `abort`가 함께 산다.
 *  ⚠️ 새 발화 경로를 추가하면 **이 집합에 등록부터 하라.** 두 구멍 다 「등록되지 않은 발화」였다. */
const _pendingSpeakDone = new Set<() => void>();

/** 엔진 cancel 지점의 공통 계약 — 잘린 발화들을 종결한다(위 선언부 주석의 근거).
 *  정상 브라우저에서 `cancel()`은 `onend`를 쏘므로 `done()`이 어차피 도는 경로다 —
 *  `onend`를 삼키는 엔진(iOS Safari)을 정상 경로와 같게 맞추는 것이지 새 동작이 아니다. */
function drainPendingSpeakDone(): void {
  if (_pendingSpeakDone.size === 0) return;
  for (const done of [..._pendingSpeakDone]) done();
  _pendingSpeakDone.clear();
}

/** 🔴 v0.49 fix49b(max 리뷰 #5) — **큐에서 차례를 기다리는 발화의 시작 워치독 무장자들.**
 *
 *  1단 워치독(2.5초)은 「엔진이 발화를 시작조차 못 했다」를 잡는 FB-3 방어선인데, 종전엔
 *  **enqueue 시점**에 걸렸다. `interrupt:false`로 큐잉된 발화는 앞 발화가 재생되는 동안
 *  당연히 시작하지 못하므로, 앞 발화가 2.5초보다 길면(P-1이 정확히 그것을 허용했다)
 *  뒤 발화의 워치독이 **앞 발화 재생 도중** 터졌다: `done()` → `unmuteForTts()` →
 *  재생 중인 TTS가 살아 있는 인식기로 샌다. 게다가 그 뒤 실제로 `onstart`가 와도
 *  `if (settled) return`이 재-뮤트를 막아 **그 발화는 통째로 언뮤트 상태로 재생된다.**
 *  (부수 피해: 그런 만료가 전부 `tts_watchdog_fired:started=no`로 찍혀 FB-3 텔레메트리에
 *   평범한 큐 대기가 섞인다.)
 *
 *  🔑 앵커를 「내 앞의 발화가 끝나는 시점」으로 옮긴다. **FB-3 경로는 문자 그대로 불변이다** —
 *  in-flight가 없으면(=첫 발화) 종전처럼 **지금 즉시** 무장한다. 2.5초 상수도 안 건드린다.
 *  삽입 순서가 곧 큐 순서다(JS `Set`은 삽입 순서를 보장한다) — `done()`이 자기 다음 하나만
 *  깨운다. */
const _pendingStartArm = new Set<() => void>();

/** 🔴 v0.49 P-1 — 모듈 상수 `synth`(:518 부근)는 **import 시점**에 굳는다. 테스트 하네스의
 *  `window` shim은 구조적으로 import보다 늦으므로(같은 워커에서 다른 spec이 먼저 import하면
 *  끝이다), **TTS 발화 경로 전체가 오라클을 가질 수 없는 상태**였다 — speak()의 워치독을
 *  지키는 스펙이 한 개도 없었고, 그 눈먼 축에서 P-1이 고친 결함(2.5초 상시 절단)이 살아남았다.
 *  호출 시점에 한 번 더 읽는다. 실제 브라우저에선 같은 객체를 얻으므로 동작 변화가 없다.
 *
 *  🔴 v0.49 fix49b(max 리뷰 #10) — **발화 수명주기 함수는 전부 이걸 쓴다**(`speak`·`cancelTts`·
 *  `resumeTtsEngine`). P-1은 `speak()`만 고쳐서, 같은 파일 안에서 발화는 되는데 취소는 안 되는
 *  비대칭을 남겼다(`cancelTts` 참조). 새 함수를 추가할 때 `synth`를 직접 읽지 마라.
 *
 *  ⚠️ **의도적 예외 2곳**(고칠 때 이 문단부터 읽어라):
 *   · `warmupTts()` — `synth.speak()` 호출이 **동기여야** 제스처 컨텍스트 계약(`f6de49c`)이
 *     산다. 지금 형태가 그 계약을 눈으로 확인하기 쉬운 모양이라 남겼다(리뷰 범위 밖이기도 하다).
 *     바꾸려면 동기성이 유지되는지부터 증명하라 — 깨지면 iOS에서 **첫 발화가 통째로 안 난다.**
 *   · `refreshVoices`/`onvoiceschanged`(:534·:556) — 음성 목록은 발화 수명주기가 아니고,
 *     `synth`가 null이면 애초에 등록할 이벤트도 없다. */
function getEngine(): SpeechSynthesis | null {
  return synth ?? (typeof window !== 'undefined' ? window.speechSynthesis ?? null : null);
}

/** Speak text. Returns a Promise that resolves when finished. */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  const engine = getEngine();
  if (!engine) return;
  /** 50ms 창에서 `cancelTts()`(또는 다른 interrupt)가 이 발화를 무산시켰는가(#11). */
  let abortedBeforeSpeak = false;
  if (opts.interrupt) {
    engine.cancel();
    // 🔴 v0.49 fix49b(#1) — 엔진을 자르는 **모든** 지점의 계약이다(선언부 주석). 여기서
    //   드레인하지 않으면 잘린 발화의 2단 워치독이 살아남아 아래 새 발화 재생 도중 만료된다.
    drainPendingSpeakDone();
    // iOS Safari: cancel() 직후 speak()하면 onend 미발생 버그 완화
    // 🔴 v0.49 fix49b(#11) — 이 창 동안에도 **취소 가능해야 한다.** 등록을 sleep 뒤로 미루면
    //   그 사이의 `cancelTts()`는 이 발화를 찾지 못하고, 취소가 성공했다고 답한 뒤에 유령
    //   발화가 살아나 사용자가 방금 취소한 값을 되읽으며 STT를 다시 뮤트한다.
    const abort = () => { abortedBeforeSpeak = true; };
    _pendingSpeakDone.add(abort);
    await new Promise((r) => setTimeout(r, 50));
    _pendingSpeakDone.delete(abort);
    // 취소됐다 — 말하지 않고 끝낸다. ⚠️ 여기서 unmute하지 않는다: 이 발화는 아직
    //   `muteForTts()`를 걸지 않았고, 뮤트 소유권은 `cancelTts()`의 게이트가 이미 처리했다.
    if (abortedBeforeSpeak) return;
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
    let started = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    /** 지금 무장된 워치독이 「시작 감시」인가 「종료 감시」인가. 로그로 두 갈래를 가른다. */
    let stage: 'start' | 'end' = 'start';
    /** 워치독이 실제로 대신 resolve했는가. 늦게 도착한 end/error를 계측할지 판정한다. */
    let watchdogFired = false;
    /** 1단(시작 감시) 무장 — 「내 차례가 왔다」 시점에 불린다(#5 선언부 주석). */
    const armStartWatchdog = () => {
      if (settled || started) return;
      _pendingStartArm.delete(armStartWatchdog);
      stage = 'start';
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(fireWatchdog, TTS_START_WATCHDOG_MS);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      _pendingSpeakDone.delete(done);
      _pendingStartArm.delete(armStartWatchdog);
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      // 🔴 v0.49 fix49b(#5) — 내가 끝났으니 **큐의 바로 다음 하나**가 이제 시작을 기다릴
      //   차례다. 전부 깨우면 큐 3번째까지 같이 무장해 원래 결함이 그대로 재현된다.
      const next = _pendingStartArm.values().next();
      if (!next.done) next.value();
      _activeController?.unmuteForTts();
      resolve();
    };
    // 🔴 v0.49 fix49 — `cancelTts()`가 드레인할 수 있도록 등록한다(선언부 주석 참조).
    //   ⚠️ 크기 판정(아래 1단 무장)은 **등록 전** 값을 써야 한다 — 자기 자신을 앞 발화로 세면
    //   첫 발화조차 영영 무장되지 않는다(FB-3 방어선 전체가 죽는다).
    const inFlightBefore = _pendingSpeakDone.size;
    _pendingSpeakDone.add(done);

    const fireWatchdog = () => {
      // 🔑 `onstart`조차 못 받았는가 = 「엔진이 발화를 시작도 못 했다」. 그냥 늦은 것과 다르다.
      //    `started=`는 형식을 유지한다 — Larry 판독 파이프와 과거 로그 대조가 이 키를 읽는다.
      //    `stage=`가 1단(시작 감시)/2단(종료 감시)을 가르는 새 축이다.
      try {
        logger.log({ type: 'app', extra: `tts_watchdog_fired:started=${started ? 'yes' : 'no'},ms=${Date.now() - enqueuedAt},stage=${stage},len=${text.length}` });
      } catch { /* 계측은 best-effort — 절대 발화 경로를 막지 않는다 */ }
      watchdogFired = true;
      done();
    };

    /** 🔴 v0.49 P-1 — **워치독이 판정한 뒤 도착한 종료 이벤트를 기록한다.**
     *
     *  종전엔 `done()`의 `settled` 가드가 이걸 조용히 삼켰다. 그래서 08-12 실기기 로그로는
     *  **「onend가 늦게 온다」와 「끝내 안 온다」를 구조적으로 가릴 수 없었다** — 워치독이
     *  2.5초에 관측을 잘라버리므로 그 뒤에 무슨 일이 있었는지 아무 기록이 없다.
     *  이 한 줄이 다음 실기기 회차에서 그 UNCLEAR를 한 번에 판정한다. */
    const finish = (reason: 'end' | 'error') => {
      if (settled) {
        if (watchdogFired) {
          try {
            logger.log({ type: 'app', extra: `tts_late_end:reason=${reason},afterMs=${Date.now() - enqueuedAt},stage=${stage}` });
          } catch { /* 계측은 best-effort */ }
        }
        return;
      }
      done();
    };

    u.onstart = () => {
      if (settled) return;
      started = true;
      // 시작이 확인됐으니 대기열 무장자에서 뺀다(#5) — 앞 발화의 done()이 뒤늦게 깨우면
      //   이미 2단으로 넘어간 발화를 1단으로 되돌린다.
      _pendingStartArm.delete(armStartWatchdog);
      opts.onStart?.(Date.now() - enqueuedAt);
      // 🔑 **앵커 이동** — 시작이 확인됐으므로 「시작 감시」를 풀고 「종료 감시」로 갈아 무장한다.
      //    기준 시각도 enqueue가 아니라 **지금(onstart)** 이다. 아래 상수 주석의 근거 참조.
      if (watchdog) clearTimeout(watchdog);
      stage = 'end';
      watchdog = setTimeout(fireWatchdog, ttsEndWatchdogMs(text.length, u.rate));
    };
    u.onend = () => finish('end');
    u.onerror = () => finish('error');

    /** 🔴 v0.46.1 WP-1(민구 실기기 08-07) — **10초에서 2.5초로 줄였다.**
     *
     *  이 워치독은 `onend`/`onerror` 미발생 대비 안전장치인데, 08-07 실기기에서 **발화 자체가
     *  시작되지 못하는**(= `onstart`도 안 오는) 상태가 세션 초반에 11번 연속 일어났다.
     *  `say()`가 `await speak(...)`이고 `speak()`는 `muteForTts()`를 건 채 기다리므로,
     *  **10초 × 11 = 약 110초 동안 앱이 멈추고 STT도 mute 상태였다.**
     *  민구 제보 *"tts 작동안함"*(FB-3)의 실체가 그 마비다.
     *
     *  근본 원인(제스처 밖 오디오 개시)은 `useVoiceSession.start()`의 동기 구간 unlock으로
     *  처방했다. 이 상수는 **그 처방이 실패했을 때의 피해를 1/4로 줄이는 2차 방어**다.
     *  🔑 2.5초인 이유: 정상 발화의 `startDelayMs`는 08-07 실측 **중앙값 ~300ms · 최대 377ms**였다.
     *  2.5초는 그 6배가 넘어 정상 발화를 자를 위험이 없으면서, 마비 구간을 사람이 견딜 만큼 짧게 만든다.
     *  ⚠️ 값을 다시 올리려면 **그 실측 분포부터 다시 재라.**
     *
     *  🔴 v0.49 P-1(민구 실기기 08-12) — **값은 그대로 두고 「감시 대상」을 좁혔다.**
     *  위 근거는 `startDelayMs`(= enqueue→**시작**)를 재고 썼는데, 이 타이머는 `enqueuedAt`에
     *  걸린 채 `onstart` 이후에도 풀리지 않아 실제로는 **「발화 전체 시간 상한 2.5초」로 동작**했다.
     *  그래서 정상 발화가 상시 잘렸다 — 08-12 실측(9.4분, tts 161건):
     *  글자수별 워치독율이 **1-9자 0/95(0%) → 10-19자 1/46 → 20-24자 1/4 → 25-29자 6/9 →
     *  30자+ 7/7(100%)** 로 단조 증가했고, 워치독 15건 **전원의 `startDelayMs`가 정상**
     *  (2~628ms; 전체 p50=106·p90=337 안)이었다. 즉 시작 실패가 아니라 **재생이 아직 안 끝난 것**이다.
     *  → 1단은 그대로 두고, `onstart`에서 2단(아래)으로 **앵커를 옮긴다.** */
    //
    //  🔴 v0.49 fix49b(max 리뷰 #5) — **값은 또 그대로 두고 「언제부터 재는가」를 옮겼다.**
    //  위 P-1 근거는 `startDelayMs`(= 내 차례가 온 뒤 **시작**까지)를 재고 썼는데, 타이머는
    //  enqueue에 걸려 있었다 — `interrupt:false`로 큐잉된 발화에는 **앞 발화의 재생시간이
    //  통째로 포함**된다. P-1이 정상 발화를 2.5초 넘게 재생하도록 허용한 순간, 그 조합이
    //  「큐 대기 = 시작 실패」 오판이 됐다(_pendingStartArm 선언부에 피해 서술).
    //  in-flight가 없으면 **종전과 완전히 동일하게 지금 무장한다** — FB-3 경로 불변.
    const TTS_START_WATCHDOG_MS = 2_500;
    if (inFlightBefore === 0) armStartWatchdog();
    else _pendingStartArm.add(armStartWatchdog);

    // synth.speak → onstart 사이 50~500ms 갭 동안 STT 값이 필터링 안 되는 버그 수정:
    // muteForTts를 onstart가 아닌 synth.speak 직전에 호출
    _activeController?.muteForTts();
    engine.speak(u);
  });
}

/** 진행 중인 TTS를 자른다.
 *
 *  🔴 v0.49 fix49(리뷰 H-2 · Larry 확정 = revc 후보 (c)) — **뮤트를 여기서 직접 푼다.**
 *
 *  종전엔 `synth.cancel()`만 불렀다. 그런데 뮤트를 거는 쪽은 `speak()`이고(engine.speak 직전,
 *  :723) 푸는 쪽은 `done()`이라(`onend`/`onerror` **또는 워치독**), 결과적으로
 *  **「종료 워치독 지속시간 = STT가 죽어 있는 시간의 상한」** 이 된다. v0.49 P-1이 그 상한을
 *  2.5초 고정에서 최대 20초로 넓혔으므로(정상 발화 절단을 막는 옳은 변경이지만),
 *  「`onstart`는 왔는데 `onend`가 끝내 안 오는」 축의 피해가 8배가 됐다.
 *  **앱이 스스로 자른 발화의 뮤트 해제를 엔진 이벤트에 맡길 이유가 없다** — iOS Safari의
 *  「cancel() 직후 onend 미발생」은 이미 알려진 버그이고(:626-627이 50ms로 완화 중),
 *  그 완화가 실패하는 케이스가 정확히 이 축이다.
 *
 *  ⚠️ **순서가 계약이다** — `cancel()`이 오디오를 먼저 죽인 **뒤에** 푼다. 뒤집으면 아직
 *  재생 중인 발화가 STT로 새어 자기입력(물림)이 된다.
 *
 *  ⚠️ **뮤트 중일 때만 푼다.** 이 함수는 명령 핸들러 선두에서 방어적으로 수십 곳에서 불리고
 *  대부분 TTS가 안 나가는 상태다. 무조건 부르면 그 전량에 `halfDuplexHold` 해제와
 *  `scheduleRestart()` 부작용이 붙는다(유령 재시작 + 라이프사이클 로그 빈도 급증).
 *  `ttsMuted`는 `muteForTts`가 동기로 세우므로 판정이 신뢰할 수 있다.
 *
 *  🔴 clamp 20s는 **그대로 둔다**(후보 (a) 미채택) — 내리면 긴 발화에서 워치독이 재생 중
 *  `done()`을 불러 **뮤트만 풀리고 TTS는 계속** = 물림 재개방이다. 20s의 실기기 판정은
 *  P-1이 심은 `tts_late_end` 계측이 다음 로그 수거에서 한다.
 *
 *  ⚠️ interim barge-in 컷(:353)은 이 함수가 아니라 `synth?.cancel()`을 **직접** 부른다 —
 *  그래서 `handleInterim`이 `isTtsMuted() === true`를 읽는 전제(v0.48.1 r3 U1 4절)는 안 깨진다.
 *  건드리려거든 그 4절부터 다시 읽어라.
 *
 *  오라클: tests/v049-fix49-cancel-unmute.spec.ts */
export function cancelTts() {
  // 🔴 v0.49 fix49b(max 리뷰 #10) — `getEngine()`으로 통일. 종전엔 모듈 상수 `synth`를 직접
  //   읽었는데, P-1이 `speak()`만 호출 시점 재평가로 고쳐 **같은 파일 안에서 두 함수가 서로
  //   다른 엔진을 보는** 상태가 됐다: 하네스(shim이 import보다 늦다)에서 speak은 발화하고
  //   cancelTts는 cancel을 통째로 건너뛴 채 드레인·unmute만 했다 — 이 함수 자신의 주석이
  //   「물림 재개방」이라 부르는 **순서 역전 그 자체**이고, 순서를 재는 오라클
  //   (v049-fix49-cancel-unmute ①)이 cancel을 관측하지 못해 false-green이었다.
  //   실제 브라우저에선 같은 객체를 얻으므로 동작 변화가 없다.
  getEngine()?.cancel();
  // 잘린 발화의 워치독·프라미스를 함께 종결한다(`_pendingSpeakDone` 선언부에 실측 근거).
  //   `done()`이 워치독을 clear하고 unmute까지 하므로, 아래 게이트는 「in-flight speak은 없는데
  //   뮤트만 남은」 잔여 상태를 받는다.
  drainPendingSpeakDone();
  if (_activeController?.isTtsMuted()) _activeController.unmuteForTts();
}

/** v0.33.0 항목4 — 포그라운드 복귀 시 TTS 엔진 해동. iOS Safari는 백그라운드 전환 시 synthesis를
 *  paused로 얼려두는 경우가 있어(다음 speak()가 무음으로 씹힘), 복귀 직후 resume()을 불러준다.
 *  paused가 아니면 no-op(무해). */
export function resumeTtsEngine() {
  // #10 — cancelTts와 같은 근거로 호출 시점 재평가(위 주석). 이 함수는 포그라운드 복귀
  //   **직후**에만 불리므로, 굳은 상수가 null이면 해동 자체가 조용히 안 일어났다.
  try { getEngine()?.resume(); } catch { /* ignore — 미지원/모의 환경 */ }
}

/** Pre-warm the TTS engine to reduce first-utterance delay.
 *  Uses a near-silent '0' utterance — stronger iOS cold-start warm than an empty string.
 *
 *  🔴 v0.46.1 WP-1c(민구 지시 08-07) — **결과를 돌려준다.** 종전엔 `void`라 "엔진이 실제로
 *  깨어났는가"를 아무도 알 수 없었다. 08-07 실기기에서 세션 초반 TTS 11건이 `onstart` 미도착으로
 *  죽었는데(회차 SSOT §2), 그 사실을 **시작 화면에서 미리 알 방법이 없었다.**
 *
 *  민구 지시: *"권한 수락하고 **실제 마이크/스피커 입출력이 가능한지 확인**하고, 진행 상황을
 *  바형태로 보여줘서 사용자가 바로 전환되지 않는 화면이 오작동이 아님을 알게 해줘."*
 *
 *  🔑 **`synth.speak()` 호출 자체는 여전히 동기다** — 제스처 컨텍스트 계약(`f6de49c`)이 깨지지
 *  않는다. Promise는 **결과만** 나중에 준다.
 *
 *  - `spoken`   `onstart` 도착 = 엔진이 실제로 발화를 시작했다
 *  - `silent`   `onstart` 없이 끝났거나 타임아웃 = **08-07 무음 시그니처**
 *  - `unsupported` synthesis 자체가 없다 */
export function warmupTts(): Promise<'spoken' | 'silent' | 'unsupported'> {
  if (!synth) return Promise.resolve('unsupported');
  const u = new SpeechSynthesisUtterance('0');
  const v = pickKoreanVoice();
  if (v) try { u.voice = v; } catch { /* ignore — plain-object voice in test/mock env */ }
  u.lang = 'ko-KR';
  u.volume = 0.01;
  u.rate = 1.5;
  return new Promise((resolve) => {
    let started = false;
    let settled = false;
    const done = (r: 'spoken' | 'silent') => { if (settled) return; settled = true; resolve(r); };
    u.onstart = () => { started = true; };
    u.onend = () => done(started ? 'spoken' : 'silent');
    u.onerror = () => done('silent');
    // 워밍업은 짧다(볼륨 0.01·rate 1.5의 '0'). 1.5초면 정상 엔진은 이미 시작했다 —
    // 08-07 실측 `startDelayMs` 중앙값 ~300ms·최대 377ms의 4배다.
    setTimeout(() => done(started ? 'spoken' : 'silent'), 1_500);
    synth.speak(u);
  });
}

/**
 * Format a number for natural TTS reading: '35.1' → '삼십오 점 일' is too robotic;
 * the native synthesis voice handles arabic digits well, so just pass-through.
 */
export function formatForTts(value: string): string {
  return value;
}
