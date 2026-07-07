/**
 * columnMapping.ts — pure-function unit tests ([SYNC-3] fix).
 *
 * No DOM/browser dependency (same pattern as koreanNum.spec.ts) — imported directly in Node.
 *
 * Coverage (per Larry's spec, 2026-07-07):
 *  (a) local <-> sheet schema exact match (order preserved) — existing behavior unchanged.
 *  (b) sheet has MORE columns than local (real scenario: columns added directly in the sheet).
 *  (c) column ORDER differs but names match — the case that tells apart name-based mapping from
 *      the old positional bug (positional would place values wrong; name-based must place right).
 *  Plus: missing local column (not in sheet), and total mismatch (zero matches) hard-fail signal.
 */
import { test, expect } from '@playwright/test';
import { mapColumnsToHeader, buildRowForMapping, buildSparseCellsForMapping } from '../src/lib/columnMapping';

const col = (id: string, name: string) => ({ id, name });

test.describe('mapColumnsToHeader', () => {
  test('(a) exact schema match, same order — every column maps to its own index', () => {
    const columns = [col('c1', '조사나무'), col('c2', '횡경'), col('c3', '종경')];
    const headers = ['조사나무', '횡경', '종경'];
    const m = mapColumnsToHeader(columns, headers);
    expect(m.indexForColId.get('c1')).toBe(0);
    expect(m.indexForColId.get('c2')).toBe(1);
    expect(m.indexForColId.get('c3')).toBe(2);
    expect(m.missingNames).toEqual([]);
  });

  test('(b) sheet has MORE columns than local (new columns inserted around ours)', () => {
    // Real A5 shape: local 2-col session, sheet grew to 6 columns with 2 new ones inserted BEFORE
    // and 2 AFTER the columns this session actually tracks.
    const columns = [col('c1', '조사나무'), col('c2', '횡경')];
    const headers = ['날짜', '비고', '조사나무', '신규컬럼A', '횡경', '신규컬럼B'];
    const m = mapColumnsToHeader(columns, headers);
    expect(m.indexForColId.get('c1')).toBe(2); // 조사나무 now sits at index 2, not 0
    expect(m.indexForColId.get('c2')).toBe(4); // 횡경 now sits at index 4, not 1
    expect(m.missingNames).toEqual([]);
  });

  test('(c) column ORDER differs, names identical — name-based mapping places values correctly', () => {
    const columns = [col('c1', '조사나무'), col('c2', '횡경')]; // local declares 조사나무 first
    const headers = ['횡경', '조사나무']; // sheet's real header has them swapped
    const m = mapColumnsToHeader(columns, headers);
    // A pure-positional scheme (colIds order) would have written c1's value at index 0 (WRONG —
    // that's the 횡경 column) and c2's value at index 1 (WRONG — that's 조사나무). Name-based
    // mapping must place each at its ACTUAL header position instead.
    expect(m.indexForColId.get('c1')).toBe(1); // 조사나무 is header index 1
    expect(m.indexForColId.get('c2')).toBe(0); // 횡경 is header index 0
  });

  test('local column not present in sheet header -> reported as missing, not guessed', () => {
    const columns = [col('c1', '조사나무'), col('c2', '신규측정')];
    const headers = ['조사나무']; // 신규측정 doesn't exist in the sheet yet
    const m = mapColumnsToHeader(columns, headers);
    expect(m.indexForColId.get('c1')).toBe(0);
    expect(m.indexForColId.has('c2')).toBe(false);
    expect(m.missingNames).toEqual(['신규측정']);
  });

  test('total schema mismatch — zero local columns found in header', () => {
    const columns = [col('c1', '조사나무'), col('c2', '횡경')];
    const headers = ['완전히다른헤더1', '완전히다른헤더2'];
    const m = mapColumnsToHeader(columns, headers);
    expect(m.indexForColId.size).toBe(0);
    expect(m.missingNames).toEqual(['조사나무', '횡경']);
  });

  test('header/column names are trimmed before comparison (whitespace-tolerant match)', () => {
    const columns = [col('c1', ' 조사나무 ')];
    const headers = ['조사나무'];
    const m = mapColumnsToHeader(columns, headers);
    expect(m.indexForColId.get('c1')).toBe(0);
  });
});

test.describe('buildRowForMapping', () => {
  test('(a) exact match — row values land at their own (0-based) index, in header order', () => {
    const columns = [col('c1', '조사나무'), col('c2', '횡경')];
    const headers = ['조사나무', '횡경'];
    const m = mapColumnsToHeader(columns, headers);
    const row = buildRowForMapping({ c1: '1', c2: '35.1' }, m);
    expect(row).toEqual(['1', '35.1']);
  });

  test('(b) sheet has more columns — unmatched interstitial/leading positions come back blank', () => {
    const columns = [col('c1', '조사나무'), col('c2', '횡경')];
    const headers = ['날짜', '비고', '조사나무', '신규컬럼A', '횡경', '신규컬럼B'];
    const m = mapColumnsToHeader(columns, headers);
    const row = buildRowForMapping({ c1: '3', c2: '41.3' }, m);
    // Width stops at the FURTHEST matched column (index 4 = 횡경) — trailing 신규컬럼B (index 5,
    // which this session doesn't own) is never touched at all (array doesn't even extend there).
    expect(row).toEqual(['', '', '3', '', '41.3']);
  });

  test('(c) column order differs — values land at the ACTUAL header position, not local order', () => {
    const columns = [col('c1', '조사나무'), col('c2', '횡경')];
    const headers = ['횡경', '조사나무'];
    const m = mapColumnsToHeader(columns, headers);
    const row = buildRowForMapping({ c1: '3', c2: '41.3' }, m);
    // Positional (old, buggy) code would have produced ['3', '41.3'] here (local declaration
    // order) — landing 조사나무's value in the 횡경 column and vice-versa. Name-based mapping
    // must produce the header-correct order instead.
    expect(row).toEqual(['41.3', '3']);
  });

  test('missing-in-sheet column contributes no value anywhere (not even a wrong slot)', () => {
    const columns = [col('c1', '조사나무'), col('c2', '신규측정')];
    const headers = ['조사나무'];
    const m = mapColumnsToHeader(columns, headers);
    const row = buildRowForMapping({ c1: '1', c2: '99.9' }, m);
    // Only the matched column produced a cell; the unmatched one's value ('99.9') appears nowhere.
    expect(row).toEqual(['1']);
    expect(row).not.toContain('99.9');
  });

  test('zero matches -> empty row (caller must treat this as a hard failure, not a blank success)', () => {
    const columns = [col('c1', '조사나무')];
    const headers = ['완전히다른헤더'];
    const m = mapColumnsToHeader(columns, headers);
    const row = buildRowForMapping({ c1: '1' }, m);
    expect(row).toEqual([]);
  });
});

test.describe('buildSparseCellsForMapping ([SYNC-3] follow-up — UPDATE path)', () => {
  test('interstitial (sheet-only) columns between mapped columns are NEVER represented', () => {
    // Local 6 columns map to header indices 0,1,5,6,7,8 (A,B,F,G,H,I). Header indices 2,3,4
    // (C,D,E) are sheet-only interstitial columns this app doesn't track at all.
    const columns = [
      col('c0', 'A'), col('c1', 'B'), col('c2', 'F'), col('c3', 'G'), col('c4', 'H'), col('c5', 'I'),
    ];
    const headers = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const m = mapColumnsToHeader(columns, headers);
    const values = { c0: 'a1', c1: 'b1', c2: 'f1', c3: 'g1', c4: 'h1', c5: 'i1' };
    const cells = buildSparseCellsForMapping(values, m);

    // Exactly 6 cells — one per mapped column. No entry for indices 2, 3, 4 (interstitial) AT ALL
    // — contrast with buildRowForMapping, which would produce a DENSE array padding those
    // positions with ''. A sparse list has no such slot to accidentally blank.
    expect(cells).toHaveLength(6);
    const indices = cells.map((c) => c.colIndex).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 5, 6, 7, 8]);
    expect(indices).not.toContain(2);
    expect(indices).not.toContain(3);
    expect(indices).not.toContain(4);

    const byIdx = Object.fromEntries(cells.map((c) => [c.colIndex, c.value]));
    expect(byIdx[0]).toBe('a1');
    expect(byIdx[1]).toBe('b1');
    expect(byIdx[5]).toBe('f1');
    expect(byIdx[6]).toBe('g1');
    expect(byIdx[7]).toBe('h1');
    expect(byIdx[8]).toBe('i1');
  });

  test('contrast with buildRowForMapping — the dense array DOES pad interstitial positions with \'\' (why sparse exists)', () => {
    const columns = [col('c0', 'A'), col('c1', 'F')];
    const headers = ['A', 'B', 'C', 'F']; // B, C are interstitial
    const m = mapColumnsToHeader(columns, headers);
    const dense = buildRowForMapping({ c0: 'a1', c1: 'f1' }, m);
    // Dense array necessarily fills index 1 (B) and 2 (C) with '' — this is exactly what a
    // contiguous-range PUT of this array would write over any existing sheet-only value there.
    expect(dense).toEqual(['a1', '', '', 'f1']);

    const sparse = buildSparseCellsForMapping({ c0: 'a1', c1: 'f1' }, m);
    // Sparse list only ever names the 2 mapped indices — 1 and 2 never appear.
    expect(sparse).toHaveLength(2);
    expect(sparse.map((c) => c.colIndex).sort((a, b) => a - b)).toEqual([0, 3]);
  });

  test('zero matches -> empty cell list (mirrors buildRowForMapping\'s empty-array hard-failure signal)', () => {
    const columns = [col('c1', '조사나무')];
    const headers = ['완전히다른헤더'];
    const m = mapColumnsToHeader(columns, headers);
    const cells = buildSparseCellsForMapping({ c1: '1' }, m);
    expect(cells).toEqual([]);
  });
});
