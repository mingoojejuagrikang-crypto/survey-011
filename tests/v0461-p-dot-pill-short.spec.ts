/**
 * FB-5 «도트 애니메이션 잘림» 회귀 오라클 — **짧은 화면(402×513)의 필↔도트 겹침** (레인 P).
 *
 * ## 🔴 지금 red가 정상이다 — `@pending-fb5`
 * 수정은 BLOCKING이라 **소스를 안 고쳤다**(`_ASK-P.md` 참조). 이 스펙은 **결함을 고정**해
 * 두는 물건이다. 처방이 들어가면 태그를 떼고 green으로 승격한다.
 * ⚠️ **`test.fail()`을 쓰지 않는다** — 레포 관례(`v044-alarm-compare-fit.spec.ts` §19):
 * 그걸 쓰면 **어떤** 실패든 「예상된 실패」로 green이 되어 다른 이유의 red를 삼킨다.
 * 🟢 릴리스 게이트 9스펙(`package.json`)에 이 파일은 없다 — 게이트를 깨지 않는다.
 *
 * ## 무엇을 재는가
 * `v0460-g-dot-pill.spec.ts`와 **같은 계약**(접힌 조절판 필이 켜진 도트를 덮지 않는다)을
 * **다른 뷰포트**에서 잰다. 그 파일은 5개 테스트 전부 `PHONE_402`(402×874) 단일 뷰포트라
 * **짧은 화면 회귀를 구조적으로 못 잡는다.** 08-07 실측이 그 구멍으로 들어온 결함이다.
 *
 * ## 실측한 기제 (2026-08-07 · `_probe-out/fb5/`)
 * `RESERVED_ROWS`는 **행 수**(4)로 고정인데 **행 높이가 화면을 따라 변한다**:
 *   402×874 → 행 12px · 예약 48px · 필이 예약 자리에 정확히 앉는다(설계대로)
 *   402×513 → 행 **5px** · 예약 **20px** · 필이 표시 행을 덮는다 ← FB-5
 * 즉 **「N행 예약」이라는 처방이 화면 높이에 대해 성립하지 않는다.**
 *
 * ## 🔴 이건 「잘림」이 아니라 「가림」이다
 * 클리핑 조상 스윕 결과 `voice-control-bar`·`body`·`html` 셋뿐이고 **전부 여유가 있다.**
 * 켜진 셀은 어떤 상태(complete·idle·wave)에서도 격자·클리퍼·뷰포트를 넘지 않는다.
 * 불투명한 필이 **위에 그려지는** 것이지 무엇이 잘리는 게 아니다.
 *
 * 🔴 **402×513으로 직접 boot하지 않는다** — `voice-start-button`이 disabled인 채 타임아웃한다
 * (무판정, 원인 미조사). 실기기 경로는 874로 시작해 Safari 크롬이 361px를 먹는 축소 경로다.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, injectLevel, fillAllRows } from './fixtures/activeZones';

test.setTimeout(180_000);

/** 🔴 민구 실기기 = 402×513 (제보 9건 중 7건). */
const SHORT = { width: 402, height: 513 };

/** 표시 영역 행 수 — `StateDots.tsx`의 `USABLE_ROWS`와 같아야 한다. 제품 상수를 import하지
 *  않는 건 의도다(`v0460-g-dot-pill`과 같은 계약): **제품이 상수를 바꿔도 계약은 여기 남아야**
 *  오라클이 신호를 낸다. */
const USABLE_ROWS = 10;

/** 🔴 `page.evaluate` 문자열 안에서 모듈 스코프 헬퍼를 부르지 않는다 — 직렬화가 깨지면
 *  오라클이 **조용히 죽는다**(`fitGroup.ts` 함수 옆 주석이 SSOT인 그 계약과 같은 함정). */
const MEASURE = `(() => {
  const pill = document.querySelector('[data-testid="input-control-toggle"]');
  const grid = document.querySelector('[data-testid="state-dots"]');
  if (!grid) return { err: 'no state-dots' };
  const p = pill ? pill.getBoundingClientRect() : null;
  const pillVisible = !!p && p.width > 0 && p.height > 0;
  const g = grid.getBoundingClientRect();
  const rowPx = parseFloat(getComputedStyle(grid).gridTemplateRows.split(' ')[0] || '0');
  const overlapLit = [], reservedLit = [];
  let litCount = 0;
  for (const el of Array.from(grid.querySelectorAll('span'))) {
    // §C4 mono 점멸이 켜진 셀 opacity를 0.66~1로 흔든다. 꺼진 셀은 0 고정([UI-DOT-GHOST-1]).
    if (parseFloat(getComputedStyle(el).opacity) <= 0.3) continue;
    litCount++;
    const cellId = el.getAttribute('data-cell') || '0,0';
    if (Number(cellId.split(',')[0]) >= ${USABLE_ROWS}) reservedLit.push(cellId);
    if (!pillVisible) continue;
    const r = el.getBoundingClientRect();
    if (Math.min(r.right, p.right) - Math.max(r.left, p.left) > 0
      && Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top) > 0) {
      overlapLit.push(cellId);
    }
  }
  return {
    glyph: grid.getAttribute('data-glyph'), mode: grid.getAttribute('data-mode'),
    pillVisible, litCount, overlapLit, reservedLit,
    rowPx: +rowPx.toFixed(2),
    gridH: +g.height.toFixed(1),
    // 🔴 「행 수 예약」의 파탄을 재는 두 수 — 예약 픽셀 예산 vs 필이 실제로 먹는 높이.
    reservedPx: +(rowPx * (14 - ${USABLE_ROWS})).toFixed(1),
    pillH: p ? +p.height.toFixed(1) : null,
    pillTop: p ? +p.top.toFixed(1) : null,
    gridBottom: +g.bottom.toFixed(1),
  };
})()`;

type Snapshot = {
  glyph: string | null; mode: string | null; pillVisible: boolean; litCount: number;
  overlapLit: string[]; reservedLit: string[];
  rowPx: number; gridH: number; reservedPx: number;
  pillH: number | null; pillTop: number | null; gridBottom: number;
};

/** idle 웨이브·파형은 위상이 흐른다 — 단발 프레임 판정은 「그 순간 안 겹쳤다」를 green으로
 *  만든다. 여러 프레임의 **합집합**(누적 최대)을 쓴다. */
async function sample(page: Page, label: string, frames = 12) {
  const overlap = new Set<string>();
  const reserved = new Set<string>();
  let last = {} as Snapshot;
  for (let i = 0; i < frames; i++) {
    last = (await page.evaluate(MEASURE)) as Snapshot;
    for (const c of last.overlapLit ?? []) overlap.add(c);
    for (const c of last.reservedLit ?? []) reserved.add(c);
    await page.waitForTimeout(60);
  }
  const out = { ...last, overlap: [...overlap].sort(), reserved: [...reserved].sort() };
  console.log(
    `[fb5:${label}] glyph=${out.glyph} mode=${out.mode} lit=${out.litCount} `
    + `겹침=${out.overlap.length} 예약행켜짐=${out.reserved.length} | `
    + `행피치=${out.rowPx}px 격자H=${out.gridH} 예약예산=${out.reservedPx}px `
    + `필H=${out.pillH} 필top=${out.pillTop} 격자bottom=${out.gridBottom}`,
  );
  return out;
}

/** 실기기 도달 경로 — 874로 boot 후 축소. */
async function bootShort(page: Page) {
  await boot(page, PHONE_402);
  await page.setViewportSize(SHORT);
  await page.waitForTimeout(400); // ResizeObserver → useBandHeight 재측정
}

test('@pending-fb5 §FB-5 — 402×513·complete: 필이 체크 글리프를 덮지 않는다', async ({ page }) => {
  await bootShort(page);
  await fillAllRows(page);
  const dots = page.locator('[data-testid="state-dots"]');
  // 🔴 도달 못 한 프로브의 「겹침 없음」은 무판정이지 음성 결과가 아니다. 먼저 단정한다.
  await expect(dots, 'complete = endReached → check 글리프').toHaveAttribute('data-glyph', 'check');
  await page.waitForTimeout(700); // hangover(400ms) 경과 → 정적 글리프 확정

  const m = await sample(page, 'complete', 6); // 정적 글리프라 프레임 적게
  expect(m.litCount, 'check는 22셀을 켠다 — 0이면 상태 미도달(무판정)').toBeGreaterThan(0);
  expect(
    m.overlap,
    `필이 켜진 도트 ${m.overlap.length}셀을 덮는다(행피치 ${m.rowPx}px · 예약예산 `
    + `${m.reservedPx}px · 필H ${m.pillH}px). 「N행 예약」이 짧은 화면에서 성립하지 않는다`,
  ).toEqual([]);
});

test('@pending-fb5 §FB-5 — 402×513·idle 웨이브: 필이 켜진 도트를 덮지 않는다', async ({ page }) => {
  await bootShort(page);
  await injectLevel(page, 0);
  await page.waitForTimeout(700);
  const dots = page.locator('[data-testid="state-dots"]');
  await expect(dots, 'F19 — listening 무음은 idle 웨이브다').toHaveAttribute('data-mode', 'idle');

  const m = await sample(page, 'idle');
  expect(m.litCount, 'idle 웨이브는 켜진 셀이 있다 — 0이면 무판정').toBeGreaterThan(0);
  expect(m.overlap, `필이 켜진 도트 ${m.overlap.length}셀을 덮는다`).toEqual([]);
});

/** 🟢 이 케이스는 **green이어야 한다** — 같은 계약이 402×874에서는 지켜진다는 대조군이다.
 *  red면 뷰포트 축이 아니라 **더 넓은 회귀**이므로 진단이 통째로 달라진다. */
test('§FB-5 대조군 — 402×874에서는 필이 예약 행에만 앉는다(green이어야 한다)', async ({ page }) => {
  await boot(page, PHONE_402);
  await injectLevel(page, 0);
  await page.waitForTimeout(700);

  const m = await sample(page, '874-idle');
  expect(m.litCount, 'idle 웨이브 켜진 셀 — 0이면 무판정').toBeGreaterThan(0);
  expect(m.overlap, '402×874에서는 겹치지 않는다(WP-G 설계대로)').toEqual([]);
  expect(m.reserved, '예약 행(10~13)은 어떤 상태에서도 켜지지 않는다').toEqual([]);
});
