import { T } from '../../tokens';
import { VOICE_COMMANDS } from '../../lib/voiceCommands';

/** I-1: 음성 명령어 전체 목록 팝업. voiceCommands.ts(SSOT)에서 동적 생성 — 기능당 단어 1개. */
export function CommandHelpPopup({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 'min(600px, 96vw)', maxHeight: '90%', overflowY: 'auto',
          background: T.card, borderRadius: 30, border: `1px solid ${T.lineStrong}`,
          padding: '30px 27px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 21 }}>
          <div style={{ fontSize: 25, fontWeight: 800, color: T.text }}>음성 명령어</div>
          <button
            onClick={onClose}
            style={{
              width: 45, height: 45, borderRadius: '50%', border: `1px solid ${T.lineStrong}`,
              background: 'transparent', color: T.textDim, fontSize: 24, cursor: 'pointer',
            }}
            title="닫기"
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: 18, color: T.textMute, marginBottom: 21, lineHeight: 1.5 }}>
          각 기능은 아래 <b>한 단어</b>로만 동작합니다. 그대로 말씀하세요.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          {VOICE_COMMANDS.map((cmd) => (
            <div key={cmd.id} style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
              <span
                style={{
                  flexShrink: 0, minWidth: 96, textAlign: 'center',
                  padding: '6px 15px', borderRadius: 999,
                  background: T.blueGlow, color: '#fff', fontSize: 21, fontWeight: 800,
                }}
              >
                {cmd.display}
              </span>
              <span style={{ fontSize: 20, color: T.textDim, lineHeight: 1.4 }}>{cmd.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
