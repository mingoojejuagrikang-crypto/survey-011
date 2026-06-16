/**
 * Korean spoken number parser.
 *
 * Supports:
 *  - Sino-Korean: 일~구, 십/백/천/만/억
 *  - Native Korean: 하나/한, 둘/두, 셋/세 … 열
 *  - Decimal separator: 점/쩜
 *  - Mixed STT outputs ("일점오", "1 점 5", "1.5", "35.1")
 *  - Comma noise / leading garbage stripped via shortest-clean-number heuristic
 *
 * Returns numeric string or null.
 */

const SINO: Record<string, number> = {
  영: 0, 공: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9,
};

const NATIVE: Record<string, number> = {
  하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4,
  다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
};

const SMALL_UNIT: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
const BIG_UNIT: Record<string, number> = { 만: 10000, 억: 100000000 };

/** Max sensible integer part for measurement domain (mm / g / Brix etc.) */
const OVERFLOW_THRESHOLD = 9999;

function tryArabic(s: string): number | null {
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

function parseKoreanInt(token: string): number | null {
  if (!token) return null;
  const a = tryArabic(token);
  if (a !== null) return a;
  const native = parseNativeInt(token);
  if (native !== null) return native;
  return parseSinoInt(token);
}

/** Full Korean-spoken parse including decimal (used by per-token loop). */
function parseKoreanSpokenAll(token: string): number | null {
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

function splitDecimal(text: string): string[] {
  // "점" / "쩜" / "." can all act as decimal separator when surrounded by Korean digits
  return text.split(/[\s]*[점쩜.][\s]*/);
}

/** Parse fraction digits one symbol at a time (sino > native > arabic). */
function parseFractionDigits(text: string): string {
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

/** v0.5.0 W4/W5: machine-readable reason for the most recent parseKoreanNumber() null.
 *  Set fresh on every call; read by the caller (handleFinal) to tag stt_parse_failed.
 *  - 'multi_numeric'          — ≥2 independent valid numeric tokens ("이 166.7") → ambiguous (STT-A)
 *  - 'decimal_fraction_lost'  — "<정수> 점 <비숫자>" — decimal intent, fraction lost (STT-B)
 *  - 'extraneous_token'       — single number + unrelated non-numeric token(s) ("제17.7",
 *                               "현백 33.3") → ambiguous, re-ask (STT-C, v0.7.0) */
let _lastParseFailReason: string | null = null;
export function getLastParseFailReason(): string | null {
  return _lastParseFailReason;
}

/** v0.10.0 A1: decimal_fraction_lost일 때(소수 의도인데 소수부 유실) 파싱된 정수부 문자열.
 *  호출자가 "<정수부>점, 소수점 아래만 다시 말씀해 주세요" 타깃 재질문에 쓴다. 다른 실패 사유엔 null. */
let _lastParseFailWhole: string | null = null;
export function getLastParseFailWhole(): string | null {
  return _lastParseFailWhole;
}

/** v0.7.0 STT-C: non-numeric residual tokens that legitimately accompany a spoken measurement
 *  and must NOT make a single-number utterance ambiguous. Deliberately tight — the documented
 *  leading-syllable mishears ([STT-6] 백→액/에봇/개/엑, 06-12 제/현백) are NOT here, so those
 *  shapes re-ask instead of silently committing a value with its hundreds digit lost. */
const HARMLESS_RESIDUAL_TOKENS = new Set([
  // 단위어 — 측정 발화에 정당하게 동반 ("33.3 밀리", "20.5 mm")
  '밀리미터', '미리미터', '밀리', '미리', '밀',
  '센티미터', '센치미터', '센티', '센치', '미터',
  '그램', '그람', '킬로그램', '킬로', '키로',
  '브릭스', '퍼센트', '프로', '도',
  'mm', 'cm', 'kg', 'g',
  // 조사·어미 — 값에 붙는 종결/조사 ("33.3이요", "35 입니다")
  '은', '는', '이', '가', '요', '이요', '예요', '이에요', '에요', '입니다', '임',
  // 기존 커밋 보장 어휘(HIGH-1/T-1 회귀 계약 — "당도 8"/"점수 8"/"다시 점수 8"은 커밋 유지)
  '당도', '점수', '다시',
]);

function isHarmlessResidual(tok: string): boolean {
  const t = tok.replace(/[\s.,!?]+/g, '').toLowerCase();
  if (!t) return true;
  return HARMLESS_RESIDUAL_TOKENS.has(t);
}

/**
 * Try to parse `raw` as a Korean spoken number.
 * `maxDecimals` (optional) rounds the result.
 */
export function parseKoreanNumber(raw: string, maxDecimals?: number): string | null {
  _lastParseFailReason = null;
  _lastParseFailWhole = null;
  if (!raw) return null;
  const s = raw.replace(/[, 　]/g, ' ').trim();
  if (!s) return null;

  // Fast path: pure arabic.
  const direct = tryArabic(s);
  if (direct !== null) return formatNum(direct, maxDecimals);

  // v0.5.0 W5 (STT-B): a trailing 점/쩜 ("33 점", "삼십점") means the user spoke a decimal
  // but STT dropped the fraction — the whole-spoken shortcut would silently commit the bare
  // integer. Skip it and let the decimal-discriminator branch below re-ask. A trailing "."
  // (punctuation, e.g. "33.") is NOT 점/쩜 and keeps the fast paths.
  const trailingDecimalWord = /[점쩜]$/.test(s);

  // If the whole string is a clean spoken-Korean number (incl. 점-decimal), parse it.
  const wholeSpoken = trailingDecimalWord ? null : parseKoreanSpokenAll(s.replace(/\s+/g, ''));
  if (
    wholeSpoken !== null &&
    Math.abs(wholeSpoken) <= OVERFLOW_THRESHOLD &&
    /^[\s영공일이삼사사오육륙칠팔구하한둘두셋세넷네다섯여섯일곱여덟아홉열십백천만억점쩜.\d]+$/.test(s)
  ) {
    return formatNum(wholeSpoken, maxDecimals);
  }

  // H1: Preserve `<정수부> 점 <소수부>` structure before per-token splitting, but ONLY
  // when the utterance is genuinely a decimal. STT emits the decimal as whitespace-separated
  // tokens (e.g. "칠십사 점 칠"), and the per-token loop below would drop the "점" token and
  // keep only the last digit. Recombine into a single value when the structure is unambiguous.
  //
  // The discriminator is the FRACTION part: only treat 점/쩜 as a decimal separator when the
  // tail parses as valid fraction digits. This avoids false positives where "점" is part of an
  // ordinary word ("점수 8", "당도 점수 8") — there the tail ("수 8" / "수 8") is NOT fraction
  // digits, so we fall through to the per-token loop, which correctly commits the trailing 8.
  const decimalParts = s.split(/\s*[점쩜]\s*/);

  if (decimalParts.length === 2) {
    // Exactly one 점/쩜 — decimal candidate. The fraction part is the discriminator:
    // parseFractionDigits emits output ONLY when the tail STARTS with a fraction digit.
    const tail = decimalParts[1].trim().replace(/\s+/g, '');
    const frac = parseFractionDigits(tail);
    // Codex HIGH-1: tail does NOT start with a fraction digit (e.g. "점수 8" → tail="수 8" →
    // frac="") → "점" is a literal word, not a separator. Fall through to per-token extraction,
    // which correctly commits the trailing 8. (Unit suffixes like "칠도"→"7" still combine.)
    if (frac) {
      const head = decimalParts[0].trim().replace(/\s+/g, '');
      // Empty integer part ("점 칠") → null (stray fraction, no whole).
      // Unparseable integer part ("세대 점 칠") → null.
      const whole = head ? parseKoreanInt(head) : null;
      // Codex MEDIUM-3: reject a non-integer whole ("33.5 점 칠" → parseKoreanInt("33.5")=33.5
      // via tryArabic). Combining 33.5 + "." + 7 would silently drop the spoken fraction.
      // Only a clean integer whole may carry a spoken decimal fraction.
      if (whole === null || !Number.isInteger(whole)) return null;
      const combined = parseFloat(`${whole}.${frac}`);
      if (Number.isFinite(combined) && Math.abs(combined) <= OVERFLOW_THRESHOLD) {
        return formatNum(combined, maxDecimals);
      }
      return null;
    }
    // v0.5.0 W5 (STT-B): decimal INTENT with a LOST fraction — "111 점 에" (STT garbled the
    // fraction syllable). Discriminators: the head parses as a clean integer AND the tail
    // carries no digit at all. Last-wins used to silently commit the bare integer (111),
    // dropping the spoken decimal — a wrong measurement with no signal. Re-ask instead.
    // "점수 8"/"당도 점수 8" stay safe: their head ("", "당도") is NOT an integer → fall through.
    // "111 점 5" never reaches here (frac non-empty → handled above).
    {
      const head = decimalParts[0].trim().replace(/\s+/g, '');
      if (head && !/\d/.test(tail)) {
        const whole = parseKoreanInt(head);
        if (whole !== null && Number.isInteger(whole)) {
          // v0.10.0 A1 (민구 결정: 타깃 재질문): "에→1" 같은 값 추측은 하지 않는다 — 같은
          // "111 점 에"가 111.1(06-16)·111.5(06-10) 양쪽에서 나와 추측은 조용한 오커밋이 된다.
          // 대신 정수부를 노출해 호출자(useVoiceSession)가 "소수점 아래만 다시"로 타깃 재질문하게 한다.
          _lastParseFailReason = 'decimal_fraction_lost';
          _lastParseFailWhole = String(whole);
          return null;
        }
      }
    }
    // frac empty + head not an integer → not a decimal → fall through (HIGH-1).
  } else if (decimalParts.length >= 3) {
    // Codex HIGH-2: multiple 점/쩜 ("칠십사 점 칠 점 팔"). If the LAST segment starts with a
    // fraction digit, committing only the trailing token would be a silent wrong commit → null
    // so the caller re-asks. Otherwise ("점" is a literal word) fall through to the per-token loop.
    const last = decimalParts[decimalParts.length - 1].trim().replace(/\s+/g, '');
    if (last && parseFractionDigits(last)) return null;
    // else fall through.
  }

  // Per-token pass: split by whitespace, prefer the LAST clean small one.
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    let lastValid: number | null = null;
    let validCount = 0;
    const residuals: string[] = [];
    for (const tok of tokens) {
      const a = tryArabic(tok);
      if (a !== null && Math.abs(a) <= OVERFLOW_THRESHOLD) {
        lastValid = a;
        validCount++;
        continue;
      }
      const k = parseKoreanSpokenAll(tok);
      if (k !== null && Math.abs(k) <= OVERFLOW_THRESHOLD) {
        lastValid = k;
        validCount++;
        continue;
      }
      // T-1 (silent wrong-value commit): this token parsed as NEITHER a clean
      // arabic value NOR a spoken-Korean number, yet it carries a digit
      // (e.g. "105시" in STT output "105시 5.5"). last-wins would silently drop
      // it and commit the trailing "5.5" — a wrong measurement with no signal.
      // Treat the whole utterance as AMBIGUOUS → return null so the caller
      // (useVoiceSession handleFinal) logs stt_parse_failed and re-asks,
      // exactly like the Codex HIGH-2 / MEDIUM-3 multi-token guards above.
      if (/\d/.test(tok)) return null;
      residuals.push(tok);
    }
    // v0.5.0 W4 (STT-A): ≥2 independently-valid numeric tokens (e.g. "이 166.7" — STT split
    // "이백 66.7" misrecognition; row would silently commit the LAST one). Legitimate multi-token
    // numerals ("백 이십삼", "칠십사 점 칠") never reach this loop — the whole-spoken and decimal
    // recombination paths above consume them. Whatever survives to here with two valid numbers
    // is genuinely ambiguous → null so the caller logs stt_parse_failed:multi_numeric and re-asks.
    // No auto-correction is attempted (민구/Trace decision — observe via telemetry first).
    if (validCount >= 2) {
      _lastParseFailReason = 'multi_numeric';
      return null;
    }
    // v0.7.0 STT-C: exactly ONE valid number accompanied by unrelated non-numeric token(s)
    // ("현백 33.3" — intended 333.3, STT mangled the leading "삼백" into a noun; cumulative ×4
    // across 3 field sessions). The dot-bearing siblings are caught by W4/W5 above, but this
    // dot-less single-number shape used to silently commit the bare number with its hundreds
    // digit lost. Unless EVERY residual token is a known-harmless unit/particle ("33.3 밀리",
    // "35 입니다" still commit), treat as ambiguous → re-ask, tagged 'extraneous_token'.
    if (lastValid !== null && residuals.length > 0 && !residuals.every(isHarmlessResidual)) {
      _lastParseFailReason = 'extraneous_token';
      return null;
    }
    if (lastValid !== null) return formatNum(lastValid, maxDecimals);
  }

  // T-1 sibling (no-space single token, e.g. "105시5.5"): the per-token loop is
  // skipped (tokens.length === 1) but the arabicMatches fallback below would
  // re-run the same last-wins extraction. If a digit-bearing chunk failed to
  // parse cleanly AND there are multiple arabic chunks, that's the same silent
  // wrong commit — bail to ambiguous. We detect it by: more than one arabic
  // chunk present while the string is not itself a clean number (we already
  // know it isn't — tryArabic returned null at the top).
  const allArabicChunks = Array.from(s.matchAll(/\d+(?:\.\d+)?/g)).map((m) => m[0]);
  if (allArabicChunks.length > 1) {
    // Multiple disjoint numeric chunks in an unclean utterance → cannot reduce
    // to a single unambiguous value. Re-ask instead of last-wins. (Pure
    // decimals like "33.5" never reach here — handled by the top fast path.)
    return null;
  }

  // Look for arabic chunks inside text (e.g. STT mixed "33.3이요").
  const arabicMatches = allArabicChunks;
  if (arabicMatches.length) {
    const candidates = arabicMatches.filter((x) => {
      const intPart = x.split('.')[0];
      return intPart.length <= 4 && parseFloat(intPart) <= OVERFLOW_THRESHOLD;
    });
    if (candidates.length) {
      // v0.7.0 STT-C (no-space sibling): "제17.7" — intended 77.7, STT mangled the leading
      // "칠십" syllable into "제" (field log 06-11 evt 108) and the bare 17.7 was silently
      // committed. A single embedded number may only carry known-harmless unit/particle
      // residue ("33.3이요", "20.5mm" commit); anything else is ambiguous → re-ask.
      const chunk = candidates[candidates.length - 1];
      const idx = s.lastIndexOf(chunk);
      const pre = s.slice(0, idx);
      const post = s.slice(idx + chunk.length);
      if (!isHarmlessResidual(pre) || !isHarmlessResidual(post)) {
        _lastParseFailReason = 'extraneous_token';
        return null;
      }
      const n = parseFloat(chunk);
      if (Number.isFinite(n)) return formatNum(n, maxDecimals);
    }
  }

  // Spoken Korean path
  const parts = splitDecimal(s).map((p) => p.replace(/\s+/g, ''));

  if (parts.length === 1) {
    const n = parseKoreanInt(parts[0]);
    if (n === null) return null;
    return formatNum(n, maxDecimals);
  }

  if (parts.length === 2) {
    const whole = parseKoreanInt(parts[0]);
    if (whole === null) return null;
    const frac = parseFractionDigits(parts[1]);
    if (!frac) return formatNum(whole, maxDecimals);
    const combined = parseFloat(`${whole}.${frac}`);
    if (!Number.isFinite(combined)) return null;
    return formatNum(combined, maxDecimals);
  }

  return null;
}

function formatNum(n: number, maxDecimals?: number): string {
  if (maxDecimals === undefined) return String(n);
  return Number(n.toFixed(maxDecimals)).toString();
}

// ─── Voice commands ────────────────────────────────────────────
// The command set + canonical words live in voiceCommands.ts (single source of truth, I-1).
import { VOICE_COMMANDS, type VoiceCommand } from './voiceCommands';
export type { VoiceCommand } from './voiceCommands';

export function detectCommand(raw: string): VoiceCommand {
  const s = raw.replace(/[\s.,]+/g, '');
  if (!s) return null;
  // 후치 정정: "178.1 수정" → modify (값-우선 형태, 숫자 시작만). 별칭 '정정'은 단일화로 제거됨.
  if (/수정$/.test(s) && /^[0-9]/.test(s)) return 'modify';
  // 전치 매칭: 각 명령의 단일 표준 단어로 시작하면 그 명령. 표준 단어는 서로 prefix 관계가 아니므로
  // (voiceCommands.ts 불변식) 순회 순서와 무관하게 모호성이 없다. 활용형 꼬리("수정해줘")는 허용.
  for (const c of VOICE_COMMANDS) {
    if (s.startsWith(c.word)) return c.id;
  }
  return null;
}

/** "수정 18.4" → "18.4",  "178.1 수정" → "178.1" — 단일 단어 '수정'만 인식(별칭 '정정' 제거). */
export function extractModifyValue(raw: string): string | null {
  // 전치: "수정 178.1" → "178.1"
  const prefix = raw.match(/(?:수정)[\s,.]*(.+)/);
  if (prefix) return prefix[1].trim();
  // 후치: "178.1 수정" → "178.1"
  const suffix = raw.match(/^(.+?)[\s,.]*(?:수정)$/);
  if (suffix && /^[0-9]/.test(suffix[1].trim())) return suffix[1].trim();
  return null;
}

/**
 * T-3 (single-syllable homophone): true when `raw` is a single bare Sino-Korean
 * syllable that is also a common non-number word/particle (이=2/조사, 사=4/死,
 * 오=5/감탄사, 일=1/일감, 구=9, 영=0, 공=0 …). On a measurement column STT can
 * return one of these with HIGH confidence yet the user almost never speaks a
 * lone single digit for a mm/Brix measurement, so it must be re-confirmed rather
 * than silently committed. Multi-syllable numerals ("이백삼십삼"), arabic ("2"),
 * and native words ("세","두") are NOT flagged — only a lone SINO syllable.
 */
export function isAmbiguousSingleSyllable(raw: string): boolean {
  const s = raw.replace(/[\s.,]+/g, '');
  if (s.length !== 1) return false;
  return SINO[s] !== undefined;
}
