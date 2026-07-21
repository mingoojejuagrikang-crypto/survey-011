/**
 * v0.37.0 FB-B(민구, Vance) — 컬럼 칩 그리드 2줄 캡 + 활성 칩 자동 스크롤 회귀.
 *
 * 민구 확정: 전체 컬럼 칩 그리드는 기본(입력) 화면에 유지하되(트레이로 옮기지 않음, §8 거부),
 *   세로 캡을 3줄→2줄로 줄여 hero가 자라날 공간을 넓힌다. 2줄을 넘는 칩은 그리드 내부 스크롤로
 *   접근하고, 활성 칩은 항목 전환 시 자동으로 가시영역에 스크롤된다("지금 어디" 상실 방지).
 *
 * 오라클(형태가 아니라 계약):
 *   1) 칩이 2줄을 넘치면 그리드 clientHeight는 2줄 캡(≈108px) 이하로 고정되고 scrollHeight가
 *      그를 초과한다(= 내부 스크롤이 실제로 생긴다). 전체 그리드가 화면을 잠식하지 않는다.
 *   2) 뒤쪽 음성 컬럼으로 진행하면 활성 칩이 그리드의 가시 스크롤 창 안으로 들어온다(자동 스크롤).
 *
 * dev 서버 수동 기동 필요: npm run dev -- --port 5175 --strictPort
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(90_000);

const BASE = 'http://localhost:5175';
const PHONE_402 = { width: 402, height: 874 };

// 1 auto(seq) + 12 voice float — 402px 폭에서 확실히 2줄을 넘긴다.
const VOICE_COLS = Array.from({ length: 12 }, (_, i) => ({
  id: `v${i}`,
  name: `측정항목${String(i + 1).padStart(2, '0')}`,
  type: 'float',
  input: 'voice',
  ttsAnnounce: true,
  auto: { kind: 'fixed', value: '' },
  decimals: 1,
}));

const SETTINGS = {
  state: {
    googleConnected: false, userEmail: null, sheet: null, sheetUrl: '', sheetTab: '',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
      ...VOICE_COLS,
    ],
    tableGenerated: true, totalRows: 2,
    ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: '칩2줄', noisyMode: false, preferredVoiceName: '',
  },
  version: 3,
};

const MOCK_INIT_SCRIPT = `
(function() {
  var mockSynth = {
    speak: function(u) { try { if (u.onstart) u.onstart(new Event('start')); } catch(e){}
      try { if (u.onend) u.onend(new Event('end')); } catch(e){} },
    cancel: function(){}, pause: function(){}, resume: function(){},
    getVoices: function(){ return [{ name:'Mock Korean', lang:'ko-KR', default:true, localService:true, voiceURI:'mock' }]; },
    speaking:false, pending:false, paused:false, onvoiceschanged:null,
    addEventListener:function(){}, removeEventListener:function(){}, dispatchEvent:function(){ return true; },
  };
  try { Object.defineProperty(window,'speechSynthesis',{ get:function(){ return mockSynth; }, configurable:true, enumerable:true }); } catch(e){}
  function MockSTT(){ this._ls={}; this.continuous=true; this.interimResults=true; this.lang='ko-KR'; this.maxAlternatives=3; window.__mockSTT=this; }
  MockSTT.prototype.addEventListener=function(t,cb){ if(!this._ls[t])this._ls[t]=[]; this._ls[t].push(cb); };
  MockSTT.prototype.removeEventListener=function(t,cb){ if(this._ls[t])this._ls[t]=this._ls[t].filter(function(f){return f!==cb;}); };
  MockSTT.prototype.start=function(){ var s=this; setTimeout(function(){ (s._ls['start']||[]).forEach(function(cb){cb(new Event('start'));}); },5); };
  MockSTT.prototype.stop=function(){};
  MockSTT.prototype.abort=function(){ var s=this; setTimeout(function(){ (s._ls['end']||[]).forEach(function(cb){cb(new Event('end'));}); },5); };
  MockSTT.prototype.fireResult=function(transcript,confidence){ if(confidence===undefined)confidence=0.95;
    var ev={ resultIndex:0, results:{ length:1, 0:{ isFinal:true, length:1, 0:{ transcript:transcript, confidence:confidence } } } };
    (this._ls['result']||[]).forEach(function(cb){cb(ev);}); };
  try { Object.defineProperty(window,'SpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); } catch(e){}
  try { Object.defineProperty(window,'webkitSpeechRecognition',{ value:MockSTT, writable:true, configurable:true, enumerable:true }); } catch(e){}
})();
`;

async function boot(page: Page) {
  await page.setViewportSize(PHONE_402);
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('survey-011-settings-v3', JSON.stringify(s));
  }, SETTINGS);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

async function fireStt(page: Page, transcript: string) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
}

test('FB-B — 칩 그리드가 2줄 캡 + 초과분 내부 스크롤(전체 그리드가 화면 잠식 안 함)', async ({ page }) => {
  await boot(page);
  const grid = page.locator('[data-testid="voice-chip-grid"]');
  await expect(grid).toBeVisible();

  const { clientH, scrollH } = await grid.evaluate((el) => ({
    clientH: (el as HTMLElement).clientHeight,
    scrollH: (el as HTMLElement).scrollHeight,
  }));
  console.log(`chip grid clientH=${clientH} scrollH=${scrollH}`);

  // 2줄 캡: 44*2 + 8 + 12(vpad) ≈ 108. 소폭 슬랙 허용.
  expect(clientH, '칩 그리드 2줄 캡').toBeLessThanOrEqual(120);
  // 13개 칩(1 auto + 12 voice)은 402px에서 2줄을 넘겨 내부 스크롤이 생긴다.
  expect(scrollH, '2줄 초과 → 내부 스크롤 존재').toBeGreaterThan(clientH + 20);
});

test('FB-I — full-bleed 글로우 아래에서도 하단 나비 탭 가능 + 수동 입력 시트가 글로우 위에 뜬다', async ({ page }) => {
  await boot(page);
  const glow = page.locator('[data-testid="edge-glow"]');
  await expect(glow).toBeVisible();
  const glowZ = await glow.evaluate((el) => parseInt(getComputedStyle(el).zIndex || '0', 10));

  // 나비 '유지': full-bleed 글로우(fixed z-54, pointer-events:none)가 하단 나비 위를 덮어도
  //   나비 버튼은 실제로 히트테스트(탭) 가능해야 한다(trial 클릭 = 실제 클릭 없이 가림 여부만 검증).
  await page.locator('[data-testid="tab-voice"]').click({ trial: true });
  await page.locator('[data-testid="tab-data"]').click({ trial: true });

  // 활성 음성 칩 탭 → 수동 입력 시트. 시트 오버레이(ModalBase)는 글로우(54)보다 위에 있어야
  //   초록 가장자리 링/블룸이 입력 UI를 덮지 않는다(FB-I 오염 차단).
  const activeChip = page.locator('[data-testid="column-chip"][data-active="true"]');
  await activeChip.click();
  const sheet = page.locator('[data-testid="manual-value-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 3000 });
  const sheetZ = await sheet.evaluate((el) => parseInt(getComputedStyle(el.parentElement as HTMLElement).zIndex || '0', 10));
  console.log(`z-index: glow=${glowZ} sheet=${sheetZ}`);
  expect(sheetZ, '수동 입력 시트가 full-bleed 글로우 위에 있어야').toBeGreaterThan(glowZ);
  // 시트가 실제로 조작 가능(키패드 키 히트테스트) — 글로우가 위를 막지 않는다.
  await page.locator('[data-testid="manual-key-1"]').click({ trial: true });
});

test('FB-B — 뒤쪽 음성 컬럼으로 진행하면 활성 칩이 가시영역으로 자동 스크롤', async ({ page }) => {
  await boot(page);
  const grid = page.locator('[data-testid="voice-chip-grid"]');
  await expect(grid).toBeVisible();

  // 여러 음성 컬럼을 커밋해 활성 칩을 그리드 아래쪽(스크롤 필요 위치)으로 이동시킨다.
  for (let i = 0; i < 8; i++) {
    await fireStt(page, `${10 + i}.${i}`);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400); // scrollIntoView(smooth) 정착

  const visible = await grid.evaluate((g) => {
    const gridEl = g as HTMLElement;
    const active = gridEl.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    if (!active) return { ok: false, reason: 'no active chip' };
    const gr = gridEl.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    // 활성 칩이 그리드 가시 창(clip 영역) 안에 들어와 있는가(±4px 슬랙).
    const inside = ar.top >= gr.top - 4 && ar.bottom <= gr.bottom + 4;
    return { ok: inside, reason: `grid[${Math.round(gr.top)},${Math.round(gr.bottom)}] chip[${Math.round(ar.top)},${Math.round(ar.bottom)}]`, name: active.dataset.colName };
  });
  console.log(`auto-scroll: ${JSON.stringify(visible)}`);
  expect(visible.ok, `활성 칩이 그리드 가시영역 안에 있어야(자동 스크롤): ${visible.reason}`).toBe(true);
});
