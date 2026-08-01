import { test, expect, type Page } from '@playwright/test';
import { PHONE_375, PHONE_402, boot } from './fixtures/activeZones';

test.setTimeout(120_000);

async function openManualInput(page: Page, viewport = PHONE_402) {
  await boot(page, viewport);
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  const region = page.locator('[data-testid="manual-value-sheet"]');
  await expect(region).toBeVisible({ timeout: 4000 });
  return region;
}

test('[UI-e3 오라클 1] 키패드는 123/456/789 전화 다이얼 순서다', async ({ page }) => {
  await openManualInput(page);
  const keys = await page.locator('[data-testid="manual-keypad"] > button').allTextContents();
  expect(keys.map((key) => key.trim()), '위→아래, 좌→우 키 순서').toEqual([
    '1', '2', '3',
    '4', '5', '6',
    '7', '8', '9',
    '.', '0', '⌫',
  ]);
});

const PHONE_375_PRESSURE = { width: 375, height: 650 } as const;

for (const viewport of [PHONE_402, PHONE_375, PHONE_375_PRESSURE]) {
  test(`[UI-e3 오라클 2] 키패드 버튼 실측 높이 >=44px @ ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await openManualInput(page, viewport);
    const heights = await page.locator('[data-testid="manual-keypad"] > button').evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height),
    );
    expect(heights.length, '실제 숫자 키를 측정했다').toBe(12);
    const minHeight = Math.min(...heights);
    const maxHeight = Math.max(...heights);
    console.log(`[UI-e3 keypad ${viewport.width}×${viewport.height}] min=${minHeight.toFixed(2)} max=${maxHeight.toFixed(2)}`);
    expect(minHeight, 'iOS 터치 하한').toBeGreaterThanOrEqual(44);
  });
}

test('[UI-e3] modify 20/30/50 인라인 배선 + 블록 커서 + focus/Escape/aria', async ({ page }) => {
  const region = await openManualInput(page, PHONE_402);
  const metrics = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="voice-active-state"]') as HTMLElement;
    const header = root.firstElementChild as HTMLElement;
    const chips = root.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    const center = root.querySelector('[data-testid="manual-value-display-zone"]') as HTMLElement;
    const bottom = root.querySelector('[data-testid="manual-input-bottom-zone"]') as HTMLElement;
    const rootHeight = root.getBoundingClientRect().height;
    const headerHeight = header.getBoundingClientRect().height;
    return {
      rootHeight,
      headerHeight,
      chipHeight: chips.getBoundingClientRect().height,
      centerHeight: center.getBoundingClientRect().height,
      bottomHeight: bottom.getBoundingClientRect().height,
      position: getComputedStyle(root.querySelector('[data-testid="manual-value-sheet"]') as HTMLElement).position,
    };
  });
  const zoneTotal = metrics.rootHeight - metrics.headerHeight;
  console.log(
    `[UI-e3 modify] chip=${metrics.chipHeight.toFixed(2)} center=${metrics.centerHeight.toFixed(2)} ` +
    `bottom=${metrics.bottomHeight.toFixed(2)} total=${zoneTotal.toFixed(2)}`,
  );
  expect(metrics.chipHeight / zoneTotal, 'modify 칩존 20%').toBeCloseTo(0.20, 2);
  expect(metrics.centerHeight / zoneTotal, 'modify 중앙 30%').toBeCloseTo(0.30, 2);
  expect(metrics.bottomHeight / zoneTotal, 'modify 하단 50%').toBeCloseTo(0.50, 2);
  expect(metrics.chipHeight + metrics.centerHeight + metrics.bottomHeight, 'modify 구역 합').toBeCloseTo(zoneTotal, 0);

  await expect(page.locator('[data-testid="voice-chip-grid"]')).toBeVisible();
  await expect(page.locator('[data-testid="voice-control-bar"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="state-dots"]')).toHaveCount(0);
  await expect(region).toHaveAttribute('role', 'region');
  await expect(region).toHaveAttribute('aria-label', /수정 입력, 값 입력 중/);
  await expect(region).not.toHaveAttribute('aria-modal', 'true');
  expect(metrics.position, '인라인 영역은 fixed 오버레이가 아니다').not.toBe('fixed');
  await expect(region).not.toContainText('수동 입력');

  const cursor = page.locator('[data-testid="manual-block-cursor"]');
  await expect(cursor).toBeVisible();
  const cursorMetrics = await cursor.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { text: element.textContent, width: rect.width, height: rect.height };
  });
  expect(cursorMetrics.text, '커서는 `_` 문자가 아니다').toBe('');
  expect(cursorMetrics.width, '블록 커서 폭').toBeGreaterThan(0);
  expect(cursorMetrics.height, '블록 커서 높이').toBeGreaterThan(cursorMetrics.width);

  await expect.poll(
    () => region.evaluate((element) => document.activeElement === element),
    '인라인 진입 시 영역 자체로 포커스 이동',
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(region).toHaveCount(0);
});
