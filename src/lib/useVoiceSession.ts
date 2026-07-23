/* eslint-disable max-lines -- [ENV-12] 기존 초과 파일(GL-006 §5 도입 시점), Stage 3(음성 코어 재설계)에서 해소. 해소 시 이 주석 제거. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore, minConfidenceForTolerance } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useDataStore } from '../stores/dataStore';
import { recountSynced } from './sessionSync';
import { parseKoreanNumber, detectCommand, extractModifyValue, isAmbiguousSingleSyllable, isBareResponseWord, getLastParseFailReason, getLastParseFailWhole } from './koreanNum';
import { VOICE_COMMANDS, extractModifyColumn, isVoiceUiCommand, type VoiceUiCommandSignal } from './voiceCommands';
import { decimalReaskPrompt } from './voicePrompts';
import { SpeechController, speak, cancelTts, isSpeechSupported, formatForTts, warmupTts, setActiveController, setPreferredVoiceName, refreshVoices, resumeTtsEngine } from './speech';
import { computeTotalRows, buildCyclingValues, nestedAutoValue } from './autoValue';
import type { Column, Session, SessionRow, SessionTarget } from '../types';
import { saveSession, saveAudioClip, loadAudioClip, loadSession } from './db';
import { playBeep } from './beep';
import { AudioRecorder, type ClipResult } from './audioRecorder';
import { logger } from './logger';
import { micAutoReconnect, rowMarked } from './logEvents';
import { resolveFinal } from './voiceFinalResolver';
import { unlinkClipPointer, relinkClipPointer } from './clipPointer';
import { hydratePastIndexFallback, prefetchPastIndex, resetPastIndexRetries } from './pastValues';
import { evaluateTrendForRow, anomalyAlertContext } from './trendEvaluate';
import { checkAnomaly, type TrendViolation } from './trendCheck';
import { buildAnomalyAlert } from './anomalyAlert';
import { readonlySheetsAuth } from './sheets';
import { withoutPendingCandidate } from './pendingValidation';
import { sessionTargetFromSettings } from './sheetConnection';
import { ensureUniqueSessionLabel } from './sessionLabel';
// [ENV-12] Stage 3 — 클립 캡처·보존 장부는 useClipCapture가 소유한다(이 파일은 호출만).
import { useClipCapture, EMPTY_CLIP_BYTES, type PendingCommandClip } from './useClipCapture';


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
 */
type AwaitingField =
  | (AwaitingBase & { kind: 'value'; fractionWhole?: string })
  | (AwaitingBase & { kind: 'modify'; previousValue?: string; fractionWhole?: string })
  | (AwaitingBase & { kind: 'trendConfirm'; previousValue: string; fractionWhole?: string })
  | (AwaitingBase & { kind: 'atEnd' })
  | (AwaitingBase & { kind: 'reviewWait' });

/** 수정 의미론 보유 여부 — 종전 `awaiting.isModify`(trendConfirm은 isModify를 겸장했다). */
function isModifyLike(a: AwaitingField): boolean {
  return a.kind === 'modify' || a.kind === 'trendConfirm';
}

/** 종전 `awaiting.previousValue` 접근(모드 무관 optional 읽기 지점용). */
function previousValueOf(a: AwaitingField): string | undefined {
  return a.kind === 'modify' || a.kind === 'trendConfirm' ? a.previousValue : undefined;
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
 *  다음 소수부 발화가 전체값으로 오커밋되던 회귀(v0.35.3 리뷰 r1, 3모델 공통 Critical/High). */
function demoteTrendConfirm(a: AwaitingBase & { kind: 'trendConfirm'; previousValue: string; fractionWhole?: string }): AwaitingField {
  return {
    kind: 'modify', row: a.row, colId: a.colId, name: a.name,
    previousValue: a.previousValue, fractionWhole: a.fractionWhole,
  };
}

/** v0.9.0 빠른 인식(조기확정): interim 숫자가 이 시간(ms) 동안 같은 값으로 안정되면 final을
 *  기다리지 않고 커밋한다. 짧을수록 빠르지만 미완성 숫자(소수점 추가 전) 절단 위험이 커진다. */
const EARLY_COMMIT_STABLE_MS = 400;

/** 빈/극소 클립 판정 임계(바이트) — webm/opus 컨테이너 헤더만 담긴 캡처가 이 이하로 온다.
 *  이하이면 저장하지 않고 clip_empty/clip_cmd_empty로 계측한다([CLIP-3] 가드). */
/** pause()가 recorder dispose 전에 in-flight 클립 저장을 기다리는 상한(ms). 경로별 유예는
 *  의도적 차등 — stop() 5초(세션 종료, 최대 보존), 아카이브 flush 1.5초(백그라운드, UX 무영향). */
const PAUSE_FLUSH_GRACE_MS = 3000;

export function useVoiceSession() {
  const ctrlRef = useRef<SpeechController | null>(null);
  const sessionIdRef = useRef<string>('');
  const sessionLabelRef = useRef<string | undefined>(undefined);
  // 설정탭은 활성 세션 중에도 바뀔 수 있다. 목적지와 컬럼은 start()에서 함께 고정해 한 세션의
  // 자동값·음성값·sheetRow가 서로 다른 농가 설정과 섞이지 않게 한다.
  const sessionTargetRef = useRef<SessionTarget | null>(null);
  const sessionColumnsRef = useRef<Column[] | null>(null);
  const [sessionColumns, setSessionColumns] = useState<Column[] | null>(null);
  const awaitingFieldRef = useRef<AwaitingField | null>(null);
  const epochRef = useRef(0);
  const lastConfidenceRef = useRef<number>(1);
  // v0.9.0 딜레이 계측 — 마지막 interim(중간) 결과의 텍스트·도착시각. final 시 (final.ts − 이 시각)
  // = EOS 꼬리(브라우저 무음 종료감지 대기)를 정량화한다(stt_eos_tail).
  const lastInterimRef = useRef<{ text: string; at: number } | null>(null);
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
  // rowIndex → colId → IDB key; accumulated in-memory until persistSession writes to dataStore
  const pendingClipsRef = useRef<Record<number, Record<string, string>>>({});
  // Snapshot of a persisted row being cascade-corrected; included in persistSession if stop()
  // fires before re-completion so original measurements are not lost.
  const correctionBackupRef = useRef<SessionRow | null>(null);
  // [CLIP-VAL-1]③ / [CLIP-3] unlink race: tombstones for clip keys whose capture FAILED
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
  //   실제 재개한다. hadController는 **첫 suspend 시점** 스냅샷(집합이 빌 때까지 유지). active 여부는
  //   reasons.size>0로 파생(별도 boolean 없음).
  const uiSuspendRef = useRef<{ hadController: boolean; reasons: Set<string> }>({
    hadController: false,
    reasons: new Set<string>(),
  });
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
  const say = useCallback(async (text: string, interrupt = true) => {
    if (!text) return;
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
   *  `reason`은 무엇이 막혔는지 다음 로그 분석에서 보이게 한다(막힌 시도가 잦으면 UX 재고 신호). */
  const isManualHoldBlocked = (reason: string): boolean => {
    if (!useSessionStore.getState().anomalyAlert?.manualHold) return false;
    logCell({
      type: 'command',
      extra: `blocked:manual_hold:${reason}`,
      row: useSessionStore.getState().activeRow,
    });
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
  // '다음'/행 완료는 아래 방향으로만 전진하고, 건너뛴 행은 complete:false placeholder로 남아
  // 데이터탭(EditableCell 터치 편집)에서 채운다.
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
      const values = composeRowValues(columns, r);
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
    // resurrect the unlinked pointer in dataStore ([CLIP-3] race, 06-11 row8 c7). When
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

  /** [CLIP-VAL-1]① — start (or restart) the recording slot for a cell, with the full
   *  announceField choreography: mark the start refs, start the clip, and register it as the
   *  active clip. Called BEFORE the accompanying TTS so a barge-in utterance lands in the clip.
   *  Shared by announceField, the B4 trend-alert prompt, and the modify/cancel re-prompts —
   *  the latter two used to re-ask via say() WITHOUT restarting the slot, so the re-spoken
   *  value was deterministically never recorded (06-11 v0.6.0 row8: "155.5" → clip_empty). */
  const armClipForCell = useCallback((row: number, colId: string) => {
    clipStartRowRef.current = row;
    clipStartColIdRef.current = colId;
    recorderRef.current?.startClip();
    activeClipRef.current = { row, colId };
  }, []);

  const announceField = useCallback(
    async (col: Column, opts?: { isModify?: boolean; previousValue?: string }) => {
      const row = useSessionStore.getState().activeRow;
      // v0.9.0 — 다음 필드로 진입하면 이전 이상치 알람 팝업은 해제(해소된 것으로 간주).
      useSessionStore.getState().setAnomalyAlert(null);
      // v0.12.0 AREA2 V4 — 수정 재안내면 '수정 값' 인디케이터를 켜고, 일반 안내면 해제한다.
      useSessionStore.getState().setModifyIndicator(
        opts?.isModify ? { name: col.name, colId: col.id } : null,
      );
      awaitingFieldRef.current = opts?.isModify
        ? { kind: 'modify', row, colId: col.id, name: col.name, previousValue: opts?.previousValue }
        : { kind: 'value', row, colId: col.id, name: col.name };
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
    [armClipForCell, say],
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

  /** v0.23.0 입력탭#4(민구 결정 — "안내 후 대기"): 마지막 행 너머에 더 갈 곳이 없어도 **자동 종료하지
   *  않는다**. 빈 행이 있으면 함께 안내하고, 어느 경우든 "종료하려면 '종료' 또는 종료 버튼" 안내 후
   *  세션을 active로 유지한다. awaiting을 마지막 음성 필드에 atEnd 센티넬로 둬서 '종료'/'수정' 등 명령은
   *  계속 dispatch되되(handleFinal `if(!awaiting) return` 게이트 통과), 일반 값 발화는 atEnd 가드가
   *  새 행 커밋 대신 종료 재안내로 흡수한다. 종료는 '종료' 음성 명령 또는 종료 버튼으로만 일어난다. */
  const announceEndReached = useCallback(async () => {
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const total = computeTotalRows(getSessionColumns());
    const empties = listEmptyRows(total, vc);
    const lastCol = vc[vc.length - 1] ?? null;
    // 명령 컨텍스트 유지용 atEnd 센티넬(마지막 음성 필드). 값 커밋은 handleFinal의 atEnd 가드가 차단.
    awaitingFieldRef.current = lastCol
      ? { kind: 'atEnd', row: total, colId: lastCol.id, name: lastCol.name }
      : null;
    sess.setReaskReason(null);
    sess.setRecognized('');
    // phase='complete'로 둬 hero가 정적 대기 라벨("N행 완료 — 명령 대기", v0.34.0 A4)을 보이게
    // 한다(마지막 컬럼을 '듣는 중'처럼 보이는 오해 방지). STT는 계속 돌아 '종료'/'수정' 음성 명령이
    // 처리되되(handleFinal는 paused만 게이트), early-commit(active 전용)은 멈춘다.
    // 종료는 '종료' 음성·종료 버튼만.
    sess.setPhase('complete');
    const tail = "종료하려면 '종료'라고 말씀하거나 종료 버튼을 누르세요.";
    const msg = empties.length > 0
      ? `마지막 행까지 입력했습니다. ${formatRowList(empties)}이 비어 있습니다. ${tail}`
      : `마지막 행까지 입력했습니다. ${tail}`;
    sess.setLastTts(msg);
    logCell({
      type: 'session',
      extra: empties.length > 0 ? `end_reached_waiting:empty=${empties.join(',')}` : 'end_reached_waiting',
    });
    await say(msg);
  }, [say]);

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
    const vc = voiceColsList();
    const values = sess.getRowValues(row);
    const parts = vc
      .filter((c) => (values[c.id] ?? '') !== '')
      .map((c) => `${c.name} ${formatForTts(values[c.id])}`);
    const firstCol = vc[0] ?? null;
    sess.setActiveCol(0);
    sess.setRecognized('');
    sess.setReaskReason(null);
    sess.setPhase('complete');
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
  }, [say]);

  // ── progression ────────────────────────────────────────────
  /** Move to next voice col in current row, or finalize row + jump to next target. */
  const advance = useCallback(async () => {
    const startEpoch = epochRef.current;
    const sess = useSessionStore.getState();
    // 리뷰 라운드1(Codex+Flash, 수용) — 필드/행 이동 시 미확정 interim 표시 정리(표시 전용).
    sess.setInterimValue(null);
    const vc = voiceColsList();
    const row = sess.activeRow;
    const total = computeTotalRows(getSessionColumns());

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

    // All voice cols in this row filled — complete
    if (correctionBackupRef.current?.index === row) correctionBackupRef.current = null;
    sess.markRowComplete(row);
    sess.setPhase('complete');
    void persistSession();
    awaitingFieldRef.current = null;
    await announceRowComplete(row);
    if (epochRef.current !== startEpoch) return;

    // If returnRow set (came from modify/jump), go back.
    // v0.5.0 NAV-1 이중 가드: 복귀 대상이 이미 완료된 행이면 복귀하지 않는다 — 완료 행을
    // 재프롬프트하며 같은 행으로 반복 복귀하던 루프의 2차 차단(1차는 goNextRow의 setReturn 제거).
    const ret = sess.returnRow;
    const retCol = sess.returnColIdx;
    if (ret != null && ret !== row) {
      sess.setReturn(null, null);
      if (!isRowVoiceComplete(ret, vc)) {
        const targetCol = retCol ?? firstIncompleteColIdx(ret, vc);
        sess.setActiveRow(ret);
        sess.setActiveCol(targetCol);
        sess.setRecognized('');
        sess.setPhase('active');
        awaitingFieldRef.current = null;
        await announceRowDiff(row, ret);
        if (epochRef.current !== startEpoch) return;
        if (vc[targetCol]) await announceField(vc[targetCol]);
        return;
      }
      // 완료 행으로의 복귀는 무시하고 아래 '다음 미완료 행' 탐색으로 폴스루.
    }

    // Otherwise find next incomplete row (아래 방향만 — wrap-around 없음)
    const next = findNextIncompleteRow(row + 1, total, vc);
    if (next === null) {
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
  }, [announceField, announceRowComplete, announceRowDiff, announceEndReached, persistSession, say]);

  /** v0.35.3 Stage 3-5 — 커밋 경로 진행 공용. 검토 대기(reviewWait) 출신 커밋은 검토 대기를
   *  재무장해 갱신값을 재낭독하고(advance로 검토를 강제 종료하지 않음 — v0.33.0 항목2 계약),
   *  그 외에는 대기를 해제하고 다음 셀로 진행한다. echoValue를 주면 advance 전에 값을 에코
   *  (수동 칩 커밋의 청각 확인 — 음성 커밋과 동일). 종전 commitManualValue·confirmManualAnomaly의
   *  이중 구현을 흡수(순수 이동 — epoch/cancelTts는 호출부가 커밋 확정 시점에 이미 수행). */
  const proceedAfterCommit = useCallback(async (
    awaiting: AwaitingField | null,
    opts?: { echoValue?: string },
  ) => {
    if (awaiting?.kind === 'reviewWait') {
      await enterReviewWait(awaiting.row);
      return;
    }
    awaitingFieldRef.current = null;
    if (opts?.echoValue != null) await say(formatForTts(opts.echoValue));
    await advance();
  }, [advance, enterReviewWait, say]);

  // ── modify (cross-row) ─────────────────────────────────────
  const enterModifyMode = useCallback(async (
    preExtractedValue?: string,
    pendingCmd?: PendingCommandClip | null,
    // v0.34.0 A3(확정 규칙 — 실기기 피드백): 완료 행 "검토 대기"(reviewWait) 중의 '수정'은
    // **포인터(첫) 음성 필드**를 타깃하고, "수정 <컬럼명>"이면 그 컬럼을 타깃한다(handleFinal이
    // idx를 해석해 넘긴다). 직접값("수정 88.9") 적용 후에는 검토 대기(값 재낭독+대기)로 복귀한다.
    reviewTarget?: { row: number; idx: number },
  ) => {
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const curRow = sess.activeRow;
    const curIdx = sess.activeColIdx;

    // Find previous voice col (could be in previous row)
    let targetRow = curRow;
    let targetIdx = curIdx - 1;
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
        } else if (targetRow < curRow || reviewTarget) {
          // If we modified an earlier row — or a reviewed (already-complete/persisted) row whose
          // cell had no clip pointer to hang the update on — make sure it's (re)persisted.
          // persistSession preserves sheetRow/syncState and demotes synced→dirty on change.
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
        sess.pushValueBurst(target.name, parsed); // I-3: 화면 중앙 "항목 : 값" 버스트
        await say(`수정 ${target.name} ${formatForTts(parsed)}`);
        // v0.33.0 — 검토 대기 출신 직접 수정: 값 수신 재안내 대신 검토 대기로 복귀
        // (수정 반영값 재낭독 + 대기 — bare 값 덮어쓰기 금지 계약 유지).
        if (reviewTarget) {
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
    for (let i = targetIdx; i < vc.length; i++) {
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
    await announceField(target, { isModify: true, previousValue: prevTargetValue });
  }, [announceField, enterReviewWait, persistSession, say]);

  // ── public: restart from a voice col (chip tap) ────────────
  const restartFromCol = useCallback(async (colId: string) => {
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const idx = vc.findIndex((c) => c.id === colId);
    if (idx < 0) return;
    const row = sess.activeRow;
    logCell({ type: 'command', parsed: 'restart', extra: 'touch', row, colId });
    // Clear this and subsequent voice values in the current row
    for (let i = idx; i < vc.length; i++) {
      sess.setRowValue(row, vc[i].id, '');
      // Clip preservation (was: delete on touch-restart). A chip-tap restart is also a correction
      // of a (possibly misrecognised) committed value — archive the prior attempt instead of
      // deleting, then unlink the pending pointer so the re-record writes a fresh bare key.
      const pendingMap = pendingClipsRef.current[row];
      if (pendingMap?.[vc[i].id]) {
        archiveCellClip(row, vc[i].id);
        delete pendingMap[vc[i].id];
      }
    }
    sess.markRowIncomplete(row);
    sess.setActiveCol(idx);
    sess.setRecognized('');
    cancelTts();
    epochRef.current++;
    awaitingFieldRef.current = null;
    await announceField(vc[idx]);
  }, [announceField]);

  // ── public: jump to a specific row (auto-chip change / 행 이동 공용) ──────
  const jumpToRow = useCallback(
    async (targetRow: number, options?: { setReturn?: boolean; source?: 'voice' | 'touch' }) => {
      const sess = useSessionStore.getState();
      const vc = voiceColsList();
      const total = computeTotalRows(getSessionColumns());
      if (targetRow < 1 || targetRow > total) return;
      const cur = sess.activeRow;
      if (targetRow === cur) return;
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
      awaitingFieldRef.current = null;
      // v0.33.0 백로그 A(민구 결정 3) — 완료 행 착지: 첫 필드 재안내(값 수신) 대신 "값 읽어주기+대기".
      // (기존 함정: firstIncompleteColIdx 폴백 0 → 첫 필드 재안내 → bare 값이 첫 항목만 덮어쓴 뒤
      //  advance가 returnRow로 튕겨 복귀 — 2번째 이후 항목은 음성으로 접근 불가.)
      if (isRowVoiceComplete(targetRow, vc)) {
        await announceRowDiff(cur, targetRow);
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
        const msg = '첫 행입니다.';
        useSessionStore.getState().setLastTts(msg);
        const vc = voiceColsList();
        await say(msg);
        // v0.33.0 — 첫 행이 이미 완료면(검토 대기 중 '이전' 등) 값 수신 재안내 대신 검토 대기 재무장
        // (announceField는 bare 값 커밋을 열어 결정 3의 덮어쓰기 금지 계약을 깬다).
        if (isRowVoiceComplete(sess.activeRow, vc)) {
          await enterReviewWait(sess.activeRow);
          return;
        }
        const cur = vc[sess.activeColIdx];
        if (cur) await announceField(cur);
        return;
      }
      await jumpToRow(target, { setReturn: true, source });
    },
    [announceField, enterReviewWait, jumpToRow, say],
  );

  // ── v0.5.0 NAV-1: '다음' 단방향 전진 (음성 '다음' + ▶다음 버튼 공용) ──────────
  // 현재 행이 미완료면 skip 표시 + 즉시 영속화(placeholder)한 뒤
  // 아래 방향의 다음 미완료 행으로만 이동한다. returnRow를 만들지 않으므로(기존 stale 복귀도
  // 해제) 완료 행으로 반복 복귀하는 NAV-1 루프가 구조적으로 불가능해진다. 더 갈 행이 없으면
  // v0.23.0 입력탭#4 — 자동 종료하지 않고 빈 행 안내 후 종료 대기(announceEndReached).
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
    sess.setReturn(null, null);
    const row = sess.activeRow;
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
    const next = findNextIncompleteRow(row + 1, total, vc);
    if (next === null) {
      // v0.23.0 입력탭#4 — '다음'으로 마지막 행에 도달해도 자동 종료하지 않고 종료 안내 후 대기.
      await announceEndReached();
      return;
    }
    await jumpToRow(next, { setReturn: false, source });
  }, [announceEndReached, jumpToRow, persistSession]);

  // ── v0.7.0 B4: 추세 검증 ───────────────────────────────────
  /** trend_skip 텔레메트리 — 같은 원인은 세션당 1회만 기록(셀마다 반복돼 로그를 도배하지 않게).
   *  Set은 start()에서 리셋된다. */
  const logTrendSkip = useCallback((cause: string, row: number, colId: string) => {
    if (trendSkipLoggedRef.current.has(cause)) return;
    trendSkipLoggedRef.current.add(cause);
    logCell({ type: 'trend', extra: `trend_skip:${cause}`, row, colId });
  }, []);

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
    if (latch.reasons.size === 0) return;
    // 세션 경계 — 남은 **모든** suspend 소스를 통째로 비운다(복원 없음). 중첩 소스가 있었으면
    //   was=a+b로 함께 남겨 어떤 소스들이 걸려 있었는지 로그로 판별한다(단일 소스는 종전과 동일).
    const prev = [...latch.reasons].join('+') || 'unknown';
    uiSuspendRef.current = { hadController: false, reasons: new Set<string>() };
    // 기존 ui_resume/ui_suspend와 같은 command 레인 — 신규 이벤트 타입 무첨가(log-replay 호환).
    logCell({
      type: 'command',
      parsed: 'ui_suspend_cleared',
      extra: `${reason}:was=${prev ?? 'unknown'}`,
      row: useSessionStore.getState().activeRow,
    });
  }, []);

  const suspendRecognitionForUi = useCallback((reason = 'ui_modal') => {
    const latch = uiSuspendRef.current;
    if (latch.reasons.has(reason)) return; // 같은 소스 재진입 — 멱등(중복 add·중복 로그 방지)
    const wasActive = latch.reasons.size > 0;
    latch.reasons.add(reason);
    // 이미 다른 소스가 suspend 중이면(중첩) 집합에만 추가하고 실제 STT 상태는 건드리지 않는다.
    //   ui_suspend/ui_resume 로그는 **실제 STT 상태 전이**(빈집합↔비빈집합)에만 남겨(단일 소스 계약
    //   바이트 불변), 중첩 add/remove는 조용한 래치 부기다. hadController는 첫 suspend에서만 스냅샷.
    if (wasActive) return;
    latch.hadController = !!ctrlRef.current;
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
  }, []);

  // ── final result handler ───────────────────────────────────
  const handleFinal = useCallback(async (textArg: string, alts: string[], confidence: number) => {
    // v0.20.0 Phase 5 #4 — 반응속도(발화 확정→값 커밋) 측정 시작점. STT final이 handleFinal에
    // 진입한 순간을 찍어, 값 커밋 시점(아래 value 이벤트)까지의 경과ms를 commitLatencyMs로 동봉한다.
    // EOS 꼬리([STT-11], 브라우저 무음종료)와 달리 이건 **앱 파이프라인** 지연(파싱·추세검사·persist).
    const handleFinalAt = Date.now();
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

    /** '확인'(추세 알림 밖) — 상태 변경 없이 짧은 재안내만(v0.7.0 B4, 무음 금지 REVIEW-4).
     *  trendConfirm 중의 '확인'은 resolveFinal이 trendResolve로 먼저 처리한다. */
    async function cmdConfirm(a: AwaitingField): Promise<void> {
      cancelTts();
      const msg = `확인할 알림이 없습니다. ${a.name} 말씀해 주세요.`;
      useSessionStore.getState().setLastTts(msg);
      await say(msg);
    }

    /** '수정' — 명령 발화 클립을 보존한 뒤 수정 모드 진입. 이미 수정 의미론이면 같은 셀 재질문.
     *  reviewWait에선 v0.34.0 A3 확정 규칙: bare '수정'=포인터 컬럼, "수정 <컬럼명>"=지목 컬럼. */
    async function cmdModify(a: AwaitingField, utterance: string): Promise<void> {
      cancelTts();
      // Capture the '수정'/'정정' utterance itself (spoken into the awaiting cell's active clip)
      // before enterModifyMode starts a fresh clip. The SAVE is deferred: enterModifyMode resolves
      // the modify TARGET cell, and a direct "수정 <값>" re-keys the clip to that target so its
      // pointer isn't orphaned (CLIP-CMD). Background save — never blocks the voice flow.
      const pendingCmd = preserveCommandClip(a.row, a.colId);
      if (isModifyLike(a)) {
        // No target re-link here (we're already re-listening for the value) — save against the
        // awaiting cell so the utterance still survives for analysis.
        pendingCmd?.saveDefault();
        // [CLIP-VAL-1]①: preserveCommandClip above STOPPED the active clip — restart the slot
        // before the re-ask TTS so the re-spoken value IS recorded (it deterministically wasn't:
        // say() never starts a clip, unlike announceField). Also the landing path for a B4
        // trendConfirm dismissed by '수정' (trendConfirm은 수정 의미론을 겸장한다).
        armClipForCell(a.row, a.colId);
        await say(`${a.name} 다시 말씀해 주세요.`);
        return;
      }
      // 상호배타 순서 주의 — extractModifyValue는 '수정' 뒤 **임의 텍스트**를 값 후보로 돌려주므로
      // ("수정 종경" → '종경'), reviewWait에선 컬럼명 매치를 먼저 확인해야 한다(숫자 발화는 컬럼명과
      // 매치될 수 없어 "수정 30.7" 직접값 경로는 그대로 성립). reviewWait 스코프 한정 — 일반 수정
      // 의미론(직전 필드·값 추출)은 불변. 직접값 적용 후엔 검토 대기 복귀(enterModifyMode).
      let modifyVal = extractModifyValue(utterance);
      let reviewTarget: { row: number; idx: number } | undefined;
      if (a.kind === 'reviewWait') {
        const vcRw = voiceColsList();
        let idx = Math.max(0, vcRw.findIndex((c) => c.id === a.colId));
        const named = extractModifyColumn(utterance, vcRw.map((c) => c.name));
        const namedIdx = named ? vcRw.findIndex((c) => c.name === named) : -1;
        if (namedIdx >= 0) {
          idx = namedIdx;
          modifyVal = null; // 컬럼명 지목 — 값 후보('종경' 등 비숫자 잔여)로 오적용 금지
        }
        reviewTarget = { row: a.row, idx };
      }
      await enterModifyMode(modifyVal || undefined, pendingCmd, reviewTarget);
    }

    /** '취소' — 인식값을 지우고 같은 필드 재질문. [CLIP-VAL-1]① (cancel sibling): '수정'→'취소'
     *  체인 뒤 슬롯이 소비돼 있으므로 재발화 녹음 슬롯을 재무장한다(startClip은 멱등). */
    async function cmdCancel(a: AwaitingField): Promise<void> {
      cancelTts();
      useSessionStore.getState().setRecognized('');
      armClipForCell(a.row, a.colId);
      await say(`${a.name} 다시 말씀해 주세요.`);
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
      // Do NOT replay the full field prompt (that is the ~10s cost T-2 reported). Stay on the
      // current field with a short re-ask so the user can simply repeat the command/value.
      await say(`${awaiting.name} 다시 말씀해 주세요.`);
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
      useSessionStore.getState().setAnomalyAlert(null); // 팝업 해제
      logCell({
        type: 'trend', extra: 'trend_alert_confirmed', parsed: cmd,
        row: awaiting.row, colId: awaiting.colId,
        ...(awaiting.previousValue != null ? { previousValue: awaiting.previousValue } : {}),
      });
      awaitingFieldRef.current = null;
      await advance();
      return;
    }
    if (action.act === 'dispatch' && action.trendDemoted && awaiting.kind === 'trendConfirm') {
      useSessionStore.getState().setAnomalyAlert(null); // 타 명령으로 해제 → 팝업 닫음
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
        case 'prevRow':
          // v0.33.0 백로그 A(민구 결정 1): 음성 '이전' = ◀ 버튼과 동일한 단순 행 이동(재입력 모드 폐지).
          // 완료 행 착지는 jumpToRow가 "값 읽어주기 + 검토 대기"로 처리한다(결정 3).
          await gotoAdjacentRow(-1, 'voice');
          return;
        case 'nextRow':
          // v0.5.0 NAV-1: '다음'은 항상 단방향 전진(goNextRow) —
          // 미완료 행은 skip(placeholder) 처리, returnRow 미등록, 완료 행 재프롬프트 없음.
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
        logCell({ type: 'stt_barge_in', text, confidence, row: awaiting.row, colId: awaiting.colId });
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
      await say("입력이 끝났습니다. 종료하려면 '종료'라고 말씀하거나 종료 버튼을 누르세요.");
      return;
    }

    // v0.33.0 백로그 A(민구 결정 3) — 완료 행 검토 대기(reviewWait): 명령은 위에서 이미 dispatch됐다.
    // 여기 도달한 것은 일반 값 발화 — 완료 행을 bare 값으로 덮어쓰지 않고 안내만 한다(수정은
    // '수정' 명령으로만). atEnd 가드와 동일한 흡수 패턴.
    if (awaiting.kind === 'reviewWait') {
      useSessionStore.getState().setRecognized('');
      await say(`${awaiting.row}행은 완료된 행입니다. 수정하려면 '수정', 다음 행은 '다음'이라고 말씀해 주세요.`);
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
        useSessionStore.getState().setReaskReason('parse_failed');
        await say(`${awaiting.name} 다시 말씀해 주세요.`);
        return;
      }
      const KNOWN_NOISE = /^(변경|성경|광경|구정|혜정|당장|경정)$/;
      if (KNOWN_NOISE.test(text.trim())) {
        logCell({ type: 'stt_rejected_col_name', text, row: awaiting.row, colId: awaiting.colId, extra: 'known_noise' });
        recorderRef.current?.startClip();
        useSessionStore.getState().setRecognized('');
        useSessionStore.getState().setReaskReason('parse_failed');
        await say(`${awaiting.name} 다시 말씀해 주세요.`);
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
        useSessionStore.getState().setReaskReason('parse_failed');
        const respFracWhole = fractionWholeOf(awaiting);
        if (respFracWhole != null) {
          // FB#4 — 화면 재질문 큐도 TTS와 같은 문구를 표시(SSOT 상수 공유). 정수부를 store에 실어
          //   ReaskCue가 decimalReaskPrompt로 렌더한다(글자까지 일치).
          useSessionStore.getState().setDecimalReason(String(respFracWhole));
          await say(decimalReaskPrompt(respFracWhole));
        } else {
          recorderRef.current?.startClip();
          await say(`${awaiting.name} 다시 말씀해 주세요.`);
        }
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
        recorderRef.current?.startClip();
        useSessionStore.getState().setRecognized('');
        useSessionStore.getState().setReaskReason('parse_failed');
        await say(`${awaiting.name} 다시 말씀해 주세요.`);
        return;
      }
    }

    // Low confidence — re-ask
    if (confidence > 0 && confidence < minConfidence) {
      // v0.23.0 입력탭#2 — 저신뢰 재질문을 명시 이벤트로 로깅(이전엔 무로깅). confidence + 다이얼 값 +
      // 실제 게이트를 함께 박제해 차기 분석이 "설정값 vs 실제 신뢰도"를 정량 대조하게 한다(갭 해소).
      // v0.25.0 F1 — 다이얼 값(tolerance)과 반전된 실제 임계(minConf)를 둘 다 싣는다. 반전 이후엔
      // `confidence < minConf` 불변식이 이벤트 자체로 읽혀야 하고(예 conf 0.65 < minConf 0.70), 다이얼
      // 값만 두면 "0.65인데 tolerance 0.60에서 거부"처럼 모순으로 보인다(Trace가 반전식을 몰라도 명료).
      logCell({
        type: 'stt_rejected_low_confidence', text, confidence,
        row: awaiting.row, colId: awaiting.colId,
        colName: awaiting.name, extra: `tolerance:${recognitionTolerance},minConf:${minConfidence}`,
      });
      recorderRef.current?.startClip(); // restart clip
      useSessionStore.getState().setRecognized('');
      useSessionStore.getState().setReaskReason('low_confidence');
      await say(`잘 못 들었습니다. ${awaiting.name} 다시 말씀해 주세요.`);
      return;
    }

    // Plain value — with alts fallback on parse failure (item 11)
    const col = getColById(awaiting.colId);
    let parsed: string | null = null;
    // v0.10.0 A1 타깃 재질문 후속: 소수부만 기다리는 중이면(직전 발화가 decimal_fraction_lost) 이번
    // 발화를 소수부로 합성 시도. 모드는 한 번만 적용하고 즉시 해제한다 — 합성 실패 시 아래 평소 파싱이
    // 전체 발화로 처리하므로, 사용자가 "111.5" 전체를 다시 말한 경우도 그대로 커밋된다.
    const fractionWhole = fractionWholeOf(awaiting);
    if (fractionWhole != null) {
      // 여기 도달 시 kind는 value|modify|trendConfirm — atEnd/reviewWait는 위 가드가 return(내로잉 증명).
      awaitingFieldRef.current = { ...awaiting, fractionWhole: undefined };
      if (col) {
        const frac = parseKoreanNumber(text);
        // 소수 한 자리(0~9)만 말한 경우에만 정수부와 합성. 2자리 이상·소수점 포함은 전체 값을 다시
        // 말한 것으로 보고 합성하지 않는다(아래 평소 파싱이 처리).
        if (frac !== null && /^[0-9]$/.test(frac)) {
          parsed = parseValueForCol(col, `${fractionWhole}.${frac}`);
          if (parsed !== null) {
            logCell({ type: 'stt', extra: 'decimal_fraction_recovered', text: `${fractionWhole}.${frac}`, originalText: text, row: awaiting.row, colId: awaiting.colId });
          }
        }
      }
    }
    if (parsed === null) {
      parsed = col ? parseValueForCol(col, text) : null;
    }
    // v0.5.0 W4/W5: capture the parser's machine-readable fail reason from the PRIMARY
    // transcript (before the alts loop overwrites it) — tags stt_parse_failed below so the
    // next log analysis can split multi_numeric / decimal_fraction_lost re-asks from generic ones.
    const parseFailReason = parsed === null ? getLastParseFailReason() : null;
    // v0.10.0 A1: decimal_fraction_lost 시 파싱된 정수부 — 타깃 재질문에 쓴다(PRIMARY 직후 캡처;
    // alts 루프의 parseValueForCol이 _lastParseFailWhole을 덮어쓰기 전에).
    const parseFailWhole = parsed === null ? getLastParseFailWhole() : null;
    if (parsed === null && alts.length > 1) {
      for (let ai = 1; ai < Math.min(alts.length, 3); ai++) {
        const alt = alts[ai];
        if (!alt || alt === text) continue;
        // primary가 독립 숫자 복수/무관 토큰을 잡았다면 alternative의 숫자만 골라 커밋하지 않는다.
        // `현백 33.3`→alt `33.3`, `이 166.7`→alt `166.7`은 STT가 잃은 자리값/숫자 의미를
        // 복구한 것이 아니라 위험 신호를 삭제한 후보이므로 전체 발화를 다시 받는 것이 유일하게 안전하다.
        if (parseFailReason === 'multi_numeric' || parseFailReason === 'extraneous_token') continue;
        // v0.34.0 O2 [STT-17] — 응답어 alt 차단: primary가 응답어면 위 가드가 이미 재질문했지만,
        // primary가 다른 잡음("예에" 등)이고 **alt가 "네"**면 native 4로 커밋되는 07-14 실사례
        // 경로가 남는다. 숫자 컬럼에선 응답어 alt를 건너뛴다(text/options는 "네"가 정당한 값일
        // 수 있어 제외 — primary 가드와 동일 스코프).
        if (col && (col.type === 'int' || col.type === 'float') && isBareResponseWord(alt)) continue;
        // v0.33.0 [STT-15] — 소수부 재질문 문맥에서는 alt도 **소수부 파서(정수부 합성)로만** 해석한다.
        // 07-13 실기기: "211 점 의" 재질문 → primary "하악" 파싱 실패 → alts 루프가 "하나"를
        // fractionWhole=211 문맥을 모른 채 **전체값 "1"로 커밋**(무알람 시트 동기화). 조각(단자리)은
        // 정수부와 합성해 복구하고, 합성 불가 alt는 건너뛴다 — 전체값 폴백 금지(:1502 주석의
        // "값 추측/조용한 오커밋 방지" 민구 결정을 alts 경로에도 동일 적용).
        if (fractionWhole != null) {
          const altFrac = parseKoreanNumber(alt);
          if (altFrac !== null && /^[0-9]$/.test(altFrac)) {
            const composed = col ? parseValueForCol(col, `${fractionWhole}.${altFrac}`) : null;
            if (composed !== null) {
              parsed = composed;
              logCell({ type: 'stt_alt_used', altIdx: ai, text: alt, originalText: text, row: awaiting.row, colId: awaiting.colId, extra: `frac_ctx:${fractionWhole}` });
              logCell({ type: 'stt', extra: 'decimal_fraction_recovered', text: `${fractionWhole}.${altFrac}`, originalText: alt, row: awaiting.row, colId: awaiting.colId });
              break;
            }
          }
          continue;
        }
        // v0.34.0 O3 — 소수 의도 보존: primary가 decimal_fraction_lost("266 점요" — 소수 의도인데
        // 소수부 유실 → 타깃 재질문 예정)인데 alt가 **정수**("266")면, alt 폴백이 소수 의도를 버린
        // 침묵 커밋이 된다(07-14 09:25:49 실사례 — 사전은 이미 점요를 잡지만 alt가 우회). 정수 alt는
        // 건너뛰어 아래 타깃 재질문으로 넘기고, 소수를 온전히 담은 alt("266.2")만 수용한다.
        if (parseFailReason === 'decimal_fraction_lost' && !alt.includes('.') && !/[점쩜]/.test(alt)) continue;
        const altParsed = col ? parseValueForCol(col, alt) : null;
        if (altParsed !== null) {
          // (O3 방어 2선) 정수로 파싱된 alt도 동일 사유로 거부 — "266 점" 류 alt가 정수로 환원되는 경우.
          if (parseFailReason === 'decimal_fraction_lost' && !altParsed.includes('.')) continue;
          parsed = altParsed;
          logCell({ type: 'stt_alt_used', altIdx: ai, text: alt, originalText: text, row: awaiting.row, colId: awaiting.colId });
          break;
        }
      }
    }
    if (parsed === null) {
      // v0.20.0 Phase 5 #2 — parse_failed 보강: 원본 transcript(text)는 이미 동봉. 여기에 항목명
      // (colName)과 직전 컨텍스트(소수부 재질문 중이면 정수부 fractionWhole)를 더해 "주로 실패하는
      // 숫자/항목"을 다음 세션부터 정량화한다. (런타임에 '기대값'은 알 수 없어 추가하지 않는다 —
      // 실세션은 정답이 없는 자유 측정이므로 transcript+context로 패턴을 집계하는 것이 정직하다.)
      logCell({
        type: 'stt_parse_failed', text, altsCount: alts.length,
        extra: parseFailReason ?? undefined,
        row: awaiting.row, colId: awaiting.colId,
        colName: awaiting.name,
        ...(fractionWhole != null ? { originalText: `frac_ctx:${fractionWhole}` } : {}),
      });
      // v0.23.0 입력탭#2 — 파싱 실패도 재질문 사유로 표면화(높은 신뢰도인데 재질문되는 혼동 해소).
      useSessionStore.getState().setReaskReason('parse_failed');
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
        // FB#4 — 화면 재질문 큐를 TTS와 글자 일치시키기 위해 정수부를 store에 싣는다(SSOT 공유).
        useSessionStore.getState().setDecimalReason(String(parseFailWhole));
        await say(decimalReaskPrompt(parseFailWhole));
      } else if (fractionWhole != null) {
        // v0.33.0 [STT-15] 재질문 유지 — 소수부 재질문 응답이 소수부(합성)로도 전체값(primary)로도
        // 해석되지 않으면 문맥(fractionWhole)을 버리지 않고 같은 타깃 재질문을 반복한다. 이전엔
        // 문맥이 원샷 해제돼 다음 발화가 전체값으로 처리됐다(조각 "1"이 값으로 설 위험).
        // 클립도 decimal_fraction_lost 분기와 동일하게 재시작하지 않는다(원본+조각 연속 보존).
        logCell({ type: 'clip', extra: 'clip_decimal_kept', row: awaiting.row, colId: awaiting.colId });
        awaitingFieldRef.current = { ...awaiting };
        // FB#4 — 화면 재질문 큐를 TTS와 글자 일치(SSOT 공유).
        useSessionStore.getState().setDecimalReason(String(fractionWhole));
        await say(decimalReaskPrompt(fractionWhole));
      } else {
        recorderRef.current?.startClip(); // restart clip (전체 재발화 유도 분기 — 새 클립이 옳다)
        await say(`${awaiting.name} 다시 말씀해 주세요.`);
      }
      return;
    }

    const myEpoch = ++epochRef.current;
    const sess = useSessionStore.getState();
    sess.setRowValue(awaiting.row, awaiting.colId, parsed);
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
    // 보여준다. 그 뒤 advance→announceField가 팝업을 닫으면(setAnomalyAlert(null)), VoiceScreen의
    // `valueBurst && !anomalyAlert` 조건이 참이 되며 같은 값이 CenterValueBurst로 한 번 더 떠
    // "정상 입력 내용이 한 번 더 팝업"되던 중복(민구 제보)이 발생한다. 정정-출처 커밋에선 burst를
    // 건너뛰어 중앙 팝업이 1회(초록 corrected)만 뜨게 한다. 일반(비-정정) 커밋의 burst는 그대로 유지.
    if (awaiting.kind !== 'trendConfirm') {
      sess.pushValueBurst(awaiting.name, parsed); // I-3: 화면 중앙 "항목 : 값" 버스트
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
        ...(isModifyLike(awaiting) && previousValueOf(awaiting) != null
          ? { previousValue: previousValueOf(awaiting) }
          : {}),
      });
      // 응답 대기 상태 무장 — 새 값 발화가 기존 수정(isModify) 의미론으로 재커밋되도록
      // previousValue=방금 커밋된 값과 함께 세팅한다.
      awaitingFieldRef.current = {
        kind: 'trendConfirm',
        row: awaiting.row, colId: awaiting.colId, name: awaiting.name,
        previousValue: parsed,
      };
      // 응답 발화('확인'/새 값) 클립 시작 — announceField 패턴(TTS 이전 시작, barge-in 수록).
      armClipForCell(awaiting.row, awaiting.colId);
      // 시각 팝업: 이전값→현재값과 변화량을 띄운다(발화만으론 스쳐 지나가 확인이 어렵다는 요청).
      useSessionStore.getState().setAnomalyAlert({
        ...alert,
        // v0.33.0 항목7 — 응답 대기 알람: 팝업이 [확인][수정] 터치 버튼을 그린다(음성 명령과 동일
        // 동작·동일 로그, 07-10 QA P1 #2). 수동 커밋의 정보성 팝업(확인 루프 없음)과 구분.
        awaitingResponse: true,
      });
      playBeep('alert');
      useSessionStore.getState().setLastTts(alertText);
      await say(alertText);
      // v0.34.0 O1 — 재위반(정정값이 또 위반) 커밋도 검사 대상(이전 .then 무조건 실행과 동등) —
      // 단 알람 TTS까지 끝난 지금 시점에 스케줄한다.
      runCorrectedPersistCheck();
      return; // advance 중단 — 해소는 handleFinal 상단의 trendConfirm 분기
    }

    // ── v0.13.0 R2(민구 요청): 추세 알림에 새 값으로 응답한 정정이 '정상'으로 판명된 경우 ──
    // (위 trendViolation 분기를 타지 않고 여기 도달 = 정정값이 정상 범위.) 화면에 떠 있던 빨강 이상치
    // 팝업을 초록(corrected)으로 전환하고 next를 정정값으로 즉시 반영한다. 이전엔 이 경로에서 팝업을
    // 전혀 갱신하지 않아 옛 이상치 값이 남은 채 echo TTS("수정 …")만 새 값을 말해 시각/청각이 어긋났다.
    // 팝업 닫힘은 기존대로 advance()→announceField의 setAnomalyAlert(null)이 담당하므로, echo TTS가
    // 발화되는 동안 초록 팝업이 노출된다(별도 타이머 없이 '초록 전환 + 즉시 반영' 성립).
    if (awaiting.kind === 'trendConfirm') {
      const cur = useSessionStore.getState().anomalyAlert;
      if (cur) {
        useSessionStore.getState().setAnomalyAlert({
          ...cur,
          next: formatForTts(parsed),
          status: 'corrected',
        });
        playBeep('corrected');
      }
    } else if (awaiting.kind === 'modify') {
      playBeep('modify');
    }

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
    await advance();
  }, [advance, enterModifyMode, say, goNextRow, gotoAdjacentRow, persistSession, evaluateTrend, getAnomalyAlertData, archiveCellClip, armClipForCell]);

  // ── v0.9.0 interim(중간) 결과 처리: EOS 계측 마킹 + (빠른 인식 ON 시) 조기확정 ──
  const handleInterim = useCallback((text: string) => {
    const now = Date.now();
    // EOS 계측: 마지막 interim 도착 시각 기록 — handleFinal이 final.ts와의 차로 꼬리를 산출.
    lastInterimRef.current = { text, at: now };

    // v0.36.0 FB#2(Vance) — 미확정 인식 텍스트를 **표시 전용** store 필드에 기록(파형과 함께 "지금
    //   이렇게 들었다"를 원거리에 노출). 값-대기(value/trendConfirm) 문맥에서만 — 이동/종료 대기
    //   중엔 임시값을 띄우지 않는다. 명령어는 확정값이 아니므로 제외. 순수 표시 — 조기확정·커밋·
    //   텔레메트리 경로는 아래 로직 그대로(이 write는 그 앞에서 무조건 실행, fastRecognition 무관).
    const trimmedInterim = text.trim();
    const awaitingForDisplay = awaitingFieldRef.current;
    const showInterim =
      !!trimmedInterim &&
      !!awaitingForDisplay &&
      awaitingForDisplay.kind !== 'atEnd' &&
      awaitingForDisplay.kind !== 'reviewWait' &&
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
    if (!awaiting || awaiting.kind === 'trendConfirm' || awaiting.kind === 'atEnd' || awaiting.kind === 'reviewWait') return;
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

  const resumeRecognitionForUi = useCallback((reason = 'ui_modal') => {
    const latch = uiSuspendRef.current;
    if (!latch.reasons.has(reason)) return; // 이 소스는 suspend 중이 아님 — no-op(스퓨리어스 resume 방어)
    latch.reasons.delete(reason);
    // v0.37.0 리뷰(3모델 공통) — **다른 suspend 소스가 아직 남아 있으면 실제 재개하지 않는다.**
    //   수동 시트 + 개선요청 모달 중첩 시, 개선요청만 닫혀도 시트 뒤에서 STT가 살아나던 레이스의 차단축.
    //   집합이 완전히 빌 때만 인식기를 복원한다(모든 오버레이 해제 확인).
    if (latch.reasons.size > 0) return;
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
    if (!shouldRestore || ctrlRef.current) return;
    ctrlRef.current = new SpeechController({
      onFinal: handleFinal,
      onInterim: handleInterim,
      onError: () => {},
    });
    setActiveController(ctrlRef.current);
    ctrlRef.current.start();
  }, [handleFinal, handleInterim]);

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
    const sess = useSessionStore.getState();
    if (sess.phase === 'stopping') return false;
    const target = sessionTargetFromSettings(s);
    if (!target) {
      sess.setLastTts('시트 연결을 다시 확인해 주세요.');
      return false;
    }
    if (!s.tableGenerated) return false;
    const columns = structuredClone(s.columns);
    const vc = columns.filter((c) => c.input === 'voice');
    if (vc.length === 0) return false;
    const total = computeTotalRows(columns);
    if (total === 0) return false;

    sessionTargetRef.current = target;
    sessionColumnsRef.current = columns;
    setSessionColumns(columns);

    // v0.35.0 R3-FIX-1 — 방어적 초기화. stop()이 이미 풀지만, stop을 거치지 않은 경로(크래시 후
    //   재개·언마운트/리마운트 등)로 래치가 남아 들어와도 새 세션은 항상 깨끗한 상태에서 시작한다.
    //   already-false면 no-op(로그도 없음).
    clearUiSuspendLatch('start');

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

    warmupTts();
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
    // v0.38.0 리뷰#1(Codex High) — 이전 세션의 마지막 UI 음성명령(도움말·인식률 등)이 남아 있으면,
    // 새 세션에서 ActiveState가 마운트될 때 소비 시퀀스가 0으로 초기화돼 **그 명령이 자동 재실행**된다
    // (세션 B 시작하자마자 도움말이 열리고, 인식률 설정이 한 번 더 바뀐다). 세션 경계에서 비운다.
    uiCommandSeqRef.current = 0;
    setUiCommand(null);
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
        // NOTE: session label intentionally NOT logged — buildAutoLabel derives it from the first
        // fixed auto column (농가명 = grower name), a PII vector. Reach is fully computable from
        // sessionId + appVersion + totalRows + completedRows. The label still lives on the Session
        // object (unchanged); it just stays out of telemetry events.
        sessionMode: 'field',
      },
    });

    // Init audio recorder fire-and-forget — mic permission is independent of STT startup.
    // Awaiting getUserMedia can block indefinitely in headless/denied-permission environments.
    if (!recorderRef.current) recorderRef.current = new AudioRecorder();
    // v0.34.0 D11b — 파동 통계 리셋: prewarm(입력탭 마운트)이 세션 전부터 캡처를 돌리므로
    // 세션 밖 구간이 wave_stats에 섞이지 않게 시작 시점에 0으로 되돌린다.
    recorderRef.current.resetWaveStats();
    // #4 active mic: once init() resolves, emit a follow-up session event carrying the granted
    // input device. Done async (not awaited) so STT startup is never blocked; emitted as its own
    // event so analysis can attribute STT accuracy to the real device per session.
    void recorderRef.current.init().then((ok) => {
      // v0.34.0 D11b — UI 이펙트 자가검증 1건: 파동/글로우 활성 + 프리롤 캡처 경로. init 실패
      // (ok=false)여도 남긴다 — preroll=unavailable이 곧 "파동 무동작(레벨 0 폴백)" 판정 근거.
      logCell({
        type: 'session',
        extra: `ui_fx:wave=on,glow=on,preroll=${recorderRef.current?.getPrerollKind() ?? 'unavailable'}`,
      });
      if (!ok) return;
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
    }).catch(() => {});

    await say('음성 입력을 시작합니다.');
    await announceRowDiff(null, 1);

    ctrlRef.current = new SpeechController({
      onFinal: handleFinal,
      onInterim: handleInterim,
      onError: () => {},
    });
    setActiveController(ctrlRef.current);
    ctrlRef.current.start();

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
    // v0.35.0 R3-FIX-1 — 종료 확인 '확인' 경로는 resume 없이 여기로 온다. 래치를 여기서 풀지 않으면
    //   다음 세션의 모달 suspend가 전부 조기 반환돼 STT가 안 멈춘다. 복원은 불필요(세션 종료 중).
    clearUiSuspendLatch('stop');
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
  }, [persistSession]);

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
    if (cur) await announceField(cur);
  }, [announceField, handleFinal, handleInterim, say]);

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
  // 인앱 탭 전환([STT-16])은 visibility가 안 변하므로 이 경로가 아니라 App.tsx의 keep-alive
  // 렌더(세션 활성 중 VoiceScreen 유지)가 담당한다.
  useEffect(() => {
    const onForegroundReturn = (evt: 'vis' | 'pageshow') => {
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
    const onVis = () => { if (document.visibilityState === 'visible') onForegroundReturn('vis'); };
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
    if (s.sessionId && s.phase !== 'ready' && s.phase !== 'done') {
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
  }, []);

  /** v0.33.0 항목6 — 셀 값 영속 공유 코어. 터치 인라인 편집(commitTouchValue)과 수동 입력 시트
   *  (commitManualValue)가 공유한다: sessionStore + dataStore(patchRowValues — F2: "값 변경 ⇒
   *  synced→dirty" 불변식으로 업로드된 행도 다음 sync가 시트 행을 UPDATE) + IDB 반영.
   *  행이 아직 완료된 적이 없으면 sessionStore만 갱신되고, 다음 persistSession에서 자연 반영된다. */
  const persistCellValue = useCallback(async (row: number, colId: string, value: string) => {
    useSessionStore.getState().setRowValue(row, colId, value);
    const updatedSession = useDataStore
      .getState()
      .patchRowValues(sessionIdRef.current, row, { [colId]: value });
    if (updatedSession) {
      try { await saveSession(updatedSession); } catch { /* ignore */ }
    }
  }, []);

  /** v0.11.0: touch 컬럼 값 commit 시 sessionStore + dataStore + IDB 모두에 즉시 반영.
   *  Codex MEDIUM: setRowValue만으로는 휘발성 상태만 변경 → sync/CSV가 누락하는 위험 해결.
   *  v0.33.0 항목6 — 영속 코어는 persistCellValue로 추출(수동 입력 시트와 공유). */
  const commitTouchValue = useCallback(async (row: number, colId: string, value: string) => {
    logCell({ type: 'command', parsed: 'touch_commit', extra: 'touch', text: value, row, colId });
    await persistCellValue(row, colId, value);
    // v0.37.0 리뷰#1 후속(Codex Medium) — 터치 인라인 커밋도 검토 영수증을 발행한다(음성·수동·이상치
    //   정정과 동일 패턴). 검토(complete) 중 터치 컬럼을 편집하면 검토 화면이 그 값을 보여야 오표시가
    //   없다. 커밋/전진 조건 무수정 — 기존 persist 뒤 표시 전용 영수증만 추가.
    const col = getColById(colId);
    if (col) useSessionStore.getState().pushCommitReceipt(row, colId, col.name, value);
  }, [persistCellValue]);

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
      const { logExtra, alert } = buildAnomalyAlert({
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
    };

    const awaiting = awaitingFieldRef.current;
    const ownsFlow = !!awaiting
      && (awaiting.kind === 'reviewWait' || (awaiting.kind !== 'atEnd' && awaiting.row === row && awaiting.colId === colId));
    if (violation && ownsFlow) {
      epochRef.current++;
      cancelTts();
      if (awaiting!.kind !== 'reviewWait') {
        awaitingFieldRef.current = { kind: 'modify', row, colId, name: col.name, previousValue: value };
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
        useSessionStore.getState().setAnomalyAlert(null);
        const current = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
        if (current) useDataStore.getState().upsertSession(withoutPendingCandidate({ ...current, pendingValidation }));
      }
      return;
    }

    // 일반값/정보성 이상치는 기존 즉시 영속 계약을 유지한다.
    await persistCellValue(row, colId, value);
    // v0.37.0 리뷰#1 — 수동 시트 커밋 영수증(검토 화면 파생 SSOT). 보류(manualHold) 분기는 위에서
    //   return하므로 여기 도달 = 확정 커밋(일반값·정보성 이상치). 보류 정정값은 confirmManualAnomaly가 발행.
    useSessionStore.getState().pushCommitReceipt(row, colId, col.name, value);
    sess.setRecognized(value);
    sess.setReaskReason(null);

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
      useSessionStore.getState().setAnomalyAlert(null);
    }
    if (awaiting?.kind === 'reviewWait') {
      epochRef.current++;
      cancelTts();
      await proceedAfterCommit(awaiting); // 검토 대기 재무장(갱신값 재낭독)
    } else if (awaiting && awaiting.kind !== 'atEnd' && awaiting.row === row && awaiting.colId === colId) {
      epochRef.current++;
      cancelTts();
      await proceedAfterCommit(awaiting, { echoValue: value }); // echo 후 진행
    }
    // (awaiting이 다른 셀이면 흐름 불변 — 값만 반영되고 현재 안내 상태 유지.)

    if (violation) fireManualAlert(violation, false);
  }, [archiveCellClip, evaluateTrend, getAnomalyAlertData, persistCellValue, persistSession, proceedAfterCommit]);

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
    useSessionStore.getState().setAnomalyAlert(null);
    logCell({
      type: 'trend', extra: 'trend_alert_confirmed', parsed: 'confirm',
      row: awaiting.row, colId: awaiting.colId,
      ...(awaiting.previousValue != null ? { previousValue: awaiting.previousValue } : {}),
    });
    awaitingFieldRef.current = null;
    await advance();
  }, [advance]);

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
    useSessionStore.getState().setAnomalyAlert(null);
    logCell({
      type: 'trend', extra: 'trend_alert_dismissed:modify',
      row: awaiting.row, colId: awaiting.colId,
    });
    // 음성 경로의 trendConfirm 해제('modify' 강등 후 재질문)와 동일 상태(fractionWhole 보존).
    awaitingFieldRef.current = demoteTrendConfirm(awaiting);
    armClipForCell(awaiting.row, awaiting.colId);
    await say(`${awaiting.name} 다시 말씀해 주세요.`);
  }, [armClipForCell, say]);

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
    useSessionStore.getState().setAnomalyAlert(null);
    logCell({
      type: 'trend', extra: 'trend_alert_confirmed', parsed: 'confirm',
      row: alert.row, ...(alert.colId ? { colId: alert.colId } : {}),
    });
    // v0.37.0 리뷰#1 — 이상치 정정(수동 보류) [확인] 커밋 영수증: 검토 화면은 **정정되어 확정된**
    //   후보값(candidateValue)을 보여야 한다(거부된 직전값 아님). proceedAfterCommit(advance→검토) 전에 발행.
    {
      const pv = staged.pendingValidation;
      if (pv) useSessionStore.getState().pushCommitReceipt(pv.row, pv.colId, alert.colName, pv.candidateValue);
    }
    // 보류 시 재무장을 미뤘던 진행 재개 — reviewWait 출신은 검토 대기 재진입, 그 외 advance
    // (commitManualValue와 동일 착지, proceedAfterCommit SSOT).
    await proceedAfterCommit(awaitingFieldRef.current);
  }, [proceedAfterCommit]);

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

  // v0.25.0 기능2(WS-2, 민구 요청) — 입력탭 진입(마운트) 시 마이크 prewarm(첫 클립 유실 완화책 1).
  // 기존 start()의 init() 폴백은 **그대로 두고** 위에 얹는 best-effort 배선이다(제거 아님 → 회귀 0).
  // recorderRef.current를 여기서 채우면 이후 start()/reconnectMic이 같은 인스턴스를 재사용하고,
  // init()은 멱등(this.stream 있으면 즉시 true)이라 재획득하지 않는다(동시호출은 audioRecorder의
  // initPromise가 직렬화 → getUserMedia 1회). iOS standalone에선 마운트 효과가 탭 클릭 콜스택 밖이라
  // 첫 획득이 NotAllowedError일 수 있으나([CLIP-DEVICECHANGE-1] 동일 실패모드), 거부돼도 start()가
  // 재시도(폴백)하고 micLost/"마이크 재연결"은 불변. 효과/안전은 다음 실기기 로그 mic_prewarm_* 분포로 확정.
  const prewarmMic = useCallback(async () => {
    if (!recorderRef.current) recorderRef.current = new AudioRecorder();
    const rec = recorderRef.current;
    const t0 = Date.now();
    logger.log({ type: 'app', extra: 'mic_prewarm_attempt' });
    let ok = false;
    try { ok = await rec.init(); } catch { ok = false; }
    if (ok) {
      logger.log({ type: 'app', extra: 'mic_prewarm_ok', durationMs: Date.now() - t0 });
    } else {
      logger.log({ type: 'app', extra: `mic_prewarm_denied:${rec.getLastInitError() ?? 'unknown'}` });
    }
  }, []);

  return {
    start,
    stop,
    /** v0.35.0 R3-FIX-2 — 종료 저장 실패 배너의 [다시 저장] 핸들러(VoiceScreen). */
    retryFinalPersist,
    restartFromCol,
    jumpToRow,
    gotoAdjacentRow,
    goNextRow,
    pause,
    resume,
    suspendRecognitionForUi,
    resumeRecognitionForUi,
    commitTouchValue,
    commitManualValue,
    confirmAnomalyTouch,
    modifyAnomalyTouch,
    confirmManualAnomaly,
    modifyManualAnomaly,
    lastConfidenceRef,
    getActiveInputLabel,
    getAudioLevel,
    getTimeDomainData,
    micLost,
    micReconnectFallbackVisible,
    reconnectMic,
    prewarmMic,
    uiCommand,
    sessionColumns,
  };
}

// ─── helpers ─────────────────────────────────────────────────
function autoNonCyclingValues(columns: Column[], row: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of columns) {
    if (c.input === 'voice') continue;
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

function parseValueForCol(col: Column, raw: string): string | null {
  if (col.type === 'options' && col.auto.kind === 'options') {
    return matchOption(raw, col.auto.selected.length ? col.auto.selected : col.auto.available);
  }
  if (col.type === 'text' || col.type === 'name') {
    const t = raw.trim();
    return t || null;
  }
  if (col.type === 'date') {
    const m = raw.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) {
      const [, y, mo, d] = m;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return raw.trim() || null;
  }
  // int: strict — reject if the user pronounced a decimal
  if (col.type === 'int') {
    if (/[점쩜.]/.test(raw)) return null;
    return parseKoreanNumber(raw, 0);
  }
  // float
  const decimals = col.decimals ?? 1;
  return parseKoreanNumber(raw, decimals);
}

function matchOption(text: string, allowed: string[]): string | null {
  if (allowed.length === 0) return null;
  const norm = text.trim().toLowerCase().replace(/\s+/g, '');
  for (const v of allowed) {
    if (v.toLowerCase().replace(/\s+/g, '') === norm) return v;
  }
  for (const v of allowed) {
    const vn = v.toLowerCase().replace(/\s+/g, '');
    if (norm.includes(vn) || vn.includes(norm)) return v;
  }
  return null;
}
