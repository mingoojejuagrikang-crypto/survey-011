/**
 * F3 입력화면 UI 재구성 — 와이어프레임 계약 회귀.
 *
 * SSOT: `Deliverables/2026-07-24-survey-011-active-screen-wireframe.md` (민구 확정 2026-07-24).
 *   §공통규칙1 공간 배정(칩존 25% / 중앙 50% / 하단 25%)
 *   §공통규칙2·3 중앙 정보 가로+세로 중앙정렬
 *   §공통규칙4 칩존 2줄 유지 + 초과분 스크롤 + 활성칸 하이라이트·점멸
 *   §공통규칙5 하단 `<` `>` 양끝 + 가운데 도트 인디케이터 → 음성 입력 시 세로파형
 *   §[2] anomaly / §[3] paused / §[4] complete
 *   + 수용기준: **회전 시 진동 부재**(useFitScale ResizeObserver 자기관측 제거)
 *
 * 서버: `playwright.config.ts`의 webServer가 5177을 자동 기동한다([ORCH-27]).
 */
import { test, expect, type Page } from '@playwright/test';
import {
  PHONE_402, PHONE_375,
  boot, injectLevel, zoneMetrics, indicatorOpacity, triggerAnomaly, fillAllRows,
} from './fixtures/activeZones';
import { fireStt } from './fixtures/stt';

// 시딩·부팅·상태진입 헬퍼는 `tests/fixtures/activeZones.ts`로 이동했다(동작 불변). 두 번째 소비자
// (`capture-current-states.spec.ts` — 실렌더 캡처)가 같은 상태로 진입해야 해서 복제를 피한 것이고,
// 이 스펙의 오라클은 하나도 바뀌지 않았다.

test.setTimeout(120_000);

// ─── §공통규칙1 — 공간 배정 25 / 50 / 25 ─────────────────────────────────────
for (const vp of [
  { name: '402×874', viewport: PHONE_402 },
  { name: '375×667', viewport: PHONE_375 },
]) {
  test(`§공통규칙1 — 칩존25%·중앙50%·하단25% 비례 배분 @ ${vp.name}`, async ({ page }) => {
    await boot(page, vp.viewport);
    const m = await zoneMetrics(page);
    // 🔴 분모는 **ActiveState 박스에서 상단 행/진행 스트립을 뺀 나머지**다. 와이어프레임 목업에서
    //    `[칩존 25%]` 격벽은 스트립 아래에서 시작하고, `[하단 25%]` 안에 그려진 nav(설정/입력/
    //    데이터/개선)는 실제로는 App의 TabBar라 이 박스 밖이다. window.innerHeight를 분모로 쓰면
    //    스트립·탭바 때문에 어떤 배치로도 성립하지 않는다.
    const zoneTotal = m.rootHeight - m.headerHeight;
    console.log(`[${vp.name}] root=${m.rootHeight.toFixed(0)} header=${m.headerHeight.toFixed(0)} chip=${m.chipHeight.toFixed(0)} center=${m.centerHeight.toFixed(0)} bottom=${m.bottomHeight.toFixed(0)}`);
    expect(m.chipHeight / zoneTotal, '칩존 25%').toBeCloseTo(0.25, 2);
    expect(m.centerHeight / zoneTotal, '중앙 50%').toBeCloseTo(0.5, 2);
    expect(m.bottomHeight / zoneTotal, '하단 25%').toBeCloseTo(0.25, 2);
    // 세 구역이 겹치거나 서로를 밀지 않는다(합 = 전체).
    expect(m.chipHeight + m.centerHeight + m.bottomHeight).toBeCloseTo(zoneTotal, 0);
  });
}

test('칩존 — 한 행 유지 + 초과 칩은 **가로** 스크롤(활성칩 하이라이트+점멸)', async ({ page }) => {
  await boot(page);
  const grid = page.locator('[data-testid="voice-chip-grid"]');
  const m = await grid.evaluate((el) => {
    const g = el as HTMLElement;
    const chips = Array.from(g.querySelectorAll('[data-testid="column-chip"]')) as HTMLElement[];
    // 칩 상단 y를 8px 톨러런스로 클러스터링 = 실제로 몇 줄인가.
    const tops: number[] = [];
    for (const c of chips) {
      const top = c.offsetTop;
      if (!tops.some((t) => Math.abs(t - top) <= 8)) tops.push(top);
    }
    const cs = getComputedStyle(g);
    return {
      chipCount: chips.length,
      totalRows: tops.length,
      clientWidth: g.clientWidth,
      scrollWidth: g.scrollWidth,
      clientHeight: g.clientHeight,
      scrollHeight: g.scrollHeight,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      // 🔴 프리뷰 단계에서 데인 것 — smooth면 scrollLeft 대입 직후 읽은 값이 애니메이션 중간값이라
      //    자동 스크롤 측정·복원이 틀어진다.
      scrollBehavior: cs.scrollBehavior,
      chipHeights: chips.slice(0, 3).map((c) => c.getBoundingClientRect().height),
    };
  });
  console.log(`chips=${m.chipCount} rows=${m.totalRows} clientW=${m.clientWidth} scrollW=${m.scrollWidth}`);
  expect(m.chipCount, '시드가 실제로 많은 칩을 만들었다(공허 방지)').toBeGreaterThanOrEqual(12);
  // 민구 확정(2026-07-27) — 한 행. 원 요청(fb-27-2)은 세로 스크롤이었으나 화면을 보고 뒤집혔다.
  expect(m.totalRows, '칩은 한 행에 늘어선다').toBe(1);
  expect(m.overflowX, '넘침은 가로 스크롤이 받는다').toBe('auto');
  expect(m.overflowY, '세로로는 넘치지 않는다').toBe('hidden');
  expect(m.scrollWidth, '13개 칩은 한 화면 폭을 넘긴다').toBeGreaterThan(m.clientWidth);
  expect(m.scrollHeight - m.clientHeight, '세로 스크롤은 생기지 않는다').toBeLessThanOrEqual(1);
  expect(m.scrollBehavior, 'smooth 금지 — 자동 스크롤 측정이 애니메이션 중간값을 읽는다').toBe('auto');
  // 한 행이 트랙을 통째로 쓴다 = 칩이 종전(2줄)보다 확실히 높다. 44px는 장갑 조작 하한.
  const zone = await zoneMetrics(page);
  const expectedChipH = zone.chipHeight - 12; // 상하 패딩 6+6
  for (const h of m.chipHeights) {
    expect(Math.abs(h - expectedChipH), '칩 높이는 칩존 트랙 안쪽 높이 전체').toBeLessThanOrEqual(1.5);
    expect(h, '장갑 조작 44px 하한(PRINCIPLES §2)').toBeGreaterThanOrEqual(44);
  }
  // 활성 칩 하이라이트 + 점멸(chip-pulse).
  const active = page.locator('[data-testid="column-chip"][data-active="true"]');
  await expect(active).toHaveCount(1);
  const anim = await active.evaluate((el) => getComputedStyle(el as HTMLElement).animationName);
  expect(anim, '활성칸 점멸').toBe('chip-pulse');
});

test('칩존 자동 스크롤 — 진행중 칩이 **우측 끝**, 왼쪽엔 값이 찍힌 완료 칩(민구 확정)', async ({ page }) => {
  // 🔴 이 오라클이 지키는 결정: "다음 항목 보기"가 아니라 **입력 확인 영역**이다.
  //    칩이 '항목+값'을 담으므로 왼쪽에 남는 완료 칩이 방금 넣은 값을 확인해 준다.
  //    일반적 직관과 반대라 되돌려지기 쉬워서 테스트로 못박는다.
  await boot(page);
  // 넘칠 만큼 진행시킨다(각 커밋마다 다음 칩으로 이동).
  for (let i = 0; i < 6; i++) await fireStt(page, `${20 + i}.0`, 320);
  const m = await page.locator('[data-testid="voice-chip-grid"]').evaluate((el) => {
    const g = el as HTMLElement;
    const active = g.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement;
    const gr = g.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    const done = Array.from(g.querySelectorAll('[data-testid="column-chip"]')).filter((c) => {
      const el2 = c as HTMLElement;
      if (el2.offsetLeft >= active.offsetLeft) return false;
      if (el2.offsetLeft + el2.offsetWidth <= g.scrollLeft + 4) return false;
      const v = el2.querySelectorAll('span')[1];
      const text = (v?.textContent ?? '').trim();
      return text !== '' && text !== '—';
    }).length;
    return {
      scrollLeft: Math.round(g.scrollLeft),
      maxScroll: Math.round(g.scrollWidth - g.clientWidth),
      rightGap: Math.round(gr.right - ar.right),
      leftOfActiveVisible: done,
      activeInView: ar.left >= gr.left - 1 && ar.right <= gr.right + 1,
    };
  });
  console.log(`autoscroll: scrollLeft=${m.scrollLeft}/${m.maxScroll} rightGap=${m.rightGap} done=${m.leftOfActiveVisible}`);
  // 공허 방지 — 실제로 넘쳐서 스크롤이 걸린 상태여야 이 오라클이 의미를 갖는다.
  expect(m.maxScroll, '칩이 실제로 넘친다').toBeGreaterThan(0);
  expect(m.scrollLeft, '자동 스크롤이 실제로 걸렸다').toBeGreaterThan(0);
  expect(m.activeInView, '진행중 칩이 보인다').toBe(true);
  expect(m.rightGap, '진행중 칩이 우측 끝에 정렬된다(좌→우 읽기)').toBeLessThanOrEqual(10);
  expect(m.leftOfActiveVisible, '왼쪽에 값이 찍힌 완료 칩이 보인다 = 입력 확인 영역')
    .toBeGreaterThanOrEqual(1);

  // 🔴 **이미 보이는 칩으로 넘어갈 때**가 이 계약의 진짜 시금석이다.
  //    앞으로 진행하며 칩이 화면 오른쪽 **밖**에서 들어올 때는 `scrollIntoView({inline:'nearest'})`도
  //    우연히 우측 정렬처럼 보인다('nearest'의 최소 스크롤량이 곧 우측 정렬이다). 그 경로만 재면
  //    **수정을 제거해도 통과하는 공허한 테스트**가 된다 — 실제로 그랬다(반증 1차 실패).
  //    다음 칩이 **이미 화면 안 왼쪽에 보이는 상태**로 만들어 두면 둘이 갈린다:
  //      · 'nearest' → 이미 보이므로 **안 움직인다**(칩이 왼쪽에 남는다).
  //      · 우측 끝 규칙 → 그 칩을 오른쪽 끝으로 **다시 정렬한다**.
  const beforeGap = await page.locator('[data-testid="voice-chip-grid"]').evaluate((el) => {
    const g = el as HTMLElement;
    const chips = Array.from(g.querySelectorAll('[data-testid="column-chip"]')) as HTMLElement[];
    const activeIdx = chips.findIndex((c) => c.getAttribute('data-active') === 'true');
    const next = chips[activeIdx + 1];
    // 다음 칩을 가시영역 **왼쪽 끝**에 오도록 미리 스크롤해 둔다.
    g.scrollLeft = Math.max(0, next.offsetLeft - g.offsetLeft);
    const gr = g.getBoundingClientRect();
    const nr = next.getBoundingClientRect();
    return { gap: Math.round(gr.right - nr.right), name: next.getAttribute('data-col-name') };
  });
  // 공허 방지 — 세팅이 실제로 "보이지만 우측 끝이 아닌" 상태를 만들었어야 한다.
  expect(beforeGap.gap, '다음 칩이 우측 끝이 아닌 곳에 보이도록 세팅됐다').toBeGreaterThan(40);

  await fireStt(page, '26.0', 500);
  const after = await page.locator('[data-testid="voice-chip-grid"]').evaluate((el) => {
    const g = el as HTMLElement;
    const active = g.querySelector('[data-testid="column-chip"][data-active="true"]') as HTMLElement;
    const gr = g.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    return { rightGap: Math.round(gr.right - ar.right), name: active.getAttribute('data-col-name') };
  });
  console.log(`autoscroll(revisit): 세팅 gap=${beforeGap.gap}(${beforeGap.name}) → 커밋 후 ${after.name} rightGap=${after.rightGap}`);
  expect(after.name, '다음 칩이 진행중이 됐다').toBe(beforeGap.name);
  expect(after.rightGap, '이미 보이던 칩도 우측 끝으로 재정렬된다').toBeLessThanOrEqual(10);
});

test('§공통규칙2·3 — 중앙 정보가 중앙 50% 안에서 가로+세로 중앙정렬', async ({ page }) => {
  await boot(page);
  const zone = await zoneMetrics(page);
  const hero = await page.locator('[data-hero-state]').boundingBox();
  expect(hero).not.toBeNull();
  const heroCy = hero!.y + hero!.height / 2;
  const heroCx = hero!.x + hero!.width / 2;
  expect(heroCy, '세로 중앙정렬').toBeCloseTo((zone.centerTop + zone.centerBottom) / 2, 0);
  expect(heroCx, '가로 중앙정렬').toBeCloseTo((zone.centerLeft + zone.centerRight) / 2, 0);
  // 중앙 정보가 구역을 넘치지 않는다(§공통규칙3 "위/아래 여백 고려").
  expect(hero!.y).toBeGreaterThanOrEqual(zone.centerTop - 1);
  expect(hero!.y + hero!.height).toBeLessThanOrEqual(zone.centerBottom + 1);
});

// ─── §공통규칙5 — 하단 `<` `>` 양끝 + 가운데 인디케이터 ────────────────────────
test('§공통규칙5 — `<` `>`가 하단 양끝, 인디케이터가 가운데(대기=도트 → 음성 입력=세로파형)', async ({ page }) => {
  await boot(page);
  const bar = await page.locator('[data-testid="voice-control-bar"]').boundingBox();
  const prev = await page.locator('button[aria-label="이전"]').boundingBox();
  const next = await page.locator('button[aria-label="다음"]').boundingBox();
  const band = await page.locator('[data-testid="live-listen-band"]').boundingBox();
  expect(prev).not.toBeNull(); expect(next).not.toBeNull(); expect(band).not.toBeNull();
  // 양끝 배치: `<`가 바 왼쪽 끝, `>`가 오른쪽 끝, 인디케이터가 그 사이.
  expect(prev!.x - bar!.x, '`<`는 바 왼쪽 끝').toBeLessThanOrEqual(16);
  expect(bar!.x + bar!.width - (next!.x + next!.width), '`>`는 바 오른쪽 끝').toBeLessThanOrEqual(16);
  expect(band!.x).toBeGreaterThanOrEqual(prev!.x + prev!.width - 1);
  expect(band!.x + band!.width).toBeLessThanOrEqual(next!.x + 1);
  // 장갑 조작 터치 타깃(PRINCIPLES §2).
  expect(prev!.height).toBeGreaterThanOrEqual(44);
  expect(next!.height).toBeGreaterThanOrEqual(44);
  // 파형이 인디케이터 슬롯을 넘치지 않는다(막대 13개가 `<` `>` 위로 삐져나오지 않는다).
  const waveFits = await page.locator('[data-testid="voice-waveform"]').evaluate((el) => {
    const w = el as HTMLElement;
    return { over: w.scrollWidth - w.clientWidth, bars: w.querySelectorAll('span').length };
  });
  expect(waveFits.bars).toBe(13);
  expect(waveFits.over, '파형 가로 넘침 0').toBeLessThanOrEqual(1);

  // 와이어프레임 §공통규칙5 — 대기(무음)에는 **도트 마이크**가 보이고 파형은 물러나 있다.
  await injectLevel(page, 0);
  const idle = await indicatorOpacity(page);
  expect(idle.dots, '대기: 도트 표시').toBeGreaterThan(0.9);
  expect(idle.wave, '대기: 파형 물러남').toBeLessThan(0.1);
  // 음성 입력이 들어오면 같은 자리가 **역동 세로파형**으로 전환된다.
  await injectLevel(page, 0.9);
  const speaking = await indicatorOpacity(page);
  expect(speaking.wave, '음성 입력: 파형 전환').toBeGreaterThan(0.9);
  expect(speaking.dots, '음성 입력: 도트 물러남').toBeLessThan(0.1);
  // 🔴 전환은 표시 전환이지 마운트 교체가 아니다 — 두 노드 모두 계속 살아 있다.
  await expect(page.locator('[data-testid="state-dots"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="voice-waveform"]')).toHaveCount(1);
});

// ─── §[3] paused ────────────────────────────────────────────────────────────
test('§[3] paused — 중앙 비움 + 상단 "일시정지" + 하단 `<`=재개 / `>`=종료 + 도트 `||`', async ({ page }) => {
  await boot(page);
  await page.locator('button[title="일시정지"]').click({ force: true });
  await page.waitForTimeout(400);

  // 상단 "일시정지" 표시(§[3]).
  const badge = page.locator('[data-testid="paused-card"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('일시정지');

  // 중앙 비움 — 값도, "일시정지됨" 문구도 없다.
  const centerText = await page.locator('[data-testid="voice-center-stage"]').innerText();
  expect(centerText.trim(), '§[3] 중앙 비움').toBe('');

  // 하단 `<` `>` → 재개 / 종료(§[3]). 재개 버튼은 정확히 하나다(인디케이터는 표시 전용).
  await expect(page.locator('button[title="재시작"]')).toHaveCount(1);
  await expect(page.locator('button[title="재시작"][aria-label="재개"]')).toBeVisible();
  await expect(page.locator('button[title="입력 종료"]')).toBeVisible();
  await expect(page.locator('button[aria-label="이전"]'), '일시정지 중엔 이전/다음이 아니다').toHaveCount(0);

  // 도트는 일시정지 아이콘(||), 파형은 정지(rAF 미가동).
  await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-glyph', 'pause');
  // 구역 배분은 상태가 바뀌어도 불변(§공통규칙1).
  const m = await zoneMetrics(page);
  const zoneTotal = m.rootHeight - m.headerHeight;
  expect(m.centerHeight / zoneTotal, '일시정지에서도 중앙 50%').toBeCloseTo(0.5, 2);
});

// ─── §[2] anomaly ───────────────────────────────────────────────────────────
test('§[2] anomaly — 경보행 + 2열 비교(직전/현재) + 하단 `<`=확인 / `>`=수정 + 경고 도트', async ({ page }) => {
  await boot(page);
  await triggerAnomaly(page);

  // 경보행: `<추세|범위>알람 : <넘어선 정도>` — **값 위**에 온다(§[2] "값 위·값 안 가림").
  const headline = page.locator('[data-testid="anomaly-headline"]');
  // §[2] `<추세|범위>알람 : <넘어선 정도>` + 방향어(민구 확정 2026-07-25 — TTS와 글자까지 동일
  // 계약 복원. 상세 오라클은 아래 '§[2] 경보 라벨이 TTS와 글자까지 같다' 케이스).
  await expect(headline, '§[2] 경보행 표기').toHaveText('추세 알람 증가 : 20.5');
  const headlineBox = (await headline.boundingBox())!;
  const compareBox = (await page.locator('[data-testid="anomaly-comparison"]').boundingBox())!;
  expect(headlineBox.y + headlineBox.height, '경보행이 값 위').toBeLessThanOrEqual(compareBox.y + 1);

  // 2열 비교: 직전(날짜)↓과거값 / 현재↓알람 유발값.
  await expect(page.locator('[data-testid="anomaly-comparison"]')).toContainText('직전');
  await expect(page.locator('[data-testid="anomaly-comparison"]')).toContainText('현재');
  await expect(page.locator('[data-testid="anomaly-prev-value"]')).toHaveText('100');
  await expect(page.locator('[data-testid="anomaly-next-value"]')).toHaveText('120.5');
  const prevBox = (await page.locator('[data-testid="anomaly-prev-value"]').boundingBox())!;
  const nextBox = (await page.locator('[data-testid="anomaly-next-value"]').boundingBox())!;
  expect(prevBox.x + prevBox.width, '직전값이 왼쪽 열').toBeLessThanOrEqual(nextBox.x + 1);
  expect(Math.abs(prevBox.y - nextBox.y), '두 값이 같은 줄').toBeLessThanOrEqual(4);

  // 하단 `<` `>` → 확인 / 수정(알람 동안만). 카드 안이 아니라 **하단 양끝**이다.
  const confirm = page.locator('[data-testid="anomaly-confirm-btn"]');
  const modify = page.locator('[data-testid="anomaly-modify-btn"]');
  await expect(confirm).toBeVisible();
  await expect(modify).toBeVisible();
  const bar = (await page.locator('[data-testid="voice-control-bar"]').boundingBox())!;
  const cBox = (await confirm.boundingBox())!;
  const mBox = (await modify.boundingBox())!;
  expect(cBox.y, '확인은 하단 바 안').toBeGreaterThanOrEqual(bar.y - 1);
  expect(cBox.x, '확인이 왼쪽 끝').toBeLessThan(mBox.x);
  expect(cBox.height).toBeGreaterThanOrEqual(44);
  expect(mBox.height).toBeGreaterThanOrEqual(44);

  // 경고 도트(!) + 빨강 톤(§[2] "빨강 톤(값·파형·활성칸)").
  await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-glyph', 'alert');
  await expect(page.locator('[data-testid="voice-status-control"]')).toHaveAttribute('data-tone', 'red');
  const activeChipBorder = await page.locator('[data-testid="column-chip"][data-active="true"]')
    .evaluate((el) => getComputedStyle(el as HTMLElement).borderTopColor);
  expect(activeChipBorder, '활성칸 빨강 강조').toBe('rgb(255, 82, 82)');
});

// ─── §[4] complete ──────────────────────────────────────────────────────────
test('§[4] complete — 중앙 `완료 : X / N` + 종료 버튼, 체크 도트, 일시정지 버튼 없음', async ({ page }) => {
  await boot(page);
  await fillAllRows(page);
  const summary = page.locator('[data-testid="complete-summary"]');
  await expect(summary).toBeVisible({ timeout: 8000 });

  // 완료 : X / N — X는 실제로 채워진 행 수(스킵·샘플손실 반영, ≤ N).
  await expect(page.locator('[data-testid="complete-count"]')).toHaveText('완료 : 2 / 2');
  // 종료 버튼(중앙) — 데이터 영향 행동이라 확인 다이얼로그로 이어진다.
  const exit = summary.locator('button[title="입력 종료"]');
  await expect(exit).toBeVisible();
  // 상단 "완료" 배지(§[4]).
  await expect(page.locator('[data-testid="session-complete-badge"]')).toHaveText('완료');
  // 하단 `<` `>` **유지**(§[4] "하단 `<` `>` 유지").
  await expect(page.locator('button[aria-label="이전"]')).toBeVisible();
  await expect(page.locator('button[aria-label="다음"]')).toBeVisible();
  // 파형 자리 = V(체크) 도트.
  await expect(page.locator('[data-testid="state-dots"]')).toHaveAttribute('data-glyph', 'check');
  // 완료 상태의 유일한 행동은 종료다 — 일시정지 버튼이 존재하지 않는다(기존 계약 v023-voice와 동일).
  await expect(page.locator('button[title="일시정지"]')).toHaveCount(0);
  await exit.click();
  await expect(page.locator('button[title="종료 확인"]')).toBeVisible();
});

test('§[4] — `완료 : X / N`의 X는 실제로 채워진 행 수다(스킵 행은 빠진다)', async ({ page }) => {
  await boot(page);
  // 1행을 값 없이 '다음'으로 건너뛴다 → skippedRows로 갈라져 completedRows에 들어가지 않는다.
  await page.locator('button[aria-label="다음"]').click();
  await page.waitForTimeout(700);
  await fillAllRows(page);
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 10_000 });
  // 🔴 여기가 §[4]의 고유 의미다 — 총행 수를 그대로 찍으면 통과하는 단언이 아니어야 한다.
  await expect(page.locator('[data-testid="complete-count"]'), '스킵 행은 완료 수에서 빠진다')
    .toHaveText('완료 : 1 / 2');
});

test('§[4] 대비 — 완료 **행 검토 대기**는 [1] active 레이아웃을 유지한다(완료 화면으로 오인 금지)', async ({ page }) => {
  await boot(page);
  await fillAllRows(page);
  await expect(page.locator('[data-testid="complete-summary"]')).toBeVisible({ timeout: 8000 });
  // 끝 도달 → '이전'으로 완료 행 검토 대기 진입(phase는 그대로 'complete', endReached만 내려간다).
  await page.locator('button[aria-label="이전"]').click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-testid="complete-summary"]'), '검토 대기는 완료 화면이 아니다').toHaveCount(0);
  await expect(page.locator('[data-testid="session-complete-badge"]')).toHaveCount(0);
  // hero의 검토 표시(✓ + 방금 커밋값)가 살아 있다 = v035-hero-confirm 동작 계약 보존.
  await expect(page.locator('[data-hero-state="review"]')).toBeVisible();
});

// ─── 수용기준: "회전 시 출력물 진동" — 정직하게 남기는 부분 ─────────────────────────────
//
// 🔴 **진동 자체는 이 라운드에서 재현하지 못했다(기기 게이트).** HANDOFF/[IOS-7] 잔여는 원인을
//    `useFitScale.ts`의 ResizeObserver 자기관측으로 특정했지만, 계측으로 **반증**됐다:
//    회전 전후 `--fit-lo`를 25ms 간격으로 2초씩 샘플링해도(이상치·수정·hero 카드 3종, 자기관측
//    코드 그대로) 값이 한 번도 흔들리지 않았다. 이유는 `fit()`이 **각 후보 단계를 적용한 뒤 그
//    레이아웃으로 측정**하기 때문이다 — 선택된 단계는 자기일관적이고, RO가 다시 깨워도 같은 단계로
//    수렴하고 멈춘다. 자기관측은 중복 1회를 더할 뿐 쌍안정 루프를 만들지 않는다.
//    (자기관측 제거는 그대로 두되 **방어적 단순화**이지 검증된 fb-01 수정이 아니다.)
//
// 대신 여기서는 진동의 **사용자에게 보이는 형태** — "안 바뀐 요소가 따라 움직인다" — 를 고정한다.
// 종전 구조에서 그게 실제로 일어나던 경로는 파형 밴드였다: 밴드 높이가 `window.innerHeight`
// 파생인데 자기 grid 트랙(auto)을 차지해서, iOS가 회전·URL바 변화 중 innerHeight를 잘게 흔들면
// **컨트롤바가 따라 움직이고 중앙 흡수영역이 같이 늘었다 줄었다** 했다. 새 구조는 밴드를 하단 25%
// 트랙 **안**에 넣어 그 전달 경로를 끊는다.
async function indicatorHeight(page: Page): Promise<number> {
  return page.locator('[data-testid="voice-waveform"]').evaluate((el) => el.getBoundingClientRect().height);
}

test('진동 경로 차단 — 화면 높이를 쓸어도(밴드 높이가 실제로 변해도) 구역 비율이 흔들리지 않는다', async ({ page }) => {
  await boot(page, PHONE_375);
  const heights: number[] = [];
  // 밴드 높이 산식 `clamp(60, innerHeight×0.105, 100)`이 실제로 서로 다른 값을 내는 높이들.
  for (const h of [667, 812, 874, 1000]) {
    await page.setViewportSize({ width: 375, height: h });
    await page.waitForTimeout(350);
    heights.push(await indicatorHeight(page));
    const m = await zoneMetrics(page);
    const zoneTotal = m.rootHeight - m.headerHeight;
    console.log(`h=${h} band=${heights[heights.length - 1].toFixed(0)} chip=${m.chipHeight.toFixed(0)} center=${m.centerHeight.toFixed(0)} bottom=${m.bottomHeight.toFixed(0)}`);
    expect(m.chipHeight / zoneTotal, `칩존 25% @${h}`).toBeCloseTo(0.25, 2);
    expect(m.centerHeight / zoneTotal, `중앙 50% @${h}`).toBeCloseTo(0.5, 2);
    expect(m.bottomHeight / zoneTotal, `하단 25% @${h}`).toBeCloseTo(0.25, 2);
  }
  // 🔴 공허 방지 — 밴드 높이가 **실제로 변했는데도** 비율이 유지된 것이어야 의미가 있다.
  //    (v019 R1 주석이 지적한 "항상 참인 상한" 토톨로지를 되풀이하지 않는다.)
  expect(new Set(heights.map((h) => Math.round(h))).size, '스윕 구간에서 파형 밴드 높이가 실제로 달라졌다')
    .toBeGreaterThan(1);
});

test('진동 경로 차단 — 상태가 바뀌어도 구역 경계가 움직이지 않는다(active/이상치/일시정지)', async ({ page }) => {
  await boot(page, PHONE_375);
  const snap = async () => {
    const m = await zoneMetrics(page);
    return [m.chipHeight, m.centerHeight, m.bottomHeight, m.centerTop, m.centerBottom].map((v) => Math.round(v));
  };
  const active = await snap();
  await triggerAnomaly(page);
  const anomaly = await snap();
  await page.locator('[data-testid="anomaly-confirm-btn"]').click();
  await page.waitForTimeout(700);
  await page.locator('button[title="일시정지"]').click({ force: true });
  await page.waitForTimeout(400);
  const paused = await snap();
  console.log(`active=${active} anomaly=${anomaly} paused=${paused}`);
  // v0.19.0 버그B(컨트롤바 Y 인변량)의 후신 — 이제 **모든 구역 경계**로 확장한다.
  expect(anomaly, '이상치에서도 구역 경계 불변').toEqual(active);
  expect(paused, '일시정지에서도 구역 경계 불변').toEqual(active);
});

test('회전 왕복 — 구역 배분·세션 표시가 그대로 살아 있다(트리 교체 없음)', async ({ page }) => {
  await boot(page, PHONE_375);
  await triggerAnomaly(page);
  // ⚠️ `hasTouch` 없이 뷰포트만 바꾼다. PortraitGuard는 `(pointer: coarse)`를 요구하므로 여기서는
  //    뜨지 않는다 — 이 오라클은 오버레이가 아니라 입력화면 자체를 본다.
  await page.setViewportSize({ width: 667, height: 375 });
  await page.waitForTimeout(600);
  await page.setViewportSize(PHONE_375);
  await page.waitForTimeout(600);
  // 회전 왕복 뒤에도 알람 상태·구역 배분이 유지된다(상태 전환은 표시 전환이지 트리 교체가 아니다).
  await expect(page.locator('[data-testid="anomaly-alert"]')).toBeVisible();
  await expect(page.locator('[data-testid="anomaly-confirm-btn"]')).toBeVisible();
  const m = await zoneMetrics(page);
  const zoneTotal = m.rootHeight - m.headerHeight;
  expect(m.centerHeight / zoneTotal, '회전 왕복 후에도 중앙 50%').toBeCloseTo(0.5, 2);
  expect(m.chipHeight / zoneTotal, '회전 왕복 후에도 칩존 25%').toBeCloseTo(0.25, 2);
});

// ─── 민구 확정 반영분 (2026-07-25 라운드 판단) ──────────────────────────────────

test('§[2] 경보 라벨이 TTS와 글자까지 같다 — 방향어(증가/감소) 유지', async ({ page }) => {
  await boot(page);
  await triggerAnomaly(page);

  // 🔴 시각·청각 일치 계약(v0.20.0 입력탭#6): `alertText`(TTS)와 팝업 라벨은 **글자까지 동일**해야
  //    한다. 현장에선 화면을 안 보고 귀로만 듣는 경우가 많아, 둘이 다르면 혼란스럽다.
  //    초안은 와이어프레임 §[2] 표기를 좁게 읽어 방향어를 뺐다가 어긋났다(민구 판단으로 복원).
  const headline = page.locator('[data-testid="anomaly-headline"]');
  await expect(headline).toContainText('추세 알람');
  await expect(headline, '방향어가 라벨에 남아 있다').toContainText('증가');

  // TTS가 실제로 말한 문장과 대조 — 라벨의 핵심 어절이 그대로 발화돼야 한다.
  const spoken = await page.evaluate(() => (window as unknown as { __ttsLog?: string[] }).__ttsLog ?? []);
  const alarmTts = spoken.find((t) => t.includes('추세 알람'));
  expect(alarmTts, '알람 TTS가 발화됐다').toBeTruthy();
  expect(alarmTts, 'TTS도 같은 방향어를 쓴다').toContain('증가');
});

test('§[4] complete — 마지막 값을 3초 보여준 뒤 와이어프레임대로 정착한다', async ({ page }) => {
  await boot(page);
  await fillAllRows(page);
  const receipt = page.locator('[data-testid="complete-receipt"]');

  // 끝 도달 직후: 방금 확정한 값이 보인다. 이 줄이 없으면 마지막 셀을 채우는 순간이 곧 끝 도달이라
  // 사용자가 방금 넣은 값을 **한 번도 확인하지 못한 채** 완료 화면으로 넘어간다.
  await expect(receipt, '끝 도달 직후에는 마지막 값이 보인다').toBeVisible({ timeout: 3000 });

  // 3초 뒤: 와이어프레임 §[4] 그대로(요약 + 종료 버튼)로 정착한다(민구 확정 2026-07-25).
  await expect(receipt, '3초 뒤 영수증이 걷힌다').toHaveCount(0, { timeout: 6000 });
  await expect(page.locator('[data-testid="complete-count"]'), '요약은 남는다').toBeVisible();
  await expect(
    page.locator('[data-testid="complete-summary"] button[title="입력 종료"]'),
    '종료 버튼은 남는다',
  ).toBeVisible();
});
