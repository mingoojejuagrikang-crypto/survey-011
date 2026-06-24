import { useDataStore } from '../stores/dataStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { appendRows, updateRow, parseSpreadsheetId } from './sheets';
import { saveSession } from './db';
import { getAccessToken } from './googleAuth';
import { logger } from './logger';
import { hasSyncState, recountSynced, legacySyncedIndexSet } from './sessionSync';
import type { Session, SessionRow } from '../types';

// Re-export so existing importers of recountSynced from sync.ts keep working (SSOT now in sessionSync).
export { recountSynced } from './sessionSync';

// C3 — module-level in-flight guard. A second syncSelected() call (double-tap, two tabs, retry
// racing the first) must never re-append a session that's still being pushed. We register each
// sessionId on entry and skip any session already in this set, releasing it in finally. This is a
// safety net independent of the DataScreen `busy` gate (which only blocks the same component).
const inFlightSessionIds = new Set<string>();

export interface SyncFailure {
  sessionId: string;
  sessionDate: string;
  sessionLabel?: string;
  reason: string;
}

export interface SyncReport {
  ok: number;
  failed: number;
  rows: number;
  /** v0.6.0 — rows UPDATED in place (locally edited after their first upload). */
  updatedRows: number;
  /** v0.6.0 — rows that fell back to append because their in-sheet row update failed (404/400). */
  fallbackAppended: number;
  message?: string;
  failures: SyncFailure[];
  /** Session IDs that were actually pushed to the sheet — only these are safe to auto-delete. */
  successIds: string[];
  /** v0.20.0 Phase 2 — structured "needs (re)login" signal so DataScreen can mount the
   *  LoginRequiredModal WITHOUT brittle string-matching on `message`/`reason`. Set true when:
   *   ① the preflight access-token is null (not logged in / token expired before sync), or
   *   ② an append/update throws a 401/403 (token expired MID-push — the common real-device cause
   *      per the v0.19.0 analysis). The caller surfaces the modal + resumes after re-login. */
  needsLogin?: boolean;
}

/** v0.20.0 — does this sheets-API error message carry an auth failure (expired/invalid token)?
 *  sheets.ts embeds the HTTP status in the thrown message (e.g. "행 일괄 추가 실패 (401): …").
 *  We read the structured status, not free Korean text, to stay robust to wording changes. */
function isAuthFailure(message: string): boolean {
  return /\b(401|403)\b/.test(message);
}

/**
 * Push the listed session IDs to the configured Sheets tab.
 *
 * v0.6.0 row-level re-sync (2 passes per session):
 *   Pass 1 (append): rows with syncState !== 'synced' && sheetRow === undefined — including
 *     skip placeholders (complete:false) — are appended in row.index order in one request.
 *     Each row gets its sheetRow from the append's updatedRange + syncState='synced'.
 *     If updatedRange can't be parsed, rows are left un-synced (retried next sync).
 *   Pass 2 (update): rows with syncState === 'dirty' && sheetRow !== undefined are PUT in place.
 *     A 404/400 update failure resets that row's sheetRow → it appends next sync (fallback) and
 *     emits a `sync_row_mismatch` event.
 */
export async function syncSelected(sessionIds: string[]): Promise<SyncReport> {
  const settings = useSettingsStore.getState();
  const data = useDataStore.getState();
  const report: SyncReport = {
    ok: 0, failed: 0, rows: 0, updatedRows: 0, fallbackAppended: 0, failures: [], successIds: [],
  };

  if (sessionIds.length === 0) {
    report.message = '선택된 세션이 없습니다.';
    return report;
  }
  if (!getAccessToken()) {
    // ② structured signal — DataScreen mounts LoginRequiredModal and resumes after re-login.
    report.needsLogin = true;
    report.message = 'Google 로그인이 필요합니다. 설정 탭에서 로그인 후 다시 시도하세요.';
    return report;
  }
  const spreadsheetId = parseSpreadsheetId(settings.sheetUrl);
  if (!spreadsheetId) {
    report.message = '스프레드시트 URL을 설정하세요.';
    return report;
  }
  if (!settings.sheetTab) {
    report.message = '시트 탭을 선택하세요.';
    return report;
  }
  const sheetTab = settings.sheetTab;

  for (const id of sessionIds) {
    // Read fresh each iteration so concurrent edits (voice/touch) to this or other sessions are
    // seen (F7). getState() returns the current snapshot, not the one captured at call time.
    const session = useDataStore.getState().sessions.find((x) => x.id === id);
    if (!session) {
      report.failed++;
      report.failures.push({
        sessionId: id, sessionDate: '?',
        reason: '세션을 찾을 수 없습니다.',
      });
      continue;
    }

    // C3 — skip a session that a concurrent sync is already pushing (double-append safety net).
    if (inFlightSessionIds.has(id)) {
      report.failed++;
      report.failures.push({
        sessionId: id, sessionDate: session.date, sessionLabel: session.label,
        reason: '이미 동기화가 진행 중인 세션입니다. 완료 후 다시 시도하세요.',
      });
      continue;
    }
    inFlightSessionIds.add(id);
    try {

    // C2 — don't upload an actively-recording session's partial/skip placeholder rows, and never
    // auto-delete it. persistSession sets finishedAt on every (even mid-session) save, so it can't
    // tell "in progress" from "done" — but the live sessionStore holds the id currently being
    // recorded. A session that is NOT the active recording id is treated as finished.
    const recordingId = useSessionStore.getState().sessionId;
    const recordingPhase = useSessionStore.getState().phase;
    const isActivelyRecording =
      recordingId === id && (recordingPhase === 'active' || recordingPhase === 'paused');

    const colIds = session.columns.map((c) => c.id);
    // Mutable working copy of rows; passes update sheetRow/syncState in place.
    let rows = [...session.rows];

    // Legacy sessions (no syncState anywhere) fall back to the old syncedRows-based behavior.
    // F5: syncedRows is a COUNT of completed rows, not an index. Treat the first `syncedRows`
    // COMPLETE rows (in index order) as already-synced — robust to interleaved skip
    // placeholders. We can't track them per-row (no sheetRow known), so dirty propagation only
    // starts for rows appended from now on.
    if (!hasSyncState(rows) && session.syncedRows > 0) {
      const legacySynced = legacySyncedIndexSet(rows, session.syncedRows);
      rows = rows.map((r) =>
        legacySynced.has(r.index) ? { ...r, syncState: 'synced' as const } : r,
      );
    }

    // Pass 1 — append: every never-appended row, in index order. Skip placeholders / partial rows
    // (complete:false) are appended as intentional blanks ONLY when the session has finished — an
    // actively-recording session may still fill or remove them, so uploading a half-empty in-flight
    // row is premature (C2). For finished sessions, blank-on-purpose rows upload as designed.
    const appendTargets = rows
      .filter((r) => r.syncState !== 'synced' && r.sheetRow === undefined)
      .filter((r) => r.complete || !isActivelyRecording)
      .sort((a, b) => a.index - b.index);

    let appended = 0;
    let updated = 0;
    let fallback = 0;
    let pushedAnything = false;
    let sessionFailed = false;
    let failReason = '';

    if (appendTargets.length > 0) {
      const matrix = appendTargets.map((row) => colIds.map((colId) => row.values[colId] ?? ''));
      try {
        const res = await appendRows(spreadsheetId, sheetTab, matrix);
        if (res.firstSheetRow != null) {
          // F4: only count the append as a real push when we could parse the landing position.
          pushedAnything = true;
          appended += appendTargets.length;
          // Map each appended row to its 1-based sheet row in order; mark synced.
          const sheetRowFor = new Map<number, number>();
          appendTargets.forEach((row, i) => sheetRowFor.set(row.index, res.firstSheetRow! + i));
          rows = rows.map((r) =>
            sheetRowFor.has(r.index)
              ? { ...r, sheetRow: sheetRowFor.get(r.index), syncState: 'synced' as const }
              : r,
          );
        } else {
          // C1: append HTTP succeeded (rows ARE in the sheet) but updatedRange was unparseable so we
          // don't know WHICH sheet rows. Old behavior failed the session to force a retry — but the
          // retry re-appended the same rows (duplicate), since the HTTP append had already landed.
          // New policy: the truth is "the data is in the sheet". Mark these rows synced WITHOUT a
          // sheetRow (we can't map them for in-place UPDATE). Count them as appended + pushed so the
          // session reaches successIds (backup/auto-delete proceed normally — no duplicate on retry).
          // If such a row is later edited, applyRowPatch demotes it to 'dirty' but it still has no
          // sheetRow → pass-1 re-appends it (value is current; the rare duplicate is accepted, see
          // KNOWN-ISSUES [SYNC-2]). The `sync_append_no_range` log is retained for telemetry.
          logger.log({
            type: 'app', extra: 'sync_append_no_range', sessionId: session.id, parsed: String(appendTargets.length),
          });
          pushedAnything = true;
          appended += appendTargets.length;
          const syncedNoRow = new Set(appendTargets.map((r) => r.index));
          rows = rows.map((r) =>
            syncedNoRow.has(r.index) ? { ...r, syncState: 'synced' as const } : r,
          );
        }
      } catch (err) {
        sessionFailed = true;
        failReason = (err as Error).message || '알 수 없는 오류';
      }
    }

    // Pass 2 — update: locally-edited rows already on the sheet. Skip if pass 1 already failed
    // (network is likely down — don't compound errors; this session is reported failed).
    if (!sessionFailed) {
      const updateTargets = rows
        .filter((r) => r.syncState === 'dirty' && r.sheetRow !== undefined)
        .sort((a, b) => a.index - b.index);
      for (const row of updateTargets) {
        const values = colIds.map((colId) => row.values[colId] ?? '');
        try {
          await updateRow(spreadsheetId, sheetTab, row.sheetRow!, values);
          pushedAnything = true;
          updated++;
          rows = rows.map((r) => (r.index === row.index ? { ...r, syncState: 'synced' as const } : r));
        } catch (err) {
          const msg = (err as Error).message || '';
          // 404/400: the in-sheet row is gone/moved → reset sheetRow so it re-appends next sync.
          if (/\b(400|404)\b/.test(msg)) {
            logger.log({
              type: 'app', extra: 'sync_row_mismatch', sessionId: session.id, row: row.index,
              colId: undefined, parsed: String(row.sheetRow),
            });
            rows = rows.map((r) =>
              r.index === row.index ? { ...r, sheetRow: undefined, syncState: 'dirty' as const } : r,
            );
            fallback++;
          } else {
            sessionFailed = true;
            failReason = msg || '행 갱신 실패';
            break;
          }
        }
      }
    }

    if (sessionFailed) {
      report.failed++;
      report.failures.push({
        sessionId: session.id,
        sessionDate: session.date,
        sessionLabel: session.label,
        reason: failReason,
      });
      // ② token expired MID-push (401/403) — flag the structured needsLogin signal so the caller
      // prompts re-login. We still record the failure so retry/diagnostics keep working.
      if (isAuthFailure(failReason)) report.needsLogin = true;
      console.error('sync failed for', session.id, failReason);
      continue;
    }

    // F7 — stale re-write race: voice input / cell edits may have landed in the store while the
    // append/update awaits ran. Re-read the LATEST session and merge only the sheetRow/syncState
    // we just determined onto its current rows (keyed by row.index). Values and the row list come
    // from the latest store copy (don't clobber concurrent edits). A row that the sync uploaded is
    // marked 'synced' only when its current value still equals what we pushed — otherwise it was
    // edited mid-flight and must stay 'dirty' so the next sync UPDATEs it.
    const freshData = useDataStore.getState();
    const latest = freshData.sessions.find((x) => x.id === id) ?? session;
    // What value did this sync push for each row that we attempted to append/update?
    // C1: a row may be synced WITHOUT a sheetRow (append HTTP ok but updatedRange unparseable) —
    // it must still be considered "pushed" so the mid-flight-edit check below can confirm it synced.
    const pushedValuesFor = new Map<number, Record<string, string>>();
    for (const r of rows) {
      if (r.syncState === 'synced') {
        pushedValuesFor.set(r.index, r.values);
      }
    }
    const decided = new Map<number, { sheetRow?: number; syncState?: 'synced' | 'dirty' }>();
    for (const r of rows) {
      decided.set(r.index, { sheetRow: r.sheetRow, syncState: r.syncState });
    }
    const mergedRows: SessionRow[] = latest.rows.map((r) => {
      const d = decided.get(r.index);
      if (!d) return r; // row appeared after sync started — leave as-is (un-synced)
      // sheetRow is the sync's authoritative decision (it may have SET it on append or CLEARED it
      // on a 404 fallback) — do not fall back to the stale store value, or a 404-reset row would
      // keep its old sheetRow and never re-append.
      const next: SessionRow = { ...r };
      if (d.sheetRow === undefined) delete next.sheetRow;
      else next.sheetRow = d.sheetRow;
      if (d.syncState === 'synced') {
        // Only confirm synced if the row's current values match what we actually pushed.
        const pushed = pushedValuesFor.get(r.index);
        const colIdsNow = latest.columns.map((c) => c.id);
        const unchanged =
          pushed != null && colIdsNow.every((c) => (r.values[c] ?? '') === (pushed[c] ?? ''));
        next.syncState = unchanged ? 'synced' : 'dirty';
      } else if (d.syncState === 'dirty') {
        // sheetRow was reset (404 fallback) or never confirmed → leave dirty for next sync.
        next.syncState = 'dirty';
      }
      return next;
    });
    const syncedRows = recountSynced(mergedRows);
    const updatedSession: Session = { ...latest, rows: mergedRows, syncedRows };
    data.upsertSession(updatedSession);
    await saveSession(updatedSession);

    report.updatedRows += updated;
    report.fallbackAppended += fallback;
    if (pushedAnything) {
      report.ok++;
      report.rows += appended;
      // C2 — successIds drives backup+auto-delete. NEVER auto-delete a session that is still being
      // recorded, even if some of its complete rows uploaded — the user may add more rows. (With
      // the current UI sync only runs on finished sessions; this guard makes the invariant explicit
      // and survives any future entry point that syncs a live session.)
      if (!isActivelyRecording) report.successIds.push(session.id);
    }

    } finally {
      // C3 — always release the in-flight lock, even on throw/continue.
      inFlightSessionIds.delete(id);
    }
  }
  return report;
}
