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
import { fetchAllRowsUnbounded, parseSpreadsheetId } from './sheets';
import { getAccessToken } from './googleAuth';
import { useSettingsStore } from '../stores/settingsStore';
import { logger } from './logger';

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

// ─── 브라우저 사이드: fetch + 모듈 캐시 ─────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000; // 10분 — 한 조사 세션 동안 재fetch 없이 충분, 당일 타 기기 업로드는 다음 세션에 반영

interface CacheEntry {
  fp: string;
  builtAt: number;
  index: PastIndex;
}

let cached: CacheEntry | null = null;
let inflight: { fp: string; promise: Promise<PastIndex | null> } | null = null;

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
  if (!getAccessToken()) {
    logger.log({ type: 'app', extra: 'past_index_skip:not_signed_in' });
    return null;
  }
  const promise = (async (): Promise<PastIndex | null> => {
    try {
      const { headers, rows } = await fetchAllRowsUnbounded(ctx.spreadsheetId!, ctx.sheetTab);
      const roundCol = resolveRoundCol(ctx.columns, ctx.roundDateColId);
      const index = buildPastIndex(headers, rows, ctx.columns, roundCol);
      cached = { fp: ctx.fp, builtAt: Date.now(), index };
      logger.log({
        type: 'app',
        extra:
          `past_index_ready:rows=${index.rowCount},samples=${index.samples.size},` +
          `rounds=${index.rounds.length},dup=${index.duplicateCount},unmapped=${index.unmappedColumns.length}`,
      });
      return index;
    } catch (e) {
      // 오프라인/HTTP 오류 — REVIEW-1: 삼키지 말고 로깅하되, 호출자에겐 null(조용히 skip).
      const msg = e instanceof Error ? e.message : String(e);
      logger.log({ type: 'app', extra: `past_index_skip:${msg.slice(0, 120)}` });
      return null;
    } finally {
      if (inflight && inflight.fp === ctx.fp) inflight = null;
    }
  })();
  inflight = { fp: ctx.fp, promise };
  return promise;
}

/** fire-and-forget 프리페치 — 세션 start() 등에서 호출(B4). 실패해도 아무 것도 던지지 않는다. */
export function prefetchPastIndex(): void {
  void loadPastIndex();
}
