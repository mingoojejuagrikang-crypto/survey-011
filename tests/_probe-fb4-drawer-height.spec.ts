/** 🔎 프로브 — **FB-4 서랍 높이**(민구 제보 08-07 *"서랍 펼칠시 스크롤 없이 보이게 변경"*,
 *  확정 답변 「서랍을 더 높게 펼쳐라」).
 *
 *  판정이 아니라 **실측**이 목적이다. 재는 것:
 *   ① 펼친 서랍의 **필요 높이**(`input-control-scroll.scrollHeight`) vs **배정 높이**(`clientHeight`)
 *      → 부족분(shortfall) = 「스크롤 없이 보이려면 몇 px이 더 필요한가」
 *   ② 그 px를 어디서 가져올 수 있나 — 위쪽(칩존·중앙)에 실제로 남는 공간이 있나
 *   ③ 하단 경계 — 컨트롤바 bottom vs 탭바 top vs viewport bottom (탭바 침범 여부)
 *
 *  🔴 뷰포트에 **402×513**(민구 실기기 실측, 기존 스펙 격자에 없다)을 반드시 넣는다.
 *
 *  ⚠️ `_` 접두라 릴리스 게이트에서 제외된다(playwright.config.ts:33).
 *     돌리는 법: `npx playwright test tests/_probe-fb4-drawer-height.spec.ts --config=playwright.probe.config.ts --workers=1`
 */
import { test } from '@playwright/test';
import { boot, SETTINGS } from './fixtures/activeZones';
import { chipSweepSecondsForLevel } from '../src/lib/chipSweep';

const VIEWPORTS = [
  { width: 402, height: 513, label: '민구 실기기 실측(FB-4 제보 환경)' },
  { width: 402, height: 812, label: '실기기 standalone' },
  { width: 402, height: 874, label: 'screen 높이(기존 스펙 값)' },
  { width: 375, height: 667, label: '최소 지원 규격' },
];

function settingsWithSweep(seconds: number) {
  return { ...SETTINGS, state: { ...SETTINGS.state, chipSweepSeconds: seconds } };
}

for (const vp of VIEWPORTS) {
  test(`FB-4 서랍 기하 @ ${vp.width}×${vp.height} (${vp.label})`, async ({ page }) => {
    await boot(page, vp, {
      settings: settingsWithSweep(chipSweepSecondsForLevel(5)), preserveAnimations: true,
    });

    const collapsed = await page.evaluate(() => {
      const r = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el ? el.getBoundingClientRect() : null;
      };
      const root = r('[data-testid="voice-active-state"]');
      return {
        vh: window.innerHeight,
        rootTop: root?.top ?? null, rootBottom: root?.bottom ?? null,
        chip: r('[data-testid="voice-chip-grid"]')?.height ?? null,
        center: r('[data-testid="voice-center-stage"]')?.height ?? null,
        bar: r('[data-testid="voice-control-bar"]')?.height ?? null,
        barBottom: r('[data-testid="voice-control-bar"]')?.bottom ?? null,
        toggleH: r('[data-testid="input-control-toggle"]')?.height ?? null,
        tabBarTop: (() => {
          const nav = document.querySelector('nav') as HTMLElement | null;
          return nav ? nav.getBoundingClientRect().top : null;
        })(),
      };
    });

    await page.locator('[data-testid="input-control-toggle"]').click();
    await page.waitForTimeout(300);

    const open = await page.evaluate(() => {
      const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
      const sc = q('[data-testid="input-control-scroll"]');
      const panel = q('[data-testid="input-control-panel"]');
      const bar = q('[data-testid="voice-control-bar"]');
      const chip = q('[data-testid="voice-chip-grid"]');
      const center = q('[data-testid="voice-center-stage"]');
      // 서랍 안 4개 행의 실제 높이 — 「내용이 얼마나 필요한가」의 내역
      const rows = ['stepper-tolerance', 'stepper-tts-rate', 'toggle-barge-in', 'stepper-chip-sweep']
        .map((id) => {
          const el = q(`[data-testid="${id}"]`);
          return { id, h: el ? +el.getBoundingClientRect().height.toFixed(1) : null };
        });
      return {
        scrollH: sc?.scrollHeight ?? null,
        clientH: sc?.clientHeight ?? null,
        panelH: panel ? +panel.getBoundingClientRect().height.toFixed(1) : null,
        barH: bar ? +bar.getBoundingClientRect().height.toFixed(1) : null,
        barTop: bar ? +bar.getBoundingClientRect().top.toFixed(1) : null,
        barBottom: bar ? +bar.getBoundingClientRect().bottom.toFixed(1) : null,
        chipH: chip ? +chip.getBoundingClientRect().height.toFixed(1) : null,
        chipTop: chip ? +chip.getBoundingClientRect().top.toFixed(1) : null,
        centerH: center ? +center.getBoundingClientRect().height.toFixed(1) : null,
        centerTop: center ? +center.getBoundingClientRect().top.toFixed(1) : null,
        rows,
        /* 🔴 FB-4 부작용 점검 — 펼친 패널은 부모 padding(12px)을 **음수 마진으로 되찾아** 전폭
         *  시트가 된다. 그 폭이 문서를 가로로 넘기면 현장에서 가로 스크롤이 생긴다(장갑 조작 최악).
         *  `overflow`를 `visible`로 연 것도 이 축의 위험을 키우므로 함께 잰다. */
        docScrollW: document.documentElement.scrollWidth,
        docClientW: document.documentElement.clientWidth,
        panelLeft: panel ? +panel.getBoundingClientRect().left.toFixed(1) : null,
        panelRight: panel ? +panel.getBoundingClientRect().right.toFixed(1) : null,
      };
    });

    const shortfall = (open.scrollH ?? 0) - (open.clientH ?? 0);
    console.log(
      `\n=== FB-4 @ ${vp.width}×${vp.height} (${vp.label}) ===\n` +
      `접힘: vh=${collapsed.vh} chip=${collapsed.chip} center=${collapsed.center} bar=${collapsed.bar} ` +
      `barBottom=${collapsed.barBottom} tabBarTop=${collapsed.tabBarTop} toggleH=${collapsed.toggleH}\n` +
      `펼침: scrollH=${open.scrollH} clientH=${open.clientH} → **부족분=${shortfall}px**\n` +
      `      panelH=${open.panelH} barH=${open.barH} barTop=${open.barTop} barBottom=${open.barBottom}\n` +
      `      chipTop=${open.chipTop} chipH=${open.chipH} centerTop=${open.centerTop} centerH=${open.centerH}\n` +
      `      행: ${open.rows.map((r) => `${r.id}=${r.h}`).join(' · ')}\n` +
      `      👉 위쪽 회수 가능 최대치(chipTop~barTop) = ${((open.barTop ?? 0) - (open.chipTop ?? 0)).toFixed(1)}px\n` +
      `      가로: panel ${open.panelLeft}~${open.panelRight} / doc scrollW=${open.docScrollW} clientW=${open.docClientW} ` +
      `→ 가로넘침=${(open.docScrollW ?? 0) - (open.docClientW ?? 0)}px`,
    );
  });
}
