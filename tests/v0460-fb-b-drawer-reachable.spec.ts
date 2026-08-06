/** v0.46.0 **FB-B**(민구 제보 08-06 *"서랍에서 칩 자동 스크롤 속도 조절할 수 있는 메뉴가 없다"*)
 *  — **펼친 서랍의 마지막 항목에 실제로 닿는가.**
 *
 *  ## 🔴🔴 왜 기존 오라클이 이걸 놓쳤나 — 이 파일의 존재 이유
 *  `v046-chip-sweep.spec.ts` ⑦은 `await expect(stepper-chip-sweep).toBeVisible()`로 green이었다.
 *  **그런데 실기기에서 민구 눈에 안 보였고 누를 수도 없었다.**
 *  🔑 **Playwright의 `toBeVisible()`은 가림(occlusion)을 판정하지 않는다** —
 *  `display`/`visibility`/`opacity`/bbox 크기만 본다. **부모가 `overflow:hidden`으로 잘라내도,
 *  다른 요소가 위를 덮어도 「visible」이다.** `rowBottom <= viewportH`도 같은 한계다
 *  (`getBoundingClientRect`는 조상의 클리핑을 반영하지 않는다 — `gates/15` `[TEAMOPS-37]`이
 *  *"rect는 clip을 반영하지 않는다"* 로 이미 경고한 함정의 재발이다).
 *
 *  👉 **여기서는 `document.elementFromPoint`로 잰다.** 그 점에서 최상위로 잡히는 요소가
 *  자기 자신이어야 «닿는다»가 참이다. 이것이 「사용자가 보는 결과」로 재는 방식이다(`[TEAMOPS-47]`).
 *
 *  ## 무엇이 원인이었나 (실측)
 *  ```
 *  402×812: 패널 289px vs voice-control-bar 트랙 226px → overflow:hidden이 63px를 잘라냄
 *           컨트롤바 bottom(723) == 탭바 top(723)  ← 탭바 침범은 **없다**
 *  ```
 *  WP-D가 서랍 항목을 3→4개로 늘렸는데 트랙은 안 늘었다. 트랙 비율은 `heroLayout.ts` zone
 *  계약(WP-G 소유)이라 늘릴 수 없다 → 처방은 **트랙 안에서의 내부 스크롤**.
 *
 *  ## `[TEAMOPS-30]` 반증 — 이걸 지우면 red가 되나
 *  `ActiveControlSteppers`의 `input-control-scroll` 래퍼 또는 `ActiveControlBar`의
 *  `flex:'1 1 auto'` **둘 중 하나만 지워도** 축 ①이 red가 된다(수정 전 실측 `scrollH=289 > clientH=226`).
 *
 *  ## §시트 불특정
 *  칩 개수·항목명에 기대지 않는다. 재는 것은 **서랍 자신의 기하**뿐이다. */
import { test, expect } from '@playwright/test';
import { boot, SETTINGS } from './fixtures/activeZones';

/** 🔴 `height`는 **viewport**다(`window.innerHeight`), screen 높이가 아니다.
 *  민구 실기기 실측: `screenH=874`인데 standalone PWA의 `viewportH=**812**`
 *  (`font_render:…,w=402,h=812` · feedback device.json). 레포의 다른 스펙들이 402×874를
 *  쓰는데 그건 **screen** 값이라 실사용 높이보다 62px 후하다. 둘 다 잰다. */
const VIEWPORTS = [
  { width: 402, height: 812, label: '실기기 standalone' },
  { width: 402, height: 874, label: 'screen 높이(기존 스펙 값)' },
  { width: 375, height: 667, label: '최소 지원 규격' },
];

function settingsWithSweep(seconds: number) {
  return { ...SETTINGS, state: { ...SETTINGS.state, chipSweepSeconds: seconds } };
}

/** 요소 중앙점이 실제로 그 요소로 히트되는가 — 가림·클리핑을 함께 잡는 유일한 축.
 *
 *  🔴 **`top.contains(el)`(조상 히트)를 HIT로 세지 마라** — 08-06 콜드 리뷰 L3이 실측으로 잡았다.
 *  `elementFromPoint`가 **el이 아니라 el의 조상**을 돌려주는 것은 *"그 지점에서 el에 닿지 않는다"* 는
 *  뜻이다: el이 조상의 `overflow:hidden`에 잘렸거나, 다른 요소에 덮였거나, `pointer-events`가 없다.
 *  종전 판정식은 그 세 경우를 **전부 통과**시켰고, 그래서 **FB-B가 없애려던 「조상 클리핑 실명」이
 *  이 오라클에 그대로 재도입돼 있었다**(667×375 실측: strict=false인데 loose=true —
 *  `elementFromPoint`가 `input-control-panel`을 돌려주는데 HIT로 읽혔다).
 *  🔑 `[TEAMOPS-86]`이 *"`toBeVisible()`은 가림을 판정하지 않는다"* 로 세운 정본이 바로 이 축이다.
 *  판정식을 느슨하게 만들면 그 정본이 무력해진다. **el 자신 또는 그 자손만 HIT다.** */
async function reachable(page: import('@playwright/test').Page, testId: string) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    if (!el) return { found: false, hit: false };
    const b = el.getBoundingClientRect();
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    // `el.contains(el)`은 true이므로 자기 자신도 이 한 조건에 포함된다(R1-9: 잉여 제거).
    return { found: true, hit: !!(top && el.contains(top)) };
  }, testId);
}

for (const vp of VIEWPORTS) {
  test(`서랍 마지막 항목에 닿는다 @ ${vp.width}×${vp.height} (${vp.label})`, async ({ page }) => {
    await boot(page, vp, { settings: settingsWithSweep(8), preserveAnimations: true });
    await page.locator('[data-testid="input-control-toggle"]').click();
    await page.waitForTimeout(300);

    // ① 🔴 배정 트랙을 넘지 않는다 — 넘으면 부모 overflow:hidden이 조용히 잘라낸다.
    const bar = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="voice-control-bar"]') as HTMLElement;
      return { scrollH: el.scrollHeight, clientH: el.clientHeight };
    });
    console.log(`drawer@${vp.width}x${vp.height}: bar scrollH=${bar.scrollH} clientH=${bar.clientH}`);
    expect(
      bar.scrollH,
      '컨트롤바가 배정 트랙을 넘으면 overflow:hidden이 서랍 항목을 잘라낸다(FB-B 원인)',
    ).toBeLessThanOrEqual(bar.clientH);

    // ② 넘치면 **스크롤로 닿을 수 있어야** 한다. 트랙이 넉넉하면 스크롤 자체가 불필요하다.
    const sc = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="input-control-scroll"]') as HTMLElement | null;
      if (!el) return null;
      el.scrollTop = el.scrollHeight; // 끝까지
      return { scrollable: el.scrollHeight > el.clientHeight };
    });
    expect(sc, '펼친 서랍에는 스크롤 컨테이너가 있다').not.toBeNull();
    await page.waitForTimeout(120);

    // ③ 🔴 핵심 — 마지막 항목과 그 조작 버튼이 **실제로 히트된다**(toBeVisible로는 못 잡는 축).
    const row = await reachable(page, 'stepper-chip-sweep');
    const plus = await reachable(page, 'stepper-chip-sweep-plus');
    console.log(`  스크롤가능=${sc?.scrollable} 행히트=${row.hit} +버튼히트=${plus.hit}`);
    expect(row.found, '칩 왕복 행이 DOM에 있다').toBe(true);
    expect(row.hit, '칩 왕복 행 중앙점이 다른 요소에 가려지지 않는다').toBe(true);
    expect(plus.hit, '+ 버튼을 실제로 누를 수 있다').toBe(true);

    // ④ 배선 확인 — 닿을 뿐 아니라 값이 바뀐다(공허한 통과 방지).
    await page.locator('[data-testid="stepper-chip-sweep-plus"]').click();
    await expect(page.locator('[data-testid="voice-chip-grid"]')).toHaveAttribute('data-chip-sweep', '9');
  });
}

test('접힌 토글은 스크롤 컨테이너 밖이라 항상 닿는다(49px 계약 보호)', async ({ page }) => {
  // 🔴 heroLayout.ts:124가 접힌 토글 49px를 고정으로 쓴다(WP-G 소유 계약). FB-B 수정은
  //    **펼친 상태에만** flex 축을 건다 — 접힘에 걸면 그 계산이 흔들린다.
  await boot(page, { width: 375, height: 667 }, { settings: settingsWithSweep(8), preserveAnimations: true });
  const toggle = await reachable(page, 'input-control-toggle');
  expect(toggle.hit, '접힌 토글은 언제나 눌린다').toBe(true);
  const h = await page.locator('[data-testid="input-control-toggle"]').boundingBox();
  expect(h?.height, '접힌 토글 높이 계약 불변').toBeLessThanOrEqual(50);
  expect(await page.locator('[data-testid="input-control-scroll"]').count(), '접힘엔 스크롤러가 없다').toBe(0);
});
