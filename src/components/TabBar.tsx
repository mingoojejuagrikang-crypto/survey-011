import { T } from '../tokens';
import { I } from './icons';

export type TabId = 'settings' | 'voice' | 'data' | 'feedback';

interface Props {
  tab: TabId;
  setTab: (t: TabId) => void;
}

const tabs: { id: TabId; label: string; icon: (s?: number, c?: string) => JSX.Element }[] = [
  { id: 'settings', label: '설정', icon: I.settings },
  { id: 'voice', label: '입력', icon: I.mic },
  { id: 'data', label: '업로드', icon: I.data },
  // v0.33.0 항목11 — 개선요청. 화면 전환 없는 팝업 방식(민구 확정): App.tsx가 setTab 없이
  // 인터셉트해 현재 화면 위에 캡처+FeedbackModal을 띄운다 → active 하이라이트가 생기지 않는다.
  { id: 'feedback', label: '개선요청', icon: I.feedback },
];

/** v0.36.0 코덱스 시안(2026-07-20, 민구 확정) — 탭바 심볼 중심(§7.3): 아이콘을 키우고 선택 탭은
 *  초고대비 흰색 pill 채움(원거리에서 현재 탭 즉시 판독). 라벨은 소형으로 유지 — 4탭(개선요청 포함)
 *  구분과 기존 텍스트 셀렉터 계약을 지킨다. tab-* testid·최소 56px 타깃·safe-area 불변. */
export function TabBar({ tab, setTab }: Props) {
  return (
    <div
      style={{
        // v0.37.0 FB-I(민구) — full-bleed EdgeGlow(fixed z-54)가 하단 나비 위를 씻고 지나가지 않도록
        //   지속 chrome(나비)를 글로우와 같은 대역(z-54)에 두되 App DOM 순서상 VoiceScreen보다 뒤라
        //   같은 z에서 나비가 위에 그려진다(나비 '유지'/선명). 모달/시트(55~120)는 여전히 나비를 덮는다.
        position: 'relative',
        zIndex: 54,
        // v0.15.0 A1 — 하단 홈인디케이터 safe-area(max(28px, --sab)). minHeight로 inset 초과 시 성장.
        minHeight: 88,
        paddingBottom: 'max(28px, var(--sab))',
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
            aria-label={t.label}
            aria-current={active ? 'page' : undefined}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              padding: '5px 0',
              cursor: 'pointer',
              color: active ? T.text : T.textDim,
              minHeight: 56,
            }}
          >
            <div
              style={{
                width: 58,
                height: 34,
                borderRadius: 17,
                background: active ? T.text : 'transparent',
                color: active ? T.bg : T.textDim,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 200ms, color 200ms',
              }}
            >
              {t.icon(25)}
            </div>
            <div style={{ fontSize: 13, fontWeight: active ? 800 : 600, letterSpacing: 0.1 }}>
              {t.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}
