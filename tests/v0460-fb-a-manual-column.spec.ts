/** v0.46.0 **FB-A**(민구 제보 08-06) — **수동(touch) 컬럼은 자동값 합성에서 빠진다.**
 *
 *  ## 왜 이 파일이 필요한가
 *  제보 원문: *"비고란 수동입력 설정이나, 테이블 미리보기에 이미 입력됨"* + 민구 정정 시 질문
 *  *"비고란에 값이 있으면 텍스트로 배정시 자동으로 따라 붙는 게 아닌가 싶었어."*
 *  → **답은 「그렇다, 그리고 그건 결함이다」.**
 *
 *  🔴 **표시 버그가 아니었다.** `buildCyclingValues`/`autoNonCyclingValues`가 `input==='voice'`만
 *  건너뛰어 **수동이 자동과 동일 취급**됐고, 그 합성 결과가 `composeRowValues` →
 *  `persistSession` 경로로 **실제 시트에 기록**됐다. 사용자가 그 행을 손대지 않으면 덮이지 않는다.
 *
 *  ## `[TEAMOPS-30]` — 이 오라클이 없으면 다음 사람이 되돌려도 아무도 모른다
 *  처방은 술어 하나(`isUserInputColumn`)로 모였다. **그 한 줄을 `c.input === 'voice'`로 되돌리면
 *  아래가 red가 된다** — 그게 이 파일의 존재 이유다.
 *
 *  ## §시트 불특정 (민구 08-05)
 *  🔴 컬럼 **이름**('비고')에 기대지 않는다. 재현 조건은 **`input:'touch'` + `auto` 설정 잔존**이고
 *  그건 어느 시트에서나 '자동'→'수동'으로 바꾸면 생긴다. 이름은 아무 값이나 쓴다. */
import { test, expect } from '@playwright/test';
import { buildCyclingValues, isUserInputColumn } from '../src/lib/autoValue';
import type { Column } from '../src/types';

function col(over: Partial<Column>): Column {
  return {
    id: 'c1', name: '아무이름', type: 'text', input: 'auto', ttsAnnounce: false,
    auto: { kind: 'fixed', value: '' }, ...over,
  };
}

test.describe('isUserInputColumn — 「사람이 넣는 칸」의 술어', () => {
  test('voice = 사람이 넣는다', () => {
    expect(isUserInputColumn(col({ input: 'voice' }))).toBe(true);
  });
  test('🔴 touch(수동) = 사람이 넣는다 — FB-A의 핵심', () => {
    expect(isUserInputColumn(col({ input: 'touch' }))).toBe(true);
  });
  test('auto = 앱이 계산한다', () => {
    expect(isUserInputColumn(col({ input: 'auto' }))).toBe(false);
  });
});

test.describe('buildCyclingValues — 수동 컬럼에 자동값이 새지 않는다', () => {
  /** 🔑 **압력 조건**(`[TEAMOPS-37]`): `auto` 설정이 **실제로 값을 만들어내는** 상태여야 한다.
   *  `{kind:'fixed', value:''}`(빈값)로 재면 수정 전에도 빈 문자열이라 **A/B가 같아진다** —
   *  「방어가 튼튼한 것」이 아니라 「압력이 안 걸린 것」이다. 그래서 seq를 쓴다. */
  const withLiveAuto = (input: Column['input']) =>
    col({ id: 'note', input, auto: { kind: 'seq', from: 1, to: 5 } });

  test('🔴 수동 컬럼은 키 자체가 안 생긴다(= 시트에 빈칸)', () => {
    const out = buildCyclingValues([withLiveAuto('touch')], 1);
    expect(out.note, '수동 컬럼에 자동값이 들어가면 시트가 오염된다').toBeUndefined();
  });

  test('음성 컬럼도 동일하다(종전 동작 불변 — 회귀 방어)', () => {
    const out = buildCyclingValues([withLiveAuto('voice')], 1);
    expect(out.note).toBeUndefined();
  });

  test('🟢 자동 컬럼은 종전 그대로 값이 나온다(과잉 수정 반증)', () => {
    const out = buildCyclingValues([withLiveAuto('auto')], 1);
    expect(out.note, '자동 컬럼까지 비우면 그건 다른 버그다').toBe('1');
  });

  test('한 시트에 셋이 섞여 있어도 자동만 남는다', () => {
    const cols = [
      col({ id: 'a', input: 'auto', auto: { kind: 'seq', from: 1, to: 3 } }),
      col({ id: 'v', input: 'voice', auto: { kind: 'seq', from: 1, to: 3 } }),
      col({ id: 't', input: 'touch', auto: { kind: 'seq', from: 1, to: 3 } }),
    ];
    expect(Object.keys(buildCyclingValues(cols, 2))).toEqual(['a']);
  });

  test('🔑 auto 설정은 **지우지 않는다** — 수동으로 바꿔도 컬럼에 남아 있다', () => {
    // '자동'으로 되돌릴 때 설정을 잃지 않게 하는 계약. 합성에서만 빼고 데이터는 보존한다.
    const c = withLiveAuto('touch');
    buildCyclingValues([c], 1);
    expect(c.auto, '합성 제외가 설정 삭제로 번지면 사용자가 되돌릴 수 없다')
      .toEqual({ kind: 'seq', from: 1, to: 5 });
  });
});
