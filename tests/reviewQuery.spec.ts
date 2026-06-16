/**
 * v0.10.0 — reviewQuery 순수 함수 단위 테스트 (pastValues.spec.ts 패턴: 브라우저 의존부 제외,
 * PastIndex를 직접 빌드해 Node에서 검증).
 *
 * 커버리지(플랜 1B 불변량):
 *  - distinctValues: 인덱스 값 합집합 + options auto.available 합집합, 정렬
 *  - applyFilters: AND 교집합(모두 만족), 빈 필터=전부 통과, 같은 colId 모순 칩=0
 *  - roundsBefore: target 기준 N회차 전(strictly), 없으면 null
 *  - buildReviewView: 비고(touch) 측정 제외, target+N baseline, 행 선택 부분집합,
 *    무집계 불변량(행수=후보수·1키=1행), 차원 constant/variable 분해
 */
import { test, expect } from '@playwright/test';
import {
  buildPastIndex,
  resolveRoundCol,
  keyColumns,
  KEY_SEP,
  type PastIndex,
} from '../src/lib/pastValues';
import {
  distinctValues,
  applyFilters,
  roundsBefore,
  buildReviewView,
  type ReviewSettings,
} from '../src/lib/reviewQuery';
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

/** 대표 스키마: date(회차) + auto 키 3개(농가명·라벨·조사나무) + 음성 측정 2개 + 터치 비고. */
const COLS: Column[] = [
  col('c1', '조사일자', { type: 'date' }),
  col('c3', '농가명'),
  col('c4', '라벨'),
  col('c6', '조사나무', { type: 'int' }),
  col('c8', '횡경', { type: 'float', input: 'voice' }),
  col('c9', '종경', { type: 'float', input: 'voice' }),
  col('c10', '비고', { type: 'text', input: 'touch' }),
];

const HEADERS = ['조사일자', '농가명', '라벨', '조사나무', '횡경', '종경', '비고'];
// 키 차원: 농가명(이원창/강남호) 가변, 라벨(A 상수), 조사나무(1/2) 가변.
const ROWS: string[][] = [
  // 이원창 A 1 — 3회차
  ['2026-05-13', '이원창', 'A', '1', '111.1', '105.0', '정상'],
  ['2026-05-20', '이원창', 'A', '1', '122.2', '110.0', '정상'],
  ['2026-05-27', '이원창', 'A', '1', '133.3', '120.0', '낙과'],
  // 이원창 A 2 — 2회차
  ['2026-05-20', '이원창', 'A', '2', '99.9', '95.0', ''],
  ['2026-05-27', '이원창', 'A', '2', '101.0', '96.0', ''],
  // 강남호 A 1 — 1회차(최근만)
  ['2026-05-27', '강남호', 'A', '1', '88.8', '80.0', ''],
];
const KEY = (farm: string, label: string, tree: string) => [farm, label, tree].join(KEY_SEP);
const K_LWC1 = KEY('이원창', 'A', '1');
const K_LWC2 = KEY('이원창', 'A', '2');
const K_KNH1 = KEY('강남호', 'A', '1');

function makeIndex(): PastIndex {
  return buildPastIndex(HEADERS, ROWS, COLS, resolveRoundCol(COLS, null));
}

/** 기본 설정(전부 자동) — 테스트별 override. */
function settings(over: Partial<ReviewSettings> = {}): ReviewSettings {
  return {
    columns: COLS,
    reviewFilters: [],
    reviewTargetRound: null,
    reviewBaselineBack: 1,
    reviewGroupCols: null,
    reviewMeasureCols: null,
    reviewSelectedRows: null,
    ...over,
  };
}

test.describe('distinctValues', () => {
  test('인덱스 값 합집합 + 정렬(numeric)', () => {
    const idx = makeIndex();
    expect(distinctValues(idx, COLS[1])).toEqual(['강남호', '이원창']); // 농가명 (ko 정렬)
    expect(distinctValues(idx, COLS[3])).toEqual(['1', '2']); // 조사나무
  });

  test('빈 값/공백은 제외', () => {
    const idx = makeIndex();
    // 비고: 빈 문자열 다수 + '정상'/'낙과'만 후보
    expect(distinctValues(idx, COLS[6])).toEqual(['낙과', '정상']);
  });

  test('options 타입은 auto.available 합집합(시트 미사용 옵션 포함)', () => {
    const optCol = col('opt', '처리', {
      type: 'options',
      auto: { kind: 'options', available: ['시험', '대조', '미사용옵션'], selected: [] },
    });
    const headers = [...HEADERS, '처리'];
    const rows = ROWS.map((r, i) => [...r, i === 0 ? '시험' : '대조']);
    const cols = [...COLS, optCol];
    const idx = buildPastIndex(headers, rows, cols, resolveRoundCol(cols, null));
    // 인덱스엔 시험/대조만 있으나, available의 미사용옵션도 후보에 포함된다.
    expect(distinctValues(idx, optCol)).toEqual(['대조', '미사용옵션', '시험']);
  });
});

test.describe('applyFilters — AND 교집합', () => {
  const rec = { c3: '이원창', c4: 'A', c6: '1' };

  test('빈 필터는 전부 통과', () => {
    expect(applyFilters(rec, [])).toBe(true);
  });

  test('모든 조건 만족해야 통과(AND)', () => {
    expect(applyFilters(rec, [{ colId: 'c3', value: '이원창' }, { colId: 'c6', value: '1' }])).toBe(true);
    expect(applyFilters(rec, [{ colId: 'c3', value: '이원창' }, { colId: 'c6', value: '2' }])).toBe(false);
  });

  test('값 trim 비교', () => {
    expect(applyFilters(rec, [{ colId: 'c3', value: ' 이원창 ' }])).toBe(true);
  });

  test('같은 colId 모순 칩은 0(한 셀이 두 값일 수 없음 — AND의 귀결)', () => {
    expect(applyFilters(rec, [{ colId: 'c3', value: '이원창' }, { colId: 'c3', value: '강남호' }])).toBe(false);
  });
});

test.describe('roundsBefore — target 기준 N회차 전(strictly)', () => {
  const idx = makeIndex();
  // rounds = ['2026-05-13','2026-05-20','2026-05-27']

  test('N=1 직전', () => {
    expect(roundsBefore(idx, '2026-05-27', 1)).toBe('2026-05-20');
    expect(roundsBefore(idx, '2026-05-20', 1)).toBe('2026-05-13');
  });

  test('N=2 두 회차 전', () => {
    expect(roundsBefore(idx, '2026-05-27', 2)).toBe('2026-05-13');
  });

  test('앞에 N개 회차가 없으면 null', () => {
    expect(roundsBefore(idx, '2026-05-13', 1)).toBeNull();
    expect(roundsBefore(idx, '2026-05-27', 3)).toBeNull();
  });

  test('target이 rounds에 없거나 null, n<1이면 null', () => {
    expect(roundsBefore(idx, '2026-06-01', 1)).toBeNull();
    expect(roundsBefore(idx, null, 1)).toBeNull();
    expect(roundsBefore(idx, '2026-05-27', 0)).toBeNull();
  });
});

test.describe('buildReviewView — 비고 제외 / 측정 자동', () => {
  test('측정 = isTrendEligible((int|float)&&!auto) → 비고(touch)·조사나무(auto int) 제외', () => {
    const v = buildReviewView(makeIndex(), settings());
    expect(v.measures.map((c) => c.id)).toEqual(['c8', 'c9']); // 횡경·종경만
    expect(v.measures.some((c) => c.id === 'c10')).toBe(false); // 비고 제외
    expect(v.measures.some((c) => c.id === 'c6')).toBe(false); // 조사나무(auto) 제외
  });

  test('reviewMeasureCols 지정 시 그 부분집합·순서, 부적격 id는 자동 제외', () => {
    const v = buildReviewView(makeIndex(), settings({ reviewMeasureCols: ['c9', 'c10', 'c8'] }));
    expect(v.measures.map((c) => c.id)).toEqual(['c9', 'c8']); // c10(비고)은 부적격이라 빠짐, 순서 보존
  });
});

test.describe('buildReviewView — target / baseline 회차', () => {
  test('target 자동 = 최근 회차, baseline = 직전(N=1)', () => {
    const v = buildReviewView(makeIndex(), settings());
    expect(v.targetRound).toBe('2026-05-27');
    expect(v.baselineRound).toBe('2026-05-20');
  });

  test('target 지정 + N=2 baseline', () => {
    const v = buildReviewView(makeIndex(), settings({ reviewTargetRound: '2026-05-27', reviewBaselineBack: 2 }));
    expect(v.targetRound).toBe('2026-05-27');
    expect(v.baselineRound).toBe('2026-05-13');
  });

  test('baseline 없는 회차(가장 이른 target)면 null', () => {
    const v = buildReviewView(makeIndex(), settings({ reviewTargetRound: '2026-05-13' }));
    expect(v.targetRound).toBe('2026-05-13');
    expect(v.baselineRound).toBeNull();
  });

  test('잘못된 target은 최근 회차로 폴백', () => {
    const v = buildReviewView(makeIndex(), settings({ reviewTargetRound: '2099-01-01' }));
    expect(v.targetRound).toBe('2026-05-27');
  });
});

test.describe('buildReviewView — AND 필터 + 후보 행(1키=1행)', () => {
  test('필터 없음: target 회차에 레코드 있는 모든 키가 후보', () => {
    const v = buildReviewView(makeIndex(), settings()); // target=05-27
    // 05-27 회차 보유 키: 이원창A1, 이원창A2, 강남호A1
    expect(v.candidateRows.map((r) => r.key).sort()).toEqual([K_KNH1, K_LWC1, K_LWC2].sort());
  });

  test('농가명 AND 필터 → 교집합', () => {
    const v = buildReviewView(makeIndex(), settings({ reviewFilters: [{ colId: 'c3', value: '이원창' }] }));
    expect(v.candidateRows.map((r) => r.key).sort()).toEqual([K_LWC1, K_LWC2].sort());
  });

  test('농가명 AND 조사나무 → 두 조건 모두 만족', () => {
    const v = buildReviewView(
      makeIndex(),
      settings({ reviewFilters: [{ colId: 'c3', value: '이원창' }, { colId: 'c6', value: '1' }] }),
    );
    expect(v.candidateRows.map((r) => r.key)).toEqual([K_LWC1]);
  });

  test('0샘플 필터(모순) → 후보 0', () => {
    const v = buildReviewView(
      makeIndex(),
      settings({ reviewFilters: [{ colId: 'c3', value: '없는농가' }] }),
    );
    expect(v.candidateRows).toEqual([]);
    expect(v.rows).toEqual([]);
  });

  test('target 회차에 없는 샘플은 후보 아님(05-13 target: 이원창A1만)', () => {
    const v = buildReviewView(makeIndex(), settings({ reviewTargetRound: '2026-05-13' }));
    expect(v.candidateRows.map((r) => r.key)).toEqual([K_LWC1]);
  });

  test('각 후보 행의 rec는 target 회차 레코드(측정값 확인)', () => {
    const v = buildReviewView(makeIndex(), settings()); // target=05-27
    const r1 = v.candidateRows.find((r) => r.key === K_LWC1)!;
    expect(r1.rec.c8).toBe('133.3'); // 이원창A1의 05-27 횡경
  });
});

test.describe('buildReviewView — 차원 constant/variable 분해', () => {
  test('후보 행 기준: 라벨(A) 상수, 농가명·조사나무 가변', () => {
    const v = buildReviewView(makeIndex(), settings()); // 후보 3키
    expect(v.constantDims.map((c) => c.id)).toEqual(['c4']); // 라벨 A 단일
    expect(v.rowDims.map((c) => c.id).sort()).toEqual(['c3', 'c6'].sort()); // 농가명·조사나무
  });

  test('필터로 단일 농가 좁히면 농가명도 상수로 이동', () => {
    const v = buildReviewView(makeIndex(), settings({ reviewFilters: [{ colId: 'c3', value: '이원창' }] }));
    // 이원창A1·이원창A2 → 농가명·라벨 상수, 조사나무만 가변
    expect(v.constantDims.map((c) => c.id).sort()).toEqual(['c3', 'c4'].sort());
    expect(v.rowDims.map((c) => c.id)).toEqual(['c6']);
  });

  test('reviewGroupCols 지정 시 rowDims=그 집합(키 컬럼 한정·순서 보존)', () => {
    const v = buildReviewView(makeIndex(), settings({ reviewGroupCols: ['c6', 'c3'] }));
    expect(v.rowDims.map((c) => c.id)).toEqual(['c6', 'c3']);
  });

  test('reviewGroupCols에 비-키 컬럼(측정)은 무시', () => {
    const v = buildReviewView(makeIndex(), settings({ reviewGroupCols: ['c3', 'c8'] }));
    expect(v.rowDims.map((c) => c.id)).toEqual(['c3']); // c8(측정)은 effectiveSampleKey 아님
  });
});

test.describe('buildReviewView — 행 선택 부분집합 + 무집계 불변량', () => {
  test('reviewSelectedRows=null → rows=candidateRows 전체', () => {
    const v = buildReviewView(makeIndex(), settings());
    expect(v.rows).toEqual(v.candidateRows);
  });

  test('행 선택은 후보의 부분집합(선택 순서 무관, 후보 순서 보존)', () => {
    const v = buildReviewView(makeIndex(), settings({ reviewSelectedRows: [K_LWC2, K_LWC1] }));
    expect(v.rows.map((r) => r.key)).toEqual([K_KNH1, K_LWC1, K_LWC2].filter((k) => k === K_LWC1 || k === K_LWC2));
    // rows ⊆ candidateRows
    const cand = new Set(v.candidateRows.map((r) => r.key));
    expect(v.rows.every((r) => cand.has(r.key))).toBe(true);
  });

  test('후보에 없는 키 선택은 무시(부분집합 불변)', () => {
    const v = buildReviewView(makeIndex(), settings({ reviewSelectedRows: [K_LWC1, '유령키'] }));
    expect(v.rows.map((r) => r.key)).toEqual([K_LWC1]);
  });

  test('무집계 불변량: 행 1개 = 샘플 1개(키 중복 없음), rows ⊆ candidateRows', () => {
    const v = buildReviewView(makeIndex(), settings());
    const keys = v.candidateRows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length); // 키 유일(1키=1행, 집계 없음)
    // 선택 null이면 행수 = 후보수
    expect(v.rows.length).toBe(v.candidateRows.length);
  });

  test('무집계 불변량(필터+선택 동시): 행수 = 선택∩후보 수, 모두 후보에 존재', () => {
    const v = buildReviewView(
      makeIndex(),
      settings({ reviewFilters: [{ colId: 'c3', value: '이원창' }], reviewSelectedRows: [K_LWC1] }),
    );
    expect(v.rows.map((r) => r.key)).toEqual([K_LWC1]);
    const cand = new Set(v.candidateRows.map((r) => r.key));
    expect(v.rows.every((r) => cand.has(r.key))).toBe(true);
  });
});

test.describe('buildReviewView — 엣지(회차 0)', () => {
  test('회차 0개(roundCol null) → target/baseline null, 후보 0', () => {
    const idx = buildPastIndex(HEADERS, ROWS, COLS, null);
    const v = buildReviewView(idx, settings());
    expect(v.targetRound).toBeNull();
    expect(v.baselineRound).toBeNull();
    expect(v.candidateRows).toEqual([]);
    expect(v.rows).toEqual([]);
    // 측정 컬럼은 회차와 무관하게 결정된다(차원/측정 패널 표시용).
    expect(v.measures.map((c) => c.id)).toEqual(['c8', 'c9']);
  });
});

// keyColumns 일관성(차원 후보가 effectiveSampleKey와 일치하는지) — 회귀 가드.
test('차원 후보는 keyColumns(effectiveSampleKey)와 일치', () => {
  expect(keyColumns(COLS).map((c) => c.id)).toEqual(['c3', 'c4', 'c6']);
});
