import { useLayoutEffect, useRef, type DependencyList } from 'react';
import { overflowsWidth, overflowsHeight } from './fitGroup';

/** v0.27.0 입력탭(무스크롤 카드, Vance) — 음성반응 카드(이상치/일시정지/수정/hero)는 사용자가
 *  양손 측정 중이라 **스크롤할 수 없다**(민구 2026-07-03). 카드 콘텐츠는 흡수영역(grid row3,
 *  overflow:hidden) 가용 높이 안에 항상 전부 들어와야 한다(scrollHeight ≤ clientHeight).
 *
 *  전략(2단):
 *   1) CSS가 1차 — 폰트·간격을 clamp(min, vh/vw, max)로 뷰포트 비례화(다양한 화면 크기 자동 대응).
 *   2) 이 훅이 2차 가드 — 극단 케이스(긴 항목명+큰 음수, iOS 텍스트 확대[Dynamic Type], 가로모드)
 *      에서 CSS만으로 안 들어오면 카드 엘리먼트에 --fit-lo/--fit-hi 스케일 변수를 단계적으로 내려
 *      **실제 레이아웃 폰트 크기**를 줄인다(transform 아님 — scrollHeight가 진짜로 줄어든다).
 *
 *  정보 우선순위(GL-005): 현재값·알람 라벨 > 직전값·식별정보·안내문. --fit-hi는 (1+s)/2로 완만하게,
 *  --fit-lo는 s로 더 빠르게 줄어 하위 우선순위부터 축소된다. ellipsis 잘림 금지 — 줄바꿈+축소만.
 *
 *  성능: 카드는 한 번에 하나만 렌더되고 콘텐츠 변경도 드물다. 최대 8회 동기 reflow는 layout effect
 *  안(페인트 전)이라 플래시 없음. ResizeObserver/resize로 뷰포트·텍스트 확대 변화에 재수렴한다. */
const FIT_STEPS = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58] as const;

/** 중앙 hero는 남는 흡수영역을 원거리 가독성에 사용한다. 큰 단계부터 실제 영역 적합 여부를
 *  확인하므로, 짧은 화면에서는 기존 1 이하 단계로 자동 복귀한다. 일반 카드 기본값에는 영향 없다. */
export const HERO_FIT_STEPS = [1.18, 1.1, ...FIT_STEPS] as const;

/** v0.28.0 — 이상치 카드 375×667 무스크롤 실패(2026-07-06 Sonar 데스크탑 재현 QA) 수정: 이상치
 *  카드는 일반 카드보다 콘텐츠가 많아(샘플키+추세라벨+직전→현재+안내문) 공용 FIT_STEPS 최저(0.58)
 *  로도 375px급 최소 지원 화면에서 다 안 들어간다(실측 scrollHeight 131 vs clientHeight 77).
 *  공용 FIT_STEPS는 다른 카드(PausedCard/ModifyIndicatorPill/VoiceHero, 전부 375/412/430 기존
 *  PASS)에 영향 주지 않기 위해 그대로 두고, 이 훅의 두 번째 인자로 **호출자 전용 확장 단계**를
 *  넘길 수 있게 한다. 이미 더 큰 앞 단계에서 fits()가 성사되는 카드는 이 확장 구간에 아예
 *  도달하지 않으므로(루프가 첫 성공에서 break) 회귀 위험이 없다. 각 텍스트 스타일 쪽에서
 *  `max(floor, calc(... * var(--fit-lo)))`로 절대 하한을 걸어야 한다(호출자 책임) — 이 훅 자체는
 *  단계 배열만 넓힐 뿐, 하한 없는 무한 축소를 만들지 않는다.
 *
 *  v0.28.0 — 세 번째 인자 `hiWeight`(기본 0.5, 기존 `(1+s)/2`와 동일)로 --fit-hi가 --fit-lo를
 *  얼마나 완만하게 따라가는지 호출자별로 조절할 수 있다. **s=1(압축 불필요, 기존 PASS 카드가
 *  머무는 지점)일 때는 hiWeight 값과 무관하게 항상 hi=1**이므로(`1 + (1-1)*hiWeight = 1`), 이미
 *  1단계에서 fits()가 성사되는 카드(PausedCard/ModifyIndicatorPill/VoiceHero, 기본 hiWeight 호출)는
 *  이 매개변수를 아예 안 써도 100% 동일하게 동작한다 — 회귀 위험 없음. 이상치 카드처럼 s<1까지
 *  내려가야 하는 카드만 더 작은 hiWeight로 P1 요소(현재값)를 조금 더 따라 내려가게 해, 그래도
 *  자체 `max(floor,...)` 하한 밑으로는 안 내려간다(호출자 책임 불변). */
export function useFitScale<T extends HTMLElement>(
  deps: DependencyList,
  steps: readonly number[] = FIT_STEPS,
  hiWeight = 0.5,
) {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    // 🔴 v0.44.0 A2 — 폭 판정을 `fitGroup.ts`의 `overflowsWidth`와 **공유**한다.
    //  종전에는 `el.scrollWidth <= el.clientWidth + 1`을 여기 따로 적었다. A1이 신 훅
    //  (`fitGroup.ts`)만 고치면서 **같은 근본원인이 이 구 훅에 그대로 남았고**, 구 훅이 발행하는
    //  `--fit-lo`/`--fit-hi`를 쓰는 화면은 A0가 밝힌 결함을 계속 안고 있었다(`[TEAMOPS-47]` —
    //  같은 판정이 두 곳에 살면 갈라진다). 판정을 복제하지 않고 한 함수를 부른다.
    //  ⚠️ **탐색 로직은 공유하지 않는다** — 여기는 이산 단계(`steps`) 순차, 신 훅은 이진탐색이다.
    //  ⚠️ 높이 관용(1px)은 A2에서 손대지 않았다 — 2026-07-20 "여유 230px에도 lo=0.58" 재발 위험이
    //     미확인이라, 같은 기준을 쓰되 값은 종전 그대로다.
    const fits = () => !overflowsHeight(el) && !overflowsWidth(el);
    const fit = () => {
      for (const s of steps) {
        el.style.setProperty('--fit-lo', String(s));
        el.style.setProperty('--fit-hi', String(Math.round((s + (1 - s) * hiWeight) * 100) / 100));
        if (fits()) break;
      }
    };
    fit();
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };
    // ── RO 자기관측 제거 — 피드백 가능성을 줄이는 **방어적 단순화** ──────────────
    // 종전엔 `ro.observe(el)`과 `ro.observe(el.parentElement)`를 **동시에** 걸었다. fit()은 el의
    // `--fit-lo/--fit-hi`를 바꿔 **el 자신의 박스를 바꾸므로** 원리상 RO 재발화 → fit() → … 피드백
    // 루프의 여지가 있다. useChipFlowFit이 같은 위험을 "자기가 바꾸는 차원은 관측하지 않는다"로
    // 이미 해결했고, 여기도 같은 형태로 맞춘다.
    //
    // ⚠️ 이것이 회전 진동(fb-01 후반부)의 **원인 수정이라는 근거는 없다 — 오히려 반증됐다.**
    //    자기관측을 되돌린 상태로 회전 전후 `--fit-lo`를 25ms 간격 2초간 샘플링해도 시계열은
    //    무변동, style 재기록 0건이었다. fit()은 후보 단계를 **적용한 뒤** 측정하므로 선택이
    //    자기일관적이고, RO가 재발화해도 같은 단계로 수렴한다. 즉 이 경로는 실측상 진동하지 않았다.
    //    **회전 진동의 실제 원인은 미확정이며 실기기 게이트로 남아 있다** — 여기 코드가 그 증상을
    //    해결했다고 가정하지 마라(재발 시 다른 축부터 의심할 것).
    //
    // 여기서는 **자기 관측을 버리고 부모(가용 박스)만 본다.** 이 훅의 입력은 "부모가 준 가용
    // 크기"뿐이고, 부모(중앙 50% 트랙)의 크기는 자식 폰트 크기에 의존하지 않으므로 루프가
    // 구조적으로 성립하지 않는다. 부모 contentRect에 epsilon dedupe를 걸어 서브픽셀 재발화도
    // 막는다. 부모가 없으면(이론상) window resize 폴백만 남는다.
    const parent = el.parentElement;
    let observedW = parent ? parent.getBoundingClientRect().width : 0;
    let observedH = parent ? parent.getBoundingClientRect().height : 0;
    const ro = typeof ResizeObserver !== 'undefined' && parent
      ? new ResizeObserver(([entry]) => {
          const rect = entry?.contentRect;
          const w = rect?.width ?? parent.getBoundingClientRect().width;
          const h = rect?.height ?? parent.getBoundingClientRect().height;
          if (Math.abs(w - observedW) < 0.5 && Math.abs(h - observedH) < 0.5) return;
          observedW = w;
          observedH = h;
          schedule();
        })
      : null;
    if (parent) ro?.observe(parent);
    window.addEventListener('resize', schedule);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
