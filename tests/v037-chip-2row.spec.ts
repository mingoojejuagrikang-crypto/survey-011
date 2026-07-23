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
const PHONE_375 = { width: 375, height: 667 };

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
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_1/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TEST_1', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
      ...VOICE_COLS,
    ],
    tableGenerated: true, totalRows: 2,
    ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: '칩2줄', noisyMode: false, preferredVoiceName: '',
  },
  version: 12,
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

async function boot(page: Page, opts?: { viewport?: { width: number; height: number }; sab?: number }) {
  await page.setViewportSize(opts?.viewport ?? PHONE_402);
  await page.addInitScript(MOCK_INIT_SCRIPT);
  // FB-I — 홈인디케이터(--sab) 시뮬레이션: 나비 실측 높이(--nav-h)에 safe-area가 포함되는지,
  //   시트가 그 위에 정확히 올라앉는지 검증하기 위해 fixtures/safeArea.ts와 동일 방식으로 주입.
  if (opts?.sab != null) {
    const sab = opts.sab;
    await page.addInitScript((v) => {
      document.documentElement.style.setProperty('--sab', `${v}px`);
    }, sab);
  }
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

// FB-I(민구, "네비는 항상 보여야 함") — 수동 입력 시트가 **열려 있는 동안** 하단 나비가
//   ① 시트에 덮이지 않고(geometry: 나비 top ≥ 시트 bottom) ② 보이고 ③ 탭 가능해야 한다.
//   402×874(sab 0) + 375×667(sab 34)에서 검증. z-index 단언은 하지 않는다 — bottomInset로 나비/
//   시트가 공간상 안 겹치므로 z 순서는 무의미하고, z만 보면 잘림을 놓친다(geometry가 진짜 오라클).
for (const vp of [
  { name: '402×874(sab 0)', viewport: PHONE_402, sab: undefined },
  { name: '375×667(sab 34)', viewport: PHONE_375, sab: 34 },
]) {
  test(`FB-I — 수동 입력 시트 열림 중 하단 나비 상시 노출·탭 가능(시트가 나비를 덮지 않음) @ ${vp.name}`, async ({ page }) => {
    await boot(page, { viewport: vp.viewport, sab: vp.sab });

    // 시트가 글로우 위에 뜨는 기존 계약도 유지(입력 UI 오염 차단).
    const glow = page.locator('[data-testid="edge-glow"]');
    await expect(glow).toBeVisible();
    const glowZ = await glow.evaluate((el) => parseInt(getComputedStyle(el).zIndex || '0', 10));

    // 활성 음성 칩 탭 → 수동 입력 시트 open.
    await page.locator('[data-testid="column-chip"][data-active="true"]').click();
    const sheet = page.locator('[data-testid="manual-value-sheet"]');
    await expect(sheet).toBeVisible({ timeout: 3000 });
    const sheetZ = await sheet.evaluate((el) => parseInt(getComputedStyle(el.parentElement as HTMLElement).zIndex || '0', 10));
    expect(sheetZ, '시트가 글로우 위').toBeGreaterThan(glowZ);
    // 시트가 실제 조작 가능(글로우가 위를 막지 않음).
    await page.locator('[data-testid="manual-key-1"]').click({ trial: true });

    // ── FB-I 핵심 오라클: 시트가 열린 상태에서 나비가 살아 있다 ──
    const sheetBox = await sheet.boundingBox();
    expect(sheetBox, '시트 boundingBox').not.toBeNull();
    for (const id of ['settings', 'voice', 'data']) {
      const tab = page.locator(`[data-testid="tab-${id}"]`);
      await expect(tab, `tab-${id} 보임`).toBeVisible();
      const tabBox = await tab.boundingBox();
      expect(tabBox, `tab-${id} boundingBox`).not.toBeNull();
      // ① 시트가 나비를 덮지 않는다: 나비 top ≥ 시트 bottom(0.5px 서브픽셀 슬랙).
      expect(tabBox!.y, `tab-${id} top(${tabBox!.y})이 시트 bottom(${sheetBox!.y + sheetBox!.height}) 아래`).
        toBeGreaterThanOrEqual(sheetBox!.y + sheetBox!.height - 0.5);
      // ②③ 시트 열림 중에도 실제 탭 가능(히트테스트 — 시트 오버레이/dim이 가리지 않음).
      await tab.click({ trial: true });
    }
  });
}

// v0.37.0 리뷰#2(Critical, 민구: 탭 탭 = 시트 닫고 재개) — FB-I가 나비를 상시 탭 가능하게 만든 뒤의
//   데이터 무결성 구멍: 수동 입력 시트가 열려(STT hard-suspend) 있는데 탭을 누르면 onClose가 발화하지
//   않아 STT가 **정지된 채** 화면만 전환돼 이후 발화가 유실됐다. 수정: 탭 탭이 시트를 먼저 닫고(→resume)
//   전환한다. 오라클(계약): ① 탭 후 시트가 닫힌다 ② 음성 탭 복귀 후 즉시 STT 결과가 커밋된다(유실 없음).
//   종전 FB-I 테스트의 trial:true 히트테스트(line 159)를 **실제 탭 전환**으로 승격한다.
async function activeChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return chip?.dataset.colName ?? '';
  });
}

test('리뷰#2 — 수동 시트 열림 중 탭 탭 → 시트 닫힘 + STT 재개(복귀 후 즉시 커밋, 발화 유실 없음)', async ({ page }) => {
  await boot(page);
  // 활성 칩(측정항목01)에서 수동 입력 시트 open → STT hard-suspend.
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  const sheet = page.locator('[data-testid="manual-value-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 3000 });
  expect(await activeChipName(page), '커밋 전 활성 칩').toContain('측정항목01');

  // 시트가 열린 채 **실제** 데이터 탭으로 전환(trial 아님).
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
  // ① 시트가 닫혔다(숨겨진 채 남지 않음 — 복귀 시 유령 시트 방지 + resume 배선 발화).
  await expect(sheet).toHaveCount(0, { timeout: 3000 });

  // 음성 탭 복귀.
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });

  // ② STT 재개 증명: 즉시 음성 결과가 커밋돼 활성 칩이 다음 항목으로 전진한다(suspend된 채였다면 유실).
  await fireStt(page, '42.0');
  await expect
    .poll(async () => activeChipName(page), 'STT 재개 → 커밋 후 활성 칩 전진(측정항목02)')
    .toContain('측정항목02');
});

test('FB-B — 뒤쪽 음성 컬럼으로 진행하면 활성 칩이 가시영역으로 자동 스크롤', async ({ page }) => {
  await boot(page);
  const grid = page.locator('[data-testid="voice-chip-grid"]');
  await expect(grid).toBeVisible();

  // 여러 음성 컬럼을 커밋해 활성 칩을 그리드 아래쪽(스크롤 필요 위치)으로 이동시킨다.
  for (let i = 0; i < 8; i++) {
    await fireStt(page, `${10 + i}.${i}`);
    await page.waitForTimeout(150);
  }

  // 활성 칩이 그리드 가시 창(clip 영역) 안에 들어와 있어야(자동 스크롤). 오라클 동일 — 즉시 스크롤이
  //   렌더 후 정착할 시간을 폴링으로 준다(기대값 완화 아님: "칩이 보인다"는 계약 그대로).
  await expect
    .poll(async () => grid.evaluate((g) => {
      const gridEl = g as HTMLElement;
      const active = gridEl.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      if (!active) return false;
      const gr = gridEl.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      return ar.top >= gr.top - 4 && ar.bottom <= gr.bottom + 4;
    }), '활성 칩이 그리드 가시영역 안에 있어야(자동 스크롤)')
    .toBe(true);
});
