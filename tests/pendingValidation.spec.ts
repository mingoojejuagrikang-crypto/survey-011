import { test, expect } from '@playwright/test';
import { withoutPendingCandidate } from '../src/lib/pendingValidation';
import type { Session } from '../src/types';

test('manualHold 안전 뷰 — 후보/dirty를 직전 확정값/synced로 투영하고 원본은 불변', () => {
  const session: Session = {
    id: 'sess_pending', date: '2026-07-15', columns: [], completedRows: 1, syncedRows: 0,
    startedAt: 1,
    rows: [{
      index: 1, complete: true, values: { c8: '120.5' }, sheetRow: 7, syncState: 'dirty',
      audioClips: {},
    }],
    pendingValidation: {
      row: 1, colId: 'c8', candidateValue: '120.5', previousValue: '100.0',
      previousSyncState: 'synced', previousAudioClip: 'sess_pending:1:c8',
      reviewWait: true, activeColIdx: 0,
      alert: {
        colName: '횡경', prev: '100.0', next: '120.5', direction: 'up', changeText: '20.5',
        row: 1, colId: 'c8', awaitingResponse: true, manualHold: true,
      },
    },
    pendingValidationPersisting: true,
  };

  const safe = withoutPendingCandidate(session);
  expect(safe.pendingValidation).toBeUndefined();
  expect(safe.pendingValidationPersisting).toBeUndefined();
  expect(safe.rows[0].values.c8).toBe('100.0');
  expect(safe.rows[0].syncState).toBe('synced');
  expect(safe.rows[0].audioClips?.c8).toBe('sess_pending:1:c8');
  expect(session.rows[0].values.c8).toBe('120.5');
  expect(session.pendingValidation?.candidateValue).toBe('120.5');
});
