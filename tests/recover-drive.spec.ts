/**
 * v0.5.0 W8 e2e — "세션 복구" 2단계: Drive 로그 zip에서 세션+클립 복원.
 *
 * page.route로 Drive API 전체를 stub:
 *   폴더 검색(survey-011 → log) → zip 목록(최신순) → zip 바이너리(alt=media) 응답.
 * zip 바이너리는 실제 exportLogZip 구조(sessions.json + clips/)로 Node에서 JSZip으로 생성.
 *
 * 검증:
 *   1. 로그인 상태: 복원 → "Drive 로그에서 세션 N개(클립 M개) 복구" + 구버전 zip "제외" 집계
 *      + 데이터탭에 세션 카드 표시 + IDB round-trip(클립 키 그대로) + 클립 없는 재생 버튼 무해.
 *   2. 미로그인: Drive 호출 0회 + "설정탭 로그인 후 가능" 안내.
 *   3. 목록 조회 실패(서버 오류/오프라인 등): graceful 실패 메시지, 1단계 복구는 유지.
 *
 * dev 서버 수동 기동 필요([ENV-1/2]): npm run dev -- --port 5175 --strictPort
 */

import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

test.setTimeout(60_000);

const BASE = 'http://localhost:5175';

const DRIVE_SESSION = {
  id: 'drv-s1',
  date: '2026-06-09',
  label: 'Drive복구',
  columns: [
    { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
    { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
  ],
  rows: [
    { index: 1, values: { c6: '1', c8: '35.1' }, complete: true, audioClips: { c8: 'drv-s1:1:c8' } },
    // 행 2의 클립 포인터는 zip에 실물이 없음 → 복원 후 재생 버튼이 깨지지 않아야 한다 (엣지)
    { index: 2, values: { c6: '2', c8: '41.3' }, complete: true, audioClips: { c8: 'drv-s1:2:c8:raw' } },
  ],
  completedRows: 2,
  syncedRows: 0,
  startedAt: 1781000000000,
  finishedAt: 1781000600000,
};

async function buildSnapshotZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('device.json', '{}');
  zip.file('events.json', '[]');
  zip.file('sessions.json', JSON.stringify({ schema: 1, appVersion: '0.5.0', sessions: [DRIVE_SESSION] }));
  // 키 문자열 그대로 round-trip 검증용 — 행 1 클립만 실물 포함 (행 2 포인터는 의도적 누락)
  zip.file('clips/drv-s1:1:c8.wav', new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function buildLegacyZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('device.json', '{}');
  zip.file('events.json', '[]');
  zip.file('clips/old-s9:1:c8.webm', new Uint8Array([1, 2, 3]));
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Drive API 전체 stub. 반환된 배열에 수신한 요청 URL이 쌓인다. */
async function stubDriveApi(page: Page, opts: { listFails?: boolean } = {}): Promise<string[]> {
  const calls: string[] = [];
  const snapshotZip = await buildSnapshotZip();
  const legacyZip = await buildLegacyZip();

  await page.route('**://www.googleapis.com/**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    const u = new URL(url);

    if (u.pathname === '/drive/v3/files' && u.searchParams.has('q')) {
      const q = u.searchParams.get('q') ?? '';
      if (q.includes("name='survey-011'")) {
        await route.fulfill({ json: { files: [{ id: 'fld-app', createdTime: '2026-06-01T00:00:00Z' }] } });
        return;
      }
      if (q.includes("name='log'")) {
        await route.fulfill({ json: { files: [{ id: 'fld-log', createdTime: '2026-06-01T00:00:00Z' }] } });
        return;
      }
      if (q.includes("'fld-log' in parents")) {
        if (opts.listFails) {
          await route.fulfill({ status: 500, body: 'backend boom' });
          return;
        }
        await route.fulfill({
          json: {
            files: [
              { id: 'zip-new', name: 'growth-log_2026-06-09_2.zip', createdTime: '2026-06-09T10:00:00Z' },
              { id: 'zip-legacy', name: 'growth-log_2026-06-05_1.zip', createdTime: '2026-06-05T10:00:00Z' },
            ],
          },
        });
        return;
      }
      await route.fulfill({ json: { files: [] } });
      return;
    }
    if (u.pathname === '/drive/v3/files/zip-new' && u.searchParams.get('alt') === 'media') {
      await route.fulfill({ contentType: 'application/zip', body: snapshotZip });
      return;
    }
    if (u.pathname === '/drive/v3/files/zip-legacy' && u.searchParams.get('alt') === 'media') {
      await route.fulfill({ contentType: 'application/zip', body: legacyZip });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected drive call: ' + url });
  });
  return calls;
}

async function bootApp(page: Page, { signedIn }: { signedIn: boolean }) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate((withToken) => {
    localStorage.clear();
    indexedDB.deleteDatabase('survey-011');
    if (withToken) {
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'test-token',
        expires_at: Date.now() + 3600_000,
        email: 'tester@example.com',
      }));
    }
  }, signedIn);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-data"]').click();
  await page.waitForTimeout(300);
}

async function readIdb(page: Page, store: 'sessions' | 'audioClips') {
  return page.evaluate(async (st) => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011', 3);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return { keys: [] as string[], values: [] as unknown[] };
    return new Promise<{ keys: string[]; values: unknown[] }>((res) => {
      const tx = db.transaction(st, 'readonly');
      const os = tx.objectStore(st);
      const kReq = os.getAllKeys();
      const vReq = os.getAll();
      tx.oncomplete = () => res({ keys: kReq.result as string[], values: vReq.result as unknown[] });
      tx.onerror = () => res({ keys: [], values: [] });
    });
  }, store);
}

test('W8 — 로그인 상태: Drive zip에서 세션+클립 복원, 구버전 zip 제외 집계, 재생 버튼 무해', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (e) => pageErrors.push(e));
  await stubDriveApi(page);
  await bootApp(page, { signedIn: true });

  await page.locator('text=세션 복구').click();

  // 복구 결과 메시지 — 세션 1개/클립 1개(행 2 클립은 zip에 없음) + 구버전 1개 제외
  await expect(page.locator('text=Drive 로그에서 세션 1개(클립 1개) 복구')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('text=구버전 로그 1개 제외')).toBeVisible();

  // 데이터탭에 복원 세션 카드 표시 (재하이드레이션 완료)
  await expect(page.locator('text=2026-06-09').first()).toBeVisible();
  await expect(page.locator('text=Drive복구').first()).toBeVisible();

  // IDB round-trip: 세션 그대로 + 클립 키 문자열 그대로
  const sessions = await readIdb(page, 'sessions');
  expect((sessions.values as Array<{ id: string; completedRows: number }>).map((s) => s.id)).toEqual(['drv-s1']);
  expect((sessions.values[0] as { rows: unknown[] }).rows).toHaveLength(2);
  const clips = await readIdb(page, 'audioClips');
  expect(clips.keys).toEqual(['drv-s1:1:c8']);

  // 카드 펼쳐 재생 버튼 확인 — 행 2의 클립은 IDB에 없음 → 눌러도 깨지지 않아야 함
  await page.locator('text=2026-06-09').first().click();
  await page.waitForTimeout(400);
  const playButtons = page.locator('button[title="음성 재생"]');
  expect(await playButtons.count()).toBe(2); // 포인터 기준 2개 (실물은 1개)
  await playButtons.nth(1).click(); // 클립 없는 쪽
  await page.waitForTimeout(600);
  await playButtons.nth(0).click(); // 실물 있는 쪽 (가짜 WAV — onerror로 무해 종료)
  await page.waitForTimeout(600);
  expect(pageErrors).toEqual([]);
});

test('W8 — 미로그인: Drive 호출 0회 + 로그인 안내', async ({ page }) => {
  const calls = await stubDriveApi(page);
  await bootApp(page, { signedIn: false });

  await page.locator('text=세션 복구').click();
  await expect(page.locator('text=Drive 복구는 설정탭 로그인 후 가능합니다')).toBeVisible({ timeout: 10_000 });
  expect(calls.filter((c) => c.includes('/drive/'))).toEqual([]); // 평시/미로그인 네트워크 0
});

test('W8 — 목록 조회 실패(서버 오류): graceful 실패 메시지, 1단계 로컬 복구는 유지', async ({ page }) => {
  await stubDriveApi(page, { listFails: true });
  await bootApp(page, { signedIn: true });

  await page.locator('text=세션 복구').click();
  // 1단계 결과 + 2단계 실패 안내가 같은 메시지 줄에 공존
  await expect(page.locator('text=Drive 복구 실패')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('text=모두 불러왔습니다')).toBeVisible();
});
