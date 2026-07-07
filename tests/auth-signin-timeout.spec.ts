/**
 * googleAuth.ts — SIGNIN_TIMEOUT_MS race-condition regression.
 *
 * Real-device root cause (2026-07-07 v0.28.0 A5, Sonar): SIGNIN_TIMEOUT_MS was 15s, shorter than
 * an observed real 2FA flow (~60s). signIn()'s own timeout rejected first ("로그인 응답이 지연되어
 * 취소되었습니다"), but the GIS callback later arrived anyway and storeToken() ran — the token WAS
 * genuinely in localStorage. The bug: settlePending()'s "already settled" guard silently dropped
 * notifyTokenSettled() for that late arrival too, so the UI never heard about it. Only a Settings
 * tab remount (which reads getStoredToken() fresh) recovered the correct state.
 *
 * v0.29.0 fix: ① SIGNIN_TIMEOUT_MS raised 15s -> 120s (fewer real 2FA flows time out at all).
 * ② notifyTokenSettled() now fires unconditionally whenever a token is actually stored — decoupled
 * from whether the original signIn() promise is still pending. ③ SettingsScreen subscribes via
 * onTokenSettled and reconciles googleConnected/userEmail reactively, no remount needed.
 *
 * Uses Playwright's virtual clock (page.clock) to advance past the 120s timeout deterministically
 * without a real 2-minute wait, and a GIS mock whose token callback fires LATE (simulating the
 * slow real 2FA) via a clock-controlled setTimeout.
 *
 * dev 서버 수동 기동 필요([ENV-1/2]): npm run dev -- --port 5175 --strictPort
 */
import { test, expect, type Page } from '@playwright/test';

test.setTimeout(60_000);
const BASE = 'http://localhost:5175';

/** GIS mock whose requestAccessToken does NOT call back synchronously — it schedules the token
 *  callback `delayMs` later (virtualized by page.clock), simulating a slow real 2FA completion
 *  that can outlast signIn()'s own SIGNIN_TIMEOUT_MS. */
async function installSlowGisMock(page: Page, delayMs: number) {
  await page.route('**://www.googleapis.com/oauth2/v3/userinfo', async (route) => {
    await route.fulfill({ json: { email: 'slow2fa@example.com' } });
  });
  await page.addInitScript((delay) => {
    // @ts-expect-error 테스트 전용 전역 mock
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config: { callback: (r: unknown) => void }) => ({
            requestAccessToken: () => {
              setTimeout(() => {
                config.callback({
                  access_token: 'late-token-after-timeout', expires_in: 3600, scope: '', token_type: 'Bearer',
                });
              }, delay);
            },
          }),
          revoke: (_t: string, cb?: () => void) => { cb?.(); },
        },
      },
    };
  }, delayMs);
}

async function bootToSettings(page: Page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(200);
}

test('타임아웃(120s) 발화 후 지각 성공 콜백 — 리마운트 없이 자동으로 googleConnected 반영', async ({ page }) => {
  const LATE_MS = 130_000; // SIGNIN_TIMEOUT_MS(120s)보다 늦게 도착하는 실제 2FA 시뮬레이션.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.clock.install();
  await installSlowGisMock(page, LATE_MS);
  await bootToSettings(page);

  const loginBtn = page.locator('button:has-text("Google 로그인")');
  await expect(loginBtn).toBeVisible();
  await loginBtn.click();

  // ① 120s 타임아웃 발화 — signIn() promise가 reject되어 UI에 지연-취소 오류가 표면화된다(버그의
  // 출발점). 이 시점엔 아직 "연결됨"이 아니다.
  await page.clock.runFor(121_000);
  await expect(page.locator('text=로그인 응답이 지연되어')).toBeVisible();
  await expect(page.locator('button:has-text("Google 로그인")')).toBeVisible();

  // ② 130s 지점(GIS mock의 예약된 지각 콜백)까지 시계를 더 돌린다 — storeToken()은 실행되지만,
  // 수정 전 코드라면 UI는 여기서 절대 반영되지 않고 리마운트가 필요했다.
  await page.clock.runFor(10_000);

  // ③ v0.29.0 — 리마운트 없이 onTokenSettled 구독이 반응해 "연결됨"으로 전환된다.
  await expect(page.locator('text=연결됨')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('text=slow2fa@example.com')).toBeVisible();
});

test('정상 범위 내 로그인(타임아웃 전 도착)은 회귀 없이 그대로 성공', async ({ page }) => {
  // 광범위 정상 경로 회귀 가드 — 120s로 늘린 타임아웃이 "일찍 도착하는" 흔한 케이스를 깨지 않는지.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await installSlowGisMock(page, 200); // 실질적으로 즉시(200ms) — 클록 조작 불필요.
  await bootToSettings(page);

  const loginBtn = page.locator('button:has-text("Google 로그인")');
  await loginBtn.click();

  await expect(page.locator('text=연결됨')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('text=slow2fa@example.com')).toBeVisible();
  await expect(page.locator('text=로그인 응답이 지연되어')).toBeHidden();
});
