/**
 * v0.18.0 1f — PWA 비강제(프롬프트) 업데이트 컨트롤러.
 *
 * 배경: vite.config가 `registerType:'autoUpdate'`였을 때 iOS standalone(홈 화면 설치형)은
 * 새 버전을 silent 강제 리로드로만 반영했고, 현장에선 그 리로드가 안 걸려 "새 버전이 반영
 * 안 된다"는 문제가 됐다. 여기서는 `virtual:pwa-register`의 registerSW를 **수동**으로 돌려
 * (vite.config `injectRegister:null`) 강제 리로드를 없애고:
 *   - 새 SW가 waiting(`onNeedRefresh`)이면 상태만 켜고 → UI(UpdateBanner/Settings)가 비강제
 *     배너/버튼을 띄운다. 리로드는 **사용자 탭** 시점(`applyUpdate`)에만 일어난다.
 *   - standalone 실행 + `visibilitychange`(포그라운드 복귀) 시 등록 registration `.update()`로
 *     새 SW를 능동 탐지한다(iOS는 종료·재실행 전엔 자동 탐지가 약함).
 *
 * 데이터 안전: 진행 중인 음성 세션은 v0.4.4 증분 persist로 이미 영속화되므로, 사용자가 배너를
 * 탭해 리로드해도 유실되지 않는다. 강제 리로드는 하지 않는다(현장 안전).
 *
 * 브라우저 의존(`registerSW`/`navigator`)이 있어 Node 단위 테스트 대상이 아니다 — 상태 구독은
 * 가벼운 자체 스토어(zustand 미사용, 모듈 싱글톤)로 둬 React 어디서든 useSyncExternalStore로 읽는다.
 */
import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface PwaUpdateState {
  /** 새 SW가 waiting — 비강제 배너/버튼 노출 트리거. */
  needRefresh: boolean;
  /** 등록 완료(능동 update() 가능) 여부. */
  registered: boolean;
}

let state: PwaUpdateState = { needRefresh: false, registered: false };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}
function setState(patch: Partial<PwaUpdateState>) {
  state = { ...state, ...patch };
  emit();
}

/** registerSW가 반환하는 업데이트 적용 콜백(skipWaiting + 1회 리로드). 사용자 탭 시에만 호출. */
let updateSWFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
let activeRegistration: ServiceWorkerRegistration | undefined;
let initialized = false;

/** standalone(홈 화면 설치형)으로 실행 중인지. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari는 navigator.standalone, 그 외는 display-mode 미디어쿼리.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const mq = window.matchMedia?.('(display-mode: standalone)')?.matches === true;
  return iosStandalone || mq;
}

/** 능동 체크: 새 SW가 배포됐는지 registration.update()로 탐지(no-op이면 조용히 무시). */
function checkForUpdate() {
  if (!activeRegistration) return;
  void activeRegistration.update().catch(() => {
    /* 오프라인/일시 실패는 무시 — 다음 포그라운드에서 재시도 */
  });
}

/**
 * 앱 부팅 시 1회 호출(main.tsx). SW 등록 + 능동 체크 리스너를 건다.
 * 미지원 환경(SW 없음)이면 조용히 no-op.
 */
export function initPwaUpdate() {
  if (initialized) return;
  initialized = true;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  updateSWFn = registerSW({
    onNeedRefresh() {
      // 새 버전 대기 — 비강제 배너/버튼 노출. 강제 리로드 금지(음성 측정 중 보호).
      setState({ needRefresh: true });
    },
    onRegisteredSW(_swUrl, registration) {
      activeRegistration = registration;
      setState({ registered: true });
      // standalone 실행 시 즉시 1회 능동 체크(설치형 실행 시 새 버전 탐지).
      if (isStandalone()) checkForUpdate();
    },
  });

  // 포그라운드 복귀(visibilitychange) + standalone 표시 시 능동 재체크.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
  // 데스크탑/탭 포커스 복귀도 커버.
  window.addEventListener('focus', () => checkForUpdate());
}

/** 수동 "업데이트 확인"(설정 버튼) — 새 SW 즉시 탐지 시도. */
export function checkForUpdateNow() {
  checkForUpdate();
}

/** 사용자 선택 시점의 업데이트 적용(skipWaiting + 1회 리로드). 데이터는 이미 영속화됨. */
export async function applyUpdate() {
  if (updateSWFn) await updateSWFn(true);
}

// ── React 구독 ──────────────────────────────────────────────────
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot() {
  return state;
}

/** 컴포넌트에서 PWA 업데이트 상태를 구독한다. */
export function usePwaUpdate(): PwaUpdateState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
