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
const PHONE = { width: 414, height: 896 };

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

  // ActiveState에 들어왔는지(종료 버튼 존재) 확인.
  const endBtn = page.locator('button[title="입력 종료"]');
  await expect(endBtn).toBeVisible({ timeout: 5000 });

  await page.screenshot({ path: '/tmp/v019-shots/after-active-hero.png' });

  // 버그A — 칩 구역은 maxHeight 캡(168) + 내부 스크롤. 컬럼이 많으면 scrollHeight>clientHeight,
  //   clientHeight는 캡(≤170) 이내. 즉 칩이 늘어도 구역 높이는 고정.
  const chipMetrics = await page.evaluate(() => {
    // 칩 그리드 = 활성 칩(border-color green)을 품은 overflow:auto 그리드 컨테이너.
    const grids = Array.from(document.querySelectorAll('div')).filter((el) => {
      const s = getComputedStyle(el);
      return s.display === 'grid' && s.overflowY === 'auto';
    });
    const g = grids[0] as HTMLElement | undefined;
    if (!g) return null;
    return { clientHeight: g.clientHeight, scrollHeight: g.scrollHeight };
  });
  expect(chipMetrics).not.toBeNull();
  console.log(`chip region: client=${chipMetrics!.clientHeight} scroll=${chipMetrics!.scrollHeight}`);
  expect(chipMetrics!.clientHeight).toBeLessThanOrEqual(170);

  // 컨트롤바 기준점 = 종료 버튼의 화면상 Y(top).
  const beforeBox = await endBtn.boundingBox();
  expect(beforeBox).not.toBeNull();
  const yHeroShown = beforeBox!.y;

  // 일시정지 토글(마이크 버튼) → hero 숨김 + PausedCard(fixed) 표시. 같은 메커니즘으로 버그B 재현 지점.
  // pulse-mic 무한 애니메이션으로 'stable'을 못 잡으므로 force 클릭.
  await page.locator('button[title="일시정지"]').click({ force: true });
  await page.waitForTimeout(500);
  await expect(page.locator('[data-testid="paused-card"]')).toBeVisible();

  await page.screenshot({ path: '/tmp/v019-shots/after-active-paused.png' });

  const afterBox = await endBtn.boundingBox();
  expect(afterBox).not.toBeNull();
  const yHeroHidden = afterBox!.y;

  // 핵심 assert: hero 숨김 전/후 컨트롤바 Y 동일(±1px 허용). grid row4 고정 증명.
  console.log(`controlbar Y: heroShown=${yHeroShown} heroHidden=${yHeroHidden}`);
  expect(Math.abs(yHeroShown - yHeroHidden)).toBeLessThanOrEqual(1);
});
