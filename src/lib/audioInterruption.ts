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
 *   `audio_session:supported=yes|no,state=<s>,type=<t>`   — 부팅 1회(지원 여부 판정 분모)
 *   `audio_interrupt:state=<s>,prev=<p>,vis=<v>,ms=<경과>` — 전이마다
 *
 * `ms`는 **직전 전이로부터의 경과**다. 인터럽션이 얼마나 지속됐는지(= 복구 시도가 의미를
 * 가질 창인지)를 로그만으로 재게 한다 — `interrupted → active`의 `ms`가 그 답이다.
 */
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
  logger.log({
    type: 'app',
    extra: `audio_session:${kv({ supported: 'yes', state: prev, type: session.type ?? 'unset' })}`,
  });

  const onChange = () => {
    const now = Date.now();
    const state = session.state ?? 'unknown';
    // 같은 값의 중복 통지는 버린다(전이만 센다) — 그래야 `ms`가 「그 상태로 머문 시간」이 된다.
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
