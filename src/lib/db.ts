import { openDB, type IDBPDatabase } from 'idb';
import type { Session } from '../types';

const DB_NAME = 'survey-011';
const DB_VERSION = 6;

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
        if (oldVersion < 5) {
          // v0.33.0 항목10-B: 입력화면 자동 캡처(JPEG 저화질) 저장소. 키 `${sessionId}:${ts}:${trigger}`
          // — audioClips와 같은 `${sessionId}:` 접두 규약이라 세션 삭제 cascade가 prefix 매칭으로 동작.
          db.createObjectStore('screenshots');
        }
        if (oldVersion < 6) {
          // v0.33.0 항목11: 개선요청(feedback) 오프라인/미로그인 큐. 전송 실패/불가 시 zip을 통째로
          // 보관했다가 온라인·로그인 복귀 시 자동 재전송한다(feedback.ts flushFeedbackQueue).
          // ⚠️ [ENV-11] DB_VERSION bump — 테스트의 `indexedDB.open('survey-011', N)` 하드코딩·스키마
          // 미러 6곳을 함께 갱신할 것(grep 체크리스트).
          db.createObjectStore('feedbackQueue', { keyPath: 'id', autoIncrement: true });
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

/** Delete session row and cascade-delete its audio clips + log events + screenshots.
 *  Clip/screenshot keys follow `${sessionId}:...` so prefix match is safe. */
export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  // v0.33.0 10-B — screenshots cascade. 일부 테스트 컨텍스트는 자체 upgrade 핸들러로 구버전 스키마
  // (screenshots 없음)를 만들 수 있어 방어적으로 존재 확인 후 트랜잭션에 포함한다.
  const hasScreens = db.objectStoreNames.contains('screenshots');
  const storeNames = hasScreens
    ? ['sessions', 'audioClips', 'logEvents', 'screenshots']
    : ['sessions', 'audioClips', 'logEvents'];
  const tx = db.transaction(storeNames, 'readwrite');
  await tx.objectStore('sessions').delete(id);

  const prefix = `${id}:`;
  const clipsStore = tx.objectStore('audioClips');
  const allKeys = (await clipsStore.getAllKeys()) as string[];
  for (const key of allKeys) {
    if (typeof key === 'string' && key.startsWith(prefix)) {
      await clipsStore.delete(key);
    }
  }

  if (hasScreens) {
    const screensStore = tx.objectStore('screenshots');
    const screenKeys = (await screensStore.getAllKeys()) as string[];
    for (const key of screenKeys) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        await screensStore.delete(key);
      }
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

// ─── 자동 화면 캡처 (v0.33.0 항목10-B) ─────────────────────────────────────
/** 캡처 JPEG를 screenshots 스토어에 저장. audioClips와 같은 {buf,type} 분해 저장(iOS Safari
 *  Blob-in-IDB 안전 규약). 캡처는 항상 best-effort — 실패는 호출자(screenshot.ts)가 로깅한다. */
export async function saveScreenshot(key: string, blob: Blob): Promise<void> {
  const db = await getDb();
  const buf = await blob.arrayBuffer();
  const record: StoredClip = { buf, type: blob.type || 'image/jpeg' };
  await db.put('screenshots', record, key);
}

export async function loadScreenshot(key: string): Promise<Blob | null> {
  const db = await getDb();
  const v = await db.get('screenshots', key);
  if (v == null) return null;
  if (isStoredClip(v)) return new Blob([v.buf], { type: v.type });
  if (v instanceof Blob) return v;
  return null;
}

export async function loadAllScreenshotKeys(): Promise<string[]> {
  const db = await getDb();
  return (await db.getAllKeys('screenshots')) as string[];
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

// ─── 시트 등록 전용 내구 레코드 (v0.19.0 W2 — 업데이트/evict 무관 복원 경로) ──────
/** v0.19.0 W2 — savedSheets(저장 시트 목록)·연결 시트 URL·토큰 표식을 settings persist와 **별개**
 *  IDB 'kv' 레코드로도 미러한다. 홈 설치형 앱 업데이트 부팅 시 localStorage가 evict되면 settings
 *  persist의 IDB 미러가 하이드레이션 레이스로 빈 배열에 덮일 위험이 있었다(W2 근본원인). 이 전용
 *  레코드는 saveSheet/removeSavedSheet에서만 쓰여 bulk write-through(전체 settings 직렬화)에
 *  절대 덮이지 않으므로, 버전 마이그레이션·evict와 무관하게 시트 목록을 결정론적으로 복원한다.
 *  키는 settings persist name과 충돌하지 않도록 `__saved_sheets__` 접두를 쓴다. */
const SHEETS_RECORD_KEY = '__saved_sheets__';

export interface SheetsRecord {
  /** 저장된 스프레드시트 링크 목록(SavedSheet[]의 JSON 직렬화 형태). */
  savedSheets: unknown[];
  /** 마지막으로 연결됐던 시트 URL(부팅 시 settings가 비면 함께 복원 후보). */
  sheetUrl?: string;
  /** 최종 갱신 시각(epoch ms) — 디버깅/관측용. */
  updatedAt: number;
}

export async function saveSheetsRecord(rec: SheetsRecord): Promise<void> {
  try {
    const db = await getDb();
    await db.put('kv', rec, SHEETS_RECORD_KEY);
  } catch { /* IDB 불가 — settings persist가 1차 경로이므로 무해 */ }
}

export async function loadSheetsRecord(): Promise<SheetsRecord | null> {
  try {
    const db = await getDb();
    const v = await db.get('kv', SHEETS_RECORD_KEY);
    if (v && typeof v === 'object' && Array.isArray((v as SheetsRecord).savedSheets)) {
      return v as SheetsRecord;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── 과거값 인덱스 내구 레코드 (v0.33.0 항목5 — 로그인 무관 이상치 알람) ─────────
/** v0.33.0 항목5 — 과거값 인덱스(pastValues)의 IDB write-through 레코드. 07-13 실기기에서 토큰
 *  만료(~1h, [AUTH-4]) 후 `past_index_skip:not_signed_in`으로 이상치 알람이 침묵해 -99.5% 오데이터가
 *  무알람 통과했다([TREND-AUTH-1] 잔여). 이 레코드는 loadPastIndex 성공 시마다 갱신되고, 부팅/세션
 *  시작 시 fp 일치 + 14일 이내면 폴백 인덱스로 복원되어 **미로그인이어도 알람이 작동**한다.
 *  기존 'kv' 스토어 재사용(신규 스토어·DB 버전 bump 불요). 직렬화/검증은 pastValues.ts 소유 —
 *  여기서는 JSON-호환 레코드의 round-trip만 담당한다(SheetsRecord 패턴). */
const PAST_INDEX_RECORD_KEY = '__past_index__';

export async function savePastIndexBackup(rec: unknown): Promise<void> {
  try {
    const db = await getDb();
    await db.put('kv', rec, PAST_INDEX_RECORD_KEY);
  } catch { /* IDB 불가/쿼터 — 인메모리 캐시(모듈 캐시)가 1차 경로이므로 무해 */ }
}

export async function loadPastIndexBackup(): Promise<unknown | null> {
  try {
    const db = await getDb();
    const v = await db.get('kv', PAST_INDEX_RECORD_KEY);
    return v ?? null;
  } catch {
    return null;
  }
}

/** 설정 초기화(시트 삭제 opt-in) 시 함께 비운다 — fp 불일치로 어차피 안 쓰이지만 데이터 위생. */
export async function deletePastIndexBackup(): Promise<void> {
  try {
    const db = await getDb();
    await db.delete('kv', PAST_INDEX_RECORD_KEY);
  } catch { /* ignore */ }
}

// ─── 개선요청 큐 (v0.33.0 항목11 — 오프라인/미로그인/부분실패 재전송) ────────────
/** 큐 항목: 만들어 둔 feedback zip 원본 + 남은 업로드 레그. zip은 ArrayBuffer로 분해 저장
 *  (iOS Safari Blob-in-IDB 규약 — StoredClip과 동일 이유). 두 레그가 모두 끝나야 삭제된다. */
export interface FeedbackQueueItem {
  id?: number;
  createdAt: number;
  filename: string;
  zipBuf: ArrayBuffer;
  /** 사용자 Drive(survey-011/feedback/) 레그 미완 여부. */
  pendingUser: boolean;
  /** 관리자 폴더(<email>/ 하위) 레그 미완 여부 — non-fatal: 사용자 레그만 성공해도 UX상 성공. */
  pendingAdmin: boolean;
  attempts: number;
  lastError?: string;
}

/** 큐 스토어 부재(구스키마 미러로 만든 테스트 DB 등) 방어 — 전 함수 공통. */
async function feedbackStoreReady(): Promise<IDBPDatabase | null> {
  try {
    const db = await getDb();
    return db.objectStoreNames.contains('feedbackQueue') ? db : null;
  } catch {
    return null;
  }
}

export async function enqueueFeedback(item: Omit<FeedbackQueueItem, 'id'>): Promise<void> {
  const db = await feedbackStoreReady();
  if (!db) return;
  await db.add('feedbackQueue', item);
}

export async function loadFeedbackQueue(): Promise<FeedbackQueueItem[]> {
  const db = await feedbackStoreReady();
  if (!db) return [];
  return (await db.getAll('feedbackQueue')) as FeedbackQueueItem[];
}

export async function updateFeedbackQueueItem(item: FeedbackQueueItem): Promise<void> {
  const db = await feedbackStoreReady();
  if (!db || item.id == null) return;
  await db.put('feedbackQueue', item);
}

export async function deleteFeedbackQueueItem(id: number): Promise<void> {
  const db = await feedbackStoreReady();
  if (!db) return;
  await db.delete('feedbackQueue', id);
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
