/**
 * v0.44.0 §C8 F27 — "일요일 시작 주차의 화요일" 순수 유틸 (민구 확정 2026-08-02).
 *
 * 날짜 컬럼 "지정" 기본값 = 오늘이 속한, **일요일에 시작하는 주**의 화요일.
 *   예) 2026-08-02(일)→08-04 · 2026-08-03(월)→08-04 · 2026-08-08(토)→08-04 · 화요일이면 그날.
 *
 * 🔴 lib/isoWeek.ts는 ISO 8601(**월요일 시작**)이라 재사용하지 않는다 — 일요일 입력이
 * "전 주"로 계산돼 화요일이 일주일 밀린다(08-02(일) → 07-28). 별도 파일로 분리한 이유다.
 *
 * 주 계산은 isoWeek.ts와 같은 규율로 UTC(Date.UTC/getUTC*)만 쓴다(브라우저 비의존 / Node 테스트
 * 가능). 단 "오늘"을 ISO로 만들 때는 **로컬 날짜 부품**을 쓴다(localTodayIso) — toISOString()은
 * UTC라 KST 00:00~09:00에 어제로 밀리는 타임존 버그가 있다(autoValue의 '오늘' 치환과 동일 규율).
 *
 * v0.44.0 §C8 F28도 이 파일의 localTodayIso를 공유한다(입력값 설정 날짜 스탬프 — settingsStore).
 */

/** 입력 ISO 'YYYY-MM-DD'를 UTC Date로. 형식 불일치/실재하지 않는 날짜는 null (isoWeek.ts 패턴). */
function parseIsoUtc(iso: string | null | undefined): Date | null {
  if (iso === null || iso === undefined) return null;
  const s = String(iso).trim();
  const mt = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!mt) return null;
  const y = +mt[1];
  const m = +mt[2];
  const d = +mt[3];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // 실재 검증 (예: 2026-02-30 → 3/2 로 롤오버되므로 거부).
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

/** UTC Date를 ISO 'YYYY-MM-DD' 문자열로. */
function toIso(dt: Date): string {
  return (
    `${dt.getUTCFullYear()}-` +
    `${String(dt.getUTCMonth() + 1).padStart(2, '0')}-` +
    `${String(dt.getUTCDate()).padStart(2, '0')}`
  );
}

/**
 * 입력 날짜가 속한 **일요일 시작 주**의 화요일을 ISO 'YYYY-MM-DD'로. 파싱 불가는 null.
 * getUTCDay(): 일=0 … 토=6 → 그 주의 일요일 = 입력 - day, 화요일 = 일요일 + 2.
 */
export function tuesdayOfSundayWeek(iso: string | null | undefined): string | null {
  const dt = parseIsoUtc(iso);
  if (!dt) return null;
  const day = dt.getUTCDay(); // 일요일 시작: 0(일)~6(토)이 곧 주 내 오프셋
  const tuesday = new Date(dt);
  tuesday.setUTCDate(dt.getUTCDate() - day + 2);
  return toIso(tuesday);
}

/** 오늘(로컬 시계 기준)의 ISO 'YYYY-MM-DD'. toISOString() 금지 — UTC 변환으로 날짜가 밀린다. */
export function localTodayIso(now: Date = new Date()): string {
  return (
    `${now.getFullYear()}-` +
    `${String(now.getMonth() + 1).padStart(2, '0')}-` +
    `${String(now.getDate()).padStart(2, '0')}`
  );
}

/** 날짜 컬럼 "지정" 기본값 — 오늘이 속한 일요일 시작 주의 화요일 (F27 SSOT).
 *  localTodayIso가 항상 유효 ISO를 만들므로 null 폴백은 방어용(오늘 그대로). */
export function defaultDesignatedDate(now: Date = new Date()): string {
  const today = localTodayIso(now);
  return tuesdayOfSundayWeek(today) ?? today;
}
