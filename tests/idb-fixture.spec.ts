/**
 * [ENV-11] 가드 — 앱 DB 이름·버전 하드코딩 재유입 차단 (v0.35.1 Stage 1-5 신설, Node 러너).
 *
 * 규약(tests/fixtures/idb.ts가 SSOT):
 *  - 이미 부팅된 앱 DB에 시딩 → 버전 무지정 `indexedDB.open('survey-011')`.
 *  - 부팅 전 시딩(스키마 필요) → fixture의 IDB/APPLY_APP_SCHEMA_SOURCE를 evaluate 인자로 주입.
 *  ⇒ 어느 spec도 "리터럴 DB명 + 버전 인자" 형태의 open을 다시 하드코딩해선 안 된다.
 *    (하드코딩이 남으면 DB_VERSION bump 때 전수 grep 갱신이 되살아난다 — [ENV-11] 재발.)
 */

import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_NAME, APP_STORE_NAMES, APPLY_APP_SCHEMA_SOURCE } from './fixtures/idb';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:5175';

test('spec에 indexedDB.open 버전 하드코딩이 없다 (fixture 주입만 허용)', () => {
  const offenders: string[] = [];
  for (const f of readdirSync(TESTS_DIR)) {
    if (!f.endsWith('.spec.ts')) continue;
    const src = readFileSync(join(TESTS_DIR, f), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      // 문자열 리터럴 DB명 + 두 번째 인자 = 하드코딩(숫자 리터럴이든 로컬 상수든 — [ENV-11]
      // 재발 1회가 정확히 변수형이었다). 허용되는 버전 지정은 fixture 주입 식별자
      // (idb.version / dbVersion)를 인자로 받은 open(<식별자>.name/…, <버전식별자>)뿐이고,
      // 그 형태는 DB명이 리터럴이 아니라 이 정규식에 걸리지 않는다.
      if (/indexedDB\.open\(\s*['"`]survey-011['"`]\s*,/.test(line)) {
        offenders.push(`${f}:${i + 1}`);
      }
    });
  }
  expect(offenders, `버전 하드코딩 발견 — tests/fixtures/idb.ts를 쓰세요: ${offenders.join(', ')}`).toEqual([]);
});

// ─── [ENV-3] 드리프트 가드 (리뷰 라운드1 Flash Medium 반영) — 픽스처 미러 ↔ 실제 앱 스키마 대조 ───
// applyAppSchema는 src/lib/db.ts upgrade의 수동 사본이라, 앱이 스토어를 추가하고 픽스처 갱신을
// 누락하면 pre-boot 시딩 spec이 구스키마 DB 위에서 침묵 실패한다. 실제 앱을 부팅시켜 만들어진
// DB의 objectStoreNames를 픽스처의 APP_STORE_NAMES와 대조해 불일치를 테스트 실패로 표면화한다.
test('픽스처 스키마 미러가 실제 앱 DB와 일치한다 (스토어 + keyPath/autoIncrement/인덱스 signature 대조)', async ({ page }) => {
  // signature = 스토어별 {keyPath, autoIncrement, indexNames}. 이름만 비교하면 인덱스·키 옵션
  // 드리프트를 놓친다(리뷰 라운드2 Codex Medium) — 옵션까지 문자열로 접어 비교한다.
  const signatureOf = (dbName: string) =>
    new Promise<string[]>((resolve, reject) => {
      const open = indexedDB.open(dbName); // 버전 무지정 — 기존 DB 그대로
      open.onsuccess = () => {
        const db = open.result;
        const sig = Array.from(db.objectStoreNames).sort().map((name) => {
          const tx = db.transaction(name, 'readonly');
          const s = tx.objectStore(name);
          return `${name}|keyPath=${JSON.stringify(s.keyPath)}|autoInc=${s.autoIncrement}|idx=${Array.from(s.indexNames).sort().join(',')}`;
        });
        db.close();
        resolve(sig);
      };
      open.onerror = () => reject(open.error);
    });

  // ① 실제 앱이 만든 DB의 signature.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800); // 앱 부팅 → getDb() upgrade 완료 대기
  const appSig = await page.evaluate(signatureOf, DB_NAME);
  expect(appSig.map((s) => s.split('|')[0])).toEqual([...APP_STORE_NAMES].sort());

  // ② 픽스처 미러(applyAppSchema)가 빈 DB에 만든 signature — 앱과 완전 일치해야 한다.
  const fixtureSig = await page.evaluate(
    ({ schemaSrc }) =>
      new Promise<string[]>((resolve, reject) => {
        const applySchema = (0, eval)(`(${schemaSrc})`) as (db: IDBDatabase) => void;
        const name = '__fixture_schema_probe__';
        const del = indexedDB.deleteDatabase(name);
        del.onsuccess = del.onerror = () => {
          const open = indexedDB.open(name, 1);
          open.onupgradeneeded = () => applySchema(open.result);
          open.onsuccess = () => {
            const db = open.result;
            const sig = Array.from(db.objectStoreNames).sort().map((n) => {
              const tx = db.transaction(n, 'readonly');
              const s = tx.objectStore(n);
              return `${n}|keyPath=${JSON.stringify(s.keyPath)}|autoInc=${s.autoIncrement}|idx=${Array.from(s.indexNames).sort().join(',')}`;
            });
            db.close();
            indexedDB.deleteDatabase(name);
            resolve(sig);
          };
          open.onerror = () => reject(open.error);
        };
      }),
    { schemaSrc: APPLY_APP_SCHEMA_SOURCE },
  );
  expect(fixtureSig).toEqual(appSig);
});
