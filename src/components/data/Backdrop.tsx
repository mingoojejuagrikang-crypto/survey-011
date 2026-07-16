import { ModalBase, OVERLAY_DIM_SOFT } from '../ModalBase';

/** 데이터탭 공용 backdrop — ModalBase 셸(Stage 2 통합)에 데이터탭 프리셋(dim 0.55+blur+fade-up)만
 *  고정한 thin 래퍼. v0.33.0 safe-area 계약(패딩 max(16px, var(--sa*)))은 ModalBase가 소유. */
export function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <ModalBase onClose={onClose} dim={OVERLAY_DIM_SOFT} blur animation="fade-up 200ms ease-out">
      {children}
    </ModalBase>
  );
}
