/**
 * v0.48.0 P1 오라클 — **완료 체크 글리프의 V 꼭짓점이 뾰족하게 만난다.**
 *
 * 제보(민구 08-10): *"마지막행 입력후 도트 애니메이션의 체크 표시가 여전히 잘려있음."*
 * 08-10 오후 확정: 잘려 보인 지점은 **두 선이 만나야 하는 하단 V 꼭짓점**이다.
 *
 * ## 🔴 이 파일이 필요한 이유 — 종전 오라클로는 이 결함을 **반증할 수 없었다**
 * `v0440-c5-dots`의 `[node]`는 비트맵이 **10행인지**와 **폭 ≤25인지**만 잰다. 옛 비트맵
 * (바닥 `#####` 5셀 수평 · r0·r1·r9 전부 빈 8행 압축)도 그 둘을 **통과한다.** 즉 형상을
 * 되돌려도 green이라 회귀 테스트가 아니었다. 여기서 **형상 자체**를 잰다.
 *
 * ## 재는 축
 *  ⓐ [node] 꼭짓점 — 마지막 표시 행(r9)의 켜진 셀이 **정확히 2개·연속**이고, 그 위 r8에서
 *     **좌우 두 덩어리로 갈라진다**(사이에 꺼진 셀이 있다 = V가 벌어진다).
 *  ⓑ [node] 종단 테이퍼 — 두 획 끝이 **1셀**이다. 2셀 수평 캡이면 「절단면」으로 읽힌다
 *     (probe-new4가 확정한 종전 기전).
 *  ⓒ [node] 발광 면적 중립 — 켜진 셀 **22개 그대로**. 형상만 바꾸고 잉크는 안 늘렸다는 계약
 *     (플랜 §3-D). 늘리는 변경이 들어오면 여기서 걸려 **민구 결정을 거치게** 된다.
 *  ⓓ DOM — 실제 완료 화면에서 켜진 셀이 **행 1~9**에 있고(꼭짓점이 r9까지 내려온다) 예약 4행은 **0셀**이다.
 *     비트맵이 화면까지 도달하는지 + `USABLE_ROWS` 계약이 깨지지 않았는지를 함께 본다.
 *
 * ## 🔴 안 재는 축
 *  - 야외 2~3m 판독성 — Playwright가 못 잰다(실기기 확인 계약, AGENTS.md §4).
 *  - 접힌 필과의 겹침 — `v0470-w6-complete-dot-pill.spec.ts` 소관. 이 파일은 형상만 본다.
 *  - FB-5(진행 중 가림) — 다른 축이다. 이 커밋이 그걸 대신하지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { boot, PHONE_402, fillAllRows } from './fixtures/activeZones';

test.setTimeout(180_000);

/** 표시 영역 행 수 — `StateDots.tsx`의 `USABLE_ROWS`와 같아야 한다. 제품 상수를 import하지
 *  않는 건 의도다(`v0460-g-dot-pill`과 같은 계약): 제품이 상수를 바꿔도 계약은 여기 남아야
 *  오라클이 신호를 낸다. */
const USABLE_ROWS = 10;

/** 소스에서 check 비트맵 원문을 읽는다(정적 검사기 패턴 — `v0440-c5-dots`의 [node]와 동형). */
function checkBitmap(): string[] {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/voice/StateDots.tsx'), 'utf-8');
  const block = source.match(/const GLYPHS[\s\S]*?^\};/m)?.[0] ?? '';
  const entry = block.match(/check: center\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
  return (entry.match(/'[.#]+'/g) ?? []).map((r) => r.slice(1, -1));
}

/** 한 행에서 켜진 셀을 **연속 덩어리**로 묶는다(획이 몇 갈래인지 세는 단위). */
function runs(row: string): Array<{ start: number; len: number }> {
  const out: Array<{ start: number; len: number }> = [];
  let i = 0;
  while (i < row.length) {
    if (row[i] === '#') {
      const start = i;
      while (i < row.length && row[i] === '#') i++;
      out.push({ start, len: i - start });
    } else i++;
  }
  return out;
}

test('[node] P1ⓐ — 마지막 표시 행이 2셀 꼭짓점이고 그 위에서 두 획이 갈라진다', () => {
  const bm = checkBitmap();
  expect(bm.length, 'check 비트맵은 10행(USABLE_ROWS)').toBe(USABLE_ROWS);

  const last = bm[USABLE_ROWS - 1];
  const lastRuns = runs(last);
  // 🔴 옛 비트맵은 r9가 통째로 비어 있었다(바닥이 r8의 `#####` 수평) — 여기서 red다.
  expect(lastRuns.length, `r9(마지막 표시 행)에 꼭짓점이 없다 — 실제: '${last}'`).toBe(1);
  expect(
    lastRuns[0].len,
    `꼭짓점은 2셀이다(획 폭 그대로 한 점에서 만난다). 실제 ${lastRuns[0].len}셀 — '${last}'`,
  ).toBe(2);

  const above = bm[USABLE_ROWS - 2];
  const aboveRuns = runs(above);
  // 🔴 옛 비트맵의 r8은 `..#####........` 한 덩어리 5셀 = **평평한 바닥**이었다 — 여기서 red다.
  expect(
    aboveRuns.length,
    `꼭짓점 바로 위에서 두 획이 갈라져야 V가 된다(사이에 꺼진 셀). 실제 덩어리 `
    + `${aboveRuns.length}개 — '${above}'`,
  ).toBe(2);
  // 갈라진 두 덩어리가 꼭짓점을 사이에 두고 좌우로 놓인다.
  expect(aboveRuns[0].start, 'r8 왼쪽 획이 꼭짓점보다 왼쪽에서 시작한다')
    .toBeLessThan(lastRuns[0].start + lastRuns[0].len);
  expect(aboveRuns[1].start, 'r8 오른쪽 획이 꼭짓점보다 오른쪽에서 시작한다')
    .toBeGreaterThanOrEqual(lastRuns[0].start + lastRuns[0].len);
});

test('[node] P1ⓑ — 두 획의 끝이 1셀 테이퍼다(2셀 수평 절단면 금지)', () => {
  const bm = checkBitmap();
  // 긴 획(우상단) 종단 = 켜진 셀이 있는 **최상단 행**.
  const topIdx = bm.findIndex((r) => r.includes('#'));
  expect(topIdx, '켜진 행이 하나도 없다').toBeGreaterThanOrEqual(0);
  const topRuns = runs(bm[topIdx]);
  expect(topRuns.length, `최상단 행은 긴 획 하나만 있다 — '${bm[topIdx]}'`).toBe(1);
  // 🔴 옛 비트맵의 최상단은 `............##.` = 2셀 수평 캡이었다 — 여기서 red다.
  expect(
    topRuns[0].len,
    `긴 획 종단이 ${topRuns[0].len}셀이다. 2셀이면 획 방향과 어긋난 **수평 절단면**이 되어 `
    + `「잘렸다」로 읽힌다(probe-new4 확정 기전) — '${bm[topIdx]}'`,
  ).toBe(1);

  // 짧은 획(좌상단) 종단 — 왼쪽 획이 처음 등장하는 행의 첫 덩어리가 1셀이다.
  const shortStartIdx = bm.findIndex((r) => runs(r).length === 2);
  expect(shortStartIdx, '두 획이 함께 있는 행이 없다').toBeGreaterThanOrEqual(0);
  expect(
    runs(bm[shortStartIdx])[0].len,
    `짧은 획 종단도 1셀 테이퍼다 — '${bm[shortStartIdx]}'`,
  ).toBe(1);
});

test('[node] P1ⓒ — 형상만 바꿨다: 켜진 셀 22개(발광 면적 중립)', () => {
  const bm = checkBitmap();
  const lit = bm.join('').split('').filter((c) => c === '#').length;
  // 🔴 플랜 §3-D 발광 면적 중립. 종전 22셀(6.29%)과 **같은 값**이라 이 변경엔 정당 파손이 없다.
  //    늘리는 변경이 오면 여기서 걸리고, 그때는 민구 결정(발광 계약 재해석)이 먼저다.
  //    실제로 이 단언이 P1 구현 중 **첫 시안을 잡았다**(r0까지 쓴 시안 = 26셀 7.4%).
  expect(lit, `check 켜진 셀 ${lit}개 — 22를 벗어나면 발광 면적 계약을 건드린 것이다`).toBe(22);
  for (const row of bm) expect(row.length, `행 폭 ≤ 25 (격자 열 수)`).toBeLessThanOrEqual(25);
});

test('P1ⓓ — 완료 화면 실렌더: 꼭짓점이 r9까지 내려오고 예약 4행은 0셀', async ({ page }) => {
  await boot(page, PHONE_402);
  // 🔴 민구 실기기 앱 뷰포트는 402×812다(screen 874 − Safari 크롬 62 · probe-new4 실측).
  await page.setViewportSize({ width: 402, height: 812 });
  await page.waitForTimeout(500); // ResizeObserver → useBandHeight 재측정
  await fillAllRows(page);
  const dots = page.locator('[data-testid="state-dots"]');
  await expect(dots, 'complete = endReached → check 글리프. 다르면 상태 미도달(무판정)')
    .toHaveAttribute('data-glyph', 'check', { timeout: 10_000 });
  await page.waitForTimeout(700); // hangover(400ms) 경과 → 정적 글리프 확정

  const m = await dots.evaluate((el) => {
    const litRows = new Set<number>();
    const reserved: string[] = [];
    let litCount = 0;
    for (const cell of Array.from(el.querySelectorAll('span'))) {
      // §C4 mono 점멸이 켜진 셀 opacity를 흔든다. 꺼진 셀은 0 고정([UI-DOT-GHOST-1]).
      if (parseFloat(getComputedStyle(cell).opacity) <= 0.3) continue;
      litCount++;
      const id = cell.getAttribute('data-cell') ?? '0,0';
      const r = Number(id.split(',')[0]);
      litRows.add(r);
      if (r >= 10) reserved.push(id);
    }
    return { litCount, rows: [...litRows].sort((a, b) => a - b), reserved };
  });

  expect(m.litCount, 'check는 22셀을 켠다 — 0이면 상태 미도달(무판정)').toBe(22);
  // 🔴 옛 비트맵은 행 2~8(7행)만 켰고 **바닥이 r8**이었다 — 여기서 red다.
  //    r9(표시 영역 마지막 행)가 켜지는 것이 「꼭짓점이 격자 바닥까지 내려왔다」의 실렌더 증거다.
  expect(m.rows, `켜진 행이 1~9여야 한다(잉크가 표시 영역 세로를 쓴다). 실제 ${m.rows}`)
    .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // `USABLE_ROWS` 계약 — 하단 4행은 접힌 필 자리라 어떤 상태에서도 켜지지 않는다.
  expect(m.reserved, `하단 예약 4행이 켜졌다: ${m.reserved.join(' ')}`).toEqual([]);
});
