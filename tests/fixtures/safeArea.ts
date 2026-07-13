/**
 * v0.33.0 — 아이폰 17 일반(노치) safe-area 시뮬레이션 픽스처.
 *
 * 브라우저(chromium 에뮬레이션 포함)는 env(safe-area-inset-*)를 0으로 해석하므로 노치/홈
 * 인디케이터 침범을 테스트로 재현할 수 없다. 앱의 safe-area SSOT가 global.css :root의
 * --sat/--sab/--sal/--sar 변수(v0.33.0)로 단일화되었으므로, 이 변수만 documentElement 인라인
 * 스타일로 override하면(인라인 > :root 규칙) 앱 전체가 노치 기기처럼 동작한다.
 *
 * 값 근거: 아이폰 17 일반(노치) standalone 세로 모드 가정 top=62 / bottom=34(홈바). 실기기
 * 실측(main.tsx sa_insets 텔레메트리)과 다르면 여기 상수를 갱신한다.
 */
import { test as base } from '@playwright/test';

export const SIMULATED_INSETS = { top: 62, bottom: 34, left: 0, right: 0 } as const;

/** 뷰포트에서 safe-area를 뺀 "안전 영역" 경계(px). 단언에서 재사용. */
export function safeBounds(viewport: { width: number; height: number }) {
  return {
    top: SIMULATED_INSETS.top,
    bottom: viewport.height - SIMULATED_INSETS.bottom,
    left: SIMULATED_INSETS.left,
    right: viewport.width - SIMULATED_INSETS.right,
  };
}

const INJECT_SCRIPT = `
(function apply() {
  var el = document.documentElement;
  if (!el) { setTimeout(apply, 0); return; }
  el.style.setProperty('--sat', '${SIMULATED_INSETS.top}px');
  el.style.setProperty('--sab', '${SIMULATED_INSETS.bottom}px');
  el.style.setProperty('--sal', '${SIMULATED_INSETS.left}px');
  el.style.setProperty('--sar', '${SIMULATED_INSETS.right}px');
})();
`;

/** 모든 내비게이션(리로드 포함)에 노치 inset을 주입하는 test 객체. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(INJECT_SCRIPT);
    await use(page);
  },
});

export { expect } from '@playwright/test';
