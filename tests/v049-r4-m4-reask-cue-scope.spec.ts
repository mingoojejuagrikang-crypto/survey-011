/**
 * v0.49 r4 M4 오라클(claude r3 #6) — **거절 큐는 그 셀의 것이다.**
 *
 * 재질문 사유(`ReaskCue`)를 내리는 착지는 넷인데 `announceField`만 그 줄이 없었다
 * (`announceEndReached` · `enterReviewWait` · `enterCellWait`은 전부 갖고 있다. sessionStore의
 * `reaskReason` 주석도 *"성공 커밋·다음 필드 진입 시 null로 리셋한다"* 라고 계약을 적어 뒀다).
 *
 * 그래서 거절당한 셀을 **떠나도** 큐가 새 셀 위에 그대로 얹혀 있었다. 화면을 자주 못 보는
 * 사용자가 눈을 들었을 때(PRINCIPLES §2) 「방금 말한 값이 거절됐다」로 읽는다 — 실제로는
 * 그 셀에 아무 말도 하지 않았는데도.
 *
 * ③은 M4가 **새로 배선한 예외**의 무회귀 가드다: 소수부 재질문 문맥(`opts.fractionWhole`)은
 * 지나간 거절이 아니라 **지금 살아 있는 대기 상태**다. `awaiting`이 정수부를 들고 재개하므로
 * (C-FIX1b) 화면만 비우면 M3가 닫은 「무고지 합성」이 재개 경로로 되살아난다.
 *
 * 반증(`setReaskReason(null)` 제거 시): ① red. ②③은 양방향 green(대조군·가드).
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'r4-m4' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '']];

const cue = (page: Page) => page.locator('[data-testid="reask-cue"]');

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

/** 01에서 KNOWN_NOISE 거절을 유도해 큐를 세운다. */
async function rejectOn01(page: Page) {
  await fireStt(page, '변경', 1500);
  await waitForTtsIdle(page);
  await expect(cue(page), '전제: 거절 큐가 섰다').toBeVisible({ timeout: 4000 });
}

test('① 거절당한 셀을 떠나면 큐도 함께 사라진다 — 다음 셀이 남의 사유를 이고 있지 않는다', async ({ page }) => {
  await bootMini(page);
  await rejectOn01(page);

  await fireStt(page, '다음', 1500); // 항목 이동 — 빈 셀이라 announceField 착지
  await waitForTtsIdle(page);

  expect(await activeChipName(page), '전제: 02로 이동했다').toContain('측정항목02');
  expect((await ttsLog(page)).at(-1), '전제: 새 셀 안내가 나갔다').toBe('측정항목02.');
  await expect(cue(page), '떠난 셀의 거절 사유가 새 셀에 남아 있다').toHaveCount(0);
});

test('② 대조군 — 같은 셀에 머무는 동안 큐는 살아 있다(r3 #5·#6 계약 무회귀)', async ({ page }) => {
  await bootMini(page);
  await rejectOn01(page);

  // 거절 직후 그대로 둔다. 큐는 다음 발화를 기다리는 신호이므로 사라지면 안 된다.
  await page.waitForTimeout(1200);
  await expect(cue(page)).toBeVisible();
  await expect(cue(page)).toHaveAttribute('data-reason', 'parse_failed');
  expect(await activeChipName(page), '커서도 그대로다').toContain('측정항목01');
});

test('③ 가드 — 소수 재질문 중 일시정지→재시작은 문맥 큐를 다시 그린다(M4 예외)', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '111 점 에', 1500); // 소수부 유실 → 정수부 111 보존 타깃 재질문
  await waitForTtsIdle(page);
  await expect(cue(page)).toContainText('111 점, 소수점 아래');

  await fireStt(page, '일시 정지', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '재시작', 2000);
  await waitForTtsIdle(page);

  // 🔴 재개 재안내가 `announceField(cur, {fractionWhole})`을 타는데, 거기서 큐만 비우면
  //   `awaiting`은 정수부를 든 채라 다음 '오'가 무고지로 111.5가 된다(M3가 닫은 그 형태).
  await expect(cue(page), '재개 후 소수 문맥이 화면에서 사라졌다').toContainText('111 점, 소수점 아래');
});
