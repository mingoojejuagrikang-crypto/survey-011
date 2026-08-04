/**
 * §C2·§C3 (v0.44.0 플랜 — F02·F16·F22·F15·F21) 오라클.
 *
 * 재는 축: ① 행동행 4버튼 테두리 무채색 동일(F02 — ui-standard §4 기능색 규정은 §4-b 폐기)
 *          ② 심볼 높이/버튼 높이 = 0.70 ± 0.02 (F02 — 50%에서 상향)
 *          ③ 종료확인 4→2버튼 + 총 폭 보존(F16·F22 — "누르기 전과 같은 사이즈")
 *          ④ 중앙 종료 버튼 부재(F15·F21) · 저장확인 중앙 3행(완료행 / N/M / ✓ 안내)
 *          ⑤ 끝 도달 시 하단 종료 버튼 점멸 **실동작**(F21 — data-status만 있고 애니메이션이
 *             없던 미구현을 [TEAMOPS-37] 압력으로 잰다: CSS 규칙을 지우면 red)
 * 안 재는 축: 버튼 심볼의 시각 렌더 품질(FE0E 텍스트 프레젠테이션은 실기기 육안 확인 대상) ·
 *             점멸의 광과민 안전(주기 리터럴로만 단언) · exit/anomaly 버튼의 기능색(유지 계약).
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, fillAllRows, PHONE_402 } from './fixtures/activeZones';

test.setTimeout(120_000);

const TABLET_640 = { width: 640, height: 1024 } as const;

async function navButtonMetrics(page: Page) {
  return page.locator('[data-testid="voice-nav-row"]').evaluate((row) => {
    const buttons = Array.from(row.querySelectorAll(':scope > button')) as HTMLElement[];
    const rects = buttons.map((b) => b.getBoundingClientRect());
    return {
      titles: buttons.map((b) => b.getAttribute('title')),
      borderColors: buttons.map((b) => getComputedStyle(b).borderColor),
      widths: rects.map((r) => r.width),
      span: rects.length ? rects[rects.length - 1].right - rects[0].left : 0,
      symbols: (Array.from(row.querySelectorAll('[data-testid="control-symbol"]')) as HTMLElement[])
        .map((symbol) => ({
          fontSize: Number.parseFloat(getComputedStyle(symbol).fontSize),
          buttonHeight: (symbol.closest('button') as HTMLElement).getBoundingClientRect().height,
        })),
    };
  });
}

test('C2 — 행동행 4버튼 테두리는 전부 같은 무채색이고 심볼은 버튼 높이의 70%다', async ({ page }) => {
  await boot(page, PHONE_402);
  for (const viewport of [PHONE_402, TABLET_640]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(250);
    const m = await navButtonMetrics(page);
    expect(m.titles, `${viewport.width}: 4버튼`).toHaveLength(4);
    // F02 — 테두리 색 제거. 4개가 전부 동일해야 하고, 기능색(red/amber)이 아니어야 한다.
    for (const color of m.borderColors) {
      expect(color, `${viewport.width}: 무채색 통일`).toBe(m.borderColors[0]);
      expect(color, `${viewport.width}: 빨강 금지`).not.toContain('255, 23, 68');
      expect(color, `${viewport.width}: 노랑 금지`).not.toContain('255, 234, 0');
    }
    // 문양 = 버튼 높이의 70% (ui-standard §3-1은 50%였다 — 이 스펙이 정정 SSOT다).
    for (const symbol of m.symbols) {
      expect(symbol.fontSize / symbol.buttonHeight, `${viewport.width}: 심볼/버튼`).toBeGreaterThan(0.68);
      expect(symbol.fontSize / symbol.buttonHeight, `${viewport.width}: 심볼/버튼`).toBeLessThan(0.72);
    }
  }
});

test('C3 — 종료확인은 2버튼이 4버튼 총 폭을 나눠 갖는다(F16 총 폭 보존)', async ({ page }) => {
  await boot(page, PHONE_402);
  const before = await navButtonMetrics(page);
  expect(before.titles).toHaveLength(4);

  await page.locator('button[title="일시정지"]').click();
  await page.locator('button[title="입력 종료"]').click();
  await expect(page.locator('[data-testid="exit-confirm-inline"]')).toBeVisible({ timeout: 4000 });

  const after = await navButtonMetrics(page);
  expect(after.titles, '‹ ›는 렌더하지 않는다').toEqual(['계속 입력', '종료 확인']);
  // 진입 전후 하단 버튼 트랙 총 폭 동일 — F16의 요구를 기계가 잰다.
  expect(Math.abs(after.span - before.span), '총 폭 보존').toBeLessThan(2);
  // 2버튼이 4버튼 폭을 나눠 가져 개별 폭이 약 2배가 된다(gap 8px 감안 1.8배 하한).
  for (const width of after.widths) {
    expect(width, '개별 버튼 폭 확대').toBeGreaterThan(before.widths[0] * 1.8);
  }
});

test('C3 — 중앙 종료 버튼은 없다. 저장확인 중앙은 3행(완료행 / N/M / ✓ 안내)이다', async ({ page }) => {
  await boot(page, PHONE_402);
  await fillAllRows(page);
  const summary = page.locator('[data-testid="complete-summary"]');
  await expect(summary).toBeVisible({ timeout: 8000 });
  // F15·F21 — 중앙 종료 버튼 삭제. 하단 ⏹(voice-status-control)이 유일한 종료 진입점이다.
  await expect(summary.locator('button'), '중앙에 버튼이 없다').toHaveCount(0);

  const persistentExit = page.locator('[data-testid="voice-status-control"][data-status="exit"]');
  await expect(persistentExit).toBeVisible();
  await persistentExit.click();

  const inline = page.locator('[data-testid="exit-confirm-inline"]');
  await expect(inline).toBeVisible({ timeout: 4000 });
  // 중앙 3행 — 완료행 / 2/2 / ✓ 터치시 저장하고 종료합니다.
  await expect(inline.locator('[data-testid="exit-confirm-rows-label"]')).toHaveText('완료행');
  await expect(inline.locator('[data-testid="exit-confirm-rows"]')).toHaveText('2/2');
  await expect(inline.locator('[data-testid="exit-confirm-hint"]')).toContainText('터치시 저장하고 종료합니다');
});

test('F21 — 끝 도달 시 하단 종료 버튼이 점멸한다(속성이 아니라 애니메이션 실동작)', async ({ page }) => {
  await boot(page, PHONE_402);
  await fillAllRows(page);
  const persistentExit = page.locator('[data-testid="voice-status-control"][data-status="exit"]');
  await expect(persistentExit).toBeVisible({ timeout: 8000 });
  // [TEAMOPS-37] — data-status="exit"만 붙고 애니메이션이 없으면 F21은 미구현이다(W2 실측).
  // ⚠️ 주기는 computed로 못 잰다 — `fixtures/stt.ts:63`이 디플레이크용으로 전역
  // `animation-duration: 0ms !important`를 주입한다. 이름(computed)으로 「규칙이 이 요소에
  // 실제로 물렸다」를, 주기는 CSSOM 선언값으로 「사용자에게 나가는 값」을 각각 잰다.
  const anim = await persistentExit.evaluate((el) => {
    const name = getComputedStyle(el).animationName;
    let declaredDuration = '';
    let keyframesFound = false;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSKeyframesRule && rule.name === 'exit-pulse') keyframesFound = true;
        if (rule instanceof CSSStyleRule && el.matches(rule.selectorText.replace(/:not\([^)]*\)/g, ''))
          && rule.style.animationName === 'exit-pulse') {
          declaredDuration = rule.style.animationDuration;
        }
      }
    }
    return { name, declaredDuration, keyframesFound };
  });
  expect(anim.name, '점멸 규칙이 이 요소에 물렸다').toBe('exit-pulse');
  expect(anim.keyframesFound, 'keyframes 실재').toBe(true);
  expect(anim.declaredDuration, 'WCAG 2.3.1 안전 주기(선언값)').toBe('1.2s');

  // 일시정지에서는 점멸이 멈춘다 — §C4 "버튼은 점멸 대상이 아니다"와 같은 계약.
  // 기제: indicatorExit(`ActiveState:345`)가 `!paused`를 품어 exit 상태 자체가 내려가고,
  // CSS도 :not([data-mode="paused"])로 이중 방어한다. 여기선 그 귀결(점멸 원천 소멸)을 잰다.
  await page.locator('button[title="일시정지"]').click();
  await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-glyph', 'pause');
  await expect(page.locator('[data-status="exit"]'), '일시정지 중 exit 상태 소멸').toHaveCount(0);
  const pausedAnim = await page.locator('[data-testid="voice-control-stop"]')
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(pausedAnim, '일시정지 중 종료 버튼 정지').toBe('none');
});
