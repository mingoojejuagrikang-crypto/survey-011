import { useEffect, useRef } from 'react';

/** v0.34.0 B7(Vance) — 마이크 입력 레벨(0~1)을 대상 엘리먼트의 CSS 변수 `--voice-level`로
 *  흘리는 rAF 루프. **React state 금지** — 매 프레임 el.style.setProperty 직접 조작이라 리렌더 0.
 *  소비자는 인라인 스타일에서 `var(--voice-level, 0)` 기반 calc()로 파동(text-shadow 확산·미세
 *  opacity)·글로우 강도를 만든다(레이아웃 불변 속성만 — useFitScale 계약과 무간섭).
 *
 *  정지 조건(배터리/프레임 보호):
 *   - `active=false`(listening 아님 등) → 루프 자체를 돌리지 않는다.
 *   - `document.visibilityState==='hidden'` → 스케줄 중단, visibilitychange에서 재개.
 *   - keep-alive display:none(세션 중 탭 이탈 — App.tsx [STT-16] 렌더) → rAF는 돌지만 화면이
 *     없으므로 30프레임마다 offsetParent를 확인해 숨김이면 500ms 폴링으로 후퇴(rAF 정지).
 *   - `prefers-reduced-motion: reduce` → 루프를 아예 켜지 않는다(변수 0 고정 = 정적 표시).
 *   - cleanup에서 cancel + 변수 0 복귀.
 *
 *  대상 엘리먼트가 key 교체로 리마운트돼도(HeroPrimaryLine의 key={value}) 매 프레임 ref.current를
 *  다시 읽으므로 stale 노드에 쓰지 않는다.
 *
 *  테스트 심(test seam): `window.__voiceLevelOverride`(number)가 있으면 getLevel 대신 그 값을
 *  쓴다 — e2e가 getUserMedia 없이 레벨 주입을 검증하는 용도. 프로덕션에선 항상 undefined(비용 0). */
export function useAudioLevelVar<T extends HTMLElement>(
  getLevel: () => number,
  active: boolean,
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return; // 정적 표시 — 변수 기본값 0 유지.
    }
    let raf = 0;
    let idleTimer: number | null = null;
    let frame = 0;
    let disposed = false;

    const schedule = () => {
      if (disposed || document.visibilityState === 'hidden') return; // onVis가 재개
      if (raf === 0) raf = requestAnimationFrame(tick);
    };
    const tick = () => {
      raf = 0;
      const el = ref.current;
      if (el) {
        // keep-alive display:none 확인은 30프레임(≈0.5s)에 1회만 — offsetParent는 레이아웃 읽기라
        // 매 프레임 읽으면 스타일 쓰기와 상호작용해 강제 동기 레이아웃을 유발할 수 있다.
        if (frame++ % 30 === 0 && el.offsetParent === null) {
          el.style.setProperty('--voice-level', '0');
          idleTimer = window.setTimeout(() => { idleTimer = null; schedule(); }, 500);
          return;
        }
        const override = (window as unknown as { __voiceLevelOverride?: number }).__voiceLevelOverride;
        const v = Math.max(0, Math.min(1, typeof override === 'number' ? override : getLevel()));
        el.style.setProperty('--voice-level', v.toFixed(3));
      }
      schedule();
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    document.addEventListener('visibilitychange', onVis);
    schedule();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVis);
      if (raf) cancelAnimationFrame(raf);
      if (idleTimer != null) window.clearTimeout(idleTimer);
      ref.current?.style.setProperty('--voice-level', '0');
    };
  }, [active, getLevel]);
  return ref;
}
