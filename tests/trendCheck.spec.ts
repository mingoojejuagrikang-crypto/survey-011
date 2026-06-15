/**
 * v0.8.0 — checkAnomaly 순수 함수 단위 테스트 (pastValues.spec.ts 패턴: 브라우저 의존 없음,
 * Node에서 직접 import — 서버 불필요).
 *
 * v0.7.0 checkTrend에서 의미가 **정반대로 반전**됐다(이상치 알람):
 *  - increase = next > prev (커지면 알람), decrease = next < prev (작아지면 알람)
 *  - pctThreshold = 방향 무관 |Δ|/|prev|*100 ≥ 임계값이면 알람
 *  - 두 알람은 독립(OR), trigger: 'direction'|'pct'|'both'
 *
 * 커버리지:
 *  - 반전 방향 + direction(실제 부호) + trigger
 *  - 같음(equal)은 통과
 *  - 규칙 없음 / prev 누락 / prev·next 비숫자 → null
 *  - % 임계값(방향 무관 양방향) + prev=0(% 알람 안 침) + trigger 판별
 *  - 천단위 콤마 제거
 */
import { test, expect } from '@playwright/test';
import { checkAnomaly } from '../src/lib/trendCheck';

test.describe('checkAnomaly — 방향 알람(의미 반전)', () => {
  test('확정 예시: prev=100, next=120, increase → 발화(direction up, trigger direction)', () => {
    const v = checkAnomaly({ trendRule: 'increase' }, '100', '120');
    expect(v).not.toBeNull();
    expect(v!.prev).toBe(100);
    expect(v!.next).toBe(120);
    expect(v!.direction).toBe('up');
    expect(v!.trigger).toBe('direction');
    expect(v!.pctText).toBe('20.0');
  });

  test('increase: next < prev → 통과(null) — 작아지는 건 정상', () => {
    expect(checkAnomaly({ trendRule: 'increase' }, '100', '80')).toBeNull();
  });

  test('decrease: next < prev → 발화(direction down)', () => {
    const v = checkAnomaly({ trendRule: 'decrease' }, '100', '80');
    expect(v).not.toBeNull();
    expect(v!.direction).toBe('down');
    expect(v!.trigger).toBe('direction');
    expect(v!.pctText).toBe('20.0');
  });

  test('decrease: next > prev → 통과(null)', () => {
    expect(checkAnomaly({ trendRule: 'decrease' }, '100', '120')).toBeNull();
  });

  test('같음은 양 규칙 모두 통과', () => {
    expect(checkAnomaly({ trendRule: 'increase' }, '100', '100')).toBeNull();
    expect(checkAnomaly({ trendRule: 'decrease' }, '100', '100')).toBeNull();
    expect(checkAnomaly({ trendRule: 'increase' }, '100.0', '100')).toBeNull();
  });
});

test.describe('checkAnomaly — 판정 불가 → null', () => {
  test('규칙 없음(방향·% 둘 다 off) → null', () => {
    expect(checkAnomaly({}, '100', '120')).toBeNull();
    expect(checkAnomaly({ trendRule: undefined, pctThreshold: undefined }, '100', '120')).toBeNull();
  });

  test('prev 누락 → null', () => {
    expect(checkAnomaly({ trendRule: 'increase' }, null, '120')).toBeNull();
    expect(checkAnomaly({ trendRule: 'increase' }, undefined, '120')).toBeNull();
    expect(checkAnomaly({ trendRule: 'increase' }, '', '120')).toBeNull();
    expect(checkAnomaly({ trendRule: 'increase' }, '   ', '120')).toBeNull();
  });

  test('prev/next 비숫자 → null', () => {
    expect(checkAnomaly({ trendRule: 'increase' }, '비고없음', '120')).toBeNull();
    expect(checkAnomaly({ trendRule: 'increase' }, '100', '많음')).toBeNull();
    expect(checkAnomaly({ trendRule: 'increase' }, '100', '')).toBeNull();
  });
});

test.describe('checkAnomaly — % 변동률 알람(방향 무관)', () => {
  test('% 임계값 15, prev=100→next=120(증가) → 발화(direction up, trigger both)', () => {
    // increase 방향도 fired(120>100) + pct 20>=15 → both
    const v = checkAnomaly({ trendRule: 'increase', pctThreshold: 15 }, '100', '120');
    expect(v).not.toBeNull();
    expect(v!.trigger).toBe('both');
    expect(v!.direction).toBe('up');
    expect(v!.pctText).toBe('20.0');
  });

  test('% 임계값 15, prev=100→next=80(감소) → 방향(increase) 미발화지만 % 발화(trigger pct, direction down)', () => {
    const v = checkAnomaly({ trendRule: 'increase', pctThreshold: 15 }, '100', '80');
    expect(v).not.toBeNull();
    expect(v!.trigger).toBe('pct'); // increase는 작아지면 미발화, % 20>=15만 발화
    expect(v!.direction).toBe('down');
    expect(v!.pctText).toBe('20.0');
  });

  test('% 단독(방향 규칙 없음): prev=100→next=120 → % 발화(direction up)', () => {
    const v = checkAnomaly({ pctThreshold: 15 }, '100', '120');
    expect(v).not.toBeNull();
    expect(v!.trigger).toBe('pct');
    expect(v!.direction).toBe('up');
  });

  test('% 단독: prev=100→next=80(감소)도 발화(방향 무관)', () => {
    const v = checkAnomaly({ pctThreshold: 15 }, '100', '80');
    expect(v).not.toBeNull();
    expect(v!.trigger).toBe('pct');
    expect(v!.direction).toBe('down');
    expect(v!.pctText).toBe('20.0');
  });

  test('% 임계값 미달 + 방향 미발화 → null', () => {
    // increase, next < prev (방향 미발화) + pct 5 < 임계값 15 → null
    expect(checkAnomaly({ trendRule: 'increase', pctThreshold: 15 }, '100', '95')).toBeNull();
    // 방향 규칙 없음 + pct 5 < 15 → null
    expect(checkAnomaly({ pctThreshold: 15 }, '100', '105')).toBeNull();
  });

  test('% 임계값 경계(>=): 정확히 임계값이면 발화', () => {
    const v = checkAnomaly({ pctThreshold: 20 }, '100', '120');
    expect(v).not.toBeNull();
    expect(v!.pctText).toBe('20.0');
  });

  test('prev=0 → % 계산 불가(% 알람 안 침). 방향 규칙은 여전히 적용', () => {
    // 방향 규칙 없음 + prev=0 → % 못 잡음 → null
    expect(checkAnomaly({ pctThreshold: 15 }, '0', '5')).toBeNull();
    // increase + prev=0 + next>0 → 방향 발화, pctText ''
    const v = checkAnomaly({ trendRule: 'increase', pctThreshold: 15 }, '0', '5');
    expect(v).not.toBeNull();
    expect(v!.trigger).toBe('direction');
    expect(v!.direction).toBe('up');
    expect(v!.pctText).toBe('');
  });

  test('subnormal prev(1e-309) → % 나눗셈 오버플로(Infinity) 누출 방지', () => {
    // |1-1e-309|/1e-309*100 = Infinity. % 단독이면 발화하지 않고(null), pctText에 'Infinity' 누출 없음.
    expect(checkAnomaly({ pctThreshold: 1 }, '1e-309', '1')).toBeNull();
    // 방향 규칙이 있으면 방향으로는 발화하되 pctText는 빈 문자열('Infinity' 아님).
    const v = checkAnomaly({ trendRule: 'increase', pctThreshold: 1 }, '1e-309', '1');
    expect(v).not.toBeNull();
    expect(v!.trigger).toBe('direction');
    expect(v!.pctText).toBe('');
    expect(v!.pctText).not.toContain('Infinity');
  });
});

test.describe('checkAnomaly — pct 포맷 + 시트 셀 관용', () => {
  test('소수 1자리 반올림', () => {
    // increase, 2→3 (+50%)
    expect(checkAnomaly({ trendRule: 'increase' }, '2', '3')!.pctText).toBe('50.0');
    expect(checkAnomaly({ trendRule: 'increase' }, '3', '4')!.pctText).toBe('33.3');
  });

  test('음수 prev — |prev| 기준 pct', () => {
    // decrease: next < prev. -10 → -20 (작아짐) → 발화
    const v = checkAnomaly({ trendRule: 'decrease' }, '-10', '-20');
    expect(v).not.toBeNull();
    expect(v!.direction).toBe('down');
    expect(v!.pctText).toBe('100.0');
  });

  test('천단위 콤마 제거', () => {
    const v = checkAnomaly({ trendRule: 'increase' }, '1,000', '1,234.5');
    expect(v).not.toBeNull();
    expect(v!.prev).toBe(1000);
    expect(v!.next).toBe(1234.5);
    expect(v!.pctText).toBe('23.4'); // 23.45% → toFixed(1) (부동소수 표현상 23.4)
  });

  test('trim — 앞뒤 공백 허용', () => {
    expect(checkAnomaly({ trendRule: 'increase' }, ' 100 ', ' 120 ')).not.toBeNull();
  });
});
