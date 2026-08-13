/**
 * v0.49 r2 A2 오라클 — **cellWait에서의 탈출은 2단계 수정·알람 경유에서도 cellWait 재진입이다**
 * (codex F1 = 리뷰 합집합 C3, 가드레일 [NAV-FILLED-CELL-1]).
 *
 * fix49b가 세운 불변식은 *"cellWait에서의 모든 탈출은 cellWait 재진입"* 이다 — 사용자가
 * 「이전」/「다음」으로 **의도적으로 이동해 들어온** 검토 문맥을, 그 문맥이 초대한 정정 자체가
 * 파괴하면 안 된다. 그런데 두 경로가 그 예약을 들고 다니지 못해 새고 있었고, 기존 오라클은
 * 그 두 경로를 **비켜서** 단언했다(`v049-f1-field-nav.spec.ts:289`가 2단계 수정은 advance로
 * 빠진다고 적고 그 경로 대신 「수정 44.4」만 쟀다 — 게이트 507 green이 이 전이를 반증하지 못한 이유).
 *
 *   ① **2단계 수정** — bare 「수정」 후 값 재발화. `announceField`가 modify로 재무장하며 셀 출신을
 *      잃었고, 재발화 커밋 종단은 행 예약만 보고 `advance()`로 빠졌다.
 *   ② **알람 경유** — 「수정 <이상치값>」이 이상치 알람을 띄우고 「확인」으로 해소되는 경로.
 *      종전 코드는 *"land:'cell'은 의도적으로 예약하지 않는다"* 는 주석과 함께 예약을 생략했다.
 *
 * 두 경로 모두 **값은 저장되고 다른 셀도 안전하다** — 깨지는 것은 검토 문맥이다. 그래서 값
 * 단언이 아니라 **착지 상태**(활성 칩 · 「기록값」 낭독 · bare 값 흡수)를 잰다.
 *
 * 픽스처는 `v049-fix49b-cellwait-alert.spec.ts`와 같은 골격(activeZones boot + trendRule
 * 'increase' · 직전 회차 100.0) — 같은 상태를 다른 축에서 재는 스펙끼리 픽스처를 갈라놓지 않는다.
 * gUM은 `boot`의 MOCK_INIT_SCRIPT가 담당한다([TEST-GUM-1]).
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
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'r2a2' },
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

/** 01에 값을 넣고 「이전」으로 되돌아가 **셀 검토 대기(cellWait)** 를 만든다. */
async function enterCellWaitOn01(page: Page) {
  await fireStt(page, '95.5', 900);
  await expect(chip(page, '측정항목01')).toContainText('95.5');
  expect(await activeChipName(page)).toContain('측정항목02');

  await waitForTtsIdle(page);
  await fireStt(page, '이전', 1200);
  await waitForTtsIdle(page);
  expect(await activeChipName(page)).toContain('측정항목01');
  expect((await ttsLog(page)).join(' | '), '착지 안내(기록값 낭독)가 나야 cellWait이다').toContain('기록값');
}

/** cellWait 재진입의 실증 — bare 값은 **흡수**된다(kind:'value'가 열렸다면 덮어쓴다). */
async function expectAbsorbsBareValue(page: Page, colName: string, keep: string) {
  await waitForTtsIdle(page);
  await fireStt(page, '99.9', 1200);
  const after = await chip(page, colName).innerText();
  expect(after, '복귀처가 cellWait이 아니다 — filled 셀에 값 대기가 열렸다').toContain(keep);
  expect(after).not.toContain('99.9');
}

test('① 2단계 수정(bare 「수정」 → 값 재발화)은 같은 셀의 검토 대기로 복귀한다 (F1)', async ({ page }) => {
  await bootMini(page);
  await enterCellWaitOn01(page);

  // bare 「수정」 → 그 셀만 비우고 재기록을 기다린다(fix49b ①의 계약 — 여기서는 그 **다음**을 잰다).
  await fireStt(page, '수정', 1200);
  await waitForTtsIdle(page);
  const before = (await ttsLog(page)).length;

  // 재발화 커밋. 직전 회차 100.0 대비 감소라 이상치 알람은 끼지 않는다(②가 그 축을 잰다).
  await fireStt(page, '97.5', 1500);
  await waitForTtsIdle(page);
  const spoken = (await ttsLog(page)).slice(before).join(' | ');

  await expect(chip(page, '측정항목01')).toContainText('97.5');
  // 🔴 종전엔 여기서 `advance()`가 돌아 다음 빈 칸(02)으로 튀었다 — 사용자가 검토하러 들어온
  //    셀이 정정 한 번으로 사라진다. 값은 저장되므로 조용히 지나간다.
  expect(await activeChipName(page), '2단계 수정이 셀 검토 문맥을 파괴하고 전진했다').toContain('측정항목01');
  expect(spoken, '복귀 시 갱신값을 되읽어야 한다(cellWait 낭독)').toContain('기록값');
  expect(spoken).toContain('97.5');

  await expectAbsorbsBareValue(page, '측정항목01', '97.5');
});

test('② 알람 경유(「수정 <이상치값>」 → 「확인」)도 같은 셀의 검토 대기로 복귀한다 (F1)', async ({ page }) => {
  await bootMini(page);
  await enterCellWaitOn01(page);

  // 직접값 수정이 이상치(직전 100.0 대비 증가)라 알람이 뜬다.
  await fireStt(page, '수정 120.5', 1500);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await waitForTtsIdle(page);
  const before = (await ttsLog(page)).length;

  // 「확인」 = 값 유지·알람 해소. 그 다음 착지가 이 스펙의 대상이다.
  await fireStt(page, '확인', 1500);
  await waitForTtsIdle(page);
  const spoken = (await ttsLog(page)).slice(before).join(' | ');

  await expect(chip(page, '측정항목01')).toContainText('120.5');
  // 🔴 종전 코드는 이 조합에서 **의도적으로** 복귀를 예약하지 않았다("착지처는 어차피 빈 칸").
  //    값 손상 축으로는 맞지만 계약 축에서 틀렸다 — 검토 문맥이 알람 한 번에 증발한다.
  expect(await activeChipName(page), '알람 경유 수정이 셀 검토 문맥을 파괴하고 전진했다').toContain('측정항목01');
  expect(spoken, '복귀 시 갱신값을 되읽어야 한다(cellWait 낭독)').toContain('기록값');
  expect(spoken).toContain('120.5');

  await expectAbsorbsBareValue(page, '측정항목01', '120.5');
});

test('③ 알람 [확인] **버튼**도 음성 「확인」과 같은 곳에 착지한다 — 입력 수단으로 갈리지 않는다', async ({ page }) => {
  await bootMini(page);
  await enterCellWaitOn01(page);

  await fireStt(page, '수정 120.5', 1500);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await waitForTtsIdle(page);
  const before = (await ttsLog(page)).length;

  // 🔴 같은 상태·같은 목적의 조작이 **입력 수단에 따라** 갈리면 안 된다(fix49b #7이 키패드
  //    재커밋에서 세운 대칭). 종전엔 이 터치 형제(`confirmAnomalyTouch`)만 행 예약을 직접 읽고
  //    `advance()`를 불렀다 — 음성 경로를 고쳐도 버튼은 그대로 새는 형태였다.
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await page.waitForTimeout(1200);
  await waitForTtsIdle(page);
  const spoken = (await ttsLog(page)).slice(before).join(' | ');

  await expect(chip(page, '측정항목01')).toContainText('120.5');
  expect(await activeChipName(page), '[확인] 버튼이 셀 검토 문맥을 파괴하고 전진했다').toContain('측정항목01');
  expect(spoken, '복귀 시 갱신값을 되읽어야 한다(cellWait 낭독)').toContain('기록값');

  await expectAbsorbsBareValue(page, '측정항목01', '120.5');
});
