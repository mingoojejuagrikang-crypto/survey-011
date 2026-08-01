/**
 * F3 입력화면 UI 재구성 — 와이어프레임 계약 회귀.
 *
 * SSOT: `Deliverables/2026-07-24-survey-011-active-screen-wireframe.md` (민구 확정 2026-07-24).
 *   §공통규칙1 공간 배정 — 🔴 v0.43.0 UI-b가 **칩존 20% / 중앙 50% / 하단 30%**로 바꿨다
 *     (ui-standard §2, 민구 확정). 🔴 기대값은 **이 파일에 고정**한다 — 제품 상수를 읽으면
 *     제품과 테스트를 같은 diff로 바꿨을 때 회귀가 통과한다.
 *   §공통규칙2·3 중앙 정보 가로+세로 중앙정렬
 *   §공통규칙4 칩존 한 행 + 가로 스크롤 + 활성칸 하이라이트·점멸
 *   §공통규칙5 하단 `<` `>` 양끝 + 가운데 단일 도트 격자 → 음성 입력 시 도트 파형
 *   §[2] anomaly / §[3] paused / §[4] complete
 *   + 수용기준: **회전 시 진동 부재**(useFitScale ResizeObserver 자기관측 제거)
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다([ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import {
  PHONE_402, PHONE_375,
  boot, injectLevel, zoneMetrics, triggerAnomaly, fillAllRows, PREV_ROUND,
} from './fixtures/activeZones';
import { fireStt } from './fixtures/stt';
/** 🔴 v0.43.0 UI-b — 배분이 **25/50/25 → 20/50/30**으로 바뀌었다(ui-standard §2, 민구 확정).
 *
 *  🔴 **여기 숫자는 제품 상수에서 읽지 않는다. 설계 계약을 테스트에 직접 고정한다.**
 *  종전 구현은 `heroLayout.ACTIVE_ZONE_RATIOS`를 import했는데, Codex 리뷰가 그걸 반증했다 —
 *  제품 상수와 이 기대값을 **같은 diff로** 25/50/25로 되돌리자 테스트 제목까지 따라 바뀌며
 *  **2/2 green**이었다(402×874가 `183/366/183`을 렌더하는데도 통과). 즉 배분 회귀를 못 막는다.
 *  🔑 **이건 중복 기록이 아니라 외부 SSOT(`ui-standard §2`)를 향한 독립 오라클이다.**
 *  값을 바꾸려면 **이 파일의 diff에 반드시 드러나야** 한다.
 *
 *  🔑 **중앙 50%는 안 바뀐다.** 하단을 30%로 올리라는 지시를 칩존에서 5%p 빼서 흡수했다.
 *  그러므로 이 파일에서 중앙이 깨지면 그건 정당 파손이 아니라 **회귀**다. */
const Z = { chip: 20, center: 50, bottom: 30 } as const;

// 시딩·부팅·상태진입 헬퍼는 `tests/fixtures/activeZones.ts`로 이동했다(동작 불변). 두 번째 소비자
// (`capture-current-states.spec.ts` — 실렌더 캡처)가 같은 상태로 진입해야 해서 복제를 피한 것이고,
// 이 스펙의 오라클은 하나도 바뀌지 않았다.

test.setTimeout(120_000);

// ─── §공통규칙1 — 공간 배정 20 / 50 / 30 (UI-b) ──────────────────────────────
for (const vp of [
  { name: '402×874', viewport: PHONE_402 },
  { name: '375×667', viewport: PHONE_375 },
]) {
  test(`§공통규칙1 — 칩존${Z.chip}%·중앙${Z.center}%·하단${Z.bottom}% 비례 배분 @ ${vp.name}`, async ({ page }) => {
    await boot(page, vp.viewport);
    const m = await zoneMetrics(page);
    // 🔴 분모는 **ActiveState 박스에서 상단 행/진행 스트립을 뺀 나머지**다. 와이어프레임 목업에서
    //    `[칩존 25%]` 격벽은 스트립 아래에서 시작하고, `[하단 25%]` 안에 그려진 nav(설정/입력/
    //    데이터/개선)는 실제로는 App의 TabBar라 이 박스 밖이다. window.innerHeight를 분모로 쓰면
    //    스트립·탭바 때문에 어떤 배치로도 성립하지 않는다.
    const zoneTotal = m.rootHeight - m.headerHeight;
    console.log(`[${vp.name}] root=${m.rootHeight.toFixed(0)} header=${m.headerHeight.toFixed(0)} chip=${m.chipHeight.toFixed(0)} center=${m.centerHeight.toFixed(0)} bottom=${m.bottomHeight.toFixed(0)}`);
    expect(m.chipHeight / zoneTotal, `칩존 ${Z.chip}%`).toBeCloseTo(Z.chip / 100, 2);
    expect(m.centerHeight / zoneTotal, `중앙 ${Z.center}%`).toBeCloseTo(Z.center / 100, 2);
    expect(m.bottomHeight / zoneTotal, `하단 ${Z.bottom}%`).toBeCloseTo(Z.bottom / 100, 2);
    // 세 구역이 겹치거나 서로를 밀지 않는다(합 = 전체).
    expect(m.chipHeight + m.centerHeight + m.bottomHeight).toBeCloseTo(zoneTotal, 0);
  });
}

test('칩존 — 한 행 유지 + 초과 칩은 **가로** 스크롤(활성칩 하이라이트+점멸)', async ({ page }) => {
  await boot(page);
  const grid = page.locator('[data-testid="voice-chip-grid"]');
  const m = await grid.evaluate((el) => {
    const g = el as HTMLElement;
    const chips = Array.from(g.querySelectorAll('[data-testid="column-chip"]')) as HTMLElement[];
    // 칩 상단 y를 8px 톨러런스로 클러스터링 = 실제로 몇 줄인가.
    const tops: number[] = [];
    for (const c of chips) {
      const top = c.offsetTop;
      if (!tops.some((t) => Math.abs(t - top) <= 8)) tops.push(top);
    }
    const cs = getComputedStyle(g);
    return {
      chipCount: chips.length,
      totalRows: tops.length,
      clientWidth: g.clientWidth,
      scrollWidth: g.scrollWidth,
      clientHeight: g.clientHeight,
      scrollHeight: g.scrollHeight,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      // 🔴 프리뷰 단계에서 데인 것 — smooth면 scrollLeft 대입 직후 읽은 값이 애니메이션 중간값이라
      //    자동 스크롤 측정·복원이 틀어진다.
      scrollBehavior: cs.scrollBehavior,
      chipHeights: chips.slice(0, 3).map((c) => c.getBoundingClientRect().height),
    };
  });
  console.log(`chips=${m.chipCount} rows=${m.totalRows} clientW=${m.clientWidth} scrollW=${m.scrollWidth}`);
  expect(m.chipCount, '시드가 실제로 많은 칩을 만들었다(공허 방지)').toBeGreaterThanOrEqual(12);
  // 민구 확정(2026-07-27) — 한 행. 원 요청(fb-27-2)은 세로 스크롤이었으나 화면을 보고 뒤집혔다.
  expect(m.totalRows, '칩은 한 행에 늘어선다').toBe(1);
  expect(m.overflowX, '넘침은 가로 스크롤이 받는다').toBe('auto');
  expect(m.overflowY, '세로로는 넘치지 않는다').toBe('hidden');
  expect(m.scrollWidth, '13개 칩은 한 화면 폭을 넘긴다').toBeGreaterThan(m.clientWidth);
  expect(m.scrollHeight - m.clientHeight, '세로 스크롤은 생기지 않는다').toBeLessThanOrEqual(1);
  expect(m.scrollBehavior, 'smooth 금지 — 자동 스크롤 측정이 애니메이션 중간값을 읽는다').toBe('auto');
  // 한 행이 트랙을 통째로 쓴다 = 칩이 종전(2줄)보다 확실히 높다. 44px는 장갑 조작 하한.
  const zone = await zoneMetrics(page);
  // 🔴 패딩값을 여기 다시 적지 않는다 — 종전 `- 12`(6+6 하드코딩)는 ChipZone과 이중 기록이라
  //   한쪽만 바뀌면 테스트가 조용히 통과한다. 실제 패딩을 DOM에서 읽는다.
  const chipPadY = await page.locator('[data-testid="voice-chip-grid"]')
    .evaluate((el) => parseFloat(getComputedStyle(el as HTMLElement).paddingTop));
  const expectedChipH = zone.chipHeight - chipPadY * 2;
  for (const h of m.chipHeights) {
    expect(Math.abs(h - expectedChipH), '칩 높이는 칩존 트랙 안쪽 높이 전체').toBeLessThanOrEqual(1.5);
    expect(h, '장갑 조작 44px 하한(PRINCIPLES §2)').toBeGreaterThanOrEqual(44);
  }
  // 활성 칩 하이라이트 + 점멸(chip-pulse).
  const active = page.locator('[data-testid="column-chip"][data-active="true"]');
  await expect(active).toHaveCount(1);
  const anim = await active.evaluate((el) => getComputedStyle(el as HTMLElement).animationName);
  expect(anim, '활성칸 점멸').toBe('chip-pulse');
});

for (const vp of [
  { name: '402×874', viewport: PHONE_402 },
  { name: '375×667', viewport: PHONE_375 },
]) {
  test(`§공통규칙4 [TEST-ANIMATION-ZERO-1] — 활성 칩만 실시간 점멸 @ ${vp.name}`, async ({ page }) => {
    // 전역 animation-duration:0ms 하네스를 끄고 제품의 1.2초 주기를 그대로 측정한다.
    await boot(page, vp.viewport, { preserveAnimations: true });

    const active = page.locator('[data-testid="column-chip"][data-active="true"]');
    await expect(active, '활성 칩이 정확히 하나 존재한다(공허 방지)').toHaveCount(1);
    await expect(active, '활성 칩이 실제로 보인다').toBeVisible();
    await expect(active, '활성 칩 상태 계약').toHaveAttribute('data-active', 'true');

    const inactive = page.locator('[data-testid="column-chip"][data-active="false"]').first();
    await expect(inactive, '비활성 대조 칩이 존재한다').toHaveCount(1);
    await expect(inactive, '비활성 대조 칩이 실제로 보인다').toBeVisible();
    await expect(inactive, '비활성 칩 상태 계약').toHaveAttribute('data-active', 'false');

    const animation = await active.evaluate((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      return { name: cs.animationName, duration: cs.animationDuration };
    });
    expect(animation.name, '활성 칩은 chip-pulse를 실행한다').toBe('chip-pulse');
    expect(animation.duration, '제품의 실 점멸 주기는 1.2초다').toBe('1.2s');

    const fingerprints: Array<{ active: string; inactive: string }> = [];
    for (let i = 0; i < 9; i++) {
      fingerprints.push(await page.locator('[data-testid="voice-chip-grid"]').evaluate((el) => {
        const activeChip = el.querySelector(
          '[data-testid="column-chip"][data-active="true"]',
        ) as HTMLElement;
        const inactiveChip = el.querySelector(
          '[data-testid="column-chip"][data-active="false"]',
        ) as HTMLElement;
        return {
          active: Number(getComputedStyle(activeChip).opacity).toFixed(3),
          inactive: Number(getComputedStyle(inactiveChip).opacity).toFixed(3),
        };
      }));
      if (i < 8) await page.waitForTimeout(150);
    }

    const activeFrames = [...new Set(fingerprints.map((sample) => sample.active))];
    const inactiveFrames = [...new Set(fingerprints.map((sample) => sample.inactive))];
    console.log(`[chip-pulse] ${vp.name}: ${JSON.stringify({ activeFrames, inactiveFrames })}`);
    expect(activeFrames.length, '활성 칩 opacity가 시간에 따라 실제로 변한다').toBeGreaterThan(1);
    expect(inactiveFrames.length, '비활성 칩 opacity는 시간에 따라 변하지 않는다').toBe(1);
  });
}

test('칩존 자동 스크롤 — 진행중 칩이 **우측 끝**, 왼쪽엔 값이 찍힌 완료 칩(민구 확정)', async ({ page }) => {
  // 🔴 이 오라클이 지키는 결정: "다음 항목 보기"가 아니라 **입력 확인 영역**이다.
  //    칩이 '항목+값'을 담으므로 왼쪽에 남는 완료 칩이 방금 넣은 값을 확인해 준다.
  //    일반적 직관과 반대라 되돌려지기 쉬워서 테스트로 못박는다.
  await boot(page);
  // 넘칠 만큼 진행시킨다(각 커밋마다 다음 칩으로 이동).
  for (let i = 0; i < 6; i++) await fireStt(page, `${20 + i}.0`, 320);
  const m = await page.locator('[data-testid="voice-chip-grid"]').evaluate((el) => {
    const g = el as HTMLElement;
    const active = g.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement;
    const gr = g.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    const done = Array.from(g.querySelectorAll('[data-testid="column-chip"]')).filter((c) => {
      const el2 = c as HTMLElement;
      if (el2.offsetLeft >= active.offsetLeft) return false;
      if (el2.offsetLeft + el2.offsetWidth <= g.scrollLeft + 4) return false;
      const v = el2.querySelectorAll('span')[1];
      const text = (v?.textContent ?? '').trim();
      return text !== '' && text !== '—';
    }).length;
    return {
      scrollLeft: Math.round(g.scrollLeft),
      maxScroll: Math.round(g.scrollWidth - g.clientWidth),
      rightGap: Math.round(gr.right - ar.right),
      leftOfActiveVisible: done,
      activeInView: ar.left >= gr.left - 1 && ar.right <= gr.right + 1,
    };
  });
  console.log(`autoscroll: scrollLeft=${m.scrollLeft}/${m.maxScroll} rightGap=${m.rightGap} done=${m.leftOfActiveVisible}`);
  // 공허 방지 — 실제로 넘쳐서 스크롤이 걸린 상태여야 이 오라클이 의미를 갖는다.
  expect(m.maxScroll, '칩이 실제로 넘친다').toBeGreaterThan(0);
  expect(m.scrollLeft, '자동 스크롤이 실제로 걸렸다').toBeGreaterThan(0);
  expect(m.activeInView, '진행중 칩이 보인다').toBe(true);
  expect(m.rightGap, '진행중 칩이 우측 끝에 정렬된다(좌→우 읽기)').toBeLessThanOrEqual(10);
  expect(m.leftOfActiveVisible, '왼쪽에 값이 찍힌 완료 칩이 보인다 = 입력 확인 영역')
    .toBeGreaterThanOrEqual(1);

  // 🔴 **이미 보이는 칩으로 넘어갈 때**가 이 계약의 진짜 시금석이다.
  //    앞으로 진행하며 칩이 화면 오른쪽 **밖**에서 들어올 때는 `scrollIntoView({inline:'nearest'})`도
  //    우연히 우측 정렬처럼 보인다('nearest'의 최소 스크롤량이 곧 우측 정렬이다). 그 경로만 재면
  //    **수정을 제거해도 통과하는 공허한 테스트**가 된다 — 실제로 그랬다(반증 1차 실패).
  //    다음 칩이 **이미 화면 안 왼쪽에 보이는 상태**로 만들어 두면 둘이 갈린다:
  //      · 'nearest' → 이미 보이므로 **안 움직인다**(칩이 왼쪽에 남는다).
  //      · 우측 끝 규칙 → 그 칩을 오른쪽 끝으로 **다시 정렬한다**.
  const beforeGap = await page.locator('[data-testid="voice-chip-grid"]').evaluate((el) => {
    const g = el as HTMLElement;
    const chips = Array.from(g.querySelectorAll('[data-testid="column-chip"]')) as HTMLElement[];
    const activeIdx = chips.findIndex((c) => c.getAttribute('data-active') === 'true');
    const next = chips[activeIdx + 1];
    // 다음 칩을 가시영역 **왼쪽 끝**에 오도록 미리 스크롤해 둔다.
    g.scrollLeft = Math.max(0, next.offsetLeft - g.offsetLeft);
    const gr = g.getBoundingClientRect();
    const nr = next.getBoundingClientRect();
    return { gap: Math.round(gr.right - nr.right), name: next.getAttribute('data-col-name') };
  });
  // 공허 방지 — 세팅이 실제로 "보이지만 우측 끝이 아닌" 상태를 만들었어야 한다.
  expect(beforeGap.gap, '다음 칩이 우측 끝이 아닌 곳에 보이도록 세팅됐다').toBeGreaterThan(40);

  await fireStt(page, '26.0', 500);
  const after = await page.locator('[data-testid="voice-chip-grid"]').evaluate((el) => {
    const g = el as HTMLElement;
    const active = g.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement;
    const gr = g.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    return { rightGap: Math.round(gr.right - ar.right), name: active.getAttribute('data-col-name') };
  });
  console.log(`autoscroll(revisit): 세팅 gap=${beforeGap.gap}(${beforeGap.name}) → 커밋 후 ${after.name} rightGap=${after.rightGap}`);
  expect(after.name, '다음 칩이 진행중이 됐다').toBe(beforeGap.name);
  expect(after.rightGap, '이미 보이던 칩도 우측 끝으로 재정렬된다').toBeLessThanOrEqual(10);
});

async function activeChipAlignment(page: Page) {
  return page.locator('[data-testid="voice-chip-grid"]').evaluate((el) => {
    const grid = el as HTMLElement;
    const active = grid.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement;
    const gridRect = grid.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    return {
      value: active.querySelectorAll('span')[1]?.textContent?.trim() ?? '',
      width: activeRect.width,
      rightGap: Math.round(gridRect.right - activeRect.right),
      scrollLeft: Math.round(grid.scrollLeft),
      maxScroll: Math.round(grid.scrollWidth - grid.clientWidth),
    };
  });
}

async function commitManualValue(page: Page, keys: string[]) {
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible();
  for (const key of keys) await page.locator(`[data-testid="manual-key-${key}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
}

for (const vp of [
  { name: '402×874', viewport: PHONE_402 },
  { name: '375×667', viewport: PHONE_375 },
]) {
  test(`C4 — 같은 활성 칩의 값·폭 변화 후 우측 끝 재정렬 @ ${vp.name}`, async ({ page }) => {
    await boot(page, vp.viewport);
    const before = await activeChipAlignment(page);
    expect(before.maxScroll, '칩존이 실제로 넘친다(공허 방지)').toBeGreaterThan(0);
    expect(before.scrollLeft, '첫 활성 음성 칩도 이미 우측 끝 정렬 대상이다').toBeGreaterThan(0);
    expect(Math.abs(before.rightGap - 8), '변경 전 우측 여백 = CHIP_SCROLL_PAD').toBeLessThanOrEqual(2);

    // 첫 음성 칩은 추세 규칙이 있어 수동 120.5 커밋 뒤 manualHold에 머문다.
    // currentColId/row는 그대로이고 값만 `—`→`120.5`로 바뀌므로 C4 의존성 누락을 직접 찌른다.
    await commitManualValue(page, ['1', '2', '0', '.', '5']);
    await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible();
    const after = await activeChipAlignment(page);

    expect(after.value).toBe('120.5');
    expect(after.width, '값이 길어져 활성 칩 폭이 실제로 변했다(공허 방지)').toBeGreaterThan(before.width + 1);
    expect(after.scrollLeft, '늘어난 폭만큼 스크롤을 다시 계산한다').toBeGreaterThan(before.scrollLeft);
    expect(Math.abs(after.rightGap - 8), '값 변경 뒤에도 우측 여백 = CHIP_SCROLL_PAD').toBeLessThanOrEqual(2);
  });
}

test('C4 — 402×874 ↔ 375×667 뷰포트 변화 뒤에도 활성 칩 우측 끝 재정렬', async ({ page }) => {
  await boot(page, PHONE_402);
  const initial = await activeChipAlignment(page);
  expect(initial.scrollLeft, '리사이즈 전에 실제 스크롤 상태다(공허 방지)').toBeGreaterThan(0);
  expect(Math.abs(initial.rightGap - 8)).toBeLessThanOrEqual(2);

  await page.setViewportSize(PHONE_375);
  await page.waitForTimeout(100);
  const narrow = await activeChipAlignment(page);
  expect(Math.abs(narrow.rightGap - 8), '375×667에서도 우측 여백 유지').toBeLessThanOrEqual(2);

  await page.setViewportSize(PHONE_402);
  await page.waitForTimeout(100);
  const restored = await activeChipAlignment(page);
  expect(Math.abs(restored.rightGap - 8), '402×874 복귀 뒤 우측 여백 유지').toBeLessThanOrEqual(2);
});

test('fb-27-2 — 대기 중엔 중앙 항목명을 렌더하지 않는다(칩존이 그 정보를 준다)', async ({ page }) => {
  // 🔴 민구 원문: "중앙 히어로 영역의 입력 항목 삭제. 칩이 사이즈 업 되었고, 진행 항목
  //    하이라이트 하기에 없어도 됨." v0.40.0에서 칩이 트랙 한 행을 통째로 쓰므로 중복이다.
  await boot(page);
  const hero = page.locator('[data-hero-state="listening"]');
  await expect(hero).toBeVisible();
  // 항목명이 화면 어디에도 **중앙에는** 없다. 칩존에는 있어야 한다(정보 자체를 잃은 게 아니다).
  await expect(page.locator('[data-testid="hero-primary"]'), '대기 중 중앙 항목명 미렌더').toHaveCount(0);
  const activeChip = page.locator('[data-testid="column-chip"][data-active="true"]');
  await expect(activeChip, '항목명은 활성 칩이 준다').toContainText('측정항목01');
  // 🔴 **항목명이 있던 자리**에 빈 줄 간격이 남지 않아야 한다 — 슬롯을 비우는 게 아니라 렌더를
  //    통째로 건너뛰는 방식이어야 한다(민구 지적: "프리뷰처럼 빈 줄 간격도 남지 않게").
  //
  //    ⚠️ 단, `HeroValueSlot`(인식값이 들어올 고정 높이 슬롯)은 **남아 있는 게 맞다.** 그건 지운
  //    자리의 잔재가 아니라, 발화가 시작될 때 중앙이 위아래로 튀지 않게 미리 잡아둔 공간이다
  //    (그 슬롯을 없애면 인식값이 나타날 때마다 레이아웃이 점프한다 = 와이어프레임이 금지한
  //    "안 바뀐 요소가 따라 움직인다"의 재발). 그래서 **자식 개수**로 판정한다 — 항목명 노드가
  //    사라져 값 슬롯 하나만 남았는가.
  const m = await hero.evaluate((el) => {
    const kids = Array.from(el.children) as HTMLElement[];
    return {
      childCount: kids.length,
      hasNameLine: kids.some((k) => (k.textContent ?? '').trim() !== ''),
      valueSlotHeight: Math.round((kids[0]?.getBoundingClientRect().height) ?? 0),
      text: (el.innerText ?? '').trim(),
    };
  });
  console.log(`hero(listening): children=${m.childCount} valueSlot=${m.valueSlotHeight}px text="${m.text}"`);
  expect(m.childCount, '항목명 노드가 사라지고 값 슬롯만 남는다').toBe(1);
  expect(m.hasNameLine, '글자를 담은 줄이 없다').toBe(false);
  expect(m.text, '대기 중 중앙은 비어 있다(인식값이 들어올 자리)').toBe('');
  expect(m.valueSlotHeight, '인식값 슬롯은 유지된다(발화 시 레이아웃 점프 방지)').toBeGreaterThan(40);
});

test('fb-27-2 대비 — 커밋 직후·검토에서는 항목명이 **남는다**(무차별 삭제가 아니다)', async ({ page }) => {
  // 🔴 이 대조군이 없으면 "항목명을 전부 지웠다"와 구별되지 않는다. 커밋 직후의 항목명은
  //    "지금 무엇을 입력하나"가 아니라 **"방금 무엇을 확정했나"** 이고, 그 시점엔 활성 칩이
  //    이미 다음 항목으로 옮겨가 칩존이 그 정보를 주지 못한다.
  await boot(page);
  await fireStt(page, '25.0', 300);
  const confirmHero = page.locator('[data-hero-state="confirm"]');
  await expect(confirmHero, '커밋 직후 확인 카드').toBeVisible({ timeout: 3000 });
  await expect(confirmHero, '확정한 항목명이 보인다').toContainText('측정항목01');
  await expect(confirmHero, '확정값도 함께').toContainText('25');
});

test('§공통규칙2·3 — 중앙 정보가 중앙 50% 안에서 가로+세로 중앙정렬', async ({ page }) => {
  await boot(page);
  const zone = await zoneMetrics(page);
  const hero = await page.locator('[data-hero-state]').boundingBox();
  expect(hero).not.toBeNull();
  const heroCy = hero!.y + hero!.height / 2;
  const heroCx = hero!.x + hero!.width / 2;
  expect(heroCy, '세로 중앙정렬').toBeCloseTo((zone.centerTop + zone.centerBottom) / 2, 0);
  expect(heroCx, '가로 중앙정렬').toBeCloseTo((zone.centerLeft + zone.centerRight) / 2, 0);
  // 중앙 정보가 구역을 넘치지 않는다(§공통규칙3 "위/아래 여백 고려").
  expect(hero!.y).toBeGreaterThanOrEqual(zone.centerTop - 1);
  expect(hero!.y + hero!.height).toBeLessThanOrEqual(zone.centerBottom + 1);
});

// ─── §공통규칙5 — 하단 `<` `>` 양끝 + 가운데 인디케이터 ────────────────────────
test('§공통규칙5 — `<` `>`가 하단 양끝, 인디케이터가 가운데(대기=글리프 → 음성 입력=도트 파형)', async ({ page }) => {
  await boot(page);
  const bar = await page.locator('[data-testid="voice-control-bar"]').boundingBox();
  const prev = await page.locator('button[aria-label="이전"]').boundingBox();
  const next = await page.locator('button[aria-label="다음"]').boundingBox();
  const band = await page.locator('[data-testid="live-listen-band"]').boundingBox();
  expect(prev).not.toBeNull(); expect(next).not.toBeNull(); expect(band).not.toBeNull();
  // 양끝 배치: `<`가 바 왼쪽 끝, `>`가 오른쪽 끝, 인디케이터가 그 사이.
  expect(prev!.x - bar!.x, '`<`는 바 왼쪽 끝').toBeLessThanOrEqual(16);
  expect(bar!.x + bar!.width - (next!.x + next!.width), '`>`는 바 오른쪽 끝').toBeLessThanOrEqual(16);
  expect(band!.x).toBeGreaterThanOrEqual(prev!.x + prev!.width - 1);
  expect(band!.x + band!.width).toBeLessThanOrEqual(next!.x + 1);
  // 장갑 조작 터치 타깃(PRINCIPLES §2).
  expect(prev!.height).toBeGreaterThanOrEqual(44);
  expect(next!.height).toBeGreaterThanOrEqual(44);
  // 도트 격자가 인디케이터 슬롯을 넘치지 않는다.
  const dotsFit = await page.locator('[data-testid="state-dots"]').evaluate((el) => {
    const d = el.getBoundingClientRect();
    const b = (el.closest('[data-testid="live-listen-band"]') as HTMLElement).getBoundingClientRect();
    return {
      overflow: Math.max(0, b.top - d.top, d.bottom - b.bottom, b.left - d.left, d.right - b.right),
      cells: el.querySelectorAll('span').length,
    };
  });
  expect(dotsFit.cells, '13×7 격자').toBe(91);
  expect(dotsFit.overflow, '격자가 밴드를 넘치지 않는다').toBeLessThan(1);

  // 와이어프레임 §공통규칙5 — 대기(무음)에는 **상태 글리프**, 음성이 들어오면 같은 격자가 **파형**이 된다.
  await injectLevel(page, 0);
  await page.waitForTimeout(600); // hangover(400ms) 경과 대기
  expect(await indicatorMode(page), '대기: 글리프').toBe('glyph');
  await injectLevel(page, 0.9);
  expect(await indicatorMode(page), '음성 입력: 도트 파형').toBe('wave');
  // 🔴 전환은 표시 전환이지 마운트 교체가 아니다 — 격자는 계속 **하나**로 살아 있다([STT-16]).
  await expect(page.locator('[data-testid="state-dots"]')).toHaveCount(1);
});

test('🔴 [UI-WAVE-1] 소멸 — 어떤 레벨에서도 도트와 파형이 **동시에** 보이지 않는다', async ({ page }) => {
  // 이 스펙이 v0.40.0의 핵심 가설을 검증한다: 격자를 하나로 합치면 "겹쳐 보이는 상태"가
  // 물리적으로 존재할 수 없다. 종전에는 `--voice-level ∈ (0, 0.125)` 구간에서 두 레이어가
  // 각각 부분 불투명이었다(실기기 B세션 avg 0.06 → 도트 52% + 파형 48%).
  await boot(page);
  // 결함이 가장 심했던 구간을 촘촘히 쓸어본다(0.06이 실기기 실측 평균).
  const levels = [0, 0.01, 0.02, 0.03, 0.0625, 0.06, 0.09, 0.124, 0.125, 0.2, 0.5, 1];
  const seen: string[] = [];
  for (const lv of levels) {
    await injectLevel(page, lv);
    await page.waitForTimeout(120);
    const m = await page.locator('[data-testid="state-dots"]').evaluate((el) => {
      const cells = Array.from(el.querySelectorAll('span')) as HTMLElement[];
      // 각 셀은 켜짐(1) 또는 꺼짐(0)뿐이어야 한다. 중간 불투명도가 있으면 그게 곧 "겹쳐 보임"이다.
      const partial = cells.filter((c) => {
        const o = Number(getComputedStyle(c).opacity);
        return o > 0.02 && o < 0.98;
      }).length;
      return {
        mode: el.getAttribute('data-mode') ?? '',
        lit: cells.filter((c) => Number(getComputedStyle(c).opacity) > 0.98).length,
        partial,
        layers: document.querySelectorAll('[data-testid="state-dots"], [data-testid="voice-waveform"]').length,
      };
    });
    seen.push(`${lv}:${m.mode}/${m.lit}`);
    // 🔴 핵심 단언 — 두 레이어가 아니라 **하나**다. 겹칠 상대가 없다.
    expect(m.layers, `레벨 ${lv}: 인디케이터 레이어는 하나뿐`).toBe(1);
    // 호흡 애니메이션이 opacity를 흔들지만, 그건 켜진 셀 안에서의 변조지 두 그림의 혼합이 아니다.
    // 따라서 "무엇을 그리는가"는 항상 단일 모드다.
    expect(['glyph', 'wave']).toContain(m.mode);
    expect(m.lit + m.partial, `레벨 ${lv}: 켜진 셀이 존재한다(공허 방지)`).toBeGreaterThan(0);
  }
  console.log(`[UI-WAVE-1] sweep: ${seen.join(' ')}`);
});

async function dotOpacitySnapshot(page: Page) {
  return page.locator('[data-testid="state-dots"]').evaluate((el) => {
    const cells = Array.from(el.querySelectorAll('span')) as HTMLElement[];
    const litIndices: number[] = [];
    const animatedIndices: number[] = [];
    const off: Array<{ index: number; computedOpacity: string }> = [];
    cells.forEach((cell, index) => {
      if (cell.style.opacity === '1') litIndices.push(index);
      else if (cell.style.opacity === '0') {
        off.push({ index, computedOpacity: getComputedStyle(cell).opacity });
      }
      if (getComputedStyle(cell).animationName === 'dot-breathe') animatedIndices.push(index);
    });
    return {
      glyph: el.getAttribute('data-glyph') ?? '',
      cellCount: cells.length,
      litIndices,
      animatedIndices,
      off,
    };
  });
}

function expectNoGhostDots(
  snapshot: Awaited<ReturnType<typeof dotOpacitySnapshot>>,
  label: string,
) {
  expect(snapshot.cellCount, `${label}: 13×7 격자가 실제로 존재한다`).toBe(91);
  expect(snapshot.litIndices.length, `${label}: 켜진 셀이 존재한다`).toBeGreaterThan(0);
  expect(snapshot.off.length, `${label}: 꺼진 셀이 존재한다`).toBeGreaterThan(0);
  expect(snapshot.litIndices.length + snapshot.off.length, `${label}: 모든 셀을 켜짐/꺼짐으로 분류했다`)
    .toBe(snapshot.cellCount);
  expect(
    [...new Set(snapshot.off.map((cell) => cell.computedOpacity))],
    `${label}: 꺼진 셀의 computed opacity는 정확히 0`,
  ).toEqual(['0']);
  expect(snapshot.animatedIndices, `${label}: animation 대상은 켜진 셀뿐`).toEqual(snapshot.litIndices);
}

for (const vp of [
  { name: '402×874', viewport: PHONE_402 },
  { name: '375×667', viewport: PHONE_375 },
]) {
  test(`C1 [UI-DOT-GHOST-1] — 전이 전·직후·안정 후 꺼진 셀 opacity=0 @ ${vp.name}`, async ({ page }) => {
    // 공용 STT 픽스처의 전역 0ms를 끄고 제품 animation duration 그대로 측정한다.
    await boot(page, vp.viewport, { preserveAnimations: true });
    await injectLevel(page, 0);
    await page.waitForTimeout(600); // hangover 종료 뒤 대기 글리프 안정 상태
    const before = await dotOpacitySnapshot(page);
    expect(before.glyph).toBe('mic');
    expectNoGhostDots(before, '전이 전 mic');

    await page.locator('button[title="일시정지"]').click({ force: true });
    await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-glyph', 'pause');
    await page.waitForTimeout(150); // Larry 실측과 같은 전이 직후 창
    const justAfter = await dotOpacitySnapshot(page);
    expect(justAfter.glyph).toBe('pause');
    expectNoGhostDots(justAfter, '전이 직후 pause');
    // 전이가 일어나지 않아 통과하는 공허한 테스트를 막는다.
    expect(justAfter.litIndices, '켜진 셀 인덱스 집합이 실제로 바뀐다').not.toEqual(before.litIndices);

    await page.waitForTimeout(700); // delay 상한(0.45s)을 지난 안정 상태도 별도 측정
    const stable = await dotOpacitySnapshot(page);
    expectNoGhostDots(stable, '전이 안정 후 pause');
    expect(stable.litIndices, '안정 후에도 pause 글리프가 유지된다').toEqual(justAfter.litIndices);
  });
}

for (const vp of [
  { name: '402×874', viewport: PHONE_402 },
  { name: '375×667', viewport: PHONE_375 },
]) {
  test(`C5 — 무음 대기 2초 opacity 쓰기 0 + 파형 프레임 갱신 @ ${vp.name}`, async ({ page }) => {
    await boot(page, vp.viewport, { preserveAnimations: true });
    await injectLevel(page, 0);
    await page.waitForTimeout(600);

    await page.locator('[data-testid="state-dots"]').evaluate((el) => {
      const meter = { count: 0, startedAt: performance.now() };
      Array.from(el.querySelectorAll('span')).forEach((cell) => {
        const style = (cell as HTMLElement).style;
        Object.defineProperty(style, 'opacity', {
          configurable: true,
          get: () => style.getPropertyValue('opacity'),
          set: (value: string) => {
            meter.count += 1;
            style.setProperty('opacity', value);
          },
        });
      });
      (window as unknown as { __dotOpacityWriteMeter: typeof meter }).__dotOpacityWriteMeter = meter;
    });

    await page.waitForTimeout(2_000);
    const measured = await page.evaluate(() => {
      const meter = (window as unknown as {
        __dotOpacityWriteMeter: { count: number; startedAt: number };
      }).__dotOpacityWriteMeter;
      return { count: meter.count, elapsedMs: performance.now() - meter.startedAt };
    });
    console.log(`[C5 idle] ${vp.name}: ${JSON.stringify(measured)}`);
    expect(measured.count, '안정된 무음 글리프는 같은 opacity를 재기록하지 않는다').toBe(0);

    // 파형 진입은 cache가 신뢰 불가한 경계라 첫 프레임을 전량 쓰고, 이후에는 실제 변화만 쓴다.
    await injectLevel(page, 0.85);
    await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-mode', 'wave');
    const entryWrites = await page.evaluate(() => (
      window as unknown as { __dotOpacityWriteMeter: { count: number } }
    ).__dotOpacityWriteMeter.count);
    expect(entryWrites, '파형 진입 첫 프레임은 91셀 전량 쓰기로 재동기화한다').toBeGreaterThanOrEqual(91);

    await page.evaluate(() => {
      const meter = (window as unknown as {
        __dotOpacityWriteMeter: { count: number; startedAt: number };
      }).__dotOpacityWriteMeter;
      meter.count = 0;
      meter.startedAt = performance.now();
    });
    const fingerprints: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(125);
      fingerprints.push(await page.locator('[data-testid="state-dots"]').evaluate((el) => (
        Array.from(el.querySelectorAll('span'))
          .map((cell) => (cell as HTMLElement).style.opacity)
          .join('')
      )));
    }
    const waveMeasured = await page.evaluate(() => {
      const meter = (window as unknown as {
        __dotOpacityWriteMeter: { count: number; startedAt: number };
      }).__dotOpacityWriteMeter;
      return { count: meter.count, elapsedMs: performance.now() - meter.startedAt };
    });
    const distinctFrames = new Set(fingerprints).size;
    console.log(
      `[C5 wave] ${vp.name}: ${JSON.stringify({ ...waveMeasured, distinctFrames, entryWrites })}`,
    );
    expect(waveMeasured.count, '파형 모드에서는 실제 셀 변화가 DOM에 계속 반영된다').toBeGreaterThan(0);
    expect(distinctFrames, '파형이 시간에 따라 끊김 없이 다른 프레임을 그린다').toBeGreaterThan(1);
  });
}

test('[UI-WAVE-1] hangover — 어절 사이 침묵에 글리프로 튀지 않는다', async ({ page }) => {
  // 말은 뚝뚝 끊긴다. 단순 임계면 한 문장 안에서 글리프↔파형이 여러 번 튀어 원거리에서
  // 고장으로 읽힌다. 들어갈 때 즉시 / 나올 때 지연이라는 비대칭이 그걸 막는다.
  await boot(page);
  await injectLevel(page, 0.5);
  expect(await indicatorMode(page), '발화 시작 → 즉시 파형').toBe('wave');
  // 어절 사이 짧은 침묵 — hangover(400ms) 안이면 파형을 유지해야 한다.
  // ⚠️ `injectLevel`이 자체적으로 200ms를 기다리므로 여기서 또 기다리면 창을 넘긴다.
  await injectLevel(page, 0);
  expect(await indicatorMode(page), '짧은 침묵에는 파형 유지(깜빡임 방지)').toBe('wave');
  // 발화가 실제로 끝나면(hangover 경과) 글리프로 돌아간다.
  await page.waitForTimeout(600);
  expect(await indicatorMode(page), '발화 종료 → 글리프 복귀').toBe('glyph');
});

async function indicatorMode(page: Page): Promise<string> {
  return page.locator('[data-testid="state-dots"]').evaluate(
    (el) => el.getAttribute('data-mode') ?? '',
  );
}

// ─── §[3] paused ────────────────────────────────────────────────────────────
test('§[3] paused — 중앙 비움 + 상단 "일시정지" + 하단 `<`=재개 / `>`=종료 + 도트 `||`', async ({ page }) => {
  await boot(page);
  await page.locator('button[title="일시정지"]').click({ force: true });
  await page.waitForTimeout(400);

  // 상단 "일시정지" 표시(§[3]).
  const badge = page.locator('[data-testid="paused-card"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('일시정지');

  // 중앙 비움 — 값도, "일시정지됨" 문구도 없다.
  const centerText = await page.locator('[data-testid="voice-center-stage"]').innerText();
  expect(centerText.trim(), '§[3] 중앙 비움').toBe('');

  // 하단 `<` `>` → 재개 / 종료(§[3]). 재개 버튼은 정확히 하나다(인디케이터는 표시 전용).
  await expect(page.locator('button[title="재시작"]')).toHaveCount(1);
  // 🔴 라벨 = 음성 명령 어휘와 **같은 말**(민구 확정 2026-07-27). 화면에 "재개"라고 쓰여 있으면
  //    사용자가 "재개"라고 말하는데 파서는 "재시작"만 받아 인식되지 않는다(실기기 관측).
  await expect(page.locator('button[title="재시작"][aria-label="재시작"]')).toBeVisible();
  await expect(page.locator('button[title="재시작"]'), '버튼 글자도 명령 어휘와 같다').toHaveText('재시작');
  await expect(page.locator('button[aria-label="재개"]'), '옛 라벨은 남아 있지 않다').toHaveCount(0);
  await expect(page.locator('button[title="입력 종료"]')).toBeVisible();
  await expect(page.locator('button[aria-label="이전"]'), '일시정지 중엔 이전/다음이 아니다').toHaveCount(0);

  // 도트는 일시정지 아이콘(||), 파형은 정지(rAF 미가동).
  await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-glyph', 'pause');
  // 구역 배분은 상태가 바뀌어도 불변(§공통규칙1).
  const m = await zoneMetrics(page);
  const zoneTotal = m.rootHeight - m.headerHeight;
  expect(m.centerHeight / zoneTotal, `일시정지에서도 중앙 ${Z.center}%`).toBeCloseTo(Z.center / 100, 2);
});

// ─── §[2] anomaly ───────────────────────────────────────────────────────────
test('§[2] anomaly — 경보행 + 2열 비교(직전/현재) + 하단 `<`=확인 / `>`=수정 + 경고 도트', async ({ page }) => {
  await boot(page);
  await triggerAnomaly(page);

  // 경보행: `<추세|범위>알람 : <넘어선 정도>` — **값 위**에 온다(§[2] "값 위·값 안 가림").
  const headline = page.locator('[data-testid="anomaly-headline"]');
  // §[2] `<추세|범위>알람 : <넘어선 정도>` + 방향어(민구 확정 2026-07-25 — TTS와 글자까지 동일
  // 계약 복원. 상세 오라클은 아래 '§[2] 경보 라벨이 TTS와 글자까지 같다' 케이스).
  await expect(headline, '§[2] 경보행 표기').toHaveText('추세 알람 증가 : 20.5');
  const headlineBox = (await headline.boundingBox())!;
  const compareBox = (await page.locator('[data-testid="anomaly-comparison"]').boundingBox())!;
  expect(headlineBox.y + headlineBox.height, '경보행이 값 위').toBeLessThanOrEqual(compareBox.y + 1);

  // fb-27-7 2·3·4항(민구 확정 2026-07-27) — **상하 2줄**, 날짜는 `mm-dd`, 라벨이 **값 앞**.
  const cmp = page.locator('[data-testid="anomaly-comparison"]');
  // 🔴 날짜를 리터럴로 박지 않는다 — 픽스처의 직전 회차가 `오늘 − 1일`이라 자정을 넘기면
  //    하드코딩한 값이 틀어진다(실제로 07-27→07-28 롤오버에서 이 테스트가 깨졌다).
  //    계약은 "그 날짜"가 아니라 **`mm-dd` 형식이고 연도가 없다**이므로 형식으로 판정한다.
  const expectedMmDd = PREV_ROUND.slice(5); // PREV_ROUND = 'YYYY-MM-DD'
  await expect(cmp, '날짜는 연도를 빼고 mm-dd').toContainText(expectedMmDd);
  expect(expectedMmDd, '픽스처 직전 회차가 mm-dd 형식이다(공허 방지)').toMatch(/^\d{2}-\d{2}$/);
  await expect(cmp, '연도는 표시하지 않는다').not.toContainText(PREV_ROUND.slice(0, 4) + '-');
  await expect(cmp).toContainText('현재');
  await expect(page.locator('[data-testid="anomaly-prev-value"]')).toHaveText('100');
  await expect(page.locator('[data-testid="anomaly-next-value"]')).toHaveText('120.5');
  const prevBox = (await page.locator('[data-testid="anomaly-prev-value"]').boundingBox())!;
  const nextBox = (await page.locator('[data-testid="anomaly-next-value"]').boundingBox())!;
  const prevLabelBox = (await cmp.locator('span').first().boundingBox())!;
  expect(prevBox.y + prevBox.height, '직전 줄이 현재 줄 **위**(상하 배치)').toBeLessThanOrEqual(nextBox.y + 1);
  expect(prevLabelBox.x + prevLabelBox.width, '라벨이 값 앞(같은 줄 왼쪽)').toBeLessThanOrEqual(prevBox.x + 1);
  expect(Math.abs(prevLabelBox.y - prevBox.y), '라벨과 값이 같은 줄').toBeLessThanOrEqual(prevBox.height);

  // 하단 `<` `>` → 확인 / 수정(알람 동안만). 카드 안이 아니라 **하단 양끝**이다.
  const confirm = page.locator('[data-testid="anomaly-confirm-btn"]');
  const modify = page.locator('[data-testid="anomaly-modify-btn"]');
  await expect(confirm).toBeVisible();
  await expect(modify).toBeVisible();
  const bar = (await page.locator('[data-testid="voice-control-bar"]').boundingBox())!;
  const cBox = (await confirm.boundingBox())!;
  const mBox = (await modify.boundingBox())!;
  expect(cBox.y, '확인은 하단 바 안').toBeGreaterThanOrEqual(bar.y - 1);
  expect(cBox.x, '확인이 왼쪽 끝').toBeLessThan(mBox.x);
  expect(cBox.height).toBeGreaterThanOrEqual(44);
  expect(mBox.height).toBeGreaterThanOrEqual(44);

  // 경고 도트(!) + 빨강 톤(§[2] "빨강 톤(값·파형·활성칸)").
  await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-glyph', 'alert');
  await expect(page.locator('[data-testid="voice-status-control"]')).toHaveAttribute('data-tone', 'red');
  const activeChipBorder = await page.locator('[data-testid="column-chip"][data-active="true"]')
    .evaluate((el) => getComputedStyle(el as HTMLElement).borderTopColor);
  expect(activeChipBorder, '활성칸 빨강 강조').toBe('rgb(255, 82, 82)');
});

test('fb-27-8 — 정정 후에는 `정상 : 복귀` 헤드라인을 렌더하지 않는다(하단 아이콘·글로우가 대신 말한다)', async ({ page }) => {
  await boot(page);
  await triggerAnomaly(page);
  // 알람 상태에서는 헤드라인이 **있다**(대조군 — 삭제가 무차별이 아님을 같은 테스트가 증명).
  await expect(page.locator('[data-testid="anomaly-headline"]'), '알람 중엔 경보행이 있다').toBeVisible();
  // 직전값 100.0 · trendRule=increase(=커지면 알람) → 100 미만은 통과 = 정정 완료.
  await fireStt(page, '80.5', 0);
  const corrected = page.locator('[data-testid="anomaly-alert"][data-status="corrected"]');
  await expect(corrected).toBeVisible({ timeout: 4000 });
  // 🔴 민구 확정(2026-07-27) — 문구 삭제. 오늘 실기기에서 19회 노출됐고, TTS·로그 경로가 없어
  //    삭제 부작용이 없다. 상태는 하단 글리프(green)와 엣지 글로우가 이미 말한다.
  await expect(page.locator('[data-testid="anomaly-headline"]'), '정정 후 경보행 미렌더').toHaveCount(0);
  await expect(corrected, '`정상 : 복귀` 문구 자체가 없다').not.toContainText('정상');
  // 값은 그대로 보인다(문구만 지웠지 정보를 지운 게 아니다).
  await expect(page.locator('[data-testid="anomaly-next-value"]')).toHaveText('80.5');
});

// ─── §[4] complete ──────────────────────────────────────────────────────────
test('§[4] complete — 중앙 `완료 : X / N` + 종료 버튼, 체크 도트, 일시정지 버튼 없음', async ({ page }) => {
  await boot(page);
  await fillAllRows(page);
  const summary = page.locator('[data-testid="complete-summary"]');
  await expect(summary).toBeVisible({ timeout: 8000 });

  // 완료 : X / N — X는 실제로 채워진 행 수(스킵·샘플손실 반영, ≤ N).
  await expect(page.locator('[data-testid="complete-count"]')).toHaveText('완료 : 2 / 2');
  // 종료 버튼(중앙) — 데이터 영향 행동이라 확인 다이얼로그로 이어진다.
  const exit = summary.locator('button[title="입력 종료"]');
  await expect(exit).toBeVisible();
  // 상단 "완료" 배지(§[4]).
  await expect(page.locator('[data-testid="session-complete-badge"]')).toHaveText('완료');
  // 하단 `<` `>` **유지**(§[4] "하단 `<` `>` 유지").
  await expect(page.locator('button[aria-label="이전"]')).toBeVisible();
  await expect(page.locator('button[aria-label="다음"]')).toBeVisible();
  // 파형 자리 = V(체크) 도트.
  await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-glyph', 'check');
  // 완료 상태의 유일한 행동은 종료다 — 일시정지 버튼이 존재하지 않는다(기존 계약 v023-voice와 동일).
  await expect(page.locator('button[title="일시정지"]')).toHaveCount(0);
  await exit.click();
  await expect(page.locator('button[title="종료 확인"]')).toBeVisible();
});

test('§[4] — `완료 : X / N`의 X는 실제로 채워진 행 수다(스킵 행은 빠진다)', async ({ page }) => {
  await boot(page);
  // 1행을 값 없이 '다음'으로 건너뛴다 → skippedRows로 갈라져 completedRows에 들어가지 않는다.
  await page.locator('button[aria-label="다음"]').click();
  await page.waitForTimeout(700);
  await fillAllRows(page);
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 10_000 });
  // 🔴 여기가 §[4]의 고유 의미다 — 총행 수를 그대로 찍으면 통과하는 단언이 아니어야 한다.
  await expect(page.locator('[data-testid="complete-count"]'), '스킵 행은 완료 수에서 빠진다')
    .toHaveText('완료 : 1 / 2');
});

test('§[4] 대비 — 완료 **행 검토 대기**는 [1] active 레이아웃을 유지한다(완료 화면으로 오인 금지)', async ({ page }) => {
  await boot(page);
  await fillAllRows(page);
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 8000 });
  // 끝 도달 → '이전'으로 완료 행 검토 대기 진입(phase는 그대로 'complete', endReached만 내려간다).
  await page.locator('button[aria-label="이전"]').click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="complete-summary"]'), '검토 대기는 완료 화면이 아니다').toHaveCount(0);
  await expect(page.locator('[data-testid="session-complete-badge"]')).toHaveCount(0);
  // hero의 검토 표시(✓ + 방금 커밋값)가 살아 있다 = v035-hero-confirm 동작 계약 보존.
  await expect(page.locator('[data-hero-state="review"]')).toBeVisible();
});

// ─── 수용기준: "회전 시 출력물 진동" — 정직하게 남기는 부분 ─────────────────────────────
//
// 🔴 **진동 자체는 이 라운드에서 재현하지 못했다(기기 게이트).** HANDOFF/[IOS-7] 잔여는 원인을
//    `useFitScale.ts`의 ResizeObserver 자기관측으로 특정했지만, 계측으로 **반증**됐다:
//    회전 전후 `--fit-lo`를 25ms 간격으로 2초씩 샘플링해도(이상치·수정·hero 카드 3종, 자기관측
//    코드 그대로) 값이 한 번도 흔들리지 않았다. 이유는 `fit()`이 **각 후보 단계를 적용한 뒤 그
//    레이아웃으로 측정**하기 때문이다 — 선택된 단계는 자기일관적이고, RO가 다시 깨워도 같은 단계로
//    수렴하고 멈춘다. 자기관측은 중복 1회를 더할 뿐 쌍안정 루프를 만들지 않는다.
//    (자기관측 제거는 그대로 두되 **방어적 단순화**이지 검증된 fb-01 수정이 아니다.)
//
// 대신 여기서는 진동의 **사용자에게 보이는 형태** — "안 바뀐 요소가 따라 움직인다" — 를 고정한다.
// 종전 구조에서 그게 실제로 일어나던 경로는 파형 밴드였다: 밴드 높이가 `window.innerHeight`
// 파생인데 자기 grid 트랙(auto)을 차지해서, iOS가 회전·URL바 변화 중 innerHeight를 잘게 흔들면
// **컨트롤바가 따라 움직이고 중앙 흡수영역이 같이 늘었다 줄었다** 했다. 새 구조는 밴드를 하단 25%
// 트랙 **안**에 넣어 그 전달 경로를 끊는다.
async function indicatorHeight(page: Page): Promise<number> {
  // v0.40.0 — 파형 노드는 사라지고 도트 격자 하나가 그 자리를 쓴다. 이 오라클이 재는 것은
  // "뷰포트 파생 밴드 높이가 실제로 변한다"이므로 측정 대상만 교체하면 계약은 그대로다.
  return page.locator('[data-testid="state-dots"]').evaluate((el) => el.getBoundingClientRect().height);
}

test('진동 경로 차단 — 화면 높이를 쓸어도(밴드 높이가 실제로 변해도) 구역 비율이 흔들리지 않는다', async ({ page }) => {
  await boot(page, PHONE_375);
  const heights: number[] = [];
  // 밴드 높이 산식 `clamp(60, innerHeight×0.105, 100)`이 실제로 서로 다른 값을 내는 높이들.
  for (const h of [667, 812, 874, 1000]) {
    await page.setViewportSize({ width: 375, height: h });
    await page.waitForTimeout(350);
    heights.push(await indicatorHeight(page));
    const m = await zoneMetrics(page);
    const zoneTotal = m.rootHeight - m.headerHeight;
    console.log(`h=${h} band=${heights[heights.length - 1].toFixed(0)} chip=${m.chipHeight.toFixed(0)} center=${m.centerHeight.toFixed(0)} bottom=${m.bottomHeight.toFixed(0)}`);
    expect(m.chipHeight / zoneTotal, `칩존 ${Z.chip}% @${h}`).toBeCloseTo(Z.chip / 100, 2);
    expect(m.centerHeight / zoneTotal, `중앙 ${Z.center}% @${h}`).toBeCloseTo(Z.center / 100, 2);
    expect(m.bottomHeight / zoneTotal, `하단 ${Z.bottom}% @${h}`).toBeCloseTo(Z.bottom / 100, 2);
  }
  // 🔴 공허 방지 — 밴드 높이가 **실제로 변했는데도** 비율이 유지된 것이어야 의미가 있다.
  //    (v019 R1 주석이 지적한 "항상 참인 상한" 토톨로지를 되풀이하지 않는다.)
  expect(new Set(heights.map((h) => Math.round(h))).size, '스윕 구간에서 파형 밴드 높이가 실제로 달라졌다')
    .toBeGreaterThan(1);
});

test('진동 경로 차단 — 상태가 바뀌어도 구역 경계가 움직이지 않는다(active/이상치/일시정지)', async ({ page }) => {
  await boot(page, PHONE_375);
  const snap = async () => {
    const m = await zoneMetrics(page);
    return [m.chipHeight, m.centerHeight, m.bottomHeight, m.centerTop, m.centerBottom].map((v) => Math.round(v));
  };
  const active = await snap();
  await triggerAnomaly(page);
  const anomaly = await snap();
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await page.waitForTimeout(700);
  await page.locator('button[title="일시정지"]').click({ force: true });
  await page.waitForTimeout(400);
  const paused = await snap();
  console.log(`active=${active} anomaly=${anomaly} paused=${paused}`);
  // v0.19.0 버그B(컨트롤바 Y 인변량)의 후신 — 이제 **모든 구역 경계**로 확장한다.
  expect(anomaly, '이상치에서도 구역 경계 불변').toEqual(active);
  expect(paused, '일시정지에서도 구역 경계 불변').toEqual(active);
});

test('회전 왕복 — 구역 배분·세션 표시가 그대로 살아 있다(트리 교체 없음)', async ({ page }) => {
  await boot(page, PHONE_375);
  await triggerAnomaly(page);
  // ⚠️ `hasTouch` 없이 뷰포트만 바꾼다. PortraitGuard는 `(pointer: coarse)`를 요구하므로 여기서는
  //    뜨지 않는다 — 이 오라클은 오버레이가 아니라 입력화면 자체를 본다.
  await page.setViewportSize({ width: 667, height: 375 });
  await page.waitForTimeout(600);
  await page.setViewportSize(PHONE_375);
  await page.waitForTimeout(600);
  // 회전 왕복 뒤에도 알람 상태·구역 배분이 유지된다(상태 전환은 표시 전환이지 트리 교체가 아니다).
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible();
  await expect(page.locator('[data-testid="anomaly-confirm-btn"]')).toBeVisible();
  const m = await zoneMetrics(page);
  const zoneTotal = m.rootHeight - m.headerHeight;
  expect(m.centerHeight / zoneTotal, `회전 왕복 후에도 중앙 ${Z.center}%`).toBeCloseTo(Z.center / 100, 2);
  expect(m.chipHeight / zoneTotal, `회전 왕복 후에도 칩존 ${Z.chip}%`).toBeCloseTo(Z.chip / 100, 2);
});

// ─── 민구 확정 반영분 (2026-07-25 라운드 판단) ──────────────────────────────────

test('§[2] 경보 라벨이 TTS와 글자까지 같다 — 방향어(증가/감소) 유지', async ({ page }) => {
  await boot(page);
  await triggerAnomaly(page);

  // 🔴 시각·청각 일치 계약(v0.20.0 입력탭#6): `alertText`(TTS)와 팝업 라벨은 **글자까지 동일**해야
  //    한다. 현장에선 화면을 안 보고 귀로만 듣는 경우가 많아, 둘이 다르면 혼란스럽다.
  //    초안은 와이어프레임 §[2] 표기를 좁게 읽어 방향어를 뺐다가 어긋났다(민구 판단으로 복원).
  const headline = page.locator('[data-testid="anomaly-headline"]');
  await expect(headline).toContainText('추세 알람');
  await expect(headline, '방향어가 라벨에 남아 있다').toContainText('증가');

  // TTS가 실제로 말한 문장과 대조 — 라벨의 핵심 어절이 그대로 발화돼야 한다.
  const spoken = await page.evaluate(() => (window as unknown as { __ttsLog?: string[] }).__ttsLog ?? []);
  const alarmTts = spoken.find((t) => t.includes('추세 알람'));
  expect(alarmTts, '알람 TTS가 발화됐다').toBeTruthy();
  expect(alarmTts, 'TTS도 같은 방향어를 쓴다').toContain('증가');
});

test('§[4] complete — 마지막 값을 3초 보여준 뒤 와이어프레임대로 정착한다', async ({ page }) => {
  await boot(page);
  await fillAllRows(page);
  const receipt = page.locator('[data-testid="complete-receipt"]');

  // 끝 도달 직후: 방금 확정한 값이 보인다. 이 줄이 없으면 마지막 셀을 채우는 순간이 곧 끝 도달이라
  // 사용자가 방금 넣은 값을 **한 번도 확인하지 못한 채** 완료 화면으로 넘어간다.
  await expect(receipt, '끝 도달 직후에는 마지막 값이 보인다').toBeVisible({ timeout: 3000 });

  // 3초 뒤: 와이어프레임 §[4] 그대로(요약 + 종료 버튼)로 정착한다(민구 확정 2026-07-25).
  await expect(receipt, '3초 뒤 영수증이 걷힌다').toHaveCount(0, { timeout: 6000 });
  await expect(page.locator('[data-testid="complete-count"]'), '요약은 남는다').toBeVisible();
  await expect(
    page.locator('[data-testid="complete-summary"] button[title="입력 종료"]'),
    '종료 버튼은 남는다',
  ).toBeVisible();
});
