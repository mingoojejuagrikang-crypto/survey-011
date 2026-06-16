/**
 * v0.10.0 — 비교탭(ReviewScreen) 순수 쿼리 헬퍼 (pastValues.ts 패턴: 브라우저 의존 없음,
 * tests/reviewQuery.spec.ts에서 Node로 직접 검증).
 *
 * 데이터 레이어(pastValues.PastIndex)가 이미 (키, 회차)별 전 컬럼값을 보유하므로, 추가 fetch 없이
 * 클라이언트 파생만으로 비교탭의 필터·차원/측정 분해·후보 행·표시 행을 만든다.
 *
 * 설계 원칙(민구 확정):
 *  - 필터 = **AND 연산**(차원 칩 모두 만족 샘플만, 교집합).
 *  - 회차 비교 = **기준 1개 + 직전(또는 N회차 전)**. 화면 전역 두 회차(집계 아님).
 *  - **집계 없음** — 한 행 = 한 샘플(키)의 target 회차 레코드. rows ⊆ candidateRows.
 *  - 측정 컬럼 = isTrendEligible((int|float) && input!=='auto') → **비고(text/touch) 자연 제외**.
 *    ⚠️ "전 비-auto 컬럼" 폴백 금지(비고 재유입).
 *  - 차원(키) 컬럼 = effectiveSampleKey true. 후보 행 사이에서 값이 불변이면 constantDims(상수
 *    뱃지/sticky), 가변이면 rowDims(행 구분 라벨).
 *
 * 용어:
 *  - sample / candidate row = (키)별 1개 — target 회차에 레코드가 존재하는 키. rec = target 회차 레코드.
 *  - targetRound = 비교 기준 회차(시간 축). baselineRound = roundsBefore(target, N)(없으면 null).
 */
import type { Column } from '../types';
import { effectiveSampleKey, isTrendEligible } from './columnFlags';
import { keyColumns, type PastIndex } from './pastValues';

// ─── 타입 ──────────────────────────────────────────────────────────────────

/** 차원 AND 필터 한 조건. 같은 colId가 여러 번 와도 AND(모두 만족)로 처리된다. */
export interface ReviewFilter {
  colId: string;
  value: string;
}

/** buildReviewView가 읽는 설정 슬라이스(settingsStore의 review 상태 + columns). */
export interface ReviewSettings {
  columns: Column[];
  reviewFilters: ReviewFilter[];
  /** 비교 기준 회차(ISO). null = 인덱스의 최근 회차. */
  reviewTargetRound: string | null;
  /** baseline = target 기준 N회차 전(strictly before). 최소 1. */
  reviewBaselineBack: number;
  /** 표시 차원(키) 컬럼 id 목록. null = 자동(가변 키 차원). */
  reviewGroupCols: string[] | null;
  /** 표시 측정 컬럼 id 목록. null = 자동(전 적격 측정). */
  reviewMeasureCols: string[] | null;
  /** 표시 행(샘플키) 목록. null = 후보 전체. 후보에 없는 키는 무시된다. */
  reviewSelectedRows: string[] | null;
}

/** 한 후보 행 = 한 샘플(키)의 target 회차 레코드. */
export interface ReviewRow {
  /** 샘플키(pastValues.buildSampleKey). */
  key: string;
  /** target 회차의 colId→값 레코드(이 행의 측정/차원 값을 읽는 원본). */
  rec: Record<string, string>;
}

/** buildReviewView 결과(집계 없음, rows ⊆ candidateRows). */
export interface ReviewView {
  /** 비교 기준 회차(ISO). 인덱스에 회차가 없으면 null. */
  targetRound: string | null;
  /** baseline 회차(ISO). target 기준 N회차 전이 없으면 null. */
  baselineRound: string | null;
  /** 후보 행 전체에서 값이 불변인 차원(키) 컬럼 — 상수 표시(sticky/뱃지)용. */
  constantDims: Column[];
  /** 후보 행 사이에서 값이 갈리는 차원(키) 컬럼 — 행 구분 라벨용(reviewGroupCols 지정 시 그 순서/집합). */
  rowDims: Column[];
  /** 표시 측정 컬럼(isTrendEligible, reviewMeasureCols 지정 시 그 순서/집합). */
  measures: Column[];
  /** 필터(AND) + target 회차 레코드 존재를 만족하는 모든 샘플 행. key 기준 안정 정렬. */
  candidateRows: ReviewRow[];
  /** 실제 표시할 행(reviewSelectedRows 부분집합, null이면 candidateRows 전체). candidateRows 순서 보존. */
  rows: ReviewRow[];
}

// ─── 순수 헬퍼 ─────────────────────────────────────────────────────────────

/**
 * 드롭다운 후보 값: 인덱스의 전 (키,회차) 레코드에서 해당 컬럼의 비어있지 않은 값 합집합.
 * options 타입 자동 컬럼이면 auto.available(선택 후보 정의)도 합친다 — 시트에 아직 안 쓰인 옵션도
 * 필터 후보로 보이게 한다. 결과는 한국어 numeric 정렬.
 */
export function distinctValues(index: PastIndex, col: Column): string[] {
  const set = new Set<string>();
  if (col.type === 'options' && col.auto.kind === 'options') {
    for (const v of col.auto.available) {
      const t = (v ?? '').trim();
      if (t) set.add(t);
    }
  }
  for (const byRound of index.samples.values()) {
    for (const rec of byRound.values()) {
      const t = (rec[col.id] ?? '').trim();
      if (t) set.add(t);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
}

/**
 * AND 필터(교집합): 모든 필터 조건을 만족하는 레코드만 통과. value는 trim 비교.
 * 같은 colId의 서로 다른 value 두 칩은 (한 셀이 두 값일 수 없으므로) 사실상 0행 — AND의 자연 귀결.
 * 빈 필터 목록은 전부 통과.
 */
export function applyFilters(
  rec: Record<string, string>,
  filters: ReviewFilter[],
): boolean {
  for (const f of filters) {
    if ((rec[f.colId] ?? '').trim() !== f.value.trim()) return false;
  }
  return true;
}

/**
 * target 회차로부터 n회차 전(strictly before) 회차. n=1이면 직전.
 * index.rounds는 오름차순. target이 rounds에 없으면(또는 그 앞에 n개 회차가 없으면) null.
 */
export function roundsBefore(
  index: PastIndex,
  target: string | null,
  n: number,
): string | null {
  if (!target || n < 1) return null;
  const r = index.rounds;
  const ti = r.indexOf(target);
  if (ti < 0) return null;
  const bi = ti - n;
  return bi >= 0 ? r[bi] : null;
}

/**
 * 비교탭 뷰를 한 번에 유도(집계 없음). 단계:
 *  1) targetRound = settings.reviewTargetRound ?? 최근 회차. baselineRound = roundsBefore(target, N).
 *  2) measures = isTrendEligible 컬럼(설정 지정 시 그 부분집합·순서). 비고(touch/text) 자연 제외.
 *  3) candidateRows = 각 키 중 target 회차 레코드가 있고 AND 필터를 통과하는 행(key 정렬, 1키=1행).
 *  4) 차원(키) 컬럼을 후보 행 기준 constant/variable로 분해. reviewGroupCols 지정 시 rowDims=그 집합.
 *  5) rows = reviewSelectedRows ∩ candidateRows(부분집합, null이면 전체). candidateRows 순서 보존.
 */
export function buildReviewView(index: PastIndex, settings: ReviewSettings): ReviewView {
  const cols = settings.columns;
  const byId = new Map(cols.map((c) => [c.id, c]));

  // ── 1) 회차 ──
  const rounds = index.rounds;
  const targetRound =
    settings.reviewTargetRound && rounds.includes(settings.reviewTargetRound)
      ? settings.reviewTargetRound
      : rounds.length > 0
        ? rounds[rounds.length - 1]
        : null;
  const baselineRound = roundsBefore(index, targetRound, Math.max(1, settings.reviewBaselineBack));

  // ── 2) 측정(적격만, 설정 지정 시 그 부분집합·순서) ──
  const eligibleMeasures = cols.filter((c) => isTrendEligible(c));
  const measures =
    settings.reviewMeasureCols === null
      ? eligibleMeasures
      : settings.reviewMeasureCols
          .map((id) => byId.get(id))
          .filter((c): c is Column => !!c && isTrendEligible(c));

  // ── 3) 후보 행(1키=1행, target 회차 레코드 + AND 필터) ──
  const candidateRows: ReviewRow[] = [];
  if (targetRound) {
    for (const [key, byRound] of index.samples) {
      const rec = byRound.get(targetRound);
      if (!rec) continue;
      if (!applyFilters(rec, settings.reviewFilters)) continue;
      candidateRows.push({ key, rec });
    }
  }
  candidateRows.sort((a, b) => a.key.localeCompare(b.key, 'ko', { numeric: true }));

  // ── 4) 차원(키) 컬럼 분해: 후보 행 기준 constant vs variable ──
  const keyCols = keyColumns(cols);
  const constantDims: Column[] = [];
  const variableDims: Column[] = [];
  for (const c of keyCols) {
    const vals = new Set(candidateRows.map((r) => (r.rec[c.id] ?? '').trim()));
    (vals.size <= 1 ? constantDims : variableDims).push(c);
  }
  // reviewGroupCols 지정 시: 표시 차원은 그 집합(키 컬럼·effectiveSampleKey 한정, 그 순서).
  const rowDims =
    settings.reviewGroupCols === null
      ? variableDims
      : settings.reviewGroupCols
          .map((id) => byId.get(id))
          .filter((c): c is Column => !!c && effectiveSampleKey(c));

  // ── 5) 표시 행(후보 부분집합) ──
  let rows: ReviewRow[];
  if (settings.reviewSelectedRows === null) {
    rows = candidateRows;
  } else {
    const wanted = new Set(settings.reviewSelectedRows);
    rows = candidateRows.filter((r) => wanted.has(r.key)); // 후보 외 키는 자동 제외(부분집합 불변)
  }

  return { targetRound, baselineRound, constantDims, rowDims, measures, candidateRows, rows };
}
