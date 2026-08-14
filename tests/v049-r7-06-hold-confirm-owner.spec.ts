/**
 * 🔴 v0.49 r7 #6 오라클(codex r6#14) — **수동 보류 [확인]은 보류한 셀의 소유권을 다시 확인한다.**
 *
 * `confirmManualAnomaly`의 종단은 `proceedAfterCommit(awaitingFieldRef.current)`였다. 그 ref가
 * 보류 시점의 것이라는 보장이 이 함수 안에 없는데, 어긋나면 피해가 둘이다:
 *   ① `proceedAfterCommit`이 **남의 행에 착지한다** — 그 행의 열린 칸을 `advance()`로 지나쳐
 *      사용자가 방금 안내받은 칸이 조용히 건너뛰어진다.
 *   ② 안의 `finalizeRowCompletion(awaiting.row)`가 **남의 행에 걸려** 보류한 행이 완료 부기를
 *      영영 못 받는다. `persistSession`은 rows를 completedRows·activeRow·skippedRows 셋에서만
 *      만들므로 어느 집합에도 없는 그 행은 다음 persist에서 **통째로 떨어진다**(Z8 값 유실 재개방).
 *
 * ⚠️ **전제 재검증 — 리뷰의 「점프 창」은 두 번 갈렸다(브라우저 실측 08-14).**
 *   1차: 팝업 중 자동칩 클릭이 타임아웃해 «도달 불가»로 봤다. **틀렸다** — 막은 건 팝업이 아니라
 *        칩 스윕 애니메이션(Playwright stability)이고, 히트 테스트는 칩이 받는다.
 *   2차: `force` 클릭으로 뚫으니 점프는 **실제로 돈다**(「조사나무 2. / 측정항목01.」). 자동 컬럼
 *        칩 인라인 편집(`computeRowFromAutoChange` → `onJumpToRow` → `jumpToRow`)만
 *        `isManualHoldBlocked`를 안 지나기 때문이다(형제 셋은 전부 게이트가 있다).
 *        **그러나** 그 점프의 `announceField`가 `clearAnomalyAlert`로 팝업을 내려 버려서,
 *        그 뒤 [확인] 버튼은 **존재하지 않는다** — `confirmManualAnomaly`도 `!alert?.manualHold`로
 *        즉시 return한다. 즉 이 경로로는 «낡은 awaiting의 [확인]»에 도달할 수 없다.
 *   👉 결론: 리뷰가 지목한 증상은 현행 UI에서 재현 불가이고, 남는 도달로는 reload 복원이
 *      `getColById(pending.colId)` 실패로 조기 return해 ref가 **null인 채** 팝업만 서는 형상뿐이다
 *      (그때 종전 코드는 `proceedAfterCommit(null)`로 부기를 통째로 건너뛴다).
 *      그래서 이 수정은 증상 수정이 아니라 **구조적 backstop**이고, 잠글 것은 «배선»이다
 *      (Z2 armLanding 거절 · Y3 종료 가드 · r3-01 ①c와 같은 전례).
 *   👉 대신 **다른 결함이 실측으로 드러났다**: 그 점프가 미확인 이상치 팝업을 소리 없이 내린다
 *      (= `isManualHoldBlocked`가 존재하는 이유인 「미확인 이상치 우회」 그 자체 · 07-14 민구 결정).
 *      처방은 `jumpToRow`에 게이트를 다는 별개 축이라 이 라운드 범위 밖 —
 *      [MANUALHOLD-JUMP-BYPASS-1]로 등재하고 산출물에 보고한다.
 *
 * 반증: ①의 네 단언은 소유 재검증/부기 좌표를 되돌리면 red. ②는 과잉 방어 대조군이다.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

/** `trendRule:'increase'` — 직전 회차 100.0보다 큰 `120.5`가 위반이다(Z4와 같은 설계). */
const COLS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 2 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false, trendRule: 'increase' },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const bootR7 = (page: Page) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: COLS, totalRows: 2, sessionAutoLabel: 'r7-06' },
  } as unknown as typeof AZ_SETTINGS,
  headers: ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'],
  sheetRows: [
    [PREV_ROUND, '이원창', '1', '100.0', ''],
    [PREV_ROUND, '이원창', '2', '100.0', ''],
  ],
});

const chip = (page: Page, colName: string) =>
  page.locator(`[data-testid="column-chip"][data-col-name="${colName}"]`);
const confirmBtn = (page: Page) => page.locator('[data-testid="anomaly-confirm-btn"]');

/**
 * ① 배선 계약 — 착지는 소유일 때만, 부기는 보류된 행에.
 *
 * 왜 렌더가 아니라 소스인가: 위 헤더대로 «어긋난 awaiting으로 [확인]에 도달하는» 경로가 현행
 * UI에 없다(두 번 실측해 둘 다 기각). 증상을 만들 수 없으니 잠글 것은 술어와 좌표뿐이고,
 * 잠그는 이유는 도달로가 하나 열리는 순간 값 유실(Z8 형태)로 바뀌기 때문이다.
 */
test('[node] ① 보류 [확인]의 착지는 소유 술어를, 부기는 보류 셀의 행을 쓴다', async () => {
  const fs = await import('node:fs');
  // uvs-c(ENV-12 #5) — manualHold 터치 구획이 useTrendGate.ts로 분리됐다(이동 커밋). 형제 순서
  // (confirmManualAnomaly → modifyManualAnomaly)가 그대로 보존돼 슬라이스 로직은 불변 — 소스
  // 경로만 재표적한다. `awaitingFieldRef`는 그 훅에도 **ref 그대로** 주입되므로 아래 부정 단언의
  // 바이트 형태(`proceedAfterCommit(awaitingFieldRef.current)`)도 이동 전과 동일하다.
  const src = fs.readFileSync('src/lib/useTrendGate.ts', 'utf-8');
  const body = src.slice(
    src.indexOf('const confirmManualAnomaly = useCallback'),
    src.indexOf('const modifyManualAnomaly = useCallback'),
  );
  expect(body, 'confirmManualAnomaly 본문을 못 찾았다 — 이름이 바뀌었으면 이 오라클도 갱신하라').toBeTruthy();
  const code = body.replace(/\/\/.*$/gm, '');

  expect(
    code,
    '착지에 소유 술어가 없다 — 어긋난 awaiting이면 남의 행에 착지해 그 행의 열린 칸을 건너뛴다',
  ).toContain('const ownsHold =');
  expect(
    code,
    '술어가 commitManualValue와 갈렸다 — 좌표 정본은 pendingValidation이다',
  ).toContain('aw.row === pv.row && aw.colId === pv.colId');
  expect(
    code,
    '내구성 부기가 소유 분기 안에 있으면 소유가 아닐 때 보류 행이 부기를 못 받는다(Z8 재개방)',
  ).toContain('finalizeRowCompletion(pv.row)');
  expect(
    code,
    '소유가 아닐 때도 그대로 proceedAfterCommit을 부르면 이 수정이 무의미하다',
  ).not.toContain('proceedAfterCommit(awaitingFieldRef.current)');
});

test('② 대조군 — 소유한 보류의 해소는 종전 착지 그대로다(과잉 방어로 흐름을 끊지 않는다)', async ({ page }) => {
  await bootR7(page);
  await waitForTtsIdle(page);
  await chip(page, '측정항목01').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toBeVisible({ timeout: 5000 });
  for (const k of ['1', '2', '0', '.', '5']) await page.locator(`[data-testid="manual-key-${k}"]`).click();
  await page.locator('[data-testid="manual-commit"]').click();
  await expect(page.locator('[data-testid="manual-value-sheet"]')).toHaveCount(0);
  await expect(confirmBtn(page), '전제: 수동 이상치 보류가 걸렸다').toBeVisible({ timeout: 6000 });

  await confirmBtn(page).click();
  await waitForTtsIdle(page);
  expect(
    (await ttsLog(page)).at(-1),
    '소유한 보류의 해소는 다음 칸으로 전진한다 — 가드가 정상 경로를 막으면 안 된다',
  ).toBe('측정항목02.');
});
