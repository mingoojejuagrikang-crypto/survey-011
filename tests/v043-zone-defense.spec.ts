/**
 * v0.43.0 UI-b — **CSS 방어 3종**의 회귀. `ui-standard §6` · `GL-007 구현 함정`.
 *
 * 원문: *"셋 다 「계산은 맞는데 렌더가 다르더라」였다. 그래서 방어의 목표는 정확성이 아니라
 * **틀려도 영역을 못 넘게** 만드는 것이다 — 넘치면 줄바꿈되는 대신 잘리므로 눈에 띈다."*
 *
 * 🔴 **세 방어를 한 테스트로 묶지 않는다.** 묶으면 하나만 살아 있어도 green이 되어,
 *    나머지 둘이 언제 사라졌는지 아무도 모른다. 그래서 파일 하나에 test 셋이다.
 *
 * 🔴 **반증을 실제로 돌렸고, 결과가 균일하지 않았다.** `[TEAMOPS-30]`: *"처방마다 「이걸 지우면
 *    red가 되나」를 물어라."* UI-a의 `reserveScale`이 그 검사를 안 해서 **한 줄 지워도 통과**했다.
 *
 *    | 방어 | 제거했을 때 | 실효 단언 |
 *    |---|---|---|
 *    | 1 `minmax(0)` | 🔴 **렌더는 green**(5개 뷰포트) — 자식 `overflow:hidden`이 이미 min을 0으로 만든다 | 소스 계약(1/3-a) |
 *    | 2 `overflow:hidden` | 🟡 red(속성) · ⚠️ **픽셀 단언은 green**(`above=0.00 below=0.00`) | 속성 |
 *    | 3 `nowrap` | 🟡 red(속성) · ⚠️ 높이 단언도 **green이었다** — 칩이 `flex:0 0 auto`라 폭이 내용에 맞아 안 깨진다 | 속성 |
 *
 *    👉 **렌더/픽셀/높이 단언만 믿으면 셋 다 지워도 통과한다.** 그래서 속성·소스 계약을 함께 둔다.
 *    ⚠️ 2의 픽셀 단언이 공허한 이유는 402×874의 하단 30%(219px)에 여유가 많아서다.
 *       압력이 있는 뷰포트에서만 실효를 갖는다 — 그래서 아래 테스트를 **390×340에서도** 돌린다.
 *    수치는 `deliverables/2026-08-01-survey-011-v0430-ui-b-design.md` §5-1.
 *
 * ⚠️ 방어를 "이미 코드에 있으니 됐다"로 넘기지 마라. 이 테스트들이 지키는 것은 **현재 상태가 아니라
 *    다음 회차의 변경**이다. UI-c~g가 이 영역을 계속 건드린다.
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다([ORCH-27]).
 */
import { test, expect } from '@playwright/test';
import { PHONE_402, PHONE_375, boot, zoneMetrics, triggerAnomaly, SETTINGS } from './fixtures/activeZones';
import { ACTIVE_ZONE_ROWS } from '../src/components/voice/heroLayout';

test.setTimeout(120_000);

/** 🔴 설계 계약을 **직접 고정**한다 — `ACTIVE_ZONE_RATIOS`를 읽지 않는다.
 *  제품 상수를 읽으면 둘을 같은 diff로 바꿨을 때 배분 회귀가 통과한다(Codex 리뷰 🔴-1 실측).
 *  `ACTIVE_ZONE_ROWS`는 **소스 계약 검사의 대상**이라 여전히 import한다 — 성격이 다르다. */
const Z = { chip: 20, center: 50, bottom: 30 } as const;

/** 방어를 실제로 물리게 하려면 **콘텐츠가 배정 영역을 넘겨야** 한다. 안 넘치는 상태에서 재는
 *  단언은 방어가 있든 없든 통과하므로 공허하다(UI-a `reserveScale`이 그랬다).
 *  그래서 항목명을 길게 만들어 칩·중앙 양쪽에 압력을 준다. */
const LONG_NAME = '측정항목이름이아주긴경우의칩라벨';

/** 🔴 `boot`의 `settings` 주입을 쓴다. 종전엔 boot 뒤에 localStorage를 고쳐 **reload + 탭 클릭 +
 *  고정 대기**를 직접 재현했는데, 그 경로가 픽스처의 진입 계약을 우회해 취약했다.
 *  시드는 한 번만 주고, 착지 보장은 픽스처에 맡긴다. */
async function bootOverloaded(page: Parameters<typeof boot>[0], viewport = PHONE_402) {
  const settings = JSON.parse(JSON.stringify(SETTINGS)) as typeof SETTINGS;
  for (const c of settings.state.columns) {
    if (c.input === 'voice') (c as { name: string }).name = `${LONG_NAME}${c.id}`;
  }
  await boot(page, viewport, { settings });
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 5000 });
}

// ─── 방어 1/3 — `minmax(0, …)`: 콘텐츠 최소 크기가 배정 높이를 이기지 못한다 ─────
//
// 함정 원문: *"`1fr`은 `minmax(auto, 1fr)`이다. 콘텐츠 최소 크기가 배정 높이를 이긴다 —
//   영역 비율을 적어놨는데 글자가 밀어낸다."* 초안에서 키패드가 하단 버튼을 덮었다.
//
// 🔴 **반증 결과를 정직하게 적는다 — 이 방어는 렌더로 반증되지 않는다.**
//    `ACTIVE_ZONE_ROWS`에서 `minmax(0, …)`를 전부 벗겨 `'auto 2fr 5fr 3fr'`로 두고 402×874·
//    375×667·844×390(가로)·390×380·390×340에서 재봐도 **비율이 20/50/30 그대로**였다.
//    근인: 세 트랙 자식이 모두 `overflow:hidden`(+ `minHeight:0`)이라 **`min-height:auto`가 이미
//    0**이다 — UI-a 함정 1이 fit을 무력화한 그 기제가, 여기서는 반대로 방어를 대신하고 있다.
//    👉 그래서 `minmax(0)`은 **중복 안전망**이지 유일한 방어가 아니다. 렌더 단언만 두면 UI-a의
//       `reserveScale`과 같은 "지워도 green" 상태가 되므로, **소스 계약 단언을 함께 둔다.**
//       그쪽은 문자열을 바꾸는 즉시 red다(반증 확인함).
test('[UI-b 방어 1/3-a] minmax(0) 소스 계약 — 모든 fr 트랙이 zero-min이다', () => {
  const tracks = ACTIVE_ZONE_ROWS.split(/\s+(?![^(]*\))/);
  console.log(`[방어1-a] ACTIVE_ZONE_ROWS 트랙 = ${JSON.stringify(tracks)}`);
  expect(tracks.length, '상단 스트립 + 3구역 = 4트랙').toBe(4);
  for (const t of tracks) {
    if (!t.includes('fr')) continue; // `auto`(스트립)는 대상이 아니다
    expect(t, `fr 트랙 \`${t}\`가 zero-min이 아니다 — \`1fr\`은 \`minmax(auto, 1fr)\`이다`)
      .toMatch(/^minmax\(0,\s*[\d.]+fr\)$/);
  }
});

/** 🔑 **방어 1의 효과 오라클** — Codex 리뷰가 제안하고 실측까지 준 방법이다.
 *
 *  종전엔 *"`minmax(0)`은 렌더로 반증 불가"* 로 결론내고 소스 계약에만 맡겼다. 근거는
 *  *"세 트랙 자식이 이미 `overflow:hidden`이라 auto-min이 0"* 이었고 그건 사실이다.
 *  🔴 **그러나 그 전제를 깨는 압력을 주입하면 갈린다.** 칩 자식에 `overflow:visible` +
 *  큰 `min-height`를 주면 auto-min이 되살아나고, 그때 zero-min 트랙과 bare `fr`이 다르게 눕는다.
 *
 *  🔴 **압력을 거는 자리가 셋 다 맞아야 한다.** 세 번 틀렸고 그때마다 A/B가 같았다:
 *  | 잘못 건 곳 | 왜 안 되나 |
 *  |---|---|
 *  | 그리드 자신의 `min-height` | 요소의 min-height가 트랙 크기를 **직접** 이긴다 — `minmax` 무관 |
 *  | 그리드 `height:100%` 유지 | 자식이 트랙 크기에 고정돼 min-content가 전파되지 않는다 |
 *  | `containerType: size` 유지 | 🔑 **size containment가 자식→부모 전파를 통째로 막는다** |
 *
 *  실측(402×874, 칩 자식에 `min-height:500px` + 위 셋 해제):
 *  | 트랙 | 압력 후 칩존 |
 *  |---|---|
 *  | `minmax(0, …)` | **146.2px** — 배분 유지 |
 *  | bare `fr` | **507px** — 콘텐츠가 트랙을 밀어내고 중앙·하단을 깎는다 |
 *
 *  👉 이제 방어 1은 소스 계약(1/3-a)과 **효과**(1/3-c) 양쪽으로 지켜진다.
 *  ⚠️ 이 테스트가 A/B 동일해지면 **압력이 안 걸린 것**이다 — 단언을 완화하지 말고
 *     위 세 자리부터 확인해라. 통과하지만 아무것도 안 재는 상태가 이 파일에서 가장 위험하다. */
test('[UI-b 방어 1/3-c] minmax(0) 효과 — auto-min을 되살리는 압력에도 배분이 버틴다', async ({ page }) => {
  await bootOverloaded(page, PHONE_402);
  const before = await zoneMetrics(page);

  // 🔴 방어가 기대는 전제(자식 `overflow:hidden`)를 **일부러 깬다.** 이 압력이 없으면
  //   `minmax(0)`이 있든 없든 결과가 같아 단언이 공허해진다.
  await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    // 🔴 제품이 auto-min 전파를 끊어놓은 **세 겹**을 전부 연다. 하나라도 남으면 압력이
    //   트랙에 닿지 않아 `minmax(0)` 유무와 무관하게 같은 결과가 나온다(위 표 참조).
    grid.style.overflow = 'visible';   // ① min-height:auto가 0이 되는 경로
    grid.style.height = 'auto';        // ② 트랙 크기에 고정되는 경로
    grid.style.minHeight = 'auto';
    grid.style.containerType = 'normal'; // ③ size containment — 이게 마지막 차단막이었다
    // min-height는 그리드가 아니라 **자식**에 건다. 그리드에 걸면 요소 자신의 크기가 되어
    // 트랙 계산을 우회한다. auto-min은 **자식의 min-content가 올라오는** 경로다.
    const chip = grid.querySelector('[data-testid="column-chip"]') as HTMLElement;
    chip.style.minHeight = '500px';
  });
  await page.waitForTimeout(120);

  const after = await zoneMetrics(page);
  const zoneTotal = after.rootHeight - after.headerHeight;
  console.log(`[방어1-c] before chip=${before.chipHeight.toFixed(1)} → after chip=${after.chipHeight.toFixed(1)} (total=${zoneTotal.toFixed(1)})`);

  // 🔑 오라클 — 칩존이 주입한 500px로 부풀지 않는다. zero-min이 아니면 여기서 red다.
  expect(after.chipHeight, 'minmax(0)이 없으면 칩존이 500px로 부푼다').toBeLessThan(300);
  expect(after.chipHeight / zoneTotal, `압력 뒤에도 칩존 ${Z.chip}%`).toBeCloseTo(Z.chip / 100, 2);
  expect(after.centerHeight / zoneTotal, `압력 뒤에도 중앙 ${Z.center}%`).toBeCloseTo(Z.center / 100, 2);
});

for (const vp of [
  { name: '402×874', viewport: PHONE_402 },
  { name: '375×667', viewport: PHONE_375 },
  // 🔴 아주 짧은 화면 — 칩 하한 44px이 배정 트랙(≈39px)을 넘어서는 유일한 지점이다.
  //   가로 모드·작은 기기가 여기 온다(ui-standard §7-3 회전 대응은 아직 미정).
  { name: '390×340(극단)', viewport: { width: 390, height: 340 } },
]) {
  test(`[UI-b 방어 1/3-b] 렌더 — 과대 콘텐츠가 트랙 비율을 밀지 못한다 @ ${vp.name}`, async ({ page }) => {
    await bootOverloaded(page, vp.viewport);
    const m = await zoneMetrics(page);
    const zoneTotal = m.rootHeight - m.headerHeight;
    console.log(`[방어1 ${vp.name}] chip=${m.chipHeight.toFixed(1)} center=${m.centerHeight.toFixed(1)} bottom=${m.bottomHeight.toFixed(1)} total=${zoneTotal.toFixed(1)}`);

    // 🔑 핵심 오라클 — 콘텐츠를 과대하게 넣어도 **배분이 그대로다**. `minmax(auto, …)`면
    //   긴 항목명이 칩존을 부풀리고 그만큼 중앙·하단이 밀려난다.
    expect(m.chipHeight / zoneTotal, `칩존 ${Z.chip}% 유지`).toBeCloseTo(Z.chip / 100, 2);
    expect(m.centerHeight / zoneTotal, `중앙 ${Z.center}% 유지`).toBeCloseTo(Z.center / 100, 2);
    expect(m.bottomHeight / zoneTotal, `하단 ${Z.bottom}% 유지`).toBeCloseTo(Z.bottom / 100, 2);
    // 세 구역 합이 전체를 넘지 않는다 = 서로를 밀어내지 않았다.
    expect(m.chipHeight + m.centerHeight + m.bottomHeight, '구역 합 = 전체').toBeCloseTo(zoneTotal, 0);
    // 그리고 배정 영역이 화면 밖으로 나가지 않았다.
    expect(zoneTotal, 'ActiveState가 뷰포트 안에 있다').toBeLessThanOrEqual(vp.viewport.height);
  });
}

// ─── 방어 2/3 — `overflow:hidden`: 영역 밖으로 그리지 않는다 ────────────────────
//
// 함정 원문: *"글리프는 라인박스 밖으로 그려진다 — 언더스코어·디센더가 `line-height:1` 박스 밖으로
//   나가 아래 영역을 침범."*
//
// 🔴 UI-a 함정 1과의 경계: 이 방어는 **zone 경계**(그리드 트랙 직속 자식)에만 건다.
//    `useFitGroup`이 높이를 재는 fit 컨테이너에 걸면 `scrollHeight <= clientHeight`가 항상 참이
//    되어 fit이 무력화된다 — 375px에서 항목명이 **소멸**한 그 경로다. 여기서는 안 건드린다.
for (const vp of [
  { name: '402×874', viewport: PHONE_402 },
  // 🔴 압력 뷰포트. 402×874는 하단 30%가 219px이라 여유가 많아 **삐져나올 게 없다** —
  //   반증에서 픽셀 단언이 green이었던 이유다(속성만 red). 하단 59px에서 재야 실효를 갖는다.
  { name: '390×340(압력)', viewport: { width: 390, height: 340 } },
]) {
test(`[UI-b 방어 2/3] overflow:hidden — 그리드 자식이 배정 트랙 밖으로 그리지 않는다 @ ${vp.name}`, async ({ page }) => {
  await bootOverloaded(page, vp.viewport);
  const zones = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="voice-active-state"]') as HTMLElement;
    const ids = ['voice-chip-grid', 'voice-center-stage', 'voice-control-bar'];
    return ids.map((id) => {
      // 트랙 자식은 testid가 붙은 요소 자신이거나 그 조상이다. 트랙 박스는 부모 기준으로 잡는다.
      const el = root.querySelector(`[data-testid="${id}"]`) as HTMLElement;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // 자식들이 이 박스 밖으로 나갔는지 — 실제로 **그려지는** 위치로 판정한다.
      let worstAbove = 0, worstBelow = 0;
      for (const k of Array.from(el.children) as HTMLElement[]) {
        const kr = k.getBoundingClientRect();
        worstAbove = Math.max(worstAbove, r.top - kr.top);
        worstBelow = Math.max(worstBelow, kr.bottom - r.bottom);
      }
      return {
        id,
        overflowY: cs.overflowY,
        scrollOverflow: el.scrollHeight - el.clientHeight,
        worstAbove, worstBelow,
      };
    });
  });
  for (const z of zones) {
    console.log(`[방어2 ${vp.name}] ${z.id} overflowY=${z.overflowY} scrollOver=${z.scrollOverflow} above=${z.worstAbove.toFixed(2)} below=${z.worstBelow.toFixed(2)}`);
  }

  // 🔑 세 트랙 자식 **전부** 세로 넘침을 잘라낸다. ActiveControlBar는 UI-b 전까지 이 방어가
  //   없었다 — 하단이 25→30%가 되고 UI-e에서 4행 키패드가 들어올 자리다.
  for (const z of zones) {
    expect(z.overflowY, `${z.id}는 세로 넘침을 잘라낸다`).toBe('hidden');
  }
  // 🔴 **픽셀 단언을 여기 두지 않는다 — 이 축은 rect로 측정할 수 없다.**
  //   `getBoundingClientRect`는 **clip을 반영하지 않는다.** 부모가 `overflow:hidden`으로 잘라내도
  //   자식 rect는 그대로 밖에 남는다. 그래서 "삐져나온 픽셀 0"은 방어의 작동 여부가 아니라
  //   **콘텐츠가 애초에 넘치지 않았는지**를 재는 셈이고, 402×874에서는 늘 참이라 공허했다.
  //   👉 위 속성 단언이 실효 단언이다. 아래는 **넘침의 크기를 기록**할 뿐 판정하지 않는다.
  //
  // ⚠️ 실측이 드러낸 것 — 390×340에서 `voice-chip-grid`가 `below=7.61 scrollOver=12`다.
  //    칩 하한 44px(장갑 조작)이 배정 트랙 39.4px보다 커서 **칩이 트랙을 넘고 잘린다.**
  //    이 뷰포트는 인공 극단이지만 **가로 모드가 여기 근처로 온다**(ui-standard §7-3 미정 축).
  //    → `deliverables/…ui-b-design.md` §6에 약점으로 등재했다.
  for (const z of zones) {
    // 넘치더라도 **스크롤로 새지 않는다** — 세로 스크롤이 생기면 양손 측정 중 접근이 불가능하다.
    expect(z.overflowY, `${z.id}가 세로 스크롤을 허용하면 안 된다`).not.toBe('auto');
    expect(z.overflowY, `${z.id}가 세로 스크롤을 허용하면 안 된다`).not.toBe('scroll');
  }
});
}

// ─── 방어 3/3 — `white-space: nowrap`: 중앙에 표시되는 것은 두 줄이 되지 않는다 ──
//
// ui-standard 규칙 4: *"줄바꿈 금지. 중앙에 표시되는 것은 무엇도 두 줄이 되지 않는다."*
// 함정 원문: *"폰트 메트릭이 계산보다 넓다 — 이론 최대에 붙여놓으면 실제 렌더에서 줄바꿈."*
test('[UI-b 방어 3/3] nowrap — 긴 라벨이 두 줄로 깨지지 않는다(잘릴지언정)', async ({ page }) => {
  // 🔴 여기서는 `bootOverloaded`를 쓰지 않는다. 컬럼 **이름을 바꾸면** 시트 stub의 직전값
  //   매칭이 깨져 추세 알람이 뜨지 않는다(실측으로 확인). 긴 이름 압력은 방어 1·2가 담당하고,
  //   방어 3의 대상은 **알람 화면의 라벨·값**이다.
  await boot(page, PHONE_402);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 5000 });
  // 🔴 중앙 값을 **실제로 렌더시킨다.** 안 그러면 칩 라벨만 재고 통과하는 반쪽 검사가 된다.
  //
  // ⚠️ **종전 구현이 여기서 flaky였다** — `fireStt('1234.5')` + `waitForTimeout(600)`을 썼는데,
  //    그 값이 **정상 커밋되면 다음 필드로 넘어가 중앙이 빈다**(대기 중엔 중앙을 안 그린다 —
  //    `v039:286`). 단독 실행에선 알람이 떠서 우연히 통과했고 **전체 직렬에서 red**가 됐다.
  //    고정 대기가 근인이 아니라 **보장 없는 상태 전제**가 근인이었다.
  // 👉 `triggerAnomaly`는 알람이 보일 때까지 기다린다 — **착지가 계약에 들어 있다.**
  //    그리고 알람 화면은 규칙 4가 *"같은 계열은 작은 쪽으로 통일"* 을 요구하는 본진이다
  //    (ui-standard §3-2: 1행 라벨 둘 / 2행 값 둘).
  await triggerAnomaly(page);
  const lines = await page.evaluate(() => {
    const out: Array<{ what: string; lines: number; ws: string; h: number; fs: number }> = [];
    const probe = (what: string, el: HTMLElement | null) => {
      if (!el) return;
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      const h = el.getBoundingClientRect().height;
      out.push({ what, ws: cs.whiteSpace, h, fs, lines: Math.round(h / fs) });
    };
    probe('chip-label', document.querySelector('[data-testid="column-chip-label"]'));
    // 🔴 중앙이 규칙 4의 본진이다 — 여기를 못 재면 이 테스트는 칩만 지키는 반쪽 검사가 된다.
    //   ⚠️ 상태마다 렌더되는 노드가 다르다. `1234.5`는 첫 컬럼의 추세 규칙에 걸려 **알람 화면**이
    //   뜨는데, 그 화면이야말로 규칙 4가 *"같은 계열은 작은 쪽으로 통일"* 을 요구하는 자리다
    //   (ui-standard §3-2: 1행 라벨 둘 / 2행 값 둘). 그래서 알람 노드들을 함께 잰다.
    const center = document.querySelector('[data-testid="voice-center-stage"]');
    for (const id of [
      'hero-primary', 'interim-value',
      'anomaly-prev-label', 'anomaly-next-label',
      'anomaly-prev-value', 'anomaly-next-value',
    ]) {
      probe(id, center?.querySelector(`[data-testid="${id}"]`) as HTMLElement ?? null);
    }
    return out;
  });
  for (const l of lines) {
    console.log(`[방어3] ${l.what} ws=${l.ws} h=${l.h.toFixed(1)} fs=${l.fs.toFixed(1)} lines≈${l.lines}`);
  }

  expect(lines.length, '측정 대상이 실제로 존재한다(공허 방지)').toBeGreaterThan(0);
  // 🔴 중앙을 하나 이상 실제로 쟀다. 칩 라벨만 재고 통과하면 규칙 4의 본진을 놓친 것이다.
  expect(
    lines.filter((l) => l.what !== 'chip-label').length,
    '중앙 값(hero-primary 또는 interim-value)을 실제로 측정했다',
  ).toBeGreaterThan(0);
  for (const l of lines) {
    // 🔑 **이게 이 테스트의 실효 단언이다.** 아래 높이 단언은 반증에서 green이었다 —
    //   칩이 `flex: 0 0 auto`라 폭이 내용에 맞춰져, `nowrap`을 빼도 줄바꿈할 이유가 없었다.
    //   높이만 재면 방어가 사라진 것을 못 잡는다.
    expect(l.ws, `${l.what}는 nowrap이다`).toBe('nowrap');
    // 라인 박스가 폰트 크기의 ~1배 = 한 줄. 두 줄이면 2배가 된다.
    //   `lineHeight: normal`(≈1.27)까지는 한 줄로 인정한다.
    //   ⚠️ 위 사유로 이 단언은 **보조**다. 폭이 구속되는 화면(UI-e의 키패드·2열 비교)이
    //   들어오면 그때 실효를 갖는다.
    expect(l.h / l.fs, `${l.what}가 두 줄로 깨졌다`).toBeLessThan(1.6);
  }
});
