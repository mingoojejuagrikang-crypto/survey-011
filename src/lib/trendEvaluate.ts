/**
 * v0.35.3 Stage 3-6 — 추세 이상치 평가 도메인 (useVoiceSession에서 순수 이동).
 *
 * 방금 커밋된 값의 이상치 알람 검사(v0.8.0 계보). 전역 마스터 토글 없음 — 컬럼에 방향 규칙
 * (trendRule) 또는 변동률 % 임계값(pctThreshold)이 하나라도 있으면 활성. 판정 불가(인덱스 없음·
 * 키 불완전·직전 회차/과거값 없음)는 조용히 skip하고 onSkip 콜백으로 사유를 알린다(세션당 1회
 * dedupe·텔레메트리는 호출부 소유 — 이 모듈은 세션 상태를 갖지 않는다).
 *
 * 여기서는 절대 fetch하지 않는다 — 프리페치가 채운 캐시(getCachedIndex)와 IDB 영속 폴백만 본다
 * (행 단위 재fetch 금지, B2 설계). 캐시 미스 시 ensurePastIndex()로 백오프 재시도만 nudge.
 */
import type { Column } from '../types';
import {
  getCachedIndex, getFallbackIndex, getFallbackBuiltAt, ensurePastIndex,
  keyColumns, buildSampleKey, previousRound, pastValue,
} from './pastValues';
import { checkAnomaly, type TrendViolation } from './trendCheck';

export type TrendSkipCause =
  | 'no_index' | 'no_key_cols' | 'incomplete_key' | 'no_prev_round' | 'no_past_value';

export function evaluateTrendForRow(args: {
  col: Column | null;
  columns: Column[];
  /** 행 전체 값(자동·고정·음성) 합성 thunk — 인덱스/키 검사를 통과했을 때만 계산(핫패스 보존). */
  composeRow: () => Record<string, string>;
  /** 로컬 오늘 ISO(세션당 1회 계산분) — previousRound는 오늘 미만 strictly. */
  today: string;
  nextRaw: string;
  onSkip: (cause: TrendSkipCause) => void;
  /** 신선 캐시가 없어 IDB 폴백으로 평가할 때 1회 통지(age 시간). dedupe는 호출부 몫. */
  onStaleIndex: (ageH: number) => void;
}): TrendViolation | null {
  const { col, columns, composeRow, today, nextRaw, onSkip, onStaleIndex } = args;
  const rule = col?.trendRule;
  const hasRule = rule === 'increase' || rule === 'decrease' || col?.pctThreshold != null;
  if (!col || !hasRule) return null;
  // v0.33.0 항목5 — 신선 캐시가 없으면 IDB 영속 폴백(fp 일치 + 14일 이내)으로 평가한다.
  // 07-13 실기기에서 토큰 만료 → 알람 침묵으로 -99.5% 오데이터가 무알람 통과한 근인의 잔여 해소
  // — **미로그인이어도 알람이 작동**한다.
  const freshIndex = getCachedIndex();
  const index = freshIndex ?? getFallbackIndex();
  // v0.14.0 A — 캐시 미스 시 백오프 재시도를 nudge(자가 제한). prefetch가 transient 실패해도
  // 이후 행 입력마다 재시도되어 세션 중반부터 이상치 알람이 살아난다.
  if (!index) { ensurePastIndex(); onSkip('no_index'); return null; }
  if (!freshIndex) {
    const builtAt = getFallbackBuiltAt();
    const ageH = builtAt != null ? Math.round((Date.now() - builtAt) / 3_600_000) : -1;
    onStaleIndex(ageH);
    ensurePastIndex(); // 폴백으로 평가는 계속하되, 백그라운드에선 신선 인덱스를 계속 시도.
  }
  const kc = keyColumns(columns);
  if (kc.length === 0) { onSkip('no_key_cols'); return null; } // 기능 비활성 케이스
  const rowValues = composeRow();
  const key = buildSampleKey(kc, rowValues);
  if (!key) { onSkip('incomplete_key'); return null; }
  const round = previousRound(index, key, today);
  if (!round) { onSkip('no_prev_round'); return null; }
  const prevRaw = pastValue(index, key, round, col.id);
  if (prevRaw === null) { onSkip('no_past_value'); return null; }
  return checkAnomaly(col, prevRaw, nextRaw);
}

/** v0.12.0 AREA2 V2 — 이상치 팝업에 곁들일 식별정보(샘플키 + 직전 회차 ISO 날짜).
 *  evaluateTrendForRow와 같은 캐시·키 합성을 쓰되 TrendViolation 타입은 순수하게 유지한다
 *  (trendCheck.ts 오염 금지). 캐시 없음·키 불완전이면 해당 필드 undefined(팝업이 안전 폴백). */
export function anomalyAlertContext(args: {
  columns: Column[];
  composeRow: () => Record<string, string>;
  today: string;
}): { sampleKey?: string; prevDate?: string } {
  const { columns, composeRow, today } = args;
  const kc = keyColumns(columns);
  if (kc.length === 0) return {};
  const sampleKey = buildSampleKey(kc, composeRow()) ?? undefined;
  if (!sampleKey) return {};
  // v0.33.0 항목5 — evaluateTrendForRow와 같은 폴백 체인(신선 캐시 ?? 영속 폴백).
  const index = getCachedIndex() ?? getFallbackIndex();
  if (!index) return { sampleKey };
  return { sampleKey, prevDate: previousRound(index, sampleKey, today) ?? undefined };
}
