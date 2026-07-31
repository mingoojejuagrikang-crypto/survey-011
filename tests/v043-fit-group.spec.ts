import { test, expect, type Page } from '@playwright/test';
import { fitGroups } from '../src/components/voice/fitGroup';
import {
  HERO_LABEL_BASELINE_PX,
  HERO_LABEL_RESERVE_SCALE,
  HERO_MIN_FONT_PX,
} from '../src/components/voice/heroLayout';
import {
  boot,
  COLUMNS,
  PHONE_375,
  PHONE_402,
  PREV_ROUND,
  SETTINGS,
} from './fixtures/activeZones';
import { fireStt, fireSttInterim, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

async function heroValueMetrics(page: Page) {
  return page.locator('[data-hero-state="listening"]').evaluate((container) => {
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
    };
  });
}

async function heroLabelMetrics(page: Page, state: 'confirm' | 'review' = 'confirm') {
  return page.locator(`[data-hero-state="${state}"]`).evaluate((container) => {
    const label = container.querySelector<HTMLElement>('[data-fit-group="label"]');
    if (!label) throw new Error('label fit member 없음');
    const fontSize = parseFloat(getComputedStyle(label).fontSize);
    const value = container.querySelector<HTMLElement>('[data-fit-group="value"]');
    return {
      fontSize,
      offsetHeight: label.offsetHeight,
      lineBoxRatio: label.offsetHeight / fontSize,
      clientWidth: label.clientWidth,
      scrollWidth: label.scrollWidth,
      fitLabel: getComputedStyle(container).getPropertyValue('--fit-label').trim(),
      valueFontSize: value ? parseFloat(getComputedStyle(value).fontSize) : 0,
    };
  });
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
  const grouped = await page.evaluate(fitGroups, {
    container,
    groups: [{ variable: '--fit-probe', members: [short, long], searchBasePx: 32 }],
  });
  const groupedMetrics = await page.locator('#fit').evaluate((el) => {
    const shortEl = el.querySelector<HTMLElement>('#short')!;
    const longEl = el.querySelector<HTMLElement>('#long')!;
    return {
      shortSize: parseFloat(getComputedStyle(shortEl).fontSize),
      longSize: parseFloat(getComputedStyle(longEl).fontSize),
      longScroll: longEl.scrollWidth,
      longClient: longEl.clientWidth,
    };
  });
  expect(groupedMetrics.shortSize, '같은 계열은 같은 배율').toBeCloseTo(groupedMetrics.longSize, 3);
  expect(groupedMetrics.longScroll, '긴 멤버도 배정 폭 안').toBeLessThanOrEqual(groupedMetrics.longClient + 1);

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
  expect(wide.memberScrollWidth).toBeLessThanOrEqual(wide.memberClientWidth + 1);
  expect(wide.widthStyle).toBe('100%');
  expect(wide.whiteSpace).toBe('nowrap');
  expect(wide.overflow).toBe('hidden');
  console.log(`[fit-growth] width ${narrow.containerWidth}→${wide.containerWidth}px, font ${narrow.fontSize.toFixed(2)}→${wide.fontSize.toFixed(2)}px`);
});

test('confirm 항목명 — 402·375에서 잘리지 않고 기준 리비전 크기를 회복한다', async ({ page }) => {
  // 실행 전 오라클 고정: ba87426 실측 61.67px(402)·53.52px(375)의 90% 이내를 허용한다.
  // flexShrink:0만 넣은 32.93px·22px는 이 기준에서 반드시 red다.
  const cases = [
    { viewport: PHONE_402, minFontPx: HERO_LABEL_BASELINE_PX.standard, baselineValuePx: 132.82 },
    { viewport: PHONE_375, minFontPx: HERO_LABEL_BASELINE_PX.compact, baselineValuePx: 123.90 },
  ] as const;
  for (const { viewport, minFontPx, baselineValuePx } of cases) {
    await boot(page, viewport);
    await waitForTtsIdle(page);
    await fireStt(page, '100.0', 300);
    await expect(page.locator('[data-hero-state="confirm"]')).toBeVisible();
    const metrics = await heroLabelMetrics(page);
    console.log(`[fit-confirm-label] ${viewport.width}x${viewport.height} label=${metrics.fontSize.toFixed(2)}px box=${metrics.offsetHeight}px ratio=${metrics.lineBoxRatio.toFixed(2)} fit=${metrics.fitLabel} value=${metrics.valueFontSize.toFixed(2)}px`);
    expect(metrics.lineBoxRatio, `${viewport.width}px 항목명 line box가 글자를 온전히 담는다`)
      .toBeGreaterThanOrEqual(0.9);
    expect(metrics.fontSize, `${viewport.width}px 항목명이 ba87426 기준 크기를 회복한다`)
      .toBeGreaterThanOrEqual(minFontPx);
    expect(Number(metrics.fitLabel), `${viewport.width}px 프로덕션 라벨 예약 배선이 유지된다`)
      .toBeGreaterThanOrEqual(HERO_LABEL_RESERVE_SCALE);
    expect(metrics.valueFontSize, `${viewport.width}px 라벨 예약이 값 성장을 ba87426보다 깎지 않는다`)
      .toBeGreaterThanOrEqual(baselineValuePx);
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
    const confirmMetrics = await heroLabelMetrics(page, 'confirm');
    console.log(`[fit-matrix] state=confirm viewport=${viewport.width}x${viewport.height} label=${label} font=${confirmMetrics.fontSize.toFixed(2)}px box=${confirmMetrics.offsetHeight}px ratio=${confirmMetrics.lineBoxRatio.toFixed(2)} width=${confirmMetrics.scrollWidth}/${confirmMetrics.clientWidth} value=${confirmMetrics.valueFontSize.toFixed(2)}px floor=${confirmMetrics.fontSize <= HERO_MIN_FONT_PX.name + 0.05}`);
    expect(confirmMetrics.lineBoxRatio, 'confirm 라벨 line box').toBeGreaterThanOrEqual(0.9);
    expect(confirmMetrics.fontSize, 'confirm 라벨 하한').toBeGreaterThanOrEqual(HERO_MIN_FONT_PX.name);
    expect(confirmMetrics.scrollWidth, 'confirm 라벨 nowrap 폭').toBeLessThanOrEqual(confirmMetrics.clientWidth + 1);
    expect(confirmMetrics.valueFontSize, 'confirm 확정값 하한').toBeGreaterThanOrEqual(HERO_MIN_FONT_PX.value);

    await expect(page.locator('[data-hero-state="listening"]')).toBeVisible({ timeout: 4000 });
    await waitForTtsIdle(page);
    await fireStt(page, '-355.5', 300);
    await expect(page.locator('[data-hero-state="review"]')).toBeVisible({ timeout: 4000 });
    const reviewMetrics = await heroLabelMetrics(page, 'review');
    console.log(`[fit-matrix] state=review viewport=${viewport.width}x${viewport.height} label=${label}보조 font=${reviewMetrics.fontSize.toFixed(2)}px box=${reviewMetrics.offsetHeight}px ratio=${reviewMetrics.lineBoxRatio.toFixed(2)} width=${reviewMetrics.scrollWidth}/${reviewMetrics.clientWidth} value=${reviewMetrics.valueFontSize.toFixed(2)}px floor=${reviewMetrics.fontSize <= HERO_MIN_FONT_PX.name + 0.05}`);
    expect(reviewMetrics.lineBoxRatio, 'review 라벨 line box').toBeGreaterThanOrEqual(0.9);
    expect(reviewMetrics.fontSize, 'review 라벨 하한').toBeGreaterThanOrEqual(HERO_MIN_FONT_PX.name);
    expect(reviewMetrics.scrollWidth, 'review 라벨 nowrap 폭').toBeLessThanOrEqual(reviewMetrics.clientWidth + 1);
    expect(reviewMetrics.valueFontSize, 'review 확정값 하한').toBeGreaterThanOrEqual(HERO_MIN_FONT_PX.value);
  });
}

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

test('ModifyIndicatorPill — 기존 useFitScale 렌더 계약을 유지한다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await fireStt(page, '100.0', 500);
  await waitForTtsIdle(page);
  await fireStt(page, '수정', 500);
  const pill = page.locator('[data-testid="modify-indicator"]');
  await expect(pill).toBeVisible();
  const metrics = await pill.evaluate((el) => {
    const style = getComputedStyle(el);
    const name = el.querySelectorAll('span')[1];
    return {
      fitLo: style.getPropertyValue('--fit-lo').trim(),
      fitHi: style.getPropertyValue('--fit-hi').trim(),
      fitValue: style.getPropertyValue('--fit-value').trim(),
      nameSize: parseFloat(getComputedStyle(name).fontSize),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    };
  });
  expect(metrics.fitLo).toBe('1');
  expect(metrics.fitHi).toBe('1');
  expect(metrics.fitValue, '새 훅이 범위 밖 카드로 새지 않는다').toBe('');
  expect(metrics.nameSize, '402px 기준 기존 min(9vw,6.2vh) 렌더').toBeCloseTo(36.18, 1);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);
  console.log(`[modify-unchanged] lo=${metrics.fitLo} hi=${metrics.fitHi} name=${metrics.nameSize.toFixed(2)}px fitValue=${metrics.fitValue || '(unset)'}`);
});
