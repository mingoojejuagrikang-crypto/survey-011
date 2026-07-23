import { T } from '../../tokens';
import { Backdrop } from './Backdrop';

// ─── confirm modal ────────────────────────────────────────────
export function ConfirmModal({
  title, body, confirmLabel = '확인', alternativeLabel, danger,
  onCancel, onConfirm, onAlternative,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  alternativeLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onAlternative?: () => void;
}) {
  return (
    <Backdrop onClose={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 360,
          padding: 20,
          display: 'flex', flexDirection: 'column', gap: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{title}</div>
        <div
          style={{
            fontSize: 14, color: T.textDim, whiteSpace: 'pre-line', lineHeight: 1.5,
          }}
        >
          {body}
        </div>
        {alternativeLabel && onAlternative && (
          <button
            onClick={onAlternative}
            style={{
              width: '100%', height: 48, borderRadius: 14,
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.text, fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {alternativeLabel}
          </button>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, height: 48, borderRadius: 14,
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.textDim, fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1, height: 48, borderRadius: 14, border: 'none',
              background: danger ? T.red : T.blue,
              color: '#fff', fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
              cursor: 'pointer',
              boxShadow: danger ? '0 4px 14px rgba(255,82,82,0.32)' : `0 4px 14px ${T.blueGlow}`,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}
