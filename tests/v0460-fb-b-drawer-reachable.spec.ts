/** v0.46.0 **FB-B**(민구 제보 08-06 *"서랍에서 칩 자동 스크롤 속도 조절할 수 있는 메뉴가 없다"*)
 *  — **펼친 서랍의 마지막 항목에 실제로 닿는가.**
 *
 *  ## 🔴🔴 **이 스펙을 지우거나 되돌리려는 사람이 먼저 읽을 것** — 구 축은 위쪽 넘침을 **구조적으로 못 본다**
 *  FB-B의 판정축은 `bar.scrollHeight <= bar.clientHeight` 하나였다. 그 식은 서랍이 **아래로**
 *  넘치는 것만 잡는다 — `scrollHeight`가 재는 scrollable overflow 영역은 (LTR에서) **오른쪽·아래로만**
 *  확장되기 때문이다. FB-4로 서랍이 바닥에 붙어 **위로** 자라게 된 순간, 그 식은
 *  **FB-4가 완전히 회귀해도 계속 green을 준다.**
 *  👉 즉 *"구 오라클이 통과하니 괜찮다"* 는 **성립하지 않는다.** 그게 이 파일을 다시 쓴 이유다.
 *
 *  🔑 **한 회차에 서로 다른 두 레인이 같은 기전에 걸렸다**(08-07): 레인 V의 FB-11도
 *  `useFitGroup`의 높이 판정이 `scrollHeight`를 보는데 넘침이 위로 가서 판정이 통째로 죽었고,
 *  배율 3.6·폰트 463px까지 폭주했다. **`scrollHeight`로 「넘쳤나」를 재는 코드는 방향을 먼저 물어라.**
 *
 *  ## 🔴 v0.46.1 **FB-4로 계약이 바뀌었다** — 축 ①을 지운 게 아니라 **뒤집어 다시 세웠다**
 *  민구 제보 08-07: *"서랍 펼칠시 **스크롤 없이** 보이게 변경"* → 확정 답변 **「더 높게 펼쳐라」**.
 *  즉 FB-B가 세운 *"배정 트랙을 넘지 않는다"* 는 **더 이상 계약이 아니다** — 서랍은 이제
 *  **의도적으로 트랙을 넘는다.** 실측이 그 전환을 강제했다(`_probe-fb4-drawer-height.spec.ts`):
 *  펼친 서랍의 필요 높이 **239px(고정)** vs 배정 트랙 —
 *  `402×513 → 75px(부족 164)` · `402×812 → 176(63)` · `402×874 → 198(41)` · `375×667 → 127(112)`.
 *  **네 뷰포트 전부** 모자랐고, 내용 축소·재배치는 민구가 기각, 트랙 비율은 WP-G 계약이다.
 *
 *  👉 그래서 축 ①은 **방향이 있는 계약**으로 갱신됐다. 「넘지 마라」가 아니라:
 *   - ①-a **아래로는 절대 안 넘는다** — 넘으면 탭바를 덮는다(원래 `overflow:hidden`이 막던 것).
 *   - ①-b **위로는 칩존 앞에서 멈춘다** — 「칩 왕복」을 칩존을 **보면서** 맞춘다는 것이
 *     그 항목이 이 서랍에 있는 이유다(`ActiveControlSteppers`의 WP-D 주석 🔑).
 *     🔴 기하만 재지 않고 **칩존이 자기 자신으로 히트되는지**까지 본다 — 상한을 올리면
 *     이 단언이 red가 되어, 다음 사람이 그 이유를 모르고 덮는 것을 막는다.
 *   - ②-a **스크롤이 없다**(FB-4의 본질). ②-b 스크롤 컨테이너는 **fallback으로 남는다**.
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
 *  ## `[TEAMOPS-30]` 반증 — 이걸 지우면 red가 되나 (**v0.46.1 FB-4 기준으로 갱신**)
 *  🔴 **한 줄씩 되돌려 실제로 돌렸다**(08-07, `--workers=1` 단독):
 *  | 되돌린 한 줄 | 결과 |
 *  |---|---|
 *  | `ActiveControlSteppers` 패널 `flex:'0 0 auto'` → `'1 1 auto'` | 축 **②-a red** — `scrollH 239 > clientH 74` @402×513 |
 *  | `ActiveControlBar` 래퍼의 `justifyContent:'flex-end'` 제거 | 축 **①-a red** — `panelBottom 690.8 > barBottom 578` @375×667 |
 *  | `ActiveControlBar`의 `overflow: panelOpen ? 'visible' : 'hidden'` → `'hidden'` 고정 | 축 **③-b red** — `첫행히트=false` @402×513·375×667 (812·874는 트랙이 넉넉해 green) |
 *
 *  🔑 **세 번째가 이 스펙에 축 ③-b를 만들게 했다.** 반증을 실제로 돌려보니 `overflow`를 되돌려도
 *  **아무 축도 red가 되지 않았다** — 잘리는 쪽이 「마지막 항목」이 아니라 「첫 항목」으로
 *  뒤집혔는데 스펙은 여전히 마지막만 재고 있었다. *"이 그물이 무엇을 잡는가"* 를 물어서 찾은
 *  구멍이고, 반증을 **적기만** 했으면 통과했을 구멍이다.
 *  (구 FB-B 기준 반증 — `input-control-scroll` 래퍼 제거 시 `scrollH=289 > clientH=226` — 은
 *   계약이 바뀌어 더 이상 축 ①의 반증이 아니다. 그 래퍼는 이제 **넘칠 때의 fallback**이다.)
 *
 *  ## §시트 불특정
 *  칩 개수·항목명에 기대지 않는다. 재는 것은 **서랍 자신의 기하**뿐이다. */
import { test, expect } from '@playwright/test';
import { boot, SETTINGS } from './fixtures/activeZones';
import { chipSweepSecondsForLevel } from '../src/lib/chipSweep';

/** 🔴 `height`는 **viewport**다(`window.innerHeight`), screen 높이가 아니다.
 *  민구 실기기 실측: `screenH=874`인데 standalone PWA의 `viewportH=**812**`
 *  (`font_render:…,w=402,h=812` · feedback device.json). 레포의 다른 스펙들이 402×874를
 *  쓰는데 그건 **screen** 값이라 실사용 높이보다 62px 후하다. 둘 다 잰다. */
const VIEWPORTS = [
  /** 🔴 v0.46.1 FB-4 — **민구가 FB-4를 제보한 실기기 실측 조합**(08-07 브리핑 §3).
   *  기존 격자에 없었고, **부족분이 164px로 가장 컸다**(다른 뷰포트는 41~112px).
   *  ⚠️ 브리핑의 513과 이 파일이 아래에 기록한 standalone 812는 **서로 다른 수치다.**
   *     둘 중 어느 쪽이 어떤 상태(주소창 노출 / 회전 / 분할)인지는 **미확인** —
   *     그래서 **둘 다 잰다.** 좁은 쪽이 계약을 강제하므로 513이 실질 하한이다. */
  { width: 402, height: 513, label: '민구 실기기 실측(FB-4 제보 환경)' },
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
    // 🔴 v0.46.1 WP-4 — 눈금이 **단계 0~10**으로 바뀌었다(민구 확정 08-07). 종전 `8`(초)은
    //    이제 **눈금 밖**이라 가장 빠른 단계 10으로 스냅되고, 그러면 `+`가 정당하게 disabled가 돼
    //    이 스펙의 ④(값이 바뀐다)가 클릭 타임아웃으로 죽는다.
    //    👉 이 스펙의 본질은 **「마지막 항목에 닿고 조작된다」**이지 특정 초가 아니다.
    //       중간 단계에서 부팅해 `+` 여지를 남긴다.
    await boot(page, vp, {
      settings: settingsWithSweep(chipSweepSecondsForLevel(5)), preserveAnimations: true,
    });
    await page.locator('[data-testid="input-control-toggle"]').click();
    await page.waitForTimeout(300);

    // ① 🔴 v0.46.1 FB-4 — **방향이 있는 계약.** 아래로는 절대 안 넘고(탭바), 위로는 칩존 앞에서 멈춘다.
    const geo = await page.evaluate(() => {
      const r = (id: string) => {
        const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
        return el ? el.getBoundingClientRect() : null;
      };
      const panel = r('input-control-panel')!;
      const bar = r('voice-control-bar')!;
      const chip = r('voice-chip-grid')!;
      return {
        panelTop: +panel.top.toFixed(1), panelBottom: +panel.bottom.toFixed(1),
        panelH: +panel.height.toFixed(1),
        barBottom: +bar.bottom.toFixed(1), barH: +bar.height.toFixed(1),
        chipBottom: +chip.bottom.toFixed(1),
        vh: window.innerHeight,
      };
    });
    console.log(
      `drawer@${vp.width}x${vp.height}: panelH=${geo.panelH} (트랙 ${geo.barH}) ` +
      `panelTop=${geo.panelTop} chipBottom=${geo.chipBottom} 여유=${(geo.panelTop - geo.chipBottom).toFixed(1)}px ` +
      `panelBottom=${geo.panelBottom} barBottom=${geo.barBottom}`,
    );
    // ①-a 아래로 넘지 않는다 — 컨트롤바 bottom == 탭바 top이라 1px만 넘어도 탭바를 덮는다.
    expect(
      geo.panelBottom,
      '서랍이 아래로 넘치면 탭바를 덮는다(컨트롤바 bottom == 탭바 top). 넘침은 **위로만** 간다',
    ).toBeLessThanOrEqual(geo.barBottom + 0.5);
    // ①-b 위로는 칩존을 침범하지 않는다 — 「칩 왕복」은 칩존을 보면서 맞추는 값이다.
    expect(
      geo.panelTop,
      '서랍이 칩존을 덮으면 「칩 왕복」을 칩존을 보면서 맞춘다는 전제가 깨진다(WP-D 주석 🔑)',
    ).toBeGreaterThanOrEqual(geo.chipBottom);
    // ①-c 🔴 기하만으로는 부족하다 — 칩존이 **자기 자신으로 히트**되는지까지 본다.
    //     (`getBoundingClientRect`는 가림을 반영하지 않는다 — 이 파일 헤더의 `[TEAMOPS-86]`)
    const chipHit = await reachable(page, 'voice-chip-grid');
    expect(chipHit.hit, '서랍이 열려도 칩존은 가려지지 않는다').toBe(true);

    // ②-a 🔴 FB-4의 본질 — **스크롤이 없다.** 민구 원문: *"서랍 펼칠시 스크롤 없이 보이게 변경"*.
    const sc = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="input-control-scroll"]') as HTMLElement | null;
      if (!el) return null;
      const before = { scrollH: el.scrollHeight, clientH: el.clientHeight };
      el.scrollTop = el.scrollHeight; // 끝까지(넘칠 때의 fallback 경로 확인)
      return { ...before, scrollable: el.scrollHeight > el.clientHeight };
    });
    // ②-b 스크롤 컨테이너 자체는 **fallback으로 남긴다** — 항목이 늘면 다시 필요하다
    //     (402×513 여유는 약 20px뿐이고 서랍 행 하나가 69px이다).
    expect(sc, '펼친 서랍에는 스크롤 컨테이너가 fallback으로 남아 있다').not.toBeNull();
    expect(
      sc!.scrollH,
      'FB-4 — 펼친 서랍은 스크롤 없이 전부 보여야 한다(민구 확정 08-07 「더 높게 펼쳐라」)',
    ).toBeLessThanOrEqual(sc!.clientH);
    await page.waitForTimeout(120);

    // ③ 🔴 핵심 — 마지막 항목과 그 조작 버튼이 **실제로 히트된다**(toBeVisible로는 못 잡는 축).
    const row = await reachable(page, 'stepper-chip-sweep');
    const plus = await reachable(page, 'stepper-chip-sweep-plus');
    /* ③-b 🔴 v0.46.1 FB-4 — **첫 행도** 재야 한다. FB-B 시절엔 서랍이 트랙 안에 있어 잘리는 쪽이
     *  항상 **아래(마지막 항목)**였고 그래서 마지막 항목만 쟀다. FB-4 이후엔 서랍이 바닥에 붙어
     *  **위로** 자라므로 잘리는 쪽이 **위(첫 항목)**로 뒤집혔다.
     *  🔑 이 축이 없으면 `ActiveControlBar`의 `overflow: panelOpen ? 'visible' : 'hidden'`을
     *  `'hidden'`으로 되돌려도 **오라클이 아무 말도 안 한다**(마지막 항목은 트랙 안이라 멀쩡하다).
     *  08-07 반증에서 실제로 확인한 구멍이다 — 「무엇을 잡는 그물인가」를 물어서 찾았다. */
    const firstRow = await reachable(page, 'stepper-tolerance');
    console.log(
      `  스크롤필요=${sc?.scrollable}(FB-4: false여야 한다) 칩존히트=${chipHit.hit} ` +
      `첫행히트=${firstRow.hit} 마지막행히트=${row.hit} +버튼히트=${plus.hit}`,
    );
    expect(row.found, '칩 왕복 행이 DOM에 있다').toBe(true);
    expect(row.hit, '칩 왕복 행 중앙점이 다른 요소에 가려지지 않는다').toBe(true);
    expect(plus.hit, '+ 버튼을 실제로 누를 수 있다').toBe(true);
    expect(
      firstRow.hit,
      '서랍 첫 행이 위로 잘리지 않는다(FB-4에서 잘림 방향이 위로 뒤집혔다)',
    ).toBe(true);

    // ④ 배선 확인 — 닿을 뿐 아니라 값이 바뀐다(공허한 통과 방지).
    await page.locator('[data-testid="stepper-chip-sweep-plus"]').click();
    // + 한 번 = **한 단계 빠르게**(민구 정의: 단계가 클수록 빠르다). 초는 파생값이라 리터럴 금지.
    await expect(page.locator('[data-testid="voice-chip-grid"]'))
      .toHaveAttribute('data-chip-sweep', String(chipSweepSecondsForLevel(6)));
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
