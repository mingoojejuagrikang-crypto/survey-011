import { T } from '../../tokens';
import { ABSORB_CLAMP } from './heroLayout';

/** v0.15.0 A5 — 일시정지 상태를 화면 중앙·대형 카드로 안내한다. 기존 상단 작은 'PAUSE' 표시를 대체.
 *  톤은 AMBER(일시정지=주의/대기, 이상치 RED·수정 BLUE와 구분). 그 아래 후속 음성명령('재시작'으로
 *  재개 / '종료'로 저장)을 안내해, 화면을 보지 않아도/봐도 다음 행동을 알 수 있게 한다.
 *  v0.23.0 입력탭#1(중앙 흡수, Vance): 기존 position:fixed; inset:0 + safe-area 오버레이를 제거하고
 *   카드만 반환한다. ActiveState 중앙 흡수영역(grid row3, 1fr, overflow:hidden)이 자식으로 직접
 *   렌더·중앙 정렬한다(safe-area는 셸 패딩이 이미 흡수 — fixed가 아니므로 노치 침범 없음). 흡수영역
 *   가용 높이에 맞춰(ABSORB_CLAMP) 짧은 기기에서도 잘리지 않고 내부 스크롤. 비대화형은 부모가 처리
 *   하므로 카드 자체엔 pointerEvents 지정 불필요(하단 컨트롤바는 흡수영역 밖이라 항상 탭 가능). */
export function PausedCard() {
  return (
    <div
      data-testid="paused-card"
      aria-live="polite"
      style={{
        // v0.23.0 — 중앙 흡수영역 가용 높이에 맞춤(부모 overflow:hidden 클립 방지).
        maxWidth: 'min(560px, 94vw)', width: '100%', ...ABSORB_CLAMP,
        padding: '24px 30px', borderRadius: 18,
        background: 'rgba(40,32,12,0.96)', border: `2px solid ${T.amber}`,
        boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 22, color: T.amber }} aria-hidden>⏸</span>
        <span
          style={{
            fontSize: 'clamp(30px, 8vw, 44px)', fontWeight: 900, color: T.text,
            letterSpacing: -0.5, lineHeight: 1.1, wordBreak: 'keep-all',
          }}
        >
          일시정지
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 16, color: T.textDim, fontWeight: 600, textAlign: 'center', lineHeight: 1.5 }}>
          <b style={{ color: T.amber }}>"재시작"</b> 이라고 말하면 이어서 진행
        </span>
        <span style={{ fontSize: 16, color: T.textDim, fontWeight: 600, textAlign: 'center', lineHeight: 1.5 }}>
          <b style={{ color: T.amber }}>"종료"</b> 라고 말하면 저장하고 끝냅니다
        </span>
      </div>
    </div>
  );
}
