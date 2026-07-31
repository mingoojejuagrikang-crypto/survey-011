/**
 * v0.43.0 #3 — **신뢰도 게이트보다 파싱이 먼저다.** (민구 확정, plan §2-5 확정안)
 *
 * 07-30 실기기: 민구가 `300`을 말했고 화면에도 `300`이 떴는데 앱이 "인식 실패"를 알렸다.
 * 근인은 저신뢰 거절 분기가 파서보다 **앞에** 있어서였다 — `300`(conf 0.097)이 파싱 가능한지
 * 앱은 **묻지도 않고** 버렸다. 다이얼로는 못 푼다: `190`(conf 0.021)을 살리려면 임계를 2%로
 * 내려야 하고 그건 게이트를 없애는 것과 같다.
 *
 * 🔑 판별자는 신뢰도가 아니라 **"파싱되는가"** 다. 같은 로그가 양방향으로 보여줬다 —
 * 고신뢰인데 쓰레기(`담백` 0.887 · `담배` 0.715), 저신뢰인데 정확(`300` 0.097 · `190` 0.021).
 * BT 마이크 환경에서 Web Speech의 confidence는 **신호 품질**을 재지 텍스트의 옳음을 재지 않는다.
 *
 * ⚠️ **양방향을 다 봐야 한다 — 게이트를 그냥 없앤 게 아니라는 증거다.**
 *   T1 `300`@0.097          → 커밋된다            (반전이 실제로 일어났다)
 *   T2 `상대`@0.119          → 여전히 저신뢰 거절   ← 🔴 **게이트 생존 축.** 이게 없으면
 *                                                 "게이트를 삭제한 것"과 구별되지 않는다
 *   T3 `담백`@0.887          → 여전히 파싱 실패     (파서 생존 축)
 *   T4 정상 커밋에는 계측 마커가 안 붙는다          (마커가 상시 켜진 게 아니다)
 *
 * 🔑 T2가 핵심이다. `담백`(0.887)만으로는 부족하다 — 임계 0.6보다 **위**라 게이트를 아예 안
 * 건드리므로, 게이트를 통째로 삭제해도 T3는 통과한다. 저신뢰 **그리고** 파싱 불가인 `상대`만이
 * 게이트가 살아 있는지 가른다.
 *
 * 계측(plan §2-5-b 4번): 저신뢰인데 파싱돼 통과한 커밋에 `low_conf_parsed:` 마커를 남긴다.
 * 다음 회차에 이 판단이 옳았는지(시트값과 어긋났는지) 가릴 유일한 모수다.
 *
 * STT/TTS 목은 tests/fixtures/stt.ts SSOT 사용. 서버는 webServer가 5177 자동 기동([ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'survey-011-settings-v3';

/** 기본 다이얼 0.6 → minConf 0.6. 아래 신뢰도들이 게이트 양쪽에 걸치도록 고른 값이다. */
const SETTINGS = {
  state: {
    googleConnected: false, userEmail: null, sheet: null,
    sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_V043/edit', sheetTab: 'Sheet1',
    columnsSheetId: 'SHEET_V043', columnsSheetTab: 'Sheet1',
    availableSheets: [], manualMode: false,
    columns: [
      { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 } },
      { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
    ],
    tableGenerated: true, totalRows: 2,
    ttsRate: 1.05, recognitionTolerance: 0.6,
    sessionLabelColId: null, sessionAutoLabel: 'v043-parse-first', noisyMode: false, preferredVoiceName: '',
  },
  version: 12,
};

type LogEv = { type?: string; parsed?: string; extra?: string; text?: string; confidence?: number };

async function loadLogEvents(page: Page): Promise<LogEv[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('survey-011');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db || !db.objectStoreNames.contains('logEvents')) return [];
    return new Promise<LogEv[]>((res) => {
      const tx = db.transaction('logEvents', 'readonly');
      const req = tx.objectStore('logEvents').getAll();
      req.onsuccess = () => res(req.result as LogEv[]);
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

// ─── T1: 저신뢰인데 파싱되는 숫자 → 커밋된다 (반전의 본체) ────────────────────────
test('T1 — `300`(conf 0.097): 저신뢰지만 파싱되므로 커밋된다 + low_conf_parsed 계측', async ({ page }) => {
  await boot(page);
  // 07-30 09:38:50 실기기 재현 — 민구가 실제로 말했고 화면에도 떴다가 앱이 버린 그 발화.
  await fireStt(page, '300', 800, 0.097);

  const events = await loadLogEvents(page);
  const commit = events.find((e) => e.type === 'value');
  expect(commit, '파싱되는 숫자는 신뢰도와 무관하게 커밋돼야 한다').toBeTruthy();
  expect(commit?.parsed).toBe('300');
  expect(commit?.confidence).toBe(0.097);

  // 게이트가 이 발화를 거절하지 않았다.
  expect(events.some((e) => e.type === 'stt_rejected_low_confidence')).toBe(false);
  // 커밋됐으므로 다음 필드로 전진한다(재질문 21초가 0초가 되는 축).
  await waitForActiveChip(page, '종경');

  // 🔴 계측 — 이 통과가 옳았는지 다음 회차에 가릴 모수. 신규 이벤트가 아니라 value에 실린다.
  expect(commit?.extra).toBe('low_conf_parsed:conf=0.097,minConf=0.6,tolerance=0.6,via=primary');
});

// ─── T2: 저신뢰 + 파싱 불가 → 게이트가 여전히 거절한다 (게이트 생존) ────────────────
test('T2 — `상대`(conf 0.119): 저신뢰이고 파싱도 안 되면 종전대로 거절된다', async ({ page }) => {
  await boot(page);
  // 07-30 09:38:55 실기기 — 이건 앱이 **옳게** 거절한 건이다. #3이 이 판단까지 지우면 안 된다.
  await fireStt(page, '상대', 800, 0.119);

  const events = await loadLogEvents(page);
  const rejected = events.find((e) => e.type === 'stt_rejected_low_confidence');
  expect(rejected, '게이트가 살아 있어야 한다 — 삭제한 것이 아니다').toBeTruthy();
  expect(rejected?.extra).toBe('tolerance:0.6,minConf:0.6');
  expect(events.some((e) => e.type === 'value'), '값이 커밋되면 안 된다').toBe(false);
  expect(await activeChipName(page), '거절됐으므로 같은 필드에 머문다').toContain('횡경');

  const cue = page.locator('[data-testid="reask-cue"]');
  await expect(cue).toBeVisible({ timeout: 2500 });
  expect(await cue.getAttribute('data-reason')).toBe('low_confidence');
});

// ─── T3: 고신뢰 + 파싱 불가 → 여전히 파싱 실패 (파서 생존) ──────────────────────
test('T3 — `담백`(conf 0.887): 고신뢰여도 파싱 안 되면 종전대로 파싱 실패다', async ({ page }) => {
  await boot(page);
  // 07-30 09:39:06 실기기 — "STT는 자신 있게 틀린다"의 실물. confidence가 옳음을 재지 않는 증거.
  await fireStt(page, '담백', 800, 0.887);

  const events = await loadLogEvents(page);
  expect(events.some((e) => e.type === 'stt_parse_failed')).toBe(true);
  expect(events.some((e) => e.type === 'stt_rejected_low_confidence'), '신뢰도 문제가 아니다').toBe(false);
  expect(events.some((e) => e.type === 'value')).toBe(false);
  expect(await activeChipName(page)).toContain('횡경');
});

// ─── T4: 정상 커밋에는 계측 마커가 붙지 않는다 ──────────────────────────────────
test('T4 — 고신뢰 정상 커밋에는 low_conf_parsed 마커가 없다(마커가 상시 켜진 게 아니다)', async ({ page }) => {
  await boot(page);
  await fireStt(page, '35.1', 800, 0.95);

  const events = await loadLogEvents(page);
  const commit = events.find((e) => e.type === 'value');
  expect(commit?.parsed).toBe('35.1');
  expect(commit?.extra ?? null).toBeNull();
  expect(events.some((e) => typeof e.extra === 'string' && e.extra.startsWith('low_conf_parsed:'))).toBe(false);
});
