import { test, expect } from '@playwright/test';
import { inferColumns, preserveInferredColumnIds } from '../src/lib/sheets';
import type { Column } from '../src/types';

test('inferColumns uses deterministic column ids for the same headers', () => {
  const headers = ['조사일자', '농가명', '횡경', '종경'];
  const sample = [
    ['2026-07-01', '이원창', '111.1', '222.2'],
    ['2026-07-02', '이원창', '122.2', '233.3'],
  ];
  const first = inferColumns(headers, sample).map((c) => c.id);
  const second = inferColumns(headers, sample).map((c) => c.id);

  expect(second).toEqual(first);
  expect(first.every((id) => /^c[a-z0-9]+$/.test(id))).toBe(true);
});

test('preserveInferredColumnIds keeps existing unique ids so active row values remain addressable', () => {
  const inferred = inferColumns(['농가명', '횡경'], [['이원창', '111.1']]);
  const existing: Column[] = [
    {
      ...inferred[0],
      id: 'c0_1783401833639',
      name: '농가명',
    },
    {
      ...inferred[1],
      id: 'c7_1783401833639',
      name: '횡경',
    },
  ];

  const preserved = preserveInferredColumnIds(inferred, existing);
  expect(preserved.map((c) => c.id)).toEqual(['c0_1783401833639', 'c7_1783401833639']);
});

test('preserveInferredColumnIds does not guess when duplicate header names make id reuse ambiguous', () => {
  const inferred = inferColumns(['횡경', '횡경'], [['111.1', '222.2']]);
  const existing: Column[] = [
    { ...inferred[0], id: 'old-a', name: '횡경' },
    { ...inferred[1], id: 'old-b', name: '횡경' },
  ];

  const preserved = preserveInferredColumnIds(inferred, existing);
  expect(preserved.map((c) => c.id)).toEqual(inferred.map((c) => c.id));
});
