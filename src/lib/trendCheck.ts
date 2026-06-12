/**
 * v0.7.0 B4 — 추세 검증 순수 로직 (pastValues.ts / columnFlags.ts 패턴: 브라우저 의존 없음,
 * tests/trendCheck.spec.ts에서 Node로 직접 검증).
 *
 * 규칙(민구 결정):
 *  - increase 위반 = next < prev (같음은 통과 — 허용 오차 없음, 반대 방향만 알림)
 *  - decrease 위반 = next > prev (같음은 통과)
 *  - rule이 undefined(컬럼 trendRule 없음) / prev 또는 next가 숫자가 아님 / prev 없음 → null
 *  - pct = |next-prev| / |prev| * 100, 소수 1자리. prev === 0이면 pctText '' —
 *    호출자(useVoiceSession)는 % 구절을 생략한 문구로 안내한다.
 *  - 시트 셀은 '1,234.5' 같은 천단위 콤마가 올 수 있어 파싱 전에 콤마를 제거한다.
 */
import type { TrendRule } from '../types';

export interface TrendViolation {
  /** 직전 회차 값(숫자). */
  prev: number;
  /** 방금 커밋된 값(숫자). */
  next: number;
  /** |next-prev|/|prev|*100, 소수 1자리 문자열. prev===0이면 '' (문구에서 % 생략). */
  pctText: string;
  /** 위반 방향 — down: 작아졌습니다(increase 위반), up: 커졌습니다(decrease 위반). */
  direction: 'down' | 'up';
}

/** 숫자 파싱 — trim + 콤마 제거 후 유한수만. 비숫자/빈 값은 null.
 *  ReviewScreen의 표시/증감 계산도 이 파서를 쓴다(시트 값 숫자 해석의 SSOT). */
export function parseNumeric(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 추세 위반 검사. 위반이면 TrendViolation, 통과/판정 불가면 null.
 * 판정 불가(null) 사유: rule 없음, prev 누락, prev/next 비숫자 — 호출자는 조용히 통과시킨다.
 */
export function checkTrend(
  rule: TrendRule | undefined,
  prevRaw: string | null | undefined,
  nextRaw: string,
): TrendViolation | null {
  if (rule !== 'increase' && rule !== 'decrease') return null;
  const prev = parseNumeric(prevRaw);
  const next = parseNumeric(nextRaw);
  if (prev === null || next === null) return null;
  const violated = rule === 'increase' ? next < prev : next > prev;
  if (!violated) return null;
  return {
    prev,
    next,
    pctText: prev === 0 ? '' : ((Math.abs(next - prev) / Math.abs(prev)) * 100).toFixed(1),
    direction: next < prev ? 'down' : 'up',
  };
}
