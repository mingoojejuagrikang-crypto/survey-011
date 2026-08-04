/**
 * §C5·§C5-b (v0.44.0 플랜 — F11·F14·F19·F08) 오라클.
 *
 * 재는 축: ① idle 진폭 — 레벨 0에서도 켜진 셀의 행 span ≥ 3(조용하면 화면이 죽어 보이는
 *            F11의 처방) · data-mode="idle" ② 밀도 2배 — 격자 18×10 = 180셀 리터럴
 *          ③ F19 — listening에서 mic 글리프를 렌더하지 않는다(항상 파형/idle 웨이브)
 *          ④ 글리프 비트맵 4종이 전부 10행이다([node] 정적 — mic은 화면 도달 불가라 DOM으로 못 잰다)
 *          ⑤ F08 — TabBar가 화면 최하단에 붙는다(box.y + height가 뷰포트 높이 8px 이내)
 * 안 재는 축: 하단 1행 24%·버튼 10%는 `v0440-zone-ratios.spec.ts` 층2가 잰다(@pending-c5b 해제) ·
 *             도트 원형(maxDotSkew)은 v034-wave-glow의 기존 계약이 잰다 · idle 주기 1.6s의
 *             시간 정밀도(rAF 위상은 디플레이크 주입과 무관하지만 주기 실측은 flaky 축이라 뺀다).
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { boot, PHONE_402, injectLevel } from './fixtures/activeZones';

test.setTimeout(120_000);

test('C5 — 격자는 18×10(180셀)이고 레벨 0에서도 idle 웨이브가 최소 3행을 켠다', async ({ page }) => {
  await boot(page, PHONE_402);
  const dots = page.locator('[data-testid="state-dots"]');

  const geometry = await dots.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      cells: el.querySelectorAll('span').length,
      cols: style.gridTemplateColumns.split(' ').length,
      rows: style.gridTemplateRows.split(' ').length,
    };
  });
  expect(geometry.cells, '18×10 격자').toBe(180);
  expect(geometry.cols, '열 18').toBe(18);
  expect(geometry.rows, '행 10').toBe(10);

  // ① 레벨 0(무음) — 종전엔 mic 글리프(가로 한 줄로 보이던 F11의 원인). 이제 idle 웨이브다.
  await injectLevel(page, 0);
  await page.waitForTimeout(600); // hangover(400ms) 경과
  await expect(dots).toHaveAttribute('data-mode', 'idle');
  const idleSpan = await dots.evaluate((el) => {
    const litRows = new Set<number>();
    for (const cell of Array.from(el.querySelectorAll('span'))) {
      if (getComputedStyle(cell).opacity === '1') {
        litRows.add(Number((cell.getAttribute('data-cell') ?? '0,0').split(',')[0]));
      }
    }
    return litRows.size;
  });
  expect(idleSpan, '레벨 0에서 켜진 행 span >= 3(F11 처방)').toBeGreaterThanOrEqual(3);

  // ③ F19 — listening 상태에서 mic 글리프 모드('glyph')로 돌아가지 않는다.
  const mode = await dots.getAttribute('data-mode');
  expect(mode, 'listening 무음은 glyph(mic)가 아니라 idle').not.toBe('glyph');

  // 음성이 들어오면 여전히 파형이다(기존 계약 유지).
  await injectLevel(page, 0.9);
  await page.waitForTimeout(200);
  await expect(dots).toHaveAttribute('data-mode', 'wave');
});

test('C5 — 일시정지·알람·완료 글리프는 유지된다(mic만 뺀다)', async ({ page }) => {
  await boot(page, PHONE_402);
  await page.locator('button[title="일시정지"]').click();
  const dots = page.locator('[data-testid="state-dots"]');
  await expect(dots).toHaveAttribute('data-glyph', 'pause');
  await expect(dots).toHaveAttribute('data-mode', 'glyph');
  // §C4 mono 점멸(!important CSS)은 디플레이크 주입(stt.ts의 duration 0)보다 늦게 선언돼
  // 실제로 돈다 — 켜진 셀 opacity가 0.66~1 사이를 오가므로 '켜짐'은 >0.3으로 판정한다
  // (꺼진 셀은 0 고정 — [UI-DOT-GHOST-1] 계약).
  const pauseLit = await dots.evaluate((el) =>
    Array.from(el.querySelectorAll('span'))
      .filter((c) => parseFloat(getComputedStyle(c).opacity) > 0.3).length);
  expect(pauseLit, '⏸ 글리프가 실제로 켜져 있다').toBeGreaterThan(0);
});

test('[node] C5 — GLYPHS 4종 비트맵이 전부 10행이다(18×10 재작성 검증)', () => {
  // mic 글리프는 F19로 화면 도달 불가라 DOM 오라클이 못 잰다 — 소스를 정적으로 읽는다
  // (v043-typo-contract와 같은 정적 검사기 패턴. 제품 상수 import가 아니라 원문 검사다).
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/voice/StateDots.tsx'), 'utf-8');
  const block = source.match(/const GLYPHS[\s\S]*?^\};/m)?.[0] ?? '';
  for (const name of ['mic', 'alert', 'pause', 'check']) {
    const entry = block.match(new RegExp(`${name}: center\\(\\[([\\s\\S]*?)\\]\\)`))?.[1] ?? '';
    const rows = entry.match(/'[.#]+'/g) ?? [];
    expect(rows.length, `${name} 글리프 10행`).toBe(10);
    for (const row of rows) {
      expect(row.length - 2, `${name} 행 폭 ≤ 18`).toBeLessThanOrEqual(18);
    }
  }
});

test('C5-b(F08) — TabBar가 화면 최하단에 붙는다', async ({ page }) => {
  await boot(page, PHONE_402);
  const tabBar = await page.locator('[data-testid="tab-bar"]').boundingBox();
  expect(tabBar).not.toBeNull();
  expect(Math.abs(tabBar!.y + tabBar!.height - PHONE_402.height), 'TabBar 하단 8px 이내')
    .toBeLessThanOrEqual(8);
});
