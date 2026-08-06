import { type ReactNode, useEffect, useRef } from 'react';
import { AnomalyAlertPopup } from './AnomalyAlertPopup';
import { CompleteSummary } from './CompleteSummary';
import { ExitConfirmInline } from './ExitConfirmInline';
import { ModifyIndicatorPill } from './ModifyIndicatorPill';
import { VoiceHero, AlarmInterimStrip } from './VoiceHero';
import { type ReaskReason } from './ReaskCue';
import type { GlowTone } from './EdgeGlow';
import type { Column } from '../../types';
import type { AnomalyAlert } from '../../stores/sessionStore';
import { logger } from '../../lib/logger';
import { endReachedRender } from '../../lib/logEvents';
import { T } from '../../tokens';

/** 금지된 알람 카드 내부 구현에 레이아웃 책임을 다시 섞지 않고, 중앙 stage가 공개 testid 계약을
 *  2열(라벨 1행 / 값 2행)로 배치한다. 인라인 style보다 우선해야 해서 이 범위 안에서만 `!important`를
 *  쓴다. 값/라벨 타이포는 `STATE_TYPE`의 열린 폭 비례 계약이 계속 맡는다.
 *
 *  🔴 **`line-height`를 이 블록에 다시 넣지 마라**(§C0, 2026-08-04). 종전 `line-height: 1
 *  !important`가 인라인 1.2(임계 1.15 위 — AnomalyAlertPopup `COMPARE_LINE_HEIGHT`)를 덮어
 *  글리프가 line box를 넘었고, 그 초과가 `useFitGroup`의 높이 판정을 전 배율에서 실패시켜
 *  compare 슬롯이 절대 하한(22/30px)에 갇혔다(제보 8건 화면의 잔여 원인). 제거로 fit이
 *  살아났다(375에서 값 30→60.6px, 오라클: v044-alarm-compare-fit · v0440-alarm-fit 단언C).
 *
 *  🔴 **`column-gap` 강제도 두지 마라**(리뷰② 실증, 2026-08-04). fit은 잉크를 트랙 경계까지
 *  키우므로(경계 추구 평형) 거터가 0이면 등길이 값쌍이 ~2px 간격으로 맞붙어 한 숫자로
 *  읽힌다(실캡처 "99.919.9"). 팝업 인라인 `columnGap: clamp(4px,1.5vw,12px)`가 최소 간격을
 *  보장한다. 오라클: v0440-alarm-fit 단언A의 잉크 간격 ≥ 4px.
 *
 *  ⚠️ 이 `<style>`은 알람 분기에서만 DOM에 존재한다 — 스타일 조사는 알람을 띄운 상태에서
 *  하라. (08-03 순회가 0건을 본 이유는 미확정이다 — 알람 밖 순회였거나 CORS 차단 시트에서
 *  순회가 끊겼을 수 있다. A0-probe.md §8-4) */
const ALARM_TWO_COLUMN_LAYOUT = `
  [data-central-state="alarm"] [data-testid="anomaly-alert"] {
    padding-block: 0 !important;
    row-gap: 0 !important;
  }
  [data-central-state="alarm"] [data-testid="anomaly-comparison"] {
    display: grid !important;
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    grid-template-rows: auto auto !important;
    width: 100% !important;
    row-gap: 0 !important;
    overflow: hidden !important;
  }
  [data-central-state="alarm"] [data-testid="anomaly-prev-label"] {
    grid-column: 1 !important;
    grid-row: 1 !important;
  }
  [data-central-state="alarm"] [data-testid="anomaly-next-label"] {
    grid-column: 2 !important;
    grid-row: 1 !important;
  }
  [data-central-state="alarm"] [data-testid="anomaly-prev-value"] {
    grid-column: 1 !important;
    grid-row: 2 !important;
  }
  [data-central-state="alarm"] [data-testid="anomaly-next-value"] {
    grid-column: 2 !important;
    grid-row: 2 !important;
  }
  [data-central-state="alarm"] [data-testid^="anomaly-"][data-testid$="-label"],
  [data-central-state="alarm"] [data-testid^="anomaly-"][data-testid$="-value"] {
    justify-self: center !important;
    text-align: center !important;
  }
  /* v0.44.0 §C6(F10, 민구 확정) — 빨강은 **원인 요소에만**: 현재값(next) 열이 원인이다.
     과거값(prev — 07-29/255.5)은 비교 기준일 뿐이라 빨강 금지 → 팝업 인라인 회색
     (textMute/textDim)이 그대로 보인다. 되돌려서 prev까지 빨갛게 칠하면
     v0440-c6-redscope 오라클이 red다. */
  [data-central-state="alarm"] [data-testid="anomaly-next-label"],
  [data-central-state="alarm"] [data-testid="anomaly-next-value"] {
    color: ${T.red} !important;
  }
`;

/** 와이어프레임 §공통규칙1·2·3 — **중앙 50%**.
 *  "정보는 가로+세로 중앙정렬(빈 공간에 따라 유동)", "폭 감안해 최대한 키운 뒤, 위/아래 여백
 *  고려해 화면 중앙 정렬".
 *
 *  상호배타 분기(정확히 하나만 렌더):
 *   1) paused  → **시각 비움**. 상태는 하단 도트 + 엣지글로우가 말하고 텍스트는 aria에만 남는다.
 *   2) anomaly → 경보행 + 2열 비교(§[2]).
 *   3) endReached → `X / N` + 종료. 완료 상태명은 aria·체크 도트·진행바가 맡는다.
 *   4) modify  → 중앙 값 surface. 항목명은 활성 칩, 상태명은 aria가 맡는다.
 *   5) hero    → 실시간 인식값 대형(§[1]).
 *
 *  🔴 이 분기는 **표시 전환**이다. ActiveState(=세션 트리)는 언제나 마운트돼 있고 여기서 자식만
 *  갈린다 — 세션 트리 자체를 조건부로 갈아치우면 인식기·워치독·클립 레코더가 teardown된다
 *  ([STT-16] 실기기 62초 사공백). */
export function CenterStage({
  exitConfirming, paused, anomalyAlert, endReached, modifyIndicator, currentCol,
  completedCount, totalRows, row, tone, reaskReason, completing, reviewCommit,
  modifyPrevValue, modifyCurrentValue,
}: {
  /** 저장확인 인라인 — 별도 레이어 없이 중앙과 하단 바의 의미만 바꾼다. */
  exitConfirming: boolean;
  paused: boolean;
  /** 표시할 이상치 알람(수동 입력 시트가 열려 있으면 부모가 null로 내린다). */
  anomalyAlert: AnomalyAlert | null;
  endReached: boolean;
  modifyIndicator: { colId: string; name: string } | null;
  currentCol?: Column;
  completedCount: number;
  totalRows: number;
  row: number;
  tone: GlowTone;
  reaskReason: ReaskReason;
  completing: boolean;
  reviewCommit: { name: string; value: string } | null;
  modifyPrevValue?: string;
  modifyCurrentValue: string;
}) {
  let branch: 'exit' | 'paused' | 'anomaly' | 'end' | 'modify' | 'hero' = 'hero';
  let content: ReactNode = null;
  if (exitConfirming) {
    branch = 'exit';
    content = <ExitConfirmInline completedCount={completedCount} totalRows={totalRows} />;
  } else if (paused) {
    branch = 'paused';
    // 시각적으로는 완전히 빈 중앙이다. 이 100% surface는 레이아웃·픽셀을 추가하지 않고
    // 스크린리더와 안정적인 상태 testid에만 "일시정지"를 남긴다(UI-c 규칙 1/3).
    content = (
      <div
        data-testid="paused-card"
        role="status"
        aria-label="일시정지"
        aria-live="polite"
        style={{ width: '100%', height: '100%' }}
      />
    );
  } else if (anomalyAlert) {
    branch = 'anomaly';
    content = (
      <div
        data-central-state="alarm"
        style={{
          width: '100%', height: '100%', minHeight: 0,
          display: 'grid',
          // 🔴 v0.46.0 콜드 리뷰 L3-1(critical) — **인식값 스트립 트랙에 상한을 둔다.**
          //    종전 `minmax(0,1fr) auto`는 2행이 내용만큼 무한히 커질 수 있었고, 1행이 `1fr`이라
          //    0까지 눌렸다. 그런데 **스트립의 fit 컨테이너가 스트립 자신**이어서, 카드가 눌린
          //    만큼 스트립에 배정될 높이가 또 늘어나는 **순환 판정**이 됐다(평형점 = 스트립이
          //    스테이지 전량). 폭만 묶여 있어 **1~2글자에서는 아무것도 안 묶였다**:
          //    실측 402×874 폰트 304.8px · 카드 높이 **0** · 터치 도달 실패.
          //    👉 트랙을 `50%`로 clamp하면 ①카드가 항상 절반을 확보하고 ②스트립 박스가 유한해져
          //    `overflowsHeight`가 실제 제한을 보므로 **fit이 스스로 줄어든다**(순환이 끊긴다).
          //    🔑 **폰트 상한이 아니다** — 규칙 2(고정 상한 금지)를 어기지 않는다. 제한하는 것은
          //    「영역 배분」이고 그 안에서 글자는 여전히 유동적으로 최대가 된다.
          //    ⚠️ `%` 트랙은 **그리드 컨테이너 높이 기준**이라 내용에 의존하지 않는다 —
          //    `auto`로 두면서 자식에 `height:100%`를 주면 순환이 되살아난다.
          //    게이트: `tests/v0460-cr-alarm-card-floor.spec.ts`
          gridTemplateRows: 'minmax(0, 1fr) minmax(0, 50%)',
          justifyItems: 'center', overflow: 'hidden',
        }}
      >
        <style>{ALARM_TWO_COLUMN_LAYOUT}</style>
        <AnomalyAlertPopup a={anomalyAlert} />
        {/* v0.37.0 FB-F — 알람 카드 아래 미확정 인식값 스트립(정정 발화 확인). interimValue 자체 구독. */}
        <AlarmInterimStrip />
      </div>
    );
  } else if (endReached) {
    branch = 'end';
    content = (
      <CompleteSummary
        completedCount={completedCount}
        totalRows={totalRows}
        reviewCommit={reviewCommit}
      />
    );
  } else if (modifyIndicator) {
    branch = 'modify';
    content = (
      <ModifyIndicatorPill
        name={modifyIndicator.name}
        prevValue={modifyPrevValue}
        newValue={modifyCurrentValue}
      />
    );
  } else if (currentCol) {
    branch = 'hero';
    content = (
      <VoiceHero
        col={currentCol}
        review={completing}
        row={row}
        tone={tone}
        reaskReason={completing ? null : reaskReason}
        reviewCommit={reviewCommit}
      />
    );
  }

  const telemetryRef = useRef<{
    alertStatus: 'none' | 'pending' | 'corrected';
    row: number;
  }>({ alertStatus: 'none', row });
  telemetryRef.current = {
    alertStatus: anomalyAlert ? (anomalyAlert.status ?? 'pending') : 'none',
    row,
  };
  // 저장확인은 기존 end 화면 위의 표시 전환이다. endReached 계측에 새 branch 바이트를 만들거나
  // 인라인 진입 때 같은 이벤트를 중복 기록하지 않는다(PRINCIPLES §4).
  const endReachedBranch: Exclude<typeof branch, 'exit'> = branch === 'exit' ? 'end' : branch;
  useEffect(() => {
    if (!endReached) return;
    const snapshot = telemetryRef.current;
    logger.log({
      type: 'session',
      extra: endReachedRender({ branch: endReachedBranch, alertStatus: snapshot.alertStatus }),
      row: snapshot.row,
    });
  }, [endReached, endReachedBranch]);

  return (
    <div
      data-testid="voice-center-stage"
      style={{
        minHeight: 0, overflow: 'hidden', width: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 'clamp(4px, 1vh, 10px) clamp(12px, 3vw, 24px)',
      }}
    >
      {content}
    </div>
  );
}
