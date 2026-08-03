/**
 * 🔴 **A2 레인 조사용 임시 계측 스펙 — 오라클이 아니다. 규명이 끝나면 삭제한다.**
 *
 *  A1이 `fitGroup.ts`(신 훅)만 고쳤고 `useFitScale.ts`(구 훅)에 같은 판정이 남아 있었다.
 *  A2가 `overflowsWidth`를 공유하도록 바꿨다. 이 스펙이 재는 것:
 *
 *   - **과제 1 반증:** 구 훅 경로(`AnomalyAlertPopup`)가 실제로 새 판정을 타는가
 *     (`data-fit-measured-by`), 처방 전후 `--fit-lo`가 달라지는가.
 *   - **과제 2 진단:** C0를 막은 높이 초과가 **진짜 넘침인가 측정 산물인가**.
 *     Larry 가설 — `lineHeight 1.02` + `bold 900` nowrap 단일행이라 어센더/디센더가
 *     line box를 넘어 `scrollHeight`가 상시 크게 나오는 것 아닌가.
 *   - **§C1 판정:** 390×568에서 칩 여유를 다시 잰다. 칩이 `--fit-lo`를 상속받는지도 함께.
 *
 *  fixture는 `tests/fixtures/activeZones.ts`(다른 스펙과 공유)를 그대로 쓴다.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, triggerAnomaly } from './fixtures/activeZones';

test.setTimeout(120_000);

const PHONE_375 = { width: 375, height: 667 };
const PHONE_390_568 = { width: 390, height: 568 };

/** 요소 하나의 폭·높이 실측. 잉크는 `Range`(float, clip 무관) — 테스트 자기 눈이다. */
const PROBE_FN = `(el, label) => {
  const cs = getComputedStyle(el);
  const px = (v) => Number.parseFloat(v) || 0;
  const box = el.getBoundingClientRect();
  const cl = box.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
  const cr = box.right - px(cs.borderRightWidth) - px(cs.paddingRight);
  const ct = box.top + px(cs.borderTopWidth) + px(cs.paddingTop);
  const cb = box.bottom - px(cs.borderBottomWidth) - px(cs.paddingBottom);
  const r = document.createRange(); r.selectNodeContents(el);
  const ink = r.getBoundingClientRect();
  return {
    label,
    text: (el.textContent || '').trim().slice(0, 18),
    fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontWeight: cs.fontWeight,
    measuredBy: el.dataset.fitMeasuredBy ?? '(none)',
    // 폭 축
    scrollW: el.scrollWidth, clientW: el.clientWidth,
    inkW: +ink.width.toFixed(3), contentW: +(cr - cl).toFixed(3),
    ovLeftPx: +(cl - ink.left).toFixed(3),
    ovRightPx: +(ink.right - cr).toFixed(3),
    // 높이 축 — 🔴 scrollHeight(정수)와 Range 잉크 높이(float)를 나란히 본다
    scrollH: el.scrollHeight, clientH: el.clientHeight,
    inkH: +ink.height.toFixed(3), contentH: +(cb - ct).toFixed(3),
    ovTopPx: +(ct - ink.top).toFixed(3),
    ovBottomPx: +(ink.bottom - cb).toFixed(3),
    heightExcessScroll: el.scrollHeight - el.clientHeight,
    heightExcessInk: +(ink.height - (cb - ct)).toFixed(3),
  };
}`;

const ALARM_SNAPSHOT_FN = `() => {
  // eslint-disable-next-line no-eval
  const probe = ${PROBE_FN};
  const card = document.querySelector('[data-testid="anomaly-alert"]');
  if (!card) return null;
  const q = (sel) => card.querySelector(sel);
  const rows = [['card', card],
    ['headline', q('[data-testid="anomaly-headline"]')],
    ['comparison', q('[data-testid="anomaly-comparison"]')],
    ['prev-label', q('[data-testid="anomaly-prev-label"]')],
    ['prev-value', q('[data-testid="anomaly-prev-value"]')],
    ['next-label', q('[data-testid="anomaly-next-label"]')],
    ['next-value', q('[data-testid="anomaly-next-value"]')]]
    .filter(([, el]) => el);
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    fitLo: card.style.getPropertyValue('--fit-lo').trim() || '(unset)',
    fitHi: card.style.getPropertyValue('--fit-hi').trim() || '(unset)',
    parts: rows.map(([label, el]) => probe(el, label)),
  };
}`;

for (const vp of [PHONE_375, PHONE_390_568] as const) {
  test(`[A2-ALARM] 구 훅 경로 실측 + 높이 초과 진단 @ ${vp.width}x${vp.height}`, async ({ page }) => {
    await boot(page, vp);
    await triggerAnomaly(page);
    await page.waitForTimeout(300);

    const base = await page.evaluate((fn) => {
      // eslint-disable-next-line no-eval
      return (eval(fn) as () => unknown)();
    }, ALARM_SNAPSHOT_FN);
    console.log(`=== A2-ALARM::${vp.width}x${vp.height}::baseline ===\n` + JSON.stringify(base, null, 1));

    // ── 과제 2 격리 실험 ──────────────────────────────────────────────
    // ① lineHeight를 normal로: 초과가 사라지면 「측정 산물(line box가 글리프보다 작다)」이다.
    const lhNormal = await page.evaluate((fn) => {
      document.querySelectorAll<HTMLElement>(
        '[data-testid="anomaly-prev-value"],[data-testid="anomaly-next-value"],' +
        '[data-testid="anomaly-prev-label"],[data-testid="anomaly-next-label"],' +
        '[data-testid="anomaly-headline"]',
      ).forEach((el) => { el.style.lineHeight = 'normal'; });
      void document.body.offsetHeight;
      // eslint-disable-next-line no-eval
      return (eval(fn) as () => unknown)();
    }, ALARM_SNAPSHOT_FN);
    console.log(`=== A2-ALARM::${vp.width}x${vp.height}::lineHeight-normal ===\n` + JSON.stringify(lhNormal, null, 1));

    // ② 🔴 텍스트를 비운다: **빈 상태에서도 초과가 남으면 텍스트 때문이 아니다**(레이아웃 성질).
    const emptied = await page.evaluate((fn) => {
      document.querySelectorAll<HTMLElement>(
        '[data-testid="anomaly-prev-value"],[data-testid="anomaly-next-value"],' +
        '[data-testid="anomaly-prev-label"],[data-testid="anomaly-next-label"],' +
        '[data-testid="anomaly-headline"]',
      ).forEach((el) => { el.style.lineHeight = ''; el.textContent = ''; });
      void document.body.offsetHeight;
      const card = document.querySelector<HTMLElement>('[data-testid="anomaly-alert"]')!;
      return {
        cardScrollH: card.scrollHeight, cardClientH: card.clientHeight,
        excess: card.scrollHeight - card.clientHeight,
      };
    }, ALARM_SNAPSHOT_FN);
    console.log(`=== A2-ALARM::${vp.width}x${vp.height}::emptied ===\n` + JSON.stringify(emptied, null, 1));

    expect(base).toBeTruthy();
  });
}

/** 🔴 회귀의 시각적 크기 — headline 17px가 실제로 얼마나 읽기 나쁜지 눈으로 본다.
 *  §7-1 표는 숫자만 준다. 「37% 축소」가 감수할 만한지는 §C0 우선순위 판단 재료라 그림이 필요하다. */
test('[A2-SHOT] 처방 후 알람 카드 렌더(375×667) — headline 17px 육안 확인', async ({ page }) => {
  await boot(page, PHONE_375);
  await triggerAnomaly(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/a2-alarm-after.png' });
  const m = await page.locator('[data-testid="anomaly-alert"]').evaluate((card) => ({
    fitLo: card.style.getPropertyValue('--fit-lo').trim(),
    headline: card.querySelector('[data-testid="anomaly-headline"]')?.textContent,
    headlinePx: parseFloat(getComputedStyle(
      card.querySelector('[data-testid="anomaly-headline"]') as Element).fontSize),
  }));
  console.log('=== A2-SHOT ===\n' + JSON.stringify(m));
  expect(m.headlinePx).toBeGreaterThan(0);
});

/** §C1 판정 — 처방 후 390×568에서 칩 여유를 다시 잰다.
 *  🔴 함께 확인: 칩이 `--fit-lo`를 **상속받는가**(구 훅은 자기 카드에만 발행한다). */
const CHIP_FN = `() => {
  // eslint-disable-next-line no-eval
  const probe = ${PROBE_FN};
  const chips = Array.from(document.querySelectorAll('[data-testid="column-chip"]'));
  const zone = document.querySelector('[data-testid="chip-zone"]')
            || (chips[0] ? chips[0].parentElement : null);
  const out = [];
  chips.forEach((c, i) => {
    out.push(probe(c, 'chip' + i));
    Array.from(c.querySelectorAll('*')).forEach((k, j) => out.push(probe(k, 'chip' + i + '.' + j)));
  });
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    chipCount: chips.length,
    // 🔴 칩 자신에서 읽는다 — hero root가 아니라. 상속되면 여기 값이 잡힌다.
    chipFitLo: chips[0] ? getComputedStyle(chips[0]).getPropertyValue('--fit-lo').trim() || '(unset)' : null,
    chipFitHi: chips[0] ? getComputedStyle(chips[0]).getPropertyValue('--fit-hi').trim() || '(unset)' : null,
    zone: zone ? probe(zone, 'chip-zone') : null,
    parts: out,
  };
}`;

async function chipSnapshot(page: Page, tag: string) {
  const d = await page.evaluate((fn) => {
    // eslint-disable-next-line no-eval
    return (eval(fn) as () => unknown)();
  }, CHIP_FN);
  console.log(`=== A2-CHIP::${tag} ===\n` + JSON.stringify(d, null, 1));
  return d as Record<string, any>;
}

test('[A2-CHIP] §C1 판정 — 390×568 칩 여유 재측정(알람 전/중)', async ({ page }) => {
  // 390×568은 세로가 짧아 시작 버튼이 화면 밖으로 밀린다(harness 한계). 402로 세션을 연 뒤
  // 목표 뷰포트로 줄인다 — 측정은 390×568에서 한다.
  await boot(page, { width: 402, height: 874 });
  await page.setViewportSize(PHONE_390_568);
  await page.waitForTimeout(500);
  await chipSnapshot(page, '390x568-before-alarm');
  // 🔴 알람이 떠 있을 때 = 구 훅이 실제로 --fit-lo를 발행 중인 유일한 시점.
  //    이때도 칩이 상속을 안 받으면 「칩은 구 훅 사정권 밖」이 확정된다.
  await triggerAnomaly(page);
  await page.waitForTimeout(300);
  const during = await chipSnapshot(page, '390x568-during-alarm');
  expect(during.chipCount).toBeGreaterThan(0);
});
