/**
 * v0.23.0 입력탭(Vance) — B1(팝업 중앙 흡수, 375px 잘림 0) + B2(재질문 사유 큐) + B3(마이크 재연결 쿨다운).
 *
 *  B1 — AnomalyAlert/ModifyIndicator/PausedCard를 position:fixed 오버레이가 아니라 중앙 흡수영역
 *       (grid row3, 1fr, overflow:hidden) **안에** 렌더한다. 긴 항목명 + 큰 음수소수(-355.5)도 잘리지
 *       않아야 한다(GL-005 375px). 검증: 흡수된 카드가 row3 트랙 안에 있고(상하 경계 안), 가로로
 *       새지 않으며(scrollWidth ≤ clientWidth), 카드가 떠도 하단 컨트롤바 Y가 불변(v0.19.0 인변량).
 *  B2 — listening hero 아래 재질문 사유 큐(reaskReason). Mack의 sessionStore.reaskReason이 아직
 *       머지 전이라, 컴포넌트(ReaskCue) 단위 렌더만 DOM 주입 없이 직접 검증한다(통합은 머지 후).
 *  B3 — 마이크 재연결 버튼: 탭 후 쿨다운(~3s) 동안 비활성+"재연결 중…"로 더블탭 무반응 오인 방지.
 *
 *  STT/TTS 주입 + 설정 시드는 trend-alert.spec.ts 패턴 재사용. dev 서버 5175 수동 기동 필요.
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

// 긴 항목명 + 큰 음수소수(-355.5)로 B1 잘림 0을 시험. 횡경(c8): decrease = 작아지면 알람.
//   직전 100.0 → -355.5 발화 = 크게 작아짐(감소) → 추세 감소 알람 + 큰 음수값 카드.
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
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_V023_1/edit',
    sheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 2,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: 'v023-test',
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

async function setupAndStart(page: Page) {
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

/** 신뢰도 명시 발화(B2 저신뢰 게이트 검증용). */
async function fireSttConf(page: Page, transcript: string, confidence: number, waitMs = 500) {
  await page.evaluate(({ t, c }) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, c);
  }, { t: transcript, c: confidence });
  await page.waitForTimeout(waitMs);
}

type LogEv = {
  type?: string; extra?: string; ttsText?: string; confidence?: number;
  /** v0.35.0 R2-FIX-2 — command 이벤트의 파싱 결과(ui_suspend/ui_resume 등). */
  parsed?: string;
  // v0.34.0 D11a — 세션 시작 설정 스냅샷 필드(logger.ts SessionMeta 확장분).
  meta?: {
    recognitionTolerance?: number;
    ttsRate?: number;
    beepPositiveId?: string;
    beepNegativeId?: string;
    autoScreenCapture?: boolean;
    anomalyRuleCount?: number;
  };
};
/** logger가 IDB('survey-011' / store 'logEvents')에 영속한 진단 이벤트를 읽는다(meta 포함). */
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

const ttsLog = (page: Page) => page.evaluate(() => (window as unknown as { __ttsLog: string[] }).__ttsLog ?? []);

/** 흡수영역(grid row3) = display:flex + overflow:hidden 인 가운데 트랙. 칩 그리드(grid)·컨트롤바와
 *  구분하기 위해 anomaly-alert/paused-card/modify-indicator의 부모를 직접 잡는다. */
async function absorbTrackMetrics(page: Page, cardTestId: string) {
  return page.evaluate((tid) => {
    const card = document.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null;
    if (!card) return null;
    const track = card.parentElement as HTMLElement | null;
    if (!track) return null;
    const cardR = card.getBoundingClientRect();
    const trackR = track.getBoundingClientRect();
    return {
      cardTop: cardR.top, cardBottom: cardR.bottom,
      trackTop: trackR.top, trackBottom: trackR.bottom,
      cardScrollW: card.scrollWidth, cardClientW: card.clientWidth,
      trackOverflowY: getComputedStyle(track).overflowY,
      trackDisplay: getComputedStyle(track).display,
    };
  }, cardTestId);
}

// ─── B1 ─────────────────────────────────────────────────────────
test('B1 — 이상치 카드가 중앙 흡수영역 안에 렌더 + 375px 긴이름/음수소수(-355.5) 잘림 0', async ({ page }) => {
  await setupAndStart(page);

  // 컨트롤바 기준 Y(입력 조절 토글) — 카드 표시 전.
  const controlAnchor = page.locator('[data-testid="input-control-toggle"]');
  await expect(controlAnchor).toBeVisible({ timeout: 5000 });
  const yBefore = (await controlAnchor.boundingBox())!.y;

  // 직전 100.0 → -355.5 발화 = 큰 감소 → 추세 감소 알람(큰 음수소수 + 긴 항목명 카드).
  await fireStt(page, '-355.5', 700);

  const card = page.locator('[data-testid="anomaly-alert"]');
  await expect(card).toBeVisible({ timeout: 3000 });
  await expect(card).toContainText('-355.5');
  // v0.33.0 항목7 — "확인 또는 수정" 텍스트 힌트는 [확인][수정] 터치 버튼으로 대체.
  await expect(card.locator('[data-testid="anomaly-confirm-btn"]')).toBeVisible();
  await expect(card.locator('[data-testid="anomaly-modify-btn"]')).toBeVisible();
  console.log('✓ 이상치 카드 표시 + 음수소수/행동 버튼 포함');

  const m = await absorbTrackMetrics(page, 'anomaly-alert');
  expect(m).not.toBeNull();
  console.log(`track: display=${m!.trackDisplay} overflowY=${m!.trackOverflowY}`);
  console.log(`card top=${m!.cardTop.toFixed(0)} bottom=${m!.cardBottom.toFixed(0)} | track top=${m!.trackTop.toFixed(0)} bottom=${m!.trackBottom.toFixed(0)}`);
  console.log(`card scrollW=${m!.cardScrollW} clientW=${m!.cardClientW}`);

  // 흡수영역 = overflow:hidden 트랙(fixed 오버레이가 아님 — 부모 트랙이 흡수형).
  expect(m!.trackOverflowY).toBe('hidden');
  // 카드가 트랙 세로 경계 안(상단은 트랙 위에서 시작, 하단은 트랙 아래로 안 넘침 — 흡수 + 내부 스크롤).
  expect(m!.cardTop).toBeGreaterThanOrEqual(m!.trackTop - 1);
  expect(m!.cardBottom).toBeLessThanOrEqual(m!.trackBottom + 1);
  // 가로 잘림 0: 카드가 가로로 새지 않는다.
  expect(m!.cardScrollW).toBeLessThanOrEqual(m!.cardClientW + 1);
  console.log('✓ 카드 트랙 내부 + 가로 잘림 0(375px)');

  // 컨트롤바 Y 불변(v0.19.0 인변량 — 카드가 떠도 row3 1fr라 하단이 안 밀림).
  const yAfter = (await controlAnchor.boundingBox())!.y;
  console.log(`controlbar Y: before=${yBefore} after=${yAfter}`);
  expect(Math.abs(yBefore - yAfter)).toBeLessThanOrEqual(1);
  console.log('✓ 카드 표시 후에도 컨트롤바 Y 불변');
});

test('B1 — 일시정지 카드도 중앙 흡수영역 안(컨트롤바 Y 불변)', async ({ page }) => {
  await setupAndStart(page);
  const controlAnchor = page.locator('[data-testid="input-control-toggle"]');
  await expect(controlAnchor).toBeVisible({ timeout: 5000 });
  const yBefore = (await controlAnchor.boundingBox())!.y;

  await page.locator('button[title="일시정지"]').click({ force: true });
  await page.waitForTimeout(400);
  const paused = page.locator('[data-testid="paused-card"]');
  await expect(paused).toBeVisible();

  const m = await absorbTrackMetrics(page, 'paused-card');
  expect(m).not.toBeNull();
  expect(m!.trackOverflowY).toBe('hidden');
  expect(m!.cardBottom).toBeLessThanOrEqual(m!.trackBottom + 1);
  expect(m!.cardScrollW).toBeLessThanOrEqual(m!.cardClientW + 1);

  const yAfter = (await controlAnchor.boundingBox())!.y;
  expect(Math.abs(yBefore - yAfter)).toBeLessThanOrEqual(1);
  console.log('✓ 일시정지 카드 흡수 + 컨트롤바 Y 불변');
});

// ─── B2 ─────────────────────────────────────────────────────────
test('B2 — 재질문 사유 큐: 머지 전(reaskReason 미존재)엔 안전하게 미표시, listening hero는 정상', async ({ page }) => {
  await setupAndStart(page);
  await page.waitForTimeout(300);

  // 머지 전 현실: sessionStore.reaskReason 필드 없음 → VoiceScreen의 (sess.reaskReason ?? null)이
  //   null로 떨어져 ReaskCue는 렌더되지 않는다(방어적 읽기 — 크래시 없음).
  const cue = page.locator('[data-testid="reask-cue"]');
  expect(await cue.count()).toBe(0);
  console.log('✓ reaskReason 미존재 시 큐 미표시(방어적, 크래시 없음)');

  // 그래도 listening hero(항목명)는 정상 노출 — 큐 부재가 hero를 막지 않는다.
  await expect(page.getByText(LONG_NAME, { exact: false }).first()).toBeVisible();
  console.log('✓ 큐 부재에도 listening hero 정상');

  // 머지 후 검증 훅(Mack의 setReaskReason): reaskReason='low_confidence'→"소리가 불확실",
  //   'parse_failed'→"숫자로 인식 실패". 통합 시 이 testid(reask-cue)+data-reason으로 확인.
  // 런타임에 zustand 스토어에 필드를 주입할 수 있으면(머지 후) 아래가 양성 경로가 된다:
  const injected = await page.evaluate(() => {
    // 스토어가 window에 노출돼 있지 않으면 주입 불가 — 머지 전엔 false(스킵 신호).
    const w = window as unknown as { __sessionStore?: { setState: (p: Record<string, unknown>) => void } };
    if (!w.__sessionStore) return false;
    w.__sessionStore.setState({ reaskReason: 'parse_failed' });
    return true;
  });
  if (injected) {
    await expect(page.locator('[data-testid="reask-cue"][data-reason="parse_failed"]')).toBeVisible();
    await expect(page.locator('[data-testid="reask-cue"]')).toContainText('숫자로 인식 실패');
    console.log('✓ (양성 경로) reaskReason 주입 시 큐 표시');
  } else {
    console.log('ℹ 스토어 미노출(머지 전) — 양성 경로는 통합 후 활성(testid/reason 계약 명시).');
  }
});

// ─── B3 ─────────────────────────────────────────────────────────
test('B3 — 마이크 재연결 버튼 탭 → 쿨다운 동안 "재연결 중…"·비활성 → ~3s 후 재활성', async ({ page }) => {
  await setupAndStart(page);

  // mock STT 환경엔 실제 클립 오디오 스트림이 없어, STT 활동이 시작되면 클립 레코더가 스트림 소실로
  //   판정 → micLost 래치 → 재연결 배너가 뜬다(실기기의 블루투스 끊김과 같은 경로). 한 번 STT를
  //   발화시켜 배너 노출을 유도한다.
  await fireStt(page, '12.3', 600);

  const btn = page.locator('[data-testid="mic-reconnect-btn"]');
  await expect(btn).toBeVisible({ timeout: 5000 });
  // 평상시(쿨다운 아님): 활성 + "재연결".
  await expect(btn).toBeEnabled();
  await expect(btn).toContainText('재연결');

  // 탭 → 즉시 비활성 + "재연결 중…"(더블탭 무반응 오인 방지).
  await btn.click();
  await page.waitForTimeout(150);
  await expect(btn).toBeDisabled();
  await expect(btn).toContainText('재연결 중');
  console.log('✓ 탭 직후 비활성 + "재연결 중…"');

  // 두 번째 탭은 무시(disabled) — 여전히 "재연결 중".
  await btn.click({ force: true });
  await page.waitForTimeout(150);
  await expect(btn).toBeDisabled();

  // 쿨다운(3s) 경과 → 재활성("재연결" 복귀). 배너가 여전히 떠 있다는 전제(재연결 실패 케이스).
  //   micLost가 성공으로 풀리면 배너 자체가 사라지는데, mock 환경은 스트림 복구가 안 되므로 배너 유지
  //   → 버튼만 다시 활성으로 돌아오는 핵심 경로를 검증한다(데드버튼 방지의 본질).
  await expect(btn).toBeEnabled({ timeout: 5000 });
  await expect(btn).toContainText('재연결');
  console.log('✓ ~3s 후 버튼 재활성(데드버튼 방지)');
});

// ─── B4 (마지막 행 자동 종료 제거 — 안내 후 대기) ───────────────────────────────
test('B4 — 마지막 행 완료 후 자동 종료 안 함(대기) · 값 발화는 재안내 · "종료"로만 종료 + 세션메타 tolerance 박제', async ({ page }) => {
  await setupAndStart(page);
  // 2행 × 1 음성열(c8). 추세(decrease, 직전 100.0) 안 건드리게 ≥100 값으로 두 행 채운다.
  await fireStt(page, '105.0', 600); // row1 c8
  await fireStt(page, '106.0', 900); // row2 c8 = 마지막 행

  // ① 자동 종료 X — ready('음성 입력 시작') 화면으로 복귀하지 않는다(안내 후 대기).
  const readyAfterLast = await page.locator('text=음성 입력 시작').first()
    .isVisible({ timeout: 1200 }).catch(() => false);
  expect(readyAfterLast).toBe(false);

  // ①-b hero가 검토 대기 표시 — 마지막 컬럼을 다시 묻는 것처럼 보이지 않아야 한다.
  //    (v0.34.0 A4 — listening 전용화의 예외 1분기.)
  //    v0.36.0 코덱스 시안(민구 확정) — "N행 완료 — 명령 대기" 문자 라벨이 ✓ 심볼 + 행 번호
  //    (hero-primary='2')로 바뀌었다(원거리 판독·언어무관 심볼). 시각은 심볼, 의미(스크린리더)는
  //    aria-label("2행 완료, 명령 대기")로 보존 — 오라클을 문자에서 상태+행번호+aria로 교체.
  //    "마지막 행 뒤 자동 종료 없이 대기한다"는 메커니즘 검증은 동일하다.
  await expect(page.locator('[data-hero-state="review"]')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('[data-testid="hero-primary"]')).toHaveText('2');
  await expect(page.getByRole('status', { name: '2행 완료, 명령 대기' })).toBeVisible();

  // ② end_reached_waiting 로깅 + 세션 시작 메타에 recognitionTolerance(0.6) 박제(설정값 미로깅 갭 해소).
  const events = await loadLogEvents(page);
  expect(events.some((e) => (e.extra ?? '').startsWith('end_reached_waiting'))).toBe(true);
  const startMeta = events.find((e) => e.type === 'session' && e.extra === 'start');
  expect(startMeta?.meta?.recognitionTolerance).toBe(0.6);
  // v0.34.0 D11a — 세션 시작 설정 스냅샷: 비프 최종 선택·TTS 속도·자동 캡처·이상치 규칙 개수가
  // meta에 박제된다(로그만으로 자가검증). 시드에 없는 필드는 마이그레이션이 기본값으로 치유:
  // beep 기본 'pos-rise'/'neg-fall'(beepVariants SSOT), autoScreenCapture 기본 true.
  // anomalyRuleCount: COLUMNS 중 c8(trendRule 'decrease') 하나 → 1(개수만 — 컬럼명 미로깅).
  expect(startMeta?.meta?.ttsRate).toBe(1.05);
  expect(startMeta?.meta?.beepPositiveId).toBe('pos-rise');
  expect(startMeta?.meta?.beepNegativeId).toBe('neg-fall');
  expect(startMeta?.meta?.autoScreenCapture).toBe(true);
  expect(startMeta?.meta?.anomalyRuleCount).toBe(1);

  // ③ 종료 안내 TTS가 나갔다.
  const tts1 = await ttsLog(page);
  expect(tts1.some((t) => t.includes('종료하려면'))).toBe(true);

  // ④ 종료 대기 중 값 발화 → 새 행 커밋 안 하고 재안내만(자동 종료 제거의 핵심).
  const before = tts1.length;
  await fireStt(page, '99.9', 700);
  const tts2 = await ttsLog(page);
  expect(tts2.slice(before).some((t) => t.includes('입력이 끝났습니다') || t.includes('종료하려면'))).toBe(true);
  // 여전히 세션 유지(ready 아님).
  const stillActive = await page.locator('text=음성 입력 시작').first()
    .isVisible({ timeout: 600 }).catch(() => false);
  expect(stillActive).toBe(false);

  // ⑤ "종료" 음성 명령 → 세션 종료(ready 복귀).
  await fireStt(page, '종료', 900);
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 4000 });
});

test('B4 — 마지막 행 대기(완료) 상태에서 하단 종료 버튼으로 종료된다(FB-G, 음성 외 경로)', async ({ page }) => {
  await setupAndStart(page);
  await fireStt(page, '105.0', 600); // row1
  await fireStt(page, '106.0', 900); // row2 = 마지막

  // 대기 상태(자동 종료 X) — ready 아님.
  const ready = await page.locator('text=음성 입력 시작').first()
    .isVisible({ timeout: 1000 }).catch(() => false);
  expect(ready).toBe(false);

  // v0.35.0 FB-G — 완료(마지막 행 대기)면 하단 중앙 버튼이 '일시정지' 대신 '종료'로 바뀐다.
  //   일시정지 패널을 거치지 않고 바로 종료(ExitConfirmDialog 재사용).
  await expect(page.locator('button[title="일시정지"]')).toHaveCount(0);
  const endBtn = page.locator('button[title="입력 종료"]');
  await expect(endBtn).toBeVisible();
  await endBtn.click();
  await page.locator('button[title="종료 확인"]').click();
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 4000 });
});

// ─── v0.35.0 R2-FIX-1/2 (리뷰 라운드2 — 종료 경로 데이터 무결성) ─────────────

test('R2-FIX-1 — persistSession resolve 전엔 phase가 ready로 가지 않는다(지연 persist 회귀)', async ({ page }) => {
  await setupAndStart(page);
  await fireStt(page, '105.0', 600); // row1
  await fireStt(page, '106.0', 900); // row2 = 마지막 → 완료(대기)

  // 종료 시 최종 persist를 인위적으로 지연(db.ts saveSession의 기존 seam).
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __survey011DelaySessionPutMs?: number })
      .__survey011DelaySessionPutMs = 1500;
  });

  const endBtn = page.locator('button[title="입력 종료"]');
  await expect(endBtn).toBeVisible();
  await endBtn.click();
  await page.locator('button[title="종료 확인"]').click();

  // 지연 창 안(≈700ms) — 아직 persist 미완이므로 ready('음성 입력 시작')가 뜨면 안 된다.
  //   종전 코드(setPhase('ready')가 persist 앞)에선 여기서 즉시 ready가 떠 start()가 최종 flush를
  //   덮어쓸 수 있었다(Flash Critical). 이제 UI는 persist 완료까지 종료 중 상태를 유지한다.
  await page.waitForTimeout(700);
  await expect(page.locator('text=음성 입력 시작')).toHaveCount(0);

  // persist가 resolve된 뒤에만 ready로 전환.
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 6000 });
  console.log('✓ 종료: persist 완료 전 ready 미노출 → 완료 후 ready(덮어쓰기 race 창 제거)');
});

test('R2-FIX-2 — 종료 확인 다이얼로그 동안 STT suspend, 취소 시 resume(ui_suspend/ui_resume 계측)', async ({ page }) => {
  await setupAndStart(page);
  await fireStt(page, '105.0', 600);
  await fireStt(page, '106.0', 900); // 완료 대기 — 이 상태에선 '종료' 음성명령 대기로 STT가 살아있다.

  const countOf = async (parsed: string) =>
    (await loadLogEvents(page)).filter((e) => e.parsed === parsed && e.extra === 'exit_confirm').length;

  // 다이얼로그 열기 → suspend.
  await page.locator('button[title="입력 종료"]').click();
  await expect(page.locator('button[title="종료 확인"]')).toBeVisible();
  await expect.poll(() => countOf('ui_suspend'), { timeout: 3000 }).toBeGreaterThanOrEqual(1);
  expect(await countOf('ui_resume')).toBe(0); // 아직 열려 있으므로 resume 없음

  // 취소 → resume(확인 경로는 stop()이 정지시키므로 resume 없음).
  await page.locator('button[title="계속 입력"]').click();
  await expect(page.locator('button[title="종료 확인"]')).toHaveCount(0);
  await expect.poll(() => countOf('ui_resume'), { timeout: 3000 }).toBeGreaterThanOrEqual(1);
  console.log('✓ 종료 확인 다이얼로그: 열림 suspend → 취소 resume(배경 음성 오파싱 차단)');
});

// ─── B2 (재질문 사유 큐 실동작) ──────────────────────────────────────────────
test('B2 — 저신뢰도(conf<허용범위) 발화 → 사유 큐 low_confidence + stt_rejected_low_confidence(tolerance 동봉), 성공 시 해제', async ({ page }) => {
  await setupAndStart(page);
  // row1 c8에 conf 0.3(<tolerance 0.6) → 저신뢰 재질문.
  await fireSttConf(page, '105.0', 0.3, 700);

  const cue = page.locator('[data-testid="reask-cue"]');
  await expect(cue).toBeVisible({ timeout: 2500 });
  expect(await cue.getAttribute('data-reason')).toBe('low_confidence');

  const events = await loadLogEvents(page);
  const lowConf = events.find((e) => e.type === 'stt_rejected_low_confidence');
  expect(lowConf).toBeTruthy();
  // v0.26.0 F1 재변경(민구 최종 결정: 높을수록 엄격, 직접 매핑): extra는 다이얼 값(tolerance)과
  // 실제 임계(minConf)를 함께 싣는다. 기본 0.60 → minConfidenceForTolerance(0.6)=0.60. conf 0.3<0.6 거부.
  expect(lowConf?.extra).toBe('tolerance:0.6,minConf:0.6'); // 설정값 vs 신뢰도 대조 근거(방향 명시)

  // 성공 커밋 → 사유 큐 해제.
  await fireSttConf(page, '105.0', 0.95, 700);
  await expect(cue).toBeHidden({ timeout: 2500 });
});

test('B2 — 고신뢰지만 파싱 실패 → 사유 큐 parse_failed + stt_parse_failed(허용범위 게이트와 무관함 입증)', async ({ page }) => {
  await setupAndStart(page);
  // conf 0.95(허용범위 통과)지만 숫자로 파싱 불가 → "80~90%인데 재인식" 혼동의 실제 원인.
  await fireStt(page, '바나나 사과 포도', 700);

  const cue = page.locator('[data-testid="reask-cue"]');
  await expect(cue).toBeVisible({ timeout: 2500 });
  expect(await cue.getAttribute('data-reason')).toBe('parse_failed');

  const events = await loadLogEvents(page);
  expect(events.some((e) => e.type === 'stt_parse_failed')).toBe(true);
  // 저신뢰 이벤트는 없어야 한다(이건 신뢰도 문제가 아니라 파싱 문제).
  expect(events.some((e) => e.type === 'stt_rejected_low_confidence')).toBe(false);
});
