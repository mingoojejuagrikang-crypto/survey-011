import { test, expect } from '@playwright/test';
import { inferColumns, preserveInferredColumnIds } from '../src/lib/sheets';
import { effectiveSampleKey, preserveUserColumnSettings } from '../src/lib/columnFlags';
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

// ── v0.38.0 — 재연결이 사용자 컬럼 설정을 덮어쓰던 결함 회귀 ────────────────────
// 근인: 재로그인 자동 재연결(v0.13.0 R1)이 inferColumns로 컬럼을 통째로 재유추한다. 표본이 적으면
// 숫자 컬럼 고유값이 1개라 input='auto'로 판정돼, 사용자가 '음성'으로 둔 측정 컬럼이 되돌아갔다.

test('preserveUserColumnSettings — 소표본 재연결이 사용자 입력방식·샘플키를 되돌리지 않는다', () => {
  // 시즌 첫 회차: 데이터 행 1개뿐 → 횡경 고유값 1개 → inferColumns가 input='auto'로 유추한다.
  const inferred = preserveInferredColumnIds(
    inferColumns(['조사일자', '농가명', '횡경'], [['2026-07-21', '이원창', '111.1']]),
    [],
  );
  const 횡경Inferred = inferred[2];
  expect(횡경Inferred.input).toBe('auto'); // 결함을 만드는 전제 자체를 고정
  expect(effectiveSampleKey(횡경Inferred)).toBe(true);

  // 사용자가 실제로 쓰던 설정: 횡경은 음성 입력 측정 컬럼(= 샘플키 아님).
  const existing: Column[] = inferred.map((c, i) =>
    i === 2
      ? { ...c, input: 'voice', ttsAnnounce: true, trendRule: 'decrease', pctThreshold: 30, decimals: 1 }
      : c,
  );

  const merged = preserveUserColumnSettings(inferred, existing);
  const 횡경 = merged[2];

  expect(횡경.input).toBe('voice');           // 되돌아가지 않는다
  expect(횡경.trendRule).toBe('decrease');    // 추세 설정도 보존
  expect(횡경.pctThreshold).toBe(30);
  expect(effectiveSampleKey(횡경)).toBe(false); // 과거값 인덱스 지문이 흔들리지 않는다
  expect(횡경.name).toBe('횡경');              // 시트가 주는 값은 그대로
  expect(횡경.type).toBe('float');
});

test('preserveUserColumnSettings — type이 바뀌면 컬럼 의미가 달라진 것이라 재유추값을 쓴다', () => {
  const inferred = inferColumns(['비고'], [['2026-07-21']]); // 시트에서 date로 바뀜
  const existing: Column[] = [{ ...inferred[0], type: 'text', input: 'touch', sampleKey: true }];

  const merged = preserveUserColumnSettings(inferred, existing);

  expect(merged[0].type).toBe('date');
  expect(merged[0].input).toBe(inferred[0].input); // 보존하지 않는다(structural change)
  expect(merged[0].sampleKey).toBe(inferred[0].sampleKey);
});
