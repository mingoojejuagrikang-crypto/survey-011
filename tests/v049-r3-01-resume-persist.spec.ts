/**
 * 🔴 v0.49 r3 #1 오라클 — **예약 복귀 착지도 행 완료 부기를 한다**(값 되돌림 크리티컬).
 *
 * A2가 커밋 종단에 「셀 검토 대기로 복귀」 착지를 추가했는데, 그 착지는 `advance()`를 타지 않고
 * `proceedAfterCommit`에서 return한다. 행 완료 부기(완료 마킹 · `correctionBackupRef` 해제 ·
 * `persistSession`)가 `advance()` 안에만 있었으므로 그 경로에서 통째로 빠졌다:
 *
 *   캐스케이드 정정이 세운 **정정 이전 스냅샷**(complete:true·syncState:'synced')이 해제되지 않고
 *   남는다 → 다음 `persistSession`이 `useVoiceSession.ts` :636에서 그 낡은 행을 rows에 push하고
 *   (completedRows에 없는 행이라 조건 성립), 그 push가 :639의 `!rows.some(...)` 때문에 **신선한
 *   buildRow(activeRow)를 밀어낸다.** → 수정값은 메모리에만 살고 IDB엔 옛값이 남는다.
 *
 * ⚠️ **A2 오라클(v049-r2-a2-cellwait-resume)이 왜 못 잡았나** — 그 스펙은 착지 상태(활성 칩 ·
 * 「기록값」 낭독 · bare 값 흡수)만 쟀고, 픽스처의 행이 **완료된 적이 없었다**(01만 채우고 「이전」).
 * 완료·영속 이력이 없으면 `correctionBackupRef`가 서지 않아 결함 자체가 성립하지 않는다.
 * 그래서 이 스펙은 ① **행을 끝까지 채워 완료·영속시키고** ② 칩/TTS가 아니라 **IDB 영속값 ·
 * 완료 카운트(X/N) · 리로드 생존**을 잰다 — 리뷰가 지적한 관측 공백이 정확히 그 셋이다.
 *
 * 반증(fix 제거 시): ①③은 IDB에 옛값(88.8 / 95.5)이 남아 red, ②는 `1 / 2`로 red.
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
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 2, sessionAutoLabel: 'r3-01' },
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

/** 영속된 세션의 한 행 — **IDB에서 직접** 읽는다(메모리 dataStore가 아니라 재시작 후 남을 것).
 *  버전 무지정 open은 이미 부팅된 앱 DB를 그 버전 그대로 여는 표준이다(tests/fixtures/idb.ts). */
async function persistedRow(page: Page, index: number) {
  return page.evaluate(async (rowIndex) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('survey-011');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const sessions: Array<{
      startedAt: number;
      rows: Array<{ index: number; complete: boolean; syncState?: string; values: Record<string, string> }>;
    }> = await new Promise((resolve, reject) => {
      const req = db.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    // 이 픽스처는 세션을 하나만 만든다 — 그래도 최신 것을 고른다(재시작 후 잔재 방어).
    const latest = sessions.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
    return latest?.rows.find((r) => r.index === rowIndex) ?? null;
  }, index);
}

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
}

/** 1행을 **끝까지** 채워 완료·영속시킨다(= `correctionBackupRef`가 설 수 있는 유일한 상태).
 *  m1의 95.5는 직전 회차 100.0 대비 감소라 이상치 알람이 끼지 않는다. */
async function completeRow1(page: Page) {
  await fireStt(page, '95.5', 900);
  await fireStt(page, '88.8', 900);
  await fireStt(page, '77.7', 1500);
  await waitForTtsIdle(page);
  await expect
    .poll(async () => (await persistedRow(page, 1))?.complete, { timeout: 8000 })
    .toBe(true);
  expect((await persistedRow(page, 1))?.values.m2, '전제: 1행이 옛값으로 영속됐다').toBe('88.8');
}

/** 완료된 1행으로 되돌아가 **그 행의 filled 셀**에 셀 검토 대기(cellWait)를 만든다. */
async function enterCellWaitOnRow1(page: Page, colName: string, steps: number) {
  await fireStt(page, '이전행', 1500); // 완료 행 착지 → 행 검토 대기(포인터=첫 음성 컬럼)
  await waitForTtsIdle(page);
  for (let i = 0; i < steps; i++) {
    await fireStt(page, '다음', 1200); // 항목 이동 — filled 셀이면 cellWait 착지
    await waitForTtsIdle(page);
  }
  expect(await activeChipName(page)).toContain(colName);
  expect((await ttsLog(page)).join(' | '), '착지 안내(기록값 낭독)가 나야 cellWait이다').toContain('기록값');
}

test('① 셀 검토 대기 출신 2단계 수정의 새 값이 **IDB에 남는다** — 낡은 정정 백업이 이기지 않는다', async ({ page }) => {
  await bootMini(page);
  await completeRow1(page);
  await enterCellWaitOnRow1(page, '측정항목02', 1);

  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '66.6', 1800);
  await waitForTtsIdle(page);

  // A2 계약(착지처)은 그대로여야 한다 — 이 스펙은 그 위에 내구성 축을 얹는다.
  await expect(chip(page, '측정항목02')).toContainText('66.6');
  expect(await activeChipName(page), '2단계 수정이 셀 검토 문맥을 파괴했다').toContain('측정항목02');

  // 🔴 여기가 크리티컬 축이다. 화면·TTS는 66.6인데 IDB는 88.8 — 리로드 한 번에 값이 되돌아간다.
  await expect
    .poll(async () => (await persistedRow(page, 1))?.values.m2, { timeout: 8000 })
    .toBe('66.6');
  const row1 = await persistedRow(page, 1);
  expect(row1?.complete, '재완료된 행은 complete:true로 영속된다').toBe(true);
  // 낡은 백업은 정정 **이전**의 syncState를 실어 나른다 — 그게 남으면 시트가 영영 안 고쳐진다.
  // (이 픽스처는 업로드를 하지 않아 값 자체는 undefined다. 단언의 대상은 "백업의 syncState가
  //  그대로 재사용되지 않는다"이며, 위 값·complete 단언과 함께 백업 push 자체를 배제한다.)
  expect(row1?.syncState, '정정된 행이 synced로 굳으면 시트 교정이 영구히 막힌다').not.toBe('synced');

  // 후속 persist가 또 낡은 백업을 push하지 않는지 — 백업이 실제로 **해제**됐는지의 증명.
  await fireStt(page, '다음행', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '11.1', 1500);
  await waitForTtsIdle(page);
  expect((await persistedRow(page, 1))?.values.m2, '후속 persist가 낡은 백업을 되살렸다').toBe('66.6');

  // 리로드 생존 — 사용자가 실제로 겪는 형태(앱 재시작 후 옛값 복원)를 그대로 잰다.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  expect((await persistedRow(page, 1))?.values.m2, '리로드 후 옛값이 복원됐다').toBe('66.6');
});

test('② 정정된 행은 완료 카운트(X / N)에 그대로 남는다 — markRowComplete 누락', async ({ page }) => {
  await bootMini(page);
  await completeRow1(page);
  await enterCellWaitOnRow1(page, '측정항목02', 1);

  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '66.6', 1800);
  await waitForTtsIdle(page);

  // 2행까지 채워 조사 완료 화면으로 — X는 sessionStore.completedRows.length다(메모리 축).
  await fireStt(page, '다음행', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '11.1', 900);
  await fireStt(page, '22.2', 900);
  await fireStt(page, '33.3', 1800);
  await waitForTtsIdle(page);

  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 8000 });
  // 🔴 정정 시 markRowIncomplete만 돌고 재완료 마킹이 없으면 여기가 `1 / 2`로 굳는다.
  await expect(page.locator('[data-testid="complete-count"]'), '정정한 행이 완료 수에서 빠졌다')
    .toHaveText('2 / 2');
});

test('③ 알람 경유(재기록 값이 이상치 → 「확인」)도 새 값이 IDB에 남는다', async ({ page }) => {
  await bootMini(page);
  await completeRow1(page);
  // 추세 규칙이 걸린 m1에 **셀** 검토 대기로 착지한다. 행 검토 대기의 포인터가 이미 m1이지만
  // 거기서 바로 「수정」하면 **행 스코프 캐스케이드**(행 전체 재기록)라 다른 계약이다 — 그리고
  // 그 상태에서는 낡은 백업이 IDB를 지키는 것이 **정상**이다(재완료 전까지의 크래시 안전망).
  // 셀 스코프로 들어가려면 항목 이동으로 한 번 나갔다 돌아온다(경계 분기는 reviewWait 스코프를
  // 그대로 두므로 — gotoAdjacentField:1963 — 「다음」 후 「이전」이 유일한 진입로다).
  await enterCellWaitOnRow1(page, '측정항목02', 1);
  await fireStt(page, '이전', 1200);
  await waitForTtsIdle(page);
  expect(await activeChipName(page)).toContain('측정항목01');

  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);
  // 직전 회차 100.0 대비 증가 → 이상치 알람. 「확인」이 값을 확정하고 셀 검토로 복귀한다.
  await fireStt(page, '120.5', 1800);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 6000 });
  await waitForTtsIdle(page);
  await fireStt(page, '확인', 1800);
  await waitForTtsIdle(page);

  await expect(chip(page, '측정항목01')).toContainText('120.5');
  await expect
    .poll(async () => (await persistedRow(page, 1))?.values.m1, { timeout: 8000 })
    .toBe('120.5');
  expect((await persistedRow(page, 1))?.complete, '재완료된 행은 complete:true로 영속된다').toBe(true);
});
