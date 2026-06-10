/**
 * Korean spoken-number parser — pure-function unit tests.
 *
 * koreanNum.ts has no DOM/browser dependencies, so we import it directly and
 * exercise it in Node (no page.goto). Uses the project's existing Playwright
 * test runner so no new tooling is introduced.
 *
 * Coverage focus:
 *  - H1: decimal token preservation ("<정수부> 점 <소수부>" recombination)
 *  - H1: unparseable integer part → null (no stray-fraction auto-commit)
 *  - Regression guard for previously-correct utterances
 *  - M1: extractRedoValue inline-value extraction
 */

import { test, expect } from '@playwright/test';
import {
  parseKoreanNumber,
  extractModifyValue,
  detectCommand,
  isAmbiguousSingleSyllable,
  getLastParseFailReason,
} from '../src/lib/koreanNum';

test.describe('parseKoreanNumber — decimal preservation (H1)', () => {
  const ok: Array<[string, string]> = [
    // whole-spoken path (already worked) — regression guards
    ['칠십사 점 칠', '74.7'],
    ['이십 점 오', '20.5'],
    ['일 점 오', '1.5'],
    ['삼십오 점 일', '35.1'],
    // space-separated decimal tokens (per-token loop used to drop "점")
    ['세 점 칠', '3.7'],
    ['칠 점 칠', '7.7'],
    // mixed sino integer + sino fraction across spaces
    ['이십삼 점 사', '23.4'],
    // forces the new recombination block: a unit suffix (도) fails the whole-spoken
    // charset regex, so this routes through the per-token-preceding decimal recombine path.
    ['칠십사 점 칠도', '74.7'],
    ['이십 점 오 mm', '20.5'],
  ];
  for (const [input, expected] of ok) {
    test(`"${input}" → ${expected}`, () => {
      expect(parseKoreanNumber(input)).toBe(expected);
    });
  }
});

test.describe('parseKoreanNumber — stray fraction must not auto-commit (H1)', () => {
  // "세대" has no numeric mapping (74 = 칠십사). Previously this parsed to "7"
  // (last token only). It must now yield null so the caller re-asks.
  test('"세대 점 칠" → null (unparseable integer part)', () => {
    expect(parseKoreanNumber('세대 점 칠')).toBeNull();
  });
  test('"점 칠" → null (no integer part)', () => {
    expect(parseKoreanNumber('점 칠')).toBeNull();
  });
});

test.describe('parseKoreanNumber — "점" as a literal word, not a decimal separator (Codex HIGH-1)', () => {
  // The 점/쩜 decimal-split was too aggressive: any "점" caused integer-part validation,
  // turning normal utterances containing the WORD "점" (점수=score) into null (re-ask).
  // Now "점" is only a separator when the tail starts with fraction digits.
  test('"점수 8" → "8" (tail "수 8" is not fraction digits → fall through)', () => {
    expect(parseKoreanNumber('점수 8')).toBe('8');
  });
  test('"당도 점수 8" → "8"', () => {
    expect(parseKoreanNumber('당도 점수 8')).toBe('8');
  });
  test('"다시 점수 8" → "8" (redo keyword stripped by caller; bare parse keeps 8)', () => {
    // parseKoreanNumber itself does not handle the redo keyword, but "다시 점수 8" must
    // still not collapse to null — the trailing 8 is recoverable.
    expect(parseKoreanNumber('다시 점수 8')).toBe('8');
  });
});

test.describe('parseKoreanNumber — multiple 점/쩜 must not silently commit a trailing token (Codex HIGH-2)', () => {
  test('"칠십사 점 칠 점 팔" → null (stray trailing fraction)', () => {
    expect(parseKoreanNumber('칠십사 점 칠 점 팔')).toBeNull();
  });
});

test.describe('parseKoreanNumber — arabic decimal whole + spoken fraction (Codex MEDIUM-3)', () => {
  // "33.5 점 칠": whole "33.5" is a non-integer arabic decimal. Combining 33.5 + "." + 7
  // would yield "33.5.7" → parseFloat keeps only 33.5, silently dropping the spoken fraction.
  // Must be null so the caller re-asks rather than commit a wrong number.
  test('"33.5 점 칠" → null (non-integer whole)', () => {
    expect(parseKoreanNumber('33.5 점 칠')).toBeNull();
  });
  // Sanity: a clean arabic INTEGER whole with a spoken fraction still combines.
  test('"33 점 칠" → "33.7" (integer whole + spoken fraction)', () => {
    expect(parseKoreanNumber('33 점 칠')).toBe('33.7');
  });
});

test.describe('parseKoreanNumber — T-1 silent wrong-value commit (digit-bearing discarded token)', () => {
  // Reported bug: STT returned "105시 5.5" (conf 0.96). The per-token last-wins
  // heuristic dropped the unclean leading token "105시" (a digit-bearing token
  // that parses as NEITHER clean arabic NOR spoken-Korean) and silently
  // committed the trailing "5.5" — a wrong measurement with no detection signal.
  // It must now return null so the caller (useVoiceSession handleFinal) logs
  // stt_parse_failed and re-asks.
  test('"105시 5.5" → null (was silently 5.5)', () => {
    expect(parseKoreanNumber('105시 5.5')).toBeNull();
  });
  // No-space sibling: same garbage, no whitespace. The per-token loop is skipped
  // (single token) but the arabicMatches fallback used to do the same last-wins.
  test('"105시5.5" → null (no-space sibling)', () => {
    expect(parseKoreanNumber('105시5.5')).toBeNull();
  });
  // Leading digit-garbage token before a clean spoken value.
  test('"5시 5.5" → null (digit-bearing discarded token + clean tail)', () => {
    expect(parseKoreanNumber('5시 5.5')).toBeNull();
  });
  // Regression: a NON-digit garbage token (no digits) before a clean value must
  // still commit — this is the "당도 점수 8" class and must NOT become null.
  test('"당도 8" → "8" (non-digit garbage token still commits)', () => {
    expect(parseKoreanNumber('당도 8')).toBe('8');
  });
});

test.describe('v0.5.0 W4 (STT-A) — multiple valid numeric tokens must not silently commit', () => {
  // Field log 2026-06-10 (STT-A): "수정 266.7" was recognized as "수정이 166.7";
  // extractModifyValue handed the parser "이 166.7" — two independently-valid numeric
  // tokens — and last-wins silently committed 166.7 (wrong value, no signal).
  // Now ambiguous → null → re-ask, tagged multi_numeric.
  test('"이 166.7" → null (two valid numeric tokens, was silently 166.7)', () => {
    expect(parseKoreanNumber('이 166.7')).toBeNull();
    expect(getLastParseFailReason()).toBe('multi_numeric');
  });
  test('"오 25.5" → null (sino syllable + arabic decimal)', () => {
    expect(parseKoreanNumber('오 25.5')).toBeNull();
    expect(getLastParseFailReason()).toBe('multi_numeric');
  });
  // Boundary doc: pure-arabic utterances with spaces are joined by the TOP fast path
  // (tryArabic strips [,\s] — thousand-separator tolerance, pre-existing since v0.1).
  // They never reach the per-token loop, so W4 does not change this behavior.
  test('"3 5" → "35" (pre-existing arabic fast path, untouched by W4)', () => {
    expect(parseKoreanNumber('3 5')).toBe('35');
  });
  // Legitimate multi-token numerals are consumed by the whole-spoken / decimal recombination
  // paths BEFORE the per-token loop — they must keep parsing.
  test('회귀: "백 이십삼" → "123" (whole-spoken path, not multi_numeric)', () => {
    expect(parseKoreanNumber('백 이십삼')).toBe('123');
  });
  test('회귀: "칠십사 점 칠" → "74.7"', () => {
    expect(parseKoreanNumber('칠십사 점 칠')).toBe('74.7');
  });
  test('회귀: "백이십삼" → "123"', () => {
    expect(parseKoreanNumber('백이십삼')).toBe('123');
  });
  test('회귀: "이십 점 오" → "20.5"', () => {
    expect(parseKoreanNumber('이십 점 오')).toBe('20.5');
  });
  // Single numeric token + non-numeric garbage still commits (the "당도 8" class).
  test('회귀: "당도 8" → "8" (one valid numeric token only)', () => {
    expect(parseKoreanNumber('당도 8')).toBe('8');
  });
});

test.describe('v0.5.0 W5 (STT-B) — "점" 뒤 소수부 유실 시 재질문', () => {
  // Field log 2026-06-10: "111.5" spoken, STT returned "111 점 에" — the fraction syllable
  // got garbled into "에". The fall-through used to commit the bare 111 (decimal silently
  // dropped). Decimal INTENT (integer head + 점 + digit-free tail) must now re-ask.
  test('"111 점 에" → null (was silently 111)', () => {
    expect(parseKoreanNumber('111 점 에')).toBeNull();
    expect(getLastParseFailReason()).toBe('decimal_fraction_lost');
  });
  test('"33 점" → null (trailing 점, fraction never spoken)', () => {
    expect(parseKoreanNumber('33 점')).toBeNull();
  });
  // The literal-word "점" classes must keep falling through (HIGH-1 보존).
  test('폴스루 유지: "점수 8" → "8" (head가 정수가 아님)', () => {
    expect(parseKoreanNumber('점수 8')).toBe('8');
  });
  test('폴스루 유지: "당도 점수 8" → "8"', () => {
    expect(parseKoreanNumber('당도 점수 8')).toBe('8');
  });
  // Genuine decimals through the same branch keep combining.
  test('회귀: "111 점 5" → "111.5"', () => {
    expect(parseKoreanNumber('111 점 5')).toBe('111.5');
  });
  test('회귀: "33 점 칠" → "33.7"', () => {
    expect(parseKoreanNumber('33 점 칠')).toBe('33.7');
  });
});

test.describe('parseKoreanNumber — integer regression guards', () => {
  const cases: Array<[string, string]> = [
    ['칠십사', '74'],
    ['이십', '20'],
    ['삼십오', '35'],
    ['열다섯', '15'],
    ['세', '3'],
    ['33.5', '33.5'],
    ['35.1', '35.1'],
    ['1.5', '1.5'],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => {
      expect(parseKoreanNumber(input)).toBe(expected);
    });
  }
});

test.describe('parseKoreanNumber — maxDecimals rounding', () => {
  test('"칠십사 점 칠칠" rounds to 1 decimal', () => {
    expect(parseKoreanNumber('칠십사 점 칠칠', 1)).toBe('74.8');
  });
});

test.describe('extractModifyValue — 단일 단어 "수정"만 인식', () => {
  test('"수정 178.1" → "178.1"', () => {
    expect(extractModifyValue('수정 178.1')).toBe('178.1');
  });
  // I-1 단일화: 후치 정정도 '수정'으로. 별칭 '정정'은 제거.
  test('"178.1 수정" → "178.1"', () => {
    expect(extractModifyValue('178.1 수정')).toBe('178.1');
  });
  test('"178.1 정정" → null (별칭 제거됨)', () => {
    expect(extractModifyValue('178.1 정정')).toBeNull();
  });
});

test.describe('T-2 — command confidence gate (detection contract the gate relies on)', () => {
  // The gate in useVoiceSession.handleFinal rejects a detected command when
  // `confidence > 0 && confidence < 0.7` (COMMAND_MIN_CONFIDENCE). It only fires
  // when detectCommand() actually returns a command, so the gate's correctness
  // depends on detectCommand recognizing the reported misfires ("수정"/"정정").
  // These assert that contract; the threshold itself is exercised in the hook.
  test('"수정" → modify (the low-conf 0.16 misfire from row 14)', () => {
    expect(detectCommand('수정')).toBe('modify');
  });
  test('"수정해줘" → modify (활용형 꼬리 허용 — startsWith)', () => {
    expect(detectCommand('수정해줘')).toBe('modify');
  });
  // I-1 단일화: 별칭 '정정' 제거 → 더 이상 명령으로 인식되지 않는다.
  test('"정정" → null (별칭 제거됨)', () => {
    expect(detectCommand('정정')).toBeNull();
  });
  // A plain measurement value is NOT a command → the command gate never applies to it,
  // so legitimate low-confidence VALUES still go through the (separate) value gate.
  test('"33.3" → null (not a command, untouched by the command gate)', () => {
    expect(detectCommand('33.3')).toBeNull();
  });
  test('"이백삼십삼" → null (spoken numeral is not a command)', () => {
    expect(detectCommand('이백삼십삼')).toBeNull();
  });
});

test.describe('v0.4.4 — 명령어 통합·리네임 (이전/다음, 스킵·다시 제거)', () => {
  // 행 이동 명령은 '이전행/다음행' → '이전/다음'으로 리네임됨.
  test('"이전" → prevRow', () => {
    expect(detectCommand('이전')).toBe('prevRow');
  });
  test('"다음" → nextRow', () => {
    expect(detectCommand('다음')).toBe('nextRow');
  });
  // 활용형 꼬리 허용(startsWith): "다음행"도 여전히 nextRow로 인식(접두 일치).
  test('"다음행" → nextRow (접두 일치)', () => {
    expect(detectCommand('다음행')).toBe('nextRow');
  });
  test('"이전행" → prevRow (접두 일치)', () => {
    expect(detectCommand('이전행')).toBe('prevRow');
  });
  // 스킵: '다음'으로 통합되어 제거됨 → 더 이상 명령으로 인식되지 않는다.
  test('"스킵" → null (다음으로 통합·제거됨)', () => {
    expect(detectCommand('스킵')).toBeNull();
  });
  // 다시(redo): '수정'으로 통합되어 제거됨.
  test('"다시" → null (수정으로 통합·제거됨)', () => {
    expect(detectCommand('다시')).toBeNull();
  });
  // v0.4.5: "유지"(keep) 신규 — "이전" 재입력 중 현재 값 유지하고 다음 필드로.
  test('"유지" → keep', () => {
    expect(detectCommand('유지')).toBe('keep');
  });
  // 나머지 표준 단어 유지 스팟 체크
  test('표준 단어 유지: 수정/취소/일시정지/재시작/종료', () => {
    expect(detectCommand('수정')).toBe('modify');
    expect(detectCommand('취소')).toBe('cancel');
    expect(detectCommand('일시정지')).toBe('pause');
    expect(detectCommand('재시작')).toBe('resume');
    expect(detectCommand('종료')).toBe('end');
  });
  test('별칭/제거 확인: 지우기/멈춤/계속/마침/스톱/건너 → null', () => {
    expect(detectCommand('지우기')).toBeNull();
    expect(detectCommand('멈춤')).toBeNull();
    expect(detectCommand('계속')).toBeNull();
    expect(detectCommand('마침')).toBeNull();
    expect(detectCommand('스톱')).toBeNull();
    expect(detectCommand('건너')).toBeNull();
  });
});

test.describe('T-3 — ambiguous single-syllable homophone re-confirm', () => {
  // On a measurement column, a lone Sino-Korean syllable that doubles as a common
  // non-number word ("이"=2/조사, "사"=4/死, "오"=5/감탄사, "일"=1) must be re-confirmed
  // regardless of noisyMode (handleFinal gates on isAmbiguousSingleSyllable + single alt).
  const ambiguous = ['이', '일', '사', '오', '구', '영', '공', '삼', '육', '칠', '팔'];
  for (const s of ambiguous) {
    test(`"${s}" → flagged ambiguous`, () => {
      expect(isAmbiguousSingleSyllable(s)).toBe(true);
    });
  }
  // Whitespace/punctuation noise around a lone syllable still flags.
  test('" 이 ." → flagged (noise-stripped single syllable)', () => {
    expect(isAmbiguousSingleSyllable(' 이 .')).toBe(true);
  });
  // MUST NOT flag genuine numerals / non-SINO single tokens — these still commit.
  const safe: Array<[string, string]> = [
    ['이백삼십삼', 'multi-syllable numeral'],
    ['233', 'arabic'],
    ['2', 'arabic single digit'],
    ['세', 'native single digit (not SINO)'],
    ['두', 'native single digit (not SINO)'],
    ['열', 'native ten (not in SINO map)'],
    ['이십', 'two-syllable sino numeral'],
  ];
  for (const [input, why] of safe) {
    test(`"${input}" → NOT flagged (${why})`, () => {
      expect(isAmbiguousSingleSyllable(input)).toBe(false);
    });
  }
  // Regression: the genuine numeral the report warns against breaking must still PARSE.
  test('"이백삼십삼" → "233" (real numeral still parses, not collapsed)', () => {
    expect(parseKoreanNumber('이백삼십삼')).toBe('233');
  });
  // And a lone "이" still PARSES to 2 at the parser level — the re-confirm is a
  // CALLER-side (handleFinal) decision, the parser stays pure/unchanged.
  test('"이" → "2" (parser unchanged; re-confirm is caller-side)', () => {
    expect(parseKoreanNumber('이')).toBe('2');
  });
});
