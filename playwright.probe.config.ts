/** 🔬 **프로브 전용 config — 임시.** 릴리스 게이트가 아니다.
 *
 *  `playwright.config.ts`가 `_` 접두 스펙을 `testIgnore`로 막는데(2026-08-03 민구 확정),
 *  그 파일이 안내하는 우회법 `--project=""`는 **현 Playwright에서 죽었다**
 *  (`Error: Project(s) "" not found`). 문서에 박은 명령이 구조 변경으로 죽은 `[ORCH-38]` 계열.
 *
 *  이 config는 같은 webServer·globalSetup을 쓰되 `testIgnore`만 뺀다.
 *  🔴 **`predeploy`/`test:e2e` 경로는 이 파일을 쓰지 않는다** — 게이트 오염 없음.
 */
import { defineConfig, devices } from '@playwright/test';

import { BASE } from './tests/baseUrl';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  reporter: 'list',
  globalSetup: './tests/globalSetup.ts',
  use: { baseURL: BASE, headless: true, screenshot: 'only-on-failure', video: 'off' },
  projects: [{ name: 'probe', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${new URL(BASE).port} --strictPort`,
    url: BASE,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
