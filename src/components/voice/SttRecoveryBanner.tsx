import { T } from '../../tokens';
import { VOICE_TYPE } from './heroLayout';

/** A-only failure path. Its button recreates SpeechRecognition, never the clip stream. */
export function SttRecoveryBanner({ visible, onReconnect }: { visible: boolean; onReconnect: () => void }) {
  if (!visible) return null;
  return (
    <div role="alert" data-testid="stt-recovery-banner" style={{ position: 'fixed', zIndex: 59,
      top: 'max(88px, calc(var(--sat) + 70px))', left: 'max(10px, var(--sal))', right: 'max(10px, var(--sar))',
      display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14,
      background: 'rgba(34,18,18,0.97)', border: `2px solid ${T.red}` }}>
      <strong style={{ flex: 1, color: '#fff', fontSize: VOICE_TYPE.bannerTitle }}>음성 인식 응답 없음</strong>
      <button type="button" data-testid="stt-reconnect-btn" onClick={onReconnect}
        style={{ minHeight: 56, padding: '0 16px', border: 0, borderRadius: 10, background: T.red,
          color: '#fff', fontSize: VOICE_TYPE.bannerAction, fontWeight: 800, cursor: 'pointer' }}>다시 연결</button>
    </div>
  );
}
