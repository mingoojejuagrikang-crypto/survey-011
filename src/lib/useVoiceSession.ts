import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore, minConfidenceForTolerance } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useDataStore } from '../stores/dataStore';
import { recountSynced } from './sessionSync';
import { parseKoreanNumber, detectCommand, extractModifyValue, isAmbiguousSingleSyllable, getLastParseFailReason, getLastParseFailWhole } from './koreanNum';
import { VOICE_COMMANDS } from './voiceCommands';
import { SpeechController, speak, cancelTts, isSpeechSupported, formatForTts, warmupTts, setActiveController, setPreferredVoiceName, refreshVoices } from './speech';
import { computeTotalRows, buildCyclingValues, nestedAutoValue } from './autoValue';
import type { Column, Session, SessionRow } from '../types';
import { saveSession, saveAudioClip, loadAudioClip } from './db';
import { AudioRecorder, type ClipResult } from './audioRecorder';
import { logger } from './logger';
import { getCachedIndex, prefetchPastIndex, ensurePastIndex, resetPastIndexRetries, keyColumns, buildSampleKey, previousRound, pastValue } from './pastValues';
import { checkAnomaly, type TrendViolation } from './trendCheck';
import { getAccessToken, onTokenSettled } from './googleAuth';
import { ensureUniqueSessionLabel } from './sessionLabel';


/** v0.6.0 CLIP-CMD — a captured '수정'/'정정' utterance whose save is deferred until the modify
 *  target cell is known, so a direct "수정 <값>" clip is keyed to the cell it corrects. */
interface PendingCommandClip {
  /** Save the utterance under (targetRow:targetColId):cmd<n> and return that cmdKey (or null if
   *  empty/already saved). Used by the direct-modify path to re-link the corrected cell's pointer. */
  saveFor: (targetRow: number, targetColId: string) => string | null;
  /** Save against the cell that was awaiting when '수정' was said. Correct ONLY when that awaiting
   *  cell IS the correction target — true for "redo current field" (no previous field to go back
   *  to) and for a repeated '수정' while already in modify mode (awaiting was already re-pointed to
   *  the target by the earlier enterModifyMode call). The plain cascade path (bare "수정" with the
   *  target being a DIFFERENT, previous field) must use `saveFor(targetRow, target.id)` instead —
   *  see [CLIP-CORRECTION-1]. */
  saveDefault: () => void;
}

interface AwaitingField {
  row: number;
  colId: string;
  name: string;
  /** When true the next final result is treated as the modify value */
  isModify?: boolean;
  /** #3 error-vs-intent: the value committed for this cell BEFORE this correction started.
   *  Captured at modify-entry (pre-clear) and logged with the final value so analysis can tell
   *  STT prefix-drop (e.g. 133.3→33.3) apart from deliberate user re-entry. */
  previousValue?: string;
  /** v0.7.0 B4: 추세 검증 확인 모드 — 위반 알림 직후 '확인'/'유지'(값 확정·진행) 또는 새 값
   *  (기존 isModify 의미론으로 재커밋 → 재검증)을 기다리는 상태. 이때 isModify=true,
   *  previousValue=방금 커밋된 값으로 함께 무장된다. 커밋된 값 자체는 유효하게 저장돼 있다. */
  trendConfirm?: boolean;
  /** v0.10.0 A1: 소수점 타깃 재질문 모드. STT가 소수부를 유실("111 점 에" → decimal_fraction_lost)했을
   *  때, 파싱된 정수부("111")를 여기 담고 "소수점 아래만 다시 말씀해 주세요"로 재질문한다. 다음 발화가
   *  소수 한 자리면 `${fractionWhole}.${digit}`로 합성해 커밋(전체 재발화 불필요). 값 추측(에→1)은
   *  하지 않는다 — 같은 STT 문자열이 111.1·111.5 양쪽에서 나와 조용한 오커밋이 되기 때문(민구 결정). */
  fractionWhole?: string;
  /** v0.23.0 입력탭#4 — 마지막 행까지 입력 완료 후의 "종료 대기" 센티넬. 명령(종료/수정 등)이 계속
   *  처리되도록 awaiting을 null로 두지 않되, handleFinal의 atEnd 가드가 일반 값 발화를 새 행으로
   *  커밋하지 않고 종료 안내로 흡수한다(자동 종료 제거). */
  atEnd?: boolean;
}

/** v0.9.0 빠른 인식(조기확정): interim 숫자가 이 시간(ms) 동안 같은 값으로 안정되면 final을
 *  기다리지 않고 커밋한다. 짧을수록 빠르지만 미완성 숫자(소수점 추가 전) 절단 위험이 커진다. */
const EARLY_COMMIT_STABLE_MS = 400;

export function useVoiceSession() {
  const ctrlRef = useRef<SpeechController | null>(null);
  const sessionIdRef = useRef<string>('');
  const sessionLabelRef = useRef<string | undefined>(undefined);
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
  // v0.4.5 I3: "이전" 재입력 모드. non-null이면 그 행을 1번 필드부터 순서대로 재입력 중 —
  // advance가 채워진 필드를 건너뛰지 않고 모든 필드를 차례로 재프롬프트하고, 행 끝에서 해제된다.
  const reentryRowRef = useRef<number | null>(null);
  // rowIndex → colId → IDB key; accumulated in-memory until persistSession writes to dataStore
  const pendingClipsRef = useRef<Record<number, Record<string, string>>>({});
  // Clip-preservation: monotonic per-cell attempt counter (`row:colId` → next attempt index) used
  // to mint distinct archive keys (`sessionId:row:colId:a<n>`) so every correction's prior clip
  // survives in IDB instead of being deleted. Reset in start() alongside pendingClipsRef.
  const clipAttemptRef = useRef<Record<string, number>>({});
  // Monotonic command-clip counter (`row:colId` → next index) for the '수정'/'정정' utterance
  // clips, keyed `sessionId:row:colId:cmd<n>` with kind:'command' in the event log.
  const cmdClipRef = useRef<Record<string, number>>({});
  // Codex 재검증 MEDIUM: in-flight clip save promises; stop()/pause()가 끝나기 전 flush
  const pendingClipSavesRef = useRef<Set<Promise<unknown>>>(new Set());
  // Snapshot of a persisted row being cascade-corrected; included in persistSession if stop()
  // fires before re-completion so original measurements are not lost.
  const correctionBackupRef = useRef<SessionRow | null>(null);
  // [CLIP-VAL-1]③ / [CLIP-3] unlink race: tombstones for clip keys whose capture FAILED
  // (clip_empty / clip_too_small / clip_save_failed). persistSession builds its rows
  // synchronously BEFORE its first await, so an in-flight persist could re-persist a pointer
  // that unlinkBrokenPointer just removed (06-11 v0.6.0 row8 c7 — pointer resurrected in the
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
  // v0.22.0 P0 — 클립 레코더 스트림이 죽어 자동복구 불가(= 사용자 제스처로 재연결 필요)일 때 true.
  // 근인: iOS Safari가 제스처 밖 getUserMedia를 거부하므로, 스트림이 죽으면 자동 recoverStream을
  // 멈추고 이 플래그로 입력탭 "마이크 재연결" 버튼(Vance)을 노출한다. reconnectMic()이 제스처
  // 컨텍스트에서 recoverStream('user_gesture')를 시도해 성공하면 false로 클리어. 무한 실패 폭주 차단.
  const [micLost, setMicLost] = useState(false);
  // clip_empty 자동 재시도 once 가드(세션당). 스트림이 죽어 micLost로 전환되면 더 이상 자동
  // recoverStream을 부르지 않는다(제스처 밖이라 어차피 실패). start()에서 리셋.
  const micLostLatchedRef = useRef(false);

  // ── helpers ────────────────────────────────────────────────
  const getTtsRate = () => useSettingsStore.getState().ttsRate || 1.05;
  const say = useCallback(async (text: string, interrupt = true) => {
    if (!text) return;
    const ttsStart = Date.now();
    let startDelayMs: number | null = null;
    await speak(text, {
      interrupt,
      rate: getTtsRate(),
      onStart: (d) => { startDelayMs = d; },
    });
    logger.log({
      type: 'tts',
      ttsText: text,
      durationMs: Date.now() - ttsStart,
      startDelayMs,
      sessionId: sessionIdRef.current,
      row: useSessionStore.getState().activeRow,
    });
  }, []);

  const getColById = (id: string): Column | null =>
    useSettingsStore.getState().columns.find((c) => c.id === id) || null;

  const voiceColsList = (): Column[] =>
    useSettingsStore.getState().columns.filter((c) => c.input === 'voice');

  // ── clip preservation ──────────────────────────────────────
  /** Archive the clip currently stored at the bare cell key (`sessionId:row:colId`) under a fresh
   *  attempt key (`sessionId:row:colId:a<n>`) BEFORE a correction overwrites/clears it, so the
   *  misrecognised original audio survives in IDB. Background (not awaited) — never blocks the
   *  voice flow. Emits a `clip_preserved` event carrying the attempt index + archive key so the
   *  next analyst can re-join attempts in order. Returns the archive key (or null if nothing to
   *  archive). The bare key is left intact for the next attempt's save to overwrite. */
  const archiveCellClip = useCallback((row: number, colId: string): string | null => {
    const bareKey = `${sessionIdRef.current}:${row}:${colId}`;
    const cellKey = `${row}:${colId}`;
    const attempt = (clipAttemptRef.current[cellKey] ?? 0) + 1;
    clipAttemptRef.current[cellKey] = attempt;
    const archiveKey = `${bareKey}:a${attempt}`;
    void (async () => {
      try {
        // The prior attempt's clip save may still be in-flight (savePromise resolves after the
        // echo TTS, but a fast correction can race it). Flush pending saves before reading the
        // bare key so we archive the real blob rather than null. Background — no UX impact.
        if (pendingClipSavesRef.current.size > 0) {
          await Promise.race([
            Promise.allSettled(Array.from(pendingClipSavesRef.current)),
            new Promise<void>((resolve) => setTimeout(resolve, 1500)),
          ]);
        }
        const blob = await loadAudioClip(bareKey);
        if (!blob) return; // nothing recorded yet (e.g. direct-modify before any clip) — skip
        await saveAudioClip(archiveKey, blob);
        logger.log({
          type: 'clip', extra: 'clip_preserved', kind: 'value', attempt, clipKey: archiveKey,
          sessionId: sessionIdRef.current, row, colId,
        });
      } catch (e) {
        logger.log({ type: 'error', extra: `clip_preserve_failed:${String((e as Error)?.message ?? e)}`, sessionId: sessionIdRef.current, row, colId });
      }
    })();
    return archiveKey;
  }, []);

  /** Preserve the '수정'/'정정' command utterance itself as an audio clip. The command is spoken
   *  into the clip the last announceField started for `awaiting`, but that clip was previously
   *  dropped (enterModifyMode starts a new clip without stopping/saving the old one). We stop it
   *  here and persist it under `sessionId:row:colId:cmd<n>` (kind:'command') so analysis can hear
   *  the exact utterance that declared the correction alongside the surrounding value attempts.
   *  Fully background — the save promise is tracked but NEVER awaited before announcing, so the
   *  voice flow is not delayed (top-priority constraint). */
  const preserveCommandClip = useCallback((row: number, colId: string): PendingCommandClip | null => {
    const rec = recorderRef.current;
    if (!rec) return null;
    // Detach the active clip's stop now, before enterModifyMode's announceField starts a new one.
    // We CAPTURE the stop here (the '수정' utterance is spoken into the AWAITING cell's clip) but
    // DEFER the save until the modify TARGET cell is resolved — for a direct "수정 <값>" the clip
    // is the new value's audio and must be keyed to the cell it corrects, not the awaiting cell
    // (CLIP-CMD: keying it to the awaiting colId left the corrected cell's pointer orphaned).
    const stopPromise = rec.stopClip();
    activeClipRef.current = null;

    let saved = false;
    /** Persist the captured utterance under the given cell's :cmd<n> key. Returns the cmdKey on
     *  success (clip non-empty), or null if empty/failed. Idempotent — saves at most once. */
    const saveFor = (targetRow: number, targetColId: string): string | null => {
      if (saved) return null;
      saved = true;
      const cellKey = `${targetRow}:${targetColId}`;
      const idx = (cmdClipRef.current[cellKey] ?? 0) + 1;
      cmdClipRef.current[cellKey] = idx;
      const cmdKey = `${sessionIdRef.current}:${targetRow}:${targetColId}:cmd${idx}`;
      const savePromise = (async () => {
        try {
          const { blob, raw } = await stopPromise;
          if (!blob || blob.size <= 200) {
            logger.log({ type: 'clip', extra: `clip_cmd_empty:${blob ? blob.size : 'null'}`, kind: 'command', sessionId: sessionIdRef.current, row: targetRow, colId: targetColId });
            return;
          }
          await saveAudioClip(cmdKey, blob);
          logger.log({ type: 'clip', extra: 'clip_preserved', kind: 'command', attempt: idx, clipKey: cmdKey, sessionId: sessionIdRef.current, row: targetRow, colId: targetColId });
          // v0.5.0 W6 원본 보존(민구 결정): 트림 전 전체본(프리롤 포함)을 `…:raw`로 함께 보관.
          // deleteSession의 prefix cascade와 exportLog의 `key.split(':')[0]` 세션 필터가 모두
          // `sessionId:` prefix 기준이라 추가 배선 없이 zip clips/ 포함·삭제가 따라온다.
          if (raw) {
            await saveAudioClip(`${cmdKey}:raw`, raw);
            logger.log({ type: 'clip', extra: `clip_raw_saved:${raw.size}`, kind: 'command', clipKey: `${cmdKey}:raw`, sessionId: sessionIdRef.current, row: targetRow, colId: targetColId });
          }
        } catch (e) {
          logger.log({ type: 'error', extra: `clip_cmd_save_failed:${String((e as Error)?.message ?? e)}`, sessionId: sessionIdRef.current, row: targetRow, colId: targetColId });
        }
      })();
      pendingClipSavesRef.current.add(savePromise);
      void savePromise.finally(() => pendingClipSavesRef.current.delete(savePromise));
      // Return the cmdKey synchronously so the caller can re-link the cell pointer; the actual
      // bytes land asynchronously (background save, never awaited — voice flow not delayed).
      return cmdKey;
    };

    return {
      // Key the saved clip + return the cmdKey for the cell being corrected.
      saveFor,
      // Save against the (row, colId) this closure captured — the awaiting cell at preserve-time.
      // Callers only use this when awaiting === target (see PendingCommandClip.saveDefault doc);
      // the plain-cascade path uses `saveFor(targetRow, target.id)` directly instead.
      saveDefault: () => { saveFor(row, colId); },
    };
  }, []);

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
  const persistSession = useCallback(async () => {
    // v0.24.0 데이터-3 — 이 호출의 단조 순번(호출 순서=스냅샷 신선도 순서, setRowValue가 호출 전 실행됨).
    const mySeq = ++persistSeqRef.current;
    const settings = useSettingsStore.getState();
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
    if (completed.length === 0 && !backup && !activeHasData && skipped.length === 0) return;
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
      const values = composeRowValues(settings.columns, r);
      // F1: preserve the row's sheetRow/syncState across re-persists. If a previously-synced row's
      // value changed in this persist, demote synced→dirty so the next sync UPDATEs it in place
      // (no duplicate append). Unchanged synced rows keep 'synced'.
      let sheetRow = existingRow?.sheetRow;
      let syncState = existingRow?.syncState;
      if (existingRow && syncState === 'synced') {
        const colIds = settings.columns.map((c) => c.id);
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
    const session: Session = {
      id: resolvedId,
      // v0.7.0: LOCAL date, not UTC — toISOString() stamped KST 00:00~08:59 sessions with
      // yesterday's date, so the 조회 탭(ReviewScreen)의 localTodayISO() 오늘-세션 매칭에서
      // 그날 아침 세션이 사라졌다. 코드베이스 지배 규약도 로컬(autoValue.ts 날짜 컬럼).
      date: localTodayISO(),
      label: sessionLabelRef.current || sess.sessionLabel,
      columns: settings.columns,
      rows,
      completedRows: rows.filter((r) => r.complete).length,
      // F1: derive syncedRows from per-row syncState (recountSynced) instead of hardcoding 0,
      // which used to erase the uploaded-row count after every voice persist.
      syncedRows: recountSynced(rows),
      startedAt: resolvedStartedAt,
      finishedAt: Date.now(),
    };
    try { await saveSession(session); } catch { /* ignore */ }
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
    if (mySeq < persistAppliedSeqRef.current) return;
    persistAppliedSeqRef.current = mySeq;
    useDataStore.getState().upsertSession(finalSession);
    if (finalSession !== session) {
      await saveSession(finalSession).catch(() => {});
    }
  }, []);

  // ── announcements ──────────────────────────────────────────
  /** Announce only auto+ttsAnnounce columns whose value differs between rows. */
  const announceRowDiff = useCallback(
    async (fromRow: number | null, toRow: number) => {
      const cols = useSettingsStore.getState().columns;
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
      const cols = useSettingsStore.getState().columns;
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
      awaitingFieldRef.current = {
        row,
        colId: col.id,
        name: col.name,
        isModify: opts?.isModify,
        previousValue: opts?.previousValue,
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
    const total = computeTotalRows(useSettingsStore.getState().columns);
    const empties = listEmptyRows(total, vc);
    const lastCol = vc[vc.length - 1] ?? null;
    // 명령 컨텍스트 유지용 atEnd 센티넬(마지막 음성 필드). 값 커밋은 handleFinal의 atEnd 가드가 차단.
    awaitingFieldRef.current = lastCol
      ? { row: total, colId: lastCol.id, name: lastCol.name, atEnd: true }
      : null;
    sess.setReaskReason(null);
    sess.setRecognized('');
    // phase='complete'로 둬 hero가 "✓ 행 입력 완료"를 보이게 한다(마지막 컬럼을 '듣는 중'처럼 보이는
    // 오해 방지). STT는 계속 돌아 '종료'/'수정' 음성 명령이 처리되되(handleFinal는 paused만 게이트),
    // early-commit(active 전용)은 멈춘다. 종료는 '종료' 음성·종료 버튼만.
    sess.setPhase('complete');
    const tail = "종료하려면 '종료'라고 말씀하거나 종료 버튼을 누르세요.";
    const msg = empties.length > 0
      ? `마지막 행까지 입력했습니다. ${formatRowList(empties)}이 비어 있습니다. ${tail}`
      : `마지막 행까지 입력했습니다. ${tail}`;
    sess.setLastTts(msg);
    logger.log({
      type: 'session',
      extra: empties.length > 0 ? `end_reached_waiting:empty=${empties.join(',')}` : 'end_reached_waiting',
      sessionId: sessionIdRef.current,
    });
    await say(msg);
  }, [say]);

  // ── progression ────────────────────────────────────────────
  /** Move to next voice col in current row, or finalize row + jump to next target. */
  const advance = useCallback(async () => {
    const startEpoch = epochRef.current;
    const settings = useSettingsStore.getState();
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const row = sess.activeRow;
    const total = computeTotalRows(settings.columns);

    // v0.4.5 I3: 재입력 모드면 채워진 필드도 건너뛰지 않고 모든 필드를 순서대로 재프롬프트한다.
    const isReentry = reentryRowRef.current === row;

    // Still voice cols in this row?
    const nextIdx = sess.activeColIdx + 1;
    if (nextIdx < vc.length) {
      const values = sess.getRowValues(row);
      let target = nextIdx;
      if (!isReentry) {
        // Skip cols already filled with non-empty values (empty string = cleared by modify)
        while (target < vc.length) {
          const v = values[vc[target].id];
          if (v === undefined || v === '') break;
          target++;
        }
      }
      if (target < vc.length) {
        sess.setActiveCol(target);
        sess.setRecognized('');
        if (isReentry) {
          const existing = values[vc[target].id] ?? '';
          await announceField(vc[target], { isModify: true, previousValue: existing || undefined });
        } else {
          await announceField(vc[target]);
        }
        return;
      }
    }

    // Row end. 재입력 모드였다면 해제하고, 아래 normal tail(returnRow는 재입력 중 null이라 건너뜀)이
    // 다음 행으로 전진시킨다.
    if (isReentry) reentryRowRef.current = null;

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

  // ── modify (cross-row) ─────────────────────────────────────
  const enterModifyMode = useCallback(async (preExtractedValue?: string, pendingCmd?: PendingCommandClip | null) => {
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const curRow = sess.activeRow;
    const curIdx = sess.activeColIdx;

    // Find previous voice col (could be in previous row)
    let targetRow = curRow;
    let targetIdx = curIdx - 1;
    if (targetIdx < 0) {
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
        } else if (targetRow < curRow) {
          // If we modified an earlier row, make sure it's still complete
          void persistSession();
        }
        // #3 error-vs-intent: log the direct-modify commit with previousValue → parsed.
        // extra:'direct_modify' marks the inline-value path (no re-record), distinct from the
        // cascade path's value event which carries previousValue via awaiting.previousValue.
        logger.log({
          type: 'value',
          sessionId: sessionIdRef.current,
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
        const bSettings = useSettingsStore.getState();
        const bAuto = buildCyclingValues(bSettings.columns, targetRow);
        const bFixed = autoNonCyclingValues(bSettings.columns, targetRow);
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
    await announceField(target, { isModify: true, previousValue: prevTargetValue });
  }, [announceField, persistSession, say]);

  // ── public: restart from a voice col (chip tap) ────────────
  const restartFromCol = useCallback(async (colId: string) => {
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const idx = vc.findIndex((c) => c.id === colId);
    if (idx < 0) return;
    const row = sess.activeRow;
    logger.log({ type: 'command', parsed: 'restart', extra: 'touch', sessionId: sessionIdRef.current, row, colId });
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

  // ── public: jump to a specific row (auto-chip change) ──────
  const jumpToRow = useCallback(
    async (targetRow: number, options?: { setReturn?: boolean }) => {
      const settings = useSettingsStore.getState();
      const sess = useSessionStore.getState();
      const vc = voiceColsList();
      const total = computeTotalRows(settings.columns);
      if (targetRow < 1 || targetRow > total) return;
      const cur = sess.activeRow;
      if (targetRow === cur) return;
      logger.log({ type: 'command', parsed: 'jump', extra: `touch:${cur}->${targetRow}`, sessionId: sessionIdRef.current, row: targetRow });
      if (options?.setReturn ?? true) sess.setReturn(cur, sess.activeColIdx);
      sess.setActiveRow(targetRow);
      const targetCol = firstIncompleteColIdx(targetRow, vc);
      sess.setActiveCol(targetCol);
      sess.setRecognized('');
      cancelTts();
      // v5.2: bump epoch so in-flight handleFinal's advance() guard aborts
      epochRef.current++;
      awaitingFieldRef.current = null;
      await announceRowDiff(cur, targetRow);
      if (vc[targetCol]) await announceField(vc[targetCol]);
    },
    [announceField, announceRowDiff],
  );

  // ── public: move to the previous row (◀이전 버튼 전용 — v0.5.0 NAV-1에서 delta=-1 전용으로 축소) ──
  // Review/edit semantics: jumpToRow(setReturn:true) so finishing the visited row returns the
  // flow to where the user was. (복귀 대상이 그 사이 완료되면 advance의 NAV-1 가드가 복귀를 차단.)
  // On a boundary we REPROMPT instead of silently stalling (REVIEW-4).
  const gotoAdjacentRow = useCallback(
    async (delta: -1) => {
      const sess = useSessionStore.getState();
      const target = sess.activeRow + delta;
      cancelTts();
      if (target < 1) {
        epochRef.current++;
        const msg = '첫 행입니다.';
        useSessionStore.getState().setLastTts(msg);
        const vc = voiceColsList();
        const cur = vc[sess.activeColIdx];
        await say(msg);
        if (cur) await announceField(cur);
        return;
      }
      await jumpToRow(target, { setReturn: true });
    },
    [announceField, jumpToRow, say],
  );

  // ── v0.5.0 NAV-1: '다음' 단방향 전진 (음성 '다음' + ▶다음 버튼 공용) ──────────
  // 재입력 모드를 무조건 해제하고, 현재 행이 미완료면 skip 표시 + 즉시 영속화(placeholder)한 뒤
  // 아래 방향의 다음 미완료 행으로만 이동한다. returnRow를 만들지 않으므로(기존 stale 복귀도
  // 해제) 완료 행으로 반복 복귀하는 NAV-1 루프가 구조적으로 불가능해진다. 더 갈 행이 없으면
  // v0.23.0 입력탭#4 — 자동 종료하지 않고 빈 행 안내 후 종료 대기(announceEndReached).
  const goNextRow = useCallback(async () => {
    const sess = useSessionStore.getState();
    const settings = useSettingsStore.getState();
    const vc = voiceColsList();
    const total = computeTotalRows(settings.columns);
    cancelTts();
    epochRef.current++; // in-flight advance/안내 체인 무효화 (RACE-1 패턴 유지)
    reentryRowRef.current = null;
    sess.setReturn(null, null);
    const row = sess.activeRow;
    if (!isRowVoiceComplete(row, vc)) {
      sess.markRowSkipped(row);
      logger.log({
        type: 'command', parsed: 'nextRow', extra: `row_skipped:${row}`,
        sessionId: sessionIdRef.current, row,
      });
      void persistSession(); // skip 즉시 영속화 — 데이터탭에 빈 행 placeholder가 바로 보이도록
    }
    const next = findNextIncompleteRow(row + 1, total, vc);
    if (next === null) {
      // v0.23.0 입력탭#4 — '다음'으로 마지막 행에 도달해도 자동 종료하지 않고 종료 안내 후 대기.
      await announceEndReached();
      return;
    }
    await jumpToRow(next, { setReturn: false });
  }, [announceEndReached, jumpToRow, persistSession]);

  // ── v0.4.5 I3: "이전" 재입력 모드 진입 ─────────────────────
  // 이전 행으로 가서 1번 필드부터 모든 음성 필드를 순서대로 재입력. 기존 값은 유지하되 발화 시 교체,
  // "유지"로 현재 값 보존하고 다음 필드, "다음"으로 다음 행 이동. setReturn을 쓰지 않아(복귀 안 함)
  // advance가 행 끝에서 다음 행으로 전진한다.
  const enterReentry = useCallback(async () => {
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const cur = sess.activeRow;
    const target = cur - 1;
    cancelTts();
    epochRef.current++;
    if (target < 1) {
      const msg = '첫 행입니다.';
      sess.setLastTts(msg);
      await say(msg);
      const c = vc[sess.activeColIdx];
      if (c) await announceField(c);
      return;
    }
    reentryRowRef.current = target;
    sess.setReturn(null, null);
    sess.setActiveRow(target);
    sess.setActiveCol(0);
    sess.setRecognized('');
    sess.setPhase('active');
    awaitingFieldRef.current = null;
    await announceRowDiff(cur, target);
    const first = vc[0];
    if (first) {
      const existing = sess.getRowValues(target)[first.id] ?? '';
      await announceField(first, { isModify: true, previousValue: existing || undefined });
    }
  }, [announceField, announceRowDiff, say]);

  // ── v0.7.0 B4: 추세 검증 ───────────────────────────────────
  /** trend_skip 텔레메트리 — 같은 원인은 세션당 1회만 기록(셀마다 반복돼 로그를 도배하지 않게).
   *  Set은 start()에서 리셋된다. */
  const logTrendSkip = useCallback((cause: string, row: number, colId: string) => {
    if (trendSkipLoggedRef.current.has(cause)) return;
    trendSkipLoggedRef.current.add(cause);
    logger.log({ type: 'trend', extra: `trend_skip:${cause}`, sessionId: sessionIdRef.current, row, colId });
  }, []);

  /** 방금 커밋된 값의 이상치 알람 검사(v0.8.0). 전역 마스터 토글 제거 — 컬럼에 방향 규칙
   *  (trendRule) 또는 변동률 % 임계값(pctThreshold)이 하나라도 있으면 활성. 규칙 없는 컬럼은
   *  검사 자체가 없고(로그 없음), 판정 불가(인덱스 없음·키 불완전·직전 회차/과거값 없음)는
   *  조용히 skip + trend_skip 1회(telemetry 키 'trend'/trend_skip 유지 — 로그 연속성).
   *  여기서는 절대 fetch하지 않는다 — start()의 프리페치가 채운 캐시(getCachedIndex)만 본다
   *  (행 단위 재fetch 금지, B2 설계). */
  const evaluateTrend = useCallback(
    (col: Column | null, row: number, colId: string, nextRaw: string): TrendViolation | null => {
      const s = useSettingsStore.getState();
      const rule = col?.trendRule;
      const hasRule = rule === 'increase' || rule === 'decrease' || col?.pctThreshold != null;
      if (!col || !hasRule) return null;
      const index = getCachedIndex();
      // v0.14.0 A — 캐시 미스 시 백오프 재시도를 nudge(자가 제한). prefetch가 transient "Load
      // failed"로 실패해도 이후 행 입력마다 재시도되어 세션 중반부터 이상치 알람이 살아난다.
      if (!index) { ensurePastIndex(); logTrendSkip('no_index', row, colId); return null; } // 오프라인/프리페치 실패/TTL 만료
      const kc = keyColumns(s.columns);
      if (kc.length === 0) { logTrendSkip('no_key_cols', row, colId); return null; } // 기능 비활성 케이스
      // 현재 행의 전체 값(자동·고정·음성) — persistSession과 같은 composeRowValues 합성.
      const rowValues = composeRowValues(s.columns, row);
      const key = buildSampleKey(kc, rowValues);
      if (!key) { logTrendSkip('incomplete_key', row, colId); return null; }
      // 로컬 날짜(UTC 아님 — KST 자정 직후 어긋남 방지). previousRound는 오늘 미만 strictly.
      // start()에서 세션당 1회 계산(핫패스 호이스팅) — ref가 빈 경우(이론상 hook 재마운트)만 지연 계산.
      const today = sessionTodayRef.current || localTodayISO();
      const round = previousRound(index, key, today);
      if (!round) { logTrendSkip('no_prev_round', row, colId); return null; }
      const prevRaw = pastValue(index, key, round, colId);
      if (prevRaw === null) { logTrendSkip('no_past_value', row, colId); return null; }
      return checkAnomaly(col, prevRaw, nextRaw);
    },
    [logTrendSkip],
  );

  /** v0.12.0 AREA2 V2 — 이상치 팝업에 곁들일 식별정보(샘플키 + 직전 회차 ISO 날짜)를 재계산한다.
   *  evaluateTrend와 같은 캐시(getCachedIndex)·키 합성을 쓰되 TrendViolation 타입은 순수하게 유지
   *  한다(trendCheck.ts 오염 금지 — 표시용 부가정보는 여기서 별도 산출). 캐시 없음·키 불완전이면
   *  해당 필드를 undefined로 둔다(팝업이 '행 N' 폴백 + 날짜 라벨 생략으로 안전 처리). */
  const getAnomalyAlertData = useCallback(
    (row: number): { sampleKey?: string; prevDate?: string } => {
      const s = useSettingsStore.getState();
      const kc = keyColumns(s.columns);
      if (kc.length === 0) return {};
      const rowValues = composeRowValues(s.columns, row);
      const sampleKey = buildSampleKey(kc, rowValues) ?? undefined;
      if (!sampleKey) return {};
      const index = getCachedIndex();
      if (!index) return { sampleKey };
      const today = sessionTodayRef.current || localTodayISO();
      return { sampleKey, prevDate: previousRound(index, sampleKey, today) ?? undefined };
    },
    [],
  );

  // ── v0.22.0 P0: 클립 레코더 스트림 소실 → micLost 게이트 ──────────────
  /** 빈/극소 클립이 났을 때의 처리. **자동 재-getUserMedia는 절대 하지 않는다**(수칙 3) —
   *  recoverStream은 destructive-first(살아있던 스트림을 먼저 stop·null 처리)이고 이 콜백은
   *  클립 저장 콜백(사용자 제스처 밖)에서 불리므로, iOS Safari가 getUserMedia를 NotAllowedError로
   *  거부해 멀쩡하던 스트림까지 죽인다 — 그게 바로 이번 P0 근인이다(clip_empty×41 폭주).
   *   - 스트림이 실제로 죽었으면(isStreamLost) micLost로 래치(once) → 사용자 제스처(reconnectMic)
   *     로만 복구. 무한 실패 폭주 차단.
   *   - 스트림이 멀쩡하면(트랙 살아있음) **no-op**. 복구가 필요 없다 — 다음 startClip()이 살아있는
   *     스트림 위에 새 MediaRecorder를 만들어 자가 치유한다(transient 빈 클립의 자연 회복). */
  const maybeAutoRecoverOrLatch = useCallback((reason: string) => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.isStreamLost() && !micLostLatchedRef.current) {
      micLostLatchedRef.current = true;
      setMicLost(true);
      logger.log({
        type: 'clip', extra: `mic_lost:${reason}`,
        sessionId: sessionIdRef.current,
      });
    }
    // 스트림이 살아있으면 자동 복구 금지(no-op) — 다음 클립이 자가 치유. recoverStream은 오직
    // reconnectMic(제스처)에서만.
  }, []);

  /** v0.22.0 P0 — 사용자 버튼 탭(제스처)에서 호출. iOS가 getUserMedia를 거부하지 않는 유일한
   *  컨텍스트라 여기서만 스트림을 재획득한다. 성공 시 micLost를 false로 클리어하고 래치를 푼다. */
  const reconnectMic = useCallback(() => {
    const rec = recorderRef.current;
    logger.log({ type: 'clip', extra: 'mic_reconnect_attempt', sessionId: sessionIdRef.current });
    if (!rec) {
      logger.log({ type: 'clip', extra: 'mic_reconnect_no_recorder', sessionId: sessionIdRef.current });
      return;
    }
    void rec.recoverStream('user_gesture').then((ok) => {
      if (ok) {
        micLostLatchedRef.current = false;
        setMicLost(false);
        logger.log({ type: 'clip', extra: 'mic_reconnect_ok', sessionId: sessionIdRef.current });
      } else {
        logger.log({ type: 'clip', extra: 'mic_reconnect_failed', sessionId: sessionIdRef.current });
      }
    });
  }, []);

  // ── final result handler ───────────────────────────────────
  const handleFinal = useCallback(async (textArg: string, alts: string[], confidence: number) => {
    // v0.20.0 Phase 5 #4 — 반응속도(발화 확정→값 커밋) 측정 시작점. STT final이 handleFinal에
    // 진입한 순간을 찍어, 값 커밋 시점(아래 value 이벤트)까지의 경과ms를 commitLatencyMs로 동봉한다.
    // EOS 꼬리([STT-11], 브라우저 무음종료)와 달리 이건 **앱 파이프라인** 지연(파싱·추세검사·persist).
    const handleFinalAt = Date.now();
    // `text` is mutable so the redo-with-inline-value path (e.g. "다시 8.4") can rewrite the
    // effective utterance to just the value and fall through to the normal value-commit path.
    let text = textArg;
    const awaiting = awaitingFieldRef.current;
    if (!awaiting) return;
    const cmd = detectCommand(text);

    // While paused, accept only 'resume' and 'end' (v0.15.0 A5); ignore everything else.
    // resume = 멈춘 입력 재개. end = 멈춘 채로 입력 종료·저장(일시정지 카드가 '재시작'/'종료' 둘 다
    // 안내하므로 음성 '종료'도 paused에서 작동해야 한다 — 민구 요청).
    if (useSessionStore.getState().phase === 'paused') {
      if (cmd === 'resume') {
        epochRef.current++;
        cancelTts();
        await resumeRef.current('voice'); // v0.20.0 Phase 5 #3 — 음성 '재시작'으로 해제
      } else if (cmd === 'end') {
        epochRef.current++;
        cancelTts();
        await stop(true);
      }
      return;
    }

    // v0.15.0 A6 — 스피커폰 모드 삭제. 모드로 게이트되던 TTS-중 명령차단(post-TTS 가드)을 함께
    // 제거했다(민구: 모드 ON시 barge-in 안 됨을 불편으로 지목 + Trace: 가드 1회만 발화, 제거 안전).
    // self-confirm 환각 위험은 v0.13.0 alertText "확인해주세요" 제거로 이미 구조적 해소됨. 이어폰
    // 기본 경로의 barge-in(명령 즉시 실행)은 원래대로 유지된다.

    // T-2 (low-confidence command bypassing the gate): voice COMMANDS used to dispatch with no
    // confidence check at all (the value gate at minConfidence ran only AFTER the command branch).
    // A misrecognised "수정" at conf 0.16 on an empty cell replayed the whole prompt (~10s lost).
    // Apply a command-specific threshold that is STRICTER than the value threshold: a command
    // rewinds/destroys state, so it must clear a higher bar than a plain measurement value.
    // confidence === 0 is the "unknown confidence" sentinel (some STT results carry no score) —
    // we pass those through, exactly like the value gate's `confidence > 0` guard, to avoid
    // dead-locking commands on engines that never report confidence.
    // resume-from-paused is handled above this point and is intentionally NOT gated (it is the
    // user's only way out of pause).
    // Per-command floor from the registry (SSOT); defaults to 0.7. T-12: '수정'(modify) overrides
    // to 0.55 because it is recoverable and a false-reject is cheap — see voiceCommands.ts.
    const commandMinConfidence = VOICE_COMMANDS.find((c) => c.id === cmd)?.minConfidence ?? 0.7;
    if (cmd && confidence > 0 && confidence < commandMinConfidence) {
      logger.log({
        type: 'command',
        text,
        parsed: cmd,
        confidence,
        sessionId: sessionIdRef.current,
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
      logger.log({
        type: 'command',
        text,
        parsed: cmd,
        confidence,
        sessionId: sessionIdRef.current,
        row: awaiting.row,
        colId: awaiting.colId,
        extra: ctrlRef.current?.isTtsMuted() ? 'tts_was_speaking' : 'tts_silent',
      });
    }

    // ── v0.7.0 B4: 추세 확인 모드 해소 — 알림 TTS 직후의 첫 응답 ──
    // 커밋된 값은 이미 저장돼 있다(알림 ≠ 롤백). '확인'/'유지'는 그대로 확정·진행, 새 값 발화는
    // 아래 값 경로로 폴스루해 기존 isModify 의미론으로 재커밋(재위반 시 재알림), 타 명령은 알림만
    // 해제하고 정상 dispatch된다.
    if (awaiting.trendConfirm) {
      if (cmd === 'confirm' || cmd === 'keep') {
        cancelTts();
        useSessionStore.getState().setAnomalyAlert(null); // 팝업 해제
        logger.log({
          type: 'trend', extra: 'trend_alert_confirmed', parsed: cmd,
          sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId,
          ...(awaiting.previousValue != null ? { previousValue: awaiting.previousValue } : {}),
        });
        awaitingFieldRef.current = null;
        await advance();
        return;
      }
      if (cmd) {
        useSessionStore.getState().setAnomalyAlert(null); // 타 명령으로 해제 → 팝업 닫음
        logger.log({
          type: 'trend', extra: `trend_alert_dismissed:${cmd}`,
          sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId,
        });
        awaiting.trendConfirm = false; // 알림만 해제 — 아래 정상 명령 dispatch로 폴스루
      }
      // 명령이 아니면(새 값) 값 경로로 폴스루 — 커밋 지점에서 trend_alert_corrected 기록.
    }

    if (cmd === 'end') {
      cancelTts();
      // v0.5.0 요청3: 종료 시에도 skip된 빈 행이 있으면 1회 안내 후 종료(민구 결정 4와 대칭).
      // 아직 도달하지 않은 뒷 행은 '빈 행'으로 세지 않는다 — skip한 행만 대상.
      {
        const vcEnd = voiceColsList();
        const skippedEmpty = useSessionStore.getState().skippedRows
          .filter((r) => !isRowVoiceComplete(r, vcEnd));
        if (skippedEmpty.length > 0) {
          const msg = `${formatRowList(skippedEmpty)}이 비어 있습니다. 데이터 탭에서 확인해 주세요.`;
          useSessionStore.getState().setLastTts(msg);
          await say(msg);
        }
      }
      await stop(true);
      return;
    }
    if (cmd === 'pause') {
      cancelTts();
      await pause('voice'); // v0.20.0 Phase 5 #3 — 음성 명령으로 일시정지
      return;
    }
    if (cmd === 'resume') {
      cancelTts();
      await resumeRef.current('voice'); // v0.20.0 Phase 5 #3 — 음성 명령으로 재개
      return;
    }
    if (cmd === 'prevRow') {
      // v0.4.5 I3: "이전" → 이전 행 재입력 모드 진입.
      await enterReentry();
      return;
    }
    if (cmd === 'nextRow') {
      // v0.5.0 NAV-1: '다음'은 재입력 여부와 무관하게 항상 단방향 전진(goNextRow) —
      // 미완료 행은 skip(placeholder) 처리, returnRow 미등록, 완료 행 재프롬프트 없음.
      await goNextRow();
      return;
    }
    if (cmd === 'keep') {
      // v0.5.0 NAV-2: '유지' 일반화 — 현재 칸에 값이 있으면(재입력 모드 포함) 그대로 두고
      // 다음으로 진행. 값이 없으면 무엇을 유지할지 없음을 명시적으로 안내(무음 금지, [REVIEW-4]).
      // (값 커밋 경로를 안 타므로 announceField가 시작한 클립은 저장되지 않아 기존 클립이 보존된다.)
      cancelTts();
      const curVal = useSessionStore.getState().getRowValues(awaiting.row)[awaiting.colId] ?? '';
      if (reentryRowRef.current != null || curVal !== '') {
        await advance();
      } else {
        logger.log({
          type: 'command', parsed: 'keep', extra: 'keep_no_value',
          sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId,
        });
        const msg = `유지할 값이 없습니다. ${awaiting.name} 말씀해 주세요.`;
        useSessionStore.getState().setLastTts(msg);
        await say(msg);
      }
      return;
    }
    if (cmd === 'confirm') {
      // v0.7.0 B4: 추세 알림 상태 밖의 '확인' — 상태 변경 없이 짧은 재안내만(무음 금지, REVIEW-4).
      // trendConfirm 중의 '확인'은 위 해소 분기에서 이미 처리됐다.
      cancelTts();
      const msg = `확인할 알림이 없습니다. ${awaiting.name} 말씀해 주세요.`;
      useSessionStore.getState().setLastTts(msg);
      await say(msg);
      return;
    }
    if (cmd === 'modify') {
      cancelTts();
      // Capture the '수정'/'정정' utterance itself (spoken into the awaiting cell's active clip)
      // before enterModifyMode starts a fresh clip. The SAVE is deferred: enterModifyMode resolves
      // the modify TARGET cell, and a direct "수정 <값>" re-keys the clip to that target so its
      // pointer isn't orphaned (CLIP-CMD). Background save — never blocks the voice flow.
      const pendingCmd = preserveCommandClip(awaiting.row, awaiting.colId);
      if (awaiting.isModify) {
        // No target re-link here (we're already re-listening for the value) — save against the
        // awaiting cell so the utterance still survives for analysis.
        pendingCmd?.saveDefault();
        // [CLIP-VAL-1]①: preserveCommandClip above STOPPED the active clip — restart the slot
        // before the re-ask TTS so the re-spoken value IS recorded (it deterministically wasn't:
        // say() never starts a clip, unlike announceField). Also the landing path for a B4
        // trendConfirm dismissed by '수정' (trendConfirm arms isModify:true).
        armClipForCell(awaiting.row, awaiting.colId);
        await say(`${awaiting.name} 다시 말씀해 주세요.`);
        return;
      }
      const modifyVal = extractModifyValue(text);
      await enterModifyMode(modifyVal || undefined, pendingCmd);
      return;
    }
    if (cmd === 'cancel') {
      cancelTts();
      useSessionStore.getState().setRecognized('');
      // [CLIP-VAL-1]① (cancel sibling): same structure as the isModify re-ask — make sure a
      // recording slot is armed for the re-utterance. After a '수정'→'취소' chain the previous
      // slot was consumed by preserveCommandClip; without this the next value goes unrecorded.
      // startClip() safely truncates/replaces a still-active slot, so arming is idempotent here.
      armClipForCell(awaiting.row, awaiting.colId);
      await say(`${awaiting.name} 다시 말씀해 주세요.`);
      return;
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
        logger.log({ type: 'stt_barge_in', text, confidence, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
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
      logger.log({ type: 'stt_early_commit', sessionId: sessionIdRef.current,
        row: awaiting.row, colId: awaiting.colId,
        extra: `attempt:reset:final_first:${earlyCommitStableRef.current.value}` });
      earlyCommitStableRef.current = null;
    }
    logger.log({
      type: 'stt',
      sessionId: sessionIdRef.current,
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
    if (awaiting.atEnd) {
      useSessionStore.getState().setRecognized('');
      await say("입력이 끝났습니다. 종료하려면 '종료'라고 말씀하거나 종료 버튼을 누르세요.");
      return;
    }

    // Item 12: 컬럼명 완전 일치 STT 거부 — 숫자/날짜 컬럼에만 적용 (text/options 컬럼은 컬럼명이 유효한 값일 수 있음)
    const allColumns = useSettingsStore.getState().columns;
    const currentCol = allColumns.find((c) => c.id === awaiting.colId);
    if (currentCol && currentCol.type !== 'text' && currentCol.type !== 'options') {
      const colNames = allColumns.map((c) => c.name.trim());
      if (colNames.includes(text.trim())) {
        logger.log({ type: 'stt_rejected_col_name', text, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
        useSessionStore.getState().setRecognized('');
        useSessionStore.getState().setReaskReason('parse_failed');
        await say(`${awaiting.name} 다시 말씀해 주세요.`);
        return;
      }
      const KNOWN_NOISE = /^(변경|성경|광경|구정|혜정|당장|경정)$/;
      if (KNOWN_NOISE.test(text.trim())) {
        logger.log({ type: 'stt_rejected_col_name', text, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId, extra: 'known_noise' });
        recorderRef.current?.startClip();
        useSessionStore.getState().setRecognized('');
        useSessionStore.getState().setReaskReason('parse_failed');
        await say(`${awaiting.name} 다시 말씀해 주세요.`);
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
    if (currentCol && (currentCol.type === 'int' || currentCol.type === 'float') && awaiting.fractionWhole == null) {
      if (alts.length <= 1 && isAmbiguousSingleSyllable(text)) {
        logger.log({ type: 'stt_rejected_ambiguous_syllable', text, confidence, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
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
      logger.log({
        type: 'stt_rejected_low_confidence', text, confidence,
        sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId,
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
    const fractionWhole = awaiting.fractionWhole;
    if (fractionWhole != null) {
      awaitingFieldRef.current = { ...awaiting, fractionWhole: undefined };
      if (col) {
        const frac = parseKoreanNumber(text);
        // 소수 한 자리(0~9)만 말한 경우에만 정수부와 합성. 2자리 이상·소수점 포함은 전체 값을 다시
        // 말한 것으로 보고 합성하지 않는다(아래 평소 파싱이 처리).
        if (frac !== null && /^[0-9]$/.test(frac)) {
          parsed = parseValueForCol(col, `${fractionWhole}.${frac}`);
          if (parsed !== null) {
            logger.log({ type: 'stt', extra: 'decimal_fraction_recovered', text: `${fractionWhole}.${frac}`, originalText: text, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
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
        const altParsed = col ? parseValueForCol(col, alt) : null;
        if (altParsed !== null) {
          parsed = altParsed;
          logger.log({ type: 'stt_alt_used', altIdx: ai, text: alt, originalText: text, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
          break;
        }
      }
    }
    if (parsed === null) {
      // v0.20.0 Phase 5 #2 — parse_failed 보강: 원본 transcript(text)는 이미 동봉. 여기에 항목명
      // (colName)과 직전 컨텍스트(소수부 재질문 중이면 정수부 fractionWhole)를 더해 "주로 실패하는
      // 숫자/항목"을 다음 세션부터 정량화한다. (런타임에 '기대값'은 알 수 없어 추가하지 않는다 —
      // 실세션은 정답이 없는 자유 측정이므로 transcript+context로 패턴을 집계하는 것이 정직하다.)
      logger.log({
        type: 'stt_parse_failed', text, altsCount: alts.length,
        extra: parseFailReason ?? undefined,
        sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId,
        colName: awaiting.name,
        ...(awaiting.fractionWhole != null ? { originalText: `frac_ctx:${awaiting.fractionWhole}` } : {}),
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
        logger.log({ type: 'clip', extra: 'clip_decimal_kept', sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
        awaitingFieldRef.current = { ...awaiting, fractionWhole: parseFailWhole };
        await say(`${parseFailWhole} 점, 소수점 아래 숫자만 말씀해 주세요.`);
      } else {
        recorderRef.current?.startClip(); // restart clip (전체 재발화 유도 분기 — 새 클립이 옳다)
        await say(`${awaiting.name} 다시 말씀해 주세요.`);
      }
      return;
    }

    const myEpoch = ++epochRef.current;
    const sess = useSessionStore.getState();
    sess.setRowValue(awaiting.row, awaiting.colId, parsed);
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
    if (!awaiting.trendConfirm) {
      sess.pushValueBurst(awaiting.name, parsed); // I-3: 화면 중앙 "항목 : 값" 버스트
    }
    awaitingFieldRef.current = null;

    // v0.7.0 B4: 추세 알림에 새 값으로 응답한 재커밋 — 정정 기록(오알림률 분모) + 이전 값 발화
    // 클립 보존. 새 저장이 같은 bare key(`sess:row:colId`)를 덮어쓰므로 :a<n>로 먼저 보관한다
    // (RACE-4 보존 원칙 — enterModifyMode의 archive 패턴과 동일, 백그라운드).
    if (awaiting.trendConfirm) {
      logger.log({
        type: 'trend', extra: 'trend_alert_corrected',
        sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId,
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
    const wasModify = !!awaiting.isModify;
    pendingClipsRef.current[clipAwaitingRow] = {
      ...pendingClipsRef.current[clipAwaitingRow],
      [clipAwaitingColId]: clipKey,
    };
    // v0.4.4 증분 영속화: 값 커밋 직후(행이 완료되기 전이라도) 진행 행을 IDB에 저장한다. advance()가
    // 행 완료 시 다시 저장하므로 중복이지만, 마지막 필드 입력 전 새로고침/앱 업데이트로 부분 입력이
    // 유실되는 것을 막는 핵심 보호다. (fire-and-forget — echo TTS/진행을 막지 않음.)
    // v0.24.0 데이터-3 진단 — 이상치 교정 커밋이면, persist 직후 dataStore 값이 교정값과 일치하는지
    // 가시화(불일치=옛값 잔존, 단조 가드가 막아야 함). 다음 실기기 세션에서 재현 시 근인 즉시 포착.
    const wasTrendCorrected = awaiting.trendConfirm;
    void persistSession().then(() => {
      if (!wasTrendCorrected) return;
      const ds = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
      const persisted = ds?.rows.find((r) => r.index === clipAwaitingRow)?.values[clipAwaitingColId];
      logger.log({
        type: 'trend',
        extra: persisted === parsed ? 'trend_corrected_persist_check:ok' : 'trend_corrected_persist_check:mismatch',
        sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId, parsed,
        ...(persisted !== parsed ? { previousValue: String(persisted ?? '') } : {}),
      });
    });
    // Codex MEDIUM-4: clip for this field is being committed (stopped) — no longer active.
    // The next announceField will re-set it after its own startClip().
    activeClipRef.current = null;
    const clipStopPromise: Promise<ClipResult> =
      recorderRef.current?.stopClip()
      ?? Promise.resolve({ blob: null, raw: null, prerollMs: 0 });
    // v0.6.0 CLIP-EMPTY: drop the cell's audioClip pointer when the clip never saved (empty/too
    // small/failed). The pointer was pre-registered in pendingClipsRef AND may already be in the
    // persisted session (persistSession ran above before the clip resolved) — clean BOTH so the
    // data-tab doesn't render a broken (404) play button. Only unlink if the pointer still equals
    // OUR clipKey (a later restart/modify may have re-pointed it). Telemetry is kept upstream.
    const unlinkBrokenPointer = () => {
      const m = pendingClipsRef.current[clipAwaitingRow];
      if (m && m[clipAwaitingColId] === clipKey) delete m[clipAwaitingColId];
      const sess = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
      const prow = sess?.rows.find((r) => r.index === clipAwaitingRow);
      if (sess && prow?.audioClips?.[clipAwaitingColId] === clipKey) {
        const { [clipAwaitingColId]: _gone, ...rest } = prow.audioClips;
        const updatedRow = { ...prow, audioClips: Object.keys(rest).length > 0 ? rest : undefined };
        const updatedSession = {
          ...sess,
          rows: sess.rows.map((r) => (r.index === clipAwaitingRow ? updatedRow : r)),
        };
        useDataStore.getState().upsertSession(updatedSession);
        void saveSession(updatedSession).catch(() => {});
      }
    };
    // [CLIP-VAL-1]②: re-point the cell's audioClip from the failed canonical key to a healthy
    // key (the modify-command clip). pendingClipsRef gate mirrors unlinkBrokenPointer: only act
    // while WE still own the pointer (a later restart/modify re-owns the cell and is left alone).
    // On the persisted side accept `undefined` too — the [CLIP-VAL-1]③ tombstone strip may have
    // already removed our canonical entry from the persisted row.
    const relinkPointer = (newKey: string): boolean => {
      const m = pendingClipsRef.current[clipAwaitingRow];
      if (!m || m[clipAwaitingColId] !== clipKey) return false;
      m[clipAwaitingColId] = newKey;
      const sess = useDataStore.getState().sessions.find((s) => s.id === sessionIdRef.current);
      const prow = sess?.rows.find((r) => r.index === clipAwaitingRow);
      const persisted = prow?.audioClips?.[clipAwaitingColId];
      if (sess && prow && (persisted === clipKey || persisted === undefined)) {
        const updatedRow = {
          ...prow,
          audioClips: { ...(prow.audioClips ?? {}), [clipAwaitingColId]: newKey },
        };
        const updatedSession = {
          ...sess,
          rows: sess.rows.map((r) => (r.index === clipAwaitingRow ? updatedRow : r)),
        };
        useDataStore.getState().upsertSession(updatedSession);
        void saveSession(updatedSession).catch(() => {});
      }
      return true;
    };
    // [CLIP-VAL-1]②③ — a capture under the canonical key failed. Tombstone the key FIRST (so an
    // in-flight persistSession can never re-persist it), then: if this was a modify re-record and
    // its command clip (`…:cmd<n>` — for "수정 <값>" it carries the NEW value's utterance) actually
    // saved, re-link the cell's playback pointer to it (06-11 row8: the correct audio WAS on disk
    // as `8:c7:cmd1`); otherwise unlink so no stale previous-value audio remains canonical.
    const resolveFailedCapture = async (savePromiseSelf: Promise<unknown> | null) => {
      brokenClipKeysRef.current.add(clipKey);
      if (wasModify) {
        const n = cmdClipRef.current[`${clipAwaitingRow}:${clipAwaitingColId}`];
        if (n) {
          const cmdKey = `${sessionIdRef.current}:${clipAwaitingRow}:${clipAwaitingColId}:cmd${n}`;
          // The cmd-clip save may still be in flight — flush other pending saves (not ourselves)
          // before the existence check (archiveCellClip's flush pattern, bounded).
          const others = Array.from(pendingClipSavesRef.current).filter((p) => p !== savePromiseSelf);
          if (others.length > 0) {
            await Promise.race([
              Promise.allSettled(others),
              new Promise<void>((resolve) => setTimeout(resolve, 1500)),
            ]);
          }
          const cmdBlob = await loadAudioClip(cmdKey).catch(() => null);
          if (cmdBlob && relinkPointer(cmdKey)) {
            logger.log({
              type: 'clip', extra: 'clip_relink_cmd', kind: 'command', clipKey: cmdKey,
              sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId,
            });
            return;
          }
        }
      }
      unlinkBrokenPointer();
    };
    // Holder for the savePromise's own identity (assigned right after creation, before the
    // IIFE's first await resumes) so resolveFailedCapture can exclude itself from the flush.
    let savePromiseSelf: Promise<unknown> | null = null;
    const savePromise = (async () => {
      try {
        logger.log({ type: 'clip', extra: 'clip_stop_await', sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
        const { blob: clipBlob, raw: rawBlob, trimFailed, trimFailReason } = await clipStopPromise;
        logger.log({ type: 'clip', extra: `clip_stop_resolved:${clipBlob ? clipBlob.size : 'null'}`, sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
        // v0.20.0 BL-2 — 트림이 예외(decodeAudioData 등)로 생략됐으면(저장본=미트림 원본 webm) 가시화한다.
        // 이전엔 무이벤트 침묵 폴백이라 "음성클립 편집 실패"(이원창 c7 3·4·5 = 비고 3행)가 로그에 안 보였다.
        // 클립 자체는 저장되어 재생 가능(capture 플로우 불깨짐) — 이건 순수 관측용 신호다(보수적).
        if (trimFailed) {
          logger.log({
            type: 'clip', extra: `clip_trim_failed:${trimFailReason ?? 'unknown'}`,
            sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId, clipKey,
          });
        }
        if (!clipBlob) {
          // v0.20.0 Phase 5 #5 — clip_empty에 직전 입력장치 전이(있으면)를 컨텍스트로 동봉한다.
          // BT clip_empty는 내장↔블루투스 thrash 직후 트랙 사망으로 발생 — 전이를 같은 이벤트에 붙여
          // 다음 분석이 BT 라우팅 원인을 즉시 잇게 한다(이전엔 별도 input_device_changed와 ts로만 상관).
          const lic = recorderRef.current?.getLastInputChange();
          logger.log({
            type: 'error',
            extra: lic ? `clip_empty:after:${lic.reason}:${lic.transition}` : 'clip_empty',
            sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId,
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
        if (clipBlob.size <= 200) {
          logger.log({ type: 'error', extra: `clip_too_small:${clipBlob.size}`, sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
          maybeAutoRecoverOrLatch('clip_too_small');
          await resolveFailedCapture(savePromiseSelf);
          return;
        }
        // v0.11.0 Codex HIGH: pendingClipsRef로 stale save 차단.
        // restart/modify가 pendingMap[colId]를 정리하거나 새 키로 교체하면, 옛 savePromise는
        // m[colId] !== clipKey가 되어 폐기됨. epoch 가드보다 정밀해서 정상 클립을 차단하지 않음.
        const guard = pendingClipsRef.current[clipAwaitingRow];
        if (!guard || guard[clipAwaitingColId] !== clipKey) {
          logger.log({ type: 'error', extra: 'clip_stale_pending', sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
          return;
        }
        await saveAudioClip(clipKey, clipBlob);
        // [CLIP-VAL-1]③: fresh bytes landed under this key — lift the tombstone so the pointer
        // may persist again (a previous failed attempt on the same cell reuses the same key).
        brokenClipKeysRef.current.delete(clipKey);
        logger.log({ type: 'clip', extra: `clip_saved:${clipBlob.size}`, sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
        // v0.5.0 W6 원본 보존(민구 결정): 트림 전 전체본(프리롤 포함)을 `…:raw`로 함께 보관.
        // pendingClips에는 등록하지 않으므로 데이터탭 재생 UI에는 노출되지 않고, 로그 zip의
        // clips/(prefix 매칭)과 deleteSession cascade에만 따라간다. 분석 전용.
        if (rawBlob) {
          await saveAudioClip(`${clipKey}:raw`, rawBlob);
          logger.log({ type: 'clip', extra: `clip_raw_saved:${rawBlob.size}`, clipKey: `${clipKey}:raw`, sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
        }
      } catch (e) {
        logger.log({ type: 'error', extra: `clip_save_failed:${String((e as Error)?.message ?? e)}`, sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
        await resolveFailedCapture(savePromiseSelf);
      }
    })();
    savePromiseSelf = savePromise;
    pendingClipSavesRef.current.add(savePromise);
    void savePromise.finally(() => pendingClipSavesRef.current.delete(savePromise));

    // ── v0.7.0 B4: 추세 검증 — 값 커밋 직후 · echo/advance 전 ──
    // 값↔클립 매핑은 위에서 이미 확정됐고 커밋된 값은 위반이어도 그대로 선다(롤백 없음 — 민구
    // 결정: 알림 후 '확인'/'유지'는 유지·진행, 새 값 발화는 재입력). 위반이면 echo 대신 알림
    // TTS를 내보내고 advance를 중단한 채 trendConfirm 상태로 응답을 기다린다.
    const trendViolation = evaluateTrend(col, awaiting.row, awaiting.colId, parsed);
    if (trendViolation) {
      const v = trendViolation;
      // v0.9.0 발화 문구 분기(민구 요청): 변동률(pct) 트리거 → 기존 % 유지; 증가/감소(direction)
      // 또는 둘 다(both) → 절대값 차이로 안내. 절대차는 부동소수 잔여(2.2000002)를 막기 위해 컬럼
      // 소수자리수로 반올림한다(float=col.decimals||1, int=0). both는 방향 우선 = 절대값.
      const decForDiff = col?.type === 'float' ? (col.decimals ?? 1) : 0;
      // v0.20.0 입력탭#6 — 알람 종류 + 표시 임계. AnomalyAlertPopup(Vance)이 같은 kind/threshold를 읽어
      // "범위 알람 ±NN%" / "추세 알람 감소 NN"을 그리므로, 아래 TTS 문구를 **팝업 라벨과 글자까지 동일**
      // 하게 맞춘다(시각·청각 일치). alertKind는 음성(alertText)·팝업(kind)을 동시에 가른다(글자 동일 계약).
      // v0.25.0 기능3(WS-3, 민구 요청) — 추세와 범위가 **동시 발동**(trigger:'both')하면 범위 우선.
      // 순수 'direction'만 추세, 'pct'·'both'는 범위 → 시각·청각이 함께 "범위 알람 +##%"로 일치한다.
      const alertKind: 'trend' | 'range' = v.trigger === 'direction' ? 'trend' : 'range';
      // 표시값: 범위=실제 편차%(v.pctText; prev≠0이면 항상 산출, pctFired는 prev≠0 필요라 범위 분기는
      // 항상 유효) · 추세=절대 변화량(부동소수 잔여 방지로 컬럼 소수자리 반올림). 팝업 changeText도 동일 값.
      const changeText =
        alertKind === 'range'
          ? (v.pctText ? `${v.pctText}%` : '')
          : Math.abs(v.next - v.prev).toFixed(decForDiff);
      // changeNum = 변화량 숫자만(팝업 changeText.replace와 동일 규칙) — 추세 발화/표시에 쓴다.
      const changeNum = changeText.replace(/[^0-9.]/g, '');
      // v0.24.0 입력탭(민구 요청) — 범위 알람은 설정 임계가 아니라 **실제로 벗어난 편차%를 부호와 함께**
      //   안내한다("+##%"/"-##%"). 증가=+, 감소=−. 헤드라인은 정수 반올림. 미산출(드뭄) 시 설정 임계 폴백.
      const rangeThreshold = col?.pctThreshold;
      const rangePct = changeNum ? Math.round(Number(changeNum)) : rangeThreshold;
      const rangeSign = v.direction === 'up' ? '+' : '-';
      // v0.20.0 입력탭#6 — 문구 단축(목적+값만, "~합니다/하세요"·"직전 조사보다" 제거).
      //  추세: "추세 알람 증가|감소 NN"(NN=절대 변화량) · 범위: "범위 알람 +|-NN%"(NN=실제 편차%).
      // self-confirm 환각 방어(끝에 '확인해주세요' 없음, v0.13.0 R7)는 유지 — 문구가 명령어로 끝나지 않음.
      // **팝업 라벨(AnomalyAlertPopup)과 글자 동일**하게 맞춘다(시각·청각 일치, 1711 규약).
      const alertText =
        alertKind === 'range'
          ? `범위 알람 ${rangeSign}${rangePct}%`
          : `추세 알람 ${v.direction === 'up' ? '증가' : '감소'}${changeNum ? ` ${changeNum}` : ''}`;
      // v0.26.0(Trace 권장, 2세션 연속 계측 갭) — 어떤 종류/트리거/문구로 알람이 나갔는지 extra에 동봉.
      //   직전까지는 extra='trend_alert_fired'뿐이라 기능3(both→범위 우선) 라우팅을 로그로 검증할 수
      //   없었다. 파서 호환을 위해 'trend_alert_fired' 접두는 유지하고 ':k=v' 목록을 덧붙인다.
      logger.log({
        type: 'trend',
        extra: `trend_alert_fired:trigger=${v.trigger},kind=${alertKind},dir=${v.direction},change=${changeText || '?'},text=${alertText}`,
        sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId,
        colName: awaiting.name, text, parsed, confidence, previousValue: String(v.prev),
      });
      // value 이벤트는 정상 커밋과 동일하게 남긴다 — 분석 파이프라인이 위반 여부와 무관하게 본다.
      logger.log({
        type: 'value',
        sessionId: sessionIdRef.current,
        row: awaiting.row, colId: awaiting.colId, colName: awaiting.name,
        text, parsed, confidence,
        durationMs: commitLatencyMs, // v0.20.0 Phase 5 #4 — 발화 확정→커밋 반응속도(ms)
        ...(awaiting.isModify && awaiting.previousValue != null
          ? { previousValue: awaiting.previousValue }
          : {}),
      });
      // 응답 대기 상태 무장 — 새 값 발화가 기존 수정(isModify) 의미론으로 재커밋되도록
      // previousValue=방금 커밋된 값과 함께 세팅한다.
      awaitingFieldRef.current = {
        row: awaiting.row, colId: awaiting.colId, name: awaiting.name,
        isModify: true, previousValue: parsed, trendConfirm: true,
      };
      // 응답 발화('확인'/새 값) 클립 시작 — announceField 패턴(TTS 이전 시작, barge-in 수록).
      armClipForCell(awaiting.row, awaiting.colId);
      // 시각 팝업: 이전값→현재값과 변화량을 띄운다(발화만으론 스쳐 지나가 확인이 어렵다는 요청).
      // v0.12.0 AREA2 V2 — 어떤 샘플·행/직전 회차의 비교인지 식별정보를 함께 싣는다(별도 재계산).
      const alertExtra = getAnomalyAlertData(awaiting.row);
      useSessionStore.getState().setAnomalyAlert({
        colName: awaiting.name,
        prev: String(v.prev),
        next: formatForTts(parsed),
        direction: v.direction,
        changeText,
        row: awaiting.row,
        sampleKey: alertExtra.sampleKey,
        prevDate: alertExtra.prevDate,
        status: 'pending', // v0.13.0 R2 — 이상치(빨강) 상태. 정정 정상 시 'corrected'(초록)로 갱신.
        kind: alertKind, // v0.20.0 입력탭#6 — 팝업이 추세/범위 표시를 가르는 신호.
        ...(rangeThreshold != null ? { threshold: rangeThreshold } : {}),
      });
      useSessionStore.getState().setLastTts(alertText);
      await say(alertText);
      return; // advance 중단 — 해소는 handleFinal 상단의 trendConfirm 분기
    }

    // ── v0.13.0 R2(민구 요청): 추세 알림에 새 값으로 응답한 정정이 '정상'으로 판명된 경우 ──
    // (위 trendViolation 분기를 타지 않고 여기 도달 = 정정값이 정상 범위.) 화면에 떠 있던 빨강 이상치
    // 팝업을 초록(corrected)으로 전환하고 next를 정정값으로 즉시 반영한다. 이전엔 이 경로에서 팝업을
    // 전혀 갱신하지 않아 옛 이상치 값이 남은 채 echo TTS("수정 …")만 새 값을 말해 시각/청각이 어긋났다.
    // 팝업 닫힘은 기존대로 advance()→announceField의 setAnomalyAlert(null)이 담당하므로, echo TTS가
    // 발화되는 동안 초록 팝업이 노출된다(별도 타이머 없이 '초록 전환 + 즉시 반영' 성립).
    if (awaiting.trendConfirm) {
      const cur = useSessionStore.getState().anomalyAlert;
      if (cur) {
        useSessionStore.getState().setAnomalyAlert({
          ...cur,
          next: formatForTts(parsed),
          status: 'corrected',
        });
      }
    }

    const echoText = awaiting.isModify
      ? `수정 ${awaiting.name} ${formatForTts(parsed)}`
      : formatForTts(parsed);
    const echoEnqueuedAt = Date.now();
    await speak(echoText, {
      interrupt: true,
      rate: getTtsRate(),
      onStart: (d) => {
        logger.log({
          type: 'tts',
          ttsText: echoText,
          startDelayMs: d,
          durationMs: Date.now() - echoEnqueuedAt,
          sessionId: sessionIdRef.current,
          row: awaiting.row,
          extra: 'echo',
        });
      },
    });

    logger.log({
      type: 'value',
      sessionId: sessionIdRef.current,
      row: awaiting.row,
      colId: awaiting.colId,
      colName: awaiting.name,
      text,
      parsed,
      confidence,
      durationMs: commitLatencyMs, // v0.20.0 Phase 5 #4 — 발화 확정→커밋 반응속도(ms)
      // #3 error-vs-intent: present only when this value re-commits a corrected cell.
      // previousValue (pre-modify) vs parsed (final) discriminates STT prefix-drop from re-entry.
      ...(awaiting.isModify && awaiting.previousValue != null
        ? { previousValue: awaiting.previousValue }
        : {}),
    });

    // Guard against race: another handleFinal ran while we were awaiting
    if (epochRef.current !== myEpoch) return;
    await advance();
  }, [advance, enterModifyMode, say, goNextRow, enterReentry, persistSession, evaluateTrend, getAnomalyAlertData, archiveCellClip, armClipForCell]);

  // ── v0.9.0 interim(중간) 결과 처리: EOS 계측 마킹 + (빠른 인식 ON 시) 조기확정 ──
  const handleInterim = useCallback((text: string) => {
    const now = Date.now();
    // EOS 계측: 마지막 interim 도착 시각 기록 — handleFinal이 final.ts와의 차로 꼬리를 산출.
    lastInterimRef.current = { text, at: now };

    // 조기확정(빠른 인식) — 기본 OFF(실험). 브라우저 final(무음 종료감지)을 기다리지 않고
    // interim 숫자가 안정되면 커밋해 체감 딜레이를 줄인다. 보수적으로 숫자 컬럼 + 명령어 아님 +
    // TTS중 아님 + active 단계에서만. 절단 리스크가 있어 실기기 A/B 전까지 default off.
    if (!useSettingsStore.getState().fastRecognition) return;
    // A8 계측: fastRecognition ON인데 현장 로그에서 stt_early_commit 0건 — '소음이 interim 안정화를
    // 막아 미발동(정상)'인지 '미배선(버그)'인지 현 계측으론 구분 불가. 아래 stt_early_commit_attempt
    // 로 안정화 시도 진입·리셋 사유를 가시화한다. 동작은 변경하지 않는다(가시성만 추가). OFF면 위
    // early-return으로 무발화(오버헤드 0). 로그 폭주를 막기 위해 전이(transition) 시에만 찍는다.
    const logAttempt = (extra: string) =>
      logger.log({ type: 'stt_early_commit', sessionId: sessionIdRef.current,
        row: awaitingFieldRef.current?.row, colId: awaitingFieldRef.current?.colId,
        extra: `attempt:${extra}` });
    const awaiting = awaitingFieldRef.current;
    if (!awaiting || awaiting.trendConfirm || awaiting.atEnd) return;
    if (useSessionStore.getState().phase !== 'active') return;
    if (ctrlRef.current?.isTtsMuted()) {
      // TTS 중 barge-in은 final 경로가 처리 — 안정화 후보가 무장돼 있었다면 무산 사유를 기록.
      if (earlyCommitStableRef.current) { logAttempt('cancel:tts_muted'); earlyCommitStableRef.current = null; }
      return;
    }
    const t = text.trim();
    if (!t || detectCommand(t)) return; // 명령어는 반드시 final로
    const col = useSettingsStore.getState().columns.find((c) => c.id === awaiting.colId) || null;
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
    logger.log({
      type: 'stt_early_commit', text: t, parsed,
      sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId,
      extra: `stable=${EARLY_COMMIT_STABLE_MS}`,
    });
    ctrlRef.current?.restartRecognition();
    // confidence 0 = "미보고" 센티넬 → 신뢰도 게이트 통과(interim엔 신뢰도 없음). 안정성으로 갈음.
    void handleFinal(t, [t], 0);
  }, [handleFinal]);

  // ── start / stop ───────────────────────────────────────────
  const start = useCallback(async (label?: string) => {
    const s = useSettingsStore.getState();
    setPreferredVoiceName(s.preferredVoiceName);
    const sess = useSessionStore.getState();
    if (!s.tableGenerated) return false;
    const vc = s.columns.filter((c) => c.input === 'voice');
    if (vc.length === 0) return false;
    const total = computeTotalRows(s.columns);
    if (total === 0) return false;

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
    clipAttemptRef.current = {};
    cmdClipRef.current = {};
    brokenClipKeysRef.current = new Set();
    correctionBackupRef.current = null;
    trendSkipLoggedRef.current = new Set();
    // v0.22.0 P0 — micLost 게이트 리셋: 이전 세션이 마이크 소실로 끝났어도 새 세션은 깨끗한
    // 스트림으로 시작한다(start()가 새 AudioRecorder.init()로 재획득).
    micLostLatchedRef.current = false;
    setMicLost(false);
    sessionTodayRef.current = localTodayISO();
    // v0.8.0: 과거값 인덱스 프리페치(fire-and-forget) — 마스터 토글 제거 → 이상치 알람 규칙
    // (방향 trendRule 또는 변동률 pctThreshold)이 한 컬럼이라도 있고 Google 연결 시에만.
    // loadPastIndex는 모든 실패를 null로 해소하고 past_index_skip 텔레메트리만 남기므로
    // 세션 시작 흐름을 절대 막지 않는다. 셀 단위 검사(evaluateTrend)는 이 캐시만 읽는다.
    const anyAnomalyRule = s.columns.some(
      (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
    );
    if (anyAnomalyRule && getAccessToken()) { resetPastIndexRetries(); prefetchPastIndex(); }
    logger.setSessionId(sessionIdRef.current);
    // #1 reach telemetry: attach session-meta alongside the existing `extra:'start'` tag.
    // `extra` is preserved so any analysis keying on it keeps working; new fields are additive.
    logger.log({
      type: 'session',
      sessionId: sessionIdRef.current,
      extra: 'start',
      meta: {
        appVersion: logger.device().appVersion,
        startedAt: Date.now(),
        totalRows: total,
        completedRows: 0,
        // v0.23.0 입력탭#2 — 세션 시작 시 활성 인식 허용범위를 박제(설정값 미로깅 갭 해소).
        recognitionTolerance: s.recognitionTolerance,
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
    // #4 active mic: once init() resolves, emit a follow-up session event carrying the granted
    // input device. Done async (not awaited) so STT startup is never blocked; emitted as its own
    // event so analysis can attribute STT accuracy to the real device per session.
    void recorderRef.current.init().then((ok) => {
      if (!ok) return;
      const input = recorderRef.current?.getActiveInput();
      if (!input) return;
      logger.log({
        type: 'session',
        sessionId: sessionIdRef.current,
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
  }, [announceField, announceRowDiff, handleFinal, handleInterim, say]);

  const stop = useCallback(async (announce = true) => {
    setActiveController(null);
    ctrlRef.current?.stop();
    ctrlRef.current = null;
    cancelTts();
    awaitingFieldRef.current = null;
    // #1 reach telemetry: session-meta on stop. `extra:'stop'` preserved; new fields additive.
    // completedRows here is the denominator-complement for reach/completion-rate aggregation.
    {
      const sessNow = useSessionStore.getState();
      const settingsNow = useSettingsStore.getState();
      const input = recorderRef.current?.getActiveInput();
      logger.log({
        type: 'session',
        sessionId: sessionIdRef.current,
        extra: 'stop',
        meta: {
          appVersion: logger.device().appVersion,
          startedAt: parseInt(sessionIdRef.current.replace('sess_', ''), 10) || undefined,
          finishedAt: Date.now(),
          totalRows: computeTotalRows(settingsNow.columns),
          completedRows: sessNow.completedRows.length,
          // label intentionally omitted (PII — grower name); see start-event note.
          inputDeviceId: input?.deviceId,
          inputDeviceLabel: input?.label,
          sessionMode: 'field',
        },
      });
    }
    if (announce) await say('입력을 종료합니다.');
    useSessionStore.getState().setPhase('ready');
    // Codex 3차 HIGH: 클립 저장을 dispose보다 먼저 flush.
    // dispose는 in-flight stopClip의 resolveStop을 null로 해소하지만(zombie 방지),
    // 가능하면 자연 onstop으로 실제 blob을 저장하는 것이 우선.
    if (pendingClipSavesRef.current.size > 0) {
      // 5초 안전 타임아웃: dispose가 즉시 해소하므로 일반적으로 즉시 끝나지만 race 대비.
      await Promise.race([
        Promise.allSettled(Array.from(pendingClipSavesRef.current)),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
    recorderRef.current?.dispose();
    recorderRef.current = null;
    // v0.10: await로 변경 — audioClips 키가 IDB session에 확실히 저장된 후 종료
    await persistSession();
    logger.setSessionId(undefined);
  }, [persistSession, say]);

  /** Pause STT value processing without stopping the controller.
   *  The controller stays active so the user can say '재시작' to resume.
   *  Recorder is disposed to prevent clip accumulation while paused. */
  // v0.20.0 Phase 5 #3 — 일시정지/재개에 진입·해제 방식(source)을 명시 동봉. 'voice'=음성 명령,
  // 'touch'=마이크 버튼 탭. 기존 호출부(VoiceScreen 탭)는 인자 없이 호출하므로 기본값을 둔다 —
  // 그 경로가 곧 touch다. extra를 `phase:<source>`로 확장(신규 이벤트 타입 무첨가, log-replay 호환).
  // 다음 분석이 "일시정지 횟수 + 어떤 방식으로 해제했는지"(민구 요청·Trace #4)를 정량화한다.
  const pause = useCallback(async (source: 'voice' | 'touch' = 'touch') => {
    logger.log({ type: 'command', parsed: 'pause', extra: `phase:${source}`, sessionId: sessionIdRef.current, row: useSessionStore.getState().activeRow });
    cancelTts();
    // dispose가 in-flight stopClip을 null로 해소해 정상 클립이 clip_empty로 떨어지는 것을 방지:
    // stop()과 동일하게 pending save를 먼저 flush.
    if (pendingClipSavesRef.current.size > 0) {
      await Promise.race([
        Promise.allSettled(Array.from(pendingClipSavesRef.current)),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    recorderRef.current?.dispose();
    recorderRef.current = null;
    useSessionStore.getState().setPhase('paused');
    useSessionStore.getState().setLastTts('일시정지됨. 마이크 다시 탭하면 재개됩니다.');
    await say('일시정지됨.');
  }, [say]);

  /** Resume from paused: re-announce current field. Controller is kept alive during pause. */
  const resume = useCallback(async (source: 'voice' | 'touch' = 'touch') => {
    const sess = useSessionStore.getState();
    if (sess.phase !== 'paused') return;
    // v0.20.0 Phase 5 #3 — 해제 방식 동봉(voice='재시작' 음성, touch=마이크 버튼). 일시정지가 어떤
    // 경로로 풀렸는지를 정량화해 "분투→해제" 패턴(강남호 13/14 churn)을 다음 세션부터 분해한다.
    logger.log({ type: 'command', parsed: 'resume', extra: `phase:${source}`, sessionId: sessionIdRef.current, row: sess.activeRow });
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

  // v0.22.0 P1 — 토큰 지각 settle 시 과거값 인덱스 재프리페치. 근인: 이상치 알람용 프리페치는
  // start() 시점에 토큰이 있을 때만 1회 트리거되는데, 토큰이 늦게 도착하면(auth_token_settled
  // late=true 17~19s) 또는 타임아웃이면 전 세션 알람이 미작동했다. settlePending 성공 경로의
  // onTokenSettled 구독으로, 세션 도중 토큰이 도착했을 때 — anomalyRule이 있고 아직 인덱스가
  // 없으면 — 재프리페치해 남은 셀부터 알람을 복구한다(start()의 1회 프리페치는 early 토큰 케이스로
  // 유지). 정직한 한계: 토큰 도착 '전' 입력 셀, 타임아웃/오프라인은 여전히 알람 없음(회차간 비교는
  // 시트가 있어야 하므로 불가피).
  useEffect(() => {
    const unsubscribe = onTokenSettled(() => {
      const s = useSettingsStore.getState();
      const anyAnomalyRule = s.columns.some(
        (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
      );
      // 인덱스가 이미 캐시돼 있으면 재프리페치 불필요(early 토큰 케이스가 채웠음).
      if (anyAnomalyRule && !getCachedIndex()) {
        logger.log({ type: 'app', extra: 'past_index_reprefetch:token_settled', sessionId: sessionIdRef.current });
        resetPastIndexRetries();
        prefetchPastIndex();
      }
    });
    return unsubscribe;
  }, []);

  // v0.12.0 AREA1 — 입력탭 읽기전용 입력장치 CATEGORY 배지용. getUserMedia가 실제로 잡은 마이크
  // 라벨을 노출(init() 비동기 resolve 후 채워짐). 안정 참조(useCallback []) — VoiceScreen이
  // 폴링으로 읽어 classifyInputDevice로 CATEGORY를 표시한다.
  const getActiveInputLabel = useCallback(
    () => recorderRef.current?.getActiveInput()?.label ?? null,
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
      logger.setSessionId(s.sessionId);
    }
  }, []);

  // unmount cleanup
  useEffect(() => () => {
    setActiveController(null);
    ctrlRef.current?.stop();
    cancelTts();
    recorderRef.current?.dispose();
  }, []);

  /** v0.11.0: touch 컬럼 값 commit 시 sessionStore + dataStore + IDB 모두에 즉시 반영.
   *  Codex MEDIUM: setRowValue만으로는 휘발성 상태만 변경 → sync/CSV가 누락하는 위험 해결. */
  const commitTouchValue = useCallback(async (row: number, colId: string, value: string) => {
    const sess = useSessionStore.getState();
    logger.log({ type: 'command', parsed: 'touch_commit', extra: 'touch', text: value, sessionId: sessionIdRef.current, row, colId });
    sess.setRowValue(row, colId, value);
    // persistSession은 completedRows만 IDB에 저장. touch 값을 그 사이에 반영하려면
    // dataStore의 기존 세션을 patchRowValues로 즉시 갱신한다. F2: patchRowValues가
    // "값 변경 ⇒ synced→dirty" 불변식을 적용 → 업로드된 행을 touch로 고쳐도 다음 sync가
    // 시트 행을 UPDATE한다(이전엔 upsertSession 직접 호출로 dirty 마크를 우회해 시트 미반영).
    const updatedSession = useDataStore
      .getState()
      .patchRowValues(sessionIdRef.current, row, { [colId]: value });
    if (updatedSession) {
      try { await saveSession(updatedSession); } catch { /* ignore */ }
    }
    // 행이 아직 완료된 적이 없으면(persistSession 한 번도 호출 안 됨) sessionStore만 업데이트.
    // 다음 행 진행 시 persistSession에서 자연스럽게 반영됨.
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

  return { start, stop, restartFromCol, jumpToRow, gotoAdjacentRow, goNextRow, pause, resume, commitTouchValue, lastConfidenceRef, getActiveInputLabel, micLost, reconnectMic, prewarmMic };
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
