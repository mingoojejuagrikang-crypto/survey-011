/**
 * v0.6.0 review — sessionSync 순수 헬퍼 + sheets.colToA1 단위 테스트 (Node, 서버 불필요).
 *
 * koreanNum/audioTrim/sessionSnapshot 패턴: import.meta/IDB/Drive 의존 없는 순수 함수만 검증.
 *   F5/F6 — legacySyncedIndexSet / legacyDemoteCount: syncedRows는 "완료 행 개수"이지 인덱스가
 *           아니다. placeholder(complete:false)가 끼어도 어긋나지 않아야 한다.
 *   F8    — colToA1: 26/27/52/53 다중 레터 경계(A:Z 클램프 제거).
 *   recountSynced/hasSyncState/applyRowPatch — 공용 불변식.
 */
import { test, expect } from '@playwright/test';
import {
  hasSyncState,
  recountSynced,
  legacySyncedIndexSet,
  legacyDemoteCount,
} from '../src/lib/sessionSync';
import { applyRowPatch, isRowComplete as isRowCompleteHelper } from '../src/stores/dataStore';
import { colToA1, quoteSheetTitle } from '../src/lib/sheets';
import type { SessionRow } from '../src/types';

const row = (
  index: number,
  complete: boolean,
  extra: Partial<SessionRow> = {},
): SessionRow => ({ index, values: {}, complete, ...extra });

test.describe('F8 — colToA1 (multi-letter, no A:Z clamp)', () => {
  test('single-letter boundary', () => {
    expect(colToA1(1)).toBe('A');
    expect(colToA1(26)).toBe('Z');
  });
  test('27 → AA, 52 → AZ, 53 → BA (the columns the old clamp silently dropped)', () => {
    expect(colToA1(27)).toBe('AA');
    expect(colToA1(52)).toBe('AZ');
    expect(colToA1(53)).toBe('BA');
  });
  test('further multi-letter', () => {
    expect(colToA1(28)).toBe('AB');
    expect(colToA1(702)).toBe('ZZ');
    expect(colToA1(703)).toBe('AAA');
  });
  test('clamps below 1 to A', () => {
    expect(colToA1(0)).toBe('A');
    expect(colToA1(-3)).toBe('A');
  });
});

test.describe('C5 — quoteSheetTitle (A1 tab-name quoting for special chars)', () => {
  test('bare ascii titles are left unquoted', () => {
    expect(quoteSheetTitle('Sheet1')).toBe('Sheet1');
    expect(quoteSheetTitle('data_2026')).toBe('data_2026');
  });
  test('titles with "!" are quoted so the range delimiter is not misparsed', () => {
    // The bug: `Sheet!1!A5:B5` parsed as tab `Sheet` + bogus range → phantom mismatch → dup append.
    expect(quoteSheetTitle('Sheet!1')).toBe("'Sheet!1'");
  });
  test('spaces and digits-leading titles are quoted', () => {
    expect(quoteSheetTitle('My Tab')).toBe("'My Tab'");
    expect(quoteSheetTitle('2026 측정')).toBe("'2026 측정'");
  });
  test('inner single quotes are doubled (A1 escape)', () => {
    expect(quoteSheetTitle("O'Brien")).toBe("'O''Brien'");
    expect(quoteSheetTitle("a'b'c")).toBe("'a''b''c'");
  });
});

test.describe('C4 — isRowComplete (data-tab fill flips skip placeholder to complete)', () => {
  const cols = [
    { id: 'a', name: 'auto', type: 'int' as const, input: 'auto' as const, ttsAnnounce: false, auto: { kind: 'fixed' as const, value: '1' } },
    { id: 'v1', name: 'v1', type: 'float' as const, input: 'voice' as const, ttsAnnounce: true, auto: { kind: 'fixed' as const, value: '' } },
    { id: 'v2', name: 'v2', type: 'float' as const, input: 'voice' as const, ttsAnnounce: true, auto: { kind: 'fixed' as const, value: '' } },
  ];
  test('all voice cells filled ⇒ complete (auto cell irrelevant)', () => {
    expect(isRowCompleteHelper({ index: 1, values: { a: '1', v1: '3.1', v2: '4.2' }, complete: false }, cols)).toBe(true);
  });
  test('any voice cell empty ⇒ incomplete', () => {
    expect(isRowCompleteHelper({ index: 1, values: { a: '1', v1: '3.1', v2: '' }, complete: false }, cols)).toBe(false);
    expect(isRowCompleteHelper({ index: 1, values: { a: '1', v1: '3.1' }, complete: false }, cols)).toBe(false);
  });
  test('no voice columns ⇒ complete when any value present', () => {
    const autoOnly = [cols[0]];
    expect(isRowCompleteHelper({ index: 1, values: { a: '1' }, complete: false }, autoOnly)).toBe(true);
    expect(isRowCompleteHelper({ index: 1, values: { a: '' }, complete: false }, autoOnly)).toBe(false);
  });
});

test.describe('F5 — legacySyncedIndexSet (count of complete rows, not index)', () => {
  test('with a skip placeholder interleaved, count maps to COMPLETE rows only', () => {
    // index 1 (complete), 2 (skip/incomplete), 3 (complete). syncedRows=1 means "1 complete row
    // uploaded" → that's index 1, NOT "index <= 1" (which is the same here) — but the placeholder
    // must not consume a slot.
    const rows = [row(1, true), row(2, false), row(3, true)];
    expect([...legacySyncedIndexSet(rows, 1)]).toEqual([1]);
    // syncedRows=2 → first 2 COMPLETE rows = index 1 and 3 (the placeholder at 2 is skipped).
    expect([...legacySyncedIndexSet(rows, 2)].sort()).toEqual([1, 3]);
  });
  test('old index-based logic would wrongly include placeholder; count-based does not', () => {
    // placeholder at index 1, complete rows at 2,3. syncedRows=1.
    // index<=1 would mark the placeholder (wrong). Count-based marks the first complete row (2).
    const rows = [row(1, false), row(2, true), row(3, true)];
    expect([...legacySyncedIndexSet(rows, 1)]).toEqual([2]);
  });
  test('zero / empty', () => {
    expect(legacySyncedIndexSet([row(1, true)], 0).size).toBe(0);
    expect(legacySyncedIndexSet([], 3).size).toBe(0);
  });
});

test.describe('F6 — legacyDemoteCount (re-upload from edited row, count-based)', () => {
  test('editing a synced legacy row drops counter to # complete rows before it', () => {
    const rows = [row(1, true), row(2, false), row(3, true), row(4, true)];
    // edit index 3 → complete rows before it = index 1 only → 1.
    expect(legacyDemoteCount(rows, 3, 3)).toBe(1);
    // edit index 4 → complete rows before = index 1,3 → 2.
    expect(legacyDemoteCount(rows, 4, 3)).toBe(2);
  });
  test('never exceeds existing syncedRows', () => {
    const rows = [row(1, true), row(2, true), row(3, true)];
    expect(legacyDemoteCount(rows, 3, 1)).toBe(1); // before=2 but capped at syncedRows=1
  });
});

test.describe('hasSyncState / recountSynced', () => {
  test('hasSyncState true only when a row carries syncState', () => {
    expect(hasSyncState([row(1, true)])).toBe(false);
    expect(hasSyncState([row(1, true, { syncState: 'synced' })])).toBe(true);
  });
  test('recountSynced counts synced AND complete only (skip placeholders never count)', () => {
    const rows = [
      row(1, true, { syncState: 'synced' }),
      row(2, false, { syncState: 'synced' }), // synced placeholder — must NOT count
      row(3, true, { syncState: 'dirty' }),
    ];
    expect(recountSynced(rows)).toBe(1);
  });
});

test.describe('applyRowPatch — value changed ⇒ synced→dirty', () => {
  test('changing a synced row demotes it to dirty', () => {
    const r = row(1, true, { values: { c8: '35.1' }, syncState: 'synced' });
    const out = applyRowPatch(r, { c8: '99.9' });
    expect(out.syncState).toBe('dirty');
    expect(out.values.c8).toBe('99.9');
  });
  test('no-op when value unchanged keeps syncState (and same object)', () => {
    const r = row(1, true, { values: { c8: '35.1' }, syncState: 'synced' });
    const out = applyRowPatch(r, { c8: '35.1' });
    expect(out).toBe(r); // unchanged → identical reference, stays synced
    expect(out.syncState).toBe('synced');
  });
  test('dirty stays dirty; un-synced rows untouched', () => {
    const r = row(1, true, { values: { c8: '1' }, syncState: 'dirty' });
    expect(applyRowPatch(r, { c8: '2' }).syncState).toBe('dirty');
    const r2 = row(1, true, { values: { c8: '1' } });
    expect(applyRowPatch(r2, { c8: '2' }).syncState).toBeUndefined();
  });
});
