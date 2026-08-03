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

/** 🔴 **축마다 기준 박스가 다르다. 하나로 통일하지 마라** — 감사(2026-08-03)가 잡은 함정이다.
 *
 *  | 축 | 기준 박스 | 왜 |
 *  |---|---|---|
 *  | 세로 | **칩존 padding box**(`clientHeight`) | `overflowY:'hidden'`이 거기서 자른다. 칩이 `minHeight:44`로 칩존보다 커지는 것을 잡는 유일한 축 |
 *  | 가로 | **칩 자신의 content box** | 클리핑 주체가 칩이다(`maxWidth:96cqw` + `overflow:hidden` + `nowrap`). 칩존은 `overflowX:'auto'` **스크롤 컨테이너**라 칩이 밖에 있는 건 **정상**이다 |
 *
 *  🔴 가로를 칩존 기준으로 재면 `alignActiveChip`(우측끝 정렬, 민구 확정 계약)이 밀어놓은
 *  칩들이 전부 3000px대 오탐으로 잡혀 **72칸 전부 red**가 되고 진짜 신호가 묻힌다. */
type Cell = {
  w: number; h: number;
  chipH: number; contentTop: number; contentBottom: number;
  contentLeft: number; contentRight: number;
  labelTop: number; labelBottom: number; labelLeft: number; labelRight: number; labelFont: number;
  valueTop: number; valueBottom: number; valueLeft: number; valueRight: number; valueFont: number;
  chipTop: number; chipBottom: number;
  zoneClipTop: number; zoneClipBottom: number; zoneScrollTop: number;
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
    const bl = parseFloat(cs.borderLeftWidth), br = parseFloat(cs.borderRightWidth);
    const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
    const lr = label.getBoundingClientRect(), vr = value.getBoundingClientRect();
    // 칩존 padding box — `overflowY:'hidden'`이 자르는 경계.
    const gs = getComputedStyle(grid);
    const gr = grid.getBoundingClientRect();
    const gbt = parseFloat(gs.borderTopWidth);
    return {
      w, h,
      chipH: cr.height,
      contentTop: cr.top + bt + pt,
      contentBottom: cr.bottom - bb - pb,
      contentLeft: cr.left + bl + pl,
      contentRight: cr.right - br - pr,
      labelTop: lr.top, labelBottom: lr.bottom, labelLeft: lr.left, labelRight: lr.right,
      labelFont: parseFloat(getComputedStyle(label).fontSize),
      valueTop: vr.top, valueBottom: vr.bottom, valueLeft: vr.left, valueRight: vr.right,
      valueFont: parseFloat(getComputedStyle(value).fontSize),
      chipTop: cr.top, chipBottom: cr.bottom,
      zoneClipTop: gr.top + gbt,
      zoneClipBottom: gr.top + gbt + grid.clientHeight,
      zoneScrollTop: grid.scrollTop,
      chipZoneH: gr.height,
    };
  }, { w, h });
}

test.setTimeout(180_000);

test('[SWEEP] 칩이 어떤 창 비율에서도 잘리지 않는다 · 위계가 유지된다', async ({ page }) => {
  await boot(page, { width: 402, height: 874 });
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });

  const clippedV: string[] = [];
  const clippedH: string[] = [];
  const zoneOver: string[] = [];
  const scrolled: string[] = [];
  const inverted: string[] = [];
  const tiny: string[] = [];
  let n = 0;

  for (const h of HEIGHTS) {
    for (const w of WIDTHS) {
      const m = await measure(page, w, h);
      if (!m) continue;
      n++;
      // 🔴 ① 세로 — 자식이 칩 content box를 벗어난다(0.5px 여유는 서브픽셀 라운딩).
      const overV = Math.max(
        m.contentTop - m.labelTop, m.labelBottom - m.contentBottom,
        m.contentTop - m.valueTop, m.valueBottom - m.contentBottom,
      );
      if (overV > 0.5) {
        clippedV.push(`${w}×${h} over=${overV.toFixed(2)}px (zone=${m.chipZoneH.toFixed(0)} chip=${m.chipH.toFixed(0)} ${m.labelFont.toFixed(1)}/${m.valueFont.toFixed(1)})`);
      }
      // 🔴 ② 가로 — 자식이 칩 content box를 벗어난다. **칩 기준이다**(칩존 아님 — 위 주석).
      const overH = Math.max(
        m.contentLeft - m.labelLeft, m.labelRight - m.contentRight,
        m.contentLeft - m.valueLeft, m.valueRight - m.contentRight,
      );
      if (overH > 0.5) {
        clippedH.push(`${w}×${h} over=${overH.toFixed(2)}px (${m.labelFont.toFixed(1)}/${m.valueFont.toFixed(1)})`);
      }
      // 🔴 ③ 칩 박스가 칩존 clip 박스(padding box)를 넘는다 — `minHeight:44`가 칩존보다 클 때.
      const overZone = Math.max(m.zoneClipTop - m.chipTop, m.chipBottom - m.zoneClipBottom);
      if (overZone > 0.5) {
        zoneOver.push(`${w}×${h} over=${overZone.toFixed(2)}px (zoneClip=${(m.zoneClipBottom - m.zoneClipTop).toFixed(1)} chip=${m.chipH.toFixed(1)})`);
      }
      // ⚠️ 세로 기준 프레임 전제 — 칩존이 스크롤되면 위 판정이 통째로 어긋난다.
      if (Math.abs(m.zoneScrollTop) > 0.5) scrolled.push(`${w}×${h} scrollTop=${m.zoneScrollTop}`);
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
  if (clippedV.length) console.log(`[SWEEP] 🔴 세로잘림 ${clippedV.length}건:\n  ${clippedV.slice(0, 20).join('\n  ')}`);
  if (clippedH.length) console.log(`[SWEEP] 🔴 가로잘림 ${clippedH.length}건:\n  ${clippedH.slice(0, 20).join('\n  ')}`);
  if (zoneOver.length) console.log(`[SWEEP] 🔴 칩이 칩존을 넘음 ${zoneOver.length}건:\n  ${zoneOver.slice(0, 20).join('\n  ')}`);
  if (scrolled.length) console.log(`[SWEEP] ⚠️ 칩존 세로 스크롤 ${scrolled.length}건: ${scrolled.slice(0, 5).join(' | ')}`);
  if (inverted.length) console.log(`[SWEEP] 🔴 위계역전 ${inverted.length}건:\n  ${inverted.slice(0, 10).join('\n  ')}`);

  expect(scrolled, `칩존이 세로로 스크롤됐다 — 세로 판정의 기준 프레임이 어긋난다(${scrolled.length}/${n})`).toEqual([]);
  expect(clippedV, `칩 내용이 세로로 잘리는 창 비율이 있다(${clippedV.length}/${n})`).toEqual([]);
  expect(clippedH, `칩 내용이 가로로 잘리는 창 비율이 있다(${clippedH.length}/${n})`).toEqual([]);
  expect(zoneOver, `칩 박스가 칩존 밖으로 넘치는 창 비율이 있다(${zoneOver.length}/${n})`).toEqual([]);
  expect(inverted, `항목명이 값보다 커지는 창 비율이 있다(${inverted.length}/${n})`).toEqual([]);
});

/** 🔴 **safe-area 축.** 노치 기기는 `--sat`/`--sab`가 pool에서 **68px를 떼간다**
 *  (`App.tsx:221 paddingTop:var(--sat)` + `global.css height:100dvh` + `box-sizing:border-box`,
 *  하단은 `TabBar.tsx:62 paddingBottom: max(28px, var(--sab))`).
 *  칩존은 pool의 16%이므로 **잘림 임계가 그만큼 위로 밀린다** — safe-area 0에서 안전한 높이가
 *  노치 기기에서는 안전하지 않다. 감사(2026-08-03) P5가 실측으로 잡았다.
 *  🔑 위 스윕은 safe-area를 주입하지 않는다(`boot`만) — 그래서 이 축이 따로 필요하다. */
test('[SWEEP] safe-area(노치)에서도 칩이 잘리지 않는다', async ({ page }) => {
  await boot(page, { width: 402, height: 874 });
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  // 픽스처와 같은 값(iPhone 17 노치 실측 가정): top 62 / bottom 34.
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--sat', '62px');
    document.documentElement.style.setProperty('--sab', '34px');
  });
  await page.waitForTimeout(200);

  const bad: string[] = [];
  let n = 0;
  for (const h of HEIGHTS) {
    for (const w of WIDTHS) {
      const m = await measure(page, w, h);
      if (!m) continue;
      n++;
      const overV = Math.max(
        m.contentTop - m.labelTop, m.labelBottom - m.contentBottom,
        m.contentTop - m.valueTop, m.valueBottom - m.contentBottom,
      );
      const overH = Math.max(
        m.contentLeft - m.labelLeft, m.labelRight - m.contentRight,
        m.contentLeft - m.valueLeft, m.valueRight - m.contentRight,
      );
      const overZone = Math.max(m.zoneClipTop - m.chipTop, m.chipBottom - m.zoneClipBottom);
      const worst = Math.max(overV, overH, overZone);
      if (worst > 0.5) {
        bad.push(`${w}×${h} V=${overV.toFixed(1)} H=${overH.toFixed(1)} Z=${overZone.toFixed(1)} (${m.labelFont.toFixed(1)}/${m.valueFont.toFixed(1)} zone=${m.chipZoneH.toFixed(0)})`);
      }
    }
  }
  console.log(`[SWEEP-SA] ${n}개 조합 · 잘림 ${bad.length}건`);
  if (bad.length) console.log(`  🔴 ${bad.slice(0, 20).join('\n  ')}`);
  expect(bad, `safe-area 주입 시 칩이 잘리는 창 비율이 있다(${bad.length}/${n})`).toEqual([]);
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
