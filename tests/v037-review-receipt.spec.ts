/**
 * v0.37.0 리뷰#1(Codex High, 민구: 커밋 영수증) — 검토(complete) 화면 '방금 입력한 값' 회귀.
 *
 * 결함(r2 잔여): 검토 표시값을 valueBurst에서 파생했는데 valueBurst는 **음성 커밋에서만** 발행됐다.
 *   따라서 한 행의 마지막 셀을
 *     (a) **수동 입력**으로 채우면  → 앞선 음성 셀의 stale 값을,
 *     (b) **이상치 정정**으로 채우면 → 정정 전 다른 셀의 값을,
 *   "방금 입력한 값"으로 오표시했다.
 * 수정: 모든 커밋 경로(음성·수동·이상치 정정)가 store commitReceipt를 발행하고, 검토 파생은 이 영수증을
 *   소비한다. 아래 오라클은 "마지막 셀을 어떤 경로로 채웠든 검토는 그 셀의 실제 커밋값을 보인다"이다.
 *   (d) '이전'으로 완료행을 재방문(새 영수증 없음)하면 여전히 중립 "N행 완료"로 폴백한다(값 오표시 금지).
 *
 * dev 서버 수동 기동 필요: npm run dev -- --port 5175 --strictPort
 * Mock/fixture 패턴은 manual-input.spec.ts와 동일(_aborted 가드 + __ttsLog).
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(120_000);

const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';

const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];
  var mockSynth = {
    speak: function(u) { window.__ttsLog.push(u.text);
      try { if (u.onstart) u.onstart(new Event('start')); } catch(e){}
      try { if (u.onend) u.onend(new Event('end')); } catch(e){} },
    cancel: function(){}, pause: function(){}, resume: function(){},
    getVoices: function(){ return [{ name:'Mock Korean', lang:'ko-KR', default:true, localService:true, voiceURI:'mock' }]; },
    speaking:false, pending:false, paused:false, onvoiceschanged:null,
    addEventListener:function(){}, removeEventListener:function(){}, dispatchEvent:function(){ return true; },
  };
  try { Object.defineProperty(window,'speechSynthesis',{ get:function(){ return mockSynth; }, configurable:true, enumerable:true }); } catch(e){}
  var _addStyle = function() {
    var s = document.createElement('style');
    s.textContent = '* { animation-duration: 0ms !important; transition-duration: 0ms !important; }';
    (document.head || document.documentElement).appendChild(s);
  };
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _addStyle); } else { _addStyle(); }
  function MockSTT(){ this._ls={}; this.continuous=true; this.interimResults=true; this.lang='ko-KR'; this.maxAlternatives=3; window.__mockSTT=this; this._aborted=false; }
  MockSTT.prototype.addEventListener=function(t,cb){ if(!this._ls[t])this._ls[t]=[]; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener=function(t,cb){ if(this._ls[t])this._ls[t]=this._ls[t].filter(function(f){return f!==cb;}); };
  MockSTT.prototype.start=function(){ this._aborted=false; var s=this; setTimeout(function(){ (s._ls['start']||[]).forEach(function(cb){cb(new Event('start'));}); },5); };
  MockSTT.prototype.stop=function(){};
  MockSTT.prototype.abort=function(){ this._aborted=true; var s=this; setTimeout(function(){ (s._ls['end']||[]).forEach(function(cb){cb(new Event('end'));}); },5); };
  MockSTT.prototype.fireResult=function(transcript,confidence){ if(this._aborted)return; if(confidence===undefined)confidence=0.95;
    var ev={ resultIndex:0, results:{ length:1, 0:{ isFinal:true, length:1, 0:{ transcript:transcript, confidence:confidence } } } };
    (this._ls['result']||[]).forEach(function(cb){cb(ev);}); };
  try { Object.defineProperty(window,'SpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); } catch(e){}
  try { Object.defineProperty(window,'webkitSpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); } catch(e){}
})();
`;

function localISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function fireStt(page: Page, transcript: string, waitMs = 400) {
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

async function openSheetFor(page: Page, colName: string) {
  await page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`).click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 3000 });
}

async function typeKeys(page: Page, keys: string[]) {
  for (const k of keys) await page.locator(`[data-testid="manual-key-${k}"]`).click();
}

async function bootAndStart(page: Page, settings: unknown, route?: { prevRow: string[] }) {
  if (route) {
    await page.route('**://sheets.googleapis.com/**', async (r) => {
      if (r.request().method() === 'GET') {
        await r.fulfill({ json: { values: [
          ['조사일자', '농가명', '조사나무', '횡경', '종경'],
          route.prevRow,
        ] } });
        return;
      }
      await r.fulfill({ status: 404, body: 'unexpected' });
    });
  }
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey, withToken }) => {
      localStorage.clear();
      if (withToken) {
        localStorage.setItem('gs10_google_token', JSON.stringify({
          access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
        }));
      }
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('survey-011');
    },
    { s: settings, storeKey: STORE_KEY, withToken: !!route },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

// 1행 × 2 음성열(횡경·종경). 완료 시 다음 미완료 행이 없어 검토가 **머문다**(안정 단언).
function oneRowSettings(extra?: Record<string, unknown>) {
  return {
    state: {
      googleConnected: false, userEmail: null, sheet: null, sheetUrl: '', sheetTab: '',
      availableSheets: [], manualMode: false,
      columns: [
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 } },
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
        { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, ...(extra ?? {}) },
      ],
      tableGenerated: true, totalRows: 1,
      ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'review-receipt', noisyMode: false, preferredVoiceName: '',
    },
    version: 3,
  };
}

// ─── (a) 마지막 셀 = 수동 입력 ────────────────────────────────────────────────
test('(a) 앞 셀 음성 + 마지막 셀 수동 입력 → 검토는 수동값(4.2)을 보인다(앞 음성 셀 30.7 오표시 금지)', async ({ page }) => {
  await bootAndStart(page, oneRowSettings());
  await waitForActiveChip(page, '횡경');

  // 앞 셀(횡경)을 음성 커밋 → valueBurst=30.7(종전 파생 소스). advance로 종경 대기.
  await fireStt(page, '30.7');
  await waitForActiveChip(page, '종경');

  // 마지막 셀(종경)을 **수동 키패드**로 커밋 → 행 완료 → 검토 머묾.
  await openSheetFor(page, '종경');
  await typeKeys(page, ['4', '.', '2']);
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);

  await expect(page.locator('[data-hero-state="review"]')).toBeVisible({ timeout: 4000 });
  // 핵심: 검토는 방금 수동 입력한 종경(4.2)을 보인다 — 종전 valueBurst 파생은 앞 음성 셀 30.7을 오표시했다.
  await expect(page.locator('[data-testid="hero-primary"]')).toHaveText('4.2');
  await expect(page.getByRole('status', { name: '1행 완료, 명령 대기' })).toBeVisible();
});

// ─── (b) 마지막 셀 = 이상치 정정(수동 보류 [확인]) ─────────────────────────────
test('(b) 마지막 셀 이상치 정정 [확인] → 검토는 확정된 정정값(77.7)을 보인다(앞 셀 30.7·직전값 50 오표시 금지)', async ({ page }) => {
  const PREV = localISO(new Date(Date.now() - 86_400_000));
  const settings = {
    state: {
      googleConnected: true, userEmail: 'tester@example.com',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_REVIEW_RECEIPT/edit', sheetTab: 'Sheet1',
      columns: [
        { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
        { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
        { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
      ],
      tableGenerated: true, totalRows: 1, ttsRate: 1.05, sessionLabelColId: null,
      sessionAutoLabel: 'review-receipt-anomaly', preferredVoiceName: '', roundDateColId: null,
    },
    version: 6,
  };
  await bootAndStart(page, settings, { prevRow: [PREV, '이원창', '1', '10.0', '50.0'] });
  await waitForActiveChip(page, '횡경');

  // 앞 셀(횡경) 음성 커밋 → valueBurst=30.7. advance로 종경(이상치 규칙 열) 대기.
  await fireStt(page, '30.7');
  await waitForActiveChip(page, '종경');

  // 마지막 셀(종경)을 수동 77.7 커밋(직전 50.0 → increase 알람) → manualHold 보류 팝업.
  await openSheetFor(page, '종경');
  await typeKeys(page, ['7', '7', '.', '7']);
  await page.locator('[data-testid="manual-commit"]').click();
  const popup = page.locator('[data-testid="anomaly-alert"]');
  await expect(popup).toBeVisible({ timeout: 3000 });
  await expect(popup.locator('[data-testid="anomaly-confirm-btn"]')).toBeVisible();

  // [확인] → confirmManualAnomaly가 77.7을 확정 + 진행 재개 → 행 완료 → 검토 머묾.
  await page.waitForTimeout(400); // durable put 정착(즉시 [확인] not_durable 차단 회피)
  await popup.locator('[data-testid="anomaly-confirm-btn"]').click();
  await expect(popup).toHaveCount(0, { timeout: 4000 });

  await expect(page.locator('[data-hero-state="review"]')).toBeVisible({ timeout: 4000 });
  // 핵심: 검토는 정정 [확인]으로 확정된 종경(77.7)을 보인다 — 앞 음성 셀 30.7도, 비교 직전값 50.0도 아니다.
  const primary = page.locator('[data-testid="hero-primary"]');
  await expect(primary).toHaveText('77.7');
  await expect(primary).not.toHaveText('30.7');
  await expect(primary).not.toHaveText('50');
});

// ─── (d) '이전'으로 완료행 재방문 → 중립 "N행 완료" 폴백(새 영수증 없음) ─────────
test('(d) 완료행을 "이전"으로 재방문(새 커밋 없음) → 검토는 값이 아니라 중립 "1행 완료"로 폴백', async ({ page }) => {
  const settings = {
    state: {
      googleConnected: false, userEmail: null, sheet: null, sheetUrl: '', sheetTab: '',
      availableSheets: [], manualMode: false,
      columns: [
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
      ],
      tableGenerated: true, totalRows: 2,
      ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'review-receipt-prev', noisyMode: false, preferredVoiceName: '',
    },
    version: 3,
  };
  await bootAndStart(page, settings);
  await waitForActiveChip(page, '횡경');

  // 행1 완료(음성) → 행2로 전진(활성). 커밋 시점 검토는 값을 보였으나 행 이동으로 fresh 창이 닫힌다.
  await fireStt(page, '11.1');
  await page.waitForFunction(() => {
    const m = document.body.innerText.match(/(\d+)\s*\/\s*\d+\s*행/);
    return m && parseInt(m[1]) === 2;
  }, undefined, { timeout: 6000 });

  // '이전' → 완료행(1) 재방문 = enterReviewWait(새 영수증 없음). 검토는 stale 값 대신 중립 라벨.
  await fireStt(page, '이전', 600);
  await expect(page.locator('[data-hero-state="review"]')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('[data-testid="hero-primary"]')).toHaveText('1행 완료');
  await expect(page.getByRole('status', { name: '1행 완료, 명령 대기' })).toBeVisible();
});

// ─── (e) 검토 중 터치 컬럼 인라인 편집 → 검토는 터치값을 보인다(Codex Medium #2, 터치 영수증) ─────
// 행 완료(voice)는 phase 'complete'로 검토를 띄운다. 그 상태에서 **터치 컬럼**을 인라인 편집하면
//   commitTouchValue가 커밋 영수증을 발행해 검토가 방금 입력한 터치값으로 갱신돼야 한다. 종전엔
//   터치 커밋이 영수증을 안 남겨 검토가 앞선 음성값(30.7)을 그대로 오표시했다.
test('(e) 검토 중 터치 컬럼 인라인 편집 → 검토는 터치값(88)을 보인다(앞 음성값 30.7 오표시 금지)', async ({ page }) => {
  const settings = {
    state: {
      googleConnected: false, userEmail: null, sheet: null, sheetUrl: '', sheetTab: '',
      availableSheets: [], manualMode: false,
      columns: [
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 } },
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
        { id: 'cT', name: '수량', type: 'int', input: 'touch', ttsAnnounce: false, auto: { kind: 'fixed', value: '' }, sampleKey: false },
      ],
      tableGenerated: true, totalRows: 1,
      ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'review-receipt-touch', noisyMode: false, preferredVoiceName: '',
    },
    version: 3,
  };
  await bootAndStart(page, settings);
  await waitForActiveChip(page, '횡경');

  // 유일 음성 컬럼(횡경) 커밋 → 행 완료(터치 컬럼은 완료 판정에 무관) → 검토 머묾, 값=30.7.
  await fireStt(page, '30.7');
  await expect(page.locator('[data-hero-state="review"]')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('[data-testid="hero-primary"]')).toHaveText('30.7');

  // 검토 중(phase complete) 터치 칩을 인라인 편집: 칩 탭 → input → 88 → Enter(커밋).
  const touchChip = page.locator('[data-testid="column-chip"][data-col-name="수량"]');
  await touchChip.click();
  const input = touchChip.locator('input');
  await expect(input).toBeVisible({ timeout: 2000 });
  await input.fill('88');
  await input.press('Enter');

  // 핵심: 검토가 방금 커밋된 터치값(88)으로 갱신된다 — 종전엔 앞 음성값 30.7이 그대로 남았다.
  await expect(page.locator('[data-testid="hero-primary"]')).toHaveText('88', { timeout: 4000 });
  await expect(page.locator('[data-testid="column-chip"][data-col-name="수량"]')).toContainText('88');
});
