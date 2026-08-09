/**
 * v0.47.0 r2 **P3** — 칩존 대역 밖 재개 글라이드 (민구 08-09 실기기 점검 FB-D).
 *
 * 민구 원문: *"칩존 자동 스크롤시 사용자가 수동 스크롤후 뗀 자리가 아닌 이전 자리로 빠르게
 * 돌아가서 다시 스크롤중"*
 *
 * ## 왜 단위 테스트가 주력인가
 * `chipSweep.ts`는 DOM·시간 의존이 없는 순수 산술이라 Node에서 직접 돌릴 수 있다
 * (`koreanNum.spec.ts` 계보 — 프로젝트의 기존 Playwright 러너를 그대로 쓰고 새 도구를 안 들인다).
 * 그리고 이 과제가 재야 하는 것은 **「점프가 없다」는 산술 성질**이다: 프레임마다의 이동량이
 * 등속 상한을 넘지 않는가. E2E로 이걸 재려면 rAF 타이밍에 의존해 flaky해지고,
 * 🔴 칩 왕복이 켜진 채로 클릭하는 스펙은 Playwright `stable` 대기에서 데드락한다([TEAMOPS-81]).
 *
 * ## ①은 **버그의 산술 확정**이다
 * 처방을 검증하기 전에 «그 기전이 실제로 점프를 만드는가»를 먼저 못 박는다. ①이 green이라는
 * 것은 종전 코드가 실제로 점프했다는 뜻이고, ②~⑥이 green이라는 것은 새 코드가 그걸 없앴다는
 * 뜻이다. ①이 없으면 «고쳤다»가 무엇 대비인지 알 수 없다.
 */
import { test, expect } from '@playwright/test';
import {
  chipSweepStartFor,
  chipSweepOffset,
  chipSweepGlideTarget,
  chipSweepGlideNext,
  chipSweepSpeedPxPerMs,
  chipSweepSecondsForLevel,
  CHIP_SWEEP_GLIDE_EPS_PX,
  CHIP_SWEEP_DEFAULT_LEVEL,
} from '../src/lib/chipSweep';

// ── ① 기전 확정 — clamp가 대역 밖에서 점프를 만든다 ──────────
test('[node] ① 🔴 기전 — 대역 밖에서 재개하면 clamp가 대역 안으로 점프시킨다 (FB-D의 원인)', () => {
  const from = 200;
  const to = 600;
  const range = to - from;
  const seconds = 26; // 임의의 편도 초(단계 눈금과 무관 — 산술만 본다)
  const now = 100_000;

  // 사용자가 대역 **왼쪽 밖** 50px에 손을 뗐다.
  const userLeft = 50;
  // 종전 호출부: chipSweepStartFor(ts, el.scrollLeft - from, seconds, range)
  const start = chipSweepStartFor(now, userLeft - from, seconds, range);
  // 다음 프레임의 대입: from + chipSweepOffset(...)
  const nextFrame = from + chipSweepOffset(now - start, seconds, range);

  expect(start, '위상이 0으로 clamp됐다((50-200)/400 = -0.375 → 0)').toBe(now);
  expect(nextFrame, '다음 프레임이 대역 왼쪽 끝으로 점프한다').toBe(from);
  expect(
    nextFrame - userLeft,
    `한 프레임에 ${nextFrame - userLeft}px 이동 — 민구가 본 "이전 자리로 빠르게 돌아가서"가 이것`,
  ).toBe(150);

  // 오른쪽 밖도 대칭으로 점프한다.
  const rightOutside = 900;
  const startR = chipSweepStartFor(now, rightOutside - from, seconds, range);
  const nextR = from + chipSweepOffset(now - startR, seconds, range);
  expect(nextR, '오른쪽 밖은 대역 오른쪽 끝으로 접힌다').toBe(to);
  expect(rightOutside - nextR, '300px 역방향 점프').toBe(300);
});

// ── ② 목표 경계 판정 ─────────────────────────────────────────
test('[node] ② chipSweepGlideTarget — 대역 밖이면 가까운 경계, 안이면 null', () => {
  const from = 200;
  const to = 600;

  expect(chipSweepGlideTarget(50, from, to), '왼쪽 밖 → from').toBe(from);
  expect(chipSweepGlideTarget(900, from, to), '오른쪽 밖 → to').toBe(to);
  expect(chipSweepGlideTarget(400, from, to), '대역 안 → null').toBeNull();
  expect(chipSweepGlideTarget(from, from, to), '경계 위(from) → null').toBeNull();
  expect(chipSweepGlideTarget(to, from, to), '경계 위(to) → null').toBeNull();

  // ε 안쪽은 «도착»으로 본다 — 서브픽셀 잔여로 매 프레임 재시작하면 경계에서 스터터한다.
  expect(chipSweepGlideTarget(from - CHIP_SWEEP_GLIDE_EPS_PX, from, to), 'ε 이내(왼쪽) → null').toBeNull();
  expect(chipSweepGlideTarget(to + CHIP_SWEEP_GLIDE_EPS_PX, from, to), 'ε 이내(오른쪽) → null').toBeNull();
  expect(chipSweepGlideTarget(from - CHIP_SWEEP_GLIDE_EPS_PX - 1, from, to), 'ε 밖 → from').toBe(from);

  // 🔑 ε는 `onScroll`의 자기쓰기 판별 ε(max(1, 1/DPR))보다 작으면 안 된다 — 작으면 경계에
  //    다 온 위치가 «아직 밖»으로 판정돼 스터터한다. DPR≥1에서 그 값은 1이다.
  expect(CHIP_SWEEP_GLIDE_EPS_PX, 'onScroll ε(DPR≥1에서 1px) 이상이어야 한다').toBeGreaterThanOrEqual(1);

  // 퇴화 입력 — 대역이 뒤집혔거나 비수. 던지지 않고 «글라이드 없음»으로 접는다.
  expect(chipSweepGlideTarget(100, 600, 200), 'to < from → null').toBeNull();
  expect(chipSweepGlideTarget(Number.NaN, from, to), 'NaN → null').toBeNull();
});

// ── ③ 속도가 왕복과 같다 ─────────────────────────────────────
test('[node] ③ 🔴 글라이드 속도 = 왕복 속도 — «되돌아오는 속도가 달라 다시 튄다»를 막는 축', () => {
  const seconds = 26;
  const range = 400;
  const speed = chipSweepSpeedPxPerMs(seconds, range);

  // 편도 시간 동안 정확히 range만큼 간다 = 삼각파와 같은 속도.
  expect(speed * seconds * 1000, '편도 시간 × 속도 = 대역 폭').toBeCloseTo(range, 6);

  // 삼각파의 실제 프레임 이동량과 비교한다(같은 산술에서 나온다는 것을 교차 확인).
  const dt = 16.7;
  const sweepDelta = chipSweepOffset(dt, seconds, range) - chipSweepOffset(0, seconds, range);
  expect(sweepDelta, '삼각파 상승 구간의 프레임 이동량과 일치').toBeCloseTo(speed * dt, 6);

  expect(chipSweepSpeedPxPerMs(0, range), '왕복 OFF → 0').toBe(0);
  expect(chipSweepSpeedPxPerMs(seconds, 0), '대역 폭 0 → 0').toBe(0);
});

// ── ④ 한 프레임 이동 — 등속 + 오버슈트 clamp ─────────────────
test('[node] ④ chipSweepGlideNext — 등속이고 목표를 지나치지 않는다', () => {
  const seconds = 26;
  const range = 400;
  const speed = chipSweepSpeedPxPerMs(seconds, range);

  // 등속(오른쪽으로)
  expect(chipSweepGlideNext(50, 200, seconds, range, 100), '100ms 동안 speed×100px')
    .toBeCloseTo(50 + speed * 100, 6);
  // 등속(왼쪽으로) — 방향만 반대고 크기는 같다
  expect(chipSweepGlideNext(900, 600, seconds, range, 100), '왼쪽도 같은 속도')
    .toBeCloseTo(900 - speed * 100, 6);

  // 🔴 오버슈트 clamp — 긴 프레임(백그라운드 복귀·저사양)이 대역 반대편으로 튀는 것을 막는다.
  //    이게 없으면 «고치려던 점프»를 다른 형태로 다시 만든다.
  expect(chipSweepGlideNext(190, 200, seconds, range, 100_000), '남은 거리보다 크면 목표에 멈춘다').toBe(200);
  expect(chipSweepGlideNext(610, 600, seconds, range, 100_000), '반대 방향도 마찬가지').toBe(600);

  // dt 방어 — 음수(시계 되감김)·비수는 0으로 접는다. 첫 프레임 dt=0도 같은 문이다.
  expect(chipSweepGlideNext(50, 200, seconds, range, -5), '음수 dt → 제자리').toBe(50);
  expect(chipSweepGlideNext(50, 200, seconds, range, Number.NaN), 'NaN dt → 제자리').toBe(50);
  expect(chipSweepGlideNext(50, 200, seconds, range, 0), 'dt 0 → 제자리').toBe(50);
});

// ── ⑤ 프레임 시뮬레이션 — 점프가 없다 ───────────────────────
test('[node] ⑤ 🔴 프레임 시뮬 — 대역 밖 재개의 어느 프레임도 등속 상한을 넘지 않는다', () => {
  const from = 200;
  const to = 600;
  const range = to - from;
  const seconds = 26;
  const speed = chipSweepSpeedPxPerMs(seconds, range);
  const FRAME = 16.7;

  let pos = 50; // 사용자가 대역 밖에 손을 뗀 자리(①과 같은 상황)
  let gliding = true;
  let start = -1;
  let ts = 100_000;
  let lastTs = ts;
  const deltas: number[] = [];
  let framesToJoin = 0;
  let joinDelta = -1; // 글라이드 → 삼각파로 넘어가는 그 한 프레임의 이동량

  // 호출부(ChipZone.tick)의 순서를 그대로 따라 돈다.
  for (let i = 0; i < 4000; i++) {
    ts += FRAME;
    const prev = pos;
    let isJoinFrame = false;
    if (gliding) {
      const target = chipSweepGlideTarget(pos, from, to);
      if (target === null) {
        gliding = false;
        isJoinFrame = true;
        start = chipSweepStartFor(ts, pos - from, seconds, range);
        pos = from + chipSweepOffset(ts - start, seconds, range);
      } else {
        pos = chipSweepGlideNext(pos, target, seconds, range, ts - lastTs);
        framesToJoin++;
      }
    } else {
      pos = from + chipSweepOffset(ts - start, seconds, range);
    }
    lastTs = ts;
    const d = Math.abs(pos - prev);
    if (isJoinFrame) joinDelta = d;
    else deltas.push(d);
  }

  const cap = speed * FRAME;
  const maxDelta = Math.max(...deltas);
  // 🔴 본 계약. 점프는 «한 프레임에 등속보다 훨씬 많이 움직였다»로 나타난다.
  //    합류 프레임을 뺀 **모든** 프레임은 정확히 등속이다(1.05는 부동소수 잔차만 덮는다).
  expect(
    maxDelta,
    `어떤 프레임이 등속 상한(${cap.toFixed(4)}px/frame)을 넘었다 = 점프가 남아 있다`,
  ).toBeLessThanOrEqual(cap * 1.05);

  // 🔑 **합류 프레임에는 최대 ε(경계 스냅)만큼의 잔차가 남는다** — 설계상 그렇다.
  //    `chipSweepGlideTarget`이 ε 이내를 «도착»으로 접기 때문에, 마지막 글라이드 위치가
  //    경계에서 최대 ε만큼 떨어져 있을 수 있고 합류 대입이 그걸 흡수한다.
  //    ε를 없애면 이 잔차도 없어지지만, 브라우저의 `scrollLeft` 반올림(DPR 격자) 때문에
  //    경계 근처에서 «아직 밖 → 다시 글라이드»가 반복돼 미세 진동이 생긴다. ε가 그 교환이다.
  //    🔴 **이 잔차는 계약상 ε를 넘지 않는다** — 종전 버그(150px)의 1/75이라 이 문으로도
  //    회귀는 확실히 잡힌다. 여기가 커지면 «경계에서 튄다»는 새 결함이 생긴 것이다.
  expect(
    joinDelta,
    `합류 프레임 잔차(${joinDelta.toFixed(3)}px)가 ε(${CHIP_SWEEP_GLIDE_EPS_PX}px)를 넘었다 — 경계 스냅이 아니라 점프다`,
  ).toBeLessThanOrEqual(CHIP_SWEEP_GLIDE_EPS_PX);
  // 종전 코드였다면 이 자리에 150px이 찍힌다(①이 그 수를 단언한다).
  expect(joinDelta, '합류 잔차가 종전 점프(150px)와 같은 자릿수가 아니다').toBeLessThan(150 / 10);

  // 공허한 green 방지 — 정말로 대역까지 갔고, 그 뒤 왕복에 합류했는가.
  expect(gliding, '글라이드가 끝나 삼각파에 합류했다').toBe(false);
  expect(pos, '합류 후 위치가 대역 안이다').toBeGreaterThanOrEqual(from - 0.5);
  expect(pos, '합류 후 위치가 대역 안이다').toBeLessThanOrEqual(to + 0.5);

  // 소요 = 거리/속도(등속의 정의). 🔑 실제 이동 거리는 [150−ε, 150] 이다 — ε 이내에서 합류하므로
  //   마지막 ε만큼은 글라이드가 아니라 합류 대입이 흡수한다. 프레임 이산화로 ±1프레임 더 준다.
  const glideMs = framesToJoin * FRAME;
  const minMs = (from - 50 - CHIP_SWEEP_GLIDE_EPS_PX) / speed - FRAME;
  const maxMs = (from - 50) / speed + FRAME;
  expect(glideMs, `글라이드 소요(${glideMs.toFixed(0)}ms)가 등속 산술 범위 [${minMs.toFixed(0)}, ${maxMs.toFixed(0)}]ms 안`)
    .toBeGreaterThanOrEqual(minMs);
  expect(glideMs, '글라이드가 등속보다 빨랐다 = 어딘가에서 건너뛰었다').toBeLessThanOrEqual(maxMs);
  console.log(
    `[P3] 대역 밖 150px 재개 → 글라이드 ${(glideMs / 1000).toFixed(1)}초 `
    + `(속도 ${(speed * 1000).toFixed(1)}px/s · 편도 ${seconds}초 · 대역 ${range}px)`,
  );
});

// ── ⑤-b 중단 후 재개 — dt 누적 점프 ──────────────────────────
/**
 * 🔴 **글라이드 «도중에» 사용자가 다시 만지면?** — ⑤가 못 잡는 경로다.
 *
 * `ChipZone.tick`의 `held || paused || ts < userScrollUntil` 갈래는 그냥 return한다.
 * 여기서 `gliding`을 내리지 않으면, 재개 프레임이 `lastTs`를 부트스트랩하지 못하고
 * (부트스트랩이 `if (!gliding)` 안에 있다) **중단 시간이 통째로 `dt`가 된다.**
 * 3초 붙잡고 있었으면 `0.0154 px/ms × 3300ms ≈ 50px`을 한 프레임에 이동 —
 * 이 과제가 고치는 그 점프가 다른 문으로 돌아온다. 백그라운드 복귀도 같은 트리거다.
 *
 * 👉 이 테스트는 **호출부의 상태 전이**를 시뮬레이션한다(순수 함수만으로는 못 잡는다).
 *    `gliding = false`를 지우면 red가 나야 한다 — 그게 이 단언의 반증 조건이다.
 */
test('[node] ⑤-b 🔴 글라이드 중 재터치 — 중단 시간이 dt로 누적돼 점프하지 않는다', () => {
  const from = 200;
  const to = 600;
  const range = to - from;
  const seconds = 26;
  const speed = chipSweepSpeedPxPerMs(seconds, range);
  const FRAME = 16.7;
  const HOLD_FRAMES = 200; // ≈3.3초 붙잡고 있는다

  let pos = 50;
  let gliding = false;
  let resync = true;
  let start = -1;
  let ts = 100_000;
  let lastTs = ts;
  let maxDelta = 0;
  let resumeDelta = -1;

  for (let i = 0; i < 1200; i++) {
    ts += FRAME;
    const prev = pos;
    // 300~500프레임 동안 손이 닿아 있다(held). tick은 그냥 return한다.
    const held = i >= 300 && i < 300 + HOLD_FRAMES;
    if (held) {
      resync = true;
      gliding = false; // 🔴 제품 코드의 그 한 줄. 지우면 이 테스트가 red다.
      continue; // ts만 흐르고 pos는 그대로 — 사용자가 잡고 있다
    }
    if (resync || start < 0) {
      const target = chipSweepGlideTarget(pos, from, to);
      if (target !== null) {
        if (!gliding) { gliding = true; lastTs = ts; }
      } else {
        gliding = false;
        start = chipSweepStartFor(ts, pos - from, seconds, range);
        resync = false;
      }
    }
    if (gliding) {
      const target = chipSweepGlideTarget(pos, from, to);
      if (target === null) {
        gliding = false;
        start = chipSweepStartFor(ts, pos - from, seconds, range);
        resync = false;
        pos = from + chipSweepOffset(ts - start, seconds, range);
      } else {
        pos = chipSweepGlideNext(pos, target, seconds, range, ts - lastTs);
        lastTs = ts;
        const d = Math.abs(pos - prev);
        if (i === 300 + HOLD_FRAMES) resumeDelta = d; // 재개 첫 프레임
        maxDelta = Math.max(maxDelta, d);
        continue;
      }
    } else {
      lastTs = ts;
      pos = from + chipSweepOffset(ts - start, seconds, range);
    }
    maxDelta = Math.max(maxDelta, Math.abs(pos - prev));
  }

  const cap = speed * FRAME;
  expect(resumeDelta, '재개 첫 프레임이 측정됐다(시나리오가 실제로 그 경로를 밟았다)').toBeGreaterThanOrEqual(0);
  expect(
    resumeDelta,
    `재개 첫 프레임이 ${resumeDelta.toFixed(2)}px 이동했다 — 중단 ${(HOLD_FRAMES * FRAME / 1000).toFixed(1)}초가 `
    + `dt로 누적됐다. 등속 상한은 ${cap.toFixed(4)}px/frame`,
  ).toBeLessThanOrEqual(cap * 1.05);
  expect(maxDelta, '중단·재개를 포함한 어느 프레임도 등속 상한을 넘지 않는다')
    .toBeLessThanOrEqual(Math.max(cap * 1.05, CHIP_SWEEP_GLIDE_EPS_PX));
});

// ── ⑥ 합류 방향의 연속성 ─────────────────────────────────────
test('[node] ⑥ 합류 방향이 글라이드 방향과 이어진다 (경계에서 되튀지 않는다)', () => {
  const from = 200;
  const to = 600;
  const range = to - from;
  const seconds = 26;
  const now = 100_000;
  const FRAME = 16.7;

  // 왼쪽 밖에서 오른쪽으로 글라이드 → `from` 도달 → 계속 **오른쪽**(위상 상승)이어야 한다.
  const startAtFrom = chipSweepStartFor(now, 0, seconds, range);
  const afterFrom = from + chipSweepOffset(now + FRAME - startAtFrom, seconds, range);
  expect(afterFrom, 'from에서 합류하면 오른쪽으로 계속 간다').toBeGreaterThan(from);

  // 오른쪽 밖에서 왼쪽으로 글라이드 → `to` 도달 → 계속 **왼쪽**(위상 하강)이어야 한다.
  const startAtTo = chipSweepStartFor(now, range, seconds, range);
  const afterTo = from + chipSweepOffset(now + FRAME - startAtTo, seconds, range);
  expect(afterTo, 'to에서 합류하면 왼쪽으로 계속 간다').toBeLessThan(to);
});

// ── ⑦ 등속의 대가를 숫자로 남긴다 ────────────────────────────
/** ⚠️ 이 테스트는 **계약이 아니라 기록**이다. 처방(왕복과 같은 등속)은 민구 확정이므로 그대로
 *  두되, 그 대가인 «최악 글라이드 시간»을 다음 회차가 볼 수 있게 산출물에 남긴다.
 *  민구가 *"멈춘 것 같다"* 로 읽으면 이 숫자가 판단 근거다. */
test('[node] ⑦ 기록 — 등속 글라이드의 최악 소요 시간', () => {
  const seconds = chipSweepSecondsForLevel(CHIP_SWEEP_DEFAULT_LEVEL); // 기본 단계 5
  const rows = [
    { range: 300, outside: 200 },
    { range: 300, outside: 500 },
    { range: 600, outside: 200 },
    { range: 1000, outside: 500 },
  ];
  const lines = rows.map(({ range, outside }) => {
    const speed = chipSweepSpeedPxPerMs(seconds, range) * 1000; // px/s
    return `대역 ${range}px · 밖 ${outside}px → ${(outside / speed).toFixed(1)}초 (${speed.toFixed(1)}px/s)`;
  });
  console.log(`[P3 최악 글라이드 · 기본 단계 ${CHIP_SWEEP_DEFAULT_LEVEL}(편도 ${seconds}초)]\n  ${lines.join('\n  ')}`);
  // 산술이 유한하고 양수인지만 지킨다(수치 자체는 설정에 따라 변한다).
  for (const { range, outside } of rows) {
    const t = outside / (chipSweepSpeedPxPerMs(seconds, range) * 1000);
    expect(Number.isFinite(t) && t > 0, '소요 시간이 유한한 양수').toBe(true);
  }
});
