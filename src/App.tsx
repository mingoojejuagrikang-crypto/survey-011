import { useEffect, useState } from 'react';
import { TabBar, type TabId } from './components/TabBar';
import { SettingsScreen } from './screens/SettingsScreen';
import { VoiceScreen } from './screens/VoiceScreen';
import { DataScreen } from './screens/DataScreen';
import { T, DEVICE } from './tokens';
import { hydrateSessions } from './lib/hydrate';

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
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'settings' && <SettingsScreen />}
        {tab === 'voice' && <VoiceScreen />}
        {tab === 'data' && <DataScreen />}
      </div>
      <TabBar tab={tab} setTab={setTab} />
    </div>
  );
}
