import { useCallback, useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useDataStore } from '../stores/dataStore';
import { recountSynced } from './sessionSync';
import { parseKoreanNumber, detectCommand, extractModifyValue, isAmbiguousSingleSyllable, getLastParseFailReason } from './koreanNum';
import { VOICE_COMMANDS } from './voiceCommands';
import { SpeechController, speak, cancelTts, isSpeechSupported, formatForTts, warmupTts, setActiveController, setPreferredVoiceName, refreshVoices } from './speech';
import { computeTotalRows, buildCyclingValues, nestedAutoValue } from './autoValue';
import type { Column, Session, SessionRow } from '../types';
import { saveSession, saveAudioClip, loadAudioClip } from './db';
import { AudioRecorder } from './audioRecorder';
import { logger } from './logger';
import { getCachedIndex, prefetchPastIndex, keyColumns, buildSampleKey, previousRound, pastValue } from './pastValues';
import { checkAnomaly, type TrendViolation } from './trendCheck';
import { getAccessToken } from './googleAuth';


/** v0.6.0 CLIP-CMD — a captured '수정'/'정정' utterance whose save is deferred until the modify
 *  target cell is known, so a direct "수정 <값>" clip is keyed to the cell it corrects. */
interface PendingCommandClip {
  /** Save the utterance under (targetRow:targetColId):cmd<n> and return that cmdKey (or null if
   *  empty/already saved). Used by the direct-modify path to re-link the corrected cell's pointer. */
  saveFor: (targetRow: number, targetColId: string) => string | null;
  /** Save against the awaiting cell (cascade/restart path — no pointer re-link needed). */
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
}

export function useVoiceSession() {
  const ctrlRef = useRef<SpeechController | null>(null);
  const sessionIdRef = useRef<string>('');
  const sessionLabelRef = useRef<string | undefined>(undefined);
  const awaitingFieldRef = useRef<AwaitingField | null>(null);
  const epochRef = useRef(0);
  const lastConfidenceRef = useRef<number>(1);
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
  // v0.7.0 B4: trend_skip 원인별 1회 로깅(세션당) — 같은 원인(no_index 등)이 셀마다 반복
  // 로깅돼 텔레메트리를 도배하지 않게 한다. start()에서 리셋.
  const trendSkipLoggedRef = useRef<Set<string>>(new Set());
  // 세션 시작 시점의 로컬 오늘 ISO — evaluateTrend가 값 커밋마다 Date를 새로 만들지 않게
  // start()에서 1회 계산(현장 세션은 자정을 의미 있게 넘기지 않는다).
  const sessionTodayRef = useRef<string>('');
  // Ref to resume() — breaks the circular dependency between handleFinal and resume.
  const resumeRef = useRef<() => Promise<void>>(async () => {});

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
      // Cascade/restart path doesn't re-link a pointer — save against the awaiting cell as before
      // (analysis still gets the utterance; the cell is re-recorded so no pointer is needed).
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

  /** 마지막 행 너머에 더 갈 곳이 없을 때의 종료 처리(민구 결정 4): 빈 행(placeholder)이 있으면
   *  행 번호를 TTS로 안내한 뒤 자동 종료, 없으면 기존 "모든 입력 완료" 안내 후 종료. */
  const finishAtEnd = useCallback(async () => {
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const total = computeTotalRows(useSettingsStore.getState().columns);
    const empties = listEmptyRows(total, vc);
    sess.setPhase('done');
    if (empties.length > 0) {
      const msg = `마지막 행까지 입력했습니다. ${formatRowList(empties)}이 비어 있습니다. 데이터 탭에서 확인해 주세요.`;
      sess.setLastTts(msg);
      logger.log({
        type: 'session', extra: `end_with_empty_rows:${empties.join(',')}`,
        sessionId: sessionIdRef.current,
      });
      await say(msg);
    } else {
      await say('모든 입력이 완료되었습니다.');
    }
    await stop(false);
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
      await finishAtEnd();
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
  }, [announceField, announceRowComplete, announceRowDiff, finishAtEnd, persistSession, say]);

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

    // Cascade re-record path (no usable inline value): the target cell is re-recorded fresh, so no
    // pointer re-link is needed — save the '수정' utterance against the awaiting cell for analysis.
    pendingCmd?.saveDefault();

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
  // 빈 행 안내 후 자동 종료(finishAtEnd).
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
      awaitingFieldRef.current = null;
      await finishAtEnd();
      return;
    }
    await jumpToRow(next, { setReturn: false });
  }, [finishAtEnd, jumpToRow, persistSession]);

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
      if (!index) { logTrendSkip('no_index', row, colId); return null; } // 오프라인/프리페치 실패/TTL 만료
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

  // ── final result handler ───────────────────────────────────
  const handleFinal = useCallback(async (textArg: string, alts: string[], confidence: number) => {
    // `text` is mutable so the redo-with-inline-value path (e.g. "다시 8.4") can rewrite the
    // effective utterance to just the value and fall through to the normal value-commit path.
    let text = textArg;
    const awaiting = awaitingFieldRef.current;
    if (!awaiting) return;
    const cmd = detectCommand(text);

    // While paused, only handle the 'resume' command; ignore everything else.
    if (useSessionStore.getState().phase === 'paused') {
      if (cmd === 'resume') {
        epochRef.current++;
        cancelTts();
        await resumeRef.current();
      }
      return;
    }

    // v0.4.5 Q2: 스피커폰 모드에서는 TTS 재생 중 '명령어 실행'도 차단한다(true half-duplex).
    // interim TTS 컷만 막으면 명령은 final에서 그대로 실행돼, modify 에코 TTS("수정 …")가 마이크로
    // 새어 들어와 가짜 modify를 자가발동할 수 있다. 안내가 끝난 뒤 명령하도록 폐기한다.
    // (resume은 위 paused 분기에서 처리되며 그땐 TTS가 재생 중이 아니므로 영향 없음.)
    if (cmd && ctrlRef.current?.isTtsMuted() && useSettingsStore.getState().speakerphoneMode) {
      logger.log({ type: 'stt_blocked_tts_muted', text, parsed: cmd, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
      return;
    }

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
      await pause();
      return;
    }
    if (cmd === 'resume') {
      cancelTts();
      await resumeRef.current();
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
    if (ctrlRef.current?.isTtsMuted()) {
      // v0.4.5 Q2: 스피커폰 모드면 에코 방지를 위해 TTS 중 값 입력을 폐기(barge-in 끔) — TTS가
      // 끝난 뒤 말하도록. 기본(이어폰) 모드는 barge-in 유지.
      if (useSettingsStore.getState().speakerphoneMode) {
        logger.log({ type: 'stt_blocked_tts_muted', text, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
        return;
      }
      logger.log({ type: 'stt_barge_in', text, confidence, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
      cancelTts();
      epochRef.current++; // 진행 중인 advance/안내 체인 무효화
    }

    // Log STT event
    lastConfidenceRef.current = confidence;
    logger.log({
      type: 'stt',
      sessionId: sessionIdRef.current,
      row: awaiting.row,
      colId: awaiting.colId,
      colName: awaiting.name,
      text,
      confidence,
      alts,
    });

    // Item 12: 컬럼명 완전 일치 STT 거부 — 숫자/날짜 컬럼에만 적용 (text/options 컬럼은 컬럼명이 유효한 값일 수 있음)
    const allColumns = useSettingsStore.getState().columns;
    const currentCol = allColumns.find((c) => c.id === awaiting.colId);
    if (currentCol && currentCol.type !== 'text' && currentCol.type !== 'options') {
      const colNames = allColumns.map((c) => c.name.trim());
      if (colNames.includes(text.trim())) {
        logger.log({ type: 'stt_rejected_col_name', text, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
        useSessionStore.getState().setRecognized('');
        await say(`${awaiting.name} 다시 말씀해 주세요.`);
        return;
      }
      const KNOWN_NOISE = /^(변경|성경|광경|구정|혜정|당장|경정)$/;
      if (KNOWN_NOISE.test(text.trim())) {
        logger.log({ type: 'stt_rejected_col_name', text, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId, extra: 'known_noise' });
        recorderRef.current?.startClip();
        useSessionStore.getState().setRecognized('');
        await say(`${awaiting.name} 다시 말씀해 주세요.`);
        return;
      }
    }

    const settingsNow = useSettingsStore.getState();
    const noisyMode = settingsNow.noisyMode;
    // v0.4.5 Q2: 스피커폰 모드도 신뢰도 임계를 상향(에코 오인식 방지).
    const minConfidence = noisyMode || settingsNow.speakerphoneMode ? 0.80 : 0.65;

    // Input-3: 소음 환경 모드 — 1글자 이하 결과 거부
    if (noisyMode && text.replace(/\s/g, '').length <= 1) {
      recorderRef.current?.startClip();
      useSessionStore.getState().setRecognized('');
      await say(`${awaiting.name} 다시 말씀해 주세요.`);
      return;
    }

    // T-3 (single-syllable homophone, "이"→2): on a MEASUREMENT column (int/float) a lone
    // Sino-Korean syllable that doubles as a common non-number word ("이","사","오","일"…) was
    // committed at HIGH confidence with no challenge — but a bare single digit is essentially
    // never a real mm/Brix reading, so it is far more likely a particle/filler misheard as a
    // number. The existing single-char reject above only fires in noisyMode; this re-confirms
    // the lone-syllable homophone case REGARDLESS of noisyMode. Scope is deliberately narrow —
    // single alt, exactly one SINO syllable — so genuine numerals ("이백삼십삼") and arabic
    // single digits ("2") are untouched. Reuses the null→re-ask contract (no commit).
    if (currentCol && (currentCol.type === 'int' || currentCol.type === 'float')) {
      if (alts.length <= 1 && isAmbiguousSingleSyllable(text)) {
        logger.log({ type: 'stt_rejected_ambiguous_syllable', text, confidence, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
        recorderRef.current?.startClip();
        useSessionStore.getState().setRecognized('');
        await say(`${awaiting.name} 다시 말씀해 주세요.`);
        return;
      }
    }

    // Low confidence — re-ask
    if (confidence > 0 && confidence < minConfidence) {
      recorderRef.current?.startClip(); // restart clip
      useSessionStore.getState().setRecognized('');
      await say(`잘 못 들었습니다. ${awaiting.name} 다시 말씀해 주세요.`);
      return;
    }

    // Plain value — with alts fallback on parse failure (item 11)
    const col = getColById(awaiting.colId);
    let parsed = col ? parseValueForCol(col, text) : null;
    // v0.5.0 W4/W5: capture the parser's machine-readable fail reason from the PRIMARY
    // transcript (before the alts loop overwrites it) — tags stt_parse_failed below so the
    // next log analysis can split multi_numeric / decimal_fraction_lost re-asks from generic ones.
    const parseFailReason = parsed === null ? getLastParseFailReason() : null;
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
      logger.log({ type: 'stt_parse_failed', text, altsCount: alts.length, extra: parseFailReason ?? undefined, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
      recorderRef.current?.startClip(); // restart clip
      await say(`${awaiting.name} 다시 말씀해 주세요.`);
      return;
    }

    const myEpoch = ++epochRef.current;
    const sess = useSessionStore.getState();
    sess.setRowValue(awaiting.row, awaiting.colId, parsed);
    sess.setRecognized(parsed);
    sess.pushValueBurst(awaiting.name, parsed); // I-3: 화면 중앙 "항목 : 값" 버스트
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
    void persistSession();
    // Codex MEDIUM-4: clip for this field is being committed (stopped) — no longer active.
    // The next announceField will re-set it after its own startClip().
    activeClipRef.current = null;
    const clipStopPromise = recorderRef.current?.stopClip()
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
        const { blob: clipBlob, raw: rawBlob } = await clipStopPromise;
        logger.log({ type: 'clip', extra: `clip_stop_resolved:${clipBlob ? clipBlob.size : 'null'}`, sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
        if (!clipBlob) {
          logger.log({ type: 'error', extra: 'clip_empty', sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
          await resolveFailedCapture(savePromiseSelf);
          return;
        }
        if (clipBlob.size <= 200) {
          logger.log({ type: 'error', extra: `clip_too_small:${clipBlob.size}`, sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
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
      logger.log({
        type: 'trend', extra: 'trend_alert_fired',
        sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId,
        colName: awaiting.name, text, parsed, confidence, previousValue: String(v.prev),
      });
      // value 이벤트는 정상 커밋과 동일하게 남긴다 — 분석 파이프라인이 위반 여부와 무관하게 본다.
      logger.log({
        type: 'value',
        sessionId: sessionIdRef.current,
        row: awaiting.row, colId: awaiting.colId, colName: awaiting.name,
        text, parsed, confidence,
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
      const pctPart = v.pctText ? ` ${v.pctText}%` : ''; // prev=0이면 % 구절 생략
      const alertText =
        `${formatForTts(parsed)}. 직전 조사보다${pctPart} ` +
        `${v.direction === 'up' ? '증가' : '감소'}했습니다. 확인해주세요.`;
      useSessionStore.getState().setLastTts(alertText);
      await say(alertText);
      return; // advance 중단 — 해소는 handleFinal 상단의 trendConfirm 분기
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
      // #3 error-vs-intent: present only when this value re-commits a corrected cell.
      // previousValue (pre-modify) vs parsed (final) discriminates STT prefix-drop from re-entry.
      ...(awaiting.isModify && awaiting.previousValue != null
        ? { previousValue: awaiting.previousValue }
        : {}),
    });

    // Guard against race: another handleFinal ran while we were awaiting
    if (epochRef.current !== myEpoch) return;
    await advance();
  }, [advance, enterModifyMode, say, goNextRow, enterReentry, persistSession, evaluateTrend, archiveCellClip, armClipForCell]);

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
    sessionLabelRef.current = label?.trim() || undefined;
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
    sessionTodayRef.current = localTodayISO();
    // v0.8.0: 과거값 인덱스 프리페치(fire-and-forget) — 마스터 토글 제거 → 이상치 알람 규칙
    // (방향 trendRule 또는 변동률 pctThreshold)이 한 컬럼이라도 있고 Google 연결 시에만.
    // loadPastIndex는 모든 실패를 null로 해소하고 past_index_skip 텔레메트리만 남기므로
    // 세션 시작 흐름을 절대 막지 않는다. 셀 단위 검사(evaluateTrend)는 이 캐시만 읽는다.
    const anyAnomalyRule = s.columns.some(
      (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
    );
    if (anyAnomalyRule && getAccessToken()) prefetchPastIndex();
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
        // NOTE: session label intentionally NOT logged — buildAutoLabel derives it from the first
        // fixed auto column (농가명 = grower name), a PII vector. Reach is fully computable from
        // sessionId + appVersion + totalRows + completedRows. The label still lives on the Session
        // object (unchanged); it just stays out of telemetry events.
        noisyMode: s.noisyMode,
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
      onError: () => {},
    });
    setActiveController(ctrlRef.current);
    ctrlRef.current.start();

    await announceField(vc[0]);
    return true;
  }, [announceField, announceRowDiff, handleFinal, say]);

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
          noisyMode: settingsNow.noisyMode,
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
  const pause = useCallback(async () => {
    logger.log({ type: 'command', parsed: 'pause', extra: 'phase', sessionId: sessionIdRef.current, row: useSessionStore.getState().activeRow });
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
  const resume = useCallback(async () => {
    const sess = useSessionStore.getState();
    if (sess.phase !== 'paused') return;
    logger.log({ type: 'command', parsed: 'resume', extra: 'phase', sessionId: sessionIdRef.current, row: sess.activeRow });
    sess.setPhase('active');
    epochRef.current = 0;
    // Controller stays alive during pause (pause() no longer stops it).
    // Recreate only if it was somehow stopped (e.g., programmatic stop from outside).
    if (!ctrlRef.current) {
      ctrlRef.current = new SpeechController({
        onFinal: handleFinal,
        onError: () => {},
      });
      setActiveController(ctrlRef.current);
      ctrlRef.current.start();
    }
    // Recorder was disposed during pause — recreate for the resumed session.
    if (!recorderRef.current) {
      recorderRef.current = new AudioRecorder();
      await recorderRef.current.init().catch(() => {});
    }
    const vc = voiceColsList();
    const cur = vc[sess.activeColIdx];
    await say('재시작.');
    if (cur) await announceField(cur);
  }, [announceField, handleFinal, say]);

  // Keep resumeRef in sync so handleFinal can call resume without a circular dep.
  useEffect(() => { resumeRef.current = resume; }, [resume]);

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

  return { start, stop, restartFromCol, jumpToRow, gotoAdjacentRow, goNextRow, pause, resume, commitTouchValue, lastConfidenceRef };
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
