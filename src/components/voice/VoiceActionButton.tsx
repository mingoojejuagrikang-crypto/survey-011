import type { ReactNode } from 'react';
import { T } from '../../tokens';

export function VoiceActionButton({
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
