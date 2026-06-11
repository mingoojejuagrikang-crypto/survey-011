import { create } from 'zustand';
import type { Column, Session, SessionRow } from '../types';
import { hasSyncState, recountSynced, legacyDemoteCount } from '../lib/sessionSync';

/**
 * C4 — a row is "complete" when every voice-input column has a non-empty value (mirrors
 * useVoiceSession.isRowVoiceComplete, the SSOT of completeness during recording). Auto/touch
 * columns don't gate completeness. With no voice columns at all, a row with any value is complete.
 * Used to flip a skip-placeholder (complete:false) to complete:true once the user fills its blanks
 * in the 데이터탭, so the pending/completedRows counters and the sync's row classification stay right.
 */
export function isRowComplete(row: SessionRow, columns: Column[]): boolean {
  const voiceCols = columns.filter((c) => c.input === 'voice');
  if (voiceCols.length === 0) {
    return Object.values(row.values).some((v) => v !== undefined && v !== '');
  }
  return voiceCols.every((c) => {
    const v = row.values[c.id];
    return v !== undefined && v !== '';
  });
}

interface DataState {
  sessions: Session[];
  expandedSessionId: string | null;
  hydrated: boolean;
  /** Non-null when the last IndexedDB hydration FAILED (carries the error message).
   *  Lets DataScreen distinguish a genuine empty list from a load failure (D-1). */
  hydrationError: string | null;

  setSessions: (s: Session[]) => void;
  upsertSession: (s: Session) => void;
  removeSession: (id: string) => void;
  toggleExpand: (id: string) => void;
  markSynced: (id: string, count: number) => void;
  setHydrated: (b: boolean) => void;
  setHydrationError: (msg: string | null) => void;
  /**
   * Edit a single cell. Delegates to patchRowValues so the "value changed ⇒ synced→dirty"
   * invariant lives in exactly one place (F2/F3).
   */
  updateRowValue: (sessionId: string, rowIndex: number, colId: string, value: string) => void;
  /**
   * F2/F3 — single SSOT helper for changing a row's values. Applies the row-level re-sync
   * invariant: any column whose value actually changes demotes a 'synced' row to 'dirty' (so
   * the next sync UPDATEs its sheet row in place instead of leaving the edit stranded). Legacy
   * rows (no syncState) demote the syncedRows counter so they re-append. syncedRows is then
   * recomputed from per-row syncState for back-compat with the UI pending counts.
   *
   * Returns the updated Session (or null if not found) so callers can persist it to IDB.
   */
  patchRowValues: (
    sessionId: string,
    rowIndex: number,
    values: Record<string, string>,
  ) => Session | null;
}

/** Apply a values patch to one row, enforcing the synced→dirty invariant. Pure — shared by
 *  patchRowValues (store) and useVoiceSession.persistSession's row merge (F1). */
export function applyRowPatch(row: SessionRow, values: Record<string, string>): SessionRow {
  let changed = false;
  for (const [colId, v] of Object.entries(values)) {
    if ((row.values[colId] ?? '') !== v) { changed = true; break; }
  }
  if (!changed) return row;
  const next: SessionRow = { ...row, values: { ...row.values, ...values } };
  if (next.syncState === 'synced') next.syncState = 'dirty';
  return next;
}

export const useDataStore = create<DataState>((set) => ({
  sessions: [],
  expandedSessionId: null,
  hydrated: false,
  hydrationError: null,

  setSessions: (sessions) => set({ sessions }),
  upsertSession: (s) =>
    set((state) => {
      const idx = state.sessions.findIndex((x) => x.id === s.id);
      if (idx === -1) return { sessions: [s, ...state.sessions] };
      const copy = [...state.sessions];
      copy[idx] = s;
      return { sessions: copy };
    }),
  removeSession: (id) =>
    set((state) => ({ sessions: state.sessions.filter((s) => s.id !== id) })),
  toggleExpand: (id) =>
    set((state) => ({ expandedSessionId: state.expandedSessionId === id ? null : id })),
  markSynced: (id, count) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, syncedRows: count } : s)),
    })),
  setHydrated: (hydrated) => set({ hydrated }),
  setHydrationError: (hydrationError) => set({ hydrationError }),
  updateRowValue: (sessionId, rowIndex, colId, value) => {
    useDataStore.getState().patchRowValues(sessionId, rowIndex, { [colId]: value });
  },
  patchRowValues: (sessionId, rowIndex, values) => {
    let updated: Session | null = null;
    set((state) => {
      const sessions = state.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        // F2/F3 — value changed ⇒ synced→dirty (applyRowPatch). Track whether the edited row was
        // actually mutated so the legacy counter only demotes on a real change.
        const legacy = !hasSyncState(s.rows);
        let mutated = false;
        const rows = s.rows.map((r) => {
          if (r.index !== rowIndex) return r;
          const patched = applyRowPatch(r, values);
          if (patched === r) return r;
          mutated = true;
          // C4 — recompute completeness from the new values. Filling a skip-placeholder's voice
          // cells in the 데이터탭 flips complete:false → true (the gap is closed); clearing a
          // required cell flips it back. v0.5.0 left `complete` frozen here, so a filled placeholder
          // stayed complete:false → it never counted toward completedRows and the sync still treated
          // it as a skip placeholder.
          const complete = isRowComplete(patched, s.columns);
          return complete === patched.complete ? patched : { ...patched, complete };
        });
        const syncedRows = legacy
          // Legacy rows have no sheetRow → can't UPDATE in place; drop the counter to the number
          // of completed rows BEFORE this one so it re-appends (F6: count, not index).
          ? (mutated ? legacyDemoteCount(s.rows, rowIndex, s.syncedRows) : s.syncedRows)
          : recountSynced(rows);
        // C4 — keep completedRows in sync with the per-row complete flags (skip placeholders
        // excluded). Drives the pending badge and "N행" labels.
        const completedRows = rows.filter((r) => r.complete).length;
        const next = { ...s, rows, completedRows, syncedRows };
        updated = next;
        return next;
      });
      return { sessions };
    });
    return updated;
  },
}));
