/**
 * autoValue.isCycling — 순수 단위 테스트 (koreanNum/audioTrim 패턴: Node 직접 import).
 *
 * v0.9.0 설정탭: 자동입력이 단일값이 아니라 **순차(seq)** 또는 **복수선택(options>1)** 으로
 * 바뀌면(= cycling) 음성확인(ttsAnnounce) 기본값을 '무'→'유'로 올린다. 그 판정의 SSOT가 isCycling.
 * 전이(transition) 기반이라, 한 번 cycling이 된 뒤 사용자가 수동으로 '무'로 되돌리면 보존돼야 한다.
 */
import { test, expect } from '@playwright/test';
import { isCycling } from '../src/lib/autoValue';
import type { Column } from '../src/types';

function col(over: Partial<Column>): Column {
  return {
    id: 'c1', name: 't', type: 'int', input: 'auto', ttsAnnounce: false,
    auto: { kind: 'fixed', value: '' }, ...over,
  };
}

test.describe('isCycling', () => {
  test('fixed(단일값) → 비순환', () => {
    expect(isCycling(col({ auto: { kind: 'fixed', value: '시험' } }))).toBe(false);
  });
  test('seq(순차) → 순환', () => {
    expect(isCycling(col({ auto: { kind: 'seq', from: 1, to: 5 } }))).toBe(true);
  });
  test('options 1개 선택 → 비순환(값 안 바뀜)', () => {
    expect(isCycling(col({ auto: { kind: 'options', available: ['A', 'B'], selected: ['A'] } }))).toBe(false);
  });
  test('options 2개 이상 선택 → 순환', () => {
    expect(isCycling(col({ auto: { kind: 'options', available: ['A', 'B'], selected: ['A', 'B'] } }))).toBe(true);
  });
  test('voice 입력은 자동입력이 아니므로 항상 비순환', () => {
    expect(isCycling(col({ input: 'voice', auto: { kind: 'seq', from: 1, to: 5 } }))).toBe(false);
  });
});

test.describe('ttsAnnounce 전이 규칙(store updateColumn이 쓰는 식) — 진입에서만 발동', () => {
  // 규칙: !isCycling(prev) && isCycling(next) 일 때만 ttsAnnounce=true.
  const enters = (prev: Column, next: Column) => !isCycling(prev) && isCycling(next);

  test('fixed → seq 진입: 전이 발동(유로 올림)', () => {
    expect(enters(col({ auto: { kind: 'fixed', value: '' } }), col({ auto: { kind: 'seq', from: 1, to: 3 } }))).toBe(true);
  });
  test('seq → seq(범위만 편집): 전이 미발동 → 수동 ttsAnnounce 값 보존', () => {
    const prev = col({ auto: { kind: 'seq', from: 1, to: 3 }, ttsAnnounce: false });
    const next = col({ auto: { kind: 'seq', from: 1, to: 9 }, ttsAnnounce: false });
    expect(enters(prev, next)).toBe(false); // 발동 안 함 → next.ttsAnnounce(false=수동 '무') 그대로
  });
  test('options 2개 → options 3개(여전히 순환): 전이 미발동 → 수동 무 보존', () => {
    const prev = col({ auto: { kind: 'options', available: ['A', 'B', 'C'], selected: ['A', 'B'] }, ttsAnnounce: false });
    const next = col({ auto: { kind: 'options', available: ['A', 'B', 'C'], selected: ['A', 'B', 'C'] }, ttsAnnounce: false });
    expect(enters(prev, next)).toBe(false);
  });
  test('seq → fixed(순환 해제): 전이 미발동', () => {
    expect(enters(col({ auto: { kind: 'seq', from: 1, to: 3 } }), col({ auto: { kind: 'fixed', value: '' } }))).toBe(false);
  });
});
