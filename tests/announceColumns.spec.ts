/**
 * announceColumns — 샘플 식별 라벨용 순수 셀렉터 단위 테스트 (v0.18.0 1b).
 *
 * announceColumns.ts는 DOM/브라우저 의존이 없어 직접 import해 Node(Playwright 러너)에서 돈다
 * (inputDevice.spec.ts / koreanNum.spec.ts와 동일 패턴, 새 도구 불필요). tests/ 아래 두어
 * 프로젝트 testDir 컨벤션으로 자동 발견되게 한다.
 *
 * 커버리지 초점:
 *  - isAnnounceColumn: input==='auto' && ttsAnnounce===true 술어(SSOT 미러).
 *  - getAnnounceColumns: 호명 대상만 원래 순서로 추림.
 *  - getSampleLabelParts: 빈 값 skip / prevValues=null이면 전부 changed / 값 변화 시에만 changed.
 */

import { test, expect } from '@playwright/test';
import {
  isAnnounceColumn,
  getAnnounceColumns,
  getSampleLabelParts,
} from '../src/lib/announceColumns';
import type { Column } from '../src/types';

function col(partial: Partial<Column> & { id: string }): Column {
  return {
    name: partial.id,
    type: 'text',
    input: 'auto',
    ttsAnnounce: true,
    auto: { kind: 'fixed', value: '' },
    ...partial,
  } as Column;
}

test.describe('isAnnounceColumn — 호명 술어(SSOT 미러)', () => {
  test('auto + ttsAnnounce=true → true', () => {
    expect(isAnnounceColumn({ input: 'auto', ttsAnnounce: true })).toBe(true);
  });
  test('auto + ttsAnnounce=false → false', () => {
    expect(isAnnounceColumn({ input: 'auto', ttsAnnounce: false })).toBe(false);
  });
  test('voice 컬럼은 ttsAnnounce여도 false (호명 대상 아님)', () => {
    expect(isAnnounceColumn({ input: 'voice', ttsAnnounce: true })).toBe(false);
  });
  test('touch 컬럼도 false', () => {
    expect(isAnnounceColumn({ input: 'touch', ttsAnnounce: true })).toBe(false);
  });
});

test.describe('getAnnounceColumns — 원래 순서 보존', () => {
  test('auto+ttsAnnounce만 원래 순서로 추린다', () => {
    const cols = [
      col({ id: 'tree', input: 'auto', ttsAnnounce: true }),
      col({ id: 'date', input: 'auto', ttsAnnounce: false }),
      col({ id: 'width', input: 'voice', ttsAnnounce: true }),
      col({ id: 'fruit', input: 'auto', ttsAnnounce: true }),
    ];
    expect(getAnnounceColumns(cols).map((c) => c.id)).toEqual(['tree', 'fruit']);
  });
});

test.describe('getSampleLabelParts — 라벨 파트 + 순차변화(changed)', () => {
  const cols = [
    col({ id: 'tree', name: '조사나무', input: 'auto', ttsAnnounce: true }),
    col({ id: 'fruit', name: '조사과실', input: 'auto', ttsAnnounce: true }),
    col({ id: 'width', name: '횡경', input: 'voice', ttsAnnounce: true }), // 호명 대상 아님(제외)
  ];

  test('prevValues=null(첫 행) → 비어있지 않은 파트 전부 changed', () => {
    const parts = getSampleLabelParts(cols, { tree: '1', fruit: '1' }, null);
    expect(parts.map((p) => p.col.id)).toEqual(['tree', 'fruit']);
    expect(parts.every((p) => p.changed)).toBe(true);
  });

  test('빈 값 컬럼은 제외한다', () => {
    const parts = getSampleLabelParts(cols, { tree: '1', fruit: '' }, null);
    expect(parts.map((p) => p.col.id)).toEqual(['tree']);
  });

  test('voice 컬럼 값이 있어도 라벨에 포함하지 않는다', () => {
    const parts = getSampleLabelParts(cols, { tree: '1', fruit: '1', width: '120' }, null);
    expect(parts.map((p) => p.col.id)).toEqual(['tree', 'fruit']);
  });

  test('이전 행과 다른 컬럼만 changed (순차변화 부분)', () => {
    // 조사나무 동일(1→1), 조사과실 변화(1→2): 과실만 changed.
    const parts = getSampleLabelParts(
      cols,
      { tree: '1', fruit: '2' },
      { tree: '1', fruit: '1' },
    );
    const byId = Object.fromEntries(parts.map((p) => [p.col.id, p.changed]));
    expect(byId).toEqual({ tree: false, fruit: true });
  });

  test('이전 값이 비고 현재 값이 있으면 changed', () => {
    const parts = getSampleLabelParts(cols, { tree: '1', fruit: '1' }, { tree: '1' });
    const byId = Object.fromEntries(parts.map((p) => [p.col.id, p.changed]));
    expect(byId).toEqual({ tree: false, fruit: true });
  });

  test('value 필드가 현재 자동값을 그대로 담는다', () => {
    const parts = getSampleLabelParts(cols, { tree: '3', fruit: '5' }, null);
    expect(parts.map((p) => p.value)).toEqual(['3', '5']);
  });
});
