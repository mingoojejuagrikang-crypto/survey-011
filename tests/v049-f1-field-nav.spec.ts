/**
 * v0.49 F-1 오라클 — 「이전」/「다음」=**항목** 이동 · 「이전행」/「다음행」=**행** 이동
 * (민구 결정 2026-08-12)
 *
 * 민구 원문: *"「이전」, 「다음」은 사용자가 입력 대상 항목들을 하나씩 이동하고, 「이전행」,
 * 「다음행」은 아예 입력행 자체를 이동했으면 좋겠어."*
 *
 * ## 이 spec이 지키는 계약
 * ① 「다음」/「이전」은 **항목 커서만** 옮긴다 — **행 번호는 절대 변하지 않는다.**
 *    이 «행 불변»이 기능의 목적(의미 분리) 그 자체라, 여기가 red면 재배정이 실패한 것이다.
 * ② 경계에서 **행을 넘기지 않는다.** 마지막 항목의 「다음」·첫 항목의 「이전」은 이동 없이
 *    짧은 안내만 한다(무음 금지 REVIEW-4 — gotoAdjacentRow의 '첫 행입니다'와 대칭).
 * ③ 「다음행」/「이전행」은 **종전 행 이동 계약을 그대로 승계**한다(로직 이전이지 변경이 아니다).
 * ④ 이동은 **값을 건드리지 않는다** — 되돌아온 항목의 기록값이 그대로 있다.
 * ⑤ 검토 대기(reviewWait)에서는 항목 이동을 하지 않는다 — announceField가 bare 값 커밋을 열어
 *    v0.33.0 결정 3(완료 행 덮어쓰기 금지)을 깨기 때문. 대신 '수정'으로 안내한다.
 *
 * 🔴 **최장 일치**가 이 spec의 숨은 전제다: '이전'⊂'이전행'이라, detectCommand가 선언 순서대로
 *    순회하면 「이전행」이 짧은 prevField에 가로채여 ③이 통째로 red가 된다.
 *    단어 단위 회귀는 tests/koreanNum.spec.ts(순수)가 함께 잰다.
 *
 * Mock: fixtures/stt(installVoiceMocks·fireStt·ttsLog). 픽스처 골격은 v0440-c8-flow.spec.ts를 따른다.
 */

import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'survey-011-settings-v3';
const TOTAL_ROWS = 3;

/** voice 컬럼 **3개** — 항목 이동을 «중간→양 끝»으로 왕복시키려면 최소 3개가 필요하다
 *  (2개면 모든 칸이 경계라 ①과 ②를 분리해서 잴 수 없다). */
function settings() {
  return {
    state: {
      googleConnected: false,
      userEmail: null,
      sheet: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_F1_1/edit',
      sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_F1_1',
      columnsSheetTab: 'Sheet1',
      availableSheets: [],
      manualMode: false,
      columns: [
        { id: 'c6', name: '조사나무', type: 'int',   input: 'auto',  ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: TOTAL_ROWS } },
        { id: 'c8', name: '횡경',     type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c9', name: '종경',     type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c11', name: '당도',    type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      ],
      tableGenerated: true,
      totalRows: TOTAL_ROWS,
      ttsRate: 1.05,
      sessionLabelColId: null,
      sessionAutoLabel: 'F1',
      noisyMode: false,
      preferredVoiceName: '',
    },
    version: 12,
  };
}

async function seedAndOpenVoiceTab(page: Page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ s, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(s));
      indexedDB.deleteDatabase('survey-011');
    },
    { s: settings(), storeKey: STORE_KEY },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.waitForTimeout(300);
}

async function clickStart(page: Page) {
  const startBtn = page.locator('text=음성 입력 시작').first();
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await expect(page.locator('[data-testid="voice-active-state"]').first()).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(400);
}

/** 현재 활성 칩(=음성 커서가 있는 항목)의 컬럼명. */
async function activeChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return chip?.dataset.colName ?? '';
  });
}

async function activeRow(page: Page): Promise<number> {
  const text = await page.evaluate(() => document.body.innerText);
  const m = text.match(new RegExp('(\\d+)\\s*\\/\\s*' + TOTAL_ROWS + '\\s*행'));
  return m ? parseInt(m[1]) : -1;
}

/** 안내 TTS 체인이 끝난(awaiting 무장 완료) 뒤에 발화한다 — 바로 쏘면 handleFinal의
 *  `if (!awaiting) return` 게이트에 떨어져 조용히 유실된다(v0440-c8-flow와 동일 근거). */
async function speakWhenArmed(page: Page, text: string, waitMs = 500) {
  await waitForTtsIdle(page);
  await fireStt(page, text, waitMs);
}

test.beforeEach(async ({ page }) => {
  await installVoiceMocks(page);
});

// ─── ① 「다음」/「이전」 = 항목 이동, **행 불변** ────────────────────────────────
test('① 「다음」은 항목 커서만 +1 옮기고 행은 그대로다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  const row0 = await activeRow(page);
  expect(await activeChipName(page)).toContain('횡경');

  await speakWhenArmed(page, '다음');
  expect(await activeChipName(page)).toContain('종경');
  // 🔴 핵심 단언 — 항목 이동이 행을 넘기면 의미 분리가 실패한 것이다.
  expect(await activeRow(page)).toBe(row0);

  await speakWhenArmed(page, '다음');
  expect(await activeChipName(page)).toContain('당도');
  expect(await activeRow(page)).toBe(row0);
});

test('② 「이전」은 항목 커서만 -1 옮기고 행은 그대로다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  const row0 = await activeRow(page);
  await speakWhenArmed(page, '다음');
  await speakWhenArmed(page, '다음');
  expect(await activeChipName(page)).toContain('당도');

  await speakWhenArmed(page, '이전');
  expect(await activeChipName(page)).toContain('종경');
  expect(await activeRow(page)).toBe(row0);

  await speakWhenArmed(page, '이전');
  expect(await activeChipName(page)).toContain('횡경');
  expect(await activeRow(page)).toBe(row0);
});

// ─── ② 경계: 행을 넘기지 않는다 + 무음 금지 ────────────────────────────────────
test('③ 마지막 항목에서 「다음」 — 행을 넘기지 않고 "마지막 항목입니다"로 안내한다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  const row0 = await activeRow(page);
  await speakWhenArmed(page, '다음');
  await speakWhenArmed(page, '다음');
  expect(await activeChipName(page)).toContain('당도'); // 마지막 항목

  await speakWhenArmed(page, '다음');
  // 🔴 행 이동은 '다음행' 전용이다 — 경계에서 행이 넘어가면 red.
  expect(await activeRow(page)).toBe(row0);
  expect(await activeChipName(page)).toContain('당도');
  const log = (await ttsLog(page)).join(' | ');
  expect(log).toContain('마지막 항목입니다');
});

test('④ 첫 항목에서 「이전」 — 행을 넘기지 않고 "첫 항목입니다"로 안내한다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  const row0 = await activeRow(page);
  expect(await activeChipName(page)).toContain('횡경'); // 첫 항목

  await speakWhenArmed(page, '이전');
  expect(await activeRow(page)).toBe(row0);
  expect(await activeChipName(page)).toContain('횡경');
  const log = (await ttsLog(page)).join(' | ');
  expect(log).toContain('첫 항목입니다');
});

// ─── ③ 행 이동 어휘는 종전 계약을 승계한다 ─────────────────────────────────────
test('⑤ 「다음행」은 행을 +1 옮긴다 (최장 일치 — 짧은 「다음」에 가로채이지 않는다)', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  const row0 = await activeRow(page);
  await speakWhenArmed(page, '다음행', 900);
  // 🔴 여기가 red면 detectCommand가 '다음행'을 짧은 nextField로 가로챈 것이다.
  expect(await activeRow(page)).toBe(row0 + 1);
});

test('⑥ 「이전행」은 행을 -1 옮긴다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  const row0 = await activeRow(page);
  await speakWhenArmed(page, '다음행', 900);
  expect(await activeRow(page)).toBe(row0 + 1);

  await speakWhenArmed(page, '이전행', 900);
  expect(await activeRow(page)).toBe(row0);
});

// ─── ④ 이동은 값을 건드리지 않는다 ─────────────────────────────────────────────
test('⑦ 항목 이동은 기록값을 건드리지 않는다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  // 횡경에 35.1 커밋 → 자동 전진으로 종경 대기.
  await speakWhenArmed(page, '35.1', 700);
  expect(await activeChipName(page)).toContain('종경');

  // 「이전」으로 횡경 복귀 — 값이 살아 있어야 한다.
  await speakWhenArmed(page, '이전');
  expect(await activeChipName(page)).toContain('횡경');

  const chipText = await page.evaluate(() => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return chip?.innerText ?? '';
  });
  expect(chipText).toContain('35.1');
});

// ─── ⑤ 검토 대기에서는 이동하지 않는다 (완료 행 덮어쓰기 금지 계약 보존) ────────
test('⑩ 검토 대기 중 「다음」은 이동을 거부한다 — 그리고 세션을 먹통으로 만들지 않는다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  // 1행 완주(voice 3칸) → 행 완료 자동 전진으로 2행.
  await speakWhenArmed(page, '35.1', 700);
  await speakWhenArmed(page, '22.2', 700);
  await speakWhenArmed(page, '12.3', 1100);
  expect(await activeRow(page)).toBe(2);

  // 「이전행」으로 **완료된** 1행 착지 = enterReviewWait(값 낭독 + 명령 대기).
  await speakWhenArmed(page, '이전행', 1300);
  expect(await activeRow(page)).toBe(1);

  const chipBefore = await activeChipName(page);
  await speakWhenArmed(page, '다음', 1000);

  // 🔴 이동하지 않는다. announceField가 kind:'value'를 열면 뒤이은 bare 숫자가 **완료된 셀을
  //   덮어쓴다** — v0.33.0 결정 3(완료 행 덮어쓰기 금지)이 막으려던 바로 그 경로다.
  expect(await activeRow(page), '검토 대기 중 항목 이동이 행을 옮기면 안 된다').toBe(1);
  expect(await activeChipName(page), '커서도 그대로여야 한다').toBe(chipBefore);
  expect((await ttsLog(page)).join(' | ')).toContain('검토 중입니다');

  // 🔴 거부가 **무음·먹통**이 되면 안 된다(REVIEW-4). 이 파일의 다른 no-op 경로들이 재안내로
  //   무음을 피하는 것과 같은 이유 — 후속 「다음행」이 그대로 먹혀야 한다.
  await speakWhenArmed(page, '다음행', 1300);
  expect(await activeRow(page), '거부 후에도 다른 명령이 살아 있어야 한다').toBe(2);
});

// ─── ⑥ 가르치는 표면: 도움말·버튼 표기 (민구 요구 ④ + 버튼 정정 08-12) ──────────
test('⑧ 도움말("?")이 새 어휘를 그대로 가르친다 — 항목 이동과 행 이동이 글자로 구분된다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  await page.locator('button[title="음성 명령어 도움말"]').first().click();
  const popup = page.locator('[data-testid="command-help-popup"]');
  await expect(popup).toBeVisible();
  const text = await popup.innerText();

  // 행 이동 어휘가 새 표기로 실린다(도움말은 VOICE_COMMANDS에서 동적 생성 — display/desc가 유일 surface).
  expect(text).toContain('이전행');
  expect(text).toContain('다음행');
  // 🔴 항목 이동 설명은 «항목»을, 행 이동 설명은 «행»을 말해야 한다. 도움말이 둘을 같은 말로
  //   설명하면 사용자는 방금 재배정된 두 어휘를 구별할 방법이 없다(민구 요구 ④의 실질).
  expect(text).toContain('바로 앞 항목으로 돌아갑니다');
  expect(text).toContain('바로 뒤 항목으로 건너뜁니다');
  expect(text).toContain('이전 행으로 이동합니다');

  // 🔴 '유지'(keep)와 문장이 겹치지 않아야 한다 — 겹치면 도움말이 **가르치지 못한다.**
  //   keep은 값이 있어야 동작하고 채워진 칸을 건너뛴다(advance); 항목 이동은 인접 한 칸이다.
  expect(text).toContain('현재 항목의 값을 그대로 두고 다음으로 넘어갑니다'); // keep 원문 보존
  expect(text.match(/값 입력 없이/g) ?? [], '항목 이동 2줄만 이 표현을 쓴다').toHaveLength(2);
});

test('⑨ 행 이동 버튼 — 표기만 「이전행」/「다음행」으로 바뀌고 기능·testId는 불변이다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  // 🔴 민구 정정 08-12: 버튼은 **신설하지 않는다.** 기존 두 버튼의 표기만 새 어휘와 정합시킨다
  //   (testId는 그대로 — 바꾸면 이 앱의 모든 네비 스펙이 함께 깨진다).
  await expect(page.locator('[data-testid="voice-control-prev"]')).toHaveAttribute('aria-label', '이전행');
  await expect(page.locator('[data-testid="voice-control-next"]')).toHaveAttribute('aria-label', '다음행');

  // 기능 불변 — 버튼은 종전대로 **행**을 옮긴다(항목이 아니다).
  const row0 = await activeRow(page);
  await page.locator('[data-testid="voice-control-next"]').click();
  await page.waitForTimeout(900);
  expect(await activeRow(page)).toBe(row0 + 1);
});
