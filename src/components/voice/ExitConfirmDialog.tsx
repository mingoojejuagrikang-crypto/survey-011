import { T } from '../../tokens';
import { VoiceActionButton } from './VoiceActionButton';

export function ExitConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
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
