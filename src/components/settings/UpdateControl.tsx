import { useState } from 'react';
import { T } from '../../tokens';
import { usePwaUpdate, applyUpdate, checkForUpdateNow } from '../../lib/pwaUpdate';
import { forceUpdateReload } from '../../lib/forceUpdateReload';
import { probeLiveVersion, type LiveVersionStatus } from '../../lib/liveVersionProbe';

/** v0.18.0 1f → **v0.50 전면 개편**(민구 08-19 지시) — 설정 footer의 버전 확인·업데이트 컨트롤.
 *
 *  ## 🔴 무엇이 잘못돼 있었나
 *  종전 구현은 `registration.update()`를 부르고 **1.8초 뒤 무조건 "최신 버전입니다"** 를 보여줬다.
 *  즉 **오프라인·SW 부재·체크 실패가 전부 「최신」으로 뭉개졌다.** 그리고 프리뷰 빌드는 SW가
 *  아예 없어서(v0.46.0~) 이 컴포넌트가 **렌더조차 되지 않았고**, 대신 *"화면을 아래로 당겨
 *  새로고침"* 이라는 **standalone에서 성립하지 않는 안내**가 있었다.
 *  결과: 민구는 08-14 빌드를 5일간 썼다(*"지금 보니 08-14에 만든 버전이야"*).
 *
 *  ## 이제 어떻게 하나
 *  1. **버전 확인** — `probeLiveVersion()`이 **배포본 index.html의 번들 해시와 직접 대조**한다.
 *     SW에 묻지 않으므로 **SW가 통째로 침묵해도 사실을 말한다.**
 *  2. 결과를 **다섯 상태 그대로** 보여준다 — 🔴 **모르는 것을 「최신」으로 접지 않는다.**
 *  3. **구버전일 때만** 업데이트 버튼을 띄운다. SW 대기분이 있으면 정규 경로(`applyUpdate`),
 *     없으면 **폴백**(`forceUpdateReload`: 캐시 비우고 SW 해제 후 리로드).
 *
 *  🔴 **강제 리로드는 사용자 탭 시점에만.** v0.18.0의 비강제 원칙(`pwaUpdate.ts` 헤더)은 그대로다.
 */
export function UpdateControl() {
  const { needRefresh } = usePwaUpdate();
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<LiveVersionStatus | null>(null);
  const [applying, setApplying] = useState(false);

  // 🔴 「업데이트 있음」은 **두 근거 중 하나라도** 서면 참이다: SW가 새 버전을 물고 있거나
  //    (`needRefresh`), 프로브가 배포본과 해시 불일치를 봤거나(`outdated`).
  const hasUpdate = needRefresh || status === 'outdated';

  const label: Record<LiveVersionStatus, string> = {
    latest: '최신 버전입니다',
    outdated: '새 버전이 있습니다',
    // 🔴 아래 셋은 **「최신」이 아니다.** 모른다는 사실을 그대로 말한다.
    unreachable: '확인 불가 — 네트워크를 확인해 주세요',
    unparseable: '확인 불가 — 배포본을 읽지 못했습니다',
    indeterminate: '확인 불가 — 개발 빌드입니다',
  };
  const tone: Record<LiveVersionStatus, string> = {
    latest: T.textMute,
    outdated: T.blue,
    unreachable: T.amber,
    unparseable: T.amber,
    indeterminate: T.textMute,
  };

  return (
    <div
      data-testid="update-control"
      style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
    >
      <button
        type="button"
        data-testid="version-check-btn"
        disabled={checking}
        onClick={() => {
          setChecking(true);
          setStatus(null);
          // 🔑 SW에게도 **함께** 물어본다(있으면). 새 SW가 waiting으로 들어오면 `needRefresh`가
          //    켜져 아래 적용 버튼이 **정규 경로**(`applyUpdate`)를 타고, 폴백(캐시 삭제)을 안 쓴다.
          //    프로브와 독립이라 SW가 없거나 침묵해도 판정에는 영향이 없다.
          checkForUpdateNow();
          void probeLiveVersion()
            .then((r) => setStatus(r.status))
            // 프로브는 throw하지 않는 계약이지만, 그 계약이 깨져도 **「최신」으로 접지 않는다**.
            .catch(() => setStatus('unreachable'))
            .finally(() => setChecking(false));
        }}
        style={{
          minHeight: 40, padding: '0 18px', borderRadius: 999,
          border: `1px solid ${T.lineStrong}`, background: 'transparent', color: T.textDim,
          fontSize: 14, fontWeight: 700, letterSpacing: -0.2,
          cursor: checking ? 'default' : 'pointer', opacity: checking ? 0.6 : 1,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {checking ? '확인 중…' : '버전 확인'}
      </button>

      {status && !hasUpdate && (
        <span
          data-testid="version-check-result"
          data-status={status}
          style={{ fontSize: 12, color: tone[status], fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}
        >
          {label[status]}
        </span>
      )}

      {hasUpdate && (
        <>
          <span
            data-testid="version-check-result"
            data-status={status ?? 'outdated'}
            style={{ fontSize: 12, color: T.blue, fontWeight: 700, fontFamily: 'system-ui, sans-serif' }}
          >
            {label.outdated}
          </span>
          <button
            type="button"
            data-testid="apply-update-btn"
            disabled={applying}
            onClick={() => {
              setApplying(true);
              // SW가 새 버전을 물고 있으면 정규 경로. 아니면 폴백(캐시 비우고 재등록 유도).
              // 🔴 둘 다 리로드로 끝나므로 이 시점 이후의 상태 복원은 필요 없다(증분 persist).
              const run = needRefresh ? applyUpdate() : forceUpdateReload().then(() => undefined);
              void run.catch(() => setApplying(false));
            }}
            style={{
              minHeight: 40, padding: '0 18px', borderRadius: 999,
              border: 'none', background: T.blue, color: '#fff',
              fontSize: 14, fontWeight: 800, letterSpacing: -0.2,
              cursor: applying ? 'default' : 'pointer', opacity: applying ? 0.6 : 1,
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            {applying ? '적용 중…' : '✨ 새 버전으로 업데이트'}
          </button>
        </>
      )}
    </div>
  );
}
