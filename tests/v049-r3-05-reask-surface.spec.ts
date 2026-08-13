/**
 * v0.49 r3 #5 오라클 — **거절에는 언제나 재시도 표면이 있다**(claude r2 HIGH).
 *
 * W2 개정이 재질문 TTS를 두 어절로 줄이면서 *"재시도 신호는 부정 비프 + 화면 `ReaskCue`가
 * 전담한다"* 를 계약으로 세웠다(`voicePrompts.ts` REASK_TTS 헤더). 그런데 그 화면 큐가
 * **중앙이 hero 분기일 때만** 떴다:
 *
 *   ⓐ `VoiceHero`가 `{interimValue && <ReaskCue …>}`로 감싸고 있었다. 여기서 `interimValue`는
 *      인식 문자열이 아니라 **모드 플래그**(`!review && !showConfirm`)다.
 *   ⓑ `CenterStage`는 6분기 상호배타이고 `ReaskCue`는 hero 분기 **안**에 산다. 그래서
 *      **수정 재기록 중(modifyIndicator 분기)** 거절은 어느 표면에도 재시도 지시가 없었다 —
 *      "수정" → 재발화 → 오인식은 이 앱에서 가장 흔한 재질문 문맥이다.
 *
 * 화면을 끄고 2~3m 떨어져 쓰는 사용자에게 남는 신호는 비프 하나뿐이고, 비프는 「무엇을 다시
 * 말해야 하는지」를 말하지 못한다(PRINCIPLES §2 — 두 표면이 같은 사실을 말한다).
 *
 * ⚠️ **실측이 ⓐ의 피해 범위를 좁혔다(수정 전 사전 실행).** 확인 플래시 중 거절 시나리오는
 * 수정 **이전에도 green**이었다 — 플래시는 1.5초 뒤 스스로 꺼지고 그때 큐가 뜨므로, ⓐ의 실제
 * 효과는 「영구 부재」가 아니라 **최대 1.5초 지연**이다. 그 지연을 잠그려면 남은 플래시 시간을
 * 예산으로 쓰는 고정 대기가 필요한데, 그건 #13이 지목한 flake 예약이라 **오라클을 만들지
 * 않았다**. ⓐ의 수정(모드 게이트 제거)은 일관성 근거로 유지하고 산출물에 그대로 보고한다.
 * 이 스펙이 잠그는 것은 **ⓑ**다 — 관측 가능하고 결정적인 쪽.
 *
 * 반증(수정 분기의 큐 제거 시): ①② red.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const MINI_COLUMNS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
  { id: 'm2', name: '측정항목02', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];
const MINI_SETTINGS = {
  ...AZ_SETTINGS,
  state: { ...AZ_SETTINGS.state, columns: MINI_COLUMNS, totalRows: 1, sessionAutoLabel: 'r3-05' },
};
const MINI_HEADERS = ['조사일자', '농가명', '조사나무', '측정항목01', '측정항목02'];
const MINI_ROWS = [[PREV_ROUND, '이원창', '1', '100.0', '']];

const cue = (page: Page) => page.locator('[data-testid="reask-cue"]');

async function bootMini(page: Page) {
  await boot(page, PHONE_402, {
    settings: MINI_SETTINGS as unknown as typeof AZ_SETTINGS,
    headers: MINI_HEADERS,
    sheetRows: MINI_ROWS,
  });
}

test('① 수정 재기록 중의 거절에도 재질문 큐가 뜬다 (modifyIndicator 분기)', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);

  // bare 「수정」 → 중앙이 수정 안내(ModifyIndicatorPill)로 바뀐다. 이 분기에는 hero가 없다.
  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);
  await expect(page.locator('[data-testid="modify-indicator"]'), '전제: 중앙이 수정 분기다')
    .toBeVisible({ timeout: 4000 });

  // 재발화가 오인식됐다 — 값이 아니라 잡음. 거절되고 재질문된다.
  await fireStt(page, '바나나 사과 포도', 1200);
  await expect(cue(page), '수정 재기록 중 거절에 재시도 표면이 없다 — 비프뿐이다')
    .toBeVisible({ timeout: 4000 });
  await expect(cue(page)).toHaveAttribute('data-reason', 'parse_failed');
});

test('② 수정 재기록 중 저신뢰 거절도 같은 표면을 얻는다 — 사유가 달라도 계약은 하나다', async ({ page }) => {
  await bootMini(page);
  await fireStt(page, '11.1', 900);
  await waitForTtsIdle(page);
  await fireStt(page, '수정', 1500);
  await waitForTtsIdle(page);
  await expect(page.locator('[data-testid="modify-indicator"]'), '전제: 중앙이 수정 분기다')
    .toBeVisible({ timeout: 4000 });

  // 신뢰도 미달 — 파싱도 안 되므로 저신뢰 거절 분기로 간다(#6이 손댄 그 게이트 순서 그대로).
  await fireStt(page, '담백', 1200, 0.3);
  await expect(cue(page), '저신뢰 거절만 표면을 못 받으면 사유별로 화면이 갈린다')
    .toBeVisible({ timeout: 4000 });
  await expect(cue(page)).toHaveAttribute('data-reason', 'low_confidence');
});
