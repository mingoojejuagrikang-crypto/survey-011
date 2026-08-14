/**
 * v0.49 r6 Y3 오라클(claude #3·#7) — **Z2가 세운 두 계약을 공유 코어가 아직 안 지키고 있었다.**
 *
 * Z2는 착지 넷(`announceField`·`enterCellWait`·`enterReviewWait`·`announceEndReached`)을
 * `armLanding` 하나로 모으고 거기서 `stopping`을 거절하게 했다. 그런데 거절은 **착지에서** 일어나고,
 * 그 앞의 `setReturn`·`setActiveRow`·`epoch` bump·행 낭독은 이미 실행된 뒤다. 그 앞부분을 소유한
 * 곳이 `jumpToRow`(행 이동 공유 코어)와 `advance()`인데 둘 다 가드 밖이었다:
 *   · `jumpToRow` — 형제 콜러 둘(`gotoAdjacentRow`·`goNextRow`)은 각자 stopping 가드를 갖고 있고
 *     **공유 코어만 없었다.** 새 콜러(자동입력 칩 편집 → `computeRowFromAutoChange`)가 그 사이로
 *     들어온다. 또 bump 뒤 `await announceRowDiff` 사이에 **epoch 재확인이 없어**, 안내 중 barge-in이
 *     커서를 옮겨도 낡은 좌표로 착지를 무장했다(fix49b #6이 경계 둘에 넣은 그 가드).
 *   · `advance()` — Z2가 모은 넷에 **속하지 않는 전이를 스스로 한다**(`setPhase('complete')`와 행
 *     이동). 종료 중 커밋 continuation이 도달하면 `stopping`이 `complete`로 덮인다.
 *
 * ⚠️ **이 셋은 브라우저 red를 만들 수 없다**(실측, fixr6): 종료 중 화면은 `StoppingState`라 자동입력
 * 칩이 없어 그 진입로가 UI에서 닫혀 있고, 값 커밋 직후의 `'종료'` 발화는 STT 목에서 커밋 처리에
 * 흡수돼 `stop`이 실행되지 않는다. 그래서 형태를 소스 계약으로 잠근다 — Z2 ③④(사본·누락 계약)와
 * `v049-r3-01` ①c의 전례를 따른다. **지워지면 다음 콜러가 조용히 같은 구멍으로 들어온다.**
 */

import { test, expect } from '@playwright/test';

const SRC = 'src/lib/useVoiceSession.ts';
// uvs-b(ENV-12 #3) — jumpToRow가 useRowNav.ts로 분리됐다. ①②(jumpToRow 본문)는 분리 파일에서,
// ③(advance)은 본체에서 읽는다. 형제 순서(jumpToRow → gotoAdjacentRow)는 분리 파일에 보존됐다.
const NAV_SRC = 'src/lib/useRowNav.ts';

async function source(): Promise<string> {
  const fs = await import('node:fs');
  return fs.readFileSync(SRC, 'utf-8');
}

async function navSource(): Promise<string> {
  const fs = await import('node:fs');
  return fs.readFileSync(NAV_SRC, 'utf-8');
}

/** `jumpToRow`의 본문만 잘라낸다(형제 콜러의 가드가 섞여 통과하지 않게). */
function jumpBody(src: string): string {
  const start = src.indexOf('const jumpToRow = useCallback(');
  expect(start, 'jumpToRow를 못 찾았다 — 이름이 바뀌었으면 이 계약도 함께 옮겨라').toBeGreaterThan(0);
  const end = src.indexOf('const gotoAdjacentRow = useCallback(', start);
  return src.slice(start, end);
}

test('[node] ① 행 이동 공유 코어가 종료를 거절한다', async () => {
  const body = jumpBody(await navSource());
  expect(
    body,
    'jumpToRow에 stopping 가드가 없다 — 착지는 armLanding이 거절해도 커서·예약·epoch는 이미 옮겨진다',
  ).toContain("if (sess.phase === 'stopping') {");
  expect(body, '거절을 로그에 남기지 않으면 종료 중 이동 시도가 분석에서 보이지 않는다')
    .toContain('jump_refused:stopping:');
});

test('[node] ② 행 이동 공유 코어가 bump 뒤 epoch를 재확인한다(착지 무장 직전 2곳)', async () => {
  const body = jumpBody(await navSource());
  expect(body, 'bump 직후 startEpoch를 잡지 않는다').toContain('const startEpoch = epochRef.current;');
  expect(
    body.match(/if \(epochRef\.current !== startEpoch\) return;/g) ?? [],
    '착지 무장 직전 재확인이 2곳이 아니다(완료 행 → 검토 대기 · 미완료 행 → 필드 안내)',
  ).toHaveLength(2);
});

test('[node] ③ advance는 종료 중 진행하지 않되 내구성 부기는 남긴다', async () => {
  const src = await source();
  const start = src.indexOf('const advance = useCallback(');
  const guard = src.slice(start, src.indexOf('// Still voice cols in this row?', start));
  expect(guard, 'advance에 stopping 가드가 없다 — setPhase(complete)가 stopping을 덮는다')
    .toContain("if (sess.phase === 'stopping') {");
  expect(
    guard,
    '가드가 부기까지 건너뛴다 — 커밋된 값이 완료 마킹 없이 stop()의 persist에 complete:false로 굳는다',
  ).toContain('void finalizeRowCompletion(row);');
  expect(guard, '거절 계측이 없다').toContain('advance_refused:stopping');
});
