/**
 * [SYNC-3] fix — header-name-based column mapping, full-app e2e regression.
 *
 * columnMapping.spec.ts already covers the pure-function logic in isolation. This file wires the
 * SAME scenarios through the real syncSelected() -> appendRows() -> Sheets API call path (stubbed
 * via page.route, same pattern as sync-skip-rows.spec.ts) to prove sync.ts actually USES the
 * header fetch + mapping — not just that the helper functions are individually correct.
 *
 * Real-device root cause (2026-07-07 v0.28.0 A5, Sonar): a local 6-column session synced against
 * a real 10-column sheet landed its values 2 columns over (positional write, no header check).
 *
 * Cases:
 *  (b) sheet has MORE columns than local — values must land at the NAMED column, not column A/B.
 *  (c) column order differs, names match — proves name-based (not positional) placement.
 *
 * dev 서버 수동 기동 필요([ENV-1/2]): npm run dev -- --port 5175 --strictPort
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);
const BASE = 'http://localhost:5175';

interface SheetCall { method: string; url: string; body: unknown }

/** Sheets API stub. GET returns `headerRow` (the sheet's REAL header, independent of local
 *  session.columns order/count) — append/PUT recorded like sync-skip-rows.spec.ts. */
async function stubSheets(page: Page, headerRow: string[]): Promise<SheetCall[]> {
  const calls: SheetCall[] = [];
  let nextAppendRow = 2;
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
      await route.fulfill({
        json: { updates: { updatedRange: `Sheet1!A${first}:Z${last}`, updatedRows: rows.length } },
      });
      return;
    }
    if (req.method() === 'GET') {
      await route.fulfill({ json: { values: [headerRow] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected: ' + url });
  });
  return calls;
}

function settingsWithColumns(columns: unknown[]) {
  return {
    state: {
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_ID_MAP/edit',
      sheetTab: 'Sheet1',
      columns,
      recognitionTolerance: 0.6,
    },
    version: 0,
  };
}

function makeSession(columns: { id: string }[]) {
  const values: Record<string, string> = {};
  // Deterministic per-column values keyed by column id (c1 -> '1', c2 -> '2', ...) so assertions
  // can check exactly WHICH id's value landed at which array index.
  columns.forEach((c, i) => { values[c.id] = String(i + 1); });
  return {
    id: 'sess-map-1',
    date: '2026-07-07',
    label: '헤더매핑테스트',
    columns,
    rows: [{ index: 1, values, complete: true }],
    completedRows: 1,
    syncedRows: 0,
    startedAt: 1783000000000,
    finishedAt: 1783000600000,
  };
}

async function seedAndBoot(page: Page, settings: ReturnType<typeof settingsWithColumns>, session: unknown) {
  await page.route('**://www.googleapis.com/**', (r) =>
    r.fulfill({ json: { id: 'stub', files: [{ id: 'stub' }] } }));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async ({ sess, settings }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
    }));
    localStorage.setItem('survey-011-settings-v3', JSON.stringify(settings));
    await new Promise<void>((resolve) => {
      const open = indexedDB.open('survey-011', 4);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audioClips')) db.createObjectStore('audioClips');
        if (!db.objectStoreNames.contains('logEvents')) {
          const os = db.createObjectStore('logEvents', { keyPath: 'id', autoIncrement: true });
          os.createIndex('bySessionId', 'sessionId');
        }
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
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
  }, { sess: session, settings });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
}

async function runSync(page: Page) {
  await page.locator('text=시트에 추가').first().click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("추가 (")').click();
  await page.waitForTimeout(600);
}

test('(b) 시트가 로컬보다 컬럼이 많음 — 신규 컬럼이 앞뒤에 끼어들어도 이름 기준으로 정확히 안착', async ({ page }) => {
  const columns = [
    { id: 'c1', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
    { id: 'c2', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  ];
  // Real sheet grew: 2 columns before + 1 between + 1 after what this session tracks.
  const headerRow = ['날짜', '비고', '조사나무', '신규컬럼A', '횡경', '신규컬럼B'];
  const calls = await stubSheets(page, headerRow);
  await seedAndBoot(page, settingsWithColumns(columns), makeSession(columns));
  await runSync(page);

  const appends = calls.filter((c) => c.url.includes(':append'));
  expect(appends).toHaveLength(1);
  const sent = (appends[0].body as { values: string[][] }).values;
  expect(sent).toHaveLength(1);
  // c1='1' (조사나무) must land at index 2; c2='2' (횡경) at index 4. Index 5 (신규컬럼B, a
  // column this session doesn't own) must NOT be included at all — array stops at index 4.
  expect(sent[0]).toEqual(['', '', '1', '', '2']);
});

test('(c) 컬럼 순서만 다름(이름 동일) — 위치 기반이면 뒤바뀌지만 이름 기준은 정확히 안착', async ({ page }) => {
  const columns = [
    { id: 'c1', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
    { id: 'c2', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  ];
  // Sheet's real header has the SAME two columns, but in the OPPOSITE order.
  const headerRow = ['횡경', '조사나무'];
  const calls = await stubSheets(page, headerRow);
  await seedAndBoot(page, settingsWithColumns(columns), makeSession(columns));
  await runSync(page);

  const appends = calls.filter((c) => c.url.includes(':append'));
  expect(appends).toHaveLength(1);
  const sent = (appends[0].body as { values: string[][] }).values;
  // Positional (pre-fix) code would have sent ['1','2'] (local declaration order: 조사나무,횡경) —
  // silently swapping the two values relative to the sheet's real column order. Name-based
  // mapping must send ['2','1'] (횡경's value '2' at index 0, 조사나무's value '1' at index 1).
  expect(sent[0]).toEqual(['2', '1']);
});

test('로컬 컬럼명이 시트 헤더에 하나도 없음 — 침묵 성공 대신 명시적 실패로 보고', async ({ page }) => {
  const columns = [
    { id: 'c1', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
  ];
  const headerRow = ['완전히다른헤더'];
  await stubSheets(page, headerRow);
  await seedAndBoot(page, settingsWithColumns(columns), makeSession(columns));
  await runSync(page);

  // Must NOT report a silent success — the failure banner (실패 count) surfaces instead.
  await expect(page.locator('text=실패').first()).toBeVisible();
});
