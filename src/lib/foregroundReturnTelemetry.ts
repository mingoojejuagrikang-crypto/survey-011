import {
  foregroundReturn,
  type ForegroundReturnTeardown,
  type ForegroundReturnTeardownResult,
} from './logEvents';

export interface ForegroundReturnRecorder {
  teardownAudioGraph: (evt: string, backgroundMs: number) => Promise<ForegroundReturnTeardownResult>;
}

/**
 * 실제 hidden 사이클의 첫 복귀 1건을 정직한 최종 상태로 요약한다.
 *
 * `foreground_return`은 복귀/처리 여부만 말하고, close·reattach 상세는 기존 `mic_teardown`이
 * 정본이다. 같은 사실을 두 이벤트에서 조립하면 어느 쪽이 정본인지 갈라지므로 합치지 않는다.
 */
export async function resolveForegroundReturnEvent(input: {
  hadHiddenCycle: boolean;
  shouldTeardown: boolean;
  backgroundMs: number;
  evt: 'vis' | 'pageshow';
  recorder: ForegroundReturnRecorder | null;
}): Promise<string | null> {
  if (!input.hadHiddenCycle) return null;

  let teardown: ForegroundReturnTeardown;
  if (!input.shouldTeardown) {
    teardown = 'skipped';
  } else if (!input.recorder) {
    teardown = 'no_recorder';
  } else {
    try {
      teardown = await input.recorder.teardownAudioGraph(input.evt, input.backgroundMs);
    } catch {
      teardown = 'failed';
    }
  }

  return foregroundReturn({
    backgroundMs: input.backgroundMs,
    teardown,
    evt: input.evt,
  });
}
