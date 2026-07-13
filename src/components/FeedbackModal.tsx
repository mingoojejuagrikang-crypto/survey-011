/**
 * v0.33.0 항목11 — 개선요청 팝업(화면 전환 없는 탭 인터셉트 방식, 민구 확정).
 *
 * App.tsx가 '개선요청' 탭 클릭을 인터셉트해 현재 화면을 유지한 채 캡처 → 이 모달을 띄운다.
 * 구성: 캡처 썸네일(실패 시 안내 문구) + 자유텍스트 + 보내기/취소.
 * 오버레이는 SettingsHelpModal 패턴(fixed inset 0 + safe-area var(--sat/--sab) 패딩) 재사용.
 * 전송 자체(zip 빌드/이중 업로드/큐)는 feedback.ts submitFeedback이 담당 — 이 컴포넌트는
 * 순수 프레젠테이션 + 전송 중 상태만 가진다.
 */
import { useEffect, useMemo, useState } from 'react';
import { T } from '../tokens';

export function FeedbackModal({
  screenshot, onSubmit, onClose,
}: {
  /** 인터셉트 시점 캡처. null = 캡처 실패(텍스트만 전송 — best-effort 계약). */
  screenshot: Blob | null;
  /** '보내기' — 완료(업로드/큐 수렴)까지 resolve하지 않는다. 모달은 resolve 후 닫힌다. */
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const thumbUrl = useMemo(() => (screenshot ? URL.createObjectURL(screenshot) : null), [screenshot]);
  useEffect(() => () => { if (thumbUrl) URL.revokeObjectURL(thumbUrl); }, [thumbUrl]);

  const canSend = text.trim().length > 0 && !sending;

  return (
    <div
      onClick={() => { if (!sending) onClose(); }}
      data-testid="feedback-modal"
      role="dialog"
      aria-modal="true"
      aria-label="개선요청 보내기"
      style={{
        position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // standalone PWA safe-area(노치/홈인디케이터 침범 방지) — SettingsHelpModal 패턴.
        paddingTop: 'max(16px, var(--sat))',
        paddingBottom: 'max(16px, var(--sab))',
        paddingLeft: 'max(16px, var(--sal))',
        paddingRight: 'max(16px, var(--sar))',
        animation: 'fade-up 200ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, maxHeight: '84vh',
          background: T.card, borderRadius: 18, border: `1px solid ${T.line}`,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 16px', borderBottom: `1px solid ${T.line}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 800, color: T.text }}>개선요청 보내기</div>
          <button
            type="button"
            onClick={() => { if (!sending) onClose(); }}
            aria-label="닫기"
            style={{
              width: 36, height: 36, borderRadius: 18, border: 'none',
              background: 'rgba(255,255,255,0.06)', color: T.textDim,
              fontSize: 16, cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.5 : 1,
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10,
            minHeight: 0, overflowY: 'auto',
          }}
        >
          {/* 캡처 썸네일 — 지금 보던 화면이 함께 전송됨을 시각 확인. 실패 시 정직한 안내. */}
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt="현재 화면 캡처"
              data-testid="feedback-thumbnail"
              style={{
                width: '100%', maxHeight: 180, objectFit: 'contain',
                borderRadius: 12, border: `1px solid ${T.lineStrong}`,
                background: T.bg,
              }}
            />
          ) : (
            <div
              data-testid="feedback-thumbnail-missing"
              style={{
                padding: '10px 12px', borderRadius: 12,
                background: 'rgba(255,179,0,0.08)', border: `1px solid ${T.amber}`,
                fontSize: 13, color: T.amber, fontWeight: 700, lineHeight: 1.5,
              }}
            >
              화면 캡처에 실패했습니다 — 요청 내용만 전송됩니다
            </div>
          )}
          <span style={{ fontSize: 12, color: T.textMute, lineHeight: 1.5, wordBreak: 'keep-all' }}>
            지금 화면과 앱 기록(음성 클립 제외)이 함께 전송되어 문제 파악에 사용됩니다
          </span>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="불편했던 점, 바라는 점을 자유롭게 적어주세요"
            data-testid="feedback-text"
            rows={4}
            disabled={sending}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'none',
              borderRadius: 12, border: `1px solid ${T.line}`, background: T.inputBg,
              color: T.text, fontSize: 15, lineHeight: 1.5, padding: '10px 12px',
              outline: 'none', fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.line}`, display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => { if (!sending) onClose(); }}
            disabled={sending}
            data-testid="feedback-cancel"
            style={{
              flex: 1, height: 48, borderRadius: 14,
              border: `1px solid ${T.lineStrong}`, background: 'transparent',
              color: T.textDim, fontSize: 15, fontWeight: 700,
              cursor: sending ? 'default' : 'pointer', opacity: sending ? 0.5 : 1,
            }}
          >
            취소
          </button>
          <button
            type="button"
            disabled={!canSend}
            data-testid="feedback-send"
            onClick={() => {
              if (!canSend) return;
              setSending(true);
              void onSubmit(text.trim()).finally(() => onClose());
            }}
            aria-busy={sending}
            style={{
              flex: 2, height: 48, borderRadius: 14, border: 'none',
              background: canSend || sending ? T.blue : '#2A2D32',
              color: canSend || sending ? '#fff' : T.textMute,
              fontSize: 15, fontWeight: 800,
              cursor: canSend ? 'pointer' : 'default',
              boxShadow: canSend ? `0 4px 14px ${T.blueGlow}` : 'none',
            }}
          >
            {sending ? '전송 중…' : '보내기'}
          </button>
        </div>
      </div>
    </div>
  );
}
