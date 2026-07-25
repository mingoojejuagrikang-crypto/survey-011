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
import { buildAnomalyAlert, anomalyAlarmLabel } from '../src/lib/anomalyAlert';
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
    expect(alertText).toBe('추세 알람 감소 : 4.9');
    expect(logExtra).toBe(
      'trend_alert_fired:trigger=direction,kind=trend,dir=down,change=4.9,text=추세 알람 감소 : 4.9',
    );
  });

  test('범위(pct) 트리거 — 실제 편차% 부호 포함', () => {
    const { logExtra, alertText } = buildAnomalyAlert({
      col: FLOAT_COL, v: violation({ trigger: 'pct', direction: 'up', prev: 30, next: 36, pctText: '20.0' }),
      colName: '횡경', next: '36', row: 1,
    });
    expect(alertText).toBe('범위 알람 : +20%');
    expect(logExtra).toBe(
      'trend_alert_fired:trigger=pct,kind=range,dir=up,change=20.0%,text=범위 알람 : +20%',
    );
  });

  test('both 트리거 — 범위 우선(v0.25.0 기능3)', () => {
    const { logExtra } = buildAnomalyAlert({
      col: FLOAT_COL, v: violation({ trigger: 'both', pctText: '-14.0' }),
      colName: '횡경', next: '30.2', row: 3,
    });
    expect(logExtra).toBe(
      'trend_alert_fired:trigger=both,kind=range,dir=down,change=-14.0%,text=범위 알람 : -14%',
    );
  });

  test('pctText 미산출(prev=0) — change는 ? 폴백, 범위%는 설정 임계 폴백', () => {
    const { logExtra } = buildAnomalyAlert({
      col: FLOAT_COL, v: violation({ trigger: 'pct', direction: 'up', prev: 0, next: 5, pctText: undefined }),
      colName: '횡경', next: '5', row: 1,
    });
    expect(logExtra).toBe(
      'trend_alert_fired:trigger=pct,kind=range,dir=up,change=?,text=범위 알람 : +10%',
    );
  });

  test('수동 커밋(hold) — buildAnomalyAlert가 접미사까지 조립한 실제 logExtra 고정', () => {
    const { logExtra } = buildAnomalyAlert({
      col: FLOAT_COL, v: violation({ trigger: 'direction' }),
      colName: '횡경', next: '30.2', row: 3, manual: { hold: true },
    });
    expect(logExtra).toBe(
      'trend_alert_fired:trigger=direction,kind=trend,dir=down,change=4.9,text=추세 알람 감소 : 4.9,src=manual,hold=1',
    );
  });

  test('수동 커밋(non-hold) — src=manual만, hold 태그 없음', () => {
    const { logExtra } = buildAnomalyAlert({
      col: FLOAT_COL, v: violation({ trigger: 'direction' }),
      colName: '횡경', next: '30.2', row: 3, manual: { hold: false },
    });
    expect(logExtra).toBe(
      'trend_alert_fired:trigger=direction,kind=trend,dir=down,change=4.9,text=추세 알람 감소 : 4.9,src=manual',
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

/** logExtra에서 `text=` 값만 뽑는다(라벨엔 쉼표가 없다 — 뒤 `,src=manual` 접미사와 안전히 분리). */
function textField(logExtra: string): string {
  const at = logExtra.indexOf(',text=');
  const rest = logExtra.slice(at + ',text='.length);
  const comma = rest.indexOf(',');
  return comma === -1 ? rest : rest.slice(0, comma);
}

/**
 * 시각·청각 일치 계약 — 화면 라벨 == TTS(alertText) == 로그 `text=` (PRINCIPLES §2).
 *
 * 여기서 검증하는 건 "같은 함수를 두 번 부르면 같다"(토톨로지)가 **아니다**. `anomalyAlarmLabel`에
 * 넘기는 건 `buildAnomalyAlert`가 반환한 **팝업 페이로드(alert)** 다 — 팝업이 실제로 손에 쥐는
 * 것과 같은 객체다. 즉 "팝업에 전달되는 페이로드만으로 TTS와 **글자까지 같은** 문구가 재현되는가"를
 * 고정한다. 페이로드에서 threshold/kind/direction/changeText 중 하나라도 빠지면 여기서 깨진다.
 *
 * 팝업이 그 함수를 **실제로 호출하는지**(자체 조립으로 되돌아가지 않는지)는 이 유닛 레이어가
 * 관측할 수 없다 — DOM==TTS==`text=` 3자 동등은 `trend-alert.spec.ts`의 e2e가 고정한다.
 */
test.describe('경보 문구 SSOT — 화면 == TTS == 로그 text=', () => {
  const CASES: Array<{ name: string; v: Partial<TrendViolation>; expected: string }> = [
    {
      name: '추세 증가',
      v: { trigger: 'direction', direction: 'up', prev: 100, next: 120.5 },
      expected: '추세 알람 증가 : 20.5',
    },
    {
      name: '추세 감소',
      v: { trigger: 'direction', direction: 'down', prev: 35.1, next: 30.2 },
      expected: '추세 알람 감소 : 4.9',
    },
    {
      name: '범위 증가',
      v: { trigger: 'pct', direction: 'up', prev: 30, next: 36, pctText: '20.0' },
      expected: '범위 알람 : +20%',
    },
    {
      name: '범위 감소',
      v: { trigger: 'pct', direction: 'down', prev: 55, next: 40, pctText: '27.3' },
      expected: '범위 알람 : -27%',
    },
    {
      name: '범위 — 편차% 미산출(changeNum 빈 경우) → 설정 임계 폴백',
      v: { trigger: 'pct', direction: 'up', prev: 0, next: 5, pctText: undefined },
      expected: '범위 알람 : +10%',
    },
  ];

  for (const c of CASES) {
    test(`${c.name} — 세 문자열이 글자까지 동일`, () => {
      const { alertText, logExtra, alert } = buildAnomalyAlert({
        col: FLOAT_COL, v: violation(c.v), colName: '횡경', next: String(c.v.next), row: 1,
      });
      // 화면(팝업이 페이로드로 만드는 라벨) — 팝업과 동일 호출.
      expect(anomalyAlarmLabel(alert)).toBe(c.expected);
      expect(alertText).toBe(c.expected);          // TTS
      expect(textField(logExtra)).toBe(c.expected); // 텔레메트리
    });
  }

  test('추세 — changeNum 빈 방어 분기: 숫자부를 생략한다(화면 전용 `—`를 TTS가 읽지 않게)', () => {
    // checkAnomaly가 parseNumeric으로 유한수만 통과시키므로 실사용에선 도달 불가한 방어 분기다.
    // 종전엔 화면만 `추세 알람 증가 : —`, TTS는 `추세 알람 증가`로 갈렸다 — SSOT 통합 시
    // **숫자부 생략**을 택했다(브리프 지정 방향, 기존 단언과 충돌 없음).
    expect(anomalyAlarmLabel({ kind: 'trend', direction: 'up', changeText: '' }))
      .toBe('추세 알람 증가');
    expect(anomalyAlarmLabel({ kind: 'trend', direction: 'down', changeText: '' }))
      .toBe('추세 알람 감소');
  });

  test('kind 미지정(구버전 저장 알람) — 추세 형태로 폴백(sessionStore 계약 유지)', () => {
    expect(anomalyAlarmLabel({ direction: 'up', changeText: '20.5' })).toBe('추세 알람 증가 : 20.5');
  });
});
