/**
 * v0.49 r3 #8 오라클 — **seq `from`은 0이 정상값이다**(claude r2 MEDIUM, 순수 단위).
 *
 * `autoValue`가 `col.auto.from || 1`이라는 **falsy 폴백**을 쓰고 있었다. 그런데 `from: 0`은
 * 오설정이 아니라 정상 구성이다 — `ColumnCard`가 컬럼을 seq로 전환할 때 넣는 기본값이 0이고
 * (`ColumnCard.tsx:289`), 수동 입력 범위 검증(`manualInput.ts:85`)은 그 원값을 그대로 쓴다.
 *
 * 폴백이 만든 균열 두 갈래:
 *
 *  ⓐ **한 값의 정본이 두 함수로 갈렸다.** 순환 컬럼의 실제 행 값은 `nestedAutoValue`가 만들고
 *     (`String(targetCol.auto.from + offset)` — 원값), 과거 대조 키는 `autoValue`가 만든다
 *     (`from || 1`). `from=0`이면 시트에는 `0`이 올라가고 대조는 `1`을 찾는다 → 그 세션의
 *     「이전 조사」는 **영구 '기록 없음'**이다(#3·#4와 같은 거짓의 세 번째 축).
 *  ⓑ **자릿수(span)까지 어긋났다.** `spanOf`도 같은 폴백을 써서 `from=0,to=2`를 3이 아니라
 *     2로 셌다 — 총 행 수와 순환 주기가 통째로 밀린다(테이블 골격 자체가 틀어진다).
 *
 * 반증(`?? 1`을 `|| 1`로 되돌리면): ①②③④ 전부 red.
 */

import { test, expect } from '@playwright/test';
import { autoValue, nestedAutoValue, computeTotalRows } from '../src/lib/autoValue';
import { buildPastIndex, previousSurveyRound, resolveRoundCol } from '../src/lib/pastValues';
import type { Column } from '../src/types';

const col = (id: string, name: string, over: Partial<Column> = {}): Column => ({
  id, name, type: 'text', input: 'auto', ttsAnnounce: false,
  auto: { kind: 'fixed', value: '' }, ...over,
});

test.describe('seq from=0 — autoValue/nestedAutoValue/spanOf가 같은 값을 말한다', () => {
  test('① from=0,to=0(자릿수 1): 첫 행 값은 0이다 — 1로 올라가지 않는다', () => {
    const c = col('c6', '조사나무', { type: 'int', auto: { kind: 'seq', from: 0, to: 0 } });
    expect(autoValue(c, 1)).toBe('0');
  });

  test('② from=0,to=2: 자릿수는 3이고 값은 0·1·2다', () => {
    const c = col('c6', '조사나무', { type: 'int', auto: { kind: 'seq', from: 0, to: 2 } });
    expect(computeTotalRows([c]), 'spanOf의 falsy 폴백이 자릿수를 2로 셌다').toBe(3);
    expect([1, 2, 3].map((r) => autoValue(c, r))).toEqual(['0', '1', '2']);
  });

  test('③ autoValue와 nestedAutoValue가 같은 값을 낸다 — 시트에 쓰는 쪽과 대조하는 쪽', () => {
    const cols = [
      col('c3', '농가명', { auto: { kind: 'fixed', value: '이원창' } }),
      col('c6', '조사나무', { type: 'int', auto: { kind: 'seq', from: 0, to: 2 } }),
    ];
    const seq = cols[1];
    for (const r of [1, 2, 3]) {
      expect(nestedAutoValue(cols, seq, r), `row ${r}`).toBe(autoValue(seq, r));
    }
  });
});

test.describe('그 결과 — from=0 세션의 「이전 조사」가 영구 기록 없음이 되지 않는다', () => {
  test('④ 시트에 0으로 기록된 과거 행을 고정 키 대조가 찾아낸다', () => {
    // 조사나무가 유일한 샘플키이고 from===to(자릿수 1)라 세션 고정 키다(A7 계약).
    const cols = [
      col('c1', '조사일자', { type: 'date', auto: { kind: 'fixed', value: '오늘' } }),
      col('c6', '조사나무', { type: 'int', auto: { kind: 'seq', from: 0, to: 0 }, sampleKey: true }),
      col('c8', '횡경', { type: 'float', input: 'voice' }),
    ];
    const headers = ['조사일자', '조사나무', '횡경'];
    // 과거 회차는 이 앱이 직접 올린 것이다 — nestedAutoValue가 만든 '0'이 들어 있다.
    const rows = [
      ['2026-05-13', '0', '10'],
      ['2026-05-20', '0', '11'],
    ];
    const idx = buildPastIndex(headers, rows, cols, resolveRoundCol(cols, null));
    expect(previousSurveyRound(idx, cols, null, '2026-06-12'))
      .toEqual({ kind: 'date', iso: '2026-05-20' });
  });
});
