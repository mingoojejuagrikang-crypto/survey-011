/**
 * v0.22.0 P0 — AudioRecorder.isStreamLost() 단위 검증 (pastValues.spec.ts 패턴:
 * 브라우저 의존부 getUserMedia/AudioContext는 건드리지 않고, 순수 판정 로직만 Node에서 검증).
 *
 * 배경(2026-06-25 실기기 로그 근인): iOS Safari가 제스처 밖 getUserMedia를 NotAllowedError로
 * 거부하므로, 빈 클립마다 자동 recoverStream을 부르면 살아있던 스트림까지 죽이며 폭주했다
 * (clip_empty×41). v0.22.0은 스트림이 **실제로 죽었는지**(isStreamLost)를 보고 micLost로 래치 →
 * 자동 재시도를 멈추고 사용자 제스처(reconnectMic)로만 복구한다. isStreamLost의 정확성이 그
 * 게이트의 토대라 직접 검증한다.
 *
 * isStreamLost() 계약:
 *  - 스트림 null → true (죽음)
 *  - 오디오 트랙 0개 → true
 *  - 트랙 readyState 'ended' → true
 *  - 트랙 readyState 'live' → false (멀쩡 — 자동복구 불필요, 다음 클립이 자가 치유)
 */
import { test, expect } from '@playwright/test';
import { AudioRecorder } from '../src/lib/audioRecorder';

/** 최소 MediaStream stub — isStreamLost는 getAudioTracks()[0].readyState만 본다. */
function fakeStream(tracks: Array<{ readyState: 'live' | 'ended' }>): MediaStream {
  return {
    getAudioTracks: () => tracks,
  } as unknown as MediaStream;
}

/** private `stream` 필드를 주입(테스트 전용). init()은 getUserMedia를 호출하므로 Node에서 못 돈다. */
function withStream(rec: AudioRecorder, stream: MediaStream | null): AudioRecorder {
  (rec as unknown as { stream: MediaStream | null }).stream = stream;
  return rec;
}

test.describe('AudioRecorder.isStreamLost() — micLost 게이트 판정', () => {
  test('스트림 null → lost(true)', () => {
    const rec = withStream(new AudioRecorder(), null);
    expect(rec.isStreamLost()).toBe(true);
  });

  test('오디오 트랙 0개 → lost(true)', () => {
    const rec = withStream(new AudioRecorder(), fakeStream([]));
    expect(rec.isStreamLost()).toBe(true);
  });

  test("트랙 readyState 'ended' → lost(true)", () => {
    const rec = withStream(new AudioRecorder(), fakeStream([{ readyState: 'ended' }]));
    expect(rec.isStreamLost()).toBe(true);
  });

  test("트랙 readyState 'live' → 멀쩡(false): 자동복구 불필요, 다음 클립이 자가 치유", () => {
    const rec = withStream(new AudioRecorder(), fakeStream([{ readyState: 'live' }]));
    expect(rec.isStreamLost()).toBe(false);
  });

  test('첫 오디오 트랙만 본다: live 트랙이 첫째면 ended 트랙이 뒤에 있어도 멀쩡', () => {
    const rec = withStream(
      new AudioRecorder(),
      fakeStream([{ readyState: 'live' }, { readyState: 'ended' }]),
    );
    expect(rec.isStreamLost()).toBe(false);
  });
});

/**
 * v0.38.0 [CLIP-R1] — 재획득 쿨다운이 **첫 회복**을 막지 않는지 결정론적으로 고정.
 *
 * 근인: 쿨다운 비교값이 `performance.now()`(페이지 로드 후 경과 ms)인데 `lastRecoverAt`이 0이면
 * 로드 직후 3초 동안 `now - 0 < 3000`이 성립해 **모든 recoverStream이 조용히 차단**된다.
 * #5 자동 재연결은 사고 시점에 즉시 발화하므로 이 구간에 걸리면 getUserMedia를 부르지도 못한 채
 * 1회 가드만 소진한다.
 *
 * 이 테스트가 필요한 이유: 같은 결함의 통합 회귀(v034-wave-glow B8)는 **격리 실행에서만** 실패하고
 * 병렬 전체 실행에서는 부하 지연으로 3초가 지나가 통과한다. 즉 통합 테스트만으로는 재발을 못 잡는다.
 * 여기서는 시계에 의존하지 않고 초기값 자체를 검증한다.
 */
test('[CLIP-R1] 새로 만든 레코더의 첫 recoverStream은 쿨다운에 걸리지 않는다', () => {
  const rec = new AudioRecorder();
  const lastRecoverAt = (rec as unknown as { lastRecoverAt: number }).lastRecoverAt;

  // performance.now()가 0에 가까운 시점(페이지 로드 직후)에도 쿨다운 창 밖이어야 한다.
  expect(lastRecoverAt).toBeLessThanOrEqual(-3000);
  expect(performance.now() - lastRecoverAt).toBeGreaterThanOrEqual(3000);
});

/**
 * v0.38.0 리뷰#1(Codex Medium) — 자동 복구가 즉시 실패해 쿨다운이 남은 상태에서, 사용자가 배너를
 * **바로 한 번 탭하면** 실제 재획득이 시도돼야 한다. 쿨다운은 자동 폭주를 막는 장치지 사용자
 * 제스처를 삼키는 장치가 아니다(iOS에선 제스처가 getUserMedia를 허용하는 유일한 창이라 더 중요).
 * 통합 테스트는 3.5초를 기다린 뒤 클릭해 이 경계를 가린다 — 여기서 시계 비의존으로 고정한다.
 */
test('[리뷰#1] 자동 시도 직후 쿨다운이 남아도 사용자 제스처 복구는 차단되지 않는다', async () => {
  const rec = new AudioRecorder();
  const priv = rec as unknown as { lastRecoverAt: number; recovering: boolean };
  let calls = 0;
  (rec as unknown as { acquireStream: () => Promise<MediaStream> }).acquireStream = async () => {
    calls++;
    return fakeStream([{ readyState: 'live' }]);
  };

  // 자동 시도가 방금 일어난 상태(쿨다운 창 한복판)를 만든다.
  priv.lastRecoverAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  expect(await rec.recoverStream('auto')).toBe(false);      // 자동 경로는 종전대로 쿨다운 준수
  expect(calls).toBe(0);

  expect(await rec.recoverStream('user_gesture', { bypassCooldown: true })).toBe(true);
  expect(calls).toBe(1);                                    // 제스처는 첫 탭에 실제로 시도된다
});
