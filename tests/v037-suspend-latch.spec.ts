/**
 * v0.37.0 리뷰(3모델 공통: Codex High + Flash·Pro Critical, 민구 인가) — **suspend 소스 집합 래치** 회귀.
 *
 * 결함: `suspendRecognitionForUi`/`resumeRecognitionForUi`가 단일 boolean 래치를 공유해, 두 오버레이가
 *   겹치면(수동 입력 시트 + 개선요청 모달) 하나만 닫혀도 래치가 풀려 나머지 오버레이 뒤에서 STT가
 *   조기 재개됐다(발화 유실/오커밋 — 데이터무결성). 수정: 래치를 **소스 집합(reference-count)** 으로
 *   바꿔 **모든 소스가 해제될 때만** 실제 재개한다.
 *
 * 오라클(Codex가 지적한 negative test 공백을 메운다):
 *   A(중첩) 수동시트 + 개선요청 열고 → 개선요청만 닫음 → 수동시트 여전히 열림 + STT **여전히 suspend**
 *          (ui_resume 미발생·발화 미커밋). 그 뒤 수동시트까지 닫으면 → 재개(ui_resume + 발화 커밋).
 *   B(단일: 개선요청만) 열고 닫기 → 종전대로 정상 재개(회귀 없음).
 *   C(단일: 수동시트만) 열고 닫기 → 종전대로 정상 재개(회귀 없음).
 *
 * STT 목은 tests/fixtures/stt.ts SSOT 사용(Codex Medium #4 — 인라인 목 금지).
 * dev 서버 수동 기동 필요: npm run dev -- --port 5175 --strictPort
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt } from './fixtures/stt';

test.setTimeout(120_000);

const BASE = 'http://localhost:5175';
const STORE_KEY = 'survey-011-settings-v3';

const SETTINGS = {
  state: {
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_TEST_1/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_TEST_1', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true, totalRows: 3,
    ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'suspend-latch', noisyMode: false, preferredVoiceName: '',
  },
  version: 12,
};

async function loadLogEvents(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<Array<{ type: string; parsed?: string; extra?: string }>>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as Array<{ type: string; parsed?: string; extra?: string }>);
      req.onerror = () => res([]);
    });
  });
}

async function activeChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return chip?.dataset.colName ?? '';
  });
}

async function waitForActiveChip(page: Page, colName: string, timeout = 6000) {
  await page.waitForFunction(
    (name) => {
      const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
      return (chip?.dataset.colName ?? '').includes(String(name));
    },
    colName,
    { timeout },
  );
}

async function boot(page: Page) {
  await installVoiceMocks(page);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('survey-011');
    },
    { s: SETTINGS, storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await waitForActiveChip(page, '횡경');
}

// ─── A: 중첩(수동시트 + 개선요청) — 개선요청만 닫아도 재개 금지, 수동시트까지 닫아야 재개 ───────────
test('A(중첩) — 수동시트+개선요청 겹침: 개선요청만 닫으면 STT 여전히 suspend, 수동시트까지 닫아야 재개', async ({ page }) => {
  await boot(page);

  // 수동 입력 시트 열기(활성 칩 횡경) → suspend('manual_input').
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  const sheet = page.locator('[data-testid="manual-value-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 3000 });

  // 그 위에 개선요청 모달 열기(탭 인터셉트 — setTab 없음, 시트 유지) → suspend('feedback_modal') 중첩.
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });

  // 개선요청만 닫는다 → resume('feedback_modal'): 집합에 manual_input이 남아 **실제 재개 금지**.
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  await page.waitForTimeout(300);

  // ① 수동 시트는 여전히 열려 있다(개선요청은 오버레이일 뿐 시트를 닫지 않는다).
  await expect(sheet).toBeVisible();
  // ② STT는 여전히 suspend — 아직 ui_resume이 하나도 없다(집합이 안 비었으므로 실제 재개 로그 없음).
  const before = await loadLogEvents(page);
  expect(before.some((e) => e.parsed === 'ui_suspend' && e.extra === 'manual_input'), 'manual_input suspend 기록').toBe(true);
  expect(before.filter((e) => e.parsed === 'ui_resume').length, '개선요청만 닫혔을 뿐 실제 재개 없음(ui_resume 0)').toBe(0);
  // ③ 배경 발화도 커밋되지 않는다(인식기 정지 상태 — 유실 아닌 '차단'이 정상: 시트가 소유권을 가짐).
  await fireStt(page, '99.9', 400);
  expect(await activeChipName(page), '발화가 커밋되지 않아 활성 칩 불변').toContain('횡경');
  await expect(page.locator('[data-testid="column-chip"][data-col-name="횡경"]')).not.toContainText('99.9');

  // 이제 수동 시트까지 닫는다 → resume('manual_input'): 집합이 비어 **실제 재개**.
  await page.locator('[data-testid="manual-cancel"]').click();
  await expect(sheet).toHaveCount(0);
  await page.waitForTimeout(300);
  const after = await loadLogEvents(page);
  expect(after.some((e) => e.parsed === 'ui_resume'), '모든 소스 해제 → 실제 재개(ui_resume 발생)').toBe(true);

  // ④ 재개 증명: 이제 음성 발화가 정상 커밋돼 활성 칩이 전진한다(발화 유실 없음).
  await fireStt(page, '35.1', 500);
  await waitForActiveChip(page, '종경');
});

// ─── B: 단일 소스(개선요청만) — 회귀 없음 ──────────────────────────────────────────────────────
test('B(단일) — 개선요청만 열고 닫기: 종전대로 정상 재개(회귀 없음)', async ({ page }) => {
  await boot(page);
  await page.locator('[data-testid="tab-feedback"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-testid="feedback-cancel"]').click();
  await expect(page.locator('[data-testid="feedback-modal"]')).toHaveCount(0);
  await page.waitForTimeout(300);

  const ev = await loadLogEvents(page);
  expect(ev.some((e) => e.parsed === 'ui_suspend' && e.extra === 'feedback_modal')).toBe(true);
  expect(ev.some((e) => e.parsed === 'ui_resume' && e.extra === 'feedback_modal')).toBe(true);
  // 재개 증명: 발화 정상 커밋 → 활성 칩 전진.
  await fireStt(page, '12.3', 500);
  await waitForActiveChip(page, '종경');
});

// ─── C: 단일 소스(수동시트만) — 회귀 없음 ──────────────────────────────────────────────────────
test('C(단일) — 수동시트만 열고 닫기: 종전대로 정상 재개(회귀 없음)', async ({ page }) => {
  await boot(page);
  await page.locator('[data-testid="column-chip"][data-active="true"]').click();
  const sheet = page.locator('[data-testid="manual-value-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 3000 });
  await page.locator('[data-testid="manual-cancel"]').click();
  await expect(sheet).toHaveCount(0);
  await page.waitForTimeout(300);

  const ev = await loadLogEvents(page);
  expect(ev.some((e) => e.parsed === 'ui_suspend' && e.extra === 'manual_input')).toBe(true);
  expect(ev.some((e) => e.parsed === 'ui_resume' && e.extra === 'manual_input')).toBe(true);
  await fireStt(page, '21.0', 500);
  await waitForActiveChip(page, '종경');
});
