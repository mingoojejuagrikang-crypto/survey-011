import { T } from '../../tokens';

/** I-3: screen-centered recognition burst — "항목 : 값", large, replays per recognition (keyed by
 *  seq), then auto-fades via the value-burst keyframes. Decorative (the value also lives in the chip). */
export function CenterValueBurst({ name, value }: { name: string; value: string }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed', inset: 0, zIndex: 40, pointerEvents: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        style={{
          animation: 'value-burst 950ms ease-out forwards',
          maxWidth: '88vw',
          padding: '18px 26px', borderRadius: 20,
          background: 'rgba(10,28,18,0.94)',
          border: `2px solid ${T.green}`,
          boxShadow: `0 0 36px rgba(0,200,83,0.55), 0 12px 40px rgba(0,0,0,0.5)`,
          display: 'flex', alignItems: 'baseline', gap: 12, justifyContent: 'center',
        }}
      >
        {/* I1: 항목명과 값을 같은 폰트 사이즈로 통일하고 화면 내 최대 확대(88vw 가드). */}
        <span style={{ fontSize: 'clamp(30px, 9vw, 50px)', fontWeight: 800, color: T.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '34vw' }}>
          {name}
        </span>
        <span style={{ fontSize: 'clamp(30px, 9vw, 50px)', fontWeight: 700, color: T.textMute }}>:</span>
        <span
          style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 'clamp(30px, 9vw, 50px)', fontWeight: 900,
            color: T.text, letterSpacing: -0.5, lineHeight: 1.05,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}
