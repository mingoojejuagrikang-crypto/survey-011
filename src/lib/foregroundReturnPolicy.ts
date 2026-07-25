/** 장기 백그라운드 뒤 낡은 오디오 그래프를 정리할 임계. 실기기 계측으로 보정 가능한 정책값이다. */
export const LONG_BACKGROUND_TEARDOWN_MS = 60_000;

export type ForegroundReturnEvent = 'hidden' | 'visible' | 'pageshow';

export interface ForegroundReturnState {
  hiddenAt: number | null;
  /** v0.38.2 F5 — **백그라운드 진입 시점의** 입력 장치 라벨 스냅샷.
   *
   *  🔴 이 스냅샷이 F5의 전부다. 복귀 후에 라벨을 읽어 before/after를 만들면 **둘 다 복귀 후의 같은
   *  읽기**라 항상 동일하고, "백그라운드 중에 경로가 바뀌었다"는 판정이 **발행 시점에 원리적으로
   *  불가능**해진다. 그러면 경과시간 게이트로 조용히 후퇴하고, F5가 메우려던 바로 그 공백
   *  (백그라운드에서는 `devicechange`가 발화하지 않아 BT→스피커 전환이 관측 자체가 안 된다)이
   *  그대로 남는다. */
  hiddenInputLabel: string | null;
}

export interface ForegroundReturnDecision {
  state: ForegroundReturnState;
  backgroundMs: number;
  shouldTeardown: boolean;
  /** 백그라운드 진입 시점의 입력 라벨(복귀 이벤트에서만 의미 있음). 진입 기록이 없으면 null. */
  hiddenInputLabel: string | null;
}

export interface ForegroundReturnOptions {
  /** `hidden` 이벤트에서 기록할 현재 입력 장치 라벨. 복귀 이벤트에서는 무시된다. */
  inputLabel?: string | null;
  thresholdMs?: number;
}

export const INITIAL_FOREGROUND_RETURN_STATE: ForegroundReturnState = {
  hiddenAt: null,
  hiddenInputLabel: null,
};

/**
 * visibility/pageshow 복귀 정책. 시간을 인자로 받아 브라우저·React 없이 경계를 검증할 수 있다.
 * visible/pageshow는 phase와 무관하게 hiddenAt을 소비하므로 연속 이벤트도 teardown을 한 번만 낸다.
 *
 * 입력 라벨도 같은 방식으로 인자로 받는다 — 이 모듈은 브라우저 API를 직접 읽지 않는다.
 */
export function reduceForegroundReturn(
  state: ForegroundReturnState,
  event: ForegroundReturnEvent,
  nowMs: number,
  options: ForegroundReturnOptions = {},
): ForegroundReturnDecision {
  const { inputLabel = null, thresholdMs = LONG_BACKGROUND_TEARDOWN_MS } = options;

  if (event === 'hidden') {
    // 이미 숨김 상태면 첫 진입 시각·라벨을 유지한다(연속 hidden이 스냅샷을 덮지 않게).
    const alreadyHidden = state.hiddenAt !== null;
    return {
      state: {
        hiddenAt: alreadyHidden ? state.hiddenAt : nowMs,
        hiddenInputLabel: alreadyHidden ? state.hiddenInputLabel : inputLabel,
      },
      backgroundMs: 0,
      shouldTeardown: false,
      hiddenInputLabel: null,
    };
  }

  const hiddenAt = state.hiddenAt;
  const backgroundMs = hiddenAt === null ? 0 : Math.max(0, nowMs - hiddenAt);
  return {
    state: { hiddenAt: null, hiddenInputLabel: null },
    backgroundMs,
    shouldTeardown: hiddenAt !== null && backgroundMs >= thresholdMs,
    hiddenInputLabel: hiddenAt === null ? null : state.hiddenInputLabel,
  };
}

/**
 * v0.38.2 F5 — 복귀 시 `audio_route_revalidate`를 **발행할지** 결정한다.
 *
 * 복귀마다 무조건 찍으면 로그 링버퍼를 잠식한다(기존 `mic_track:*`가 `live`/`none`을 무로깅하는 것과
 * 같은 기준). 둘 중 하나일 때만 발행한다:
 *  - **(a) 경로 변경** — 진입 시점 CATEGORY ≠ 복귀 시점 CATEGORY. 이게 F5의 본 목적이다. 백그라운드
 *    에서는 `devicechange`가 발화하지 않아 이 전환이 **다른 어떤 이벤트로도 남지 않는다.**
 *  - **(b) 장기 백그라운드 복귀** — teardown과 같은 임계. 경로가 그대로여도 오디오 세션이 무너진
 *    구간이라 `mic_teardown`과 짝지어 읽을 앵커가 필요하다.
 *
 * 진입 스냅샷이 없으면(앱 첫 로드 직후 pageshow 등) 비교 자체가 성립하지 않으므로 (a)는 성립하지
 * 않는다 — (b)만으로 판단한다.
 */
export function shouldEmitRouteRevalidate(input: {
  beforeCategory: string | null;
  afterCategory: string;
  backgroundMs: number;
  thresholdMs?: number;
}): boolean {
  const { beforeCategory, afterCategory, backgroundMs } = input;
  const thresholdMs = input.thresholdMs ?? LONG_BACKGROUND_TEARDOWN_MS;
  const routeChanged = beforeCategory !== null && beforeCategory !== afterCategory;
  return routeChanged || backgroundMs >= thresholdMs;
}
