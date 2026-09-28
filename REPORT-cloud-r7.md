# REPORT — cloud r7 (리뷰 7회전 수정)

- 브랜치: `cloud/fix-r7` (기준 `hotfix/ios27-stt` @ `5c9e61c`)
- 범위: 7회전 **P1 1건만 수정**(P0 0건). P2 이하는 결정 10에 따라 아래에 기록만 하고 코드는 건드리지 않았다.
- 배포(`deploy`/`deploy:preview`)·버전 변경: **하지 않음**.
- iOS 27 실기기 상태: 계속 **MONITORING** — 이 수정은 데스크톱 목 기준 검증이며 `docs/REAL-DEVICE-TEST.md` 판정 전까지 RESOLVED가 아니다.

## 1. P1 — 하이브리드 취소 중 큐의 미시작 `onerror`가 TTS 뮤트를 조기 해제

### 원인
하이브리드 ON에서 A(시작됨)·B(큐 대기)가 있을 때 A의 started 오류 또는 종료 워치독이 `engine.cancel()`을 호출한다.
엔진이 취소 중 **B에 동기 `onerror`**를 쏘면 B의 `done()` → `unmuteForTts()`가 A의 출력 경계보다 먼저 도착한다.
기존 보류 조건은 `hybridDue`가 있을 때만 작동했고, B는 `started=false`라 `hybridDue`를 만들지 않으므로 `ttsMuted=false`가 됐다.
A의 오류가 나중에 `hybridDue`를 세워도 이미 풀린 뮤트를 다시 걸지 않는다 → 구 인식기의 에코 final이 값 게이트(`useFinalValueGate.ts:116`의 `isTtsMuted()`)를 통과할 수 있었다.

### 수정 (`src/lib/speech.ts` `unmuteForTts`)
보류 조건을 `hybridDue` → `hybridDue || hybridTts.size > 0`으로 넓혔다.
`hybridTts`는 「시작됐지만 아직 종료 경계가 오지 않은 하이브리드 TTS 출력」 집합(이미 `flushHybridSwap`이 같은 의미로 사용)이다.
그래서 취소 중 어느 `done()` 입구가 먼저 오든, 시작된 출력이 종결되고 엔진이 `speaking===false && pending===false`가 될 때까지 뮤트가 유지된다.
보류된 언뮤트는 기존 `unmutePendingForSilence` 경로(출력 경계 재시도 + `EngineSilenceGate` 폴링)가 이어받는다.

- **비적용 경로 불변:** `hybridTts`는 `hybrid.enabled && bargeIn`일 때만 채워지고, 조건 전체가 `usesHybridTts()` 뒤에 있다. 비-iOS 기본 OFF·말끊기 OFF에서는 식이 종전과 동일하다.
- **`cancelTts()` + native end 소실:** 드레인의 `done()`이 `'skip'` 경계로 `hybridTts`를 비우므로 종전대로 언뮤트한다(동작 변화 없음).
- `attemptStart`의 같은 모양 보류(:565)는 건드리지 않았다 — 재진입이 `engine.cancel()` 안에서 동기로 일어나 타이머가 끼어들 수 없고, 넓히면 재생 중 재시작 타이밍이 바뀐다(범위 밖).
- 문서: `PRINCIPLES.md` §4 하이브리드 절, `KNOWN-ISSUES.md` iOS 27 항목에 「리뷰 7회전 P1 보강」 추가.

### 회귀 테스트 (반증 포함)
`tests/speech-lifecycle.spec.ts` — `r7 P1: queued B sync onerror during A {error|watchdog} cancel keeps mute until engine silence` (2건).
실제 `speak()` 두 건 + `SpeechController`, cancel 목은 **큐의 미시작 B에 동기 `onerror`**를 쏘고 A의 `speaking=true`를 남긴다(리뷰어 독립 재현과 같은 형상).
단언: 두 Promise 완료 뒤 `isTtsMuted()===true`, 구 인식기 미교체, 구 인식기 final `999`가 **뮤트 중**에 도착 → 엔진 침묵 뒤 교체 정확히 1회·언뮤트.

**반증:** 수정 한 줄을 되돌리고 같은 두 테스트를 돌리면 둘 다 실패한다.

```
  ✘  1 [chromium] › tests/speech-lifecycle.spec.ts:720:5 › F5 — native TTS error / missing cancel completion › r7 P1: queued B sync onerror during A error cancel keeps mute until engine silence (30ms)
  ✘  2 [chromium] › tests/speech-lifecycle.spec.ts:720:5 › F5 — native TTS error / missing cancel completion › r7 P1: queued B sync onerror during A watchdog cancel keeps mute until engine silence (2.5s)

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: true
    Received: false

      741 |       expect(cancels).toBe(1);
      742 |       expect(engine.speaking).toBe(true);
    > 743 |       expect(ctrl.isTtsMuted()).toBe(true);
          |                                 ^
      744 |       expect(old.aborted).toBe(false); expect(MockRec.instances).toHaveLength(1);
  2 failed
```
수정 복원 후: 2 passed. `speech-lifecycle.spec.ts` 전체 `--workers=1` → **53 passed**.

## 2. 검증

| 명령 | 결과 |
|---|---|
| `npm run build` / `npm run build:preview` | 통과 |
| `npm run check:release` | exit 0 (문서 정합성 OK · lint 통과) |
| `git diff --check` | 통과 |
| `npm run test:e2e -- tests/speech-lifecycle.spec.ts tests/speech-platform.spec.ts tests/v0440-d1-bargein.spec.ts tests/beep-output-boundary.spec.ts tests/logEvents.spec.ts tests/v049-fix49b-tts-drain.spec.ts tests/v049-fix49-cancel-unmute.spec.ts --workers=1` | 헤드리스 쉘 누락 수정 전 첫 실행에서 **123 passed** + 15건 브라우저 기동 실패(환경 — 아래 참고). 브라우저 스펙은 아래 게이트에서 모두 실행됨 |
| `PREVIEW_BUILD=1 npm run test:e2e -- tests/ios27-preview-flow.spec.ts --workers=1` | **8 passed** |

### 전체 게이트 `npm run test:e2e:gate -- --reporter=dot` (기준선 대조, 순차 실행·단일 워커)

기준선 `5c9e61c`(별도 워크트리) 원문 요약:
```
  33 failed
  2 skipped
  1183 passed (1.2h)
```
수정본 `cloud/fix-r7` 원문 요약:
```
  33 failed
  2 skipped
  1185 passed (1.1h)
```
- 통과 수 차이 +2 = 이번 회귀 테스트 2건.
- 실패 33 vs 33 중 **32건은 양쪽 동일**(아래 목록) → 이 브랜치와 무관한 기존/환경 실패. 이 세션엔 `.env.local`이 없다(AGENTS 30초 체크 — 로그인 의존 테스트가 코드와 무관하게 실패할 수 있음).
- 한쪽에만 있는 2건은 둘 다 **양쪽 트리에서 재현되는 flake**다:
  - `v049-fix49-cell-guard.spec.ts:126 ①` — 기준선 게이트에서만 실패. 단독 3회 재실행: 기준선 3/3 실패, 수정본 2/3 실패.
  - `v034-wave-glow.spec.ts:234 B7` — 수정본 게이트에서만 실패. 단독 반복: 기준선 1/31 실패(`level0=130 level0.85=128`), 수정본 4/31 실패. rAF가 그리는 켜진 셀 수를 200ms 뒤 한 번 표본하는 단언(`hi > lo`)이라 표본 시점 흔들림이다. 이 앱 경로는 비-iOS 기본 OFF라 수정 식이 종전과 동일하다(`hybridTts` 비어 있음).
- `[TEST-TTS-SYNTH-CACHE-1]`(`v049-p1-tts-watchdog.spec.ts`)은 이번 단일 워커 게이트에서는 **양쪽 모두 통과**해 재현되지 않았다. 해결 선언이 아니다 — 워커 수·순서에 따라 드러나는 격리 문제로 `OPEN` 유지.

양쪽 공통 실패 32건:
```
tests/anomaly-touch-buttons.spec.ts:331:3 › C3 375x667 — 조절판 열기 → manualHold: 자동 접힘 + [확인]/[수정] 유지
tests/manual-input.spec.ts:799:1 › [리뷰 High] manualHold 지연 put 중 즉시 [확인] → advance 금지, durable 후에만 진행
tests/v0460-fit-headroom.spec.ts:334:5 › 기준② 확정값에 여유가 없다 · 짧은 항목명·값 @ 402x874 ─────
tests/v0460-fit-headroom.spec.ts:334:5 › 기준② 확정값에 여유가 없다 · 짧은 항목명·값 @ 640x1024 ────
tests/v0460-fit-headroom.spec.ts:334:5 › 기준② 확정값에 여유가 없다 · 🔴긴 항목명·값(§8 시트 불특정) @ 402x874
tests/v0460-fit-headroom.spec.ts:334:5 › 기준② 확정값에 여유가 없다 · 🔴긴 항목명·값(§8 시트 불특정) @ 640x1024
tests/v047-w4-commit-mark-session.spec.ts:125:1 › W4-④ — cascade 수정이 셀을 비우면 ✓ 회수, 재커밋하면 복원(값 삭제 = 회수 계약)
tests/v047-w4-commit-mark-session.spec.ts:93:1 › W4-①②③④ — ✓ 누적·행 전환 무이식·이전 행 복귀 시 복원·수정 덮어쓰기 유지
tests/v0470-r2-p1-direct-modify-trend.spec.ts:118:1 › P1ⓒ-review 🔴 검토 대기 출신 직접 수정: 알람 해소 후 착지는 advance가 아니라 검토 대기 재진입
tests/v0470-r2-p1-direct-modify-trend.spec.ts:154:1 › P1ⓒ-review-재위반 🔴 정정값이 또 위반이어도 검토 대기 예약이 산다 — 2번째 알람 확인 후 재진입
tests/v0470-r2-p1-direct-modify-trend.spec.ts:279:1 › P1-중첩복귀 🔴 기존 복귀 예약 위의 교차행 직접수정: 확인 후 안쪽 출발 행으로 먼저, 바깥 예약은 그 행 완료 후
tests/v0470-r2-p1-direct-modify-trend.spec.ts:71:1 › P1ⓐⓑⓒ 🔴 직접 수정이 이상치면 알람이 뜨고, 에코 대신 알람 TTS가 나가며, 확인 후 원위치로 돌아온다
tests/v0470-r2-p5b-hold-candidate-hidden.spec.ts:90:1 › P5b-ⓑ 🔴 기존 값이 있던 셀의 후보 — 칩은 직전 확정값 + **원래 색(초록)** 체크를 유지
tests/v0470-w6-complete-dot-pill.spec.ts:101:3 › ⓐ 402×513 완료 — 체크 글리프와 필의 잉크 겹침 0
tests/v0470-w6-complete-dot-pill.spec.ts:101:3 › ⓐ 402×874 완료 — 체크 글리프와 필의 잉크 겹침 0
tests/v0470-w6-complete-dot-pill.spec.ts:124:1 › ⓑ 완료를 벗어나면 접힌 필이 돌아온다 — 숨김은 완료 한정이다
tests/v0470-w6-complete-dot-pill.spec.ts:164:1 › ⓒ 🔴 v0.51 — 완료 중 조절판 음성 경로는 사라졌고(무동작), 완료를 벗어나면 손 경로가 돌아온다
tests/v049-f1-field-nav.spec.ts:223:1 › ⑦ 항목 이동은 기록값을 건드리지 않는다 ────────────────────
tests/v049-f1-field-nav.spec.ts:256:1 › ⑩ 검토 대기 중 「다음」은 항목을 옮기고 기록값을 낭독한다 (W1 — FB-1)
tests/v049-f1-field-nav.spec.ts:273:1 › ⑪ 검토 대기에서 이동해도 완료 셀은 덮이지 않고, 「수정」이 그 셀을 연다 (덮어쓰기 금지 보존)
tests/v049-f1-field-nav.spec.ts:305:1 › ⑫ 검토 대기의 첫 항목 경계 — 안내만 하고 검토 스코프가 증발하지 않는다
tests/v049-r2-a1-atend-row.spec.ts:113:1 › ① 순서 밖 완주 후의 bare 「수정」은 서 있는 행을 고친다 — 남의 완료 행을 되돌리지 않는다 (C1)
tests/v0490-p2-manual-resolve-green.spec.ts:125:1 › P-2① 🔴 음성 발동 알람을 키패드로 해소 → echo TTS보다 먼저 green + hero가 정정값
tests/v050-c48-landing-bypass.spec.ts:429:1 › ⑥ U1 — 착지 부기 중의 정상 재개가 착지를 죽이고 확정값을 덮게 하지 않는다
tests/v052-modify-column-spoken.spec.ts:349:1 › ⓕ 끝 도달(atEnd)의 미매칭도 마지막 칸을 지우지 않는다
tests/v052-modify-column-spoken.spec.ts:406:3 › ⓙ 질문 중 「수정」 — 어느 셀도 지워지지 않고 행도 전진하지 않는다 (종전: 1행 m2를 지우고 1행을 미완료로 되돌렸다)
tests/v052-modify-column-spoken.spec.ts:406:3 › ⓙ2 질문 중 「확인」 — 어느 셀도 지워지지 않고 행도 전진하지 않는다 (종전: 질문을 켜 둔 채 「수확량 말씀해 주세요」라는 실행 불가능한 지시를 냈다)
tests/v052-modify-column-spoken.spec.ts:406:3 › ⓙ3 질문 중 「취소」 — 어느 셀도 지워지지 않고 행도 전진하지 않는다 (종전: 같은 형태 — 질문이 남은 채 값 요구 문구가 나갔다)
tests/v052-modify-column-spoken.spec.ts:406:3 › ⓚ 질문 중 「수정 사십일 점 사」 — 어느 셀도 지워지지 않고 행도 전진하지 않는다 (종전: 1행 m2를 41.4로 **덮어썼다**(리뷰 6낱말 표에 없던 축 — 소거보다 나쁘다))
tests/v052-modify-column-spoken.spec.ts:406:3 › ⓛ 질문 중 「유지」 — 어느 셀도 지워지지 않고 행도 전진하지 않는다 (종전: 답하지 않은 2행을 완주·전진시켰다(「조사나무 2 완료. 조사나무 3.」))
tests/v052-modify-column-spoken.spec.ts:432:1 › ⓜ 대조군 — 질문 중에도 칸을 대상으로 하지 않는 명령은 종전대로 듣는다(우회가 명령을 죽이지 않았다)
tests/v0550-login-status.spec.ts:178:1 › ④ ②에서 버튼 클릭 => 로그인 모달 -> [로그인] 클릭 => status_card_login:clicked 및 성공 후 ok
```

### 환경 메모 (코드와 무관)
- 설치된 Playwright 1.61.0이 요구하는 `chromium_headless_shell-1228`이 컨테이너에 없고 `1194`만 있었다. 레포 파일은 바꾸지 않고, 스크래치 `PLAYWRIGHT_BROWSERS_PATH`에 1228 이름으로 1194 바이너리 심볼릭 링크를 만들어 기준선·수정본 게이트를 **같은 환경**에서 돌렸다.
- 작업 중 셸 명령 실수로 컨테이너의 `/dev/null`을 잠시 심볼릭 링크로 덮었다가 즉시 문자 장치(`c 1 3`)로 복구했다. 레포·커밋에는 영향이 없고, 두 게이트는 복구 뒤에 실행됐다.

## 3. P2 이하 — 기록만 (결정 10, 코드 수정 없음)

| ID/항목 | 내용 | 처리 |
|---|---|---|
| 기존 P2-7 | 이전 회전에서 이월된 P2-7 | 다음 개선 작업으로 이월 |
| suspended 비프 상한 뒤 늦은 재개 | 비프 토큰 상한이 지난 뒤 AudioContext가 늦게 재개되는 경우 | 이월(실기기 관측 대상) |
| G1 재마운트 음성 래치 | G1 mute 고지의 「세션당 한 번」 음성 래치가 재마운트 경계에서 어떻게 유지되는가 | 이월 |
| `[TEST-TTS-SYNTH-CACHE-1]` | TTS 워치독 목이 모듈 캐시로 다음 테스트에 남는 격리 문제 | `OPEN` 유지(이번 게이트에선 미재현, 위 참조) |
| (관찰) `wave-glow B7` flake | 켜진 셀 수 단일 표본 비교가 기준선에서도 가끔 실패 | 신규 관찰 기록만 — 테스트 수정은 하지 않음 |
| (관찰) `fix49-cell-guard ①` | 이 환경에서 기준선 포함 대부분 실패 | 신규 관찰 기록만 |

## 4. 커밋
- `83ae591` fix: hold hybrid TTS mute while a started output is unsettled (r7 P1) — `speech.ts` 1줄 조건 + 주석, 회귀 2건, PRINCIPLES·KNOWN-ISSUES 계약 문구
- (이 보고서) docs: add cloud r7 report
