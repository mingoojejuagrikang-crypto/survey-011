/**
 * v0.7.0 B4 — 추세 검증 알림 음성 플로우 e2e.
 *
 * 패턴 조합: STT/TTS 주입(correction-flow.spec.ts MOCK) + Sheets GET stub(sync-skip-rows/
 * review-screen 패턴) + v5 설정 시드(settings-migration/review-screen 페이로드 형태).
 *
 * 검증:
 *   1. 위반 값 커밋 → echo 대신 알림 TTS(v0.20.0 입력탭#6: 문구 단축 "추세 알람 증가|감소 NN" /
 *      "범위 알람 ±NN%" — "~합니다/하세요"·"직전 조사보다" 제거, 팝업 라벨과 글자 동일.
 *       v0.13.0 R7: 끝 '확인해주세요' 없음 — self-confirm 환각 방지)
 *      + advance 중단, '확인' → 값 유지·진행 (trend_alert_fired/confirmed 로깅)
 *   2. 위반 → 새 값 발화 → 재입력(trend_alert_corrected) + 재검증(재위반 시 재알림) →
 *      통과 값이면 정상 echo·진행; IDB 최종값 = 마지막 발화
 *   3. 알림 상태 밖의 '확인' → 상태 변경 없는 짧은 재안내(진행 안 함)
 *   4. fetch 실패(HTTP 500) → 알림 없이 조용히 진행 + trend_skip:no_index 1회만(원인당 1회)
 *   5. trend_* 이벤트가 IDB logEvents(로그 zip 소스)에 남는다
 *
 * dev 서버 수동 기동 필요([ENV-1/2]): npm run dev -- --port 5175 --strictPort
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(120_000);

const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';

/** 직전 회차 = 어제(로컬) — previousRound가 '오늘 미만 strictly'라 당일 날짜는 못 쓴다. */
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

/** v0.8.0 설정(이상치 알람, 의미 반전) — 샘플키: 농가명(불변)+조사나무·조사과실(가변, seq 2×5=10행).
 *  횡경(c8): trendRule 'increase' = **커지면** 알람(예: 직전 100 → 오늘 120 발화).
 *  종경(c9): 방향 규칙 없이 pctThreshold 15 = 방향 무관 |Δ| 15% 이상이면 알람(% 단독 경로).
 *  v0.8.0은 전역 마스터 토글(trendAlertEnabled) 제거 — 컬럼 규칙 유무로 활성. */
const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c7', name: '조사과실', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 5 }, sampleKey: true },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, pctThreshold: 15 },
];

const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TREND_1/edit',
    sheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 10,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'trend-test',
    noisyMode: false,
    speakerphoneMode: false,
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 6,
};

/** 직전 회차 시트 데이터 — 행1(나무1·과실1): 횡경 100.0 / 행2(나무1·과실2): 횡경 110.0. */
const HEADERS = ['조사일자', '농가명', '조사나무', '조사과실', '횡경', '종경'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '1', '100.0', '50.0'],
  [PREV_ROUND, '이원창', '1', '2', '110.0', '55.0'],
];

// correction-flow.spec.ts와 동일한 TTS/STT 주입 mock.
const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];

  var mockSynth = {
    speak: function(utterance) {
      window.__ttsLog.push(utterance.text);
      try { if (utterance.onstart) utterance.onstart(new Event('start')); } catch(e) {}
      try { if (utterance.onend)   utterance.onend(new Event('end'));     } catch(e) {}
    },
    cancel: function() {},
    pause: function() {},
    resume: function() {},
    getVoices: function() {
      return [{ name: 'Mock Korean', lang: 'ko-KR', default: true, localService: true, voiceURI: 'mock' }];
    },
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    addEventListener: function() {},
    removeEventListener: function() {},
    dispatchEvent: function() { return true; },
  };
  try {
    Object.defineProperty(window, 'speechSynthesis', {
      get: function() { return mockSynth; }, configurable: true, enumerable: true,
    });
  } catch(e1) {
    try { window.speechSynthesis = mockSynth; } catch(e3) {}
  }

  function MockSTT() {
    this._ls = {};
    this.continuous = true;
    this.interimResults = true;
    this.lang = 'ko-KR';
    this.maxAlternatives = 3;
    window.__mockSTT = this;
  }
  MockSTT.prototype.addEventListener = function(t, cb) {
    if (!this._ls[t]) this._ls[t] = [];
    this._ls[t].push(cb);
  };
  MockSTT.prototype.removeEventListener = function(t, cb) {
    if (this._ls[t]) this._ls[t] = this._ls[t].filter(function(f) { return f !== cb; });
  };
  MockSTT.prototype.start = function() {
    var self = this;
    setTimeout(function() {
      (self._ls['start'] || []).forEach(function(cb) { cb(new Event('start')); });
    }, 5);
  };
  MockSTT.prototype.stop = function() {};
  MockSTT.prototype.abort = function() {
    var self = this;
    setTimeout(function() {
      (self._ls['end'] || []).forEach(function(cb) { cb(new Event('end')); });
    }, 5);
  };
  MockSTT.prototype.fireResult = function(transcript, confidence) {
    if (confidence === undefined) confidence = 0.95;
    var event = {
      resultIndex: 0,
      results: {
        length: 1,
        0: { isFinal: true, length: 1, 0: { transcript: transcript, confidence: confidence } }
      }
    };
    (this._ls['result'] || []).forEach(function(cb) { cb(event); });
  };
  try {
    Object.defineProperty(window, 'SpeechRecognition', {
      value: MockSTT, writable: true, configurable: true, enumerable: true,
    });
  } catch(e1) { try { window.SpeechRecognition = MockSTT; } catch(e2) {} }
  try {
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      value: MockSTT, writable: true, configurable: true, enumerable: true,
    });
  } catch(e) { try { window.webkitSpeechRecognition = MockSTT; } catch(e2) {} }
})();
`;

// ─── Helpers ────────────────────────────────────────────────────

async function stubSheets(page: Page, opts: { fail?: boolean } = {}): Promise<{ gets: number }> {
  const counter = { gets: 0 };
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      counter.gets++;
      if (opts.fail) {
        await route.fulfill({ status: 500, body: 'stub failure' });
      } else {
        await route.fulfill({ json: { values: [HEADERS, ...SHEET_ROWS] } });
      }
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected: ' + route.request().url() });
  });
  return counter;
}

async function setupAndStart(page: Page, opts: { sheetsFail?: boolean } = {}) {
  await stubSheets(page, { fail: opts.sheetsFail });
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

  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(800); // start() 프리페치(stub GET) 정착 여유
  await expect(page.locator('text=REC').first()).toBeVisible({ timeout: 3000 });
}

async function fireStt(page: Page, transcript: string, waitMs = 300) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

async function getTtsLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog ?? []);
}

async function getActiveChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('span'))
      .filter((s) => s.textContent?.trim() === '▶');
    if (!spans.length) return '';
    const p = spans[0].closest('div[style]');
    if (!p) return '';
    return (p.textContent || '').replace('▶', '').trim().split('\n')[0].trim();
  });
}

async function waitForActiveChip(page: Page, colName: string, timeout = 5000) {
  await page.waitForFunction(
    (name) => {
      const spans = Array.from(document.querySelectorAll('span'))
        .filter((s) => s.textContent?.trim() === '▶');
      if (!spans.length) return false;
      const p = spans[0].closest('div[style]');
      return (p?.textContent || '').includes(name);
    },
    colName,
    { timeout },
  );
}

async function waitForRow(page: Page, targetRow: number, timeout = 6000) {
  await page.waitForFunction(
    (r) => {
      const m = document.body.innerText.match(/(\d+)\s*\/\s*\d+\s*행/);
      return m && parseInt(m[1]) === r;
    },
    targetRow,
    { timeout },
  );
}

async function getIdbSessions(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('survey-011');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('sessions', 'readonly');
    const sessions: unknown[] = await new Promise((resolve, reject) => {
      const req = tx.objectStore('sessions').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return sessions as Array<{ rows: Array<{ index: number; values: Record<string, string> }> }>;
  });
}

/** IDB logEvents(로그 zip의 events 소스)에서 trend_* 이벤트만. */
async function getTrendEvents(page: Page): Promise<Array<{ extra: string; row?: number; colId?: string }>> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('survey-011');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains('logEvents')) { db.close(); return []; }
    const tx = db.transaction('logEvents', 'readonly');
    const all: Array<{ extra?: string }> = await new Promise((resolve, reject) => {
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all.filter((e) => typeof e.extra === 'string' && e.extra.startsWith('trend_')) as Array<{
      extra: string; row?: number; colId?: string;
    }>;
  });
}

// ─── Tests ──────────────────────────────────────────────────────

test('이상치(증가) 값 → 알림 TTS(advance 중단) → "확인" → 값 유지·진행 + fired/confirmed 로깅', async ({ page }) => {
  await setupAndStart(page);

  // 행1 나무1·과실1, 직전 횡경 100.0 — 120.5는 increase(커지면) 알람(20.5% 증가).
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500);

  // echo 대신 알림 TTS + advance 중단(여전히 횡경 대기).
  const tts1 = await getTtsLog(page);
  // v0.20.0 입력탭#6: 문구 단축 "추세 알람 증가 NN"(NN=절대 변화량 120.5−100.0=20.5). 팝업 라벨과 동일.
  expect(tts1.some((t) => t.includes('추세 알람 증가 20.5'))).toBe(true);
  expect(await getActiveChipName(page)).toContain('횡경');

  // v0.9.0 시각 팝업: 이전값(100)→현재값(120.5)과 항목명을 화면에 표시.
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('횡경');
  await expect(popup).toContainText('100');
  await expect(popup).toContainText('120.5');

  // "확인" → 커밋된 값 유지, 종경으로 진행.
  await fireStt(page, '확인', 500);
  await waitForActiveChip(page, '종경');

  // 종경은 pctThreshold 15 — 49.5는 직전 50.0 대비 1% 변동(< 15%) → 알림 없이 행 완료.
  await fireStt(page, '49.5', 500);
  await waitForRow(page, 2);

  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1].rows.find((r) => r.index === 1)!;
  expect(row1.values.c8).toBe('120.5');
  expect(row1.values.c9).toBe('49.5');

  const events = await getTrendEvents(page);
  expect(events.filter((e) => e.extra === 'trend_alert_fired')).toHaveLength(1);
  expect(events.filter((e) => e.extra === 'trend_alert_confirmed')).toHaveLength(1);
  expect(events.filter((e) => e.extra === 'trend_alert_corrected')).toHaveLength(0);
});

test('% 변동률 단독 알람 — 종경 pctThreshold 15, 방향 무관 발화(증가/감소)', async ({ page }) => {
  await setupAndStart(page);

  // 행1 횡경: 직전 100.0 대비 통과 흐름(작아짐은 increase 미발화). 80.5는 알림 없음.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '80.5', 500);
  await waitForActiveChip(page, '종경');
  expect((await getTtsLog(page)).some((t) => /추세 알람|범위 알람/.test(t))).toBe(false);

  // 종경: 직전 50.0 → 60.5 = +21.0% (>= 15%) → 범위 알람. v0.20.0: 표시는 설정 임계 "±15%"(팝업과 동일).
  await fireStt(page, '60.5', 500);
  expect((await getTtsLog(page)).some((t) => t.includes('범위 알람 ±15%'))).toBe(true);
  expect(await getActiveChipName(page)).toContain('종경'); // advance 중단

  await fireStt(page, '확인', 500);
  await waitForRow(page, 2);

  // 행2(나무1·과실2): 횡경 통과(80.5<100), 종경 직전 55.0 → 40.0 = -27.3% → % 단독 알람(감소했습니다).
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '80.5', 500);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '40.0', 500);
  expect((await getTtsLog(page)).some((t) => t.includes('범위 알람 ±15%'))).toBe(true);
  await fireStt(page, '확인', 500);

  const events = await getTrendEvents(page);
  expect(events.filter((e) => e.extra === 'trend_alert_fired')).toHaveLength(2); // 증가 1 + 감소 1
  expect(events.filter((e) => e.extra === 'trend_alert_confirmed')).toHaveLength(2);
});

test('이상치 → 새 값 발화 → 재입력+재검증(재알림) → 통과 값은 정상 진행 + corrected 로깅', async ({ page }) => {
  await setupAndStart(page);

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500); // 알람 1차 (100.0 → 120.5, 절대차 +20.5)
  expect((await getTtsLog(page)).some((t) => t.includes('추세 알람 증가 20.5'))).toBe(true);
  // v0.13.0 시각검증: 빨강(pending) 팝업 + R3 hero 라벨 캡처(414px). 비단언 — 레이아웃 확인용.
  await expect(page.locator('[data-testid="anomaly-alert"][data-status="pending"]')).toBeVisible();
  await page.screenshot({ path: 'test-results/v013-anomaly-red.png' });

  // 새 값(여전히 커짐) → 재입력(corrected) + 재알림 (절대차 +30.5).
  await fireStt(page, '130.5', 500);
  expect((await getTtsLog(page)).some((t) => t.includes('추세 알람 증가 30.5'))).toBe(true);
  expect(await getActiveChipName(page)).toContain('횡경'); // 여전히 advance 중단

  // 통과 값(80.5 < 100 — increase는 작아짐 미발화) → 알림 없이 수정 echo + 종경으로 진행.
  await fireStt(page, '80.5', 500);
  await waitForActiveChip(page, '종경');
  const tts = await getTtsLog(page);
  expect(tts.some((t) => t.includes('수정 횡경 80.5'))).toBe(true);
  // v0.20.0: 알람 문구가 값을 포함하지 않아 누적 TTS 로그론 "이번 80.5 커밋이 알람 없음"을 못 가린다
  // (앞선 120.5/130.5 알람 문자열이 로그에 남아 있음). 대신 알람 팝업이 닫혔고 종경으로 advance됐음
  // (위 waitForActiveChip)으로 "이번 커밋은 알람 없이 통과"를 확인한다.
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeHidden();

  await fireStt(page, '50.5', 500); // 종경: 직전 50.0 대비 1% < 15% → 알림 없음
  await waitForRow(page, 2);

  // 최종값 = 마지막 발화.
  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1].rows.find((r) => r.index === 1)!;
  expect(row1.values.c8).toBe('80.5');

  // 로그 zip 소스(IDB logEvents)에 trend_* 전 계열이 남는다.
  const events = await getTrendEvents(page);
  expect(events.filter((e) => e.extra === 'trend_alert_fired')).toHaveLength(2);
  expect(events.filter((e) => e.extra === 'trend_alert_corrected')).toHaveLength(2);
  expect(events.filter((e) => e.extra === 'trend_alert_confirmed')).toHaveLength(0);
  for (const e of events) {
    expect(e.row).toBe(1);
    expect(e.colId).toBe('c8');
  }
});

test('알림 상태 밖 "확인" → 상태 변경 없이 재안내(진행 안 함)', async ({ page }) => {
  await setupAndStart(page);

  await waitForActiveChip(page, '횡경');
  await fireStt(page, '확인', 500);

  expect((await getTtsLog(page)).some((t) => t.includes('확인할 알림이 없습니다. 횡경 말씀해 주세요.'))).toBe(true);
  expect(await getActiveChipName(page)).toContain('횡경'); // 진행 안 함

  // 이후 통과 값은 정상 흐름(80.5 < 100 — increase는 작아짐 미발화).
  await fireStt(page, '80.5', 500);
  await waitForActiveChip(page, '종경');
});

test('fetch 실패(500) → 알림 없이 조용히 진행 + trend_skip:no_index 원인당 1회', async ({ page }) => {
  await setupAndStart(page, { sheetsFail: true });

  // 행1: 알람이어야 할 120.5가 알림 없이 정상 echo·진행(인덱스 없음 → 조용히 skip).
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 500);
  await waitForActiveChip(page, '종경');
  expect((await getTtsLog(page)).some((t) => /추세 알람|범위 알람/.test(t))).toBe(false);
  await fireStt(page, '50.5', 500);
  await waitForRow(page, 2);

  // 행2 횡경도 skip — 같은 원인(no_index)은 다시 로깅하지 않는다(세션당 1회).
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '130.5', 500);
  await waitForActiveChip(page, '종경');

  const events = await getTrendEvents(page);
  expect(events.filter((e) => e.extra === 'trend_alert_fired')).toHaveLength(0);
  expect(events.filter((e) => e.extra === 'trend_skip:no_index')).toHaveLength(1);
});

// v0.13.0 R2 시각검증: 이상치(빨강) → 정상값 정정 → corrected(초록) 팝업 캡처(414px). 비단언.
// corrected 팝업은 echo TTS 동안만 노출되고 advance로 닫히므로, data-status='corrected'를 폴링으로
// 잡아 그 순간 스크린샷한다. mock TTS는 onend 즉발이라 짧으나 toBeVisible 폴링이 그 창을 잡는다.
test('[시각] 정정 완료 초록 팝업 캡처', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '120.5', 300); // 빨강 알람
  await fireStt(page, '80.5', 0);    // 정상값 정정 → corrected(초록) 전환 직후 즉시 캡처 시도
  const green = page.locator('[data-testid="anomaly-alert"][data-status="corrected"]');
  await expect(green).toBeVisible({ timeout: 2000 });
  await page.screenshot({ path: 'test-results/v013-anomaly-green.png' });
});
