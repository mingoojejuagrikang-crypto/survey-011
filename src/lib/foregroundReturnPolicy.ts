/** 장기 백그라운드 뒤 낡은 오디오 그래프를 정리할 임계. 실기기 계측으로 보정 가능한 정책값이다. */
export const LONG_BACKGROUND_TEARDOWN_MS = 60_000;

export type ForegroundReturnEvent = 'hidden' | 'visible' | 'pageshow';

export interface ForegroundReturnState {
  hiddenAt: number | null;
}

export interface ForegroundReturnDecision {
  state: ForegroundReturnState;
  backgroundMs: number;
  shouldTeardown: boolean;
}

export const INITIAL_FOREGROUND_RETURN_STATE: ForegroundReturnState = { hiddenAt: null };

/**
 * visibility/pageshow 복귀 정책. 시간을 인자로 받아 브라우저·React 없이 경계를 검증할 수 있다.
 * visible/pageshow는 phase와 무관하게 hiddenAt을 소비하므로 연속 이벤트도 teardown을 한 번만 낸다.
 */
export function reduceForegroundReturn(
  state: ForegroundReturnState,
  event: ForegroundReturnEvent,
  nowMs: number,
  thresholdMs = LONG_BACKGROUND_TEARDOWN_MS,
): ForegroundReturnDecision {
  if (event === 'hidden') {
    return {
      state: { hiddenAt: state.hiddenAt ?? nowMs },
      backgroundMs: 0,
      shouldTeardown: false,
    };
  }

  const hiddenAt = state.hiddenAt;
  const backgroundMs = hiddenAt === null ? 0 : Math.max(0, nowMs - hiddenAt);
  return {
    state: { hiddenAt: null },
    backgroundMs,
    shouldTeardown: hiddenAt !== null && backgroundMs >= thresholdMs,
  };
}
