import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { T } from '../../tokens';
import { useSessionStore } from '../../stores/sessionStore';
import { nestedAutoValue, computeRowFromAutoChange } from '../../lib/autoValue';
import type { Column } from '../../types';
import { AnomalyAlertPopup } from './AnomalyAlertPopup';
import { CommandHelpPopup } from './CommandHelpPopup';
import { ManualValueSheet } from './ManualValueSheet';
import { PausedCard } from './PausedCard';
import { ModifyIndicatorPill } from './ModifyIndicatorPill';
import { type ReaskReason } from './ReaskCue';
import { type GlowTone } from './EdgeGlow';
import { VoiceHero, AlarmInterimStrip } from './VoiceHero';
import { LiveListenBand } from './LiveListenBand';
import { ColumnChip } from './ColumnChip';
import { useChipFlowFit } from './useChipFlowFit';
import { ActiveControlBar } from './ActiveControlBar';
import { ExitConfirmDialog } from './ExitConfirmDialog';

// ─── ACTIVE ───────────────────────────────────────────────────
export function ActiveState({
  totalRows, columns, voiceCols, currentColId, completing, paused, anomalyPending, tone, getAudioLevel,
  getTimeDomainData,
  reaskReason,
  onEnd, onRestartFromCol, onJumpToRow, onPrevRow, onNextRow, onTogglePause, onTouchCommit,
  onManualCommit, onManualOpen, onManualClose, onAnomalyConfirm, onAnomalyModify,
  onManualAnomalyConfirm, onManualAnomalyModify,
  onCommandHelpOpen, onCommandHelpClose,
  onExitConfirmOpen, onExitConfirmCancel,
}: {
  totalRows: number;
  columns: Column[];
  voiceCols: Column[];
  currentColId?: string;
  completing: boolean;
  paused: boolean;
  /** v0.34.0 B8 — 이상치 대기(파생 SSOT는 VoiceScreen — EdgeGlow 톤과 동일 신호). */
  anomalyPending: boolean;
  /** v0.36.0 코덱스 시안 — 상태 톤(VoiceScreen glowTone SSOT). 파형 밴드·중앙 버튼 채움색이
   *  엣지글로우와 같은 색으로 상태를 말한다(색 파생 중복 방지). */
  tone: GlowTone;
  /** v0.34.0 B7 — 파동 레벨 getter(useVoiceSession, 안정 참조). VoiceHero로 내려간다. */
  getAudioLevel: () => number;
  /** v0.35.0 — 시간영역 파형 getter(useVoiceSession). VoiceHero → VoiceWaveform으로 내려간다. */
  getTimeDomainData: (out: Uint8Array) => boolean;
  reaskReason: ReaskReason;
  onEnd: () => void;
  onRestartFromCol: (id: string) => void;
  onJumpToRow: (row: number) => void;
  onPrevRow: () => void;
  onNextRow: () => void;
  onTogglePause: () => void;
  onTouchCommit: (row: number, colId: string, value: string) => void;
  /** v0.33.0 항목6 — 수동 입력 시트 커밋(commitManualValue) + 열림/닫힘 STT suspend 배선. */
  onManualCommit: (row: number, colId: string, value: string) => void;
  onManualOpen: () => void;
  onManualClose: () => void;
  /** v0.33.0 항목7 — 이상치 응답 대기 팝업의 터치 버튼(음성 '확인'/'수정'과 동일 동작). */
  onAnomalyConfirm: () => void;
  onAnomalyModify: () => void;
  /** v0.34.0 A1 — 수동 입력 이상치 **보류**(manualHold) 팝업 전용 해제 콜백. [수정]의 시트 재오픈은
   *  시트 open 상태(manualCol)를 소유한 이 컴포넌트가 조립한다(팝업 렌더 분기에서 라우팅). */
  onManualAnomalyConfirm: () => void;
  onManualAnomalyModify: () => void;
  onCommandHelpOpen: () => void;
  onCommandHelpClose: () => void;
  /** v0.35.0 R2-FIX-2 — 종료 확인 다이얼로그 열림/취소 시 STT suspend·resume. 확인(종료) 경로는
   *  stop()이 인식기를 정지시키므로 resume하지 않는다. */
  onExitConfirmOpen: () => void;
  onExitConfirmCancel: () => void;
}) {
  // 리뷰 라운드1(Codex, 수용) — 전체 store 구독 금지: 종전 `useSessionStore()`는 interimValue가
  //   매 STT interim마다 바뀔 때 칩·컨트롤 전체를 리렌더시켰다. 필요한 필드만 useShallow로 구독해
  //   interim 갱신은 hero 내부 라인(자체 selector)만 리렌더되게 한다. allRowValues는 칩 값 갱신
  //   구독용(getRowValues가 파생하는 원본 상태).
  const sess = useSessionStore(
    useShallow((s) => ({
      activeRow: s.activeRow,
      allRowValues: s.allRowValues,
      anomalyAlert: s.anomalyAlert,
      modifyIndicator: s.modifyIndicator,
      getRowValues: s.getRowValues,
    })),
  );
  const row = sess.activeRow;
  const pct = totalRows > 0 ? (row / totalRows) * 100 : 0;
  const rowValues = sess.getRowValues(row);
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [cmdHelpOpen, setCmdHelpOpen] = useState(false);
  const cmdHelpSuspendedRef = useRef(false);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  // v0.35.0 R2-FIX-2(리뷰 라운드2) — 종료 확인 다이얼로그 = UI 모달이므로 열려 있는 동안 STT를
  //   정지한다(manual_input·command_help와 동일 계약). 완료 상태에선 '종료' 음성명령 대기로 인식기가
  //   살아 있어, 다이얼로그 중 배경 음성이 커밋/행이동으로 파싱되던 경로를 차단한다.
  //   취소 → resume. 확인 → resume 없음(stop()이 정지).
  const openExitConfirm = useCallback(() => {
    onExitConfirmOpen();
    setConfirmExitOpen(true);
  }, [onExitConfirmOpen]);
  const cancelExitConfirm = useCallback(() => {
    setConfirmExitOpen(false);
    onExitConfirmCancel();
  }, [onExitConfirmCancel]);
  // v0.33.0 항목6 — 수동 입력 시트(음성 칩 탭). 열림 중 STT hard-suspend(도움말 팝업과 동일
  // suspend/resume 검증 경로 재사용), 닫힘 시 resume. suspend ref 패턴은 cmdHelp와 동일.
  const [manualCol, setManualCol] = useState<Column | null>(null);
  const manualSuspendedRef = useRef(false);
  const openManualSheet = useCallback((c: Column) => {
    setEditingColId(null);
    if (!manualSuspendedRef.current) {
      manualSuspendedRef.current = true;
      onManualOpen();
    }
    setManualCol(c);
  }, [onManualOpen]);
  const closeManualSheet = useCallback(() => {
    setManualCol(null);
    if (manualSuspendedRef.current) {
      manualSuspendedRef.current = false;
      onManualClose();
    }
  }, [onManualClose]);

  // ── A-hero 파생 (v0.17.0 → v0.34.0 A4 단순화) — 전부 store 신호에서 읽기만 한다.
  //    실기기 피드백: '입력 완료'/'입력됨' 상태 표시는 혼란만 줬다(advance가 TTS 전에 store 포인터를
  //    옮기므로 커밋 즉시 다음 항목 '듣는 중'이 자동 성립). hero는 '듣는 중' 전용으로 두고, 유일한
  //    예외는 completing(phase 'complete' — 완료행 검토 대기/종료 대기/행 완료 안내)의 정적 라벨
  //    "N행 완료 — 명령 대기"다. 정정(correct)은 hero가 아니라 ModifyIndicatorPill이 담당(불변).
  const currentCol = voiceCols.find((c) => c.id === currentColId) || voiceCols[0];
  // v0.37.0 FB-E — 검토(complete) 표시가 보여줄 '방금 입력한 값'의 대상 컬럼 = 행의 마지막 음성
  //   컬럼(완료 행은 모든 음성 컬럼이 채워져 있어 그 값이 현재 행의 실제 데이터로 항상 유효하다).
  const reviewVoiceCol = voiceCols[voiceCols.length - 1];

  // 직전값 캡처 — store에 prevValue가 없으므로 view 레이어 ref로 정정 직전의 값을 기억한다.
  //   매 렌더에서 필드별 "마지막 비어있지 않은 값"을 추적해 둔다(재프롬프트가 셀을 ''로 비우기
  //   직전의 값을 잃지 않게 — 빈 값은 추적값을 덮어쓰지 않는다). 정정(modifyIndicator)이 대상 셀을
  //   가리키면 그 추적값이 곧 "직전값"이다. store는 건드리지 않는다.
  //   ModifyIndicatorPill의 직전값(취소선)→새값 표시에 쓴다.
  const lastNonEmptyRef = useRef<Record<string, string>>({});
  const lastRowRef = useRef(row);
  if (lastRowRef.current !== row) { lastNonEmptyRef.current = {}; lastRowRef.current = row; }
  const modCol = sess.modifyIndicator?.colId;
  const modCurrent = modCol ? (rowValues[modCol] ?? '') : '';
  // 정정 대상 셀은 새 값이 이미 채워졌을 수 있으므로, 추적값 갱신 '전에' 직전값을 읽는다.
  const modPrev = modCol ? lastNonEmptyRef.current[modCol] : undefined;
  // 추적값 갱신(비어있지 않은 값만). 정정 대상 셀은 새 값이 직전값이 되지 않도록 제외.
  for (const c of voiceCols) {
    const v = rowValues[c.id] ?? '';
    if (v && c.id !== modCol) lastNonEmptyRef.current[c.id] = v;
  }

  // v0.34.0 B8 — anomalyPending은 VoiceScreen에서 파생돼 prop으로 들어온다(EdgeGlow 톤과 SSOT).
  const chipAccent = anomalyPending ? T.red : T.green;
  const progressAccent = anomalyPending ? T.red : completing ? T.green : paused ? T.amber : T.blue;

  const openCommandHelp = useCallback(() => {
    if (!cmdHelpSuspendedRef.current) {
      cmdHelpSuspendedRef.current = true;
      onCommandHelpOpen();
    }
    setCmdHelpOpen(true);
  }, [onCommandHelpOpen]);

  const closeCommandHelp = useCallback(() => {
    setCmdHelpOpen(false);
    if (cmdHelpSuspendedRef.current) {
      cmdHelpSuspendedRef.current = false;
      onCommandHelpClose();
    }
  }, [onCommandHelpClose]);

  // ── v0.19.0 W5 — 칩 영역이 스크롤 밖으로 나가면 "지금 어디" 표시가 사라진다.
  //    활성 칩을 ref로 잡아 currentColId/row 변경 시 세로 플로우 안에서 가시영역으로 이동한다.
  const activeChipRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeChipRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [currentColId, row]);
  // v0.36.0 코덱스 시안 — 칩 플로우 글자 배율(--chip-fit): 칩 수·값 길이가 3줄을 넘기면 단계 축소.
  const chipFitRef = useChipFlowFit<HTMLDivElement>([columns, row, currentColId, JSON.stringify(rowValues)]);

  return (
    // ── v0.19.0 W5 → v0.36.0 코덱스 시안(2026-07-20) — 단일 CSS grid 루트, 4구역:
    //      1) auto          — 상단: 소형 행 스트립(행번호/진행/도움말) + 칩 플로우(전체 ≤30dvh 캡,
    //                         2줄 초과분은 내부 스크롤 — v0.37.0 FB-B 민구 확정 칩 스펙)
    //      2) minmax(0,1fr) — 중앙 흡수영역: hero/일시정지/이상치/수정 카드 중 정확히 하나
    //      3) auto          — 상시 파형 밴드(78~100px — 모든 상태 유지, paused=주황 평선)
    //      4) auto          — 하단 컨트롤바(이전/일시정지·재개/다음 + 접힘 스테퍼)
    //    한 구역의 높이 변화가 다른 구역을 밀지 않는다(컨트롤바 Y 인변량 — v0.19.0 버그B).
    //    fixed 오버레이(명령어 도움말/수동입력 시트/종료확인)는 grid track을 만들지 않는다.
    <div
      style={{
        flex: 1, minHeight: 0,
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr) auto auto',
      }}
      data-testid="voice-active-state"
    >
      {/* 1) 상단: 소형 행 스트립 + 칩 플로우. 시안(§3.1)엔 행 표시가 없으므로 눈에 안 걸리는 소형
          pill로 축소하되 data-testid="active-row" 노드 의미(행 번호)는 유지한다. */}
      <div style={{ paddingTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 16px 4px' }}>
          <div
            style={{
              display: 'inline-flex', alignItems: 'baseline', gap: 4,
              padding: '3px 12px', borderRadius: 999,
              background: T.cardAlt, border: `1px solid ${T.lineStrong}`,
              whiteSpace: 'nowrap',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            }}
          >
            <span data-testid="active-row" style={{ fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: -0.5, lineHeight: 1.2 }}>
              {row}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.textMute }}>/ {totalRows}행</span>
          </div>
          <div style={{ flex: 1, position: 'relative', height: 4, borderRadius: 2, background: T.line }}>
            <div
              style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2,
                width: `${pct}%`,
                background: progressAccent,
                transition: 'width 400ms ease-out, background 200ms',
              }}
            />
          </div>
          <button
            type="button"
            onClick={openCommandHelp}
            aria-label="음성 명령어 도움말"
            title="음성 명령어 도움말"
            style={{
              // 리뷰 라운드1(Codex, 수용) — 44px 최소 터치 타깃(PRINCIPLES §2 장갑 조작).
              width: 44, height: 44, borderRadius: '50%',
              border: `1px solid ${T.lineStrong}`,
              background: 'transparent',
              color: T.textMute,
              fontSize: 18, fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
            }}
          >
            ?
          </button>
        </div>
        {/* 칩 플로우 — 유동 폭 pill(내용 길이대로), 최대 **2줄** + 초과분 내부 스크롤(v0.37.0 FB-B
            민구 확정: 3줄→2줄로 축소해 hero가 자라날 세로 공간을 넓힌다). 활성 칩은 currentColId/row
            변경 시 자동 스크롤(activeChipRef.scrollIntoView)로 항상 가시영역에 둔다. 글자 배율은
            useChipFlowFit(--chip-fit). 알람 중에는 활성 칩/진행색을 RED로 맞춰 상태 신호를 동기화. */}
        <div
          data-testid="voice-chip-grid"
          ref={chipFitRef}
          style={{
            maxHeight: 'min(calc(30dvh - 50px), calc((44px * 2) + (8px * 1) + 12px))',
            overflowX: 'hidden',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            position: 'relative',
            padding: '6px 12px',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            alignItems: 'flex-start',
            alignContent: 'flex-start',
            gap: 8,
            borderBottom: `1px solid ${anomalyPending ? 'rgba(255,82,82,0.42)' : T.line}`,
            transition: 'border-color 180ms ease',
          }}
        >
        {columns.map((c) => {
          const isVoice = c.input === 'voice';
          const isTouch = c.input === 'touch';
          const value = isVoice || isTouch
            ? rowValues[c.id] ?? ''
            : nestedAutoValue(columns, c, row);
          const isActive = c.id === currentColId;
          const hasValue = rowValues[c.id] !== undefined && rowValues[c.id] !== '';
          const isDone = (isVoice || isTouch) && hasValue;
          const isEditingThis = editingColId === c.id;
          return (
            <ColumnChip
              key={c.id}
              containerRef={isActive ? activeChipRef : undefined}
              col={c}
              value={value}
              isActive={isActive}
              activeTone={chipAccent}
              isDone={isDone}
              isEditing={isEditingThis}
              onActivate={() => {
                if (c.type === 'date' && !isVoice) return;
                if (isVoice) {
                  // v0.33.0 항목6 — 음성 칩 탭 = 수동 입력 시트(기존 restartFromCol 즉시 재녹음은
                  // 시트의 "음성으로 다시 입력" 버튼으로 이전 — 경로 보존).
                  openManualSheet(c);
                } else {
                  // auto와 touch 모두 인라인 편집기로 진입
                  setEditingColId(c.id);
                }
              }}
              onCommit={(newValue) => {
                setEditingColId(null);
                if (isTouch) {
                  // 터치 컬럼: sessionStore + dataStore + IDB에 즉시 반영 → sync/CSV 누락 방지.
                  void onTouchCommit(row, c.id, newValue);
                } else if (!isVoice && newValue !== value) {
                  // auto 컬럼 변경 → 해당 값으로 행 점프
                  const targetRow = computeRowFromAutoChange(columns, c, newValue, row);
                  if (targetRow !== null) onJumpToRow(targetRow);
                }
              }}
              onCancel={() => setEditingColId(null)}
            />
          );
        })}
        </div>
      </div>

      {/* 2) 중앙 흡수영역(grid row2, minmax(0,1fr), overflow:hidden) — 상호배타 카드 하나를 중앙
          정렬. 각 카드는 ABSORB_CLAMP/useFitScale로 이 영역 높이에 맞춰 축소(무스크롤 fit 계약).
          트랙이 1fr 고정이라 어떤 카드가 떠도 아래 파형 밴드·컨트롤바 Y는 불변(v0.19.0 인변량).
          상호배타 우선순위: 일시정지 > 이상치 > 수정 > hero. 정확히 하나만 렌더한다.
          (상단 MicReconnectBanner·？명령어 CommandHelpPopup은 흡수 대상 아님 — 현행 fixed 유지.
          TTS 음성 안내는 그대로 — useVoiceSession의 say()/setLastTts 무수정.) */}
      <div
        style={{
          minHeight: 0, overflow: 'hidden', width: '100%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '8px 20px', gap: 10,
        }}
      >
        {paused ? (
          // 일시정지 카드(최우선) — '재시작'/'종료' 음성명령 안내.
          <PausedCard row={row} colName={currentCol?.name} />
        ) : sess.anomalyAlert && !manualCol ? (
          // 이상치/범위 알람 카드 — 직전값→현재값·변화량(긴 항목명/큰 음수소수 잘림 0).
          // v0.33.0 항목7 — 응답 대기(awaitingResponse) 팝업에 [확인][수정] 터치 버튼 배선.
          // v0.34.0 A1 — 수동 입력 보류(manualHold) 팝업은 전용 콜백으로 라우팅. [수정]은 해당 셀
          //   (colId)의 ManualValueSheet를 재오픈한다(시트 open 상태는 이 컴포넌트 소유).
          // v0.34.0 리뷰 라운드2(Codex Medium) — `!manualCol`: 수동입력 시트가 열려 있는 동안엔
          //   팝업을 렌더하지 않는다(시트가 화면을 덮으므로 중복 표시 방지). **보류 상태 자체는
          //   유지**되므로(useVoiceSession.modifyManualAnomaly가 더 이상 알람을 지우지 않음) 시트를
          //   취소하면 팝업이 그대로 다시 나타나고 STT 게이트도 살아 있다 — [수정] 후 취소로 미확인
          //   이상값이 확정된 것처럼 남던 누수의 차단축. 해소는 성공적인 재커밋(advance→announceField)
          //   또는 [확인]뿐.
          // v0.37.0 FB-F(민구) — 알람 카드 아래·파형 위에 미확정 인식값 스트립(정정 발화 확인).
          //   AlarmInterimStrip이 interimValue를 자체 구독(§10 실제 인식 원문만, lastTts 금지).
          <>
            <AnomalyAlertPopup
              a={sess.anomalyAlert}
              onConfirm={sess.anomalyAlert.manualHold ? onManualAnomalyConfirm : onAnomalyConfirm}
              onModify={
                sess.anomalyAlert.manualHold
                  ? () => {
                      const holdCol = columns.find((c) => c.id === sess.anomalyAlert?.colId);
                      onManualAnomalyModify(); // 팝업 해제(+로그) — colId 캡처 후 호출
                      if (holdCol) openManualSheet(holdCol);
                    }
                  : onAnomalyModify
              }
            />
            <AlarmInterimStrip />
          </>
        ) : sess.modifyIndicator ? (
          // 수정 재안내 카드 — 직전값(취소선)→새값.
          <ModifyIndicatorPill
            name={sess.modifyIndicator.name}
            prevValue={modPrev}
            newValue={modCurrent}
          />
        ) : currentCol ? (
          // v0.34.0 A4 — hero는 '듣는 중'(항목명) 전용. completing(phase 'complete')일 때만
          //   "N행 완료 — 명령 대기" 정적 라벨. 재질문 사유 큐(reaskReason)는 듣는 중에만 노출.
          <VoiceHero
            col={currentCol}
            review={completing}
            row={row}
            tone={tone}
            reaskReason={completing ? null : reaskReason}
            // v0.37.0 FB-E(민구) — 검토 표시의 '방금 입력한 값'. 행의 **마지막 음성 컬럼** 실제
            //   커밋값(rowValues)에서 파생 — valueBurst는 네비게이션으로 stale 가능하므로 쓰지 않는다.
            reviewName={reviewVoiceCol?.name}
            reviewValue={reviewVoiceCol ? (rowValues[reviewVoiceCol.id] ?? '') : ''}
          />
        ) : null}
      </div>

      {/* 3) 상시 파형 밴드(§6.2) — 입력 세션 동안 **모든 상태에서 유지**(민구 확정: 이상치 알람
          중에도 제거하지 않는다 — 375×667은 밴드 높이만 축소). 활성 기준은 실제 청취 상태(리뷰
          라운드1 Codex 수용): complete(검토 대기)에도 STT가 명령을 듣고 있으므로 파형은 살아
          움직인다. paused만 active=false → rAF 중지 + 주황 평선. 색은 tone(엣지글로우 SSOT) 동기화. */}
      <LiveListenBand
        active={!paused}
        tone={tone}
        getAudioLevel={getAudioLevel}
        getTimeDomainData={getTimeDomainData}
      />

      {/* 4) 하단 컨트롤바 — 표현 전용 ActiveControlBar(GL-006 §3·§5). 입력중에는 종료를 숨기고,
          일시정지/완료 상태에서만 종료를 노출한다(오조작 방지). */}
      <ActiveControlBar
        tone={tone}
        paused={paused}
        completing={completing}
        onPrevRow={onPrevRow}
        onNextRow={onNextRow}
        onTogglePause={onTogglePause}
        onExit={openExitConfirm}
      />

      {/* v0.23.0 입력탭#1 — 일시정지/이상치/수정 카드는 더 이상 여기(fixed 오버레이)에서 그리지
          않는다. 위 row3(1fr) 흡수영역으로 이전했다(잘림 방지). 여기 남는 fixed 오버레이는 흡수
          대상이 아닌 ？명령어 도움말(CommandHelpPopup)뿐 — 전체 명령어 모달이라 흡수영역 한 칸에
          넣지 않고 화면 전체 모달을 유지한다.
          v0.18.0 1c — CenterValueBurst('항목:값' 화면중앙 팝업)은 제거된 채 유지. v0.35.0(Vance)부터
          store valueBurst 소비자는 VoiceHero의 확인 플래시(✓+값, ~1.5s)로 부활 — 별도 오버레이는 없다. */}
      {cmdHelpOpen && <CommandHelpPopup onClose={closeCommandHelp} />}
      {/* v0.33.0 항목6 — 수동 입력 하단 시트(음성 칩 탭). 닫기(suspend 해제)를 먼저 하고 커밋/음성
          재입력을 실행한다 — resume이 컨트롤러를 복구한 뒤 echo/advance(또는 restartFromCol의
          announceField)가 이어지도록. */}
      {manualCol && (
        <ManualValueSheet
          col={manualCol}
          row={row}
          currentValue={rowValues[manualCol.id] ?? ''}
          onCommit={(v) => {
            const colId = manualCol.id;
            closeManualSheet();
            onManualCommit(row, colId, v);
          }}
          onVoiceRetry={() => {
            const colId = manualCol.id;
            closeManualSheet();
            onRestartFromCol(colId);
          }}
          onClose={closeManualSheet}
        />
      )}
      {confirmExitOpen && (
        <ExitConfirmDialog
          onCancel={cancelExitConfirm}
          onConfirm={() => {
            // 확인 경로는 resume하지 않는다 — onEnd()=stop()이 인식기를 정지시킨다(R2-FIX-2).
            setConfirmExitOpen(false);
            onEnd();
          }}
        />
      )}
    </div>
  );
}
