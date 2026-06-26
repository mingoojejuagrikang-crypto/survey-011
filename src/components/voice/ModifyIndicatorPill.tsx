import { T } from '../../tokens';
import { heroFontSize, ABSORB_CLAMP } from './heroLayout';

/** v0.12.0 AREA2 V4 — 수정 재안내 중 어떤 항목을 다시 말해야 하는지 알리는 안내.
 *  v0.14.0 E(민구 요청) — 모든 알람/안내를 화면 중앙·최대 크기로 통일. 기존 상단 작은 pill을
 *  이상치 팝업과 같은 중앙 대형 카드로 교체(톤은 BLUE로 구분 — 수정은 오류가 아니라 재입력 안내).
 *  v0.23.0 입력탭#1(중앙 흡수, Vance): 기존 position:fixed; inset:0 오버레이를 제거하고 카드만
 *   반환한다. ActiveState 중앙 흡수영역(grid row3, 1fr, overflow:hidden)이 자식으로 직접 렌더·중앙
 *   정렬한다. 흡수영역 가용 높이에 맞춰(ABSORB_CLAMP) 짧은 기기/긴 음수소수(-355.5 등)에서도 부모에
 *   잘리지 않고 내부 스크롤. (이전: min(70vh,520px) 캡 — 375px 세로에서 70vh가 트랙보다 커 잔여 클립
 *   위험.) 컴포넌트명은 호환 위해 ...Pill 유지하나 실 렌더는 대형 카드다. */
export function ModifyIndicatorPill({ name, prevValue, newValue }: { name: string; prevValue?: string; newValue?: string }) {
  // v0.17.0 A-hero: 정정 구간 두 국면을 한 카드로 표현한다(이 카드가 정정 내내 화면을 점유 — hero와
  //   z-fight 없음). ① 재프롬프트(새 값 아직): "수정 — 다시 말해주세요" + 항목명.
  //   ② 새 값 도착(echo 구간): 직전값(취소선·mute) → ↓(amber) → 새값(거대·amber) + "↺ 정정되었습니다".
  const committed = !!newValue && newValue !== prevValue;
  const accent = committed ? T.amber : T.blue;
  return (
    <div
      data-testid="modify-indicator"
      aria-live="polite"
      style={{
        // v0.23.0 — 중앙 흡수영역 가용 높이에 맞춤(부모 overflow:hidden 클립 방지).
        maxWidth: 'min(560px, 94vw)', width: '100%', ...ABSORB_CLAMP,
        padding: '20px 28px', borderRadius: 18,
        background: committed ? 'rgba(40,32,12,0.96)' : 'rgba(18,26,40,0.96)',
        border: `2px solid ${accent}`,
        boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
      }}
    >
      {/* 항목명 + 타입(읽기 일관)
          v0.22.0(P2 잘림 점검): 긴 항목명("과실 횡경 평균값" 등)도 헤더에서 잘리지 않게 줄바꿈 허용. */}
      <span
        style={{
          fontSize: 17, fontWeight: 800, color: accent, letterSpacing: -0.2,
          maxWidth: '100%', textAlign: 'center', wordBreak: 'keep-all', overflowWrap: 'anywhere', lineHeight: 1.25,
        }}
      >
        {committed ? `${name} 정정` : '수정 — 다시 말해주세요'}
      </span>
      {committed ? (
        <>
          {/* v0.22.0(P2 잘림 점검): 직전/새 값 ellipsis→줄바꿈(긴 값도 잘림 0, 박스 안에서 줄바꿈). */}
          {prevValue && (
            <span
              style={{
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 'clamp(22px, 7vw, 38px)', fontWeight: 700,
                color: T.textMute, textDecoration: 'line-through', letterSpacing: -0.5,
                maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word', textAlign: 'center', lineHeight: 1.1,
              }}
            >
              {prevValue}
            </span>
          )}
          <span style={{ fontSize: 18, color: T.amber, lineHeight: 1 }} aria-hidden>↓</span>
          <span
            style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              fontSize: heroFontSize(newValue || ''),
              fontWeight: 800, color: T.amber, letterSpacing: -1, lineHeight: 1.05,
              maxWidth: '100%', overflowWrap: 'anywhere', wordBreak: 'break-word', textAlign: 'center',
              animation: 'chip-pop 320ms ease-out',
            }}
          >
            {newValue}
          </span>
          <span style={{ fontSize: 15, fontWeight: 800, color: T.amber, marginTop: 2 }}>↺ 정정되었습니다</span>
        </>
      ) : (
        <span
          style={{
            fontSize: 'clamp(34px, 9vw, 52px)', fontWeight: 900, color: T.text,
            letterSpacing: -0.5, textAlign: 'center', maxWidth: '100%',
            wordBreak: 'keep-all', lineHeight: 1.15,
          }}
        >
          {name}
        </span>
      )}
    </div>
  );
}
