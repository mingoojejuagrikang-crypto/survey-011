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
- **해결·회피:** 한국어 자리값 수사를 별도 파싱하고, 순수 숫자 수사일 때 선행 `이`를 보존. survey-011에는 전용 모듈 `koreanNum.ts` + 62케이스 회귀(`tests/koreanNum.spec.ts`)로 분리됨.
- **출처:** `debug-log`(2026-04-20)
- **현재 상태:** ✅수정됨 (`src/lib/koreanNum.ts`, `tests/koreanNum.spec.ts`)

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
- **해결·회피:** 앞단의 무관한 한절 명사가 "백"과 발음이 유사한 단어("액", "개", "엑", "에봇" 등)이면 ambiguous 처리하여 재질문하거나 기대 범위 오차 임계(이상치) 검사 적용 필요.
- **출처:** `2026-06-05 세션` (실기기 로그 분석)
- **현재 상태:** ⚠️주시

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
- **현재 상태:** ✅수정됨 (`src/stores/sessionStore.ts` `setSessionMeta`, `src/lib/useVoiceSession.ts` 복원 effect + persist 폴백; 회귀 `tests/correction-flow.spec.ts` "D-2 RACE-7…", 무력화 시 `id:""`로 실패함을 확인)

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

## 확인 필요 (미검증)

아래는 출처로 충분히 뒷받침되지 않았거나 survey-011 적용 여부를 직접 확인하지 못한 항목. **본문 항목으로 신뢰하지 말 것.** 검증 후 해당 카테고리로 승격하거나 폐기하라.

1. **pause/resume 시 recorder 누수** — 조상 `@7dd6e8b`(입력-B: pause 중 recorder dispose + resume 시 재생성)에서 누수 차단을 언급. survey-011 `audioRecorder.ts`/`useVoiceSession.ts`의 pause/resume 경로가 동일 패턴을 따르는지 미확인.
2. **IDB 클립 구형 Blob 하위호환 경로** — `db.ts`가 ArrayBuffer로 저장하면서 구형 Blob도 읽는다는데, survey-011이 신규 레포라 구형 데이터가 존재하는지/하위호환 코드가 실제로 필요한지 미검증.
3. **GitHub issues/PR 기반 추가 함정** — 010 issues 0건, 011 issues/PR 0건, 010 PR 1건(`v0.9-improvements` = `@2ed62a5`, 이미 반영). gh 출처에서 **신규 distinct 이슈 없음**. 향후 issue 생기면 여기서 수확.
4. **survey-011 자체 v0.1~v0.2 라인의 함정** — 본 문서는 조상(010)과 이번(06-04~05) 세션 중심. survey-011의 v0.3.0 이전 자체 커밋 이력은 별도 수확 대상(미수행).
