/**
 * FB-5 — **가림이 시작되는 임계 화면 높이** 스윕 (레인 P · 2026-08-07).
 *
 * 처방(「필이 양보」)은 *"짧은 화면에서 접힌 필을 숨긴다"* 인데, **「짧은」의 경계를 숫자로
 * 몰라서** 구현할 수 없다. 계산상으로는
 *   `RESERVED_ROWS(4) × floor(밴드높이 / FIELD_ROWS(14)) < 필높이(42)` → 밴드 ≈ **147px**
 * 이지만 이건 **세어진 숫자가 아니다**(§0-1). 실제로 어디서 갈리는지 스윕한다.
 *
 * ## 방법
 * 402 폭 고정 · 높이만 바꾼다. `boot`은 **한 번만**(874) 하고 이후 `setViewportSize`로
 * 축소한다 — 실기기 경로(Safari 크롬이 뷰포트를 먹는다)와 같고, 매번 boot하면 부하 flake로
 * 스윕이 통째로 무판정이 된다.
 *
 * ## 재는 것
 * 밴드 높이 · 행 피치 · 예약 픽셀(`4 × 행피치`) · 필 높이 · **겹친 켜진 셀 수**.
 * idle 웨이브로 잰다 — 행 0~9를 넓게 켜서 `check`(행 2~8)보다 **먼저** 겹침이 드러난다.
 *
 * 🔴 이 프로브는 처방을 고르지 않는다. 임계를 **관측**할 뿐이다.
 *
 * 돌리는 법:
 *   npx playwright test tests/_probe-fb5-threshold.spec.ts --config=playwright.probe.config.ts --workers=1
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { boot, PHONE_402, injectLevel } from './fixtures/activeZones';

test.setTimeout(180_000);

const OUT = path.join(process.cwd(), '_probe-out', 'fb5');

/** 402 폭 고정. 874(설계 기준) → 513(민구 실기기) 사이를 훑고 아래로 조금 더 본다. */
const HEIGHTS = [874, 812, 760, 700, 667, 640, 600, 568, 540, 513, 480];

/** 🔴 evaluate 문자열 안에서 모듈 스코프 헬퍼를 부르지 않는다(직렬화 함정). 상수는 인라인. */
const MEASURE = `(() => {
  const pill = document.querySelector('[data-testid="input-control-toggle"]');
  const grid = document.querySelector('[data-testid="state-dots"]');
  const band = document.querySelector('[data-testid="live-listen-band"]');
  if (!grid) return { err: 'no state-dots' };
  const p = pill ? pill.getBoundingClientRect() : null;
  const pillVisible = !!p && p.width > 0 && p.height > 0;
  const rowPx = parseFloat(getComputedStyle(grid).gridTemplateRows.split(' ')[0] || '0');
  let overlap = 0, lit = 0;
  for (const el of Array.from(grid.querySelectorAll('span'))) {
    if (parseFloat(getComputedStyle(el).opacity) <= 0.3) continue;
    lit++;
    if (!pillVisible) continue;
    const r = el.getBoundingClientRect();
    if (Math.min(r.right, p.right) - Math.max(r.left, p.left) > 0
      && Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top) > 0) overlap++;
  }
  return {
    bandH: band ? +band.getBoundingClientRect().height.toFixed(1) : null,
    rowPx: +rowPx.toFixed(2),
    reservedPx: +(rowPx * 4).toFixed(1),   // RESERVED_ROWS = FIELD_ROWS(14) - USABLE_ROWS(10)
    pillH: p ? +p.height.toFixed(1) : null,
    pillVisible, lit, overlap,
    mode: grid.getAttribute('data-mode'),
  };
})()`;

test('FB-5 임계 스윕 — 402폭·높이 874→480에서 가림이 언제 시작되나', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await boot(page, PHONE_402);
  await injectLevel(page, 0); // idle 웨이브 — 가장 넓게 켜진다

  const rows: Array<Record<string, unknown>> = [];
  for (const h of HEIGHTS) {
    await page.setViewportSize({ width: 402, height: h });
    await page.waitForTimeout(500); // ResizeObserver → useBandHeight 재측정

    // idle은 위상이 흐른다 — 여러 프레임의 **최대** 겹침을 쓴다(단발 프레임은 「그 순간
    // 안 겹쳤다」를 0으로 만든다).
    let worst = { overlap: -1 } as Record<string, number | boolean | string | null>;
    for (let i = 0; i < 6; i++) {
      const m = (await page.evaluate(MEASURE)) as Record<string, number>;
      if ((m.overlap ?? 0) > (worst.overlap as number)) worst = m;
      await page.waitForTimeout(60);
    }
    rows.push({ viewportH: h, ...worst });
    console.log(
      `[fb5:임계] h=${h} 밴드=${worst.bandH} 행피치=${worst.rowPx} `
      + `예약=${worst.reservedPx}px 필H=${worst.pillH} 켜짐=${worst.lit} **겹침=${worst.overlap}**`,
    );
  }

  fs.writeFileSync(path.join(OUT, 'threshold-sweep.json'), JSON.stringify(rows, null, 2));

  // 🔴 오라클이 아니라 계측이다. 다만 「전 높이에서 겹침 0」이면 스윕이 무의미하므로
  //    최소한 실기기 높이(513)에서는 겹쳐야 관측이 성립한다.
  const short = rows.find((r) => r.viewportH === 513);
  expect(short?.overlap, '402×513에서 겹침이 0이면 스윕 전제가 무너진 것 — 재조사').not.toBe(0);
});
