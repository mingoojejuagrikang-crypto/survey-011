/* eslint-disable max-lines -- [ENV-12] 기존 초과 파일(GL-006 §5 도입 시점), 과거값 인덱스 도메인 — 분리 경계 검토 후 해소. 해소 시 이 주석 제거. */
/**
 * v0.7.0 — 과거 조사값 인덱스 (B3 조회 탭 · B4 추세 검증 공용 모듈).
 *
 * 패턴(audioTrim.ts와 동일): 키 구성·날짜 정규화·인덱스 빌드·회차 조회는 브라우저 의존이 없는
 * 순수 함수로 분리해 Node 단위 테스트(tests/pastValues.spec.ts)가 가능하고, fetch + 캐시
 * (loadPastIndex)는 같은 파일의 브라우저 사이드에 둔다.
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
 * 오프라인/미로그인/시트 미설정/HTTP 오류 → loadPastIndex가 null로 resolve(throw 안 함).
 * 호출자(조회 탭·추세 검증)는 null이면 기능을 조용히 건너뛴다.
 */
import type { Column } from '../types';
import { withTimeout } from './async';
import { autoValue, isDynamicTodayColumn, isRowInvariantAuto } from './autoValue';
import { effectiveSampleKey } from './columnFlags';
import { fetchAllRowsUnbounded, parseSpreadsheetId, readonlySheetsAuth } from './sheets';
import { useSettingsStore } from '../stores/settingsStore';
import { logger } from './logger';
import { deletePastIndexBackup, loadPastIndexBackup, savePastIndexBackup } from './db';

// ─── 순수 로직 (Node 단위 테스트 대상 — 브라우저 의존 없음) ─────────────────

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

// ─── 영속화 직렬화 (v0.33.0 항목5 — 순수 함수, Node 단위 테스트 대상) ─────────

/** 폴백 유효기간: 14일. 회차 간격(주 단위 조사)을 넉넉히 덮되, 시즌이 지난 죽은 인덱스로
 *  엉뚱한 직전값 비교를 하지 않게 상한을 둔다(플랜 확정값). */
export const FALLBACK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** 14일 경계 판정(경계 포함: 정확히 14일 = 아직 유효). 순수 함수 — 단위 테스트 대상. */
export function isFallbackFresh(builtAt: number, now: number): boolean {
  return now - builtAt <= FALLBACK_TTL_MS;
}

/** IDB 'kv' 스토어(`__past_index__`)에 저장되는 JSON-호환 레코드. Map은 entries 배열로 편다
 *  (structured clone이 Map을 지원하긴 하나, 검증 가능한 평면 형태가 복원 안전성·테스트에 유리). */
export interface PersistedPastIndexRecord {
  fp: string;
  builtAt: number;
  headersMapped: [string, number][];
  unmappedColumns: string[];
  rounds: string[];
  samples: [string, [string, Record<string, string>][]][];
  duplicateCount: number;
  rowCount: number;
  /** M8(#11) — 구버전 레코드에는 없다. 복원 시 0(= 종전 판정)으로 떨어진다. */
  roundParsedRows?: number;
}

export function serializePastIndexEntry(entry: {
  fp: string;
  builtAt: number;
  index: PastIndex;
}): PersistedPastIndexRecord {
  const { fp, builtAt, index } = entry;
  return {
    fp,
    builtAt,
    headersMapped: [...index.headersMapped.entries()],
    unmappedColumns: [...index.unmappedColumns],
    rounds: [...index.rounds],
    samples: [...index.samples.entries()].map(
      ([key, byRound]) => [key, [...byRound.entries()]] as [string, [string, Record<string, string>][]],
    ),
    duplicateCount: index.duplicateCount,
    rowCount: index.rowCount,
    roundParsedRows: index.roundParsedRows,
  };
}

/** 레코드 복원 + 형태 검증. 손상/구버전/이형 레코드는 null(조용히 폐기 — 폴백은 best-effort). */
export function deserializePastIndexEntry(
  raw: unknown,
): { fp: string; builtAt: number; index: PastIndex } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<PersistedPastIndexRecord>;
  if (typeof r.fp !== 'string' || typeof r.builtAt !== 'number' || !Number.isFinite(r.builtAt)) return null;
  if (
    !Array.isArray(r.headersMapped) || !Array.isArray(r.unmappedColumns) ||
    !Array.isArray(r.rounds) || !Array.isArray(r.samples) ||
    typeof r.duplicateCount !== 'number' || typeof r.rowCount !== 'number'
  ) return null;
  try {
    const headersMapped = new Map<string, number>();
    for (const pair of r.headersMapped) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'number') return null;
      headersMapped.set(pair[0], pair[1]);
    }
    const samples = new Map<string, Map<string, Record<string, string>>>();
    for (const entry of r.samples) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) return null;
      const byRound = new Map<string, Record<string, string>>();
      for (const pair of entry[1]) {
        if (!Array.isArray(pair) || typeof pair[0] !== 'string' || typeof pair[1] !== 'object' || pair[1] === null) return null;
        byRound.set(pair[0], pair[1]);
      }
      samples.set(entry[0], byRound);
    }
    return {
      fp: r.fp,
      builtAt: r.builtAt,
      index: {
        headersMapped,
        unmappedColumns: r.unmappedColumns.filter((x): x is string => typeof x === 'string'),
        rounds: r.rounds.filter((x): x is string => typeof x === 'string'),
        samples,
        duplicateCount: r.duplicateCount,
        rowCount: r.rowCount,
        // M8(#11) — **형태 검증에 넣지 않는다.** 필수로 만들면 이 필드 이전에 저장된 백업이
        //   통째로 폐기돼(deserialize가 null) 14일 폴백이 끊긴다. 없으면 0 = 종전 판정.
        roundParsedRows: typeof r.roundParsedRows === 'number' ? r.roundParsedRows : 0,
      },
    };
  } catch {
    return null;
  }
}

// v0.38.0 — `withTimeout`은 `lib/async.ts`로 이동했다(계층 중립 유틸). 여기서 쓰는 이유는 그대로다:
// 시간 초과 시 reject → loadPastIndex의 catch가 `past_index_skip:timeout…`으로 로깅하고 null로
// 해소하므로, in-flight 가드가 풀려 백오프 재시도·수동 재시도 버튼 경로가 살아난다(07-13 §4).

// ─── 브라우저 사이드: fetch + 모듈 캐시 ─────────────────────────────────────

const CACHE_TTL_MS = 10 * 60 * 1000; // 10분 — 한 조사 세션 동안 재fetch 없이 충분, 당일 타 기기 업로드는 다음 세션에 반영

/** loadPastIndex 전체 fetch 상한 — 2272행 실측이 ~1s인 시트가 20s를 넘기면 hang으로 간주. */
const FETCH_TIMEOUT_MS = 20_000;

interface CacheEntry {
  fp: string;
  builtAt: number;
  index: PastIndex;
}

let cached: CacheEntry | null = null;
let latestLoadGeneration = 0;
let inflight: { fp: string; generation: number; promise: Promise<PastIndex | null> } | null = null;
let loginRefreshInflight: { fp: string; promise: Promise<PastIndex | null> } | null = null;

// v0.33.0 항목5 — IDB에서 복원한 영속 폴백(로그인 무관 이상치 알람). 유효성(fp 일치 + 14일 이내)은
// 읽기 시점(getFallbackEntry)에 매번 재검증한다 — 하이드레이션 후 설정이 바뀌어도 안전.
let fallback: CacheEntry | null = null;
let fallbackHydrateStarted = false;

// v0.33.0 항목5 — 상태 구독(설정탭·입력탭 시작 카드의 '과거값 준비' 배지 실시간 갱신용).
const statusListeners = new Set<() => void>();
function notifyStatusChanged(): void {
  for (const cb of [...statusListeners]) {
    try { cb(); } catch { /* 리스너 오류가 로더를 죽이지 않게 */ }
  }
}
export function subscribePastIndexStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => { statusListeners.delete(cb); };
}

// v0.14.0 A — 전송 실패(iOS Safari transient "Load failed") 자가 복구용 백오프 재시도 상태.
// 실기기 로그(v0.13.0)에서 세션 start 직후(~27ms) prefetch가 "Load failed"로 한 번 실패하면
// 세션 내내 past_index_ready가 0건이었다(토큰·연결은 정상 — 같은 세션 시트 쓰기는 성공). 원인은
// "한 번 실패 후 아무도 다시 부르지 않음"(prefetch 1회 + evaluateTrend는 getCachedIndex만 읽음).
// loadPastIndex는 실패를 캐시하지 않으므로 재호출하면 다시 시도된다 — ensurePastIndex가 반복
// 호출에 안전하게 자가 제한된 백오프 재시도를 건다.
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempts = 0;
const MAX_RETRIES = 5;

/** v0.34.0 리뷰(Codex+agy-Flash 공통) — 권한 오류(401 미인증 / 403 권한없음) 판별.
 *  sheets.ts의 fetch 실패는 `시트 조회 실패 (HTTP 403): …` 형태로 상태코드를 메시지에 담는다
 *  (별도 status 필드가 없어 메시지 파싱 — 오탐해도 "재시도를 덜 한다"는 안전한 방향이고,
 *  실패 자체는 past_index_skip으로 항상 로깅되므로 침묵하지 않는다).
 *  비공개 시트를 API key로 읽는 조합이 대표 사례: 몇 번을 더 쏴도 결과는 같다. */
function isPermissionError(msg: string): boolean {
  return /\bHTTP (401|403)\b/.test(msg) || /\b(401|403)\b/.test(msg);
}

interface LoadContext {
  fp: string;
  spreadsheetId: string | null;
  sheetTab: string;
  columns: Column[];
  roundDateColId: string | null;
}

/** 캐시 키 = (시트 ID, 탭, 회차 컬럼, 컬럼 지문). 키/이름/타입이 바뀌면 인덱스 무효. */
function loadContext(): LoadContext {
  const s = useSettingsStore.getState();
  const spreadsheetId = parseSpreadsheetId(s.sheetUrl);
  const fp = JSON.stringify([
    spreadsheetId,
    s.sheetTab,
    s.roundDateColId,
    s.columns.map((c) => [c.id, c.name.trim(), c.type, effectiveSampleKey(c)]),
  ]);
  return { fp, spreadsheetId, sheetTab: s.sheetTab, columns: s.columns, roundDateColId: s.roundDateColId };
}

/** 유효한(TTL 내 + 현재 설정과 지문 일치) 캐시 인덱스. 없으면 null — fetch하지 않는다. */
export function getCachedIndex(): PastIndex | null {
  if (!cached) return null;
  if (Date.now() - cached.builtAt > CACHE_TTL_MS) return null;
  if (cached.fp !== loadContext().fp) return null;
  return cached.index;
}

// ─── v0.33.0 항목5 — 영속 폴백 (로그인 무관 이상치 알람) ───────────────────

/** 유효한(fp 일치 + 14일 이내) 영속 폴백 엔트리. 신선 캐시와 달리 10분 TTL이 없다 —
 *  토큰 만료·재부팅·미로그인 세션에서도 "직전 회차 대비" 비교선을 유지하는 것이 목적. */
function getFallbackEntry(): CacheEntry | null {
  if (!fallback) return null;
  if (!isFallbackFresh(fallback.builtAt, Date.now())) return null;
  if (fallback.fp !== loadContext().fp) return null;
  return fallback;
}

/** evaluateTrend 폴백 경로: `getCachedIndex() ?? getFallbackIndex()`. 폴백 사용 시 호출자가
 *  `trend_used_stale_index`를 로깅한다(세션당 1회 — useVoiceSession의 skip dedupe와 동일 컨벤션). */
export function getFallbackIndex(): PastIndex | null {
  return getFallbackEntry()?.index ?? null;
}

/** 폴백의 빌드 시각(epoch ms) — 배지의 "(x시간 전)" 표기·stale 로그의 age 산출용. 없으면 null. */
export function getFallbackBuiltAt(): number | null {
  return getFallbackEntry()?.builtAt ?? null;
}

/**
 * 🔴 v0.49 r4 M6(claude r3 #10) — 표시용 인덱스 + **출처**.
 *
 * 소비자(설정 요약)가 `getCachedIndex() === null`을 「백업에서 왔다」로 읽고 있었다. 그 둘은
 * **다른 질문**이다: 신선 캐시는 10분 TTL이 있고, 성공한 조회는 `cached`와 `fallback`에 **같은
 * 엔트리**를 심는다(`loadPastIndex` :642-645). 그래서 조회 성공 10분 뒤부터, 방금 이 세션이
 * 직접 읽어 온 인덱스가 「(백업)」으로 그려지고 `past_index_used_stale:…,age_h=0`이 기록됐다 —
 * 「최대 14일 묵은 IDB 백업」이라는 강한 주장이 **0시간짜리 자기 조회**에 붙는다.
 *
 * 판별자는 TTL이 아니라 **동일 엔트리인가**다. `fallback === cached`면 이 세션의 자기 조회이고,
 * TTL만 지났다(그 축은 준비 상태 배지 `getPastIndexStatus`가 따로 소유한다 — 이 함수는
 * 「답이 어디서 왔는가」만 답한다).
 */
export function readIndexWithProvenance(): { index: PastIndex; stale: boolean; builtAt: number } | null {
  const fresh = getCachedIndex();
  if (fresh && cached) return { index: fresh, stale: false, builtAt: cached.builtAt };
  const fb = getFallbackEntry();
  if (!fb) return null;
  return { index: fb.index, stale: fb !== cached, builtAt: fb.builtAt };
}

/**
 * 부팅/세션 시작 시 1회 — IDB `__past_index__` 레코드를 메모리 폴백으로 복원한다(idempotent).
 * 손상 레코드·14일 초과는 조용히 폐기. fp 검증은 여기서 하지 않는다(설정 하이드레이션 레이스
 * 방지 — 읽기 시점의 getFallbackEntry가 매번 검증). 실패해도 throw하지 않는다(best-effort).
 */
export async function hydratePastIndexFallback(): Promise<void> {
  if (fallbackHydrateStarted) return;
  fallbackHydrateStarted = true;
  try {
    const raw = await loadPastIndexBackup();
    if (raw == null) return;
    const entry = deserializePastIndexEntry(raw);
    if (!entry) return;
    if (!isFallbackFresh(entry.builtAt, Date.now())) return;
    // 이미 신선 캐시가 있으면(부팅 직후 prefetch가 먼저 성공) 캐시가 더 최신이다.
    if (!fallback || entry.builtAt > fallback.builtAt) fallback = entry;
    notifyStatusChanged();
  } catch { /* IDB 불가 — 폴백 없이 기존 경로로 동작 */ }
}

// ─── v0.33.0 항목5 — 상태 스냅샷 (3상태 배지의 '과거값 준비' 행) ──────────────

export interface PastIndexStatus {
  /** ready=신선 캐시 / stale=영속 폴백만 / loading=fetch 진행 중 / none=없음 */
  state: 'ready' | 'stale' | 'loading' | 'none';
  rowCount?: number;
  roundCount?: number;
  builtAt?: number;
}

export function getPastIndexStatus(): PastIndexStatus {
  const hit = getCachedIndex();
  if (hit && cached) {
    return { state: 'ready', rowCount: hit.rowCount, roundCount: hit.rounds.length, builtAt: cached.builtAt };
  }
  const fb = getFallbackEntry();
  if (fb) {
    return { state: 'stale', rowCount: fb.index.rowCount, roundCount: fb.index.rounds.length, builtAt: fb.builtAt };
  }
  if (inflight) return { state: 'loading' };
  return { state: 'none' };
}

/**
 * 과거값 인덱스 로드. 캐시 히트면 fetch 없이 반환, 동일 지문 in-flight면 그 promise 공유.
 * 미설정/미로그인/네트워크·HTTP 오류는 **null로 resolve**(throw 안 함) — 호출자는 조용히 skip.
 */
export async function loadPastIndex(opts?: { force?: boolean }): Promise<PastIndex | null> {
  const ctx = loadContext();
  if (!opts?.force) {
    const hit = getCachedIndex();
    if (hit) return hit;
    if (inflight && inflight.fp === ctx.fp) return inflight.promise;
  }
  if (!ctx.spreadsheetId || !ctx.sheetTab) {
    logger.log({ type: 'app', extra: 'past_index_skip:not_configured' });
    return null;
  }
  // v0.34.0 C9 — 토큰 **또는** API key(공개 시트 읽기 폴백, readonlySheetsAuth SSOT)가 있으면
  // 진행. 둘 다 없을 때만 기존 not_signed_in skip(이벤트명 유지 — 로그 분석 호환).
  // 시트가 비공개라 key 경로가 403이면 fetch 오류가 아래 catch의 `past_index_skip:<msg>`로
  // 남는다(HTTP 상태 포함) — 침묵 실패 없음.
  const auth = readonlySheetsAuth();
  if (!auth) {
    logger.log({ type: 'app', extra: 'past_index_skip:not_signed_in' });
    return null;
  }
  const generation = ++latestLoadGeneration;
  const promise = (async (): Promise<PastIndex | null> => {
    try {
      // v0.33.0 항목5 — fetch 시작 계측(07-13 §4: 시작 이벤트가 없어 "미완 hang"을 로그로 판별
      // 불가했던 갭). ready/skip과 짝을 이뤄 미완주 fetch가 로그에서 보인다.
      // v0.34.0 C9 — auth=token|apikey 첨부: 어떤 인증 수단으로 준비됐는지 로그만으로 판정.
      logger.log({ type: 'app', extra: `past_index_fetch_start:auth=${auth}` });
      const { headers, rows } = await withTimeout(
        fetchAllRowsUnbounded(ctx.spreadsheetId!, ctx.sheetTab),
        FETCH_TIMEOUT_MS,
      );
      const roundCol = resolveRoundCol(ctx.columns, ctx.roundDateColId);
      const index = buildPastIndex(headers, rows, ctx.columns, roundCol);
      // v0.38.0 리뷰#1(Codex Medium) 검토 결과 — "게시 전 지문 재검증"은 **채택하지 않는다.**
      // 재연결(onUrlConfirmWithUrl)이 sheetTab을 잠깐 ''로 선리셋하는 과도 구간이 있어, 그 순간을
      // '낡음'으로 오인해 멀쩡한 조회 결과를 버렸다(실측: 로그인 갱신이 통째로 폐기됨).
      // 대신 요청 세대를 비교한다. 더 최신 조회가 시작됐다면 이 결과는 설정 과도 구간과 무관하게
      // 낡은 요청이므로, 메모리 캐시·폴백·IDB 어느 곳에도 게시하지 않는다.
      if (generation !== latestLoadGeneration) return null;
      // retryAttempts는 지문별 이력이 아니라 현재 준비 중인 인덱스의 단일 예산이다. 최신 요청의
      // 성공만 예산을 복구해야, 게시 직후 새 요청이 시작돼도 이전 세대가 최신 예산을 되감지 않는다.
      retryAttempts = 0;
      cached = { fp: ctx.fp, builtAt: Date.now(), index };
      // v0.33.0 항목5 — IDB write-through(kv `__past_index__`) + 메모리 폴백 동기화.
      // 캐시 TTL(10분)·토큰 만료·재부팅 후에도 이 스냅샷이 알람 비교선으로 살아남는다.
      fallback = cached;
      void savePastIndexBackup(serializePastIndexEntry(cached));
      logger.log({
        type: 'app',
        extra:
          `past_index_ready:rows=${index.rowCount},samples=${index.samples.size},` +
          `rounds=${index.rounds.length},dup=${index.duplicateCount},unmapped=${index.unmappedColumns.length}`,
      });
      return index;
    } catch (e) {
      // 오프라인/HTTP 오류/타임아웃 — REVIEW-1: 삼키지 말고 로깅하되, 호출자에겐 null(조용히 skip).
      const msg = e instanceof Error ? e.message : String(e);
      // v0.34.0 리뷰(Codex+agy-Flash 공통) — 권한 오류(401/403)는 재시도해도 낫지 않는다. 비공개
      // 시트를 API key로 읽으려는 조합에서 지수 백오프 5회가 무의미한 403을 반복해 쿼터·대역폭을
      // 태우던 표면. 권한 오류로 판정되면 재시도 예산을 소진시켜 즉시 멈춘다(다른 실패는 종전대로
      // 재시도 — 오프라인·5xx·타임아웃은 회복 가능).
      // 낡은 요청의 권한 오류는 그 요청만의 결말이다. 최신 요청이 회복 가능한 오류로 재시도해야 할
      // 예산까지 소진하면, 현재 지문의 이상치 비교선이 준비되지 않는다.
      if (generation === latestLoadGeneration && isPermissionError(msg)) {
        retryAttempts = MAX_RETRIES;
        logger.log({ type: 'app', extra: `past_index_retry_blocked:permission:auth=${auth}` });
      }
      logger.log({ type: 'app', extra: `past_index_skip:${msg.slice(0, 120)}` });
      return null;
    } finally {
      if (inflight?.generation === generation) inflight = null;
      notifyStatusChanged();
    }
  })();
  inflight = { fp: ctx.fp, generation, promise };
  notifyStatusChanged();
  return promise;
}

/**
 * v0.38.0 #1 — Google 로그인 성공 직후의 강제 갱신. 10분 캐시는 의도적으로 우회하되,
 * 동일 설정 지문의 로그인 갱신이 이미 진행 중이면 같은 Promise를 공유한다. 로그인 직전의 일반
 * prefetch가 진행 중이었다면 그것을 먼저 정착시킨 다음 한 번 더 강제 조회해, "기존 요청에 합류해서
 * 실제 로그인 시점 갱신은 생략"되는 경우도 막는다. 인덱스 확정·메모리/IDB 반영은 loadPastIndex의
 * 기존 성공 경로만 사용한다.
 */
export function refreshPastIndexAfterLogin(): Promise<PastIndex | null> {
  const ctx = loadContext();
  if (loginRefreshInflight?.fp === ctx.fp) return loginRefreshInflight.promise;
  const pendingBeforeLogin = inflight?.fp === ctx.fp ? inflight.promise : null;
  const promise = (async () => {
    if (pendingBeforeLogin) await pendingBeforeLogin;
    return loadPastIndex({ force: true });
  })();
  loginRefreshInflight = { fp: ctx.fp, promise };
  void promise.finally(() => {
    if (loginRefreshInflight?.promise === promise) loginRefreshInflight = null;
  }).catch(() => {});
  return promise;
}

/** 재시도 가치 판단: 시트·탭·인증수단(토큰 또는 API key — v0.34.0 C9, readonlySheetsAuth SSOT)이
 *  모두 있는데 인덱스가 없으면 네트워크/HTTP 실패였다는 뜻 → 재시도 가치 있음.
 *  미설정/둘 다 없음이면 재시도 무의미(조용히 멈춤). */
function shouldRetryLoad(): boolean {
  const ctx = loadContext();
  return !!ctx.spreadsheetId && !!ctx.sheetTab && readonlySheetsAuth() !== null;
}

/**
 * v0.14.0 A — 반복 호출에 안전한 인덱스 로더. 캐시 히트/in-flight/재시도 예약 중이면 no-op.
 * 로드가 실패(null)했고 재시도 가치가 있으며 횟수 미초과면 지수 백오프(0.6→1.2→2.4→4.0s)로
 * 자동 재시도한다. evaluateTrend가 캐시 미스마다 호출해도 자가 제한되어 폭주하지 않는다.
 */
export function ensurePastIndex(): void {
  if (getCachedIndex()) return;
  // v0.38.0 리뷰#1(Codex Medium) — in-flight 가드는 **같은 지문**의 중복 조회만 막아야 한다.
  // 지문 비교 없이 막으면, 로그인 직후 느린 구지문 조회가 진행되는 동안 컬럼이 바뀌었을 때
  // 새 지문 재조회가 통째로 삼켜져 캐시가 빈 채로 남는다(현장 = 느린 네트워크에서 상시 조건).
  if (inflight && inflight.fp === loadContext().fp) return;
  if (retryTimer != null) return;
  const loadPromise = loadPastIndex();
  const generation = latestLoadGeneration;
  void loadPromise.then((idx) => {
    // 무효화/신규 조회 뒤 끝난 이전 ensure 체인이 새 전역 retryTimer를 다시 만들지 않게 한다.
    if (generation !== latestLoadGeneration) return;
    if (idx) return; // 성공 경로가 최신 세대를 확인한 뒤 예산까지 복구한다.
    if (!shouldRetryLoad() || retryAttempts >= MAX_RETRIES) return;
    const delay = Math.min(4000, 600 * 2 ** retryAttempts);
    retryAttempts++;
    retryTimer = setTimeout(() => { retryTimer = null; ensurePastIndex(); }, delay);
  });
}

/**
 * v0.38.0 리뷰#1 — "과거값 인덱스를 지금 만들 가치가 있는가"의 **단일 술어(SSOT)**.
 *
 * 이 판단이 App 부팅·로그인·설정 저장·테이블 생성·시트 재연결 등 호출부마다 복붙돼 있었고,
 * 모양이 조금씩 달라(`anyRule`만 보는 곳 vs 인증까지 보는 곳) 신규 호출부가 게이트를 통째로
 * 빠뜨리는 결함으로 이어졌다. 호출부는 이 함수만 쓴다 — 조건이 바뀌면 여기 한 곳만 고친다.
 *
 * 항상 보는 조건: ①이상치 알람 규칙(방향 또는 변동률)이 한 컬럼이라도 있고 ②시트가 지정돼 있다.
 * 둘 중 하나라도 없으면 만들어도 **소비자가 없다**.
 *
 * `requireAuth: true`일 때만 추가로 ③읽기 인증 수단(토큰 또는 API key)을 본다. 기본값이 아닌
 * 이유는 아래 본문 주석 참조 — 부팅 경로는 인증이 없어도 진입시켜야 스킵 사유가 로그에 남는다.
 */
export function shouldPreparePastIndex(opts?: { requireAuth?: boolean }): boolean {
  const s = useSettingsStore.getState();
  const anyAnomalyRule = s.columns.some(
    (c) => c.trendRule === 'increase' || c.trendRule === 'decrease' || c.pctThreshold != null,
  );
  if (!anyAnomalyRule || !s.sheetUrl || !s.sheetTab) return false;
  // 인증 검사는 **선택**이다. 부팅 경로는 인증이 없어도 진입시켜 loadPastIndex가
  // `past_index_skip:not_signed_in`을 남기게 한다 — 그 계측이 "왜 알람이 없었나"를 사후에
  // 판별하는 유일한 단서이고, SOP-003 파서와의 바이트 계약이다(v0.34.0 C9). 조회 자체는
  // loadPastIndex가 인증 없으면 즉시 skip하므로 네트워크 낭비는 없다.
  return opts?.requireAuth ? readonlySheetsAuth() !== null : true;
}

/**
 * 시트 연결 삭제 시 과거값 상태를 한 번에 무효화한다. 세대를 먼저 올려 이미 응답을 기다리는 조회가
 * 이후 메모리·IDB를 다시 게시하지 못하게 한 뒤, 현재 시트에만 의미가 있는 전역 상태를 정리한다.
 */
export async function invalidatePastIndex(): Promise<void> {
  latestLoadGeneration++;
  cached = null;
  fallback = null;
  inflight = null;
  loginRefreshInflight = null;
  resetPastIndexRetries();
  notifyStatusChanged();
  await deletePastIndexBackup();
}

/** 세션 시작 시 재시도 카운터/타이머 리셋 — 이전 세션이 오프라인으로 소진했어도 새 세션은 다시
 *  시도한다. 유효 캐시는 보존(무효화는 TTL/지문으로 getCachedIndex가 담당). */
export function resetPastIndexRetries(): void {
  retryAttempts = 0;
  if (retryTimer != null) { clearTimeout(retryTimer); retryTimer = null; }
}

/** fire-and-forget 프리페치 — 세션 start() 등에서 호출(B4). v0.14.0: 백오프 재시도 포함. */
export function prefetchPastIndex(): void {
  ensurePastIndex();
}
