/**
 * valueParseAttempt — 값 파싱 시도(순수 함수) 특성화 테스트.
 *
 * v0.43.0 #3이 신뢰도 게이트와 파서의 **순서를 뒤집기** 위해 handleFinal 인라인 블록을
 * 이 모듈로 추출했다. 이 spec은 **추출이 판정을 바꾸지 않았음**을 고정한다 —
 * koreanNum.spec.ts와 같은 방식으로 DOM 없이 Node에서 직접 돈다(page.goto 없음).
 *
 * 🔴 이 모듈이 지켜야 하는 계약 2개:
 *   1. **부수효과 0.** 로그도 ref도 만지지 않는다. 로그는 `events`로 돌려주고 호출자가
 *      **파싱 성공일 때만** 방출한다. #3 이후 파싱은 거절될 발화에도 실행되므로,
 *      여기서 상태를 만지면 저신뢰 거절 경로가 오염된다([STT-15] 회귀 축).
 *   2. **판정 순서 = 우선순위 계약.** 소수부 합성 → primary → (실패 사유 캡처) → alts.
 *      실패 사유는 primary 판정의 **반환값**이다(v0.43.0 #3-2 B층) — 종전엔 koreanNum의
 *      모듈 상태를 alts보다 먼저 읽는 순서 규약이었고, 파서를 안 부르는 컬럼층 실패에는
 *      직전 발화의 사유가 실렸다(v0.5.0 W4/W5 · v0.10.0 A1).
 */
import { test, expect } from '@playwright/test';
import { attemptParseValue, parseValueForCol } from '../src/lib/valueParseAttempt';
import { parseKoreanNumber } from '../src/lib/koreanNum';
import type { Column } from '../src/types';

const FLOAT_COL: Column = {
  id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true,
  auto: { kind: 'fixed', value: '' }, decimals: 1,
};
const INT_COL: Column = {
  id: 'c7', name: '개수', type: 'int', input: 'voice', ttsAnnounce: true,
  auto: { kind: 'fixed', value: '' },
};
const OPTIONS_COL: Column = {
  id: 'c5', name: '등급', type: 'options', input: 'voice', ttsAnnounce: true,
  auto: { kind: 'options', available: ['상', '중', '하'], selected: [] },
};
const TEXT_COL: Column = {
  id: 'c9', name: '비고', type: 'text', input: 'voice', ttsAnnounce: true,
  auto: { kind: 'fixed', value: '' },
};

const attempt = (text: string, opts?: { col?: Column | null; alts?: string[]; fractionWhole?: string | null }) =>
  attemptParseValue({
    col: opts?.col === undefined ? FLOAT_COL : opts.col,
    text,
    alts: opts?.alts ?? [text],
    fractionWhole: opts?.fractionWhole ?? null,
  });

test.describe('기본 파싱 — 성공/실패', () => {
  test('아라비아 숫자·한국어 수사 모두 커밋 값으로 정규화된다', () => {
    expect(attempt('33.3').parsed).toBe('33.3');
    expect(attempt('300').parsed).toBe('300');
    expect(attempt('삼십오 점 일').parsed).toBe('35.1');
  });

  test('숫자가 없는 발화는 no_number 사유와 함께 실패한다(#3-2)', () => {
    // 🔑 #3의 반증 짝 — `담백`(conf 0.887, 고신뢰)이 여전히 파싱 실패로 걸러지는 축.
    // ✅ v0.43.0 #3-2로 사유가 붙었다. 07-30 실기기 `stt_parse_failed` 22건 중 14건이 사유
    //    없이 실패한 원인이 이 경로였다 — `담배`(숫자 없음)와 `Siri 점에`(숫자 오인식)는
    //    대책이 다른데 로그에서 구별되지 않았다(plan §2-6).
    const r = attempt('담백');
    expect(r.parsed).toBeNull();
    expect(r.failReason).toBe('no_number');
    expect(r.events).toHaveLength(0);
  });

  test('컬럼을 못 찾으면(col=null) 파싱하지 않는다', () => {
    const r = attempt('33.3', { col: null });
    expect(r.parsed).toBeNull();
    expect(r.failReason).toBe('no_column'); // #3-2 B층 — 종전엔 직전 발화 사유가 실렸다
  });

  test('int 컬럼은 소수 발화를 거부한다(엄격)', () => {
    expect(attempt('33.3', { col: INT_COL }).parsed).toBeNull();
    expect(attempt('33.3', { col: INT_COL }).failReason).toBe('int_decimal_rejected');
    expect(attempt('삼십삼 점 삼', { col: INT_COL }).parsed).toBeNull();
    expect(attempt('33', { col: INT_COL }).parsed).toBe('33');
  });

  test('options 컬럼은 허용 목록에 매칭한다', () => {
    expect(attempt('상', { col: OPTIONS_COL }).parsed).toBe('상');
    const r = attempt('없는등급', { col: OPTIONS_COL });
    expect(r.parsed).toBeNull();
    expect(r.failReason).toBe('option_no_match');
  });

  test('text 컬럼의 공백 발화는 empty_text로 실패한다', () => {
    const r = attempt('   ', { col: TEXT_COL });
    expect(r.parsed).toBeNull();
    expect(r.failReason).toBe('empty_text');
  });
});

// ─── v0.43.0 #3-2 B층 — 실패 사유가 직전 발화에 오염되지 않는다 ──────────────────────────
// 🔴 이 describe가 B층의 회귀 축이다. 07-31 실측에서 **같은 발화의 커밋 결과가 직전 발화
//    이력에 따라 갈렸다** — 파서를 안 부르는 컬럼층 실패가 koreanNum의 모듈 상태를 그대로
//    읽었기 때문이다. 아래 두 프라이밍은 그 두 상태를 재현한다.
test.describe('#3-2 B층 — 컬럼층 실패 사유는 잔류값이 아니다', () => {
  /** 직전 발화가 사유를 남긴 상태를 만든다. */
  const primeWithReason = () => { parseKoreanNumber('현백 33.3'); };
  /** 직전 발화가 성공해 사유가 비워진 상태를 만든다. */
  const primeClean = () => { parseKoreanNumber('33.3'); };

  test('🔴 int 컬럼 + 소수 발화 — 직전 이력과 무관하게 항상 int_decimal_rejected', () => {
    for (const prime of [primeWithReason, primeClean]) {
      prime();
      const r = attempt('33.3', { col: INT_COL, alts: ['33.3', '33'] });
      expect(r.failReason).toBe('int_decimal_rejected');
    }
  });

  test('🔴 int 컬럼 + 소수 발화 — 소수부를 버린 alt(`33`)를 커밋하지 않는다', () => {
    // 사용자가 "33.3"이라 말했는데 alt `33`을 받으면 소수부가 조용히 사라진다(O3와 동형).
    // 소수를 담은 alt는 int 컬럼이 어차피 거절하므로, 수용 가능한 alt는 존재하지 않는다 → 재질문.
    // ⚠️ primeClean() 상태가 종전에 `33`을 커밋하던 경로다 — 이 단언이 그 회귀를 막는다.
    for (const prime of [primeWithReason, primeClean]) {
      prime();
      expect(attempt('33.3', { col: INT_COL, alts: ['33.3', '33'] }).parsed).toBeNull();
      prime();
      expect(attempt('33.3', { col: INT_COL, alts: ['33.3', '33.4'] }).parsed).toBeNull();
    }
  });

  test('options 미매칭은 alts 폴백을 유지한다 — 이력과 무관하게 동일 결과', () => {
    // 판단: options의 alt 매칭은 STT 변형 복구로 **정당하다**(숫자를 버리는 문제가 없다).
    // 종전엔 잔류 사유가 multi_numeric이면 이 구제가 우연히 막혔다 — 그것이 결함이었다.
    for (const prime of [primeWithReason, primeClean]) {
      prime();
      expect(attempt('없는등급', { col: OPTIONS_COL, alts: ['없는등급', '상'] }).parsed).toBe('상');
    }
  });

  test('col=null 사유도 이력에 오염되지 않는다', () => {
    for (const prime of [primeWithReason, primeClean]) {
      prime();
      expect(attempt('33.3', { col: null, alts: ['33.3'] }).failReason).toBe('no_column');
    }
  });

  test('float 컬럼의 파서 사유는 종전 그대로다(B층은 파서 경로를 안 건드린다)', () => {
    primeWithReason();
    expect(attempt('담백').failReason).toBe('no_number');
    primeClean();
    expect(attempt('360 6000', { alts: ['360 6000'] }).failReason).toBe('multi_numeric');
  });
});

test.describe('실패 사유는 alts 루프가 덮어쓰기 전에 캡처된다', () => {
  test('multi_numeric — alts가 위험 신호를 지운 후보여도 폴백하지 않는다', () => {
    // primary가 독립 숫자 복수를 잡았다면 alt의 숫자만 골라 커밋하는 것은 침묵 오커밋이다.
    const r = attempt('360 6000', { alts: ['360 6000', '360'] });
    expect(r.parsed).toBeNull();
    expect(r.failReason).toBe('multi_numeric');
  });

  test('decimal_fraction_lost — 정수부는 failWhole로 살아 나온다(타깃 재질문 재료)', () => {
    const r = attempt('266 점요', { alts: ['266 점요'] });
    expect(r.parsed).toBeNull();
    expect(r.failReason).toBe('decimal_fraction_lost');
    expect(r.failWhole).toBe('266');
  });

  test('decimal_fraction_lost일 때 정수 alt는 소수 의도를 버리므로 건너뛴다', () => {
    // v0.34.0 O3 — alt `266`을 받으면 "266.x를 말하려던 의도"가 조용히 사라진다.
    expect(attempt('266 점요', { alts: ['266 점요', '266'] }).parsed).toBeNull();
    // 소수를 온전히 담은 alt는 수용한다.
    expect(attempt('266 점요', { alts: ['266 점요', '266.2'] }).parsed).toBe('266.2');
  });

  test('성공하면 실패 사유는 남지 않는다', () => {
    const r = attempt('33.3');
    expect(r.failReason).toBeNull();
    expect(r.failWhole).toBeNull();
  });
});

test.describe('alts 폴백', () => {
  test('primary 실패 + alt 파싱 성공 → alt 채택 + alt_used 이벤트', () => {
    const r = attempt('하악', { alts: ['하악', '33.3'] });
    expect(r.parsed).toBe('33.3');
    expect(r.events).toEqual([
      { kind: 'alt_used', altIdx: 1, text: '33.3', originalText: '하악' },
    ]);
  });

  test('숫자 컬럼에서 응답어 alt는 건너뛴다([STT-17])', () => {
    // `네`가 native 4로 커밋되던 07-14 실사례 경로.
    expect(attempt('예에', { alts: ['예에', '네'] }).parsed).toBeNull();
  });

  test('alt는 최대 2건까지만 본다(index 1·2)', () => {
    expect(attempt('하악', { alts: ['하악', '으악', '크악', '33.3'] }).parsed).toBeNull();
    expect(attempt('하악', { alts: ['하악', '으악', '33.3'] }).parsed).toBe('33.3');
  });

  test('primary와 같은 문자열인 alt는 건너뛴다', () => {
    expect(attempt('담백', { alts: ['담백', '담백'] }).parsed).toBeNull();
  });
});

test.describe('소수부 재질문 문맥(fractionWhole)', () => {
  test('한 자리 소수부만 말하면 정수부와 합성한다', () => {
    const r = attempt('오', { fractionWhole: '111' });
    expect(r.parsed).toBe('111.5');
    expect(r.events).toEqual([
      { kind: 'decimal_fraction_recovered', text: '111.5', originalText: '오' },
    ]);
  });

  test('전체값을 다시 말하면 합성하지 않고 통상 파싱한다', () => {
    // 2자리 이상·소수점 포함은 "전체를 다시 말한 것"으로 본다.
    const r = attempt('111.5', { fractionWhole: '111' });
    expect(r.parsed).toBe('111.5');
    expect(r.events).toHaveLength(0);
  });

  test('문맥 중 alt도 소수부로만 해석한다 — 전체값 폴백 금지([STT-15])', () => {
    // 07-13 실기기: primary `하악` 실패 → alt `하나`를 문맥 없이 전체값 `1`로 커밋했던 회귀.
    const r = attempt('하악', { alts: ['하악', '하나'], fractionWhole: '211' });
    expect(r.parsed).toBe('211.1');
    expect(r.events).toEqual([
      { kind: 'alt_used', altIdx: 1, text: '하나', originalText: '하악', extra: 'frac_ctx:211' },
      { kind: 'decimal_fraction_recovered', text: '211.1', originalText: '하나' },
    ]);
  });

  test('문맥 중 합성 불가 alt는 전체값으로 커밋되지 않는다', () => {
    // `33.3`은 한 자리 소수부가 아니므로 합성 불가 → 건너뛴다(전체값 폴백 금지).
    expect(attempt('하악', { alts: ['하악', '33.3'], fractionWhole: '211' }).parsed).toBeNull();
  });
});

test.describe('🔴 부수효과 없음 — 실패하면 이벤트도 없다', () => {
  test('파싱 실패 시 events는 항상 비어 있다', () => {
    for (const text of ['담백', '상대', '담배', '360 6000']) {
      expect(attemptParseValue({ col: FLOAT_COL, text, alts: [text], fractionWhole: null }).events).toHaveLength(0);
    }
  });

  test('같은 입력을 두 번 호출해도 결과가 같다(모듈 상태 누수 없음)', () => {
    const a = attempt('오', { fractionWhole: '111' });
    const b = attempt('오', { fractionWhole: '111' });
    expect(b).toEqual(a);
  });
});

test.describe('parseValueForCol — 이전 useVoiceSession 인라인 구현과 동일 계약', () => {
  test('text/name은 트림만, 빈 문자열은 null', () => {
    const textCol: Column = { ...FLOAT_COL, type: 'text' };
    expect(parseValueForCol(textCol, '  메모  ')).toBe('메모');
    expect(parseValueForCol(textCol, '   ')).toBeNull();
  });

  test('date는 구분자 3종을 흡수해 ISO로 정규화한다', () => {
    const dateCol: Column = { ...FLOAT_COL, type: 'date' };
    expect(parseValueForCol(dateCol, '2026-7-3')).toBe('2026-07-03');
    expect(parseValueForCol(dateCol, '2026.7.3')).toBe('2026-07-03');
  });

  test('float의 decimals 기본값은 1이다', () => {
    const noDecimals: Column = { ...FLOAT_COL, decimals: undefined };
    expect(parseValueForCol(noDecimals, '33.35')).toBe('33.4');
  });
});
