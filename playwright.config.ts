import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5175',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // safe-area.spec은 iphone17 프로젝트 전용(아래) — 여기서 중복 실행하지 않는다.
      testIgnore: /safe-area\.spec\.ts/,
    },
    {
      // v0.33.0 — 검증 기준 기기: 아이폰 17 일반(노치, 402×874 @3x). webkit 미설치 환경이라
      // chromium 엔진 위에 뷰포트/DPR/터치만 에뮬레이션한다. 브라우저는 노치 inset을 시뮬레이션하지
      // 않으므로 실제 safe-area는 tests/fixtures/safeArea.ts가 --sat/--sab CSS 변수(global.css SSOT)를
      // override해 재현한다.
      name: 'iphone17',
      use: {
        viewport: { width: 402, height: 874 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
      testMatch: /safe-area\.spec\.ts/,
    },
  ],
  // No webServer — dev server started separately
});
