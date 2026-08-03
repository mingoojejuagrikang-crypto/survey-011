/**
 * v0.44.0 A2 — 🔴 **§C0 인수인계 오라클: 알람 카드 compare 슬롯에 fit 배선이 없다.**
 *
 *  ── 왜 이 파일이 있나 ────────────────────────────────────────────────────────
 *  A0가 규명한 근본원인(넘친 것을 넘쳤다고 판정 못함)을 A1이 `fitGroup.ts`에서,
 *  A2가 `useFitScale.ts`에서 닫았다. 그런데 **알람 카드에서는 판정이 정확해져도
 *  값이 줄지 않는다** — `heroLayout.ts`의 두 상수가 fit 변수를 **소비하지 않기 때문이다**:
 *
 *    STATE_TYPE.alarmLabel   = 'max(17px, calc(clamp(22px, min(6.6vw,3.6vh), 36px) * var(--fit-lo,1)))'
 *                                                                                  ↑ 쓴다
 *    STATE_TYPE.compareLabel = 'max(22px, 13.93vw)'   ← 🔴 var(--fit-*) 없음
 *    STATE_TYPE.compareValue = 'max(30px, 19.4vw)'    ← 🔴 var(--fit-*) 없음
 *
 *  결과(375×667 실측, A2 처방 전후 대조):
 *    - 처방 전: `--fit-lo` **1.12**(첫 단계) · headline **26.89px** · next-value 우측 초과 **+33.344px**
 *    - 처방 후: `--fit-lo` **0.13**(최저 단계) · headline **17px** · 초과 **+33.344px (그대로)**
 *
 *  즉 fit이 초과를 **보게** 되자 단계를 끝까지 내렸는데, 정작 넘치는 `compareValue`는
 *  `--fit-lo`를 안 쓰므로 크기가 안 변했다(19.4vw = 375px에서 72.75px 고정).
 *  🔴 **못 고치는 초과를 보고, 고칠 수 있는 headline만 하한까지 깎은 것이다.**
 *
 *  ── 이 파일이 재는 것 ────────────────────────────────────────────────────────
 *  🔴 **`test.fail()`로 「지금은 실패하는 것이 정상」임을 선언한다.**
 *   - **지금**: 단언이 실패 → `test.fail()` 덕에 「예상된 실패」로 green.
 *   - 🔴 **§C0가 `compareValue`/`compareLabel`에 fit 변수를 배선하면**: compare가 줄어
 *     초과가 해소되고 fit이 바닥까지 갈 이유가 없어져 headline이 하한에서 떨어진다
 *     → 단언이 **통과** → `test.fail()`이라 **red**가 난다.
 *     **그때가 이 파일을 지울 때다**(`test.fail()`을 지우고 정상 오라클로 승격).
 *
 *  이 구조를 쓰는 이유: 말로 적은 제약은 다음 회차에 안 지켜진다(`UI-e2` 교훈).
 *  **오라클이 된 제약만 남는다.** 배선이 들어오는 순간 CI가 알려준다.
 *
 *  ⚠️ 기대값은 **리터럴**이다(`STATE_TYPE`을 import하지 않는다). 제품 상수를 빌리면
 *     둘을 같은 diff로 바꿀 때 통과해버려 파손을 감춘다(COMMON §4).
 */
import { test, expect } from '@playwright/test';
import { boot, triggerAnomaly } from './fixtures/activeZones';

test.setTimeout(120_000);

/** `STATE_TYPE.alarmLabel`의 하한. 리터럴로 박는다 — 제품 상수를 import하지 않는다. */
const ALARM_LABEL_FLOOR_PX = 17;

test('🔴 §C0 대기 — 375×667 알람 headline이 하한에 붙어 있지 않다', async ({ page }) => {
  // 🔴 지금은 실패가 정상이다. C0가 compareValue/compareLabel에 fit 변수를 배선하면
  //    이 단언이 통과하면서 **이 줄 때문에 red**가 난다 — 그게 「배선이 들어왔다」는 신호다.
  test.fail();

  await boot(page, { width: 375, height: 667 });
  await triggerAnomaly(page);
  await page.waitForTimeout(300);

  const m = await page.locator('[data-testid="anomaly-alert"]').evaluate((card) => {
    const headline = card.querySelector<HTMLElement>('[data-testid="anomaly-headline"]');
    const nextValue = card.querySelector<HTMLElement>('[data-testid="anomaly-next-value"]');
    const inkOverflowRight = (el: HTMLElement | null) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const px = (v: string) => Number.parseFloat(v) || 0;
      const box = el.getBoundingClientRect();
      const contentRight = box.right - px(cs.borderRightWidth) - px(cs.paddingRight);
      const r = document.createRange();
      r.selectNodeContents(el);
      return +(r.getBoundingClientRect().right - contentRight).toFixed(3);
    };
    return {
      fitLo: card.style.getPropertyValue('--fit-lo').trim(),
      headlineFontPx: headline ? parseFloat(getComputedStyle(headline).fontSize) : 0,
      nextValueFontPx: nextValue ? parseFloat(getComputedStyle(nextValue).fontSize) : 0,
      nextValueOverflowRightPx: inkOverflowRight(nextValue),
    };
  });
  console.log(`[c0-gate] fit-lo=${m.fitLo} headline=${m.headlineFontPx}px `
    + `next-value=${m.nextValueFontPx}px overflowRight=${m.nextValueOverflowRightPx}px`);

  // 🔴 핵심 단언 — headline이 하한(17px)에 붙어 있으면 「fit이 바닥까지 내려갔다」는 뜻이고,
  //    그건 compare 슬롯이 fit 변수를 안 써서 초과가 해소되지 않았기 때문이다.
  expect(
    m.headlineFontPx,
    'compare 슬롯에 fit 배선이 들어오면 초과가 해소돼 headline이 하한에서 떨어진다',
  ).toBeGreaterThan(ALARM_LABEL_FLOOR_PX + 0.5);
});
