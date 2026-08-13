/**
 * v0.49 r3 #2 오라클 — **끝 도달(atEnd) 상태에 커서는 하나다**(claude r2 HIGH, 한 상태 두 커서).
 *
 * A1이 atEnd 센티넬의 **행** 축을 `total`→`activeRow`로 고쳤지만 **컬럼** 축은 「마지막 음성 필드」로
 * 고정돼 있었다. `advance()`의 전진 스캔은 커서를 옮기지 않은 채 끝 도달로 떨어질 수 있다 —
 * 뒤 칸이 전부 차 있으면 while이 `vc.length`까지 가고 `activeColIdx`는 그 자리에 남는다.
 * 그러면 한 상태의 두 축이 **다른 컬럼**을 가리키고, 소비자가 축별로 갈린다:
 *
 *   · 센티넬 `colId`를 읽는 쪽 — bare '수정'(enterModifyMode) · "수정 <컬럼명>"(cmdModify) ·
 *     '유지'(cmdKeep) · 명령 클립 키(preserveCommandClip/armClipForCell)
 *   · `activeColIdx`를 읽는 쪽 — 항목 이동(gotoAdjacentField)
 *
 * ⚠️ **관측점 주의** — 끝 도달은 조사 완료 화면(`X / N`)이라 **활성 칩이 없다.** 그래서 이 스펙은
 * 칩이 아니라 **항목 이동의 착지**로 잰다: 두 축이 갈리면 사용자는 「마지막 항목에 서 있다」고
 * 듣고서 '이전'을 말했는데 마지막 항목의 앞칸(02)이 아니라 그 앞앞칸(01)에 착지한다.
 * 이것이 두 커서가 사용자에게 드러나는 유일한 표면이다(칩/TTS만 보는 오라클은 못 잡는다).
 *
 * ⚠️ **일원화 방향이 갈린다.** 센티넬을 `activeColIdx`로 내리는 반대 방향은 안 된다: atEnd의 bare
 * '수정'은 `reviewTarget`이 서지 않아(useVoiceSession :2335가 atEnd를 제외) `clearEnd = vc.length`
 * **행 스코프**로 지운다 — 앞 컬럼을 타깃으로 삼으면 「첫 항목부터 행 끝까지 —」가 되어
 * [MODIFY-TARGET-1](2026-07-27 실기기)이 닫은 증상이 그대로 되살아난다. 그래서 **화면(커서)을
 * 센티넬에 맞춘다**. ②가 그 계약이 살아 있음을 같이 잠근다(비차별 가드 — 두 방향 모두 green이지만,
 * 반대 방향으로 잘못 고치면 여기서 red가 난다).
 *
 * 반증(커서 주차 제거 시): ①이 red(측정항목01에 착지).
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
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'r3-02' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '', '']];

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
}

/** 유일한 행을 끝까지 채워 **끝 도달**시킨 뒤, 커서만 앞 컬럼(02)에 남긴 채 다시 끝 도달로 떨어뜨린다. */
async function reachEndWithStaleCursor(page: Page) {
  await fireStt(page, '11.1', 900);
  await fireStt(page, '22.2', 900);
  await fireStt(page, '33.3', 1800);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).join(' | '), '전제: 끝 도달 안내가 나야 한다').toContain('마지막행 입력');

  // atEnd에서 항목 이동(W1 허용) → 값 있는 셀이라 cellWait 착지. 커서가 02로 내려온다.
  await fireStt(page, '이전', 1500);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).join(' | '), '전제: 커서가 02로 내려와 cellWait 착지').toContain('측정항목02 기록값');

  // '유지'는 값이 있으면 `advance()`를 그대로 탄다 — 뒤 칸(03)이 이미 차 있어 전진 스캔이 커서를
  // **옮기지 않은 채** 끝 도달로 다시 떨어진다. 여기가 두 축이 갈리는 지점이다.
  await fireStt(page, '유지', 1800);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).join(' | '), '전제: 다시 끝 도달로 떨어졌다').toContain('마지막행 입력');
}

test('① 끝 도달에서의 항목 이동은 센티넬 컬럼 기준 한 칸이다 — 낡은 커서로 두 칸 앞에 착지하지 않는다', async ({ page }) => {
  await bootMini(page);
  await reachEndWithStaleCursor(page);

  const before = (await ttsLog(page)).length;
  await fireStt(page, '이전', 1800);
  await waitForTtsIdle(page);
  const spoken = (await ttsLog(page)).slice(before).join(' | ');

  // 🔴 종전엔 커서가 02에 남아 있어 '이전'이 **01**에 착지했다. 사용자가 듣는 상태는 「마지막행
  //    입력」(=마지막 항목)인데 한 칸 뒤가 두 칸 뒤였다 — 그리고 같은 상태의 '수정'은 03을 만진다.
  expect(spoken, '끝 도달의 한 칸 뒤는 마지막 항목의 앞칸(02)이다').toContain('측정항목02 기록값');
  expect(spoken, '낡은 커서 기준으로 두 칸 앞(01)에 착지했다').not.toContain('측정항목01');
});

test('② [MODIFY-TARGET-1] 가드 — 끝 도달의 bare 「수정」은 여전히 마지막 한 칸만 연다', async ({ page }) => {
  await bootMini(page);
  await reachEndWithStaleCursor(page);

  const before = (await ttsLog(page)).length;
  await fireStt(page, '수정', 1800);
  await waitForTtsIdle(page);
  const spoken = (await ttsLog(page)).slice(before).join(' | ');

  // 커서를 센티넬로 올리는 대신 센티넬을 커서로 내리면(반대 방향 일원화) 여기가 red가 된다:
  // atEnd의 bare '수정'은 행 스코프라 targetIdx=02부터 행 끝까지 전부 `—`가 된다.
  await expect(chip(page, '측정항목03')).not.toContainText('33.3');
  await expect(chip(page, '측정항목02'), '행 스코프로 번지면 [MODIFY-TARGET-1] 재발이다').toContainText('22.2');
  await expect(chip(page, '측정항목01')).toContainText('11.1');
  expect(spoken, '재입력 안내는 수정 대상 항목을 부른다').toContain('측정항목03');
});
