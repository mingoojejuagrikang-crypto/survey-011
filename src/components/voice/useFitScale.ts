import { useLayoutEffect, useRef, type DependencyList } from 'react';

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
    const fits = () =>
      el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
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
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    ro?.observe(el);
    if (el.parentElement) ro?.observe(el.parentElement);
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
