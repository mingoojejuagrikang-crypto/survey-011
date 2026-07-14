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
  // v0.33.0 [STT-15] 재현용 — 대안(alternatives) 포함 final 결과 주입(log-replay.spec.ts와 동일 패턴).
  MockSTT.prototype.fireResultWithAlts = function(transcript, confidence, alts) {
    var alternatives = [{ transcript: transcript, confidence: confidence }];
    for (var i = 0; i < (alts || []).length; i++) {
      alternatives.push({ transcript: alts[i], confidence: confidence * 0.9 });
    }
    var result = { isFinal: true, length: alternatives.length };
    for (var j = 0; j < alternatives.length; j++) result[j] = alternatives[j];
    var event = { resultIndex: 0, results: { length: 1, 0: result } };
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

async function fireSttAlts(page: Page, transcript: string, alts: string[], waitMs = 400) {
  await page.evaluate(
    ({ t, a }) => { (window as any).__mockSTT?.fireResultWithAlts(t, 0.95, a); },
    { t: transcript, a: alts },
  );
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

// ─── v0.33.0 [STT-15] — 소수 재질문 중 alt 폴백이 조각을 전체값으로 오커밋 (07-13 실기기 A/B) ───
//
// S2 재현: "211 점 의"(decimal_fraction_lost) → 재질문 → primary "하악" 파싱 실패 →
// alts 루프가 "하나"를 fractionWhole=211 문맥을 모른 채 **전체값 "1"로 커밋**(무알람 시트 동기화).
// 수정 후: 소수부 재질문 문맥에서는 alt도 소수부 파서(정수부 합성)로만 해석 —
//   A) alt가 단자리 조각이면 211.1로 **복구**(decimal_fraction_recovered)
//   B) 어느 것으로도 해석 불가면 **재질문 유지**(문맥 보존, 전체값 폴백 금지)
// 어느 경우든 절대 "1"이 커밋되지 않는다.

test('[STT-15] A: 소수 재질문 → primary "하악" 실패 + alt "하나" → 211.1 복구 (절대 "1" 아님)', async ({ page }) => {
  await setupAndStart(page);

  // 소수부 유실 → 타깃 재질문(fractionWhole=211 무장)
  await fireStt(page, '211 점 의', 400);
  const log1 = await ttsLog(page);
  expect(log1.find((t) => t.includes('소수점 아래') && t.includes('211'))).toBeTruthy();
  await waitForActiveChip(page, '횡경'); // 미커밋 — 재질문 대기

  // 07-13 S2 시퀀스 주입: primary "하악"(파싱 불가) + alt "하나"
  await fireSttAlts(page, '하악', ['하나'], 500);

  // 조각 "하나"(=1)는 정수부와 합성되어 211.1로 커밋 → 다음 셀 진행.
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 400);
  await page.waitForTimeout(1500);

  const sessions = await getIdbSessions(page);
  const session = sessions[sessions.length - 1];
  const r1 = session.rows.find((r: any) => r.index === 1);
  expect(r1?.values?.c8).toBe('211.1'); // 복구 — "1"이 아님
  expect(r1?.values?.c9).toBe('22.2');
});

test('[STT-15] B: 소수 재질문 → primary·alt 모두 해석 불가 → 재질문 유지(문맥 보존), 이후 "하나"로 211.1', async ({ page }) => {
  await setupAndStart(page);

  await fireStt(page, '211 점 의', 400);
  await waitForActiveChip(page, '횡경');

  // primary도 alt도 숫자로 해석 불가 → 전체값 폴백 없이 같은 타깃 재질문을 반복해야 한다.
  await fireSttAlts(page, '하악', ['콜록'], 500);
  await waitForActiveChip(page, '횡경'); // 여전히 횡경 — 어떤 값도 커밋되지 않음
  const log2 = await ttsLog(page);
  const reasks = log2.filter((t) => t.includes('소수점 아래') && t.includes('211'));
  expect(reasks.length, `재질문 유지 실패. ttsLog=${JSON.stringify(log2)}`).toBeGreaterThanOrEqual(2);

  // 문맥이 보존됐으므로 다음 조각 발화가 정수부와 합성된다.
  await fireStt(page, '하나', 500);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 400);
  await page.waitForTimeout(1500);

  const sessions = await getIdbSessions(page);
  const session = sessions[sessions.length - 1];
  const r1 = session.rows.find((r: any) => r.index === 1);
  expect(r1?.values?.c8).toBe('211.1');
  // 회귀 방어: 조각이 전체값으로 선 흔적("1" 단독 커밋)이 세션 어디에도 없다.
  const anyFragmentCommit = session.rows.some(
    (r: any) => r?.values?.c8 === '1' || r?.values?.c9 === '1',
  );
  expect(anyFragmentCommit).toBe(false);
});

// ─── v0.34.0 O3 — "점요" 소수 의도 + 정수 alt 폴백의 침묵 커밋 차단 (07-14 09:25:49 실사례) ───
//
// primary "266 점요"는 파서가 decimal_fraction_lost로 잡아 타깃 재질문 대상이지만, alts 루프가
// 정수 alt "266"을 커밋해(stt_alt_used) 소수 의도를 버린 266이 침묵으로 섰다(재질문 미발동).
// 수정 후: primary가 decimal_fraction_lost면 정수 alt는 건너뛰고 타깃 재질문으로 — 소수를 온전히
// 담은 alt("266.2")만 수용한다.

test('[O3] "266 점요" + alt "266" → 정수 alt 거부·타깃 재질문 → "이"로 266.2 합성 (절대 266 아님)', async ({ page }) => {
  await setupAndStart(page);

  await fireSttAlts(page, '266 점요', ['266'], 500);
  // 침묵 커밋 없음 — 여전히 횡경 + "266 점, 소수점 아래" 타깃 재질문.
  await waitForActiveChip(page, '횡경');
  const log1 = await ttsLog(page);
  const reask = log1.find((t) => t.includes('소수점 아래') && t.includes('266'));
  expect(reask, `타깃 재질문 TTS가 없음. ttsLog=${JSON.stringify(log1)}`).toBeTruthy();

  // 조각 발화 → 266.2 합성 커밋 후 진행.
  await fireStt(page, '이', 500);
  await waitForActiveChip(page, '종경');
  await fireStt(page, '22.2', 400);
  await page.waitForTimeout(1500);

  const sessions = await getIdbSessions(page);
  const session = sessions[sessions.length - 1];
  const r1 = session.rows.find((r: any) => r.index === 1);
  expect(r1?.values?.c8).toBe('266.2');
  // 회귀 방어: 정수 alt "266"이 값으로 선 흔적이 없다.
  expect(session.rows.some((r: any) => r?.values?.c8 === '266' || r?.values?.c9 === '266')).toBe(false);
});

test('[O3] 무회귀: 소수를 온전히 담은 alt("266.2")는 정상 수용(재질문 없이 커밋)', async ({ page }) => {
  await setupAndStart(page);

  await fireSttAlts(page, '266 점요', ['266.2'], 500);
  await waitForActiveChip(page, '종경'); // alt가 소수를 담았으므로 그대로 커밋·진행
  await fireStt(page, '22.2', 400);
  await page.waitForTimeout(1500);

  const sessions = await getIdbSessions(page);
  const r1 = sessions[sessions.length - 1].rows.find((r: any) => r.index === 1);
  expect(r1?.values?.c8).toBe('266.2');
});

// v0.34.0 리뷰 High — primary가 위험 신호를 포함했는데 alt가 숫자만 남긴 경우, alt는 의미 보존
// 후보가 아니다. 자리값/독립 숫자를 삭제한 후보를 채택하지 않고 전체 발화를 재질문한다.
for (const tc of [
  { primary: '현백 33.3', alt: '33.3', reason: 'extraneous_token' },
  { primary: '이 166.7', alt: '166.7', reason: 'multi_numeric' },
]) {
  test(`[alt 의미보존] "${tc.primary}" + alt "${tc.alt}" → ${tc.reason} 재질문, alt 오커밋 없음`, async ({ page }) => {
    await setupAndStart(page);
    await fireSttAlts(page, tc.primary, [tc.alt], 500);
    await waitForActiveChip(page, '횡경');
    expect((await ttsLog(page)).some((t) => t.includes('횡경 다시 말씀해 주세요'))).toBe(true);

    // 정상 재발화만 커밋된다. 위험 primary의 숫자-only alt가 중간값으로 선 흔적은 없어야 한다.
    await fireStt(page, '44.4', 500);
    await waitForActiveChip(page, '종경');
    await fireStt(page, '22.2', 400);
    await page.waitForTimeout(1000);
    const sessions = await getIdbSessions(page);
    const r1 = sessions[sessions.length - 1].rows.find((r: any) => r.index === 1);
    expect(r1?.values?.c8).toBe('44.4');
    expect(sessions.some((s: any) => s.rows.some((r: any) => r?.values?.c8 === tc.alt))).toBe(false);
  });
}
