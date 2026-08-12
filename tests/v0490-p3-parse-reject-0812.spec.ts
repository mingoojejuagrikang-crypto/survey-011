/**
 * v0.49 P-3 — 2026-08-12 실기기 세션의 `stt_parse_failed` **6건 전량**을 정상 거절 오라클로 고정.
 *
 * 🔴 **이 스펙은 「거절이 옳다」를 박는다.** 보통의 스펙은 기능이 도는 것을 지키지만, 여기서
 *    지키는 것은 **커밋하지 않는 것**이다. 6건 판독 결과 결함은 0건이었고, 전부 파서가
 *    「값을 지어내느니 다시 묻는다」는 계약(민구 결정 · 값 추측 금지)대로 거절한 것이었다.
 *    그 판정은 로그와 근거를 다 뒤져야 나오는데, 다음 회차가 실패율 10.7%(56발화 중 6건)만
 *    보고 "파서를 관대하게" 고치면 **조용한 오커밋**으로 되돌아간다. 그래서 픽스처로 박는다.
 *
 * 픽스처는 전부 `~/workspace_teamops/inbox/2026-08-12-log-manual/extracted/events.json`의
 * 원문 그대로다(transcript·alts·conf 무가공). `정답`은 같은 셀에 **최종 커밋된 값**이며,
 * 재질문 뒤 사용자가 실제로 다시 말해 확정된 값이다 — 즉 "무엇이 거절됐는가"가 아니라
 * **"거절하지 않았다면 무엇이 시트에 올라갔을 것인가"** 를 함께 고정한다.
 *
 * 순수 함수 스펙 — DOM 없이 Node에서 돈다(koreanNum.spec.ts·valueParseAttempt.spec.ts와 동형).
 */
import { test, expect } from '@playwright/test';
import { attemptParseValue } from '../src/lib/valueParseAttempt';
import type { Column } from '../src/types';

/** 08-12 세션의 실제 두 컬럼(둘 다 float·decimals=1). 사례별 이름만 다르고 판정에는 영향 없다. */
const FLOAT_COL: Column = {
  id: 'c1la8byb', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true,
  auto: { kind: 'fixed', value: '' }, decimals: 1,
};

const attempt = (text: string, alts: string[], fractionWhole: string | null = null) =>
  attemptParseValue({ col: FLOAT_COL, text, alts, fractionWhole });

test.describe('P-3 — 08-12 stt_parse_failed 6건: 전부 정상 거절', () => {
  test('#8285 09:49:43 multi_numeric — 독립 숫자 2개는 어느 쪽도 고르지 않는다', () => {
    // 발화 '나 90 9009'(conf 0.859) · 정답 99.9. 90도 9009도 정답이 아니다 —
    // 하나를 고르는 순간 측정값이 100배 틀린다. alts 3건 전부 파싱 불가라 폴백도 없다.
    const r = attempt('나 90 9009', ['나 90 9009', '나 9 9009', '90 9009']);
    expect(r.parsed).toBeNull();
    expect(r.failReason).toBe('multi_numeric');
    expect(r.events).toHaveLength(0);
  });

  test('#8795 09:54:06 no_number — 숫자가 없는 고신뢰 오인식', () => {
    // 발화 '담배'(conf 0.963) · 정답 300. "삼백"의 상습 오인식(koreanNum.ts 사유 예시에 등재).
    // 고신뢰라 신뢰도 게이트로는 못 거른다 — 파서가 거르는 것이 유일한 방어선이다.
    const r = attempt('담배', ['담배']);
    expect(r.parsed).toBeNull();
    expect(r.failReason).toBe('no_number');
  });

  test('#8820 09:54:19 decimal_fraction_lost — 소수부 음절은 추측하지 않고 정수부만 넘긴다', () => {
    // 발화 '111 점 에'(conf 0.698) · 정답 311.1. koreanNum.ts:287-290이 **이 발화를 그대로**
    // 인용하며 '에→1' 추측을 금지한다(같은 '111 점 에'가 111.1·111.5 양쪽 실례).
    // failWhole은 타깃 재질문("111 점, 소수점 아래 숫자만")용으로만 넘어간다 — 커밋값이 아니다.
    const r = attempt('111 점 에', ['111 점 에', '10011 점 에', '111 점 의']);
    expect(r.parsed).toBeNull();
    expect(r.failReason).toBe('decimal_fraction_lost');
    expect(r.failWhole).toBe('111');
  });

  test('#8827 09:54:27 decimal_fraction_lost — 소수부 문맥에서 전체값 alt는 쓰지 않는다([STT-15])', () => {
    // 발화 '311 점 의'(conf 0.844) · 소수부 재질문 문맥(fractionWhole='111') · 정답 311.1.
    // 🔴 alt[1] '311 .1'은 **파싱하면 정답 311.1이 나온다.** 그런데도 쓰지 않는 것이 계약이다
    //    — valueParseAttempt.ts:122-138 [STT-15] "전체값 폴백 금지"(민구 결정). 조각 alt가
    //    전체값으로 커밋된 07-13 회귀를 막는 규칙이고, 여기서도 그 규칙대로 재질문으로 갔다
    //    (대가 = 재질문 1회 7.4초, 최종값은 정확).
    // 👉 이 단언이 깨지면 그건 버그 수정이 아니라 **계약 변경**이다. 민구 승인 없이 뒤집지 마라.
    const r = attempt('311 점 의', ['311 점 의', '311 .1', '311 점에'], '111');
    expect(r.parsed).toBeNull();
    expect(r.failReason).toBe('decimal_fraction_lost');
    expect(r.events).toHaveLength(0);
  });

  test('#8933 09:55:20 extraneous_token — 백단위를 삼킨 선행음절이 있으면 뒤 숫자를 커밋하지 않는다', () => {
    // 발화 '담배 95.5'(conf 0.903) · 정답 325.5. 거절이 없었다면 **95.5가 시트에 올라간다**
    // (325.5 → 95.5, 백단위 유실). koreanNum.ts:189-192가 선행음절 오인식을
    // HARMLESS_RESIDUAL_TOKENS에서 **일부러 뺀** 설계가 여기서 실제로 값을 지켰다.
    const r = attempt('담배 95.5', ['담배 95.5', '담배 15.5', '담배도 15.5']);
    expect(r.parsed).toBeNull();
    expect(r.failReason).toBe('extraneous_token');
    // 🔴 반증 짝 — 어떤 alt로도 95.5/15.5가 새어 나오면 안 된다.
    expect(r.parsed).not.toBe('95.5');
    expect(r.parsed).not.toBe('15.5');
  });

  test('#8987 09:55:57 extraneous_token — 같은 클래스 두 번째(당 백기)', () => {
    // 발화 '당 백기 16.6'(conf 0.948) · 정답 366.6. 거절이 없었다면 16.6이 올라간다.
    const r = attempt('당 백기 16.6', ['당 백기 16.6', '당 100 기 16.6']);
    expect(r.parsed).toBeNull();
    expect(r.failReason).toBe('extraneous_token');
    expect(r.parsed).not.toBe('16.6');
  });

  test('6건 전부: 파싱 실패이므로 지연 로그(events)를 하나도 방출하지 않는다', () => {
    // ParseAttemptResult 계약 — 실패면 events는 빈 배열이다(호출자가 성공 시에만 방출).
    const cases: Array<[string, string[], string | null]> = [
      ['나 90 9009', ['나 90 9009', '나 9 9009', '90 9009'], null],
      ['담배', ['담배'], null],
      ['111 점 에', ['111 점 에', '10011 점 에', '111 점 의'], null],
      ['311 점 의', ['311 점 의', '311 .1', '311 점에'], '111'],
      ['담배 95.5', ['담배 95.5', '담배 15.5', '담배도 15.5'], null],
      ['당 백기 16.6', ['당 백기 16.6', '당 100 기 16.6'], null],
    ];
    expect(cases).toHaveLength(6); // 08-12 세션 parse_failed 전량
    for (const [text, alts, frac] of cases) {
      const r = attempt(text, alts, frac);
      expect(r.parsed, `${text} 는 커밋되면 안 된다`).toBeNull();
      expect(r.events, `${text}`).toHaveLength(0);
    }
  });
});

test.describe('P-3 반증 짝 — 같은 경로가 정당한 발화는 여전히 통과한다', () => {
  // 위 6건의 단언이 "파서를 통째로 막아서" 통과하는 것이 아님을 고정한다.
  test('정상 발화는 그대로 커밋된다', () => {
    expect(attempt('99.9', ['99.9']).parsed).toBe('99.9');
    expect(attempt('300', ['300']).parsed).toBe('300');
    expect(attempt('325.5', ['325.5']).parsed).toBe('325.5');
  });

  test('소수부 재질문 문맥의 한 자리 응답은 정수부와 합성된다(#8827 직후 실사례)', () => {
    // 09:54:33 '하나' + fractionWhole='311' → 311.1 커밋(실제로 이렇게 확정됐다).
    const r = attempt('하나', ['하나'], '311');
    expect(r.parsed).toBe('311.1');
    expect(r.events.some((e) => e.kind === 'decimal_fraction_recovered')).toBe(true);
  });

  test('소수부 문맥 **밖**에서는 소수를 온전히 담은 alt가 수용된다(O3 규칙 — 스코프 확인)', () => {
    // #8827의 alt가 스킵된 이유가 「소수부 문맥」임을 반증으로 고정한다. 같은 alt라도
    // 문맥이 없으면 valueParseAttempt.ts:144-152가 수용한다 — 즉 O3가 죽은 게 아니다.
    const r = attempt('311 점 의', ['311 점 의', '311 .1', '311 점에'], null);
    expect(r.parsed).toBe('311.1');
    expect(r.events.some((e) => e.kind === 'alt_used')).toBe(true);
  });
});
