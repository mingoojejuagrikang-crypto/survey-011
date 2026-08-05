import { test, expect } from '@playwright/test';
import { boot, COLUMNS, PHONE_375, PHONE_402, PREV_ROUND, SETTINGS } from './fixtures/activeZones';
import {
  CHIP_SWEEP_DEFAULT_SECONDS,
  chipSweepOffset,
  chipSweepStartFor,
  normalizeChipSweepSeconds,
  shouldChipSweep,
} from '../src/lib/chipSweep';

/** v0.46.0 WP-D(민구 R3 · 제보 F17) — **칩존 좌우 왕복 스크롤** 오라클.
 *
 *  ## 🔴 왜 이 파일이 필요한가
 *  왕복은 **애니메이션**이라 조용히 죽어도 아무도 모른다. 칩은 그대로 있고 하이라이트도 그대로라
 *  화면이 "정상으로 보인다" — 다만 멀리서 진행 상황이 안 보일 뿐이고, 그건 제보 F17 그 자체다.
 *  👉 *"돌고 있는가"* 를 재는 단언이 없으면 이 기능은 회귀를 감지할 수 없다.
 *
 *  ## 재는 축
 *  | # | 축 | 어떻게 |
 *  |---|---|---|
 *  | ① | **0초 = 끔** — 안 움직인다 | 2.4초 동안 `scrollLeft` 표본 12개가 전부 같다 |
 *  | ② | **기본값이 8초다** | 저장본에 필드가 없을 때 merge가 8을 채운다(`data-chip-sweep`) |
 *  | ②-b | 🔴 **배포 기본값 8초에서 실제로 돈다** | 공유 픽스처가 24개 스펙 전부를 `0`으로 끄고 축 ③은 1초로 축약하므로, **이 테스트가 없으면 사용자가 받는 경로를 아무도 안 돌린다** |
 *  | ③ | **켜지면 왕복한다** — 변하고 **되돌아온다** | 표본 시퀀스에 유의한 **상승**과 **하강**이 둘 다 있다(단방향 스크롤이 아니다) |
 *  | ④ | **왕복 중에도 활성 칩 하이라이트가 유지된다** | 왕복이 실제로 진행된 뒤에도 `[data-active="true"]` 칩이 정확히 1개 |
 *  | ⑤ | **칩이 다 보이면 왕복하지 않는다**(§시트 불특정) | 넓은 뷰포트에서 `maxScroll === 0`이면 `scrollLeft` 불변 |
 *  | ⑥ | **산술**(삼각파·위상 역산·coercion) | 브라우저 없이 순수함수로 — 시간 의존 0, flake 0 |
 *
 *  ## 안 재는 축 (의도적으로 비운다 — 다음 사람이 "빠졌다"고 오해하지 않게)
 *  - **왕복이 「보기 좋은 속도인가」** — 2~3m 거리에서 읽히는지는 **실기기 판정**이다
 *    (`docs/REAL-DEVICE-TEST.md`). 데스크톱 Playwright는 거리 감각을 못 잰다.
 *  - **8초라는 값의 정확한 주기(±ms)** — rAF는 부하에 따라 프레임이 밀린다. 주기를 ms로 단언하면
 *    상주 부하 환경에서 flaky가 된다(§4-6 경고). **방향 전환이 일어나는가**만 잰다.
 *  - **`prefers-reduced-motion`에서 루프가 안 도는 것** — 코드로는 보장하지만(ChipZone의 조기
 *    return) Playwright 기본 컨텍스트가 `no-preference`라 여기서 재려면 별도 컨텍스트가 필요하다.
 *    ⏭ 미확인으로 남긴다.
 *  - **07-27 우측끝 정렬 계약 자체** — 그건 `v039-active-zones.spec.ts`가 재고, 그 픽스처는
 *    `chipSweepSeconds: 0`을 넣어 **「왕복 OFF일 때의 계약」** 으로 명시돼 있다. 여기서 겹쳐 재지 않는다.
 *  - **72조합 뷰포트 잘림** — `v0440-chip-viewport-sweep.spec.ts`가 정본 게이트다.
 *
 *  ## flaky 대책
 *  기본 8초로 왕복 한 바퀴를 기다리면 테스트 1건에 16초가 든다. **편도 1초**를 주입해 같은
 *  산술을 1/8 시간에 관측한다 — 이건 **목이 아니라 대기 축약**이다(같은 코드 경로, 같은 삼각파,
 *  파라미터만 작다). 기본값 8초 자체는 축 ②가 따로 잰다. */

const SWEEP_TEST_SECONDS = 1; // 편도 1초 = 왕복 2초. 대기 축약용(목 아님 — §flaky 대책 참조).

function settingsWithSweep(seconds: number) {
  return { ...SETTINGS, state: { ...SETTINGS.state, chipSweepSeconds: seconds } };
}

/** 저장본에서 필드를 **빼서** persist merge의 기본값 경로를 태운다(축 ②). */
function settingsWithoutSweep() {
  const state = { ...SETTINGS.state } as Record<string, unknown>;
  delete state.chipSweepSeconds;
  return { ...SETTINGS, state } as typeof SETTINGS;
}

async function chipZoneMetrics(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    return {
      scrollLeft: g.scrollLeft,
      maxScroll: g.scrollWidth - g.clientWidth,
      sweepAttr: g.getAttribute('data-chip-sweep'),
    };
  });
}

/** `count`개의 `scrollLeft` 표본을 `everyMs` 간격으로 모은다. */
async function sampleScrollLeft(
  page: import('@playwright/test').Page,
  count: number,
  everyMs: number,
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push((await chipZoneMetrics(page)).scrollLeft);
    await page.waitForTimeout(everyMs);
  }
  return out;
}

// ── ⑥ 산술 — 브라우저 없이, 시간 의존 없이 ──────────────────────────────────────
test.describe('WP-D 산술(순수함수) — 시간·DOM 의존 0', () => {
  test('삼각파: 0 → max → 0 을 편도 시간마다 반복한다', () => {
    const one = 8;
    const max = 1000;
    expect(chipSweepOffset(0, one, max), '시작은 왼쪽 끝').toBe(0);
    expect(chipSweepOffset(4000, one, max), '편도 절반 = 거리 절반').toBeCloseTo(500, 6);
    expect(chipSweepOffset(8000, one, max), '편도 끝 = 오른쪽 끝').toBeCloseTo(1000, 6);
    expect(chipSweepOffset(12000, one, max), '되돌아오는 중 = 절반').toBeCloseTo(500, 6);
    expect(chipSweepOffset(16000, one, max), '왕복 1주기 = 다시 왼쪽 끝').toBeCloseTo(0, 6);
    expect(chipSweepOffset(16000 + 4000, one, max), '다음 주기도 같은 위상').toBeCloseTo(500, 6);
  });

  test('왕복 1주기는 편도의 2배다 — 「8초 = 편도」 계약(민구 R3 · A2 확정)', () => {
    const max = 400;
    // 편도 8초면 8초 지점이 최원거리여야 한다. 왕복 1주기로 해석했다면 여기가 0이 된다.
    expect(chipSweepOffset(CHIP_SWEEP_DEFAULT_SECONDS * 1000, CHIP_SWEEP_DEFAULT_SECONDS, max)).toBeCloseTo(max, 6);
  });

  test('왕복 거리가 없으면(칩이 다 보임) 항상 0 — 칩 개수·폭 가정 없음(§시트 불특정)', () => {
    expect(chipSweepOffset(3000, 8, 0), 'maxScroll 0').toBe(0);
    expect(chipSweepOffset(3000, 8, -20), '음수(서브픽셀 반올림)').toBe(0);
    expect(chipSweepOffset(3000, 8, 1), '1px 이하는 왕복 아님').toBe(0);
    expect(shouldChipSweep(8, 0), '다 보이면 왕복 안 함').toBe(false);
    expect(shouldChipSweep(0, 9999), '0초면 왕복 안 함').toBe(false);
    expect(shouldChipSweep(8, 500), '넘치고 켜져 있으면 왕복').toBe(true);
  });

  test('음수 경과(재동기화 오차·시계 되감김)도 같은 위상으로 접는다', () => {
    expect(chipSweepOffset(-4000, 8, 1000), '-4초 = 하강 구간 절반').toBeCloseTo(500, 6);
    expect(chipSweepOffset(-16000, 8, 1000), '-1주기 = 왼쪽 끝').toBeCloseTo(0, 6);
  });

  test('위상 역산: 현재 위치에서 이어받으면 그 위치가 그대로 나온다', () => {
    const now = 12345;
    const max = 800;
    for (const at of [0, 120, 400, 799.5, 800]) {
      const start = chipSweepStartFor(now, at, 8, max);
      expect(chipSweepOffset(now - start, 8, max), `scrollLeft ${at}에서 이어받기`).toBeCloseTo(at, 4);
    }
  });

  test('coercion: 0은 유효(끔), 쓰레기는 기본 8로 치유', () => {
    expect(normalizeChipSweepSeconds(0), '0 = 끔은 유효값').toBe(0);
    expect(normalizeChipSweepSeconds(5)).toBe(5);
    expect(normalizeChipSweepSeconds(undefined), '구버전 영속본(필드 없음)').toBe(CHIP_SWEEP_DEFAULT_SECONDS);
    expect(normalizeChipSweepSeconds('8'), '문자열').toBe(CHIP_SWEEP_DEFAULT_SECONDS);
    expect(normalizeChipSweepSeconds(NaN)).toBe(CHIP_SWEEP_DEFAULT_SECONDS);
    expect(normalizeChipSweepSeconds(-3), '음수').toBe(CHIP_SWEEP_DEFAULT_SECONDS);
    expect(normalizeChipSweepSeconds(9999), '상한 초과').toBe(CHIP_SWEEP_DEFAULT_SECONDS);
    expect(normalizeChipSweepSeconds(4.4), '스텝 밖 소수는 접는다').toBe(4);
  });
});

// ── ①②③④⑤ 배선 — 실제 화면 ─────────────────────────────────────────────────
test.describe('WP-D 왕복 배선 — 입력화면', () => {
  test('① 0초 = 끔 — 2.4초 동안 칩존이 1px도 움직이지 않는다', async ({ page }) => {
    await boot(page, PHONE_402, { settings: settingsWithSweep(0), preserveAnimations: true });
    const before = await chipZoneMetrics(page);
    // 공허 방지 — 넘치지 않는 화면이면 "안 움직였다"가 아무것도 증명하지 않는다.
    expect(before.maxScroll, '칩이 실제로 넘쳐야 이 테스트가 의미를 갖는다').toBeGreaterThan(50);
    expect(before.sweepAttr, '끔 상태가 DOM에 드러난다').toBe('off');

    const samples = await sampleScrollLeft(page, 12, 200);
    const spread = Math.max(...samples) - Math.min(...samples);
    console.log(`sweep-off: samples=${samples.map((v) => Math.round(v)).join(',')} spread=${spread.toFixed(2)}`);
    expect(spread, '0초면 왕복이 아예 돌지 않는다').toBeLessThanOrEqual(1);
  });

  test('② 저장본에 값이 없으면 기본 8초(민구 R3) — 편도 기준', async ({ page }) => {
    await boot(page, PHONE_402, { settings: settingsWithoutSweep(), preserveAnimations: true });
    const m = await chipZoneMetrics(page);
    expect(m.sweepAttr, '구버전 영속본은 기본 8초로 치유된다').toBe(String(CHIP_SWEEP_DEFAULT_SECONDS));
    expect(CHIP_SWEEP_DEFAULT_SECONDS, '민구 확정값').toBe(8);
  });

  test('②-b 🔴 **배포 기본값 그대로** 왕복이 실제로 돈다(축약값 아님)', async ({ page }) => {
    // 🔴 왜 이게 따로 필요한가 — **공유 픽스처 `tests/fixtures/activeZones.ts`가 24개 스펙 전부에
    //    `chipSweepSeconds: 0`을 넣는다.** 그리고 축 ③은 편도 1초로 **축약**해서 잰다. 그래서
    //    ②-b가 없으면 **사용자가 실제로 받는 8초 경로를 스위트 전체에서 아무도 돌리지 않는다** —
    //    `useChipSweep`이 기본값에서만 죽어도 1189건이 전부 green이다.
    //    비용은 2초다(편도 8초의 1/4 = maxScroll의 ~25%가 움직인다. 한 바퀴 16초를 기다리지 않는다).
    await boot(page, PHONE_402, { settings: settingsWithoutSweep(), preserveAnimations: true });
    const before = await chipZoneMetrics(page);
    expect(before.sweepAttr, '축약값이 아니라 배포 기본값이다').toBe('8');
    expect(before.maxScroll, '칩이 넘치는 상태여야 의미가 있다').toBeGreaterThan(50);

    const samples = await sampleScrollLeft(page, 10, 200); // ≈2.0초
    const spread = Math.max(...samples) - Math.min(...samples);
    // 편도 8초 등속이면 2초에 maxScroll의 약 25%가 움직인다. 하한은 그 절반으로 넉넉히 잡는다
    // (rAF가 부하로 밀려도 방향 자체는 사라지지 않는다 — ms를 단언하지 않는 이유와 같다).
    const floor = before.maxScroll * 0.12;
    console.log(`sweep-default-8s: max=${Math.round(before.maxScroll)} spread=${spread.toFixed(1)} floor=${floor.toFixed(1)}`);
    expect(spread, '기본 8초에서도 칩존이 실제로 움직인다').toBeGreaterThan(floor);
  });

  test('③ 켜지면 왕복한다 — 오른쪽으로 갔다가 **되돌아온다**', async ({ page }) => {
    await boot(page, PHONE_402, { settings: settingsWithSweep(SWEEP_TEST_SECONDS), preserveAnimations: true });
    const before = await chipZoneMetrics(page);
    expect(before.maxScroll, '칩이 넘치는 상태여야 왕복이 의미를 갖는다').toBeGreaterThan(50);
    expect(before.sweepAttr).toBe(String(SWEEP_TEST_SECONDS));

    // 편도 1초 → 2.6초면 1.3주기. 상승·하강 구간을 모두 지난다.
    const samples = await sampleScrollLeft(page, 26, 100);
    // 허용오차는 넉넉하게 — rAF 프레임이 밀려도 방향 전환 자체는 사라지지 않는다(§4-6).
    const tol = Math.max(8, before.maxScroll * 0.15);
    let rose = false;
    let fell = false;
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        if (samples[j] - samples[i] > tol) rose = true;
        if (samples[i] - samples[j] > tol) fell = true;
      }
    }
    const spread = Math.max(...samples) - Math.min(...samples);
    console.log(`sweep-on: max=${Math.round(before.maxScroll)} spread=${spread.toFixed(1)} tol=${tol.toFixed(1)} rose=${rose} fell=${fell}`);
    expect(rose, '오른쪽으로 흘러간다').toBe(true);
    expect(fell, '왼쪽으로 **되돌아온다**(단방향 스크롤이 아니다)').toBe(true);
    expect(spread, '왕복 폭이 실제 거리의 상당 부분을 쓴다').toBeGreaterThan(before.maxScroll * 0.3);
  });

  test('④ 왕복 중에도 **진행중 칩 하이라이트가 유지된다**(민구 R3 🔴 유지 조건)', async ({ page }) => {
    await boot(page, PHONE_402, { settings: settingsWithSweep(SWEEP_TEST_SECONDS), preserveAnimations: true });
    const active = page.locator('[data-testid="column-chip"][data-active="true"]');
    await expect(active, '왕복 시작 전 활성 칩 1개').toHaveCount(1);
    const nameBefore = await active.first().innerText();

    const start = (await chipZoneMetrics(page)).scrollLeft;
    await page.waitForTimeout(1400); // 편도 1초 초과 — 반환점을 지난다
    const moved = Math.abs((await chipZoneMetrics(page)).scrollLeft - start);
    // 공허 방지 — 왕복이 실제로 진행된 뒤의 하이라이트를 재는 것이 이 테스트의 전부다.
    expect(moved, '왕복이 실제로 진행됐다').toBeGreaterThan(5);

    await expect(active, '왕복은 「보기」 수단이지 활성 표시를 대체하지 않는다').toHaveCount(1);
    expect(await active.first().innerText(), '같은 칩이 계속 활성이다').toBe(nameBefore);
  });

  test('⑤ 칩이 화면에 다 들어오면 왕복하지 않는다(§시트 불특정 — 칩 개수 가정 없음)', async ({ page }) => {
    // 🔴 **화면을 넓히는 것으로는 이 전제를 만들 수 없다** — 실측(1920×1024): 15칩의 `maxScroll`이
    //    3145 → 5134로 **늘었다**. 칩 크기가 칩존 컨테이너 비례(`cqw`/`cqh`)라 폭을 키우면 칩도
    //    함께 커지기 때문이다(ChipZone 헤더 주석 "크기는 전부 컨테이너 비례다").
    //    👉 넘침을 가르는 변수는 **칩 개수**다. 항목 3개짜리 시트(= 내일 쓸 품질조사 시트일 수도
    //    있다)를 만들어 잰다. 이게 §시트 불특정이 요구하는 바로 그 경우다.
    //    ⚠️ auto 3개(조사일자·농가명·조사나무)는 그대로 둔다 — `COLUMNS.slice(0, 3)`을 깨면
    //    (예: sampleKey 컬럼 제거) 앱이 *"먼저 설정 탭에서 테이블을 생성하세요"* 로 떨어져
    //    세션이 시작되지 않는다(v043-fit-group의 `twoVoiceSettings`와 같은 관례).
    const FEW = [...COLUMNS.slice(0, 3), COLUMNS[3]]; // auto 3 + 측정항목01(voice) = 칩 4개
    await boot(page, { width: 2560, height: 1024 }, {
      settings: { ...SETTINGS, state: { ...SETTINGS.state, columns: FEW, chipSweepSeconds: SWEEP_TEST_SECONDS } },
      headers: FEW.map((c) => c.name),
      sheetRows: [[PREV_ROUND, '이원창', '1', '100.0'], [PREV_ROUND, '이원창', '2', '100.0']],
      preserveAnimations: true,
    });
    const m = await chipZoneMetrics(page);
    console.log(`few-chips: maxScroll=${Math.round(m.maxScroll)} sweepAttr=${m.sweepAttr}`);
    // 전제가 성립하지 않으면 조용히 통과시키지 않고 시끄럽게 알린다.
    expect(m.maxScroll, '칩 3개가 1920 폭에 다 들어와야 이 축을 잴 수 있다').toBeLessThanOrEqual(1);
    expect(m.sweepAttr, '설정은 켜져 있다(왕복 안 하는 이유가 「끔」이 아니다)').toBe(String(SWEEP_TEST_SECONDS));

    const samples = await sampleScrollLeft(page, 10, 150);
    const spread = Math.max(...samples) - Math.min(...samples);
    expect(spread, '왕복할 거리가 없으면 건드리지 않는다').toBeLessThanOrEqual(1);
  });
});

// ── ⑦ 설정 UI — 입력탭 조절판 서랍(민구 08-05 확정: 「입력탭의 진행설정」) ────────────────
test.describe('WP-D 설정 UI — 서랍 4번째 항목', () => {
  /** 서랍을 펼치고 칩 왕복 행의 기하를 잰다. */
  async function drawerMetrics(page: import('@playwright/test').Page) {
    const toggle = page.locator('[data-testid="input-control-toggle"]');
    const collapsedH = (await toggle.boundingBox())?.height ?? 0;
    await toggle.click();
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid="stepper-chip-sweep"]'), '칩 왕복 스텝퍼가 서랍 안에 있다').toBeVisible();
    const m = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="input-control-panel"]') as HTMLElement;
      const row = document.querySelector('[data-testid="stepper-chip-sweep"]') as HTMLElement;
      const minus = document.querySelector('[data-testid="stepper-chip-sweep-minus"]') as HTMLElement;
      const mr = minus.getBoundingClientRect();
      return {
        panelBottom: panel.getBoundingClientRect().bottom,
        panelHeight: panel.getBoundingClientRect().height,
        rowBottom: row.getBoundingClientRect().bottom,
        minusSize: Math.min(mr.width, mr.height),
        viewportH: window.innerHeight,
      };
    });
    return { ...m, collapsedH, overflow: m.rowBottom - m.viewportH };
  }

  for (const vp of [PHONE_375, PHONE_402]) {
    test(`⑦ 서랍 4번째 항목이 조작 가능하다 @ ${vp.width}×${vp.height}`, async ({ page }) => {
      await boot(page, vp, { settings: settingsWithSweep(0), preserveAnimations: true });
      const m = await drawerMetrics(page);
      console.log(`drawer@${vp.width}: panelH=${m.panelHeight.toFixed(1)} rowBottom=${m.rowBottom.toFixed(1)} vh=${m.viewportH} overflow=${m.overflow.toFixed(1)} collapsedH=${m.collapsedH.toFixed(1)}`);
      expect(m.minusSize, '장갑 낀 손을 위한 48px 터치 타깃(레포 관례)').toBeGreaterThanOrEqual(44);

      // − 를 눌러 0초(끔)에서 더 내려가지 않고, + 로 켜진다 — 값 배선 확인.
      await expect(page.locator('[data-testid="stepper-chip-sweep-minus"]'), '0초에서는 더 못 줄인다').toBeDisabled();
      await page.locator('[data-testid="stepper-chip-sweep-plus"]').click();
      await expect(page.locator('[data-testid="voice-chip-grid"]'), '+ 한 번에 1초로 켜진다').toHaveAttribute('data-chip-sweep', '1');
    });
  }

  // 🔴 **알려진 미해결 — 민구 판단 대기(BLOCKING).** 서랍 항목이 3개 → 4개가 되면서 최소 지원
  //    규격(375×667)에서 칩 왕복 행이 화면 아래로 **약 23px 넘친다**(실측 rowBottom 689.8 vs 667).
  //    내부 스크롤이냐 재배치냐는 민구가 볼 화면의 문제라 워커가 임의로 정하지 않는다(_ASK-wp-d.md Q4).
  //    ⚠️ `test.fail()`이라 **해소되면 이 테스트가 빨개진다** — 그때 이 블록과 Q4를 함께 지워라.
  //    조용히 통과시키지 않기 위한 표시다(게이트를 오염시키지 않으면서 사실을 남긴다).
  test('⑦-c [미해결] 375×667에서 서랍 전체가 화면 안에 들어온다 — 현재 ~23px 초과', async ({ page }) => {
    // 🔴 `test.fail()`은 **반드시 본문 안**에서 부른다 — describe 스코프에서 인자 없이 부르면
    //    같은 블록의 뒤따르는 테스트까지 전부 "실패 예상"으로 뒤집힌다(⑦-b가 조용히 무력화된다).
    test.fail();
    await boot(page, PHONE_375, { settings: settingsWithSweep(0), preserveAnimations: true });
    const m = await drawerMetrics(page);
    console.log(`drawer-overflow@375: rowBottom=${m.rowBottom.toFixed(1)} vh=${m.viewportH} overflow=${m.overflow.toFixed(1)}`);
    expect(m.rowBottom, '칩 왕복 행이 화면 밖으로 나가지 않는다').toBeLessThanOrEqual(m.viewportH);
  });

  test('⑦-b 접힌 서랍의 높이·요약 문자열은 **불변**이다(heroLayout 49px 계약 — WP-G 소유)', async ({ page }) => {
    // 🔴 민구 A1 주의①: 새 항목은 **펼친 높이만** 늘려야 한다. 접힌 토글은 heroLayout.ts:124가
    //    고정 49px로 계산에 쓰고 그 계약은 WP-G 소유다. 요약 필에 칩 왕복을 넣지 않은 이유이기도 하다.
    await boot(page, PHONE_375, { settings: settingsWithSweep(8), preserveAnimations: true });
    const toggle = page.locator('[data-testid="input-control-toggle"]');
    const box = await toggle.boundingBox();
    const label = await toggle.innerText();
    console.log(`collapsed@375: h=${box?.height.toFixed(1)} label="${label.replace(/\n/g, ' ')}"`);
    expect(box?.height, '접힌 토글 높이가 49px 계약 범위를 벗어나지 않는다').toBeLessThanOrEqual(50);
    expect(label, '요약 필에는 종전 두 값만 남는다(칩 왕복은 넣지 않았다)').not.toContain('왕복');
  });
});
