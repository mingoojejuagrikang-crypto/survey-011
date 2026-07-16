/**
 * v0.26.0 F1 재변경(민구 최종 결정 2026-07-03) — 인식 허용범위 "높을수록 엄격" 직접 매핑 검증.
 *
 *  이력: v0.24.0까지 높을수록 엄격 → v0.25.0 반전(높을수록 관대) → v0.26.0 원복(높을수록 엄격).
 *  방향이 두 번 뒤집혔으므로 **매핑 방향 자체를 고정하는 전용 스펙**을 둔다. 이 스펙이 깨지면
 *  방향이 또 바뀐 것이다 — 반드시 민구 결정 이력(settingsStore.ts 주석)을 확인하고 수정할 것.
 *
 *  T1 — 다이얼 0.9(엄격): conf 0.85 발화 → 거부(minConf 0.9). extra에 tolerance:0.9,minConf:0.9.
 *  T2 — 다이얼 0.4(관대): conf 0.45 발화 → 수용(값 커밋, 거부 이벤트 0).
 *  T3 — 입력 조절 스탭퍼가 "높을수록 엄격"을 명시(오해 재발 방지 가드).
 *
 *  STT/TTS 목·설정 시드는 v023-voice.spec.ts 패턴 재사용. dev 서버 5175 수동 기동 필요.
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(120_000);

const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';
const PHONE_375 = { width: 375, height: 812 };

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));

const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c8', name: '과실 횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

function settingsWithTolerance(tolerance: number) {
  return {
    state: {
      googleConnected: true,
      userEmail: 'tester@example.com',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_V026_F1/edit',
      sheetTab: 'Sheet1',
      columns: COLUMNS,
      tableGenerated: true,
      totalRows: 2,
      ttsRate: 1.05,
      recognitionTolerance: tolerance,
      sessionLabelColId: null,
      sessionAutoLabel: 'v026-f1-test',
      preferredVoiceName: '',
      roundDateColId: null,
    },
    version: 11,
  };
}

const HEADERS = ['조사일자', '농가명', '과실 횡경'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '100.0'],
  [PREV_ROUND, '이원창', '100.0'],
];

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
  MockSTT.prototype.start=function(){ this._active=true; var s=this; setTimeout(function(){ (s._ls['start']||[]).forEach(function(cb){cb(new Event('start'));}); },5); };
  MockSTT.prototype.stop=function(){ this._active=false; };
  MockSTT.prototype.abort=function(){ this._active=false; var s=this; setTimeout(function(){ (s._ls['end']||[]).forEach(function(cb){cb(new Event('end'));}); },5); };
  MockSTT.prototype.fireResult=function(transcript,confidence){ if(confidence===undefined)confidence=0.95;
    if(!this._active) return;
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

async function setupAndStart(page: Page, tolerance: number) {
  await page.setViewportSize(PHONE_375);
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
    { settings: settingsWithTolerance(tolerance), storeKey: STORE_KEY },
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

async function fireSttConf(page: Page, transcript: string, confidence: number, waitMs = 500) {
  await page.evaluate(({ t, c }) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, c);
  }, { t: transcript, c: confidence });
  await page.waitForTimeout(waitMs);
}

type LogEv = { type?: string; parsed?: string; extra?: string; text?: string };
async function loadLogEvents(page: Page): Promise<LogEv[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    return new Promise<LogEv[]>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as LogEv[]);
      req.onerror = () => res([]);
    });
  });
}

// ─── T1: 다이얼 높음(0.9) = 엄격 — 적당한 신뢰도(0.85)도 거부 ───────────────────
test('T1 — tolerance 0.9(엄격): conf 0.85 발화 거부 + extra tolerance:0.9,minConf:0.9', async ({ page }) => {
  await setupAndStart(page, 0.9);
  await fireSttConf(page, '105.0', 0.85, 700);

  const cue = page.locator('[data-testid="reask-cue"]');
  await expect(cue).toBeVisible({ timeout: 2500 });
  expect(await cue.getAttribute('data-reason')).toBe('low_confidence');

  const events = await loadLogEvents(page);
  const lowConf = events.find((e) => e.type === 'stt_rejected_low_confidence');
  expect(lowConf).toBeTruthy();
  expect(lowConf?.extra).toBe('tolerance:0.9,minConf:0.9'); // 직접 매핑: 다이얼값 = 임계
});

// ─── T2: 다이얼 낮음(0.4) = 관대 — 낮은 신뢰도(0.45)도 수용 ─────────────────────
test('T2 — tolerance 0.4(관대): conf 0.45 발화 수용(거부 이벤트 0)', async ({ page }) => {
  await setupAndStart(page, 0.4);
  await fireSttConf(page, '105.0', 0.45, 700);

  // 거부 큐가 뜨지 않고 값이 커밋된다(다음 행 진행 or 값 반영).
  const cueVisible = await page.locator('[data-testid="reask-cue"]')
    .isVisible({ timeout: 1200 }).catch(() => false);
  expect(cueVisible).toBe(false);

  const events = await loadLogEvents(page);
  expect(events.some((e) => e.type === 'stt_rejected_low_confidence')).toBe(false);
  expect(events.some((e) => e.type === 'value')).toBe(true); // 값 커밋 실재
});

// ─── T3: 방향 문구 가드 — 스탭퍼 설명이 "높을수록 엄격" 명시 ──────────────────────
test('T3 — 입력 조절 스탭퍼에 "높을수록 엄격" 명시', async ({ page }) => {
  await setupAndStart(page, 0.6);

  const toggle = page.locator('[data-testid="input-control-toggle"]');
  await expect(toggle).toContainText('입력 조절');
  await expect(toggle).toContainText('인식 60%');
  await toggle.click();

  const stepper = page.locator('[data-testid="stepper-tolerance"]');
  await expect(stepper).toBeVisible();
  await expect(stepper).toContainText('높을수록 엄격');
  await expect(page.locator('input[type="range"]')).toHaveCount(0);
});

// ─── T4: ？명령어 팝업 잘림 0 — 375×812에서 전 항목+하단 닫기가 스크롤 없이 보인다 ──
//  v0.26.0 화면잘림 대응 가드. 종전엔 마지막 항목(종료)이 화면 중간에서 끊겨 "잘림"으로 보였다.
test('T4 — 명령어 팝업: 마지막 항목(종료)·하단 닫기 버튼이 375px에서 스크롤 없이 전부 보임', async ({ page }) => {
  await setupAndStart(page, 0.6);

  await page.locator('button[title="음성 명령어 도움말"]').first().click();
  const closeBtn = page.locator('[data-testid="cmd-help-close"]');
  await expect(closeBtn).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-testid="command-help-popup"]')).toContainText('도움말 중 입력 정지');

  // 마지막 명령어(종료)의 설명까지 뷰포트 안(하단 닫기 버튼 위)에서 완전히 보인다.
  const lastDesc = page.locator('text=입력을 끝내고 저장합니다').first();
  await expect(lastDesc).toBeVisible();
  const box = (await lastDesc.boundingBox())!;
  const closeBox = (await closeBtn.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(closeBox.y + 1); // 목록이 닫기 버튼과 안 겹침
  expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(PHONE_375.height + 1); // 닫기 버튼 화면 안

  // 목록 컨테이너에 스크롤 잔여가 없다(= 전 항목이 컨테이너 안에 다 들어옴).
  const listOverflow = await lastDesc.evaluate((el) => {
    let p = el.parentElement;
    while (p && getComputedStyle(p).overflowY !== 'auto') p = p.parentElement;
    return p ? p.scrollHeight - p.clientHeight : -1;
  });
  expect(listOverflow).toBeLessThanOrEqual(1);

  // 하단 닫기 버튼으로 닫힌다(상단 ✕가 배너에 가려져도 닫기 경로 확보).
  await closeBtn.click();
  await expect(closeBtn).toBeHidden({ timeout: 2000 });
});

test('T5 — 명령어 도움말이 열린 동안 STT 명령은 실행되지 않고 닫으면 복원된다', async ({ page }) => {
  await setupAndStart(page, 0.6);

  await expect(page.locator('[data-testid="active-row"]')).toHaveText('1');
  await page.locator('button[title="음성 명령어 도움말"]').first().click();
  await expect(page.locator('[data-testid="command-help-popup"]')).toBeVisible();

  await fireSttConf(page, '다음', 0.95, 500);
  await expect(page.locator('[data-testid="active-row"]')).toHaveText('1');
  let events = await loadLogEvents(page);
  expect(events.some((e) => e.type === 'command' && e.parsed === 'nextRow')).toBe(false);

  await page.locator('[data-testid="cmd-help-close"]').click();
  await expect(page.locator('[data-testid="command-help-popup"]')).toBeHidden();

  await fireSttConf(page, '다음', 0.95, 700);
  events = await loadLogEvents(page);
  expect(events.some((e) => e.type === 'command' && e.parsed === 'ui_resume' && e.extra === 'command_help')).toBe(true);
  expect(events.some((e) => e.type === 'command' && e.parsed === 'nextRow' && e.text === '다음')).toBe(true);
});
