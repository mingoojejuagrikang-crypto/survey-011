/**
 * v0.47.0 W7 오라클 — **히어로 3초 홀드 진입 · 중앙 탭 해제.** (민구 지시 08-08)
 *
 * > *"화면 중앙 히어로 영역을 사용자가 터치하면 안내음성/문구+진행바와 함께 3초 유지하면
 * >  화면 끔. 화면 꺼진 상태에서 중앙 영역 잠깐이라도 터치하면 화면 켬으로 하자."*
 *
 * `v0460-cr-blackout-escape.spec.ts`는 **갇힘 방지**(탈출 경로가 살아 있는가)를 계속 진다.
 * 이 파일은 **새로 생긴 두 계약**을 진다: 진입 제스처와, 해제의 위치 조건.
 *
 * ## 재는 축
 *  ① 히어로 3초 홀드 → 진입한다. 홀드 중 **문구+진행바**가 뜬다(민구가 명시한 피드백).
 *  ② 🔴 **3초 미만에 떼면 진입하지 않는다.** 오터치 방어가 이 기능의 전제다 — 현장에서
 *     화면이 제멋대로 꺼지면 값이 날아간 것처럼 보인다.
 *  ③ 🔴 **가장자리 탭은 해제하지 않는다.** 08-05에 「두 번 탭」을 기각시킨 근거(*"주머니에서도
 *     두 번 눌린다 — 옷 스침은 연속 접촉"*)가 08-08 확정에서는 **위치 조건**으로 이전됐다.
 *     이 단언이 그 이전의 실체다. 여기가 죽으면 절전 기능이 주머니에서 스스로 켜진다.
 *  ④ 계측이 진입 경로를 가른다(`src:hold` vs 기존 `src:voice`). 두 경로의 사용 비율은
 *     다음 회차의 UI 판단 근거다 — 안 남기면 또 추론이 된다.
 *  ⑧ 🔴 **해제 탭이 하부 UI로 전파되지 않는다**(V-FIX5 · 리뷰 U8이 지목한 오라클 공백).
 *     터치 한 번은 `pointerdown → pointerup → mousedown → mouseup → click`을 낸다. `pointerup`에서
 *     오버레이를 걷으면 뒤따르는 `click`은 **그 자리에 있던 다른 요소로** 간다. 검은 화면 중앙
 *     아래에는 히어로가, 그 아래 트랙에는 종료·일시정지가 산다 — 화면을 켜려던 탭이 세션을
 *     건드리면 사고다. 해제 계측(`screen_on`/`src:tap`)도 여기서 함께 잰다.
 *
 * ## 🔴 안 재는 축
 *  - **갇힘 방지 전반**(키보드 탈출·해제 후 음성 생존) → `v0460-cr-blackout-escape.spec.ts`.
 *  - **iOS `pointercancel`** — Playwright/Chromium은 iOS의 스크롤 전환을 재현하지 않는다.
 *    방어(`touchAction:'none'`)는 코드에 있으나 **기계로 확인되지 않았다**(「미확인」).
 *  - **홀드 중 안내 TTS가 STT에 에코로 들어가는가** — `speech.ts`의 half-duplex 래치가 지는
 *    계약이고 이 파일은 그걸 다시 재지 않는다(그쪽 스코프).
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402 } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** 제품 상수 `HOLD_TO_BLACKOUT_MS`와 같아야 한다. 🔴 **import하지 않는 건 의도다**
 *  (`v0460-g-dot-pill`과 같은 계약): 제품이 값을 바꾸면 계약은 여기 남아 오라클이 신호를 낸다. */
const HOLD_MS = 3000;

const overlay = (page: Page) => page.locator('[data-testid="blackout-overlay"]');
const heroSurface = (page: Page) => page.locator('[data-testid="hero-hold-surface"]');

/** 히어로 표면 중앙을 `ms` 동안 누른다. */
async function holdHero(page: Page, ms: number) {
  const box = await heroSurface(page).boundingBox();
  if (!box) throw new Error('hero-hold-surface 박스를 얻지 못했다 — hero 분기 미도달(무판정)');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** 🔴 V-FIX1 오라클용 — **엔진에 실제로 들어간 발화 문자열을 기록한다.**
 *
 *  왜 로그가 아니라 엔진인가: 우리가 재려는 것은 *"이 문장이 스피커로 나갔는가"* 이고, 그게
 *  곧 *"STT가 자기 안내를 받아 적을 수 있는가"* 다. 앱 로그는 그 사실을 안 남긴다.
 *  공용 mock의 `speak`를 감싸 `__utterances`에 쌓는다(mock 자체는 건드리지 않는다 —
 *  `tests/fixtures/stt.ts`는 다른 레인도 쓰는 공용물이다). */
const RECORD_UTTERANCES = `(() => {
  const w = window;
  if (w.__utterances) return;
  w.__utterances = [];
  const synth = w.speechSynthesis;
  const orig = synth.speak.bind(synth);
  synth.speak = function (u) { w.__utterances.push(String(u && u.text || '')); return orig(u); };
})()`;

async function utterances(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __utterances?: string[] }).__utterances ?? []);
}

/** 홀드 안내 문구(제품 `HOLD_LINES`의 결합형과 같아야 한다 — 상수를 import하지 않는 건 의도다). */
const HOLD_TTS = '계속 누르면 화면을 끕니다. 음성 입력은 계속됩니다.';
/** 제품 `HOLD_TTS_DELAY_MS`와 같아야 한다. */
const HOLD_TTS_DELAY_MS = 400;

interface LoggedEvent { type: string; parsed?: string; extra?: string }

async function screenLogs(page: Page, parsed: 'screen_off' | 'screen_on'): Promise<LoggedEvent[]> {
  const all = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => res([]);
    }) as Promise<LoggedEvent[]>;
  });
  return all.filter((e) => e.parsed === parsed);
}

test('① 히어로 3초 홀드로 진입한다 + 홀드 중 문구·진행바가 뜬다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await expect(overlay(page), '전제: 시작은 검은 화면이 아니다').toHaveCount(0);

  const box = await heroSurface(page).boundingBox();
  if (!box) throw new Error('hero-hold-surface 미존재 — 무판정');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  // 민구가 명시한 피드백 — *"안내음성/문구+진행바와 함께"*. 진행바가 없으면 사용자는
  //   3초가 얼마나 남았는지 모른 채 손가락을 떼고 "안 된다"고 판단한다.
  await expect(page.locator('[data-testid="hero-hold-cue"]'), '홀드 중 안내 문구').toBeVisible({ timeout: 1500 });
  // 🔴 V-FIX2(리뷰 U10) — **화면 문구와 TTS가 글자까지 같다.** 상수는 배열 SSOT 하나로 묶여
  //    있지만 «렌더»는 별개다 — 두 줄 중 하나를 떨어뜨리는 리팩토링은 상수만 봐서는 안 잡힌다.
  //    (*"계약이 지켜지는지 확인하는 테스트가 없다면 그 계약은 주석일 뿐이다"* — v043-typo-contract)
  const shownHint = (await page.locator('[data-testid="hero-hold-hint"]').innerText())
    .replace(/\s+/g, ' ').trim();
  expect(shownHint, 'V-FIX2 — 화면 문구가 TTS와 글자까지 같아야 한다').toBe(HOLD_TTS);
  // 🔴 «진행바가 보인다»는 **트랙**으로 잰다 — 채움(fill)은 0%일 때 폭 0이라 Playwright가
  //    hidden으로 읽는다. V-FIX3b 이후 0%는 정상 상태이므로 fill 가시성은 계약이 아니다.
  await expect(page.locator('[data-testid="hero-hold-track"]'), '진행바 트랙').toBeVisible();
  const fill = page.locator('[data-testid="hero-hold-fill"]');
  // ⚠️ V-FIX3b 이후 표시는 «눌렸는가»로 뜨므로 **첫 프레임의 진행값은 0이 정상**이다.
  //    「차오른다」는 값 하나가 아니라 **증가**로 재야 한다(단발 읽기는 flaky를 만든다).
  await expect
    .poll(async () => Number(await fill.getAttribute('data-progress')), { timeout: 2000 })
    .toBeGreaterThan(0);
  const mid = Number(await fill.getAttribute('data-progress'));
  expect(mid, '아직 3초가 안 됐으므로 1 미만').toBeLessThan(1);

  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
  await expect(
    overlay(page),
    '3초를 유지했는데 화면이 안 꺼진다 — 진입 경로가 음성 하나로 돌아간 것이다',
  ).toBeVisible({ timeout: 3000 });
});

test('② 🔴 3초 미만에서 떼면 진입하지 않는다 (오터치 방어가 전제다)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  await holdHero(page, Math.floor(HOLD_MS * 0.4));
  await page.waitForTimeout(HOLD_MS); // 남은 시간이 흘러도 진입하면 안 된다(타이머 잔존 확인)
  await expect(
    overlay(page),
    '중도 이탈로 화면이 꺼진다 — 현장에서 값이 날아간 것처럼 보인다',
  ).toHaveCount(0);
  // 취소는 무동작이지 「나중에 발화」가 아니다 — 계측에도 안 남아야 한다.
  expect(await screenLogs(page, 'screen_off'), '취소된 홀드가 screen_off를 남기면 안 된다').toHaveLength(0);
});

test('③ 🔴 검은 화면 — 중앙 탭은 켜고, 가장자리 탭은 무시한다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await fireStt(page, '화면', 600);
  await expect(overlay(page)).toBeVisible({ timeout: 4000 });

  // 가장자리 — 히트존(가로 60%×세로 50% 중앙)의 밖. 402×874에서 좌우 여백 각 80px.
  await page.mouse.click(12, 12);
  await page.waitForTimeout(300);
  await expect(
    overlay(page),
    '가장자리 탭으로 풀린다 — 주머니·팔 스침으로 화면이 켜져 절전이 무의미해진다',
  ).toBeVisible();

  await page.mouse.click(24, 500); // 세로 중앙이지만 가로는 가장자리 — 두 축이 함께 걸린다
  await page.waitForTimeout(300);
  await expect(overlay(page), '가로 가장자리도 무시한다').toBeVisible();

  // 중앙 — *"잠깐이라도 터치하면"* 이므로 **짧은 탭**으로 풀려야 한다.
  await page.locator('[data-testid="blackout-center-hit"]').click();
  await expect(
    overlay(page),
    '중앙을 탭했는데 안 켜진다 — 탈출 경로가 이것뿐이라 사용자가 앱에 갇힌다',
  ).toBeHidden({ timeout: 3000 });
});

/** 🔴 V-FIX1ⓐ+ⓑ (이중 콜드 리뷰 blocker) — 스침 오터치는 **발화 자체를 만들지 않는다.**
 *  종전에는 `pointerdown` 즉시 전문을 발화했고 조기 해제로도 취소되지 않아, barge-in OFF에서
 *  ~4초 인식 공백이 났다. */
test('⑤ 🔴 400ms 전에 떼면 홀드 안내가 **발화되지 않는다** (V-FIX1ⓐⓑ)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await page.evaluate(RECORD_UTTERANCES);

  await holdHero(page, Math.floor(HOLD_TTS_DELAY_MS * 0.5)); // 200ms — 지연 임계 전
  await page.waitForTimeout(1200); // 예약이 살아 있었다면 이 창에서 터진다
  expect(
    (await utterances(page)).filter((t) => t === HOLD_TTS),
    '스침 오터치가 안내를 발화한다 — barge-in OFF에서 그만큼 인식이 죽는다',
  ).toHaveLength(0);
  await expect(overlay(page), '전제: 진입도 하지 않았다').toHaveCount(0);
});

/** 🔴 V-FIX1ⓒ — **다른 TTS가 재생·큐잉 중이면 홀드 안내를 큐에 세우지 않는다.**
 *  `speech.ts`의 뮤트가 depth가 아니라 boolean이라(`:196`·`:620`·`:658`) 앞 발화가 끝나는 순간
 *  뮤트가 풀리고, 뒤이어 재생되는 이 문장을 STT가 받아 적을 수 있다. `text` 컬럼이면 파서가
 *  원문을 유효값으로 받아 **앱 안내가 시트 값으로 커밋된다** — 데이터 무결성 사고다. */
test('⑥ 🔴 TTS 재생·큐잉 중에는 홀드 안내를 큐잉하지 않는다 (V-FIX1ⓒ)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await page.evaluate(RECORD_UTTERANCES);
  // 공용 mock은 `speaking`/`pending`을 항상 false로 두므로(고정 필드) 재생 중 상태를 여기서 세운다.
  //   🔴 mock 파일을 고치지 않는다 — 그 플래그는 `handleFinal`의 STT 무시 경로도 읽으므로
  //   전역으로 바꾸면 다른 레인의 스펙 판정이 조용히 달라진다.
  await page.evaluate(() => { (window.speechSynthesis as unknown as { speaking: boolean }).speaking = true; });

  await holdHero(page, HOLD_TTS_DELAY_MS + 900); // 지연 임계를 넘겨 발화 시점을 확실히 지난다
  expect(
    (await utterances(page)).filter((t) => t === HOLD_TTS),
    'TTS 재생 중인데 홀드 안내가 큐에 섰다 — 앞 발화 종료가 뮤트를 먼저 풀어 STT 자기입력이 열린다',
  ).toHaveLength(0);
});

/** V-FIX3(리뷰 U11) — `prefers-reduced-motion: reduce`에서 진행 표현이 **저빈도 계단**이 되고,
 *  **홀드 시간 판정은 그대로**다. 「reduce면 아무것도 안 그린다」로 가지 않은 이유는 위치 기반
 *  진입에서 피드백이 사라지면 *"왜 안 꺼지지"* 가 되기 때문이다. */
test('⑦ reduced-motion — 진행 표현은 0.25 계단, 3초 판정은 불변 (V-FIX3)', async ({ page }) => {
  await boot(page, PHONE_402);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await waitForTtsIdle(page);

  const box = await heroSurface(page).boundingBox();
  if (!box) throw new Error('hero-hold-surface 미존재 — 무판정');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  // 🔴 V-FIX3b(2차 재검증) — **즉시** 떠야 한다. reduce의 첫 계단은 750ms 뒤이고 안내 TTS는
  //    400ms 뒤라, 표시가 진행값에 묶여 있으면 «소리는 나는데 화면은 그대로»인 구간이 생긴다.
  //    300ms 안에 못 뜨면 그 회귀다(400·750 둘 다보다 앞이라 두 축을 한 번에 가른다).
  const fill = page.locator('[data-testid="hero-hold-fill"]');
  await expect(
    page.locator('[data-testid="hero-hold-cue"]'),
    'reduce에서 시각 피드백이 늦다 — 안내 TTS가 화면보다 먼저 온다',
  ).toBeVisible({ timeout: 300 });
  await expect(
    page.locator('[data-testid="hero-hold-track"]'),
    'reduce에서도 진행 피드백 자체는 남는다(트랙으로 잰다 — 0% 채움은 폭 0이라 hidden이다)',
  ).toBeVisible({ timeout: 300 });
  // 여러 번 읽어도 0.25 배수만 나온다 = 연속 애니메이션이 아니다.
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    seen.add(String(await fill.getAttribute('data-progress')));
    await page.waitForTimeout(120);
  }
  const offGrid = [...seen].filter((v) => Math.abs(Number(v) * 4 - Math.round(Number(v) * 4)) > 1e-6);
  expect(offGrid, `reduce인데 0.25 격자 밖 값이 나왔다(연속 애니메이션) — ${[...seen].join(',')}`).toEqual([]);

  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
  await expect(
    overlay(page),
    'reduce에서 3초 판정이 늦어졌다 — 시각 표현만 바꾸는 계약이 깨졌다',
  ).toBeVisible({ timeout: 2000 });
});

test('④ 계측 — 홀드 진입은 src:hold, 음성 진입은 src:voice로 갈린다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  await holdHero(page, HOLD_MS + 400);
  await expect(overlay(page)).toBeVisible({ timeout: 3000 });
  await page.locator('[data-testid="blackout-center-hit"]').click();
  await expect(overlay(page)).toBeHidden({ timeout: 3000 });

  await waitForTtsIdle(page);
  await fireStt(page, '화면', 600);
  await expect(overlay(page)).toBeVisible({ timeout: 4000 });

  const logs = await screenLogs(page, 'screen_off');
  expect(logs.map((e) => e.extra), '두 진입이 같은 이벤트에 출처만 다르게 남는다')
    .toEqual(['src:hold', 'src:voice']);
  // 새 이벤트 타입을 만들지 않았다는 확인 — SOP-003 파서 계약(기존 command/screen_off 그대로).
  expect(logs.every((e) => e.type === 'command')).toBe(true);
});

/** 🔴 V-FIX5 (리뷰 U8 — 오라클 공백) — 해제 탭이 **하부 UI로 새지 않는다** + 해제 계측.
 *
 *  ## ⚠️ 「고스트 클릭이 실제로 나는가」는 여기서 못 잰다 — 그래서 **기제를 잰다**
 *  초안은 «`.click()` 후 window 버블 청취자에 click이 안 잡힌다»로 썼는데, **반증 확인에서
 *  죽었다**: `swallowGhostClick()`를 지워도 green이었다. 이유는 Chromium에서 `pointerup`이
 *  discrete 이벤트라 React가 **동기 flush**로 오버레이를 걷고, 브라우저가 그 뒤 `click`을
 *  만들 때 down/up 타깃이 이미 분리돼 **click 자체가 발생하지 않기** 때문이다.
 *  즉 이 환경에는 막을 고스트가 없고, 그 위에 세운 단언은 **공허한 green**이었다.
 *  (진짜 고스트 클릭은 iOS 터치 경로의 산물이라 여기서 재현 불가 — 실기기 MONITORING 축.)
 *
 *  👉 그래서 **차단막 자체의 계약**을 결정론적으로 잰다: 해제 직후 창 안에서
 *   ① 첫 click은 **먹힌다**(캡처 단계에서 stopPropagation → 버블 청취자에 안 온다)
 *   ② 두 번째 click은 **통과한다** — 차단막이 «정확히 한 번»만 먹고 물러난다는 계약.
 *     🔑 ②가 없으면 400ms 사각지대가 무한이 되는 회귀를 못 잡는다. 장갑 낀 현장에서
 *     «화면 켜고 바로 누른 버튼이 안 먹는다»가 되는 축이 정확히 여기다.
 *  🔴 이벤트는 `document.body`에 쏜다 — `window`에 직접 쏘면 at-target 단계라 캡처/버블이
 *     **등록 순서**로 섞여 판정이 무의미해진다. */
test('⑧ 🔴 해제 탭 차단막 — 첫 click은 먹고 두 번째는 통과 + screen_on(src:tap) (V-FIX5)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await fireStt(page, '화면', 600);
  await expect(overlay(page)).toBeVisible({ timeout: 4000 });

  await page.evaluate(() => {
    const w = window as unknown as { __leakedClicks: number };
    w.__leakedClicks = 0;
    window.addEventListener('click', () => { w.__leakedClicks += 1; }, false); // 버블 단계
  });

  await page.locator('[data-testid="blackout-center-hit"]').click();
  await expect(overlay(page)).toBeHidden({ timeout: 3000 });

  const [firstLeaked, secondLeaked] = await page.evaluate(() => {
    const w = window as unknown as { __leakedClicks: number };
    const fire = () => document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const before = w.__leakedClicks;
    fire();
    const afterFirst = w.__leakedClicks;
    fire();
    return [afterFirst - before, w.__leakedClicks - afterFirst];
  });
  expect(
    firstLeaked,
    '해제 직후 첫 click이 하부로 샌다 — 검은 화면 아래 종료·일시정지 버튼을 때릴 수 있다',
  ).toBe(0);
  expect(
    secondLeaked,
    '차단막이 두 번째 click까지 먹는다 — 400ms 사각지대가 넓어져 «버튼이 안 먹는다»가 된다',
  ).toBe(1);

  // 하부가 실제로 멀쩡한지 상태로도 확인한다(이벤트 수만 보면 «다른 경로로 눌렸다»를 놓친다).
  await expect(page.locator('[data-testid="voice-active-state"]'), '세션 화면 유지').toBeVisible();
  await expect(page.locator('[data-testid="exit-confirm-inline"]'), '종료 확인이 뜨지 않았다').toHaveCount(0);
  await expect(page.locator('[data-testid="paused-card"]'), '일시정지되지 않았다').toHaveCount(0);

  const on = await screenLogs(page, 'screen_on');
  expect(on.map((e) => e.extra), '해제도 진입과 대칭으로 계측된다 — 체류 시간 계산의 전제').toEqual(['src:tap']);
  expect(on.every((e) => e.type === 'command'), '새 이벤트 타입을 만들지 않았다').toBe(true);
});
