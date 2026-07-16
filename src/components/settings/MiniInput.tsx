import { T } from '../../tokens';

// ─── small UI atoms ────────────────────────────────────────────
export function MiniInput({
  value, onChange, placeholder, wide,
}: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: wide ? 100 : 56, height: 36, borderRadius: 8,
        background: T.inputBg, border: `1px solid ${T.line}`,
        color: T.text, fontSize: 15, fontWeight: 600,
        textAlign: 'center', outline: 'none', padding: '0 6px',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
      }}
    />
  );
}

