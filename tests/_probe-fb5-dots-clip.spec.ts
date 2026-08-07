/**
 * FB-5 «도트 애니메이션 잘림» 실측 프로브 (레인 P · 2026-08-07).
 *
 * 제보는 9글자다 — *"도트 애니메이션 잘림"* (voice/complete, 10:45). 최소 두 갈래로 읽힌다:
 *   ① 도트 **격자가 영역을 넘쳐** 가장자리가 잘린다        → 격자 크기·배치
 *   ② 애니메이션 **동작 범위**가 `overflow:hidden`에 잘린다 → 모션 진폭·클리핑
 *
 * 🔴 **두 해석 모두 「클리핑하는 조상」을 전제한다.** 그래서 이 프로브는 처방을 고르기 전에
 * *무엇이 자르는가* 를 먼저 센다. 아무것도 자르지 않으면 ①②는 서술된 형태로 둘 다 불가이고,
 * 그건 목업을 만들 일이 아니라 전제를 반증해 올릴 일이다.
 *
 * ## 재는 축
 *  A. **클리핑 조상 전량** — state-dots에서 위로 타며 overflow/clip-path/contain이
 *     visible/none이 아닌 노드와 그 rect. 자르는 놈이 없으면 이 목록이 빈다.
 *  B. **뷰포트 초과** — 격자·도트가 `innerHeight`(가시 영역) 밖으로 나가는가.
 *     레이아웃 뷰포트가 874로 남고 가시 영역만 513이면 **어떤 overflow 없이도** 잘린다.
 *  C. **도트 기하** — 레이아웃 박스(`offsetWidth/Height`)와 glow 반경. 🔴 `getBoundingClientRect`는
 *     `dot-breathe`의 `scale(0.86~1.12)`를 포함해 프레임마다 변한다 — 재현되는 수치가 아니다.
 *     피크는 레이아웃 박스 × 1.12로 **계산**한다.
 *
 * ## 두 경로로 402×513에 도달한다 — 이 갈림이 ①/②보다 먼저 답을 준다
 *  (A) 처음부터 402×513으로 boot
 *  (B) 402×874로 boot 후 513으로 축소 — **실기기 경로**(Safari 크롬이 874−513=361px를 먹는다)
 *  (B)에서만 재현되면 정적 기하 버그가 아니라 `useBandHeight`가 큰 `size`로 계산한
 *  `cell`이 남는 문제다(`height: min(gridHeight,100%)`만 눌리고 도트 지름은 안 따라온다).
 *
 * 🔴 `_` 접두라 기본 config에서 제외된다. 돌리는 법:
 *   npx playwright test tests/_probe-fb5-dots-clip.spec.ts --config=playwright.probe.config.ts --workers=1
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { boot, PHONE_402, fillAllRows } from './fixtures/activeZones';

test.setTimeout(180_000);

/** 🔴 민구 실기기 = 402×513. 874는 「축소 전」 출발점일 뿐이다. */
const REAL = { width: 402, height: 513 };

const OUT = path.join(process.cwd(), '_probe-out', 'fb5');

/** state-dots에서 조상을 타고 올라가며 자르는 노드·기하를 한 번에 덤프한다.
 *  🔴 `page.evaluate` 콜백 안에서 소스 상수를 import해 쓰지 않는다 — 직렬화가 안 된다.
 *     격자 치수는 DOM(gridTemplate)에서 읽는다. */
async function probe(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const dots = document.querySelector('[data-testid="state-dots"]') as HTMLElement | null;
    if (!dots) return { reached: false } as const;

    const clippers: Array<Record<string, unknown>> = [];
    for (let el: HTMLElement | null = dots; el; el = el.parentElement) {
      const s = getComputedStyle(el);
      const clips =
        s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible'
        || (s.clipPath && s.clipPath !== 'none')
        || (s.contain && s.contain !== 'none');
      if (!clips) continue;
      const r = el.getBoundingClientRect();
      clippers.push({
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute('data-testid') ?? '',
        cls: (el.className || '').toString().slice(0, 40),
        overflow: `${s.overflowX}/${s.overflowY}`,
        clipPath: s.clipPath,
        contain: s.contain,
        rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      });
    }

    const gridRect = dots.getBoundingClientRect();
    const gs = getComputedStyle(dots);
    const rows = gs.gridTemplateRows.split(' ').length;
    const cols = gs.gridTemplateColumns.split(' ').length;
    const rowPx = parseFloat(gs.gridTemplateRows.split(' ')[0] || '0');
    const colPx = parseFloat(gs.gridTemplateColumns.split(' ')[0] || '0');

    // 켜진 셀만 — complete(check)는 행 2~8·열 5~19만 켜므로 가장자리 셀은 애초에 꺼져 있다.
    const spans = Array.from(dots.querySelectorAll('span')) as HTMLElement[];
    const lit = spans.filter((el) => el.style.opacity !== '0' && getComputedStyle(el).opacity !== '0');

    let sample: Record<string, unknown> | null = null;
    if (lit[0]) {
      const el = lit[0];
      const cs = getComputedStyle(el);
      // 🔴 레이아웃 박스 — transform(scale)이 안 섞인다. 피크는 이 값 × 1.12로 계산한다.
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const blur = parseFloat((cs.boxShadow.match(/(\d+(?:\.\d+)?)px/g) || ['0'])[2] || '0');
      sample = {
        layoutW: w, layoutH: h,
        skew: h > 0 ? +(w / h).toFixed(3) : null,
        peakW: +(w * 1.12).toFixed(1),
        glowBlur: blur,
        // 피크 시 도트+glow가 차지하는 반경 vs 셀 반높이 — 셀 밖으로 얼마나 나가는가
        peakHalfWithGlow: +((h * 1.12) / 2 + blur).toFixed(1),
        cellHalfH: +(rowPx / 2).toFixed(1),
        cellHalfW: +(colPx / 2).toFixed(1),
      };
    }

    // 켜진 셀 전체의 시각적 외곽(레이아웃 기준) — 격자 상자를 넘는지, 뷰포트를 넘는지.
    let litBox: Record<string, number> | null = null;
    if (lit.length) {
      let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
      for (const el of lit) {
        const r = el.getBoundingClientRect();
        top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom);
        left = Math.min(left, r.left); right = Math.max(right, r.right);
      }
      litBox = {
        top: +top.toFixed(1), bottom: +bottom.toFixed(1),
        left: +left.toFixed(1), right: +right.toFixed(1),
      };
    }

    const vv = window.visualViewport;
    return {
      reached: true,
      glyph: dots.getAttribute('data-glyph'),
      mode: dots.getAttribute('data-mode'),
      grid: { rows, cols, rowPx: +rowPx.toFixed(2), colPx: +colPx.toFixed(2), cells: spans.length },
      gridRect: {
        x: +gridRect.x.toFixed(1), y: +gridRect.y.toFixed(1),
        w: +gridRect.width.toFixed(1), h: +gridRect.height.toFixed(1),
        bottom: +gridRect.bottom.toFixed(1),
      },
      litCount: lit.length,
      litBox,
      sample,
      clippers,
      viewport: {
        innerW: window.innerWidth, innerH: window.innerHeight,
        vvW: vv ? +vv.width.toFixed(1) : null, vvH: vv ? +vv.height.toFixed(1) : null,
        docH: document.documentElement.scrollHeight,
        bodyH: document.body.scrollHeight,
      },
    } as const;
  });
}

for (const route of ['A-직접boot-402x513', 'B-874boot후513축소'] as const) {
  test(`FB-5 실측 — complete·402×513 (${route})`, async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });

    if (route === 'A-직접boot-402x513') {
      await boot(page, REAL, { preserveAnimations: true });
    } else {
      await boot(page, PHONE_402, { preserveAnimations: true });
      await page.setViewportSize(REAL);
      await page.waitForTimeout(400); // ResizeObserver → useBandHeight 재측정 여유
    }

    await fillAllRows(page);
    const dots = page.locator('[data-testid="state-dots"]');

    // 🔴 도달 못 한 프로브의 「잘림 없음」은 무판정이지 음성 결과가 아니다. 먼저 단정한다.
    await expect(dots, 'complete = endReached → check 글리프').toHaveAttribute('data-glyph', 'check');
    await page.waitForTimeout(700); // hangover(400ms) 경과 후 정적 글리프 확정
    await expect(dots).toHaveAttribute('data-mode', 'glyph');

    const m = await probe(page);
    const file = path.join(OUT, `${route}.json`);
    fs.writeFileSync(file, JSON.stringify(m, null, 2));
    await page.screenshot({ path: path.join(OUT, `${route}.png`) });
    await dots.screenshot({ path: path.join(OUT, `${route}-dots.png`) });

    console.log(`\n===== ${route} =====\n${JSON.stringify(m, null, 2)}\n`);
  });
}
