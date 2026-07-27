import type { ReactNode } from 'react';
import { useState } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import type { GlowTone } from './EdgeGlow';
import { ActiveControlSteppers } from './ActiveControlSteppers';
import { StateIndicator } from './StateIndicator';
import type { DotGlyph } from './StateDots';
import type { VoiceUiCommandSignal } from '../../lib/voiceCommands';

/** 와이어프레임 §공통규칙5 — **하단 25%**.
 *
 * ```
 * | <            . . .            >        (대기: 도트 마이크)
 * |       인식률 45% / 안내 1.15x
 * ```
 *  - `<` `>`는 **양끝**에 두고 **상태별로 라벨·기능이 전환**된다:
 *      active/complete → `이전` / `다음` · anomaly → `확인` / `수정` · paused → `재시작` / `종료`
 *  - 가운데는 상태별 **도트 인디케이터** → 음성 입력 시 **역동 세로파형**(StateIndicator).
 *  - 그 아래 옵션(인식률/안내)을 **얇게**(ActiveControlSteppers, 기본 접힘).
 *
 *  🔴 와이어프레임 [1] active에는 일시정지 터치 버튼이 없다. 음성만으로 일시정지 가능한 상태를
 *  만들면 "화면 버튼과 동등" 계약이 깨지므로(HANDOFF 이월 [Medium] 항목과 같은 축) **인디케이터
 *  자체를 일시정지 컨트롤로 겸용**했다 — 자리를 새로 만들지 않으면서 터치 경로를 유지한다.
 *  단 §[4] complete에서는 인디케이터가 버튼이 아니다(그 상태의 유일한 행동은 중앙의 `종료`다). */
export type EdgeMode = 'nav' | 'anomaly' | 'paused';

export function ActiveControlBar({
  tone, mode, glyph, indicatorInteractive, waveActive,
  getAudioLevel, getTimeDomainData, uiCommand,
  onPrevRow, onNextRow, onTogglePause, onExit, onAnomalyConfirm, onAnomalyModify,
}: {
  /** 상태 톤(VoiceScreen SSOT) — 도트·파형 색이 엣지글로우와 함께 상태를 말한다. */
  tone: GlowTone;
  /** 양끝 버튼의 역할 전환(§공통규칙5 "상태별로 라벨·기능 전환"). */
  mode: EdgeMode;
  glyph: DotGlyph;
  /** false면 인디케이터가 표시 전용. 일시정지 상태에선 `<`가 이미 재개 버튼이라 인디케이터까지
   *  버튼으로 두면 같은 행동이 두 개가 되고(셀렉터 계약도 중복), 완료 상태에선 유일한 행동이
   *  중앙 `종료`다. 즉 인디케이터가 버튼인 상태는 **입력 중/이상치**뿐이다. */
  indicatorInteractive: boolean;
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
  // 조절판 확장 상태를 여기서 소유한다 — 열리면 인디케이터·`<`·`>` 행을 숨겨야 하므로.
  const [controlsOpen, setControlsOpen] = useState(false);
  return (
    <div
      data-testid="voice-control-bar"
      style={{
        borderTop: `1px solid ${T.line}`,
        height: '100%', minHeight: 0,
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '4px 12px 2px',
      }}
    >
      {/* 🔴 조절판이 열리면 이 행을 **통째로 숨긴다**(민구 확정 2026-07-27).
          fb-27-5(겹침) + fb-27-6(오탭)을 한 번에 없앤다 — 겹칠 상자가 존재하지 않으므로
          "91px 도트가 40.75px 밴드를 넘쳐 토글 위에 그려지고, 그 도트가 곧 일시정지 버튼이라
          오탭된다"는 경로가 **구조적으로 불가능**해진다(실기기 오터치 4회의 원인).
          ⚠️ `maxHeight`나 `pointer-events:none`으로 때우지 마라 — 자식 overflow를 못 막고,
             겹침이 남으면 `<` `>`도 같은 위험에 노출된다. 접히면 그대로 돌아온다. */}
      {!controlsOpen && (
      <div
        data-testid="voice-nav-row"
        style={{
          flex: '1 1 0', minHeight: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}
      >
        {/* 🔴 일시정지의 왼쪽 버튼 라벨은 **"재시작"**이다(민구 확정 2026-07-27). 파서는 건드리지 않는다.
            종전 라벨 "재개"는 음성 명령 어휘("재시작")와 달라, 화면을 보고 "재개"라고 말한 사용자의
            발화가 명령으로 잡히지 않았다(실기기 09:53:58 conf 0.561 미인식).
            귀로 외운 어휘를 바꾸는 대신 **화면을 어휘에 맞춘다** — 보이는 말과 하는 말이 같아야
            한다(PRINCIPLES §2 시각·청각 일치). aria-label(label)도 함께 맞춘다. */}
        {mode === 'paused' ? (
          <EdgeButton kind="text" label="재시작" title="재시작" onClick={onTogglePause} accent={T.amber} accentBg={T.amberGlowFaint} />
        ) : mode === 'anomaly' ? (
          <EdgeButton kind="text" testId="anomaly-confirm-btn" label="확인" title="확인" onClick={onAnomalyConfirm} />
        ) : (
          <EdgeButton kind="icon" label="이전" title="이전 행으로 이동" onClick={onPrevRow} icon={<PrevIcon />} />
        )}

        <StateIndicator
          glyph={glyph}
          tone={tone}
          waveActive={waveActive}
          levelActive={waveActive}
          getAudioLevel={getAudioLevel}
          getTimeDomainData={getTimeDomainData}
          control={
            indicatorInteractive
              ? { title: '일시정지', label: '일시정지', status: tone === 'red' ? 'alert' : 'listening', onClick: onTogglePause }
              : undefined
          }
        />

        {mode === 'paused' ? (
          <EdgeButton kind="text" label="종료" title="입력 종료" onClick={onExit} accent={T.red} accentBg={T.redGlowFaint} />
        ) : mode === 'anomaly' ? (
          <EdgeButton kind="text" testId="anomaly-modify-btn" label="수정" title="수정" onClick={onAnomalyModify} accent={T.red} accentBg={T.redGlowFaint} />
        ) : (
          <EdgeButton kind="icon" label="다음" title="다음 행으로 이동" onClick={onNextRow} icon={I.chevron(26, T.textDim)} />
        )}
      </div>
      )}

      <ActiveControlSteppers uiCommand={uiCommand} open={controlsOpen} onOpenChange={setControlsOpen} />
    </div>
  );
}

/** 양끝 버튼 — 아이콘형(`<` `>`)과 텍스트형(확인/수정/재시작/종료)이 같은 타깃 크기를 쓴다.
 *  장갑 조작(PRINCIPLES §2) 하한 44px보다 넉넉한 56px 높이를 유지하되, 하단 25%가 얇은 기기에서는
 *  트랙을 넘지 않도록 flex로 수축한다(최소 44px). */
function EdgeButton({
  kind, label, title, onClick, icon, accent, accentBg, testId,
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
}) {
  const color = accent ?? T.textDim;
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      title={title}
      aria-label={label}
      style={{
        flex: '0 0 auto',
        minWidth: kind === 'text' ? 84 : 64,
        height: 'min(100%, 56px)',
        minHeight: 44,
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
      {kind === 'icon' ? icon : label}
    </button>
  );
}

/** '이전' 버튼의 언어무관 좌향 화살표(I.chevron은 우향이라 180° 회전). */
function PrevIcon() {
  return (
    <span aria-hidden style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
      {I.chevron(26, T.textDim)}
    </span>
  );
}
