import { test, expect } from '@playwright/test';
import { useSessionStore } from '../src/stores/sessionStore';
import type { Session } from '../src/types';

function pendingSession(): Session {
  return {
    id: 'sess_restore',
    date: '2026-07-29',
    columns: [],
    rows: [{ index: 1, values: { c8: '11.1' }, complete: false }],
    completedRows: 0,
    syncedRows: 0,
    startedAt: 1,
    pendingValidation: {
      row: 1,
      colId: 'c8',
      candidateValue: '11.1',
      previousValue: '10.0',
      reviewWait: false,
      activeColIdx: 0,
      alert: {
        colName: '횡경',
        prev: '10.0',
        next: '11.1',
        direction: 'up',
        changeText: '1.1',
        row: 1,
        colId: 'c8',
        awaitingResponse: true,
        manualHold: true,
      },
    },
  };
}

test.beforeEach(() => useSessionStore.getState().resetAll());

test('[EXIT-PERSIST-1] endReachedOnce는 끝 도달 뒤 현재 화면 전환과 무관하게 유지된다', () => {
  const store = useSessionStore.getState();
  expect(store.endReachedOnce).toBe(false);

  store.setEndReached(true);
  expect(useSessionStore.getState()).toMatchObject({ endReached: true, endReachedOnce: true });

  store.setEndReached(false);
  expect(useSessionStore.getState()).toMatchObject({ endReached: false, endReachedOnce: true });

  store.setPhase('active');
  expect(useSessionStore.getState()).toMatchObject({ endReached: false, endReachedOnce: true });
});

test('[EXIT-PERSIST-1] resetAll과 pendingValidation 복원은 새 세션 래치를 false로 초기화한다', () => {
  const store = useSessionStore.getState();
  store.setEndReached(true);
  store.resetAll();
  expect(useSessionStore.getState().endReachedOnce).toBe(false);

  useSessionStore.getState().setEndReached(true);
  useSessionStore.getState().restorePendingValidation(pendingSession());
  expect(useSessionStore.getState()).toMatchObject({ endReached: false, endReachedOnce: false });
});
