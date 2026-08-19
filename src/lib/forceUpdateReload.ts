/**
 * v0.50 (2026-08-19) — **갱신 폴백**: SW 경로가 없거나 침묵할 때 캐시를 걷어내고 다시 받는다.
 *
 * 🔑 **왜 `pwaUpdate.ts`가 아니라 별도 파일인가**: 그 파일은 `virtual:pwa-register`(Vite 가상
 * 모듈)를 import해서 **Node 단위 테스트에서 import 자체가 죽는다**(실측: *"Only URLs with a
 * scheme in: file, data, and node are supported"*). 이 모듈은 브라우저 API를 **주입으로** 받아
 * fetch·SW·Vite 없이 계약을 잠근다(`applyDecimalFormats`·`uploadAuthRetry`와 같은 계보).
 */
import { logger } from './logger';

/** v0.50 — SW 경로가 **없거나 침묵할 때**의 갱신 폴백.
 *
 *  ## 왜 필요한가
 *  `applyUpdate()`는 `registerSW`가 준 콜백(skipWaiting + reload)에 전적으로 의존한다. SW가 아직
 *  안 붙었거나(프리뷰 첫 설치), waiting이 없거나, 등록 자체가 침묵하면 **누를 수 있는 것이 없다.**
 *  standalone에는 새로고침 UI가 없으므로 그 상태가 곧 **갱신 경로 0개**다(민구 08-19 제보).
 *
 *  ## 무엇을 하나 — `location.reload()`로는 부족하다
 *  리로드는 HTTP 캐시·SW precache를 **다시 탈 수 있다.** 그래서 순서가 중요하다:
 *   ① **Cache Storage를 비운다**(precache·런타임 캐시) ② **SW 등록을 해제**한다
 *   ③ 그 다음에 리로드 — 이제 네트워크에서 새로 받는다. 다음 로드에서 `initPwaUpdate()`가
 *      SW를 **다시 등록**하므로 오프라인 능력도 곧 복구된다.
 *
 *  🔴 **IndexedDB는 절대 건드리지 않는다.** 세션·음성 클립·설정이 전부 거기 있다
 *  (PRINCIPLES §1 데이터 무결성). 「업데이트 버튼이 클립을 지웠다」는 이 앱에서 최악의 사고다 —
 *  이 함수는 `indexedDB`를 **참조조차 하지 않는다**(오라클이 그것을 잠근다).
 *
 *  ⚠️ 캐시를 지우므로 **온라인이어야 의미가 있다.** 호출부(`UpdateControl`)는 프로브가
 *  `outdated`를 확인한 뒤에만 이 버튼을 띄운다 — 그 확인 자체가 네트워크 도달을 증명한다.
 *
 *  @returns 폴백을 실제로 수행했는가(리로드 직전까지). 리로드는 부수효과라 반환 후 일어난다.
 */
export async function forceUpdateReload(deps?: {
  caches?: CacheStorage;
  getRegistrations?: () => Promise<ServiceWorkerRegistration[]>;
  reload?: () => void;
}): Promise<{ cachesDeleted: number; unregistered: number }> {
  logger.log({ type: 'app', extra: 'pwa_force_reload:start' });
  let cachesDeleted = 0;
  let unregistered = 0;
  const cacheApi = deps?.caches ?? (typeof caches !== 'undefined' ? caches : undefined);
  try {
    if (cacheApi) {
      const keys = await cacheApi.keys();
      for (const k of keys) {
        if (await cacheApi.delete(k)) cachesDeleted += 1;
      }
    }
  } catch (e) {
    logger.log({ type: 'app', extra: `pwa_force_reload:cache_failed:${e instanceof Error ? e.name : 'unknown'}` });
  }
  try {
    const getRegs = deps?.getRegistrations
      ?? (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? () => navigator.serviceWorker.getRegistrations()
        : undefined);
    if (getRegs) {
      for (const reg of await getRegs()) {
        if (await reg.unregister()) unregistered += 1;
      }
    }
  } catch (e) {
    logger.log({ type: 'app', extra: `pwa_force_reload:unregister_failed:${e instanceof Error ? e.name : 'unknown'}` });
  }
  logger.log({ type: 'app', extra: `pwa_force_reload:done:caches=${cachesDeleted},sw=${unregistered}` });
  (deps?.reload ?? (() => { location.reload(); }))();
  return { cachesDeleted, unregistered };
}
