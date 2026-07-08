/**
 * v0.10.0 A1 — 소수점 타깃 재질문 E2E (민구 결정: 값 추측 금지, 정수부 유지하고 소수부만 재질문)
 *
 * 실기기(2026-06-16): "111.1" 발화 → iOS STT가 "111 점 에"로 소수부를 오전사 →
 * decimal_fraction_lost로 항목 전체 재질문 → 3~4회 재발화. A1은 같은 STT 문자열이 111.1·111.5
 * 양쪽에서 나오므로 "에→1" 추측을 하지 않고(조용한 오커밋 방지), 정수부(111)를 유지한 채
 * "소수점 아래만" 타깃 재질문한다. 다음 발화가 소수 한 자리면 합성 커밋, 전체값을 다시 말하면 그대로.
 *
 * 이 경로(useVoiceSession handleFinal의 fractionWhole 분기)는 순수함수 단위(koreanNum.spec)가
 * 닿지 못하는 호출자 상태머신이므로 E2E로 검증한다(advisor 갭 지적 반영).
 *
 * MockSTT/mockSynth 주입·헬퍼는 correction-flow.spec.ts 패턴을 그대로 따른다.
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(120_000);

const BASE = 'http://localhost:5175';

const SETTINGS = {
  state: {
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: '',
    sheetTab: '',
    availableSheets: [],
    manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
      { id: 'c7', name: '조사과실', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 5 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: 10,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'a1-reask-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 3,
};

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

async function fireStt(page: Page, transcript: string, waitMs = 300) {
  await page.evaluate((t) => { (window as any).__mockSTT?.fireResult(t, 0.95); }, transcript);
  await page.waitForTimeout(waitMs);
}

async function waitForActiveChip(page: Page, colName: string, timeout = 6000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  );
}

async function ttsLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__ttsLog || []);
}

async function getIdbSessions(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const req = indexedDB.open('survey-011');
      req.onsuccess = () => resolve(req.result as any);
      req.onerror = () => reject(req.error);
    });
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    return new Promise<any[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as any);
      req.onerror = () => reject(req.error);
    });
  });
}

async function setupAndStart(page: Page) {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => { localStorage.setItem('survey-011-settings-v3', JSON.stringify(s)); }, SETTINGS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await waitForActiveChip(page, '횡경');
}

test('A1 타깃 재질문: "111 점 에" → 정수부 유지·재질문, "오" → 111.5 합성 커밋', async ({ page }) => {
  await setupAndStart(page);

  // 소수부 오전사 — 값 추측(에→1) 없이, 정수부(111) 유지하고 "소수점 아래만" 타깃 재질문.
  await fireStt(page, '111 점 에', 400);
  // 항목 전체 재질문("횡경 다시...")이 아니라 정수부+소수점 안내가 떠야 한다.
  const log1 = await ttsLog(page);
  const reask = log1.find((t) => t.includes('소수점 아래'));
  expect(reask, `타깃 재질문 TTS가 없음. ttsLog=${JSON.stringify(log1)}`).toBeTruthy();
  expect(reask).toContain('111');
  // 값은 아직 커밋되지 않아 여전히 횡경에 머문다(다음 셀 종경으로 안 넘어감).
  await waitForActiveChip(page, '횡경');

  // 소수부 한 자리 → 정수부와 합성(111.5) 후 다음 셀로 진행.
  await fireStt(page, '오', 400);
  await waitForActiveChip(page, '종경');

  await fireStt(page, '22.2', 400);
  await page.waitForTimeout(1500);

  const sessions = await getIdbSessions(page);
  expect(sessions.length).toBeGreaterThan(0);
  const session = sessions[sessions.length - 1];
  const row1 = session.rows.find((r: any) => r.index === 1);
  expect(row1?.values?.c8).toBe('111.5'); // 추측(111.1) 아닌 사용자가 말한 111.5
  expect(row1?.values?.c9).toBe('22.2');
});

test('A1 타깃 재질문 후 전체값 재발화: "111 점 에" → "111.5" → 그대로 커밋', async ({ page }) => {
  await setupAndStart(page);

  await fireStt(page, '111 점 에', 400);
  await waitForActiveChip(page, '횡경'); // 재질문 중, 미진행

  // 사용자가 정수부까지 포함해 전체를 다시 말함 → 합성하지 않고 그대로 커밋.
  await fireStt(page, '111.5', 400);
  await waitForActiveChip(page, '종경');

  await fireStt(page, '22.2', 400);
  await page.waitForTimeout(1500);

  const sessions = await getIdbSessions(page);
  const session = sessions[sessions.length - 1];
  const row1 = session.rows.find((r: any) => r.index === 1);
  expect(row1?.values?.c8).toBe('111.5');
});
