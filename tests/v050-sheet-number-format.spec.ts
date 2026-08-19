/**
 * v0.50 [DECIMAL-DISPLAY-1] 오라클 — **시트 표시 자리수는 셀 서식으로 간다**.
 *
 * ## 민구 제보 (2026-08-19 07:30)
 * > *"값 입력시 실수는 소수점까지 저장. 예: 40 >> 40.0 / 각 항목마다 유효 소수점이 존재"*
 *
 * ## 🔴 이 스펙이 잠그는 함정
 * `appendRow`가 `valueInputOption=USER_ENTERED`라 **`"40.0"` 문자열을 보내도 Sheets가 숫자 40으로
 * 강제**한다. 문자열 패딩으로 고치면 「고쳤는데 안 고쳐진」 것처럼 보인다 — 그래서 값이 아니라
 * **서식**을 바꾼다. 아래는 그 계획이 만드는 요청의 계약이다.
 *
 * ## 반증 축
 *  · float 게이트를 빼면 → ⓑ red(int/text/date에도 서식이 씌워진다)
 *  · 이름 매칭을 위치 매칭으로 바꾸면 → ⓒ red(남의 열에 서식을 씌운다)
 *  · `startRowIndex: 1`을 빼면 → ⓓ red(헤더 행까지 숫자 서식이 된다)
 *  · `fields`를 넓히면 → ⓓ red(색·테두리 등 남의 꾸밈을 지운다)
 */
import { test, expect } from '@playwright/test';
import {
  numberFormatPattern, planNumberFormats, buildNumberFormatRequests,
} from '../src/lib/sheetNumberFormat';

const HEADERS = ['조사일자', '농가명', '조사나무', '횡경', '종경', '비고'];

const COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date' },
  { id: 'cf', name: '농가명', type: 'text' },
  { id: 'c0', name: '조사나무', type: 'int', decimals: 0 },
  { id: 'm1', name: '횡경', type: 'float', decimals: 1 },
  { id: 'm2', name: '종경', type: 'float', decimals: 2 },
  { id: 'mx', name: '시트에없는열', type: 'float', decimals: 1 },
  { id: 'm3', name: '비고', type: 'float' }, // decimals 없음 — 유효 자리수가 정의되지 않았다
];

test('[node] ⓐ 자리수 → 패턴', () => {
  expect(numberFormatPattern(1)).toBe('0.0');
  expect(numberFormatPattern(2)).toBe('0.00');
  expect(numberFormatPattern(0), '0자리에 소수점을 붙이면 정수가 40.으로 보인다').toBe('0');
  // 방어: 음수·과대·소수 입력이 패턴을 깨뜨리지 않는다.
  expect(numberFormatPattern(-3)).toBe('0');
  expect(numberFormatPattern(99)).toBe(`0.${'0'.repeat(9)}`);
});

test('[node] ⓑ float + decimals 인 열만 고른다', () => {
  const specs = planNumberFormats(COLUMNS, HEADERS);
  expect(specs.map((s) => s.columnName), 'int·text·date·자리수미정 열까지 건드리면 남의 표시를 깬다')
    .toEqual(['횡경', '종경']);
  expect(specs.map((s) => s.pattern)).toEqual(['0.0', '0.00']);
});

test('[node] ⓒ 위치가 아니라 이름으로 맞춘다 — 열 순서가 바뀌어도 따라간다', () => {
  const shuffled = ['비고', '종경', '조사일자', '횡경', '농가명', '조사나무'];
  const specs = planNumberFormats(COLUMNS, shuffled);
  expect(specs.find((s) => s.columnName === '횡경')?.colIndex).toBe(3);
  expect(specs.find((s) => s.columnName === '종경')?.colIndex).toBe(1);
  // 헤더에 없는 컬럼은 조용히 빠진다(그 경고는 sync의 columnWarnings가 이미 낸다).
  expect(specs.some((s) => s.columnName === '시트에없는열')).toBe(false);
});

test('[node] ⓓ 요청은 헤더를 건너뛰고 numberFormat만 덮는다', () => {
  const reqs = buildNumberFormatRequests(1234, planNumberFormats(COLUMNS, HEADERS)) as {
    repeatCell: {
      range: { sheetId: number; startRowIndex: number; startColumnIndex: number; endColumnIndex: number };
      cell: { userEnteredFormat: { numberFormat: { type: string; pattern: string } } };
      fields: string;
    };
  }[];
  expect(reqs).toHaveLength(2);
  const first = reqs[0].repeatCell;
  expect(first.range.sheetId).toBe(1234);
  expect(first.range.startRowIndex, '헤더 행에 숫자 서식이 씌워진다').toBe(1);
  expect(first.range.endColumnIndex - first.range.startColumnIndex, '한 요청은 한 열만 덮는다').toBe(1);
  expect(first.cell.userEnteredFormat.numberFormat).toEqual({ type: 'NUMBER', pattern: '0.0' });
  expect(first.fields, 'fields를 넓히면 남의 색·테두리·글꼴을 지운다').toBe('userEnteredFormat.numberFormat');
});

test('[node] ⓔ 대상이 없으면 요청도 없다 — 빈 batchUpdate를 쏘지 않는다', () => {
  const specs = planNumberFormats([{ id: 'a', name: '농가명', type: 'text' }], HEADERS);
  expect(specs).toHaveLength(0);
  expect(buildNumberFormatRequests(1, specs)).toHaveLength(0);
});
