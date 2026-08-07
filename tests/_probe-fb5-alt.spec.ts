/**
 * FB-5 **제3안 실측** — 「숨기기」가 터치 접근을 죽인다는 것이 드러난 뒤의 대안 탐색.
 * (레인 P · 2026-08-07, 민구 재결정)
 *
 * ## 왜 제3안이 필요했나
 * 「필이 양보 = 숨긴다」로 구현했더니 FB-5는 고쳐졌지만(겹침 13→0) **회귀가 생겼다**:
 * `v0460-fb-b-drawer-reachable @402×513`이 red — 필을 숨기니 서랍을 열 클릭 대상이 없다.
 * 같은 파일 `:210`이 *"접힌 토글은 **언제나** 눌린다(49px 계약 보호)"* 를 단언한다.
 * 민구에게 제시됐던 그림은 「필이 **얇아짐**」이었지 「손가락으로 설정을 못 연다」가 아니었다.
 *
 * 🔴 **판정축은 두 개 동시다:**
 *   ⓐ **도트 가림 0** · ⓑ **터치로 서랍에 닿는다**. **하나만 green인 건 답이 아니다.**
 *
 * ## 🔴 실측 결과 (2026-08-07 · 402×513 · complete · `_probe-out/fb5/alt-*.json`)
 * | 안 | ⓐ가림 | ⓑ터치 | 판정 |
 * |---|---|---|---|
 * | 0 현재 | 13 ❌ | ✅ | 기준선 |
 * | ① 격자를 위로(-22px) | **0** ✅ | ✅ | ⚠️ 켜진 셀 top 293.1이 컨트롤바 top 298.2 **밖** → `overflow:hidden`에 **5.1px 잘린다** |
 * | ② 필 반투명(0.35) | 13 ❌ | ✅ | 🟡 기하 겹침은 남지만 **도트가 비쳐 보인다** — 시각 판정 대상 |
 * | ③ 필 상단 이전 | 17 ❌ | ✅ | ❌ 더 나빠진다 |
 * | — 숨김 | 0 ✅ | **❌** | ❌ 계약 위반 |
 *
 * ## 🔴 왜 셋 다 막히나 — 산술이다 (전부 실측값, 402×513 컨트롤바 125.8px)
 * ```
 *   표시 10행(행피치 5px)  50.0      필을 뺀 순수 도트 공간 = 36.1px
 *   접힌 필(42, 못 줄임)   42.0        (밴드 top 299.2 ~ 필 top 335.3)
 *   행동 버튼 행(min 44)   44.0      → check(33.7px)는 겨우 들어가지만
 *                        ──────        wave/idle(행 0~9 = 50px)은
 *                        136.0 > 125.8   **어떤 이동으로도 공존 불가**
 * ```
 * - 필을 **아래로 못 내린다**: 필 bottom 377.3 vs 행동 행 top 380 → 여유 **2.7px**
 * - 격자를 **위로 못 민다**: 밴드 top 299.2 vs 컨트롤바 top 298.2 → 여유 **1.0px**
 *
 * 👉 근본 해결은 **트랙을 늘리는 것**(`heroLayout.ts`가 접힌 토글에 고정으로 주는 **49px
 * 회수**, WP-G 소관)이거나 셋 중 하나를 줄이는 것이다. **레인 P 소유 안에서 끝나지 않는다.**
 *
 * ⚠️ **이 프로브는 처방을 고르지 않는다** — 소스를 안 고치고 `addStyleTag`로 목업만 만든다.
 * ⚠️ **가드가 살아 있으면 무효 측정이 된다**: 08-07에 숨김 구현이 워크트리에 남은 채 돌려
 *    전 케이스 `필 0~0`(필이 이미 사라진 상태)이 나왔다. **필이 보이는 상태에서 재라.**
 *
 * 돌리는 법:
 *   npx playwright test tests/_probe-fb5-alt.spec.ts --config=playwright.probe.config.ts --workers=1
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { boot, PHONE_402, fillAllRows } from './fixtures/activeZones';

test.setTimeout(180_000);

const SHORT = { width: 402, height: 513 };
const OUT = path.join(process.cwd(), '_probe-out', 'fb5');

/** ⓐ겹침 + ⓑ필 클릭 가능성 + 여유 공간을 **한 번에** 잰다.
 *  🔴 `page.evaluate` 문자열 안에서 모듈 스코프 헬퍼를 부르지 않는다(직렬화 함정). */
const MEASURE = `(() => {
  const pill = document.querySelector('[data-testid="input-control-toggle"]');
  const grid = document.querySelector('[data-testid="state-dots"]');
  const band = document.querySelector('[data-testid="live-listen-band"]');
  const bar  = document.querySelector('[data-testid="voice-control-bar"]');
  const nav  = document.querySelector('[data-testid="voice-nav-row"]');
  if (!grid) return { err: 'no state-dots' };
  const p = pill ? pill.getBoundingClientRect() : null;
  const cs = pill ? getComputedStyle(pill) : null;
  const pillVisible = !!p && p.width > 0 && p.height > 0 && cs.visibility !== 'hidden';
  const g = grid.getBoundingClientRect();
  const b = band ? band.getBoundingClientRect() : null;
  const barR = bar ? bar.getBoundingClientRect() : null;
  const navR = nav ? nav.getBoundingClientRect() : null;

  let overlap = 0, lit = 0, top = Infinity, bottom = -Infinity;
  for (const el of Array.from(grid.querySelectorAll('span'))) {
    if (parseFloat(getComputedStyle(el).opacity) <= 0.3) continue;
    lit++;
    const r = el.getBoundingClientRect();
    top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom);
    if (!pillVisible) continue;
    if (Math.min(r.right, p.right) - Math.max(r.left, p.left) > 0
      && Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top) > 0) overlap++;
  }

  // ⓑ 필 중심점이 실제로 그 필에 히트하는가(다른 요소가 위를 덮지 않았는가).
  let pillHit = false;
  if (pillVisible) {
    const el = document.elementFromPoint(p.left + p.width / 2, p.top + p.height / 2);
    pillHit = !!el && (el === pill || pill.contains(el));
  }

  return {
    lit, overlap, pillVisible, pillHit,
    pillOpacity: cs ? +parseFloat(cs.opacity).toFixed(2) : null,
    litTop: lit ? +top.toFixed(1) : null,
    litBottom: lit ? +bottom.toFixed(1) : null,
    pillTop: p ? +p.top.toFixed(1) : null,
    pillBottom: p ? +p.bottom.toFixed(1) : null,
    gridTop: +g.top.toFixed(1), gridBottom: +g.bottom.toFixed(1),
    bandTop: b ? +b.top.toFixed(1) : null, bandBottom: b ? +b.bottom.toFixed(1) : null,
    barTop: barR ? +barR.top.toFixed(1) : null, barBottom: barR ? +barR.bottom.toFixed(1) : null,
    navTop: navR ? +navR.top.toFixed(1) : null,
    // ① 「격자를 위로 얼마나 밀 수 있나」 — 밴드 위쪽 여유와 필요량
    headroomAbove: b ? +(g.top - b.top).toFixed(1) : null,
    needToClear: p ? +(bottom - p.top).toFixed(1) : null,
  };
})()`;

async function bootShort(page: import('@playwright/test').Page) {
  await boot(page, PHONE_402, { preserveAnimations: true });
  await page.setViewportSize(SHORT);
  await page.waitForTimeout(400);
  await fillAllRows(page);
  const dots = page.locator('[data-testid="state-dots"]');
  await expect(dots, 'complete = check 글리프').toHaveAttribute('data-glyph', 'check');
  await page.waitForTimeout(700);
}

/** 각 안의 CSS 목업. `''`는 현재 상태(대조). */
const OPTIONS: Record<string, string> = {
  '0-현재': '',
  // ① 격자를 위로 — 필요량만큼 밀어본다. 밴드 위 여유가 모자라면 잘린다(그게 판정이다).
  '1-격자를위로': `
    [data-testid="state-dots"] { transform: translateY(-22px) !important; }`,
  // ② 필 반투명 — 「가림」을 「비침」으로. 탭 영역은 그대로 산다.
  '2-필반투명': `
    [data-testid="input-control-toggle"] {
      opacity: 0.35 !important;
      background: transparent !important;
    }`,
  // ③ 필을 상단으로 — 컨트롤바 위쪽 끝으로 올린다(도트 영역 밖).
  '3-필상단이전': `
    [data-testid="voice-control-bar"] > div:last-child {
      bottom: auto !important; top: 0 !important;
    }`,
};

for (const [label, css] of Object.entries(OPTIONS)) {
  test(`FB-5 제3안 — ${label}`, async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await bootShort(page);

    // 🔴 무효 측정 방지 — 목업을 얹기 **전에** 필이 실제로 보이는지 단정한다.
    //    숨김 가드가 살아 있으면 여기서 걸린다(08-07에 그걸로 한 라운드를 버렸다).
    const before = (await page.evaluate(MEASURE)) as Record<string, unknown>;
    expect(
      before.pillVisible,
      '접힌 필이 보이지 않는다 — 숨김 가드가 워크트리에 살아 있으면 이 프로브는 무효다',
    ).toBe(true);

    if (css) await page.addStyleTag({ content: css });
    await page.waitForTimeout(300);

    const m = (await page.evaluate(MEASURE)) as Record<string, number | boolean | null>;
    fs.writeFileSync(path.join(OUT, `alt-${label}.json`), JSON.stringify(m, null, 2));
    await page.locator('[data-testid="voice-control-bar"]').screenshot({
      path: path.join(OUT, `alt-${label}.png`),
    });

    const verdict = `ⓐ가림${m.overlap === 0 ? '0 ✅' : `${m.overlap} ❌`} `
      + `ⓑ필터치${m.pillHit ? '가능 ✅' : '불가 ❌'}`;
    console.log(
      `[fb5:제3안] ${label} → ${verdict} | 켜짐=${m.lit} 필opacity=${m.pillOpacity} `
      + `켜진셀 ${m.litTop}~${m.litBottom} 필 ${m.pillTop}~${m.pillBottom} `
      + `격자 ${m.gridTop}~${m.gridBottom} 밴드 ${m.bandTop}~${m.bandBottom} `
      + `nav.top=${m.navTop} 위여유=${m.headroomAbove} 필요량=${m.needToClear}`,
    );
  });
}
