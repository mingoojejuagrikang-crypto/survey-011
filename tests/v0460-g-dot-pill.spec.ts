/**
 * §3-G(WP-G, v0.46.0) 오라클 — **접힌 조절판 필이 도트를 덮는가 · 하단 예약 행이 지켜지는가.**
 *
 * 🔴 왜 신설했나: 이 버그는 **기존 스위트가 전부 green인 채로 존재했다.**
 *    `v0440-zone-ratios.spec.ts` 층2b는 도트행이 pool의 24%인지(레이아웃 **비율**)만 잰다.
 *    §C5-b가 접힌 토글을 `position:absolute` 오버레이로 뺐으므로 **트랙을 안 먹는다** —
 *    비율은 완벽하고 겹침은 아무도 안 쟀다. `v0440-c5-dots.spec.ts`도 격자 치수만 쟀다.
 *    *"오라클이 무엇을 안 재는지 먼저 적는다"*(§C1)의 교과서 사례라서, 이 파일은 그 목록을
 *    맨 위에 둔다.
 *
 * ## 재는 축
 *  ① **하단 예약 행(행 10~13)이 어떤 경로로도 켜지지 않는다** — 상태 5종 전부.
 *     `glyphLit()`(비트맵)과 `litFromAmps()`(웨이브·파형)는 서로 다른 경로이고, **겹침 22셀 중
 *     20셀을 만든 건 후자였다.** 그래서 비트맵만 보는 정적 검사로는 이 계약을 못 지킨다.
 *  ② **접힌 필의 사각형과 「켜진」 도트 셀의 사각형이 교차하지 않는다** — 필이 실제로 뜨는
 *     상태(`mode==='nav'`): nav 무음(idle) · nav 발화(wave) · 완료(check).
 *     위상이 흐르는 모드는 **여러 프레임을 샘플링해 합집합**으로 판정한다(단발 프레임이면
 *     「그 순간 안 겹쳤다」가 green이 되어 flaky다).
 *  ③ 필이 뜨지 않는 상태(일시정지·이상치)에서 **필이 실제로 비가시**임을 확인 — ②의 커버리지가
 *     왜 nav뿐인지가 이 단언에 걸려 있다(가정이 조용히 뒤집히면 red).
 *
 * ## 🔴 안 재는 축 (다른 오라클 소관이거나, 기계로 못 재는 것)
 *  - **도트행 24% 비율** → `v0440-zone-ratios.spec.ts` 층2b. 이 스펙은 비율을 건드리지 않는다.
 *  - **격자 치수(25×14=350셀)·글리프 10행** → `v0440-c5-dots.spec.ts`.
 *  - **도트 원형·색·mono 점멸** → `v034-wave-glow.spec.ts` · `v0440-c4-mono.spec.ts`.
 *  - **미적 여백** — 사각형 교차만 잰다. 필이 도트 1px 아래 붙어 있어도 이 스펙은 통과한다.
 *    *"보기 싫다"* 는 축은 여전히 기계 밖이다(민구 눈). **이번 버그가 정확히 그 축이었다.**
 *  - **오탭 안전** — 필은 터치 대상, 도트는 아니다. hit-test는 §C5-b의 판단 근거이고 이 스펙의
 *    관심사가 아니다(겹쳐도 오탭 경로가 없다는 그 전제는 지금도 참이다).
 *  - **켜진 셀 비율(발광 면적 중립)** → `StateDots.tsx` GLYPHS 주석의 수치가 SSOT이고
 *    `v0440-c5-dots.spec.ts`의 [node] 검사가 행 수·폭만 지킨다. **비율 자체는 아무도 안 잰다** —
 *    글리프를 다시 그릴 때 사람이 세야 한다(WP-G 산출물 ②에 before/after가 있다).
 *  - **실기기 판독성** — 도트 지름이 몇 px부터 2~3m에서 안 보이는지는 Playwright가 못 잰다
 *    (CLAUDE.md 계약 4항: 실기기 확인 없이 "해결" 선언 금지). 🔴 **도트 8.7px는 미검증이다.**
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, injectLevel, triggerAnomaly, fillAllRows } from './fixtures/activeZones';

test.setTimeout(180_000);

/** 표시 영역 행 수 — `StateDots.tsx`의 `USABLE_ROWS`와 같아야 한다. 이 스펙이 제품 상수를
 *  import하지 않는 건 의도다: **제품이 상수를 바꿔도 계약은 여기 남아야** 오라클이 신호를 낸다. */
const USABLE_ROWS = 10;

const MEASURE = `(() => {
  const pill = document.querySelector('[data-testid="input-control-toggle"]');
  const grid = document.querySelector('[data-testid="state-dots"]');
  if (!grid) return { err: 'no state-dots' };
  const p = pill ? pill.getBoundingClientRect() : null;
  const pillVisible = !!p && p.width > 0 && p.height > 0;
  const overlapLit = [], reservedLit = [];
  let litCount = 0;
  for (const el of Array.from(grid.querySelectorAll('span'))) {
    // §C4 mono 점멸이 켜진 셀 opacity를 0.66~1 사이로 흔든다. 꺼진 셀은 0 고정
    // ([UI-DOT-GHOST-1] 계약)이라 0.3이 안전한 경계다.
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
  };
})()`;

type Snapshot = {
  glyph: string | null; mode: string | null;
  pillVisible: boolean; litCount: number; overlapLit: string[]; reservedLit: string[];
};

/** idle 웨이브·파형은 위상이 흐른다 — 단발 프레임으로 판정하면 「그 순간 안 겹쳤다」가 green이
 *  된다. 여러 프레임의 **합집합**을 쓴다(누적 최대). */
async function sample(page: Page, label: string, frames = 12) {
  const overlap = new Set<string>();
  const reserved = new Set<string>();
  let last: Snapshot = {
    glyph: null, mode: null, pillVisible: false, litCount: 0, overlapLit: [], reservedLit: [],
  };
  for (let i = 0; i < frames; i++) {
    last = await page.evaluate(MEASURE) as Snapshot;
    for (const c of last.overlapLit) overlap.add(c);
    for (const c of last.reservedLit) reserved.add(c);
    await page.waitForTimeout(60);
  }
  const out = {
    overlap: [...overlap].sort(), reserved: [...reserved].sort(),
    pillVisible: last.pillVisible, glyph: last.glyph, mode: last.mode, litCount: last.litCount,
  };
  console.log(`[dot-pill:${label}] glyph=${out.glyph} mode=${out.mode} pill=${out.pillVisible} lit=${out.litCount} 겹침=${out.overlap.length} 예약행켜짐=${out.reserved.length} ${JSON.stringify(out.overlap)}`);
  return out;
}

test('§3-G — nav 무음(idle 웨이브): 필이 켜진 도트를 덮지 않고 예약 행도 비어 있다', async ({ page }) => {
  await boot(page, PHONE_402);
  await injectLevel(page, 0);
  await page.waitForTimeout(700); // hangover(400ms) 경과 → idle 확정
  const r = await sample(page, 'nav-idle');
  expect(r.pillVisible, 'nav 모드에서 접힌 필이 실제로 떠 있다(②의 전제)').toBe(true);
  expect(r.mode, '무음은 idle 웨이브').toBe('idle');
  expect(r.reserved, '① idle 웨이브가 예약 행(10~13)을 켜지 않는다').toEqual([]);
  expect(r.overlap, '② idle 웨이브의 켜진 셀이 필 사각형과 겹치지 않는다').toEqual([]);
});

test('§3-G — nav 발화(파형): 필이 켜진 도트를 덮지 않고 예약 행도 비어 있다', async ({ page }) => {
  await boot(page, PHONE_402);
  await injectLevel(page, 0.9);
  await page.waitForTimeout(250);
  const r = await sample(page, 'nav-wave');
  expect(r.pillVisible, 'nav 모드에서 접힌 필이 실제로 떠 있다').toBe(true);
  expect(r.mode, '발화는 파형').toBe('wave');
  // 🔴 진폭 상한 4가 예약 행을 넘지 못한다는 계약이 여기 걸린다(litFromAmps의 mid는
  //    USABLE_ROWS 기준 4.5). 상한을 올리거나 mid를 FIELD_ROWS 기준으로 되돌리면 red다.
  expect(r.reserved, '① 파형이 최대 진폭에서도 예약 행(10~13)을 켜지 않는다').toEqual([]);
  expect(r.overlap, '② 파형의 켜진 셀이 필 사각형과 겹치지 않는다').toEqual([]);
});

/** 🔴 v0.47.0 W6 **정당 파손** — 종전 이 케이스는 *"완료는 edgeMode가 nav라 필이 뜬다"* 를
 *  전제로 `pillVisible === true`를 단언했다. 민구 확정(08-08, T-6=FB-G②)으로 **완료 상태에서는
 *  접힌 필을 숨긴다** — 402×513에서 행피치가 5px로 무너져 예약 20px < 필 42px이 되고, 격자가
 *  세로 중앙정렬이라 **글리프 축소로는 겹침을 없앨 수 없다**(그쪽 스펙 헤더에 산술).
 *  전제가 바뀌었으므로 기대값을 뒤집는다. ①(예약 행) 축은 그대로 유효하다.
 *  👉 완료 케이스의 **본 오라클은 `tests/v0470-w6-complete-dot-pill.spec.ts`로 옮겼다**
 *     (두 뷰포트 + 복귀 + 기능 생존). 여기는 «이 파일의 ② 커버리지가 왜 nav 2종만인가»의
 *     근거로 남는다 — ③(일시정지·이상치)과 같은 역할이다. */
test('§3-G — 완료(check 글리프): 필이 애초에 뜨지 않는다(W6 — ②가 nav 2종만 보는 근거)', async ({ page }) => {
  await boot(page, PHONE_402);
  await fillAllRows(page);
  await page.waitForTimeout(500);
  const r = await sample(page, 'endReached', 4);
  expect(r.glyph, '완료 글리프는 check').toBe('check');
  expect(r.pillVisible, 'W6 — 완료 동안 접힌 필은 숨는다(민구 확정 08-08)').toBe(false);
  expect(r.reserved, '① check 글리프가 예약 행을 켜지 않는다').toEqual([]);
  expect(r.overlap, '② 필이 없으므로 겹칠 것도 없다(위 단언이 「왜 0인가」를 못박는다)').toEqual([]);
});

/** ③은 처방 전에도 green이었다 — ②의 커버리지가 nav뿐인 **이유**를 기계로 고정한다.
 *  `edgeMode`(ActiveState.tsx)가 바뀌어 paused/anomaly에서도 필이 뜨게 되면 여기서 red가 나고,
 *  그때 ②의 케이스를 늘려야 한다는 신호가 된다. ①(예약 행)은 이 두 상태에서도 잰다. */
test('§3-G — 일시정지: 필이 애초에 뜨지 않는다(②가 nav만 보는 근거) + 예약 행 유지', async ({ page }) => {
  await boot(page, PHONE_402);
  await page.locator('button[title="일시정지"]').click();
  await page.waitForTimeout(300);
  const paused = await sample(page, 'paused', 2);
  expect(paused.glyph, '일시정지 글리프').toBe('pause');
  expect(paused.pillVisible, 'paused에서 접힌 필은 display:none(ActiveControlBar §C5-b)').toBe(false);
  expect(paused.reserved, '① pause 글리프가 예약 행을 켜지 않는다').toEqual([]);
});

/** ⚠️ 이상치를 **일시정지와 같은 test에 두지 마라.** `일시정지 → 재시작 → fireStt` 순서로 묶으면
 *  `triggerAnomaly`가 `anomaly-alert`를 4s 안에 못 띄워 red다(2026-08-05 WP-G 실측).
 *  재시작 직후의 인식 파이프라인 상태가 원인으로 보이는데 **그건 이 스펙의 관심사가 아니다** —
 *  도트 계약을 재려다 다른 축의 함정을 밟는 것이라 케이스를 갈랐다(WP-G 산출물 ⑥에 기록). */
test('§3-G — 이상치: 필이 애초에 뜨지 않는다 + 예약 행 유지', async ({ page }) => {
  await boot(page, PHONE_402);
  await triggerAnomaly(page);
  await page.waitForTimeout(300);
  const anomaly = await sample(page, 'anomaly', 2);
  expect(anomaly.glyph, '이상치 글리프').toBe('alert');
  expect(anomaly.pillVisible, 'anomaly에서 접힌 필은 display:none').toBe(false);
  expect(anomaly.reserved, '① alert 글리프가 예약 행을 켜지 않는다').toEqual([]);
});
