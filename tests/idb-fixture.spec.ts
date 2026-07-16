/**
 * [ENV-11] 가드 — 앱 DB 이름·버전 하드코딩 재유입 차단 (v0.35.1 Stage 1-5 신설, Node 러너).
 *
 * 규약(tests/fixtures/idb.ts가 SSOT):
 *  - 이미 부팅된 앱 DB에 시딩 → 버전 무지정 `indexedDB.open('survey-011')`.
 *  - 부팅 전 시딩(스키마 필요) → fixture의 IDB/APPLY_APP_SCHEMA_SOURCE를 evaluate 인자로 주입.
 *  ⇒ 어느 spec도 `indexedDB.open('survey-011', <숫자>)`를 다시 하드코딩해선 안 된다.
 *    (하드코딩이 남으면 DB_VERSION bump 때 전수 grep 갱신이 되살아난다 — [ENV-11] 재발.)
 */

import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_NAME, APP_STORE_NAMES } from './fixtures/idb';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:5175';

test('spec에 indexedDB.open 버전 하드코딩이 없다 (fixture 주입만 허용)', () => {
  const offenders: string[] = [];
  for (const f of readdirSync(TESTS_DIR)) {
    if (!f.endsWith('.spec.ts')) continue;
    const src = readFileSync(join(TESTS_DIR, f), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      // 문자열 리터럴 DB명 + 버전 숫자 리터럴 조합 = 하드코딩. (버전 무지정 open과
      // fixture 인자(idb.name, idb.version / dbName, dbVersion) 경유는 매치되지 않는다.)
      if (/indexedDB\.open\(\s*['"`]survey-011['"`]\s*,\s*\d/.test(line)) {
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
test('픽스처 스키마 미러가 실제 앱 DB와 일치한다 (스토어 목록 대조)', async ({ page }) => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800); // 앱 부팅 → getDb() upgrade 완료 대기
  const actual = await page.evaluate(
    (dbName) =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open(dbName); // 버전 무지정 — 기존 DB 그대로
        open.onsuccess = () => {
          const names = Array.from(open.result.objectStoreNames);
          open.result.close();
          resolve(names.sort());
        };
        open.onerror = () => reject(open.error);
      }),
    DB_NAME,
  );
  expect(actual).toEqual([...APP_STORE_NAMES].sort());
});
