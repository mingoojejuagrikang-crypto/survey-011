/**
 * v0.46.0 WP-J J-5 — 컬럼별 **선택지 제외 목록**(민구 R11 확정)과 리스트 컬럼 보강의 SSOT.
 *
 * 계약:
 *  - 사용자가 선택지를 지우면(J-4) 그 값이 컬럼별 제외 목록에 들어간다.
 *  - 이후 **시트 자동 갱신이 그 값을 다시 넣지 않는다** ("한 번 지우면 계속 유지").
 *  - 「설정 초기화」는 제외 목록도 비운다(settingsStore.inputSettingsResetPatch) → 다음 갱신에서
 *    시트 기준으로 전부 재생성. 그래서 초기화가 *"리스트를 잃는 사고"* 가 아니라
 *    *"선택지를 시트 기준으로 새로 받는 정상 동작"* 이 된다.
 *
 * 제외 목록이 `Column` 안이 아니라 **스토어 최상위 맵**인 이유: 시트 재유추가 컬럼 배열을 통째로
 * 갈아끼워도 살아남아야 하고(컬럼 안에 두면 자동 갱신이 제외 목록을 지워 R11이 깨진다),
 * `Column`에 필드를 늘리면 보존 필드를 나열하는 `columnFlags.ts`(다른 레인 소유)를 만져야 한다.
 *
 * 브라우저 의존이 없어 Node 단위 테스트에서 직접 import 가능(columnFlags.ts 패턴).
 */
import type { Column } from '../types';

/** colId → 그 컬럼에서 사용자가 지운 값들. */
export type OptionExclusions = Record<string, string[]>;

export function excludedFor(map: OptionExclusions, colId: string): string[] {
  return map[colId] ?? [];
}

/** 제외 목록을 적용해 거른다. 제외가 없으면 원본을 그대로 돌려준다(불필요한 새 배열 방지). */
export function applyExclusions(values: string[], excluded: readonly string[]): string[] {
  if (excluded.length === 0) return values;
  const drop = new Set(excluded);
  return values.filter((v) => !drop.has(v));
}

/** 값을 제외 목록에 넣는다(중복 없음). 이미 있으면 원본 맵을 그대로 돌려준다. */
export function withExclusion(map: OptionExclusions, colId: string, value: string): OptionExclusions {
  const prev = excludedFor(map, colId);
  if (prev.includes(value)) return map;
  return { ...map, [colId]: [...prev, value] };
}

/**
 * 값을 제외 목록에서 뺀다(= 사용자가 지웠던 값을 다시 추가). 빼고 나서 비면 **키 자체를 지운다** —
 * 빈 배열이 남으면 "제외가 있는 컬럼"으로 오인돼 영속 데이터에 쓰레기가 쌓인다.
 */
export function withoutExclusion(map: OptionExclusions, colId: string, value: string): OptionExclusions {
  const prev = excludedFor(map, colId);
  if (!prev.includes(value)) return map;
  const rest = prev.filter((x) => x !== value);
  const next = { ...map };
  if (rest.length) next[colId] = rest;
  else delete next[colId];
  return next;
}

/**
 * 리스트(`options`) 컬럼의 선택지를 시트 고유값으로 보강하고 제외 목록을 적용한다.
 *
 * `fetchUnique`를 주입받는 이유: 네트워크를 모르는 순수 함수로 두어 Node에서 계약(정렬·제외·
 * 실패 폴백)을 직접 잴 수 있게 하기 위함이다.
 * ⚠️ 조회가 **실패해도** 기존 available에 같은 제외 필터를 적용한다 — 안 그러면 사용자가 지운
 * 값이 네트워크 오류 한 번에 조용히 되살아난다.
 */
export async function enrichOptionColumns(
  columns: Column[],
  exclusions: OptionExclusions,
  fetchUnique: (colIndex: number) => Promise<string[]>,
): Promise<Column[]> {
  return Promise.all(
    columns.map(async (c, i) => {
      if (c.type !== 'options' || c.auto.kind !== 'options') return c;
      const excluded = excludedFor(exclusions, c.id);
      let available = applyExclusions(c.auto.available, excluded);
      try {
        available = applyExclusions(await fetchUnique(i), excluded);
      } catch {
        /* 조회 실패 — 표본에서 나온 available을 그대로 쓴다 */
      }
      return {
        ...c,
        auto: {
          kind: 'options' as const,
          available,
          selected: applyExclusions(c.auto.selected, excluded),
        },
      };
    }),
  );
}
