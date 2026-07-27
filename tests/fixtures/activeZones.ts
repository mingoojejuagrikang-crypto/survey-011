/**
 * F3 입력화면(§공통규칙/§[2]/§[3]/§[4]) 브라우저 픽스처 — **동작 불변 이동**.
 *
 * 원래 `tests/v039-active-zones.spec.ts` 안에 있던 시딩·부팅·상태진입 헬퍼를 그대로 옮긴 것이다.
 * 두 번째 소비자(`tests/capture-current-states.spec.ts` — 실렌더 캡처)가 생기면서 복제를 피하려고
 * 뺐다(GL-006 §14 — 리팩토링과 기능추가를 같은 커밋에 섞지 않는다. 이 이동만 담은 커밋이다).
 *
 * ⚠️ 이 파일에는 `test()`를 두지 않는다 — 스펙이 import하면 그 테스트까지 재등록된다.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다([ORCH-27]).
 */
import { expect, type Page } from '@playwright/test';
import { fireStt, installVoiceMocks } from './stt';
import { BASE } from '../baseUrl';

export const STORE_KEY = 'survey-011-settings-v3';
export const PHONE_402 = { width: 402, height: 874 };
export const PHONE_375 = { width: 375, height: 667 };

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

/** 1 auto(샘플키) + 12 voice — 402px 폭에서 확실히 2줄을 넘겨 칩존 스크롤 계약이 실제로 물린다. */
const VOICE_COLS = Array.from({ length: 12 }, (_, i) => ({
  id: `v${i}`,
  name: `측정항목${String(i + 1).padStart(2, '0')}`,
  type: 'float',
  input: 'voice',
  ttsAnnounce: true,
  auto: { kind: 'fixed', value: '' },
  decimals: 1,
  sampleKey: false,
  // 첫 컬럼만 추세 규칙 — 이상치(§[2]) 진입용.
  ...(i === 0 ? { trendRule: 'increase' } : {}),
}));

export const COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  ...VOICE_COLS,
];

export const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_F3/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_F3',
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 2,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: 'f3-active-zones',
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 12,
};

export const HEADERS = ['조사일자', '농가명', '조사나무', ...VOICE_COLS.map((c) => c.name)];
export const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0', ...Array.from({ length: 11 }, () => '')],
  [PREV_ROUND, '이원창', '2', '100.0', ...Array.from({ length: 11 }, () => '')],
];

/** headless는 getUserMedia가 거부돼 micLost가 래치되면 톤이 red로 고정된다 → fake 'live' 트랙 제공. */
export const MOCK_INIT_SCRIPT = `
(function() {
  function nextStream() {
    var fakeTrack = {
      kind: 'audio', label: 'Fake Mic', readyState: 'live', muted: false,
      getSettings: function(){ return { deviceId: 'fake-mic' }; },
      addEventListener: function(){}, removeEventListener: function(){}, stop: function(){},
    };
    return { getAudioTracks: function(){ return [fakeTrack]; }, getTracks: function(){ return [fakeTrack]; } };
  }
  if (navigator.mediaDevices) {
    try { navigator.mediaDevices.getUserMedia = function(){ return Promise.resolve(nextStream()); }; } catch(e){}
  }
})();
`;

export async function stubSheets(page: Page) {
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [HEADERS, ...SHEET_ROWS] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
}

export async function boot(page: Page, viewport = PHONE_402) {
  await page.setViewportSize(viewport);
  await stubSheets(page);
  await installVoiceMocks(page);
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ settings, storeKey }) => {
      localStorage.clear();
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
      }));
      localStorage.setItem(storeKey, JSON.stringify(settings));
    },
    { settings: SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(900);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 4000 });
}

/** 훅 test seam으로 마이크 레벨 주입 후 rAF 반영 대기. */
export async function injectLevel(page: Page, level: number) {
  await page.evaluate((v) => {
    (window as unknown as { __voiceLevelOverride?: number }).__voiceLevelOverride = v;
  }, level);
  await page.waitForTimeout(200);
}

/** ActiveState의 4개 grid 트랙 실측(상단 스트립 / 칩존 / 중앙 / 하단). */
export async function zoneMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="voice-active-state"]') as HTMLElement;
    const rootR = root.getBoundingClientRect();
    const rect = (sel: string) => {
      const el = root.querySelector(sel) as HTMLElement | null;
      return el ? el.getBoundingClientRect() : null;
    };
    const header = (root.firstElementChild as HTMLElement).getBoundingClientRect();
    const chips = rect('[data-testid="voice-chip-grid"]')!;
    const center = rect('[data-testid="voice-center-stage"]')!;
    const bottom = rect('[data-testid="voice-control-bar"]')!;
    return {
      rootHeight: rootR.height,
      headerHeight: header.height,
      chipHeight: chips.height,
      centerHeight: center.height,
      bottomHeight: bottom.height,
      centerTop: center.top,
      centerBottom: center.bottom,
      centerLeft: center.left,
      centerRight: center.right,
    };
  });
}

export async function indicatorOpacity(page: Page) {
  return page.locator('[data-testid="live-listen-band"]').evaluate((el) => {
    const dots = (el.querySelector('[data-testid="state-dots"]') as HTMLElement).parentElement!;
    const wave = (el.querySelector('[data-testid="voice-waveform"]') as HTMLElement).parentElement!;
    return {
      dots: Number(getComputedStyle(dots).opacity),
      wave: Number(getComputedStyle(wave).opacity),
    };
  });
}

export async function triggerAnomaly(page: Page) {
  // 직전 100.0 → 120.5 = 추세 규칙(increase) 위반 → 추세 알람(응답 대기).
  await fireStt(page, '120.5', 900);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 4000 });
}

/** 마지막 행까지 채워 §[4] 끝 도달 상태로 만든다. 첫 컬럼은 추세 규칙이 걸려 있으므로 직전값
 *  (100.0)을 그대로 넣어 알람 없이 통과시킨다(여기서 검증하려는 건 완료 화면이지 알람이 아니다). */
export async function fillAllRows(page: Page) {
  const summary = page.locator('[data-testid="complete-summary"]');
  for (let i = 0; i < 40; i++) {
    if (await summary.count() > 0) return;
    const col = i % 12;
    await fireStt(page, col === 0 ? '100.0' : `${20 + col}.0`, 320);
  }
  await expect(summary, '끝 도달(§[4])에 진입하지 못했다').toBeVisible({ timeout: 5000 });
}
