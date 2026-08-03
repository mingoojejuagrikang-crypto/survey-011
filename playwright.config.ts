import { defineConfig, devices } from '@playwright/test';

import { BASE } from './tests/baseUrl';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  reporter: 'list',
  // [ORCH-27] 서빙 대상 2차 방어 — 포트는 맞는데 **체크아웃이 틀린** 경우를 잡는다(webServer가 못 잡는 축).
  globalSetup: './tests/globalSetup.ts',
  use: {
    baseURL: BASE,
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
  // [ORCH-27] 1차 방어 — **Playwright가 테스트 서버의 수명주기를 직접 소유한다.**
  //
  // 종전에는 webServer가 없어 사람이 5175에 dev 서버를 띄웠고, 그 포트를 중첩 클론(순정 v0.38.0)이
  // 잡고 있어 **브라우저 테스트가 커밋된 옛 코드를 검증**했다 — 에러 하나 없이 조용히.
  //
  // 이제:
  //  - `cwd` 미지정 = Playwright 기본값 "이 config가 있는 디렉터리" → 항상 이 레포에서 뜬다.
  //    ⚠️ `cwd: __dirname`을 쓰지 마라 — package.json이 `"type": "module"`이라 이 파일은 ESM이고
  //    `__dirname`은 정의되지 않아 **config 로드 자체가 터진다**. 굳이 쓰려면 `import.meta.dirname`.
  //  - `reuseExistingServer: false` + `--strictPort` = 남이 띄운 서버를 물려받는 경로가 없다.
  //    누가 5177을 잡고 있으면 vite가 죽고 Playwright가 **시끄럽게** 실패한다(조용한 통과 불가).
  //  - 5175는 사람이 보는 관전용 dev 서버로 분리됐다. 테스트는 그 포트를 쓰지 않는다.
  //
  // 🔴 포트는 `BASE`에서 **파생**한다 — 하드코딩하지 마라 (2026-08-03).
  //   `tests/baseUrl.ts`가 `SURVEY_BASE_URL`을 읽어 포트를 갈 수 있게 해뒀는데, 여기 `command`가
  //   `5177`을 박아둬서 **반쪽이었다**: `BASE`만 바꾸면 서버는 여전히 5177에 뜨려다 죽는다.
  //   이 때문에 **여러 워크트리에서 동시에 테스트를 못 돌렸다**(6레인 병렬 중 실측).
  //   이제 `SURVEY_BASE_URL=http://localhost:5178 npx playwright test …` 한 줄로 갈린다.
  //   ⚠️ `--strictPort`와 `reuseExistingServer: false`는 **그대로 유지한다** — 위 [ORCH-27]의
  //   방어가 목적이지 포트 고정이 목적이 아니었다. 남의 서버를 물려받는 경로는 여전히 없다.
  webServer: {
    command: `npx vite --port ${new URL(BASE).port} --strictPort`,
    url: BASE,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
