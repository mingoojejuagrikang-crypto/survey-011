import { useEffect } from 'react';
import type { ReactNode } from 'react';

/** 오버레이 dim 토큰(v0.35.2 Stage 2 — 모달 셸 SSOT). 기존 셸들의 실측값을 이름으로 고정한다(시각 불변). */
export const OVERLAY_DIM = 'rgba(0,0,0,0.6)';        // 표준(대부분의 모달)
export const OVERLAY_DIM_SOFT = 'rgba(0,0,0,0.55)';  // 데이터탭 Backdrop
export const OVERLAY_DIM_STRONG = 'rgba(0,0,0,0.68)'; // 종료 확인(주의 집중)

/**
 * v0.35.2 Stage 2 — 공용 모달/시트 셸. 앱 전역에 복제돼 있던 오버레이 셸(fixed+inset:0 dim
 * +선택 blur+safe-area 패딩+backdrop 탭 닫기) 9벌을 흡수한다.
 *
 * 계약(리팩토링 불변식):
 *  - 콘텐츠 카드(자식)는 각 모달이 소유하고, 카드의 onClick stopPropagation도 기존처럼 자식이 건다.
 *  - role/aria/data-testid는 "기존에 오버레이에 달려 있던 모달"만 prop으로 받아 같은 노드(오버레이)에
 *    유지한다. 카드에 달던 모달은 카드에 그대로 — DOM 구조·Playwright 셀렉터 불변.
 *  - safe-area 패딩은 `max(<pad>px, var(--sa*))`(global.css SSOT). Safari 탭에선 var=0 → 기존 px 유지.
 *  - ESC 닫기는 opt-in(escClose) — 기존에 ESC가 없던 모달에 새 동작을 심지 않는다(동작 불변).
 */
export function ModalBase({
  onClose, children, zIndex = 100, dim = OVERLAY_DIM, blur = false,
  pad = 16, align = 'center', animation, escClose = false,
  role, ariaModal, ariaLabel, ariaLabelledby, testid,
}: {
  /** backdrop 탭(및 escClose 시 ESC)에서 호출. 닫기 가드가 필요하면 호출부에서 조건을 감싼다. */
  onClose: () => void;
  children: ReactNode;
  zIndex?: number;
  /** 오버레이 dim 색 — OVERLAY_DIM* 토큰 사용. */
  dim?: string;
  blur?: boolean;
  /** 오버레이 safe-area 최소 패딩(px). null = 패딩 없음(풀블리드 하단 시트). */
  pad?: number | null;
  /** 'center' = 중앙 모달, 'end' = 하단 시트. */
  align?: 'center' | 'end';
  /** 예: 'fade-up 200ms ease-out'. 미지정 시 애니메이션 없음. */
  animation?: string;
  escClose?: boolean;
  role?: 'dialog';
  ariaModal?: boolean;
  ariaLabel?: string;
  ariaLabelledby?: string;
  testid?: string;
}) {
  useEffect(() => {
    if (!escClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [escClose, onClose]);

  return (
    <div
      onClick={onClose}
      data-testid={testid}
      role={role}
      aria-modal={ariaModal ? 'true' : undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      style={{
        position: 'fixed', inset: 0, zIndex,
        background: dim,
        ...(blur ? { backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' } : null),
        display: 'flex',
        alignItems: align === 'end' ? 'flex-end' : 'center',
        justifyContent: 'center',
        ...(pad === null ? null : {
          paddingTop: `max(${pad}px, var(--sat))`,
          paddingBottom: `max(${pad}px, var(--sab))`,
          paddingLeft: `max(${pad}px, var(--sal))`,
          paddingRight: `max(${pad}px, var(--sar))`,
        }),
        ...(animation ? { animation } : null),
      }}
    >
      {children}
    </div>
  );
}
