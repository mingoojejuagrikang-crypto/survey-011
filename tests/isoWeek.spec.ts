/**
 * v0.8.0 — isoWeek 순수 유틸 단위 테스트 (trendCheck.spec.ts 패턴: 브라우저 의존 없음,
 * Node에서 직접 import — 서버 불필요).
 *
 * 앵커 값은 ISO 8601 달력으로 독립 검증한 것이다(직접 손계산 아님):
 *  - 2026-01-01(목) → 2026 W01.
 *  - 2021-01-01(금) → 2020 W53 (전년도 — 2020은 53주 해).
 *  - 2024-12-31(화) → 2025 W01 (다음 해로 넘어감).
 *  - 2020-12-31(목) → 2020 W53.
 *  - 윤년 2024 경계.
 */
import { test, expect } from '@playwright/test';
import { isoWeek, formatWeekRange } from '../src/lib/isoWeek';

test.describe('isoWeek — 기본', () => {
  test('주중 평일(목)은 그 주 W로, start=월 end=일', () => {
    const w = isoWeek('2026-06-03'); // 수요일
    expect(w).not.toBeNull();
    expect(w!.year).toBe(2026);
    expect(w!.week).toBe(23);
    expect(w!.start).toBe('2026-06-01'); // 월
    expect(w!.end).toBe('2026-06-07');   // 일
  });

  test('월요일/일요일 경계 — 같은 주 안에 묶인다', () => {
    expect(isoWeek('2026-06-01')!.week).toBe(23); // 월
    expect(isoWeek('2026-06-07')!.week).toBe(23); // 일
    expect(isoWeek('2026-06-08')!.week).toBe(24); // 다음 월
  });
});

test.describe('isoWeek — 연초/연말 ISO week-year 경계', () => {
  test('2026-01-01(목) → 2026 W01', () => {
    const w = isoWeek('2026-01-01');
    expect(w!.year).toBe(2026);
    expect(w!.week).toBe(1);
    expect(w!.start).toBe('2025-12-29'); // 월요일은 전년도
    expect(w!.end).toBe('2026-01-04');
  });

  test('2021-01-01(금) → 전년도 2020 W53 (53주 해)', () => {
    const w = isoWeek('2021-01-01');
    expect(w!.year).toBe(2020); // week-year = 달력 연도 아님
    expect(w!.week).toBe(53);
    expect(w!.start).toBe('2020-12-28');
    expect(w!.end).toBe('2021-01-03');
  });

  test('2024-12-31(화) → 다음 해 2025 W01', () => {
    const w = isoWeek('2024-12-31');
    expect(w!.year).toBe(2025);
    expect(w!.week).toBe(1);
    expect(w!.start).toBe('2024-12-30');
    expect(w!.end).toBe('2025-01-05');
  });

  test('2020-12-31(목) → 2020 W53', () => {
    const w = isoWeek('2020-12-31');
    expect(w!.year).toBe(2020);
    expect(w!.week).toBe(53);
  });
});

test.describe('isoWeek — 윤년 경계', () => {
  test('윤년 2024-02-29(목) 유효 + 주차', () => {
    const w = isoWeek('2024-02-29');
    expect(w).not.toBeNull();
    expect(w!.year).toBe(2024);
    expect(w!.week).toBe(9);
    expect(w!.start).toBe('2024-02-26');
    expect(w!.end).toBe('2024-03-03'); // 주가 월(2월)을 넘김
  });

  test('비윤년 2026-02-29 → null (실재하지 않는 날짜)', () => {
    expect(isoWeek('2026-02-29')).toBeNull();
  });
});

test.describe('isoWeek — 파싱 불가는 null', () => {
  test('빈 값/잘못된 형식/범위 밖', () => {
    expect(isoWeek(null)).toBeNull();
    expect(isoWeek(undefined)).toBeNull();
    expect(isoWeek('')).toBeNull();
    expect(isoWeek('2026/06/03')).toBeNull(); // 슬래시 미지원(회차는 정규화 ISO만)
    expect(isoWeek('2026-13-01')).toBeNull(); // 월 범위 밖
    expect(isoWeek('2026-06-32')).toBeNull(); // 일 범위 밖
  });
});

test.describe('formatWeekRange — 월-일 기간(민구 지시)', () => {
  test('일반 주 → "6/1~6/7"', () => {
    expect(formatWeekRange('2026-06-03')).toBe('6/1~6/7');
  });

  test('월을 넘는 주 → 양 끝 M/D ("5/25~5/31"·"2/26~3/3")', () => {
    expect(formatWeekRange('2024-02-29')).toBe('2/26~3/3');
  });

  test('연을 넘는 주 → "12/29~1/4"', () => {
    expect(formatWeekRange('2026-01-01')).toBe('12/29~1/4');
  });

  test('파싱 불가는 빈 문자열', () => {
    expect(formatWeekRange('bogus')).toBe('');
    expect(formatWeekRange(null)).toBe('');
  });
});
