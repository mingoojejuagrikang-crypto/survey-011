import { useLayoutEffect, useRef } from 'react';
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
 *  초고대비 흰색 pill 채움(원거리에서 현재 탭 즉시 판독). v0.38.0 #6에서 가시 라벨은 제거하되
 *  aria-label·tab-* testid·최소 56px 타깃·safe-area 계약은 유지한다.
 *  v0.38.0 #6 — 불투명 chrome은 유지하되 EdgeGlow(z-54) 아래(z-53)에 놓아, 글로우가 네비를 포함한
 *  물리 화면 4변 끝까지 끊기지 않고 그려진다. 글로우가 pointer-events:none이라 탭 터치는 그대로다. */
export function TabBar({ tab, setTab }: Props) {
  // v0.37.0 FB-I(민구, "네비는 항상 보여야 함) — 나비의 **실측 높이**를 --nav-h로 발행(SSOT).
  //   수동 입력 시트(ModalBase bottomInset)가 이 값만큼 위로 올라앉아 나비를 덮지 않는다. 손계산은
  //   버튼 padding/border/폰트/노치(--sab)로 언더슈트해 나비 상단을 자르므로(잘림=실패 방향), 렌더된
  //   offsetHeight(패딩·보더·라이브 --sab 포함)를 ResizeObserver로 추종한다 — 회전·safe-area·폰트
  //   변화에도 정확. :root의 --nav-h:100px는 err-large 첫 페인트 폴백.
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty('--nav-h', `${el.offsetHeight}px`);
    publish();
    // v0.37.0 리뷰 #1(Codex) — 구형 WebView(ResizeObserver 미탑재)에서 앱 부트 크래시 방지.
    //   TabBar는 모든 화면에 마운트되므로 여기서 던지면 전 화면이 죽는다(PRINCIPLES §6 iOS Safari,
    //   v035-r3-fixes P2 "Observer 둘 다 없어도 크래시 없이 렌더" 계약). 리포 내 다른 RO 사용처
    //   (useFitScale·useChipFlowFit)와 동일하게 feature-detect하고, RO 미가용 시 window resize로 폴백
    //   추종한다(회전·safe-area 변화 재수렴). 초기 publish()는 위에서 이미 첫 페인트 값을 발행했다.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    if (!ro) window.addEventListener('resize', publish);
    return () => {
      ro?.disconnect();
      if (!ro) window.removeEventListener('resize', publish);
    };
  }, []);
  return (
    <div
      ref={barRef}
      data-testid="tab-bar"
      style={{
        // v0.38.0 #6 — EdgeGlow(fixed z-54)가 하단 물리 가장자리까지 네비 위로 통과한다. 불투명 배경과
        //   blur는 그대로라 네비 가독성을 잃지 않고, 모달/시트(55~120)는 계속 둘 다 덮는다.
        position: 'relative',
        zIndex: 53,
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
              alignItems: 'center',
              justifyContent: 'center',
              padding: '5px 0',
              cursor: 'pointer',
              color: active ? T.text : T.textDim,
              minHeight: 56,
            }}
          >
            <div
              style={{
                width: 58,
                height: 44,
                borderRadius: 22,
                background: active ? T.text : 'transparent',
                color: active ? T.bg : T.textDim,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 200ms, color 200ms',
              }}
            >
              {t.icon(28)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
