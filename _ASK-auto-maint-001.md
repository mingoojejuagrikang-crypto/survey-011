# _ASK — 자동 유지보수 001 (큐 공백 회차 · 제안 모드)

레인: `auto/maintenance` · 워크트리 `~/projects/survey-011-wt/auto-maint` · 2026-08-07
상태: **제안만.** 코드는 고치지 않았다. `TODO.md`의 자동 유지보수 큐가 비어 있어 후보만 올린다.

> 🔴 **이 문서는 큐에 넣을 항목의 초안이다.** 큐(`workspace_teamops/TODO.md § 🤖 자동 유지보수 큐`)는
> 이 워크트리 밖이라 자동 레인이 직접 쓸 수 없다. **민구/Larry가 옮겨 넣어야 집행된다.**

---

## 후보 1 🟢 — 테스트가 커밋된 증거 PNG 3장을 덮어쓴다 (**즉시 집행 가능**)

**무엇:** 스펙 2개가 git 추적 중인 산출물 자산에 스크린샷을 쓴다.

| 위치 | 대상 |
|---|---|
| `tests/v043-exit-inline.spec.ts:49` | `Deliverables/assets/2026-08-02-ui-e4/exit-inline-375x650.png` |
| `tests/v043-exit-inline.spec.ts:52` | `Deliverables/assets/2026-08-02-ui-e4/exit-inline-402x874.png` |
| `tests/trend-alert.spec.ts:434` | `Deliverables/assets/2026-08-02-ui-e4/alarm-402x874.png` |

**실측 근거 (이 회차에 직접 잰 것):**

- `git ls-files Deliverables/assets/2026-08-02-ui-e4/` → **정확히 그 3장**이 추적 중이다.
- 세 스크린샷은 **단언이 아니다.** 주변 코드를 읽었다 — `toMatchSnapshot` 없음, 결과를 읽는
  단언 없음. 08-02 UI-e4 회차의 **일회성 증거 덤프**가 지워지지 않고 남은 것이다.
- `.gitignore:13`에 `test-results/`가 이미 있다 → **경로만 바꾸면 잡음이 사라진다.**
- **인용처 0건:** 저장소 `*.md` 전량 + `scripts/` 전량을 훑었다. 그 PNG를 `![]()`로 박은 문서는
  없고 `scripts/check-docs.mjs`도 `Deliverables`를 보지 않는다. → **파일을 그대로 두고
  쓰기 경로만 돌려도 잃는 것이 없다.**

**왜 지금 해야 하나 — 이미 두 번 값을 치렀다:**

1. 🔴 **증거가 조용히 교체됐다.** `b217278`(v0.46.0 프리뷰 배포)에 덮어쓴 PNG가 실려 나갔고
   `e06019a`가 **되돌리려고 따로 커밋**됐다. 커밋 제목이 그 사실을 적고 있다.
2. 🔴 **콜드 리뷰 R1이 오경보에 시간을 썼다.** `_ASK-review-R1.md` §4가 이 3장의 `M`을 보고
   *"이 워크트리에 다른 실행 주체가 붙어 있다"* 는 운영 알림을 올렸다. 실제로는 테스트 부작용이었다.
3. **회피 주석이 8개 문서에 퍼져 있다** — `TODO.md`(2곳)·`HANDOFF.md`(2곳)·`plans/…v0440-plan.md`·
   `deliverables/…ui-f-agy-eval.md`(2곳)·`…cold-review-L4-completeness.md`.
   🔑 **자동 유지보수 레인의 절대 규칙 #3(`git checkout -- Deliverables/assets/`)도 이 결함
   하나 때문에 존재한다.** 회피책이 규약으로 굳었는데, 그 회피책은 `b217278`에서 이미 한 번 샜다.

**처방(3줄):** 세 경로를 `test-results/ui-e4/…`로 돌린다. 커밋된 PNG는 **손대지 않는다.**
**반증:** 두 스펙을 돌린 뒤 `git status --short`가 **비어 있어야** 한다. 지금은 3줄이 뜬다.

**등급 판정:** 🟢 안전지대 — 제품 코드 0줄, 단언 0개, `page.evaluate` 함수 이동 없음(규칙 #4 무관).

---

## 후보 2 🟢 — `ALLOWLIST_ITEMS`에 죽은 항목이 남았다 + 상한 부채 표가 실측과 어긋난다

**무엇:** `tests/v043-typo-contract.spec.ts`의 `ALLOWLIST_ITEMS`(고정 상한 부채 목록)에
**아무 소스 줄과도 매치하지 않는 항목 1건**이 남아 있다.

**실측 근거:**

- `ALLOWLIST_ITEMS[0]`은 `CompleteSummary:87`의 `'max(15px, calc(clamp(17px, min(5vw, 2.6vh), 26px) * var(--fit-lo, 1)))'`다.
- 그런데 **그 리터럴은 이제 `src/`에 없다.** `grep -rn "2.6vh" src/` → 남은 것은
  `CompleteSummary.tsx:86`의 `gap`(다른 속성)과 `heroLayout.ts:228`의 **이력 주석**뿐이다.
  실제 `fontSize`는 `CompleteSummary.tsx:104`에서 `STATE_TYPE.completeReceipt`로 **승격됐다**
  (v0.46.0 WP-B — 스펙 주석이 *"allowlist −1, 계약 +1"* 로 그 사실을 적어뒀다).
- 즉 구현자는 **기대값은 `toBe(4)`로 내렸지만 목록에서 문자열은 지우지 않았다.**

**🟢 먼저 검사기를 변호한다 — `TODO.md`의 전제는 유효하다.**

> `TODO.md` §UI-g 부채: *"`ALLOWLIST_ITEMS`가 곧 이 부채 목록이다 — 내용 기반이라 상한을 없애면
> **검사기가 자동으로 알려준다.** 그때 해당 줄을 지운다."*

**알려준다.** `ModifyIndicatorPill:57`의 상한을 내일 없애면 `allowlistCount`가 4 → 3이 되어
`expect(...).toBe(4)`가 **터진다.** 실제로 v0.46.0 WP-B에서 26px가 승격됐을 때 **이 개수 단언이
발화했고**, 그래서 스펙 주석이 *"allowlist −1, 계약 +1"* 로 기록하며 기대값을 5 → 4로 내렸다.
👉 압력 없는 오라클이 **아니다.** `[TEAMOPS-3]`이 아니다.

**🟡 못 잡는 것은 딱 하나 — 「0줄을 세는 죽은 목록 항목」이다.**
`allowlistCount`는 «매치된 소스 줄» 단위로 센다. 그래서 기대값을 4로 내리는 것까지는 강제되지만,
**배열에서 문자열을 지우는 것은 강제되지 않는다** — 지우든 말든 4다. 구현자는 앞을 했고 뒤를
안 했다. 검사기 자신을 검사할 것이 없는 것뿐이다(lint의 lint).

**🔑 실행으로 확증했다** (`SURVEY_BASE_URL=http://localhost:5181` · `--reporter=list` · `--workers=1`).
검사기가 **자기가 센 allowlist 4줄을 직접 출력한다 — 그 목록에 26px 줄이 없다:**

```
[typo-contract-summary] contract=59 allowlist=4 comment=3 violation=0
  [allowlist] src/components/voice/ActiveControlBar.tsx:284    ← 영구 예외(70cqh)
  [allowlist] src/components/voice/ModifyIndicatorPill.tsx:57  ← 부채 18px
  [allowlist] src/components/voice/ModifyIndicatorPill.tsx:88  ← 부채 17px
  [allowlist] src/components/voice/ReaskCue.tsx:39             ← 부채 17px
  ✓  1 [chromium] › …v043-typo-contract.spec.ts:58 › 인라인 fontSize 계약 강제 검사기 (UI-g)
  1 passed (1.1s)
```

**판정: `✘` 0건 · 1 passed · 예외 0건.** 목록 4줄 중 **실제 상한 부채는 3건**이고
`ActiveControlBar`은 영구 예외다. `ALLOWLIST_ITEMS[0]`은 **0줄을 세면서 목록에 남아 있다.**

**파생 — 부채 표를 실측으로 정정해야 한다.** `TODO.md`는 「상한 5건」 중 `CompleteSummary:132`
1건만 소멸로 표시하지만, **`CompleteSummary:87`도 v0.46.0에서 소멸했다.** 실제 잔존은 **3건**이다:

| 위치 | 상한 | 상태 |
|---|---|---|
| ~~`CompleteSummary:87`~~ | `26px` | ✅ **소멸**(v0.46.0 WP-B — 이 회차 실측) |
| ~~`CompleteSummary:132`~~ | — | ✅ 소멸(v0.44.0 §C3) |
| `ModifyIndicatorPill.tsx:57` | `18px` | 🔴 잔존 |
| `ModifyIndicatorPill.tsx:88` | `17px` | 🔴 잔존 |
| `ReaskCue.tsx:39` | `17px` | 🔴 잔존 |

**처방(2단, 반드시 나눈다):**
- **2-a 🟢 자동 가능:** 죽은 `ALLOWLIST_ITEMS[0]` 항목 제거. **기대값은 안 건드린다** —
  그 항목이 세는 것이 0이므로 `toBe(4)`는 그대로 green이어야 한다. **그것이 곧 반증이다**
  (지운 뒤 값이 바뀌면 내 판정이 틀린 것이므로 즉시 되돌린다).
- **2-b 🔴 자동 아님:** 잔존 3건의 상한 제거는 **값이 변한다** → `TODO.md`가 적어둔 대로
  「정당 파손 판정 절차」가 필요하다. **사람 회차 몫이다.**

**등급 판정:** 2-a만 🟢 (죽은 상수 제거 · 테스트 파일). 2-b는 제외.

---

## 후보 3 🟡 — 편집 칩 기하를 재는 스펙이 0건이다 (**테스트 보강 — 단, 착지 형태를 먼저 정해야 한다**)

**무엇:** `src/components/voice/ColumnChip.tsx:113`

```
flex: isEditing ? '1 1 220px' : compact ? '0 0 clamp(180px, 48vw, 260px)' : '0 0 auto',
```

`TODO.md` §C1 감사 미처리 ②가 이걸 *"한 번도 유효한 적 없는 죽은 상수"* 이자
*"모든 좁은 뷰포트에서 상시 재현"* 되는 폭 붕괴(항목명 약 59% 잘림)로 적어뒀다.

**실측 근거:**

- `grep -rn "220px" src/ tests/` → **`src/` 1건 · `tests/` 0건.** 그 값을 재는 오라클이 없다.
- `grep -rln "isEditing\|editingColId" tests/` → **0건.** 편집 칩 기하를 재는 스펙이 **저장소에 없다.**
- ⚠️ **줄 번호 정정:** `TODO.md`는 `ColumnChip.tsx:103`이라고 적지만 실측은 **`:113`**이다(드리프트).

→ 자동 유지보수 규칙 #6(*"그 파일을 재는 스펙이 0건이면 리팩토링하지 말고 테스트 보강만"*)에
**정확히 해당한다.** 상수를 고치기 전에 오라클부터 세워야 한다.

**🔴 그런데 스펙만 먼저 넣으면 안 된다 — 기지 실패가 11 → 12로 는다.**
결함이 **상시 재현**이므로 *"편집 칩 항목명이 안 잘린다"* 를 단언하는 스펙은 **착지 즉시 red**다.
그건 Phase 0-a(기지 실패 11건 격리)를 정면으로 되돌린다. 착지 형태를 **둘 중 하나로 못 박아야 한다:**

- **(a) 스펙 + `flex` 수정을 한 회차에** — 스펙이 수정의 오라클이 된다. 🔴 값이 변하므로
  **자동 등급이 아니다**(사람 회차).
- **(b) 스펙을 `@known-*` 태그로 격리해서 착지** — `[TEAMOPS-26]`이 요구하는 **원인 규명 + 격리
  사유**를 함께 적는다. 이러면 Phase 0-a와 방향이 같아진다. 🟡 **이쪽은 자동 가능하다.**

**추천: (b).** 지금은 결함을 **재는 눈**이 없다는 것이 더 큰 문제고, (b)는 기지 실패 목록을
늘리지 않으면서 눈을 만든다. **어느 쪽으로 갈지는 민구/Larry 판단이다 — 자동은 정하지 않는다.**

---

## 후보에서 뺀 것과 이유

| 후보 | 왜 뺐나 |
|---|---|
| `src/lib/useDataActions.ts` 531줄 `[ENV-12]` 해소 | 🔴 **파일 분리라 Phase 0 대기 = 이미 `TODO.md`에 있다.** 새 정보가 없다. ⚠️ 그리고 *"스펙 0건"* 으로 프레이밍하려던 것을 **철회한다** — 직접 import 유닛 스펙은 0건이지만 `csv-export`·`recover-drive`·`recover-list-stage`·`v027-clips-manifest`·`v013-data-screens`가 **E2E로 그 경로를 돈다.** 「import 0건」을 「스펙 0건」으로 읽으면 규칙 #6을 잘못 적용한다 |
| `src/lib/driveUpload.ts` 370줄 (테스트 참조 **0건**) | 공개 API 전량이 네트워크 I/O다(`fetch` 기반 Drive 업로드). 이 저장소의 테스트 관습(순수 함수 직접 import + Playwright E2E)에 **맞는 축이 없다.** 억지로 넣으면 모킹 부채만 생긴다 — 기록만 남긴다 |
| 오디오 3파일 | 🔴 규칙 #5 제외 대상 |

---

## 📌 닫는 관찰 — Phase 0-b는 자동에 맡길 수 있다

`plans/2026-08-07-auto-maintenance-loop.md` §3이 *"0-a는 자동에 맡기지 않는다"* 라고 못 박은 것은
**0-a뿐이다.** *"이 실패가 기지인가"* 는 판단이지만, **0-b(`knip`/`ts-prune` 도입)는 기계 작업**이다
— devDependency 추가 + 설정 + npm 스크립트. 판단이 들어가는 지점은 *"이 미사용 판정이 맞나"* 인데
그건 **도입 이후의 사용 단계**이지 도입 자체가 아니다.

🔑 그리고 **후보 2가 0-b의 필요를 실증한다** — 죽은 `ALLOWLIST_ITEMS` 항목을 잡아낸 것은
검사기가 아니라 **이 회차의 손 grep**이었다. `[TEAMOPS-5]`·`[TEAMOPS-18]`이 경고한 그 지점이다.

**제안:** 0-b를 자동 유지보수 큐에 넣을 수 있는지 판단해 달라. 넣으면 Phase 0의 절반이
사람 대기 없이 닫힌다.
