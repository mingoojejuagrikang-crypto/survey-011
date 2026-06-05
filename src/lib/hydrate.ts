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

export async function hydrateSessions(): Promise<void> {
  const store = useDataStore.getState();
  try {
    const sessions = await loadAllSessions();
    store.setSessions(sessions);
    store.setHydrationError(null);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    // Never swallow: a hydration failure is a data-safety event, not noise.
    logger.log({ type: 'error', extra: `hydration_failed:${msg}` });
    store.setHydrationError(msg);
  } finally {
    store.setHydrated(true);
  }
}
