/**
 * [ENV-11]/[ENV-3] 근절 — 앱 IndexedDB 이름·버전·스키마의 테스트측 SSOT (v0.35.1 Stage 1-5 신설).
 *
 * 종전에는 27개 spec이 `indexedDB.open('survey-011', 6)`을 하드코딩하고 6곳이 스키마 미러를
 * 복붙해, DB_VERSION bump마다 전수 grep 갱신이 필요했고([ENV-11]) 미러가 신규 스토어를 빠뜨리면
 * 침묵 실패했다([ENV-3]). 이 fixture가 규약을 한 곳으로 모은다:
 *
 *  - 이름·버전은 앱 `src/lib/db.ts`의 export를 **재수출** — 앱이 bump하면 자동 추종.
 *  - **버전 무지정 open**(`indexedDB.open(name)`)이 "이미 부팅된 앱 DB에 시딩"하는 spec의 표준.
 *    기존 DB를 그 버전 그대로 열므로 bump와 무관하다. (부팅 전 시딩만 버전+스키마가 필요.)
 *  - 부팅 전 시딩(앱보다 먼저 DB를 만드는 spec)은 APPLY_APP_SCHEMA_SOURCE를 브라우저 컨텍스트에
 *    인자로 넘겨 upgrade 핸들러에서 복원한다(아래 사용법). 스키마 미러는 이 파일의 applyAppSchema
 *    **한 벌**뿐이다 — DB_VERSION bump 시 여기에만 신규 스토어를 반영한다.
 *  - tests/idb-fixture.spec.ts 가드가 spec의 버전 하드코딩 재유입을 막는다.
 *
 * 부팅 전 시딩 사용법(page.evaluate/addInitScript 콜백은 직렬화되어 import를 못 가져간다 —
 * 소스 문자열을 인자로 넘겨 복원):
 *
 *   import { IDB, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';
 *   await page.evaluate(async ({ idb, schemaSrc, ...seed }) => {
 *     const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
 *     const open = indexedDB.open(idb.name, idb.version);
 *     open.onupgradeneeded = () => applySchema(open.result);
 *     ...
 *   }, { idb: IDB, schemaSrc: APPLY_APP_SCHEMA_SOURCE, ...seed });
 */

import { DB_NAME, DB_VERSION } from '../../src/lib/db';

export { DB_NAME, DB_VERSION };

/** 브라우저 컨텍스트 인자로 통째로 넘기기 좋은 형태. */
export const IDB = { name: DB_NAME, version: DB_VERSION } as const;

/** 앱 스키마 미러(테스트 유일 사본) — src/lib/db.ts upgrade와 동일한 최종 형태(v6 기준 6스토어).
 *  idempotent(존재 확인 후 생성)라 부분 생성된 DB 위에서도 안전하다.
 *  ⚠️ 클로저 금지 — toString() 직렬화로 브라우저에 주입되므로 바깥 식별자를 참조할 수 없다. */
export function applyAppSchema(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains('sessions')) {
    const store = db.createObjectStore('sessions', { keyPath: 'id' });
    store.createIndex('byDate', 'date');
    store.createIndex('bySync', 'syncedRows');
  }
  if (!db.objectStoreNames.contains('audioClips')) db.createObjectStore('audioClips');
  if (!db.objectStoreNames.contains('logEvents')) {
    const logs = db.createObjectStore('logEvents', { keyPath: 'id', autoIncrement: true });
    logs.createIndex('bySessionId', 'sessionId');
  }
  if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); // v0.14.0 C
  if (!db.objectStoreNames.contains('screenshots')) db.createObjectStore('screenshots'); // v0.33.0 10-B
  if (!db.objectStoreNames.contains('feedbackQueue')) {
    db.createObjectStore('feedbackQueue', { keyPath: 'id', autoIncrement: true }); // v0.33.0 항목11
  }
}

/** 브라우저 주입용 소스 문자열 — `(0, eval)(\`(${src})\`)`로 복원한다. */
export const APPLY_APP_SCHEMA_SOURCE = applyAppSchema.toString();

/** 미러가 만드는 스토어 목록 — tests/idb-fixture.spec.ts의 드리프트 가드가 실제 앱이 만든 DB와
 *  대조한다(applyAppSchema에 스토어를 추가/삭제하면 여기도 함께). */
export const APP_STORE_NAMES = [
  'sessions', 'audioClips', 'logEvents', 'kv', 'screenshots', 'feedbackQueue',
] as const;
