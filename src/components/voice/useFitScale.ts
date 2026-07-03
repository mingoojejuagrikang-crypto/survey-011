import { useLayoutEffect, useRef, type DependencyList } from 'react';

/** v0.27.0 입력탭(무스크롤 카드, Vance) — 음성반응 카드(이상치/일시정지/수정/hero)는 사용자가
 *  양손 측정 중이라 **스크롤할 수 없다**(민구 2026-07-03). 카드 콘텐츠는 흡수영역(grid row3,
 *  overflow:hidden) 가용 높이 안에 항상 전부 들어와야 한다(scrollHeight ≤ clientHeight).
 *
 *  전략(2단):
 *   1) CSS가 1차 — 폰트·간격을 clamp(min, vh/vw, max)로 뷰포트 비례화(다양한 화면 크기 자동 대응).
 *   2) 이 훅이 2차 가드 — 극단 케이스(긴 항목명+큰 음수, iOS 텍스트 확대[Dynamic Type], 가로모드)
 *      에서 CSS만으로 안 들어오면 카드 엘리먼트에 --fit-lo/--fit-hi 스케일 변수를 단계적으로 내려
 *      **실제 레이아웃 폰트 크기**를 줄인다(transform 아님 — scrollHeight가 진짜로 줄어든다).
 *
 *  정보 우선순위(GL-005): 현재값·알람 라벨 > 직전값·식별정보·안내문. --fit-hi는 (1+s)/2로 완만하게,
 *  --fit-lo는 s로 더 빠르게 줄어 하위 우선순위부터 축소된다. ellipsis 잘림 금지 — 줄바꿈+축소만.
 *
 *  성능: 카드는 한 번에 하나만 렌더되고 콘텐츠 변경도 드물다. 최대 8회 동기 reflow는 layout effect
 *  안(페인트 전)이라 플래시 없음. ResizeObserver/resize로 뷰포트·텍스트 확대 변화에 재수렴한다. */
const FIT_STEPS = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58] as const;

export function useFitScale<T extends HTMLElement>(deps: DependencyList) {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const fits = () =>
      el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    const fit = () => {
      for (const s of FIT_STEPS) {
        el.style.setProperty('--fit-lo', String(s));
        el.style.setProperty('--fit-hi', String(Math.round(((1 + s) / 2) * 100) / 100));
        if (fits()) break;
      }
    };
    fit();
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    if (el.parentElement) ro?.observe(el.parentElement);
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
