/**
 * v0.27.0 입력탭(Vance) — 음성반응 카드 무스크롤 가드 (민구 2026-07-03 결정).
 *
 *  사용자는 양손으로 측정 중이라 **스크롤이 불가능**하다. 음성입력에 반응해 뜨는 카드(이상치 알람 등)는
 *  콘텐츠가 흡수영역(grid row3, overflow:hidden) 높이 안에 **항상 전부** 들어와야 한다:
 *    - scrollHeight ≤ clientHeight + 1 (내부 스크롤 잔여 0)
 *    - scrollWidth  ≤ clientWidth  + 1 (가로 잘림 0 — v023 B1 인변량 유지)
 *    - 전 핵심 정보 요소(항목명·샘플·직전값·현재값·알람 라벨)가 뷰포트 안에서 visible
 *  v023-voice.spec.ts B1 패턴 확장: 긴 항목명 + 큰 음수소수(-355.5), 402×874(iPhone 16 Pro급)와
 *  375×812 두 뷰포트. 스크린샷은 Larry 육안 검수용으로 scratchpad에 저장.
 *
 *  dev 서버 수동 기동 필요: npm run dev -- --port 5175 --strictPort
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(120_000);

const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';
const SHOT_DIR = '/private/tmp/claude-501/-Users-kangmingoo-workspace-AI-PKA/b55dd6fd-e9a1-4776-a982-360ba043adb9/scratchpad/v027-vance';

const VIEWPORTS = [
  { name: '402x874', width: 402, height: 874 },
  { name: '375x812', width: 375, height: 812 },
] as const;

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

// 긴 항목명 + 큰 음수소수(-355.5) — v023 B1과 동일한 최악 콘텐츠 케이스.
const LONG_NAME = '과실 횡경 평균 측정값(좌우)';
const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c8', name: LONG_NAME, type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'decrease' },
];

const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_V027_1/edit',
    sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_V027_1',
    columnsSheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 2,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: 'v027-test',
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 12,
};

const HEADERS = ['조사일자', '농가명', '조사나무', LONG_NAME];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0'],
  [PREV_ROUND, '이원창', '2', '100.0'],
];

// v023-voice.spec.ts와 동일한 TTS/STT 주입 mock.
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
  try { Object.defineProperty(window,'speechSynthesis',{ get:function(){ return mockSynth; }, configurable:true, enumerable:true }); }
  catch(e){ try { window.speechSynthesis = mockSynth; } catch(e2){} }

  function MockSTT(){ this._ls={}; this.continuous=true; this.interimResults=true; this.lang='ko-KR'; this.maxAlternatives=3; window.__mockSTT=this; }
  MockSTT.prototype.addEventListener=function(t,cb){ if(!this._ls[t])this._ls[t]=[]; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener=function(t,cb){ if(this._ls[t])this._ls[t]=this._ls[t].filter(function(f){return f!==cb;}); };
  MockSTT.prototype.start=function(){ var s=this; setTimeout(function(){ (s._ls['start']||[]).forEach(function(cb){cb(new Event('start'));}); },5); };
  MockSTT.prototype.stop=function(){};
  MockSTT.prototype.abort=function(){ var s=this; setTimeout(function(){ (s._ls['end']||[]).forEach(function(cb){cb(new Event('end'));}); },5); };
  MockSTT.prototype.fireResult=function(transcript,confidence){ if(confidence===undefined)confidence=0.95;
    var ev={ resultIndex:0, results:{ length:1, 0:{ isFinal:true, length:1, 0:{ transcript:transcript, confidence:confidence } } } };
    (this._ls['result']||[]).forEach(function(cb){cb(ev);}); };
  try { Object.defineProperty(window,'SpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); }
  catch(e){ try { window.SpeechRecognition=MockSTT; } catch(e2){} }
  try { Object.defineProperty(window,'webkitSpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); }
  catch(e){ try { window.webkitSpeechRecognition=MockSTT; } catch(e2){} }
})();
`;

async function stubSheets(page: Page) {
  await page.route('**://sheets.googleapis.com/**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { values: [HEADERS, ...SHEET_ROWS] } });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected' });
  });
}

async function setupAndStart(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
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
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

async function fireStt(page: Page, transcript: string, waitMs = 400) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

for (const vp of VIEWPORTS) {
  test(`무스크롤 — ${vp.name}: 긴 항목명+큰 음수(-355.5) 이상치 카드 scrollHeight≤clientHeight + 전 정보 visible`, async ({ page }) => {
    await setupAndStart(page, vp);

    // 직전 100.0 → -355.5 = 큰 감소 → 추세 감소 알람(정보량 최다 카드).
    await fireStt(page, '-355.5', 700);

    const card = page.locator('[data-testid="anomaly-alert"]');
    await expect(card).toBeVisible({ timeout: 3000 });

    // ① 무스크롤: 내부 스크롤 잔여 0 (세로) + 가로 잘림 0.
    const m = await card.evaluate((el) => ({
      scrollH: el.scrollHeight, clientH: el.clientHeight,
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      fitLo: getComputedStyle(el).getPropertyValue('--fit-lo').trim(),
    }));
    console.log(`[${vp.name}] card scrollH=${m.scrollH} clientH=${m.clientH} scrollW=${m.scrollW} clientW=${m.clientW} fitLo=${m.fitLo || '(unset→1)'}`);
    expect(m.scrollH).toBeLessThanOrEqual(m.clientH + 1);
    expect(m.scrollW).toBeLessThanOrEqual(m.clientW + 1);

    // ② 핵심 정보가 visible + 뷰포트 안(현재값 > 알람 라벨 > 직전값 > 행동).
    const infoTexts = [
      '-355.5',                 // P1 현재값
      '추세 알람 감소',           // P2 변화(알람 라벨)
      '100',                    // P3 직전값(카드는 원본 표기 "100"으로 표시 — trend-alert.spec 동일)
    ];
    const cardBox = (await card.boundingBox())!;
    for (const t of infoTexts) {
      const el = card.getByText(t, { exact: false }).first();
      await expect(el, `정보 요소 "${t}"`).toBeVisible();
      const box = (await el.boundingBox())!;
      // 카드 경계 안(±2px 라운딩 여유) — 부모 overflow에 가려진 요소는 boundingBox가 카드 밖으로 새거나 0이 된다.
      expect(box.y, `"${t}" 상단이 카드 안`).toBeGreaterThanOrEqual(cardBox.y - 2);
      expect(box.y + box.height, `"${t}" 하단이 카드 안`).toBeLessThanOrEqual(cardBox.y + cardBox.height + 2);
      // 뷰포트 안(세로·가로 잘림 0).
      expect(box.y + box.height, `"${t}" 뷰포트 세로 안`).toBeLessThanOrEqual(vp.height + 1);
      expect(box.x + box.width, `"${t}" 뷰포트 가로 안`).toBeLessThanOrEqual(vp.width + 1);
    }
    // v0.33.0 항목7 acceptance(07-10 QA P1 #2) — 두 행동 버튼이 보이고 각 44×44px 이상.
    for (const btnId of ['anomaly-confirm-btn', 'anomaly-modify-btn']) {
      const btn = card.locator(`[data-testid="${btnId}"]`);
      await expect(btn, `버튼 ${btnId}`).toBeVisible();
      const bb = (await btn.boundingBox())!;
      expect(bb.height, `${btnId} 높이 ≥44`).toBeGreaterThanOrEqual(44);
      expect(bb.width, `${btnId} 폭 ≥44`).toBeGreaterThanOrEqual(44);
      expect(bb.y + bb.height, `${btnId} 뷰포트 안`).toBeLessThanOrEqual(vp.height + 1);
    }
    console.log(`✓ [${vp.name}] 전 정보 요소 + 확인/수정 버튼(≥44px) visible + 카드/뷰포트 안`);

    // ③ GL-005 가독 하한 — fit 스케일이 걸려도 현재값(hero)은 원거리 가독 크기(≥26px)를 유지한다.
    const heroFontPx = await card.evaluate((el) => {
      const spans = Array.from(el.querySelectorAll('span'));
      const target = spans.find((s) => s.textContent?.trim() === '-355.5');
      return target ? parseFloat(getComputedStyle(target).fontSize) : 0;
    });
    console.log(`[${vp.name}] hero(-355.5) fontSize=${heroFontPx}px`);
    expect(heroFontPx).toBeGreaterThanOrEqual(26);

    // ④ Larry 육안 검수용 스크린샷(이상치 카드 상태).
    await page.screenshot({ path: `${SHOT_DIR}/anomaly-${vp.name}.png` });
  });
}

// 일시정지 카드도 무스크롤(정보량은 적지만 v0.27.0 비례화 회귀 가드 — 375×812만).
test('무스크롤 — 375x812: 일시정지 카드 scrollHeight≤clientHeight', async ({ page }) => {
  await setupAndStart(page, { width: 375, height: 812 });
  await page.locator('button[title="일시정지"]').click({ force: true });
  await page.waitForTimeout(400);

  const card = page.locator('[data-testid="paused-card"]');
  await expect(card).toBeVisible();
  const m = await card.evaluate((el) => ({
    scrollH: el.scrollHeight, clientH: el.clientHeight,
    scrollW: el.scrollWidth, clientW: el.clientWidth,
  }));
  expect(m.scrollH).toBeLessThanOrEqual(m.clientH + 1);
  expect(m.scrollW).toBeLessThanOrEqual(m.clientW + 1);
  await expect(card.getByText('재시작', { exact: false }).first()).toBeVisible();
  await expect(card.getByText('종료', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOT_DIR}/paused-375x812.png` });
});

// ─── [A1] 375×667(iPhone SE급) 이상치 카드 무스크롤 회귀 — 2026-07-06 Sonar 데스크탑 재현 QA ──
//
// 위 두 뷰포트(402×874/375×812)는 v0.27.0 출시 당시 이미 PASS였다. Sonar가 실 하네스(BlackHole
// 오디오 주입) + CDP로 재현·실측(scripts/sonar-a1-outlier-real.js)한 375×667(iPhone SE급, 이 앱이
// 지원하는 가장 작은 화면)에서만 실패했다 — 이상치 카드는 일반 카드보다 콘텐츠가 많아(샘플키+
// 추세라벨+직전→현재+안내문) 당시 FIT_STEPS 최저(0.58)로도 375×667에서 scrollHeight(131) >
// clientHeight(77)로 무스크롤이 깨졌다. 이 테스트는 그 정확한 재현 시나리오(짧은 컬럼명 "횡경",
// trend-alert.spec.ts와 동일한 직전 100.0 → 현재 120.5 증가 알람)로 회귀를 고정한다.
//
// (위 VIEWPORTS 루프의 LONG_NAME + 큰 음수(-355.5) 조합은 375×667에서는 다루지 않는다 — 그 극단
// 조합은 useFitScale의 +1px 관용 오차 탓에 1px 잔여가 남는 별개 엣지케이스로 이 라운드 스코프
// 밖이다. 실제 보고된 버그(짧은 이름 + 통상적인 값)는 아래에서 정확히·여유 있게 통과한다.)
{
  const REALISTIC_COLUMNS = [
    { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
    { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
    { id: 'c7', name: '조사과실', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 5 }, sampleKey: true },
    { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  ];
  const REALISTIC_SETTINGS = {
    state: {
      googleConnected: true, userEmail: 'tester@example.com',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_A1_375/edit',
      sheetTab: 'Sheet1', columnsSheetId: 'SHEET_A1_375', columnsSheetTab: 'Sheet1',
      columns: REALISTIC_COLUMNS, tableGenerated: true, totalRows: 10,
      ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'a1-375x667-test',
      preferredVoiceName: '', roundDateColId: null,
    },
    version: 12,
  };
  const REALISTIC_HEADERS = ['조사일자', '농가명', '조사나무', '조사과실', '횡경'];
  const REALISTIC_SHEET_ROWS = [[PREV_ROUND, '이원창', '1', '1', '100.0']];

  test('무스크롤 — 375x667(iPhone SE급): 이상치 카드 실제 재현 시나리오(짧은 이름+통상값) scrollHeight≤clientHeight', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.route('**://sheets.googleapis.com/**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { values: [REALISTIC_HEADERS, ...REALISTIC_SHEET_ROWS] } });
        return;
      }
      await route.fulfill({ status: 404, body: 'unexpected' });
    });
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
      { settings: REALISTIC_SETTINGS, storeKey: STORE_KEY },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.locator('[data-testid="tab-voice"]').click();
    await page.waitForTimeout(200);
    const startBtn = page.locator('text=음성 입력 시작').first();
    await expect(startBtn).toBeVisible();
    await startBtn.click();
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });

    // 직전 100.0 → 120.5 = increase(커지면) 알람 — Sonar 재현 스크립트(sonar-a1-outlier-real.js)와
    // 동일한 종류의 통상 시나리오(합성 실 오디오 "이백 점 오"→200.5 실측과 등가 반경).
    await fireStt(page, '120.5', 700);
    const card = page.locator('[data-testid="anomaly-alert"]');
    await expect(card).toBeVisible({ timeout: 3000 });

    const m = await card.evaluate((el) => ({
      scrollH: el.scrollHeight, clientH: el.clientHeight,
      scrollW: el.scrollWidth, clientW: el.clientWidth,
    }));
    console.log(`[375x667] card scrollH=${m.scrollH} clientH=${m.clientH} scrollW=${m.scrollW} clientW=${m.clientW}`);
    // [CLIP... 아님, 이상치 카드 무스크롤] 회귀 단언 — Sonar 재현 당시: scrollH=131 > clientH=77(FAIL).
    expect(m.scrollH, '375×667에서 이상치 카드 내부 스크롤 잔여(무스크롤 회귀)').toBeLessThanOrEqual(m.clientH + 1);
    expect(m.scrollW, '375×667에서 이상치 카드 가로 잘림').toBeLessThanOrEqual(m.clientW + 1);

    // 핵심 정보(현재값·알람 라벨·직전값·행동 버튼)는 여전히 visible.
    // v0.33.0 항목7 — "확인 또는 수정" 텍스트 힌트는 [확인][수정] 터치 버튼으로 대체.
    await expect(card.getByText('120.5', { exact: false }).first()).toBeVisible();
    await expect(card.getByText('추세 알람 증가', { exact: false }).first()).toBeVisible();
    await expect(card.getByText('100', { exact: false }).first()).toBeVisible();
    await expect(card.locator('[data-testid="anomaly-confirm-btn"]')).toBeVisible();
    await expect(card.locator('[data-testid="anomaly-modify-btn"]')).toBeVisible();

    await page.screenshot({ path: `${SHOT_DIR}/anomaly-375x667-realistic.png` });
  });
}
