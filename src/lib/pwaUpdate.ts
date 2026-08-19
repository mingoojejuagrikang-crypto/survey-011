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
 *
 * ## v0.50 r2 [갈래 C · rpwa §P0] — **계측만 붙였다. 동작은 하나도 안 바꿨다.**
 * `[ENV-8]`의 미검증 항목(*"iOS 설치형에서 포그라운드 복귀 시 실제로 갱신 체크가 도는가"*)이
 * 회차마다 미검증으로 남는 이유는 **로그가 없기 때문**이다. 이 경로는 전부 조용히 성공하거나
 * 조용히 실패한다(`checkForUpdate`의 `.catch(() => {})`가 그 전형이다 — [REVIEW-1]).
 * 남기는 이벤트(전부 신규 · `type:'app'`):
 *   `pwa_register:ok|unsupported` · `pwa_registered_sw:standalone=<y|n>,sw=<installing|waiting|active|none>`
 *   `pwa_need_refresh` · `pwa_visibility_check:vis=<v>,standalone=<y|n>,reg=<y|n>`
 *   `pwa_update:start|ok|failed:<name>` · `pwa_apply_update`
 * 🔴 **검증(민구 5분)**: 배포 후 아이폰 콜드런치 1회 + 홈 나갔다 복귀 1회 → 수확 zip의
 * `events.json`에 `pwa_visibility_check`가 있는지만 보면 된다.
 * ⚠️ rpwa의 P1(배포본 직접 대조)·P2(NetworkOnly)는 **이번 범위 밖**이다(민구가 P0만 승인).
 */
import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { logger } from './logger';

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

/** 등록된 SW의 현재 슬롯 — 「등록은 됐는데 아무 SW도 없다」와 「waiting이 쌓여 있다」를 가른다. */
function swSlot(): 'installing' | 'waiting' | 'active' | 'none' {
  const r = activeRegistration;
  if (!r) return 'none';
  if (r.installing) return 'installing';
  if (r.waiting) return 'waiting';
  if (r.active) return 'active';
  return 'none';
}

/** 능동 체크: 새 SW가 배포됐는지 registration.update()로 탐지(no-op이면 조용히 무시).
 *  v0.50 r2 [갈래 C] — **호출·성공·실패를 남긴다.** 종전엔 `.catch(() => {})`라 오프라인에서
 *  아무 자국 없이 사라졌다(그게 `[ENV-8]`이 미검증으로 남은 이유다). 동작은 그대로다. */
function checkForUpdate(source: 'boot' | 'visibility' | 'focus' | 'manual') {
  if (!activeRegistration) {
    logger.log({ type: 'app', extra: `pwa_update:skipped:${source}:no_registration` });
    return;
  }
  logger.log({ type: 'app', extra: `pwa_update:start:${source}` });
  void activeRegistration.update().then(
    () => { logger.log({ type: 'app', extra: `pwa_update:ok:${source}:sw=${swSlot()}` }); },
    (e: unknown) => {
      // 오프라인/일시 실패는 **동작상** 무시하되(다음 포그라운드에서 재시도) 자국은 남긴다.
      logger.log({ type: 'app', extra: `pwa_update:failed:${source}:${e instanceof Error ? e.name : 'unknown'}` });
    },
  );
}

/**
 * 앱 부팅 시 1회 호출(main.tsx). SW 등록 + 능동 체크 리스너를 건다.
 * 미지원 환경(SW 없음)이면 조용히 no-op.
 */
export function initPwaUpdate() {
  if (initialized) return;
  initialized = true;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    // 🔑 **미지원을 명시적으로 남긴다** — 「안 찍힌 것」과 「지원 안 되는 것」을 가르는 분모다
    //    (`audio_session:supported=no`와 같은 원칙 · `[TEAMOPS-12]`).
    logger.log({ type: 'app', extra: 'pwa_register:unsupported' });
    return;
  }
  logger.log({ type: 'app', extra: `pwa_register:ok:standalone=${isStandalone() ? 'y' : 'n'}` });

  updateSWFn = registerSW({
    onNeedRefresh() {
      // 새 버전 대기 — 비강제 배너/버튼 노출. 강제 리로드 금지(음성 측정 중 보호).
      logger.log({ type: 'app', extra: `pwa_need_refresh:sw=${swSlot()}` });
      setState({ needRefresh: true });
    },
    onRegisteredSW(_swUrl, registration) {
      activeRegistration = registration;
      setState({ registered: true });
      logger.log({
        type: 'app',
        // 🔑 `onRegisteredSW`가 **도달했는가** 자체가 `[ENV-8]`의 미검증 항목이다.
        extra: `pwa_registered_sw:standalone=${isStandalone() ? 'y' : 'n'},sw=${swSlot()}`,
      });
      // standalone 실행 시 즉시 1회 능동 체크(설치형 실행 시 새 버전 탐지).
      if (isStandalone()) checkForUpdate('boot');
    },
  });

  // 포그라운드 복귀(visibilitychange) + standalone 표시 시 능동 재체크.
  document.addEventListener('visibilitychange', () => {
    // 🔑 **발화 자체를 남긴다.** 「복귀했는데 체크가 안 돌았다」와 「복귀 자체가 없었다」는
    //    다른 사실인데, 종전엔 둘 다 로그가 없어 구분할 수 없었다.
    logger.log({
      type: 'app',
      extra: `pwa_visibility_check:vis=${document.visibilityState},standalone=${isStandalone() ? 'y' : 'n'},reg=${activeRegistration ? 'y' : 'n'}`,
    });
    if (document.visibilityState === 'visible') checkForUpdate('visibility');
  });
  // 데스크탑/탭 포커스 복귀도 커버.
  window.addEventListener('focus', () => checkForUpdate('focus'));
}

/** 수동 "업데이트 확인"(설정 버튼) — 새 SW 즉시 탐지 시도. */
export function checkForUpdateNow() {
  checkForUpdate('manual');
}

/** 사용자 선택 시점의 업데이트 적용(skipWaiting + 1회 리로드). 데이터는 이미 영속화됨. */
export async function applyUpdate() {
  logger.log({ type: 'app', extra: `pwa_apply_update:fn=${updateSWFn ? 'y' : 'n'},sw=${swSlot()}` });
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
