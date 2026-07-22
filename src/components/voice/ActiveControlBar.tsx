import type { ReactNode } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import type { GlowTone } from './EdgeGlow';
import { ActiveControlSteppers } from './ActiveControlSteppers';

/** v0.36.0 코덱스 시안(2026-07-20, 민구 확정) — 입력탭 하단 컨트롤바(표현 전용, §7.1).
 *  중앙 정렬 심볼 버튼: 이전 68×62 / 상태 심볼 88×72(상태색 채움) / 다음 68×62. 듣는 중=마이크,
 *  이상=알람, 일시정지=정지 심볼이며 페이드로 상태를 알린다. 버튼의 탭 동작은 기존 일시정지/재개,
 *  `title` 테스트 계약과 `aria-label` 동작 안내도 유지한다. 버튼 간 14px(장갑 조작).
 *
 *  종료 노출 정책 불변: 입력 중 숨김, paused/complete에서만 노출(오조작 방지).
 *  Steppers(입력 조절)는 기본 접힘 — `input-control-toggle` Y가 레이아웃 테스트의 기준점이므로
 *  모든 상태 분기의 버튼 행 높이(72px)를 동일하게 유지한다(v0.19.0 인변량). */
const TONE_FILL: Record<GlowTone, string> = { green: T.green, amber: T.amber, red: T.red };
// 리뷰 라운드1(Flash, 수용) — 채움 그림자는 hex-alpha 하드코딩(`${fill}55`) 대신 기존 glow 토큰.
const TONE_SHADOW: Record<GlowTone, string> = { green: T.greenGlow, amber: T.amberGlow, red: T.redGlow };
const STATUS_FADE_S: Record<GlowTone, number> = { green: 1.75, amber: 2.4, red: 0.7 };

type VoiceControlStatus = 'listening' | 'alert' | 'paused';

export function ActiveControlBar({
  tone, paused, completing, onPrevRow, onNextRow, onTogglePause, onExit,
}: {
  /** 상태 톤(VoiceScreen SSOT) — 중앙 버튼 채움색이 엣지글로우·파형과 함께 상태를 말한다. */
  tone: GlowTone;
  paused: boolean;
  completing: boolean;
  onPrevRow: () => void;
  onNextRow: () => void;
  onTogglePause: () => void;
  onExit: () => void;
}) {
  return (
    <div
      style={{
        borderTop: `1px solid ${T.line}`,
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: '8px 16px 6px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, minHeight: 72 }}>
        {paused ? (
          <>
            <StatusButton
              label="재개"
              title="재시작"
              tone="amber"
              status="paused"
              icon={I.stop(28, T.bg)}
              onClick={onTogglePause}
            />
            <ExitButton onExit={onExit} />
          </>
        ) : completing ? (
          <>
            <SideButton label="이전" title="이전 행으로 이동" icon={<PrevIcon />} onClick={onPrevRow} />
            <ExitButton onExit={onExit} />
            <SideButton label="다음" title="다음 행으로 이동" icon={I.chevron(26, T.textDim)} onClick={onNextRow} />
          </>
        ) : (
          <>
            <SideButton label="이전" title="이전 행으로 이동" icon={<PrevIcon />} onClick={onPrevRow} />
            <StatusButton
              label="일시정지"
              title="일시정지"
              tone={tone}
              status={tone === 'red' ? 'alert' : 'listening'}
              icon={tone === 'red' ? <AlertStatusIcon /> : I.micFilled(32, T.bg)}
              onClick={onTogglePause}
            />
            <SideButton label="다음" title="다음 행으로 이동" icon={I.chevron(26, T.textDim)} onClick={onNextRow} />
          </>
        )}
      </div>

      <ActiveControlSteppers />
    </div>
  );
}

/** 이전/다음 — 최소 68×62 심볼 버튼(§7.1). */
function SideButton({ label, title, icon, onClick }: { label: string; title: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      style={{
        width: 72, height: 62, borderRadius: 18,
        border: `1px solid ${T.lineStrong}`,
        background: T.card, color: T.textDim,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', touchAction: 'manipulation', flexShrink: 0,
      }}
    >
      {icon}
    </button>
  );
}

/** 중앙 상태 심볼 — 최소 88×72 터치 타깃. 표시는 현재 상태, 버튼 동작은 일시정지/재개다. */
function StatusButton({
  label, title, tone, status, icon, onClick,
}: {
  label: string;
  title: string;
  tone: GlowTone;
  status: VoiceControlStatus;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="voice-status-control"
      data-tone={tone}
      data-status={status}
      onClick={onClick}
      title={title}
      aria-label={label}
      style={{
        width: 96, height: 72, borderRadius: 22,
        border: 'none', background: TONE_FILL[tone], color: T.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', touchAction: 'manipulation', flexShrink: 0,
        boxShadow: `0 6px 22px ${TONE_SHADOW[tone]}`,
      }}
    >
      <span
        data-status-symbol={status}
        aria-hidden
        style={{
          display: 'inline-flex',
          animation: `voice-status-fade ${STATUS_FADE_S[tone]}s ease-in-out infinite`,
          willChange: 'opacity',
        }}
      >
        {icon}
      </span>
    </button>
  );
}

/** 경고 삼각형 — pause glyph 대신 상태 자체를 표시한다. */
function AlertStatusIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={T.bg} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** 종료 — 데이터에 영향 주는 행동이라 확인 다이얼로그(문자)로 이어진다(§7.1 위험 행동 정책).
 *  리뷰 라운드1(Flash, 수용) — paused/completing 어디서든 동일 위험 행동은 동일 타깃: 96×72 통일. */
function ExitButton({ onExit }: { onExit: () => void }) {
  return (
    <button
      type="button"
      onClick={onExit}
      title="입력 종료"
      aria-label="종료"
      style={{
        width: 96, height: 72, borderRadius: 22,
        border: '2px solid rgba(255,82,82,0.55)',
        background: 'rgba(255,82,82,0.08)', color: T.red,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', touchAction: 'manipulation', flexShrink: 0,
      }}
    >
      {I.stop(24, T.red)}
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
