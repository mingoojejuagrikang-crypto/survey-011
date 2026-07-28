import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '../../stores/sessionStore';
import { T } from '../../tokens';
import { computeRowFromAutoChange } from '../../lib/autoValue';
import type { Column } from '../../types';
import { CommandHelpPopup } from './CommandHelpPopup';
import { ManualValueSheet } from './ManualValueSheet';
import { type ReaskReason } from './ReaskCue';
import { type GlowTone } from './EdgeGlow';
import { useReviewCommit } from './VoiceHero';
import { ActiveHeaderStrip } from './ActiveHeaderStrip';
import { ChipZone } from './ChipZone';
import { CenterStage } from './CenterStage';
import { ActiveControlBar, type EdgeMode } from './ActiveControlBar';
import { ACTIVE_ZONE_ROWS } from './heroLayout';
import type { DotGlyph } from './StateDots';
import { ExitConfirmDialog } from './ExitConfirmDialog';
import type { VoiceUiCommandSignal } from '../../lib/voiceCommands';

/** 우측 끝 정렬 시 칩과 트랙 오른쪽 가장자리 사이 여백(px). 칩이 가장자리에 딱 붙으면
 *  "더 있다"는 신호가 사라져 잘린 것처럼 보인다. */
const CHIP_SCROLL_PAD = 8;

/** 입력화면 조립 루트 — 와이어프레임 4상태(active·anomaly·paused·complete)를 **하나의 트리**에서
 *  표시만 바꿔 그린다(SSOT: `Deliverables/2026-07-24-survey-011-active-screen-wireframe.md`).
 *
 *  🔴 상태 전환은 **표시 전환**이지 트리 교체가 아니다. 세션 트리를 조건부로 갈아치우면 인식기·
 *  워치독·클립 레코더가 통째로 teardown된다([STT-16] 실기기 62초 사공백, [IOS-7]의 PortraitGuard가
 *  오버레이인 이유도 같다).
 *
 *  구역(§공통규칙1): 상단 스트립(auto) + **칩존 25% / 중앙 50% / 하단 25%**. 비율의 분모는
 *  `ACTIVE_ZONE_ROWS` 주석 참조. */
export function ActiveState({
  totalRows, columns, voiceCols, currentColId, completing, endReached, paused, anomalyPending, tone,
  getAudioLevel, getTimeDomainData,
  reaskReason, uiCommand,
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
  /** phase 'complete' — 완료 행 검토 대기 **또는** 끝 도달. 둘의 화면 차이는 endReached가 가른다. */
  completing: boolean;
  /** 와이어프레임 §[4] — 조사 전체 완료(끝 도달). 검토 대기와 구분된다. */
  endReached: boolean;
  paused: boolean;
  /** v0.34.0 B8 — 이상치 대기(파생 SSOT는 VoiceScreen — EdgeGlow 톤과 동일 신호). */
  anomalyPending: boolean;
  /** 상태 톤(VoiceScreen glowTone SSOT) — 칩·도트·파형·엣지글로우가 같은 색으로 상태를 말한다. */
  tone: GlowTone;
  /** v0.34.0 B7 — 파동 레벨 getter(useVoiceSession, 안정 참조). */
  getAudioLevel: () => number;
  /** v0.35.0 — 시간영역 파형 getter(useVoiceSession). */
  getTimeDomainData: (out: Uint8Array) => boolean;
  reaskReason: ReaskReason;
  /** v0.38.0 #4-③ — useVoiceSession이 최종 판정한 UI 버튼 음성 명령(단조 seq). */
  uiCommand: VoiceUiCommandSignal | null;
  onEnd: () => void;
  onRestartFromCol: (id: string) => void;
  onJumpToRow: (row: number) => void;
  onPrevRow: () => void;
  onNextRow: () => void;
  onTogglePause: () => void;
  onTouchCommit: (row: number, colId: string, value: string) => void;
  /** v0.33.0 항목6 — 수동 입력 시트 커밋 + 열림/닫힘 STT suspend 배선. */
  onManualCommit: (row: number, colId: string, value: string) => void;
  onManualOpen: () => void;
  onManualClose: () => void;
  /** v0.33.0 항목7 — 이상치 응답 대기의 터치 경로(음성 '확인'/'수정'과 동일 동작). */
  onAnomalyConfirm: () => void;
  onAnomalyModify: () => void;
  /** v0.34.0 A1 — 수동 입력 이상치 **보류**(manualHold) 전용 해제 콜백. */
  onManualAnomalyConfirm: () => void;
  onManualAnomalyModify: () => void;
  onCommandHelpOpen: () => void;
  onCommandHelpClose: () => void;
  /** v0.35.0 R2-FIX-2 — 종료 확인 다이얼로그 열림/취소 시 STT suspend·resume. */
  onExitConfirmOpen: () => void;
  onExitConfirmCancel: () => void;
}) {
  // 전체 store 구독 금지 — interimValue가 매 STT interim마다 바뀌면 칩·컨트롤 전체가 리렌더된다.
  const sess = useSessionStore(
    useShallow((s) => ({
      activeRow: s.activeRow,
      allRowValues: s.allRowValues,
      anomalyAlert: s.anomalyAlert,
      modifyIndicator: s.modifyIndicator,
      completedRows: s.completedRows,
      getRowValues: s.getRowValues,
    })),
  );
  const row = sess.activeRow;
  // v0.37.0 리뷰 #1(민구: 커밋 영수증) — 검토 표시값 파생을 **여기(항상 마운트)** 에서 한다.
  const reviewCommit = useReviewCommit(completing, row);
  const pct = totalRows > 0 ? (row / totalRows) * 100 : 0;
  const rowValues = sess.getRowValues(row);
  const activeChipValue = currentColId ? rowValues[currentColId] : undefined;
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [cmdHelpOpen, setCmdHelpOpen] = useState(false);
  const cmdHelpSuspendedRef = useRef(false);
  const [confirmExitOpen, setConfirmExitOpen] = useState(false);
  // v0.35.0 R2-FIX-2 — 종료 확인 다이얼로그가 열려 있는 동안 STT 정지(취소 → resume, 확인 → stop()).
  const openExitConfirm = useCallback(() => {
    onExitConfirmOpen();
    setConfirmExitOpen(true);
  }, [onExitConfirmOpen]);
  const cancelExitConfirm = useCallback(() => {
    setConfirmExitOpen(false);
    onExitConfirmCancel();
  }, [onExitConfirmCancel]);
  // v0.33.0 항목6 — 수동 입력 시트(음성 칩 탭). 열림 중 STT hard-suspend, 닫힘 시 resume.
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

  const currentCol = voiceCols.find((c) => c.id === currentColId) || voiceCols[0];

  // 직전값 캡처 — store에 prevValue가 없으므로 view 레이어 ref로 정정 직전의 값을 기억한다.
  //   빈 값은 추적값을 덮어쓰지 않는다(재프롬프트가 셀을 ''로 비우기 직전의 값을 잃지 않게).
  const lastNonEmptyRef = useRef<Record<string, string>>({});
  const lastRowRef = useRef(row);
  if (lastRowRef.current !== row) { lastNonEmptyRef.current = {}; lastRowRef.current = row; }
  const modCol = sess.modifyIndicator?.colId;
  const modCurrent = modCol ? (rowValues[modCol] ?? '') : '';
  const modPrev = modCol ? lastNonEmptyRef.current[modCol] : undefined;
  for (const c of voiceCols) {
    const v = rowValues[c.id] ?? '';
    if (v && c.id !== modCol) lastNonEmptyRef.current[c.id] = v;
  }

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

  const handledUiCommandSeqRef = useRef(0);
  useEffect(() => {
    if (!uiCommand || uiCommand.seq <= handledUiCommandSeqRef.current) return;
    handledUiCommandSeqRef.current = uiCommand.seq;
    if (uiCommand.id === 'help') openCommandHelp();
  }, [uiCommand, openCommandHelp]);

  // v0.37.0 리뷰#2 — 탭 전환 직전 overlayCloseSeq 증가 → 열린 시트/도움말을 닫아 STT를 재개한다.
  const overlayCloseSeq = useSessionStore((s) => s.overlayCloseSeq);
  const closeOverlaysRef = useRef<() => void>(() => {});
  closeOverlaysRef.current = () => { closeManualSheet(); closeCommandHelp(); };
  const seenOverlayCloseRef = useRef(overlayCloseSeq);
  useEffect(() => {
    if (overlayCloseSeq === seenOverlayCloseRef.current) return; // 마운트 초기값 — no-op
    seenOverlayCloseRef.current = overlayCloseSeq;
    closeOverlaysRef.current();
  }, [overlayCloseSeq]);

  // 칩존 자동 스크롤 — **진행중 칩을 보이는 영역의 우측 끝에** 둔다(민구 확정 2026-07-27).
  //
  // 🔴 왜 "다음 항목 보기"가 아니라 우측 끝인가 — 되돌리기 전에 반드시 읽어라.
  //    민구 근거: "한국인들은 글을 읽을때 좌>우로 읽어. 그러니 진행칩의 하이라이트도 좌>우로 이동해야 해."
  //    이 앱에서 특히 맞는 이유: 칩이 **'항목명 + 값'을 함께** 보여주므로 진행중 칩 왼쪽에 남는 것이
  //    **이미 입력을 마친 칩들(값이 찍혀 있다) = 입력 확인 영역**이 된다. 반대로 오른쪽(다음 항목)은
  //    값이 아직 `—`라 미리 볼 실익이 적다.
  //    ⚠️ 일반적 직관은 "다음을 보여준다"라서 이 동작이 버그로 오인되기 쉽다. 실제로 설계 검토에서
  //       제시된 세 후보(왼쪽 끝/가운데/다음 최대)가 **전부** 다음 보기 우선이었고 민구가 전부 물렸다.
  //       "다음 항목이 안 보인다"는 제보가 오면 결함이 아니라 이 결정이다.
  //
  // 규칙 두 줄:
  //   · 넘침 **전**(칩이 트랙 폭에 다 들어갈 때): 스크롤 없음. 칩이 왼쪽부터 채워지고
  //     하이라이트가 자연히 좌→우로 이동한다. (아래 clamp의 하한 0이 이걸 자동으로 만든다.)
  //   · 넘침 **후**: 진행중 칩의 오른쪽 끝을 가시영역 오른쪽 끝에 맞춘다.
  //
  // ⚠️ `scrollIntoView`를 쓰지 않는다 — 'nearest'는 "보이면 안 움직인다"라 우측 끝 정렬이 안 되고,
  //    'end'는 스크롤 조상을 함께 움직여 하단 트랙까지 밀 수 있다. 칩존만 직접 민다.
  const activeChipRef = useRef<HTMLDivElement | null>(null);
  const chipGridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const alignActiveChip = () => {
      const grid = chipGridRef.current;
      const chip = activeChipRef.current;
      if (!grid || !chip) return;
      // offsetLeft는 offsetParent 기준이라 스크롤 컨테이너와 어긋난다 → 화면 좌표 차이로 잰다.
      const delta = chip.getBoundingClientRect().left - grid.getBoundingClientRect().left;
      const target = grid.scrollLeft + delta - (grid.clientWidth - chip.offsetWidth) + CHIP_SCROLL_PAD;
      grid.scrollLeft = Math.max(0, Math.min(grid.scrollWidth - grid.clientWidth, target));
    };
    alignActiveChip();
    // C4 — 회전·뷰포트 변화도 같은 산술을 다시 적용한다. 칩/컨테이너를 관측하는 ResizeObserver가
    // 아니라 window 이벤트만 읽으므로 useFitScale에서 경계한 자기관측 루프가 생기지 않는다.
    window.addEventListener('resize', alignActiveChip);
    return () => window.removeEventListener('resize', alignActiveChip);
  }, [currentColId, row, activeChipValue]);

  // ── 상태 파생(단일 지점) ────────────────────────────────────────────────────
  // 수동 입력 시트가 화면을 덮는 동안엔 알람 표시를 접는다(중복 표시 방지). **보류 상태 자체는
  //   유지**되므로 시트를 취소하면 알람이 그대로 다시 나타난다(v0.34.0 라운드2).
  const alertVisible = sess.anomalyAlert && !manualCol ? sess.anomalyAlert : null;
  // 와이어프레임 §[2] — 하단 `<` `>`가 확인/수정으로 바뀌는 건 **응답 대기 알람 동안만**이다.
  //   정보성 알람(수동 커밋 이상치, awaitingResponse 미지정)은 이전/다음을 유지한다.
  const anomalyActionable = !!alertVisible && alertVisible.status !== 'corrected' && !!alertVisible.awaitingResponse;
  const edgeMode: EdgeMode = paused ? 'paused' : anomalyActionable ? 'anomaly' : 'nav';
  const glyph: DotGlyph = paused ? 'pause' : anomalyPending ? 'alert' : endReached ? 'check' : 'mic';

  const handleAnomalyConfirm = useCallback(() => {
    if (useSessionStore.getState().anomalyAlert?.manualHold) onManualAnomalyConfirm();
    else onAnomalyConfirm();
  }, [onAnomalyConfirm, onManualAnomalyConfirm]);

  const handleAnomalyModify = useCallback(() => {
    const alert = useSessionStore.getState().anomalyAlert;
    if (!alert?.manualHold) { onAnomalyModify(); return; }
    // manualHold의 [수정]은 해당 셀의 ManualValueSheet를 재오픈한다(시트 open 상태는 여기 소유).
    const holdCol = columns.find((c) => c.id === alert.colId);
    onManualAnomalyModify(); // 팝업 해제(+로그) — colId 캡처 후 호출
    if (holdCol) openManualSheet(holdCol);
  }, [columns, onAnomalyModify, onManualAnomalyModify, openManualSheet]);

  return (
    <div
      style={{
        flex: 1, minHeight: 0,
        display: 'grid',
        // 와이어프레임 §공통규칙1 — auto(상단 스트립) + 칩존 25% / 중앙 50% / 하단 25%.
        gridTemplateRows: ACTIVE_ZONE_ROWS,
      }}
      data-testid="voice-active-state"
    >
      <ActiveHeaderStrip
        row={row}
        totalRows={totalRows}
        progressPct={pct}
        progressAccent={progressAccent}
        paused={paused}
        endReached={endReached}
        onOpenHelp={openCommandHelp}
      />

      <ChipZone
        columns={columns}
        rowValues={rowValues}
        row={row}
        // 와이어프레임 §[4] — "마지막 행 확정, **활성 강조 없음**". 조사가 끝나면 가리킬 다음 칸이
        //   없으므로 하이라이트·점멸을 거둔다(끝났는데 무언가를 기다리는 것처럼 보이지 않게).
        currentColId={endReached ? undefined : currentColId}
        activeTone={chipAccent}
        anomalyPending={anomalyPending}
        editingColId={editingColId}
        activeChipRef={activeChipRef}
        gridRef={chipGridRef}
        onActivate={(c) => {
          if (c.type === 'date' && c.input !== 'voice') return;
          if (c.input === 'voice') openManualSheet(c);
          else setEditingColId(c.id);
        }}
        onCommit={(c, newValue, prevValue) => {
          setEditingColId(null);
          if (c.input === 'touch') {
            // 터치 컬럼: sessionStore + dataStore + IDB에 즉시 반영 → sync/CSV 누락 방지.
            void onTouchCommit(row, c.id, newValue);
          } else if (c.input !== 'voice' && newValue !== prevValue) {
            // auto 컬럼 변경 → 해당 값으로 행 점프
            const targetRow = computeRowFromAutoChange(columns, c, newValue, row);
            if (targetRow !== null) onJumpToRow(targetRow);
          }
        }}
        onCancel={() => setEditingColId(null)}
      />

      <CenterStage
        paused={paused}
        anomalyAlert={alertVisible}
        endReached={endReached}
        modifyIndicator={sess.modifyIndicator}
        currentCol={currentCol}
        completedCount={sess.completedRows.length}
        totalRows={totalRows}
        row={row}
        tone={tone}
        reaskReason={reaskReason}
        completing={completing}
        reviewCommit={reviewCommit}
        modifyPrevValue={modPrev}
        modifyCurrentValue={modCurrent}
        onExit={openExitConfirm}
      />

      <ActiveControlBar
        tone={tone}
        mode={edgeMode}
        glyph={glyph}
        // §[3]·§[4]에서는 인디케이터가 버튼이 아니다 — 일시정지는 `<`(재개), 완료는 중앙 `종료`가
        // 그 상태의 행동을 이미 갖는다(같은 행동의 중복 타깃·중복 셀렉터를 만들지 않는다).
        indicatorInteractive={!endReached && !paused}
        showPauseHint={completing && !endReached && !paused && edgeMode === 'nav'}
        waveActive={!paused}
        getAudioLevel={getAudioLevel}
        getTimeDomainData={getTimeDomainData}
        uiCommand={uiCommand}
        onPrevRow={onPrevRow}
        onNextRow={onNextRow}
        onTogglePause={onTogglePause}
        onExit={openExitConfirm}
        onAnomalyConfirm={handleAnomalyConfirm}
        onAnomalyModify={handleAnomalyModify}
      />

      {/* fixed 오버레이(도움말/수동입력 시트/종료확인)는 grid track을 만들지 않는다. */}
      {cmdHelpOpen && <CommandHelpPopup onClose={closeCommandHelp} />}
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
