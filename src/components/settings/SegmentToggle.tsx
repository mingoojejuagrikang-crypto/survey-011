import { T } from '../../tokens';

/** v0.23.0 설정탭#2(Vance) — SegmentToggle의 선두 라벨 스타일 SSOT. 자동값 행("입력값") 라벨이
 *  입력방식/음성확인 행 라벨과 같은 폭·톤으로 정렬되도록 공유한다. */
export const ROW_LABEL_STYLE = { fontSize: 12, color: T.textMute, fontWeight: 700, letterSpacing: 0.4 } as const;

export function SegmentToggle<V extends string>({
  label, value, options, onChange, disabled, testId,
}: {
  label: string;
  value: V;
  options: { id: V; label: string }[];
  onChange: (v: V) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div data-testid={testId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* v0.23.0 — label="" 이면 라벨 span 생략(날짜 토글은 "입력값" 선두 라벨 아래라 자체 라벨 불필요). */}
      {label !== '' && (
        <span style={ROW_LABEL_STYLE}>
          {label}
        </span>
      )}
      <div
        style={{
          display: 'inline-flex', background: T.inputBg, borderRadius: 10,
          padding: 3, border: `1px solid ${T.line}`, height: 36,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id}
              onClick={() => !disabled && onChange(o.id)}
              style={{
                border: 'none', background: active ? T.blue : 'transparent',
                color: active ? '#fff' : T.textDim,
                fontSize: 14, fontWeight: active ? 700 : 600,
                padding: '0 14px', borderRadius: 8,
                cursor: disabled ? 'not-allowed' : 'pointer',
                letterSpacing: -0.1, height: '100%', whiteSpace: 'nowrap',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── auto detail panels ────────────────────────────────────────
