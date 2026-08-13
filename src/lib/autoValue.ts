import type { Column } from '../types';

/** Auto-cycling columns: seq, or options with selected.length > 1.
 *  Exported (v0.9.0): settingsStore uses it to flip a column's 음성확인(ttsAnnounce) default to
 *  '유' when an auto column *transitions* into a cycling kind (값이 행마다 바뀌므로 들려줘야 함).
 *
 *  🔴 **v0.46.0 콜드 리뷰 L2-2(critical) — 사람이 채우는 칸은 순환하지 않는다.**
 *  민구 확정(08-06): *"전체행은 **자동 입력 설정된 항목들이 미리 테이블을 만들고**, 수동이나
 *  음성입력이 만들어진 테이블을 채우는 형태야."* → **테이블 골격의 주체는 `input === 'auto'`뿐이다.**
 *
 *  종전엔 `voice`만 빼서 **`touch`(수동)가 순환 자릿수에 계속 참여**했다. 그래서 FB-A 패치가
 *  값 출력만 막았을 때 실측 결과가 이렇게 됐다(콜드 리뷰 L2):
 *  조사나무 seq 1~10 · 조사과실 seq 1~5에서 **조사과실만 수동으로** 바꾸면
 *  총 행 수가 **50 그대로**이고 조사나무가 `1,1,1,1,1,2,…` — **구분자 없는 중복 행 5개가 시트에
 *  기록됐다.** 이제 총 행 수는 **10**이 되고 조사나무는 `1,2,…,10`이다(민구 확정).
 *
 *  🔑 **`isUserInputColumn`과 술어를 통일하는 것이 계약이다** — 갈라지면 「값은 안 쓰는데 자릿수는
 *  먹는」 상태가 다시 생긴다. 그 불일치가 이 결함의 정체였다. */
export function isCycling(col: Column): boolean {
  if (isUserInputColumn(col)) return false;
  if (col.auto.kind === 'seq') return true;
  if (col.auto.kind === 'options' && col.auto.selected.length > 1) return true;
  return false;
}

function spanOf(col: Column): number {
  if (col.auto.kind === 'seq') {
    return Math.max(1, (col.auto.to || 1) - (col.auto.from || 1) + 1);
  }
  if (col.auto.kind === 'options') {
    return Math.max(1, col.auto.selected.length);
  }
  return 1;
}

/** 🔴 v0.49 r2 A7(합집합 C7) — **이 자동 컬럼의 값이 행마다 같은가.** `isCycling`의 부정이
 *  아니다: `seq from===to`(예: 조사나무 1~1 — 나무 한 그루짜리 세션)는 순환 컬럼으로 분류되지만
 *  자릿수가 1이라 모든 행에서 같은 값이다. 「순환 컬럼인가」와 「값이 변하는가」는 다른 질문이고,
 *  세션 고정 키 판정이 필요한 것은 후자다(`pastValues.sessionFixedKeyColumns`).
 *  자릿수 산출은 `spanOf` 하나가 SSOT — 여기서 from/to를 다시 계산하지 않는다. */
export function isRowInvariantAuto(col: Column): boolean {
  return !isUserInputColumn(col) && spanOf(col) === 1;
}

/**
 * Compute the auto-fill value for a given column on a given row index (1-based).
 * Returns '' for unset/empty fixed values so empty cells stay empty.
 */
export function autoValue(col: Column, row: number): string {
  if (col.auto.kind === 'seq') {
    const from = col.auto.from || 1;
    const span = spanOf(col);
    return String(from + ((row - 1) % span));
  }
  if (col.auto.kind === 'options') {
    const sel = col.auto.selected;
    if (sel.length === 0) return '';
    return sel[(row - 1) % sel.length];
  }
  if (col.type === 'date') {
    if (col.auto.kind === 'fixed' && col.auto.value && col.auto.value !== '오늘')
      return col.auto.value;
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
  if (col.auto.kind === 'fixed') return col.auto.value || '';
  return '';
}

export function computeTotalRows(columns: Column[]): number {
  const cyclers = columns.filter(isCycling);
  if (cyclers.length === 0) return 1;
  return cyclers.reduce((acc, c) => acc * spanOf(c), 1);
}

export function nestedAutoValue(columns: Column[], targetCol: Column, row: number): string {
  if (!isCycling(targetCol)) return autoValue(targetCol, row);

  const cyclers = columns.filter(isCycling);
  const idx = cyclers.indexOf(targetCol);
  if (idx < 0) return autoValue(targetCol, row);

  const spans = cyclers.map(spanOf);
  let divisor = 1;
  for (let i = idx + 1; i < spans.length; i++) divisor *= spans[i];
  const span = spans[idx];
  const offset = Math.floor((row - 1) / divisor) % span;

  if (targetCol.auto.kind === 'seq') {
    return String(targetCol.auto.from + offset);
  }
  if (targetCol.auto.kind === 'options') {
    return targetCol.auto.selected[offset] || '';
  }
  return autoValue(targetCol, row);
}

/**
 * Compute the new absolute row index when one cycling column's value changes,
 * preserving the offsets of all other cycling columns.
 *
 * Returns null if the new value is out of range or the column isn't cycling.
 */
export function computeRowFromAutoChange(
  columns: Column[],
  targetCol: Column,
  newValue: string,
  currentRow: number,
): number | null {
  if (!isCycling(targetCol)) return null;
  const cyclers = columns.filter(isCycling);
  const targetIdx = cyclers.indexOf(targetCol);
  if (targetIdx < 0) return null;
  const spans = cyclers.map(spanOf);

  // Current offsets per cycler
  const offsets: number[] = [];
  const cur = currentRow - 1;
  for (let i = 0; i < cyclers.length; i++) {
    let divisor = 1;
    for (let j = i + 1; j < cyclers.length; j++) divisor *= spans[j];
    offsets[i] = Math.floor(cur / divisor) % spans[i];
  }

  // New offset for target
  let newOffset: number | null = null;
  if (targetCol.auto.kind === 'seq') {
    const from = targetCol.auto.from;
    const n = parseInt(newValue, 10);
    if (Number.isNaN(n)) return null;
    newOffset = n - from;
  } else if (targetCol.auto.kind === 'options') {
    newOffset = targetCol.auto.selected.indexOf(newValue);
  }
  if (newOffset === null || newOffset < 0 || newOffset >= spans[targetIdx]) return null;
  offsets[targetIdx] = newOffset;

  // Recombine
  let r = 0;
  for (let i = 0; i < cyclers.length; i++) {
    let divisor = 1;
    for (let j = i + 1; j < cyclers.length; j++) divisor *= spans[j];
    r += offsets[i] * divisor;
  }
  return r + 1;
}

/** 🔴 v0.46.0 FB-A(민구 제보 08-06) — **사용자가 채우는 컬럼은 자동값 합성에서 빠진다.**
 *
 *  민구 원문: *"비고란 수동입력 설정이나, 테이블 미리보기에 이미 입력됨"* + 정정 시 질문
 *  *"비고란에 값이 있으면 텍스트로 배정시 자동으로 따라 붙는 게 아닌가 싶었어."*
 *  → **답은 「그렇다, 그리고 그건 결함이다」.**
 *
 *  종전엔 `input === 'voice'`만 건너뛰어 **수동(`touch`)이 자동(`auto`)과 동일 취급**됐다.
 *  `input`을 '자동'→'수동'으로 바꿔도 `auto` 설정이 컬럼에 남아 있어 그 잔재가 계산돼 들어갔고,
 *  🔴 **미리보기 표시만이 아니라 `composeRowValues` → `persistSession` 경로로 실제 시트에도
 *  기록됐다**(사용자가 그 행을 손대지 않으면 덮이지 않는다).
 *
 *  🔑 `voice`와 `touch`는 **둘 다 「사람이 넣는 값」**이다. 값의 출처가 세션 스토어이지 자동
 *  계산이 아니라는 점에서 같다 — 그래서 한 술어로 묶는다. 키가 빠지면 소비처가 `?? ''`로
 *  받는다(`useVoiceSession:472`·`sheets.ts:167`) — **음성 컬럼이 이미 그 경로로 동작해 왔다.**
 *
 *  ⚠️ `auto` 설정 자체는 **지우지 않는다.** '수동'→'자동'으로 되돌릴 때 설정을 잃지 않게 한다. */
export function isUserInputColumn(c: Column): boolean {
  return c.input === 'voice' || c.input === 'touch';
}

/**
 * Cycling values that are auto-derived for the given row. Useful for diffing
 * "changed since previous row" announcements.
 */
export function buildCyclingValues(
  columns: Column[],
  row: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of columns) {
    if (isUserInputColumn(c)) continue;
    out[c.id] = nestedAutoValue(columns, c, row);
  }
  return out;
}
