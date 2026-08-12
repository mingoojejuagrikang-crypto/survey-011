/**
 * v0.49 fix49 오라클 A — **filled 셀에 `kind:'value'`를 열지 않는다** (리뷰 2026-08-12 revc B-1, blocker)
 *
 * 이 앱의 커밋 지점(`sess.setRowValue`)에는 **셀 단위 거절 게이트가 없다.** 값이 있든 없든
 * 무조건 덮어쓴다. 그래서 데이터를 지키는 유일한 불변식은 「커서를 filled 셀 위에
 * `kind:'value'`로 세우지 않는다」이고, `activeColIdx` 기록자 전량이 그것을 지켜 왔다.
 * 항목 이동(F-1 신설 `gotoAdjacentField`)은 인접 인덱스를 값 유무와 무관하게 쓰므로
 * **그 문을 처음으로 다시 열었다.**
 *
 * revc는 정적 판독만 했고 재현을 남겼다 — **여기가 그 재현이다.** 처방 전에 ①②④⑤⑦이
 * red임을 실측으로 확인한 뒤 처방을 넣었다(반증까지 해야 회귀 테스트다).
 *   ① 값 있는 셀 착지 후 bare 숫자 발화 → 기존 값 **불변**(덮어쓰기 금지)
 *   ② 착지 시 **기존 값을 낭독**한다(모르고 덮는 경로 차단 — 완료 행 착지와 같은 의미론)
 *   ③ 빈 셀 착지는 **종전대로** 값 수신(`kind:'value'`) — 회귀 0
 *   ④ 착지 후 「수정」이 **그 셀**을 연다(정정 진입로 보존 — cmdModify 재사용)
 *   ⑤ 착지 후 「수정 <값>」 직접 수정도 **다시 값 낭독+대기**로 돌아온다
 *      (🔴 종전 복귀 경로 `announceField(vc[curIdx])`가 채워진 셀에 `kind:'value'`를
 *       재개방한다 — ①과 같은 구멍이라 같은 계약으로 닫는다)
 *   ⑥ 착지 후에도 **항목 이동은 계속 된다**(`reviewWait` 재사용이 불가능한 이유 —
 *      그쪽은 이동 자체를 거부하므로, 재사용하면 이동 기능이 착지 한 번에 죽는다)
 *   ⑦ **행 경계 재안내**(`gotoAdjacentRow`)도 같은 문이다 — _ASK-fix49 Q1, Larry 승인 08-12.
 *
 * 미해결 국면(알람·수정·소수부 재질문)의 이동 거부는 짝 스펙
 * `v049-fix49-phase-guard.spec.ts`가 잰다(다른 계약 — M-1+M-2).
 *
 * Mock: fixtures/stt.
 */

import { test, expect, type Page } from '@playwright/test';
import { installVoiceMocks, fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';
import { BASE } from './baseUrl';

test.setTimeout(120_000);

const STORE_KEY = 'survey-011-settings-v3';
const TOTAL_ROWS = 3;

/** voice 컬럼 3개 — f1nav 스펙과 같은 골격(항목 이동을 «중간→양 끝»으로 왕복시키려면 최소 3개). */
function settings(extra?: Record<string, unknown>) {
  return {
    state: {
      chipSweepSeconds: 0,
      googleConnected: false,
      userEmail: null,
      sheet: null,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_FIX49/edit',
      sheetTab: 'Sheet1',
      columnsSheetId: 'SHEET_FIX49',
      columnsSheetTab: 'Sheet1',
      availableSheets: [],
      manualMode: false,
      columns: [
        { id: 'c6', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: TOTAL_ROWS } },
        { id: 'c8', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c9', name: '종경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
        { id: 'c11', name: '당도', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1 },
      ],
      tableGenerated: true,
      totalRows: TOTAL_ROWS,
      ttsRate: 1.05,
      sessionLabelColId: null,
      sessionAutoLabel: 'fix49',
      noisyMode: false,
      preferredVoiceName: '',
      ...extra,
    },
    version: 12,
  };
}

async function seedAndOpenVoiceTab(page: Page, s: ReturnType<typeof settings> = settings()) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ st, storeKey }) => {
      localStorage.clear();
      localStorage.setItem(storeKey, JSON.stringify(st));
      indexedDB.deleteDatabase('survey-011');
    },
    { st: s, storeKey: STORE_KEY },
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

async function activeChipName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const chip = document.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement | null;
    return chip?.dataset.colName ?? '';
  });
}

/** 컬럼명으로 칩 텍스트를 읽는다(비활성 칩도 읽어야 «다른 셀이 덮이지 않았음»을 잴 수 있다). */
async function chipText(page: Page, colName: string): Promise<string> {
  return page.evaluate((name) => {
    const chip = document.querySelector(`[data-testid="column-chip"][data-col-name="${name}"]`) as HTMLElement | null;
    return chip?.innerText ?? '';
  }, colName);
}

/** 안내 TTS 체인이 끝난(awaiting 무장 완료) 뒤에 발화한다 — f1nav 스펙과 동일 근거. */
async function speakWhenArmed(page: Page, text: string, waitMs = 500) {
  await waitForTtsIdle(page);
  await fireStt(page, text, waitMs);
}

test.beforeEach(async ({ page }) => {
  await installVoiceMocks(page);
});

test('① 값 있는 셀로 「이전」 이동 후 bare 숫자를 말해도 기존 값이 덮이지 않는다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  // 횡경 35.1 커밋 → 자동 전진으로 종경 대기.
  await speakWhenArmed(page, '35.1', 700);
  expect(await activeChipName(page)).toContain('종경');

  // 「이전」으로 **값이 있는** 횡경에 착지.
  await speakWhenArmed(page, '이전');
  expect(await activeChipName(page)).toContain('횡경');
  expect(await chipText(page, '횡경')).toContain('35.1');

  // 🔴 여기가 blocker의 심장 — 무심코 말한 숫자가 확정된 셀을 조용히 덮으면 안 된다.
  await speakWhenArmed(page, '99.9', 800);
  const after = await chipText(page, '횡경');
  expect(after, '확정된 셀이 bare 숫자 발화로 덮였다 — 덮어쓰기 금지 계약 위반').toContain('35.1');
  expect(after, '새 값이 셀에 들어갔다').not.toContain('99.9');
});

test('② 값 있는 셀에 착지하면 기존 값을 낭독한다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  await speakWhenArmed(page, '35.1', 700);
  await waitForTtsIdle(page);
  const before = (await ttsLog(page)).length;

  await speakWhenArmed(page, '이전');
  await waitForTtsIdle(page);
  const spokenAfterMove = (await ttsLog(page)).slice(before).join(' | ');

  // 🔴 "횡경." 한 마디만 하고 값을 안 읽어주면 사용자는 그 칸이 비었다고 믿는다.
  expect(spokenAfterMove, '착지 안내가 기존 값을 낭독하지 않는다').toContain('35.1');
  expect(spokenAfterMove).toContain('횡경');
  // 🔴 문구는 행 검토(reviewWait)·세션 끝(atEnd)과 **구분한다** — 셀 하나에 대고
  //   "완료된 행"/"입력이 끝났습니다"라고 하면 없는 상태를 찾게 된다(v0.47.0 V-FIX4 계약).
  expect(spokenAfterMove).not.toContain('완료됨');
  expect(spokenAfterMove).not.toContain('입력이 끝났습니다');
});

test('③ 빈 셀 착지는 종전대로 값을 받는다 (회귀 0)', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  // 첫 항목(횡경)은 비어 있다 → 「다음」으로 빈 종경에 착지.
  await speakWhenArmed(page, '다음');
  expect(await activeChipName(page)).toContain('종경');

  await speakWhenArmed(page, '22.2', 800);
  expect(await chipText(page, '종경'), '빈 셀 착지에서 값 수신이 막히면 이동 기능이 죽는다').toContain('22.2');
});

test('④ 값 있는 셀 착지 후 「수정」은 그 셀을 다시 연다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  await speakWhenArmed(page, '35.1', 700);
  await speakWhenArmed(page, '이전');
  expect(await activeChipName(page)).toContain('횡경');

  await speakWhenArmed(page, '수정', 800);
  // 재청취 대상이 **횡경**이어야 한다(직전 컬럼 규칙으로 엉뚱한 셀을 열면 안 된다).
  expect(await activeChipName(page)).toContain('횡경');
  const log = (await ttsLog(page)).join(' | ');
  expect(log).toContain('수정');

  // 재청취 중이므로 이제 bare 숫자가 **먹혀야** 한다(정정 진입로가 살아 있다는 증거).
  await speakWhenArmed(page, '41.4', 900);
  expect(await chipText(page, '횡경')).toContain('41.4');
});

test('⑤ 값 있는 셀 착지 후 「수정 <값>」 직접 수정도 값 낭독+대기로 돌아온다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  await speakWhenArmed(page, '35.1', 700);
  await speakWhenArmed(page, '이전');
  expect(await activeChipName(page)).toContain('횡경');

  await speakWhenArmed(page, '수정 41.4', 1000);
  expect(await chipText(page, '횡경')).toContain('41.4');
  expect(await activeChipName(page), '직접 수정 후 커서가 그 셀에 남아야 한다').toContain('횡경');

  // 🔴 복귀가 announceField면 채워진 셀에 kind:'value'가 **다시** 열린다 — ①과 같은 구멍.
  await speakWhenArmed(page, '77.7', 900);
  const after = await chipText(page, '횡경');
  expect(after, '직접 수정 복귀 경로가 덮어쓰기를 재개방했다').toContain('41.4');
  expect(after).not.toContain('77.7');
});

test('⑥ 값 있는 셀에 착지해도 항목 이동은 계속 된다', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  await speakWhenArmed(page, '35.1', 700);
  await speakWhenArmed(page, '이전');
  expect(await activeChipName(page)).toContain('횡경');

  // 🔴 여기서 막히면(=reviewWait 재사용) 항목 이동 기능이 착지 한 번에 죽는다.
  await speakWhenArmed(page, '다음', 700);
  expect(await activeChipName(page), '착지 후 이동이 막혔다').toContain('종경');
  await speakWhenArmed(page, '다음', 700);
  expect(await activeChipName(page)).toContain('당도');
});

test('⑦ 행 경계 재안내도 filled 셀을 열지 않는다 (_ASK-fix49 Q1 — Larry 승인)', async ({ page }) => {
  await seedAndOpenVoiceTab(page);
  await clickStart(page);

  await speakWhenArmed(page, '35.1', 700);
  await speakWhenArmed(page, '이전'); // 커서를 값 있는 횡경에 **주차**시킨다
  expect(await activeChipName(page)).toContain('횡경');

  // 1행에서 「이전행」 → 행 경계 → `gotoAdjacentRow`의 현재 필드 재안내 경로.
  // 🔴 이 줄은 v0.33.0 코드지만, 커서를 filled 셀에 주차시키는 경로가 F-1 전엔 없어
  //   도달 불가였다. 항목 이동이 그 도달 조건을 만들었다 = 같은 커밋이 연 같은 문.
  await speakWhenArmed(page, '이전행', 1300);
  expect((await ttsLog(page)).join(' | ')).toContain('첫 행입니다');

  await speakWhenArmed(page, '99.9', 900);
  const after = await chipText(page, '횡경');
  expect(after, '행 경계 재안내가 filled 셀에 kind:value를 열었다').toContain('35.1');
  expect(after).not.toContain('99.9');
});

