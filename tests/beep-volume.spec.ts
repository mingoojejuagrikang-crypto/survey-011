/**
 * v0.35.0 FIX-1/FIX-7(리뷰 라운드1) — 비프 마스터 볼륨 매핑 순수 단위 테스트.
 *
 * beepVariants.ts는 DOM/WebAudio 의존이 없어 Node에서 직접 import해 검증한다(koreanNum.spec 패턴).
 * 매핑(0/0.5/1 → 0/3×/6×) + 클램프 + 손상값(NaN/Inf/문자열/범위 밖) coercion을 고정한다.
 */
import { test, expect } from '@playwright/test';
import { beepVolumeToMultiplier, BEEP_VOLUME_MAX } from '../src/lib/beepVariants';

test('FIX-1 — beepVolumeToMultiplier: 0/0.5/1 → 0/3×/6× 매핑', () => {
  expect(BEEP_VOLUME_MAX).toBe(6);
  expect(beepVolumeToMultiplier(0)).toBe(0);
  expect(beepVolumeToMultiplier(0.5)).toBeCloseTo(3, 6);
  expect(beepVolumeToMultiplier(1)).toBe(6);
  // 중간값 선형.
  expect(beepVolumeToMultiplier(0.25)).toBeCloseTo(1.5, 6);
});

test('FIX-1 — 범위 밖은 클램프(0..1), 손상값(NaN/Inf/비숫자)은 기본 0.5(=3×)로 치유', () => {
  expect(beepVolumeToMultiplier(-0.3)).toBe(0);      // 하한 클램프
  expect(beepVolumeToMultiplier(2.5)).toBe(6);       // 상한 클램프
  expect(beepVolumeToMultiplier(Number.NaN)).toBeCloseTo(3, 6);
  expect(beepVolumeToMultiplier(Number.POSITIVE_INFINITY)).toBeCloseTo(3, 6);
  expect(beepVolumeToMultiplier(Number.NEGATIVE_INFINITY)).toBeCloseTo(3, 6);
  expect(beepVolumeToMultiplier('0.8' as unknown as number)).toBeCloseTo(3, 6); // 비숫자 → 기본
  expect(beepVolumeToMultiplier(undefined as unknown as number)).toBeCloseTo(3, 6);
});

test('R2-FIX-6 — 출력 배수는 항상 [0, BEEP_VOLUME_MAX] 안(상한 클램프, 클리핑 방어)', () => {
  // 어떤 입력이 와도 상·하한을 넘지 않는다(재생기 playSchedule도 동일 클램프를 최종 방어선으로 둔다).
  const inputs = [-99, -1, 0, 0.5, 1, 1.0001, 42, 1e9, Number.NaN, Number.POSITIVE_INFINITY];
  for (const v of inputs) {
    const m = beepVolumeToMultiplier(v);
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThanOrEqual(BEEP_VOLUME_MAX);
    expect(Number.isFinite(m)).toBe(true);
  }
  expect(beepVolumeToMultiplier(1e9)).toBe(BEEP_VOLUME_MAX); // 폭주값 → 상한
});
