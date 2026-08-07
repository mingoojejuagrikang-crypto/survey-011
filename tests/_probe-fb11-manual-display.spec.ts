/**
 * 🔬 **진단 프로브** — 판정 스위트가 아니다(`_` 접두 = `testIgnore`).
 *   돌리는 법: `npx playwright test tests/_probe-fb11-manual-display.spec.ts --config=playwright.probe.config.ts`
 *   ⚠️ `playwright.config.ts:30`이 안내하는 `--project=""`는 현 Playwright에서 죽었다(08-07 실측).
 *
 * ## 무엇을 재나
 *
 * 민구 제보 **FB-11**(2026-08-07): *"입력탭에서 음성 입력중 입력해야 할 항목의 칩 터치하여 수동
 * 입력시, 키패드가 팝업되고 사용자가 입력하는 숫자가 위에 출력되는데 마찬가지로 「311…」 이런식으로
 * 표현. **입력되는 값에 따라서 잘리거나 축약되지 않게 유동적으로 사이즈 조절**이 되면 좋겠어."*
 * 확정(08-07): *"축약(`...`)을 금지하고 폭에 맞춰서 글자 크기를 조절하는걸로."*
 *
 * 🔑 **FB-6·7(중앙 확정값)과 다른 컴포넌트다.** 그쪽은 `VoiceHero`이고 이쪽은 `ManualValueSheet`다.
 * 그리고 이쪽은 원인이 **명확히 재현된다** — 종전 `sheetDisplay`가 `max(128.64px, …)`라
 * 축소가 구조적으로 불가능했고(`--fit-lo`는 `max()` 첫 항에 흡수 · 훅도 안 물려 있었다),
 * `textOverflow: ellipsis`가 그 넘침을 `311…`으로 그렸다.
 *
 * **판정 축:** 자릿수를 늘려가며 ①폰트가 실제로 줄어드는가 ②가로 넘침(`ovX`)이 0인가.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot } from './fixtures/activeZones';
import { waitForTtsIdle } from './fixtures/stt';

test.setTimeout(180_000);

const VIEWPORTS = [
  { width: 402, height: 513, label: '402x513·민구실측' },
  { width: 402, height: 874, label: '402x874·대조군' },
  { width: 375, height: 667, label: '375x667·최소지원' },
];

/** 민구 제보값(`311…`)을 포함해 자릿수를 늘려간다. 마지막은 극단 대조군이다. */
const SEQUENCES = ['3', '31', '311', '311.5', '3115.75', '311575.25'];

async function openKeypad(page: Page) {
  await waitForTtsIdle(page);
  await page.locator('[data-testid="column-chip"][data-col-name="횡경"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 4000 });
}

/** 표시 요소의 실렌더 계측. `ovX > 0`이면 가로로 넘친 것 = 종전 `ellipsis`가 그리던 상태. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const zone = document.querySelector('[data-testid="manual-value-display-zone"]') as HTMLElement | null;
    const disp = document.querySelector('[data-testid="manual-keypad-display"]') as HTMLElement | null;
    if (!zone || !disp) return null;
    const span = disp.querySelector('span') as HTMLElement | null;
    const cs = getComputedStyle(disp);
    const zr = zone.getBoundingClientRect();
    const dr = disp.getBoundingClientRect();
    return {
      text: (span?.textContent ?? '').trim(),
      fontPx: Math.round(parseFloat(cs.fontSize) * 10) / 10,
      textOverflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace,
      ovX: disp.scrollWidth - disp.clientWidth,
      ovY: disp.scrollHeight - disp.clientHeight,
      outRight: Math.round((dr.right - zr.right) * 10) / 10,
      outBottom: Math.round((dr.bottom - zr.bottom) * 10) / 10,
      fitVar: getComputedStyle(zone).getPropertyValue('--fit-sheet').trim(),
    };
  });
}

const rows: string[] = [];

for (const vp of VIEWPORTS) {
  test(`프로브 ${vp.label} — 자릿수를 늘려도 축약되지 않는다`, async ({ page }) => {
    await boot(page, { width: vp.width, height: vp.height });
    await openKeypad(page);

    let prevFont = Infinity;
    for (const seq of SEQUENCES) {
      // 매번 처음부터 다시 친다(백스페이스 경로를 섞지 않는다 — 축을 하나만 움직인다).
      for (let i = 0; i < 12; i++) await page.locator('[data-testid="manual-key-back"]').click();
      for (const ch of seq) {
        await page.locator(`[data-testid="manual-key-${ch}"]`).click();
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const m = await measure(page);
      if (!m) { rows.push(`${vp.label} | ${seq} | ❌ 요소 없음`); continue; }
      const clipped = m.ovX > 0.5 || m.outRight > 0.5;
      rows.push(
        `${vp.label} | ${seq.padEnd(10)} | ${clipped ? '🔴잘림' : '🟢'} ` +
        `font=${String(m.fontPx).padStart(6)} ovX=${m.ovX} ovY=${m.ovY} ` +
        `outR=${m.outRight} outB=${m.outBottom} fit=${m.fitVar} to=${m.textOverflow} ws=${m.whiteSpace}`,
      );
      // 🔴 민구 확정 계약 — **축약 금지**. ellipsis가 되살아나면 여기서 걸린다.
      expect(m.textOverflow, `${seq}: textOverflow가 ellipsis면 값이 감춰진다`).not.toBe('ellipsis');
      expect(m.ovX, `${seq}: 가로로 넘치면 안 된다(폭에 맞춰 줄어야 한다)`).toBeLessThanOrEqual(0.5);
      // 길어지면 폰트는 줄거나 최소한 커지지 않는다.
      expect(m.fontPx, `${seq}: 값이 길어졌는데 글자가 커졌다`).toBeLessThanOrEqual(prevFont + 0.5);
      prevFont = m.fontPx;
    }
  });
}

test.afterAll(() => {
  console.log('\n\n═══════ FB-11 수동입력 표시 프로브 ═══════');
  for (const r of rows) console.log(r);
  console.log('════════════════════════════════════════\n');
});
