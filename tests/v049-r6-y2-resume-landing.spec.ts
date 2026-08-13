/**
 * 🔴 v0.49 r6 Y2 오라클(claude #1) — **재시작이 착지 문맥을 버리면 확정값이 덮인다.**
 *
 * `resume()`은 일시정지 전 `awaiting` 문맥을 kind별로 복원한다(modify · trendConfirm · cellWait).
 * 그 목록에서 **`atEnd`와 `reviewWait`만 빠져 있었고**, 빠진 둘은 마지막 `announceField(cur)`로
 * 떨어져 **값이 확정된 셀 위에 `kind:'value'`를 다시 열었다**([CELL-OVERWRITE-1] 그 자체).
 * fix49가 cellWait을 고칠 때 이 둘을 "선행 파손"으로 남긴 자리이고, 그 주석이 *"고칠 사람은 이
 * 목록에 두 kind를 더 얹으면 된다"* 고 적어 둔 그 목록이다.
 *
 * 실측 재현(수정 전, 2026-08-14 fixr6):
 *   · 끝 도달 → '일시 정지' → '재시작' : 마지막 안내가 「측정항목01.」(값 대기) →
 *     이어 말한 「구십구 점 구」가 **확정값 35.1을 99.9로 덮었다.**
 *   · 완료 행 착지가 일시정지 중이면(착지는 `armLanding`이 국면만 보류하고 센티넬은 세운다)
 *     재시작이 검토 문맥을 버리고 같은 방식으로 값을 열었다.
 *
 * 처방은 문맥 재구성이 아니라 **착지 재실행**이다 — 그래야 `armLanding`의 paused 분기가
 * 건너뛴 `phase`/`endReached` 래치까지 한 벌로 다시 선다.
 *
 * 반증(두 분기를 지우면): ① red(값이 덮인다) · ② red(검토 문맥이 사라진다). ③은 대조군.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

function columns(seqTo: number) {
  return [
    { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
    { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: seqTo }, sampleKey: true },
    { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  ];
}

async function bootRows(page: Page, rows: number) {
  await boot(page, PHONE_402, {
    settings: {
      ...AZ_SETTINGS,
      state: { ...AZ_SETTINGS.state, columns: columns(rows), totalRows: rows, sessionAutoLabel: 'r6-y2' },
    } as unknown as typeof AZ_SETTINGS,
    headers: ['조사일자', '농가명', '조사나무', '측정항목01'],
    sheetRows: [[PREV_ROUND, '이원창', '1', '100.0']],
  });
  await waitForTtsIdle(page);
}

const m1Chip = (page: Page) => page.locator('[data-testid="column-chip"][data-col-name="측정항목01"]');

async function pauseAndResume(page: Page) {
  await fireStt(page, '일시 정지', 1200);
  await waitForTtsIdle(page);
  await expect(page.locator('[data-testid="paused-card"]'), '전제: 일시정지에 들어갔다').toBeVisible({ timeout: 4000 });
  await fireStt(page, '재시작', 1500);
  await waitForTtsIdle(page);
}

test('① 끝 도달에서 재시작하면 끝 도달로 돌아온다 — 값 발화가 확정 셀을 덮지 않는다', async ({ page }) => {
  await bootRows(page, 1);
  await fireStt(page, '삼십오 점 일', 1500);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: 끝 도달 안내가 나왔다').toContain('마지막행 입력');

  await pauseAndResume(page);
  expect(
    (await ttsLog(page)).at(-1),
    '재시작이 끝 도달을 버리고 값 대기를 열었다 — 확정 셀 위의 kind:value(CELL-OVERWRITE-1)',
  ).toContain('마지막행 입력');

  // 끝 도달의 계약: 일반 값 발화는 새 커밋이 아니라 **끝 도달 재안내로 흡수**된다.
  await fireStt(page, '구십구 점 구', 1500);
  await waitForTtsIdle(page);
  await expect(m1Chip(page), '확정값이 조용히 덮였다 — 프로덕션 시트로 나가는 값이다').toContainText('35.1');
  expect((await ttsLog(page)).at(-1), '값이 흡수되지 않고 커밋됐다').toContain('마지막행 입력');
});

test('② 일시정지 중 완료 행 착지도 재시작이 검토 대기로 복원한다', async ({ page }) => {
  await bootRows(page, 2);
  await fireStt(page, '삼십오 점 일', 1500); // 1행 완료 → 2행
  await waitForTtsIdle(page);

  await fireStt(page, '일시 정지', 1200);
  await waitForTtsIdle(page);
  // 일시정지 중에도 열려 있는 경로: 자동입력 칩 인라인 편집 → 완료 행(1행)으로 점프.
  const seq = page.locator('[data-testid="column-chip"][data-col-name="조사나무"]');
  await seq.click();
  const input = seq.locator('input');
  await expect(input, '전제: 자동입력 칩이 인라인 편집으로 열린다').toBeVisible({ timeout: 4000 });
  await input.fill('1');
  await input.press('Enter');
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: 검토 대기 착지가 실제로 일어났다').toContain('1행 완료됨');
  await expect(page.locator('[data-testid="paused-card"]'), '전제: 착지가 일시정지를 풀지 않았다(Z2)').toBeVisible();

  await fireStt(page, '재시작', 1500);
  await waitForTtsIdle(page);
  expect(
    (await ttsLog(page)).at(-1),
    '재시작이 검토 문맥을 버리고 값 대기를 열었다',
  ).toContain('1행 완료됨');

  await fireStt(page, '구십구 점 구', 1500);
  await waitForTtsIdle(page);
  await expect(m1Chip(page), '검토 대기의 값 흡수 계약이 깨져 확정값이 덮였다').toContainText('35.1');
});

test('③ 대조군 — 값 입력 중 일시정지→재시작은 종전대로 그 칸을 다시 묻는다', async ({ page }) => {
  await bootRows(page, 2);
  await pauseAndResume(page);
  expect(
    (await ttsLog(page)).at(-1),
    '빈 칸 대기 중의 재시작까지 착지로 바뀌면 정상 흐름이 멈춘다',
  ).toBe('측정항목01.');

  await fireStt(page, '삼십오 점 일', 1500);
  await waitForTtsIdle(page);
  // 1행이 완료되고 2행으로 전진한다(m1이 유일한 음성 컬럼이라 칩은 다음 행의 빈 칸을 보여준다).
  expect(
    (await ttsLog(page)).join(' | '),
    '재개 후 정상 커밋이 막혔다',
  ).toContain('조사나무 1 완료.');
});
