/**
 * v0.25.0 (Vance) — 입력탭#1(자동입력 순서 뱃지) + 데이터탭#4(안내 큰 팝업) e2e.
 *
 *   입력탭#1 — 리스트(options) 자동입력 컬럼에서 선택 표시가 체크(✓)가 아니라 "선택 순번 숫자"다.
 *     · 터치(선택) 순서 = ①②③ = 행별 자동입력 순서(auto.selected 순서를 autoValue가 소비).
 *     · 다시 터치 = 해제 + 뒤 번호 당김. 재선택 = 맨 끝 번호로 추가.
 *     · 선택값 2개↑일 때 "자동 입력: 1행 A · 2행 B …" 라이브 미리보기 한 줄.
 *   데이터탭#4 — 작은 인라인 안내를 제거하고 헤더 `?`로 여는 큰 중앙 팝업으로 이전(on-demand).
 *
 * 375px 시뮬레이션(GL-005). 서버: `npm run dev -- --port 5175 --strictPort`.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5175';
const PHONE_375 = { width: 375, height: 812 };

async function goToSettings(page: Page) {
  await page.setViewportSize(PHONE_375);
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
}

async function goToData(page: Page) {
  await page.setViewportSize(PHONE_375);
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
}

// c4('라벨')를 text→…→options(리스트)로 바꾸고 A·B·C를 추가(추가 시 자동 선택됨).
async function makeOptionsColumn(page: Page) {
  const card = page.locator('[data-testid="col-card-c4"]');
  await expect(card).toBeVisible({ timeout: 3000 });
  const typeBtn = card.locator('[data-testid="type-btn-c4"]');
  // TYPE_ORDER = date,text,int,float,options → text에서 3번 눌러 리스트 도달.
  for (let i = 0; i < 3; i++) {
    await typeBtn.click();
    await page.waitForTimeout(120);
  }
  await expect(typeBtn).toContainText('리스트');

  const addInput = card.getByPlaceholder('새 값 입력');
  await expect(addInput).toBeVisible();
  for (const v of ['A', 'B', 'C']) {
    await addInput.fill(v);
    await addInput.press('Enter');
    await page.waitForTimeout(120);
  }
  return card;
}

test('입력탭#1 — 선택 칩에 순번 숫자 뱃지 + 라이브 미리보기(선택 순서)', async ({ page }) => {
  await goToSettings(page);
  const card = await makeOptionsColumn(page);

  // 추가 순서 = 선택 순서 → A①·B②·C③
  await expect(card.locator('[data-testid="opt-badge-c4-A"]')).toHaveText('1');
  await expect(card.locator('[data-testid="opt-badge-c4-B"]')).toHaveText('2');
  await expect(card.locator('[data-testid="opt-badge-c4-C"]')).toHaveText('3');
  console.log('✓ 선택 순번 뱃지 A1·B2·C3');

  const preview = card.locator('[data-testid="opt-preview-c4"]');
  await expect(preview).toContainText('자동 입력:');
  await expect(preview).toContainText('1행 A · 2행 B · 3행 C · 4행 A…');
  console.log('✓ 라이브 미리보기: 1행 A · 2행 B · 3행 C · 4행 A…');
});

test('입력탭#1 — 중간값 해제 시 뒤 번호 당김, 재선택 시 맨 끝 번호로', async ({ page }) => {
  await goToSettings(page);
  const card = await makeOptionsColumn(page);

  // 가운데 B를 해제 → 선택=[A,C], C가 3→2로 당겨짐. B는 뱃지 없음.
  await card.locator('[data-testid="opt-chip-c4-B"]').click();
  await page.waitForTimeout(150);
  await expect(card.locator('[data-testid="opt-badge-c4-A"]')).toHaveText('1');
  await expect(card.locator('[data-testid="opt-badge-c4-C"]')).toHaveText('2');
  await expect(card.locator('[data-testid="opt-badge-c4-B"]')).toHaveCount(0);
  await expect(card.locator('[data-testid="opt-preview-c4"]')).toContainText('1행 A · 2행 C · 3행 A…');
  console.log('✓ 해제 → 뒤 번호 당김(C 3→2), 미리보기 갱신');

  // B를 다시 터치 → 선택=[A,C,B], B는 맨 끝 번호 3.
  await card.locator('[data-testid="opt-chip-c4-B"]').click();
  await page.waitForTimeout(150);
  await expect(card.locator('[data-testid="opt-badge-c4-A"]')).toHaveText('1');
  await expect(card.locator('[data-testid="opt-badge-c4-C"]')).toHaveText('2');
  await expect(card.locator('[data-testid="opt-badge-c4-B"]')).toHaveText('3');
  await expect(card.locator('[data-testid="opt-preview-c4"]')).toContainText('1행 A · 2행 C · 3행 B · 4행 A…');
  console.log('✓ 재선택 → 맨 끝 번호(B=3), 미리보기 갱신');
});

test('입력탭#1 — 순번 칩은 접근성상 pressed 토글(aria-pressed)', async ({ page }) => {
  await goToSettings(page);
  const card = await makeOptionsColumn(page);

  const chipA = card.locator('[data-testid="opt-chip-c4-A"]');
  await expect(chipA).toHaveAttribute('aria-pressed', 'true');
  await expect(chipA).toHaveAttribute('aria-label', /자동 입력 1번째/);
  await chipA.click(); // 해제
  await page.waitForTimeout(150);
  await expect(chipA).toHaveAttribute('aria-pressed', 'false');
  console.log('✓ 칩은 aria-pressed 토글 + 순번 라벨');
});

test('데이터탭#4 — 인라인 안내 제거 + 헤더 `?`로 여는 큰 안내 팝업', async ({ page }) => {
  await goToData(page);

  // 옛 인라인 안내("… 음성 로그도 Drive에 자동 백업됩니다.")는 화면에서 사라졌다.
  await expect(page.getByText('음성 로그도 Drive에 자동 백업됩니다')).toHaveCount(0);
  // 팝업은 상시 노출이 아니라 닫혀 있어야 한다.
  await expect(page.locator('[data-testid="data-guide-modal"]')).toBeHidden();
  console.log('✓ 인라인 안내 제거 + 팝업 기본 닫힘');

  // 헤더 `?` 버튼으로 연다.
  await page.locator('[data-testid="data-guide-button"]').click();
  await page.waitForTimeout(250);
  const modal = page.locator('[data-testid="data-guide-modal"]');
  await expect(modal).toBeVisible({ timeout: 2000 });
  await expect(modal).toContainText('데이터 탭 안내');
  await expect(modal).toContainText('동기화');
  await expect(modal).toContainText('내보내기');
  await expect(modal).toContainText('자동 백업');
  console.log('✓ `?` → 큰 안내 팝업 열림 + 핵심 문구');

  // 375px 잘림 0(가로 스크롤 없음).
  const box = modal.locator('> div').first();
  const clip = await box.evaluate((el) => ({
    sw: (el as HTMLElement).scrollWidth,
    cw: (el as HTMLElement).clientWidth,
  }));
  expect(clip.sw).toBeLessThanOrEqual(clip.cw + 1);
  console.log(`✓ 375px 잘림 0 (sw=${clip.sw} cw=${clip.cw})`);

  // ✕(닫기)로 닫힌다.
  await modal.getByRole('button', { name: '닫기' }).click();
  await page.waitForTimeout(200);
  await expect(modal).toBeHidden();
  console.log('✓ ✕로 닫힘');
});
