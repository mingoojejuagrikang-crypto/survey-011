/**
 * v0.5.0 W2/W3 회귀 테스트 — 단방향 진행(NAV-1) + "유지" 일반화(NAV-2)
 *
 * 2026-06-10 실기기 로그(NAV-1)의 시퀀스 재현:
 *   행 skip("다음") → 후속 행 완료 → (수정 전) returnRow가 skip한 행으로 복귀 →
 *   다시 "다음" → 완료 행 재프롬프트 → 완료 행으로 복귀 루프 (세션 마지막 80초 중 70초 소모).
 *
 * 수정 후 기대 동작:
 *   - "다음"은 아래 방향으로만 전진, 미완료 행은 skip 표시 + 빈 행 placeholder로 즉시 영속화.
 *   - 마지막 행까지 입력하면 빈 행 안내("N행이 비어 있습니다…") 후 자동 종료 (복귀 루프 없음).
 *   - 데이터탭에서 complete=false 행 번호가 amber(#FFB300)로 강조됨.
 *   - "유지": 값 있으면(재입력 포함) 유지+다음, 없으면 "유지할 값이 없습니다…" 명시 피드백.
 *
 * Mock 패턴은 log-replay.spec.ts / v54-30rows.spec.ts와 동일 (instant TTS + MockSTT).
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
    sheetUrl: '',
    sheetTab: '',
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
    sessionAutoLabel: 'nav-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 3,
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
      const spans = Array.from(document.querySelectorAll('span'))
        .filter((s) => s.textContent?.trim() === '▶');
      if (!spans.length) return false;
      const p = spans[0].closest('div[style]');
      return (p?.textContent || '').includes(name);
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

async function loadSessionsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011', 3);
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
  await expect(page.locator('text=REC').first()).toBeVisible({ timeout: 3000 });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('NAV-1 — "다음" 행 skip → 후속 행 완료 시 완료 행 복귀 루프 없이 빈 행 안내 후 자동 종료', async ({ page }) => {
  await startSession(page);

  // ── Row 1: 정상 입력 ──
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '28.3', 300);
  await waitForRow(page, 2);

  // ── Row 2: "다음"으로 skip (2026-06-10 로그의 행 17 skip 재현) ──
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '다음', 400);
  await waitForRow(page, 3);
  expect(await getActiveRow(page)).toBe(3);

  // ── Row 3(마지막): 완료 — 수정 전엔 여기서 returnRow가 skip 행(2)으로 복귀시키고,
  //    이후 "다음"이 완료 행을 재프롬프트하는 무한 루프(NAV-1)에 빠졌다.
  //    수정 후엔 빈 행 안내 후 자동 종료(ready 복귀)해야 한다. ──
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '41.3', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '30.2', 600);

  // 자동 종료 → ready 화면 복귀 (루프가 남아 있으면 row 2 활성 상태로 남아 여기서 실패)
  const backToReady = await page.locator('text=음성 입력 시작').first()
    .isVisible({ timeout: 8000 }).catch(() => false);
  if (!backToReady) {
    const stuckRow = await getActiveRow(page);
    console.log(`NAV-1 루프 재현: 종료되지 않고 행 ${stuckRow}에 머묾`);
  }
  expect(backToReady).toBe(true);

  // 빈 행 안내 멘트가 마지막 TTS로 나갔는지 (lastTts는 ready 전환 후 사라질 수 있으므로 로그로 검증)
  const events = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011', 3);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<Array<{ type: string; ttsText?: string; extra?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; ttsText?: string; extra?: string }>);
      req.onerror = () => res([]);
    });
  });
  const emptyAnnounce = events.find(
    (e) => (e.ttsText ?? '').includes('비어 있습니다') || (e.extra ?? '').startsWith('end_with_empty_rows'),
  );
  expect(emptyAnnounce).toBeTruthy();

  // ── IDB: skip한 행 2가 complete=false placeholder로 존재 + 행 순서 정렬 ──
  const sessions = await loadSessionsFromIDB(page) as Array<{
    completedRows: number;
    rows: Array<{ index: number; complete: boolean; values: Record<string, string> }>;
  }>;
  expect(sessions.length).toBe(1);
  const sess = sessions[0];
  expect(sess.completedRows).toBe(2);
  expect(sess.rows.map((r) => r.index)).toEqual([1, 2, 3]);
  const row2 = sess.rows.find((r) => r.index === 2)!;
  expect(row2.complete).toBe(false);
  expect(row2.values['c8'] ?? '').toBe('');
  expect(row2.values['c9'] ?? '').toBe('');
  expect(row2.values['c6']).toBe('2'); // 자동값은 채워짐
  const row3 = sess.rows.find((r) => r.index === 3)!;
  expect(row3.complete).toBe(true);
  expect(row3.values['c8']).toBe('41.3');

  // ── 데이터탭: complete=false 행 번호 amber 강조 ──
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(400);
  // 세션 카드 펼치기 (오늘 날짜 카드)
  const today = new Date().toISOString().slice(0, 10);
  await page.locator(`text=${today}`).first().click();
  await page.waitForTimeout(400);
  const amberRowNum = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('div'))
      .filter((d) => d.children.length === 0 && d.textContent?.trim() === '2');
    return cells.some((c) => getComputedStyle(c).color === 'rgb(255, 179, 0)');
  });
  expect(amberRowNum).toBe(true);
});

test('NAV-1 — "종료" 명령 시에도 skip된 빈 행 안내 1회', async ({ page }) => {
  await startSession(page);

  // Row 1 완료 → Row 2 skip → Row 3에서 "종료"
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '28.3', 300);
  await waitForRow(page, 2);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '다음', 400);
  await waitForRow(page, 3);
  await fireStt(page, '종료', 1200);

  const backToReady = await page.locator('text=음성 입력 시작').first()
    .isVisible({ timeout: 6000 }).catch(() => false);
  expect(backToReady).toBe(true);

  const events = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011', 3);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<Array<{ type: string; ttsText?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; ttsText?: string }>);
      req.onerror = () => res([]);
    });
  });
  const announce = events.filter((e) => (e.ttsText ?? '').includes('비어 있습니다'));
  expect(announce.length).toBe(1); // 1회만 안내
});

test('NAV-2 / W3 — "유지": 빈 칸이면 명시 피드백, 재입력 중이면 값 보존하고 다음 항목', async ({ page }) => {
  await startSession(page);

  // ── 케이스 1: 빈 칸에서 "유지" → "유지할 값이 없습니다" 명시 피드백 ──
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '유지', 500);
  const feedback = await page.locator('text=유지할 값이 없습니다').first()
    .isVisible({ timeout: 3000 }).catch(() => false);
  expect(feedback).toBe(true);
  // 여전히 행 1 횡경 대기 (advance되지 않음)
  expect(await getActiveRow(page)).toBe(1);

  // ── Row 1 완료 → Row 2 진입 ──
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '28.3', 300);
  await waitForRow(page, 2);

  // ── 케이스 2: "이전" 재입력 모드에서 "유지" 2회 → 값 보존 + 다음 행 전진 ──
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '이전', 500); // 행 1 재입력 모드
  await waitForRow(page, 1);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '유지', 400); // 횡경 35.1 유지 → 종경
  await waitForActiveChip(page, '종경');
  await fireStt(page, '유지', 500); // 종경 28.3 유지 → 행 끝 → 행 2로 전진
  await waitForRow(page, 2);
  expect(await getActiveRow(page)).toBe(2);

  // 값이 그대로인지 확인 후 종료
  await fireStt(page, '종료', 1000);
  const sessions = await loadSessionsFromIDB(page) as Array<{
    rows: Array<{ index: number; values: Record<string, string> }>;
  }>;
  const row1 = sessions[0]?.rows.find((r) => r.index === 1);
  expect(row1?.values['c8']).toBe('35.1');
  expect(row1?.values['c9']).toBe('28.3');
});
