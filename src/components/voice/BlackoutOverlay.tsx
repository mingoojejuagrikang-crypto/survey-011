import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_TYPE } from './heroLayout';

/**
 * v0.46.0 WP-F — **검은 화면 모드**(제보 F13② · 민구 R2 확정)
 *
 * 화면만 끄고 **음성 세션은 계속 돈다.** 장시간 현장 세션의 배터리·발열을 줄이는 것이 목적이고,
 * 부수적으로 **주머니 오터치를 막는다**(이 오버레이가 화면 전체를 덮으므로 아래 버튼에 터치가
 * 닿지 않는다 — 개별 버튼을 비활성화하지 않는다).
 *
 * 🔴 **해제는 「길게 누르기 + 차오르는 원」이다** (민구 08-05 확정). 후보 비교는 플랜 §3-F:
 *  - 두 번 탭 → 주머니에서도 두 번 눌린다(옷 스침은 연속 접촉)
 *  - 스와이프 → 장갑 낀 손에 불리
 *  - 근접센서 → 웹에서 못 쓴다(iOS Safari 미지원)
 * 🔑 **차오르는 원이 사양의 절반이다** — 피드백이 없으면 *"왜 안 켜지지"* 가 된다.
 *
 * ⚠️ **하단 버튼을 비활성화하지 않는 이유**(민구가 내 주장을 약화시켰다):
 *    *"종료 버튼은 잘못 눌려도 확인 취소 버튼이 추가로 출력되고 있어."* → 종료는 2단계라
 *    우발 1회로 끝나지 않는다. 오버레이가 터치를 삼키는 것으로 충분하다.
 *
 * 🔴 **OLED 절전이 목적이므로 배경은 순수 검정(#000)이고 힌트는 최소 밝기다.**
 *    켜진 화소가 곧 전력이다 — 힌트를 밝게 하면 이 기능의 존재 이유가 줄어든다.
 */

/** 해제까지 눌러야 하는 시간. 민구 확정 구간 0.8~1초의 중앙값. */
const HOLD_MS = 900;

const RING_R = 34;
const RING_C = 2 * Math.PI * RING_R;

export function BlackoutOverlay({ onRelease }: { onRelease: () => void }) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  /** 해제가 이미 발화했는지 — rAF 한 프레임이 더 돌아 onRelease가 두 번 불리는 것을 막는다. */
  const firedRef = useRef(false);

  const stopHold = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setProgress(0);
  }, []);

  const beginHold = useCallback(() => {
    if (rafRef.current !== null || firedRef.current) return;
    startRef.current = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - startRef.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        rafRef.current = null;
        firedRef.current = true;
        onRelease();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [onRelease]);

  // 언마운트 시 rAF 정리 — 남으면 화면이 꺼진 뒤에도 프레임이 돈다(이 기능의 목적과 정반대다).
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div
      data-testid="blackout-overlay"
      role="button"
      tabIndex={0}
      aria-label="검은 화면 모드입니다. 음성 입력은 계속되고 있습니다. 화면을 길게 눌러 다시 켭니다"
      onPointerDown={beginHold}
      onPointerUp={stopHold}
      onPointerCancel={stopHold}
      onPointerLeave={stopHold}
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
      <svg width={80} height={80} aria-hidden="true" data-testid="blackout-ring">
        <circle cx={40} cy={40} r={RING_R} fill="none" stroke="#1c1c1c" strokeWidth={4} />
        <circle
          cx={40}
          cy={40}
          r={RING_R}
          fill="none"
          stroke="#3d6ea8"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - progress)}
          transform="rotate(-90 40 40)"
          data-testid="blackout-progress"
          data-progress={progress.toFixed(3)}
        />
      </svg>
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
        길게 눌러 화면 켜기
        <br />
        음성 입력은 계속됩니다
      </div>
    </div>
  );
}
