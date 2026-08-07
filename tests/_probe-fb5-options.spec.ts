/**
 * FB-5 처방 후보 **목업** — 소스를 고치지 않고 두 안의 화면을 만든다 (레인 P · 2026-08-07).
 *
 * 🔴 **이 프로브는 처방을 고르지 않는다.** §0-2가 요구하는 *"두 해석을 다 만들어 나란히
 * 보여주는 것"* 을 위한 물건이다. 수정은 BLOCKING이므로(`_ASK-P.md`) **소스는 건드리지 않고**
 * `page.addStyleTag`로 각 안을 흉내내 402×513·complete를 찍는다.
 *
 *  현재  — 접힌 조절판 필이 체크 글리프 13/22셀을 덮는다
 *  안 A  — **필이 양보한다**: 필을 격자 아래로 내린다(도트는 그대로)
 *  안 B  — **도트가 양보한다**: 격자를 필 위로 올린다(필은 그대로)
 *
 * ⚠️ 목업은 「그 안을 택하면 화면이 대략 이렇게 된다」를 보여줄 뿐 구현이 아니다.
 *    실제 처방은 레이아웃 예산(밴드 높이·하단 트랙 계약)을 함께 봐야 한다.
 *
 * 돌리는 법:
 *   npx playwright test tests/_probe-fb5-options.spec.ts --config=playwright.probe.config.ts --workers=1
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { boot, PHONE_402, fillAllRows } from './fixtures/activeZones';

test.setTimeout(180_000);

const SHORT = { width: 402, height: 513 };
const OUT = path.join(process.cwd(), '_probe-out', 'fb5');

/** 실측(08-07): 402×513에서 행 피치 5px · 예약 예산 20px · 필 높이 42px.
 *  → 필이 표시 행을 22px(≈4.4행) 침범한다. 목업은 그 22px를 어느 쪽이 흡수하는지만 가른다. */
const INTRUSION_PX = 22;

const MOCKS = {
  '현재-가림': '',
  // 안 A — 필이 양보: 필을 침범량만큼 아래로 내린다. 도트 격자는 손대지 않는다.
  'A-필이양보': `
    [data-testid="input-control-toggle"] {
      transform: translateY(${INTRUSION_PX}px) !important;
    }`,
  // 안 B — 도트가 양보: 격자를 침범량만큼 위로 올린다. 필은 손대지 않는다.
  'B-도트가양보': `
    [data-testid="state-dots"] {
      transform: translateY(-${INTRUSION_PX}px) !important;
    }`,
};

for (const [label, css] of Object.entries(MOCKS)) {
  test(`FB-5 목업 — ${label}`, async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });

    // 실기기 도달 경로 — 874로 boot 후 축소(직접 boot은 start 버튼 disabled로 무판정).
    await boot(page, PHONE_402, { preserveAnimations: true });
    await page.setViewportSize(SHORT);
    await page.waitForTimeout(400);
    await fillAllRows(page);

    const dots = page.locator('[data-testid="state-dots"]');
    await expect(dots, 'complete = check 글리프').toHaveAttribute('data-glyph', 'check');
    await page.waitForTimeout(700);

    if (css) await page.addStyleTag({ content: css });
    await page.waitForTimeout(300);

    // 하단 밴드 주변만 — 도트와 필의 관계가 보이는 범위.
    const bar = page.locator('[data-testid="voice-control-bar"]');
    await bar.screenshot({ path: path.join(OUT, `option-${label}.png`) });
    console.log(`[fb5:option] ${label} 저장`);
  });
}
