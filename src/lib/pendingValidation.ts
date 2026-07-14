import type { Session } from '../types';

/** 확인 전 수동 이상치 후보를 외부로 내보낼 때 쓰는 안전 뷰.
 *  IDB 원본에는 후보와 보류 메타를 함께 남겨 새로고침 복구가 가능하지만, Sheets/CSV/백업 ZIP에는
 *  직전 확정값만 투영한다. 이 경계를 한 곳에 두지 않으면 데이터탭 sync가 dirty 후보를 PUT하는
 *  실패 시나리오가 다시 열린다. */
export function withoutPendingCandidate(session: Session): Session {
  const pending = session.pendingValidation;
  if (!pending) return session;
  const rows = session.rows.map((row) => {
    if (row.index !== pending.row) return row;
    const next = {
      ...row,
      values: { ...row.values, [pending.colId]: pending.previousValue },
      ...(pending.previousAudioClip
        ? { audioClips: { ...(row.audioClips ?? {}), [pending.colId]: pending.previousAudioClip } }
        : {}),
    };
    if (pending.previousSyncState === undefined) delete next.syncState;
    else next.syncState = pending.previousSyncState;
    return next;
  });
  const safe: Session = { ...session, rows };
  delete safe.pendingValidation;
  delete safe.pendingValidationPersisting;
  return safe;
}
