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
 *  3. 🔴 **실패 사유는 primary 판정의 반환값이다**(v0.43.0 #3-2 B층). 종전엔 koreanNum의
 *     `_lastParseFail*` 모듈 상태를 alts 루프보다 먼저 읽는 **순서 규약**이었는데, 파서를
 *     아예 안 부르는 컬럼층 실패에는 직전 발화의 사유가 실렸다(v0.5.0 W4/W5 · v0.10.0 A1).
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

/** 컬럼 단위 파싱 결과 — 값과 **그 값이 안 나온 이유**를 함께 돌려준다(v0.43.0 #3-2 B층). */
export interface ColParseResult {
  value: string | null;
  /** 실패 사유(기계 판독). 성공이면 null. koreanNum 사유 + 컬럼층 사유 4종. */
  failReason: string | null;
  /** decimal_fraction_lost의 정수부. 그 외엔 null. */
  failWhole: string | null;
}

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
  // v0.5.0 W4/W5: capture the parser's machine-readable fail reason from the PRIMARY
  // transcript (before the alts loop overwrites it) — tags stt_parse_failed below so the
  // next log analysis can split multi_numeric / decimal_fraction_lost re-asks from generic ones.
  // v0.10.0 A1: decimal_fraction_lost 시 파싱된 정수부도 함께 — 타깃 재질문에 쓴다.
  // 🔴 v0.43.0 #3-2 B층 — 사유를 **반환값**으로 받는다. 종전엔 `getLastParseFail*()`(모듈 상태)를
  //   읽어서, 파서를 안 부르는 컬럼층 실패(int 소수 거절 등)에 **직전 발화의 사유가 실렸다.**
  //   반환값은 alts 루프가 덮어쓸 수 없으므로 "PRIMARY 직후에 캡처" 규약이 구조로 보장된다.
  let failReason: string | null = null;
  let failWhole: string | null = null;
  if (parsed === null) {
    const primary = parseValueForColWithReason(col, text);
    parsed = primary.value;
    if (parsed === null) {
      failReason = primary.failReason;
      failWhole = primary.failWhole;
    }
  }
  if (parsed === null && alts.length > 1) {
    for (let ai = 1; ai < Math.min(alts.length, 3); ai++) {
      const alt = alts[ai];
      if (!alt || alt === text) continue;
      // primary가 독립 숫자 복수/무관 토큰을 잡았다면 alternative의 숫자만 골라 커밋하지 않는다.
      // `현백 33.3`→alt `33.3`, `이 166.7`→alt `166.7`은 STT가 잃은 자리값/숫자 의미를
      // 복구한 것이 아니라 위험 신호를 삭제한 후보이므로 전체 발화를 다시 받는 것이 유일하게 안전하다.
      // 🔴 v0.43.0 #3-2 — `int_decimal_rejected`가 같은 급으로 합류한다. int 컬럼에 소수를
      //   말했을 때 **수용 가능한 alt는 존재하지 않는다**: 소수 없는 alt(`33.3`→`33`)는 사용자가
      //   말한 소수부를 버린 침묵 오커밋이고(O3와 동형), 소수를 담은 alt는 컬럼 타입이 어차피
      //   거절한다. 종전엔 이 경로의 사유가 잔류값이라 스킵 여부가 **직전 발화에 따라 갈렸다**
      //   (07-31 실측: 사유가 비어 있으면 `33`이 커밋됐다). 재질문으로 결정론화한다.
      if (failReason === 'multi_numeric' || failReason === 'extraneous_token'
        || failReason === 'int_decimal_rejected') continue;
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
        // 🔴 v0.49 P-3(민구 확정 2026-08-12) — [STT-15] 「전체값 폴백 금지」를 **좁힌다.**
        //   원 결정(07-13)이 막으려던 것은 **조각** alt다: primary "하악"(숫자 없음) + alt "하나"가
        //   fractionWhole=211 문맥을 모른 채 **전체값 "1"로 커밋**된 사건. 그 방어는 그대로 산다
        //   — 아래 3조건이 조각을 통과시키지 않는다.
        //   좁히는 이유(08-12 실측 #8827, 09:54:27 row16 횡경): primary `311 점 의`
        //   (decimal_fraction_lost, whole=311)인데 alt `311 .1`이 **정답 311.1로 파싱되는데도**
        //   버려져 3차 재질문으로 갔다(재질문 1회 · 7.4초). 그건 조각이 아니라 **사용자가 전체값을
        //   다시 말한 것**이고, primary 자신이 같은 정수부로 소수 의도를 확인해 준 경우다.
        //   문맥 **밖**에서는 같은 alt를 O3 규칙(:아래 144-152)이 이미 수용한다 — 소수부 재질문
        //   문맥에서만 O3가 꺼져 있던 비대칭을 닫는 것이다.
        //   🔴 **3조건 동시 충족일 때만**이다(민구가 고른 선택지가 이 3조건 — 넓히지 마라):
        //    ① primary 사유가 `decimal_fraction_lost` — 사용자가 '점'을 발음해 **소수 의도가 확인**됐다
        //    ② alt의 **파싱값**이 소수점을 명시적으로 포함 — 조각(단자리·정수)은 여기서 탈락
        //    ③ 그 정수부가 primary의 `failWhole`과 **일치** — 두 가설이 정수부에 합의했다는 뜻이라
        //       alt는 "primary가 잃은 소수부를 복구한 후보"이지 다른 값이 아니다
        //   🔴 **전제 조건(민구 08-12 원문): "인식된 값을 TTS 안내로 되돌려 주는것만 잘 유지해주면
        //      될 거 같아. 사용자가 인식값을 귀로 듣고 잘못 되었다면 수정 명령을 진행할거니깐."**
        //      이 경로의 값도 일반 커밋과 **같은 echo TTS**를 탄다(호출자 handleFinal 공통 경로 —
        //      여기서 하는 일은 `parsed`를 채우는 것뿐이라 이후 흐름이 갈리지 않는다).
        //      오라클: `tests/decimal-targeted-reask.spec.ts`의 [STT-15 좁힘] 케이스가 **echo 발화
        //      자체를 단언**한다. 값 수용만 되고 echo가 없으면 그건 계약 위반이다.
        //   로그: 일반 alt 수용과 **같은 형태**(`stt_alt_used`, extra 없음)로 남긴다 — SOP-003
        //      바이트 계약에 새 패턴을 추가하지 않는다.
        if (failReason === 'decimal_fraction_lost' && failWhole != null) {
          const altFull = col ? parseValueForCol(col, alt) : null;
          if (altFull !== null && altFull.includes('.') && altFull.split('.')[0] === failWhole) {
            parsed = altFull;
            events.push({ kind: 'alt_used', altIdx: ai, text: alt, originalText: text });
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

/**
 * 🔴 **v0.43.0 #3-2 B층 — 컬럼층 실패에도 사유를 붙인다**(plan §2-6).
 *
 * 종전에 호출자는 실패 사유를 koreanNum의 **모듈 상태**(`getLastParseFail*`)에서 읽었다.
 * 그런데 아래 4경로는 `parseKoreanNumber`를 **아예 부르지 않는다** — options 미매칭 ·
 * text/date 공백 · int 컬럼의 소수 거절 · col=null. 그 상태는 리셋되지 않으므로
 * **직전 발화의 사유가 그대로 실렸다.** 07-31 실측:
 *
 *   int 컬럼 + `"33.3"` + alts `["33.3","33"]`
 *     · 직전 사유가 `extraneous_token`으로 남아 있으면 → alts 스킵 → 재질문(정상)
 *     · 직전 사유가 비어 있으면            → alts 폴백 → **`33`이 커밋된다**
 *
 * 같은 발화의 결과가 **직전 발화 이력에 따라 갈렸다.** 사용자가 `33.3`이라 말했는데 소수부를
 * 버린 `33`이 시트에 올라가는 경로다 — O3·[STT-15]·W5가 반복해 막아온 침묵 오커밋 클래스가
 * 우연에 기대 막히고 있었다. 사유를 **반환값**으로 바꿔 모듈 상태 의존을 끊고, 결정론적으로
 * **재질문 쪽으로** 고정한다(아래 `int_decimal_rejected` 스킵 규칙).
 *
 * 컬럼층 사유 4종:
 *  - 'no_column'            — 컬럼을 못 찾았다(값 경로가 아니거나 스키마 불일치)
 *  - 'option_no_match'      — options 허용 목록에 없다. alts는 계속 돈다(STT 변형 복구가 정당)
 *  - 'empty_text'           — text/name/date가 트림 후 비었다. alts는 계속 돈다
 *  - 'int_decimal_rejected' — int 컬럼에 소수를 말했다. 🔴 **alts를 전부 건너뛴다**
 */
export function parseValueForColWithReason(col: Column | null, raw: string): ColParseResult {
  if (!col) return { value: null, failReason: 'no_column', failWhole: null };
  if (col.type === 'options' && col.auto.kind === 'options') {
    const v = matchOption(raw, col.auto.selected.length ? col.auto.selected : col.auto.available);
    return { value: v, failReason: v === null ? 'option_no_match' : null, failWhole: null };
  }
  if (col.type === 'text' || col.type === 'name') {
    const t = raw.trim();
    return { value: t || null, failReason: t ? null : 'empty_text', failWhole: null };
  }
  if (col.type === 'date') {
    const m = raw.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) {
      const [, y, mo, d] = m;
      return { value: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, failReason: null, failWhole: null };
    }
    const t = raw.trim();
    return { value: t || null, failReason: t ? null : 'empty_text', failWhole: null };
  }
  // int: strict — reject if the user pronounced a decimal
  if (col.type === 'int') {
    // 🔑 파서를 부르지 않는 유일한 숫자 경로다 — 사유를 여기서 직접 만들지 않으면 잔류값이 실린다.
    if (/[점쩜.]/.test(raw)) return { value: null, failReason: 'int_decimal_rejected', failWhole: null };
    return colParseFromParser(parseKoreanNumber(raw, 0));
  }
  // float
  const decimals = col.decimals ?? 1;
  return colParseFromParser(parseKoreanNumber(raw, decimals));
}

/** 파서 호출 **직후** 모듈 상태를 읽어 반환값으로 굳힌다 — 잔류 창(window)을 없앤다. */
function colParseFromParser(value: string | null): ColParseResult {
  if (value !== null) return { value, failReason: null, failWhole: null };
  return { value: null, failReason: getLastParseFailReason(), failWhole: getLastParseFailWhole() };
}

/** 값만 필요한 호출자를 위한 얇은 래퍼(계약 불변). 사유가 필요하면 위 WithReason을 써라. */
export function parseValueForCol(col: Column, raw: string): string | null {
  return parseValueForColWithReason(col, raw).value;
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
