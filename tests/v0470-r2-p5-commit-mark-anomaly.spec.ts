/**
 * v0.47.0-r2 P5(FB-F · 민구 실기기 08-09) — **칩존 ✓의 색이 상태를 진다.**
 *
 * 1차 제보: *"이상값 알람이 뜬 상태인데, 칩존의 초록색 체크 표시는 지금의 부정적 상황과
 * 일치하지 않음."*  → 초안은 알람 중 마크를 **지우는** 것이었다.
 * 민구 재정의(이 설계를 대체한다): *"알람중에는 색이라도 붉은색으로 유지하고, 알람해제 조건이
 * 성립되거나, 사용자가 '확인'시 해당 체크를 녹색으로 변경해줘. 체크 표시 대상은 알람을
 * 유발시킨 값에 해당하는 칩만이야. 만약 정상 입력되서 녹색으로 체크 되어 있는 칩은 녹색칩을
 * 유지하고 있어야해."*
 *
 * 계약: ✓는 사라지지 않는다(W4의 「이 칸은 채워졌다」 유지). **색**이 상태다 —
 *   🟢 `data-mark-tone="ok"` 지금 괜찮다 · 🔴 `data-mark-tone="alert"` 이 값에 알람이 걸렸다
 *
 * 이 스펙이 고정하는 것:
 *  ⓐ 음성 커밋 이상치 → 그 칩의 ✓가 빨강 → 「확인」 → 초록.
 *  ⓑ 직접 수정 이상치도 같다(P1 신설 경로) → 정정값이 정상이면 초록.
 *     **대조**: 알람 없는 칩의 초록은 내내 불변(민구 마지막 문장).
 *  ⓒ 수동 보류(manualHold) 미확정 후보는 마크 자체가 없다(W4 "후보 제외" 계약) → [확인] 후 초록.
 *  ⓓ 🔑 **알람이 어떻게든 내려가면 초록이다.** 확인 절차가 없는 **정보성 알람**(비-hold 수동
 *     커밋)도 다음 안내가 알람을 청소하는 순간 초록으로 돌아온다 — 색을 저장하지 않고
 *     `anomalyAlert`에서 파생하기 때문이다. 「값은 있는데 영영 체크가 없는 칸」이 안 생긴다.
 *
 * ⚠️ 왕복 OFF([TEAMOPS-81]) — 칩을 클릭하므로 필수. activeZones SETTINGS 승계.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt } from './fixtures/stt';

test.setTimeout(120_000);

/** `trendRule: 'increase'` = 직전보다 **커지면** 알람. 직전 회차: 01=100.0 · 02=5.0.
 *  → 01은 120.5가 위반/100.0이 정상, 02는 120.5가 위반/5.0이 정상.
 *
 *  🔑 **음성 컬럼이 3개인 이유**: 2개면 두 번째 값에서 행이 완료돼 칩존이 **다음 행**을 렌더한다
 *  (이 스펙 첫 구현에서 ⓑ·ⓓ가 그것 때문에 죽었다 — 마크를 찾을 수 없다). 03은 값을 받지 않는
 *  「행을 안 끝내는 꼬리」다. 03에 규칙이 없는 것도 의도다(끝 컬럼이 알람을 내지 않는다). */
const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'r2-p5-mark' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '5.0', ''],
  [PREV_ROUND, '이원창', '2', '100.0', '5.0', ''],
];

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);
/** ✓ 글리프. W4와 같은 셀렉터 — 하나의 표시이므로 자리·testid가 같다. */
const markIn = (page: Page, colName: string) =>
  chip(page, colName).locator('[data-testid="chip-commit-mark"]');
/** ✓의 상태색을 **속성으로** 읽는다(색상 문자열 비교는 브라우저 정규화에 기대는 취약한 단언). */
const markTone = (page: Page, colName: string) => markIn(page, colName).getAttribute('data-mark-tone');

const bootMini = (page: Page) => boot(page, PHONE_402, {
  settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
  headers: MINI_HEADERS,
  sheetRows: MINI_ROWS,
});

test('P5ⓐ 🔴 음성 커밋 이상치 → ✓가 빨강(사라지지 않는다) → 「확인」 → 초록', async ({ page }) => {
  await bootMini(page);

  await fireStt(page, '120.5', 900);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await expect(chip(page, '측정항목01')).toContainText('120.5');
  // 1.5초 플래시 창을 넘겨서 본다 — 플래시와 세션 영속 마크가 **같은 색**이어야 한다.
  await page.waitForTimeout(1800);
  await expect(markIn(page, '측정항목01'), '알람 중에도 ✓는 있다(지우지 않는다)').toBeVisible();
  expect(await markTone(page, '측정항목01'), '알람 중 ✓는 빨강').toBe('alert');

  // 「확인」 = 사용자 승인 → 초록.
  await fireStt(page, '확인', 900);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
  await expect(markIn(page, '측정항목01')).toBeVisible();
  expect(await markTone(page, '측정항목01'), '확인 후 ✓는 초록').toBe('ok');
});

test('P5ⓑ 🔴 직접 수정 이상치도 빨강 → 정정값이 정상이면 초록 (+대조: 다른 칩의 초록은 불변)', async ({ page }) => {
  await bootMini(page);

  // 정상 커밋 2건(각각 직전값과 동일 = 통과) — 둘 다 초록. 포인터는 측정항목03.
  await fireStt(page, '100.0', 800);
  await fireStt(page, '5.0', 900);
  expect(await markTone(page, '측정항목01'), '정상 커밋 = 초록').toBe('ok');
  expect(await markTone(page, '측정항목02'), '정상 커밋 = 초록').toBe('ok');

  // 직접 수정("수정 <값>")은 **직전 컬럼**을 겨냥한다 = 측정항목02(직전 5.0 → 120.5 위반).
  await fireStt(page, '수정 120.5', 1100);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(1800);
  expect(await markTone(page, '측정항목02'), '알람 유발 칩만 빨강').toBe('alert');
  expect(await markTone(page, '측정항목01'), '🔑 다른 칩의 초록은 불변(민구 확정)').toBe('ok');

  // 정정값(정상) 재커밋 = "수정으로 긍정적 상황 복귀" → 초록.
  await fireStt(page, '5.0', 1100);
  await expect(markIn(page, '측정항목02')).toBeVisible({ timeout: 4000 });
  expect(await markTone(page, '측정항목02'), '정상 정정값 재커밋 후 초록').toBe('ok');
  expect(await markTone(page, '측정항목01'), '대조군 여전히 초록').toBe('ok');
});

test('P5ⓒ 수동 보류(manualHold): 미확정 후보는 마크 없음(W4 계약) → 터치 [확인] 후 초록', async ({ page }) => {
  await bootMini(page);

  await chip(page, '측정항목01').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();
  for (const k of ['1', '2', '0', '.', '5']) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });

  await expect(chip(page, '측정항목01')).toContainText('120.5');
  await page.waitForTimeout(1800);
  // 🟡 경계 — 미확정 후보는 ✓ 집합에 없다(W4 "후보 제외"). 빨강으로 물들 마크 자체가 없다.
  await expect(markIn(page, '측정항목01'), '후보 단계엔 마크 없음').toHaveCount(0);

  // 터치 [확인] = 후보를 확정값으로 승격 + 알람 해제 → 초록.
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0, { timeout: 4000 });
  await expect(markIn(page, '측정항목01')).toBeVisible({ timeout: 4000 });
  expect(await markTone(page, '측정항목01'), '보류 [확인] 후 초록').toBe('ok');
});

test('P5ⓓ 🔴 확인 절차가 없는 정보성 알람도 — 알람이 지나가면 초록으로 돌아온다', async ({ page }) => {
  // 색을 저장하지 않고 anomalyAlert에서 파생하기 때문에 성립하는 계약이다. 초안(remove/add)
  // 에서는 이 경로에 복원 지점이 없어 「값은 있는데 영영 체크가 없는 칸」이 남았다.
  await bootMini(page);

  // 측정항목01 정상 커밋(초록) → 포인터는 측정항목02로.
  await fireStt(page, '100.0', 900);
  expect(await markTone(page, '측정항목01')).toBe('ok');

  // **다른 셀**(측정항목01)을 수동으로 덮어쓴다 → awaiting이 아니므로 보류가 아니라
  // 정보성 알람(버튼 없음·흐름 불변). 확인 절차가 존재하지 않는 유일한 알람이다.
  await chip(page, '측정항목01').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();
  for (const k of ['1', '2', '0', '.', '5']) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('[data-testid="anomaly-confirm-btn"]'), '정보성 알람 = 버튼 없음')
    .toHaveCount(0);
  await page.waitForTimeout(1800);
  expect(await markTone(page, '측정항목01'), '정보성 알람 중에도 빨강').toBe('alert');

  // 흐름을 계속 진행 → 다음 안내가 알람을 청소한다 → 초록 복귀.
  await fireStt(page, '5.0', 1200);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0, { timeout: 6000 });
  expect(await markTone(page, '측정항목01'), '알람이 지나가면 초록(영구 무체크 없음)').toBe('ok');
});
