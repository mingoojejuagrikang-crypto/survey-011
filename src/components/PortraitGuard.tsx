import { useEffect, useState } from 'react';
import { logger } from '../lib/logger';
import { orientationChange } from '../lib/logEvents';

/**
 * v0.38.2 F2 — 가로 회전 시 **세로로 돌려달라는 안내를 덮는다.**
 *
 * **왜 CSS인가 (이미 있는 lock이 왜 무효인가):**
 * `wakeLock.ts`의 `lockPortrait()`는 v0.22.0부터 있었고 `VoiceScreen`이 세션 시작 시 호출한다.
 * 그런데 **iOS Safari는 `screen.orientation.lock`을 구현하지 않는다**(구현한 브라우저도 fullscreen을
 * 요구한다). 즉 "잠갔다고 생각한 lock이 아무 일도 안 하고 있었다" — 2026-07-24 실기기 피드백 fb-01
 * ("세로모드 미고정")의 실체다. `lockPortrait()`는 지원 기기용 best-effort로 그대로 두고, 실제 방어는
 * 이 오버레이가 한다.
 *
 * 🔴 **언마운트가 아니라 오버레이다.** 가로일 때 앱 트리를 갈아치우면 `VoiceScreen`이 unmount되고
 * 인식기·워치독·클립 레코더가 통째로 teardown된다 — [STT-16]에서 실기기 62초 사공백을 냈던 바로 그
 * 실패다(`App.tsx`의 keep-alive 렌더가 그걸 막으려고 존재한다). 여기서는 **위에 덮기만** 하고 아래
 * 트리는 살아 있다. 회전했다 돌아오면 세션이 그대로 이어진다.
 *
 * **판정 기준:**
 *  - `(orientation: landscape)` — 가로.
 *  - `(pointer: coarse)` — 터치 기기 한정. **화면 폭으로 판정하면 안 된다**: 폰이 가로가 되면
 *    `innerWidth`가 402 → 874로 커진다.
 *    🔴 **§B1(2026-08-03) 해소됨** — 이 경고는 원래 "그러면 `App.tsx`의 `isMobile`(≤480) 판정이
 *    뒤집혀 정확히 방어하려는 그 순간 판정이 무너진다"는 이유였다. §B1이 `isMobile` 분기 자체를
 *    제거해(항상 풀블리드 셸) 그 판정이 더 이상 존재하지 않으므로 "뒤집힐" 대상이 없다. 다만
 *    폭 기반 판정이 회전에 원래 취약하다는 원칙 자체는 유효하게 남아 포인터 종류(회전 불변)를
 *    계속 쓴다 — 왜 이 경고가 있었는지 기록으로 남긴다.
 *  - 데스크탑은 대부분 가로이므로 이 게이트가 없으면 개발·테스트 환경이 통째로 가려진다.
 *  - **태블릿 가로도 차단한다(민구 확정 2026-07-25).** 리뷰에서 `max-height: 500px`로 폰 가로에만
 *    좁히자는 의견이 있었으나, 입력화면은 세로 기준으로 설계됐고(칩존 25% / 중앙 50% / 하단 25%)
 *    F3도 그 전제로 간다. 태블릿 가로를 열어주면 **검증한 적 없는 레이아웃이 현장에 노출된다.**
 *
 * 🔴 **시각적으로 덮는 것만으로는 부족하다**(라운드A 리뷰 — Codex #4 · agy #1 수렴 지적).
 * `position: fixed`로 가려도 **보조공학(VoiceOver·스위치 제어)의 포커스는 뒤쪽 앱을 그대로 훑는다.**
 * 화면에는 "세로로 돌려주세요"만 보이는데 스크린리더는 보이지 않는 탭바·입력 칩을 읽고 **실행까지
 * 된다** — 현장에서 잘못 눌린 버튼 하나가 조사를 망친다. 그래서 오버레이가 떠 있는 동안 형제 노드를
 * `inert`로 막는다(포커스·클릭·AT 탐색 전부 차단). `inert` 미지원 브라우저에는 `aria-hidden` 폴백.
 *
 * ⚠️ **여전히 언마운트가 아니다.** `inert`는 DOM을 그대로 두고 상호작용만 막으므로 [STT-16] keep-alive
 * 계약이 유지된다 — 세션·인식기·클립 레코더는 살아 있다.
 */
export function PortraitGuard() {
  const [landscape, setLandscape] = useState(false);

  // 오버레이가 떠 있는 동안 형제(앱 트리)를 상호작용·AT 탐색에서 격리하고, 사라지면 원복한다.
  // 원복은 "우리가 켠 것만" 되돌린다 — 다른 코드가 켜 둔 inert/aria-hidden을 지우지 않는다.
  useEffect(() => {
    if (!landscape) return;
    const host = document.querySelector('[data-testid="portrait-guard"]');
    const parent = host?.parentElement;
    if (!parent) return;
    const touched: Array<{ el: HTMLElement; hadInert: boolean; prevAria: string | null }> = [];
    for (const child of Array.from(parent.children)) {
      if (child === host || !(child instanceof HTMLElement)) continue;
      touched.push({ el: child, hadInert: child.inert === true, prevAria: child.getAttribute('aria-hidden') });
      child.inert = true;
      // inert 미지원 환경 폴백 — 지원 환경에서도 무해하다(둘 다 AT 탐색을 막는 방향).
      child.setAttribute('aria-hidden', 'true');
    }
    return () => {
      for (const { el, hadInert, prevAria } of touched) {
        if (!hadInert) el.inert = false;
        if (prevAria === null) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', prevAria);
      }
    };
  }, [landscape]);

  useEffect(() => {
    // matchMedia 미지원(구형 WebView)이면 아무것도 하지 않는다 — 안내가 안 뜰 뿐 앱은 정상 동작한다.
    if (typeof window.matchMedia !== 'function') return;
    const guardMq = window.matchMedia('(orientation: landscape) and (pointer: coarse)');
    const orientationMq = window.matchMedia('(orientation: landscape)');
    const applyGuard = () => setLandscape(guardMq.matches);
    // 빌더에 초기 관측 discriminator가 없으므로 마운트 상태는 기준값으로만 잡고 방출하지 않는다.
    let previousOrientation: 'portrait' | 'landscape' = orientationMq.matches ? 'landscape' : 'portrait';
    const reportOrientation = () => {
      const nextOrientation = orientationMq.matches ? 'landscape' : 'portrait';
      if (nextOrientation === previousOrientation) return;
      previousOrientation = nextOrientation;
      applyGuard();
      try {
        logger.log({
          type: 'app',
          extra: orientationChange({
            to: nextOrientation,
            guard: guardMq.matches ? 'shown' : 'hidden',
            w: Math.round(window.innerWidth),
            h: Math.round(window.innerHeight),
          }),
        });
      } catch {
        // Telemetry is best-effort and must never affect the orientation guard.
      }
    };
    applyGuard();
    // Safari 14 미만은 addEventListener 미지원 → addListener 폴백(TabBar의 ResizeObserver 폴백과 동일 원칙).
    if (typeof guardMq.addEventListener === 'function') {
      guardMq.addEventListener('change', applyGuard);
      orientationMq.addEventListener('change', reportOrientation);
      return () => {
        guardMq.removeEventListener('change', applyGuard);
        orientationMq.removeEventListener('change', reportOrientation);
      };
    }
    const legacyGuard = guardMq as MediaQueryList & {
      addListener?: (cb: () => void) => void;
      removeListener?: (cb: () => void) => void;
    };
    const legacyOrientation = orientationMq as MediaQueryList & {
      addListener?: (cb: () => void) => void;
      removeListener?: (cb: () => void) => void;
    };
    legacyGuard.addListener?.(applyGuard);
    legacyOrientation.addListener?.(reportOrientation);
    return () => {
      legacyGuard.removeListener?.(applyGuard);
      legacyOrientation.removeListener?.(reportOrientation);
    };
  }, []);

  if (!landscape) return null;

  return (
    <div
      data-testid="portrait-guard"
      // 즉시 조치가 필요한 상태 변화라 polite status가 아니라 alert로 올린다(리뷰 수렴 지적).
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#0E0F11',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 'max(24px, var(--sat)) max(24px, var(--sar)) max(24px, var(--sab)) max(24px, var(--sal))',
        textAlign: 'center',
      }}
    >
      <div aria-hidden="true" style={{ fontSize: 'clamp(40px, 12vh, 72px)', lineHeight: 1 }}>📱</div>
      <div style={{ fontSize: 'clamp(20px, 5vh, 30px)', fontWeight: 700, color: '#F5F5F7' }}>
        세로로 돌려주세요
      </div>
      <div style={{ fontSize: 'clamp(14px, 3vh, 18px)', color: '#A1A1A6', maxWidth: '32ch' }}>
        조사 입력은 세로 화면에 맞춰져 있어요. 진행 중인 조사는 그대로 유지됩니다.
      </div>
    </div>
  );
}
