import { useEffect, useState } from 'react';
import { TabBar, type TabId } from './components/TabBar';
import { UpdateBanner } from './components/UpdateBanner';
import { SettingsScreen } from './screens/SettingsScreen';
import { VoiceScreen } from './screens/VoiceScreen';
import { DataScreen } from './screens/DataScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { T, DEVICE } from './tokens';
import { hydrateSessions } from './lib/hydrate';
import { logger } from './lib/logger';

export default function App() {
  const [tab, setTab] = useState<TabId>('settings');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 480);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 480);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Hydrate data store from IndexedDB once on mount. Errors are logged + recorded as
  // `hydrationError` (D-1) so DataScreen can offer a retry instead of a misleading empty state.
  // Auto-sync intentionally disabled — user explicitly picks sessions in DataScreen.
  useEffect(() => {
    // v0.5.0 W7(T-19): 앱 기동 계측 — 다음 로그 분석에서 "앱이 떴는데 세션이 없다"와
    // "앱 자체가 안 떴다"를 구분할 수 있게 한다.
    logger.log({ type: 'app', extra: 'app_boot', meta: { appVersion: logger.device().appVersion } });
    void hydrateSessions();
  }, []);

  const phoneStyle: React.CSSProperties = isMobile
    ? {
        width: '100vw',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: T.bg,
        color: T.text,
        // v0.15.0 A1 — standalone(홈화면 설치) safe-area 침범 방지. 브라우저 크롬이 없는
        // standalone에서 콘텐츠가 상태바·노치를 침범하던 문제. 상단/좌우만 셸에서 흡수하고,
        // 하단은 탭바가 max(28px, env(...))로 별도 처리한다(이중 패딩 방지). 일반 Safari 탭에선
        // env(...)가 0이라 무영향. 가로 inset은 노치 가로방향 안전마진(앱은 portrait 고정이지만 방어).
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }
    : {
        width: DEVICE.width,
        height: DEVICE.height,
        margin: '20px auto',
        borderRadius: 36,
        background: T.bg,
        color: T.text,
        boxShadow: `0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)`,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      };

  return (
    <div style={phoneStyle}>
      {/* v0.18.0 1f — 비강제 "새 버전" 배너(상단 고정, 모든 탭 공통). 새 SW waiting 시에만 노출. */}
      <UpdateBanner />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* v0.32.0 설정탭 UX(Vance) B4 — 생성 완료 후 다음 단계(입력탭) 이동 버튼. 자동 탭 전환은
            하지 않는다(민구 확정) — 사용자가 버튼으로 명시 이동. */}
        {tab === 'settings' && <SettingsScreen onNavigateToInput={() => setTab('voice')} />}
        {tab === 'voice' && <VoiceScreen />}
        {tab === 'data' && <DataScreen />}
        {tab === 'review' && <ReviewScreen />}
      </div>
      <TabBar tab={tab} setTab={setTab} />
    </div>
  );
}
