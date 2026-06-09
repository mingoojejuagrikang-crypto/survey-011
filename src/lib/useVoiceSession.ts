import { useCallback, useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { useDataStore } from '../stores/dataStore';
import { parseKoreanNumber, detectCommand, extractModifyValue, isAmbiguousSingleSyllable } from './koreanNum';
import { VOICE_COMMANDS } from './voiceCommands';
import { SpeechController, speak, cancelTts, isSpeechSupported, formatForTts, warmupTts, setActiveController, setPreferredVoiceName } from './speech';
import { computeTotalRows, buildCyclingValues, nestedAutoValue } from './autoValue';
import type { Column, Session, SessionRow } from '../types';
import { saveSession, saveAudioClip, loadAudioClip } from './db';
import { AudioRecorder } from './audioRecorder';
import { logger } from './logger';


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
  const preserveCommandClip = useCallback((row: number, colId: string): void => {
    const rec = recorderRef.current;
    if (!rec) return;
    // Detach the active clip's stop now, before enterModifyMode's announceField starts a new one.
    const stopPromise = rec.stopClip();
    activeClipRef.current = null;
    const cellKey = `${row}:${colId}`;
    const idx = (cmdClipRef.current[cellKey] ?? 0) + 1;
    cmdClipRef.current[cellKey] = idx;
    const cmdKey = `${sessionIdRef.current}:${row}:${colId}:cmd${idx}`;
    const savePromise = (async () => {
      try {
        const blob = await stopPromise;
        if (!blob || blob.size <= 200) {
          logger.log({ type: 'clip', extra: `clip_cmd_empty:${blob ? blob.size : 'null'}`, kind: 'command', sessionId: sessionIdRef.current, row, colId });
          return;
        }
        await saveAudioClip(cmdKey, blob);
        logger.log({ type: 'clip', extra: 'clip_preserved', kind: 'command', attempt: idx, clipKey: cmdKey, sessionId: sessionIdRef.current, row, colId });
      } catch (e) {
        logger.log({ type: 'error', extra: `clip_cmd_save_failed:${String((e as Error)?.message ?? e)}`, sessionId: sessionIdRef.current, row, colId });
      }
    })();
    pendingClipSavesRef.current.add(savePromise);
    void savePromise.finally(() => pendingClipSavesRef.current.delete(savePromise));
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

  const findNextIncompleteRow = (start: number, total: number, vCols: Column[]): number | null => {
    for (let r = start; r <= total; r++) {
      if (!isRowVoiceComplete(r, vCols)) return r;
    }
    for (let r = 1; r < start; r++) {
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
    if (completed.length === 0 && !backup && !activeHasData) return;
    const buildRow = (r: number, complete: boolean): SessionRow => {
      const auto = buildCyclingValues(settings.columns, r);
      const fixedAndAuto = autoNonCyclingValues(settings.columns, r);
      const voiceVals = sess.getRowValues(r);
      // Merge stored clips (from previous persists) with newly recorded clips
      const existingSession = useDataStore.getState().sessions.find(
        (s) => s.id === sessionIdRef.current,
      );
      const existingRow = existingSession?.rows.find((row) => row.index === r);
      const mergedClips = {
        ...(existingRow?.audioClips ?? {}),
        ...(pendingClipsRef.current[r] ?? {}),
      };
      return {
        index: r,
        values: { ...fixedAndAuto, ...auto, ...voiceVals },
        complete,
        audioClips: Object.keys(mergedClips).length > 0 ? mergedClips : undefined,
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
    rows.sort((a, b) => a.index - b.index);
    // D-2 (RACE-7): prefer the ref, but fall back to the store-persisted id/startedAt so a session
    // that lost its hook ref (unmount during pause) still persists with a valid id and a finite
    // startedAt instead of `id:''` + `startedAt:NaN`.
    const resolvedId = sessionIdRef.current || sess.sessionId;
    const resolvedStartedAt =
      sess.startedAt || parseInt(resolvedId.replace('sess_', ''), 10) || Date.now();
    const session: Session = {
      id: resolvedId,
      date: new Date().toISOString().slice(0, 10),
      label: sessionLabelRef.current || sess.sessionLabel,
      columns: settings.columns,
      rows,
      completedRows: rows.filter((r) => r.complete).length,
      syncedRows: 0,
      startedAt: resolvedStartedAt,
      finishedAt: Date.now(),
    };
    try { await saveSession(session); } catch { /* ignore */ }
    useDataStore.getState().upsertSession(session);
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
      clipStartRowRef.current = row;
      clipStartColIdRef.current = col.id;
      recorderRef.current?.startClip();
      activeClipRef.current = { row, colId: col.id };
      const hint = opts?.isModify
        ? `수정. ${col.name} 다시 말씀해 주세요.`
        : `${col.name} 말씀해 주세요.`;
      useSessionStore.getState().setLastTts(hint);
      await say(opts?.isModify ? `수정. ${col.name}.` : `${col.name}.`, false);
    },
    [say],
  );

  // ── progression ────────────────────────────────────────────
  /** Move to next voice col in current row, or finalize row + jump to next target. */
  const advance = useCallback(async () => {
    const startEpoch = epochRef.current;
    const settings = useSettingsStore.getState();
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const row = sess.activeRow;
    const total = computeTotalRows(settings.columns);

    // Still voice cols in this row?
    const nextIdx = sess.activeColIdx + 1;
    if (nextIdx < vc.length) {
      // Skip cols already filled with non-empty values (empty string = cleared by modify)
      const values = sess.getRowValues(row);
      let target = nextIdx;
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

    // If returnRow set (came from modify/jump), go back
    const ret = sess.returnRow;
    const retCol = sess.returnColIdx;
    if (ret != null && ret !== row) {
      sess.setReturn(null, null);
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

    // Otherwise find next incomplete row
    const next = findNextIncompleteRow(row + 1, total, vc);
    if (next === null) {
      sess.setPhase('done');
      await say('모든 입력이 완료되었습니다.');
      await stop(false);
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
  }, [announceField, announceRowComplete, announceRowDiff, persistSession, say]);

  // ── modify (cross-row) ─────────────────────────────────────
  const enterModifyMode = useCallback(async (preExtractedValue?: string) => {
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const curRow = sess.activeRow;
    const curIdx = sess.activeColIdx;

    // Find previous voice col (could be in previous row)
    let targetRow = curRow;
    let targetIdx = curIdx - 1;
    if (targetIdx < 0) {
      if (curRow <= 1) {
        // No previous — treat as redo current
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
        // Direct modify는 새 값 클립을 재녹음하지 않지만, 직전 호출된 preserveCommandClip이 수정
        // 발화("수정 82.7" — 곧 새 값을 담은 음성)를 awaiting 셀의 :cmd 키로 저장해 둔다. 이전처럼
        // 셀 포인터를 비우면(재생버튼 소멸) 대신, 그 수정 발화 클립을 셀에 재연결한다 → 재생버튼
        // 유지 + 재생 내용이 새 값과 일치. 이전(잘못 인식된) 값은 archive(:a) 키로 ZIP에 그대로 보존.
        const awaitingColId = vc[curIdx]?.id;
        const cmdIdx = awaitingColId ? cmdClipRef.current[`${curRow}:${awaitingColId}`] : undefined;
        const cmdKey =
          cmdIdx && awaitingColId
            ? `${sessionIdRef.current}:${curRow}:${awaitingColId}:cmd${cmdIdx}`
            : null;
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
          const updatedRow = {
            ...existingRow,
            values: { ...existingRow.values, [target.id]: parsed },
            audioClips: Object.keys(nextClips).length > 0 ? nextClips : undefined,
          };
          const updatedSession = {
            ...existing,
            rows: existing.rows.map((r) => (r.index === targetRow ? updatedRow : r)),
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

  // ── public: move to the previous/next row (I-2: 이전행/다음행, 버튼·음성 공용) ──
  // Review/edit semantics: jumpToRow(setReturn:true) so finishing the visited row returns the
  // flow to where the user was. On a boundary we REPROMPT instead of silently stalling (REVIEW-4).
  const gotoAdjacentRow = useCallback(
    async (delta: -1 | 1) => {
      const sess = useSessionStore.getState();
      const settings = useSettingsStore.getState();
      const total = computeTotalRows(settings.columns);
      const target = sess.activeRow + delta;
      cancelTts();
      if (target < 1 || target > total) {
        epochRef.current++;
        const msg = delta < 0 ? '첫 행입니다.' : '마지막 행입니다.';
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
    if (cmd === 'end') {
      cancelTts();
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
      await gotoAdjacentRow(-1);
      return;
    }
    if (cmd === 'nextRow') {
      await gotoAdjacentRow(1);
      return;
    }
    if (cmd === 'modify') {
      cancelTts();
      // Preserve the '수정'/'정정' utterance itself (spoken into the awaiting cell's active clip)
      // before enterModifyMode starts a fresh clip. Background save — does not block the flow.
      // NOTE for analysis: this command clip is logged against the AWAITING cell; the cell it
      // CORRECTS is the previous voice column (resolved inside enterModifyMode).
      preserveCommandClip(awaiting.row, awaiting.colId);
      if (awaiting.isModify) {
        await say(`${awaiting.name} 다시 말씀해 주세요.`);
        return;
      }
      const modifyVal = extractModifyValue(text);
      await enterModifyMode(modifyVal || undefined);
      return;
    }
    if (cmd === 'cancel') {
      cancelTts();
      useSessionStore.getState().setRecognized('');
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

    const noisyMode = useSettingsStore.getState().noisyMode;
    const minConfidence = noisyMode ? 0.80 : 0.65;

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
      logger.log({ type: 'stt_parse_failed', text, altsCount: alts.length, sessionId: sessionIdRef.current, row: awaiting.row, colId: awaiting.colId });
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

    // v0.10 클립 누락 수정: stopClip을 echo TTS 이전에 시작 (병렬 실행)
    // 이전 버그: await speak(echo) 동안 마이크 stream이 idle → 다음 startClip이 호출되면 이전 슬롯 손실
    const clipKey = `${sessionIdRef.current}:${awaiting.row}:${awaiting.colId}`;
    const clipAwaitingRow = awaiting.row;
    const clipAwaitingColId = awaiting.colId;
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
    const clipStopPromise = recorderRef.current?.stopClip() ?? Promise.resolve(null);
    const savePromise = (async () => {
      try {
        logger.log({ type: 'clip', extra: 'clip_stop_await', sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
        const clipBlob = await clipStopPromise;
        logger.log({ type: 'clip', extra: `clip_stop_resolved:${clipBlob ? clipBlob.size : 'null'}`, sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
        if (!clipBlob) {
          logger.log({ type: 'error', extra: 'clip_empty', sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
          const m = pendingClipsRef.current[clipAwaitingRow];
          if (m && m[clipAwaitingColId] === clipKey) delete m[clipAwaitingColId];
          return;
        }
        if (clipBlob.size <= 200) {
          logger.log({ type: 'error', extra: `clip_too_small:${clipBlob.size}`, sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
          const m = pendingClipsRef.current[clipAwaitingRow];
          if (m && m[clipAwaitingColId] === clipKey) delete m[clipAwaitingColId];
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
        logger.log({ type: 'clip', extra: `clip_saved:${clipBlob.size}`, sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
      } catch (e) {
        logger.log({ type: 'error', extra: `clip_save_failed:${String((e as Error)?.message ?? e)}`, sessionId: sessionIdRef.current, row: clipAwaitingRow, colId: clipAwaitingColId });
        const m = pendingClipsRef.current[clipAwaitingRow];
        if (m && m[clipAwaitingColId] === clipKey) delete m[clipAwaitingColId];
      }
    })();
    pendingClipSavesRef.current.add(savePromise);
    void savePromise.finally(() => pendingClipSavesRef.current.delete(savePromise));

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
  }, [advance, enterModifyMode, say, gotoAdjacentRow, persistSession]);

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
    epochRef.current = 0;
    pendingClipsRef.current = {};
    clipAttemptRef.current = {};
    cmdClipRef.current = {};
    correctionBackupRef.current = null;
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
    // dataStore의 기존 세션을 찾아 즉시 patch.
    const dataStore = useDataStore.getState();
    const existing = dataStore.sessions.find((s) => s.id === sessionIdRef.current);
    if (existing) {
      const updatedRows = existing.rows.map((r) =>
        r.index === row ? { ...r, values: { ...r.values, [colId]: value } } : r,
      );
      const updatedSession = { ...existing, rows: updatedRows };
      dataStore.upsertSession(updatedSession);
      try { await saveSession(updatedSession); } catch { /* ignore */ }
    }
    // 행이 아직 완료된 적이 없으면(persistSession 한 번도 호출 안 됨) sessionStore만 업데이트.
    // 다음 행 진행 시 persistSession에서 자연스럽게 반영됨.
  }, []);

  return { start, stop, restartFromCol, jumpToRow, gotoAdjacentRow, pause, resume, commitTouchValue, lastConfidenceRef };
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
