import { useLayoutEffect, useRef, type DependencyList } from 'react';
import { fitGroups, type FitGroupElements } from './fitGroup';

interface FitMemberRef {
  readonly current: HTMLElement | null;
}

export interface FitGroupConfig {
  variable: `--fit-${string}`;
  members: readonly FitMemberRef[];
  /** CSS 기준값과 독립적인 첫 탐색 probe 유도값. */
  searchBasePx: number;
  minScale?: number;
  reserveScale?: number;
}

/** 배정 영역 안에서 같은 계열 멤버가 공유할 최대 배율을 이진탐색한다. 그룹 배열 순서가 우선순위다. */
export function useFitGroup<T extends HTMLElement>(
  deps: DependencyList,
  groups: readonly FitGroupConfig[],
) {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    let raf = 0;
    let cancelled = false;
    const fit = () => {
      const liveGroups: FitGroupElements[] = groups.map((group) => ({
        ...group,
        members: group.members.flatMap((member) => member.current ? [member.current] : []),
      }));
      fitGroups({ container, groups: liveGroups });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };

    fit();
    const parent = container.parentElement;
    const readParentContentBox = () => {
      if (!parent) return { width: 0, height: 0 };
      const style = getComputedStyle(parent);
      const px = (value: string) => Number.parseFloat(value) || 0;
      return {
        width: parent.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
        height: parent.clientHeight - px(style.paddingTop) - px(style.paddingBottom),
      };
    };
    let { width: observedW, height: observedH } = readParentContentBox();
    const ro = typeof ResizeObserver !== 'undefined' && parent
      ? new ResizeObserver(([entry]) => {
          const rect = entry?.contentRect ?? readParentContentBox();
          const width = rect.width;
          const height = rect.height;
          if (Math.abs(width - observedW) < 0.5 && Math.abs(height - observedH) < 0.5) return;
          observedW = width;
          observedH = height;
          schedule();
        })
      : null;
    if (parent) ro?.observe(parent);
    window.addEventListener('resize', schedule);
    // 폰트 로딩 전 메트릭으로 굳지 않게 이 effect 인스턴스에서 ready 뒤 한 번 다시 잰다.
    // deps가 바뀌어 effect가 재시작되면 새 인스턴스도 같은 보정을 한 번 예약한다.
    void document.fonts?.ready.then(() => { if (!cancelled) schedule(); });
    return () => {
      cancelled = true;
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
