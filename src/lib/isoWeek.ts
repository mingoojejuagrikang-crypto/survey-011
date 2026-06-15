/**
 * v0.8.0 — ISO 8601 주차 순수 유틸 (pastValues.normalizeDateCell 패턴: 브라우저 의존 없음,
 * tests/isoWeek.spec.ts에서 Node로 직접 검증).
 *
 * 회차(조사시기) ISO 날짜 문자열에서 주차를 파생한다. 가상 컬럼이 아니라 표시용 파생값이므로
 * Column[] / keyColumns / buildSampleKey 는 무변경 — 회차 ISO 문자열에서만 계산한다.
 *
 * 모든 계산은 UTC(Date.UTC, getUTC*)로만 한다 — 로컬 게터를 쓰면 타임존 버그가 들어와
 * "브라우저 비의존 / Node 테스트 가능"이 깨진다.
 *
 * ISO 8601 규칙:
 *  - 한 주는 월요일 시작, 일요일 끝.
 *  - week 1 = 그 해 첫 목요일이 속한 주(= 1월 4일이 속한 주).
 *  - 따라서 연초 며칠은 전년도 마지막 주(W52/W53)에, 연말 며칠은 다음 해 W01에 속할 수 있다.
 *    이때 반환하는 year 는 **ISO week-year**(달력 연도가 아님).
 */

/** 입력 ISO 'YYYY-MM-DD'를 UTC Date로. 형식 불일치/실재하지 않는 날짜는 null. */
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

export interface IsoWeek {
  /** ISO week-year (달력 연도가 아님 — 연초/연말 경계에서 다를 수 있다). */
  year: number;
  /** 1..53 */
  week: number;
  /** 그 주의 월요일 ISO 'YYYY-MM-DD'. */
  start: string;
  /** 그 주의 일요일 ISO 'YYYY-MM-DD'. */
  end: string;
}

/**
 * ISO 8601 주차. 'YYYY-MM-DD' → { year(week-year), week, start(월), end(일) }. 파싱 불가는 null.
 */
export function isoWeek(iso: string | null | undefined): IsoWeek | null {
  const dt = parseIsoUtc(iso);
  if (!dt) return null;

  // ISO 요일: 월=1 … 일=7.
  const dayNum = dt.getUTCDay() === 0 ? 7 : dt.getUTCDay();

  // 그 주의 월요일·일요일.
  const monday = new Date(dt);
  monday.setUTCDate(dt.getUTCDate() - (dayNum - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  // ISO 주차 = 그 주 목요일이 속한 해를 기준으로 계산(첫 목요일 주 = W1).
  const thursday = new Date(dt);
  thursday.setUTCDate(dt.getUTCDate() + (4 - dayNum));
  const weekYear = thursday.getUTCFullYear();

  // weekYear 1월 1일과 같은 주의 목요일까지의 주 수.
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week =
    Math.floor((thursday.getTime() - yearStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

  return { year: weekYear, week, start: toIso(monday), end: toIso(sunday) };
}

/**
 * 주차 기간 포맷터(민구 지시: 주차 번호 대신 직관적인 월-일 기간 표시).
 * 그 주의 월요일~일요일을 "6/1~6/7" 형태로. 월·해가 바뀌는 주도 양 끝에 M/D를 모두 표기
 * (예: "5/30~6/5", 연 경계는 "12/29~1/4"). 파싱 불가는 빈 문자열.
 */
export function formatWeekRange(iso: string | null | undefined): string {
  const w = isoWeek(iso);
  if (!w) return '';
  const md = (s: string) => {
    const [, m, d] = s.split('-');
    return `${+m}/${+d}`;
  };
  return `${md(w.start)}~${md(w.end)}`;
}
