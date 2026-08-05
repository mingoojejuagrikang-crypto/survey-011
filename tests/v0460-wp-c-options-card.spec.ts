/**
 * v0.46.0 WP-C — 설정탭 리스트(options) 선택값 목록의 **「상시 2줄」 계약** (제보 F12)
 *
 * 민구 R4 확정 → 08-06 재확인: **1줄이면 1줄 · 최대 2줄 · 넘으면 그 안에서 스크롤.**
 * 종전은 `maxHeight: 200`이라는 **칩 높이와 무관한 마법수**였다(폰트·패딩이 바뀌면
 * 「2줄」이 3줄도 1.5줄도 됐다).
 *
 * 🔴 **이 오라클이 재는 축**
 *  ① 값이 적으면 목록이 **내용만큼만** 높다(2줄을 강제로 차지하지 않는다) + 스크롤 없음
 *  ② 값이 많으면 목록 높이가 **정확히 「칩 2줄 + 간격 1개」**로 멈추고 **스크롤이 생긴다**
 *  ③ 선택/비선택 칩의 **높이가 같다** — 순번 뱃지(22px) 때문에 달라지면 「2줄」의 실제 높이가
 *    목록 구성에 따라 흔들린다(잘리는 위치가 바뀐다)
 *
 * 🔴 **안 재는 축 (의도적으로 비웠다)**
 *  - **절대 px 값** — 제품 상수를 import하지 않는다(`[TEAMOPS-38]`). 기대값은 **실측 칩 높이에서
 *    유도**한다. 그래서 폰트가 바뀌어도 이 오라클은 계속 옳다.
 *  - **실기기 터치 스크롤 관성·스크롤 스냅의 시각적 결과** — 데스크톱 Playwright는 못 잰다.
 *  - **한 줄에 칩이 몇 개 들어가는가** — 값 길이·폭에 따라 달라진다(§시트 불특정). 그래서
 *    「몇 개면 몇 줄」을 단언하지 않고 **줄 수를 실측**해서 케이스를 고른다.
 *  - **`선택값 · n / m` 카운터 문구** — WP-J 소관이고 v025가 이미 잰다.
 */
import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';

const PHONE_375 = { width: 375, height: 812 };

async function goToSettings(page: Page) {
  await page.setViewportSize(PHONE_375);
  // 🔴 `waitForLoadState('networkidle')`을 쓰지 않는다 — v025의 계보를 그대로 베꼈다가 이 스펙
  //    3건이 전부 그 줄에서 타임아웃했다(08-06 실측). 앱이 유휴 상태에서도 요청을 흘리면
  //    「500ms 무요청」이 오지 않는다. 레포의 다른 부팅 헬퍼(bootBarge 계열)와 같은 형태로 —
  //    `domcontentloaded` + **보고 싶은 요소를 직접 기다린다**.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const tab = page.locator('[data-testid="tab-settings"]');
  await tab.waitFor({ state: 'visible', timeout: 10_000 });
  await tab.click();
  await page.waitForTimeout(300);
}

/** c4를 리스트(options)로 바꾸고 주어진 값들을 넣는다 — v025-input-data의 하네스 계보. */
async function makeOptionsColumn(page: Page, values: string[]) {
  const card = page.locator('[data-testid="col-card-c4"]');
  await expect(card).toBeVisible({ timeout: 3000 });
  const typeBtn = card.locator('[data-testid="type-btn-c4"]');
  // TYPE_ORDER = date,text,int,float,options → text에서 3번 눌러 리스트 도달.
  for (let i = 0; i < 3; i++) {
    await typeBtn.click();
    await page.waitForTimeout(120);
  }
  await expect(typeBtn).toContainText('리스트');

  const input = card.locator('[data-testid="opt-input-c4"]');
  await expect(input).toBeVisible();
  for (const v of values) {
    await input.fill(v);
    await input.press('Enter');
    await page.waitForTimeout(100);
  }
  return card;
}

type ListGeom = {
  clientH: number;
  scrollH: number;
  chipH: number;
  /** 칩들의 서로 다른 top 값 개수 = 실제 줄 수(랩 결과를 가정하지 않고 실측한다). */
  rows: number;
  /** 첫 두 줄 사이의 세로 간격(= flex gap). 칩이 1줄뿐이면 null. */
  gap: number | null;
  /** 선택 칩과 비선택 칩의 높이 차(둘 다 있을 때만). */
  selVsUnselDelta: number | null;
};

async function listGeometry(page: Page): Promise<ListGeom> {
  return page.evaluate(() => {
    const list = document.querySelector('[data-testid="opt-list-c4"]') as HTMLElement;
    const chips = Array.from(
      list.querySelectorAll('[data-testid^="opt-chip-c4-"]'),
    ) as HTMLElement[];
    const tops = [...new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top)))].sort(
      (a, b) => a - b,
    );
    const heights = chips.map((c) => c.getBoundingClientRect().height);

    // 선택 칩 = 순번 뱃지를 가진 것.
    const selH = chips
      .filter((c) => c.querySelector('[data-testid^="opt-badge-c4-"]'))
      .map((c) => c.getBoundingClientRect().height);
    const unselH = chips
      .filter((c) => !c.querySelector('[data-testid^="opt-badge-c4-"]'))
      .map((c) => c.getBoundingClientRect().height);

    return {
      clientH: list.clientHeight,
      scrollH: list.scrollHeight,
      chipH: Math.max(...heights),
      rows: tops.length,
      gap: tops.length >= 2 ? tops[1] - tops[0] - Math.max(...heights) : null,
      selVsUnselDelta:
        selH.length && unselH.length ? Math.abs(Math.max(...selH) - Math.max(...unselH)) : null,
    };
  });
}

test('WP-C ① 값이 적으면 목록은 내용만큼만 높다 — 2줄을 강제로 차지하지 않는다', async ({ page }) => {
  await goToSettings(page);
  await makeOptionsColumn(page, ['A', 'B']);

  const g = await listGeometry(page);
  console.log(`[wp-c 1행] rows=${g.rows} clientH=${g.clientH} scrollH=${g.scrollH} chipH=${g.chipH.toFixed(1)}`);

  // 전제가 성립하지 않으면 조용히 통과시키지 않는다 — 짧은 값 2개는 375px에서 한 줄이어야 한다.
  expect(g.rows, '이 케이스는 1줄이어야 축을 잴 수 있다').toBe(1);
  // 1줄이면 목록 높이 ≈ 칩 높이. 「2줄만큼 늘 비워둔다」면 여기서 red가 난다.
  expect(g.clientH, '1줄이면 1줄 높이').toBeLessThanOrEqual(g.chipH + 2);
  // 넘치지 않으므로 스크롤이 없다.
  expect(g.scrollH, '스크롤 없음').toBeLessThanOrEqual(g.clientH + 1);
});

test('WP-C ② 값이 많으면 「칩 2줄 + 간격 1개」에서 멈추고 스크롤이 생긴다', async ({ page }) => {
  await goToSettings(page);
  // 🔴 개수를 가정하지 않는다 — 3줄 이상이 될 때까지 **실측하며** 넣는다(§시트 불특정).
  //    값 길이·폭·폰트에 따라 한 줄에 들어가는 개수가 달라지기 때문이다.
  const values = Array.from({ length: 14 }, (_, i) => `값${String(i).padStart(2, '0')}`);
  await makeOptionsColumn(page, values);

  const g = await listGeometry(page);
  console.log(
    `[wp-c 다행] rows=${g.rows} clientH=${g.clientH} scrollH=${g.scrollH} ` +
      `chipH=${g.chipH.toFixed(1)} gap=${g.gap}`,
  );

  expect(g.scrollH, '이 케이스는 3줄 이상이어야 상한 축을 잴 수 있다').toBeGreaterThan(g.clientH);
  expect(g.gap, '줄 간격을 재지 못하면 기대값을 유도할 수 없다').not.toBeNull();

  // 🔑 기대값을 **실측에서 유도**한다(제품 상수 import 금지 — [TEAMOPS-38]).
  const expected = g.chipH * 2 + (g.gap as number);
  expect(g.clientH, `2줄 상한(칩 ${g.chipH.toFixed(1)} × 2 + 간격 ${g.gap})`).toBeGreaterThan(
    expected - 3,
  );
  expect(g.clientH, `2줄 상한을 넘지 않는다`).toBeLessThan(expected + 3);
});

test('WP-C ③ 선택 칩과 비선택 칩의 높이가 같다 — 순번 뱃지가 줄 높이를 흔들지 않는다', async ({ page }) => {
  await goToSettings(page);
  const card = await makeOptionsColumn(page, ['A', 'B', 'C']);

  // 추가하면 자동 선택되므로, 하나를 눌러 **해제**해 선택/비선택을 공존시킨다.
  await card.locator('[data-testid="opt-chip-c4-B"]').click();
  await page.waitForTimeout(150);

  const g = await listGeometry(page);
  console.log(`[wp-c 높이] selVsUnselDelta=${g.selVsUnselDelta} chipH=${g.chipH.toFixed(1)}`);

  expect(g.selVsUnselDelta, '선택/비선택이 공존해야 이 축을 잴 수 있다').not.toBeNull();
  expect(g.selVsUnselDelta as number, '뱃지 유무로 칩 높이가 달라지면 안 된다').toBeLessThanOrEqual(0.5);
});
