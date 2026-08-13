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
  latestTwoRounds,
  pastValue,
  sessionFixedKeyColumns,
  previousSurveyRound,
  serializePastIndexEntry,
  deserializePastIndexEntry,
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

// ─── v0.49.0 W3(FB-3) — 세션 고정 샘플키 · 이전 조사일 ──────────────────────
//
// 민구 확정(08-13): 설정요약의 「이전 조사」 기준은 **세션 전체에 공통 고정된 샘플키 항목 조합**
// (*"해당 세션의 모든 데이터에서 공통적으로 사용되는 항목들의 조합. 지금의 경우는 '농가명'+'라벨'."*).
// 컬럼 이름은 규칙에 등장하지 않는다(시트 스키마 불특정이 계약) — 아래 두 번째 describe가
// **완전히 다른 스키마**로 같은 규칙이 성립함을 증명한다.

/** 현 스키마 근사: 조사일자(회차) · 농가명(fixed) · 라벨(단일선택) · 조사나무(seq) · 측정 2개. */
const W3_COLS: Column[] = [
  col('c1', '조사일자', { type: 'date', auto: { kind: 'fixed', value: '오늘' } }),
  col('c3', '농가명', { auto: { kind: 'fixed', value: '이원창' } }),
  col('c4', '라벨', { auto: { kind: 'options', available: ['A', 'B'], selected: ['A'] } }),
  col('c6', '조사나무', { type: 'int', auto: { kind: 'seq', from: 1, to: 2 } }),
  col('c8', '횡경', { type: 'float', input: 'voice', trendRule: 'increase' }),
  col('c10', '비고', { input: 'touch' }),
];

const w3Index = (columns = W3_COLS, headers = HEADERS, rows = ROWS) =>
  buildPastIndex(headers, rows, columns, resolveRoundCol(columns, null));

test.describe('sessionFixedKeyColumns — 세션 고정 샘플키 판정', () => {
  test('현 스키마: 고정값(fixed) + 단일선택(options)만 — 순환·회차·측정 컬럼 제외', () => {
    expect(sessionFixedKeyColumns(W3_COLS, null).map((c) => c.id)).toEqual(['c3', 'c4']);
  });

  test('다중선택 options는 행마다 바뀌므로 제외(단일선택일 때만 고정)', () => {
    const multi = W3_COLS.map((c) =>
      c.id === 'c4' ? col('c4', '라벨', { auto: { kind: 'options', available: ['A', 'B'], selected: ['A', 'B'] } }) : c,
    );
    expect(sessionFixedKeyColumns(multi, null).map((c) => c.id)).toEqual(['c3']);
  });

  test('조사시기 컬럼은 샘플키로 토글돼도 제외 — 시간축이지 식별축이 아니다', () => {
    const cols = W3_COLS.map((c) =>
      c.id === 'c1' ? col('c1', '조사일자', { type: 'date', auto: { kind: 'fixed', value: '2026-05-20' }, sampleKey: true }) : c,
    );
    expect(sessionFixedKeyColumns(cols, null).map((c) => c.id)).toEqual(['c3', 'c4']);
    // 명시 roundDateColId로 지정한 다른 date 컬럼도 같은 규칙
    expect(sessionFixedKeyColumns(cols, 'c1').map((c) => c.id)).toEqual(['c3', 'c4']);
  });

  test('사용자 입력(voice·touch) 컬럼은 샘플키 토글 + auto 값 잔재가 있어도 제외', () => {
    const cols = W3_COLS.map((c) =>
      c.id === 'c8'
        ? col('c8', '횡경', { type: 'float', input: 'voice', sampleKey: true, auto: { kind: 'fixed', value: '111.1' } })
        : c,
    );
    expect(sessionFixedKeyColumns(cols, null).map((c) => c.id)).toEqual(['c3', 'c4']);
  });

  test('값이 빈 고정 컬럼은 대조 기준이 못 되므로 제외', () => {
    const cols = W3_COLS.map((c) => (c.id === 'c3' ? col('c3', '농가명', { auto: { kind: 'fixed', value: '  ' } }) : c));
    expect(sessionFixedKeyColumns(cols, null).map((c) => c.id)).toEqual(['c4']);
  });

  test('사용자가 샘플키를 전부 끄면 빈 배열(기능 비활성)', () => {
    const cols = W3_COLS.map((c) => ({ ...c, sampleKey: false }));
    expect(sessionFixedKeyColumns(cols, null)).toEqual([]);
  });

  // 🔴 v0.49 r2 A7(합집합 C7) — 판정 질문은 「순환 컬럼인가」가 아니라 「값이 변하는가」다.
  test('seq from===to(나무 한 그루 세션)는 값이 불변이므로 고정 키다', () => {
    const cols = W3_COLS.map((c) =>
      c.id === 'c6' ? col('c6', '조사나무', { type: 'int', auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true }) : c,
    );
    expect(sessionFixedKeyColumns(cols, null).map((c) => c.id)).toEqual(['c3', 'c4', 'c6']);
  });

  test('seq from<to는 종전대로 제외(행마다 값이 바뀐다)', () => {
    // 대조군 — A7이 「순환 전체」를 열어버리지 않았음을 고정한다.
    const cols = W3_COLS.map((c) =>
      c.id === 'c6' ? col('c6', '조사나무', { type: 'int', auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true }) : c,
    );
    expect(sessionFixedKeyColumns(cols, null).map((c) => c.id)).toEqual(['c3', 'c4']);
  });

  // 🔴 v0.49 r2 A8(합집합 C12) — 회차로 뽑히지 **못한** 두 번째 date 컬럼(유물)도 제외한다.
  test('유물 date 컬럼(값=오늘)이 샘플키로 켜져 있어도 제외 — 세션마다 값이 달라 영영 불일치', () => {
    const cols = [
      ...W3_COLS,
      col('c9', '수확일자', { type: 'date', auto: { kind: 'fixed', value: '오늘' }, sampleKey: true }),
    ];
    // 회차 컬럼은 c1(조사일자) 하나만 뽑힌다 — c9는 종전엔 그대로 고정 키로 섞여 들어갔다.
    expect(sessionFixedKeyColumns(cols, null).map((c) => c.id)).toEqual(['c3', 'c4']);
  });

  test('리터럴 고정일 date 컬럼은 정당한 식별 키다(타입이 아니라 값의 동적성으로 가른다)', () => {
    // 대조군 — A8이 date 타입 전체를 배제하지 않았음을 고정한다(예: 정식일자).
    const cols = [
      ...W3_COLS,
      col('c9', '정식일자', { type: 'date', auto: { kind: 'fixed', value: '2026-03-01' }, sampleKey: true }),
    ];
    expect(sessionFixedKeyColumns(cols, null).map((c) => c.id)).toEqual(['c3', 'c4', 'c9']);
  });

  test('seq from===to가 유일한 샘플키여도 조회가 성립한다(고정 키 0개로 떨어지지 않는다)', () => {
    const cols = W3_COLS.map((c) =>
      c.id === 'c6'
        ? col('c6', '조사나무', { type: 'int', auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true })
        : { ...c, sampleKey: false },
    );
    expect(sessionFixedKeyColumns(cols, null).map((c) => c.id)).toEqual(['c6']);
  });
});

test.describe('previousSurveyRound — 세션 고정 키의 직전 조사일', () => {
  test('현 스키마(농가명+라벨): 오늘 미만 최신 회차', () => {
    // 이원창/A 조합은 05-13(나무1) · 05-20(나무1,2) · 05-27(나무1)에 존재 → 최신 05-27
    expect(previousSurveyRound(w3Index(), W3_COLS, null, '2026-06-12')).toEqual({ kind: 'date', iso: '2026-05-27' });
  });

  test('strictly < — 당일 회차는 자기 기준선이 되지 않는다', () => {
    const idx = w3Index();
    expect(previousSurveyRound(idx, W3_COLS, null, '2026-05-27')).toEqual({ kind: 'date', iso: '2026-05-20' });
    expect(previousSurveyRound(idx, W3_COLS, null, '2026-05-20')).toEqual({ kind: 'date', iso: '2026-05-13' });
    // 더 과거가 없으면 「조회는 했는데 기록 0건」이다 — 조회 불가와 다른 상태다(A5).
    expect(previousSurveyRound(idx, W3_COLS, null, '2026-05-13')).toEqual({ kind: 'none' });
  });

  test('세션 안의 여러 샘플(조사나무 1·2)을 가로질러 가장 늦은 회차를 고른다', () => {
    // 나무1은 05-27까지, 나무2는 05-20까지 — 세션 기준이므로 05-27이어야 한다(샘플별 조회가 아니다).
    expect(previousSurveyRound(w3Index(), W3_COLS, null, '2026-05-28')).toEqual({ kind: 'date', iso: '2026-05-27' });
  });

  test("일치 기록 0건 → { kind: 'none' } (다른 농가)", () => {
    const cols = W3_COLS.map((c) => (c.id === 'c3' ? col('c3', '농가명', { auto: { kind: 'fixed', value: '없는농가' } }) : c));
    expect(previousSurveyRound(w3Index(cols), cols, null, '2026-06-12')).toEqual({ kind: 'none' });
  });

  test("일치 기록 0건 → { kind: 'none' } (같은 농가, 다른 라벨)", () => {
    const cols = W3_COLS.map((c) =>
      c.id === 'c4' ? col('c4', '라벨', { auto: { kind: 'options', available: ['A', 'B'], selected: ['B'] } }) : c,
    );
    expect(previousSurveyRound(w3Index(cols), cols, null, '2026-06-12')).toEqual({ kind: 'none' });
  });

  // 🔴 v0.49 r2 A5(codex F4) — 아래 둘은 **조회 결과가 아니다.** 종전엔 위 「기록 0건」과 같은
  //    `null`이라 호출부가 구분할 수 없었고, 설정요약이 셋 다 「기록 없음」으로 그렸다.
  test("고정 키 0개 → { kind: 'unqueryable', reason: 'no_fixed_key' } (조회 포기)", () => {
    const cols = W3_COLS.map((c) => ({ ...c, sampleKey: false }));
    expect(previousSurveyRound(w3Index(cols), cols, null, '2026-06-12'))
      .toEqual({ kind: 'unqueryable', reason: 'no_fixed_key' });
  });

  test("고정 키 컬럼이 시트에 미매핑이면 { kind: 'unqueryable', reason: 'headers_unmapped' } (헤더 개명)", () => {
    const headers = ['조사일자', '농가명(구)', '라벨', '조사나무', '횡경', '종경'];
    expect(previousSurveyRound(w3Index(W3_COLS, headers), W3_COLS, null, '2026-06-12'))
      .toEqual({ kind: 'unqueryable', reason: 'headers_unmapped' });
  });

  // ─── 🔴 v0.49 r3 #3 — **시간축 붕괴도 조회 불가다.** ─────────────────────────────
  // A5는 샘플 식별축(고정 키)만 갈랐다. 회차 축이 무너지면 `buildPastIndex`가 `if (!round)
  // continue`로 **모든 행을 버려** samples가 통째로 비고, 아래 이중 루프는 0건을 돌아 종전엔
  // `{ kind: 'none' }`을 돌려줬다 — 조회가 성립조차 안 했는데 화면은 '기록 없음'이라고 단정한다.
  // 사용자가 내리는 틀린 결론(「과거 기록이 없구나」)은 A5가 막으려던 것과 **같다**.
  test("회차(date) 컬럼이 아예 없으면 { reason: 'no_round_col' } — '기록 없음'이 아니다", () => {
    const cols = W3_COLS.filter((c) => c.id !== 'c1');
    const headers = ['농가명', '라벨', '조사나무', '횡경', '종경'];
    const rows = [['이원창', 'A', '1', '10', '20']];
    const idx = buildPastIndex(headers, rows, cols, resolveRoundCol(cols, null));
    expect(idx.samples.size, '전제: 회차를 못 읽어 인덱스가 비어 있다').toBe(0);
    expect(previousSurveyRound(idx, cols, null, '2026-06-12'))
      .toEqual({ kind: 'unqueryable', reason: 'no_round_col' });
  });

  test("회차 컬럼이 시트에 미매핑이면 { reason: 'round_unmapped' } (조사일자만 개명)", () => {
    const headers = ['조사일자(구)', '농가명', '라벨', '조사나무', '횡경', '종경'];
    const idx = w3Index(W3_COLS, headers);
    expect(idx.samples.size, '전제: 회차 열을 못 찾아 전 행이 skip된다').toBe(0);
    expect(previousSurveyRound(idx, W3_COLS, null, '2026-06-12'))
      .toEqual({ kind: 'unqueryable', reason: 'round_unmapped' });
  });

  test("데이터 행은 있는데 파싱 가능한 회차가 0개면 { reason: 'round_unindexed' } (서식 불일치)", () => {
    const headers = ['조사일자', '농가명', '라벨', '조사나무', '횡경', '종경'];
    const rows = [
      ['2026년 5월 13일', '이원창', 'A', '1', '10', '20'], // normalizeDateCell 미지원 서식
      ['13.05.2026', '이원창', 'A', '2', '11', '21'],       // 일-월-연
    ];
    const idx = buildPastIndex(headers, rows, W3_COLS, resolveRoundCol(W3_COLS, null));
    expect(idx.rowCount, '전제: 행은 읽혔다').toBe(2);
    expect(idx.rounds.length, '전제: 회차는 하나도 인덱싱되지 않았다').toBe(0);
    expect(previousSurveyRound(idx, W3_COLS, null, '2026-06-12'))
      .toEqual({ kind: 'unqueryable', reason: 'round_unindexed' });
  });

  // ─── 🔴 v0.49 r4 M8(claude r3 #11) — **키 탈락과 회차 미인덱싱을 가른다.** ──────────
  // `buildPastIndex`의 루프는 샘플키가 없는 행을 회차 집계 **전에** 버린다. 그래서 키가 전량
  // 탈락하면 회차 축은 멀쩡한데 `rounds`가 비고, 위 `round_unindexed` 가드가 그것까지 삼켰다 —
  // 사유가 시간축(서식 불일치)이라고 말하니 다음 회차의 수리가 엉뚱한 축으로 간다.
  test("회차는 읽혔는데 샘플키가 붙은 행이 0줄이면 { reason: 'no_keyed_rows' } — 시간축 오진 차단", () => {
    const headers = ['조사일자', '농가명', '라벨', '조사나무', '횡경', '종경'];
    // 회차는 정상 서식인데 샘플키 컬럼(농가명·라벨)이 전량 공백 → buildSampleKey가 null.
    const rows = [
      ['2026-05-13', '', '', '1', '10', '20'],
      ['2026-05-20', '', '', '2', '11', '21'],
    ];
    const idx = buildPastIndex(headers, rows, W3_COLS, resolveRoundCol(W3_COLS, null));
    expect(idx.rowCount, '전제: 행은 읽혔다').toBe(2);
    expect(idx.rounds.length, '전제: 키 탈락으로 회차 집계까지 비었다').toBe(0);
    expect(idx.roundParsedRows, '회차 축 자체는 두 줄 다 읽혔다').toBe(2);
    expect(previousSurveyRound(idx, W3_COLS, null, '2026-06-12'))
      .toEqual({ kind: 'unqueryable', reason: 'no_keyed_rows' });
  });

  test('대조군 — 회차 서식이 깨진 경우는 여전히 round_unindexed다(두 사유가 안 섞인다)', () => {
    const headers = ['조사일자', '농가명', '라벨', '조사나무', '횡경', '종경'];
    const rows = [['2026년 5월 13일', '이원창', 'A', '1', '10', '20']];
    const idx = buildPastIndex(headers, rows, W3_COLS, resolveRoundCol(W3_COLS, null));
    expect(idx.roundParsedRows, '회차가 한 줄도 안 읽혔다').toBe(0);
    expect(previousSurveyRound(idx, W3_COLS, null, '2026-06-12'))
      .toEqual({ kind: 'unqueryable', reason: 'round_unindexed' });
  });

  test('구버전 영속 레코드(roundParsedRows 없음)는 폐기되지 않고 종전 판정으로 복원된다', () => {
    const headers = ['조사일자', '농가명', '라벨', '조사나무', '횡경', '종경'];
    const rows = [['2026-05-13', '', '', '1', '10', '20']];
    const idx = buildPastIndex(headers, rows, W3_COLS, resolveRoundCol(W3_COLS, null));
    const rec = serializePastIndexEntry({ fp: 'fp-old', builtAt: 1, index: idx });
    // 이 필드 이전에 저장된 백업 = 키가 아예 없다. 형태 검증에 넣었다면 여기서 null이 된다.
    const legacy = { ...rec } as Record<string, unknown>;
    delete legacy.roundParsedRows;
    const restored = deserializePastIndexEntry(legacy);
    expect(restored, '구버전 백업이 통째로 폐기되면 14일 폴백이 끊긴다').not.toBeNull();
    expect(restored!.index.roundParsedRows, '없으면 0 = 종전 판정').toBe(0);
    expect(previousSurveyRound(restored!.index, W3_COLS, null, '2026-06-12'))
      .toEqual({ kind: 'unqueryable', reason: 'round_unindexed' });
  });

  test('데이터 행 자체가 0줄이면 그건 정직한 「기록 없음」이다 — 위 가드가 삼키지 않는다', () => {
    const headers = ['조사일자', '농가명', '라벨', '조사나무', '횡경', '종경'];
    const idx = buildPastIndex(headers, [], W3_COLS, resolveRoundCol(W3_COLS, null));
    expect(previousSurveyRound(idx, W3_COLS, null, '2026-06-12')).toEqual({ kind: 'none' });
  });

  // ─── 🔴 v0.49 r3 #4 — 고정 키 대조는 **시트 서식**을 넘어야 한다. ────────────────
  test('리터럴 고정일 키가 구글 재포맷(2026. 3. 1)이어도 일치한다 — 영구 「기록 없음」 차단', () => {
    // A8이 「정당한 식별 키」로 인정한 부류(정식일자). 앱은 `2026-03-01` 원문을 들고 있고,
    // 시트는 date 서식 셀을 FORMATTED_VALUE로 로케일대로 그려 준다 — 종전엔 영영 불일치했다.
    const cols = [
      ...W3_COLS,
      col('c9', '정식일자', { type: 'date', auto: { kind: 'fixed', value: '2026-03-01' }, sampleKey: true }),
    ];
    expect(sessionFixedKeyColumns(cols, null).map((c) => c.id), '전제: 고정 키에 포함된다')
      .toEqual(['c3', 'c4', 'c9']);

    const headers = ['조사일자', '농가명', '라벨', '조사나무', '횡경', '종경', '정식일자'];
    const rows = [
      ['2026-05-13', '이원창', 'A', '1', '10', '20', '2026. 3. 1'],
      ['2026-05-20', '이원창', 'A', '1', '11', '21', '2026. 3. 1'],
    ];
    const idx = buildPastIndex(headers, rows, cols, resolveRoundCol(cols, null));
    expect(previousSurveyRound(idx, cols, null, '2026-06-12')).toEqual({ kind: 'date', iso: '2026-05-20' });
  });

  test('날짜 정규화는 **다른 날짜**를 같게 만들지 않는다(가드)', () => {
    const cols = [
      ...W3_COLS,
      col('c9', '정식일자', { type: 'date', auto: { kind: 'fixed', value: '2026-03-01' }, sampleKey: true }),
    ];
    const headers = ['조사일자', '농가명', '라벨', '조사나무', '횡경', '종경', '정식일자'];
    const rows = [['2026-05-13', '이원창', 'A', '1', '10', '20', '2026. 3. 2']];
    const idx = buildPastIndex(headers, rows, cols, resolveRoundCol(cols, null));
    expect(previousSurveyRound(idx, cols, null, '2026-06-12')).toEqual({ kind: 'none' });
  });

  test('파싱 불가 날짜끼리는 일치로 보지 않는다(null === null 구멍 차단)', () => {
    const cols = [
      ...W3_COLS,
      col('c9', '정식일자', { type: 'date', auto: { kind: 'fixed', value: '심은날' }, sampleKey: true }),
    ];
    const headers = ['조사일자', '농가명', '라벨', '조사나무', '횡경', '종경', '정식일자'];
    // 원문이 서로 다르고 둘 다 파싱 불가 — 정확 일치도 정규화 일치도 성립하면 안 된다.
    const rows = [['2026-05-13', '이원창', 'A', '1', '10', '20', '옮긴날']];
    const idx = buildPastIndex(headers, rows, cols, resolveRoundCol(cols, null));
    expect(previousSurveyRound(idx, cols, null, '2026-06-12')).toEqual({ kind: 'none' });
  });
});

test.describe('previousSurveyRound — 키 조각 위치 대조(문자열 prefix 매칭 금지)', () => {
  test('키 값에 공백이 있어도 조각 경계를 잘못 읽지 않는다', () => {
    // 두 행의 샘플키 join 문자열은 '강 남호 A 1'로 **완전히 동일**하지만(KEY_SEP=' '),
    // 컬럼 단위로 보면 농가명·라벨이 서로 다르다. join 문자열을 split해 대조하면 05-27을
    // 잘못 집는다 — colId 대조라야 05-20이 나온다.
    const cols = [
      col('c1', '조사일자', { type: 'date', auto: { kind: 'fixed', value: '오늘' } }),
      col('c3', '농가명', { auto: { kind: 'fixed', value: '강 남호' } }),
      col('c4', '라벨', { auto: { kind: 'options', available: ['A'], selected: ['A'] } }),
      col('c6', '조사나무', { type: 'int', auto: { kind: 'seq', from: 1, to: 1 } }),
    ];
    const headers = ['조사일자', '농가명', '라벨', '조사나무'];
    const rows = [
      ['2026-05-20', '강 남호', 'A', '1'], // 진짜 일치
      ['2026-05-27', '강', '남호 A', '1'], // 키 문자열은 같지만 컬럼 값이 다름 → 불일치
    ];
    const idx = buildPastIndex(headers, rows, cols, resolveRoundCol(cols, null));
    expect(idx.samples.size).toBe(1); // 두 행이 같은 키로 합쳐진다 — 조각 대조가 아니면 구분 불가
    expect(previousSurveyRound(idx, cols, null, '2026-06-12')).toEqual({ kind: 'date', iso: '2026-05-20' });
  });

  test('가상 스키마: 고정 컬럼이 키의 앞이 아니어도(중간·끝) 규칙대로 동작', () => {
    // 샘플키 = [구역(seq) · 동(fixed) · 작물(단일선택)] — 고정 컬럼이 **prefix가 아니다**.
    const cols = [
      col('a1', '조사일', { type: 'date', auto: { kind: 'fixed', value: '오늘' } }),
      col('a2', '구역', { type: 'int', auto: { kind: 'seq', from: 1, to: 2 } }),
      col('a3', '동', { auto: { kind: 'fixed', value: '3동' } }),
      col('a4', '작물', { auto: { kind: 'options', available: ['토마토', '오이'], selected: ['토마토'] } }),
      col('a5', '초장', { type: 'float', input: 'voice' }),
    ];
    expect(sessionFixedKeyColumns(cols, null).map((c) => c.id)).toEqual(['a3', 'a4']);

    const headers = ['조사일', '구역', '동', '작물', '초장'];
    const rows = [
      ['2026-07-01', '1', '3동', '토마토', '30'],
      ['2026-07-08', '2', '3동', '토마토', '35'],
      ['2026-07-15', '1', '3동', '오이', '40'],   // 작물 불일치 → 제외
      ['2026-07-22', '1', '4동', '토마토', '45'], // 동 불일치 → 제외
    ];
    const idx = buildPastIndex(headers, rows, cols, resolveRoundCol(cols, null));
    expect(previousSurveyRound(idx, cols, null, '2026-08-01')).toEqual({ kind: 'date', iso: '2026-07-08' });
  });
});
