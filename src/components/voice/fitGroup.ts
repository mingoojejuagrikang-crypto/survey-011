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
  // 🔴 폭과 높이의 관용은 **서로 다른 문제**라 분리한다(v0.44.0 A1).
  //  - 폭: 잉크폭(float)을 직접 재므로 흡수할 것이 부동소수 오차뿐이다.
  //    종전 1px은 `text-overflow: ellipsis` 아래에서 **글자 한 자 전체 손실**로 증폭됐다
  //    (402×874 실측: 잉크 379.188 vs 배정 377.875 = +1.313px 초과인데 판정은 통과 →
  //     169.5px 폰트의 마지막 글자 112.97px이 `…`로 대체. 증폭비 86배).
  //  - 높이: `scrollHeight`/`clientHeight`(정수)를 그대로 쓰므로 서브픽셀·인라인 여백이
  //    상시 초과를 만든다. 여기 관용을 낮추면 2026-07-20의 "여유 230px에도 lo=0.58"
  //    오작동이 되살아날 위험이 **미확인**이라 종전값을 유지한다.
  const widthTolerancePx = 0.05;
  const heightTolerancePx = 1;
  // 잉크를 잴 수 없는 멤버에만 쓰는 폭 폴백의 관용. 종전 동작을 그대로 보존한다는 뜻이며,
  // heightTolerancePx와 값이 같은 것은 우연이다(둘은 서로 다른 이유로 1px이다).
  const fallbackWidthTolerancePx = 1;
  // 고정 px 상한을 다시 만들지 않으면서도 비정상 DOM에서 무한 probe하지 않게 읽기 횟수만 제한한다.
  const maxHighExpansions = 8;
  // 이진탐색이 멤버마다 수십 번 재므로 Range는 한 번 만들어 재사용한다.
  const range = typeof document !== 'undefined' ? document.createRange() : null;
  const writeScale = (variable: string, next: number) => {
    const value = Math.round(next * 10_000) / 10_000;
    const current = Number(container.style.getPropertyValue(variable));
    if (Number.isFinite(current) && Math.abs(current - value) < epsilon) return value;
    container.style.setProperty(variable, String(value));
    return value;
  };
  /** 어떤 계측기로 쟀는지를 DOM에 남긴다 — 폴백이 **조용히** 타면 아무도 모른다. */
  const markMeasuredBy = (member: HTMLElement, mode: 'ink' | 'scroll-width') => {
    if (member.dataset.fitMeasuredBy !== mode) member.dataset.fitMeasuredBy = mode;
  };

  /** 🔴 넘침을 **잉크폭**으로 판정한다(v0.44.0 A1 — 종전 `scrollWidth` 비교를 대체).
   *
   *  `scrollWidth`/`clientWidth`가 실제 넘침을 놓치는 경로가 둘 있고, 실측으로 확인됐다:
   *   ① **정수 반올림** — 잉크 379.188 → `scrollWidth` 379, 배정 377.875 → `clientWidth` 378.
   *      서브픽셀 초과가 반올림에 흡수된다.
   *   ② **`inline-flex` + `justify-content:center`의 좌측 오버플로를 못 본다** — LTR에서
   *      inline-start 오버플로는 스크롤 불가 영역이라 `scrollWidth`에 잡히지 않는다.
   *      402 실측(`✓종경` @200px): 좌 99.219 · 우 99.219(총 198.438)인데 감지량은 99뿐 =
   *      **실제 넘침의 1/2만 본다.** `HeroNameLine`이 정확히 이 형태다.
   *  `Range`는 둘 다 없다 — float이고, 좌측으로 삐져나간 잉크도 rect에 그대로 남는다.
   *  ⚠️ 다만 `Range`도 만능이 아니라 **폭 0인 자식을 union에서 빼먹는다** — 그래서 아래는
   *     폭이 아니라 좌우 **경계**로 판정한다(상세는 그 자리 주석).
   *
   *  ⚠️ 상한이 아니다. 넘쳤는지만 답하며, 안 넘치면 배율은 계속 위로 열려 있다. */
  const overflowsWidth = (member: HTMLElement) => {
    const style = getComputedStyle(member);
    const px = (value: string) => Number.parseFloat(value) || 0;
    const box = member.getBoundingClientRect();
    // 배정 구간 = border-box에서 border·padding을 뺀 콘텐츠 박스의 좌우 경계(float 유지).
    const contentLeft = box.left + px(style.borderLeftWidth) + px(style.paddingLeft);
    const contentRight = box.right - px(style.borderRightWidth) - px(style.paddingRight);
    if (range && contentRight > contentLeft) {
      range.selectNodeContents(member);
      const ink = range.getBoundingClientRect();
      // 텍스트가 없거나(빈 슬롯) 아직 레이아웃 전이면 0이 나온다 — 그때만 폴백한다.
      if (Number.isFinite(ink.width) && ink.width > 0) {
        markMeasuredBy(member, 'ink');
        // 🔴 **폭이 아니라 좌우 경계로 판정한다.** 잉크 폭만 보면 두 경로로 샌다:
        //  ⓐ 중앙 정렬 오버플로는 폭이 배정보다 작아도 한쪽으로 삐져나갈 수 있다.
        //  ⓑ `Range`는 **폭 0인 자식을 union에서 빼먹는다** — 402 실측: `HeroNameLine`의 ✓ span이
        //     `check-pop` 진행 중 폭 0이라, 잉크폭은 236.422(배정 377.875 안)로 보이는데
        //     실제 오른쪽 끝은 398.609로 배정 경계 389.938을 **8.67px 넘고 있었다**.
        //  경계로 재면 union이 일부만 잡혀도 「잡힌 것 중 하나라도 넘으면」 감지된다.
        return (contentLeft - ink.left) > widthTolerancePx
          || (ink.right - contentRight) > widthTolerancePx;
      }
    }
    // 폴백: 잉크를 잴 수 없는 멤버는 종전 경로를 그대로 쓴다(관용도 종전값 1px).
    // `data-fit-measured-by="scroll-width"`가 남으므로 테스트가 폴백 진입을 볼 수 있다.
    markMeasuredBy(member, 'scroll-width');
    return member.scrollWidth > member.clientWidth + fallbackWidthTolerancePx;
  };

  const fits = (members: readonly HTMLElement[]) => {
    // GL-007 원칙 4: 텍스트 실폭과 배정 폭을 먼저 대조한다.
    for (const member of members) {
      if (overflowsWidth(member)) return false;
    }
    return container.scrollHeight <= container.clientHeight + heightTolerancePx;
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
