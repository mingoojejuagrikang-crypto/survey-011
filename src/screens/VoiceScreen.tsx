import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { computeTotalRows } from '../lib/autoValue';
import { useWakeLock, lockPortrait } from '../lib/wakeLock';
import { useVoiceSession } from '../lib/useVoiceSession';
import { buildSessionLabel } from '../lib/sessionLabel';
import { EdgeGlow, type GlowTone } from '../components/voice/EdgeGlow';
import { type ReaskReason } from '../components/voice/ReaskCue';
import { PersistErrorBanner } from '../components/voice/PersistErrorBanner';
import { StoppingState } from '../components/voice/StoppingState';
import { ReadyState } from '../components/voice/ReadyState';
import { ActiveState } from '../components/voice/ActiveState';
import { MicReconnectBanner } from '../components/voice/MicReconnectBanner';

export function VoiceScreen() {
  const s = useSettingsStore();
  // interimValue는 VoiceHero가 직접 구독한다. 화면 루트가 전체 store를 구독하면 interim 한 조각마다
  // ActiveState/칩 전체가 다시 렌더되므로, 이 화면이 실제로 쓰는 수명주기 필드만 고정 구독한다.
  const sess = useSessionStore(useShallow((st) => ({
    phase: st.phase,
    activeColIdx: st.activeColIdx,
    anomalyAlert: st.anomalyAlert,
    reaskReason: st.reaskReason,
    persistError: st.persistError,
  })));
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
        columns={s.columns}
        voiceCols={voiceCols}
        currentColId={currentCol?.id}
        completing={sess.phase === 'complete'}
        paused={sess.phase === 'paused'}
        anomalyPending={anomalyPending}
        tone={glowTone}
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
