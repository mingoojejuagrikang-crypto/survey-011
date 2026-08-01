import { type ReactNode, useEffect, useRef } from 'react';
import { AnomalyAlertPopup } from './AnomalyAlertPopup';
import { CompleteSummary } from './CompleteSummary';
import { ModifyIndicatorPill } from './ModifyIndicatorPill';
import { VoiceHero, AlarmInterimStrip } from './VoiceHero';
import { type ReaskReason } from './ReaskCue';
import type { GlowTone } from './EdgeGlow';
import type { Column } from '../../types';
import type { AnomalyAlert } from '../../stores/sessionStore';
import { logger } from '../../lib/logger';
import { endReachedRender } from '../../lib/logEvents';

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
  paused, anomalyAlert, endReached, modifyIndicator, currentCol,
  completedCount, totalRows, row, tone, reaskReason, completing, reviewCommit,
  modifyPrevValue, modifyCurrentValue, onExit,
}: {
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
  onExit: () => void;
}) {
  let branch: 'paused' | 'anomaly' | 'end' | 'modify' | 'hero' = 'hero';
  let content: ReactNode = null;
  if (paused) {
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
          display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto',
          justifyItems: 'center', overflow: 'hidden',
        }}
      >
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
        onExit={onExit}
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
  useEffect(() => {
    if (!endReached) return;
    const snapshot = telemetryRef.current;
    logger.log({
      type: 'session',
      extra: endReachedRender({ branch, alertStatus: snapshot.alertStatus }),
      row: snapshot.row,
    });
  }, [endReached, branch]);

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
