/**
 * v0.45.0 WP-1 계측 발화 배선 — 바이트 계약은 tests/logEvents.spec.ts가, **발화 여부**는 여기가 잰다
 * (v0440-instrumentation.spec.ts 계보).
 *
 *   ① ready_probe — ready 화면 마운트에서 1건 + 스로틀(연속 재마운트 무증가). F15 근원 판정 축.
 *   ② font_render_echo — 첫 확정(에코) 플래시에서 세션당 정확히 1건. C3(확정값 잘림) 판정 축.
 *   ③ session start meta.bargeInEnabled — D1 토글 스냅샷(축 C 판정 전제).
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, waitForTtsIdle } from './fixtures/stt';
import { GUM_GRANT_SCRIPT } from './fixtures/gum';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'survey-011-settings-v3';

const SETTINGS = {
  state: {
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_INSTR45_1/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_INSTR45_1', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true, totalRows: 3,
    ttsRate: 1.05, sessionLabelColId: null, sessionAutoLabel: 'instr45', noisyMode: false, preferredVoiceName: '',
  },
  version: 12,
};

interface LoggedEvent { type: string; parsed?: string; extra?: string; meta?: Record<string, unknown> }

async function loadLogEvents(page: Page): Promise<LoggedEvent[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => res([]);
    });
  });
}

async function readyProbes(page: Page): Promise<string[]> {
  return (await loadLogEvents(page))
    .filter((e) => e.extra?.startsWith('ready_probe:'))
    .map((e) => e.extra ?? '');
}

async function bootIdle(page: Page) {
  await page.addInitScript({ content: GUM_GRANT_SCRIPT });
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
  await page.waitForTimeout(300);
}

async function startSession(page: Page) {
  await page.evaluate(() => { (window as unknown as { __micSettleSkipForTest?: boolean }).__micSettleSkipForTest = true; });
  await page.locator('text=음성 입력 시작').first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 3000 });
  await waitForTtsIdle(page);
}

// ─── ① ready_probe — 마운트 1건 + 스로틀 ─────────────────────────────────────────────
test('① ready_probe — ready 화면에서 1건 발화, 연속 탭 왕복은 스로틀로 무증가', async ({ page }) => {
  await bootIdle(page);

  await expect.poll(() => readyProbes(page), { timeout: 4000 }).toHaveLength(1);
  const probe = (await readyProbes(page))[0];
  // 값 자체는 환경 의존(목 TTS·헤드리스 장치) — 형태와 stt 축만 고정한다.
  expect(probe).toMatch(/^ready_probe:stt=(yes|no),synth=(none|idle|speaking|paused),voicesKo=\d+,mics=(\d+|unknown),perm=(granted|denied|prompt|unknown)$/);

  // 탭 왕복(ReadyState 재마운트) — 10초 스로틀 안이라 늘지 않는다(링버퍼 보호, [F5] 계보).
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(500);
  expect(await readyProbes(page)).toHaveLength(1);
});

// ─── ② font_render_echo — 첫 확정 플래시에서 세션당 1건 ───────────────────────────────
test('② font_render_echo — 첫 커밋 에코에서 1건, 두 번째 커밋에는 늘지 않는다(세션당 1회)', async ({ page }) => {
  await bootIdle(page);
  await startSession(page);

  await fireStt(page, '33.3', 800);
  // 에코 정착 지연(300ms)+rAF 뒤 방출 — 플래시 창(1.5s) 안에서 hero 실렌더를 읽는다.
  await expect.poll(async () =>
    (await loadLogEvents(page)).filter((e) => e.extra?.startsWith('font_render_echo:')).length,
  { timeout: 5000 }).toBe(1);
  const echo = (await loadLogEvents(page)).find((e) => e.extra?.startsWith('font_render_echo:'))!;
  // 🔴 v0.46.0 정당 파손 (2026-08-07) — `c401a30`(08-07 16:00)이 **확정값 넘침 계측**을 넣어
  //    필드가 3개 → 6개가 됐다(`ovX`·`ovY`·`len`). 종전 정규식은 `h=\d+$`로 **끝을 못박고
  //    있어** 새 필드가 붙는 순간 red가 됐다.
  //    🔴🔴 **그 red는 08-07 하루 종일 아무에게도 안 보였다** — 이 파일이 `test:e2e:gate`
  //    목록 **밖**이라 회차 내내 한 번도 안 돌았고, 08-07 밤 전량 스위트에서야 드러났다.
  //    같은 날 `v043-typo-contract`가 **똑같은 기전**으로 red였다(게이트 밖 + 새벽 커밋).
  //    👉 계측 포맷을 늘릴 때 **그 포맷을 단언하는 오라클이 게이트 안에 있는지** 먼저 봐라.
  //    ⚠️ 필드를 늘리면 여기도 함께 늘려라. `$`를 떼서 느슨하게 만들지 마라 —
  //    **끝을 못박는 것이 「형식이 조용히 바뀌는 것」을 잡는 이 단언의 존재 이유다.**
  expect(echo.extra).toMatch(
    /^font_render_echo:hero=\d+(\.\d)?,w=\d+,h=\d+,ovX=-?\d+,ovY=-?\d+,len=\d+$/,
  );
  // 실렌더값이 0이면 요소를 못 읽은 것이다 — 프로브 폴백 금지 계약의 실효 확인.
  expect(Number(/hero=([\d.]+)/.exec(echo.extra ?? '')?.[1])).toBeGreaterThan(0);
  // 🔑 신규 3필드가 **실제로 측정된 값인지** 본다. 형식만 맞고 값이 안 채워지면
  //    민구 제보(`33…` 잘림)를 판정하려고 넣은 계측이 로그만 늘리는 꼴이 된다.
  //    `len`은 표시 문자열 길이이므로 확정값 `33.3`에서 **반드시 4**다 — 0이면 요소를 못 읽었다.
  expect(Number(/len=(\d+)/.exec(echo.extra ?? '')?.[1])).toBe(4);

  // 두 번째 커밋 — 가드(세션당 1회)로 늘지 않는다.
  await waitForTtsIdle(page);
  await fireStt(page, '21.1', 800);
  await page.waitForTimeout(900);
  expect((await loadLogEvents(page)).filter((e) => e.extra?.startsWith('font_render_echo:'))).toHaveLength(1);
});

// ─── ③ session meta — bargeInEnabled 스냅샷 ────────────────────────────────────────
test('③ 세션 시작 메타에 bargeInEnabled(D1 토글)가 박힌다', async ({ page }) => {
  await bootIdle(page);
  await startSession(page);

  const start = (await loadLogEvents(page)).find((e) => e.type === 'session' && e.extra === 'start');
  expect(start, '세션 시작 메타 이벤트가 있어야 한다').toBeTruthy();
  // 기본값 ON(스토어 기본 true — Q9 민구 확정: 기본적으로 barge-in 켠다).
  expect(start?.meta?.bargeInEnabled).toBe(true);
});
