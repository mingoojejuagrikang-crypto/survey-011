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

## ① 음성 / STT 파서

### [STT-1] 200대 한국어 자리값 수사 오인식 ("이백" → 100)
- **증상:** `횡경 이백`, `종경 이백십일점일` 같은 200대 한국어 수사가 `100`/`111.1`로 잘못 파싱됨.
- **원인:** 숫자 파서가 항목 뒤 조사 제거 규칙을 먼저 적용하면서, 값의 첫 음절 `이`까지 조사로 잘라냄.
- **해결·회피:** 한국어 자리값 수사를 별도 파싱하고, 순수 숫자 수사일 때 선행 `이`를 보존. survey-011에는 전용 모듈 `koreanNum.ts` + 62케이스 회귀(`tests/koreanNum.spec.ts`)로 분리됨. **v0.5.0 가드:** 명령어가 흡수해 쪼개진 발화가 유효 숫자 토큰 2개 이상으로 남으면 침묵 커밋하지 않고 ambiguous(`null`) 처리해 재질문(`stt_parse_failed` `multi_numeric` 태깅).
- **출처:** `debug-log`(2026-04-20); `2026-06-10 실기기 로그` — **수정 경로 재발**: `"수정 이백육십육점칠"`(266.7 의도)이 `"수정이 166.7"`로 인식돼 선행 `이`가 명령어에 흡수, `166.7`이 침묵 커밋됨; `2026-06-11 실기기 로그` — **v0.5.0 가드 실기기 작동 확인**: `"수정이 177.7"`(row14)이 `parsed:modify`로 처리돼 잘못된 177.7을 **침묵 커밋하지 않고** 재질문 → 사용자 재발화로 277.7 정상 커밋(06-10 침묵커밋과 대조).
- **현재 상태:** ✅수정됨 (`src/lib/koreanNum.ts`, `tests/koreanNum.spec.ts`; 침묵 커밋 가드는 survey-011 v0.5.0 — STT 오인식 자체는 잔존, 재질문으로 전환됨. 06-11 실기기 가드 작동 확인)

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
- **현재 상태:** ⚠️주시 (`점`+비숫자 침묵커밋 가드 2종은 v0.5.0에서 작동 확인 — `src/lib/koreanNum.ts`, 회귀 `tests/koreanNum.spec.ts`. **점-없는 정수+비숫자 잔여형은 잔존** — 06-11 백로그 STT-C, 텔레메트리 관측 우선)

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

### [STT-9] 저신뢰(confidence) "수정" 발화가 임계값에 걸려 거부됨 (T-12 잔존)
- **증상:** "수정"이라고 말했으나 STT confidence가 낮게 산출되어 명령이 거부됨. v0.4.3에서 수정 명령 전용 임계값을 0.55로 낮췄으나(T-12), 이후에도 드물게 재발.
- **원인:** STT 엔진이 또렷한 발화에도 낮은 confidence를 산출하는 경우가 잔존 — 엔진 한계.
- **해결·회피:** 임계값 추가 인하는 노이즈 오탐([STT-3]) 위험과 트레이드오프 — 현행 0.55 유지하고 텔레메트리로 빈도 관측 지속.
- **출처:** `survey-011 v0.4.3`(T-12 임계값 0.55 도입); `2026-06-10 실기기 로그` — 저신뢰 거부 재발 1건 관측(세션 480 이벤트 중 1건, 빈도는 크게 완화된 상태).
- **현재 상태:** ⚠️주시

---

## ② 클립 · IndexedDB 영속화 (최대 광맥)

### [CLIP-1] iOS Safari에서 음성 클립이 IDB에 저장 안 됨 (근본 버그)
- **증상:** iPhone Safari 실기기에서 음성 클립이 IndexedDB에 저장되지 않아 데이터탭 재생 버튼·로그 ZIP에 클립 누락. value는 45건 기록되나 clip 에러 0건, ZIP에 `clips/` 폴더 없음.
- **원인:** `saveAudioClip`이 **Blob을 IDB에 직접 저장**하다 iOS에서 실패하는데, **빈 `catch{}`가 에러를 삼킴**. 진단조차 안 됨.
- **해결·회피:** 클립을 `{buf:ArrayBuffer, type:string}` 객체로 분해 저장(iOS Blob-in-IDB 우회) + 구형 Blob 하위호환. 빈 catch에 `clip_save_failed` 로깅 추가. timeslice 250ms, stopClip 2초 타임아웃.
- **출처:** `growth-survey-010@c8dd276` (= growth-survey-010 v0.11.1), 재테스트 확정 `growth-survey-010@fd3177a` (v0.11.2: 119/120 정상 저장)
- **현재 상태:** ✅수정됨 (`src/lib/db.ts` `saveAudioClip`이 ArrayBuffer로 round-trip, line 78~93)
- **교훈:** **빈 catch는 금지.** 영속화 실패는 반드시 로깅하라. "에러 0건"이 "성공"을 의미하지 않는다 — 삼켜진 것일 수 있다.

### [CLIP-2] persistSession 타이밍 탓 클립 키 누락
- **증상:** 행 완료 시 클립 키가 세션에 등록되지 않아 누락.
- **원인:** `persistSession()`이 행 완료 시점에 실행되는데, `handleFinal`에서 `dataStore`를 직접 업데이트하면 **해당 행이 아직 세션에 없어 항상 실패**.
- **해결·회피:** `pendingClipsRef`로 세션 내 클립을 메모리에 추적하고 `persistSession()`에서 기존 클립과 병합. 키를 사전 등록해 persistSession 선행 race 차단, 저장 실패 시 사전 등록 키 회수.
- **출처:** `growth-survey-010@39c1791`, `growth-survey-010@55bb61e`
- **현재 상태:** ✅수정됨 (`src/lib/useVoiceSession.ts` `pendingClipsRef`)

### [CLIP-3] stale-epoch 클립이 올바른 클립을 덮어씀
- **증상:** restart/modify/jump 후 늦게 도착한 stale 시도의 클립이 `saveAudioClip`(put)으로 올바른 클립을 덮어씀.
- **원인:** `saveAudioClip`이 put이라 epoch 가드 없으면 나중 시도가 이전 키를 덮음.
- **해결·회피:** 클립 저장 전 epoch 가드 — restart/modify/jump가 epoch을 바꿨다면 stale 클립 폐기. `clip_stale_epoch` 진단 로그.
- **출처:** `growth-survey-010@8ce8dca` (= growth-survey-010 v0.10.1, MEDIUM-4)
- **현재 상태:** ✅수정됨 (`src/lib/useVoiceSession.ts` epoch 가드 존재)

### [CLIP-4] AudioRecorder 인스턴스 간 상태 오염
- **증상:** 이전 recorder의 큐잉된 `ondataavailable`/`onstop` 콜백이 새 녹음 슬롯을 오염.
- **원인:** 콜백이 공유 `this.*` 상태를 참조.
- **해결·회피:** 각 녹음이 자체 `ClipSlot`(recorder/chunks/resolveStop/finalized) 소유, 콜백은 closure로 잡은 slot만 참조. `finalized` 가드로 중복 콜백 방지. `noiseSuppression:on / echoCancellation:on / autoGainControl:off`(빗소리 게인 증폭 방지).
- **출처:** `growth-survey-010@a5950f0`(v5.2 4차), `growth-survey-010@c8dd276`(getUserMedia 옵션)
- **현재 상태:** ✅수정됨 (`src/lib/audioRecorder.ts`, line 51~56)

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

### [CLIP-7] Logger 이벤트가 reload 후 소실 (메모리 전용)
- **증상:** 리로드하면 진단 이벤트 로그가 사라져 ZIP에 안 들어감.
- **원인:** logger가 메모리 push만 함.
- **해결·회피:** DB v3에 `logEvents` object store + `bySessionId` 인덱스 추가, `logger.log`이 메모리 push와 동시에 IDB fire-and-forget 기록, `exportLogZip`이 IDB 우선 조회.
- **출처:** `growth-survey-010@a5950f0` (v5.2 4차)
- **현재 상태:** ✅수정됨 (`src/lib/logger.ts`, `src/lib/db.ts` logEvents)

### [CLIP-8] IDB 스키마 업그레이드 후 구버전 롤백 시 VersionError
- **증상:** v3로 업그레이드된 디바이스를 구버전(v2) 코드로 롤백하면 `VersionError`.
- **원인:** IndexedDB는 버전 다운그레이드를 허용하지 않음.
- **해결·회피:** 스키마 bump는 **단방향**임을 인지하고 배포. 롤백이 필요하면 마이그레이션 전략 별도 수립. (이 항목은 해결책이 아니라 **주의**다.)
- **출처:** `growth-survey-010@9a9c004` (v5.2 5차, 커밋 본문 경고)
- **현재 상태:** ⚠️주시 (survey-011 DB도 버전드. 스키마 변경 시 동일 위험)

---

### [LOAD-1] 앱 업데이트 후 "세션이 사라짐" — 실제론 App.tsx 빈 catch가 hydrate 실패를 삼킴
- **증상:** 사용자: "앱 업데이트나 알 수 없는 원인으로 데이터탭의 세션이 사라진다." 데이터는 IDB에 남아있는데 화면엔 빈 목록("아직 기록된 데이터가 없습니다")만 표시.
- **원인:** `App.tsx`의 hydrate effect가 `loadAllSessions()` 예외를 **빈 `catch {}`로 삼킴** → `sessions:[]` 유지 + `setHydrated(true)`. DataScreen은 "로드 실패"와 "정말 빈 목록"을 구분 못 해 EmptyState 렌더. 트리거는 **앱 업데이트**(PWA `autoUpdate` + IDB 버전/멀티탭 `VersionError`)가 로드를 실패시키는 순간. [REVIEW-1] "빈 catch 금지"의 재발.
- **해결·회피:** 로드 로직을 `src/lib/hydrate.ts` `hydrateSessions()`로 단일화 — 실패 시 **로깅**(`extra:'hydration_failed'`) + `dataStore.hydrationError`(에러 메시지) 기록. DataScreen은 에러 상태면 EmptyState 대신 **"데이터를 불러오지 못했습니다 + 다시 시도"** UI(`VersionError`면 새로고침 안내)를 렌더. 데이터는 삭제되지 않으므로 재시도/새로고침으로 복구.
- **출처:** `2026-06-05 세션`(피드백) → **survey-011 v0.4.0** 수정
- **현재 상태:** ✅수정됨 (`src/App.tsx`, `src/lib/hydrate.ts`, `src/stores/dataStore.ts` `hydrationError`, `src/screens/DataScreen.tsx` `LoadErrorState`; 회귀 `tests/correction-flow.spec.ts` "D-2 — fresh start→종료→reload …")
- **교훈:** 또 빈 catch였다. **모든 로드/영속화 실패는 로깅하고, "빈 목록"과 "로드 실패"를 UI에서 반드시 구분**하라. "데이터 없음"이 진짜 없음을 의미하지 않는다 — 삼켜진 것일 수 있다.

---

## ③ iOS / TTS / Safari

### [IOS-1] iOS Safari SpeechSynthesis `onend` 미발생 → advance() 무기한 대기
- **증상:** iOS Safari에서 TTS 완료 콜백(`onend`)이 안 와서 다음 필드로 진행(`advance()`)이 영영 멈춤.
- **원인:** iOS Safari `speechSynthesis`가 `onend`를 누락하는 경우가 있음.
- **해결·회피:** `speak()`에 10초 타임아웃 + `settled` 가드(중복 해소 방지). interrupt 시 `synth.cancel()` 후 50ms 딜레이(cancel 직후 speak 이벤트 미발생 버그 완화).
- **출처:** `growth-survey-010@06955ec`
- **현재 상태:** ✅수정됨 (`src/lib/speech.ts` settled/watchdog, line 256~261; cancel+50ms line 242~244)

### [IOS-2] TTS watchdog 상태머신 mute/unmute 불일치
- **증상:** watchdog(타임아웃) 발동 후 늦게 도착한 `onstart`가 마이크를 다시 mute해서 입력이 막히거나, 정상 완료에도 watchdog가 이중 발동.
- **원인:** watchdog `setTimeout`이 정상 `onend`/`onerror`에서 clear되지 않음, late `onstart`에 가드 없음.
- **해결·회피:** `onend`/`onerror`에서 `clearTimeout`, `onstart`에 `settled` 가드(watchdog 발동 후 late onstart의 mute 차단), watchdog 발동 시에도 clearTimeout(이중 발동 방지).
- **출처:** `growth-survey-010@dae3e2f` (Codex gpt-5.5 adversarial review)
- **현재 상태:** ✅수정됨 (`src/lib/speech.ts` settled 가드 + clearTimeout)

### [IOS-3] TTS 재생 중 STT가 자기 음성을 phantom 입력으로 잡음
- **증상:** TTS 안내 음성이 마이크로 다시 들어가 잘못된 값/명령으로 입력됨.
- **원인:** TTS 중에도 STT가 활성, `recognition.onend`가 TTS 완료와 무관하게 즉시 `recognition.start()` 호출.
- **해결·회피:** `SpeechController.muteForTts/unmuteForTts` — TTS 재생 중 재청취 재시작·다음 세그먼트 시작 보류, TTS 종료 후에만 STT/녹음 재개. `muteForTts()`를 `onstart`→`synth.speak` 직전으로 이동(50~500ms 갭 차단). 단, "TTS 중에도 명령어는 수락"하도록 별도 분기.
- **출처:** `debug-log`(2026-04-20), `growth-survey-010@a954e05`(muteForTts), `growth-survey-010@4c4aa60`(mute 타이밍 갭), `growth-survey-010@dcaafea`(TTS 중 명령 수락)
- **현재 상태:** ✅수정됨 (`src/lib/speech.ts` muteForTts 경로)

### [IOS-4] SpeechSynthesisUtterance.voice에 plain object 할당 시 TypeError
- **증상:** `utterance.voice`에 plain object를 넣으면 TypeError(특히 mock/테스트 환경).
- **원인:** `voice`는 실제 `SpeechSynthesisVoice` 인스턴스만 허용.
- **해결·회피:** `speak()`/`warmupTts()`에서 voice 할당 시 타입 가드.
- **출처:** `growth-survey-010@0eaa59a`
- **현재 상태:** ⚠️주시 (survey-011 `src/lib/speech.ts` voice 설정 경로 점검 권장)

---

## ④ 정정 · race · 데이터 유실

### [RACE-1] 정정/명령 후 진행 멈춤 race condition (핵심)
- **증상:** 수정/정정 명령 후 음성 흐름이 멈추거나, 노이즈 STT가 상태를 오염시켜 split-brain 발생.
- **원인:** (1) `advance()`/`skipRow()`가 TTS await 중 명령 인터럽트에 안 멈춤, (2) `muteForTts()`가 `onstart`에서 호출돼 50~500ms 동안 phantom 입력 갭, (3) 에코 TTS가 fire-and-forget이라 순서 깨짐, (4) 노이즈 STT가 epoch을 오염.
- **해결·회피:** `advance()`/`skipRow()`에 epoch 가드, `muteForTts()`를 synth.speak 직전으로 이동, 에코 TTS를 await로 전환, epochRef 증가를 명령/값 처리 시에만. jumpToRow/restartFromCol에도 `epochRef++`(split-brain 방지). `correction-flow.spec.ts` 8케이스 추가.
- **출처:** `growth-survey-010@4c4aa60`(3건 + 테스트), `growth-survey-010@dcaafea`(jump/restart epoch++), `growth-survey-010@2ed62a5`(F001 handleFinal race)
- **현재 상태:** ✅수정됨 (`src/lib/useVoiceSession.ts` epoch 가드 50+ 참조; `tests/correction-flow.spec.ts`)

### [RACE-2] STT 결과가 이전 행에 저장됨 (행 전환 가드 누락)
- **증상:** 행 전환 직후 도착한 STT 결과가 직전 행에 잘못 저장됨.
- **원인:** `advance()`/`skipRow()` 행 전환 구간에서 `awaitingFieldRef`가 초기화되지 않음. 값 저장 후 즉시 초기화 안 됨(중복 덮어쓰기).
- **해결·회피:** 행 전환 시 `awaitingFieldRef.current = null` 삽입. 값 저장 후 즉시 `awaitingFieldRef=null`(F001).
- **출처:** `growth-survey-010@0eaa59a`, `growth-survey-010@2ed62a5`(F001)
- **현재 상태:** ✅수정됨 (`src/lib/useVoiceSession.ts` awaitingFieldRef 가드)

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

### [RACE-4] 정정 시 오인식 원본 오디오 유실 → 분석 불가
- **증상:** 값을 정정하면 직전(오인식) 음성 클립이 삭제되어, 왜 오인식했는지 분석할 audit trail이 사라짐.
- **원인:** 정정 시 옛 클립을 audio trail에서 제거하던 의도된 동작이, 분석 관점에선 증거 유실.
- **해결·회피 (두 레포가 다름):**
  - 조상: direct modify("수정 178.1") 시 새 클립 없이 즉시 값 적용 + 옛 클립을 trail에서 제거(`9a9c004` MEDIUM). 미완료 pending 클립만 즉시 삭제, IDB 저장된 클립은 재완료까지 유지(`a45cd24`).
  - **survey-011 v0.3.0:** 방향을 **보존**으로 바꿈 — 정정 시 클립을 지우지 않고 `clip_preserved` 이벤트(attempt index + archive key)와 함께 보관해 오인식 원본을 분석 가능하게 함.
- **출처:** `growth-survey-010@9a9c004`, `growth-survey-010@a45cd24`; **survey-011 v0.3.0**(`2026-06-04~05 세션`)
- **현재 상태:** ✅수정됨 (보존으로 전환. `src/lib/useVoiceSession.ts` `clip_preserved` line 111~149)

### [RACE-5] 동기화: 업로드 실패 세션을 autoDelete가 삭제 (데이터 손실)
- **증상:** 시트 append가 실패했거나 preflight(로그인/URL/탭 미설정) 실패인데도 autoDelete가 로컬 세션을 삭제 → 미업로드 데이터 영구 손실.
- **원인:** 삭제 대상을 `report.failures` 보정으로 계산해서, 실제 업로드 안 된 세션이 "성공"으로 분류됨.
- **해결·회피:** `SyncReport`에 `successIds: string[]` 추가 — **실제로 시트에 append된 세션만**. preflight 실패 시 ok=0 → 삭제 안 함. partial sync에서도 successIds 기준으로만 백업/삭제.
- **출처:** `growth-survey-010@a36b4da`(CRITICAL successIds 도입), `growth-survey-010@9a9c004`(partial sync 백업 독립화)
- **현재 상태:** ✅수정됨 (`src/lib/sync.ts` `successIds`, `src/screens/DataScreen.tsx` line 122~128)

### [RACE-6] ensureTeamSubFolder race → 중복 Drive 폴더
- **증상:** 동시 업로드 시 팀 하위 폴더가 중복 생성되거나 검색 실패가 silent fall-through.
- **원인:** 폴더 ensure 로직에 캐시·정렬·에러 throw 부재.
- **해결·회피:** `settingsStore.teamFolderId` 캐시(다음 업로드부터 검색 생략), 검색 시 `orderBy=createdTime asc`(중복 시 가장 오래된 것으로 통일), admin 실패 시 캐시 무효화, Drive Q 문자열 escape 강화(backslash), 검색 실패 시 throw.
- **출처:** `growth-survey-010@8ce8dca` (v0.10.1, HIGH-2)
- **현재 상태:** ⚠️주시 (survey-011 `src/lib/driveUpload.ts` 멀티 Drive 경로 점검 권장)

### [RACE-7] 일시정지(Pause) 상태에서 화면 전환 시 sessionIdRef가 초기화되어 빈 ID 및 startedAt: NaN이 DB에 영속화됨
- **증상:** 사용자가 세션을 `pause`한 뒤 화면을 전환(언마운트)하고 다시 돌아와 `resume`하면, 이후의 모든 이벤트와 최종 완료된 세션의 `sessionId`가 빈 문자열(`""`)로 저장되고, `startedAt`은 `NaN`으로 DB에 기록됨.
- **원인:** `useVoiceSession` 훅의 `sessionIdRef`는 로컬 `useRef` 상태이므로 언마운트 시 유실되지만, Zustand 스토어의 phase는 유지되어 resume은 정상 작동하므로 갭 발생.
- **해결·회피:** `sessionId/startedAt/label`을 `useSessionStore`(Zustand)에 함께 저장(`setSessionMeta`, **`resetAll()` 뒤** 호출). 훅 (re)mount 시 ref가 비고 store에 id가 있으면 복원하는 effect 추가. `persistSession`은 ref가 비면 store 값으로 폴백해 빈 id/`NaN` startedAt을 원천 차단.
- **출처:** `2026-06-05 세션` (실기기 로그 분석) → **survey-011 v0.4.0** 수정
- **현재 상태:** ✅수정됨 (`src/stores/sessionStore.ts` `setSessionMeta`, `src/lib/useVoiceSession.ts` 복원 effect + persist 폴백; 회귀 `tests/correction-flow.spec.ts` "D-2 RACE-7…", 무력화 시 `id:""`로 실패함을 확인). 2026-06-08 로그(v0.4.1)에서 빈 sessionId 0건으로 재발 없음 재확인.

### [CLIP-1] direct modify("수정 <값>") 시 수정한 셀의 음성 클립/재생버튼이 사라짐
- **증상:** 데이터탭에서 세션을 확장해 보면 "수정 82.7"처럼 값과 함께 정정한 셀에만 음성 클립 재생버튼이 없음(값은 정상).
- **원인:** `enterModifyMode`의 direct-modify 경로가 "stale 클립 매칭 방지" 목적으로 셀의 `audioClips` 포인터를 **삭제**했는데, direct modify는 새 값 클립을 재녹음하지 않으므로 셀에 연결된 클립이 사라짐. (cascade/restart는 재녹음 전제라 무관.)
- **해결·회피:** 직전 `preserveCommandClip`이 저장한 수정 발화(`:cmd<n>`) 클립을 셀 포인터로 **재연결**. 재생버튼 유지 + 재생 내용이 새 값과 일치. 이전 값은 `:a<n>` archive로 ZIP에 보존.
- **출처:** `2026-06-08 세션` (민구 제보 + 로그 row3·6·18·19·23·29) → **survey-011 v0.4.2** 수정; `2026-06-11 실기기 로그` — **변형 재발(컬럼 id 어긋남)**: row16·17에서 종경(c8) 칸을 듣는 중 `"수정 311.7"`/`"수정 333.3"`을 발화해 횡경(c7)을 direct_modify했더니, cmd 클립 재연결 키가 **명령 발화 컬럼(c8)** 기준으로 만들어져 c7 셀 포인터가 `…:16:c8…:cmd1`로 어긋남. c7 전용 cmd 클립(`16:c7…cmd1.wav`)은 디스크에 존재하나 orphan, 재생버튼은 c8 수정 발화를 가리킴(숫자 자체는 맞아 값 오염은 아님).
- **현재 상태:** ✅수정됨(재생버튼 소실 원형 + 컬럼 id 어긋남 변형, **survey-011 v0.6.0**) — cmd 클립 재연결 키를 **명령 발화 컬럼이 아니라 수정 대상 셀의 colId**로 구성하도록 변경: `preserveCommandClip`이 `saveFor(targetRow, targetColId)`를 노출하고 `enterModifyMode`의 direct_modify 경로가 `saveFor(targetRow, target.id)`로 **수정 대상 셀** 키(`…:targetRow:target.id:cmd<n>`)에 저장·재연결한다(`src/lib/useVoiceSession.ts`). 종경 안내 중 횡경을 수정해도 c7 포인터가 c8 키로 orphan되지 않음. (이전: 06-11 백로그 CLIP-CMD(P1)) **2026-06-12 실기기 확인**(06-11 v0.6.0 로그): row17에서 종경(c8) 안내 중 `"수정 333.3"` → 횡경(c7) 포인터가 `…:17:c7…:cmd1`로 정확히 재연결 — 교차컬럼 수정 실기기 작동 확정.

### [CLIP-2] 음성 클립에 발화 전후 무음이 과다하게 포함됨
- **증상:** 저장된 클립 재생 시 앞뒤 공백이 김. 06-08 로그 녹음 길이 평균 5.7초·최대 20.9초인데 실제 발화는 1–3초.
- **원인:** TTS 종료 후 녹음 시작 + STT final 후 종료라 발화 전후 무음이 통째로 저장됨. VAD/트리밍 없음.
- **해결·회피:** 저장 직전 진폭(RMS) 기반으로 발화 구간만 남기고 앞뒤 무음을 트림해 16kHz mono WAV로 재인코딩(`audioTrim.ts`). decode 불가/음성 미검출 시 원본 반환(iOS 안전 — 녹음 게이팅은 첫 음절 손실 위험이라 회피). 트림 발생은 `clip_trimmed` 이벤트로 추적.
- **출처:** `2026-06-08 세션` (민구 제보 + 로그) → **survey-011 v0.4.2** 추가
- **현재 상태:** ✅수정됨 (`src/lib/audioTrim.ts`, `src/lib/audioRecorder.ts` `stopClip` 통합; Chromium 실클립 검증 6998ms→1440ms, 128KB→46KB). ⚠️주시 — iOS Safari `decodeAudioData(webm/opus)` 작동은 다음 실기기 로그의 `clip_trimmed`로 사후 확인.
- **v0.5.0 주석(프리롤 도입):** 2026-06-10 로그에서 0.32~0.60s 초단 클립 7건 관측 — barge-in 시 발화 **앞부분**이 녹음 시작 전에 잘린 정황(트림 과다가 아니라 수록 자체가 늦음). v0.5.0에서 **0.5s 프리롤**(AudioWorklet PCM 링버퍼, 실패 시 ScriptProcessor → 그것도 실패 시 프리롤 없이 현행 동작 + `clip_preroll_unavailable` 로그)을 클립 앞에 결합하고, 트림 PAD를 비대칭화(앞 300ms / 뒤 180ms). **트림 전 원본(프리롤 포함)도 `:raw` 키로 보존**(민구 결정)하고 로그 zip에 포함, `clip_duration`에 `prerollMs` 동봉. iOS 실기기 효과는 다음 로그에서 정량 확인. **v0.5.0 실기기 확인(2026-06-11):** `clip_preroll_ready:worklet:44100` + 44개 `clip_duration` 전부 `prerollMs:500`, 초단(0.32~0.60s) 클립 **0건**(06-10 7건→0건), `clip_trimmed` 39건·`:raw` 원본 보존 39건 정상. iOS Safari 프리롤·트림 경로 정상 작동 확정.

### [CLIP-3] 세션 첫 클립이 빈 캡처(`clip_empty`)로 저장 실패 → broken pointer(재생버튼 끊김)
- **증상:** 세션의 **맨 첫 음성 클립**이 빈 버퍼로 stop돼 저장 안 됨. sessions.json은 해당 셀(row1 횡경 c7) audioClip 포인터를 `sess_…:1:c7…`로 등록하지만 디스크에 파일이 없어 데이터탭 재생버튼이 끊김(404). 값(11.1)은 정상 커밋 — audit-trail 클립만 손실.
- **원인(가설):** 0.5s 프리롤 링버퍼 워밍업과 **세션 첫 녹음 stop** 사이 타이밍 — 첫 캡처가 프리롤 PCM이 채워지기 전 stop돼 빈 버퍼 반환(`clip_stop_resolved:null` → `error clip_empty`). 둘째 클립부터는 정상. 빈 catch 아님(정상 계측됨 — REVIEW-1 준수).
- **해결·회피:** ① 빈 캡처 감지 시 셀 audioClip **포인터 등록 회수**(broken pointer 방지 — [CLIP-2/persistSession] 회수 패턴), 또는 ② 첫 녹음 전 프리롤 1프레임 워밍업 보장. 값은 영향 없으므로 우선순위 낮음(P2).
- **출처:** `2026-06-11 실기기 로그` (단일 세션 1건: row1 c7 `clip_empty`)
- **현재 상태:** ⚠️주시(가드는 들어갔으나 **레이스에 덮이는 실기기 증거 발견**, 2026-06-12) — 빈 캡처(`clip_empty`) 감지 시 `unlinkBrokenPointer`가 셀 audioClip 포인터를 **메모리(pendingClipsRef)와 이미 영속화된 세션 양쪽에서** 회수하되, 포인터가 여전히 우리 clipKey와 같을 때만 해제(이후 restart/modify가 재지정한 경우 보존)한다. 데이터탭이 404 재생버튼을 더는 렌더하지 않음. 값(audit-trail 외 측정값)은 원래부터 영향 없음. (이전: 06-11 백로그 CLIP-EMPTY(P2)) (`src/lib/useVoiceSession.ts`, `src/lib/audioRecorder.ts` `stopClip` 빈 버퍼 가드)
- **레이스(2026-06-12 발견):** 값 커밋이 포인터 사전등록 + fire-and-forget `persistSession()`을 먼저 실행하므로(첫 await 전에 포인터 포함 행을 동기 빌드), 그 persist가 in-flight인 동안 `clip_empty`→`unlinkBrokenPointer()`가 실행되면 **늦은 `upsertSession`/`saveSession`이 unlink를 되덮어 포인터가 부활**한다. 06-11 v0.6.0 실기기 로그 row8 c7에서 관측(수확된 sessions.json에 포인터 잔존). 해결은 [CLIP-VAL-1] ③(tombstone 또는 persist 직렬화)과 동일.

### [CLIP-VAL-1] 수정 재녹음 중 빈 캡처 → 이전 값 음성이 새 값 셀의 재생버튼으로 남음 (3중 결함)
- **증상:** row8 횡경(c7) 값은 155.5(시트 1560 일치)인데 데이터탭 재생버튼은 **이전 값 177.7 발화**를 재생. 사용자가 시트 비고에 "음성클립과 값 불일치"를 직접 남김.
- **타임라인(06-11 v0.6.0 실기기, evt id):** 177.7 커밋·클립 저장(201~209) → `"수정"`(212) → c7 재녹음 모드 → `"수정 155.5"`(219, cmd 클립 `8:c7:cmd1` 저장) → **재안내만 하고 녹음 미시작** → `"155.5"` 발화(225)가 **미녹음** → `clip_stop_resolved:null`(227)·`error clip_empty`(228) → value 155.5(230). 캐노니컬 `…:8:c7….wav`(73,644B)는 `:a1.wav`와 바이트 동일 = 177.7 음성 잔존·여전히 포인터 연결.
- **원인(4b0185c 코드 추적, 3중):** ① modify 핸들러의 `if (awaiting.isModify) { pendingCmd?.saveDefault(); await say(…); return; }` 분기가 `announceField()`와 달리 **클립을 재시작하지 않아** 다음 발화가 결정적으로 미녹음(`cancel` 분기도 동일 구조 — 잠재 동일 결함). ② `clip_empty`의 unlink가 in-flight `persistSession`에 되덮임([CLIP-3] 레이스). ③ 재녹음 커밋이 캐노니컬 키 `sess:row:colId`를 재사용해 빈 캡처 시 **이전 값 음성이 그 키 밑에 그대로 재생 대상**으로 남음.
- **해결·회피(v0.7.0 권장):** ① isModify/cancel 재안내 후 녹음 슬롯 재시작. ② 수정 재녹음 `clip_empty` 시 포인터를 `:cmd<n>` 클립으로 재연결(새 값 발화를 담고 있음 — 이번 건 정답은 `8:c7:cmd1`), 없으면 unlink. ③ unlink tombstone(`brokenClipKeysRef`를 persistSession `mergedClips`가 존중) 또는 persist 직렬화.
- **출처:** `2026-06-12 분석`(06-11 v0.6.0 실기기 로그 row8; 사용자 제보 메모 동반) — Trace 백로그 P1, ICE 7.3.
- **현재 상태:** ⚠️주시(최종 v0.6.0의 현재 버그 — v0.7.0 수정 대상)

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

### [SYNC-3] 컬럼 스키마 순서 변경 시 기존 synced 행 한계
- **증상:** 세션 생성 후 설정에서 **컬럼 순서를 바꾸면**, 이미 `synced`로 시트에 올라간 행들은 시트의 열 순서(append 당시 순서)와 로컬 열 순서가 어긋날 수 있다. 동기화는 행을 `synced`로 보고 다시 손대지 않으므로 기존 시트 행은 옛 순서 그대로 남는다.
- **원인:** 행 단위 재동기화는 값 변경(dirty)만 추적하고, **열 매핑 변화는 추적하지 않는다.** sheetRow는 위치만 가리키고 열 순서 메타는 행에 없다.
- **해결·회피:** 코드 수정 없음(C6 — 문서화만). 운용 회피: **세션을 만들고 동기화하기 시작했으면 그 세션의 컬럼 순서를 바꾸지 말 것.** 순서를 꼭 바꿔야 하면 새 세션으로 분리하거나 시트를 수동 정리한다.
- **출처:** `survey-011 v0.6.0` Codex 교차점검(C6, 한계 인정).
- **현재 상태:** ⚠️주시(설계상 한계 — 운용으로 회피) (`src/lib/sync.ts`)

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

### [ENV-3] 버전 테스트 하드코딩 → 버전 bump 시 실패
- **증상:** 버전 테스트가 `'0.12.0'`를 하드코딩 단정해, 버전 올리면 실패.
- **원인:** 앱 표시 버전이 vite define(`__APP_VERSION__ = pkg.version`)에서 오는데 테스트는 리터럴 비교.
- **해결·회피:** `package.json`의 version을 읽어 **동적 비교**(이번 세션에 수정).
- **출처:** `2026-06-04~05 세션`
- **현재 상태:** ✅수정됨 (`tests/v5-ui.spec.ts` line 15~19가 pkg.version 동적 읽기)

### [ENV-4] 문서의 테스트 명령 드리프트
- **증상:** 문서는 `npx tsx scripts/test-*.mjs`라는데, 실제 회귀는 `npx playwright test`(특히 `tests/koreanNum.spec.ts` 62케이스).
- **원인:** `CLAUDE.md`/`AGENTS.md`의 테스트 명령이 실제 테스트 구조와 어긋남.
- **해결·회피:** 실제 회귀는 `npx playwright test tests/koreanNum.spec.ts`로 돌려라. 문서 명령(`tsx scripts/test-koreanNum.mjs` 등)을 맹신하지 말 것.
- **출처:** `2026-06-04~05 세션`(survey-011 `CLAUDE.md` line 33, `AGENTS.md` line 31 모두 `tsx scripts/test-*.mjs` 명시)
- **현재 상태:** ⚠️주시 (문서 드리프트 미수정 — 문서는 이번 작업 범위 밖)

### [ENV-5] "세션 리플레이" 클립이 실제론 오디오 전용 (영상 트랙 0)
- **증상:** 시각 디버깅을 기대했지만 클립이 opus 오디오 전용, 영상 트랙 0개.
- **원인:** "session replay"는 화면 녹화가 아니라 음성 + 이벤트 로그 + 오디오 클립 기반.
- **해결·회피:** 시각 재현이 아니라 **이벤트 로그 + 오디오 + transcript 후보**로 재현하라(`log-replay.spec.ts` 방식). 화면 리플레이가 필요하면 Mack에게 계측 선결로 요청.
- **출처:** `2026-06-04~05 세션`
- **현재 상태:** ➖해당없음 (설계 사실 — 시각 리플레이 기능 자체가 없음)

### [ENV-6] vite-plugin-pwa peer-dependency 충돌 (조상 초기)
- **증상:** `vite-plugin-pwa` 설치가 `ERESOLVE` peer dependency 충돌로 실패(당시 Vite 8 toolchain).
- **원인:** 당시 릴리스가 스캐폴드된 Vite 버전 호환을 선언 안 함.
- **해결·회피:** 조상은 manual manifest+SW로 우회했으나, **survey-011은 이미 `vite-plugin-pwa`를 정상 사용 중**(`vite.config.ts`의 `VitePWA`). 버전 충돌 시 강제 설치보다 호환 버전 확인.
- **출처:** `debug-log`(2026-04-15)
- **현재 상태:** ➖해당없음 (survey-011은 VitePWA 정상 동작)

### [ENV-7] gh-pages 배포 — workflow scope 토큰 거부
- **증상:** `.github/workflows/*`를 만드는 push가 거부됨.
- **원인:** GitHub 토큰에 `repo`는 있으나 `workflow` scope 없음.
- **해결·회피:** workflow 기반 Pages 배포를 빼고 `gh-pages` 브랜치로 배포(`npm run deploy` → `gh-pages -d dist`).
- **출처:** `debug-log`(2026-04-15)
- **현재 상태:** ✅수정됨 (survey-011 `package.json` `deploy: build && gh-pages -d dist`)

### [ENV-8] PWA 업데이트 반영 지연으로 실기기에서 구버전 실행
- **증상:** 새 버전(v0.4.2)을 배포(deploy)했으나, 실기기(iOS Safari 등)에서 이전 버전(v0.4.1)이 계속 활성화되어 실행되며 신규 버그 패치 및 기능이 누락된 채 테스트 로그가 수집됨.
- **원인:** PWA 서비스 워커의 캐시 라이프사이클(`skipWaiting` 미강제 또는 자동 감지 UI 부재)로 인해 즉각적인 업데이트 및 새로고침이 브라우저에서 일어나지 않음.
- **해결·회피:** 서비스 워커 배포 시 업데이트 감지 이벤트를 UI에 팝업("새로운 버전이 있습니다. 새로고침하여 적용하세요")으로 띄우고 사용자가 인지하도록 가이드.
- **출처:** `2026-06-08 세션` (실기기 로그 분석)
- **현재 상태:** ✅수정됨 (5086 로그 분석 결과 v0.4.2 업데이트 및 실기기 정상 구동 완료 확인)


---

## ⑥ 인증 · Drive

### [AUTH-1] 백업 실패 시 자동삭제 게이트 — 추가→제거→복원 (같은 날 뒤집힘, 핵심 교훈)
- **증상:** Drive 백업이 실패한 상태에서 autoDelete가 로컬 세션을 삭제하면, `deleteSession`이 세션·오디오 클립·로그를 cascade 삭제하므로 **로컬 유일본이 영구 소멸**.
- **원인:** 백업과 삭제가 독립적으로 동작. "백업은 best-effort"라는 리뷰 판단으로 게이트를 제거했다가, cascade 삭제의 파괴력을 다시 인지.
- **해결·회피 (뒤집힌 이력):**
  1. 게이트 **추가** — `backupOk=true`인 경우에만 로컬 삭제, 실패 시 보존+경고 (`55bb61e`).
  2. 게이트 **제거** — "백업은 best-effort, 실패해도 시트 성공 세션은 삭제" (`ad60ba5`).
  3. 게이트 **복원** (같은 날) — deleteSession이 cascade라 유일본 소멸 → 백업 실패 시 보존+경고 (`222f337`).
  4. 강화 — admin 폴더 설정 시 admin 업로드도 성공해야 `backupOk` (`8ce8dca` HIGH-1).
- **출처:** `growth-survey-010@55bb61e` → `@ad60ba5` → `@222f337`(전부 2026-05-20) → `@8ce8dca`(v0.10.1)
- **현재 상태:** ✅수정됨 (`src/screens/DataScreen.tsx` line 121~128 `backupOk` 게이트 + admin 검증)
- **교훈:** **삭제가 cascade라면 백업 실패 시 절대 삭제하지 마라.** "best-effort"라는 말에 속아 게이트를 빼면 같은 날 도로 넣게 된다. cascade 삭제의 blast radius를 먼저 확인하라.

### [AUTH-2] 미동의 세션 오디오/이벤트 데이터 유출
- **증상:** 자동 로그 업로드가 동기화 안 한 세션의 오디오/이벤트까지 Drive로 보냄.
- **원인:** `exportLogZip`이 전체 세션을 무조건 업로드.
- **해결·회피:** `exportLogZip(sessionIds?)` 시그니처로 다중 세션 필터, 시트 성공 시 `successIds`로 스코프한 ZIP만 업로드. 수동 LOG 버튼은 인수 없이 전체 백업 유지.
- **출처:** `growth-survey-010@a36b4da` (HIGH)
- **현재 상태:** ✅수정됨 (`src/lib/exportLog.ts` `exportLogZip(ids)`, DataScreen이 successIds로 호출)

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

### [NAV-1] "다음" 건너뛰기 후 완료된 행으로 반복 복귀하는 루프
- **증상:** 재입력 중 "다음"으로 행을 건너뛴 뒤, 진행이 이미 완료된 행으로 자꾸 되돌아가 같은 행을 재프롬프트. 2026-06-10 세션의 마지막 80초 중 70초가 이 루프에 소모됨(18행 중 17행 완료 세션).
- **원인 (코드 추적 확정):** ① 재입력 중 "다음"의 `jumpToRow(next,{setReturn:false})`가 완료 여부 확인 없이 완료 행을 재프롬프트, ② 거기서 다시 "다음"→`gotoAdjacentRow(1)`이 완료 행을 returnRow로 등록 → `advance()`가 완료 행으로 복귀, ③ `findNextIncompleteRow`의 wrap-around 2차 루프가 위쪽 행까지 재방문.
- **해결·회피:** **v0.5.0에서 행 진행을 단방향(위→아래)으로 전면 전환** — wrap-around 2차 루프 삭제, 새 헬퍼 `goNextRow()`(reentry 해제 → 미완료 행이면 `markRowSkipped`+즉시 영속화 → 아래 방향만 탐색 → `jumpToRow(…,{setReturn:false})`)로 "다음" 음성·▶다음행 버튼 통일, returnRow 분기에 완료-행 가드(이중 차단), `gotoAdjacentRow`는 delta=-1 전용으로 축소. 건너뛴 행은 데이터탭에 빈 placeholder 행으로 유지(행 번호 amber 강조, EditableCell 터치로 채움 — Sheets에는 현행대로 완료 행만 업로드). 마지막 행 도달 시 빈 행 번호를 TTS로 안내 후 자동 종료.
- **출처:** `2026-06-10 실기기 로그` → **survey-011 v0.5.0** 수정; `2026-06-11 실기기 로그` — **실기기 재확인**: row12 skip 후 `jump touch:12->13`으로 아래 방향만 진행, 완료행 반복 복귀 **0건**(06-10의 70초 루프 소멸).
- **현재 상태:** ✅수정됨 (`src/lib/useVoiceSession.ts` `goNextRow`/`findNextIncompleteRow`/returnRow 가드, `src/stores/sessionStore.ts` `skippedRows`/`markRowSkipped`; 회귀 `tests/nav-unidirectional.spec.ts`; 06-11 실기기 단방향 진행 확인)

### [NAV-2] "유지" 명령이 인식되고도 무동작(no-op)
- **증상:** 재입력(reentry) 모드 밖에서 "유지"라고 말하면 명령으로 인식은 되지만 아무 동작·음성 피드백 없이 무시됨.
- **원인:** keep 처리가 reentry 모드 한정 분기라 그 밖에서는 silent return — [REVIEW-4] "무음 return 금지"의 재발.
- **해결·회피:** **v0.5.0에서 keep을 일반화** — 현재 칸에 값이 있으면(또는 reentry 중) 그 값을 유지하고 advance, 값이 없으면 "유지할 값이 없습니다. {항목명} 말씀해 주세요." 명시 피드백 + `keep_no_value` 로그(무음 return 금지). `voiceCommands.ts` desc 갱신.
- **출처:** `2026-06-10 실기기 로그` → **survey-011 v0.5.0** 수정
- **현재 상태:** ✅수정됨 (`src/lib/useVoiceSession.ts` keep 분기 line 871~, `src/lib/voiceCommands.ts`) — **2026-06-12 실기기 확인(재입력 안)**: 06-11 v0.6.0 로그 row12에서 "이전"으로 완료행 재진입 후 "유지" 2회(c7 conf .96 / c8 conf .94) → 값 233.3/244.4 보존·정상 진행. ⚠️ 재입력 **밖**(빈 칸) `keep_no_value` 경로는 여전히 미발화 — 다음 테스트 1회 요청.

---

## 확인 필요 (미검증)

아래는 출처로 충분히 뒷받침되지 않았거나 survey-011 적용 여부를 직접 확인하지 못한 항목. **본문 항목으로 신뢰하지 말 것.** 검증 후 해당 카테고리로 승격하거나 폐기하라.

1. **pause/resume 시 recorder 누수** — 조상 `@7dd6e8b`(입력-B: pause 중 recorder dispose + resume 시 재생성)에서 누수 차단을 언급. survey-011 `audioRecorder.ts`/`useVoiceSession.ts`의 pause/resume 경로가 동일 패턴을 따르는지 미확인.
2. **IDB 클립 구형 Blob 하위호환 경로** — `db.ts`가 ArrayBuffer로 저장하면서 구형 Blob도 읽는다는데, survey-011이 신규 레포라 구형 데이터가 존재하는지/하위호환 코드가 실제로 필요한지 미검증.
3. **GitHub issues/PR 기반 추가 함정** — 010 issues 0건, 011 issues/PR 0건, 010 PR 1건(`v0.9-improvements` = `@2ed62a5`, 이미 반영). gh 출처에서 **신규 distinct 이슈 없음**. 향후 issue 생기면 여기서 수확.
4. **survey-011 자체 v0.1~v0.2 라인의 함정** — 본 문서는 조상(010)과 이번(06-04~05) 세션 중심. survey-011의 v0.3.0 이전 자체 커밋 이력은 별도 수확 대상(미수행).
