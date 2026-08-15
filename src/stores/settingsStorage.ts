/**
 * 설정 persist의 **저장 매체**: localStorage 1차 + IndexedDB 내구 미러 + 하이드레이션 게이트.
 *
 * [ENV-12] 2026-08-15 — `settingsStore.ts`에서 분리했다. `hydrationComplete` 게이트와
 * `mirroredStorage`는 **같은 모듈 상태를 공유하는 한 덩어리**라 함께 옮겼다(게이트를 갈라 놓으면
 * "누가 언제 여는가"가 파일을 건너뛴다 — 아래 W2 주석이 설명하는 바로 그 결함이 되살아난다).
 *
 * ⚠️ import 방향은 **단방향**이다 — 이 파일은 `settingsStore.ts`를 import하지 않는다.
 */
import type { StateStorage } from 'zustand/middleware';
import { saveSettingsBackup, loadSettingsBackup, deleteSettingsBackup } from '../lib/db';
import { logger } from '../lib/logger';

/**
 * v0.14.0 C — localStorage + IDB 내구 미러 스토리지. iOS Safari는 일정시간 경과(ITP)나 강제종료
 * 후 localStorage를 evict해 시트 등록(URL·컬럼·저장시트)이 통째로 풀리는 문제가 보고됐다(민구).
 * localStorage를 1차(동기·기존 동작 보존)로 쓰되 모든 쓰기를 IDB('kv')에 미러하고, getItem에서
 * localStorage가 비어 있으면 IDB에서 복원한다. localStorage 히트 시 동기 반환 → 정상 경로의
 * 하이드레이션 레이스 표면은 늘리지 않는다(IDB 폴백은 evict된 경우에만 비동기로 탄다).
 *
 * v0.19.0 W2 — 하이드레이션 게이트(레이스 가드). 근본원인: 홈 설치형 앱 업데이트 부팅 시
 * localStorage가 evict되면 getItem이 **비동기** IDB 복원 Promise를 반환한다. 그 복원이 끝나기 전,
 * 부팅 초기에 일어나는 `set()`(인증 부트스트랩·컬럼 reconcile 등)이 기본 상태(savedSheets:[])를
 * 직렬화해 setItem write-through를 호출하면 IDB 미러가 **빈 배열로 덮여 영구 소실**된다. 따라서
 * 하이드레이션(onRehydrateStorage)이 끝날 때까지 IDB write-through를 보류한다 — localStorage 1차
 * 쓰기는 그대로(동기 동작 보존), IDB 미러만 게이트. 게이트가 풀린 뒤의 모든 쓰기는 정상 미러된다.
 * (시트 목록 자체는 saveSheet/removeSavedSheet의 전용 IDB 레코드로도 별도 미러돼 이 bulk 경로와
 * 무관하게 결정론적으로 복원된다 — 아래 saveSheet 참고.)
 */
let hydrationComplete = false;
/** v0.19.0 W2 — onRehydrateStorage 콜백에서 호출. 세 부팅 경로(localStorage 동기 히트 / IDB 비동기
 *  복원 / 신규 설치) 모두에서 하이드레이션 완료 직후 게이트를 연다. 안 열리면 이후 모든 쓰기가
 *  영구히 미러되지 않으므로 반드시 onRehydrateStorage에서 1회 호출돼야 한다. */
export function markHydrationComplete(): void {
  hydrationComplete = true;
}

export const mirroredStorage: StateStorage = {
  getItem: (name) => {
    let local: string | null = null;
    try { local = localStorage.getItem(name); } catch { /* private mode 등 */ }
    if (local != null) return local; // 정상 경로: 동기 반환
    // localStorage 비었음 — evict됐을 수 있으니 IDB 미러에서 복원 시도(비동기).
    return loadSettingsBackup(name).then((fromIdb) => {
      if (fromIdb != null) {
        try { localStorage.setItem(name, fromIdb); } catch { /* ignore */ }
        logger.log({ type: 'app', extra: 'settings_restored_from_idb' });
      }
      return fromIdb;
    });
  },
  setItem: (name, value) => {
    try { localStorage.setItem(name, value); } catch { /* ignore */ }
    // v0.19.0 W2 — 하이드레이션 완료 전에는 IDB 미러를 덮지 않는다(빈 기본값 clobber 방지).
    if (!hydrationComplete) {
      logger.log({ type: 'app', extra: 'settings_write_pre_hydration_skipped_idb' });
      return;
    }
    void saveSettingsBackup(name, value); // write-through 미러(best-effort)
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* ignore */ }
    void deleteSettingsBackup(name);
  },
};
