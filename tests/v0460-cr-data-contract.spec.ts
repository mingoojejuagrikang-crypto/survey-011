import { test, expect } from '@playwright/test';
import { inferColumns } from '../src/lib/sheetsInfer';
import {
  isCycling,
  isUserInputColumn,
  computeTotalRows,
  nestedAutoValue,
} from '../src/lib/autoValue';
import type { Column } from '../src/types';

/**
 * v0.46.0 콜드 리뷰 처방 게이트 — **데이터 계약 2건**(L2-1 critical · L2-2 critical).
 *
 * 🔴 이 파일은 **처방을 지키는 기계**다. 08-06 콜드 리뷰가 실측으로 확정한 두 결함이
 * 되살아나면 여기서 red가 난다. 회차 SSOT:
 * `~/workspace_teamops/deliverables/2026-08-06-survey-011-v0460-cold-review.md`
 *
 * 🔑 **민구 계약(08-06)** — 이 파일이 지키는 문장이다:
 *   *"전체행은 **자동 입력 설정된 항목들이 미리 테이블을 만들고**, 수동이나 음성입력이
 *   만들어진 테이블을 채우는 형태야."*
 *   *"입력방식이 수동이고, 순차가 아니고, **어떤값이 올지는 데이터형 외의 정의는 없어야** 해."*
 *
 * ⚠️ **`inferColumns`는 순수 함수라 브라우저가 필요 없다.** 그래서 `page`를 쓰지 않는다 —
 *    이 파일이 느려지면(부팅·gUM) 판정이 환경에 흔들린다(`[TEAMOPS-85]`).
 */

/** 시트 표본 행 생성기 — `values[ci]`가 컬럼별 값 배열이다. */
function sampleRows(columns: string[][], rows: number): string[][] {
  return Array.from({ length: rows }, (_, r) => columns.map((vals) => vals[r % vals.length]));
}

test.describe('L2-1 — text 컬럼의 리스트 승격은 「반복성」으로 판정한다', () => {
  test('반복되는 소수 고유값은 options로 승격된다 (평균 반복 20회)', () => {
    // 고유값 5개가 100행에 반복 → 평균 20회. 자동입력 컬럼의 선택지가 맞다.
    // ⚠️ 값을 `'1'~'5'`로 주면 `guessType`이 **int**로 읽어 text 분기를 타지 않는다
    //    (그 픽스처로 처음 짰고 red가 났다 — `[TEAMOPS-87]`: 의도한 분기를 실제로 타는지 확인해라).
    const sample = sampleRows([['상', '중상', '중', '중하', '하']], 100);
    const [col] = inferColumns(['조사과실등급'], sample);
    expect(col.type, '반복되는 값은 선택지다').toBe('options');
    expect(col.input).toBe('auto');
    expect(col.auto.kind).toBe('options');
  });

  test('🔴 반복되지 않는 값은 승격되지 않고 수동 입력이 된다 (평균 반복 1회)', () => {
    // 100행 전부 다른 값 → 평균 1회. 사람이 그때그때 적는 칸이다.
    const vals = Array.from({ length: 100 }, (_, i) => `관찰 메모 ${i}`);
    const sample = sampleRows([vals], 100);
    const [col] = inferColumns(['특이사항'], sample);

    expect(col.type, '자유서술은 선택지가 아니다').not.toBe('options');
    expect(col.auto.kind, '민구 계약: 값은 「데이터형 외의 정의」가 없다').toBe('fixed');
    expect(col.input, '사람이 채우는 칸이다').toBe('touch');
    expect(isUserInputColumn(col)).toBe(true);
  });

  test('🔴 컬럼 이름이 「비고」가 아니어도 보호된다 — 시트 불특정', () => {
    // 이 결함의 정체: 보호가 `'비고'` 리터럴 하나에만 걸려 있었다.
    // 다른 스키마 시트(민구: "내일은 품질조사의 시트")에서는 이름이 무엇이든 성질로 갈려야 한다.
    const vals = Array.from({ length: 60 }, (_, i) => `자유 기술 ${i}`);
    for (const name of ['메모', '특이사항', '기타의견', 'remarks', '조사자소견']) {
      const [col] = inferColumns([name], sampleRows([vals], 60));
      expect(col.auto.kind, `${name}: 자동값이 붙으면 시트에 오염이 기록된다`).toBe('fixed');
      expect(col.input, `${name}: 사람이 채우는 칸이다`).toBe('touch');
    }
  });

  test('🟢 J-2가 없앤 절벽은 되살아나지 않는다 — 농가 21곳도 리스트다', () => {
    // 민구 R7-b("리스트는 무한")의 근거 사례. 종전 `size <= 20` 상한이 여기서 리스트를 없앴다.
    // 실측 비율: 21 / 2902 → 평균 138회. 임계 2를 크게 넘는다.
    const farms = Array.from({ length: 21 }, (_, i) => `농가${i + 1}`);
    const [col] = inferColumns(['농가명'], sampleRows([farms], 2902));
    expect(col.type, '21곳이어도 반복되면 리스트다').toBe('options');
    if (col.auto.kind !== 'options') throw new Error('unreachable');
    expect(col.auto.available.length).toBe(21);
  });

  test('고유값이 하나면 fixed다 (기존 동작 보존)', () => {
    const [col] = inferColumns(['농가명'], sampleRows([['이원창']], 40));
    expect(col.auto.kind).toBe('fixed');
    if (col.auto.kind !== 'fixed') throw new Error('unreachable');
    expect(col.auto.value).toBe('이원창');
  });

  test('경계 — 평균 반복이 정확히 2면 승격된다', () => {
    const [col] = inferColumns(['처리'], sampleRows([['A', 'B', 'C']], 6));
    expect(col.type).toBe('options');
  });

  test('경계 — 평균 반복이 2 미만이면 승격되지 않는다', () => {
    // 고유값 4 / 7행 = 1.75
    const sample = [['A'], ['B'], ['C'], ['D'], ['A'], ['B'], ['C']];
    const [col] = inferColumns(['처리'], sample);
    expect(col.type).not.toBe('options');
    expect(col.input).toBe('touch');
  });
});

test.describe('L2-2 — 테이블 골격은 자동입력만 만든다', () => {
  const seq = (id: string, name: string, to: number, input: Column['input'] = 'auto'): Column => ({
    id, name, type: 'int', input, ttsAnnounce: false, auto: { kind: 'seq', from: 1, to },
  });

  test('🔴 수동 컬럼은 순환에서 빠진다 — 술어가 isUserInputColumn과 통일돼 있다', () => {
    const manual = seq('c7', '조사과실', 5, 'touch');
    expect(isCycling(manual), '사람이 채우는 칸은 행을 만들지 않는다').toBe(false);
    expect(isCycling(seq('c6', '조사나무', 10)), '자동입력은 행을 만든다').toBe(true);
    // 🔑 두 술어가 갈라지면 「값은 안 쓰는데 자릿수는 먹는」 상태가 되살아난다.
    for (const input of ['voice', 'touch'] as const) {
      expect(isCycling(seq('x', 'x', 5, input))).toBe(!isUserInputColumn(seq('x', 'x', 5, input)));
    }
  });

  test('🔴 조사과실을 수동으로 바꾸면 총 행 수가 50 → 10이 된다 (민구 확정 08-06)', () => {
    const auto = [seq('c6', '조사나무', 10), seq('c7', '조사과실', 5)];
    expect(computeTotalRows(auto)).toBe(50);

    const manual = [seq('c6', '조사나무', 10), seq('c7', '조사과실', 5, 'touch')];
    expect(computeTotalRows(manual), '수동 칸은 테이블 골격에 기여하지 않는다').toBe(10);
  });

  test('🔴 구분자 없는 중복 행이 생기지 않는다 — 조사나무가 1,2,…,10이다', () => {
    const tree = seq('c6', '조사나무', 10);
    const cols = [tree, seq('c7', '조사과실', 5, 'touch')];
    const values = Array.from({ length: computeTotalRows(cols) }, (_, i) =>
      nestedAutoValue(cols, tree, i + 1),
    );
    expect(values).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    // 반증쌍: 수동으로 바꾸지 않으면 같은 값이 5행 연속이었다(이 결함의 실측 증상).
    const autoCols = [tree, seq('c7', '조사과실', 5)];
    expect(
      Array.from({ length: 6 }, (_, i) => nestedAutoValue(autoCols, tree, i + 1)),
      '자동입력일 때는 5행씩 묶이는 것이 정상이다',
    ).toEqual(['1', '1', '1', '1', '1', '2']);
  });
});
