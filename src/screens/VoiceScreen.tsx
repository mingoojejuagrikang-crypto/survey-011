import { useEffect, useMemo, useRef, useState } from 'react';
import { T } from '../tokens';
import { I } from '../components/icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { computeTotalRows, nestedAutoValue, computeRowFromAutoChange } from '../lib/autoValue';
import { useWakeLock, lockPortrait } from '../lib/wakeLock';
import { useVoiceSession } from '../lib/useVoiceSession';
import { isSpeechSupported, speak } from '../lib/speech';
import { VOICE_COMMANDS, PRIMARY_COMMANDS } from '../lib/voiceCommands';
import { logger } from '../lib/logger';
import type { Column } from '../types';

export function VoiceScreen() {
  const s = useSettingsStore();
  const sess = useSessionStore();
  const voiceSession = useVoiceSession();
  const [confidence, setConfidence] = useState<number | null>(null);

  useWakeLock(sess.phase === 'active' || sess.phase === 'complete' || sess.phase === 'paused');

  // Sync confidence display from voice session ref
  useEffect(() => {
    if (sess.phase !== 'active') return;
    const interval = setInterval(() => {
      setConfidence(voiceSession.lastConfidenceRef.current);
    }, 300);
    return () => clearInterval(interval);
  }, [sess.phase, voiceSession.lastConfidenceRef]);

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

// ─── ACTIVE ───────────────────────────────────────────────────
function ActiveState({
  totalRows, columns, voiceCols, currentColId, completing, paused, confidence,
  onEnd, onRestartFromCol, onJumpToRow, onPrevRow, onNextRow, onTogglePause, onTouchCommit,
}: {
  totalRows: number;
  columns: Column[];
  voiceCols: Column[];
  currentColId?: string;
  completing: boolean;
  paused: boolean;
  confidence: number | null;
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
            <OutputToggle />
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
            {paused ? (
              <>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.amber }} />
                <span style={{ fontSize: 12, color: T.amber, fontWeight: 700, letterSpacing: 0.7 }}>PAUSE</span>
              </>
            ) : (
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
            marginTop: 6, position: 'relative', height: 4, borderRadius: 2,
            background: 'rgba(255,255,255,0.08)',
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
        {/* v0.4.5 I1: 중앙 Hero(항목명+큰 값) 제거 — 칩 영역(chip-pulse 블링크 + 값 표시)과 중복. */}

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
      {sess.valueBurst && (
        <CenterValueBurst
          key={sess.valueBurst.seq}
          name={sess.valueBurst.name}
          value={sess.valueBurst.value}
        />
      )}
    </>
  );
}

/** v0.9.0 입력탭 스피커/이어폰 출력 토글(IOS-5/AUDIO-ROUTE-1 실험). OS 단계 변경 번거로움을 줄이려
 *  입력 중에도 전환. ON(스피커)이면 마이크를 echoCancellation:false로 재취득해 리시버 고착 해제를
 *  시도한다(실제 출력 전환은 OS 의존 — 실기기 A/B 측정용). settingsStore.speakerOutput가 SSOT. */
function OutputToggle() {
  const speakerOutput = useSettingsStore((s) => s.speakerOutput);
  return (
    <button
      onClick={() => {
        const next = !speakerOutput;
        useSettingsStore.getState().set({ speakerOutput: next });
        logger.log({ type: 'app', extra: `setting_changed:speakerOutput=${next}` });
      }}
      title={speakerOutput ? '스피커 출력(실험) — 탭하면 이어폰/기본' : '이어폰/기본 출력 — 탭하면 스피커(실험)'}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '4px 10px', borderRadius: 999,
        border: `1px solid ${speakerOutput ? T.blue : T.lineStrong}`,
        background: speakerOutput ? 'rgba(45,127,249,0.16)' : 'transparent',
        color: speakerOutput ? T.blue : T.textDim,
        fontSize: 11, fontWeight: 800, letterSpacing: -0.2, cursor: 'pointer',
      }}
    >
      {speakerOutput ? '🔊 스피커' : '🎧 이어폰'}
    </button>
  );
}

/** v0.9.0 이상치 알람 팝업 — 발화만으론 스쳐 지나가 확인이 어렵다는 요청. 이전값→현재값과 변화량
 *  (절대차 또는 %)을 상단에 띄우고, '확인'/'유지'/새 값 입력 또는 다음 필드 진입 시 해제(store에서). */
function AnomalyAlertPopup({
  a,
}: {
  a: { colName: string; prev: string; next: string; direction: 'up' | 'down'; changeText: string };
}) {
  const up = a.direction === 'up';
  const accent = up ? T.red : T.amber;
  return (
    <div
      data-testid="anomaly-alert"
      aria-live="assertive"
      style={{
        position: 'fixed', left: 0, right: 0, top: 0, zIndex: 45,
        display: 'flex', justifyContent: 'center', padding: '12px 16px 0', pointerEvents: 'none',
      }}
    >
      <div
        style={{
          maxWidth: '92vw', padding: '14px 22px', borderRadius: 18,
          background: 'rgba(34,18,18,0.96)', border: `2px solid ${accent}`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{a.colName} 이상치</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: accent }}>
            {a.changeText ? `${a.changeText} ` : ''}{up ? '증가' : '감소'}
          </span>
        </div>
        <div
          style={{
            display: 'flex', alignItems: 'baseline', gap: 12,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          }}
        >
          <span style={{ fontSize: 22, fontWeight: 800, color: T.textDim }}>{a.prev}</span>
          <span style={{ fontSize: 18, color: T.textMute }}>→</span>
          <span style={{ fontSize: 'clamp(28px, 8vw, 40px)', fontWeight: 900, color: T.text, letterSpacing: -0.5 }}>
            {a.next}
          </span>
        </div>
        <div style={{ fontSize: 12, color: T.textDim, fontWeight: 600 }}>'확인' 또는 새 값으로 정정</div>
      </div>
    </div>
  );
}

/** I-3: screen-centered recognition burst — "항목 : 값", large, replays per recognition (keyed by
 *  seq), then auto-fades via the value-burst keyframes. Decorative (the value also lives in the chip). */
function CenterValueBurst({ name, value }: { name: string; value: string }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed', inset: 0, zIndex: 40, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        style={{
          animation: 'value-burst 950ms ease-out forwards',
          maxWidth: '88vw',
          padding: '18px 26px', borderRadius: 20,
          background: 'rgba(10,28,18,0.94)',
          border: `2px solid ${T.green}`,
          boxShadow: `0 0 36px rgba(0,200,83,0.55), 0 12px 40px rgba(0,0,0,0.5)`,
          display: 'flex', alignItems: 'baseline', gap: 12, justifyContent: 'center',
        }}
      >
        {/* I1: 항목명과 값을 같은 폰트 사이즈로 통일하고 화면 내 최대 확대(88vw 가드). */}
        <span style={{ fontSize: 'clamp(30px, 9vw, 50px)', fontWeight: 800, color: T.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '34vw' }}>
          {name}
        </span>
        <span style={{ fontSize: 'clamp(30px, 9vw, 50px)', fontWeight: 700, color: T.textMute }}>:</span>
        <span
          style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 'clamp(30px, 9vw, 50px)', fontWeight: 900,
            color: T.text, letterSpacing: -0.5, lineHeight: 1.05,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

/** I-1: 음성 명령어 전체 목록 팝업. voiceCommands.ts(SSOT)에서 동적 생성 — 기능당 단어 1개. */
function CommandHelpPopup({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 510, maxHeight: '80%', overflowY: 'auto',
          background: T.card, borderRadius: 30, border: `1px solid ${T.lineStrong}`,
          padding: '30px 27px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 21 }}>
          <div style={{ fontSize: 25, fontWeight: 800, color: T.text }}>음성 명령어</div>
          <button
            onClick={onClose}
            style={{
              width: 45, height: 45, borderRadius: '50%', border: `1px solid ${T.lineStrong}`,
              background: 'transparent', color: T.textDim, fontSize: 24, cursor: 'pointer',
            }}
            title="닫기"
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: 18, color: T.textMute, marginBottom: 21, lineHeight: 1.5 }}>
          각 기능은 아래 <b>한 단어</b>로만 동작합니다. 그대로 말씀하세요.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          {VOICE_COMMANDS.map((cmd) => (
            <div key={cmd.id} style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
              <span
                style={{
                  flexShrink: 0, minWidth: 96, textAlign: 'center',
                  padding: '6px 15px', borderRadius: 999,
                  background: T.blueGlow, color: '#fff', fontSize: 21, fontWeight: 800,
                }}
              >
                {cmd.display}
              </span>
              <span style={{ fontSize: 20, color: T.textDim, lineHeight: 1.4 }}>{cmd.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
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
              // Active chip's value reads larger for at-a-glance confirmation.
              fontSize: isActive ? 'clamp(16px, 5.2vw, 22px)' : 'clamp(13px, 4vw, 17px)',
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
