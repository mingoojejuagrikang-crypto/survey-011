import { T } from '../../tokens';

/** 문자 확인 버튼(현재 소비처: ExitConfirmDialog — 데이터에 영향 주는 행동은 심볼만으로 확정하지
 *  않는다, §7.1). v0.36.0 리뷰 라운드1(Flash, 수용) — ActiveControlBar가 자체 심볼 버튼으로 분리된
 *  뒤 안 쓰이게 된 icon/iconOnly/secondary 모드를 삭제(GL-006 §19 삭제 우선). */
export function VoiceActionButton({
  label, title, tone, onClick,
}: {
  label: string;
  title: string;
  tone: 'primary' | 'danger';
  onClick: () => void;
}) {
  const danger = tone === 'danger';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      style={{
        width: '100%',
        minWidth: 0,
        minHeight: 64,
        borderRadius: 18,
        border: danger ? `2px solid rgba(255,82,82,0.55)` : '1px solid transparent',
        background: danger
          ? 'rgba(255,82,82,0.08)'
          : `linear-gradient(180deg, #5A9BFF 0%, ${T.blue} 58%, #1859D5 100%)`,
        color: danger ? T.red : '#fff',
        fontSize: danger ? 18 : 22,
        fontWeight: 900,
        letterSpacing: -0.3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        cursor: 'pointer',
        boxShadow: danger ? 'none' : `0 8px 28px ${T.blueGlow}`,
        touchAction: 'manipulation',
      }}
    >
      <span>{label}</span>
    </button>
  );
}
