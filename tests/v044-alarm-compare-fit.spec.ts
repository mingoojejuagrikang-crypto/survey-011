/**
 * v0.44.0 §C0 — 🟢 **정상 회귀 가드로 승격판(2026-08-04). 알람 compare fit이 살아 있는지 잰다.**
 *
 *  ── 이력 ────────────────────────────────────────────────────────────────────
 *  A2가 「compare 슬롯에 fit 배선이 없다」를 고정하는 characterization으로 만들었고
 *  (원문: `git log -p` 또는 A0-probe.md §7-4), c0-r1이 배선을 넣은 뒤에도 fit이 **바닥
 *  (0.25)에 갇혀** 있었다 — 원인은 CenterStage 알람 `<style>`의 `line-height: 1 !important`
 *  (글리프가 line box를 넘어 만든 초과가 `overflowsHeight`를 전 배율에서 true로 만들어
 *  이진탐색이 low에서 즉시 이탈). **그 강제를 제거해 §C0가 완결됐고**(2026-08-04),
 *  characterization 단언을 뒤집어 이 승격판이 됐다.
 *
 *  ── 이 파일이 재는 것 (375×667, 값쌍 120.5→100) ─────────────────────────────
 *   1. compare 값이 배정 폭을 넘지 않는다(잉크 우측 초과 ≤ 0.5px).
 *   2. 🔑 **compare 값이 절대 하한(30px)에서 떨어져 실제로 커졌다**(> 35px — 실측 60.6px).
 *      바닥 고정이 재발하면 여기가 red다. 겹침·배정폭 단언(A·B)은 바닥 크기로도
 *      만족되므로 **이 단언만이 재발을 잡는다**(v0440-alarm-fit 단언C와 같은 원리).
 *   3. headline이 하한(17px)에 붙어 있지 않다(> 17.5px).
 *
 *  🔴 **`test.fail()`을 쓰지 않는다.** 그걸 쓰면 어떤 실패든 「예상된 실패」로 green이 된다 —
 *  harness가 깨져도(boot 실패·trigger 타임아웃) 신호가 없는 영구 green이 된다.
 *  아래 harness 건전성 단언(>0 측정 확인)이 그 경로를 막는다.
 *
 *  ⚠️ 기대값은 **리터럴**이다(`STATE_TYPE`을 import하지 않는다). 제품 상수를 빌리면
 *     둘을 같은 diff로 바꿀 때 통과해버려 파손을 감춘다(COMMON §4).
 */
import { test, expect } from '@playwright/test';
import { boot, triggerAnomaly } from './fixtures/activeZones';

test.setTimeout(120_000);

/** `STATE_TYPE.alarmLabel`의 하한. 리터럴로 박는다 — 제품 상수를 import하지 않는다. */
const ALARM_LABEL_FLOOR_PX = 17;

// 🟢 §C0 완결(2026-08-04) — `@pending-c0` 태그를 떼고 단언을 뒤집은 승격판이다(위 docstring).
test('§C0 회귀 가드 — 알람 compare fit이 살아 있다: 안 넘침 · 하한 이탈(375×667)', async ({ page }) => {
  await boot(page, { width: 375, height: 667 });
  await triggerAnomaly(page);
  await page.waitForTimeout(300);

  const m = await page.locator('[data-testid="anomaly-alert"]').evaluate((card) => {
    const headline = card.querySelector<HTMLElement>('[data-testid="anomaly-headline"]');
    const nextValue = card.querySelector<HTMLElement>('[data-testid="anomaly-next-value"]');
    const inkOverflowRight = (el: HTMLElement | null) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const px = (v: string) => Number.parseFloat(v) || 0;
      const box = el.getBoundingClientRect();
      const contentRight = box.right - px(cs.borderRightWidth) - px(cs.paddingRight);
      const r = document.createRange();
      r.selectNodeContents(el);
      return +(r.getBoundingClientRect().right - contentRight).toFixed(3);
    };
    return {
      fitLo: card.style.getPropertyValue('--fit-lo').trim(),
      headlineFontPx: headline ? parseFloat(getComputedStyle(headline).fontSize) : 0,
      nextValueFontPx: nextValue ? parseFloat(getComputedStyle(nextValue).fontSize) : 0,
      nextValueOverflowRightPx: inkOverflowRight(nextValue),
    };
  });
  console.log(`[c0-gate] fit-lo=${m.fitLo} headline=${m.headlineFontPx}px `
    + `next-value=${m.nextValueFontPx}px overflowRight=${m.nextValueOverflowRightPx}px`);

  // ── harness 건전성 — 여기가 깨지면 아래 characterization은 의미가 없다 ──────────
  expect(m.headlineFontPx, 'headline을 실제로 측정했다').toBeGreaterThan(0);
  expect(m.nextValueFontPx, 'next-value를 실제로 측정했다').toBeGreaterThan(0);
  expect(m.nextValueOverflowRightPx, 'next-value 초과를 실제로 측정했다').not.toBeNull();

  // ── 🟢 §C0 완결 상태 가드 (승격판 2026-08-04) ──────────────────────────────
  expect(
    m.nextValueOverflowRightPx!,
    'compare 값이 배정 폭을 넘지 않는다(잉크 우측 초과 ≤ 0.5px)',
  ).toBeLessThanOrEqual(0.5);
  expect(
    m.nextValueFontPx,
    '🔑 compare 값이 절대 하한(30px)에서 떨어져 실제로 커졌다 — 바닥 고정이 재발하면 '
    + '여기가 red다(겹침·배정폭 단언은 바닥 크기로도 만족되므로 이 단언만이 재발을 잡는다)',
  ).toBeGreaterThan(35);
  expect(
    m.headlineFontPx,
    'headline이 하한에 붙어 있지 않다',
  ).toBeGreaterThan(ALARM_LABEL_FLOOR_PX + 0.5);
});
