/**
 * v0.33.0 항목7 — 이상치 대기 중 버튼-음성 일치 (07-10 QA P1 #2)
 *
 * 음성 이상치 알람(trendConfirm)의 팝업에 [확인][수정] 터치 버튼:
 *  - [확인] = 음성 '확인'과 동일: 커밋값 확정 + advance 1회 + trend_alert_confirmed(동일 이벤트),
 *    attribution은 command 이벤트의 extra('touch')로 구분.
 *  - [수정] = 음성 '수정'과 동일: 같은 필드 재청취(기존값은 덮어쓰기 전까지 보존) +
 *    trend_alert_dismissed:modify.
 *  + v0.34.0 A1 — 수동 입력(commitManualValue) 커밋의 이상치는 **진행 보류**(manualHold):
 *    팝업+[확인][수정] 버튼, 활성 칩은 커밋한 칩에 유지(전진 버그 수정). [확인]=advance 재개,
 *    [수정]=해당 셀 ManualValueSheet 재오픈. 알람 TTS·음성 확인 루프(trendConfirm)는 종전대로
 *    없음(민구 확정 유지 — 음성 '확인'은 이 팝업을 닫지 않는다).
 *
 * fixture/mock은 trend-alert.spec.ts와 동일(직전 회차 시트 stub + 토큰).
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(120_000);

const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

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
    columnsSheetId: 'SHEET_TREND_1',
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 10,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'anomaly-touch-test',
    noisyMode: false,
    speakerphoneMode: false,
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 12,
};

const HEADERS = ['조사일자', '농가명', '조사나무', '조사과실', '횡경', '종경'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '1', '100.0', '50.0'],
  [PREV_ROUND, '이원창', '1', '2', '110.0', '55.0'],
];

const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];
  var mockSynth = {
    speak: function(utterance) {
      window.__ttsLog.push(utterance.text);
      try { if (utterance.onstart) utterance.onstart(new Event('start')); } catch(e) {}
      try { if (utterance.onend)   utterance.onend(new Event('end'));     } catch(e) {}
    },
    cancel: function() {}, pause: function() {}, resume: function() {},
    getVoices: function() { return [{ name: 'Mock Korean', lang: 'ko-KR', default: true, localService: true, voiceURI: 'mock' }]; },
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    addEventListener: function() {}, removeEventListener: function() {}, dispatchEvent: function() { return true; },
  };
  try {
    Object.defineProperty(window, 'speechSynthesis', { get: function() { return mockSynth; }, configurable: true, enumerable: true });
  } catch(e1) {
    try { Object.defineProperty(Window.prototype, 'speechSynthesis', { get: function() { return mockSynth; }, configurable: true }); }
    catch(e2) { try { window.speechSynthesis = mockSynth; } catch(e3) {} }
  }
  var _addStyle = function() {
    var s = document.createElement('style');
    s.textContent = '* { animation-duration: 0ms !important; transition-duration: 0ms !important; }';
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _addStyle); } else { _addStyle(); }

  function MockSTT() {
    this._ls = {};
    this.continuous = true; this.interimResults = true; this.lang = 'ko-KR'; this.maxAlternatives = 3;
    window.__mockSTT = this;
  }
  MockSTT.prototype.addEventListener = function(t, cb) { if (!this._ls[t]) this._ls[t] = []; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener = function(t, cb) { if (this._ls[t]) this._ls[t] = this._ls[t].filter(function(f) { return f !== cb; }); };
  MockSTT.prototype.start = function() { var self = this; setTimeout(function() { (self._ls['start'] || []).forEach(function(cb) { cb(new Event('start')); }); }, 5); };
  MockSTT.prototype.stop = function() {};
  MockSTT.prototype.abort = function() { var self = this; setTimeout(function() { (self._ls['end'] || []).forEach(function(cb) { cb(new Event('end')); }); }, 5); };
  MockSTT.prototype.fireResult = function(transcript, confidence) {
    if (confidence === undefined) confidence = 0.95;
    var event = { resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: transcript, confidence: confidence } } } };
    (this._ls['result'] || []).forEach(function(cb) { cb(event); });
  };
  try { Object.defineProperty(window, 'SpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true }); }
  catch(e1) { try { window.SpeechRecognition = MockSTT; } catch(e2) {} }
  try { Object.defineProperty(window, 'webkitSpeechRecognition', { value: MockSTT, writable: true, configurable: true, enumerable: true }); }
  catch(e) { try { window.webkitSpeechRecognition = MockSTT; } catch(e2) {} }
})();
`;

async function stubSheets(page: Page) {
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [HEADERS, ...SHEET_ROWS] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected: ' + route.request().url() });
  });
}

async function setupAndStart(page: Page) {
  await stubSheets(page);
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ settings, storeKey }) => {
      localStorage.clear();
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
      }));
      localStorage.setItem(storeKey, JSON.stringify(settings));
      indexedDB.deleteDatabase('survey-011');
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
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

async function fireStt(page: Page, transcript: string, waitMs = 300) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } }).__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

async function waitForActiveChip(page: Page, colName: string, timeout = 5000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  );
}

async function getTtsLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog ?? []);
}

async function loadLogEventsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{ type: string; extra?: string; parsed?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; extra?: string; parsed?: string }>);
      req.onerror = () => res([]);
    });
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('[확인] 버튼 — 음성 "확인"과 동일: 값 확정 + 1회 advance + trend_alert_confirmed(touch attribution)', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  // 직전 100.0 → 120.5 = increase 알람 → 응답 대기 팝업 + 버튼.
  await fireStt(page, '120.5', 700);
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute('data-status', 'pending');
  const confirmBtn = popup.locator('[data-testid="anomaly-confirm-btn"]');
  await expect(confirmBtn).toBeVisible();

  await confirmBtn.click();
  await page.waitForTimeout(500);

  // 값 확정 + 다음 항목으로 정확히 1회 이동(종경).
  await waitForActiveChip(page, '종경');
  await expect(popup).toHaveCount(0);

  const events = await loadLogEventsFromIDB(page);
  // 음성과 동일 이벤트(trend_alert_confirmed) + attribution은 command extra('touch')로.
  expect(events.some((e) => e.type === 'trend' && e.extra === 'trend_alert_confirmed')).toBe(true);
  expect(events.some((e) => e.type === 'command' && e.parsed === 'confirm' && e.extra === 'touch')).toBe(true);
});

/**
 * v0.38.0 리뷰#1(Codex High) — 이상치 대기 중 **UI 전용 음성명령이 알람을 소모하던** 결함 회귀.
 *
 * 결함: resolveFinal이 '확인'/'유지'가 아닌 **모든** 명령을 trendDemoted=true로 내보내
 * setAnomalyAlert(null)이 실행됐다. 그래서 "도움말"이라고 말하면 미확인 이상치 경고가 사라졌다.
 * 반면 같은 도움말을 **화면 버튼으로 열면 알람이 유지**된다 — 음성/터치 불일치이자, 사용자가
 * 이상값을 확인·수정하지 않고 넘어갈 수 있는 데이터 무결성 문제(PRINCIPLES 시각·청각 일치).
 *
 * 이 파일에 두는 이유: 비교 기준인 **터치 경로의 동등성 계약**이 여기 있다.
 */
test('[리뷰#1] 이상치 대기 중 음성 "도움말"은 알람을 지우지 않는다(터치와 동등)', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  // 직전 100.0 → 120.5 = increase 알람.
  await fireStt(page, '120.5', 700);
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute('data-status', 'pending');

  // UI 전용 명령 — 도움말이 열려야 하고, 이상치 알람은 **그대로 남아야** 한다.
  await fireStt(page, '도움말', 700);
  await expect(page.locator('[data-testid="command-help-popup"]')).toBeVisible();
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute('data-status', 'pending');

  // 알람을 소모하지 않았으므로 해제 이벤트도 없어야 한다(로그로도 고정).
  const events = await loadLogEventsFromIDB(page);
  expect(events.some((e) => e.type === 'trend' && (e.extra ?? '').startsWith('trend_alert_dismissed'))).toBe(false);

  // 여전히 이상치 대기 상태다 — 음성 '확인'으로 정상 해소되고 다음 항목으로 1회 진행한다.
  await page.locator('[data-testid="cmd-help-close"]').click();
  await expect(page.locator('[data-testid="command-help-popup"]')).toHaveCount(0);
  await fireStt(page, '확인', 700);
  await waitForActiveChip(page, '종경');
  await expect(popup).toHaveCount(0);
});

test('[수정] 버튼 — 음성 "수정"과 동일: 같은 필드 재청취 + 기존값 보존(덮어쓰기 전까지) + dismissed 로그', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  await fireStt(page, '120.5', 700);
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();

  await popup.locator('[data-testid="anomaly-modify-btn"]').click();
  await page.waitForTimeout(500);

  // 팝업 해제 + 같은 필드(횡경)에서 재청취("다시 말씀해 주세요") — 진행하지 않음.
  await expect(popup).toHaveCount(0);
  await waitForActiveChip(page, '횡경');
  const tts = await getTtsLog(page);
  expect(tts.some((t) => t.includes('횡경') && t.includes('다시 말씀해'))).toBe(true);

  const events = await loadLogEventsFromIDB(page);
  expect(events.some((e) => e.type === 'trend' && e.extra === 'trend_alert_dismissed:modify')).toBe(true);
  expect(events.some((e) => e.type === 'command' && e.parsed === 'modify' && e.extra === 'touch')).toBe(true);

  // 새 값(감소 → 무알람) 발화 → 수정 의미론(previousValue=120.5)으로 재커밋 + 진행.
  await fireStt(page, '99.5', 600);
  await waitForActiveChip(page, '종경');
});

/** 칩 탭 → 키패드로 120.5(=increase 알람 값) 수동 입력 커밋(공용 헬퍼). */
async function commitManual1205(page: Page) {
  await page.locator('[data-testid="column-chip"][data-col-name="횡경"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();
  for (const k of ['1', '2', '0', '.', '5']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await page.waitForTimeout(700);
}

test('v0.34.0 A1 — 수동 커밋 이상치: 진행 보류(활성 칩 부동 + 버튼) → [확인]으로 전진', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');
  await commitManual1205(page);

  // 진행 보류: 팝업+버튼 표시, 활성 칩은 **횡경에 유지**(이전 버그: 종경으로 전진·활성화).
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute('data-status', 'pending');
  await expect(popup).toContainText('120.5');
  await expect(popup.locator('[data-testid="anomaly-confirm-btn"]')).toBeVisible();
  await expect(popup.locator('[data-testid="anomaly-modify-btn"]')).toBeVisible();
  await waitForActiveChip(page, '횡경');
  const tts = await getTtsLog(page);
  expect(tts.some((t) => t.includes('추세 알람'))).toBe(false); // 알람 TTS 미발화(민구 확정 유지)

  // 음성 '확인'은 이 팝업을 닫지 않는다(trendConfirm 미무장 — 음성 확인 루프 없음 계약).
  await fireStt(page, '확인', 500);
  await expect(popup).toBeVisible();
  await waitForActiveChip(page, '횡경');

  // [확인] 버튼 → 팝업 해제 + 그제서야 종경으로 전진.
  await popup.locator('[data-testid="anomaly-confirm-btn"]').click();
  await page.waitForTimeout(500);
  await expect(popup).toHaveCount(0);
  await waitForActiveChip(page, '종경');

  // 텔레메트리: hold 마커 fired + touch:manual_hold attribution.
  const events = await loadLogEventsFromIDB(page) as Array<{ type: string; extra?: string; parsed?: string }>;
  const fired = events.find((e) => e.type === 'trend' && (e.extra ?? '').startsWith('trend_alert_fired'));
  expect(fired, 'trend_alert_fired 미기록').toBeTruthy();
  expect(fired!.extra).toContain('src=manual');
  expect(fired!.extra).toContain('hold=1');
  expect(events.some((e) => e.type === 'command' && e.parsed === 'confirm' && e.extra === 'touch:manual_hold')).toBe(true);
  expect(events.some((e) => e.type === 'trend' && e.extra === 'trend_alert_confirmed')).toBe(true);
});

test('v0.34.0 A1 — 수동 커밋 이상치 [수정]: 팝업 해제 + 해당 셀 시트 재오픈 → 재커밋 후 진행', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');
  await commitManual1205(page);

  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();

  // [수정] → 같은 셀(횡경) ManualValueSheet 재오픈(VoiceScreen 조립 경로). 팝업은 시트가 덮는
  // 동안 렌더되지 않는다(v0.34.0 리뷰 라운드2 — **보류 상태 자체는 유지**되어 시트를 취소하면
  // 팝업이 되살아난다. 미확인 이상값이 확정된 것처럼 남던 누수 차단. 취소 경로 회귀는
  // manual-input.spec.ts '[수정] 후 시트 취소' 참조).
  await popup.locator('[data-testid="anomaly-modify-btn"]').click();
  await expect(popup).toHaveCount(0);
  const sheet = page.locator('[data-testid="manual-value-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 3000 });
  await expect(sheet).toContainText('횡경');

  // 정상값(99.5 — increase 규칙 무알람) 재커밋 → 종경으로 진행.
  for (const k of ['9', '9', '.', '5']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toHaveCount(0);
  await waitForActiveChip(page, '종경');

  const events = await loadLogEventsFromIDB(page) as Array<{ type: string; extra?: string; parsed?: string }>;
  expect(events.some((e) => e.type === 'command' && e.parsed === 'modify' && e.extra === 'touch:manual_hold')).toBe(true);
  // v0.34.0 리뷰 라운드2 — [수정]은 더 이상 보류를 '해제'하지 않는다(성공 재커밋으로만 해소).
  expect(events.some((e) => e.type === 'trend' && e.extra === 'trend_alert_modify_reopen:hold_kept')).toBe(true);
});

// ── v0.35.3 리뷰 r1 회귀(3모델 공통 Critical/High) — trendConfirm 강등 시 fractionWhole 보존 ──
// 시나리오: 이상치 응답 대기 중 정정 발화가 소수부 유실("130 점 에" → fractionWhole='130' 재질문)
// → 사용자가 '수정' 발화(trendConfirm → modify 강등) → 소수부만 "5" 응답.
// 종전(v0.35.2, 객체 변이)은 정수부 문맥이 보존돼 130.5로 합성 커밋됐다. 유니온 전환의 강등
// 재대입이 fractionWhole을 빠뜨리면 "5"가 전체값 5.0으로 오커밋된다(데이터 오염) — 이를 고정.
test('trendConfirm 중 소수부 재질문 → "수정" 강등 → 소수부 "5" = 130.5 합성(전체값 5 오커밋 금지)', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  // 직전 100.0 → 120.5 = increase 알람 → trendConfirm 응답 대기.
  await fireStt(page, '120.5', 700);
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();

  // 정정 발화가 소수부 유실 → 정수부(130) 유지 타깃 재질문(트렌드 대기 유지).
  await fireStt(page, '130 점 에', 500);
  const tts1 = await getTtsLog(page);
  expect(tts1.some((t) => t.includes('130') && t.includes('소수점 아래'))).toBe(true);

  // '수정' — trendConfirm이 modify로 강등되며 재질문. fractionWhole(130)이 살아 있어야 한다.
  await fireStt(page, '수정', 500);
  const tts2 = await getTtsLog(page);
  expect(tts2.some((t) => t.includes('횡경') && t.includes('다시'))).toBe(true);

  // 소수부만 응답 → 130.5 합성 커밋(재위반 알람은 떠도 무방 — 값 자체가 계약).
  await fireStt(page, '5', 700);
  // persist는 fire-and-forget — 고정 대기 대신 poll로 최종값 수렴 확인(리뷰 s3r2 Codex Low).
  await expect.poll(() => readRow1C8(page), { timeout: 5000 }).toBe('130.5');
});

// 위 시나리오의 터치 변형 — 팝업 [수정] 버튼(modifyAnomalyTouch)도 같은 demoteTrendConfirm을
// 쓰지만, 추후 두 경로가 갈라져도 각각 잡히도록 별도 고정(리뷰 s3r2 Codex Low).
test('trendConfirm 중 소수부 재질문 → [수정] 터치 강등 → 소수부 "5" = 130.5 합성', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  await fireStt(page, '120.5', 700);
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible();

  await fireStt(page, '130 점 에', 500);
  const tts1 = await getTtsLog(page);
  expect(tts1.some((t) => t.includes('130') && t.includes('소수점 아래'))).toBe(true);

  // 터치 [수정] — modifyAnomalyTouch 강등 경로.
  await popup.locator('[data-testid="anomaly-modify-btn"]').click();
  await page.waitForTimeout(400);

  await fireStt(page, '5', 700);
  await expect.poll(() => readRow1C8(page), { timeout: 5000 }).toBe('130.5');
});

/** 1행 횡경(c8)의 영속 값 — 최신 세션에서 읽는다(poll 대상). */
async function readRow1C8(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('sessions', 'readonly');
    const all: Array<{ rows: Array<{ index: number; values: Record<string, string> }> }> =
      await new Promise((res, rej) => {
        const rq = tx.objectStore('sessions').getAll();
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
    db.close();
    const s = all[all.length - 1];
    return s?.rows.find((r) => r.index === 1)?.values?.c8 ?? null;
  });
}
