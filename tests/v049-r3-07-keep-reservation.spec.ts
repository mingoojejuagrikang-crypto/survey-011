/**
 * v0.49 r3 #7 오라클 — **'유지'가 살아 있는 복귀 예약을 파기하지 않는다**(claude r2 MEDIUM).
 *
 * 가드레일 [NAV-FILLED-CELL-1]: *"정본은 `proceedAfterCommit`이며 그 kind 분기를 우회해 직접
 * `advance()`를 부르지 마라."* `cmdKeep`은 값이 있으면 곧장 `advance()`를 불렀다.
 *
 * **도달 경로(알람 강등)** — 리뷰가 지목한 조합을 코드로 되짚으면 이 하나다:
 *   ① 셀 검토 대기(cellWait)에서 "수정 <이상치값>" → 이상치 알람(trendConfirm + `resumeCell`)
 *   ② 알람에 '수정'이라고 답하면 `demoteTrendConfirm`이 **예약을 보존한 채** modify로 강등한다.
 *      그 셀은 아직 값을 들고 있다(재청취 중일 뿐 지워지지 않았다).
 *   ③ 거기서 마음을 바꿔 '유지' → 종전엔 `advance()`로 빠져 셀 검토 문맥이 증발했다.
 *
 * 같은 상태에서 '확인'은 `trendResolve`가 `proceedAfterCommit`으로 착지시킨다(A2). 즉 **같은
 * 상태·같은 목적의 조작이 어휘에 따라 갈렸다** — fix49b가 입력 수단에 대해 세운 대칭의 어휘판.
 *
 * ⚠️ 예약이 **없는** 상태의 '유지'는 종전대로 전진한다(②가 그 대조군이다). 가드레일이 열거한
 * 네 경로는 전부 **정정**이고 '유지'는 정정이 아니라 「그대로 두고 넘어간다」이기 때문 —
 * 그 의미를 바꾸는 것은 민구 확정이 필요한 별개 결정이라 이번 회차에서 하지 않았다.
 *
 * 반증(예약 분기 제거 시): ① red.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

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
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'r3-07' },
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

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
}

/** 01에 값을 넣고 「이전」으로 되돌아가 셀 검토 대기(cellWait)를 만든다(A2 픽스처와 같은 골격). */
async function enterCellWaitOn01(page: Page) {
  await fireStt(page, '95.5', 900);
  await waitForTtsIdle(page);
  await fireStt(page, '이전', 1200);
  await waitForTtsIdle(page);
  expect(await activeChipName(page)).toContain('측정항목01');
  expect((await ttsLog(page)).join(' | '), '전제: cellWait 착지').toContain('기록값');
}

test('① 알람 강등(수정) 뒤의 「유지」도 셀 검토 대기로 복귀한다 — 예약이 살아 있다', async ({ page }) => {
  await bootMini(page);
  await enterCellWaitOn01(page);

  // 직접값 수정이 이상치(직전 100.0 대비 증가) → 알람 + resumeCell 예약.
  await fireStt(page, '수정 120.5', 1500);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await waitForTtsIdle(page);

  // '수정' — 알람만 해제하고 modify로 **강등**한다(예약 보존, 셀 값은 그대로 120.5).
  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);
  const before = (await ttsLog(page)).length;

  // 마음을 바꿔 '유지'. 값이 있으므로 종전엔 곧장 advance()로 빠졌다.
  await fireStt(page, '유지', 1800);
  await waitForTtsIdle(page);
  const spoken = (await ttsLog(page)).slice(before).join(' | ');

  await expect(chip(page, '측정항목01')).toContainText('120.5');
  expect(await activeChipName(page), '「유지」가 셀 검토 문맥을 파괴하고 전진했다').toContain('측정항목01');
  expect(spoken, '복귀 시 값을 되읽어야 한다(cellWait 낭독)').toContain('기록값');
  expect(spoken).toContain('120.5');
});

test('② 대조군 — 예약이 없는 상태의 「유지」는 종전대로 전진한다', async ({ page }) => {
  await bootMini(page);
  // 01 커밋 후 02 대기(kind:value, 값 없음)… 가 아니라 **01에 값이 있는 cellWait**에서 재본다:
  // 예약이 서지 않는 상태이므로 '유지'는 다음 빈 칸으로 전진해야 한다.
  await enterCellWaitOn01(page);
  const before = (await ttsLog(page)).length;
  await fireStt(page, '유지', 1800);
  await waitForTtsIdle(page);
  const spoken = (await ttsLog(page)).slice(before).join(' | ');

  expect(await activeChipName(page), '예약 없는 「유지」까지 제자리에 묶으면 전진 수단이 사라진다')
    .toContain('측정항목02');
  expect(spoken).toContain('측정항목02');
});
