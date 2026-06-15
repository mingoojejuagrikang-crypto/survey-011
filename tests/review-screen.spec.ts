/**
 * v0.8.0 WS4 — 조회 탭 e2e (샘플별 시간 변화 뷰, 집계 금지).
 *
 * Sheets GET(fetchAllRowsUnbounded)을 page.route로 stub(sync-skip-rows.spec.ts 패턴)해
 * 합성 작기 데이터(3회차 × 6샘플 + (키,회차) 중복 1행 + 헤더명 불일치 1개)를 반환.
 *
 * v0.7.0과 달라진 핵심(민구 정정 — 샘플 비혼합·집계 금지):
 *  - 비교 기준 = latestTwoRounds(index): 인덱스 전역의 **최근 2개 회차**(직전→최근).
 *    오늘 로컬 세션 오버레이/범위 칩/회차 선택기는 폐기 — 시트 최근 회차가 "최근".
 *  - MeasureRow = 직전 회차값 → 최근 회차값 + 변화(절대/%). testid review-sample/review-cell 유지.
 *  - 보기 토글 3종(샘플 비혼합): 카드/그룹/피봇 + % 변화율 토글.
 *  - 접이식 표시 설정 패널(샘플키 토글 + 조사시기 select).
 *  - 회차 라벨 = "YYYY · M/D~M/D"(주차 번호 대신 월-일 기간).
 *  - 세로모드 가로 스크롤 0 + **샘플 합산/평균이 화면에 없음**(negative).
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
    // 이미 v6(새 의미)로 시드 — v5→v6 migrate가 trendRule을 클리어하지 않도록(idempotent).
    version: 6,
  };
}

/**
 * 합성 작기: 3회차 × 6샘플(나무 1–3 × 과실 1–2). 헤더의 '비고'는 '메모'로 개명(미매핑 배너 유발).
 * 회차: 05-01, 05-20, 06-05 → latestTwoRounds = (prev: 05-20, latest: 06-05).
 * 횡경(c8)을 직전(05-20)→최근(06-05) 변화로 설계:
 *  - 나무1·과실1: 05-20=120.0 → 06-05=110.0 (작아짐 — increase 미발화, 정상, ↓)
 *  - 나무1·과실2: 05-20=100.0 → 06-05=130.0 (커짐 — increase 이상치, ↑, 위반)
 *  - 그 외 샘플: 임의(검증 대상 아님).
 */
const ROUNDS = ['2026-05-01', '2026-05-20', '2026-06-05'];
const HEADERS = ['조사일자', '농가명', '처리', '조사나무', '조사과실', '횡경', '메모'];

function widthFor(date: string, t: number, f: number): string {
  // 검증 샘플(나무1)만 명시값, 나머지는 회차·좌표 기반 임의값.
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

const sampleCell = (page: Page, key: string, colId: string) =>
  page.locator(`[data-key="${key}"] [data-testid="review-cell-${colId}"]`).first();

test('샘플별 변화 — 키 카드·샘플 카드·직전→최근값·증감/이상치·중복·미매핑·캡션·회차 라벨', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  // 고정 키 카드: 불변 키(농가명·처리)만 칩으로, 가변 키(나무·과실)는 라벨로.
  const keyCard = page.locator('[data-testid="review-key-card"]');
  await expect(keyCard).toContainText('이원창');
  await expect(keyCard).toContainText('시험');
  await expect(keyCard).not.toContainText('조사나무');

  // 샘플 카드 6장, 가변 키 라벨 + 정렬(나무1·과실1이 첫 카드).
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(6);
  await expect(page.locator('[data-testid="review-sample"]').first()).toContainText('조사나무 1 · 조사과실 1');

  // 회차 라벨: 직전(05-20)→최근(06-05)을 월-일 기간으로(주차 번호 아님).
  await expect(page.locator('[data-testid="review-round-prev"]')).toContainText('5/18~5/24');
  await expect(page.locator('[data-testid="review-round-latest"]')).toContainText('6/1~6/7');

  // 나무1·과실1: 직전 120.0 → 최근 110.0(작아짐 — increase 미발화) → ↓, 위반 없음.
  const okCell = sampleCell(page, '이원창 시험 1 1', 'c8');
  await expect(okCell).toContainText('120.0');
  await expect(okCell).toContainText('110.0');
  await expect(okCell).toHaveAttribute('data-arrow', 'down');
  await expect(okCell).not.toHaveAttribute('data-violation', 'true');

  // 나무1·과실2: 직전 100.0 → 최근 130.0(커짐 — increase 이상치) → ↑, 위반 강조.
  const violCell = sampleCell(page, '이원창 시험 1 2', 'c8');
  await expect(violCell).toContainText('100.0');
  await expect(violCell).toContainText('130.0');
  await expect(violCell).toHaveAttribute('data-arrow', 'up');
  await expect(violCell).toHaveAttribute('data-violation', 'true');

  // (키,회차) 중복: 배지 "중복 1" + 마지막 행 승리(나무3·과실2 최근값 = 999.9).
  await expect(page.locator('[data-testid="review-badge-duplicate"]')).toHaveText('중복 1');
  await expect(sampleCell(page, '이원창 시험 3 2', 'c8')).toContainText('999.9');

  // 헤더 미매핑('비고'가 시트에선 '메모') 경고 배너.
  await expect(page.locator('[data-testid="review-banner-unmapped"]')).toContainText('비고');

  // 캡션: HH:MM 기준 · 19행(18 + 중복 1).
  await expect(page.locator('[data-testid="review-caption"]')).toContainText('19행');
});

test('% 토글 — 절대 변화 ↔ 변화율 전환', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  const violCell = sampleCell(page, '이원창 시험 1 2', 'c8');
  // 기본은 절대 변화(+30.0).
  await expect(violCell).toContainText('+30.0');

  // % 변화율 토글 → (130-100)/100*100 = +30.0%.
  await page.locator('[data-testid="review-pct-toggle"]').click();
  await expect(violCell).toContainText('+30.0%');

  // 작아진 정상 샘플은 −% 로.
  await expect(sampleCell(page, '이원창 시험 1 1', 'c8')).toContainText('−8.3%');
});

test('피봇 — 샘플(행)×항목(열) 매트릭스, 셀=변화(값 섞지 않음)', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  await page.locator('[data-testid="review-view-pivot"]').click();
  const pivot = page.locator('[data-testid="review-pivot"]');
  await expect(pivot).toBeVisible();

  // 항목 헤더(횡경)가 열로.
  await expect(pivot).toContainText('횡경');
  // 샘플 6행 유지(합치지 않음).
  await expect(pivot.locator('[data-testid="review-sample"]')).toHaveCount(6);
  // 이상치 셀은 여전히 위반 강조 + 최근값.
  const violCell = sampleCell(page, '이원창 시험 1 2', 'c8');
  await expect(violCell).toHaveAttribute('data-violation', 'true');
  await expect(violCell).toContainText('130.0');
});

test('그룹 — 항목별 묶음(합산 아님), 샘플은 그대로 나열', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  await page.locator('[data-testid="review-view-group"]').click();
  // 측정 항목(횡경) 그룹 섹션 안에 샘플 6개가 나란히.
  const group = page.locator('[data-testid="review-group"][data-col="c8"]');
  await expect(group).toBeVisible();
  await expect(group).toContainText('횡경');
  await expect(group.locator('[data-testid="review-sample"]')).toHaveCount(6);
  // 묶음 안에서도 이상치 샘플 강조 유지.
  await expect(group.locator('[data-key="이원창 시험 1 2"] [data-testid="review-cell-c8"]'))
    .toHaveAttribute('data-violation', 'true');
});

test('접이식 표시 설정 패널 — 샘플키 토글 + 조사시기 select', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  const panel = page.locator('[data-testid="review-settings-panel"]');
  await expect(panel).toBeVisible();
  // 평소 접힘.
  await expect(panel).not.toHaveAttribute('open', /.*/);

  // 펼치기.
  await panel.locator('summary').click();
  // 조사시기 select(설정탭에서 이전) 존재.
  await expect(page.locator('[data-testid="round-date-col"]')).toBeVisible();
  // 샘플키 토글: 농가명(c3)은 켜짐, 횡경(c8)은 꺼짐.
  await expect(page.locator('[data-testid="review-keycol-c3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="review-keycol-c8"]')).toHaveAttribute('aria-pressed', 'false');

  // 가변 키(조사과실 c7) 끄면 store 반영.
  await page.locator('[data-testid="review-keycol-c7"]').click();
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);
  const c7 = (stored.state.columns as Array<Record<string, unknown>>).find((c) => c.id === 'c7');
  expect(c7?.sampleKey).toBe(false);

  // 회귀(stale 인덱스): 샘플키를 끄면 강제 재로드 → 화면이 새 구성(나무만 = 3샘플)으로 갱신.
  // (조사과실 제거 전 6샘플 = 나무 1–3 × 과실 1–2 → 제거 후 나무 1–3 = 3샘플). web-first 재시도로
  // 비동기 재로드를 기다린다 — 캐시 fingerprint가 바뀌어 stale index가 자동 교체돼야 한다.
  await expect(page.locator('[data-testid="review-sample"]')).toHaveCount(3);
});

test('회귀 — subnormal prev(1e-309)의 % 변화율이 "Infinity%"로 누출되지 않는다', async ({ page }) => {
  // prev=1e-309, latest=1 인 단일 샘플: |1-1e-309|/1e-309*100 = Infinity. % 토글 시 'Infinity%' 금지.
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

  const cell = sampleCell(page, '이원창', 'c8');
  await expect(cell).toContainText('1'); // 최근값 렌더 확인
  await page.locator('[data-testid="review-pct-toggle"]').click();
  // 절대 변화(+1.0)는 보이되, %는 계산 불가로 생략 — 'Infinity'는 어디에도 없다.
  await expect(cell).not.toContainText('Infinity');
  await expect(page.locator('body')).not.toContainText('Infinity');
});

test('세로모드 피봇 — 측정 항목 多(5개)에서도 가로 스크롤/짤림 0', async ({ page }) => {
  // 피봇(샘플×항목)은 항목이 많으면 넓어진다. minmax(0,1fr)로 화면 폭에 압축 → 가로 스크롤·
  // 화면 밖 짤림이 없어야 한다(민구 요구: 세로모드 짤림 금지). 측정 항목 5개로 worst-case 검증.
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

  // 피봇 보기로 전환.
  await page.locator('[data-testid="review-view-pivot"]').click();
  await expect(page.locator('[data-testid="review-pivot"]')).toBeVisible();

  // 문서·피봇 모두 가로 스크롤 없음.
  const overflow = await page.evaluate(() => {
    const pivot = document.querySelector('[data-testid="review-pivot"]') as HTMLElement | null;
    return {
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
      pivotScroll: pivot?.scrollWidth ?? 0,
      pivotClient: pivot?.clientWidth ?? 0,
    };
  });
  expect(overflow.docScroll).toBeLessThanOrEqual(overflow.docClient + 1);
  expect(overflow.pivotScroll).toBeLessThanOrEqual(overflow.pivotClient + 1);

  // 첫 피봇 행도 뷰포트 폭 안.
  const box = await page.locator('[data-testid="review-sample"]').first().boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375 + 1);
});

test('세로모드 — 가로 스크롤 0 (측정 셀이 뷰포트 안)', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); // portrait 스마트폰
  await stubSheets(page);
  await seedAndOpenReview(page);

  // 문서에 가로 스크롤이 생기지 않는다.
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);

  // 측정 셀도 자기 부모 폭을 넘지 않는다(가로 스크롤 유발 없음).
  const cell = sampleCell(page, '이원창 시험 1 2', 'c8');
  const box = await cell.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375 + 1);
});

test('집계 금지(negative) — 합계/평균 행이 화면에 없다', async ({ page }) => {
  await stubSheets(page);
  await seedAndOpenReview(page);

  // 조회탭은 샘플별 변화 뷰 — 어떤 보기에서도 합산/평균 라벨이 등장하지 않아야 한다.
  const body = page.locator('[data-testid="tab-review"]'); // 탭 컨테이너 대신 전체 본문 확인
  void body;
  for (const view of ['list', 'group', 'pivot'] as const) {
    await page.locator(`[data-testid="review-view-${view}"]`).click();
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/합계|평균|총합|소계|Σ|sum|average/i);
  }
  // 샘플 수는 보기와 무관하게 6 유지(피봇은 행 6, 카드/그룹은 카드 6) — 합쳐서 줄지 않음.
  await page.locator('[data-testid="review-view-list"]').click();
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

  // nokeys 상태에서도 설정 패널이 보이고(데드락 방지) 펼쳐진 상태여야 한다.
  const panel = page.locator('[data-testid="review-settings-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('open', /.*/);

  // 패널에서 샘플키(농가명 c3)를 다시 켜면 nokeys를 벗어나 정상 뷰로 복구된다.
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
