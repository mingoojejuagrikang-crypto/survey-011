/**
 * §C4 (v0.44.0 플랜 — F12) 오라클: 상태 톤 재배치.
 *  - amber의 의미: 일시정지 → **수정모드**. 일시정지는 **mono 점멸**(4번째 색을 추가하지 않는다).
 *  - 점멸 대상 5종: 엣지글로우·하이라이트(활성칩 강조)·도트매트릭스·진행바·활성칩.
 *    🔴 하단 버튼·네비게이션·서랍은 **정지**한다 — 전부 깜빡이면 상태 표시가 사라진다.
 *
 * 재는 축: ① 톤 배선(data-voice-tone) ② 점멸 **실동작**(computed animationName — 속성만 붙는
 *          가짜 오라클 차단, 플랜 §C4 반증) ③ 주기 1.2s(CSSOM 선언값 — `fixtures/stt.ts:63`이
 *          디플레이크로 computed duration을 0으로 만든다) ④ 버튼 정지 ⑤ 수정모드 amber.
 * 안 재는 축: mono 대비비(15.49:1/7.55:1)는 Larry 계산 검증으로 닫혔다(플랜 §C4 검산) ·
 *             reduced-motion 경로(기존 v035 계약이 잰다).
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402 } from './fixtures/activeZones';
import { fireStt } from './fixtures/stt';

test.setTimeout(120_000);

async function waitForActiveChip(page: Page, colName: string, timeout = 6000) {
  await expect(
    page.locator(`[data-testid="column-chip"][data-active="true"][data-col-name="${colName}"]`),
  ).toBeVisible({ timeout });
}

const MONO_TARGETS: Record<string, string> = {
  edgeGlow: '[data-testid="edge-glow"] [data-glow-pulse]',
  dots: '[data-testid="state-dots"] span[data-on="true"]',
  progress: '[data-testid="voice-progress-fill"]',
  activeChip: '[data-testid="column-chip"][data-active="true"]',
};

async function animOf(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).animationName);
}

test('C4 — 일시정지: 상태색 요소가 pauseMonoPulse로 점멸하고 하단 버튼 4개는 정지한다', async ({ page }) => {
  await boot(page, PHONE_402);
  // 기준선: 듣는 중은 green이다.
  await expect(page.locator('[data-voice-tone="green"]')).toHaveCount(1);

  await page.locator('button[title="일시정지"]').click();
  await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-glyph', 'pause');
  // ① 톤 배선 — 일시정지는 amber가 아니라 mono다(민구 확정 08-02, §4-a 6).
  await expect(page.locator('[data-voice-tone="mono"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="edge-glow"]')).toHaveAttribute('data-tone', 'mono');

  // ② 점멸 실동작 — data-tone만 붙고 애니메이션이 없으면 가짜다(플랜 §C4 반증 축).
  for (const [name, selector] of Object.entries(MONO_TARGETS)) {
    expect(await animOf(page, selector), `${name} 점멸 실동작`).toBe('pauseMonoPulse');
  }
  // 도트 색은 mono peak(#E5E7EB) — 점멸 저점(실효 #9CA3AF)에서도 AA를 넘는 설계값의 기점.
  const dotColor = await page.locator('[data-testid="state-dots"]')
    .evaluate((el) => getComputedStyle(el).color);
  expect(dotColor, 'mono peak 색').toBe('rgb(229, 231, 235)');

  // ③ 주기 — computed는 디플레이크 주입으로 0s가 되므로 선언값(CSSOM)으로 잰다.
  const declared = await page.evaluate(() => {
    let duration = '';
    let keyframes = false;
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSKeyframesRule && rule.name === 'pauseMonoPulse') keyframes = true;
        if (rule instanceof CSSStyleRule && rule.style.animationName === 'pauseMonoPulse') {
          duration = rule.style.animationDuration;
        }
      }
    }
    return { duration, keyframes };
  });
  expect(declared.keyframes, 'keyframes 실재').toBe(true);
  expect(declared.duration, 'WCAG 2.3.1 안전 주기(0.83Hz)').toBe('1.2s');

  // ④ 하단 버튼 4개는 점멸하지 않는다 — 이걸 안 박으면 코더가 버튼까지 점멸시킨다(플랜 §C4).
  const buttonAnims = await page.locator('[data-testid="voice-nav-row"] > button')
    .evaluateAll((buttons) => buttons.map((b) => getComputedStyle(b).animationName));
  expect(buttonAnims, '버튼 4개').toHaveLength(4);
  for (const anim of buttonAnims) expect(anim, '일시정지 중 버튼 정지').toBe('none');

  // 재시작 → green 복귀, mono 점멸 소멸(엣지글로우는 edge-pulse 호흡으로 되돌아간다).
  await page.locator('button[title="재시작"]').click();
  await expect(page.locator('[data-voice-tone="green"]')).toHaveCount(1);
  expect(await animOf(page, MONO_TARGETS.edgeGlow), '재시작 후 mono 소멸').toBe('edge-pulse');
});

test('C4 — 수정모드는 amber다(일시정지에서 의미 이동, 4번째 색 없음)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForActiveChip(page, '측정항목01');
  // 첫 컬럼은 추세 규칙(increase)이 걸려 있다 — 직전값(100.0)을 그대로 넣어 알람 없이 커밋한다.
  await fireStt(page, '100.0', 500);
  await waitForActiveChip(page, '측정항목02');
  // "수정" — 직전 커밋 셀 재입력 모드. modify indicator가 서고 톤이 amber로 돈다.
  await fireStt(page, '수정', 700);
  await expect(page.locator('[data-testid="modify-indicator"]')).toBeVisible({ timeout: 4000 });
  await expect(page.locator('[data-voice-tone="amber"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="edge-glow"]')).toHaveAttribute('data-tone', 'amber');
  // 진행바도 같은 신호를 쓴다(상태색 요소 전체 톤 변경 — F12 원문).
  const fill = await page.locator('[data-testid="voice-progress-fill"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(fill, '진행바 amber').toBe('rgb(255, 234, 0)');
});
