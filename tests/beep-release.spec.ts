/**
 * v0.35.0 FIX-1(리뷰 라운드1, Vance) — 비프 마스터 GainNode 해제가 실시간 setTimeout이 아니라
 * oscillator `onended` 카운팅으로 이뤄지는지 검증.
 *
 * 가짜 AudioContext를 앱 로드 전에 주입해 connect/disconnect를 계측한다. 설정탭 비프 칩(pos-triad,
 * 세그먼트 3개=osc 3개)을 미리듣기하면: 마스터 1개 + 세그먼트 gain 3개 + osc 3개가 생성되고,
 * **마지막 osc onended 후에만 마스터가 정확히 1회** disconnect돼야 한다(setTimeout 레이스 없음).
 *
 * UI 테스트 서버: `npm run dev -- --port 5175 --strictPort`.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:5175';

// 앱 로드 전에 window.AudioContext를 가짜로 교체(설정탭엔 세션/프리롤이 없어 비프만 이걸 쓴다).
const FAKE_AUDIO = `
(function(){
  window.__beepProbe = { mastersConnected: 0, masterDisconnects: 0, segDisconnects: 0, oscEnded: 0 };
  function Param(){}
  Param.prototype.setValueAtTime = function(){ return this; };
  Param.prototype.exponentialRampToValueAtTime = function(){ return this; };
  function Gain(ctx){ this._ctx = ctx; this.gain = new Param(); this._toDest = false; }
  Gain.prototype.connect = function(dst){ if (dst && dst.__isDest){ this._toDest = true; window.__beepProbe.mastersConnected++; } return dst; };
  Gain.prototype.disconnect = function(){ if (this._toDest) window.__beepProbe.masterDisconnects++; else window.__beepProbe.segDisconnects++; };
  function Osc(ctx){ this._ctx = ctx; this.frequency = new Param(); this.type = 'sine'; this.onended = null; }
  Osc.prototype.connect = function(dst){ return dst; };
  Osc.prototype.start = function(){};
  Osc.prototype.stop = function(t){ var self = this; var ms = Math.max(0, (t - self._ctx.currentTime) * 1000);
    setTimeout(function(){ window.__beepProbe.oscEnded++; if (self.onended) self.onended(); }, Math.min(ms, 400) + 15); };
  Osc.prototype.disconnect = function(){};
  function Analyser(){ this.fftSize = 2048; }
  Analyser.prototype.connect = function(){}; Analyser.prototype.disconnect = function(){}; Analyser.prototype.getByteTimeDomainData = function(){};
  function Ctx(){ this.state = 'running'; this.currentTime = 0; this.destination = { __isDest: true }; }
  Ctx.prototype.createGain = function(){ return new Gain(this); };
  Ctx.prototype.createOscillator = function(){ return new Osc(this); };
  Ctx.prototype.createAnalyser = function(){ return new Analyser(); };
  Ctx.prototype.createMediaStreamSource = function(){ return { connect: function(){}, disconnect: function(){} }; };
  Ctx.prototype.resume = function(){ return Promise.resolve(); };
  Ctx.prototype.close = function(){ return Promise.resolve(); };
  window.AudioContext = Ctx; window.webkitAudioContext = Ctx;
})();
`;

test('FIX-1 — 비프 마스터 GainNode는 마지막 osc onended 후 정확히 1회 해제(setTimeout 레이스 없음)', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await page.addInitScript(FAKE_AUDIO);
  await page.goto(BASE);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);

  const picker = page.locator('[data-testid="beep-picker"]');
  const triad = picker.locator('[data-testid="beep-chip-pos-triad"]'); // 세그먼트 3개
  await triad.scrollIntoViewIfNeeded();
  await triad.click(); // previewBeep(pos-triad) → playSchedule 1회

  // 3개 osc의 onended가 모두 발화할 때까지(각 stop ≤400ms + 15ms) 대기.
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __beepProbe: { oscEnded: number } }).__beepProbe.oscEnded), { timeout: 3000 })
    .toBe(3);
  await page.waitForTimeout(50); // 마지막 onended 콜백의 master.disconnect 반영

  const probe = await page.evaluate(() => (window as unknown as {
    __beepProbe: { mastersConnected: number; masterDisconnects: number; segDisconnects: number; oscEnded: number };
  }).__beepProbe);
  // 마스터 1개 생성 → 정확히 1회 해제(누수 0), 세그먼트 gain 3개 해제, osc 3개 종료.
  expect(probe.mastersConnected).toBe(1);
  expect(probe.masterDisconnects).toBe(1);
  expect(probe.segDisconnects).toBe(3);
  expect(probe.oscEnded).toBe(3);
});
