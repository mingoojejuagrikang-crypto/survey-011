/**
 * Hydrate the data store from IndexedDB.
 *
 * Shared by App.tsx (initial mount) and DataScreen (manual retry) so the load path
 * — and its error handling — lives in exactly one place.
 *
 * RELIABILITY (D-1, KNOWN-ISSUES [REVIEW-1] "빈 catch 금지"): a load failure here used to be
 * swallowed by an empty catch, leaving `sessions: []` while data still sat in IDB. The user saw
 * "데이터 없음" and reported sessions "disappearing" after an app update (PWA autoUpdate + IDB
 * VersionError / multi-tab). We now LOG the failure and record `hydrationError` so the UI can
 * tell a genuine empty list apart from a load failure and offer a retry instead of a blank state.
 */
import { loadAllSessions } from './db';
import { useDataStore } from '../stores/dataStore';
import { logger } from './logger';
import { useSessionStore } from '../stores/sessionStore';

export async function hydrateSessions(): Promise<void> {
  const store = useDataStore.getState();
  try {
    const sessions = (await loadAllSessions()).map((session) => {
      // 구 개발 빌드/경쟁 저장에서 런타임 플래그가 남았더라도 새 프로세스엔 진행 중 put이 없으므로
      // 반드시 해제한다. pendingValidation 자체는 그대로 복구해 터치 확인 계약을 유지한다.
      if (!session.pendingValidationPersisting) return session;
      const clean = { ...session };
      delete clean.pendingValidationPersisting;
      return clean;
    });
    store.setSessions(sessions);
    // 확인 전 수동 이상치는 메모리 팝업만 복구하면 후보가 확정값처럼 보인다. IDB에 남은 최신 보류를
    // 세션 상태까지 복원해 부팅 직후에도 중앙 manualHold 게이트와 [확인]/[수정] 계약을 유지한다.
    const pending = sessions.find((s) => s.pendingValidation);
    if (pending) useSessionStore.getState().restorePendingValidation(pending);
    store.setHydrationError(null);
    // v0.5.0 W7(T-19): 성공 경로도 계측 — 실패(hydration_failed)만 찍으면 "이벤트 없음"이
    // "성공"인지 "로드 자체가 안 돌았는지" 구분이 안 된다([REVIEW-1]의 관측 대칭성).
    logger.log({ type: 'app', extra: `hydration_ok:${sessions.length}` });
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    // Never swallow: a hydration failure is a data-safety event, not noise.
    logger.log({ type: 'error', extra: `hydration_failed:${msg}` });
    store.setHydrationError(msg);
  } finally {
    store.setHydrated(true);
  }
}
