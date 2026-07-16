/**
 * buildAnomalyAlert — SOP-003 텔레메트리 바이트 계약 특성화 테스트 (v0.35.1 리뷰 라운드2 Codex
 * Medium 반영, Node 러너 — 서버 불필요).
 *
 * `trend_alert_fired` extra 문자열은 외부 로그 파서(SOP-003)와의 **바이트 계약**이다. 기존 spec은
 * startsWith/부분 문자열만 확인해 필드 순서·쉼표·형식이 바뀌어도 통과할 수 있었다 — 여기서는
 * 대표 사례(direction/pct/both × 음성/수동 hold·non-hold)의 **전체 문자열을 toBe()로 고정**한다.
 * ⚠️ 이 테스트가 깨지면 = 파서 계약이 바뀐 것. 문자열을 고치지 말고 변경을 되돌리거나,
 * 정말 계약을 바꿔야 하면 SOP-003 파서·과거 zip 하위호환을 함께 검토하라.
 */

import { test, expect } from '@playwright/test';
import { buildAnomalyAlert } from '../src/lib/anomalyAlert';
import type { Column } from '../src/types';
import type { TrendViolation } from '../src/lib/trendCheck';

const FLOAT_COL = {
  id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true,
  auto: { kind: 'fixed', value: '' }, decimals: 1, pctThreshold: 10,
} as unknown as Column;

function violation(over: Partial<TrendViolation>): TrendViolation {
  return {
    prev: 35.1, next: 30.2, direction: 'down', trigger: 'direction',
    pctText: '-14.0', ...over,
  } as TrendViolation;
}

test.describe('trend_alert_fired extra — 전체 문자열 고정 (SOP-003 파서 계약)', () => {
  test('추세(direction) 트리거 — 절대 변화량, 소수자리 반올림', () => {
    const { logExtra, alertText } = buildAnomalyAlert({
      col: FLOAT_COL, v: violation({ trigger: 'direction' }),
      colName: '횡경', next: '30.2', row: 3,
    });
    expect(alertText).toBe('추세 알람 감소 4.9');
    expect(logExtra).toBe(
      'trend_alert_fired:trigger=direction,kind=trend,dir=down,change=4.9,text=추세 알람 감소 4.9',
    );
  });

  test('범위(pct) 트리거 — 실제 편차% 부호 포함', () => {
    const { logExtra, alertText } = buildAnomalyAlert({
      col: FLOAT_COL, v: violation({ trigger: 'pct', direction: 'up', prev: 30, next: 36, pctText: '20.0' }),
      colName: '횡경', next: '36', row: 1,
    });
    expect(alertText).toBe('범위 알람 +20%');
    expect(logExtra).toBe(
      'trend_alert_fired:trigger=pct,kind=range,dir=up,change=20.0%,text=범위 알람 +20%',
    );
  });

  test('both 트리거 — 범위 우선(v0.25.0 기능3)', () => {
    const { logExtra } = buildAnomalyAlert({
      col: FLOAT_COL, v: violation({ trigger: 'both', pctText: '-14.0' }),
      colName: '횡경', next: '30.2', row: 3,
    });
    expect(logExtra).toBe(
      'trend_alert_fired:trigger=both,kind=range,dir=down,change=-14.0%,text=범위 알람 -14%',
    );
  });

  test('pctText 미산출(prev=0) — change는 ? 폴백, 범위%는 설정 임계 폴백', () => {
    const { logExtra } = buildAnomalyAlert({
      col: FLOAT_COL, v: violation({ trigger: 'pct', direction: 'up', prev: 0, next: 5, pctText: undefined }),
      colName: '횡경', next: '5', row: 1,
    });
    expect(logExtra).toBe(
      'trend_alert_fired:trigger=pct,kind=range,dir=up,change=?,text=범위 알람 +10%',
    );
  });

  test('수동 커밋(hold) — buildAnomalyAlert가 접미사까지 조립한 실제 logExtra 고정', () => {
    const { logExtra } = buildAnomalyAlert({
      col: FLOAT_COL, v: violation({ trigger: 'direction' }),
      colName: '횡경', next: '30.2', row: 3, manual: { hold: true },
    });
    expect(logExtra).toBe(
      'trend_alert_fired:trigger=direction,kind=trend,dir=down,change=4.9,text=추세 알람 감소 4.9,src=manual,hold=1',
    );
  });

  test('수동 커밋(non-hold) — src=manual만, hold 태그 없음', () => {
    const { logExtra } = buildAnomalyAlert({
      col: FLOAT_COL, v: violation({ trigger: 'direction' }),
      colName: '횡경', next: '30.2', row: 3, manual: { hold: false },
    });
    expect(logExtra).toBe(
      'trend_alert_fired:trigger=direction,kind=trend,dir=down,change=4.9,text=추세 알람 감소 4.9,src=manual',
    );
  });

  test('팝업 코어 구조 — 필드 셋 고정(호출부 spread 계약)', () => {
    const { alert } = buildAnomalyAlert({
      col: FLOAT_COL, v: violation({ trigger: 'pct', pctText: '-14.0' }),
      colName: '횡경', next: '30.2', row: 3, sampleKey: '이원창-A-3', prevDate: '2026-07-10',
    });
    expect(alert).toEqual({
      colName: '횡경', prev: '35.1', next: '30.2', direction: 'down', changeText: '-14.0%',
      row: 3, sampleKey: '이원창-A-3', prevDate: '2026-07-10',
      status: 'pending', kind: 'range', threshold: 10,
    });
  });
});
