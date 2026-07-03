# KNOWN-ISSUES-ARCHIVE — survey-011 종결 항목 보관소

> **해결 완료·종결 항목의 이력 보관소.** 미해결·주시 항목은 [KNOWN-ISSUES.md](KNOWN-ISSUES.md)를 보라.
> 항목 본문은 KNOWN-ISSUES.md에서 이동 당시 **원문 그대로**이며 수정하지 않는다. 섹션 구조는 원본과 동일하게 유지한다.
> 재오픈이 필요하면 항목을 원문 그대로 KNOWN-ISSUES.md 해당 섹션으로 되돌리고, 본문의 "아카이브로 이동된 항목" 색인에서 그 줄을 제거하라.

---

## ① 음성 / STT 파서

### [STT-1] 200대 한국어 자리값 수사 오인식 ("이백" → 100)
- **증상:** `횡경 이백`, `종경 이백십일점일` 같은 200대 한국어 수사가 `100`/`111.1`로 잘못 파싱됨.
- **원인:** 숫자 파서가 항목 뒤 조사 제거 규칙을 먼저 적용하면서, 값의 첫 음절 `이`까지 조사로 잘라냄.
- **해결·회피:** 한국어 자리값 수사를 별도 파싱하고, 순수 숫자 수사일 때 선행 `이`를 보존. survey-011에는 전용 모듈 `koreanNum.ts` + 62케이스 회귀(`tests/koreanNum.spec.ts`)로 분리됨. **v0.5.0 가드:** 명령어가 흡수해 쪼개진 발화가 유효 숫자 토큰 2개 이상으로 남으면 침묵 커밋하지 않고 ambiguous(`null`) 처리해 재질문(`stt_parse_failed` `multi_numeric` 태깅).
- **출처:** `debug-log`(2026-04-20); `2026-06-10 실기기 로그` — **수정 경로 재발**: `"수정 이백육십육점칠"`(266.7 의도)이 `"수정이 166.7"`로 인식돼 선행 `이`가 명령어에 흡수, `166.7`이 침묵 커밋됨; `2026-06-11 실기기 로그` — **v0.5.0 가드 실기기 작동 확인**: `"수정이 177.7"`(row14)이 `parsed:modify`로 처리돼 잘못된 177.7을 **침묵 커밋하지 않고** 재질문 → 사용자 재발화로 277.7 정상 커밋(06-10 침묵커밋과 대조).
- **현재 상태:** ✅수정됨 (`src/lib/koreanNum.ts`, `tests/koreanNum.spec.ts`; 침묵 커밋 가드는 survey-011 v0.5.0 — STT 오인식 자체는 잔존, 재질문으로 전환됨. 06-11 실기기 가드 작동 확인)

### [STT-13] iOS Safari Web Speech가 confidence를 비워 반환 → 코드의 `?? 1` 강제변환으로 인식 허용범위 게이트 무력화
- **증상(v0.19.0 실기기, Trace+Pax):** 0.65 신뢰도 게이트가 실오류를 **0건** 차단(conf≥0.65 오커밋 17건/14셀, conf<0.65 오커밋 0건). `400`(정답 299.9)·`188.8`(정답 288.8)이 conf 0.99로 침묵 커밋.
- **원인(코드+리서치):** `speech.ts`가 `r[0]?.confidence ?? 1` — 엔진이 confidence를 안 주면 **1.0으로 강제**. Pax 검증: iOS Safari Web Speech는 confidence를 비우거나 신뢰 불가하게 반환하는 경우가 많음 → 결과적으로 모든 발화가 conf 1.0으로 게이트 통과 → 허용범위 다이얼(`recognitionTolerance`)이 헛돌 위험.
- **해결·회피(v0.20.0):** ① 인식 허용범위를 사용자 다이얼로 노출(`recognitionTolerance`, 기본 0.60, 입력탭). ② **계측 우선**: `speech.ts`가 final마다 `raw_confidence:<n>|absent` 로깅해 "0.0 반환" vs "부재(→1 강제)"를 구분.
- **⚙️ 실측 종결(2026-06-25, v0.20.0 2세션):** `raw_confidence:absent` **0/123 (0%)** — iOS Safari가 confidence를 **정상 채움**(0.009~0.997 스프레드). 저신뢰 거부(`rejected_low_confidence`)가 0.307/0.548/0.574에서만 실동작 = 게이트 정상. **전제 반증** — `?? 1` 폴백은 실사용에서 트리거되지 않으므로 코드 수정 불필요(현행 유지). 직전 v0.19.0의 "0.99 침묵 오커밋"은 confidence가 실제로 높았던 케이스로 재해석됨.
- **출처:** `2026-06-24 v0.19.0 실기기 분석` → `2026-06-25 v0.20.0 2세션 실측`
- **현재 상태:** ✅반증·종결(confidence는 신뢰 가능, 게이트 실동작). 진짜 방어선은 TTS 되읽기 유지.

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

### [CLIP-7] Logger 이벤트가 reload 후 소실 (메모리 전용)
- **증상:** 리로드하면 진단 이벤트 로그가 사라져 ZIP에 안 들어감.
- **원인:** logger가 메모리 push만 함.
- **해결·회피:** DB v3에 `logEvents` object store + `bySessionId` 인덱스 추가, `logger.log`이 메모리 push와 동시에 IDB fire-and-forget 기록, `exportLogZip`이 IDB 우선 조회.
- **출처:** `growth-survey-010@a5950f0` (v5.2 4차)
- **현재 상태:** ✅수정됨 (`src/lib/logger.ts`, `src/lib/db.ts` logEvents)

### [LOAD-1] 앱 업데이트 후 "세션이 사라짐" — 실제론 App.tsx 빈 catch가 hydrate 실패를 삼킴
- **증상:** 사용자: "앱 업데이트나 알 수 없는 원인으로 데이터탭의 세션이 사라진다." 데이터는 IDB에 남아있는데 화면엔 빈 목록("아직 기록된 데이터가 없습니다")만 표시.
- **원인:** `App.tsx`의 hydrate effect가 `loadAllSessions()` 예외를 **빈 `catch {}`로 삼킴** → `sessions:[]` 유지 + `setHydrated(true)`. DataScreen은 "로드 실패"와 "정말 빈 목록"을 구분 못 해 EmptyState 렌더. 트리거는 **앱 업데이트**(PWA `autoUpdate` + IDB 버전/멀티탭 `VersionError`)가 로드를 실패시키는 순간. [REVIEW-1] "빈 catch 금지"의 재발.
- **해결·회피:** 로드 로직을 `src/lib/hydrate.ts` `hydrateSessions()`로 단일화 — 실패 시 **로깅**(`extra:'hydration_failed'`) + `dataStore.hydrationError`(에러 메시지) 기록. DataScreen은 에러 상태면 EmptyState 대신 **"데이터를 불러오지 못했습니다 + 다시 시도"** UI(`VersionError`면 새로고침 안내)를 렌더. 데이터는 삭제되지 않으므로 재시도/새로고침으로 복구.
- **출처:** `2026-06-05 세션`(피드백) → **survey-011 v0.4.0** 수정
- **현재 상태:** ✅수정됨 (`src/App.tsx`, `src/lib/hydrate.ts`, `src/stores/dataStore.ts` `hydrationError`, `src/screens/DataScreen.tsx` `LoadErrorState`; 회귀 `tests/correction-flow.spec.ts` "D-2 — fresh start→종료→reload …")
- **교훈:** 또 빈 catch였다. **모든 로드/영속화 실패는 로깅하고, "빈 목록"과 "로드 실패"를 UI에서 반드시 구분**하라. "데이터 없음"이 진짜 없음을 의미하지 않는다 — 삼켜진 것일 수 있다.

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

### [ALERT-1] 이상치 정정 재측정 시 팝업과 echo TTS 불일치 — 정정 경로가 팝업을 갱신 안 함
- **증상(민구 제보):** 이상치 알람 팝업 뒤 재측정값을 음성입력하면, **인식 TTS가 말하는 값과 팝업에 보이는 값이 불일치**. 또 재측정이 정상으로 판명돼도 팝업이 초록 전환·즉시 반영 없이 그냥 사라짐.
- **원인(코드 추적 확정):** trendConfirm 상태에서 새 값이 값-커밋 경로로 폴스루(`useVoiceSession.ts:1365~`)할 때, 화면의 `anomalyAlert` 스토어 상태를 **갱신하거나 닫는 호출이 없었다**. 팝업 해소는 (a) '확인'/'유지' 명령 분기와 (b) advance→announceField의 `setAnomalyAlert(null)` 두 곳뿐 → '새 값 정정' 경로엔 누락. 결과: 옛 이상치 next 값이 팝업에 남은 채 echo TTS("수정 …")만 새 값을 말해 시각/청각이 갈림. 팝업도 단일 빨강 상태만 가져 '정상 복귀=초록'을 표현할 데이터모델이 없었다.
- **해결·회피(v0.13.0 R2):** `anomalyAlert`에 `status('pending'|'corrected')` 필드 추가. 정정 재측정이 위반 분기를 안 타고(=정상) trendConfirm일 때 `setAnomalyAlert({...cur, next:정정값, status:'corrected'})`로 **즉시 갱신** → 팝업이 빨강→초록 전환 + 정정값 즉시 반영(echo TTS와 일치). 닫힘은 기존대로 advance→announceField가 담당(echo 발화 동안 초록 노출). 재이상치면 기존 빨강 경로(status:'pending') 유지. `AnomalyAlertPopup`은 status undefined일 때 빨강(회귀 없음).
- **출처:** `2026-06-18 세션`(민구 제보) → **survey-011 v0.13.0** 수정
- **현재 상태:** ✅수정됨 (`src/lib/useVoiceSession.ts` trendConfirm corrected 갱신, `src/components/voice/AnomalyAlertPopup.tsx` corrected 초록 렌더, `src/stores/sessionStore.ts` status 필드; 회귀 `tests/trend-alert.spec.ts`)

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

### [CLIP-VAL-1] 수정 재녹음 중 빈 캡처 → 이전 값 음성이 새 값 셀의 재생버튼으로 남음 (3중 결함)
- **증상:** row8 횡경(c7) 값은 155.5(시트 1560 일치)인데 데이터탭 재생버튼은 **이전 값 177.7 발화**를 재생. 사용자가 시트 비고에 "음성클립과 값 불일치"를 직접 남김.
- **타임라인(06-11 v0.6.0 실기기, evt id):** 177.7 커밋·클립 저장(201~209) → `"수정"`(212) → c7 재녹음 모드 → `"수정 155.5"`(219, cmd 클립 `8:c7:cmd1` 저장) → **재안내만 하고 녹음 미시작** → `"155.5"` 발화(225)가 **미녹음** → `clip_stop_resolved:null`(227)·`error clip_empty`(228) → value 155.5(230). 캐노니컬 `…:8:c7….wav`(73,644B)는 `:a1.wav`와 바이트 동일 = 177.7 음성 잔존·여전히 포인터 연결.
- **원인(4b0185c 코드 추적, 3중):** ① modify 핸들러의 `if (awaiting.isModify) { pendingCmd?.saveDefault(); await say(…); return; }` 분기가 `announceField()`와 달리 **클립을 재시작하지 않아** 다음 발화가 결정적으로 미녹음(`cancel` 분기도 동일 구조 — 잠재 동일 결함). ② `clip_empty`의 unlink가 in-flight `persistSession`에 되덮임([CLIP-3] 레이스). ③ 재녹음 커밋이 캐노니컬 키 `sess:row:colId`를 재사용해 빈 캡처 시 **이전 값 음성이 그 키 밑에 그대로 재생 대상**으로 남음.
- **해결·회피(v0.7.0 권장):** ① isModify/cancel 재안내 후 녹음 슬롯 재시작. ② 수정 재녹음 `clip_empty` 시 포인터를 `:cmd<n>` 클립으로 재연결(새 값 발화를 담고 있음 — 이번 건 정답은 `8:c7:cmd1`), 없으면 unlink. ③ unlink tombstone(`brokenClipKeysRef`를 persistSession `mergedClips`가 존중) 또는 persist 직렬화.
- **출처:** `2026-06-12 분석`(06-11 v0.6.0 실기기 로그 row8; 사용자 제보 메모 동반) — Trace 백로그 P1, ICE 7.3.
- **현재 상태:** ✅수정됨(**survey-011 v0.7.0**, 3중 모두) — ① isModify/cancel 재안내가 `armClipForCell`로 녹음 슬롯을 재시작(재발화가 결정적으로 녹음됨), ② 수정 재녹음 `clip_empty`/`clip_too_small`/`clip_save_failed` 시 포인터를 `:cmd<n>` 클립으로 재연결(`clip_relink_cmd` — 새 값 발화를 담음), 없으면 unlink, ③ 실패 캡처 키 tombstone(`brokenClipKeysRef`)을 persistSession의 모든 audioClips 병합 + await 후 re-strip이 존중하고, 보정 clean save는 **await**로 영속 보장(페이지 사망 창 차단). (`src/lib/useVoiceSession.ts`; 회귀 `tests/clip-modify-rerecord.spec.ts` 4케이스 — 재안내 후 녹음·cancel 분기·cmd 재연결 생존·unlink 비부활)

## ⑤ 빌드 / 테스트 / 배포 환경 (이번 세션 직격탄)

### [ENV-3] 버전 테스트 하드코딩 → 버전 bump 시 실패
- **증상:** 버전 테스트가 `'0.12.0'`를 하드코딩 단정해, 버전 올리면 실패.
- **원인:** 앱 표시 버전이 vite define(`__APP_VERSION__ = pkg.version`)에서 오는데 테스트는 리터럴 비교.
- **해결·회피:** `package.json`의 version을 읽어 **동적 비교**(이번 세션에 수정).
- **출처:** `2026-06-04~05 세션`
- **현재 상태:** ✅수정됨 (`tests/v5-ui.spec.ts` line 15~19가 pkg.version 동적 읽기)

### [ENV-9] settings persist migrate가 시드 trendRule을 삼킴 — Playwright 시드는 최신 version으로
- **증상:** v0.8.0 작업 중 `tests/review-screen.spec.ts`가 컬럼 `trendRule:'increase'`를 시드했는데, 부팅 후 화면에서 이상치 강조(data-violation)가 전혀 안 떴다. 셀은 정상 렌더(`data-arrow='up'`)되지만 `checkAnomaly`가 발화하지 않음.
- **원인:** 시드 페이로드가 `version:5`였는데 store persist가 `version:6`으로 올라감 → 부팅 시 v5→v6 migrate 블록이 실행되어 `delete c.trendRule`(이상치 알람 의미 반전에 따른 클리어)을 적용 → 하이드레이트 시점에 trendRule이 사라져 규칙이 비활성.
- **해결·회피:** **활성 이상치 알람(trendRule/pctThreshold)을 테스트하는 Playwright 시드는 store의 현재 persist version으로 맞춰라**(현재 `6`). 이미 최신 version이면 migrate가 idempotent 경로로 빠져 사용자 설정값을 보존한다. settings/trend/review 스펙 모두 `version:6`으로 시드해 해결.
- **출처:** `2026-06-15 v0.8.0 작업(WS1~WS3)` — `src/stores/settingsStore.ts` persist `version:6` + v6 migrate(`delete c.trendRule`); `tests/review-screen.spec.ts`·`tests/trend-alert.spec.ts`·`tests/settings-migration.spec.ts` 시드 version 정렬.
- **현재 상태:** ✅회피됨 (영향 스펙 전부 version:6 시드로 정렬, 320/320 통과). 일반 교훈: migrate가 필드를 삭제/변환하는 버전에서는 시드 version이 migrate 동작을 바꾼다 — 시드 version을 의도적으로 선택할 것.

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

## ⑦ 리뷰 프로세스 교훈

(이동 항목 없음)

## ⑧ 입력 흐름 · 내비게이션

### [NAV-1] "다음" 건너뛰기 후 완료된 행으로 반복 복귀하는 루프
- **증상:** 재입력 중 "다음"으로 행을 건너뛴 뒤, 진행이 이미 완료된 행으로 자꾸 되돌아가 같은 행을 재프롬프트. 2026-06-10 세션의 마지막 80초 중 70초가 이 루프에 소모됨(18행 중 17행 완료 세션).
- **원인 (코드 추적 확정):** ① 재입력 중 "다음"의 `jumpToRow(next,{setReturn:false})`가 완료 여부 확인 없이 완료 행을 재프롬프트, ② 거기서 다시 "다음"→`gotoAdjacentRow(1)`이 완료 행을 returnRow로 등록 → `advance()`가 완료 행으로 복귀, ③ `findNextIncompleteRow`의 wrap-around 2차 루프가 위쪽 행까지 재방문.
- **해결·회피:** **v0.5.0에서 행 진행을 단방향(위→아래)으로 전면 전환** — wrap-around 2차 루프 삭제, 새 헬퍼 `goNextRow()`(reentry 해제 → 미완료 행이면 `markRowSkipped`+즉시 영속화 → 아래 방향만 탐색 → `jumpToRow(…,{setReturn:false})`)로 "다음" 음성·▶다음행 버튼 통일, returnRow 분기에 완료-행 가드(이중 차단), `gotoAdjacentRow`는 delta=-1 전용으로 축소. 건너뛴 행은 데이터탭에 빈 placeholder 행으로 유지(행 번호 amber 강조, EditableCell 터치로 채움 — Sheets에는 현행대로 완료 행만 업로드). 마지막 행 도달 시 빈 행 번호를 TTS로 안내 후 자동 종료.
- **출처:** `2026-06-10 실기기 로그` → **survey-011 v0.5.0** 수정; `2026-06-11 실기기 로그` — **실기기 재확인**: row12 skip 후 `jump touch:12->13`으로 아래 방향만 진행, 완료행 반복 복귀 **0건**(06-10의 70초 루프 소멸).
- **현재 상태:** ✅수정됨 (`src/lib/useVoiceSession.ts` `goNextRow`/`findNextIncompleteRow`/returnRow 가드, `src/stores/sessionStore.ts` `skippedRows`/`markRowSkipped`; 회귀 `tests/nav-unidirectional.spec.ts`; 06-11 실기기 단방향 진행 확인)

### [SESSION-LABEL-OPTIONS-1] 세션명 디폴트가 단일선택 옵션 상수를 누락
- **증상:** 세션명 기본값이 "생성일 + 고정값"으로 요청됐는데 실제론 날짜 단독(`2026-06-25-2`)으로 남음 — 농가명·라벨 등 세션 식별값이 빠짐.
- **원인:** `pickSessionLabelValue`(SettingsScreen)가 "고정값"을 `auto.kind==='fixed'`로만 판정 → 단일선택 **options**(농가명=[강남호], 라벨=[A])를 놓침. 사용자의 "고정값"(세션 내내 불변값) ≠ 코드의 `fixed` 종류. 세션시작 폴백 `buildAutoLabel`(VoiceScreen)도 첫 고정값 하나만 집어 형식 불일치(SSOT 위반 — 주석은 "일치"라 주장).
- **해결:** v0.22.0 — `sessionLabel.ts`에 `sessionConstantValue`(=`!isCycling`+유효값, 단일선택 options[0] 포함, date·순환 제외)·`buildSessionLabel`(우선순위: 사용자지정 > 날짜+상수 > 날짜) 신설, pickSessionLabelValue/buildAutoLabel 단일 헬퍼로 통일. 설정탭에 자유입력 세션명 필드(`settingsStore.sessionCustomLabel`) 추가.
- **출처:** `2026-06-25 v0.21.0 실기기 로그`(sessions.json: 농가명/라벨=단일선택 options, label=`2026-06-25-2`; firsthand 코드 확인).
- **현재 상태:** ✅수정됨(v0.22.0 `sessionLabel.ts`·`SettingsScreen.tsx`·`VoiceScreen.tsx`·`settingsStore.ts`).

### [LASTROW-AUTOEND-1] 마지막 행 입력 시 자동 종료로 수정 불가 (v0.23.0 변경)
- **증상:** 마지막 행 마지막 음성값을 입력하면 `"모든 입력이 완료되었습니다"` 후 즉시 종료(`finishAtEnd`→`stop(false)`) → 사용자가 마지막 값을 고치려 해도 그 전에 세션이 끝남.
- **원인:** `useVoiceSession.advance()`(및 `goNextRow`)가 `findNextIncompleteRow===null`이면 `finishAtEnd()`로 자동 종료. 민구 요청: 종료는 명시적이어야(수정 여지 확보).
- **해결:** v0.23.0 — 자동 종료 제거. 마지막 행 후 `announceEndReached()`가 `"마지막 행까지 입력했습니다. 종료하려면 '종료'라고 말씀하거나 종료 버튼을 누르세요"` 안내 후 세션 active 유지. awaiting을 `atEnd` 센티넬로 둬 명령(종료/수정)은 계속 처리되되 일반 값 발화는 새 행으로 커밋되지 않고 재안내. 종료는 `'종료'` 음성 명령·종료 버튼만.
- **출처:** `2026-06-26 v0.22.0 실기기 로그`(S1·S2 둘 다 마지막값→`session:stop` 즉시; 민구 요청). Playwright `v023-voice.spec.ts` B4 + `nav-unidirectional.spec.ts` 갱신.
- **현재 상태:** ✅수정됨(v0.23.0 `useVoiceSession.ts`). **✅ 2026-06-29 v0.23.0 실기기 확정:** 마지막값(ts 1782693368375) → +1.1s 신규 `session:end_reached_waiting` 단계 진입(즉시 stop 아님) → 사용자가 `"이전"`×3(conf 0.90~0.98) 발화로 이전 행 검토 → +27.8s `"종료"`(conf 0.943) → `session:stop`(18/18). 자동 즉시종료 제거 + 종료까지 대기·수정·네비 가능 설계 의도대로 작동.
