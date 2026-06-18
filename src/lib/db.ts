import { openDB, type IDBPDatabase } from 'idb';
import type { Session } from '../types';

const DB_NAME = 'survey-011';
const DB_VERSION = 4;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    // D1(v0.4.5): rejected/끊긴 promise가 영구 캐시돼 "세션 복구"가 계속 실패하는 것을 방지.
    // - rethrowing-catch: open이 실패하면 캐시를 비워 다음 호출이 새 연결을 연다(현재 호출자는 거부 수신).
    // - terminated: 연결이 비정상 종료되면 캐시를 비워 다음 접근 시 재오픈.
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('sessions', { keyPath: 'id' });
          store.createIndex('byDate', 'date');
          store.createIndex('bySync', 'syncedRows');
        }
        if (oldVersion < 2) {
          db.createObjectStore('audioClips');
        }
        if (oldVersion < 3) {
          // v5.2 Codex 4차 MEDIUM: Logger events 영속화.
          // autoIncrement key + sessionId 인덱스로 reload 후에도 세션별 이벤트 조회 가능.
          const logs = db.createObjectStore('logEvents', { keyPath: 'id', autoIncrement: true });
          logs.createIndex('bySessionId', 'sessionId');
        }
        if (oldVersion < 4) {
          // v0.14.0 C: 설정(스프레드시트 URL·컬럼·저장시트)의 내구 미러. iOS Safari가 일정시간
          // 경과/강제종료 후 localStorage를 evict하면 시트 등록이 통째로 풀리던 문제(민구 보고)의
          // 방어선 — localStorage가 비면 여기서 복원한다. 키=persist name, 값=JSON 문자열.
          db.createObjectStore('kv');
        }
      },
      terminated() {
        // 연결이 예기치 않게 닫힘(브라우저 회수, PWA 업데이트 등) → 캐시 무효화.
        dbPromise = null;
      },
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** D1(v0.4.5): 강제로 캐시된 연결을 버리고 다음 getDb()가 새로 열게 한다.
 *  "세션 복구" 버튼에서 stale/끊긴 연결을 우회해 재하이드레이션하기 위해 사용. */
export function resetDb(): void {
  dbPromise = null;
}

export async function saveSession(session: Session): Promise<void> {
  const db = await getDb();
  await db.put('sessions', session);
}

export async function loadAllSessions(): Promise<Session[]> {
  const db = await getDb();
  const all = (await db.getAll('sessions')) as Session[];
  all.sort((a, b) => b.startedAt - a.startedAt);
  return all;
}

/** Delete session row and cascade-delete its audio clips + log events.
 *  Clip keys follow `${sessionId}:${row}:${colId}` so prefix match is safe. */
export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['sessions', 'audioClips', 'logEvents'], 'readwrite');
  await tx.objectStore('sessions').delete(id);

  const clipsStore = tx.objectStore('audioClips');
  const allKeys = (await clipsStore.getAllKeys()) as string[];
  const prefix = `${id}:`;
  for (const key of allKeys) {
    if (typeof key === 'string' && key.startsWith(prefix)) {
      await clipsStore.delete(key);
    }
  }

  const logsStore = tx.objectStore('logEvents');
  const idx = logsStore.index('bySessionId');
  let cursor = await idx.openCursor(id);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  await tx.done;
}

export async function loadUnsyncedSessions(): Promise<Session[]> {
  const all = await loadAllSessions();
  return all.filter((s) => s.syncedRows < s.completedRows);
}

/** iOS Safari는 Blob을 IndexedDB에 직접 저장할 때 실패하는 이력이 있음(WebKit 버그).
 *  ArrayBuffer + type 문자열로 분해 저장하면 모든 브라우저에서 안전하게 round-trip됨. */
interface StoredClip {
  buf: ArrayBuffer;
  type: string;
}

function isStoredClip(v: unknown): v is StoredClip {
  return (
    typeof v === 'object' &&
    v !== null &&
    'buf' in v &&
    (v as { buf: unknown }).buf instanceof ArrayBuffer
  );
}

export async function saveAudioClip(key: string, blob: Blob): Promise<void> {
  const db = await getDb();
  const buf = await blob.arrayBuffer();
  const record: StoredClip = { buf, type: blob.type || 'audio/webm' };
  await db.put('audioClips', record, key);
}

export async function loadAudioClip(key: string): Promise<Blob | null> {
  const db = await getDb();
  const v = await db.get('audioClips', key);
  if (v == null) return null;
  // 신형: { buf, type } 객체
  if (isStoredClip(v)) return new Blob([v.buf], { type: v.type });
  // 구형 하위호환: Blob을 직접 저장했던 레코드
  if (v instanceof Blob) return v;
  return null;
}

export async function deleteAudioClip(key: string): Promise<void> {
  const db = await getDb();
  await db.delete('audioClips', key);
}

export async function loadAllAudioClipKeys(): Promise<string[]> {
  const db = await getDb();
  return (await db.getAllKeys('audioClips')) as string[];
}

// ─── 설정 내구 미러 (v0.14.0 C — localStorage eviction 방어) ────────────────
/** persist된 설정 JSON 문자열을 IDB 'kv' 스토어에 미러(write-through). best-effort —
 *  IDB 불가/쿼터 초과여도 localStorage 경로는 그대로 동작하므로 조용히 무시한다. */
export async function saveSettingsBackup(key: string, value: string): Promise<void> {
  try {
    const db = await getDb();
    await db.put('kv', value, key);
  } catch { /* IDB 불가 — localStorage가 1차 저장소이므로 무해 */ }
}

/** IDB 미러에서 설정 JSON 문자열을 읽는다(localStorage가 evict된 경우 복원용). 없으면 null. */
export async function loadSettingsBackup(key: string): Promise<string | null> {
  try {
    const db = await getDb();
    const v = await db.get('kv', key);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** IDB 미러 삭제(설정 초기화 시). */
export async function deleteSettingsBackup(key: string): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('kv', key);
  } catch { /* ignore */ }
}

// ─── Log events (v5.2 Codex 4차 MEDIUM) ────────────────────────────────────
export interface PersistedLogEntry {
  id?: number;
  ts: number;
  type: string;
  sessionId?: string;
  // Loose shape — logger.ts owns the full type; here we only need to round-trip JSON.
  [k: string]: unknown;
}

export async function appendLogEvent(entry: Omit<PersistedLogEntry, 'id'>): Promise<void> {
  try {
    const db = await getDb();
    await db.add('logEvents', entry);
  } catch { /* IDB unavailable or quota — fall back to in-memory only */ }
}

export async function loadLogEvents(sessionIds?: string[]): Promise<PersistedLogEntry[]> {
  const db = await getDb();
  if (!sessionIds) {
    return (await db.getAll('logEvents')) as PersistedLogEntry[];
  }
  if (sessionIds.length === 0) return [];
  const tx = db.transaction('logEvents', 'readonly');
  const idx = tx.objectStore('logEvents').index('bySessionId');
  const results: PersistedLogEntry[] = [];
  for (const sid of sessionIds) {
    const rows = (await idx.getAll(sid)) as PersistedLogEntry[];
    results.push(...rows);
  }
  await tx.done;
  results.sort((a, b) => a.ts - b.ts);
  return results;
}
