/* eslint-disable max-lines -- [ENV-12] 기존 초과 파일(GL-006 §5 도입 시점), Stage 3(음성 코어 재설계)에서 해소. 해소 시 이 주석 제거. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore, minConfidenceForTolerance } from '../stores/settingsStore';
import { useSessionStore, isSessionLive } from '../stores/sessionStore';
import { useDataStore } from '../stores/dataStore';
import { recountSynced } from './sessionSync';
import { parseKoreanNumber, detectCommand, extractModifyValue, isAmbiguousSingleSyllable, isBareResponseWord } from './koreanNum';
// [ENV-12] v0.43.0 #3 — 값 파싱 시도는 순수 모듈이 소유한다(부수효과 없음). 이 파일은 호출만.
import { attemptParseValue, parseValueForCol } from './valueParseAttempt';
import { VOICE_COMMANDS, extractModifyColumn, isVoiceUiCommand, type VoiceUiCommandSignal } from './voiceCommands';
import { decimalReaskPrompt, REASK_TTS, relistenPrompt, reviewWaitAbsorbTts, endReachedTts, REVIEW_WAIT_COMMANDS_TTS } from './voicePrompts';
import { SpeechController, speak, cancelTts, isSpeechSupported, formatForTts, warmupTts, setActiveController, setPreferredVoiceName, setBargeInEnabled, refreshVoices, resumeTtsEngine } from './speech';
import { computeTotalRows, buildCyclingValues, nestedAutoValue, isUserInputColumn } from './autoValue';
import type { Column, Session, SessionRow, SessionTarget } from '../types';
import { saveSession, saveAudioClip, loadAudioClip, loadSession } from './db';
import { playBeep, unlockAudioPlayback } from './beep';
import { useModifyPhase } from './modifyPhase';
import { useSessionCommitMarks } from '../components/voice/useVoiceCommitMark';
import { useCellPersistError } from './cellPersistError';
import { AudioRecorder, type AudioTrackState, type ClipResult } from './audioRecorder';
import { logger } from './logger';
import {
  anomalyAlertCleared,
  audioInputClass,
  audioRouteRevalidate,
  bargeInTextSource,
  bgKeep,
  bgMicAction,
  clipArmBlocked,
  lowConfidenceParsed,
  manualHoldGuide,
  micAutoReconnect,
  micInitFailed,
  notifyPerm,
  rowMarked,
  wouldSalvage,
} from './logEvents';
import { shouldKeepInBackground, LONG_BACKGROUND_OFF_MS } from './backgroundSessionPolicy';
import { requestNotifyPermissionOnce, showBackgroundOffNotification } from './backgroundNotify';
import { resolveForegroundReturnEvent } from './foregroundReturnTelemetry';
import { resolveFinal } from './voiceFinalResolver';
import { unlinkClipPointer, relinkClipPointer } from './clipPointer';
import { hydratePastIndexFallback, prefetchPastIndex, resetPastIndexRetries } from './pastValues';
import { evaluateTrendForRow, anomalyAlertContext } from './trendEvaluate';
import { checkAnomaly, type TrendViolation } from './trendCheck';
import { buildAnomalyAlert } from './anomalyAlert';
import { readonlySheetsAuth } from './sheets';
import { withoutPendingCandidate } from './pendingValidation';
import { isSheetSourceBlocked, sessionTargetFromSettings } from './sheetConnection';
import { ensureUniqueSessionLabel } from './sessionLabel';
// [ENV-12] Stage 3 — 클립 캡처·보존 장부는 useClipCapture가 소유한다(이 파일은 호출만).
import { useClipCapture, EMPTY_CLIP_BYTES, type PendingCommandClip } from './useClipCapture';
import {
  INITIAL_FOREGROUND_RETURN_STATE,
  reduceForegroundReturn,
  shouldEmitRouteRevalidate,
  type ForegroundReturnState,
} from './foregroundReturnPolicy';
import { classifyInputDevice, classifyAudioInputClass } from './inputDevice';


/** 대기 셀 공통 좌표. */
interface AwaitingBase {
  row: number;
  colId: string;
  name: string;
}

/**
 * v0.35.3 Stage 3 — 대기 상태 판별 유니온(종전 boolean 5개: isModify/trendConfirm/fractionWhole/
 * atEnd/reviewWait). 실측 상태기계를 그대로 옮겼고 무효 조합(atEnd/reviewWait가 수정·소수 페이로드를
 * 갖는 것 등)은 컴파일이 차단한다. 상태 의미(각 boolean 시절 주석 요약):
 *
 *  - 'value'        일반 값 대기. fractionWhole(v0.10.0 A1): STT가 소수부를 유실("111 점 에" →
 *                   decimal_fraction_lost)하면 정수부를 담고 "소수점 아래만" 재질문 — 다음 발화가
 *                   소수 한 자리면 `${fractionWhole}.${digit}` 합성 커밋. 값 추측(에→1)은 하지
 *                   않는다(같은 STT 문자열이 111.1·111.5 양쪽에서 나옴 — 민구 결정).
 *  - 'modify'       다음 final을 수정 값으로 처리. previousValue(#3 error-vs-intent): 정정 시작 전
 *                   커밋돼 있던 값 — 최종 값과 함께 로깅해 STT 앞자리 유실(133.3→33.3)과 의도적
 *                   재입력을 분석에서 구분. fractionWhole은 수정 중 소수부 유실 재질문에서도 유지.
 *  - 'trendConfirm' v0.7.0 B4 추세 확인 — 위반 알림 직후 '확인'/'유지'(확정·진행) 또는 새 값
 *                   (수정 의미론으로 재커밋 → 재검증) 대기. **수정 의미론을 포함**한다(종전
 *                   isModify=true 겸장) — isModifyLike()로 판별. 커밋된 값 자체는 유효하게 저장돼
 *                   있다. 재커밋 발화가 소수부 유실이면 fractionWhole 재질문도 이 모드에서 가능.
 *  - 'atEnd'        v0.23.0 입력탭#4 — 마지막 행 완료 후 "종료 대기" 센티넬. 명령은 계속 처리하되
 *                   일반 값 발화는 handleFinal의 atEnd 가드가 종료 안내로 흡수.
 *  - 'reviewWait'   v0.33.0 백로그 A(민구 결정 3) — 완료 행 착지 "검토 대기" 센티넬. 값 낭독 후
 *                   대기, bare 값 발화는 흡수(덮어쓰기 금지 — 수정은 '수정' 명령으로만). 포인터는
 *                   그 행 첫 음성 필드(v0.34.0 A3 확정 규칙).
 *  - 'cellWait'     🔴 v0.49 fix49(리뷰 B-1 blocker) — **값이 든 셀에 항목 이동으로 착지**했을 때의
 *                   "셀 검토 대기". reviewWait의 **셀 단위 형태**다: 값을 낭독하고 명령을 기다리며,
 *                   bare 값 발화는 흡수한다.
 *
 *                   왜 별도 kind인가 — reviewWait을 재사용할 수 없다: 그쪽은 **행 상태**라
 *                   bare 값 발화를 「그 행은 끝났다」는 문구로 흡수하는데, 진행 중인 행의 한 칸에
 *                   서 있는 상태에 그 문구를 쓰면 사용자는 행이 끝난 줄 안다(V-FIX4 안내계약).
 *                   🔴 v0.49 r2 A13(codex F6) — 이 자리의 종전 근거 *"gotoAdjacentField가
 *                   reviewWait/atEnd에서 이동 자체를 거부하므로"* 는 **더 이상 사실이 아니다**:
 *                   W1(08-13 민구 결정)이 두 상태에서의 항목 이동을 허용했다. kind를 가른 판단
 *                   자체는 그대로 유효하고(문구·스코프가 다르다), 근거만 낡았다.
 */
/** 🔴 v0.49 r2 A2 — **셀 검토 대기(cellWait) 복귀 예약**. `resumeReview`(행)의 셀 축 짝이다.
 *  좌표를 실어 다니는 이유: 착지 지점에서 `enterCellWait`을 부르려면 그 전에 커서를 그 셀에
 *  세워야 하는데(`enterCellWait`은 `sess.activeRow`를 읽는다), 그 시점의 커서가 맞다는 보장을
 *  **우연**에 맡기지 않기 위해서다. */
type ResumeCell = { row: number; colId: string };

type AwaitingField =
  | (AwaitingBase & { kind: 'value'; fractionWhole?: string })
  | (AwaitingBase & { kind: 'modify'; previousValue?: string; fractionWhole?: string; resumeReview?: number; resumeCell?: ResumeCell })
  | (AwaitingBase & { kind: 'trendConfirm'; previousValue: string; fractionWhole?: string; resumeReview?: number; resumeCell?: ResumeCell })
  | (AwaitingBase & { kind: 'atEnd' })
  | (AwaitingBase & { kind: 'reviewWait' })
  | (AwaitingBase & { kind: 'cellWait'; previousValue: string });

/** 수정 의미론 보유 여부 — 종전 `awaiting.isModify`(trendConfirm은 isModify를 겸장했다). */
function isModifyLike(a: AwaitingField): boolean {
  return a.kind === 'modify' || a.kind === 'trendConfirm';
}

/** 종전 `awaiting.previousValue` 접근(모드 무관 optional 읽기 지점용). */
function previousValueOf(a: AwaitingField): string | undefined {
  return a.kind === 'modify' || a.kind === 'trendConfirm' ? a.previousValue : undefined;
}

/** 🔴 v0.47.0-r2 P1(FB-A) — 알람 해소 후 **검토 대기 재진입** 예약(그 행 번호).
 *  검토 대기(reviewWait) 중의 직접 수정("수정 88.9")이 이상치 알람을 띄운 경우에만 선다.
 *  왜 필요한가: 알람 해소 경로는 전부 `advance()`로 끝나는데, v0.33.0 항목2는 *"검토 대기 출신
 *  커밋은 advance로 검토를 강제 종료하지 않는다"* 를 계약으로 못박았다(enterModifyMode 직접값
 *  분기의 `enterReviewWait` 복귀가 그 이행이다). 알람이 중간에 끼면 그 복귀 지점이 사라지므로
 *  대기 상태가 착지처를 들고 다닌다. **다른 경로는 이 필드를 세우지 않는다** — 세우지 않으면
 *  값이 undefined라 모든 기존 흐름이 종전대로 `advance()`로 간다(무해한 추가).
 *  `demoteTrendConfirm`('수정' 등 타 명령으로 강등)도 이 예약을 **보존**한다 — 강등 뒤 재커밋의
 *  착지 역시 검토 대기여야 한다. */
function resumeReviewOf(a: AwaitingField): number | undefined {
  return a.kind === 'modify' || a.kind === 'trendConfirm' ? a.resumeReview : undefined;
}

/** 🔴 v0.49 r2 A2(codex F1 = 합집합 C3) — 알람/재기록 뒤 **셀 검토 대기 재진입** 예약.
 *  `resumeReviewOf`와 같은 계약의 셀 축이다. 가드레일 [NAV-FILLED-CELL-1]은 *"cellWait에서의
 *  모든 탈출은 cellWait 재진입"* 을 불변식으로 못박았는데, 두 경로가 그 예약을 들고 다니지
 *  못해 새고 있었다: ⓐ bare '수정' 후 재기록(`announceField`가 modify로 재무장하며 출신을
 *  잃는다) ⓑ 그 상태에서 뜬 이상치 알람의 '확인'. 둘 다 종단에서 `advance()`로 빠져 사용자가
 *  **의도적으로 이동해 들어온** 검토 문맥이 증발했다.
 *  ⚠️ `resumeReview`와 동시에 서지 않는다 — 출신은 행(reviewWait) 아니면 셀(cellWait) 하나다. */
function resumeCellOf(a: AwaitingField): ResumeCell | undefined {
  return a.kind === 'modify' || a.kind === 'trendConfirm' ? a.resumeCell : undefined;
}

/** 종전 `awaiting.fractionWhole` 접근(모드 무관 optional 읽기 지점용). 추세확인 중 소수부 유실
 *  재질문(trendConfirm+fractionWhole)도 실측 도달 조합이라 포함한다. */
function fractionWholeOf(a: AwaitingField): string | undefined {
  return a.kind === 'value' || a.kind === 'modify' || a.kind === 'trendConfirm'
    ? a.fractionWhole
    : undefined;
}

/** trendConfirm → modify 강등(알림 해제, 수정 의미론 유지 — 종전 `trendConfirm=false` 변이와 동등).
 *  **fractionWhole을 반드시 보존한다** — 소수부 재질문 중 강등되면 정수부 문맥('111')이 유실돼
 *  다음 소수부 발화가 전체값으로 오커밋되던 회귀(v0.35.3 리뷰 r1, 3모델 공통 Critical/High).
 *  v0.47.0-r2 P1 — `resumeReview`(검토 대기 착지 예약)도 같은 이유로 보존한다.
 *  v0.49 r2 A2 — `resumeCell`(셀 검토 대기 착지 예약)도 같다. ⚠️ 이 시그니처는 trendConfirm
 *  모양을 **인라인으로** 적어 놨다 — 위 union만 넓히고 여기를 빠뜨리면 TS가 새 필드를 조용히
 *  떨어뜨린다(강등 경로에서만 복귀가 사라지는, 오라클 없으면 안 보이는 결함). */
function demoteTrendConfirm(a: AwaitingBase & { kind: 'trendConfirm'; previousValue: string; fractionWhole?: string; resumeReview?: number; resumeCell?: ResumeCell }): AwaitingField {
  return {
    kind: 'modify', row: a.row, colId: a.colId, name: a.name,
    previousValue: a.previousValue, fractionWhole: a.fractionWhole,
    ...(a.resumeReview != null ? { resumeReview: a.resumeReview } : {}),
    ...(a.resumeCell != null ? { resumeCell: a.resumeCell } : {}),
  };
}

/** 🔴 v0.47.0-r2 P2(FB-C) — 수동입력 이상치 보류 중 **음성이 차단됐을 때** 나가는 안내 문구.
 *
 *  ⚠️ **명령 어휘를 문구에 넣지 마라.** detectCommand는 공백을 지우고 `startsWith`로 맞추므로,
 *  이 발화가 재인식되면 문장이 **명령으로 실행된다.** 특히 `screenOff`의 word는 `'화면'`이라
 *  초안의 *"화면의 버튼을 눌러 주세요"* 는 검은 화면을 켤 수 있었다(실제로 위험한 조합 —
 *  민구는 화면이 꺼지면 「갇혔다」고 읽는다). 같은 이유로 「확인」·「수정」·「다음」·「이전」·
 *  「유지」·「종료」·「취소」도 금지다.
 *  현재 문구의 어절은 전량 대조했다 — 명령 16개 중 어느 것으로도 시작하지 않는다
 *  (검증 명령: `grep -n "word: '" src/lib/voiceCommands.ts`).
 *  「표시된 버튼」이라 부르는 이유: 민구는 폰을 2~3m 떨어뜨려 두므로(PRINCIPLES §2) *"가서
 *  화면을 봐야 한다"* 가 이 안내의 실질 내용이다. 버튼 이름을 말해 줘도 음성으로는 못 누른다. */
const MANUAL_HOLD_GUIDE_TTS = '알림은 터치로만 응답할 수 있습니다. 표시된 버튼을 눌러 주세요.';

/** v0.9.0 빠른 인식(조기확정): interim 숫자가 이 시간(ms) 동안 같은 값으로 안정되면 final을
 *  기다리지 않고 커밋한다. 짧을수록 빠르지만 미완성 숫자(소수점 추가 전) 절단 위험이 커진다. */
const EARLY_COMMIT_STABLE_MS = 400;

/** 빈/극소 클립 판정 임계(바이트) — webm/opus 컨테이너 헤더만 담긴 캡처가 이 이하로 온다.
 *  이하이면 저장하지 않고 clip_empty/clip_cmd_empty로 계측한다([CLIP-POINTER-1] 가드, 구 [CLIP-3]). */
/** pause()가 recorder dispose 전에 in-flight 클립 저장을 기다리는 상한(ms). 경로별 유예는
 *  의도적 차등 — stop() 5초(세션 종료, 최대 보존), 아카이브 flush 1.5초(백그라운드, UX 무영향). */
const PAUSE_FLUSH_GRACE_MS = 3000;

/** v0.44.0 §C8 F18(민구 확정 08-02) — 마이크 **승인 후 화면 전환까지의 정착 지연**(ms).
 *  민구 원문: "바로 음성 입력 화면 전환시 일부 초기 음성 클립 생성이 안됨" — 스트림이 실제로
 *  데이터를 흘리기 전에 세션이 시작되면 첫 클립이 비는 문제의 방어다(구 v0.25.0 WS-2 prewarm의
 *  첫 클립 유실 완화를 이 지연이 승계한다). 오라클: tests/v0440-c8-flow.spec.ts(1000ms 계약). */
const MIC_SETTLE_MS = 1000;
/** 🔴 v0.46.1 WP-1c(민구 지시 08-07) — 시작 준비 **단계 수**(진행바 분모).
 *  ①소리 출력 열기 ②마이크 권한·획득 ③음성 안내 확인 ④마이크 안정화.
 *  🔑 **고정 대기가 아니다** — 각 단계가 실제 확인이고, 빨리 끝나면 빨리 넘어간다.
 *  민구: *"3초뒤 화면 전환이 아닌, … 실제 마이크/스피커 입출력이 가능한지 확인하고."* */
const START_STEPS = 4;

/** v0.43.0 #4 — 백그라운드 복귀 안내 문구(plan §3-3, 민구 확정).
 *
 *  🔴 **중지 안내와 복귀 안내가 한 문장으로 합쳐져 있다.** iOS는 백그라운드 TTS를 막으므로
 *  `hidden` 진입 순간의 `say()`는 소리가 안 나거나 큐에 쌓였다가 복귀 때 터진다 — 실질적으로
 *  둘 다 복귀 시점에만 나갈 수 있다. 그래서 "중지됐다 + 다시 시작한다"를 한 번에 말한다. */
const BG_RESUME_MESSAGE = '자리를 비운 동안 입력이 중지됐습니다. 다시 시작합니다.';

/** #4 — **정확히 한 번만** 발화하는 `onStart` 핸들러를 만든다.
 *
 *  `SpeechController`의 `onStart`는 인식기 **인스턴스마다** 온다 — 워치독 재시작·EOS 후
 *  자동 재시작에서도 발화하므로(speech.ts가 매 `start` 이벤트에 건다), 클로저 안의 once
 *  가드가 없으면 백그라운드 복귀 뒤 **재시작할 때마다** 같은 안내를 반복한다.
 *
 *  v0.45.0 WP-3 (F14) — 안내 뒤에 **복귀 브리핑**(현재 행 요약 + 다음 항목)을 잇는다.
 *  브리핑 텍스트는 발화 **시점**에 만든다(getBriefing 클로저) — 복원 예약 시점의 낡은 행
 *  좌표를 읽지 않게. 안내는 "재개 성공"(onStart)에만 건다는 계약([MIC-B2])은 그대로다. */
function bgResumeAnnouncerOnce(
  // v0.48.1 U2 — say()가 Promise<boolean>을 돌려주도록 넓어졌다(started 신호). 이 자리는 반환값을
  // 안 쓰므로 시그니처만 맞춘다.
  say: (text: string, interrupt?: boolean) => Promise<boolean>,
  getBriefing: () => string | null,
): () => void {
  let announced = false;
  return () => {
    if (announced) return;
    announced = true;
    void say(BG_RESUME_MESSAGE, false)
      .then(() => {
        const briefing = getBriefing();
        if (briefing) void say(briefing, false);
      })
      .catch(() => {});
  };
}

export type VoiceTrackState = AudioTrackState | 'unknown';

export interface VoiceRuntimeSnapshot {
  rec: 'none' | 'idle' | 'recording';
  track: VoiceTrackState;
  stt: 'none' | 'idle' | 'listening' | 'suspended';
}

export function useVoiceSession() {
  const ctrlRef = useRef<SpeechController | null>(null);
  // F18 — start()의 마이크 획득+정착 대기 중 재클릭 가드. 그 창에서는 phase가 아직 'ready'라
  // '음성 입력 시작' 버튼이 살아 있어, 가드 없이는 start()가 이중 진입한다(세션 이중 생성).
  const startingRef = useRef(false);
  // 🔴 F18 리뷰 B1(v0.44.0 독립 리뷰, 실측 재현) — start()의 await 창(권한 프롬프트 무한 +
  // 정착 1초)에서 탭을 이탈하면 VoiceScreen이 언마운트되는데, 고아가 된 이 클로저가 계속
  // 실행돼 세션을 올리고 인식기·레코더를 **고아 인스턴스의 ref**에 만든다 — 리마운트된 새
  // 훅은 ctrlRef가 null이라 종료를 눌러도 abort가 0회(마이크·인식기 영구 생존). await 뒤에
  // 이 플래그를 재확인해 언마운트됐으면 중단한다. StrictMode의 모의 재마운트에서 ref가
  // 유지되므로 mount 시 false로 되돌리는 형태가 필수다.
  const disposedRef = useRef(false);
  useEffect(() => {
    disposedRef.current = false;
    return () => { disposedRef.current = true; };
  }, []);
  const sessionIdRef = useRef<string>('');
  const sessionLabelRef = useRef<string | undefined>(undefined);
  // 설정탭은 활성 세션 중에도 바뀔 수 있다. 목적지와 컬럼은 start()에서 함께 고정해 한 세션의
  // 자동값·음성값·sheetRow가 서로 다른 농가 설정과 섞이지 않게 한다.
  const sessionTargetRef = useRef<SessionTarget | null>(null);
  const sessionColumnsRef = useRef<Column[] | null>(null);
  const [sessionColumns, setSessionColumns] = useState<Column[] | null>(null);
  const awaitingFieldRef = useRef<AwaitingField | null>(null);
  const epochRef = useRef(0);
  // 🔴 v0.48.1 r3 U1 4절 — interim barge-in이 일어난 시점의 epoch를 기록한다. speech.ts:353는
  //   TTS가 뮤트 중일 때 비어있지 않은 interim만 오면 즉시 cancel()하지만, epochRef는 건드리지
  //   않는다(final에서만 bump) — 그래서 알람 2차 발화 가드의 「epoch 불변」 절이 이 경로를 못
  //   잡는다(review-claude.md F1). `await say(alertText)` 뒤 isTtsMuted()를 다시 읽는 처방ⓐ
  //   원안은 채택하지 않았다 — done()이 resolve 직전에 무조건 unmuteForTts()부터 돌려서
  //   barge-in 여부와 무관하게 항상 false로 읽힌다(코드로 반증: speech.ts의 done() 참조).
  //   대신 barge-in이 실제 발생하는 이 시점(=아직 뮤트 중인데 interim이 들어온 순간)에서
  //   epoch 스냅샷을 남겨, 가드가 "이 alertText 재생 도중 barge-in이 있었는가"를 물을 수 있게 한다.
  const bargeInEpochRef = useRef(-1);
  const lastConfidenceRef = useRef<number>(1);
  // v0.9.0 딜레이 계측 — 마지막 interim(중간) 결과의 텍스트·도착시각. final 시 (final.ts − 이 시각)
  // = EOS 꼬리(브라우저 무음 종료감지 대기)를 정량화한다(stt_eos_tail).
  // §5-1 ②(v0.44.0) — confidence(엔진이 interim에 점수를 준 경우만) 추가: 빈 final barge-in의
  // stt_barge_in text/confidence 폴백 근거. 신규 필드는 optional — 기존 소비자(EOS 꼬리) 불변.
  const lastInterimRef = useRef<{ text: string; at: number; confidence?: number } | null>(null);
  // v0.9.0 빠른 인식(조기확정) — 같은 파싱값이 interim에서 안정되기 시작한 시각. 임계 시간 유지 시 커밋.
  const earlyCommitStableRef = useRef<{ value: string; since: number } | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const clipStartRowRef = useRef<number>(0);
  const clipStartColIdRef = useRef<string>('');
  // Codex MEDIUM-4: tracks the field whose recording clip is CURRENTLY active (set only after
  // startClip() actually runs at the end of announceField, cleared at commit-time stopClip).
  // Used to gate redo-inline ("다시 8.4") so it cannot commit before its clip has started
  // (i.e. while announceField's TTS prompt is still playing) — which would otherwise stop a
  // non-existent clip or let a cancelled announceField start an obsolete clip.
  const activeClipRef = useRef<{ row: number; colId: string } | null>(null);
  // [CLIP-WINDOW-1] UI suspend가 끊은 셀. 모달 전 조각은 저장하지 않고, 모든 중첩 UI가 닫힌 뒤
  // 여전히 같은 셀의 값을 기다릴 때만 새 녹음창을 연다(모달 대기 구간 splice/보존 금지).
  const uiSuspendedClipRef = useRef<{ row: number; colId: string } | null>(null);
  // [CLIP-WINDOW-2] suspend 중 arm 요청의 단일 보류 슬롯. 가장 최근 요청이 이전 활성 슬롯보다
  // 현재 awaiting에 가까운 의도이므로 resume에서 우선 소비하고, 세션 경계 clear에서는 폐기한다.
  const uiBlockedClipArmRef = useRef<{ row: number; colId: string } | null>(null);
  // rowIndex → colId → IDB key; accumulated in-memory until persistSession writes to dataStore
  const pendingClipsRef = useRef<Record<number, Record<string, string>>>({});
  // Snapshot of a persisted row being cascade-corrected; included in persistSession if stop()
  // fires before re-completion so original measurements are not lost.
  const correctionBackupRef = useRef<SessionRow | null>(null);
  // [CLIP-VAL-1]③ / [CLIP-POINTER-1] unlink race: tombstones for clip keys whose capture FAILED
  // (clip_empty / clip_too_small / clip_save_failed). persistSession builds its rows
  // synchronously BEFORE its first await, so an in-flight persist could re-persist a pointer
  // that unlinkClipPointer just removed (06-11 v0.6.0 row8 c7 — pointer resurrected in the
  // harvested sessions.json). Every audioClips merge consults this set, and persistSession
  // re-checks it AFTER its await, so a tombstoned key can never be re-persisted. A key is
  // cleared only when a NEW clip is successfully saved under it. Reset in start().
  const brokenClipKeysRef = useRef<Set<string>>(new Set());
  // v0.24.0 데이터-3 방어 — persistSession 단조 가드. 값 커밋마다 fire-and-forget persist가 겹쳐 돌 때,
  // 더 일찍 시작된(=옛 값) 호출이 더 늦게 시작된(=새 값) 호출의 dataStore upsert를 last-writer-wins로
  // 덮어쓰면 이상치 교정값이 옛값으로 되돌아간다. 호출마다 단조 증가 seq를 받아, durable 반영 직전에
  // 더 큰 seq가 이미 반영됐으면 스킵한다. (data-3은 06-29 로그에서 미재현 — 방어+가시화.)
  const persistSeqRef = useRef(0);
  const persistAppliedSeqRef = useRef(0);
  // v0.7.0 B4: trend_skip 원인별 1회 로깅(세션당) — 같은 원인(no_index 등)이 셀마다 반복
  // 로깅돼 텔레메트리를 도배하지 않게 한다. start()에서 리셋.
  const trendSkipLoggedRef = useRef<Set<string>>(new Set());
  // v0.47.0-r2 P2(FB-C) — 홀드 안내 TTS를 이미 낸 알람의 식별키. **알람 1건당 1회**의 저장소다
  //   (재안내 없음 · 알람이 바뀌면 리셋). clearAnomalyAlert가 null로 되돌린다.
  const holdGuideKeyRef = useRef<string | null>(null);
  // 세션 시작 시점의 로컬 오늘 ISO — evaluateTrend가 값 커밋마다 Date를 새로 만들지 않게
  // start()에서 1회 계산(현장 세션은 자정을 의미 있게 넘기지 않는다).
  const sessionTodayRef = useRef<string>('');
  // Ref to resume() — breaks the circular dependency between handleFinal and resume.
  // v0.20.0 Phase 5 #3 — resume이 해제 방식(source)을 받도록 시그니처 확장.
  const resumeRef = useRef<(source?: 'voice' | 'touch') => Promise<void>>(async () => {});
  // UI modal hard-suspend. This is deliberately narrower than pause(): it stops STT delivery
  // while a full-screen UI modal is open, but it does not change session phase or recorder state.
  // v0.37.0 리뷰(3모델 공통, 민구 인가) — **소스 집합(reference-count) 래치**. 종전 단일 boolean
  //   래치는 두 suspend 소스(예: 수동 시트 + 개선요청 모달)가 겹칠 때, 하나만 닫혀도 래치가 풀려
  //   나머지 오버레이 뒤에서 STT가 조기 재개됐다(데이터무결성). 이제 **모든 소스가 해제될 때만**
  //   실제 재개한다. active 여부는 reasons.size>0로 파생(별도 boolean 없음).
  // 🔴 v0.43.0 1c([TEST-CLIP-F-1] 판정) — **hadController의 의미가 넓어졌다.**
  //   종전: *"첫 suspend 시점에 인식기가 있었나"* (순수 스냅샷).
  //   현재: *"마지막 소스가 해제될 때 인식기를 복원해야 하나"* (복원 의무 플래그).
  //   첫 suspend 스냅샷이 기본값이지만, suspend가 걸린 동안 start()가 인식기를 만들려다
  //   :2541 가드에 막히면 **그 사실을 여기 true로 남긴다** — 그래야 resume이 복원한다.
  //   생존 범위는 종전과 동일: reasons가 비는 두 경로(resumeRecognitionForUi / clearUiSuspendLatch)가
  //   모두 false로 되돌리므로 세션 밖으로 새지 않는다.
  const uiSuspendRef = useRef<{ hadController: boolean; reasons: Set<string> }>({
    hadController: false,
    reasons: new Set<string>(),
  });
  /** v0.43.0 #4 — 백그라운드 복귀 안내가 **예약돼 있는가**(원샷).
   *  `suspendForBackground`가 **실제로 중지했을 때만** 세우고, `resumeRecognitionForUi`가 첫
   *  전이에서 소비한다. 이 플래그가 없으면 resume의 컨트롤러 생성부를 공유하는 다른 소스
   *  (`feedback_modal`·`manual_input`·`command_help`·`exit_confirm`)에서도 안내가 나간다. */
  const bgAnnouncePendingRef = useRef(false);
  /** v0.45.0 WP-2 [D1] — 세션-활성 게이트가 hidden에 유지한 사이클의 생존 관측(WP-1④ bg_keep).
   *  hidden 진입(유지 선택) 시 세우고, 복귀 또는 임계 도달에서 요약 1건으로 소비한다. */
  const bgKeepRef = useRef<{ hiddenAt: number; finals: number } | null>(null);
  /** WP-2 — 장기 임계(10분) 타이머. hidden(유지) 진입에 무장, 복귀·세션 종료·발화 시 해제.
   *  iOS가 페이지를 얼리면 안 울릴 수 있다 — 그 경우 복귀 경로의 경과시간 검사가 받는다. */
  const bgOffTimerRef = useRef<number | null>(null);
  /** 🔴 v0.45.0 리뷰 C1(critical) — 임계 정지 시퀀스의 **세대 가드.** applyBackgroundOff의 await
   *  사슬(고지 TTS 최대 10초 워치독 + 알림 + flush 3초 + persist) 도중 사용자가 복귀하면 —
   *  기기 알림 문구가 정확히 그 복귀를 유도한다 — 잔여 continuation이 **포그라운드 활성 세션**에서
   *  STT를 정지하고 레코더를 dispose했다(조용한 입력 사망, 경보 전무). 복귀·세션 경계마다 세대를
   *  올리고, 시퀀스는 파괴적 단계 직전마다 세대·가시성을 재검사해 어긋나면 중단한다. */
  const bgOffGenRef = useRef(0);
  // v0.22.0 P0 — 클립 레코더 스트림이 실제로 죽었을 때만 true. v0.38.0 #5는 이 전이에서 기존
  // reconnectMic→recoverStream 경로를 자동으로 딱 1회 호출하고, 실패했을 때만 수동 배너를 노출한다.
  const [micLost, setMicLost] = useState(false);
  const [micReconnectFallbackVisible, setMicReconnectFallbackVisible] = useState(false);
  const micAutoReconnectAttemptedRef = useRef(false);
  const micReconnectInFlightRef = useRef<Promise<boolean> | null>(null);
  // v0.38.0 #4-③ — 파서/세션 액션을 UI 세부 구현과 결합하지 않고, 최종 명령 1건을 표현 계층에
  // 단조 seq로 전달한다. ActiveState/Steppers가 각자 담당 버튼과 동일 콜백을 정확히 1회 실행한다.
  const uiCommandSeqRef = useRef(0);
  const [uiCommand, setUiCommand] = useState<VoiceUiCommandSignal | null>(null);
  // clip_empty 자동 재시도 once 가드(세션당). 스트림이 죽어 micLost로 전환되면 더 이상 자동
  // recoverStream을 부르지 않는다(제스처 밖이라 어차피 실패). start()에서 리셋.
  const micLostLatchedRef = useRef(false);
  /** React state가 아닌 순수 정책 상태 — 복귀 이벤트가 phase와 무관하게 hiddenAt을 소비한다. */
  const foregroundReturnRef = useRef<ForegroundReturnState>(INITIAL_FOREGROUND_RETURN_STATE);

  // ── helpers ────────────────────────────────────────────────
  const getTtsRate = () => useSettingsStore.getState().ttsRate || 1.05;
  const getSessionColumns = (): Column[] =>
    sessionColumnsRef.current ?? useSettingsStore.getState().columns;
  /** v0.35.3 Stage 3-4 — 세션 컨텍스트 로거. 이 훅의 모든 계측은 현재 세션 id를 동봉하므로
   *  sessionId 고정 인자를 여기서 1회 주입한다. 나머지 필드(extra 문자열 포함)는 호출부 그대로
   *  전개 — SOP-003 파서 계약 불변. */
  const logCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>): void => {
    logger.log({ sessionId: sessionIdRef.current, ...entry } as Parameters<typeof logger.log>[0]);
  };
  const clearAnomalyAlert = useCallback((reason: string) => {
    const sess = useSessionStore.getState();
    const alert = sess.anomalyAlert;
    if (!alert) return;
    // 신규 음성 알람은 아래 발화 지점에서 colId를 직접 싣고, 수동 알람도 이미 colId를 가진다.
    // 그래도 공통 코어/구버전 형태처럼 optional인 객체를 받을 수 있으므로, 알람을 해제하기 **전**
    // 아직 같은 셀을 가리키는 awaiting(row+name 일치)을 신뢰 가능한 1차 폴백으로 쓴다.
    // awaiting이 이미 바뀐 방어 상황에서는 세션 컬럼의 이름 역인덱스로 마지막 폴백한다.
    const awaiting = awaitingFieldRef.current;
    const colId = alert.colId
      ?? (
        awaiting?.row === alert.row && awaiting.name === alert.colName
          ? awaiting.colId
          : undefined
      )
      ?? getSessionColumns().find((col) => col.name === alert.colName)?.id;
    logCell({
      type: 'trend',
      extra: anomalyAlertCleared({
        reason,
        hadStatus: alert.status ?? 'pending',
      }),
      row: alert.row,
      ...(colId ? { colId } : {}),
    });
    sess.setAnomalyAlert(null);
    // v0.47.0-r2 P2 — 알람이 내려갔으니 홀드 안내 1회 제한도 푼다(다음 알람은 다시 안내받는다).
    holdGuideKeyRef.current = null;
  }, []);
  // v0.48.1 U2(리뷰 codex medium) — 반환값을 `Promise<boolean>`으로 넓혔다(기존 호출부 전부
  // `await say(...)`로 반환값을 무시하므로 하위호환). `started`는 `speak()`의 `onStart`가 실제로
  // 불렸는지(watchdog(`speech.ts:646`)이 onstart조차 못 받고 2.5초 뒤 대신 resolve했으면 false)다.
  // P4의 두 번째 발화(:1298/:2562 부근) 직전 이 값을 확인해, **1차 발화가 시작도 못 한 경우** 2차를
  // 생략한다 — 원래 watchdog 2.5초 피해가 두 발화 직렬이라 5초로 배증하던 것(U2)을 막는다.
  // ⚠️ **부분 커버리지다.** onstart는 왔는데 onend/onerror가 안 와서 watchdog이 구제한 경우
  // (`started`=true)까지는 못 잡는다 — `speak()`가 그 두 실패 모드를 구분해 반환하려면 반환값
  // 자체를 enum으로 바꿔야 하고, 그건 `speech.ts` 계약 변경(이번 라운드 범위 밖, union U2 처방
  // "speech.ts 대수술은 범위 밖"). 잔여 축(started-but-no-onend)은 실기기 관측 항목으로 남긴다.
  // TODO(v0.49, review-codex.md 미해소2) — `started` 하나로는 못 가르는 잔여 두 갈래가 남는다:
  //   (a) onstart 후 onend/onerror 둘 다 소실 → 1차도 watchdog 2.5s를 다 쓰고 `started=true`로
  //       빠져나와 2차도 자기 watchdog을 또 써 총 ~5s(U2가 막은 건 "1차가 onstart조차 못 받은"
  //       경우뿐). (b) onstart 후 onerror(실패) → `started=true`라 "성공"처럼 보여 불필요한
  //       2차 발화를 시도한다. 둘 다 `speak()`가 `spoken | error | watchdog-unstarted |
  //       watchdog-started` 같은 완료 상태를 반환해야 풀린다 — `Promise<boolean>` 계약 자체를
  //       enum으로 넓히는 `speech.ts` 변경이라 이번 r3(소수정) 범위 밖. v0.49 이월.
  //   (c) 같은 갈래의 파생 — codex 재검증 잔여 ③: P4 2차 발화(`인식값 ...`)의 `interrupt:true`
  //       cancel()+50ms 대기는 가드 재확인 없이 지나가는 창이라 `interrupt:false`로 없애는 안을
  //       검토했지만, (a)에서 `done()`이 watchdog으로 resolve될 때 `synth.cancel()`을 호출하지
  //       않는다(`speech.ts` `done()` 참조) — 즉 (a)가 벌어진 채 여기 도달하면 1차 utterance가
  //       여전히 살아있을 수 있고, 그 상태의 `interrupt:false`는 2차를 큐잉시켜 뮤트 구간을
  //       늘린다(C-FIX4가 기각한 "큐잉이 뮤트 해제 창을 연다" 부류, WP-1이 줄이려던 마비와 동종).
  //       (a)/(b)와 같은 완료상태 enum이 있어야 "1차가 정상 종료했다"를 안전하게 전제할 수
  //       있으므로 별도로 풀지 않고 여기 합류시킨다 — 그때까지 두 발화 모두 `interrupt:true` 유지.
  const say = useCallback(async (text: string, interrupt = true): Promise<boolean> => {
    if (!text) return false;
    const ttsStart = Date.now();
    let startDelayMs: number | null = null;
    await speak(text, {
      interrupt,
      rate: getTtsRate(),
      onStart: (d) => { startDelayMs = d; },
    });
    logCell({
      type: 'tts',
      ttsText: text,
      durationMs: Date.now() - ttsStart,
      startDelayMs,
      row: useSessionStore.getState().activeRow,
    });
    return startDelayMs !== null;
  }, []);

  const getColById = (id: string): Column | null =>
    getSessionColumns().find((c) => c.id === id) || null;

  const voiceColsList = (): Column[] =>
    getSessionColumns().filter((c) => c.input === 'voice');

  /** v0.34.0 리뷰(민구 결정 2026-07-14 = 수동입력 이상치 보류는 **터치 [확인]/[수정] 전용**) —
   *  manualHold 팝업이 떠 있는 동안 **보류를 해소하지 않는 모든 동작을 중앙에서 거부**하는 단일
   *  게이트(SSOT). 라운드1에선 STT만 막았는데 터치 [이전]/[다음]/[일시정지]가 그대로 열려 있어
   *  미확인 이상치를 우회할 수 있었다(Codex 라운드2 High: announceField/PausedCard가 알람을 지워
   *  검증 절차 자체가 소멸). 해소 경로는 confirmManualAnomaly/modifyManualAnomaly 둘뿐이다.
   *  `reason`은 무엇이 막혔는지 다음 로그 분석에서 보이게 한다(막힌 시도가 잦으면 UX 재고 신호).
   *
   *  🔴 v0.47.0-r2 P2(FB-C · 민구 실기기 08-09) — **차단은 유지하되 「들리게」 한다.**
   *  위 주석이 예고한 *"막힌 시도가 잦으면 UX 재고 신호"* 가 실제로 왔다: 08-09 홀드 중 민구가
   *  「확인」×6·「100」×3·「일시 정지」×3을 말했고 **12건 전부 무음 차단**됐다. 07-14 결정
   *  (터치 전용)은 옳았지만 그 대가가 «앱이 죽은 것처럼 보이는» 상태였다 — 민구는 TTS 고장으로
   *  읽었다. 결정은 **뒤집지 않고**(민구 확정 08-09) 차단 사실만 발화한다.
   *
   *  ⚠️ `reason === 'stt'`로 좁힌다. 홀드 중 **음성** 명령은 handleFinal 선두의 STT 게이트에서
   *  먼저 잘리므로 `prev`/`next`/`pause` 차단은 사실상 **터치 전용**이다(실측 12건 전부 stt).
   *  터치까지 포함시키면 「알람 1건당 1회」라는 희소한 슬롯을 오탭이 먼저 소모해, 정작 말을 건
   *  사용자가 무음을 받는다. 👉 터치 차단은 여전히 무음이다 — 필요하면 별건으로 잡는다.
   *
   *  🔑 **1회 제한은 스팸 방지가 아니라 루프 차단이다.** speech.ts는 TTS 재생 중에도 final을
   *  handleFinal까지 올린다 — 이 안내 발화 자체가 재인식돼 다시 여기로 들어올 수 있다. 키가
   *  같으면 재발화하지 않으므로 그 지점에서 루프가 끊긴다. *"3번에 1번씩 안내"* 같은 완화는
   *  이 루프를 되연다 — 바꾸려면 재인식 축을 먼저 막아라. */
  const isManualHoldBlocked = (reason: string): boolean => {
    const alert = useSessionStore.getState().anomalyAlert;
    if (!alert?.manualHold) return false;
    logCell({
      type: 'command',
      extra: `blocked:manual_hold:${reason}`,
      row: useSessionStore.getState().activeRow,
    });
    if (reason === 'stt') {
      // 알람 식별키 — 같은 셀이라도 후보값이 바뀌면(=[수정] 후 재위반) 새 알람이라 재안내한다.
      const key = `${alert.row}:${alert.colId ?? alert.colName}:${alert.prev}->${alert.next}`;
      if (holdGuideKeyRef.current !== key) {
        holdGuideKeyRef.current = key;
        logCell({
          type: 'command',
          extra: manualHoldGuide('stt'),
          row: alert.row,
          ...(alert.colId ? { colId: alert.colId } : {}),
        });
        useSessionStore.getState().setLastTts(MANUAL_HOLD_GUIDE_TTS);
        // 게이트는 동기 함수다(터치 이동·일시정지도 같은 함수로 거부한다) — 발화는 비대기로
        //   띄운다. interrupt는 say의 기본값 그대로 true다: 사용자가 이미 말을 겹쳐 온 시점이라
        //   재생 중인 앞 발화를 자르는 편이 맞고, 큐잉(interrupt=false)은 앞 발화 종료가 뮤트를
        //   먼저 풀어 이 문장이 STT로 들어가는 경로를 연다(V-FIX1ⓒ가 홀드 안내에서 실측한 함정).
        void say(MANUAL_HOLD_GUIDE_TTS);
      }
    }
    return true;
  };

  // ── clip preservation ──────────────────────────────────────
  // [ENV-12] Stage 3 — 캡처 장부(재시도·명령 인덱스, in-flight 저장 집합)는 useClipCapture가
  // 소유한다. 세션 컨텍스트만 getter/callback으로 넘긴다(훅이 이 파일의 ref를 직접 보지 않게).
  const clipCapture = useClipCapture({
    getSessionId: () => sessionIdRef.current,
    getRecorder: () => recorderRef.current,
    logCell,
    onCommandClipDetached: () => { activeClipRef.current = null; },
  });
  const { archiveCellClip, preserveCommandClip } = clipCapture;

  const isRowVoiceComplete = (row: number, vCols: Column[]): boolean => {
    if (useSessionStore.getState().isRowComplete(row)) return true;
    const values = useSessionStore.getState().getRowValues(row);
    return vCols.every((c) => {
      const v = values[c.id];
      return v !== undefined && v !== '';
    });
  };

  const firstIncompleteColIdx = (row: number, vCols: Column[]): number => {
    const values = useSessionStore.getState().getRowValues(row);
    for (let i = 0; i < vCols.length; i++) {
      const v = values[vCols[i].id];
      if (v === undefined || v === '') return i;
    }
    return 0;
  };

  // v0.5.0 NAV-1: 단방향 진행 — wrap-around 2차 루프(위쪽 빈 행으로 되돌아가던 탐색) 제거.
  // 행 완료(advance)는 아래 방향으로만 전진하고, 건너뛴 행은 complete:false placeholder로 남아
  // 데이터탭(EditableCell 터치 편집)에서 채운다.
  // ⚠️ v0.44.0 §C8 F13 — '다음'(goNextRow)은 더 이상 이 탐색을 쓰지 않는다(항상 +1 이동).
  //   이 함수의 소비자는 advance()의 행 완료 자동 전진뿐이다.
  const findNextIncompleteRow = (start: number, total: number, vCols: Column[]): number | null => {
    for (let r = start; r <= total; r++) {
      if (!isRowVoiceComplete(r, vCols)) return r;
    }
    return null;
  };

  // ── persistence ────────────────────────────────────────────
  const persistSession = useCallback(async (
    pendingOverride?: Session['pendingValidation'] | null,
    publishPendingStage = false,
  ): Promise<boolean> => {
    // v0.24.0 데이터-3 — 이 호출의 단조 순번(호출 순서=스냅샷 신선도 순서, setRowValue가 호출 전 실행됨).
    const mySeq = ++persistSeqRef.current;
    const columns = getSessionColumns();
    const sess = useSessionStore.getState();
    const completed = [...sess.completedRows].sort((a, b) => a - b);
    // Check backup BEFORE early return: if cascade correction is in progress and the correcting row
    // was the only completed row, we still need to persist the backup snapshot.
    const backup = correctionBackupRef.current;
    // v0.4.4 증분 영속화: 진행 중(활성·미완료) 행도 부분값/클립이 있으면 저장 대상에 포함해, 행을 다
    // 채우기 전 새로고침/앱 업데이트로 입력이 유실되는 것을 막는다. (sync는 complete 행만 업로드.)
    const activeRow = sess.activeRow;
    const activeHasData =
      !completed.includes(activeRow) &&
      (Object.values(sess.getRowValues(activeRow) ?? {}).some((v) => v !== '') ||
        Object.keys(pendingClipsRef.current[activeRow] ?? {}).length > 0);
    // v0.5.0 NAV-1: '다음'으로 건너뛴 행도 complete:false placeholder로 영속화 — 자동/고정값은
    // 채워지고 음성 칸만 빈 채 데이터탭에 보여, 사용자가 터치로 채울 수 있다. (v0.6.0부터
    // sync가 placeholder도 공백 행으로 시트에 업로드해 sheetRow를 예약한다 — 행 단위 재동기화.)
    const skipped = sess.skippedRows.filter((r) => !completed.includes(r)).sort((a, b) => a - b);
    if (completed.length === 0 && !backup && !activeHasData && skipped.length === 0) return true;
    // F1: read the existing persisted session once so each row can preserve its sheetRow/syncState
    // (the same source we merge audioClips from). Without this, every persist after a sync wiped
    // row-level tracking → the next sync re-appended already-uploaded rows (duplicates).
    const existingSession = useDataStore.getState().sessions.find(
      (s) => s.id === sessionIdRef.current,
    );
    const buildRow = (r: number, complete: boolean): SessionRow => {
      const existingRow = existingSession?.rows.find((row) => row.index === r);
      // Merge stored clips (from previous persists) with newly recorded clips
      const mergedClips = {
        ...(existingRow?.audioClips ?? {}),
        ...(pendingClipsRef.current[r] ?? {}),
      };
      // [CLIP-VAL-1]③: tombstoned keys (failed captures) must never be persisted — without this
      // a persist whose existingRow predates an unlink would resurrect the broken pointer.
      for (const k of Object.keys(mergedClips)) {
        if (brokenClipKeysRef.current.has(mergedClips[k])) delete mergedClips[k];
      }
      // 🔴 v0.49 r5 Z3(claude #1) — **이미 기록된 행의 파생값은 다시 파생하지 않는다.**
      //   `composeRowValues`는 자동 컬럼을 **매 persist마다 재계산**한다. 사람이 넣은 값이 아니라
      //   스키마·시계에서 나오는 값이라, 재계산 결과가 기록 시점과 달라질 수 있다:
      //     · 날짜 컬럼 `'오늘'` — `autoValue`가 **호출 시각의 로컬 날짜**를 돌려준다. 자정을
      //       넘긴 세션(현장 새벽 작업·긴 세션)의 **모든 기존 행**이 다음 날짜로 다시 쓰인다.
      //     · 순환 컬럼 자릿수(`spanOf`) — 세션 중 스키마가 갈리면 전 행의 값이 밀린다.
      //       (실측: `sessionColumnsRef`가 세션 시작에 컬럼을 동결하고 VoiceScreen이 keep-alive라
      //        **현행 UI에서는 이 축이 도달 불가**다. 아래 방어는 두 축 공통의 기전을 막는다.)
      //   피해는 「기록 안 됨」이 아니라 **능동 덮어씀**이다: 아래 diff가 `synced`를 `dirty`로
      //   강등하면 다음 동기화가 그 행을 시트에서 **in-place UPDATE**한다 — 농가 의사결정에 쓰이는
      //   프로덕션 시트의 확정 행이, 사용자가 아무것도 안 했는데 조용히 다른 날짜로 바뀐다.
      //   👉 처방: 기존 행에 이미 있는 **자동(비-사용자입력) 컬럼 값은 그대로 승계**한다. 사람이
      //      넣는 컬럼(voice/touch)은 종전대로 라이브 스토어가 이긴다 — 강등 diff의 **본래 목적**
      //      (사용자 정정을 시트에 밀어넣기)은 손대지 않는다.
      //   ⚠️ 정상 경우엔 **완전 무해**다: seq·options 값은 행 인덱스에서 나오므로 재계산 결과가
      //      기존 값과 같다. 갈리는 것은 위 두 드리프트뿐이고, 그때 옳은 것은 **기록 시점 값**이다.
      //   ⚠️ 기존 행에 **없는** 키(스키마에 컬럼이 새로 생긴 경우)는 승계 대상이 아니다 — 새로
      //      계산한 값이 그대로 들어간다(빈 칸으로 굳지 않는다).
      //   오라클: tests/v049-r5-z3-auto-drift.spec.ts
      const fresh = composeRowValues(columns, r);
      const values = existingRow
        ? Object.fromEntries(Object.entries(fresh).map(([id, v]) => {
          const col = columns.find((c) => c.id === id);
          const kept = existingRow.values[id];
          return [id, col && !isUserInputColumn(col) && kept !== undefined ? kept : v];
        }))
        : fresh;
      // F1: preserve the row's sheetRow/syncState across re-persists. If a previously-synced row's
      // value changed in this persist, demote synced→dirty so the next sync UPDATEs it in place
      // (no duplicate append). Unchanged synced rows keep 'synced'.
      let sheetRow = existingRow?.sheetRow;
      let syncState = existingRow?.syncState;
      if (existingRow && syncState === 'synced') {
        const colIds = columns.map((c) => c.id);
        const changed = colIds.some((c) => (existingRow.values[c] ?? '') !== (values[c] ?? ''));
        if (changed) syncState = 'dirty';
      }
      return {
        index: r,
        values,
        complete,
        audioClips: Object.keys(mergedClips).length > 0 ? mergedClips : undefined,
        ...(sheetRow !== undefined ? { sheetRow } : {}),
        ...(syncState !== undefined ? { syncState } : {}),
      };
    };
    const rows: SessionRow[] = completed.map((r) => buildRow(r, true));
    // If stop() fires while a cascade correction is in progress (row not yet re-completed),
    // include the backup snapshot so original measurements survive the persist.
    if (backup && !completed.includes(backup.index)) {
      rows.push({ ...backup });
    }
    if (activeHasData && !rows.some((row) => row.index === activeRow)) {
      rows.push(buildRow(activeRow, false));
    }
    for (const r of skipped) {
      if (!rows.some((row) => row.index === r)) rows.push(buildRow(r, false));
    }
    rows.sort((a, b) => a.index - b.index);
    // D-2 (RACE-7): prefer the ref, but fall back to the store-persisted id/startedAt so a session
    // that lost its hook ref (unmount during pause) still persists with a valid id and a finite
    // startedAt instead of `id:''` + `startedAt:NaN`.
    const resolvedId = sessionIdRef.current || sess.sessionId;
    const resolvedStartedAt =
      sess.startedAt || parseInt(resolvedId.replace('sess_', ''), 10) || Date.now();
    const target = sessionTargetRef.current ?? existingSession?.target;
    const session: Session = {
      id: resolvedId,
      // v0.7.0: LOCAL date, not UTC — toISOString() stamped KST 00:00~08:59 sessions with
      // yesterday's date, so localTodayISO() 오늘-세션 매칭에서 그날 아침 세션이 사라졌다.
      // 코드베이스 지배 규약도 로컬(autoValue.ts 날짜 컬럼).
      date: localTodayISO(),
      label: sessionLabelRef.current || sess.sessionLabel,
      columns,
      ...(target ? { target } : {}),
      rows,
      completedRows: rows.filter((r) => r.complete).length,
      // F1: derive syncedRows from per-row syncState (recountSynced) instead of hardcoding 0,
      // which used to erase the uploaded-row count after every voice persist.
      syncedRows: recountSynced(rows),
      startedAt: resolvedStartedAt,
      finishedAt: Date.now(),
      // manualHold 중 lifecycle persist가 다시 돌더라도 보류 태그를 버리지 않는다. 태그 유실은
      // 후보 dirty 값이 확정값처럼 sync/export되는 것과 같으므로 기존 Session에서 그대로 승계한다.
      ...((pendingOverride === undefined ? existingSession?.pendingValidation : pendingOverride)
        ? { pendingValidation: (pendingOverride === undefined ? existingSession?.pendingValidation : pendingOverride)! }
        : {}),
    };
    if (publishPendingStage && session.pendingValidation) {
      // ManualValueSheet는 async onCommit을 await하지 않는다. 첫 await(IDB put) 전에 후보와 pending
      // 태그를 같은 메모리 스냅샷으로 공개해야 그 짧은 동안 Data sync/export가 후보를 확정값으로
      // 보지 않는다. persisting 플래그는 [확인]도 durable 완료 전 진행하지 못하게 한다.
      useDataStore.getState().upsertSession({ ...session, pendingValidationPersisting: true });
    }
    try {
      await saveSession(session);
    } catch (err) {
      // IDB 실패 뒤 dataStore만 갱신하면 UI/로그는 성공인데 재시작 후 값이 사라진다. 호출자에게
      // durable=false를 돌려주고 메모리 upsert도 하지 않아 두 저장소가 거짓으로 갈라지지 않게 한다.
      logger.log({
        type: 'error', extra: `session_persist_failed:${String((err as Error)?.message ?? err)}`,
        sessionId: session.id, row: activeRow,
      });
      return false;
    }
    // [CLIP-VAL-1]③ re-check AFTER the await, synchronously with the upsert: a clip_empty
    // unlink may have tombstoned a key while saveSession was in flight (this session's rows
    // were built synchronously before it). Without this re-strip the upsert below would
    // resurrect the unlinked pointer in dataStore ([CLIP-POINTER-1] race, 06-11 row8 c7). When
    // pendingClipsRef meanwhile re-pointed the cell to a healthy key (e.g. the cmd-clip
    // relink), substitute that instead of dropping the pointer. The strip, the upsert and
    // the creation of the compensating save share one synchronous block, so no tombstone can
    // be added in between; the compensating IDB save is created after the unlink's own save,
    // so the clean state lands last — and it is AWAITED before this function resolves, so a
    // page death right after persistSession cannot leave the broken pointer as the last
    // durably-persisted state.
    let finalSession = session;
    if (brokenClipKeysRef.current.size > 0) {
      let changed = false;
      const strippedRows = session.rows.map((r) => {
        if (!r.audioClips) return r;
        const next: Record<string, string> = {};
        let rowChanged = false;
        for (const [colId, key] of Object.entries(r.audioClips)) {
          if (!brokenClipKeysRef.current.has(key)) { next[colId] = key; continue; }
          rowChanged = true;
          const fresh = pendingClipsRef.current[r.index]?.[colId];
          if (fresh && !brokenClipKeysRef.current.has(fresh)) next[colId] = fresh;
        }
        if (!rowChanged) return r;
        changed = true;
        return { ...r, audioClips: Object.keys(next).length > 0 ? next : undefined };
      });
      if (changed) {
        finalSession = { ...session, rows: strippedRows };
      }
    }
    // v0.24.0 데이터-3 단조 가드 — await(saveSession) 뒤 시점. 이 사이 더 나중에 시작된(=새 값) persist가
    // 이미 dataStore에 반영됐다면(persistAppliedSeqRef가 더 큼), 옛 스냅샷으로 덮어쓰지 않는다.
    if (mySeq < persistAppliedSeqRef.current) {
      if (publishPendingStage) useDataStore.getState().upsertSession(session);
      return true;
    }
    persistAppliedSeqRef.current = mySeq;
    if (finalSession !== session) {
      try {
        await saveSession(finalSession);
      } catch (err) {
        logger.log({
          type: 'error', extra: `session_persist_compensation_failed:${String((err as Error)?.message ?? err)}`,
          sessionId: finalSession.id, row: activeRow,
        });
        return false;
      }
    }
    // 마지막으로 내구 저장된 형상만 메모리 store에 공개한다. 보상 save 실패 시 깨진 포인터 형상을
    // UI에 성공처럼 올렸다가 reload에서 되돌아가는 split-brain을 막는다.
    useDataStore.getState().upsertSession(finalSession);
    return true;
  }, []);

  // ── announcements ──────────────────────────────────────────
  /** Announce only auto+ttsAnnounce columns whose value differs between rows. */
  const announceRowDiff = useCallback(
    async (fromRow: number | null, toRow: number) => {
      const cols = getSessionColumns();
      const toAuto = buildCyclingValues(cols, toRow);
      const fromAuto = fromRow != null ? buildCyclingValues(cols, fromRow) : null;
      const parts: string[] = [];
      for (const c of cols) {
        if (c.input !== 'auto' || !c.ttsAnnounce) continue;
        const tv = toAuto[c.id] ?? '';
        const fv = fromAuto?.[c.id] ?? '';
        if (!tv) continue;
        if (fromAuto === null || fv !== tv) parts.push(`${c.name} ${tv}`);
      }
      if (parts.length) await say(parts.join(', ') + '.', false);
    },
    [say],
  );

  /** Announce row completion: only auto+ttsAnnounce columns that differ from the previous row. */
  const announceRowComplete = useCallback(
    async (row: number) => {
      const cols = getSessionColumns();
      const curAuto = buildCyclingValues(cols, row);
      const prevAuto = row > 1 ? buildCyclingValues(cols, row - 1) : null;
      const parts: string[] = [];
      for (const c of cols) {
        if (c.input !== 'auto' || !c.ttsAnnounce) continue;
        const cv = curAuto[c.id] ?? '';
        if (!cv) continue;
        if (prevAuto === null || (prevAuto[c.id] ?? '') !== cv) {
          parts.push(`${c.name} ${cv}`);
        }
      }
      if (parts.length) await say(parts.join(', ') + ' 완료.', false);
      else await say('완료.', false);
    },
    [say],
  );

  /** v0.45.0 WP-3 (F14, Q5 민구 확정) — 복귀·재시작 브리핑 텍스트.
   *  "입력행의 첫 컬럼부터 지금 입력해야 되는 항목까지"(민구 원문)를 **음성안내(ttsAnnounce)가
   *  켜진 항목만** 항목+값 순서로 읽는다: "나무 3, 과실 2, 횡경 45.1. 다음, 횡경."
   *
   *  - 표(테이블) 컬럼 순서 그대로, **현재 항목에서 멈춘다** — 그 뒤는 "다음" 꼬리가 담당.
   *  - `includeNextName` true(복귀 — 뒤에 announceField가 없다)면 "다음, <항목명>."으로 끝나고,
   *    false(재시작 — 곧바로 announceField가 "<항목명>."을 잇는다)면 "다음."으로 끝난다.
   *  - active 밖(paused·complete)에서는 null — 일시정지 복귀 브리핑은 '재시작' 시점이 담당한다
   *    (Q4-답 민구 확정 08-05: 이중 낭독 방지. PausedCard 상태 안내와의 충돌도 피한다).
   *  - 읽을 것이 없으면 null — 억지 발화로 STT 무장을 지연시키지 않는다(barge-in OFF에선
   *    낭독 길이만큼 인식이 죽는 창이다, speech.ts half-duplex 계약). */
  const buildReturnBriefing = useCallback((includeNextName: boolean): string | null => {
    const sess = useSessionStore.getState();
    if (sess.phase !== 'active') return null;
    // 리뷰 C3·C5·C11 — 모달 suspend 중(STT 정지)·알람 응답 대기 중에는 브리핑을 내지 않는다.
    // "다음, X"는 '지금 말하면 입력된다'는 신호인데 그 상태에선 거짓이거나(모달 — 발화 전량
    // 미커밋) 알람 응답 흐름과 충돌한다. 모든 발화 지점(onStart·kept 복귀·재시작)의 단일 관문.
    if (uiSuspendRef.current.reasons.size > 0) return null;
    if (sess.anomalyAlert) return null;
    const cols = getSessionColumns();
    if (cols.length === 0) return null;
    const row = sess.activeRow;
    const auto = buildCyclingValues(cols, row);
    const values = sess.getRowValues(row);
    const cur = voiceColsList()[sess.activeColIdx] ?? null;
    const parts: string[] = [];
    for (const c of cols) {
      if (cur && c.id === cur.id) break; // 현재 항목부터는 꼬리("다음, …")가 담당
      if (!c.ttsAnnounce) continue;
      const v = c.input === 'auto' ? auto[c.id] ?? '' : values[c.id] ?? '';
      if (v !== '') parts.push(`${c.name} ${c.input === 'auto' ? v : formatForTts(v)}`);
    }
    const tail = includeNextName ? (cur ? `다음, ${cur.name}.` : null) : '다음.';
    if (parts.length === 0) return includeNextName ? tail : null;
    return tail ? `${parts.join(', ')}. ${tail}` : `${parts.join(', ')}.`;
  }, []);

  /** [CLIP-VAL-1]① — start (or restart) the recording slot for a cell, with the full
   *  announceField choreography: mark the start refs, start the clip, and register it as the
   *  active clip. Called BEFORE the accompanying TTS so a barge-in utterance lands in the clip.
   *  Shared by announceField, the B4 trend-alert prompt, and the modify/cancel re-prompts —
   *  the latter two used to re-ask via say() WITHOUT restarting the slot, so the re-spoken
   *  value was deterministically never recorded (06-11 v0.6.0 row8: "155.5" → clip_empty). */
  const armClipForCell = useCallback((row: number, colId: string) => {
    const suspendReasons = uiSuspendRef.current.reasons;
    if (suspendReasons.size > 0) {
      uiBlockedClipArmRef.current = { row, colId };
      logCell({
        type: 'clip',
        extra: clipArmBlocked({
          reason: [...suspendReasons].join('+') || 'unknown',
          row,
          col: colId,
        }),
        row,
        colId,
      });
      return;
    }
    // 리뷰 C6 — 레코더가 없으면(임계 정지 직후 복귀·재획득 init 대기 창) activeClipRef를 세우지
    // 않는다. 세우면 커밋 시 stopClip이 "시작한 적 없는" 새 레코더에 걸려 clip_empty가 난다.
    // 좌표는 보류 슬롯에 남겨 재획득 완료(resumeFromBackground init.then)가 소비한다.
    if (!recorderRef.current) {
      uiBlockedClipArmRef.current = { row, colId };
      logCell({ type: 'clip', extra: clipArmBlocked({ reason: 'no_recorder', row, col: colId }), row, colId });
      return;
    }
    clipStartRowRef.current = row;
    clipStartColIdRef.current = colId;
    recorderRef.current.startClip();
    activeClipRef.current = { row, colId };
  }, []);

  /**
   * 🔴 v0.49 r5 Z2 — **착지 국면 전이의 단일 지점.**
   *
   * 「착지」 = 커서가 어딘가에 서서 다음 입력/명령을 기다리기 시작하는 순간이다. 이 앱에는 그런
   * 지점이 넷 있고(`announceField` · `enterCellWait` · `enterReviewWait` · `announceEndReached`),
   * 넷 다 같은 리셋 묶음을 수행한다: **알람 해제 · 거절 큐 해제 · 수정 표식 해제 · phase 전이.**
   * 종전엔 그 네 줄이 네 곳에 **손으로 복사**돼 있었고, 이번 라운드 회귀 3건이 전부 그 사본의
   * 누락이었다:
   *   · M4  — `announceField`만 `setReaskReason(null)`이 빠져, 거절당한 셀을 떠나도 큐가 남았다.
   *   · M8① — `announceField`가 phase를 안 열어, 행 경계 착지에서 거절 큐가 `completing` 게이트에
   *            먹혀 **비프만 남았다**.
   *   · M8② — `enterCellWait`도 같은 누락(헤더는 "phase는 active"라고 **선언만** 하고 있었다).
   * 사본을 늘리는 대신 소유자를 하나 만든다 — 다음 착지가 생겨도 빠뜨릴 자리가 없다.
   *
   * 🔴 **평탄화하지 않는다.** 네 착지는 실제로 다르고, 그 차이가 계약이다 — 그래서 전부 인자다:
   *   · `phase`  값을 여는 착지는 `'active'`, 검토/끝 도달은 `'complete'`.
   *   · `reason` `clearAnomalyAlert` 사유는 **로그에 실린다**(PRINCIPLES §4). 하드코딩하면 네
   *              착지가 로그에서 한 덩어리가 된다.
   *   · `modifyIndicator` `announceField`의 수정 재안내만 값이 있고 나머지는 전부 해제다.
   *   · `decimalReason` 🔴 **소수부 재질문 문맥은 지우는 게 아니라 다시 그린다.** 그건 지나간
   *              거절이 아니라 지금 살아 있는 대기 상태고(`awaiting`이 정수부를 들고 있다),
   *              화면만 비우면 M3가 닫은 「무고지 합성」이 재개 경로로 되살아난다(데이터 오염).
   *              큐 해제를 무조건으로 평탄화하면 M4 오라클은 통과하면서 이 축이 새로 열린다.
   *
   * 🔴 **가드 — 종료·일시정지는 착지를 이긴다**(codex R4-F2 · claude #2). fixr4의 M8이 phase를
   * **무조건** 쓰게 만들면서, 이전엔 잠겨 있던 두 국면이 뒤늦은 continuation에 덮이게 됐다:
   *   · `stopping`: `stop()`은 첫 await 전에 phase를 잠그고 TTS를 cancel한다. 그 cancel이 앞선
   *     `await say(...)`를 settle시키면 **낡은 행 이동 continuation이 재개된다.** v0.35의 「종료
   *     teardown 전체를 단일 비대화형 phase로 잠근다」 상호배타 계약이 거기서 깨졌다.
   *     ⚠️ **epoch 재확인으로는 못 닫는다** — `stop()`은 epoch를 올리지 않는다(:4179~ 확인).
   *     그래서 **착지 전체를 거절**한다(phase만 막으면 awaiting·클립이 recorder dispose와 경쟁한다).
   *     안전한 이유: 대화형 진입점은 전부 이미 `phase === 'stopping'`을 자기 앞에서 거른다
   *     (`goNextRow` · `gotoAdjacentRow` · `gotoAdjacentField` · `pause` · `resume`) — 여기 닿는
   *     것은 정의상 낡은 continuation뿐이다.
   *   · `paused`: **국면 전이만** 보류하고 문맥 재무장(awaiting·수정 표식)은 그대로 진행한다.
   *     착지 전체를 거절하면 `awaiting`이 null인 채로 남아, `resume`의 폴스루가
   *     `announceField(cur)`로 떨어져 **값 있는 셀에 `kind:'value'`가 다시 열린다**(_ASK-fix49 Q5의
   *     선행 파손을 새 경로로 재개방 — 실측 확인). 일시정지 해제는 `resume()`만의 소관이다.
   *
   * 🔴 **`endReached`는 phase와 한 쌍이다.** 가드를 phase 한 줄에만 걸면 짝의 반쪽이 그대로 나가
   * R4-F2와 **같은 형태**(쌍 중 한쪽만 배선)의 결함이 남는다. `setPhase`가 'complete' 이탈 시
   * `endReached`를 함께 내리므로(sessionStore 계약) 순서는 phase → endReached로 고정한다.
   *
   * @returns 착지를 계속해도 되면 `true`. `false`면 **호출부는 즉시 return한다** — awaiting 재무장·
   *          클립 arm·TTS 전부 하지 않는다.
   * 오라클: tests/v049-r5-z2-landing-guard.spec.ts
   */
  const armLanding = useCallback((opts: {
    /** `clearAnomalyAlert` 사유 = 로그 축. 착지마다 다르다. */
    reason: string;
    /** 값을 여는 착지는 'active', 검토/끝 도달 착지는 'complete'. */
    phase: 'active' | 'complete';
    /** 'complete' 착지만 명시한다(끝 도달=true · 행 검토=false). 미지정이면 setPhase가 정한다. */
    endReached?: boolean;
    /** 수정 재안내만 값이 있다. 미지정 = 해제. */
    modifyIndicator?: { name: string; colId: string } | null;
    /** 살아 있는 소수부 재질문의 정수부. 있으면 큐를 **다시 그린다**. */
    decimalReason?: string | null;
  }): boolean => {
    const sess = useSessionStore.getState();
    if (sess.phase === 'stopping') {
      // 새 이름으로 계측한다(PRINCIPLES §4) — 기존 착지 이벤트에 얹으면 「착지했다」와
      //   「착지를 거절했다」가 로그에서 같은 줄이 된다.
      logCell({ type: 'session', extra: `landing_refused:stopping:${opts.reason}` });
      return false;
    }
    clearAnomalyAlert(opts.reason);
    // 🔴 v0.49 r5 Z9(claude #10) — 소수 문맥을 **다시 그릴 때 사유를 잃지 않는다.**
    //   `setReaskReason(null)`이 사유와 정수부를 함께 지우므로(store 계약) 재기록 시 사유를
    //   안 넘기면 기본값 `'parse_failed'`로 굳는다 — 저신뢰로 거절된 소수 재질문이 재개
    //   (일시정지→재시작)만 거치면 화면 `data-reason`이 **사실과 다른 사유**로 바뀐다.
    //   M3가 `setDecimalReason(whole, reason)` 인자를 만든 이유가 그것인데 이 재기록만 안 쓰고
    //   있었다. 문구는 어느 사유든 소수 프롬프트로 같으므로(확정표 #3) 바뀌는 것은 사유뿐이다.
    const carriedReason = sess.reaskReason;
    sess.setReaskReason(null);
    if (opts.decimalReason != null) {
      sess.setDecimalReason(opts.decimalReason, carriedReason ?? undefined);
    }
    sess.setModifyIndicator(opts.modifyIndicator ?? null);
    // v0.47.0 W2(FB-C) — committed=false는 「재청취 국면 시작(amber)」 선언이다. 일반 안내(국면
    //   종료)도 같은 값이라 네 착지 전부 무조건 내린다.
    useModifyPhase.getState().setCommitted(false);
    if (sess.phase === 'paused') {
      logCell({ type: 'session', extra: `landing_phase_held:paused:${opts.reason}` });
      return true;
    }
    sess.setPhase(opts.phase);
    if (opts.endReached !== undefined) sess.setEndReached(opts.endReached);
    return true;
  }, [clearAnomalyAlert]);

  const announceField = useCallback(
    // v0.47.0 C-FIX1b — opts.fractionWhole: 재개(resume) 재안내가 소수부 재질문 문맥(정수부)을
    // 잃지 않고 재구성하기 위한 전달로. 값 추측 금지 계약(:113-120)의 합성 문맥이 여기서 끊기면
    // 재개 후 조각 발화("5")가 전체값으로 오커밋된다(데이터 오염).
    // v0.49 r2 A2 — opts.resumeCell: bare '수정'이 **셀 검토 대기(cellWait) 출신**임을 재기록
    // 대기 상태에 실어 보내는 전달로. 이게 없으면 재발화 커밋 종단이 출신을 알 수 없어
    // `advance()`로 빠진다([NAV-FILLED-CELL-1] 불변식 위반 — resumeCellOf 주석).
    async (col: Column, opts?: { isModify?: boolean; previousValue?: string; fractionWhole?: string; resumeCell?: ResumeCell }) => {
      const row = useSessionStore.getState().activeRow;
      // 🔴 v0.49 r5 Z2 — 착지 리셋 4종(알람 해제 · 거절 큐 · 수정 표식 · phase)은 `armLanding`이
      //   소유한다. 종전엔 이 자리에 그 넷이 손으로 적혀 있었고, 형제 착지 셋과의 **사본 차이**가
      //   이번 라운드 회귀 3건(M4 · M8 두 건)이었다 — 근거·차이 축·가드는 그 헤더 참조.
      //   여기 남은 것은 **이 착지 고유의 것**뿐이다: 수정 표식의 값, 소수부 문맥, 진입 단음.
      //   ⚠️ `false`면 즉시 return — 종료 중(stopping) 낡은 continuation은 awaiting도 클립도
      //     TTS도 열지 않는다(R4-F2).
      if (!armLanding({
        // v0.9.0 — 다음 필드로 진입하면 이전 이상치 알람 팝업은 해제(해소된 것으로 간주).
        reason: 'announce_field',
        phase: 'active',
        // v0.12.0 AREA2 V4 — 수정 재안내면 '수정 값' 인디케이터를 켜고, 일반 안내면 해제한다.
        modifyIndicator: opts?.isModify ? { name: col.name, colId: col.id } : null,
        // 🔴 M3/M4 — 살아 있는 소수부 재질문은 **지우는 게 아니라 다시 그린다**(armLanding 헤더).
        decimalReason: opts?.fractionWhole ?? null,
      })) return;
      // v0.47.0 W2(FB-C, 민구 08-08) — 수정 **진입** = 중립 단음 + amber(§C4 의미 보존).
      //   종전엔 이 단음이 성공 커밋 시점(:handleFinal)에 났다 — W2가 성공을 화음+green으로
      //   재정의하며 중립 단음은 "모드 전환" 본래 의미대로 진입으로 옮겼다.
      if (opts?.isModify) playBeep('modify');
      awaitingFieldRef.current = opts?.isModify
        ? {
          kind: 'modify', row, colId: col.id, name: col.name,
          previousValue: opts?.previousValue,
          ...(opts?.fractionWhole != null ? { fractionWhole: opts.fractionWhole } : {}),
          ...(opts?.resumeCell != null ? { resumeCell: opts.resumeCell } : {}),
        }
        : {
          kind: 'value', row, colId: col.id, name: col.name,
          ...(opts?.fractionWhole != null ? { fractionWhole: opts.fractionWhole } : {}),
        };
      // v0.4.4 barge-in 클립 복구: 클립을 announce TTS '이전에' 시작한다. 레코더(audioRecorder)는
      // TTS mute와 무관하게 영구 mic 스트림에서 연속 캡처하므로, 안내 음성이 나가는 동안 사용자가
      // 값을 말하면(barge-in) 그 발화가 클립에 담긴다. 이전엔 announce 후 시작이라 barge-in 구간이
      // 비어 데이터탭 재생 시 무음이었음. (announce 후 시작을 강제하던 redo-inline 가드[MEDIUM-4]는
      // redo 명령 제거로 사라짐.) 클립 앞에 새는 announce TTS는 mic AEC가 억제하고, 앞 무음은
      // audioTrim이 정리한다.
      armClipForCell(row, col.id);
      const hint = opts?.isModify
        ? `수정. ${col.name} 다시 말씀해 주세요.`
        : `${col.name} 말씀해 주세요.`;
      useSessionStore.getState().setLastTts(hint);
      await say(opts?.isModify ? `수정. ${col.name}.` : `${col.name}.`, false);
    },
    [armClipForCell, armLanding, say],
  );

  // ── end-of-table (v0.5.0 NAV-1 / 요청3) ────────────────────
  /** "3행, 7행" 식 행 목록 포맷. 목록이 길면 TTS가 늘어지므로 3개 + "외 N개 행"으로 요약. */
  const formatRowList = (rows: number[]): string =>
    rows.length <= 5
      ? rows.map((r) => `${r}행`).join(', ')
      : `${rows.slice(0, 3).map((r) => `${r}행`).join(', ')} 외 ${rows.length - 3}개 행`;

  const listEmptyRows = (total: number, vCols: Column[]): number[] => {
    const out: number[] = [];
    for (let r = 1; r <= total; r++) {
      if (!isRowVoiceComplete(r, vCols)) out.push(r);
    }
    return out;
  };

  /** 끝 도달 안내(확정표 #5+6 통합) — **트리거 두 곳이 이 한 줄을 공유한다**(`announceEndReached`
   *  진입 · atEnd 값 흡수). 종전엔 두 곳이 서로 다른 문구를 인라인으로 들고 있었다.
   *  🔴 완료 행 수는 **화면 `X / N`의 X와 같은 출처**(`completedRows.length`)를 쓴다 —
   *  `total - empties.length`로 새로 세면 부분 입력·스킵 처리에서 화면과 갈린다(§2 의미 동등). */
  const buildEndReachedTts = (empties: number[]): string => endReachedTts(
    useSessionStore.getState().completedRows.length,
    empties.length > 0 ? formatRowList(empties) : null,
  );

  /** v0.23.0 입력탭#4(민구 결정 — "안내 후 대기"): 마지막 행 너머에 더 갈 곳이 없어도 **자동 종료하지
   *  않는다**. 빈 행이 있으면 함께 안내하고, 어느 경우든 안내 후 세션을 active로 유지한다.
   *  🔴 v0.49 r2 A13(codex F6) — 이 자리의 종전 서술 *"어느 경우든 「종료하려면 '종료' 또는 종료
   *  버튼」 안내 후"* 는 **현행과 반대다**: W2(확정표 #5+6)가 그 종료 꼬리를 삭제했다(종료 수단은
   *  하단 ⏹과 '종료' 명령으로 상시 노출되므로 매번 되풀이하지 않는다). 문구의 정본은
   *  `voicePrompts.endReachedTts`이고, 바이트는 v023-voice B4·a1-atend-row가 전체 일치로 잠근다.
   *  awaiting을 마지막 음성 필드에 atEnd 센티넬로 둬서 '종료'/'수정' 등 명령은
   *  계속 dispatch되되(handleFinal `if(!awaiting) return` 게이트 통과), 일반 값 발화는 atEnd 가드가
   *  새 행 커밋 대신 종료 재안내로 흡수한다. 종료는 '종료' 음성 명령 또는 종료 버튼으로만 일어난다. */
  const announceEndReached = useCallback(async () => {
    const sess = useSessionStore.getState();
    // 🔴 v0.49 r5 Z2 — 착지 리셋 4종 + `endReached`는 `armLanding`이 소유한다(그 헤더 참조).
    //   v0.47.0 W2(FB-G①, 실기기 08-08)의 「종단 착지에서 수정 표시 명시 해제」도 그 안에 있다 —
    //   해제 유일 지점이 announceField뿐이라 마지막 행을 수정으로 마감하면 완료 화면까지 amber가
    //   고착됐던 그 계약이다. `endReached: true`가 phase 전이와 **한 쌍으로** 나간다.
    //   ⚠️ 종료 중이면 여기서 끝난다 — 센티넬도 완료 화면도 열지 않는다.
    if (!armLanding({ reason: 'end_reached', phase: 'complete', endReached: true })) return;
    const vc = voiceColsList();
    const total = computeTotalRows(getSessionColumns());
    const empties = listEmptyRows(total, vc);
    const lastCol = vc[vc.length - 1] ?? null;
    // 🔴 v0.49 r3 #2(claude r2 HIGH) — **커서를 센티넬 컬럼에 주차한다 — 한 상태에 커서는 하나다.**
    //   A1이 센티넬의 행 축을 `activeRow`로 고쳤지만 컬럼 축은 「마지막 음성 필드」로 고정돼 있고,
    //   `advance()`의 전진 스캔은 **커서를 옮기지 않은 채** 끝 도달로 떨어질 수 있다(뒤 칸이 전부
    //   차 있으면 while이 `vc.length`까지 가고 `activeColIdx`는 그대로다 — 셀 검토 중 '유지' 등).
    //   그러면 화면 활성 칩은 앞 컬럼인데 센티넬 `colId`는 마지막 컬럼이라, bare '수정'이
    //   **사용자가 만진 적 없는 확정 셀**을 비우고(소비자 전부가 `a.colId`를 읽는다: enterModifyMode ·
    //   cmdModify · cmdKeep · 명령 클립 키) 항목 이동만 `activeColIdx`를 본다 — 한 상태 두 커서.
    //   ⚠️ **반대 방향(센티넬을 `activeColIdx`로)은 안 된다.** atEnd의 bare '수정'은 `reviewTarget`이
    //   서지 않아(:2335가 atEnd를 제외한다) `clearEnd = vc.length` **행 스코프**로 지운다 —
    //   앞 컬럼을 타깃으로 삼으면 「첫 항목부터 행 끝까지 —」, 정확히 [MODIFY-TARGET-1]이 닫은
    //   그 증상이 되살아난다. 그래서 화면을 센티넬에 맞춘다(센티넬 컬럼 계약은 불변).
    //   오라클: tests/v049-r3-02-atend-cursor.spec.ts
    if (lastCol) sess.setActiveCol(vc.length - 1);
    // 명령 컨텍스트 유지용 atEnd 센티넬(마지막 음성 필드). 값 커밋은 handleFinal의 atEnd 가드가 차단.
    // 🔴 v0.49 r2 A1(리뷰 합집합 C1) — **행은 `total`이 아니라 `activeRow`다.** 끝 도달은 「아래로
    //   미완료 행이 없다」는 뜻일 뿐 「마지막 행에 서 있다」는 뜻이 아니다(`findNextIncompleteRow`는
    //   아래 방향만 본다 — 위쪽 미완료 행은 `empties`로 남는다). 순서 밖으로 완주하면(3행 먼저 →
    //   되돌아와 2행) 사용자는 2행에 서 있는데 센티넬만 3행을 가리켰고, 이 센티넬을 `a.row`로 읽는
    //   소비자 전부가 **다른 행**을 만졌다: bare '수정'(enterModifyMode :1256)과 "수정 <컬럼명>"
    //   (cmdModify :2204)이 3행의 칸을 지우고 `markRowIncomplete(3)`로 **완료 행을 미완료로 되돌렸고**,
    //   '유지'(:2127)는 다른 행 값을 읽고, 명령 클립(preserveCommandClip :2172·armClipForCell :2181)은
    //   틀린 셀 키로 저장됐다(D1/CLIP-CMD가 막으려던 orphan 형태). 순서대로 채운 경우엔
    //   `activeRow === total`이라 로그 `row=` 바이트도 종전과 동일하다 — 갈리는 것은 순서 밖뿐이다.
    //   ⚠️ 컬럼 축은 그대로다([MODIFY-TARGET-1] — 센티넬 컬럼 = 마지막 음성 필드).
    //   오라클: tests/v049-r2-a1-atend-row.spec.ts
    awaitingFieldRef.current = lastCol
      ? { kind: 'atEnd', row: sess.activeRow, colId: lastCol.id, name: lastCol.name }
      : null;
    sess.setRecognized('');
    // (phase='complete' + endReached=true는 위 `armLanding`이 세웠다.) phase 'complete'는 hero를
    // 정적 대기 라벨("N행 완료 — 명령 대기", v0.34.0 A4)로 둬 마지막 컬럼이 '듣는 중'처럼 보이는
    // 오해를 막는다. STT는 계속 돌아 '종료'/'수정' 음성 명령이 처리되되(handleFinal는 paused만
    // 게이트) early-commit(active 전용)은 멈춘다. 종료는 '종료' 음성·종료 버튼만.
    // `endReached=true`는 조사 완료 화면(UI-c: 시각 상태어 없는 `X / N` + 종료 버튼)의 유일한
    // 진입점이다 — 완료 행 검토 대기(enterReviewWait)는 같은 phase지만 [1] active 레이아웃을 쓴다.
    const msg = buildEndReachedTts(empties);
    sess.setLastTts(msg);
    logCell({
      type: 'session',
      extra: empties.length > 0 ? `end_reached_waiting:empty=${empties.join(',')}` : 'end_reached_waiting',
    });
    await say(msg);
  }, [armLanding, say]);

  // ── v0.33.0 백로그 A(민구 결정 3): 완료 행 착지 → "값 읽어주기 + 명령 대기" ─────
  /** 완료 행에 착지('이전' 음성/◀ 버튼/행 점프)하면 그 행의 음성입력 기록값을 TTS로 읽어주고
   *  명령 대기 상태로 둔다. awaiting은 reviewWait 센티넬(v0.34.0 A3: 그 행 **포인터=첫 음성 필드**.
   *  이전엔 마지막 필드였는데, 실기기 피드백 "포인터가 자동으로 마지막 값으로 이동 — 첫 항목값은
   *  수동 입력 외 수정 불가"로 첫 컬럼 착지로 전환. bare '수정'은 포인터 컬럼, "수정 <컬럼명>"으로
   *  다른 컬럼 지목 가능 — handleFinal modify 분기 참조)로 무장 —
   *  명령('수정'/'유지'/'다음'/'이전'/'종료' 등)은 계속 dispatch되되, bare 값 발화는 handleFinal의
   *  reviewWait 가드가 흡수한다(덮어쓰기 금지 — 수정은 '수정' 명령으로만). phase='complete'로 둬
   *  착지 필드가 '듣는 중'처럼 보이지 않게 하고 early-commit(active 전용)도 함께 멈춘다(atEnd 패턴). */
  const enterReviewWait = useCallback(async (row: number) => {
    const sess = useSessionStore.getState();
    // 🔴 v0.49 r5 Z2 — 착지 리셋 4종 + `endReached`는 `armLanding`이 소유한다(그 헤더 참조).
    //   v0.47.0 W2(FB-G①)의 「검토 대기 진입도 종단 착지 = 수정 표시 명시 해제」가 그 안에 있다 —
    //   검토 출신 수정("수정 88.9" 직접값 등)이 여기로 복귀할 때의 잔존 방지.
    //   `endReached: false`는 와이어프레임 §[4] 대비다: 검토 대기는 '조사 완료'가 아니다(끝 도달
    //   후 '이전'으로 되돌아온 경우까지 포함해 명시적으로 내린다). [1] active 레이아웃 + hero ✓.
    if (!armLanding({ reason: 'review_wait', phase: 'complete', endReached: false })) return;
    const vc = voiceColsList();
    const values = sess.getRowValues(row);
    const parts = vc
      .filter((c) => (values[c.id] ?? '') !== '')
      .map((c) => `${c.name} ${formatForTts(values[c.id])}`);
    const firstCol = vc[0] ?? null;
    sess.setActiveCol(0);
    sess.setRecognized('');
    awaitingFieldRef.current = firstCol
      ? { kind: 'reviewWait', row, colId: firstCol.id, name: firstCol.name }
      : null;
    // v0.34.0 A3 계측(D11c) — 검토 대기 진입은 이전까지 무로깅이라 실기기 분석에서 착지 컬럼을
    // 재구성할 수 없었다. 기존 command 타입 재사용(신규 LogEntry type 없음 — log-replay 호환).
    logCell({
      type: 'command', parsed: 'review_wait', extra: `review_wait:row=${row},col=first`,
      row, ...(firstCol ? { colId: firstCol.id } : {}),
    });
    const msg = `${row}행 완료됨. ${parts.join(', ')}.`;
    sess.setLastTts(msg);
    await say(msg);
  }, [armLanding, say]);

  // ── 🔴 v0.49 fix49(리뷰 B-1 blocker): 값이 든 셀 착지 → "값 읽어주기 + 명령 대기" ─────
  /** 항목 이동(`gotoAdjacentField`)·행 경계 재안내가 **이미 값이 있는 셀**에 커서를 세울 때의
   *  착지 처리. `announceField`를 부르면 그 셀에 `kind:'value'`가 열려 **뒤이은 bare 숫자가
   *  확정된 값을 조용히 덮는다** — 이 앱은 커밋 지점(`setRowValue`)에 셀 단위 거절 게이트가
   *  없어서, 「커서를 filled 셀 위에 `kind:'value'`로 세우지 않는다」가 유일한 방어선이다.
   *
   *  의미론은 완료 행 착지(`enterReviewWait`, v0.33.0 결정 3)와 **같다** — 값을 낭독하고
   *  명령을 기다린다. 다른 것은 스코프(행→셀)와, 그래서 **이동을 막지 않는다**는 점이다.
   *
   *  🔴 **문구를 reviewWait/atEnd와 공유하지 마라.** 이 앱은 안내 문구를 계약으로 다룬다
   *  (v0.47.0 V-FIX4): 셀 하나에 대고 "행 완료됨"/"입력이 끝났습니다"라고 하면 사용자는
   *  있지도 않은 상태를 찾는다(F-1 마지막 커밋 `18776ca`가 atEnd를 가른 것과 같은 이유).
   *  ⚠️ 문구를 늘리지 마라 — [TTS-WATCHDOG-1]에서 긴 발화일수록 절단률이 단조 증가한다.
   *
   *  phase는 `active` 그대로 둔다(reviewWait과 다른 점). 이 행은 아직 진행 중이라
   *  `complete`로 내리면 히어로 ✓·레이아웃이 「조사 완료」로 바뀐다. 대신 조기확정(early-commit)은
   *  `handleInterim`의 kind 게이트가 명시적으로 막는다 — phase에 기대지 않는다.
   *  오라클: tests/v049-fix49-cell-guard.spec.ts ①②⑥
   *  (v0.49 r2 — 종전 이 줄이 지목하던 `v049-fix49-nav-guards.spec.ts`는 **실재한 적이 없다**.
   *   ①②⑥은 cell-guard의 항목 번호와 정확히 대응한다.) */
  const enterCellWait = useCallback(async (col: Column, value: string) => {
    const sess = useSessionStore.getState();
    const row = sess.activeRow;
    // 🔴 v0.49 r5 Z2 — 착지 리셋 4종은 `armLanding`이 소유한다(그 헤더 참조). 여기 있던
    //   `setPhase('active')`(r4 M8)는 위 헤더의 *"phase는 `active` 그대로 둔다"* 를 선언에서
    //   집행으로 바꾼 줄이었다 — 행 경계 착지는 검토/끝 도달 국면에서 들어올 수 있어
    //   'complete'가 남으면 `CenterStage`의 `completing` 게이트가 거절 큐를 억제해 비프만 남는다.
    //   `clearAnomalyAlert`(fix49b #14)도 같은 묶음이다: 「빈 칸에 착지하면 팝업이 사라지고 값
    //   있는 칸에 착지하면 남는」 비대칭을 없앤 v0.9.0 계약의 세 번째 착지 지점.
    if (!armLanding({ reason: 'cell_wait', phase: 'active' })) return;
    sess.setRecognized('');
    awaitingFieldRef.current = {
      kind: 'cellWait', row, colId: col.id, name: col.name, previousValue: value,
    };
    logCell({
      type: 'command', parsed: 'cell_wait', extra: `cell_wait:${col.id}`,
      row, colId: col.id,
    });
    // "횡경 기록값 35.1." — 「기록값」이 이 상태의 판별어다(안내 프롬프트 "횡경."과 구분되고,
    //   행 검토의 "N행 완료됨"과도 겹치지 않는다). 흡수 안내가 정정 진입로를 가르친다.
    const msg = `${col.name} 기록값 ${formatForTts(value)}.`;
    sess.setLastTts(msg);
    await say(msg);
  }, [armLanding, say]);

  /** 착지 셀의 현재 값(음성 컬럼) — 있으면 cellWait, 없으면 종전 `announceField`. */
  const announceOrCellWait = useCallback(async (col: Column) => {
    const v = useSessionStore.getState().getRowValues(useSessionStore.getState().activeRow)[col.id] ?? '';
    if (v !== '') { await enterCellWait(col, v); return; }
    await announceField(col);
  }, [announceField, enterCellWait]);

  /** v0.47.0 C-FIX2 — 셀 영속 실패 고지(수동·터치 공통 · manualHold 실패 처리와 대칭 목적).
   *  경고 트릴 + 발화 — 현장은 폰을 2~3m 떨어뜨려 둬 화면을 못 본다(PRINCIPLES §2).
   *  🟡 값은 화면에 남긴다(manualHold의 롤백과 다른 선택): 그쪽 롤백은 pending 태그 없는
   *  후보가 reload에 확정처럼 보이는 반쪽 상태를 막는 장치고, 여기는 검증을 통과한 값의
   *  내구화만 실패한 경우다 — 지우면 입력이 유실되고, 남기면 재시도가 그 값을 그대로 쓴다.
   *  근거는 산출물 리뷰 대응 절에.
   *  C-FIX2b(2차 재검증) — 소리·발화는 순간이라 놓칠 수 있다: **지속 배너 + 명시 재시도**를
   *  함께 세운다(cellPersistError.arm → VoiceScreen이 CellPersistErrorBanner 렌더 · [다시 저장]
   *  = commitManualValue 재실행 → 성공 시 원래 커밋 플로우 전체 재개). 기존 persistError는
   *  stop 전용 의미론(성공 재시도 = 세션 종료)이라 셀 스코프 변형 — 근거는 cellPersistError.ts.
   *  ⚠️ v0.49 r6 Y1 — 정의 위치만 옮겼다(종전 `commitTouchValue` 바로 위). 행 완료 부기의
   *   durable 실패도 같은 배너로 고지해야 하는데(아래 `notifyRowPersistFailed`), 그 소비자가
   *   `finalizeRowCompletion`/`advance`라 여기 있어야 참조된다. 본문 무변경. */
  const notifyCellPersistFailed = useCallback((row: number, colId: string, value: string) => {
    useCellPersistError.getState().arm({ row, colId, value });
    playBeep('alert');
    const msg = '저장하지 못했습니다. 다시 저장 버튼을 눌러 주세요.';
    useSessionStore.getState().setLastTts(msg);
    void say(msg);
  }, [say]);

  /** 🔴 v0.49 r6 Y1 — **행 완료 부기의 durable 실패 고지.** 셀 실패 배너를 그대로 재사용한다.
   *
   *  왜 셀 배너인가: 이 배너의 재시도는 `commitManualValue(row,colId,value)` 재실행이고, 그
   *  경로가 `persistCellValue`(→ 세션이 아직 없으면 `persistSession`) → `finalizeRowCompletion`
   *  **전체를 다시 태운다**. 즉 행 부기 실패도 같은 버튼 하나로 실제 회복된다 — 「실패는 화면에
   *  남기고 재시도 경로를 제공한다」(PRINCIPLES §1)를 새 UI 없이 만족하는 유일한 기존 깔때기다.
   *  좌표는 **그 행에서 값이 있는 마지막 음성 컬럼** = 방금 행을 완성시킨 칸이다(재커밋해도 값이
   *  같아 부작용이 없고, 배너 문구가 사용자가 마지막으로 넣은 값을 가리킨다). */
  const notifyRowPersistFailed = useCallback((row: number) => {
    const values = useSessionStore.getState().getRowValues(row);
    const target = [...voiceColsList()].reverse().find((c) => (values[c.id] ?? '') !== '');
    if (!target) return;
    notifyCellPersistFailed(row, target.id, values[target.id]!);
  }, [notifyCellPersistFailed]);

  // ── progression ────────────────────────────────────────────
  /** 🔴 v0.49 r3 #1(claude r2 크리티컬) — **행 완료 부기**(완료 마킹 · 정정 백업 해제 · 영속화).
   *  종전엔 `advance()` 안에만 있었다. 그 자리에서 뽑아낸 이유가 곧 이 결함이다: A2가 커밋
   *  종단에 「예약 복귀」 착지(cellWait/reviewWait 재무장)를 추가하면서 그 경로들이 `advance()`를
   *  **타지 않고 return**하는데, 부기가 advance 안에만 있어 통째로 건너뛰어졌다.
   *
   *  피해는 **값 되돌림**이다. 캐스케이드 정정(`enterModifyMode`)은 정정 **이전**의 행 스냅샷을
   *  `correctionBackupRef`에 세우고 `markRowIncomplete`한다. 부기가 안 돌면 그 백업이 살아남고,
   *  다음 `persistSession`이 :636에서 그 낡은 행(complete:true·syncState:'synced')을 rows에
   *  push한다 — completedRows에 없는 행이라 조건이 그대로 성립한다. 그 push는 :639의
   *  `!rows.some(...)` 때문에 **신선한 buildRow(activeRow)를 밀어낸다.** 결과: 수정값은
   *  메모리에만 살고 IDB에는 옛값이 남아 리로드 시 복원되고, 'synced'가 유지되므로 시트도
   *  교정되지 않으며, 완료 마킹이 없어 X/N이 하나 줄어든 채 굳는다.
   *
   *  ⚠️ 낭독(`announceRowComplete`)과 phase 전이는 **여기 넣지 않는다** — 그건 착지마다 다르다.
   *  셀 검토 복귀는 "N행 완료됨"이 아니라 "…기록값 …"을 말해야 한다(enterCellWait 헤더의 문구
   *  계약). 이 함수가 다루는 것은 «내구성»뿐이고, «무엇을 말하는가»는 호출부가 정한다.
   *
   *  🔴🔴 v0.49 r6 Y1(codex R5-F1 Critical, 동적 재현 확증) — **`void persistSession()`이 실패를
   *  삼켰다.** 이 부기가 세션의 **첫** IDB 쓰기가 되는 형상(= 아직 durable 세션이 없다)에서는
   *  여기가 실패해도 호출부는 결과를 받지 못해 완료 낭독·다음 행 전진·✓·화음을 그대로 냈다.
   *  실측(2026-08-14, fixr6): 실패 주입 뒤 음성으로 1행을 완주하면 **IDB 세션 0건**인데
   *  「조사나무 1 완료」가 나오고 2행으로 넘어갔다 — 리로드하면 두 값이 전부 사라진다.
   *  PRINCIPLES §1 「durable 실패를 삼키지 않는다」 정면 위반이고 피해는 **값 유실**이다.
   *  👉 durable 결과를 **반환**한다. «무엇을 말하는가»가 호출부 몫인 것처럼 «실패를 어떻게
   *     고지하는가»도 호출부 몫이다(`notifyRowPersistFailed` 참조).
   *  ⚠️ **no-op은 `true`다.** 미완료 행(가드)·이미 내구화된 부기(둘 다 거짓)는 «쓸 것이 없음»이지
   *     실패가 아니다 — `false`로 두면 `advance` 뒤 `proceedAfterCommit`의 멱등 재호출이
   *     **가짜 실패 배너**를 띄운다(수정이 결함보다 나빠지는 지점).
   *  ⚠️ 실패 시 **메모리 부기를 되돌린다.** 되돌리지 않으면 `wasComplete`가 참이 돼 재시도가
   *     no-op `true`로 통과한다 = IDB엔 아무것도 없는데 배너만 사라지는 **거짓 회복**. 백업도
   *     함께 복원한다 — 캐스케이드 원본 스냅샷을 지운 채 persist가 실패하면 원본이 영영 없다.
   *  오라클: tests/v049-r3-01-resume-persist.spec.ts · tests/v049-r6-y1-durable-commit.spec.ts */
  const finalizeRowCompletion = useCallback(async (row: number): Promise<boolean> => {
    const sess = useSessionStore.getState();
    if (!isRowVoiceComplete(row, voiceColsList())) return true;
    const backup = correctionBackupRef.current;
    const hadBackup = backup?.index === row;
    const wasComplete = sess.isRowComplete(row);
    if (hadBackup) correctionBackupRef.current = null;
    if (!wasComplete) sess.markRowComplete(row);
    // 실제로 부기가 바뀐 경우에만 쓴다 — 한 커밋에서 두 번(proceedAfterCommit 진입 + advance)
    // 불려도 IDB 쓰기는 1회다. 바뀐 게 없으면 직전 커밋의 persist가 이미 같은 스냅샷을
    // 내구화했으므로 여기서 또 쓰는 것은 순수 낭비다(현장 배터리 — PRINCIPLES §6).
    if (!hadBackup && wasComplete) return true;
    const durable = await persistSession();
    if (!durable) {
      if (!wasComplete) useSessionStore.getState().markRowIncomplete(row);
      if (hadBackup) correctionBackupRef.current = backup;
    }
    return durable;
  }, [persistSession]);

  /** Move to next voice col in current row, or finalize row + jump to next target. */
  const advance = useCallback(async () => {
    const startEpoch = epochRef.current;
    const sess = useSessionStore.getState();
    // 리뷰 라운드1(Codex+Flash, 수용) — 필드/행 이동 시 미확정 interim 표시 정리(표시 전용).
    sess.setInterimValue(null);
    const vc = voiceColsList();
    const row = sess.activeRow;
    const total = computeTotalRows(getSessionColumns());

    // 🔴 v0.49 r6 Y3(claude #3) — **종료 중에는 진행하지 않는다. 단 내구성 부기는 남긴다.**
    //   이 함수는 Z2가 모은 착지 넷의 호출부이면서, 그 넷에 **속하지 않는 전이를 스스로 한다**:
    //   아래 `sess.setPhase('complete')`(행 완료 표시)와 행 이동이 그것이다. 종료 중 커밋
    //   continuation이 여기 도달하면 `stopping`이 `complete`로 덮여 종료 절차의 상태 판정이
    //   무너지고, 완료 낭독이 종료 안내를 밀어낸다(R4-F2가 착지 축에서 닫은 그 형태).
    //   ⚠️ **부기까지 건너뛰면 안 된다** — 그러면 방금 커밋된 값이 완료 마킹 없이 남아
    //     `stop()`의 persist가 `complete:false`로 굳힌다(= sync가 영영 안 올린다). 종료 중에는
    //     셀 배너로 고지할 표면이 없으므로(화면이 StoppingState) durable 실패는 `stop()`의
    //     `persistError` 경로가 받는다 — 여기서는 `void`로 부기만 태운다.
    if (sess.phase === 'stopping') {
      if (isRowVoiceComplete(row, vc)) void finalizeRowCompletion(row);
      logCell({ type: 'session', extra: 'advance_refused:stopping', row });
      return;
    }

    // Still voice cols in this row?
    // (v0.33.0 백로그 A — v0.4.5 I3 "이전" 재입력 모드(isReentry) 폐지: 채워진 필드 스킵이 유일 경로.)
    const nextIdx = sess.activeColIdx + 1;
    if (nextIdx < vc.length) {
      const values = sess.getRowValues(row);
      let target = nextIdx;
      // Skip cols already filled with non-empty values (empty string = cleared by modify)
      while (target < vc.length) {
        const v = values[vc[target].id];
        if (v === undefined || v === '') break;
        target++;
      }
      if (target < vc.length) {
        sess.setActiveCol(target);
        sess.setRecognized('');
        await announceField(vc[target]);
        return;
      }
    }

    // All voice cols AFTER the pointer are filled — but that alone doesn't prove the row is
    // complete: the forward scan never looks at cols BEFORE the pointer.
    // 🔴 v0.47.0-r3 후속(codex r4 :968, Larry 확정 08-09) — 교차행 직접수정 알람은 포인터를 대상
    //   행 **마지막** 칸에 세우므로(:1273 부근), 대상이 skip 행이면 여기서 앞선 빈 칸을 안 보고
    //   markRowComplete가 돌아 **빈 측정값이 complete:true로 내구화**되고 skippedRows 표식까지
    //   지워졌다(markRowComplete가 skip을 제거한다 — 값 유실이 완료로 위장). cascade 변형(skip
    //   행 bare '수정' — 예약 없음, :1365)도 같은 구멍이었다. 미완료 행은 완료 처리 전체(마킹·
    //   persist·완료 낭독)를 건너뛰고, 아래 복귀 예약 소비/다음 행 탐색만 그대로 수행한다 —
    //   P1 알람 경로는 returnStack이 원 출발점을 들고 있으니 그 소비가 곧 복귀다.
    //   오라클: tests/v0470-r2-p1-direct-modify-trend.spec.ts 「P1-미완료대상」.
    if (isRowVoiceComplete(row, vc)) {
      // 🔴 v0.49 r3 #1 — 부기 3줄(백업 해제·완료 마킹·persist)은 `finalizeRowCompletion`으로
      //   옮겼다. 여기가 유일한 소유자였던 것이 결함의 근인이다(그 헤더 참조).
      // 🔴 v0.49 r6 Y1 — **완료 낭독보다 durable 판정이 먼저다.** 실패인 채로 아래를 진행하면
      //   「N행 완료」 + 다음 행 전진이 **유실될 값을 성공 고지**한다(실측: IDB 0건 + 「조사나무 1
      //   완료」). 낭독 뒤로 미루면 이미 귀에 들어간 뒤라 늦다.
      //   ⚠️ 실측 정정: 음성 커밋 종단은 `proceedAfterCommit`을 먼저 지나므로 **그쪽 라우팅이
      //     실제로 이 시나리오를 잡는다**(이 줄만 되돌리면 오라클 5건이 전부 green). 그럼에도
      //     남기는 이유는 `advance()`를 **직접** 부르는 경로가 실재하기 때문이다 — 예약이 없는
      //     상태의 '유지'(:2638)가 그것이고, 그 자리에서 행이 완성되면 여기가 유일한 방어다.
      if (!(await finalizeRowCompletion(row))) {
        notifyRowPersistFailed(row);
        return;
      }
      sess.setPhase('complete');
      awaitingFieldRef.current = null;
      await announceRowComplete(row);
      if (epochRef.current !== startEpoch) return;
    }

    // If a return reservation is set (came from modify/jump), go back.
    // v0.5.0 NAV-1 이중 가드: 복귀 대상이 이미 완료된 행이면 복귀하지 않는다 — 완료 행을
    // 재프롬프트하며 같은 행으로 반복 복귀하던 루프의 2차 차단(1차는 goNextRow의 setReturn 제거).
    // v0.47.0-r3(codex f3) — 단일 returnRow → returnStack **최상단 1건 소비**(pop). 깊이 ≤1에서는
    // 종전(읽고 즉시 클리어)과 동작이 같고, P1 교차행 알람이 쌓은 중첩 예약(깊이 2)에서만
    // 안쪽 출발점이 먼저 나온다. 폴스루(완료 행 복귀 무시) 시에도 pop한 1건만 버려진다 —
    // 남은 바깥 예약은 다음 행 완료가 소비한다(종전 계약의 스택 일반화).
    const ret = sess.returnStack[sess.returnStack.length - 1] ?? null;
    if (ret != null && ret.row !== row) {
      sess.popReturn();
      if (!isRowVoiceComplete(ret.row, vc)) {
        const targetCol = ret.colIdx ?? firstIncompleteColIdx(ret.row, vc);
        sess.setActiveRow(ret.row);
        sess.setActiveCol(targetCol);
        sess.setRecognized('');
        sess.setPhase('active');
        awaitingFieldRef.current = null;
        await announceRowDiff(row, ret.row);
        if (epochRef.current !== startEpoch) return;
        // 🔴 v0.49 fix49b(max 리뷰 #3) — `ret.colIdx`는 `jumpToRow`가 **떠날 때의 activeColIdx**를
        //   그대로 적어 둔 것이다. F-1 이전엔 그 값이 언제나 빈 칸을 가리켰지만(기록자 전량이
        //   그랬다), 항목 이동이 커서를 **filled 셀에 주차**시킬 수 있게 되면서 예약에 채워진
        //   칸이 실린다 — 그대로 `announceField`를 부르면 B-1이 여기서 다시 열린다.
        if (vc[targetCol]) await announceOrCellWait(vc[targetCol]);
        return;
      }
      // 완료 행으로의 복귀는 무시하고 아래 '다음 미완료 행' 탐색으로 폴스루.
    }

    // Otherwise find next incomplete row (아래 방향만 — wrap-around 없음)
    const next = findNextIncompleteRow(row + 1, total, vc);
    if (next === null) {
      // 🔴 v0.49 r4 M2(claude r3 #1 — Larry 소스 확증) — **미완료 행에 선 채로 끝 도달을 선언하지
      //   않는다.** 이 지점의 두 스캔은 **둘 다 아래만 본다**: 위 전진 스캔은 포인터 **뒤** 칸만
      //   보고(:1160 자기 주석), `findNextIncompleteRow`는 `row + 1`부터 본다. 그래서 포인터
      //   **앞**에 빈 칸이 남은 행(항목 이동으로 빈 칸을 지나쳐 뒤 칸을 채운 경우)에서 아래에
      //   미완료 행이 없으면, 미완료 행에 선 채로 `announceEndReached`가 돌았다.
      //
      //   그 상태의 atEnd 센티넬은 `{row: activeRow(미완료), colId: 마지막 음성 컬럼}`이고,
      //   #2가 커서까지 거기 주차하므로 화면·센티넬이 **일치한 채로 함께 틀린다.** 이어지는
      //   bare '수정'은 `reviewTarget`이 서지 않아(:2382가 atEnd를 제외) 행 스코프로 지우는데,
      //   그 타깃이 사용자가 채워야 할 **빈 칸**이 아니라 **확정된 마지막 셀**이다 — 남은 일을
      //   가리키는 대신 끝낸 일을 지운다.
      //
      //   처방은 컬럼 축이 아니라 **도달 자체**를 막는 것이다(반대 방향은 [MODIFY-TARGET-1]
      //   재발 — :955 경고 참조). 남은 빈 칸으로 커서를 되돌린다. 루프는 없다: 여기 도달은
      //   값 커밋 뒤이고, 그 빈 칸이 채워지면 위 `isRowVoiceComplete` 가지가 행을 완료시킨다.
      //   👉 이로써 **atEnd는 완료된 행에서만 무장한다**가 구조적 불변식이 된다
      //   (`announceEndReached`의 유일한 호출부가 여기다).
      //   오라클: tests/v049-r4-m2-atend-incomplete.spec.ts
      if (!isRowVoiceComplete(row, vc)) {
        const gapIdx = firstIncompleteColIdx(row, vc);
        // 새 이름으로 계측한다(PRINCIPLES §4) — 이 전이는 `end_reached_waiting`을 **대체**하므로,
        //   같은 이름에 얹으면 끝 도달 집계가 조용히 부풀고 두 상태를 로그에서 못 가른다.
        logCell({
          type: 'session', extra: `row_gap_return:col=${vc[gapIdx].id}`,
          row, colId: vc[gapIdx].id,
        });
        sess.setActiveCol(gapIdx);
        sess.setRecognized('');
        sess.setPhase('active');
        awaitingFieldRef.current = null;
        await announceField(vc[gapIdx]);
        return;
      }
      // v0.23.0 입력탭#4 — 자동 종료 제거. 안내 후 '종료' 명령/버튼까지 세션 유지.
      await announceEndReached();
      return;
    }

    sess.setActiveRow(next);
    const targetCol = firstIncompleteColIdx(next, vc);
    sess.setActiveCol(targetCol);
    sess.setRecognized('');
    sess.setPhase('active');
    awaitingFieldRef.current = null;
    await announceRowDiff(row, next);
    if (epochRef.current !== startEpoch) return;
    if (vc[targetCol]) await announceField(vc[targetCol]);
  }, [announceField, announceOrCellWait, announceRowComplete, announceRowDiff, announceEndReached, finalizeRowCompletion, notifyRowPersistFailed, say]);

  /** v0.35.3 Stage 3-5 — 커밋 경로 진행 공용. 검토 대기(reviewWait) 출신 커밋은 검토 대기를
   *  재무장해 갱신값을 재낭독하고(advance로 검토를 강제 종료하지 않음 — v0.33.0 항목2 계약),
   *  그 외에는 대기를 해제하고 다음 셀로 진행한다. echoValue를 주면 advance 전에 값을 에코
   *  (수동 칩 커밋의 청각 확인 — 음성 커밋과 동일). 종전 commitManualValue·confirmManualAnomaly의
   *  이중 구현을 흡수(순수 이동 — epoch/cancelTts는 호출부가 커밋 확정 시점에 이미 수행). */
  const proceedAfterCommit = useCallback(async (
    awaiting: AwaitingField | null,
    opts?: { echoValue?: string },
  ) => {
    // 🔴 v0.49 r3 #1(claude r2 크리티컬) — **행 완료 부기는 착지와 무관하다.** 아래 재무장/예약
    //   복귀 분기는 전부 `advance()`를 타지 않고 return하므로, 부기가 advance 안에만 있으면
    //   그 경로에서 통째로 빠진다(값 되돌림 — `finalizeRowCompletion` 헤더). 분기마다 배선하면
    //   **다음 착지가 추가될 때 또 빠진다** — A2가 착지를 하나 늘리자마자 정확히 그렇게 됐다.
    //   그래서 분기 앞 **진입점 한 곳**에서 한다. 좌표는 커밋된 셀의 행(`awaiting.row`)이지
    //   호출 시점의 activeRow가 아니다(교차행 정정은 둘이 갈린다). 부기는 멱등이라 아래
    //   폴스루가 advance로 가도 IDB 쓰기는 늘지 않는다.
    // 🔴 v0.49 r6 Y1 — 여기도 durable 실패면 착지 전체를 멈춘다. 아래 착지들은 「저장됐다」를
    //   전제로 갱신값을 재낭독하거나 다음 셀로 나가므로, 실패를 통과시키면 그 낭독이 곧
    //   성공 고지가 된다(C-FIX2가 수동 커밋에서 세운 「실패면 영수증·에코·진행 전부 억제」와 동일).
    if (awaiting && !(await finalizeRowCompletion(awaiting.row))) {
      notifyRowPersistFailed(awaiting.row);
      return;
    }
    if (awaiting?.kind === 'reviewWait') {
      await enterReviewWait(awaiting.row);
      return;
    }
    // 🔴 v0.49 fix49b(max 리뷰 #7) — **셀 검토 대기도 재무장한다**(행 검토와 같은 계약, 스코프만
    //   셀). 사용자가 「이전」/「다음」으로 **의도적으로 이동해 들어온** 검토 문맥인데, 그 문맥이
    //   초대한 정정(키패드 재커밋·보류 해소)이 문맥 자체를 파괴하고 advance로 튀어 나가면
    //   검토가 성립하지 않는다. 음성 「수정 <값>」은 이미 cellWait으로 복귀한다(fix49 오라클 ⑤) —
    //   같은 상태·같은 목적의 조작이 입력 수단에 따라 갈리지 않게 한다.
    //   `enterCellWait`이 갱신값을 낭독하므로 echo는 넘기지 않는다(행 검토 분기와 동일 이유).
    if (awaiting?.kind === 'cellWait') {
      const col = getColById(awaiting.colId);
      const v = useSessionStore.getState().getRowValues(awaiting.row)[awaiting.colId] ?? '';
      if (col && v !== '') { await enterCellWait(col, v); return; }
    }
    // 🔴 v0.49 r2 A2 — **예약된 복귀는 여기 한 곳에서 판정한다.** 종전엔 알람 해소(:trendResolve)와
    //   커밋 종단(:handleFinal 말미)이 각자 `resumeReviewOf`를 읽고 직접 `advance()`를 불렀다 —
    //   가드레일 [NAV-FILLED-CELL-1]이 *"정본은 proceedAfterCommit이며 그 kind 분기를 우회해 직접
    //   advance()를 부르지 마라"* 고 못박은 바로 그 형태다(그래서 셀 축 예약이 추가됐을 때 두 곳
    //   모두에서 새로 빠뜨릴 수 있었다). 두 호출부가 이 함수를 부르게 하고 판정을 여기 모은다.
    if (awaiting) {
      const cell = resumeCellOf(awaiting);
      if (cell) {
        const col = getColById(cell.colId);
        const v = useSessionStore.getState().getRowValues(cell.row)[cell.colId] ?? '';
        if (col && v !== '') {
          // `enterCellWait`은 좌표를 받지 않고 `sess.activeRow`를 읽는다 — 이 진입로는 예약
          //   좌표로 들어오므로 커서를 **명시로** 세운다(호출 시점 커서가 맞다는 우연에 기대지 않는다).
          const idx = voiceColsList().findIndex((c) => c.id === cell.colId);
          useSessionStore.getState().setActiveRow(cell.row);
          if (idx >= 0) useSessionStore.getState().setActiveCol(idx);
          await enterCellWait(col, v);
          return;
        }
      }
      const resumeRow = resumeReviewOf(awaiting);
      if (resumeRow != null) { await enterReviewWait(resumeRow); return; }
    }
    awaitingFieldRef.current = null;
    if (opts?.echoValue != null) await say(formatForTts(opts.echoValue));
    await advance();
  }, [advance, enterCellWait, enterReviewWait, finalizeRowCompletion, notifyRowPersistFailed, say]);

  // ── v0.7.0 B4: 추세 검증 ───────────────────────────────────
  /** trend_skip 텔레메트리 — 같은 원인은 세션당 1회만 기록(셀마다 반복돼 로그를 도배하지 않게).
   *  Set은 start()에서 리셋된다. */
  const logTrendSkip = useCallback((cause: string, row: number, colId: string) => {
    if (trendSkipLoggedRef.current.has(cause)) return;
    trendSkipLoggedRef.current.add(cause);
    logCell({ type: 'trend', extra: `trend_skip:${cause}`, row, colId });
  }, []);

  /** 🔴 v0.49 r3 #6(claude r2 MEDIUM) — **값 거절의 단일 종단.**
   *
   *  거절은 한 벌의 신호다: 화면 큐(`ReaskCue` 사유) + 부정 비프 + 사유 TTS(§2 쌍 상수).
   *  그런데 거절 분기는 **6개**이고(컬럼명 일치 · KNOWN_NOISE · bare 응답어 · 단음절 동음이의 ·
   *  저신뢰 · 파싱 실패) B2는 그중 **뒤 2개만** 배선했다. 앞 4개는 무비프에다 W2 개정 **이전의**
   *  인라인 리터럴("{항목} 다시 말씀해 주세요.")을 그대로 읽고 있었다 — 같은 사건이 어느 분기로
   *  들어오느냐에 따라 소리도 문구도 갈렸고(§2 「구조적 분리는 쌍 상수로만」 위반), `beep_play:
   *  kind=reject` 집계는 실제 거절의 1/3만 셌다.
   *
   *  ⚠️ **분기마다 배선하지 않는다.** 파싱 실패 분기의 자기 주석이 이미 *"분기마다 배선하면 다음
   *  분기가 추가될 때 조용히 빠진다(이 파일이 반복해 겪은 드리프트)"* 라고 적어 놨는데, 그 경고가
   *  **분기 안**에만 적혀 있어서 형제 4개가 그대로 빠져 있었다. 종단을 하나로 만든다.
   *
   *  분기별로 다른 것(로그 타입 · 클립 재시작 여부 · `recognized` 정리)은 **호출부에 남긴다** —
   *  그건 거절 표면이 아니라 각 분기의 고유 계약이다. */
  const armRejectCue = useCallback((reason: 'low_confidence' | 'parse_failed') => {
    useSessionStore.getState().setReaskReason(reason);
    // TTS **이전에** 낸다 — 커밋 확인음이 세운 「신호음 → 말」 순서 계약과 같다(민구 지정).
    playBeep('reject');
  }, []);

  /** 거절 종단 — 표면 + 사유 TTS.
   *
   *  🔴 v0.49 r4 M3(claude r3 #3) — **소수부 타깃 재질문 문맥을 이 종단이 직접 안다.**
   *  종전엔 「소수 문맥이면 전용 문구」를 각 분기가 알아서 처리했고, r3 #6이 신규 편입한 두 분기
   *  (컬럼명 일치 · KNOWN_NOISE)가 그 처리를 빠뜨렸다. 그러면 이렇게 된다:
   *    ① `armRejectCue`의 `setReaskReason`이 `reaskDecimalWhole`을 **함께 지운다**(store 계약) →
   *       화면 큐가 「111 점, 소수점 아래…」에서 일반 사유로 바뀐다.
   *    ② TTS도 일반 사유만 읽는다.
   *    ③ 그런데 `awaiting.fractionWhole`은 **살아 있다**(분기가 awaiting을 안 건드리고 return).
   *    👉 사용자는 소수 문맥이 끝난 줄 아는데 다음 '오'는 `111.5`로 합성된다 — **무고지 커밋**.
   *  게다가 KNOWN_NOISE는 `startClip()`을 무조건 불러 [CLIP-DECIMAL-FRAG-1](소수 재질문 중
   *  클립 재시작 금지 — 원본 전체발화 버퍼 폐기)까지 어겼다.
   *
   *  ⚠️ **분기마다 배선하지 않는다** — #6이 세운 그 교훈이 정확히 여기서 또 깨졌다. 재검증 중
   *  리뷰가 지목하지 않은 **세 번째 구멍**을 찾았다: 저신뢰 거절(`stt_rejected_low_confidence`)도
   *  소수 문맥에서 도달 가능하고 같은 두 결함을 그대로 갖고 있었다. 그래서 문맥 판정을 종단이
   *  소유하고, 분기는 「클립을 다시 시작할 것인가」만 옵션으로 넘긴다(그건 분기 고유 계약이다 —
   *  단, 소수 문맥에서는 종단이 그 요청을 **무시**한다. 그게 [CLIP-DECIMAL-FRAG-1]이다).
   *  오라클: tests/v049-r4-m3-reject-fraction.spec.ts */
  const rejectValue = useCallback(async (
    reason: 'low_confidence' | 'parse_failed',
    awaiting?: AwaitingField | null,
    // 🔴 v0.49 r5 Z5(codex R4-F3) — `tail`은 **소수 문맥이 아닐 때만** 쓰는 꼬리 문구다.
    //   저신뢰 **명령** 거절은 값 거절과 꼬리가 달라야 한다("사유"가 아니라 "다시 말씀해 주세요") —
    //   명령이 안 들린 것이지 값이 파싱 안 된 게 아니기 때문이다. 그 차이 때문에 그 분기가 이
    //   종단을 통째로 우회했고, 우회한 김에 **소수 문맥 처리까지 손으로 다시 적어** 화면과 다른
    //   TTS를 말했다(R4-F3). 꼬리만 인자로 받으면 문맥 처리는 종단이 계속 소유한다.
    //   ⚠️ `whole`은 **새로 여는** 소수 문맥의 정수부다(`awaiting`엔 아직 안 실려 있다).
    //     기존 문맥은 종전대로 `awaiting`에서 읽는다 — 두 입구가 같은 꼬리로 수렴한다.
    opts?: { restartClip?: boolean; tail?: string; whole?: string },
  ) => {
    armRejectCue(reason);
    const whole = opts?.whole ?? (awaiting ? fractionWholeOf(awaiting) : null);
    if (whole != null) {
      // [CLIP-DECIMAL-FRAG-1] — 클립 재시작 금지(호출부 요청 무시). 정수부를 다시 실어 화면 큐가
      //   TTS와 같은 문구를 유지한다(확정표 #3 「현행 유지」 — 문구는 사유와 무관하게 하나다).
      useSessionStore.getState().setDecimalReason(String(whole), reason);
      await say(decimalReaskPrompt(whole));
      return;
    }
    if (opts?.restartClip) recorderRef.current?.startClip();
    await say(opts?.tail ?? REASK_TTS[reason]);
  }, [armRejectCue, say]);

  /**
   * 🔴 v0.49 r5 Z6(claude #6) — **재청취 안내의 소수 문맥 판정 한 곳.**
   *
   * `'수정'`(재수정)과 `'취소'`는 **거절이 아니다** — 접수된 명령이고 앱이 같은 칸을 다시 듣는다.
   * 그래서 `rejectValue`(비프 + 거절 큐)를 타지 않는다. 하지만 「살아 있는 소수부 재질문 문맥에서는
   * 문구도 클립도 그 문맥을 따른다」는 **같은 계약**을 진다. 두 곳이 그걸 각자 안 지키고 있었다:
   *
   *   ① **표면 모순** — 화면은 「111 점, 소수점 아래」인데(문맥이 살아 있으므로 큐가 그대로 떠
   *      있다) 귀에는 `측정항목01 다시 말씀해 주세요.`가 들렸다. 사용자가 전체값을 말해야 하는지
   *      소수부만 말해야 하는지 알 수 없다(PRINCIPLES §2 — R4-F3와 같은 형태). 그리고 전체값을
   *      말하면 `awaiting.fractionWhole`이 살아 있어 합성 규칙과 충돌한다.
   *   ② **[CLIP-DECIMAL-FRAG-1] 위반** — `armClipForCell`이 슬롯을 재시작하면 직전 원본 전체발화
   *      버퍼가 폐기돼 커밋 클립에 조각만 남는다. 소수 재질문은 조각 발화만 유도하므로 그 슬롯은
   *      **계속 녹음**해야 한다(그 계약의 본문).
   *
   * ⚠️ 소수 문맥이 아니면 종전 그대로다 — 슬롯 재무장은 [CLIP-VAL-1]①이 세운 계약이고
   *   (`say()`는 `announceField`와 달리 클립을 시작하지 않는다), 문구는 §2 쌍 상수다.
   * 오라클: tests/v049-r5-z6-relisten-context.spec.ts
   */
  const relistenInContext = useCallback(async (a: AwaitingField): Promise<void> => {
    const whole = fractionWholeOf(a);
    if (whole != null) {
      // 화면 큐는 이미 이 문구를 그리고 있다(아무도 지우지 않았다) — 다시 세우지 않고 맞춘다.
      await say(decimalReaskPrompt(whole));
      return;
    }
    armClipForCell(a.row, a.colId);
    await say(relistenPrompt(a.name));
  }, [armClipForCell, say]);

  /** 방금 커밋된 값의 이상치 알람 검사(v0.8.0). 전역 마스터 토글 제거 — 컬럼에 방향 규칙
   *  (trendRule) 또는 변동률 % 임계값(pctThreshold)이 하나라도 있으면 활성. 규칙 없는 컬럼은
   *  검사 자체가 없고(로그 없음), 판정 불가(인덱스 없음·키 불완전·직전 회차/과거값 없음)는
   *  조용히 skip + trend_skip 1회(telemetry 키 'trend'/trend_skip 유지 — 로그 연속성).
   *  여기서는 절대 fetch하지 않는다 — start()의 프리페치가 채운 캐시(getCachedIndex)만 본다
   *  (행 단위 재fetch 금지, B2 설계). */
  const evaluateTrend = useCallback(
    (col: Column | null, row: number, colId: string, nextRaw: string): TrendViolation | null => {
      const columns = getSessionColumns();
      return evaluateTrendForRow({
        col,
        columns,
        // 현재 행의 전체 값(자동·고정·음성) — persistSession과 같은 composeRowValues 합성.
        // thunk로 넘겨 인덱스/키 검사 통과 시에만 계산(종전 순서 보존).
        composeRow: () => composeRowValues(columns, row),
        // 로컬 날짜(UTC 아님) — start()에서 세션당 1회 계산(핫패스 호이스팅), ref 빈 경우만 지연 계산.
        today: sessionTodayRef.current || localTodayISO(),
        nextRaw,
        onSkip: (cause) => logTrendSkip(cause, row, colId),
        // 폴백 사용 계측(세션당 1회 — trend_skip과 동일 dedupe 컨벤션). age_h = 비교선 나이.
        onStaleIndex: (ageH) => {
          if (trendSkipLoggedRef.current.has('used_stale_index')) return;
          trendSkipLoggedRef.current.add('used_stale_index');
          logCell({
            type: 'trend', extra: `trend_used_stale_index:age_h=${ageH}`,
            row, colId,
          });
        },
      });
    },
    [logTrendSkip],
  );

  /** v0.12.0 AREA2 V2 — 이상치 팝업에 곁들일 식별정보(샘플키 + 직전 회차 ISO 날짜)를 재계산한다.
   *  evaluateTrend와 같은 캐시(getCachedIndex)·키 합성을 쓰되 TrendViolation 타입은 순수하게 유지
   *  한다(trendCheck.ts 오염 금지 — 표시용 부가정보는 여기서 별도 산출). 캐시 없음·키 불완전이면
   *  해당 필드를 undefined로 둔다(팝업이 '행 N' 폴백 + 날짜 라벨 생략으로 안전 처리). */
  const getAnomalyAlertData = useCallback(
    (row: number): { sampleKey?: string; prevDate?: string } => {
      const columns = getSessionColumns();
      return anomalyAlertContext({
        columns,
        composeRow: () => composeRowValues(columns, row),
        today: sessionTodayRef.current || localTodayISO(),
      });
    },
    [],
  );

  // ── modify (cross-row) ─────────────────────────────────────
  const enterModifyMode = useCallback(async (
    preExtractedValue?: string,
    pendingCmd?: PendingCommandClip | null,
    // v0.34.0 A3(확정 규칙 — 실기기 피드백): 완료 행 "검토 대기"(reviewWait) 중의 '수정'은
    // **포인터(첫) 음성 필드**를 타깃하고, "수정 <컬럼명>"이면 그 컬럼을 타깃한다(handleFinal이
    // idx를 해석해 넘긴다). 직접값("수정 88.9") 적용 후에는 검토 대기(값 재낭독+대기)로 복귀한다.
    //
    // 🔴 v0.49 fix49 — `land`가 그 **복귀처**를 가른다. `'cell'`(기본 아님)은 셀 검토 대기
    //   (`cellWait`) 출신이라는 뜻이다: 항목 이동으로 값 있는 셀에 착지한 상태에서 '수정'이
    //   들어온 경우. 종전엔 이 상태에서 타깃이 `curIdx - 1`(직전 컬럼)로 잡혀 **엉뚱한 셀**을
    //   열거나(0번 항목이면 `targetIdx < 0` 분기로 떨어져 값을 지우고 재질문), 직접값
    //   "수정 41.4"가 **통째로 유실**됐다(실측 — _ASK-fix49 Q2, Larry 승인).
    reviewTarget?: { row: number; idx: number; land?: 'review' | 'cell' },
  ) => {
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const curRow = sess.activeRow;
    const curIdx = sess.activeColIdx;
    const endSentinel = awaitingFieldRef.current?.kind === 'atEnd'
      ? awaitingFieldRef.current
      : null;
    const endTargetIdx = endSentinel
      ? vc.findIndex((c) => c.id === endSentinel.colId)
      : -1;

    // Find previous voice col (could be in previous row)
    let targetRow = endSentinel?.row ?? curRow;
    // [MODIFY-TARGET-1] 마지막 행 완료 뒤 bare "수정"은 "직전 인덱스"가 아니라 atEnd 센티넬이
    // 이미 가리키는 마지막 컬럼을 다시 연다. 센티넬 불일치 시에만 기존 직전-컬럼 규칙으로 폴백.
    let targetIdx = endTargetIdx >= 0 ? endTargetIdx : curIdx - 1;
    if (reviewTarget) {
      targetRow = reviewTarget.row;
      targetIdx = reviewTarget.idx;
    } else if (targetIdx < 0) {
      if (curRow <= 1) {
        // No previous — treat as redo current. Save the utterance against the awaiting cell.
        pendingCmd?.saveDefault();
        sess.setRowValue(curRow, vc[curIdx].id, '');
        sess.setRecognized('');
        await announceField(vc[curIdx]);
        return;
      }
      targetRow = curRow - 1;
      targetIdx = vc.length - 1;
    }

    // Pre-extracted value? Apply directly.
    const target = vc[targetIdx];
    if (preExtractedValue) {
      const parsed = parseValueForCol(target, preExtractedValue);
      if (parsed !== null) {
        // #3 error-vs-intent: capture pre-modify value before overwrite (direct "수정 <값>" path).
        const prevDirectValue = sess.getRowValues(targetRow)[target.id];
        sess.setRowValue(targetRow, target.id, parsed);
        // D1(2026-06-08): 수정한 셀의 음성 클립/재생버튼이 사라지는 문제 수정.
        // Direct modify는 새 값 클립을 재녹음하지 않지만, 직전 캡처한 수정 발화("수정 82.7" — 곧
        // 새 값을 담은 음성)를 저장해 둔다. 이전처럼 셀 포인터를 비우면(재생버튼 소멸) 대신, 그
        // 수정 발화 클립을 셀에 재연결한다 → 재생버튼 유지 + 재생 내용이 새 값과 일치.
        // v0.6.0 CLIP-CMD: cmd 클립을 **수정 대상 셀**(targetRow:target.id) 키로 저장·재연결한다.
        // 종경(c8) 안내 중 횡경(c7)을 direct_modify했을 때 cmd 클립이 c8 키로 만들어져 c7 포인터가
        // orphan되던 문제(명령 발화 컬럼≠수정 대상 컬럼)를 차단. saveFor가 그 cmdKey를 돌려준다.
        const cmdKey = pendingCmd?.saveFor(targetRow, target.id) ?? null;
        // (1) pendingClipsRef: archive 이전 시도 → 수정 발화 클립으로 포인터 재연결(없으면 unlink)
        const pendingMap = pendingClipsRef.current[targetRow];
        if (pendingMap && pendingMap[target.id]) {
          archiveCellClip(targetRow, target.id);
          if (cmdKey) pendingMap[target.id] = cmdKey;
          else delete pendingMap[target.id];
        }
        // (2) 이미 persistSession으로 dataStore에 들어간 경우 — archive 후 동일하게 재연결
        const existing = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
        const existingRow = existing?.rows.find((r) => r.index === targetRow);
        if (existing && existingRow?.audioClips?.[target.id]) {
          archiveCellClip(targetRow, target.id);
          const { [target.id]: _removed, ...restClips } = existingRow.audioClips;
          const nextClips = cmdKey ? { ...restClips, [target.id]: cmdKey } : restClips;
          // F3: direct-modify of an already-synced row must demote it synced→dirty so the next
          // sync UPDATEs its sheet row in place (this path upserts directly + re-links the clip
          // pointer, so it can't go through patchRowValues — apply the invariant inline).
          const valueChanged = (existingRow.values[target.id] ?? '') !== (parsed ?? '');
          const nextSyncState =
            existingRow.syncState === 'synced' && valueChanged ? 'dirty' : existingRow.syncState;
          const updatedRow: SessionRow = {
            ...existingRow,
            values: { ...existingRow.values, [target.id]: parsed },
            audioClips: Object.keys(nextClips).length > 0 ? nextClips : undefined,
            ...(nextSyncState !== undefined ? { syncState: nextSyncState } : {}),
          };
          const nextRows = existing.rows.map((r) => (r.index === targetRow ? updatedRow : r));
          const updatedSession = {
            ...existing,
            rows: nextRows,
            syncedRows: recountSynced(nextRows),
          };
          useDataStore.getState().upsertSession(updatedSession);
          void saveSession(updatedSession).catch(() => {});
        } else {
          // If the cell had no clip pointer to hang the update on, make sure the new value is
          // (re)persisted. persistSession preserves sheetRow/syncState and demotes synced→dirty
          // on change.
          // 🔴 v0.47.0-r3(이중 콜드 리뷰 08-09, codex f1) — 종전 조건(targetRow < curRow ||
          //   reviewTarget)은 **현재 행의 무클립 셀**(수동으로 입력한 셀이 정확히 이 조합)을
          //   건너뛰어 두 저장 갈래 모두 persist 0회였다. 그 뒤 아래 P1 알람 분기가 무기한 응답
          //   대기로 들어가므로, 알람/다음 필드 대기 중 reload가 오면 값이 유실됐다(행이 아직
          //   IDB에 없던 경우 행 통째 미영속 — 실측). 값이 서는 모든 커밋은 persist를 동반한다.
          //   오라클: tests/v0470-r2-p1-direct-modify-trend.spec.ts 「P1-persist」.
          void persistSession();
        }
        // #3 error-vs-intent: log the direct-modify commit with previousValue → parsed.
        // extra:'direct_modify' marks the inline-value path (no re-record), distinct from the
        // cascade path's value event which carries previousValue via awaiting.previousValue.
        logCell({
          type: 'value',
          row: targetRow,
          colId: target.id,
          colName: target.name,
          text: preExtractedValue,
          parsed,
          extra: 'direct_modify',
          ...(prevDirectValue != null ? { previousValue: prevDirectValue } : {}),
        });
        sess.setRecognized(parsed);
        sess.pushValueBurst(target.name, parsed, target.id); // I-3: 중앙 버스트 + 칩 V(UI③)
        useSessionCommitMarks.getState().add(targetRow, target.id); // W4 — 직접 수정도 성공 커밋

        // ── 🔴 v0.47.0-r2 P1(FB-A · 민구 실기기 08-09) — **직접 수정도 추세 평가를 받는다** ──
        //   종전엔 이 경로만 evaluateTrend를 부르지 않았다: 일반 커밋 경로와 수동 커밋 경로만
        //   검사해서, 음성 「수정 <값>」으로 들어온 값은 아무리 이상해도 조용히 섰다.
        //   실측(08-09 세션 +84.5초): row4 횡경 117→77 direct_modify, 직전 회차 111.1 대비
        //   -30.9%로 설정(decrease·10%)을 넘겼는데 **trend 이벤트 0건**. 민구 제보 *"지금 값
        //   알람 조건에 맞을거야. 근데 알람 발생이 없어"* 의 실체가 이 누락이다.
        //   조립·발화·무장은 일반 커밋 경로와 **같은 부품**을 쓴다(buildAnomalyAlert가 SSOT).
        const directViolation = evaluateTrend(target, targetRow, target.id, parsed);
        if (directViolation) {
          const alertExtra = getAnomalyAlertData(targetRow);
          const { alertText, logExtra, alert } = buildAnomalyAlert({
            col: target, v: directViolation, colName: target.name,
            next: formatForTts(parsed), row: targetRow,
            sampleKey: alertExtra.sampleKey, prevDate: alertExtra.prevDate,
          });
          // ⚠️ value 이벤트는 **바로 위에서 이미** 남겼다(extra:'direct_modify') — 여기서는 trend만
          //   추가한다. 그래서 이 경로만 value→trend 순이다(일반 경로는 trend→value). 순서에
          //   의존하는 파서·스펙이 없음을 확인하고 택했다 — value를 여기서 또 남기면 direct_modify
          //   커밋이 로그에서 2건으로 세어져 분석 모수가 오염된다. confidence는 이 경로에 존재하지
          //   않는 값이라(직접값은 명령 발화에서 추출된다) 싣지 않는다.
          logCell({
            type: 'trend', extra: logExtra,
            row: targetRow, colId: target.id, colName: target.name,
            text: preExtractedValue, parsed, previousValue: String(directViolation.prev),
          });
          // P5(FB-F) 주의 — 위 add는 **그대로 둔다.** 알람 중 ✓는 지우는 게 아니라 **붉게**
          //   물든다(민구 재정의 08-09). 색은 anomalyAlert에서 파생되므로 여기 배선이 없다 —
          //   정본은 useVoiceCommitMark.ts 헤더.
          // 응답 대기 무장 — 좌표는 **수정 대상 셀**이다(안내 중이던 셀이 아니다).
          //   '확인'/'유지'는 확정·진행, 새 값 발화는 수정 의미론으로 재커밋(재위반 시 재알림).
          awaitingFieldRef.current = {
            kind: 'trendConfirm',
            row: targetRow, colId: target.id, name: target.name,
            previousValue: parsed,
            // 검토 대기 출신이면 해소 후 착지는 advance가 아니라 **검토 대기 재진입**이다
            //   (아래 일반 복귀 계약을 알람 경유에서도 지킨다 — resumeReviewOf 주석 참조).
            // 🔴 v0.49 r2 A2(codex F1 = 합집합 C3) — **셀 출신도 예약한다.** 종전 이 자리의 주석은
            //   *"land:'cell'은 의도적으로 예약하지 않는다 — 해소 뒤 advance()의 착지처는 반드시
            //   빈 칸이라 B-1 조합이 아니다"* 라고 적혀 있었다. 값 손상 축으로는 맞는 말이었지만
            //   계약 축에서 틀렸다: 가드레일 [NAV-FILLED-CELL-1]은 *"cellWait에서의 모든 탈출은
            //   cellWait 재진입"* 을 불변식으로 세웠고, 사용자가 **의도적으로 이동해 들어온** 검토
            //   문맥이 알람 '확인' 한 마디로 증발하는 것 자체가 위반이다. 「오라클 없는 분기가
            //   는다」는 우려는 분기를 안 만드는 대신 **오라클을 만들어** 답한다
            //   (tests/v049-r2-a2-cellwait-resume.spec.ts ②). 두 예약은 동시에 서지 않는다.
            ...(reviewTarget?.land === 'cell'
              ? { resumeCell: { row: targetRow, colId: target.id } }
              : reviewTarget ? { resumeReview: targetRow } : {}),
          };
          // 응답 발화 녹음 슬롯 재무장 — cmdModify의 preserveCommandClip이 활성 클립을 이미
          //   **멈춰** 놨다([CLIP-VAL-1]① 와 같은 사유). 무장하지 않으면 알람에 새 값으로 답한
          //   발화가 통째로 녹음되지 않는다. 「확인」으로 답하면 클립 저장이 일어나지 않으므로
          //   (명령 경로) 위에서 cmdKey로 재연결해 둔 D1 재생 포인터는 그대로 산다.
          armClipForCell(targetRow, target.id);
          // 🔑 해소 후 「원위치 복귀」 — 캐스케이드 재녹음 경로와 **같은 계약**이다(그쪽 주석:
          //   *"No returnRow — advance() naturally proceeds from targetIdx forward"*).
          //   포인터를 수정 대상 셀에 세워 두면 해소 시 advance()가 채워진 칸을 건너뛰며 전진해
          //   원래 대기하던 필드에 그대로 착지한다(별도 복귀 로직 불필요).
          //   부수 효과가 오히려 목적에 맞는다: 알람이 떠 있는 동안 칩존의 **활성 칩이 알람 난
          //   셀**이 되어 일반 음성 알람과 화면이 같아진다(P5가 그 칩의 ✓를 다루므로 중요).
          //   행이 다르면 자연 진행만으로는 원래 행으로 못 돌아오니 복귀 예약을 세운다.
          // 🔴 v0.47.0-r3(이중 콜드 리뷰 08-09, codex f3) — 종전 「이미 걸린 예약은 덮지 않는다」
          //   조건은 바깥 예약을 지키는 대신 **안쪽 출발점을 버렸다**: '이전' 등으로 이미 예약이
          //   걸린 상태에서 교차행 직접수정 알람이 뜨면, 확인 후 advance가 바깥 예약을 소비해
          //   출발 행을 건너뛰었다(값 오귀속 위험). 이제 **위에 쌓는다**(pushReturn) — 안쪽 복귀가
          //   먼저(알람 대상 행 완료 시), 바깥 예약은 그 행 완료가 소비한다(LIFO, advance 소비부의
          //   스택 일반화 주석 참조). 오라클: 같은 스펙 「P1-중첩복귀」.
          if (targetRow !== curRow) {
            sess.pushReturn(curRow, curIdx);
          }
          sess.setActiveRow(targetRow);
          sess.setActiveCol(targetIdx);
          sess.setPhase('active');
          useSessionStore.getState().setAnomalyAlert({
            ...alert, colId: target.id, awaitingResponse: true,
          });
          playBeep('alert');
          useSessionStore.getState().setLastTts(alertText);
          // 🔑 위반이면 **에코 대신 알림 TTS** — 일반 커밋 경로가 명문화한 계약 그대로다.
          //   커밋 확인음 playBeep('commit')도 내지 않는다(아래 W2 분기를 타지 않는다):
          //   「저장됐다」와 「이상하다」가 한 순간에 겹치면 두 신호가 섞여 구분이 안 된다.
          // 🔴 v0.48.1 U1(리뷰 F1/HIGH, claude+codex 독립일치) — barge-in 가드 기준점. 이 함수
          //   (`enterModifyMode`)는 epochRef를 스스로 건드리지 않으므로, 여기서 캡처한 값은
          //   `await say(alertText)` 진행 중 사용자가 응답(확인/새 값)하면 그 처리(`handleFinal`의
          //   cmd 게이트:1889 또는 값 재커밋:2263)에서 반드시 bump된다 — RACE-1과 동일 기전.
          const myEpoch = epochRef.current;
          // 🔴 v0.48.1 r3 U1 4절 — 이 함수는 epoch를 bump하지 않고 **읽기만** 하므로, 이전에
          //   전혀 다른(무관한) TTS 도중 기록된 `bargeInEpochRef`가 우연히 같은 epoch 값으로
          //   남아 있으면 이번 alertText가 실제로는 끊기지 않았는데도 4절이 거짓으로 걸린다
          //   (claude 재검증 후 발견 — 피해는 인식값 에코 1회 생략뿐, 데이터 영향 없음이지만
          //   교정). 여기서 지워 "이 alertText 재생 중"으로만 좁힌다.
          bargeInEpochRef.current = -1;
          const started = await say(alertText);
          // v0.48.0 P4(NEW-3, 민구 제보 08-10) — 「수정 NN」도 음성 인식값이라 같은 처방을 받는다
          // (P4 계획은 일반 값-커밋 알람 경로만 적었지만, 이 경로도 STT 추출값이라 "소리만으론
          // 오인식 판별 불가"가 똑같이 적용된다 — 구현 중 발견해 범위에 포함, wlog로 보고).
          // alertText/logExtra는 불변 — 별도 두 번째 발화로 분리(§4 바이트 계약 회피, 아래 일반
          // 경로와 동일 근거).
          // 🔴 U1 가드 — `await say(alertText)`의 resolve는 발화 종료를 뜻하지 않는다. `cancel()`도
          //   `onend`를 쏘므로(barge-in이 :353·:1990 부근에서 건다) 응답 처리 중인 다른 frame이
          //   먼저 이 프라미스를 조기 해제할 수 있다(review-claude.md F1 — 재진입 게이트 없음을
          //   `handleFinal` 정의부로 확인). 세 절 각각 다른 구멍을 막는다: `epoch` 불변 = cmd/값
          //   barge-in(같은 셀 재위반 포함, :2263이 값 재커밋마다 bump); `kind==='trendConfirm'` =
          //   터치 종료 버튼의 `stop()`(`awaitingFieldRef.current=null`, epoch는 안 건드림, :3341);
          //   `anomalyAlert?.awaitingResponse` = `clearAnomalyAlert` 경유 해소. 셋 다 참이어야
          //   「아직 같은 알람이 대기 중」이 성립 — 그때만 지나간 값이 아니다.
          // U2(codex medium) — `started`가 false면 1차 발화가 watchdog(2.5s)으로 스킵된 것이라
          //   2차도 생략한다(직렬 대기가 5초로 배증하는 것 방지). `started`-but-no-onend 잔여는
          //   위 `say()` 주석 참조(실기기 관측 항목, 이번 라운드 범위 밖).
          // 🔴 v0.48.1 r3 U1 4절(리뷰 F1 잔여, claude+codex 재검증 일치) — 위 세 절은 **final**이
          //   먼저 도착해 상태를 바꾼 경우만 잡는다. 실제로는 interim이 먼저 TTS를 끊고(barge-in,
          //   speech.ts:353) final은 그보다 수백ms~수초 늦게 온다 — 그 사이엔 epoch도
          //   awaitingFieldRef도 anomalyAlert도 안 바뀌어 위 세 절이 전부 그대로 참이다. 4절이
          //   그 구멍을 막는다: `bargeInEpochRef`는 handleInterim이 "지금 이 epoch에서 뮤트 중에
          //   비어있지 않은 interim이 들어왔다"를 관찰한 순간 기록한다(위 handleInterim 참조).
          //   isTtsMuted()를 **여기서(await 이후)** 다시 읽는 처방ⓐ 원안은 쓰지 않았다 — done()이
          //   resolve 직전에 unmuteForTts()부터 무조건 돌려서, barge-in 여부와 무관하게 이 시점엔
          //   항상 false로 읽힌다(speech.ts의 done() 참조 — 반증 가능).
          if (
            started
            && epochRef.current === myEpoch
            && awaitingFieldRef.current?.kind === 'trendConfirm'
            && useSessionStore.getState().anomalyAlert?.awaitingResponse
            && bargeInEpochRef.current !== myEpoch
          ) {
            // 🟡 v0.48.1 r3(codex 재검증 잔여) — `interrupt:false`로 50ms cancel-대기 자체를
            //   없애는 안을 검토했으나 **철회**했다: "겹쳐 재생될 다른 발화가 없다"는 전제가
            //   1차가 정상 종료(onend/onerror)한 경우에만 성립한다. ④ TODO의 잔여
            //   (`started`=true인데 onend/onerror 둘 다 소실 → watchdog이 대신 resolve)에서는
            //   `done()`이 `cancel()`을 부르지 않으므로(위 `say()` 선언부 TODO 참조) 브라우저
            //   utterance가 여전히 살아있는 채로 여기 도달할 수 있다 — 그 상태에서
            //   `interrupt:false`면 2차가 **큐잉**돼(자연 종료를 무기한 기다림) 뮤트 구간이
            //   그만큼 늘어난다. 정확히 C-FIX4·`isManualHoldBlocked`가 경계했던 "큐잉이 뮤트
            //   해제 창을 연다" 부류이고, WP-1(워치독 10s→2.5s)이 줄이려던 바로 그 마비다. 이
            //   전제를 지키려면 1차가 "정상 종료했는지"를 알아야 하는데, 그건 ④와 같은
            //   `speech.ts` 완료상태 enum 없이는 판별 불가 — 그래서 50ms 창은 고치지 않고 ④
            //   TODO에 합류시킨다(interrupt:true 유지가 지금은 더 안전).
            await say(`인식값 ${alert.next}`);
          }
          // F5(low, claude) — lastTts는 갱신하지 않는다: alertText가 triad(화면==TTS==로그) SSOT라
          //   2차 발화까지 반영하면 화면의 "마지막 안내"와 로그 text=가 어긋난다(의도된 선택).
          return;
        }

        // 🔴 v0.49 r3 #1 — 이 경로의 세 착지(셀 검토 복귀 · 행 검토 복귀 · 원위치 재안내)도
        //   `advance()`·`proceedAfterCommit` 어느 쪽도 타지 않으므로 부기를 여기서 한다.
        //   🔴 v0.49 r4 M10(codex r3 F9 재검증) — **이 자리의 종전 서술을 정정한다.** 종전엔
        //   *"문제는 캐스케이드 재기록 중에 들어온 직접 수정이다('수정' → 값 대신 '수정 66.6')"*
        //   라고 적혀 있었는데, **그 상태는 도달하지 않는다**: bare '수정' 뒤 상태는 `kind:'modify'`고
        //   `cmdModify`의 `isModifyLike` 분기(:117)가 «이미 수정 의미론이면 같은 셀 재질문»으로
        //   먼저 가로채 직접값을 버린다(r4 실측 — 칩이 `—` 그대로).
        //   더 좁히면 이 줄은 **현재 모든 음성 도달 상태에서 no-op**이다:
        //     · 직접 수정의 타깃은 언제나 커서 **앞** 칸이거나 `cellWait`/센티넬이 가리키는
        //       **이미 값이 있는** 칸이라, 그 쓰기가 행의 완성 여부를 바꾸지 못한다.
        //     · 백업은 캐스케이드가 `markRowIncomplete`와 **함께** 세우므로, 백업이 서 있는 동안
        //       `finalizeRowCompletion`은 `isRowVoiceComplete` 가드에서 즉시 return한다.
        //   그래도 **지우지 않는다.** #1의 근인이 「부기 소유자가 한 곳뿐이라 새 착지가 추가될 때
        //   조용히 빠진다」였고, 이 배선은 그 재발을 막는 방어선이다(부기는 멱등이라 비용도 없다).
        //   반증은 소스 계약으로 잠갔다: tests/v049-r3-01-resume-persist.spec.ts [node] ①c.
        //   알람 분기(위 `return`)는 여기 오지 않는다: 미확인 알람 중에 X/N을 올리면 화면이
        //   확정을 먼저 말한다(해소 후 proceedAfterCommit이 부기한다).
        //   ⚠️ v0.49 r6 Y1 — 형제 셋과 달리 여기만 `void`다. 위 서술대로 이 줄은 **현재 모든 음성
        //     도달 상태에서 no-op**(가드에서 즉시 `true`)이라 고지할 실패가 없고, 그럼에도 흐름을
        //     끊는 라우팅을 걸면 「방어선」이 도달 불가 분기에서 사용자 흐름을 막는 위험만 남는다.
        //     이 줄이 실제로 부기를 하게 되는 착지가 생기면 그때 형제와 같이 배선한다.
        void finalizeRowCompletion(targetRow);
        // v0.47.0 W2 — 직접 수정("수정 88.9")도 성공 커밋이다: 화음 → 에코 순서 계약(WP-E).
        //   종전엔 이 경로만 무음이었다(재청취 경로의 성공음과 비대칭 — 값이 저장되는 모든
        //   커밋에 확인음이 난다는 WP-E 원칙에 합류).
        playBeep('commit');
        await say(`수정 ${target.name} ${formatForTts(parsed)}`);
        // v0.33.0 — 검토 대기 출신 직접 수정: 값 수신 재안내 대신 검토 대기로 복귀
        // (수정 반영값 재낭독 + 대기 — bare 값 덮어쓰기 금지 계약 유지).
        // 🔴 v0.49 fix49 — 셀 검토 대기 출신은 **셀 단위**로 복귀한다. 아래 일반 복귀
        //   (`announceField(vc[curIdx])`)로 떨어지면 방금 값을 채운 그 셀에 `kind:'value'`가
        //   **다시** 열린다 — B-1과 완전히 같은 구멍이라 같은 계약으로 닫는다(오라클 ⑤).
        if (reviewTarget) {
          if (reviewTarget.land === 'cell') {
            sess.setActiveRow(targetRow);
            sess.setActiveCol(targetIdx);
            await enterCellWait(target, parsed);
            return;
          }
          await enterReviewWait(targetRow);
          return;
        }
        // Return immediately to where we were
        sess.setActiveRow(curRow);
        sess.setActiveCol(curIdx);
        if (vc[curIdx]) await announceField(vc[curIdx]);
        return;
      }
    }

    // Cascade re-record path (no usable inline value): target/targetRow are already resolved above
    // (the cell the user is about to re-answer) and don't change for the rest of this correction.
    // v0.28.0 [CLIP-CORRECTION-1] fix: this used to call saveDefault(), which files the '수정'
    // command clip under the AWAITING cell (the field that was about to be prompted when '수정' was
    // said) — a DIFFERENT column from the one being corrected. clips-manifest/audit then can't find
    // "what triggered this correction" under the corrected column (Sonar 2026-07-06 desktop repro,
    // sonar-a4-direct2.js: cmd clip landed on c9 while the correction target was c8). Re-key it to
    // the target cell instead, mirroring the direct-modify path above (L690) — same invariant
    // (command clip lives under the cell it corrects), just without the pointer re-link (the
    // target's own value clip is re-recorded fresh under its bare key below, so no relink needed).
    pendingCmd?.saveFor(targetRow, target.id);

    // Snapshot the existing row before clearing in-memory. persistSession() includes this backup
    // if stop() fires before re-completion. If persistSession fire-and-forget hasn't flushed yet
    // (row in sessionStore.completedRows but not yet in useDataStore), build from live store.
    {
      const existingForBackup = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
      const persistedRow = existingForBackup?.rows.find((r) => r.index === targetRow);
      if (persistedRow) {
        correctionBackupRef.current = persistedRow;
      } else if (sess.isRowComplete(targetRow)) {
        const columns = getSessionColumns();
        const bAuto = buildCyclingValues(columns, targetRow);
        const bFixed = autoNonCyclingValues(columns, targetRow);
        correctionBackupRef.current = {
          index: targetRow,
          values: { ...bFixed, ...bAuto, ...sess.getRowValues(targetRow) },
          complete: true,
        };
      } else {
        correctionBackupRef.current = null;
      }
    }

    // #3 error-vs-intent: snapshot the target cell's current value BEFORE the cascade clear,
    // so the eventual re-commit can log previousValue → finalValue for misrecognition analysis.
    const prevTargetValue = sess.getRowValues(targetRow)[target.id];

    // Cascade clear in-memory only: target col through end of row (so user re-records all remaining cols).
    // Persisted IDB/dataStore state is left intact until the row is successfully re-completed and
    // persistSession() overwrites it — this ensures old measurements survive a crash/reload during correction.
    //
    // 🔴 v0.49 fix49b(max 리뷰 #4) — **셀 검토 대기 출신은 그 셀 하나만 다시 받는다.**
    //   캐스케이드는 «행 전체 검토»(reviewWait)의 계약이다: 그 행은 이미 다 채워졌고 사용자가
    //   처음부터 다시 부르겠다고 선언한 상태다. 진행 중인 행의 **한 칸에 주차해** '수정'이라고
    //   말한 사용자는 그 칸만 다시 부를 생각인데, 종전 범위(targetIdx→행 끝)는 바꾸겠다고 한
    //   적 없는 뒤 칸의 확정값까지 지웠다(중단되면 그대로 유실).
    //   같은 상태의 직접값 경로("수정 41.4", :1249 분기)는 이미 **그 셀만** 고친다 — 한 상태에서
    //   같은 명령의 두 형태가 파괴성으로 갈리면 안 된다. 여기서 대칭을 맞춘다.
    const clearEnd = reviewTarget?.land === 'cell' ? targetIdx + 1 : vc.length;
    for (let i = targetIdx; i < clearEnd; i++) {
      sess.setRowValue(targetRow, vc[i].id, '');
      // Clip preservation (was: delete pending clips). Archive the prior attempt under an attempt
      // key so the misrecognised original audio survives, then unlink the pending pointer so the
      // re-record writes a fresh bare key. Already-persisted clips are left under their bare key —
      // persistSession() overwrites the cell value on re-completion, but the archived attempt(s)
      // keep the older audio for analysis.
      const pendingMap = pendingClipsRef.current[targetRow];
      if (pendingMap?.[vc[i].id]) {
        archiveCellClip(targetRow, vc[i].id);
        delete pendingMap[vc[i].id];
      }
    }
    sess.markRowIncomplete(targetRow);
    // No returnRow — advance() naturally proceeds from targetIdx forward
    sess.setActiveRow(targetRow);
    sess.setActiveCol(targetIdx);
    sess.setRecognized('');
    // v0.33.0 — 검토 대기(phase 'complete')에서 진입한 재녹음이 대기 라벨 히어로("명령 대기")를
    // 단 채 값을 기다리지 않도록 active로 전환(일반 경로는 이미 active — 무해).
    sess.setPhase('active');
    // 🔴 v0.49 r2 A2(codex F1 = 합집합 C3) — **출신을 재기록 대기에 실어 보낸다.** 종전엔 여기서
    //   `announceField`가 kind:'modify'로 재무장하며 cellWait provenance를 잃었고, 재발화 커밋
    //   종단은 행 예약(resumeReview)만 보고 `advance()`로 빠졌다 — 2단계 수정(「수정」 → 값)이
    //   가드레일 [NAV-FILLED-CELL-1]의 「모든 탈출은 cellWait 재진입」에서 유일하게 새던 구멍이다.
    //   (직접값 「수정 41.4」는 위 :1504 분기가 이미 cellWait으로 복귀한다 — 한 상태에서 같은
    //   명령의 두 형태가 착지처로 갈리면 안 된다는 것이 fix49b가 세운 대칭 계약이다.)
    await announceField(target, {
      isModify: true,
      previousValue: prevTargetValue,
      ...(reviewTarget?.land === 'cell' ? { resumeCell: { row: targetRow, colId: target.id } } : {}),
    });
    // v0.47.0-r2 P1 — evaluateTrend·getAnomalyAlertData·armClipForCell 추가. 세 콜백 모두 이
    //   useCallback보다 **위**에서 정의돼야 한다(dep 배열은 렌더 중 평가된다 — TDZ). 추세 헬퍼
    //   3종을 이 함수 위로 옮긴 선행 커밋이 그 전제를 만든다.
  }, [announceField, armClipForCell, enterCellWait, enterReviewWait, evaluateTrend, finalizeRowCompletion, getAnomalyAlertData, persistSession, say]);

  // ── public: jump to a specific row (auto-chip change / 행 이동 공용) ──────
  const jumpToRow = useCallback(
    async (targetRow: number, options?: { setReturn?: boolean; source?: 'voice' | 'touch' }) => {
      const sess = useSessionStore.getState();
      const vc = voiceColsList();
      const total = computeTotalRows(getSessionColumns());
      if (targetRow < 1 || targetRow > total) return;
      const cur = sess.activeRow;
      if (targetRow === cur) return;
      // 🔴 v0.49 r6 Y3(claude #3) — **행 이동 공유 코어에도 종료 가드를 건다.** Z2가 착지 넷을
      //   `armLanding`으로 모으며 stopping을 거절하게 했지만, 이 코어는 그 착지들의 **호출부**라
      //   가드 밖에 있었다: 거절은 착지에서 일어나고 그 **앞**의 `setReturn`·`setActiveRow`·
      //   `epoch` bump·`cancelTts`·행 낭독은 이미 다 실행된 뒤다. 종료 절차가 스냅샷을 뜨는
      //   동안 활성 행이 옮겨지면 `persistSession`의 `activeHasData` 판정이 다른 행을 본다.
      //   ⚠️ 형제 콜러 둘(`gotoAdjacentRow`:2117 · `goNextRow`)은 각자 이 가드를 갖고 있었고
      //     **공유 코어만 없었다** — 새 콜러(자동입력 칩 편집 → `computeRowFromAutoChange`)가
      //     그 사이로 들어온다. 가드를 콜러마다 복사하는 대신 코어에 둔다(Z2의 교훈).
      if (sess.phase === 'stopping') {
        logCell({ type: 'session', extra: `jump_refused:stopping:${cur}->${targetRow}` });
        return;
      }
      // v0.33.0 B-1 — 행 이동 attribution 오염 해소: 음성 '이전'/'다음' 경유 이동이 'touch:'로
      // 하드코딩되던 것을 source 파라미터화(pause/resume의 phase:<source> 패턴). extra 형태는
      // `<source>:<from>-><to>`로 유지해 기존 `touch:` 파서와 모양 호환.
      const source = options?.source ?? 'touch';
      logCell({ type: 'command', parsed: 'jump', extra: `${source}:${cur}->${targetRow}`, row: targetRow });
      if (options?.setReturn ?? true) sess.setReturn(cur, sess.activeColIdx);
      sess.setActiveRow(targetRow);
      cancelTts();
      // v5.2: bump epoch so in-flight handleFinal's advance() guard aborts
      epochRef.current++;
      // 🔴 v0.49 r6 Y3(claude #7) — bump **직후** 값을 잡아 둔다(`gotoAdjacentRow` 경계 :2146의
      //   패턴). 아래 두 착지는 `await announceRowDiff(...)` **뒤**에 무장하는데, 그 안내 중
      //   barge-in 명령이 들어오면 그 핸들러가 이미 커서와 대기 상태를 옮긴 뒤다 — 낡은 좌표로
      //   재무장하면 사용자가 귀로 들은 대상과 실제 커밋 대상이 갈린다(무음도 오류도 아닌
      //   **정상처럼 보이는 오귀속**). 경계 둘은 fix49b #6에서 이미 이 가드를 받았고 공유 코어만
      //   빠져 있었다.
      const startEpoch = epochRef.current;
      awaitingFieldRef.current = null;
      // v0.33.0 백로그 A(민구 결정 3) — 완료 행 착지: 첫 필드 재안내(값 수신) 대신 "값 읽어주기+대기".
      // (기존 함정: firstIncompleteColIdx 폴백 0 → 첫 필드 재안내 → bare 값이 첫 항목만 덮어쓴 뒤
      //  advance가 returnRow로 튕겨 복귀 — 2번째 이후 항목은 음성으로 접근 불가.)
      if (isRowVoiceComplete(targetRow, vc)) {
        await announceRowDiff(cur, targetRow);
        if (epochRef.current !== startEpoch) return;
        await enterReviewWait(targetRow);
        return;
      }
      const targetCol = firstIncompleteColIdx(targetRow, vc);
      sess.setActiveCol(targetCol);
      sess.setRecognized('');
      // 검토 대기/종료 대기(phase 'complete')에서 미완료 행으로 이동한 경우에만 값 수신 상태로 복귀
      // ('paused' 등 다른 phase는 건드리지 않는다 — 일시정지 해제는 resume()만의 소관).
      if (sess.phase === 'complete') sess.setPhase('active');
      await announceRowDiff(cur, targetRow);
      if (epochRef.current !== startEpoch) return;
      if (vc[targetCol]) await announceField(vc[targetCol]);
    },
    [announceField, announceRowDiff, enterReviewWait],
  );

  // ── public: move to the previous row (◀이전 버튼 + 음성 '이전' 공용 — v0.33.0 백로그 A 통일) ──
  // Review/edit semantics: jumpToRow(setReturn:true) so finishing the visited row returns the
  // flow to where the user was. (복귀 대상이 그 사이 완료되면 advance의 NAV-1 가드가 복귀를 차단.)
  // 완료 행 착지는 jumpToRow의 검토 대기(값 낭독 + 명령 대기)로 이어진다(민구 결정 3).
  // On a boundary we REPROMPT instead of silently stalling (REVIEW-4).
  const gotoAdjacentRow = useCallback(
    async (delta: -1, source: 'voice' | 'touch' = 'touch') => {
      const sess = useSessionStore.getState();
      if (sess.phase === 'stopping') return;
      // v0.34.0 리뷰 라운드2(Codex High) — manualHold 중엔 **모든 비해소 이동을 거부**한다.
      // STT만 막고 터치 이동을 열어두면 [확인]/[수정] 대기 중 [이전]을 눌러 미확인 이상치를
      // 우회할 수 있었다(announceField가 알람을 null로 지워 검증 절차 자체가 소멸).
      if (isManualHoldBlocked('prev')) return;
      const target = sess.activeRow + delta;
      cancelTts();
      if (target < 1) {
        epochRef.current++;
        // 🔴 v0.49 r5 Z2 — bump **직후** 값을 잡아 둔다(fix49b #6 패턴 — `gotoAdjacentField`
        //   경계 :2146의 복제). 이 분기는 `await say(...)` **뒤에** 재무장하는 지점이고,
        //   `advance()`는 그런 지점마다 재확인 가드를 둔다. F13/fix49가 이 두 경계를 만들 때
        //   bump만 복사하고 재확인을 빠뜨렸다(codex R4-F2가 지목한 세 경로 중 하나).
        const startEpoch = epochRef.current;
        const msg = '첫 행입니다.';
        useSessionStore.getState().setLastTts(msg);
        const vc = voiceColsList();
        await say(msg);
        // 🔴 경계 안내 중 barge-in이 들어오면 그 명령의 핸들러가 이미 커서와 대기 상태를 옮긴
        //   뒤다. 낡은 좌표로 재무장하면 사용자가 귀로 들은 대상과 실제 커밋 대상이 갈린다 —
        //   무음도 오류도 아닌 **정상처럼 보이는 오귀속**이라 시트에서만 뒤늦게 드러난다.
        //   ⚠️ 종료(stopping) 축은 이 가드가 **못 닫는다** — `stop()`은 epoch를 올리지 않는다.
        //     그쪽은 `armLanding`의 거절이 닫는다(그 헤더 참조). 두 축은 별개다.
        if (epochRef.current !== startEpoch) return;
        // v0.33.0 — 첫 행이 이미 완료면(검토 대기 중 '이전' 등) 값 수신 재안내 대신 검토 대기 재무장
        // (announceField는 bare 값 커밋을 열어 결정 3의 덮어쓰기 금지 계약을 깬다).
        if (isRowVoiceComplete(sess.activeRow, vc)) {
          await enterReviewWait(sess.activeRow);
          return;
        }
        // 🔴 v0.49 fix49(_ASK-fix49 Q1 — Larry 승인 08-12) — 행이 **미완료**여도 커서가 값 있는
        //   셀에 서 있을 수 있다. 그 조합은 F-1 이전엔 도달 불가였다(activeColIdx 기록자 전량이
        //   빈 칸/cascade clear된 칸만 가리켰다) — 항목 이동이 커서를 filled 셀에 **주차**시킬 수
        //   있게 되면서 이 낡은 줄이 B-1과 같은 문이 됐다. 실측 3발화로 재현·확인했다
        //   (35.1 → 「이전」 주차 → 1행에서 「이전행」 → 경계 → "99.9" → 셀이 99.9).
        const cur = vc[sess.activeColIdx];
        if (cur) await announceOrCellWait(cur);
        return;
      }
      await jumpToRow(target, { setReturn: true, source });
    },
    [announceOrCellWait, enterReviewWait, jumpToRow, say],
  );

  // ── v0.44.0 §C8 F13(민구 확정 08-02): '다음' = '이전'과 대칭인 **항상 +1 이동** ──────────
  // v0.5.0 NAV-1이 여기 두었던 「findNextIncompleteRow로 완료 행 건너뛰기」를 제거했다 —
  // 실기기 로그 실측(08-02)에서 '다음'의 jump delta가 +2·+4로 튀던 원인이 그 건너뛰기다.
  // (findNextIncompleteRow 자체는 advance()의 행 완료 자동 전진에 남아 있다 — F13의 대상 아님.)
  //
  // 🔴 NAV-1 무한루프 방지 계약의 **대체 = 「마지막 행에서 멈춤」**:
  //   · returnRow 미등록(setReturn(null))은 그대로다 — 완료 행 자동 복귀 경로 자체가 없다.
  //   · 전진은 항상 아래로 +1, 마지막 행에서는 이동 없이 재안내만 한다(무음 금지 REVIEW-4 —
  //     gotoAdjacentRow의 '첫 행입니다' REPROMPT와 대칭). wrap-around가 없으므로 완료 행
  //     재프롬프트 루프(NAV-1)는 여전히 구조적으로 불가능하다.
  //   · 완료 행 착지는 jumpToRow의 검토 대기(enterReviewWait — 값 낭독+명령 대기)가 받는다.
  //     값 수신 재프롬프트가 아니므로 NAV-1의 「완료 행 재프롬프트」도 부활하지 않는다.
  //   · 이 경계 멈춤이 구 [EXIT-REACH-1] 분기(완료 행 검토 중 '다음'의 announceEndReached 재발화
  //     방지)를 흡수한다: '다음'은 더 이상 announceEndReached를 부르지 않는다 — 끝 도달 전환은
  //     advance()(행 완료)와 종료 명령의 소관이다.
  // skip 개념(값 없이 지나간 행 = complete:false placeholder)은 유지 — **실제로 행을 떠날 때만**
  // 마킹한다(경계 멈춤은 이동이 아니므로 마킹하지 않는다).
  // 오라클: tests/v0440-c8-flow.spec.ts (jump delta 전 구간 ±1 · 경계 멈춤 · skip placeholder).
  const goNextRow = useCallback(async (source: 'voice' | 'touch' = 'touch') => {
    if (useSessionStore.getState().phase === 'stopping') return;
    // v0.34.0 리뷰 라운드2(Codex High) — manualHold 중 행 이동 거부(위 gotoAdjacentRow와 동일 근거:
    // [다음]으로 미확인 이상치를 남긴 채 다음 행으로 새어나가던 경로).
    if (isManualHoldBlocked('next')) return;
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const total = computeTotalRows(getSessionColumns());
    cancelTts();
    epochRef.current++; // in-flight advance/안내 체인 무효화 (RACE-1 패턴 유지)
    // 🔴 v0.49 r5 Z2 — bump 직후 값을 잡아 둔다(fix49b #6 패턴 :2146 복제). 아래 마지막 행
    //   경계가 `await say(...)` 뒤에 재무장하는 지점이다 — 근거는 `gotoAdjacentRow`의 첫 행
    //   경계에 붙인 같은 가드의 주석(두 경계는 대칭이므로 처리도 대칭이다).
    const startEpoch = epochRef.current;
    sess.setReturn(null, null);
    const row = sess.activeRow;
    if (row >= total) {
      // F13 — 마지막 행 경계: 멈춘다. 완료 행이면 검토 대기 재무장(값 재낭독), 미완료면 현재
      // 필드 재안내(둘 다 무음 금지). endReached 전환 없음 — 종료는 '종료' 명령/버튼만.
      logCell({
        type: 'command', parsed: 'nextRow', extra: rowMarked('row_last_stop', row, source),
        row,
      });
      const msg = '마지막 행입니다.';
      sess.setLastTts(msg);
      await say(msg);
      // 🔴 v0.49 r5 Z2 — 경계 안내 뒤 재확인(위 bump 지점 주석 참조). 종료(stopping) 축은
      //   `armLanding`이 닫는다 — `stop()`은 epoch를 올리지 않으므로 이 가드로는 못 닫는다.
      if (epochRef.current !== startEpoch) return;
      if (isRowVoiceComplete(row, vc)) {
        await enterReviewWait(row);
        return;
      }
      // 🔴 v0.49 fix49b(max 리뷰 #2) — 미완료 행이어도 **커서가 값 있는 칸에 서 있을 수 있다.**
      //   `gotoAdjacentRow`의 첫 행 경계(:1633)가 fix49에서 정확히 같은 이유로 전환됐다 —
      //   두 경계는 대칭이므로 처리도 대칭이어야 한다(한쪽만 고치면 '이전행'은 안전하고
      //   '다음행'은 값을 잃는, 사용자가 예측할 수 없는 비대칭이 남는다).
      const cur = vc[sess.activeColIdx];
      if (cur) await announceOrCellWait(cur);
      return;
    }
    if (!isRowVoiceComplete(row, vc)) {
      sess.markRowSkipped(row);
      logCell({
        type: 'command', parsed: 'nextRow', extra: rowMarked('row_skipped', row, source),
        row,
      });
      void persistSession(); // skip 즉시 영속화 — 데이터탭에 빈 행 placeholder가 바로 보이도록
    } else {
      // v0.33.0 B-3 — 완료 행에서의 '다음' 이동도 기록(이전엔 skip 시에만 로깅 → 이동 공백).
      logCell({
        type: 'command', parsed: 'nextRow', extra: rowMarked('row_complete', row, source),
        row,
      });
    }
    // 완료 행 착지는 jumpToRow가 검토 대기로, 미완료 행 착지는 첫 미완료 필드 안내로 처리한다.
    await jumpToRow(row + 1, { setReturn: false, source });
  }, [announceOrCellWait, enterReviewWait, jumpToRow, persistSession, say]);

  // ── 🔴 v0.49 F-1 (민구 결정 2026-08-12): 「이전」/「다음」 = **입력 항목 한 칸 이동** ─────────
  // 민구 원문: *"「이전」, 「다음」은 사용자가 입력 대상 항목들을 하나씩 이동하고, 「이전행」,
  // 「다음행」은 아예 입력행 자체를 이동했으면 좋겠어."*
  // 종전엔 이 두 단어가 **행 이동**이었다(v0.33.0 백로그 A) — 08-12 결정이 행 이동을
  // '이전행'/'다음행'으로 옮기고, 짧은 두 단어를 항목 이동에 재배정했다.
  //
  // 🔴 **대상 집합 = `voiceColsList()`(input==='voice')** — 민구 확정 08-12 *"건너뛰어도 돼"*.
  //   민구 원문의 "자동입력되지 않는 항목"을 문자대로 읽으면 `input!=='auto'`(voice+**touch**)지만,
  //   `activeColIdx`는 애초에 voiceColsList()의 인덱스이고(:441) touch 컬럼은 칩 인라인 편집이
  //   소유한다(`ActiveState.tsx:334-339`). STT가 채울 수 없는 컬럼(예: '비고' text)에 값 대기를
  //   **새로 만드는 대신 건너뛴다** — 민구가 현행 구조를 택했다.
  //
  // 🔴 **경계에서 행을 넘기지 않는다.** 의미 분리가 이 기능의 목적이므로 행 이동은
  //   '이전행'/'다음행' 전용이다. 무음 금지(REVIEW-4)라 경계에서도 짧은 안내 + 현재 필드
  //   재안내를 한다 — `gotoAdjacentRow`의 '첫 행입니다' 패턴과 대칭.
  //
  // 🔴 **검토 대기(reviewWait)·끝 도달(atEnd) 스코프에서도 이동한다**(v0.49 r2 W1 — 민구 08-13
  //   FB-1·FB-4). fix49는 이 두 스코프에서 이동을 **거부**했다(리뷰 M-1+M-2·B-1). 거부의 근거는
  //   「`announceField`가 `kind:'value'`를 열어 bare 값이 완료 셀을 덮는다」였는데, **그 근거는
  //   같은 fix49의 `enterCellWait`(:1001)이 이미 해소했다** — 값이 든 셀 착지는 announceField가
  //   아니라 cellWait(낭독 + bare 값 흡수 + 덮어쓰기 없음)으로 간다. 즉 거부는 **해소된 위험에
  //   대한 잔존 방어**였고, 실기기에서 그 대가만 남았다:
  //     실측 08-13 — `field_nav_blocked:reviewWait` ×6(09:36·09:38·09:54~55). '이전행'으로 완료 행에
  //     착지한 사용자가 「다음」으로 항목을 넘기려 할 때마다 "검토 중입니다"가 나왔다. 민구 원문:
  //     *"'다음' 선언 했으나 기대했던것과 다른 반응… 기대 반응은 칩 포커스가 횡경에서 종경으로
  //     이동하고 값을 안내해줬어야 함."* / *"'이전행'(정상동작) >> '다음'(비정상 동작)"*
  //   완료 행 셀은 값이 있으므로 실질 착지는 전량 `enterCellWait`이다 — 「종경 기록값 35.1.」.
  //   **덮어쓰기 금지 계약(v0.33.0 결정 3)은 그대로 산다**: 지키는 주체가 「스코프 거부」에서
  //   「착지 상태(cellWait)」로 바뀌었을 뿐이고, 후자가 셀 단위라 더 정확하다.
  //
  // 🔴 **스코프를 떠날 때 phase를 값 입력 국면으로 되돌린다**(`jumpToRow:1623`과 같은 패턴).
  //   reviewWait/atEnd는 `phase='complete'`로 앉아 있다(정적 대기 라벨·UI-c 완료 화면). 그 상태로
  //   cellWait에 착지하면 화면은 「조사 완료」인데 귀로는 셀을 검토하는 **시각·청각 불일치**가 된다
  //   (PRINCIPLES §2). `setPhase`가 'complete' 이탈 시 `endReached`를 함께 내리고
  //   (`sessionStore:264`), 종료 수단은 `endReachedOnce`가 세션 경계까지 붙잡는다(:177) —
  //   그래서 atEnd를 떠나도 '종료'/종료 버튼은 살아 있다.
  //
  // 🔴 **경계에서는 센티넬을 건드리지 않는다.** 이동이 없으므로 reviewWait/atEnd가 **그대로 살아
  //   있고**, 그게 곧 재무장이다. 여기서 `announceOrCellWait` 재안내를 부르면 그 센티넬을
  //   cellWait으로 덮어 스코프가 조용히 증발한다(완료 행 검토 중인데 행 검토 문맥이 사라진다).
  //   ⚠️ 안내 문구를 늘리지 마라 — [TTS-WATCHDOG-1]에서 **긴 발화일수록 절단률이 단조 증가**한다.
  //
  // 🔴 **미해결 국면에서는 이동하지 않는다**(v0.49 fix49 — 리뷰 M-1+M-2, 민구 확정 08-12
  //   「거부+안내」). 알람 응답 대기(`trendConfirm`)·수정 재청취(`modify`)·소수부 재질문
  //   (`fractionWhole` 보유)은 **답을 기다리는 상태**다. 이동은 그 문맥을 조용히 파기한다:
  //   알람은 확인 없이 사라지고(미확인 이상치 우회 = `isManualHoldBlocked`가 막던 바로 그 축),
  //   재질문은 정수부 문맥을 잃는다. 어휘 재배정으로 「다음」이 *한 칸 이동*이 되어 심리적
  //   비용이 낮아진 만큼 이 문은 훨씬 자주 열린다 — 그래서 게이트를 명시한다.
  //   ⚠️ 행 이동(`prevRow`/`nextRow`)은 **이 결정의 범위 밖**이다(민구 08-12) — 종전 의미 유지.
  //
  // 🔴 **값이 든 셀에 착지하면 `announceField`가 아니라 `enterCellWait`이다**(fix49 — 리뷰 B-1
  //   blocker). 인접 인덱스를 값 유무와 무관하게 쓰므로, 이 함수는 filled 셀에 `kind:'value'`를
  //   여는 **첫 경로**였다 — 확정·저장된 값이 뒤이은 bare 숫자로 조용히 덮인다(실측 재현:
  //   35.1 → 「이전」 → "99.9" → 셀이 99.9). 착지 셀 값 유무 판정은 `announceOrCellWait`이 SSOT다.
  //
  // **값은 건드리지 않는다** — 커서만 옮긴다(setRecognized('')는 화면의 인식 중 텍스트만 비운다).
  // 오라클: tests/v049-f1-field-nav.spec.ts(①~④⑦ 이동·경계 · ⑩ 검토 대기 이동 = W1)
  //   · tests/v049-fix49-phase-guard.spec.ts(미해결 국면 거부 — W1의 범위 밖, 불변)
  //   · tests/v049-fix49-cell-guard.spec.ts(filled 셀 착지 = cellWait, B-1)
  const gotoAdjacentField = useCallback(async (delta: -1 | 1) => {
    const sess = useSessionStore.getState();
    if (sess.phase === 'stopping') return;
    // manualHold 중 이동 거부 — gotoAdjacentRow/goNextRow와 동일 근거(미확인 이상치 우회 차단).
    if (isManualHoldBlocked(delta < 0 ? 'prev_field' : 'next_field')) return;

    const parsed = delta < 0 ? 'prevField' : 'nextField';
    const row = sess.activeRow;
    const awaiting = awaitingFieldRef.current;
    // 🔴 W1 — 검토/끝 도달 스코프 출신 이동. 커서 기준은 **`activeColIdx`(화면 활성 칩)**이지
    //   센티넬의 colId가 아니다: 민구 기대가 칩 기준으로 서술돼 있고(*"칩 포커스가 횡경에서
    //   종경으로 이동"*), reviewWait은 진입 시 `setActiveCol(0)`으로 둘을 이미 일치시킨다(:962).
    //   🔴 v0.49 r3 #2 — atEnd도 이제 **진입 시 커서를 센티넬 컬럼(마지막 음성 필드)에 주차**한다
    //   (`announceEndReached`). 종전 이 자리의 근거 *"atEnd는 커서를 옮기지 않으므로 화면 칩 =
    //   마지막 커밋 컬럼이고, 거기서 한 칸이 옳다"* 는 더 이상 사실이 아니다 — 그 「안 옮김」이
    //   두 커서를 만든 결함이었다. 결론(`activeColIdx` 기준)은 그대로다: 이제 두 축이 같은 값이라
    //   **정의상** 일치한다.
    const reviewScope = awaiting?.kind === 'reviewWait' || awaiting?.kind === 'atEnd'
      ? awaiting.kind
      : null;

    // 🔴 v0.49 fix49 — 미해결 국면 거부(위 헤더 주석). 국면을 로그에 남긴다.
    //   `trendConfirm`이 여기까지 **살아서** 도달하는 것은 `voiceFinalResolver`가 이 두 명령을
    //   `trendDemoted:false`로 통과시키기 때문이다(UI 명령과 같은 모양). 그 처리가 없으면
    //   dispatch **이전에** `clearAnomalyAlert('trend_dismissed')`가 이미 팝업을 닫아,
    //   여기서 거부해 봐야 알람은 사라진 뒤다 — 두 파일이 한 계약이다.
    const blockedPhase = awaiting?.kind === 'trendConfirm'
      ? 'trendConfirm'
      : awaiting?.kind === 'modify'
        ? 'modify'
        : (awaiting && fractionWholeOf(awaiting) != null) ? 'fractionWhole' : null;
    if (awaiting && blockedPhase) {
      cancelTts();
      epochRef.current++;
      logCell({
        type: 'command', parsed, extra: `field_nav_blocked:${blockedPhase}`,
        row, colId: awaiting.colId,
      });
      // 한 마디로 짧게 — H-2(긴 발화일수록 TTS 절단률 단조 증가). 어절 선두가 명령 단어와
      //   겹치지 않는다(detectCommand는 공백 제거 후 startsWith — "먼저…"로 시작하므로 안전).
      const msg = blockedPhase === 'trendConfirm'
        ? '먼저 알람을 확인하세요.'
        : '먼저 값을 말씀해 주세요.';
      sess.setLastTts(msg);
      await say(msg);
      return;
    }

    const vc = voiceColsList();
    const curIdx = sess.activeColIdx;
    const target = curIdx + delta;
    cancelTts();
    epochRef.current++; // in-flight 안내 체인 무효화 (RACE-1 패턴 유지)
    // 🔴 v0.49 fix49b(max 리뷰 #6) — bump **직후** 값을 잡아 둔다. 아래 경계 분기는 이 함수에서
    //   유일하게 `await say(...)` **뒤에** 재무장하는 지점이고, `advance()`는 그런 지점마다
    //   재확인 가드를 둔다(:1077·:1098·:1120). F-1이 이 함수를 만들 때 bump만 복사하고 그
    //   재확인을 빠뜨렸다.
    const startEpoch = epochRef.current;

    if (target < 0 || target >= vc.length) {
      const msg = delta < 0 ? '첫 항목입니다.' : '마지막 항목입니다.';
      logCell({
        type: 'command', parsed,
        // 스코프 꼬리는 PRINCIPLES §4 **승인된 예외 ②**다(v0.49 r2 A14 등재) — 접두·기존 필드
      //   불변 + 스코프 출신에만 조건부 꼬리. 소비자는 `$` 앵커로 읽지 않는다.
      extra: `field_nav_edge:${delta < 0 ? 'first' : 'last'}${reviewScope ? `:${reviewScope}` : ''}`,
        row,
      });
      sess.setLastTts(msg);
      await say(msg);
      // 🔴 경계 안내 중 barge-in이 들어오면 그 명령의 핸들러가 이미 **커서와 대기 상태를 옮긴**
      //   뒤다. 여기서 낡은 `curIdx`로 재무장하면 사용자가 귀로 들은 대상("수정. 종경.")과
      //   실제 커밋 대상이 갈린다 — 무음도 오류도 아닌 **정상처럼 보이는 오귀속**이라 시트에서만
      //   뒤늦게 드러난다. fix49의 H-2 드레인이 `cancelTts()` 시점에 이 `say()`를 즉시
      //   결말지어 주므로 낡은 체인은 **명령 처리 도중에** 깨어난다(창이 더 앞당겨졌다).
      if (epochRef.current !== startEpoch) return;
      // 🔴 W1 — 검토/끝 도달 스코프는 **여기서 끝낸다.** 커서를 옮기지 않았으니 센티넬이 그대로
      //   살아 있고(= 재무장), 재안내를 부르면 그 센티넬을 cellWait으로 덮어 스코프가 증발한다.
      if (reviewScope) {
        // Y6 — 이 분기는 재안내를 부르지 않고 끝내므로 `armLanding`의 큐 해제도 타지 않는다.
        //   거절 직후 항목 이동을 시도한 경계에서 사유 큐가 화면에 남는다(위 흡수 셋과 같은 축).
        sess.setReaskReason(null);
        return;
      }
      const cur = vc[curIdx];
      // 경계에서도 **재안내 대상이 filled 셀일 수 있다**(값 넣고 「이전」으로 되돌아온 뒤 「이전」).
      if (cur) await announceOrCellWait(cur);
      return;
    }

    logCell({
      type: 'command', parsed,
      // 꼬리 계약은 위 `field_nav_edge`와 같다(PRINCIPLES §4 승인된 예외 ②).
      extra: `field_nav:${curIdx}->${target}${reviewScope ? `:${reviewScope}` : ''}`,
      row,
    });
    // 🔴 W1 — 스코프 이탈: 값 입력 국면으로 되돌린다(위 헤더 주석 · `jumpToRow:1623`과 같은 줄).
    //   `setPhase`가 `endReached`를 함께 내리고, 종료 수단은 `endReachedOnce`가 지킨다.
    if (reviewScope && sess.phase === 'complete') sess.setPhase('active');
    sess.setActiveCol(target);
    sess.setRecognized('');
    await announceOrCellWait(vc[target]);
  }, [announceOrCellWait, say]);

  // ── v0.22.0 P0: 클립 레코더 스트림 소실 → micLost 게이트 ──────────────
  /** 빈/극소 클립이 났을 때의 처리. 이 콜백 자체에서는 **재-getUserMedia를 하지 않는다** —
   *  recoverStream은 destructive-first(살아있던 스트림을 먼저 stop·null 처리)이고 이 콜백은
   *  클립 저장 콜백(사용자 제스처 밖)에서 불리므로, iOS Safari가 getUserMedia를 NotAllowedError로
   *  거부해 멀쩡하던 스트림까지 죽인다 — 그게 바로 이번 P0 근인이다(clip_empty×41 폭주).
   *   - 스트림이 실제로 죽었으면(isStreamLost) micLost로 래치(once). v0.38.0은 별도 effect가 기존
   *     reconnectMic을 자동 1회만 호출하고, 실패 후에는 사용자 제스처에 맡긴다.
   *   - 스트림이 멀쩡하면(트랙 살아있음) **no-op**. 복구가 필요 없다 — 다음 startClip()이 살아있는
   *     스트림 위에 새 MediaRecorder를 만들어 자가 치유한다(transient 빈 클립의 자연 회복). */
  const maybeAutoRecoverOrLatch = useCallback((reason: string) => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.isStreamLost() && !micLostLatchedRef.current) {
      micLostLatchedRef.current = true;
      setMicLost(true);
      logCell({
        type: 'clip', extra: `mic_lost:${reason}`,
      });
    }
    // 스트림이 살아있으면 복구 금지(no-op) — 다음 클립이 자가 치유. recoverStream 진입은 오직
    // reconnectMic 한 곳(자동 1회/수동 공용)이다.
  }, []);

  /** v0.22.0 P0 → v0.38.0 #5 — 수동 버튼과 자동 1회 시도가 공유하는 유일한 복구 진입점.
   *  같은 Promise가 진행 중이면 그대로 반환해 recoverStream/getUserMedia 중복 진입을 막는다.
   *  recoverStream reason의 legacy 문자열은 기존 텔레메트리 바이트 계약 보존을 위해 유지한다. */
  const reconnectMic = useCallback((opts?: { userGesture?: boolean }): Promise<boolean> => {
    if (micReconnectInFlightRef.current) return micReconnectInFlightRef.current;
    const rec = recorderRef.current;
    logCell({ type: 'clip', extra: 'mic_reconnect_attempt' });
    if (!rec) {
      logCell({ type: 'clip', extra: 'mic_reconnect_no_recorder' });
      return Promise.resolve(false);
    }
    // 리뷰#1(Codex Medium) — 사용자 제스처는 iOS가 getUserMedia를 허용하는 유일한 창이라
    // 자동 시도가 남긴 쿨다운에 삼켜지면 안 된다. 자동 경로(opts 없음)는 종전대로 쿨다운을 지킨다.
    const attempt = rec.recoverStream('user_gesture', { bypassCooldown: opts?.userGesture === true }).then((ok) => {
      // 복구 중 pause/stop/resume이 레코더를 폐기·교체했으면 늦게 열린 스트림을 즉시 닫는다.
      // stale 인스턴스가 micLost를 풀거나 핫마이크로 남지 않게 하되 STT lifecycle에는 관여하지 않는다.
      if (ok && recorderRef.current !== rec) {
        rec.dispose();
        logCell({ type: 'clip', extra: 'mic_reconnect_failed' });
        return false;
      }
      if (ok) {
        micLostLatchedRef.current = false;
        setMicLost(false);
        logCell({ type: 'clip', extra: 'mic_reconnect_ok' });
      } else {
        logCell({ type: 'clip', extra: 'mic_reconnect_failed' });
      }
      return ok;
    });
    micReconnectInFlightRef.current = attempt;
    void attempt.then(() => {
      if (micReconnectInFlightRef.current === attempt) micReconnectInFlightRef.current = null;
    });
    return attempt;
  }, []);

  // v0.38.0 #5 — micLost 한 번의 연속 구간마다 자동 복구는 정확히 1회뿐이다. 실패 상태가 계속
  // 유지돼도 attempted ref가 effect 재실행을 차단하며, 성공/세션 리셋으로 micLost가 false가 된 뒤에만
  // 다음 사고를 위한 가드를 해제한다. STT 컨트롤러 시작/정지/재시작 판단에는 관여하지 않는다.
  // ⚠️ 이 effect는 사용자 제스처 밖이므로 iOS Safari가 getUserMedia를 거부할 수 있다. 그 경우
  // 자동 결과를 failed로 계측하고 수동 재연결 배너 폴백으로 수렴한다.
  useEffect(() => {
    if (!micLost) {
      micAutoReconnectAttemptedRef.current = false;
      setMicReconnectFallbackVisible(false);
      return;
    }
    if (micAutoReconnectAttemptedRef.current) return;
    micAutoReconnectAttemptedRef.current = true;
    setMicReconnectFallbackVisible(false);
    logCell({ type: 'clip', extra: micAutoReconnect('attempt') });
    let active = true;
    void reconnectMic().then((ok) => {
      logCell({ type: 'clip', extra: micAutoReconnect(ok ? 'ok' : 'failed') });
      if (active && !ok) setMicReconnectFallbackVisible(true);
    });
    return () => { active = false; };
  }, [micLost, reconnectMic]);

  /** v0.35.0 R3-FIX-1(리뷰 라운드3, Codex High·데이터무결성) — **복원 없이** suspend 래치만 해제한다.
   *  세션 경계(stop/start)에서 쓴다. resumeRecognitionForUi와 달리 인식기를 다시 만들지 않는다 —
   *  세션이 끝나는(또는 새로 시작하는) 시점이라 복원 대상 자체가 없기 때문.
   *
   *  왜 필요한가: 래치(uiSuspendRef.reasons)는 suspend→resume 쌍으로만 풀린다. 그런데 종료 확인
   *  다이얼로그의 **확인(confirm)** 경로는 resume 없이 곧장 stop()으로 간다(R2-FIX-2 배선: 취소만
   *  resume). stop()도 start()도 래치를 안 만졌으므로 래치가 **영구히 잔존**했다(집합에 소스가 남음).
   *  그러면 같은 입력탭에서 다음 세션을 시작한 뒤 수동입력·명령어 도움말·피드백·종료 모달을 열 때
   *  suspend가 이미-active로 **조기 반환**(집합 비우지 못함) → STT가 계속 살아 배경 발화가 값을
   *  커밋하거나 행을 이동시킬 수 있었다(데이터 무결성). */
  const clearUiSuspendLatch = useCallback((reason: string) => {
    const latch = uiSuspendRef.current;
    // 🔴 v0.43.0 #4 — 래치를 통째로 비우면 resume이 **조기 반환**한다(reasons에 소스가 없으니
    //   no-op). 그러면 백그라운드 안내 플래그를 소비할 주체가 사라져, 세션 경계를 넘어 살아남았다가
    //   **다음 세션의 첫 모달을 닫을 때 엉뚱하게 발화**한다. 래치와 같은 수명으로 묶는다.
    bgAnnouncePendingRef.current = false;
    if (latch.reasons.size === 0) return;
    // 세션 경계 — 남은 **모든** suspend 소스를 통째로 비운다(복원 없음). 중첩 소스가 있었으면
    //   was=a+b로 함께 남겨 어떤 소스들이 걸려 있었는지 로그로 판별한다(단일 소스는 종전과 동일).
    const prev = [...latch.reasons].join('+') || 'unknown';
    uiSuspendRef.current = { hadController: false, reasons: new Set<string>() };
    uiSuspendedClipRef.current = null;
    uiBlockedClipArmRef.current = null;
    // 기존 ui_resume/ui_suspend와 같은 command 레인 — 신규 이벤트 타입 무첨가(log-replay 호환).
    logCell({
      type: 'command',
      parsed: 'ui_suspend_cleared',
      extra: `${reason}:was=${prev ?? 'unknown'}`,
      row: useSessionStore.getState().activeRow,
    });
  }, []);

  /** @returns 두 사실을 **분리해서** 돌려준다. 하나의 boolean으로 겸하면 안 된다 —
   *  v0.43.0 리뷰(Codex 사소#1, 2026-07-31 수용)가 지적한 계측 의미 오염이 정확히 그것이었다.
   *
   *   - `latched`     빈 집합 → 비빈 집합 **전이를 이 호출이 수행했는가.** 래치 부기의 사실이다.
   *                   🔴 **복원 의무(1c)는 이 값에 걸어야 한다** — 시작 TTS 중 suspend가 들어오면
   *                   아직 인식기가 없어도(`sttStopped=false`) 뒤이은 `start()`가 가드에 막히며
   *                   `hadController`를 true로 승격시키고, resume이 **실제로 복원**한다.
   *                   여기서 예약을 세우지 않으면 그 복원이 조용해진다([TEST-CLIP-F-1] 계열).
   *   - `sttStopped`  **돌고 있던 인식기를 실제로 멈췄는가.** `bg_mic`의 `stt` 축이 이걸 쓴다.
   *                   종전에는 `latched`를 그대로 `stt=stopped`로 썼기 때문에, 세션이 아예 안 돌던
   *                   유휴 왕복까지 "STT를 중지했다"로 기록돼 실제 중지 횟수의 분자가 오염됐다. */
  const suspendRecognitionForUi = useCallback((reason = 'ui_modal'): { latched: boolean; sttStopped: boolean } => {
    const latch = uiSuspendRef.current;
    // 같은 소스 재진입 — 멱등(중복 add·중복 로그 방지)
    if (latch.reasons.has(reason)) return { latched: false, sttStopped: false };
    const wasActive = latch.reasons.size > 0;
    latch.reasons.add(reason);
    // 이미 다른 소스가 suspend 중이면(중첩) 집합에만 추가하고 실제 STT 상태는 건드리지 않는다.
    //   ui_suspend/ui_resume 로그는 **실제 STT 상태 전이**(빈집합↔비빈집합)에만 남겨(단일 소스 계약
    //   바이트 불변), 중첩 add/remove는 조용한 래치 부기다. hadController는 첫 suspend에서만 스냅샷하고,
    //   그 뒤 start()가 가드에 막히면 :2541이 true로 승격한다(v0.43.0 1c — 복원 의무 플래그).
    if (wasActive) return { latched: false, sttStopped: false };
    // 🔑 이 스냅샷이 곧 "돌고 있던 인식기를 실제로 멈췄는가"다 — 아래 `ctrlRef.current?.stop()`이
    //   실제로 무언가를 멈추는 경우와 정확히 일치한다. 그대로 `sttStopped`로 반환한다.
    latch.hadController = !!ctrlRef.current;
    const sttStopped = latch.hadController;
    logCell({
      type: 'command',
      parsed: 'ui_suspend',
      extra: reason,
      row: useSessionStore.getState().activeRow,
    });
    earlyCommitStableRef.current = null;
    lastInterimRef.current = null;
    // 리뷰 라운드1(Codex+Flash, 수용) — 모달 suspend 진입 시 미확정 interim 표시 정리. 인식기가
    // 멈추면 final이 안 와, 닫은 뒤 이전 발화가 현재 값처럼 남던 찌꺼기 차단(표시 전용, 계약 무해).
    useSessionStore.getState().setInterimValue(null);
    setActiveController(null);
    ctrlRef.current?.stop();
    ctrlRef.current = null;
    cancelTts();
    // [CLIP-WINDOW-1] STT와 독립인 MediaRecorder도 함께 끊는다. 반환 blob은 의도적으로 버려
    // 모달 전 조각이 가짜 셀 클립으로 저장되지 않게 하고, resume에서 새 창으로 다시 녹음한다.
    const activeClip = activeClipRef.current;
    if (activeClip) {
      uiSuspendedClipRef.current = activeClip;
      activeClipRef.current = null;
      void recorderRef.current?.stopClip().catch((error) => {
        logCell({
          type: 'error',
          extra: `clip_ui_suspend_stop_failed:${reason}:${String((error as Error)?.message ?? error)}`,
          row: activeClip.row,
          colId: activeClip.colId,
        });
      });
    }
    return { latched: true, sttStopped };
  }, []);

  // ── final result handler ───────────────────────────────────
  const handleFinal = useCallback(async (textArg: string, alts: string[], confidence: number) => {
    // v0.20.0 Phase 5 #4 — 반응속도(발화 확정→값 커밋) 측정 시작점. STT final이 handleFinal에
    // 진입한 순간을 찍어, 값 커밋 시점(아래 value 이벤트)까지의 경과ms를 commitLatencyMs로 동봉한다.
    // EOS 꼬리([STT-11], 브라우저 무음종료)와 달리 이건 **앱 파이프라인** 지연(파싱·추세검사·persist).
    const handleFinalAt = Date.now();
    // v0.45.0 WP-1④ — hidden 유지 구간의 final 도착 카운트(bg_keep의 finals 축 — 유지 실효 증거).
    if (bgKeepRef.current && document.visibilityState === 'hidden') bgKeepRef.current.finals += 1;
    // v0.36.0 FB#2(Vance) — final 진입 = interim 발화 종결. 미확정 표시값을 즉시 정리한다(확정 흐름이
    //   화면을 이어받으므로 흐린 임시값이 남지 않게). 순수 표시 정리 — 커밋/파싱/텔레메트리 무관.
    useSessionStore.getState().setInterimValue(null);
    // `text` is mutable so the redo-with-inline-value path (e.g. "다시 8.4") can rewrite the
    // effective utterance to just the value and fall through to the normal value-commit path.
    let text = textArg;
    // 판별 유니온 전환(v0.35.3): trendConfirm 해제 시 'modify'로 강등 재대입하므로 let.
    let awaiting = awaitingFieldRef.current;
    if (!awaiting) return;
    const cmd = detectCommand(text);

    // v0.34.0 리뷰(Codex High·agy Pro Critical 공통 지적 → 민구 결정 2026-07-14: **터치 전용**):
    // 수동입력 이상치 보류(manualHold) 팝업이 떠 있는 동안 STT 결과를 **전부 버린다**.
    //   근거: 팝업은 사용자가 손으로 넣은 값에 대해 [확인]/[수정] 터치를 기다리는 상태다. 이때
    //   현장 소음·혼잣말이 숫자로 파싱되면 같은 셀을 음성값으로 재커밋해(팝업이 가리키는 값과
    //   실제 행 값 불일치) 위반이 아니면 advance까지 돌아 **팝업이 사라지고 원본 수동값이 영구
    //   소실**된다(3모델 전원 지적). 수동입력은 이미 손 입력이라 음성 재커밋 편의의 가치보다
    //   데이터 무결성이 우선(민구 결정). 팝업의 '말로도 가능' 힌트도 함께 제거됐다
    //   (AnomalyAlertPopup — manualHold면 터치 버튼만 노출).
    //   해제는 confirmManualAnomaly/modifyManualAnomaly(터치)만 담당한다.
    //   (게이트 SSOT = isManualHoldBlocked — 터치 이동/일시정지도 같은 함수로 거부한다.)
    if (isManualHoldBlocked('stt')) return;

    // ── Stage 3-2 명령 핸들러(액션 해석 계층) — 종전 인라인 if-체인 본문의 순수 이동. ──
    // 경로 판정은 아래 resolveFinal(순수 결정표)이, 실행은 이 핸들러들이 담당한다.

    /** '종료' — skip된 빈 행이 있으면 1회 안내 후 종료(v0.5.0 요청3, 민구 결정 4와 대칭).
     *  아직 도달하지 않은 뒷 행은 '빈 행'으로 세지 않는다 — skip한 행만 대상. */
    async function cmdEnd(): Promise<void> {
      cancelTts();
      const vcEnd = voiceColsList();
      const skippedEmpty = useSessionStore.getState().skippedRows
        .filter((r) => !isRowVoiceComplete(r, vcEnd));
      if (skippedEmpty.length > 0) {
        const msg = `${formatRowList(skippedEmpty)}이 비어 있습니다. 데이터 탭에서 확인해 주세요.`;
        useSessionStore.getState().setLastTts(msg);
        await say(msg);
      }
      await stop(true);
    }

    /** '유지' — 값이 있으면 그대로 진행, 없으면 안내(v0.5.0 NAV-2 일반화, 무음 금지 [REVIEW-4]).
     *  값 커밋 경로를 안 타므로 announceField가 시작한 클립은 저장되지 않아 기존 클립이 보존된다. */
    async function cmdKeep(a: AwaitingField): Promise<void> {
      cancelTts();
      const curVal = useSessionStore.getState().getRowValues(a.row)[a.colId] ?? '';
      if (curVal !== '') {
        // 🔴 v0.49 r3 #7(claude r2 MEDIUM) — **살아 있는 복귀 예약은 '유지'가 파기하지 않는다.**
        //   가드레일 [NAV-FILLED-CELL-1]: *"정본은 `proceedAfterCommit`이며 그 kind 분기를 우회해
        //   직접 `advance()`를 부르지 마라."* 도달 경로는 알람 강등이다: 이상치 알람(trendConfirm +
        //   resumeCell)에서 '수정'이라고 답하면 `demoteTrendConfirm`이 **예약을 보존한 채** modify로
        //   내리는데, 그 셀은 아직 값을 들고 있다(재청취 중일 뿐 지워지지 않았다). 거기서 마음을
        //   바꿔 '유지'라고 하면 종전엔 곧장 `advance()`로 빠져 셀 검토 문맥이 증발했다.
        //   같은 상태에서 '확인'은 `trendResolve`(:2475)가 `proceedAfterCommit`으로 착지시킨다 —
        //   **같은 상태·같은 목적의 조작이 어휘에 따라 갈리면 안 된다**(fix49b가 세운 대칭).
        //   ⚠️ 예약이 **없는** 상태(cellWait·reviewWait·atEnd 등)의 '유지'는 종전대로 전진한다.
        //   가드레일이 열거한 네 경로는 전부 **정정**(그 셀을 고친다)이고, '유지'는 정정이 아니라
        //   「그대로 두고 넘어간다」다 — 그 의미를 바꾸는 것은 민구 확정이 필요한 별개 결정이라
        //   여기서 하지 않는다(산출물에 보고).
        if (resumeCellOf(a) != null || resumeReviewOf(a) != null) {
          await proceedAfterCommit(a);
          return;
        }
        await advance();
        return;
      }
      logCell({
        type: 'command', parsed: 'keep', extra: 'keep_no_value',
        row: a.row, colId: a.colId,
      });
      const msg = `유지할 값이 없습니다. ${a.name} 말씀해 주세요.`;
      useSessionStore.getState().setLastTts(msg);
      await say(msg);
    }

    /** 🔴 v0.49 fix49b(max 리뷰 #9) — **셀 검토 대기가 값을 요구하지 않는다는 것의 SSOT.**
     *
     *  이 상태는 bare 값을 **흡수**한다(덮어쓰기 금지 — B-1). 그런데 값 대기(`kind:'value'`)
     *  문맥에서 쓰던 재질문 문구("○○ 다시 말씀해 주세요")가 이 상태에서도 그대로 나갔다:
     *  앱이 값을 말하라고 시키고, 시킨 대로 하면 흡수가 "수정이라고 말하세요"로 되받는다 —
     *  서로를 부정하는 두 문장 사이에 음성 전용 사용자가 갇힌다.
     *  화면을 끄고 2~3m 떨어져 쓰는 사용자에게 TTS는 **유일한 조작 설명서**다(v0.47.0 V-FIX4).
     *
     *  흡수 안내(:2370)와 **같은 문구**를 쓴다 — 같은 상태에 두 이름을 주지 않는다.
     *  ⚠️ 늘리지 마라([TTS-WATCHDOG-1] 긴 발화일수록 절단률이 단조 증가). */
    const cellWaitPrompt = (name: string) => `${name} 기록값입니다. 수정이라고 말하세요.`;

    /** '확인'(추세 알림 밖) — 상태 변경 없이 짧은 재안내만(v0.7.0 B4, 무음 금지 REVIEW-4).
     *  trendConfirm 중의 '확인'은 resolveFinal이 trendResolve로 먼저 처리한다. */
    async function cmdConfirm(a: AwaitingField): Promise<void> {
      cancelTts();
      const msg = a.kind === 'cellWait'
        ? `확인할 알림이 없습니다. ${cellWaitPrompt(a.name)}`
        : `확인할 알림이 없습니다. ${a.name} 말씀해 주세요.`;
      useSessionStore.getState().setLastTts(msg);
      await say(msg);
    }

    /** '수정' — 명령 발화 클립을 보존한 뒤 수정 모드 진입. 이미 수정 의미론이면 같은 셀 재질문.
     *  reviewWait/atEnd에선 bare '수정'=포인터 컬럼, "수정 <컬럼명>"=지목 컬럼. */
    async function cmdModify(a: AwaitingField, utterance: string): Promise<void> {
      cancelTts();
      // Capture the '수정'/'정정' utterance itself (spoken into the awaiting cell's active clip)
      // before enterModifyMode starts a fresh clip. The SAVE is deferred: enterModifyMode resolves
      // the modify TARGET cell, and a direct "수정 <값>" re-keys the clip to that target so its
      // pointer isn't orphaned (CLIP-CMD). Background save — never blocks the voice flow.
      // 🔴 v0.49 r5 Z6(claude #6) — **소수 문맥에서는 활성 클립을 아예 건드리지 않는다.**
      //   `preserveCommandClip`은 첫 줄에서 `stopClip()`을 부른다. 소수 재질문 중이라면 그 슬롯이
      //   바로 [CLIP-DECIMAL-FRAG-1]이 「계속 녹음하라」고 못박은 원본 전체발화 버퍼다 — 여기서
      //   끊으면 커밋 클립이 조각만 담는다. 명령 발화(`'수정'`) 자체는 그 연속 녹음 **안에**
      //   남으므로 분석에서 사라지지 않는다(별도 `:cmd<n>` 키로 갈리지 않을 뿐이다).
      //   ⚠️ 순서 주의 — 판정을 `preserveCommandClip` **앞**에서 해야 한다(그 호출이 곧 stop이다).
      const relistenWhole = isModifyLike(a) ? fractionWholeOf(a) : undefined;
      const pendingCmd = relistenWhole != null ? null : preserveCommandClip(a.row, a.colId);
      if (isModifyLike(a)) {
        // No target re-link here (we're already re-listening for the value) — save against the
        // awaiting cell so the utterance still survives for analysis.
        pendingCmd?.saveDefault();
        // 🔴 v0.49 r4 M11 — 인라인 리터럴 → §2 쌍 상수. **거절이 아니다**: '수정'은 접수됐고 앱이
        //   같은 칸을 다시 듣는다. 그래서 `armRejectCue`(비프+거절 큐)를 붙이지 않는다 — 붙이면
        //   접수된 입력을 거절됐다고 고지하고 `beep_play:kind=reject` 집계까지 오염된다.
        // 🔴 v0.49 r5 Z6 — 문구·클립 규율은 `relistenInContext`가 소유한다(그 헤더 참조).
        //   소수 문맥이 **아닐 때만** 슬롯을 재무장한다([CLIP-VAL-1]①: `preserveCommandClip`이
        //   활성 클립을 STOP했으므로 재발화가 결정적으로 녹음되지 않던 결함). B4 trendConfirm이
        //   '수정'으로 해소된 착지도 이 경로다(trendConfirm은 수정 의미론을 겸장한다).
        await relistenInContext(a);
        return;
      }
      // 상호배타 순서 주의 — extractModifyValue는 '수정' 뒤 **임의 텍스트**를 값 후보로 돌려주므로
      // ("수정 종경" → '종경'), 완료 행 대기에서는 컬럼명 매치를 먼저 확인해야 한다(숫자 발화는
      // 컬럼명과 매치될 수 없어 "수정 30.7" 직접값 경로는 그대로 성립). reviewWait/atEnd 한정 —
      // 일반 수정 의미론(직전 필드·값 추출)은 불변. 직접값 적용 후엔 검토 대기 복귀(enterModifyMode).
      let modifyVal = extractModifyValue(utterance);
      let reviewTarget: { row: number; idx: number; land?: 'review' | 'cell' } | undefined;
      if (a.kind === 'reviewWait' || a.kind === 'atEnd' || a.kind === 'cellWait') {
        const vcRw = voiceColsList();
        let idx = Math.max(0, vcRw.findIndex((c) => c.id === a.colId));
        const named = extractModifyColumn(utterance, vcRw.map((c) => c.name));
        const namedIdx = named ? vcRw.findIndex((c) => c.name === named) : -1;
        // 🔴 v0.49 fix49 — 셀 검토 대기(cellWait)의 '수정'은 **그 셀**이 타깃이다. 기본 규칙
        //   (`curIdx - 1` = 직전 컬럼)에 맡기면 엉뚱한 셀을 열고, 0번 항목에서는 `targetIdx < 0`
        //   분기로 떨어져 값을 지운 뒤 재질문하며 직접값까지 버린다(실측 — _ASK-fix49 Q2).
        //   컬럼명 지목("수정 종경")은 reviewWait과 같은 규칙을 그대로 물려받는다.
        const land = a.kind === 'cellWait' ? 'cell' as const : 'review' as const;
        if (namedIdx >= 0) {
          idx = namedIdx;
          modifyVal = null; // 컬럼명 지목 — 값 후보('종경' 등 비숫자 잔여)로 오적용 금지
          reviewTarget = { row: a.row, idx, land };
        } else if (a.kind === 'reviewWait' || a.kind === 'cellWait') {
          reviewTarget = { row: a.row, idx, land };
        }
      }
      await enterModifyMode(modifyVal || undefined, pendingCmd, reviewTarget);
    }

    /** '취소' — 인식값을 지우고 같은 필드 재질문. [CLIP-VAL-1]① (cancel sibling): '수정'→'취소'
     *  체인 뒤 슬롯이 소비돼 있으므로 재발화 녹음 슬롯을 재무장한다(startClip은 멱등). */
    async function cmdCancel(a: AwaitingField): Promise<void> {
      cancelTts();
      useSessionStore.getState().setRecognized('');
      // 셀 검토 대기에는 **취소할 인식값이 없다**(값을 받는 상태가 아니다). 녹음 슬롯 재무장도
      //   의미가 없으므로 상태를 그대로 두고 판별 문구만 다시 말한다(#9 — 위 SSOT 주석).
      if (a.kind === 'cellWait') {
        const msg = cellWaitPrompt(a.name);
        useSessionStore.getState().setLastTts(msg);
        await say(msg);
        return;
      }
      // M11 — 같은 상수. '취소'도 접수된 명령이지 거절이 아니다(위 `cmdModify`와 같은 근거).
      // 🔴 v0.49 r5 Z6 — 문구·클립 규율은 `relistenInContext`가 소유한다. 여기는
      //   `preserveCommandClip`을 거치지 않으므로 소수 문맥의 활성 슬롯이 **살아 있고**,
      //   종전 무조건 `armClipForCell`이 그 원본 전체발화 버퍼를 폐기했다([CLIP-DECIMAL-FRAG-1]).
      await relistenInContext(a);
    }

    // ── 경로 판정(순수 결정표 — voiceFinalResolver, 특성화 spec 고정) ──
    const action = resolveFinal({
      cmd, confidence,
      paused: useSessionStore.getState().phase === 'paused',
      awaitingKind: awaiting.kind,
    });

    // While paused, accept only 'resume' and 'end' (v0.15.0 A5); ignore everything else.
    // resume = 멈춘 입력 재개. end = 멈춘 채로 입력 종료·저장(일시정지 카드가 '재시작'/'종료' 둘 다
    // 안내하므로 음성 '종료'도 paused에서 작동해야 한다 — 민구 요청).
    if (action.act === 'pausedResume') {
      epochRef.current++;
      cancelTts();
      await resumeRef.current('voice'); // v0.20.0 Phase 5 #3 — 음성 '재시작'으로 해제
      return;
    }
    if (action.act === 'pausedEnd') {
      epochRef.current++;
      cancelTts();
      await stop(true);
      return;
    }
    if (action.act === 'pausedIgnore') return;

    // v0.15.0 A6 — 스피커폰 모드 삭제. 모드로 게이트되던 TTS-중 명령차단(post-TTS 가드)을 함께
    // 제거했다(민구: 모드 ON시 barge-in 안 됨을 불편으로 지목 + Trace: 가드 1회만 발화, 제거 안전).
    // self-confirm 환각 위험은 v0.13.0 alertText "확인해주세요" 제거로 이미 구조적 해소됨. 이어폰
    // 기본 경로의 barge-in(명령 즉시 실행)은 원래대로 유지된다.

    // T-2 (low-confidence command bypassing the gate): 명령별 신뢰도 floor는 resolveFinal이
    // 레지스트리(SSOT)에서 판정한다 — 명령은 상태를 되감거나 파괴하므로 값 게이트보다 엄격한 바를
    // 넘어야 한다. confidence 0은 "미보고" 센티널로 통과(엔진별 미보고 대응). paused-resume은 위에서
    // 이미 처리됐고 의도적으로 비게이트(일시정지 탈출의 유일한 경로).
    if (action.act === 'rejectLowConfidence' && cmd) {
      logCell({
        type: 'command',
        text,
        parsed: cmd,
        confidence,
        row: awaiting.row,
        colId: awaiting.colId,
        extra: 'rejected_low_confidence',
      });
      useSessionStore.getState().setRecognized('');
      // 🔴 v0.49 r4 M11(민구 D2 08-13 · codex r3 F8) — **이건 거절이다.** r3 #6이 값 거절 여섯
      //   분기를 하나의 종단으로 모았는데, 그 인접 형제인 **저신뢰 명령 거절**만 남아 있었다:
      //   부정 비프도 화면 큐도 없고 `beep_play:kind=reject` 집계에도 안 잡힌다. 화면을 자주 못
      //   보는 사용자에게 「종료/수정/확인이 먹히지 않았다」를 알리는 채널이 통째로 없었다.
      //   ⚠️ 사유는 `low_confidence`다 — 명령이 안 들린 것이지 값이 파싱 안 된 게 아니다.
      // 🔴 v0.49 r5 Z5(codex R4-F3) — **공통 거절 종단으로 합류한다.** M11이 비프·큐는 복구했지만
      //   이 분기는 `rejectValue`를 부르지 않고 소수 문맥을 **손으로 다시 복원한 뒤** 꼬리 문구를
      //   말했다. 그래서 소수 재질문 중 저신뢰 명령이 들어오면 **화면과 귀가 갈렸다**:
      //   화면·`awaiting`은 「111 점, 소수점 아래」를 유지하고 다음 '오'도 111.5로 합성되는데,
      //   귀에는 `측정항목01 다시 말씀해 주세요.`가 들린다 — 사용자는 전체값을 말해야 하는지
      //   소수부만 말해야 하는지 알 수 없다(PRINCIPLES §2 화면·청각 동일성 위반).
      //   이제 문맥 판정은 종단이 소유하고 이 분기는 **꼬리만** 넘긴다.
      //   ⚠️ 꼬리가 값 거절과 다른 것은 계약이다 — 명령이 안 들린 것이지 값이 파싱 안 된 게
      //     아니다(#9 — 셀 검토 대기에서는 값을 요구하지 않는다: cellWaitPrompt SSOT).
      //     그리고 필드 프롬프트 전체를 재생하지 않는다(T-2가 보고한 ~10초 비용).
      //   ⚠️ 클립은 재시작하지 않는다(`restartClip` 미지정) — 명령 거절은 값 발화 슬롯의 주인이
      //     아니다. 종전 동작과 같다.
      // 🔴 v0.49 r6 Y5(claude #4 = codex R5-F3, 독립 일치) — **꼬리는 국면이 정한다.** Z5가 꼬리를
      //   인자로 뺐지만 값은 `cellWait`/그 외 **두 갈래**뿐이었고, 그 「그 외」에 값을 **받을 수
      //   없는** 두 국면이 들어 있었다. `atEnd`·`reviewWait`은 resolver가 일반 값을 전부 흡수하는
      //   **명령 전용** 상태다(voiceFinalResolver:79-83). 거기서 「{항목} 다시 말씀해 주세요」는
      //   실행 불가능한 지시다 — 실측(codex): 끝 도달에서 저신뢰 '종료' → 마지막 TTS가
      //   「횡경 다시 말씀해 주세요.」. 시킨 대로 값을 말하면 흡수 안내가 되받는다. 화면을 못 보는
      //   음성 전용 사용자는 그 사이에서 반복 실패 루프에 들어간다(cellWaitPrompt가 같은 이유로
      //   먼저 닫은 형태 — 그 헤더).
      //   · `reviewWait` → 흡수 안내와 **같은 조작 어휘**(`REVIEW_WAIT_COMMANDS_TTS` SSOT).
      //   · `atEnd` → **사유 단독**. 그 국면의 흡수 안내(`endReachedTts`)에는 조작 어휘가 없다 —
      //     W2가 「종료 수단은 상시 노출이라 매번 되풀이하지 않는다」로 꼬리를 삭제했기 때문이다.
      //     없는 어휘를 여기서 새로 만들면 확정표 밖 문구가 하나 더 생긴다(§2 쌍 상수 규율).
      await rejectValue('low_confidence', awaiting, {
        tail: awaiting.kind === 'cellWait'
          ? cellWaitPrompt(awaiting.name)
          : awaiting.kind === 'reviewWait'
            ? REVIEW_WAIT_COMMANDS_TTS
            : awaiting.kind === 'atEnd'
              ? undefined
              : relistenPrompt(awaiting.name),
      });
      return;
    }

    // Commands interrupt TTS immediately — bump epoch to invalidate in-flight advance/skip
    if (cmd) {
      epochRef.current++;
      logCell({
        type: 'command',
        text,
        parsed: cmd,
        confidence,
        row: awaiting.row,
        colId: awaiting.colId,
        extra: ctrlRef.current?.isTtsMuted() ? 'tts_was_speaking' : 'tts_silent',
      });
    }

    // ── v0.7.0 B4: 추세 확인 모드 해소 — 알림 TTS 직후의 첫 응답 ──
    // 커밋된 값은 이미 저장돼 있다(알림 ≠ 롤백). '확인'/'유지'는 그대로 확정·진행, 새 값 발화는
    // 아래 값 경로로 폴스루해 기존 수정 의미론으로 재커밋(재위반 시 재알림), 타 명령은 알림만
    // 해제하고 정상 dispatch된다.
    if (action.act === 'trendResolve' && cmd && awaiting.kind === 'trendConfirm') {
      cancelTts();
      clearAnomalyAlert('trend_resolve'); // 팝업 해제
      logCell({
        type: 'trend', extra: 'trend_alert_confirmed', parsed: cmd,
        row: awaiting.row, colId: awaiting.colId,
        ...(awaiting.previousValue != null ? { previousValue: awaiting.previousValue } : {}),
      });
      awaitingFieldRef.current = null;
      // P1 — 검토 대기 출신 직접 수정이 알람을 경유한 경우의 착지(resumeReviewOf 주석 참조).
      // 🔴 v0.49 r2 A2 — 착지 판정을 `proceedAfterCommit`에 넘긴다. 종전엔 여기서 행 예약만 읽고
      //   직접 `advance()`를 불러, **셀 검토 대기 출신 알람**이 '확인' 한 마디로 검토 문맥을
      //   잃었다(codex F1 = 합집합 C3 — 가드레일 [NAV-FILLED-CELL-1] 위반).
      await proceedAfterCommit(awaiting);
      return;
    }
    if (action.act === 'dispatch' && action.trendDemoted && awaiting.kind === 'trendConfirm') {
      clearAnomalyAlert('trend_dismissed'); // 타 명령으로 해제 → 팝업 닫음
      logCell({
        type: 'trend', extra: `trend_alert_dismissed:${cmd}`,
        row: awaiting.row, colId: awaiting.colId,
      });
      // 알림만 해제 — 수정 의미론(종전 isModify 겸장)으로 강등 후 아래 정상 명령 dispatch로 폴스루.
      awaiting = demoteTrendConfirm(awaiting);
      awaitingFieldRef.current = awaiting;
    }
    // action 'value'의 trendCorrection(새 값 폴스루)은 값 경로가 처리 — 커밋 지점에서
    // trend_alert_corrected 기록.

    if (action.act === 'dispatch') {
      // v0.38.0 리뷰#1 — UI 전용 명령은 목록을 여기 복붙하지 않고 voiceCommands의 SSOT로 판정한다
      // (같은 목록이 resolveFinal의 이상치 분기에도 필요하다 — 복붙된 판단이 이번 회차 결함의 뿌리).
      if (isVoiceUiCommand(action.cmd)) {
        // v0.46.0 WP-F — `screenOff`만 신호가 아니라 **전역 상태**로 간다. 나머지 UI 명령은
        //   특정 컴포넌트(조절판·도움말)를 여는 것이라 seq 신호가 맞지만, 검은 화면은 앱 최상위
        //   오버레이라 소비자가 없다. 🔑 그래도 `VOICE_UI_COMMAND_IDS`에 남겨두는 이유는 그 목록이
        //   「값·행·세션을 건드리지 않는가」의 판정이고(resolveFinal의 이상치 분기가 그걸 읽는다),
        //   dispatch 방식과는 다른 축이기 때문이다.
        if (action.cmd === 'screenOff') {
          useSessionStore.getState().setBlackout(true);
          logCell({ type: 'command', parsed: 'screen_off', extra: 'src:voice' });
          return;
        }
        setUiCommand({ id: action.cmd, seq: ++uiCommandSeqRef.current });
        return;
      }
      switch (action.cmd) {
        case 'end': await cmdEnd(); return;
        case 'pause':
          cancelTts();
          await pause('voice'); // v0.20.0 Phase 5 #3 — 음성 명령으로 일시정지
          return;
        case 'resume':
          cancelTts();
          await resumeRef.current('voice'); // v0.20.0 Phase 5 #3 — 음성 명령으로 재개
          return;
        // 🔴 v0.49 F-1(민구 결정 08-12) — 항목 이동. 짧은 두 단어가 여기로 재배정됐다.
        case 'prevField':
          await gotoAdjacentField(-1);
          return;
        case 'nextField':
          await gotoAdjacentField(1);
          return;
        case 'prevRow':
          // v0.33.0 백로그 A(민구 결정 1): 음성 **'이전행'**(v0.49 F-1 전에는 '이전') = ◀ 버튼과
          // 동일한 단순 행 이동(재입력 모드 폐지). **행 이동 로직 자체는 08-12에도 바뀌지 않았다 —
          // 어휘만 옮겨졌다.** 완료 행 착지는 jumpToRow가 "값 읽어주기 + 검토 대기"로 처리한다(결정 3).
          await gotoAdjacentRow(-1, 'voice');
          return;
        case 'nextRow':
          // v0.44.0 §C8 F13: **'다음행'**(v0.49 F-1 전에는 '다음')은 '이전행'과 대칭인 항상 +1 이동(goNextRow) —
          // 미완료 행은 skip(placeholder) 처리, returnRow 미등록, 마지막 행에서 멈춤
          // (NAV-1 무한루프 방지의 대체 계약 — goNextRow 본문 주석 참조).
          await goNextRow('voice');
          return;
        case 'keep': await cmdKeep(awaiting); return;
        case 'confirm': await cmdConfirm(awaiting); return;
        case 'modify': await cmdModify(awaiting, text); return;
        case 'cancel': await cmdCancel(awaiting); return;
      }
    }

    // Input-2 → barge-in (v0.4.3): TTS 재생 중 들어온 값을 폐기하지 않고, 재생 중 TTS를 끊고
    // 그대로 처리한다. 사용자가 안내 TTS를 끝까지 들을 필요 없이 즉시 다음 값을 말할 수 있게 함.
    // 기존엔 폐기(stt_blocked_tts_muted) 후 재발화를 강요했음. 명령어는 위에서 이미 barge-in 처리됨.
    // 한계: 값은 final 단계에서 컷되므로 STT 확정까지 ~1~2초 TTS가 더 재생될 수 있음(명령어의 interim 컷보다 느림).
    // 잔여 에코 위험(TTS 숫자의 마이크 되먹임)은 아래 신뢰도 게이트(0.65 / noisy 0.80)가 1차 방어.
    // v0.4.4: barge-in 발화도 클립에 담기도록 클립은 announceField에서 announce TTS 이전에 시작됨.
    // v0.15.0 A6 — 스피커폰 모드 삭제. 모드로 게이트되던 값-경로 post-TTS 가드(종료 직후 잔향 폐기)와
    // 그 near-miss 계측을 제거했다. 이제 기본(이어폰) barge-in 동작만 남는다: TTS 재생 중(muted) 값이
    // 들어오면 폐기하지 않고 TTS를 끊고 그대로 처리한다. 잔여 에코 위험은 아래 신뢰도 게이트(0.65 /
    // noisy 0.80)가 1차 방어. (self-confirm 환각은 v0.13.0 alertText 재구성으로 이미 구조적 해소.)
    {
      const muted = ctrlRef.current?.isTtsMuted() ?? false;
      if (muted) {
        // 이어폰 barge-in: 재생 중 들어온 값을 폐기하지 않고 TTS를 끊고 그대로 처리.
        // §5-1 ②(v0.44.0) — "무엇을 들었는지"를 채운다. 08-02 실기기 stt_barge_in 167건 전부
        // text=''/confidence=0(브라우저가 빈 final을 확정)이라 §D2(종경 컬럼) 판정이 미결이었다.
        // 빈 final이면 **같은 발화의 마지막 interim**(handleFinal 하단 :1697에서야 소거되므로
        // 이 시점엔 아직 살아 있다)이 유일한 인식 증거다 — text·confidence를 그 값으로 폴백하고
        // 출처 마커(text_src=interim)를 남긴다. final 원문이 있으면 종전 그대로(마커 없음 —
        // 기존 이벤트 바이트 불변), interim조차 없으면 기존 폴백(''/0) 유지.
        const interim = lastInterimRef.current;
        const fromInterim = !text && !!interim?.text;
        logCell({
          type: 'stt_barge_in',
          text: fromInterim ? interim!.text : text,
          confidence: fromInterim ? interim!.confidence ?? 0 : confidence,
          row: awaiting.row,
          colId: awaiting.colId,
          ...(fromInterim ? { extra: bargeInTextSource('interim') } : {}),
        });
        cancelTts();
        epochRef.current++; // 진행 중인 advance/안내 체인 무효화
      }
    }

    // Log STT event
    lastConfidenceRef.current = confidence;
    // v0.9.0 EOS 계측: 마지막 interim → 이 final까지의 간격 = 브라우저 무음 종료감지 꼬리.
    // 앱 처리는 ~1ms이므로 사용자 체감 딜레이의 실제 병목. 조기확정 시엔 ≈0으로 찍힌다.
    const eosTailMs = lastInterimRef.current ? Math.max(0, Date.now() - lastInterimRef.current.at) : null;
    lastInterimRef.current = null;
    // A8 계측: final이 안정화 후보보다 먼저 도착해 조기확정이 무산된 케이스. 후보가 무장돼 있었을
    // 때만 기록(매 final 폭주 방지). early-commit 자체 경로면 이미 ref가 비어 있어 여기선 안 찍힌다.
    if (earlyCommitStableRef.current) {
      logCell({ type: 'stt_early_commit',
        row: awaiting.row, colId: awaiting.colId,
        extra: `attempt:reset:final_first:${earlyCommitStableRef.current.value}` });
      earlyCommitStableRef.current = null;
    }
    logCell({
      type: 'stt',
      row: awaiting.row,
      colId: awaiting.colId,
      colName: awaiting.name,
      text,
      confidence,
      alts,
      ...(eosTailMs != null ? { eosTailMs } : {}),
    });

    // v0.23.0 입력탭#4 — 마지막 행 종료 대기(atEnd): 명령(종료/수정/이동 등)은 위에서 이미 dispatch됐다.
    // 여기 도달한 것은 일반 값 발화이므로 새 행으로 커밋하지 않고 종료 안내만 재생한다(자동 종료 제거).
    if (awaiting.kind === 'atEnd') {
      useSessionStore.getState().setRecognized('');
      // 🔴 v0.49 r6 Y6(claude #5) — **흡수는 사건을 처리한 것이다 → 거절 큐를 내린다.** 착지의
      //   큐 해제는 `armLanding`이 소유하는데(Z5) 흡수는 착지가 아니라 그 깔때기를 안 탄다.
      //   그래서 직전 거절로 선 큐가 화면에 남은 채 흡수 안내만 귀로 나갔다 — 화면은 「소리가
      //   불확실」을 계속 띄우고 귀는 끝 도달을 말하는 §2 표면 모순(M4가 `announceField`에서
      //   닫은 그 형태). 형제 셋 + 스코프 경계가 같은 지점이다.
      useSessionStore.getState().setReaskReason(null);
      // 🔴 v0.49 r2 W2(확정표 #5+6) — 진입 안내와 **같은 문구**다. 종전엔 여기가 "입력이
      //   끝났습니다…", 진입이 "마지막 행까지 입력했습니다…"로 갈려 있어 같은 상태를 두 이름으로
      //   불렀다. 빈 행 목록은 **이 시점에 다시 센다** — 흡수 시점엔 값이 더 채워졌을 수 있다.
      const vcEnd = voiceColsList();
      await say(buildEndReachedTts(listEmptyRows(computeTotalRows(getSessionColumns()), vcEnd)));
      return;
    }

    // v0.33.0 백로그 A(민구 결정 3) — 완료 행 검토 대기(reviewWait): 명령은 위에서 이미 dispatch됐다.
    // 여기 도달한 것은 일반 값 발화 — 완료 행을 bare 값으로 덮어쓰지 않고 안내만 한다(수정은
    // '수정' 명령으로만). atEnd 가드와 동일한 흡수 패턴.
    if (awaiting.kind === 'reviewWait') {
      useSessionStore.getState().setRecognized('');
      useSessionStore.getState().setReaskReason(null); // Y6 — 위 atEnd 흡수와 같은 계약.
      // 🔴 v0.49 fix49b(max 리뷰 #8) — **어휘 재배정(F-1, 08-12) 미이관.** 「다음」이 항목 이동으로
      //   재배정되면서 이 안내가 가르치던 단어가 행을 넘기지 못하게 됐고, 행을 넘기는 말
      //   ('다음행')은 **어떤 안내에도** 등장하지 않아 음성 전용 사용자가 완료 행에 갇혔다
      //   (V-FIX4급 안내계약 위반). 그래서 문구가 '다음행'을 가르치도록 바뀌었다.
      // 🔴 v0.49 r2 A13(codex F6) — 종전 이 자리의 *"항목 이동은 이 상태(reviewWait)에서
      //   거부된다"* 는 서술은 **현행과 반대다**: W1(08-13 민구 결정)이 reviewWait·atEnd에서의
      //   항목 이동을 허용했다(`gotoAdjacentField`의 reviewScope 분기 — 그 오라클이 f1-field-nav ⑩).
      //   지금 이 상태가 거부하는 것은 **bare 값 발화**(아래 흡수)이지 이동이 아니다.
      await say(reviewWaitAbsorbTts(awaiting.row));
      return;
    }

    // 🔴 v0.49 fix49(리뷰 B-1) — 셀 검토 대기(값 있는 셀에 항목 이동으로 착지): 명령은 위에서
    //   이미 dispatch됐다. 여기 도달한 것은 일반 값 발화이므로 **커밋하지 않는다.** 이 흡수가
    //   없으면 `setRowValue`가 확정·저장된 값을 무조건 덮는다(커밋 지점에 셀 단위 게이트 없음).
    //   문구는 행 검토("N행은 완료된 행입니다")와 **다르다** — 여기서 행을 말하면 사용자는
    //   행이 끝난 줄 안다. 정정 진입로('수정')를 한 마디로 가르친다(H-2 — 길이 압력).
    if (awaiting.kind === 'cellWait') {
      useSessionStore.getState().setRecognized('');
      useSessionStore.getState().setReaskReason(null); // Y6 — 위 atEnd 흡수와 같은 계약.
      logCell({
        type: 'command', parsed: 'cell_wait_absorb',
        extra: `cell_wait_absorb:${awaiting.colId}`, text,
        row: awaiting.row, colId: awaiting.colId,
      });
      // ⚠️ 문구는 `cellWaitPrompt`(위 #9 SSOT)를 쓴다 — 이 문장이 그 SSOT의 **원본**이지만,
      //   여기 리터럴을 남겨 두면 「선언은 하나인데 사본이 있는」 [PAST-2] 형태가 된다.
      await say(cellWaitPrompt(awaiting.name));
      return;
    }

    // Item 12: 컬럼명 완전 일치 STT 거부 — 숫자/날짜 컬럼에만 적용 (text/options 컬럼은 컬럼명이 유효한 값일 수 있음)
    const allColumns = getSessionColumns();
    const currentCol = allColumns.find((c) => c.id === awaiting.colId);
    if (currentCol && currentCol.type !== 'text' && currentCol.type !== 'options') {
      const colNames = allColumns.map((c) => c.name.trim());
      if (colNames.includes(text.trim())) {
        logCell({ type: 'stt_rejected_col_name', text, row: awaiting.row, colId: awaiting.colId });
        useSessionStore.getState().setRecognized('');
        // #6 — 거절 종단 단일화(비프 + §2 쌍 TTS). 종전엔 무비프 + W2 이전 인라인 리터럴이었다.
        // M3 — `awaiting`을 넘긴다: 소수 문맥이면 종단이 그 문맥의 문구·큐로 간다(그 헤더).
        await rejectValue('parse_failed', awaiting);
        return;
      }
      const KNOWN_NOISE = /^(변경|성경|광경|구정|혜정|당장|경정)$/;
      if (KNOWN_NOISE.test(text.trim())) {
        logCell({ type: 'stt_rejected_col_name', text, row: awaiting.row, colId: awaiting.colId, extra: 'known_noise' });
        useSessionStore.getState().setRecognized('');
        // M3 — 클립 재시작 **요청**은 여기 남지만(전체 재발화 유도 분기), 소수 문맥에서는 종단이
        //   그 요청을 무시한다([CLIP-DECIMAL-FRAG-1]). 종전엔 여기서 무조건 재시작해 원본
        //   전체발화 버퍼를 폐기했다.
        await rejectValue('parse_failed', awaiting, { restartClip: true });
        return;
      }
      // v0.34.0 O2 [STT-17] — 값 대기 중 단독 응답어("예/네/응/어" 등)는 수사로 커밋하지 않는다.
      //   07-14 실기기: "예"(conf 0.729)가 alt "네"→native 4로 커밋(알람 없는 컬럼이면 침묵 오염).
      //   파서 전역 차단은 불가("사"/"넷"은 유효) — 숫자 컬럼 값-대기 문맥에서만 재질문. trendConfirm
      //   중에도 동일 적용(응답어는 '확인' 명령이 아니다 — 팝업 유지, 정정값 4 오염 방지). 소수 재질문
      //   문맥(fractionWhole)에선 "네"가 .4로 합성되는 것을 막되, awaiting을 건드리지 않고 return해
      //   문맥·연속 클립을 보존한다([CLIP-DECIMAL-FRAG-1] — startClip 금지, 타깃 재질문 반복).
      if (isBareResponseWord(text)) {
        logCell({ type: 'stt_rejected_ambiguous_syllable', text, confidence, row: awaiting.row, colId: awaiting.colId, extra: 'response_word' });
        useSessionStore.getState().setRecognized('');
        // #6 — 표면(큐+비프)은 두 갈래 **앞에서** 한 번 무장한다. 소수부 타깃 재질문도 「값을
        //   안 받았다」는 점에서 같은 거절이고, 갈린 뒤에 배선하면 다음 갈래가 조용히 빠진다
        //   (파싱 실패 분기가 같은 이유로 이미 그렇게 한다).
        // M3 — 그 두 갈래가 이제 **종단 안**에 있다. 여기 인라인으로 두면 형제 분기가 같은 갈래를
        //   또 손으로 적어야 하고, 그게 이 결함의 형태였다(FB#4 문구 계약은 종단이 그대로 승계).
        await rejectValue('parse_failed', awaiting, { restartClip: true });
        return;
      }
    }

    // v0.19.0 W4 — "소음 환경 모드"(noisyMode) 완전 제거(민구 결정). TTS가 인식값을 되읽어주므로
    // 오인식 판독에 문제가 없어 소음모드는 오히려 방해였다. noisyMode로만 발동하던 단일문자 거부
    // 분기도 함께 제거한다. (아래 lone-syllable homophone 가드는 noisyMode와 독립이므로 그대로 보존.)
    // v0.20.0 입력탭#1 — 값 게이트 신뢰도 임계를 하드코딩(0.65) 대신 사용자 조절 가능한
    // settingsStore.recognitionTolerance(기본 0.60, 범위 0.40~0.90)로 이전한다. 장갑 낀 손가락용
    // 가로 다이얼(Vance)이 이 값을 쓴다. **값 게이트만** 바꾼다 — 위 명령 게이트(commandMinConfidence,
    // 기본 0.7)와 lone-syllable 동음이의 가드, 아래 `confidence > 0` 미보고 센티넬은 그대로 둔다.
    // v0.26.0 F1 재변경(민구 최종 결정) — 다이얼은 "높을수록 엄격". 저장값(recognitionTolerance)은
    // 다이얼 위치이고, 실제 최소 신뢰도 변환은 minConfidenceForTolerance()가 단독 소유한다(이력 그쪽).
    const recognitionTolerance = useSettingsStore.getState().recognitionTolerance;
    const minConfidence = minConfidenceForTolerance(recognitionTolerance);

    // T-3 (single-syllable homophone, "이"→2): on a MEASUREMENT column (int/float) a lone
    // Sino-Korean syllable that doubles as a common non-number word ("이","사","오","일"…) was
    // committed at HIGH confidence with no challenge — but a bare single digit is essentially
    // never a real mm/Brix reading, so it is far more likely a particle/filler misheard as a
    // number. The existing single-char reject above only fires in noisyMode; this re-confirms
    // the lone-syllable homophone case REGARDLESS of noisyMode. Scope is deliberately narrow —
    // single alt, exactly one SINO syllable — so genuine numerals ("이백삼십삼") and arabic
    // single digits ("2") are untouched. Reuses the null→re-ask contract (no commit).
    // v0.10.0 A1: 소수점 타깃 재질문 중(awaiting.fractionWhole)에는 이 게이트를 건너뛴다 — 사용자가
    // "소수점 아래만" 명시적으로 한 자리(예: "오"=5)를 말하는 상황이라 단일 음절이 모호하지 않다.
    // (정수부 컨텍스트가 이미 있어, 아래 fractionWhole 분기가 `111.5`로 합성한다.)
    if (currentCol && (currentCol.type === 'int' || currentCol.type === 'float') && fractionWholeOf(awaiting) == null) {
      if (alts.length <= 1 && isAmbiguousSingleSyllable(text)) {
        logCell({ type: 'stt_rejected_ambiguous_syllable', text, confidence, row: awaiting.row, colId: awaiting.colId });
        useSessionStore.getState().setRecognized('');
        // M3 — 이 분기의 가드(`fractionWholeOf(awaiting) == null`)가 소수 문맥을 이미 배제하므로
        //   종단의 문맥 판정은 여기서 no-op이다. 그래도 **같은 종단**을 쓴다(형태 통일 —
        //   가드가 언젠가 완화되면 조용히 새는 것이 정확히 이 결함의 형태였다).
        await rejectValue('parse_failed', awaiting, { restartClip: true });
        return;
      }
    }

    // Plain value — with alts fallback on parse failure (item 11)
    const col = getColById(awaiting.colId);
    const fractionWhole = fractionWholeOf(awaiting);
    // [ENV-12] v0.43.0 #3 — 파싱 판정은 valueParseAttempt(순수)가 소유한다. 여기서는 호출하고
    //   부수효과(문맥 해제·로그 방출)만 적용한다. 판정 순서·alt 스킵 규칙은 그 모듈의 계약이다.
    //
    // 🔴 **v0.43.0 #3 — 신뢰도 게이트보다 파싱이 먼저다.** (민구 확정, plan §2-5)
    //   종전에는 저신뢰 거절이 파서보다 **앞에** 있어, `300`(conf 0.097)처럼 완벽히 파싱되는
    //   숫자가 **파싱 시도조차 없이** 버려졌다. 07-30 실기기에서 6건이 그렇게 죽었고 재질문이
    //   21초를 태웠다. 다이얼로는 못 푼다 — `190`(conf 0.021)을 통과시키려면 임계를 2%까지
    //   내려야 하고, 그건 게이트를 없애는 것과 같다.
    //   🔑 **판별자는 신뢰도가 아니라 "파싱되는가"다.** 같은 로그가 양방향으로 보여줬다:
    //   고신뢰인데 쓰레기(`담백` 0.887 · `담배` 0.715), 저신뢰인데 정확(`300` 0.097 · `190` 0.021).
    //   BT 마이크 환경에서 Web Speech의 confidence는 **신호 품질**을 재지 텍스트의 옳음을 재지 않는다.
    //   → 파싱되면 신뢰도와 무관하게 커밋한다. **확인 단계는 넣지 않는다** — 에코 TTS(:800 계열)가
    //   이미 매 커밋마다 값을 읽어주므로 귀로 듣는 확인이 이미 있다(민구: "확인 질문은 중복").
    //   파싱 실패 시에만 기존 저신뢰 게이트가 그대로 돈다(게이트를 없앤 것이 아니다).
    const attempt = attemptParseValue({ col, text, alts, fractionWhole: fractionWhole ?? null });
    const lowConfidence = confidence > 0 && confidence < minConfidence;

    // Low confidence — re-ask. **파싱에 실패했을 때만** 여기로 온다(#3 이후).
    if (attempt.parsed === null && lowConfidence) {
      // v0.23.0 입력탭#2 — 저신뢰 재질문을 명시 이벤트로 로깅(이전엔 무로깅). confidence + 다이얼 값 +
      // 실제 게이트를 함께 박제해 차기 분석이 "설정값 vs 실제 신뢰도"를 정량 대조하게 한다(갭 해소).
      // v0.25.0 F1 — 다이얼 값(tolerance)과 반전된 실제 임계(minConf)를 둘 다 싣는다. 반전 이후엔
      // `confidence < minConf` 불변식이 이벤트 자체로 읽혀야 하고(예 conf 0.65 < minConf 0.70), 다이얼
      // 값만 두면 "0.65인데 tolerance 0.60에서 거부"처럼 모순으로 보인다(Trace가 반전식을 몰라도 명료).
      // v0.43.0 #3 — 이 이벤트의 **의미가 좁아졌다**: 종전 "저신뢰라 버림" → 현재 "저신뢰이고
      //   파싱도 안 돼서 버림". 거절률 분모로 쓸 때 그 차이를 알고 써야 한다.
      logCell({
        type: 'stt_rejected_low_confidence', text, confidence,
        row: awaiting.row, colId: awaiting.colId,
        colName: awaiting.name, extra: `tolerance:${recognitionTolerance},minConf:${minConfidence}`,
      });
      useSessionStore.getState().setRecognized('');
      // 🔴 v0.49 r4 M3 — 클립 재시작이 **종단으로 옮겨졌다**(요청만 넘긴다). 여기가 리뷰가
      //   지목하지 않은 세 번째 구멍이었다: 소수부 타깃 재질문 중 저신뢰 파싱 실패도 이 분기로
      //   오는데, 무조건 재시작이 [CLIP-DECIMAL-FRAG-1]을 어기고 소수 큐까지 지웠다(그 헤더).
      // 🔴 v0.49 r2 B2(민구 결정 08-13 ⓐ) — **거절 비프.** 아래 주석이 "부정 비프가 전담한다"고
      //   적어 온 그 비프다(합집합 C2: 배선된 적이 없어 전제가 허구였다). TTS **이전에** 낸다 —
      //   커밋 확인음이 세운 「신호음 → 말」 순서 계약과 같다(민구 지정 순서).
      // v0.48.0 P3(NEW-2, 민구 제보 08-10) — 재질문 사유를 TTS로 읽는다(종전엔 화면만 알았다).
      // 🔴 v0.49 r2 W2(확정표 #1) — **사유만 말한다.** 꼬리("잘 못 들었습니다. {항목} 다시 말씀해
      //   주세요.")는 삭제됐다: 사용자는 이미 그 셀에 답하는 중이고, 재시도 신호는 화면 큐
      //   (`ReaskCue`, 상세본 유지)와 부정 비프가 전담한다.
      // 🔴 v0.49 r3 #6 — 큐·비프·TTS 세 신호를 `rejectValue` 한 곳으로 모았다(형제 4분기가
      //   그 셋 중 둘을 빠뜨린 채 살아 있던 것이 결함이다 — 그 헤더 참조).
      await rejectValue('low_confidence', awaiting, { restartClip: true });
      return;
    }

    // 🔴 계측(plan §2-5-b 4번) — **저신뢰인데 파싱돼서 통과한 건.** 다음 회차에 이 판단이
    //   옳았는지 가릴 유일한 모수다. 신규 이벤트 타입 없이 아래 `value` 커밋 이벤트에 싣는다.
    const lowConfParsedExtra = attempt.parsed !== null && lowConfidence
      ? lowConfidenceParsed({
        conf: confidence,
        minConf: minConfidence,
        tolerance: recognitionTolerance,
        via: attempt.events.some((e) => e.kind === 'alt_used')
          ? 'alt'
          : attempt.events.some((e) => e.kind === 'decimal_fraction_recovered') ? 'frac' : 'primary',
      })
      : null;
    let parsed = attempt.parsed;
    const parseFailReason = attempt.failReason;
    const parseFailWhole = attempt.failWhole;
    if (fractionWhole != null) {
      // 여기 도달 시 kind는 value|modify|trendConfirm — 위 가드가 atEnd/reviewWait를 return(내로잉 증명).
      // 소수부 문맥은 **한 번만** 적용하고 즉시 해제한다(합성 실패 시 아래 실패 분기가 다시 세운다).
      awaitingFieldRef.current = { ...awaiting, fractionWhole: undefined };
    }
    for (const ev of attempt.events) {
      if (ev.kind === 'decimal_fraction_recovered') {
        logCell({ type: 'stt', extra: 'decimal_fraction_recovered', text: ev.text, originalText: ev.originalText, row: awaiting.row, colId: awaiting.colId });
      } else {
        logCell({ type: 'stt_alt_used', altIdx: ev.altIdx, text: ev.text, originalText: ev.originalText, row: awaiting.row, colId: awaiting.colId, ...(ev.extra ? { extra: ev.extra } : {}) });
      }
    }
    if (parsed === null) {
      // v0.20.0 Phase 5 #2 — parse_failed 보강: 원본 transcript(text)는 이미 동봉. 여기에 항목명
      // (colName)과 직전 컨텍스트(소수부 재질문 중이면 정수부 fractionWhole)를 더해 "주로 실패하는
      // 숫자/항목"을 다음 세션부터 정량화한다. (런타임에 '기대값'은 알 수 없어 추가하지 않는다 —
      // 실세션은 정답이 없는 자유 측정이므로 transcript+context로 패턴을 집계하는 것이 정직하다.)
      // v0.43.0 #3-2 — `extra`(사유)는 이제 **항상 실린다.** 종전엔 파서의 3개 경로에서만
      // 나왔고 07-30 실기기 22건 중 14건이 공백이었다(plan §2-6). 사유가 비어 보이면 그건
      // 새 실패 경로가 사유 없이 추가된 것이다 — koreanNum의 `fail()` 규약을 확인해라.
      logCell({
        type: 'stt_parse_failed', text, altsCount: alts.length,
        extra: parseFailReason ?? undefined,
        row: awaiting.row, colId: awaiting.colId,
        colName: awaiting.name,
        ...(fractionWhole != null ? { originalText: `frac_ctx:${fractionWhole}` } : {}),
      });
      // 🔴 v0.49 r2 W4 — **섀도 계측**(민구 재결정 08-13, `_ASK-voice.md` BLOCKING #1 → ⓐ).
      //   거절·재질문은 **현행 그대로**이고, 「자동 채택했더라면 무엇이었을지」만 남긴다. 다음
      //   회차가 이 값과 **재발화 후 실제 커밋값**을 대조해 오채택률을 시트 위험 0으로 잰다
      //   (08-13 실측으로는 4/4 오답 — `koreanNum.ts`의 `getLastSalvageCandidate` 주석에 대조표).
      //   🔴 별도 라인으로 남기는 이유: 위 `stt_parse_failed`의 `extra`는 사유 **단독**이 바이트
      //   계약이다(PRINCIPLES §4 — 꼬리 확장은 이벤트별 개별 승인). 꼬리를 붙이면 사유를
      //   정확일치로 세는 기존 집계가 조용히 갈린다. 신규 type도 만들지 않는다(log-replay 호환)
      //   — `enterReviewWait`이 `command`를 재사용한 것과 같은 판단이다.
      //   🔴 v0.49 r2 A4(합집합 C10) — **소수부 재질문 문맥에서는 남기지 않는다.** 그 문맥의
      //   발화는 조각("구")이고 `salvageCandidate`도 그 조각에서 나온다. 이 계측의 판정 방법은
      //   *"이 후보를 재발화 후 실제 커밋값과 대조해 오채택률을 잰다"* 인데, 조각 후보를 전체값
      //   커밋과 대조하면 **비교 자체가 성립하지 않는다**(정수부 111 + 조각 후보 9 vs 커밋 111.9).
      //   다음 회차 모수가 조용히 오염되므로 억제한다. 합성값(정수부+조각)을 대신 기록하는 쪽은
      //   택하지 않았다 — 그건 「자동 채택했더라면」이 아니라 **소수부 합성이 성공했을 값**이라
      //   같은 컬럼에 다른 의미의 수를 섞는다(합집합 처방도 「억제가 단순」).
      if (attempt.salvageCandidate != null && fractionWhole == null) {
        logCell({
          type: 'stt', extra: wouldSalvage(attempt.salvageCandidate), text,
          row: awaiting.row, colId: awaiting.colId, colName: awaiting.name,
        });
      }
      // v0.23.0 입력탭#2 — 파싱 실패도 재질문 사유로 표면화(높은 신뢰도인데 재질문되는 혼동 해소).
      // 🔴 v0.49 r2 B2 — 거절 표면(화면 큐 + 비프). **아래 3분기가 갈리기 전에** 한 번 무장한다:
      //   소수부 타깃 재질문도 「값을 안 받았다」는 점에서 같은 거절이고, 분기마다 배선하면 다음
      //   분기가 추가될 때 조용히 빠진다(이 파일이 반복해 겪은 드리프트).
      //   🔴 v0.49 r3 #6 — 그 경고가 이 분기 **안에만** 적혀 있어서 형제 4분기가 통째로 빠져
      //   있었다. 표면 무장을 `armRejectCue`로 뽑아 여섯 분기가 같은 종단을 쓰게 했다.
      // 🔴 v0.49 r5 Z5(codex R4-F3 둘째 축) — 표면 무장(`armRejectCue`)이 여기 홀로 서 있고 아래
      //   세 분기가 소수 문맥을 **각자** 처리했다. 「모든 값 거절을 `rejectValue` 한 곳에서
      //   종결」이 그래서 아직 성립하지 않았다. 이제 세 분기 전부 그 종단을 부른다 —
      //   `armRejectCue`·`setDecimalReason`·`say`·클립 재시작이 전부 종단 소유다.
      //   ⚠️ 분기가 여전히 남는 이유는 **소수 문맥의 출처가 다르기 때문**이다(새로 여는 것 /
      //     유지하는 것 / 없는 것). 그 판정과 `awaiting` 변이·클립 계측은 여기 고유 계약이고,
      //     화면·TTS·비프는 종단이 낸다. 각 분기가 종단에 넘기는 것은 그 차이뿐이다.
      // v0.10.0 A1: 소수 의도인데 소수부 유실("111 점 에") → 정수부를 유지하고 "소수점 아래만" 타깃
      // 재질문(전체 재발화 회피). 값 추측(에→1)은 하지 않는다 — 같은 STT 문자열이 111.1·111.5
      // 양쪽에서 나와 조용한 오커밋이 되기 때문(민구 결정).
      if (parseFailReason === 'decimal_fraction_lost' && parseFailWhole != null) {
        // [CLIP-DECIMAL-FRAG-1] v0.16.0 — 소수 재질문은 부분(조각) 발화("구")만 유도하므로, 다른
        // 재질문(multi_numeric·extraneous_token 등 전체 재발화 유도)과 달리 클립을 재시작하면 직전의
        // 원본 전체발화("이십구 점 부") 버퍼가 폐기돼 커밋 클립에 조각만 남는다(시트값은 정상·클립
        // audit만 유실). 그래서 이 분기에서만 startClip()을 생략한다 — 활성 슬롯이 재질문 TTS·조각
        // 발화를 거쳐 계속 녹음하다가 commit 지점 stopClip()에서 단일 연속 녹음으로 stop된다.
        // v0.21.0 CLIP-MIDSPEECH-1 — audioTrim.buildKeptRanges가 원본·조각을 포함한 모든 발화를
        // 감싸는 단일 포괄 범위로 트림하므로(중간 무음 보존, splice 없음), 저장 클립이 원본+조각을
        // 사이 무음째 그대로 담아 전체값으로 재생/전사된다(사람 청취 보존). 별도 cross-restart webm
        // concat이 없어 iOS decodeAudioData(webm/opus) 위험(CLIP-2 ⚠️주시)을 구조적으로 피한다.
        // `:raw`도 재시작이 없어 1회만 보존됨.
        logCell({ type: 'clip', extra: 'clip_decimal_kept', row: awaiting.row, colId: awaiting.colId });
        awaitingFieldRef.current = { ...awaiting, fractionWhole: parseFailWhole };
        // FB#4 — 화면 큐와 TTS의 글자 일치(정수부를 store에 싣는다)는 종단이 한다. 이 분기는
        //   문맥을 **새로 여는** 쪽이라 `awaiting`엔 아직 없다 — 그래서 `whole`로 넘긴다.
        await rejectValue('parse_failed', awaiting, { whole: String(parseFailWhole) });
      } else if (fractionWhole != null) {
        // v0.33.0 [STT-15] 재질문 유지 — 소수부 재질문 응답이 소수부(합성)로도 전체값(primary)로도
        // 해석되지 않으면 문맥(fractionWhole)을 버리지 않고 같은 타깃 재질문을 반복한다. 이전엔
        // 문맥이 원샷 해제돼 다음 발화가 전체값으로 처리됐다(조각 "1"이 값으로 설 위험).
        // 클립도 decimal_fraction_lost 분기와 동일하게 재시작하지 않는다(원본+조각 연속 보존).
        logCell({ type: 'clip', extra: 'clip_decimal_kept', row: awaiting.row, colId: awaiting.colId });
        awaitingFieldRef.current = { ...awaiting };
        // 기존 문맥 유지 — 종단이 `awaiting.fractionWhole`을 읽어 같은 꼬리로 수렴한다.
        await rejectValue('parse_failed', awaiting);
      } else {
        // 전체 재발화 유도 분기 — 새 클립이 옳다(종단의 `restartClip`).
        // v0.48.0 P3(NEW-2, 민구 제보 08-10) — 사유를 TTS로 읽는다.
        // 🔴 v0.49 r2 W2(확정표 #2) — **사유만 말한다.** 종전 꼬리("{항목} 다시 말씀해 주세요.")는
        //   삭제됐다(#1과 같은 근거). 이 꼬리를 부분일치로 검증하던
        //   `decimal-targeted-reask.spec.ts`의 [alt 의미보존] 케이스는 같은 커밋에서 갱신했다.
        await rejectValue('parse_failed', awaiting, { restartClip: true });
      }
      return;
    }

    const myEpoch = ++epochRef.current;
    const sess = useSessionStore.getState();
    sess.setRowValue(awaiting.row, awaiting.colId, parsed);
    // v0.47.0 W4(FB-E) — 음성 확정 커밋의 ✓ 집합 등록(value·modify·trendConfirm 정정 공통.
    //   아래 추세위반 분기도 "커밋된 값은 그대로 선다"이므로 이 지점이 맞다).
    useSessionCommitMarks.getState().add(awaiting.row, awaiting.colId);
    // v0.37.0 리뷰#1 — 검토 영수증(모든 커밋 경로 공통). trendConfirm(정정)도 **무조건** 발행한다:
    //   valueBurst는 아래에서 중복 팝업 억제로 정정 커밋을 건너뛰지만(불변), 검토 화면은 정정된
    //   실제 커밋값을 보여야 하므로 영수증은 정정 여부와 무관하게 발행한다.
    sess.pushCommitReceipt(awaiting.row, awaiting.colId, awaiting.name, parsed);
    sess.setRecognized(parsed);
    sess.setReaskReason(null); // v0.23.0 입력탭#2 — 성공 커밋 시 재질문 사유 큐 해제.
    // v0.20.0 Phase 5 #4 — 반응속도: final 진입→값 store 커밋까지 앱 파이프라인 경과ms(파싱·가드·
    // 동음이의/소수 합성 포함). 아래 value 이벤트(정상·추세위반 둘 다)에 durationMs로 싣는다 — echo
    // TTS 대기 전에 캡처해 TTS 길이가 섞이지 않게 한다(순수 커밋 지연).
    const commitLatencyMs = Date.now() - handleFinalAt;
    // v0.15.0 A4 — 이상치→정정→정상 흐름 중복 팝업 억제. 추세 알림에 새 값으로 응답한 정정 커밋
    // (trendConfirm)은 아래에서 anomalyAlert 팝업을 초록(corrected)으로 전환해 이미 같은 값을 크게
    // 보여준다. 그 뒤 진행 착지점의 clearAnomalyAlert가 팝업을 닫으면, VoiceScreen의
    // `valueBurst && !anomalyAlert` 조건이 참이 되며 같은 값이 CenterValueBurst로 한 번 더 떠
    // "정상 입력 내용이 한 번 더 팝업"되던 중복(민구 제보)이 발생한다. 정정-출처 커밋에선 burst를
    // 건너뛰어 중앙 팝업이 1회(초록 corrected)만 뜨게 한다. 일반(비-정정) 커밋의 burst는 그대로 유지.
    //
    // 🔴 v0.46.1 FB-10 — **이 억제는 그대로 둔다. 여기서 고치려 하지 마라.**
    //  FB-10(정정 완료도 확정 표시를 받아야 한다)은 이 줄을 푸는 방식으로는 안 고쳐진다 —
    //  **실측으로 확인했다**: burst를 여기서 밀면 그 시점의 중앙은 아직 알람 카드라 `VoiceHero`가
    //  언마운트 상태이고, corrected 전환과 burst push는 같은 React 배치에 들어가 hero가 붙는
    //  렌더에서 `useConfirmFlash`의 *마운트 시점 burst 미재생* 가드(VoiceHero의 `seenSeqRef===null`,
    //  v0.35.0 FIX-3)에 **조용히 삼켜진다**. 프로브 실측: 알람 카드는 사라졌는데 `hero=listening`,
    //  확정 플래시 0회(`tests/_probe-fb10-transition.spec.ts`, 402×513).
    //  👉 그래서 표시 계층에서 푼다 — `CenterStage`가 corrected를 hero 브랜치로 보내며 값을
    //  `confirmBurst` prop으로 직접 넘긴다. store 흐름(억제 포함)은 **한 줄도 안 바뀐다.**
    if (awaiting.kind !== 'trendConfirm') {
      sess.pushValueBurst(awaiting.name, parsed, awaiting.colId); // I-3: 중앙 버스트 + 칩 V(UI③)
    }
    awaitingFieldRef.current = null;

    // v0.7.0 B4: 추세 알림에 새 값으로 응답한 재커밋 — 정정 기록(오알림률 분모) + 이전 값 발화
    // 클립 보존. 새 저장이 같은 bare key(`sess:row:colId`)를 덮어쓰므로 :a<n>로 먼저 보관한다
    // (RACE-4 보존 원칙 — enterModifyMode의 archive 패턴과 동일, 백그라운드).
    if (awaiting.kind === 'trendConfirm') {
      logCell({
        type: 'trend', extra: 'trend_alert_corrected',
        row: awaiting.row, colId: awaiting.colId,
        text, parsed,
        ...(awaiting.previousValue != null ? { previousValue: awaiting.previousValue } : {}),
      });
      archiveCellClip(awaiting.row, awaiting.colId);
    }

    // v0.10 클립 누락 수정: stopClip을 echo TTS 이전에 시작 (병렬 실행)
    // 이전 버그: await speak(echo) 동안 마이크 stream이 idle → 다음 startClip이 호출되면 이전 슬롯 손실
    const clipKey = `${sessionIdRef.current}:${awaiting.row}:${awaiting.colId}`;
    const clipAwaitingRow = awaiting.row;
    const clipAwaitingColId = awaiting.colId;
    // [CLIP-VAL-1]②: whether this commit is a modify re-record — on a failed capture the cell's
    // pointer is re-linked to the modify-command clip (`…:cmd<n>`) instead of being left on the
    // canonical key (which still holds the PREVIOUS value's audio — the "155.5 cell plays 177.7"
    // defect) or silently unlinked.
    const wasModify = isModifyLike(awaiting);
    pendingClipsRef.current[clipAwaitingRow] = {
      ...pendingClipsRef.current[clipAwaitingRow],
      [clipAwaitingColId]: clipKey,
    };
    // v0.4.4 증분 영속화: 값 커밋 직후(행이 완료되기 전이라도) 진행 행을 IDB에 저장한다. advance()가
    // 행 완료 시 다시 저장하므로 중복이지만, 마지막 필드 입력 전 새로고침/앱 업데이트로 부분 입력이
    // 유실되는 것을 막는 핵심 보호다. (fire-and-forget — echo TTS/진행을 막지 않음.)
    // v0.24.0 데이터-3 진단 — 이상치 교정 커밋이면 persist 후 dataStore 값이 교정값과 일치하는지
    // 가시화(불일치=옛값 잔존, 단조 가드가 막아야 함). 다음 실기기 세션에서 재현 시 근인 즉시 포착.
    // v0.34.0 O1 — 검사 **시점 이동**: 이전엔 persist resolve 직후 즉시 검사해, 커밋 경로가 아직
    // 진행 중(echo/알람 TTS·후속 persist 정착 전)에 dataStore를 읽어 mismatch 오탐 ×2를 기록했다
    // (07-14 실기기 r8c8 — 정정 09:23:38 검사 vs value 09:23:40, 실피해 0). persist는 그대로
    // fire-and-forget으로 발사하되, 검사는 커밋 경로 종단(value 이벤트 이후 — 알람 분기는 알람 TTS
    // 이후)에 스케줄해 durable 반영이 정착한 뒤 1회만 판정한다(로직 최소 변경 — 비교식 동일).
    const wasTrendCorrected = awaiting.kind === 'trendConfirm';
    const persistPromise = persistSession();
    void persistPromise.catch(() => {});
    const runCorrectedPersistCheck = () => {
      if (!wasTrendCorrected) return;
      void persistPromise.then(async (durable) => {
        // dataStore는 IDB 실패 뒤에도 과거 코드에서 갱신될 수 있어 검증 근거가 아니다. save 성공
        // 결과를 먼저 요구하고 같은 레코드를 IDB에서 재조회해 재시작 후에도 남을 값을 판정한다.
        let persisted: string | undefined;
        let readFailed = false;
        if (durable) {
          try {
            const saved = await loadSession(sessionIdRef.current);
            persisted = saved?.rows.find((r) => r.index === clipAwaitingRow)?.values[clipAwaitingColId];
          } catch (err) {
            readFailed = true;
            logCell({
              type: 'error', extra: `trend_corrected_persist_read_failed:${String((err as Error)?.message ?? err)}`,
              row: clipAwaitingRow, colId: clipAwaitingColId,
            });
          }
        }
        logCell({
          type: 'trend',
          extra: !durable
            ? 'trend_corrected_persist_check:write_failed'
            : readFailed
              ? 'trend_corrected_persist_check:read_failed'
            : persisted === parsed
              ? 'trend_corrected_persist_check:ok'
              : 'trend_corrected_persist_check:mismatch',
          row: clipAwaitingRow, colId: clipAwaitingColId, parsed,
          ...(persisted !== parsed ? { previousValue: String(persisted ?? '') } : {}),
        });
      });
    };
    // Codex MEDIUM-4: clip for this field is being committed (stopped) — no longer active.
    // The next announceField will re-set it after its own startClip().
    activeClipRef.current = null;
    const clipStopPromise: Promise<ClipResult> =
      recorderRef.current?.stopClip()
      ?? Promise.resolve({ blob: null, raw: null, prerollMs: 0 });
    // 포인터 정리/재연결은 clipPointer 모듈(Stage 3-3 순수 이동)이 담당 — 소유권 가드 계약 포함.
    // 여기서는 이 커밋의 좌표(clipKey·row·colId)를 고정 인자로 묶는다.
    const pointerArgs = {
      sessionId: sessionIdRef.current,
      row: clipAwaitingRow, colId: clipAwaitingColId, clipKey,
      pendingClips: pendingClipsRef.current,
    };
    // 지연 재개 방어(v0.35.3 리뷰 s3r2 Codex Medium) — 이 커밋의 세션·cmd 인덱스도 **캡처 시점에
    // 고정**한다. 클립 저장이 stop() 유예(5s)를 넘긴 뒤 다음 세션이 시작되면 pendingClipsRef는 새
    // 객체로 재할당되지만 pointerArgs는 옛 세션의 맵을 계속 보므로 소유권 가드가 통과하는데, 이때
    // cmdKey를 라이브 sessionIdRef(새 세션)로 조립하면 옛 세션 행이 새 세션 클립 키를 참조하는
    // provenance 오염이 생긴다. 캡처 고정으로 지연 콜백은 이 커밋의 문맥만 본다.
    const sessionIdAtCommit = sessionIdRef.current;
    const cmdIdxAtCommit = clipCapture.commandClipIndex(clipAwaitingRow, clipAwaitingColId);
    // [CLIP-VAL-1]②③ — a capture under the canonical key failed. Tombstone the key FIRST (so an
    // in-flight persistSession can never re-persist it), then: if this was a modify re-record and
    // its command clip (`…:cmd<n>` — for "수정 <값>" it carries the NEW value's utterance) actually
    // saved, re-link the cell's playback pointer to it (06-11 row8: the correct audio WAS on disk
    // as `8:c7:cmd1`); otherwise unlink so no stale previous-value audio remains canonical.
    const resolveFailedCapture = async (savePromiseSelf: Promise<unknown> | null) => {
      brokenClipKeysRef.current.add(clipKey);
      if (wasModify) {
        const n = cmdIdxAtCommit;
        if (n) {
          const cmdKey = `${sessionIdAtCommit}:${clipAwaitingRow}:${clipAwaitingColId}:cmd${n}`;
          // The cmd-clip save may still be in flight — flush other pending saves (not ourselves)
          // before the existence check (archiveCellClip's flush pattern, bounded).
          await clipCapture.flushSaves(1500, { exclude: savePromiseSelf });
          const cmdBlob = await loadAudioClip(cmdKey).catch(() => null);
          if (cmdBlob && relinkClipPointer(pointerArgs, cmdKey)) {
            // 지연 재개 시 라이브 sessionId(다음 세션)로 오귀속되지 않게 캡처된 세션으로 기록.
            logger.log({
              type: 'clip', extra: 'clip_relink_cmd', kind: 'command', clipKey: cmdKey,
              sessionId: sessionIdAtCommit, row: clipAwaitingRow, colId: clipAwaitingColId,
            });
            return;
          }
        }
      }
      unlinkClipPointer(pointerArgs);
    };
    // Holder for the savePromise's own identity (assigned right after creation, before the
    // IIFE's first await resumes) so resolveFailedCapture can exclude itself from the flush.
    let savePromiseSelf: Promise<unknown> | null = null;
    const savePromise = (async () => {
      try {
        logCell({ type: 'clip', extra: 'clip_stop_await', row: clipAwaitingRow, colId: clipAwaitingColId });
        const { blob: clipBlob, raw: rawBlob, trimFailed, trimFailReason } = await clipStopPromise;
        logCell({ type: 'clip', extra: `clip_stop_resolved:${clipBlob ? clipBlob.size : 'null'}`, row: clipAwaitingRow, colId: clipAwaitingColId });
        // v0.20.0 BL-2 — 트림이 예외(decodeAudioData 등)로 생략됐으면(저장본=미트림 원본 webm) 가시화한다.
        // 이전엔 무이벤트 침묵 폴백이라 "음성클립 편집 실패"(이원창 c7 3·4·5 = 비고 3행)가 로그에 안 보였다.
        // 클립 자체는 저장되어 재생 가능(capture 플로우 불깨짐) — 이건 순수 관측용 신호다(보수적).
        if (trimFailed) {
          logCell({
            type: 'clip', extra: `clip_trim_failed:${trimFailReason ?? 'unknown'}`,
            row: clipAwaitingRow, colId: clipAwaitingColId, clipKey,
          });
        }
        if (!clipBlob) {
          // v0.20.0 Phase 5 #5 — clip_empty에 직전 입력장치 전이(있으면)를 컨텍스트로 동봉한다.
          // BT clip_empty는 내장↔블루투스 thrash 직후 트랙 사망으로 발생 — 전이를 같은 이벤트에 붙여
          // 다음 분석이 BT 라우팅 원인을 즉시 잇게 한다(이전엔 별도 input_device_changed와 ts로만 상관).
          const lic = recorderRef.current?.getLastInputChange();
          logCell({
            type: 'error',
            extra: lic ? `clip_empty:after:${lic.reason}:${lic.transition}` : 'clip_empty',
            row: clipAwaitingRow, colId: clipAwaitingColId,
          });
          // v0.22.0 P0 — 빈 클립 자동 재시도 폭주 차단. 자동 recoverStream은 iOS에서 **제스처 밖
          // getUserMedia**라 NotAllowedError로 거부되어 살아있던 스트림까지 잃고 매 빈 클립마다
          // 재시도가 폭주했다(실기기: clip_empty×41). → 스트림이 실제로 죽었으면 자동 재시도를 멈추고
          // micLost로 표시(once 가드) → 사용자 제스처(reconnectMic)로만 복구. 스트림이 멀쩡하면
          // no-op(다음 클립이 자가 치유). 자동 recoverStream은 더 이상 부르지 않는다(수칙 3).
          maybeAutoRecoverOrLatch('clip_empty');
          await resolveFailedCapture(savePromiseSelf);
          return;
        }
        if (clipBlob.size <= EMPTY_CLIP_BYTES) {
          logCell({ type: 'error', extra: `clip_too_small:${clipBlob.size}`, row: clipAwaitingRow, colId: clipAwaitingColId });
          maybeAutoRecoverOrLatch('clip_too_small');
          await resolveFailedCapture(savePromiseSelf);
          return;
        }
        // v0.11.0 Codex HIGH: pendingClipsRef로 stale save 차단.
        // restart/modify가 pendingMap[colId]를 정리하거나 새 키로 교체하면, 옛 savePromise는
        // m[colId] !== clipKey가 되어 폐기됨. epoch 가드보다 정밀해서 정상 클립을 차단하지 않음.
        const guard = pendingClipsRef.current[clipAwaitingRow];
        if (!guard || guard[clipAwaitingColId] !== clipKey) {
          logCell({ type: 'error', extra: 'clip_stale_pending', row: clipAwaitingRow, colId: clipAwaitingColId });
          return;
        }
        await saveAudioClip(clipKey, clipBlob);
        // [CLIP-VAL-1]③: fresh bytes landed under this key — lift the tombstone so the pointer
        // may persist again (a previous failed attempt on the same cell reuses the same key).
        brokenClipKeysRef.current.delete(clipKey);
        logCell({ type: 'clip', extra: `clip_saved:${clipBlob.size}`, row: clipAwaitingRow, colId: clipAwaitingColId });
        // v0.5.0 W6 원본 보존(민구 결정): 트림 전 전체본(프리롤 포함)을 `…:raw`로 함께 보관.
        // pendingClips에는 등록하지 않으므로 데이터탭 재생 UI에는 노출되지 않고, 로그 zip의
        // clips/(prefix 매칭)과 deleteSession cascade에만 따라간다. 분석 전용.
        if (rawBlob) {
          await saveAudioClip(`${clipKey}:raw`, rawBlob);
          logCell({ type: 'clip', extra: `clip_raw_saved:${rawBlob.size}`, clipKey: `${clipKey}:raw`, row: clipAwaitingRow, colId: clipAwaitingColId });
        }
      } catch (e) {
        logCell({ type: 'error', extra: `clip_save_failed:${String((e as Error)?.message ?? e)}`, row: clipAwaitingRow, colId: clipAwaitingColId });
        await resolveFailedCapture(savePromiseSelf);
      }
    })();
    savePromiseSelf = savePromise;
    clipCapture.trackSave(savePromise);

    // ── v0.7.0 B4: 추세 검증 — 값 커밋 직후 · echo/advance 전 ──
    // 값↔클립 매핑은 위에서 이미 확정됐고 커밋된 값은 위반이어도 그대로 선다(롤백 없음 — 민구
    // 결정: 알림 후 '확인'/'유지'는 유지·진행, 새 값 발화는 재입력). 위반이면 echo 대신 알림
    // TTS를 내보내고 advance를 중단한 채 trendConfirm 상태로 응답을 기다린다.
    const trendViolation = evaluateTrend(col, awaiting.row, awaiting.colId, parsed);
    if (trendViolation) {
      const v = trendViolation;
      // 알람 페이로드(extra 문자열·팝업 코어) 조립은 buildAnomalyAlert(모듈 하단)가 SSOT —
      // v0.35.1 Stage 1-2에서 수동 커밋 경로(commitManualValue)와 통합했다(표시값 산출은 그 안의
      // buildAnomalyDisplay — v0.9.0~v0.25.0 이력·근거 주석은 그쪽 참조).
      // alertText는 팝업 라벨(AnomalyAlertPopup)과 **글자까지 동일** 계약(시각·청각 일치, v0.20.0 입력탭#6).
      // v0.12.0 AREA2 V2 — 어떤 샘플·행/직전 회차의 비교인지 식별정보를 함께 싣는다(별도 재계산).
      const alertExtra = getAnomalyAlertData(awaiting.row);
      const { alertText, logExtra, alert } = buildAnomalyAlert({
        col, v, colName: awaiting.name, next: formatForTts(parsed), row: awaiting.row,
        sampleKey: alertExtra.sampleKey, prevDate: alertExtra.prevDate,
      });
      // v0.26.0(Trace 권장, 2세션 연속 계측 갭) — 어떤 종류/트리거/문구로 알람이 나갔는지 extra에 동봉.
      //   직전까지는 extra='trend_alert_fired'뿐이라 기능3(both→범위 우선) 라우팅을 로그로 검증할 수
      //   없었다. 파서 호환을 위해 'trend_alert_fired' 접두는 유지하고 ':k=v' 목록을 덧붙인다.
      logCell({
        type: 'trend',
        extra: logExtra,
        row: awaiting.row, colId: awaiting.colId,
        colName: awaiting.name, text, parsed, confidence, previousValue: String(v.prev),
      });
      // value 이벤트는 정상 커밋과 동일하게 남긴다 — 분석 파이프라인이 위반 여부와 무관하게 본다.
      logCell({
        type: 'value',
        row: awaiting.row, colId: awaiting.colId, colName: awaiting.name,
        text, parsed, confidence,
        durationMs: commitLatencyMs, // v0.20.0 Phase 5 #4 — 발화 확정→커밋 반응속도(ms)
        // 🔴 v0.43.0 리뷰(Codex 중간#1, 2026-07-31 수용) — **이 줄이 빠져 있었다.**
        //   plan §2-5-b가 요구한 모수는 *"저신뢰인데 파싱돼 통과한 건 **전부**"* 인데, 종전엔
        //   아래 정상 커밋 분기에만 마커가 실려 **이상치 알람으로 분기한 커밋이 모수에서 빠졌다.**
        //   이 값도 :1918에서 store에 커밋되고 :1978에서 persist가 시작되므로 관찰 대상이 맞고,
        //   무엇보다 **이상치 값이야말로** 새 정책의 오인식 위험을 판단할 때 빼면 안 되는 표본이다
        //   (저신뢰 오인식이 이상치로 보이는 게 정확히 우리가 찾는 형태다).
        //   신규 이벤트는 안 늘어난다 — 아래와 **같은** extra를 같은 value 이벤트에 싣는다.
        ...(lowConfParsedExtra ? { extra: lowConfParsedExtra } : {}),
        ...(isModifyLike(awaiting) && previousValueOf(awaiting) != null
          ? { previousValue: previousValueOf(awaiting) }
          : {}),
      });
      // 응답 대기 상태 무장 — 새 값 발화가 기존 수정(isModify) 의미론으로 재커밋되도록
      // previousValue=방금 커밋된 값과 함께 세팅한다.
      // 🔴 v0.47.0-r3(이중 콜드 리뷰 08-09, codex f2 + claude §1 독립 일치) — **재위반 재무장도
      //   resumeReview를 보존한다.** 종전엔 이 재무장만 예약을 복사하지 않아, 검토 대기 출신
      //   직접 수정이 「위반 → 새 값(또 위반) → 확인」 조합에서만 advance로 새어 나갔다
      //   (v0.33.0 항목2 계약 파괴 — 해소 지점 4곳은 전부 새 객체에서 resumeReviewOf를 읽으므로
      //   여기서 떨어뜨리면 전 지점이 undefined를 받는다). demoteTrendConfirm(:136)과 같은 관례.
      //   오라클: tests/v0470-r2-p1-direct-modify-trend.spec.ts 「P1ⓒ-review-재위반」.
      awaitingFieldRef.current = {
        kind: 'trendConfirm',
        row: awaiting.row, colId: awaiting.colId, name: awaiting.name,
        previousValue: parsed,
        ...(resumeReviewOf(awaiting) != null ? { resumeReview: resumeReviewOf(awaiting) } : {}),
        // v0.49 r2 A2 — 셀 축 예약도 같은 이유로 보존한다(재위반 재무장에서 떨어뜨리면
        //   「위반 → 새 값(또 위반) → 확인」 조합에서만 셀 검토가 증발한다 — 위 주석과 같은 함정).
        ...(resumeCellOf(awaiting) != null ? { resumeCell: resumeCellOf(awaiting) } : {}),
      };
      // 응답 발화('확인'/새 값) 클립 시작 — announceField 패턴(TTS 이전 시작, barge-in 수록).
      armClipForCell(awaiting.row, awaiting.colId);
      // 시각 팝업: 이전값→현재값과 변화량을 띄운다(발화만으론 스쳐 지나가 확인이 어렵다는 요청).
      useSessionStore.getState().setAnomalyAlert({
        ...alert,
        // buildAnomalyAlert의 공통 코어는 colId를 의도적으로 모르므로, 음성 호출부의 정확한 awaiting
        // 좌표를 얹는다. 이후 clear 계측이 이름 추정 없이 같은 셀을 식별하는 주 출처다.
        colId: awaiting.colId,
        // v0.33.0 항목7 — 응답 대기 알람: 팝업이 [확인][수정] 터치 버튼을 그린다(음성 명령과 동일
        // 동작·동일 로그, 07-10 QA P1 #2). 수동 커밋의 정보성 팝업(확인 루프 없음)과 구분.
        awaitingResponse: true,
      });
      playBeep('alert');
      useSessionStore.getState().setLastTts(alertText);
      // 🔴 v0.48.1 U1(리뷰 F1/HIGH, claude+codex 독립일치) — `myEpoch`는 이 값 커밋 시작 시점
      //   (:2298)에 이미 캡처돼 있다 — 재사용한다(같은 handleFinal 호출, 같은 스코프).
      // 🔴 v0.48.1 r3 U1 4절 — 직접수정 경로(:1338 부근)와 동일 이유로, 이 alertText 재생 전
      //   구간에 우연히 같은(방금 bump된) epoch로 기록된 낡은 barge-in 흔적을 지운다.
      bargeInEpochRef.current = -1;
      const started = await say(alertText);
      // v0.48.0 P4(NEW-3, 민구 제보 08-10) — "값을 틀렸는지, 인식이 잘못됐는지 소리만으론 알 수
      // 없다"(원문). alertText는 팝업 라벨과 글자까지 동일해야 하는 §4 바이트 계약(logExtra의
      // text=)에 묶여 있어(위 :2494) 값을 거기 합치면 anomalyAlert.spec.ts·trend-alert.spec.ts
      // triad(화면==TTS==로그)가 깨진다(scout-v048 조사) — alertText/logExtra는 불변, **별도
      // 두 번째 발화**로만 분리한다. alert.next는 이미 formatForTts(parsed)로 조립돼 팝업
      // "현재" 값과 같은 문자열이다(시각·청각 일치).
      // 🔴 U1 가드 — `await say(alertText)`의 resolve는 발화 종료를 뜻하지 않는다(`cancel()`도
      //   `onend`를 쏜다 — barge-in이 :353·:1990 부근에서 건다, review-claude.md F1). 세 절이
      //   각각 다른 재진입 구멍을 막는다: `epoch` 불변 = cmd/값 barge-in(같은 셀 재위반 포함 —
      //   재위반도 값 재커밋이라 :2298에서 매번 새 epoch를 받는다); `kind==='trendConfirm'` =
      //   터치 종료 버튼의 `stop()`(`awaitingFieldRef.current=null`, epoch는 안 건드림, :3341
      //   부근); `anomalyAlert?.awaitingResponse` = `clearAnomalyAlert` 경유 해소. 셋 다 참이어야
      //   「아직 같은 알람이 대기 중」이다 — 그때만 지나간 값이 아니다.
      // U2(codex medium) — `started`=false(1차가 watchdog으로 스킵)면 2차도 생략해 직렬 대기가
      //   5초로 배증하는 것을 막는다. 잔여 축(started-but-no-onend)은 `say()` 주석 참조.
      // 🔴 v0.48.1 r3 U1 4절 — 직접수정 경로(:1332 부근)와 동일 근거. `bargeInEpochRef` 선언부·
      //   handleInterim 주석 참조.
      if (
        started
        && epochRef.current === myEpoch
        && awaitingFieldRef.current?.kind === 'trendConfirm'
        && useSessionStore.getState().anomalyAlert?.awaitingResponse
        && bargeInEpochRef.current !== myEpoch
      ) {
        // 🟡 v0.48.1 r3(codex 재검증 잔여) — `interrupt:false` 전환은 철회했다. 직접수정
        //   경로(:1332 부근)와 동일 근거 — 상세는 거기 주석 참조(④ TODO에 합류).
        await say(`인식값 ${alert.next}`);
      }
      // F5(low, claude) — lastTts는 갱신하지 않는다: alertText가 triad(화면==TTS==로그) SSOT라
      //   2차 발화까지 반영하면 화면의 "마지막 안내"와 로그 text=가 어긋난다(의도된 선택).
      // v0.34.0 O1 — 재위반(정정값이 또 위반) 커밋도 검사 대상(이전 .then 무조건 실행과 동등) —
      // 단 알람 TTS까지 끝난 지금 시점에 스케줄한다.
      runCorrectedPersistCheck();
      return; // advance 중단 — 해소는 handleFinal 상단의 trendConfirm 분기
    }

    // ── v0.13.0 R2(민구 요청): 추세 알림에 새 값으로 응답한 정정이 '정상'으로 판명된 경우 ──
    // (위 trendViolation 분기를 타지 않고 여기 도달 = 정정값이 정상 범위.) 화면에 떠 있던 빨강 이상치
    // 팝업을 초록(corrected)으로 전환하고 next를 정정값으로 즉시 반영한다. 이전엔 이 경로에서 팝업을
    // 전혀 갱신하지 않아 옛 이상치 값이 남은 채 echo TTS("수정 …")만 새 값을 말해 시각/청각이 어긋났다.
    // 팝업 닫힘은 advance()의 착지점(다음 필드·끝 도달·검토 대기)이 clearAnomalyAlert로 담당하므로,
    // echo TTS가 발화되는 동안 초록 팝업이 노출되고 착지 직전에 전수 계측과 함께 내려간다.
    let beeped = false;
    if (awaiting.kind === 'trendConfirm') {
      const cur = useSessionStore.getState().anomalyAlert;
      if (cur) {
        useSessionStore.getState().setAnomalyAlert({
          ...cur,
          next: formatForTts(parsed),
          status: 'corrected',
        });
        playBeep('corrected');
        beeped = true;
      }
    }
    // 🔴 v0.47.0 W2(FB-C+G①, 민구 08-08) — **수정 성공 커밋 = 화음 + green.** 종전엔 여기서
    //   중립 단음(playBeep('modify'))을 내고 beeped 가드로 아래 화음을 건너뛰었다 — 그 단음은
    //   "모드 전환" 신호라 진입(announceField isModify)으로 옮겼고, 성공은 다른 모든 커밋과
    //   동일한 화음을 받는다(kind='modify'는 beeped를 세우지 않아 아래 공용 화음이 난다).
    //   committed=true가 VoiceScreen 톤 파생을 amber→green으로 뒤집는다(재청취 중은 amber —
    //   §C4 의미 보존). 해제는 announceField(다음 안내)·종단 착지가 modifyIndicator와 함께.
    // v0.47.0 C-FIX1ⓑ(리뷰 U2·U5) — kind='modify'만 보던 종전 판정의 구멍: **수정→이상치 알람→
    //   정정 확정**은 awaiting이 trendConfirm으로 승격돼 있어 committed가 안 서고, 성공했는데
    //   착지까지 amber가 남았다. isModifyLike(modify+trendConfirm)로 판정한다 — 수정 문맥이
    //   없던 일반 정정은 modifyIndicator가 null이라 이 플래그가 시각 효과를 갖지 않는다(무해).
    if (isModifyLike(awaiting)) {
      useModifyPhase.getState().setCommitted(true);
    }

    // 🔴 v0.46.0 WP-E(제보 F7② — 민구 지시 08-05) — **커밋 확인음**. 종전엔 정상 커밋 경로에
    // 소리가 아예 없었다(alert·corrected·modify 3종뿐). 값이 저장되는 모든 커밋에 확인음이 난다.
    // 🔑 **순서가 계약이다: 확인음 → 인식값 TTS**(민구 지정). 그래서 아래 echo speak() 바로 앞이다.
    // `beeped` 가드는 **중복 방지 전용**이다 — 정정 완료(corrected)는 이미 자기 소리(긍정 화음)를
    // 냈고 그 위에 확인음을 겹치면 두 신호가 한 순간에 섞여 구분이 안 된다.
    // (수정 성공은 v0.47.0 W2부터 이 공용 화음을 그대로 받는다 — 위 분기 주석 참조.)
    // ⚠️ trendConfirm인데 팝업(anomalyAlert)이 이미 내려간 경우는 corrected 비프가 안 나므로
    // 여기서 확인음이 난다 — 커밋은 성공했으니 소리가 없는 편이 더 나쁘다.
    if (!beeped) playBeep('commit');

    const echoText = isModifyLike(awaiting)
      ? `수정 ${awaiting.name} ${formatForTts(parsed)}`
      : formatForTts(parsed);
    const echoEnqueuedAt = Date.now();
    await speak(echoText, {
      interrupt: true,
      rate: getTtsRate(),
      onStart: (d) => {
        logCell({
          type: 'tts',
          ttsText: echoText,
          startDelayMs: d,
          durationMs: Date.now() - echoEnqueuedAt,
          row: awaiting.row,
          extra: 'echo',
        });
      },
    });

    logCell({
      type: 'value',
      row: awaiting.row,
      colId: awaiting.colId,
      colName: awaiting.name,
      text,
      parsed,
      confidence,
      durationMs: commitLatencyMs, // v0.20.0 Phase 5 #4 — 발화 확정→커밋 반응속도(ms)
      // v0.43.0 #3 계측 — 저신뢰인데 파싱돼서 통과한 커밋만 마커가 붙는다(정상 커밋은 없음).
      ...(lowConfParsedExtra ? { extra: lowConfParsedExtra } : {}),
      // #3 error-vs-intent: present only when this value re-commits a corrected cell.
      // previousValue (pre-modify) vs parsed (final) discriminates STT prefix-drop from re-entry.
      ...(isModifyLike(awaiting) && previousValueOf(awaiting) != null
        ? { previousValue: previousValueOf(awaiting) }
        : {}),
    });

    // v0.34.0 O1 — 교정 persist 검사는 커밋 경로 종단(echo TTS·value 이벤트 이후)에 스케줄.
    runCorrectedPersistCheck();

    // Guard against race: another handleFinal ran while we were awaiting
    if (epochRef.current !== myEpoch) return;
    // v0.47.0-r2 P1 — 검토 대기 출신 직접 수정이 알람을 경유해 **새 값으로 재커밋**된 경우의
    //   착지. 예약이 없으면(=기존 모든 흐름) 값이 undefined라 종전대로 advance로 간다.
    // 🔴 v0.49 r2 A2 — 그 판정을 `proceedAfterCommit`(정본)에 넘긴다. 종전엔 여기서 행 예약만
    //   읽었기 때문에, **bare '수정' 후 재기록**(2단계 수정)이 셀 검토 대기 출신이어도 그대로
    //   `advance()`로 빠졌다(codex F1 = 합집합 C3). 이제 셀 축 예약(resumeCell)도 같은 문에서
    //   판정된다 — 예약이 둘 다 없으면 종전과 동일하게 advance()다.
    await proceedAfterCommit(awaiting);
    // 🔴 v0.49 fix49b(max 리뷰 #13) — `gotoAdjacentField`가 dep에 없었다(dispatch에서 두 번 부른다).
    //   지금은 잠복이다: 이 함수가 타고 내려가는 체인(announceOrCellWait→announceField/
    //   enterCellWait→say)이 전부 `[]`-안정이라 신원이 안 변한다. 그러나 그 사슬 어느 고리든
    //   변하는 값을 갖는 순간(예: announceField가 설정 파생값을 참조) 이 명령만 **낡은 클로저로
    //   dispatch**되어 「이전」/「다음」이 옛 로직을 돈다 — 이 파일의 dep 배열을 유지보수하는
    //   이유가 정확히 그 드리프트다. 같은 diff가 형제들(goNextRow·gotoAdjacentRow)은 등재했다.
    // v0.49 r5 Z5 — `armRejectCue`가 dep에서 빠졌다: 이 함수가 **직접 부르는 곳이 없어졌다**
    //   (전부 `rejectValue` 종단 경유). 그게 곧 「단일 종단」의 기계적 증거다.
  }, [advance, enterModifyMode, enterReviewWait, proceedAfterCommit, rejectValue, relistenInContext, say, goNextRow, gotoAdjacentField, gotoAdjacentRow, persistSession, evaluateTrend, getAnomalyAlertData, archiveCellClip, armClipForCell, clearAnomalyAlert]);

  // ── v0.9.0 interim(중간) 결과 처리: EOS 계측 마킹 + (빠른 인식 ON 시) 조기확정 ──
  const handleInterim = useCallback((text: string, confidence?: number) => {
    const now = Date.now();
    // EOS 계측: 마지막 interim 도착 시각 기록 — handleFinal이 final.ts와의 차로 꼬리를 산출.
    // §5-1 ② — 엔진이 interim에 준 원시 confidence도 함께(미보고면 undefined 그대로).
    lastInterimRef.current = { text, at: now, confidence };

    // v0.36.0 FB#2(Vance) — 미확정 인식 텍스트를 **표시 전용** store 필드에 기록(파형과 함께 "지금
    //   이렇게 들었다"를 원거리에 노출). 값-대기(value/trendConfirm) 문맥에서만 — 이동/종료 대기
    //   중엔 임시값을 띄우지 않는다. 명령어는 확정값이 아니므로 제외. 순수 표시 — 조기확정·커밋·
    //   텔레메트리 경로는 아래 로직 그대로(이 write는 그 앞에서 무조건 실행, fastRecognition 무관).
    const trimmedInterim = text.trim();
    // 🔴 v0.48.1 r3 U1 4절 — speech.ts:353와 같은 조건(뮤트 중 + 비어있지 않은 interim)을 여기서도
    //   재확인해, "이 순간 barge-in이 실제로 발생했다"를 이 알람의 epoch에 못박는다. cancel()이
    //   쏘는 onend는 비동기라 이 시점엔 아직 unmuteForTts()가 돌지 않았으므로 isTtsMuted()가
    //   true로 읽힌다(위 bargeInEpochRef 선언부 주석 — done() 대조로 반증됨).
    if (trimmedInterim && ctrlRef.current?.isTtsMuted()) {
      bargeInEpochRef.current = epochRef.current;
    }
    const awaitingForDisplay = awaitingFieldRef.current;
    const showInterim =
      !!trimmedInterim &&
      !!awaitingForDisplay &&
      awaitingForDisplay.kind !== 'atEnd' &&
      awaitingForDisplay.kind !== 'reviewWait' &&
      // v0.49 fix49 — 셀 검토 대기도 값을 받지 않는 상태다. 임시값을 띄우면 화면이
      //   "이 값을 받는 중"이라고 말하는데 실제로는 흡수된다(표시와 동작 불일치).
      awaitingForDisplay.kind !== 'cellWait' &&
      useSessionStore.getState().phase === 'active' &&
      !detectCommand(trimmedInterim);
    useSessionStore.getState().setInterimValue(showInterim ? trimmedInterim : null);

    // 조기확정(빠른 인식) — 기본 OFF(실험). 브라우저 final(무음 종료감지)을 기다리지 않고
    // interim 숫자가 안정되면 커밋해 체감 딜레이를 줄인다. 보수적으로 숫자 컬럼 + 명령어 아님 +
    // TTS중 아님 + active 단계에서만. 절단 리스크가 있어 실기기 A/B 전까지 default off.
    if (!useSettingsStore.getState().fastRecognition) return;
    // A8 계측: fastRecognition ON인데 현장 로그에서 stt_early_commit 0건 — '소음이 interim 안정화를
    // 막아 미발동(정상)'인지 '미배선(버그)'인지 현 계측으론 구분 불가. 아래 stt_early_commit_attempt
    // 로 안정화 시도 진입·리셋 사유를 가시화한다. 동작은 변경하지 않는다(가시성만 추가). OFF면 위
    // early-return으로 무발화(오버헤드 0). 로그 폭주를 막기 위해 전이(transition) 시에만 찍는다.
    const logAttempt = (extra: string) =>
      logCell({ type: 'stt_early_commit',
        row: awaitingFieldRef.current?.row, colId: awaitingFieldRef.current?.colId,
        extra: `attempt:${extra}` });
    const awaiting = awaitingFieldRef.current;
    // 🔴 v0.49 fix49 — `cellWait`은 phase를 'active'로 **유지**하므로(행이 아직 진행 중이라
    //   'complete'로 내리면 히어로 ✓·레이아웃이 「조사 완료」가 된다), 조기확정 차단을 아래
    //   phase 게이트에 기댈 수 없다. 여기서 kind로 명시 차단한다 — 안 막으면 interim 숫자가
    //   확정된 셀에 곧장 커밋된다(B-1을 final 경로에서만 막고 interim으로 새는 형태).
    if (!awaiting || awaiting.kind === 'trendConfirm' || awaiting.kind === 'atEnd'
      || awaiting.kind === 'reviewWait' || awaiting.kind === 'cellWait') return;
    if (useSessionStore.getState().phase !== 'active') return;
    if (ctrlRef.current?.isTtsMuted()) {
      // TTS 중 barge-in은 final 경로가 처리 — 안정화 후보가 무장돼 있었다면 무산 사유를 기록.
      if (earlyCommitStableRef.current) { logAttempt('cancel:tts_muted'); earlyCommitStableRef.current = null; }
      return;
    }
    const t = text.trim();
    if (!t || detectCommand(t)) return; // 명령어는 반드시 final로
    const col = getSessionColumns().find((c) => c.id === awaiting.colId) || null;
    if (!col || (col.type !== 'int' && col.type !== 'float')) return; // 숫자 컬럼만 조기확정
    const parsed = parseValueForCol(col, t);
    if (parsed === null) {
      // interim이 더 이상 숫자로 파싱 안 됨 → 안정화 타이머 리셋(후보가 있었을 때만 기록).
      if (earlyCommitStableRef.current) { logAttempt('reset:parse_null'); earlyCommitStableRef.current = null; }
      return;
    }
    const stable = earlyCommitStableRef.current;
    if (!stable || stable.value !== parsed) {
      // 새 후보 무장(첫 진입) 또는 후보값 변경(새 interim 도착으로 안정화 타이머 리셋).
      logAttempt(stable ? `reset:new_interim:${stable.value}->${parsed}` : `armed:${parsed}`);
      earlyCommitStableRef.current = { value: parsed, since: now };
      return;
    }
    if (now - stable.since < EARLY_COMMIT_STABLE_MS) return;
    // 안정 충족 → 조기확정. 이중 커밋 방지: 인식기 abort로 같은 발화의 in-flight final 폐기.
    earlyCommitStableRef.current = null;
    logCell({
      type: 'stt_early_commit', text: t, parsed,
      row: awaiting.row, colId: awaiting.colId,
      extra: `stable=${EARLY_COMMIT_STABLE_MS}`,
    });
    ctrlRef.current?.restartRecognition();
    // confidence 0 = "미보고" 센티넬 → 신뢰도 게이트 통과(interim엔 신뢰도 없음). 안정성으로 갈음.
    void handleFinal(t, [t], 0);
  }, [handleFinal]);

  /** @returns **실제로 인식기를 복원했는가.** #4의 복귀 안내가 이 값에 걸린다. */
  const resumeRecognitionForUi = useCallback((reason = 'ui_modal') => {
    const latch = uiSuspendRef.current;
    if (!latch.reasons.has(reason)) return false; // 이 소스는 suspend 중이 아님 — no-op(스퓨리어스 resume 방어)
    latch.reasons.delete(reason);
    // v0.37.0 리뷰(3모델 공통) — **다른 suspend 소스가 아직 남아 있으면 실제 재개하지 않는다.**
    //   수동 시트 + 개선요청 모달 중첩 시, 개선요청만 닫혀도 시트 뒤에서 STT가 살아나던 레이스의 차단축.
    //   집합이 완전히 빌 때만 인식기를 복원한다(모든 오버레이 해제 확인).
    if (latch.reasons.size > 0) return false;
    // 🔴 v0.43.0 #4 — 안내 플래그는 **여기서 무조건 소비한다.** 이 지점 아래의 모든 경로
    //   (복원 안 함 / 이미 컨트롤러 있음 / 정상 복원)가 소비된 상태로 진행해야, 복원되지 않은
    //   회차의 플래그가 살아남아 **다음 모달을 닫을 때 발화**하는 일이 없다.
    //   ⚠️ 이 콜백의 컨트롤러 생성부는 `feedback_modal`·`manual_input` 등과 **공유된다** —
    //   onStart를 무조건 걸면 모달을 닫을 때마다 "다시 시작합니다"가 나간다.
    const announceBgResume = bgAnnouncePendingRef.current;
    bgAnnouncePendingRef.current = false;
    const hadController = latch.hadController;
    latch.hadController = false;
    logCell({
      type: 'command',
      parsed: 'ui_resume',
      extra: reason,
      row: useSessionStore.getState().activeRow,
    });
    const phase = useSessionStore.getState().phase;
    const shouldRestore =
      hadController &&
      (phase === 'active' || phase === 'complete' || phase === 'paused') &&
      isSpeechSupported();
    const blockedClip = uiBlockedClipArmRef.current;
    const suspendedClip = blockedClip ?? uiSuspendedClipRef.current;
    uiBlockedClipArmRef.current = null;
    uiSuspendedClipRef.current = null;
    if (!shouldRestore) return false;

    // 값 대기 좌표가 그대로일 때만 재무장한다. 모달 안의 터치 처리 등으로 타깃이 바뀌었다면
    // announceField가 새 좌표의 녹음창을 소유하므로 오래된 셀을 되살리지 않는다.
    // [CLIP-WINDOW-2] 선택 (b): 위에서 마지막 suspend source를 먼저 삭제해 reasons가 빈 뒤에만
    // armClipForCell을 호출한다. 이 순서를 뒤집으면 복원 arm도 게이트에 재차 막혀 영원히 보류된다.
    // suspend 중 들어온 최신 arm 요청은 모달 전 활성 슬롯보다 우선해 같은 기존 복원 경로로 합류한다.
    const awaiting = awaitingFieldRef.current;
    if (
      suspendedClip &&
      !activeClipRef.current &&
      awaiting?.row === suspendedClip.row &&
      awaiting.colId === suspendedClip.colId
    ) {
      armClipForCell(suspendedClip.row, suspendedClip.colId);
    }

    if (!ctrlRef.current) {
      ctrlRef.current = new SpeechController({
        onFinal: handleFinal,
        onInterim: handleInterim,
        onError: () => {},
        // v0.43.0 #4 5번 — **"재개 시도"가 아니라 "재개 성공"에 건다**(plan §3-3). `onStart`는
        //   인식기가 실제로 기동한 신호다. [MIC-B2] 전례(복귀 32.5초 뒤 `audio-capture` 오류)라
        //   시도 시점에 "다시 시작합니다"라고 말하면 거짓말이 된다.
        //   ⚠️ `onStart`는 **워치독 재시작마다** 온다(speech.ts가 매 인스턴스 `start` 이벤트에
        //   건다) — 그래서 클로저 안에 once 가드가 필요하다. 플래그만으로는 부족하다.
        //   v0.45.0 WP-3 — 안내 뒤 복귀 브리핑을 잇는다(F14). 텍스트는 발화 시점에 조립.
        ...(announceBgResume
          ? { onStart: bgResumeAnnouncerOnce(say, () => buildReturnBriefing(true)) }
          : {}),
      });
      setActiveController(ctrlRef.current);
      ctrlRef.current.start();
    }
    return true;
  }, [armClipForCell, handleFinal, handleInterim, say, buildReturnBriefing]);

  // ── v0.45.0 WP-2 [D1] — 세션-활성 게이트 (v0.43.0 #4 "이탈-중지"의 재검토 실행) ──────
  /** WP-1④ — 유지 사이클의 생존 요약 1건(bg_keep). 복귀·임계 어느 쪽이 먼저 오든 한 번만. */
  const emitBgKeepSummary = useCallback(() => {
    const keep = bgKeepRef.current;
    if (!keep) return;
    bgKeepRef.current = null;
    logCell({
      type: 'app',
      extra: bgKeep({
        backgroundMs: Date.now() - keep.hiddenAt,
        finals: keep.finals,
        stt: ctrlRef.current ? 'ctrl' : 'gone',
        track: recorderRef.current?.getTrackState() ?? 'none',
      }),
    });
  }, []);

  const clearBgOffTimer = useCallback(() => {
    if (bgOffTimerRef.current !== null) {
      window.clearTimeout(bgOffTimerRef.current);
      bgOffTimerRef.current = null;
    }
  }, []);

  /** WP-2 — 장기 임계(10분, Q2 민구 확정) 도달 시의 정지 시퀀스: ①음성 고지(best-effort —
   *  iOS가 TTS를 이미 막았을 수 있어 Notification이 주 채널) ②기기 알림 ③저장 ④정지.
   *  ④의 dispose가 곧 물림 예방 선-정리다 — prerollTap detach(무음 분석 AudioContext 해제,
   *  WebKit bug 253951 클래스) + 전 트랙 stop. 복귀 시 자동 재획득 + 실패 시 v0.44.1 경보 재사용.
   *
   *  🔴 리뷰 C1(critical, 콜드 리뷰 08-05) — **파괴적 단계 직전마다 중단 검사.** await 사슬 도중
   *  복귀(알림 탭이 유도하는 설계된 동선)하면 잔여 continuation이 포그라운드에서 STT·레코더를
   *  죽였다. `aborted()`가 세대(bgOffGenRef — 복귀·세션 경계마다 증가)와 가시성을 재검사한다:
   *   - 고지·알림 뒤 중단 → 아무것도 안 건드린 채 종료(복귀측이 bg_keep·브리핑을 정상 수행).
   *   - suspend 뒤 중단 → dispose를 생략(복귀측 resumeRecognitionForUi가 래치로 STT 복원,
   *     레코더는 산 채로 남는다 — 일관 상태).
   *  bg_keep 요약도 정지가 확정된 뒤에만 여기서 소비한다 — 중단 시 복귀측 몫으로 남긴다. */
  const applyBackgroundOff = useCallback(async () => {
    bgOffTimerRef.current = null;
    if (document.visibilityState !== 'hidden') return; // 타이머 경합 — 이미 복귀했다
    if (!shouldKeepInBackground(useSessionStore.getState().phase)) return; // 세션이 그 사이 끝났다
    const gen = bgOffGenRef.current;
    const aborted = () =>
      bgOffGenRef.current !== gen || document.visibilityState !== 'hidden';
    // ① 음성 고지 — suspend가 cancelTts를 부르므로 **먼저** 시도하고 완료(또는 10초 워치독)를
    //   기다린다. iOS가 막았으면 워치독이 해소하고, 복귀 재고지(onStart 안내)가 보강한다.
    await say('10분 동안 자리를 비워 음성 입력을 정지합니다. 입력한 값은 저장되어 있습니다.', false)
      .catch(() => {});
    if (aborted()) return; // 고지 중 복귀 — 정지 없이 철회(세션은 산 채 그대로)
    // ② 기기 알림 — 결과를 조건 거짓 포함 기록([FG-RETURN-LOG-1]).
    const notified = await showBackgroundOffNotification();
    logCell({ type: 'app', extra: notifyPerm({ src: 'threshold', result: notified }) });
    if (aborted()) return; // 알림 직후 복귀(알림 탭) — 정지 철회
    // ③ 저장 — 유지 요약을 먼저 확정 소비하고, 진행 클립을 정상 마감(suspend가 stopClip) 후
    //   pending save flush + 세션 영속. 안내 예약은 **무조건** 세운다(리뷰 ?1 — 모달 래치가
    //   선점돼 latched=false여도 10분 정지는 사실이므로, 최종 복원 시점의 재고지가 맞다).
    emitBgKeepSummary();
    const { sttStopped } = suspendRecognitionForUi('app_background');
    bgAnnouncePendingRef.current = true;
    const hadRecorder = recorderRef.current !== null;
    await clipCapture.flushSaves(PAUSE_FLUSH_GRACE_MS);
    await persistSession();
    if (aborted()) return; // flush·persist 중 복귀 — STT는 복귀측이 래치로 복원했다. dispose 생략
    // ④ 정지 — dispose = 선-정리(preroll AudioContext detach + 전 트랙 stop). track.enabled
    //   토글이 아니라 완전 해제인 이유: 10분 이상은 OS 재량 회수 영역이라 잡고 있어봐야 물림
    //   (253951)만 키운다. 재개는 복귀 경로의 재획득 불변식이 받는다(리뷰 C2).
    recorderRef.current?.dispose();
    recorderRef.current = null;
    logCell({
      type: 'command',
      parsed: 'bg_mic',
      // 리뷰 C8 — capture 축은 "실제 전환"만 off다. 레코더가 처음부터 없던 세션([CLIP-INIT-
      // SILENT-1] 모집단)이면 noop으로 남겨 판독 오염을 막는다.
      extra: bgMicAction({
        edge: 'threshold',
        stt: sttStopped ? 'stopped' : 'noop',
        capture: hadRecorder ? 'off' : 'noop',
      }),
      row: useSessionStore.getState().activeRow,
    });
  }, [emitBgKeepSummary, say, suspendRecognitionForUi, clipCapture, persistSession]);
  const applyBackgroundOffRef = useRef(applyBackgroundOff);
  useEffect(() => { applyBackgroundOffRef.current = applyBackgroundOff; }, [applyBackgroundOff]);

  /** 백그라운드 진입. `visibilitychange`(hidden)의 유일한 호출자는 `App.tsx onVis`다.
   *
   *  🔑 **[D1] 세션-활성 게이트(v0.45.0, 민구 확정 08-05):** phase가 세션 중(active·paused·
   *  complete)이면 **정지하지 않는다** — STT·TTS·클립 캡처를 hidden에도 유지하고 계측만 남긴다.
   *  v0.43.0 #4("화면끔·이탈 둘 다 중지", 민구 지시 07-31)는 08-05 정정으로 **과잉 교정**으로
   *  판정됐다(원 의도 = "세션 밖에서 돌지 마라". [MIC-BG-STOP-1] 재검토 갈래의 실행).
   *  그 정지가 만들던 복귀 왕복(인식기 재생성 + BT HFP 재협상 1~2초 × 세션7 실측 6회)이 F15
   *  ("한 번에 안 붙어")의 구조적 근원 후보였다(플랜 §1-③). 경계·임계는 backgroundSessionPolicy.
   *
   *  세션 밖(ready·stopping)에서는 종전 그대로 확실히 정지한다 — 아래 suspend 경로.
   *  🔴 **순서가 계약이다**(정지 경로에서). suspend가 먼저다 — 그게 진행 중 클립을 `stopClip()`
   *  으로 닫고 재개용으로 보관한다. 뒤집어서 트랙부터 끄면 클립이 무음으로 채워진 채 닫혀
   *  `clip_too_small`/`clip_empty`가 재발한다(07-30 실측 5건 — `enabled=false`는 녹음을 멈추는
   *  게 아니라 무음을 흘린다, MDN).
   *
   *  ⚠️ 화면 끄기와 앱 이탈은 **구분할 수 없다**([SCREEN-LOCK-1]: 53/53 `evidence=blur`).
   *  게이트는 그 구분을 전제하지 않는다 — phase 하나로 가른다. */
  const suspendForBackground = useCallback(() => {
    if (shouldKeepInBackground(useSessionStore.getState().phase)) {
      // [D1] 유지 — 정지 없음. 생존 관측(WP-1④)과 임계 타이머만 세운다.
      bgKeepRef.current = { hiddenAt: Date.now(), finals: 0 };
      clearBgOffTimer();
      // 🔴 테스트 전용 우회(조용한 우회 금지 — __micSettleSkipForTest 계보): 픽스처가
      //    `window.__bgOffMsForTest`를 세우면 **임계값만** 줄인다(시퀀스·계측 계약은 그대로).
      //    기본값 10분은 tests/backgroundSessionPolicy 단언이 리터럴로 고정한다.
      const offMs =
        (window as unknown as { __bgOffMsForTest?: number }).__bgOffMsForTest ?? LONG_BACKGROUND_OFF_MS;
      bgOffTimerRef.current = window.setTimeout(() => { void applyBackgroundOffRef.current(); }, offMs);
      logCell({
        type: 'command',
        parsed: 'bg_mic',
        // 리뷰 C5 계보 — kept는 "돌던 것을 유지"다. 모달 suspend로 이미 죽어 있거나(ctrl=null)
        // 레코더가 없으면 noop으로 남겨 계측이 거짓이 되지 않게 한다.
        extra: bgMicAction({
          edge: 'enter',
          stt: ctrlRef.current ? 'kept' : 'noop',
          capture: recorderRef.current ? 'kept' : 'noop',
        }),
        row: useSessionStore.getState().activeRow,
      });
      return;
    }
    // v0.43.0 리뷰 사소#1 — **두 축을 갈라 쓴다.**
    //   `latched`    → 복원 의무(안내 예약). 1c의 시작-TTS race에서는 아직 인식기가 없어도
    //                  뒤이은 `start()`가 `hadController`를 승격시켜 resume이 실제로 복원한다.
    //                  종전 동작 그대로다 — 여기를 `sttStopped`로 좁히면 그 복원이 조용해진다.
    //   `sttStopped` → 계측의 `stt` 축. "돌던 인식기를 실제로 멈췄나"만 기록한다.
    const { latched, sttStopped } = suspendRecognitionForUi('app_background');
    if (latched) bgAnnouncePendingRef.current = true;
    const captureOff = recorderRef.current?.setCaptureEnabled(false) ?? false;
    logCell({
      type: 'command',
      parsed: 'bg_mic',
      extra: bgMicAction({ edge: 'enter', stt: sttStopped ? 'stopped' : 'noop', capture: captureOff ? 'off' : 'noop' }),
      row: useSessionStore.getState().activeRow,
    });
  }, [suspendRecognitionForUi, clearBgOffTimer]);

  /** 포그라운드 복귀: 캡처 on + STT 복원. 안내는 여기서 하지 않는다 — 복원된 인식기의
   *  `onStart`가 낸다(위 `announceBgResume`).
   *
   *  [D1] 유지 사이클의 복귀는 대개 **복원할 것이 없다**(stt=noop이 정상) — 생존 요약(bg_keep)을
   *  남기고 임계 타이머를 해제한다. 임계 정지(threshold)가 실행됐던 복귀만 레코더를 재획득한다.
   *
   *  🔴 캡처를 **먼저** 켠다(진입의 역순). 복원된 인식기·클립이 무음을 먹지 않게 한다.
   *  🔑 캡처 복구는 **무조건** 돈다 — 백그라운드 중 세션이 끝나 래치가 비어도(`clearUiSuspendLatch`)
   *  트랙이 꺼진 채 남으면 다음 세션이 조용히 무음을 녹음한다. */
  const resumeFromBackground = useCallback(() => {
    // 🔴 리뷰 C1 — 진행 중일 수 있는 임계 정지 continuation을 무효화한다(세대 증가).
    bgOffGenRef.current += 1;
    // WP-3 브리핑 게이트 — 유지 사이클이 실제로 있었는가(스퓨리어스 visible 이벤트 방어).
    const hadKeepCycle = bgKeepRef.current !== null;
    clearBgOffTimer();
    emitBgKeepSummary();
    const captureOn = recorderRef.current?.setCaptureEnabled(true) ?? false;
    const restored = resumeRecognitionForUi('app_background');
    // 🔴 리뷰 C2 — 재획득은 플래그가 아니라 **불변식**이다: 세션이 진행/완료 중인데 레코더가
    //   없으면(임계 정지·경합 잔해 어느 쪽이든) 무조건 재획득한다. paused는 제외 — pause()가
    //   의도적으로 레코더를 비우고 resume()이 재생성하는 기존 계약이다. 실패는 v0.44.1 경보
    //   재사용([CLIP-INIT-SILENT-1] — 무음 실패 금지: 계측 + 배너 래치 + TTS 고지).
    const phaseAtReturn = useSessionStore.getState().phase;
    if (!recorderRef.current && (phaseAtReturn === 'active' || phaseAtReturn === 'complete')) {
      const rec = new AudioRecorder();
      recorderRef.current = rec;
      void rec.init().then((ok) => {
        if (recorderRef.current !== rec) return; // 그 사이 세션 경계를 지났다
        if (!ok) {
          logCell({ type: 'error', extra: micInitFailed(rec.getLastInitError() ?? 'unknown') });
          maybeAutoRecoverOrLatch('init_failed');
          void say('주의. 음성 클립이 저장되지 않습니다. 재연결이 안 되면 앱을 껐다 다시 열어 주세요.', false).catch(() => {});
          return;
        }
        micLostLatchedRef.current = false;
        setMicLost(false);
        // 리뷰 C6 — 재획득 전에 보류된 클립 무장(armClipForCell의 no_recorder 가드가 보관)을
        //   스트림이 실제로 선 뒤 소비한다. 좌표가 여전히 현재 대기 셀일 때만(오래된 셀 금지).
        const pendingArm = uiBlockedClipArmRef.current;
        const awaiting = awaitingFieldRef.current;
        if (
          pendingArm && !activeClipRef.current && uiSuspendRef.current.reasons.size === 0 &&
          awaiting?.row === pendingArm.row && awaiting.colId === pendingArm.colId
        ) {
          uiBlockedClipArmRef.current = null;
          armClipForCell(pendingArm.row, pendingArm.colId);
        }
      });
    }
    logCell({
      type: 'command',
      parsed: 'bg_mic',
      extra: bgMicAction({ edge: 'return', stt: restored ? 'restored' : 'noop', capture: captureOn ? 'on' : 'noop' }),
      row: useSessionStore.getState().activeRow,
    });
    // v0.45.0 WP-3 (F14, Q4-답 민구 확정) — **유지 사이클의 복귀 브리핑.** 인식기가 안 죽었으니
    //   onStart 슬롯이 없다 — 여기서 직접 낸다. active만: paused 복귀는 '재시작' 시점이 담당
    //   (이중 낭독 방지), 정지 사이클 복귀(restored=true)는 onStart 안내+브리핑이 담당.
    //   모달·알람 게이트는 buildReturnBriefing 내부에 있다(리뷰 C3·C5 — 단일 관문).
    if (hadKeepCycle && !restored && useSessionStore.getState().phase === 'active') {
      const briefing = buildReturnBriefing(true);
      if (briefing) void say(briefing, false).catch(() => {});
    }
  }, [resumeRecognitionForUi, clearBgOffTimer, emitBgKeepSummary, maybeAutoRecoverOrLatch, say, buildReturnBriefing, armClipForCell]);

  // ── v0.34.0 A2 — 개선요청(피드백) 팝업 열림 중 STT 일시정지 ──
  // App.tsx가 sessionStore.uiModalOpen('feedback')을 올리고/내리는 단일 신호를 구독한다.
  // 열림 → suspendRecognitionForUi('feedback_modal')(기존 ui_suspend 로그가 판정 근거),
  // 닫힘 → resumeRecognitionForUi. 세션 비활성이면 hadController=false라 자연 no-op(기능 격리).
  // keep-alive([STT-16], App.tsx) 덕에 세션 중엔 어느 탭에서 열어도 이 effect가 살아 신호가 닿는다.
  useEffect(() => {
    return useSessionStore.subscribe((s, prev) => {
      if (s.uiModalOpen === prev.uiModalOpen) return;
      if (s.uiModalOpen === 'feedback') suspendRecognitionForUi('feedback_modal');
      else if (prev.uiModalOpen === 'feedback') resumeRecognitionForUi('feedback_modal');
    });
  }, [suspendRecognitionForUi, resumeRecognitionForUi]);

  // ── start / stop ───────────────────────────────────────────
  const start = useCallback(async (label?: string) => {
    const s = useSettingsStore.getState();
    setPreferredVoiceName(s.preferredVoiceName);
    // v0.44.0 §D1 — barge-in 설정을 라이브 speech 모듈에 동기화(세션 시작 = 항상 최신 영속값.
    // F28 날짜 초기화 등 스토어만 바뀐 경로도 여기서 따라잡는다).
    setBargeInEnabled(s.bargeInEnabled);
    const sess = useSessionStore.getState();
    if (sess.phase === 'stopping') return false;
    // v0.38.0 리뷰#4 — 세션 대상(target)은 **연결된 시트가 있을 때만** 고정한다.
    // 시트 미연결(로컬 기록 모드)은 PRINCIPLES §5가 보장하는 정상 사용이라 막지 않는다 —
    // target 없이 시작하고, 업로드 시점에 대상을 확인받는다(sync의 legacy 세션 경로와 같다).
    // 반대로 **연결된 시트가 있는데 columns 출처가 그 시트가 아니면** 다른 농가 시트에 기록될
    // 위험이라 시작을 막는다.
    if (isSheetSourceBlocked(s)) {
      sess.setLastTts('시트 연결을 다시 확인해 주세요.');
      return false;
    }
    const target = sessionTargetFromSettings(s);
    if (!s.tableGenerated) return false;
    const columns = structuredClone(s.columns);
    const vc = columns.filter((c) => c.input === 'voice');
    if (vc.length === 0) return false;
    const total = computeTotalRows(columns);
    if (total === 0) return false;

    // v0.38.0 리뷰#1(Codex High) — 이전 세션의 마지막 UI 음성명령(도움말·인식률 등)이 남아 있으면,
    // 새 세션에서 ActiveState가 마운트될 때 소비 시퀀스가 0으로 초기화돼 **그 명령이 자동 재실행**된다
    // (세션 B 시작하자마자 도움말이 열리고, 인식률 설정이 한 번 더 바뀐다). 세션 경계에서 비운다.
    // 🔴 F18 이후 이 클리어는 **아래 첫 await보다 앞(클릭 이벤트의 동기 구간)** 이어야 한다.
    //    await 뒤로 밀리면 클릭 배치가 끝난 프라미스 연속에서 zustand setPhase('active')의 동기
    //    렌더가 useState 클리어 flush보다 먼저 ActiveState를 마운트해 stale 신호가 재실행된다
    //    (실측: v026 [리뷰#1] red — 세션 B에서 도움말이 저절로 열림).
    uiCommandSeqRef.current = 0;
    setUiCommand(null);
    // v0.45.0 WP-2 — 알림 권한 요청은 이 클릭의 **동기 구간**에서만 성립한다(iOS 제스처 요건).
    //   앱 수명당 1회, 이미 결정돼 있으면 skipped(무로깅 — 요청 자체가 없었다). 임계 10분 알림
    //   (Q2)의 주 채널이 이 권한이다. gUM 프롬프트와 같은 제스처에 얹히는 것은 의도된 비용 —
    //   첫 세션 1회뿐이고, 임계 알림 없이는 10분 정지가 무음이 된다.
    void requestNotifyPermissionOnce().then((result) => {
      if (result !== 'skipped') {
        logCell({ type: 'app', extra: notifyPerm({ src: 'session_start', result }) });
      }
    });

    // ── 🔴 v0.46.1 WP-1(민구 실기기 08-07) — **오디오 출력 unlock은 여기여야 한다** ──────
    // 08-07 실기기에서 세션 초반 2분간 TTS 11건이 전부 `onstart` 미도착(10초 워치독)이었고
    // 비프도 `ctx=suspended`였다. 같은 시각 wake lock이 `NotAllowedError`를 냈다 — 즉
    // **그 시점엔 이미 사용자 활성화가 없었다.**
    //
    // 근인: `warmupTts()`가 아래 `await recorderRef.init()`(gUM 프롬프트) + 1초 정착 **뒤**에
    // 있었다. `await` 뒤는 클릭 콜스택이 아니므로 iOS가 오디오 개시를 거부한다.
    // 👉 **첫 `await`보다 앞**(이 클릭의 동기 구간)으로 올린다. 위 알림 권한 요청이 같은 이유로
    //    이미 여기 있다 — 같은 계약이다.
    // 🔴 **이 두 줄 사이에 `await`를 넣지 마라.** 넣는 순간 원래 버그로 되돌아간다.
    const audioCtxState = unlockAudioPlayback();  // AudioContext 생성 + resume (비프 경로)
    const ttsWarmup = warmupTts();                 // speechSynthesis 개시 (TTS 경로) — 결과는 아래에서 확인
    logCell({ type: 'app', extra: `audio_unlock:ctx=${audioCtxState},src=session_start` });
    // 🔴 v0.46.1 WP-1c(민구 지시 08-07) — 준비 **진행 상태**를 화면에 낸다.
    //    *"3초뒤 화면 전환이 아닌, 권한 수락하고 실제 마이크/스피커 입출력이 가능한지 확인하고,
    //      진행 상황을 바형태로 보여줘서 … 오작동이 아님을 알게 해줘."*
    const prog = (step: number, label: string, warn?: string) =>
      useSessionStore.getState().setStartProgress({ step, total: START_STEPS, label, warn });
    const audioOk = audioCtxState === 'running';
    prog(1, '소리 출력을 여는 중…', audioOk ? undefined : '소리 출력이 아직 안 열렸어요');

    // ── v0.44.0 §C8 F18(민구 확정 08-02) — 마이크 권한 요청 시점 = **이 클릭** ─────────
    // 종전 v0.25.0 WS-2는 입력탭 마운트에서 prewarm(getUserMedia)을 돌렸다 — 탭에 들어가기만
    // 해도 권한 요청이 떴다. 이제 요청은 여기(시작 버튼의 사용자 제스처 콜스택)서만 일어난다
    // (iOS의 제스처 요건 [IOS-5]에도 부합). 승인되면 MIC_SETTLE_MS(1초) 정착 후에 화면을
    // 전환한다(민구 원문: "바로 음성 입력 화면 전환시 일부 초기 음성 클립 생성이 안됨").
    // 거부/실패 시에는 지연 없이 즉시 진행한다 — 기존 폴백(아래 fire-and-forget init 재시도 +
    // micLost/재연결 배너)이 그대로 받는다. 이 await 구간 phase는 아직 'ready'(화면 전환 전).
    if (startingRef.current) return false; // 정착 대기 중 재클릭 → 이중 세션 시작 차단
    startingRef.current = true;
    try {
      if (!recorderRef.current) recorderRef.current = new AudioRecorder();
      prog(1, '마이크 권한을 확인하는 중…');
      const granted = await recorderRef.current.init().catch(() => false);
      prog(2, granted ? '마이크가 준비됐어요' : '마이크를 열지 못했어요',
        granted ? undefined : '마이크 권한을 확인해 주세요');
      // 🔴 테스트 전용 우회(조용한 우회 금지): 픽스처가 `window.__micSettleSkipForTest = true`를
      //    세우면 **정착 지연만** 생략한다(요청 시점·횟수 계약은 그대로). 제품 경로의 1초 지연과
      //    이 우회 심 자체를 tests/v0440-c8-flow.spec.ts가 모두 오라클로 고정한다 — 심을 지우면 red.
      const skipSettle =
        (window as unknown as { __micSettleSkipForTest?: boolean }).__micSettleSkipForTest === true;
      if (granted && !skipSettle) {
        const t0 = Date.now();
        // ③ **음성 안내가 실제로 났는가.** 08-07 무음 사고(회차 SSOT §2)를 여기서 잡는다 —
        //    종전엔 세션이 한참 진행된 뒤에야 사용자가 알았다.
        prog(2, '음성 안내를 확인하는 중…');
        const warm = await ttsWarmup;
        const ttsOk = warm === 'spoken';
        prog(3, ttsOk ? '음성 안내가 준비됐어요' : '음성 안내가 나오지 않아요',
          ttsOk ? undefined : '소리가 안 들리면 일시정지 후 재시작해 주세요');
        // ④ **마이크 안정화** — 첫 클립 유실 완화(WS-2 승계 목적). 위 확인들이 이미 쓴 시간을
        //    빼고 남은 만큼만 기다린다. 🔑 **고정 대기가 아니라 「최소 보장」이다**(민구 요구).
        prog(3, '마이크를 안정시키는 중…');
        const spent = Date.now() - t0;
        if (spent < MIC_SETTLE_MS) await new Promise((r) => setTimeout(r, MIC_SETTLE_MS - spent));
        prog(4, '준비 완료');
        // 다음 로그에서 「시작 시점에 무엇이 준비됐나」를 판정할 수 있게 남긴다.
        logCell({ type: 'app', extra: `start_ready:audio=${audioOk ? 'ok' : audioCtxState},mic=${granted ? 'ok' : 'fail'},tts=${warm},ms=${Date.now() - t0}` });
      }
    } finally {
      startingRef.current = false;
      // 🔴 성공·실패·중도이탈 어느 경로로 빠져나가도 진행바를 반드시 지운다 —
      //    남으면 ready 화면에 유령 진행바가 붙는다.
      useSessionStore.getState().setStartProgress(null);
    }
    // 🔴 F18 리뷰 B1 — await 창에서 언마운트됐으면(탭 이탈) 여기서 끝낸다. 이 클로저가
    // 만든 레코더의 스트림을 되돌려 놓는다(획득 세대 카운터가 늦게 열린 스트림도 닫는다 —
    // audioRecorder [리뷰#6]). 세션은 올리지 않는다: 올리면 새 훅이 닿을 수 없는 고아다.
    if (disposedRef.current) {
      recorderRef.current?.dispose();
      recorderRef.current = null;
      return false;
    }

    sessionTargetRef.current = target;
    sessionColumnsRef.current = columns;
    setSessionColumns(columns);

    // v0.35.0 R3-FIX-1 — 방어적 초기화. stop()이 이미 풀지만, stop을 거치지 않은 경로(크래시 후
    //   재개·언마운트/리마운트 등)로 래치가 남아 들어와도 새 세션은 항상 깨끗한 상태에서 시작한다.
    //   already-false면 no-op(로그도 없음).
    clearUiSuspendLatch('start');
    // v0.45.0 WP-2 — 같은 방어: 이전 세션의 임계 타이머·유지 관측·정지 시퀀스가 새지 않게.
    clearBgOffTimer();
    bgKeepRef.current = null;
    bgOffGenRef.current += 1;

    const startTs = Date.now();
    sessionIdRef.current = `sess_${startTs}`;
    // v0.15.0 A3 — 같은 날 자동 세션명 중복 방지. 라벨 생성 출처(설정탭 sessionAutoLabel / 입력탭
    // buildAutoLabel)와 무관하게, 세션 생성 시점에 기존 세션 라벨과 충돌하면 `-2`,`-3`… 순번을 붙여
    // 고유화한다(데이터탭에서 같은 날 세션 구분). 라벨이 비면(undefined) 손대지 않는다.
    const baseLabel = label?.trim();
    sessionLabelRef.current = baseLabel
      ? ensureUniqueSessionLabel(baseLabel, useDataStore.getState().sessions.map((x) => x.label))
      : undefined;
    sess.resetAll();
    // v0.47.0 W4(FB-E) — 세션 경계: 영속 ✓ 집합 리셋(이전 세션의 확정 표시가 새지 않게).
    useSessionCommitMarks.getState().reset();
    // v0.47.0 C-FIX2b — 세션 경계: 셀 저장 실패 배너도 리셋(유령 배너 방지).
    useCellPersistError.getState().clear();
    // D-2 (RACE-7): persist session id/startedAt in the store so an in-app unmount during pause
    // can't lose them. MUST run AFTER resetAll() — resetAll clears sessionId/startedAt too.
    sess.setSessionMeta({ sessionId: sessionIdRef.current, startedAt: startTs, label: sessionLabelRef.current });
    sess.setPhase('active');
    sess.setActiveRow(1);
    sess.setActiveCol(0);

    if (!isSpeechSupported()) {
      sess.setLastTts('이 기기는 음성 인식을 지원하지 않습니다.');
      return false;
    }

    // 🔴 v0.46.1 WP-1 — `warmupTts()`는 **위 동기 구간으로 올렸다**(첫 await 앞).
    //    여기(gUM await + 1초 정착 뒤)에 있던 것이 08-07 TTS 무음 11건의 근인이었다.
    //    되돌리지 마라 — 되돌리면 iOS에서 다시 무음이 된다.
    // v0.5.0 W1: 세션 시작 시 음성 목록 재조회 1회 — iOS가 늦게 채운 한국어 음성을
    // 이 세션의 TTS가 바로 쓸 수 있게 하고, tts_voices_loaded 텔레메트리(개수 변화 시)도 남긴다.
    refreshVoices();
    epochRef.current = 0;
    pendingClipsRef.current = {};
    clipCapture.resetCounters();
    brokenClipKeysRef.current = new Set();
    correctionBackupRef.current = null;
    trendSkipLoggedRef.current = new Set();
    // v0.22.0 P0 — micLost 게이트 리셋: 이전 세션이 마이크 소실로 끝났어도 새 세션은 깨끗한
    // 스트림으로 시작한다(start()가 새 AudioRecorder.init()로 재획득).
    micLostLatchedRef.current = false;
    setMicLost(false);
    // (UI 음성명령 신호 클리어는 F18로 setPhase('active') **이전**으로 이동 — 위 주석 참조.)
    sessionTodayRef.current = localTodayISO();
    // v0.8.0: 과거값 인덱스 프리페치(fire-and-forget) — 마스터 토글 제거 → 이상치 알람 규칙
    // (방향 trendRule 또는 변동률 pctThreshold)이 한 컬럼이라도 있고 Google 연결 시에만.
    // loadPastIndex는 모든 실패를 null로 해소하고 past_index_skip 텔레메트리만 남기므로
    // 세션 시작 흐름을 절대 막지 않는다. 셀 단위 검사(evaluateTrend)는 이 캐시만 읽는다.
    // v0.34.0 D11a — 규칙 '개수'를 세션 스냅샷 meta에도 박제(개수만 — 컬럼명 등 내용 제외).
    const anomalyRuleCount = columns.filter(
      (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
    ).length;
    const anyAnomalyRule = anomalyRuleCount > 0;
    // v0.33.0 항목5 — 영속 폴백 하이드레이션(idempotent, 토큰 무관). 미로그인/토큰 만료 세션에서도
    // IDB 스냅샷이 있으면 evaluateTrend가 폴백으로 알람을 발화한다(App 부트 경로와 이중 안전망).
    void hydratePastIndexFallback();
    // v0.34.0 C9(d) — 토큰 조건을 (토큰 || API key)로 완화(readonlySheetsAuth SSOT). 공개 시트면
    // 토큰 만료 세션에서도 신선 인덱스를 당길 수 있다 — [TREND-AUTH-1]의 침묵 창이 좁아진다.
    if (anyAnomalyRule && readonlySheetsAuth()) { resetPastIndexRetries(); prefetchPastIndex(); }
    logger.setSessionId(sessionIdRef.current);
    // #1 reach telemetry: attach session-meta alongside the existing `extra:'start'` tag.
    // `extra` is preserved so any analysis keying on it keeps working; new fields are additive.
    logCell({
      type: 'session',
      extra: 'start',
      meta: {
        appVersion: logger.device().appVersion,
        startedAt: Date.now(),
        totalRows: total,
        completedRows: 0,
        // v0.23.0 입력탭#2 — 세션 시작 시 활성 인식 허용범위를 박제(설정값 미로깅 갭 해소).
        recognitionTolerance: s.recognitionTolerance,
        // v0.34.0 D11a — 세션 시작 설정 스냅샷(자가검증 계측): 비프 최종 선택·TTS 속도·자동 캡처·
        // 이상치 규칙 규모를 로그만으로 판정. anomalyRuleCount는 개수만(컬럼명 등 내용 제외).
        ttsRate: s.ttsRate,
        beepPositiveId: s.beepPositiveId,
        beepNegativeId: s.beepNegativeId,
        autoScreenCapture: s.autoScreenCapture,
        anomalyRuleCount,
        // v0.45.0 WP-1③ — D1 말끊기 스냅샷(축 C 판정 전제). :2512가 이미 읽는 같은 s를 재사용.
        bargeInEnabled: s.bargeInEnabled,
        // NOTE: session label intentionally NOT logged — buildAutoLabel derives it from the first
        // fixed auto column (농가명 = grower name), a PII vector. Reach is fully computable from
        // sessionId + appVersion + totalRows + completedRows. The label still lives on the Session
        // object (unchanged); it just stays out of telemetry events.
        sessionMode: 'field',
      },
    });

    // F18 이후에도 이 fire-and-forget init은 남긴다: 위 선행 획득이 성공했으면 멱등(스트림 존재 →
    // 즉시 true, getUserMedia 재호출 없음)이고, 거부/실패였으면 여기가 재시도 폴백이다. ui_fx/
    // input_device 텔레메트리의 방출 지점이기도 하다. STT 기동을 막지 않도록 await하지 않는다.
    if (!recorderRef.current) recorderRef.current = new AudioRecorder();
    // 🔴 v0.43.0 #4 — 레코더는 **세션 간 재사용된다**(위 조건이 null일 때만 새로 만든다). 그래서
    //   백그라운드에서 캡처를 끈 뒤 복귀 이벤트를 못 받고 세션이 끝나면(탭 unmount 등) 트랙이
    //   꺼진 채 남아 **다음 세션이 조용히 무음을 녹음한다.** 세션 경계에서 무조건 되돌린다.
    recorderRef.current.setCaptureEnabled(true);
    // v0.34.0 D11b — 파동 통계 리셋: F18의 선행 획득(클릭~1초 정착)이 세션 확정 전부터 캡처를
    // 돌리므로 세션 밖 구간이 wave_stats에 섞이지 않게 시작 시점에 0으로 되돌린다.
    recorderRef.current.resetWaveStats();
    // #4 active mic: once init() resolves, emit a follow-up session event carrying the granted
    // input device. Done async (not awaited) so STT startup is never blocked; emitted as its own
    // event so analysis can attribute STT accuracy to the real device per session.
    const recAtStart = recorderRef.current;
    void recAtStart.init().then((ok) => {
      // v0.34.0 D11b — UI 이펙트 자가검증 1건: 파동/글로우 활성 + 프리롤 캡처 경로. init 실패
      // (ok=false)여도 남긴다 — preroll=unavailable이 곧 "파동 무동작(레벨 0 폴백)" 판정 근거.
      logCell({
        type: 'session',
        extra: `ui_fx:wave=on,glow=on,preroll=${recorderRef.current?.getPrerollKind() ?? 'unavailable'}`,
      });
      if (!ok) {
        // v0.44.1 [CLIP-INIT-SILENT-1] — 시작 마이크 획득 실패는 여기까지 **무음**이었다.
        // 2026-08-05 실기기(sess_1785877588821): 85분 백그라운드 복귀 뒤 시작 클릭의 gUM이 즉시
        // 거부됐는데([MIC-B2] 물림 클래스) 아무 경고가 없어 37분·63행이 클립 0개로 돌았고, 수동
        // 재연결 16회도 전부 NotAllowedError였다(물림은 페이지 수명 내내 지속 — 실효 복구는 앱
        // 재시작뿐). 값 커밋(STT)은 이 스트림과 무관해 정상이므로 세션은 막지 않는다. 대신
        // ①실패 사유 계측 ②micLost 래치(재연결 배너를 첫 화면부터) ③TTS 1회 고지(현장은
        // 화면을 안 본다)를 즉시 한다. TTS는 interrupt=false — 시작 안내를 끊지 않고 뒤에 잇는다.
        if (disposedRef.current || recorderRef.current !== recAtStart) return;
        logCell({ type: 'error', extra: micInitFailed(recAtStart.getLastInitError() ?? 'unknown') });
        maybeAutoRecoverOrLatch('init_failed');
        void say('주의. 음성 클립이 저장되지 않습니다. 재연결이 안 되면 앱을 껐다 다시 열어 주세요.', false).catch(() => {});
        return;
      }
      const input = recorderRef.current?.getActiveInput();
      if (!input) return;
      logCell({
        type: 'session',
        extra: 'input_device',
        meta: {
          appVersion: logger.device().appVersion,
          inputDeviceId: input.deviceId,
          inputDeviceLabel: input.label,
        },
      });
      // §5-1 ③(v0.44.0) — 입력장치 종류 계측: 세션 시작 시 best-effort 분류 + 원시 라벨 1회.
      // §D의 인과(스피커폰 half-duplex 필요)를 다음 실기기 로그에서 로그만으로 확정하는 축이다.
      // 분류 휴리스틱·한계(출력 경로 측정 불가 = speakerphone 부재, [AUDIO-INPUT-2] frozen 라벨)는
      // classifyAudioInputClass 주석이 SSOT. 장치 변경 감지 시의 방출은 audioRecorder의
      // emitInputDeviceChanged(라벨 실제 전이 게이트)에 동승한다 — 링버퍼 잠식 없음.
      logCell({
        type: 'session',
        extra: audioInputClass({ cls: classifyAudioInputClass(input.label), src: 'session_start' }),
        text: input.label,
      });
    }).catch(() => {});

    await say('음성 입력을 시작합니다.');
    await announceRowDiff(null, 1);

    // 🔴 v0.43.0 1c [TEST-CLIP-F-1] — **start()가 UI suspend 래치를 존중한다.**
    //   위 두 await(시작 TTS·행 안내)는 실기기에서 수 초다. 그 창에 오버레이(개선요청·수동입력·
    //   도움말·종료확인)가 열리면 suspendRecognitionForUi가 이미 돌아 래치가 걸려 있는데,
    //   종전 코드는 그걸 확인하지 않고 인식기를 새로 만들어 기동했다 — **모달 뒤에서 STT가 살아
    //   배경 발화가 셀에 커밋되는 데이터 무결성 결함**(판정: v037-suspend-latch A의 오라클 위반).
    //   덤으로 hadController가 false로 스냅샷돼 모달을 닫아도 재무장이 죽었다(F가 red였던 이유).
    //   → 래치가 걸려 있으면 **인식기를 만들지 않고 복원 의무만 남긴다.** 마지막 소스가 해제되면
    //   resumeRecognitionForUi가 :2358에서 인식기를 만들고 :2355가 pending 좌표로 재무장한다.
    //   **새 경로를 만들지 않는다 — 기존 복원 경로에 그대로 합류한다.**
    if (uiSuspendRef.current.reasons.size > 0) {
      uiSuspendRef.current.hadController = true;
    } else {
      ctrlRef.current = new SpeechController({
        onFinal: handleFinal,
        onInterim: handleInterim,
        onError: () => {},
      });
      setActiveController(ctrlRef.current);
      ctrlRef.current.start();
    }

    await announceField(vc[0]);
    return true;
  }, [announceField, announceRowDiff, handleFinal, handleInterim, say, clearUiSuspendLatch]);

  const stop = useCallback(async (announce = true) => {
    const phaseAtEntry = useSessionStore.getState().phase;
    // v0.35.0 P1 — 종료 teardown 전체를 단일 비대화형 phase로 잠근다. 첫 await보다 먼저 전환해야
    // pause→stop 사이 재시작, 완료행 이동, 중복 stop이 같은 이벤트 루프 틈에서도 끼어들 수 없다.
    if (phaseAtEntry === 'stopping') return false;
    useSessionStore.getState().setPhase('stopping');
    setActiveController(null);
    ctrlRef.current?.stop();
    ctrlRef.current = null;
    cancelTts();
    awaitingFieldRef.current = null;
    // 리뷰 라운드1(Codex+Flash, 수용) — 종료 전환 시 미확정 interim 표시 정리(표시 전용).
    useSessionStore.getState().setInterimValue(null);
    // v0.47.0 W2(FB-G①) — 세션 종료도 종단 착지: 수정 표시·성공 국면 명시 해제(잔존 방지).
    useSessionStore.getState().setModifyIndicator(null);
    useModifyPhase.getState().setCommitted(false);
    // v0.47.0 C-FIX2b — 셀 저장 실패 배너 해소: stop의 persistSession이 세션 전체(미저장 셀 값
    // 포함)를 다시 쓰고, 그 실패는 stop 전용 persistError 모달이 이어받는다(이중 모달 방지).
    useCellPersistError.getState().clear();
    // v0.35.0 R3-FIX-1 — 종료 확인 '확인' 경로는 resume 없이 여기로 온다. 래치를 여기서 풀지 않으면
    //   다음 세션의 모달 suspend가 전부 조기 반환돼 STT가 안 멈춘다. 복원은 불필요(세션 종료 중).
    clearUiSuspendLatch('stop');
    // v0.45.0 WP-2 — 세션 경계: 임계 타이머·유지 관측 정리 + 진행 중 정지 시퀀스 무효화(세대).
    clearBgOffTimer();
    bgKeepRef.current = null;
    bgOffGenRef.current += 1;
    // #1 reach telemetry: session-meta on stop. `extra:'stop'` preserved; new fields additive.
    // completedRows here is the denominator-complement for reach/completion-rate aggregation.
    {
      const sessNow = useSessionStore.getState();
      const input = recorderRef.current?.getActiveInput();
      logCell({
        type: 'session',
        extra: 'stop',
        meta: {
          appVersion: logger.device().appVersion,
          startedAt: parseInt(sessionIdRef.current.replace('sess_', ''), 10) || undefined,
          finishedAt: Date.now(),
          totalRows: computeTotalRows(getSessionColumns()),
          completedRows: sessNow.completedRows.length,
          // label intentionally omitted (PII — grower name); see start-event note.
          inputDeviceId: input?.deviceId,
          inputDeviceLabel: input?.label,
          sessionMode: 'field',
        },
      });
    }
    // v0.34.0 D11b — 세션 파동 통계 1건(stop 직전, dispose 전에 읽는다). audioRecorder가 세션
    // 동안 누적한 요약치만 — 고빈도 로깅 절대 금지(ring buffer 2000 보호). 프리롤 미가용이면
    // 통계가 없어(null) 생략 — ui_fx의 preroll=unavailable이 부재 사유를 설명한다.
    {
      const ws = recorderRef.current?.getWaveStats();
      if (ws) {
        logCell({
          type: 'session',
          extra: `wave_stats:peak=${ws.peak.toFixed(2)},avg=${ws.avg.toFixed(2)},activePct=${ws.activePct}`,
        });
      }
    }
    if (announce) await say('입력을 종료합니다.');
    // Codex 3차 HIGH: 클립 저장을 dispose보다 먼저 flush.
    // dispose는 in-flight stopClip의 resolveStop을 null로 해소하지만(zombie 방지),
    // 가능하면 자연 onstop으로 실제 blob을 저장하는 것이 우선.
    // 5초 안전 타임아웃: dispose가 즉시 해소하므로 일반적으로 즉시 끝나지만 race 대비.
    await clipCapture.flushSaves(5000);
    recorderRef.current?.dispose();
    recorderRef.current = null;
    // v0.10: await로 변경 — audioClips 키가 IDB session에 확실히 저장된 후 종료
    // v0.35.0 R3-FIX-2(리뷰 라운드3, Codex High·데이터무결성) — 반환값을 **더 이상 무시하지 않는다**.
    //   persistSession은 IDB 쓰기 실패 시 false를 돌려주는데(그 자체는 이미 session_persist_failed로
    //   로깅됨 — 여기서 중복 로깅하지 않는다), 종전엔 곧장 setPhase('ready')로 넘어가 **최신 값·클립
    //   포인터가 미저장인 채** 새 세션을 시작할 수 있었다(start()의 resetAll이 메모리 사본까지 지워
    //   복구 기회 소멸). v0.34.0 "durable 실패를 삼키지 않는다" 원칙과 정면 충돌 → 실패면 ready 미전환.
    const durable = await persistSession();
    if (!durable) {
      // stopping을 유지해 '음성 입력 시작' 버튼과 모든 세션 컨트롤을 띄우지 않는다
      //   → 새 세션의 resetAll이 미저장 값을 덮을 수 없다. 화면엔 재시도 배너(VoiceScreen).
      //   logger.setSessionId도 유지 — 재시도/후속 이벤트가 같은 세션에 귀속돼야 한다.
      useSessionStore.getState().setPersistError({ retrying: false });
      logCell({
        type: 'session', extra: 'stop_persist_check:write_failed',
        row: useSessionStore.getState().activeRow,
      });
      return false;
    }
    // v0.35.0 R2-FIX-1(리뷰 라운드2, Flash Critical·데이터무결성) — setPhase('ready')를 **persist
    //   완료 뒤**로 이동. 종전엔 이 위(say/clip flush/dispose/persist await 전)에서 ready로 렌더돼,
    //   그 await 구간에 사용자가 '음성 입력 시작'을 누르면 start()의 resetAll+새 sessionId가 최종
    //   flush·audioClips 키를 덮어써 오염될 수 있었다. persist 완료까지 UI가 전용 'stopping'을
    //   유지 → race 창 제거. teardown~persist 사이 로직은 phase==='ready'에 의존하지 않음(확인).
    useSessionStore.getState().setPersistError(null);
    logCell({
      type: 'session', extra: 'stop_persist_check:ok',
      row: useSessionStore.getState().activeRow,
    });
    useSessionStore.getState().setPhase('ready');
    logger.setSessionId(undefined);
    sessionTargetRef.current = null;
    sessionColumnsRef.current = null;
    setSessionColumns(null);
    return true;
  }, [persistSession, say, clearUiSuspendLatch]);

  /** v0.35.0 R3-FIX-2 — 최종 저장 실패 후 **저장만** 재시도한다. stop()의 teardown(인식기 정지·
   *  recorder dispose·종료 안내·session:stop 로그)은 이미 끝났으므로 stop() 전체를 다시 돌리지
   *  않는다 — 값·클립 포인터는 메모리(sessionStore/pendingClipsRef)에 그대로 살아 있어 persist만
   *  다시 쏘면 된다. 성공하면 그때 비로소 ready로 전환한다. */
  const retryFinalPersist = useCallback(async (): Promise<boolean> => {
    const store = useSessionStore.getState();
    if (!store.persistError || store.persistError.retrying) return false;
    store.setPersistError({ retrying: true });
    const durable = await persistSession();
    logCell({
      type: 'session', extra: `stop_persist_retry:${durable ? 'ok' : 'write_failed'}`,
      row: useSessionStore.getState().activeRow,
    });
    if (!durable) {
      useSessionStore.getState().setPersistError({ retrying: false });
      return false;
    }
    useSessionStore.getState().setPersistError(null);
    useSessionStore.getState().setPhase('ready');
    logger.setSessionId(undefined);
    sessionTargetRef.current = null;
    sessionColumnsRef.current = null;
    setSessionColumns(null);
    return true;
  }, [persistSession, clearBgOffTimer]);

  /** Pause STT value processing without stopping the controller.
   *  The controller stays active so the user can say '재시작' to resume.
   *  Recorder is disposed to prevent clip accumulation while paused. */
  // v0.20.0 Phase 5 #3 — 일시정지/재개에 진입·해제 방식(source)을 명시 동봉. 'voice'=음성 명령,
  // 'touch'=마이크 버튼 탭. 기존 호출부(VoiceScreen 탭)는 인자 없이 호출하므로 기본값을 둔다 —
  // 그 경로가 곧 touch다. extra를 `phase:<source>`로 확장(신규 이벤트 타입 무첨가, log-replay 호환).
  // 다음 분석이 "일시정지 횟수 + 어떤 방식으로 해제했는지"(민구 요청·Trace #4)를 정량화한다.
  const pause = useCallback(async (source: 'voice' | 'touch' = 'touch') => {
    if (useSessionStore.getState().phase === 'stopping') return;
    // v0.34.0 리뷰 라운드2(Codex High) — manualHold 중 일시정지 거부. paused 진입은 팝업 렌더를
    // PausedCard로 교체해(VoiceScreen 분기: paused가 알람보다 우선) 보류를 화면에서 지워버린다.
    if (isManualHoldBlocked('pause')) return;
    logCell({ type: 'command', parsed: 'pause', extra: `phase:${source}`, row: useSessionStore.getState().activeRow });
    cancelTts();
    // dispose가 in-flight stopClip을 null로 해소해 정상 클립이 clip_empty로 떨어지는 것을 방지:
    // stop()과 동일하게 pending save를 먼저 flush.
    await clipCapture.flushSaves(PAUSE_FLUSH_GRACE_MS);
    recorderRef.current?.dispose();
    recorderRef.current = null;
    useSessionStore.getState().setPhase('paused');
    // 리뷰 라운드1(Codex+Flash, 수용) — 일시정지 진입 시 미확정 interim 표시 정리. 발화 도중
    // 정지하면 final이 안 와, 재개 화면에 이전 발화가 현재 값처럼 남던 찌꺼기 차단(표시 전용).
    useSessionStore.getState().setInterimValue(null);
    useSessionStore.getState().setLastTts('일시정지됨. 마이크 다시 탭하면 재개됩니다.');
    await say('일시정지됨.');
  }, [say]);

  /** Resume from paused: re-announce current field. Controller is kept alive during pause. */
  const resume = useCallback(async (source: 'voice' | 'touch' = 'touch') => {
    const sess = useSessionStore.getState();
    if (sess.phase === 'stopping') return;
    if (sess.phase !== 'paused') return;
    // v0.20.0 Phase 5 #3 — 해제 방식 동봉(voice='재시작' 음성, touch=마이크 버튼). 일시정지가 어떤
    // 경로로 풀렸는지를 정량화해 "분투→해제" 패턴(강남호 13/14 churn)을 다음 세션부터 분해한다.
    logCell({ type: 'command', parsed: 'resume', extra: `phase:${source}`, row: sess.activeRow });
    sess.setPhase('active');
    epochRef.current = 0;
    // Controller stays alive during pause (pause() no longer stops it).
    // Recreate only if it was somehow stopped (e.g., programmatic stop from outside).
    if (!ctrlRef.current) {
      ctrlRef.current = new SpeechController({
        onFinal: handleFinal,
        onInterim: handleInterim,
        onError: () => {},
      });
      setActiveController(ctrlRef.current);
      ctrlRef.current.start();
    }
    // Recorder was disposed during pause — recreate for the resumed session.
    if (!recorderRef.current) {
      recorderRef.current = new AudioRecorder();
      await recorderRef.current.init().catch(() => {});
      // v0.22.0 P0 — 재개는 fresh AudioRecorder.init()로 살아있는 스트림을 새로 잡으므로 micLost
      // 게이트를 푼다(일시정지 전 마이크 소실로 켜졌던 재연결 버튼이 멀쩡한 마이크에 남지 않게).
      micLostLatchedRef.current = false;
      setMicLost(false);
    }
    const vc = voiceColsList();
    const cur = vc[sess.activeColIdx];
    await say('재시작.');
    // v0.45.0 WP-3 (F14) — 재시작 브리핑: 현재 행 요약("나무 3, … 45.1. 다음.") 뒤에
    // announceField가 항목명을 잇는다(Q5 형식 완성: "…, 다음, 횡경."). 일시정지 중 복귀는
    // 브리핑을 생략하고 이 '재시작' 시점이 담당한다(Q4-답 — 이중 낭독 방지).
    const briefing = buildReturnBriefing(false);
    if (briefing) await say(briefing, false);
    // 🔴 v0.47.0 C-FIX1ⓐ(리뷰 U2, Codex 프로브 재현) — **수정 재청취 중 일시정지→재개가 수정
    //   문맥을 지우면 안 된다.** 종전엔 무옵션 announceField(cur)가 awaiting을 kind:'value'로
    //   덮고 modifyIndicator를 해제해, 성공 커밋 전인데 amber가 꺼지고(green 오표시) 다음
    //   발화가 '수정'이 아닌 일반 커밋 의미론으로 흘렀다. pause()는 awaitingFieldRef를 보존
    //   하므로 여기서 그 문맥을 그대로 재안내한다(isModify — 진입 중립음·amber·previousValue 복원).
    // 🔴 C-FIX1b(2차 재검증) — **문맥은 전체를 보존한다.** 1차는 kind·previousValue만 넘겨
    //   fractionWhole(소수부 재질문의 정수부, :88-93)이 유실됐다 — "111 점 에" 재질문 중
    //   일시정지→재시작 뒤 "5"가 111.5 합성 대신 전체값이 될 수 있다(값 추측 금지 계약 :113-120이
    //   데이터 오염으로 규정). announceField에 fractionWhole 전달로를 뚫어 재구성이 무손실이
    //   되게 했다(value-kind 재질문도 같은 축 — 아래 announceField(cur) 호출에 동일 전달).
    {
      const awaiting = awaitingFieldRef.current;
      const fw = awaiting ? fractionWholeOf(awaiting) : undefined;
      if (awaiting?.kind === 'modify') {
        const target = getColById(awaiting.colId);
        if (target) {
          await announceField(target, { isModify: true, previousValue: awaiting.previousValue, fractionWhole: fw });
          return;
        }
      }
      // C-FIX1b — trendConfirm(이상치 응답 대기)도 같은 축이다(실측 확인: 터치 [일시정지]는
      // manualHold만 막고 trendConfirm은 통과한다). announceField(cur)를 부르면
      // clearAnomalyAlert('announce_field')가 알람을 지우고 awaiting이 value로 덮여 **확인
      // 루프가 무응답으로 소멸**한다. 재구성하지 않고 그대로 둔다 — 팝업은 paused 해제로
      // 다시 보이고, awaiting·previousValue·fractionWhole 전부 산 채로 응답을 기다린다.
      // 응답 발화 클립만 재무장한다(pause가 recorder를 dispose했다 — 알람 시점의 arm은 죽었다).
      if (awaiting?.kind === 'trendConfirm') {
        armClipForCell(awaiting.row, awaiting.colId);
        return;
      }
      // 🔴 v0.49 fix49 — 셀 검토 대기(cellWait)도 **문맥을 보존해야 하는 국면**이다(위 두 분기와
      //   같은 축). 여기서 아래 `announceField(cur)`로 떨어지면 커서가 서 있던 **값 있는 셀에
      //   `kind:'value'`가 다시 열려** B-1이 재개방된다 — 실측 확인: 35.1 주차 → 일시정지 →
      //   재시작 → "99.9" → 셀이 99.9. 이동 경로만 막고 여기를 두면 처방이 반만 닫힌다.
      //   ⚠️ v0.49 r6 Y2 — 종전 이 자리의 *"`reviewWait`/`atEnd`도 같은 형태로 새지만 선행
      //   파손이라 건드리지 않는다(`_ASK-fix49` Q5). 고칠 사람은 이 목록에 두 kind를 더 얹으면
      //   된다"* 를 **집행한다.** 실측(fixr6): 끝 도달에서 일시정지→재시작 뒤 「측정항목01.」이
      //   나오고(=확정 셀에 `kind:'value'` 개방) 이어 말한 값이 **확정값 35.1을 99.9로 덮었다.**
      //   검토 대기도 같다 — 완료 행 착지가 일시정지 중이면(착지는 `armLanding`이 국면만 보류하고
      //   센티넬은 세운다) 재시작이 그 문맥을 버리고 값을 연다.
      if (awaiting?.kind === 'cellWait') {
        const target = getColById(awaiting.colId);
        if (target) { await enterCellWait(target, awaiting.previousValue); return; }
      }
      // 🔴 Y2 — 두 착지는 **다시 착지시켜** 복원한다(문맥 재구성이 아니라 재실행). 그래야 국면이
      //   일시정지에 보류됐던 경우까지 함께 낫는다: `armLanding`의 paused 분기는 `setPhase`와
      //   `setEndReached`를 건너뛰므로(그 헤더) 보류된 착지의 **래치**는 아무도 복원하지 않는데,
      //   여기서 착지를 다시 부르면 phase·endReached·센티넬·낭독이 한 벌로 다시 선다.
      //   ⚠️ 이 시점 phase는 위에서 이미 `'active'`라 paused 가드에 걸리지 않는다.
      if (awaiting?.kind === 'atEnd') { await announceEndReached(); return; }
      if (awaiting?.kind === 'reviewWait') { await enterReviewWait(awaiting.row); return; }
      if (cur) await announceField(cur, fw != null ? { fractionWhole: fw } : undefined);
    }
  }, [announceEndReached, announceField, armClipForCell, enterCellWait, enterReviewWait, handleFinal, handleInterim, say, buildReturnBriefing]);

  // Keep resumeRef in sync so handleFinal can call resume without a circular dep.
  useEffect(() => { resumeRef.current = resume; }, [resume]);

  // hydrateSessions가 IDB의 pendingValidation을 sessionStore에 복구한 뒤 VoiceScreen이 마운트된다.
  // 팝업만 복원하고 이 내부 포인터를 비워 두면 [확인]이 advance 문맥을 잃으므로 같은 셀/검토대기를
  // 재구성한다. manualHold 게이트가 살아 있어 복구 중 STT가 후보를 우회 커밋할 수는 없다.
  useEffect(() => {
    const live = useSessionStore.getState();
    const restoredSession = useDataStore.getState().sessions.find((s) => s.id === live.sessionId);
    const pending = restoredSession?.pendingValidation;
    if (!pending || !live.anomalyAlert?.manualHold) return;
    sessionIdRef.current = live.sessionId;
    sessionLabelRef.current = live.sessionLabel;
    sessionTargetRef.current = restoredSession.target ?? null;
    sessionColumnsRef.current = restoredSession.columns;
    setSessionColumns(restoredSession.columns);
    logger.setSessionId(live.sessionId);
    // v0.47.0 W4(FB-E) 🟡 hydrate 가정 — 복원 세션의 **값이 있는 셀 = 과거 성공 커밋**으로
    //   ✓ 집합을 재구성한다("이 칸은 채워졌다"는 reload를 넘어 이어진다고 읽음). 단, 지금
    //   복구 중인 미확정 후보 셀(pending)은 제외 — [확인] 시점에 add된다.
    {
      const seed: Array<{ row: number; colId: string }> = [];
      for (const r of restoredSession.rows) {
        for (const [colId, v] of Object.entries(r.values)) {
          if (v !== '' && !(r.index === pending.row && colId === pending.colId)) {
            seed.push({ row: r.index, colId });
          }
        }
      }
      useSessionCommitMarks.getState().reset(seed);
    }
    const col = getColById(pending.colId);
    if (!col) return;
    awaitingFieldRef.current = pending.reviewWait
      ? { kind: 'reviewWait', row: pending.row, colId: pending.colId, name: col.name }
      : { kind: 'modify', row: pending.row, colId: pending.colId, name: col.name, previousValue: pending.candidateValue };
    // reload 전 컨트롤러 인스턴스는 사라진다. 팝업만 복원하면 테스트의 fireResult가 optional no-op이고,
    // [확인] 뒤 다음 셀도 영구 무음이 된다. 실제 SpeechController를 다시 만들되 manualHold 중앙 게이트가
    // 복구 직후 STT 결과를 모두 거부하므로 후보는 터치 전용 계약을 유지한다.
    if (isSpeechSupported() && !ctrlRef.current) {
      ctrlRef.current = new SpeechController({
        onFinal: handleFinal,
        onInterim: handleInterim,
        onError: () => {},
      });
      setActiveController(ctrlRef.current);
      ctrlRef.current.start();
      logger.log({ type: 'stt', extra: 'manual_hold_restore_controller:started', sessionId: live.sessionId, row: pending.row, colId: pending.colId });
    }
  }, [handleFinal, handleInterim]);

  // ── v0.33.0 항목4 — 포그라운드 복귀 즉시 복구(visibilitychange + pageshow) ─────────
  // 세션 활성 중(active/complete/paused — paused도 음성 '재시작'을 들어야 하므로 포함) 화면이
  // 다시 보이면: ① TTS 엔진 해동(resume — iOS가 백그라운드에서 paused로 얼려둠) ② 인식기
  // 워치독 1회 즉시 실행(kick — 죽었으면 즉시 부활, 최대 4초 tick 대기 제거) ③ 마이크 트랙
  // 정밀 판정: 'ended'만 micLost 래치(기존 배너/재연결 버튼 재사용), 'muted'는 unmute 대기 +
  // mic_track:* 텔레메트리. **제스처 밖 getUserMedia 재획득은 하지 않는다([IOS-5]).**
  // v0.38.1 [MIC-B2] ④ **장기 백그라운드(≥LONG_BACKGROUND_TEARDOWN_MS) 복귀면 낡은 오디오 그래프
  // 선-정리**(teardownAudioGraph) — 이건 phase 게이트보다 앞에서, 재획득 없이 정리만 한다. iOS
  // 오디오 세션이 물린 채 낡은 AudioContext가 그걸 붙들고 있으면 이후 제스처 재연결의 gUM이
  // NotAllowedError로 즉시 거부되는데(2026-07-24 실기기 세션B: 8시도/0성공), 첫 재연결 시도가
  // 그 컨텍스트 참조를 버리므로 **닫을 수 있는 창은 여기뿐**이다.
  // 인앱 탭 전환([STT-16])은 visibility가 안 변하므로 이 경로가 아니라 App.tsx의 keep-alive
  // 렌더(세션 활성 중 VoiceScreen 유지)가 담당한다.
  useEffect(() => {
    // v0.38.2 F5 — 복귀 시 오디오 경로 재검증 계측. 발행 여부 판단은 순수 함수
    // (`shouldEmitRouteRevalidate`)에 있어 브라우저 없이 경계를 검증한다.
    // 값은 raw 장치명이 아니라 CATEGORY — OS별 표기 편차를 걷어내고 개인 장치명도 로그에 남기지 않는다.
    const emitRouteRevalidate = async (
      evt: 'vis' | 'pageshow',
      beforeLabel: string | null,
      backgroundMs: number,
    ) => {
      const emit = (fields: Parameters<typeof audioRouteRevalidate>[0]) => {
        try {
          logCell({ type: 'clip', extra: audioRouteRevalidate(fields) });
        } catch {
          /* best-effort 계측 — 로그 실패가 복귀 경로를 막지 않는다 */
        }
      };
      // 레코더 미초기화 — 비교할 경로 자체가 없다.
      // 🔴 v0.42.0 계측 F: **여기서는 방출하지 않는다.** 같은 복귀의 `foreground_return`이
      // `teardown=no_recorder`로 이미 이 사실을 남긴다(2026-07-29 로그 실측 확인). 여기서 또
      // 남기면 레코더가 붙기 전 모든 복귀(`bg_s=0` 즉시 pageshow 포함)가 로그를 채워
      // **2000개 링버퍼를 잠식한다** — `[F5]` 스펙이 "임계 미만 무발행"을 계약으로 못박은 이유다.
      const rec = recorderRef.current;
      if (!rec) return;
      try {
        const { label, track, status } = await rec.revalidateActiveInput();
        // 🔴 **관측 못 한 것을 '내장 마이크'로 확정하지 않는다**(라운드A 리뷰 Codex #2).
        // `classifyInputDevice`는 빈 라벨을 내장으로 폴백하는데, 그건 **UI 배지의 표시 규칙**이지
        // "관측됐다"는 뜻이 아니다. 그 의미를 텔레메트리에 재사용하면 실기기 판독에서 `unknown`과
        // 진짜 내장 마이크를 구별할 수 없다.
        const observed = status === 'ok' && label !== null && track !== 'none';
        const afterCategory = observed ? classifyInputDevice(label).text : 'unknown';
        const beforeCategory = beforeLabel === null ? null : classifyInputDevice(beforeLabel).text;
        // 방출 게이트(경로 무변화 + 임계 미달)도 조용히 빠진다 — **의도된 침묵이다.**
        // 같은 복귀의 `foreground_return:bg_s`가 임계 미달 사실을 남기고 있어 판독이 가능하고,
        // 여기서 방출하면 짧은 탭 전환마다 로그가 쌓여 링버퍼를 잠식한다(위 `!rec`과 같은 이유).
        if (!shouldEmitRouteRevalidate({ beforeCategory, afterCategory, backgroundMs })) return;
        emit({
          before: beforeCategory ?? 'unknown',
          after: afterCategory,
          track,
          status,
          evt,
          backgroundMs,
        });
      } catch {
        emit({
          before: 'unknown',
          after: 'unknown',
          track: 'none',
          status: 'error',
          evt,
          backgroundMs,
        });
      }
    };

    const onForegroundReturn = (evt: 'vis' | 'pageshow') => {
      // reducer가 hiddenAt을 소비하기 **전**에 캡처한다. visible 직후 pageshow가 연달아 와도
      // 첫 이벤트만 true라 실제 백그라운드 사이클당 foreground_return은 정확히 1건이다.
      const hadHiddenCycle = foregroundReturnRef.current.hiddenAt !== null;
      const decision = reduceForegroundReturn(
        foregroundReturnRef.current,
        evt === 'vis' ? 'visible' : 'pageshow',
        Date.now(),
      );
      foregroundReturnRef.current = decision.state;
      // v0.38.2 F5 — 오디오 경로 재검증. teardown과 **같은 복귀 이벤트에서 짝으로** 읽히도록 여기서
      // 시작한다(비동기라 순서는 보장 안 되지만 같은 복귀 구간임은 bg_s로 대조된다).
      // phase 게이트보다 앞인 이유도 teardown과 같다 — 캡처가 세션 확정 전(F18: 시작 클릭~1초
      // 정착 구간, 구 prewarm 계보)부터 붙을 수 있다.
      void emitRouteRevalidate(evt, decision.hiddenInputLabel, decision.backgroundMs);
      // v0.38.1 [MIC-B2] 낡은 오디오 그래프 선-정리는 **세션 phase보다 먼저, phase와 무관하게** 본다.
      // (원 근거였던 「prewarm이 세션 전부터 캡처를 붙여둔다」는 F18로 사라졌지만, paused/stopping
      // 등 phase 게이트 밖 구간과 F18 선행 획득~정착 창이 남아 있어 순서는 유지한다.)
      // 물린 그래프를 진 채 세션을 시작하면 첫 획득부터 인터럽트된 오디오 세션 위에서 돈다.
      // 재획득은 하지 않는다([IOS-5] 유지) — 정리만.
      // F6 — 복귀당 정확히 1건. completed는 teardown Promise가 **실제로 끝난 뒤**에만 기록한다.
      // close/reattach 상세의 정본은 기존 mic_teardown이고, 여기서는 skipped/no_recorder/
      // completed/failed로 복귀 처리 결과만 요약한다(PRINCIPLES §4 중복 계측 금지).
      void resolveForegroundReturnEvent({
        hadHiddenCycle,
        shouldTeardown: decision.shouldTeardown,
        backgroundMs: decision.backgroundMs,
        evt,
        recorder: recorderRef.current,
      }).then((extra) => {
        if (extra) logger.log({ type: 'app', extra });
      });
      const phase = useSessionStore.getState().phase;
      if (phase !== 'active' && phase !== 'complete' && phase !== 'paused') return;
      resumeTtsEngine();
      const result = ctrlRef.current ? ctrlRef.current.kick() : 'no_controller';
      logCell({ type: 'stt', extra: `kick_result:${evt}:${result}` });
      const rec = recorderRef.current;
      if (!rec) return;
      const trackState = rec.getTrackState();
      if (trackState === 'ended') {
        // 진짜 사망(트랙 종료)만 래치 — reconnectMic 자동 1회 후 실패 시 사용자 제스처로 복구.
        if (!micLostLatchedRef.current) {
          micLostLatchedRef.current = true;
          setMicLost(true);
          logCell({ type: 'clip', extra: `mic_track:ended:${evt}` });
        }
      } else if (trackState === 'muted') {
        // UA 일시 정지(통화/Siri/라우트 변경) — 분리로 오판해 래치하지 않고 unmute를 기다린다.
        logCell({ type: 'clip', extra: `mic_track:muted:${evt}` });
        rec.onceTrackUnmuted(() => {
          logCell({ type: 'clip', extra: 'mic_track:unmuted' });
        });
      }
      // 'live'/'none'(레코더 미초기화·일시정지 해제 상태)은 무로깅 — 복귀마다 링버퍼를 잠식하지 않는다.
    };
    const onVis = () => {
      if (document.visibilityState !== 'visible') {
        // v0.38.2 F5 — **여기서 라벨을 스냅샷하는 것이 핵심.** 복귀 후에 읽으면 before/after가 같은
        // 읽기가 돼 "백그라운드 중 경로가 바뀌었다"를 판정할 수 없다.
        const decision = reduceForegroundReturn(foregroundReturnRef.current, 'hidden', Date.now(), {
          inputLabel: recorderRef.current?.getActiveInput()?.label ?? null,
        });
        foregroundReturnRef.current = decision.state;
        return;
      }
      onForegroundReturn('vis');
    };
    const onPageShow = () => onForegroundReturn('pageshow');
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  // v0.12.0 AREA1 — 입력탭 읽기전용 입력장치 CATEGORY 배지용. getUserMedia가 실제로 잡은 마이크
  // 라벨을 노출(init() 비동기 resolve 후 채워짐). 안정 참조(useCallback []) — VoiceScreen이
  // 폴링으로 읽어 classifyInputDevice로 CATEGORY를 표시한다.
  const getActiveInputLabel = useCallback(
    () => recorderRef.current?.getActiveInput()?.label ?? null,
    [],
  );

  // 계측 G·H 공용 판독 경로. 레코더 자체를 읽을 수 없으면 `none`으로 단정하지 않고 unknown.
  const getTrackState = useCallback(
    (): VoiceTrackState => recorderRef.current?.getTrackState() ?? 'unknown',
    [],
  );

  const getRuntimeSnapshot = useCallback(
    (): VoiceRuntimeSnapshot => {
      const recorder = recorderRef.current;
      const controller = ctrlRef.current;
      const suspend = uiSuspendRef.current;
      return {
        rec: !recorder ? 'none' : recorder.isRecording() ? 'recording' : 'idle',
        track: getTrackState(),
        stt:
          suspend.reasons.size > 0 && suspend.hadController
            ? 'suspended'
            : controller?.getRecognitionState() ?? 'none',
      };
    },
    [getTrackState],
  );

  // v0.34.0 B7 — 파동 레벨 getter(안정 참조, React state 금지 — 리렌더 0). rAF 소비자
  // (useAudioLevelVar)가 매 프레임 읽는다. recorder가 없거나(세션 전/일시정지) 프리롤 미가용이면 0.
  const getAudioLevel = useCallback(
    () => recorderRef.current?.getInputLevel() ?? 0,
    [],
  );

  // v0.35.0 (Vance) — 시간영역 파형 getter(안정 참조). VoiceWaveform의 rAF가 out 버퍼에 실시간
  //   샘플을 채운다. recorder 없음/analyser 미가용이면 false → 소비자가 레벨 기반 폴백.
  const getTimeDomainData = useCallback(
    (out: Uint8Array) => recorderRef.current?.getTimeDomainData(out) ?? false,
    [],
  );

  // D-2 (RACE-7): restore session id/label from the store on (re)mount. If the hook unmounted
  // mid-session (e.g. tab switch while paused) the local refs were lost, but the store kept the
  // id — recover it so resumed events and the final persist carry the correct sessionId.
  useEffect(() => {
    if (sessionIdRef.current) return;
    const s = useSessionStore.getState();
    // v0.48.1 r3 F6 — SSOT는 sessionStore.ts의 `isSessionLive`(허용목록 형태로 통합).
    if (s.sessionId && isSessionLive(s.phase)) {
      sessionIdRef.current = s.sessionId;
      sessionLabelRef.current = s.sessionLabel;
      const restoredSession = useDataStore.getState().sessions.find((x) => x.id === s.sessionId);
      if (restoredSession) {
        sessionTargetRef.current = restoredSession.target ?? null;
        sessionColumnsRef.current = restoredSession.columns;
        setSessionColumns(restoredSession.columns);
      }
      logger.setSessionId(s.sessionId);
    }
  }, []);

  // unmount cleanup
  useEffect(() => () => {
    setActiveController(null);
    ctrlRef.current?.stop();
    // StrictMode simulated teardown 뒤 effect setup이 다시 돌 때 stopped 인스턴스를 재사용하지 않는다.
    // ref가 남으면 pending restore effect의 `!ctrlRef.current` 가드가 새 컨트롤러 생성을 건너뛴다.
    ctrlRef.current = null;
    cancelTts();
    recorderRef.current?.dispose();
    // dispose된 recorder도 StrictMode 2차 setup/prewarm에서 새 인스턴스로 재생성되게 수명을 끝낸다.
    recorderRef.current = null;
    // v0.45.0 WP-2 — 언마운트가 임계 타이머를 살려두면 죽은 클로저가 10분 뒤 깨어난다.
    if (bgOffTimerRef.current !== null) {
      window.clearTimeout(bgOffTimerRef.current);
      bgOffTimerRef.current = null;
    }
  }, []);

  /** v0.33.0 항목6 — 셀 값 영속 공유 코어. 터치 인라인 편집(commitTouchValue)과 수동 입력 시트
   *  (commitManualValue)가 공유한다: sessionStore + dataStore(patchRowValues — F2: "값 변경 ⇒
   *  synced→dirty" 불변식으로 업로드된 행도 다음 sync가 시트 행을 UPDATE) + IDB 반영.
   *
   *  🔴🔴 v0.49 r6 Y1(codex R5-F1 Critical) — 종전 이 헤더의 마지막 줄은 *"행이 아직 완료된 적이
   *  없으면 sessionStore만 갱신되고, 다음 persistSession에서 자연 반영된다"* 였다. 그 문장은
   *  **다음 persist가 실제로 일어나고 성공한다**는 보장 위에 서 있었는데, 그 보장이 없었다:
   *    · 세션이 아직 IDB에 없으면(첫 커밋) `patchRowValues`는 붙일 대상이 없어 `null`을 돌려주고,
   *      이 코어는 **IDB 쓰기를 한 번도 하지 않은 채** `true`(=성공)를 반환했다.
   *    · 호출부는 그 `true`로 ✓·화음·에코·전진을 낸다. 실측(fixr6): 실패 주입 상태에서 첫
   *      키패드 커밋 한 건만 해도 **IDB 0건 · 배너 0 · ✓ 1 · 값 에코 정상**이었다(행이 완성되지
   *      않아 `finalizeRowCompletion`조차 no-op인 형상 — 즉 이 축은 Z8 배선과 무관하게 실재했다).
   *  👉 처방: null 분기를 **지연이 아니라 아직 안 쓴 상태**로 보고 `persistSession()`을 직접
   *     await한다. 그리고 그 persist가 이 행·이 값을 **실제로 실었는지**까지 확인한다 —
   *     `persistSession`은 rows를 `completedRows`+백업+`activeRow`+`skippedRows`에서만 조립하고
   *     (그 헤더) 아무것도 실을 게 없으면 **쓰지 않고 `true`** 를 돌려주므로, 반환값만 보면
   *     같은 거짓 성공이 한 겹 안쪽에서 재현된다. `dataStore`는 durable 성공 뒤에만 갱신되므로
   *     (persistSession 말미 `upsertSession`) 거기서 값을 되읽는 것이 곧 내구화 확인이다. */
  const persistCellValue = useCallback(async (row: number, colId: string, value: string): Promise<boolean> => {
    useSessionStore.getState().setRowValue(row, colId, value);
    const updatedSession = useDataStore
      .getState()
      .patchRowValues(sessionIdRef.current, row, { [colId]: value });
    if (updatedSession) {
      // 🔴 v0.47.0 C-FIX2(리뷰 U3, major) — **saveSession 실패를 삼키지 않는다.** 종전 catch{}는
      //   실패해도 호출부가 화음·에코·✓·advance로 성공을 고지하게 했다 — 유실될 값을 성공
      //   고지(PRINCIPLES §1 위반, manualHold [확인]의 durable 실패 처리와 비대칭). false를
      //   반환해 호출부가 성공 신호를 억제하고 사용자에게 고지하게 한다.
      try {
        await saveSession(updatedSession);
      } catch (e) {
        logCell({
          type: 'error',
          extra: `cell_persist_failed:${String((e as Error)?.message ?? e)}`,
          row, colId,
        });
        return false;
      }
    } else {
      // v0.49 r6 Y1 — 위 헤더의 null 분기. 실패 사유는 두 갈래이고 배너 문구는 같지만, 로그는
      //   가른다(`session_not_durable`=IDB가 거절 · `row_unlanded`=persist는 성공했는데 이 행이
      //   rows 조립에 안 실림). 기존 `cell_persist_failed:` 이벤트의 **메시지 슬롯**만 쓴다 —
      //   접두·필드 구성은 바이트 불변이라 SOP-003 소비자와 기존 오라클이 그대로 읽는다.
      const durable = await persistSession();
      const landed = (useDataStore.getState().sessions
        .find((s) => s.id === sessionIdRef.current)
        ?.rows.find((r) => r.index === row)?.values[colId] ?? '') === value;
      if (!durable || !landed) {
        logCell({
          type: 'error',
          extra: `cell_persist_failed:${durable ? 'row_unlanded' : 'session_not_durable'}`,
          row, colId,
        });
        return false;
      }
    }
    // v0.47.0 W4(FB-E) — 수동/터치 확정 커밋의 ✓ 집합 등록. 이 코어는 manualHold 후보 경로를
    //   지나지 않으므로(그쪽은 patchRowValues 직행) 미확정 후보가 ✓를 받는 일이 없다.
    //   C-FIX2 — 등록은 durable 확정 **뒤**다: 실패 시 회수(remove)가 필요 없는 순서라
    //   add 전용 집합 계약이 그대로 선다.
    //   (v0.49 r6 Y1 — 종전 이 자리의 괄호 주석은 *"updatedSession null = … 실패가 아니라 지연
    //    이므로 true"* 였다. 그 전제가 R5-F1의 근인이라 위 else 분기로 대체됐다 — 이제 여기
    //    도달은 **두 갈래 모두 durable 확정 뒤**다.)
    if (value !== '') useSessionCommitMarks.getState().add(row, colId);
    // C-FIX2b — 같은 셀의 durable 성공이 실패 배너를 해소한다(재시도 성공·수동 재입력 성공 공통).
    useCellPersistError.getState().clearIfMatches(row, colId);
    return true;
  }, [persistSession]);

  /** v0.11.0: touch 컬럼 값 commit 시 sessionStore + dataStore + IDB 모두에 즉시 반영.
   *  Codex MEDIUM: setRowValue만으로는 휘발성 상태만 변경 → sync/CSV가 누락하는 위험 해결.
   *  v0.33.0 항목6 — 영속 코어는 persistCellValue로 추출(수동 입력 시트와 공유). */
  const commitTouchValue = useCallback(async (row: number, colId: string, value: string) => {
    logCell({ type: 'command', parsed: 'touch_commit', extra: 'touch', text: value, row, colId });
    // C-FIX2 — durable 실패면 영수증(성공 표식)을 만들지 않고 고지한다.
    if (!(await persistCellValue(row, colId, value))) {
      notifyCellPersistFailed(row, colId, value);
      return;
    }
    // v0.37.0 리뷰#1 후속(Codex Medium) — 터치 인라인 커밋도 검토 영수증을 발행한다(음성·수동·이상치
    //   정정과 동일 패턴). 검토(complete) 중 터치 컬럼을 편집하면 검토 화면이 그 값을 보여야 오표시가
    //   없다. 커밋/전진 조건 무수정 — 기존 persist 뒤 표시 전용 영수증만 추가.
    const col = getColById(colId);
    if (col) useSessionStore.getState().pushCommitReceipt(row, colId, col.name, value);
  }, [notifyCellPersistFailed, persistCellValue]);

  /** v0.33.0 항목6 — 칩 터치 수동 입력(ManualValueSheet) 커밋. 음성 없이 값이 서므로:
   *   ① `manual_commit` 텔레메트리(항목3에서 예약한 기존 command 타입 + extra:'touch')
   *   ② 기존 클립 archive 후 셀 포인터 해제 — 수동 값에는 대응 음성이 없어, 이전 발화 클립이
   *      그대로 걸려 있으면 "값과 다른 오디오 재생"(155.5/177.7 계열 stale-클립 결함)이 된다.
   *   ③ persistCellValue(공유 영속 코어)
   *   ④ 이상치 검사 — 음성 확인 루프(trendConfirm) 무장·알람 TTS 없음(민구 확정)은 유지하되,
   *      v0.34.0 A1: 이 커밋이 진행을 소유하면(awaiting 셀/검토 대기) violation 시 echo/advance를
   *      **보류**하고 [확인][수정] 터치 응답을 기다린다(manualHold 팝업 — 포인터는 커밋한 칩 유지).
   *      이전엔 advance()가 먼저 실행되고 팝업 세팅이 나중이라, 팝업이 뜬 채 대상 칩이 다음 칩으로
   *      전진·활성화되던 버그(실기기 재현). awaiting이 다른 셀인 커밋의 violation은 종전대로 정보성
   *      팝업(버튼 없음, 흐름 불변) — announceField가 진입 시 팝업을 해제하므로 진행 뒤에 세팅한다.
   *   ⑤ awaiting 필드에 대한 커밋이면(무위반) echo TTS 후 advance() — 음성 커밋과 같은 진행.
   *      검토 대기(reviewWait, 항목2) 중이면 advance 대신 검토 대기를 재무장(갱신값 재낭독). */
  const commitManualValue = useCallback(async (row: number, colId: string, value: string) => {
    const col = getColById(colId);
    if (!col) return;
    const sess = useSessionStore.getState();
    const prevValue = sess.getRowValues(row)[colId] ?? '';
    // 클립 포인터를 해제하기 전 확정 상태를 캡처한다. pending 안전 뷰가 값만 원복하고 오디오를
    // 잃으면 확인 전 export가 직전 확정값과 맞지 않는 불완전한 감사 레코드가 된다.
    const existingBeforeCommit = useDataStore.getState().sessions
      .find((s) => s.id === sessionIdRef.current);
    const oldPending = existingBeforeCommit?.pendingValidation;
    const originalRow = existingBeforeCommit?.rows.find((r) => r.index === row);
    logCell({
      type: 'command', parsed: 'manual_commit', extra: 'touch', text: value,
      row, colId,
      ...(prevValue ? { previousValue: prevValue } : {}),
    });

    // ② 기존 클립 보존(archive) 후 포인터 해제 — pending·persisted 양쪽(enterModifyMode direct
    //    경로의 (1)(2)와 같은 구조, 단 재연결할 cmd 클립이 없으므로 순수 해제).
    const pendingMap = pendingClipsRef.current[row];
    if (pendingMap?.[colId]) {
      archiveCellClip(row, colId);
      delete pendingMap[colId];
    }
    {
      const existing = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
      const existingRow = existing?.rows.find((r) => r.index === row);
      if (existing && existingRow?.audioClips?.[colId]) {
        archiveCellClip(row, colId);
        const { [colId]: _gone, ...restClips } = existingRow.audioClips;
        const updatedRow: SessionRow = {
          ...existingRow,
          audioClips: Object.keys(restClips).length > 0 ? restClips : undefined,
        };
        const updatedSession = {
          ...existing,
          rows: existing.rows.map((r) => (r.index === row ? updatedRow : r)),
        };
        useDataStore.getState().upsertSession(updatedSession);
        void saveSession(updatedSession).catch(() => {});
      }
    }

    // 재커밋 중이면 최초 확정값/syncState를 계속 보존한다. 두 번째 후보를 기준값으로 덮으면
    // [수정] 반복 뒤 sync/export가 첫 미확정 후보를 내보내는 구멍이 생긴다.

    // ④ 이상치 검사 — hold 여부를 **값 저장 전에** 결정한다. 후보값을 먼저 일반 Session으로
    // 저장한 뒤 pending 태그를 두 번째 write로 붙이면 그 사이 reload에서 후보가 확정값으로 보이는
    // 원래 결함이 그대로 남는다. hold면 아래에서 후보+태그를 단일 IDB put으로 저장한다.
    const violation = evaluateTrend(col, row, colId, value);
    const fireManualAlert = (v: TrendViolation, hold: boolean) => {
      // 알람 페이로드 조립은 buildAnomalyAlert가 SSOT(v0.35.1) — 수동 경로 전용
      // ',src=manual[,hold=1]' 접미사 조립까지 buildAnomalyAlert가 담당한다(SOP-003 바이트 계약,
      // 특성화 테스트가 실제 조립 경로를 그대로 검증).
      const alertExtra = getAnomalyAlertData(row);
      // 🔴 `alertText`를 반드시 함께 받는다(fb-27-9, 민구 확정 2026-07-27).
      //    v0.39.0까지 이 줄이 `alertText`를 구조분해에서 빼고 `say()`도 호출하지 않아, **수동 커밋이
      //    유발한 이상치 알람만 무음**이었다(실기기 20건 중 음성 19/19 발화, 수동 0/1).
      //    hold=1이면 사용자 응답을 기다리며 진행이 멈추는데 **왜 멈췄는지 소리로 알 수 없는** 상태가
      //    된다 — 현장에서는 폰을 2~3m 떨어뜨려 두므로 화면을 못 본다(PRINCIPLES §2 시각·청각 일치).
      const { alertText, logExtra, alert } = buildAnomalyAlert({
        col, v, colName: col.name, next: formatForTts(value), row,
        sampleKey: alertExtra.sampleKey, prevDate: alertExtra.prevDate,
        manual: { hold },
      });
      logCell({
        type: 'trend',
        extra: logExtra,
        row, colId,
        colName: col.name, text: value, parsed: value, previousValue: String(v.prev),
      });
      useSessionStore.getState().setAnomalyAlert({
        ...alert,
        colId, // v0.34.0 A1 — [수정]의 시트 재오픈 키(VoiceScreen)
        // v0.34.0 A1 — hold면 [확인][수정] 버튼 표시(awaitingResponse 재사용) + manualHold 라우팅.
        //   음성 확인 루프(trendConfirm)는 여전히 무장하지 않는다(민구 기존 결정).
        //   비-hold(awaiting이 다른 셀)는 종전 그대로 정보성 팝업(버튼 없음).
        ...(hold ? { awaitingResponse: true, manualHold: true } : {}),
      });
      playBeep('alert');
      // 민구 확정(2026-07-27): **음성 경로와 완전 동일하게 전 알람 발화**(hold 여부 무관).
      //   비-hold 정보성 알람도 말한다 — 값이 이상하다는 사실 자체가 현장에서 즉시 필요한 정보고,
      //   경로에 따라 들리다 안 들리다 하면 그게 더 혼란스럽다는 판단이다.
      useSessionStore.getState().setLastTts(alertText);
      void say(alertText);
    };

    const awaiting = awaitingFieldRef.current;
    // 🔴 v0.49 r4 M1(claude r3 #2 — Larry 소스 확증) — **행 검토 대기 분기에도 행 가드를 건다.**
    //   종전 `awaiting.kind === 'reviewWait'`는 **좌표를 아예 보지 않았다.** 형제 분기가
    //   `row === row && colId === colId`를 요구하는데 이 하나만 무조건 참이라, **다른 행**에 대한
    //   수동 커밋이 검토 대기의 흐름을 소유했다. 도달로는 셀 저장 실패 배너의 [다시 저장]이다
    //   (`VoiceScreen.tsx`가 `cellPersistPending`에 **떠날 때의 좌표**를 들고 있다가
    //   `commitManualValue(p.row, …)`를 재실행한다 — 그 사이 사용자가 '이전'으로 완료 행에
    //   들어가 있으면 두 좌표가 갈린다).
    //
    //   피해는 **값 소실**이다. 이 분기의 보류 경로는 공유 코어(`persistCellValue`)를 쓰지 않고
    //   `persistSession(pendingValidation, true)`로 세션을 **통째로 다시 조립**하는데, 그 조립은
    //   `completedRows`(+백업·activeRow·skipped)만 rows에 싣는다(:633~644). 재시도 대상 행이
    //   그 어느 집합에도 없으면 **이미 영속돼 있던 그 행이 rows에서 통째로 빠진다** — 값뿐 아니라
    //   `sheetRow`/`syncState`까지 사라져 다음 sync가 같은 행을 **중복 append**한다.
    //   이어서 [확인]은 `proceedAfterCommit(awaiting)`을 부르므로 `finalizeRowCompletion`도
    //   **남의 행**(검토 중인 행)에 걸리고, 실제 커밋 행은 완료 부기를 영영 못 받는다.
    //
    //   ⚠️ **컬럼은 가드하지 않는다**(리뷰 표기 「행·컬럼 가드 없음」과 갈리는 지점 — 산출물 보고).
    //   `reviewWait`은 **행 스코프** 문맥이다: 센티넬 `colId`는 포인터(첫 음성 컬럼)일 뿐이고,
    //   사용자는 그 행의 **아무 칩이나** 눌러 고친다(v0.34.0 A3). 컬럼까지 요구하면 첫 컬럼 외
    //   전부가 흐름 밖으로 떨어져 「검토 중 정정」 계약([NAV-FILLED-CELL-1] 계열)이 깨진다.
    //   오라클: tests/v049-r4-m1-crossrow-ownsflow.spec.ts
    const ownsReviewWait = awaiting?.kind === 'reviewWait' && awaiting.row === row;
    const ownsCell = !!awaiting && awaiting.kind !== 'reviewWait' && awaiting.kind !== 'atEnd'
      && awaiting.row === row && awaiting.colId === colId;
    const ownsFlow = ownsReviewWait || ownsCell;
    if (violation && ownsFlow) {
      epochRef.current++;
      cancelTts();
      // 🔴 v0.49 fix49b(max 리뷰 #7) — 셀 검토 대기도 행 검토와 **같이** 보존한다. 보류가
      //   [확인]으로 풀리면 `confirmManualAnomaly`가 `proceedAfterCommit(awaiting)`을 부르고,
      //   그 SSOT가 kind별 착지를 결정한다 — 여기서 `modify`로 덮으면 그 분기가 영영 안 잡혀
      //   사용자가 이동해 들어온 검토 문맥이 보류 해소와 함께 사라진다.
      //   ⚠️ **reload 복원(:3980)은 여기 못 따라온다** — `pendingValidation`은 `reviewWait`
      //   boolean만 싣고, cellWait을 기존 필드로 파생할 수도 없다(후보값이 이미 셀에 서 있어
      //   「값 있음」이 항상 참 · `previousValue`는 캐스케이드가 IDB를 안 지우므로 modify와
      //   구별 불가). 스키마 확장은 마이그레이션 동반 계약이라 이 라운드 범위 밖 —
      //   [CELLWAIT-HOLD-RELOAD-1]에 기록했다.
      // 🔴 v0.49 r5 Z4(claude #3) — **재무장은 문맥을 들고 간다.** 종전 이 한 줄은 새 `modify`
      //   객체를 **맨손으로** 만들어, 들어올 때의 `awaiting`이 갖고 있던 세 문맥을 통째로
      //   떨어뜨렸다. 형제 재무장 둘은 전부 보존한다 — `demoteTrendConfirm`(:158)과 음성
      //   재위반 재무장(:3329 부근). 이 세 번째만 빠져 **수동(키패드) 커밋에서만** 새는
      //   비대칭이었다(같은 상태에서 같은 값을 말로 넣으면 보존되고 손으로 넣으면 유실된다).
      //     · `resumeReview`/`resumeCell` — 착지 예약. 보류가 [확인]으로 풀리면
      //       `proceedAfterCommit`이 이걸 보고 검토 대기로 복귀한다. 떨어뜨리면 `advance()`로
      //       빠져 사용자가 의도적으로 이동해 들어온 검토 문맥이 증발한다
      //       ([NAV-FILLED-CELL-1]의 「모든 탈출은 재진입」 불변식 위반).
      //   ⚠️ 승계원은 **직전 `awaiting`**이지 새 값이 아니다. `previousValue`만 방금 커밋된
      //     후보값으로 갈아 끼운다(재발화가 이 값을 대체 대상으로 삼는다 — 종전 의미 유지).
      //
      //   🔴 **`fractionWhole`은 일부러 승계하지 않는다**(브리핑 원문에서 갈린 지점 — 레인 실측).
      //     승계 규칙은 「예약이냐 값 문맥이냐」가 아니라 **「새 완결값이 들어왔는가」**다:
      //       · `demoteTrendConfirm`은 승계한다 — 강등은 **같은 값**에 대한 모드 전환일 뿐이다.
      //       · 이 자리와 :3329(음성 재위반 재무장)는 승계하지 **않는다** — 둘 다 사용자가
      //         **완결된 새 값**을 넣은 뒤다. 브리핑이 대칭 대상으로 지목한 :3329가 정확히
      //         `resumeReview`/`resumeCell`만 승계하고 `fractionWhole`은 두고 간다.
      //     승계하면 오히려 결함이 된다: 바로 아래 `setReaskReason(null)`이 화면의 소수 문맥을
      //     지우는데(`reaskDecimalWhole`도 함께 — sessionStore 계약) `awaiting`만 정수부를 들고
      //     남으면 **화면과 합성이 갈린다**(R4-F3와 같은 형태). 「111 점 에」 뒤 키패드로 120.5를
      //     넣었는데 다음 '오'가 111.5로 합성돼 방금 넣은 값을 덮는 것이 그 귀결이다 —
      //     M3가 닫은 「무고지 합성」 그 자체다.
      //   오라클: tests/v049-r5-z4-hold-context.spec.ts
      if (awaiting!.kind !== 'reviewWait' && awaiting!.kind !== 'cellWait') {
        const prev = awaiting!;
        awaitingFieldRef.current = {
          kind: 'modify', row, colId, name: col.name, previousValue: value,
          ...(resumeReviewOf(prev) != null ? { resumeReview: resumeReviewOf(prev) } : {}),
          ...(resumeCellOf(prev) != null ? { resumeCell: resumeCellOf(prev) } : {}),
        };
      }
      sess.setRowValue(row, colId, value);
      sess.setRecognized(value);
      sess.setReaskReason(null);
      // dataStore는 UI 후보를 보여 주되 여기서는 saveSession을 호출하지 않는다. persistSession에
      // pendingOverride를 넘긴 단 한 번의 put만 후보를 내구화해 crash window를 제거한다.
      useDataStore.getState().patchRowValues(sessionIdRef.current, row, { [colId]: value });
      fireManualAlert(violation, true);
      const alert = useSessionStore.getState().anomalyAlert;
      if (!alert?.manualHold) return;
      const pendingValidation: NonNullable<Session['pendingValidation']> = {
        row,
        colId,
        candidateValue: value,
        previousValue: oldPending?.previousValue ?? originalRow?.values[colId] ?? prevValue,
        previousSyncState: oldPending?.previousSyncState ?? originalRow?.syncState,
        previousAudioClip: oldPending?.previousAudioClip ?? originalRow?.audioClips?.[colId],
        reviewWait: awaiting.kind === 'reviewWait',
        activeColIdx: useSessionStore.getState().activeColIdx,
        alert: { ...alert, colId, awaitingResponse: true, manualHold: true },
      };
      const durable = await persistSession(pendingValidation, true);
      if (!durable) {
        // 태그와 후보가 함께 저장되지 못했으므로 후보를 확정 상태처럼 메모리에 남기지 않는다.
        // 직전 값으로 롤백하고 보류 UI를 닫아 reload 전후가 동일한 확정값을 가리키게 한다.
        sess.setRowValue(row, colId, pendingValidation.previousValue);
        sess.setRecognized(pendingValidation.previousValue);
        clearAnomalyAlert('persist_rollback');
        const current = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
        if (current) useDataStore.getState().upsertSession(withoutPendingCandidate({ ...current, pendingValidation }));
      }
      return;
    }

    // 일반값/정보성 이상치는 기존 즉시 영속 계약을 유지한다.
    // 🔴 C-FIX2 — durable 실패면 여기서 끝낸다: 영수증·화음·에코·진행·정보성 알람 전부 억제
    //   (유실될 값을 성공 고지하지 않는다). 값은 화면에 남아 재커밋이 재시도가 된다
    //   (notifyCellPersistFailed 주석의 🟡 선택 근거 참조).
    if (!(await persistCellValue(row, colId, value))) {
      notifyCellPersistFailed(row, colId, value);
      return;
    }
    // v0.37.0 리뷰#1 — 수동 시트 커밋 영수증(검토 화면 파생 SSOT). 보류(manualHold) 분기는 위에서
    //   return하므로 여기 도달 = 확정 커밋(일반값·정보성 이상치). 보류 정정값은 confirmManualAnomaly가 발행.
    useSessionStore.getState().pushCommitReceipt(row, colId, col.name, value);
    sess.setRecognized(value);
    sess.setReaskReason(null);

    // 🔴🔴 v0.49 r5 Z8(claude #8) — **행 완료 부기는 흐름 소유권과 무관하다. 값 유실이었다.**
    //
    //   완료의 진실이 둘이었다:
    //     · `dataStore.patchRowValues`(C4)는 값에서 `complete`를 **다시 계산**하고
    //       `completedRows`도 맞춘다 — 그래서 키패드 커밋 직후 IDB는 옳아 보인다.
    //     · `sessionStore.completedRows`는 `markRowComplete`(=`finalizeRowCompletion`)로만 는다.
    //       그런데 아래 **비-awaiting 커밋 분기**(v0.47.0 W1)는 *"진행 상태를 건드리지 않는다"*
    //       는 계약을 지키며 그 부기까지 함께 건너뛰었다.
    //   `persistSession`은 후자만 본다: `rows`를 `completedRows` + `activeRow` + `skippedRows`
    //   **셋에서만** 만든다. 그래서 다음 persist가 그 행을 **어느 목록에도 못 넣고 통째로
    //   떨어뜨린다** — IDB에서 사라지고, 시트에도 영영 안 올라간다.
    //   실측(2026-08-14): 1행 m1을 음성으로, 커서를 그 셀에 둔 채(cellWait) m2를 **키패드**로
    //   채워 행을 완성 → IDB에 `{m1:35.1, m2:42.3, complete:true}`. 그 뒤 2행에서 값 하나를
    //   커밋하자 **1행이 IDB에서 통째로 사라졌다.** 끝 도달 안내도 「완료된 행은 1행」이라
    //   말했다(실제 2행) — 두 진실이 화면·시트·귀에서 동시에 갈린 형태다.
    //
    //   🔑 처방이 **여기**인 이유: `finalizeRowCompletion`의 계약이 *"이 함수가 다루는 것은
    //   «내구성»뿐이고, «무엇을 말하는가»는 호출부가 정한다"*(그 헤더)다. 부기는 흐름 소유권이
    //   아니라 **커밋 사실**에 붙는다. 그래서 소유권 분기 **앞**에서 한 번 부른다 — 아래
    //   `proceedAfterCommit`도 같은 함수를 부르지만 멱등이라 IDB 쓰기가 늘지 않는다(그 헤더).
    //   ⚠️ 좌표는 **커밋된 셀의 행**(`row`)이지 `awaiting.row`가 아니다. M1이 세운 것은
    //     「어느 awaiting을 소유하는가」의 행 가드이고, 내구성 부기는 **값이 들어간 행**을 따른다 —
    //     둘을 같은 축으로 읽으면 교차행 수동 커밋에서 남의 행 부기를 건드리게 된다.
    //   ⚠️ 미완료 행이면 `isRowVoiceComplete` 가드가 즉시 return한다(no-op) — 부분 입력은
    //     종전대로 `activeHasData` 경로가 내구화한다.
    //   오라클: tests/v049-r5-z8-manual-complete.spec.ts
    // 🔴 v0.49 r6 Y1 — 위 `persistCellValue`와 **같은 계약**으로 실패를 받는다(C-FIX2 대칭).
    //   Z8이 이 줄을 넣을 때는 `void persistSession()`이라 실패가 보이지 않았다: 값은 화면에
    //   서고 ✓·화음·에코가 나가는데 IDB엔 아무것도 없는 상태(codex R5-F1의 재현 형상).
    //   좌표가 정확히 있는 유일한 호출부라 셀 배너를 그대로 쓴다 — 재시도 = 이 커밋의 재실행.
    if (!(await finalizeRowCompletion(row))) {
      notifyCellPersistFailed(row, colId, value);
      return;
    }

    // 🔴 v0.47.0 W1(FB-A+B, 민구 08-08) — **수동 커밋 확인음은 awaiting 여부와 무관하다.**
    //   종전엔 커밋 화음이 음성 경로(:2373)에만 있었고 수동 경로는 awaiting 셀일 때 echo TTS만
    //   났다 — 비-awaiting 덮어쓰기 커밋(08-08 새벽 실측 manual_commit 8건 중 4건)은 **완전 무음**.
    //   현장에서는 폰을 2~3m 떨어뜨려 두므로(PRINCIPLES §2) 소리 없는 커밋은 "저장됐는지 모르는"
    //   커밋이다. 여기 = manualHold 보류가 아닌 **확정 커밋의 유일 도달점**(보류는 위에서 return).
    //   순서 계약은 음성 경로와 동일: **확인음 → 인식값 TTS**(v0.46.0 WP-E, 민구 지정).
    //   화음이 WebAudio, 에코가 SpeechSynthesis라 아래 어느 분기의 TTS와도 채널 충돌이 없다.
    playBeep('commit');

    // ⑤ 진행: awaiting 셀이면 음성 커밋과 동일하게 echo 후 advance. 검토 대기면 재무장.
    //    v0.34.0 A1 — 단, violation이면 진행을 보류하고 팝업 응답을 기다린다(칩 전진 버그 수정).
    if (oldPending && oldPending.row === row && oldPending.colId === colId) {
      const staged = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
      if (staged) {
        const confirmed = { ...staged };
        delete confirmed.pendingValidation;
        await saveSession(confirmed);
        useDataStore.getState().upsertSession(confirmed);
      }
      // 성공적인 정상 재커밋만 보류를 해소한다. 시트 취소는 이 함수에 들어오지 않으므로 유지된다.
      clearAnomalyAlert('manual_recommit');
    }

    // 🔴 v0.49 P-2(민구 제보 08-12 · Larry (A) 승인 08-12 10:55) — **키패드 해소도 즉시 초록.**
    //   음성 경로(:2700-2710)와 **대칭**인 전이다: 알람이 걸린 바로 그 셀에 위반 없는 값이
    //   커밋되면 팝업을 `next=정정값 · status:'corrected'`로 뒤집는다. 종전엔 이 전이가
    //   **수동 경로에만 없어서**, 음성으로 뜬 알람을 키패드로 해소하면 `announceField`의
    //   `clearAnomalyAlert('announce_field')`(:835)까지 붉은톤이 그대로 남았다.
    //   08-12 실측(2건 전부 이 형태): 09:51:53 발동 → 09:52:04.099 키패드 `188.8` →
    //   09:52:09.102 해제 = **5.003초** · 09:55:01 → 09:55:09.610 `344.4` → 09:55:13.441 =
    //   **3.831초**. 지연의 정체는 announce까지의 TTS 직렬이다(echo 1.414s + 행완료 1.095s +
    //   행헤더 2.189s). 같은 세션의 음성 해소 6건은 전부 인식 순간 corrected라 체감 0초였고,
    //   수동 발동 알람(manualHold, 위 `manual_recommit`)도 이미 0.318초였다 — **이 경로만 구멍.**
    //   표시 4곳이 전부 같은 게이트를 읽으므로 이 한 전이가 함께 되돌린다: 글로우
    //   (`VoiceScreen.tsx:139`) · FB-F 칩 적색(`useVoiceCommitMark.ts:132`) · 알람 카드
    //   (`CenterStage.tsx:139` FB-10) · 팝업 색(`AnomalyAlertPopup.tsx:74`). 계약 위반이 아니라
    //   v0.47 "확인·수정으로 해소한 뒤에만 녹색"을 키패드 경로에도 **적용**하는 것이다.
    //   부수 해소: 종전 5초 동안 팝업이 **옛 이상치값**을 띄운 채 echo TTS만 정정값을 말했다
    //   (PRINCIPLES §2 시각·청각 불일치) — `next` 갱신이 그것도 같이 닫는다.
    //
    //   위치·가드 근거(승인 조건):
    //   ⓐ **durable persist 성공 이후**다(:4189 게이트 통과). 저장되지 못한 값에 초록을 주지 않는다.
    //   ⓑ **row+colId 일치 가드** — 다른 셀 알람(정보성 팝업)은 이 커밋과 무관하므로 불변.
    //   ⓒ **`!violation`** — 정보성 이상치(awaiting이 다른 셀)로 여기 도달한 커밋은 그 자체가
    //      위반이다. :4251의 `fireManualAlert`가 곧 새 알람을 세우므로 초록 1프레임도 주면 안 된다.
    //   ⓓ manualHold 보류는 위에서 `clearAnomalyAlert('manual_recommit')`로 이미 내려갔다 →
    //      여기 도달 시 `alert === null` → no-op. **그 경로의 로그 바이트는 불변**이다.
    //   ⓔ 화음은 **미러하지 않는다.** 음성 경로는 `playBeep('corrected')` 하나지만 수동 경로는
    //      v0.47 W1(민구 08-08)이 "모든 확정 커밋에 화음"을 이미 보장한다(:4206) — 여기서
    //      corrected 화음을 더 내면 같은 커밋이 두 번 울린다.
    if (!violation) {
      const liveAlert = useSessionStore.getState().anomalyAlert;
      if (liveAlert && liveAlert.row === row && liveAlert.colId === colId && liveAlert.status !== 'corrected') {
        useSessionStore.getState().setAnomalyAlert({
          ...liveAlert, next: formatForTts(value), status: 'corrected',
        });
      }
    }

    // M1 — 착지도 **같은 술어**를 쓴다(위 `ownsReviewWait`/`ownsCell`). 종전엔 여기서 같은 조건을
    //   다시 손으로 적었고, 그 사본에도 행 가드가 없어 다른 행 커밋이 남의 검토 대기를 재무장했다
    //   (값은 공유 코어가 이미 옳게 저장했으므로 이쪽 피해는 오착지·오낭독이지만, 같은 결함이다).
    if (ownsReviewWait) {
      epochRef.current++;
      cancelTts();
      await proceedAfterCommit(awaiting); // 검토 대기 재무장(갱신값 재낭독)
    } else if (ownsCell) {
      epochRef.current++;
      cancelTts();
      // v0.47.0 W2 — 수정 재청취 중 수동 재커밋도 「수정 성공」이다(amber→green 전환 신호).
      if (awaiting.kind === 'modify') useModifyPhase.getState().setCommitted(true);
      await proceedAfterCommit(awaiting, { echoValue: value }); // echo 후 진행
    } else {
      // v0.47.0 W1(FB-A+B) — 비-awaiting(다른 셀 덮어쓰기)·atEnd 수동 커밋도 **값을 에코**한다.
      //   종전 "흐름 불변 = 무음"이 FB-A/B의 실체다. 진행 상태는 여전히 건드리지 않는다
      //   (epoch bump·cancelTts 없음 — advance 소유권이 없는 커밋이다). interrupt=false로
      //   큐잉해 진행 중인 안내 TTS(awaiting 셀 재촉 등)를 자르지 않는다 — 화음이 즉시 나므로
      //   "커밋됐다"는 신호는 지연 없이 전달되고, 에코는 안내가 끝난 직후 이어진다(순서 계약
      //   확인음→에코 유지 — 사이가 벌어질 수는 있어도 뒤집히지는 않는다).
      // v0.47.0 C-FIX4(리뷰 U9) — 정보성 이상치(violation)면 **에코를 생략**한다. 두 이유:
      //   ①이 await가 알람 팝업·트릴·알람 TTS를 에코 종료까지 지연시켰다(값이 이상하다는
      //   사실이 즉시 필요한 정보인데 늦는다 — U9의 본축) ②수동 커밋은 정의상 **화면 앞
      //   키패드 조작**이고(2~3m 음성 시나리오가 아니다) 알람 팝업이 직전→현재 값을 크게
      //   보여준다 — 값 확인 채널이 살아 있으니, 에코→알람 이중 TTS로 경고를 뒤로 미는 것보다
      //   경고 단독이 낫다. ⚠️ alertText는 값이 아니라 **변화량**을 말한다(anomalyAlarmLabel) —
      //   "알람이 값을 발화한다"는 가정은 틀렸다(이 스펙 첫 구현에서 실측). 순서를 뒤집어
      //   알람 뒤에 에코를 큐잉하는 안은 기각: fireManualAlert의 say가 비대기(void)라
      //   interrupt 50ms 갭과 레이스해 에코가 알람을 앞지를 수 있다.
      //   화음(위)은 그대로 — "저장됐다"와 "이상하다"는 별개 신호다(화음→트릴→알람 TTS 순).
      if (!violation) await say(formatForTts(value), false);
    }

    if (violation) fireManualAlert(violation, false);
  }, [archiveCellClip, clearAnomalyAlert, evaluateTrend, finalizeRowCompletion, getAnomalyAlertData, notifyCellPersistFailed, persistCellValue, persistSession, proceedAfterCommit, say]);

  // ── v0.33.0 항목7 — 이상치 응답 대기(trendConfirm) 중 터치 버튼: 음성 명령과 동일 동작·동일 로그 ──
  /** [확인] 버튼 — 음성 '확인'과 동일: 커밋된 값 확정 + 팝업 해제 + advance 1회. attribution은
   *  선행 command 이벤트의 extra('touch' vs 음성의 tts_*)로 구분되고 trend 이벤트는 글자 동일. */
  const confirmAnomalyTouch = useCallback(async () => {
    const awaiting = awaitingFieldRef.current;
    if (awaiting?.kind !== 'trendConfirm') return; // 응답 대기 중이 아니면 no-op(정보성 팝업 등)
    epochRef.current++;
    cancelTts();
    logCell({
      type: 'command', parsed: 'confirm', extra: 'touch',
      row: awaiting.row, colId: awaiting.colId,
    });
    clearAnomalyAlert('touch_confirm');
    logCell({
      type: 'trend', extra: 'trend_alert_confirmed', parsed: 'confirm',
      row: awaiting.row, colId: awaiting.colId,
      ...(awaiting.previousValue != null ? { previousValue: awaiting.previousValue } : {}),
    });
    awaitingFieldRef.current = null;
    // 🔴 v0.49 r2 A2 — 음성 '확인'(:trendResolve)과 **같은 문**을 쓴다. 종전엔 이 터치 형제만
    //   행 예약을 직접 읽어, 같은 상태·같은 목적의 조작이 **입력 수단에 따라** 갈렸다
    //   (fix49b #7이 키패드 재커밋에서 고친 것과 정확히 같은 비대칭). P1 검토 대기 착지 계약은
    //   `proceedAfterCommit` 안에 그대로 산다.
    await proceedAfterCommit(awaiting);
  }, [clearAnomalyAlert, proceedAfterCommit]);

  /** [수정] 버튼 — 음성 '수정'(trendConfirm 해제 → isModify 재청취)과 동일 착지: 같은 필드에서
   *  대기하며 기존값은 새 발화가 덮어쓰기 전까지 보존된다. 터치에는 보존할 명령 발화가 없으므로
   *  preserveCommandClip 없이 클립 슬롯만 재무장한다. */
  const modifyAnomalyTouch = useCallback(async () => {
    const awaiting = awaitingFieldRef.current;
    if (awaiting?.kind !== 'trendConfirm') return;
    epochRef.current++;
    cancelTts();
    logCell({
      type: 'command', parsed: 'modify', extra: 'touch',
      row: awaiting.row, colId: awaiting.colId,
    });
    clearAnomalyAlert('touch_modify');
    logCell({
      type: 'trend', extra: 'trend_alert_dismissed:modify',
      row: awaiting.row, colId: awaiting.colId,
    });
    // 음성 경로의 trendConfirm 해제('modify' 강등 후 재질문)와 동일 상태(fractionWhole 보존).
    const demoted = demoteTrendConfirm(awaiting);
    awaitingFieldRef.current = demoted;
    // 🔴 v0.49 r6 Y4(claude #2) — **재청취 안내는 `relistenInContext`가 소유한다**(그 헤더).
    //   종전 이 두 줄(`armClipForCell` + `say(relistenPrompt)`)은 Z6이 만든 깔때기를 안 타는
    //   **세 번째 재청취**였다. 바로 위 `demoteTrendConfirm`이 `fractionWhole`을 **보존**하므로
    //   (그 계약) 소수 문맥이 살아 있는 채로 여기 오는데, 그 상태에서 두 반쪽을 다 어겼다:
    //     ① 표면 모순 — 화면 큐는 「130 점, 소수점 아래」인데 귀는 「횡경 다시 말씀해 주세요」.
    //        안내를 믿고 전체값을 말하면 살아 있는 `fractionWhole`과 합성 규칙이 충돌한다.
    //     ② [CLIP-DECIMAL-FRAG-1] — `armClipForCell`이 슬롯을 재시작해 직전 원본 전체발화
    //        버퍼를 폐기한다. 소수 재질문은 조각 발화만 유도하므로 그 슬롯은 계속 녹음해야 한다.
    //   M11의 「[수정] 터치는 접수된 조작이라 거절 신호를 붙이지 않는다」는 그대로다 —
    //   `relistenInContext`도 비프·거절 큐를 만들지 않는다(그게 그 함수의 존재 이유다).
    await relistenInContext(demoted);
  }, [clearAnomalyAlert, relistenInContext]);

  // ── v0.34.0 A1 — 수동 입력 이상치 **보류**(manualHold) 팝업의 터치 버튼 ──
  //   위 confirmAnomalyTouch/modifyAnomalyTouch는 trendConfirm 가드라 음성 경로 전용 — 수동 보류는
  //   별도 함수로 무충돌 분리한다(트리거 가드도 anomalyAlert.manualHold). 해제 콜백은 RACE-1 패턴
  //   (epoch bump + cancelTts 후 진행 — confirmAnomalyTouch와 동일 복제).
  /** [확인] — 커밋된 수동 값 확정 + 팝업 해제 + 보류했던 진행 재개(advance 1회.
   *  검토 대기 출신이면 enterReviewWait 재진입 — 갱신값 재낭독 + 명령 대기). */
  const confirmManualAnomaly = useCallback(async () => {
    const alert = useSessionStore.getState().anomalyAlert;
    if (!alert?.manualHold) return; // 보류 팝업이 아니면 no-op
    const staged = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
    // 팝업이 보이더라도 후보+pending 단일 put이 아직 끝나지 않았거나 태그 자체가 없으면 절대
    // alert를 해제/advance하지 않는다. 느린 IDB와 ManualValueSheet fire-and-forget 사이 우회 차단.
    if (!staged?.pendingValidation || staged.pendingValidationPersisting) {
      logCell({
        type: 'command', parsed: 'confirm', extra: 'blocked:manual_hold:not_durable',
        row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
      });
      return;
    }
    epochRef.current++;
    cancelTts();
    logCell({
      type: 'command', parsed: 'confirm', extra: 'touch:manual_hold',
      row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
    });
    if (staged.pendingValidation) {
      const confirmed = { ...staged };
      delete confirmed.pendingValidation;
      // [확인]은 후보를 확정값으로 승격하는 유일한 경로다. IDB 저장이 끝난 뒤에만 메모리 hold를
      // 지워, 쿼터/트랜잭션 실패 시 화면만 확정된 것처럼 진행하는 불일치를 막는다.
      try {
        await saveSession(confirmed);
        useDataStore.getState().upsertSession(confirmed);
      } catch (err) {
        logCell({
          type: 'error', extra: `manual_hold_confirm_persist_failed:${String((err as Error)?.message ?? err)}`,
          row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
        });
        return;
      }
    }
    clearAnomalyAlert('manual_hold_confirm');
    logCell({
      type: 'trend', extra: 'trend_alert_confirmed', parsed: 'confirm',
      row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
    });
    // v0.37.0 리뷰#1 — 이상치 정정(수동 보류) [확인] 커밋 영수증: 검토 화면은 **정정되어 확정된**
    //   후보값(candidateValue)을 보여야 한다(거부된 직전값 아님). proceedAfterCommit(advance→검토) 전에 발행.
    {
      const pv = staged.pendingValidation;
      if (pv) {
        useSessionStore.getState().pushCommitReceipt(pv.row, pv.colId, alert.colName, pv.candidateValue);
        // v0.47.0 W4(FB-E) — 보류 후보가 [확인]으로 **확정되는 순간** ✓ 등록(후보 단계는 제외).
        useSessionCommitMarks.getState().add(pv.row, pv.colId);
      }
    }
    // v0.47.0 C-FIX1ⓑ 동축 — 보류 [확인] 확정도 수정 문맥(수정 중 수동 재커밋의 hold)이면
    // 성공 신호를 세운다(voice 정정 경로와 대칭 — amber 잔존 방지).
    {
      const aw = awaitingFieldRef.current;
      if (aw && isModifyLike(aw)) useModifyPhase.getState().setCommitted(true);
    }
    // 보류 시 재무장을 미뤘던 진행 재개 — reviewWait 출신은 검토 대기 재진입, 그 외 advance
    // (commitManualValue와 동일 착지, proceedAfterCommit SSOT).
    await proceedAfterCommit(awaitingFieldRef.current);
  }, [clearAnomalyAlert, proceedAfterCommit]);

  /** [수정] — 팝업 해제만 수행. 해당 셀 ManualValueSheet 재오픈은 시트 open 상태를 소유한
   *  VoiceScreen이 조립한다(이 콜백 직후 alert.colId로 openManualSheet). awaiting은
   *  commitManualValue가 무장해 둔 isModify(같은 셀) 또는 reviewWait 센티넬을 그대로 둔다 —
   *  시트 재커밋(commitManualValue)이 같은 경로로 재평가한다. */
  const modifyManualAnomaly = useCallback(() => {
    const alert = useSessionStore.getState().anomalyAlert;
    if (!alert?.manualHold) return;
    epochRef.current++;
    cancelTts();
    logCell({
      type: 'command', parsed: 'modify', extra: 'touch:manual_hold',
      row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
    });
    // v0.34.0 리뷰 라운드2(Codex Medium) — **보류를 여기서 풀지 않는다.** 이전엔 setAnomalyAlert(null)로
    // 팝업·hold를 먼저 지웠는데, 그 뒤 사용자가 수동입력 시트를 취소하면 **이미 영속된 이상값이
    // 확인된 것처럼 남고 STT까지 재개**됐다(미확인 값이 검증 없이 확정 — 민구 결정 "터치로 해소될
    // 때까지 보류"에 어긋남). 보류는 **성공적인 재커밋으로만** 풀린다:
    //   · 새 값이 정상 → commitManualValue → advance → announceField가 알람을 지운다.
    //   · 새 값이 또 위반 → fireManualAlert(hold=1)이 팝업을 갱신해 다시 보류.
    //   · 시트 취소 → 알람·hold가 그대로 남아 팝업이 다시 보이고 게이트도 유지된다(누수 없음).
    logCell({
      type: 'trend', extra: 'trend_alert_modify_reopen:hold_kept',
      row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
    });
  }, []);

  // v0.44.0 §C8 F18 — v0.25.0 기능2(WS-2) prewarmMic(입력탭 마운트 시 마이크 선획득)를 **폐지**했다.
  // 민구 확정(08-02): 권한 요청 시점 = '음성 입력 시작' 클릭. 획득은 start() 선두의 선행 init()이
  // 담당하고, WS-2의 목적(첫 클립 유실 완화)은 승인 후 MIC_SETTLE_MS(1초) 정착 지연이 승계한다.
  // mic_prewarm_* 텔레메트리도 함께 은퇴 — 진입 시 getUserMedia 0회는 v0440-c8-flow.spec.ts가 고정.

  return {
    start,
    stop,
    /** v0.35.0 R3-FIX-2 — 종료 저장 실패 배너의 [다시 저장] 핸들러(VoiceScreen). */
    retryFinalPersist,
    jumpToRow,
    gotoAdjacentRow,
    goNextRow,
    pause,
    resume,
    suspendRecognitionForUi,
    resumeRecognitionForUi,
    // v0.43.0 #4 — App.tsx의 visibilitychange 핸들러가 유일한 호출자다(VoiceScreen 경유 브리지).
    suspendForBackground,
    resumeFromBackground,
    commitTouchValue,
    commitManualValue,
    confirmAnomalyTouch,
    modifyAnomalyTouch,
    confirmManualAnomaly,
    modifyManualAnomaly,
    lastConfidenceRef,
    getActiveInputLabel,
    getTrackState,
    getRuntimeSnapshot,
    getAudioLevel,
    getTimeDomainData,
    micLost,
    micReconnectFallbackVisible,
    reconnectMic,
    uiCommand,
    sessionColumns,
  };
}

// ─── helpers ─────────────────────────────────────────────────
function autoNonCyclingValues(columns: Column[], row: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of columns) {
    // v0.46.0 FB-A — 수동(touch)도 사람이 넣는 값이라 자동 합성에서 뺀다. 근거는
    // `autoValue.ts`의 `isUserInputColumn` 주석이 SSOT(이 경로가 시트 기록에 닿는다).
    if (isUserInputColumn(c)) continue;
    out[c.id] = nestedAutoValue(columns, c, row);
  }
  return out;
}

/** 행 전체 값 합성(고정/비순환 자동 → 순환 자동 → 음성 입력 순으로 덮어씀) —
 *  persistSession과 evaluateTrend가 공유하는 단일 합성 규칙. */
function composeRowValues(columns: Column[], row: number): Record<string, string> {
  return {
    ...autoNonCyclingValues(columns, row),
    ...buildCyclingValues(columns, row),
    ...useSessionStore.getState().getRowValues(row),
  };
}

/** 로컬(기기) 기준 오늘 ISO — toISOString()은 UTC라 자정 부근에 하루 어긋난다. */
function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
