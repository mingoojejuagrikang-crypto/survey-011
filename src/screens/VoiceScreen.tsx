import { useEffect, useMemo, useRef, useState } from 'react';
import { T, TYPE_LABELS, TYPE_COLORS } from '../tokens';
import { I } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { computeTotalRows, nestedAutoValue, computeRowFromAutoChange } from '../lib/autoValue';
import { useWakeLock, lockPortrait } from '../lib/wakeLock';
import { useVoiceSession } from '../lib/useVoiceSession';
import { isSpeechSupported, speak } from '../lib/speech';
import { PRIMARY_COMMANDS } from '../lib/voiceCommands';
import { classifyInputDevice } from '../lib/inputDevice';
import { AnomalyAlertPopup } from '../components/voice/AnomalyAlertPopup';
import { CenterValueBurst } from '../components/voice/CenterValueBurst';
import { CommandHelpPopup } from '../components/voice/CommandHelpPopup';
import type { Column } from '../types';

export function VoiceScreen() {
  const s = useSettingsStore();
  const sess = useSessionStore();
  const voiceSession = useVoiceSession();
  const [confidence, setConfidence] = useState<number | null>(null);
  // v0.12.0 AREA1 — 읽기전용 입력장치 CATEGORY 배지용 라벨. getActiveInputLabel은 init() 비동기
  // resolve 후 채워지므로 confidence와 동일하게 폴링으로 동기화한다(안정 콜백 참조).
  const [inputLabel, setInputLabel] = useState<string | null>(null);

  useWakeLock(sess.phase === 'active' || sess.phase === 'complete' || sess.phase === 'paused');

  // Sync confidence display + active input label from voice session refs
  useEffect(() => {
    if (sess.phase !== 'active') return;
    const interval = setInterval(() => {
      setConfidence(voiceSession.lastConfidenceRef.current);
      setInputLabel(voiceSession.getActiveInputLabel());
    }, 300);
    return () => clearInterval(interval);
  }, [sess.phase, voiceSession.lastConfidenceRef, voiceSession.getActiveInputLabel]);

  const totalRows = s.tableGenerated ? computeTotalRows(s.columns) : 0;
  const voiceCols = s.columns.filter((c) => c.input === 'voice');
  const currentCol = voiceCols[sess.activeColIdx] || voiceCols[0] || s.columns[0];

  if (sess.phase === 'ready') {
    return (
      <ReadyState
        totalRows={totalRows}
        onStart={async () => {
          await voiceSession.start(s.sessionAutoLabel || buildAutoLabel(s.columns));
          await lockPortrait();
        }}
      />
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        animation: sess.phase === 'complete' ? 'flash-green 600ms ease-out' : 'none',
      }}
    >
      <ActiveState
        totalRows={totalRows}
        columns={s.columns}
        voiceCols={voiceCols}
        currentColId={currentCol?.id}
        completing={sess.phase === 'complete'}
        paused={sess.phase === 'paused'}
        confidence={confidence}
        inputLabel={inputLabel}
        onEnd={() => voiceSession.stop()}
        onRestartFromCol={(id) => voiceSession.restartFromCol(id)}
        onJumpToRow={(r) => voiceSession.jumpToRow(r)}
        onPrevRow={() => voiceSession.gotoAdjacentRow(-1)}
        onNextRow={() => voiceSession.goNextRow()}
        onTouchCommit={(r, colId, v) => voiceSession.commitTouchValue(r, colId, v)}
        onTogglePause={() => {
          if (sess.phase === 'paused') voiceSession.resume();
          else voiceSession.pause();
        }}
      />
    </div>
  );
}

/** Compose a default session label like "2026-06-08 이원창" (날짜 + 이름).
 *  설정탭(SettingsScreen)의 sessionAutoLabel 형식과 일치시킨다.
 *  v0.4.3: '이름' 데이터형 대신 "농가명/이름" 문자열로 이름 컬럼을 식별(기준일자 같은 date 컬럼 오선택 방지). */
function buildAutoLabel(columns: Column[]): string {
  const isoDate = new Date().toISOString().slice(0, 10);
  const nameCol = columns.find(
    (c) => (c.name?.trim() === '농가명' || c.name?.trim() === '이름') && c.auto.kind === 'fixed' && !!c.auto.value,
  );
  if (nameCol && nameCol.auto.kind === 'fixed') return `${isoDate} ${nameCol.auto.value}`;
  for (const c of columns) {
    if (c.input !== 'auto' || c.type === 'date') continue;
    if (c.auto.kind === 'fixed' && c.auto.value && c.auto.value !== '오늘') {
      return `${isoDate} ${c.auto.value}`;
    }
    if (c.auto.kind === 'options' && c.auto.selected.length === 1) {
      return `${isoDate} ${c.auto.selected[0]}`;
    }
  }
  return isoDate;
}

// ─── READY ────────────────────────────────────────────────────
function ReadyState({ totalRows, onStart }: { totalRows: number; onStart: () => void }) {
  const s = useSettingsStore();
  const ready = s.tableGenerated && totalRows > 0 && isSpeechSupported();
  const autoCount = s.columns.filter((c) => c.input === 'auto').length;
  const voiceCount = s.columns.filter((c) => c.input === 'voice').length;
  const ttsHint = !isSpeechSupported()
    ? '이 브라우저는 음성 인식을 지원하지 않습니다 (Chrome 권장)'
    : !s.tableGenerated
    ? '먼저 설정 탭에서 테이블을 생성하세요'
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ScreenHeader title="음성 입력" sub={ttsHint || undefined} />
      <div
        style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '0 24px', gap: 28,
        }}
      >
        <div style={{ position: 'relative' }}>
          <div
            style={{
              width: 168, height: 168, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.06), rgba(255,255,255,0.02) 70%, transparent)',
              border: `1px solid ${T.line}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {I.micFilled(76, '#3A3E45')}
          </div>
          {[0, 1].map((i) => (
            <div
              key={i}
              style={{
                position: 'absolute', inset: -16 - i * 12, borderRadius: '50%',
                border: `1px solid rgba(255,255,255,${0.05 - i * 0.02})`,
              }}
            />
          ))}
        </div>

        <div
          style={{
            background: T.card, border: `1px solid ${T.line}`, borderRadius: 14,
            padding: '16px 20px',
            display: 'flex', flexDirection: 'column', gap: 12,
            width: '100%', maxWidth: 320,
          }}
        >
          <SummaryRow label="오늘 테이블" value={totalRows} unit="행" />
          <SummaryRow label="자동입력 항목" value={autoCount} unit="개" />
          <SummaryRow label="음성입력 항목" value={voiceCount} unit="개" accent />
        </div>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <button
          disabled={!ready}
          onClick={onStart}
          style={{
            width: '100%', height: 60, borderRadius: 28, border: 'none',
            background: ready ? T.blue : '#2A2D32',
            color: ready ? '#fff' : T.textMute,
            fontSize: 17, fontWeight: 800, letterSpacing: -0.3,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            cursor: ready ? 'pointer' : 'not-allowed',
            boxShadow: ready ? `0 8px 28px ${T.blueGlow}` : 'none',
          }}
        >
          {I.mic(22, ready ? '#fff' : T.textMute)} 음성 입력 시작
        </button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, unit, accent }: { label: string; value: number; unit?: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 15, color: T.textDim, fontWeight: 600, letterSpacing: -0.1 }}>{label}</span>
      <span
        style={{
          fontSize: 24, fontWeight: 800,
          color: accent ? T.blue : T.text,
          letterSpacing: -0.6,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        }}
      >
        {value}
        {unit && <span style={{ fontSize: 13, color: T.textDim, fontWeight: 500, marginLeft: 4 }}>{unit}</span>}
      </span>
    </div>
  );
}

// ─── A-hero helpers (v0.17.0) ─────────────────────────────────
/** README 타이포 스케일(A): 값 길이로 hero 숫자 크기 자동 조절. ≤4자 150 / ≤6자 104 / 그 외 50.
 *  clamp로 작은 화면(375px 세로)에서도 안 깨지게 상한만 길이별로 둔다(min은 동일 비율 축소). */
function heroFontSize(value: string): string {
  const len = (value || '').length;
  if (len <= 4) return 'clamp(64px, 22vw, 150px)';
  if (len <= 6) return 'clamp(48px, 16vw, 104px)';
  return 'clamp(34px, 11vw, 50px)';
}

type HeroEvent = 'listening' | 'confirm' | 'complete';

// ─── ACTIVE ───────────────────────────────────────────────────
function ActiveState({
  totalRows, columns, voiceCols, currentColId, completing, paused, confidence, inputLabel,
  onEnd, onRestartFromCol, onJumpToRow, onPrevRow, onNextRow, onTogglePause, onTouchCommit,
}: {
  totalRows: number;
  columns: Column[];
  voiceCols: Column[];
  currentColId?: string;
  completing: boolean;
  paused: boolean;
  confidence: number | null;
  inputLabel: string | null;
  onEnd: () => void;
  onRestartFromCol: (id: string) => void;
  onJumpToRow: (row: number) => void;
  onPrevRow: () => void;
  onNextRow: () => void;
  onTogglePause: () => void;
  onTouchCommit: (row: number, colId: string, value: string) => void;
}) {
  const sess = useSessionStore();
  const row = sess.activeRow;
  const pct = totalRows > 0 ? (row / totalRows) * 100 : 0;
  const rowValues = sess.getRowValues(row);
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [cmdHelpOpen, setCmdHelpOpen] = useState(false);

  // ── A-hero 파생 (v0.17.0) — 전부 store 신호에서 읽기만 한다(useVoiceSession 무수정).
  //    hero 이벤트: complete > confirm > listening. 정정(correct)은 hero가 아니라
  //    ModifyIndicatorPill(정정 구간 내내 화면을 점유, z-fight 없음)에서 직전값→새값으로 표시한다.
  const currentCol = voiceCols.find((c) => c.id === currentColId) || voiceCols[0];
  const currentValue = currentCol ? (rowValues[currentCol.id] ?? '') : '';
  const heroEvent: HeroEvent = completing
    ? 'complete'
    : currentValue
    ? 'confirm'
    : 'listening';

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

  return (
    <>
      {/* Top: row indicator + progress */}
      <div style={{ padding: '10px 18px 4px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div
            style={{
              display: 'flex', alignItems: 'baseline', gap: 6,
              whiteSpace: 'nowrap',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            }}
          >
            <span style={{ fontSize: 60, fontWeight: 800, color: T.text, letterSpacing: -3, lineHeight: 1 }}>
              {row}
            </span>
            <span style={{ fontSize: 22, fontWeight: 700, color: T.textMute, letterSpacing: -0.5 }}>
              / {totalRows}
            </span>
            <span style={{ fontSize: 14, color: T.textDim, marginLeft: 6 }}>행</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <InputDeviceBadge label={inputLabel} />
            {confidence !== null && confidence > 0 && confidence < 1 && !paused && (
              <span
                style={{
                  fontSize: 11, fontWeight: 700,
                  color: confidence < 0.65 ? T.amber : T.green,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  letterSpacing: -0.2,
                }}
              >
                {Math.round(confidence * 100)}%
              </span>
            )}
            {/* v0.15.0 A5 — 상단 작은 'PAUSE' 표시 제거. 일시정지 상태는 화면 중앙 대형 카드
                (PausedCard)로만 안내한다(다른 알람/안내와 톤·크기 통일). 녹음 중에만 REC 점등. */}
            {!paused && (
              <>
                <div
                  style={{
                    width: 8, height: 8, borderRadius: '50%', background: T.red,
                    animation: 'pulse-mic 1.2s ease-in-out infinite',
                  }}
                />
                <span style={{ fontSize: 12, color: T.red, fontWeight: 700, letterSpacing: 0.7 }}>REC</span>
              </>
            )}
          </div>
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
              background: completing ? T.green : paused ? T.amber : T.blue,
              transition: 'width 400ms ease-out, background 200ms',
              boxShadow: completing ? `0 0 12px ${T.green}` : paused ? '0 0 8px rgba(255,179,0,0.4)' : `0 0 8px ${T.blueGlow}`,
            }}
          />
        </div>
      </div>

      {/* Chip grid */}
      <div
        style={{
          padding: '10px 12px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 8,
          borderTop: `1px solid ${T.line}`,
          borderBottom: `1px solid ${T.line}`,
          flexShrink: 0,
          alignContent: 'flex-start',
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
              col={c}
              value={value}
              isActive={isActive}
              isDone={isDone}
              isEditing={isEditingThis}
              onActivate={() => {
                if (c.type === 'date') return;
                if (isVoice) {
                  setEditingColId(null);
                  onRestartFromCol(c.id);
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

      {/* Center: 값 중심(Hero) + row-nav + mic pause toggle + end button */}
      <div
        style={{
          flex: 1, position: 'relative',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '0 20px', minHeight: 0, gap: 18,
        }}
      >
        {/* v0.17.0 A-hero — 한 번에 한 값을 거대 mono로 중앙 표시. listening/confirm/complete
            이벤트별 톤(정정은 ModifyIndicatorPill이 직전값→새값으로 담당). 칩 그리드는 위에서
            컴팩트 진행 레일로 유지(터치/auto 편집·재녹음 핸들러 보존). 정정·이상치·일시정지 카드가
            뜨면 중복을 피해 hero는 숨긴다. */}
        {!paused && currentCol && !sess.modifyIndicator && !sess.anomalyAlert && (
          <VoiceHero
            event={heroEvent}
            col={currentCol}
            value={currentValue}
          />
        )}

        {/* I-2: 행 이동 (버튼 — 음성 "이전"/"다음"과 동일 동작) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={onPrevRow}
            disabled={paused}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '7px 14px', borderRadius: 999,
              border: `1px solid ${T.lineStrong}`, background: T.card,
              color: paused ? T.textMute : T.textDim, fontSize: 14, fontWeight: 700,
              cursor: paused ? 'default' : 'pointer', opacity: paused ? 0.5 : 1,
            }}
            title="이전 행으로 이동"
          >
            ◀ 이전
          </button>
          <button
            onClick={onNextRow}
            disabled={paused}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '7px 14px', borderRadius: 999,
              border: `1px solid ${T.lineStrong}`, background: T.card,
              color: paused ? T.textMute : T.textDim, fontSize: 14, fontWeight: 700,
              cursor: paused ? 'default' : 'pointer', opacity: paused ? 0.5 : 1,
            }}
            title="다음 행으로 이동"
          >
            다음 ▶
          </button>
        </div>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 16,
          }}
        >
          {/* Pause toggle (large mic) */}
          <button
            onClick={onTogglePause}
            style={{
              position: 'relative', width: 76, height: 76, borderRadius: '50%',
              border: 'none', cursor: 'pointer', padding: 0,
              background: paused
                ? `radial-gradient(circle at 30% 30%, #3A3E45, #2A2D32 60%, #1A1C1F)`
                : `radial-gradient(circle at 30% 30%, #5a9bff, ${T.blue} 60%, #1755c9)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: paused ? 'none' : 'pulse-mic 1.4s ease-in-out infinite',
              boxShadow: paused ? '0 4px 14px rgba(0,0,0,0.3)' : `0 0 32px ${T.blueGlow}, 0 6px 18px rgba(0,0,0,0.4)`,
            }}
            title={paused ? '재개' : '일시정지'}
          >
            {!paused && [0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  position: 'absolute', inset: 0, borderRadius: '50%',
                  border: `1.5px solid ${T.blue}`,
                  animation: `ring-expand 2.4s ease-out ${i * 0.8}s infinite`,
                }}
              />
            ))}
            {paused
              ? I.play(28, T.textDim)
              : I.micFilled(28, '#fff')}
          </button>

          {/* End button */}
          <button
            onClick={onEnd}
            style={{
              width: 76, height: 76, borderRadius: '50%',
              border: `2px solid ${T.lineStrong}`,
              background: 'rgba(255,82,82,0.08)',
              color: T.red,
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 2,
            }}
            title="입력 종료"
          >
            {I.stop(22, T.red)}
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4 }}>종료</span>
          </button>
        </div>
      </div>

      {/* TTS echo */}
      <div
        style={{
          padding: '6px 16px 4px',
          borderTop: `1px solid ${T.line}`,
          display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 15, color: T.textDim, fontWeight: 500,
            fontStyle: 'italic', letterSpacing: -0.1, minHeight: 20,
          }}
        >
          {sess.lastTts}
        </div>
        <div
          style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
            fontSize: 12, color: T.textMute,
          }}
        >
          <span style={{ fontWeight: 700 }}>명령:</span>
          {PRIMARY_COMMANDS.map((cmd) => (
            <span
              key={cmd.id}
              style={{
                padding: '2px 8px', borderRadius: 999,
                background: 'rgba(255,255,255,0.05)',
                color: T.textDim,
              }}
            >
              {cmd.display}
            </span>
          ))}
          {/* I-1: 전체 음성 명령어 도움말 팝업 */}
          <button
            onClick={() => setCmdHelpOpen(true)}
            style={{
              padding: '2px 9px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.textDim, fontSize: 11, fontWeight: 700,
            }}
            title="음성 명령어 전체 보기"
          >
            ？ 명령어
          </button>
        </div>
      </div>
      <ActiveTtsSlider />
      {cmdHelpOpen && <CommandHelpPopup onClose={() => setCmdHelpOpen(false)} />}
      {sess.anomalyAlert && <AnomalyAlertPopup a={sess.anomalyAlert} />}
      {/* v0.12.0 AREA2 V4 — '수정 값' 인디케이터. 중앙 이상치 팝업과 겹치지 않게 상호배타로만 렌더.
          대상 셀 칩은 activeColIdx(모든 수정-재진입 경로가 setActiveCol로 지정)로 이미 하이라이트됨. */}
      {sess.modifyIndicator && !sess.anomalyAlert && (
        <ModifyIndicatorPill
          name={sess.modifyIndicator.name}
          prevValue={modPrev}
          newValue={modCurrent}
        />
      )}
      {/* v0.17.0 A-hero — CenterValueBurst는 hero/pill이 중앙 거대값을 점유하지 않을 때만 띄운다.
          confirm hero(거대 값)·정정 pill이 같은 값을 중앙에 이미 크게 보여주므로, 그때 burst를 함께
          렌더하면 동일 값이 이중으로 겹친다(이중상). 그 구간엔 burst를 생략해 중복을 없앤다. */}
      {sess.valueBurst && !sess.anomalyAlert && !paused && !sess.modifyIndicator && heroEvent !== 'confirm' && (
        <CenterValueBurst
          key={sess.valueBurst.seq}
          name={sess.valueBurst.name}
          value={sess.valueBurst.value}
        />
      )}
      {/* v0.15.0 A5 — 일시정지 중앙 대형 카드. 다른 중앙 안내(이상치/수정/버스트)보다 위(z-index)에
          두고, paused일 때 그것들을 가린다(상호배타). 후속 음성명령('재시작'/'종료')을 함께 안내. */}
      {paused && <PausedCard />}
    </>
  );
}

/** v0.15.0 A5 — 일시정지 상태를 화면 중앙·대형 카드로 안내한다. 기존 상단 작은 'PAUSE' 표시를 대체.
 *  톤은 AMBER(일시정지=주의/대기, 이상치 RED·수정 BLUE와 구분). 그 아래 후속 음성명령('재시작'으로
 *  재개 / '종료'로 저장)을 안내해, 화면을 보지 않아도/봐도 다음 행동을 알 수 있게 한다.
 *  비대화형(pointerEvents:none) — 하단 마이크/버튼 탭으로도 재개·종료 가능. */
function PausedCard() {
  return (
    <div
      data-testid="paused-card"
      aria-live="polite"
      style={{
        position: 'fixed', inset: 0, zIndex: 46,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none', padding: '16px',
      }}
    >
      <div
        style={{
          maxWidth: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto',
          padding: '24px 30px', borderRadius: 18,
          background: 'rgba(40,32,12,0.96)', border: `2px solid ${T.amber}`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, color: T.amber }} aria-hidden>⏸</span>
          <span
            style={{
              fontSize: 'clamp(30px, 8vw, 44px)', fontWeight: 900, color: T.text,
              letterSpacing: -0.5, lineHeight: 1.1, wordBreak: 'keep-all',
            }}
          >
            일시정지
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 16, color: T.textDim, fontWeight: 600, textAlign: 'center', lineHeight: 1.5 }}>
            <b style={{ color: T.amber }}>"재시작"</b> 이라고 말하면 이어서 진행
          </span>
          <span style={{ fontSize: 16, color: T.textDim, fontWeight: 600, textAlign: 'center', lineHeight: 1.5 }}>
            <b style={{ color: T.amber }}>"종료"</b> 라고 말하면 저장하고 끝냅니다
          </span>
        </div>
      </div>
    </div>
  );
}

/** v0.12.0 AREA2 V4 — 수정 재안내 중 어떤 항목을 다시 말해야 하는지 알리는 안내.
 *  v0.14.0 E(민구 요청) — 모든 알람/안내를 화면 중앙·최대 크기로 통일. 기존 상단 작은 pill을
 *  이상치 팝업과 같은 중앙 대형 카드로 교체(톤은 BLUE로 구분 — 수정은 오류가 아니라 재입력 안내).
 *  비대화형(pointerEvents:none) — 입력 흐름을 막지 않는다. */
function ModifyIndicatorPill({ name, prevValue, newValue }: { name: string; prevValue?: string; newValue?: string }) {
  // v0.17.0 A-hero: 정정 구간 두 국면을 한 카드로 표현한다(이 카드가 정정 내내 화면을 점유 — hero와
  //   z-fight 없음). ① 재프롬프트(새 값 아직): "수정 — 다시 말해주세요" + 항목명.
  //   ② 새 값 도착(echo 구간): 직전값(취소선·mute) → ↓(amber) → 새값(거대·amber) + "↺ 정정되었습니다".
  const committed = !!newValue && newValue !== prevValue;
  const accent = committed ? T.amber : T.blue;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 42,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none', padding: '16px',
      }}
    >
      <div
        style={{
          maxWidth: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto',
          padding: '20px 28px', borderRadius: 18,
          background: committed ? 'rgba(40,32,12,0.96)' : 'rgba(18,26,40,0.96)',
          border: `2px solid ${accent}`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
        }}
      >
        {/* 항목명 + 타입(읽기 일관) */}
        <span style={{ fontSize: 17, fontWeight: 800, color: accent, letterSpacing: -0.2 }}>
          {committed ? `${name} 정정` : '수정 — 다시 말해주세요'}
        </span>
        {committed ? (
          <>
            {prevValue && (
              <span
                style={{
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: 'clamp(22px, 7vw, 38px)', fontWeight: 700,
                  color: T.textMute, textDecoration: 'line-through', letterSpacing: -0.5,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '88vw',
                }}
              >
                {prevValue}
              </span>
            )}
            <span style={{ fontSize: 18, color: T.amber, lineHeight: 1 }} aria-hidden>↓</span>
            <span
              style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: heroFontSize(newValue || ''),
                fontWeight: 800, color: T.amber, letterSpacing: -1, lineHeight: 1,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '94vw',
                animation: 'chip-pop 320ms ease-out',
              }}
            >
              {newValue}
            </span>
            <span style={{ fontSize: 15, fontWeight: 800, color: T.amber, marginTop: 2 }}>↺ 정정되었습니다</span>
          </>
        ) : (
          <span
            style={{
              fontSize: 'clamp(34px, 9vw, 52px)', fontWeight: 900, color: T.text,
              letterSpacing: -0.5, textAlign: 'center', maxWidth: '100%',
              wordBreak: 'keep-all', lineHeight: 1.15,
            }}
          >
            {name}
          </span>
        )}
      </div>
    </div>
  );
}

/** v0.12.0 AREA1 — 읽기전용 입력장치 CATEGORY 배지(IOS-5 후속). 출력 라우팅 토글을 대체한다:
 *  echoCancellation을 항상 ON으로 하드코딩했으므로 사용자가 바꿀 토글이 없고, 대신 getUserMedia가
 *  실제로 잡은 마이크의 CATEGORY(내장/블루투스/유선)만 보여준다(민구 확정: raw 장치명 아님).
 *  출력(스피커/이어피스)은 iOS가 Web에 노출하지 않으므로 표시하지 않는다. 비대화형(onClick 없음). */
function InputDeviceBadge({ label }: { label: string | null }) {
  const { icon, text } = classifyInputDevice(label);
  return (
    <span
      title={`입력 마이크: ${text}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '4px 10px', borderRadius: 999,
        border: `1px solid ${T.lineStrong}`,
        background: 'transparent',
        color: T.textDim,
        fontSize: 11, fontWeight: 800, letterSpacing: -0.2,
        whiteSpace: 'nowrap', userSelect: 'none',
      }}
    >
      {icon} {text}
    </span>
  );
}

function ActiveTtsSlider() {
  const s = useSettingsStore();
  const debounceRef = useRef<number | null>(null);
  const sample = (rate: number) => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void speak('이 속도로 안내합니다.', { interrupt: true, rate });
    }, 350);
  };
  return (
    <div
      style={{
        padding: '6px 16px 10px', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 10,
      }}
    >
      <span style={{ fontSize: 12, color: T.textMute, whiteSpace: 'nowrap' }}>속도</span>
      <input
        type="range"
        min={0.5}
        max={2}
        step={0.05}
        value={s.ttsRate}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          s.set({ ttsRate: v });
          sample(v);
        }}
        style={{ flex: 1, accentColor: T.blue }}
      />
      <span
        style={{
          fontSize: 12, fontWeight: 700, color: T.blue,
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          minWidth: 36, textAlign: 'right',
        }}
      >
        {s.ttsRate.toFixed(2)}x
      </span>
    </div>
  );
}

// ─── A-hero (v0.17.0) — 한 번에 한 값, 거대 mono. ─────────────────
/** 입력 탭의 시각 중심(방향 A). 현재 필드의 이벤트 상태를 거대 숫자/안내로 표시한다.
 *  값/이벤트는 전부 store에서 파생된 props로만 들어온다(플로우 로직 무수정).
 *  - listening: 필드명 + "측정값을 말씀해 주세요" + 깜빡이는 점 3개(blink).
 *  - confirm:   필드명+타입배지 → 거대 값(mono, 길이별 150/104/50) → "✓ 정상".
 *  - complete:  ✓ + "행 입력 완료".
 *  정정(correct)은 hero가 아니라 ModifyIndicatorPill이 담당(직전값 취소선→새값). */
function VoiceHero({
  event, col, value,
}: {
  event: HeroEvent;
  col: Column;
  value: string;
}) {
  const accent = event === 'listening' ? T.blue : T.green; // confirm/complete = green

  if (event === 'complete') {
    return (
      <div
        aria-live="polite"
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          textAlign: 'center', minWidth: 0, width: '100%',
        }}
      >
        <span style={{ fontSize: 'clamp(48px, 16vw, 72px)', lineHeight: 1, color: T.green }} aria-hidden>✓</span>
        <span style={{ fontSize: 24, fontWeight: 800, color: T.text, letterSpacing: -0.4 }}>행 입력 완료</span>
        <span style={{ fontSize: 14, color: T.textDim, fontWeight: 500 }}>다음 행으로 이동합니다…</span>
      </div>
    );
  }

  return (
    <div
      aria-live="polite"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        textAlign: 'center', minWidth: 0, width: '100%',
      }}
    >
      {/* 필드명 + 타입배지 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: '100%', minWidth: 0 }}>
        <span
          style={{
            fontSize: 'clamp(18px, 5vw, 22px)', fontWeight: 800,
            color: event === 'listening' ? T.blue : T.textDim,
            letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis', maxWidth: '70vw',
          }}
        >
          {col.name}
        </span>
        <TypeBadge type={col.type} />
      </div>

      {event === 'listening' ? (
        <>
          <span style={{ fontSize: 'clamp(16px, 4.4vw, 19px)', color: T.textDim, fontWeight: 500 }}>
            측정값을 말씀해 주세요
          </span>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }} aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 12, height: 12, borderRadius: '50%', background: T.blue,
                  animation: `blink 1.2s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          {/* confirm: 거대 값 */}
          <span
            key={value}
            style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: heroFontSize(value),
              fontWeight: 800, lineHeight: 1,
              color: T.text,
              letterSpacing: -2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '94vw',
              animation: 'chip-pop 320ms ease-out',
            }}
          >
            {value || '—'}
          </span>
          {/* 상태 라벨 */}
          <span style={{ fontSize: 'clamp(15px, 4.4vw, 19px)', fontWeight: 800, color: accent, letterSpacing: -0.2 }}>
            ✓ 정상
          </span>
        </>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: Column['type'] }) {
  const c = TYPE_COLORS[type];
  return (
    <span
      style={{
        flexShrink: 0,
        padding: '3px 9px', borderRadius: 8,
        fontSize: 12, fontWeight: 700, letterSpacing: -0.1,
        color: c.fg, background: c.bg,
      }}
    >
      {TYPE_LABELS[type]}
    </span>
  );
}

// ─── chip with optional inline edit ────────────────────────────
function ColumnChip({
  col, value, isActive, isDone, isEditing, onActivate, onCommit, onCancel,
}: {
  col: Column;
  value: string;
  isActive: boolean;
  isDone: boolean;
  isEditing: boolean;
  onActivate: () => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [local, setLocal] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (!isEditing) setLocal(value); }, [value, isEditing]);
  useEffect(() => { if (isEditing) inputRef.current?.focus(); }, [isEditing]);

  // Transient "pop" of the value: bump a counter whenever the active chip's value
  // changes so the keyed inner span remounts and replays the chip-pop animation.
  const [popKey, setPopKey] = useState(0);
  useEffect(() => {
    if (isActive && value) setPopKey((k) => k + 1);
  }, [value, isActive]);

  const isVoice = col.input === 'voice';
  const isDate = col.type === 'date';
  const clickable = !isDate;

  let bg: string = 'rgba(255,255,255,0.05)';
  let border: string = 'transparent';
  let textColor: string = T.textDim;
  if (isActive) {
    bg = 'rgba(0,200,83,0.18)';
    border = T.green;
    textColor = T.text;
  } else if (isDone) {
    bg = 'rgba(0,200,83,0.10)';
    border = 'rgba(0,200,83,0.30)';
    textColor = T.text;
  }
  if (isEditing) {
    bg = T.blueGlow;
    border = T.blue;
  }

  const inputMode = col.type === 'int'
    ? 'numeric'
    : col.type === 'float'
    ? 'decimal'
    : 'text';

  return (
    <div
      onClick={() => { if (clickable && !isEditing) onActivate(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 10px',
        borderRadius: 12,
        fontSize: 'clamp(13px, 4vw, 16px)',
        background: bg,
        border: `2px solid ${border}`,
        color: textColor,
        fontWeight: isActive ? 800 : 700,
        cursor: clickable ? 'pointer' : 'default',
        letterSpacing: -0.1,
        minHeight: 44,
        minWidth: 0,
        // Active chip anchors the floating value badge and must draw over its
        // neighbours, so it unclips and lifts above sibling chips. Inactive
        // chips keep overflow:hidden for value/label ellipsis.
        position: 'relative',
        zIndex: isActive ? 20 : undefined,
        overflow: isActive ? 'visible' : 'hidden',
        transition: 'background 150ms, border 150ms',
        animation: isActive ? 'chip-pulse 1.2s ease-in-out infinite' : 'none',
      }}
    >
      {isActive && (
        <span style={{ color: T.green, fontSize: 14, fontWeight: 900, flexShrink: 0 }}>▶</span>
      )}
      {isDone && !isActive && I.check(12, T.green)}
      <span
        style={{
          color: isActive ? T.green : T.textMute,
          fontSize: 'clamp(11px, 3.4vw, 13px)',
          fontWeight: 700,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        {col.name}
      </span>
      {isEditing ? (
        <input
          ref={inputRef}
          value={local}
          inputMode={inputMode as 'numeric' | 'decimal' | 'text'}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => onCommit(local)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit(local);
            else if (e.key === 'Escape') onCancel();
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1, minWidth: 0,
            background: 'transparent', border: 'none', outline: 'none',
            color: T.text,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 'clamp(13px, 4vw, 17px)', fontWeight: 800,
            textAlign: 'right',
          }}
        />
      ) : (
        <span
          style={{
            flex: 1,
            display: 'block',
            textAlign: 'right',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            minWidth: 0,
          }}
        >
          <span
            key={popKey}
            style={{
              display: 'inline-block',
              lineHeight: 1,
              transformOrigin: 'right center',
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              color: isActive ? T.text : isDone ? T.text : T.textDim,
              // v0.17.0 A-hero: 거대 값은 중앙 hero가 담당 → 칩은 컴팩트 진행 레일로서
              // 작은 확인값만 유지(활성도 과하게 키우지 않음).
              fontSize: isActive ? 'clamp(14px, 4.4vw, 18px)' : 'clamp(13px, 4vw, 17px)',
              fontWeight: 800,
              letterSpacing: -0.3,
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              // The floating value badge below is now the recognition effect;
              // the in-chip value stays as the persistent display.
              animation: 'none',
            }}
          >
            {value || '—'}
          </span>
        </span>
      )}

      {/* I-3: the recognition burst now renders as a screen-centered overlay (CenterValueBurst in
          ActiveState) showing "항목 : 값" — larger and not clipped by the chip's transform. */}
    </div>
  );
}
