/**
 * v0.49 r4 M5 **전제 재검증** 오라클(claude r3 #14) — 예약 있는 '유지' 뒤의 행 복귀 예약.
 *
 * 리뷰의 주장: *"예약 있는 '유지'가 `proceedAfterCommit` 경유하며 `returnStack` 미정리 —
 * 잔존 엔트리가 나중 완료를 엉뚱한 행으로."*
 *
 * 실측이 이긴다(AGENTS §전제 재검증). 코드로 좁히면 이렇다:
 *
 *  ⓐ **`cmdKeep`은 이 성질의 소유자가 아니다.** 같은 상태의 '확인'(`trendResolve` :2524)도
 *    똑같이 `proceedAfterCommit(awaiting)`을 부르고 똑같이 조기 return한다 — `returnStack`
 *    소비는 `advance()`만 한다. 즉 이건 r3 #7이 만든 성질이 아니라 r2 A2가 착지 판정을
 *    `proceedAfterCommit`으로 모으면서 생긴 **두 어휘 공통** 성질이다. :2316만 되돌리면
 *    r3 #7이 세운 대칭(같은 상태·같은 목적의 조작이 어휘에 따라 갈리지 않는다)이 깨진다.
 *
 *  ⓑ **P1 중첩 예약과는 동시에 설 수 없다.** `enterModifyMode`의 `pushReturn`은
 *    `targetRow !== curRow`일 때만 돌고(:1566), 그 조건은 `reviewTarget`이 **없을 때만**
 *    성립한다(있으면 `targetRow = reviewTarget.row = a.row = activeRow`). 그런데
 *    `resumeCell`/`resumeReview` 예약은 `reviewTarget`이 **있을 때만** 실린다(:1544).
 *    두 예약은 구조적으로 배타다.
 *
 *  ⓒ 남는 조합은 **'이전행'이 세운 바깥 예약**뿐이다. 이 스펙이 그 조합을 끝까지 몰아
 *    「나중 완료가 엉뚱한 행으로 가는가」를 실제로 잰다.
 *
 *  ⓓ 그 바깥 예약은 **엉뚱한 행을 가리킬 수 없다.** `setReturn`을 부르는 명령은 '이전행'
 *    (`gotoAdjacentRow(-1)` → `jumpToRow(R-1, {setReturn:true})`) 하나뿐이고, 그것은 항상
 *    **떠나온 바로 아래 행 R**을 예약한다. 나중에 R-1이 완료돼 `advance()`가 돌 때
 *    `findNextIncompleteRow(R-1+1)`의 **탐색 시작점이 정확히 R**이다:
 *      · R이 미완료면 예약도 자연 전진도 R → 같은 행.
 *      · R이 완료면 예약은 pop 후 폴스루로 버려지고(:1190) 자연 전진이 R부터 이어간다 → 같은 행.
 *    즉 잔존 엔트리의 목적지는 **자연 전진과 항상 일치한다.** ('다음행'은 `setReturn(null,null)`로
 *    스택을 먼저 비운다 — 예약을 만들지 않는다.)
 *
 * 판정(①②): 예약은 살아남되 **예약된 그 행으로 정확히** 복귀한다 — 「엉뚱한 행」은 재현되지
 * 않는다. 달라진 것은 목적지가 아니라 **소비 시점**이고, 그 지연이 곧 r3 #7의 계약이다
 * (검토 문맥에 머무는 것). 그래서 이번 회차는 코드를 바꾸지 않고 이 계약을 오라클로 잠근다.
 * 상세 판단과 뒤집을 단일 지점은 `_ASK-fixr4.md` Q1.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** m1 = `trendRule:'increase'`(직전 100.0) → 120.5가 위반값. */
const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 3, sessionAutoLabel: 'r4-m5' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', ''],
  [PREV_ROUND, '이원창', '2', '100.0', ''],
  [PREV_ROUND, '이원창', '3', '100.0', ''],
];

/** 칩존은 **현재 행**의 값을 그린다 — 행 판별자로 쓴다(행 표시 testid는 없다). */
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
  await waitForTtsIdle(page);
}

/**
 * ⓒ의 조합을 만든다:
 *   1행 완주 → 2행 m1 커밋 → '이전행'(= **바깥 복귀 예약 {행2}**) → 1행 검토 대기
 *   → "수정 120.5"(위반) → 알람 + `resumeReview:1` → '수정'(강등, 예약 보존) → '유지'
 */
async function keepWithLiveReservation(page: Page) {
  await fireStt(page, '95.5', 900);
  await fireStt(page, '88.8', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '95.5', 1500); // 2행 m1
  await waitForTtsIdle(page);

  await fireStt(page, '이전행', 1800); // 바깥 예약 {행2} + 1행 검토 대기
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).join(' | '), '전제: 1행 검토 대기').toContain('1행 완료됨');

  await fireStt(page, '수정 120.5', 1800);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await waitForTtsIdle(page);

  await fireStt(page, '수정', 1800); // 알람만 해제하고 modify로 강등(예약 보존)
  await waitForTtsIdle(page);
  await fireStt(page, '유지', 1800); // r3 #7 — 예약이 있으므로 proceedAfterCommit
  await waitForTtsIdle(page);
}

test('① 예약 있는 「유지」는 검토 문맥으로 복귀한다 — 행 예약을 파기하지도, 즉시 소비하지도 않는다', async ({ page }) => {
  await bootMini(page);
  const before = (await ttsLog(page)).length;
  await keepWithLiveReservation(page);
  const spoken = (await ttsLog(page)).slice(before).join(' | ');

  // r3 #7 계약: 검토 대기 재진입(값 재낭독). 종전 advance() 경로였다면 여기서 2행으로 튀었다.
  expect(spoken, '「유지」가 검토 문맥을 파괴하고 전진했다').toContain('1행 완료됨');
  await expect(chip(page, '측정항목01'), '커서가 1행에 남아 있다(1행의 정정값)').toContainText('120.5');
});

test('② 남은 행 예약은 나중에 **예약된 그 행으로** 소비된다 — 「엉뚱한 행」은 재현되지 않는다', async ({ page }) => {
  await bootMini(page);
  await keepWithLiveReservation(page);

  // 검토 대기에서 다시 정정에 들어가 1행을 재완성시킨다 — 그 완료가 `advance()`를 타고
  // 바깥 예약을 소비하는 유일한 지점이다(`land:'review'`는 셀 예약을 싣지 않는다).
  await fireStt(page, '수정', 1800); // 캐스케이드(01부터 행 끝까지 비움)
  await waitForTtsIdle(page);
  const before = (await ttsLog(page)).length;
  await fireStt(page, '77.7', 1500); // m1 재기록
  await fireStt(page, '66.6', 2500); // m2 재기록 → 1행 재완료 → 예약 소비
  await waitForTtsIdle(page);
  const spoken = (await ttsLog(page)).slice(before).join(' | ');

  // 🔴 리뷰가 우려한 「엉뚱한 행」이면 여기서 3행(또는 끝 도달)이 나온다.
  //   행 전환 안내는 샘플키 컬럼으로 말한다(`announceRowDiff` — "조사나무 1 완료. 조사나무 2.").
  expect(spoken, '1행 재완료가 안 났다').toContain('조사나무 1 완료');
  expect(spoken, '복귀처가 예약된 2행이 아니다(3행/끝 도달이면 엉뚱한 행)').toContain('조사나무 2');
  expect(spoken, '3행으로 건너뛰었다').not.toContain('조사나무 3');
  await expect(chip(page, '측정항목01'), '칩이 2행의 값을 그린다(1행의 77.7이면 복귀 안 함)')
    .toContainText('95.5');
  expect(await activeChipName(page), '2행의 남은 빈 칸에 선다').toContain('측정항목02');
});
