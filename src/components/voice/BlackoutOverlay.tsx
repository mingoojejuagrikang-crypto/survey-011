import { useCallback, type PointerEvent } from 'react';
import { VOICE_TYPE } from './heroLayout';

/**
 * v0.46.0 WP-F — **검은 화면 모드**(제보 F13② · 민구 R2 확정)
 *
 * 화면만 끄고 **음성 세션은 계속 돈다.** 장시간 현장 세션의 배터리·발열을 줄이는 것이 목적이고,
 * 부수적으로 **주머니 오터치를 막는다**(이 오버레이가 화면 전체를 덮으므로 아래 버튼에 터치가
 * 닿지 않는다 — 개별 버튼을 비활성화하지 않는다).
 *
 * 🔴 **v0.47.0 W7 — 해제가 「길게 누르기」에서 「중앙 영역 짧은 탭」으로 바뀌었다** (민구 08-08).
 *
 *  민구 원문: *"화면 꺼진 상태에서 중앙 영역 잠깐이라도 터치하면 화면 켬으로 하자."*
 *
 *  ⏹ **종전 근거와 무엇이 달라졌나**(08-05 확정을 뒤집는 것이므로 그 논증을 남긴다):
 *   - 종전 기각 사유는 *"두 번 탭 → 주머니에서도 두 번 눌린다(옷 스침은 연속 접촉)"* 였고,
 *     그래서 0.9초 홀드 + 차오르는 원이 채택됐다. **오터치 방어가 홀드의 존재 이유였다.**
 *   - 08-08 확정은 그 방어를 **위치**로 옮긴다: 화면 **중앙 영역**만 받고 가장자리는 무시한다.
 *     주머니·팔 스침은 가장자리에 닿는다는 것이 이 설계의 전제다(🟡 가정 — 계획서 명시).
 *   - 🔑 대가가 분명하다: 홀드보다 **오터치에 약하다.** 대신 장갑 낀 손·급할 때의 복귀가
 *     즉시가 된다. 민구가 그 교환을 선택했다.
 *
 * ## 중앙 히트존 정의 (402×513 기준)
 * 뷰포트의 **가로 60% × 세로 50%**를 중앙 정렬한 사각형 = 402×513에서 **241×257px**.
 * 가장자리 여백은 좌우 각 80px · 상하 각 128px이다. 이 밖의 터치는 **아무 핸들러도 없다**
 * (무시가 기본값이지 조건문이 아니다 — 조건문은 언젠가 반대로 뒤집힌다).
 *
 * ⚠️ **하단 버튼을 비활성화하지 않는 이유**(민구가 내 주장을 약화시켰다):
 *    *"종료 버튼은 잘못 눌려도 확인 취소 버튼이 추가로 출력되고 있어."* → 종료는 2단계라
 *    우발 1회로 끝나지 않는다. 오버레이가 터치를 삼키는 것으로 충분하다.
 *
 * 🔴 **OLED 절전이 목적이므로 배경은 순수 검정(#000)이고 힌트는 최소 밝기다.**
 *    켜진 화소가 곧 전력이다 — 힌트를 밝게 하면 이 기능의 존재 이유가 줄어든다.
 */

/** 중앙 히트존 비율(뷰포트 대비). 위 §중앙 히트존 정의가 이 두 수의 SSOT다. */
const CENTER_HIT_W = '60%';
const CENTER_HIT_H = '50%';

/** 해제 탭이 **아래 UI로 전파되지 않게** 한다(위험 축 ④).
 *
 *  🔴 왜 필요한가: 터치 한 번은 `pointerdown → pointerup → mousedown → mouseup → click`을
 *  순서대로 낸다. 우리가 `pointerup`에서 오버레이를 걷으면 뒤따르는 **`click`은 그 자리에
 *  있던 다른 요소로 간다**(고스트 클릭). 검은 화면 중앙 아래에는 히어로가 있고 그 아래
 *  트랙에는 종료·일시정지 버튼이 산다 — 화면을 켜려던 탭이 세션을 건드리면 사고다.
 *  캡처 단계에서 다음 click 한 번을 삼키고 400ms 뒤 스스로 물러난다. */
function swallowGhostClick(): void {
  const onClick = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    window.removeEventListener('click', onClick, true);
  };
  window.addEventListener('click', onClick, true);
  window.setTimeout(() => window.removeEventListener('click', onClick, true), 400);
}

export function BlackoutOverlay({ onRelease }: { onRelease: () => void }) {
  /** 🔴 `pointerup`에서 푼다(`pointerdown`이 아니라). down에서 풀면 같은 제스처의 up·click이
   *  **이미 사라진 오버레이 자리**로 떨어져 아래 UI를 때린다. up + 고스트 클릭 차단이 짝이다. */
  const release = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary) return;
    e.preventDefault();
    e.stopPropagation();
    swallowGhostClick();
    onRelease();
  }, [onRelease]);

  return (
    <div
      data-testid="blackout-overlay"
      role="button"
      tabIndex={0}
      aria-label="검은 화면 모드입니다. 음성 입력은 계속되고 있습니다. 화면 가운데를 탭하면 다시 켭니다"
      // 🔴 v0.46.0 콜드 리뷰 L3-5 — `role="button"` + `tabIndex={0}`을 선언했는데 **키 핸들러가
      //    없었다.** 탈출 경로가 하나뿐인 화면에서 그 약속을 어기면 포인터를 못 쓰는 경로는
      //    **앱에 갇힌다.** v0.47.0 W7에서 포인터 계약이 「탭」이 됐으므로 키보드도 **누르는
      //    즉시** 해제한다(둘의 의미를 일치시킨다 — 종전에는 둘 다 「길게」였다).
      //    🟢 갇힘 방지 계약(`v0460-cr-blackout-escape` ④)은 그대로다: Enter를 눌러 보고 있으면
      //    나온다. 키보드에는 「가장자리」가 없으므로 위치 조건도 없다.
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRelease(); }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        // 🔴 OLED에서 검은 화소는 꺼진다 — 이 값이 절전의 본체다.
        background: '#000',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        // 길게 누르는 동안 iOS가 텍스트 선택·확대 메뉴를 띄우지 않게.
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'none',
        cursor: 'pointer',
      }}
    >
      {/* 🔴 **해제를 받는 유일한 노드.** 오버레이 루트에는 포인터 핸들러가 없다 —
          가장자리 무시는 «조건문»이 아니라 «핸들러의 부재»로 구현한다. 조건문은 리팩토링에서
          뒤집히지만 부재는 뒤집히지 않는다.
          🔑 이 상자가 곧 **어디를 눌러야 하는지의 시각 안내**이기도 하다. 가장자리를 무시하는
          설계에서 «중앙이 어디인가»를 안 보여주면 사용자는 «왜 안 켜지지»에 갇힌다
          (차오르는 원이 사양의 절반이었던 것과 같은 이유). */}
      <div
        data-testid="blackout-center-hit"
        onPointerUp={release}
        style={{
          width: CENTER_HIT_W,
          height: CENTER_HIT_H,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          // 최소 밝기 테두리 — «여기» 를 말하는 데 필요한 최소한만 켠다(OLED 절전 계약).
          border: '1px solid #141414',
          borderRadius: 20,
          touchAction: 'none',
          cursor: 'pointer',
        }}
      >
        <div
          data-testid="blackout-hint"
          style={{
            fontSize: VOICE_TYPE.caption,
            fontWeight: 700,
            color: '#3a3a3a',
            textAlign: 'center',
            lineHeight: 1.5,
            padding: '0 24px',
          }}
        >
          가운데를 탭하면 화면이 켜집니다
          <br />
          음성 입력은 계속됩니다
        </div>
      </div>
    </div>
  );
}
