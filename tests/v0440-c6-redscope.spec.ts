/**
 * §C6 (v0.44.0 플랜 — F10) 오라클: 알람 빨강의 적용 범위 축소.
 * 재는 축: 알람 2열에서 현재값(next)만 빨강이고 과거값(prev)은 빨강이 아니다.
 * 안 재는 축: 칩·경보행의 빨강(기존 계약 유지 — v039/v0440-alarm-fit이 잰다).
 */
import { test, expect } from '@playwright/test';
import { boot, PHONE_402, triggerAnomaly } from './fixtures/activeZones';

test.setTimeout(120_000);

test('C6 — 알람 빨강은 원인 요소(현재값)에만. 과거값은 회색이다', async ({ page }) => {
  await boot(page, PHONE_402);
  await triggerAnomaly(page);

  const colors = await page.evaluate(() => {
    const get = (id: string) =>
      getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!).color;
    return {
      prevLabel: get('anomaly-prev-label'),
      prevValue: get('anomaly-prev-value'),
      nextLabel: get('anomaly-next-label'),
      nextValue: get('anomaly-next-value'),
    };
  });
  const red = 'rgb(255, 23, 68)';
  expect(colors.nextLabel, '현재 라벨은 빨강(원인 요소)').toBe(red);
  expect(colors.nextValue, '현재 값은 빨강(원인 요소)').toBe(red);
  expect(colors.prevLabel, '과거 라벨은 빨강 금지(F10)').not.toBe(red);
  expect(colors.prevValue, '과거 값은 빨강 금지(F10)').not.toBe(red);
});
