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

/** 경보행 문구 SSOT — 화면(AnomalyAlertPopup 헤드라인) · TTS(alertText) · 텔레메트리(`text=`)가
 *  **글자까지 동일**해야 하는 단 하나의 조립부다(PRINCIPLES §2 시각·청각 일치 계약,
 *  `voicePrompts.decimalReaskPrompt`와 같은 패턴).
 *
 *  왜 함수인가(F3 리뷰 라운드 'f3-ui' 반영, 민구 결정 2026-07-25): 종전엔 같은 문구를 두 곳에서
 *  따로 조립했다 — `buildAnomalyDisplay`의 `alertText`(콜론 없음)와 `AnomalyAlertPopup`의
 *  `alarmLabel`(콜론 있음). 팝업 주석이 "글자까지 동일" 계약을 선언하는데 바로 아래 코드가 그걸
 *  깨고 있었고, 테스트는 "문장부호 차이는 허용"이라는 주석으로 위반을 고정했다. 콜론만 맞추면
 *  다음에 또 어긋나므로 **조립부 자체를 하나로** 만든다 — 어긋남이 구조적으로 불가능해진다.
 *  민구 확정 방향 = **화면 표기(` : `)에 TTS·로그를 맞춘다**(SOP-003 매핑표에 `trend_alert_fired`·
 *  `text=`가 없어 파서 무영향 — 오케스트레이터 확인).
 *
 *  입력은 팝업이 이미 들고 있는 알람 페이로드 필드뿐이다(kind·direction·changeText·threshold).
 *  그래서 스토어 타입도, IDB `pendingValidation.alert` 스키마도 바꾸지 않는다 — 구버전이 저장한
 *  보류 알람을 복원해도 같은 문구가 나온다.
 *
 *  - 범위: `범위 알람 : ±NN%` — NN은 실제 편차%(정수 반올림), 미산출 시 설정 임계(threshold) 폴백.
 *  - 추세: `추세 알람 증가|감소 : NN` — NN은 절대 변화량.
 *    `changeNum`이 비면 숫자부를 **생략**한다(`추세 알람 증가`). 화면 전용 자리표시자 `—`를
 *    TTS가 읽게 만들지 않기 위해서다(브리프 지정 방향). 이 분기는 `checkAnomaly`가 유한수만
 *    통과시켜(parseNumeric) 실질 도달 불가한 방어 분기다. */
export function anomalyAlarmLabel(a: {
  /** 미지정이면 추세 형태로 폴백(구버전 저장 알람 보존 — sessionStore 주석과 동일 계약). */
  kind?: 'trend' | 'range';
  direction: 'up' | 'down';
  changeText: string;
  /** range 알람의 편차% 미산출 시 폴백(설정 임계 pctThreshold). */
  threshold?: number;
}): string {
  const changeNum = a.changeText ? a.changeText.replace(/[^0-9.]/g, '') : '';
  const sign = a.direction === 'up' ? '+' : '-';
  if (a.kind === 'range') {
    const rangePct = changeNum ? Math.round(Number(changeNum)) : a.threshold;
    return `범위 알람 : ${sign}${rangePct}%`;
  }
  return `추세 알람 ${a.direction === 'up' ? '증가' : '감소'}${changeNum ? ` : ${changeNum}` : ''}`;
}

/** 이상치 알람 표시 산출 SSOT — v0.33.0 항목6에서 음성 커밋(handleFinal)과 수동 커밋
 *  (commitManualValue)이 공유하도록 추출. 이력·근거(원 handleFinal 블록에서 이전):
 *  - v0.9.0(민구 요청): 변동률(pct) 트리거는 % 유지, 증가/감소(direction)·both는 절대값 차이 —
 *    절대차는 부동소수 잔여(2.2000002) 방지로 컬럼 소수자리 반올림(float=col.decimals||1, int=0).
 *  - v0.20.0 입력탭#6: alertKind가 음성(alertText)·팝업(kind)을 동시에 가른다 — TTS 문구는
 *    팝업 라벨(AnomalyAlertPopup)과 **글자까지 동일** 계약(시각·청각 일치). F3 반영(2026-07-25)
 *    이후 그 문구 조립은 `anomalyAlarmLabel` 한 곳뿐이라 두 경로가 어긋날 수 없다.
 *  - v0.24.0(민구 요청): 범위 알람은 설정 임계가 아니라 실제 편차%를 부호와 함께("+##%"/"-##%",
 *    정수 반올림, 미산출 시 설정 임계 폴백).
 *  - v0.25.0 기능3(WS-3, 민구 요청): 추세·범위 동시 발동(trigger:'both')은 범위 우선 —
 *    순수 'direction'만 추세, 'pct'·'both'는 범위.
 *  - self-confirm 환각 방어(v0.13.0 R7): 문구가 명령어로 끝나지 않는다('확인해주세요' 없음). */
function buildAnomalyDisplay(col: Column | null, v: TrendViolation): {
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
  const rangeThreshold = col?.pctThreshold;
  // 문구 조립은 anomalyAlarmLabel 하나뿐 — 팝업 헤드라인이 같은 함수를 같은 페이로드로 호출한다.
  const alertText = anomalyAlarmLabel({
    kind: alertKind,
    direction: v.direction,
    changeText,
    threshold: rangeThreshold,
  });
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
  /** 수동 커밋(commitManualValue) 경로 — logExtra에 ',src=manual[,hold=1]' 접미사를 붙인다.
   *  접미사 조립도 이 함수가 SSOT(리뷰 라운드3 Codex Medium — 호출부 재조립은 테스트가 실제
   *  계약을 검증하지 못하게 한다). 미지정 = 음성 경로(접미사 없음). */
  manual?: { hold: boolean };
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
  const { col, v, colName, next, row, sampleKey, prevDate, manual } = args;
  const { alertKind, changeText, alertText, threshold } = buildAnomalyDisplay(col, v);
  const manualSuffix = manual ? `,src=manual${manual.hold ? ',hold=1' : ''}` : '';
  return {
    alertText,
    logExtra: `trend_alert_fired:trigger=${v.trigger},kind=${alertKind},dir=${v.direction},change=${changeText || '?'},text=${alertText}${manualSuffix}`,
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

