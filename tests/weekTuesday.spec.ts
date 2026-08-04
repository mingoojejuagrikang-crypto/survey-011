/**
 * v0.44.0 §C8 F27 — "일요일 시작 주차의 화요일" 순수 유틸 단위 테스트
 * (isoWeek.spec.ts 패턴: 브라우저 의존 없음, Node에서 직접 import — 서버 불필요).
 *
 * 민구 확정(2026-08-02): 날짜 컬럼 "지정" 기본값 = **오늘이 속한, 일요일에 시작하는 주의 화요일**.
 *   - 2026-08-02(일) → 2026-08-04(화)
 *   - 2026-08-03(월) → 2026-08-04(화)
 *   - 2026-08-08(토) → 2026-08-04(화)
 *
 * 🔴 반증축: lib/isoWeek.ts(ISO 8601)는 **월요일 시작**이라 그대로 못 쓴다. 일요일 입력을
 * 월요일 시작 주로 계산하면 2026-08-02(일)의 "그 주 화요일"은 2026-07-28이 된다 — 구현을
 * 월요일 시작으로 바꾸면 아래 일요일 케이스가 red.
 *
 * 함수 import는 **동작**을 재기 위한 것(값 상수 import 아님 — 기대값은 전부 리터럴).
 */
import { test, expect } from '@playwright/test';
import { tuesdayOfSundayWeek, defaultDesignatedDate, localTodayIso } from '../src/lib/weekTuesday';

test.describe('tuesdayOfSundayWeek — 민구 확정 3요일(일·월·토)', () => {
  test('2026-08-02(일) → 2026-08-04 — 🔴 월요일 시작이면 07-28이 나와 red', () => {
    expect(tuesdayOfSundayWeek('2026-08-02')).toBe('2026-08-04');
  });

  test('2026-08-03(월) → 2026-08-04', () => {
    expect(tuesdayOfSundayWeek('2026-08-03')).toBe('2026-08-04');
  });

  test('2026-08-08(토) → 2026-08-04 (주의 마지막 날도 같은 주)', () => {
    expect(tuesdayOfSundayWeek('2026-08-08')).toBe('2026-08-04');
  });
});

test.describe('tuesdayOfSundayWeek — 경계', () => {
  test('오늘이 화요일이면 오늘 그대로 (2026-08-04)', () => {
    expect(tuesdayOfSundayWeek('2026-08-04')).toBe('2026-08-04');
  });

  test('다음 주 일요일(2026-08-09)은 다음 주 화요일(08-11)', () => {
    expect(tuesdayOfSundayWeek('2026-08-09')).toBe('2026-08-11');
  });

  test('월 경계 — 2026-08-31(월)의 주(일=08-30 시작)는 화요일이 09-01', () => {
    expect(tuesdayOfSundayWeek('2026-08-31')).toBe('2026-09-01');
  });

  test('연 경계 — 2026-01-01(목)의 주는 2025-12-28(일) 시작, 화요일 2025-12-30', () => {
    expect(tuesdayOfSundayWeek('2026-01-01')).toBe('2025-12-30');
  });
});

test.describe('tuesdayOfSundayWeek — 파싱 불가는 null', () => {
  test('빈 값/형식 불일치/실재하지 않는 날짜', () => {
    expect(tuesdayOfSundayWeek(null)).toBeNull();
    expect(tuesdayOfSundayWeek(undefined)).toBeNull();
    expect(tuesdayOfSundayWeek('')).toBeNull();
    expect(tuesdayOfSundayWeek('2026/08/02')).toBeNull(); // 슬래시 미지원(ISO만)
    expect(tuesdayOfSundayWeek('2026-02-30')).toBeNull(); // 실재하지 않음(롤오버 거부)
  });
});

test.describe('defaultDesignatedDate / localTodayIso — 로컬 날짜 기준(타임존 안전)', () => {
  test('로컬 2026-08-02(일) 오전 → 2026-08-04', () => {
    // new Date(y, m, d)는 로컬 생성자 — 러너 타임존과 무관하게 "로컬 8/2"를 뜻한다.
    expect(defaultDesignatedDate(new Date(2026, 7, 2, 10, 0))).toBe('2026-08-04');
  });

  test('로컬 2026-08-08(토) 심야 → 2026-08-04 (UTC 변환으로 날짜가 밀리지 않는다)', () => {
    expect(defaultDesignatedDate(new Date(2026, 7, 8, 23, 59))).toBe('2026-08-04');
  });

  test('localTodayIso — 로컬 날짜 부품으로 ISO 조립(제로 패딩)', () => {
    expect(localTodayIso(new Date(2026, 0, 5, 1, 2))).toBe('2026-01-05');
  });
});
