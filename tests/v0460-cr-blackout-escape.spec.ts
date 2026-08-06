import { test, expect, type Page } from '@playwright/test';
import { boot } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

/**
 * v0.46.0 콜드 리뷰 L3-3(major) 게이트 — **검은 화면 모드의 탈출 경로.**
 *
 * ## 왜 신설하나
 *
 * WP-F가 신규 131줄(`BlackoutOverlay.tsx`)을 넣었는데 **오라클이 0건이었다**(L3 전수 grep).
 * 🔴 **이 기능의 실패 모드는 「앱에 갇힘」이다** — 오버레이는 `position:fixed; inset:0; zIndex:9999`로
 * 화면 전체를 덮고, 나가는 길은 **길게 누르기 하나**뿐이다. 그 하나가 깨지면 사용자는
 * 앱을 강제 종료해야 하고, **진행 중인 세션의 클립·값이 위험해진다.**
 * 게이트가 없는 채로 배포하면 그 상태를 **아무도 감지하지 못한다.**
 *
 * ## 이 파일이 재는 것
 *
 * | # | 축 | 왜 |
 * |---|---|---|
 * | 1 | 음성 `'화면'`으로 진입한다 | 유일한 진입 경로(민구 R2 — 버튼 자리는 판단 대기) |
 * | 2 | 길게 누르면 해제된다 | 유일한 탈출 경로 |
 * | 3 | **짧게 누르면 해제되지 않는다** | 오작동 방지가 이 기능의 전제다 — 이게 깨지면 절전이 무의미 |
 * | 4 | 🆕 **키보드(Enter)로도 탈출한다** | `role="button"`+`tabIndex=0`을 선언했으므로 계약이다(L3-5) |
 * | 5 | 해제 후 입력이 계속된다 | 「음성 입력은 계속됩니다」 고지가 참인지 |
 *
 * ⚠️ `HOLD_MS`는 900ms다. 여유를 두고 1200ms 누른다 — 경계에 붙이면 판정이 타이밍에 흔들린다.
 */

const HOLD_MS = 900;
const HOLD_SAFE = 1200;

function makeSettings() {
  const columns = [
    { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
    { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 3 }, sampleKey: true },
    { id: 'v0', name: '횡경', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, sampleKey: false },
  ];
  return {
    settings: {
      state: {
        googleConnected: true, userEmail: 'tester@example.com',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_CR_BLACKOUT/edit',
        sheetTab: 'Sheet1', columnsSheetId: 'SHEET_CR_BLACKOUT', columnsSheetTab: 'Sheet1',
        columns, tableGenerated: true, totalRows: 3, ttsRate: 1.05,
        recognitionTolerance: 0.6, sessionLabelColId: null, sessionAutoLabel: 'cr-blackout',
        preferredVoiceName: '', roundDateColId: null,
      },
      version: 12,
    },
    headers: ['조사일자', '조사나무', '횡경'],
    sheetRows: [],
  };
}

const overlay = (page: Page) => page.locator('[data-testid="blackout-overlay"]');

async function enterBlackout(page: Page) {
  await fireStt(page, '화면', 600);
  await overlay(page).waitFor({ state: 'visible', timeout: 4000 });
}

/** 오버레이 중앙을 `ms` 동안 누른다(포인터 경로). */
async function holdPointer(page: Page, ms: number) {
  const box = await overlay(page).boundingBox();
  if (!box) throw new Error('오버레이 박스를 얻지 못했다');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test.describe('WP-F 검은 화면 — 갇히지 않는다', () => {
  test('음성 「화면」으로 진입하고, 길게 눌러 나온다', async ({ page }) => {
    const { settings, headers, sheetRows } = makeSettings();
    await boot(page, { width: 402, height: 874 }, { settings, headers, sheetRows });
    await waitForTtsIdle(page);

    await enterBlackout(page);
    await expect(overlay(page)).toBeVisible();

    await holdPointer(page, HOLD_SAFE);
    await expect(
      overlay(page),
      `길게 눌러도 안 나온다 — 탈출 경로가 이것뿐이라 사용자가 앱에 갇힌다`,
    ).toBeHidden({ timeout: 3000 });
  });

  test('🔴 짧게 누르면 해제되지 않는다 (오작동 방지가 전제다)', async ({ page }) => {
    const { settings, headers, sheetRows } = makeSettings();
    await boot(page, { width: 402, height: 874 }, { settings, headers, sheetRows });
    await waitForTtsIdle(page);

    await enterBlackout(page);
    await holdPointer(page, Math.floor(HOLD_MS * 0.3));
    await page.waitForTimeout(400);
    await expect(
      overlay(page),
      '짧은 터치로 풀리면 주머니 속 오작동으로 화면이 켜진다 — 절전이 무의미해진다',
    ).toBeVisible();
  });

  test('🆕 키보드(Enter)를 누르고 있어도 나온다 — role=button·tabIndex 계약', async ({ page }) => {
    // L3-5: `role="button"`+`tabIndex={0}`을 선언했는데 키 핸들러가 없었다.
    // 포인터를 못 쓰는 경로에서 탈출구가 0개가 된다.
    const { settings, headers, sheetRows } = makeSettings();
    await boot(page, { width: 402, height: 874 }, { settings, headers, sheetRows });
    await waitForTtsIdle(page);

    await enterBlackout(page);
    await overlay(page).focus();
    await page.keyboard.down('Enter');
    await page.waitForTimeout(HOLD_SAFE);
    await page.keyboard.up('Enter');
    await expect(
      overlay(page),
      'Enter를 누르고 있어도 안 나온다 — role=button을 선언했으면 키 경로도 계약이다',
    ).toBeHidden({ timeout: 3000 });
  });

  test('해제 후 음성 입력이 계속된다 — 「음성 입력은 계속됩니다」가 참인가', async ({ page }) => {
    const { settings, headers, sheetRows } = makeSettings();
    await boot(page, { width: 402, height: 874 }, { settings, headers, sheetRows });
    await waitForTtsIdle(page);

    await enterBlackout(page);
    await holdPointer(page, HOLD_SAFE);
    await expect(overlay(page)).toBeHidden({ timeout: 3000 });

    // 🔑 **음성 경로 생존은 「명령이 다시 먹는가」로 잰다.** 처음에는 값(`'123.4'`)을 말해
    //    `[data-hero-state]` 본문에 반영되는지 봤는데, 그 본문은 **세션 진행 상태에 의존**해서
    //    (값 입력 대기 / 확인 대기 / 커밋 직후) 빈 문자열이 정상인 구간이 있다 —
    //    실제로 그렇게 짜서 red가 났고, **제품이 아니라 오라클이 틀렸다.**
    //    `'화면'` 재진입은 STT → 명령 판별 → 상태 변경 전 경로를 한 번에 통과시키는 증거이고
    //    상태 의존이 없다.
    //    ⚠️ 「값 입력이 계속 되는가」는 이 파일 범위 밖이다 — 세션 흐름 스펙이 그 몫이다.
    await enterBlackout(page);
    await expect(
      overlay(page),
      '해제 후 음성 명령이 안 먹는다 — 「음성 입력은 계속됩니다」 고지가 거짓이 된다',
    ).toBeVisible();
  });
});
