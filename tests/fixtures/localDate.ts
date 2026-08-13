/**
 * 🔴 v0.49 r2 A11(합집합 C14) — 테스트 픽스처의 **로컬 달력 날짜** 공용 헬퍼.
 *
 * 왜 생겼나: 과거 회차 픽스처가 「어제」를 `new Date(Date.now() - 86_400_000)`로 만들고 있었다.
 * DST가 있는 타임존에서는 전이일의 하루가 23h·25h라 **「24시간 전」이 어제가 아니다**. 그러면
 * 시트 픽스처의 회차 날짜가 오늘/그저께로 밀리고, `previousRound`/`previousSurveyRound`의
 * strictly-`<` 규칙에서 기대값이 조용히 어긋난다 — 1년에 이틀만 red가 나는 형태의 함정이다.
 * (개발기·CI 타임존이 늘 KST라는 보장은 없다. 타임존을 고정하는 반대 전략의 전례는
 *  `session-local-date.spec.ts:20`의 `test.use({ timezoneId })`.)
 *
 * ⚠️ **아직 이 파일을 쓰지 않는 스펙이 14개 있다**(같은 `Date.now() - 86_400_000` 관용구).
 * v0.49 r2에서는 합집합이 지목한 2개(`v049-prev-survey`·`past-index-fallback`)만 옮겼다 —
 * 나머지 목록은 산출물 `2026-08-13-fixr2-fixes.md`의 「넘길 것」에 있다.
 */

export function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 로컬 달력 기준 N일 전(YYYY-MM-DD). 정오로 맞춘 뒤 `setDate`로 빼므로 전이 시각(대개 0~3시)과
 *  무관하고, 월·연 경계도 달력 규칙대로 넘어간다. */
export function daysAgoLocal(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return localISO(d);
}
