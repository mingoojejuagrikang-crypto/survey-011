/**
 * v0.43.0 #3 — 값 발화 파싱 **시도**(순수). handleFinal의 값 경로에서 "이 발화가 이 컬럼의
 * 값으로 파싱되는가"만 판정한다. `voiceFinalResolver`(결정표)와 같은 계보다 — 부수효과 없음,
 * 실행(로그 방출·ref 갱신·재질문 TTS)은 전부 `useVoiceSession.handleFinal`이 담당한다.
 *
 * 🔴 **왜 순수여야 하는가 — 이게 이 모듈의 존재 이유다.**
 *   v0.43.0 #3이 신뢰도 게이트와 파서의 **순서를 뒤집는다**(파싱 먼저, 게이트는 파싱 실패
 *   시에만). 그러면 파싱이 **거절될 발화에도 실행**되므로, 종전처럼 파싱 도중 상태를 만지면
 *   거절 경로가 오염된다. 구체적으로 종전 `:1785`의
 *   `awaitingFieldRef.current = {...awaiting, fractionWhole: undefined}`(소수부 문맥 해제)는
 *   저신뢰 거절 경로에서 **실행된 적이 없었다** — 게이트가 그 앞에서 return했기 때문이다.
 *   그대로 앞으로 옮기면 "소수부 재질문 중 저신뢰 응답"에서 정수부 문맥이 사라져
 *   다음 발화가 전체값으로 처리된다 — v0.33.0 [STT-15]가 고친 바로 그 회귀다.
 *   → **시도는 아무것도 바꾸지 않는다.** 호출자가 게이트 판단을 마친 뒤에만 부수효과를 적용한다.
 *
 * 판정 순서(종전 handleFinal 인라인 코드 순서 그대로 — 순서가 곧 계약):
 *  1. 소수부 재질문 문맥(fractionWhole)이면 한 자리 소수부 합성을 먼저 시도.
 *  2. 실패 시 primary transcript 통상 파싱.
 *  3. 🔴 **실패 사유는 여기서 캡처한다** — alts 루프의 parseValueForCol이 koreanNum의
 *     `_lastParseFail*` 모듈 상태를 덮어쓰기 전에(v0.5.0 W4/W5 · v0.10.0 A1).
 *  4. 여전히 실패면 alts 폴백(최대 2건). 위험 신호 삭제형 alt는 사유별로 건너뛴다.
 *
 * 특성화: tests/valueParseAttempt.spec.ts (순수 함수 — 브라우저 없이 Node에서 돈다).
 */
import {
  parseKoreanNumber,
  isBareResponseWord,
  getLastParseFailReason,
  getLastParseFailWhole,
} from './koreanNum';
import type { Column } from '../types';

/** 호출자가 **파싱 성공 시에만** 방출하는 지연 로그. 순서 그대로 방출한다(바이트 계약 보존). */
export type ParseAttemptEvent =
  /** logCell({type:'stt', extra:'decimal_fraction_recovered', text, originalText}) */
  | { kind: 'decimal_fraction_recovered'; text: string; originalText: string }
  /** logCell({type:'stt_alt_used', altIdx, text, originalText, extra?}) */
  | { kind: 'alt_used'; altIdx: number; text: string; originalText: string; extra?: string };

export interface ParseAttemptResult {
  /** 커밋 가능한 정규화 값. null이면 파싱 실패. */
  parsed: string | null;
  /** 파싱 실패 사유(koreanNum 기계 판독형). 성공이면 null. */
  failReason: string | null;
  /** decimal_fraction_lost 시 파싱된 정수부. 성공이면 null. */
  failWhole: string | null;
  /** 성공 시 호출자가 방출할 로그(순서 보존). 실패면 빈 배열. */
  events: ParseAttemptEvent[];
}

export function attemptParseValue(input: {
  col: Column | null;
  text: string;
  alts: string[];
  /** 소수부 재질문 문맥의 정수부. 문맥이 없으면 null. */
  fractionWhole: string | null;
}): ParseAttemptResult {
  const { col, text, alts, fractionWhole } = input;
  const events: ParseAttemptEvent[] = [];
  let parsed: string | null = null;

  // v0.10.0 A1 타깃 재질문 후속: 소수부만 기다리는 중이면(직전 발화가 decimal_fraction_lost) 이번
  // 발화를 소수부로 합성 시도. 합성 실패 시 아래 평소 파싱이 전체 발화로 처리하므로,
  // 사용자가 "111.5" 전체를 다시 말한 경우도 그대로 커밋된다.
  if (fractionWhole != null && col) {
    const frac = parseKoreanNumber(text);
    // 소수 한 자리(0~9)만 말한 경우에만 정수부와 합성. 2자리 이상·소수점 포함은 전체 값을 다시
    // 말한 것으로 보고 합성하지 않는다(아래 평소 파싱이 처리).
    if (frac !== null && /^[0-9]$/.test(frac)) {
      parsed = parseValueForCol(col, `${fractionWhole}.${frac}`);
      if (parsed !== null) {
        events.push({ kind: 'decimal_fraction_recovered', text: `${fractionWhole}.${frac}`, originalText: text });
      }
    }
  }
  if (parsed === null) {
    parsed = col ? parseValueForCol(col, text) : null;
  }
  // v0.5.0 W4/W5: capture the parser's machine-readable fail reason from the PRIMARY
  // transcript (before the alts loop overwrites it) — tags stt_parse_failed below so the
  // next log analysis can split multi_numeric / decimal_fraction_lost re-asks from generic ones.
  const failReason = parsed === null ? getLastParseFailReason() : null;
  // v0.10.0 A1: decimal_fraction_lost 시 파싱된 정수부 — 타깃 재질문에 쓴다(PRIMARY 직후 캡처;
  // alts 루프의 parseValueForCol이 _lastParseFailWhole을 덮어쓰기 전에).
  const failWhole = parsed === null ? getLastParseFailWhole() : null;
  if (parsed === null && alts.length > 1) {
    for (let ai = 1; ai < Math.min(alts.length, 3); ai++) {
      const alt = alts[ai];
      if (!alt || alt === text) continue;
      // primary가 독립 숫자 복수/무관 토큰을 잡았다면 alternative의 숫자만 골라 커밋하지 않는다.
      // `현백 33.3`→alt `33.3`, `이 166.7`→alt `166.7`은 STT가 잃은 자리값/숫자 의미를
      // 복구한 것이 아니라 위험 신호를 삭제한 후보이므로 전체 발화를 다시 받는 것이 유일하게 안전하다.
      if (failReason === 'multi_numeric' || failReason === 'extraneous_token') continue;
      // v0.34.0 O2 [STT-17] — 응답어 alt 차단: primary가 응답어면 위 가드가 이미 재질문했지만,
      // primary가 다른 잡음("예에" 등)이고 **alt가 "네"**면 native 4로 커밋되는 07-14 실사례
      // 경로가 남는다. 숫자 컬럼에선 응답어 alt를 건너뛴다(text/options는 "네"가 정당한 값일
      // 수 있어 제외 — primary 가드와 동일 스코프).
      if (col && (col.type === 'int' || col.type === 'float') && isBareResponseWord(alt)) continue;
      // v0.33.0 [STT-15] — 소수부 재질문 문맥에서는 alt도 **소수부 파서(정수부 합성)로만** 해석한다.
      // 07-13 실기기: "211 점 의" 재질문 → primary "하악" 파싱 실패 → alts 루프가 "하나"를
      // fractionWhole=211 문맥을 모른 채 **전체값 "1"로 커밋**(무알람 시트 동기화). 조각(단자리)은
      // 정수부와 합성해 복구하고, 합성 불가 alt는 건너뛴다 — 전체값 폴백 금지("값 추측/조용한
      // 오커밋 방지" 민구 결정을 alts 경로에도 동일 적용).
      if (fractionWhole != null) {
        const altFrac = parseKoreanNumber(alt);
        if (altFrac !== null && /^[0-9]$/.test(altFrac)) {
          const composed = col ? parseValueForCol(col, `${fractionWhole}.${altFrac}`) : null;
          if (composed !== null) {
            parsed = composed;
            events.push({ kind: 'alt_used', altIdx: ai, text: alt, originalText: text, extra: `frac_ctx:${fractionWhole}` });
            events.push({ kind: 'decimal_fraction_recovered', text: `${fractionWhole}.${altFrac}`, originalText: alt });
            break;
          }
        }
        continue;
      }
      // v0.34.0 O3 — 소수 의도 보존: primary가 decimal_fraction_lost("266 점요" — 소수 의도인데
      // 소수부 유실 → 타깃 재질문 예정)인데 alt가 **정수**("266")면, alt 폴백이 소수 의도를 버린
      // 침묵 커밋이 된다(07-14 09:25:49 실사례 — 사전은 이미 점요를 잡지만 alt가 우회). 정수 alt는
      // 건너뛰어 아래 타깃 재질문으로 넘기고, 소수를 온전히 담은 alt("266.2")만 수용한다.
      if (failReason === 'decimal_fraction_lost' && !alt.includes('.') && !/[점쩜]/.test(alt)) continue;
      const altParsed = col ? parseValueForCol(col, alt) : null;
      if (altParsed !== null) {
        // (O3 방어 2선) 정수로 파싱된 alt도 동일 사유로 거부 — "266 점" 류 alt가 정수로 환원되는 경우.
        if (failReason === 'decimal_fraction_lost' && !altParsed.includes('.')) continue;
        parsed = altParsed;
        events.push({ kind: 'alt_used', altIdx: ai, text: alt, originalText: text });
        break;
      }
    }
  }

  return { parsed, failReason, failWhole, events: parsed === null ? [] : events };
}

export function parseValueForCol(col: Column, raw: string): string | null {
  if (col.type === 'options' && col.auto.kind === 'options') {
    return matchOption(raw, col.auto.selected.length ? col.auto.selected : col.auto.available);
  }
  if (col.type === 'text' || col.type === 'name') {
    const t = raw.trim();
    return t || null;
  }
  if (col.type === 'date') {
    const m = raw.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) {
      const [, y, mo, d] = m;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return raw.trim() || null;
  }
  // int: strict — reject if the user pronounced a decimal
  if (col.type === 'int') {
    if (/[점쩜.]/.test(raw)) return null;
    return parseKoreanNumber(raw, 0);
  }
  // float
  const decimals = col.decimals ?? 1;
  return parseKoreanNumber(raw, decimals);
}

function matchOption(text: string, allowed: string[]): string | null {
  if (allowed.length === 0) return null;
  const norm = text.trim().toLowerCase().replace(/\s+/g, '');
  for (const v of allowed) {
    if (v.toLowerCase().replace(/\s+/g, '') === norm) return v;
  }
  for (const v of allowed) {
    const vn = v.toLowerCase().replace(/\s+/g, '');
    if (norm.includes(vn) || vn.includes(norm)) return v;
  }
  return null;
}
