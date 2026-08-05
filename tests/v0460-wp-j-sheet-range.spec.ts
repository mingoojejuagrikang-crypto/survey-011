/**
 * v0.46.0 WP-J — 시트 **요청 범위** 계약 + 제외 목록 persist 하이드레이션.
 *
 * 🔴 왜 이 파일이 따로 있나: `v0460-wp-j-options.spec.ts`는 정렬·제외를 순수 함수로 재지만
 * **범위(`A2:A`·`A1:Z`)는 재지 못한다.** 범위를 `A2:A501`/`A1:Z1001`로 되돌려도 그 13건은 전부
 * 통과한다 — 그런데 그 한 줄이 민구 버그("리스트 값이 갱신되지 않는다")를 실제로 닫는 줄이다.
 * 정렬과 같은 이유로 오라클이 필요하다: 범위는 화면에 안 보이고, 좁아져도 목록은 그럴듯해 보인다.
 *
 * `authFetch`가 localStorage 토큰을 읽어 Node 스텁으로는 잴 수 없으므로 브라우저에서
 * `page.route`로 실제 요청 URL을 가로챈다(sync-header-mapping.spec.ts 패턴).
 */
import { test, expect, type Page } from '@playwright/test';
import { BASE } from './baseUrl';

test.setTimeout(60_000);

const STORE_KEY = 'survey-011-settings-v3';
const SHEET_ID = 'WPJ_RANGE_SHEET';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
const HEADERS = ['조사일자', '농가명', '횡경'];
/** 농가명은 헤더 index 1 → A1 표기로 B열. */
const FARM_COL_LETTER = 'B';

/** 시트에 쌓인 농가명(위에서 아래 = 오래된 것 → 최근). 마지막 것이 가장 최근이다. */
const FARMS_IN_SHEET = ['이원창', '이원창', '강남호', '위미리3407'];

async function seedSettings(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ({ key, seeded }) => {
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'wpj-range-token',
        expires_at: Date.now() + 3_600_000,
        email: 'tester@example.com',
      }));
      localStorage.setItem(key, JSON.stringify({ state: seeded, version: 12 }));
    },
    { key: STORE_KEY, seeded: state },
  );
}

/** 기본 시드 — optionExclusions를 **일부러 넣지 않는다**(구버전 저장본 재현, 아래 하이드레이션 테스트). */
function baseState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: SHEET_URL,
    sheetTab: '탭1',
    columnsSheetId: SHEET_ID,
    columnsSheetTab: '탭1',
    availableSheets: ['탭1', '탭2'],
    savedSheets: [{ name: '레인지시트', url: SHEET_URL, sheetId: SHEET_ID, addedAt: 1 }],
    columns: [
      { id: 'seed-date', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' } },
      { id: 'seed-farm', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' } },
      { id: 'seed-width', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: false,
    ...overrides,
  };
}

/** 가로챈 `values` 요청의 A1 범위(디코드된 것)를 순서대로 모은다. */
async function mockSheetsRecordingRanges(page: Page): Promise<string[]> {
  const ranges: string[] = [];
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (!path.includes('/values/')) {
      await route.fulfill({ json: {
        spreadsheetId: SHEET_ID,
        properties: { title: '레인지시트' },
        sheets: ['탭1', '탭2'].map((title, index) => ({ properties: { sheetId: index, title, index } })),
      } });
      return;
    }
    const range = path.split('/values/')[1] ?? '';
    ranges.push(range);
    // 한 컬럼만 요청하는 것(선택지 조회)과 헤더+표본 요청을 범위 모양으로 가른다.
    if (range.includes(`!${FARM_COL_LETTER}`)) {
      await route.fulfill({ json: { values: FARMS_IN_SHEET.map((f) => [f]) } });
      return;
    }
    // 헤더 + 표본. 농가명 고유값이 2개 이상이어야 리스트로 승격돼 선택지 조회가 이어진다.
    await route.fulfill({ json: { values: [
      HEADERS,
      ['2026-08-01', '이원창', '111.1'],
      ['2026-08-02', '강남호', '222.2'],
    ] } });
  });
  return ranges;
}

async function openSettings(page: Page): Promise<void> {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-settings"]').click();
}

async function readColumns(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null');
    return stored?.state?.columns ?? [];
  }, STORE_KEY);
}

function farmColumn(columns: Array<Record<string, unknown>>): Record<string, unknown> {
  const col = columns.find((c) => c.name === '농가명');
  if (!col) throw new Error('농가명 컬럼을 찾을 수 없습니다.');
  return col;
}

/** 탭을 바꿔 loadHeaders(헤더+표본 → 선택지 조회) 파이프라인을 태운다. */
async function switchTab(page: Page): Promise<void> {
  await page.locator('select:has(option[value="탭2"])').selectOption('탭2');
}

// ─── J-1 범위 오라클 ─────────────────────────────────────────────────────────

test('J-1 — 선택지는 **열 전체**(A2:A)를 읽는다. 500행 상한으로 되돌리면 깨진다', async ({ page }) => {
  await seedSettings(page, baseState());
  const ranges = await mockSheetsRecordingRanges(page);
  await openSettings(page);
  await switchTab(page);

  await expect.poll(() => ranges.some((r) => r.includes(`!${FARM_COL_LETTER}2:`))).toBe(true);
  const columnRange = ranges.find((r) => r.includes(`!${FARM_COL_LETTER}2:`))!;

  // 🔑 끝에 행 번호가 붙으면 안 된다. `'탭2'!B2:B501`이면 이 단언이 실패한다.
  expect(columnRange).toMatch(/!B2:B$/);
  expect(columnRange).not.toMatch(/\d$/);
});

test('J-1b — 타입 추론 표본은 **행 상한 없이**(A1:Z) 읽는다. 1,000행으로 되돌리면 깨진다', async ({ page }) => {
  await seedSettings(page, baseState());
  const ranges = await mockSheetsRecordingRanges(page);
  await openSettings(page);
  await switchTab(page);

  await expect.poll(() => ranges.some((r) => r.includes('!A1:Z'))).toBe(true);
  const sampleRange = ranges.find((r) => r.includes('!A1:Z'))!;

  // `'탭2'!A1:Z1001`이면 실패한다.
  expect(sampleRange).toMatch(/!A1:Z$/);
});

test('J-1 — 파이프라인 끝까지: 저장된 선택지가 최근 등장 우선으로 들어간다', async ({ page }) => {
  await seedSettings(page, baseState());
  await mockSheetsRecordingRanges(page);
  await openSettings(page);
  await switchTab(page);

  // 시트 순서는 이원창·이원창·강남호·위미리3407 → 최근순이면 뒤집혀야 하고,
  // 빈도순이었다면 2회 등장한 '이원창'이 맨 앞이었을 것이다.
  await expect.poll(async () => {
    const col = farmColumn(await readColumns(page)) as { auto?: { available?: string[] } };
    return col.auto?.available ?? [];
  }).toEqual(['위미리3407', '강남호', '이원창']);
});

// ─── J-5 persist 하이드레이션 ────────────────────────────────────────────────

test('J-5 — optionExclusions가 **없는** 구버전 저장본에서도 시트 연결이 성립한다', async ({ page }) => {
  // 계약 #3(persist 스키마 변경) 가드. 이 키가 undefined로 하이드레이트되면
  // loadHeaders의 Object.keys(...)와 OptionsPanel의 map 접근이 **둘 다 터져** 시트 연결이 죽는다.
  // baseState()는 optionExclusions를 일부러 넣지 않는다 = version 12 구버전 저장본 재현.
  await seedSettings(page, baseState());
  await mockSheetsRecordingRanges(page);
  await openSettings(page);
  await switchTab(page);

  await expect.poll(async () => {
    const col = farmColumn(await readColumns(page)) as { type?: string };
    return col.type;
  }).toBe('options');

  const stored = await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null');
    return s?.state?.optionExclusions;
  }, STORE_KEY);
  expect(stored).toEqual({}); // 기본값으로 치유돼 저장된다
});

test('J-5 — 지운 선택지는 재연결해도 돌아오지 않는다(끝에서 끝까지)', async ({ page }) => {
  await seedSettings(page, baseState());
  await mockSheetsRecordingRanges(page);
  await openSettings(page);
  await switchTab(page);

  await expect.poll(async () => {
    const col = farmColumn(await readColumns(page)) as { auto?: { available?: string[] } };
    return col.auto?.available?.length ?? 0;
  }).toBe(3);

  // 유추된 컬럼 id는 이름 해시라 스토어에서 읽어 쓴다.
  const farmId = (farmColumn(await readColumns(page)) as { id: string }).id;

  // J-4 — 있는 값을 치면 버튼이 '삭제'로 바뀐다.
  await page.locator(`[data-testid="opt-input-${farmId}"]`).fill('강남호');
  await expect(page.locator(`[data-testid="opt-apply-${farmId}"]`)).toHaveText(/삭제/);
  await page.locator(`[data-testid="opt-apply-${farmId}"]`).click();

  await expect.poll(async () => {
    const s = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);
    return s?.state?.optionExclusions?.[farmId];
  }).toEqual(['강남호']);

  // 같은 시트를 다시 연결한다 — 시트에는 '강남호'가 여전히 있지만 다시 들어오면 안 된다(R11).
  await page.locator('select:has(option[value="탭1"])').selectOption('탭1');
  await expect.poll(async () => {
    const col = farmColumn(await readColumns(page)) as { auto?: { available?: string[] } };
    return col.auto?.available ?? [];
  }).not.toContain('강남호');
});
