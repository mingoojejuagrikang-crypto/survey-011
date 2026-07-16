/**
 * STT/TTS 목 픽스처 — MockSTT(fireResult/fireResultWithAlts)·mockSynth(__ttsLog) 주입의 SSOT
 * (v0.35.1 Stage 1-6 신설).
 *
 * 종전에는 24개 spec이 correction-flow.spec.ts의 MOCK_INIT_SCRIPT를 복붙해, 목 동작을 고치면
 * 전수 grep 갱신이 필요했다. 이 fixture가 규약을 한 곳으로 모은다.
 *
 *  - **신규 spec은 이 fixture 사용이 의무**(민구 승인 리팩토링 플랜, 2026-07-14). 기존 spec은
 *    점진 전환 — 손대는 김에 옮기되, 옮기기 위한 수정은 하지 않는다.
 *  - 주입 스크립트는 page.addInitScript({ content })로 실행되는 **문자열**이다(브라우저 컨텍스트
 *    직렬화 제약 — import 불가). 목 자체를 바꿀 땐 이 문자열만 고치면 된다.
 *
 * 사용법:
 *   import { installVoiceMocks, fireStt, fireSttAlts, ttsLog } from './fixtures/stt';
 *   test.beforeEach(async ({ page }) => { await installVoiceMocks(page); });
 *   ...
 *   await fireStt(page, '삼십오 점 일');
 *   await fireSttAlts(page, '네', ['16'], 400);
 *   expect(await ttsLog(page)).toContain('횡경');
 */

import type { Page } from '@playwright/test';

/** 브라우저 주입 스크립트 (correction-flow.spec.ts 계보의 정본):
 *  - speechSynthesis 목: speak 즉시 onstart/onend 발화 + window.__ttsLog에 문구 적재.
 *  - 애니메이션/트랜지션 0ms 스타일(타이밍 flake 제거).
 *  - SpeechRecognition/webkitSpeechRecognition → MockSTT. 인스턴스는 window.__mockSTT로 노출되고
 *    fireResult(단일)·fireResultWithAlts(대안 포함, [STT-15] 재현)를 제공한다. */
export const VOICE_MOCK_INIT_SCRIPT = `
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
  // v0.33.0 [STT-15] 재현용 — 대안(alternatives) 포함 final 결과 주입.
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

/** 페이지에 STT/TTS 목 주입 — page.goto 전에 호출한다. */
export async function installVoiceMocks(page: Page): Promise<void> {
  await page.addInitScript({ content: VOICE_MOCK_INIT_SCRIPT });
}

/** final 인식 결과 1건 주입 후 처리 대기. */
export async function fireStt(page: Page, transcript: string, waitMs = 300, confidence = 0.95): Promise<void> {
  await page.evaluate(
    ({ t, c }) => {
      (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } }).__mockSTT?.fireResult(t, c);
    },
    { t: transcript, c: confidence },
  );
  await page.waitForTimeout(waitMs);
}

/** 대안(alternatives) 포함 final 결과 주입 — [STT-15] 계열 재현용. */
export async function fireSttAlts(page: Page, transcript: string, alts: string[], waitMs = 400, confidence = 0.95): Promise<void> {
  await page.evaluate(
    ({ t, a, c }) => {
      (window as unknown as { __mockSTT?: { fireResultWithAlts: (t: string, c: number, a: string[]) => void } })
        .__mockSTT?.fireResultWithAlts(t, c, a);
    },
    { t: transcript, a: alts, c: confidence },
  );
  await page.waitForTimeout(waitMs);
}

/** 지금까지 mockSynth가 발화한 TTS 문구 목록. */
export async function ttsLog(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __ttsLog?: string[] }).__ttsLog ?? []);
}
