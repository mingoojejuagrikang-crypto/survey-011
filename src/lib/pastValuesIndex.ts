/**
 * v0.7.0 — 과거 조사값 인덱스의 **순수 로직** (B3 조회 탭 · B4 추세 검증 공용).
 *
 * [ENV-12] 2026-08-15 — `pastValues.ts`에서 분리했다. 경계는 **브라우저 경계**다:
 * 여기에는 fetch·캐시·IDB가 한 줄도 없고(audioTrim.ts와 같은 패턴), 키 구성·날짜 정규화·
 * 인덱스 빌드·회차 조회만 산다. 그래서 Node 단위 테스트가 그대로 잰다
 * (`tests/pastValues.spec.ts` · `tests/v049-prev-survey.spec.ts` 등).
 * 영속 직렬화는 한 겹 더 갈라 `pastValuesPersist.ts`에 있고, fetch + 모듈 캐시는
 * `pastValues.ts`에 남았다.
 *
 * 데이터 모델:
 *  - 샘플키 = 샘플키 플래그 컬럼(columnFlags.effectiveSampleKey) 값들의 trim-join(KEY_SEP).
 *    키 값 중 하나라도 비면 null → 호출자는 조용히 skip(키 불완전 행은 비교 불가).
 *  - 회차(round) = 조사시기 컬럼(settings.roundDateColId, 기본: 첫 date 컬럼·'조사일자' 우선)
 *    값을 ISO 'YYYY-MM-DD'로 정규화한 것. 정규화 불가 행은 skip.
 *  - (키, 회차) 중복은 **마지막 행 승리** + duplicateCount 집계(조회 탭 중복 배지).
 *  - previousRound는 기준일 **미만(strictly <)** — 당일 부분 업로드가 자기 자신의 기준선이
 *    되지 않게 한다.
 *  - 헤더 매핑은 시트 헤더(trim)와 Column.name(trim)의 **정확 일치**. 미매핑 앱 컬럼은
 *    unmappedColumns로 노출(조회 탭 경고 배너). 미매핑 컬럼이 샘플키면 시트 쪽 키가 전부
 *    불완전해져 samples가 비게 된다 — 배너가 원인을 설명한다.
 *
 * ⚠️ import 방향은 **단방향**이다 — 이 파일은 `pastValues.ts`를 import하지 않는다
 * (`[LOGEVENTS-CYCLE-1]` 형태의 배럴 순환 금지).
 */
import type { Column } from '../types';
import { autoValue, isDynamicTodayColumn, isRowInvariantAuto } from './autoValue';
import { effectiveSampleKey } from './columnFlags';

/** 샘플키 조각을 잇는 구분자. */
export const KEY_SEP = ' ';

/** 샘플 식별 키로 쓰이는 컬럼들(사용자 토글 우선, 없으면 자동 유추). 컬럼 순서 유지. */
export function keyColumns(columns: Column[]): Column[] {
  return columns.filter((c) => effectiveSampleKey(c));
}

/**
 * colId→값 레코드에서 샘플키 문자열을 만든다.
 * 키 컬럼 값 중 하나라도 비어 있으면(트림 후) null — 불완전한 키로 잘못 매칭하지 않는다.
 * 키 컬럼이 0개여도 null(기능 비활성 케이스).
 */
export function buildSampleKey(
  keyCols: Column[],
  values: Record<string, string | undefined>,
): string | null {
  if (keyCols.length === 0) return null;
  const parts: string[] = [];
  for (const c of keyCols) {
    const v = (values[c.id] ?? '').trim();
    if (!v) return null;
    parts.push(v);
  }
  return parts.join(KEY_SEP);
}

/**
 * 조사시기(회차) 컬럼 해석: 명시 id가 있고 존재하면 그 컬럼, 아니면 date 타입 중
 * 이름이 '조사일자'인 컬럼 우선, 없으면 첫 date 컬럼. date 컬럼이 없으면 null.
 */
export function resolveRoundCol(columns: Column[], roundDateColId: string | null): Column | null {
  if (roundDateColId) {
    const explicit = columns.find((c) => c.id === roundDateColId);
    if (explicit) return explicit;
  }
  const dates = columns.filter((c) => c.type === 'date');
  return dates.find((c) => c.name.trim() === '조사일자') ?? dates[0] ?? null;
}

/**
 * 시트 날짜 셀을 ISO 'YYYY-MM-DD'로 정규화. 지원 포맷:
 *  - '2026-05-13' / '2026-5-3' (ISO·하이픈)
 *  - '2026. 5. 13' / '2026.5.13.' (한국식 점 표기, 말미 점 허용)
 *  - '2026/05/13' (연 우선 슬래시)
 *  - '5/13/2026' (Sheets 미국식 M/D/YYYY)
 * 파싱 불가·범위 밖(월 1–12, 일 1–31)은 null.
 */
export function normalizeDateCell(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let y = 0;
  let m = 0;
  let d = 0;
  // 연 우선: 2026-05-13 / 2026. 5. 13(.) / 2026/5/13
  let mt = s.match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?$/);
  if (mt) {
    y = +mt[1]; m = +mt[2]; d = +mt[3];
  } else {
    // 미국식: M/D/YYYY
    mt = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!mt) return null;
    m = +mt[1]; d = +mt[2]; y = +mt[3];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export interface PastIndex {
  /** colId → 0-based 시트 컬럼 인덱스 (시트 헤더 trim명 ↔ Column.name trim명 정확 일치). */
  headersMapped: Map<string, number>;
  /** 시트 헤더에서 찾지 못한 앱 컬럼명 — 조회 탭 경고 배너용. */
  unmappedColumns: string[];
  /** 인덱스에 존재하는 회차(정규화 ISO 날짜), 오름차순. */
  rounds: string[];
  /** 샘플키 → (회차 → colId→값 레코드). (키,회차) 중복은 마지막 행 승리. */
  samples: Map<string, Map<string, Record<string, string>>>;
  /** (키,회차) 충돌 횟수 — 조회 탭 중복 배지. */
  duplicateCount: number;
  /** 헤더 제외 데이터 행 수(스킵된 행 포함). */
  rowCount: number;
  /** 🔴 v0.49 r4 M8(claude r3 #11) — **회차 셀이 실제로 파싱된 행 수**(샘플키 성공 여부와 무관).
   *  `rounds`와 갈리는 이유: 아래 루프는 샘플키가 없는 행을 회차 집계 **전에** 버리므로,
   *  키가 전량 탈락하면 회차 축은 멀쩡한데 `rounds`가 빈다 — `previousSurveyRound`가 그걸
   *  `round_unindexed`(회차를 못 읽었다)로 **오진**했다. 두 원인을 가르는 유일한 근거다.
   *  ⚠️ `rounds`의 의미는 건드리지 않는다 — 조회탭의 `recentTwoRounds`가 「샘플 데이터가 있는
   *  회차」로 읽는다(키 탈락 행의 회차를 섞으면 값이 전부 '—'인 회차가 화면에 선다). */
  roundParsedRows: number;
}

/** 시트 전체 행에서 과거값 인덱스를 빌드한다. roundCol이 null이면 회차 구분 불가 → samples 빈 인덱스. */
export function buildPastIndex(
  headers: string[],
  rows: string[][],
  columns: Column[],
  roundCol: Column | null,
): PastIndex {
  // 시트 헤더명(trim) → 인덱스. 중복 헤더는 첫 번째 승리.
  const headerIdx = new Map<string, number>();
  headers.forEach((h, i) => {
    const t = (h ?? '').toString().trim();
    if (t && !headerIdx.has(t)) headerIdx.set(t, i);
  });

  const headersMapped = new Map<string, number>();
  const unmappedColumns: string[] = [];
  for (const c of columns) {
    const i = headerIdx.get(c.name.trim());
    if (i === undefined) unmappedColumns.push(c.name);
    else headersMapped.set(c.id, i);
  }

  const keyCols = keyColumns(columns);
  const samples = new Map<string, Map<string, Record<string, string>>>();
  const roundsSet = new Set<string>();
  let duplicateCount = 0;

  let roundParsedRows = 0;
  for (const row of rows) {
    const rec: Record<string, string> = {};
    for (const [colId, idx] of headersMapped) {
      rec[colId] = (row[idx] ?? '').toString();
    }
    // 🔴 v0.49 r4 M8(#11) — **회차 파싱을 키 탈락보다 먼저 센다.** 순서 자체는 그대로 두되
    //   (`rounds`·`samples`의 의미 불변), 「회차 축은 읽혔는가」를 독립으로 부기한다.
    //   종전엔 이 두 사건이 구분 없이 같은 증상(`rounds` 0개)으로 합쳐졌다.
    const round = roundCol ? normalizeDateCell(rec[roundCol.id]) : null;
    if (round) roundParsedRows++;
    // 키 컬럼이 미매핑이면 rec에 값이 없어 키가 null → 행 skip (unmappedColumns가 원인 설명).
    const key = buildSampleKey(keyCols, rec);
    if (!key) continue;
    if (!round) continue;
    roundsSet.add(round);
    let byRound = samples.get(key);
    if (!byRound) {
      byRound = new Map();
      samples.set(key, byRound);
    }
    if (byRound.has(round)) duplicateCount++;
    byRound.set(round, rec); // 마지막 행 승리
  }

  return {
    headersMapped,
    unmappedColumns,
    rounds: [...roundsSet].sort(),
    samples,
    duplicateCount,
    rowCount: rows.length,
    roundParsedRows,
  };
}

/**
 * 해당 샘플의 직전 회차: beforeDate(ISO) **미만(strictly)** 중 가장 늦은 회차.
 * 당일 부분 업로드가 자기 기준선이 되지 않는 것이 핵심 — 같은 날짜는 제외된다.
 */
export function previousRound(index: PastIndex, key: string, beforeDate: string): string | null {
  const byRound = index.samples.get(key);
  if (!byRound) return null;
  let best: string | null = null;
  for (const r of byRound.keys()) {
    if (r < beforeDate && (best === null || r > best)) best = r;
  }
  return best;
}

/**
 * v0.49.0 W3 — 「세션 고정 샘플키 컬럼」: 이 세션의 **모든 행에서 값이 같은** 샘플키 컬럼들.
 *
 * 민구 확정(08-13, FB-3): 조사 전에 알아야 하는 "이전 조사일"의 기준은 세션 전체에 공통 고정된
 * 샘플키 항목 조합이다 — *"해당 세션의 모든 데이터에서 공통적으로 사용되는 항목들의 조합.
 * 지금의 경우는 '농가명'+'라벨'."* 🔴 **컬럼 이름을 하드코딩하지 않는다**(시트 스키마 불특정이
 * 계약, 민구 08-05) — 「농가명」「라벨」은 현 스키마의 예시일 뿐이고 여기엔 규칙만 남긴다.
 *
 * 판정(전부 만족해야 고정 키):
 *  - `input === 'auto'` — **테이블 골격을 만드는 주체는 자동 입력 컬럼뿐이다**(민구 확정 08-06,
 *    autoValue.ts 주석). voice·touch 컬럼은 사람이 행마다 채우므로 세션 상수가 아니다. 사용자가
 *    측정 컬럼을 샘플키로 토글해 두어도(그리고 미사용 `auto.value` 잔재가 남아 있어도) 그 값으로
 *    과거 행을 대조하면 시트의 실제 기록과 어긋난다 — 여기서 먼저 잘라낸다.
 *  - `effectiveSampleKey` — 샘플 식별 키의 일부다(columnFlags가 SSOT: 사용자 토글 > 자동 유추).
 *  - `isRowInvariantAuto` — 행마다 값이 바뀌지 않는다(autoValue의 `spanOf`가 SSOT).
 *    🔴 v0.49 r2 A7(합집합 C7) — 종전엔 `!isCycling`이었다. 그러면 `seq from===to`(나무 한
 *    그루짜리 세션 — 자릿수 1이라 **모든 행에서 값이 같다**)가 고정 키에서 빠져, 그 컬럼이
 *    유일한 샘플키인 스키마는 고정 키 0개가 되어 조회 자체를 포기했다. 판정 질문은 「순환
 *    컬럼인가」가 아니라 「값이 변하는가」다.
 *  - **조사시기 컬럼이 아니다** — 회차(시간축)이지 샘플 식별축이 아니다. 이 컬럼이 대조 키에
 *    섞이면 "직전 회차"는 정의상 오늘과 다른 날짜라 영영 일치하지 않는다.
 *  - `!isDynamicTodayColumn` — 🔴 v0.49 r2 A8(합집합 C12): 회차로 **뽑히지 못한** 두 번째 date
 *    컬럼(스키마 변경의 유물)도 값이 「오늘」로 치환되므로 같은 이유로 영영 일치하지 않는다.
 *    위 회차 배제는 컬럼 **하나**만 빼므로 유물이 남는다. 타입이 아니라 **값의 동적성**으로
 *    가른다(리터럴 고정일 = 정식일자 같은 컬럼은 정당한 식별 키다 — `isDynamicTodayColumn` 주석).
 *  - `autoValue(col, 1)`이 비어 있지 않다 — 값이 없으면 대조 기준이 못 된다(빈 fixed 등).
 *
 * 빈 배열 = 세션을 특정할 고정 키가 없다 → 호출자는 조회를 포기한다.
 */
export function sessionFixedKeyColumns(columns: Column[], roundDateColId: string | null): Column[] {
  const roundCol = resolveRoundCol(columns, roundDateColId);
  return columns.filter(
    (c) =>
      c.input === 'auto' &&
      effectiveSampleKey(c) &&
      isRowInvariantAuto(c) &&
      c.id !== roundCol?.id &&
      !isDynamicTodayColumn(c) &&
      autoValue(c, 1).trim() !== '',
  );
}

/**
 * v0.49.0 W3 — 세션 고정 키와 일치하는 과거 행들 중 **기준일 미만(strictly <)** 최신 회차.
 *
 * `previousRound`가 "샘플 한 개"의 직전 회차라면, 이쪽은 "이 세션이 다룰 샘플들 전체"의 직전
 * 조사일이다 — 설정요약은 조사를 **시작하기 전에** 보는 화면이라 아직 행(샘플)이 특정되지 않았다.
 *
 * 🔴 대조는 **컬럼(colId) 단위**다 — 샘플키 join 문자열의 prefix 매칭이 아니다. 키 컬럼 순서는
 * 스키마마다 다르고, `KEY_SEP`이 공백이라 값 자체에 공백이 있으면(예: 농가명 `강 남호`)
 * join 문자열을 split하는 순간 조각 경계가 어긋난다. `buildPastIndex`가 각 (키,회차)에
 * colId→값 레코드를 그대로 보관하므로 그 레코드를 직접 본다.
 *
 * strictly-< 는 `previousRound`(그리고 그것을 쓰는 `trendEvaluate`)와 같은 규칙 — 오늘 당일
 * 부분 업로드가 자기 자신의 기준선이 되지 않게 한다.
 */
export type PrevSurveyRound =
  | { kind: 'date'; iso: string }
  /** 조회는 성립했고, 일치하는 과거 기록이 0건이다. */
  | { kind: 'none' }
  /** 조회 자체가 성립하지 않는다 — 「기록이 없다」가 **아니다**.
   *  🔴 v0.49 r3 #3 — 사유 3종(`round_*`)이 **시간축** 붕괴다. A5가 샘플 식별축만 갈라놓아
   *  그 절반이 그대로 '기록 없음'으로 샜다(아래 `previousSurveyRound` 가드 주석). */
  | {
      kind: 'unqueryable';
      reason: 'no_fixed_key' | 'headers_unmapped' | 'no_round_col' | 'round_unmapped'
        | 'round_unindexed'
        /** 🔴 v0.49 r4 M8(#11) — 회차는 읽혔는데 **샘플키가 붙은 행이 0줄**이다(키 컬럼이
         *  전량 공백 등). 종전엔 `round_unindexed`로 오진돼 다음 회차의 조사 방향이 시간축
         *  수리로 갔다 — 실제로 고쳐야 하는 것은 샘플키 축이다. */
        | 'no_keyed_rows';
    };

/** 🔴 v0.49 r4 M9 — 수치 2차 대조를 허용하는 **엄격한** 십진 형태. 지수(`1e3`)·16진(`0x10`)·
 *  천단위 구분(`1,000`)·`Infinity`는 일부러 제외한다: 「같은 수의 다른 표기」를 넓히려는 것이지
 *  파서를 넓히려는 것이 아니다. 넓힐수록 **다른 샘플이 같은 키로 붙는** 위험이 커진다. */
const STRICT_DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

/**
 * 🔴 v0.49 r5 Z10(codex R4-F5) — **손실 없는 십진 정규화.** `Number()` 대조를 대체한다.
 *
 * M9의 마지막 줄이 `Number(raw) === Number(want)`였다. IEEE-754를 그대로 받으므로 **서로 다른
 * 표본 키가 같은 것으로 붙는다**(실측 3쌍):
 *   · `9007199254740992` ↔ `9007199254740993`      (2^53 위 — 두 정수가 같은 double)
 *   · `0.10000000000000000` ↔ `0.10000000000000001` (배정밀도 유효자릿수 초과)
 *   · 서로 다른 310자리 정수 둘                      (양쪽 `Infinity`)
 * 지수·16진을 막은 `STRICT_DECIMAL`만으로는 이 충돌을 못 막는다 — 그건 *파서*를 좁힌 것이고
 * 이건 *비교*의 문제다. 붙으면 **다른 표본의 이전 조사일**을 보여준다(쓰기 경로는 아니지만
 * 조사 전에 보는 화면이라 판단을 오도한다).
 *
 * 문자열로 정규화해 비교한다 — 부호·선행 0·후행 0만 없애고 **자릿수는 하나도 버리지 않는다.**
 * `STRICT_DECIMAL`을 통과한 문자열만 들어온다(지수·천단위 구분 없음).
 */
function canonicalDecimal(s: string): string {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) return s; // STRICT_DECIMAL 통과분은 항상 걸린다 — 방어용
  const int = (m[2] ?? '').replace(/^0+/, '') || '0';
  const frac = (m[3] ?? '').replace(/0+$/, '');
  const body = frac ? `${int}.${frac}` : int;
  // `-0` == `0`(수로서 같다). 그 외 음수만 부호를 남긴다.
  return m[1] === '-' && body !== '0' ? `-${body}` : body;
}

/**
 * 🔴 v0.49 r5 Z10(claude #15) — **축별 패치가 아니라 「양쪽을 같은 규칙으로 정규화」 한 곳.**
 *
 * 이 함수가 자란 방식이 결함의 형태였다: date 축(r3 #4)과 수치 축(r4 M9)이 **각자 자기 분기
 * 안에서** 양쪽을 손으로 맞췄다. 축이 하나 늘 때마다 「양쪽 다 정규화됐는가」 가드를 새로 적어야
 * 했고, 한쪽만 정규화하면 `null === null`로 조용히 통과하는 구멍이 매번 다시 열렸다.
 * 이제 **정규화는 여기 하나**이고 비교는 호출부에서 한 번이다.
 *
 * 축별 근거(이 헬퍼가 승계한 것):
 *  · **date**(r3 #4) — `want`는 앱이 만든 원문(`autoValue`)이고 `cell`은 시트의
 *    **FORMATTED_VALUE**다. 구글이 date 서식 셀을 로케일대로 다시 그리므로
 *    (`2026-03-01` → `2026. 3. 1`) 리터럴 고정일 키는 **영영 일치하지 않고** 결과는 영구
 *    '기록 없음'이었다(A8이 「정당한 식별 키」로 인정한 정식일자 등이 그 부류다).
 *  · **int/float**(r4 M9) — `USER_ENTERED` 강제 변환으로 앱의 `'007'`이 시트에서 숫자 7이 되어
 *    `'7'`로 돌아오고, `'1.0'`은 `'1'`로 그려진다. 결과는 date 축과 **똑같다**.
 *    보수적으로 좁힌 세 조건은 그대로다: ①`int`/`float`에만 ②`STRICT_DECIMAL` 형태만
 *    ③정확 일치 우선(호출부 ①).
 *
 * @returns 2차 대조에 쓸 정규형. `null`이면 **이 컬럼/값은 2차 대조 대상이 아니다**
 *   (`text`/`options`는 값의 의미를 건드리지 않는다 — `'007'`이 고유 라벨일 수 있다).
 */
function normalizeFixedKeyCell(col: Column, s: string): string | null {
  if (col.type === 'date') return normalizeDateCell(s);
  if (col.type === 'int' || col.type === 'float') {
    return STRICT_DECIMAL.test(s) ? canonicalDecimal(s) : null;
  }
  return null;
}

export function fixedKeyCellMatches(col: Column, cell: string | undefined, want: string): boolean {
  const raw = (cell ?? '').trim();
  // ① 정확 일치를 **먼저** 본다 — 정규화 대상이 아닌 값의 의미는 건드리지 않는다(불변).
  if (raw === want) return true;
  // ② 2차 대조 — **양쪽 다** 정규화돼야 참이다(파싱 불가끼리 `null === null`로 통과하는 구멍 차단).
  const got = normalizeFixedKeyCell(col, raw);
  return got !== null && got === normalizeFixedKeyCell(col, want);
}

export function previousSurveyRound(
  index: PastIndex,
  columns: Column[],
  roundDateColId: string | null,
  beforeDate: string,
): PrevSurveyRound {
  // 🔴 v0.49 r2 A5(codex F4 = 합집합 C6) — **세 가지 null을 갈랐다.** 종전엔 ⓐ고정 키 0개
  //   ⓑ고정 키 컬럼이 시트에 미매핑 ⓒ실제 일치 기록 0건이 전부 `null`이었고, 호출부(설정요약)는
  //   그 전부를 「기록 없음」으로 그렸다. ⓐ·ⓑ는 **조회를 포기한 상태**이지 조회 결과가 아니다 —
  //   사용자가 "과거 기록이 없다"는 잘못된 결론을 내린다(샘플키를 다 꺼두거나 헤더를 개명한
  //   스키마에서 영구 고정된다). 「추측 금지, 정직한 null」의 정직함은 **구분**에서 나온다.
  const fixedCols = sessionFixedKeyColumns(columns, roundDateColId);
  if (fixedCols.length === 0) return { kind: 'unqueryable', reason: 'no_fixed_key' };
  // 시트에 매핑되지 않은 컬럼은 레코드에 값이 없어 어떤 행과도 일치할 수 없다 — 전수 스캔 생략.
  if (fixedCols.some((c) => !index.headersMapped.has(c.id))) {
    return { kind: 'unqueryable', reason: 'headers_unmapped' };
  }
  // 🔴 v0.49 r3 #3(claude r2 HIGH) — **시간축도 같은 가드를 받는다.** A5는 샘플 식별축(고정 키)만
  //   갈라 놓았고, 회차 축이 무너진 경우는 그대로 '기록 없음'으로 샜다: `buildPastIndex`는
  //   회차를 못 읽은 행을 `if (!round) continue`로 **전부 버리므로**, 회차 컬럼이 없거나 시트에
  //   미매핑이면 `samples`가 통째로 빈다. 그러면 아래 이중 루프는 0건을 돌고 `{kind:'none'}`이
  //   나간다 — 조회가 성립조차 안 했는데 화면은 "과거 기록이 없다"고 단정한다. A5가 막으려던
  //   그 거짓의 **남은 절반**이다(사유만 다르고 사용자가 내리는 틀린 결론은 똑같다).
  const roundCol = resolveRoundCol(columns, roundDateColId);
  if (!roundCol) return { kind: 'unqueryable', reason: 'no_round_col' };
  if (!index.headersMapped.has(roundCol.id)) {
    return { kind: 'unqueryable', reason: 'round_unmapped' };
  }
  //   매핑은 됐는데 인덱싱된 회차가 0개 = **파싱 가능한 날짜 셀이 한 줄도 없었다**(서식 불일치·
  //   빈 칸·불완전 샘플키로 전량 skip). 데이터 행 자체가 0줄이면 그건 정직한 '기록 없음'이다.
  if (index.rowCount > 0 && index.rounds.length === 0) {
    // 🔴 v0.49 r4 M8(#11) — 두 원인을 가른다. `roundParsedRows > 0`이면 회차 축은 멀쩡했고
    //   샘플키가 전량 탈락한 것이다(키 탈락이 회차 집계보다 **먼저** 돌기 때문에 `rounds`가
    //   비었다). 구버전 영속 레코드는 이 필드가 없어 0으로 복원되므로 종전 판정 그대로다
    //   (= 마이그레이션 없이 하위호환 — 그 필드 주석 참조).
    return {
      kind: 'unqueryable',
      reason: index.roundParsedRows > 0 ? 'no_keyed_rows' : 'round_unindexed',
    };
  }
  const want = fixedCols.map((c) => [c, autoValue(c, 1).trim()] as const);
  let best: string | null = null;
  for (const byRound of index.samples.values()) {
    for (const [round, rec] of byRound) {
      if (round >= beforeDate) continue;
      if (best !== null && round <= best) continue;
      // #4 — 날짜 컬럼은 서식 차이를 넘어서 대조한다(`fixedKeyCellMatches` 헤더).
      if (want.every(([c, v]) => fixedKeyCellMatches(c, rec[c.id], v))) best = round;
    }
  }
  return best === null ? { kind: 'none' } : { kind: 'date', iso: best };
}

/**
 * v0.8.0 — 화면 전역 비교 기준: 인덱스에 존재하는 **최근 2개 회차**(직전→최근).
 *
 * 조회탭은 "각 샘플이 시간 경과(직전→최근)에 따라 어떻게 변하는지"를 보는 탭이다.
 * 샘플을 섞지 않으므로(집계 금지) 이 함수는 **샘플별이 아니라 전역**이다 — 전체 화면이
 * 같은 두 회차를 쓰고, 각 샘플은 그 두 회차에서 자기 값을 읽는다(없으면 '—').
 * (대조: previousRound는 샘플별로 다른 직전 회차를 돌려준다 — 추세 검증/음성용으로 유지.)
 *
 *  - rounds는 buildPastIndex에서 오름차순 정렬됨 → 끝의 2개가 직전·최근.
 *  - 회차가 1개뿐이면 prev=null(변화 표시 불가, 값만), 0개면 둘 다 null.
 *  - **집계(합계·평균) 함수가 아니다.** 두 회차의 ISO 문자열만 고른다.
 */
export function latestTwoRounds(index: PastIndex): { latest: string | null; prev: string | null } {
  const r = index.rounds;
  return {
    latest: r.length >= 1 ? r[r.length - 1] : null,
    prev: r.length >= 2 ? r[r.length - 2] : null,
  };
}

/** (키, 회차, 컬럼)의 과거값. 없거나 빈 문자열이면 null. */
export function pastValue(
  index: PastIndex,
  key: string,
  round: string,
  colId: string,
): string | null {
  const v = index.samples.get(key)?.get(round)?.[colId];
  return v === undefined || v === '' ? null : v;
}
