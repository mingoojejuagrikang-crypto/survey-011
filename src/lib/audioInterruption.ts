/** v0.46.0 **P1 — 오디오 인터럽션 관측 프로브** (민구 지시 2026-08-06).
 *
 *  ## 민구 제보
 *  > *"외부에서 전화오거나 다른앱 알람으로 음성 입/출력 쪽으로 사용되면 survey-011-preview
 *  > 앱에서 음성 입출력을 정상적으로 사용 할수가 없어."*
 *
 *  ## 🔴 이건 새 결함이 아니라 `[MIC-B2]`의 **포그라운드 변종**이다
 *  기존 방어는 전부 **백그라운드 복귀** 축이다(`foregroundReturnPolicy` — `visibilitychange`/
 *  `pageshow`에 걸려 있다). 그런데 **타앱 알람은 배너만 띄우고 앱은 계속 `visible`이다** —
 *  오디오만 뺏기고 화면은 그대로다. 👉 **기존 정리 로직이 한 줄도 안 돈다.**
 *
 *  ## 🔴🔴 이 파일은 **관측만 한다. 복구를 하지 않는다.**
 *  그게 P1의 정의이자 안전성이다. 지금까지 이 사건은 **로그에 아무 흔적도 남기지 않았고**,
 *  그래서 P2~P5(감지 후 복구·reload 폴백) 설계가 **전부 추측**이다. 계측 없이 복구를 짜면
 *  v0.44.1에서 겪은 *"고쳤는데 안 고쳐진 것처럼 보이는"* 오판을 그대로 반복한다.
 *  **먼저 실기기 로그로 「iOS가 실제로 어떤 신호를 어떤 순서로 내는가」를 확정한다.**
 *
 *  ## ⚠️ `audioSession.type`을 **설정하지 않는다**
 *  `navigator.audioSession.type = 'play-and-record'`를 선언하면 iOS가 오디오 세션을 다르게
 *  다룬다(라우팅·인터럽션 정책이 바뀐다). **관측 프로브가 관측 대상을 바꾸면 안 된다.**
 *  타입 선언은 P2 이후, 실기기 로그로 현재 거동을 확정한 뒤에 판단한다.
 *
 *  ## 왜 `navigator.audioSession`인가
 *  W3C **Audio Session** 표준(Editor's Draft). 2025-11 기준 **Safari만 구현**했는데,
 *  우리 대상 기기가 iOS 하나라 그게 약점이 아니다. 사양이 `'active' | 'interrupted' | 'inactive'`
 *  전이를 **직접** 통지한다 — 전화·Siri·타앱 알람이 세션을 회수하는 바로 그 순간이다.
 *  ⚠️ 미지원 브라우저(데스크톱 Chromium 등)에서는 조용히 no-op이고, 그 사실 자체를
 *  `supported=no`로 1회 남긴다 — **「안 찍힌 것」과 「지원 안 되는 것」을 구분하기 위해서다**
 *  (`[MIC-B2]`가 `mic_teardown` 0건에서 겪은 곤란이 정확히 이것이다).
 *
 *  ## 짝이 되는 기존 계측
 *  - `beep_play`의 `ctx=interrupted` — 재생 **시도 시점**의 상태(사후). 이 프로브는 **전이 순간**.
 *  - `bg_enter_snapshot` / `foreground_return` — 백그라운드 축. 이 프로브는 포그라운드 축.
 *  - STT `error:<name>` — `speech.ts`가 이미 남긴다. 인터럽션 때 어떤 err가 오는지 대조하면
 *    `[STT-18]` 좀비 자격 조건(`audio-capture`만)을 넓혀야 하는지 판정된다.
 */
import { logger } from './logger';
import { kv } from './logEvents';

/** WebKit이 노출하는 AudioSession. 표준 타입에 아직 없어 구조적으로 좁힌다. */
type AudioSessionLike = {
  state?: string;
  type?: string;
  addEventListener?: (t: string, cb: () => void) => void;
  removeEventListener?: (t: string, cb: () => void) => void;
};

function getAudioSession(): AudioSessionLike | null {
  const nav = navigator as Navigator & { audioSession?: AudioSessionLike };
  return nav.audioSession ?? null;
}

/** 지금 화면이 보이는가 — **인터럽션의 성격을 가르는 축**이다.
 *  `vis=visible`인 인터럽션 = 알람 배너 등 **포그라운드 회수**(기존 방어 사정권 **밖**).
 *  `vis=hidden`인 인터럽션 = 전화 수신 등으로 앱이 내려간 경우(기존 백그라운드 축과 겹친다). */
function visNow(): 'visible' | 'hidden' {
  return document.visibilityState === 'hidden' ? 'hidden' : 'visible';
}

/**
 * 오디오 세션 상태 전이를 로그로만 남긴다. 반환값은 해제 함수(앱 수명 내내 유지하므로
 * 실사용에서는 호출되지 않지만, 테스트가 격리할 수 있게 돌려준다).
 *
 * 남기는 이벤트:
 *   `audio_session:supported=yes|no,state=<s>,type=<t>[,stateReadable=yes|no]` — 부팅 1회
 *   `audio_interrupt:state=<s>,prev=<p>,vis=<v>,ms=<경과>` — **값이 실제로 바뀐** 전이마다
 *   `audio_session_evt:n=<누적>,vis=<v>,ms=<직전 발화로부터>` — **발화 자체마다**(v0.50 r2)
 *
 * `ms`는 **직전 전이로부터의 경과**다. 인터럽션이 얼마나 지속됐는지(= 복구 시도가 의미를
 * 가질 창인지)를 로그만으로 재게 한다 — `interrupted → active`의 `ms`가 그 답이다.
 */
/** v0.50 r2 [갈래 B] — `statechange` **발화 누적 횟수**(앱 수명). 값이 아니라 **횟수**다.
 *
 *  🔴 **왜 이게 필요한가 — 우리는 신호를 받고 있었는데 스스로 버렸다.**
 *  `rmic` 리서치(WebKit `safari-7624.4.5-branch` 소스 직접 대조): iOS 26.6에서
 *  `state`·`onstatechange`는 `DOMAudioSessionFullEnabled`(testable/false)로 **미노출**이지만
 *  **`statechange` 이벤트 자체는 발화한다.** 그런데 이 프로브의 `if (state === prev) return`
 *  dedupe는 `session.state`가 `undefined`라 **prev도 `'unknown'`으로 고정** — 모든 발화가 같은
 *  값으로 접혀 사라졌다. 그래서 08-06~08-19 누적 로그에 `audio_interrupt`가 **0건**이었고,
 *  조사는 그것을 「이벤트가 안 온다」로 잘못 읽었다.
 *
 *  🔴 **관측 전용이다. 이 신호로 복구를 발화시키지 마라**(v0.46.0 P1 규율 그대로) —
 *  재생 시작/종료마다도 올 수 있어 비특이적일 가능성이 크다. */
let audioSessionEventCount = 0;

/** 앱 수명 누적 발화 수. `clip_duration` meta·`clip_summary`가 함께 실어, **클립과 클립 사이**에
 *  일어난 전이도 다음 클립에서 드러나게 한다(리서치 ⓓ' — 「녹음 중일 때만」으로 좁히면 놓친다). */
export function getAudioSessionEventCount(): number {
  return audioSessionEventCount;
}

/** 테스트 전용 — 스펙 간 누적이 새지 않게 한다(제품 경로에서는 호출하지 않는다). */
export function __resetAudioSessionEventCountForTest(): void {
  audioSessionEventCount = 0;
}

/** 발화 폭주 완화 — 같은 초 안의 연속 발화는 로그를 남기지 않는다(카운터는 계속 센다).
 *  WebKit이 C++에서 이미 전이만 남기므로(`scheduleStateChangeEvent`가 같은 상태를 버린다 @26.6)
 *  실제로는 잦지 않을 것으로 보지만, **로그 링버퍼(2000)를 지키는 상한**을 명시적으로 둔다. */
const EVT_LOG_MIN_GAP_MS = 1000;

export function installAudioInterruptionProbe(): () => void {
  const session = getAudioSession();
  if (!session || typeof session.addEventListener !== 'function') {
    // 🔑 지원 안 됨을 **명시적으로** 남긴다. 이게 없으면 다음 회차가 이벤트 0건을 보고
    //    "인터럽션이 안 일어났다"와 "관측 수단이 없었다"를 구분하지 못한다.
    logger.log({ type: 'app', extra: `audio_session:${kv({ supported: 'no' })}` });
    return () => {};
  }

  let prev = session.state ?? 'unknown';
  let lastAt = Date.now();
  let lastEvtAt = 0;
  let lastEvtLoggedAt = 0;
  logger.log({
    type: 'app',
    // v0.50 r2 [갈래 B] — 🔑 `stateReadable`이 **「값을 못 읽는 것」과 「이벤트가 안 오는 것」을
    //   영구히 분리**한다. 이 한 필드가 없어서 08-19 조사가 두 사실을 섞어 읽었다.
    //   꼬리 확장 근거(PRINCIPLES §4): 실소비 파서 전수 grep 0건 — producer 1곳, 테스트는
    //   접두 매칭(`logsStartingWith('audio_session:')`), 나머지는 산출물 문서 언급뿐이다.
    extra: `audio_session:${kv({
      supported: 'yes',
      state: prev,
      type: session.type ?? 'unset',
      stateReadable: 'state' in session ? 'yes' : 'no',
    })}`,
  });

  const onChange = () => {
    const now = Date.now();
    const state = session.state ?? 'unknown';
    // 🔴 v0.50 r2 [갈래 B] — **발화 자체를 먼저 센다.** dedupe보다 앞이다.
    //   `state`가 미노출인 기기(우리 iOS 26.6)에서는 아래 dedupe가 항상 참이라 여기서 세지
    //   않으면 **신호가 통째로 사라진다** — 그게 08-06~08-19의 공백이었다.
    audioSessionEventCount += 1;
    const sinceEvt = lastEvtAt === 0 ? 0 : now - lastEvtAt;
    lastEvtAt = now;
    if (now - lastEvtLoggedAt >= EVT_LOG_MIN_GAP_MS) {
      lastEvtLoggedAt = now;
      logger.log({
        type: 'app',
        extra: `audio_session_evt:${kv({ n: audioSessionEventCount, vis: visNow(), ms: sinceEvt })}`,
      });
    }
    // 같은 값의 중복 통지는 버린다(전이만 센다) — 그래야 `ms`가 「그 상태로 머문 시간」이 된다.
    // ⚠️ 이 줄은 **`state`를 읽을 수 있는 기기에서만** 의미가 있다. 못 읽는 기기에서는 항상
    //    참이 되어 `audio_interrupt`가 영영 안 나간다 — 위 `audio_session_evt`가 그 공백을 메운다.
    if (state === prev) return;
    logger.log({
      type: 'app',
      extra: `audio_interrupt:${kv({ state, prev, vis: visNow(), ms: now - lastAt })}`,
    });
    prev = state;
    lastAt = now;
  };

  session.addEventListener('statechange', onChange);
  return () => {
    session.removeEventListener?.('statechange', onChange);
  };
}
