import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402 } from './fixtures/activeZones';

/** §B2 과제3 — 3구역 배분 오라클(층 B). 🟢 2026-08-04 §C5-b 완결로 전 단언 green —
 *  `@pending-v0440`·`@pending-c5b` 태그를 전부 뗐다(§C1 칩존 16% + §C5-b 하단1행 24% 달성).
 *
 *  🔴 Larry 확인(2026-08-03) — 브리핑/플랜 §B2의 pool 공식(화면높이-sat-88(TabBar)-44(상단
 *  스트립))은 명목값이라 실측과 어긋난다(headerHeight 실측 54px, TabBar 실측 88~95px — sab에
 *  따라 변동). 그래서 고정 픽셀 목표값을 리터럴로 박지 않고, **런타임에 pool을 직접 측정**해
 *  그 pool 대비 비율(16/50/24/10)을 단언한다(3층 설계, Larry 지시):
 *    층1 — pool 자기 정합성: `viewportH - sat - headerHeight - tabBarHeight` == 측정된 pool
 *    층2 — 각 구역 높이 / pool == 0.16 / 0.50 / 0.24 / 0.10 (±0.005) — 이게 진짜 계약
 *    층3 — 402×874와 640×1024의 pool 값이 서로 다르다(무변화 카드 방지) */

const TABLET_640 = { width: 640, height: 1024 };

/** 브리핑 실측표 — iPhone(402) standalone은 sat=62/sab=34, 태블릿(640)은 sat=0/sab=0
 *  (browser·standalone 공통). sab가 402에서만 붙는 것이 pool이 갈리는 핵심 축이다. */
const SAFE_AREA = {
  phone402: { top: 62, bottom: 34 },
  tablet640: { top: 0, bottom: 0 },
} as const;

async function injectSafeArea(page: Page, insets: { top: number; bottom: number }) {
  await page.addInitScript((values) => {
    const apply = () => {
      const el = document.documentElement;
      if (!el) { setTimeout(apply, 0); return; }
      el.style.setProperty('--sat', `${values.top}px`);
      el.style.setProperty('--sab', `${values.bottom}px`);
      el.style.setProperty('--sal', '0px');
      el.style.setProperty('--sar', '0px');
    };
    apply();
  }, insets);
}

async function zoneRatioMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="voice-active-state"]') as HTMLElement;
    const header = root.firstElementChild as HTMLElement;
    const tabBar = document.querySelector('[data-testid="tab-bar"]') as HTMLElement;
    const chip = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    const center = document.querySelector('[data-testid="voice-center-stage"]') as HTMLElement;
    const controlBar = document.querySelector('[data-testid="voice-control-bar"]') as HTMLElement;
    const indicatorRow = document.querySelector('[data-testid="voice-indicator-row"]') as HTMLElement | null;
    const navRow = document.querySelector('[data-testid="voice-nav-row"]') as HTMLElement | null;
    const band = document.querySelector('[data-testid="live-listen-band"]') as HTMLElement | null;
    const wave = band?.querySelector('[data-testid="state-dots"]') as HTMLElement | null;
    const sat = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0;
    return {
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      sat,
      headerHeight: header.getBoundingClientRect().height,
      tabBarHeight: tabBar.getBoundingClientRect().height,
      chipHeight: chip.getBoundingClientRect().height,
      centerHeight: center.getBoundingClientRect().height,
      // 🔴 voice-control-bar 전체(도트·파형행 + 버튼행 + 접힌 ActiveControlSteppers 토글)를
      // 하단 트랙 전체로 잰다. indicatorRow+navRow만 더하면 접힌 steppers 높이(실측 402에서
      // 약 49px)가 빠져 pool 자기정합성(층1)이 거짓으로 깨진다 — steppers는 브리핑의 4구역
      // 모델에 없는 존재라 층2(하단1행/2행 개별 비율)는 그대로 indicatorRow/navRow로 잰다.
      controlBarHeight: controlBar.getBoundingClientRect().height,
      indicatorRowHeight: indicatorRow ? indicatorRow.getBoundingClientRect().height : 0,
      navRowHeight: navRow ? navRow.getBoundingClientRect().height : 0,
      waveWidth: wave ? wave.getBoundingClientRect().width : 0,
    };
  });
}

for (const { name, viewport, insets } of [
  { name: '402×874', viewport: PHONE_402, insets: SAFE_AREA.phone402 },
  { name: '640×1024', viewport: TABLET_640, insets: SAFE_AREA.tablet640 },
] as const) {
  test(`층1 — pool 자기 정합성 @ ${name}`, async ({ page }) => {
    await injectSafeArea(page, insets);
    await boot(page, viewport);
    const m = await zoneRatioMetrics(page);
    const formulaPool = m.viewportHeight - m.sat - m.headerHeight - m.tabBarHeight;
    const measuredPool = m.chipHeight + m.centerHeight + m.controlBarHeight;
    console.log(`[zone-pool] ${name}: viewportH=${m.viewportHeight} sat=${m.sat} header=${m.headerHeight.toFixed(2)} tabBar=${m.tabBarHeight.toFixed(2)} formulaPool=${formulaPool.toFixed(2)} measuredPool=${measuredPool.toFixed(2)}`);
    expect(Math.abs(measuredPool - formulaPool), `${name} 공식 pool(뷰포트-sat-header-tabBar)과 실측 pool(4구역 합)이 ±1px 안에서 일치`)
      .toBeLessThanOrEqual(1);
  });

  /** 🔴 §C1(2026-08-03)에서 **둘로 갈랐다.** 종전엔 4개 단언이 한 test에 있어서 §C1이 칩존을
   *  16%로 만들어도 §C5-b 몫인 `bottomRow1` 하나 때문에 test 전체가 red였다 — **달성분이
   *  기계로 안 보인다.** 한쪽이 다른 쪽의 성과를 가리면 회귀 판정에서 둘 다 "pending"으로
   *  뭉개진다(`c0-r1` `808e9b0`이 같은 이유로 알람 오라클을 갈랐다). */
  test(`층2a — 칩존 16% · 중앙 50% · 버튼행 10% (§C1 달성분) @ ${name}`, async ({ page }) => {
    await injectSafeArea(page, insets);
    await boot(page, viewport);
    const m = await zoneRatioMetrics(page);
    const pool = m.viewportHeight - m.sat - m.headerHeight - m.tabBarHeight;
    const ratios = {
      chip: m.chipHeight / pool,
      center: m.centerHeight / pool,
      bottomRow2: m.navRowHeight / pool,
    };
    console.log(`[zone-ratio] ${name}: pool=${pool.toFixed(2)} chip=${ratios.chip.toFixed(4)} center=${ratios.center.toFixed(4)} bottomRow2=${ratios.bottomRow2.toFixed(4)}`);
    expect(ratios.chip, `${name} 칩존이 pool의 16%다(§C1)`).toBeCloseTo(0.16, 2);
    expect(ratios.center, `${name} 중앙이 pool의 50%다(불변)`).toBeCloseTo(0.50, 2);
    expect(ratios.bottomRow2, `${name} 하단2행(버튼)이 pool의 10%다(불변, 절대 늘리지 않는다)`).toBeCloseTo(0.10, 2);
  });

  /** 🟢 §C5-b 완결(2026-08-04) — `@pending-c5b` 태그 해제. 접힌 조절판 토글이 하단 트랙의
   *  ~49px를 고정으로 먹던 것을 오버레이로 빼면서(ActiveControlBar §C5-b 주석) 도트행이
   *  34% − 10%(버튼) = 정확히 24%를 갖는다. 되돌리면(토글을 플로우에 다시 쌓으면) red다. */
  test(`층2b — 하단1행(도트·파형) 24% @ ${name}`, async ({ page }) => {
    await injectSafeArea(page, insets);
    await boot(page, viewport);
    const m = await zoneRatioMetrics(page);
    const pool = m.viewportHeight - m.sat - m.headerHeight - m.tabBarHeight;
    const bottomRow1 = m.indicatorRowHeight / pool;
    console.log(`[zone-ratio] ${name}: bottomRow1=${bottomRow1.toFixed(4)} (target 0.24, §C5-b 대상)`);
    expect(bottomRow1, `${name} 하단1행(도트·파형)이 pool의 24%다(§C5-b 대상)`).toBeCloseTo(0.24, 2);
  });

  test(`파형 가로폭 — 실제 뷰포트 폭의 2/3 @ ${name}`, async ({ page }) => {
    await injectSafeArea(page, insets);
    await boot(page, viewport);
    const m = await zoneRatioMetrics(page);
    const expectedWaveWidth = m.viewportWidth * (2 / 3);
    console.log(`[zone-wave] ${name}: viewportWidth=${m.viewportWidth} waveWidth=${m.waveWidth.toFixed(2)} expected=${expectedWaveWidth.toFixed(2)}`);
    expect(Math.abs(m.waveWidth - expectedWaveWidth), `${name} 파형 폭 분모는 박스 폭이 아니라 실제 뷰포트 폭(±1px)`)
      .toBeLessThanOrEqual(1);
  });
}

test('층3 — 402×874와 640×1024의 pool이 서로 다르다(무변화 카드 방지)', async ({ page }) => {
  await injectSafeArea(page, SAFE_AREA.phone402);
  await boot(page, PHONE_402);
  const phone = await zoneRatioMetrics(page);
  const phonePool = phone.viewportHeight - phone.sat - phone.headerHeight - phone.tabBarHeight;

  await injectSafeArea(page, SAFE_AREA.tablet640);
  await boot(page, TABLET_640);
  const tablet = await zoneRatioMetrics(page);
  const tabletPool = tablet.viewportHeight - tablet.sat - tablet.headerHeight - tablet.tabBarHeight;

  console.log(`[zone-pool-diff] phone402=${phonePool.toFixed(2)} tablet640=${tabletPool.toFixed(2)} diff=${(tabletPool - phonePool).toFixed(2)}`);
  expect(Math.abs(tabletPool - phonePool), '두 뷰포트의 pool이 실제로 다르다 — after만 보면 통과하는 무변화 카드 방지')
    .toBeGreaterThan(1);
});
