/**
 * v0.50 [CLIP-SILENT-1] 오라클 — **무음 클립 연속 실패 → 래치·고지·결산**.
 *
 * ## 무엇을 재나
 * 2026-08-19 실기기 사고의 형상은 **「트랙은 살아 있는데(`readyState==='live'`) 클립만 계속
 * 비어 나온다」**였다. 종전 판정(`isStreamLost()` = `ended`만 사망)은 그 상태를 **영원히 no-op**
 * 으로 흘려보냈다 — 이원창 세션에서 60번, 양혁진 세션에서 9번.
 *
 * 🔑 **이 스펙의 픽스처가 곧 그 상태다.** `GUM_GRANT_SCRIPT`의 fake 트랙은 `readyState:'live'`인데
 * 진짜 MediaStream이 아니라 `MediaRecorder`가 던져 **클립이 항상 빈다**(fixtures/gum.ts 헤더).
 * 그래서 별도 무음 심을 만들지 않아도 사고와 같은 축이 재현된다 — 그리고 **종전 코드에서는
 * `mic_lost`가 절대 나지 않는다**(트랙이 `ended`가 아니므로). 처방을 빼면 ⓑ가 즉시 red다.
 *
 * ## 반증 축(무엇을 빼면 red인가)
 *  · 연속 카운터를 지우면 → ⓑ가 red(`mic_lost:*` 없음)
 *  · 임계를 1로 낮추면 → ⓐ가 red(1회에서 이미 래치)
 *  · 리셋을 `clip_saved`가 아니라 `clip_started`로 옮기면 → ⓒ가 red(카운터가 매번 0으로 밀려
 *    임계에 못 닿는다 — 양혁진 세션이 `clip_started` 123 vs `stop_await` 68이었던 그 축)
 *  · 고지 배선(`useClipFailureAlert`)을 빼면 → ⓑ의 `clip_fail_alert:*` 단언이 red
 *  · 결산 로깅을 빼면 → ⓓ가 red
 *
 * ## 🔴 안 재는 것 — 정직하게 적는다
 * **iOS 오디오 세션 탈취 자체는 Playwright로 만들 수 없다**(OS 레벨 사건 —
 * `v0460-audio-interruption-probe.spec.ts` 헤더가 같은 한계를 명시한다). 여기서 재는 것은
 * 「빈 클립이 계속 오면 우리가 그것을 잡아 알리는가」이지 「iOS가 언제 무음을 만드는가」가 아니다.
 * `BlackoutOverlay`(z-9999)를 실제로 걷어내는지는 `clip_fail_alert:blackout=` 계측으로만 잰다 —
 * 홀드 제스처 경유 blackout 진입은 v0470-w7 계보가 이미 잠근다.
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';
import { createClipHealth, clipSummaryExtra, CLIP_FAIL_LATCH_THRESHOLD } from '../src/lib/clipHealth';

test.setTimeout(120_000);

const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm3', name: '측정항목03', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'clip-silent' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02', '측정항목03'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '', '']];

/** clip/error/session 계열 로그의 `extra` — 「경로가 실제로 돌았는가」의 증명(r3-11과 같은 패턴). */
async function logExtras(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((r) => {
      const q = indexedDB.open('survey-011');
      q.onsuccess = () => r(q.result);
    });
    const rows: { type?: string; extra?: string }[] = await new Promise((r) => {
      const q = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      q.onsuccess = () => r(q.result as { type?: string; extra?: string }[]);
      q.onerror = () => r([]);
    });
    db.close();
    return rows
      .filter((e) => e.type === 'clip' || e.type === 'error' || e.type === 'session')
      .map((e) => String(e.extra ?? ''));
  });
}

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
}

test('[node] ⓪ clipHealth 계약 — 연속만 세고, 성공에서만 리셋한다', () => {
  // 임계가 2라는 사실 자체를 잠근다(문서·주석이 아니라 계약으로).
  expect(CLIP_FAIL_LATCH_THRESHOLD, '임계가 바뀌면 아래 경계 단언의 의미도 바뀐다').toBe(2);

  const h = createClipHealth();
  expect(h.recordFailure(), '1회는 래치가 아니다(단발 사고 오탐 방지)').toBe(false);
  expect(h.recordFailure(), '연속 2회는 래치다').toBe(true);

  // 🔴 리셋은 성공에서만. 성공이 끼면 연속이 끊긴다.
  const h2 = createClipHealth();
  expect(h2.recordFailure()).toBe(false);
  h2.recordSaved();
  expect(h2.recordFailure(), '성공 뒤 첫 실패가 다시 래치가 되면 오탐이다').toBe(false);
  expect(h2.recordFailure()).toBe(true);

  // 결산은 누적이다(연속과 별개) — 종료 화면 문구의 분모가 여기서 나온다.
  expect(h2.summary()).toEqual({ saved: 1, failed: 3 });
  expect(clipSummaryExtra(h2.summary())).toBe('clip_summary:saved=1,failed=3');

  // 세션 경계 리셋은 연속·누적을 **둘 다** 비운다(이전 세션이 새 세션을 임계로 밀면 안 된다).
  h2.reset();
  expect(h2.summary()).toEqual({ saved: 0, failed: 0 });
  expect(h2.recordFailure(), '리셋 후 첫 실패가 곧바로 래치면 카운터가 안 비워진 것이다').toBe(false);
});

test('ⓐ 빈 클립 1회로는 래치하지 않는다 — 경계의 아래쪽(ⓑ가 공허하지 않다는 대조군)', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);

  const evs = await logExtras(page);
  expect(evs.some((e) => e.startsWith('clip_empty') || e.startsWith('clip_too_small')),
    '전제: 이 픽스처에서 클립은 비어야 한다(이 스펙이 재는 상태가 아니면 아래가 공허하다)').toBe(true);
  expect(evs.filter((e) => e.startsWith('mic_lost')),
    '실패 1회에 래치했다 — 단발 사고에도 배너가 뜬다').toHaveLength(0);
});

test('ⓑ 빈 클립 연속 2회 → 트랙이 live여도 래치하고, 그 자리에서 고지한다', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);
  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);

  const evs = await logExtras(page);
  // 🔴 종전 판정(`isStreamLost()`)은 여기서 **false**다 — fake 트랙은 `readyState:'live'`다.
  //    그러니 이 단언은 새 경로가 아니면 절대 통과하지 않는다(반증 축).
  expect(evs.filter((e) => e.startsWith('mic_lost')).length,
    '연속 2회 빈 클립인데 래치가 안 걸렸다 — 2026-08-19가 그대로 재발하는 상태다').toBeGreaterThan(0);
  // 고지가 **실제로 나갔는가**. 로그가 없으면 「고지했는데 못 봤다」와 구분할 수 없다.
  expect(evs.filter((e) => e.startsWith('clip_fail_alert:')).length,
    '래치는 됐는데 고지 배선이 안 돌았다').toBe(1);
});

test('ⓒ 세션 종료 — 클립 결산을 남기고 종료 화면에 경고를 세운다', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);
  await fireStt(page, '22.2', 1500);
  await waitForTtsIdle(page);

  await page.locator('button[title="입력 종료"]').click();
  await page.locator('button[title="종료 확인"]').click();

  // 종료 화면 표면 — 값은 멀쩡하므로 **여기가 유일한 사후 통지**다.
  // 🔑 이걸 **먼저** 기다린다: stop()은 클립 flush·persist를 await하므로, 이 표면이 서야
  //    아래 로그도 IDB에 내려가 있다(순서를 뒤집으면 결산을 읽는 시점이 stop 완료보다 앞선다).
  await expect(page.locator('[data-testid="clip-warning"]'),
    '클립이 통째로 실패했는데 종료 화면이 조용하다').toBeVisible({ timeout: 15_000 });

  // 결산 1건 — `saved + failed`가 「값 커밋 시 클립을 정지 대기까지 보낸 횟수」다.
  const summary = (await logExtras(page)).filter((e) => e.startsWith('clip_summary:'));
  expect(summary, '세션 결산이 없다 — 실패 총량을 사후에 알 길이 없다').toHaveLength(1);
  expect(summary[0], '결산이 실패를 0으로 보고했다 — 카운터가 안 붙었다').not.toContain('failed=0');
});
