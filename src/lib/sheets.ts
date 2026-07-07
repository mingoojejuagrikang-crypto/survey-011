/**
 * Google Sheets API v4 helpers.
 * All requests use the user's access token from googleAuth.ts.
 */
import { getAccessToken } from './googleAuth';
import type { Column, DataType } from '../types';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface SheetInfo {
  title: string;
  sheetId: number;
  index: number;
}

export interface SpreadsheetMeta {
  spreadsheetId: string;
  title: string;
  sheets: SheetInfo[];
}

export function parseSpreadsheetId(url: string): string | null {
  const m = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  if (!token) throw new Error('Google 인증 토큰이 없습니다. 먼저 로그인하세요.');
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

export async function fetchSpreadsheetMeta(spreadsheetId: string): Promise<SpreadsheetMeta> {
  const r = await authFetch(`${API}/${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties`);
  if (!r.ok) throw new Error(`스프레드시트 조회 실패: ${r.status}`);
  const d = (await r.json()) as {
    spreadsheetId: string;
    properties: { title: string };
    sheets: { properties: { sheetId: number; title: string; index: number } }[];
  };
  return {
    spreadsheetId: d.spreadsheetId,
    title: d.properties.title,
    sheets: d.sheets.map((s) => ({
      title: s.properties.title,
      sheetId: s.properties.sheetId,
      index: s.properties.index,
    })),
  };
}

/**
 * Read first N rows of a sheet to:
 *  - get header (row 1)
 *  - sample data rows (rows 2..N) for type inference
 */
export async function fetchHeaderAndSample(
  spreadsheetId: string,
  sheetTitle: string,
  sampleRows = 1000,
): Promise<{ headers: string[]; sample: string[][] }> {
  const range = `${encodeURIComponent(sheetTitle)}!A1:Z${sampleRows + 1}`;
  const r = await authFetch(`${API}/${spreadsheetId}/values/${range}`);
  if (!r.ok) throw new Error(`헤더 조회 실패: ${r.status}`);
  const d = (await r.json()) as { values?: string[][] };
  const rows = d.values || [];
  const headers = rows[0] || [];
  const sample = rows.slice(1);
  return { headers, sample };
}

/**
 * Fetch JUST the header row (row 1) of a sheet tab — unbounded columns (no A1:Z clamp, unlike
 * fetchHeaderAndSample which also pulls up to `sampleRows` data rows for type inference).
 *
 * [SYNC-3] fix — sync.ts calls this ONCE per syncSelected() batch (not per session/row) to build a
 * name-based column mapping (columnMapping.ts) before every append/update, so values land in the
 * sheet's ACTUAL current column position instead of the local session's positional column order.
 */
export async function fetchHeaderRow(spreadsheetId: string, sheetTitle: string): Promise<string[]> {
  const range = encodeURIComponent(`${quoteSheetTitle(sheetTitle)}!1:1`);
  const r = await authFetch(`${API}/${spreadsheetId}/values/${range}`);
  if (!r.ok) {
    let body = '';
    try { body = await r.text(); } catch { /* ignore */ }
    throw new Error(`헤더 조회 실패 (HTTP ${r.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const d = (await r.json()) as { values?: string[][] };
  return d.values?.[0] ?? [];
}

/**
 * Fetch unique values of a single column (by zero-based index), frequency-sorted.
 * Used to surface options for text columns.
 */
export async function fetchColumnUniqueValues(
  spreadsheetId: string,
  sheetTitle: string,
  colIndex: number,
  maxRows = 500,
): Promise<string[]> {
  if (colIndex < 0 || colIndex > 25) return []; // simple A-Z support
  const colLetter = String.fromCharCode(65 + colIndex);
  const range = `${encodeURIComponent(sheetTitle)}!${colLetter}2:${colLetter}${maxRows + 1}`;
  const r = await authFetch(`${API}/${spreadsheetId}/values/${range}`);
  if (!r.ok) return [];
  const d = (await r.json()) as { values?: string[][] };
  const vals = (d.values || []).map((row) => (row[0] || '').toString().trim()).filter(Boolean);
  const freq = new Map<string, number>();
  for (const v of vals) freq.set(v, (freq.get(v) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([v]) => v);
}

/** Guess a DataType from a string sample value */
function guessType(value: string): DataType {
  const v = value.trim();
  if (!v) return 'text';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(v)) return 'date';
  if (/^-?\d+$/.test(v)) return 'int';
  if (/^-?\d+\.\d+$/.test(v)) return 'float';
  return 'text';
}

/**
 * Build Column[] from sheet header + sample data.
 * Heuristics:
 *  - If majority of samples are date/int/float → that type, mode 'voice' for numeric.
 *  - If text and unique values ≤ 8 → suggest 'options' with available pre-filled.
 *  - Otherwise → 'text', input 'auto', ttsAnnounce false.
 */
export function inferColumns(headers: string[], sample: string[][]): Column[] {
  const seenNames = new Map<string, number>();
  return headers.map((name, ci) => {
    const normalizedName = normalizeHeaderName(name || `열 ${ci + 1}`);
    const occurrence = (seenNames.get(normalizedName) ?? 0) + 1;
    seenNames.set(normalizedName, occurrence);
    const samples = sample.map((row) => row[ci]).filter(Boolean);
    let type: DataType = 'text';
    if (samples.length) {
      const counts: Record<DataType, number> = { date: 0, text: 0, int: 0, float: 0, options: 0, name: 0 };
      samples.forEach((v) => {
        counts[guessType(v)]++;
      });
      type = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as DataType) || 'text';
    }

    let auto: Column['auto'] = { kind: 'fixed', value: '' };
    let input: 'auto' | 'voice' | 'touch' = 'auto';
    let ttsAnnounce = false;
    let decimals: number | undefined;

    const uniqVals = new Set(samples.map((v) => v.trim()).filter(Boolean));

    if (type === 'int' || type === 'float') {
      const nums = samples.map(Number).filter((n) => !isNaN(n));

      if (type === 'float') {
        const maxDec = samples.reduce((max, s) => {
          const dot = s.indexOf('.');
          return dot >= 0 ? Math.max(max, s.length - dot - 1) : max;
        }, 1);
        decimals = maxDec;
      }

      if (uniqVals.size === 1) {
        input = 'auto';
        ttsAnnounce = false;
        auto = { kind: 'fixed', value: [...uniqVals][0] };
      } else if (nums.length >= 5) {
        const sorted = [...new Set(nums)].sort((a, b) => a - b);
        const isSeq = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
        if (isSeq) {
          input = 'auto';
          ttsAnnounce = true;
          auto = { kind: 'seq', from: sorted[0], to: sorted[sorted.length - 1] };
        } else {
          input = 'voice';
          ttsAnnounce = true;
          auto = { kind: 'fixed', value: '' };
        }
      } else {
        input = 'voice';
        ttsAnnounce = true;
        auto = { kind: 'fixed', value: '' };
      }
    } else if (type === 'date') {
      input = 'auto';
      ttsAnnounce = false;
      auto = { kind: 'fixed', value: '오늘' };
    } else if (type === 'text') {
      if (uniqVals.size === 1) {
        auto = { kind: 'fixed', value: [...uniqVals][0] };
      } else if (uniqVals.size > 0 && uniqVals.size <= 20) {
        type = 'options';
        const available = [...uniqVals];
        auto = { kind: 'options', available, selected: available.slice(0, 1) };
      } else {
        auto = { kind: 'fixed', value: '' };
      }
      input = 'auto';
      ttsAnnounce = false;
    }

    // 항목명 기반 의미 기본값(파일/시트 불문):
    //  - "비고" → 터치 입력(메모). 사용자가 자유롭게 메모.
    // (v0.4.3 롤백: "농가명"/"이름" → '이름' 데이터형 강제는 제거. 세션명은 이름 문자열로 식별.)
    const trimmed = (name || '').trim();
    if (trimmed === '비고') input = 'touch';

    return {
      id: stableColumnId(name || `열 ${ci + 1}`, occurrence),
      name: name || `열 ${ci + 1}`,
      type,
      input,
      ttsAnnounce,
      auto,
      decimals,
    };
  });
}

function normalizeHeaderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function stableColumnId(name: string, occurrence: number): string {
  const key = `${normalizeHeaderName(name)}#${occurrence}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `c${(hash >>> 0).toString(36)}`;
}

/**
 * Keep live/local session values addressable when the same sheet is re-analyzed.
 *
 * Pre-v0.30 columns used `Date.now()` IDs. If reconnecting the same sheet replaces every ID,
 * already-entered row values remain under the old IDs and later sync reads blanks. Preserve an
 * existing ID only when that column name is unique on both sides; duplicates fall back to the new
 * deterministic ID because name-only preservation would be ambiguous.
 */
export function preserveInferredColumnIds(inferred: Column[], existing: Column[]): Column[] {
  const existingByName = new Map<string, Column[]>();
  const inferredCounts = new Map<string, number>();
  for (const c of existing) {
    const key = normalizeHeaderName(c.name);
    existingByName.set(key, [...(existingByName.get(key) ?? []), c]);
  }
  for (const c of inferred) {
    const key = normalizeHeaderName(c.name);
    inferredCounts.set(key, (inferredCounts.get(key) ?? 0) + 1);
  }
  return inferred.map((c) => {
    const key = normalizeHeaderName(c.name);
    const candidates = existingByName.get(key) ?? [];
    if (candidates.length === 1 && inferredCounts.get(key) === 1) {
      return { ...c, id: candidates[0].id };
    }
    return c;
  });
}

/** Fetch all data rows of a sheet (header + body). Used for import. */
export async function fetchAllRows(
  spreadsheetId: string,
  sheetTitle: string,
  maxRows = 2000,
): Promise<{ headers: string[]; rows: string[][] }> {
  const range = `${encodeURIComponent(sheetTitle)}!A1:Z${maxRows + 1}`;
  const r = await authFetch(`${API}/${spreadsheetId}/values/${range}`);
  if (!r.ok) {
    let body = '';
    try { body = await r.text(); } catch { /* ignore */ }
    throw new Error(`시트 조회 실패 (HTTP ${r.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const d = (await r.json()) as { values?: string[][] };
  const all = d.values || [];
  return { headers: all[0] || [], rows: all.slice(1) };
}

/**
 * v0.7.0 — 탭 전체를 한 번의 GET으로 읽는다. range를 **따옴표 처리한 탭명만**으로 보내면
 * Sheets API가 데이터가 있는 전 범위를 돌려주므로, fetchAllRows의 A1:Z 바운드가 만들던
 * 26컬럼/2000행 클램프가 없다. 과거값 인덱스(pastValues) 전용 — 행 단위 재fetch 금지.
 */
export async function fetchAllRowsUnbounded(
  spreadsheetId: string,
  sheetTitle: string,
): Promise<{ headers: string[]; rows: string[][] }> {
  const range = encodeURIComponent(quoteSheetTitle(sheetTitle));
  const r = await authFetch(`${API}/${spreadsheetId}/values/${range}`);
  if (!r.ok) {
    let body = '';
    try { body = await r.text(); } catch { /* ignore */ }
    throw new Error(`시트 조회 실패 (HTTP ${r.status})${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const d = (await r.json()) as { values?: string[][] };
  const all = d.values || [];
  return { headers: all[0] || [], rows: all.slice(1) };
}

/** Append a single row to the sheet. */
export async function appendRow(
  spreadsheetId: string,
  sheetTitle: string,
  values: (string | number)[],
): Promise<void> {
  const range = `${encodeURIComponent(sheetTitle)}!A1`;
  const r = await authFetch(
    `${API}/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [values] }),
    },
  );
  if (!r.ok) throw new Error(`행 추가 실패: ${r.status}`);
}

/** Result of a batch append — carries the sheet position so callers can record
 *  each appended row's 1-based sheet row number for later row-level UPDATE.
 *  firstSheetRow is null when the API response's updatedRange could not be parsed
 *  (e.g. an unexpected payload) — callers must NOT mark such rows as synced then. */
export interface AppendResult {
  firstSheetRow: number | null;
  rowCount: number;
}

/**
 * Parse the 1-based first row from an A1 updatedRange like "Sheet1!A5:J7" or "'My Tab'!A5".
 * Returns null when the range can't be parsed (caller treats append as not-yet-tracked).
 */
export function parseUpdatedRangeFirstRow(updatedRange: string | undefined): number | null {
  if (!updatedRange) return null;
  // Strip the sheet-name prefix (everything up to and including the last '!').
  const bang = updatedRange.lastIndexOf('!');
  const a1 = bang >= 0 ? updatedRange.slice(bang + 1) : updatedRange;
  // First cell of the range, e.g. "A5" or "AB12" → capture the trailing row number.
  const m = a1.match(/^[A-Za-z]+(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Batch append for efficiency (one HTTP request per session sync).
 *  Returns the sheet position of the appended block (v0.6.0 row-level re-sync). */
export async function appendRows(
  spreadsheetId: string,
  sheetTitle: string,
  rows: (string | number)[][],
): Promise<AppendResult> {
  const range = `${encodeURIComponent(sheetTitle)}!A1`;
  const r = await authFetch(
    `${API}/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    },
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`행 일괄 추가 실패 (${r.status}): ${t}`);
  }
  // updates.updatedRange (e.g. "Sheet1!A5:J7") tells us where the block landed.
  let updatedRange: string | undefined;
  try {
    const d = (await r.json()) as { updates?: { updatedRange?: string } };
    updatedRange = d.updates?.updatedRange;
  } catch {
    updatedRange = undefined;
  }
  return { firstSheetRow: parseUpdatedRangeFirstRow(updatedRange), rowCount: rows.length };
}

/** Convert a 1-based column number to its A1 letters (1→A, 26→Z, 27→AA, 52→AZ, 53→BA …).
 *  F8: addColumn is unbounded but updateRow previously clamped to A:Z, silently dropping
 *  columns 27+. This multi-letter conversion removes that ceiling. */
export function colToA1(col: number): string {
  let n = Math.max(Math.floor(col), 1);
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Quote a sheet/tab title for an A1 range when it contains characters that break bare A1 parsing
 *  (`!`, spaces, quotes, etc.). Google A1 wraps such titles in single quotes and escapes any inner
 *  single quote by doubling it: `My!Tab` → `'My!Tab'`, `O'Brien` → `'O''Brien'`. C5 — without this,
 *  a tab named e.g. `Sheet!1` produced `Sheet!1!A5:B5`, which the API parsed as tab `Sheet`
 *  row-range `1!A5:B5` → a phantom range mismatch that pushed updateRow into a false append/duplicate.
 */
export function quoteSheetTitle(title: string): string {
  // Bare titles (letters/digits/underscore, not starting with a digit) need no quoting.
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(title)) return title;
  return `'${title.replace(/'/g, "''")}'`;
}

/** Build an A1 range for a single full row, e.g. ("측정", 7, 4) → "측정!A7:D7". */
function rowA1Range(sheetTitle: string, sheetRow: number, colCount: number): string {
  // colCount → last column letters (multi-letter for 27+; no clamp — F8).
  const lastLetter = colToA1(Math.max(colCount, 1));
  // C5 — quote the tab name so titles with '!' / spaces / quotes don't corrupt the range.
  return `${quoteSheetTitle(sheetTitle)}!A${sheetRow}:${lastLetter}${sheetRow}`;
}

/**
 * Overwrite a single existing sheet row in place (v0.6.0 row-level re-sync).
 * PUT values/{range}?valueInputOption=USER_ENTERED. Throws on non-2xx so the
 * caller can fall back to append on 404/400 (e.g. the row was deleted in-sheet).
 *
 * [SYNC-3] follow-up (v0.29.x) — sync.ts's UPDATE pass no longer calls this. A single contiguous
 * range PUT necessarily overwrites EVERY cell from A to the row's furthest mapped column,
 * including any sheet-only interstitial column in between that this app doesn't track — that
 * column's existing value would be silently blanked. See `updateCellsSparse` below, which
 * replaces this call site. Left in place (still exported, still correct for what it does) in
 * case a future caller genuinely wants a dense contiguous-range overwrite; not removed as dead
 * code because removing an exported helper is out of scope for this fix.
 */
export async function updateRow(
  spreadsheetId: string,
  sheetTitle: string,
  sheetRow: number,
  values: (string | number)[],
): Promise<void> {
  const a1 = rowA1Range(sheetTitle, sheetRow, values.length);
  const range = encodeURIComponent(a1);
  const r = await authFetch(
    `${API}/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [values] }),
    },
  );
  if (!r.ok) {
    const t = await r.text().catch(() => `HTTP ${r.status}`);
    throw new Error(`행 갱신 실패 (${r.status}): ${t}`);
  }
}

/**
 * [SYNC-3] follow-up — update ONLY the given cells of a single existing sheet row, via
 * `spreadsheets.values.batchUpdate` (ONE HTTP request, many individual single-cell ranges).
 *
 * Why this exists: `updateRow` PUTs one contiguous range (A{row}:{lastMappedCol}{row}), so any
 * sheet-only interstitial column *inside* that span that this app doesn't track gets overwritten
 * with '' (buildRowForMapping's dense, blank-padded array has no way to "skip" a cell mid-range).
 * `values.batchUpdate` accepts a `data` array of `{range, values}` entries, each targeting its OWN
 * cell — so a request built from only the mapped columns is physically incapable of naming (and
 * therefore touching) any column that isn't one of them. Interstitial columns aren't merely left
 * unmodified as a side effect; they never appear anywhere in the request.
 *
 * `cells` should come from `columnMapping.ts`'s `buildSparseCellsForMapping` — one entry per
 * mapped column, each carrying its 0-based header index and the value to write there.
 *
 * Throws on non-2xx (same 400/404 semantics as `updateRow`) so the caller can fall back to append
 * when the in-sheet row is gone/moved.
 */
export async function updateCellsSparse(
  spreadsheetId: string,
  sheetTitle: string,
  sheetRow: number,
  cells: { colIndex: number; value: string }[],
): Promise<void> {
  if (cells.length === 0) return; // nothing mapped — no-op, never send an empty batchUpdate
  const quotedTitle = quoteSheetTitle(sheetTitle);
  const data = cells.map(({ colIndex, value }) => {
    const colLetter = colToA1(colIndex + 1); // colIndex is 0-based; colToA1 expects 1-based
    return {
      range: `${quotedTitle}!${colLetter}${sheetRow}:${colLetter}${sheetRow}`,
      values: [[value]],
    };
  });
  const r = await authFetch(
    `${API}/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    },
  );
  if (!r.ok) {
    const t = await r.text().catch(() => `HTTP ${r.status}`);
    throw new Error(`행 갱신 실패 (${r.status}): ${t}`);
  }
}
