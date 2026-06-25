/**
 * sessionLabel — 순수 단위 테스트 (autoValue/koreanNum 패턴: Node 직접 import, 서버 불필요).
 *
 * v0.22.0 — 세션명 SSOT(buildSessionLabel/sessionConstantValue)와 같은-날 고유화
 * (ensureUniqueSessionLabel)를 검증한다.
 *
 * 핵심 회귀(P2 근인):
 *  - 세션 식별 스키마: 농가명=고정 / 라벨=단일선택 options / 처리=다중선택(순환).
 *    이전 구현은 fixed만 봐 단일선택 options(라벨=A)를 놓쳐 `2026-06-25 강남호`로 잘렸다.
 *    이제 `2026-06-25 강남호 A`가 나와야 한다.
 *  - 날짜·순환(seq·다중옵션) 컬럼은 라벨에서 제외.
 *  - 자유입력(customName)이 있으면 무엇보다 우선(날짜 미접두).
 */

import { test, expect } from '@playwright/test';
import {
  buildSessionLabel,
  sessionConstantValue,
  ensureUniqueSessionLabel,
} from '../src/lib/sessionLabel';
import type { Column } from '../src/types';

function col(over: Partial<Column>): Column {
  return {
    id: 'c1', name: 't', type: 'text', input: 'auto', ttsAnnounce: false,
    auto: { kind: 'fixed', value: '' }, ...over,
  };
}

// 실제 세션 식별 스키마(농가명 고정 / 라벨 단일선택 / 처리 다중선택 / 조사일자 날짜 / 조사나무 seq).
function schema(): Column[] {
  return [
    col({ id: 'c1', name: '조사일자', type: 'date', auto: { kind: 'fixed', value: '오늘' } }),
    col({ id: 'c2', name: '농가명', auto: { kind: 'fixed', value: '강남호' } }),
    col({ id: 'c3', name: '라벨', type: 'options', auto: { kind: 'options', available: ['A', 'B'], selected: ['A'] } }),
    col({ id: 'c4', name: '처리', type: 'options', auto: { kind: 'options', available: ['시험', '관행'], selected: ['시험', '관행'] } }),
    col({ id: 'c5', name: '조사나무', type: 'int', auto: { kind: 'seq', from: 1, to: 10 } }),
    col({ id: 'c6', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' } }),
  ];
}

test.describe('sessionConstantValue — 세션 상수(행마다 안 바뀌는 유효 자동입력값)', () => {
  test('fixed 값 있음 → 그 값', () => {
    expect(sessionConstantValue(col({ auto: { kind: 'fixed', value: '강남호' } }))).toBe('강남호');
  });
  test('fixed 빈값 → ""', () => {
    expect(sessionConstantValue(col({ auto: { kind: 'fixed', value: '' } }))).toBe('');
  });
  test("fixed '오늘'(placeholder) → \"\"", () => {
    expect(sessionConstantValue(col({ type: 'date', auto: { kind: 'fixed', value: '오늘' } }))).toBe('');
  });
  test('단일선택 options → selected[0] (P2 신규 — 기존 누락분)', () => {
    expect(
      sessionConstantValue(col({ type: 'options', auto: { kind: 'options', available: ['A', 'B'], selected: ['A'] } })),
    ).toBe('A');
  });
  test('다중선택 options(순환) → "" (행마다 바뀜)', () => {
    expect(
      sessionConstantValue(col({ type: 'options', auto: { kind: 'options', available: ['A', 'B'], selected: ['A', 'B'] } })),
    ).toBe('');
  });
  test('seq(순환) → ""', () => {
    expect(sessionConstantValue(col({ type: 'int', auto: { kind: 'seq', from: 1, to: 10 } }))).toBe('');
  });
  test('date 컬럼(고정값) → "" (생성일이 이미 접두)', () => {
    expect(sessionConstantValue(col({ type: 'date', auto: { kind: 'fixed', value: '2026-05-13' } }))).toBe('');
  });
  test('voice 입력은 상수 아님 → ""', () => {
    expect(sessionConstantValue(col({ input: 'voice', auto: { kind: 'fixed', value: 'x' } }))).toBe('');
  });
});

test.describe('buildSessionLabel — 세션명 SSOT', () => {
  test('생성일 + 농가명 + 단일선택 라벨 (P2 기대 디폴트)', () => {
    expect(buildSessionLabel(schema(), { isoDate: '2026-06-25' })).toBe('2026-06-25 강남호 A');
  });
  test('상수가 하나도 없으면 생성일 단독', () => {
    const cols = [
      col({ id: 'c1', name: '조사일자', type: 'date', auto: { kind: 'fixed', value: '오늘' } }),
      col({ id: 'c2', name: '조사나무', type: 'int', auto: { kind: 'seq', from: 1, to: 10 } }),
      col({ id: 'c3', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' } }),
    ];
    expect(buildSessionLabel(cols, { isoDate: '2026-06-25' })).toBe('2026-06-25');
  });
  test('상수 join 순서는 columns 순서를 따른다', () => {
    const cols = [
      col({ id: 'c1', name: '농가명', auto: { kind: 'fixed', value: '강남호' } }),
      col({ id: 'c2', name: '라벨', type: 'options', auto: { kind: 'options', available: ['A'], selected: ['A'] } }),
      col({ id: 'c3', name: '구역', auto: { kind: 'fixed', value: '북1' } }),
    ];
    expect(buildSessionLabel(cols, { isoDate: '2026-06-25' })).toBe('2026-06-25 강남호 A 북1');
  });
  test('자유입력(customName)이 있으면 무엇보다 우선 — 날짜 미접두', () => {
    expect(buildSessionLabel(schema(), { isoDate: '2026-06-25', customName: '오전 1차' })).toBe('오전 1차');
  });
  test('자유입력 공백만이면 무시하고 자동 라벨로 폴백', () => {
    expect(buildSessionLabel(schema(), { isoDate: '2026-06-25', customName: '   ' })).toBe('2026-06-25 강남호 A');
  });
  test('isoDate 미지정이면 오늘 날짜(YYYY-MM-DD)로 시작', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(buildSessionLabel(schema())).toBe(`${today} 강남호 A`);
  });
});

test.describe('ensureUniqueSessionLabel — 같은-날 중복 방지(기존 유지)', () => {
  test('충돌 없으면 그대로', () => {
    expect(ensureUniqueSessionLabel('2026-06-25 강남호 A', [])).toBe('2026-06-25 강남호 A');
  });
  test('충돌하면 -2, -3 … 부여', () => {
    expect(
      ensureUniqueSessionLabel('2026-06-25 강남호 A', ['2026-06-25 강남호 A', '2026-06-25 강남호 A-2']),
    ).toBe('2026-06-25 강남호 A-3');
  });
});
