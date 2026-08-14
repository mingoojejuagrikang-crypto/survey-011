/**
 * v0.49 r7 #4 오라클(codex r6#15) — **'확인'의 무알람 재안내도 국면별 꼬리를 쓴다.**
 *
 * `cmdConfirm`의 갈래는 `cellWait`/그 외 **둘**뿐이었고, 그 「그 외」에 값을 **받을 수 없는**
 * 두 국면이 들어 있었다. `atEnd`·`reviewWait`은 resolver가 일반 값을 전부 흡수하는 **명령 전용**
 * 상태라, 거기서 「{항목} 말씀해 주세요」는 실행 불가능한 지시다 — 시킨 대로 값을 말하면 흡수
 * 안내가 되받고, 화면을 못 보는 음성 전용 사용자는 그 사이에서 반복 실패 루프에 들어간다.
 *
 * Y5가 **저신뢰 명령 거절**에서 이미 닫은 것과 같은 결함의 형제다. 그래서 새 문구를 만들지 않고
 * 그 국면별 꼬리 계약을 그대로 재사용한다(§2 쌍 상수 — 확정표 밖 문구를 늘리지 않는다):
 *   · `reviewWait` → 흡수 안내와 같은 조작 어휘(`REVIEW_WAIT_COMMANDS_TTS`)
 *   · `atEnd`      → **사유 단독**(그 국면 흡수 안내에 조작 어휘가 없다 — W2가 꼬리를 삭제했다)
 *
 * 반증: 국면 갈래를 되돌리면 ①② red, ③(대조군)은 green.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const cols = (seqTo: number) => [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: seqTo }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const bootR7 = (page: Page, totalRows: number) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: cols(totalRows), totalRows, sessionAutoLabel: 'r7-04' },
  } as unknown as typeof AZ_SETTINGS,
  headers: ['조사일자', '조사나무', '측정항목01'],
  sheetRows: [1, 2].map((i) => [PREV_ROUND, String(i), '']),
});

test('① 끝 도달의 「확인」은 사유만 말한다 — 값을 요구하지 않는다', async ({ page }) => {
  await bootR7(page, 1);
  await waitForTtsIdle(page);
  await fireStt(page, '십일 점 일', 1700);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: 끝 도달 국면이다').toContain('마지막행 입력');

  await fireStt(page, '확인', 1500);
  await waitForTtsIdle(page);
  expect(
    (await ttsLog(page)).at(-1),
    '값을 흡수하는 국면에서 「말씀해 주세요」는 실행 불가능한 지시다',
  ).toBe('확인할 알림이 없습니다.');
});

test('② 행 검토 대기의 「확인」은 흡수 안내와 같은 조작 어휘를 쓴다', async ({ page }) => {
  await bootR7(page, 2);
  await waitForTtsIdle(page);
  await fireStt(page, '십일 점 일', 1700); // 1행 완료 → 2행으로 전진
  await waitForTtsIdle(page);
  await fireStt(page, '이전행', 1600);      // 완료 행 착지 = 행 검토 대기
  await waitForTtsIdle(page);
  // 진입 낭독은 「N행 완료됨. {항목} {값}.」이다(흡수 안내와 다른 문구 — 흡수는 값이 들어와야 난다).
  expect((await ttsLog(page)).at(-1), '전제: 행 검토 대기에 착지했다').toBe('1행 완료됨. 측정항목01 11.1.');

  await fireStt(page, '확인', 1500);
  await waitForTtsIdle(page);
  expect(
    (await ttsLog(page)).at(-1),
    '같은 상태에 두 이름을 주지 않는다 — 흡수 안내의 조작 어휘를 그대로 쓴다',
  ).toBe('확인할 알림이 없습니다. 수정 또는 다음행.');
});

test('③ 대조군 — 값 대기의 「확인」은 종전 문구 그대로다', async ({ page }) => {
  await bootR7(page, 2);
  await waitForTtsIdle(page);

  await fireStt(page, '확인', 1500);
  await waitForTtsIdle(page);
  expect(
    (await ttsLog(page)).at(-1),
    '값을 실제로 받을 수 있는 국면에서는 값을 요구하는 게 맞다',
  ).toBe('확인할 알림이 없습니다. 측정항목01 말씀해 주세요.');
});
