/**
 * 브라우저 테스트 진입점 SSOT.
 *
 * **왜 이 파일이 생겼나 ([ORCH-27], 2026-07-24):**
 * 이전에는 56개 스펙이 각자 `const BASE = 'http://localhost:5175'`를 하드코딩했고,
 * `playwright.config.ts`의 `baseURL`을 읽는 스펙은 **하나도 없었다**. 그래서 config가 어디를
 * 가리키든 아무 영향이 없었고, 사람이 띄운 5175 dev 서버를 **중첩 클론**(순정 v0.38.0)이 잡고 있던
 * 동안 브라우저 테스트가 **미커밋 워킹트리가 아니라 커밋된 옛 코드를 검증**했다 — 아무 에러도 없이.
 *
 * 이제 진입점은 여기 한 곳이고, `playwright.config.ts`의 `webServer`가 이 포트를 **직접 소유**한다
 * (`reuseExistingServer: false` + `--strictPort`). 남이 띄운 서버를 물려받는 경로가 구조적으로 없다.
 *
 * ⚠️ **5175는 사람이 관리하는 관전용 dev 서버다. 테스트는 절대 그 포트를 쓰지 않는다.**
 * 포트를 바꾸려면 여기와 `playwright.config.ts`의 `webServer.command`/`url`/`use.baseURL`을 함께 바꾼다.
 */
export const BASE = process.env.SURVEY_BASE_URL ?? 'http://localhost:5177';
