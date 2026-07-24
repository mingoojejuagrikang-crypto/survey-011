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
 *     없으므로 30프레임마다 getClientRects()로 숨김을 확인해 500ms 폴링으로 후퇴(rAF 정지).
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
        // keep-alive display:none 확인은 30프레임(≈0.5s)에 1회만 — 레이아웃 읽기라 매 프레임 읽으면
        // 스타일 쓰기와 상호작용해 강제 동기 레이아웃을 유발할 수 있다.
        //
        // ⚠️ v0.38.1 — 종전 판정은 `el.offsetParent === null`이었는데, **`position:fixed` 엘리먼트는
        // 보이는 상태에서도 `offsetParent`가 항상 null이다**(HTML 스펙: fixed면 null 반환).
        // v0.37.0에서 EdgeGlow가 full-bleed를 위해 `position:fixed`로 바뀌면서 이 판정이 **상시
        // 오탐**이 됐다 → 30프레임마다 "숨겨졌다"고 오판해 `--voice-level`을 0으로 쓰고 500ms를
        // 쉬었다. 결과: 글로우가 **0.5초 살고 0.5초 죽는 절반 duty로 끊긴다**(레벨 반응 자체가
        // 절반의 시간 동안 소실). v034-wave-glow B7·B8 실패의 근인이고, 실기기에서도 육안으로
        // 드러나는 결함이다.
        // `getClientRects()`는 이 둘을 정확히 가른다 — display:none(또는 조상 display:none)이면
        // 박스가 생성되지 않아 0개, 보이는 fixed면 1개 이상. 비용은 offsetParent와 같은 레이아웃
        // 읽기 1회라 30프레임 1회 정책은 그대로 유효하다.
        if (frame++ % 30 === 0 && el.getClientRects().length === 0) {
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
