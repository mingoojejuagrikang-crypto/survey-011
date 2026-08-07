import { test, expect, type Page } from '@playwright/test';
import { fitGroups, overflowsWidth, overflowsHeight } from '../src/components/voice/fitGroup';
import {
  HERO_LABEL_BASELINE_PX,
  HERO_LABEL_RESERVE_SCALE,
} from '../src/components/voice/heroLayout';

// 🔴 리터럴로 고정: 제품 상수를 import하면 상수가 바뀔 때 기대값이 자동 추종해 파손을 감춘다.
// heroLayout.ts의 HERO_MIN_FONT_PX 현재값(2026-08-03 기준)을 그대로 박는다.
const HERO_MIN_FONT_PX = { name: 22, value: 26, interim: 24 } as const;

/** 🔴 `page.evaluate(fitGroups, …)` 앞에 **반드시** 부른다 (2026-08-04, `[TEAMOPS-64]`).
 *
 *  Playwright는 `evaluate`에 넘긴 함수의 **본문만** 문자열화한다 — 모듈 스코프 참조는
 *  브라우저로 따라가지 않는다. `96eff16`이 넘침 판정을 `fitGroups` 내부 지역 함수에서
 *  모듈 스코프 `export`로 끌어올린 순간 이 스펙 3개가
 *  `ReferenceError: overflowsWidth is not defined`로 **터졌다.**
 *  🔴 그리고 그 상태로 §C0가 「부분 성과」 판정을 받았다 — **red가 아니라 무판정이었다.**
 *
 *  🔑 **제품 소스를 그대로 심는다**(`.toString()`). 판정식을 스펙에 복제하면
 *     제품과 같은 눈으로 보게 되어 아무것도 못 잡는다 — `[TEAMOPS-47]`이 금지하는 형태다.
 *  ⚠️ 이것이 성립하려면 두 판정 함수가 **자기 완결**이어야 한다(상수·헬퍼가 본문 안에).
 *     `fitGroup.ts` 상단 주석이 그 계약을 지킨다. 새 상수를 모듈 스코프에 두면 여기서 깨진다. */
async function installFitJudge(page: Page) {
  await page.evaluate(
    ([widthSrc, heightSrc]) => {
      (globalThis as { __fitJudge?: unknown }).__fitJudge = {
        overflowsWidth: new Function(`return (${widthSrc})`)(),
        overflowsHeight: new Function(`return (${heightSrc})`)(),
      };
    },
    [overflowsWidth.toString(), overflowsHeight.toString()],
  );
}
import {
  boot,
  COLUMNS,
  fillAllRows,
  PHONE_375,
  PHONE_402,
  PREV_ROUND,
  SETTINGS,
  triggerAnomaly,
} from './fixtures/activeZones';
import { fireStt, fireSttInterim, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** 🔴 **테스트가 자기 눈으로 재는 잉크 경계 계측기**(v0.44.0 A1).
 *
 *  종전 이 파일은 넘침을 `scrollWidth <= clientWidth + 1`로 단언했다 — **제품이 쓰던 것과 똑같은
 *  매직넘버 `+1`을 복제한 것**이라, 제품이 「맞다」고 하는 1px을 오라클도 「맞다」고 했다.
 *  그래서 F01(402×874에서 잉크가 배정을 1.313px 초과)이 이 스위트를 **green으로 통과**했다.
 *  기대값이 제품 판정과 독립이 아니면 파손을 감춘다.
 *
 *  이 계측기는 **제품의 판정 함수를 import하지 않는다**(`fitGroups` import는 fit을 *실행*하기
 *  위한 것이지 판정을 빌리기 위한 것이 아니다). 여기서 재는 것:
 *   - `scrollWidth`는 정수라 서브픽셀 초과를 반올림으로 삼킨다 → `Range`(float)로 잰다.
 *   - `inline-flex` + `justify-content:center`에서 `scrollWidth`는 **좌측 오버플로를 못 본다**
 *     → 폭이 아니라 **좌우 경계**를 각각 잰다.
 *  반환값 `overflowLeftPx`/`overflowRightPx`는 **양수면 그만큼 삐져나갔다**는 뜻이다. */
const INK_BOUNDS_FN = `(member) => {
  const style = getComputedStyle(member);
  const px = (v) => Number.parseFloat(v) || 0;
  const box = member.getBoundingClientRect();
  const contentLeft = box.left + px(style.borderLeftWidth) + px(style.paddingLeft);
  const contentRight = box.right - px(style.borderRightWidth) - px(style.paddingRight);
  const r = document.createRange();
  r.selectNodeContents(member);
  const ink = r.getBoundingClientRect();
  return {
    inkLeft: ink.left, inkRight: ink.right, inkWidth: ink.width,
    contentLeft, contentRight, contentWidth: contentRight - contentLeft,
    overflowLeftPx: contentLeft - ink.left,
    overflowRightPx: ink.right - contentRight,
    measuredBy: member.dataset.fitMeasuredBy ?? '(none)',
  };
}`;

/** 잉크가 배정 구간 밖으로 나갔는지 단언한다. 관용은 제품 상수를 빌리지 않고 **리터럴**로 박는다 —
 *  0.1px은 부동소수/레이아웃 반올림 잡음만 흡수하며, 종전 1px과 달리 글자 손실을 만들지 않는다.
 *  (402×874 실측: 초과 1.313px에서 이미 `…`로 마지막 글자 112.97px이 통째로 사라졌다) */
function expectWithinAllocation(
  bounds: { overflowLeftPx: number; overflowRightPx: number },
  what: string,
) {
  expect(bounds.overflowLeftPx, `${what} — 잉크가 배정 구간 왼쪽으로 넘음`).toBeLessThanOrEqual(0.1);
  expect(bounds.overflowRightPx, `${what} — 잉크가 배정 구간 오른쪽으로 넘음`).toBeLessThanOrEqual(0.1);
}

async function heroValueMetrics(page: Page) {
  return page.locator('[data-hero-state="listening"]').evaluate((container, fn) => {
    const member = container.querySelector<HTMLElement>('[data-fit-group="value"]');
    if (!member) throw new Error('value fit member 없음');
    const style = getComputedStyle(member);
    return {
      containerWidth: container.clientWidth,
      fontSize: parseFloat(style.fontSize),
      fitValue: getComputedStyle(container).getPropertyValue('--fit-value').trim(),
      memberClientWidth: member.clientWidth,
      memberScrollWidth: member.scrollWidth,
      widthStyle: member.style.width,
      whiteSpace: style.whiteSpace,
      overflow: style.overflow,
      // eslint-disable-next-line no-eval
      ink: (eval(fn) as (el: HTMLElement) => InkBounds)(member),
    };
  }, INK_BOUNDS_FN);
}

interface InkBounds {
  inkLeft: number; inkRight: number; inkWidth: number;
  contentLeft: number; contentRight: number; contentWidth: number;
  overflowLeftPx: number; overflowRightPx: number;
  measuredBy: string;
}

async function heroLabelMetrics(page: Page) {
  return page.locator('[data-hero-state="confirm"]').evaluate((container, fn) => {
    const label = container.querySelector<HTMLElement>('[data-fit-group="label"]');
    if (!label) throw new Error('label fit member 없음');
    const fontSize = parseFloat(getComputedStyle(label).fontSize);
    const value = container.querySelector<HTMLElement>('[data-fit-group="value"]');
    // eslint-disable-next-line no-eval
    const ink = eval(fn) as (el: HTMLElement) => InkBounds;
    return {
      fontSize,
      offsetHeight: label.offsetHeight,
      lineBoxRatio: label.offsetHeight / fontSize,
      clientWidth: label.clientWidth,
      scrollWidth: label.scrollWidth,
      fitLabel: getComputedStyle(container).getPropertyValue('--fit-label').trim(),
      valueFontSize: value ? parseFloat(getComputedStyle(value).fontSize) : 0,
      ink: ink(label),
      valueInk: value ? ink(value) : null,
    };
  }, INK_BOUNDS_FN);
}

function twoVoiceSettings(label: string) {
  const first = { ...COLUMNS.find((col) => col.id === 'v0')!, name: label };
  const second = { ...COLUMNS.find((col) => col.id === 'v1')!, name: `${label}보조` };
  const columns = [...COLUMNS.slice(0, 3), first, second];
  return {
    settings: {
      ...SETTINGS,
      state: { ...SETTINGS.state, columns, totalRows: 2 },
    },
    headers: columns.map((col) => col.name),
    sheetRows: [
      [PREV_ROUND, '이원창', '1', '100.0', '100.0'],
      [PREV_ROUND, '이원창', '2', '100.0', '100.0'],
    ],
  };
}

test('그룹 통일 — 긴 멤버가 같은 계열의 공통 배율을 결정한다', async ({ page }) => {
  await page.setContent(`
    <div id="fit" style="width:260px;height:300px;overflow:hidden">
      <span id="short" style="display:block;width:100%;font:900 calc(32px * var(--fit-probe,1))/1.1 sans-serif;white-space:nowrap;overflow:hidden">88</span>
      <span id="long" style="display:block;width:100%;font:900 calc(32px * var(--fit-probe,1))/1.1 sans-serif;white-space:nowrap;overflow:hidden">123456789012</span>
    </div>
  `);
  const container = await page.locator('#fit').elementHandle();
  const short = await page.locator('#short').elementHandle();
  const long = await page.locator('#long').elementHandle();
  if (!container || !short || !long) throw new Error('fit probe DOM 없음');
  await installFitJudge(page);
  const grouped = await page.evaluate(fitGroups, {
    container,
    groups: [{ variable: '--fit-probe', members: [short, long], searchBasePx: 32 }],
  });
  const groupedMetrics = await page.locator('#fit').evaluate((el, fn) => {
    const shortEl = el.querySelector<HTMLElement>('#short')!;
    const longEl = el.querySelector<HTMLElement>('#long')!;
    return {
      shortSize: parseFloat(getComputedStyle(shortEl).fontSize),
      longSize: parseFloat(getComputedStyle(longEl).fontSize),
      longScroll: longEl.scrollWidth,
      longClient: longEl.clientWidth,
      // eslint-disable-next-line no-eval
      longInk: (eval(fn) as (el: HTMLElement) => InkBounds)(longEl),
    };
  }, INK_BOUNDS_FN);
  expect(groupedMetrics.shortSize, '같은 계열은 같은 배율').toBeCloseTo(groupedMetrics.longSize, 3);
  // 종전: `longScroll <= longClient + 1` — 제품의 1px 관용을 복제해 서브픽셀 초과를 놓쳤다.
  expectWithinAllocation(groupedMetrics.longInk, '긴 멤버도 배정 폭 안');

  await page.locator('#long').evaluate((el) => el.remove());
  const shortOnly = await page.evaluate(fitGroups, {
    container,
    groups: [{ variable: '--fit-probe', members: [short], searchBasePx: 32 }],
  });
  expect(shortOnly['--fit-probe'], '긴 멤버를 빼면 짧은 멤버가 더 커진다')
    .toBeGreaterThan(grouped['--fit-probe'] * 1.5);
  console.log(`[fit-group] grouped=${grouped['--fit-probe'].toFixed(4)} shortOnly=${shortOnly['--fit-probe'].toFixed(4)} font=${groupedMetrics.longSize.toFixed(2)}px`);
});

test('그룹 우선순위 — reserveScale이 후순위 공간을 예약해 앞 그룹 최대 배율을 제한한다', async ({ page }) => {
  await page.setContent(`
    <div id="with-reserve" style="width:200px;height:200px;overflow:hidden">
      <span class="primary" style="display:block;height:calc(50px * var(--fit-primary,1))">P</span>
      <span class="label" style="display:block;height:calc(50px * var(--fit-label,1))">L</span>
    </div>
    <div id="without-reserve" style="width:200px;height:200px;overflow:hidden">
      <span class="primary" style="display:block;height:calc(50px * var(--fit-primary,1))">P</span>
      <span class="label" style="display:block;height:calc(50px * var(--fit-label,1))">L</span>
    </div>
  `);
  const run = async (selector: string, reserveScale?: number) => {
    const root = page.locator(selector);
    const container = await root.elementHandle();
    const primary = await root.locator('.primary').elementHandle();
    const label = await root.locator('.label').elementHandle();
    if (!container || !primary || !label) throw new Error('reserve probe DOM 없음');
    await installFitJudge(page);
    return page.evaluate(fitGroups, {
      container,
      groups: [
        { variable: '--fit-primary', members: [primary], searchBasePx: 50 },
        { variable: '--fit-label', members: [label], searchBasePx: 50, reserveScale },
      ],
    });
  };
  const reserved = await run('#with-reserve', 2);
  const unreserved = await run('#without-reserve');
  expect(unreserved['--fit-primary'], '후순위 예약을 빼면 앞 그룹이 그 공간까지 점유한다')
    .toBeGreaterThan(reserved['--fit-primary'] + 1);
});

test('계산 첫 probe가 맞아도 실패 경계까지 위로 열린다', async ({ page }) => {
  await page.setContent(`
    <div id="fit" style="width:260px;height:300px;overflow:hidden">
      <span id="member" style="display:block;width:100%;font:900 calc(10px * var(--fit-open,1))/1.1 sans-serif;white-space:nowrap;overflow:hidden">8</span>
    </div>
  `);
  const container = await page.locator('#fit').elementHandle();
  const member = await page.locator('#member').elementHandle();
  if (!container || !member) throw new Error('open probe DOM 없음');
  await installFitJudge(page);
  const firstProbe = 300 / 1000 + 1;
  const result = await page.evaluate(fitGroups, {
    container,
    groups: [{ variable: '--fit-open', members: [member], searchBasePx: 1000 }],
  });
  expect(result['--fit-open'], '계산된 첫 probe를 상한처럼 채택하지 않는다')
    .toBeGreaterThan(firstProbe * 2);
});

test('위로 열림 — live VoiceHero 320→402 배정 폭에서 정착 fontSize가 커진다', async ({ page }) => {
  await boot(page, { width: 320, height: 874 });
  await fireSttInterim(page, '123456789012', 250);
  const narrow = await heroValueMetrics(page);

  await page.setViewportSize(PHONE_402);
  let previous: Awaited<ReturnType<typeof heroValueMetrics>> | null = null;
  let consecutiveStable = 0;
  await expect.poll(async () => {
    const current = await heroValueMetrics(page);
    const sameAsPrevious = previous !== null &&
      Math.abs(current.fontSize - previous.fontSize) < 0.001 &&
      current.containerWidth === previous.containerWidth &&
      current.fitValue === previous.fitValue;
    consecutiveStable = sameAsPrevious ? consecutiveStable + 1 : 0;
    previous = current;
    return current.fontSize > narrow.fontSize + 2 && consecutiveStable >= 1;
  }, { timeout: 5000, intervals: [100] }).toBe(true);
  const wide = await heroValueMetrics(page);
  await page.waitForTimeout(250);
  const settled = await heroValueMetrics(page);
  expect(settled.fontSize, '성장 뒤 정착값이 다시 내려가지 않는다').toBeCloseTo(wide.fontSize, 3);
  expect(settled.fitValue, '성장 뒤 fit 변수도 정착한다').toBe(wide.fitValue);
  expect(wide.containerWidth, '실제 배정 폭이 늘어난 대조').toBeGreaterThan(narrow.containerWidth + 30);
  expect(wide.fitValue, 'fit 변수가 실제로 기록됐다').not.toBe('');
  // 종전: `memberScrollWidth <= memberClientWidth + 1` — 제품의 1px 관용 복제.
  expectWithinAllocation(wide.ink, '성장 뒤 값이 배정 폭 안');
  expect(wide.ink.measuredBy, '잉크 계측기로 쟀다(폴백 아님)').toBe('ink');
  expect(wide.widthStyle).toBe('100%');
  expect(wide.whiteSpace).toBe('nowrap');
  expect(wide.overflow).toBe('hidden');
  console.log(`[fit-growth] width ${narrow.containerWidth}→${wide.containerWidth}px, font ${narrow.fontSize.toFixed(2)}→${wide.fontSize.toFixed(2)}px`);
});

test('confirm — 라벨 미렌더(v0.45.0 UI③) + b84a08d 값 크기가 줄지 않는다', async ({ page }) => {
  // 정당 파손(v0.45.0 UI③, 민구 08-05 추가요청2) — confirm '✓+항목명' 라벨은 **전면 삭제**됐다
  // (§C7 판별식으로도 남던 잔여 표시 재지적. 성공 표시는 칩 V 마크가 승계 — v035-hero-confirm).
  // 종전 이 테스트의 라벨 fit 축(line box·하한·예약 배선)은 측정 대상이 사라져 함께 내렸다.
  // 남는 계약: 값 플래시(hero-primary)가 b84a08d 기준 크기(402=189.98px·375=174.73px)에서
  // 줄지 않는다 — 라벨이 사라졌으니 값 공간은 오히려 넉넉해져야 정상이다.
  const cases = [
    { viewport: PHONE_402, baselineValuePx: 189.98 },
    { viewport: PHONE_375, baselineValuePx: 174.73 },
  ] as const;
  for (const { viewport, baselineValuePx } of cases) {
    await boot(page, viewport);
    await waitForTtsIdle(page);
    await fireStt(page, '100.0', 300);
    await expect(page.locator('[data-hero-state="confirm"]')).toBeVisible();
    await expect(page.locator('[data-hero-state="confirm"] [data-fit-group="label"]'),
      'confirm 라벨은 어떤 창에서도 렌더되지 않는다(UI③)').toHaveCount(0);
    // ⚠️ heroValueMetrics는 listening 스코프다(플래시가 끝나면 interim이 없어 member 부재 throw).
    //   confirm 값은 플래시 창(1.5초) 안에서 confirm 스코프로 직접 잰다 — 대기도 짧게(120ms).
    const valueLoc = page.locator('[data-hero-state="confirm"] [data-fit-group="value"]');
    await expect(valueLoc).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    const metrics = await valueLoc.evaluate((member, fn) => ({
      fontSize: parseFloat(getComputedStyle(member).fontSize),
      // eslint-disable-next-line no-eval
      ink: (eval(fn) as (el: HTMLElement) => InkBounds)(member),
    }), INK_BOUNDS_FN);
    console.log(`[fit-confirm-value] ${viewport.width}x${viewport.height} value=${metrics.fontSize.toFixed(2)}px`);
    expect(metrics.fontSize, `${viewport.width}px confirm 값이 b84a08d보다 줄지 않는다`)
      .toBeGreaterThanOrEqual(baselineValuePx - 0.6);
    expectWithinAllocation(metrics.ink, 'confirm 값');
  }
});

test('하한 도달 — 긴 interim은 생략 표식으로 정보 손실을 드러낸다', async ({ page }) => {
  await boot(page, { width: 320, height: 874 });
  await fireSttInterim(page, '영하 십이점삼사 그리고 아주 긴 인식 원문이 계속 이어진다', 250);
  const metrics = await page.locator('[data-fit-group="value"]').evaluate((member) => {
    const style = getComputedStyle(member);
    return {
      fontSize: parseFloat(style.fontSize),
      scrollWidth: member.scrollWidth,
      clientWidth: member.clientWidth,
      textOverflow: style.textOverflow,
    };
  });
  expect(metrics.fontSize, 'interim 가독 하한').toBe(24);
  expect(metrics.scrollWidth, '하한에서도 긴 원문은 실제 배정 폭을 넘는다').toBeGreaterThan(metrics.clientWidth + 1);
  expect(metrics.textOverflow, '무표식 잘림 금지').toBe('ellipsis');
  console.log(`[fit-floor] font=${metrics.fontSize}px width=${metrics.scrollWidth}/${metrics.clientWidth}px overflow=${metrics.textOverflow}`);
});

for (const { labelKind, label, viewport } of [
  { labelKind: '짧은', label: '당도', viewport: { width: 320, height: 874 } },
  { labelKind: '긴', label: '과실가로세로둘레평균값', viewport: PHONE_375 },
] as const) {
  test(`nowrap 매트릭스 — ${labelKind} 한글 라벨 confirm→review @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    const fixture = twoVoiceSettings(label);
    await boot(page, viewport, fixture);
    await waitForTtsIdle(page);
    await fireStt(page, '-355.5', 300);

    await expect(page.locator('[data-hero-state="confirm"]')).toBeVisible({ timeout: 4000 });
    // 정당 파손(v0.45.0 UI③) — confirm 라벨 전면 삭제(칩 V 마크가 승계). 라벨 fit 축(line box·
    // 하한·잉크 좌우 대칭)은 측정 대상이 사라져 내렸고, confirm에서는 값 축만 잰다.
    // (긴 라벨의 잉크 계측 축 자체는 아래 review-다른-항목 케이스가 아니라 칩존 스윕이 갖는다.)
    await expect(page.locator('[data-hero-state="confirm"] [data-fit-group="label"]'),
      'confirm 라벨은 렌더되지 않는다(UI③)').toHaveCount(0);
    const confirmMetrics = await page.locator('[data-hero-state="confirm"] [data-fit-group="value"]').evaluate((member, fn) => ({
      fontSize: parseFloat(getComputedStyle(member).fontSize),
      // eslint-disable-next-line no-eval
      ink: (eval(fn) as (el: HTMLElement) => InkBounds)(member),
    }), INK_BOUNDS_FN);
    console.log(`[fit-matrix] state=confirm viewport=${viewport.width}x${viewport.height} label=(미렌더) value=${confirmMetrics.fontSize.toFixed(2)}px`);
    expect(confirmMetrics.fontSize, 'confirm 확정값 하한').toBeGreaterThanOrEqual(HERO_MIN_FONT_PX.value);
    expectWithinAllocation(confirmMetrics.ink, 'confirm 확정값');

    await expect(page.locator('[data-hero-state="listening"]')).toBeVisible({ timeout: 4000 });
    await waitForTtsIdle(page);
    await fireStt(page, '-355.5', 300);
    await expect(page.locator('[data-hero-state="review"]')).toBeVisible({ timeout: 4000 });
    const reviewHero = page.locator('[data-hero-state="review"]');
    await expect(reviewHero.locator('[data-fit-group="label"]'), '활성 칩과 같은 review 항목명은 중복이라 미렌더')
      .toHaveCount(0);
    const reviewMetrics = await reviewHero.locator('[data-fit-group="value"]').evaluate((member, fn) => ({
      fontSize: parseFloat(getComputedStyle(member).fontSize),
      scrollWidth: member.scrollWidth,
      clientWidth: member.clientWidth,
      // eslint-disable-next-line no-eval
      ink: (eval(fn) as (el: HTMLElement) => InkBounds)(member),
    }), INK_BOUNDS_FN);
    console.log(`[fit-matrix] state=review viewport=${viewport.width}x${viewport.height} label=N/A value=${reviewMetrics.fontSize.toFixed(2)}px width=${reviewMetrics.scrollWidth}/${reviewMetrics.clientWidth}`);
    expect(reviewMetrics.fontSize, 'review 확정값 하한').toBeGreaterThanOrEqual(HERO_MIN_FONT_PX.value);
    // 종전: `scrollWidth <= clientWidth + 1` — A0가 지목한 3곳(:101 :187 :254) 외 **네 번째** 복제다.
    expectWithinAllocation(reviewMetrics.ink, 'review 값');
  });
}

/** 🔴 **fit 기제 경계 가드** — UI-a가 만든 것을 UI-c가 지웠고 리뷰가 되살린다.
 *
 *  종전 가드는 `ModifyIndicatorPill`에 `--fit-value`가 unset임을 단언해
 *  *"새 훅이 범위 밖 카드로 새지 않는다"* 를 지켰다. **UI-c가 그 카드를 신 훅으로 이관**하면서
 *  가드를 **삭제**했다 — 코드는 정상이었지만 **지키는 장치가 사라졌다.**
 *  🔑 UI-a 리뷰 🔴-4와 같은 형태다: *"기제는 맞는데 지키는 장치가 없었다."*
 *
 *  **경계가 이동했으므로 새 경계로 다시 쓴다:**
 *  | 신 훅 `useFitGroup` | 구 훅 `useFitScale` |
 *  |---|---|
 *  | `VoiceHero` · `ModifyIndicatorPill` · `CompleteSummary` | `AnomalyAlertPopup` · `ReaskCue` · `StateIndicator` · `TabBar` |
 *
 *  ⚠️ **UI-f(인라인 fontSize 전수 이관)가 이 경계를 또 옮긴다.** 그때 이 가드가 있어야
 *  *"어디까지 옮겼는지"* 를 기계가 말해준다. **경계를 옮기면 이 표도 함께 고쳐라.** */
test('fit 기제 경계 — 구 훅 카드에 신 훅 변수가 새지 않는다', async ({ page }) => {
  await boot(page, PHONE_402);
  await triggerAnomaly(page);
  const m = await page.locator('[data-testid="anomaly-alert"]').evaluate((el) => {
    const s = getComputedStyle(el as HTMLElement);
    return {
      fitLo: s.getPropertyValue('--fit-lo').trim(),
      fitHi: s.getPropertyValue('--fit-hi').trim(),
      fitValue: s.getPropertyValue('--fit-value').trim(),
      fitLabel: s.getPropertyValue('--fit-label').trim(),
    };
  });
  console.log(`[fit-boundary] anomaly lo=${m.fitLo || '(unset)'} hi=${m.fitHi || '(unset)'} value=${m.fitValue || '(unset)'} label=${m.fitLabel || '(unset)'}`);
  // 🔑 구 훅 카드는 `--fit-lo/hi`로 살아 있어야 한다 — 이게 없으면 fit 자체가 안 도는 것이다.
  expect(m.fitLo, '구 훅이 실제로 돌고 있다(공허 방지)').not.toBe('');
  // 🔴 핵심 오라클 — 신 훅 변수가 구 훅 카드로 새지 않는다.
  expect(m.fitValue, '신 훅 --fit-value가 구 훅 카드로 샌다').toBe('');
  expect(m.fitLabel, '신 훅 --fit-label이 구 훅 카드로 샌다').toBe('');
});

test('nowrap 매트릭스 — listening·reask는 항목명 미렌더, 긴 interim만 하한·ellipsis 적용', async ({ page }) => {
  const fixture = twoVoiceSettings('과실가로세로둘레평균값');
  await boot(page, { width: 320, height: 874 }, fixture);
  const hero = page.locator('[data-hero-state="listening"]');
  await expect(hero.locator('[data-fit-group="label"]'), 'listening 라벨은 칩존과 중복이라 N/A').toHaveCount(0);

  await fireStt(page, '담백', 500);
  await expect(page.locator('[data-testid="reask-cue"]')).toBeVisible();
  await expect(hero.locator('[data-fit-group="label"]'), 'reask도 listening 구조라 라벨 N/A').toHaveCount(0);

  await fireSttInterim(page, '영하 십이점삼사 그리고 아주 긴 인식 원문이 계속 이어진다', 250);
  const metrics = await heroValueMetrics(page);
  console.log(`[fit-matrix] state=listening/reask viewport=320x874 label=N/A interimFont=${metrics.fontSize.toFixed(2)}px width=${metrics.memberScrollWidth}/${metrics.memberClientWidth} overflow=${metrics.overflow}`);
  expect(metrics.fontSize, '긴 interim 하한').toBe(HERO_MIN_FONT_PX.interim);
  expect(metrics.memberScrollWidth, '긴 interim 실제 overflow').toBeGreaterThan(metrics.memberClientWidth + 1);
});

test('안정 상태 — 25ms×2초 시계열 무변동·--fit-* style 재기록 0건', async ({ page }) => {
  await boot(page, PHONE_402);
  await fireSttInterim(page, '123456789012', 250);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  const stable = await page.locator('[data-hero-state="listening"]').evaluate(async (container) => {
    const stylePrototype = CSSStyleDeclaration.prototype;
    const original = stylePrototype.setProperty;
    let writes = 0;
    stylePrototype.setProperty = function patched(name, value, priority) {
      if (this === (container as HTMLElement).style && name.startsWith('--fit-')) writes += 1;
      return original.call(this, name, value, priority);
    };
    const series: string[] = [];
    const sample = () => {
      const cs = getComputedStyle(container);
      series.push(`${cs.getPropertyValue('--fit-value').trim()}|${cs.getPropertyValue('--fit-label').trim()}`);
    };
    const started = performance.now();
    let timer = 0;
    try {
      sample();
      timer = window.setInterval(sample, 25);
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    } finally {
      window.clearInterval(timer);
      stylePrototype.setProperty = original;
    }
    return {
      writes,
      elapsed: performance.now() - started,
      samples: series.length,
      values: [...new Set(series)],
    };
  });
  expect(stable.writes, '안정 상태 --fit-* style 재기록').toBe(0);
  expect(stable.values, `시계열=${stable.values.join(',')}`).toHaveLength(1);
  expect(stable.values[0], '공허한 CSS 변수 시계열 금지').not.toBe('|');
  expect(stable.elapsed, '호스트 샘플 처리량과 무관하게 2초 관측').toBeGreaterThanOrEqual(1900);
  console.log(`[fit-stable] elapsed=${stable.elapsed.toFixed(0)}ms samples=${stable.samples} values=${stable.values.join(',')} writes=${stable.writes}`);
});

const UI_C_BASELINE = [
  { name: '402×874', viewport: PHONE_402, modifyPx: 88.44, completePx: 40.20, reviewPx: 269.96 },
  { name: '375×667', viewport: PHONE_375, modifyPx: 82.50, completePx: 36.02, reviewPx: 174.73 },
] as const;

for (const { name, viewport, modifyPx, completePx, reviewPx } of UI_C_BASELINE) {
  test(`UI-c 수정 — 칩이 항목명을 주고 중앙은 값이 회수한다 @ ${name}`, async ({ page }) => {
    await boot(page, viewport);
    await waitForTtsIdle(page);
    await fireStt(page, '100.0', 500);
    await waitForTtsIdle(page);
    await fireStt(page, '수정', 500);

    const pill = page.locator('[data-testid="modify-indicator"]');
    await expect(pill).toBeVisible();
    await expect(pill, '시각 `측정항목01 수정`은 미렌더').toHaveText('');
    await expect(pill, '삭제한 상태·항목명은 접근 가능한 이름에 남는다')
      .toHaveAttribute('aria-label', '측정항목01 수정, 듣는 중');
    await expect(page.locator('[data-testid="column-chip"][data-active="true"]'), '항목명은 활성 칩이 준다')
      .toContainText('측정항목01');

    await fireSttInterim(page, '80.5', 150);
    const interim = page.locator('[data-testid="interim-value"]');
    await expect(interim).toHaveText('80.5');
    await expect(interim).toHaveAttribute('aria-label', '인식 중: 80.5');
    expect((await pill.innerText()).trim(), '`인식 중`·항목명 없이 값만 시각 렌더').toBe('80.5');

    await page.evaluate(() => {
      (window as unknown as { __ttsOnendDelayMs?: number }).__ttsOnendDelayMs = 3000;
    });
    await fireStt(page, '80.5', 100);
    const value = page.locator('[data-testid="modify-value"]');
    await expect(value).toBeVisible({ timeout: 3000 });
    const metrics = await pill.evaluate((el) => {
      const member = el.querySelector<HTMLElement>('[data-testid="modify-value"]')!;
      const style = getComputedStyle(el);
      return {
        fontSize: parseFloat(getComputedStyle(member).fontSize),
        fitValue: style.getPropertyValue('--fit-value').trim(),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    });
    expect(metrics.fitValue, '열린 fit이 실제 적용된다').not.toBe('');
    expect(metrics.fontSize, `b84a08d ${modifyPx}px보다 값이 실제로 커진다`).toBeGreaterThan(modifyPx + 1);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
    console.log(`[ui-c-modify] ${name}: ${modifyPx.toFixed(2)}→${metrics.fontSize.toFixed(2)}px fit=${metrics.fitValue}`);
  });

  test(`UI-c 완료 — 시각 상태어·배지를 지운 공간을 X/N이 회수한다 @ ${name}`, async ({ page }) => {
    await boot(page, viewport);
    await fillAllRows(page);
    const summary = page.locator('[data-testid="complete-summary"]');
    await expect(summary).toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="complete-receipt"]')).toHaveCount(0, { timeout: 8000 });
    await expect(summary).toHaveAttribute('aria-label', '조사 완료, 전체 2행 중 2행 입력됨');
    expect((await summary.innerText()).includes('완료'), '완료 상태어 시각 미렌더').toBe(false);
    await expect(page.locator('[data-testid="session-complete-badge"]'), '상단 완료 배지 미렌더').toHaveCount(0);
    await expect(page.locator('button[aria-label="음성 명령어 도움말"]'), '도움말은 완료 중에도 유지').toBeVisible();

    const metrics = await summary.evaluate((el) => {
      const member = el.querySelector<HTMLElement>('[data-testid="complete-count"]')!;
      const style = getComputedStyle(el);
      return {
        text: member.innerText.trim(),
        fontSize: parseFloat(getComputedStyle(member).fontSize),
        fitSummary: style.getPropertyValue('--fit-summary').trim(),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    });
    expect(metrics.text).toBe('2 / 2');
    expect(metrics.fitSummary, '완료 수치 열린 fit이 실제 적용된다').not.toBe('');
    expect(metrics.fontSize, `b84a08d ${completePx}px보다 수치가 실제로 커진다`).toBeGreaterThan(completePx + 1);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
    console.log(`[ui-c-complete] ${name}: ${completePx.toFixed(2)}→${metrics.fontSize.toFixed(2)}px fit=${metrics.fitSummary}`);
  });

  test(`UI-c review — 활성 칩과 같은 항목명을 지운 공간을 값이 회수한다 @ ${name}`, async ({ page }) => {
    await boot(page, viewport);
    await waitForTtsIdle(page);
    for (let i = 0; i < 11; i += 1) {
      await fireStt(page, i === 0 ? '100.0' : `${20 + i}.0`, 320);
      await waitForTtsIdle(page);
    }
    // 🔴 v0.46.1 정당 파손 (2026-08-07) — `f6de49c`(WP-1, FB-3 근본 처방)가 `speech.ts`의
    //    TTS 워치독을 **10초 → 2.5초**로 줄였다. 종전 값(`5000` 지연 + `5200` 대기)은
    //    **워치독보다 뒤**라, TTS가 2.5초에 강제 종료되어 review 창이 닫힌 뒤에 관측했다
    //    → `[data-hero-state="review"]` element not found.
    //    🔑 **이 창의 실제 상한은 `min(__ttsOnendDelayMs, TTS_WATCHDOG_MS)`다.**
    //    같은 파일 `:507`이 `3000` 지연에 **`100`ms 대기**라 살아남은 것도 같은 이유다.
    //    ⚠️ 워치독을 다시 올리더라도 이 값을 되돌리지 마라 — 창 안에서 관측하는 것이
    //    워치독 값과 무관하게 옳다. 되돌리면 워치독을 줄일 때마다 이 red가 재발한다.
    //    🔴🔴 이 red는 **08-07 하루 종일 게이트 밖에서 살아 있었다**(전량 스위트에서 발견).
    await page.evaluate(() => {
      (window as unknown as { __ttsOnendDelayMs?: number }).__ttsOnendDelayMs = 2000;
    });
    await fireStt(page, '31.0', 800);

    const hero = page.locator('[data-hero-state="review"]');
    await expect(hero).toBeVisible({ timeout: 4000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    // 한 번의 live snapshot으로 상태와 자식을 함께 읽는다. child locator의 `toHaveCount(0)`만 쓰면
    // review가 닫힌 뒤 부모째 0개가 된 것도 false-green으로 통과한다([TEAMOPS-30]).
    const rendered = await hero.evaluate((el) => ({
      state: el.getAttribute('data-hero-state'),
      ariaLabel: el.getAttribute('aria-label'),
      text: (el as HTMLElement).innerText.trim(),
      labelCount: el.querySelectorAll('[data-fit-group="label"]').length,
      activeChip: document.querySelector('[data-testid="column-chip"][data-active="true"]')
        ?.getAttribute('data-col-name') ?? '',
    }));
    expect(rendered.state, '실제로 review인 같은 프레임을 측정').toBe('review');
    expect(rendered.activeChip, 'review 항목명은 활성 칩이 준다').toBe('측정항목12');
    expect(rendered.labelCount, '중복 항목명·체크 라인 전체 미렌더').toBe(0);
    expect(rendered.ariaLabel).toBe('1행 완료, 명령 대기');
    expect(rendered.text, '중앙은 값만 시각 렌더').toBe('31');

    const metrics = await hero.evaluate((el) => {
      const member = el.querySelector<HTMLElement>('[data-fit-group="value"]')!;
      return {
        fontSize: parseFloat(getComputedStyle(member).fontSize),
        fitValue: getComputedStyle(el).getPropertyValue('--fit-value').trim(),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      };
    });
    expect(metrics.fontSize, `b84a08d ${reviewPx}px보다 review 값이 실제로 커진다`).toBeGreaterThan(reviewPx + 1);
    expect(metrics.fitValue, 'review 열린 fit이 적용된다').not.toBe('');
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
    console.log(`[ui-c-review] ${name}: ${reviewPx.toFixed(2)}→${metrics.fontSize.toFixed(2)}px fit=${metrics.fitValue}`);
  });
}
