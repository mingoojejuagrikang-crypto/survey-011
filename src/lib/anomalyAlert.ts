/**
 * 이상치 알람 페이로드 조립 — 순수 모듈 (v0.35.1 리뷰 라운드2에서 useVoiceSession으로부터 추출).
 *
 * 추출 이유(Codex Medium): logExtra는 SOP-003 외부 파서와의 **바이트 계약**인데 useVoiceSession
 * 내부 비공개 함수라 전체 문자열을 고정하는 특성화 테스트를 걸 수 없었다. 순수 모듈로 분리해
 * Node 러너 테스트(tests/anomalyAlert.spec.ts)가 대표 사례의 extra를 toBe()로 고정한다.
 * (GL-006 §9·§10 — 비즈니스 로직은 UI를 모르는 순수 계층으로.)
 */

import type { Column } from '../types';
import type { TrendViolation } from './trendCheck';

/** 이상치 알람 표시 산출 SSOT — v0.33.0 항목6에서 음성 커밋(handleFinal)과 수동 커밋
 *  (commitManualValue)이 공유하도록 추출. 이력·근거(원 handleFinal 블록에서 이전):
 *  - v0.9.0(민구 요청): 변동률(pct) 트리거는 % 유지, 증가/감소(direction)·both는 절대값 차이 —
 *    절대차는 부동소수 잔여(2.2000002) 방지로 컬럼 소수자리 반올림(float=col.decimals||1, int=0).
 *  - v0.20.0 입력탭#6: alertKind가 음성(alertText)·팝업(kind)을 동시에 가른다 — TTS 문구는
 *    팝업 라벨(AnomalyAlertPopup)과 **글자까지 동일** 계약(시각·청각 일치).
 *  - v0.24.0(민구 요청): 범위 알람은 설정 임계가 아니라 실제 편차%를 부호와 함께("+##%"/"-##%",
 *    정수 반올림, 미산출 시 설정 임계 폴백).
 *  - v0.25.0 기능3(WS-3, 민구 요청): 추세·범위 동시 발동(trigger:'both')은 범위 우선 —
 *    순수 'direction'만 추세, 'pct'·'both'는 범위.
 *  - self-confirm 환각 방어(v0.13.0 R7): 문구가 명령어로 끝나지 않는다('확인해주세요' 없음). */
export function buildAnomalyDisplay(col: Column | null, v: TrendViolation): {
  alertKind: 'trend' | 'range';
  changeText: string;
  alertText: string;
  threshold?: number;
} {
  const decForDiff = col?.type === 'float' ? (col.decimals ?? 1) : 0;
  const alertKind: 'trend' | 'range' = v.trigger === 'direction' ? 'trend' : 'range';
  // 표시값: 범위=실제 편차%(v.pctText; prev≠0이면 항상 산출) · 추세=절대 변화량. 팝업 changeText 동일 값.
  const changeText =
    alertKind === 'range'
      ? (v.pctText ? `${v.pctText}%` : '')
      : Math.abs(v.next - v.prev).toFixed(decForDiff);
  // changeNum = 변화량 숫자만(팝업 changeText.replace와 동일 규칙) — 추세 발화/표시에 쓴다.
  const changeNum = changeText.replace(/[^0-9.]/g, '');
  const rangeThreshold = col?.pctThreshold;
  const rangePct = changeNum ? Math.round(Number(changeNum)) : rangeThreshold;
  const rangeSign = v.direction === 'up' ? '+' : '-';
  const alertText =
    alertKind === 'range'
      ? `범위 알람 ${rangeSign}${rangePct}%`
      : `추세 알람 ${v.direction === 'up' ? '증가' : '감소'}${changeNum ? ` ${changeNum}` : ''}`;
  return { alertKind, changeText, alertText, threshold: rangeThreshold };
}

/** v0.35.1 Stage 1-2 — 이상치 알람 발동 페이로드 조립 SSOT. 음성 커밋(handleFinal)과 수동 커밋
 *  (commitManualValue의 fireManualAlert)이 따로 조립하던 `trend_alert_fired` extra 문자열과 팝업
 *  (setAnomalyAlert) 공통 코어를 한 곳으로 모은다.
 *  - logExtra는 SOP-003 파서 계약 — **바이트 불변**. 호출부 전용 접미사(수동 경로의
 *    ',src=manual[,hold=1]')는 호출부가 이어 붙인다.
 *  - alert는 공통 코어만 담는다. 호출부가 자기 필드(awaitingResponse/colId/manualHold)를 spread로 얹는다. */
export function buildAnomalyAlert(args: {
  col: Column | null;
  v: TrendViolation;
  colName: string;
  /** 팝업 next 표시값 — 이미 formatForTts 적용본. */
  next: string;
  row: number;
  sampleKey?: string;
  prevDate?: string;
}): {
  /** 알람 TTS/팝업 라벨 문구(글자까지 동일 계약) — 음성 경로가 say()에 쓴다. */
  alertText: string;
  logExtra: string;
  alert: {
    colName: string;
    prev: string;
    next: string;
    direction: 'up' | 'down';
    changeText: string;
    row: number;
    sampleKey?: string;
    prevDate?: string;
    /** v0.13.0 R2 — 이상치(빨강) 상태. 정정 정상 시 호출부가 'corrected'(초록)로 갱신. */
    status: 'pending';
    /** v0.20.0 입력탭#6 — 팝업이 추세/범위 표시를 가르는 신호. */
    kind: 'trend' | 'range';
    threshold?: number;
  };
} {
  const { col, v, colName, next, row, sampleKey, prevDate } = args;
  const { alertKind, changeText, alertText, threshold } = buildAnomalyDisplay(col, v);
  return {
    alertText,
    logExtra: `trend_alert_fired:trigger=${v.trigger},kind=${alertKind},dir=${v.direction},change=${changeText || '?'},text=${alertText}`,
    alert: {
      colName,
      prev: String(v.prev),
      next,
      direction: v.direction,
      changeText,
      row,
      sampleKey,
      prevDate,
      status: 'pending',
      kind: alertKind,
      ...(threshold != null ? { threshold } : {}),
    },
  };
}

