/** [리뷰#6 Critical] 서로 다른 시트에 올렸던 legacy 세션을 한 배치로 확인받으면 남의 행을 덮어쓴다.
 *
 *  확인 흐름(buildLegacySyncPrompt → advanceLegacySyncPrompt)을 실제로 걸어 세션별 답이 독립적으로
 *  적용되는지 보고, 그 결과를 **실제 sync 코어**에 태워 네트워크 요청 목적지로 검증한다.
 *  일괄 적용으로 되돌리면 B 세션이 A시트 17행을 batchUpdate하며 실패해야 한다(반증 가능).
 */
import { test, expect } from '@playwright/test';
import type { Session } from '../src/types';
import { assignLegacySessionTarget } from '../src/lib/sessionSync';
import { buildLegacySyncPrompt, advanceLegacySyncPrompt } from '../src/lib/legacySyncFlow';

const SHEET_A = 'SHEET_LEGACY_BATCH_A';
const SHEET_B = 'SHEET_LEGACY_BATCH_B';
const TARGET_A = { spreadsheetId: SHEET_A, sheetTab: '농가' };

const columns = [
  { id: 'c1', name: '농가명', type: 'text' as const, input: 'auto' as const, ttsAnnounce: false, auto: { kind: 'fixed' as const, value: 'A농가' } },
  { id: 'c2', name: '횡경', type: 'float' as const, input: 'voice' as const, ttsAnnounce: true, auto: { kind: 'fixed' as const, value: '' }, decimals: 1 },
];

/** 업로드 이력이 있는(=좌표를 가진) target 없는 legacy 세션. */
function uploadedLegacy(id: string, date: string, sheetRow: number): Session {
  return {
    id,
    date,
    columns,
    rows: [{ index: 1, values: { c1: 'A농가', c2: '35.1' }, complete: true, sheetRow, syncState: 'dirty' }],
    completedRows: 1,
    syncedRows: 1,
    startedAt: 1784750000000,
  };
}

/** 업로드 이력이 없는 legacy 세션 — 좌표가 없어 어느 답이든 append다. */
function plainLegacy(id: string, date: string): Session {
  return {
    id,
    date,
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
    access_token: 'legacy-batch-token', expires_at: Date.now() + 3_600_000,
  }));
}

async function prepare(sessions: Session[]): Promise<{
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
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      // 목적지만 검증하면 된다. 실패 응답으로 IDB 기록 전에 종료시킨다.
      return new Response('stop before IDB', { status: 500 });
    },
  });
  const [{ useDataStore }, { useSettingsStore }, { syncSelected }] = await Promise.all([
    import('../src/stores/dataStore'),
    import('../src/stores/settingsStore'),
    import('../src/lib/sync'),
  ]);
  useDataStore.getState().setSessions(sessions);
  // 현재 연결은 A. 세션이 target을 갖고 있으면 이 전역 설정은 쓰이지 않아야 한다.
  useSettingsStore.getState().set({
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_A}/edit`,
    sheetTab: '농가',
  });
  return { syncSelected, calls };
}

test('서로 다른 시트에서 온 legacy 세션은 하나씩 따로 묻는다', () => {
  const a = uploadedLegacy('legacy-a', '2026-05-13', 42);
  const b = uploadedLegacy('legacy-b', '2026-06-02', 17);
  const prompt = buildLegacySyncPrompt([a, b], [a.id, b.id], false, TARGET_A, 'A시트의 “농가” 탭');

  expect(prompt).not.toBeNull();
  expect(prompt!.askTotal).toBe(2);
  expect(prompt!.pending).toEqual(['legacy-a', 'legacy-b']);
  // 어느 세션을 묻는지 화면에 드러나야 한다 — 안 그러면 사용자가 답을 고를 근거가 없다.
  expect(prompt!.currentLabel).toContain('2026-05-13');
  expect(prompt!.askedIndex).toBe(1);

  const second = advanceLegacySyncPrompt(prompt!, [a, b]);
  expect(second).not.toBeNull();
  expect(second!.pending).toEqual(['legacy-b']);
  expect(second!.currentLabel).toContain('2026-06-02');
  expect(second!.askedIndex).toBe(2);

  expect(advanceLegacySyncPrompt(second!, [a, b])).toBeNull();
});

test('좌표 없는 legacy는 한 번만 묶어서 묻는다', () => {
  const uploaded = uploadedLegacy('legacy-a', '2026-05-13', 42);
  const p1 = plainLegacy('plain-1', '2026-05-20');
  const p2 = plainLegacy('plain-2', '2026-05-21');
  const prompt = buildLegacySyncPrompt(
    [uploaded, p1, p2], ['legacy-a', 'plain-1', 'plain-2'], false, TARGET_A, 'A시트의 “농가” 탭',
  );

  expect(prompt!.askTotal).toBe(1);              // 좌표 있는 세션만 개별 질문 대상
  expect(prompt!.plain).toEqual(['plain-1', 'plain-2']);

  // 좌표 있는 세션을 답하면 → 좌표 없는 나머지의 확인 1회가 남는다.
  const grouped = advanceLegacySyncPrompt(prompt!, [uploaded, p1, p2]);
  expect(grouped).not.toBeNull();
  expect(grouped!.pending).toEqual([]);
  expect(grouped!.currentLabel).toBe('');
  expect(advanceLegacySyncPrompt(grouped!, [uploaded, p1, p2])).toBeNull();
});

test('legacy가 없으면 확인 없이 바로 동기화한다', () => {
  const targeted: Session = { ...plainLegacy('has-target', '2026-05-13'), target: TARGET_A };
  expect(buildLegacySyncPrompt([targeted], ['has-target'], false, TARGET_A, 'A시트')).toBeNull();
});

/** `confirmLegacySync`와 **같은 규칙**으로 대기열을 소진한다: 질문 하나당 답 하나를 그 세션에만
 *  적용하고, 대기열이 비면 좌표 없는 나머지를 일괄 결합한다. 답은 세션별로 미리 준비한 것을 쓴다.
 *  실제 훅 대신 이걸 쓰는 이유는 IDB·React 상태를 빼고 **결정이 어느 세션에 붙는지**만 보기 위함이다. */
function walkLegacyFlow(
  sessions: Session[],
  answers: Record<string, 'same-sheet' | 'different-sheet'>,
): { sessions: Session[]; asked: string[] } {
  const out = new Map(sessions.map((s) => [s.id, s]));
  const asked: string[] = [];
  let prompt = buildLegacySyncPrompt(
    sessions, sessions.map((s) => s.id), false, TARGET_A, 'A시트의 “농가” 탭',
  );
  while (prompt) {
    const [current] = prompt.pending;
    const ids = current ? [current] : prompt.plain;
    for (const id of ids) {
      if (current) asked.push(id);
      out.set(id, assignLegacySessionTarget(out.get(id)!, prompt.target, answers[id] ?? 'different-sheet'));
    }
    prompt = advanceLegacySyncPrompt(prompt, sessions);
  }
  return { sessions: [...out.values()], asked };
}

test('다른 시트에서 온 세션에 "다른 시트" 답을 주면 A시트 좌표를 건드리지 않는다', async () => {
  const a = uploadedLegacy('legacy-a', '2026-05-13', 42);
  const b = uploadedLegacy('legacy-b', '2026-06-02', 17);

  // A는 "원래 이 시트", B는 "다른 시트" — 세션마다 다른 답을 받을 수 있어야 한다.
  const { sessions, asked } = walkLegacyFlow([a, b], {
    'legacy-a': 'same-sheet',
    'legacy-b': 'different-sheet',
  });
  expect(asked).toEqual(['legacy-a', 'legacy-b']);   // 둘 다 개별로 물어야 한다

  const { syncSelected, calls } = await prepare(sessions);

  // B 세션만 올린다 — 남의 시트(A) 17행을 덮어쓰면 안 된다.
  await syncSelected(['legacy-b']);
  expect(calls.filter((c) => c.url.includes(':batchUpdate'))).toHaveLength(0);
  expect(calls.filter((c) => c.url.includes(':append'))).toHaveLength(1);
  expect(calls.every((c) => c.url.includes(SHEET_A))).toBe(true);   // 목적지는 A(사용자가 고른 현재 시트)
  expect(calls.some((c) => c.url.includes(SHEET_B))).toBe(false);
});

test('"원래 이 시트" 답을 준 세션은 종전대로 기존 행을 갱신한다', async () => {
  const a = uploadedLegacy('legacy-a', '2026-05-13', 42);
  const { sessions } = walkLegacyFlow([a], { 'legacy-a': 'same-sheet' });

  const { syncSelected, calls } = await prepare(sessions);
  await syncSelected(['legacy-a']);

  expect(calls.filter((c) => c.url.includes(':batchUpdate'))).toHaveLength(1);
  expect(calls.filter((c) => c.url.includes(':append'))).toHaveLength(0);
});
