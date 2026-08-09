/**
 * v0.47.0-r2 P5(FB-F · 민구 실기기 08-09) — **칩존 ✓의 의미가 바뀐다.**
 *
 * 민구 원문: *"이상값 알람이 뜬 상태인데, 칩존의 초록색 체크 표시는 지금의 부정적 상황과
 * 일치하지 않음. 칩존의 녹색표시는 알람 없이 정상입력 될 경우와, 알람이 발생해도 사용자의
 * 수정, 확인값을 긍정적 상황으로 돌아갔을때만 표시 할 것."*
 *
 * W4(08-08)의 ✓ = 「이 칸은 채워졌다」였다. 이제 ✓ = **「이 칸은 지금 괜찮다」** 다.
 * 이 스펙이 고정하는 계약:
 *  ⓐ 음성 커밋이 이상치면 그 셀의 ✓를 **억제**한다 — 값은 서 있어도 체크는 없다.
 *     「확인」(긍정 승인)으로 해소되면 **복원**된다.
 *  ⓑ 직접 수정("수정 <값>")이 이상치여도 같다(P1로 신설된 알람 경로). 정정값이 정상이면
 *     재커밋이 ✓를 되돌린다. 대조군: 알람 없는 정상 커밋은 처음부터 ✓다.
 *  ⓒ 수동 커밋 보류(manualHold)도 같다 — 후보 단계엔 ✓가 없고 터치 [확인]에서 선다.
 *
 * 🔑 구현 위치 주의: ✓ 렌더 조건은 «1.5초 플래시 **또는** 세션 영속 집합»의 OR다. 두 출처를
 *    각자의 소유 파일에서 막았다(집합=스토어 remove · 플래시=useVoiceCommitMark 훅 게이트) —
 *    그래서 `ChipZone.tsx`는 이 변경에서 **한 줄도 건드리지 않는다**(칩 왕복/스크롤 충돌면 0).
 *
 * ⚠️ 왕복 OFF([TEAMOPS-81]) — 칩을 클릭하므로 필수. activeZones SETTINGS 승계.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt } from './fixtures/stt';

test.setTimeout(120_000);

/** 측정항목01 = `trendRule: 'increase'`(커지면 알람) · 직전값 100.0 → 120.5가 위반, 100.0이 정상. */
const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'r2-p5-mark' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '5.0'],
  [PREV_ROUND, '이원창', '2', '100.0', '5.0'],
];

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);
/** ✓ 글리프 — W4가 쓰는 것과 **같은 셀렉터**(하나의 표시라 자리·testid가 같다). */
const markIn = (page: Page, colName: string) =>
  chip(page, colName).locator('[data-testid="chip-commit-mark"]');

const bootMini = (page: Page) => boot(page, PHONE_402, {
  settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
  headers: MINI_HEADERS,
  sheetRows: MINI_ROWS,
});

test('P5ⓐ 🔴 음성 커밋 이상치 → ✓ 억제(값은 유지) → 「확인」 긍정 승인 → ✓ 복원', async ({ page }) => {
  await bootMini(page);

  // 🔴 회귀 지점 — 종전엔 커밋만 하면 무조건 ✓라, 빨간 알람 팝업 옆에 초록 체크가 함께 떴다.
  await fireStt(page, '120.5', 900);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await expect(chip(page, '측정항목01'), '값 자체는 선다(알림 ≠ 롤백)').toContainText('120.5');
  // 1.5초 플래시 창까지 넘겨서 본다 — 집합·플래시 **양쪽**이 막혀 있어야 한다.
  await page.waitForTimeout(1800);
  await expect(markIn(page, '측정항목01'), '알람 중에는 ✓가 없다').toHaveCount(0);

  // 「확인」 = 사용자가 그 값을 승인 = 긍정 복귀 → ✓ 복원.
  await fireStt(page, '확인', 900);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
  await expect(markIn(page, '측정항목01'), '확인 후 ✓ 복원').toBeVisible({ timeout: 4000 });
});

test('P5ⓑ 🔴 직접 수정 이상치도 ✓ 억제 → 정정값이 정상이면 복원 (+대조: 정상 커밋은 처음부터 ✓)', async ({ page }) => {
  await bootMini(page);

  // 대조군 — 알람 없는 정상 커밋은 ✓가 선다(W4 계약 회귀 없음).
  await fireStt(page, '100.0', 900);
  await expect(markIn(page, '측정항목01'), '정상 커밋 = ✓').toBeVisible({ timeout: 4000 });

  // 직접 수정으로 이상치 진입(P1이 신설한 경로) → ✓ 회수.
  await fireStt(page, '수정 120.5', 1000);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(1800);
  await expect(markIn(page, '측정항목01'), '직접 수정 알람 중에는 ✓가 없다').toHaveCount(0);

  // 정정값(정상) 재커밋 = 민구 정의의 "수정으로 긍정적 상황 복귀" → ✓ 복원.
  await fireStt(page, '100.0', 1000);
  await expect(markIn(page, '측정항목01'), '정상 정정값 재커밋 후 ✓ 복원').toBeVisible({ timeout: 4000 });
  await expect(chip(page, '측정항목01')).toContainText('100');
});

test('P5ⓒ 🔴 수동 커밋 보류(manualHold): 후보 단계엔 ✓ 없음 → 터치 [확인]에서 선다', async ({ page }) => {
  await bootMini(page);

  // 칩 탭 → 키패드로 위반값 커밋 → 진행 보류(터치 전용 해소).
  await chip(page, '측정항목01').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();
  for (const k of ['1', '2', '0', '.', '5']) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });

  await expect(chip(page, '측정항목01')).toContainText('120.5');
  await page.waitForTimeout(1800);
  await expect(markIn(page, '측정항목01'), '미확정 후보 + 알람 → ✓ 없음').toHaveCount(0);

  // 터치 [확인] = 후보를 확정값으로 승격 + 긍정 승인 → ✓.
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0, { timeout: 4000 });
  await expect(markIn(page, '측정항목01'), '보류 [확인] 후 ✓').toBeVisible({ timeout: 4000 });
});
