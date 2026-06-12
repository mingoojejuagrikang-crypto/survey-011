/**
 * v0.7.0 B1 — settings persist v4→v5 마이그레이션 + 샘플키 자동 유추 + 설정탭 토글 round-trip.
 *
 * addInitScript로 version-4 localStorage 페이로드(샘플키/추세 필드 없음 + 일부 junk 값)를
 * 심고 부팅 → zustand persist migrate(4→5)가 실행된 결과를 설정탭 UI와 localStorage로 검증.
 *
 * 검증:
 *   1. 유추 기본값 — sampleKey = (input==='auto' && type!=='date'); junk 값 방어 정규화;
 *      추세 토글은 적격(사용자 입력 숫자) 컬럼에만 노출; 전역 토글·조사시기 셀렉터 기본값.
 *   2. 토글 round-trip — 사용자가 바꾼 샘플키/추세/전역 토글/조사시기 컬럼이 v5 페이로드로
 *      저장되고 reload 후 유지된다.
 *   3. 적격성 전환 — input 변경 시 trendRule 클리어 + sampleKey 재유추(columnFlags 규칙).
 *
 * dev 서버 수동 기동 필요([ENV-1/2]): npm run dev -- --port 5175 --strictPort
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);
const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';
const BLUE = 'rgb(41, 121, 255)'; // T.blue — SegmentToggle/토글 활성 배경

/** v0.6.0(version 4) 시절 페이로드 — sampleKey/trendRule/전역 필드 없음. junk 2건 포함:
 *  c3.sampleKey가 string, c8.trendRule이 미지원 값 → migrate가 방어 정규화해야 한다. */
const V4_COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' } },
  { id: 'c2', name: '기준일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '2026-05-13' } },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: 'yes' },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 10 } },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, trendRule: 'bogus' },
  { id: 'c10', name: '비고', type: 'text', input: 'touch', ttsAnnounce: false, auto: { kind: 'fixed', value: '' } },
];

const V4_PAYLOAD = {
  state: {
    googleConnected: false, userEmail: null, sheet: null, sheetUrl: '', sheetTab: '',
    availableSheets: [], manualMode: false, columns: V4_COLUMNS, tableGenerated: false,
    totalRows: 50, ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: null,
    noisyMode: false, speakerphoneMode: false, preferredVoiceName: '',
    teamFolderId: null, userLogFolderId: null,
  },
  version: 4,
};

async function bootSettings(page: Page) {
  // reload 후에도 init script가 다시 돌므로, 이미 값이 있으면(post-migrate v5) 덮지 않는다.
  await page.addInitScript(
    ({ key, payload }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(payload));
    },
    { key: STORE_KEY, payload: V4_PAYLOAD },
  );
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-settings"]').click();
}

/** SegmentToggle 내부에서 라벨이 정확히 일치하는 옵션 버튼. */
function opt(page: Page, toggleId: string, label: string) {
  return page.locator(`[data-testid="${toggleId}"]`).getByRole('button', { name: label, exact: true });
}

async function readStore(page: Page): Promise<{ version: number; state: Record<string, unknown> }> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STORE_KEY);
}

test('v4→v5 migrate — 샘플키 자동 유추 + junk 정규화 + 추세 토글 적격 컬럼 한정', async ({ page }) => {
  await bootSettings(page);

  // 유추 규칙: auto && !date → 유. date(c1)·voice(c8)·터치는 input 기준으로만 판정.
  await expect(opt(page, 'sample-key-c1', '무')).toHaveCSS('background-color', BLUE);   // date → 무
  await expect(opt(page, 'sample-key-c3', '유')).toHaveCSS('background-color', BLUE);   // junk 'yes' → 유추 true
  await expect(opt(page, 'sample-key-c6', '유')).toHaveCSS('background-color', BLUE);   // auto int → 유
  await expect(opt(page, 'sample-key-c8', '무')).toHaveCSS('background-color', BLUE);   // voice → 무
  await expect(opt(page, 'sample-key-c10', '무')).toHaveCSS('background-color', BLUE);  // touch → 무

  // 추세 토글: 적격(int|float && !auto) = c8만. junk 'bogus'는 클리어돼 '없음' 활성.
  await expect(page.locator('[data-testid="trend-rule-c8"]')).toBeVisible();
  await expect(opt(page, 'trend-rule-c8', '없음')).toHaveCSS('background-color', BLUE);
  await expect(page.locator('[data-testid="trend-rule-c6"]')).toHaveCount(0);  // auto int → 부적격
  await expect(page.locator('[data-testid="trend-rule-c10"]')).toHaveCount(0); // text → 부적격

  // 전역: 추세 검증 알림 기본 off(#2A2D32), 조사시기 컬럼 기본 자동 + date 컬럼만 목록.
  await expect(page.locator('[data-testid="trend-alert-toggle"]')).toHaveCSS(
    'background-color', 'rgb(42, 45, 50)',
  );
  const roundSel = page.locator('[data-testid="round-date-col"]');
  await expect(roundSel).toHaveValue('');
  await expect(roundSel.locator('option')).toHaveText(['자동 (조사일자)', '조사일자', '기준일자']);
});

test('토글 round-trip — v5 페이로드 저장 + reload 후 유지', async ({ page }) => {
  await bootSettings(page);

  await opt(page, 'sample-key-c3', '무').click();        // 유추 true → 사용자 명시 false
  await opt(page, 'trend-rule-c8', '커짐').click();      // trendRule: 'increase'
  await page.locator('[data-testid="trend-alert-toggle"]').click();
  await page.locator('[data-testid="round-date-col"]').selectOption('c2');

  // 저장된 페이로드가 v5 + 정규화·토글 반영인지
  await expect.poll(async () => (await readStore(page)).version).toBe(5);
  const stored = await readStore(page);
  const cols = stored.state.columns as Array<Record<string, unknown>>;
  const byId = (id: string) => cols.find((c) => c.id === id)!;
  expect(byId('c1').sampleKey).toBe(false);
  expect(byId('c3').sampleKey).toBe(false);              // 사용자 토글 반영
  expect(byId('c6').sampleKey).toBe(true);
  expect(byId('c8').trendRule).toBe('increase');
  expect(stored.state.trendAlertEnabled).toBe(true);
  expect(stored.state.roundDateColId).toBe('c2');
  expect(stored.state.reviewScope).toBe('prevRound');

  // reload(이미 v5라 init script는 덮지 않음) 후 UI에 유지
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="tab-settings"]').click();
  await expect(opt(page, 'sample-key-c3', '무')).toHaveCSS('background-color', BLUE);
  await expect(opt(page, 'trend-rule-c8', '커짐')).toHaveCSS('background-color', BLUE);
  await expect(page.locator('[data-testid="trend-alert-toggle"]')).toHaveCSS('background-color', BLUE);
  await expect(page.locator('[data-testid="round-date-col"]')).toHaveValue('c2');
});

test('적격성 전환 — input 변경 시 trendRule 클리어 + sampleKey 재유추', async ({ page }) => {
  await bootSettings(page);

  await opt(page, 'trend-rule-c8', '커짐').click();

  // c8 입력을 음성 → 자동: 부적격 전환 → 추세 토글 소멸 + trendRule 클리어, 샘플키 재유추(유)
  const c8Card = page.locator('[data-testid="col-card-c8"]');
  await c8Card.getByRole('button', { name: '자동', exact: true }).click();
  await expect(page.locator('[data-testid="trend-rule-c8"]')).toHaveCount(0);
  await expect(opt(page, 'sample-key-c8', '유')).toHaveCSS('background-color', BLUE);
  const stored = await readStore(page);
  const c8 = (stored.state.columns as Array<Record<string, unknown>>).find((c) => c.id === 'c8')!;
  expect(c8.trendRule).toBeUndefined();
  expect(c8.sampleKey).toBe(true);

  // 다시 자동 → 음성: 적격 복귀하되 방향은 초기화('없음'), 샘플키도 재유추(무)
  await c8Card.getByRole('button', { name: '음성', exact: true }).click();
  await expect(opt(page, 'trend-rule-c8', '없음')).toHaveCSS('background-color', BLUE);
  await expect(opt(page, 'sample-key-c8', '무')).toHaveCSS('background-color', BLUE);
});
