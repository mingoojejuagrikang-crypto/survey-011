/**
 * v0.33.0 항목6 — 칩 터치 수동 입력(ManualValueSheet) E2E
 *
 * 음성 칩 탭 → 하단 시트 → 타입별 입력(키패드/선택지) → commitManualValue:
 *  - 열림/닫힘 동안 STT hard-suspend/resume (ui_suspend/ui_resume · manual_input — 도움말 팝업 경로 재사용)
 *  - `manual_commit` 텔레메트리(항목3 예약분, command + extra:'touch')
 *  - awaiting 필드 커밋이면 echo 후 advance (음성 커밋과 동일 진행)
 *  - float는 col.decimals 자리수 검증(validateManual) — 초과 시 커밋 차단 + 사유 표시
 *  - "음성으로 다시 입력"은 기존 restartFromCol 경로 보존
 *  - 검토 대기(reviewWait, 항목2) 중 커밋이면 검토 대기 재무장(재낭독)
 *  - 이상치 규칙 위반 커밋은 **시각 팝업+비프만**(trendConfirm/버튼/알람 TTS 없음 — 민구 확정)
 *  + 항목8 — 커밋 후 시각 영수증("저장됨/수정됨 · N행 <필드> <값>") 잔류 표시.
 *
 * Mock/fixture 패턴은 nav-unidirectional.spec.ts(기본)·trend-alert.spec.ts(이상치)와 동일.
 */

import { test, expect, type Page } from '@playwright/test';

test.setTimeout(120_000);

const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';

const BASE_SETTINGS = {
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
    totalRows: 3,
    ttsRate: 1.05,
    sessionLabelColId: null,
    sessionAutoLabel: 'manual-test',
    noisyMode: false,
    preferredVoiceName: '',
  },
  version: 3,
};

/** options 음성 컬럼 fixture — 선택지 버튼 그리드 검증용. */
const OPTIONS_SETTINGS = {
  ...BASE_SETTINGS,
  state: {
    ...BASE_SETTINGS.state,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '과실상태', type: 'options', input: 'voice', ttsAnnounce: true, auto: { kind: 'options', available: ['정상', '병해', '낙과'], selected: [] } },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
  },
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

async function loadLogEventsFromIDB(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{ type: string; extra?: string; parsed?: string; text?: string; row?: number; colId?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; extra?: string; parsed?: string; text?: string; row?: number; colId?: string }>);
      req.onerror = () => res([]);
    });
  });
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
    return sessions as Array<{ rows: Array<{ index: number; complete: boolean; values: Record<string, string> }> }>;
  });
}

async function setupAndStart(page: Page, settings: unknown = BASE_SETTINGS) {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('survey-011');
    },
    { s: settings, storeKey: STORE_KEY },
  );
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

/** 활성/특정 음성 칩 탭 → 시트 열림 대기. */
async function openSheetFor(page: Page, colName: string) {
  await page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 3000 });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('float 키패드 — 칩 탭→시트→3·5·.·1→입력: manual_commit + suspend/resume + advance + 영수증', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  await openSheetFor(page, '횡경');
  for (const k of ['3', '5', '.', '1']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(500);

  // awaiting 셀 커밋 → 음성 커밋과 동일하게 다음 필드(종경)로 진행.
  await waitForActiveChip(page, '종경');

  // 항목8 — 시각 영수증 잔류: "저장됨 · 1행 횡경 35.1" (다음 항목 진행 후에도 보인다).
  const receipt = page.locator('[data-testid="commit-receipt"]');
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('저장됨');
  await expect(receipt).toContainText('1행');
  await expect(receipt).toContainText('횡경');
  await expect(receipt).toContainText('35.1');

  // 텔레메트리: manual_commit(항목3 예약분) + 시트 열림/닫힘의 STT suspend/resume(manual_input).
  const events = await loadLogEventsFromIDB(page);
  const mc = events.find((e) => e.type === 'command' && e.parsed === 'manual_commit');
  expect(mc, 'manual_commit 이벤트 미기록').toBeTruthy();
  expect(mc!.text).toBe('35.1');
  expect(mc!.extra).toBe('touch');
  expect(events.some((e) => e.parsed === 'ui_suspend' && e.extra === 'manual_input')).toBe(true);
  expect(events.some((e) => e.parsed === 'ui_resume' && e.extra === 'manual_input')).toBe(true);

  // STT 생존(resume 후): 종경을 음성으로 커밋해 행 완료 → 행 2.
  await fireStt(page, '22.2', 500);
  await waitForRow(page, 2);

  await fireStt(page, '종료', 1000);
  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1]?.rows.find((r) => r.index === 1);
  expect(row1?.values['c8']).toBe('35.1');
  expect(row1?.values['c9']).toBe('22.2');
  expect(row1?.complete).toBe(true);
});

test('float decimals 검증 — 소수 2자리(35.12) 입력 차단 + 사유 표시, 백스페이스 후 정상 커밋', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  await openSheetFor(page, '횡경');
  for (const k of ['3', '5', '.', '1', '2']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  // 커밋 차단 — 시트 유지 + 사유(자리수) 표시.
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();
  await expect(page.locator('[data-testid="manual-error"]')).toContainText('1자리');

  // 백스페이스로 35.1 → 정상 커밋.
  await page.locator('[data-testid="manual-key-back"]').click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(400);
  await waitForActiveChip(page, '종경');

  const events = await loadLogEventsFromIDB(page);
  const commits = events.filter((e) => e.parsed === 'manual_commit');
  expect(commits.length).toBe(1); // 차단된 35.12는 커밋되지 않음
  expect(commits[0].text).toBe('35.1');
});

test('"음성으로 다시 입력" — 시트 닫힘 + 기존 restartFromCol 경로(재안내) 보존', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  await openSheetFor(page, '횡경');
  await page.locator('[data-testid="manual-voice-retry"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(400);

  // restartFromCol 로그(터치 재시작) + 여전히 횡경 대기 → 음성 커밋이 정상 동작.
  const events = await loadLogEventsFromIDB(page);
  expect(events.some((e) => e.type === 'command' && e.parsed === 'restart' && e.extra === 'touch')).toBe(true);
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 400);
  await waitForActiveChip(page, '종경');
});

test('options 그리드 — 선택지 버튼 탭 즉시 커밋(선택지 외 값 없음)', async ({ page }) => {
  await setupAndStart(page, OPTIONS_SETTINGS);
  await waitForActiveChip(page, '과실상태');

  await openSheetFor(page, '과실상태');
  const grid = page.locator('[data-testid="manual-options-grid"]');
  await expect(grid).toBeVisible();
  await expect(grid.locator('button')).toHaveCount(3);
  await grid.getByText('병해', { exact: true }).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(400);
  await waitForActiveChip(page, '종경');

  const receipt = page.locator('[data-testid="commit-receipt"]');
  await expect(receipt).toContainText('과실상태');
  await expect(receipt).toContainText('병해');

  await fireStt(page, '22.2', 400);
  await fireStt(page, '종료', 1000);
  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1]?.rows.find((r) => r.index === 1);
  expect(row1?.values['c8']).toBe('병해');
});

test('취소 — 값 미커밋 + resume 후 음성 입력 계속', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  await openSheetFor(page, '횡경');
  await page.locator('[data-testid="manual-key-9"]').click();
  await page.locator('[data-testid="manual-cancel"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await page.waitForTimeout(400);

  const events = await loadLogEventsFromIDB(page);
  expect(events.some((e) => e.parsed === 'manual_commit')).toBe(false);
  // 여전히 횡경 대기 + STT 재개 확인.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 400);
  await waitForActiveChip(page, '종경');
});

test('검토 대기(항목2)와 상호작용 — 완료 행 검토 중 칩 수동 수정 → 검토 대기 재무장(갱신값 재낭독)', async ({ page }) => {
  await setupAndStart(page);

  // Row 1 완료(35.1/22.2) → Row 2 → "이전" → 검토 대기.
  await waitForActiveChip(page, '횡경');
  await fireStt(page, '35.1', 300);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 300);
  await waitForRow(page, 2);
  await fireStt(page, '이전', 600);
  await waitForRow(page, 1);

  // 검토 대기 중 종경 칩 탭 → 시트 → 30.7 수동 커밋.
  await openSheetFor(page, '종경');
  for (const k of ['3', '0', '.', '7']) {
    await page.locator(`[data-testid="manual-key-${k}"]`).click();
  }
  await page.locator('[data-testid="manual-commit"]').click();
  await page.waitForTimeout(600);

  // 검토 대기 재무장: 행 1 유지 + 갱신값 재낭독 TTS("1행 완료됨. … 30.7").
  await waitForRow(page, 1);
  const tts = await page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog ?? []);
  const rereads = tts.filter((t) => t.includes('1행 완료됨'));
  expect(rereads.length, `검토 대기 재낭독 없음. tts=${JSON.stringify(tts.slice(-6))}`).toBeGreaterThanOrEqual(2);
  expect(rereads[rereads.length - 1]).toContain('30.7');

  // bare 값 발화는 여전히 흡수(덮어쓰기 금지 계약 유지).
  await fireStt(page, '99.9', 500);
  await waitForRow(page, 1);

  // "다음"으로 검토 종료 → 종료 후 값 확인(수동 30.7 반영, bare 99.9 미반영).
  await fireStt(page, '다음', 600);
  await waitForRow(page, 2);
  await fireStt(page, '종료', 1000);
  const sessions = await getIdbSessions(page);
  const row1 = sessions[sessions.length - 1]?.rows.find((r) => r.index === 1);
  expect(row1?.values['c9']).toBe('30.7');
  expect(row1?.values['c8']).toBe('35.1');
});

test('영수증(항목8) — 음성 커밋 "저장됨", 수정 커밋 "수정됨 이전→새값"', async ({ page }) => {
  await setupAndStart(page);
  await waitForActiveChip(page, '횡경');

  await fireStt(page, '35.1', 400);
  const receipt = page.locator('[data-testid="commit-receipt"]');
  await expect(receipt).toContainText('저장됨');
  await expect(receipt).toContainText('35.1');

  // "수정 36.2" 직접 수정 → 수정됨 · 이전(35.1)→새값(36.2).
  await fireStt(page, '수정 36.2', 600);
  await expect(receipt).toContainText('수정됨');
  await expect(receipt).toContainText('35.1');
  await expect(receipt).toContainText('36.2');
});
