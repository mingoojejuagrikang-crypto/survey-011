/**
 * v0.47.0 r2 **P3 배선 오라클** — 글라이드가 `ChipZone.tick`에 실제로 물려 있는가.
 *
 * ## 왜 단위 테스트로 부족한가
 * `tests/v0470-r2-chip-glide.spec.ts`는 `chipSweep.ts`의 **순수 산술**만 잰다. 그래서
 * `ChipZone.tsx` 쪽 배선 3개는 **지워도 그 7건이 전부 green이다**:
 *   ① `lastSelfLeft = glided` — 없으면 `onScroll`이 자기쓰기를 사용자로 오판해
 *      `userScrollUntil`을 매 프레임 연장한다 → **글라이드 영구 정지**
 *   ② 진입 프레임의 `lastTs = ts` — 없으면 첫 `dt`가 `ts` 자체라 **즉시 점프**
 *   ③ 매 프레임 `[from, to]` 재실측 — 캐시하면 대역이 움직일 때 엉뚱한 곳으로 간다
 * 그리고 공용 `boot` 픽스처는 `chipSweepSeconds: 0`이라 **레포의 다른 어떤 E2E도 이 코드에
 * 진입하지 않는다.** 이 파일이 그 공백을 메운다.
 *
 * ## 🔴 클릭을 하지 않는다
 * 칩 왕복이 켜진 채 요소를 **클릭**하는 스펙은 Playwright `stable` 대기에서 데드락한다
 * ([TEAMOPS-81]). 여기서는 `page.evaluate`로 `scrollLeft`를 주입하고 시간축으로 관측만 한다 —
 * 클릭이 없으므로 그 축과 무관하다.
 *
 * ## 공허한 green 방지
 * 대역 좁힘(`data-tts-announce` 칩 범위)이 실제로 일어나야 «대역 밖»이 존재한다. 표식이
 * 하나도 없으면 `from=0, to=max`라 밖이 없고 이 테스트는 아무것도 증명하지 못한다.
 * 그래서 ①표식 칩이 섞여 있고 ②대역이 트랙보다 좁다를 **먼저 단언**한다.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, SETTINGS } from './fixtures/activeZones';

test.setTimeout(120_000);

/** 편도 4초 — 대기 축약용(목이 아니라 설정값이다. `v046-chip-sweep`과 같은 수법). */
const SWEEP_SECONDS = 4;

function settingsWithSweep(seconds: number) {
  return { ...SETTINGS, state: { ...SETTINGS.state, chipSweepSeconds: seconds } };
}

/** 대역 좁힘 기하 — 제품과 **같은 산술**로 `[from, to]`를 구한다(`ChipZone.tick` C1 블록). */
async function bandGeometry(page: Page) {
  return page.evaluate(() => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    const chips = Array.from(g.querySelectorAll('[data-testid="column-chip"]')) as HTMLElement[];
    const marked = chips.filter((c) => c.getAttribute('data-tts-announce') === 'true');
    const max = g.scrollWidth - g.clientWidth;
    let from = 0;
    let to = max;
    if (marked.length > 0) {
      const minL = Math.min(...marked.map((c) => c.offsetLeft));
      const maxR = Math.max(...marked.map((c) => c.offsetLeft + c.offsetWidth));
      from = Math.max(0, Math.min(minL, max));
      to = Math.max(from, Math.min(maxR - g.clientWidth, max));
    }
    return { total: chips.length, marked: marked.length, max, from, to };
  });
}

/** `scrollLeft`를 주입한다(사용자가 거기에 손을 뗀 것과 같은 상태를 만든다). */
async function setScrollLeft(page: Page, px: number) {
  await page.evaluate((v) => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    g.scrollLeft = v;
  }, px);
}

/** `count`개의 `scrollLeft` 표본을 `everyMs` 간격으로 모은다. */
async function sample(page: Page, count: number, everyMs: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(await page.evaluate(() => (document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement).scrollLeft));
    await page.waitForTimeout(everyMs);
  }
  return out;
}

test('🔴 배선 — 대역 밖에 손을 뗀 뒤 재개하면 점프하지 않고 등속으로 대역에 든다', async ({ page }) => {
  await boot(page, PHONE_402, { settings: settingsWithSweep(SWEEP_SECONDS), preserveAnimations: true });

  const geo = await bandGeometry(page);
  console.log(`[배선] 칩 ${geo.total}개 중 표식 ${geo.marked}개 · 대역 [${geo.from.toFixed(0)}, ${geo.to.toFixed(0)}] / 트랙 0..${geo.max.toFixed(0)}`);

  // 🔴 공허 방지 — «대역 밖»이 존재해야 이 테스트가 무언가를 증명한다.
  expect(geo.marked, '표식 칩이 있어야 대역 좁힘이 일어난다').toBeGreaterThan(0);
  expect(geo.marked, '표식이 섞여 있어야 대역이 트랙보다 좁다').toBeLessThan(geo.total);
  expect(geo.max, '칩이 실제로 넘쳐야 왕복이 의미를 갖는다').toBeGreaterThan(50);
  expect(geo.from, '대역 왼쪽 밖 공간이 있어야 «밖»에 손을 뗄 수 있다').toBeGreaterThan(20);

  // 대역 **왼쪽 밖**에 손을 뗀 상태를 만든다. scrollLeft 주입은 scroll 이벤트를 내므로
  // 루프가 이를 사용자 활동으로 보고 USER_SCROLL_SETTLE_MS(300ms) 뒤에 재개한다.
  const outside = 0;
  await setScrollLeft(page, outside);
  // 재개 직후를 촘촘히 본다 — 점프는 «한 표본 사이에 대역 안으로 들어가 있다»로 나타난다.
  const samples = await sample(page, 12, 120); // ≈1.4초
  console.log(`[배선] 표본: ${samples.map((s) => s.toFixed(0)).join(' → ')}`);

  // ① 🔴 점프의 부재. 종전 코드였다면 재개 첫 프레임에 `from`(대역 왼쪽 끝)으로 순간 이동해
  //    두 번째 표본부터 이미 대역 안이다. 글라이드면 등속이라 그럴 수 없다.
  //    등속 상한 = range/(seconds*1000) px/ms × 표본 간격. 여유 2배는 표본 지터·rAF 스로틀용.
  const range = geo.to - geo.from;
  const speedPxPerMs = range / (SWEEP_SECONDS * 1000);
  const cap = speedPxPerMs * 120 * 2;
  const jumpDistance = geo.from - outside; // 종전 코드가 한 프레임에 이동했을 거리
  // 🔴 **이 스펙이 점프를 실제로 잡을 수 있는가를 스펙 자신이 검사한다.** 상한이 점프 거리보다
  //    크면 종전 코드도 통과해 버린다 — 그러면 green이 아무것도 증명하지 않는다.
  //    (설정 속도·기기 폭이 바뀌어 이 여유가 사라지면 여기서 먼저 알려준다.)
  expect(
    cap,
    `등속 상한(${cap.toFixed(1)}px)이 종전 점프 거리(${jumpDistance.toFixed(0)}px)보다 크다 — `
    + '이 테스트는 점프를 못 잡는다. SWEEP_SECONDS를 늘리거나 표본 간격을 줄여라',
  ).toBeLessThan(jumpDistance);

  const deltas = samples.slice(1).map((s, i) => Math.abs(s - samples[i]));
  const maxDelta = Math.max(...deltas);
  console.log(`[배선] 최대 표본간 이동 ${maxDelta.toFixed(1)}px (등속×간격×2 = ${cap.toFixed(1)}px · 종전 점프였다면 ${jumpDistance.toFixed(0)}px)`);
  expect(
    maxDelta,
    `표본 사이에 ${maxDelta.toFixed(1)}px 이동 — 등속 상한(${cap.toFixed(1)}px)을 넘었다. `
    + '대역 밖 재개가 여전히 점프한다',
  ).toBeLessThanOrEqual(cap);

  // ② 🔴 «영영 안 움직인다»가 아니다 — `lastSelfLeft` 기록이 빠지면 글라이드가 영구 정지하는데,
  //    ①만 보면 그 상태도 통과한다(이동량 0은 상한 이하다). 실제로 나아갔는지 단언한다.
  const advanced = samples[samples.length - 1] - samples[0];
  expect(
    advanced,
    '글라이드가 전혀 진행하지 않았다 — 자기쓰기 기록(lastSelfLeft)이 빠지면 onScroll이 이를 '
    + '사용자로 오판해 매 프레임 재개를 미룬다(영구 정지)',
  ).toBeGreaterThan(0);
});

/** ③·④ 공용 — 글라이드가 실제로 **진행 중**인 상태를 만든다(대역 왼쪽 밖 0px에서 출발).
 *  반환값은 관측 시점의 위치. 🔴 아직 대역(from)에 못 미쳤는지는 **호출부가 단언**한다 —
 *  글라이드가 이미 끝났다면 `gliding`이 내려가 있어 stale-dt 시나리오 자체가 성립하지 않는다
 *  (버그가 있어도 green = 무판정). */
async function startGlideFromZero(page: Page): Promise<number> {
  await setScrollLeft(page, 0);
  // USER_SCROLL_SETTLE_MS(300ms) + 글라이드 몇 프레임. 고정 대기 후 실측으로 판정한다.
  await page.waitForTimeout(550);
  return page.evaluate(() => (document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement).scrollLeft);
}

/** ③ 🔴 — **`ChipZone.tsx:130` 갈래(`!shouldChipSweep(seconds, max)`)의 `gliding = false`** 오라클.
 *
 *  종전 ⑤-b(`v0470-r2-chip-glide.spec.ts`)는 호출부 전이를 테스트 안에 자기복사해서 제품 줄을
 *  지워도 green이었다(콜드 리뷰 codex 4-4 — 공허-green). 여기는 **실제 DOM**으로 만든다:
 *  글라이드 중 트랙 폭을 키워 오버플로를 없앴다가(`max <= 1` — :130 갈래에 매 프레임 진입)
 *  되돌린다. 그 갈래가 `gliding`을 안 내리면 복원 첫 프레임의 dt에 중단 시간이 통째로 들어가
 *  경계로 점프한다.
 *
 *  ⚠️ 중단 시간(SHRINK_MS)은 제품의 rAF 정지 리셋 상한(800ms — 별개 수정 ④)보다 **짧아야**
 *  한다. 길면 dt 가드가 이 경로를 대신 닫아, :130 반증(`gliding = false` 제거 → red)이
 *  무판정이 된다. 400ms + 왕복 지연이면 그 상한 안에서 점프를 재현하기 충분하다. */
test('③ 🔴 배선 — 글라이드 중 오버플로 소멸·복원(폭 변화)에서 중단 시간이 dt로 누적되지 않는다', async ({ page }) => {
  const SHRINK_MS = 400;
  await boot(page, PHONE_402, { settings: settingsWithSweep(SWEEP_SECONDS), preserveAnimations: true });
  const geo = await bandGeometry(page);
  const range = geo.to - geo.from;
  const speedPxPerMs = range / (SWEEP_SECONDS * 1000);
  const cap = speedPxPerMs * 120 * 2; // 표본 간격 120ms · 지터 여유 2배 (기존 ①과 같은 산식)
  console.log(`[③] 대역 [${geo.from.toFixed(0)}, ${geo.to.toFixed(0)}] · 속도 ${(speedPxPerMs * 1000).toFixed(1)}px/s · cap ${cap.toFixed(1)}px`);

  // 공허 방지 — 종전 코드의 점프(≥ min(speed×SHRINK_MS, from))가 cap보다 커야 이 스펙이 잡는다.
  expect(geo.from, '대역 왼쪽 밖 공간').toBeGreaterThan(20);
  expect(
    Math.min(speedPxPerMs * SHRINK_MS, geo.from),
    `종전 점프 하한이 cap(${cap.toFixed(1)}px) 이하다 — 이 테스트는 점프를 못 잡는다`,
  ).toBeGreaterThan(cap);

  const posBefore = await startGlideFromZero(page);
  expect(posBefore, '글라이드가 실제로 진행 중이다(움직였다)').toBeGreaterThan(0.5);
  expect(posBefore, '아직 대역에 못 미쳤다(글라이드 중이다) — 아니면 무판정').toBeLessThan(geo.from - 2);

  // 오버플로 소멸: 첫 칩만 남기고 **숨긴다** → `scrollWidth - clientWidth <= 1` → :130 갈래.
  //   ⚠️ 트랙 폭을 넓히는 수단은 못 쓴다 — 칩존이 `container-type: size`라 cqw 단위 칩이
  //   컨테이너와 **함께 커져** 오버플로가 안 사라진다(4000px로 넓혔더니 max 10450px — 실측).
  //   React 밖 DOM 직접 변형이라 재렌더·정렬 effect를 건드리지 않고, 브라우저가 scrollLeft를
  //   0으로 clamp하므로 복원 시점 위치는 0(대역 밖)이다.
  const duringShrink = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    const chips = Array.from(g.querySelectorAll('[data-testid="column-chip"]')) as HTMLElement[];
    chips.slice(1).forEach((c) => { c.style.display = 'none'; });
    return { max: g.scrollWidth - g.clientWidth, pos: g.scrollLeft };
  });
  expect(duringShrink.max, '축소 중 오버플로가 실제로 사라졌다(아니면 :130 갈래 미진입 = 무판정)').toBeLessThanOrEqual(1);
  await page.waitForTimeout(SHRINK_MS);
  const pos0 = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    const chips = Array.from(g.querySelectorAll('[data-testid="column-chip"]')) as HTMLElement[];
    chips.forEach((c) => { c.style.display = ''; });
    return g.scrollLeft;
  });

  // 복원 직후를 본다. 점프는 rAF 한 프레임이라 첫 표본 **이전**에 이미 일어났을 수 있다 —
  //   복원 시점 위치(pos0)를 표본 0으로 넣어 그 창까지 델타로 잡는다.
  const samples = [pos0, ...(await sample(page, 12, 120))];
  console.log(`[③] 표본: ${samples.map((s) => s.toFixed(0)).join(' → ')}`);
  const deltas = samples.slice(1).map((s, i) => Math.abs(s - samples[i]));
  const maxDelta = Math.max(...deltas);
  expect(
    maxDelta,
    `복원 후 표본 사이 ${maxDelta.toFixed(1)}px 이동 — 등속 상한(${cap.toFixed(1)}px) 초과. `
    + ':130 갈래가 gliding을 안 내려 중단 시간이 dt로 누적된 점프다',
  ).toBeLessThanOrEqual(cap);
  // 영구 정지가 아니다(0 이동도 위 단언은 통과하므로 별도 확인).
  expect(samples[samples.length - 1] - samples[0], '복원 후 글라이드가 실제로 재개됐다').toBeGreaterThan(0);
});

/** ④ 🔴 — **글라이드 continuation의 dt 상한 가드(`GLIDE_STALL_RESET_MS`)** 오라클.
 *
 *  ③의 갈래들은 tick이 «돌면서» 내리는 문이다 — **rAF 자체가 서 있던** 경우(백그라운드·화면잠금)
 *  는 어떤 갈래도 돌지 않아 :130 수정으로도 안 닫힌다(claude §4b). 여기서는 rAF를 실제로 세운다:
 *  `requestAnimationFrame`을 큐잉 스텁으로 바꿔 콜백을 붙잡았다가(제품 tick이 매 프레임 자기
 *  재예약하므로 첫 프레임에서 즉시 멈춘다) 복원 시 그대로 흘려보낸다 — 제품 코드는 한 줄도
 *  건드리지 않고 «rAF 정지 후 복귀»를 재현한다. 가드가 없으면 복귀 첫 프레임의 dt가 정지 시간
 *  전체(1200ms)가 되어 경계 쪽으로 점프한다. */
test('④ 🔴 배선 — rAF 정지(백그라운드) 중 글라이드였어도 복귀 프레임이 점프하지 않는다', async ({ page }) => {
  const STALL_MS = 1200; // 제품 리셋 상한(800ms)보다 길어야 가드 발동 경로를 지난다
  await boot(page, PHONE_402, { settings: settingsWithSweep(SWEEP_SECONDS), preserveAnimations: true });
  const geo = await bandGeometry(page);
  const range = geo.to - geo.from;
  const speedPxPerMs = range / (SWEEP_SECONDS * 1000);
  const cap = speedPxPerMs * 120 * 2;

  const posBefore = await startGlideFromZero(page);
  expect(posBefore, '글라이드가 실제로 진행 중이다').toBeGreaterThan(0.5);
  expect(posBefore, '아직 대역에 못 미쳤다 — 아니면 무판정').toBeLessThan(geo.from - 2);

  // rAF 정지 — 콜백을 큐에 붙잡는다. 패치 직전에 예약돼 있던 마지막 프레임 하나는 원본으로
  //   발화할 수 있으므로, 동결 위치는 복원 직전에 다시 읽는다(아래 posFrozen).
  await page.evaluate(() => {
    const w = window as unknown as { __rafQ: FrameRequestCallback[]; __rafOrig: typeof requestAnimationFrame };
    w.__rafOrig = window.requestAnimationFrame.bind(window);
    w.__rafQ = [];
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => { w.__rafQ.push(cb); return -1; }) as typeof requestAnimationFrame;
  });
  await page.waitForTimeout(STALL_MS);
  const posFrozen = await page.evaluate(() => {
    const w = window as unknown as { __rafQ: FrameRequestCallback[]; __rafOrig: typeof requestAnimationFrame };
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    const pos = g.scrollLeft;
    window.requestAnimationFrame = w.__rafOrig;
    const q = w.__rafQ;
    w.__rafQ = [];
    for (const cb of q) window.requestAnimationFrame(cb);
    return pos;
  });
  // 공허 방지 — 종전 코드의 복귀 점프(min(speed×STALL_MS, 남은 거리))가 cap보다 커야 잡힌다.
  //   speed×1200 = cap×5이므로 구속 축은 남은 거리다.
  expect(
    Math.min(speedPxPerMs * STALL_MS, geo.from - posFrozen),
    `종전 점프 하한이 cap(${cap.toFixed(1)}px) 이하다 — 정지를 더 일찍 걸어라(무판정)`,
  ).toBeGreaterThan(cap);

  const samples = [posFrozen, ...(await sample(page, 12, 120))];
  console.log(`[④] 동결 ${posFrozen.toFixed(0)}px → 표본: ${samples.slice(1).map((s) => s.toFixed(0)).join(' → ')}`);
  const deltas = samples.slice(1).map((s, i) => Math.abs(s - samples[i]));
  const maxDelta = Math.max(...deltas);
  expect(
    maxDelta,
    `복귀 후 표본 사이 ${maxDelta.toFixed(1)}px 이동 — 등속 상한(${cap.toFixed(1)}px) 초과. `
    + 'rAF 정지 시간이 dt로 누적된 점프다(dt 상한 가드 부재)',
  ).toBeLessThanOrEqual(cap);
  expect(samples[samples.length - 1] - samples[0], '복귀 후 글라이드가 실제로 재개됐다').toBeGreaterThan(0);
});

test('배선 — 대역 안에서 재개할 때는 종전대로 즉시 왕복한다 (글라이드가 정상 경로를 늦추지 않는다)', async ({ page }) => {
  await boot(page, PHONE_402, { settings: settingsWithSweep(SWEEP_SECONDS), preserveAnimations: true });
  const geo = await bandGeometry(page);
  expect(geo.to - geo.from, '대역이 있어야 한다').toBeGreaterThan(10);

  // 대역 **한가운데**에 손을 뗀다 — 글라이드 대상이 아니다.
  const mid = geo.from + (geo.to - geo.from) / 2;
  await setScrollLeft(page, mid);
  const samples = await sample(page, 10, 150);
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  console.log(`[배선-대역안] mid=${mid.toFixed(0)} 표본 범위 ${lo.toFixed(0)}..${hi.toFixed(0)}`);

  // 왕복이 정상적으로 돌고, 대역을 벗어나지 않는다(C1 계약이 글라이드 도입으로 안 깨졌다).
  expect(hi - lo, '재개 후 왕복이 실제로 돈다').toBeGreaterThan(5);
  expect(lo, 'C1 — 대역 왼쪽 끝보다 더 왼쪽으로 가지 않는다').toBeGreaterThanOrEqual(geo.from - 2);
  expect(hi, 'C1 — 대역 오른쪽 끝보다 더 오른쪽으로 가지 않는다').toBeLessThanOrEqual(geo.to + 2);
});
