/**
 * v0.7.0 B4 — trendCheck 순수 함수 단위 테스트 (pastValues.spec.ts 패턴: 브라우저 의존 없음,
 * Node에서 직접 import — 서버 불필요).
 *
 * 커버리지:
 *  - increase/decrease 양방향 위반 + direction
 *  - 같음(equal)은 통과 (허용 오차 없음 — 반대 방향만 알림, 민구 결정)
 *  - rule 없음 / prev 누락 / prev·next 비숫자 → null (조용히 통과)
 *  - pct 소수 1자리 반올림, prev=0 → pctText '' (% 구절 생략)
 *  - 천단위 콤마 제거 후 파싱
 */
import { test, expect } from '@playwright/test';
import { checkTrend } from '../src/lib/trendCheck';

test.describe('checkTrend — 방향 규칙', () => {
  test('increase 위반 = next < prev (direction down)', () => {
    const v = checkTrend('increase', '100', '90');
    expect(v).not.toBeNull();
    expect(v!.prev).toBe(100);
    expect(v!.next).toBe(90);
    expect(v!.direction).toBe('down');
    expect(v!.pctText).toBe('10.0');
  });

  test('increase: next > prev → 통과(null)', () => {
    expect(checkTrend('increase', '100', '110')).toBeNull();
  });

  test('decrease 위반 = next > prev (direction up)', () => {
    const v = checkTrend('decrease', '50', '60');
    expect(v).not.toBeNull();
    expect(v!.direction).toBe('up');
    expect(v!.pctText).toBe('20.0');
  });

  test('decrease: next < prev → 통과(null)', () => {
    expect(checkTrend('decrease', '50', '40')).toBeNull();
  });

  test('같음은 양 규칙 모두 통과 (허용 오차 없음 — 같음은 위반 아님)', () => {
    expect(checkTrend('increase', '100', '100')).toBeNull();
    expect(checkTrend('decrease', '100', '100')).toBeNull();
    expect(checkTrend('increase', '100.0', '100')).toBeNull(); // 수치 동일, 표기만 다름
  });
});

test.describe('checkTrend — 판정 불가 → null (조용히 통과)', () => {
  test('rule undefined → null (위반 조건이어도)', () => {
    expect(checkTrend(undefined, '100', '90')).toBeNull();
  });

  test('prev 누락(null/undefined/빈 문자열/공백) → null', () => {
    expect(checkTrend('increase', null, '90')).toBeNull();
    expect(checkTrend('increase', undefined, '90')).toBeNull();
    expect(checkTrend('increase', '', '90')).toBeNull();
    expect(checkTrend('increase', '   ', '90')).toBeNull();
  });

  test('prev 비숫자 → null', () => {
    expect(checkTrend('increase', '비고없음', '90')).toBeNull();
    expect(checkTrend('increase', '12.3mm', '90')).toBeNull();
  });

  test('next 비숫자 → null', () => {
    expect(checkTrend('increase', '100', '많음')).toBeNull();
    expect(checkTrend('increase', '100', '')).toBeNull();
  });
});

test.describe('checkTrend — pct 포맷', () => {
  test('소수 1자리 반올림 (33.333… → 33.3, 18.995 → 19.0)', () => {
    expect(checkTrend('increase', '3', '2')!.pctText).toBe('33.3');
    expect(checkTrend('increase', '1234.5', '1000')!.pctText).toBe('19.0');
  });

  test('정확히 1자리 유지 (12.5 → 12.5, 100 → 100.0)', () => {
    expect(checkTrend('increase', '100', '87.5')!.pctText).toBe('12.5');
    expect(checkTrend('increase', '10', '20', )).toBeNull(); // sanity: 통과 방향
    expect(checkTrend('decrease', '10', '20')!.pctText).toBe('100.0');
  });

  test('prev = 0 → 위반은 잡되 pctText는 빈 문자열 (% 구절 생략 계약)', () => {
    const down = checkTrend('increase', '0', '-1');
    expect(down).not.toBeNull();
    expect(down!.direction).toBe('down');
    expect(down!.pctText).toBe('');
    const up = checkTrend('decrease', '0', '5');
    expect(up).not.toBeNull();
    expect(up!.direction).toBe('up');
    expect(up!.pctText).toBe('');
  });

  test('음수 prev — |prev| 기준 pct', () => {
    const v = checkTrend('increase', '-10', '-20');
    expect(v).not.toBeNull();
    expect(v!.direction).toBe('down');
    expect(v!.pctText).toBe('100.0');
  });
});

test.describe('checkTrend — 시트 셀 포맷 관용', () => {
  test('천단위 콤마 제거 (시트 서식 셀)', () => {
    const v = checkTrend('increase', '1,234.5', '1,000');
    expect(v).not.toBeNull();
    expect(v!.prev).toBe(1234.5);
    expect(v!.next).toBe(1000);
    expect(v!.pctText).toBe('19.0');
    expect(checkTrend('increase', '1,000', '1,234.5')).toBeNull(); // 콤마 + 통과 방향
  });

  test('trim — 앞뒤 공백 허용', () => {
    expect(checkTrend('increase', ' 100 ', ' 90 ')).not.toBeNull();
  });
});
