import { T } from '../../tokens';
import { I } from '../icons';

export function EmptyState() {
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 18, padding: '40px 32px',
      }}
    >
      <div
        style={{
          width: 110, height: 110, borderRadius: '50%',
          background: 'rgba(255,255,255,0.03)',
          border: `1px dashed ${T.lineStrong}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: T.textMute,
        }}
      >
        {I.data(50, T.textMute)}
      </div>
      <div
        style={{
          fontSize: 17, fontWeight: 700, color: T.textDim,
          letterSpacing: -0.2, textAlign: 'center',
        }}
      >
        아직 기록된 데이터가 없습니다
      </div>
      <div style={{ fontSize: 14, color: T.textMute, textAlign: 'center', lineHeight: 1.5 }}>
        입력 탭에서 음성 세션을 시작하거나<br />시트에서 가져올 수 있습니다
      </div>
    </div>
  );
}
