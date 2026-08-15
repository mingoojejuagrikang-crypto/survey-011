# ARCHITECTURE — survey-011 코드 구조

> 이 문서는 **현재 코드 기준**이다(2026-07-26, v0.39.0). 파일을 추가·이동하면 여기도 고쳐라.
> 개요만 필요하면 [README.md](../README.md) §코드 구조를, 판단 기준은
> [PRINCIPLES.md](../PRINCIPLES.md)를 보라.

## 전체 배치

```text
src/
├── main.tsx            엔트리 — React 마운트 + PWA 등록
├── App.tsx             탭 라우팅 + 디바이스 프레임 + 전역 배너
├── types.ts            Column · Session · SessionRow · SessionTarget 등 도메인 타입
├── tokens.ts           디자인 토큰 (색상, 타이포)
├── screens/            탭 3개의 조립 루트
├── components/         화면별 표현 컴포넌트 (voice/ settings/ data/ + 공용)
├── stores/             Zustand 상태와 영속화 경계
├── lib/                음성·클립·인증·동기화 도메인 로직 (54개 모듈)
└── styles/global.css   전역 CSS·@keyframes·safe-area 변수 SSOT
tests/                  Playwright 회귀·E2E·실기기 근사 (86 스펙)
scripts/                릴리스·문서 가드
```

## 화면 3개 (`src/screens/`)

세 화면 모두 **조립 루트**다. 실제 표현은 `components/<영역>/`에 있고, 로직은 `lib/`에 있다.

| 화면 | 역할 | 주요 컴포넌트 디렉터리 |
|------|------|------------------------|
| `SettingsScreen.tsx` | 로그인 → 시트 연결 → 컬럼 설정 → 테이블 생성 | `components/settings/` |
| `VoiceScreen.tsx` | 음성 입력 세션 (상태 전환의 표시 루트) | `components/voice/` |
| `DataScreen.tsx` | 기록 열람·편집·동기화·내보내기 | `components/data/` |

`App.tsx`는 탭 사이를 **언마운트 없이** 전환한다. 이건 스타일이 아니라 계약이다 —
`VoiceScreen`이 unmount되면 인식기·워치독·클립 레코더가 teardown돼 STT가 죽는다
(KNOWN-ISSUES `[STT-16]`, 실기기 62초 사공백). `PortraitGuard`도 같은 이유로 **오버레이**이지
트리 교체가 아니다.

## 음성 입력 상태 (`VoicePhase`)

SSOT는 `src/stores/sessionStore.ts`의 `VoicePhase`다.

```text
ready → active ⇄ paused
          ↓
       complete → stopping → done
```

| phase | 화면 |
|-------|------|
| `ready` | `ReadyState` — 시작 버튼 |
| `active` | `ActiveState` — 4구역 와이어프레임 |
| `paused` | `ActiveState` (CenterStage만 교체) |
| `complete` | `ActiveState` + `CompleteSummary` — 완료 행 검토 대기 겸 끝 도달 |
| `stopping` | `StoppingState` — 저장 진행 |
| `done` | 데이터 탭으로 |

**상태 전환은 표시 전환이지 트리 교체가 아니다.** `VoiceScreen`·`ActiveState`는 계속 마운트된
채 `CenterStage` 내부 자식만 바뀐다.

### 입력 화면 4구역 (v0.40.0 — 개선요청 9건 반영판)

`ActiveState`는 `gridTemplateRows: 'auto 1fr 2fr 1fr'`로 고정된다 — 상단 스트립 위에
**칩존 25% / 중앙 50% / 하단 25%**. 402×874 실측에서 183/366/183.

```text
ActiveHeaderStrip   상태·행 정보
ChipZone            항목 칩 — **한 행 · 가로 스크롤 · 진행중 칩을 우측 끝에 자동 정렬**
                    칩 내부는 2행(1행 항목명 / 2행 값)
CenterStage         값 hero / 경보 / 일시정지 / 완료 — 상태별 자식만 교체
  └ VoiceHero · AnomalyAlertPopup · CompleteSummary · StateIndicator · StateDots
ActiveControlBar    상태별 좌/우 버튼 — active·complete `이전`/`다음` ·
                    anomaly `확인`/`수정` · paused `재시작`/`종료`.
                    가운데 인디케이터가 일시정지 컨트롤을 겸한다(자리를 새로 만들지 않는다).
                    🔴 조절판(`ActiveControlSteppers`)이 열리면 **이 행을 통째로 언마운트**한다 —
                    겹칠 상자가 없으므로 오탭 경로가 구조적으로 불가능하다(fb-27-5·6).
```

**하단 인디케이터는 단일 도트 격자다**(v0.40.0). 대기 글리프·경고 글리프·음성 반응 파형이
**같은 셀 집합**을 공유하므로 겹칠 두 번째 레이어가 존재하지 않는다 — 종전의
"도트 레이어 + 파형 레이어 opacity 교차"와 그 게이트는 제거됐고 `VoiceWaveform.tsx`도 삭제됐다.
이것이 `[UI-WAVE-1]`(저레벨에서 도트·파형 동시 렌더)을 코드 수정 없이 소멸시킨 경로다.

값 크기는 `heroLayout.ts`의 타이포 스케일(`STATE_TYPE` — **상태별 인라인 폰트 정의 금지**,
→ 가드레일 `[TYPO-CONTRACT-1]`), 화면 맞춤은 `useFitScale.ts`.
테두리 글로우는 `EdgeGlow.tsx` + `useAudioLevelVar.ts`(→ 가드레일 ④).

⚠️ **칩존 자동 스크롤이 "다음 항목 보기"가 아닌 이유**(되돌리기 전에 읽어라): 칩이 '항목명+값'을
함께 보여주므로 진행중 칩 왼쪽에 남는 것이 **이미 입력을 마친 칩 = 입력 확인 영역**이다.
오른쪽(다음 항목)은 값이 아직 `—`라 미리 볼 실익이 적다. 민구 확정(2026-07-27) —
*"한국인들은 글을 읽을때 좌>우로 읽어. 진행칩의 하이라이트도 좌>우로 이동해야 해."*
설계 검토에서 나온 세 후보가 **전부 '다음 보기' 우선이었고 전부 물렸다.** 상세는 `ActiveState.tsx` 주석.

## 도메인 로직 (`src/lib/`)

### 음성 파이프라인

| 모듈 | 역할 |
|------|------|
| `speech.ts` | `SpeechController` — STT 수명주기 · TTS · 뮤트/재시작 보장 |
| `useVoiceSession.ts` | 세션 오케스트레이션 (가장 큰 모듈 — 아래 §크기 참조) |
| `voiceFinalResolver.ts` | `resolveFinal` — final 결과 → 행동을 정하는 **순수 결정표** |
| `useFinalCommands.ts` | `handleFinal`의 **명령 경로** — 경로 판정 → 명령 핸들러 5종 dispatch ([ENV-12] Stage 3 서브 훅) |
| `koreanNum.ts` | 한글 수사 파서(모호성 판정·실패 사유 계측) · `detectCommand` · `extractModifyValue` |
| `koreanNumTokens.ts` | 수사 표 + 정수/소수부 원시 파싱 — 사유 없이 수 또는 null만 |
| `voiceCommands.ts` | **명령어 SSOT** — 기능당 한 단어, prefix 불변식 |
| `voicePrompts.ts` · `announceColumns.ts` | TTS 문구 조립 |
| `beep.ts` · `beepVariants.ts` | 비프음 |

### 클립 (녹음·트림·포인터)

| 모듈 | 역할 |
|------|------|
| `audioRecorder.ts` | `AudioRecorder` — MediaRecorder 수명주기 · 스트림 회복 |
| `useClipCapture.ts` | 셀 단위 클립 캡처 배선 |
| `audioTrim.ts` | 무음 트림 — **가드레일 ⑤가 이 파일의 계약이다** |
| `clipPointer.ts` | 셀 ↔ 클립 키 연결/해제 |
| `clipsManifest.ts` · `clipPlayer.ts` | 내보내기 매니페스트 · 재생 |
| `micPrerollTap.ts` | 프리롤(발화 앞부분 보존) |

### 데이터·동기화

| 모듈 | 역할 |
|------|------|
| `db.ts` | IndexedDB — 스키마 SSOT(`applyAppSchema`), 클립은 `{buf,type}` 분해 저장 |
| `sync.ts` · `sessionSync.ts` | 시트 append/update · 행 단위 동기화 상태 |
| `sheets.ts` | Sheets API (HTTP 경계 — 토큰/API key 폴백·읽기·append·sparse update) |
| `sheetsInfer.ts` | 시트 표본 → `Column[]` 유추(순수) — `inferColumns` · 리스트 승격 판정 |
| `sheetConnection.ts` | 연결 상태 판정(순수 술어) |
| `legacySyncFlow.ts` · `legacyTargetApply.ts` | target 없는 legacy 세션의 명시 결합 |
| `pastValues.ts` | 과거값 인덱스의 브라우저 사이드 — fetch·모듈 캐시·IDB 폴백·백오프 |
| `pastValuesIndex.ts` | 그 순수 로직 — 샘플키·회차 정규화·인덱스 빌드·직전 회차 조회 |
| `pastValuesPersist.ts` | 그 영속 직렬화 — `PastIndex` ↔ JSON-호환 평면 레코드 |
| `trendCheck.ts` · `trendEvaluate.ts` · `anomalyAlert.ts` | 추세 판정 · **경보 문구 SSOT** |
| `pendingValidation.ts` | 확인 전 값 staging (확정 전 값은 시트로 새지 않는다) |
| `csv.ts` · `exportLog.ts` | 내보내기 |

### 인증·외부 연동

`googleAuth.ts`(GIS OAuth) · `drivePicker.ts` · `driveUpload.ts` · `driveFolders.ts` ·
`recoverFromDrive.ts`(로그 zip 기반 세션 복구) · `feedback.ts`(개선요청) · `screenshot.ts`

### 계측·플랫폼

`logger.ts`(링버퍼 + 영속화) · `logEvents.ts`(**이벤트 문자열 빌더 SSOT** — 바이트 계약,
PRINCIPLES §4) · `wakeLock.ts` · `pwaUpdate.ts` · `inputDevice.ts` ·
`foregroundReturnPolicy.ts` · `hydrate.ts` · `async.ts`

## 상태 (`src/stores/`)

| 스토어 | 담는 것 | 영속화 |
|--------|---------|--------|
| `settingsStore.ts` | 컬럼 설정·시트 연결·음성/경보 옵션 (create·persist 배선·액션) | localStorage persist + IDB 미러 |
| ├ `settingsState.ts` | `SettingsState` 형태 · 기본값 SSOT · 입력값 설정 초기화 패치 | — |
| ├ `settingsStorage.ts` | 저장 매체 — localStorage 1차 + IDB 미러 + 하이드레이션 게이트 | — |
| └ `settingsMigrate.ts` | persist 버전 이력 (🔴 **문장 순서가 계약**) | — |
| `sessionStore.ts` | 진행 중 세션·`VoicePhase` | IDB (`saveSession`) |
| `dataStore.ts` | 열람용 세션 목록 | IDB에서 로드 |

localStorage는 iOS에서 evict될 수 있어 **IDB 미러가 있다**(KNOWN-ISSUES `[AUTH-8]`).
persist 스키마를 바꾸면 마이그레이션이 함께 간다.

## 파일 크기 규약

GL-006 §5 — 권장 150~250줄, 300줄 분리 검토, **500줄이 ESLint `max-lines` 오류 상한**
(`eslint.config.js`). 도입 시점의 기존 초과 파일만 파일 상단 `eslint-disable`로 예외이며
KNOWN-ISSUES `[ENV-12]`가 목록을 관리한다. 현재 예외 **3개**(2026-08-15 실측):

`useVoiceSession.ts`(4228) · `speech.ts`(939) · `audioRecorder.ts`(919)

> 종전 6개 중 `pastValues.ts`·`settingsStore.ts`·`sheets.ts` 3개는 v0.49 R2에서 해소됐다
> (2026-08-15 — 위 표의 leaf 모듈들). 예외 여부의 진짜 SSOT는 각 파일 상단의 주석이다:
> `grep -rln "eslint-disable.*max-lines" src/`

**새 파일은 예외 대상이 아니다.** 예외 파일을 분해하면 `eslint-disable` 주석을 함께 지운다.

## 테스트 (`tests/`)

러너는 Playwright 단일. 서버는 Playwright가 소유한다(포트 5177, `--strictPort`).
프로젝트 2개 — `chromium`(기본)과 `iphone17`(402×874 @3x, `safe-area.spec.ts` 전용).
픽스처 SSOT는 `tests/fixtures/idb.ts`(IDB 규약) · `tests/fixtures/stt.ts`(STT 목) ·
`tests/fixtures/safeArea.ts`(노치 inset 재현).

절차는 [CONTRIBUTING.md](../CONTRIBUTING.md), 반복해서 밟은 함정은
[ENGINEERING-GUARDRAILS.md](../ENGINEERING-GUARDRAILS.md) ⑥.
