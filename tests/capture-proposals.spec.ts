/**
 * 개선요청 9건 → **개선안 프리뷰 카드** 생성 + 검증.
 *
 * 이 스펙은 현재상태 캡처(`capture-current-states.spec.ts`)의 산출물을 **포크해서 고친다.**
 * 앱을 띄우지 않는다 — `file://`로 캡처 카드를 열고, 그 DOM 위에서 제안을 적용한 뒤 다시 굳힌다.
 * 그래서 `src/`를 한 줄도 건드리지 않고도 앱의 실제 토큰·폰트·치수 위에서 제안이 만들어진다.
 *
 * 🔴 **다시 얼리지 않는다.** 제안이 새로 짠 부분은 `cqh`/`cqw` 비례여야 하고(민구: "기기 변경
 *    되어도 일정 비율"), 동결하면 그 요구가 깨진다. 그래서 `page.content()`를 그대로 쓴다.
 *
 * 🔴 **변화 자체를 단언한다.** 제안 CSS가 상속된 동결 인라인 스타일에 지면 아무 에러 없이
 *    "제안"이라는 이름으로 현재 화면이 나온다. 그래서 원본과 제안을 **같은 테스트에서 함께 재고**
 *    차이를 단언한다(after만 보면 무변화 카드가 통과한다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';

import { DEVICE, PREVIEW_DIR, assertSelfContained } from './fixtures/previewCapture';
import { fingerprint } from './fixtures/previewVerify';
import { PROPOSALS, type Proposal } from './fixtures/proposals';

test.setTimeout(180_000);

const PROPOSAL_DIR = path.join(PREVIEW_DIR, 'proposals');
const SHOT_DIR = path.join(PROPOSAL_DIR, '_shots');
/** 민구의 "기기 변경 되어도 일정 비율" 요구를 실제로 거는 두 번째 폭. */
const NARROW = { width: 375, height: 667 };

const VERSION = '0.39.0';
const COMMIT = (() => {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
})();

const reportLines: string[] = [];

test.beforeAll(() => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});

/** 스테이지 크기를 바꿔 좁은 기기를 흉내낸다. 카드가 새로 짠 부분은 cq 비례라 여기서 다시 계산되고,
 *  포크로 상속한 크롬(상단 스트립·탭바)의 타이포는 402 동결값 그대로 남는다 — 리포트에 명시한다. */
async function resizeStage(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize({ width: size.width + 120, height: size.height + 120 });
  await page.evaluate(({ w, h }) => {
    const style = document.createElement('style');
    style.setAttribute('data-stage-resize', '');
    style.textContent = `.ds-stage{width:${w}px !important;height:${h}px !important}`
      + `.ds-stage > #root{width:${w}px !important;height:${h}px !important;min-height:${h}px !important}`
      + `.ds-stage .mobile-app-shell{height:${h}px !important}`;
    document.head.appendChild(style);
  }, { w: size.width, h: size.height });
  await page.waitForTimeout(250);
}

/** 카드가 재설계한 영역의 기하 — 원본과 제안을 같은 코드로 재서 **차이**를 본다. */
async function zoneShape(page: Page) {
  return page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('[data-testid="voice-chip-grid"]');
    const chips = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="column-chip"]'));
    const active = document.querySelector<HTMLElement>('[data-testid="column-chip"][data-active="true"]');
    const dots = document.querySelector<HTMLElement>('[data-testid="state-dots"]');
    const band = document.querySelector<HTMLElement>('[data-testid="live-listen-band"]');
    const rowTops: number[] = [];
    for (const c of chips) {
      if (!rowTops.some((t) => Math.abs(t - c.offsetTop) <= 8)) rowTops.push(c.offsetTop);
    }
    rowTops.sort((a, b) => a - b);
    const gridBox = grid?.getBoundingClientRect();
    const clientH = grid?.clientHeight ?? 0;
    const firstChip = chips[0]?.getBoundingClientRect();
    const nameSpan = chips[0]?.querySelector('span');
    const valueSpan = chips[0]?.querySelectorAll('span')[1];
    const dotsBox = dots?.getBoundingClientRect();
    const bandBox = band?.getBoundingClientRect();
    return {
      chipCount: chips.length,
      totalRows: rowTops.length,
      visibleRows: rowTops.filter((t) => t < clientH - 4).length,
      chipHeight: firstChip ? Math.round(firstChip.height * 10) / 10 : 0,
      chipWidth: firstChip ? Math.round(firstChip.width * 10) / 10 : 0,
      // 칩이 없는 카드(아이콘 시트)에서 Math.min(...[])는 Infinity다 — 숫자인 척 리포트에 찍히면 안 된다.
      minChipHeight: chips.length
        ? Math.round(Math.min(...chips.map((c) => c.getBoundingClientRect().height)) * 10) / 10
        : null,
      nameFont: nameSpan ? getComputedStyle(nameSpan).fontSize : '',
      valueFont: valueSpan ? getComputedStyle(valueSpan).fontSize : '',
      chipsStacked: firstChip && nameSpan && valueSpan
        ? (valueSpan as HTMLElement).getBoundingClientRect().top >= (nameSpan as HTMLElement).getBoundingClientRect().bottom - 1
        : false,
      scrollOverflow: grid ? grid.scrollHeight - grid.clientHeight : 0,
      scrollOverflowX: grid ? grid.scrollWidth - grid.clientWidth : 0,
      chipScrollLeft: grid ? Math.round(grid.scrollLeft) : 0,
      activeChipName: active?.getAttribute('data-col-name') ?? null,
      /** 진행중 칩이 가로 스크롤 창 안에 실제로 보이는가 + 어디에 정렬돼 있는가. */
      activeVisibleX: active && grid
        ? active.offsetLeft + active.offsetWidth > grid.scrollLeft + 4
          && active.offsetLeft < grid.scrollLeft + grid.clientWidth - 4
        : false,
      activeLeftInView: active && grid ? Math.round(active.offsetLeft - grid.scrollLeft) : 0,
      /** 진행중 칩의 오른쪽 끝 ↔ 보이는 영역의 오른쪽 끝 간격. 우측 끝 정렬이면 ≈패딩(8px). */
      activeRightGap: active && grid
        ? Math.round(grid.clientWidth - (active.offsetLeft - grid.scrollLeft + active.offsetWidth))
        : 0,
      /** 진행중 칩 **왼쪽**에 값이 찍힌(입력 완료) 칩이 몇 개 보이는가 = 입력 확인 영역. */
      completedChipsLeft: (() => {
        if (!grid || !active) return 0;
        return chips.filter((c) => {
          if (c.offsetLeft >= active.offsetLeft) return false;
          if (c.offsetLeft + c.offsetWidth <= grid.scrollLeft + 4) return false;
          const v = c.querySelectorAll<HTMLElement>(':scope > span')[1];
          return !!v && (v.textContent ?? '').trim() !== '—' && (v.textContent ?? '').trim() !== '';
        }).length;
      })(),
      gridWidth: gridBox ? Math.round(gridBox.width) : 0,
      heroPrimary: !!document.querySelector('[data-testid="hero-primary"]'),
      waveform: !!document.querySelector('[data-testid="voice-waveform"]'),
      dotField: dots?.getAttribute('data-proposal-dotfield') ?? null,
      dotsOverflowTop: dotsBox && bandBox ? Math.round(Math.max(0, bandBox.top - dotsBox.top) * 100) / 100 : 0,
      dotsOverflowBottom: dotsBox && bandBox ? Math.round(Math.max(0, dotsBox.bottom - bandBox.bottom) * 100) / 100 : 0,
      // 스크롤 창과 **겹치기만 해도** 하이라이트는 보인다. 상단이 창 안에 있어야 한다고 잡으면
      // ③(일부러 걸쳐 놓은 스크롤 상태)을 실패로 오판한다.
      activeVisible: active && grid
        ? active.offsetTop + active.offsetHeight > grid.scrollTop + 4
          && active.offsetTop < grid.scrollTop + grid.clientHeight - 4
        : false,
      // 🔴 칩 안에서 내용이 잘리는지. 첫 시안이 여기서 깨졌다(항목명이 한 글자로 잘리고 값이
      //    아래로 넘쳐 화면에서만 보였다) — 눈으로만 보면 놓치므로 수치로 잡는다.
      clippedChips: chips.filter((c) => c.scrollHeight > c.clientHeight + 1).length,
      // 🔴 기하로 잰다. `scrollWidth > clientWidth`는 span에 overflow:hidden이 걸려 있을 때만
      //    참이 되므로, overflow를 visible로 바꾸면 그 오라클은 **항상 0**이 되어 공허해진다.
      //    칩은 overflow:hidden이라 칩 상자 밖으로 나간 글자는 실제로 잘려 보인다 — 그걸 직접 잰다.
      ellipsizedValues: chips.filter((c) => {
        const box = c.getBoundingClientRect();
        return Array.from(c.querySelectorAll('span')).some((s) => {
          const el = s as HTMLElement;
          const r = el.getBoundingClientRect();
          // 두 축으로 잡는다 — overflow:visible이면 상자 밖으로 삐져나오고(기하),
          // overflow:hidden이면 상자 안에 갇힌 채 잘린다(scrollWidth). 하나만 보면 서로를 놓친다.
          const spills = r.width > 0 && (r.left < box.left - 0.5 || r.right > box.right + 0.5);
          const truncated = el.scrollWidth > el.clientWidth + 1;
          return spills || truncated;
        });
      }).length,
      /** 해제 의도가 실제로 먹었는지 — 결과가 아니라 **속성 자체**를 본다(잘린 글자는 오라클을 속인다). */
      /** 실시간 인식값 크기 — 알람 카드 유무와 무관하게 잰다(②는 중앙 히어로, ⑦은 알람 카드 안). */
      interimFont: (() => {
        const el = document.querySelector<HTMLElement>('[data-testid="interim-value"], [data-proposal-interim]');
        return el ? getComputedStyle(el).fontSize : null;
      })(),
      valueOverflowX: (() => {
        const v = chips[0]?.querySelectorAll('span')[1] as HTMLElement | undefined;
        return v ? getComputedStyle(v).overflowX : '';
      })(),
      // ── 알람 카드(⑥⑦⑧) ────────────────────────────────────────────────
      anomaly: (() => {
        const card = document.querySelector<HTMLElement>('[data-testid="anomaly-alert"]');
        if (!card) return null;
        const head = document.querySelector<HTMLElement>('[data-testid="anomaly-headline"]');
        const cmp = document.querySelector<HTMLElement>('[data-testid="anomaly-comparison"]');
        const prevV = document.querySelector<HTMLElement>('[data-testid="anomaly-prev-value"]');
        const nextV = document.querySelector<HTMLElement>('[data-testid="anomaly-next-value"]');
        const labels = cmp ? Array.from(cmp.children).slice(0, 2) as HTMLElement[] : [];
        const pv = prevV?.getBoundingClientRect();
        const nv = nextV?.getBoundingClientRect();
        const l0 = labels[0]?.getBoundingClientRect();
        const interim = document.querySelector<HTMLElement>('[data-testid="interim-value"]');
        return {
          headline: head?.textContent?.trim() ?? null,
          headlineFont: head ? getComputedStyle(head).fontSize : '',
          prevLabel: labels[0]?.textContent?.trim() ?? '',
          nextLabel: labels[1]?.textContent?.trim() ?? '',
          prevValueFont: prevV ? getComputedStyle(prevV).fontSize : '',
          prevValueText: prevV?.textContent?.trim() ?? '',
          nextValueText: nextV?.textContent?.trim() ?? '',
          // fb-27-7 2항 — 좌우 2열이 아니라 **상하 2줄**인가.
          stackedVertically: !!(pv && nv) && pv.bottom <= nv.top + 1,
          // fb-27-7 3·4항 — 라벨이 값 **앞**에 오는가(같은 줄 왼쪽).
          labelBeforeValue: !!(l0 && pv) && l0.right <= pv.left + 1 && Math.abs(l0.top - pv.top) < pv.height,
          interimFont: interim ? getComputedStyle(interim).fontSize : null,
        };
      })(),
      // ── 조절판(⑤) ─────────────────────────────────────────────────────
      panel: (() => {
        const panel = document.querySelector<HTMLElement>('[data-testid="input-control-panel"]');
        const band = document.querySelector<HTMLElement>('[data-testid="live-listen-band"]');
        if (!panel || !band) return null;
        const navRow = band.parentElement as HTMLElement;
        const cs = getComputedStyle(navRow);
        const pb = panel.getBoundingClientRect();
        const nb = navRow.getBoundingClientRect();
        return {
          // fb-27-5 "하단 최상단까지 확장" — 패널이 인디케이터 행 **위**에 오는가.
          panelAboveNav: pb.top <= nb.top + 1,
          panelOverlapsNav: pb.bottom > nb.top + 1 && pb.top < nb.bottom - 1,
          // fb-27-6 "해당 영역의 버튼을 비활성화" — 눈에 보이고(opacity) 실제로 안 눌린다(pointer-events).
          navOpacity: Number(cs.opacity),
          navPointerEvents: cs.pointerEvents,
          navButtonsDisabled: Array.from(navRow.querySelectorAll('button')).every((b) => b.hasAttribute('disabled')),
          navHeight: Math.round(nb.height * 10) / 10,
          navHidden: cs.display === 'none',
          panelHeight: Math.round(pb.height * 10) / 10,
          barHeight: Math.round((panel.parentElement as HTMLElement).getBoundingClientRect().height * 10) / 10,
        };
      })(),
      // ── 아이콘 후보 시트(⑨) ────────────────────────────────────────────
      iconSheet: (() => {
        const cards = Array.from(document.querySelectorAll('[data-proposal-icon-card]'));
        if (cards.length === 0) return null;
        return {
          count: cards.length,
          numbers: cards.map((c) => c.querySelector('[data-proposal-icon-no]')?.textContent?.trim() ?? ''),
          fields: cards.filter((c) => c.querySelector('[data-proposal-dotfield]')).length,
          meanings: cards.filter((c) => (c.querySelector('[data-proposal-icon-meaning]')?.textContent ?? '').length > 10).length,
          dotCounts: cards.map((c) => c.querySelectorAll('[data-proposal-dotfield] span').length),
          selected: cards.filter((c) => c.hasAttribute('data-proposal-icon-selected')).length,
        };
      })(),
      /** 실패했을 때 어디가 좁은지 바로 보이게 — 추측 대신 수치로 고치기 위한 진단. */
      chipDiag: chips.slice(0, 2).map((c) => {
        const box = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        const v = c.querySelectorAll('span')[1] as HTMLElement | undefined;
        const vs = v ? getComputedStyle(v) : null;
        return `${c.getAttribute('data-col-name')}: w=${Math.round(box.width)}`
          + ` flex=[${cs.flexGrow},${cs.flexShrink},${cs.flexBasis}] min=${cs.minWidth} max=${cs.maxWidth} w:${cs.width}`
          + ` || val w=${v ? Math.round(v.getBoundingClientRect().width) : '-'}`
          + ` scroll=${v?.scrollWidth} ovf=${vs?.overflowX} ws=${vs?.whiteSpace} inlineW=${v?.style.width || '-'}`;
      }).join('\n    '),
    };
  });
}

type ZoneShape = Awaited<ReturnType<typeof zoneShape>>;

function header(p: Proposal): string {
  // 🔴 기각안은 Design 패널에 카드로 뜨면 안 된다(민구가 기각안을 보고 다시 고민하게 된다).
  //    파일과 리포트 기록은 남기되 `@dsCard` 마커만 내린다.
  if (p.rejected) {
    return `<!-- 기각안 — Design 패널 카드 아님 (민구 기각 2026-07-27). 기록 보존용. group=${p.group} -->\n`;
  }
  return `<!-- @dsCard group="${p.group}" -->\n`;
}

async function injectProvenance(page: Page, p: Proposal): Promise<void> {
  const text = [
    ` ${p.name} — ${p.title}`,
    '',
    ' 🔴 이것은 **제안**이며 현재 앱 화면이 아니다. 현재 화면은 같은 폴더의 현재상태 카드다.',
    '',
    ` 반영한 개선요청: ${p.feedback}`,
    ` 민구 원문: ${p.quote}`,
    ` 포크한 원본: design-sync/_previews/${p.source}.html (라이브 DOM 실렌더 캡처)`,
    ` 기준: survey-011 v${VERSION} · commit ${COMMIT} · ${DEVICE.width}×${DEVICE.height}`,
    '',
    ' 무엇을 바꿨나:',
    ...p.changes.map((c) => `  · ${c}`),
    '',
    ' 새로 짠 부분은 컨테이너 쿼리 비례(cqh/cqw)다 — 민구 "기기 변경 되어도 일정 비율" 요구.',
    ' 포크로 상속한 크롬(상단 스트립·탭바)의 타이포는 402×874 동결값이다.',
  ].join('\n');
  await page.evaluate((t) => {
    document.head.appendChild(document.createComment(t));
  }, text);
}

for (const p of PROPOSALS) {
  test(`제안 ${p.name} — ${p.title}`, async ({ page }) => {
    const sourceFile = path.join(PREVIEW_DIR, `${p.source}.html`);
    expect(fs.existsSync(sourceFile), `포크할 원본이 없다: ${p.source}.html`).toBe(true);

    await page.setViewportSize({ width: DEVICE.width + 120, height: DEVICE.height + 120 });
    await page.goto(`file://${sourceFile}`, { waitUntil: 'load' });
    await page.waitForTimeout(250);

    // ── before: 포크하기 전 원본의 기하 ──────────────────────────────────────
    const before = await zoneShape(page);
    const beforeFp = await fingerprint(page);

    // ── 제안 적용 ───────────────────────────────────────────────────────────
    await p.apply(page);
    await injectProvenance(page, p);
    await page.waitForTimeout(250);
    const after = await zoneShape(page);
    const afterFp = await fingerprint(page);

    // ── 산출 ────────────────────────────────────────────────────────────────
    const html = header(p) + (await page.content());
    assertSelfContained(html, p.name);
    const outFile = path.join(PROPOSAL_DIR, `${p.name}.html`);
    fs.writeFileSync(outFile, html, 'utf8');
    await page.locator('.ds-stage').screenshot({ path: path.join(SHOT_DIR, `${p.name}.png`) });

    // ── 좁은 기기(375×667)에서 비례가 실제로 다시 계산되는가 ─────────────────
    await resizeStage(page, NARROW);
    const narrow = await zoneShape(page);
    await page.locator('.ds-stage').screenshot({ path: path.join(SHOT_DIR, `${p.name}.375.png`) });

    console.log(`[proposal] ${p.name}: rows ${before.visibleRows}→${after.visibleRows} `
      + `chipH ${before.chipHeight}→${after.chipHeight} (375: ${narrow.chipHeight}) `
      + `value ${before.valueFont}→${after.valueFont} (375: ${narrow.valueFont}) `
      + `dots ${before.dotField ?? 'legacy'}→${after.dotField ?? 'legacy'} `
      + `overflow ${before.dotsOverflowBottom}→${after.dotsOverflowBottom} `
      + `| active=${after.activeChipName} scrollX=${after.chipScrollLeft} `
      + `overflowX=${after.scrollOverflowX} leftInView=${after.activeLeftInView} `
      + `rightGap=${after.activeRightGap} visibleX=${after.activeVisibleX} done=${after.completedChipsLeft}`);
    if (after.clippedChips || after.ellipsizedValues) {
      console.log(`[proposal] ${p.name} 진단 402: ${after.chipDiag}`);
      console.log(`[proposal] ${p.name} 진단 375: ${narrow.chipDiag}`);
    }

    reportLines.push(renderReport(p, before, after, narrow, outFile, html.length));

    // ── 공통 계약 ───────────────────────────────────────────────────────────
    if (p.rejected) {
      expect(html.startsWith('<!-- 기각안'), '기각안은 카드 마커를 달지 않는다').toBe(true);
      expect(html.includes('@dsCard'), '기각안에 카드 마커가 남아 있으면 패널에 뜬다').toBe(false);
    } else {
      expect(html.startsWith(`<!-- @dsCard group="${p.group}" -->`), '첫 줄 카드 마커').toBe(true);
    }
    if (p.kind !== 'sheet') {
      expect(afterFp.nodes['[data-testid="voice-active-state"]'], '앱 화면 골격 유지').toBeTruthy();
    }
    // 🔴 공허 방지 — 원본과 제안이 실제로 달라야 한다. 다만 **이 카드가 재설계한 영역에서** 달라야
    //    의미가 있다. 전체 JSON 비교는 칩을 안 건드리는 카드(알람·조절판)에서 헛발질한다.
    expect(JSON.stringify(scopeOf(after, p)), '제안이 원본과 동일하다(오버라이드가 먹지 않았다)')
      .not.toBe(JSON.stringify(scopeOf(before, p)));
    void beforeFp;
    await verifyProposal(p, before, after, narrow);
  });
}

/** 이 카드가 재설계한 영역만 잘라낸다 — 안 건드린 곳까지 비교하면 오라클이 헛돈다. */
function scopeOf(z: ZoneShape, p: Proposal): unknown {
  const out: Record<string, unknown> = {};
  if (p.redesigns.includes('chips')) {
    out.chips = [z.visibleRows, z.chipHeight, z.valueFont, z.nameFont, z.chipsStacked];
  }
  if (p.redesigns.includes('anomaly')) out.anomaly = z.anomaly;
  if (p.redesigns.includes('panel')) out.panel = z.panel;
  if (p.redesigns.includes('indicator')) out.indicator = [z.dotField, z.waveform];
  if (p.kind === 'sheet') out.sheet = z.iconSheet;
  return out;
}

/** 카드별 고유 오라클 — "무엇이 바뀌어야 하는가"를 요청 문장 단위로 건다. */
async function verifyProposal(p: Proposal, before: ZoneShape, after: ZoneShape, narrow: ZoneShape): Promise<void> {
  // ── 칩존을 재설계한 카드 공통 ────────────────────────────────────────────
  if (p.redesigns.includes('chips')) {
    expect(after.valueOverflowX, `${p.name}: 칩 값의 overflow 동결이 해제되지 않았다(제안 CSS가 졌다)`)
      .toBe('visible');
    expect(after.clippedChips, `${p.name}: 칩 안에서 내용이 세로로 잘린다`).toBe(0);
    expect(after.ellipsizedValues, `${p.name}: 값이 잘려 읽을 수 없다`).toBe(0);
    expect(narrow.clippedChips, `${p.name}: 375×667에서 칩 내용이 잘린다`).toBe(0);
    expect(narrow.minChipHeight ?? 0, `${p.name}: 375×667에서도 칩 44px 하한`).toBeGreaterThanOrEqual(44);
    expect(parseFloat(after.valueFont), '값 글자가 원본보다 커졌다(비율 사이즈업)')
      .toBeGreaterThan(parseFloat(before.valueFont));
    // 🔴 비례 요구 — 폭이 바뀌면 글자도 따라 바뀌어야 한다(동결 px이면 여기서 걸린다).
    expect(parseFloat(narrow.valueFont), '375에서 값 글자가 다시 계산됐다(고정 px 아님)')
      .toBeLessThan(parseFloat(after.valueFont));
    if ((p.chipScroll ?? 'x') === 'x') {
      // 민구 재판단(2026-07-27) — 가로 스크롤 + 진행중 항목 자동 스크롤.
      expect(after.totalRows, '한 줄에 전부 늘어선다(가로 스크롤)').toBe(1);
      expect(after.scrollOverflowX, '넘치는 칩은 가로 스크롤로 남는다').toBeGreaterThan(0);
      expect(after.activeVisibleX, '자동 스크롤 — 진행중 칩이 보이는 위치에 있다').toBe(true);
      expect(narrow.activeVisibleX, '375에서도 진행중 칩이 보인다').toBe(true);
      // 🔴 민구 확정 정렬 — 넘친 상태에서는 진행중 칩이 **보이는 영역의 오른쪽 끝**에 온다.
      //    (넘침 전이면 스크롤이 0이라 이 규칙이 적용되지 않으므로 그때는 검사하지 않는다.)
      if (after.chipScrollLeft > 0) {
        expect(after.activeRightGap, '진행중 칩이 우측 끝에 정렬된다(좌→우 읽기)')
          .toBeLessThanOrEqual(10);
      }
    } else {
      expect(after.activeVisible, '활성 칩이 보이는 줄에 있다(§공통규칙4 "지금 어디")').toBe(true);
      expect(after.scrollOverflow, '넘치는 칩은 세로 스크롤로 남는다').toBeGreaterThan(0);
    }
  }
  // ── 인디케이터를 도트 필드로 바꾼 카드 공통 ──────────────────────────────
  if (p.redesigns.includes('indicator')) {
    expect(before.waveform, '원본에는 파형 레이어가 있었다').toBe(true);
    expect(after.waveform, 'fb-27-1 파형 레이어 제거 → 교차페이드 불가능').toBe(false);
    // 열은 13(파형 막대 수 승계)으로 고정, 행은 글리프마다 다르다 — 현행 StateDots도 같다(mic 7 / alert 8).
    expect(after.dotField, '단일 도트 필드로 교체').toMatch(/^13x\d+$/);
    expect(after.dotsOverflowTop + after.dotsOverflowBottom, '도트가 밴드를 넘지 않는다').toBe(0);
    expect(narrow.dotsOverflowTop + narrow.dotsOverflowBottom, '375에서도 넘치지 않는다').toBe(0);
  }

  if (p.name === 'proposal-1-idle' || p.name === 'proposal-3-chipzone-scrolled') {
    expect(before.visibleRows, '원본은 2줄이었다').toBe(2);
    expect(after.visibleRows, '한 행으로 제한').toBe(1);
    expect(after.chipHeight, '칩이 원본보다 확실히 높아졌다').toBeGreaterThan(before.chipHeight * 1.6);
    expect(after.chipsStacked, '칩 내부 세로 배열(항목명 위 / 값 아래)').toBe(true);
    expect(before.heroPrimary, '원본에는 중앙 항목명이 있었다').toBe(true);
    expect(after.heroPrimary, 'fb-27-2 중앙 항목명 삭제').toBe(false);
    expect(narrow.visibleRows, '375에서도 1행 유지').toBe(1);
  }
  if (p.name === 'proposal-2-listening') {
    expect(after.visibleRows, '칩존은 ①과 같은 1행').toBe(1);
    expect(after.heroPrimary, '중앙 항목명 삭제').toBe(false);
    // fb-27-7과 같은 급 — 중앙 인식값이 90px 급으로 커졌다.
    expect(parseFloat(after.interimFont ?? '0'), '중앙 인식값이 정상 진행 수준(90px급)')
      .toBeGreaterThan(70);
  }
  if (p.name === 'proposal-3-chipzone-scrolled') {
    // 중간 컬럼까지 진행한 상태여야 "자동 스크롤"이 보인다 — 첫 칩이면 스크롤이 0이라 공허하다.
    expect(after.activeChipName, '중간 컬럼이 진행중이다').toBe('측정항목06');
    expect(after.chipScrollLeft, '자동 스크롤이 실제로 걸렸다').toBeGreaterThan(0);
    expect(after.activeRightGap, '진행중 칩이 우측 끝').toBeLessThanOrEqual(10);
    // 🔴 이 카드의 요점 — 왼쪽에 남는 것이 **입력 확인 영역**이다. 값이 안 찍혀 있으면 공허하다.
    expect(after.completedChipsLeft, '왼쪽에 값이 찍힌 완료 칩이 보인다').toBeGreaterThanOrEqual(2);
  }
  if (p.name === 'proposal-9-alert-icons') {
    expect(after.iconSheet?.selected, '민구가 고른 후보가 표시돼 있다').toBe(1);
  }
  if (p.name === 'proposal-4a-chipzone-alt') {
    // 안 B — 칩 하나가 한 줄. 줄 수가 칩 수와 같아야 "한 줄에 하나"다.
    expect(after.totalRows, '칩 하나당 한 줄(목록형)').toBe(after.chipCount);
    expect(after.chipsStacked, '안 B는 좌우 배치라 세로 스택이 아니다').toBe(false);
    expect(parseFloat(after.valueFont), '안 B는 안 A보다 글자를 더 키울 수 있다').toBeGreaterThan(34);
  }
  if (p.name === 'proposal-5-panel-open') {
    // 🔴 민구 선택: 흐리게가 아니라 **완전히 숨긴다**. 겹칠 상자가 없어지는 것이 fb-27-5/6의 해법이다.
    expect(before.dotsOverflowBottom, '원본에서 도트가 실제로 넘치고 있었다').toBeGreaterThan(10);
    expect(after.panel?.navHidden, 'fb-27-6 확장 중 하단 인디케이터·이전/다음을 숨긴다').toBe(true);
    expect(after.panel!.navHeight, '숨겼으므로 탭될 상자 자체가 없다').toBe(0);
    // 조절판이 하단 트랙을 실제로 다 쓴다(민구 "하단 최상단까지 확장").
    expect(after.panel!.panelHeight / after.panel!.barHeight, '조절판이 하단 트랙 대부분을 쓴다')
      .toBeGreaterThan(0.8);
    expect(after.panel!.panelHeight, '조절판이 원본보다 커졌다')
      .toBeGreaterThan(before.panel!.panelHeight);
    // 접혔을 때를 위한 근본 수정도 함께 들어갔는지 — 속성으로 확인(숨겨져 있어 상자로는 못 잰다).
    expect(after.dotField, '접히면 돌아올 인디케이터도 유동 셀 도트 격자로 교체됐다').toMatch(/^13x\d+$/);
    expect(after.waveform, '파형 레이어 제거(교차페이드 불가)').toBe(false);
  }
  if (p.redesigns.includes('anomaly')) {
    expect(before.anomaly, '원본이 알람 카드다').toBeTruthy();
    expect(after.anomaly!.stackedVertically, 'fb-27-7 2항 직전/현재를 상하 배치').toBe(true);
    expect(before.anomaly!.stackedVertically, '원본은 좌우 배치였다').toBe(false);
    expect(after.anomaly!.prevLabel, 'fb-27-7 3항 날짜는 연도 빼고 mm-dd').toMatch(/^\d{2}-\d{2}$/);
    expect(after.anomaly!.labelBeforeValue, 'fb-27-7 3·4항 라벨이 값 앞에').toBe(true);
  }
  // "알람값 키우기"는 ⑥⑧에만 건다. ⑦은 민구 선택(직전값을 줄여 인식값 90px 확보)이라
  // 일부러 작아지는 카드이고, 그쪽은 인식값 크기로 따로 단언한다.
  if (p.name === 'proposal-6-anomaly' || p.name === 'proposal-8-corrected') {
    expect(parseFloat(after.anomaly!.prevValueFont), '알람값이 커졌다')
      .toBeGreaterThan(parseFloat(before.anomaly!.prevValueFont));
  }
  if (p.name === 'proposal-6-anomaly') {
    expect(parseFloat(after.anomaly!.headlineFont), '알람 헤드라인이 커졌다')
      .toBeGreaterThan(parseFloat(before.anomaly!.headlineFont));
    expect(after.interimFont, '⑥은 인식 전 상태 — 인식 스트립 없음').toBeNull();
  }
  if (p.name === 'proposal-7-anomaly-interim') {
    // fb-27-7 5항 — 현재값 자리를 인식값이 임시로 쓰고, 크기는 32.16px이 아니라 값 급이다.
    expect(after.anomaly!.nextLabel, '라벨이 "인식 중"으로 바뀌었다').toBe('인식 중');
    // 민구 선택 — "정상 진행될때의 수준만큼"(정상 InterimLine 실측 90.13px) 급이어야 한다.
    expect(parseFloat(after.interimFont ?? '0'), '인식값이 90px급이다(현행 32.16px)')
      .toBeGreaterThan(80);
    expect(parseFloat(after.anomaly!.prevValueFont), '직전값은 자리를 내주되 계속 보인다')
      .toBeGreaterThan(12);
    expect(after.anomaly!.prevValueText, '직전값 자체는 남아 있다').toBe('100');
  }
  if (p.name === 'proposal-8-corrected') {
    expect(before.anomaly!.headline, '원본에는 `정상 : 복귀`가 있었다').toBe('정상 : 복귀');
    expect(after.anomaly!.headline, 'fb-27-8 문구 삭제').toBeNull();
  }
  if (p.name === 'proposal-9-alert-icons') {
    expect(after.iconSheet?.count, '후보 4종').toBe(4);
    expect(after.iconSheet?.numbers, '번호로 답할 수 있게 1~4').toEqual(['1', '2', '3', '4']);
    expect(after.iconSheet?.fields, '전부 도트 매트릭스').toBe(4);
    expect(after.iconSheet?.meanings, '각 후보에 뜻 한 줄').toBe(4);
    // 공허 방지 — 도트가 실제로 그려졌고 후보끼리 서로 다르다.
    expect(Math.min(...after.iconSheet!.dotCounts), '도트가 실제로 찍혔다').toBeGreaterThan(8);
    expect(new Set(after.iconSheet!.dotCounts).size, '후보가 서로 다른 모양이다').toBeGreaterThan(1);
  }
}

/** 🔴 리포트는 **그 카드가 실제로 바꾼 축**만 찍는다(민구 지적, 2026-07-27).
 *  종전에는 모든 카드에 칩존 표를 찍어서, ⑦(핵심이 인식값 32→90px)이 "값 글자 12.03 → 12.03px
 *  무변화"로, ⑨가 "최소 칩 높이 Infinity"로 나왔다. **화면은 바뀌었는데 표가 그걸 반증하지 못하면**
 *  표만 본 사람은 "안 바뀌었다"로 읽는다. 해당 없는 축은 아예 적지 않는다. */
function renderReport(p: Proposal, before: ZoneShape, after: ZoneShape, narrow: ZoneShape, file: string, bytes: number): string {
  const px = (v: string | null) => (v && v !== '' ? v : '없음');
  const rows: string[] = [];

  if (p.redesigns.includes('chips')) {
    rows.push(`- **칩존**: 보이는 줄 ${before.visibleRows} → **${after.visibleRows}** · `
      + `칩 높이 ${before.chipHeight} → **${after.chipHeight}px** · `
      + `값 글자 ${px(before.valueFont)} → **${px(after.valueFont)}** · `
      + `내부 배치 ${before.chipsStacked ? '세로' : '좌우'} → **${after.chipsStacked ? '세로' : '좌우'}**`);
    rows.push(`- **375×667 재계산**(비율 유지 확인): 칩 높이 **${narrow.chipHeight}px** · `
      + `값 글자 **${px(narrow.valueFont)}** · 보이는 줄 **${narrow.visibleRows}** · `
      + `최소 칩 높이 **${narrow.minChipHeight ?? '-'}px**(44 하한)`);
    if (before.heroPrimary || after.heroPrimary) {
      rows.push(`- **중앙 항목명**: ${before.heroPrimary ? '있음' : '없음'} → **${after.heroPrimary ? '있음' : '없음(삭제)'}**`);
    }
  }
  if (p.redesigns.includes('indicator')) {
    rows.push(`- **하단 인디케이터**: ${before.dotField ? `도트필드 ${before.dotField}` : '도트+파형 2레이어(교차페이드)'} → `
      + `**도트 필드 ${after.dotField}** · 파형 레이어 ${before.waveform ? '있음' : '없음'} → **${after.waveform ? '있음' : '제거'}** · `
      + `도트 넘침 ${before.dotsOverflowBottom}px → **${after.dotsOverflowBottom}px**`);
  }
  if (p.redesigns.includes('panel') && before.panel && after.panel) {
    rows.push(`- **조절판**: 하단 인디케이터·이전/다음 ${before.panel.navHidden ? '숨김' : '표시'} → **${after.panel.navHidden ? '숨김' : '표시'}** · `
      + `조절판 높이 ${before.panel.panelHeight} → **${after.panel.panelHeight}px** (하단 트랙의 `
      + `${Math.round((after.panel.panelHeight / after.panel.barHeight) * 100)}%)`);
  }
  if (p.redesigns.includes('anomaly') && before.anomaly && after.anomaly) {
    rows.push(`- **알람 배치**: 직전/현재 ${before.anomaly.stackedVertically ? '상하' : '좌우 2열'} → `
      + `**${after.anomaly.stackedVertically ? '상하 2줄' : '좌우 2열'}** · `
      + `직전 라벨 "${before.anomaly.prevLabel}" → **"${after.anomaly.prevLabel}"** · `
      + `라벨 위치 ${before.anomaly.labelBeforeValue ? '값 앞' : '값 위'} → **${after.anomaly.labelBeforeValue ? '값 앞' : '값 위'}**`);
    rows.push(`- **알람 타이포**: 헤드라인 ${px(before.anomaly.headlineFont)} → **${after.anomaly.headline === null ? '삭제' : px(after.anomaly.headlineFont)}** · `
      + `직전값 ${px(before.anomaly.prevValueFont)} → **${px(after.anomaly.prevValueFont)}**`);
  }
  // 시트(⑨)는 04를 포크했을 뿐 인식값과 무관하다 — 포크 잔재를 실측인 척 찍지 않는다.
  if (p.kind !== 'sheet' && (before.interimFont || after.interimFont)) {
    rows.push(`- **실시간 인식값**: ${px(before.interimFont)} → **${after.interimFont ?? '없음(인식 전 상태)'}**`
      + (after.interimFont ? ` — 정상 진행 InterimLine 실측 90.13px 대비` : ''));
  }
  if (p.kind === 'sheet' && after.iconSheet) {
    rows.push(`- **후보 ${after.iconSheet.count}종** · 번호 ${after.iconSheet.numbers.join(' / ')} · `
      + `도트 수 ${after.iconSheet.dotCounts.join(' / ')}개(서로 다른 모양)`);
    rows.push('- 칩존·알람 축은 **해당 없음** — 앱 화면이 아니라 비교 시트다.');
  }
  if (rows.length === 0) rows.push('- (측정 축 해당 없음)');

  return `## ${p.name} — ${p.title}\n\n`
    + `- 포크 원본: \`${p.source}.html\` · 그룹 \`${p.group}\` · 반영 ${p.feedback}\n`
    + `- 민구 원문: ${p.quote}\n`
    + `- 파일: \`${path.basename(file)}\` (${Math.round(bytes / 1024)} KB)\n`
    + `- 바꾼 것:\n${p.changes.map((c) => `  - ${c}`).join('\n')}\n`
    + `- **실측 변화(원본 → 제안)**\n${rows.map((r) => `  ${r}`).join('\n')}\n`;
}

test.afterAll(() => {
  if (reportLines.length === 0) return;
  fs.writeFileSync(
    path.join(PROPOSAL_DIR, '_report.md'),
    `# 개선안 프리뷰 — survey-011 v${VERSION} (commit ${COMMIT})\n\n`
    + `**카드 ${reportLines.length} / ${PROPOSALS.length}**\n\n`
    + '🔴 여기 카드는 전부 **제안**이다. 현재 앱 화면은 상위 폴더의 현재상태 카드 9장이다.\n\n'
    + '만드는 방식: 현재상태 캡처를 `file://`로 열어 그 DOM 위에서 편집 → 다시 굳힘(백지 아님).\n'
    + '새로 짠 부분은 컨테이너 쿼리 비례(`cqh`/`cqw`)이고, 포크로 상속한 크롬 타이포는 402×874 동결값이다.\n'
    + '각 카드는 **원본과 제안을 같은 테스트에서 함께 재서 차이를 단언**한다 — 오버라이드가 먹지 않으면 실패한다.\n'
    + '실측 표는 **그 카드가 실제로 바꾼 축만** 찍는다. 해당 없는 축은 적지 않는다(무관한 값을 실측인 척 찍지 않기 위해).\n\n'
    + '## 민구 확정 (2026-07-27)\n\n'
    + '| 항목 | 확정 | 반영 위치 |\n|---|---|---|\n'
    + '| 알람 아이콘 (fb-27-4) | **1번 굵은 느낌표** — fb-27-4 종결 | ⑥⑦ 하단 글리프. ⑧은 정정 완료라 앱이 mic 글리프를 쓰므로 해당 없음 |\n'
    + '| 칩존 스크롤 | **세로 → 가로** (민구가 fb-27-2 원문을 스스로 뒤집음: "세로 스크롤 영역이 너무 작기에") | ①②③⑤⑥⑦⑧ |\n'
    + '| 자동 스크롤 정렬 | **진행중 칩이 가장 우측 끝** | ①②③⑤⑥⑦⑧ |\n'
    + '| 칩존 안 B (목록형) | **기각** — 파일·기록만 보존, 카드 마커 내림 | ④a |\n\n'
    + '**자동 스크롤 규칙**(모호함 없게):\n'
    + '- 넘침 **전**: 스크롤 없음. 칩이 왼쪽부터 채워지고 하이라이트가 자연히 좌→우로 이동한다.\n'
    + '- 넘침 **후**: 진행중 칩이 보이는 영역의 **오른쪽 끝**에 오도록 민다. 왼쪽에 남는 것은 **값이 찍힌 완료 칩**들이다.\n'
    + '- 근거(민구): "한국인들은 글을 읽을때 좌>우로 읽어. 그러니 진행칩의 하이라이트도 좌>우로 이동해야 해."\n'
    + '- 이 앱에서 맞는 이유: 칩이 항목+값을 함께 보여주므로 **왼쪽이 입력 확인 영역**이 된다. 다음 항목은 값이 아직 `—`라 미리 볼 실익이 적다.\n\n'
    + '## 🔴 기준 레이아웃 (읽기 전 필수)\n\n'
    + '앱 화면 카드 **7장(①②③⑤⑥⑦⑧)** 은 같은 기준 레이아웃 위에 서 있다:\n'
    + '**칩존 안 A**(한 행 + 칩 내부 2행 + **가로 스크롤** + 진행중 자동 스크롤 + 비율 사이즈업) · '
    + '**중앙 항목명 없음** · **하단은 도트 필드**.\n'
    + '각 카드의 고유 변경(조절판/알람배치/인식값/문구삭제)은 그 기준 **위에** 얹혀 있다.\n\n'
    + '✅ **칩존은 안 A로 확정**(2026-07-27). 안 B는 기각됐고 ④a는 기록으로만 남는다.\n'
    + '스크롤 축만 세로 → **가로**로 바뀌었고, 나머지(한 행에 칩 여러 개 · 칩 내부 2행 · 하이라이트 · 비율 사이즈업)는 그대로다.\n\n'
    + reportLines.sort().join('\n') + '\n',
    'utf8',
  );
});
