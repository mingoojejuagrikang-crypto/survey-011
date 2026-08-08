/**
 * v0.47.0 W7 오라클 — **히어로 3초 홀드 진입 · 중앙 탭 해제.** (민구 지시 08-08)
 *
 * > *"화면 중앙 히어로 영역을 사용자가 터치하면 안내음성/문구+진행바와 함께 3초 유지하면
 * >  화면 끔. 화면 꺼진 상태에서 중앙 영역 잠깐이라도 터치하면 화면 켬으로 하자."*
 *
 * `v0460-cr-blackout-escape.spec.ts`는 **갇힘 방지**(탈출 경로가 살아 있는가)를 계속 진다.
 * 이 파일은 **새로 생긴 두 계약**을 진다: 진입 제스처와, 해제의 위치 조건.
 *
 * ## 재는 축
 *  ① 히어로 3초 홀드 → 진입한다. 홀드 중 **문구+진행바**가 뜬다(민구가 명시한 피드백).
 *  ② 🔴 **3초 미만에 떼면 진입하지 않는다.** 오터치 방어가 이 기능의 전제다 — 현장에서
 *     화면이 제멋대로 꺼지면 값이 날아간 것처럼 보인다.
 *  ③ 🔴 **가장자리 탭은 해제하지 않는다.** 08-05에 「두 번 탭」을 기각시킨 근거(*"주머니에서도
 *     두 번 눌린다 — 옷 스침은 연속 접촉"*)가 08-08 확정에서는 **위치 조건**으로 이전됐다.
 *     이 단언이 그 이전의 실체다. 여기가 죽으면 절전 기능이 주머니에서 스스로 켜진다.
 *  ④ 계측이 진입 경로를 가른다(`src:hold` vs 기존 `src:voice`). 두 경로의 사용 비율은
 *     다음 회차의 UI 판단 근거다 — 안 남기면 또 추론이 된다.
 *
 * ## 🔴 안 재는 축
 *  - **갇힘 방지 전반**(키보드 탈출·해제 후 음성 생존) → `v0460-cr-blackout-escape.spec.ts`.
 *  - **iOS `pointercancel`** — Playwright/Chromium은 iOS의 스크롤 전환을 재현하지 않는다.
 *    방어(`touchAction:'none'`)는 코드에 있으나 **기계로 확인되지 않았다**(「미확인」).
 *  - **홀드 중 안내 TTS가 STT에 에코로 들어가는가** — `speech.ts`의 half-duplex 래치가 지는
 *    계약이고 이 파일은 그걸 다시 재지 않는다(그쪽 스코프).
 */
import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402 } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** 제품 상수 `HOLD_TO_BLACKOUT_MS`와 같아야 한다. 🔴 **import하지 않는 건 의도다**
 *  (`v0460-g-dot-pill`과 같은 계약): 제품이 값을 바꾸면 계약은 여기 남아 오라클이 신호를 낸다. */
const HOLD_MS = 3000;

const overlay = (page: Page) => page.locator('[data-testid="blackout-overlay"]');
const heroSurface = (page: Page) => page.locator('[data-testid="hero-hold-surface"]');

/** 히어로 표면 중앙을 `ms` 동안 누른다. */
async function holdHero(page: Page, ms: number) {
  const box = await heroSurface(page).boundingBox();
  if (!box) throw new Error('hero-hold-surface 박스를 얻지 못했다 — hero 분기 미도달(무판정)');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

interface LoggedEvent { type: string; parsed?: string; extra?: string }

async function screenOffLogs(page: Page): Promise<LoggedEvent[]> {
  const all = await page.evaluate(async () => {
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
    }) as Promise<LoggedEvent[]>;
  });
  return all.filter((e) => e.parsed === 'screen_off');
}

test('① 히어로 3초 홀드로 진입한다 + 홀드 중 문구·진행바가 뜬다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await expect(overlay(page), '전제: 시작은 검은 화면이 아니다').toHaveCount(0);

  const box = await heroSurface(page).boundingBox();
  if (!box) throw new Error('hero-hold-surface 미존재 — 무판정');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  // 민구가 명시한 피드백 — *"안내음성/문구+진행바와 함께"*. 진행바가 없으면 사용자는
  //   3초가 얼마나 남았는지 모른 채 손가락을 떼고 "안 된다"고 판단한다.
  await expect(page.locator('[data-testid="hero-hold-cue"]'), '홀드 중 안내 문구').toBeVisible({ timeout: 1500 });
  const fill = page.locator('[data-testid="hero-hold-fill"]');
  await expect(fill).toBeVisible();
  const mid = Number(await fill.getAttribute('data-progress'));
  expect(mid, '진행바가 실제로 차오른다(0 고정이면 rAF가 안 돈다)').toBeGreaterThan(0);
  expect(mid, '아직 3초가 안 됐으므로 1 미만').toBeLessThan(1);

  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
  await expect(
    overlay(page),
    '3초를 유지했는데 화면이 안 꺼진다 — 진입 경로가 음성 하나로 돌아간 것이다',
  ).toBeVisible({ timeout: 3000 });
});

test('② 🔴 3초 미만에서 떼면 진입하지 않는다 (오터치 방어가 전제다)', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  await holdHero(page, Math.floor(HOLD_MS * 0.4));
  await page.waitForTimeout(HOLD_MS); // 남은 시간이 흘러도 진입하면 안 된다(타이머 잔존 확인)
  await expect(
    overlay(page),
    '중도 이탈로 화면이 꺼진다 — 현장에서 값이 날아간 것처럼 보인다',
  ).toHaveCount(0);
  // 취소는 무동작이지 「나중에 발화」가 아니다 — 계측에도 안 남아야 한다.
  expect(await screenOffLogs(page), '취소된 홀드가 screen_off를 남기면 안 된다').toHaveLength(0);
});

test('③ 🔴 검은 화면 — 중앙 탭은 켜고, 가장자리 탭은 무시한다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);
  await fireStt(page, '화면', 600);
  await expect(overlay(page)).toBeVisible({ timeout: 4000 });

  // 가장자리 — 히트존(가로 60%×세로 50% 중앙)의 밖. 402×874에서 좌우 여백 각 80px.
  await page.mouse.click(12, 12);
  await page.waitForTimeout(300);
  await expect(
    overlay(page),
    '가장자리 탭으로 풀린다 — 주머니·팔 스침으로 화면이 켜져 절전이 무의미해진다',
  ).toBeVisible();

  await page.mouse.click(24, 500); // 세로 중앙이지만 가로는 가장자리 — 두 축이 함께 걸린다
  await page.waitForTimeout(300);
  await expect(overlay(page), '가로 가장자리도 무시한다').toBeVisible();

  // 중앙 — *"잠깐이라도 터치하면"* 이므로 **짧은 탭**으로 풀려야 한다.
  await page.locator('[data-testid="blackout-center-hit"]').click();
  await expect(
    overlay(page),
    '중앙을 탭했는데 안 켜진다 — 탈출 경로가 이것뿐이라 사용자가 앱에 갇힌다',
  ).toBeHidden({ timeout: 3000 });
});

test('④ 계측 — 홀드 진입은 src:hold, 음성 진입은 src:voice로 갈린다', async ({ page }) => {
  await boot(page, PHONE_402);
  await waitForTtsIdle(page);

  await holdHero(page, HOLD_MS + 400);
  await expect(overlay(page)).toBeVisible({ timeout: 3000 });
  await page.locator('[data-testid="blackout-center-hit"]').click();
  await expect(overlay(page)).toBeHidden({ timeout: 3000 });

  await waitForTtsIdle(page);
  await fireStt(page, '화면', 600);
  await expect(overlay(page)).toBeVisible({ timeout: 4000 });

  const logs = await screenOffLogs(page);
  expect(logs.map((e) => e.extra), '두 진입이 같은 이벤트에 출처만 다르게 남는다')
    .toEqual(['src:hold', 'src:voice']);
  // 새 이벤트 타입을 만들지 않았다는 확인 — SOP-003 파서 계약(기존 command/screen_off 그대로).
  expect(logs.every((e) => e.type === 'command')).toBe(true);
});
