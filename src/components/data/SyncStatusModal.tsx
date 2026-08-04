/**
 * v0.44.0 §C8 F23 — 시트 동기화 상태 대형 팝업 (민구 확정 2026-08-02).
 *
 * 종전에는 데이터탭 목록 상단의 작은 인라인 텍스트("시트에 추가 중...")뿐이라, 현장(장갑·햇빛)에서
 * 업로드 진행/실패가 눈에 안 들어왔고 **실패가 조용히 지나가면 업로드된 줄 알았다**(제보 F23).
 *  - 업로드 중: 화면 중앙 큰 팝업 "시트에 추가중" (backdrop 탭으로 닫히지 않음 — 오탭 방지)
 *  - 성공: 자동 닫힘 (useDataActions가 syncStatus를 null로)
 *  - 실패: 사유 + [재시도]/[나중에] 두 버튼
 * 세션별 상세(어느 세션이 왜 실패)는 기존 FailureModal이 배너 '자세히'로 계속 담당한다.
 *
 * 🔴 위치 계약: src/components/voice/ 밖(components/data/) — 인라인 fontSize가
 * v043-typo-contract의 검사 범위에 들지 않는 위치다(F23 브리핑 명시).
 */
import { T } from '../../tokens';
import { ModalBase } from '../ModalBase';
import type { SyncStatus } from '../../lib/useDataActions';

export function SyncStatusModal({
  status, onRetry, onLater,
}: {
  status: SyncStatus;
  onRetry: () => void;
  onLater: () => void;
}) {
  const uploading = status.phase === 'uploading';
  return (
    <ModalBase
      // 업로드 중에는 backdrop 탭으로 못 닫는다(진행 중 오탭이 "닫혔으니 끝났다" 오해를 만든다).
      onClose={() => { if (!uploading) onLater(); }}
      role="dialog"
      ariaModal
      ariaLabel={uploading ? '시트에 추가중' : '시트에 추가 실패'}
      testid="sync-status-modal"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-phase={status.phase}
        style={{
          background: T.card, borderRadius: 20, border: `1px solid ${T.line}`,
          width: '100%', maxWidth: 360, padding: '28px 20px 20px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {uploading ? (
          <>
            {/* 진행 스피너 — global.css @keyframes spin 재사용 */}
            <div
              aria-hidden
              style={{
                width: 44, height: 44, borderRadius: '50%',
                border: `4px solid ${T.line}`, borderTopColor: T.blue,
                animation: 'spin 0.9s linear infinite',
              }}
            />
            <div style={{ fontSize: 24, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>
              시트에 추가중
            </div>
            <div style={{ fontSize: 14, color: T.textDim }}>
              잠시만 기다려 주세요. 완료되면 자동으로 닫힙니다.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.red, letterSpacing: -0.3 }}>
              시트에 추가 실패
            </div>
            <div
              data-testid="sync-status-reason"
              style={{
                fontSize: 14, color: T.textDim, lineHeight: 1.6,
                textAlign: 'center', wordBreak: 'break-word',
                maxHeight: '30vh', overflowY: 'auto',
              }}
            >
              {status.reason}
            </div>
            <div style={{ display: 'flex', gap: 10, width: '100%', marginTop: 4 }}>
              <button
                type="button"
                data-testid="sync-status-later"
                onClick={onLater}
                style={{
                  flex: 1, height: 52, borderRadius: 14,
                  border: `1px solid ${T.lineStrong}`, background: 'transparent',
                  color: T.textDim, fontSize: 15, fontWeight: 700, cursor: 'pointer',
                }}
              >
                나중에
              </button>
              <button
                type="button"
                data-testid="sync-status-retry"
                onClick={onRetry}
                style={{
                  flex: 1, height: 52, borderRadius: 14, border: 'none',
                  background: T.blue, color: '#fff',
                  fontSize: 15, fontWeight: 800, letterSpacing: -0.2, cursor: 'pointer',
                  boxShadow: `0 4px 14px ${T.blueGlow}`,
                }}
              >
                재시도
              </button>
            </div>
          </>
        )}
      </div>
    </ModalBase>
  );
}
