/**
 * v0.15.0 A3 — 자동 세션명 같은-날 중복 방지.
 *
 * 배경: 자동 세션 라벨은 `${ISO날짜} ${픽업값}`(또는 픽업값이 없으면 `${ISO날짜}` 단독)으로 만들어진다.
 * 같은 날 같은 농가/같은 자동값으로 여러 세션을 시작하면 라벨이 완전히 동일해져, 데이터탭에서 세션이
 * 서로 구분되지 않는다(실기기 로그에서 3세션 전부 `2026-06-19`로 확인된 실제 버그).
 *
 * 해결: 세션 *생성 시점*(useVoiceSession.start)에 기존 세션 라벨과 충돌을 검사해, 충돌하면 겹치지 않는
 * 순번 접미(`-2`, `-3`, …)를 붙인다. 생성 시점에서 한 번만 적용하므로, 라벨 출처(설정탭 sessionAutoLabel /
 * 입력탭 buildAutoLabel)와 무관하게 일관되게 고유성이 보장된다 — 미리 저장된 sessionAutoLabel을 같은 날
 * N개 세션이 공유해도 각 start()마다 다음 빈 순번을 집어 고유해진다.
 *
 * 순번을 택한 이유(HH:MM 대신): 라벨이 한 줄로 짧게 유지되고, 같은 날 N번째 세션이라는 의미가 직관적이다.
 */

import type { Column } from '../types';
import { isCycling } from './autoValue';

/**
 * v0.22.0 — 세션 상수 헬퍼(SSOT). 세션을 식별하는 "상수 값"을 한 컬럼에서 뽑는다.
 *
 * 정의: **세션 상수 값** = 한 세션 동안 행마다 바뀌지 않는(`!isCycling`) 유효 자동입력값.
 *  - `auto.kind==='fixed'` + 값 있음(공백/'오늘' 제외) → 그 값.
 *  - `auto.kind==='options'` + `selected.length===1` → `selected[0]`  (**v0.22.0 신규 — 기존 누락분**:
 *    농가명=고정, 라벨=단일선택 options, 처리=다중(순환)인 실제 스키마에서 단일선택 options를 놓쳐
 *    `2026-06-25 강남호`처럼 라벨(A)이 빠지던 버그를 메운다).
 *  - `type==='date'` 컬럼·순환(seq·다중옵션) → 제외(빈 문자열).
 *
 * `isCycling`(autoValue.ts, SSOT)을 그대로 import해 "행마다 변하는가" 판정을 단일 출처로 둔다.
 */
export function sessionConstantValue(col: Column): string {
  if (col.input !== 'auto') return '';
  if (col.type === 'date') return ''; // 날짜는 생성일이 이미 라벨 접두라 중복 제외
  if (isCycling(col)) return ''; // seq·다중옵션 = 행마다 바뀜 → 상수 아님
  if (col.auto.kind === 'fixed') {
    const v = (col.auto.value || '').trim();
    return v && v !== '오늘' ? v : '';
  }
  if (col.auto.kind === 'options' && col.auto.selected.length === 1) {
    return (col.auto.selected[0] || '').trim();
  }
  return '';
}

/**
 * v0.22.0 — 세션명 SSOT. 설정탭(prospectiveSessionLabel)·입력탭(buildAutoLabel)이 **이 단일 헬퍼**로
 * 통일된다(두 경로가 같은 결과를 내게 — SSOT 복구).
 *
 * 우선순위:
 *   1. `opts.customName`(사용자 자유입력 세션명) — trim 후 비어있지 않으면 **그대로** 반환(날짜 미접두).
 *   2. 생성일 + 세션 상수들(공백 join) — 예: `2026-06-25 강남호 A`(농가명+라벨 단일선택까지 포함).
 *   3. 상수가 하나도 없으면 생성일 단독 — 예: `2026-06-25`.
 *
 * 상수 join 순서는 columns 순서(스키마 정의 순)를 따른다. `isoDate` 미지정 시 오늘 날짜를 쓴다.
 */
export function buildSessionLabel(
  columns: Column[],
  opts?: { customName?: string | null; isoDate?: string },
): string {
  const custom = (opts?.customName ?? '').trim();
  if (custom) return custom;
  const isoDate = opts?.isoDate ?? new Date().toISOString().slice(0, 10);
  const parts = columns.map(sessionConstantValue).filter(Boolean);
  return parts.length > 0 ? `${isoDate} ${parts.join(' ')}` : isoDate;
}

/**
 * `base` 라벨이 `existingLabels`에 이미 있으면 `-2`, `-3`, … 를 붙여 처음으로 충돌하지 않는 라벨을
 * 돌려준다. 충돌이 없으면 `base`를 그대로 돌려준다. 비교는 trim 후 정확 일치.
 */
export function ensureUniqueSessionLabel(base: string, existingLabels: Iterable<string | undefined>): string {
  const taken = new Set<string>();
  for (const l of existingLabels) {
    const t = (l ?? '').trim();
    if (t) taken.add(t);
  }
  const baseTrim = base.trim();
  if (!taken.has(baseTrim)) return baseTrim;
  for (let n = 2; ; n++) {
    const candidate = `${baseTrim}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
