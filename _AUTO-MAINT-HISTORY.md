# 자동 유지보수 이력 (`auto/maintenance` 레인)

> 이 레인이 **코드를 바꾼 회차만** 최신순으로 한 줄씩 적는다. 제안·문서만인 회차는 적지 않는다.
> 🔴 `CHANGELOG.md`는 이 레인이 건드리지 않는다 — `check:release`가 `package.json` 버전과의 일치를
> 강제하는데 이 레인은 버전 bump가 금지라 항목을 추가하는 순간 배포가 막힌다.

- **2026-08-07** · 테스트 스크린샷 3장의 쓰기 경로를 `Deliverables/assets/2026-08-02-ui-e4/` →
  `test-results/ui-e4/`로 옮겼다 (`tests/v043-exit-inline.spec.ts` 2곳 · `tests/trend-alert.spec.ts` 1곳).
  **왜:** 그 경로가 git 추적 중인 08-02 회차 증거 PNG였고 매 런이 덮어썼다 — `b217278`에 교체본이 실려
  나가 `e06019a`가 되돌리는 커밋을 따로 냈고, 콜드 리뷰 R1은 그 `M`을 "다른 실행 주체가 붙었다"는
  운영 알림으로 오독했다. 세 스크린샷은 단언이 아니라 증거 덤프라(`toMatchSnapshot` 0건 · 결과를 읽는
  단언 0건 · `*.md` 인용처 0건) 경로만 옮기면 잃는 것이 없다. `test-results/`는 이미 `.gitignore:13`에 있다.
  **실측:** 편집 전 런이 `alarm-402x874.png`·`exit-inline-402x874.png` 2장을 실제로 바이트 변경시켰고
  (`exit-inline-375x650.png`는 이번 런에서 우연히 바이트 동일), 편집 후 런은 `Deliverables/assets/` 오염
  **0건**. 두 런 모두 `✘` 1건으로 같고 그 1건은 기지 실패 `[CHIP-TYPO-1]`/`[ALERT-COMPARE-1]`
  (`KNOWN-ISSUES.md:1092`)의 **동일 단언**이다 — 예외 전환 없음, 신규 실패 0.
