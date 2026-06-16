import { T } from '../../tokens';

/** v0.9.0 이상치 알람 팝업 — 발화만으론 스쳐 지나가 확인이 어렵다는 요청. 이전값→현재값과 변화량
 *  (절대차 또는 %)을 상단에 띄우고, '확인'/'유지'/새 값 입력 또는 다음 필드 진입 시 해제(store에서).
 *  v0.10.0 A2: 화면 수직 중앙 + 1.3× 확대(화면 안 가드: min(560px,94vw)/88vh/overflowY). */
export function AnomalyAlertPopup({
  a,
}: {
  a: { colName: string; prev: string; next: string; direction: 'up' | 'down'; changeText: string };
}) {
  const up = a.direction === 'up';
  const accent = up ? T.red : T.amber;
  return (
    <div
      data-testid="anomaly-alert"
      aria-live="assertive"
      style={{
        position: 'fixed', inset: 0, zIndex: 45,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', pointerEvents: 'none',
      }}
    >
      <div
        style={{
          maxWidth: 'min(560px, 94vw)', maxHeight: '88vh', overflowY: 'auto',
          padding: '20px 28px', borderRadius: 18,
          background: 'rgba(34,18,18,0.96)', border: `2px solid ${accent}`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{a.colName} 이상치</span>
          <span style={{ fontSize: 19, fontWeight: 800, color: accent }}>
            {a.changeText ? `${a.changeText} ` : ''}{up ? '증가' : '감소'}
          </span>
        </div>
        <div
          style={{
            display: 'flex', alignItems: 'baseline', gap: 12,
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          }}
        >
          <span style={{ fontSize: 30, fontWeight: 800, color: T.textDim }}>{a.prev}</span>
          <span style={{ fontSize: 24, color: T.textMute }}>→</span>
          <span style={{ fontSize: 'clamp(40px, 11vw, 60px)', fontWeight: 900, color: T.text, letterSpacing: -0.5 }}>
            {a.next}
          </span>
        </div>
        <div style={{ fontSize: 15, color: T.textDim, fontWeight: 600 }}>'확인' 또는 새 값으로 정정</div>
      </div>
    </div>
  );
}
