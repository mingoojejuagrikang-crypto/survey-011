/**
 * v0.47.0-r2 P1(FB-A · 민구 실기기 08-09) — **직접 수정("수정 <값>")도 추세 평가를 받는다.**
 *
 * 무엇이 깨져 있었나: 추세 검사는 일반 음성 커밋 경로와 수동 커밋 경로에만 걸려 있었고,
 * `enterModifyMode`의 **직접값 분기**만 `evaluateTrend`를 부르지 않았다. 그래서 음성
 * 「수정 77」로 들어온 값은 설정 임계를 아무리 넘겨도 조용히 섰다.
 * 실측(08-09 세션 로그, +84.5초): row4 횡경 117→77 direct_modify, 직전 회차 111.1 대비
 * -30.9%(설정 decrease·10% 초과)인데 **trend 이벤트 0건**. 민구 원문 *"지금 값 알람 조건에
 * 맞을거야. 근데 알람 발생이 없어."*
 *
 * 이 스펙이 고정하는 계약 3개:
 *  ⓐ 직접 수정 커밋이 위반이면 **알람 팝업 + 응답 대기(trendConfirm)** 가 뜬다.
 *  ⓑ 위반이면 **에코("수정 <항목> <값>") 대신 알람 TTS** — 일반 커밋 경로의 계약과 동일.
 *     (동시에: 값 자체는 롤백되지 않고 칩에 그대로 선다 — 알림 ≠ 롤백.)
 *  ⓒ 해소('확인') 후 **원래 대기하던 필드로 돌아온다.** 포인터를 수정 대상 셀로 옮겨 두고
 *     advance()의 자연 진행(채워진 칸 건너뛰기)에 태우는 방식이라, 착지가 알람이 없었을 때와
 *     같아야 한다. 검토 대기(reviewWait) 출신이면 착지는 **검토 대기 재진입**이다(v0.33.0 항목2).
 *
 * ⚠️ 픽스처 전제: activeZones의 측정항목01만 `trendRule: 'increase'`(= 직전보다 **커지면** 알람,
 *    trendCheck.ts 헤더)이고 직전 회차값은 100.0이다. 그래서 정상값 = 100.0, 위반값 = 120.5.
 * ⚠️ 왕복 OFF([TEAMOPS-81]) — activeZones SETTINGS가 `chipSweepSeconds: 0`을 갖는다.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog } from './fixtures/stt';

test.setTimeout(120_000);

/** 검토 대기(reviewWait)까지 가려면 **한 행을 완주**해야 한다. activeZones 기본 12 음성 컬럼으로는
 *  발화 12회가 필요하고, 실측에서 그 사이 안내 TTS와 겹친 final이 삼켜져 행이 완료되지 않았다
 *  (speech.ts — TTS 재생 중 비명령 결과는 걸러진다). 2 음성 컬럼으로 줄여 3발화로 완주시킨다.
 *  추세 전제는 동일하게 유지: 측정항목01만 `trendRule: 'increase'`(커지면 알람) · 직전값 100.0. */
const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'r2-p1-mini' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '5.0'],
  [PREV_ROUND, '이원창', '2', '100.0', '5.0'],
];

/** 「N행 완료됨 …」 검토 낭독만 추린다 — 검토 대기 진입/재진입의 유일한 관측 창이다. */
const reviewSays = (log: string[]) => log.filter((t) => t.startsWith('1행 완료됨'));

const chip = (page: Page, name: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${name}"]`);

/** 지금 활성인 칩의 컬럼명(포인터 착지 판정용). */
async function activeChipName(page: Page): Promise<string | undefined> {
  return page.evaluate(() =>
    (document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null)
      ?.dataset.colName);
}

test('P1ⓐⓑⓒ 🔴 직접 수정이 이상치면 알람이 뜨고, 에코 대신 알람 TTS가 나가며, 확인 후 원위치로 돌아온다', async ({ page }) => {
  await boot(page, PHONE_402);

  // 측정항목01 = 100.0 (직전값과 같음 → 통과) → 측정항목02 대기.
  await fireStt(page, '100.0', 700);
  expect(await activeChipName(page), '정상 커밋 후 다음 필드로 전진').toBe('측정항목02');

  // 🔴 여기가 회귀 지점 — 「수정 120.5」는 측정항목01(직전 100.0)을 겨냥한 direct_modify다.
  //    종전 코드는 값만 세우고 조용히 측정항목02를 재안내했다(알람 0건).
  await fireStt(page, '수정 120.5', 1000);

  // ⓐ 알람 팝업 + 응답 대기.
  await expect(page.locator('[data-testid="anomaly-alert"]'), '직접 수정 위반 → 알람 팝업')
    .toBeVisible({ timeout: 6000 });
  // 값은 롤백되지 않는다(알림 ≠ 롤백 — 일반 경로와 같은 계약).
  await expect(chip(page, '측정항목01')).toContainText('120.5');
  // 포인터는 수정 대상 셀로 옮겨 간다(알람이 난 칩이 활성 = 일반 음성 알람과 같은 화면).
  expect(await activeChipName(page), '알람 중 활성 칩 = 알람 난 셀').toBe('측정항목01');

  // ⓑ 위반이면 에코 대신 알람 TTS. 「수정 측정항목01 120.5」가 나갔다면 계약 위반이다.
  const spoken = await ttsLog(page);
  expect(
    spoken.filter((t) => t.startsWith('수정 측정항목01 120')),
    '위반 커밋은 에코하지 않는다(알람 TTS가 대신 나간다)',
  ).toHaveLength(0);
  expect(
    spoken.filter((t) => t.startsWith('추세 알람')),
    '알람 TTS가 실제로 발화됐다(무음 알람 금지 — fb-27-9 계약)',
  ).not.toHaveLength(0);

  // ⓒ '확인' → 해소 후 **원래 대기하던 필드**(측정항목02)로 복귀.
  await fireStt(page, '확인', 1000);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null)
      ?.dataset.colName === '측정항목02',
    { timeout: 6000 },
  );
});

test('P1ⓒ-review 🔴 검토 대기 출신 직접 수정: 알람 해소 후 착지는 advance가 아니라 검토 대기 재진입', async ({ page }) => {
  // v0.33.0 항목2 계약(검토 대기 출신 커밋은 advance로 검토를 강제 종료하지 않는다)이 **알람을
  // 경유하는 경로**에서도 서는지 본다. 알람 해소 지점은 전부 advance()로 끝나므로, 대기 상태가
  // 착지처(resumeReview)를 들고 다니지 않으면 이 조합에서만 계약이 깨진다.
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });

  // 1행 완주(측정항목01=100.0 통과값, 측정항목02=10.0) → 2행으로 전진 → '이전'으로 되돌아오면
  // 완료 행 착지 = 검토 대기(값 낭독 + 명령 대기).
  await fireStt(page, '100.0', 700);
  await fireStt(page, '10.0', 900);
  await fireStt(page, '이전', 1500);
  expect(reviewSays(await ttsLog(page)), '검토 대기 진입 낭독 1회').toHaveLength(1);

  // 검토 대기 중 「수정 120.5」 = 포인터 컬럼(측정항목01) 직접 수정 → 위반 → 알람.
  await fireStt(page, '수정 120.5', 1200);
  await expect(page.locator('[data-testid="anomaly-alert"]'), '검토 대기 출신 직접 수정도 알람')
    .toBeVisible({ timeout: 6000 });

  // '확인' → 검토 대기 **재진입**("1행 완료됨 …" 재낭독). advance로 빠지면 이 낭독이 늘지 않는다.
  await fireStt(page, '확인', 1200);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
  const after = reviewSays(await ttsLog(page));
  expect(after, '해소 후 검토 대기 재진입(낭독 2회째)').toHaveLength(2);
  // 갱신값이 재낭독에 반영돼 있어야 한다(재낭독의 의미 — 종전 계약 보존의 증거).
  expect(after[1], '검토 재낭독에 정정값 반영').toContain('120.5');
});
