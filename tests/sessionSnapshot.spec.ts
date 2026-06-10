/**
 * sessionSnapshot — 순수 로직 단위 테스트 (v0.5.0 W8: 로그 zip 기반 세션 복구).
 *
 * audioTrim.spec.ts / koreanNum.spec.ts와 같은 패턴: IDB/Drive 의존부는 deps 주입으로 제외하고,
 * sessions.json 직렬화↔복원 round-trip과 zip 복원 계약을 Node에서 직접 검증한다.
 * JSZip은 Node에서 동작하고 Blob은 Node 18+ global이라 별도 polyfill 불필요.
 *
 * 1·2차 배치 인계 검증 포함: 클립 키에 `:raw`, `:cmd<n>:raw` suffix —
 * `split(':')` 5조각 키가 **문자열 그대로** round-trip되어야 한다.
 */

import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import {
  buildSessionsSnapshot,
  parseSessionsSnapshot,
  restoreSessionsFromZip,
  isValidSession,
  SNAPSHOT_SCHEMA,
  type ZipRestoreDeps,
} from '../src/lib/sessionSnapshot';
import type { Session } from '../src/types';

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    date: '2026-06-10',
    label: 'A구역',
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    rows: [
      { index: 1, values: { c6: '1', c8: '35.1' }, complete: true, audioClips: { c8: `${id}:1:c8` } },
      // W2 placeholder 행(complete:false)도 스냅샷에 그대로 보존되어야 한다.
      { index: 2, values: { c6: '2', c8: '' }, complete: false },
      { index: 3, values: { c6: '3', c8: '41.3' }, complete: true, audioClips: { c8: `${id}:3:c8` } },
    ],
    completedRows: 2,
    syncedRows: 1,
    startedAt: 1781000000000,
    finishedAt: 1781000600000,
    ...overrides,
  };
}

function collectDeps() {
  const savedSessions: Session[] = [];
  const savedClips: { key: string; type: string; size: number }[] = [];
  const deps: ZipRestoreDeps = {
    saveSession: async (s) => { savedSessions.push(s); },
    saveAudioClip: async (key, blob) => { savedClips.push({ key, type: blob.type, size: blob.size }); },
  };
  return { deps, savedSessions, savedClips };
}

async function buildZip(entries: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return zip.generateAsync({ type: 'uint8array' });
}

test.describe('buildSessionsSnapshot ↔ parseSessionsSnapshot round-trip', () => {
  test('전체 Session 객체(placeholder 행·라벨·syncedRows 포함)가 그대로 보존된다', () => {
    const sessions = [makeSession('s1'), makeSession('s2', { label: undefined, syncedRows: 0 })];
    const text = buildSessionsSnapshot(sessions, '0.5.0');
    const snap = parseSessionsSnapshot(text);
    expect(snap).not.toBeNull();
    expect(snap!.schema).toBe(SNAPSHOT_SCHEMA);
    expect(snap!.appVersion).toBe('0.5.0');
    // JSON round-trip 동등성 (undefined 필드는 직렬화에서 빠지는 게 정상)
    expect(snap!.sessions).toEqual(JSON.parse(JSON.stringify(sessions)));
    const s1 = snap!.sessions.find((s) => s.id === 's1')!;
    expect(s1.rows[1].complete).toBe(false); // placeholder 행 보존
    expect(s1.rows[0].audioClips!['c8']).toBe('s1:1:c8'); // 클립 키 보존
    expect(s1.syncedRows).toBe(1);
  });

  test('비스냅샷/손상 입력 → null', () => {
    expect(parseSessionsSnapshot('not json')).toBeNull();
    expect(parseSessionsSnapshot('[]')).toBeNull();
    expect(parseSessionsSnapshot('{"foo":1}')).toBeNull();
    expect(parseSessionsSnapshot('{"schema":0,"sessions":[]}')).toBeNull();
  });

  test('깨진 세션은 세션 단위로 걸러진다 (전체 복구를 죽이지 않음)', () => {
    const good = makeSession('s-good');
    const text = JSON.stringify({
      schema: 1,
      appVersion: '0.5.0',
      sessions: [good, { id: '' }, { id: 's-bad', rows: 'oops' }, null],
    });
    const snap = parseSessionsSnapshot(text);
    expect(snap).not.toBeNull();
    expect(snap!.sessions.map((s) => s.id)).toEqual(['s-good']);
  });

  test('isValidSession — startedAt NaN([RACE-7] 잔재) 거부', () => {
    expect(isValidSession(makeSession('s1'))).toBe(true);
    expect(isValidSession({ ...makeSession('s1'), startedAt: NaN })).toBe(false);
  });
});

test.describe('restoreSessionsFromZip — zip 복원 계약', () => {
  test('로컬에 없는 세션 + 해당 클립을 키 문자열 그대로 복원 (:raw / :cmd<n>:raw 5조각 키 포함)', async () => {
    const session = makeSession('s1');
    const clipKeys = ['s1:1:c8', 's1:1:c8:raw', 's1:3:c8', 's1:3:c8:cmd2:raw', 's1:3:c8:a1'];
    const entries: Record<string, string | Uint8Array> = {
      'device.json': '{}',
      'events.json': '[]',
      'sessions.json': buildSessionsSnapshot([session], '0.5.0'),
    };
    for (const k of clipKeys) entries[`clips/${k}.wav`] = new Uint8Array([82, 73, 70, 70]);
    entries['clips/s1:1:c8:cmd1.webm'] = new Uint8Array([1, 2, 3]); // 다른 컨테이너도 mime 매핑
    entries['clips/other:1:c8.wav'] = new Uint8Array([9]); // 대상 외 세션 클립은 제외

    const zipData = await buildZip(entries);
    const { deps, savedSessions, savedClips } = collectDeps();
    const localIds = new Set<string>();
    const r = await restoreSessionsFromZip(zipData, localIds, deps);

    expect(r.legacy).toBe(false);
    expect(r.restoredSessions).toBe(1);
    expect(r.restoredClips).toBe(6); // s1 클립 5 wav + 1 webm (other:* 제외)
    expect(savedSessions.map((s) => s.id)).toEqual(['s1']);
    expect(savedSessions[0]).toEqual(JSON.parse(JSON.stringify(session)));
    // 키 round-trip: 파싱/재조립 없이 그대로
    const keys = savedClips.map((c) => c.key).sort();
    expect(keys).toEqual([...clipKeys, 's1:1:c8:cmd1'].sort());
    expect(savedClips.find((c) => c.key === 's1:1:c8')!.type).toBe('audio/wav');
    expect(savedClips.find((c) => c.key === 's1:1:c8:cmd1')!.type).toBe('audio/webm');
    expect(localIds.has('s1')).toBe(true); // 호출부 누적용 Set 갱신
  });

  test('로컬에 이미 있는 세션은 건너뛴다 (클립 포함)', async () => {
    const zipData = await buildZip({
      'sessions.json': buildSessionsSnapshot([makeSession('s1')], '0.5.0'),
      'clips/s1:1:c8.wav': new Uint8Array([1]),
    });
    const { deps, savedSessions, savedClips } = collectDeps();
    const r = await restoreSessionsFromZip(zipData, new Set(['s1']), deps);
    expect(r.restoredSessions).toBe(0);
    expect(r.restoredClips).toBe(0);
    expect(savedSessions.length).toBe(0);
    expect(savedClips.length).toBe(0);
  });

  test('같은 세션이 두 zip에 있으면 먼저(=최신순 호출 시 최신) 복원된 쪽이 이긴다', async () => {
    const newer = await buildZip({
      'sessions.json': buildSessionsSnapshot([makeSession('s1', { completedRows: 3 })], '0.5.0'),
    });
    const older = await buildZip({
      'sessions.json': buildSessionsSnapshot([makeSession('s1', { completedRows: 1 })], '0.4.5'),
    });
    const { deps, savedSessions } = collectDeps();
    const localIds = new Set<string>();
    const r1 = await restoreSessionsFromZip(newer, localIds, deps);
    const r2 = await restoreSessionsFromZip(older, localIds, deps);
    expect(r1.restoredSessions).toBe(1);
    expect(r2.restoredSessions).toBe(0); // 최신 zip이 이미 복원 → 구 zip 무시
    expect(savedSessions.length).toBe(1);
    expect(savedSessions[0].completedRows).toBe(3);
  });

  test('sessions.json 없는 구버전 zip → legacy:true, 아무것도 저장 안 함', async () => {
    const zipData = await buildZip({
      'device.json': '{}',
      'events.json': '[]',
      'clips/s1:1:c8.webm': new Uint8Array([1]),
    });
    const { deps, savedSessions, savedClips } = collectDeps();
    const r = await restoreSessionsFromZip(zipData, new Set(), deps);
    expect(r).toEqual({ legacy: true, restoredSessions: 0, restoredClips: 0 });
    expect(savedSessions.length).toBe(0);
    expect(savedClips.length).toBe(0);
  });

  test('sessions.json이 손상된 zip도 구버전 취급 (graceful)', async () => {
    const zipData = await buildZip({ 'sessions.json': '{broken json' });
    const { deps } = collectDeps();
    const r = await restoreSessionsFromZip(zipData, new Set(), deps);
    expect(r.legacy).toBe(true);
  });

  test('exportLogZip 실물 형태 재현 — Blob 입력으로도 동작 (DataScreen 경로)', async () => {
    const zipData = await buildZip({
      'sessions.json': buildSessionsSnapshot([makeSession('s1')], '0.5.0'),
      'clips/s1:1:c8.wav': new Uint8Array([82, 73, 70, 70]),
    });
    const blob = new Blob([Buffer.from(zipData)], { type: 'application/zip' });
    const { deps, savedClips } = collectDeps();
    const r = await restoreSessionsFromZip(blob, new Set(), deps);
    expect(r.restoredSessions).toBe(1);
    expect(savedClips[0].key).toBe('s1:1:c8');
    expect(savedClips[0].size).toBe(4);
  });
});
