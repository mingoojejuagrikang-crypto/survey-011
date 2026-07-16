
export function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // v0.33.0 safe-area — position:fixed라 App 셸 패딩 밖. 노치/홈인디케이터 침범 방지
        //   (SettingsScreen backdrop 패턴). 일반 Safari 탭에선 var(--sa*)=0 → 기존 16px 유지.
        paddingTop: 'max(16px, var(--sat))',
        paddingBottom: 'max(16px, var(--sab))',
        paddingLeft: 'max(16px, var(--sal))',
        paddingRight: 'max(16px, var(--sar))',
        animation: 'fade-up 200ms ease-out',
      }}
    >
      {children}
    </div>
  );
}
