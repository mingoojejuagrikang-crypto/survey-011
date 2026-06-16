/**
 * v0.9.0 — 비교 탭(구 조회) e2e. 샘플별 직전→현재 변화를 **단일 표**로 보는 뷰(집계 금지).
 *
 * Sheets GET(fetchAllRowsUnbounded)을 page.route로 stub해 합성 작기 데이터(3회차 × 6샘플 +
 * (키,회차) 중복 1행 + 헤더명 불일치 1개)를 반환.
 *
 * v0.9.0 재설계(민구):
 *  - 카드/그룹/피봇 + % 변화율 토글 **전부 삭제**. 보기는 단일 표 하나.
 *  - 표: 공통 키(불변) + 회차 축(직전→최근)을 상단 고정, 샘플 라벨(가변 키)을 앞 열, 측정값을
 *    항목별 직전|현재 2열로 뒷 열에 배치. 셀 testid: review-prev-<colId>(직전) / review-cell-<colId>(현재).
 *  - 회차 라벨 = "YYYY. NN주차 (MM-DD ~ MM-DD)".
 *  - 세로모드 가로 스크롤 0(minmax(0,1fr) 압축) + 합산/평균 없음(negative).
 *
 * dev 서버 수동 기동 필요([ENV-1/2]): npm run dev -- --port 5175 --strictPort
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);
const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';

/** 샘플키: 농가명·처리(불변 키), 조사나무·조사과실(가변 키). 횡경은 trendRule 'increase'(커지면 알람). */
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
      roundDateColId: null,
    },
    version: 6,
  };
}

/**
 * 합성 작기: 3회차 × 6샘플(나무 1–3 × 과실 1–2). 헤더의 '비고'는 '메모'로 개명(미매핑 배너 유발).
 * 회차: 05-01, 05-20, 06-05 → latestTwoRounds = (prev: 05-20, latest: 06-05).
 *  - 나무1·과실1: 05-20=120.0 → 06-05=110.0 (작아짐 — increase 미발화, 정상, ↓)
 *  - 나무1·과실2: 05-20=100.0 → 06-05=130.0 (커짐 — increase 이상치, ↑, 위반)
 */
const ROUNDS = ['2026-05-01', '2026-05-20', '2026-06-05'];
const HEADERS = ['조사일자', '농가명', '처리', '조사나무', '조사과실', '횡경', '메모'];

function widthFor(date: string, t: number, f: number): string {
  if (t === 1 && f === 1) {
    if (date === '2026-05-20') return '120.0';
    if (date === '2026-06-05') return '110.0';
    return '118.0';
  }
  if (t === 1 && f === 2) {
    if (date === '2026-05-20') return '100.0';
    if (date === '2026-06-05') return '130.0';
    return '95.0';
  }
  const ri = ROUNDS.indexOf(date);
  return `${100 + t * 10 + f}.${ri + 1}`;
}

function seasonRows(): string[][] {
  const rows: string[][] = [];
  ROUNDS.forEach((date) => {
    for (let t = 1; t <= 3; t++) {
      for (let f = 1; f <= 2; f++) {
        rows.push([date, '이원창', '시험', String(t), String(f), widthFor(date, t, f), '']);
      }
    }
  });
  // (키,회차) 중복 1행: 최신 회차의 나무3·과실2가 한 번 더 — 마지막 행 승리로 999.9.
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

async function seedAndOpenReview(
  page: Page,
  opts: { token?: boolean; settings?: ReturnType<typeof settingsPayload> } = {},
) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ token, settings, storeKey }) => {
      localStorage.clear();
      if (token) {
        localStorage.setItem('gs10_google_token', JSON.stringify({
          access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
        }));
      }
      localStorage.setItem(storeKey, JSON.stringify(settings));
    },
    { token: opts.token ?? true, settings: opts.settings ?? settingsPayload(), storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="tab-review"]').click();
}

/** 현재(최근) 회차 값 셀 — 화살표·이상치 강조가 달림. */
const latestCell = (page: Page, key: string, colId: string) =>
  page.locator(`[data-key="${key}"] [data-testid="review-cell-${colId}"]`).first();
/** 직전 회차 값 셀. */
const prevCell = (page: Page, key: string, colId: string) =>
  page.locator(`[data-key="${key}"] [data-testid="review-prev-${colId}"]`).first();

test('비교 표 — 공통 키·회차 축·샘플 행·직전/현재·증감/이상치·중복·미매핑·캡션·주차 라벨', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  // 상단 공통 블록: 불변 키(농가명·처리)만 칩으로, 가변 키(나무·과실)는 칩 아님.
  const keyCard = page.locator('[data-testid="review-key-card"]');
  await expect(keyCard).toContainText('이원창');
  await expect(keyCard).toContainText('시험');

  // 표 헤더에 가변 키명 + 측정 항목명.
  const table = page.locator('[data-testid="review-table"]');
  await expect(table).toContainText('조사나무');
  await expect(table).toContainText('조사과실');
  await expect(table).toContainText('횡경');
  await expect(table).toContainText('직전');
  await expect(table).toContainText('현재');

  // 샘플 6행, 정렬상 첫 행 = 나무1·과실1(데이터 키로 식별).
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(6);
  await expect(page.locator('[data-testid="review-sample"]').first()).toHaveAttribute('data-key', '이원창 시험 1 1');

  // 회차 라벨: 직전(05-20)→최근(06-05)을 "YYYY. NN주차 (MM-DD ~ MM-DD)"로.
  await expect(page.locator('[data-testid="review-round-prev"]')).toContainText('주차');
  await expect(page.locator('[data-testid="review-round-prev"]')).toContainText('05-18 ~ 05-24');
  await expect(page.locator('[data-testid="review-round-latest"]')).toContainText('주차');
  await expect(page.locator('[data-testid="review-round-latest"]')).toContainText('06-01 ~ 06-07');

  // 나무1·과실1: 직전 120.0 → 현재 110.0(작아짐 — increase 미발화) → ↓, 위반 없음.
  await expect(prevCell(page, '이원창 시험 1 1', 'c8')).toContainText('120.0');
  const okCell = latestCell(page, '이원창 시험 1 1', 'c8');
  await expect(okCell).toContainText('110.0');
  await expect(okCell).toHaveAttribute('data-arrow', 'down');
  await expect(okCell).not.toHaveAttribute('data-violation', 'true');

  // 나무1·과실2: 직전 100.0 → 현재 130.0(커짐 — increase 이상치) → ↑, 위반 강조.
  await expect(prevCell(page, '이원창 시험 1 2', 'c8')).toContainText('100.0');
  const violCell = latestCell(page, '이원창 시험 1 2', 'c8');
  await expect(violCell).toContainText('130.0');
  await expect(violCell).toHaveAttribute('data-arrow', 'up');
  await expect(violCell).toHaveAttribute('data-violation', 'true');

  // (키,회차) 중복: 배지 "중복 1" + 마지막 행 승리(나무3·과실2 최근값 = 999.9).
  await expect(page.locator('[data-testid="review-badge-duplicate"]')).toHaveText('중복 1');
  await expect(latestCell(page, '이원창 시험 3 2', 'c8')).toContainText('999.9');

  // 헤더 미매핑('비고'가 시트에선 '메모') 경고 배너.
  await expect(page.locator('[data-testid="review-banner-unmapped"]')).toContainText('비고');

  // 캡션: HH:MM 기준 · 19행(18 + 중복 1).
  await expect(page.locator('[data-testid="review-caption"]')).toContainText('19행');
});

test('보기 토글·% 변화율 없음(negative) — 카드/그룹/피봇/퍼센트 토글이 화면에 없다', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  await expect(page.locator('[data-testid="review-table"]')).toBeVisible();
  // 삭제된 토글들은 더 이상 존재하지 않는다.
  await expect(page.locator('[data-testid="review-viewmode"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="review-pct-toggle"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="review-view-pivot"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="review-view-group"]')).toHaveCount(0);
});

test('접이식 표시 설정 패널 — 샘플키 토글 + 조사시기 select', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  const panel = page.locator('[data-testid="review-settings-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveAttribute('open', /.*/);

  await panel.locator('summary').click();
  await expect(page.locator('[data-testid="round-date-col"]')).toBeVisible();
  await expect(page.locator('[data-testid="review-keycol-c3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="review-keycol-c8"]')).toHaveAttribute('aria-pressed', 'false');

  // 가변 키(조사과실 c7) 끄면 store 반영.
  await page.locator('[data-testid="review-keycol-c7"]').click();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);
  const c7 = (stored.state.columns as Array<Record<string, unknown>>).find((c) => c.id === 'c7');
  expect(c7?.sampleKey).toBe(false);

  // 회귀(stale 인덱스): 샘플키를 끄면 강제 재로드 → 화면이 새 구성(나무만 = 3샘플)으로 갱신.
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(3);
});

test('회귀 — subnormal prev(1e-309)에도 "Infinity"가 화면 어디에도 누출되지 않는다', async ({ page }) => {
  const cols = [
    { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
    { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  ];
  const headers = ['조사일자', '농가명', '횡경'];
  const rows = [
    ['2026-05-20', '이원창', '1e-309'],
    ['2026-06-05', '이원창', '1'],
  ];
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [headers, ...rows] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'x' });
  });
  await seedAndOpenReview(page, { settings: settingsPayload({ columns: cols }) });

  await expect(latestCell(page, '이원창', 'c8')).toContainText('1'); // 최근값 렌더
  await expect(page.locator('body')).not.toContainText('Infinity');
});

test('세로모드 — 측정 항목 多(5개)에서도 표 가로 스크롤/짤림 0', async ({ page }) => {
  const measured = ['횡경', '종경', '당도', '산도', '경도'];
  const cols = [
    { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
    { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 }, sampleKey: true },
    ...measured.map((name, i) => ({
      id: `m${i}`, name, type: 'float', input: 'voice', ttsAnnounce: true,
      auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false,
    })),
  ];
  const headers = ['조사일자', '농가명', '조사나무', ...measured];
  const rounds = ['2026-05-20', '2026-06-05'];
  const rows: string[][] = [];
  rounds.forEach((date) => {
    for (let t = 1; t <= 3; t++) {
      rows.push([date, '이원창', String(t), ...measured.map((_, i) => `${1000 + t * 10 + i}.5`)]);
    }
  });
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [headers, ...rows] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'x' });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await seedAndOpenReview(page, { settings: settingsPayload({ columns: cols }) });

  await expect(page.locator('[data-testid="review-table"]')).toBeVisible();

  // 문서·표 모두 가로 스크롤 없음(minmax(0,1fr) 압축).
  const overflow = await page.evaluate(() => {
    const table = document.querySelector('[data-testid="review-table"]') as HTMLElement | null;
    return {
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
      tableScroll: table?.scrollWidth ?? 0,
      tableClient: table?.clientWidth ?? 0,
    };
  });
  expect(overflow.docScroll).toBeLessThanOrEqual(overflow.docClient + 1);
  expect(overflow.tableScroll).toBeLessThanOrEqual(overflow.tableClient + 1);

  // 첫 샘플 행도 뷰포트 폭 안.
  const box = await page.locator('[data-testid="review-sample"]').first().boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375 + 1);
});

test('세로모드 — 가로 스크롤 0 (측정 셀이 뷰포트 안)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await stubSheets(page);
  await seedAndOpenReview(page);

  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);

  const cell = latestCell(page, '이원창 시험 1 2', 'c8');
  const box = await cell.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375 + 1);
});

test('집계 금지(negative) — 합계/평균 행이 화면에 없다 + 샘플 6 유지', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/합계|평균|총합|소계|Σ|sum|average/i);
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(6);
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

test('데드락 방지 — 샘플키 0개여도 표시 설정 패널이 펼쳐져 있고, 재지정하면 복구된다', async ({ page }) => {
  await stubSheets(page);
  const noKeyCols = COLUMNS.map((c) => ({ ...c, sampleKey: false }));
  await seedAndOpenReview(page, { settings: settingsPayload({ columns: noKeyCols }) });

  const panel = page.locator('[data-testid="review-settings-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('open', /.*/);

  await page.locator('[data-testid="review-keycol-c3"]').click();
  await expect(page.locator('[data-testid="review-state-nokeys"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="review-sample"]').first()).toBeVisible();
});

test('상태 — 미로그인 안내', async ({ page }) => {
  await stubSheets(page);
  const settings = settingsPayload();
  settings.state.googleConnected = false;
  await seedAndOpenReview(page, { token: false, settings });

  await expect(page.locator('[data-testid="review-state-signin"]')).toBeVisible();
  await expect(page.locator('[data-testid="review-state-signin"]')).toContainText('Google 로그인');
});

// ─── v0.10.0 재설계 — AND 필터 바 / 행 선택 / 보기 설정 / baseline N ───────────

test('AND 필터 — 차원 칩 추가/제거로 후보가 교집합으로 좁아진다', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  // 기본: 필터 바 노출 + 칩 0, 후보 6.
  await expect(page.locator('[data-testid="review-filterbar"]')).toBeVisible();
  await expect(page.locator('[data-testid="review-filter-chip"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(6);

  // +필터 → 조사나무 컬럼 → 값 '1' 선택 → 후보 2(과실1·과실2)로 좁힘 + 칩 1개.
  await page.locator('[data-testid="review-filter-add"]').click();
  await expect(page.locator('[data-testid="review-filter-sheet"]')).toBeVisible();
  await page.locator('[data-testid="review-filter-col-c6"]').click();
  await page.locator('[data-testid="review-filter-value"]', { hasText: '1' }).first().click();

  await expect(page.locator('[data-testid="review-filter-chip"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="review-filter-chip"]')).toContainText('조사나무');
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(2);

  // 칩 제거 → 다시 6 후보.
  await page.locator('[data-testid="review-filter-chip"] button').click();
  await expect(page.locator('[data-testid="review-filter-chip"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(6);
});

test('회차 비교 — baseline 2회차 전으로 바꾸면 직전 셀 값이 바뀐다', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  // 기본 baseline=직전(05-20): 나무1·과실1 직전 120.0.
  await expect(prevCell(page, '이원창 시험 1 1', 'c8')).toContainText('120.0');

  // +필터 → 2회차 전 선택 → baseline=05-01 → 직전 셀 118.0.
  await page.locator('[data-testid="review-filter-add"]').click();
  await page.locator('[data-testid="review-baseline-2"]').click();
  await page.locator('[data-testid="review-filter-sheet"] button[aria-label="닫기"]').click();

  await expect(prevCell(page, '이원창 시험 1 1', 'c8')).toContainText('118.0');
  // 회차 칩이 "2회차 전" 비교를 표기.
  await expect(page.locator('[data-testid="review-filter-round"]')).toContainText('2회차 전');
});

test('행 선택 — 후보 중 일부 해제하면 표에 선택 행만 남는다', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  // 행 선택 패널 노출(후보 6 > 1), 기본 전부 표시.
  await expect(page.locator('[data-testid="review-rowselector"]')).toBeVisible();
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(6);

  // 해제 → 0행(빈 상태 카드), 표 숨김.
  await page.locator('[data-testid="review-rows-none"]').click();
  await expect(page.locator('[data-testid="review-state-norows"]')).toBeVisible();
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(0);

  // 한 행만 체크 → 그 1행만 표에.
  await page.locator('[data-testid="review-row-check"]').first().click();
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(1);

  // 전체 → 다시 6.
  await page.locator('[data-testid="review-rows-all"]').click();
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(6);
});

test('보기 설정 — 측정 항목을 끄면 표 측정 열이 사라진다', async ({ page }) => {
  // 측정 2개(횡경 c8 + 종경 c9)로 — 하나를 꺼서 검증.
  const cols = [
    { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
    { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
    { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
    { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  ];
  const headers = ['조사일자', '농가명', '조사나무', '횡경', '종경'];
  const rounds = ['2026-05-20', '2026-06-05'];
  const rows: string[][] = [];
  rounds.forEach((date) => {
    for (let t = 1; t <= 2; t++) rows.push([date, '이원창', String(t), `${10 + t}.0`, `${20 + t}.0`]);
  });
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') { await route.fulfill({ json: { values: [headers, ...rows] } }); return; }
    await route.fulfill({ status: 404, body: 'x' });
  });
  await seedAndOpenReview(page, { settings: settingsPayload({ columns: cols }) });

  const table = page.locator('[data-testid="review-table"]');
  await expect(table).toContainText('횡경');
  await expect(table).toContainText('종경');

  // 보기 설정 펼치고 종경(c9) 측정 끄기 → 표에서 종경 사라짐, 횡경 유지.
  await page.locator('[data-testid="review-viewpanel"] summary').click();
  await page.locator('[data-testid="review-measure-c9"]').click();
  await expect(table).toContainText('횡경');
  await expect(table).not.toContainText('종경');
});

test('disambiguator — 그룹 차원을 끄면 라벨 충돌 시 키 자체를 라벨 열로 보여준다', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  const table = page.locator('[data-testid="review-table"]');
  // 기본(rowDims=나무·과실): 6행 라벨 유일 → 키 폴백 없음('샘플' 헤더 미노출).
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(6);

  // 보기 설정에서 '조사과실'(c7) 그룹을 끔 → rowDims=[조사나무] → 1,1 / 2,2 / 3,3 충돌 →
  // 키 폴백('샘플' 헤더 + data-key 라벨)로 6행이 여전히 구분된다.
  await page.locator('[data-testid="review-viewpanel"] summary').click();
  await page.locator('[data-testid="review-group-c7"]').click();
  await expect(table).toContainText('샘플');
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(6);
  // 각 행이 자기 키 라벨을 그대로 보여줌(중복 없이 식별 가능).
  await expect(table.getByText('이원창 시험 1 1')).toBeVisible();
  await expect(table.getByText('이원창 시험 3 2')).toBeVisible();
});


