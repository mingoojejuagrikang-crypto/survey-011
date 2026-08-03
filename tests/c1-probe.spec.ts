import { test } from '@playwright/test';
import { boot } from './fixtures/activeZones';

/** §C1 착수 판정용 임시 probe — 「칩존 여유 1.92px」의 대체 기준값을 실측한다.
 *
 *  🔴 왜 이 파일이 있나: `ui-standard.md:86`이 *"칩존 여유가 390×568에서 1.92px뿐"* 이라고
 *  적었지만 **산출식이 없다**(대안 B 기각 논의의 곁가지로 나온 값). A0-probe §7-3이
 *  *"원문에서 확정하라"* 고 했으나 원문에 확정할 근거 자체가 없다 → **실측으로 대체한다.**
 *
 *  A0-probe가 축 모호성을 명시했으므로 **두 축을 다 잰다**:
 *    가로 — 개별 칩의 잉크 여유(scrollWidth vs clientWidth)
 *    세로 — 칩존 트랙 여유(scrollHeight vs clientHeight) + 칩 콘텐츠가 실제로 쓰는 높이
 *
 *  단언하지 않는다. 숫자만 뽑는다(판정은 사람이 한다). */

const VIEWPORTS = [
  { name: '390x568', width: 390, height: 568 },
  { name: '402x874', width: 402, height: 874 },
  { name: '640x1024', width: 640, height: 1024 },
];

for (const vp of VIEWPORTS) {
  test(`[c1-probe] 현행 20% 칩존 여유 실측 @ ${vp.name}`, async ({ page }) => {
    await boot(page, { width: vp.width, height: vp.height });

    // 🔴 애니메이션을 정지시키고 잰다. `chip-pop`이 `transform: scale(1.16)`이고
    //    **transform된 자식은 scrollHeight에 반영된다** — 값 박스가 중앙 확대되며 위아래로
    //    삐져나와 「넘침 5px」로 잡힌다. 그건 팝 연출의 순간값이지 잘림이 아니다.
    //    (A0-probe §7-4의 `check-pop` 경합과 같은 계열: 애니메이션이 측정을 오염시킨다)
    await page.addStyleTag({
      content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
    });
    await page.waitForTimeout(120);

    const m = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="voice-active-state"]') as HTMLElement;
      const grid = root.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
      const gridR = grid.getBoundingClientRect();
      const chips = Array.from(
        grid.querySelectorAll('[data-testid="column-chip"]'),
      ) as HTMLElement[];

      // 칩 콘텐츠가 실제로 쓰는 세로 범위 — 칩들의 bounding box union.
      const tops = chips.map((c) => c.getBoundingClientRect().top);
      const bottoms = chips.map((c) => c.getBoundingClientRect().bottom);
      const inkTop = Math.min(...tops);
      const inkBottom = Math.max(...bottoms);

      // 3구역 pool — 층2 비율의 분모(zone-ratios 오라클과 같은 정의).
      const center = root.querySelector('[data-testid="voice-center-stage"]') as HTMLElement;
      const bottom = root.querySelector('[data-testid="voice-control-bar"]') as HTMLElement;
      const pool =
        gridR.height +
        center.getBoundingClientRect().height +
        bottom.getBoundingClientRect().height;

      const perChip = chips.map((c) => {
        const label = c.querySelector('[data-testid="column-chip-label"]') as HTMLElement | null;
        const value = Array.from(c.children).find((k) => k !== label) as HTMLElement | undefined;
        return {
          name: c.getAttribute('data-col-name') ?? '?',
          // 가로 축 — 음수면 여유, 양수면 넘침.
          chipOverflowW: c.scrollWidth - c.clientWidth,
          labelOverflowW: label ? label.scrollWidth - label.clientWidth : null,
          valueOverflowW: value ? value.scrollWidth - value.clientWidth : null,
          // 세로 축.
          chipOverflowH: c.scrollHeight - c.clientHeight,
          chipH: c.getBoundingClientRect().height,
          labelFont: label ? parseFloat(getComputedStyle(label).fontSize) : null,
          valueFont: value ? parseFloat(getComputedStyle(value).fontSize) : null,
        };
      });

      // 🔑 글리프가 라인박스를 얼마나 넘는지 — 폰트 계수 역산의 열쇠.
      const worst = chips.reduce((a, b) =>
        b.scrollHeight - b.clientHeight > a.scrollHeight - a.clientHeight ? b : a);
      const wLabel = worst.querySelector('[data-testid="column-chip-label"]') as HTMLElement;
      const wValue = Array.from(worst.children).find((k) => k !== wLabel) as HTMLElement;
      const rowBox = {
        chipClientH: worst.clientHeight,
        chipScrollH: worst.scrollHeight,
        labelBoxH: wLabel.getBoundingClientRect().height,
        labelFont: parseFloat(getComputedStyle(wLabel).fontSize),
        valueBoxH: wValue ? wValue.getBoundingClientRect().height : null,
        valueFont: wValue ? parseFloat(getComputedStyle(wValue).fontSize) : null,
        padTop: parseFloat(getComputedStyle(worst).paddingTop),
        borderTop: parseFloat(getComputedStyle(worst).borderTopWidth),
        // 🔑 grid 행이 실제로 어디에 놓였나 — 넘침의 발생 지점을 특정한다.
        kids: Array.from(worst.children).map((k) => {
          const kr = k.getBoundingClientRect();
          const wr = worst.getBoundingClientRect();
          return {
            tag: (k as HTMLElement).dataset.testid ?? k.tagName,
            top: +(kr.top - wr.top).toFixed(2),
            bottom: +(kr.bottom - wr.top).toFixed(2),
            h: +kr.height.toFixed(2),
            lh: getComputedStyle(k).lineHeight,
            fs: getComputedStyle(k).fontSize,
          };
        }),
        chipBoxH: +worst.getBoundingClientRect().height.toFixed(2),
      };

      return {
        rowBox,
        gridClientH: grid.clientHeight,
        gridScrollH: grid.scrollHeight,
        gridClientW: grid.clientWidth,
        gridScrollW: grid.scrollWidth,
        gridBoxH: gridR.height,
        inkHeight: inkBottom - inkTop,
        // 🔑 이게 「1.92px」의 대체 후보 — 칩존 트랙이 칩 잉크보다 얼마나 큰가.
        trackSlackPx: gridR.height - (inkBottom - inkTop),
        pool,
        chipRatio: gridR.height / pool,
        chipCount: chips.length,
        rows: new Set(tops.map((t) => Math.round(t))).size,
        perChip,
      };
    });

    console.log(`\n[c1-probe] ===== ${vp.name} =====`);
    console.log(
      `[c1-probe] grid  boxH=${m.gridBoxH.toFixed(2)} clientH=${m.gridClientH} scrollH=${m.gridScrollH} ` +
        `(세로넘침=${(m.gridScrollH - m.gridClientH).toFixed(2)}px)`,
    );
    console.log(
      `[c1-probe] grid  clientW=${m.gridClientW} scrollW=${m.gridScrollW} ` +
        `(가로넘침=${(m.gridScrollW - m.gridClientW).toFixed(2)}px)`,
    );
    console.log(
      `[c1-probe] 잉크  inkHeight=${m.inkHeight.toFixed(2)} → 🔑 trackSlack=${m.trackSlackPx.toFixed(2)}px ` +
        `(칩 ${m.chipCount}개 / ${m.rows}행)`,
    );
    console.log(
      `[c1-probe] 비율  pool=${m.pool.toFixed(2)} chipRatio=${m.chipRatio.toFixed(4)} ` +
        `→ 16%면 ${(m.pool * 0.16).toFixed(2)}px (현재 ${m.gridBoxH.toFixed(2)}px, ` +
        `${(m.gridBoxH - m.pool * 0.16).toFixed(2)}px 축소)`,
    );
    const worstW = m.perChip.reduce((a, b) => (b.chipOverflowW > a.chipOverflowW ? b : a));
    const worstH = m.perChip.reduce((a, b) => (b.chipOverflowH > a.chipOverflowH ? b : a));
    console.log(
      `[c1-probe] 칩최악 가로: ${worstW.name} +${worstW.chipOverflowW}px / ` +
        `세로: ${worstH.name} +${worstH.chipOverflowH}px`,
    );
    console.log(
      `[c1-probe] 칩폰트 label=${m.perChip[0].labelFont} value=${m.perChip[0].valueFont} ` +
        `chipH=${m.perChip[0].chipH.toFixed(2)}`,
    );
    const r = m.rowBox;
    console.log(
      `[c1-probe] 라인박스 label ${r.labelFont}px→box ${r.labelBoxH.toFixed(2)} (배율 ${(r.labelBoxH / r.labelFont).toFixed(4)}) | ` +
        `value ${r.valueFont}px→box ${(r.valueBoxH ?? 0).toFixed(2)} (배율 ${((r.valueBoxH ?? 0) / (r.valueFont || 1)).toFixed(4)})`,
    );
    console.log(
      `[c1-probe] 최악칩 boxH=${r.chipBoxH} clientH=${r.chipClientH} scrollH=${r.chipScrollH} ` +
        `kids=${JSON.stringify(r.kids)} ` +
        `pad=${r.padTop} border=${r.borderTop} | 두 박스 합=${(r.labelBoxH + (r.valueBoxH ?? 0)).toFixed(2)}`,
    );
    // 🔑 축을 분리해 센다 — 섞으면 가로(스크롤이 받는다)와 세로(진짜 잘림)가 한 숫자로 뭉갠다.
    const vOver = m.perChip.filter((c) => c.chipOverflowH > 0.5);
    const hOver = m.perChip.filter(
      (c) => c.chipOverflowW > 0.5 || (c.labelOverflowW ?? 0) > 0.5 || (c.valueOverflowW ?? 0) > 0.5,
    );
    console.log(
      `[c1-probe] 🔑 세로넘침(진짜 잘림) ${vOver.length}/${m.chipCount}개` +
        (vOver.length ? `: ${vOver.map((c) => `${c.name}+${c.chipOverflowH}`).join(', ')}` : ''),
    );
    console.log(
      `[c1-probe]    가로넘침(스크롤이 받음) ${hOver.length}/${m.chipCount}개` +
        (hOver.length ? `: ${hOver.map((c) => c.name).slice(0, 4).join(', ')}…` : ''),
    );
  });
}
