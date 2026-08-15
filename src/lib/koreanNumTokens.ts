/**
 * 한글 수사 **원시 토큰 계층** — 「발화 문자열 → 수」의 어휘 변환만 갖는다.
 *
 * 이 파일에는 **정책이 없다.** 모호성 판정(잡토큰·다중 숫자·소수부 유실)과 실패 사유 계측은
 * 전부 `koreanNum.ts`의 `parseKoreanNumber`가 소유한다 — 그 경계가 이 분리의 정의다.
 * 여기 있는 함수는 「읽히면 수, 안 읽히면 null」만 답하고 왜 안 읽혔는지는 말하지 않는다.
 *
 * 담는 것:
 *  - 수사 표 4종(사이노·고유어·소단위·대단위) + 측정 도메인 상한
 *  - 정수 파싱 3층(아라비아 → 고유어 → 사이노 복합어)
 *  - 소수 구조 분해(`splitDecimal`) + 소수부 한 글자씩 읽기(`parseFractionDigits`)
 *
 * 🔴 `export`를 늘리지 마라 — 파일 밖 이용자 없는 export는 knip 신규 검출이 된다.
 * 현재 노출은 `koreanNum.ts`가 실제로 쓰는 8개뿐이고, 나머지(NATIVE·SMALL_UNIT·BIG_UNIT·
 * parseSinoInt·parseNativeInt)는 모듈 내부 전용이다.
 */

export const SINO: Record<string, number> = {
  영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9,
};

const NATIVE: Record<string, number> = {
  하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4,
  다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
};

const SMALL_UNIT: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
const BIG_UNIT: Record<string, number> = { 만: 10000, 억: 100000000 };

/** Max sensible integer part for measurement domain (mm / g / Brix etc.) */
export const OVERFLOW_THRESHOLD = 9999;

export function tryArabic(s: string): number | null {
  const cleaned = s.replace(/[,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  // Reject obvious STT noise (e.g. "10,000,000,000,000,199.9")
  const intPart = cleaned.split('.')[0].replace('-', '');
  if (intPart.length > 4 || parseFloat(intPart) > OVERFLOW_THRESHOLD) return null;
  return parseFloat(cleaned);
}

/**
 * Parse a sino-korean compound integer like "이천이십육" → 2026.
 * Walks left to right accumulating digits with unit multipliers.
 */
function parseSinoInt(text: string): number | null {
  if (!text) return null;
  let total = 0;       // accumulator across 만/억 boundaries
  let section = 0;     // accumulator within current 만-section
  let digit = 0;       // last unmultiplied digit
  let consumed = false;

  for (const ch of text) {
    if (SINO[ch] !== undefined) {
      digit = SINO[ch];
      consumed = true;
      continue;
    }
    if (SMALL_UNIT[ch] !== undefined) {
      const u = SMALL_UNIT[ch];
      section += (digit === 0 ? 1 : digit) * u;
      digit = 0;
      consumed = true;
      continue;
    }
    if (BIG_UNIT[ch] !== undefined) {
      const u = BIG_UNIT[ch];
      const localValue = section + digit;
      total += (localValue === 0 ? 1 : localValue) * u;
      section = 0;
      digit = 0;
      consumed = true;
      continue;
    }
    return null;
  }
  if (!consumed) return null;
  return total + section + digit;
}

/** Native korean digits: 다섯 → 5, 열다섯 → 15 */
function parseNativeInt(text: string): number | null {
  if (NATIVE[text] !== undefined) return NATIVE[text];
  if (text.startsWith('열')) {
    const rest = text.slice(1);
    if (!rest) return 10;
    const r = NATIVE[rest];
    if (r !== undefined && r < 10) return 10 + r;
  }
  return null;
}

export function parseKoreanInt(token: string): number | null {
  if (!token) return null;
  const a = tryArabic(token);
  if (a !== null) return a;
  const native = parseNativeInt(token);
  if (native !== null) return native;
  return parseSinoInt(token);
}

/** Full Korean-spoken parse including decimal (used by per-token loop). */
export function parseKoreanSpokenAll(token: string): number | null {
  if (!token) return null;
  const parts = splitDecimal(token);
  if (parts.length === 1) return parseKoreanInt(parts[0]);
  if (parts.length === 2) {
    const w = parseKoreanInt(parts[0]);
    if (w === null) return null;
    const frac = parseFractionDigits(parts[1]);
    if (!frac) return w;
    const c = parseFloat(`${w}.${frac}`);
    return Number.isFinite(c) ? c : null;
  }
  return null;
}

export function splitDecimal(text: string): string[] {
  // "점" / "쩜" / "." can all act as decimal separator when surrounded by Korean digits
  return text.split(/[\s]*[점쩜.][\s]*/);
}

/** Parse fraction digits one symbol at a time (sino > native > arabic). */
export function parseFractionDigits(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (SINO[c] !== undefined) {
      out += String(SINO[c]);
      i++;
      continue;
    }
    if (/\d/.test(c)) {
      out += c;
      i++;
      continue;
    }
    const three = text.slice(i, i + 3);
    const two = text.slice(i, i + 2);
    const n3 = NATIVE[three];
    const n2 = NATIVE[two];
    if (n3 !== undefined && n3 < 10) { out += String(n3); i += 3; continue; }
    if (n2 !== undefined && n2 < 10) { out += String(n2); i += 2; continue; }
    break;
  }
  return out;
}
