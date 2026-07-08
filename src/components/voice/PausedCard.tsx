import { T } from '../../tokens';
import { ABSORB_CLAMP } from './heroLayout';
import { useFitScale } from './useFitScale';

/** v0.15.0 A5 — 일시정지 상태를 화면 중앙·대형 카드로 안내한다. 기존 상단 작은 'PAUSE' 표시를 대체.
 *  톤은 AMBER(일시정지=주의/대기, 이상치 RED·수정 BLUE와 구분). 그 아래 후속 음성명령('재시작'으로
 *  재개 / '종료'로 저장)을 안내해, 화면을 보지 않아도/봐도 다음 행동을 알 수 있게 한다.
 *  v0.23.0 입력탭#1(중앙 흡수, Vance): 기존 position:fixed; inset:0 + safe-area 오버레이를 제거하고
 *   카드만 반환한다. ActiveState 중앙 흡수영역(grid row3, 1fr, overflow:hidden)이 자식으로 직접
 *   렌더·중앙 정렬한다(safe-area는 셸 패딩이 이미 흡수 — fixed가 아니므로 노치 침범 없음).
 *  v0.27.0 무스크롤·반응형(민구 07-03): 양손 측정 중이라 스크롤 불가 → 고정 px 폰트를 vh/vw clamp로
 *   비례화하고, useFitScale이 넘칠 때만(--fit-lo 안내문 먼저, --fit-hi 상태명 완만) 축소해 스크롤
 *   잔여 0을 보장한다(가로모드·iOS 텍스트 확대 내성). 하단 컨트롤바는 흡수영역 밖이라 항상 탭 가능. */
export function PausedCard({ row, colName }: { row?: number; colName?: string }) {
  const fitRef = useFitScale<HTMLDivElement>([row, colName]);
  const target = row && colName ? `${row}행 · ${colName}` : colName || (row ? `${row}행` : '');
  return (
    <div
      ref={fitRef}
      data-testid="paused-card"
      aria-live="polite"
      style={{
        // v0.23.0 — 중앙 흡수영역 가용 높이에 맞춤(부모 overflow:hidden 클립 방지).
        maxWidth: 'min(560px, 94vw)', width: '100%', ...ABSORB_CLAMP,
        padding: 'clamp(12px, 2.6vh, 24px) clamp(16px, 5vw, 30px)', borderRadius: 18,
        background: 'rgba(40,32,12,0.96)', border: `2px solid ${T.amber}`,
        boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', gap: 'clamp(6px, 1.2vh, 10px)', alignItems: 'center',
        animation: 'card-breathe-amber 2.6s ease-in-out infinite',
      }}
    >
      <span
        style={{
          fontSize: 'max(14px, calc(clamp(17px, min(4.6vw, 2.6vh), 24px) * var(--fit-lo, 1)))',
          fontWeight: 900,
          color: T.amber,
          letterSpacing: -0.2,
          lineHeight: 1.12,
          wordBreak: 'keep-all',
        }}
      >
        일시정지
      </span>
      {target && (
        <span
          style={{
            fontSize: 'calc(clamp(30px, min(10vw, 6.6vh), 54px) * var(--fit-hi, 1))',
            fontWeight: 950,
            color: T.text,
            letterSpacing: -0.8,
            lineHeight: 1.06,
            wordBreak: 'keep-all',
            overflowWrap: 'anywhere',
            textAlign: 'center',
            maxWidth: '100%',
          }}
        >
          {target}
        </span>
      )}
      <span
        style={{
          fontSize: 'max(13px, calc(clamp(15px, min(4vw, 2.3vh), 20px) * var(--fit-lo, 1)))',
          color: T.textDim,
          fontWeight: 800,
          lineHeight: 1.2,
          wordBreak: 'keep-all',
        }}
      >
        재시작 또는 종료
      </span>
    </div>
  );
}
