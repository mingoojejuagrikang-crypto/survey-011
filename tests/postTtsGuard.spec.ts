/**
 * SpeechController — post-TTS 타임스탬프 프리미티브 단위 테스트.
 *
 * v0.15.0 A6: 스피커폰(소프트 half-duplex) 모드와 그것으로 게이트되던 post-TTS 가드(evalPostTtsGuard,
 * src/lib/postTtsGuard.ts)는 삭제됐다(민구 결정 + Trace 회귀신호 0). 가드 순수판정 테스트는 함께 제거.
 *
 * 단, SpeechController의 TTS 종료 타임스탬프 프리미티브(muteForTts/unmuteForTts → ttsEndedAt →
 * msSinceTtsEnd)는 컨트롤러 API로 남아(unmuteForTts는 TTS 종료 후 STT 재개 경로의 일부) 회귀 가시화를
 * 위해 계속 검증한다. DOM 의존이 없어 Node에서 직접 import해 실행한다(koreanNum.spec.ts와 동일 러너).
 */

import { test, expect } from '@playwright/test';
import { SpeechController } from '../src/lib/speech';

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
    expect(ms).toBeLessThan(1000); // 방금 기록
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
