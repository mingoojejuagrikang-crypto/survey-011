/**
 * v0.27.0 입력탭(Vance) — 음성반응 카드 무스크롤 가드 (민구 2026-07-03 결정).
 *
 *  사용자는 양손으로 측정 중이라 **스크롤이 불가능**하다. 음성입력에 반응해 뜨는 카드(이상치 알람 등)는
 *  콘텐츠가 흡수영역(grid row3, overflow:hidden) 높이 안에 **항상 전부** 들어와야 한다:
 *    - scrollHeight ≤ clientHeight + 1 (내부 스크롤 잔여 0)
 *    - scrollWidth  ≤ clientWidth  + 1 (가로 잘림 0 — v023 B1 인변량 유지)
 *    - 전 정보 요소(항목명·샘플·직전값·현재값·알람 라벨·안내문)가 뷰포트 안에서 visible
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
  version: 11,
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
  await expect(page.locator('text=REC').first()).toBeVisible({ timeout: 3000 });
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

    // ② 전 정보 요소가 visible + 뷰포트 안(정보 우선순위 전 계층: 현재값 > 알람 라벨 > 직전값 >
    //    식별정보(샘플·항목명) > 안내문). ellipsis 잘림 금지 — 요소 박스가 카드/뷰포트 안에 있어야 한다.
    const infoTexts = [
      '-355.5',                 // P1 현재값
      '추세 알람 감소',           // P2 변화(알람 라벨)
      '100',                    // P3 직전값(카드는 원본 표기 "100"으로 표시 — trend-alert.spec 동일)
      '샘플:',                   // P4 식별(샘플)
      LONG_NAME,                // P4 식별(항목명 — 헤더/hero 라벨 2곳)
      "'확인' 또는 새 값으로 정정", // P5 안내문
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
    console.log(`✓ [${vp.name}] 전 정보 요소 visible + 카드/뷰포트 안`);

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
