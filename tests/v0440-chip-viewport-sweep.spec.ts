import { test, expect } from '@playwright/test';
import { boot } from './fixtures/activeZones';

/** §C1 — 🔴 **비율 공간 전체 스윕.** 민구 요구(2026-08-03):
 *  *"데스크탑 앱의 크롬에서 사용자가 화면 비율을 **어떻게 변경해도** 잘리거나 넘어서지 않고
 *  사용자가 보기 좋게 만들어져야 해. 데스크탑에서 어느 비율에서도 완벽하게 보인다면
 *  스마트폰이나 테블릿에서도 잘 보일 수 있을거 아니니?"*
 *
 *  🔑 **왜 이 파일이 필요한가:** 종전 칩 가드(`v037`·`v019`)는 **점 몇 개**만 잰다
 *  (402×874 · 390×568 · 375×667 · 430×667). §C1이 계수를 그 점들에 맞춰 튜닝하는 동안
 *  **점 사이 구간은 아무도 안 봤다.** 데스크톱 창은 연속적으로 바뀌므로 점 검증은 부족하다.
 *
 *  판정은 **레이아웃 rect**로 한다 — `scrollHeight`는 이 구조에서 오탐이 난다
 *  (`transform: scale`을 반영하고, `inline-grid` + `overflow:hidden`에서 실제보다 크게 나온다.
 *  §C1 산출물 §2 참고). 여기서는 **자식 rect가 칩 content box 안에 있는가**로 잰다. */

const WIDTHS = [320, 375, 430, 540, 768, 1024, 1280, 1600, 1920];
const HEIGHTS = [400, 500, 568, 667, 800, 874, 1024, 1200];

type Cell = {
  w: number; h: number;
  chipH: number; contentTop: number; contentBottom: number;
  labelTop: number; labelBottom: number; labelFont: number;
  valueTop: number; valueBottom: number; valueFont: number;
  chipZoneH: number;
};

async function measure(page: import('@playwright/test').Page, w: number, h: number): Promise<Cell | null> {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(160);
  return page.evaluate(({ w, h }) => {
    const grid = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement | null;
    if (!grid) return null;
    const chip = grid.querySelector('[data-testid="column-chip"]') as HTMLElement | null;
    if (!chip) return null;
    const label = chip.querySelector('[data-testid="column-chip-label"]') as HTMLElement | null;
    const value = Array.from(chip.children).find((k) => k !== label) as HTMLElement | undefined;
    if (!label || !value) return null;
    const cs = getComputedStyle(chip);
    const cr = chip.getBoundingClientRect();
    const bt = parseFloat(cs.borderTopWidth), bb = parseFloat(cs.borderBottomWidth);
    const pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom);
    const lr = label.getBoundingClientRect(), vr = value.getBoundingClientRect();
    return {
      w, h,
      chipH: cr.height,
      contentTop: cr.top + bt + pt,
      contentBottom: cr.bottom - bb - pb,
      labelTop: lr.top, labelBottom: lr.bottom,
      labelFont: parseFloat(getComputedStyle(label).fontSize),
      valueTop: vr.top, valueBottom: vr.bottom,
      valueFont: parseFloat(getComputedStyle(value).fontSize),
      chipZoneH: grid.getBoundingClientRect().height,
    };
  }, { w, h });
}

test.setTimeout(180_000);

test('[SWEEP] 칩이 어떤 창 비율에서도 잘리지 않는다 · 위계가 유지된다', async ({ page }) => {
  await boot(page, { width: 402, height: 874 });
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });

  const clipped: string[] = [];
  const inverted: string[] = [];
  const tiny: string[] = [];
  let n = 0;

  for (const h of HEIGHTS) {
    for (const w of WIDTHS) {
      const m = await measure(page, w, h);
      if (!m) continue;
      n++;
      // 🔴 잘림 — 자식이 칩 content box를 벗어난다(0.5px 여유는 서브픽셀 라운딩).
      const over = Math.max(
        m.contentTop - m.labelTop,
        m.labelBottom - m.contentBottom,
        m.contentTop - m.valueTop,
        m.valueBottom - m.contentBottom,
      );
      if (over > 0.5) {
        clipped.push(`${w}×${h} over=${over.toFixed(2)}px (zone=${m.chipZoneH.toFixed(0)} chip=${m.chipH.toFixed(0)} ${m.labelFont.toFixed(1)}/${m.valueFont.toFixed(1)})`);
      }
      // 🔴 위계 — 항목명은 값 이하다(CHIP_TYPE 계약).
      if (m.labelFont > m.valueFont + 0.01) {
        inverted.push(`${w}×${h} label=${m.labelFont.toFixed(2)} > value=${m.valueFont.toFixed(2)}`);
      }
      // ⚠️ 가독 하한 — 계약상 하한(12px/18px)이 실제로 발동하는 구간을 기록한다(실패 아님).
      if (m.labelFont <= 12.01 || m.valueFont <= 18.01) {
        tiny.push(`${w}×${h} ${m.labelFont.toFixed(1)}/${m.valueFont.toFixed(1)}`);
      }
    }
  }

  console.log(`[SWEEP] ${n}개 조합 측정`);
  console.log(`[SWEEP] 하한 발동 ${tiny.length}건${tiny.length ? ': ' + tiny.slice(0, 6).join(' | ') : ''}`);
  if (clipped.length) console.log(`[SWEEP] 🔴 잘림 ${clipped.length}건:\n  ${clipped.slice(0, 25).join('\n  ')}`);
  if (inverted.length) console.log(`[SWEEP] 🔴 위계역전 ${inverted.length}건:\n  ${inverted.slice(0, 10).join('\n  ')}`);

  expect(clipped, `칩 내용이 잘리는 창 비율이 있다(${clipped.length}/${n})`).toEqual([]);
  expect(inverted, `항목명이 값보다 커지는 창 비율이 있다(${inverted.length}/${n})`).toEqual([]);
});

/** 🔑 폭 반응 — 같은 높이에서 폭을 넓히면 글자가 커진다(민구 *"일정 비율로 조절"*).
 *  `v019:264`가 375→430 한 쌍만 재던 것을 **전 구간**으로 확장한다. */
test('[SWEEP] 같은 높이에서 폭이 넓어지면 칩 글자가 커지거나 최소한 줄지 않는다', async ({ page }) => {
  await boot(page, { width: 402, height: 874 });
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });

  const shrank: string[] = [];
  const grew: string[] = [];
  for (const h of HEIGHTS) {
    let prev: Cell | null = null;
    for (const w of WIDTHS) {
      const m = await measure(page, w, h);
      if (!m) continue;
      if (prev) {
        if (m.labelFont < prev.labelFont - 0.01) {
          shrank.push(`h=${h}: ${prev.w}→${w} ${prev.labelFont.toFixed(2)}→${m.labelFont.toFixed(2)}`);
        } else if (m.labelFont > prev.labelFont + 0.01) {
          grew.push(`h=${h}: ${prev.w}→${w}`);
        }
      }
      prev = m;
    }
  }
  console.log(`[SWEEP] 폭 증가 구간에서 글자 증가 ${grew.length}건 · 감소 ${shrank.length}건`);
  if (shrank.length) console.log(`  🔴 감소: ${shrank.slice(0, 12).join(' | ')}`);
  expect(shrank, '폭을 넓혔는데 칩 글자가 줄어드는 구간이 있다').toEqual([]);
});
