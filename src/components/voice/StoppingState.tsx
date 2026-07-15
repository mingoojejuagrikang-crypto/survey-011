import { T } from '../../tokens';

/** 종료 안내·클립 flush·최종 IDB 저장이 끝날 때까지 노출하는 비대화형 화면.
 *  현장 원거리(2~3m)에서도 상태를 즉시 판독하도록 큰 타이포만 남기고 조작 요소는 렌더하지 않는다. */
export function StoppingState() {
  return (
    <div
      data-testid="voice-stopping-state"
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        padding: 'max(24px, var(--sat)) max(20px, var(--sar)) max(24px, var(--sab)) max(20px, var(--sal))',
        textAlign: 'center',
        background: T.bg,
      }}
    >
      <div
        aria-hidden
        style={{
          width: 58,
          height: 58,
          borderRadius: '50%',
          border: `6px solid ${T.lineStrong}`,
          borderTopColor: T.green,
          animation: 'spin 900ms linear infinite',
        }}
      />
      <div style={{ fontSize: 42, lineHeight: 1.12, fontWeight: 900, color: T.text, letterSpacing: -1.5 }}>
        종료 중…
      </div>
      <div style={{ fontSize: 19, lineHeight: 1.45, fontWeight: 700, color: T.textDim, wordBreak: 'keep-all' }}>
        입력한 값을 안전하게 저장하고 있습니다
      </div>
    </div>
  );
}
