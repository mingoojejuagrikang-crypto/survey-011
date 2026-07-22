/**
 * v0.38.0 #1 — Google 로그인 성공 시 과거값 인덱스 강제 갱신 회귀.
 *
 * ① 로그인 전 10분 캐시를 실제로 채운다. ② 서버 값을 바꾼 뒤 같은 페이지에서 재로그인한다.
 * ③ 캐시 TTL과 무관하게 past-index GET이 정확히 1회 추가되고 새 확정값으로 교체되는지 검증한다.
 * 앱 모듈의 `cached`를 dev-server 동적 import로 엿보면 Vite query가 다른 별도 모듈 인스턴스를 읽을
 * 수 있으므로, 실제 앱 상태 배지(메모리 캐시)와 확정 IDB `__past_index__` 레코드로 결과를 관측한다.
 * 설정 자동 재연결의 일반 prefetch도 함께 실행되므로, GET +1 단언이 single-flight 가드도 고정한다.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';
const SHEET_ID = 'SHEET_V038_LOGIN_REFRESH';
const HEADERS = ['조사일자', '농가명', '횡경'];

const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'before@example.com',
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    sheetTab: 'Sheet1',
    availableSheets: ['Sheet1'],
    savedSheets: [],
    tableGenerated: true,
    totalRows: 1,
    roundDateColId: 'c1',
    columns: [
      { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' } },
      { id: 'c2', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, sampleKey: true, auto: { kind: 'fixed', value: '이원창' } },
      { id: 'c3', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, trendRule: 'increase', auto: { kind: 'fixed', value: '' } },
    ],
  },
  version: 11,
};

async function installGisMock(page: Page) {
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      __survey011SettleGoogleLogin?: () => void;
    };
    // @ts-expect-error 테스트 전용 GIS mock
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: { callback: (r: unknown) => void }) => {
            let requested = false;
            testWindow.__survey011SettleGoogleLogin = () => {
              if (!requested) throw new Error('Google 로그인 요청 전에 토큰을 정착시킬 수 없습니다.');
              config.callback({
                access_token: 'fresh-login-token', expires_in: 3600, scope: '', token_type: 'Bearer',
              });
            };
            return {
              // 실제 OAuth 팝업 대신 테스트가 아래 helper로 토큰 콜백을 결정적으로 발화한다.
              requestAccessToken: () => { requested = true; },
            };
          },
          revoke: (_token: string, cb?: () => void) => cb?.(),
        },
      },
    };
  });
}

async function settleGisLogin(page: Page) {
  await page.evaluate(() => {
    const settle = (window as typeof window & {
      __survey011SettleGoogleLogin?: () => void;
    }).__survey011SettleGoogleLogin;
    if (!settle) throw new Error('GIS mock token callback이 준비되지 않았습니다.');
    settle();
  });
}

async function persistedSnapshot(page: Page): Promise<{ measurement: string | null; builtAt: number | null }> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('survey-011');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('kv')) {
      db.close();
      return { measurement: null, builtAt: null };
    }
    const record = await new Promise<{
      builtAt?: number;
      samples?: [string, [string, Record<string, string>][]][];
    } | null>((resolve, reject) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get('__past_index__');
      req.onsuccess = () => resolve((req.result ?? null) as never);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const rows = record?.samples?.flatMap(([, rounds]) => rounds) ?? [];
    const measurement = rows.find(([round]) => round === '2026-07-21')?.[1]?.c3 ?? null;
    return { measurement, builtAt: typeof record?.builtAt === 'number' ? record.builtAt : null };
  });
}

test('로그인 성공 — 10분 캐시 우회 + 과거값 GET single-flight + 새 확정값 반영', async ({ page }) => {
  let serverMeasurement = '111.1';
  let pastIndexGets = 0;

  await installGisMock(page);
  await page.route('**://www.googleapis.com/oauth2/v3/userinfo', (route) =>
    route.fulfill({ json: { email: 'after@example.com' } }));
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const url = new URL(route.request().url());
    const decodedPath = decodeURIComponent(url.pathname);
    if (!decodedPath.includes('/values/')) {
      await route.fulfill({ json: {
        spreadsheetId: SHEET_ID,
        properties: { title: '로그인 갱신 테스트' },
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0 } }],
      } });
      return;
    }
    // pastValues의 unbounded range는 따옴표 친 탭명뿐이고, 헤더 샘플 range에는 !A1:Z가 붙는다.
    if (!decodedPath.includes('!')) pastIndexGets++;
    await route.fulfill({ json: { values: [HEADERS, ['2026-07-21', '이원창', serverMeasurement]] } });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, settings }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'before-token', expires_at: Date.now() + 3600_000, email: 'before@example.com',
    }));
    localStorage.setItem(key, JSON.stringify(settings));
  }, { key: STORE_KEY, settings: SETTINGS });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect.poll(() => pastIndexGets).toBe(1);
  await expect(page.locator('[data-testid="connection-status-card"]')).toContainText('1행 · 1회차 준비됨');
  await expect.poll(async () => (await persistedSnapshot(page)).measurement).toBe('111.1');
  const initialSnapshot = await persistedSnapshot(page);
  expect(initialSnapshot.builtAt).not.toBeNull();

  // 메모리 캐시는 그대로 둔 채 인증만 끊어, 로그인 성공 시 10분 TTL을 실제로 우회해야 하는 조건을 만든다.
  await page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
    await auth.signOut();
    useSettingsStore.getState().set({ googleConnected: false, userEmail: null });
  });
  serverMeasurement = '222.2';

  const login = page.locator('button:has-text("Google 로그인")');
  await expect(login).toBeVisible();
  await login.click();
  await settleGisLogin(page);
  await expect(page.locator('button:has-text("after@example.com")')).toBeVisible({ timeout: 5000 });

  await expect.poll(() => pastIndexGets).toBe(2);
  await expect.poll(async () => (await persistedSnapshot(page)).measurement).toBe('222.2');
  const refreshedSnapshot = await persistedSnapshot(page);
  expect(refreshedSnapshot.builtAt).toBeGreaterThan(initialSnapshot.builtAt!);
  await expect(page.locator('[data-testid="connection-status-card"]')).toContainText('1행 · 1회차 준비됨');
  await page.waitForTimeout(500);
  expect(pastIndexGets).toBe(2);
});

/**
 * v0.38.0 — 로그인 흐름이 설정을 바꾸는 경우의 자가복구 회귀.
 *
 * 로그인은 시트 자동 재연결(v0.13.0 R1)도 함께 돌린다. 시트 헤더가 바뀌어 있으면 재연결이 컬럼을
 * 갱신해 설정 지문이 달라지고, 그 직전에 만든 과거값 인덱스는 fp 검사에서 탈락한다. 갱신이 정착된
 * 설정 기준으로 한 번 더 이뤄져 화면이 "준비됨"으로 수렴하는지 고정한다.
 */
test('로그인 중 시트 헤더가 바뀌어 지문이 달라져도 과거값이 정착 설정 기준으로 준비된다', async ({ page }) => {
  let headers = [...HEADERS];
  let pastIndexGets = 0;

  await installGisMock(page);
  await page.route('**://www.googleapis.com/oauth2/v3/userinfo', (route) =>
    route.fulfill({ json: { email: 'after@example.com' } }));
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const url = new URL(route.request().url());
    const decodedPath = decodeURIComponent(url.pathname);
    if (!decodedPath.includes('/values/')) {
      await route.fulfill({ json: {
        spreadsheetId: SHEET_ID,
        properties: { title: '로그인 갱신 테스트' },
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0 } }],
      } });
      return;
    }
    if (!decodedPath.includes('!')) pastIndexGets++;
    await route.fulfill({ json: { values: [headers, ['2026-07-21', '이원창', '111.1']] } });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, settings }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'before-token', expires_at: Date.now() + 3600_000, email: 'before@example.com',
    }));
    localStorage.setItem(key, JSON.stringify(settings));
  }, { key: STORE_KEY, settings: SETTINGS });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.locator('[data-testid="connection-status-card"]')).toContainText('1행 · 1회차 준비됨');
  const getsBeforeLogin = pastIndexGets;

  await page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
    await auth.signOut();
    useSettingsStore.getState().set({ googleConnected: false, userEmail: null });
  });
  // 로그인 중 재연결이 읽어갈 헤더를 바꿔 둔다 → 컬럼명이 갱신되며 설정 지문이 달라진다.
  // 추세 규칙을 가진 측정 컬럼(횡경)은 그대로 두고 **키 컬럼 이름만** 바꾼다.
  // 측정 컬럼을 바꾸면 규칙이 사라져 이상치 소비자가 없어지고, 과거값 조회 게이트가
  // (의도대로) 막혀 이 테스트가 검증하려는 '지문 변화 후 재생성'과 뒤섞인다.
  headers = ['조사일자', '농가', '횡경'];

  await page.locator('button:has-text("Google 로그인")').click();
  await settleGisLogin(page);
  await expect(page.locator('button:has-text("after@example.com")')).toBeVisible({ timeout: 5000 });


  // 재연결이 실제로 컬럼을 갈아치운 뒤에 판정한다. 이 대기가 없으면 교체 전에 배지를 읽어
  // (옛 지문 기준으로) 통과해버리는 레이스가 생겨 회귀를 놓친다.
  await expect(page.locator('input[value="농가"]')).toBeVisible({ timeout: 5000 });

  // 지문이 흔들려도 최종적으로 준비됨으로 수렴한다(재확인 1회로 자가복구).
  await expect(page.locator('[data-testid="connection-status-card"]')).toContainText('1행 · 1회차 준비됨');
  expect(pastIndexGets).toBeGreaterThan(getsBeforeLogin);
});

/**
 * v0.38.0 리뷰#1(Codex Medium) — **느린 과거값 조회 중 컬럼이 바뀌는** 실기기 조건.
 *
 * 로그인 직후 구지문 전체시트 조회가 아직 진행 중일 때 자동 재연결이 컬럼을 갱신하면,
 * in-flight 가드가 지문을 안 보고 막던 탓에 새 지문 재조회가 통째로 삼켜져 캐시가 빈 채 남았다
 * (= 사용자가 바로 입력을 시작하면 첫 이상치가 과거값 없이 통과). 목 응답을 즉시 완료시키는
 * 기존 테스트로는 이 순서가 재현되지 않는다 — 그래서 로그인 이후 조회만 의도적으로 지연시킨다.
 */
test('[리뷰#1] 느린 구지문 조회 중 헤더가 바뀌어도 새 지문 과거값이 준비된다', async ({ page }) => {
  let headers = [...HEADERS];
  let pastIndexGets = 0;
  let delayNextPastIndex = false;

  await installGisMock(page);
  await page.route('**://www.googleapis.com/oauth2/v3/userinfo', (route) =>
    route.fulfill({ json: { email: 'after@example.com' } }));
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    const decodedPath = decodeURIComponent(new URL(route.request().url()).pathname);
    if (!decodedPath.includes('/values/')) {
      await route.fulfill({ json: {
        spreadsheetId: SHEET_ID,
        properties: { title: '로그인 갱신 테스트' },
        sheets: [{ properties: { sheetId: 0, title: 'Sheet1', index: 0 } }],
      } });
      return;
    }
    if (!decodedPath.includes('!')) {
      pastIndexGets++;
      // 로그인 직후 첫 과거값 조회(구지문)만 느리게 — 그 사이 재연결이 컬럼을 갈아치운다.
      if (delayNextPastIndex) { delayNextPastIndex = false; await new Promise((r) => setTimeout(r, 2500)); }
    }
    await route.fulfill({ json: { values: [headers, ['2026-07-21', '이원창', '111.1']] } });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ key, settings }) => {
    localStorage.clear();
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'before-token', expires_at: Date.now() + 3600_000, email: 'before@example.com',
    }));
    localStorage.setItem(key, JSON.stringify(settings));
  }, { key: STORE_KEY, settings: SETTINGS });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="connection-status-card"]')).toContainText('1행 · 1회차 준비됨');

  await page.evaluate(async () => {
    const auth = await import('/src/lib/googleAuth.ts');
    const { useSettingsStore } = await import('/src/stores/settingsStore.ts');
    await auth.signOut();
    useSettingsStore.getState().set({ googleConnected: false, userEmail: null });
  });
  // 추세 규칙을 가진 측정 컬럼(횡경)은 그대로 두고 **키 컬럼 이름만** 바꾼다.
  // 측정 컬럼을 바꾸면 규칙이 사라져 이상치 소비자가 없어지고, 과거값 조회 게이트가
  // (의도대로) 막혀 이 테스트가 검증하려는 '지문 변화 후 재생성'과 뒤섞인다.
  headers = ['조사일자', '농가', '횡경'];
  delayNextPastIndex = true;

  await page.locator('button:has-text("Google 로그인")').click();
  await settleGisLogin(page);
  await expect(page.locator('button:has-text("after@example.com")')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('input[value="농가"]')).toBeVisible({ timeout: 8000 });

  // 느린 구지문 조회에 삼켜지지 않고, 정착된 설정 기준으로 최종 준비됨에 수렴해야 한다.
  await expect(page.locator('[data-testid="connection-status-card"]'))
    .toContainText('1행 · 1회차 준비됨', { timeout: 12000 });
  expect(pastIndexGets).toBeGreaterThanOrEqual(2);
});
