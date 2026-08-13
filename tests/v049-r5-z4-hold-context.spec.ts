/**
 * v0.49 r5 Z4 오라클(claude #3) — **수동 이상치 보류의 재무장은 착지 예약을 들고 간다.**
 *
 * 키패드 커밋이 이상치를 만나 `manualHold`로 보류되면, `commitManualValue`는 대기 상태를
 * `{kind:'modify', …}`로 재무장한다. 그 객체를 **맨손으로** 만들면 들어올 때의 `awaiting`이
 * 갖고 있던 **착지 예약**(`resumeCell`/`resumeReview`)이 통째로 사라진다. 보류가 [확인]으로
 * 풀리면 `proceedAfterCommit`이 그 예약을 보고 검토 대기로 복귀하는데(SSOT), 예약이 없으면
 * `advance()`로 빠져 **사용자가 의도적으로 이동해 들어온 검토 문맥이 증발한다**
 * ([NAV-FILLED-CELL-1]의 「모든 탈출은 재진입」 불변식 위반).
 *
 * 형제 재무장 둘은 이미 보존한다 — `demoteTrendConfirm`과 음성 재위반 재무장. 이 세 번째만
 * 빠져 있어서, **같은 상태에서 같은 값을 말로 넣으면 보존되고 손으로 넣으면 유실되는**
 * 입력 수단 비대칭이었다.
 *
 * 🔴 **`fractionWhole`은 승계하지 않는다 — 브리핑 원문에서 갈린 지점이다.** 승계 규칙은
 * 「예약이냐 값 문맥이냐」가 아니라 **「새 완결값이 들어왔는가」**다. `demoteTrendConfirm`은
 * 같은 값에 대한 모드 전환이라 승계하고, 이 자리와 음성 재위반 재무장(브리핑이 대칭 대상으로
 * 지목한 :3329)은 사용자가 완결된 새 값을 넣은 뒤라 승계하지 않는다. ③이 그 결정을 고정한다 —
 * 승계하면 화면(`setReaskReason(null)`이 `reaskDecimalWhole`까지 지운다)과 합성이 갈려
 * M3가 닫은 「무고지 합성」이 되살아난다.
 *
 * 반증(예약 승계 제거 시): ① red(복귀 대신 다음 항목으로 전진한다). ②는 대조군.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** `trendRule:'increase'` = 직전 회차보다 커지면 알람. 01의 직전값은 100.0 —
 *  `90.5`는 정상이고 `120.5`가 위반이다(v0490-p2와 같은 설계). */
const COLS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '', ''],
  [PREV_ROUND, '이원창', '2', '100.0', '', ''],
];

const bootZ4 = (page: Page) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: COLS, totalRows: 2, sessionAutoLabel: 'r5-z4' },
  } as unknown as typeof AZ_SETTINGS,
  headers: HEADERS,
  sheetRows: SHEET_ROWS,
});

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);

async function keypadCommit(page: Page, colName: string, keys: string[]) {
  await chip(page, colName).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 4000 });
  for (const k of keys) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
}

/** 01에 값을 넣고 → 「이전」으로 되돌아와 **셀 검토 대기**에 착지 → bare 「수정」.
 *  이 시점의 `awaiting`이 `{kind:'modify', resumeCell:{row 1, m1}}`이다. */
async function armModifyFromCellWait(page: Page) {
  await fireStt(page, '구십 점 오', 1800); // 90.5 — 정상값(알람 없음) → 02로 전진
  await waitForTtsIdle(page);
  await fireStt(page, '이전', 1500);        // 항목 이동 → 값 있는 01 착지 = cellWait
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: 셀 검토 대기에 착지했다').toBe('측정항목01 기록값 90.5.');
  await fireStt(page, '수정', 1500);        // bare 수정 → modify + resumeCell 예약
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: 수정 재청취가 열렸다').toBe('수정. 측정항목01.');
}

test('① 보류 [확인] 뒤 셀 검토 대기로 복귀한다 — 키패드 재무장이 예약을 버리지 않는다', async ({ page }) => {
  await bootZ4(page);
  await armModifyFromCellWait(page);

  // 키패드로 **이상치** 값을 넣는다 → manualHold 보류.
  await keypadCommit(page, '측정항목01', ['1', '2', '0', '.', '5']);
  const confirmBtn = page.locator('[data-testid="anomaly-confirm-btn"]');
  await expect(confirmBtn, '전제: 수동 이상치 보류가 걸렸다').toBeVisible({ timeout: 6000 });

  await confirmBtn.click();
  await waitForTtsIdle(page);

  // 예약이 살아 있으면 `proceedAfterCommit`이 cellWait으로 복귀해 **갱신값을 낭독**한다.
  // 죽어 있으면 `advance()`로 빠져 다음 항목("측정항목02.")을 안내한다.
  expect(
    (await ttsLog(page)).at(-1),
    '보류 해소가 셀 검토 문맥을 버리고 다음 항목으로 전진했다 — 입력 수단(말/손)에 따라 착지가 갈린다',
  ).toBe('측정항목01 기록값 120.5.');
});

test('② 대조군 — 예약 없는 일반 수정에서의 보류 해소는 종전대로 전진한다', async ({ page }) => {
  await bootZ4(page);

  // cellWait을 거치지 않는다 = 예약이 없다. 첫 셀에서 곧장 키패드 이상치 커밋.
  await waitForTtsIdle(page);
  await keypadCommit(page, '측정항목01', ['1', '2', '0', '.', '5']);
  const confirmBtn = page.locator('[data-testid="anomaly-confirm-btn"]');
  await expect(confirmBtn, '전제: 수동 이상치 보류가 걸렸다').toBeVisible({ timeout: 6000 });

  await confirmBtn.click();
  await waitForTtsIdle(page);
  expect(
    (await ttsLog(page)).at(-1),
    '예약이 없는데 복귀했다 — 승계가 없는 값을 만들어냈다',
  ).toBe('측정항목02.');
});

test('[node] ③ 승계 목록은 착지 예약뿐이다 — 새 완결값이 들어온 재무장은 값 문맥을 버린다', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync('src/lib/useVoiceSession.ts', 'utf-8');

  const from = src.indexOf("awaitingFieldRef.current = { kind: 'modify', row, colId, name: col.name");
  const at = from >= 0 ? from : src.indexOf('kind: \'modify\', row, colId, name: col.name, previousValue: value,');
  expect(at, '수동 이상치 재무장 지점을 찾지 못했다 — 모양이 바뀌었으면 이 계약도 갱신하라').toBeGreaterThan(0);
  const block = src.slice(at, at + 500);

  expect(block, '착지 예약(셀 축)을 승계하지 않는다').toContain('resumeCell');
  expect(block, '착지 예약(행 축)을 승계하지 않는다').toContain('resumeReview');
  // 🔴 값 문맥은 **버려야** 한다. 승계하면 `setReaskReason(null)`이 지운 화면과 갈린다(R4-F3 형태).
  expect(
    block,
    'fractionWhole을 승계했다 — 키패드로 완결값을 넣은 뒤인데 소수 합성 문맥이 살아남는다(M3 재개방)',
  ).not.toContain('fractionWhole');

  // 대조: 같은 값에 대한 **모드 전환**인 강등은 반대로 승계해야 한다(규칙이 뒤집히지 않았는지).
  const demote = src.slice(src.indexOf('function demoteTrendConfirm'));
  expect(
    demote.slice(0, demote.indexOf('\n}')),
    'demoteTrendConfirm이 fractionWhole을 버렸다 — 강등은 같은 값의 모드 전환이라 승계가 맞다',
  ).toContain('fractionWhole');
});
