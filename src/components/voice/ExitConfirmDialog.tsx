import { T } from '../../tokens';
import { VoiceActionButton } from './VoiceActionButton';
import { ModalBase, OVERLAY_DIM_STRONG } from '../ModalBase';

export function ExitConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <ModalBase
      onClose={onCancel}
      role="dialog"
      ariaModal
      ariaLabelledby="exit-confirm-title"
      zIndex={55}
      dim={OVERLAY_DIM_STRONG}
      pad={20}
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
    </ModalBase>
  );
}
