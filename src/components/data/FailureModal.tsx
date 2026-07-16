import { T } from '../../tokens';
import { I } from '../icons';
import type { SyncReport, SyncFailure } from '../../lib/sync';
import { Backdrop } from './Backdrop';

// ─── failure modal ───────────────────────────────────────────
export function FailureModal({
  report, onClose, onRetry,
}: {
  report: SyncReport;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <Backdrop onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 380, maxHeight: '78vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: `1px solid ${T.line}`,
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, color: T.red }}>업로드 실패</div>
          <button
            onClick={onClose}
            style={{
              width: 36, height: 36, borderRadius: 18,
              border: 'none', background: 'rgba(255,255,255,0.06)',
              color: T.textDim, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {I.close(18, T.textDim)}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          <div style={{ fontSize: 14, color: T.textDim, marginBottom: 12 }}>
            성공 {report.ok}개, 실패 {report.failed}개 ({report.rows}행 추가됨)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {report.failures.map((f) => (
              <FailureItem key={f.sessionId} f={f} />
            ))}
          </div>
        </div>

        <div
          style={{
            padding: '12px 16px',
            display: 'flex', gap: 10,
            borderTop: `1px solid ${T.line}`,
          }}
        >
          <button
            onClick={onClose}
            style={{
              flex: 1, height: 48, borderRadius: 14,
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.textDim, fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}
          >
            닫기
          </button>
          <button
            onClick={onRetry}
            style={{
              flex: 1, height: 48, borderRadius: 14, border: 'none',
              background: T.blue, color: '#fff',
              fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
              cursor: 'pointer',
              boxShadow: `0 4px 14px ${T.blueGlow}`,
            }}
          >
            재시도
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

function FailureItem({ f }: { f: SyncFailure }) {
  const isNetworkError = /network|fetch|offline/i.test(f.reason);
  const isAuthError = /401|403|토큰|로그인/i.test(f.reason);
  const isRateLimit = /429|503|busy|rate/i.test(f.reason);
  const hint = isRateLimit
    ? '잠시 후 다시 시도하세요. 구글 시트 일시적 과부하일 수 있습니다.'
    : isAuthError
    ? '설정 탭에서 다시 로그인 후 시도하세요.'
    : isNetworkError
    ? '네트워크 상태를 확인하세요.'
    : '';
  return (
    <div
      style={{
        padding: 12, borderRadius: 10,
        background: 'rgba(255,82,82,0.08)',
        border: `1px solid rgba(255,82,82,0.20)`,
      }}
    >
      <div style={{ fontSize: 14, color: T.text, fontWeight: 700, marginBottom: 4 }}>
        {f.sessionDate}{f.sessionLabel ? ` · ${f.sessionLabel}` : ''}
      </div>
      <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.5 }}>{f.reason}</div>
      {hint && (
        <div style={{ fontSize: 12, color: T.amber, marginTop: 6, fontStyle: 'italic' }}>
          💡 {hint}
        </div>
      )}
    </div>
  );
}
