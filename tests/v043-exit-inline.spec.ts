import { test, expect, type Page } from '@playwright/test';
import { boot, zoneMetrics } from './fixtures/activeZones';

test.setTimeout(120_000);

const PHONE_375_PRESSURE = { width: 375, height: 650 } as const;

async function openExitConfirm(page: Page) {
  await boot(page, PHONE_375_PRESSURE);
  await page.locator('button[title="일시정지"]').click();
  await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-glyph', 'pause');
  await page.locator('button[title="입력 종료"]').click();
  const inline = page.locator('[data-testid="exit-confirm-inline"]');
  await expect(inline).toBeVisible({ timeout: 4000 });
  return inline;
}

test('[UI-e4 dotless 오라클] 저장확인만 20/70/10이고 375×650에서도 도트가 없다', async ({ page }) => {
  const inline = await openExitConfirm(page);
  const metrics = await zoneMetrics(page);
  const zoneTotal = metrics.rootHeight - metrics.headerHeight;
  const fontSize = await inline.locator('[data-testid="exit-confirm-rows"]')
    .evaluate((el) => parseFloat(getComputedStyle(el as HTMLElement).fontSize));

  console.log(
    `[UI-e4 dotless 375×650] chip=${metrics.chipHeight.toFixed(2)} center=${metrics.centerHeight.toFixed(2)} ` +
    `bottom=${metrics.bottomHeight.toFixed(2)} total=${zoneTotal.toFixed(2)} title=${fontSize.toFixed(2)}`,
  );
  expect(metrics.chipHeight / zoneTotal, 'dotless 칩존 20%').toBeCloseTo(0.20, 2);
  expect(metrics.centerHeight / zoneTotal, 'dotless 중앙 70%').toBeCloseTo(0.70, 2);
  expect(metrics.bottomHeight / zoneTotal, 'dotless 하단 10%').toBeCloseTo(0.10, 2);
  expect(metrics.chipHeight + metrics.centerHeight + metrics.bottomHeight, 'dotless 구역 합').toBeCloseTo(zoneTotal, 0);
  // v0.44.0 §C3(F21 "종료터치시 3줄안내") — 단일 문구가 3행(완료행 / N/M / ✓ 안내)이 됐다.
  // 38px 계약(VOICE_TYPE.exitConfirmTitle)은 가운데 완료 수치 행이 승계한다.
  expect(fontSize, '완료 수치 행 38px').toBeCloseTo(38, 1);
  await expect(inline.locator('[data-testid="exit-confirm-rows-label"]')).toHaveText('완료행');
  await expect(inline.locator('[data-testid="exit-confirm-rows"]')).toHaveText('0/2');
  await expect(inline.locator('[data-testid="exit-confirm-hint"]')).toContainText('터치시 저장하고 종료합니다');
  await expect(inline).toHaveAttribute('role', 'status');
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="state-dots"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="voice-indicator-row"]')).toHaveCount(0);

  // v0.44.0 §C3(F16·F22) — `‹ ›`는 렌더하지 않고 2버튼이 4버튼 총 폭을 나눠 갖는다.
  const actionTitles = await page.locator('[data-testid="voice-nav-row"] > button')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('title')));
  expect(actionTitles, '하단은 [✕][✓] 2버튼').toEqual(['계속 입력', '종료 확인']);

  // 🔴 쓰기 경로는 `test-results/`(gitignore) 안이어야 한다 — 종전 `Deliverables/assets/2026-08-02-ui-e4/`는
  //   **git 추적 중인 08-02 회차 증거 PNG를 매 런마다 덮어썼다.** 실제로 b217278에 교체본이 실려 나가
  //   e06019a가 되돌리는 커밋을 따로 냈고, 콜드 리뷰 R1은 그 `M`을 "다른 실행 주체가 붙었다"로 오독했다.
  //   여기 스크린샷은 단언이 아니라 눈으로 볼 증거 덤프다 — 경로만 옮기면 잃는 것이 없다.
  await page.screenshot({ path: 'test-results/ui-e4/exit-inline-375x650.png' });
  await page.setViewportSize({ width: 402, height: 874 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/ui-e4/exit-inline-402x874.png' });

  await page.locator('button[title="계속 입력"]').click();
  await expect(inline).toHaveCount(0);
  // dotless는 저장확인 전용이다. 일시정지로 돌아오면 ⏸ 문양이 다시 보여야 한다.
  await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-glyph', 'pause');
});
