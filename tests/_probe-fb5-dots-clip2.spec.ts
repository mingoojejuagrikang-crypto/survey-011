/**
 * FB-5 실측 프로브 **2차** — 대조군과 「가장 넘치기 쉬운 상태」 (레인 P · 2026-08-07).
 *
 * 1차(`_probe-fb5-dots-clip.spec.ts`)가 402×513·complete에서 잰 것:
 *   도트 4px · glow blur 4px · 행 피치 5px · 열 피치 10.72px · 켜진 22셀이 격자·클리퍼·뷰포트
 *   **전부 안**에 들어감. → 브리핑의 ①격자 넘침 · ②overflow 잘림은 **이 상태에선 둘 다 반증**.
 *
 * 그래서 2차는 세 가지를 더 센다:
 *   ① **대조군 402×874·complete** — 설계 주석이 말하는 「도트 8.7px」가 실제로 나오는가.
 *      나온다면 513에서의 4px는 **화면 높이에 따라 도트가 반토막 나는 것**이 실체다.
 *   ② **402×513·idle/wave** — complete(check)는 행 2~8·열 5~19만 켜서 가장자리가 애초에
 *      비어 있다. 웨이브는 **행 0~9 전부**를 켜므로 격자 상단 넘침이 생긴다면 여기서 생긴다.
 *   ③ **밴드(live-listen-band) rect** — 격자가 밴드를 넘는지 직접 본다(1차는 안 쟀다).
 *
 * 🔴 1차에서 「402×513으로 **직접** boot」 경로는 `voice-start-button`이 disabled인 채로
 *    타임아웃했다 — **무판정이다**(§0-6). 실기기 경로는 874로 시작해 Safari 크롬이 먹는
 *    축소 경로라 이 프로브도 축소 경로만 쓴다.
 *
 * 돌리는 법:
 *   npx playwright test tests/_probe-fb5-dots-clip2.spec.ts --config=playwright.probe.config.ts --workers=1
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { boot, PHONE_402, fillAllRows, injectLevel } from './fixtures/activeZones';

test.setTimeout(180_000);

const REAL = { width: 402, height: 513 };
const OUT = path.join(process.cwd(), '_probe-out', 'fb5');

/** 격자·밴드·클리퍼·켜진 셀의 기하를 한 번에. 🔴 소스 상수를 evaluate로 넘기지 않는다(직렬화). */
async function probe(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const dots = document.querySelector('[data-testid="state-dots"]') as HTMLElement | null;
    const band = document.querySelector('[data-testid="live-listen-band"]') as HTMLElement | null;
    if (!dots) return { reached: false } as const;

    const rectOf = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        bottom: +r.bottom.toFixed(1), right: +r.right.toFixed(1),
      };
    };

    const gs = getComputedStyle(dots);
    const rowPx = parseFloat(gs.gridTemplateRows.split(' ')[0] || '0');
    const colPx = parseFloat(gs.gridTemplateColumns.split(' ')[0] || '0');

    const spans = Array.from(dots.querySelectorAll('span')) as HTMLElement[];
    const lit = spans.filter((el) => el.style.opacity !== '0' && getComputedStyle(el).opacity !== '0');

    // 켜진 셀의 행/열 범위 — 웨이브가 실제로 어느 행까지 쓰는지.
    const rowsUsed = new Set<number>();
    const colsUsed = new Set<number>();
    for (const el of lit) {
      const [r, c] = (el.getAttribute('data-cell') || '0,0').split(',').map(Number);
      rowsUsed.add(r); colsUsed.add(c);
    }

    let sample: Record<string, unknown> | null = null;
    if (lit[0]) {
      const el = lit[0];
      const cs = getComputedStyle(el);
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // computed 값(소수 유지) — offsetWidth는 정수 반올림이라 3.6px가 4로 보인다.
      const cw = parseFloat(cs.width);
      const ch = parseFloat(cs.height);
      const blur = parseFloat((cs.boxShadow.match(/(\d+(?:\.\d+)?)px/g) || ['0'])[2] || '0');
      sample = {
        layoutW: w, layoutH: h,
        computedW: +cw.toFixed(2), computedH: +ch.toFixed(2),
        skew: ch > 0 ? +(cw / ch).toFixed(3) : null,
        glowBlur: blur,
        // 피크(scale 1.12) 시 도트+glow의 반경 vs 셀 반치수 — 인접 셀을 얼마나 침범하는가
        peakHalfWithGlow: +((ch * 1.12) / 2 + blur).toFixed(2),
        cellHalfH: +(rowPx / 2).toFixed(2),
        cellHalfW: +(colPx / 2).toFixed(2),
        // 이웃 도트 사이의 빈 간격 — 획이 「끊겨」 보이는지의 직접 지표
        gapH: +(rowPx - ch).toFixed(2),
        gapW: +(colPx - cw).toFixed(2),
      };
    }

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

    const clippers: Array<Record<string, unknown>> = [];
    for (let el: HTMLElement | null = dots; el; el = el.parentElement) {
      const s = getComputedStyle(el);
      const clips =
        s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible'
        || (s.clipPath && s.clipPath !== 'none') || (s.contain && s.contain !== 'none');
      if (!clips) continue;
      clippers.push({
        testid: el.getAttribute('data-testid') ?? el.tagName.toLowerCase(),
        overflow: `${s.overflowX}/${s.overflowY}`,
        rect: rectOf(el),
      });
    }

    return {
      reached: true,
      glyph: dots.getAttribute('data-glyph'),
      mode: dots.getAttribute('data-mode'),
      grid: { rowPx: +rowPx.toFixed(2), colPx: +colPx.toFixed(2), cells: spans.length },
      gridRect: rectOf(dots),
      bandRect: rectOf(band),
      litCount: lit.length,
      rowsUsed: [...rowsUsed].sort((a, b) => a - b),
      colsUsed: { min: Math.min(...colsUsed), max: Math.max(...colsUsed) },
      litBox,
      sample,
      clippers,
      viewport: { innerW: window.innerWidth, innerH: window.innerHeight },
    } as const;
  });
}

async function dump(page: import('@playwright/test').Page, label: string) {
  fs.mkdirSync(OUT, { recursive: true });
  const m = await probe(page);
  fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(m, null, 2));
  await page.locator('[data-testid="state-dots"]').screenshot({ path: path.join(OUT, `${label}-dots.png`) });
  console.log(`\n===== ${label} =====\n${JSON.stringify(m, null, 2)}\n`);
  return m;
}

test('① 대조군 — 402×874·complete에서 도트가 몇 px인가', async ({ page }) => {
  await boot(page, PHONE_402, { preserveAnimations: true });
  await fillAllRows(page);
  const dots = page.locator('[data-testid="state-dots"]');
  await expect(dots).toHaveAttribute('data-glyph', 'check');
  await page.waitForTimeout(700);
  await dump(page, '874-complete');
});

test('② 402×513 — 웨이브/idle는 행 0~9를 전부 켠다. 여기서 넘치는가', async ({ page }) => {
  await boot(page, PHONE_402, { preserveAnimations: true });
  await page.setViewportSize(REAL);
  await page.waitForTimeout(400);

  const dots = page.locator('[data-testid="state-dots"]');
  // 무음 → idle 웨이브(§C5-①). mic 글리프는 F19로 렌더되지 않는다.
  await injectLevel(page, 0);
  await page.waitForTimeout(700);
  await dump(page, '513-idle');

  // 최대 진폭 — amps 상한 4 = 표시 10행 전부.
  await injectLevel(page, 1);
  await page.waitForTimeout(300);
  await dump(page, '513-wave');
});

test('④ 402×513·complete — 1차와 같은 상태를 새 출력 경로로 다시 남긴다(스크린샷용)', async ({ page }) => {
  await boot(page, PHONE_402, { preserveAnimations: true });
  await page.setViewportSize(REAL);
  await page.waitForTimeout(400);
  await fillAllRows(page);
  const dots = page.locator('[data-testid="state-dots"]');
  await expect(dots).toHaveAttribute('data-glyph', 'check');
  await page.waitForTimeout(700);
  await dump(page, '513-complete');
});

test('③ 대조군 — 402×874·idle (같은 상태의 큰 화면)', async ({ page }) => {
  await boot(page, PHONE_402, { preserveAnimations: true });
  await injectLevel(page, 0);
  await page.waitForTimeout(700);
  await dump(page, '874-idle');
});
