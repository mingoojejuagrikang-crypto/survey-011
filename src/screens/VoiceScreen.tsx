/* eslint-disable max-lines -- [ENV-12] 기존 초과 파일(GL-006 §5 도입 시점), Stage 2(컴포넌트 추출)에서 해소. 해소 시 이 주석 제거. */
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { T } from '../tokens';
import { I } from '../components/icons';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { computeTotalRows, nestedAutoValue, computeRowFromAutoChange } from '../lib/autoValue';
import { useWakeLock, lockPortrait } from '../lib/wakeLock';
import { useVoiceSession } from '../lib/useVoiceSession';
import { isSpeechSupported, speak } from '../lib/speech';
import { logger } from '../lib/logger';
import { buildSessionLabel } from '../lib/sessionLabel';
import { ConnectionStatusCard } from '../components/ConnectionStatusCard';
import { EdgeGlow, type GlowTone } from '../components/voice/EdgeGlow';
import { AnomalyAlertPopup } from '../components/voice/AnomalyAlertPopup';
import { CommandHelpPopup } from '../components/voice/CommandHelpPopup';
import { ManualValueSheet } from '../components/voice/ManualValueSheet';
import { PausedCard } from '../components/voice/PausedCard';
import { ModifyIndicatorPill } from '../components/voice/ModifyIndicatorPill';
import { type ReaskReason } from '../components/voice/ReaskCue';
import { VoiceHero } from '../components/voice/VoiceHero';
import { PersistErrorBanner } from '../components/voice/PersistErrorBanner';
import { StoppingState } from '../components/voice/StoppingState';
import type { Column } from '../types';

export function VoiceScreen() {
  const s = useSettingsStore();
  const sess = useSessionStore();
  const voiceSession = useVoiceSession();
  // v0.23.0 입력탭#3(쿨다운 피드백, Vance) — 재연결 버튼 탭 후 audioRecorder의 RECOVER_COOLDOWN_MS
  //   (~3s) 동안 두 번째 탭이 무반응처럼 보이던 문제. 탭 즉시 로컬 "reconnecting" 상태를 켜고
  //   쿨다운 창 동안 버튼을 비활성+"재연결 중…" 스피너로 보인다. audioRecorder 로직(복구 타이밍)은
  //   건드리지 않고 UI 상태만 반영한다(도메인 경계 보존). 창은 3s 후 자동 해제.
  const [reconnecting, setReconnecting] = useState(false);

  // 최종 저장이 끝나기 전 화면 잠금으로 브라우저가 얼면 stopping이 길어질 수 있으므로 종료 중도 유지.
  useWakeLock(
    sess.phase === 'active' || sess.phase === 'complete' || sess.phase === 'paused' || sess.phase === 'stopping',
  );

  // v0.25.0 기능2(WS-2) — 입력탭 진입(마운트) 시 마이크 prewarm(첫 클립 유실 완화). best-effort:
  //   실패/거부해도 start()의 init()이 재시도(폴백)하므로 회귀 없음. prewarmMic은 useVoiceSession의
  //   useCallback([])라 안정 참조 → 마운트당 정확히 1회 발동(탭 진입=마운트, App.tsx 조건부 렌더).
  useEffect(() => { void voiceSession.prewarmMic(); }, [voiceSession.prewarmMic]);

  const totalRows = s.tableGenerated ? computeTotalRows(s.columns) : 0;
  const voiceCols = s.columns.filter((c) => c.input === 'voice');
  const currentCol = voiceCols[sess.activeColIdx] || voiceCols[0] || s.columns[0];

  if (sess.phase === 'ready') {
    return (
      <ReadyState
        totalRows={totalRows}
        onStart={async () => {
          // v0.22.0 — 세션명 우선순위(SSOT, 설정탭 prospectiveSessionLabel과 동일):
          //   자유입력(sessionCustomLabel) > 저장된 sessionAutoLabel > 자동 디폴트(buildAutoLabel).
          //   설정탭이 생성 시 sessionAutoLabel을 효과 라벨로 채우지만, 미생성/미편집 상태에서도
          //   같은 결과가 나도록 자유입력을 명시적으로 최우선에 둔다.
          const label = (s.sessionCustomLabel ?? '').trim() || s.sessionAutoLabel || buildAutoLabel(s.columns);
          await voiceSession.start(label);
          await lockPortrait();
        }}
      />
    );
  }

  if (sess.phase === 'stopping') {
    return (
      <>
        <StoppingState />
        {sess.persistError && (
          <PersistErrorBanner
            retrying={sess.persistError.retrying}
            onRetry={() => { void voiceSession.retryFinalPersist(); }}
          />
        )}
      </>
    );
  }

  // v0.34.0 B8 — 글로우 톤 파생 SSOT(여기 1곳). ActiveState의 칩/진행색 파생(chipAccent/
  //   progressAccent)과 같은 신호를 쓰되, anomalyPending은 여기서 한 번만 계산해 prop으로 내린다
  //   (파생 중복 방지). 우선순위: 이상치/마이크 소실(red) > 일시정지(amber) > 입력 중(green).
  const anomalyPending = !!sess.anomalyAlert && sess.anomalyAlert.status !== 'corrected';
  const glowTone: GlowTone =
    anomalyPending || voiceSession.micLost ? 'red' : sess.phase === 'paused' ? 'amber' : 'green';
  const sessionLive =
    sess.phase === 'active' || sess.phase === 'paused' || sess.phase === 'complete';
  // v0.35.0 R2-FIX-5 — 루트 완료 플래시(flash-green) reduced-motion 판정.
  const rootReduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        // v0.35.0 R2-FIX-5(리뷰 라운드2) — 루트 완료 플래시도 reduced-motion 존중(FIX-6은 VoiceHero만
        //   처리해 루트를 놓쳤다). EdgeGlow·VoiceWaveform·VoiceHero와 동일 계약.
        animation: sess.phase === 'complete' && !rootReduced ? 'flash-green 600ms ease-out' : 'none',
      }}
    >
      {/* v0.34.0 B8 — 화면 외곽 상태 글로우. 루트(position:relative) 직하 absolute inset:0,
          pointer-events:none·zIndex 54(팝업/시트 55-60 아래). 세션 비활성 시 미렌더(no-op). */}
      {/* v0.35.0 FB-B(Vance) — EdgeGlow의 레벨 rAF는 입력 중(phase 'active')일 때만 돈다.
          일시정지·완료(paused/complete)엔 발화가 없으므로 levelActive=false로 rAF를 멈춰 배터리를
          아끼고, 글로우는 정적 baseline으로 톤만 표시한다. */}
      {sessionLive && (
        <EdgeGlow
          tone={glowTone}
          getLevel={voiceSession.getAudioLevel}
          levelActive={sess.phase === 'active'}
        />
      )}
      <ActiveState
        totalRows={totalRows}
        columns={s.columns}
        voiceCols={voiceCols}
        currentColId={currentCol?.id}
        completing={sess.phase === 'complete'}
        paused={sess.phase === 'paused'}
        anomalyPending={anomalyPending}
        getAudioLevel={voiceSession.getAudioLevel}
        getTimeDomainData={voiceSession.getTimeDomainData}
        reaskReason={(sess.reaskReason ?? null) as ReaskReason}
        onEnd={() => voiceSession.stop()}
        onRestartFromCol={(id) => voiceSession.restartFromCol(id)}
        onJumpToRow={(r) => voiceSession.jumpToRow(r)}
        onPrevRow={() => voiceSession.gotoAdjacentRow(-1)}
        onNextRow={() => voiceSession.goNextRow()}
        onTouchCommit={(r, colId, v) => voiceSession.commitTouchValue(r, colId, v)}
        onManualCommit={(r, colId, v) => voiceSession.commitManualValue(r, colId, v)}
        onManualOpen={() => voiceSession.suspendRecognitionForUi('manual_input')}
        onManualClose={() => voiceSession.resumeRecognitionForUi('manual_input')}
        onAnomalyConfirm={() => voiceSession.confirmAnomalyTouch()}
        onAnomalyModify={() => voiceSession.modifyAnomalyTouch()}
        onManualAnomalyConfirm={() => voiceSession.confirmManualAnomaly()}
        onManualAnomalyModify={() => voiceSession.modifyManualAnomaly()}
        onCommandHelpOpen={() => voiceSession.suspendRecognitionForUi('command_help')}
        onCommandHelpClose={() => voiceSession.resumeRecognitionForUi('command_help')}
        // v0.35.0 R2-FIX-2(리뷰 라운드2, Pro High·데이터무결성) — 종료 확인 다이얼로그 동안 STT 정지.
        //   완료 상태에선 '종료' 음성명령 대기로 인식기가 살아 있어, 다이얼로그가 떠 있는 동안 배경
        //   음성이 파싱돼 엉뚱한 커밋/행이동이 될 수 있었다(manual_input·command_help와 동일 배선).
        //   취소로 닫을 때만 resume — 확인 경로는 stop()이 어차피 인식기를 정지시킨다.
        onExitConfirmOpen={() => voiceSession.suspendRecognitionForUi('exit_confirm')}
        onExitConfirmCancel={() => voiceSession.resumeRecognitionForUi('exit_confirm')}
        onTogglePause={() => {
          if (sess.phase === 'paused') voiceSession.resume();
          else voiceSession.pause();
        }}
      />
      {/* v0.22.0 P0(UI) — 마이크 재연결 배너. 클립 마이크가 죽어 사용자 제스처로 재획득이 필요할 때만
          (sess.micLost===true) 노출. 장갑·원거리 현장 고려해 화면 상단 가로 폭 전체·큰 터치 타깃의
          눈에 띄는 RED 배너로 띄운다. 평소(micLost=false)엔 숨김. Mack이 useVoiceSession에 micLost/
          reconnectMic를 추가하기 전엔 타입 에러가 날 수 있다(통합 전 예상치 — Larry가 최종 tsc 검증). */}
      <MicReconnectBanner
        micLost={voiceSession.micLost}
        reconnecting={reconnecting}
        onReconnect={() => {
          // v0.23.0 입력탭#3 — 쿨다운 동안 UI를 잠가 더블탭 무반응 오인 방지. 실제 재연결 로직은
          //   voiceSession.reconnectMic()(audioRecorder, ~3s RECOVER_COOLDOWN_MS) — 타이밍 무수정.
          //   3s(=쿨다운 길이) 동안 reconnecting=true. 성공해 micLost가 false로 바뀌면 배너 자체가
          //   언마운트되며 타이머는 effect cleanup이 정리한다(setState-after-unmount 방지).
          if (reconnecting) return;
          setReconnecting(true);
          voiceSession.reconnectMic();
        }}
        onCooldownEnd={() => setReconnecting(false)}
      />
      {/* v0.35.0 R3-FIX-2(리뷰 라운드3) — 최종 저장 실패 모달. stop()의 persistSession()이 false를
          반환하면 phase가 'ready'로 내려가지 않아(=이 화면 유지) 사용자가 "종료가 왜 안 되지"로
          남는다. 그 사유를 명시하고 [다시 저장]만 제공한다. persistError=null이면 미렌더. */}
      {sess.persistError && (
        <PersistErrorBanner
          retrying={sess.persistError.retrying}
          onRetry={() => { void voiceSession.retryFinalPersist(); }}
        />
      )}
    </div>
  );
}

/** v0.22.0 P0(UI) — "마이크 재연결" 배너. 클립 마이크가 죽어(블루투스 끊김·OS 인터럽션 등) 사용자
 *  제스처로 재획득해야 할 때만(micLost) 화면 상단에 띄운다. 장갑·원거리·소음 현장 기준:
 *   - 화면 가로 폭 전체를 쓰는 RED 배너(주변 톤과 확실히 구분 — 이상치 RED와 달리 상단 고정).
 *   - 버튼은 큰 터치 타깃(min 56px 높이)·큰 글자(18px)·명확한 라벨("마이크 재연결").
 *   - 기존 토큰(T.red/T.card)·safe-area 패턴(PausedCard와 동일) 재사용.
 *  micLost=false면 아무것도 렌더하지 않는다. 버튼 탭 → onReconnect(=sess.reconnectMic).
 *  v0.23.0 입력탭#3 — 쿨다운 피드백: reconnecting=true 동안 버튼을 비활성+스피너+"재연결 중…"으로
 *   바꿔, RECOVER_COOLDOWN_MS(~3s) 내 더블탭이 죽은 버튼처럼 보이던 문제를 없앤다. 탭 시 호출자가
 *   reconnecting을 켜고, 이 컴포넌트가 3s 타이머로 onCooldownEnd를 호출해 해제한다(언마운트 시
 *   cleanup으로 setState-after-unmount 방지 — micLost가 false로 바뀌면 배너 자체가 언마운트됨). */
function MicReconnectBanner({
  micLost, reconnecting, onReconnect, onCooldownEnd,
}: {
  micLost: boolean;
  reconnecting: boolean;
  onReconnect: () => void;
  onCooldownEnd: () => void;
}) {
  // 쿨다운 타이머: reconnecting이 켜지면 3s(=audioRecorder RECOVER_COOLDOWN_MS) 후 해제 콜백.
  //   ⚠️ deps는 [reconnecting]만 — onCooldownEnd를 deps에 넣으면 부모(VoiceScreen)가 confidence
  //   폴링(300ms)으로 매 렌더 새 함수 정체성을 주어, 타이머가 발화 전에 매번 리셋돼 "재연결 중…"이
  //   영영 안 풀리는 새 버그가 된다. onCooldownEnd는 안정 setter만 호출하므로 rising edge 캡처로 안전.
  //   언마운트(=micLost false로 배너 제거) 시 clearTimeout으로 정리(setState-after-unmount 방지).
  useEffect(() => {
    if (!reconnecting) return;
    const id = window.setTimeout(() => onCooldownEnd(), 3000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnecting]);

  if (!micLost) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60,
        display: 'flex', justifyContent: 'center',
        // safe-area(노치·상태바) 침범 방지 — standalone 설치형 대응(App.tsx/PausedCard 패턴).
        paddingTop: 'max(8px, var(--sat))',
        paddingLeft: 'max(10px, var(--sal))',
        paddingRight: 'max(10px, var(--sar))',
        pointerEvents: 'none', // 컨테이너는 통과, 내부 카드만 인터랙티브.
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          width: '100%', maxWidth: 560,
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', borderRadius: 16,
          background: 'rgba(34,18,18,0.97)', border: `2px solid ${T.red}`,
          boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
        }}
      >
        <span style={{ flexShrink: 0, display: 'flex', color: T.red }} aria-hidden>{I.mic(24, T.red)}</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontSize: 18, fontWeight: 900, color: T.red, letterSpacing: -0.3,
              wordBreak: 'keep-all', overflowWrap: 'anywhere', lineHeight: 1.2,
            }}
          >
            마이크 연결 끊김
          </span>
        </div>
        <button
          type="button"
          onClick={onReconnect}
          disabled={reconnecting}
          aria-busy={reconnecting}
          data-testid="mic-reconnect-btn"
          style={{
            flexShrink: 0,
            minHeight: 56, padding: '0 18px', borderRadius: 14,
            border: 'none', cursor: reconnecting ? 'wait' : 'pointer',
            background: reconnecting ? '#7a2e2e' : T.red, color: '#fff',
            opacity: reconnecting ? 0.85 : 1,
            fontSize: 18, fontWeight: 900, letterSpacing: -0.3,
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: reconnecting ? 'none' : '0 4px 14px rgba(255,82,82,0.4)',
          }}
          title={reconnecting ? '재연결 중…' : '재연결'}
        >
          {reconnecting ? (
            <>
              {/* spin 키프레임은 index.css 전역(다른 스피너와 공유). 없으면 정적 아이콘으로 폴백돼도 의미 전달. */}
              <span
                aria-hidden
                style={{
                  width: 20, height: 20, flexShrink: 0,
                  border: '3px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                  borderRadius: '50%', display: 'inline-block',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              재연결 중…
            </>
          ) : (
            <>재연결</>
          )}
        </button>
      </div>
    </div>
  );
}

/** v0.22.0 — 기본 세션 라벨. 설정탭(prospectiveSessionLabel)과 **동일한 SSOT**(sessionLabel.
 *  buildSessionLabel)로 통일했다. 이전 구현은 첫 고정값 하나만 집어(농가명 우선) 설정탭의
 *  "생성일 + 상수들 전부 join"과 형식이 어긋났다(SSOT 위반 근인). 이제 두 경로가 같은 결과를 낸다:
 *  `2026-06-25 강남호 A`(고정값 + 단일선택 options까지). 날짜·순환 컬럼은 헬퍼가 제외한다. */
function buildAutoLabel(columns: Column[]): string {
  return buildSessionLabel(columns);
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

        {/* v0.33.0 항목5 — 세션 시작 전 연결 3상태(Google/시트/과거값). 07-13 §4처럼 토큰이 만료된
            채 시작해 알람이 침묵하는 상황을 시작 카드에서 미리 보이게 한다(설정탭과 공용 컴포넌트). */}
        <div style={{ width: '100%', maxWidth: 320 }}>
          <ConnectionStatusCard />
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
// v0.23.0 입력탭#1 — heroFontSize는 components/voice/heroLayout 로 분리(ModifyIndicatorPill과 공유
//   SSOT — 그쪽이 직접 import). v0.34.0 A4 — hero가 '듣는 중' 전용이 되며 mono 값 표시가 사라져
//   이 파일에서는 더 이상 참조하지 않는다(heroLayout.ts 자체는 보존).

// ─── ACTIVE ───────────────────────────────────────────────────
function ActiveState({
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

function VoiceActionButton({
  label, title, tone, icon, onClick,
}: {
  label: string;
  title: string;
  tone: 'primary' | 'secondary' | 'danger';
  icon?: ReactNode;
  onClick: () => void;
}) {
  const primary = tone === 'primary';
  const danger = tone === 'danger';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: '100%',
        minWidth: 0,
        minHeight: 64,
        borderRadius: 18,
        border: danger ? `2px solid rgba(255,82,82,0.55)` : `1px solid ${primary ? 'transparent' : T.lineStrong}`,
        background: primary
          ? `linear-gradient(180deg, #5A9BFF 0%, ${T.blue} 58%, #1859D5 100%)`
          : danger
          ? 'rgba(255,82,82,0.08)'
          : T.card,
        color: danger ? T.red : primary ? '#fff' : T.textDim,
        fontSize: primary ? 22 : 18,
        fontWeight: 900,
        letterSpacing: -0.3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        cursor: 'pointer',
        boxShadow: primary ? `0 8px 28px ${T.blueGlow}` : 'none',
        touchAction: 'manipulation',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function ExitConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-confirm-title"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 55,
        background: 'rgba(0,0,0,0.68)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // v0.33.0 safe-area — fixed 오버레이라 App 셸 패딩 밖. 노치/홈인디케이터 침범 방지.
        //   Safari 탭에선 var(--sa*)=0 → 기존 20px 유지.
        paddingTop: 'max(20px, var(--sat))',
        paddingBottom: 'max(20px, var(--sab))',
        paddingLeft: 'max(20px, var(--sal))',
        paddingRight: 'max(20px, var(--sar))',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 420,
          borderRadius: 22,
          background: 'rgba(26,28,31,0.98)',
          border: `1px solid ${T.lineStrong}`,
          boxShadow: '0 18px 48px rgba(0,0,0,0.58)',
          padding: '22px 18px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <div
          id="exit-confirm-title"
          style={{
            textAlign: 'center',
            color: T.text,
            fontSize: 24,
            fontWeight: 900,
            letterSpacing: -0.4,
            lineHeight: 1.2,
          }}
        >
          입력을 종료할까요?
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(96px, 0.46fr)', gap: 14 }}>
          <VoiceActionButton label="계속 입력" title="계속 입력" tone="primary" onClick={onCancel} />
          <VoiceActionButton label="종료" title="종료 확인" tone="danger" onClick={onConfirm} />
        </div>
      </div>
    </div>
  );
}

/** v0.20.0 입력탭#1·#2 — 입력 컨트롤바: [인식 허용범위] · [안내 속도] 두 다이얼을 수평 배치.
 *  허용범위(recognitionTolerance) 0.40~0.90 → %로 표시. 속도(ttsRate) 0.5~2.0 → x로 표시·샘플 음성.
 *  두 다이얼은 375 폭에서도 한 줄에 들어가게 동일 flex(각 minWidth:0). */
function clampStep(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
}

function ActiveControlSteppers() {
  const s = useSettingsStore();
  const ttsDebounceRef = useRef<number | null>(null);
  const sampleTts = (rate: number) => {
    if (ttsDebounceRef.current !== null) window.clearTimeout(ttsDebounceRef.current);
    ttsDebounceRef.current = window.setTimeout(() => {
      void speak('이 속도로 안내합니다.', { interrupt: true, rate });
      // v0.33.0 B-5 — ttsRate 스탭퍼 변경 로깅(이전엔 무로깅). 샘플 TTS와 같은 디바운스 창에서
      // 최종값만 1회 기록해 연타가 링버퍼(2000)를 잠식하지 않게 한다.
      logger.log({ type: 'app', extra: `setting_changed:ttsRate=${rate}` });
    }, 350);
  };
  // v0.33.0 B-6 — recognitionTolerance 로깅 디바운스(이전엔 탭마다 즉시 로깅 → 연타 시 링버퍼 잠식).
  // ttsDebounceRef와 동일 패턴·동일 350ms 창, 최종값만 기록.
  const tolLogDebounceRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const setTolerance = (next: number) => {
    const value = clampStep(next, 0.4, 0.9);
    s.set({ recognitionTolerance: value });
    if (tolLogDebounceRef.current !== null) window.clearTimeout(tolLogDebounceRef.current);
    tolLogDebounceRef.current = window.setTimeout(() => {
      logger.log({ type: 'app', extra: `setting_changed:recognitionTolerance=${value}` });
    }, 350);
  };
  const setTtsRate = (next: number) => {
    const value = clampStep(next, 0.5, 2);
    s.set({ ttsRate: value });
    sampleTts(value);
  };
  const tolPct = Math.round(s.recognitionTolerance * 100);
  const summary = `입력 조절 · 인식 ${tolPct}% · 안내 ${s.ttsRate.toFixed(2)}x`;
  return (
    <div
      data-testid="input-control-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <button
        type="button"
        data-testid="input-control-toggle"
        aria-expanded={open}
        onClick={() => {
          // v0.33.0 B-7 — 입력 조절 패널 열림/닫힘 계측(ui_suspend/ui_resume의 command 컨벤션).
          // updater 밖에서 로깅(StrictMode의 updater 중복 호출로 이벤트가 2배로 찍히지 않게).
          logger.log({ type: 'command', parsed: open ? 'ui_close' : 'ui_open', extra: 'input_control_panel' });
          setOpen((v) => !v);
        }}
        style={{
          minHeight: 42,
          borderRadius: 14,
          border: `1px solid ${T.lineStrong}`,
          background: T.card,
          color: T.textDim,
          fontSize: 14,
          fontWeight: 850,
          letterSpacing: -0.2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          cursor: 'pointer',
          touchAction: 'manipulation',
        }}
        title="입력 조절"
      >
        <span>{summary}</span>
        <span aria-hidden style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>⌄</span>
      </button>
      {open && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <StepperControl
            testId="stepper-tolerance"
            label="인식"
            value={`${tolPct}%`}
            detail="높을수록 엄격"
            accent={T.green}
            minusLabel="인식 기준 낮추기"
            plusLabel="인식 기준 높이기"
            canMinus={s.recognitionTolerance > 0.4}
            canPlus={s.recognitionTolerance < 0.9}
            onMinus={() => setTolerance(s.recognitionTolerance - 0.05)}
            onPlus={() => setTolerance(s.recognitionTolerance + 0.05)}
          />
          <StepperControl
            testId="stepper-tts-rate"
            label="안내"
            value={`${s.ttsRate.toFixed(2)}x`}
            detail="음성 속도"
            accent={T.blue}
            minusLabel="음성 안내 속도 낮추기"
            plusLabel="음성 안내 속도 높이기"
            canMinus={s.ttsRate > 0.5}
            canPlus={s.ttsRate < 2}
            onMinus={() => setTtsRate(s.ttsRate - 0.05)}
            onPlus={() => setTtsRate(s.ttsRate + 0.05)}
          />
        </div>
      )}
    </div>
  );
}

function StepperControl({
  testId, label, value, detail, accent, minusLabel, plusLabel, canMinus, canPlus, onMinus, onPlus,
}: {
  testId: string;
  label: string;
  value: string;
  detail: string;
  accent: string;
  minusLabel: string;
  plusLabel: string;
  canMinus: boolean;
  canPlus: boolean;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        minWidth: 0,
        borderRadius: 16,
        border: `1px solid ${T.lineStrong}`,
        background: 'rgba(255,255,255,0.035)',
        padding: 8,
        display: 'grid',
        gridTemplateColumns: '48px minmax(0, 1fr) 48px',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <StepperButton label="−" title={minusLabel} disabled={!canMinus} onClick={onMinus} testId={`${testId}-minus`} />
      <div style={{ minWidth: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 12, color: T.textMute, fontWeight: 800, lineHeight: 1 }}>{label}</span>
        <span style={{ fontSize: 20, color: accent, fontWeight: 950, lineHeight: 1.15, fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
          {value}
        </span>
        <span style={{ fontSize: 10, color: T.textMute, fontWeight: 650, lineHeight: 1.2, whiteSpace: 'nowrap' }}>{detail}</span>
      </div>
      <StepperButton label="+" title={plusLabel} disabled={!canPlus} onClick={onPlus} testId={`${testId}-plus`} />
    </div>
  );
}

function StepperButton({
  label, title, disabled, onClick, testId,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 48,
        height: 48,
        borderRadius: 14,
        border: `1px solid ${T.lineStrong}`,
        background: disabled ? 'rgba(255,255,255,0.025)' : T.card,
        color: disabled ? T.textMute : T.text,
        fontSize: 26,
        fontWeight: 950,
        lineHeight: 1,
        cursor: disabled ? 'default' : 'pointer',
        touchAction: 'manipulation',
      }}
    >
      {label}
    </button>
  );
}

// ─── A-hero → components/voice/VoiceHero.tsx로 추출(v0.35.0, Vance). 3-상태 카드(대기: 항목+파형 / 확인: ✓+값 / 검토: N행 완료). HeroStatusLine·HeroPrimaryLine·HERO_PANEL도 이전.

// ─── chip with optional inline edit ────────────────────────────
function ColumnChip({
  col, value, isActive, activeTone, isDone, isEditing, onActivate, onCommit, onCancel, containerRef, compact = false,
}: {
  col: Column;
  value: string;
  isActive: boolean;
  activeTone: string;
  isDone: boolean;
  isEditing: boolean;
  onActivate: () => void;
  onCommit: (v: string) => void;
  onCancel: () => void;
  compact?: boolean;
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

  const isDate = col.type === 'date';
  // v0.33.0 항목6 — 음성 date 컬럼은 수동 입력 시트(date input)로 편집 가능해야 하므로 클릭 허용.
  // auto date 칩은 기존대로 비클릭(인라인 편집 미지원).
  const clickable = !isDate || col.input === 'voice';

  let bg: string = 'rgba(255,255,255,0.05)';
  let border: string = 'transparent';
  let textColor: string = T.textDim;
  if (isActive) {
    const redActive = activeTone === T.red;
    bg = redActive ? 'rgba(255,82,82,0.16)' : 'rgba(0,200,83,0.18)';
    border = activeTone;
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
      data-testid="column-chip"
      data-active={isActive ? 'true' : 'false'}
      data-col-name={col.name}
      onClick={() => { if (clickable && !isEditing) onActivate(); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
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
        flex: compact ? '0 0 clamp(180px, 48vw, 260px)' : undefined,
        scrollSnapAlign: compact ? 'start' : undefined,
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
      <span
        style={{
          color: isActive ? activeTone : T.textMute,
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
