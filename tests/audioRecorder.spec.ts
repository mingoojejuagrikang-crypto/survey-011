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
