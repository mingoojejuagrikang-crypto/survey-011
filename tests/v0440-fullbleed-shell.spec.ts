import { test, expect } from '@playwright/test';
import { boot, PHONE_402 } from './fixtures/activeZones';

/** §B2 과제2+4 — 풀블리드 셸 오라클(층 A). §B1이 green으로 만들 대상이라 지금은 red다.
 *
 *  🔴 App.tsx:30의 `isMobile = window.innerWidth <= 480`이 640px 태블릿을 데스크톱으로
 *  분류해 375×812 프리뷰 박스에 가둔다 — 그래서 640×1024에서 `.mobile-app-shell`이 0개다.
 *  세 뷰포트를 한 파일에서 재고, 640과 402의 셸 폭이 실제로 다르다는 것까지 단언해
 *  "after만 보면 무변화 카드가 통과한다"는 함정을 막는다. */

const TABLET_640 = { width: 640, height: 1024 };
const DESKTOP_1280 = { width: 1280, height: 720 };

async function gotoShell(page: import('@playwright/test').Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

for (const { name, viewport } of [
  { name: '640×1024', viewport: TABLET_640 },
  { name: '402×874', viewport: PHONE_402 },
  { name: '1280×720', viewport: DESKTOP_1280 },
] as const) {
  test(`풀블리드 셸 — .mobile-app-shell 1개·뷰포트 폭과 일치 @ ${name}`, async ({ page }) => {
    await gotoShell(page, viewport);
    const shell = page.locator('.mobile-app-shell');
    const count = await shell.count();
    console.log(`[fullbleed-shell] ${name}: mobile-app-shell count=${count}`);
    expect(count, `${name}에서 .mobile-app-shell이 정확히 1개`).toBe(1);
    const box = await shell.boundingBox();
    console.log(`[fullbleed-shell] ${name}: shell width=${box?.width}`);
    expect(box?.width, `${name}에서 셸 폭이 뷰포트 폭과 정확히 일치`).toBeCloseTo(viewport.width, 0);
  });
}

async function shellWidthOrNull(page: import('@playwright/test').Page) {
  const shell = page.locator('.mobile-app-shell');
  if ((await shell.count()) === 0) return null;
  return (await shell.boundingBox())?.width ?? null;
}

test('풀블리드 셸 — 640과 402의 셸 폭이 서로 다르다(무변화 카드 방지)', async ({ page }) => {
  await gotoShell(page, TABLET_640);
  const shell640 = await shellWidthOrNull(page);

  await gotoShell(page, PHONE_402);
  const shell402 = await shellWidthOrNull(page);

  console.log(`[fullbleed-shell-diff] 640width=${shell640} 402width=${shell402}`);
  // 🔴 지금은 640이 null(셸 자체가 없음)이라 "다르다"가 자명하게 참 — after만 보면 통과하는
  // 무변화 카드를 막는 건 위 개별 단언(count===1·width 일치)의 몫이다. 이 단언은 §B1 이후
  // 두 폭이 실제로 다른 "숫자"로 남는지(둘 다 셸이 생겼는데 같은 값으로 굳지 않는지)를 잠근다.
  expect(shell640, '640 셸 폭 측정 가능').not.toBeNull();
  expect(shell402, '402 셸 폭 측정 가능').not.toBeNull();
  expect(shell640, '640과 402의 실제 셸 폭이 다르다').not.toBeCloseTo(shell402 ?? -1, 0);
});

/** §B3 — TabBar 가시성. 브리핑은 "data-testid 없다"고 적었으나 실측 결과 이미 있다
 *  (TabBar.tsx:54, 커밋 0798b75e·2026-07-22, v0.38.0 개선요청#6). Larry 확인(2026-08-03):
 *  브리핑/플랜 §B2 오류, 제품 코드 변경 없이 기존 testid로 진행. */
test('TabBar 가시성 — ManualValueSheet 열린 상태에서도 화면 안 @ 640×1024', async ({ page }) => {
  await boot(page, TABLET_640);
  // ManualValueSheet는 음성 "수정" 명령이 아니라 활성 칩을 눌러 연다(ActiveState.tsx:287
  // onActivate → c.input === 'voice' ? openManualSheet(c)).
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();

  const tabBar = page.locator('[data-testid="tab-bar"]');
  await expect(tabBar).toBeVisible();
  const box = await tabBar.boundingBox();
  console.log(`[tabbar-visibility] 640×1024 manual-sheet-open: box=${JSON.stringify(box)}`);
  expect(box, 'TabBar boundingBox 존재').not.toBeNull();
  expect(box!.y + box!.height, 'TabBar 하단 끝이 뷰포트(1024px) 안').toBeLessThanOrEqual(1024);
});

/** 🔴 Larry 지시(2026-08-03) — 위 640×1024 단언은 §B1 이전엔 압력이 없다(375×812 고정 박스가
 *  `margin:'20px auto'`로 위치가 고정돼 바닥이 항상 y=832 근방이라 1024 뷰포트 안에 항상
 *  들어간다). 압력이 있는지 확인하려고 뷰포트 높이를 줄여 박스가 넘치게 만든다 — 박스는
 *  뷰포트 높이에 반응하지 않고 절대 위치가 고정이므로, 뷰포트를 640×600으로 줄이면 박스 바닥
 *  (y≈832)이 뷰포트(600) 밖으로 나가 TabBar가 실제로 밀려난다.
 *
 *  🔴 `@pending-readystate` — §B1 적용 후 이 케이스가 **다른 이유로** red다. Larry 정정(2026-08-03):
 *  "pre-existing"은 절반만 맞다 — **잠재 결함(`ReadyState.tsx:30`의 `flex:1` 컨테이너에
 *  `minHeight:0` 누락)은 B1 이전부터 있었지만, 그 증상(콘텐츠가 TabBar와 겹침)은 §B1
 *  이후에만 나온다.** §B1 이전엔 셸이 812px 고정이라 600px 뷰포트보다 커서 "잘림/스크롤"만
 *  났고, §B1이 셸을 뷰포트(600px)에 맞추자 비로소 내부 콘텐츠가 대칭으로 넘쳐 TabBar와
 *  겹치는 형태로 드러났다 — `boot()`의 "음성 입력 시작" 클릭 자체가 TabBar에 가로막혀 타임아웃.
 *  실측(정규 3뷰포트 640×1024·402×874·1280×720은 전부 `startBtn.bottom - tabBar.top = -12px`로
 *  겹침 없음·스크롤 없음 — 640×600에서만 `+41px` 겹침. `ReadyState.tsx`는 이 레인(§B1) 스코프
 *  밖이라 고치지 않는다. 처방 후보: 그 `flex:1` 컨테이너에 `minHeight:0`(+ 필요시 `overflowY:auto`
 *  스크롤 영역화 — `minHeight:0` 단독으로는 버튼은 안 겹쳐도 원형 아이콘·연결카드가 대신 겹칠
 *  수 있어 검증 없이 단정하지 않는다). 640×600은 PortraitGuard가 landscape+터치를 막아 실기기
 *  형태는 아니지만, **작은 데스크톱 브라우저 창(개발·QA 환경)에서는 재현되므로 무시하지 말고
 *  TODO로 등재한다.** */
test('@pending-readystate TabBar 가시성 — 압력 확인: 뷰포트를 줄이면(640×600) §B1 이후에도 red(다른 원인)', async ({ page }) => {
  const SHORT_640 = { width: 640, height: 600 };
  await boot(page, SHORT_640);
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();

  const tabBar = page.locator('[data-testid="tab-bar"]');
  const box = await tabBar.boundingBox();
  console.log(`[tabbar-visibility-pressure] 640×600 manual-sheet-open: box=${JSON.stringify(box)}`);
  expect(box, 'TabBar boundingBox 존재').not.toBeNull();
  expect(box!.y + box!.height, 'TabBar 하단 끝이 뷰포트(600px) 안').toBeLessThanOrEqual(600);
});
