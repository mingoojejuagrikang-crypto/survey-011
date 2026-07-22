/* eslint-disable max-lines -- [ENV-12] 기존 초과 파일(GL-006 §5 도입 시점), 과거값 인덱스 도메인 — 분리 경계 검토 후 해소. 해소 시 이 주석 제거. */
/**
 * v0.7.0 — 과거 조사값 인덱스 (B3 조회 탭 · B4 추세 검증 공용 모듈).
 *
 * 패턴(audioTrim.ts와 동일): 키 구성·날짜 정규화·인덱스 빌드·회차 조회는 브라우저 의존이 없는
 * 순수 함수로 분리해 Node 단위 테스트(tests/pastValues.spec.ts)가 가능하고, fetch + 캐시
 * (loadPastIndex)는 같은 파일의 브라우저 사이드에 둔다.
 *
 * 데이터 모델:
 *  - 샘플키 = 샘플키 플래그 컬럼(columnFlags.effectiveSampleKey) 값들의 trim-join(KEY_SEP).
 *    키 값 중 하나라도 비면 null → 호출자는 조용히 skip(키 불완전 행은 비교 불가).
 *  - 회차(round) = 조사시기 컬럼(settings.roundDateColId, 기본: 첫 date 컬럼·'조사일자' 우선)
 *    값을 ISO 'YYYY-MM-DD'로 정규화한 것. 정규화 불가 행은 skip.
 *  - (키, 회차) 중복은 **마지막 행 승리** + duplicateCount 집계(조회 탭 중복 배지).
 *  - previousRound는 기준일 **미만(strictly <)** — 당일 부분 업로드가 자기 자신의 기준선이
 *    되지 않게 한다.
 *  - 헤더 매핑은 시트 헤더(trim)와 Column.name(trim)의 **정확 일치**. 미매핑 앱 컬럼은
 *    unmappedColumns로 노출(조회 탭 경고 배너). 미매핑 컬럼이 샘플키면 시트 쪽 키가 전부
 *    불완전해져 samples가 비게 된다 — 배너가 원인을 설명한다.
 *
 * 오프라인/미로그인/시트 미설정/HTTP 오류 → loadPastIndex가 null로 resolve(throw 안 함).
 * 호출자(조회 탭·추세 검증)는 null이면 기능을 조용히 건너뛴다.
 */
import type { Column } from '../types';
import { effectiveSampleKey } from './columnFlags';
import { fetchAllRowsUnbounded, parseSpreadsheetId, readonlySheetsAuth } from './sheets';
import { useSettingsStore } from '../stores/settingsStore';
import { logger } from './logger';
import { loadPastIndexBackup, savePastIndexBackup } from './db';

// ─── 순수 로직 (Node 단위 테스트 대상 — 브라우저 의존 없음) ─────────────────

/** 샘플키 조각을 잇는 구분자. */
export const KEY_SEP = ' ';

/** 샘플 식별 키로 쓰이는 컬럼들(사용자 토글 우선, 없으면 자동 유추). 컬럼 순서 유지. */
export function keyColumns(columns: Column[]): Column[] {
  return columns.filter((c) => effectiveSampleKey(c));
}

/**
 * colId→값 레코드에서 샘플키 문자열을 만든다.
 * 키 컬럼 값 중 하나라도 비어 있으면(트림 후) null — 불완전한 키로 잘못 매칭하지 않는다.
 * 키 컬럼이 0개여도 null(기능 비활성 케이스).
 */
export function buildSampleKey(
  keyCols: Column[],
  values: Record<string, string | undefined>,
): string | null {
  if (keyCols.length === 0) return null;
  const parts: string[] = [];
  for (const c of keyCols) {
    const v = (values[c.id] ?? '').trim();
    if (!v) return null;
    parts.push(v);
  }
  return parts.join(KEY_SEP);
}

/**
 * 조사시기(회차) 컬럼 해석: 명시 id가 있고 존재하면 그 컬럼, 아니면 date 타입 중
 * 이름이 '조사일자'인 컬럼 우선, 없으면 첫 date 컬럼. date 컬럼이 없으면 null.
 */
export function resolveRoundCol(columns: Column[], roundDateColId: string | null): Column | null {
  if (roundDateColId) {
    const explicit = columns.find((c) => c.id === roundDateColId);
    if (explicit) return explicit;
  }
  const dates = columns.filter((c) => c.type === 'date');
  return dates.find((c) => c.name.trim() === '조사일자') ?? dates[0] ?? null;
}

/**
 * 시트 날짜 셀을 ISO 'YYYY-MM-DD'로 정규화. 지원 포맷:
 *  - '2026-05-13' / '2026-5-3' (ISO·하이픈)
 *  - '2026. 5. 13' / '2026.5.13.' (한국식 점 표기, 말미 점 허용)
 *  - '2026/05/13' (연 우선 슬래시)
 *  - '5/13/2026' (Sheets 미국식 M/D/YYYY)
 * 파싱 불가·범위 밖(월 1–12, 일 1–31)은 null.
 */
export function normalizeDateCell(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let y = 0;
  let m = 0;
  let d = 0;
  // 연 우선: 2026-05-13 / 2026. 5. 13(.) / 2026/5/13
  let mt = s.match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?$/);
  if (mt) {
    y = +mt[1]; m = +mt[2]; d = +mt[3];
  } else {
    // 미국식: M/D/YYYY
    mt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!mt) return null;
    m = +mt[1]; d = +mt[2]; y = +mt[3];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export interface PastIndex {
  /** colId → 0-based 시트 컬럼 인덱스 (시트 헤더 trim명 ↔ Column.name trim명 정확 일치). */
  headersMapped: Map<string, number>;
  /** 시트 헤더에서 찾지 못한 앱 컬럼명 — 조회 탭 경고 배너용. */
  unmappedColumns: string[];
  /** 인덱스에 존재하는 회차(정규화 ISO 날짜), 오름차순. */
  rounds: string[];
  /** 샘플키 → (회차 → colId→값 레코드). (키,회차) 중복은 마지막 행 승리. */
  samples: Map<string, Map<string, Record<string, string>>>;
  /** (키,회차) 충돌 횟수 — 조회 탭 중복 배지. */
  duplicateCount: number;
  /** 헤더 제외 데이터 행 수(스킵된 행 포함). */
  rowCount: number;
}

/** 시트 전체 행에서 과거값 인덱스를 빌드한다. roundCol이 null이면 회차 구분 불가 → samples 빈 인덱스. */
export function buildPastIndex(
  headers: string[],
  rows: string[][],
  columns: Column[],
  roundCol: Column | null,
): PastIndex {
  // 시트 헤더명(trim) → 인덱스. 중복 헤더는 첫 번째 승리.
  const headerIdx = new Map<string, number>();
  headers.forEach((h, i) => {
    const t = (h ?? '').toString().trim();
    if (t && !headerIdx.has(t)) headerIdx.set(t, i);
  });

  const headersMapped = new Map<string, number>();
  const unmappedColumns: string[] = [];
  for (const c of columns) {
    const i = headerIdx.get(c.name.trim());
    if (i === undefined) unmappedColumns.push(c.name);
    else headersMapped.set(c.id, i);
  }

  const keyCols = keyColumns(columns);
  const samples = new Map<string, Map<string, Record<string, string>>>();
  const roundsSet = new Set<string>();
  let duplicateCount = 0;

  for (const row of rows) {
    const rec: Record<string, string> = {};
    for (const [colId, idx] of headersMapped) {
      rec[colId] = (row[idx] ?? '').toString();
    }
    // 키 컬럼이 미매핑이면 rec에 값이 없어 키가 null → 행 skip (unmappedColumns가 원인 설명).
    const key = buildSampleKey(keyCols, rec);
    if (!key) continue;
    const round = roundCol ? normalizeDateCell(rec[roundCol.id]) : null;
    if (!round) continue;
    roundsSet.add(round);
    let byRound = samples.get(key);
    if (!byRound) {
      byRound = new Map();
      samples.set(key, byRound);
    }
    if (byRound.has(round)) duplicateCount++;
    byRound.set(round, rec); // 마지막 행 승리
  }

  return {
    headersMapped,
    unmappedColumns,
    rounds: [...roundsSet].sort(),
    samples,
    duplicateCount,
    rowCount: rows.length,
  };
}

/**
 * 해당 샘플의 직전 회차: beforeDate(ISO) **미만(strictly)** 중 가장 늦은 회차.
 * 당일 부분 업로드가 자기 기준선이 되지 않는 것이 핵심 — 같은 날짜는 제외된다.
 */
export function previousRound(index: PastIndex, key: string, beforeDate: string): string | null {
  const byRound = index.samples.get(key);
  if (!byRound) return null;
  let best: string | null = null;
  for (const r of byRound.keys()) {
    if (r < beforeDate && (best === null || r > best)) best = r;
  }
  return best;
}

/**
 * v0.8.0 — 화면 전역 비교 기준: 인덱스에 존재하는 **최근 2개 회차**(직전→최근).
 *
 * 조회탭은 "각 샘플이 시간 경과(직전→최근)에 따라 어떻게 변하는지"를 보는 탭이다.
 * 샘플을 섞지 않으므로(집계 금지) 이 함수는 **샘플별이 아니라 전역**이다 — 전체 화면이
 * 같은 두 회차를 쓰고, 각 샘플은 그 두 회차에서 자기 값을 읽는다(없으면 '—').
 * (대조: previousRound는 샘플별로 다른 직전 회차를 돌려준다 — 추세 검증/음성용으로 유지.)
 *
 *  - rounds는 buildPastIndex에서 오름차순 정렬됨 → 끝의 2개가 직전·최근.
 *  - 회차가 1개뿐이면 prev=null(변화 표시 불가, 값만), 0개면 둘 다 null.
 *  - **집계(합계·평균) 함수가 아니다.** 두 회차의 ISO 문자열만 고른다.
 */
export function latestTwoRounds(index: PastIndex): { latest: string | null; prev: string | null } {
  const r = index.rounds;
  return {
    latest: r.length >= 1 ? r[r.length - 1] : null,
    prev: r.length >= 2 ? r[r.length - 2] : null,
  };
}

/** (키, 회차, 컬럼)의 과거값. 없거나 빈 문자열이면 null. */
export function pastValue(
  index: PastIndex,
  key: string,
  round: string,
  colId: string,
): string | null {
  const v = index.samples.get(key)?.get(round)?.[colId];
  return v === undefined || v === '' ? null : v;
}

// ─── 영속화 직렬화 (v0.33.0 항목5 — 순수 함수, Node 단위 테스트 대상) ─────────

/** 폴백 유효기간: 14일. 회차 간격(주 단위 조사)을 넉넉히 덮되, 시즌이 지난 죽은 인덱스로
 *  엉뚱한 직전값 비교를 하지 않게 상한을 둔다(플랜 확정값). */
export const FALLBACK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** 14일 경계 판정(경계 포함: 정확히 14일 = 아직 유효). 순수 함수 — 단위 테스트 대상. */
export function isFallbackFresh(builtAt: number, now: number): boolean {
  return now - builtAt <= FALLBACK_TTL_MS;
}

/** IDB 'kv' 스토어(`__past_index__`)에 저장되는 JSON-호환 레코드. Map은 entries 배열로 편다
 *  (structured clone이 Map을 지원하긴 하나, 검증 가능한 평면 형태가 복원 안전성·테스트에 유리). */
export interface PersistedPastIndexRecord {
  fp: string;
  builtAt: number;
  headersMapped: [string, number][];
  unmappedColumns: string[];
  rounds: string[];
  samples: [string, [string, Record<string, string>][]][];
  duplicateCount: number;
  rowCount: number;
}

export function serializePastIndexEntry(entry: {
  fp: string;
  builtAt: number;
  index: PastIndex;
}): PersistedPastIndexRecord {
  const { fp, builtAt, index } = entry;
  return {
    fp,
    builtAt,
    headersMapped: [...index.headersMapped.entries()],
    unmappedColumns: [...index.unmappedColumns],
    rounds: [...index.rounds],
    samples: [...index.samples.entries()].map(
      ([key, byRound]) => [key, [...byRound.entries()]] as [string, [string, Record<string, string>][]],
    ),
    duplicateCount: index.duplicateCount,
    rowCount: index.rowCount,
  };
}

/** 레코드 복원 + 형태 검증. 손상/구버전/이형 레코드는 null(조용히 폐기 — 폴백은 best-effort). */
export function deserializePastIndexEntry(
  raw: unknown,
): { fp: string; builtAt: number; index: PastIndex } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<PersistedPastIndexRecord>;
  if (typeof r.fp !== 'string' || typeof r.builtAt !== 'number' || !Number.isFinite(r.builtAt)) return null;
  if (
    !Array.isArray(r.headersMapped) || !Array.isArray(r.unmappedColumns) ||
    !Array.isArray(r.rounds) || !Array.isArray(r.samples) ||
    typeof r.duplicateCount !== 'number' || typeof r.rowCount !== 'number'
  ) return null;
  try {
    const headersMapped = new Map<string, number>();
    for (const pair of r.headersMapped) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'number') return null;
      headersMapped.set(pair[0], pair[1]);
    }
    const samples = new Map<string, Map<string, Record<string, string>>>();
    for (const entry of r.samples) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) return null;
      const byRound = new Map<string, Record<string, string>>();
      for (const pair of entry[1]) {
        if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'object' || pair[1] === null) return null;
        byRound.set(pair[0], pair[1]);
      }
      samples.set(entry[0], byRound);
    }
    return {
      fp: r.fp,
      builtAt: r.builtAt,
      index: {
        headersMapped,
        unmappedColumns: r.unmappedColumns.filter((x): x is string => typeof x === 'string'),
        rounds: r.rounds.filter((x): x is string => typeof x === 'string'),
        samples,
        duplicateCount: r.duplicateCount,
        rowCount: r.rowCount,
      },
    };
  } catch {
    return null;
  }
}

/** fetch 무한대기 방지 래퍼(순수 — 단위 테스트 대상). 시간 초과 시 reject —
 *  loadPastIndex의 catch가 `past_index_skip:timeout…`으로 로깅하고 null 해소하므로,
 *  in-flight 가드가 풀려 백오프 재시도·수동 재시도 버튼 경로가 살아난다(07-13 §4 hang 가설 방어). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// ─── 브라우저 사이드: fetch + 모듈 캐시 ─────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000; // 10분 — 한 조사 세션 동안 재fetch 없이 충분, 당일 타 기기 업로드는 다음 세션에 반영

/** loadPastIndex 전체 fetch 상한 — 2272행 실측이 ~1s인 시트가 20s를 넘기면 hang으로 간주. */
const FETCH_TIMEOUT_MS = 20_000;

interface CacheEntry {
  fp: string;
  builtAt: number;
  index: PastIndex;
}

let cached: CacheEntry | null = null;
let inflight: { fp: string; promise: Promise<PastIndex | null> } | null = null;
let loginRefreshInflight: { fp: string; promise: Promise<PastIndex | null> } | null = null;

// v0.33.0 항목5 — IDB에서 복원한 영속 폴백(로그인 무관 이상치 알람). 유효성(fp 일치 + 14일 이내)은
// 읽기 시점(getFallbackEntry)에 매번 재검증한다 — 하이드레이션 후 설정이 바뀌어도 안전.
let fallback: CacheEntry | null = null;
let fallbackHydrateStarted = false;

// v0.33.0 항목5 — 상태 구독(설정탭·입력탭 시작 카드의 '과거값 준비' 배지 실시간 갱신용).
const statusListeners = new Set<() => void>();
function notifyStatusChanged(): void {
  for (const cb of [...statusListeners]) {
    try { cb(); } catch { /* 리스너 오류가 로더를 죽이지 않게 */ }
  }
}
export function subscribePastIndexStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => { statusListeners.delete(cb); };
}

// v0.14.0 A — 전송 실패(iOS Safari transient "Load failed") 자가 복구용 백오프 재시도 상태.
// 실기기 로그(v0.13.0)에서 세션 start 직후(~27ms) prefetch가 "Load failed"로 한 번 실패하면
// 세션 내내 past_index_ready가 0건이었다(토큰·연결은 정상 — 같은 세션 시트 쓰기는 성공). 원인은
// "한 번 실패 후 아무도 다시 부르지 않음"(prefetch 1회 + evaluateTrend는 getCachedIndex만 읽음).
// loadPastIndex는 실패를 캐시하지 않으므로 재호출하면 다시 시도된다 — ensurePastIndex가 반복
// 호출에 안전하게 자가 제한된 백오프 재시도를 건다.
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempts = 0;
const MAX_RETRIES = 5;

/** v0.34.0 리뷰(Codex+agy-Flash 공통) — 권한 오류(401 미인증 / 403 권한없음) 판별.
 *  sheets.ts의 fetch 실패는 `시트 조회 실패 (HTTP 403): …` 형태로 상태코드를 메시지에 담는다
 *  (별도 status 필드가 없어 메시지 파싱 — 오탐해도 "재시도를 덜 한다"는 안전한 방향이고,
 *  실패 자체는 past_index_skip으로 항상 로깅되므로 침묵하지 않는다).
 *  비공개 시트를 API key로 읽는 조합이 대표 사례: 몇 번을 더 쏴도 결과는 같다. */
function isPermissionError(msg: string): boolean {
  return /\bHTTP (401|403)\b/.test(msg) || /\b(401|403)\b/.test(msg);
}

interface LoadContext {
  fp: string;
  spreadsheetId: string | null;
  sheetTab: string;
  columns: Column[];
  roundDateColId: string | null;
}

/** 캐시 키 = (시트 ID, 탭, 회차 컬럼, 컬럼 지문). 키/이름/타입이 바뀌면 인덱스 무효. */
function loadContext(): LoadContext {
  const s = useSettingsStore.getState();
  const spreadsheetId = parseSpreadsheetId(s.sheetUrl);
  const fp = JSON.stringify([
    spreadsheetId,
    s.sheetTab,
    s.roundDateColId,
    s.columns.map((c) => [c.id, c.name.trim(), c.type, effectiveSampleKey(c)]),
  ]);
  return { fp, spreadsheetId, sheetTab: s.sheetTab, columns: s.columns, roundDateColId: s.roundDateColId };
}

/** 유효한(TTL 내 + 현재 설정과 지문 일치) 캐시 인덱스. 없으면 null — fetch하지 않는다. */
export function getCachedIndex(): PastIndex | null {
  if (!cached) return null;
  if (Date.now() - cached.builtAt > CACHE_TTL_MS) return null;
  if (cached.fp !== loadContext().fp) return null;
  return cached.index;
}

// ─── v0.33.0 항목5 — 영속 폴백 (로그인 무관 이상치 알람) ───────────────────

/** 유효한(fp 일치 + 14일 이내) 영속 폴백 엔트리. 신선 캐시와 달리 10분 TTL이 없다 —
 *  토큰 만료·재부팅·미로그인 세션에서도 "직전 회차 대비" 비교선을 유지하는 것이 목적. */
function getFallbackEntry(): CacheEntry | null {
  if (!fallback) return null;
  if (!isFallbackFresh(fallback.builtAt, Date.now())) return null;
  if (fallback.fp !== loadContext().fp) return null;
  return fallback;
}

/** evaluateTrend 폴백 경로: `getCachedIndex() ?? getFallbackIndex()`. 폴백 사용 시 호출자가
 *  `trend_used_stale_index`를 로깅한다(세션당 1회 — useVoiceSession의 skip dedupe와 동일 컨벤션). */
export function getFallbackIndex(): PastIndex | null {
  return getFallbackEntry()?.index ?? null;
}

/** 폴백의 빌드 시각(epoch ms) — 배지의 "(x시간 전)" 표기·stale 로그의 age 산출용. 없으면 null. */
export function getFallbackBuiltAt(): number | null {
  return getFallbackEntry()?.builtAt ?? null;
}

/**
 * 부팅/세션 시작 시 1회 — IDB `__past_index__` 레코드를 메모리 폴백으로 복원한다(idempotent).
 * 손상 레코드·14일 초과는 조용히 폐기. fp 검증은 여기서 하지 않는다(설정 하이드레이션 레이스
 * 방지 — 읽기 시점의 getFallbackEntry가 매번 검증). 실패해도 throw하지 않는다(best-effort).
 */
export async function hydratePastIndexFallback(): Promise<void> {
  if (fallbackHydrateStarted) return;
  fallbackHydrateStarted = true;
  try {
    const raw = await loadPastIndexBackup();
    if (raw == null) return;
    const entry = deserializePastIndexEntry(raw);
    if (!entry) return;
    if (!isFallbackFresh(entry.builtAt, Date.now())) return;
    // 이미 신선 캐시가 있으면(부팅 직후 prefetch가 먼저 성공) 캐시가 더 최신이다.
    if (!fallback || entry.builtAt > fallback.builtAt) fallback = entry;
    notifyStatusChanged();
  } catch { /* IDB 불가 — 폴백 없이 기존 경로로 동작 */ }
}

// ─── v0.33.0 항목5 — 상태 스냅샷 (3상태 배지의 '과거값 준비' 행) ──────────────

export interface PastIndexStatus {
  /** ready=신선 캐시 / stale=영속 폴백만 / loading=fetch 진행 중 / none=없음 */
  state: 'ready' | 'stale' | 'loading' | 'none';
  rowCount?: number;
  roundCount?: number;
  builtAt?: number;
}

export function getPastIndexStatus(): PastIndexStatus {
  const hit = getCachedIndex();
  if (hit && cached) {
    return { state: 'ready', rowCount: hit.rowCount, roundCount: hit.rounds.length, builtAt: cached.builtAt };
  }
  const fb = getFallbackEntry();
  if (fb) {
    return { state: 'stale', rowCount: fb.index.rowCount, roundCount: fb.index.rounds.length, builtAt: fb.builtAt };
  }
  if (inflight) return { state: 'loading' };
  return { state: 'none' };
}

/**
 * 과거값 인덱스 로드. 캐시 히트면 fetch 없이 반환, 동일 지문 in-flight면 그 promise 공유.
 * 미설정/미로그인/네트워크·HTTP 오류는 **null로 resolve**(throw 안 함) — 호출자는 조용히 skip.
 */
export async function loadPastIndex(opts?: { force?: boolean }): Promise<PastIndex | null> {
  const ctx = loadContext();
  if (!opts?.force) {
    const hit = getCachedIndex();
    if (hit) return hit;
    if (inflight && inflight.fp === ctx.fp) return inflight.promise;
  }
  if (!ctx.spreadsheetId || !ctx.sheetTab) {
    logger.log({ type: 'app', extra: 'past_index_skip:not_configured' });
    return null;
  }
  // v0.34.0 C9 — 토큰 **또는** API key(공개 시트 읽기 폴백, readonlySheetsAuth SSOT)가 있으면
  // 진행. 둘 다 없을 때만 기존 not_signed_in skip(이벤트명 유지 — 로그 분석 호환).
  // 시트가 비공개라 key 경로가 403이면 fetch 오류가 아래 catch의 `past_index_skip:<msg>`로
  // 남는다(HTTP 상태 포함) — 침묵 실패 없음.
  const auth = readonlySheetsAuth();
  if (!auth) {
    logger.log({ type: 'app', extra: 'past_index_skip:not_signed_in' });
    return null;
  }
  const promise = (async (): Promise<PastIndex | null> => {
    try {
      // v0.33.0 항목5 — fetch 시작 계측(07-13 §4: 시작 이벤트가 없어 "미완 hang"을 로그로 판별
      // 불가했던 갭). ready/skip과 짝을 이뤄 미완주 fetch가 로그에서 보인다.
      // v0.34.0 C9 — auth=token|apikey 첨부: 어떤 인증 수단으로 준비됐는지 로그만으로 판정.
      logger.log({ type: 'app', extra: `past_index_fetch_start:auth=${auth}` });
      const { headers, rows } = await withTimeout(
        fetchAllRowsUnbounded(ctx.spreadsheetId!, ctx.sheetTab),
        FETCH_TIMEOUT_MS,
      );
      const roundCol = resolveRoundCol(ctx.columns, ctx.roundDateColId);
      const index = buildPastIndex(headers, rows, ctx.columns, roundCol);
      cached = { fp: ctx.fp, builtAt: Date.now(), index };
      // v0.33.0 항목5 — IDB write-through(kv `__past_index__`) + 메모리 폴백 동기화.
      // 캐시 TTL(10분)·토큰 만료·재부팅 후에도 이 스냅샷이 알람 비교선으로 살아남는다.
      fallback = cached;
      void savePastIndexBackup(serializePastIndexEntry(cached));
      logger.log({
        type: 'app',
        extra:
          `past_index_ready:rows=${index.rowCount},samples=${index.samples.size},` +
          `rounds=${index.rounds.length},dup=${index.duplicateCount},unmapped=${index.unmappedColumns.length}`,
      });
      return index;
    } catch (e) {
      // 오프라인/HTTP 오류/타임아웃 — REVIEW-1: 삼키지 말고 로깅하되, 호출자에겐 null(조용히 skip).
      const msg = e instanceof Error ? e.message : String(e);
      // v0.34.0 리뷰(Codex+agy-Flash 공통) — 권한 오류(401/403)는 재시도해도 낫지 않는다. 비공개
      // 시트를 API key로 읽으려는 조합에서 지수 백오프 5회가 무의미한 403을 반복해 쿼터·대역폭을
      // 태우던 표면. 권한 오류로 판정되면 재시도 예산을 소진시켜 즉시 멈춘다(다른 실패는 종전대로
      // 재시도 — 오프라인·5xx·타임아웃은 회복 가능).
      if (isPermissionError(msg)) {
        retryAttempts = MAX_RETRIES;
        logger.log({ type: 'app', extra: `past_index_retry_blocked:permission:auth=${auth}` });
      }
      logger.log({ type: 'app', extra: `past_index_skip:${msg.slice(0, 120)}` });
      return null;
    } finally {
      if (inflight && inflight.fp === ctx.fp) inflight = null;
      notifyStatusChanged();
    }
  })();
  inflight = { fp: ctx.fp, promise };
  notifyStatusChanged();
  return promise;
}

/**
 * v0.38.0 #1 — Google 로그인 성공 직후의 강제 갱신. 10분 캐시는 의도적으로 우회하되,
 * 동일 설정 지문의 로그인 갱신이 이미 진행 중이면 같은 Promise를 공유한다. 로그인 직전의 일반
 * prefetch가 진행 중이었다면 그것을 먼저 정착시킨 다음 한 번 더 강제 조회해, "기존 요청에 합류해서
 * 실제 로그인 시점 갱신은 생략"되는 경우도 막는다. 인덱스 확정·메모리/IDB 반영은 loadPastIndex의
 * 기존 성공 경로만 사용한다.
 */
export function refreshPastIndexAfterLogin(): Promise<PastIndex | null> {
  const ctx = loadContext();
  if (loginRefreshInflight?.fp === ctx.fp) return loginRefreshInflight.promise;
  const pendingBeforeLogin = inflight?.fp === ctx.fp ? inflight.promise : null;
  const promise = (async () => {
    if (pendingBeforeLogin) await pendingBeforeLogin;
    return loadPastIndex({ force: true });
  })();
  loginRefreshInflight = { fp: ctx.fp, promise };
  void promise.then(() => {
    if (loginRefreshInflight?.promise === promise) loginRefreshInflight = null;
  });
  return promise;
}

/** 재시도 가치 판단: 시트·탭·인증수단(토큰 또는 API key — v0.34.0 C9, readonlySheetsAuth SSOT)이
 *  모두 있는데 인덱스가 없으면 네트워크/HTTP 실패였다는 뜻 → 재시도 가치 있음.
 *  미설정/둘 다 없음이면 재시도 무의미(조용히 멈춤). */
function shouldRetryLoad(): boolean {
  const ctx = loadContext();
  return !!ctx.spreadsheetId && !!ctx.sheetTab && readonlySheetsAuth() !== null;
}

/**
 * v0.14.0 A — 반복 호출에 안전한 인덱스 로더. 캐시 히트/in-flight/재시도 예약 중이면 no-op.
 * 로드가 실패(null)했고 재시도 가치가 있으며 횟수 미초과면 지수 백오프(0.6→1.2→2.4→4.0s)로
 * 자동 재시도한다. evaluateTrend가 캐시 미스마다 호출해도 자가 제한되어 폭주하지 않는다.
 */
export function ensurePastIndex(): void {
  if (getCachedIndex()) return;
  if (inflight) return;
  if (retryTimer != null) return;
  void loadPastIndex().then((idx) => {
    if (idx) { retryAttempts = 0; return; } // 성공 → 캐시됨
    if (!shouldRetryLoad() || retryAttempts >= MAX_RETRIES) return;
    const delay = Math.min(4000, 600 * 2 ** retryAttempts);
    retryAttempts++;
    retryTimer = setTimeout(() => { retryTimer = null; ensurePastIndex(); }, delay);
  });
}

/** 세션 시작 시 재시도 카운터/타이머 리셋 — 이전 세션이 오프라인으로 소진했어도 새 세션은 다시
 *  시도한다. 유효 캐시는 보존(무효화는 TTL/지문으로 getCachedIndex가 담당). */
export function resetPastIndexRetries(): void {
  retryAttempts = 0;
  if (retryTimer != null) { clearTimeout(retryTimer); retryTimer = null; }
}

/** fire-and-forget 프리페치 — 세션 start() 등에서 호출(B4). v0.14.0: 백오프 재시도 포함. */
export function prefetchPastIndex(): void {
  ensurePastIndex();
}
