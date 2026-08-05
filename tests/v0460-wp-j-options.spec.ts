/**
 * v0.46.0 WP-J — 리스트(options) 값 갱신 계약.
 *
 * 이 스펙이 지키는 것은 **눈에 보이지 않는 계약**들이다. 정렬은 화면만 봐서는 회귀를 알 수 없고
 * (빈도순으로 조용히 되돌아가도 목록은 그럴듯해 보인다), 제외 목록은 "다음 갱신"이 와야 드러난다.
 *
 * DOM 의존이 없는 순수 함수라 Node에서 직접 import한다(sheets-infer-columns.spec.ts 패턴).
 */
import { test, expect } from '@playwright/test';
import { inferColumns, uniqueValuesRecentFirst } from '../src/lib/sheets';
import {
  applyExclusions,
  enrichOptionColumns,
  withExclusion,
  withoutExclusion,
} from '../src/lib/optionExclusions';
import type { Column } from '../src/types';

// ─── J-1 정렬: 최근 등장 우선 ────────────────────────────────────────────────

// 🔑 이 스펙의 핵심. **빈도순(종전 sheets.ts:161)으로 되돌아가면 반드시 실패한다** —
// '이원창'이 3회로 최다지만 마지막에 쓴 값은 '위미리3407'이다.
test('J-1 — 고유값은 최근 등장 우선. 빈도순으로 되돌아가면 깨진다', () => {
  const column = ['이원창', '이원창', '강남호', '이원창', '강남호', '위미리3407'];

  expect(uniqueValuesRecentFirst(column)).toEqual(['위미리3407', '강남호', '이원창']);

  // 반증: 빈도순이었다면 최다 등장인 '이원창'이 맨 앞이었을 것이다.
  const byFrequency = ['이원창', '강남호', '위미리3407'];
  expect(uniqueValuesRecentFirst(column)).not.toEqual(byFrequency);
});

test('J-1 — 같은 값이 여러 번 나오면 **마지막** 등장 위치로 줄을 선다', () => {
  // A가 처음에도 나오지만 마지막에 다시 나온다 → A가 맨 앞이어야 한다.
  expect(uniqueValuesRecentFirst(['A', 'B', 'C', 'A'])).toEqual(['A', 'C', 'B']);
});

test('J-1 — 공백은 다듬고 빈 값은 버린다(개수 상한은 없다)', () => {
  expect(uniqueValuesRecentFirst(['  이원창  ', '', '   ', '강남호'])).toEqual(['강남호', '이원창']);

  // 상한 없음: 300개를 넣으면 300개가 그대로 나온다(종전 500행/20개 상한의 흔적이 없어야 한다).
  const many = Array.from({ length: 300 }, (_, i) => `농가${i}`);
  expect(uniqueValuesRecentFirst(many)).toHaveLength(300);
  expect(uniqueValuesRecentFirst(many)[0]).toBe('농가299'); // 마지막에 쓴 것이 맨 앞
});

// ─── J-6 표기 흔들림: 정규화하지 않는다 ──────────────────────────────────────

test('J-6 — 공백 표기가 다른 값은 **합치지 않는다**(다른 농가일 수 있다)', () => {
  // 민구 시트 실데이터: 손입력이라 갈렸다. 앱은 어느 쪽이 옳은지 알 근거가 없으므로 둘 다 남기고,
  // 합치는 것은 사용자가 J-4 삭제로 한다. 🔴 여기에 정규화를 넣으면 이 테스트가 막는다.
  const out = uniqueValuesRecentFirst(['신례리 1365-1', '신례리816-1']);
  expect(out).toHaveLength(2);
  expect(out).toContain('신례리 1365-1');
  expect(out).toContain('신례리816-1');
});

// ─── J-2 리스트 승격 상한 폐지 ───────────────────────────────────────────────

test('J-2 — 고유값 21개 이상도 리스트가 된다(종전 ≤20 상한 폐지)', () => {
  // 종전 규칙에서는 21개째부터 'text'로 떨어져 리스트가 통째로 사라졌다.
  const sample = Array.from({ length: 25 }, (_, i) => [`농가${i}`]);
  const [col] = inferColumns(['농가명'], sample);

  expect(col.type).toBe('options');
  expect(col.auto.kind).toBe('options');
  if (col.auto.kind !== 'options') throw new Error('unreachable');
  expect(col.auto.available).toHaveLength(25);
});

test('J-2 — 승격된 선택지도 최근 등장 우선이고, 기본 선택은 가장 최근 값이다', () => {
  const [col] = inferColumns(['농가명'], [['이원창'], ['강남호'], ['위미리3407']]);
  if (col.auto.kind !== 'options') throw new Error('options로 승격되지 않았다');

  expect(col.auto.available).toEqual(['위미리3407', '강남호', '이원창']);
  expect(col.auto.selected).toEqual(['위미리3407']);
});

test('J-2 — 고유값이 1개면 여전히 고정값이다(리스트로 만들지 않는다)', () => {
  // 상한만 없앴다. "값이 하나뿐이면 자동·고정" 규칙은 건드리지 않았다.
  const [col] = inferColumns(['농가명'], [['이원창'], ['이원창']]);
  expect(col.type).toBe('text');
  expect(col.auto).toEqual({ kind: 'fixed', value: '이원창' });
});

// ─── J-5 제외 목록 ───────────────────────────────────────────────────────────

const optionsCol = (id: string, available: string[], selected: string[]): Column => ({
  id, name: '농가명', type: 'options', input: 'auto', ttsAnnounce: false,
  auto: { kind: 'options', available, selected },
});

test('J-5 — 지운 값은 시트 자동 갱신이 다시 넣지 않는다', async () => {
  const cols = [optionsCol('c3', ['이원창'], ['이원창'])];
  // 시트에는 지운 값이 여전히 있다(과거 데이터는 건드리지 않으므로 당연하다).
  const fromSheet = async () => ['양승보', '강남호', '이원창'];

  const out = await enrichOptionColumns(cols, { c3: ['강남호'] }, fromSheet);
  if (out[0].auto.kind !== 'options') throw new Error('unreachable');

  expect(out[0].auto.available).toEqual(['양승보', '이원창']); // 강남호가 걸러졌다
  expect(out[0].auto.available).not.toContain('강남호');
});

test('J-5 — 제외는 **컬럼별**이다. 농가명에서 지운 값이 라벨에 영향을 주지 않는다', async () => {
  const cols = [optionsCol('c3', [], []), optionsCol('c4', [], [])];
  const out = await enrichOptionColumns(cols, { c3: ['A'] }, async () => ['A', 'B']);

  if (out[0].auto.kind !== 'options' || out[1].auto.kind !== 'options') throw new Error('unreachable');
  expect(out[0].auto.available).toEqual(['B']);      // c3에서는 A가 빠지고
  expect(out[1].auto.available).toEqual(['A', 'B']); // c4에서는 남는다
});

test('J-5 — 시트 조회가 실패해도 지운 값이 되살아나지 않는다', async () => {
  // 네트워크 오류 한 번에 제외가 풀리면 "한 번 지우면 계속 유지"(R11)가 조용히 깨진다.
  const cols = [optionsCol('c3', ['이원창', '강남호'], ['강남호'])];
  const failing = async () => { throw new Error('네트워크 없음'); };

  const out = await enrichOptionColumns(cols, { c3: ['강남호'] }, failing);
  if (out[0].auto.kind !== 'options') throw new Error('unreachable');

  expect(out[0].auto.available).toEqual(['이원창']);
  expect(out[0].auto.selected).toEqual([]); // 선택 상태에서도 빠진다
});

test('J-5 — 리스트가 아닌 컬럼은 건드리지 않는다', async () => {
  const plain: Column = {
    id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true,
    auto: { kind: 'fixed', value: '' }, decimals: 1,
  };
  const out = await enrichOptionColumns([plain], { c8: ['111.1'] }, async () => ['999']);
  expect(out[0]).toEqual(plain);
});

test('J-5 — 제외 목록 넣기/빼기: 중복 없음, 비면 키 자체를 지운다', () => {
  const once = withExclusion({}, 'c3', '강남호');
  expect(once).toEqual({ c3: ['강남호'] });
  expect(withExclusion(once, 'c3', '강남호')).toBe(once); // 중복 추가는 원본 그대로

  // 다시 추가(J-4) = 제외 해제. 마지막 하나가 빠지면 키가 남지 않아야 한다.
  expect(withoutExclusion(once, 'c3', '강남호')).toEqual({});
  expect(withoutExclusion({ c3: ['A', 'B'] }, 'c3', 'A')).toEqual({ c3: ['B'] });
});

test('J-5 — 제외가 없으면 목록을 그대로 통과시킨다', () => {
  const vals = ['이원창', '강남호'];
  expect(applyExclusions(vals, [])).toBe(vals);
});
