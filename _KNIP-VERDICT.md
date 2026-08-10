# knip 검출물 판정표 (baseline 2026-08-11)

> 08-10 회차(`825dc9e`)가 `npm run check:unused`(knip)를 도입하면서 **검출물을 하나도 지우지 않고**
> "판정과 제거는 사람 몫"이라고 남겼다. 이 문서가 그 판정이다. **코드는 한 줄도 바꾸지 않았다.**
>
> 대상: `knip@6.32.0` · 검출 **83건**(파일 3 · export 64 · 타입 15 · 중복 export 1) · 전량 판정.

---

## 🔴 이 문서를 읽는 사람이 가장 먼저 알아야 할 것

**knip의 「unused export」는 「죽은 코드」가 아니다. 「어디서도 import되지 않음」이다.**

export·타입 검출 79건 중 **52건은 자기 파일 안에서 정상적으로 쓰이고 있다**(§8). 이들에 대해
knip의 발견이 뒷받침하는 유일한 조치는 **`export` 키워드 제거**이고, **심볼 삭제가 아니다.**
`npm run check:unused` 출력의 "Unused exports (64)"만 읽고 심볼을 지우면 **앱이 깨진다.**

실제로 심볼째 사라져도 되는 후보는 **11건**뿐이며, 그것도 전부 「후보」다(§4).

---

## 1. 판정 요약

| # | 판정 | 건수 | 조치 |
|---|------|------|------|
| §2 | **의도적 보존** — 되살리는 방법이 소스에 적혀 있다 | 2 | 유지. 건드리지 마라 |
| §3 | **계약 상수** — 스펙이 *일부러* import 안 하고 값을 복제한다 | 8 | 유지. `export` 제거도 재검토 대상 |
| §4 | **완전 미사용 후보** — 파일 안팎 어디서도 안 쓰임 | 11 | 다음 회차 제거 후보(민구 승인 필요) |
| §5 | **상속 복제 유물** — survey-011에서 한 번도 쓰인 적 없다 | 2(파일) | 제거 후보. 근거 최강 |
| §6 | **죽은 호환 재노출** — "기존 경로 호환"인데 그 경로 이용자가 0 | 2 | 제거 후보 |
| §6′ | **살아 있는 재노출** — 스펙이 배선을 감시한다 (`applyAppSchema`) | 1 | 🔴 유지. §6과 혼동 금지 |
| §7 | **픽스처 미채택 부채** — SSOT 픽스처를 두고 스펙이 로컬 복제 | 4 | 🔴 제거 금지. 반대로 채택이 답이다 |
| §8 | **`export` 키워드만 불필요** — 파일 안에서는 살아 있다 | 52 | 심볼 삭제 금지 |
| §9 | **중복 export**(별칭) | 1 | 유지. 통합은 제안만 |
| §10 | **판정 제외** — 오디오 3파일 규칙 | (§8 내 1건) | 판정하지 않음 |

합계 검산: 2 + 8 + 11 + 2 + 2 + 1 + 4 + 52 + 1 = **83** = knip 출력 83건. **전량 판정, 누락 0.**
각 검출물은 **정확히 한 절**에만 계수된다(§10의 `createRecognition`은 §8 안에 있고 그 자리에 「제외」로 표시했다).

knip 출력 축으로도 검산된다 — **파일 3**(§2 1 + §5 2) · **export 64**(§2 1 + §3 8 + §4 9 + §6 2 +
§6′ 1 + §7 4 + §8 39) · **타입 15**(§4 2 + §8 13) · **중복 1**(§9).

---

## 2. 의도적 보존 (2건) — 🔴 지우지 마라

| 대상 | 근거 |
|------|------|
| `src/components/settings/BeepPicker.tsx` (파일) | v0.46.0 WP-I(민구 지시 08-05)가 **렌더만 제거하고 파일은 남겼다.** `SessionOptionsSection.tsx:213-221`에 되살리는 절차가 적혀 있고, `tests/v033-beep-help.spec.ts:117`도 같은 절차를 참조한다 |
| `previewBeep` — `src/lib/beep.ts:216` | 유일한 소비자가 위 `BeepPicker.tsx`다. 파일 보존이 결정된 이상 이 export도 함께 남는다. ⚠️ 알려진 갭: `tests/feature-isolation.spec.ts:12`가 "직접 단언 미보유(beep.ts previewBeep try/catch 계약, 백로그)"라고 **스스로 무가드임을 기록**해뒀다 |

---

## 3. 계약 상수 (8건) — 스펙이 일부러 import하지 않는다

이 축이 이번 판정에서 **가장 틀리기 쉬운 곳**이다. import가 0인 이유가 「죽어서」가 아니라
**「import하면 오라클이 죽어서」**다. 스펙이 그 이유를 직접 적어놨다:

> `tests/v043-fit-group.spec.ts:8` — *"🔴 리터럴로 고정: 제품 상수를 import하면 상수가 바뀔 때
> 기대값이 자동 추종해 파손을 감춘다."*
>
> `tests/v0480-p1-check-vertex.spec.ts:34` — *"제품 상수를 import하지 않는 건 의도다: 제품이
> 상수를 바꿔도 계약은 여기 남아야 오라클이 신호를 낸다."*

| 심볼 | 값 | 감시하는 스펙 |
|------|-----|--------------|
| `HERO_MIN_FONT_PX` — `heroLayout.ts:6` | (복합) | `v043-fit-group.spec.ts:9,10,359,377,430` — 로컬 `const`로 복제 |
| `USABLE_ROWS` — `StateDots.tsx:69` | 10 | `v0480-p1-check-vertex.spec.ts:34,64,66,75,155` · `v0460-g-dot-pill.spec.ts:59,119` |
| `FIELD_ROWS` — `StateDots.tsx:46` | 14 | `_probe-fb5-threshold.spec.ts:6,56` · `v0460-g-dot-pill.spec.ts:119` |
| `RESERVED_ROWS` — `StateDots.tsx:71` | 4 | `_probe-fb5-threshold.spec.ts:6` · `v0461-p-dot-pill-short.spec.ts:31` |
| `FIELD_COLS` — `StateDots.tsx:45` | — | `KNOWN-ISSUES.md:1818` |
| `VOICE_COMMIT_MARK_MS` — `useVoiceCommitMark.ts:15` | 1500 | `v047-w4-commit-mark-session.spec.ts:6,99` · `v035-hero-confirm.spec.ts:431,433` |
| `HOLD_TO_WAKE_MS` — `BlackoutOverlay.tsx:75` | 2000 | `v0470-w7-hold-blackout.spec.ts:62` — *"제품 상수와 같아야 한다"* |
| `HOLD_TO_BLACKOUT_MS` — `HeroHoldToBlackout.tsx:65` | 3000 | `v0470-w7-hold-blackout.spec.ts:58` — *"import하지 않는 건 의도다"* |

**조치:** 전부 유지. `export` 키워드 제거조차 신중하다 — 값이 스펙에 리터럴로 복제돼 있어 **상수를
지우면 소스와 스펙이 조용히 갈라지고, 갈라진 것을 알려줄 오라클이 없다.**

⚠️ `BEEP_VOLUME_MAX`(값 12)도 같은 성격의 계약이지만(`v0440-d1-bargein.spec.ts:221`이
*"기대값을 숫자로 박는다. BEEP_VOLUME_MAX를 import해 비교하면 상수만 바꿔도 초록이 된다"*,
`beep-release.spec.ts:15,162`도 값 12를 리터럴로 박음), **knip이 잡은 것은 SSOT인
`beepVariants.ts:128`이 아니라 `beep.ts:24`의 재노출**이다. SSOT 쪽은 `beep-volume.spec.ts:8`이
실제로 import하므로 검출되지 않았다. 따라서 검출물로서의 판정은 §6이다 — **혼동 금지.**

---

## 4. 완전 미사용 후보 (11건) — 파일 안팎 어디서도 안 쓰임

| 심볼 | 위치 | 마지막 관련 커밋 | 비고 |
|------|------|-----------------|------|
| `AppSettings` | `src/types.ts:60` | `04fbdef` 2026-06-04 | **초기화 이후 무변경** — §5와 같은 상속 유물 |
| `VoiceState` | `src/types.ts:145` | `04fbdef` 2026-06-04 | 동상 |
| `loadUnsyncedSessions` | `src/lib/db.ts:159` | `04fbdef` 2026-06-04 | 동상 |
| `deleteAudioClip` | `src/lib/db.ts:216` | `c45fa27` 2026-06-04 | v0.3.0 정정 클립 보존 |
| `appendRow` | `src/lib/sheets.ts:435` | `e431b1a` 2026-07-07 | **구세대 API** — 후속은 `appendRows`(`sync.ts:3`이 그걸 쓴다) |
| `OVERLAY_DIM_STRONG` | `src/components/ModalBase.tsx:7` | `0eab777` 2026-08-02 | 값 `rgba(0,0,0,0.68)` — 종료 확인용. 인라인 종료 확인 도입 때 소멸한 듯 |
| `HERO_FIT_STEPS` | `src/components/voice/useFitScale.ts:23` | `36a01b1` 2026-08-01 | upward-open fit group 도입 때 대체된 듯 |
| `PRIMARY_COMMANDS` | `src/lib/voiceCommands.ts:136` | `bbf6a1e` 2026-07-08 | v0.31.0 입력탭 UI 개편 |
| `RECOGNITION_TOLERANCE_MIN` | `src/stores/settingsStore.ts:85` | `a903d76` 2026-07-03 | 값 0.4 — v0.26.0 허용범위 다이얼 **반전 원복**의 사체로 보인다 |
| `RECOGNITION_TOLERANCE_MAX` | `src/stores/settingsStore.ts:86` | `a903d76` 2026-07-03 | 값 0.9 — 동상 |
| `trimSilenceToWav` | `src/lib/audioTrim.ts:434` | `8360b64` 2026-06-10 | ⚠️ **제거 제안 붙이지 않음** — 소비자였을 `audioRecorder.ts`가 규칙 5 제외 대상이라 소멸 경위 추적이 막혔다 |

**조치:** 전부 「후보」다. 이번 회차는 제거하지 않았다. 🔴 제거는 민구 승인 뒤에 한다 —
**삭제된 심볼은 어떤 테스트도 잡아주지 못한다.**

---

## 5. 상속 복제 유물 (파일 2건) — 근거가 가장 강하다

| 파일 | 이력 |
|------|------|
| `src/components/Chip.tsx` | `04fbdef` 2026-06-04 *"survey-011 초기화 (growth-survey-010 독립 복제, v0.1.0)"* **이후 커밋 0건** |
| `scripts/test-sheets-url.mjs` | 동상 — `04fbdef` 이후 커밋 0건 |

즉 **조상 레포에서 복제돼 온 뒤 survey-011에서 단 한 번도 손대거나 쓰인 적이 없다.**
「기능이 소멸한 사체」가 아니라 「처음부터 이 레포의 코드가 아니었던 것」이다.

⚠️ `Chip.tsx`와 `ColumnChip.tsx`는 **다른 파일**이다. `ColumnChip.tsx`는 현역이고 여러 스펙이 참조한다
(`heroLayout.ts:81` · `v037-chip-2row.spec.ts:34` · `v0461-edit-chip-width.spec.ts:238`).
이름이 비슷해 grep으로는 갈라지지 않는다 — 이것이 08-10 회차가 grep에서 모듈 그래프로 옮긴 이유다.

---

## 6. 죽은 호환 재노출 (2건)

두 곳 모두 주석이 **"기존 import 경로 호환"**이라고 말하는데, 실측한 importer는 **전부 SSOT 모듈을
직접 import한다.** 호환시켜 줄 대상이 0이다.

| 재노출 | 주석이 말하는 것 | 실측 |
|--------|-----------------|------|
| `export { BEEP_VOLUME_MAX }` — `src/lib/beep.ts:24` | *"재노출(기존 import 경로 호환). 매핑·상한 SSOT는 beepVariants.ts"* | 유일 소비자 `tests/beep-volume.spec.ts:8`이 `'../src/lib/beepVariants'`에서 직접 import. `beep.ts` 경로 이용자 **0** |
| `export { recountSynced } from './sessionSync'` — `src/lib/sync.ts:19` | *"Re-export so existing importers of recountSynced from sync.ts keep working (SSOT now in sessionSync)"* | `dataStore.ts:3`·`useVoiceSession.ts:6` 모두 `'./sessionSync'`에서 직접 import. `sync.ts` 경로 이용자 **0** |

**조치:** 제거 후보. 단 이번 회차는 제거하지 않았다.

---

## 6′. 살아 있는 재노출 (1건) — 🔴 §6과 혼동 금지

`tests/fixtures/idb.ts:30`의 `export { DB_NAME, DB_VERSION, applyAppSchema }`도 형태는 §6과 같지만 **유지**다:

- 같은 줄의 `DB_NAME`·`DB_VERSION`은 knip이 **미사용으로 잡지 않았다** — 스펙들이 실제로 import한다.
  즉 **재노출 배선 자체는 살아 있다.**
- `applyAppSchema`는 파일 안에서 `APPLY_APP_SCHEMA_SOURCE`를 만드는 데 쓰인다(내부 참조 4건).
- 결정적으로 `tests/idb-fixture.spec.ts:39-40`이 이 배선을 **감시 대상으로 명시**한다:
  *"이 가드는 계속 가치가 있다: ① **재수출 배선이 깨지거나** ② upgrade가 applyAppSchema 밖에서…"*

스펙이 지키겠다고 적어둔 배선이다. 지우면 그 가드가 무의미해진다.

---

## 7. 픽스처 미채택 부채 (4건) — 🔴 제거가 아니라 채택이 답이다

`tests/fixtures/`의 공용 픽스처가 export하는데 **아무 스펙도 import하지 않는다.** 그런데 같은 이름이
스펙마다 **로컬 `const`로 재선언**돼 있다. 픽스처가 SSOT여야 할 자리에서 복제본이 번식했다.

| 픽스처 export | 위치 | import | 로컬 재선언 |
|--------------|------|--------|------------|
| `MOCK_INIT_SCRIPT` | `tests/fixtures/activeZones.ts:98` | **0** | **35개 스펙** (`log-replay:45` · `v037-chip-2row:90` · `v035-r3-fixes:56` · `safe-area:221` …) |
| `HEADERS` | `tests/fixtures/activeZones.ts:91` | **0** | **19개 스펙** — 값도 제각각(`['조사일자','농가명','횡경']` ↔ 6열 버전 등) |
| `SHEET_ROWS` | `tests/fixtures/activeZones.ts:92` | **0** | **12개 스펙** |
| `fireSttAlts` | `tests/fixtures/stt.ts:152` | **0** | `decimal-targeted-reask.spec.ts:112`가 동명 함수를 로컬 정의 |

⚠️ 이 4건은 grep으로 세면 각각 85·56·26·6건이 잡혀 **"활발히 쓰이는 중"으로 보인다.** 전부
로컬 재선언이거나 그 로컬 심볼의 호출이다. **grep 히트 수를 판정으로 쓰면 여기서 정확히 틀린다**(`TEAMOPS-5`).

같은 파일의 `boot`·`stubSheets`·`PHONE_402`·`fillAllRows`·`installVoiceMocks`·`fireStt`는 정상적으로
import돼 쓰인다 — 픽스처 파일 전체가 죽은 게 아니라 **이 4개 심볼만 채택되지 못했다.**

**조치:** 🔴 제거하지 마라. 제거하면 「복제본 35벌」이라는 실제 부채가 검출기 시야에서 사라진다.
`MOCK_INIT_SCRIPT` 복제본 35벌이 서로 드리프트하고 있는지는 **이 문서의 범위 밖**이며,
독립 회차가 필요하다(§11 제안 ①).

---

## 8. `export` 키워드만 불필요 (52건) — 🔴 심볼 삭제 금지

전부 **자기 파일 안에서 쓰이고 있다.** 외부 import만 0이다.

### 8-a. 문서·스펙이 이름으로 언급하는 것 (14건)

`export`를 떼도 이 참조들은 유효하게 남는다(이름을 지우는 게 아니므로). 다만 **심볼째 지우면 문서가 매달린다.**

| 심볼 | 위치 | 언급하는 곳 |
|------|------|------------|
| `buildAnomalyDisplay` | `anomalyAlert.ts:63` | `useVoiceSession.ts:2588`(주석) |
| `loadPastIndex` | `pastValues.ts:465` | `pastValues.spec.ts:3` — *"브라우저 의존부(loadPastIndex fetch+캐시)는 제외"* · `v034-past-index-apikey.spec.ts:54`(주석). 내부 참조 10건 |
| `robustPeak` | `audioTrim.ts:126` | `ENGINEERING-GUARDRAILS.md:156` · `KNOWN-ISSUES.md:708,710` |
| `LOG_FOLDER_ID` | `driveUpload.ts:10` | `KNOWN-ISSUES.md:614` |
| `readBundleId` | `feedback.ts:66` | `v0470-w5-hero-echo.spec.ts:40` — *"document를 읽으므로 Node에서 못 잰다. 브라우저 오라클 미신설"* (알려진 갭) |
| `getClientId` | `googleAuth.ts:78` | `_AUTO-MAINT-HISTORY.md:12` (08-10 회차가 판정 사례로 인용) |
| `parseUpdatedRangeFirstRow` | `sheets.ts:465` | `KNOWN-ISSUES.md:490` |
| `updateRow` | `sheets.ts:555` | `KNOWN-ISSUES.md:484,502` · `sync.ts:283`(주석) — **구세대 API**. `sync.ts:3`은 `updateCellsSparse`를 쓴다 |
| `createRecognition` | `speech.ts:59` | 🔴 **§10 판정 제외 — 오디오 3파일** |
| `parseNumeric` | `trendCheck.ts:38` | `anomalyAlert.ts:33`·`anomalyAlert.spec.ts:166`(주석) |
| `SETTINGS_TIP_SEEN_KEY` | `useSettingsActions.ts:47` | `helpCopy.ts:105` · `settings-ux.spec.ts:246` |
| `applySemanticDefaults` | `settingsStore.ts:219` | `helpCopy.ts:59` · `v033-beep-help.spec.ts:102` |
| `makeSettingsDefaults` | `settingsStore.ts:273` | `useSettingsActions.ts:421`(주석) |
| `SessionMeta` (타입) | `logger.ts:71` | `v023-voice.spec.ts:160` |

### 8-b. 언급 없음 (38건)

| 심볼 | 위치 |
|------|------|
| `formatAge` | `ConnectionStatusCard.tsx:31` |
| `OVERLAY_DIM` | `ModalBase.tsx:5` |
| `RELEASE_STEPS` · `RELEASE_STEP_MS` | `BlackoutOverlay.tsx:78,80` |
| `COMPLETE_RECEIPT_MS` | `CompleteSummary.tsx:8` |
| `COMPLETE_SUMMARY_MIN_FONT_PX` · `COMPLETE_RECEIPT_MIN_FONT_PX` · `HERO_LABEL_PROVISIONAL_RESERVE_PX` | `heroLayout.ts:8,14,19` |
| `CHIP_SWEEP_FASTEST_SECONDS` · `CHIP_SWEEP_SLOWEST_SECONDS` · `CHIP_SWEEP_MAX_SECONDS` · `CHIP_SWEEP_MIN_TRAVEL_PX` | `chipSweep.ts:43,46,64,81` |
| `uploadLogToUserDrive` · `uploadLogToAdminTeamFolder` | `driveUpload.ts:159,234` |
| `CAPTURE_TIMEOUT_MS` · `feedbackFilename` · `buildFeedbackZip` · `flushFeedbackQueue` | `feedback.ts:43,46,103,263` |
| `legacySessionLabel` | `legacySyncFlow.ts:37` |
| `SEQ_BUTTON_MAX` | `manualInput.ts:19` |
| `excludedFor` | `optionExclusions.ts:22` |
| `CAPTURE_JPEG_QUALITY` | `screenshot.ts:24` |
| `fetchAllRows` | `sheets.ts:393` — **구세대 API**(후속 `fetchAllRowsUnbounded`, `sheets.ts:418`) |
| `parseValueForColWithReason` | `valueParseAttempt.ts:182` |
| `SIMULATED_INSETS` | `tests/fixtures/safeArea.ts:14` |
| `VOICE_MOCK_INIT_SCRIPT` | `tests/fixtures/stt.ts:33` |
| **타입 12건** — `FitMemberRef`(`useFitGroup.ts:4`) · `BeepSegment`(`beepVariants.ts:13`) · `FailedCellCommit`(`cellPersistError.ts:21`) · `ClipManifestEntry`(`clipsManifest.ts:40`) · `ManualChoiceKind`(`manualInput.ts:21`) · `ListRecoverResult`(`recoverFromDrive.ts:46`) · `SheetInfo`(`sheets.ts:17`) · `ColParseResult`·`ParseAttemptEvent`(`valueParseAttempt.ts:35,44`) · `AutoValue`·`TrendRule`(`types.ts:6,14`) · `NodePrint`(`tests/fixtures/previewVerify.ts:46`) | |

---

## 9. 중복 export (1건)

`src/lib/chipSweep.ts` — `CHIP_SWEEP_MAX_SECONDS = CHIP_SWEEP_SLOWEST_SECONDS`(`:64`, 값 40)의
**별칭 관계**를 knip이 중복 export로 본다. 통합은 §11 제안 ③으로만 남긴다.

---

## 10. 판정 제외 — 오디오 3파일 규칙

`useVoiceSession.ts` · `audioRecorder.ts` · `speech.ts`는 리뷰 라운드 필수 대상이라 이 레인이 판정하지 않는다.
해당 검출물은 **`createRecognition`(`src/lib/speech.ts:59`) 1건**이며, §8-a에 위치만 적고 판정은 비웠다.

`audioTrim.ts`(`robustPeak`·`trimSilenceToWav`)는 위 3파일 닫힌 목록에 **없으므로** 판정 대상이다.
다만 `trimSilenceToWav`의 소비자였을 `audioRecorder.ts`가 제외 대상이라 소멸 경위를 추적할 수 없어,
§4에서 제거 제안을 붙이지 않고 후보로만 남겼다.

---

## 11. 다음 회차 제안 (이번 회차는 실행하지 않았다)

① **`MOCK_INIT_SCRIPT` 복제본 35벌 드리프트 조사** — 픽스처 SSOT와 각 스펙 로컬본이 실제로 갈라져 있는지.
   갈라져 있다면 그 자체가 오라클 신뢰도 문제다. §7이 근거.

② **§6 죽은 호환 재노출 2건 제거** — `beep.ts:24` · `sync.ts:19`. 두 파일 모두 스펙이 있어 규칙 6은 통과한다.
   🔴 `applyAppSchema`는 함께 지우면 안 된다(§6 혼동 주의).

③ **`chipSweep.ts` 별칭 통합** — 스펙 보유(규칙 6 통과)라 방어 가능하지만 이번 과제는 판정이라 미실행.

④ **§4·§5 제거** — 민구 승인 필요. `Chip.tsx`·`test-sheets-url.mjs`·`AppSettings`·`VoiceState`·
   `loadUnsyncedSessions`는 `04fbdef` 이후 무변경이라 근거가 가장 강하다.

⑤ **`check:unused`를 `check:release`에 연결하지 마라 (현행 유지)** — 판정이 끝나도 §3·§7·§8의
   68건은 정당하게 남는다. 연결하면 exit 1로 배포가 막힌다. 「보고용」이 이 검사기의 올바른 자리다.

---

## 12. 방법론과 한계

**어떻게 판정했나** — 각 심볼에 대해 세 축을 기계적으로 재고, 갈리는 것만 눈으로 확인했다:
① 자기 파일 **밖** 참조를 `import` / 로컬 동명 선언 / 주석 / 문서 / 실코드로 자동 분류
② 자기 파일 **안** 참조 수(선언 줄 제외) — §8과 §4를 가르는 축
③ `git log -S'<심볼>'` — "언제 죽었는지". §5의 근거가 여기서 나왔다

**knip 표본 검증** — `src/types.ts`의 `AppSettings`·`VoiceState`·`AutoValue`·`TrendRule`이 미사용으로
잡힌 것이 의심스러워 손으로 확인했다. **`types.ts` 밖 참조 0건 — knip이 맞았다.** 중앙 타입처럼
보이는 이름도 실제로는 아무도 참조하지 않는다.

**스캔 범위** — `src` `tests` `scripts` `shared` `docs` 루트 `*.md` `index.html`.
🔴 **`Deliverables/` · `design-handoff/` · `public/`은 보지 않았다.** `design-handoff/`는 knip도
ignore 대상(앱 빌드 밖 참고 산출물)이고 나머지도 앱 코드가 아니라 재실행하지 않았다.
이 범위 밖에서 참조하는 심볼이 있다면 이 판정표는 그것을 놓친다.

**이 회차의 실측** — 코드 무변경(이 문서 1개만 추가). `npm run check:docs` **EXIT=0**(문서 12→13개) ·
`npm run check:release` **EXIT=0** · `npm run check:unused` 출력이 판정 전후 **바이트 동일**(검출 83건 불변,
EXIT=1은 검출 존재 시 정상이며 게이트 밖이라 배포 무영향). src·tests 무변경이라 e2e는 재실행하지 않았다.

**한계** — ①런타임 동적 참조 중 `knip.jsonc`의 `paths` 매핑(`/src/*`)이 못 잡는 형태가 있다면 놓친다.
②§7의 복제본들이 서로 다른 값을 갖는지는 조사하지 않았다(제안 ①).
③값 리터럴 계약은 **스펙이 이름을 언급한 경우**만 확인했다 — 이름 언급 없이 값만 박힌 계약은 놓칠 수 있다.
