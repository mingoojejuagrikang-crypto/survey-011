/**
 * v0.34.0 Wave 2(Vance) — B7 음성 반응 파동 + B8 edge glow 검증.
 *
 *  B7 — '듣는 중' hero 항목명(HeroPrimaryLine)에 rAF 루프(useAudioLevelVar)가 `--voice-level`
 *       CSS 변수를 흘리고, text-shadow 확산 + 미세 opacity가 그 변수로 변조된다(리렌더 0).
 *       레벨 소스는 audioRecorder의 기존 preroll 캡처 tap — headless는 getUserMedia가 거부돼
 *       레벨 0 폴백이므로, 테스트는 훅의 test seam(window.__voiceLevelOverride)으로 주입한다.
 *  B8 — 화면 외곽 글로우(EdgeGlow): 상태 톤 매핑(anomaly→red, paused→amber, active→green),
 *       pointer-events 통과, zIndex 54(팝업 아래), 세션 비활성 미렌더, 레벨로 강도 변조.
 *  D11b — 세션 시작 ui_fx:wave=on,glow=on,preroll=<...> 계측 1건(IDB logEvents로 확인).
 *
 *  dev 서버 수동 기동 필요: npm run dev -- --port 5175 --strictPort
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
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
];

const SETTINGS = {
  state: {
    googleConnected: true,
    userEmail: 'tester@example.com',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_V034_WG/edit',
    sheetTab: 'Sheet1',
    columns: COLUMNS,
    tableGenerated: true,
    totalRows: 2,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: 'v034-wave-glow-test',
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 11,
};

const HEADERS = ['조사일자', '농가명', '조사나무', '횡경'];
const SHEET_ROWS = [
  [PREV_ROUND, '이원창', '1', '100.0'],
  [PREV_ROUND, '이원창', '2', '100.0'],
];

// v023-voice.spec.ts / v027-voice-cards-fit.spec.ts와 동일한 TTS/STT 주입 mock.
// + v0.34.0 B8 — getUserMedia 스텁: headless는 마이크가 거부돼 첫 값 커밋의 clip_empty가
//   micLost를 래치(→ 글로우가 정당하게 red 고정)하므로, 'live' 트랙의 fake 스트림을 줘서
//   isStreamLost()=false를 유지한다(톤 전환 검증이 결정적이 되게). MediaRecorder/
//   createMediaStreamSource는 fake를 거부하지만 둘 다 기존 안전선(clip_start_failed/
//   clip_preroll_unavailable)으로 흡수된다. __fakeMicTrack.readyState를 'ended'로 바꾸면
//   micLost 경로를 의도적으로 발화시킬 수 있다(전용 테스트).
const MOCK_INIT_SCRIPT = `
(function() {
  window.__ttsLog = [];
  var fakeTrack = {
    kind: 'audio', label: 'Fake Mic', readyState: 'live', muted: false,
    getSettings: function(){ return { deviceId: 'fake-mic' }; },
    addEventListener: function(){}, removeEventListener: function(){}, stop: function(){},
  };
  window.__fakeMicTrack = fakeTrack;
  var fakeStream = {
    getAudioTracks: function(){ return [fakeTrack]; },
    getTracks: function(){ return [fakeTrack]; },
  };
  if (navigator.mediaDevices) {
    try { navigator.mediaDevices.getUserMedia = function(){ return Promise.resolve(fakeStream); }; } catch(e){}
  }
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

/** 부팅 + 입력탭 진입(세션 시작 전 — ready 상태 검증용). */
async function boot(page: Page) {
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
}

async function startSession(page: Page) {
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
}

/** 훅 test seam으로 레벨 주입 후 rAF 반영 대기. */
async function injectLevel(page: Page, level: number) {
  await page.evaluate((v) => {
    (window as unknown as { __voiceLevelOverride?: number }).__voiceLevelOverride = v;
  }, level);
  await page.waitForTimeout(150); // rAF 수 프레임
}

// v0.35.0 — 레벨 rAF 시임(__voiceLevelOverride)은 이제 파형 canvas가 아니라 EdgeGlow(useAudioLevelVar)
//   에서 소비된다. rAF 정지/재개 검증은 edge-glow 루트의 --voice-level로 관측한다.
async function glowVar(page: Page): Promise<string> {
  return page.locator('[data-testid="edge-glow"]').evaluate(
    (el) => el.style.getPropertyValue('--voice-level'),
  );
}

async function fireStt(page: Page, transcript: string, waitMs = 400) {
  await page.evaluate((t) => {
    (window as unknown as { __mockSTT?: { fireResult: (t: string, c: number) => void } })
      .__mockSTT?.fireResult(t, 0.95);
  }, transcript);
  await page.waitForTimeout(waitMs);
}

// ─── B7. 파동 — CSS 변수 반영 + 시각 변조 ──────────────────────────────────

test('B7 — 대기 카드(v0.35.0): 항목명 + 통합 파형 canvas, "듣는 중" 텍스트 제거', async ({ page }) => {
  await boot(page);
  await startSession(page);

  const hero = page.locator('[data-testid="hero-primary"]');
  await expect(hero).toBeVisible();
  await expect(hero).toHaveText('횡경');

  // 대기 상태 표식 + "듣는 중" 텍스트 제거(파형이 신호).
  await expect(page.locator('[data-hero-state="listening"]')).toBeVisible();
  await expect(page.locator('text=듣는 중')).toHaveCount(0);

  // 카드 안에 통합된 파형 canvas가 렌더되고 실측 크기가 있다(원거리 판독용 대형 파형).
  const wave = page.locator('[data-testid="voice-waveform"]');
  await expect(wave).toBeVisible();
  const box = await wave.boundingBox();
  expect(box && box.width).toBeGreaterThan(50);
  expect(box && box.height).toBeGreaterThan(20);
  console.log('✓ 대기: 항목명 + 파형 canvas 통합, "듣는 중" 텍스트 제거');
});

// v0.35.0 FIX-7a(리뷰 라운드1) — 파형 canvas가 실제로 draw되고, 주입 레벨에 진폭이 반응하는지.
//   headless는 analyser 미가용(preroll 거부)이라 레벨 폴백 경로가 그려진다(VoiceWaveform 테스트 심
//   __voiceLevelOverride 소비). 그려진 비투명 픽셀의 세로 확산(maxY-minY)으로 진폭을 측정한다.
async function waveExtent(page: Page): Promise<number> {
  return page.locator('[data-testid="voice-waveform"]').evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0 || canvas.height === 0) return 0;
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;
    let minY = h, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 12) { // alpha>12 = 그려진 픽셀(글로우 포함)
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          break;
        }
      }
    }
    return maxY < 0 ? 0 : maxY - minY;
  });
}

test('B7 — 파형 canvas 실제 draw + 주입 레벨에 진폭 반응(FIX-7a)', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await expect(page.locator('[data-testid="voice-waveform"]')).toBeVisible();

  // 레벨 0: 정적 선이라도 픽셀은 그려진다(draw 발생 증명).
  //   ⚠️ v0.35.0 R3-FIX-3 이후 레벨 0은 **평평한 정적 선**이다(움직이는 합성 파형 아님) — 아래
  //   'R3-FIX-3' 테스트가 그 정지를 직접 단언한다. 여기선 draw 자체가 도는지만 본다.
  await injectLevel(page, 0);
  await page.waitForTimeout(200);
  const lo = await waveExtent(page);
  expect(lo, '레벨 0에도 파형이 그려진다(draw 호출됨)').toBeGreaterThan(0);

  // 레벨 0.85: 진폭이 커져 세로 확산이 유의미하게 늘어난다(레벨 반응).
  await injectLevel(page, 0.85);
  await page.waitForTimeout(250);
  const hi = await waveExtent(page);
  console.log(`waveExtent: level0=${lo} level0.85=${hi}`);
  expect(hi, '레벨↑ → 진폭(세로 확산)↑').toBeGreaterThan(lo + 5);
});

/** 파형 canvas의 현재 픽셀 지문(dataURL). 두 시점을 비교해 **움직임 여부**를 판정한다. */
function waveFingerprint(page: Page): Promise<string> {
  return page.locator('[data-testid="voice-waveform"]').evaluate(
    (el) => (el as HTMLCanvasElement).toDataURL(),
  );
}

// v0.35.0 R3-FIX-3(리뷰 라운드3, Codex Medium) — **죽은 마이크에 움직이는 파형 금지**.
//   이 파형의 존재 이유가 "2~3m 밖에서 내 말을 듣고 있나 확인"이라, 마이크/프리롤 초기화가 실패해
//   아무것도 안 듣는 상태에서 흔들리면 기능의 목적을 배신한다. 종전 합성 폴백은 진폭이
//   `0.12 + lv*0.88`이라 레벨 0에서도 12% 진폭으로 계속 흔들렸다.
//   회귀 오라클 = 두 시점의 canvas 픽셀 지문이 **동일**(정지). 대조군으로 레벨↑에선 달라야 한다
//   (지문 비교가 움직임을 실제로 탐지할 수 있음을 같은 테스트가 증명 — 공허한 단언 방지).
test('R3-FIX-3 — 레벨 0(마이크 사망)이면 파형이 정지(정적 선), 레벨↑이면 움직인다', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await expect(page.locator('[data-testid="voice-waveform"]')).toBeVisible();

  // 레벨 0 = analyser 미가용(headless) + 입력 없음 = 마이크가 죽은 상태와 동일한 신호.
  await injectLevel(page, 0);
  await page.waitForTimeout(300); // 정착
  const a1 = await waveFingerprint(page);
  await page.waitForTimeout(400); // 30fps면 ~12프레임 — 움직였다면 반드시 달라진다.
  const a2 = await waveFingerprint(page);
  expect(a2, '레벨 0: 파형이 움직이지 않는다(정적 선)').toBe(a1);

  // 대조군: 실제 레벨이 있으면 움직인다(위 단언이 '지문이 원래 안 변한다'는 공허한 통과가 아님).
  await injectLevel(page, 0.85);
  await page.waitForTimeout(300);
  const b1 = await waveFingerprint(page);
  await page.waitForTimeout(400);
  const b2 = await waveFingerprint(page);
  expect(b2, '레벨 0.85: 파형이 실제로 흐른다(대조군)').not.toBe(b1);
  console.log('✓ R3-FIX-3: 레벨0=정지 / 레벨0.85=움직임 (지문 비교)');
});

// v0.35.0 R3-FIX-4(리뷰 라운드3, Codex Medium·perf) — 렌더 루프의 **가시성 백오프 계약 보존**.
//   라운드2(R2-FIX-3)는 "keep-alive display:none이면 즉시 백오프"를 매 프레임 offsetParent 읽기로
//   달성했는데, 그게 매 프레임 레이아웃 조회 비용이었다. 라운드3에서 수단을 IntersectionObserver로
//   교체했으므로 **취지가 살아있는지**를 여기서 직접 지킨다(수단이 아니라 결과를 단언).
//   오라클: 세션 중 다른 탭으로 가면(VoiceScreen display:none, [STT-16] keep-alive) canvas stroke
//   호출이 **완전히 멈춘다**. 복귀하면 다시 돈다.
test('R3-FIX-4 — 세션 중 탭 이탈(display:none)이면 파형 렌더 정지, 복귀 시 재개', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await expect(page.locator('[data-testid="voice-waveform"]')).toBeVisible();
  await injectLevel(page, 0.8); // 움직이는 상태 = 루프가 실제로 도는 상태.

  // canvas stroke 호출 카운터(파형 draw 1회당 최소 1회 stroke).
  await page.evaluate(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const orig = proto.stroke;
    (window as unknown as { __strokes: number }).__strokes = 0;
    proto.stroke = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      (window as unknown as { __strokes: number }).__strokes++;
      return (orig as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.stroke;
  });
  const strokes = () => page.evaluate(() => (window as unknown as { __strokes: number }).__strokes);

  await page.waitForTimeout(400);
  const visible1 = await strokes();
  expect(visible1, '보이는 동안엔 파형이 그려진다').toBeGreaterThan(0);

  // 데이터 탭으로 이탈 → 세션은 keep-alive(display:none)로 살아 있다.
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(500); // IO 콜백 + 백오프 정착
  const hiddenStart = await strokes();
  await page.waitForTimeout(700); // 계속 돌았다면 ~21프레임(30fps)이 더 찍힌다.
  const hiddenEnd = await strokes();
  expect(hiddenEnd - hiddenStart, '숨김(display:none) 중엔 파형 draw가 0이어야 한다').toBe(0);

  // 복귀 → 다시 돈다(백오프가 영구 정지가 아님).
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(500);
  const backEnd = await strokes();
  expect(backEnd, '복귀 시 렌더 재개').toBeGreaterThan(hiddenEnd);
  console.log(`✓ R3-FIX-4 백오프: visible=${visible1} hidden(+0)=${hiddenEnd - hiddenStart} resumed=+${backEnd - hiddenEnd}`);
});

// v0.35.0 FIX-7b(리뷰 라운드1) — 일시정지(levelActive=false) 시 edge-glow opacity가 직전 큰 레벨에
//   고착되지 않고 baseline(≈0.55)으로 수렴하는지(FIX-2 검증). '동결' 성공 단언(hidden 탭)과 달리,
//   여기선 정지 시 실제 표시 밝기가 baseline인지를 목적으로 본다.
test('B8 — 일시정지 시 edge-glow opacity가 baseline(≈0.55)으로 수렴(FIX-2/7b)', async ({ page }) => {
  await boot(page);
  await startSession(page);
  const glow = page.locator('[data-testid="edge-glow"]');

  // 큰 레벨 주입 → 활성 중엔 opacity가 높다(≈1.0).
  await injectLevel(page, 1);
  await page.waitForTimeout(200);
  const active = await glow.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
  expect(active).toBeGreaterThan(0.9);

  // 일시정지(levelActive=false) → --voice-level과 무관하게 baseline 0.55로 강제.
  await page.locator('button[title="일시정지"]').click();
  await page.waitForTimeout(300);
  await expect(glow).toHaveAttribute('data-tone', 'amber'); // 일시정지 톤
  const paused = await glow.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
  console.log(`edge-glow opacity: active(level1)=${active} paused=${paused}`);
  expect(paused, '정지 시 직전 큰 레벨에 고착되지 않고 baseline으로').toBeCloseTo(0.55, 2);
});

// v0.35.0 FIX-6(리뷰 라운드1) — reduced-motion이면 확인 카드(hero) 애니메이션도 정지(EdgeGlow·
//   VoiceWaveform과 일관). 대기 카드의 panel-pulse / hero-primary chip-pop이 'none'이어야 한다.
test('B7 — prefers-reduced-motion 시 hero 카드 애니메이션 정지(FIX-6)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page);
  await startSession(page);

  const card = page.locator('[data-hero-state="listening"]');
  await expect(card).toBeVisible();
  const cardAnim = await card.evaluate((el) => getComputedStyle(el).animationName);
  expect(cardAnim === 'none' || cardAnim === '').toBeTruthy(); // panel-pulse 미적용

  const hero = page.locator('[data-testid="hero-primary"]');
  const heroAnim = await hero.evaluate((el) => getComputedStyle(el).animationName);
  expect(heroAnim === 'none' || heroAnim === '').toBeTruthy(); // chip-pop 미적용

  // edge-glow는 reduced에서 고정 밝기(0.72) — pulse 레이어 애니메이션 없음(기존 계약).
  const pulseAnim = await page.locator('[data-glow-pulse]').evaluate((el) => getComputedStyle(el).animationName);
  expect(pulseAnim === 'none' || pulseAnim === '').toBeTruthy();
  console.log('✓ reduced-motion: hero panel-pulse·chip-pop·edge-pulse 전부 정지');
});

test('B7 — listening 외 상태(일시정지) 무동작: hero 파동 대상 자체가 없다 + 글로우 amber', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await expect(page.locator('[data-testid="hero-primary"]')).toBeVisible();

  // 일시정지 — EdgeGlow(zIndex 54, inset:0)가 컨트롤바 위를 덮고 있으므로, 이 클릭 성공 자체가
  // pointer-events:none 통과 증명이기도 하다(force 미사용).
  await page.locator('button[title="일시정지"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="paused-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="hero-primary"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="edge-glow"]')).toHaveAttribute('data-tone', 'amber');

  // 재시작 → 다시 듣는 중(green) + hero 복귀.
  await page.locator('button[title="재시작"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="hero-primary"]')).toBeVisible();
  await expect(page.locator('[data-testid="edge-glow"]')).toHaveAttribute('data-tone', 'green');
  console.log('✓ 일시정지: hero 파동 대상 제거 + 글로우 amber↔green 전환 + 글로우 아래 버튼 터치 통과');
});

test('B7 — 탭 숨김(visibilityState hidden) 시 레벨 rAF 정지(EdgeGlow), 복귀 시 재개', async ({ page }) => {
  await boot(page);
  await startSession(page);

  await injectLevel(page, 0.3);
  expect(await glowVar(page)).toBe('0.300');

  // visibilityState를 hidden으로 오버라이드 + visibilitychange 발화 → 루프 정지.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(200);
  await injectLevel(page, 0.9);
  await page.waitForTimeout(300);
  expect(await glowVar(page)).toBe('0.300'); // 갱신 없음 = rAF 정지

  // 복귀 → 재개.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  expect(await glowVar(page)).toBe('0.900');
  console.log('✓ hidden 중 --voice-level 동결(rAF 정지) → visible 복귀 시 재개');
});

// ─── B8. Edge glow — 톤 매핑 · 통과 · 레벨 변조 · 비활성 미렌더 ─────────────

test('B8 — 세션 비활성 미렌더 → active green → 이상치 red → 확인 후 green + pointer-events/zIndex', async ({ page }) => {
  await boot(page);

  // ready(세션 전) — 글로우 미렌더(no-op).
  await expect(page.locator('[data-testid="edge-glow"]')).toHaveCount(0);

  await startSession(page);
  const glow = page.locator('[data-testid="edge-glow"]');
  await expect(glow).toHaveAttribute('data-tone', 'green');
  const style = await glow.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { pointerEvents: cs.pointerEvents, zIndex: cs.zIndex, position: cs.position };
  });
  expect(style.pointerEvents).toBe('none');
  expect(style.zIndex).toBe('54');
  expect(style.position).toBe('absolute');
  // green 레이어만 불투명, red/amber 레이어는 투명(크로스페이드 구조 — box-shadow 재페인트 없음).
  const layerOpacity = await glow.evaluate((el) => {
    const get = (t: string) =>
      parseFloat(getComputedStyle(el.querySelector(`[data-glow-layer="${t}"]`)!).opacity);
    return { green: get('green'), amber: get('amber'), red: get('red') };
  });
  expect(layerOpacity.green).toBe(1);
  expect(layerOpacity.amber).toBe(0);
  expect(layerOpacity.red).toBe(0);

  // 직전 100.0 → 120.5 = increase 알람 → red.
  await fireStt(page, '120.5', 700);
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible({ timeout: 3000 });
  await expect(glow).toHaveAttribute('data-tone', 'red');

  // [확인] 터치(글로우가 팝업 버튼을 안 가리고 안 막는다) → 해제 → green 복귀.
  // 고정 타임아웃 대신 관측 결과(팝업 해제)를 먼저 기다린 뒤 톤을 단언한다(비동기 advance 체인과
  // 레이스하던 fixed-wait 제거 — confirmAnomalyTouch가 setAnomalyAlert(null) 후 advance/announceField가
  // 이어져 톤 반영이 500ms를 넘길 수 있었다).
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeHidden();
  await expect(glow).toHaveAttribute('data-tone', 'green');
  console.log('✓ 글로우: ready 미렌더 → green → 이상치 red → 확인 green, pointer-events:none·zIndex 54');
});

test('B8 — micLost(트랙 사망 → clip_empty 래치) 시 글로우 red + 재연결 배너', async ({ page }) => {
  await boot(page);
  await startSession(page);
  const glow = page.locator('[data-testid="edge-glow"]');
  await expect(glow).toHaveAttribute('data-tone', 'green');

  // fake 트랙을 죽인 뒤 이상치 아님 값(감소 — trendRule 'increase'라 미발화)을 커밋:
  // stopClip → 빈 클립 → clip_empty → isStreamLost(ended)=true → micLost 래치.
  await page.evaluate(() => {
    (window as unknown as { __fakeMicTrack: { readyState: string } }).__fakeMicTrack.readyState = 'ended';
  });
  await fireStt(page, '99.5', 700);

  await expect(page.locator('[data-testid="mic-reconnect-btn"]')).toBeVisible({ timeout: 3000 });
  await expect(glow).toHaveAttribute('data-tone', 'red');
  console.log('✓ micLost → 글로우 red(이상치 없이도) + 마이크 재연결 배너');
});

test('B8 — --voice-level로 글로우 강도 변조(레벨 0이어도 톤 표시 유지)', async ({ page }) => {
  await boot(page);
  await startSession(page);
  const glow = page.locator('[data-testid="edge-glow"]');

  await injectLevel(page, 0);
  const base = await glow.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
  await injectLevel(page, 1);
  const loud = await glow.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
  console.log(`glow opacity: level0=${base} level1=${loud}`);
  expect(base).toBeGreaterThan(0.5); // baseline — 레벨 0(프리롤 미가용 폴백)에도 톤은 보인다
  expect(loud).toBeGreaterThan(base + 0.3); // calc(0.6 + level*0.4) 변조
  console.log('✓ 글로우 강도: baseline 유지 + 레벨 변조');
});

// ─── D11b. 계측 — ui_fx 1건(세션 시작) ──────────────────────────────────────

test('D11b — 세션 시작 시 ui_fx:wave=on,glow=on,preroll=<...> 1건(IDB logEvents)', async ({ page }) => {
  await boot(page);
  await startSession(page);
  await page.waitForTimeout(700); // recorder.init() 정착 + IDB fire-and-forget flush

  const uiFx = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const req = indexedDB.open('survey-011');
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    const all = await new Promise<Array<{ extra?: string }>>((res, rej) => {
      const r = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      r.onsuccess = () => res(r.result as Array<{ extra?: string }>);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return all.filter((e) => typeof e.extra === 'string' && e.extra.startsWith('ui_fx:'));
  });
  console.log(`ui_fx events: ${JSON.stringify(uiFx.map((e) => e.extra))}`);
  expect(uiFx.length).toBe(1);
  expect(uiFx[0].extra).toMatch(/^ui_fx:wave=on,glow=on,preroll=(worklet|script|unavailable)$/);
  // headless는 getUserMedia 거부 → preroll=unavailable = 파동 레벨 0 폴백 경로가 계측에 남는다.
  console.log('✓ ui_fx 계측 1건 (wave_stats는 프리롤 가용 기기에서만 — 실기기 로그 확인 항목)');
});
