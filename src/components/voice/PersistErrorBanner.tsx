import { T } from '../../tokens';
import { I } from '../icons';

/** v0.35.0 R3-FIX-2(리뷰 라운드3, Codex High·데이터무결성, Vance) — **최종 저장 실패** 배너.
 *
 *  언제 뜨나: 입력 종료 시 persistSession()이 false(IDB 쓰기 실패 — 용량부족·DB 연결 종료·트랜잭션
 *  실패)를 반환한 경우. 그때 stop()은 phase를 'ready'로 내리지 않으므로 세션 화면이 그대로 남고,
 *  이 배너가 그 위에 뜬다. 사용자는 "종료를 눌렀는데 화면이 안 바뀐다"가 아니라 **왜** 안 바뀌는지
 *  알아야 한다(REVIEW-1: 실패를 삼키지 않는다 — 화면에도 남긴다).
 *
 *  왜 red 전면 배너인가: 실사용 맥락은 폰을 2~3m 떨어뜨려 둔 한손 음성 조사(민구)다. 저장 실패는
 *  이 앱의 최악 사건(측정값 유실)이라 원거리에서 즉시 읽혀야 한다 — MicReconnectBanner(마이크
 *  끊김)와 동일한 red/큰 타이포/56px+ 터치 타깃 계약을 따른다. 다만 마이크 배너는 상단 고정인
 *  반면 이건 **모달**이다: 배경 탭으로 세션을 계속 만지다 값이 더 꼬이는 것보다, 저장을 먼저
 *  끝내게 막는 편이 데이터 무결성에 맞다(민구 판단 필요 지점 — Larry에게 보고).
 *
 *  a11y: role="alertdialog" + aria-modal, 제목/설명 연결, 재시도 버튼 autoFocus(키보드/스크린리더
 *  진입점). 본문 ≥16px·line-height ≥1.5. */
export function PersistErrorBanner({
  retrying,
  onRetry,
}: {
  /** 재시도 IDB 쓰기 진행 중 — 버튼 잠금(중복 발사 방지). */
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="persist-error-title"
      aria-describedby="persist-error-desc"
      data-testid="persist-error-banner"
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.72)',
        padding: 'max(16px, var(--sat)) max(16px, var(--sar)) max(16px, var(--sab)) max(16px, var(--sal))',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 520,
          display: 'flex', flexDirection: 'column', gap: 14,
          padding: '20px 18px', borderRadius: 18,
          background: 'rgba(34,18,18,0.98)', border: `2px solid ${T.red}`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flexShrink: 0, display: 'flex' }} aria-hidden>{I.cloudOff(26, T.red)}</span>
          <span
            id="persist-error-title"
            style={{
              fontSize: 22, fontWeight: 900, color: T.red, letterSpacing: -0.3,
              lineHeight: 1.25, wordBreak: 'keep-all', overflowWrap: 'anywhere',
            }}
          >
            저장 실패 — 종료되지 않음
          </span>
        </div>
        <p
          id="persist-error-desc"
          style={{
            margin: 0, fontSize: 16, lineHeight: 1.55, color: T.text,
            wordBreak: 'keep-all', overflowWrap: 'anywhere',
          }}
        >
          이번 세션의 값을 기기에 저장하지 못했습니다. 지금 종료하면 <b>입력한 값이 사라집니다</b>.
          저장에 성공해야 종료됩니다. 저장 공간이 부족하면 공간을 확보한 뒤 다시 저장하세요.
        </p>
        <button
          type="button"
          autoFocus
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying}
          data-testid="persist-retry-btn"
          style={{
            minHeight: 60, borderRadius: 14, border: 'none',
            cursor: retrying ? 'wait' : 'pointer',
            background: retrying ? '#7a2e2e' : T.red, color: '#fff',
            opacity: retrying ? 0.85 : 1,
            fontSize: 19, fontWeight: 900, letterSpacing: -0.3,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: retrying ? 'none' : '0 4px 14px rgba(255,82,82,0.4)',
          }}
          title={retrying ? '저장 중…' : '다시 저장'}
        >
          {retrying ? '저장 중…' : '다시 저장'}
        </button>
      </div>
    </div>
  );
}
