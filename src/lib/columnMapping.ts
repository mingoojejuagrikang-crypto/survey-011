/**
 * Header-name-based column mapping for Sheets sync — [SYNC-3] fix.
 *
 * Pure functions, no DOM/browser deps (imported directly in Node tests, same pattern as
 * koreanNum.ts).
 *
 * Root cause this replaces: sync.ts used to build the append/update value arrays purely from
 * `session.columns` LOCAL order (`colIds.map(...)`) — a positional write with no cross-check
 * against the sheet's actual header row. If the local session's column schema (created at an
 * earlier point in time) drifts from the sheet's real, current header (columns added/reordered
 * directly in the sheet), values silently land in the wrong physical column. Real-device repro:
 * 2026-07-07 v0.28.0 A5 (Sonar) — local 6-column session synced against a real 10-column sheet;
 * values landed 2 columns over (shifted right), leaving 3 columns blank instead of the intended
 * ones.
 *
 * Fix: match each local column to the sheet's CURRENT header by NAME, not by position. A column
 * whose name isn't found in the header is treated as "not present in this sheet yet" — its value
 * is intentionally never written to any cell (no positional guess), and the caller is expected to
 * surface that as a warning (see sync.ts `sync_column_missing_in_sheet`). This guarantees "no
 * silent misalignment" — a value either lands in its named column, or nowhere; it never lands in
 * someone else's column.
 */
import type { Column } from '../types';

export interface ColumnMapping {
  /** colId -> 0-based index in the sheet's ACTUAL header row (matched by exact, trimmed name). */
  indexForColId: Map<string, number>;
  /** Local column names that do NOT exist in the current sheet header — their values are
   *  intentionally skipped (never written) until the header/schema is reconciled. */
  missingNames: string[];
}

/** Match local `columns` (session schema) against the sheet's live `headers` row, by name. */
export function mapColumnsToHeader(columns: Pick<Column, 'id' | 'name'>[], headers: string[]): ColumnMapping {
  const normalizedHeaders = headers.map((h) => (h ?? '').trim());
  const indexForColId = new Map<string, number>();
  const missingNames: string[] = [];
  for (const c of columns) {
    const name = (c.name ?? '').trim();
    const idx = normalizedHeaders.indexOf(name);
    if (idx >= 0) indexForColId.set(c.id, idx);
    else missingNames.push(c.name);
  }
  return { indexForColId, missingNames };
}

/**
 * Build one sheet row's value array from a mapping, sized to exactly cover the columns this app
 * actually manages (0 .. highest matched header index) — no further. Any header column at or
 * beyond that span that ISN'T one of our mapped columns gets written as '' — this DENSE, blank-
 * padded shape is intended for APPEND only (a brand-new row has no prior data to lose, so a blank
 * interstitial cell is harmless). Trailing header columns beyond our own furthest mapped column
 * are left completely untouched (the array simply doesn't extend that far), which is the common
 * case (new unrelated columns appended to the right of this app's block).
 *
 * Do NOT use this for UPDATE of an existing row — a sheet-only interstitial column inside the
 * matched span would be silently blanked. The UPDATE path uses `buildSparseCellsForMapping`
 * instead (see below), which never represents an unmapped column at all. See KNOWN-ISSUES
 * [SYNC-3] for the incident this distinction closes.
 *
 * Returns an empty array when the mapping has zero matches (no local column name found anywhere
 * in the header) — callers MUST treat that as a hard failure (see sync.ts), not a "successful"
 * blank-row write; writing a fully-blank row into a production sheet on a total schema mismatch
 * would be its own silent-corruption footgun.
 */
export function buildRowForMapping(
  values: Record<string, string>,
  mapping: ColumnMapping,
): string[] {
  if (mapping.indexForColId.size === 0) return [];
  let maxIdx = -1;
  for (const idx of mapping.indexForColId.values()) maxIdx = Math.max(maxIdx, idx);
  const row = new Array<string>(maxIdx + 1).fill('');
  for (const [colId, idx] of mapping.indexForColId) {
    row[idx] = values[colId] ?? '';
  }
  return row;
}

/** One (header column index, value) pair for a sparse, per-cell write. */
export interface SparseCell {
  /** 0-based index in the sheet's header row (same space as ColumnMapping.indexForColId). */
  colIndex: number;
  value: string;
}

/**
 * [SYNC-3] follow-up — build the list of (colIndex, value) pairs for ONLY the columns this app
 * actually maps, for the UPDATE path (sync.ts -> sheets.ts's updateCellsSparse).
 *
 * Unlike buildRowForMapping (which returns a DENSE array padded with '' at every unmapped
 * position *within the matched span* — harmless for a brand-new appended row, but a silent
 * data-loss risk for an UPDATE of an existing row if a sheet-only interstitial column sits inside
 * that span), this returns a SPARSE list that names EXACTLY the mapped column indices. Any
 * interstitial/unmapped index is simply absent from the returned list — there is no "blank slot"
 * to accidentally write. The caller builds a Sheets `values.batchUpdate` request from exactly this
 * list, so an interstitial column is not merely "written with its old value" — it is never named
 * in the request at all, making it physically impossible for that write to touch it.
 */
export function buildSparseCellsForMapping(
  values: Record<string, string>,
  mapping: ColumnMapping,
): SparseCell[] {
  const cells: SparseCell[] = [];
  for (const [colId, idx] of mapping.indexForColId) {
    cells.push({ colIndex: idx, value: values[colId] ?? '' });
  }
  return cells;
}
