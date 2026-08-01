import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { T } from '../../tokens';
import type { GlowTone } from './EdgeGlow';
import { ActiveControlSteppers } from './ActiveControlSteppers';
import { StateIndicator } from './StateIndicator';
import type { DotGlyph } from './StateDots';
import type { VoiceUiCommandSignal } from '../../lib/voiceCommands';
import { CONTROL_ROW_FRACTION } from './heroLayout';

/** ui-standard §2·§3 — **하단 30%**(v0.43.0 UI-b에서 25→30).
 *
 * ```
 * |              . . .                     (대기: 도트 마이크)
 * |       [‹] [⏹] [⏸] [›]
 * |       인식률 45% / 안내 1.15x
 * ```
 *  - normal/paused/complete는 같은 4버튼 `[‹][⏹][⏸][›]`를 유지한다.
 *  - 알람은 해결 전 탐색을 허용하지 않으므로 확인/수정 2버튼을 유지한다(ui-standard §3-2).
 *  - 상태별 **도트 인디케이터** → 음성 입력 시 **역동 세로파형**(StateIndicator).
 *  - 그 아래 옵션(인식률/안내)을 **얇게**(ActiveControlSteppers, 기본 접힘).
 *  - `title`/`aria-label`은 토글 상태에 따라 `일시정지`/`재시작`으로 바뀐다. */
export type EdgeMode = 'nav' | 'anomaly' | 'paused';

export function ActiveControlBar({
  tone, mode, glyph, indicatorInteractive, indicatorExit, waveActive,
  getAudioLevel, getTimeDomainData, uiCommand,
  onPrevRow, onNextRow, onTogglePause, onExit, onAnomalyConfirm, onAnomalyModify,
}: {
  /** 상태 톤(VoiceScreen SSOT) — 도트·파형 색이 엣지글로우와 함께 상태를 말한다. */
  tone: GlowTone;
  /** 행동행 구성 전환. anomaly만 확인/수정 2버튼 예외다. */
  mode: EdgeMode;
  glyph: DotGlyph;
  /** 알람 중 인디케이터의 일시정지 터치 경로. */
  indicatorInteractive: boolean;
  /** [EXIT-PERSIST-1] 끝 도달 뒤 하단 종료 버튼에 영속 상태 셀렉터를 부여한다. */
  indicatorExit: boolean;
  waveActive: boolean;
  getAudioLevel: () => number;
  getTimeDomainData: (out: Uint8Array) => boolean;
  uiCommand: VoiceUiCommandSignal | null;
  onPrevRow: () => void;
  onNextRow: () => void;
  onTogglePause: () => void;
  onExit: () => void;
  onAnomalyConfirm: () => void;
  onAnomalyModify: () => void;
}) {
  // 조절판 확장 상태를 여기서 소유한다 — 열리면 인디케이터·행동 행을 숨겨야 하므로.
  const [controlsOpen, setControlsOpen] = useState(false);
  const controlsExpandable = mode === 'nav';
  // C3 — 열린 조절판 뒤에서 필수 행동 행이 사라지지 않게 상태 역할이 바뀌는 즉시 접는다.
  // ActiveState/VoiceScreen 트리는 그대로 두고 이 로컬 표시 상태만 바꾼다([STT-16]).
  useEffect(() => {
    if (!controlsExpandable) setControlsOpen(false);
  }, [controlsExpandable]);
  // effect 전 한 프레임에도 필수 행동 행이 가려지지 않도록 렌더값은 mode로 함께 제한한다.
  const panelOpen = controlsExpandable && controlsOpen;
  return (
    <div
      data-testid="voice-control-bar"
      style={{
        borderTop: `1px solid ${T.line}`,
        height: '100%', minHeight: 0,
        // 🔴 v0.43.0 UI-b CSS 방어 2/3 — 배정 트랙 밖으로 그리지 않는다(ui-standard §6 · GL-007).
        //   ActiveState의 그리드 자식 4개 중 **여기만 방어가 없었다**(ChipZone·CenterStage는 있다).
        //   하단이 25→30%가 됐고 UI-e에서 4행 키패드가 들어올 자리라, 넘치면 아래 탭바를 덮는다.
        //   목표는 정확성이 아니라 **틀려도 영역을 못 넘게** 하는 것 — 잘리면 눈에 띈다.
        //   🟢 UI-a 함정 1(`overflow:hidden`이 `min-height:auto`를 0으로 만들어 fit 무력화)의
        //      사정권이 아니다: 이 컴포넌트는 `useFitScale`·`useFitGroup`을 쓰지 않는다.
        //      **fit이 사는 CenterStage 경계에는 새로 붙이지 않았다.**
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column', gap: 2,
        padding: '0 12px 2px',
      }}
    >
      {/* 🔴 조절판이 열리면 이 행을 **통째로 숨긴다**(민구 확정 2026-07-27).
          fb-27-5(겹침) + fb-27-6(오탭)을 한 번에 없앤다 — 겹칠 상자가 존재하지 않으므로
          "91px 도트가 40.75px 밴드를 넘쳐 토글 위에 그려지고, 그 도트가 곧 일시정지 버튼이라
          오탭된다"는 경로가 **구조적으로 불가능**해진다(실기기 오터치 4회의 원인).
          ⚠️ `maxHeight`나 `pointer-events:none`으로 때우지 마라 — 자식 overflow를 못 막고,
             겹침이 남으면 `<` `>`도 같은 위험에 노출된다. 접히면 그대로 돌아온다. */}
      {!panelOpen && (
        <>
            <div
              data-testid="voice-indicator-row"
              style={{
                flex: '1 1 0', minHeight: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <StateIndicator
                glyph={glyph}
                tone={tone}
                waveActive={waveActive}
                levelActive={waveActive}
                getAudioLevel={getAudioLevel}
                getTimeDomainData={getTimeDomainData}
                control={
                  mode === 'anomaly' && indicatorInteractive
                    ? {
                        title: '일시정지',
                        label: '일시정지',
                        status: 'alert',
                        onClick: onTogglePause,
                      }
                    : undefined
                }
              />
            </div>

            <div
              data-testid="voice-nav-row"
              style={{
                flex: `0 0 ${CONTROL_ROW_FRACTION * 100}%`, minHeight: 44,
                display: 'grid',
                gridTemplateColumns: mode === 'anomaly'
                  ? 'repeat(2, minmax(0, 1fr))'
                  : 'repeat(4, minmax(0, 1fr))',
                alignItems: 'stretch', gap: 8,
              }}
            >
              {mode === 'anomaly' ? (
                <>
                  <EdgeButton kind="text" testId="anomaly-confirm-btn" label="확인" title="확인" onClick={onAnomalyConfirm} />
                  <EdgeButton kind="text" testId="anomaly-modify-btn" label="수정" title="수정" onClick={onAnomalyModify} accent={T.red} accentBg={T.redGlowFaint} />
                </>
              ) : (
                <>
                  <EdgeButton kind="icon" testId="voice-control-prev" label="이전" title="이전 행으로 이동" onClick={onPrevRow} icon="‹" />
                  <EdgeButton
                    kind="icon"
                    testId={indicatorExit ? 'voice-status-control' : 'voice-control-stop'}
                    status={indicatorExit ? 'exit' : undefined}
                    tone={indicatorExit ? tone : undefined}
                    label="종료"
                    title="입력 종료"
                    onClick={onExit}
                    icon="⏹"
                    accent={T.red}
                    accentBg={T.redGlowFaint}
                  />
                  <EdgeButton
                    kind="icon"
                    testId={!indicatorExit && mode !== 'paused' ? 'voice-status-control' : 'voice-control-toggle-pause'}
                    status={!indicatorExit && mode !== 'paused' ? (tone === 'red' ? 'alert' : 'listening') : undefined}
                    tone={!indicatorExit && mode !== 'paused' ? tone : undefined}
                    label={mode === 'paused' ? '재시작' : '일시정지'}
                    title={mode === 'paused' ? '재시작' : '일시정지'}
                    onClick={onTogglePause}
                    icon="⏸"
                    accent={T.amber}
                    accentBg={T.amberGlowFaint}
                  />
                  <EdgeButton kind="icon" testId="voice-control-next" label="다음" title="다음 행으로 이동" onClick={onNextRow} icon="›" />
                </>
              )}
            </div>
        </>
      )}

      <ActiveControlSteppers
        uiCommand={uiCommand}
        open={panelOpen}
        canExpand={controlsExpandable}
        onOpenChange={setControlsOpen}
      />
    </div>
  );
}

/** 하단 행동 버튼. 높이는 10% 행동행이 정하고 44px 터치 하한만 사람이 정한다(GL-007 규칙 2). */
function EdgeButton({
  kind, label, title, onClick, icon, accent, accentBg, testId, status, tone,
}: {
  kind: 'icon' | 'text';
  label: string;
  title: string;
  onClick: () => void;
  icon?: ReactNode;
  /** 위험/상태 강조가 필요한 버튼(재시작=amber, 종료·수정=red)만 지정. 인라인 일회색 금지 — 토큰. */
  accent?: string;
  accentBg?: string;
  testId?: string;
  status?: string;
  tone?: GlowTone;
}) {
  const color = accent ?? T.textDim;
  return (
    <button
      type="button"
      data-testid={testId}
      data-status={status}
      data-tone={tone}
      onClick={onClick}
      title={title}
      aria-label={label}
      style={{
        width: '100%',
        minWidth: kind === 'text' ? 84 : 64,
        height: '100%',
        minHeight: 44,
        padding: 0,
        boxSizing: 'border-box',
        containerType: 'size',
        borderRadius: 16,
        border: `${accent ? 2 : 1}px solid ${accent ? accent : T.lineStrong}`,
        background: accentBg ?? T.card,
        color,
        fontSize: 'clamp(16px, 4.6vw, 20px)',
        fontWeight: 900,
        letterSpacing: -0.3,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', touchAction: 'manipulation',
      }}
    >
      {kind === 'icon' ? (
        <span
          data-testid="control-symbol"
          aria-hidden
          style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: `calc(50cqh + ${accent ? 2 : 1}px)`,
            lineHeight: 1,
          }}
        >
          {icon}
        </span>
      ) : label}
    </button>
  );
}
