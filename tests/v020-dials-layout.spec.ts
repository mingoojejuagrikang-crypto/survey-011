/**
 * 입력탭 — 접힌 입력 조절 패널 + 큰 스탭퍼 레이아웃 검증 (Vance).
 *
 * 검증:
 *   1) 기본 하단에는 접힌 `입력 조절 · 인식 N% · 안내 Nx` 버튼만 보인다.
 *   2) 펼치면 인식/안내 스탭퍼가 두 칸으로 보이고, 각 +/- 버튼은 48px 터치 타깃이다.
 *   3) 네이티브 range 슬라이더는 렌더되지 않는다.
 *   4) 칩 구역 3줄 캡 회귀 없음.
 *
 * 음성/STT는 자동화 불가 → SpeechRecognition 스텁 + fake-media로 ActiveState 진입만 시키고
 * 레이아웃(픽셀 위치)만 검증한다(v019-active-layout 패턴 재사용).
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5175';
const PHONE_402 = { width: 402, height: 874 };
const PHONE_375 = { width: 375, height: 812 };

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

async function setup(page: Page, viewport: { width: number; height: number }) {
  await page.addInitScript(SR_STUB);
  await page.setViewportSize(viewport);
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
}

async function generateTable(page: Page) {
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
  const genBtn = page.locator('text=입력 테이블 생성').first();
  if (await genBtn.isVisible().catch(() => false)) {
    await genBtn.click();
    await page.waitForTimeout(400);
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
  await page.locator('text=음성 입력 시작').first().click();
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

async function assertStepperPanel(page: Page, vpWidth: number) {
  const toggle = page.locator('[data-testid="input-control-toggle"]');
  await expect(toggle).toBeVisible({ timeout: 5000 });
  // v0.37.0 FB-K(민구) — 요약 라벨에서 포괄어 '입력 조절' 제거. 두 다이얼은 '허용 인식률'·'안내속도'.
  await expect(toggle).toContainText('허용 인식률');
  await expect(toggle).toContainText('안내속도');
  await expect(page.locator('input[type="range"]')).toHaveCount(0);

  await toggle.click();

  const tol = page.locator('[data-testid="stepper-tolerance"]');
  const rate = page.locator('[data-testid="stepper-tts-rate"]');
  await expect(tol).toBeVisible();
  await expect(rate).toBeVisible();

  const tBox = await tol.boundingBox();
  const rBox = await rate.boundingBox();
  expect(tBox).not.toBeNull();
  expect(rBox).not.toBeNull();

  // 수평 배치: 인식 스탭퍼가 왼쪽, 안내 스탭퍼가 오른쪽(겹치지 않음).
  expect(tBox!.x + tBox!.width).toBeLessThanOrEqual(rBox!.x + 1);
  // 같은 줄: 두 스탭퍼의 top이 사실상 동일(±4px).
  expect(Math.abs(tBox!.y - rBox!.y)).toBeLessThanOrEqual(4);
  // viewport 밖으로 새지 않음(우측 스탭퍼 오른쪽 끝이 화면 안).
  expect(rBox!.x + rBox!.width).toBeLessThanOrEqual(vpWidth + 1);

  // +/- 터치 타깃: 48px 이상.
  const minusH = await page.locator('[data-testid="stepper-tolerance-minus"]').evaluate(
    (el) => (el as HTMLElement).getBoundingClientRect().height,
  );
  expect(minusH).toBeGreaterThanOrEqual(48);
}

test('입력탭 — 입력 조절 스탭퍼 패널(402×874)', async ({ page }) => {
  await setup(page, PHONE_402);
  await generateTable(page);
  await startVoice(page);

  await expect(page.locator('[data-testid="voice-active-state"]')).toBeVisible({ timeout: 5000 });
  await assertStepperPanel(page, PHONE_402.width);

  // 칩 구역 캡 회귀 없음(v0.19.0 4구역 인변량).
  //   v0.36.0 코덱스 시안(민구 확정) — 칩 구역이 grid → 유동 폭 pill 플로우(flex-wrap)로 바뀌어
  //   계산-스타일(display:grid) 탐색 대신 셀렉터 계약(voice-chip-grid)으로 잡는다. 캡 검증은 동일.
  const chipClientH = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="voice-chip-grid"]') as HTMLElement | null;
    return g ? g.clientHeight : null;
  });
  expect(chipClientH).not.toBeNull();
  expect(chipClientH!).toBeLessThanOrEqual(170);

  await page.screenshot({ path: '/tmp/v020-shots/steppers-402.png' });
});

test('입력탭 — 좁은 기기에서도 스탭퍼 한 줄 유지(375×812)', async ({ page }) => {
  await setup(page, PHONE_375);
  await generateTable(page);
  await startVoice(page);

  await expect(page.locator('[data-testid="voice-active-state"]')).toBeVisible({ timeout: 5000 });
  await assertStepperPanel(page, PHONE_375.width);

  await page.screenshot({ path: '/tmp/v020-shots/steppers-375.png' });
});
