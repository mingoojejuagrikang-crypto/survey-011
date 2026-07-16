/**
 * SpeechController — TTS mute 상태 전이 단위 테스트.
 *
 * v0.15.0 A6: 스피커폰(소프트 half-duplex) 모드와 그것으로 게이트되던 post-TTS 가드(evalPostTtsGuard,
 * src/lib/postTtsGuard.ts)는 삭제됐다(민구 결정 + Trace 회귀신호 0). 가드 순수판정 테스트는 함께 제거.
 * v0.35.1 Stage 1: 가드 삭제 후 죽은 코드로 남아 있던 타임스탬프 프리미티브(ttsEndedAt/msSinceTtsEnd,
 * src 참조 0 — 이 spec만 고정)도 삭제. 살아있는 API인 mute 상태 전이(muteForTts/unmuteForTts/stop →
 * isTtsMuted — handleFinal의 값 입력 필터 근거)만 계속 검증한다. DOM 의존이 없어 Node에서 직접
 * import해 실행한다(koreanNum.spec.ts와 동일 러너).
 */

import { test, expect } from '@playwright/test';
import { SpeechController } from '../src/lib/speech';

test.describe('SpeechController — TTS mute 상태 전이', () => {
  test('초기 상태: mute 아님', () => {
    const ctrl = new SpeechController({ onFinal: () => {} });
    expect(ctrl.isTtsMuted()).toBe(false);
  });

  test('muteForTts: 재생 중 표시', () => {
    const ctrl = new SpeechController({ onFinal: () => {} });
    ctrl.muteForTts();
    expect(ctrl.isTtsMuted()).toBe(true);
  });

  test('unmuteForTts: 즉시 unmute (이어폰 barge-in 경로)', () => {
    const ctrl = new SpeechController({ onFinal: () => {} });
    ctrl.muteForTts();
    ctrl.unmuteForTts();
    expect(ctrl.isTtsMuted()).toBe(false);
  });

  test('stop: mute 상태 리셋 (다음 세션 오차단 방지)', () => {
    const ctrl = new SpeechController({ onFinal: () => {} });
    ctrl.muteForTts();
    ctrl.stop();
    expect(ctrl.isTtsMuted()).toBe(false);
  });
});
