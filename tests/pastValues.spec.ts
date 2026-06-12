/**
 * v0.7.0 B2 — pastValues 순수 함수 단위 테스트 (audioTrim.spec.ts / koreanNum.spec.ts 패턴:
 * 브라우저 의존부(loadPastIndex fetch+캐시)는 제외하고 키 구성·헤더 매핑·날짜 정규화·
 * 인덱스 빌드·회차 조회를 Node에서 직접 검증).
 *
 * 커버리지:
 *  - keyColumns: effectiveSampleKey(유추 폴백 + 사용자 토글 우선)
 *  - buildSampleKey: trim-join, 빈 키 값 → null, 키 컬럼 0개 → null
 *  - resolveRoundCol: 명시 id > '조사일자' 우선 > 첫 date 컬럼 > null
 *  - normalizeDateCell: ISO / 한국식 점 / 슬래시 변형, 파싱 불가 → null
 *  - buildPastIndex: 헤더 정확 일치 매핑 + 헤더 개명 → unmappedColumns,
 *    (키,회차) 중복 마지막 행 승리 + duplicateCount, 멀티 회차 per-sample 조회
 *  - previousRound: 기준일 **미만(strictly)** — 당일은 자기 기준선이 안 됨
 */
import { test, expect } from '@playwright/test';
import {
  KEY_SEP,
  keyColumns,
  buildSampleKey,
  resolveRoundCol,
  normalizeDateCell,
  buildPastIndex,
  previousRound,
  pastValue,
} from '../src/lib/pastValues';
import type { Column } from '../src/types';

const col = (id: string, name: string, over: Partial<Column> = {}): Column => ({
  id,
  name,
  type: 'text',
  input: 'auto',
  ttsAnnounce: false,
  auto: { kind: 'fixed', value: '' },
  ...over,
});

/** 대표 스키마: date(회차) + auto 키 3개 + 음성 측정 1개 + 터치 메모 1개. */
const COLS: Column[] = [
  col('c1', '조사일자', { type: 'date' }),
  col('c3', '농가명'),
  col('c4', '라벨'),
  col('c6', '조사나무', { type: 'int' }),
  col('c8', '횡경', { type: 'float', input: 'voice', trendRule: 'increase' }),
  col('c10', '비고', { input: 'touch' }),
];

test.describe('keyColumns — 유추 폴백 + 사용자 토글', () => {
  test('sampleKey 미지정 → 유추(auto && !date)', () => {
    expect(keyColumns(COLS).map((c) => c.id)).toEqual(['c3', 'c4', 'c6']);
  });

  test('사용자 토글이 유추를 이긴다 (명시 false 제외, 명시 true 포함)', () => {
    const cols = [
      col('a', '농가명', { sampleKey: false }),                      // 유추 true지만 명시 false
      col('b', '횡경', { type: 'float', input: 'voice', sampleKey: true }), // 유추 false지만 명시 true
      col('c', '라벨'),
    ];
    expect(keyColumns(cols).map((c) => c.id)).toEqual(['b', 'c']);
  });
});

test.describe('buildSampleKey', () => {
  const keyCols = keyColumns(COLS); // c3, c4, c6

  test('값 trim 후 KEY_SEP join', () => {
    expect(buildSampleKey(keyCols, { c3: ' 이원창 ', c4: 'A', c6: '1' })).toBe(
      ['이원창', 'A', '1'].join(KEY_SEP),
    );
  });

  test('키 값 하나라도 비면(공백 포함) null', () => {
    expect(buildSampleKey(keyCols, { c3: '이원창', c4: '', c6: '1' })).toBeNull();
    expect(buildSampleKey(keyCols, { c3: '이원창', c4: '  ', c6: '1' })).toBeNull();
    expect(buildSampleKey(keyCols, { c3: '이원창', c6: '1' })).toBeNull(); // 누락도 동일
  });

  test('키 컬럼 0개 → null (기능 비활성 케이스)', () => {
    expect(buildSampleKey([], { c3: '이원창' })).toBeNull();
  });
});

test.describe('resolveRoundCol', () => {
  test('명시 id 우선', () => {
    const cols = [col('d1', '기준일자', { type: 'date' }), col('d2', '조사일자', { type: 'date' })];
    expect(resolveRoundCol(cols, 'd1')?.id).toBe('d1');
  });

  test("null → '조사일자' 이름 우선 (첫 date보다 우선)", () => {
    const cols = [col('d1', '기준일자', { type: 'date' }), col('d2', '조사일자', { type: 'date' })];
    expect(resolveRoundCol(cols, null)?.id).toBe('d2');
  });

  test("'조사일자' 없으면 첫 date 컬럼", () => {
    const cols = [col('t', '농가명'), col('d1', '기준일자', { type: 'date' })];
    expect(resolveRoundCol(cols, null)?.id).toBe('d1');
  });

  test('명시 id가 컬럼에 없으면 자동 규칙으로 폴백, date 0개면 null', () => {
    const cols = [col('d2', '조사일자', { type: 'date' })];
    expect(resolveRoundCol(cols, 'ghost')?.id).toBe('d2');
    expect(resolveRoundCol([col('t', '농가명')], null)).toBeNull();
  });
});

test.describe('normalizeDateCell', () => {
  const ok: Array<[string, string]> = [
    ['2026-05-13', '2026-05-13'],
    ['2026-5-3', '2026-05-03'],
    ['2026. 5. 13', '2026-05-13'],   // 한국식 점 + 공백
    ['2026.5.13.', '2026-05-13'],    // 점 밀착 + 말미 점
    ['2026/05/13', '2026-05-13'],
    ['5/13/2026', '2026-05-13'],     // Sheets 미국식 M/D/YYYY
    [' 2026-05-13 ', '2026-05-13'],  // 트림
  ];
  for (const [raw, want] of ok) {
    test(`'${raw}' → ${want}`, () => expect(normalizeDateCell(raw)).toBe(want));
  }

  const bad = ['', '   ', '오늘', '13/5', '2026-13-01', '2026-05-32', '0/13/2026', 'abc', '2026'];
  for (const raw of bad) {
    test(`'${raw}' → null`, () => expect(normalizeDateCell(raw)).toBeNull());
  }
  test('null/undefined → null', () => {
    expect(normalizeDateCell(null)).toBeNull();
    expect(normalizeDateCell(undefined)).toBeNull();
  });
});

// ─── buildPastIndex / previousRound / pastValue ────────────────────────────

const HEADERS = ['조사일자', '농가명', '라벨', '조사나무', '횡경', '종경']; // '종경'은 앱에 없음(무시), '비고'는 시트에 없음(unmapped)
const ROWS: string[][] = [
  ['2026-05-13', '이원창', 'A', '1', '111.1', '105.0'],
  ['2026. 5. 20', '이원창', 'A', '1', '122.2', '110.0'],  // 포맷 달라도 같은 회차 체계
  ['5/27/2026', '이원창', 'A', '1', '133.3', '120.0'],
  ['2026-05-27', '이원창', 'A', '1', '144.4', '121.0'],   // (키,회차) 중복 → 마지막 행 승리
  ['2026-05-20', '이원창', 'A', '2', '99.9', '95.0'],     // 다른 샘플
  ['2026-05-20', '', 'A', '3', '88.8', '80.0'],            // 키 불완전 → skip
  ['', '이원창', 'A', '4', '77.7', '70.0'],                 // 회차 불가 → skip
];
const KEY1 = ['이원창', 'A', '1'].join(KEY_SEP);
const KEY2 = ['이원창', 'A', '2'].join(KEY_SEP);

function makeIndex(columns = COLS, headers = HEADERS, rows = ROWS) {
  return buildPastIndex(headers, rows, columns, resolveRoundCol(columns, null));
}

test.describe('buildPastIndex', () => {
  test('헤더 매핑(정확 일치) + 시트에 없는 앱 컬럼 → unmappedColumns', () => {
    const idx = makeIndex();
    expect([...idx.headersMapped.keys()].sort()).toEqual(['c1', 'c3', 'c4', 'c6', 'c8']);
    expect(idx.headersMapped.get('c8')).toBe(4);
    expect(idx.unmappedColumns).toEqual(['비고']);
    expect(idx.rowCount).toBe(7);
  });

  test('헤더 개명(횡경 → 횡경(mm)) → unmapped + 해당 컬럼 과거값 없음', () => {
    const headers = ['조사일자', '농가명', '라벨', '조사나무', '횡경(mm)', '종경'];
    const idx = makeIndex(COLS, headers);
    expect(idx.unmappedColumns).toEqual(['횡경', '비고']);
    expect(pastValue(idx, KEY1, '2026-05-13', 'c8')).toBeNull();
    // 키·회차는 살아 있으므로 다른 컬럼 값은 정상
    expect(pastValue(idx, KEY1, '2026-05-13', 'c3')).toBe('이원창');
  });

  test('회차 오름차순 + 샘플별 멀티 회차 조회', () => {
    const idx = makeIndex();
    expect(idx.rounds).toEqual(['2026-05-13', '2026-05-20', '2026-05-27']);
    expect(idx.samples.size).toBe(2);
    expect(pastValue(idx, KEY1, '2026-05-13', 'c8')).toBe('111.1');
    expect(pastValue(idx, KEY1, '2026-05-20', 'c8')).toBe('122.2');
    expect(pastValue(idx, KEY2, '2026-05-20', 'c8')).toBe('99.9');
    expect(pastValue(idx, KEY2, '2026-05-13', 'c8')).toBeNull(); // 그 회차에 그 샘플 없음
  });

  test('(키,회차) 중복은 마지막 행 승리 + duplicateCount 집계', () => {
    const idx = makeIndex();
    expect(idx.duplicateCount).toBe(1);
    expect(pastValue(idx, KEY1, '2026-05-27', 'c8')).toBe('144.4'); // 133.3이 아니라 마지막 행
  });

  test('키 불완전/회차 불가 행은 조용히 skip', () => {
    const idx = makeIndex();
    const key3 = ['이원창', 'A', '3'].join(KEY_SEP);
    const key4 = ['이원창', 'A', '4'].join(KEY_SEP);
    expect(idx.samples.has(key3)).toBe(false);
    expect(idx.samples.has(key4)).toBe(false);
  });

  test('roundCol null → samples 빈 인덱스(기능 비활성), 매핑 정보는 유지', () => {
    const idx = buildPastIndex(HEADERS, ROWS, COLS, null);
    expect(idx.samples.size).toBe(0);
    expect(idx.rounds).toEqual([]);
    expect(idx.headersMapped.size).toBe(5);
  });
});

test.describe('previousRound — strictly before', () => {
  test('기준일 미만 중 가장 늦은 회차', () => {
    const idx = makeIndex();
    expect(previousRound(idx, KEY1, '2026-05-27')).toBe('2026-05-20');
    expect(previousRound(idx, KEY1, '2026-06-12')).toBe('2026-05-27');
  });

  test('당일(같은 날짜) 회차는 자기 기준선이 되지 않는다', () => {
    const idx = makeIndex();
    expect(previousRound(idx, KEY1, '2026-05-13')).toBeNull();
    expect(previousRound(idx, KEY1, '2026-05-20')).toBe('2026-05-13');
  });

  test('샘플별 독립 — KEY2는 05-20 회차만 보유', () => {
    const idx = makeIndex();
    expect(previousRound(idx, KEY2, '2026-05-27')).toBe('2026-05-20');
    expect(previousRound(idx, KEY2, '2026-05-20')).toBeNull();
  });

  test('미지의 키 → null', () => {
    const idx = makeIndex();
    expect(previousRound(idx, '없는 키', '2026-06-12')).toBeNull();
  });
});
