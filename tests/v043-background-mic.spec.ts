/**
 * v0.43.0 #4 — **앱 이탈 시 마이크**(plan §3-3) 회귀.
 *
 * 결함(07-30 실기기): 세션 중 백그라운드로 들어가면 iOS가 트랙을 `muted`로 만드는데
 *   `bg_enter_snapshot:rec=recording,track=muted,stt=listening` — **녹음과 STT는 계속 돌고
 *   소리만 안 들어왔다.** 클립 에러 5건(`clip_too_small` 3 · `clip_empty` 2)이 전부 그 구간에
 *   몰려 있다. 앱이 할 일은 ① 그 사실을 알고 ② 헛도는 녹음·STT를 멈추고 ③ 복귀 시 되살리는 것.
 *
 * 오라클:
 *   A 진입 — 트랙 캡처가 실제로 꺼지고(`enabled=false`) STT가 멈춘다. 배경 발화는 커밋되지 않는다.
 *   B 복귀 — 캡처가 되살아나고(`enabled=true`) STT가 복원되며 **안내가 정확히 1회** 나간다.
 *   C 🔴 안내는 백그라운드 복귀 **전용**이다 — 개선요청 모달을 닫을 때는 나가지 않는다.
 *     (resume의 컨트롤러 생성부가 모든 모달과 **공유**되므로 원샷 플래그 없이는 매번 발화한다.)
 *   D 중지를 **실제로 수행하지 않았으면** 안내가 없다(세션 미가동). 캡처 복구는 그래도 돈다.
 *   E 🔴 백그라운드 중 세션 경계(`clearUiSuspendLatch`)가 지나가면 안내 예약이 **폐기**된다.
 *     안 그러면 래치가 비어 resume이 조기 반환하고, 플래그가 살아남아 **다음 모달에서 발화**한다.
 *
 * ⛔ **`track.stop()`이 아니라 `track.enabled` 토글이다**([IOS-5]) — iOS는 재획득에 사용자
 *   제스처를 요구해 복귀 자동 재개가 구조적으로 불가능해진다. A/B가 그 축을 직접 본다.
 *
 * 🔑 **가짜 마이크가 필요하다.** 이 환경의 `getUserMedia`는 실패한다(다른 스펙의 `clip_no_stream`이
 *   그 증거) — 그러면 트랙이 없어 `enabled`를 관찰할 축 자체가 사라진다. `AudioContext`의
 *   `MediaStreamDestination`으로 **진짜 `MediaStreamTrack`** 을 만들어 주입한다(가짜 장치 플래그
 *   불필요, `enabled` 시맨틱은 네이티브 그대로).
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다([ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, waitForTtsIdle, ttsLog } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'survey-011-settings-v3';

/** plan §3-3의 안내 문구(민구 확정). useVoiceSession의 BG_RESUME_MESSAGE와 글자 일치해야 한다. */
const BG_MSG = '자리를 비운 동안 입력이 중지됐습니다. 다시 시작합니다.';

const SETTINGS = {
  state: {
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_BGMIC_1/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_BGMIC_1', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true, totalRows: 3,
    ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'bg-mic', noisyMode: false, preferredVoiceName: '',
  },
  version: 12,
};

/** 🔑 진짜 MediaStreamTrack을 돌려주는 가짜 마이크. 호출마다 새 destination을 만들어
 *  앱의 `stopAllTracks(dispose)`가 다음 획득을 오염시키지 않게 한다. */
const FAKE_MIC_SCRIPT = `
(function() {
  window.__micTracks = [];
  var ac = null;
  var real = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null;
  if (!navigator.mediaDevices) return;
  navigator.mediaDevices.getUserMedia = function(constraints) {
    if (!constraints || !constraints.audio) return real ? real(constraints) : Promise.reject(new Error('no audio'));
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      var dest = ac.createMediaStreamDestination();
      var t = dest.stream.getAudioTracks()[0];
      window.__micTracks.push(t);
      return Promise.resolve(dest.stream);
    } catch (e) {
      return Promise.reject(e);
    }
  };
})();
`;

async function loadLogEvents(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{ type: string; parsed?: string; extra?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; parsed?: string; extra?: string }>);
      req.onerror = () => res([]);
    });
  });
}

/** `bg_mic` 이벤트의 extra 목록(방출 순서 그대로). */
async function bgMicExtras(page: Page): Promise<string[]> {
  return (await loadLogEvents(page))
    .filter((e) => e.parsed === 'bg_mic')
    .map((e) => e.extra ?? '');
}

/** 안내가 몇 번 발화됐는가. TTS 목이 문구를 그대로 적재한다. */
async function announceCount(page: Page): Promise<number> {
  return (await ttsLog(page)).filter((t) => t === BG_MSG).length;
}

/** 첫 번째 마이크 트랙의 `enabled`. 트랙이 없으면 null(= 관찰 불가, false와 구분한다). */
async function trackEnabled(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const tracks = (window as unknown as { __micTracks?: MediaStreamTrack[] }).__micTracks ?? [];
    return tracks.length ? tracks[tracks.length - 1].enabled : null;
  });
}

/** Playwright에는 탭 숨김 API가 없다 — visibilityState를 덮고 이벤트를 직접 디스패치한다. */
async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function clickMounted(page: Page, selector: string): Promise<void> {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!(el instanceof HTMLElement)) throw new Error(`mounted control not found: ${s}`);
    el.click();
  }, selector);
}

async function waitForActiveChip(page: Page, colName: string, timeout = 6000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  );
}

/** 세션을 시작하지 않고 입력탭까지만 간다(prewarm으로 레코더·트랙은 이미 확보된다). */
async function bootIdle(page: Page, settings = SETTINGS) {
  await page.addInitScript({ content: FAKE_MIC_SCRIPT });
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('survey-011');
    },
    { s: settings, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
}

async function startSession(page: Page) {
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await waitForActiveChip(page, '횡경');
  await waitForTtsIdle(page);
}

async function boot(page: Page, settings = SETTINGS) {
  await bootIdle(page, settings);
  await startSession(page);
}

// ─── A: 진입 — 캡처가 실제로 꺼지고 STT가 멈춘다 ────────────────────────────────────────
test('A — hidden 진입 시 트랙 캡처가 꺼지고(enabled=false) STT가 멈춘다(배경 발화 미커밋)', async ({ page }) => {
  await boot(page);
  // 가짜 마이크가 실제로 물렸는지부터 확인한다 — 안 물렸으면 이 스펙 전체가 무의미한 통과다.
  expect(await trackEnabled(page), '가짜 마이크 트랙이 확보돼야 관찰이 성립한다').toBe(true);

  await setVisibility(page, 'hidden');

  await expect.poll(() => bgMicExtras(page), { timeout: 4000 })
    .toEqual(['edge=enter,stt=stopped,capture=off']);
  // ⛔ stop()이 아니라 enabled 토글이다 — 트랙은 살아 있어야 복귀 자동 재개가 가능하다([IOS-5]).
  expect(await trackEnabled(page)).toBe(false);
  expect(await page.evaluate(() => {
    const tracks = (window as unknown as { __micTracks?: MediaStreamTrack[] }).__micTracks ?? [];
    return tracks[tracks.length - 1].readyState;
  }), 'track.stop()을 쓰면 ended가 된다 — 그러면 복귀 재개가 불가능해진다').toBe('live');

  // 백그라운드에서 들어온 발화는 값이 되지 않는다(07-30 구간에서 STT가 계속 돌던 축).
  await fireStt(page, '33.3', 600);
  const committed = (await loadLogEvents(page)).filter((e) => e.type === 'value');
  expect(committed, '백그라운드 발화가 셀에 커밋되면 안 된다').toHaveLength(0);
});

// ─── B: 복귀 — 캡처 복원 + STT 복원 + 안내 1회 ──────────────────────────────────────────
test('B — visible 복귀 시 캡처가 살아나고 STT가 복원되며 안내가 정확히 1회 나간다', async ({ page }) => {
  await boot(page);
  await setVisibility(page, 'hidden');
  await expect.poll(() => trackEnabled(page), { timeout: 4000 }).toBe(false);
  expect(await announceCount(page), '백그라운드에서는 안내가 나갈 수 없다(iOS가 막는다)').toBe(0);

  await setVisibility(page, 'visible');

  await expect.poll(() => bgMicExtras(page), { timeout: 4000 })
    .toEqual(['edge=enter,stt=stopped,capture=off', 'edge=return,stt=restored,capture=on']);
  expect(await trackEnabled(page)).toBe(true);

  // 🔑 안내는 **"재개 성공"** 에 걸린다 — 인식기의 onStart다([MIC-B2]: 복귀 32.5초 뒤
  //   audio-capture 오류가 난 전례라 "시도" 시점 안내는 거짓말이 된다).
  await expect.poll(() => announceCount(page), { timeout: 5000 }).toBe(1);

  // 복원된 인식기로 값이 다시 들어간다(복원이 말뿐이 아님).
  await waitForTtsIdle(page);
  await fireStt(page, '33.3', 600);
  await expect.poll(
    async () => (await loadLogEvents(page)).filter((e) => e.type === 'value').length,
    { timeout: 4000 },
  ).toBe(1);
});

// ─── C: 🔴 안내는 백그라운드 전용 — 모달을 닫을 때는 나가지 않는다 ──────────────────────────
test('C — 개선요청 모달을 닫아도 안내가 나가지 않는다(resume 컨트롤러 생성부 공유 축)', async ({ page }) => {
  await boot(page);

  // ① 백그라운드 왕복 전에 모달만 열고 닫는다 — 여기서 발화하면 원샷 플래그가 없는 것이다.
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  await page.waitForTimeout(600);
  expect(await announceCount(page), '백그라운드를 겪지 않은 모달 복귀는 안내 대상이 아니다').toBe(0);

  // ② 백그라운드 왕복 — 여기서만 1회.
  await setVisibility(page, 'hidden');
  await expect.poll(() => trackEnabled(page), { timeout: 4000 }).toBe(false);
  await setVisibility(page, 'visible');
  await expect.poll(() => announceCount(page), { timeout: 5000 }).toBe(1);

  // ③ 그 뒤 다시 모달을 열고 닫아도 **늘지 않는다**(플래그가 소비됐다).
  await waitForTtsIdle(page);
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await announceCount(page)).toBe(1);
});

// ─── D: 중지를 실제로 수행하지 않았으면 안내가 없다 ─────────────────────────────────────
test('D — 세션 미가동 왕복에는 안내가 없다(stt=noop). 캡처 복구는 그래도 돈다', async ({ page }) => {
  await bootIdle(page); // 세션 시작 없음 — prewarm으로 트랙만 확보된 상태
  expect(await trackEnabled(page), 'prewarm이 트랙을 확보해야 이 테스트가 성립한다').toBe(true);

  await setVisibility(page, 'hidden');
  await expect.poll(() => trackEnabled(page), { timeout: 4000 }).toBe(false);
  await setVisibility(page, 'visible');

  await expect.poll(() => bgMicExtras(page), { timeout: 4000 })
    .toEqual(['edge=enter,stt=stopped,capture=off', 'edge=return,stt=noop,capture=on']);
  // 🔑 복원할 인식기가 없었으므로 "다시 시작합니다"는 거짓말이다 — 나가면 안 된다.
  expect(await announceCount(page)).toBe(0);
  // 🔴 캡처 복구는 STT 복원 여부와 **무관하게** 돈다. 안 그러면 트랙이 꺼진 채 남아
  //   다음 세션이 조용히 무음을 녹음한다.
  expect(await trackEnabled(page)).toBe(true);
});

// ─── E: 🔴 백그라운드 중 세션 경계가 지나가면 안내 예약이 폐기된다 ────────────────────────
test('E — 백그라운드 중 세션 시작(clearUiSuspendLatch)이 안내 예약을 폐기한다', async ({ page }) => {
  await bootIdle(page);

  // hidden에서 suspend가 걸려 안내가 예약된다(래치 reasons = {app_background}).
  await setVisibility(page, 'hidden');
  await expect.poll(() => trackEnabled(page), { timeout: 4000 }).toBe(false);

  // 🔑 hidden인 채로 세션을 시작한다 → start()의 clearUiSuspendLatch('start')가 래치를 통째로
  //   비운다. 그러면 아래 visible의 resume은 **조기 반환**해 플래그를 소비할 주체가 사라진다.
  //   플래그를 여기서 함께 끄지 않으면 살아남아 **다음 모달을 닫을 때 발화한다.**
  await startSession(page);
  await setVisibility(page, 'visible');
  await page.waitForTimeout(600);
  expect(await announceCount(page), '복원된 것이 없으므로 안내 대상이 아니다').toBe(0);

  // 다음 모달에서도 새어 나오지 않는다 — 이게 실제 누출 경로다.
  await clickMounted(page, '[data-testid="tab-feedback"]');
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await announceCount(page), '세션 경계를 넘어 살아남은 예약이 있으면 여기서 터진다').toBe(0);
});

// ─── F: 짧은 전환 — 현행 동작을 정직하게 고정한다(해석 (a)) ─────────────────────────────
test('F — 세션 중 짧은 왕복에도 안내가 나간다(해석 (a) 고정 — (b)를 원하면 시간 임계가 필요하다)', async ({ page }) => {
  // 🔴 **검수 기준의 두 번째 반증 축이다** — 브리핑 §3: *"짧은 전환에는 안내가 안 나가는지."*
  //   그런데 처방(plan §3-3)이 말하는 억제 조건은 *"중지를 **실제로 수행**했을 때만 안내한다"*
  //   뿐이다. 이 둘은 갈린다:
  //     (a) **수행 여부** 기준 — 세션이 돌고 있었으면 200ms 왕복에도 suspend가 실제로 도므로
  //         안내가 나간다. 원샷 플래그로 자연히 충족되고 **임계값이 필요 없다**.
  //     (b) **체류 시간** 기준 — 그걸 막으려면 시간 임계(예: 1.5초 미만 무안내)가 필요한데
  //         **처방에 없다.** 임의로 넣으면 처방 이탈이다.
  //   → 처방에 있는 것만 집행해 (a)로 갔다(코더→Larry 질의, 2026-07-31, 미회신).
  //   이 테스트는 그 선택의 **결과를 명시적으로 박제**한다 — 침묵하면 리뷰어가 "짧은 전환
  //   억제가 구현됐다"고 오독한다. (b)가 확정되면 **이 단언을 0으로 뒤집고** 임계를 얹으면 된다.
  //   (#3-2 착수 전 `failReason.toBeNull()`을 고정해 둔 것과 같은 패턴.)
  await boot(page);

  await setVisibility(page, 'hidden');
  await expect.poll(() => trackEnabled(page), { timeout: 4000 }).toBe(false);
  await setVisibility(page, 'visible'); // 체류 시간 사실상 0 — 최단 왕복

  await expect.poll(() => bgMicExtras(page), { timeout: 4000 })
    .toEqual(['edge=enter,stt=stopped,capture=off', 'edge=return,stt=restored,capture=on']);
  await expect.poll(() => announceCount(page), { timeout: 5000 }).toBe(1);
});
