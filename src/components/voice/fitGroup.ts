export interface FitGroupElements {
  variable: `--fit-${string}`;
  members: readonly HTMLElement[];
  /** CSS 기준값이 아니라, 열린 탐색의 첫 probe를 배정 영역에서 유도하는 최소 기준 px. */
  searchBasePx: number;
  minScale?: number;
  /** 앞 그룹 탐색 중 이 그룹에 미리 보장할 배율. 이 그룹 자신의 상한은 아니다. */
  reserveScale?: number;
}

export interface FitGroupsInput {
  container: HTMLElement;
  /** 앞 그룹이 공간을 먼저 가져간다. */
  groups: readonly FitGroupElements[];
  iterations?: number;
}

/** 그룹별 최대 fit 배율을 우선순위 순서로 확정한다. 브라우저 DOM에서도 직접 반증할 수 있는 코어. */
export function fitGroups({
  container,
  groups,
  iterations = 10,
}: FitGroupsInput): Record<string, number> {
  const epsilon = 0.0001;
  const tolerancePx = 1;
  // 고정 px 상한을 다시 만들지 않으면서도 비정상 DOM에서 무한 probe하지 않게 읽기 횟수만 제한한다.
  const maxHighExpansions = 8;
  const writeScale = (variable: string, next: number) => {
    const value = Math.round(next * 10_000) / 10_000;
    const current = Number(container.style.getPropertyValue(variable));
    if (Number.isFinite(current) && Math.abs(current - value) < epsilon) return value;
    container.style.setProperty(variable, String(value));
    return value;
  };
  const fits = (members: readonly HTMLElement[]) => {
    // GL-007 원칙 4: 텍스트 실폭과 배정 폭을 먼저 대조한다.
    for (const member of members) {
      if (member.scrollWidth > member.clientWidth + tolerancePx) return false;
    }
    return container.scrollHeight <= container.clientHeight + tolerancePx;
  };

  const result: Record<string, number> = {};
  for (const group of groups) {
    const initial = group.members.length > 0 ? (group.reserveScale ?? group.minScale ?? 0.25) : 1;
    result[group.variable] = writeScale(group.variable, initial);
  }

  for (const group of groups) {
    if (group.members.length === 0) continue;
    let low = group.minScale ?? 0.25;
    // 최대 px 상수가 아니라 현재 배정 영역으로부터 매번 첫 probe를 만든다.
    let high = Math.max(container.clientWidth, container.clientHeight) / group.searchBasePx + 1;
    writeScale(group.variable, high);
    let highFits = fits(group.members);
    // 첫 probe가 맞아도 그것을 상한으로 간주하지 않는다. 실패 경계를 찾을 때까지 위로 연다.
    for (let step = 0; highFits && step < maxHighExpansions; step += 1) {
      low = high;
      high *= 2;
      writeScale(group.variable, high);
      highFits = fits(group.members);
    }
    if (highFits) {
      // 읽기 예산 안에서 실패 경계를 못 찾은 극단값. 마지막으로 실제 fit이 확인된 값만 채택한다.
      result[group.variable] = high;
      continue;
    }
    writeScale(group.variable, low);
    if (!fits(group.members)) {
      result[group.variable] = low;
      continue;
    }
    for (let i = 0; i < iterations; i += 1) {
      const candidate = (low + high) / 2;
      writeScale(group.variable, candidate);
      if (fits(group.members)) low = candidate;
      else high = candidate;
    }
    result[group.variable] = writeScale(group.variable, low);
  }
  return result;
}
