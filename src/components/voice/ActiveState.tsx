import { useCallback, useEffect, useRef, useState } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import { useSessionStore } from '../../stores/sessionStore';
import { nestedAutoValue, computeRowFromAutoChange } from '../../lib/autoValue';
import type { Column } from '../../types';
import { AnomalyAlertPopup } from './AnomalyAlertPopup';
import { CommandHelpPopup } from './CommandHelpPopup';
import { ManualValueSheet } from './ManualValueSheet';
import { PausedCard } from './PausedCard';
import { ModifyIndicatorPill } from './ModifyIndicatorPill';
import { type ReaskReason } from './ReaskCue';
import { VoiceHero } from './VoiceHero';
import { VoiceActionButton } from './VoiceActionButton';
import { ColumnChip } from './ColumnChip';
import { ActiveControlSteppers } from './ActiveControlSteppers';
import { ExitConfirmDialog } from './ExitConfirmDialog';

// ─── ACTIVE ───────────────────────────────────────────────────
export function ActiveState({
  totalRows, columns, voiceCols, currentColId, completing, paused, anomalyPending, getAudioLevel,
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
  const sess = useSessionStore();
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
  //    활성 칩을 ref로 잡아 currentColId/row 변경 시 세로 그리드 안에서 가시영역으로 이동한다.
  const activeChipRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeChipRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [currentColId, row]);

  return (
    // ── v0.19.0 W5 — ActiveState를 단일 CSS grid 루트로 재설계. 4개 독립 구역을 gridTemplateRows로
    //    고정해 한 구역의 높이 변화가 다른 구역을 밀지 않게 한다:
    //      1) auto  — 상단 상태바(행번호/진행/신뢰도)
    //      2) <캡>  — 칩 스크롤영역(내부 overflowY:auto, 약 3줄 높이 고정 → 칩 무제한 성장[버그A] 차단)
    //      3) 1fr   — 중앙 흡수영역: VoiceHero + TTS 에코까지 모든 가변/조건부 내용을 여기에 모은다.
    //                  hero가 팝업 표시로 숨겨져도 이 구역만 리플로우 → 아래 컨트롤바는 안 밀림(버그B)
    //      4) auto  — 하단 컨트롤바: 이전/다음·마이크·종료·도움말·속도(한자리 고정)
    //    fixed 오버레이(이상치/수정/일시정지/명령어)는 grid track을 만들지 않으므로 자식으로 둬도 무영향.
    <div
      style={{
        flex: 1, minHeight: 0,
        display: 'grid',
        gridTemplateRows: 'auto auto 1fr auto',
      }}
      data-testid="voice-active-state"
    >
      {/* 1) Top: row indicator + progress */}
      <div style={{ padding: '10px 18px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div
            style={{
              display: 'flex', alignItems: 'baseline', gap: 6,
              whiteSpace: 'nowrap',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            }}
          >
            <span data-testid="active-row" style={{ fontSize: 60, fontWeight: 800, color: T.text, letterSpacing: -3, lineHeight: 1 }}>
              {row}
            </span>
            <span style={{ fontSize: 22, fontWeight: 700, color: T.textMute, letterSpacing: -0.5 }}>
              / {totalRows}
            </span>
            <span style={{ fontSize: 14, color: T.textDim, marginLeft: 6 }}>행</span>
          </div>
          <button
            type="button"
            onClick={openCommandHelp}
            aria-label="음성 명령어 도움말"
            title="음성 명령어 도움말"
            style={{
              width: 44, height: 44, borderRadius: '50%',
              border: `1px solid ${T.lineStrong}`,
              background: T.card,
              color: T.textDim,
              fontSize: 22, fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            ?
          </button>
        </div>
        <div
          style={{
            marginTop: 6, position: 'relative', height: 5, borderRadius: 3,
            background: T.line,
          }}
        >
          <div
            style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2,
              width: `${pct}%`,
              background: progressAccent,
              transition: 'width 400ms ease-out, background 200ms',
              boxShadow: anomalyPending
                ? '0 0 12px rgba(255,82,82,0.5)'
                : completing
                ? `0 0 12px ${T.green}`
                : paused
                ? '0 0 8px rgba(255,179,0,0.4)'
                : `0 0 8px ${T.blueGlow}`,
            }}
          />
        </div>
      </div>

      {/* 2) Chip grid — 항상 세로 3행 캡. 알람 중에는 활성 칩/진행색을 RED로 맞춰 상태 신호를 동기화한다. */}
      <div
        data-testid="voice-chip-grid"
        style={{
          maxHeight: 'calc((44px * 3) + (8px * 2) + 20px)',
          overflowX: 'hidden',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '10px 12px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gridAutoRows: 'minmax(44px, auto)',
          gap: 8,
          borderTop: `1px solid ${T.line}`,
          borderBottom: `1px solid ${anomalyPending ? 'rgba(255,82,82,0.42)' : T.line}`,
          alignContent: 'flex-start',
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

      {/* 3) 1fr 흡수영역 — v0.23.0 입력탭#1(중앙 흡수, Vance): 기존엔 일시정지·이상치·수정 카드가
          전부 position:fixed; inset:0 오버레이로 떠 실기기(특히 375px)에서 잘렸다(핸드오프 최우선).
          이 세 카드를 **이 흡수영역(grid row3, 1fr, overflow:hidden)** 안으로 옮겨, 가용공간에 맞춰
          크게·잘림없이 렌더한다. 트랙이 1fr 고정이라 어떤 카드가 떠도 아래 컨트롤바 Y는 불변(v0.19.0
          W5 인변량 보존 — 버그B). 각 카드는 ABSORB_CLAMP(maxHeight:100%+minHeight:0+overflowY:auto)로
          짧은 기기/긴 음수소수(-355.5)에서도 부모 overflow:hidden에 잘리지 않고 내부 스크롤.
          상호배타 우선순위: 일시정지 > 이상치 > 수정 > hero(현재값). 정확히 하나만 렌더한다.
          (상단 MicReconnectBanner·？명령어 CommandHelpPopup은 흡수 대상 아님 — 현행 fixed 유지.)
          TTS 음성 안내는 그대로 유지(useVoiceSession의 say()/setLastTts 무수정). */}
      <div
        style={{
          minHeight: 0, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '12px 20px', gap: 12,
          // v0.34.0 A5 — 시각 영수증(v0.33.0 항목8)은 실기기 피드백으로 제거. 이 wrapper는
          // 흡수영역 자식들의 포지셔닝 컨텍스트로 계속 쓰이므로 position:relative는 보존한다.
          position: 'relative',
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
            reaskReason={completing ? null : reaskReason}
            getAudioLevel={getAudioLevel}
            getTimeDomainData={getTimeDomainData}
          />
        ) : null}
        {/* v0.34.0 A5 — 시각 영수증(commit-receipt, v0.33.0 항목8) 삭제(실기기 피드백: 불필요 중복).
            커밋 확인 경로는 칩 값 갱신 + echo TTS로 일원화. */}
      </div>

      {/* 4) 하단 컨트롤바 — 행동만 노출. 입력중에는 종료를 숨기고, 일시정지 후 확인을 거쳐 종료한다.
          v0.35.0 FB-G(Vance) — 완료(completing)면 '일시정지'가 무의미하므로 중앙 버튼을 종료로.
          기존 ExitConfirmDialog/onEnd를 그대로 재사용(최소 변경). 마지막 행 완료 안내와 짝을 맞춘다. */}
      <div
        style={{
          borderTop: `1px solid ${T.line}`,
          background: 'rgba(255,255,255,0.015)',
          display: 'flex', flexDirection: 'column', gap: 10,
          padding: '10px 16px 8px',
        }}
      >
        {paused ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(96px, 0.42fr)', gap: 18 }}>
            <VoiceActionButton
              label="재시작"
              title="재시작"
              icon={I.play(24, '#fff')}
              tone="primary"
              onClick={onTogglePause}
            />
            <VoiceActionButton
              label="종료"
              title="입력 종료"
              icon={I.stop(20, T.red)}
              tone="danger"
              onClick={openExitConfirm}
            />
          </div>
        ) : completing ? (
          // 완료 상태: 이전/다음은 유지하되 중앙을 '종료'로(일시정지 대체).
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(78px, 0.62fr) minmax(124px, 1fr) minmax(78px, 0.62fr)', gap: 12 }}>
            <VoiceActionButton label="이전" title="이전 행으로 이동" tone="secondary" onClick={onPrevRow} />
            <VoiceActionButton
              label="종료"
              title="입력 종료"
              icon={I.stop(20, T.red)}
              tone="danger"
              onClick={openExitConfirm}
            />
            <VoiceActionButton label="다음" title="다음 행으로 이동" tone="secondary" onClick={onNextRow} />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(78px, 0.62fr) minmax(124px, 1fr) minmax(78px, 0.62fr)', gap: 12 }}>
            <VoiceActionButton label="이전" title="이전 행으로 이동" tone="secondary" onClick={onPrevRow} />
            <VoiceActionButton
              label="일시정지"
              title="일시정지"
              icon={I.pause(22, '#fff')}
              tone="primary"
              onClick={onTogglePause}
            />
            <VoiceActionButton label="다음" title="다음 행으로 이동" tone="secondary" onClick={onNextRow} />
          </div>
        )}

        <ActiveControlSteppers />
      </div>

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
