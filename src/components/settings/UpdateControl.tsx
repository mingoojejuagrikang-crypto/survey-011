import { useState } from 'react';
import { T } from '../../tokens';
import { usePwaUpdate, applyUpdate, checkForUpdateNow } from '../../lib/pwaUpdate';

/** v0.18.0 1f — 설정 footer의 수동 업데이트 컨트롤. 새 SW 대기 중이면 "새로고침"(즉시 적용),
 *  아니면 "업데이트 확인"(능동 체크 → 새 버전 있으면 배너가 뜸). standalone에서 사용자가 직접
 *  새 버전을 반영하는 경로. 강제 리로드는 없다(적용은 탭 시에만). */
export function UpdateControl() {
  const { needRefresh } = usePwaUpdate();
  const [checking, setChecking] = useState(false);
  const [checkedNoUpdate, setCheckedNoUpdate] = useState(false);

  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      {needRefresh ? (
        <button
          type="button"
          onClick={() => void applyUpdate()}
          style={{
            minHeight: 40, padding: '0 18px', borderRadius: 999,
            border: 'none', background: T.blue, color: '#fff',
            fontSize: 14, fontWeight: 800, letterSpacing: -0.2, cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          ✨ 새 버전으로 새로고침
        </button>
      ) : (
        <button
          type="button"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            setCheckedNoUpdate(false);
            checkForUpdateNow();
            // 능동 체크는 비동기 — 새 SW가 곧 onNeedRefresh로 needRefresh를 켜면 위 분기로 전환된다.
            // 짧은 유예 후에도 needRefresh가 안 켜지면 "최신 버전" 안내를 보인다(no-op 피드백).
            window.setTimeout(() => {
              setChecking(false);
              setCheckedNoUpdate(true);
            }, 1800);
          }}
          style={{
            minHeight: 40, padding: '0 18px', borderRadius: 999,
            border: `1px solid ${T.lineStrong}`, background: 'transparent', color: T.textDim,
            fontSize: 14, fontWeight: 700, letterSpacing: -0.2,
            cursor: checking ? 'default' : 'pointer', opacity: checking ? 0.6 : 1,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {checking ? '확인 중…' : '업데이트 확인'}
        </button>
      )}
      {checkedNoUpdate && !needRefresh && (
        <span style={{ fontSize: 12, color: T.textMute, fontFamily: 'system-ui, sans-serif' }}>
          최신 버전입니다
        </span>
      )}
    </div>
  );
}
