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

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));

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
