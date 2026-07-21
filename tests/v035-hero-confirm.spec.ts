/**
 * v0.35.0 FB-A/C/F(Vance) — 중앙 카드 확인 플래시 검증.
 *
 *  깨끗한 값 커밋(추세/이상치 아님) 시 store `valueBurst`(v0.35.0 소비자 부활)의 seq가 바뀌고,
 *  VoiceHero가 ~1.5초간 확인 카드(✓ + 인식값, data-hero-state="confirm")를 보여준 뒤 대기 카드
 *  (항목명 + 파형, data-hero-state="listening")로 자동 복귀한다.
 *  ⚠️ 확인 카드는 valueBurst.name/value에서만 읽는다(currentCol이 이미 다음 항목이므로 — v0.34.0
 *     A4가 값 표시를 없앤 이유). 그래서 대기 카드와 시각적으로 구분(밝은 초록 채움 + ✓)된다.
 *
 *  ── v0.35.0 R3-FIX-5(리뷰 라운드3, Codex Medium) 재작성 ──────────────────────────────────
 *  종전 스펙은 **음성 컬럼이 1개**였다. 그러면 그 커밋이 곧 **행의 마지막 음성 컬럼** 커밋이라,
 *  advance()가 phase를 'complete'로 올리고 "N행 완료"를 안내한 뒤 다음 행에서 'active'로 복귀한다
 *  (useVoiceSession advance). 즉 확인 플래시가 CONFIRM_MS(1500ms)를 다 못 채우고 **echo TTS 길이만큼만**
 *  떴다가 review로 잘린다 — 실측 타임라인(1 음성컬럼, async TTS 200ms):
 *      t=0 listening(당도) → t=9 confirm(30.7) → t=263 review(1행 완료) → t=477 listening
 *  종전 테스트는 confirm이 "떴다"는 것과 이후 "listening으로 돌아왔다"만 봤기에 통과했지만, 그
 *  복귀는 **1.5초 타이머가 아니라 advance()의 행 이동**이 만든 것이었다(테스트가 이름과 다른 것을
 *  검증 = 공허). 또 그 사이 review 상태를 조용히 통과해 아무도 안 봤다.
 *  ⚠️ Codex의 지적 사유("음성 컬럼 1개면 review가 burst를 소비해 확인 플래시가 **안 뜬다**")는
 *     사실과 다르다 — burst는 커밋 직후 phase가 아직 'active'일 때 렌더되므로 플래시는 **뜬다**.
 *     결론(공허·타이밍 의존)만 맞다. 위 타임라인이 1차 증거.
 *
 *  그래서 아래로 분리한다(**동작 변경 없음** — 테스트만 스펙을 정직하게 반영):
 *   1) 행 **중간** 음성 컬럼 커밋 → ✓ + 값이 뜨고 CONFIRM_MS 동안 유지된 뒤 다음 항목 대기로 복귀.
 *   2) 행 **마지막** 음성 컬럼 커밋 → ✓ 대신 "N행 완료"(review). 민구가 (a)로 확정한 스펙이며
 *      통일하려면 advance/phase 순서 재작업이 필요해 범위 밖이다([TEST-UI-3] 파생 항목).
 *
 *  dev 서버 수동 기동 필요: npm run dev -- --port 5175 --strictPort
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(120_000);

const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';
const PHONE_402 = { width: 402, height: 874 };

// 추세/이상치 규칙 없는 음성 float 컬럼 → 커밋이 항상 깨끗(확인 플래시 경로).
// v0.35.0 R3-FIX-5 — 음성 컬럼을 **2개**로. 1개면 모든 커밋이 곧 행-마지막이라 확인 플래시가
//   advance()의 review에 잘려 CONFIRM_MS를 검증할 수 없었다(파일 상단 주석의 실측 타임라인).
//   당도(중간) → 산도(행 마지막) 순서. seq(1→2) 컬럼으로 2행.
const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c2', name: '당도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'c3', name: '산도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_V035_HC/edit',
    sheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 2,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: 'v035-hero-confirm-test',
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 11,
};

const HEADERS = ['조사일자', '조사나무', '당도', '산도'];
const SHEET_ROWS = [['2026-01-01', '1', '', ''], ['2026-01-01', '2', '', '']];

const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];
  var fakeTrack = {
    kind: 'audio', label: 'Fake Mic', readyState: 'live', muted: false,
    getSettings: function(){ return { deviceId: 'fake-mic' }; },
    addEventListener: function(){}, removeEventListener: function(){}, stop: function(){},
  };
  window.__fakeMicTrack = fakeTrack;
  var fakeStream = { getAudioTracks: function(){ return [fakeTrack]; }, getTracks: function(){ return [fakeTrack]; } };
  if (navigator.mediaDevices) {
    try { navigator.mediaDevices.getUserMedia = function(){ return Promise.resolve(fakeStream); }; } catch(e){}
  }
  // v0.35.0 R3-FIX-5 — onend는 **비동기**(200ms)로 발화한다. 종전 mock은 speak() 안에서 onend를
  //   동기 호출했는데, 실제 speechSynthesis는 절대 그러지 않는다(발화 시간이 있다). 그 비현실성이
  //   상태머신을 왜곡했다: 동기 TTS면 advance()의 setPhase('complete')→announceRowComplete→
  //   setPhase('active')가 한 흐름에 끝나 **review가 단 한 프레임도 페인트되지 않는다**. 즉 실기기와
  //   정반대 화면이 나와 테스트가 존재하지 않는 동작을 검증하게 된다. 200ms면 실기기(수백ms~수초)의
  //   축약이면서 전이가 실제로 페인트된다.
  var mockSynth = {
    speak: function(u) { window.__ttsLog.push(u.text);
      try { if (u.onstart) u.onstart(new Event('start')); } catch(e){}
      setTimeout(function(){ try { if (u.onend) u.onend(new Event('end')); } catch(e){} }, 200); },
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

async function boot(page: Page) {
  await page.setViewportSize(PHONE_402);
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
}

async function startSession(page: Page) {
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

async function fireStt(page: Page, transcript: string) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
}

test('FB-A/C/F — 행 중간 음성 컬럼 커밋: 확인 카드(✓+값)가 ~1.5초 유지된 뒤 다음 항목 대기로 복귀', async ({ page }) => {
  await boot(page);
  await startSession(page);

  // 대기 시작: 항목명 '당도' + 파형.
  await expect(page.locator('[data-hero-state="listening"]')).toBeVisible();
  await expect(page.locator('[data-testid="hero-primary"]')).toHaveText('당도');
  await expect(page.locator('[data-testid="voice-waveform"]')).toBeVisible();

  // 행 **중간** 컬럼(당도) 커밋 → 확인 카드. 뒤에 '산도'가 남아 있어 phase는 'active' 유지 =
  //   review가 확인 플래시를 자르지 않는다 → CONFIRM_MS(1500ms) 타이머가 실제로 검증된다.
  await fireStt(page, '30.7');
  const confirm = page.locator('[data-hero-state="confirm"]');
  await expect(confirm).toBeVisible({ timeout: 2000 });
  await expect(page.locator('[data-testid="hero-primary"]')).toHaveText('30.7');
  // v0.36.0 코덱스 시안(민구 확정) — 파형은 **상시 밴드**(hero 밖 독립 row)로 이동해 확인 상태에서도
  // 유지된다(§6.2 "팝업/확인/경고 상태에서도 유지"). 종전 "확인 중 파형 미표시(count 0)" 단언을
  // 상시 유지 단언으로 교체 — 확인 플래시 자체(CONFIRM_MS·review>confirm)는 아래에서 계속 검증한다.
  await expect(page.locator('[data-testid="voice-waveform"]')).toBeVisible();

  // 핵심(R3-FIX-5): 확인 카드가 **금방 사라지지 않는다**. 1.5초 창의 중간(~700ms)에도 살아 있어야
  //   한다 — 종전 1-음성컬럼 스펙에선 여기서 이미 review로 잘려 있었다(실측 263ms).
  await page.waitForTimeout(700);
  await expect(confirm, '확인 카드는 CONFIRM_MS 동안 유지된다(advance에 잘리지 않음)').toBeVisible();
  await expect(page.locator('[data-testid="hero-primary"]')).toHaveText('30.7');

  // CONFIRM_MS 경과 → **다음 항목(산도)** 대기로 자동 복귀. 행 이동이 아니라 타이머가 만든 복귀다.
  await expect(page.locator('[data-hero-state="listening"]')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-testid="hero-primary"]'), '복귀 시 다음 항목명').toHaveText('산도');
  await expect(page.locator('[data-testid="voice-waveform"]')).toBeVisible();
  console.log('✓ 행 중간 커밋: ✓+값 → ~1.5s 유지 → 다음 항목(산도) 대기 복귀');
});

// v0.35.0 R3-FIX-5 — 행 **마지막** 음성 컬럼은 ✓가 아니라 "N행 완료"가 뜬다.
//   ⚠️ 이건 버그가 아니라 **민구가 (a)로 확정한 스펙**이다([TEST-UI-3] 파생). advance()가 phase를
//   'complete'로 올리고 VoiceHero의 렌더 우선순위(review > confirm)가 확인 플래시를 억제한다.
//   통일하려면 advance/phase 순서 재작업이 필요해 범위 밖 — 이 테스트는 그 스펙을 **고정**한다
//   (누가 무심코 바꾸면 여기서 잡힌다).
/** hero 카드의 상태 전이를 rAF로 기록한다(상태값+대표 텍스트가 바뀔 때만 1행).
 *  ⚠️ review는 **일시적**이다(echo/완료 안내 TTS 길이만큼 — mock TTS에선 수백 ms). expect 폴링으로는
 *  놓칠 수 있어(플래키), 전이를 통째로 수집해 사후 판정한다. [TEST-UI-3]의 "타이밍에 붙지 말라"와
 *  같은 취지 — 순간을 겨냥해 찍지 말고 기록을 본다. */
async function recordHeroTimeline(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __heroTl?: Array<{ st: string; prim: string }> };
    w.__heroTl = [];
    const tick = () => {
      const st = document.querySelector('[data-hero-state]')?.getAttribute('data-hero-state') ?? 'none';
      const prim = document.querySelector('[data-testid="hero-primary"]')?.textContent ?? '';
      const tl = w.__heroTl!;
      const last = tl[tl.length - 1];
      if (!last || last.st !== st || last.prim !== prim) tl.push({ st, prim });
      requestAnimationFrame(tick);
    };
    tick();
  });
}
const readHeroTimeline = (page: Page) =>
  page.evaluate(() => (window as unknown as { __heroTl: Array<{ st: string; prim: string }> }).__heroTl);

test('R3-FIX-5 — 행 마지막 음성 컬럼 커밋: ✓ 대신 "N행 완료"(review) — 민구 확정 스펙 (a)', async ({ page }) => {
  await boot(page);
  await startSession(page);

  // 행 중간(당도) 커밋 → 확인 플래시가 끝나고 산도 대기까지 진행.
  await fireStt(page, '30.7');
  await expect(page.locator('[data-testid="hero-primary"]')).toHaveText('산도', { timeout: 4000 });

  // 행 **마지막**(산도) 커밋의 전이를 통째로 기록.
  await recordHeroTimeline(page);
  await fireStt(page, '4.2');
  await page.waitForTimeout(2500); // review → 다음 행 대기까지 충분히.
  const tl = await readHeroTimeline(page);
  console.log('hero timeline(행 마지막 커밋):', JSON.stringify(tl));

  // 스펙 (a): 행 마지막 커밋엔 review(✓ + 방금 입력한 값)가 뜬다.
  //   v0.37.0 FB-E(민구 확정) — review 표시가 대형 **행 번호**('1')에서 **방금 입력한 값**으로
  //   바뀌었다(hero-primary=행 마지막 음성 컬럼 '산도'의 커밋값 '4.2'). 행 번호 의미는 aria-label로
  //   보존. 오라클을 행번호→입력값으로 교체 — "행 마지막은 confirm이 아니라 review" 메커니즘은 동일.
  const reviewAt = tl.findIndex((f) => f.st === 'review' && f.prim === '4.2');
  expect(reviewAt, '행 마지막 컬럼은 review(✓+입력값 "4.2")를 낸다').toBeGreaterThanOrEqual(0);

  // 정밀화(실측): ✓ 확인 플래시가 **아예 안 뜨는 게 아니라**, echo TTS 동안 잠깐 떴다가 advance()가
  //   phase를 'complete'로 올리는 순간 review가 **덮어쓴다**(렌더 우선순위 review > confirm). 즉
  //   행 마지막 값은 CONFIRM_MS(1.5s)를 못 채운다 — 이것이 "✓ 대신 N행 완료"의 실제 메커니즘이다.
  //   따라서 오라클은 "confirm이 없다"가 아니라 **"confirm이 review로 승계된다"(순서)**여야 한다.
  const confirmAt = tl.findIndex((f) => f.st === 'confirm' && f.prim === '4.2');
  if (confirmAt >= 0) {
    expect(
      confirmAt,
      '행 마지막의 ✓는 잠깐 떴다가 review("N행 완료")로 대체된다 — 1.5초를 채우지 못한다(민구 확정 (a))',
    ).toBeLessThan(reviewAt);
  }
  // 확인 플래시가 review **이후**까지 살아남아선 안 된다(그러면 (a) 스펙이 깨진 것).
  expect(
    tl.slice(reviewAt).some((f) => f.st === 'confirm'),
    'review 이후엔 확인 플래시가 되살아나지 않는다(FIX-3의 seq 소비 — 과거 burst 재생 방지)',
  ).toBe(false);
  // 이후 다음 행(2행) 대기로 복귀한다.
  expect(tl.some((f) => f.st === 'listening' && f.prim === '당도'), '다음 행 대기로 복귀').toBe(true);
  console.log('✓ 행 마지막 커밋: review "1행 완료" (✓ 아님 — 확정 스펙 고정)');
});

// v0.37.0 리뷰 #2(Codex, 민구 Option 1) — skip-완료 검토 오표시 회귀 ─────────────────────────
//   완료 행의 **앞** 음성 컬럼(당도)을 '수정'으로 다시 커밋하면, advance()가 이미 채워진 **뒤** 컬럼
//   (산도)을 건너뛰고 행을 완료한다(useVoiceSession advance skip). 이때 검토(complete) 표시는 방금
//   커밋된 셀 = **당도**의 새 값을 보여야 한다. 종전 코드는 검토값을 무조건 voiceCols[last](산도)에서
//   읽어, 방금 만진 앞 셀이 아니라 **뒤 셀의 옛 값**을 "방금 입력한 값"으로 오표시했다.
//   이 테스트는 valueBurst(방금 커밋 영수증) 파생으로 고친 그 오표시를 박제한다.
//   ⚠️ §10 무침해: 표시 계층(VoiceHero useReviewCommit)만 바뀌었다 — advance/commit/TTS 로직 불변.
test('리뷰#2 — skip-완료 검토는 방금 커밋된 앞 셀(당도)을 보인다(뒤 셀 산도 옛값 오표시 금지)', async ({ page }) => {
  await boot(page);
  await startSession(page);

  // 대기: 당도(row1, awaiting=당도).
  await expect(page.locator('[data-testid="hero-primary"]')).toHaveText('당도', { timeout: 4000 });

  // 뒤 컬럼 **산도**를 수동 키패드로 먼저 채운다. awaiting(당도)≠산도라 commitManualValue는
  //   advance하지 않는다 → 포인터는 당도에 그대로, 산도(4.2)만 채워진 부분작성 행이 만들어진다.
  await page.locator('[data-testid="column-chip"][data-col-name="산도"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 3000 });
  for (const k of ['4', '.', '2']) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="column-chip"][data-col-name="산도"]')).toContainText('4.2');
  await expect(page.locator('[data-testid="hero-primary"]'), '포인터는 여전히 당도').toHaveText('당도');

  // 이제 **당도**를 음성 커밋 → advance가 이미 채워진 산도(idx1)를 건너뛰고 row1 완료(skip) → 검토.
  await recordHeroTimeline(page);
  await fireStt(page, '30.7');
  await page.waitForTimeout(2500);
  const tl = await readHeroTimeline(page);
  console.log('hero timeline(skip 완료):', JSON.stringify(tl));

  // 핵심: 검토는 **방금 커밋된 당도 '30.7'** 를 보인다(뒤 셀 산도가 아니라).
  expect(
    tl.some((f) => f.st === 'review' && f.prim === '30.7'),
    '검토는 방금 커밋된 앞 셀 당도(30.7)를 보인다',
  ).toBe(true);
  // 회귀 가드: 건너뛴 뒤 셀 산도(4.2)의 옛 값을 검토가 "방금 입력한 값"으로 오표시하면 안 된다
  //   (종전 voiceCols[last] 파생의 버그 — 이 단언이 그 회귀를 박제한다).
  expect(
    tl.some((f) => f.st === 'review' && f.prim === '4.2'),
    '검토가 건너뛴 뒤 셀 산도(4.2)의 옛 값을 오표시하면 안 된다',
  ).toBe(false);
  console.log('✓ skip-완료 검토: 당도 30.7(방금 커밋) — 산도 4.2 오표시 없음');
});
