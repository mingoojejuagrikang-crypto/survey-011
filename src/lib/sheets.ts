/**
 * Google Sheets API v4 helpers.
 * All requests use the user's access token from googleAuth.ts.
 *
 * v0.34.0 C9 예외 — 과거값 인덱스 읽기(fetchAllRowsUnbounded)만 토큰 부재 시 API key 폴백
 * (`fetchValuesReadonly`)을 쓴다. 쓰기·메타 경로(authFetch)는 무수정: API key는 공개 시트
 * '읽기'만 가능하고, 쓰기 경로에 key가 새면 401이 403으로 바뀌어 [AUTH-7] 계열 재로그인
 * 유도(LoginRequiredModal, sync-token-expiry.spec)가 무너진다.
 *
 * [ENV-12] 2026-08-15 — **컬럼 유추 도메인은 `sheetsInfer.ts`로 분리했다**(순수 함수:
 * `inferColumns`·`preserveInferredColumnIds`·`uniqueValuesRecentFirst`·`stableColumnId`).
 * 경계는 네트워크 경계다 — 이 파일은 HTTP를 아는 코드만 남긴다.
 */
import { getAccessToken } from './googleAuth';
import { getPickerApiKey } from './drivePicker';
import { uniqueValuesRecentFirst } from './sheetsInfer';

/** [ENV-12] 분리 전 호출부의 import 경로를 그대로 보존하는 재수출. **단방향**이다 —
 *  `sheetsInfer.ts`는 이 파일을 import하지 않으므로 `[LOGEVENTS-CYCLE-1]` 형태의 배럴 순환이
 *  생기지 않는다. 새 코드는 순수 함수를 `./sheetsInfer`에서 직접 가져오는 쪽이 낫다. */
export { inferColumns, preserveInferredColumnIds } from './sheetsInfer';

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

// ── v0.34.0 C9 — 읽기 전용 폴백 (과거값 인덱스 경로 격리) ────────────────────

export type ReadonlyAuth = 'token' | 'apikey';

/**
 * 읽기 전용 values GET 요청 계획(순수 함수 — tests/v034-past-index-apikey.spec.ts 단위 테스트 대상).
 *  - 토큰 있으면 Bearer 헤더(auth='token') — key는 URL에 싣지 않는다(불필요 노출 방지).
 *  - 토큰 없고 key 있으면 `?key=` 쿼리(auth='apikey') — "링크가 있는 모든 사용자" 공개 시트는
 *    API key만으로 읽기가 가능하다. 비공개 시트면 403 → 호출자의 기존 오류 경로가 흡수.
 *  - 둘 다 없으면 null — 호출자가 미로그인 skip을 결정한다.
 */
export function planValuesReadonly(
  spreadsheetId: string,
  range: string,
  token: string | null,
  apiKey: string | null,
): { url: string; headers?: Record<string, string>; auth: ReadonlyAuth } | null {
  const base = `${API}/${spreadsheetId}/values/${range}`;
  if (token) return { url: base, headers: { Authorization: `Bearer ${token}` }, auth: 'token' };
  if (apiKey) return { url: `${base}?key=${encodeURIComponent(apiKey)}`, auth: 'apikey' };
  return null;
}

/** 현재 사용 가능한 읽기 전용 인증 수단. key 접근자는 drivePicker의 env 판독(getPickerApiKey)
 *  재사용 — VITE_GOOGLE_API_KEY의 판독 지점은 한 곳뿐이다(중복 금지). pastValues의 skip 가드·
 *  재시도 판단·`past_index_fetch_start:auth=` 계측이 전부 이 함수를 SSOT로 쓴다. */
export function readonlySheetsAuth(): ReadonlyAuth | null {
  if (getAccessToken()) return 'token';
  if (getPickerApiKey()) return 'apikey';
  return null;
}

/** 읽기 전용 values GET — 토큰 우선, 없으면 API key 폴백. 둘 다 없으면 authFetch와 동일 메시지로
 *  throw(도달 전에 호출자 가드가 막는 것이 정상 경로). 쓰기·메타 경로에서는 절대 사용 금지. */
async function fetchValuesReadonly(spreadsheetId: string, range: string): Promise<Response> {
  const plan = planValuesReadonly(spreadsheetId, range, getAccessToken(), getPickerApiKey());
  if (!plan) throw new Error('Google 인증 토큰이 없습니다. 먼저 로그인하세요.');
  return fetch(plan.url, plan.headers ? { headers: plan.headers } : undefined);
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
 * Read a sheet to:
 *  - get header (row 1)
 *  - sample data rows (rows 2..끝) for type inference
 *
 * v0.46.0 WP-J J-1 — **행 상한을 없앴다**(종전 `A1:Z1001` = 앞에서 1,000행).
 * 근인: 표본이 시트 **앞쪽에 고정**되면 타입 추론이 최근 데이터를 못 본다. 파생 피해가 두 겹이다.
 *  ① `inferColumns`의 **리스트 승격 판정 자체가 이 표본으로 난다** — 앞 1,000행에서 고유값이
 *     1개인 컬럼은 `options`가 되지 못하고, 그러면 호출부(useSettingsSheetConnection.loadHeaders)의
 *     `fetchColumnUniqueValues`가 **아예 호출되지 않는다**. 즉 열 전체 수집만으로는 안 닫힌다.
 *  ② `columnFlags.preserveUserColumnSettings`는 타입이 달라지면 사용자 설정을 버리고 재유추값을
 *     쓴다(`isSemanticTypeChange`). 표본이 옛 데이터뿐이면 `options`→`text` 되돌림이 재연결마다 난다.
 * 비용 판단: 이 앱은 **이미** 같은 흐름에서 시트 전량을 읽는다(`pastValues.ts` → `fetchAllRowsUnbounded`,
 * 행·열 상한 없음). 전량 읽기는 새로 도입하는 비용이 아니라 이미 지불 중인 비용이고, 이 요청은
 * 시트 연결·타입검토에서만 발생한다(행 입력마다가 아니다).
 */
export async function fetchHeaderAndSample(
  spreadsheetId: string,
  sheetTitle: string,
): Promise<{ headers: string[]; sample: string[][] }> {
  const range = encodeURIComponent(`${quoteSheetTitle(sheetTitle)}!A1:Z`);
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
 * Fetch unique values of a single column (by zero-based index), **최근 등장 우선**.
 * Used to surface options for text columns.
 *
 * v0.46.0 WP-J J-1 (민구 R12 확정) — 수집 범위가 **열 전체**(`A2:A`)다. 종전 `A2:A501`(앞 500행)은
 * 민구 시트 2,902행 중 **앞 500행만** 봤고, 그 안에 든 농가 3곳이 앱이 실제로 보여준 3곳과 정확히
 * 일치했다(원인 확정). 개수 상한도 없다 — 고유값은 어차피 유한하고(농가 수), 1컬럼 2,902행이
 * 수십 KB라 비용이 무시할 수준이다. **「최근 N줄」이 아니라 「전체 수집 + 최근 정렬」인 이유**는
 * 팀 공용 시트다: 시트에 작성자 구분 컬럼이 없어 앱이 누구 행인지 모르므로, 최근 N줄은 사람 수에
 * 반비례해 약해진다(5명이 쓰면 내 몫은 1/5).
 */
export async function fetchColumnUniqueValues(
  spreadsheetId: string,
  sheetTitle: string,
  colIndex: number,
): Promise<string[]> {
  if (colIndex < 0 || colIndex > 25) return []; // simple A-Z support
  const colLetter = String.fromCharCode(65 + colIndex);
  const range = encodeURIComponent(`${quoteSheetTitle(sheetTitle)}!${colLetter}2:${colLetter}`);
  const r = await authFetch(`${API}/${spreadsheetId}/values/${range}`);
  if (!r.ok) return [];
  const d = (await r.json()) as { values?: string[][] };
  return uniqueValuesRecentFirst((d.values || []).map((row) => (row[0] || '').toString()));
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
 *
 * v0.34.0 C9 — authFetch 대신 fetchValuesReadonly: 토큰 없으면 API key 폴백(공개 시트 읽기).
 * 이 함수만 폴백 대상 — 쓰기·메타·헤더 경로는 여전히 authFetch(토큰 필수).
 */
export async function fetchAllRowsUnbounded(
  spreadsheetId: string,
  sheetTitle: string,
): Promise<{ headers: string[]; rows: string[][] }> {
  const range = encodeURIComponent(quoteSheetTitle(sheetTitle));
  const r = await fetchValuesReadonly(spreadsheetId, range);
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
