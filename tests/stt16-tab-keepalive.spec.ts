/**
 * v0.33.0 항목4 [STT-16] — 탭 전환 후 마이크(STT) 생존 + 포그라운드 복귀 즉시 복구(kick)
 *
 * 07-13 실기기 로그(2/2 세션 재현): App.tsx 조건부 렌더 때문에 탭 전환 시 VoiceScreen이
 * unmount → 인식기·워치독·onTokenSettled 구독 전부 teardown. 복귀(재마운트) 후에도 인식이
 * 자동 재시작되지 않아 S1 62초 / S2 20초 사공백 — 사용자가 수동 pause/resume로만 소생.
 *
 * 수정(택일 (a) keep-alive 렌더): 세션이 살아 있는 동안 VoiceScreen을 display:none으로
 * 유지(unmount 금지) → 인식기가 탭 전환을 그대로 관통해 살아남는다. 세션이 없으면 기존대로
 * unmount(첫 진입 전 prewarm 안 뜸).
 *
 * 함께 검증: 항목4의 visibilitychange/pageshow 복귀 훅 — kick_result:* 텔레메트리 배선.
 *
 * Mock 패턴은 nav-unidirectional.spec.ts와 동일 (instant TTS + MockSTT).
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(120_000);

const BASE = 'http://localhost:5175';
const TOTAL_ROWS = 3;

const SETTINGS_3ROWS = {
  state: {
    googleConnected: false,
    userEmail: null,
    sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_1/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TEST_1',
    columnsSheetTab: 'Sheet1',
    availableSheets: [],
    manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true,  auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true,  auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true,
    totalRows: TOTAL_ROWS,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'stt16-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 12,
};

const MOCK_INIT_SCRIPT = `
(function() {
  var mockSynth = {
    speak: function(utterance) {
      try { if (utterance.onstart) utterance.onstart(new Event('start')); } catch(e) {}
      try { if (utterance.onend)   utterance.onend(new Event('end'));     } catch(e) {}
    },
    cancel: function() {},
    pause: function() {},
    resume: function() {},
    getVoices: function() {
      return [{ name: 'Mock Korean', lang: 'ko-KR', default: true, localService: true, voiceURI: 'mock' }];
    },
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    addEventListener: function() {},
    removeEventListener: function() {},
    dispatchEvent: function() { return true; },
  };
  try {
    Object.defineProperty(window, 'speechSynthesis', {
      get: function() { return mockSynth; },
      configurable: true,
      enumerable: true,
    });
  } catch(e1) {
    try {
      Object.defineProperty(Window.prototype, 'speechSynthesis', {
        get: function() { return mockSynth; },
        configurable: true,
      });
    } catch(e2) {
      try { window.speechSynthesis = mockSynth; } catch(e3) {}
    }
  }

  var _addStyle = function() {
    var s = document.createElement('style');
    s.textContent = '* { animation-duration: 0ms !important; transition-duration: 0ms !important; }';
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _addStyle);
  } else {
    _addStyle();
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
  } catch(e1) {
    try { window.SpeechRecognition = MockSTT; } catch(e2) {}
  }
  try {
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      value: MockSTT, writable: true, configurable: true, enumerable: true,
    });
  } catch(e) {
    try { window.webkitSpeechRecognition = MockSTT; } catch(e2) {}
  }
})();
`;

async function fireStt(page: Page, transcript: string, waitMs = 300) {
  await page.evaluate((t) => {
    const stt = (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } }).__mockSTT;
    if (stt) stt.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

async function waitForActiveChip(page: Page, colName: string, timeout = 4000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  ).catch(() => {});
}

async function waitForRow(page: Page, targetRow: number, timeout = 6000) {
  await page.waitForFunction(
    ({ r, total }) => {
      const m = document.body.innerText.match(new RegExp('(\\d+)\\s*\\/\\s*' + total + '\\s*행'));
      return m ? parseInt(m[1]) === r : false;
    },
    { r: targetRow, total: TOTAL_ROWS },
    { timeout },
  ).catch(() => {});
}

async function getActiveRow(page: Page): Promise<number> {
  const text = await page.evaluate(() => document.body.innerText);
  const m = text.match(new RegExp('(\\d+)\\s*\\/\\s*' + TOTAL_ROWS + '\\s*행'));
  return m ? parseInt(m[1]) : -1;
}

async function loadLogEventsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<Array<{ type: string; extra?: string; parsed?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; extra?: string; parsed?: string }>);
      req.onerror = () => res([]);
    });
  });
}

async function loadSessionsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<object[]>((res) => {
      const tx = db.transaction('sessions', 'readonly');
      const req = tx.objectStore('sessions').getAll();
      req.onsuccess = () => res(req.result as object[]);
      req.onerror = () => res([]);
    });
  });
}

async function startSession(page: Page) {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('survey-011-settings-v3', JSON.stringify(s));
    indexedDB.deleteDatabase('survey-011');
  }, SETTINGS_3ROWS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);

  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('[STT-16] 탭 전환(입력→데이터→입력) 후 STT 자동 생존 — 수동 pause/resume 없이 값 커밋 계속', async ({ page }) => {
  await startSession(page);

  // Row 1 횡경 커밋 → 종경 대기 상태에서 탭 전환
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');

  // 기준점: 지금까지의 prewarm 횟수(최초 마운트분 — dev StrictMode는 마운트 효과를 2회 돌리므로
  // 절대값 대신 "탭 왕복 후 증가 없음"을 단언한다).
  const prewarmsBefore = (await loadLogEventsFromIDB(page))
    .filter((e) => e.extra === 'mic_prewarm_attempt').length;
  expect(prewarmsBefore).toBeGreaterThan(0);

  // 입력 → 데이터 → 입력 (07-13 S1/S2 재현 시퀀스)
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(400);

  // keep-alive: 세션 UI가 그대로 살아 있다(ready로 리셋되지 않음).
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });

  // 핵심 단언: 복귀 직후 아무 조작 없이 STT 발화가 그대로 커밋된다(구버전: 인식기 teardown → 무반응).
  await fireStt(page, '28.3', 600);
  await waitForRow(page, 2);
  expect(await getActiveRow(page)).toBe(2); // 행 1 완료 → 자동 전진 = 인식기 생존 증명

  // 텔레메트리: 탭 전환 왕복이 기록되고(B-4), 재마운트가 없었으므로 mic_prewarm은 최초 1회뿐.
  const events = await loadLogEventsFromIDB(page);
  const tabEvents = events.filter((e) => e.type === 'command' && e.parsed === 'tab');
  expect(tabEvents.some((e) => e.extra === 'tab:voice->data')).toBe(true);
  expect(tabEvents.some((e) => e.extra === 'tab:data->voice')).toBe(true);
  const prewarms = events.filter((e) => e.extra === 'mic_prewarm_attempt');
  expect(prewarms.length).toBe(prewarmsBefore); // 재마운트 없음 = unmount teardown 자체가 사라짐

  // IDB: 탭 전환을 관통해 행 1이 정상 완료로 영속화됨.
  await fireStt(page, '종료', 1000);
  const sessions = await loadSessionsFromIDB(page) as Array<{
    rows: Array<{ index: number; complete: boolean; values: Record<string, string> }>;
  }>;
  const row1 = sessions[0]?.rows.find((r) => r.index === 1);
  expect(row1?.complete).toBe(true);
  expect(row1?.values['c8']).toBe('35.1');
  expect(row1?.values['c9']).toBe('28.3');
});

test('세션 없으면 keep-alive 없음 — 입력탭 이탈 시 VoiceScreen unmount(재진입 시 prewarm 재시도)', async ({ page }) => {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('survey-011-settings-v3', JSON.stringify(s));
    indexedDB.deleteDatabase('survey-011');
  }, SETTINGS_3ROWS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  // 세션 시작 없이 입력탭 → 데이터탭 → 입력탭 왕복: 매 진입이 fresh mount여야 한다.
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(400);
  const prewarmsFirstEntry = (await loadLogEventsFromIDB(page))
    .filter((e) => e.extra === 'mic_prewarm_attempt').length;
  expect(prewarmsFirstEntry).toBeGreaterThan(0);

  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(400);

  const events = await loadLogEventsFromIDB(page);
  const prewarms = events.filter((e) => e.extra === 'mic_prewarm_attempt');
  // 재진입 = fresh mount → prewarm이 추가로 발화(세션 없을 때 기존 수명주기 보존).
  expect(prewarms.length).toBeGreaterThan(prewarmsFirstEntry);
});

test('항목4 — 포그라운드 복귀 훅: pageshow/visibilitychange가 kick_result:* + lifecycle:vis_*를 남긴다', async ({ page }) => {
  await startSession(page);
  await waitForActiveChip(page, '횡경');

  // OS 복귀 시뮬레이션: pageshow + visibilitychange(테스트 페이지는 visible 상태) 디스패치.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('pageshow'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(400);

  const events = await loadLogEventsFromIDB(page);
  // 인식기가 정상 가동 중이므로 kick은 no-op 판정('running') — 맹목 재시작 churn 없음.
  const kickPageshow = events.find((e) => (e.extra ?? '').startsWith('kick_result:pageshow:'));
  expect(kickPageshow, 'pageshow kick_result 미기록').toBeTruthy();
  expect(kickPageshow!.extra).toBe('kick_result:pageshow:running');
  const kickVis = events.find((e) => (e.extra ?? '').startsWith('kick_result:vis:'));
  expect(kickVis, 'visibilitychange kick_result 미기록').toBeTruthy();
  expect(kickVis!.extra).toBe('kick_result:vis:running');
  // App 레벨 lifecycle:vis_* 계측(v0.33.0 B 신규)도 같은 디스패치로 발화.
  expect(events.some((e) => e.extra === 'lifecycle:vis_visible')).toBe(true);

  // 복귀 후에도 값 커밋 정상(회귀 방어).
  await fireStt(page, '35.1', 400);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '종료', 800);
});
