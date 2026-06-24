import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { T } from '../tokens';
import { I } from '../components/icons';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { computeTotalRows, nestedAutoValue, computeRowFromAutoChange, buildCyclingValues } from '../lib/autoValue';
import { useWakeLock, lockPortrait } from '../lib/wakeLock';
import { useVoiceSession } from '../lib/useVoiceSession';
import { isSpeechSupported, speak } from '../lib/speech';
import { PRIMARY_COMMANDS } from '../lib/voiceCommands';
import { getSampleLabelParts, type AnnounceLabelPart } from '../lib/announceColumns';
import { AnomalyAlertPopup } from '../components/voice/AnomalyAlertPopup';
import { CommandHelpPopup } from '../components/voice/CommandHelpPopup';
import type { Column } from '../types';

export function VoiceScreen() {
  const s = useSettingsStore();
  const sess = useSessionStore();
  const voiceSession = useVoiceSession();
  const [confidence, setConfidence] = useState<number | null>(null);

  useWakeLock(sess.phase === 'active' || sess.phase === 'complete' || sess.phase === 'paused');

  // Sync confidence display from voice session refs.
  // v0.18.0 — 입력기기 배지 표시 제거(민구 결정). getActiveInputLabel 폴링도 함께 제거.
  // hook의 getActiveInputLabel/복구 로직(audioRecorder.ts)은 불가침이라 그대로 둔다 — 표시만 삭제.
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
      {/* v0.19.0 W1 — 상단 큰 탭 타이틀("음성 입력") 제거(하단 TabBar 하이라이트와 중복).
          단 ttsHint(기능 안내: 미지원 브라우저 / 테이블 미생성)는 삭제하지 않고 본문 상단
          경고 배너로 이전한다 — 순수 탭 이름만 사라지고 기능 안내는 보존. */}
      <div
        style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '0 24px', gap: 28,
        }}
      >
        {ttsHint && (
          <div
            role="alert"
            style={{
              width: '100%', maxWidth: 320,
              padding: '12px 16px', borderRadius: 12,
              background: 'rgba(255,179,0,0.10)', border: `1px solid ${T.amber}`,
              color: T.amber, fontSize: 15, fontWeight: 600,
              lineHeight: 1.5, letterSpacing: -0.1, textAlign: 'center',
            }}
          >
            {ttsHint}
          </div>
        )}
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
  const s = useSettingsStore();
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

  // ── v0.18.0 1b — 범용 샘플 식별 라벨 파트. announceColumns.ts의 순수 셀렉터로 산출(읽기 전용,
  //    컬럼명 하드코딩 없음). 현 행/직전 행의 auto값을 buildCyclingValues로 view에서 파생하고,
  //    순차변화(changed) 파트는 hero에서 굵게/액센트로 강조한다. 첫 행(row 1)은 prevValues=null로
  //    넘겨 getSampleLabelParts가 "전부 변화"로 보지 않게 한다(buildCyclingValues(…,0) 호출 금지).
  const sampleLabelParts = useMemo<AnnounceLabelPart[]>(() => {
    const curValues = buildCyclingValues(columns, row);
    const prevValues = row > 1 ? buildCyclingValues(columns, row - 1) : null;
    return getSampleLabelParts(columns, curValues, prevValues);
  }, [columns, row]);

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

  // ── v0.19.0 W5 — 칩 그리드를 3줄 캡(내부 스크롤)으로 고정하면 활성 컬럼이 스크롤 밖으로 나갈 수
  //    있다("지금 어디" 표시 상실). 활성 칩을 ref로 잡아 currentColId/row 변경 시 가시영역으로
  //    스크롤한다(block:nearest — 위/아래 인접 칩만 살짝, 화면 점프 없음).
  const activeChipRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeChipRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
            <span style={{ fontSize: 60, fontWeight: 800, color: T.text, letterSpacing: -3, lineHeight: 1 }}>
              {row}
            </span>
            <span style={{ fontSize: 22, fontWeight: 700, color: T.textMute, letterSpacing: -0.5 }}>
              / {totalRows}
            </span>
            <span style={{ fontSize: 14, color: T.textDim, marginLeft: 6 }}>행</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* v0.18.0 — 입력기기 배지 표시 제거(민구 결정). 복구 로직은 audioRecorder.ts에 보존. */}
            {confidence !== null && confidence > 0 && confidence < 1 && !paused && (
              <span
                style={{
                  fontSize: 11, fontWeight: 700,
                  // v0.20.0 입력탭#1 — 신뢰도 색 임계를 사용자 조절 허용범위(recognitionTolerance)에
                  //   맞춘다(하드코딩 0.65 제거). 허용범위 미만이면 amber(불안), 이상이면 green.
                  color: confidence < s.recognitionTolerance ? T.amber : T.green,
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

      {/* 2) Chip grid — v0.19.0 W5: 약 3줄 캡 + 내부 스크롤. 칩이 늘어도 이 구역 높이는 고정이라
          아래 hero/컨트롤바를 밀지 않는다(버그A 차단). 활성 칩은 scrollIntoView로 항상 가시. */}
      <div
        style={{
          maxHeight: 168,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '10px 12px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: 8,
          borderTop: `1px solid ${T.line}`,
          borderBottom: `1px solid ${T.line}`,
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
              containerRef={isActive ? activeChipRef : undefined}
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

      {/* 3) 1fr 흡수영역 — VoiceHero 단독. v0.21.0 입력탭#1+4(민구 재요청) — 화면 본문의 TTS 에코
          ({sess.lastTts}: "횡경 말씀해 주세요" 등 컬럼명 안내문구)를 화면에서 제거한다. ⚠️ TTS 음성
          안내는 그대로 유지(useVoiceSession의 say()/setLastTts 무수정) — 화면에 그리는 텍스트만 삭제.
          에코 줄이 사라지면서 hero가 흡수영역 세로를 온전히 쓸 수 있어 #2(팝업 잘림)도 함께 완화된다.
          overflow:hidden은 유지(hero가 길어도 아래 컨트롤바 보호) — hero 내부는 자체 가용높이 기준 축소. */}
      <div
        style={{
          minHeight: 0, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '12px 20px', gap: 12,
        }}
      >
        {/* v0.17.0 A-hero — 한 번에 한 값을 거대 mono로 중앙 표시. listening/confirm/complete
            이벤트별 톤(정정은 ModifyIndicatorPill이 직전값→새값으로 담당). 정정·이상치·일시정지
            카드가 뜨면 중복을 피해 hero는 숨긴다. */}
        {!paused && currentCol && !sess.modifyIndicator && !sess.anomalyAlert && (
          <VoiceHero
            event={heroEvent}
            col={currentCol}
            value={currentValue}
            sampleParts={sampleLabelParts}
          />
        )}
      </div>

      {/* 4) 하단 컨트롤바 — 한자리 고정. 이전/다음·마이크·종료·명령어 칩·도움말·속도 슬라이더.
          내용이 고정이라 row3(흡수영역)의 변화와 무관하게 Y가 불변(버그B의 '메뉴 이동' 해소). */}
      <div
        style={{
          borderTop: `1px solid ${T.line}`,
          background: 'rgba(255,255,255,0.015)',
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: '8px 16px 8px',
        }}
      >
        {/* 행 이동 + 마이크(일시정지) + 종료 한 줄 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <button
            onClick={onPrevRow}
            disabled={paused}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '9px 14px', borderRadius: 999, minHeight: 44,
              border: `1px solid ${T.lineStrong}`, background: T.card,
              color: paused ? T.textMute : T.textDim, fontSize: 14, fontWeight: 700,
              cursor: paused ? 'default' : 'pointer', opacity: paused ? 0.5 : 1,
            }}
            title="이전 행으로 이동"
          >
            ◀ 이전
          </button>

          {/* Pause toggle (large mic) */}
          <button
            onClick={onTogglePause}
            style={{
              position: 'relative', width: 72, height: 72, borderRadius: '50%',
              border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0,
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
              width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
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

          <button
            onClick={onNextRow}
            disabled={paused}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '9px 14px', borderRadius: 999, minHeight: 44,
              border: `1px solid ${T.lineStrong}`, background: T.card,
              color: paused ? T.textMute : T.textDim, fontSize: 14, fontWeight: 700,
              cursor: paused ? 'default' : 'pointer', opacity: paused ? 0.5 : 1,
            }}
            title="다음 행으로 이동"
          >
            다음 ▶
          </button>
        </div>

        {/* 명령어 칩 + 전체 도움말 */}
        <div
          style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6,
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

        <ActiveControlDials />
      </div>

      {/* Fixed 오버레이들 — position:fixed라 grid track을 만들지 않는다(구역 높이에 무영향). */}
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
      {/* v0.18.0 1c — CenterValueBurst('항목:값' 팝업) 완전 제거. 인식값은 hero(거대 값)·
          ModifyIndicatorPill(정정)·AnomalyAlertPopup(이상치)로만 노출돼 중복 표시를 없앤다.
          store의 valueBurst 필드/pushValueBurst 호출(useVoiceSession.ts)은 zero-diff 가드상
          무수정 — write-only dead state로 남되 어디에도 렌더되지 않는다. */}
      {/* v0.15.0 A5 — 일시정지 중앙 대형 카드. 다른 중앙 안내(이상치/수정/버스트)보다 위(z-index)에
          두고, paused일 때 그것들을 가린다(상호배타). 후속 음성명령('재시작'/'종료')을 함께 안내. */}
      {paused && <PausedCard />}
    </div>
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
        pointerEvents: 'none',
        // v0.21.0 입력탭#3 — standalone(홈화면 설치) safe-area 침범 방지(App.tsx:40-46 패턴).
        //   fixed/inset:0 오버레이라 셸 패딩 바깥에 그려져 상태바·노치를 침범할 수 있다.
        //   기본 16px에 env(safe-area-inset-*)를 더해 내부 카드를 안전영역 안으로 민다.
        //   일반 Safari 탭에선 env(...)가 0이라 무영향.
        paddingTop: 'max(16px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(16px, env(safe-area-inset-right, 0px))',
      }}
    >
      <div
        style={{
          // v0.20.0 입력탭#4 — 상단 칩 영역 침범 방지 캡(88vh→min(70vh,520px)).
          maxWidth: 'min(560px, 94vw)', maxHeight: 'min(70vh, 520px)', overflowY: 'auto',
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
          // v0.20.0 입력탭#4 — 상단 칩 영역 침범 방지 캡(88vh→min(70vh,520px)).
          maxWidth: 'min(560px, 94vw)', maxHeight: 'min(70vh, 520px)', overflowY: 'auto',
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


/** v0.20.0 입력탭#1·#2 — 장갑 손가락용 가로 다이얼(재사용 프리미티브). 네이티브 input[type=range]
 *  위에 큰 트랙·큰 thumb를 styled해 role=slider/키보드 화살표/focus-visible를 보존한다(접근성 기본).
 *  라벨(상단)·큰 값 표시(우측)·굵은 트랙으로 원거리·장갑 가독. 컨트롤바에 두 개를 수평 배치한다.
 *  값 포맷은 valueLabel로 주입(% 또는 x). 변경 콜백은 onChange(연속), 마지막 변경 후 샘플은 호출자. */
function Dial({
  label, value, min, max, step, accent, valueLabel, ariaValueText, onChange, testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  accent: string;
  valueLabel: string;
  ariaValueText?: string;
  onChange: (v: number) => void;
  testId?: string;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div
      data-testid={testId}
      style={{
        flex: 1, minWidth: 0,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 12, color: T.textMute, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <span
          style={{
            fontSize: 15, fontWeight: 800, color: accent,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            letterSpacing: -0.3, whiteSpace: 'nowrap',
          }}
        >
          {valueLabel}
        </span>
      </div>
      <input
        type="range"
        className="dial-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={ariaValueText ?? valueLabel}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: '100%', height: 34, margin: 0,
          accentColor: accent,
          // 굵은 트랙 — 장갑 손가락이 끌기 쉽게(min 44px 터치 타깃은 height로 확보).
          background: `linear-gradient(90deg, ${accent} 0%, ${accent} ${pct}%, ${T.lineStrong} ${pct}%, ${T.lineStrong} 100%)`,
          borderRadius: 999,
          cursor: 'pointer',
          touchAction: 'none',
        }}
      />
    </div>
  );
}

/** v0.20.0 입력탭#1·#2 — 입력 컨트롤바: [인식 허용범위] · [안내 속도] 두 다이얼을 수평 배치.
 *  허용범위(recognitionTolerance) 0.40~0.90 → %로 표시. 속도(ttsRate) 0.5~2.0 → x로 표시·샘플 음성.
 *  두 다이얼은 375 폭에서도 한 줄에 들어가게 동일 flex(각 minWidth:0). */
function ActiveControlDials() {
  const s = useSettingsStore();
  const ttsDebounceRef = useRef<number | null>(null);
  const sampleTts = (rate: number) => {
    if (ttsDebounceRef.current !== null) window.clearTimeout(ttsDebounceRef.current);
    ttsDebounceRef.current = window.setTimeout(() => {
      void speak('이 속도로 안내합니다.', { interrupt: true, rate });
    }, 350);
  };
  const tolPct = Math.round(s.recognitionTolerance * 100);
  return (
    <div
      style={{
        padding: '6px 12px 8px', flexShrink: 0,
        display: 'flex', alignItems: 'flex-end', gap: 16,
      }}
    >
      <Dial
        testId="dial-tolerance"
        label="인식 허용범위"
        value={s.recognitionTolerance}
        min={0.4}
        max={0.9}
        step={0.05}
        accent={T.green}
        valueLabel={`${tolPct}%`}
        ariaValueText={`인식 허용범위 ${tolPct} 퍼센트`}
        onChange={(v) => s.set({ recognitionTolerance: v })}
      />
      <Dial
        testId="dial-tts-rate"
        label="안내 속도"
        value={s.ttsRate}
        min={0.5}
        max={2}
        step={0.05}
        accent={T.blue}
        valueLabel={`${s.ttsRate.toFixed(2)}x`}
        ariaValueText={`안내 속도 ${s.ttsRate.toFixed(2)}배`}
        onChange={(v) => {
          s.set({ ttsRate: v });
          sampleTts(v);
        }}
      />
    </div>
  );
}

// ─── A-hero (v0.17.0 → v0.18.0 패널화) — 한 번에 한 값, 거대 mono, 반투명 패널. ──
/** v0.18.0 1a — 상태색 패널 톤. 다른 중앙 팝업(AnomalyAlertPopup/ModifyIndicatorPill/
 *  PausedCard, `rgba(...,0.94~0.96)` + 2px border)과 시각 일관. 의미색은 현행 유지:
 *  listening/confirm/complete = 초록 계열(확정 톤). 패널/반투명 배경만 강화해 원거리에서
 *  "글자만 덩그러니" 뜨던 hero를 영역으로 분리한다. */
const HERO_PANEL = {
  // listening도 confirm/complete와 같은 초록 계열 패널(현행 의미색 — 입력탭 hero는 확정 흐름).
  bg: 'rgba(10,28,18,0.94)',
  border: T.green,
} as const;

/** 입력 탭의 시각 중심(방향 A). 현재 필드의 이벤트 상태를 거대 숫자/안내로 표시한다.
 *  값/이벤트는 전부 store에서 파생된 props로만 들어온다(플로우 로직 무수정).
 *  - 패널 상단: 범용 샘플 식별 라벨(sampleParts, 순차변화 파트는 굵게/액센트).
 *  - listening: 필드명을 거대하게 단독 표시(v0.21.0 입력탭#3 — 정적 안내문구·타입배지 삭제,
 *               항목명을 가용공간 기준 최대 크기로). 패널 자체 점멸(panel-pulse)로 '듣는 중' 신호.
 *  - confirm:   필드명 → 거대 값(mono, 길이별 150/104/50) → "✓ 정상"(배지 없음).
 *  - complete:  ✓ + "행 입력 완료".
 *  정정(correct)은 hero가 아니라 ModifyIndicatorPill이 담당(직전값 취소선→새값). */
function VoiceHero({
  event, col, value, sampleParts,
}: {
  event: HeroEvent;
  col: Column;
  value: string;
  sampleParts: AnnounceLabelPart[];
}) {
  // confirm/complete = green(확정), listening = green 패널 + 거대 값 전 안내. 상태 라벨 색만 분기.
  const statusAccent = T.green;
  // v0.20.0 입력탭#5 — listening일 때 패널 자체가 은은히 점멸(점3개 제거). transform 미사용 호흡.
  const isListening = event === 'listening';

  return (
    <div
      aria-live="polite"
      style={{
        // v0.18.0 1a — 반투명 패널: 다른 팝업과 동일한 frame + 2px 상태색 border + shadow.
        maxWidth: 'min(560px, 94vw)', width: '100%',
        // v0.21.0 입력탭#2 — 잘림 방지: 흡수영역(1fr, overflow:hidden) 안에서 패널이 가용높이를
        //   넘으면 하드 클립되던 문제. 패널 자체 maxHeight:100% + 내부 overflowY:auto로, 짧은
        //   기기/긴 값에서도 항목명·값이 잘리지 않고 패널 내부에서 스크롤되게 한다(다른 중앙
        //   오버레이의 min(70vh,520px)+overflowY:auto 가드와 동일 전략). minHeight:0은 flex
        //   자식이 컨테이너를 넘기지 않게(축소 허용) 하는 표준 가드.
        maxHeight: '100%', minHeight: 0, overflowY: 'auto',
        padding: '18px 24px', borderRadius: 18,
        background: HERO_PANEL.bg,
        border: `2px solid ${HERO_PANEL.border}`,
        boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        textAlign: 'center', minWidth: 0,
        // v0.20.0 입력탭#5 — 패널 자체 점멸(듣는 중 신호). opacity+box-shadow만(scale 금지 — 94vw가
        //   overflow:hidden 1fr 구역에서 잘림). 다른 상태(confirm/complete)는 점멸하지 않는다.
        animation: isListening ? 'panel-pulse 1.8s ease-in-out infinite' : undefined,
        willChange: isListening ? 'opacity, box-shadow' : undefined,
      }}
    >
      {/* v0.18.0 1b — 범용 샘플 식별 라벨 헤더. announceColumns 셀렉터 산출 파트를 그대로 표시.
          changed(순차변화) 파트는 굵게+초록 액센트로 강조해, 멀리서도 "지금 어느 샘플"인지 식별. */}
      {sampleParts.length > 0 && (
        <SampleLabelHeader parts={sampleParts} />
      )}

      {event === 'complete' ? (
        <>
          <span style={{ fontSize: 'clamp(48px, 16vw, 72px)', lineHeight: 1, color: T.green }} aria-hidden>✓</span>
          <span style={{ fontSize: 24, fontWeight: 800, color: T.text, letterSpacing: -0.4 }}>행 입력 완료</span>
          <span style={{ fontSize: 14, color: T.textDim, fontWeight: 500 }}>다음 행으로 이동합니다…</span>
        </>
      ) : event === 'listening' ? (
        // v0.21.0 입력탭#3 — "측정값을 말씀해 주세요" 정적 안내문구 + 데이터형 배지(TypeBadge) 삭제.
        //   듣는 중에는 "지금 어느 항목을 말해야 하는가"(항목명)가 유일한 시각 신호이므로, 항목명을
        //   hero 가용공간 기준 최대 크기로 키운다(고정 clamp 상한 대신 vw 비중↑·상한↑). 장갑·원거리
        //   가독 우선. 한 줄 유지(keep-all)하되 좁은 기기/긴 이름은 자동 축소(clamp 하한). TTS 음성
        //   안내(say)는 그대로라 화면을 안 봐도 무엇을 말할지 들린다.
        <span
          style={{
            fontSize: 'clamp(34px, 13vw, 76px)', fontWeight: 900,
            color: T.text, letterSpacing: -1, lineHeight: 1.05,
            wordBreak: 'keep-all', textAlign: 'center', maxWidth: '100%',
          }}
        >
          {col.name}
        </span>
      ) : (
        <>
          {/* 측정 항목명 (배지 제거 — 항목명만, 샘플 라벨과 위계 구분 위해 값보다 작게) */}
          <span
            style={{
              fontSize: 'clamp(18px, 5.4vw, 24px)', fontWeight: 800,
              color: T.text,
              letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden',
              textOverflow: 'ellipsis', maxWidth: '88vw',
            }}
          >
            {col.name}
          </span>
          {/* confirm: 거대 값 */}
          <span
            key={value}
            style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: heroFontSize(value),
              fontWeight: 800, lineHeight: 1,
              color: T.text,
              letterSpacing: -2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '88vw',
              animation: 'chip-pop 320ms ease-out',
            }}
          >
            {value || '—'}
          </span>
          {/* 상태 라벨 */}
          <span style={{ fontSize: 'clamp(15px, 4.4vw, 19px)', fontWeight: 800, color: statusAccent, letterSpacing: -0.2 }}>
            ✓ 정상
          </span>
        </>
      )}
    </div>
  );
}

/** v0.18.0 1b — 범용 샘플 식별 라벨 헤더. announceColumns의 파트를 ` · ` 구분으로 나열한다.
 *  순차변화(changed=true) 파트는 굵게+초록 액센트로 강조(= announceRowDiff가 호명하는 부분).
 *  컬럼명 하드코딩 없음. 측정 항목명보다 작게(위계 구분), 원거리 가독되게 충분히 크게. */
function SampleLabelHeader({ parts }: { parts: AnnounceLabelPart[] }) {
  return (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'center',
        gap: '2px 4px', maxWidth: '100%',
        paddingBottom: 8, marginBottom: 2,
        borderBottom: `1px solid rgba(0,200,83,0.22)`,
      }}
    >
      {parts.map((p, i) => (
        <span key={p.col.id} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
          {i > 0 && <span style={{ fontSize: 14, color: T.textMute, fontWeight: 600 }} aria-hidden>·</span>}
          <span
            style={{
              fontSize: p.changed ? 'clamp(15px, 4.4vw, 18px)' : 'clamp(14px, 4vw, 16px)',
              fontWeight: p.changed ? 800 : 600,
              color: p.changed ? T.green : T.textDim,
              letterSpacing: -0.2,
              whiteSpace: 'nowrap',
            }}
          >
            {p.col.name} {p.value}
          </span>
        </span>
      ))}
    </div>
  );
}

// v0.21.0 입력탭#3 — TypeBadge(항목 옆 데이터형 작은 배지) 컴포넌트 및 사용처 삭제(불필요).
//   TYPE_LABELS/TYPE_COLORS import도 함께 제거(다른 사용처 없음).

// ─── chip with optional inline edit ────────────────────────────
function ColumnChip({
  col, value, isActive, isDone, isEditing, onActivate, onCommit, onCancel, containerRef,
}: {
  col: Column;
  value: string;
  isActive: boolean;
  isDone: boolean;
  isEditing: boolean;
  onActivate: () => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
  // v0.19.0 W5 — 활성 칩에만 전달되어 칩 스크롤영역에서 scrollIntoView 대상이 된다.
  containerRef?: Ref<HTMLDivElement>;
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
      ref={containerRef}
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
    </div>
  );
}
