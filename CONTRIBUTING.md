# CONTRIBUTING — 개발 · 테스트 · 릴리스

이 문서는 **개발 절차의 SSOT**다. 실행 방법은 항상 `package.json`의 npm scripts로 적는다
(내부 파일을 직접 실행하는 명령을 문서에 박아두면, 실행 방식이 바뀔 때 문서가 여러 곳에서 낡는다).

작업을 시작하기 전에 [AGENTS.md](./AGENTS.md) → [PRINCIPLES.md](./PRINCIPLES.md) 순으로 읽어라.

## 환경 준비

```bash
npm install
cp .env.example .env.local        # VITE_GOOGLE_CLIENT_ID 설정
```

`.env.local` 없이 돌리면 **로그인에 의존하는 테스트가 코드와 무관하게 전멸**한다.
워크트리에서 작업할 때도 메인 체크아웃에서 `.env.local`을 복사해 오는 것이 첫 단계다.

## 명령어 (SSOT = package.json)

| 명령 | 하는 일 |
|------|---------|
| `npm run dev` | 개발 서버 (http://localhost:5173) |
| `npm run build` | `tsc -b` + 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run lint` | ESLint (`max-lines` 크기 게이트 — GL-006 §5) |
| `npm run test:e2e` | Playwright 전체 스위트 |
| `npm run check:docs` | 문서 정합성 (깨진 링크·중복/매달린 이슈 ID) |
| `npm run check:release` | 릴리스 일관성 + 문서 정합성 + lint |
| `npm run predeploy` | 릴리스 일관성 + 문서 정합성 + lint + e2e (배포 직전 자동 실행) |
| `npm run deploy` | 빌드 후 GitHub Pages 배포 — **사용자 승인 필요** |

## 테스트

러너는 **Playwright 단일**이다. 순수 함수 단위 테스트도 같은 러너를 쓴다 (PRINCIPLES §7 — 새 러너 도입 금지).

```bash
npm run test:e2e                                      # 전체
npm run test:e2e -- tests/koreanNum.spec.ts           # 한 파일만
npm run test:e2e -- --workers=1                       # 격리 실행 (신규·고위험 테스트 필수)
```

🔴 **`npx playwright test`를 직접 쓰지 마라**(가드레일 `[ENV-4]`). `npx`는 패키지가 로컬에
없거나 버전이 다르면 **레지스트리 조회 후 `Ok to proceed? (y)` 프롬프트**를 띄우고,
비대화형(CI·배포 스크립트·에이전트 세션)에서는 그 프롬프트가 응답을 못 받아 **무한 대기**한다 —
실제로 배포를 멈춘 이력이 있다. 문서의 테스트 명령은 **항상 package scripts를 가리킨다.**

- 서버는 **Playwright가 직접 소유**한다(`playwright.config.ts`의 `webServer` — 포트 5177,
  `--strictPort`, `reuseExistingServer: false`). 사람이 따로 dev 서버를 띄울 필요가 없고,
  띄워도 테스트는 그 포트를 쓰지 않는다. `npm run dev`(5173)는 관전용이다.
- **테스트 실패를 "회귀"로 단정하기 전에 기준 브랜치와 대조**하라. 같은 테스트가 `main`에서
  green이면 코드가 아니라 환경 문제다.
- **회귀 테스트는 반증까지 해야 회귀 테스트다.** 수정을 빼고 돌려 실패하는 것까지 확인한다.
  통과만으로는 검증이 아니다.
- `--workers=1` 격리는 양방향으로 쓴다. "격리 통과 = flake"라고 단정하지 마라 — 부하 지연이
  결함을 가려 **병렬은 통과하고 격리에서 실패**하는 사례가 실재했다.

테스트 작성에서 반복적으로 시간을 태운 함정들은 [ENGINEERING-GUARDRAILS.md](./ENGINEERING-GUARDRAILS.md)에 있다.

### 남아 있는 수동 스크립트

`scripts/test-sheets-url.mjs` 하나만 남아 있다. Playwright 스펙으로 대체되지 않은 유일한
검사라 존치하며, 손볼 일이 생기면 `tests/`로 포팅한 뒤 삭제한다.

(`test-koreanNum.mjs` · `test-autoValue.mjs`는 `tests/koreanNum.spec.ts` ·
`tests/autoValue.spec.ts`가 완전히 대체해 v0.39.0 문서 정리에서 삭제했다. 두 스크립트는 이미
제거된 옛 명령 별칭(`정정`·`스톱` 등)을 계속 검사하고 있어 현재 정책과도 충돌했다.)

## 파인더에서 문서 알아보기 (macOS)

레포 루트에 마크다운이 9개다. 이름이 비슷한데 역할이 완전히 다른 것들이 있어
(`KNOWN-ISSUES` / `ENGINEERING-GUARDRAILS` / `KNOWN-ISSUES-ARCHIVE`), 파인더에서 헷갈리기 쉽다.

```bash
bash scripts/set-finder-comments.sh
```

각 문서·폴더에 한 줄 설명을 붙인다. 파인더에서 파일 선택 → **Cmd+I** → "설명" 칸에서 보이고,
Spotlight 검색에도 잡힌다. 여러 번 돌려도 안전하다.

> ⚠️ 이 설명은 파일의 확장 속성(xattr)이라 **git이 추적하지 않는다.** 다른 컴퓨터에서 클론하면
> 스크립트를 다시 돌려야 한다. 문서를 추가하면 스크립트의 목록에도 한 줄 넣어라.

## 실기기 검증

iOS·STT·마이크·오디오 경로가 걸린 변경은 **실기기 확인 없이 "해결"로 선언하지 않는다.**
데스크톱 Playwright는 근사치일 뿐이다. 절차는 [docs/REAL-DEVICE-TEST.md](./docs/REAL-DEVICE-TEST.md).

## Google Cloud Console 설정

1. `ai-agent-team-493400` 프로젝트 선택 → `API 및 서비스` → `사용자 인증 정보`
2. `OAuth 2.0 클라이언트 ID 만들기` → 애플리케이션 유형: **웹 애플리케이션**
3. 승인된 JavaScript 원본:
   - `http://localhost:5173`
   - `https://mingoojejuagrikang-crypto.github.io`
4. `Google Sheets API` 활성화 (`API 라이브러리` → 검색)
5. 발급된 Client ID를 `.env.local`의 `VITE_GOOGLE_CLIENT_ID`에 저장

> ⚠️ 새 GitHub Pages origin을 쓰면 위 승인 목록에 포함되어야 OAuth가 동작한다.
> repo 경로(`.../survey-011/`)는 도메인 단위(`...github.io`)로 이미 커버된다.

> ⚠️ **API 키 제한 주의** — 과거값 무인증 read에 Picker용 API 키를 재사용한다.
> 키 제한이 Drive 전용이면 미로그인 폴백 경보가 403으로 죽는다. API 제한에 Sheets read를
> 포함하고 HTTP 리퍼러를 배포 도메인으로 둘 것. 근거는 KNOWN-ISSUES `[AUTH-10]`.

## 커밋 · 변경 위생

- **동작 불변 리팩토링과 동작 변경을 한 커밋에 섞지 않는다.**
- persist 스키마 변경은 **마이그레이션과 함께** 넣는다(다운그레이드 라운드트립까지 고려).
- 세션 시작 시 발견된 미커밋 변경은 **검사만** 한다. `reset`/`checkout`/`stash`/`clean` 금지.
- 같은 브랜치에 다른 세션이 붙어 있는지 확인한다(`git log -1 --format=%cd`가 방금이면 의심).
- 민감정보(`secret/`, `.env.local`)는 커밋하지 않는다.

## 릴리스

**버전 bump와 배포는 사용자 승인이 필요하다.** 브랜치 작업 중 자동 배포 금지.

1. `package.json` 버전 bump
2. [CHANGELOG.md](./CHANGELOG.md) 맨 위에 `- **vX.Y.Z** (YYYY-MM-DD) — …` 항목 추가
   (사용자가 읽는 문서다 — 내부 용어 말고 **무엇이 달라지는지** 쉬운 말로)
3. [README.md](./README.md)의 `현재 버전: vX.Y.Z` 배지 갱신
4. `npm run check:release` — 버전 셋이 어긋나거나 문서 링크·이슈 ID가 깨지면 여기서 멈춘다
5. `npm run predeploy` — lint + 전체 e2e 통과 확인
6. 사용자 승인 → `npm run deploy`
7. **배포 ≠ 라이브.** gh-pages가 "Published"여도 GitHub Pages 빌드가 조용히 스턱될 수 있다
   (KNOWN-ISSUES `[DEPLOY-PAGES-STUCK-1]`). 라이브 번들 해시를 눈으로 대조하고, 어긋나면
   재빌드를 돌린다.
