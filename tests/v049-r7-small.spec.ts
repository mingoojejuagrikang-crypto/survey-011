/**
 * v0.49 r7 소형 오라클 — 배선/술어가 곧 계약인 건들을 `[node]` 소스 계약으로 잠근다
 * (fixr5 `v049-r5-z9-small`, fixr6 `v049-r6-y9-small`과 같은 전례).
 *
 * 각 항목의 「왜 렌더 결과가 아니라 소스인가」는 테스트별 헤더에 적었다.
 */

import { test, expect } from '@playwright/test';

async function read(path: string): Promise<string> {
  const fs = await import('node:fs');
  return fs.readFileSync(path, 'utf-8');
}

/**
 * #2(codex r6#13) — 세션 `date` 승계 사슬의 폴백 술어는 `||`다.
 *
 * `??`는 **빈 문자열을 통과시킨다.** 이 사슬의 두 항이 정확히 그 형태다:
 *   · `sessionTodayRef`의 미설정 센티넬은 `null`이 아니라 `''`(`useRef<string>('')`).
 *   · `existingSession.date`도 한 번 `''`로 내구화되면 이후 모든 persist가 그 값을 통과시켜
 *     **빈 날짜가 영구히 굳는다** — `date`는 「오늘 세션」 매칭·목록·시트 라벨의 기준이라
 *     빈 값은 그 세션을 목록에서 지운다(v0.7.0 UTC 결함과 같은 증상, 원인만 다르다).
 *
 * ⚠️ 왜 브라우저가 아니라 소스인가: 현행 코드에서 이 폴스루는 **도달 불가**다(`start()`가 첫
 *   커밋 전에 ref를 세우고, 세션 레코드를 만드는 유일한 작성자가 `persistSession` 자신이다).
 *   증상을 만들 수 없으니 잠글 것은 술어뿐이고, 잠그는 이유는 도달로가 하나 생기는 순간
 *   값 유실로 바뀌기 때문이다. 형제 호출부 둘(안내 브리핑의 `today`)은 처음부터 `||`였다 —
 *   같은 사슬에서 술어가 갈려 있는 것 자체가 이 결함의 형태다.
 */
test('[node] #2 세션 date 폴백이 빈 문자열을 통과시키지 않는다', async () => {
  // uvs-a(ENV-12 #2) — persistSession이 usePersistSession.ts로 분리됐다. date 조립은 그 파일에
  // 있고, 세션 고정 시계 접근은 getter 주입(getSessionToday — 읽는 ref는 여전히 본체의
  // sessionTodayRef)이라 술어의 **표기**가 파일별로 다르다. 계약 자체(`||` 사슬·승계 순서·
  // 빈 문자열 불통과)는 그대로다 — 파일별로 각자 잠근다(긍정 단언의 나이브 확장 금지, revc #1).
  const persist = await read('src/lib/usePersistSession.ts');
  const line = persist.split('\n').find((l) => l.trimStart().startsWith('date: existingSession'));
  expect(line, '세션 date 조립 줄을 찾지 못했다 — 이름이 바뀌었으면 이 오라클도 갱신하라').toBeTruthy();
  expect(
    line,
    "`??`는 ''를 통과시킨다 — 빈 날짜가 영속되면 그 세션이 「오늘 세션」 매칭에서 사라진다",
  ).not.toContain('??');
  expect(line, '승계 순서(기록값 → 세션 고정 시계 → 현재 로컬)는 유지한다')
    .toContain('existingSession?.date || getSessionToday() || localTodayISO()');

  // 형제 호출부는 처음부터 `||`였다 — 같은 사슬의 술어가 다시 갈리지 않게 함께 잠근다.
  expect(
    (persist.match(/getSessionToday\(\) \|\| localTodayISO\(\)/g) ?? []).length,
    '세션 고정 시계를 읽는 자리는 전부 같은 술어를 쓴다(date 조립 1)',
  ).toBe(1);
  const src = await read('src/lib/useVoiceSession.ts');
  expect(
    (src.match(/sessionTodayRef\.current \|\| localTodayISO\(\)/g) ?? []).length,
    '세션 고정 시계를 읽는 자리는 전부 같은 술어를 쓴다(브리핑 today 2)',
  ).toBe(2);
});
