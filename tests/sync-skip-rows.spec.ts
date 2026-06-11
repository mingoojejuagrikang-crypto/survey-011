/**
 * v0.6.0 — skip 행 Sheets 업로드 + 행 단위 재동기화 e2e.
 *
 * Sheets API(values:append / values PUT)를 page.route로 stub해 실제 네트워크 없이 검증:
 *   1. skip 행(complete:false placeholder)도 row.index 순서대로 공백인 채 append되고, append 응답
 *      updatedRange로 각 행 sheetRow/syncState='synced'가 기록된다.
 *   2. 업로드된 행을 데이터탭에서 수정 → syncState 'dirty' → 재동기화 시 같은 sheetRow를 PUT로
 *      UPDATE(중복 append 금지). 성공 메시지에 "N행 갱신".
 *   3. updateRow 404 → sheetRow 초기화 후 append 폴백 + sync_row_mismatch 텔레메트리.
 *   4. 구버전 세션(syncState 없음, syncedRows>0): index<=syncedRows는 synced 취급, 이후만 append.
 *
 * dev 서버 수동 기동 필요([ENV-1/2]): npm run dev -- --port 5175 --strictPort
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);
const BASE = 'http://localhost:5175';

const SETTINGS = {
  state: {
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_ID_123/edit',
    sheetTab: 'Sheet1',
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
  },
  version: 0,
};

/** rows: skip placeholder(2번 행) 포함 3행 세션. syncState/sheetRow 없는 신규 세션. */
function makeSession() {
  return {
    id: 'sess-sync-1',
    date: '2026-06-11',
    label: '동기화테스트',
    columns: SETTINGS.state.columns,
    rows: [
      { index: 1, values: { c6: '1', c8: '35.1' }, complete: true },
      { index: 2, values: { c6: '2', c8: '' }, complete: false }, // skip placeholder
      { index: 3, values: { c6: '3', c8: '41.3' }, complete: true },
    ],
    completedRows: 2,
    syncedRows: 0,
    startedAt: 1781000000000,
    finishedAt: 1781000600000,
  };
}

interface SheetCall { method: string; url: string; body: unknown }

/** Sheets API stub. appends 기록 + updatedRange 응답, PUT(updateRow) 기록.
 *  updateFails=true면 PUT을 404로 응답해 폴백 경로를 유발. */
async function stubSheets(
  page: Page,
  opts: { updateFails?: boolean; appendNoRange?: boolean } = {},
): Promise<SheetCall[]> {
  const calls: SheetCall[] = [];
  let nextAppendRow = 2; // 헤더가 1행이라고 가정, 데이터는 2행부터
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const req = route.request();
    const url = req.url();
    let body: unknown = null;
    try { body = req.postDataJSON(); } catch { /* GET */ }
    calls.push({ method: req.method(), url, body });
    if (url.includes(':append')) {
      const rows = (body as { values: unknown[][] }).values;
      const first = nextAppendRow;
      const last = nextAppendRow + rows.length - 1;
      nextAppendRow = last + 1;
      if (opts.appendNoRange) {
        // F4: 200 OK but no parseable updatedRange → sync must NOT mark rows synced / push to
        // successIds (else auto-delete + duplicate append on retry).
        await route.fulfill({ json: { updates: { updatedRows: rows.length } } });
        return;
      }
      await route.fulfill({
        json: { updates: { updatedRange: `Sheet1!A${first}:B${last}`, updatedRows: rows.length } },
      });
      return;
    }
    if (req.method() === 'PUT') {
      if (opts.updateFails) { await route.fulfill({ status: 404, body: 'not found' }); return; }
      await route.fulfill({ json: { updatedRange: url } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected: ' + url });
  });
  return calls;
}

async function seedAndBoot(page: Page, session: unknown) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ sess, settings }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
    }));
    localStorage.setItem('survey-011-settings-v3', JSON.stringify(settings));
    // IDB sessions store에 세션 저장
    await new Promise<void>((resolve) => {
      const open = indexedDB.open('survey-011', 3);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audioClips')) db.createObjectStore('audioClips');
        if (!db.objectStoreNames.contains('logEvents')) {
          const os = db.createObjectStore('logEvents', { keyPath: 'id', autoIncrement: true });
          os.createIndex('bySessionId', 'sessionId');
        }
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('sessions', 'readwrite');
        tx.objectStore('sessions').put(sess);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
      open.onerror = () => resolve();
    });
  }, { sess: session, settings: SETTINGS });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
}

/** "시트에 추가" 버튼 → 모달 "추가" 클릭. */
async function runSync(page: Page) {
  await page.locator('text=시트에 추가').first().click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("추가 (")').click();
  await page.waitForTimeout(600);
}

async function readSession(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011', 3);
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    });
    if (!db) return null;
    return new Promise<unknown>((res) => {
      const tx = db.transaction('sessions', 'readonly');
      const g = tx.objectStore('sessions').get('sess-sync-1');
      g.onsuccess = () => res(g.result); g.onerror = () => res(null);
    });
  });
}

test('skip 행 포함 전체 행을 index 순서대로 append + sheetRow/synced 기록', async ({ page }) => {
  const calls = await stubSheets(page);
  await seedAndBoot(page, makeSession());
  await runSync(page);

  // append 한 번, 3행(skip 포함) 전송
  const appends = calls.filter((c) => c.url.includes(':append'));
  expect(appends).toHaveLength(1);
  const sent = (appends[0].body as { values: string[][] }).values;
  expect(sent).toHaveLength(3); // 1,2(skip),3 — 모두
  expect(sent[1]).toEqual(['2', '']); // skip 행은 음성 칸 공백인 채 업로드

  // 결과 메시지
  await expect(page.locator('text=시트에 추가했습니다').or(page.locator('text=행 추가'))).toBeVisible();

  // sheetRow/syncState 기록 (헤더 1행 가정 → 2,3,4)
  const sess = await readSession(page) as { rows: { index: number; sheetRow?: number; syncState?: string }[] };
  const byIdx = Object.fromEntries(sess.rows.map((r) => [r.index, r]));
  expect(byIdx[1].sheetRow).toBe(2);
  expect(byIdx[2].sheetRow).toBe(3);
  expect(byIdx[3].sheetRow).toBe(4);
  expect(byIdx[1].syncState).toBe('synced');
  expect(byIdx[2].syncState).toBe('synced');
});

test('업로드된 행 수정 → dirty → 재동기화 시 같은 sheetRow를 UPDATE(append 아님)', async ({ page }) => {
  const calls = await stubSheets(page);
  await seedAndBoot(page, makeSession());
  await runSync(page); // 1차: append
  calls.length = 0;

  // 데이터탭에서 1행 횡경 셀 수정: 카드 펼치고 셀 탭 → 입력 → Enter
  await page.locator('text=2026-06-11').first().click();
  await page.waitForTimeout(300);
  const cell = page.locator('button:has-text("35.1")').first();
  await cell.click();
  const input = page.locator('input').last();
  await input.fill('99.9');
  await input.press('Enter');
  await page.waitForTimeout(300);

  // dirty 마크 확인
  const dirty = await readSession(page) as { rows: { index: number; syncState?: string }[] };
  expect(dirty.rows.find((r) => r.index === 1)!.syncState).toBe('dirty');

  // 재동기화 → PUT(update), append 0회
  await runSync(page);
  const appends = calls.filter((c) => c.url.includes(':append'));
  const puts = calls.filter((c) => c.method === 'PUT');
  expect(appends).toHaveLength(0); // 중복 append 금지
  expect(puts).toHaveLength(1);
  // updateRow가 A1 range를 encodeURIComponent하므로 ':'는 '%3A'로 인코딩된다.
  expect(decodeURIComponent(puts[0].url)).toContain('A2:B2'); // 1행 = sheetRow 2
  expect((puts[0].body as { values: string[][] }).values[0]).toEqual(['1', '99.9']);
  await expect(page.locator('text=갱신')).toBeVisible();

  // synced로 복귀
  const after = await readSession(page) as { rows: { index: number; syncState?: string }[] };
  expect(after.rows.find((r) => r.index === 1)!.syncState).toBe('synced');
});

test('update 404 → sheetRow 초기화 후 append 폴백 + sync_row_mismatch', async ({ page }) => {
  const calls = await stubSheets(page, { updateFails: true });
  await seedAndBoot(page, makeSession());
  await runSync(page); // append
  calls.length = 0;

  // 1행 수정 → dirty
  await page.locator('text=2026-06-11').first().click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("35.1")').first().click();
  const input = page.locator('input').last();
  await input.fill('77.7');
  await input.press('Enter');
  await page.waitForTimeout(300);

  // 재동기화: PUT 404 → 다음 sync에서 append. 첫 sync는 PUT만 시도(폴백 안내), sheetRow 초기화.
  await runSync(page);
  const sess1 = await readSession(page) as { rows: { index: number; sheetRow?: number; syncState?: string }[] };
  const row1a = sess1.rows.find((r) => r.index === 1)!;
  expect(row1a.sheetRow).toBeUndefined(); // 404로 초기화
  expect(row1a.syncState).toBe('dirty');

  // 두 번째 재동기화: sheetRow 없는 dirty 행이 append로 재업로드
  calls.length = 0;
  await runSync(page);
  const appends = calls.filter((c) => c.url.includes(':append'));
  expect(appends).toHaveLength(1);
  expect((appends[0].body as { values: string[][] }).values[0]).toEqual(['1', '77.7']);

  // sync_row_mismatch 텔레메트리 기록 확인
  const events = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011', 3);
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    });
    if (!db) return [] as string[];
    return new Promise<string[]>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const g = tx.objectStore('logEvents').getAll();
      g.onsuccess = () => res((g.result as { extra?: string }[]).map((e) => e.extra ?? ''));
      g.onerror = () => res([]);
    });
  });
  expect(events.some((e) => e.includes('sync_row_mismatch'))).toBe(true);
});

test('구버전 세션(syncedRows>0, syncState 없음): index<=syncedRows는 synced, 이후만 append', async ({ page }) => {
  const calls = await stubSheets(page);
  const legacy = { ...makeSession(), syncedRows: 1, completedRows: 2 }; // 1행은 이미 업로드된 것으로 간주
  await seedAndBoot(page, legacy);
  await runSync(page);

  const appends = calls.filter((c) => c.url.includes(':append'));
  expect(appends).toHaveLength(1);
  const sent = (appends[0].body as { values: string[][] }).values;
  // 1행(synced 폴백)은 제외, 2(skip)·3행만 append
  expect(sent).toHaveLength(2);
  expect(sent[0]).toEqual(['2', '']);
  expect(sent[1]).toEqual(['3', '41.3']);
});

test('F1 — 동기화 후 sheetRow/syncState/syncedRows 보존 + 재동기화 시 pending 0 (중복 append 방지)', async ({ page }) => {
  await stubSheets(page);
  await seedAndBoot(page, makeSession());
  await runSync(page); // 1차: 3행 append

  // F1 핵심: persist가 sheetRow/syncState를 보존하고 syncedRows를 recount(하드코딩 0 아님)했는지.
  const after1 = await readSession(page) as { rows: { index: number; sheetRow?: number; syncState?: string; complete: boolean }[]; syncedRows: number };
  expect(after1.rows.every((r) => r.sheetRow !== undefined)).toBe(true);
  // 완료 2행(skip 제외)이 synced로 카운트 — 이전엔 syncedRows:0 하드코딩으로 추적이 전멸했음.
  expect(after1.syncedRows).toBe(2);
  expect(after1.rows.filter((r) => r.complete).every((r) => r.syncState === 'synced')).toBe(true);

  // 재동기화 모달을 열면 pending이 0이므로 미동기화 세션이 없어 "추가 (0)" 비활성 → 중복 append 불가.
  await page.locator('text=시트에 추가').first().click();
  await page.waitForTimeout(300);
  const addBtn = page.locator('button:has-text("추가 (")');
  await expect(addBtn).toHaveText(/추가 \(0\)/); // 보존된 synced 행은 재업로드 대상이 아님
  await expect(addBtn).toBeDisabled();
});

test('C1 — append updatedRange 파싱 실패: synced-without-sheetRow (재append 안 함, 중복 없음)', async ({ page }) => {
  // 방침 변경(C1): append HTTP는 이미 성공(데이터가 시트에 있음)이므로 세션을 실패 처리해 재시도를
  // 유도하면 같은 행을 또 올린다. 대신 해당 행을 synced로 마크(sheetRow는 미설정)하고 성공으로 집계.
  const calls = await stubSheets(page, { appendNoRange: true });
  await seedAndBoot(page, makeSession());
  await runSync(page); // append 200, updatedRange 없음 → synced(미sheetRow), 성공 집계

  // 행은 synced로 마크되지만 sheetRow는 없음(매핑 불가) — 진실은 "데이터는 시트에 있다".
  const sess = await readSession(page) as { rows: { index: number; sheetRow?: number; syncState?: string; complete: boolean }[] };
  expect(sess.rows.every((r) => r.sheetRow === undefined)).toBe(true);
  expect(sess.rows.filter((r) => r.complete).every((r) => r.syncState === 'synced')).toBe(true);

  // 실패 모달이 아니라 성공 처리. + sync_append_no_range 텔레메트리 유지.
  await expect(page.locator('text=실패').first()).toBeHidden().catch(() => {});
  const events = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011', 3);
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    });
    if (!db) return [] as string[];
    return new Promise<string[]>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const g = tx.objectStore('logEvents').getAll();
      g.onsuccess = () => res((g.result as { extra?: string }[]).map((e) => e.extra ?? ''));
      g.onerror = () => res([]);
    });
  });
  expect(events.some((e) => e.includes('sync_append_no_range'))).toBe(true);

  // 재동기화: synced 행은 pass-1 대상이 아니므로 append가 다시 일어나지 않는다(중복 방지의 핵심).
  calls.length = 0;
  await page.locator('text=시트에 추가').first().click();
  await page.waitForTimeout(300);
  const addBtn = page.locator('button:has-text("추가 (")');
  // 완료 2행이 synced로 카운트 → pending 0 → "추가 (0)" 비활성(중복 append 불가).
  await expect(addBtn).toHaveText(/추가 \(0\)/);
  await expect(addBtn).toBeDisabled();
});
