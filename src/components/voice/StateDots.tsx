import { useEffect, useRef } from 'react';

/** 하단 인디케이터 — **도트 격자 하나**가 상태 글리프와 음성 파형을 **둘 다** 그린다.
 *
 *  ## 왜 하나로 합쳤나 ([UI-WAVE-1] / fb-27-1의 구조적 해소)
 *  v0.39.0까지는 도트(대기)와 세로막대 파형(입력)이 **서로 다른 두 레이어**였고
 *  `--voice-level`로 opacity를 교차시켰다:
 *  ```
 *  도트  opacity: max(0, 1 - level*8)      파형  opacity: min(1, level*8)
 *  ```
 *  `level ∈ (0, 0.125)`에서 **둘 다 부분 가시**였다(실기기 B세션 avg 0.06 → 도트 52% + 파형 48%).
 *  게이트가 "인식 중"이 아니라 "주변 소음"이었고, 현장 소음은 0이 아니다.
 *
 *  이제 격자가 **하나**다. 한 셀은 켜지거나 꺼지거나 둘 중 하나이므로 **겹쳐 보이는 상태가
 *  물리적으로 존재하지 않는다.** 민구가 fb-27-3("파형도 도트 집합으로")을 요청하면서 두 요청이
 *  하나의 설계로 합쳐진 결과다.
 *
 *  ⚠️ 정확히 말하면: **겹침(중첩 렌더)은 소멸했고, 무엇을 그릴지 고르는 게이트는 남는다.**
 *  게이트가 남는 한 임계 부근에서 **깜빡임**이 생길 수 있어 아래 hangover로 막는다.
 *
 *  ## 게이트 = 임계 + hangover (깜빡임 방지)
 *  말은 뚝뚝 끊긴다 — 어절 사이마다 레벨이 0 근처로 떨어진다. 단순 임계면 한 문장 안에서
 *  글리프↔파형이 여러 번 튄다(2~3m 밖에서는 고장으로 읽힌다). 그래서 **들어갈 때는 즉시,
 *  나올 때는 `HANGOVER_MS` 동안 계속 조용해야** 나온다.
 *  임계는 `WAVE_ACTIVE_MIN`(0.02)을 그대로 쓴다 — "죽은 마이크보다는 위, 조용한 발화보다는
 *  한참 아래"라는 근거가 이미 검증된 값이라 새 숫자를 지어내지 않는다.
 *
 *  ## 수명주기 계약 (건드리지 마라)
 *  - **조건부 렌더 금지** — 이 컴포넌트는 상태와 무관하게 계속 마운트된다. 발화마다
 *    마운트/언마운트되면 rAF·IntersectionObserver가 teardown돼 [STT-16] 계열 사고가 된다.
 *  - `active=false`(일시정지) / `prefers-reduced-motion` → rAF 미가동(정적 글리프).
 *  - `visibilityState==='hidden'` · 화면 밖(IntersectionObserver) → rAF 정지, 복귀 시 재개.
 *    장시간 현장 세션의 배터리·발열 계약이다(종전 `VoiceWaveform`에서 그대로 승계). */
export type DotGlyph = 'mic' | 'alert' | 'pause' | 'check';

/** 격자 치수 — 두 번의 밀도 배가 이력이 여기 겹쳐 있다. **둘 다 민구 확정이다.**
 *  - v0.44.0 §C5(F14, 민구 확정 §4-a 9): 13×7 → **18×10**(셀 91 → 180 ≈ 2.0배)
 *  - v0.46.0 WP-G(민구 확정 2026-08-05): 18×10 → **25×14**(셀 180 → 350 ≈ 1.94배)
 *  민구 원문은 두 번 다 *"밀도를 2배로"*. 도트 지름은 세로 셀에서 산출하므로 행이 늘면 도트가
 *  작아지고 촘촘해진다 — 격자 전체 크기는 그대로다(밴드 높이·2/3 폭 계약 불변).
 *
 *  🔴 **되돌리는 법: 이 두 상수만 18/10으로 되돌리면 v0.45.0 격자가 그대로 돌아온다**
 *  (`USABLE_ROWS`는 10 그대로 두면 예약 행이 0이 되어 §C5-b 겹침이 함께 되살아난다).
 *  도트 8.7px가 야외 2~3m에서 안 읽히면 이 한 곳이 롤백 지점이다. */
export const FIELD_COLS = 25;
export const FIELD_ROWS = 14;

/** 🔴 **글리프·웨이브가 실제로 쓰는 행 수. 하단 `FIELD_ROWS - USABLE_ROWS`행은 비워 둔다.**
 *
 *  ## 왜 (WP-G §3-G, 민구 제보 F2② 정정 2026-08-05)
 *  §C5-b(v0.44.0)가 접힌 조절판 토글을 **플로우에서 빼 오버레이 필로** 만들면서 하단 트랙의
 *  ~49px 침범을 없앴다 — 대신 그 필이 **도트 위에 겹쳐 뜨게** 됐다. 당시 판단 근거는
 *  *"도트는 표시일 뿐 터치 대상이 아니라서 겹쳐도 오탭 경로가 없다"* 였고, 그건 **지금도 참이다.**
 *  놓친 건 「보기 싫다」는 축이었다(민구 원문: *"서랍을 열지 않았는데 닫혀 있는 서랍이 도트
 *  영역을 침범했다"*).
 *
 *  ## 왜 「글리프를 다시 그리기」가 아니라 「행 예약」인가 — 실측이 처방을 뒤집었다
 *  필은 `mode==='nav'`에서만 뜬다(`ActiveState.tsx` edgeMode). 그래서 **`pause`·`alert`는
 *  필이 `display:none`인 상태에서만 나와 애초에 겹치지 않는다.** 402×874 실측(켜진 셀 기준):
 *  nav 무음(idle) 6셀 · nav 발화(wave) 14셀 · 완료(check) 2셀 · 일시정지 0 · 이상치 0.
 *  🔑 **겹침 22셀 중 글리프 비트맵이 만든 건 2셀뿐**이고 나머지 20셀은 `litFromAmps()`가 매
 *  프레임 만든다. 비트맵만 고쳤으면 문제가 그대로 남았다.
 *
 *  ## 이 상수 하나로 두 경로가 동시에 막힌다
 *  `glyphLit()`은 `USABLE_ROWS`까지만 읽고, `litFromAmps()`의 중심 `mid`도 여기서 나온다
 *  (`(USABLE_ROWS-1)/2 = 4.5` — **v0.45.0과 같은 값이라 파형 진폭 상한 4 계약이 그대로다**).
 *  🔴 웨이브/글리프에 하단 행을 쓰는 코드를 새로 넣지 마라 — 오라클
 *  `tests/v0460-g-dot-pill.spec.ts`가 상태 5종에서 이 계약을 지킨다. */
export const USABLE_ROWS = 10;
/** 접힌 필이 앉는 하단 예약 행 수(= 4). 표시는 이 행들을 절대 켜지 않는다. */
export const RESERVED_ROWS = FIELD_ROWS - USABLE_ROWS;

/** 좁은 비트맵을 `FIELD_COLS`열 한가운데로 옮긴다(글리프마다 열 수가 달라도 격자는 고정). */
function center(rows: readonly string[]): string[] {
  return rows.map((r) => {
    const pad = FIELD_COLS - r.length;
    const left = Math.floor(pad / 2);
    return '.'.repeat(left) + r + '.'.repeat(pad - left);
  });
}

/** 상태 글리프 비트맵(`#`=켜짐). 전부 **`USABLE_ROWS`(10)행**으로 맞춰 상태가 바뀌어도 격자
 *  기하가 불변이다. 하단 `RESERVED_ROWS`(4)행은 여기 아예 존재하지 않는다 — 필 자리다.
 *  v0.46.0 WP-G — 25폭 격자에 맞춰 4종 전부 다시 그렸다(오라클: v0440-c5-dots [node]).
 *
 *  🔴 **켜진 셀 「비율」을 지키는 게 계약이다**(플랜 §3-D 발광 면적 중립 — OLED는 켜진 픽셀이
 *  곧 전력이다). 도트 지름이 12px → 9px로 줄어 **셀당 면적이 0.5625배**이므로 셀 수가
 *  1.78배까지 늘어도 면적은 중립이다. 실제 비율(v0.45.0 /180 → v0.46.0 /350):
 *    mic 15.0% → 10.9% · alert 15.0% → 15.4% · pause 33.3% → 28.6% · check 6.1% → 6.3%
 *  🔑 발광의 지배항은 글리프가 아니라 idle 웨이브(48.9%)·파형(55.6%)이고, 그쪽은 행 0~9만
 *  쓰므로 열 수에만 비례한다(18→25열 = 1.39배 × 0.5625 = **0.78배**). 전체는 중립 이하다.
 *
 *  🔴 `mic`은 F19로 **화면에 더는 렌더되지 않는다**(listening 무음은 idle 웨이브가 대신한다).
 *  비트맵을 남기는 이유: DotGlyph 타입 완전성 + 격자 재작성 계약(플랜 §C5 오라클 ③)이
 *  4종 전부를 대상으로 한다. 되살릴 때는 F19(민구 확정)를 뒤집는 결정 기록이 먼저다. */
const GLYPHS: Record<DotGlyph, string[]> = {
  // 마이크: 캡슐 + 수음 아크 + 스탠드/받침. (F19 이후 도달 불가 — 위 주석)
  mic: center(['...####...', '...####...', '...####...', '...####...', '...####...', '#........#', '.########.', '....##....', '....##....', '...####...']),
  // 경고: **굵은 느낌표**(민구 확정 2026-07-27, 후보 1번 — fb-27-4 종결).
  //   종전 삼각형+느낌표는 외곽이 도트를 나눠 써서 획이 얇았다. 외곽을 버리고 획에 도트를
  //   몰아주면 같은 밴드 높이에서 획이 가장 굵어져 야외·원거리에서 가장 크게 읽힌다.
  //   🔴 25폭에서 3 → 6폭으로 **굵혔다**: 도트가 12→9px로 작아진 만큼을 획 폭으로 되갚는다.
  //   4종 중 유일하게 비율이 오른 글리프인데(15.0→15.4%), 경고는 2~3m 밖 판독이 1순위다.
  alert: center(['######', '######', '######', '######', '######', '######', '######', '......', '######', '######']),
  // 일시정지: 막대 두 개. 폭 7/18(38.9%) → 12/25(48%)로 굵히면서도 비율은 33.3 → 28.6%로 내려간다.
  pause: center(['#####..#####', '#####..#####', '#####..#####', '#####..#####', '#####..#####', '#####..#####', '#####..#####', '#####..#####', '#####..#####', '#####..#####']),
  // 완료: 체크(짧은 하강 + 긴 상승). 15폭·획 2셀 — 1셀 획은 9px 도트에서 야외 판독이 무너진다.
  //   🔴 세로 8행에 담는다(2셀 획을 10행에 펼치면 27셀=7.7%로 **비율이 6.1%에서 올라간다** —
  //   발광 면적이 느는 유일한 방향이라 되돌렸다). 지금은 22셀 = 6.3%로 사실상 중립이다.
  check: center([
    '...............',
    '...............',
    '............##.',
    '...........##..',
    '..........##...',
    '#........##....',
    '##......##.....',
    '.##....##......',
    '..#####........',
    '...............',
  ]),
};

/** 호흡 주기 — EdgeGlow/voice-status-fade와 같은 상태별 cadence(경고는 빠르게, 일시정지는 느리게). */
const BREATHE_S: Record<DotGlyph, number> = { mic: 1.75, alert: 0.7, pause: 2.4, check: 2 };

function dotBreatheAnimation(glyph: DotGlyph, index: number): string {
  const r = Math.floor(index / FIELD_COLS);
  const c = index % FIELD_COLS;
  // 호흡의 진원지는 **표시 영역의 중심**이지 격자 상자의 중심이 아니다 — 하단 예약 행을 세면
  // 진원지가 필 쪽으로 내려가 파동이 아래에서 위로 밀려오는 것처럼 보인다(WP-G).
  const delay = (Math.hypot(c - (FIELD_COLS - 1) / 2, r - (USABLE_ROWS - 1) / 2)
    / Math.hypot((FIELD_COLS + 1) / 2, (USABLE_ROWS + 1) / 2)) * 0.45;
  return `dot-breathe ${BREATHE_S[glyph]}s ease-in-out ${delay.toFixed(2)}s infinite`;
}

/** 파형 모드 진입 임계 — `VoiceWaveform`의 검증된 값을 그대로 승계한다.
 *  근거: recorder 레벨은 `RMS/LEVEL_REF_RMS` 지수평활이고 프리롤 미가용·teardown 시 **정확히 0**.
 *  대화 발화는 0.2~1.0 → 0.02는 죽은 마이크보다 확실히 위, 조용한 실제 발화보다 한참 아래. */
const WAVE_ACTIVE_MIN = 0.02;
/** 파형 모드 이탈 지연 — 어절 사이 침묵에 글리프로 튀지 않게. */
const HANGOVER_MS = 400;
/** ~30fps 게이트 — 장시간 현장 세션의 배터리·발열 부담을 낮춘다. */
const FRAME_MS = 33;
const FFT = 1024;

export function StateDots({
  glyph, color, size, active = false, getLevel, getTimeDomainData,
}: {
  glyph: DotGlyph;
  color: string;
  /** 격자 높이 상한(px). 실제 높이는 부모 밴드 예산 안에서 더 작아질 수 있다. */
  size: number;
  /** 오디오 반응 여부(일시정지/완료는 false → 정적 글리프). */
  active?: boolean;
  getLevel?: () => number;
  getTimeDomainData?: (out: Uint8Array) => boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cellsRef = useRef<Array<HTMLSpanElement | null>>([]);
  // 도트 크기는 세로 셀에서만 잡는다. 열 피치는 화면 2/3 폭을 따로 나눠 가지므로 넓어져도
  // 도트 자체는 원형을 유지한다(ui-standard §3-1).
  const cell = Math.max(3, Math.floor(size / FIELD_ROWS));
  const dot = Math.max(2, Math.round(cell * 0.72));
  const gridHeight = cell * FIELD_ROWS;

  useEffect(() => {
    const cells = cellsRef.current;
    if (!cells.length) return;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // effect-local 캐시다. glyph/active/오디오 공급자가 바뀌어 effect가 다시 만들어지면
    // null에서 시작해 첫 paint를 전량 쓰기로 강제한다. 전역 상태와 DOM의 불일치가 남지 않는다.
    let paintedLit: boolean[] | null = null;

    /** 켜진 셀만 보이게 한다. **글리프와 파형이 같은 셀 집합을 공유**하므로 겹칠 수가 없다. */
    const paint = (lit: boolean[], force = false) => {
      const cacheTrusted =
        !force
        && paintedLit !== null
        && paintedLit.length === cells.length
        && lit.length === cells.length;
      let allCellsPresent = true;
      for (let i = 0; i < cells.length; i++) {
        const el = cells[i];
        if (!el) {
          allCellsPresent = false;
          continue;
        }
        const on = lit[i] === true;
        // C5 — 무음에서도 같은 350개 값을 ~30fps로 재기록하지 않는다. cache가 없거나
        // 신뢰할 수 없는 경계에서는 화면 동결보다 중복 쓰기가 안전하므로 전량 쓴다.
        if (!cacheTrusted || paintedLit![i] !== on) {
          el.style.opacity = on ? '1' : '0';
        }
        // 🔴 꺼진 셀에는 animation 자체가 없어야 한다. paused만 쓰면 이미 active 구간에 들어간
        // keyframe opacity(0.62~1)가 인라인 opacity:0을 이겨 유령 도트가 남는다([UI-DOT-GHOST-1]).
        if (!on) {
          if (el.style.animationName !== 'none') el.style.animation = 'none';
        } else if (
          el.style.animationName !== 'dot-breathe'
          || el.style.animationDuration !== `${BREATHE_S[glyph]}s`
        ) {
          el.style.animation = dotBreatheAnimation(glyph, i);
        }
      }
      paintedLit = allCellsPresent && lit.length === cells.length ? lit.slice() : null;
    };

    // 🔴 `USABLE_ROWS`까지만 읽는다 — 비트맵은 10행이고 하단 4행은 필 자리라 항상 꺼짐이다.
    const glyphLit = (): boolean[] => {
      const rows = GLYPHS[glyph];
      const out = new Array<boolean>(FIELD_COLS * FIELD_ROWS).fill(false);
      for (let r = 0; r < USABLE_ROWS; r++) {
        for (let c = 0; c < FIELD_COLS; c++) out[r * FIELD_COLS + c] = rows[r][c] === '#';
      }
      return out;
    };

    /** 열별 진폭 → 중앙에서 위아래 대칭으로 켠다. 짝수 행(10)이라 mid=4.5 — `amp + 0.5` 판정으로
     *  amp 0도 중앙 2행이 남는다(0이면 열이 통째로 꺼져 파형이 이 빠진 듯 보인다). amp 상한 4 = 전 10행.
     *  🔴 WP-G — 중심·범위가 `FIELD_ROWS`(14)가 아니라 `USABLE_ROWS`(10)다. **mid는 4.5로
     *  v0.45.0과 같아서 진폭 상한 4 계약이 그대로 살아 있고**, 하단 예약 행은 어떤 진폭에서도
     *  켜지지 않는다(겹침을 없앤 축이 여기다 — 겹침 22셀 중 20셀이 이 함수에서 나왔다). */
    const litFromAmps = (amps: number[]): boolean[] => {
      const out = new Array<boolean>(FIELD_COLS * FIELD_ROWS).fill(false);
      const mid = (USABLE_ROWS - 1) / 2;
      for (let c = 0; c < FIELD_COLS; c++) {
        for (let r = 0; r < USABLE_ROWS; r++) {
          if (Math.abs(r - mid) <= amps[c] + 0.5) out[r * FIELD_COLS + c] = true;
        }
      }
      return out;
    };

    /** §C5-①(F11·F19) — **idle 웨이브**: 무음에도 열마다 위상차를 준 저진폭 파동이 돈다.
     *  amp ∈ {1, 2} → 열당 4~6행. 민구 원문 *"음성이 들리지 않아도 진동을 보여줘서 인식중이란 걸
     *  알려라"* — 조용하면 화면이 죽은 것처럼 보이던 F11의 처방이고, 그래서 mic 글리프가
     *  필요 없어졌다(F19와 같은 처방으로 수렴). 주기 1.6s(플랜 §C5 기대값 ①). */
    const IDLE_PERIOD_MS = 1600;
    const idleLit = (now: number): boolean[] => {
      const amps = new Array<number>(FIELD_COLS);
      for (let c = 0; c < FIELD_COLS; c++) {
        const phase = Math.sin((now / IDLE_PERIOD_MS) * Math.PI * 2 + c * 0.7);
        amps[c] = phase >= 0 ? 2 : 1;
      }
      return litFromAmps(amps);
    };
    /** reduced-motion·rAF 미가동 폴백 — 정적 저진폭 밴드(중앙 4행). 플랜 §C5 ①의 reduced 계약. */
    const idleStaticLit = (): boolean[] => litFromAmps(new Array<number>(FIELD_COLS).fill(1));

    // 마운트 직후·glyph/active 변경으로 effect가 재생성된 직후는 cache를 신뢰하지 않는다.
    // 🔴 F19 — listening(mic)은 글리프를 그리지 않는다. 첫 페인트부터 idle 웨이브(정적 폼)다.
    const listening = glyph === 'mic';
    paint(listening ? idleStaticLit() : glyphLit(), true);
    rootRef.current?.setAttribute('data-mode', listening ? 'idle' : 'glyph');
    if (reduced || !active || !getLevel) return;

    const buf = new Uint8Array(FFT);
    let raf = 0;
    let disposed = false;
    let lastFrameAt = 0;
    let visible = true;
    let lastLoudAt = 0;
    let paintedMode: 'glyph' | 'wave' | 'idle' = listening ? 'idle' : 'glyph';

    const schedule = () => {
      if (disposed || !visible || document.visibilityState === 'hidden') return; // onVis/IO가 재개
      if (raf === 0) raf = requestAnimationFrame(render);
    };

    const render = (now: number) => {
      raf = 0;
      if (now - lastFrameAt < FRAME_MS) { schedule(); return; }
      lastFrameAt = now;

      const ok = getTimeDomainData?.(buf) ?? false;
      // 테스트 심(파형 시절과 동일 계약): __voiceLevelOverride가 있으면 그 값으로 진폭 검증.
      const override = (window as unknown as { __voiceLevelOverride?: number }).__voiceLevelOverride;
      const lv = Math.max(0, Math.min(1, typeof override === 'number' ? override : getLevel()));

      if (lv > WAVE_ACTIVE_MIN) lastLoudAt = now;
      // hangover — 조용해져도 곧바로 글리프로 돌아가지 않는다(어절 사이 깜빡임 방지).
      const speaking = lastLoudAt > 0 && now - lastLoudAt < HANGOVER_MS;

      if (!speaking) {
        if (listening) {
          // §C5-①(F19) — listening 무음은 mic 글리프가 아니라 idle 웨이브다. idle은 매 프레임
          // 위상이 흐르므로 cache 경계는 모드 진입 프레임만 강제한다(이후는 diff 쓰기).
          const enteringIdle = paintedMode !== 'idle';
          paint(idleLit(now), enteringIdle);
          paintedMode = 'idle';
          rootRef.current?.setAttribute('data-mode', 'idle');
        } else {
          // 파형→글리프 전환은 cache 경계다. 첫 글리프 프레임은 전량 써서 DOM을 재동기화한다.
          const enteringGlyph = paintedMode !== 'glyph';
          paint(glyphLit(), enteringGlyph);
          paintedMode = 'glyph';
          rootRef.current?.setAttribute('data-mode', 'glyph');
        }
        schedule();
        return;
      }

      const amps = new Array<number>(FIELD_COLS);
      if (ok) {
        // 시간영역 샘플(0~255, 128=무음). 열마다 자기 구간의 피크 편차(원거리 판독용 증폭).
        const stride = Math.floor(FFT / FIELD_COLS);
        for (let c = 0; c < FIELD_COLS; c++) {
          let peak = 0;
          const start = c * stride;
          for (let k = 0; k < stride; k++) {
            const d = Math.abs(buf[start + k] - 128) / 128;
            if (d > peak) peak = d;
          }
          // §C5 — 표시 영역 10행(USABLE_ROWS)의 진폭 상한은 4(= 전 행). 종전 3은 7행 기준이었다.
          // WP-G에서 격자가 14행이 됐지만 **이 값은 안 바뀐다** — 늘리면 하단 예약 행을 침범한다.
          amps[c] = Math.min(4, Math.max(0, Math.round(peak * 2.4 * 4)));
        }
      } else {
        // 폴백: 레벨 스칼라로 합성한 흐름(analyser 미가용 기기). 양끝은 envelope로 수렴.
        const t = now / 150;
        for (let c = 0; c < FIELD_COLS; c++) {
          const env = Math.sin((c / (FIELD_COLS - 1)) * Math.PI);
          const wave = 0.5 + 0.5 * Math.sin(c * 0.7 + t);
          amps[c] = Math.min(4, Math.max(0, Math.round(lv * env * wave * 4 + 0.5)));
        }
      }
      // 글리프→파형 진입도 첫 프레임은 전량 쓴다. 이후 프레임부터 실제로 달라진 셀만 쓴다.
      const enteringWave = paintedMode !== 'wave';
      paint(litFromAmps(amps), enteringWave);
      paintedMode = 'wave';
      rootRef.current?.setAttribute('data-mode', 'wave');
      schedule();
    };

    // display:none(keep-alive)·스크롤 이탈 → rAF 정지. 다시 보이면 재개(배터리·발열 계약).
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          const next = entries[entries.length - 1]?.isIntersecting ?? true;
          if (next === visible) return;
          visible = next;
          if (visible) schedule();
          else if (raf) { cancelAnimationFrame(raf); raf = 0; }
        })
      : null;
    if (rootRef.current) io?.observe(rootRef.current);

    const onVis = () => { if (document.visibilityState === 'visible') schedule(); };
    document.addEventListener('visibilitychange', onVis);
    schedule();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [glyph, active, getLevel, getTimeDomainData]);

  return (
    <div
      ref={rootRef}
      data-testid="state-dots"
      data-glyph={glyph}
      data-mode="glyph"
      role="img"
      aria-hidden
      style={{
        display: 'grid',
        // StateIndicator의 명목 높이가 부모 하단 트랙보다 클 수 있다(완료/검토 상태의 짧은 화면).
        // 고정 px 트랙을 그대로 두면 부모만 줄고 14행 격자는 남아 밴드 밖 버튼 영역을 침범한다.
        // 실제 부모 높이를 상한으로 삼아 전 행을 함께 축소한다 — overflow clip이나 transform이
        // 아니라 레이아웃 박스 자체가 밴드 안에 들어가는 계약이다.
        height: `min(${gridHeight}px, 100%)`,
        // A안: 열 피치만 화면 2/3로 넓힌다(WP-G에서 격자는 25열·350셀이 됐다).
        // 도트 지름은 위의 세로 cell에서 산출하므로 가로로 늘어난 타원이 되지 않는다.
        width: 'min(66.6667vw, 100%)',
        maxWidth: '100%',
        gridTemplateColumns: `repeat(${FIELD_COLS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${FIELD_ROWS}, minmax(0, 1fr))`,
        justifyItems: 'center',
        alignItems: 'center',
        color,
      }}
    >
      {Array.from({ length: FIELD_COLS * FIELD_ROWS }, (_, i) => {
        const r = Math.floor(i / FIELD_COLS);
        const c = i % FIELD_COLS;
        // 🔴 하단 예약 행은 비트맵에 존재하지 않는다(GLYPHS는 USABLE_ROWS행) — 인덱싱 전에 막는다.
        const on = r < USABLE_ROWS && GLYPHS[glyph][r][c] === '#';
        return (
          <span
            key={i}
            ref={(el) => { cellsRef.current[i] = el; }}
            data-cell={`${r},${c}`}
            // §C4 — mono 점멸 CSS가 켜진 셀만 잡는 앵커. 꺼진 셀에 애니메이션을 붙이면
            // keyframe opacity가 인라인 0을 이겨 유령 도트가 된다([UI-DOT-GHOST-1]).
            // 파형 모드의 셀 on/off는 명령형 경로가 갈아끼우지만 mono는 glyph(정지) 상태
            // 전용이라 렌더 시점의 이 값이 정확하다.
            data-on={on ? 'true' : 'false'}
            style={{
              gridColumn: c + 1,
              gridRow: r + 1,
              width: `min(${dot}px, 72%)`,
              maxHeight: '72%',
              aspectRatio: '1 / 1',
              borderRadius: '50%',
              background: 'currentColor',
              boxShadow: `0 0 ${Math.round(dot * 0.9)}px currentColor`,
              // 초기 상태는 글리프 — 첫 페인트에 빈 격자가 보이지 않게 한다.
              opacity: on ? 1 : 0,
              // 중심에서 멀수록 늦게 부푼다. 꺼진 셀은 keyframe opacity가 인라인 0을 이기지 못하게
              // animation을 아예 두지 않는다([UI-DOT-GHOST-1]).
              animation: on ? dotBreatheAnimation(glyph, i) : 'none',
              willChange: 'transform, opacity',
            }}
          />
        );
      })}
    </div>
  );
}
