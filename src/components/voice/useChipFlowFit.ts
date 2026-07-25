import { useLayoutEffect, useRef, type DependencyList } from 'react';

/** v0.36.0 코덱스 시안(2026-07-20, 민구 확정) — 칩 플로우(voice-chip-grid)의 글자 배율 훅.
 *  민구 칩 스펙(와이어프레임 §공통규칙4로 갱신): 유동 폭 pill 플로우는 **2줄까지 표시**하고, 넘치면 영역 안 스크롤. 그 전에
 *  칩 수·길이에 따라 글자 크기를 배율(--chip-fit)로 단계 축소해 가능한 한 2줄 안에 들어오게 한다.
 *  (영역 높이는 칩존 트랙 25%가 담당 — 이 훅은 배율만.)
 *
 *  useFitScale과 같은 계약: 실제 폰트 크기를 줄여 reflow로 수렴(최대 5회, layout effect라 페인트 전
 *  플래시 없음). ResizeObserver/resize로 뷰포트 변화에 재수렴. 하한(0.68)은 칩 쪽 max() 플로어와
 *  함께 가독 한계(≥11px)를 지킨다 — 하한에서도 2줄을 넘으면 스크롤이 이어받는다. */
const CHIP_FIT_STEPS = [1, 0.92, 0.84, 0.76, 0.68] as const;
/** 와이어프레임 §공통규칙4 — 칩존은 **2줄 표시**다(v0.37.0 FB-B의 2줄 캡을 와이어프레임이 확정).
 *  하한 배율에서도 2줄을 넘으면 스크롤이 이어받는다(2줄 유지 + 초과분 스크롤). */
const MAX_ROWS = 2;

export function useChipFlowFit<T extends HTMLElement>(deps: DependencyList) {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    // 리뷰 라운드1(Flash, 수용) — offsetTop을 정확 일치(Set)로 세면 서브픽셀/보더 차이로 같은 줄이
    // 다른 줄로 오판돼 과잉 축소된다. 8px 톨러런스 클러스터링으로 줄 수를 계산한다.
    const ROW_TOLERANCE_PX = 8;
    const rowCount = () => {
      const tops: number[] = [];
      for (const child of Array.from(el.children)) {
        const top = (child as HTMLElement).offsetTop;
        if (!tops.some((t) => Math.abs(t - top) <= ROW_TOLERANCE_PX)) tops.push(top);
      }
      return tops.length;
    };
    const fit = () => {
      for (const s of CHIP_FIT_STEPS) {
        el.style.setProperty('--chip-fit', String(s));
        if (rowCount() <= MAX_ROWS) break;
      }
    };
    fit();
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };
    // r2(Pro) — fit()은 글자 reflow로 컨테이너 **높이**를 바꾼다. 높이 변화까지 다시 fit()을
    // 예약하면 브라우저별 ResizeObserver 전달 방식에 따라 피드백 루프가 될 수 있으므로, 이 훅이
    // 실제로 의존하는 폭 변화만 받는다. window resize는 별도 리스너가 그대로 처리한다.
    let observedWidth = el.getBoundingClientRect().width;
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(([entry]) => {
          const width = entry?.contentRect.width ?? el.getBoundingClientRect().width;
          if (Math.abs(width - observedWidth) < 0.5) return;
          observedWidth = width;
          schedule();
        })
      : null;
    ro?.observe(el);
    window.addEventListener('resize', schedule);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
