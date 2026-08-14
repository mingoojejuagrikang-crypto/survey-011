/** v0.33.0 항목10-C(Vance) — 비프 재생기. 세그먼트 스펙·스케줄(순수)은 beepVariants.ts로 분리.
 *
 *  playBeep(kind) 시그니처는 유지(호출부 useVoiceSession 무수정):
 *   - 'alert'(이상치 알람)     → 부정 극성 → settingsStore.beepNegativeId 변형 재생
 *   - 'corrected'(정정 완료)   → 긍정 극성 → settingsStore.beepPositiveId 변형 재생
 *   - 'modify'(수정 모드 진입) → 중립 고정음(현행 660Hz/150ms) — 극성 선택과 무관하게 불변.
 *     modify는 "성공/실패"가 아닌 "모드 전환" 신호라 극성 팔레트에 편입하지 않는다(현행 보존).
 *  기본 설정(beepPositiveId='pos-rise', beepNegativeId='neg-fall')에서는 소리가 이전과 동일하다.
 */
// v0.46.0 WP-I — settingsStore import는 제거됐다. 재생 파라미터(변형·볼륨)가 전부 고정이라
// 이 모듈은 더 이상 설정을 읽지 않는다. 되살릴 땐 FIXED_* 상수와 함께 이 import를 되돌려라.
import {
  buildBeepSchedule,
  getBeepVariant,
  beepVolumeToMultiplier,
  BEEP_VOLUME_MAX,
  type BeepVariant,
  type ScheduledTone,
} from './beepVariants';
import { logger } from './logger';
import { beepPlay } from './logEvents';

/** v0.46.0 WP-E(F7②) — 'commit' 신설: 값이 저장될 때 울리는 **커밋 확인음**. 긍정 극성이다.
 *  종전엔 정상 커밋에 소리가 아예 없었다(alert·corrected·modify 3종뿐) — 민구 제보 F7②의
 *  "확인음이 없다"가 그것이다. 호출부는 useVoiceSession의 커밋 경로 하나이고, **확인음 →
 *  인식값 TTS** 순서가 계약이다(민구 지정 순서). */
/** 🔴 v0.49 r2 B2(민구 결정 08-13 ⓐ) — 'reject' 신설: **거절 신호**(저신뢰·파싱 실패 재질문).
 *  W2가 재질문 TTS를 사유 두 어절로 줄이면서 코드 주석이 *"재시도 신호는 화면 큐와 부정 비프가
 *  전담한다"* 고 적었는데, **그 부정 비프가 배선된 적이 없었다**(합집합 C2 — 전제가 허구).
 *  화면을 끄고 2~3m 떨어져 쓰는 사용자에게는 그 두 어절이 유일한 신호였다.
 *  🔑 **음원은 신설하지 않는다**(민구 지시) — 'alert'과 같은 부정 극성 변형이다. 그런데도 kind를
 *  가르는 이유는 **로그**다: 같은 이름으로 내보내면 이상치 알람 재생 횟수 집계가 거절 건수와
 *  섞여 조용히 오염된다(A4가 막은 것과 같은 종류의 오염). */
type BeepKind = 'alert' | 'corrected' | 'modify' | 'commit' | 'reject';

/** modify(수정 모드 진입) 중립음 — 현행 값 그대로. */
const MODIFY_TONE: ScheduledTone = {
  startMs: 0, stopMs: 150, freq: 660, endFreq: null, gain: 0.04, wave: 'sine',
};

/** 🔴 v0.46.0 WP-I(민구 지시 08-05) — 소리는 **고정**이다. 고를 수 없다.
 *
 *  민구 지시: *"확인음 = 화음 · 경고음 = 트릴 · 볼륨 100% 고정 · 설정 UI 숨김
 *  (고를 게 없으면 안 보여준다)"*.
 *
 *  🔑 **왜 store가 아니라 여기서 고정하나** — 기본값만 바꾸면 이미 persist된 사용자 값
 *  (민구 기기의 `pos-rise`·`beepVolume:0.5`)이 그대로 남아 앱이 계속 옛 소리를 낸다.
 *  재생 경로에서 고정하면 마이그레이션 없이 즉시 일치한다. store의 beepPositiveId·
 *  beepNegativeId·beepVolume 필드는 **남아 있지만 재생에 쓰이지 않는다**(선택 UI를 되살릴 때
 *  이 세 상수를 지우면 종전 동작으로 돌아온다 — 그것이 되돌리는 방법이다).
 *
 *  ⚠️ 클리핑 검산(BEEP_VOLUME_MAX=12 기준): pos-triad·neg-trill은 **순차 발음**이라 동시 합이
 *  없고 단일 최대 gain 0.045 → 0.045×12 = 0.54 < 1. 안전하다. 동시발음 변형(pos-bell 0.07)을
 *  고정값으로 바꾸려면 이 검산을 다시 해라. */
const FIXED_POSITIVE_ID = 'pos-triad';  // 화음 — 확인음(커밋·정정 완료)
const FIXED_NEGATIVE_ID = 'neg-trill';  // 트릴 — 경고음(이상치 알람)
const FIXED_VOLUME = 1;                 // 100% 고정

/** 마스터 게인 배수 — WP-I로 **100% 고정**. store beepVolume은 더 이상 읽지 않는다. */
function masterMultiplier(): number {
  return beepVolumeToMultiplier(FIXED_VOLUME);
}

let ctx: AudioContext | null = null;

type PlaybackResult = 'played' | 'no_ctx' | 'suspended' | 'silent' | 'empty' | 'error';
type PlaybackContext = 'running' | 'suspended' | 'interrupted' | 'closed' | 'none';

interface PlaybackOutcome {
  result: PlaybackResult;
  ctx: PlaybackContext;
  gain: number;
  tones: number;
}

function contextState(): PlaybackContext {
  return ctx?.state ?? 'none';
}

function logBeep(kind: BeepKind, outcome: PlaybackOutcome): void {
  try {
    logger.log({ type: 'app', extra: beepPlay({ kind, ...outcome }) });
  } catch {
    // Telemetry is best-effort and must never delay or block audio feedback.
  }
}

function getCtx(): AudioContext | null {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  ctx ??= new AudioCtx();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/**
 * 🔴 v0.46.1 WP-1(민구 실기기 08-07) — **사용자 제스처의 동기 구간에서** 오디오 출력을 연다.
 *
 * ## 왜 필요한가 — 실측 근거
 *
 * 08-07 실기기 로그(`sess_1786066154598`)에서 **세션 초반 2분간 TTS와 비프가 함께 죽어 있었다**:
 * ```
 * 10:29:14 session start
 * 10:29:14 wake_lock:acquire,result=failed,reason=NotAllowedError   ← 사용자 활성화 없음
 * 10:29:24 [tts] onstart 미도착 → 10초 워치독 (이후 11건 연속)
 * 10:29:39 beep_play:result=suspended,ctx=suspended
 * ```
 * 근인은 `useVoiceSession.start()`가 **`await recorderRef.init()`(gUM) + 1초 정착 뒤에야**
 * `warmupTts()`를 부른 것이다. **`await` 뒤는 사용자 제스처 콜스택이 아니다** — iOS는 그 시점의
 * `AudioContext.resume()`·`speechSynthesis.speak()`를 무시하거나 무음으로 만든다.
 * 같은 이유로 wake lock도 `NotAllowedError`를 냈다(그것이 이 진단의 결정적 증거였다).
 *
 * 🔑 **일시정지 → 재시작이라는 새 제스처로 셋 다 즉시 회복됐다**(10:31:16 `delay=345`).
 * 사용자가 *"편법 사용하면 가능한지 판단중"* 이라고 쓴 것이 이것이다.
 *
 * ## 계약
 * - **동기다.** `await`를 넣지 마라 — 넣는 순간 이 함수의 존재 이유가 사라진다.
 * - 멱등하다. 이미 `running`이면 아무것도 하지 않는다.
 * - 실패해도 절대 던지지 않는다(세션 시작을 막으면 안 된다).
 * - 반환값은 **호출 시점의 상태**다. 계측에 실어 다음 로그에서 판정한다.
 */
export function unlockAudioPlayback(): PlaybackContext {
  try {
    const c = getCtx();          // 생성 + suspended면 resume — 둘 다 제스처 안에서 일어난다
    return c?.state ?? 'none';
  } catch {
    return 'none';
  }
}

/** 절대 스케줄을 WebAudio로 재생(세그먼트별 osc+gain → 마스터 gain → destination). 항상 non-fatal.
 *  v0.35.0 FB-D — 마스터 GainNode에 볼륨 배수를 setValueAtTime으로 건다(0도 안전 — 세그먼트 gain의
 *  exponentialRamp는 그대로 두고 마스터에서만 스케일). `mult`를 넘기면 그 값(미리듣기 라이브 반영),
 *  없으면 store에서 읽는다.
 *
 *  v0.35.0 FIX-1(리뷰 라운드1, Vance) — 마스터 해제는 **실시간 setTimeout이 아니라 각 oscillator의
 *  `onended` 카운팅**으로 한다. ctx가 suspended면 `ctx.currentTime`은 멈춰 있는데 setTimeout은 실시간
 *  이라, resume 지연 시 소리가 나기 전에 disconnect돼 첫 비프가 잘리거나 묵음이 됐고(백그라운드에서
 *  타이머 스로틀 시 노드 누수), onended는 실제 재생 종료에 동기화돼 그 레이스를 없앤다. */
function playSchedule(tones: ScheduledTone[], mult: number = masterMultiplier()): PlaybackOutcome {
  let appliedGain = 0;
  let scheduledTones = 0;
  try {
    const c = getCtx();
    appliedGain = Math.min(Math.max(0, mult), BEEP_VOLUME_MAX);
    if (!c) return { result: 'no_ctx', ctx: 'none', gain: appliedGain, tones: 0 };
    const initialState = c.state;
    const now = c.currentTime;
    const master = c.createGain();
    // v0.35.0 R2-FIX-6(리뷰 라운드2, Pro) — 상한도 클램프. 종전엔 하한(Math.max(0,·))만 있어, 호출부가
    //   손상된 배수를 넘기면 클리핑/폭주 음량이 날 수 있었다. beepVolumeToMultiplier가 이미 [0,MAX]로
    //   매핑하지만, 재생기 자체에서도 최종 방어선을 둔다(defense in depth).
    master.gain.setValueAtTime(appliedGain, now);
    master.connect(c.destination);
    let pending = tones.length;
    if (pending === 0) {
      try { master.disconnect(); } catch { /* no-op */ }
      return { result: 'empty', ctx: initialState, gain: appliedGain, tones: 0 };
    }
    for (const tone of tones) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = tone.wave;
      const t0 = now + tone.startMs / 1000;
      const t1 = now + tone.stopMs / 1000;
      osc.frequency.setValueAtTime(tone.freq, t0);
      if (tone.endFreq != null) {
        osc.frequency.exponentialRampToValueAtTime(tone.endFreq, t1);
      }
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(tone.gain, t0 + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t1 + 0.03);
      scheduledTones += 1;
      osc.onended = () => {
        try { osc.disconnect(); gain.disconnect(); } catch { /* no-op */ }
        // 마지막 oscillator가 끝난 뒤에만 마스터 해제(재생 종료에 동기 — setTimeout 레이스 제거).
        if (--pending === 0) { try { master.disconnect(); } catch { /* no-op */ } }
      };
    }
    const result: PlaybackResult = initialState === 'suspended' || initialState === 'interrupted'
      ? 'suspended'
      : appliedGain === 0
        ? 'silent'
        : 'played';
    return { result, ctx: initialState, gain: appliedGain, tones: scheduledTones };
  } catch {
    // Audio feedback is non-critical; never block the voice flow.
    return { result: 'error', ctx: contextState(), gain: appliedGain, tones: scheduledTones };
  }
}

export function playBeep(kind: BeepKind): void {
  let outcome: PlaybackOutcome;
  try {
    if (kind === 'modify') {
      // modify는 "성공/실패"가 아닌 "모드 전환" 신호라 극성 팔레트 밖의 중립음이다(현행 보존).
      outcome = playSchedule([MODIFY_TONE]);
    } else {
      // 🔴 v0.46.0 WP-I — store가 아니라 고정 상수를 쓴다(위 FIXED_* 주석의 근거).
      //    'commit'(WP-E 신설)·'corrected'는 긍정 = 화음, 'alert'·'reject'(r2 B2)는 부정 = 트릴.
      const variant = kind === 'alert' || kind === 'reject'
        ? getBeepVariant(FIXED_NEGATIVE_ID, 'negative')
        : getBeepVariant(FIXED_POSITIVE_ID, 'positive');
      outcome = playSchedule(buildBeepSchedule(variant));
    }
  } catch {
    // 설정 조회 실패 등도 음성 흐름을 막지 않는다.
    outcome = { result: 'error', ctx: contextState(), gain: 0, tones: 0 };
  }
  logBeep(kind, outcome);
}

/** 설정탭 칩 미리듣기 — 선택 여부와 무관하게 해당 변형을 즉시 재생.
 *  v0.35.0 FB-D — `volume`(0~1)을 넘기면 그 값으로 즉시 재생(볼륨 슬라이더 라이브 미리듣기). 없으면
 *  현재 store 볼륨. */
export function previewBeep(variant: BeepVariant, volume?: number): void {
  const mult = volume == null ? undefined : beepVolumeToMultiplier(volume);
  playSchedule(buildBeepSchedule(variant), mult);
}
