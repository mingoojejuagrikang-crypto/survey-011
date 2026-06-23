import { T } from '../tokens';
import { usePwaUpdate, applyUpdate } from '../lib/pwaUpdate';

/**
 * v0.18.0 1f — 비강제 "새 버전" 배너.
 *
 * 새 SW가 waiting(`needRefresh`)일 때만 앱 상단에 나타난다. 탭하면 `applyUpdate`로 새 버전을
 * 적용(skipWaiting + 1회 리로드)한다 — **사용자 선택 시점에만** 리로드한다(현장 음성 측정 중
 * 강제 리로드 금지). 진행 세션은 v0.4.4 증분 persist로 영속화돼 있어 리로드해도 유실되지 않는다.
 *
 * 접근성: 실제 <button>(키보드/포커스 경로 확보), aria-live=polite로 등장 알림, 충분한 터치 타깃.
 */
export function UpdateBanner() {
  const { needRefresh } = usePwaUpdate();
  if (!needRefresh) return null;

  return (
    <div
      aria-live="polite"
      style={{
        flexShrink: 0,
        padding: '8px 12px',
        background: 'rgba(18,26,40,0.96)',
        borderBottom: `2px solid ${T.blue}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}
    >
      <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>✨</span>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.text, letterSpacing: -0.2 }}>
          새 버전이 있습니다
        </div>
        <div style={{ fontSize: 12.5, color: T.textDim, fontWeight: 500 }}>
          측정 중이면 끝낸 뒤 눌러도 됩니다 (자동 새로고침 안 함)
        </div>
      </div>
      <button
        type="button"
        onClick={() => void applyUpdate()}
        style={{
          flexShrink: 0,
          minHeight: 40, padding: '0 16px', borderRadius: 999,
          border: 'none', background: T.blue, color: '#fff',
          fontSize: 15, fontWeight: 800, letterSpacing: -0.2,
          cursor: 'pointer',
        }}
      >
        새로고침
      </button>
    </div>
  );
}
