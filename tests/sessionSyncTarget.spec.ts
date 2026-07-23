/** 실제 syncSelected 코어를 브라우저 없이 실행해 Session.target 외 목적지 쓰기를 차단한다. */
import { test, expect } from '@playwright/test';
import type { Session } from '../src/types';
import { assignLegacySessionTarget } from '../src/lib/sessionSync';

const SHEET_A = 'SHEET_SYNC_CORE_A';
const SHEET_B = 'SHEET_SYNC_CORE_B';
const columns = [
  { id: 'c1', name: '농가명', type: 'text' as const, input: 'auto' as const, ttsAnnounce: false, auto: { kind: 'fixed' as const, value: 'A농가' } },
  { id: 'c2', name: '횡경', type: 'float' as const, input: 'voice' as const, ttsAnnounce: true, auto: { kind: 'fixed' as const, value: '' }, decimals: 1 },
];

function session(target: boolean): Session {
  return {
    id: target ? 'core-target' : 'core-legacy',
    date: '2026-07-23',
    ...(target ? { target: { spreadsheetId: SHEET_A, sheetTab: '농가' } } : {}),
    columns,
    rows: [{ index: 1, values: { c1: 'A농가', c2: '35.1' }, complete: true }],
    completedRows: 1,
    syncedRows: 0,
    startedAt: 1784750000000,
  };
}

function installStorage(): void {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => { values.clear(); },
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    },
  });
  localStorage.setItem('gs10_google_token', JSON.stringify({
    access_token: 'core-token', expires_at: Date.now() + 3_600_000,
  }));
}

async function prepare(target: boolean): Promise<{
  syncSelected: (ids: string[]) => Promise<unknown>;
  calls: Array<{ method: string; url: string }>;
}> {
  return prepareSession(session(target));
}

async function prepareSession(storedSession: Session): Promise<{
  syncSelected: (ids: string[]) => Promise<unknown>;
  calls: Array<{ method: string; url: string }>;
}> {
  installStorage();
  const calls: Array<{ method: string; url: string }> = [];
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'GET') {
        return new Response(JSON.stringify({ values: [['농가명', '횡경']] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // 요청 목적지만 검증하면 된다. 실패 응답으로 saveSession(IDB) 전 단계에서 종료시킨다.
      return new Response('stop before IDB', { status: 500 });
    },
  });
  const [{ useDataStore }, { useSettingsStore }, { syncSelected }] = await Promise.all([
    import('../src/stores/dataStore'),
    import('../src/stores/settingsStore'),
    import('../src/lib/sync'),
  ]);
  useDataStore.getState().setSessions([storedSession]);
  useSettingsStore.getState().set({
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_B}/edit`,
    sheetTab: '농가',
  });
  return { syncSelected, calls };
}

test('전역 설정이 B여도 A target 세션의 네트워크 요청은 A로만 간다', async () => {
  const { syncSelected, calls } = await prepare(true);
  await syncSelected(['core-target']);

  expect(calls.some((call) => call.url.includes(SHEET_A))).toBe(true);
  expect(calls.filter((call) => call.url.includes(SHEET_B))).toHaveLength(0);
});

test('target 없는 legacy 세션은 네트워크 전에 fail-closed한다', async () => {
  const { syncSelected, calls } = await prepare(false);
  const report = await syncSelected(['core-legacy']) as { failed: number; failures: Array<{ reason: string }> };

  expect(calls).toHaveLength(0);
  expect(report.failed).toBe(1);
  expect(report.failures[0].reason).toContain('대상 시트를 알 수 없습니다');
});

test('업로드 이력 legacy를 다른 시트로 결합하면 update 없이 append만 요청한다', async () => {
  const legacy: Session = {
    ...session(false),
    id: 'core-legacy-uploaded',
    rows: [{
      index: 1,
      values: { c1: 'A농가', c2: '35.1' },
      complete: true,
      sheetRow: 42,
      syncState: 'dirty',
    }],
  };
  const assigned = assignLegacySessionTarget(
    legacy,
    { spreadsheetId: SHEET_B, sheetTab: '농가' },
    'different-sheet',
  );
  const { syncSelected, calls } = await prepareSession(assigned);
  await syncSelected([assigned.id]);

  expect(calls.filter((call) => call.url.includes(':append'))).toHaveLength(1);
  expect(calls.filter((call) => call.url.includes(':batchUpdate'))).toHaveLength(0);
});

test('업로드 이력 없는 legacy는 대상 확인 후 종전처럼 append한다', async () => {
  const assigned = assignLegacySessionTarget(
    session(false),
    { spreadsheetId: SHEET_B, sheetTab: '농가' },
    'same-sheet',
  );
  const { syncSelected, calls } = await prepareSession(assigned);
  await syncSelected([assigned.id]);

  expect(calls.filter((call) => call.url.includes(':append'))).toHaveLength(1);
  expect(calls.filter((call) => call.url.includes(':batchUpdate'))).toHaveLength(0);
});
