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
  return out;
}
