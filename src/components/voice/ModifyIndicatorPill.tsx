import { T } from '../../tokens';
import { heroFontSize, ABSORB_CLAMP } from './heroLayout';
import { useFitScale } from './useFitScale';

/** v0.12.0 AREA2 V4 — 수정 재안내 중 어떤 항목을 다시 말해야 하는지 알리는 안내.
 *  v0.14.0 E(민구 요청) — 모든 알람/안내를 화면 중앙·최대 크기로 통일. 기존 상단 작은 pill을
 *  이상치 팝업과 같은 중앙 대형 카드로 교체(톤은 BLUE로 구분 — 수정은 오류가 아니라 재입력 안내).
 *  v0.23.0 입력탭#1(중앙 흡수, Vance): 기존 position:fixed; inset:0 오버레이를 제거하고 카드만
 *   반환한다. ActiveState 중앙 흡수영역(grid row3, 1fr, overflow:hidden)이 자식으로 직접 렌더·중앙
 *   정렬한다. 컴포넌트명은 호환 위해 ...Pill 유지하나 실 렌더는 대형 카드다.
 *  v0.27.0 무스크롤·반응형(민구 07-03): 양손 측정 중이라 스크롤 불가 → 고정 px를 vh/vw clamp로
 *   비례화 + useFitScale로 넘칠 때만 축소(새값·항목명=--fit-hi 완만, 직전값·보조문=--fit-lo 먼저).
 *   스크롤 잔여 0(scrollHeight ≤ clientHeight) 보장, ellipsis 잘림 금지. */
export function ModifyIndicatorPill({ name, prevValue, newValue }: { name: string; prevValue?: string; newValue?: string }) {
  // v0.17.0 A-hero: 정정 구간 두 국면을 한 카드로 표현한다(이 카드가 정정 내내 화면을 점유 — hero와
  //   z-fight 없음). ① 재프롬프트(새 값 아직): "수정 — 다시 말해주세요" + 항목명.
  //   ② 새 값 도착(echo 구간): 직전값(취소선·mute) → ↓(amber) → 새값(거대·amber) + "↺ 정정되었습니다".
  const committed = !!newValue && newValue !== prevValue;
  const accent = committed ? T.amber : T.blue;
  const fitRef = useFitScale<HTMLDivElement>([name, prevValue, newValue]);
  return (
    <div
      ref={fitRef}
      data-testid="modify-indicator"
      aria-live="polite"
      style={{
        // v0.23.0 — 중앙 흡수영역 가용 높이에 맞춤(부모 overflow:hidden 클립 방지).
        maxWidth: 'min(560px, 94vw)', width: '100%', ...ABSORB_CLAMP,
        padding: 'clamp(12px, 2.4vh, 20px) clamp(16px, 4.6vw, 28px)', borderRadius: 18,
        background: committed ? 'rgba(40,32,12,0.96)' : 'rgba(18,26,40,0.96)',
        border: `2px solid ${accent}`,
        boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', gap: 'clamp(4px, 0.8vh, 8px)', alignItems: 'center',
      }}
    >
      {/* 항목명 + 타입(읽기 일관) — 헤더는 보조 식별선 → --fit-lo. 줄바꿈 허용(잘림 금지). */}
      <span
        style={{
          fontSize: 'calc(clamp(14px, 2.1vh, 18px) * var(--fit-lo, 1))', fontWeight: 800, color: accent, letterSpacing: -0.2,
          maxWidth: '100%', textAlign: 'center', wordBreak: 'keep-all', overflowWrap: 'anywhere', lineHeight: 1.25,
        }}
      >
        {committed ? `${name} 정정` : '수정 — 다시 말해주세요'}
      </span>
      {committed ? (
        <>
          {/* 직전값(취소선) = 하위 우선 → --fit-lo(새값보다 먼저 축소). 줄바꿈 허용. */}
          {prevValue && (
            <span
              style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 'calc(clamp(20px, min(7vw, 4.6vh), 38px) * var(--fit-lo, 1))', fontWeight: 700,
                color: T.textMute, textDecoration: 'line-through', letterSpacing: -0.5,
                maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word', textAlign: 'center', lineHeight: 1.1,
              }}
            >
              {prevValue}
            </span>
          )}
          <span style={{ fontSize: 'calc(clamp(14px, 2.2vh, 18px) * var(--fit-lo, 1))', color: T.amber, lineHeight: 1 }} aria-hidden>↓</span>
          {/* 새값 = 최우선 정보 → --fit-hi(가장 늦게 축소). heroFontSize는 vh 상한 결합(heroLayout). */}
          <span
            style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: `calc(${heroFontSize(newValue || '')} * var(--fit-hi, 1))`,
              fontWeight: 800, color: T.amber, letterSpacing: -1, lineHeight: 1.05,
              maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word', textAlign: 'center',
              animation: 'chip-pop 320ms ease-out',
            }}
          >
            {newValue}
          </span>
          <span style={{ fontSize: 'calc(clamp(12px, 1.8vh, 15px) * var(--fit-lo, 1))', fontWeight: 800, color: T.amber, marginTop: 2 }}>↺ 정정되었습니다</span>
        </>
      ) : (
        // 재프롬프트 항목명 = 최우선(무엇을 다시 말할지) → --fit-hi. vh 상한 결합.
        <span
          style={{
            fontSize: 'calc(clamp(30px, min(9vw, 6.2vh), 52px) * var(--fit-hi, 1))', fontWeight: 900, color: T.text,
            letterSpacing: -0.5, textAlign: 'center', maxWidth: '100%',
            wordBreak: 'keep-all', overflowWrap: 'anywhere', lineHeight: 1.15,
          }}
        >
          {name}
        </span>
      )}
    </div>
  );
}
