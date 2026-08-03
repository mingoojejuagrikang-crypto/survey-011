/**
 * 🔴 **A2 임시 계측 — lineHeight 처방의 블래스트 반경. 규명이 끝나면 삭제한다.**
 *
 *  `COMPARE_VALUE`(1.02) · `COMPARE_LABEL`(1.1)을 임계(1.15) 이상으로 올리면 line box가
 *  커져 **세로 공간을 더 먹는다.** Larry 조건 2: 알람 카드가 3구역 배분 안에 여전히 들어가는지,
 *  `UI-e4` 알람 계약(좌우 배치 · dotless)이 안 깨지는지 먼저 재라.
 */
import { test, expect } from '@playwright/test';
import { boot, triggerAnomaly } from './fixtures/activeZones';

test.setTimeout(120_000);

const SNAP = `() => {
  const card = document.querySelector('[data-testid="anomaly-alert"]');
  if (!card) return null;
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), h: +b.height.toFixed(2), w: +b.width.toFixed(2) }; };
  const q = (s) => document.querySelector(s);
  const cmp = q('[data-testid="anomaly-comparison"]');
  // UI-e4 계약: 알람 응답 버튼이 좌우로 배치되고, 상태도트는 알람 중 미렌더(dotless)
  const modify = q('[data-testid="anomaly-modify"]');
  const confirmBtn = q('[data-testid="anomaly-confirm"]');
  const dots = document.querySelectorAll('[data-testid="state-dots"]');
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    card: { ...box(card), scrollH: card.scrollHeight, clientH: card.clientHeight,
            excess: card.scrollHeight - card.clientHeight },
    comparison: cmp ? { ...box(cmp), scrollH: cmp.scrollHeight, clientH: cmp.clientHeight,
            excess: cmp.scrollHeight - cmp.clientHeight } : null,
    parent: box(card.parentElement),
    // 카드가 부모(중앙 트랙) 안에 있는가 = 3구역 배분 준수
    withinParent: (() => { const c = card.getBoundingClientRect(), p = card.parentElement.getBoundingClientRect();
      return { topOk: c.top >= p.top - 0.5, bottomOk: c.bottom <= p.bottom + 0.5,
               overflowBottomPx: +(c.bottom - p.bottom).toFixed(2) }; })(),
    uiE4: { modifyBox: box(modify), confirmBox: box(confirmBtn), stateDotsCount: dots.length },
    values: ['anomaly-prev-label','anomaly-prev-value','anomaly-next-label','anomaly-next-value','anomaly-headline']
      .map((t) => { const el = q('[data-testid="' + t + '"]'); if (!el) return null;
        const cs = getComputedStyle(el);
        return { t, fontSize: cs.fontSize, lineHeight: cs.lineHeight,
                 ratio: +(parseFloat(cs.lineHeight)/parseFloat(cs.fontSize)).toFixed(4),
                 excess: el.scrollHeight - el.clientHeight }; }).filter(Boolean),
  };
}`;

for (const vp of [{ width: 375, height: 667 }, { width: 402, height: 874 }] as const) {
  test(`[A2-BLAST] lineHeight 1.2 적용 시 세로 여유 @ ${vp.width}x${vp.height}`, async ({ page }) => {
    await boot(page, vp);
    await triggerAnomaly(page);
    await page.waitForTimeout(300);

    const before = await page.evaluate((fn) => {
      // eslint-disable-next-line no-eval
      return (eval(fn) as () => unknown)();
    }, SNAP);
    console.log(`=== A2-BLAST::${vp.width}x${vp.height}::before ===\n` + JSON.stringify(before, null, 1));

    // 🔴 처방 시뮬레이션 — !important로 강제한다(무시 현상 때문에 일반 설정은 안 먹는다).
    const after = await page.evaluate((fn) => {
      document.querySelectorAll<HTMLElement>(
        '[data-testid="anomaly-prev-label"],[data-testid="anomaly-next-label"]',
      ).forEach((el) => el.style.setProperty('line-height', '1.2', 'important'));
      document.querySelectorAll<HTMLElement>(
        '[data-testid="anomaly-prev-value"],[data-testid="anomaly-next-value"]',
      ).forEach((el) => el.style.setProperty('line-height', '1.2', 'important'));
      void document.body.offsetHeight;
      // eslint-disable-next-line no-eval
      return (eval(fn) as () => unknown)();
    }, SNAP);
    console.log(`=== A2-BLAST::${vp.width}x${vp.height}::after ===\n` + JSON.stringify(after, null, 1));
    expect(before).toBeTruthy();
  });
}
