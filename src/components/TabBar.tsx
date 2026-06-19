import { T } from '../tokens';
import { I } from './icons';

export type TabId = 'settings' | 'voice' | 'data' | 'review';

interface Props {
  tab: TabId;
  setTab: (t: TabId) => void;
}

const tabs: { id: TabId; label: string; icon: (s?: number, c?: string) => JSX.Element }[] = [
  { id: 'settings', label: '설정', icon: I.settings },
  { id: 'voice', label: '입력', icon: I.mic },
  { id: 'data', label: '데이터', icon: I.data },
  // 비교 탭 v0.12 숨김 — 재구축 시 해제 (TabId 'review' 유니온·ReviewScreen·persist는 유지)
  // { id: 'review', label: '비교', icon: I.search },
];

export function TabBar({ tab, setTab }: Props) {
  return (
    <div
      style={{
        // v0.15.0 A1 — 하단 홈인디케이터 safe-area. 기존 28px는 디자인 클리어런스(홈인디케이터
        // 가정값)였고 standalone 노치 기기에선 실제 inset이 더 클 수 있어 max()로 둘 중 큰 값을 쓴다.
        // env(...)는 일반 Safari 탭에서 0이라 28px가 그대로 유지된다(무회귀). minHeight로 바꿔 inset이
        // 28을 넘으면 바가 자라 내부 아이콘/라벨이 잘리지 않게 한다.
        minHeight: 88,
        paddingBottom: 'max(28px, env(safe-area-inset-bottom, 0px))',
        paddingTop: 4,
        background: 'rgba(14,15,17,0.92)',
        backdropFilter: 'blur(20px) saturate(160%)',
        WebkitBackdropFilter: 'blur(20px) saturate(160%)',
        borderTop: `1px solid ${T.line}`,
        display: 'flex',
        flexShrink: 0,
      }}
    >
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '6px 0',
              cursor: 'pointer',
              color: active ? T.blue : T.textMute,
              minHeight: 48,
            }}
          >
            <div
              style={{
                width: 44,
                height: 30,
                borderRadius: 15,
                background: active ? T.blueGlow : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 200ms',
              }}
            >
              {t.icon(24)}
            </div>
            <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, letterSpacing: 0.1 }}>
              {t.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}
