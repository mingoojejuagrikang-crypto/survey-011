/**
 * v0.47.0 W3(FB-D, 민구 08-08) — **칩존 왕복 ↔ 사용자 스크롤 공존** 오라클.
 *
 * 실기기 재현(FB-D): iOS는 터치가 네이티브 스크롤로 전환되는 순간 `pointercancel`을 쏘고,
 * 종전 코드는 이를 '뗌'으로 해석 → 드래그 중 rAF 루프가 매 프레임 scrollLeft를 덮어써
 * 「밀리지 않거나 스냅백」. 처방: '사용자 조작 중' 판정을 scroll 활동 기반으로 보강
 * (자기쓰기 = 마지막 대입값 ±1px 비교 · 마지막 사용자 scroll 후 300ms 디바운스 · 재개는
 * 현재 위치에서 — C4).
 *
 * 재는 축:
 *  ① 🔴 **사용자 스크롤 중 루프 억제** — 위치가 루프 반향이 아닌 scroll 이벤트(= 사용자)가
 *     이어지는 동안 루프는 덮어쓰지 않는다(종전엔 매 프레임 되끌었다 — FB-D의 실체).
 *  ② **재개는 「지금 보이는 자리」에서**(민구 C4) — 조용해진 뒤 움직임은 드래그 종점
 *     근방에서 시작한다(위상 점프 없음).
 *  ③ **pointercancel 후에도 왕복은 죽지 않는다** — cancel 뒤 scroll 이벤트가 없어도
 *     디바운스 뒤 재개(0c9f4ea가 막은 「held 영영 true」의 역회귀 가드).
 *
 * 안 재는 축: 실기기 iOS 네이티브 스크롤 제스처 자체(Playwright 데스크톱은 합성 불가 —
 * scroll 이벤트 수준에서 등가 재현) · 왕복 기본 동작(v046-chip-sweep이 정본).
 *
 * 🔴 칩 click()은 안 쓴다 — 왕복 중 stable 데드락([TEAMOPS-81]). 전부 scrollLeft 관측.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, SETTINGS } from './fixtures/activeZones';

test.setTimeout(120_000);

/** 편도 1초 = 대기 축약(목 아님 — v046-chip-sweep §flaky 대책과 동일 근거). */
const SWEEP_SECONDS = 1;
const settingsWithSweep = () =>
  ({ ...SETTINGS, state: { ...SETTINGS.state, chipSweepSeconds: SWEEP_SECONDS } }) as typeof SETTINGS;

async function metrics(page: Page) {
  return page.evaluate(() => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    return { scrollLeft: g.scrollLeft, maxScroll: g.scrollWidth - g.clientWidth };
  });
}

/** 왕복이 실제로 돌기 시작할 때까지 대기(움직임 관측). */
async function waitForSweepMoving(page: Page) {
  const first = await metrics(page);
  await expect
    .poll(async () => Math.abs((await metrics(page)).scrollLeft - first.scrollLeft), {
      timeout: 5000,
      message: '왕복이 돌기 시작한다',
    })
    .toBeGreaterThan(2);
}

test('W3-① 🔴 사용자 스크롤(등가: 비-루프 scroll 이벤트 연속) 중 루프는 덮어쓰지 않는다', async ({ page }) => {
  await boot(page, PHONE_402, { settings: settingsWithSweep(), preserveAnimations: true });
  await waitForSweepMoving(page);

  // 느린 드래그 등가 재현: 30ms 간격으로 위치를 3px씩 옮겨 쓴다(위치 변화 → scroll 이벤트 →
  // 사용자 창 연장). 각 스텝 사이(≈2 프레임)에 루프가 살아 있으면 위치를 되끌어 간다 —
  // 종전 코드에서 이 편차가 프레임당 수 px로 누적되는 것이 FB-D다.
  const { deviations, maxScroll } = await page.evaluate(async () => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    const max = g.scrollWidth - g.clientWidth;
    let p = Math.max(2, Math.round(max * 0.5));
    const out: number[] = [];
    for (let i = 0; i < 15; i++) {
      g.scrollLeft = p;
      await new Promise((r) => setTimeout(r, 30));
      out.push(Math.abs(g.scrollLeft - p));
      p = Math.max(0, p - 3); // 다음 스텝 — 계속 변화를 만들어 이벤트를 이어 낸다
    }
    return { deviations: out, maxScroll: max };
  });
  console.log(`[w3-①] max=${Math.round(maxScroll)} deviations=${deviations.map((d) => d.toFixed(1)).join(',')}`);
  // 루프가 억제되면 각 관측치는 직전 대입값 그대로다(반올림 1px 허용). 종전 코드는 30ms(≈2프레임)
  // 안에 편도 1초 기준 수십 px을 되끌어 갔다.
  expect(Math.max(...deviations), '드래그 중 루프 개입 0').toBeLessThan(1.5);
});

test('W3-② 재개는 드래그 종점에서 — 위상 점프 없음(민구 C4)', async ({ page }) => {
  await boot(page, PHONE_402, { settings: settingsWithSweep(), preserveAnimations: true });
  await waitForSweepMoving(page);

  // 드래그 등가 재현 후 종점 P에 세운다.
  const { pEnd, maxScroll } = await page.evaluate(async () => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    const max = g.scrollWidth - g.clientWidth;
    let p = Math.max(2, Math.round(max * 0.6));
    for (let i = 0; i < 8; i++) {
      g.scrollLeft = p;
      await new Promise((r) => setTimeout(r, 30));
      p = Math.max(0, p - 4);
    }
    return { pEnd: g.scrollLeft, maxScroll: max };
  });

  // 조용해진 뒤(디바운스 300ms) 재개 — 움직임이 시작된 첫 표본이 종점 근방이어야 한다.
  // 편도 1초·표본 50ms = 스텝당 range의 ~5%라, 점프 없이 이어받으면 0.25·max 안쪽이다.
  let firstMoved: number | null = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50);
    const { scrollLeft } = await metrics(page);
    if (Math.abs(scrollLeft - pEnd) > 2) { firstMoved = scrollLeft; break; }
  }
  console.log(`[w3-②] pEnd=${Math.round(pEnd)} firstMoved=${firstMoved == null ? 'none' : Math.round(firstMoved)} max=${Math.round(maxScroll)}`);
  expect(firstMoved, '디바운스 뒤 왕복이 재개된다').not.toBeNull();
  expect(Math.abs((firstMoved as number) - pEnd), '재개는 종점 근방(위상 점프 없음)').toBeLessThan(maxScroll * 0.25);
});

// ── C-FIX3(리뷰 U6) — DPR<1 자기쓰기 오판 가드 ─────────────────────────────────────────
// scrollLeft 반올림 격자는 기기 픽셀 단위라 DPR 0.5에서는 2 CSS px — 허용 오차가 1px 고정이면
// 루프 자신의 scroll 이벤트가 '사용자'로 오판돼 매 이벤트 300ms 창이 열리고, 왕복이 사실상
// 멈춘다(스터터~정지). 오차를 max(1, 1/DPR)로 보정했다 — 이 축은 그 정지가 없음을 잰다.
test.describe('C-FIX3 — DPR 0.5', () => {
  test.use({ deviceScaleFactor: 0.5 });
  test('DPR<1에서도 왕복이 자기쓰기 오판 없이 지속된다', async ({ page }) => {
    await boot(page, PHONE_402, { settings: settingsWithSweep(), preserveAnimations: true });
    await waitForSweepMoving(page);
    const before = await metrics(page);
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      samples.push((await metrics(page)).scrollLeft);
      await page.waitForTimeout(200);
    }
    const spread = Math.max(...samples) - Math.min(...samples);
    console.log(`[cfix3] dpr=0.5 max=${Math.round(before.maxScroll)} spread=${spread.toFixed(1)}`);
    // 편도 1초 왕복이 2초 표본에서 유의하게 움직인다(v046 ②-b와 같은 하한 산술).
    expect(spread, 'DPR 0.5에서 왕복 지속(오판 정지 없음)').toBeGreaterThan(before.maxScroll * 0.12);
  });
});

test('W3-③ pointercancel 후에도 왕복은 죽지 않는다(held 영구 true 역회귀 가드)', async ({ page }) => {
  await boot(page, PHONE_402, { settings: settingsWithSweep(), preserveAnimations: true });
  await waitForSweepMoving(page);

  // iOS 인계 시퀀스 등가: 칩존 pointerdown → (네이티브 스크롤 전환) window pointercancel.
  // 이후 scroll 이벤트가 하나도 없어도(제스처 무산) 디바운스 뒤 재개돼야 한다.
  await page.evaluate(() => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'touch' }));
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 7, pointerType: 'touch' }));
  });

  const before = await metrics(page);
  await expect
    .poll(async () => Math.abs((await metrics(page)).scrollLeft - before.scrollLeft), {
      timeout: 3000,
      message: 'cancel 뒤 왕복 재개(조용한 죽음 없음)',
    })
    .toBeGreaterThan(2);
});
