/**
 * v0.20.0 입력탭#1·#2 — 두 다이얼(인식 허용범위 · 안내 속도) 수평 컨트롤바 레이아웃 검증 (Vance).
 *
 * 검증:
 *   1) ActiveState 컨트롤바에 두 다이얼이 **한 줄**에 수평 배치된다(같은 Y, 좌우로 나뉨).
 *   2) 좁은 기기(375×812)에서도 두 다이얼이 한 줄을 유지하고 viewport 밖으로 새지 않는다(장갑 조작).
 *   3) 다이얼 thumb 터치 타깃이 충분히 크다(range 높이 ≥ 28, 트랙 가독 폭).
 *   4) 칩 구역 캡(maxHeight≈168) 회귀 없음 — 두 다이얼 추가가 v0.19.0 4구역 인변량을 깨지 않는다.
 *
 * 음성/STT는 자동화 불가 → SpeechRecognition 스텁 + fake-media로 ActiveState 진입만 시키고
 * 레이아웃(픽셀 위치)만 검증한다(v019-active-layout 패턴 재사용).
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://localhost:5175';
const PHONE_414 = { width: 414, height: 896 };
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

async function assertTwoDialsOneRow(page: Page, vpWidth: number) {
  const tol = page.locator('[data-testid="dial-tolerance"]');
  const rate = page.locator('[data-testid="dial-tts-rate"]');
  await expect(tol).toBeVisible({ timeout: 5000 });
  await expect(rate).toBeVisible();

  const tBox = await tol.boundingBox();
  const rBox = await rate.boundingBox();
  expect(tBox).not.toBeNull();
  expect(rBox).not.toBeNull();

  // 수평 배치: 허용범위가 왼쪽, 속도가 오른쪽(겹치지 않음).
  expect(tBox!.x + tBox!.width).toBeLessThanOrEqual(rBox!.x + 1);
  // 같은 줄: 두 다이얼의 top이 사실상 동일(±4px).
  expect(Math.abs(tBox!.y - rBox!.y)).toBeLessThanOrEqual(4);
  // viewport 밖으로 새지 않음(우측 다이얼 오른쪽 끝이 화면 안).
  expect(rBox!.x + rBox!.width).toBeLessThanOrEqual(vpWidth + 1);

  // range thumb 터치 타깃: range input 높이 ≥ 28(장갑 조작).
  const rangeH = await page.locator('[data-testid="dial-tolerance"] input[type="range"]').evaluate(
    (el) => (el as HTMLElement).getBoundingClientRect().height,
  );
  expect(rangeH).toBeGreaterThanOrEqual(28);
}

test('입력탭#1·#2 — 두 다이얼 수평 한 줄(414×896)', async ({ page }) => {
  await setup(page, PHONE_414);
  await generateTable(page);
  await startVoice(page);

  await expect(page.locator('button[title="입력 종료"]')).toBeVisible({ timeout: 5000 });
  await assertTwoDialsOneRow(page, PHONE_414.width);

  // 칩 구역 캡 회귀 없음(v0.19.0 4구역 인변량).
  const chipClientH = await page.evaluate(() => {
    const grids = Array.from(document.querySelectorAll('div')).filter((el) => {
      const s = getComputedStyle(el);
      return s.display === 'grid' && s.overflowY === 'auto';
    });
    const g = grids[0] as HTMLElement | undefined;
    return g ? g.clientHeight : null;
  });
  expect(chipClientH).not.toBeNull();
  expect(chipClientH!).toBeLessThanOrEqual(170);

  await page.screenshot({ path: '/tmp/v020-shots/dials-414.png' });
});

test('입력탭#1·#2 — 좁은 기기에서도 한 줄 유지(375×812)', async ({ page }) => {
  await setup(page, PHONE_375);
  await generateTable(page);
  await startVoice(page);

  await expect(page.locator('button[title="입력 종료"]')).toBeVisible({ timeout: 5000 });
  await assertTwoDialsOneRow(page, PHONE_375.width);

  await page.screenshot({ path: '/tmp/v020-shots/dials-375.png' });
});
