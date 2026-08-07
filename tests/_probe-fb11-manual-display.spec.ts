/**
 * 🔬 **진단 프로브** — 판정 스위트가 아니다(`_` 접두 = `testIgnore`).
 *   돌리는 법: `npx playwright test tests/_probe-fb11-manual-display.spec.ts --config=playwright.probe.config.ts`
 *   ⚠️ `playwright.config.ts:30`이 안내하는 `--project=""`는 현 Playwright에서 죽었다(08-07 실측).
 *   ⚠️ probe config는 `reuseExistingServer:false` + `--strictPort`다. 다른 레인이 5177을 쓰고 있으면
 *      포트 바인드로 죽는다 — 그건 red가 아니라 **무판정**이다(`[TEAMOPS-64]`).
 *      회피: `SURVEY_BASE_URL=http://localhost:5187 npx playwright test …`
 *
 * ## 무엇을 재나
 *
 * 민구 제보 **FB-11**(2026-08-07): *"입력탭에서 음성 입력중 입력해야 할 항목의 칩 터치하여 수동
 * 입력시, 키패드가 팝업되고 사용자가 입력하는 숫자가 위에 출력되는데 마찬가지로 「311…」 이런식으로
 * 표현. **입력되는 값에 따라서 잘리거나 축약되지 않게 유동적으로 사이즈 조절**이 되면 좋겠어."*
 * 확정(08-07): *"축약(`...`)을 금지하고 폭에 맞춰서 글자 크기를 조절하는걸로."*
 *
 * 🔑 **FB-6·7(중앙 확정값)과 다른 컴포넌트다.** 그쪽은 `VoiceHero`이고 이쪽은 `ManualValueSheet`다.
 * 그리고 이쪽은 원인이 **명확히 재현된다** — 종전 `sheetDisplay`가 `max(128.64px, …)`라
 * 축소가 구조적으로 불가능했고(`--fit-lo`는 `max()` 첫 항에 흡수 · 훅도 안 물려 있었다),
 * `textOverflow: ellipsis`가 그 넘침을 `311…`으로 그렸다.
 *
 * ## 🔴 08-07 레인 V — 프로브가 왜 죽어 있었나 (규명 완료, 실측)
 *
 * 종전 이 파일은 `[data-col-name="횡경"]`을 클릭했는데 **`fixtures/activeZones.ts`의 픽스처에
 * 「횡경」 컬럼이 없다**(컬럼은 `조사일자`·`농가명`·`조사나무`·`측정항목01`~`12`). 그래서 3분
 * 타임아웃 ×3으로 죽었다. 실패 지점은 `boot()`가 **아니라** 그 뒤 칩 클릭이다 —
 * `boot()`의 `voice-active-state` 단언은 통과했다.
 * 👉 활성 칩은 `v039-active-zones.spec.ts:262`와 같은 `[data-active="true"]`로 잡는다.
 *
 * ## 판정 축 — 왜 `ovX`만으로는 부족한가 (🔴 이 프로브의 핵심)
 *
 * 처방 커밋(`6d69165`)이 `textOverflow: ellipsis`를 **지우고** `whiteSpace: normal` +
 * `wordBreak: break-all`로 바꿨다. 그래서 축 ①(`textOverflow !== 'ellipsis'`)과
 * 축 ②(`ovX`)는 **공허하게 통과한다** — 이제 글자가 가로로 넘치는 대신 **줄바꿈**한다.
 * 넘침은 세로로 간다. 그리고 표시 zone은 `alignItems: flex-end`이므로 넘친 부분은
 * **위쪽으로 삐져나가** `overflow:hidden`에 잘린다. `scrollHeight`는 inline-start 방향
 * 넘침을 못 잡으므로(같은 함정을 `fitGroup.ts:44`가 이미 적어놨다) **rect 차이가 정본**이다.
 *
 * | 축 | 무엇 | 왜 |
 * |---|---|---|
 * | ① `textOverflow !== 'ellipsis'` | 회귀 가드 | 되살아나면 `311…`이 돌아온다. 단 단독으론 증거가 아니다 |
 * | ② `outTop/outRight/outBottom/outLeft <= 0.5` | **정본** | zone 밖으로 나간 잉크 = 잘림 |
 * | ③ 폰트 단조 비증가 | fit이 실제로 작동하는가 | 값이 길어졌는데 커지면 fit이 안 물린 것 |
 *
 * ## 🔴 구조적 판정선 — `fitVar` vs 0.342
 *
 * `VOICE_TYPE.sheetDisplay = 'max(44px, calc(128.64px * var(--fit-sheet, 1)))'`이므로
 * CSS 하한은 배율 **44 / 128.64 ≈ 0.342**에서 물린다. 그런데 `fitGroup.ts:166`의
 * `minScale` 기본값은 **0.25**다. 즉 fit이 0.25~0.342 구간의 배율을 계산하면 **CSS가 그걸
 * 무시하고 44px로 그린다** — 종전 `max(128.64px, …)`와 **같은 구조의 버그가 하한만 낮춘 채
 * 남아 있는** 형태다. 그래서 이 프로브는 `fitVar`를 항상 기록한다:
 *   - `fitVar < 0.342` **이면서** 넘침 > 0.5  → 🔴 하한이 fit을 흡수하고 있다(처방 부족)
 *   - `fitVar`가 모든 시퀀스에서 정확히 1.0  → 🔴 fit이 아예 안 물렸다(다른 결함)
 */
import { test, expect, type Page } from '@playwright/test';
import { boot } from './fixtures/activeZones';
import { waitForTtsIdle } from './fixtures/stt';

test.setTimeout(180_000);

/** CSS 하한 `max(44px, …)`이 배율을 흡수하기 시작하는 지점. 위 §구조적 판정선 참조. */
const FLOOR_SCALE = 44 / 128.64;

const VIEWPORTS = [
  { width: 402, height: 513, label: '402x513·민구실측' },
  { width: 402, height: 874, label: '402x874·대조군' },
  { width: 375, height: 667, label: '375x667·최소지원' },
];

/** 민구 제보값(`311…`)을 포함해 자릿수를 늘려간다. 마지막은 극단 대조군이다. */
const SEQUENCES = ['3', '31', '311', '311.5', '3115.75', '311575.25'];

async function openKeypad(page: Page) {
  await waitForTtsIdle(page);
  // 🔴 픽스처에 「횡경」은 없다(위 §규명). 활성 칩을 잡는다 — v039-active-zones.spec.ts:262와 같은 경로.
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 4000 });
}

/** 표시 요소의 실렌더 계측.
 *  🔴 `out*`(rect 차이)이 정본이고 `scrollWidth/Height`는 **보조 교차확인**이다 —
 *     `alignItems: flex-end`에서 위로 넘친 부분은 스크롤 메트릭에 안 잡힌다. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const zone = document.querySelector('[data-testid="manual-value-display-zone"]') as HTMLElement | null;
    const disp = document.querySelector('[data-testid="manual-keypad-display"]') as HTMLElement | null;
    if (!zone || !disp) return null;
    const span = disp.querySelector('span') as HTMLElement | null;
    const cs = getComputedStyle(disp);
    const zr = zone.getBoundingClientRect();
    const dr = disp.getBoundingClientRect();
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const fitRaw = getComputedStyle(zone).getPropertyValue('--fit-sheet').trim();
    return {
      text: (span?.textContent ?? '').trim(),
      fontPx: r1(parseFloat(cs.fontSize)),
      textOverflow: cs.textOverflow,
      whiteSpace: cs.whiteSpace,
      // zone(=fit 컨테이너, overflow:hidden) 밖으로 나간 잉크. 양수 = 그만큼 잘렸다.
      outTop: r1(zr.top - dr.top),
      outBottom: r1(dr.bottom - zr.bottom),
      outLeft: r1(zr.left - dr.left),
      outRight: r1(dr.right - zr.right),
      // 보조: 스크롤 메트릭(가로 넘침·아래 넘침만 잡힌다).
      ovX: disp.scrollWidth - disp.clientWidth,
      ovY: disp.scrollHeight - disp.clientHeight,
      zoneOvY: zone.scrollHeight - zone.clientHeight,
      dispH: r1(dr.height),
      zoneH: r1(zr.height),
      fitVar: fitRaw,
      fitNum: fitRaw ? parseFloat(fitRaw) : NaN,
    };
  });
}

const rows: string[] = [];

for (const vp of VIEWPORTS) {
  test(`프로브 ${vp.label} — 자릿수를 늘려도 축약되지 않는다`, async ({ page }) => {
    const t0 = Date.now();
    await boot(page, { width: vp.width, height: vp.height });
    await openKeypad(page);

    let prevFont = Infinity;
    for (const seq of SEQUENCES) {
      // 매번 처음부터 다시 친다(백스페이스 경로를 섞지 않는다 — 축을 하나만 움직인다).
      for (let i = 0; i < 12; i++) await page.locator('[data-testid="manual-key-back"]').click();
      for (const ch of seq) {
        await page.locator(`[data-testid="manual-key-${ch}"]`).click();
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const m = await measure(page);
      if (!m) { rows.push(`${vp.label} | ${seq} | ❌ 요소 없음`); continue; }
      const worst = Math.max(m.outTop, m.outBottom, m.outLeft, m.outRight);
      const clipped = worst > 0.5;
      const floored = Number.isFinite(m.fitNum) && m.fitNum < FLOOR_SCALE;
      rows.push(
        `${vp.label} | ${seq.padEnd(10)} | ${clipped ? '🔴잘림' : '🟢'}${floored ? '⚠️하한흡수' : ''} ` +
        `font=${String(m.fontPx).padStart(6)} outT=${m.outTop} outB=${m.outBottom} ` +
        `outL=${m.outLeft} outR=${m.outRight} ovX=${m.ovX} ovY=${m.ovY} zOvY=${m.zoneOvY} ` +
        `dispH=${m.dispH} zoneH=${m.zoneH} fit=${m.fitVar} to=${m.textOverflow} ws=${m.whiteSpace} txt="${m.text}"`,
      );
      // 🔴 진단 패스는 **soft**다 — 한 시퀀스에서 던지면 뒤 시퀀스 표가 통째로 사라진다.
      //    (승격한다면 그때 hard로 굳힌다 — V-3.)
      // 축 ①: 민구 확정 계약 — 축약 금지. 회귀 가드이지 증거는 아니다(위 §판정 축).
      expect.soft(m.textOverflow, `${seq}: textOverflow가 ellipsis면 값이 감춰진다`).not.toBe('ellipsis');
      // 축 ②(정본): zone 밖으로 나간 잉크가 없어야 한다. flex-end라 넘침은 위로 간다.
      expect.soft(worst, `${seq}: 표시가 zone 밖으로 나갔다(outT/B/L/R 중 최대)`).toBeLessThanOrEqual(0.5);
      // 축 ③: 길어지면 폰트는 줄거나 최소한 커지지 않는다.
      expect.soft(m.fontPx, `${seq}: 값이 길어졌는데 글자가 커졌다`).toBeLessThanOrEqual(prevFont + 0.5);
      prevFont = m.fontPx;
    }
    rows.push(`${vp.label} | ⏱ ${Math.round((Date.now() - t0) / 100) / 10}s`);
  });
}

test.afterAll(() => {
  console.log('\n\n═══════ FB-11 수동입력 표시 프로브 ═══════');
  console.log(`(하한 흡수 판정선 --fit-sheet < ${Math.round(FLOOR_SCALE * 10000) / 10000})`);
  for (const r of rows) console.log(r);
  console.log('════════════════════════════════════════\n');
});
