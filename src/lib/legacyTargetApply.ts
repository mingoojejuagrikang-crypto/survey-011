import type { Session, SessionTarget } from '../types';
import { useDataStore } from '../stores/dataStore';
import { useSessionStore } from '../stores/sessionStore';
import { saveSession } from './db';
import {
  assignLegacySessionTarget,
  isSessionSyncBlocked,
  type LegacyTargetDecision,
} from './sessionSync';

export interface LegacyTargetApplyDeps {
  findSession: (id: string) => Session | undefined;
  isSyncBlocked: (id: string) => boolean;
  saveSession: (session: Session) => Promise<void>;
  upsertSession: (session: Session) => void;
}

export type LegacyTargetApplyResult = 'applied' | 'active' | 'unchanged';

const storeDeps: LegacyTargetApplyDeps = {
  findSession: (id) => useDataStore.getState().sessions.find((session) => session.id === id),
  isSyncBlocked: (id) => {
    const voice = useSessionStore.getState();
    return isSessionSyncBlocked(id, voice.sessionId, voice.phase);
  },
  saveSession,
  upsertSession: (session) => useDataStore.getState().upsertSession(session),
};

/** legacy 대상 저장은 음성 입력 중인 세션에 절대 진입하지 않는다. */
export async function applyLegacyTarget(
  id: string,
  target: SessionTarget,
  decision: LegacyTargetDecision,
  deps: LegacyTargetApplyDeps = storeDeps,
): Promise<LegacyTargetApplyResult> {
  if (deps.isSyncBlocked(id)) return 'active';
  const latest = deps.findSession(id);
  if (!latest || latest.target) return 'unchanged';

  const updated = assignLegacySessionTarget(latest, target, decision);
  await deps.saveSession(updated);
  deps.upsertSession(updated);
  return 'applied';
}
