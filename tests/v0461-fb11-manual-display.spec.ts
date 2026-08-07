/**
 * 🔴 **판정 오라클** — FB-11(수동입력 값 표시가 잘리지 않는다).
 *
 * 진단용 전체 격자(3뷰포트 × 6시퀀스, 3.4분)는 `_probe-fb11-manual-display.spec.ts`에 있다.
 * 이 파일은 그중 **회귀를 잡는 최소 조합만** 남긴 것이다 — 게이트는 배포마다 돌기 때문이다.
 * 🔴 **여기서 뺀 것**(§0-9 "silent cap 금지"): 뷰포트 402×874·375×667, 시퀀스 `3`·`31`·`311.5`·
 *    `3115.75`. 뺀 이유는 셋 다 같은 결함을 같은 방향으로 잡았기 때문이고(08-07 실측 18행),
 *    **넘침 폭이 가장 큰 402×513만 남겨도 회귀는 걸린다.** 처방을 만질 때는 프로브 쪽을 돌려라.
 *
 * ## 무엇을 잡는가 — 두 번 다른 옷을 입고 나타난 같은 결함
 *
 * 민구 제보(08-07): *"수동 입력시 키패드 위 숫자가 「311…」로 잘린다.
 * **축약되지 않게 유동적으로 사이즈 조절**되면 좋겠어."* → 확정: *"축약 금지, 폭에 맞춰 글자 크기 조절."*
 *
 * | | 증상 | 원인 |
 * |---|---|---|
 * | ① v0.46.0 | `311…` | `sheetDisplay`가 `max(128.64px, …)`라 **축소가 구조적으로 불가능** + `textOverflow:ellipsis` |
 * | ② `6d69165` 직후 | 화면에 **`25`만** 보임(잘린 표시조차 없음) | fit의 **높이 판정이 죽어** 배율이 3.6까지 폭주 → 폰트 463px |
 *
 * ②의 기전(08-07 레인 V 실측): `fitGroups`의 `fits()`가 ⓐ폭 — `wordBreak:'break-all'`이라
 * 잉크가 항상 박스 안 ⓑ높이 — 표시 zone이 `alignItems:'flex-end'`라 넘침이 **block-start(위)**로
 * 가고 그 방향은 `scrollHeight`에 **안 잡힌다**(`zOvY=0` 실측). 둘 다 통과하니 이진탐색이
 * "더 키워도 된다"고 읽었다. 👉 처방은 **`flex-start` + `marginTop:'auto'`**
 * (`ManualValueSheet.tsx`의 zone 주석이 SSOT).
 *
 * ## 🔴 판정축 — `textOverflow`/`ovX`는 **증거가 아니다**
 *
 * 처방이 `textOverflow`를 지웠고(`clip`) 줄바꿈이라 가로로 넘칠 일이 없다. ②일 때도 그 둘은
 * **통과하면서** 값이 사라지고 있었다(실측 18행 전부). 정본은 **rect 차이**(`out*`)다.
 * `scrollHeight`는 위 ⓑ 이유로 이 레이아웃에서 못 쓴다.
 *
 * ## 🔴🔴 이 오라클이 **안 재는 것** — green을 과신하지 마라
 *
 * | 안 재는 것 | 왜 |
 * |---|---|
 * | **글자의 절대 크기 / 배율 상한** | 단언은 `fontPx <= prevFont + 0.5`(값이 길어질 때 **단조감소**)뿐이라 **첫 값이 얼마나 크든 통과한다.** 402×874·`3`은 실측 `--fit-sheet=1.7976` → **231.2px**로 종전 128.64px보다 크다. 🔑 **이것은 결함이 아니라 민구 확정(08-07)으로 허용된 동작이다** — *"빈 공간을 안 남기는 게 원거리 가독에 낫다"*. **상한 단언을 넣지 마라.** 크기가 문제로 제보되면 그때 `heroLayout.ts` §sheetDisplay를 민구와 다시 정한다 |
 * | **`--fit-sheet` 하한(0.342) 흡수 경로** | 여기 최장값 9자에서 최저 배율이 0.5231이라 **하한에 안 닿는다.** `ManualValueSheet`의 `minScale` 처방은 논리적 정합만 맞췄고 **실측 미검증**이다. 20자 이상 값으로 프로브를 돌려야 확인된다 |
 * | **402×874 · 375×667** | 같은 결함을 같은 방향으로 잡아서 뺐다(위 §최소 조합). 처방을 만지면 프로브를 돌려라 |
 * | **text·date 입력** | 이 레인은 키패드(`int`/`float`) 경로만 봤다. `manual-text-input`·`manual-date-input`은 fit을 안 물고 있고 긴 값에서의 거동이 **미확인**이다 |
 * | **실기기** | 데스크톱 Chromium headless다. `CLAUDE.md` 계약 4항 — 상태는 `MONITORING`이지 `RESOLVED`가 아니다 |
 */
import { test, expect, type Page } from '@playwright/test';
import { boot } from './fixtures/activeZones';
import { waitForTtsIdle } from './fixtures/stt';

test.setTimeout(60_000);

/** 민구 실기기 실측 뷰포트. 세 격자 중 넘침 폭이 가장 컸다(08-07: `outTop` 최대 1148.3px). */
const VIEWPORT = { width: 402, height: 513 };
/** 제보값 `311` + 극단 대조군. 사이 값들은 프로브가 본다. */
const SEQUENCES = ['311', '311575.25'];

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
    return {
      text: (span?.textContent ?? '').trim(),
      fontPx: r1(parseFloat(cs.fontSize)),
      textOverflow: cs.textOverflow,
      // zone(fit 컨테이너, overflow:hidden) 밖으로 나간 잉크. 양수 = 그만큼 잘렸다.
      outTop: r1(zr.top - dr.top),
      outBottom: r1(dr.bottom - zr.bottom),
      outLeft: r1(zr.left - dr.left),
      outRight: r1(dr.right - zr.right),
    };
  });
}

test('FB-11 — 수동입력 값이 길어져도 표시가 잘리지 않는다 @402×513', async ({ page }) => {
  await boot(page, VIEWPORT);
  await waitForTtsIdle(page);
  // 픽스처에 「횡경」 같은 이름은 없다(시트 불특정 §0-7) — 활성 칩으로 잡는다.
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 4000 });

  let prevFont = Infinity;
  let prevLen = 0;
  for (const seq of SEQUENCES) {
    for (let i = 0; i < prevLen; i++) await page.locator('[data-testid="manual-key-back"]').click();
    for (const ch of seq) await page.locator(`[data-testid="manual-key-${ch}"]`).click();
    prevLen = seq.length;
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);

    const m = await measure(page);
    expect(m, '표시 요소를 찾지 못했다').not.toBeNull();
    const worst = Math.max(m!.outTop, m!.outBottom, m!.outLeft, m!.outRight);

    // 🔴 정본 — 값이 표시 영역 밖으로 나가면 그만큼 사용자에게 안 보인다.
    //    되돌림 감지: zone을 `alignItems:'flex-end'`로 되돌리면 `outTop`이 1000px대로 뛴다.
    expect(
      worst,
      `"${seq}": 표시가 zone 밖으로 ${worst}px 나갔다 (outT=${m!.outTop} outB=${m!.outBottom} `
      + `outL=${m!.outLeft} outR=${m!.outRight}, font=${m!.fontPx}px, 보이는 값="${m!.text}")`,
    ).toBeLessThanOrEqual(0.5);

    // 민구 확정 계약 — 축약 금지. 단독으론 증거가 아니다(위 §판정축).
    expect(m!.textOverflow, `"${seq}": textOverflow가 ellipsis면 값이 감춰진다`).not.toBe('ellipsis');

    // fit이 실제로 물려 있는가 — 값이 길어졌는데 글자가 커지면 판정이 죽은 것이다.
    expect(m!.fontPx, `"${seq}": 값이 길어졌는데 글자가 커졌다(${prevFont}→${m!.fontPx}px)`)
      .toBeLessThanOrEqual(prevFont + 0.5);
    prevFont = m!.fontPx;
  }
});
