import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { computeTotalRows } from '../lib/autoValue';
import { useWakeLock, lockPortrait } from '../lib/wakeLock';
import {
  useVoiceSession,
  type VoiceRuntimeSnapshot,
  type VoiceTrackState,
} from '../lib/useVoiceSession';
import { buildSessionLabel } from '../lib/sessionLabel';
import { EdgeGlow, type GlowTone } from '../components/voice/EdgeGlow';
import { type ReaskReason } from '../components/voice/ReaskCue';
import { PersistErrorBanner } from '../components/voice/PersistErrorBanner';
import { StoppingState } from '../components/voice/StoppingState';
import { ReadyState } from '../components/voice/ReadyState';
import { ActiveState } from '../components/voice/ActiveState';
import { MicReconnectBanner } from '../components/voice/MicReconnectBanner';

/** App.tsx ↔ useVoiceSession 브리지. VoiceScreen은 세션 훅을 소유하지만 `visibilitychange`는
 *  문서 단위라 App.tsx가 듣는다 — 그 사이를 잇는 유일한 채널이다.
 *
 *  ⚠️ 이름은 `Readers`지만 v0.43.0 #4부터 **조치 2건**이 함께 탄다. 이름을 바꾸지 않은 것은
 *  의도적이다: v0.43.0 UI 재설계 레인이 같은 파일들을 동시에 만지고 있어 광범위 rename이
 *  충돌을 만든다. 새 채널을 파지 않는 것도 같은 이유다(브리지는 하나로 유지). */
export interface VoiceTelemetryReaders {
  getTrackState: () => VoiceTrackState;
  getRuntimeSnapshot: () => VoiceRuntimeSnapshot;
  /** #4 — `hidden` 진입: STT·클립 중지 + 마이크 캡처 off. */
  suspendForBackground: () => void;
  /** #4 — `visible` 복귀: 캡처 on + STT 복원(복원 성공 시 음성 안내 1회). */
  resumeFromBackground: () => void;
}

export function VoiceScreen(props: {
  onTelemetryReadersChange?: (readers: VoiceTelemetryReaders | null) => void;
}) {
  const s = useSettingsStore();
  // interimValue는 VoiceHero가 직접 구독한다. 화면 루트가 전체 store를 구독하면 interim 한 조각마다
  // ActiveState/칩 전체가 다시 렌더되므로, 이 화면이 실제로 쓰는 수명주기 필드만 고정 구독한다.
  const sess = useSessionStore(useShallow((st) => ({
    phase: st.phase,
    endReached: st.endReached,
    activeColIdx: st.activeColIdx,
    anomalyAlert: st.anomalyAlert,
    reaskReason: st.reaskReason,
    persistError: st.persistError,
    // v0.44.0 §C4(F12) — 수정모드가 amber 톤을 갖는다. 톤 파생 SSOT(아래 glowTone)의 입력.
    modifyIndicator: st.modifyIndicator,
  })));
  const voiceSession = useVoiceSession();
  useEffect(() => {
    props.onTelemetryReadersChange?.({
      getTrackState: voiceSession.getTrackState,
      getRuntimeSnapshot: voiceSession.getRuntimeSnapshot,
      suspendForBackground: voiceSession.suspendForBackground,
      resumeFromBackground: voiceSession.resumeFromBackground,
    });
    return () => props.onTelemetryReadersChange?.(null);
  }, [
    props.onTelemetryReadersChange,
    voiceSession.getRuntimeSnapshot,
    voiceSession.getTrackState,
    voiceSession.suspendForBackground,
    voiceSession.resumeFromBackground,
  ]);
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

  const activeColumns = voiceSession.sessionColumns ?? s.columns;
  const totalRows = sess.phase === 'ready'
    ? (s.tableGenerated ? computeTotalRows(s.columns) : 0)
    : computeTotalRows(activeColumns);
  const voiceCols = activeColumns.filter((c) => c.input === 'voice');
  const currentCol = voiceCols[sess.activeColIdx] || voiceCols[0] || activeColumns[0];

  if (sess.phase === 'ready') {
    return (
      <ReadyState
        totalRows={totalRows}
        onStart={async () => {
          // v0.22.0 — 세션명 우선순위(SSOT, 설정탭 prospectiveSessionLabel과 동일):
          //   자유입력(sessionCustomLabel) > 저장된 sessionAutoLabel > 자동 디폴트(buildSessionLabel).
          //   설정탭이 생성 시 sessionAutoLabel을 효과 라벨로 채우지만, 미생성/미편집 상태에서도
          //   같은 결과가 나도록 자유입력을 명시적으로 최우선에 둔다.
          const label = (s.sessionCustomLabel ?? '').trim() || s.sessionAutoLabel || buildSessionLabel(s.columns);
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
  //   progressAccent)은 이 tone을 prop으로 받아 TONE_BASE로 색만 바꾼다(파생 중복 방지).
  //   v0.44.0 §C4(F12, 민구 확정 08-02): 일시정지 amber → **mono**(무채 점멸), amber는
  //   **수정모드**로 이동. 우선순위: 이상치/마이크 소실(red) > 일시정지(mono) > 수정(amber) > 입력 중(green).
  const anomalyPending = !!sess.anomalyAlert && sess.anomalyAlert.status !== 'corrected';
  const glowTone: GlowTone =
    anomalyPending || voiceSession.micLost ? 'red'
      : sess.phase === 'paused' ? 'mono'
        : sess.modifyIndicator ? 'amber'
          : 'green';
  const sessionLive =
    sess.phase === 'active' || sess.phase === 'paused' || sess.phase === 'complete';
  // v0.35.0 R2-FIX-5 — 루트 완료 플래시(flash-green) reduced-motion 판정.
  const rootReduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div
      // §C4 — 톤 점멸 CSS의 스코프 앵커(global.css `[data-voice-tone="mono"] …`). 오라클도 이걸 읽는다.
      data-voice-tone={glowTone}
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
      {/* v0.35.0 FB-B → v0.36.0 리뷰 라운드1(Codex, 수용) — 레벨 rAF 활성 기준은 phase가 아니라
          **실제 청취 상태**다: complete(검토 대기)에서도 STT는 종료/수정/이동 명령을 계속 듣고
          있으므로 파형·글로우가 죽으면 "안 듣는다"로 오인된다. active+complete 활성, paused만
          정지(발화 없음 — 배터리 보호 + 정적 baseline 톤 표시). */}
      {sessionLive && (
        <EdgeGlow
          tone={glowTone}
          getLevel={voiceSession.getAudioLevel}
          levelActive={sess.phase === 'active' || sess.phase === 'complete'}
        />
      )}
      <ActiveState
        totalRows={totalRows}
        columns={activeColumns}
        voiceCols={voiceCols}
        currentColId={currentCol?.id}
        completing={sess.phase === 'complete'}
        // 와이어프레임 §[4] — phase 'complete'는 완료 행 **검토 대기**와 **끝 도달**을 겸한다.
        //   검토 대기는 [1] active 레이아웃(hero ✓+방금값 — v035-hero-confirm 동작 계약)을 쓰고,
        //   끝 도달만 complete(UI-c: 시각 상태어 없는 `X / N` + 종료)를 쓴다.
        endReached={sess.phase === 'complete' && sess.endReached}
        paused={sess.phase === 'paused'}
        anomalyPending={anomalyPending}
        tone={glowTone}
        getAudioLevel={voiceSession.getAudioLevel}
        getTimeDomainData={voiceSession.getTimeDomainData}
        reaskReason={(sess.reaskReason ?? null) as ReaskReason}
        uiCommand={voiceSession.uiCommand}
        onEnd={() => voiceSession.stop()}
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
        // v0.35.0 R2-FIX-2(리뷰 라운드2, Pro High·데이터무결성) — 저장확인 인라인 동안 STT 정지.
        //   완료 상태에선 '종료' 음성명령 대기로 인식기가 살아 있어, 저장확인 상태 동안 배경
        //   음성이 파싱돼 엉뚱한 커밋/행이동이 될 수 있었다(manual_input·command_help와 동일 배선).
        //   취소로 닫을 때만 resume — 확인 경로는 stop()이 어차피 인식기를 정지시킨다.
        onExitConfirmOpen={() => voiceSession.suspendRecognitionForUi('exit_confirm')}
        onExitConfirmCancel={() => voiceSession.resumeRecognitionForUi('exit_confirm')}
        onTogglePause={() => {
          if (sess.phase === 'paused') voiceSession.resume();
          else voiceSession.pause();
        }}
      />
      {/* v0.38.0 #5 — micLost 전이의 자동 1회 복구가 실패한 뒤에만 수동 재연결 배너를 노출한다. */}
      <MicReconnectBanner
        micLost={voiceSession.micReconnectFallbackVisible}
        reconnecting={reconnecting}
        onReconnect={() => {
          // v0.23.0 입력탭#3 — 쿨다운 동안 UI를 잠가 더블탭 무반응 오인 방지. 실제 재연결 로직은
          //   voiceSession.reconnectMic()(audioRecorder, ~3s RECOVER_COOLDOWN_MS) — 타이밍 무수정.
          //   3s(=쿨다운 길이) 동안 reconnecting=true. 성공해 micLost가 false로 바뀌면 배너 자체가
          //   언마운트되며 타이머는 effect cleanup이 정리한다(setState-after-unmount 방지).
          if (reconnecting) return;
          setReconnecting(true);
          void voiceSession.reconnectMic({ userGesture: true });
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
