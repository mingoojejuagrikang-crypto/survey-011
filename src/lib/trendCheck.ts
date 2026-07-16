/**
 * v0.8.0 — 이상치 알람 순수 로직 (pastValues.ts / columnFlags.ts 패턴: 브라우저 의존 없음,
 * tests/trendCheck.spec.ts에서 Node로 직접 검증).
 *
 * v0.7.0 "추세 검증"에서 의미가 **정반대로 반전**됐다(민구 결정). 사용자 멘탈모델:
 * "입력값이 과거 대비 이상하게 느껴지면 알람".
 *
 * 규칙:
 *  - 방향 알람(trendRule):
 *      increase = next > prev (직전보다 **커지면** 알람)
 *      decrease = next < prev (직전보다 **작아지면** 알람)
 *      같음(next === prev)은 통과. trendRule 없으면 방향 알람 off.
 *  - % 변동률 알람(pctThreshold): 방향 무관 절대 변동률 |next-prev|/|prev|*100 ≥ 임계값이면 알람.
 *      값(임계값)을 입력했을 때만 활성(undefined=off). prev===0이면 pct 계산 불가 → % 알람 안 침.
 *  - 두 알람은 독립(OR): 하나라도 fired면 TrendViolation 반환, 아니면 null.
 *  - rule/threshold 둘 다 없음 / prev·next 비숫자 / prev 없음 → null(조용히 통과).
 *  - 시트 셀은 '1,234.5' 같은 천단위 콤마가 올 수 있어 파싱 전에 콤마를 제거한다(parseNumeric SSOT).
 *
 * telemetry 키('trend'/trend_alert_*)는 로그 연속성을 위해 유지 — 함수명·문구만 변경.
 */
import type { Column } from '../types';

export interface TrendViolation {
  /** 직전 회차 값(숫자). */
  prev: number;
  /** 방금 커밋된 값(숫자). */
  next: number;
  /** |next-prev|/|prev|*100, 소수 1자리 문자열. prev===0이면 '' (문구에서 % 생략). */
  pctText: string;
  /** 실제 변화 방향 — up: 증가했습니다, down: 감소했습니다. (% 단독 발화도 실제 부호로 안내) */
  direction: 'down' | 'up';
  /** 어떤 조건이 알람을 울렸는지 — 'direction'(방향만) | 'pct'(변동률만) | 'both'(둘 다). */
  trigger: 'direction' | 'pct' | 'both';
}

/** 숫자 파싱 — trim + 콤마 제거 후 유한수만. 비숫자/빈 값은 null.
 *  시트 값 숫자 해석의 SSOT. */
export function parseNumeric(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/,/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * 이상치 알람 검사. 알람이면 TrendViolation, 통과/판정 불가면 null.
 * 판정 불가(null) 사유: 규칙 없음(방향·%둘다 off), prev 누락, prev/next 비숫자 — 호출자는 조용히 통과.
 *
 * @param col trendRule(방향) + pctThreshold(변동률 %)만 본다.
 */
export function checkAnomaly(
  col: Pick<Column, 'trendRule' | 'pctThreshold'>,
  prevRaw: string | null | undefined,
  nextRaw: string,
): TrendViolation | null {
  const rule = col.trendRule;
  const threshold = col.pctThreshold;
  const hasRule = rule === 'increase' || rule === 'decrease';
  const hasPct = threshold != null;
  if (!hasRule && !hasPct) return null;

  const prev = parseNumeric(prevRaw);
  const next = parseNumeric(nextRaw);
  if (prev === null || next === null) return null;

  // 방향 알람(의미 반전): increase=커지면, decrease=작아지면.
  const dirFired = rule === 'increase' ? next > prev : rule === 'decrease' ? next < prev : false;

  // % 변동률 알람(방향 무관). prev===0이거나 비정상(subnormal) prev로 나눗셈이 Infinity로
  // 오버플로하면 계산 불가 → null('Infinity%' 누출 방지).
  const pctRaw = prev === 0 ? null : (Math.abs(next - prev) / Math.abs(prev)) * 100;
  const pct = pctRaw != null && Number.isFinite(pctRaw) ? pctRaw : null;
  const pctFired = hasPct && pct != null && pct >= (threshold as number);

  if (!dirFired && !pctFired) return null;

  const trigger: TrendViolation['trigger'] =
    dirFired && pctFired ? 'both' : dirFired ? 'direction' : 'pct';

  return {
    prev,
    next,
    pctText: pct === null ? '' : pct.toFixed(1),
    // 실제 변화 부호 — % 단독 발화도 올바른 방향을 안내. 같음(0)은 위 fired 조건상 도달 불가.
    direction: next > prev ? 'up' : 'down',
    trigger,
  };
}
