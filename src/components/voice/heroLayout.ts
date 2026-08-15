/** v0.23.0 입력탭#1(중앙 흡수, Vance) — 중앙 흡수영역 카드들이 공유하는 레이아웃 헬퍼.
 *  VoiceHero(VoiceScreen)와 ModifyIndicatorPill(components/voice)이 같은 타이포 스케일을 쓰도록
 *  SSOT로 분리(순환 import 방지 — VoiceScreen이 컴포넌트를 import하므로 헬퍼는 별도 모듈). */

/** UI-a 타이포 하한과 scale=1 기준값. 최소 가독값은 미확정이라 현행값을 한 상수에 보존한다. */
export const HERO_MIN_FONT_PX = { name: 22, value: 26, interim: 24 } as const;
export const HERO_BASE_FONT_PX = { name: 34, value: 64, interim: 44 } as const;
const COMPLETE_SUMMARY_MIN_FONT_PX = 24;
export const COMPLETE_SUMMARY_BASE_FONT_PX = 40;
/** 알람 중 실시간 인식값의 이진탐색 첫 probe 유도값(상한이 아니다 — `STATE_TYPE.alarmInterim` 참조). */
export const STATE_ALARM_INTERIM_BASE_PX = 44;
/** 완료 화면 커밋 영수증(`✓ 항목명 값`). 종전 `clamp(17px, …, 26px)`의 하한·기준을 이어받는다
 *  — 🔴 **26px 상한은 v0.46.0 WP-B가 삭제했다**(`STATE_TYPE.completeReceipt` 참조). */
const COMPLETE_RECEIPT_MIN_FONT_PX = 15;
export const COMPLETE_RECEIPT_BASE_FONT_PX = 17;

/** 🔴 프로덕션 라벨 예약용 잠정 하한 — ui-standard §7-2의 민구 확정값이 오면 이 한 곳을 대체한다.
 *  ba87426 402px 실측 61.67px의 90%를 보존하며, 상한이 아니므로 fit은 더 커질 수 있다. */
const HERO_LABEL_PROVISIONAL_RESERVE_PX = 55;

/** 회귀 대조용 실측 기준선. compact는 테스트 오라클 전용이며 fit 기제 입력이 아니다. */
export const HERO_LABEL_BASELINE_PX = {
  standard: HERO_LABEL_PROVISIONAL_RESERVE_PX,
  compact: 48,
} as const;
export const HERO_LABEL_RESERVE_SCALE =
  HERO_LABEL_PROVISIONAL_RESERVE_PX / HERO_BASE_FONT_PX.name;

/** ba87426 슬롯식 `max(72px, …)`의 첫 항을 보존한다. 당시 빈 슬롯 실측 높이는 72px가 아니라
 *  402에서 161px·375에서 142px였고 둘째 항이 이겼다. content-sizing에서는 긴 interim의 실제
 *  line box가 72px보다 작을 때 이 floor가 물려 값 변화의 중심 이동을 흡수한다. 폰트 목표/상한은 아니다. */
export const HERO_VALUE_SLOT_MIN_PX = 72;

/** fit 배율과 함께 열리는 hero 행간. ba87426의 clamp(8px,1.6vh,18px)(402에서 13.98px)를
 *  대체한다. vw/vh 제거로 기준이 8px가 되어 402에서 약 6px 좁아졌으며, 이 값을 SSOT로 둔다. */
export const HERO_GAP_PX = { min: 4, base: 8 } as const;

const fittedHeroType = (minPx: number, basePx: number, variable: string) =>
  `max(${minPx}px, calc(${basePx}px * var(${variable}, 1)))`;

/** v0.43.0 UI-a — hero 타이포 SSOT. 사람은 하한과 기준값만 정하고, 배정 영역이 실제 크기를 정한다.
 *  하드코딩 최대 px와 vw/vh 비례항은 없다. useFitGroup이 실제 렌더 폭·전체 높이로 scale을 찾는다.
 *  **항목명 크기는 모든 상태(listening/confirm/review/reask)에서 동일**해야 한다 — 민구 지적:
 *  "상태에 따라 식별이 불가할 만큼 작아지는 경우가 존재". 상태별 인라인 정의 금지, 여기 상수만 소비.
 *  그룹별 변수는 같은 계열 멤버가 한 배율을 공유하게 한다. */
export const HERO_TYPE = {
  name: fittedHeroType(HERO_MIN_FONT_PX.name, HERO_BASE_FONT_PX.name, '--fit-label'),
  value: fittedHeroType(HERO_MIN_FONT_PX.value, HERO_BASE_FONT_PX.value, '--fit-value'),
  interim: fittedHeroType(HERO_MIN_FONT_PX.interim, HERO_BASE_FONT_PX.interim, '--fit-value'),
} as const;

/** 칩 내부 타이포 SSOT. HERO_TYPE과 같은 뷰포트 양축 + fit 배율 계약을 따른다.
 *  값이 주인공인 위계는 유지하되, rounded rect가 회수한 세로 공간을 항목명 크기로 돌려준다. */
export const CHIP_TYPE = {
  // 항목명은 값 이하에서 최대한 키운다(민구 제보 #6). 양축 비례항과 50px 상한 모두 value보다
  // 작아서, 어떤 뷰포트에서도 2행 값의 시각 위계를 뒤집지 않는다(402×874: name 46.23 / value 52px).
  // 🔴 §C1(2026-08-03) — 세로 항을 `6.5vh`(뷰포트)에서 `cqh`(칩존 트랙)로 옮겼다.
  //   **`ChipZone.tsx:21-24`가 이미 그걸 설계로 적어놨는데 글자만 안 따르고 있었다** —
  //   padding·minWidth·maxWidth는 `cqh`/`cqw`인데 fontSize만 뷰포트 비례라 비대칭이었다.
  //   그래서 칩존 배분을 줄여도 글자가 안 줄어 **`overflow:hidden`이 잘라냈다**(v037 방어②가
  //   재는 바로 그 형태). 실측: 390×568 현행 20%에서 이미 15/15 칩이 세로 5px 넘쳤고
  //   `min(11.5vw, 6.5vh)`·`min(13vw, 6.5vh)`가 **둘 다 6.5vh로 수렴해 36.92px로 같아져**
  //   항목명/값의 시각 위계까지 사라져 있었다.
  //   🔴 **`min(높이항, 폭항)`이 아니라 「두 축의 합」이다 — 민구 지적(2026-08-03).**
  //   `min()`은 **둘 중 하나만 쓴다.** 높이항이 이기는 순간 폭 변화를 완전히 무시하므로,
  //   높이가 같고 폭만 다른 두 기기(375×667 → 430×667)에서 글자가 **한 톨도 안 커진다** —
  //   `v019-active-layout:264`가 그걸 잡았다(민구 계약: *"기기 변경 되어도 일정 비율로
  //   조절되어서 어색하지 않아야 함"* — `ChipZone.tsx:22`).
  //   👉 **두 축을 더하면 어느 한 축만 커져도 반드시 커진다.** 폭 반응이 구조에서 나온다.
  //
  //   🔴 **그 합에 `min(N cqh, …)` 높이 상한을 씌운다 — 없으면 넓고 낮은 창에서 잘린다.**
  //   폭 항은 폭에 비례해 자라는데 칩 높이는 칩존(=높이)에만 묶여 있다. 상한이 없으면
  //   1920×400 같은 납작한 창에서 글자가 행 높이를 넘는다. **72개 창 비율 스윕에서 26건이
  //   잘렸고, 이 상한을 넣자 0건이 됐다**(`tests/v0440-chip-viewport-sweep.spec.ts`).
  //   민구 요구(2026-08-03): *"데스크탑 크롬에서 화면 비율을 **어떻게 변경해도** 잘리거나
  //   넘어서지 않아야 한다 — 데스크탑에서 어느 비율에서도 완벽하면 폰·태블릿도 잘 보인다."*
  //
  //
  //   🔴 **가로 상한(`N cqw`)도 대칭으로 필요하다 — 감사(2026-08-03)가 잡았다.**
  //   세로가 길면 `cqh` 항이 글자를 키우는데 **가로 예산은 그대로다**
  //   (`ColumnChip.tsx:105 maxWidth:'96cqw'` + `:120,:167 nowrap` + `:109 overflow:hidden`).
  //   그래서 **좁고 긴 창**에서 글자가 칩 밖으로 나간다 — 320×1200에서 값이 **156px 소실**
  //   (날짜 `YYYY-MM-DD` 10자는 `autoValue.ts:38-45`가 실사용자에게 그대로 내보내는 값이다).
  //   스윕에서 6/72 → 0/72. 세로 상한만 있고 가로 상한이 없던 것이 비대칭이었다.
  //
  //   ⚠️ **하한 `max()`를 상한 `min()` 안에 두는 순서가 중요하다.** 바깥이 `min`이라
  //   극단(칩존 41px 등)에서는 **상한이 하한을 이긴다** — 글자가 계약 하한보다 작아지더라도
  //   **잘리지는 않는다.** 민구 요구의 우선순위가 「잘리지 않는 것」이라 이렇게 정렬했다.
  //   그 구간은 스윕이 "하한 발동"으로 세어 보고한다(400px 높이대 9건, 실패 아님).
  //   ⚠️ 계수를 그냥 옮기면 안 된다 — `vw`는 **뷰포트 폭**(402)이지만 `cqw`는 컨테이너의
  //   **content box 폭**(402 − 좌우 padding 24 = 378)이라 같은 계수가 6.35% 작게 나온다.
  //   `cqh`도 같다(트랙 박스 146.19가 아니라 content 139.19 기준 = 칩 높이와 같다).
  //   계수는 402×874 현재 렌더값을 재현하도록 역산했다(46.23 / 52.26 / 40.2 — 회귀 0 확인).
  //   🔴 이 역산값을 하한으로 굳히지 마라 — `R2`가 터진 방식이다. 하한은 아래 `max()`의
  //   가독 한계(12/16/18px)와 `max()` 첫 항(14/18/22px)이고, **현재 렌더값이 아니다.**
  //   상한 `50/52/42px`는 제거했다(ui-standard 규칙 2 — 영역이 크기를 정한다).
  //   `cqh`는 상한이 구조적으로 필요 없다: 트랙이 커져야 글자가 커진다.
  name: 'calc(min(42cqh, 12.5cqw, max(14px, 37.25cqh + 0.5cqw)) * var(--fit-lo, 1))',
  inputValue: 'calc(min(41cqh, 11cqw, max(18px, 32.9cqh + 0.44cqw)) * var(--fit-hi, 1))',
  value: 'calc(min(47cqh, 14cqw, max(18px, 41.65cqh + 0.56cqw)) * var(--fit-hi, 1))',
} as const;

/** 입력화면 공간 배정 — 🔴 **칩존 20% / 중앙 50% / 하단 30%** (v0.43.0 UI-b).
 *  현행 SSOT는 `deliverables/2026-07-31-survey-011-v0430-ui-standard.md` §2다.
 *  (구 와이어프레임 `Deliverables/2026-07-24-…-active-screen-wireframe.md`의 25/50/25를 대체한다)
 *
 *  🔴 비율의 분모는 **ActiveState 자신의 높이에서 상단 행/진행 스트립을 뺀 나머지**다.
 *  구 와이어프레임 목업에서 칩존 격벽은 행/진행 스트립 **아래**에서 시작하고, 하단 nav
 *  (설정/입력/데이터/개선)는 하단 구역 안에 그려져 있지만 실제 nav는 App 레벨(TabBar)이라
 *  ActiveState 박스 밖이다. 테스트도 `window.innerHeight`가 아니라 이 박스 높이를 분모로 써야 한다.
 *  ---
 *  🔴 v0.43.0 UI-b — **20 / 50 / 30 으로 바꿨다** (ui-standard §2, 민구 확정).
 *  하단을 30%로 올리라는 지시에 대해 **중앙을 지키려고 칩존에서 5%p를 뺐다.** 칩은 한 행 +
 *  가로 스크롤이라 높이 손실을 흡수한다는 것이 근거이고, **그 근거가 T3 7회차 위험**이다
 *  (`v037-chip-2row`의 잘림 가드가 기계로 지킨다 · plan §7:809-811).
 *
 *  ⚠️ **UI-b가 한 일은 「하단 30% 확보」뿐이다.** ui-standard §2는 하단을 1행(도트·파형 20%)과
 *  2행(버튼 10%)으로 나누지만, 현재 `ActiveControlBar`는 `[‹][도트·파형][›]`가 **한 행에
 *  가로로** 놓인 구조(`voice-nav-row`, `flex-direction: row`)라 세로로 나눌 그릇이 없다.
 *  🔴 **버튼 높이는 안 건드렸다** — `EdgeButton`의 `min(100%, 56px)`이 그대로 살아 있고,
 *  그 `56px`은 규칙 2가 금지하는 하드코딩 상한이다.
 *  👉 **UI-e가 하단 2행 구조 전환과 `56px` 제거를 함께 처리해야 한다.** 지금 10%를 nav row에
 *  물리면 기준이 하단 트랙이 아니라 nav row가 되어 새 하드코딩만 는다. */
export const ACTIVE_ZONE_RATIOS = {
  /** 🔴 §C1(2026-08-03) — 칩존 20 → **16** (F20 "칩존 영역을 지금의 80% 선으로", 민구 확정 §4-a).
   *  빠진 4는 `bottom`이 받는다(30 → 34): `center: 50`은 `v0440-zone-ratios` 층2가 **불변으로
   *  단언**하고 합은 `assertZoneRatios`가 100으로 강제하므로 **다른 배분지가 없다.**
   *  ⚠️ **이것으로 §C5-b가 끝나지 않는다.** 하단 트랙이 34%가 된 것까지가 여기 몫이고,
   *  그 안에서 도트행이 pool의 24%를 갖는 것은 **아직 아니다**(실측 402=16.7% · 640=18.5%).
   *  `ActiveControlSteppers`의 접힌 토글이 **약 49px를 고정으로 먹기 때문**이고, 그건
   *  §B2 오라클이 *"4구역 모델에 없는 존재"* 로 이미 기록해둔 구조다
   *  (`v0440-zone-ratios.spec.ts:60-63`). 그 49px를 회수하거나 F08대로 TabBar를 최하단으로
   *  옮겨 공간을 확보하는 것이 **§C5-b 몫**이다 — 층2의 `bottomRow1` 단언도 "(§C5-b 대상)"이라
   *  적혀 있다. 🔴 여기서 bottom을 더 키워 맞추려 하지 마라: `center: 50` 불변 + 합 100이라
   *  자리가 없고, 늘리면 F08이 금지한 "버튼에 영역 넘겨주기"가 된다. */
  base: { chip: 16, center: 50, bottom: 34 },
  /** 수정 입력 — 키패드가 4행이라 하단이 커진다(136px면 버튼 34px로 iOS 권장 44px 미달, 272px면 61px). */
  modify: { chip: 20, center: 30, bottom: 50 },
  /** 일시정지·저장 확인 — 하단 도트가 없으므로 **중앙이 회수한다.** */
  dotless: { chip: 20, center: 70, bottom: 10 },
} as const;

/** 🔴 배분 합이 100이어야 한다 — **모듈 로드 시 fail-fast.**
 *  `fr`은 **비율**이라 합이 110이어도 grid가 조용히 정규화해 렌더한다(20:60:30 → 18.2/54.5/27.3%).
 *  즉 잘못된 값이 화면을 바꾸면서 **아무 신호도 안 낸다.**
 *  ⚠️ 이 상수가 테스트 전용이던 동안엔 무해했으나, `ACTIVE_ZONE_ROWS` 생성 입력이 되면서
 *  **제품 위험이 됐다**(Codex 리뷰 2R 지적). UI-e가 `modify`/`dotless`를 배선할 때 걸린다. */
function assertZoneRatios(ratios: typeof ACTIVE_ZONE_RATIOS): void {
  for (const [name, r] of Object.entries(ratios)) {
    const sum = r.chip + r.center + r.bottom;
    if (sum !== 100) {
      throw new Error(
        `ACTIVE_ZONE_RATIOS.${name}의 합이 ${sum}이다(100이어야 한다). ` +
        `fr은 비율이라 합이 틀려도 조용히 정규화되어 렌더된다 — ui-standard §2를 확인해라.`,
      );
    }
  }
}
assertZoneRatios(ACTIVE_ZONE_RATIOS);

/** 백분율 → 그리드 트랙. `minmax(0, …)`는 `1fr`의 auto minimum(콘텐츠 최소 크기)을 없앤다.
 *  합이 100임을 위에서 보장하므로 `pct / 10`은 세 트랙 합이 항상 `10fr`이 된다. */
export const zoneTrack = (pct: number) => `minmax(0, ${pct / 10}fr)`;

/** ui-standard §2 배분을 상태에 맞는 그리드 트랙으로 만든다.
 *  🔴 **`ACTIVE_ZONE_RATIOS`에서 생성한다 — 손으로 적은 `2fr 5fr 3fr`이 아니다.**
 *  종전엔 둘이 따로 있어 상수와 트랙이 갈라질 수 있었고, 더 나쁘게는 **테스트가 그 상수를 읽어
 *  기대값을 만들고 있었다.** 제품과 테스트를 같은 diff로 바꾸면 25/50/25 후퇴도 green이 된다
 *  (Codex 리뷰 🔴-1이 실측으로 반증했다: 둘을 함께 되돌리자 `v039` 2/2 통과).
 *  👉 배분의 SSOT는 위 상수 하나이고, **테스트는 이걸 읽지 않고 설계 계약을 직접 고정한다.**
 *
 *  UI-e3는 수동 수정 입력에 `modify`만 배선한다. `dotless`는 저장 확인 전용이며 UI-e4 범위다. */
export type ActiveZoneMode = keyof typeof ACTIVE_ZONE_RATIOS;

export const activeZoneRows = (mode: ActiveZoneMode) => {
  const ratios = ACTIVE_ZONE_RATIOS[mode];
  return `auto ${zoneTrack(ratios.chip)} ${zoneTrack(ratios.center)} ${zoneTrack(ratios.bottom)}`;
};

/** 기본 활성 화면의 기존 공개 계약. 상태 배선은 `activeZoneRows`를 사용한다. */
export const ACTIVE_ZONE_ROWS = activeZoneRows('base');

/** UI-e1 — 하단 트랙 안에서 버튼 행이 갖는 몫(ui-standard §2의 20:10 = `1/3`).
 *  `ActiveControlBar`가 인디케이터 행과 행동행을 세로로 분리해 이 값을 직접 물려받는다. */
/** 🔴 §C1(2026-08-03) — `1/3`에서 내렸다. 하단 트랙이 30 → 34가 됐으므로 버튼 행이 pool의
 *  **10%를 그대로 유지**하려면 몫이 `10/34`여야 한다(`34 × 10/34 = 10`).
 *  F08이 *"하단 4버튼에 영역 넘겨주지 말 것"* 이라고 명시 금지했고 층2 오라클도
 *  `bottomRow2 == 0.10`을 **불변**으로 단언한다 — `1/3`을 그대로 두면 버튼이 11.3%로 **늘어난다.**
 *  ⚠️ 이 상수는 모드 공용이라 `modify`·`dotless`의 버튼 행 몫도 함께 내려간다
 *  (modify 16.7% → 14.7% · dotless 3.33% → 2.94%, 둘 다 pool 대비). 두 모드의 3구역 비율
 *  자체는 안 건드렸고 `minHeight: 44`가 하한을 받는다 — 실측은 §C1 산출물, 후속은 TODO 등재. */
export const CONTROL_ROW_FRACTION = 10 / 34;

/** 와이어프레임 §[2]·§[4] — 중앙 50%가 hero 말고 다른 정보를 그릴 때 쓰는 타이포 SSOT.
 *  HERO_TYPE과 같은 계약: 절대 px 단독 금지(전부 clamp + min(vw,vh) 비례 + --fit 배율),
 *  **상태별 인라인 폰트 정의 금지**(민구 지적: "상태에 따라 식별이 불가할 만큼 작아지는 경우"). */
export const STATE_TYPE = {
  /** 경보행 `<추세|범위>알람 : <넘어선 정도>` — 값 **위**에 오고 값을 가리지 않는다(§[2]).
   *
   *  🔴 **v0.46.0 WP-B — 계약이 바뀌었다**(민구 확정 08-05, 안 (a)):
   *  종전 `max(17px, calc(clamp(22px, min(6.6vw,3.6vh), **36px**) * var(--fit-lo, 1)))`
   *  → **`36px` 고정 상한 삭제 + 뷰포트 비례 기준을 고정 기준px로 교체 + 축소 전용 `--fit-lo`를
   *    열린 `--fit-alarm-label`로 교체.** 이제 크기는 배정 영역이 정한다(ui-standard 규칙 2).
   *  ⚠️ 상한만 지우는 처방으로는 안 됐다 — 402×874에서 상한은 **애초에 비활성**이었는데
   *     (`min(6.6vw=26.5, 3.6vh=31.5)` = 26.5 < 36) 하한 오라클이 red였다. 진짜 막은 것은
   *     **축소 전용 배율**이다(`--fit-lo`는 `useFitScale`이 내리며 1을 넘지 않는다).
   *  🔴 함께 바뀐 것: `AnomalyAlertPopup`의 경보행이 **`nowrap` 한 줄**이 된다. 종전
   *     `wordBreak:keep-all`/`overflowWrap:anywhere`로 줄바꿈하던 것을 바꾼 이유는,
   *     **줄바꿈 텍스트는 폭이 배율을 못 묶기 때문**이다 — 글자를 키우면 줄 수만 늘어
   *     `fitGroups`의 상향 탐색이 끝까지 열려 버린다. 값 대표라인(`HeroPrimaryLine`)이
   *     이미 쓰는 계약(`nowrap` + `ellipsis` + fit)과 같은 형태로 맞춘 것이다. */
  alarmLabel: fittedHeroType(17, 22, '--fit-alarm-label'),
  /** 2열 비교의 열 라벨(`mm-dd` / `현재`). 402px 폭에서 56px이고, 더 넓은 영역에서는
   *  함께 커진다. `clamp(..., max)`를 다시 넣으면 T6의 상한 재발이다.
   *  v0.44.0 §C0 — `--fit-compare-label`(AnomalyAlertPopup의 `useFitGroup`)이 각 칸 폭 안에
   *  들어가도록 배율을 내린다. 22px 하한은 그대로 기준값이 아니라 바닥이다. */
  compareLabel: 'max(22px, calc(13.93vw * var(--fit-compare-label, 1)))',
  /** 2열 비교의 값 — 402px 폭에서 78px. 고정 상한 없이 영역 폭을 따라 커진다.
   *  v0.44.0 §C0 — `--fit-compare-value`가 같은 방식으로 배율을 내린다. */
  compareValue: 'max(30px, calc(19.4vw * var(--fit-compare-value, 1)))',
  /** 완료 요약 `X / N`. UI-c에서 상태어를 지운 폭을 값이 회수한다 — 고정 최대 px 없이 열린 fit. */
  completeSummary: fittedHeroType(
    COMPLETE_SUMMARY_MIN_FONT_PX,
    COMPLETE_SUMMARY_BASE_FONT_PX,
    '--fit-summary',
  ),
  /** 🔴 v0.46.0 WP-B — 완료 화면 커밋 영수증(`✓ 항목명 값`). **계약이 바뀌었다**(민구 확정 08-05).
   *  종전 `CompleteSummary.tsx` 인라인 `max(15px, calc(clamp(17px, min(5vw,2.6vh), **26px**)
   *  * var(--fit-lo, 1)))` → **`26px` 고정 상한 삭제 + 축소 전용 `--fit-lo`를 열린
   *  `--fit-receipt`로 교체 + 인라인에서 이 상수 계층으로 승격**([TYPO-CONTRACT-1]).
   *  ⚠️ `--fit-lo`는 `useFitScale`(구 훅) 전용이고 `CompleteSummary`에는 그 훅이 없어
   *  **늘 fallback 1이었다** — 상한 26px가 사실상 고정 크기로 작동했다. */
  completeReceipt: fittedHeroType(
    COMPLETE_RECEIPT_MIN_FONT_PX,
    COMPLETE_RECEIPT_BASE_FONT_PX,
    '--fit-receipt',
  ),
  /** 🔴 알람 중 **실시간 인식값**(fb-27-7 5항 "정상 진행될때의 수준만큼 커야 함").
   *  종전 `AlarmInterimStrip`이 이 값을 **인라인 하드코딩**(`clamp(24px, min(8vw,4.8vh), 42px)`)해
   *  실기기에서 32.16px로 렌더됐다 — 정상 진행 InterimLine(90.13px)의 36%. [TYPO-CONTRACT-1]이
   *  "상태별 인라인 정의 금지"로 막으려던 바로 그 증상이 계약을 우회한 코드에서 재현된 것이다.
   *  그래서 여기 상수로 승격한다. **다시 인라인으로 내리지 마라.**
   *
   *  🔴 **v0.46.0 WP-B — 계약이 바뀌었다**(민구 확정 08-05, 안 (a)):
   *  종전 `max(24px, calc(clamp(44px, min(19vw,11vh), **96px**) * var(--fit-hi, 1)))`
   *  → **`96px` 고정 상한 삭제 + 뷰포트 비례(`vw`/`vh`) 기준을 고정 기준px로 교체 +
   *    축소 전용 `--fit-hi`를 열린 `--fit-alarm-interim`으로 교체.**
   *  ⚠️ 상한만 지우는 처방으로는 안 됐다. 실측(08-05 하한 오라클):
   *   ① 402×874에서 상한은 **애초에 비활성**이었다(`min(19vw=76.4, 11vh=96.1)` = 76.4 < 96) —
   *      그런데도 여유 프로브가 red였다. 즉 상한이 유일한 원인이 아니다.
   *   ② `--fit-hi`는 `useFitScale`(구 훅)이 내리는 **축소 전용 배율이라 1을 넘지 않는다**
   *      (`heroLayout.ts` VOICE_TYPE 주석 참조). **위로 여는 경로가 아예 없었다.**
   *   ③ 게다가 `AlarmInterimStrip`은 `AnomalyAlertPopup`의 **형제**라 카드의 `useFitScale`이
   *      심는 `--fit-hi`를 **상속조차 받지 못한다**(항상 fallback 1).
   *  👉 그래서 **여는 변수를 새로 만들고 `VoiceHero.tsx`의 스트립에 `useFitGroup`을 배선했다.**
   *     이제 크기는 배정 영역이 정한다(ui-standard 규칙 2). 기준 44px은 상한이 아니라
   *     이진탐색의 첫 probe 유도값이다. */
  alarmInterim: fittedHeroType(24, 44, '--fit-alarm-interim'),
} as const;

/** v0.43.0 UI-f — 현장 화면(`src/components/voice/`) 인라인 fontSize 계약 SSOT.
 *  🔴 계약 규정 정정 (민구 확정 08-02):
 *  - VOICE_TYPE 컴포넌트(fit 훅 미물림)에서는 「하한 + 비례」 2요소가 필수 계약이다.
 *  - 🔴 **`var(--fit-lo, 1)`은 현재도 앞으로도 이 슬롯들에서 값을 바꾸지 않는다.**
 *    ① 대상 컴포넌트에 fit 훅이 없어 지금은 fallback `1`이고(실측: 전부 unset),
 *    ② **하한이 곧 기준값**이라 `--fit-lo ≤ 1`인 어떤 값이 들어와도 곱한 결과가
 *       `max()`의 첫 항에 흡수된다(실측: `--fit-lo:0.58`을 상속시켜도 128.64px 그대로).
 *    ③ `--fit-lo`를 쓰는 유일한 훅 `useFitScale`은 **축소 가드**라 1을 넘지 않는다.
 *    👉 즉 **「미래에 자동 연결된다」는 기대는 성립하지 않는다.** 초안 주석이 그렇게 적었으나
 *    독립 리뷰가 실측으로 반증했다. 지금 남겨 두는 이유는 **문법 통일**과,
 *    `ui-standard §7-2`(최소 가독 크기, 민구 미결정)가 확정되어 **하한이 기준값보다 낮아지면**
 *    그때 비로소 배율이 의미를 갖기 때문이다. 🔴 **그 전까지는 장식이다 — 있다고 믿지 마라.**
 *  - 하한(minPx)은 402×874 현재 렌더값 자체이며, 미확정 최소 가독크기가 아니다 (ui-standard §7-2 참조).
 *  - 고정 상한(`clamp(..., max)`)은 T6 6회차 재발의 원인이므로 포함하지 않는다 (규칙 2 준수).
 */
export const VOICE_TYPE = {
  /** 🔴 v0.46.1 WP-9(민구 제보 FB-11 · 08-07) — **fit을 실제로 물렸다.**
   *
   *  민구 원문: *"키패드가 팝업되고 사용자가 입력하는 숫자가 위에 출력되는데 마찬가지로
   *  「311…」 이런식으로 표현. **입력되는 값에 따라서 잘리거나 축약되지 않게 유동적으로 사이즈
   *  조절**이 되면 좋겠어. 만약 빈 공간이 있다면 **줄바꿈 형태**로 입력값에 대해서 출력해도 좋아."*
   *  → 확정(08-07): *"축약(\"...\")을 금지하고 폭에 맞춰서 글자 크기를 조절하는걸로."*
   *
   *  🔑 **종전 값은 축소가 구조적으로 불가능했다.** 이 파일의 §계약 주석이 그것을 이미 실측으로
   *  적어뒀다: *"하한이 곧 기준값이라 `--fit-lo ≤ 1`인 어떤 값이 들어와도 `max()`의 첫 항에
   *  흡수된다(실측: `--fit-lo:0.58`을 상속시켜도 128.64px 그대로)"* · *"그 전까지는 **장식이다** —
   *  있다고 믿지 마라"*. 게다가 `ManualValueSheet`는 `useFitScale`을 **쓰지도 않았다**.
   *  즉 이 슬롯은 사실상 **고정 128.64px**였고, 402 폭에서 5자부터 넘쳐 `ellipsis`가 `311…`을 그렸다.
   *
   *  ⚠️ **128.64px는 가독 근거가 아니다** — 같은 주석이 *"하한(minPx)은 402×874 **현재 렌더값
   *  자체**이며, 미확정 최소 가독크기가 아니다"* 라고 밝힌다. 그 값을 하한으로 굳힌 것이 축소를 막았다.
   *
   *  👉 이제 `--fit-sheet`(전용 그룹)이 실제 배율을 정하고, 하한은 **원거리 가독의 실질 바닥**만
   *  잡는다. 상한은 두지 않는다(규칙 2 — 고정 상한은 T6 6회차 재발 원인). */
  sheetDisplay: 'max(44px, calc(128.64px * var(--fit-sheet, 1)))',
  /** StoppingState 정지 화면 메인 타이틀 — 402×874 기준 42px 보존 */
  stoppingTitle: 'max(42px, calc(min(10.45vw, 4.81vh) * var(--fit-lo, 1)))',
  /** ExitConfirmInline 종료 확인 메인 문구 — 402×874 기준 38px 보존 */
  exitConfirmTitle: 'max(38px, calc(min(9.45vw, 4.35vh) * var(--fit-lo, 1)))',
  /** ExitConfirmInline 3행 라벨·안내(v0.44.0 §C3) — 402×874 기준 20px 보존.
   *  라벨과 안내는 같은 성격이라 같은 크기를 쓴다(F03 2원칙). */
  exitConfirmLabel: 'max(20px, calc(min(4.98vw, 2.29vh) * var(--fit-lo, 1)))',
  /** ManualValueSheet 수동입력 시트 헤더 제목 — 402×874 기준 28px 보존 */
  sheetTitle: 'max(28px, calc(min(6.97vw, 3.20vh) * var(--fit-lo, 1)))',
  /** ActiveControlSteppers 스텝퍼 +/- 제어 버튼 심볼 — 402×874 기준 26px 보존 */
  stepperValueLg: 'max(26px, calc(min(6.47vw, 2.97vh) * var(--fit-lo, 1)))',
  /** ReadyState 수치 강조 렌더링 값 — 402×874 기준 24px 보존 */
  readyValue: 'max(24px, calc(min(5.97vw, 2.75vh) * var(--fit-lo, 1)))',
  /** ManualValueSheet 키패드 백스페이스/입력 키 — 402×874 기준 24px 보존 */
  keypadKey: 'max(24px, calc(min(5.97vw, 2.75vh) * var(--fit-lo, 1)))',
  /** PersistErrorBanner 경고 배너 제목 — 402×874 기준 22px 보존 */
  bannerTitle: 'max(22px, calc(min(5.47vw, 2.52vh) * var(--fit-lo, 1)))',
  /** CommandHelpPopup 음성 명령어 팝업 제목 — 402×874 기준 21px 보존 */
  popupTitle: 'max(21px, calc(min(5.22vw, 2.40vh) * var(--fit-lo, 1)))',
  /** StateIndicator 상태 표시기 뱃지/라벨 — 402×874 기준 20.1px 보존 */
  statusLabel: 'max(20.1px, calc(min(5.00vw, 2.30vh) * var(--fit-lo, 1)))',
  /** ActiveControlSteppers 스텝퍼 수치 값 — 402×874 기준 20px 보존 */
  stepperValue: 'max(20px, calc(min(4.98vw, 2.29vh) * var(--fit-lo, 1)))',
  /** CommandHelpPopup 팝업 닫기 버튼 심볼 — 402×874 기준 20px 보존 */
  popupClose: 'max(20px, calc(min(4.98vw, 2.29vh) * var(--fit-lo, 1)))',
  /** StoppingState 정지 화면 보조 문구 — 402×874 기준 19px 보존 */
  stoppingBody: 'max(19px, calc(min(4.73vw, 2.17vh) * var(--fit-lo, 1)))',
  /** PersistErrorBanner 경고 배너 액션 버튼 — 402×874 기준 19px 보존 */
  bannerAction: 'max(19px, calc(min(4.73vw, 2.17vh) * var(--fit-lo, 1)))',
  /** ActiveControlBar 하단 제어바 메인 액션 버튼 — 402×874 기준 18.492px 보존 */
  controlButton: 'max(18.492px, calc(min(4.60vw, 2.12vh) * var(--fit-lo, 1)))',
  /** MicReconnectBanner / ActiveHeaderStrip 섹션 헤더 제목 — 402×874 기준 18px 보존 */
  headerTitle: 'max(18px, calc(min(4.48vw, 2.06vh) * var(--fit-lo, 1)))',
  /** ManualValueSheet 폼 입력 필드 및 시트 탭 라벨 — 402×874 기준 18px 보존 */
  bodyStrong: 'max(18px, calc(min(4.48vw, 2.06vh) * var(--fit-lo, 1)))',
  /** CommandHelpPopup / ManualValueSheet / ReadyState 액션 버튼 라벨 — 402×874 기준 17px 보존 */
  actionLabel: 'max(17px, calc(min(4.23vw, 1.95vh) * var(--fit-lo, 1)))',
  /** CommandHelpPopup 카테고리 태그 / PersistErrorBanner 본문 텍스트 — 402×874 기준 16px 보존 */
  bodyText: 'max(16px, calc(min(3.98vw, 1.83vh) * var(--fit-lo, 1)))',
  /** CommandHelpPopup 항목 설명 / ReadyState 항목 라벨 — 402×874 기준 15px 보존 */
  bodySm: 'max(15px, calc(min(3.73vw, 1.72vh) * var(--fit-lo, 1)))',
  /** CommandHelpPopup 서브 설명 / ManualValueSheet 에러 문구 / ActiveControlSteppers 라벨 — 402×874 기준 14px 보존 */
  caption: 'max(14px, calc(min(3.48vw, 1.60vh) * var(--fit-lo, 1)))',
  /** ReadyState 단위 / ActiveHeaderStrip 행 카운터 소형 라벨 — 402×874 기준 13px 보존 */
  captionSm: 'max(13px, calc(min(3.23vw, 1.49vh) * var(--fit-lo, 1)))',
  /** ActiveControlSteppers 소형 스텝퍼 라벨 — 402×874 기준 12px 보존 */
  captionXs: 'max(12px, calc(min(2.99vw, 1.37vh) * var(--fit-lo, 1)))',
  /** ActiveControlSteppers 스텝퍼 캡션 상세설명 — 402×874 기준 10px 보존 */
  captionXxs: 'max(10px, calc(min(2.49vw, 1.14vh) * var(--fit-lo, 1)))',
} as const;

/** v0.23.0 입력탭#1 — 흡수영역(grid row3, 1fr, overflow:hidden) 안에서 카드가 부모에 잘리지 않게
 *  하는 공통 가드. maxHeight:100% + minHeight:0.
 *  v0.27.0 — overflowY:auto는 이제 **폴백**이다: 정상 경로에선 useFitScale이 폰트를 줄여 스크롤
 *  잔여 0(scrollHeight ≤ clientHeight)을 보장한다(양손 측정 중 스크롤 불가 — 민구 07-03).
 *  PausedCard·ModifyIndicatorPill·AnomalyAlertPopup·VoiceHero 모두 이 클램프 + useFitScale 적용. */
export const ABSORB_CLAMP = {
  maxHeight: '100%',
  minHeight: 0,
  overflowY: 'auto',
} as const;
