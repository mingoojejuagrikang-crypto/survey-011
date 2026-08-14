/* eslint-disable max-lines -- [ENV-12] 기존 초과 파일(GL-006 §5 도입 시점), Sheets API 도메인 — 분리 경계 검토 후 해소. 해소 시 이 주석 제거. */
/**
 * Google Sheets API v4 helpers.
 * All requests use the user's access token from googleAuth.ts.
 *
 * v0.34.0 C9 예외 — 과거값 인덱스 읽기(fetchAllRowsUnbounded)만 토큰 부재 시 API key 폴백
 * (`fetchValuesReadonly`)을 쓴다. 쓰기·메타 경로(authFetch)는 무수정: API key는 공개 시트
 * '읽기'만 가능하고, 쓰기 경로에 key가 새면 401이 403으로 바뀌어 [AUTH-7] 계열 재로그인
 * 유도(LoginRequiredModal, sync-token-expiry.spec)가 무너진다.
 */
import { getAccessToken } from './googleAuth';
import { getPickerApiKey } from './drivePicker';
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
 * 값 목록 → 고유값, **최근 등장 우선**(마지막에 나온 값이 맨 앞).
 *
 * v0.46.0 WP-J J-1 (민구 R12 확정) — 종전 **빈도순**을 대체한다. 빈도순은 "옛날에 많이 쓴 값"을
 * 위로 올려, 오늘 새로 조사한 농가가 목록 끝으로 밀렸다. 정렬은 눈에 보이지 않는 계약이라
 * 오라클(tests/v0460-wp-j-options.spec.ts)이 이 함수를 직접 잰다 — 없으면 빈도순으로 조용히
 * 되돌아가도 아무도 모른다.
 *
 * ⚠️ 정규화하지 않는다. `신례리 1365-1`(공백 있음)과 `신례리816-1`(공백 없음)은 **서로 다른 값**으로
 * 남는다(J-6) — 손입력 표기 흔들림일 수도, 진짜 다른 농가일 수도 있어 앱이 판단할 근거가 없다.
 * 합치는 것은 사용자의 몫이고, 그 수단이 J-4의 선택지 삭제다.
 */
export function uniqueValuesRecentFirst(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = values.length - 1; i >= 0; i--) {
    const v = (values[i] ?? '').toString().trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
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
 * 🔴 v0.46.0 콜드 리뷰 L2-1(critical) 처방 — **text 컬럼의 리스트 승격 판정 기준.**
 *
 * **평균 반복 횟수**(채워진 값 수 ÷ 고유값 수)가 이 값 이상이면 「반복 사용되는 선택지」로 보고
 * `options`로 승격한다. 미달이면 **자유서술 칸**이므로 승격하지 않고 수동 입력으로 둔다.
 *
 * 🔑 **왜 「절대 개수」가 아니라 「반복성」인가** — 종전 `uniqVals.size <= 20`이 이 자리에 있었고,
 * J-2가 그 상한을 폐지하자(농가 21곳 절벽 제거, 민구 R7-b) **자유서술 컬럼의 보호막까지 함께
 * 사라졌다.** 08-06 콜드 리뷰 실측: 다른 스키마 시트의 메모 칸이 `options`+`input:'auto'`로 승격돼
 * **「가장 최근 값」이 전 행에 합성돼 시트에 기록**됐다. 절대 개수는 시트 크기에 따라 의미가
 * 바뀌므로 두 요구(*"농가 21곳은 리스트로 남는다"* · *"메모 칸은 승격되지 않는다"*)를 동시에
 * 만족시킬 수 없다. **반복성은 만족시킨다.**
 *
 * **실측 근거**(민구 시트 2,902행 · 08-05 WP-A 진단 §시트 실측 + 08-06 콜드 리뷰):
 * | 컬럼 성격 | 고유값 | 평균 반복 | 판정 |
 * |---|---|---|---|
 * | 조사과실(자동입력) | 5 | **580회** | 승격 |
 * | 농가명 21곳(J-2가 살리려던 것) | 21 | **138회** | 승격 |
 * | 자유서술 메모 | 2,902 | **1.0회** | 승격 안 함 |
 * → 임계 `2`는 살릴 쪽 최솟값(138)의 **1/69**이고 막을 쪽(1.0)의 **2배**다. 양쪽 마진이 크다.
 *
 * ⚠️ 표본은 **시트 전량**이다(J-1이 `A1:Z1001` 상한을 없앴다) — 비율이 실제 비율이다.
 * ⚠️ 값이 **하나뿐**인 컬럼은 이 판정 앞에서 `fixed`로 갈린다(기존 동작 유지).
 * 🔴 **이 값을 만지려면 위 표를 다시 재라.** 근거 없는 리터럴이 이 결함의 출발이었다.
 */
const OPTIONS_MIN_REPEAT = 2;

/**
 * Build Column[] from sheet header + sample data.
 * Heuristics:
 *  - If majority of samples are date/int/float → that type, mode 'voice' for numeric.
 *  - If text and values repeat (≥ OPTIONS_MIN_REPEAT on average) → 'options' with available pre-filled.
 *  - If text and values barely repeat → 자유서술 칸: 'text' + input 'touch' (사람이 채운다).
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

    const filledVals = samples.map((v) => v.trim()).filter(Boolean);
    const uniqVals = new Set(filledVals);

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
        input = 'auto';
      } else if (uniqVals.size > 0 && filledVals.length / uniqVals.size >= OPTIONS_MIN_REPEAT) {
        // v0.46.0 WP-J J-2 (민구 R7-b: "리스트는 무한") — 종전 `uniqVals.size <= 20` 상한을
        // 폐지했다. 농가가 21곳이 되는 순간 리스트가 통째로 사라지던 절벽을 없앤다.
        // 🔑 목록이 길어지는 문제는 상한이 아니라 J-4의 **선택지 삭제**가 푼다(제외 목록 = J-5).
        type = 'options';
        // 최근 등장 우선 — fetchColumnUniqueValues와 같은 정렬 계약을 표본 경로에도 적용한다.
        // 파생: 기본 선택값(slice(0,1))이 "표본에서 처음 본 값"이 아니라 "가장 최근에 쓴 값"이 된다.
        const available = uniqueValuesRecentFirst(samples);
        auto = { kind: 'options', available, selected: available.slice(0, 1) };
        input = 'auto';
      } else if (uniqVals.size > 0) {
        // 🔴 v0.46.0 콜드 리뷰 L2-1(critical) — **반복되지 않는 값은 선택지가 아니다.**
        //    사람이 그때그때 적는 칸(메모·특이사항)이다 → 민구 계약대로 **수동 입력**으로 둔다.
        auto = { kind: 'fixed', value: '' };
        input = 'touch';
      } else {
        auto = { kind: 'fixed', value: '' };
        input = 'auto';
      }
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
