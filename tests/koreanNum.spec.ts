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
import { parseKoreanNumber, extractRedoValue, extractModifyValue } from '../src/lib/koreanNum';

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

test.describe('extractRedoValue (M1)', () => {
  test('"다시 8.4" → "8.4"', () => {
    expect(extractRedoValue('다시 8.4')).toBe('8.4');
  });
  test('"재입력 20.5" → "20.5"', () => {
    expect(extractRedoValue('재입력 20.5')).toBe('20.5');
  });
  test('"다시 칠십사 점 칠" → "칠십사 점 칠"', () => {
    expect(extractRedoValue('다시 칠십사 점 칠')).toBe('칠십사 점 칠');
  });
  test('"다시" (no value) → null', () => {
    expect(extractRedoValue('다시')).toBeNull();
  });
  test('does not match modify keywords', () => {
    expect(extractRedoValue('수정 8.4')).toBeNull();
  });
});

test.describe('extractModifyValue — unaffected by M1 change', () => {
  test('"수정 178.1" → "178.1"', () => {
    expect(extractModifyValue('수정 178.1')).toBe('178.1');
  });
  test('"178.1 정정" → "178.1"', () => {
    expect(extractModifyValue('178.1 정정')).toBe('178.1');
  });
});
