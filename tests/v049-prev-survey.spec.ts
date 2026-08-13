/**
 * v0.49.0 W3(FB-3) — 설정요약 팝업 「이전 조사」 행의 3상태 e2e.
 *
 * 민구 원문(08-13 프리뷰 실기기, 09:46): *"'설정요약' 팝업시 이전 조사일 정보도 표기 해줄 것.
 * 조사전 이전 조사일을 사용자가 알아야 할 경우가 있음."*
 *
 * 판정 규칙 자체(세션 고정 샘플키 · strictly-< · 키 조각 위치 대조)는 순수 함수 단위 테스트
 * (tests/pastValues.spec.ts)가 갖는다. 이 spec은 **화면까지 배선이 닿는지**만 본다:
 *   1. 인덱스 미로드(오프라인·미로그인) → 「미확인」  — 로딩이 팝업을 막지 않는다
 *   2. IDB 영속 폴백 + 세션 고정 키 일치 → 직전 조사일(ISO)
 *   3. IDB 영속 폴백 + 일치 0건(다른 농가) → 「기록 없음」
 *
 * 시딩 패턴은 past-index-fallback.spec.ts를 따른다 — 인덱스를 Node에서 buildPastIndex +
 * serializePastIndexEntry로 만들고 fp도 브라우저 loadContext()와 같은 규칙으로 합성해
 * IDB kv `__past_index__`에 주입한다(fp가 어긋나면 폴백이 조용히 무시된다).
 *
 * 🔴 미로그인으로만 돈다 — 신선 캐시(loadPastIndex fetch) 경로가 아니라 **폴백만** 쓰는 것이
 * 이 화면의 계약이다(팝업은 절대 fetch를 기다리지 않는다).
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다([ORCH-27])
 */
import { test, expect, type Page } from '@playwright/test';
import {
  buildPastIndex,
  resolveRoundCol,
  serializePastIndexEntry,
  type PersistedPastIndexRecord,
} from '../src/lib/pastValues';
import { effectiveSampleKey } from '../src/lib/columnFlags';
import type { Column } from '../src/types';
import { BASE } from './baseUrl';

const STORE_KEY = 'survey-011-settings-v3';
const SHEET_ID = 'SHEET_PREVSURVEY_1';
const PHONE_375 = { width: 375, height: 812 };

function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** 어제 — previousSurveyRound는 오늘 미만 strictly이므로 오늘로 두면 제외된다. */
const PREV_ROUND = localISO(new Date(Date.now() - 86_400_000));
const OLDER_ROUND = localISO(new Date(Date.now() - 8 * 86_400_000));

/**
 * 현 스키마 근사. 세션 고정 샘플키 = 농가명(fixed) + 라벨(단일선택 options).
 * 조사나무는 seq(행마다 순환)라 고정이 아니고, 조사일자는 회차 컬럼이라 제외된다.
 */
const COLUMNS = [
  { id: 'c1', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'c3', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c4', name: '라벨', type: 'options', input: 'auto', ttsAnnounce: false, auto: { kind: 'options', available: ['A', 'B'], selected: ['A'] }, sampleKey: true },
  { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const HEADERS = ['조사일자', '농가명', '라벨', '조사나무', '횡경'];
const SHEET_ROWS = [
  [OLDER_ROUND, '이원창', 'A', '1', '90.0'],
  [PREV_ROUND, '이원창', 'A', '1', '100.0'],
  [PREV_ROUND, '이원창', 'A', '2', '110.0'],
];

function settingsFor(farmName: string) {
  return {
    state: {
      googleConnected: false, // 미로그인 — 신선 캐시 경로를 배제하고 폴백만 남긴다
      userEmail: null,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
      sheetTab: 'Sheet1',
      columnsSheetId: SHEET_ID,
      columnsSheetTab: 'Sheet1',
      columns: COLUMNS.map((c) =>
        c.id === 'c3' ? { ...c, auto: { kind: 'fixed', value: farmName } } : c,
      ),
      tableGenerated: true,
      totalRows: 2,
      roundDateColId: null,
    },
    version: 12,
  };
}

/** 브라우저 loadContext()와 동일 규칙의 지문. 어긋나면 폴백이 조용히 무시된다.
 *  fp는 컬럼의 id·name·type·sampleKey만 본다 — 농가명 **값**이 달라도 지문은 같다(테스트 3의 전제). */
function computeFp(): string {
  return JSON.stringify([
    SHEET_ID,
    'Sheet1',
    null,
    (COLUMNS as unknown as Column[]).map((c) => [c.id, c.name.trim(), c.type, effectiveSampleKey(c)]),
  ]);
}

function buildRecord(headers: string[] = HEADERS): PersistedPastIndexRecord {
  const cols = COLUMNS as unknown as Column[];
  const index = buildPastIndex(headers, SHEET_ROWS, cols, resolveRoundCol(cols, null));
  return serializePastIndexEntry({ fp: computeFp(), builtAt: Date.now() - 2 * 3_600_000, index });
}

/** 설정 시드(+선택적 IDB 폴백 주입) → 설정탭 → 설정요약 팝업 오픈. */
async function openSummary(
  page: Page,
  opts: { farmName: string; withRecord: boolean; headers?: string[] },
): Promise<void> {
  await page.setViewportSize(PHONE_375);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ key, payload }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(payload));
    },
    { key: STORE_KEY, payload: settingsFor(opts.farmName) },
  );
  if (opts.withRecord) {
    await page.evaluate(async (rec) => {
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open('survey-011');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(rec, '__past_index__');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, buildRecord(opts.headers) as unknown as Record<string, unknown>);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600); // hydratePastIndexFallback(부팅 1회, async)
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="settings-summary-shortcut"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="settings-summary-modal"]')).toBeVisible({ timeout: 2000 });
}

test('W3-1 — 인덱스 미로드(미로그인·폴백 없음): 「이전 조사 · 미확인」, 팝업은 즉시 열린다', async ({ page }) => {
  await openSummary(page, { farmName: '이원창', withRecord: false });
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toContainText('이전 조사');
  await expect(modal).toContainText('미확인');
  await expect(modal).not.toContainText('기록 없음');
  console.log('✓ 인덱스 미로드 → 미확인(로딩 블로킹 없음)');
});

test('W3-2 — IDB 폴백 + 세션 고정 키 일치: 직전 조사일 표시', async ({ page }) => {
  await openSummary(page, { farmName: '이원창', withRecord: true });
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toContainText('이전 조사');
  // 어제 회차. 오늘 회차가 아닌 것(strictly <)과 8일 전이 아닌 것(최신) 둘 다 이 단언에 걸린다.
  await expect(modal).toContainText(PREV_ROUND);
  await expect(modal).not.toContainText(OLDER_ROUND);
  await expect(modal).not.toContainText('미확인');
  console.log(`✓ 폴백 인덱스 + 고정 키(농가명+라벨) 일치 → ${PREV_ROUND}`);
});

test('W3-3 — IDB 폴백 + 일치 기록 0건(다른 농가): 「이전 조사 · 기록 없음」', async ({ page }) => {
  // 시트에는 '이원창'만 있고 세션은 '없는농가' — 지문(fp)은 같아 폴백은 쓰이되 매칭이 0건이다.
  await openSummary(page, { farmName: '없는농가', withRecord: true });
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toContainText('이전 조사');
  await expect(modal).toContainText('기록 없음');
  await expect(modal).not.toContainText(PREV_ROUND);
  console.log('✓ 폴백 인덱스 + 고정 키 불일치 → 기록 없음(미확인과 구분된다)');
});

test("W3-4(r2 A5) — 인덱스는 있는데 **조회가 불가능**하면 「기록 없음」이 아니라 「미확인」이다", async ({ page }) => {
  // 🔴 codex F4 = 합집합 C6. 고정 키 컬럼의 시트 헤더가 개명되면(농가명 → 농가명(구)) 그 컬럼은
  //    인덱스에 매핑되지 않아 **어떤 과거 행과도 대조할 수 없다.** 종전엔 이 상태가 일치 0건과
  //    같은 null이라 화면이 「기록 없음」으로 단정했고, 사용자는 "과거 기록이 없구나"라는 틀린
  //    결론을 내린다 — 헤더를 되돌리기 전까지 영구 고정되는 거짓말이다.
  //    지문(fp)은 컬럼만 보므로 폴백 인덱스는 그대로 로드된다(= 이 단언은 공허하지 않다).
  const RENAMED = ['조사일자', '농가명(구)', '라벨', '조사나무', '횡경'];
  await openSummary(page, { farmName: '이원창', withRecord: true, headers: RENAMED });

  // ① 인덱스는 실제로 로드됐다(폴백 = stale = warn). 「미확인」이 미로드 때문이 아님을 고정한다.
  await expect(page.locator('[data-testid="conn-past"]')).toHaveAttribute('data-tone', 'warn');

  // ② 그런데도 「이전 조사」는 조회 불가 → 미확인.
  const modal = page.locator('[data-testid="settings-summary-modal"]');
  await expect(modal).toContainText('이전 조사');
  await expect(modal).toContainText('미확인');
  await expect(modal, '조회 불가를 「기록 없음」으로 단정하면 안 된다').not.toContainText('기록 없음');
  await expect(modal).not.toContainText(PREV_ROUND);
});
