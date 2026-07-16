import { T, TYPE_LABELS } from '../../tokens';
import type { DataType } from '../../types';

export function TypeReviewModal({
  checked, mismatches, onApplyAll, onClose,
}: {
  checked: number;
  mismatches: { id: string; name: string; saved: DataType; sheet: DataType }[];
  onApplyAll: () => void;
  onClose: () => void;
}) {
  const ok = mismatches.length === 0;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // v0.21.0 설정탭#2 — standalone PWA safe-area(노치/상태바/홈인디케이터 침범 방지). backdrop
        //   패딩에 safe-area 변수(global.css SSOT) 흡수. Safari 탭에선 0이라 기존 24px 유지.
        paddingTop: 'max(24px, var(--sat))',
        paddingBottom: 'max(24px, var(--sab))',
        paddingLeft: 'max(24px, var(--sal))',
        paddingRight: 'max(24px, var(--sar))',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 360, maxHeight: '80%', overflowY: 'auto',
          background: T.card, borderRadius: 20, border: `1px solid ${T.lineStrong}`, padding: '20px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>타입 검토</div>
          <button
            onClick={onClose}
            style={{
              width: 30, height: 30, borderRadius: '50%', border: `1px solid ${T.lineStrong}`,
              background: 'transparent', color: T.textDim, fontSize: 16, cursor: 'pointer',
            }}
            title="닫기"
          >
            ✕
          </button>
        </div>

        {ok ? (
          <div style={{ fontSize: 14, color: T.textDim, lineHeight: 1.6 }}>
            저장된 데이터형이 시트와 <b style={{ color: T.green }}>일치</b>합니다.
            <div style={{ fontSize: 12, color: T.textMute, marginTop: 6 }}>검토한 컬럼 {checked}개</div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: T.textDim, marginBottom: 12, lineHeight: 1.5 }}>
              저장된 타입과 시트의 실제 데이터형이 다른 컬럼이 <b style={{ color: T.amber }}>{mismatches.length}개</b> 있습니다
              <span style={{ color: T.textMute }}> (검토 {checked}개)</span>.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mismatches.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', borderRadius: 10, background: T.inputBg,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{m.name}</span>
                  <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: T.textMute }}>{TYPE_LABELS[m.saved]}</span>
                    <span style={{ color: T.textMute }}>→</span>
                    <span style={{ color: T.amber, fontWeight: 800 }}>{TYPE_LABELS[m.sheet]}</span>
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={onApplyAll}
              style={{
                marginTop: 16, width: '100%', height: 44, borderRadius: 12, cursor: 'pointer',
                border: 'none', background: T.blue, color: '#fff', fontSize: 15, fontWeight: 800,
              }}
            >
              시트 데이터형으로 모두 변경
            </button>
            <div style={{ fontSize: 11, color: T.textMute, textAlign: 'center', marginTop: 8 }}>
              ('리스트' 타입은 검토에서 제외됩니다)
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── screen root ───────────────────────────────────────────────
/** S-2: a column whose saved type differs from the sheet's inferred data type. */
interface TypeMismatch { id: string; name: string; saved: DataType; sheet: DataType; }

