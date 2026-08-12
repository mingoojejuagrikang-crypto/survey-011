/**
 * v0.49 fix49b 오라클 — **cellWait 착지도 이전 알람을 청소한다** (max 리뷰 2026-08-12 #14)
 *
 * v0.9.0 계약: *"다음 필드로 진입하면 이전 이상치 알람 팝업은 해제(해소된 것으로 간주)"*.
 * 착지 처리 3형제 중 둘은 그 계약을 지킨다 — `announceField`(`clearAnomalyAlert('announce_field')`) ·
 * `enterReviewWait`(`'review_wait'`). fix49가 셋째로 추가한 `enterCellWait`만 빠졌다.
 *
 * 결과: **다른 셀**의 정보성 알람 팝업이 화면에 뜬 채로 커서만 옮겨간다. 앱은 "횡경 기록값
 * 35.1"이라고 말하는데 화면은 전혀 다른 칸의 이상치를 크게 띄우고 있다 — PRINCIPLES §2가
 * 요구하는 시각·청각 일치가 깨진다. 확인 절차가 없는 정보성 알람이라 사용자가 지울 방법도 없다.
 *
 * ⚠️ 왕복 OFF([TEAMOPS-81]) — 칩을 클릭하므로 필수. activeZones SETTINGS 승계.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** `trendRule: 'increase'` = 직전 회차보다 커지면 알람. 직전 01=100.0.
 *  음성 컬럼 3개인 이유는 p5 스펙과 같다 — 2개면 두 번째 값에서 행이 완료돼 칩존이 다음 행을
 *  렌더한다(측정 대상이 화면에서 사라진다). 03은 「행을 안 끝내는 꼬리」다. */
const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'fix49b-alert' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '', ''],
  [PREV_ROUND, '이원창', '2', '100.0', '', ''],
];

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);

async function activeChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return c?.dataset.colName ?? '';
  });
}

test('cellWait 착지가 다른 셀의 정보성 알람 팝업을 남기지 않는다 (#14)', async ({ page }) => {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });

  // 01에 정상값(직전 100.0보다 작다) → 알람 없이 02 대기로 전진.
  await fireStt(page, '95.5', 900);
  await expect(chip(page, '측정항목01')).toContainText('95.5');
  expect(await activeChipName(page)).toContain('측정항목02');

  // 지금 대기 중인 칸은 02인데 **01을** 키패드로 고친다 → awaiting과 다른 셀이므로
  //   확인 버튼 없는 **정보성** 알람이 뜬다(민구 확정 07-27: 비-hold도 전부 발화·표시).
  await chip(page, '측정항목01').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 3000 });
  for (const k of ['1', '2', '0', '.', '5']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });

  // 「이전」 = 값이 든 01로 항목 이동 → cellWait 착지.
  await waitForTtsIdle(page);
  await fireStt(page, '이전', 1200);
  await waitForTtsIdle(page);
  expect(await activeChipName(page)).toContain('측정항목01');
  expect((await ttsLog(page)).join(' | '), '착지 안내(기록값 낭독)가 나야 cellWait이다').toContain('기록값');

  // 🔴 형제 착지 핸들러 둘(announceField·enterReviewWait)은 여기서 팝업을 내린다.
  //    셋째만 빠지면 「빈 칸에 착지하면 사라지고 값 있는 칸에 착지하면 남는」 설명 불가능한
  //    화면이 된다 — 그 차이는 사용자에게 보이지 않는 내부 구분이다.
  await expect(
    page.locator('[data-testid="anomaly-alert"]'),
    'cellWait 착지가 이전 셀의 알람 팝업을 청소하지 않았다',
  ).toHaveCount(0);
});
