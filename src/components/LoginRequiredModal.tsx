import { useEffect, useRef } from 'react';
import { T } from '../tokens';
import { AuthMark } from './icons';
import { ModalBase } from './ModalBase';

/**
 * v0.20.0 Phase 2 — 로그인 필요 안내 팝업(범용, 표시 전용).
 *
 * 토큰 만료/미로그인이 감지되는 모든 지점(시트 동기화·Drive 백업·복구)에서 띄운다. 조용한 실패
 * (메시지 없음)를 대체해, 무엇이 필요한지와 다음 행동([로그인])을 명확히 안내한다.
 *
 * **표시 전용:** 트리거/감지 로직은 여기 없다. Mack이 DataScreen에서 토큰 만료를 감지해 마운트하고,
 * onLogin/onClose에 실제 재로그인·닫기 핸들러를 연결한다(Wave 2). 이 컴포넌트는 props만 받는다.
 *
 * 스타일은 앱의 기존 중앙 팝업(TypeReviewModal 등)과 동일한 토큰: T.card 카드 + backdrop blur +
 * 둥근 모서리 + T.blue 주 동작. 접근성: role="dialog"/aria-modal, ESC·backdrop 닫기, focus 이동,
 * 시맨틱 <button>, focus-visible(브라우저 기본 outline 보존 — outline:none 미설정).
 */
export function LoginRequiredModal({
  reason,
  onLogin,
  onClose,
}: {
  /** 선택: 어떤 동작이 로그인을 요구했는지(예: "시트 동기화에 로그인이 필요합니다"). */
  reason?: string;
  /** [로그인] 탭 — Mack이 재로그인 플로우를 연결. */
  onLogin: () => void;
  /** [닫기]·backdrop·ESC — Mack이 dismiss 처리를 연결. */
  onClose: () => void;
}) {
  const loginBtnRef = useRef<HTMLButtonElement | null>(null);

  // 마운트 시 주 동작(로그인)으로 포커스 이동 + ESC 닫기(키보드 경로 보장).
  useEffect(() => {
    loginBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <ModalBase onClose={onClose} zIndex={120} blur pad={20} animation="fade-up 200ms ease-out">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-required-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 360,
          background: T.card, borderRadius: 20, border: `1px solid ${T.lineStrong}`,
          padding: '22px 20px',
          display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'rgba(66,133,244,0.12)', border: `1px solid rgba(66,133,244,0.35)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <AuthMark s={26} />
        </div>

        <h2
          id="login-required-title"
          style={{
            margin: 0, fontSize: 19, fontWeight: 800, color: T.text,
            letterSpacing: -0.3, textAlign: 'center', lineHeight: 1.3,
          }}
        >
          로그인이 필요합니다
        </h2>

        {reason && (
          <p
            style={{
              margin: 0, fontSize: 15, color: T.textDim, fontWeight: 500,
              textAlign: 'center', lineHeight: 1.5, wordBreak: 'keep-all',
            }}
          >
            {reason}
          </p>
        )}

        <button
          ref={loginBtnRef}
          type="button"
          onClick={onLogin}
          style={{
            width: '100%', minHeight: 52, borderRadius: 14, border: 'none',
            background: T.blue, color: '#fff',
            fontSize: 16, fontWeight: 800, letterSpacing: -0.2,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            cursor: 'pointer', marginTop: 4,
            boxShadow: `0 4px 14px ${T.blueGlow}`,
          }}
        >
          <AuthMark s={20} /> 로그인
        </button>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%', minHeight: 44, borderRadius: 12,
            border: `1px solid ${T.lineStrong}`, background: 'transparent',
            color: T.textDim, fontSize: 15, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          닫기
        </button>
      </div>
    </ModalBase>
  );
}
