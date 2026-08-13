/**
 * v0.49 r5 Z6 오라클(claude #6) — **재청취 안내도 살아 있는 소수 문맥을 따른다.**
 *
 * `'수정'`(재수정)과 `'취소'`는 **거절이 아니다** — 접수된 명령이고 앱이 같은 칸을 다시 듣는다.
 * 그래서 `rejectValue`(비프 + 거절 큐)를 타지 않는다. 그런데 그 둘이 소수부 재질문 문맥에서
 * 같은 계약의 두 반쪽을 어기고 있었다:
 *
 *   ① **표면 모순** — 화면 큐는 「111 점, 소수점 아래」를 그대로 띄우는데(문맥이 살아 있으므로
 *      아무도 지우지 않았다) 귀에는 `측정항목01 다시 말씀해 주세요.`가 들렸다. 사용자가
 *      전체값을 말해야 하는지 소수부만 말해야 하는지 화면과 귀가 갈린다(PRINCIPLES §2 —
 *      R4-F3와 정확히 같은 형태). 게다가 `awaiting.fractionWhole`이 살아 있어, 안내를 믿고
 *      전체값을 말하면 합성 규칙과 충돌한다.
 *   ② **[CLIP-DECIMAL-FRAG-1] 위반** — 소수 재질문은 조각 발화만 유도하므로 그 슬롯은 **계속
 *      녹음**해야 한다(그 계약 본문). `'취소'`는 무조건 `armClipForCell`로 슬롯을 재시작해
 *      직전 원본 전체발화 버퍼를 폐기했고, `'수정'`은 `preserveCommandClip`이 `stopClip()`으로
 *      같은 버퍼를 끊었다.
 *
 * ⚠️ 소수 문맥이 **아닐 때**는 종전 그대로여야 한다 — 슬롯 재무장은 [CLIP-VAL-1]①이 세운 계약
 * (`say()`는 `announceField`와 달리 클립을 시작하지 않아, 재발화가 **결정적으로** 녹음되지
 * 않던 결함). ③④가 그 대조군이다.
 *
 * 클립 축([CLIP-DECIMAL-FRAG-1])은 그 계측 하네스(MediaRecorder 스텁)를 소유한
 * `clip-decimal-frag.spec.ts`에 뒀다(거기 「Z6 —」 두 건). 이 파일은 **표면 축**만 잰다.
 *
 * 반증(문맥 분기 제거 시): ①② red(귀가 다른 말을 한다). ③④는 양방향 green(과잉 적용 반증).
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const COLS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  // 🔴 두 번째 음성 컬럼이 필요하다 — bare '수정'은 **직전 필드**를 타깃으로 잡으므로, 첫 셀에서
  //   곧장 부르면 수정할 대상이 없어 일반 재안내("측정항목01.")로 떨어진다(실측).
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const bootZ6 = (page: Page) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: COLS, totalRows: 1, sessionAutoLabel: 'r5-z6' },
  } as unknown as typeof AZ_SETTINGS,
  headers: ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'],
  sheetRows: [[PREV_ROUND, '이원창', '1', '100.0', '']],
});

const cue = (page: Page) => page.locator('[data-testid="reask-cue"]');

/** `isModifyLike` + 살아 있는 소수 문맥을 만든다.
 *
 *  ⚠️ 순서가 중요하다 — `'수정'`을 **먼저** 넣어 `kind:'modify'`로 들어간 뒤 거기서 소수부를
 *  잃어야 한다. 반대 순서(소수 문맥 → `'수정'`)는 `enterModifyMode`가 셀을 비우고 새 값을
 *  요구하는 경로라 문맥을 **의도적으로** 버린다(그 자리에선 그게 옳다). */
async function armDecimalModify(page: Page) {
  await fireStt(page, '삼십오 점 일', 1800); // 01 커밋 → 02로 전진(직전 필드가 생긴다)
  await waitForTtsIdle(page);
  await fireStt(page, '수정', 1600);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: 수정 재청취에 들어갔다').toBe('수정. 측정항목01.');
  await fireStt(page, '백십일 점 에', 1800); // 수정 재청취 중 소수부 유실
  await waitForTtsIdle(page);
  await expect(cue(page), '전제: 수정 문맥 위에 소수 문맥이 섰다').toContainText('111 점, 소수점 아래');
}

test('① 소수 문맥의 재수정 「수정」 — 귀가 화면과 같은 말을 한다', async ({ page }) => {
  await bootZ6(page);
  await armDecimalModify(page);
  const decimalPrompt = (await ttsLog(page)).at(-1)!;
  expect(decimalPrompt, '전제: 소수 프롬프트를 말하고 있다').toContain('111');

  await fireStt(page, '수정', 1600); // isModifyLike 분기(재수정 재청취)
  await waitForTtsIdle(page);

  await expect(cue(page), '재수정이 살아 있는 소수 문맥을 지웠다').toContainText('111 점, 소수점 아래');
  expect(
    (await ttsLog(page)).at(-1),
    '화면은 「소수점 아래」인데 귀는 전체 재발화를 요구한다 — 무엇을 말할지 알 수 없다',
  ).toBe(decimalPrompt);
});

test('② 소수 문맥의 「취소」 — 귀가 화면과 같은 말을 한다', async ({ page }) => {
  await bootZ6(page);
  await fireStt(page, '백십일 점 에', 1800);
  await waitForTtsIdle(page);
  const decimalPrompt = (await ttsLog(page)).at(-1)!;
  await expect(cue(page), '전제: 소수 문맥이 섰다').toContainText('111 점, 소수점 아래');

  await fireStt(page, '취소', 1600);
  await waitForTtsIdle(page);

  await expect(cue(page), '취소가 살아 있는 소수 문맥을 지웠다').toContainText('111 점, 소수점 아래');
  expect((await ttsLog(page)).at(-1), '화면과 귀가 갈렸다').toBe(decimalPrompt);
});

test('③ 대조군 — 소수 문맥이 아니면 「취소」·재수정 「수정」 모두 종전 문구 그대로', async ({ page }) => {
  await bootZ6(page);

  await fireStt(page, '취소', 1600); // 일반 값 대기에서의 취소
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '일반 재청취 문구가 아니다').toBe('측정항목01 다시 말씀해 주세요.');

  await fireStt(page, '삼십오 점 일', 1800); // 01 커밋 → 02로 전진
  await waitForTtsIdle(page);
  await fireStt(page, '수정', 1600); // → enterModifyMode (kind:'modify')
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1)).toBe('수정. 측정항목01.');

  await fireStt(page, '수정', 1600); // → isModifyLike 분기(소수 문맥 없음)
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '문맥 분기가 일반 경로까지 삼켰다').toBe('측정항목01 다시 말씀해 주세요.');
});

test('④ 취소 뒤에도 문맥이 살아 있다 — 이어지는 조각이 그대로 합성된다', async ({ page }) => {
  await bootZ6(page);
  await fireStt(page, '백십일 점 에', 1800);
  await waitForTtsIdle(page);
  await fireStt(page, '취소', 1600);
  await waitForTtsIdle(page);

  await fireStt(page, '오', 2000);
  await waitForTtsIdle(page);
  await expect(
    page.locator('[data-testid="column-chip"][data-col-name="측정항목01"]'),
    '취소가 소수 문맥을 끊어 조각이 전체값으로 커밋됐다',
  ).toContainText('111.5');
});
