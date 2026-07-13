/**
 * v0.33.0 항목11 — 개선요청 탭 e2e.
 *
 * 검증:
 *   1. 탭 인터셉트: '개선요청' 탭 클릭 시 화면 전환 없이(현재 탭 유지) 캡처 → 모달.
 *      취소로 닫아도 화면 그대로. tab:<from>->feedback 전환 이벤트가 없고 feedback_open만 남는다.
 *   2. 제출(로그인+온라인, Drive 전부 목): 사용자 Drive 레그 업로드 발생 + 모달 닫힘 +
 *      feedback_uploaded:user=ok,admin=skip(관리자 폴더 env 미설정) 텔레메트리.
 *   3. 경량 zip 내용물: 업로드된 multipart에서 zip을 추출·파싱 — feedback.json(텍스트/컨텍스트),
 *      events.json, sessions.json 포함 / clips/·screens/ **제외**(민구 확정 — 시딩한 클립이
 *      IDB에 있어도 zip에 없음), screenshot.jpg는 feedback.json.hasScreenshot과 자기일관.
 *   4. 큐: 미로그인 제출 → feedbackQueue 저장(feedback_queued:not_signed_in) → 토큰 주입 후
 *      reload(부팅 flush) → 큐 소진 + 업로드 발생(feedback_flush:uploaded).
 *   5. DB v6 마이그레이션: 부팅 후 DB version=6 + feedbackQueue 스토어 존재(기존 스토어 보존).
 *
 * Drive 호출은 전부 route 목 — 클라우드 실쓰기 0. dev 서버 수동 기동([ENV-1/2]).
 */
import { test, expect, type Page } from '@playwright/test';
import JSZip from 'jszip';

test.setTimeout(120_000);

const BASE = 'http://localhost:5175';

interface DriveStub {
  uploads: { filename: string; zip: Buffer }[];
  folderCreates: string[];
}

/** Drive API 전체 목: 폴더 검색(빈 결과) → 생성(고정 id) → multipart 업로드(zip 캡처). */
async function stubDrive(page: Page): Promise<DriveStub> {
  const stub: DriveStub = { uploads: [], folderCreates: [] };
  await page.route('**://www.googleapis.com/upload/drive/v3/files**', async (route) => {
    const buf = route.request().postDataBuffer();
    if (buf) {
      const text = buf.toString('latin1');
      const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
      stub.uploads.push({ filename: nameMatch?.[1] ?? '?', zip: extractZipFromMultipart(buf) });
    }
    await route.fulfill({ json: { id: `file-${stub.uploads.length}` } });
  });
  await page.route('**://www.googleapis.com/drive/v3/files**', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { files: [] } }); // 검색 — 항상 미존재(생성 경로 유도)
      return;
    }
    const body = route.request().postDataJSON() as { name?: string } | null;
    stub.folderCreates.push(body?.name ?? '?');
    await route.fulfill({ json: { id: `fold-${stub.folderCreates.length}` } });
  });
  return stub;
}

/** multipart/form-data 본문에서 zip 바이트를 추출(PK 시그니처 시작 ~ 마지막 boundary 직전). */
function extractZipFromMultipart(buf: Buffer): Buffer {
  const start = buf.indexOf(Buffer.from('PK', 'latin1'));
  const tail = buf.lastIndexOf(Buffer.from('\r\n--', 'latin1'));
  if (start < 0) return Buffer.alloc(0);
  return buf.subarray(start, tail > start ? tail : buf.length);
}

async function boot(page: Page, opts: { withToken: boolean } = { withToken: true }) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (withToken) => {
    localStorage.clear();
    if (withToken) {
      localStorage.setItem('gs10_google_token', JSON.stringify({
        access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
      }));
    }
    // zip 제외 검증용 시딩: 클립 1개 + 자동캡처 1장 — 경량 zip엔 절대 담기면 안 된다.
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['audioClips', 'screenshots'], 'readwrite');
      tx.objectStore('audioClips').put({ buf: new ArrayBuffer(64), type: 'audio/wav' }, 'sess_x:1:c8');
      tx.objectStore('screenshots').put({ buf: new ArrayBuffer(64), type: 'image/jpeg' }, 'sess_x:1:commit');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, opts.withToken);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

async function getEventExtras(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction('logEvents', 'readonly');
    const all: Array<{ extra?: string }> = await new Promise((resolve, reject) => {
      const rq = tx.objectStore('logEvents').getAll();
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
    db.close();
    return all.map((e) => e.extra).filter((x): x is string => typeof x === 'string');
  });
}

async function getFeedbackQueue(page: Page): Promise<Array<{ filename: string; pendingUser: boolean; pendingAdmin: boolean }>> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if (!db.objectStoreNames.contains('feedbackQueue')) { db.close(); return []; }
    const tx = db.transaction('feedbackQueue', 'readonly');
    const all: Array<{ filename: string; pendingUser: boolean; pendingAdmin: boolean }> =
      await new Promise((resolve, reject) => {
        const rq = tx.objectStore('feedbackQueue').getAll();
        rq.onsuccess = () => resolve(rq.result);
        rq.onerror = () => reject(rq.error);
      });
    db.close();
    return all.map((x) => ({ filename: x.filename, pendingUser: x.pendingUser, pendingAdmin: x.pendingAdmin }));
  });
}

/** 개선요청 탭 클릭 → (캡처 후) 모달 대기. html2canvas 첫 dynamic import 시간 여유. */
async function openFeedbackModal(page: Page) {
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
}

// ─── Tests ──────────────────────────────────────────────────────

test('탭 인터셉트 — 화면 전환 없이 모달, 취소 후에도 현재 화면 유지 + feedback_open 계측', async ({ page }) => {
  await stubDrive(page);
  await boot(page);

  // 설정탭이 보이는 상태에서 개선요청 탭 클릭.
  await expect(page.locator('[data-testid="connection-status-card"]')).toBeVisible();
  await openFeedbackModal(page);

  // 화면 전환 없음 — 설정탭 콘텐츠가 모달 뒤에 그대로 마운트되어 있다.
  await expect(page.locator('[data-testid="connection-status-card"]')).toBeVisible();
  // 썸네일(캡처 성공) 또는 실패 안내 중 하나는 반드시 존재(캡처는 best-effort).
  const thumb = page.locator('[data-testid="feedback-thumbnail"], [data-testid="feedback-thumbnail-missing"]');
  await expect(thumb.first()).toBeVisible();
  // 텍스트가 비면 보내기 비활성.
  await expect(page.locator('[data-testid="feedback-send"]')).toBeDisabled();

  // 취소 → 모달만 닫히고 화면은 여전히 설정탭.
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeHidden();
  await expect(page.locator('[data-testid="connection-status-card"]')).toBeVisible();

  const extras = await getEventExtras(page);
  expect(extras.some((x) => x === 'feedback_open:tab=settings')).toBe(true);
  // setTab이 일어나지 않았으므로 탭 전환 계측(tab:settings->feedback)은 없어야 한다.
  expect(extras.some((x) => x.includes('->feedback'))).toBe(false);
});

test('제출(로그인+온라인) — 사용자 Drive 레그 업로드 + 경량 zip 내용물(클립·자동캡처 제외) + 텔레메트리', async ({ page }) => {
  const stub = await stubDrive(page);
  await boot(page);
  await openFeedbackModal(page);

  await page.locator('[data-testid="feedback-text"]').fill('알람 소리가 너무 작아요');
  await page.locator('[data-testid="feedback-send"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeHidden({ timeout: 15_000 });

  // 업로드 1건(사용자 레그) — 관리자 폴더 env 미설정이라 admin은 skip. 폴더는 survey-011/feedback 생성.
  await expect.poll(() => stub.uploads.length).toBe(1);
  expect(stub.uploads[0].filename).toMatch(/^feedback_\d{4}-\d{2}-\d{2}_\d+\.zip$/);
  expect(stub.folderCreates).toEqual(['survey-011', 'feedback']);

  // zip 내용물 — 경량 계약(민구 확정): feedback.json + events.json + sessions.json (+ screenshot.jpg
  // 자기일관). clips/·screens/ 절대 없음(부팅 시딩된 클립·자동캡처가 IDB에 실존하는데도).
  const zip = await JSZip.loadAsync(stub.uploads[0].zip);
  const names = Object.keys(zip.files);
  expect(names).toContain('feedback.json');
  expect(names).toContain('events.json');
  expect(names).toContain('sessions.json');
  expect(names.some((n) => n.startsWith('clips/'))).toBe(false);
  expect(names.some((n) => n.startsWith('screens/'))).toBe(false);

  const fb = JSON.parse(await zip.files['feedback.json'].async('string')) as {
    text: string; hasScreenshot: boolean; context: { tab: string; sessionPhase: string }; userEmail: string | null;
  };
  expect(fb.text).toBe('알람 소리가 너무 작아요');
  expect(fb.context.tab).toBe('settings');
  expect(fb.context.sessionPhase).toBe('ready');
  expect(fb.userEmail).toBe('tester@example.com');
  expect(names.includes('screenshot.jpg')).toBe(fb.hasScreenshot); // 자기일관(캡처는 best-effort)

  // events.json이 진짜 경량 로그를 담는다(부팅 계측 최소 1건 이상).
  const events = JSON.parse(await zip.files['events.json'].async('string')) as unknown[];
  expect(events.length).toBeGreaterThan(0);

  const extras = await getEventExtras(page);
  expect(extras.some((x) => x.startsWith(`feedback_submit:len=${'알람 소리가 너무 작아요'.length},shot=`))).toBe(true);
  expect(extras.some((x) => x.startsWith('feedback_uploaded:user=ok,admin=skip'))).toBe(true);
});

test('미로그인 제출 → feedbackQueue 저장 → 토큰 복귀(reload) 시 자동 재전송·큐 소진', async ({ page }) => {
  const stub = await stubDrive(page);
  await boot(page, { withToken: false });
  await openFeedbackModal(page);

  await page.locator('[data-testid="feedback-text"]').fill('오프라인에서도 보내지나요');
  await page.locator('[data-testid="feedback-send"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeHidden({ timeout: 15_000 });

  // 업로드 시도 없이 큐에 저장(사용자 레그 대기, admin은 env 미설정이라 레그 자체 없음).
  expect(stub.uploads.length).toBe(0);
  await expect.poll(async () => (await getFeedbackQueue(page)).length).toBe(1);
  const q = await getFeedbackQueue(page);
  expect(q[0].filename).toMatch(/^feedback_/);
  expect(q[0].pendingUser).toBe(true);
  expect(q[0].pendingAdmin).toBe(false);
  const extras1 = await getEventExtras(page);
  expect(extras1.some((x) => x === 'feedback_queued:not_signed_in')).toBe(true);

  // 토큰 주입 후 reload — 부팅 flush(initFeedbackQueueFlush)가 큐를 자동 재전송한다.
  await page.evaluate(() => {
    localStorage.setItem('gs10_google_token', JSON.stringify({
      access_token: 'test-token', expires_at: Date.now() + 3600_000, email: 'tester@example.com',
    }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(async () => (await getFeedbackQueue(page)).length, { timeout: 10_000 }).toBe(0);
  await expect.poll(() => stub.uploads.length).toBe(1);
  expect(stub.uploads[0].filename).toMatch(/^feedback_/);
  const extras2 = await getEventExtras(page);
  expect(extras2.some((x) => x.startsWith('feedback_flush:uploaded:feedback_'))).toBe(true);
});

test('DB v6 마이그레이션 — feedbackQueue 스토어 신설 + 기존 스토어 보존', async ({ page }) => {
  await boot(page);
  const info = await page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const out = { version: db.version, stores: [...db.objectStoreNames].sort() };
    db.close();
    return out;
  });
  expect(info.version).toBe(6);
  expect(info.stores).toEqual(
    ['audioClips', 'feedbackQueue', 'kv', 'logEvents', 'screenshots', 'sessions'].sort(),
  );
});
