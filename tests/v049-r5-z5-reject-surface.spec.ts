/**
 * v0.49 r5 Z5 오라클(claude #5 · codex M11 잔여/R4-F3) — **거절은 어느 국면에서든 화면에 남는다.**
 *
 * 두 축이다.
 *
 * ## ① 렌더 — 「명령 대기」 국면에서 거절 큐가 눌려 있었다
 * `phase === 'complete'`인 두 국면(행 검토 대기 `reviewWait` · 끝 도달 `atEnd`)에서 거절 큐가
 * 안 보였다: hero 분기는 `reaskReason={completing ? null : reaskReason}`로 눌렀고,
 * 끝 도달의 `CompleteSummary`는 큐를 **아예 받지 않았다**. 그래서 「종료/수정이 안 들렸다」가
 * **비프만 남고 화면에서 사라졌다** — 화면을 자주 못 보는 사용자(PRINCIPLES §2)가 눈을 들었을 때
 * 남는 흔적이 0이다.
 *
 * 🔴 **그 게이트의 근거는 여전히 참인데, 보장 주체가 달랐다.** r4 주석은
 * *"완료 화면에 값 재질문 큐는 없어야 한다"* 고 적었고 그건 옳다 — 그러나 그것을 보장하는 것은
 * 렌더 게이트가 아니라 **흡수**다: 이 두 국면에서 일반 값 발화는 `resolveFinal`이
 * `absorbReviewWait`/`absorbAtEnd`로 먹어 **거절 자체가 성립하지 않는다**
 * (`voiceFinalResolver.ts:79-80`). 즉 게이트가 실제로 누른 것은 **저신뢰 명령 거절 하나뿐**이고,
 * 그건 이 국면이 곧 「명령 대기」이므로 가장 보여줘야 하는 신호다. ③이 그 전제를 함께 고정한다.
 *
 * ## ② TTS — 명령 거절이 단일 종단을 우회해 소수 문맥과 다른 말을 했다 (codex R4-F3)
 * 저신뢰 명령 거절은 `rejectValue`를 부르지 않고 소수 문맥을 **손으로 다시 복원한 뒤** 꼬리
 * 문구를 말했다. 소수 재질문 중이면 화면·`awaiting`은 「111 점, 소수점 아래」를 유지하는데
 * 귀에는 `측정항목01 다시 말씀해 주세요.`가 들린다 — 사용자가 전체값을 말해야 하는지 소수부만
 * 말해야 하는지 화면과 귀가 갈린다(§2 위반). 이제 문맥 판정은 종단이 소유하고 분기는 꼬리만
 * 넘긴다. ④가 후속 합성까지 함께 단언한다(M11 ④가 놓쳤던 지점).
 *
 * 반증: ①② red(렌더 게이트 되돌림) · ④ red(꼬리 하드코딩 복원) · ⑤ red(소스 계약).
 * ③은 **전제 오라클**이다 — 값 발화가 흡수된다는 사실이 깨지면 ①②의 근거가 무너진다.
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
];

const bootZ5 = (page: Page) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: COLS, totalRows: 1, sessionAutoLabel: 'r5-z5' },
  } as unknown as typeof AZ_SETTINGS,
  headers: ['조사일자', '농가명', '조사나무', '측정항목01'],
  sheetRows: [[PREV_ROUND, '이원창', '1', '100.0']],
});

const cue = (page: Page) => page.locator('[data-testid="reask-cue"]');

/** 저신뢰 명령 — `resolveFinal`의 명령별 floor 미달로 `rejectLowConfidence`가 된다. */
const fireLowConfCommand = (page: Page, word: string) => fireStt(page, word, 1500, 0.2);

test('① 끝 도달(완료 화면)에서도 명령 거절이 화면에 남는다 — 비프만 남지 않는다', async ({ page }) => {
  await bootZ5(page);
  await fireStt(page, '삼십오 점 일', 1800); // 1행 = 마지막 행 완료 → 끝 도달
  await waitForTtsIdle(page);
  await expect(page.locator('[data-testid="complete-summary"]'), '전제: 완료 화면이다').toBeVisible();

  await fireLowConfCommand(page, '종료');
  await waitForTtsIdle(page);

  await expect(cue(page), '완료 화면에서 명령 거절이 화면에서 사라진다(비프만 남는다)')
    .toBeVisible({ timeout: 4000 });
  await expect(cue(page)).toHaveAttribute('data-reason', 'low_confidence');
});

test('② 행 검토 대기에서도 명령 거절이 화면에 남는다', async ({ page }) => {
  await bootZ5(page);
  await fireStt(page, '삼십오 점 일', 1800);
  await waitForTtsIdle(page);
  await fireStt(page, '이전행', 1800); // 첫 행 경계 → 완료 행이므로 검토 대기 재무장
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: 행 검토 대기다').toContain('1행 완료됨.');

  await fireLowConfCommand(page, '수정');
  await waitForTtsIdle(page);

  await expect(cue(page), '검토 대기에서 명령 거절이 `completing` 게이트에 눌렸다')
    .toBeVisible({ timeout: 4000 });
});

test('③ 전제 — 그 두 국면에서 **값** 발화는 흡수된다(거절 자체가 성립하지 않는다)', async ({ page }) => {
  await bootZ5(page);
  await fireStt(page, '삼십오 점 일', 1800);
  await waitForTtsIdle(page);

  // 파싱 불가 발화를 끝 도달에 던진다. 흡수 계약이면 거절 큐가 서지 않고 끝 도달 안내가 재생된다.
  await fireStt(page, '변경', 1800);
  await waitForTtsIdle(page);

  await expect(
    cue(page),
    '끝 도달에서 **값** 거절이 성립했다 — ①②의 근거(「눌린 것은 명령 거절뿐」)가 무너진다',
  ).toHaveCount(0);
  expect((await ttsLog(page)).at(-1), '흡수 안내가 아니라 다른 것이 나왔다').toContain('마지막행 입력');
});

test('④ 소수 재질문 중 저신뢰 명령 거절 — 화면과 귀가 같은 말을 하고, 후속 합성이 유지된다 (R4-F3)', async ({ page }) => {
  await bootZ5(page);

  await fireStt(page, '백십일 점 에', 1800); // 소수부 유실 → 정수부 111 보존 타깃 재질문
  await waitForTtsIdle(page);
  await expect(cue(page), '전제: 소수 문맥이 섰다').toContainText('111 점, 소수점 아래');
  const beforeTts = (await ttsLog(page)).at(-1);
  expect(beforeTts, '전제: 소수 프롬프트를 말했다').toContain('111');

  await fireLowConfCommand(page, '수정');
  await waitForTtsIdle(page);

  // 🔴 화면은 소수 문맥을 유지한다(M3 불변식 — 종전에도 참).
  await expect(cue(page), '명령 거절이 살아 있는 소수 문맥을 지웠다').toContainText('111 점, 소수점 아래');
  // 🔴 귀도 **같은 말**을 해야 한다. 종전엔 `측정항목01 다시 말씀해 주세요.`로 갈렸다.
  expect(
    (await ttsLog(page)).at(-1),
    '화면은 「소수점 아래」인데 귀는 전체 재발화를 요구한다 — 사용자가 무엇을 말할지 알 수 없다',
  ).toBe(beforeTts);

  // 🔴 M11 ④가 놓친 지점: 후속 합성까지 단언한다. 문맥이 살아 있으므로 '오'는 111.5여야 한다.
  await fireStt(page, '오', 2000);
  await waitForTtsIdle(page);
  await expect(
    page.locator('[data-testid="column-chip"][data-col-name="측정항목01"]'),
    '소수 문맥이 끊겨 조각이 전체값으로 커밋됐다',
  ).toContainText('111.5');
});

test('⑥ 끝 도달의 명령 거절은 받을 수 없는 값을 요구하지 않는다 (Y5 · codex R5-F3)', async ({ page }) => {
  await bootZ5(page);
  await fireStt(page, '삼십오 점 일', 1800);
  await waitForTtsIdle(page);
  await expect(page.locator('[data-testid="complete-summary"]'), '전제: 끝 도달이다').toBeVisible();

  await fireLowConfCommand(page, '종료');
  await waitForTtsIdle(page);

  const last = (await ttsLog(page)).at(-1) ?? '';
  // 이 국면은 일반 값을 전부 흡수한다(③이 그 전제를 별도로 증명한다). 그러니 값을 요구하면
  // 시킨 대로 한 사용자가 흡수 안내로 되받히는 루프에 갇힌다.
  expect(last, '끝 도달에서 필드 값 재입력을 지시했다 — 그 값은 받을 수 없다').not.toContain('다시 말씀해');
  expect(last, '거절 사유가 귀에 남지 않는다').toBe('소리가 불확실.');
});

test('⑦ 검토 대기의 명령 거절 꼬리는 흡수 안내와 같은 조작 어휘다 (Y5)', async ({ page }) => {
  await bootZ5(page);
  await fireStt(page, '삼십오 점 일', 1800);
  await waitForTtsIdle(page);
  await fireStt(page, '이전행', 1800);
  await waitForTtsIdle(page);
  expect((await ttsLog(page)).at(-1), '전제: 행 검토 대기다').toContain('1행 완료됨.');

  await fireLowConfCommand(page, '수정');
  await waitForTtsIdle(page);

  const last = (await ttsLog(page)).at(-1) ?? '';
  expect(last, '검토 대기에서 필드 값 재입력을 지시했다 — 그 값은 흡수된다').not.toContain('다시 말씀해');
  expect(last, '거절 꼬리가 이 상태의 조작 어휘와 다르다 — 같은 상태에 두 이름을 주면 안 된다').toBe('수정 또는 다음행.');

  // 두 표면이 **같은 상수**를 쓰는지 실제로 대조한다: 값 발화를 던져 흡수 안내를 유발한다.
  await fireStt(page, '구십구 점 구', 1800);
  await waitForTtsIdle(page);
  expect(
    (await ttsLog(page)).at(-1) ?? '',
    '흡수 안내와 거절 꼬리가 같은 어휘를 공유하지 않는다 — 같은 상태에 두 이름',
  ).toContain(last);
});

test('[node] ⑤ 거절 종단은 하나다 — handleFinal이 armRejectCue를 직접 부르지 않는다', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync('src/lib/useVoiceSession.ts', 'utf-8');

  const from = src.indexOf('const armRejectCue = useCallback(');
  const rejectFrom = src.indexOf('const rejectValue = useCallback(');
  expect(from, 'armRejectCue를 찾지 못했다').toBeGreaterThan(0);
  expect(rejectFrom, 'rejectValue를 찾지 못했다').toBeGreaterThan(from);

  // 주석은 제외한다 — 근거 서술이 옛 호출을 인용한다.
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const calls = code.split('armRejectCue(').length - 1;
  expect(
    calls,
    'armRejectCue를 부르는 곳이 rejectValue 하나가 아니다 — 거절 표면이 다시 이원화됐다',
  ).toBe(1);

  const rejectBody = src.slice(rejectFrom, src.slice(rejectFrom).indexOf('}, [armRejectCue') + rejectFrom);
  expect(rejectBody, '종단이 표면 무장을 소유하지 않는다').toContain('armRejectCue(reason)');
  expect(rejectBody, '종단이 소수 문맥의 화면/TTS 일치를 소유하지 않는다').toContain('decimalReaskPrompt(whole)');
  expect(rejectBody, '꼬리 인자가 없다 — 명령 거절이 다시 종단을 우회하게 된다').toContain('opts?.tail');
});
