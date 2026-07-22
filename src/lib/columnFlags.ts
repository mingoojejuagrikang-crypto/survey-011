/**
 * v0.7.0 — 컬럼 샘플키·추세 플래그 규칙 (SSOT).
 *
 * 샘플 식별 = 컬럼 조합 키(예: 조사년도+농가명+라벨+처리+조사나무+조사과실).
 * 자동 유추 규칙(민구 결정): `input === 'auto'`이고 `type !== 'date'`인 컬럼 전부가 기본 샘플키.
 * 사용자는 설정탭에서 확인·수정만 한다(토글).
 *
 * `sampleKey === undefined`는 "아직 유추 전"을 의미한다 — 시트 재연결(inferColumns)로 컬럼이
 * 통째로 교체되면 플래그가 사라지므로, 소비자(설정 UI·pastValues)는 항상 effectiveSampleKey()로
 * 유추 폴백을 적용해 기능이 조용히 죽지 않게 한다.
 *
 * settingsStore(영속화)·SettingsScreen(토글 UI)·pastValues(키 구성)가 모두 이 모듈을 쓴다.
 * 브라우저 의존이 없어 Node 단위 테스트에서 직접 import 가능(audioTrim.ts 패턴).
 */
import type { Column } from '../types';

/** 샘플키 자동 유추: 자동 입력이면서 날짜가 아닌 컬럼. */
export function inferSampleKey(col: Pick<Column, 'input' | 'type'>): boolean {
  return col.input === 'auto' && col.type !== 'date';
}

/** 추세 규칙 적격: 사용자 입력(음성/터치) 숫자 컬럼만. auto 숫자 컬럼(순번 등)은 부적격. */
export function isTrendEligible(col: Pick<Column, 'input' | 'type'>): boolean {
  return (col.type === 'int' || col.type === 'float') && col.input !== 'auto';
}

/** 사용자가 토글한 값 우선, 없으면 자동 유추. */
export function effectiveSampleKey(col: Column): boolean {
  return typeof col.sampleKey === 'boolean' ? col.sampleKey : inferSampleKey(col);
}

/**
 * v0.38.0 — 시트 재연결(loadHeaders→inferColumns)이 **사용자 설정을 덮어쓰지 않게** 보존한다.
 *
 * 근인: 재로그인은 이전 시트를 자동 재연결(v0.13.0 R1)하는데, `inferColumns`는 시트 표본만 보고
 * 컬럼을 처음부터 다시 유추한다. 표본이 적으면(예: 시즌 첫 회차라 데이터 행이 1개) 숫자 컬럼의
 * 고유값이 1개뿐이라 `input='auto'`(고정값)로 판정돼, 사용자가 '음성'으로 둔 측정 컬럼이
 * 매 로그인마다 되돌아갔다. 파생 효과로 `effectiveSampleKey`가 뒤집혀 과거값 인덱스 지문까지
 * 무효화됐다(= 로그인 직후 "과거값 미준비").
 *
 * 경계: **시트가 결정하는 것은 `name`·`type`뿐**(그리고 preserveInferredColumnIds의 id 매칭),
 * 나머지는 전부 사용자 설정이라 보존한다. 단 `type`이 달라졌으면 컬럼의 의미가 바뀐 것이므로
 * 재유추값을 그대로 쓴다 — reconcileColumnFlags의 structural-change 규칙과 같은 판단이다.
 */
/** 숫자 계열은 표본 표현("111" vs "111.0")만으로 갈리므로 의미상 같은 종류로 본다. */
const NUMERIC_TYPES = new Set<Column['type']>(['int', 'float']);

/** 표본 추론 타입이 사용자 설정을 버릴 만큼 "의미가 달라졌는지". 숫자 계열 안의 흔들림은 아니다. */
function isSemanticTypeChange(prev: Column, inferred: Column): boolean {
  if (prev.type === inferred.type) return false;
  return !(NUMERIC_TYPES.has(prev.type) && NUMERIC_TYPES.has(inferred.type));
}

export function preserveUserColumnSettings(inferred: Column[], existing: Column[]): Column[] {
  const existingById = new Map(existing.map((c) => [c.id, c]));
  return inferred.map((col) => {
    const prev = existingById.get(col.id);
    if (!prev || isSemanticTypeChange(prev, col)) return col;
    return {
      ...col,
      // v0.38.0 리뷰#1(Codex High) — 표본이 우연히 정수 하나뿐이면 float 컬럼이 int로 추론된다.
      // 그 표현 차이로 사용자의 타입·소수자리·추세 설정을 버리면 안 되므로, 숫자 계열 안에서는
      // **사용자 타입이 SSOT**다. 진짜 의미 변경(text↔date 등)일 때만 재유추값을 쓴다.
      type: prev.type,
      input: prev.input,
      ttsAnnounce: prev.ttsAnnounce,
      auto: prev.auto,
      decimals: prev.decimals,
      sampleKey: prev.sampleKey,
      trendRule: prev.trendRule,
      pctThreshold: prev.pctThreshold,
    };
  });
}

/**
 * 컬럼 변경 시 샘플키·추세 플래그 일관성 유지. settingsStore의 모든 컬럼 쓰기 경로
 * (migrate / addColumn / updateColumn)가 이 함수를 통과한다.
 *
 * 문서화된 규칙:
 *  - sampleKey가 아직 없으면(boolean 아님) 자동 유추값을 부여한다.
 *  - 사용자가 토글한 값은 input/type이 바뀌지 않는 한 보존한다.
 *  - input 또는 type이 바뀌면(structural change) 컬럼의 의미가 달라진 것이므로 sampleKey를
 *    유추 기본값으로 재설정한다 — date로 바뀐 컬럼이 키로 남거나, 측정(음성) 컬럼으로 바뀐
 *    컬럼이 키로 남는 오염을 막는다. (migrate처럼 prev===next로 부르면 structural change가
 *    아니므로 "undefined일 때만 유추"가 된다.)
 *  - trendRule은 적격 컬럼에서만 유지: 부적격 전환 시, 그리고 잘못된 값(과거 빌드/수동 편집)은
 *    방어적으로 제거한다.
 *  - pctThreshold(v0.8.0, 변동률 % 임계값)도 적격 컬럼에서만 유지: 부적격 전환 시, 그리고
 *    잘못된 값(NaN·음수·0 이하)은 방어적으로 제거한다(undefined = off는 그대로 둔다).
 */
export function reconcileColumnFlags(prev: Column | null, next: Column): Column {
  const out: Column = { ...next };
  const structuralChange = !prev || prev.input !== next.input || prev.type !== next.type;
  if (typeof out.sampleKey !== 'boolean' || structuralChange) {
    out.sampleKey = inferSampleKey(out);
  }
  if (
    (out.trendRule !== 'increase' && out.trendRule !== 'decrease') ||
    !isTrendEligible(out)
  ) {
    delete out.trendRule;
  }
  // v0.8.0 — pctThreshold: undefined(off)는 보존. 정의됐는데 부적격이거나 비유한수·≤0이면 제거.
  // (NaN <= 0 은 false이므로 Number.isFinite로 NaN을 별도로 잡는다.)
  if (
    out.pctThreshold !== undefined &&
    (!isTrendEligible(out) || !Number.isFinite(out.pctThreshold) || out.pctThreshold <= 0)
  ) {
    delete out.pctThreshold;
  }
  return out;
}
