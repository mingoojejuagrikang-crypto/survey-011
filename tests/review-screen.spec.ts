/**
 * v0.7.0 B3 — 조회 탭 e2e.
 *
 * Sheets GET(fetchAllRowsUnbounded)을 page.route로 stub(sync-skip-rows.spec.ts 패턴)해
 * 합성 작기 데이터(3회차 × 6샘플 + (키,회차) 중복 1행 + 헤더명 불일치 1개)를 반환:
 *   1. 고정 키 카드(불변 키 칩: 농가명·처리) + 샘플 카드 6장(가변 키 라벨) + 직전값/회차일
 *   2. 오늘 로컬 세션 매칭 → 현재값 + 증감 화살표 + trendRule(increase) 위반 강조
 *   3. (키,회차) 중복 → "중복 1" 배지 + 마지막 행 승리 값 표시
 *   4. 범위 전환(작기 전체) + 회차 선택 칩(최신 우선) + reviewScope 영속화
 *   5. 헤더 미매핑 경고 배너(비고→메모 개명)
 *   6. 상태: 시트 미설정 / 샘플키 0개(기능 비활성) / 미로그인
 *
 * dev 서버 수동 기동 필요([ENV-1/2]): npm run dev -- --port 5175 --strictPort
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);
const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';

function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const TODAY = localTodayISO();

/** v5 페이로드(현재 버전 — migrate 없이 그대로 hydrate, settings-migration.spec.ts의 v4와 대비).
 *  샘플키: 농가명·처리(불변 키), 조사나무·조사과실(가변 키). 횡경은 trendRule 'increase'. */
const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c5', name: '처리', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '시험' }, sampleKey: true },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 }, sampleKey: true },
  { id: 'c7', name: '조사과실', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'c10', name: '비고', type: 'text', input: 'touch', ttsAnnounce: false, auto: { kind: 'fixed', value: '' }, sampleKey: false },
];

function settingsPayload(overrides?: { sheetUrl?: string; columns?: unknown[] }) {
  return {
    state: {
      googleConnected: true,
      userEmail: 'tester@example.com',
      sheetUrl: overrides?.sheetUrl ?? 'https://docs.google.com/spreadsheets/d/SHEET_REVIEW_1/edit',
      sheetTab: 'Sheet1',
      columns: overrides?.columns ?? COLUMNS,
      tableGenerated: true,
      reviewScope: 'prevRound',
    },
    version: 5,
  };
}

/** 합성 작기: 3회차 × 6샘플(나무 1–3 × 과실 1–2). 횡경 = (100 + 나무*10 + 과실).회차 —
 *  회차가 갈수록 커진다(increase 추세에 부합). 헤더의 '비고'는 '메모'로 개명(미매핑 배너 유발). */
const ROUNDS = ['2026-05-01', '2026-05-20', '2026-06-05'];
const HEADERS = ['조사일자', '농가명', '처리', '조사나무', '조사과실', '횡경', '메모'];

function seasonRows(): string[][] {
  const rows: string[][] = [];
  ROUNDS.forEach((date, ri) => {
    for (let t = 1; t <= 3; t++) {
      for (let f = 1; f <= 2; f++) {
        rows.push([date, '이원창', '시험', String(t), String(f), `${100 + t * 10 + f}.${ri + 1}`, '']);
      }
    }
  });
  // (키,회차) 중복 1행: 최신 회차의 나무3·과실2가 한 번 더 — 마지막 행 승리로 999.9가 보여야 한다.
  rows.push(['2026-06-05', '이원창', '시험', '3', '2', '999.9', '']);
  return rows;
}

/** Sheets GET stub — fetchAllRowsUnbounded 1회 GET에 합성 시즌 전체를 반환. */
async function stubSheets(page: Page): Promise<{ gets: number }> {
  const counter = { gets: 0 };
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      counter.gets++;
      await route.fulfill({ json: { values: [HEADERS, ...seasonRows()] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected: ' + route.request().url() });
  });
  return counter;
}

/** 오늘 로컬 세션(자동값 포함 행 values) — 나무1·과실1은 직전(111.3)보다 작은 105.0(위반),
 *  나무1·과실2는 직전(112.3)보다 큰 200.0(정상 증가). */
function todaySession() {
  return {
    id: 'sess-review-1',
    date: TODAY,
    label: '조회테스트',
    columns: COLUMNS,
    rows: [
      { index: 1, values: { c1: TODAY, c3: '이원창', c5: '시험', c6: '1', c7: '1', c8: '105.0', c10: '' }, complete: true },
      { index: 2, values: { c1: TODAY, c3: '이원창', c5: '시험', c6: '1', c7: '2', c8: '200.0', c10: '' }, complete: true },
    ],
    completedRows: 2,
    syncedRows: 0,
    startedAt: Date.now() - 600_000,
  };
}

async function seedAndOpenReview(
  page: Page,
  opts: { token?: boolean; settings?: ReturnType<typeof settingsPayload>; session?: unknown } = {},
) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    async ({ token, settings, session, storeKey }) => {
      localStorage.clear();
      if (token) {
        localStorage.setItem('gs10_google_token', JSON.stringify({
          access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
        }));
      }
      localStorage.setItem(storeKey, JSON.stringify(settings));
      if (session) {
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
            tx.objectStore('sessions').put(session);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          };
          open.onerror = () => resolve();
        });
      }
    },
    { token: opts.token ?? true, settings: opts.settings ?? settingsPayload(), session: opts.session ?? null, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="tab-review"]').click();
}

const sampleCell = (page: Page, key: string, colId: string) =>
  page.locator(`[data-key="${key}"] [data-testid="review-cell-${colId}"]`);

test('직전 조사 — 키 카드·샘플 카드·직전값·증감/위반·중복 배지·미매핑 배너·캡션', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page, { session: todaySession() });

  // 고정 키 카드: 불변 키(농가명·처리)만 칩으로, 가변 키(나무·과실)는 라벨로.
  const keyCard = page.locator('[data-testid="review-key-card"]');
  await expect(keyCard).toContainText('이원창');
  await expect(keyCard).toContainText('시험');
  await expect(keyCard).not.toContainText('조사나무');

  // 샘플 카드 6장, 가변 키 라벨 + 정렬(나무1·과실1이 첫 카드).
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(6);
  await expect(page.locator('[data-testid="review-sample"]').first()).toContainText('조사나무 1 · 조사과실 1');

  // 직전 회차(오늘 미만 최신 = 2026-06-05)의 값 + 회차일 표기.
  const t1f1 = page.locator('[data-key="이원창 시험 1 1"]');
  await expect(t1f1).toContainText('2026-06-05');
  await expect(sampleCell(page, '이원창 시험 1 1', 'c8')).toContainText('111.3');

  // 오늘 로컬 세션 매칭: 위반(105.0 < 111.3, increase) → 빨강 강조 + ↓ 화살표.
  const violCell = sampleCell(page, '이원창 시험 1 1', 'c8');
  await expect(violCell).toContainText('105.0');
  await expect(violCell).toHaveAttribute('data-arrow', 'down');
  await expect(violCell).toHaveAttribute('data-violation', 'true');

  // 정상 증가(200.0 > 112.3) → ↑ 화살표, 위반 강조 없음.
  const okCell = sampleCell(page, '이원창 시험 1 2', 'c8');
  await expect(okCell).toContainText('200.0');
  await expect(okCell).toHaveAttribute('data-arrow', 'up');
  await expect(okCell).not.toHaveAttribute('data-violation', 'true');

  // (키,회차) 중복: 배지 "중복 1" + 마지막 행 승리(나무3·과실2 = 999.9).
  await expect(page.locator('[data-testid="review-badge-duplicate"]')).toHaveText('중복 1');
  await expect(sampleCell(page, '이원창 시험 3 2', 'c8')).toContainText('999.9');

  // 헤더 미매핑('비고'가 시트에선 '메모') 경고 배너.
  await expect(page.locator('[data-testid="review-banner-unmapped"]')).toContainText('비고');

  // 캡션: HH:MM 기준 · 19행(18 + 중복 1).
  await expect(page.locator('[data-testid="review-caption"]')).toContainText('19행');
});

test('작기 전체 — 범위 전환 + 회차 칩(최신 우선) + 선택 회차 값 + reviewScope 영속화', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  // 기본 범위는 직전 조사(설정 시드값).
  const scope = page.locator('[data-testid="review-scope"]');
  await expect(scope.getByRole('button', { name: '직전 조사' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="review-round-picker"]')).toHaveCount(0);

  // 작기 전체로 전환 → 회차 칩 3개, 최신(2026-06-05) 우선 + 기본 선택.
  await scope.getByRole('button', { name: '작기 전체' }).click();
  const picker = page.locator('[data-testid="review-round-picker"]');
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('button')).toHaveCount(3);
  const first = picker.getByRole('button').first();
  await expect(first).toHaveText('2026-06-05');
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(sampleCell(page, '이원창 시험 1 1', 'c8')).toContainText('111.3');

  // 첫 회차 선택 → 그 회차의 값으로 교체.
  await page.locator('[data-testid="round-chip-2026-05-01"]').click();
  await expect(sampleCell(page, '이원창 시험 1 1', 'c8')).toContainText('111.1');

  // 범위 선택이 settings에 영속화된다.
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY,
  );
  expect(stored.state.reviewScope).toBe('season');
});

test('상태 — 시트 미설정 안내(데이터 fetch 없음)', async ({ page }) => {
  const counter = await stubSheets(page);
  await seedAndOpenReview(page, { settings: settingsPayload({ sheetUrl: '' }) });

  await expect(page.locator('[data-testid="review-state-nosheet"]')).toBeVisible();
  await expect(page.locator('[data-testid="review-state-nosheet"]')).toContainText('설정 탭');
  expect(counter.gets).toBe(0);
});

test('상태 — 샘플키 0개: 기능 비활성 안내 + 새로고침 비활성', async ({ page }) => {
  const counter = await stubSheets(page);
  const noKeyCols = COLUMNS.map((c) => ({ ...c, sampleKey: false }));
  await seedAndOpenReview(page, { settings: settingsPayload({ columns: noKeyCols }) });

  await expect(page.locator('[data-testid="review-state-nokeys"]')).toBeVisible();
  await expect(page.locator('[data-testid="review-state-nokeys"]')).toContainText('샘플키 항목을 지정하세요');
  await expect(page.locator('[data-testid="review-refresh"]')).toBeDisabled();
  expect(counter.gets).toBe(0);
});

test('상태 — 미로그인 안내', async ({ page }) => {
  await stubSheets(page);
  const settings = settingsPayload();
  settings.state.googleConnected = false;
  await seedAndOpenReview(page, { token: false, settings });

  await expect(page.locator('[data-testid="review-state-signin"]')).toBeVisible();
  await expect(page.locator('[data-testid="review-state-signin"]')).toContainText('Google 로그인');
});
