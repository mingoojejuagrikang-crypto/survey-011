/**
 * v0.49 r3 #14 오라클 — **검토 낭독과 흡수 안내는 접두가 같다**(claude r2 LOW, 관측창 오염).
 *
 * `enterReviewWait`의 낭독은 `"{N}행 완료됨. <항목> <값>, …"` 이고, bare 값 흡수 안내
 * (`reviewWaitAbsorbTts`, 확정표 #4)는 `"{N}행 완료됨. 수정 또는 다음행."` 이다 — **접두가 같다.**
 * 접두만 보는 관측창은 두 사건을 하나로 세고, 「진입 낭독 N회」 류의 정확 개수 단언이 흡수 한 번에
 * 조용히 갈린다(실측: 기존 predicate로 세면 1이어야 할 자리가 2다).
 *
 * ⚠️ **문구는 바꾸지 않는다** — 둘 다 민구 확정 바이트다(브리핑 명시). 처방은 **관측창을 옮기는
 * 것**이고, 판별자는 SSOT(`voicePrompts.reviewWaitAbsorbTts`)에서 가져온다. 리터럴 사본을 두면
 * 확정 바이트가 갈릴 때 관측창이 먼저 썩는다.
 *
 * 같은 커밋에서 실사용 관측창 3곳을 옮겼다:
 *   · `v0470-r2-p1-direct-modify-trend.spec.ts:52`(reviewSays — 정확 개수)
 *   · `v0440-c8-flow.spec.ts:290`(재무장 증명 — 증가량)
 *   · `manual-input.spec.ts:398`(재낭독 — 개수 하한)
 *
 * 반증: 아래 ①의 `reviewOnly`를 접두 단독(`startsWith`)으로 되돌리면 red(1 → 2).
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';
import { reviewWaitAbsorbTts } from '../src/lib/voicePrompts';

test.setTimeout(120_000);

const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'r3-14' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', '5.0'],
  [PREV_ROUND, '이원창', '2', '100.0', '5.0'],
];

/** 접두만 보는 **종전** 관측창 — 두 사건을 하나로 센다. */
const byPrefix = (log: string[]) => log.filter((t) => t.startsWith('1행 완료됨'));
/** 낭독만 보는 **현행** 관측창 — 흡수 바이트를 SSOT로 배제한다. */
const reviewOnly = (log: string[]) => byPrefix(log).filter((t) => t !== reviewWaitAbsorbTts(1));

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
}

test('① 흡수가 한 번 끼어도 「검토 진입 낭독」 개수는 그대로다 — 관측창이 두 사건을 가른다', async ({ page }) => {
  await bootMini(page);
  // 1행 완주 → 2행으로 전진.
  await fireStt(page, '11.1', 900);
  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);

  // '이전행' → 완료 행 착지 = 검토 대기 진입 낭독 1회.
  await fireStt(page, '이전행', 1500);
  await waitForTtsIdle(page);
  expect(reviewOnly(await ttsLog(page)), '전제: 검토 진입 낭독 1회').toHaveLength(1);

  // bare 값 발화 → **흡수**된다(덮어쓰기 금지). 안내 문구는 같은 접두로 시작한다.
  await fireStt(page, '99.9', 1500);
  await waitForTtsIdle(page);
  const log = await ttsLog(page);

  expect(log, '전제: 흡수 안내가 확정 바이트로 나왔다').toContain(reviewWaitAbsorbTts(1));
  // 🔴 종전 관측창은 여기서 2를 센다 — 검토에 **들어간 적 없는** 사건을 진입으로 오인한다.
  expect(byPrefix(log).length, '전제: 접두만 보면 두 사건이 하나로 합쳐진다').toBe(2);
  expect(reviewOnly(log), '흡수가 검토 진입 낭독으로 오집계됐다').toHaveLength(1);
});

test('② 진짜 재진입은 그대로 센다 — 배제가 과잉이 아니다(대조군)', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '11.1', 900);
  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);

  await fireStt(page, '이전행', 1500);
  await waitForTtsIdle(page);
  expect(reviewOnly(await ttsLog(page))).toHaveLength(1);

  // 검토 대기 출신 직접 수정 → 값 반영 후 **검토 대기 재진입**(v0.33.0 항목2 계약).
  await fireStt(page, '수정 33.3', 1800);
  await waitForTtsIdle(page);
  expect(reviewOnly(await ttsLog(page)), '재진입 낭독이 배제에 삼켜졌다').toHaveLength(2);
});
