import type { ReactNode } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';
import type { GlowTone } from './EdgeGlow';
import { ActiveControlSteppers } from './ActiveControlSteppers';

/** v0.36.0 코덱스 시안(2026-07-20, 민구 확정) — 입력탭 하단 컨트롤바(표현 전용, §7.1).
 *  중앙 정렬 심볼 버튼: 이전 68×62 / 일시정지·재개 88×72(상태색 채움) / 다음 68×62. 문자 라벨 없이
 *  픽토그램 + `title`(테스트 셀렉터·툴팁) + `aria-label`(스크린리더). 버튼 간 14px(장갑 조작).
 *
 *  종료 노출 정책 불변: 입력 중 숨김, paused/complete에서만 노출(오조작 방지).
 *  Steppers(입력 조절)는 기본 접힘 — `input-control-toggle` Y가 레이아웃 테스트의 기준점이므로
 *  모든 상태 분기의 버튼 행 높이(72px)를 동일하게 유지한다(v0.19.0 인변량). */
const TONE_FILL: Record<GlowTone, string> = { green: T.green, amber: T.amber, red: T.red };
// 리뷰 라운드1(Flash, 수용) — 채움 그림자는 hex-alpha 하드코딩(`${fill}55`) 대신 기존 glow 토큰.
const TONE_SHADOW: Record<GlowTone, string> = { green: T.greenGlow, amber: T.amberGlow, red: T.redGlow };

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
            <CenterButton label="재시작" title="재시작" tone="amber" icon={I.play(28, T.bg)} onClick={onTogglePause} />
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
            <CenterButton label="일시정지" title="일시정지" tone={tone} icon={I.pause(28, T.bg)} onClick={onTogglePause} />
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

/** 중앙 주 행동 — 최소 88×72, 상태색 채움(§7.1: 입력 중 초록 pause / 경고 적색 / 일시정지 주황 play). */
function CenterButton({ label, title, tone, icon, onClick }: { label: string; title: string; tone: GlowTone; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
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
      {icon}
    </button>
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
