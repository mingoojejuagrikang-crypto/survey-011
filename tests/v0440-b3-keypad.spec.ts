/**
 * v0.44.0 §B3 재측정 + F35 세 경로 오라클 — 640×1024 (태블릿).
 *
 * §B3(재측정): ManualValueSheet 열린 상태에서 TabBar 하단 끝이 뷰포트 안인가 —
 * §B1(풀블리드 셸)이 이미 고쳤는지 판정한다(v0440-fullbleed-shell의 동일 축을 §B3 명의로 재측정).
 *
 * F35(민구 증언 2026-08-04): "알람 시기였는지 마지막 행 입력 후 다른 열로 이동해서였는지
 * 키패드가 하단의 다른 버튼들을 가렸던 것 같다." — 세 진입 경로에서 키패드(수동입력 시트)가
 * 하단 4버튼(TabBar의 설정/입력/업로드/개선요청)·TabBar를 가리는지 잰다:
 *  ⓐ 정상(음성입력 중 수동입력 진입) — green 기대(민구: 문제없음 확인됨)
 *  ⓑ 이상치 알람 뜬 뒤 수동입력 진입
 *  ⓒ 마지막 행 입력 후 다른 열로 이동한 뒤 수동입력 진입
 *
 * 판정 축(경로 공통):
 *  1) TabBar 하단 끝 ≤ 뷰포트 높이(밀려나지 않음)
 *  2) 시트(키패드 포함)와 4개 탭 버튼의 픽셀 겹침 0(가리지 않음 — 시트 zIndex 55 > TabBar 53이라
 *     기하가 겹치면 시트가 이긴다. 그래서 겹침 px 자체를 잰다)
 *  3) 시트 하단 끝 ≤ TabBar 상단(시트가 TabBar 영역으로 내려오지 않음)
 *
 * red가 나오면 고치지 않는다 — 수치를 로그로 남기고 제목에 @pending-b3 태그(처방은 오케스트레이터).
 *
 * 하네스: fixtures/activeZones(§[2] 알람·§[4] 끝 도달 진입기 보유). 서버는 webServer 자동 기동.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, triggerAnomaly, fillAllRows } from './fixtures/activeZones';

test.setTimeout(180_000);

const TABLET_640 = { width: 640, height: 1024 };
const TAB_IDS = ['tab-settings', 'tab-voice', 'tab-data', 'tab-feedback'] as const;

interface Box { x: number; y: number; width: number; height: number }

function overlapPx(a: Box, b: Box): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    y: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

/** 시트/TabBar/탭 4버튼 실측 + 겹침 산출. 수치는 red/green 무관하게 항상 로그로 남긴다. */
async function measureKeypadVsBottom(page: Page, label: string) {
  const sheet = (await page.locator('[data-testid="manual-value-sheet"]').boundingBox())!;
  const keypad = await page.locator('[data-testid="manual-keypad"]').boundingBox();
  const tabBar = (await page.locator('[data-testid="tab-bar"]').boundingBox())!;
  const tabs: Array<{ id: string; box: Box; overlap: { x: number; y: number } }> = [];
  for (const id of TAB_IDS) {
    const box = (await page.locator(`[data-testid="${id}"]`).boundingBox())!;
    tabs.push({ id, box, overlap: overlapPx(sheet, box) });
  }
  const m = {
    sheetBottom: sheet.y + sheet.height,
    keypadBottom: keypad ? keypad.y + keypad.height : null,
    tabBarTop: tabBar.y,
    tabBarBottom: tabBar.y + tabBar.height,
    tabs,
  };
  console.log(
    `[b3-keypad] ${label}: sheetBottom=${m.sheetBottom.toFixed(1)} keypadBottom=${m.keypadBottom?.toFixed(1) ?? 'n/a'} ` +
    `tabBarTop=${m.tabBarTop.toFixed(1)} tabBarBottom=${m.tabBarBottom.toFixed(1)} ` +
    `overlaps=${tabs.map((t) => `${t.id}:${t.overlap.x.toFixed(0)}x${t.overlap.y.toFixed(0)}`).join(' ')}`,
  );
  return m;
}

function assertBottomIntact(m: Awaited<ReturnType<typeof measureKeypadVsBottom>>, label: string) {
  // 1) TabBar가 뷰포트 밖으로 밀려나지 않았다.
  expect(m.tabBarBottom, `${label}: TabBar 하단 끝이 뷰포트(1024px) 안`).toBeLessThanOrEqual(1024);
  // 2) 시트가 탭 4버튼 어느 것도 가리지 않는다(겹침 면적 0 — x·y 동시 겹침이 있어야 가림이다).
  for (const t of m.tabs) {
    const covered = t.overlap.x > 0 && t.overlap.y > 0;
    expect(covered, `${label}: 시트가 ${t.id}를 가린다(겹침 ${t.overlap.x.toFixed(0)}×${t.overlap.y.toFixed(0)}px)`).toBe(false);
    // 버튼 자체도 뷰포트 안이어야 한다(밀려나 "가려진 것처럼" 안 보이는 경우 분리 판정).
    expect(t.box.y + t.box.height, `${label}: ${t.id} 하단 끝이 뷰포트 안`).toBeLessThanOrEqual(1024);
  }
  // 3) 시트가 TabBar 영역으로 내려오지 않는다(1px 미만 서브픽셀 오차 허용).
  expect(m.sheetBottom, `${label}: 시트 하단 끝 ≤ TabBar 상단`).toBeLessThanOrEqual(m.tabBarTop + 1);
}

async function openSheetByChip(page: Page, selector: string) {
  await page.locator(selector).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 4000 });
  await page.waitForTimeout(250); // 레이아웃 정착(애니메이션 0ms 픽스처지만 rAF 여유)
}

// ── §B3 재측정 — §B1(풀블리드)이 이미 고쳤는지 판정 ─────────────────────────────

test('§B3 재측정 — ManualValueSheet 열림 + TabBar 하단 끝 ≤ 1024 @ 640×1024', async ({ page }) => {
  await boot(page, TABLET_640);
  await openSheetByChip(page, '[data-testid="column-chip"][data-active="true"]');

  const tabBar = await page.locator('[data-testid="tab-bar"]').boundingBox();
  console.log(`[b3-remeasure] 640×1024 sheet-open tabBar=${JSON.stringify(tabBar)}`);
  expect(tabBar, 'TabBar boundingBox 존재').not.toBeNull();
  expect(tabBar!.y + tabBar!.height, 'TabBar 하단 끝이 뷰포트(1024px) 안 — §B1 판정').toBeLessThanOrEqual(1024);
});

// ── F35 ⓐ — 정상 경로(음성입력 중 수동입력 진입): green 기대 ─────────────────────

test('F35 ⓐ 정상 — 음성입력 중 활성 칩 탭 → 키패드가 하단 4버튼·TabBar를 안 가린다', async ({ page }) => {
  await boot(page, TABLET_640);
  await openSheetByChip(page, '[data-testid="column-chip"][data-active="true"]');

  const m = await measureKeypadVsBottom(page, 'ⓐ normal');
  assertBottomIntact(m, 'ⓐ 정상');
});

// ── F35 ⓑ — 이상치 알람 뜬 뒤 수동입력 진입 ────────────────────────────────────

test('F35 ⓑ 알람 — 이상치 알람 응답 대기 중 칩 탭 → 키패드가 하단 4버튼·TabBar를 안 가린다', async ({ page }) => {
  await boot(page, TABLET_640);
  // 직전 100.0 → 120.5(trendRule increase 위반) — 응답 대기 알람 + 하단 [확인][수정] 모드.
  await triggerAnomaly(page);
  // 알람 응답 대기 상태에서 그 셀의 칩을 눌러 수동입력 진입(시트가 열리면 알람 표시는 접힌다 —
  // ActiveState alertVisible 계약. 보류 자체는 유지되므로 취소 시 알람이 되살아난다).
  await openSheetByChip(page, '[data-testid="column-chip"][data-active="true"]');

  const m = await measureKeypadVsBottom(page, 'ⓑ anomaly');
  assertBottomIntact(m, 'ⓑ 알람');
});

// ── F35 ⓒ — 마지막 행 입력 후 다른 열로 이동한 뒤 수동입력 진입 ───────────────────

test('F35 ⓒ 끝 도달 — 마지막 행 입력 후 다른 열 칩 탭 → 키패드가 하단 4버튼·TabBar를 안 가린다', async ({ page }) => {
  await boot(page, TABLET_640);
  // 마지막 행까지 전부 입력(§[4] 끝 도달 — 활성 강조 없음 상태).
  await fillAllRows(page);
  // "다른 열로 이동" = 다른 음성 컬럼 칩 탭(터치의 열 이동은 곧 수동입력 진입이다).
  await openSheetByChip(page, '[data-testid="column-chip"][data-col-name="측정항목03"]');

  const m = await measureKeypadVsBottom(page, 'ⓒ last-row-move');
  assertBottomIntact(m, 'ⓒ 끝 도달');
});
