# KNOWN-ISSUES — survey-011 함정 지식베이스

> **목적:** 다른 AI(그리고 사람)가 **같은 실수를 반복하지 않도록** 한다. 이 앱(노지감귤 음성 생육조사 PWA)과 그 조상 프로젝트(`growth-survey-010`)에서 실제로 터졌던 버그·함정을 사실 기반·출처 명시로 수확해 모은 살아있는 로그다.
>
> **사용법:** 작업 시작 전에 관련 카테고리를 읽어라. 새 함정을 만나면 같은 형식으로 **append**하고, 기존 항목의 재발이면 해당 항목의 출처에 hash/세션을 덧붙여 병합하라. 추측은 본문에 쓰지 말고 맨 끝 **"확인 필요(미검증)"** 목록에 분리하라.
>
> **출처 표기 규약:**
> - `growth-survey-010@<short-hash>` — 조상 레포 git 커밋.
> - `growth-survey-010 vX.Y.Z` / `survey-011 vX.Y.Z` — **반드시 레포를 명시**한다. 두 레포의 버전 라인이 다르다(조상은 v0.12.0까지, survey-011은 자체 v0.3.0 라인).
> - `debug-log` — `citrus-growth-survey-codex/shared/debug-log.md`.
> - `2026-06-04~05 세션` — survey-011에서 이번에 직접 부딪힌 함정.
>
> **현재 상태 범례:** ✅수정됨(survey-011 코드에 가드 확인) | ⚠️주시(재발 가능/설계상 주의) | ➖해당없음.

---

## 아카이브로 이동된 항목

종결(✅해결·반증·비버그·환경 제약 종결) 항목은 본문에서 [KNOWN-ISSUES-ARCHIVE.md](KNOWN-ISSUES-ARCHIVE.md)로 이동했다. 아래 [ID]가 본문에 없으면 아카이브에서 찾아라(동일 ID가 복수 존재할 수 있으므로 제목까지 대조할 것).

- [STT-1] 200대 한국어 자리값 수사 오인식 ("이백" → 100) → KNOWN-ISSUES-ARCHIVE.md
- [STT-13] iOS Safari Web Speech가 confidence를 비워 반환 → 코드의 `?? 1` 강제변환으로 인식 허용범위 게이트 무력화 → KNOWN-ISSUES-ARCHIVE.md
- [CLIP-1] iOS Safari에서 음성 클립이 IDB에 저장 안 됨 (근본 버그) → KNOWN-ISSUES-ARCHIVE.md
- [CLIP-2] persistSession 타이밍 탓 클립 키 누락 → KNOWN-ISSUES-ARCHIVE.md
- [CLIP-3] stale-epoch 클립이 올바른 클립을 덮어씀 → KNOWN-ISSUES-ARCHIVE.md
- [CLIP-4] AudioRecorder 인스턴스 간 상태 오염 → KNOWN-ISSUES-ARCHIVE.md
- [CLIP-7] Logger 이벤트가 reload 후 소실 (메모리 전용) → KNOWN-ISSUES-ARCHIVE.md
- [LOAD-1] 앱 업데이트 후 "세션이 사라짐" — 실제론 App.tsx 빈 catch가 hydrate 실패를 삼킴 → KNOWN-ISSUES-ARCHIVE.md
- [IOS-1] iOS Safari SpeechSynthesis `onend` 미발생 → advance() 무기한 대기 → KNOWN-ISSUES-ARCHIVE.md
- [IOS-2] TTS watchdog 상태머신 mute/unmute 불일치 → KNOWN-ISSUES-ARCHIVE.md
- [IOS-3] TTS 재생 중 STT가 자기 음성을 phantom 입력으로 잡음 → KNOWN-ISSUES-ARCHIVE.md
- [RACE-1] 정정/명령 후 진행 멈춤 race condition (핵심) → KNOWN-ISSUES-ARCHIVE.md
- [RACE-2] STT 결과가 이전 행에 저장됨 (행 전환 가드 누락) → KNOWN-ISSUES-ARCHIVE.md
- [ALERT-1] 이상치 정정 재측정 시 팝업과 echo TTS 불일치 — 정정 경로가 팝업을 갱신 안 함 → KNOWN-ISSUES-ARCHIVE.md
- [RACE-4] 정정 시 오인식 원본 오디오 유실 → 분석 불가 → KNOWN-ISSUES-ARCHIVE.md
- [RACE-5] 동기화: 업로드 실패 세션을 autoDelete가 삭제 (데이터 손실) → KNOWN-ISSUES-ARCHIVE.md
- [RACE-7] 일시정지(Pause) 상태에서 화면 전환 시 sessionIdRef가 초기화되어 빈 ID 및 startedAt: NaN이 DB에 영속화됨 → KNOWN-ISSUES-ARCHIVE.md
- [CLIP-1] direct modify("수정 <값>") 시 수정한 셀의 음성 클립/재생버튼이 사라짐 → KNOWN-ISSUES-ARCHIVE.md
- [CLIP-VAL-1] 수정 재녹음 중 빈 캡처 → 이전 값 음성이 새 값 셀의 재생버튼으로 남음 (3중 결함) → KNOWN-ISSUES-ARCHIVE.md
- [ENV-3] 버전 테스트 하드코딩 → 버전 bump 시 실패 → KNOWN-ISSUES-ARCHIVE.md
- [ENV-9] settings persist migrate가 시드 trendRule을 삼킴 — Playwright 시드는 최신 version으로 → KNOWN-ISSUES-ARCHIVE.md
- [ENV-5] "세션 리플레이" 클립이 실제론 오디오 전용 (영상 트랙 0) → KNOWN-ISSUES-ARCHIVE.md
- [ENV-6] vite-plugin-pwa peer-dependency 충돌 (조상 초기) → KNOWN-ISSUES-ARCHIVE.md
- [ENV-7] gh-pages 배포 — workflow scope 토큰 거부 → KNOWN-ISSUES-ARCHIVE.md
- [AUTH-1] 백업 실패 시 자동삭제 게이트 — 추가→제거→복원 (같은 날 뒤집힘, 핵심 교훈) → KNOWN-ISSUES-ARCHIVE.md
- [AUTH-2] 미동의 세션 오디오/이벤트 데이터 유출 → KNOWN-ISSUES-ARCHIVE.md
- [NAV-1] "다음" 건너뛰기 후 완료된 행으로 반복 복귀하는 루프 → KNOWN-ISSUES-ARCHIVE.md
- [SESSION-LABEL-OPTIONS-1] 세션명 디폴트가 단일선택 옵션 상수를 누락 → KNOWN-ISSUES-ARCHIVE.md
- [LASTROW-AUTOEND-1] 마지막 행 입력 시 자동 종료로 수정 불가 (v0.23.0 변경) → KNOWN-ISSUES-ARCHIVE.md

---

## ① 음성 / STT 파서

### [STT-2] 후치 수정 명령 미감지 ("178.1 정정")
- **증상:** "178.1 정정"처럼 값이 앞, 명령어가 뒤에 오는 발화를 수정 명령으로 인식 못 함.
- **원인:** `detectCommand`가 prefix 패턴만 매칭.
- **해결·회피:** `detectCommand`에 suffix 매칭 추가하되 **숫자로 시작하는 경우만** 적용(오탐 방지), `extractModifyValue`가 prefix/suffix 모두 지원. 단위 43케이스 추가.
- **출처:** `growth-survey-010@a954e05`
- **현재 상태:** ⚠️주시 — **의식적 변경(v0.4.0):** 명령어 단일화로 별칭 `정정` 제거. 후치 정정은 이제 `"178.1 수정"`만 인식(`detectCommand`/`extractModifyValue`). 후치 매칭 자체는 유지되므로 [STT-2] 본 동작은 보존, 단 트리거 단어가 `수정`으로 한정됨. (회귀 `tests/koreanNum.spec.ts`)

### [STT-3] 한국어 노이즈 단어 오인식 (변경/성경/광경 등)
- **증상:** 빗소리·환경음이 `변경`, `성경`, `광경`, `구정`, `혜정`, `당장`, `경정` 같은 단어로 오인식되어 값/명령으로 처리됨.
- **원인:** 짧은 환경 노이즈가 그럴듯한 한국어 단어로 STT됨. 거부 경로 간 일관성 부족(노이즈 거부 시 인식 표시가 안 지워짐).
- **해결·회피:** `KNOWN_NOISE` 정규식 필터로 해당 단어 거부 + 거부 시 `setRecognized('')`로 다른 거부 경로와 UX 일관성 유지. 소음 모드 토글(임계값 0.65→0.80, 1글자 거부)도 도입.
- **출처:** `growth-survey-010@2ed62a5`(F010 노이즈 필터), `growth-survey-010@dcaafea`(소음 모드), `growth-survey-010@79cbf2c`(거부 UX 일관성)
- **현재 상태:** ✅수정됨 (`src/lib/useVoiceSession.ts` `KNOWN_NOISE`)
- **⚠️ 후속(v0.19.0, 소음 환경 모드 제거 — 민구 결정):** 민구 판단(TTS가 인식값을 되읽어 줘 오인식 즉시 식별·소음모드가 오히려 입력 방해) → `noisyMode` 토글·필드·STT 소비처 전부 제거. **부작용:** STT 거부 임계값이 항상 `0.65`로 통일(소음모드의 0.80 상향 + 1글자 거부 방어선 소멸). `KNOWN_NOISE` 필터 + lone-syllable 동음이의 가드(noisyMode 독립)는 **보존**. **주시:** 다음 *실소음(비닐하우스·우천)* 로그에서 garbage-commit/환각단어 커밋률을 관측 — 0.65 통일로 환각 커밋이 늘면 재검토(합성 자가테스트론 노출 불가, 실소음 로그 필요).

### [STT-4] 컬럼명과 같은 STT 값 거부가 text/options 컬럼까지 차단
- **증상:** STT 값이 컬럼명과 일치하면 거부하는 가드가 text/options(자유서술·선택) 컬럼에서도 발동해 정당한 입력을 막음.
- **원인:** 컬럼명 일치 거부 규칙을 모든 타입에 일괄 적용.
- **해결·회피:** 컬럼명 일치 거부를 **숫자·날짜 컬럼에만** 적용, text/options는 제외.
- **출처:** `growth-survey-010@ad60ba5`
- **현재 상태:** ⚠️주시 (survey-011 STT 거부 로직 점검 권장)

### [STT-5] 이상치 상한이 실측 범위보다 좁음 (200대 측정값 오염)
- **증상:** 실측 횡경/종경이 200대인데 검증이 150 초과를 이상치로 표시.
- **원인:** 초기 임시 이상치 범위가 실제 측정 로그보다 좁게 설정됨.
- **해결·회피:** widthMm/lengthMm 이상치 상한을 300으로 완화.
- **출처:** `debug-log`(2026-04-20)
- **현재 상태:** ⚠️주시 (survey-011은 컬럼 스키마가 동적 — 이상치 범위 설정 시 실측 분포 확인)

### [STT-6] 백 단위 "백"이 유사 명사("액", "에봇", "개")로 오인식되어 100 단위가 유실된 채 값 커밋
- **증상:** `177.7`을 입력하려고 `"백칠십칠 점 칠"`이라고 발화했으나 STT가 `"액 77.7"`로 인식하여 백 단위 없이 `77.7`로 커밋됨. `155.5` 입력 시 `"에봇 15.5"` 또는 `"개 95.5"`로 인식되어 `15.5`/`95.5`로 커밋됨.
- **원인:** STT가 leading `"백"`을 유사한 한절 명사로 잘못 인식하고, 파서가 비숫자 토큰을 버리면서 오류가 침묵 커밋됨.
- **해결·회피:** 앞단의 무관한 한절 명사가 "백"과 발음이 유사한 단어("액", "개", "엑", "에봇" 등)이면 ambiguous 처리하여 재질문하거나 기대 범위 오차 임계(이상치) 검사 적용 필요. **v0.5.0 가드(부분):** 같은 계열의 "유실된 채 침묵 커밋" 경로 2종을 차단 — ① 유효 숫자 토큰 2개 이상이면 `null`(재질문), ② `정수 + 점 + 비숫자 잔여`(소수부가 비숫자로 오인식)도 `null`(재질문). 단 leading "백"이 통째로 비숫자 1토큰으로 오인식되는 원형 케이스는 여전히 커밋될 수 있음.
- **출처:** `2026-06-05 세션` (실기기 로그 분석); `2026-06-10 실기기 로그` — **수정 경로 재발(소수부 유실형)**: `"111 점 에"`로 인식돼 소수부가 비숫자로 유실된 채 정수 `111`만 침묵 커밋됨; `2026-06-11 실기기 로그` — **v0.5.0 소수부 가드 작동 확인**: `"111 점 에"`·`"300 점 부다"` 둘 다 `stt_parse_failed:decimal_fraction_lost`로 **재질문**(침묵커밋 안 함) → 정상값 커밋. **단 점-없는 잔여형 잔존**: `"277 정체"`(row14, 277.7 의도)는 `점`이 없어 가드 밖 → 정수 `277` 커밋(사용자가 직후 수정으로 277.7 정정). 정수+무관 비숫자 토큰형은 미차단; `2026-06-12 분석`(06-11 v0.6.0 실기기 로그) — **점-없는 잔여형 재발 2건**: `"제17.7"`→`17.7` 침묵 커밋(의도 77.7, 선행 음절 유실)·`"현백 33.3"`→`33.3` 침묵 커밋(의도 333.3) — 둘 다 사용자가 수정 명령으로 즉시 정정(누적 4건, 빈도 상승 → v0.7.0 가드 승격 후보).
- **현재 상태:** ✅수정됨(점-없는 잔여형 가드, **survey-011 v0.7.0 STT-C**) — 단일 숫자 + 무관 비숫자 잔여 토큰("제17.7", "현백 33.3")은 ambiguous(`null`) 처리해 재질문(`stt_parse_failed:extraneous_token`). 단위어·조사·기존 커밋 보장 어휘는 의도적으로 좁은 화이트리스트(`HARMLESS_RESIDUAL_TOKENS`, `src/lib/koreanNum.ts`)로 통과시켜 "당도 8" 류 정상 커밋은 유지. 침묵 커밋 3계열(multi_numeric·decimal_fraction_lost·extraneous_token) 모두 재질문으로 전환 — STT 오인식 자체는 잔존([STT-10] 화이트리스트 정밀도 관측). 회귀 `tests/koreanNum.spec.ts`.
- **`2026-06-15 v0.8.0 실기기 로그`(decimal_fraction_lost 재발 ×5):** 소수점 뒤 숫자가 조사로 오인식되는 `decimal_fraction_lost`가 한 세션 5회(`"11 점 의"`·`"211 점에/점 의/점 에"`). **가드는 정상 작동**(전부 `stt_parse_failed`로 재질문, 침묵 커밋 0) — 즉 *데이터 유실은 없으나* 같은 소수 발화를 STT가 반복 실패해 사용자가 재발화하는 **마찰**이 빈발. STT 엔진(ko Web Speech) 한계라 코드 수정으로 근절 불가. 재질문 문구는 적정. 빈도 관측 지속(조기확정[딜레이] 토글과는 독립).
- **✅ `2026-06-17 v0.11.0 실기기 로그`(비 오는 비닐하우스 — 가드 스택 실전 소음 스트레스 통과):** 빗소리·잔향이 다량 유입된 실전 최악 소음에서 STT가 `"뮤직"`·`"보리 9.9"`·`"미래 11 편에"`·`"다시다 점 사"` 같은 명백한 환각 음절을 인식했으나 — **garbage 값 커밋 0건·환각 명령 0건·저신뢰(<0.5) 커밋 0건.** 모든 환각이 거부 레인(`stt_parse_failed`/`ambiguous_syllable`, L1:4·6 / L2:11)에 머물고, 명령 26건은 전부 정당한 `confirm`(median conf 0.98). multi_numeric·decimal_fraction_lost·extraneous_token 3계열 가드 + 신뢰도 게이트가 **현장 폭우에서 데이터 무결성 유지**를 입증. (향후 회귀 가시화용 확인된 양호 동작.)
- **✅ `2026-06-29 v0.23.0 실기기 로그`(가드 재확인, n=1):** decimal_fraction_lost×3·multi_numeric×3·extraneous_token×1 = 숫자파싱 마찰 7건 + 저신뢰 거부 3건 = **재질문 10건(value 40 중 25%)**. **전부 재질문 전환·침묵 커밋 0·데이터 유실 0** — 가드 정상. v0.23.0 신규 `stt_parse_failed` 유형 세분 로깅으로 마찰 유형별 빈도 가시화. 근절 불가(ko Web Speech 한계) 재확인 — 입력 효율 저하의 주원인이나 정확성은 보존.

### [STT-7] 수정 명령 `"수정"`이 `"수변"` / `"수 벽"`으로 오인식되어 무시되거나 파싱 실패
- **증상:** 수정하고 싶을 때 `"수정"`이라고 말했으나 STT가 `"수변"`으로 오인식하여 TTS가 켜져 있어 차단(`stt_blocked_tts_muted`)되거나, `"수 벽"`으로 오인식하여 파싱 실패(`stt_parse_failed`)되어 정정 진입이 안 됨.
- **원인:** `detectCommand`가 `"수정"`, `"정정"`만 완벽히 매칭하기 때문.
- **해결·회피:** **방향 전환(민구 결정 v0.4.0):** 동음이의 별칭(`수변`/`수벽`)을 하드코딩하면 false-positive(`수변`=水邊) whack-a-mole이 된다. 대신 **명령어를 기능당 단일 단어로 통일**(`src/lib/voiceCommands.ts` SSOT)하고, 도움말 팝업·TTS가 그 단어(`수정`)를 학습시킨다. 오인식은 별칭을 늘리는 대신 텔레메트리로 관측해 사후 보정한다. (활용형 꼬리 `수정해줘`는 startsWith로 허용.)
- **출처:** `2026-06-05 세션` (실기기 로그 분석) → **survey-011 v0.4.0** 정책 전환
- **현재 상태:** ⚠️주시 (단일화로 마찰 완화 — STT 엔진 오인식 자체는 잔존, 필드 텔레메트리로 추적)

### [STT-8] "구십"(90)과 "오십"(50)의 한국어 발음 혼동
- **증상:** `99.9`를 입력하려고 발화했으나 STT가 `"59.9"`로 연속 인식하여 정정 왕복 발생.
- **원인:** 한국어 숫자 발음의 유사성으로 인한 STT 엔진의 한계.
- **해결·회피:** 이상치 필터링 또는 사용자 확인 등 UX 보완 필요.
- **출처:** `2026-06-05 세션`
- **현재 상태:** ⚠️주시
- **`2026-07-02 v0.25.0 실기기 재발`(×2+유사계열):** S1 r5 c7 의도 99.9가 "59.9"로 연속 2회 인식(conf 0.947/0.872) — 둘 다 커밋됐으나 **범위알람이 즉시 포착**해 99.9로 정정. 같은 세션에서 유사 계열("95.5"↔55.5 의도, "8.8"↔88.8 의도)도 전부 범위알람 정정. STT 엔진 한계 잔존이나 **범위알람이 실전 방어선으로 작동** 확인(침묵 유실 0).

### [STT-9] 저신뢰(confidence) "수정" 발화가 임계값에 걸려 거부됨 (T-12 잔존)
- **증상:** "수정"이라고 말했으나 STT confidence가 낮게 산출되어 명령이 거부됨. v0.4.3에서 수정 명령 전용 임계값을 0.55로 낮췄으나(T-12), 이후에도 드물게 재발.
- **원인:** STT 엔진이 또렷한 발화에도 낮은 confidence를 산출하는 경우가 잔존 — 엔진 한계.
- **해결·회피:** 임계값 추가 인하는 노이즈 오탐([STT-3]) 위험과 트레이드오프 — 현행 0.55 유지하고 텔레메트리로 빈도 관측 지속.
- **출처:** `survey-011 v0.4.3`(T-12 임계값 0.55 도입); `2026-06-10 실기기 로그` — 저신뢰 거부 재발 1건 관측(세션 480 이벤트 중 1건, 빈도는 크게 완화된 상태). `2026-06-15 v0.7.0 실기기 로그` — 저신뢰 거부 2건("수정" conf .28 id48 / "유지" conf .29 id323), 둘 다 재발화로 즉시 복구. 빈도 완화 상태 유지.
- **현재 상태:** ⚠️주시

### [STT-10] STT-C 재질문 가드의 융합 잔여 토큰 — 단위어+조사 융합형("밀리요", "프로요", "mm입니다")은 현재 재질문됨
- **증상:** v0.7.0 STT-C 가드(`extraneous_token`)의 화이트리스트(`HARMLESS_RESIDUAL_TOKENS`, `src/lib/koreanNum.ts` 161~172)는 단위어·조사를 **개별 토큰**으로만 통과시킨다. STT가 단위어와 조사를 한 토큰으로 융합하면("33.3 밀리요", "8 프로요", "20.5 mm입니다") 화이트리스트 밖이라 정상 발화도 재질문된다.
- **원인:** 의도적으로 좁은 화이트리스트 — [STT-6]의 선행 음절 오인식("액", "제", "현백" 등)을 통과시키지 않는 것이 우선이라, 융합형을 선제 추가하면 침묵 커밋 구멍이 다시 열릴 위험.
- **해결·회피:** 재질문은 안전한 쪽 실패(값 유실 없음). **다음 실기기 로그 분석에서 `extraneous_token`의 정밀도/재현율을 측정한 뒤** 화이트리스트 확장(또는 "단위어 prefix + 조사 suffix" 분해 매칭)을 결정한다 — 측정 전 확장 금지.
- **출처:** `2026-06-12 v0.7.0` Codex 교차점검(watch-item); `2026-06-15 v0.7.0 실기기 로그` — **정밀도 측정 n=1: true positive**(`"우정 77.7"` row4 → `extraneous_token` 재질문 → 재발화로 정상 커밋, 정상 발화 오탐 아님). 융합 토큰("밀리요" 류)은 이번 세션 미발생. **화이트리스트 확장 보류 방침 유지**(샘플 더 필요).
- **현재 상태:** ⚠️주시 (텔레메트리 관측 우선 — 필드 로그에서 `stt_parse_failed:extraneous_token` 빈도·오탐 수확)

### [STT-11] 음성입력→TTS 출력 체감 딜레이 = 브라우저 무음 종료감지(EOS), 앱 처리는 ~1ms
- **증상:** 민구 — "음성 입력 후 안내 음성까지 딜레이가 느껴진다, 줄여달라."
- **진단(2026-06-15 v0.8.0 로그):** TTS 이벤트의 `ts`는 발화 *종료* 시점(durationMs 보정 필요). 보정하면 **STT 최종인식 → TTS 발화시작(앱 처리) = 중앙값 1ms / p90 2ms** — 앱 파이프라인(추세검사·클립정지·persist 포함)은 발화를 거의 막지 않는다. TTS 큐 지연(`startDelayMs`)도 중앙값 28ms. **체감 딜레이는 전적으로 브라우저 Web Speech API의 무음 종료감지(말 멈춤 → `isFinal`)**. iOS Safari 특성상 0.5~1.5s 추정이나 **현 로그엔 interim 타임스탬프가 없어 미측정.**
- **해결·회피:** 앱 코드의 유일한 레버 = interim(중간) 안정화 기반 **조기확정**. v0.9.0: ① (무위험) `stt_eos_tail` 계측 — 마지막 interim → final 간격을 `stt` 이벤트에 동봉해 다음 로그에서 EOS 꼬리 정량화. ② (실험, **기본 OFF**) 설정탭 "빠른 인식" 토글 — interim 숫자가 `EARLY_COMMIT_STABLE_MS=400` 안정되면 final 대기 없이 커밋(`restartRecognition`으로 in-flight final abort → 이중 커밋 방지), `stt_early_commit` 계측. 절단(소수점 추가 전 커밋) 리스크가 있어 실기기 A/B 후 채택 결정.
- **출처:** `2026-06-15 v0.8.0 실기기 로그` 분석(민구 요청).
- **현재 상태:** 🔬계측+실험 (default off) — 다음 로그의 `stt_eos_tail`(EOS 꼬리)·토글 ON 시 `stt_early_commit` 절단/정정율로 가치 판단.
- **`2026-06-19 v0.14.0 실기기 로그`(빠른인식 존치 판단):** fastRecognition ON인데 `stt_early_commit` **0건**, eosTail median ~1.7–1.9s(마찰 실재하나 조기확정 한 번도 안 걸림). 현 계측으론 'wired-but-never-fired(소음이 interim 안정화 차단=정상) vs 미배선(버그)' 구분 불가 → 민구 결정 **옵션 유지(기본 OFF, 제거 안 함) + 계측 1회**. **v0.15.0 A8 계측 추가:** early-commit **시도** 가시화(`stt_early_commit extra:'attempt:armed:<v>' / 'attempt:reset:new_interim/parse_null/final_first' / 'attempt:cancel:tts_muted'`) — 상태 전이 시에만 기록(폭주 방지), fastRecognition OFF면 무발화. 다음 fastRecognition ON 현장 로그에서 `attempt:armed` 출현=배선 확정(미발동은 소음 탓 정상), `attempt` 0건=미배선 의심. 그 결과로 존치/수정/제거 확정.
- **`2026-06-17 v0.11.0 실기기 로그`(비 오는 비닐하우스, 재분류):** fastRecognition(빠른 인식) **ON**인데 `stt_early_commit` **0건**, eosTail median 1716(L1)/1810ms(L2). 처음엔 "조기확정 미배선" 의심했으나, **현 텔레메트리로는 '소음이 interim 안정화를 막아 조기확정 미발동'(정상)과 '미배선'을 구분 불가**(interim/early-commit 시도 이벤트 부재) → **instrumentation-gap으로 재분류**(behavior-bug 단정 금지). eosTail이 신뢰도와 무관하게 일률적으로 김(소음 분산 신호 아님 = 고정 EOS 타임아웃 정황). 단 `eosTailMs` 존재 자체가 interim 발화 증거라 iOS interim 미지원 가설은 약함. **v0.12.0 조치:** speakerphone near-miss(가드 통과·250~500ms band) msSinceTtsEnd를 기존 stt 이벤트에 동봉(계측) — 다음 현장 로그에서 EOS/가드 정량화. 조기확정 가치 판단은 fastRecognition ON 상태 현장 로그 누적 후.

### [STT-12] OpenDots 외장 마이크가 선택 가능해도 6세션 연속 내장 마이크만 잡힘 — **종결→소음 성능저하로 완화**
- **증상:** `device.json`에 OpenDots ONE by Shokz가 audioinput으로 열거되나, `session.input_device`는 6세션 연속 `iPhone 마이크`(내장). 외장 마이크가 실제 입력으로 선택되지 않음.
- **원인:** 앱은 `getUserMedia` 기본 장치를 쓰며 장치 선택 UI가 없다. OpenDots(골전도 이어폰) 마이크 자체가 iOS 입력 기본으로 승격되지 않거나 페어링/오작동. 6세션 연속 동일 → 기기/이어폰 측 문제로 판단.
- **현재 상태:** ✅종결(민구 확인, 2026-06-16) — 이어폰(OpenDots) 마이크 오작동으로 확정. 앱 코드 조치 없음.
- **`2026-06-17 v0.11.0 로그`(완화):** Log2에서 OpenDots ONE이 **실제 입력 장치로 선택됨**(`session.input_device`=OpenDots) — "내장만 잡힘"과 대비. 단 비 오는 비닐하우스 소음에서 내장 마이크(L1)보다 **성능 저하**: `stt_parse_failed` L1:4 vs **L2:11(2.75×)**, 커밋 신뢰도 floor 0.820 vs 0.679. → "이어폰 오작동"이라기보다 **소음 환경 마이크 성능 저하**(완주는 함, 18행 43커밋). v0.12.0 입력장치 배지가 어떤 마이크로 듣는지 표시(🎧 블루투스 vs 📱 내장)해 사용자가 인지 가능. 소음 현장 내장 마이크 권장은 백로그(AUDIO-INPUT-1, n=1이라 2차 표본 후).

### [AUDIO-INPUT-2] 입력장치 배지가 음성입력 중 장치 변경(블루투스 해제 등)을 반영 못 함 — frozen 라벨
- **증상(민구 제보):** "음성 입력 시작 전엔 배지에 입력 기기가 반영되는데, 입력 중 OS에서 블루투스를 끊으면 상단 배지가 그대로 멈춰 있다."
- **원인(코드 추적 확정):** 배지 라벨은 `init()` 시 `getUserMedia` 트랙의 `track.label`을 1회 스냅샷한 **불변값**(`audioRecorder.ts` `activeInput`)이었다. `VoiceScreen`의 300ms 폴링은 그 frozen 필드를 반복해서 다시 읽을 뿐이고, `navigator.mediaDevices` `devicechange`/트랙 `ended`·`mute` 구독이 전무했다. 라벨이 새로 잡히는 유일한 순간은 새 `AudioRecorder` init(=start/resume)뿐 → "시작 전/재개 시엔 반영, active 중 변경은 미반영"이라는 증상과 정확히 일치.
- **해결·회피(v0.13.0 R8):** init 성공 직후 `devicechange` + 활성 트랙 `ended`/`mute`/`unmute`를 **구독**하고, 신호 수신 시 **비파괴 `enumerateDevices` 재읽기**로 `activeInput.label`을 갱신. 재-`getUserMedia`는 금지([IOS-5] 종결 정책 + 진행 중 클립 손실 회귀 방지) — 라벨만 다시 읽는다. 활성 장치가 목록에서 사라지거나 트랙이 `ended`면 라벨을 비워 `classifyInputDevice`가 자연히 '📱 내장'으로 폴백(BT 끊김→내장 표시). `dispose()`에서 리스너 해제(track.stop의 ended가 핸들러를 깨우지 않도록 stop 전에 detach). **주의(코드리뷰 R8):** `track.muted`는 '장치 분리'가 아니라 일시 인터럽션(통화/Siri/라우트 변경)이므로 라벨을 비우는 조건에서 **제외**한다(BT 연결 중 일시 mute에 '내장' 깜빡임 방지) — 진짜 분리는 `ended`+enumerate deviceId 부재로만 판정.
- **출처:** `2026-06-18 세션`(민구 제보) → **survey-011 v0.13.0** 수정
- **현재 상태:** ✅수정됨 (`src/lib/audioRecorder.ts` attach/detachDeviceListeners·refreshActiveInputLabel) — **iOS Safari PWA에서 active getUserMedia 중 `devicechange`/track `ended` 실제 발화 여부는 device 확인 필요**(미발화여도 no-op이라 회귀는 없음).
- **⚙️ 후속(v0.18.0, 배지 표시 삭제 — 민구 결정):** 수차례 수정에도 입력장치 배지가 현장에서 정상 동작 안 함(비대칭 미반영 등) → **시각 배지만 제거**. `VoiceScreen.tsx`의 `InputDeviceBadge` 컴포넌트·렌더·`getActiveInputLabel` 폴링 제거. **복구 로직은 불가침으로 보존** — `audioRecorder.ts`의 `recoverStream`/`attachDeviceListeners`/`handleDeviceChange`/`refreshActiveInputLabel`·`getActiveInputLabel` 메서드는 그대로 둠(CLIP-LOSS-1 클립 복구가 의존). `src/lib/inputDevice.ts`/`classifyInputDevice`는 `tests/inputDevice.spec.ts`가 참조하므로 **삭제하지 않음**(미참조 조건 미충족). 즉 "어떤 마이크로 듣는지" 표시는 사라졌지만 BT↔내장 전환 시 클립 복구 동작은 유지.
- **⚠️ 후속(v0.14.0 D):** v0.13.0 후 민구 보고 — BT→스피커폰→BT 재전환 시 **2번째 BT 복귀가 배지에 반영 안 됨**(비대칭). 비파괴 enumerate는 같은 deviceId/라벨이면 변화를 못 잡는 한계. v0.14.0에서 `handleDeviceChange`가 **유휴 중(녹음 아님) 장치변경 시 스트림 재획득**(recoverStream)으로 실제 활성 장치를 다시 잡아 배지를 갱신([CLIP-LOSS-1]와 동일 경로). 녹음 중엔 비파괴 라벨 갱신 유지(클립 보호). 비대칭 원인은 실기기 재검증 필요.
- **⚙️ 후속(v0.19.0 W7, 입력장치 실시간 로깅 — 민구 요청):** v0.18.0 로그가 **BT·스피커폰을 실제로 썼는데도 두 세션 모두 "iPhone 마이크"**로만 기록(B-1 갭) → 분석 시 입력 경로 식별 불가. 라벨이 실제 변할 때만(`old !== new`) `audioRecorder.ts`가 `session`/`input_device_changed:<reason>:<oldCat>→<newCat>` 이벤트 방출(refreshActiveInputLabel·recoverStream 전이점, `classifyInputDevice` 카테고리 동봉). 신규 이벤트 타입은 안 만들어 **log-replay 호환**. **한계(명시):** iOS는 STT(Web Speech)가 자체 오디오 캡처라 클립 레코더(getUserMedia)의 `track.label`이 STT 실제 경로와 다를 수 있어, **BT 연결돼도 "내장"으로 찍힐 수 있음** — 계측 신호는 늘지만 BT/내장 완전 구분은 [IOS-5]/AUDIO-ROUTE-1(네이티브 셸) 영역. **실기기 검증:** 세션 중 BT↔스피커폰 전환 시 이벤트 출현 여부 + device.json `audioInputDevices` 열거 대조.
- **🔴 2026-06-30 v0.24.0 실기기 2세션 — BT/스피커폰 구분 불가 재확인:** 민구가 S1 BT·S2 스피커폰(일부 BT)을 썼으나 양 세션 `session:input_device`=`"iPhone 마이크"`+동일 deviceId, `input_device_changed` **0건**. 클립 레코더 track.label이 STT 실경로와 달라 BT 미반영 — 텔레메트리로 입력경로 식별 불가([STT-13]/W7 한계, AUDIO-ROUTE-1 네이티브 셸 영역).
- **🟢 2026-07-02 v0.25.0 실기기 — BT 라벨 첫 포착(부분 해소):** S2 세션메타 `session:input_device`가 **`OpenDots ONE by Shokz`**(deviceId 24A69DAA…)로 기록됨 — 06-30 "BT 써도 iPhone 마이크로만 기록" 갭과 대비, BT/내장이 세션 라벨 수준에서 처음 구분됨(S1은 iPhone 마이크). 원인은 v0.25.0 기능2 mic prewarm이 세션 시작 전 getUserMedia를 선점해 실제 활성 장치를 잡는 영향으로 **추정(확인 필요)** — STT(Web Speech) 실경로와의 일치 여부는 여전히 미보증([STT-13] 한계 자체는 유지).

### [STT-14] TTS 연발 중 인식기 재시작 예약이 취소돼 STT가 **영구 사망** — "이전" 명령 후 앱 사용 불가
- **증상(v0.31.0 실기기, 2026-07-09):** "이전" 음성 명령(conf 0.883, 정상 처리) 직후 수정 모드 재안내 TTS가 연달아 나온 뒤, **세션 종료까지 약 5분간 STT 이벤트 0건** — 어떤 음성 명령도 인식 안 됨. TTS·클립 레코더·터치 버튼은 전부 정상(사용자는 터치로만 진행하다 종료). `ui_suspend` 0건(v0.31.0 도움말 suspend와 무관), BT 끊김은 사망 4분 뒤(무관).
- **원인(코드 확정, 2중 결함):** iOS는 TTS 재생 중 SpeechRecognition을 죽인다. 인식기 `end` 시 `onEnd`가 100ms 재시작을 예약하는데, **모든 TTS 발화 시작 시 호출되는 `muteForTts()`가 그 예약을 무조건 취소**하고 `unmuteForTts()`는 재예약하지 않음(`speech.ts`) — 죽은 인식기는 다시 `end`를 못 내므로 회복 경로가 없다. "이전"(reentry)은 유일하게 행 안내+필드별 재안내 **연속 TTS 버스트**를 내는 경로라 이 레이스에 집중 노출(단 취약점 자체는 모든 TTS 경로 공통). 보조 결함: `scheduleRestart()` 타이머 본문의 `rec.start()` 예외를 catch가 삼키고 재시도 없음("try again next tick" 주석과 달리 재시도 부재).
- **해결·회피(v0.32.0):** ① `muteForTts()`가 예약을 취소하면 `restartPendingAfterTts`로 기억 → `unmuteForTts()`에서 재예약. ② start() 예외 시 backoff(×2, 상한 5s, 무제한 — 재시도 상한을 두면 사망 경로가 재생김) 실재시도. ③ **워치독**(4s 간격): active인데 인식기가 안 돌고 예약도 없으면 강제 재시작 — `stop()`에서 함께 해제되므로 v0.31.0 `suspendRecognitionForUi`와 충돌 불가. ④ stale-instance 가드(버려진 인식기의 늦은 이벤트가 이중 재시작 못 하게). ⑤ **lifecycle 텔레메트리 신설**(`stt`/`extra:lifecycle:*`): `restart_cancelled_by_mute`(사망 시그니처)·`restart_resched_after_tts`·`restart_retry`·`watchdog_restart`·`error:<code>`는 항상, start/end는 10s 스로틀. 회귀 `tests/speech-lifecycle.spec.ts`(유닛 6케이스).
- **교훈(계측):** 이 사망은 기존 텔레메트리로 직접 관측 불가였다(인식기 lifecycle 이벤트 전무) — "STT 이벤트가 오래 없음"이라는 부재 증거로만 추론 가능했다. 다음 실기기 로그에서 `lifecycle:restart_cancelled_by_mute` → `restart_resched_after_tts`(정상 회복) 연쇄와 `watchdog_restart`(좀비 경로 발동) 빈도를 확인할 것.
- **출처:** `2026-07-09 v0.31.0 실기기 로그`(sess_1783570914828) → **survey-011 v0.32.0** 수정
- **현재 상태:** ✅수정됨 — **실기기 검증 완료(2026-07-14, v0.33.0)**: "이전" 음성 명령 7회 사용 후 STT 즉시 생존, `watchdog_restart` 0건, `restart_cancelled_by_mute`→`restart_resched_after_tts` 정상 회복 연쇄 확인. 종결.

### [STT-15] 소수 재질문 중 STT alternative 전체값이 오커밋 ("하나"→"1")
- **증상(v0.32.0 실기기, 2026-07-13):** 소수부 재질문(`decimal_fraction_lost`) 대기 중 조각 발화가 저신뢰로 거부되면서 `stt_alt_used` 폴백이 **재질문 문맥을 무시하고 alt 전체값을 커밋**("하나"의 alt "1"이 소수부가 아닌 정수 1로 커밋).
- **해결·회피(v0.33.0):** 재질문 대기 중엔 소수부 문맥 강제 — alt 수용도 fractionWhole 합성 경로로만. 결정론 테스트 고정.
- **출처:** `2026-07-13 실기기 로그` → v0.33.0 수정 → **실기기 검증 완료(2026-07-14)**: "311 점에"→311.1, "111 점 에"→111.1 회복 2/2, 07-13 회귀 입력 "211 점 의"가 211.1 정상 커밋(완전 A/B).
- **현재 상태:** ✅수정됨·검증 완료. **단 alt 폴백의 구조적 함정은 [STT-ALT-1]로 일반화** — 이 항목은 lost 계열 봉합만.

### [STT-16] 탭 전환 시 VoiceScreen unmount로 STT 영구 사망
- **증상(v0.32.0 실기기, 2026-07-13):** 입력 세션 중 데이터탭 등으로 이동하면 VoiceScreen이 unmount되며 인식기·클립 레코더가 파괴 — 복귀해도 재시작 안 됨.
- **해결·회피(v0.33.0):** **keep-alive 렌더**(세션 활성 중 VoiceScreen unmount 금지, 비활성 탭은 display:none) + `visibilitychange`/`pageshow`에서 `kick()` + 트랙 판정 정밀화(ended만 래치). `App.tsx` 주석 + `tests/stt16-tab-keepalive.spec.ts`.
- **출처:** `2026-07-13 실기기 로그` → v0.33.0 수정 → **실기기 검증 완료(2026-07-14)**: 탭 왕복(09:21:35→39) 후 무조작 재개, `kick_result:vis:running`, `mic_track:muted→unmuted` 회복.
- **현재 상태:** ✅수정됨·검증 완료. 파생 효과: 세션 중 어느 탭에서든 useVoiceSession 신호 배선 가능(v0.34.0 피드백 모달 suspend가 이 성질에 의존).

### [STT-17] 긍정 응답어("예/네")가 수사로 오커밋 — "예"→4
- **증상(v0.33.0 실기기, 2026-07-14):** 값 대기 중 "예"(conf 0.729) 발화가 `stt_alt_used` alt "네"를 거쳐 **수사 4로 커밋**(09:34:59). 알람 있는 컬럼이라 잡혔지만, 알람 없는 컬럼이면 침묵 오염 경로.
- **원인:** "네"는 한국어 수사 4의 정당 표기(네 개)라 파서는 4로 파싱 — 문제는 값-대기 문맥에서 **단독 응답어**를 값으로 수용한 것.
- **해결·회피(v0.34.0):** `koreanNum.ts` `isBareResponseWord`(예/네/응/어/넵 등) 신설 — **파서 불변**(네/사 수사 계약 보존), 차단은 handleFinal 값-대기 가드에서 primary·alt 모두 재질문(`stt_rejected_ambiguous_syllable`+`response_word`). trendConfirm 확인 응답('확인'/'유지')과 무충돌.
- **출처:** `2026-07-14 실기기 로그`(S2 r1c8) → v0.34.0 수정. 회귀 `tests/koreanNum.spec.ts`·`correction-flow.spec.ts`.
- **현재 상태:** ✅수정됨(v0.34.0) — 실기기 검증 대기.

### [STT-18] 알림음 등 오디오 세션 점유 후 인식기가 **좀비(started-but-silent)로 영구 사망** — recRunning=true인데 onresult 0건
- **증상(v0.35.3 실기기, FB#3):** iOS 실기기에서 문자 수신음 등이 오디오 세션을 점유하면 `webkitSpeechRecognition`이 `error:audio-capture` 발생. 이후 `end→restart_scheduled→start`로 fresh 인스턴스가 **start까지 성공(recRunning=true)** 하지만 `onresult`를 0건 방출하는 좀비가 된다. 한 세션은 40초 내 자동 회복 ✅, 다른 세션은 **57초간 onresult 0건**으로 영구 사망(사용자 포기) ❌. 파형(audioRecorder의 별도 getUserMedia 스트림)은 계속 작동 → STT만 죽음.
- **원인(코드 확정):** [STT-14]의 watchdog/kick은 `if(recRunning) return`으로 조기 종료 → **recRunning=true로 고착된** 좀비는 감지 불가였다. [STT-14] watchdog은 `recRunning=false`(end 후 재시작 예약도 없는) 사망만 봤고, 이 running-but-silent 케이스는 사각지대였다. fresh 인스턴스 재생성(attemptStart)·백오프 ×2 cap 5s는 이미 있었으나 "좀비 감지" 하나가 부족했다.
- **해결·회피(v0.36.0):** `speech.ts` SpeechController에 **`lastResultAt` liveness 타임스탬프** 신설 — `onResult`(interim 포함, 가장 이르고 잦은 liveness 증거)와 `onStart`(갓 시작한 무음 인식기 오판 방지 앵커)에서 갱신. 좀비 자격은 실기기에서 확인된 **`audio-capture` 오류 이력 + fresh 인스턴스 결과 0건**으로 한정한다(`no-speech`·앱 `aborted`·권한 오류 제외). `watchdogTick`/`kick`이 이 자격과 유효 stale 임계(연속 실패마다 ×2, 최대 60초)를 모두 만족할 때만 현재 인스턴스 `abort()` 후 fresh 재시작한다. **마이크 재취득 없음**([IOS-5] — STT 인스턴스만 재생성). 기본 임계 `12000ms`는 **device-gated**이며, TTS 중에는 watchdog을 멈추되 `unmute` 때 liveness를 현재로 덮지 않고 **실제 mute 구간만** stale에서 제외해 반복 TTS가 복구를 무기한 미루지 않게 했다. 텔레메트리 `lifecycle:zombie_restart:stale_ms=<N>,n=<streak>`(항상 기록)는 `logEvents.ts` 빌더로 바이트 계약을 고정한다. 회귀 `tests/speech-lifecycle.spec.ts`가 audio-capture 양성·비자격 오류 3종·정상 무음·interim liveness·백오프·반복 TTS를 고정한다.
- **출처:** `2026-07-xx v0.35.3 실기기 로그 FB#3` → **survey-011 v0.36.0** 수정.
- **현재 상태:** ✅수정됨(v0.36.0) — **실기기 검증 대기**: 다음 로그에서 `lifecycle:error:audio-capture`→`zombie_restart:stale_ms=<N>,n=<streak>`→회복(onresult 재개) 연쇄 + 비자격 오류/정상 무음의 zombie_restart 0건 + 기본 임계 튜닝 필요성 확인.

### [STT-ALT-1] `stt_alt_used` 폴백이 primary 재질문 가드의 **우회로** (구조적 함정)
- **증상:** primary가 재질문 가드(`decimal_fraction_lost` 등)에 걸려도, alts 루프가 문맥 없이 alt를 수용하면 재질문이 무산되고 잘못된 값이 침묵 커밋된다. 실사례 2건: [STT-15]("하나"→alt "1"), 07-14 "266 점요"(primary lost 재질문 → alt "266" 정수 커밋).
- **해결·회피(v0.34.0):** alts 루프에 소수-의도 게이트(`parseFailReason==='decimal_fraction_lost'`면 소수점 없는 alt skip) + 응답어 alt skip([STT-17]). **일반 교훈: 재질문 계열 가드를 추가할 때는 반드시 alts 루프 게이트를 함께 검토할 것** — primary만 막으면 alt가 우회한다.
- **출처:** `2026-07-14 v0.34.0 세션`(O3 진단 정정 — "점요" 사전 누락이 아니라 alt 우회가 실제 메커니즘이었음).
- **현재 상태:** ✅수정됨(lost·응답어 계열) — 다른 parseFailReason 계열은 전체 재발화 유도라 alt 폴백이 정당(변경 불요).

### [STT-PARSE-1] `extractModifyValue`는 "수정" 뒤 임의 텍스트를 값 후보로 반환 — 컬럼명 지정 신기능의 함정
- **증상:** "수정 <컬럼명>" 류 기능을 값-우선으로 배선하면 컬럼명("종경")이 값 파싱 실패→cascade 오타깃으로 흡수된다.
- **해결·회피(v0.34.0):** reviewWait 스코프에서 **컬럼명 매치를 값 적용보다 먼저** 검사(`extractModifyColumn`, 공백 제거 정규화 — STT가 '초장'을 '초 장'으로 쪼개는 변형 대응). 숫자 발화는 컬럼명과 매치 불가라 "수정 30.7" 경로 무손상. 코드 주석 박제.
- **출처:** `2026-07-14 v0.34.0 세션`(A3 구현 중 발견).
- **현재 상태:** ✅수정됨(reviewWait 스코프) — 향후 다른 스코프로 확장 시 동일 순서 준수.

---

## ② 클립 · IndexedDB 영속화 (최대 광맥)

### [CLIP-BT-1] 블루투스→내장 마이크 전환 시 audio-capture 에러 버스트 + 클립 유실 (세션은 자가 회복)
- **증상(v0.33.0 실기기, 2026-07-14):** Shokz OpenDots 연결 해제로 트랙 ended → `stt lifecycle:error:audio-capture` ×3 + `clip_empty` 2건(r1 c8/c9 클립 유실, **값은 무손실**). `restart_scheduled`로 자가 회복(07-13식 수동 소생 불필요) — 별도 세션 09:35:15 단발도 0초 자동 회복.
- **관련:** [STT-12](OpenDots 소음 성능), [AUDIO-INPUT-2](장치 변경 배지 미반영), [CLIP-3](clip_empty broken pointer).
- **현재 상태:** ⚠️주시 — 값 무손실·자가 회복이라 v0.34.0 수정 없음(등재만). 전환 구간 클립 유실이 반복 관측되면 장치 전환 시 레코더 선제 재획득 검토.

### [CLIP-5] dispose() 시 in-flight 클립 save가 좀비화(hang)
- **증상:** `dispose()` 후에도 onstop 이벤트가 큐에 남아 클립 저장 awaiter가 무기한 대기.
- **원인:** dispose가 pending `resolveStop`을 해소하지 않음.
- **해결·회피:** `dispose`에서 pending `resolveStop`을 null(blob)로 우선 해소. `stop()`은 dispose 전 `Promise.allSettled`로 클립 flush(5초 타임아웃).
- **출처:** `growth-survey-010@e207513` (v5.2 3차, HIGH)
- **현재 상태:** ⚠️주시 (survey-011 `audioRecorder.ts`/`useVoiceSession.ts`에 flush 경로 존재 — 회귀 권장)

### [CLIP-6] 음성클립 동시 재생 (순차 재생 보장 안 됨)
- **증상:** 데이터탭에서 여러 클립이 동시에 재생됨. 화면 밖(언마운트/세션삭제)에서도 재생 지속.
- **원인:** 재생 제어가 단일 큐로 직렬화되지 않음.
- **해결·회피:** 모듈 싱글톤 `clipPlayer`(현재 1개 + 큐)로 직렬화. await 후 stale continuation 가드(current!==key), `clipPlayer.stop()`을 언마운트/세션삭제 시 호출.
- **출처:** `growth-survey-010@fd3177a` (v0.11.2)
- **현재 상태:** ⚠️주시 (survey-011 데이터탭 재생 경로 점검 권장)

### [CLIP-8] IDB 스키마 업그레이드 후 구버전 롤백 시 VersionError
- **증상:** v3로 업그레이드된 디바이스를 구버전(v2) 코드로 롤백하면 `VersionError`.
- **원인:** IndexedDB는 버전 다운그레이드를 허용하지 않음.
- **해결·회피:** 스키마 bump는 **단방향**임을 인지하고 배포. 롤백이 필요하면 마이그레이션 전략 별도 수립. (이 항목은 해결책이 아니라 **주의**다.)
- **출처:** `growth-survey-010@9a9c004` (v5.2 5차, 커밋 본문 경고)
- **현재 상태:** ⚠️주시 (survey-011 DB도 버전드. 스키마 변경 시 동일 위험)

### [CLIP-9] 클립 편집(트림) 시 `decodeAudioData` 실패가 침묵 폴백 — 원본 webm을 트림 성공인 양 저장 (계측 부재)
- **증상(v0.19.0 실기기, Trace 분석):** 비고 "음성클립 편집 실패" 6행 중 3행(이원창 c7 3·4·5)이 `.webm`로 저장(정상은 `.wav` 트림본, `.webm`×3 vs `.wav`×94). 트림이 생략됐는데 **아무 이벤트도 안 남아** 분석에서 원인 불가시.
- **원인:** `audioTrim.ts:378` `decodeAudioData` 실패(소음·코덱·BT 트랙 손상 등) 시 트림을 건너뛰고 원본 webm을 저장하는데, 실패 경로에 로그가 없어 "정상 저장"과 구분 불가.
- **해결·회피(v0.20.0 BL-2):** decode catch에만 `trimFailed`/`trimFailReason` 디스크리미네이터 설정(`raw===null`의 5개 정상 경로와 분리) → `ClipResult`로 전달 → `useVoiceSession` 클립저장 블록에서 `clip_trim_failed:<reason>`(row/colId 컨텍스트) 방출. 저장 blob은 사용 가능한 원본 webm 유지(보수적, 가시화 전용).
- **출처:** `2026-06-24 v0.19.0 실기기 분석` → **survey-011 v0.20.0** 계측
- **⚙️ 하니스 후속(2026-06-24, BL-6 확정):** 루프백 재인식 결과 **편집(트림)은 오디오 무손상**(final 재인식 == raw 재인식 전 케이스 일치) → "음성클립 편집 실패"의 *편집* 프레이밍 기각. 이 `.webm` decode-fail은 **[CLIP-10] 첫값(c7) 클립 truncation의 하위 증상**(짧고 손상된 webm이라 decode까지 실패)으로 재분류.
- **현재 상태:** ⚠️주시(계측만) — `clip_trim_failed` 빈도는 계속 관측하되, 근본은 [CLIP-10]에서 다룸.

### [CLIP-10] 행의 첫 측정값(c7) 클립이 발화를 잘라먹어 재생/재인식 불가 — truncation (라이브 인식은 정상, 클립만 손상)
- **증상(v0.19.0 실기기 하니스, 2026-06-24):** 저장 클립을 앱과 동일 엔진(Chrome Web Speech)으로 재인식 시 **행의 첫 값 c7(횡경) 클립이 전부 ∅**(이원창 3·4·5·14, 강남호 4·13), c8(종경)은 대부분 정상. ffmpeg: c7 클립 **0.80s**(오디오 있음 max −5.4dB)인데 정상 c8은 1.50~1.64s — "이백칠십칠 점 칠"(277.7)이 0.8s면 명백 truncation. 가장자리 절단도 동반(88.8→8.8 앞자리, 288.8→288 끝자리). r14 c7은 `.wav`인데도 ∅ → webm 재생 아티팩트 아님.
- **원인(가설, 코드추적 필요):** **라이브 인식은 정답**(연속 스트림, CSV 전부 일치)이나 **저장 클립이 첫 발화 시작을 못 담음** — 첫값은 TTS 안내 직후라 레코더 arming/프리롤이 발화 시작을 놓치는 정황. c8(둘째값)은 레코더가 이미 안정 가동이라 정상.
- **영향:** **데이터 무결성 영향 없음**(라이브 커밋 정답) — **클립 감사·재생 품질** 문제(나중에 클립으로 값 검증·재청취 불가).
- **해결·회피(방향, 미구현):** 첫값 클립 arming을 TTS 안내 *이전*으로 당기고(W6/[CLIP-LOSS-1] 프리롤 0.5s 계보), 프리롤 버퍼가 첫 발화 시작을 확실히 포함, 클립 경계 패딩 강화(현 `audioTrim` PAD 앞300/뒤180ms가 첫값엔 부족). 가장자리 절단(앞자리/끝소수)도 같은 패딩으로 완화.
- **출처:** `2026-06-24 v0.19.0 하니스 재인식 대조`(BL-6 확정) → 차기 릴리스 백로그
- **현재 상태:** 🔲 미구현(차기) — 데이터 무결성 무관이라 우선순위 Med. `Deliverables/2026-06-24-v0190-real-device-analysis.md` §클립 재인식 대조.

### [CLIP-MIDSPEECH-1] 저장 클립이 발화 *중간*을 잘라 이어붙여 사람이 값을 못 알아들음 — ✅v0.21.0 해결
- **증상(v0.20.0 실기기 2세션, 2026-06-25):** 민구 "인식값은 정상인데 음성클립을 들으면 값을 알 수 없음. 발화 중간을 편집하는 것 같다." 코드 시뮬(`buildKeptRanges` 재현 + raw 클립 72개 분석): `concatRanges`(v0.9.0 CLIP-BLANK-1)가 발화 세그먼트 사이 150ms↑ 무음을 "긴 공백"으로 보고 제거 → **72클립 중 15개(21%)에서 발화 중간을 splice**(각 세션 첫 행 r1c7은 3조각, 2곳 제거). STT 재인식은 갭 제거에 강건해 직전 BL-6 하니스가 클리어했으나, **사람 청취는 splice된 클립을 따라가지 못함** — 하니스가 검증하지 못한 사각.
- **원인:** `audioTrim.buildKeptRanges`가 다중 세그먼트일 때 여러 보존 범위를 반환 → `concatRanges`가 사이 무음을 제거해 이어붙임(CLIP-BLANK-1 의도). 발화 중 자연스러운 멈춤(선언↔값, 호흡)이 잘림.
- **영향:** 데이터 무결성 무관(라이브 STT 정답, CSV 일치). 클립 감사·재청취 품질 문제(민구 직접 청취 불만의 주원인).
- **해결(v0.21.0):** `buildKeptRanges`를 **모든 세그먼트를 감싸는 단일 포괄 범위** `[max(0,min(start)−PAD_FRONT), min(len,max(end)+PAD_BACK)]`로 통합 → `concatRanges` 미도달(splice 0), **중간 무음 보존**, 앞 침묵/TTS·뒤 EOS 꼬리 가장자리 트림만 유지. `concatRanges`/`findSpeechSegments`는 휴면 폴백으로 잔존. KEEP_RATIO·MIN_KEPT_MS 가드 불변. 회귀 `tests/audioTrim.spec.ts`(구 CLIP-BLANK-1 케이스를 중간갭 보존으로 갱신 + 다중세그먼트 단일범위 검증 추가, 20 passed).
- **출처:** `2026-06-25 v0.20.0 2세션 분석`(clip 길이/세그먼트 시뮬) → **survey-011 v0.21.0**
- **현재 상태:** ✅해결 — 다음 실기기에서 민구 클립 청취로 체감 확인.
- **연관:** [CLIP-9](decode-fail 계측, 이번 2세션 `clip_trim_failed` **0건**)·[CLIP-10](첫값 truncation, 별개 메커니즘 — 미구현 잔존). 이번 2세션은 webm decode-fail 없이 전부 `.wav` 트림 성공 경로였고, 청취 불가의 실제 주원인은 truncation이 아니라 **중간 splice**였음.

### [CLIP-BLANK-2] 조용한 클립에서 트림 시작이 실제 값 발화보다 한참 앞에 앵커돼 긴 앞 공백 — ✅v0.24.0 해결
- **증상(v0.23.0 실기기, 2026-06-29 민구 제보):** "일부 클립 전단에 공백이 너무 길다." 누적 실기기 클립 분석(8개 v0.21+ 세션 **287 클립**, 별도 레포 `survey-011-test-harness` Tier1)으로 정량 재현: 값 클립의 **51/287(18%)** 가 트림본 앞에 0.6s↑ 공백, 최악 **10.8s**(`2026-06-23 r5c7`)·`2026-06-29 r3c8` 6.62s·`r4c8` 3.58s.
- **원인:** `findSpeechSegments`의 thr=`robustPeak(97pct)*0.08`이 **조용한/노이즈 클립에서 노이즈 수준으로 붕괴**(예 r4c8 peak 0.023) → 초반 잡음·TTS잔향이 약한 세그먼트로 검출됨. `buildKeptRanges`가 `min(seg.start)`로 앵커하므로 약한 초반 세그먼트 하나가 트림 시작을 loud 값 발화보다 한참 앞으로 끌어당김. (프로덕션 로직을 raw WAV에 복제하면 실제 저장 트림 길이와 **4/4 비트 일치** → decode-path 아님을 확정.)
- **해결(v0.24.0):** `findSpeechSegments`에 **약한 세그먼트 솎기**(`SEG_KEEP_RATIO=0.25`) — 세그먼트별 내부 최대 RMS를 추적해, 가장 강한 세그먼트(값 발화는 또렷이 큼) 대비 25% 미만의 약한 세그먼트를 버린다(2개↑일 때만, 전부 약하면 원본 유지). 단일/동급 세그먼트(정상·소수 재발화)는 불변 → `tests/audioTrim.spec.ts` 20 passed. 효과: 앞 공백 사례 **63→16건, 값 잘림 0건**(287 클립 스윕으로 ratio 결정 — 0.3↑은 값 잘림 6↑건 유발해 0.25 채택). 회귀: 하네스 `clip-regression`이 실제 audioTrim에 누적 raw 클립을 돌려 RED→GREEN·known-good 비퇴행 고정.
- **출처:** `2026-06-29 v0.23.0 실기기 제보` + `survey-011-test-harness` 287클립 분석 → **survey-011 v0.24.0**
- **현재 상태:** ✅해결 — 다음 실기기에서 민구 클립 청취로 체감 확인. 잔여 16건은 대부분 0.4~0.8s(pad+soft 온셋, 비치명적).
- **✅ 2026-06-30 v0.24.0 실기기 2세션 측정 확정:** 값클립 71개(S1 35·S2 36) silencedetect → 앞공백 **max 0.31/0.32s, 0/71 ≥0.6s**(v0.21+ 18%·최악 10.8s 대비 소멸), 잔여 ~0.30s=의도 PAD_FRONT. **값잘림 회귀 0**(`clip_trim_failed` 0/0; 최단 0.70s="100"류 단발). 출처 `Deliverables/2026-06-30-survey-011-v0240-log-analysis.md`.
- **연관:** [CLIP-MIDSPEECH-1](단일범위 통합)과 같은 `audioTrim` 검출부. **데이터-1(소수점 정수부 클립 유실)은 v0.21+ 287클립에서 0건 재현** — CLIP-MIDSPEECH-1 단일범위(splice 0)가 이미 유실 메커니즘 제거. 회귀 가드(`valueDrop` 단언)로만 유지.

### [VALUE-PERSIST-1] 이상치 교정값 미반영 의혹 — 인시던트 데이터 미재현, 진단 우선(v0.24.0)
- **의혹(v0.23.0 실기기, 2026-06-29 민구 제보):** "이상치 알람으로 새 값을 음성입력했으나 데이터엔 옛값, 음성클립만 교정값."
- **인시던트 데이터 검증(2026-06-29 zip, 결정적):** trend_alert_corrected 3건(r3→55.5·r9→188.8·r11→222.2) **전부 새 `value`(parsed=교정값) 이벤트 + persisted `sessions.json` 값도 교정값 일치** → 값 커밋·persist 모두 정상, **미재현**. 값은 `useSessionStore`(setRowValue)→`composeRowValues`→`persistSession`→`useDataStore`(데이터탭 표시) 경로.
- **잠재 경합(이론):** 값 커밋마다 fire-and-forget `persistSession()`이 겹쳐 돌 때 `await saveSession`→`upsertSession` 순서가 뒤집히면 옛 스냅샷이 last-writer-wins로 교정값을 덮을 수 있음(교정 간격 수 초라 이번 미발생).
- **조치(v0.24.0, 방어+가시화):** ① `persistSession` **단조 가드**(`persistSeqRef`/`persistAppliedSeqRef`) — 더 오래된 스냅샷이 최신 dataStore upsert를 덮지 못하게. ② trend 교정 커밋 직후 committed vs persisted 비교 로깅(`trend_corrected_persist_check:ok|mismatch`) → 다음 실기기 재현 시 근인 즉시 포착.
- **현재 상태:** ⚠️주시(진단 우선) — 추측 수정 금지(데이터 정상). 다음 실기기 mismatch 로그로 확정.
- **✅ 2026-06-30 v0.24.0 실기기 2세션 — 미재현·가드 정상:** `trend_corrected_persist_check` **ok×17(S1 4·S2 13)·mismatch 0**. 교차검증: 정정행 persisted=최종 committed(S1 r8c8 `1600→16→166.6` persist=166.6 등). 단조가드 안전·레이스 미발현, mismatch 0=미발생(미포착 아님). 다음 mismatch 시에만 재오픈.

### [STT-DEC-NONBUG] 소수점 복구값 오커밋 의혹 — 1차 증거로 반증(코드 변경 없음)
- **의혹(v0.20.0 분석 1차 패스):** `decimal_fraction_recovered:311.1`이 로그됐으나 셀엔 `하나`가 커밋된 듯 보임(A r16c7, B r11c7=`하나`, B r15c7=`아홉`) → 복구값이 stray STT 단어에 덮이는 레이스 의심.
- **반증(Mack 추론 + Larry 실측 확정):** ① **이 2세션 `sessions.json` 최종 저장값 직접 확인(결정적): A r16c7=`311.1`, B r11c7=`211.1`, B r15c7=`299.9` — 전부 복구된 정답.** `value text='하나'/'아홉'` 이벤트는 복구값 커밋 ~2초 뒤 들어온 stray STT지만 **셀에 살아남지 못한** stale 중간 이벤트(시트 생존 0건). ② 코드상 커밋 경로(`setRowValue`)는 `parseValueForCol` 출력만 쓰고, 소수 복구→커밋이 동기·무await(1300→1373→awaiting=null)라 이후 stray final은 `if(!awaiting) return`에 차단 — 셀 보존이 구조적으로 보장됨. (Mack의 v0.17.0 doc 인용은 다른 세션이라 무효였고, 이 2세션 실측으로 대체.)
- **현재 상태:** ✅반증(없는 버그, 2세션 최종값 실측 확인) — 수정·회귀테스트 추가 안 함.
- **별건 잠재 갭(⚠️주시, 미수정):** `handleInterim`(~1739) 조기확정 경로가 `awaiting.fractionWhole`을 무시 → fastRecognition **ON**이면 소수부 재질문 중 합성값(`311.1`) 대신 bare `"1"` 조기 커밋 가능. **현재 휴면**(fastRecognition 기본 OFF, 실데이터 조기커밋 0건). 차기 트리아지용 기록.

---

### [STORE-1] 앱 업데이트 시 savedSheets(저장 시트 목록)가 비워짐 — async IDB 복원 완료 전 빈 setItem이 미러를 덮음
- **증상(민구 제보, 2026-06-23):** "홈 설치형(설치 앱 아이콘)에서 **앱 업데이트 시에만** 저장된 구글 스프레드시트 링크 목록이 사라진다. 평상시 실행은 유지된다."
- **원인(코드 추적):** persist 스토리지가 `mirroredStorage`(localStorage 1차 + IDB 미러, `settingsStore.ts`). 업데이트 부팅 시 localStorage가 evict되면 `getItem`이 **비동기 IDB 복원 Promise**를 반환하는데, 복원이 끝나기 **전** 부팅 초기 `set()`(인증/컬럼 reconcile 등)이 기본값 `savedSheets:[]`를 직렬화해 `setItem` write-through가 **IDB 미러를 빈 배열로 덮어** 영구 소실. (migrate의 savedSheets 검증 블록은 버그 아님 — 빈 배열 `.every()`는 vacuously true라 강제 초기화 안 함.)
- **해결·회피(v0.19.0 W2):** ① **하이드레이션 게이트** — `hydrationComplete` 플래그 전엔 `setItem`의 IDB write-through 보류(localStorage 1차 쓰기는 유지=동기 동작 보존). `onRehydrateStorage`에서 1회 해제(세 부팅 경로 공통, 기존 `settings_hydrated` breadcrumb와 동일 위치). ② **전용 IDB 레코드**(`db.ts` `saveSheetsRecord`/`loadSheetsRecord`, key `__saved_sheets__`) — saveSheet/removeSavedSheet에서만 써서 bulk write-through에 안 덮임. 부팅 시 settings savedSheets가 비면 이 레코드(+sheetUrl)로 결정론적 복원(`saved_sheets_restored_from_record:N` 계측). ③ persist `version` 9→10. 재현 테스트 `tests/settings-migration.spec.ts`(전용 레코드 복원 red→green 입증).
- **출처:** `2026-06-23 세션`(민구 제보) → **survey-011 v0.19.0** 수정
- **현재 상태:** ✅수정됨(전용 레코드 복원은 단위테스트 입증, 하이드레이션 게이트는 코드추적 정확·레이스 비결정성으로 단위 미커버) — **iOS 실기기 검증 대기.**
- **⚠️ 미검증 전제(다음 세션 분기):** 수정은 "iOS PWA 업데이트 시 **IndexedDB는 살아남고 localStorage만 evict된다**"를 가정. 만약 다음 실기기 업데이트에서 **여전히** 목록이 사라지면 IDB도 함께 비워지는 더 강한 제약 → **대비책: 재로그인 후 Drive에서 최근 사용 시트 목록 재발견(시트는 사용자 Drive에 있으므로 저장소 독립 복원)**. (token은 별도 키라 업데이트 시 여전히 만료 → 재로그인 후 살아남은 목록에서 1-탭 재연결, 설계 의도와 일치.)
- **⚙️ 후속(v0.19.0 실기기 → v0.20.0):** 민구 제보 "새 세션 추가 후 시트에 추가 **버튼 무반응·메시지 없음**" = **토큰 만료**(IDB evict 아님, 민구 재확인). 근본은 ① 토큰 만료 사유가 화면에 안 떴고(`report.ok===0` 메시지 미표출) ② 재로그인 유도 없음. **v0.20.0 수정:** `SyncReport.needsLogin`(토큰 null 프리플라이트 + 401/403 `isAuthFailure`, 문자열매칭 아님) → 시트동기화·Drive백업·복구 공통 `LoginRequiredModal` 마운트 + `report.message` 무조건 표출 + 재로그인 후 stashed 액션 resume(sheetUrl 살아있으면 그대로, 비었으면 `savedSheets[0]` 재연결). 회귀 `tests/sync-token-expiry.spec.ts`. **⚠️ 잔존(보수):** 백업-only 재로그인 resume은 표시상 닫히나 이미 synced면 백업 재푸시 안 됨(향후 백업 전용 retry 항목). 주 케이스(동기화 시작 시 만료)는 시트 프리플라이트에서 잡혀 sheet+backup 완전 재개.

### [CLIP-DEVICECHANGE-1] v0.14.0 회귀 — 유휴 중 입력장치 변경 시 전 세션 클립 소실
- **증상:** 측정 중 BT 연결/해제 등으로 `devicechange`가 한 번 발생하면 그 뒤 세션 내내 `clip_no_stream`·`clip_empty`로 모든 음성클립이 빈다(STT 값은 정상 저장 — 인식은 자체 오디오 경로라 무관).
- **원인:** `audioRecorder.ts handleDeviceChange()`가 유휴(녹음 중 아님)일 때 `recoverStream('devicechange')` 호출 → recoverStream이 **살아있는 스트림을 먼저 파괴한 뒤** `getUserMedia` 재호출. iOS Safari는 **사용자 제스처 밖 getUserMedia를 NotAllowedError로 거부** → 멀쩡한 스트림까지 잃고 영구 복구 불가. 이후 빈 클립마다 `useVoiceSession recoverStream('clip_empty')` 재시도도 전부 실패(제스처 없음). v0.14.0이 [IOS-5] "devicechange 시 재-getUserMedia 안 함" 정책을 깬 것이 근인.
- **해결:** v0.22.0 — 유휴 devicechange에서 자동 재-getUserMedia 제거(비파괴 라벨 갱신만, [IOS-5] 복귀). clip_empty 자동 재시도 게이트(폭주 차단). 스트림이 실제로 죽으면 `micLost` 노출 → **사용자 제스처(입력탭 "마이크 재연결" 버튼)에서만** 재획득(iOS의 유일한 복구 경로).
- **출처:** `2026-06-25 v0.21.0 실기기 로그`(sess_1782355366530, 세션시작 +2.6s devicechange → `clip_recorder_recover_failed:devicechange` → clip_no_stream×56·clip_empty×41; firsthand 코드 확인).
- **현재 상태:** ✅**수정 확정(v0.22.0 실기기 검증, 2026-06-26).** 2026-06-26 v0.22.0 실기기 2세션 로그에서 확인: S1 `clip_no_stream` **56→1**로 격감(`clip_empty` 0). S2는 실제 `input_device_changed:refresh:track_ended:블루투스→내장` 발생 → `clip_empty`×1 → `mic_lost:clip_empty` 래치 → 사용자가 "마이크 재연결" 탭 → `mic_reconnect_ok`+`clip_recorder_recovered`로 **복구 성공**. 전환 순간 1~2건만 손실(이전엔 전 세션 소실). ⚠️ 전환 순간 `clip_empty` 잔존(AUDIO-ROUTE-1 네이티브 셸 영역). 출처 `Deliverables/2026-06-26-v0220-real-device-analysis.md`.

---

## ③ iOS / TTS / Safari

### [IOS-6] 이상치 알람 TTS가 "확인해주세요"로 끝나 self-confirm 환각 위험 + 알람 중 barge-in 미작동(계측 대기)
- **증상(민구 제보):** 스피커폰/이어폰 모두 일반 안내 중 barge-in(끼어들기 발화)은 어느 정도 되는데, **이상치 알람 중에는 barge-in이 정상 작동 안 하는 느낌**.
- **원인(코드 추적):** ① 알람 TTS가 literally **"…확인해주세요."로 끝남**(`useVoiceSession.ts` alertText). `detectCommand`는 startsWith 매칭이라 `detectCommand("확인해주세요")==='confirm'` → 스피커폰에서 이 TTS가 마이크로 새어 들어가면 **알람이 스스로 confirm되어 닫히는** self-confirm 환각([IOS-3]의 알람판). 현 post-TTS 가드는 이를 막는 보호 역할도 겸함. ② 알람 TTS가 길어(추정 3~4s) post-TTS 가드 윈도우(재생중 전체 + 종료후 250ms)가 알람 발화 거의 전 구간을 덮어, 스피커폰에서 알람 도중 '확인'/'유지'/새값이 `stt_blocked_tts_muted`로 폐기 → "barge-in 안 됨" 체감. ③ trendConfirm 응답은 `handleInterim` early-return이라 조기확정을 못 받고 풀 EOS 꼬리(~1.7s)를 먹어 지연 가중. ④ 이어폰 알람 barge-in 비정상은 코드상 명확한 차단 지점 특정 실패 — needs-real-device-data.
- **해결·회피(v0.13.0 R7, 민구 결정):** alertText를 **"이상치 알림. {값}. 직전 조사보다 {N} 증가/감소했습니다."**로 — 끝의 "확인해주세요" 제거(self-confirm 환각 원인 제거), 앞에 "이상치 알림" 접두(화면 안 보는 현장 식별). **barge-in 가드 자체는 변경하지 않음** — v0.11.0 비 오는 비닐하우스에서 가드 스택이 환각 0건 유지([STT-6])한 성과를 후퇴시키지 않기 위함. 가드 단축은 실기기 near-miss 분포 확인 후 별도 판단(측정 우선 원칙).
- **출처:** `2026-06-18 세션`(민구 제보 + 결정) → **survey-011 v0.13.0** (TTS 재구성). barge-in 가드 튜닝은 미적용(계측 대기).
- **⚙️ 후속(v0.15.0 A6 — 스피커폰 모드 + post-TTS 가드 제거):** 민구가 "스피커폰 모드 ON 시 바지인 안 됨"을 불편으로 지목 + Trace v0.14.0 로그분석(`stt_blocked_tts_muted` 전체 **1건뿐**, 입력실패 실체는 `rejected_low_confidence` 7건·모드무관)으로 **스피커폰 모드 자체와 post-TTS 가드(`postTtsGuard.ts`)·TTS중 명령차단을 제거**(`speakerphoneMode` 삭제, settings persist v8→9). 즉 barge-in을 막던 주 가드가 사라져 알람 중 barge-in이 기본 동작으로 열림. self-confirm 환각 위험은 v0.13.0 alertText 재구성("확인해주세요" 제거)으로 **이미 구조적 차단**되어 가드 없이도 방어됨. 알람 TTS 문구도 v0.15.0에서 "추세 알림"으로(명칭 통일).
- **현재 상태:** ⚠️주시 — TTS 문구 ✅(self-confirm 구조적 제거), 가드 제거로 barge-in 기본 개방. **다음 현장 테스트 필요:** 알람 도중 의도적 발화가 정상 끼어드는지 + self-confirm 환각(알람이 스스로 닫힘) 재발 0 확인. 가드 부재가 소음 환경 오인식을 늘리는지도 관측(이전 가드 스택의 [STT-6] 환각 0 성과 대비).

### [IOS-4] SpeechSynthesisUtterance.voice에 plain object 할당 시 TypeError
- **증상:** `utterance.voice`에 plain object를 넣으면 TypeError(특히 mock/테스트 환경).
- **원인:** `voice`는 실제 `SpeechSynthesisVoice` 인스턴스만 허용.
- **해결·회피:** `speak()`/`warmupTts()`에서 voice 할당 시 타입 가드.
- **출처:** `growth-survey-010@0eaa59a`
- **현재 상태:** ⚠️주시 (survey-011 `src/lib/speech.ts` voice 설정 경로 점검 권장)

### [IOS-5] 스피커폰 모드 ON인데 출력이 이어피스(리시버)로 강제 전환 — getUserMedia `echoCancellation:true`의 voice-processing 세션
- **증상:** 사용자가 설정에서 스피커폰 모드를 켰는데도(소음 현장 대응) TTS 안내 음성이 스피커가 아니라 **이어피스(리시버)** 로 나가 잘 안 들림. iOS 18.7 / WebKit 26.5 실기기.
- **원인(코드+플랫폼 추론):** 앱은 출력 라우팅을 전혀 제어하지 않는다(`setSinkId`/`sinkId`/`setAudioOutput` grep = NONE; `speakerphoneMode`는 `speech.ts:159`·`useVoiceSession.ts:955,1188`의 소프트웨어 half-duplex/STT 임계값 전용). 마이크는 `audioRecorder.ts:135-139`에서 `echoCancellation:true`로 열린다. iOS WebKit은 `echoCancellation:true`를 요청받으면 마이크를 **voice-processing 오디오 세션**(AVAudioSession 통신/voice-chat 모드)으로 열고, 이 모드에서 OS가 출력을 리시버로 라우팅한다. iOS Safari엔 출력을 강제할 Web API가 없다(`HTMLMediaElement.setSinkId` 미지원). → **OS/WebKit 레벨 제약, 앱 코드로 직접 해결 불가.**
- **해결·회피(미확정 — 트레이드오프):** `echoCancellation:false`(또는 speakerphoneMode일 때만 false)로 열면 voice-processing 세션을 피해 스피커 출력이 유지될 *가능성*. 단 [CLIP-4]의 의도적 `echoCancellation:on`(빗소리 에코 되먹임 감소)과 [IOS-3] phantom 입력 위험과 충돌 → **블라인드 플립 금지, 측정 A/B 필요**(라우팅·에코·노이즈 오인식 3축 비교).
- **v0.9.0 실험(A/B 빌드):** 민구 결정 — "일단 입력탭에 스피커/이어폰 토글을 넣어 실기기에서 측정". 입력탭 우상단 토글(`speakerOutput`, 기본 이어폰=현행). 스피커 선택 시 `audioRecorder.setOutputMode(true)`가 마이크 스트림을 **`echoCancellation:false`로 재취득**(`acquireStream`/`reacquire`)해 voice-processing 세션 회피를 시도한다. `speakerphoneMode`(소프트 half-duplex)와는 **독립**(혼동 금지). `audio_route_changed`/`audio_reacquired:ec=<bool>` 텔레메트리로 다음 로그에서 출력 dB·STT 오인식률을 A/B 측정. ⚠️ 미검증: iOS에서 실제 스피커 전환 여부(OS 의존, 안 바뀔 수도)·세션 중 재취득 시 0.3~0.5s 인식 끊김. 재취득 실패 시 stream=null로 남아 `clip_no_stream`(안전선).
- **v0.12.0 종결(민구 결정, 2026-06-17):** `speakerOutput` 토글 + `setOutputMode`/`reacquire` **전부 삭제**. 근거 — ① v0.11.0 비 오는 비닐하우스 로그 Log2에서 토글을 실제 A/B(스피커↔이어피스, `audio_reacquired:ec=true/false`)했으나 출력 라우팅이 실제로 바뀐다는 증거 없음(iOS 미제공 재확인) + 토글이 "눌러도 글자만 바뀌고 작동 안 한다"는 민구 보고와 일치. ② `echoCancellation`은 이제 **항상 ON 고정**(이어피스 기본). 출력 강제는 PWA 불가 확정 → **AUDIO-ROUTE-1 네이티브 셸(Capacitor)** 경로로만 해결(B0 WKWebView STT 스파이크가 게이트, 본 항목 비범위). 입력탭 토글 자리는 **읽기전용 입력장치 CATEGORY 배지**(🎧 블루투스 / 📱 내장 마이크 / 🎧 유선)로 교체 — 출력이 아니라 어떤 마이크로 듣는지 표시. `speakerphoneMode`(소프트 half-duplex)+post-TTS 가드는 **독립이라 유지**. persist v6→7(speakerOutput 영속값 삭제).
- **출처:** `2026-06-15 v0.7.0 실기기 로그` (민구 제보; 코드 firsthand 확인) → `2026-06-17 v0.11.0 로그`(A/B 무효과 + 민구 토글 제거 결정). 메커니즘 외부 출처 교차확인은 **미수행**(확인 필요).
- **현재 상태:** ✅PWA 레벨 종결(토글 제거, echoCancellation 항상 ON) — 출력 강제는 AUDIO-ROUTE-1 네이티브 셸로 이관. `src/lib/audioRecorder.ts` acquireStream(echoCancellation:true 고정).

---

## ④ 정정 · race · 데이터 유실

### [RACE-3] cascade 정정 중 stop/크래시 시 원본 측정값 유실 (4회 반복 수정)
- **증상:** cascade 수정 진행 중 사용자가 stop하거나 앱이 크래시/리로드되면 정정 전 **원본 행 데이터가 사라짐**.
- **원인:** cascade 수정이 in-memory 행을 초기화한 뒤 재완료(advance) 전에 중단되면, persistSession이 빈 행을 저장하거나 백업 행을 누락. 여러 엣지케이스(완료행 0개·flush lag·조기 반환)가 순차적으로 드러남.
- **해결·회피 (진화 과정):**
  1. cascade modify는 in-memory(sessionStore)만 초기화, IDB/dataStore는 재완료 시 persistSession이 덮어쓰도록 → 중단 시 원본 보존 (`a45cd24`).
  2. `correctionBackupRef`에 수정 시작 전 IDB 행 스냅샷 저장, stop 시 백업 행 포함 persist (`0e05b2e`).
  3. flush lag 구간 대비: 완료 직후 아직 flush 안 된 행은 실시간 sessionStore 값으로 백업 구성 (`f90c6cd`).
  4. completedRows가 비어도 correctionBackupRef가 있으면 persist 진행(조기 반환 이동) (`2075f8a`).
- **출처:** `growth-survey-010@a45cd24` → `@0e05b2e` → `@f90c6cd` → `@2075f8a` (같은 이슈 4회 반복). 추가 보강 `@ad60ba5`(행 values 초기화 + complete:false + completedRows/syncedRows 재계산).
- **현재 상태:** ⚠️주시 (survey-011 `src/lib/useVoiceSession.ts`에 `correctionBackupRef` + cascade 보존 경로 존재 — 회귀로 보장 권장)

### [RACE-6] ensureTeamSubFolder race → 중복 Drive 폴더
- **증상:** 동시 업로드 시 팀 하위 폴더가 중복 생성되거나 검색 실패가 silent fall-through.
- **원인:** 폴더 ensure 로직에 캐시·정렬·에러 throw 부재.
- **해결·회피:** `settingsStore.teamFolderId` 캐시(다음 업로드부터 검색 생략), 검색 시 `orderBy=createdTime asc`(중복 시 가장 오래된 것으로 통일), admin 실패 시 캐시 무효화, Drive Q 문자열 escape 강화(backslash), 검색 실패 시 throw.
- **출처:** `growth-survey-010@8ce8dca` (v0.10.1, HIGH-2)
- **회귀 확보(2026-07-16, v0.35.1 Stage 1-3):** ensure 로직을 `src/lib/driveFolders.ts` `ensureEmailSubFolder`(캐시 주입형)로 통합 — 캐시는 호출부가 parent별 분리 주입(로그=teamFolderId, 개선요청=무캐시)해 다른 parent로의 오업로드를 구조로 차단. `tests/driveFolders.spec.ts`(Node 러너 6케이스: 캐시 분리·최고참 선택·검색 실패 throw·생성·escape)가 계약을 고정.
- **현재 상태:** ✅수정됨+회귀 확보 (2026-07-16)

### [CLIP-2] 음성 클립에 발화 전후 무음이 과다하게 포함됨
- **증상:** 저장된 클립 재생 시 앞뒤 공백이 김. 06-08 로그 녹음 길이 평균 5.7초·최대 20.9초인데 실제 발화는 1–3초.
- **원인:** TTS 종료 후 녹음 시작 + STT final 후 종료라 발화 전후 무음이 통째로 저장됨. VAD/트리밍 없음.
- **해결·회피:** 저장 직전 진폭(RMS) 기반으로 발화 구간만 남기고 앞뒤 무음을 트림해 16kHz mono WAV로 재인코딩(`audioTrim.ts`). decode 불가/음성 미검출 시 원본 반환(iOS 안전 — 녹음 게이팅은 첫 음절 손실 위험이라 회피). 트림 발생은 `clip_trimmed` 이벤트로 추적.
- **출처:** `2026-06-08 세션` (민구 제보 + 로그) → **survey-011 v0.4.2** 추가
- **현재 상태:** ✅수정됨 (`src/lib/audioTrim.ts`, `src/lib/audioRecorder.ts` `stopClip` 통합; Chromium 실클립 검증 6998ms→1440ms, 128KB→46KB). ⚠️주시 — iOS Safari `decodeAudioData(webm/opus)` 작동은 다음 실기기 로그의 `clip_trimmed`로 사후 확인.
- **v0.5.0 주석(프리롤 도입):** 2026-06-10 로그에서 0.32~0.60s 초단 클립 7건 관측 — barge-in 시 발화 **앞부분**이 녹음 시작 전에 잘린 정황(트림 과다가 아니라 수록 자체가 늦음). v0.5.0에서 **0.5s 프리롤**(AudioWorklet PCM 링버퍼, 실패 시 ScriptProcessor → 그것도 실패 시 프리롤 없이 현행 동작 + `clip_preroll_unavailable` 로그)을 클립 앞에 결합하고, 트림 PAD를 비대칭화(앞 300ms / 뒤 180ms). **트림 전 원본(프리롤 포함)도 `:raw` 키로 보존**(민구 결정)하고 로그 zip에 포함, `clip_duration`에 `prerollMs` 동봉. iOS 실기기 효과는 다음 로그에서 정량 확인. **v0.5.0 실기기 확인(2026-06-11):** `clip_preroll_ready:worklet:44100` + 44개 `clip_duration` 전부 `prerollMs:500`, 초단(0.32~0.60s) 클립 **0건**(06-10 7건→0건), `clip_trimmed` 39건·`:raw` 원본 보존 39건 정상. iOS Safari 프리롤·트림 경로 정상 작동 확정.
- **[CLIP-BLANK-1] v0.9.0 — 발화 *사이* 긴 공백 잔존(내부 무음):** 2026-06-15 v0.8.0 실기기 후 민구 재제보(클립 공백 여전히 김). 원인: 기존 `findSpeechRange`가 **[첫 발화~마지막 발화] 단일 구간**만 돌려줘 그 *내부*의 긴 무음(예: 선언 후 한참 뜸 → 값)이 통째 보존됐다(앞뒤 무음만 잘림). v0.9.0: `audioTrim.findSpeechSegments`(다중 세그먼트, `MERGE_GAP_MS=150` 미만 갭은 한 발화로 병합) + `buildKeptRanges`(세그먼트별 비대칭 PAD 후 겹침 병합) + `concatRanges`(범위 사이 긴 무음 제거하고 이어붙임)으로 교체. 단일 세그먼트면 기존과 바이트 동일(회귀 없음), `KEEP_RATIO` no-effect·프리롤 폴백·`:raw` 보존 그대로. 회귀 `tests/audioTrim.spec.ts`(다중구간 갭압축 검증). ⚠️ 실기기 미검증: 선언+값 클립에서 공백만 제거되고 발화는 보존되는지, 첫 음절 유지.

### [CLIP-3] 세션 첫 클립이 빈 캡처(`clip_empty`)로 저장 실패 → broken pointer(재생버튼 끊김)
- **증상:** 세션의 **맨 첫 음성 클립**이 빈 버퍼로 stop돼 저장 안 됨. sessions.json은 해당 셀(row1 횡경 c7) audioClip 포인터를 `sess_…:1:c7…`로 등록하지만 디스크에 파일이 없어 데이터탭 재생버튼이 끊김(404). 값(11.1)은 정상 커밋 — audit-trail 클립만 손실.
- **원인(가설):** 0.5s 프리롤 링버퍼 워밍업과 **세션 첫 녹음 stop** 사이 타이밍 — 첫 캡처가 프리롤 PCM이 채워지기 전 stop돼 빈 버퍼 반환(`clip_stop_resolved:null` → `error clip_empty`). 둘째 클립부터는 정상. 빈 catch 아님(정상 계측됨 — REVIEW-1 준수).
- **해결·회피:** ① 빈 캡처 감지 시 셀 audioClip **포인터 등록 회수**(broken pointer 방지 — [CLIP-2/persistSession] 회수 패턴), 또는 ② 첫 녹음 전 프리롤 1프레임 워밍업 보장. 값은 영향 없으므로 우선순위 낮음(P2).
- **출처:** `2026-06-11 실기기 로그` (단일 세션 1건: row1 c7 `clip_empty`)
- **현재 상태:** ⚠️주시(가드는 들어갔으나 **레이스에 덮이는 실기기 증거 발견**, 2026-06-12) — 빈 캡처(`clip_empty`) 감지 시 `unlinkBrokenPointer`가 셀 audioClip 포인터를 **메모리(pendingClipsRef)와 이미 영속화된 세션 양쪽에서** 회수하되, 포인터가 여전히 우리 clipKey와 같을 때만 해제(이후 restart/modify가 재지정한 경우 보존)한다. 데이터탭이 404 재생버튼을 더는 렌더하지 않음. 값(audit-trail 외 측정값)은 원래부터 영향 없음. (이전: 06-11 백로그 CLIP-EMPTY(P2)) (`src/lib/useVoiceSession.ts`, `src/lib/audioRecorder.ts` `stopClip` 빈 버퍼 가드)
- **레이스(2026-06-12 발견):** 값 커밋이 포인터 사전등록 + fire-and-forget `persistSession()`을 먼저 실행하므로(첫 await 전에 포인터 포함 행을 동기 빌드), 그 persist가 in-flight인 동안 `clip_empty`→`unlinkBrokenPointer()`가 실행되면 **늦은 `upsertSession`/`saveSession`이 unlink를 되덮어 포인터가 부활**한다. 06-11 v0.6.0 실기기 로그 row8 c7에서 관측(수확된 sessions.json에 포인터 잔존). 해결은 [CLIP-VAL-1] ③(tombstone 또는 persist 직렬화)과 동일 — **v0.7.0에서 tombstone으로 봉합**([CLIP-VAL-1] ✅ 참조, 회귀 `tests/clip-modify-rerecord.spec.ts`).
- **🟢 2026-07-02 v0.25.0 실기기 — 기능2(mic prewarm) 효과 1차 확인(n=2):** `mic_prewarm_attempt`×3 → `_ok`×3(100%, denied 0; 소요 3394/394/1556ms), **`clip_empty` 0건**(양 세션) — v0.24.0(06-30 S1 r1c7 clip_empty)과 대비, 세션 첫 클립 유실 증상 소멸. 양 세션 r1c7 클립 실제 저장(트림 41KB/35KB + raw). 귀속 특이점: 경계에 걸친 prewarm은 attempt=`__app__`·ok=세션ID로 갈릴 수 있어 분석 시 ts로 짝지을 것(`useVoiceSession.ts:2208-2214`).

### [CLIP-DECIMAL-FRAG-1] 소수부 재질문 후 조각만 발화 시 원본 전체값 클립 유실 (값은 정상)
- **증상:** STT가 소수부를 조사로 오인식(`decimal_fraction_lost`) → 앱이 "N 점, 소수점 아래 숫자만 말씀해 주세요" 재질문 → 사용자가 **소수 한 자리만** 발화("구") → 커밋된 캐노니컬 키 클립에 **조각만** 저장되고 원래 전체값 발화("이십구 점 부")가 사라짐. `:raw` 안전망도 재시작마다 덮어써 **ZIP에서도 원본 복구 불가**. **시트 값은 합성으로 정상**(299.9). 민구가 row18 비고란(c9)에 직접 기록: *"소수점만 따로 발화시 앞의 정수 부분 클입은 잘림."*
- **원인:** `src/lib/useVoiceSession.ts:1338`의 무조건 `recorderRef.current?.startClip(); // restart clip`(모든 `stt_parse_failed` 재질문 직전)이 새 빈 슬롯(`src/lib/audioRecorder.ts:431 startClip()` → `chunks:[]`)을 만들어 재질문 직전의 **원본 전체발화 버퍼를 폐기**. modify/`clip_relink_cmd` 경로와 **무관**(일반 값-커밋 경로). 다른 재질문(multi_numeric·extraneous_token 등)은 전체 재발화를 유도하므로 새 클립이 정상 — **소수 재질문만 부분(조각) 발화를 유도**해 이 분기에서만 결정적으로 터짐. [RACE-4]/[CLIP-VAL-1]의 거울상(그쪽은 재시작 안 해 새 발화 유실, 이쪽은 재시작해 원본 유실).
- **해결(survey-011 v0.16.0):** 소수 재질문(`decimal_fraction_lost`) 분기에서만 **재질문 직전 `startClip()`을 생략**한다(`src/lib/useVoiceSession.ts`). 활성 녹음 슬롯이 재질문 TTS·조각 발화를 거쳐 계속 녹음하다가 commit 지점 `stopClip()`에서 **단일 연속 녹음**으로 stop되고, 기검증된 `audioTrim.findSpeechSegments`(긴 재질문 갭 ≫ `MERGE_GAP_MS` → 원본·조각 2세그먼트) + `concatRanges`(사이 무음 제거하고 이어붙임, CLIP-BLANK-1 경로)가 전체값으로 합성한다. **별도 cross-restart webm concat이 없어 iOS `decodeAudioData(webm/opus)` 위험([CLIP-2] ⚠️)을 구조적으로 회피**, `:raw`도 재시작이 없어 1회만 보존. 보존 동작은 `clip_decimal_kept` 이벤트로 계측. 전체 재발화 분기(multi_numeric·extraneous_token 등)는 종전대로 `startClip()` 재시작 유지(무회귀).
- **출처:** `2026-06-22 v0.15.0 실기기 로그`(4/4 결정적: 2879:15·18, 4316:11·16; ffprobe trim 0.80–1.76s vs 베이스라인 1.2–1.7s; 민구 row18 비고 현장 확증) — Trace 재분석.
- **현재 상태:** ✅수정됨(**survey-011 v0.16.0**) — 로직 검증 완료(회귀 `tests/clip-decimal-frag.spec.ts` 3건 + `tests/audioTrim.spec.ts:214` decimal-frag 2세그먼트 보존 + `clip-modify-rerecord` 4건 무회귀, 28 passed). **⚠️ 실기기 audit 대기:** 저장 webm이 iOS Safari에서 실제 전체값을 담는지는 다음 실기기 로그의 `clip_decimal_kept`+클립 길이로 최종 확인(단 기검증 CLIP-BLANK-1 경로 재사용이라 위험 낮음). **주의:** [STT-6] line 60의 `decimal_fraction_lost` 결론("데이터 유실 없음 — 마찰만")은 **값**에 대해서만 참 — 이 항목은 같은 트리거가 **클립 audit**를 유실시킴을 밝혀 v0.16.0에서 봉합한 것(모순 아님·정제).

### [SYNC-1] sheetRow 매핑이 외부 변경(시트 정렬·행 삽입/삭제)에 취약 — update가 엉뚱한 행을 덮을 수 있음
- **증상:** v0.6.0 행 단위 재동기화는 각 행이 처음 append된 1-based 시트 행번호(`sheetRow`)를 기억해 두고, 그 행을 수정하면 같은 행을 PUT(UPDATE)한다. 그런데 사용자가 **구글 시트에서 직접 행을 정렬·삽입·삭제**하면 그 행번호가 어긋나, UPDATE가 의도와 다른 행을 덮을 수 있다.
- **원인:** Sheets values API는 안정적 행 ID가 없어 위치(A1)로만 쓴다. 외부 편집은 앱이 알 수 없다.
- **해결·회피(완화):** updateRow가 404/400을 받으면(행이 사라짐/이동) 해당 행의 `sheetRow`를 초기화해 **다음 동기화에서 append로 폴백**하고 `sync_row_mismatch` 텔레메트리를 남긴다. 위치가 살아있는 채 내용만 밀린 경우(정렬)는 감지 못 하므로, **동기화 후에는 구글 시트에서 행 순서를 바꾸지 말 것**을 권장. C5(탭명 따옴표)로 탭명 특수문자發 가짜 mismatch는 제거됨.
- **출처:** `survey-011 v0.6.0` Codex 교차점검(C5 연계); 회피 경로 회귀 `tests/sync-skip-rows.spec.ts`("update 404 → sheetRow 초기화 후 append 폴백").
- **현재 상태:** ⚠️주시(설계상 한계 — 404/400 폴백으로 데이터 손실은 막되, 정렬發 덮어쓰기는 사용자 운용으로 회피) (`src/lib/sync.ts` pass-2 404/400 폴백, `src/lib/sheets.ts` `rowA1Range`/`quoteSheetTitle`)

### [SYNC-2] append HTTP 성공인데 updatedRange 파싱 실패 — synced-without-sheetRow 엣지(이후 수정 시 재append 중복 수용)
- **증상:** `values:append`가 200으로 성공(데이터는 이미 시트에 있음)했으나 응답의 `updatedRange`를 파싱하지 못해 각 행이 시트 어느 위치에 떨어졌는지 모르는 극히 드문 경우.
- **원인:** 예기치 못한 응답 페이로드 등으로 `parseUpdatedRangeFirstRow`가 null 반환.
- **해결·회피:** **방침(C1):** 진실은 "데이터는 시트에 있다"이므로 해당 행들을 `syncState:'synced'`로 마크하되 `sheetRow`는 미설정(in-place UPDATE 불가). 성공으로 집계(appended 카운트·successIds 정상) → 백업/자동삭제 정상 진행, **재시도해도 synced 행이라 재append 안 함**(중복 방지의 핵심). 단, 이런 행이 **이후 수정되면** dirty이지만 sheetRow가 없어 pass-1 재append 대상이 됨 → 값은 최신으로 정확히 올라가나 **그 한 번의 중복 행은 수용**한다(극히 드문 엣지, 데이터 무손실 우선). 이전 방침(F4: 세션 실패→재시도)은 append HTTP가 이미 성공했으므로 재시도가 같은 행을 다시 올리는 더 흔한 중복을 유발해 폐기.
- **출처:** `survey-011 v0.6.0` Codex 교차점검(C1); 회귀 `tests/sync-skip-rows.spec.ts`("C1 — synced-without-sheetRow … 재append 안 함").
- **현재 상태:** ⚠️주시(수용된 엣지 — 발생 빈도 극저, 데이터 무손실) (`src/lib/sync.ts` pass-1 no-range 분기)

### [SYNC-3] 컬럼 스키마 순서/구성 변경 시 값이 위치기반으로 밀려 엉뚱한 열에 안착
- **증상(원 보고, v0.6.0):** 세션 생성 후 설정에서 **컬럼 순서를 바꾸면**, 이미 `synced`로 시트에 올라간 행들은 시트의 열 순서(append 당시 순서)와 로컬 열 순서가 어긋날 수 있었다.
- **증상(실사용 재현·재오픈, 2026-07-07 v0.28.0 A5, Sonar 실 Google 계정 업로드 테스트):** 로컬 세션이 구스키마(6컬럼)로 만들어진 채 실 10컬럼 시트(컬럼이 나중에 추가/변경됨)로 동기화하니, 값이 실제 헤더와 무관하게 A,B,C… 순서로 밀려 들어가 C,D,E열은 비고 F,G,H열에 안착 — **침묵 오정렬**(에러 없이 조용히 엉뚱한 열에 저장). 민구가 실사용에서 컬럼을 나중에 추가/변경한다고 확인해 "운용 회피"만으로는 부족해졌다.
- **원인(코드 확인):** `sync.ts`가 append/update 직전 값 배열을 **로컬 세션의 컬럼 순서(`session.columns.map(c=>c.id)`)만으로** 만들었다 — 실제 시트의 헤더 행과 전혀 대조하지 않는 순수 위치기반(positional) 쓰기였다. 로컬 스키마가 시트의 실제 현재 헤더와 다르면(순서만 다르거나, 시트에 컬럼이 추가/삭제됐거나), 값이 이름과 무관하게 물리적 위치로만 안착해 조용히 틀린 열에 들어갔다. 행 단위 재동기화는 값 변경(dirty)만 추적하고 **열 매핑 변화는 추적하지 않았다** — sheetRow는 위치만 가리키고 열 순서 메타는 행에 없었다.
- **해결(v0.29.0, Mack) — 근본 수정, 문서화 아님:** append/update 직전 `sync.ts`가 `sheets.ts`의 신규 `fetchHeaderRow()`로 **시트의 실제 현재 헤더 행을 syncSelected() 배치당 1회** 읽고(세션/행마다가 아니라 "시트에 추가" 클릭당 1회 — API 호출 비용 상한), 신규 `src/lib/columnMapping.ts`(`mapColumnsToHeader`/`buildRowForMapping`, 순수 함수)로 **로컬 컬럼을 이름 기준**으로 그 헤더에 매핑한다(순서 아님). 값은 각 컬럼의 **실제 헤더 위치**에 안착 — 시트 컬럼이 재배치·삽입돼도 이름만 같으면 정확히 맞아 들어간다. 로컬 컬럼명이 시트 헤더에 없으면("신규 컬럼") 그 값은 **아무 위치에도 쓰지 않고**(위치 추측 금지) `sync_column_missing_in_sheet` 텔레메트리 + `report.columnWarnings`로 사용자에게 경고(DataScreen 배너에 표면화) — "침묵 오정렬"을 없애는 게 핵심이므로 조용히 다른 열에 넣거나 조용히 버리지 않는다. 로컬 컬럼이 헤더와 **단 하나도** 매칭되지 않으면(총체적 스키마 불일치) 세션 전체를 명시적 실패로 보고한다(빈 값으로 "성공" 처리하지 않음 — 그 자체가 또 다른 침묵 오염이므로). 헤더 조회 자체가 실패하면(네트워크 등) 검증되지 않은 위치기반 쓰기로 되돌아가는 대신 배치 전체를 중단한다(정확성 > 가용성).
- **비용/캐싱 설계:** 헤더는 **호출마다** 새로 읽는다(세션 간 캐시 없음) — 오래된 캐시가 정확히 이 버그를 재도입할 위험이 있어 "정확성이 성능보다 우선" 원칙에 따름. 추가 비용은 "시트에 추가" 클릭당 GET 1회로 상한.
- **잔여 한계(정직하게 명시, v0.29.0 시점):** 이 수정은 **이제부터의 쓰기(append/update)만** 보장한다 — 이 수정 이전에 이미 잘못 안착한 과거 시트 행은 소급 복구되지 않는다(그 행들이 실제 어떤 매핑으로 쓰였는지 사후에 알 방법이 없음). ~~또한 UPDATE 경로는 로컬이 관리하는 최상위 매칭 컬럼까지의 범위를 한 번에 PUT하므로, 그 범위 안쪽 인터스티셜 위치에 이 앱이 추적하지 않는 시트 전용 컬럼이 있다면 그 자리는 빈 문자열로 재기록된다~~ **← 아래 후속수정(v0.29.x)으로 해소됨.**
- **후속수정(v0.29.x, Mack) — UPDATE 경로의 인터스티셜 컬럼 덮어쓰기 위험 근본 제거:** 민구에게 "이 앱이 append한 행에 나중에 시트에서 직접 다른 열(인터스티셜)에 값을 채워넣고, 그 후 앱에서 같은 행을 수정해 재동기화하는 워크플로가 있다/있을 수 있다"를 확인받아(2026-07-07), "드묾"이라는 원래 가정을 접고 UPDATE 경로 자체를 고쳤다. `sync.ts`의 UPDATE 패스가 더 이상 `sheets.ts`의 `updateRow`(연속 A1 범위 단일 PUT — `buildRowForMapping`의 밀집 배열로 매핑 안 된 인터스티셜 위치까지 `''`로 덮어씀)를 호출하지 않는다. 대신 신규 `updateCellsSparse`(Google Sheets API `spreadsheets.values.batchUpdate` — 한 번의 HTTP 호출로 여러 개별 range를 동시에 쓸 수 있다)를 호출하며, 요청의 `data` 배열은 신규 `columnMapping.ts`의 `buildSparseCellsForMapping`이 만든 **매핑된 컬럼만의 목록**이다. 인터스티셜(매핑 안 된) 컬럼은 이 목록에 아예 등장하지 않으므로 — "빈 문자열로 쓰지 않는다"가 아니라 **애초에 그 셀을 가리키는 range 자체가 요청에 없다** — 물리적으로 건드릴 방법이 없다. APPEND 경로는 그대로(`buildRowForMapping`의 밀집 배열 + 단일 `values:append`) — 신규 행은 이전 데이터가 없어 인터스티셜 위치를 비워써도 무해하므로 손대지 않았다. `src/lib/sheets.ts`의 기존 `updateRow`/`rowA1Range`는 함수 자체는 남겨뒀지만(다른 호출부 없음을 확인) 이제 이 UPDATE 경로에서 쓰이지 않는다.
- **회귀 테스트:** `tests/columnMapping.spec.ts`(순수 함수, DOM 무의존 — (a)스키마 완전일치 (b)시트가 로컬보다 컬럼多 (c)순서만 다름·이름 동일 (d)로컬에 없는 컬럼 (e)총체적 불일치 5×2=11케이스 + 신규 `buildSparseCellsForMapping` describe 3케이스: 인터스티셜 미표현, `buildRowForMapping`과의 대조로 밀집vs희소 차이 실증, 총체적 불일치 시 빈 배열), `tests/sync-header-mapping.spec.ts`(전체 앱 e2e로 (b)(c) + 총체적 불일치 시 명시적 실패 3케이스 + 신규 "인터스티셜 컬럼 절대 미접촉" 케이스: 로컬 6컬럼이 헤더 9컬럼에서 A,B,F,G,H,I에 매핑되고 C,D,E가 인터스티셜인 상태에서 이미 synced된 행을 dirty로 만들어 UPDATE 경로를 태우고, `values:batchUpdate` 요청의 `data` 배열에 C2:C2/D2:D2/E2:E2 range가 **전혀 없음**을 직접 단언 — 이게 이번 후속수정의 핵심 검증), 기존 `tests/sync-skip-rows.spec.ts`/`tests/sync-token-expiry.spec.ts`는 헤더 GET stub을 로컬 스키마와 정확히 일치하게 갱신해 **기존 동작(스키마 일치 케이스) 무회귀** 확인 — `sync-skip-rows.spec.ts`의 UPDATE 관련 2케이스는 PUT 단언을 `values:batchUpdate` sparse 단언으로 갱신(연속범위 A2:B2 단일 PUT → A2:A2/B2:B2 개별 range 2건).
- **출처:** `survey-011 v0.6.0` Codex 교차점검(C6, 원 보고) → `2026-07-07 v0.28.0 A5 업로드 테스트(Sonar, 실 Google 계정)`(재오픈, 실사용 재현) → **survey-011 v0.29.0** 근본 수정(이름기반 매핑) → **survey-011 v0.29.x** 후속수정(민구 확인 기반, UPDATE 경로 인터스티셜 컬럼 절대 미접촉).
- **현재 상태:** ✅수정됨(`src/lib/columnMapping.ts` `mapColumnsToHeader`/`buildRowForMapping`/신규 `buildSparseCellsForMapping`, `src/lib/sheets.ts` `fetchHeaderRow`/신규 `updateCellsSparse`, `src/lib/sync.ts` append 경로는 이름기반 매핑 유지·update 경로는 `updateCellsSparse` sparse per-cell 전환, `src/screens/DataScreen.tsx` columnWarnings 배너) — APPEND·UPDATE 양쪽 모두 실기기에서 실제 컬럼 추가/변경 + 인터스티셜 컬럼이 있는 프로덕션 시트로 재검증 권장(단위/e2e는 전부 통과).

### [SYNC-4] 재로그인 자동 재연결이 컬럼 ID를 새로 만들어 입력 중 값이 빈칸으로 동기화될 수 있음
- **증상:** 음성 입력 중 Google 재로그인/시트 자동 재연결이 발생하면, 이미 말해 둔 값이 앱 세션 안에는 남아 있는데 이후 시트 동기화에서 같은 항목을 빈 문자열로 읽어 시트에 덮어쓸 수 있었다. UI 표시 문제가 아니라 프로덕션 시트 값이 영구 손상될 수 있는 데이터 유실 경로다.
- **원인:** `SettingsScreen`의 재연결 경로가 `inferColumns()` 결과로 `useSettingsStore.columns`를 교체하는데, 기존 `inferColumns()`가 `Date.now()` 기반 컬럼 ID를 매번 새로 만들었다. 음성 세션 값은 구 ID 아래 저장되고, 이후 `persistSession`/`sync`는 새 컬럼 ID로 값을 조회해 `''`를 쓰게 된다. [AUTH-7]의 재로그인 후 자동 재연결 완화가 만든 부작용이다.
- **해결(v0.30.0, Mack):** `inferColumns()`의 ID를 헤더명+중복순번 기반 결정적 해시로 바꾸고, 재분석 시 기존 컬럼명과 신규 컬럼명이 양쪽 모두 유일한 경우 `preserveInferredColumnIds()`로 기존 ID를 보존한다. 이렇게 하면 구버전 `Date.now()` ID로 이미 시작한 활성 세션도 같은 이름의 항목 값을 계속 주소 지정할 수 있고, 신규 세션은 결정적 ID를 쓴다. 중복 헤더명은 이름만으로 안전하게 매칭할 수 없으므로 보존하지 않고 새 결정적 ID를 쓴다.
- **회귀 테스트:** `tests/sheets-infer-columns.spec.ts` — 동일 헤더의 결정적 ID, 구 ID 보존, 중복 헤더명 보존 금지. 기존 이름기반 시트 매핑 회귀 `tests/columnMapping.spec.ts`도 함께 통과.
- **출처:** `2026-07-07 v0.29.0 실기기 점검 후속 CODEX-HANDOFF.md` 문제 A → **survey-011 v0.30.0**.
- **현재 상태:** ✅수정됨(`src/lib/sheets.ts` `inferColumns`/`preserveInferredColumnIds`, `src/screens/SettingsScreen.tsx` `loadHeaders`) — 실기기에서 재로그인/자동 재연결을 일부러 발생시키는 장시간 입력 시나리오로 최종 검증 권장.

---

## ⑤ 빌드 / 테스트 / 배포 환경 (이번 세션 직격탄)

### [ENV-1] dev 포트 불일치 → e2e ERR_CONNECTION_REFUSED
- **증상:** Playwright e2e가 `ERR_CONNECTION_REFUSED`로 전부 실패.
- **원인:** 문서·`npm run dev`(vite)는 **5173**인데 `playwright.config.ts`의 `baseURL`은 **5175**.
- **해결·회피:** 테스트 전에 `npm run dev -- --port 5175 --strictPort`로 띄운 뒤 실행. (또는 baseURL을 5173으로 맞추거나 webServer를 설정 — 현재는 수동 정렬.)
- **출처:** `2026-06-04~05 세션`
- **현재 상태:** ⚠️주시 (`vite.config.ts` server.port=5173 vs `playwright.config.ts` baseURL=5175 — 여전히 불일치, 수동 회피 필요)

### [ENV-2] playwright.config에 webServer 없음 (서버 자동기동 안 됨)
- **증상:** `npx playwright test`만 실행하면 서버가 없어 연결 거부.
- **원인:** `playwright.config.ts`에 `webServer` 블록 없음("// No webServer — dev server started separately").
- **해결·회피:** dev 서버를 **수동 기동**한 뒤 테스트. (자동화하려면 webServer 추가 — Mack 영역.)
- **출처:** `2026-06-04~05 세션`
- **현재 상태:** ⚠️주시 (`playwright.config.ts`에 webServer 부재 확인)

### [ENV-4] 문서의 테스트 명령 드리프트
- **증상:** 문서는 `npx tsx scripts/test-*.mjs`라는데, 실제 회귀는 `npx playwright test`(특히 `tests/koreanNum.spec.ts` 62케이스).
- **원인:** `CLAUDE.md`/`AGENTS.md`의 테스트 명령이 실제 테스트 구조와 어긋남.
- **해결·회피:** 실제 회귀는 `npx playwright test tests/koreanNum.spec.ts`로 돌려라. 문서 명령(`tsx scripts/test-koreanNum.mjs` 등)을 맹신하지 말 것.
- **출처:** `2026-06-04~05 세션`(survey-011 `CLAUDE.md` line 33, `AGENTS.md` line 31 모두 `tsx scripts/test-*.mjs` 명시)
- **현재 상태:** ⚠️주시 (문서 드리프트 미수정 — 문서는 이번 작업 범위 밖)

### [ENV-8] PWA 업데이트 반영 지연으로 실기기에서 구버전 실행
- **증상:** 새 버전(v0.4.2)을 배포(deploy)했으나, 실기기(iOS Safari 등)에서 이전 버전(v0.4.1)이 계속 활성화되어 실행되며 신규 버그 패치 및 기능이 누락된 채 테스트 로그가 수집됨.
- **원인:** PWA 서비스 워커의 캐시 라이프사이클(`skipWaiting` 미강제 또는 자동 감지 UI 부재)로 인해 즉각적인 업데이트 및 새로고침이 브라우저에서 일어나지 않음.
- **해결·회피:** 서비스 워커 배포 시 업데이트 감지 이벤트를 UI에 팝업("새로운 버전이 있습니다. 새로고침하여 적용하세요")으로 띄우고 사용자가 인지하도록 가이드.
- **출처:** `2026-06-08 세션` (실기기 로그 분석)
- **현재 상태:** ✅수정됨 (5086 로그 분석 결과 v0.4.2 업데이트 및 실기기 정상 구동 완료 확인)
- **⚠️ 재발(v0.17.0 실기기, 민구 제보):** 홈 화면 **설치형(standalone)** 사용 시 새 버전 배포해도 반영 안 됨 — `vite.config.ts` `registerType:'autoUpdate'`는 iOS standalone에서 완전 종료·재실행 전엔 새 SW를 silent 리로드로만 반영하는데, 현장에선 그 리로드가 안 걸림.
- **해결·회피(v0.18.0 1f, 비강제 프롬프트):** `registerType:'prompt'` + `injectRegister:null`로 전환하고 `src/lib/pwaUpdate.ts`에서 `virtual:pwa-register`의 `registerSW({onNeedRefresh,onRegisteredSW})`를 `main.tsx`에서 **수동 1회** 등록(이중 등록 방지). ① 능동 체크 = standalone 실행 + `visibilitychange`(포그라운드) 시 `registration.update()`. ② 비강제 배너(`src/components/UpdateBanner.tsx`, App 상단 고정) = 새 SW waiting 시에만 노출, 탭 시 `updateSW(true)`(skipWaiting+1회 리로드). ③ Settings footer에 현재 버전 + "업데이트 확인/새로고침" 버튼(`UpdateControl`). **음성 측정 중 강제 리로드 금지** — 적용은 사용자 탭 시점에만. 진행 세션은 v0.4.4 증분 persist로 영속화돼 리로드해도 유실 없음. **autoUpdate의 silent 강제 리로드 제거가 핵심 변경.**
- **미검증(실기기 대기):** iOS standalone에서 (a) 새 버전 배포 후 실행/포그라운드 시 배너 실제 노출, (b) `registration.update()`가 새 SW를 실제 탐지하는지 — 다음 실기기 세션에서 이전→신 버전 전환 실증 필요.

### [ENV-10] `recover-drive.spec.ts` W8("로그인 상태") 테스트가 시간 경과로 결정론적으로 깨짐 — 테스트 픽스처의 달력 드리프트(앱 회귀 아님)
- **증상:** `tests/recover-drive.spec.ts`의 W8("로그인 상태: 모달 목록 조회 → 선택 복구...") 케이스가 `expect(locator('text=구버전 로그 1개 제외')).toBeVisible()`에서 timeout으로 실패. 3회 연속 단독 실행해도 매번 동일 지점에서 동일하게 실패(전형적 "플래키"와 다른 100% 결정론적 실패).
- **원인(2026-07-06 Sonar 데스크탑 재현 QA로 특정):** 이 스펙의 zip fixture(`zip-legacy`)는 파일 내 고정 앵커 `const NOW = Date.parse('2026-06-11T12:00:00Z')` 기준 상대 오프셋(`ISO(6)` = NOW의 6일 전 = 2026-06-05T12:00Z)으로 `createdTime`을 만든다. 그러나 앱이 실제로 "최근 30일" 필터를 계산하는 기준(`src/screens/DataScreen.tsx:1064` `since = Date.now() - chip.days*86400_000`, `src/lib/recoverFromDrive.ts:128-134` `inRange`)은 **실제 벽시계 시각**이다. 테스트 작성 시점(대략 2026-06-11 전후 추정)엔 통과했겠지만, 실제 날짜가 흘러 `zip-legacy`의 고정 offset이 진짜 "최근 30일" 창 밖으로 밀려난 시점부터는 **매 실행마다** 실패하도록 되어 있었다(`zip-legacy`가 legacy로 "분류돼 배제"된 게 아니라 애초에 기간 필터에서 통째로 걸러짐 — DOM엔 `구버전 로그 N개 제외`도 `failedZips`도 안 뜸). 코드베이스에 이미 정답 패턴이 있었다: `tests/session-local-date.spec.ts`가 `page.clock.setFixedTime(...)`로 이런 드리프트를 원천 차단하는데, `recover-drive.spec.ts`는 이 패턴을 안 썼다(`NOW` 상수만 파일 안에 정의해두고 앱이 실제로 참조하는 `Date.now()`는 고정하지 않음).
- **해결:** `recover-drive.spec.ts`의 `bootApp()`(모든 W6/W8 테스트가 공유하는 부팅 헬퍼) 맨 앞에 `await page.clock.setFixedTime(new Date(NOW))`를 추가 — `session-local-date.spec.ts`와 동일 패턴으로, zip fixture의 고정 앵커와 앱이 보는 "현재 시각"을 동기화한다. **앱 코드(`recoverFromDrive.ts`/`DataScreen.tsx`)는 무변경** — 순수 테스트 픽스처 버그이며 "최근 30일은 실제 시각 기준"이라는 앱 로직 자체는 의도대로 정상 동작 중이었다(회귀 아님).
- **검증:** 단독 실행 3회 연속 전부 통과(결정론적 수정 확인) + 전체 회귀(`npx playwright test`, 479 passed) 통과.
- **출처:** `2026-07-06 v0.27.0 데스크탑 재현 QA(Sonar 2차 라운드)`, `~/projects/survey-011-test-harness/qa-antigravity/results/c1-w8-flaky-results.md` → **survey-011 v0.28.0** 수정.
- **현재 상태:** ✅수정됨(`tests/recover-drive.spec.ts` `bootApp()`). 방치 시 `zip-new`(ISO(2))도 며칠 내로 같은 방식으로 30일 창 밖으로 밀려나 더 이른 단계에서 실패했을 것 — 이번 수정으로 실행 시점과 무관하게 항상 통과.

### [ENV-11] 테스트들이 IDB open 버전을 하드코딩 — 앱 DB_VERSION bump 시 일괄 VersionError
- **증상(선제 발견, 실패 전 차단):** `src/lib/db.ts`의 `DB_VERSION`을 4→5로 올리자(v0.33.0 10-B `screenshots` 스토어 신설) 테스트 ~15개 파일이 `indexedDB.open('survey-011', 4)`를 하드코딩하고 있어, 앱이 먼저 부팅해 DB를 v5로 올린 뒤 테스트 시딩이 낮은 버전으로 열며 **VersionError**로 전부 깨질 상황이었다([ENV-3] "버전 하드코딩" 계열의 IDB 판).
- **원인:** 시딩 헬퍼들이 앱 스키마 버전을 복제(하드코딩). 일부(pre-boot 시딩 5곳)는 자체 `onupgradeneeded`로 앱 스키마 미러까지 들고 있어, 스토어 추가 시 미러도 함께 갱신해야 한다.
- **해결·회피:** ① 전 테스트 `open('survey-011', 4)` → `5` 일괄 치환 + 스키마 미러 6곳(`v54-voice-data`·`settings-migration`·`recover-list-stage`·`sync-header-mapping`·`sync-skip-rows`·`sync-token-expiry`)에 `screenshots` 스토어 추가. ② 앱 `deleteSession`은 `objectStoreNames.contains('screenshots')` 방어 — 구스키마 DB(미갱신 미러)에서도 cascade가 throw하지 않는다. **다음 DB_VERSION bump 때도 같은 일괄 갱신 필요**(grep `indexedDB.open('survey-011'`). 사후 시딩(post-boot)은 버전 인자 없이 여는 게 근본 회피지만, pre-boot 시딩은 스키마 미러가 필요해 버전 명시가 불가피 — 미러와 앱 upgrade 블록을 함께 고칠 것.
- **출처:** `2026-07-13 세션` (survey-011 v0.33.0 항목10-B 작업 중)
- **재발 1회(2026-07-13, v0.33.0 항목11 DB v5→6):** 리터럴 grep(`indexedDB.open('survey-011'`)로 27곳을 치환했는데 `v54-voice-data.spec.ts`만 **상수 변수 형태**(`const DB_VERSION = 5` → `open(dbName, dbVersion)`)라 grep을 빠져나가 11케이스 VersionError. **체크리스트 보강: 리터럴 grep + `grep -rn "DB_VERSION" tests/`(변수 형태) 둘 다 돌릴 것.** 스키마 미러 6곳에는 `feedbackQueue`(keyPath:'id', autoIncrement)도 추가됨.
- **근절(2026-07-16, v0.35.1 Stage 1-5):** `tests/fixtures/idb.ts` 신설 — 이름·버전은 앱 `db.ts`의 export를 재수출(SSOT), 스키마 미러는 `applyAppSchema` **한 벌**(브라우저 주입용 소스 문자열 제공). 사후(post-boot) 시딩 27곳은 **버전 무지정 open**으로, pre-boot 시딩 6곳은 fixture 주입으로 전환. `tests/idb-fixture.spec.ts` 가드가 버전 하드코딩 재유입을 테스트로 차단한다. **다음 bump 절차 = `db.ts` DB_VERSION 올리고 fixture `applyAppSchema`에 신규 스토어 반영, 끝** (grep 체크리스트 불필요).
- **현재 상태:** ✅근절(픽스처 SSOT + 가드 spec — 2026-07-16)

### [ENV-12] ESLint max-lines(500) 예외 목록 — GL-006 헌장 §5 도입 시점의 기존 초과 파일
- **배경:** 공통 개발 헌장(GL-006, 민구 채택 2026-07-16) §5 — 파일 크기는 책임 크기의 신호(권장 150~250줄, 300줄 분리 검토, **500줄 리팩토링 대상**). v0.35.1 Stage 1-8에서 ESLint `max-lines`(500, `src/` 한정)를 오류 게이트로 도입(`npm run lint`, predeploy에 포함).
- **예외(파일 상단 `eslint-disable max-lines`, 해소 시 주석 제거 + 이 목록에서 삭제):**
  1. `src/lib/useVoiceSession.ts` (**3,112** — v0.38.0에서 3,244→3,112) — **Stage 3(v0.35.3)에서 코어
     재설계 완료**(판별 유니온·resolveFinal 결정표·clipPointer/trendEvaluate 모듈·logCell·
     proceedAfterCommit — 무효 상태 조합은 이제 컴파일이 차단). 줄수 해소는 후속 서브 훅 시리즈
     (클립 캡처 `useClipCapture` → persist → 내비게이션 순, ref 공유 없는 인터페이스)로 계속 —
     v0.34~35 기능 유입으로 플랜 당시 추정(1,200~1,500 잔존)보다 몸집이 커서 한 릴리스에 끝내지
     않고 릴리스당 1개 서브 훅씩 검증하며 진행.
     - ✅ **v0.38.0: `useClipCapture` 분리 완료**(서브 훅 #1 — 셀별 재시도·명령 클립 인덱스,
       in-flight 저장 장부). 다음은 **persist**(`persistSession`), 그다음 내비게이션.
     - ⚠️ **분리 시 identity 계약 주의:** 노출 함수를 `useCallback(..., [])`로 고정해야 한다.
       호출부 `logCell`이 비메모이즈라 의존성에 그대로 넣으면 매 렌더 새 identity가 되고, 그
       함수들이 `handleFinal`의 의존성 배열에 있어 **매 렌더 handleFinal 재생성 → STT 배선이
       요동**친다. 주입 deps는 ref로 받아 흡수한다(`useClipCapture`의 `depsRef` 패턴).
  2. ~~`src/screens/SettingsScreen.tsx`~~ — ✅ v0.35.2 Stage 2에서 해소(components/settings 16파일 + useSettingsActions 훅 분리, 3,114→489줄)
  3. ~~`src/screens/DataScreen.tsx`~~ — ✅ v0.35.2 Stage 2에서 해소(components/data 15파일 + useDataActions 훅 분리, 2,420→315줄)
  4. ~~`src/screens/VoiceScreen.tsx`~~ — ✅ v0.35.2 Stage 2에서 해소(components/voice 7파일 추출, 1,342→174줄)
  5. `src/lib/audioRecorder.ts` (**673** — v0.38.0에서 906→673) — 마이크 PCM 캡처 탭을
     `micPrerollTap.ts`(287줄)로 분리했다(링버퍼·입력 레벨·시간영역 파형). 공개 API는 위임
     메서드로 유지해 호출부 수정 0.
     - ⚠️ **남은 673줄의 분리 경계는 자명하지 않다.** 원안이던 "장치·스트림 생명주기 / 클립 녹음"
       2분할은 **`init`·`recoverStream`·`dispose`가 양쪽을 가로질러** 오케스트레이션이 두 클래스로
       찢어진다. 프리롤 탭을 먼저 자른 이유가 그것 — 클립 경로와의 접점이 `startClip`의
       AudioContext 재개 1곳뿐이라 경계가 깨끗했다. 다음 분리는 **별도 설계 필요**.
     - **순서 계약(불변):** 캡처 그래프 `detach()`는 **항상 `stream.stop()`보다 먼저**다
       (source가 stream을 참조 — 뒤집히면 그래프 누수).
  6. `src/lib/pastValues.ts` (573) — 과거값 인덱스 도메인, 분리 경계 검토 후 해소
  7. `src/lib/sheets.ts` (545) — Sheets API 도메인, 분리 경계 검토 후 해소
  8. `src/stores/settingsStore.ts` (~521) — persist migrate 이력 포함, 분리 경계 검토 후 해소
  9. `src/lib/speech.ts` (~514) — STT 컨트롤러, 분리 경계 검토 후 해소
- **규칙:** 신규 파일은 예외 금지(500 초과 = lint 실패). 기존 예외 파일에 코드를 얹기 전에 분리를 먼저 검토한다(GL-006 AI 행동 규칙 #4). 기계적 part1/part2 분할 금지 — 경계는 항상 책임 단위.
- **출처:** GL-006 채택 + v0.35.1 리팩토링 (2026-07-16)
- **현재 상태:** ⚠️주시 (Stage 2·3 진행에 따라 순차 해소)

---

## ⑥ 인증 · Drive

### [AUTH-3] 자동 로그 업로드가 기본 ON + 대상 폴더 불투명
- **증상:** 사용자가 모르는 사이 로그/클립이 특정 Drive 폴더로 전송, 대상이 안 보임.
- **원인:** `autoUploadLogs` 기본값 true, 대상 `LOG_FOLDER_ID`가 코드 안에 숨음.
- **해결·회피:** 기본값 **false**(명시 활성화 후에만 동작), 토글 활성 시 폴더 ID를 UI 모노스페이스 박스에 표시(대상 가시화). 토큰에서 검증된 이메일(`getCurrentEmail()`) 사용 + 이메일 형식 검증(폴더명 인젝션 방지).
- **출처:** `growth-survey-010@e207513`(기본 OFF + 가시화), `growth-survey-010@55bb61e`(토글), `growth-survey-010@8ce8dca`(검증된 이메일)
- **현재 상태:** ⚠️주시 (survey-011 `src/lib/driveUpload.ts`/설정 화면의 기본값·가시화 점검 권장)

### [AUTH-4] 앱 OAuth 토큰에 refresh token 없음 → 헤드리스 수확 불가
- **증상:** 앱 브라우저 OAuth로 받은 토큰엔 refresh token이 없어, 헤드리스로 Drive 데이터를 자동 수확 못 함.
- **원인:** 인앱 OAuth 플로우가 refresh token을 발급/저장하지 않음(설계상).
- **해결·회피:** 헤드리스/자동 수확은 **GCP 서비스 계정**으로 한다. MCP는 zip을 못 읽으니 **디스크로 받아서** 처리. (이건 Mack의 계측/연결 선결 영역.)
- **출처:** `2026-06-04~05 세션`
- **현재 상태:** ⚠️주시 (자동 수확 파이프라인은 미배선 — Mack 선결)

### [AUTH-5] 내보낸 voice-log zip의 오디오는 audioFileId가 아닌 log.id로 명명
- **증상:** zip 안 오디오 파일이 `audioFileId` 필드가 가리키는 곳에 없음.
- **원인:** zip 익스포트가 오디오를 `log.id`로 명명.
- **해결·회피:** 익스포트 zip의 오디오 클립은 `log.id`로 매칭해서 샘플링/디버깅하라.
- **출처:** `debug-log`(2026-04-17)
- **현재 상태:** ⚠️주시 (survey-011 ZIP 구조 점검 시 클립 키 명명 규칙 확인)

---

### [AUTH-6] 구글 첫 로그인 시 `popup_failed_to_open` → 2번 눌러야 로그인
- **증상:** 설정탭에서 구글 로그인을 처음 누르면 `popup_failed_to_open` 알림이 뜨고, 한 번 더 눌러야 로그인 창이 열림.
- **원인:** `signIn()`이 팝업을 열기 **전에** `await loadGisScript()`(네트워크 스크립트 로드)를 기다려, 팝업이 user-gesture task를 벗어남 → 브라우저가 팝업 차단. 둘째 클릭은 스크립트가 캐시돼 있어 동작.
- **해결·회피:** GIS 스크립트 + 토큰 클라이언트를 **사전 로드**(`warmupGoogleAuth()`를 SettingsScreen 마운트에서 호출). `signIn()`은 토큰 클라이언트를 한 번만 생성하고 **클릭 제스처 내에서 동기적으로** `requestAccessToken()` 호출. cold 케이스(워밍업 미완료)만 기존처럼 로드 후 호출(2번째 클릭에서 fast-path). `error_callback`의 `popup_failed_to_open`/`popup_closed`는 사용자 친화 메시지로 매핑.
- **출처:** `2026-06-05 세션`(피드백) → **survey-011 v0.4.1** 수정
- **현재 상태:** ✅수정됨 (`src/lib/googleAuth.ts` `warmupGoogleAuth`/동기 `requestAccessToken`, `src/screens/SettingsScreen.tsx` 마운트 워밍업) — 실기기 OAuth 팝업은 device 확인 필요.

---

### [AUTH-7] "스프레드시트 링크가 풀린다" — 실체는 OAuth 토큰 만료([AUTH-4])를 UI가 '연결됨'으로 거짓 표시
- **증상(민구 제보):** 앱 업데이트·새로고침·강제종료 뒤 스프레드시트 연결이 풀려, 매번 Drive에서 공유링크를 복사해 다시 붙여넣어야 함.
- **원인(코드 추적 확정):** 진짜 원인은 localStorage 소실(eviction)이 **아님**. 민구 확인 — "**연결 직후 새로고침은 안 풀리고 한참 뒤에만** 풀린다"(시간 의존=토큰 만료, eviction이면 즉시 새로고침에도 풀려야 함). 암시적 OAuth 토큰은 refresh token이 없어 약 1시간이면 만료([AUTH-4], `googleAuth.ts:89` expires_at<now+60s면 null)인데, `googleConnected`는 zustand persist로 통째 저장돼 true로 재하이드레이트된다. 마운트 effect(`SettingsScreen.tsx`)는 토큰 있으면 true로 **승격만** 하고 토큰 소실 시 false로 **강등하는 경로가 없었다** → UI는 '연결됨 · 이메일'을 거짓 표시하지만 `getAccessToken()`=null이라 모든 시트 읽기/쓰기(`sheets.ts:29 authFetch`)가 실패. 사용자는 '풀렸다'고 느끼고 URL 재붙여넣기를 시도하나 그것도 authFetch라 토큰 없이는 실패.
- **해결·회피(v0.13.0 R1):** ① 마운트 effect에 **강등 분기** — 토큰 없으면 `googleConnected:false`로 내려 '재로그인 필요'를 정직하게 노출. ② **저장 시트 목록(savedSheets)** — 연결 성공 시 파일명(`fetchSpreadsheetMeta`의 properties.title)으로 자동 등록(sheetId dedupe), localStorage 영속(persist v7→**v8**). 매번 붙여넣지 않고 목록에서 탭 1회로 재선택. ③ **재로그인 후 자동 재연결** — `onGoogleClick` 성공 시 직전 `sheetUrl`이 있으면 `onUrlConfirmWithUrl(prevUrl)` 자동 호출(재붙여넣기 불필요). 토큰 만료 중 저장목록 선택 시엔 sheetUrl·availableSheets·sheetTab을 함께 비워 'active 배지'와 탭 셀렉터 불일치를 방지(코드리뷰 R1). **한계:** refresh token 부재(설계, [AUTH-4])라 토큰 만료 시 **재로그인 1회는 여전히 필요** — savedSheets는 붙여넣기 수고만 제거. (savedSheets도 localStorage라 진짜 eviction이면 함께 사라지나, 민구 증상은 토큰 만료로 확정돼 해당 없음.)
- **출처:** `2026-06-18 세션`(민구 제보 + 즉시-새로고침 판별) → **survey-011 v0.13.0** 수정
- **현재 상태:** ✅수정됨 (`src/screens/SettingsScreen.tsx` 강등 분기·자동 재연결·저장목록 UI, `src/stores/settingsStore.ts` savedSheets/persist v8, `src/types.ts` SavedSheet) — 실기기 토큰 만료→강등→재로그인→자동재연결 흐름 device 확인 필요. silent token refresh(prompt:none)는 백로그.
- **⚠️ 후속 정정([AUTH-8] 참조, v0.14.0):** 위에서 "eviction은 해당 없음"으로 단정했으나, v0.13.0 실기기 후 민구 추가 제보 — **강제종료뿐 아니라 "일정시간 경과 후 로그인 + URL 등록이 함께" 풀림**. 토큰 강등 코드(`SettingsScreen.tsx:826`)는 sheetUrl을 안 지우므로(확인) URL 동반 소실은 토큰 만료로 설명 불가 → 토큰(별도 localStorage 키 `gs10_google_token`)과 설정(`survey-011-settings-v3`)이 **동시에** 사라지는 = localStorage eviction 정황. [AUTH-8]에서 IDB 미러 + breadcrumb로 대응.

### [AUTH-8] 강제종료/시간경과 후 시트 등록 전체 초기화 — localStorage eviction (추정→계측)
- **증상(민구 제보, v0.13.0 후속):** 앱(사파리) 강제종료 시, 그리고 **일정시간 경과 후에도** 로그인과 스프레드시트 URL 등록이 함께 풀린다([AUTH-7] 토큰 만료와 별개 — URL까지 동반 소실).
- **원인(추정, 계측으로 확정 예정):** 토큰·설정 모두 localStorage 저장 → iOS Safari가 ITP(비설치 탭 7일 캡) 또는 저장압박으로 키를 evict하면 한꺼번에 초기화. zustand persist는 무엇을 저장하는지는 정상(partialize 없음, 전체 저장) — 문제는 저장소 내구성. v0.13.0 로그엔 강제종료→재실행 사이클·설정 하이드레이션 계측이 없어 직접 증명 불가였음.
- **해결·회피(v0.14.0 C):** ① **IDB 내구 미러** — `settingsStore` persist에 커스텀 storage 어댑터(`mirroredStorage`)를 달아 localStorage 1차(동기·기존 동작 보존) + IDB 'kv' 스토어(`db.ts` v3→**v4**) write-through. getItem에서 localStorage가 비면 IDB에서 복원(+`settings_restored_from_idb` 로그). ② **하이드레이션 breadcrumb** — boot 시 `settings_hydrated:url=Y/N,cols=N,saved=N,token=Y/N`(`onRehydrateStorage`)로 다음 테스트에서 eviction 여부·복원 작동을 판별. **한계:** 비설치 Safari는 ITP 7일 캡이 IDB에도 적용 — **홈화면 설치(standalone) PWA가 가장 강한 내구**(7일 캡 면제). 미설치면 IDB도 evict될 수 있어, 설치 권장이 근본 대비책.
- **출처:** `2026-06-18 세션`(민구 추가 제보) → **survey-011 v0.14.0** 대응. 다음 강제종료/시간경과 실기기 로그의 `settings_hydrated`/`settings_restored_from_idb`로 확정.
- **현재 상태:** ⚠️주시 (`src/stores/settingsStore.ts` mirroredStorage+breadcrumb, `src/lib/db.ts` kv 스토어) — eviction 진위·standalone 설치 여부 device 확인 필요.
- **✅ 후속(`2026-06-19 v0.14.0 실기기 로그`):** boot `settings_hydrated`가 11:07~13:54 구간 전부 `token=Y,url=Y`(Y→N flip 없음) → **이 윈도우에선 eviction 미재발**(IDB 미러 내구 보유). 단 민구는 "홈화면 설치형에서 시간경과 후 로그인 풀림"을 보고 — eviction 자체는 별 윈도우에서 재발 가능(장기경과 표본 필요). **재로그인 불가('로그인 중…' 멈춤)는 eviction이 아니라 별개 레이어 = 신규 [AUTH-9]**(GIS 콜백 wedge)로 분리.

### [AUTH-9] eviction 후 재로그인 시 "Google 로그인 중…" 영구 멈춤 — GIS tokenClient 콜백 wedge (standalone PWA)
- **증상(민구 제보, v0.14.0 실기기):** 아이폰 홈화면 설치형(standalone)에서 시간경과 후 구글 로그인이 풀린 뒤([AUTH-8] eviction, 저장된 시트는 유지), **재로그인을 누르면 "Google 로그인 중…" 문구가 뜬 채 진행이 멈춰 로그인 불가**. **아이폰 재부팅 후에야** 로그인 완료.
- **원인(Trace 로그분석 + 코드 추적 확정):** `onGoogleClick`(`SettingsScreen.tsx:847`)이 `await googleSignIn()`만 기다리는데, `googleSignIn()`(`googleAuth.ts:135-166`)은 GIS `tokenClient`의 **콜백으로만 settle**된다. standalone PWA에서 그 콜백이 미발화하면 promise가 **영구 hang** → `onGoogleClick`의 `finally{ setLoading(null) }`이 안 돌아 "로그인 중…"에 고착. `tokenClient`/`pending`이 **module-level 싱글톤**이라 reload 없는 standalone에선 **프로세스 kill(재부팅)만이 해소** = 증상 정확 일치. (eviction[AUTH-8]과 **별개 레이어** — eviction은 IDB 미러로 방어, 본 항목은 콜백 wedge.)
- **해결·회피(v0.15.0 A7):** ① `signIn()`에 **15s 타임아웃**(`SIGNIN_TIMEOUT_MS`) — 미발화 시 reject + `resetTokenClient()`로 `tokenClient` 싱글톤 폐기(재시도 시 새 클라이언트 생성, 재부팅 불필요). ② `settlePending()` 단일 settle 게이트(`settled` 가드) — 늦게 온 콜백 안전 무시. ③ `onGoogleClick` `finally`로 로딩해제 항상 보장. ④ **인증 계측 5종**(`auth_signin_start`/`auth_token_settled:ms=,late=`/`auth_signin_timeout:ms=15000`/`auth_tokenclient_reset`/`auth_signin_error:<type>`) — `late=true`로 standalone 콜백이 '영구 미발화'인지 '지각 발화'인지 다음 로그로 판별.
- **출처:** `2026-06-19 v0.14.0 실기기 로그`(민구 제보 + Trace 분석) → **survey-011 v0.15.0** 수정.
- **✅ 후속 수정(v0.29.0, Mack) — 15s 타임아웃이 실제 2FA보다 짧았고, A7 자체의 settle-게이트가 지각 성공의 구독자 알림까지 함께 삼켰다:**
  - **증상(출처: `2026-07-07 v0.28.0 A5 업로드 테스트(Sonar, 실 Google 계정)`):** 실 2FA가 ~60초 걸린 실행에서, 설정 탭에 "로그인 응답이 지연되어 취소되었습니다" 오류가 표시됐다. 그런데 `localStorage`(`gs10_google_token`)를 직접 열어보면 토큰이 **정상 저장돼 있었다** — UI는 실패로 믿지만 실제 인증 상태는 성공. 설정 탭을 재마운트(새로고침/탭 이동)해야만 `googleConnected`가 뒤늦게 true로 동기화됐다.
  - **원인(코드 추적 확정):** ① `SIGNIN_TIMEOUT_MS=15_000`(v0.15.0 A7)이 관측된 실제 2FA 소요시간(~60초, OTP 앱 전환 포함 시 더 김)보다 짧아 진행 중인 정상 로그인을 조기에 "지연 취소"로 오분류했다. ② 더 근본적으로, A7 자체가 심어둔 잠복 결함: 타임아웃이 먼저 발화하면 `settlePending()`이 `pending=null`로 비우는데, 그 **뒤에** 도착하는 GIS 콜백은 `storeToken(...)`을 무조건 실행해 토큰을 실제로 저장하지만, 뒤이은 `settlePending({ok:true,...})` 호출은 `if (!p || p.settled) return`(이미 null) 가드에 막혀 **완전 no-op**이 된다 — v0.22.0 P1이 만든 `notifyTokenSettled` 구독 메커니즘조차 **이 경로에선 정의상 한 번도 발화할 수 없었다**(호출 자체가 이 가드 안쪽에 있었으므로). 그 결과 원래 `signIn()` 호출자는 reject된 promise만 보고 "로그인 실패" 토스트를 띄우고, 토큰이 실제로 있다는 사실은 재마운트가 `getStoredToken()`을 다시 읽을 때까지 아무도 몰랐다.
  - **해결(v0.29.0):** ① `SIGNIN_TIMEOUT_MS` 15s → **120s**로 완화(현실적 2FA 상한). ② `notifyTokenSettled` 호출을 `settlePending`의 settle-게이트 **밖으로 분리** — `tokenClient` 콜백에서 `storeToken()` 직후 pending 상태(이미 타임아웃으로 settle됐는지)와 **무관하게 항상** 호출한다. `settlePending()`은 이제 "이번 `signIn()` promise를 resolve/reject할지"만 결정하고, "토큰이 실제로 확정됐다"는 알림은 별도로 나간다. ③ `SettingsScreen.tsx`가 `onTokenSettled`를 구독해 리마운트 없이 `googleConnected`/`userEmail`을 반응적으로 갱신(기존엔 mount effect에서만 `getStoredToken()`을 1회 읽었음).
  - **잔여 한계(정직하게 명시):** 120s도 유한한 상한이므로 이론상 이보다 더 느린 2FA는 여전히 최초 타임아웃 배너를 볼 수 있다 — 다만 이제는 그 뒤 지각 성공이 도착하면 리마운트 없이 자동으로 정정된다(늦게라도 정직하게 복구). 원 `signIn()` 호출자의 promise 자체는 이미 reject된 채로 남는다(JS promise는 재resolve 불가) — 현재 `onTokenSettled` 구독자는 `SettingsScreen`과 `useVoiceSession`(과거값 재프리페치용) 둘뿐이니, `signIn()`을 직접 await하는 다른 호출부가 추가되면 그쪽도 late-success 반영을 위해 별도로 구독해야 한다.
  - **회귀:** `tests/auth-signin-timeout.spec.ts` — `page.clock`으로 120s 가상 경과 후 지각 콜백이 리마운트 없이 반영되는지, 그리고 타임아웃 전 정상 도착하는 흔한 케이스가 무회귀인지 둘 다 검증.
  - **출처:** `2026-07-07 v0.28.0 A5 업로드 테스트(Sonar, 실 Google 계정)` → **survey-011 v0.29.0** 수정.
- **현재 상태:** ✅수정됨(`src/lib/googleAuth.ts` SIGNIN_TIMEOUT_MS/notifyTokenSettled 분리, `src/screens/SettingsScreen.tsx` onTokenSettled 구독) — 실기기에서 ① 실제 60초+ 2FA가 120s 창 안에서 타임아웃 없이 완료되는지 ② 만에 하나 120s를 넘겨도 지각 성공이 리마운트 없이 반영되는지 device 확인 권장.

### [AUTH-10] ⚠️ 운영 전제 — 과거값 무인증 read(API key)는 "시트 링크 공개"와 "로그아웃은 읽기 경계가 아님"을 전제한다 (v0.34.0 C9)

- **무엇:** v0.34.0부터 과거값 인덱스(이상치 알람 비교선) 조회가 OAuth 토큰이 없을 때 **Google API key + 공개 시트 read**로 폴백한다(`sheets.ts` `planValuesReadonly`/`readonlySheetsAuth`, `pastValues.ts`). 미로그인·토큰 만료 상태에서도 알람이 살아 있게 하려는 조치(민구: "시트가 연결되면 자동으로 작동해야 함").
- **⚠️ 이건 결함이 아니라 명시해야 할 운영 전제다(v0.34.0 코드리뷰 Codex Medium + agy-Flash Critical/Medium 지적, 민구 확정 2026-07-14 = **시트 공개 상태이며 허용됨 → 경로 유지 + 문서화**):**
  1. **시트가 "링크 있는 누구나(뷰어)" 공개여야 이 경로가 성립한다.** 비공개면 403이며 폴백 알람은 동작하지 않는다(이 경우 조용히 skip — v0.34.0 리뷰 반영으로 재시도도 즉시 차단, `past_index_retry_blocked:permission`).
  2. **로그아웃은 읽기 권한 경계가 아니다.** 로그아웃해도 저장된 시트 URL + 번들 API key로 해당 탭을 계속 읽는다. "로그아웃했으니 이 기기에서 시트 내용을 못 본다"는 기대는 **틀리다**.
  3. **spreadsheetId가 노출되면 제3자도 무인증으로 그 시트를 읽을 수 있다**(공개 시트의 본질적 성질 — 앱 결함이 아니라 공개 설정의 귀결). 농가명 등 식별정보가 들어가는 시트라면 이 점을 인지하고 운용해야 한다.
  4. **API key는 클라이언트 번들에 포함된다**(Vite `VITE_*`). 네트워크 탭·번들 검사로 취득 가능하므로 **GCP 콘솔에서 반드시 제한을 걸 것**: ① API 제한 = Sheets API(read) + Drive Picker 용도만 ② HTTP 리퍼러 제한 = 배포 도메인(`mingoojejuagrikang-crypto.github.io`). 제한이 없으면 키 도용·쿼터 소모가 가능하다.
  5. **쓰기는 여전히 OAuth 전용**(`sync.ts` `authFetch`) — 무인증 경로로는 시트를 수정할 수 없다(agy-Pro 확인).
- **키 스코프 주의(Codex Medium):** 무인증 read는 기존 **Drive Picker용 키를 재사용**한다(`drivePicker.ts`). 그 키가 Drive API로만 제한돼 있으면 **Sheets GET이 실패**한다 — 위 4번의 API 제한에 Sheets read를 반드시 포함시켜야 한다.
- **계측:** `past_index_fetch_start:auth=token|apikey`로 어느 수단으로 준비됐는지 로그만으로 판정 가능. 권한 실패는 `past_index_skip:<HTTP 403…>` + `past_index_retry_blocked:permission`.
- **회귀:** `tests/v034-past-index-apikey.spec.ts` — key 경로의 `?key=` 쿼리·Authorization 부재, 토큰 경로의 key 미노출, 403 재시도 차단.
- **현재 상태:** ✅전제 확정·문서화됨(민구 2026-07-14: 시트 공개 상태·허용). **잔여 운영 액션:** GCP 콘솔에서 위 4번 키 제한(Sheets read 포함 + 리퍼러) 실제 적용 여부 확인 — 미적용 시 키 도용 위험이 남는다.

### [CLIP-LOSS-1] 입력장치 변경(BT↔스피커폰)이 MediaRecorder를 죽여 이후 클립 연속 소실
- **증상:** 한 세션 중반부터 음성 클립이 연속으로 통째 소실(값 인식·시트 기록은 정상, 클립만 없음). v0.13.0 로그 세션 `8409` row 11~18(18개 연속) 트림·raw 모두 부재.
- **원인(로그+민구 현장 관찰):** error 이벤트 `clip_empty`→`clip_too_small:5`/`clip_cmd_empty:null` 반복 = MediaRecorder가 5바이트 빈 청크만 생성(레코더 dead). 초기 행은 `clip_stop_resolved:30000~50000`바이트로 건강 → 중간에 오디오그래프가 죽음. 민구: 입력장치(스피커폰/블루투스) 변경 의심. 앱은 자기 speakerphone 토글만 로깅하고 **OS 라우팅 변경(BT 분리/재연결)은 미로깅** → iOS에서 라우팅 변경이 활성 트랙을 끊으면 MediaRecorder가 빈 데이터만 뱉는데, 앱은 **재-getUserMedia를 안 해([IOS-5])** 복구 못 함 → 이후 전 클립 사망.
- **해결·회피(v0.14.0 B-1):** `audioRecorder.recoverStream(reason)` 신설 — 빈/극소 클립 감지(`useVoiceSession` clip_empty/clip_too_small 분기) 또는 유휴 중 devicechange 시 스트림을 **재획득**(re-getUserMedia + 프리롤·리스너 재구성). 쿨다운 `RECOVER_COOLDOWN_MS=3000`으로 폭주 방지. 녹음 중 devicechange는 비파괴 라벨 갱신만(진행 클립 보호), 유휴면 전체 재획득(`handleDeviceChange`). 텔레메트리 `clip_recorder_recovered:<reason>:<label>` / `clip_recorder_recover_failed`. **D 배지 staleness와 동일 원인·동일 수정 경로.**
- **주의:** [IOS-5]는 "재-getUserMedia 금지(진행 클립 손실 회귀 방지)"였으나, 본 버그(연속 소실)가 더 큰 손실이라 v0.14.0에서 **제한적 반전**(유휴/실패 시에만 재획득, 녹음 중엔 비파괴). 실기기에서 의도적 BT↔스피커폰 전환으로 검증 필요.
- **출처:** `2026-06-18 v0.13.0 실기기 로그`(세션 8409 연속 clip_empty/too_small) + 민구 현장 관찰 → **survey-011 v0.14.0** 대응.
- **✅ 대폭 완화(`2026-06-19 v0.14.0 실기기 로그`):** `clip_recorder_recovered` 발화 확인 — v0.13.0 **18연속 소실 → 실제 소실 1건**(강남호 row1 c7, 직후 회복)으로 급감. recoverStream 작동 확정. ⚠️ 양승보 세션 "클립이상" 비고 행(rows4/6/9)은 **파일이 전부 건강(28~71KB) = 소실 아님** → 트림/재생 품질 의심([CLIP-TRIM-1] 계열, 별도 청취검증 후보). 민구 보고 "스피커폰 입력 중 일부 소실"과 정합(잔여 1건). 단 이번 3세션은 전부 내장마이크라 BT↔스피커폰 **실제 라우팅 전환** 표본은 부족 — 다음 테스트에서 의도적 전환 검증 지속.
- **현재 상태:** ⚠️주시(완화) (`src/lib/audioRecorder.ts` recoverStream/handleDeviceChange, `src/lib/useVoiceSession.ts` 트리거; 2026-06-19 18→1건 급감) — BT 실제전환 표본 추가 필요.

### [TREND-RETRY-1] 이상치 알람 미작동 — 과거 인덱스 로드 1회 실패 후 세션 내내 재시도 없음
- **증상:** 이상치 알람을 설정(감소+변동률)하고 값을 입력해도 어느 값에도 알람이 안 뜸.
- **원인(로그 확정):** v0.13.0 로그 `past_index_ready` **0건** + `past_index_skip:Load failed` 2건(두 세션 모두 start 직후 ~27ms). 모든 commit이 `trend_skip:no_index`. **인증·연결은 정상**(같은 세션 `syncedRows:18 synced` — 시트 쓰기 성공) → prefetch가 너무 일찍 발사돼 `fetchAllRowsUnbounded`가 iOS Safari transient "Load failed"로 던졌고, `loadPastIndex` 실패는 캐시 안 되지만 **아무도 다시 안 부름**(prefetch 1회 + `evaluateTrend`는 `getCachedIndex`만 읽음) → 세션 내내 인덱스 없음. (토큰/re-auth와 무관 — [AUTH-7]과 별개.)
- **해결·회피(v0.14.0 A):** `pastValues.ensurePastIndex()` — 반복 호출 안전한 백오프 재시도(0.6→4.0s, 최대 5회, 캐시/in-flight/예약 중 no-op). `prefetchPastIndex`가 이를 호출하고, `evaluateTrend`도 캐시 미스마다 nudge → 입력 이어가는 동안 인덱스가 살아남. `resetPastIndexRetries()`로 세션 시작 시 카운터 리셋. 비교 키는 현행 샘플키(`inferSampleKey`=auto·비date = 농가명·라벨·처리·조사나무·조사과실)로, 민구 멘탈모델("음성값 외 항목 조합")과 일치 — 변경 없음. 인덱스 복구 시 [ALERT-1/AREA2 V2] 직전 조사일(`prevDate`) 표시도 함께 살아남(이미 구현됨, no_index로 안 떴을 뿐).
- **출처:** `2026-06-18 v0.13.0 실기기 로그`(past_index_ready 0건) → **survey-011 v0.14.0** 수정.
- **✅ 종결(`2026-06-19 v0.14.0 실기기 로그`, 3세션):** `past_index_ready` **6회**(v0.13.0 0회 대비), `trend_alert_fired` 45 / confirmed 20 / corrected 25, payload에 `previousValue` 포함. 한 세션은 start 직후 `trend_skip:no_index` 후 ~2초 만에 `past_index_ready`로 **백오프 재시도 복구** 확인 — 세션 내내 알람 정상 작동. 민구 현장 보고 "이상치·변동률 알람 모두 작동"과 일치. 직전 조사일(prevDate) 팝업 표시만 시각 잔여(경미).
- **현재 상태:** ✅수정됨·실기기 확정 (`src/lib/pastValues.ts` ensurePastIndex/resetPastIndexRetries, `src/lib/useVoiceSession.ts` nudge+reset; 2026-06-19 로그 past_index_ready 6회 작동확인).

### [CLIP-TRIM-1] 트림이 값 구간을 잘라 재생 시 값 안 들림 — 단, 실패의 대부분은 캡처 문제
- **증상:** 기록된 음성 클립 재생 시 정상 값 청취 불가(편집 오류).
- **원인(전사 분석 확정):** v0.13.0 클립 91개를 ffmpeg+whisper로 전사·대조 → OK 35%, SILENT/환각 25%, MISMATCH 20%, NO_CLIP 20%. **실패의 ~45%(SILENT+NO_CLIP)는 캡처 문제**(값이 raw에도 없음 = [CLIP-LOSS-1] 계열, whisper가 무음에 "고맙습니다"/"오케이" 환각). 트림 자체 결함은 일부 — `audioTrim.findSpeechSegments`가 peak=max(|sample|) 기준이라 초반 transient(클릭/팝/TTS잔향)가 peak를 올리면 실제 발화가 thr 미만으로 묻혀 엉뚱한(무음) 구간만 보존.
- **해결·회피(v0.14.0 B-2):** ① `robustPeak` — 기준 피크를 max 대신 상위 97백분위(transient 둔감). ② **과소 트림 floor** — 트림 결과가 `MIN_KEPT_MS=600` 미만이고 원본은 그 이상이면 트림 포기(전체본 유지) → 값 잘림 방지. **검증:** 실제 raw 73개에 신규 로직 재적용+재전사 → OLD 44%→NEW 45%, **회귀 0·구제 1**(무회귀 안전, 트림은 2차 문제 확인). **지배적 수정은 [CLIP-LOSS-1] 캡처 신뢰성.**
- **출처:** `2026-06-18 v0.13.0 클립 전사 분석`(/tmp/clip_analysis.json) → **survey-011 v0.14.0**.
- **현재 상태:** ✅수정됨(무회귀 검증) (`src/lib/audioTrim.ts` robustPeak/MIN_KEPT_MS) — 캡처 회복(B-1)과 함께 실기기에서 청취 개선 확인 필요.

### [TREND-AUTH-1] 이상치 알람이 구글 로그인 지연 시 전 세션 미작동
- **증상:** 음성입력 시 이상치(추세·범위) 알람이 일부 세션에서 안 뜬다.
- **원인:** `useVoiceSession evaluateTrend`가 직전값을 과거 시트 인덱스(`pastValue`)에서 가져오는데, 인덱스가 없으면 `trend_skip:no_index`로 조용히 스킵. 그 인덱스는 세션 start() 시 `getAccessToken()`이 토큰을 반환할 때만 프리페치(트리거 1곳뿐, `:1820`). 토큰이 늦거나(`auth_token_settled late=true`) 타임아웃(`auth_signin_timeout`)이면 프리페치 안 됨 → 전 세션 알람 미작동.
- **해결:** v0.22.0 — `googleAuth.settlePending` 성공경로에 `onTokenSettled` 구독훅 추가, useVoiceSession이 구독해 **토큰 지각 도착 시 재프리페치**(`resetPastIndexRetries`+`prefetchPastIndex`, 남은 셀부터 알람 복구). start()의 1회 프리페치는 유지.
- **한계(설계상):** 토큰 도착 **전** 입력한 셀, 타임아웃/오프라인 세션은 여전히 알람 불가 — 회차간 비교는 시트 과거값이 필요하므로 불가피.
- **출처:** `2026-06-25 v0.21.0 실기기 로그`(`auth_signin_timeout:15000`×2·late settle 17~19s; 단 토큰 일찍 온 이 세션에선 trend 10회 정상 발화 → "일부 세션"과 일치; firsthand 코드 확인).
- **현재 상태:** ✅수정됨(v0.22.0 `googleAuth.ts`·`useVoiceSession.ts`) — 지각 토큰 복구 실기기 검증 대기.

---

## ⑦ 리뷰 프로세스 교훈

### [REVIEW-1] 빈 catch가 근본 버그를 수개월 가렸다
- **교훈:** [CLIP-1]의 핵심. 빈 `catch{}`가 iOS 클립 저장 실패를 삼켜 "에러 0건"으로 보이게 함. **모든 영속화/네트워크 실패는 로깅하라.** "에러 없음"은 "성공"이 아니다. 진단 계측(breadcrumb)을 먼저 깔고 실기기 로그로 근본 원인을 확정하라.
- **출처:** `growth-survey-010@c8dd276`, `@fd3177a`

### [REVIEW-2] adversarial review는 데이터 유실을 잡는다 — 여러 회차 돌려라
- **교훈:** Codex adversarial review가 v5.2에서만 **3~5차**에 걸쳐 CRITICAL/HIGH 데이터 유실·유출을 연속 발견했다(autoDelete 미업로드 삭제, 미동의 데이터 유출, dispose race, recorder 오염, partial sync 백업 누락). 한 번의 리뷰로 끝내지 말고, 특히 **삭제·업로드·정정 경로**는 반복 검증하라.
- **출처:** `growth-survey-010@a36b4da, @55bb61e, @e207513, @a5950f0, @9a9c004, @8ce8dca, @79cbf2c`(Ultrareview), `@dae3e2f`(gpt-5.5)

### [REVIEW-3] "best-effort"라는 말이 게이트를 같은 날 두 번 뒤집게 했다
- **교훈:** [AUTH-1]의 핵심. 리뷰 판단("백업은 best-effort")만 믿고 안전 게이트를 제거하면, cascade 삭제의 실제 blast radius 때문에 같은 날 도로 복원하게 된다. **삭제의 cascade 범위를 먼저 확인**하고, 안전 게이트를 제거하는 변경은 특히 의심하라.
- **출처:** `growth-survey-010@55bb61e → @ad60ba5 → @222f337`

### [REVIEW-4] 진행 멈춤(silent return)은 reprompt로 — 무음 return 금지
- **교훈:** `stt_rejected_col_name` 같은 거부 경로가 **silent return**하면 음성 세션이 그냥 멈춰 사용자가 영문 모름. 거부 시 **reprompt**(다시 안내)로 흐름을 살려라.
- **출처:** `growth-survey-010@7dd6e8b`(입력-A)
- **현재 상태:** ⚠️주시 (survey-011 거부 경로 점검 권장)

### [REVIEW-5] 날짜 컬럼 '오늘' sentinel을 type=date 입력이 덮어쓴다
- **교훈:** `col.auto.value='오늘'`인 동적 날짜 sentinel을 `type=date` 입력이 표시·편집 못 해 빈 상태가 되고, 사용자가 날짜 선택 시 ISO 리터럴로 덮어써 동적성 상실. `value !== '오늘'`일 때만 `type=date` 사용.
- **출처:** `growth-survey-010@2eea438`
- **현재 상태:** ⚠️주시 (survey-011 날짜 컬럼 설정 점검 권장)

---

## ⑧ 입력 흐름 · 내비게이션

### [NAV-2] "유지" 명령이 인식되고도 무동작(no-op)
- **증상:** 재입력(reentry) 모드 밖에서 "유지"라고 말하면 명령으로 인식은 되지만 아무 동작·음성 피드백 없이 무시됨.
- **원인:** keep 처리가 reentry 모드 한정 분기라 그 밖에서는 silent return — [REVIEW-4] "무음 return 금지"의 재발.
- **해결·회피:** **v0.5.0에서 keep을 일반화** — 현재 칸에 값이 있으면(또는 reentry 중) 그 값을 유지하고 advance, 값이 없으면 "유지할 값이 없습니다. {항목명} 말씀해 주세요." 명시 피드백 + `keep_no_value` 로그(무음 return 금지). `voiceCommands.ts` desc 갱신.
- **출처:** `2026-06-10 실기기 로그` → **survey-011 v0.5.0** 수정
- **현재 상태:** ✅수정됨 (`src/lib/useVoiceSession.ts` keep 분기 line 871~, `src/lib/voiceCommands.ts`) — **2026-06-12 실기기 확인(재입력 안)**: 06-11 v0.6.0 로그 row12에서 "이전"으로 완료행 재진입 후 "유지" 2회(c7 conf .96 / c8 conf .94) → 값 233.3/244.4 보존·정상 진행. ⚠️ 재입력 **밖**(빈 칸) `keep_no_value` 경로는 여전히 미발화 — 다음 테스트 1회 요청.

### [POPUP-CLIP-1] 음성입력 알람 팝업 내부 문자 잘림
- **증상:** 음성입력 중 이상치 알람 팝업에서 긴 항목명·긴 값이 …로 잘리거나 가로로 넘쳐 안 보임.
- **원인:** `AnomalyAlertPopup` 항목명 라벨이 `whiteSpace:nowrap+overflow:hidden+textOverflow:ellipsis`, hero 현재값이 무줄바꿈 `clamp(40~60px)`로 가로 넘침. (z-index/레이어 문제 아님 — 팝업은 이미 fixed 오버레이고 PausedCard>AnomalyAlert는 의도된 상호배타.)
- **해결:** v0.22.0 — 항목명 ellipsis→줄바꿈 허용(`whiteSpace:normal`·`wordBreak:keep-all`·`overflowWrap:anywhere`), 큰 숫자 `maxWidth:100%`+줄바꿈+clamp 하한 축소. CommandHelpPopup·ModifyReentry 동일 점검. z-index 불변(PausedCard 우선순위 보존).
- **출처:** `2026-06-25 v0.21.0 민구 제보` + 375px 시뮬레이션 실측(잘림 0 확인).
- **현재 상태:** ✅수정됨(v0.22.0 `AnomalyAlertPopup.tsx`·`CommandHelpPopup.tsx`·`VoiceScreen.tsx`).
- **⚠️ 2026-07-02 v0.25.0 실기기 — 재오픈 후보(화면 미특정):** 민구 "화면 잘림 문제가 아직 개선되지 않았다" 재제보. 단 **어느 화면인지 미상**이고 로그 단서 0(비고 c9 전 행 공란·TTS 텍스트 미로깅·클립 오디오 전용) — 이 항목(알람팝업)인지 다른 표면(v0.25.0 신규: 데이터탭 큰팝업 `DataScreen.tsx:712,877,1120` maxHeight 78~82vh · 옵션 순번뱃지 `SettingsScreen.tsx` · `SettingsHelp.tsx`)인지 판별 불가. v0.22.0 검증은 375px **시뮬**이라 실기기 402px + iOS 텍스트 크기 확대(Dynamic Type) 조합은 미검증. **화면 특정(민구 1문답: 화면+스크린샷+텍스트크기) 전 코드 수정 금지.**
- **🟢 2026-07-03 자율 화면 스윕(402×874·375×812, Larry/Vance) — 유력 표면 실측·수정:** 전 탭+전 팝업 강제오픈 스크린샷 스윕에서 **CommandHelpPopup(？명령어)이 "잘려 보임" 실측** — `maxHeight:90%+overflowY:auto`라 기술상 스크롤이지만 스크롤 단서가 전혀 없어 마지막 항목(재시작·종료)이 화면 중간에서 끊겨 사용자에겐 잘림으로 보인다(타이포 21px·gap 15로 10개 항목이 90vh 초과). **v0.26.0 수정:** 타이포 압축(pill 16·설명 15·gap 9)으로 375×812에서 전 항목+하단 닫기 한 화면 수용 + 목록만 스크롤 컨테이너화. 가드: `v026-tolerance-strict.spec.ts` T4. 그 외 표면(알람카드·데이터탭 큰팝업·재질문 큐·기능4 안내팝업)은 두 뷰포트 모두 잘림 0 실측. **민구 재확인 필요:** 제보된 잘림이 이 팝업이었는지(아니라면 iOS 텍스트 확대 조합 의심).
- **🔴→✅ 2026-07-06 v0.27.0 데스크탑 재현 QA(Sonar 2차 라운드) — 이 팝업(AnomalyAlertPopup)의 별개 확인된 버그, 375×667 전용, 수정 완료:** 07-03 스윕이 확인한 402×874/375×812와 **다른, 더 작은 뷰포트** 375×667(iPhone SE급 — 이 앱이 지원하는 최소 화면)에서 Sonar가 실 하네스(BlackHole 오디오 주입) + CDP로 직접 재현·실측(`scripts/sonar-a1-outlier-real.js`): 이상치 카드는 일반 카드보다 콘텐츠가 많아(샘플키+추세라벨+직전→현재+안내문) `useFitScale.ts`의 공용 FIT_STEPS 최저(0.58)로도 375×667에서 다 안 들어감(실측 `scrollHeight=131` vs `clientHeight=77`, 내부 스크롤 발생·하단 컨트롤과 겹침). 412×915/430×932는 기존대로 PASS(재확인) — **375×667만의 좁은 breakpoint 버그.**
  - **해결(v0.28.0):** 이 카드 전용으로 (a) `useFitScale`에 호출자별 확장 축소 단계를 넘길 수 있는 선택적 파라미터 추가(공용 `FIT_STEPS`·다른 카드는 무변경 — 이미 첫 단계에서 fit되는 카드는 회귀 위험 0), (b) 패딩·행간격도 `--fit-lo`에 연동(하한 有)해 극단 압축 시 여백까지 함께 줄게 함, (c) GL-005 우선순위 하위 요소(P4 "직전 (날짜)" 라벨, P5 hero 위 중복 항목명 라벨)를 `max-height:700px` 미디어쿼리로만 숨김(측정 기반 토글이 아니라 뷰포트 높이 고정 조건이라 되튐 없음 — 정보 손실은 없음, 핵심 비교 숫자는 유지), (d) 현재값(P1) 폰트 하한은 기존 `v027-voice-cards-fit.spec.ts`가 이미 단언하는 GL-005 가독 하한(≥26px)을 그대로 유지 — "현재값은 항상 크게"(민구 원칙) 불변.
  - **회귀 테스트:** `tests/v027-voice-cards-fit.spec.ts`에 375×667 전용 케이스 추가(짧은 컬럼명+통상값의 실제 재현 시나리오) — `scrollHeight≤clientHeight` 무스크롤 + 핵심 정보(현재값·알람라벨·직전값·항목명) visible 단언. 기존 402×874/375×812(긴 항목명+큰 음수 워스트케이스) 케이스도 재확인 통과(무변경 확인).
  - **알려진 잔여 한계(범위 밖):** 이 라운드가 검증한 "긴 항목명+큰 음수" 워스트케이스를 375×667에도 동시 적용하면(둘 다 극단) `useFitScale`의 +1px 관용오차 탓에 1px 잔여가 남는 조합이 있다(예: scrollHeight 128 vs clientHeight 127) — 이번에 실제 보고된 버그(통상적인 컬럼명·값)에서는 발생하지 않으며, 별도 관측 대상으로만 남긴다.
  - **출처:** `2026-07-06 v0.27.0 데스크탑 재현 QA(Sonar 2차 라운드)`, `Deliverables/2026-07-06-qa-desktop-repro-round2-reviewed.md` → **survey-011 v0.28.0** 수정.
  - **현재 상태:** ✅수정됨(`src/components/voice/useFitScale.ts`, `src/components/voice/AnomalyAlertPopup.tsx`, `src/styles/global.css`). 실기기(iPhone SE 등 375급 실단말) 확인은 다음 실기기 세션 대기.

### [DEPLOY-PAGES-STUCK-1] gh-pages "Published" ≠ 라이브 반영 — GitHub Pages 빌드 무통보 스턱/실패
- **증상:** `npm run deploy`(gh-pages)가 "Published"를 찍고 gh-pages 브랜치 push도 성공했는데, 라이브는 이전 버전 번들을 계속 서빙. v0.26.0 배포(07-03 04:29Z)에서 Pages 빌드가 "building" 스턱 후 "Page build failed"(duration 0, 즉시 실패)로 종료 — 로컬엔 아무 오류도 안 보임.
- **원인:** gh-pages push 이후의 GitHub Pages 빌드는 GitHub 측 비동기 단계라 로컬 성공 출력과 무관하게 실패할 수 있음(이번 건은 트리가 직전 성공 배포와 구조 동일 → GitHub 측 일시 오류로 판정).
- **해결·회피:** ① 재빌드 트리거 `gh api -X POST repos/<owner>/survey-011/pages/builds` → status "built" 확인 → 라이브 `index.html` 번들 해시 대조로 종결. ② **배포 검증 규칙: "라이브 번들 해시 확인까지가 배포다"** — dist 해시 확인만으로 배포 완료를 선언하지 말 것(이번 실수). 상태 조회: `gh api repos/<owner>/survey-011/pages/builds/latest`.
- **출처:** `2026-07-03 v0.26.0 배포`(민구 실기기에서 미반영 확인 → 진단·재빌드로 정상화, 라이브 `index-C54ez99l.js` 확인).
- **현재 상태:** ✅해소(재빌드로 정상화). 재발 시 위 절차. 배포 후 라이브 해시 확인을 표준 단계로 승격(⚠️주시).

### [CLIP-CORRECTION-1] 정정(재커밋) 발화가 클립에 미수록 → 근본원인 특정: 명령 클립이 정정 대상이 아닌 다음 대기 컬럼에 오태깅
- **증상:** 07-02 S1 r18c8 — 사용자가 166.6 커밋 후 366.6으로 정정, **시트값은 366.6 정상**. 그러나 클립 감사(whisper 전사 + raw 재전사 + 이벤트 3각 대조)에서 final 클립·:a1 클립 모두 원 발화(166.6)만 담고 있고 **정정 발화(366.6, conf 0.99)를 담은 클립이 없음**(n=1 관측). 데이터 무결성 문제 아님 — 클립 감사 품질 문제([CLIP-VAL-1] 계열 잔존, 그 항목은 v0.7.0 3중 수정 후 아카이브).
- **근본원인(2026-07-06 Sonar 데스크탑 재현 QA로 코드 레벨 특정):** `src/lib/useVoiceSession.ts`의 `enterModifyMode`에 두 경로가 있다 — ① **direct-modify**("수정 <값>" 한 발화로 값까지 결합, L677~) 경로는 v0.6.0 CLIP-CMD 수정으로 명령 클립을 **정정 대상 셀**(`targetRow:target.id`)로 올바르게 재연결한다(L690 `pendingCmd.saveFor(targetRow, target.id)`). ② **cascade** 경로("수정"만 먼저 말하고 새 값을 별도 발화로 나중에 말함, 훨씬 흔한 패턴)는 CLIP-CMD 수정이 안 닿아 있었다 — `pendingCmd.saveDefault()`(L756, 수정 전)가 명령 클립을 "수정"이 발화된 **시점에 대기 중이던 다음 컬럼**(`awaiting.row/colId` — 정정 대상이 아니라 그다음 프롬프트될 필드)의 키로 저장했다. 즉 클립이 사라진 게 아니라 **정정 대상 컬럼 기준으로 찾으면 "없다"로 보이는, 엉뚱한 컬럼에 파일링**된 것 — 07-02 n=1 관측과 정확히 일치하는 재현(`~/projects/survey-011-test-harness/qa-antigravity/scripts/sonar-a4-direct2.js`로 재현 가능, clips-manifest.json에서 cmd 클립 colId가 c9(대기 컬럼)로 찍히고 c8(정정 대상)엔 없음을 직접 확인).
- **해결(v0.28.0):** cascade 경로(L756)의 `pendingCmd?.saveDefault()`를 `pendingCmd?.saveFor(targetRow, target.id)`로 교체 — direct-modify 경로와 동일한 불변식(명령 클립 = 정정 대상 셀)을 적용한다. target/targetRow는 그 시점에 이미 확정돼 있고(재질문·재수정 중에도 같은 셀을 향해 재답함) 값이 실제로 커밋될 값 클립은 별도 bare 키로 새로 녹음되므로 포인터 재연결은 불필요 — cmd 클립 자체만 올바른 컬럼으로 재배치하면 된다. `preserveCommandClip`/`PendingCommandClip.saveDefault`의 JSDoc도 "awaiting===target일 때만 안전"으로 갱신.
- **회귀 테스트:** `tests/clip-modify-rerecord.spec.ts`에 `[CLIP-CORRECTION-1]` 신규 케이스 추가(cascade "수정"만 발화 → 별도 발화로 재입력 → 명령 클립이 정정 대상 컬럼(c8)에 저장되고 대기 컬럼(c9)엔 없음을 단언). 기존 "②③ cmd 클립이 없는 빈 캡처" 케이스는 수정 후 cmd 클립이 이제 c8에도 정상 생성되므로, "cmd 클립 자체가 없는" 시나리오(수정 발화 자체도 빈 캡처)로 갱신해 원래 검증 의도(재연결 대상 부재 시 unlink)를 보존했다. 인접 "①②③" 케이스의 cmd 인덱스(cmd1→cmd2)도 이 수정으로 인한 정당한 재번호 매김에 맞춰 갱신.
- **출처:** `2026-07-03 클립 감사`(`Deliverables/2026-07-03-clip-audit-reviewed.md`), 07-02 S1 sess_…851856 r18c8 → **2026-07-06 v0.27.0 데스크탑 재현 QA(Sonar 2차 라운드)**로 근본원인 특정·수정.
- **현재 상태:** ✅수정됨(`src/lib/useVoiceSession.ts` L756 부근, `tests/clip-modify-rerecord.spec.ts`). 실기기 재현(다음 실기기 세션의 클립 감사)으로 최종 확인 대기.

### [MIC-BANNER-POPUP-OVERLAP-1] 마이크 재연결 배너가 ？명령어 팝업 상단(✕ 닫기)을 가림
- **증상:** 마이크 유실 배너(role=alert, 상단 고정)가 떠 있는 동안 CommandHelpPopup 상단 ✕ 닫기가 배너에 덮여 탭 불가(배너가 포인터를 가로챔). 백드롭 탭으로는 닫히지만 사용자가 모를 수 있음.
- **원인:** 배너와 팝업이 화면 상단을 공유, 배너 z-index가 팝업(z 50) 위.
- **해결·회피:** v0.26.0 — CommandHelpPopup에 **하단 전폭 "닫기" 버튼**(`cmd-help-close`, minHeight 48) 추가로 배너와 안 겹치는 닫기 경로 확보(장갑 친화 겸용). 배너 z-index 정책 자체는 불변(마이크 유실 안내가 최우선이라는 의도 존중).
- **출처:** `2026-07-03 자율 화면 스윕` — Playwright 클릭이 배너 interception으로 실패하며 실측(mock 환경에서 배너 상시 유지 특성으로 발견; 실기기서도 마이크 유실+팝업 동시 상황이면 동일).
- **현재 상태:** ✅완화됨(v0.26.0 `CommandHelpPopup.tsx`). 근본(배너-팝업 상단 경합 레이아웃 정책)은 ⚠️주시.

### [REGION-1] 입력탭 영역 충돌 — 수동 입력 시트가 하단 나비를 덮음 + 알람이 인접 영역 침범 (재발 v0.33.0→v0.36.0)
- **증상(민구 제보, v0.33.0~v0.36.0 반복):** ① 칩 수동 입력 시트를 열면 하단 나비(TabBar)가 사라진다("나비가 유지되길 바람"). ② 이상치/범위 알람 카드가 인접 영역(파형·컨트롤)을 침범하는 것처럼 보인다.
- **원인(부분 확정):** ① 수동 입력 시트는 `ModalBase`(fixed inset:0 backdrop)로 뷰포트 전체를 덮는 **모달**이라 하단 나비도 dim/피복된다 — 모달의 정상 동작이나, 민구는 나비가 남길 원함. **상충:** 하단 시트는 뷰포트 바닥에 붙어 나비를 '띄운 채' 두면 시트의 하단 액션 버튼(취소·음성재입력)이 나비 뒤로 숨는다 → "나비 유지"와 "시트 버튼 노출"이 배치상 상충. ② v0.37.0 full-bleed EdgeGlow(fixed z-54) 전환으로 글로우가 하단 나비/수동 시트(구 z-50) 위를 씻고 지나가는 **새 교차**가 생겼다.
- **해결·회피(v0.37.0 FB-I):** ② 계열 봉합 — 수동 입력 시트 z-50→**55**(글로우 54 위, 일반 모달 100 아래)로 올려 글로우가 입력 UI를 덮지 않게 함. TabBar에 `position:relative; z-index:54`를 부여해 full-bleed 글로우가 **지속 chrome(나비)를 씻지 않게** 함.
  **① 계열 확정 해소(민구 결정 "네비는 항상 보여야 함"):** 종전 상충("나비 유지" vs "시트 버튼이 나비 뒤로 숨음")은 시트를 **뷰포트 바닥이 아니라 나비 상단에 올려앉히는** 배치로 풀었다. (a) `ModalBase`에 opt-in `bottomInset` prop 신설 — 지정 시 오버레이(dim+flex 컨테이너)의 `bottom`을 그 CSS 길이만큼 끌어올린다(기본 undefined = `bottom:0` = 기존 동작, 다른 8개 모달 바이트 불변; 유일 `align='end'` 호출부가 이 시트뿐이라 회귀면 0). (b) `TabBar`가 마운트 시 `ResizeObserver`로 **실측 offsetHeight**를 `--nav-h`로 발행(손계산은 버튼 padding/border/폰트/`--sab`로 언더슈트해 나비 상단을 자름 = 잘림 실패방향 → 실측 SSOT). `:root{--nav-h:100px}`는 err-large 첫 페인트 폴백. (c) 시트가 `bottomInset='var(--nav-h)'`로 나비 위에 붙고, 나비가 이미 `--sab`를 흡수하므로 시트 자체 하단 패딩은 flat 16px(이중 safe-area 제거). 결과: 수동 입력 중 나비가 **덮이지도 dim되지도 않고 상시 노출·탭 가능**(탭 전환 가능). 회귀 `tests/v037-chip-2row.spec.ts` FB-I — geometry 오라클(나비 top ≥ 시트 bottom) + tab-* 가시·trial 탭, 402×874(sab 0)·375×667(sab 34) 양쪽(수정 전엔 두 케이스 다 실패 확인). z-index 단언은 하지 않는다(bottomInset로 나비/시트가 공간상 안 겹쳐 z 순서 무의미 — geometry가 진짜 오라클).
  **알람 침범(②의 알람 부분): resolved-by-construction.** `AnomalyAlertPopup`은 fixed 오버레이가 아니라 row3 흡수영역(overflow:hidden, 파형·컨트롤·나비보다 **위**의 in-flow 카드)이라 구조상 나비를 덮을 수 없다 — 실측 침범 재현 불가. device-gated 관측 항목으로 유지(제품 코드 수정 대상 아님).
  **후속 봉합(v0.37.0 리뷰#2, 민구 — STT suspend 유실):** 위 caveat의 "시트를 열어둔 채 탭을 옮기면 STT는 suspend 유지"는 **무해가 아니라 데이터무결성 구멍**이었다(민구 제보). 시트가 STT를 hard-suspend한 채 탭을 누르면 `onManualClose`(resume 배선)가 발화하지 않아 STT가 정지된 채 화면만 전환돼 이후 발화가 유실됐다. 수정: store `overlayCloseSeq` nonce 신설 — App.tsx `changeTab`이 실제 탭 전환 직전 nonce를 증가시키고, 세션 내내 마운트된 `ActiveState`의 구독 effect가 열린 수동 시트/？명령어 도움말을 닫는다(→ `onClose`→`resumeRecognitionForUi`로 STT 재개). 회귀 `tests/v037-chip-2row.spec.ts` 리뷰#2 — 실제 탭 전환(trial 아님) 후 ① 시트 닫힘 ② 음성 탭 복귀 즉시 STT 결과 커밋(활성 칩 전진). CommandHelpPopup(z-55 inset:0)은 종전대로 backdrop 탭이 onClose→resume을 발화하므로 별도 변경 불필요(nonce가 방어적 추가 커버).
- **출처:** `v0.33.0~v0.36.0 민구 반복 제보`(개선요청 채널) → **survey-011 v0.37.0 FB-I** 확정 봉합(민구 "네비는 항상 보여야 함").
- **현재 상태:** ✅수정됨(수동 입력 중 나비 상시 노출·탭 가능; 글로우/시트/나비 z-계층 정리) — 실기기 검증 대기(iOS standalone에서 `--nav-h` 실측·시트 정착 육안 확인). 알람 침범은 resolved-by-construction(in-flow 카드).

### [VIS-AUDIO-REVIEW-1] ⚠️ 검토(complete) 화면값과 TTS 발화가 글자까지 일치하지 않음 (민구 Option 1 수용, 관측)
- **증상(코덱스 리뷰 v0.37.0 리뷰#3, 유효):** 입력 검토(phase 'complete') 화면은 FB-E로 "방금 입력한 값"을 크게 보인다. 그러나 그 순간 실제 TTS는 화면의 단일 값과 **글자까지 일치하지 않는다** — 세 진입 경로 모두: ① 정상 행완료 `announceRowComplete()`는 auto-컬럼 변경분 또는 "완료."만 발화(음성 값 미발화), ② '이전' 완료행 재방문 `enterReviewWait()`는 그 행 **모든** 음성 컬럼을 낭독(화면은 한 값), ③ 마지막행 `announceEndReached()`는 종료 안내 발화. 즉 화면의 "확정 중인 단일 값"을 발화가 그대로 확인해 주지 않는다(PRINCIPLES §2 시각·청각 일치 관점 편차).
- **원인(설계 상충):** FB-E("검토에 방금 입력한 값 크게 표시", 민구 확정 + 특성화 테스트 2건이 박제)와 §2 글자일치가 **본질적으로 상충**한다. 화면에서 값을 없애면 §2를 지키지만 FB-E를 뒤집고, 값을 유지하면 발화가 그 단일 값을 확인하지 않는다. 완전 해소는 **TTS 발화 자체 변경**이 필요한데 그건 §10(발화 문자열/조건 무수정)이라 자동 수정 범위 밖 = 민구 판단 영역.
- **결정(민구, v0.37.0 리뷰 Option 1):** FB-E 값 표시를 **유지**하고, 오표시(잘못된 값)만 고친다. **#3의 음성 글자불일치는 잔여로 수용**하고 TTS는 건드리지 않는다.
- **값 오표시 해소 경과(2단계):** ① r2(`[리뷰#2]`)는 검토값을 `valueBurst`에서 파생 — 하지만 `valueBurst`는 **음성 커밋에서만** 발행돼, 마지막 셀을 **수동 입력**으로 채우면 앞 음성 셀의 stale 값을, **이상치 정정**으로 채우면 정정 전 값을 여전히 오표시했다(부분 해소). ② v0.37.0 리뷰#1(`[리뷰#1, 민구]`, 커밋 영수증)이 완결 — store `commitReceipt`를 **모든** 커밋 경로(음성·수동·이상치 정정 [확인])가 원자적으로 발행하고 검토 파생이 이를 소비한다. 파생 훅은 `ActiveState`(세션 내내 마운트)로 올려 이상치/일시정지 카드로 VoiceHero가 remount돼도 영수증을 놓치지 않는다. **검토 화면 값은 이제 어떤 경로로 채웠든 실제 방금 커밋된 셀 값**이다(회귀 `tests/v037-review-receipt.spec.ts` 3종: 수동 마지막 셀·이상치 정정 마지막 셀·'이전' 재방문 중립 폴백).
- **여전히 잔여(§2 시각·청각 글자일치):** 위는 **값 정확성**만 해소한다. 화면에 표시된 값 **문자열이 그 순간 `say()` 발화 문자열과 글자까지 일치**하는지(#3)는 **별개 잔여**로 남는다 — 세 진입 경로의 발화가 화면의 단일 값을 그대로 확인해 주지 않으며, 완전 해소는 TTS 발화 변경(§10, 민구 판단 영역)이 필요하다. **글자일치는 해결되지 않았다**(값 정확성만 해결).
- **주시 포인트:** 실기기에서 검토 화면 값과 발화의 불일치가 사용자 혼동(특히 '이전' 재방문 시 화면=중립 "N행 완료" vs 발화=전체 낭독)을 유발하는지 관측. 유발되면 TTS 통일(민구 결정 필요, §10) 또는 검토 화면 중립화(FB-E 재검토)를 재상정.
- **출처:** `survey-011 v0.37.0` 코덱스 이중리뷰 리뷰#3 지적 → 민구 Option 1 결정(값 유지·오표시만 수정·#3 잔여 수용).
- **현재 상태:** 검토값 **오표시는 완결 수정**(`[리뷰#1]` 커밋 영수증 — 음성·수동·이상치 정정 전 경로). §2 **글자일치는 ⚠️주시 잔여**(설계상 수용된 편차 — 코드 결함 아님, TTS 변경은 민구 판단 영역).

### [REASK-TOLERANCE-LOG-1] 인식 허용범위 설정값 미로깅 → "설정값 vs 인식률" 비교 불가 + 고신뢰 재질문 혼동
- **증상:** 민구 "허용범위 50% 설정 후 인식률 80~90%인데 재인식 요구". 로그로 검증 시도 → **허용범위 설정값이 어디에도 안 남아** 설정값 대조 불가. 분석 결과 허용범위 게이트는 **정상**(S1 신뢰도<0.60 = 정확히 5건 → 저신뢰 재질문 5건 일치). 고신뢰 재질문은 대부분 **파싱 실패**(`"200 10일 전에"`·`"200대 17.7"`·`"100-4.4"`)로 신뢰도 게이트와 무관.
- **원인:** ① `recognitionTolerance`는 zustand persist로만 보관, `setting_changed`엔 `fastRecognition`만 로깅. ② 저신뢰 재질문 분기(`useVoiceSession:1338`)가 **이벤트 미로깅**. ③ 상단 인식률 %는 STT 신뢰도라 높게 떠도 값은 파싱 실패로 재질문되는 인지 부조화.
- **해결:** v0.23.0 — ① 세션시작 메타에 `recognitionTolerance` 박제 + 허용범위 다이얼 변경 시 `setting_changed:recognitionTolerance=<v>` 로깅. ② 저신뢰 재질문에 신규 이벤트 `stt_rejected_low_confidence`(`confidence`+`extra:tolerance:<v>`). ③ 재질문 시 화면에 사유 큐(`sessionStore.reaskReason`: low_confidence/parse_failed) 표시(`ReaskCue`).
- **출처:** `2026-06-26 v0.22.0 실기기 로그`(2세션 `setting_changed:recognitionTolerance` 0건; 저신뢰 5건/파싱실패 7건; firsthand 코드 확인). Playwright `v023-voice.spec.ts` B2.
- **현재 상태:** ✅수정됨(v0.23.0 `useVoiceSession.ts`·`logger.ts`·`sessionStore.ts`·`VoiceScreen.tsx`·`ReaskCue.tsx`). **🟡 2026-06-29 v0.23.0 실기기 부분확정:** 저신뢰 로깅 작동 — `stt_rejected_low_confidence` 3건 모두 `confidence`(0.074·0.269·0.462)+`tolerance:0.5` 동봉, 3건 다 conf<0.5 게이트 정상. 세션메타 `recognitionTolerance:0.5` 스냅샷 ✅. `stt_parse_failed` 유형 세분(decimal_fraction_lost×3·multi_numeric×3·extraneous_token×1) ✅. **검증 갭:** 이번 세션 `setting_changed:recognitionTolerance` 0건(민구가 다이얼 미변경) → 변경 로깅 경로·설정값↔신뢰도 대조는 **다음 실기기에서 허용범위 1회 변경 후 완결** 필요.
- **✅ 2026-06-30 v0.24.0 실기기 2세션 — 검증 완료:** `setting_changed:recognitionTolerance` **양 세션 각 5회**(S1 0.55→0.8→0.65→0.75→0.8 / S2 0.9→0.85→0.5→0.4→0.55), 게이트가 **라이브 tolerance 추종**(S1 conf 0.777 거부@0.8 / S2 0.893 거부@0.9). 직전 갭 해소. **⚠️관찰(F1, Vance 후보):** 다이얼↑(0.8~0.9)=게이트 더 엄격→적정신뢰도(0.78~0.89) 거부 다발, "허용범위↑=관대" 직관과 반대 → 민구 멘탈모델 확인 선행(추측수정 금지).
- **🟡 2026-07-02 v0.25.0 실기기 — F1 반전 배포 결과(→ v0.26.0 원복 확정):** v0.25.0이 다이얼을 "높을수록 관대"로 반전(minConf = 0.4+0.9−tolerance). 실기기 2세션: 다이얼 **0.55 방치**(변경 0회, 직전 세션 종료 위치) → 실효 minConf **0.75로 점프**. 거부 8건 전부 `tolerance:0.55,minConf:0.75` 동봉·conf<0.75 정합(게이트 배선 정확). 부작용 실증: 0.55~0.75 대역 거부 3건 중 **정답값 "100"@0.62 거부 1건**(반전이 추가한 순수 마찰; "8.8"@0.639·"3000"@0.575는 오답이라 우연히 유익). 거부율 자체는 8/87(9.2%)로 폭증 없음. **교훈: 게이트 방향 반전은 기존 다이얼 위치의 의미를 뒤집는다**(마이그레이션 없는 반전 = 사용자가 안 만졌는데 임계 이동). 민구 최종 결정 — **원래 방향(높을수록 엄격) 복귀 + 다이얼 캡션/aria에 방향 명시**(v0.26.0, `settingsStore.minConfidenceForTolerance` 단일 지점).
- **✅ 2026-07-03 v0.26.0 원복 구현:** `minConfidenceForTolerance = tolerance` 직접 매핑(다이얼 90%=minConf 0.90 가장 엄격), 다이얼 캡션 "높을수록 엄격 (확실한 발음만 인정)"+aria 동기 명시(방향 오해 재발 방지), 대역·기본값·persist 불변. 방향 고정 전용 스펙 `v026-tolerance-strict.spec.ts` T1~T3 신설(이 스펙이 깨지면 방향이 또 바뀐 것). 참고: 07-03 실 STT 시뮬(Tier3 무인)서 실측 신뢰도 0.70~0.85 관측 — 다이얼 85%+ 설정 시 정상 발화도 거부될 수 있어 **기본 60% 유지 권장**.

### [LOG-UPLOAD-SELECTED-1] 다중세션 "시트에 추가" 시 일부 세션 로그만 Drive 업로드
- **증상:** 민구 "복수 세션을 시트에 추가 시 일부 세션 로그 파일만 업로드되는 듯". v0.21.0 테스트에서 스피커폰 세션 로그가 Drive에 누락된 바 있음.
- **원인:** 로그 업로드가 `report.successIds`(=시트에 **새 행이 실제 추가된** 세션)에만 게이팅(`DataScreen:220,225`) → 이미 동기화돼 새 행 0인 세션을 함께 선택하면 그 로그가 누락. 또 세션별 업로드 전체 실패가 `drive_upload:partial:user_drive,admin_drive`로 오라벨돼 사용자에게 실패가 분명히 안 보임.
- **해결:** v0.23.0 — 로그 업로드 대상을 **선택한 모든 세션(행 보유)**으로 확장(`uploadIds = ids.filter(hasRows)`). 세션별 백업 성공을 `backedUpOk` Set으로 추적, `backupOk`(autoDelete 게이트)는 여전히 `successIds.every(backedUpOk)`로 데이터 유실 방지 불변식 보존. 사용자 메시지에 **"로그 N/N 세션 백업"** + 실패 세션 수 명시.
- **출처:** `2026-06-26 v0.22.0 실기기 로그`(이번엔 2세션 모두 업로드 성공이나 근인=successIds 게이팅 코드 확인; 06-25 `drive_upload:partial:user_drive,admin_drive` 흔적). firsthand 코드 확인.
- **현재 상태:** ✅수정됨(v0.23.0 `DataScreen.tsx`). **⚪ 2026-06-29 v0.23.0 미검증:** 단일 세션이라 "새 행 0 세션 + 신규 세션 동반 선택" 시나리오 자체가 미발생 → 선택업로드/`N/N` 표기 **다음 실기기에서 2개+ 세션 동시선택**으로 검증 필요. **🟡 partial 라벨 inconclusive:** 세션종료 자동 export가 `drive_upload:partial:user_drive,admin_drive`(핸들러 `DataScreen.tsx:258` = 그 export의 양 레그 에러)로 찍혔으나 4.3초 뒤 2차 export(`_1782708326230.zip`)가 admin 취합폴더 정상 안착 → 로그는 자기 업로드 성공을 기록 못 해 "전송실패-후-재시도성공 vs 실제 부분실패" 판별 불가. 차기 로그에서 단일세션 자동 export의 partial 빈도·레그 패턴 누적 관측(06-25·06-26·06-29 연속 관측).
- **🟡 2026-06-30 v0.24.0 실기기 2세션 — 다중세션 업로드 기능적 성공 + partial 4연속:** 2세션 함께 export·**둘 다 Drive 안착**(rclone 수확)=동시선택 업로드 성공. 단 export 시점 `drive_upload:partial:user_drive,admin_drive`×3 또 기록(**06-25/26/29/30 4연속**) — 데이터는 도달하나 라벨이 진짜 실패와 외관 동일. "로그 N/N 세션 백업" 토스트는 미계측(육안 필요). 라벨 정밀화(레그별 성공/실패 분리) 백로그 F2.
- **🟢 2026-07-02 v0.25.0 — partial 4연속의 사후 입증 + 신규 라벨 검증은 다음 export로:** 07-02 zip의 누적 이력에서 06-30 `partial:user_drive,admin_drive`×3 **뒤 13~21초 내 `drive_upload:ok`×3** 확인 — 4연속 partial은 "재시도 성공이 그 zip 스냅샷 밖"이었던 오해로 종결. v0.25.0 F2 레그 분리 라벨(`drive_upload:ok`/`partial:fail=<legs>:ok=<legs>`, `DataScreen.tsx:289-303`)은 배포됐으나 **export zip은 자기 업로드 결과를 담을 수 없는 구조**(스냅샷이 업로드 완료 전 생성, 07-02 자기 이벤트 0건)라 실기기 검증은 다음 export 로그에서.

### [CLIP-R1] recoverStream 쿨다운이 **첫 회복**을 막는다 — 로드 직후 3초 사각지대 (자동 재연결 무력화)

- **무엇:** `AudioRecorder.recoverStream`의 쿨다운 가드가 `performance.now() - lastRecoverAt < 3000`인데 `lastRecoverAt` 초기값이 **0**이다. `performance.now()`는 **페이지 로드 후 경과 ms**라, 로드 직후 3초 동안은 `now - 0 < 3000`이 성립해 **모든 재획득이 조용히 차단**(false 반환, getUserMedia 호출 자체가 없음)된다.
- **왜 이제 문제인가:** v0.14.0~v0.37.0에서는 recoverStream 진입점이 **사용자 제스처(수동 재연결 버튼)뿐**이라 잠복해 있었다(사람이 로드 3초 안에 버튼을 누를 일이 드물다). v0.38.0 #5의 **자동 재연결은 사고 시점에 즉시 발화**하므로 이 구간에 정면으로 걸린다. 걸리면 **getUserMedia를 부르지도 못한 채 자동 1회 가드(`micAutoReconnectAttemptedRef`)만 소진**하고 수동 배너로 떨어져, 자동화가 목적인 기능이 조용히 무력화된다.
- **테스트가 결함을 가리고 있었다(중요):** #5 회귀 2종은 **병렬 전체 실행에서는 통과**한다 — 머신 부하로 3초가 지나가기 때문이다. **격리(`--workers=1`) 단독 실행에서 3/3 실패**했다. 즉 이 건은 "격리하면 통과 = 부하성 flake"의 **정반대 패턴**이며, 전체 스위트 green만 보고 있으면 절대 안 잡힌다.
- **해결(v0.38.0 `e1dbff0`):** `lastRecoverAt` 초기값을 `-RECOVER_COOLDOWN_MS`로. 쿨다운은 **연속** 재획득 폭주를 막기 위한 것이지 첫 회복을 막으려는 게 아니다. 수정 후 격리 6/6 통과.
- **실기기 연결점:** v0.37.0 로그(2026-07-22 10:16)에 블루투스 전환 직후 `mic_reconnect_ok` → `clip_empty` → `audio-capture` 연쇄가 실재한다. **연속 실패 구간에서는 쿨다운이 실제로 걸리는 조건**이므로, 자동 재연결의 실기기 효능은 다음 회차 로그에서 `mic_auto_reconnect:result=*`로 확인해야 한다.
- **출처:** `survey-011 v0.38.0` 2026-07-22 세션(#5 회귀 격리 검증).
- **현재 상태:** ✅수정됨(브랜치, 미배포). ⚠️실기기 효능 미검증.

### [PAST-2] 과거값 인덱스 준비 조건이 호출부마다 복붙돼 갈라짐 — 신규 호출부가 게이트를 통째로 누락

- **무엇:** "과거값 인덱스를 지금 만들 가치가 있는가"라는 **같은 판단**이 App 부팅·로그인·설정 저장·테이블 생성·시트 재연결 **5곳에 복붙**돼 있었고, 모양이 갈렸다 — `anyRule`만 보는 곳, `anyRule && readonlySheetsAuth()`인 곳, `anyRule && sheetUrl && sheetTab`인 곳.
- **결과:** v0.38.0에서 시트 재연결에 재조회를 추가할 때 **게이트를 통째로 빠뜨렸고**(이상치 규칙이 없는 시트도 헤더 읽을 때마다 전체 시트 조회 = 데이터·배터리·쿼터 낭비, 기능 격리 원칙 위반), 그 다음 수정은 **게이트를 절반만 복제**했다. Codex 리뷰가 두 건을 각각 지적했다.
- **해결(v0.38.0 `ce6ced8`·`bf47450`):** `pastValues.shouldPreparePastIndex()` 단일 술어로 접고 호출부는 그것만 쓴다.
- **⚠️ 통일할 때 밟은 함정:** 인증 검사(`readonlySheetsAuth`)를 **모든** 호출부에 적용했더니 v0.34.0 apikey 계측 테스트가 깨졌다. **부팅 경로는 인증이 없어도 `loadPastIndex`까지 진입시켜 `past_index_skip:not_signed_in`을 남기는 것이 의도**다 — 그 계측이 "왜 이 세션에 알람이 없었나"를 판별하는 유일한 단서이고 SOP-003 파서와의 바이트 계약이다(v0.34.0 C9). → `requireAuth` 옵션으로 분리(부팅·로그인은 인증 무관, 시트 저장·테이블 생성은 인증 확인).
- **교훈:** 같은 파일/모듈에 유사 가드가 3개 이상이면 **헬퍼로 접는다.** 단, 접을 때 "미묘하게 다른 이유"가 있는지 먼저 확인 — 여기선 그 차이가 **계측 계약**이었다.
- **출처:** `survey-011 v0.38.0` SOP-004 리뷰 r1(Codex Medium ×2) → 수정.
- **현재 상태:** ✅수정됨(브랜치, 미배포).

### [SETTINGS-1] 재로그인 자동 재연결이 사용자 컬럼 설정을 덮어써 과거값 인덱스까지 무효화

- **무엇:** 재로그인은 이전 시트를 자동 재연결(v0.13.0 R1 `onGoogleClick` → `onUrlConfirmWithUrl`)하는데, `loadHeaders`가 `inferColumns`로 컬럼을 **처음부터 다시 유추해 통째로 교체**했다. `preserveInferredColumnIds`는 **`id`만** 보존한다(`sheets.ts:306-313`).
- **왜 위험한가:** `inferColumns`는 숫자 컬럼의 **고유값이 1개뿐이면 `input='auto'`**(고정값 컬럼)로 본다(`sheets.ts:216`). 따라서 **데이터 행이 1~4개뿐인 시즌 첫 회차 시트**에서는 사용자가 '음성'으로 둔 측정 컬럼(횡경·종경)이 **매 로그인마다 '자동'으로 되돌아갔다**. 회차가 쌓여 값이 다양해지면 재유추가 같은 값을 내므로 증상이 사라진다 — **그래서 오래 안 잡혔다.**
- **파생 피해(v0.38.0 #1이 안 되던 근인):** `input`이 바뀌면 `effectiveSampleKey`가 뒤집히고, 그게 과거값 인덱스의 **설정 지문(fp)** 에 들어간다(`pastValues.loadContext`). 로그인 직후 강제 갱신(#1)이 만든 인덱스가 **캐시·폴백 동시에 fp 검사 탈락** → 화면은 "과거값 준비: 미준비" 고착. **데이터 계층은 정상 동작(GET·IDB 갱신됨)인데 화면만 안 바뀌는** 형태라 오진하기 쉽다.
- **진단법:** `getPastIndexStatus()`가 `none`인데 `cached`가 방금 만들어졌으면(fp 불일치) 지문 두 개를 덤프해 **어느 필드가 다른지** 본다. 이번 건은 `["c3","횡경","float",false→true]` 단 한 칸 차이였다.
- **해결(v0.38.0, `001327e`·`cf8c9d0`):** ①`columnFlags.preserveUserColumnSettings` — **시트가 정하는 값은 `name`·`type`뿐**, 나머지(입력방식·샘플키·자동값·추세)는 보존. `type`이 바뀌면 컬럼 의미가 달라진 것이라 재유추값 사용(structural-change 규칙과 동일). ②컬럼을 교체하는 `loadHeaders`에서 `resetPastIndexRetries()`+`prefetchPastIndex()`로 **정착 설정 기준 재생성**(`ensurePastIndex`가 유효 캐시면 no-op이라 추가 조회 없음).
- **함정(회귀 테스트):** 이 회귀는 **수정 없이도 통과하는 레이스**가 있다 — 재연결이 컬럼을 교체하기 *전에* 배지를 읽으면 옛 지문 기준으로 "준비됨"이 잡힌다. 테스트는 **교체 완료를 명시적으로 대기**한 뒤 판정해야 한다(`input[value="횡경(mm)"]` 노출). 대기 추가 후 **수정 제거 시 2/2 실패 · 적용 시 6/6 통과**로 반증 확인.
- **주의:** 샘플키 유추 규칙(`inferSampleKey` = auto·비date) 자체는 **민구 확정이라 변경 금지**([PAST-1] 계열 참조). 규칙은 그대로 두고 "재연결이 사용자 선택을 덮지 않게" 보존만 추가한 것이다.
- **출처:** `survey-011 v0.38.0` 2026-07-22 세션(개선요청 #1 회귀 테스트 red 추적) → 근인 확정·수정.
- **현재 상태:** ✅수정됨(브랜치 `survey-011-v038-voice-ui`, 미배포). 실기기 확인 항목: **시즌 첫 회차처럼 행이 적은 시트에서 재로그인 후 입력방식이 '음성'으로 유지되는지.**

### [SETTINGS-2] 다른 스프레드시트·탭 전환 시 이전 시트의 fixed 자동값이 새 시트로 오염

- **증상:** 같은 양식의 A농가 시트에서 B농가 시트로 전환하면 `농가명` 자동값이 A의 값으로 남아,
  이후 B 시트 동기화 행에 잘못 기록될 수 있었다. 화면과 API는 성공으로 보여 조용한 데이터 오염이다.
- **원인:** [SETTINGS-1] 수정이 `preserveInferredColumnIds`로 정규화 헤더명이 같은 컬럼의 id를 재사용한
  뒤 `preserveUserColumnSettings`로 `auto`를 포함한 사용자 설정을 항상 복사했다. 현재 columns의 출처를
  저장하지 않아 다른 spreadsheetId 또는 같은 파일의 다른 탭인지 판별할 수 없었다. `sheetUrl`·`sheetTab`은
  `loadHeaders` 전에 새 대상으로 바뀌므로 그 값을 비교하는 방식도 항상 같은 시트처럼 보이는 함정이 있다.
- **해결(v0.38.0):** persist v12에 `columnsSheetId`·`columnsSheetTab`을 추가하고, v11 이하 저장본은 현재
  `sheetUrl`·`sheetTab`으로 backfill한다. `loadHeaders`는 두 출처가 정확히 같을 때만 id·사용자 설정을
  보존하며, 다른 파일/탭은 새 유추값을 사용한다. 새 columns와 출처는 한 번의 store set으로 함께 갱신한다.
- **회귀:** `tests/sheets-infer-columns.spec.ts`가 다른 파일·다른 탭·같은 시트 3축을 고정하고,
  `tests/v038-sheet-source-guard.spec.ts`가 저장목록/탭 선택 뒤 store 자동값과 같은 시트 설정 보존을 검증한다.
  가드 제거 시 핵심 테스트 **1/1 실패**(`강남호` 대신 `이원창`), 적용 시 순수 스위트 **9/9 통과**.
- **출처:** `survey-011 v0.38.0` 태스크 01(2026-07-23, 미배포 브랜치).
- **현재 상태:** ✅코드 수정·반증 확인. ⚠️5175 포트 bind가 샌드박스에서 `listen EPERM`으로 차단돼
  브라우저 e2e 13건은 수집만 확인했으며, 권한 있는 호스트에서 실행 필요.

---

## ⑨ 테스트 / 릴리스 회귀 함정

### [TEST-UI-1] 입력탭 테스트가 시각 장식(`REC`, `▶`)에 붙으면 UI 정리 때 장기 타임아웃이 난다
- **증상:** v0.31.0 입력탭 UI 재정리 중 Playwright가 `text=REC` 또는 활성 칩의 `▶` span을 기다리며 실패하거나, `v54-30rows` 장기 테스트가 행마다 3초씩 누적 대기해 3분 타임아웃이 발생했다.
- **원인:** 테스트가 사용자가 보는 임시 시각 표현에 직접 결합되어 있었다. v0.31.0에서 `REC` 표시와 `▶` 활성칩 아이콘을 제거했지만, 일부 테스트 helper가 여전히 `document.querySelectorAll('span')`에서 `▶`를 찾아 활성 칩을 판별했다.
- **해결·회피(v0.31.0):** UI 상태에는 안정적인 테스트 계약을 둔다. 활성 화면은 `data-testid="voice-active-state"`, 활성 행은 `data-testid="active-row"`, 칩은 `data-testid="column-chip"` + `data-active="true"` + `data-col-name="<컬럼명>"`로 확인한다. 새 입력탭 테스트를 작성할 때 시각 아이콘/텍스트 장식 대신 이 속성을 사용한다.
- **출처:** `2026-07-08 survey-011 v0.31.0 입력탭 UI 재정리`, 커밋 `bbf6a1e`.
- **현재 상태:** ✅수정됨(`src/screens/VoiceScreen.tsx`, `tests/*` 활성 칩 helper 갱신). 새 UI 테스트 작성 시 계속 준수.
- **재발 변형(2026-07-20, v0.36.0 코덱스 시안 재작업):** [TEST-UI-1]의 같은 계열 — `v019-active-layout`/`v020-dials-layout`이 칩 구역을 셀렉터가 아니라 **계산 스타일 탐색**(`display:grid && overflowY:auto`인 div 검색)으로 잡고 있었다. 칩 구역이 grid → flex-wrap pill 플로우로 바뀌자 탐색이 null을 반환하며 실패. 두 스펙 모두 `data-testid="voice-chip-grid"`(§ 셀렉터 보존표의 그 노드)로 교체해 해결 — **레이아웃 스펙도 요소 탐색은 반드시 testid 계약으로, 계산 스타일은 단언(assert) 대상으로만** 쓸 것.

### [TEST-UI-2] 활성 상태 하단에는 `입력 종료` 버튼이 없다 — 종료 버튼 테스트는 일시정지 패널 경로로
- **증상:** `v023-voice.spec.ts`, `correction-flow.spec.ts`가 활성 상태에서 `button[title="입력 종료"]`를 기다리다 실패했다.
- **원인:** v0.31.0 입력탭 하단은 기본 상태에서 `이전` / `일시정지` / `다음`만 보인다. 종료는 실수 방지를 위해 일시정지 패널에서 `종료` 버튼을 누르고 확인 모달을 거치는 경로로 유지된다. 테스트가 이전 UI의 상시 종료 버튼을 전제로 했다.
- **해결·회피(v0.31.0):** 활성 화면의 하단 기준점은 `input-control-toggle` 또는 `일시정지` 버튼으로 잡는다. 버튼 종료 경로를 검증할 때는 `일시정지` → `button[title="입력 종료"]` → `button[title="종료 확인"]` 순서로 테스트한다. 음성 종료 경로는 STT `"종료"` 명령으로 별도 검증한다.
- **출처:** `2026-07-08 survey-011 v0.31.0 입력탭 UI 재정리`, 커밋 `bbf6a1e`; `2026-07-09 v0.32.0 세션` — 누락 2건 추가 수리(`v019-active-layout.spec.ts` W5는 컨트롤바 Y 앵커를 `input-control-toggle`로 교체, `correction-flow.spec.ts` D-2는 일시정지 패널 경로 적용).
- **현재 상태:** ✅수정됨(`tests/v023-voice.spec.ts`, `tests/correction-flow.spec.ts`, `tests/v54-30rows.spec.ts`, `tests/v019-active-layout.spec.ts`).
- **⚠️ 부분 변경(v0.35.0 FB-G, Vance):** **완료(completing, phase 'complete') 상태**에선 하단 중앙 버튼이 `일시정지` 대신 `입력 종료`로 바뀐다(마지막 행 대기 시 일시정지가 무의미). 즉 completing에선 일시정지 패널을 거치지 않고 하단 `button[title="입력 종료"]`가 **직접** 보인다(→ `button[title="종료 확인"]`). **활성(active) 상태**의 상시-종료-없음 원칙은 그대로. completing 종료 경로 테스트는 `v023-voice.spec.ts` B4가 갱신됨(일시정지 우회 제거).

### [TEST-UI-3] 진입 애니메이션(scale(0)→1) 중 getBoundingClientRect가 0×0을 반환 — 측정/스크린샷은 애니메이션 종료 후
- **증상:** v0.35.0 확인 카드 ✓ 배지가 `check-pop`(0%: `scale(0)`) 진입 애니메이션을 쓰는데, 커밋 직후 즉시 스크린샷/측정하면 배지가 `width:0,height:0`으로 잡혀 "렌더 안 됨"으로 오판된다(스타일은 정상 적용됨 — bg/border 존재). 값 텍스트는 `chip-pop`(scale 1→1.16→1, 0 미경유)이라 항상 보여 혼동을 키운다.
- **원인:** `getBoundingClientRect`/스크린샷은 현재 transform을 반영하므로 `scale(0)` 프레임에선 0 크기. 애니메이션(320ms)이 끝나기 전 캡처하면 그 순간을 찍는다.
- **해결·회피:** 진입 애니메이션이 있는 요소는 **애니메이션 시간(≥320ms) 경과 후** 측정/캡처한다. 항상-보여야-하는 배지엔 `scale(0)` 진입을 피하거나(페이드/미세 스케일) 측정 타이밍을 늦춘다. 확인 카드 캡처는 `waitFor(confirm)` 후 ~450ms 대기(1500ms 확인 창 안).
- **파생(민구 판단 필요):** 확인 플래시는 **행 중간 음성 컬럼** 커밋에만 1.5초 지속된다. **행의 마지막 음성 컬럼** 커밋은 `advance()`가 phase를 'complete'로 두고 "N행 완료" 안내를 낸 뒤 다음 행에서 'active'로 복귀하므로(useVoiceSession `advance` 699~742), 그 커밋엔 ✓ 확인 플래시 대신 "N행 완료 — 명령 대기"가 뜬다. 렌더 우선순위(review > confirm)로 이렇게 되며 기존 review 라벨과는 일관되나, **"커밋 직후 ✓+값" 민구 결정과는 행-마지막 컬럼에서 어긋난다** — 행-마지막에도 ✓를 띄우려면 advance/phase 순서 재작업 필요(이번 범위 밖, 민구 확정 대기). 스크린샷/테스트로 확인 플래시를 재현하려면 음성 컬럼 2개 이상 + 첫 컬럼 커밋을 쓴다.
  - **⚠️ 정밀화(2026-07-15 v0.35.0 R3-FIX-5, 실측 타임라인으로 정정):** 위 "✓ **대신** N행 완료"는 정확하지 않다. 행-마지막 커밋에서도 ✓는 **뜬다** — 커밋 직후엔 phase가 아직 'active'라 confirm이 페인트되고, echo TTS가 끝나 `advance()`가 phase를 'complete'로 올리는 순간 review가 **덮어쓴다**. 즉 정확한 동작은 "✓가 echo TTS 길이만큼 잠깐 떴다가 'N행 완료'로 **승계**된다(1.5초를 못 채운다)"이다. rAF 전이 기록(음성컬럼 2개, mock TTS onend 200ms): `listening(산도) → confirm(4.2) → review(1행 완료) → listening(당도)`. 회귀 `tests/v035-hero-confirm.spec.ts`가 이 **순서**(confirm→review, review 이후 confirm 재생 없음)를 고정한다 — "confirm이 없다"로 단언하면 거짓이 된다.

### [TEST-TTS-MOCK-1] 동기(synchronous) `onend` TTS mock이 상태머신 전이를 왜곡 — 존재하지 않는 화면을 검증하게 된다
- **증상:** `tests/v035-hero-confirm.spec.ts`가 **음성 컬럼 1개** fixture로 "커밋 → 확인 카드(✓) → ~1.5초 뒤 대기 복귀"를 단언하며 통과했다. 그러나 음성 컬럼이 1개면 그 커밋은 곧 **행-마지막** 커밋이라, 실기기라면 ✓가 1.5초를 못 채우고 "N행 완료"로 승계된다([TEST-UI-3] 파생). 테스트는 그 review를 **한 번도 보지 못한 채** 통과했다.
- **원인(코드 확정):** mock `speechSynthesis.speak()`가 `onend`를 **함수 본문 안에서 동기 호출**했다. 실제 speechSynthesis는 발화 시간이 있어 절대 그러지 않는다. 동기 onend면 `advance()`의 `setPhase('complete')` → `await announceRowComplete()` → `setPhase('active')`가 **페인트 없이 한 흐름에 끝나** review가 단 한 프레임도 렌더되지 않는다 → 화면이 실기기와 정반대인데 테스트는 초록. mock의 `onend`를 `setTimeout(…, 200)`으로만 바꿔도 전이가 즉시 드러난다(`confirm → review → listening`).
- **해결·회피:** TTS mock의 `onend`는 **항상 비동기**로 발화시킨다(≥1 태스크, 200ms 권장 — 실기기 수백ms~수초의 축약). 동기 mock은 "TTS를 기다리는 모든 상태 전이"(advance/review/확인 플래시/재질문)를 통째로 접어버려, 그 구간을 겨냥한 테스트를 **공허하게** 만든다. 더불어 **일시적 상태**(review 등)는 `expect(...).toBeVisible()` 폴링으로 겨냥하지 말고 rAF로 전이를 기록해 사후 판정하라(`recordHeroTimeline` 패턴) — 수백 ms 상태는 폴링이 놓쳐 플래키가 된다.
- **출처:** `2026-07-15 v0.35.0 리뷰 라운드3`(Vance, R3-FIX-5 사실확인 중 실측). Codex 지적의 **결론**(공허·타이밍 의존)은 옳았으나 **사유**("음성컬럼 1개면 review가 burst를 소비해 확인 플래시가 안 뜬다")는 사실과 달랐다 — 플래시는 뜬다. 1차 증거 = rAF 타임라인.
- **현재 상태:** ✅수정됨(`tests/v035-hero-confirm.spec.ts` — 음성 컬럼 2개 + async onend + 타임라인 오라클). ⚠️주시 — **다른 스펙 다수가 여전히 동기 onend mock을 쓴다**(`manual-input.spec.ts` 등). 그 스펙들이 TTS-대기 전이를 단언하지 않는 한 무해하나, 새로 그런 단언을 추가할 땐 반드시 async로 바꿀 것.
- **출처:** `2026-07-15 v0.35.0 UI 개선 세션`(Vance, 확인 카드 스크린샷 캡처 중 발견). 회귀 `tests/v035-hero-confirm.spec.ts`.
- **현재 상태:** ✅패턴 확립(테스트/캡처 타이밍 규칙).

### [TEST-STT-UI-1] 도움말 hard suspend 검증에서 총 1행 설정이면 `다음` 후 행 번호 변화가 없다
- **증상:** 도움말 모달을 닫은 뒤 STT 복원 검증 테스트가 `다음` 발화 후 `active-row`가 1→2로 바뀌기를 기대했지만 실패했다.
- **원인:** 테스트 fixture의 `totalRows`가 1이었다. 이 경우 앱은 정상적으로 `nextRow` 명령을 처리해도 2행으로 이동하지 않고 `end_reached_waiting` 안내로 남는다. 즉 실패는 STT resume 실패가 아니라 잘못된 테스트 오라클이었다.
- **해결·회피(v0.31.0):** hard suspend/resume 검증은 행 번호 변화만 보지 말고 `logEvents`의 `ui_suspend`, `ui_resume`, 이후 `command parsed=nextRow text=다음` 기록을 확인한다. 행 이동 자체를 검증하려면 최소 2행 이상 fixture를 사용한다.
- **출처:** `2026-07-08 survey-011 v0.31.0 입력탭 UI 재정리`, `tests/v026-tolerance-strict.spec.ts` T5 갱신.
- **현재 상태:** ✅수정됨. 도움말 중 STT 명령 무시와 닫은 뒤 복원은 로그 기반으로 검증.

### [TEST-SANDBOX-1] 제한 샌드박스에서 Vite 포트 bind·Chromium Mach rendezvous가 EPERM으로 전면 차단
- **증상:** `npm run dev -- --port 5175 --strictPort`가 `listen EPERM 0.0.0.0:5175`, Playwright의 모든 케이스가 실행 0ms에 Chromium `bootstrap_check_in ... MachPortRendezvousServer: Permission denied (1100)`로 실패한다.
- **원인:** 코드/테스트 assertion 실패가 아니라 현재 실행 컨테이너의 네트워크 listen 및 macOS Mach service 권한 제한. 서버 미기동 상태에서도 브라우저 launch 자체가 먼저 SIGTRAP으로 종료된다.
- **해결·회피:** 포트 bind와 Chromium launch가 허용된 호스트 세션에서 5175 strictPort 서버를 띄워 전체 스위트를 재실행한다. 이 패턴은 passed/failed 제품 회귀 수치에 포함하지 말고 인프라 차단으로 별도 보고한다.
- **출처:** `2026-07-15 survey-011 v0.34.0 High 3건 수정 세션`(Vite·Playwright 명령 stdout 직접 확인).
- **현재 상태:** ⚠️환경 차단 — `npx tsc --noEmit`은 clean, Playwright 제품 검증은 권한 있는 실행 환경으로 이관 필요.

### [TEST-PERSIST-SEAM-1] 빈 세션에서는 persist 실패·지연 seam이 호출되지 않아 종료 테스트가 공허해진다
- **증상:** `tests/v035-r3-fixes.spec.ts`의 P1-1/P1-4가 각각 `__survey011DelaySessionPutMs`/`__survey011FailSessionPut`을 주입했지만, stopping 또는 저장 실패 화면을 관측하지 못했다. P1-3도 같은 빈 세션+지연 seam 구조라 종료 재진입 창이 결정론적으로 유지되지 않았다.
- **원인:** `useVoiceSession.persistSession()`은 완료행·백업·활성행 데이터·skip 행이 모두 없으면 `saveSession()` 호출 전에 `true`를 반환한다. `startSession()` helper는 값을 커밋하지 않으므로, seam을 켜기만 해서는 `db.saveSession()`의 지연/실패 분기에 도달하지 않는다.
- **해결·회피:** persist seam에 의존하는 테스트는 seam 주입 전에 `fireStt`로 실제 값을 커밋하고, 필요하면 완료행까지 만든다. Observer 등 다른 폴백 seam은 주입 후 런타임 전제(`typeof ... === 'undefined'`)도 직접 단언해 공허 통과를 차단한다.
- **출처:** `2026-07-16 v0.35.0 P1/P2 회귀 테스트 보정` — 권한 있는 호스트 전체 스위트에서 수정 전 681 passed/2 failed/16 skipped; 실패 스크린샷과 `src/lib/useVoiceSession.ts` 조기 반환 분기 대조.
- **현재 상태:** ✅테스트 보정됨(`tests/v035-r3-fixes.spec.ts` P1-1/P1-3/P1-4 값 커밋, P2 seam 전제 단언). 제품 코드는 변경하지 않음.

### [TEST-CLIP-POSTROLL-1] `clip-postroll:212`가 격리 실행에서도 간헐 실패 — 클립 저장 이벤트 0건

- **증상:** `tests/clip-postroll.spec.ts:212`("post-roll 자연 완료")가 `clip_saved` 이벤트를 하나도 관측하지 못해 실패한다(`Expected >= 1, Received 0`). 전체 병렬에서도, **단독 격리(`--workers=1`)에서도** 나온다 — 부하성 flake의 전형적 신호(격리 시 회복)를 따르지 않는다.
- **v0.38.0과 무관함(환경 대조로 확정):** `src`·`tests`를 통째로 **기준선 `2c2eabc`로 되돌려** 같은 조건(`--workers=1 --repeat-each=2`)으로 실행해도 **동일하게 실패**한다(기준선 1/2 실패, v0.38.0 반영본 2/2 실패 — 표본이 작아 실패율 차이는 유의하지 않다). 즉 v0.38.0 리뷰 반영 커밋들(`374fd09`·`49d33a2`·`89f2097`)이 만든 회귀가 아니다.
  ⚠️ 중간 대조에서 `audioRecorder.ts` **한 파일만** 되돌렸을 때도 실패해 "무관"으로 볼 뻔했으나, 그건 나머지 변경이 남은 불완전한 대조였다. **환경 대조는 변경 전체를 되돌려야 성립한다.**
- **미확정(원인):** 실패 지점이 "저장 이벤트 자체가 없음"이라 post-roll 타이머가 아니라 **클립 저장 경로 전단**(headless에서 `MediaRecorder`가 fake 스트림으로 데이터를 못 만드는 조건)일 가능성이 있다. 같은 파일의 `:236`("우아한 절단")은 안정적으로 통과해, 900ms echo TTS를 기다리는 `:212`만의 타이밍 전제가 의심된다. **미검증 — 추측을 확정으로 쓰지 말 것.**
- **영향:** 클립 감사(audit) 축의 테스트 신뢰도만 영향. **측정값 저장 경로와 무관**하다.
- **출처:** 2026-07-23 v0.38.0 Phase 2 검증(Larry). 전체 727 passed / 6 failed → 격리에서 이 건만 잔존.
- **현재 상태:** ⚠️주시 — v0.38.0 릴리스 블로커 아님(기준선 동일 증상). 원인 규명은 별건.

---

## 확인 필요 (미검증)

아래는 출처로 충분히 뒷받침되지 않았거나 survey-011 적용 여부를 직접 확인하지 못한 항목. **본문 항목으로 신뢰하지 말 것.** 검증 후 해당 카테고리로 승격하거나 폐기하라.

1. **pause/resume 시 recorder 누수** — 조상 `@7dd6e8b`(입력-B: pause 중 recorder dispose + resume 시 재생성)에서 누수 차단을 언급. survey-011 `audioRecorder.ts`/`useVoiceSession.ts`의 pause/resume 경로가 동일 패턴을 따르는지 미확인.
2. **IDB 클립 구형 Blob 하위호환 경로** — `db.ts`가 ArrayBuffer로 저장하면서 구형 Blob도 읽는다는데, survey-011이 신규 레포라 구형 데이터가 존재하는지/하위호환 코드가 실제로 필요한지 미검증.
3. **GitHub issues/PR 기반 추가 함정** — 010 issues 0건, 011 issues/PR 0건, 010 PR 1건(`v0.9-improvements` = `@2ed62a5`, 이미 반영). gh 출처에서 **신규 distinct 이슈 없음**. 향후 issue 생기면 여기서 수확.
4. **survey-011 자체 v0.1~v0.2 라인의 함정** — 본 문서는 조상(010)과 이번(06-04~05) 세션 중심. survey-011의 v0.3.0 이전 자체 커밋 이력은 별도 수확 대상(미수행).
5. **행 미완료(complete:false) 상태에서 clips-manifest committedValue가 정정 전 값으로 남음** — 2026-07-07 [CLIP-CORRECTION-1] 수정 재검증(Sonar A4 라운드3) 중 관측: 종경(다음 컬럼)에 값을 아직 안 주고 행을 넘긴 export에서 `committedValue`가 33.3(정정 전 값)으로 남아 있었음. [CLIP-CORRECTION-1] 수정(cmd 클립 컬럼 태깅)과는 무관 — colId 태깅 자체는 이 케이스에서도 정확했음. "필드 이탈 시 커밋" 기존 설계와 다른 조건인지, 별도 버그인지 미확정(n=1). 다음 실기기 로그 또는 추가 데스크탑 재현으로 확인 필요.
6. **"~점이요" 공손 종결 발화가 소수로 합성될 수 있음** — 2026-07-14 v0.34.0 O3 작업 중 관측: "266 점이요"가 266.2로 파싱('이요'의 '이'가 소수 2로 합성). "점 이 요"(=.2 의도) 정당 발화와 문자열상 구분 불가라 **블라인드 수정 금지** — 실기기 로그에서 "점이요" 발화 빈도·오커밋 여부 관측 후 판단.
7. **Playwright 병렬 부하 플레이크** — `correction-flow.spec.ts`(:276, :411)·`trend-alert.spec.ts`(:458)가 2-worker 병렬 부하에서 간헐 실패(고정 `waitForTimeout` 기반 오라클). 단독·재실행 모두 PASS(2026-07-14 확인, 코드 변경과 무관). 전체 스윕에서 재발 시 flaky로 취급하고 이벤트 기반 대기로 교체 후보.
