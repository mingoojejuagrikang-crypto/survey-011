/**
 * v0.11.0 post-TTS 가드 — 순수 단위 테스트.
 *
 * 스피커폰(소프트 half-duplex) 모드에서 TTS 안내가 끝난 직후 스피커 잔향이 마이크로 새어
 * 가짜 final(값·명령)로 수락되는 빈틈을 닫는다. 호출자(useVoiceSession.handleFinal)의
 * 상태머신에서 판정만 분리한 evalPostTtsGuard(순수)와, 그 입력을 공급하는 SpeechController의
 * post-TTS 타임스탬프 프리미티브(ttsEndedAt → msSinceTtsEnd)를 클럭/타이머 의존 없이 검증한다.
 *
 * 두 모듈 모두 DOM 의존이 없어(Node에서 window는 undefined, speech.ts는 typeof 가드) 직접
 * import해 실행한다 — koreanNum.spec.ts와 동일하게 기존 Playwright 러너를 그대로 쓴다.
 *
 * 게이트가 useVoiceSession에 실제로 배선됐는지(스피커폰 모드에서 차단, 이어폰 barge-in 불변)는
 * correction-flow.spec.ts 전체 회귀(이어폰 경로)와 tsc로 보강한다. inGuard 윈도우의 시점 판정은
 * 본 순수 테스트가 클럭 의존 없이 결정적으로 커버한다.
 */

import { test, expect } from '@playwright/test';
import { evalPostTtsGuard, POST_TTS_GUARD_MS } from '../src/lib/postTtsGuard';
import { SpeechController } from '../src/lib/speech';

test.describe('evalPostTtsGuard — 순수 판정', () => {
  test('이어폰(speakerphone=false)은 항상 통과 — muted/경과와 무관', () => {
    expect(evalPostTtsGuard({ speakerphone: false, muted: true, msSinceTtsEnd: 0 }))
      .toEqual({ block: false, viaGuard: false });
    expect(evalPostTtsGuard({ speakerphone: false, muted: false, msSinceTtsEnd: 0 }))
      .toEqual({ block: false, viaGuard: false });
    expect(evalPostTtsGuard({ speakerphone: false, muted: false, msSinceTtsEnd: Number.POSITIVE_INFINITY }))
      .toEqual({ block: false, viaGuard: false });
  });

  test('스피커폰 + 재생 중(muted)은 차단 — viaGuard=false(재생 중 사유)', () => {
    expect(evalPostTtsGuard({ speakerphone: true, muted: true, msSinceTtsEnd: 9999 }))
      .toEqual({ block: true, viaGuard: false });
  });

  test('스피커폰 + 종료 직후 가드 윈도우 이내는 차단 — viaGuard=true', () => {
    expect(evalPostTtsGuard({ speakerphone: true, muted: false, msSinceTtsEnd: 0 }))
      .toEqual({ block: true, viaGuard: true });
    expect(evalPostTtsGuard({ speakerphone: true, muted: false, msSinceTtsEnd: POST_TTS_GUARD_MS - 1 }))
      .toEqual({ block: true, viaGuard: true });
  });

  test('스피커폰 + 가드 윈도우 경과 후는 통과', () => {
    expect(evalPostTtsGuard({ speakerphone: true, muted: false, msSinceTtsEnd: POST_TTS_GUARD_MS }))
      .toEqual({ block: false, viaGuard: false }); // 경계: strict < 이므로 정확히 guardMs는 통과
    expect(evalPostTtsGuard({ speakerphone: true, muted: false, msSinceTtsEnd: POST_TTS_GUARD_MS + 100 }))
      .toEqual({ block: false, viaGuard: false });
  });

  test('TTS 종료 이력 없음(msSinceTtsEnd=Infinity)은 스피커폰에서도 통과', () => {
    expect(evalPostTtsGuard({ speakerphone: true, muted: false, msSinceTtsEnd: Number.POSITIVE_INFINITY }))
      .toEqual({ block: false, viaGuard: false });
  });

  test('guardMs 커스텀 윈도우 적용', () => {
    expect(evalPostTtsGuard({ speakerphone: true, muted: false, msSinceTtsEnd: 300, guardMs: 500 }))
      .toEqual({ block: true, viaGuard: true });
    expect(evalPostTtsGuard({ speakerphone: true, muted: false, msSinceTtsEnd: 300, guardMs: 200 }))
      .toEqual({ block: false, viaGuard: false });
  });
});

test.describe('SpeechController — post-TTS 타임스탬프 프리미티브', () => {
  test('초기 상태: 재생 안 함, 종료 이력 없음(msSinceTtsEnd=Infinity)', () => {
    const ctrl = new SpeechController({ onFinal: () => {} });
    expect(ctrl.isTtsMuted()).toBe(false);
    expect(ctrl.msSinceTtsEnd()).toBe(Number.POSITIVE_INFINITY);
  });

  test('muteForTts: 재생 중 표시, 종료 시각은 아직 없음', () => {
    const ctrl = new SpeechController({ onFinal: () => {} });
    ctrl.muteForTts();
    expect(ctrl.isTtsMuted()).toBe(true);
    expect(ctrl.msSinceTtsEnd()).toBe(Number.POSITIVE_INFINITY);
  });

  test('unmuteForTts: 즉시 unmute + 종료 시각 기록 → msSinceTtsEnd 유한·작음', () => {
    const ctrl = new SpeechController({ onFinal: () => {} });
    ctrl.muteForTts();
    ctrl.unmuteForTts();
    expect(ctrl.isTtsMuted()).toBe(false);
    const ms = ctrl.msSinceTtsEnd();
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(1000); // 방금 기록 — 가드 윈도우 안에서 시작
  });

  test('stop: 종료 시각 리셋 → msSinceTtsEnd 다시 Infinity (다음 세션 오차단 방지)', () => {
    const ctrl = new SpeechController({ onFinal: () => {} });
    ctrl.muteForTts();
    ctrl.unmuteForTts();
    expect(Number.isFinite(ctrl.msSinceTtsEnd())).toBe(true);
    ctrl.stop();
    expect(ctrl.isTtsMuted()).toBe(false);
    expect(ctrl.msSinceTtsEnd()).toBe(Number.POSITIVE_INFINITY);
  });
});
