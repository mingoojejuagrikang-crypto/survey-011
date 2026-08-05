/** v0.46.0 WP-D(민구 R3 · 제보 F17) — **칩존 좌우 왕복 스크롤**의 산술 SSOT.
 *
 *  ## 왜 lib으로 뺐나
 *  상한·기본값 상수를 **세 곳**이 함께 쓴다 — settingsStore의 persist coercion, 설정 UI의
 *  스텝퍼 경계, ChipZone의 rAF 루프. 리터럴을 각자 적으면 이 레포가 반복해서 데인 **이중 기록**이
 *  된다(`ChipZone`의 `CHIP_PAD_Y` ↔ `v039-active-zones:88`의 `- 12`가 갈라져 한쪽만 고친 채
 *  테스트가 통과했던 전례). 순수함수라 오라클이 시간·DOM 없이 산술만 따로 검증할 수 있다.
 *
 *  ## 🔴 시트 불특정(민구 지시 08-05)
 *  *"앱은 지금의 시트에만 사용할 게 아냐. 하나의 시트를 기준으로 정하진 말아줘."*
 *  👉 칩 개수·항목명 길이·칩 폭에 대한 가정이 **이 파일에 하나도 없다.** 왕복 거리는 호출부가
 *  넘기는 `maxScroll`(= `scrollWidth - clientWidth`, 런타임 실측)이 전부다. 칩이 3개든 20개든,
 *  항목명이 1글자든 10글자든 같은 식이 돈다. 칩이 **화면 안에 다 들어오면 `maxScroll <= 0`이라
 *  왕복 자체가 0을 돌려준다**(= 안 움직인다).
 *
 *  ## 「8초」의 정의 = **편도**
 *  민구 확정 원문은 *"기본값은 8초, 0초는 OFF"* 이고 단위를 명시하지 않았다. **편도**로 읽는다 —
 *  그 답이 나온 질문(플랜 §5-B `R3`)이 *"한 바퀴에 몇 초쯤이 멀리서 눈으로 확인 가능한가?
 *  (제안: **편도** 6~8초)"* 였기 때문이다. 제안 단위를 그대로 받은 것으로 보는 게 자연스럽고,
 *  왕복 1주기로 읽으면 편도 4초가 되어 민구가 경계한 *"너무 빠르면 못 읽고"* 쪽으로 기운다.
 *  👉 **왕복 1주기 = 16초**(왼쪽 끝 → 오른쪽 끝 → 왼쪽 끝). */

/** 기본 편도 초(민구 R3 확정). 0 = 끔. */
export const CHIP_SWEEP_DEFAULT_SECONDS = 8;

/** 스텝퍼·coercion 공통 상한. 편도 30초를 넘으면 "왕복한다"는 인상 자체가 사라지고,
 *  민구가 경계한 *"느리면 원하는 칩을 기다려야 한다"* 가 그대로 발생한다. */
export const CHIP_SWEEP_MAX_SECONDS = 30;

/** 스텝퍼 증감 단위(초). 8초 기준에서 1초는 눈에 보이는 차이이면서 장갑 낀 손으로 몇 번 눌러
 *  원하는 값에 닿는 크기다. */
export const CHIP_SWEEP_STEP_SECONDS = 1;

/** 왕복 거리가 이 px 이하면 왕복하지 않는다 — 칩이 화면 안에 다 들어온 경우(`maxScroll` 0)와
 *  서브픽셀 반올림 잔여(1px 미만 흔들림)를 같은 문에서 막는다. */
export const CHIP_SWEEP_MIN_TRAVEL_PX = 1;

/** 영속본·입력값을 유효 범위로 치유한다. 0(끔)은 **유효값**이라 통과시킨다.
 *  비수·비유한수·음수·상한 초과는 기본값으로 되돌린다(settingsStore의 무조건 coercion 패턴). */
export function normalizeChipSweepSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CHIP_SWEEP_DEFAULT_SECONDS;
  if (value < 0 || value > CHIP_SWEEP_MAX_SECONDS) return CHIP_SWEEP_DEFAULT_SECONDS;
  // 스텝 단위 밖의 소수(구버전·수동 편집)는 스텝에 맞춰 접는다 — UI가 표시할 수 없는 값을
  // 스토어에 남기지 않는다.
  return Math.round(value / CHIP_SWEEP_STEP_SECONDS) * CHIP_SWEEP_STEP_SECONDS;
}

/** 왕복이 실제로 돌아야 하는가. `seconds === 0`(끔)과 "칩이 다 보인다"를 한 곳에서 판정한다. */
export function shouldChipSweep(seconds: number, maxScroll: number): boolean {
  return seconds > 0 && maxScroll > CHIP_SWEEP_MIN_TRAVEL_PX;
}

/**
 * 경과 시간 → `scrollLeft` 위치. **등속 삼각파**(0 → maxScroll → 0 → …).
 *
 * 등속인 이유: 이 왕복은 장식이 아니라 *"멀리서 진행 상황을 읽는다"* 는 **판독 수단**이다
 * (제보 F17). ease를 넣으면 중간 구간이 빨라져 정작 읽어야 할 때 지나가고, 양 끝에서 느려져
 * 안 봐도 되는 곳에 시간을 쓴다. 등속이면 어느 칩이든 화면에 머무는 시간이 같다.
 *
 * @param elapsedMs   왕복 시작(또는 재동기화) 이후 경과 ms
 * @param oneWaySeconds 편도 초(0이면 항상 0 — 호출부가 루프를 안 돌리는 게 정상 경로다)
 * @param maxScroll   `scrollWidth - clientWidth`(런타임 실측). 0 이하면 왕복할 거리가 없다
 */
export function chipSweepOffset(elapsedMs: number, oneWaySeconds: number, maxScroll: number): number {
  if (!shouldChipSweep(oneWaySeconds, maxScroll)) return 0;
  const oneWayMs = oneWaySeconds * 1000;
  const cycleMs = oneWayMs * 2;
  // 음수 경과(시계 되감김·재동기화 오차)도 같은 위상으로 접는다 — `%`만으로는 음수가 남는다.
  const t = ((elapsedMs % cycleMs) + cycleMs) % cycleMs;
  const phase = t <= oneWayMs ? t / oneWayMs : 2 - t / oneWayMs; // 0 → 1 → 0
  return maxScroll * phase;
}

/**
 * 현재 위치에서 왕복을 **이어서** 시작할 기준 시각(`start`)을 역산한다.
 *
 * 🔑 이게 없으면 두 곳에서 **위치가 튄다**:
 *   ① 활성 칩이 바뀌어 `ActiveState`의 정렬이 `scrollLeft`를 옮긴 직후
 *   ② 사용자가 손으로 칩존을 밀었다가 뗀 직후
 * 둘 다 "지금 보이는 자리에서 오른쪽으로 다시 흘러간다"가 자연스럽다.
 *
 * @returns `start` — `chipSweepOffset(now - start, …)`가 현재 위치를 돌려주는 시각
 */
export function chipSweepStartFor(nowMs: number, scrollLeft: number, oneWaySeconds: number, maxScroll: number): number {
  if (!shouldChipSweep(oneWaySeconds, maxScroll)) return nowMs;
  const p = Math.min(1, Math.max(0, scrollLeft / maxScroll));
  // 상승 구간(0→1)으로 재개한다. 하강 구간으로 붙이면 왼쪽 끝에서 시작한 사용자가 곧바로
  // 벽에 닿아 정지한 것처럼 보인다.
  return nowMs - p * oneWaySeconds * 1000;
}
