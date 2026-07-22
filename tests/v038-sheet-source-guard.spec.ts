/**
 * v0.38.0 Critical — 컬럼 사용자 설정은 정확히 같은 스프레드시트·탭 재연결에서만 보존한다.
 * 같은 헤더를 쓰는 다른 농가 시트/탭의 fixed 자동값이 이전 농가 값으로 오염되지 않아야 한다.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';
const SHEET_A = 'SHEET_SOURCE_A';
const SHEET_B = 'SHEET_SOURCE_B';
const URL_A = `https://docs.google.com/spreadsheets/d/${SHEET_A}/edit`;
const URL_B = `https://docs.google.com/spreadsheets/d/${SHEET_B}/edit`;
const HEADERS = ['조사일자', '농가명', '횡경'];

const A_COLUMNS = [
  { id: 'legacy-date', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, sampleKey: false, auto: { kind: 'fixed', value: '오늘' } },
  { id: 'legacy-farm', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, sampleKey: true, auto: { kind: 'fixed', value: '이원창' } },
  { id: 'legacy-width', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, sampleKey: false, auto: { kind: 'fixed', value: '' }, decimals: 2, trendRule: 'decrease', pctThreshold: 30 },
];

type StoredColumn = {
  name: string;
  type: string;
  input: string;
  auto: { kind: string; value?: string };
  decimals?: number;
  trendRule?: string;
  pctThreshold?: number;
};

async function seedSettings(
  page: Page,
  overrides: Record<string, unknown>,
  version = 12,
): Promise<void> {
  await page.addInitScript(
    ({ key, state, persistedVersion }) => {
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'sheet-source-token',
        expires_at: Date.now() + 3_600_000,
        email: 'tester@example.com',
      }));
      localStorage.setItem(key, JSON.stringify({ state, version: persistedVersion }));
    },
    {
      key: STORE_KEY,
      persistedVersion: version,
      state: {
        googleConnected: true,
        userEmail: 'tester@example.com',
        sheetUrl: URL_A,
        sheetTab: '농가A',
        columnsSheetId: SHEET_A,
        columnsSheetTab: '농가A',
        availableSheets: ['농가A'],
        savedSheets: [{ name: 'A농가', url: URL_A, sheetId: SHEET_A, addedAt: 1 }],
        columns: A_COLUMNS,
        tableGenerated: false,
        ...overrides,
      },
    },
  );
}

async function mockSheets(page: Page): Promise<void> {
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const spreadsheetId = path.match(/spreadsheets\/([^/]+)/)?.[1] ?? '';
    if (!path.includes('/values/')) {
      const tabs = spreadsheetId === SHEET_B ? ['농가B'] : ['농가A', '농가B탭'];
      await route.fulfill({ json: {
        spreadsheetId,
        properties: { title: spreadsheetId === SHEET_B ? 'B농가' : 'A농가' },
        sheets: tabs.map((title, index) => ({ properties: { sheetId: index, title, index } })),
      } });
      return;
    }
    const farm = spreadsheetId === SHEET_B || path.includes('농가B탭') ? '강남호' : '이원창';
    const width = farm === '강남호' ? '222' : '111';
    await route.fulfill({ json: { values: [HEADERS, ['2026-07-23', farm, width]] } });
  });
}

async function openSettings(page: Page): Promise<void> {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-settings"]').click();
}

async function readColumnsState(page: Page): Promise<{
  columnsSheetId: unknown;
  columnsSheetTab: unknown;
  columns: StoredColumn[];
}> {
  return page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
    return {
      columnsSheetId: stored?.state?.columnsSheetId,
      columnsSheetTab: stored?.state?.columnsSheetTab,
      columns: stored?.state?.columns ?? [],
    };
  }, STORE_KEY);
}

function byName(state: { columns: StoredColumn[] }, name: string): StoredColumn {
  const column = state.columns.find((candidate) => candidate.name === name);
  if (!column) throw new Error(`${name} 컬럼을 찾을 수 없습니다.`);
  return column;
}

test('다른 스프레드시트 전환 — B농가 fixed 자동값이 A농가 값으로 오염되지 않는다', async ({ page }) => {
  await seedSettings(page, {
    savedSheets: [
      { name: 'A농가', url: URL_A, sheetId: SHEET_A, addedAt: 1 },
      { name: 'B농가', url: URL_B, sheetId: SHEET_B, addedAt: 2 },
    ],
  });
  await mockSheets(page);
  await openSettings(page);

  await page.getByRole('button', { name: /저장된 시트/ }).click();
  await page.getByTitle(URL_B).click();

  await expect.poll(async () => (await readColumnsState(page)).columnsSheetId).toBe(SHEET_B);
  const state = await readColumnsState(page);
  expect(state.columnsSheetTab).toBe('농가B');
  expect(byName(state, '농가명').auto).toEqual({ kind: 'fixed', value: '강남호' });
});

test('같은 스프레드시트의 다른 탭 전환 — 새 탭 fixed 자동값을 사용한다', async ({ page }) => {
  await seedSettings(page, { availableSheets: ['농가A', '농가B탭'] });
  await mockSheets(page);
  await openSettings(page);

  await page.locator('select:has(option[value="농가B탭"])').selectOption('농가B탭');

  await expect.poll(async () => (await readColumnsState(page)).columnsSheetTab).toBe('농가B탭');
  const state = await readColumnsState(page);
  expect(state.columnsSheetId).toBe(SHEET_A);
  expect(byName(state, '농가명').auto).toEqual({ kind: 'fixed', value: '강남호' });
});

test('같은 시트 재연결 — v11 backfill 후 입력방식·추세·소수자리를 보존한다', async ({ page }) => {
  await seedSettings(page, {
    columnsSheetId: undefined,
    columnsSheetTab: undefined,
  }, 11);
  await mockSheets(page);
  await openSettings(page);

  await page.getByRole('button', { name: /저장된 시트/ }).click();
  await page.getByTitle(URL_A).click();

  await expect.poll(async () => (await readColumnsState(page)).columnsSheetId).toBe(SHEET_A);
  const state = await readColumnsState(page);
  const width = byName(state, '횡경');
  expect(state.columnsSheetTab).toBe('농가A');
  expect(width.type).toBe('float');
  expect(width.input).toBe('voice');
  expect(width.decimals).toBe(2);
  expect(width.trendRule).toBe('decrease');
  expect(width.pctThreshold).toBe(30);
});
