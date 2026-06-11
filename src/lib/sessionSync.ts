/**
 * v0.6.0 — shared row-level sync helpers (SSOT).
 *
 * Extracted from sync.ts / dataStore.ts / DataScreen.tsx where the same predicates were
 * duplicated (review F5/F6/F10 cleanup). Pure functions, no store/Drive/import.meta deps →
 * unit-testable under Node (tests/sessionSync.spec.ts).
 */
import type { SessionRow } from '../types';

/** True if any row carries per-row sync state (v0.6.0+ session). Legacy sessions return false
 *  and fall back to the syncedRows counter. */
export function hasSyncState(rows: SessionRow[]): boolean {
  return rows.some((r) => r.syncState !== undefined);
}

/** Recompute the legacy syncedRows counter from per-row syncState (hub for back-compat).
 *  A row counts only when it is BOTH synced AND complete (skip placeholders never count). */
export function recountSynced(rows: SessionRow[]): number {
  return rows.filter((r) => r.syncState === 'synced' && r.complete).length;
}

/**
 * Legacy synced-set (F5/F6): which complete rows are considered already-uploaded when a
 * session predates per-row syncState. The counter is a COUNT of completed rows, never an index —
 * so we sort completed rows by index and take the first `syncedRows` of them. This is robust to
 * skip placeholders (incomplete rows) interleaved in the index sequence.
 *
 * Returns a Set of row.index values that should be treated as synced.
 */
export function legacySyncedIndexSet(rows: SessionRow[], syncedRows: number): Set<number> {
  if (syncedRows <= 0) return new Set();
  const completeSorted = rows
    .filter((r) => r.complete)
    .sort((a, b) => a.index - b.index);
  return new Set(completeSorted.slice(0, syncedRows).map((r) => r.index));
}

/**
 * Legacy demotion (F6, dataStore path): when an already-synced legacy row is edited we cannot
 * UPDATE it in place (no sheetRow), so it must re-append. We express that by dropping the
 * syncedRows counter to the number of completed rows that come BEFORE the edited row in index
 * order — i.e. "re-upload from this row down". This is a COUNT, not an index, so it stays correct
 * when skip placeholders are interleaved.
 */
export function legacyDemoteCount(rows: SessionRow[], editedRowIndex: number, syncedRows: number): number {
  const completedBefore = rows.filter((r) => r.complete && r.index < editedRowIndex).length;
  return Math.max(0, Math.min(syncedRows, completedBefore));
}
