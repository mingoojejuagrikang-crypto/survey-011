/**
 * v0.19.0 W5 — 입력탭 ActiveState 레이아웃 재설계 검증 (Vance).
 *
 * 목표 2건:
 *   버그A — 칩이 많아도(3줄↑) 칩 구역은 내부 스크롤(maxHeight 168)로 고정,
 *           아래 hero/컨트롤바를 밀지 않는다.
 *   버그B — hero가 숨겨지는 시점(여기선 일시정지: hero 숨김 + PausedCard fixed 오버레이)에
 *           하단 컨트롤바의 Y가 불변(grid row4 고정). anomalyAlert도 같은 메커니즘(hero 숨김 +
 *           fixed 오버레이)이라 동일 결론.
 *
 * 음성/STT는 자동화 불가 → webkitSpeechRecognition 스텁 + 가짜 mic(launch fake-media)로
 * ActiveState 진입만 시키고, 레이아웃(픽셀 위치)만 검증한다.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5175';
const PHONE = { width: 402, height: 874 };

// isSpeechSupported() 통과용 최소 스텁. start() 후 onstart만 부르고 결과는 안 보냄
// (레이아웃 검증이라 인식 결과 불필요 — ActiveState 진입이 목적).
const SR_STUB = `
  class StubRecognition {
    constructor() { this.lang=''; this.continuous=false; this.interimResults=false; }
    start() { if (this.onstart) try { this.onstart(); } catch(e){} }
    stop() { if (this.onend) try { this.onend(); } catch(e){} }
    abort() {}
    addEventListener() {} removeEventListener() {}
  }
  window.SpeechRecognition = StubRecognition;
  window.webkitSpeechRecognition = StubRecognition;
`;

async function setup(page: Page) {
  await page.addInitScript(SR_STUB);
  await page.setViewportSize(PHONE);
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
}

/** 설정탭에서 테이블 생성(게이트 통과). MOCK 컬럼이 이미 시드되어 있다. */
async function generateTable(page: Page) {
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
  const genBtn = page.locator('text=입력 테이블 생성').first();
  if (await genBtn.isVisible().catch(() => false)) {
    await genBtn.click();
    await page.waitForTimeout(400);
    // W3 게이트: "생성" 확인 버튼(아이콘+공백 포함 → 부분일치).
    const confirmBtn = page.locator('button', { hasText: '생성' }).last();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(400);
    }
  }
}

async function startVoice(page: Page) {
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
  const startBtn = page.locator('text=음성 입력 시작').first();
  await startBtn.click();
  // ActiveState 진입(REC 점등) 대기
  await page.waitForTimeout(800);
}

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

test('W5 — ActiveState 진입 + 컨트롤바 한자리 고정(버그B)', async ({ page }) => {
  await setup(page);
  await generateTable(page);
  await startVoice(page);

  // ActiveState에 들어왔는지 확인 — v0.31.0부터 활성 하단에 종료 버튼이 없다([TEST-UI-2]).
  // 기준점은 활성/일시정지 양쪽에 항상 렌더되는 input-control-toggle로 잡는다.
  const controlAnchor = page.locator('[data-testid="input-control-toggle"]');
  await expect(controlAnchor).toBeVisible({ timeout: 5000 });

  await page.screenshot({ path: '/tmp/v019-shots/after-active-hero.png' });

  // 버그A — 칩 구역은 높이 캡 + 내부 스크롤: 칩이 늘어도 구역이 아래(hero/컨트롤바)를 밀지 않는다.
  //   v0.36.0 코덱스 시안(민구 확정) — 칩 구역이 고정 그리드에서 **유동 폭 pill 플로우**(flex-wrap)
  //   로 바뀌어 종전의 `display:grid` 계산-스타일 탐색이 못 찾는다. 탐색을 셀렉터 계약
  //   (data-testid="voice-chip-grid" — §11 보존표의 그 노드)으로 교체. 캡 메커니즘 검증은 동일:
  //   clientHeight ≤ 3줄 캡(≤170) **및** 화면 높이 30% 상한(민구 칩 스펙).
  const chipMetrics = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement | null;
    if (!g) return null;
    return {
      clientHeight: g.clientHeight,
      scrollHeight: g.scrollHeight,
      overflowY: getComputedStyle(g).overflowY,
    };
  });
  expect(chipMetrics).not.toBeNull();
  console.log(`chip region: client=${chipMetrics!.clientHeight} scroll=${chipMetrics!.scrollHeight}`);
  expect(chipMetrics!.overflowY).toBe('auto'); // 초과분은 구역 안 스크롤
  expect(chipMetrics!.clientHeight).toBeLessThanOrEqual(170); // 3줄 캡
  expect(chipMetrics!.clientHeight).toBeLessThanOrEqual(874 * 0.3); // 화면 높이 30% 상한

  // 컨트롤바 기준점 = input-control-toggle의 화면상 Y(top) — 양 상태에 공통 존재.
  const beforeBox = await controlAnchor.boundingBox();
  expect(beforeBox).not.toBeNull();
  const yHeroShown = beforeBox!.y;

  // 일시정지 토글(마이크 버튼) → hero 숨김 + PausedCard(fixed) 표시. 같은 메커니즘으로 버그B 재현 지점.
  // pulse-mic 무한 애니메이션으로 'stable'을 못 잡으므로 force 클릭.
  await page.locator('button[title="일시정지"]').click({ force: true });
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="paused-card"]')).toBeVisible();

  await page.screenshot({ path: '/tmp/v019-shots/after-active-paused.png' });

  const afterBox = await controlAnchor.boundingBox();
  expect(afterBox).not.toBeNull();
  const yHeroHidden = afterBox!.y;

  // 핵심 assert: hero 숨김 전/후 컨트롤바 Y 동일(±1px 허용). grid row4 고정 증명.
  console.log(`controlbar Y: heroShown=${yHeroShown} heroHidden=${yHeroHidden}`);
  expect(Math.abs(yHeroShown - yHeroHidden)).toBeLessThanOrEqual(1);
});

// ─── v0.36.0 리뷰 라운드1(Flash 테스트 노트, 수용) ────────────────────────────
// 종전 30% 상한 단언은 402×874 고정이라 캡(≤170px)이 항상 30%(262px) 아래에 있는 토톨로지였다.
// 375×667(최소 지원)에서는 30dvh(200px) − 스트립 몫이 3줄 캡보다 작아 **화면 비례 캡이 실제로
// 물리고**, 칩을 많이 시드해 **내부 스크롤이 실제로 트리거**되는 것까지 단언한다.
const SMALL_VP_SETTINGS = {
  state: {
    googleConnected: false,
    userEmail: '',
    sheetUrl: '',
    sheetTab: '',
    columns: [
      { id: 'a1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
      ...Array.from({ length: 11 }, (_, i) => ({
        id: `m${i + 1}`,
        name: `측정항목${String(i + 1).padStart(2, '0')}`,
        type: 'float',
        input: i < 9 ? 'voice' : 'auto',
        ttsAnnounce: true,
        auto: { kind: 'fixed', value: i < 9 ? '' : '123.4' },
        decimals: 1,
        sampleKey: false,
      })),
    ],
    tableGenerated: true,
    totalRows: 3,
    ttsRate: 1.05,
    recognitionTolerance: 0.6,
    sessionLabelColId: null,
    sessionAutoLabel: 'v019-small-vp',
    preferredVoiceName: '',
    roundDateColId: null,
  },
  version: 11,
};

test('R1 — 375×667: 칩 캡이 화면 30% 안에서 축소되고 초과 칩은 내부 스크롤로 트리거된다', async ({ page }) => {
  await page.addInitScript(SR_STUB);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.evaluate((settings) => {
    localStorage.clear();
    localStorage.setItem('survey-011-settings-v3', JSON.stringify(settings));
  }, SMALL_VP_SETTINGS);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="voice-active-state"]')).toBeVisible({ timeout: 5000 });

  const m = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement | null;
    if (!g) return null;
    return {
      clientHeight: g.clientHeight,
      scrollHeight: g.scrollHeight,
      overflowY: getComputedStyle(g).overflowY,
      chips: g.querySelectorAll('[data-testid="column-chip"]').length,
      fit: Number(g.style.getPropertyValue('--chip-fit')),
    };
  });
  expect(m).not.toBeNull();
  console.log(`375x667 chip region: chips=${m!.chips} client=${m!.clientHeight} scroll=${m!.scrollHeight}`);
  expect(m!.chips).toBeGreaterThanOrEqual(12); // 시드가 실제로 많은 칩을 만들었다(공허 방지)
  expect(m!.clientHeight).toBeLessThanOrEqual(667 * 0.3); // 화면 높이 30% 상한이 실제로 문다
  expect(m!.overflowY).toBe('auto');
  expect(m!.scrollHeight, '캡 초과분은 내부 스크롤로 남는다').toBeGreaterThan(m!.clientHeight);
  expect(m!.fit, '12개 칩이면 기본 배율(1)보다 실제로 축소된다').toBeLessThan(1);

  // r2(Pro Critical) 재현/회귀: 컨테이너 높이도 감시하면 fit()의 reflow가 ResizeObserver를 다시
  // 깨워 무한 순환할 수 있다는 지적. 초기 수렴 뒤 style 변이를 500ms 관측해 정지 상태를 고정한다.
  const stableMutations = await page.evaluate(async () => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement;
    let count = 0;
    const mo = new MutationObserver((records) => {
      count += records.filter((r) => r.type === 'attributes' && r.attributeName === 'style').length;
    });
    mo.observe(g, { attributes: true, attributeFilter: ['style'] });
    await new Promise((resolve) => setTimeout(resolve, 500));
    mo.disconnect();
    return count;
  });
  expect(stableMutations, '초기 수렴 뒤 ResizeObserver/style 피드백 루프가 없어야 한다').toBe(0);

  // 실제 폭 변경에서는 재계산되고 다시 같은 축소 계약으로 수렴한다.
  await page.setViewportSize({ width: 430, height: 667 });
  await page.waitForTimeout(150);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(150);
  const resizedFit = await page.locator('[data-testid="voice-chip-grid"]').evaluate(
    (g) => Number((g as HTMLElement).style.getPropertyValue('--chip-fit')),
  );
  expect(resizedFit, '폭 복귀 뒤 칩 배율을 다시 계산한다').toBeLessThan(1);

  // 가로 넘침 0(민구 스펙 — 유동 폭 pill이 화면 밖으로 새지 않는다).
  const overflowX = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflowX).toBe(0);
});
