/**
 * v0.33.0 항목6 — 칩 터치 수동 입력의 순수 로직(SSOT).
 *
 * choicesFor: 컬럼 타입/설정에서 수동 입력 UI 종류를 결정한다(ManualValueSheet가 소비).
 *  - options            → 설정된 선택지 버튼 그리드(음성 매칭(matchOption)과 같은 allowed 목록)
 *  - int + auto seq     → 범위 버튼(SEQ_BUTTON_MAX 이하일 때만; 초과 시 키패드로 폴백)
 *  - int / float        → 키패드(float는 col.decimals 자리수 검증)
 *  - text / name        → 자유 입력(textarea)
 *  - date               → date input(YYYY-MM-DD)
 *
 * validateManual: 타입별 검증 + 정규화. 음성 경로의 parseValueForCol과 같은 계약(커밋 값은
 * 문자열)이되, 키보드/키패드 입력이라 한국어 수사 파싱은 하지 않는다. 실패 시 사용자에게
 * 그대로 보여줄 한국어 사유를 돌려준다(무음 거부 금지 — [REVIEW-4] 계열 원칙).
 */

import type { Column } from '../types';

/** seq 범위 버튼으로 펼치는 최대 개수 — 초과하면 키패드로 폴백(그리드가 화면을 넘지 않게). */
export const SEQ_BUTTON_MAX = 24;

export type ManualChoiceKind = 'options' | 'seq' | 'int' | 'float' | 'text' | 'date';

export interface ManualChoices {
  kind: ManualChoiceKind;
  /** kind==='options' — 버튼 그리드 선택지(설정의 selected 우선, 없으면 available). */
  options?: string[];
  /** kind==='seq' — from..to 범위 버튼 값들(문자열, ≤ SEQ_BUTTON_MAX). */
  seqValues?: string[];
}

/** options 컬럼의 허용 목록 — parseValueForCol의 matchOption과 동일 규칙(selected 우선). */
function optionsAllowed(col: Column): string[] {
  if (col.auto.kind !== 'options') return [];
  return col.auto.selected.length ? col.auto.selected : col.auto.available;
}

export function choicesFor(col: Column): ManualChoices {
  if (col.type === 'options') {
    return { kind: 'options', options: optionsAllowed(col) };
  }
  if (col.type === 'date') return { kind: 'date' };
  if (col.type === 'text' || col.type === 'name') return { kind: 'text' };
  if (col.type === 'int') {
    if (col.auto.kind === 'seq') {
      const { from, to } = col.auto;
      const count = to - from + 1;
      if (count >= 1 && count <= SEQ_BUTTON_MAX) {
        const seqValues: string[] = [];
        for (let v = from; v <= to; v++) seqValues.push(String(v));
        return { kind: 'seq', seqValues };
      }
    }
    return { kind: 'int' };
  }
  // float
  return { kind: 'float' };
}

export type ManualValidation =
  | { ok: true; value: string }
  | { ok: false; reason: string };

export function validateManual(col: Column, raw: string): ManualValidation {
  const t = raw.trim();
  if (t === '') return { ok: false, reason: '값을 입력해 주세요.' };

  if (col.type === 'options') {
    const allowed = optionsAllowed(col);
    return allowed.includes(t)
      ? { ok: true, value: t }
      : { ok: false, reason: '선택지에 없는 값입니다.' };
  }
  if (col.type === 'date') {
    return /^\d{4}-\d{2}-\d{2}$/.test(t)
      ? { ok: true, value: t }
      : { ok: false, reason: '날짜 형식(YYYY-MM-DD)이 아닙니다.' };
  }
  if (col.type === 'text' || col.type === 'name') {
    return { ok: true, value: t };
  }
  if (col.type === 'int') {
    if (!/^-?\d+$/.test(t)) return { ok: false, reason: '정수만 입력할 수 있습니다.' };
    const n = parseInt(t, 10);
    // seq 컬럼은 설정 범위를 벗어난 값을 거부(범위 버튼이 키패드로 폴백된 큰 범위 포함).
    if (col.auto.kind === 'seq' && (n < col.auto.from || n > col.auto.to)) {
      return { ok: false, reason: `${col.auto.from}~${col.auto.to} 범위를 벗어났습니다.` };
    }
    return { ok: true, value: String(n) };
  }
  // float — col.decimals 자리수까지만(음성 경로 parseKoreanNumber(raw, decimals)와 동일 상한).
  const decimals = col.decimals ?? 1;
  if (!/^-?\d+(\.\d+)?$/.test(t)) {
    return { ok: false, reason: '숫자만 입력할 수 있습니다. (예: 35.1)' };
  }
  const frac = t.split('.')[1] ?? '';
  if (frac.length > decimals) {
    return { ok: false, reason: `소수점 아래 ${decimals}자리까지만 입력할 수 있습니다.` };
  }
  return { ok: true, value: t };
}
