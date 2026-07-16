import { T } from '../../tokens';

/** Shown when IndexedDB hydration FAILED (D-1) — distinct from a genuinely empty list.
 *  Reassures the user their data is likely intact and offers a retry rather than a blank state.
 *  A version mismatch (app update + stale tab) needs a full refresh, so we surface that hint. */
export function LoadErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  const isVersion = /version/i.test(error);
  return (
    <div
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 16, padding: '40px 32px',
      }}
    >
      <div
        style={{
          width: 110, height: 110, borderRadius: '50%',
          background: 'rgba(255,82,82,0.06)',
          border: `1px dashed ${T.red}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: T.red, fontSize: 44, fontWeight: 800,
        }}
      >
        !
      </div>
      <div
        style={{
          fontSize: 17, fontWeight: 700, color: T.text,
          letterSpacing: -0.2, textAlign: 'center',
        }}
      >
        데이터를 불러오지 못했습니다
      </div>
      <div style={{ fontSize: 14, color: T.textMute, textAlign: 'center', lineHeight: 1.5 }}>
        저장된 세션은 안전할 수 있습니다.<br />
        {isVersion
          ? '앱이 업데이트되었습니다. 앱을 새로고침한 뒤 다시 시도하세요.'
          : '잠시 후 다시 시도해 주세요.'}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          onClick={onRetry}
          style={{
            padding: '10px 20px', borderRadius: 12, border: `1px solid ${T.blue}`,
            background: T.blue, color: '#fff',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          다시 시도
        </button>
        {isVersion && (
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px', borderRadius: 12, border: `1px solid ${T.lineStrong}`,
              background: 'transparent', color: T.text,
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}
          >
            새로고침
          </button>
        )}
      </div>
    </div>
  );
}
