/**
 * v0.49 r7 #3 오라클(codex r6#12) — **다중 점프의 복귀 스택은 커버리지 장치다. 줄이면 행을 잃는다.**
 *
 * 리뷰 우려: Y8이 `jumpToRow`의 `setReturn`(전체 교체)을 `pushReturn`(스택)으로 바꾼 뒤, 다중
 * 점프에서 완료 복귀가 **낡은 점프 이력으로 끌린다**. 브리핑의 처방 후보는 둘이었다 —
 * ⓐ 점프 시 기존 스택 교체(「점프 = 새 문맥」) ⓑ 스택 상한. **실측으로 둘 다 기각했다.**
 *
 * 실측(2026-08-14, 포트 5197 · 5행 1음성컬럼 · 자동칩 점프 1→3→5 뒤 매 행 커밋):
 *   · 현행(push): 완주 순서 **5 → 3 → 1 → 2 → 4**, 「완료된 행은 5행」.
 *     LIFO 되감기가 **점프로 건너뛴 행을 전부 회수한다.**
 *   · 후보ⓐ(교체): 완주 순서 **5 → 3 → 4**, 「완료된 행은 3행. 1행, 2행이 비어 있습니다.」
 *     `findNextIncompleteRow`는 **아래만 본다**(wrap-around 없음). 그래서 예약을 버리는 순간
 *     그 위쪽 행으로 돌아갈 경로가 **구조적으로 사라진다** — 사용자는 빈 행을 안내로만 듣고
 *     그리로 갈 방법이 없다. 후보ⓑ(상한)는 상한을 넘긴 점프에서 같은 손실을 낸다(상한 1 = ⓐ).
 *
 * 👉 판정: **무수정.** 「낡은 이력으로 끌림」은 결함이 아니라 이 자료구조의 목적이다. 대신
 *   그 성질이 다음 회차에 「정리」로 지워지지 않게 **커버리지 자체를 오라클로 잠근다** —
 *   이 파일이 red가 되면 그건 행 유실이다(fixr5 Z7 ①기각 + 계약 등재와 같은 처리).
 *
 * 반증: `jumpToRow`의 `pushReturn`을 `setReturn`으로 되돌리면 ①이 red(5행 → 3행).
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const COLS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 5 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const bootR7 = (page: Page) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: COLS, totalRows: 5, sessionAutoLabel: 'r7-03' },
  } as unknown as typeof AZ_SETTINGS,
  headers: ['조사일자', '조사나무', '측정항목01'],
  sheetRows: [1, 2, 3, 4, 5].map((i) => [PREV_ROUND, String(i), '']),
});

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);

/** 자동 컬럼 칩 인라인 편집 → `computeRowFromAutoChange` → 행 점프(예약을 쌓는 진입로). */
async function jumpTo(page: Page, row: string) {
  await chip(page, '조사나무').click({ force: true });
  const input = chip(page, '조사나무').locator('input');
  await expect(input, '전제: 자동칩 인라인 편집이 열린다').toBeVisible({ timeout: 4000 });
  await input.fill(row);
  await input.press('Enter');
  await waitForTtsIdle(page);
}

test('① 두 번 점프해도 건너뛴 행이 전부 회수된다 — 예약 스택이 커버리지를 만든다', async ({ page }) => {
  await bootR7(page);
  await waitForTtsIdle(page);

  await jumpTo(page, '3'); // 예약 [1]
  await jumpTo(page, '5'); // 예약 [1, 3]
  expect((await ttsLog(page)).at(-2), '전제: 5행에 서 있다').toBe('조사나무 5.');

  const visited: number[] = [];
  for (let i = 0; i < 5; i++) {
    await fireStt(page, '십일 점 일', 1700);
    await waitForTtsIdle(page);
    const done = (await ttsLog(page)).filter((t) => /조사나무 \d+ 완료\./.test(t)).at(-1);
    if (done) visited.push(Number(done.match(/조사나무 (\d+)/)![1]));
  }

  expect(
    visited,
    'LIFO 되감기가 점프 출발점을 순서대로 회수한다 — 이 순서가 깨지면 위쪽 행으로 갈 경로가 없다',
  ).toEqual([5, 3, 1, 2, 4]);

  const tts = await ttsLog(page);
  expect(
    tts.some((t) => t.includes('완료된 행은 5행')),
    '예약을 버리면 「완료된 행은 3행. 1행, 2행이 비어 있습니다.」가 된다(실측) = 행 유실',
  ).toBe(true);
  expect(
    tts.some((t) => t.includes('비어 있습니다')),
    '빈 행 안내가 나오면 그 행으로 갈 경로가 없다는 뜻이다(findNextIncompleteRow는 아래만 본다)',
  ).toBe(false);
});

test('② 대조군 — 점프가 없으면 예약이 서지 않고 자연 전진 그대로다', async ({ page }) => {
  await bootR7(page);
  await waitForTtsIdle(page);

  const visited: number[] = [];
  for (let i = 0; i < 5; i++) {
    await fireStt(page, '십일 점 일', 1700);
    await waitForTtsIdle(page);
    const done = (await ttsLog(page)).filter((t) => /조사나무 \d+ 완료\./.test(t)).at(-1);
    if (done) visited.push(Number(done.match(/조사나무 (\d+)/)![1]));
  }
  expect(visited, '예약이 없는 세션은 1→5 순차다(스택이 정상 경로를 흔들지 않는다)')
    .toEqual([1, 2, 3, 4, 5]);
});
