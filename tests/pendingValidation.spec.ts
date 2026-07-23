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

/**
 * v0.38.0 [리뷰#9 후속 — Larry] **확인 전 후보는 실제 Sheets 요청을 만들지 않는다.**
 *
 * 이 계약은 원래 `manual-input.spec.ts:620`(e2e)이 지켰다. 그런데 민구 결정(2026-07-23)으로
 * **업로드는 입력 종료 후에만** 가능해지면서 "입력 중 데이터탭에서 업로드"라는 그 e2e 경로 자체가
 * 도달 불가가 됐다. 검증 가치를 잃지 않도록 **같은 계약을 sync 코어 단위로 옮긴다.**
 * (위 순수 함수 테스트는 안전 뷰의 *모양*만 본다 — 실제로 네트워크에 안 나가는지는 여기서 본다.)
 */
test('[리뷰#9] 확인 전 후보가 있는 세션을 동기화해도 후보 행은 Sheets에 쓰이지 않는다', async () => {
  const SHEET = 'SHEET_PENDING_GUARD';
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => { values.set(k, v); },
      removeItem: (k: string) => { values.delete(k); },
      clear: () => { values.clear(); },
      key: (i: number) => [...values.keys()][i] ?? null,
      get length() { return values.size; },
    },
  });
  localStorage.setItem('gs10_google_token', JSON.stringify({
    access_token: 'pending-guard-token', expires_at: Date.now() + 3_600_000,
  }));

  const writes: Array<{ method: string; url: string; body: string }> = [];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return new Response(JSON.stringify({ values: [['횡경']] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      writes.push({ method, url: String(input), body: String(init?.body ?? '') });
      return new Response('stop before IDB', { status: 500 });
    },
  });

  const [{ useDataStore }, { useSettingsStore }, { syncSelected }] = await Promise.all([
    import('../src/stores/dataStore'),
    import('../src/stores/settingsStore'),
    import('../src/lib/sync'),
  ]);

  // 확인 대기(manualHold) 중인 후보만 가진 세션 — 세션은 이미 종료됐다(업로드 가능 상태).
  const pendingOnly: Session = {
    id: 'pending-guard',
    date: '2026-07-23',
    target: { spreadsheetId: SHEET, sheetTab: '농가' },
    columns: [{
      id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true,
      auto: { kind: 'fixed', value: '' }, decimals: 1,
    }],
    // 행1 = 확인 전 후보(120.5)를 **미업로드 상태로** 둔다 → append 대상이 되므로 후보값이
    // 요청 본문에 실리는지 **직접** 볼 수 있다(보호가 없으면 그대로 실려 나간다 = 반증 가능).
    // 행2는 평범한 행 — 후보 보호가 다른 행까지 막지 않는지 확인한다.
    rows: [
      { index: 1, complete: true, values: { c8: '120.5' }, audioClips: {} },
      { index: 2, complete: true, values: { c8: '33.3' }, audioClips: {} },
    ],
    completedRows: 2,
    syncedRows: 0,
    startedAt: 1784750000000,
    finishedAt: 1784750600000,
    pendingValidation: {
      row: 1, colId: 'c8', candidateValue: '120.5', previousValue: '100.0',
      previousSyncState: 'synced', reviewWait: true, activeColIdx: 0,
      alert: {
        colName: '횡경', prev: '100.0', next: '120.5', direction: 'up', changeText: '20.5',
        row: 1, colId: 'c8', awaitingResponse: true, manualHold: true,
      },
    },
  } as unknown as Session;

  useDataStore.getState().setSessions([pendingOnly]);
  useSettingsStore.getState().set({
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}/edit`,
    sheetTab: '농가',
  });

  await syncSelected(['pending-guard']);

  expect(writes.length).toBeGreaterThan(0);   // 쓰기 자체는 일어나야 이 검증이 성립한다
  // 확인 전 후보(120.5)는 **어떤 쓰기 요청에도** 실려 나가면 안 된다 — 이 계약이 핵심이다.
  expect(writes.filter((w) => w.body.includes('120.5'))).toHaveLength(0);
  // 평범한 행은 정상적으로 나간다 — 후보 보호가 다른 행까지 막지 않는다.
  expect(writes.filter((w) => w.body.includes('33.3'))).toHaveLength(1);
});
