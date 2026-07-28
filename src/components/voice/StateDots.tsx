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

/** 격자 치수 — 열 13은 종전 파형 막대 수(`BAR_COUNT`)를 승계한다. 행 7은 마이크 글리프 높이. */
export const FIELD_COLS = 13;
export const FIELD_ROWS = 7;

/** 좁은 비트맵을 13열 한가운데로 옮긴다(글리프마다 열 수가 달라도 격자는 고정). */
function center(rows: readonly string[]): string[] {
  return rows.map((r) => {
    const pad = FIELD_COLS - r.length;
    const left = Math.floor(pad / 2);
    return '.'.repeat(left) + r + '.'.repeat(pad - left);
  });
}

/** 상태 글리프 비트맵(`#`=켜짐). 전부 7행으로 맞춰 상태가 바뀌어도 격자 기하가 불변이다. */
const GLYPHS: Record<DotGlyph, string[]> = {
  // 마이크: 캡슐 + 수음 아크 + 스탠드/받침.
  mic: center(['.###.', '.###.', '.###.', '#...#', '.###.', '..#..', '.###.']),
  // 경고: **굵은 느낌표**(민구 확정 2026-07-27, 후보 1번 — fb-27-4 종결).
  //   종전 삼각형+느낌표는 외곽이 도트를 나눠 써서 획이 얇았다. 외곽을 버리고 획에 도트를
  //   몰아주면 같은 밴드 높이에서 획이 가장 굵어져 야외·원거리에서 가장 크게 읽힌다.
  alert: center(['###', '###', '###', '###', '###', '...', '###']),
  // 일시정지: 2칸 폭 막대 두 개.
  pause: center(['##.##', '##.##', '##.##', '##.##', '##.##', '##.##', '##.##']),
  // 완료: 체크(짧은 하강 + 긴 상승).
  check: center(['......#', '.....#.', '#...#..', '.#.#...', '..#....', '.......', '.......']),
};

/** 호흡 주기 — EdgeGlow/voice-status-fade와 같은 상태별 cadence(경고는 빠르게, 일시정지는 느리게). */
const BREATHE_S: Record<DotGlyph, number> = { mic: 1.75, alert: 0.7, pause: 2.4, check: 2 };

function dotBreatheAnimation(glyph: DotGlyph, index: number): string {
  const r = Math.floor(index / FIELD_COLS);
  const c = index % FIELD_COLS;
  const delay = (Math.hypot(c - (FIELD_COLS - 1) / 2, r - (FIELD_ROWS - 1) / 2)
    / Math.hypot((FIELD_COLS + 1) / 2, (FIELD_ROWS + 1) / 2)) * 0.45;
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
  /** 격자 높이(px). 셀은 이 높이에서 역산되고, 폭은 정사각 셀 × 13열이다. */
  size: number;
  /** 오디오 반응 여부(일시정지/완료는 false → 정적 글리프). */
  active?: boolean;
  getLevel?: () => number;
  getTimeDomainData?: (out: Uint8Array) => boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cellsRef = useRef<Array<HTMLSpanElement | null>>([]);
  // 셀은 정사각. 세로 기준으로 잡아 밴드 높이를 넘지 않게 한다(가로는 항상 더 여유롭다).
  const cell = Math.max(3, Math.floor(size / FIELD_ROWS));
  const dot = Math.max(2, Math.round(cell * 0.72));

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
        // C5 — 무음에서도 같은 91개 값을 ~30fps로 재기록하지 않는다. cache가 없거나
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

    const glyphLit = (): boolean[] => {
      const rows = GLYPHS[glyph];
      const out = new Array<boolean>(FIELD_COLS * FIELD_ROWS).fill(false);
      for (let r = 0; r < FIELD_ROWS; r++) {
        for (let c = 0; c < FIELD_COLS; c++) out[r * FIELD_COLS + c] = rows[r][c] === '#';
      }
      return out;
    };

    // 마운트 직후·glyph/active 변경으로 effect가 재생성된 직후는 cache를 신뢰하지 않는다.
    paint(glyphLit(), true);
    if (reduced || !active || !getLevel) return;

    const buf = new Uint8Array(FFT);
    let raf = 0;
    let disposed = false;
    let lastFrameAt = 0;
    let visible = true;
    let lastLoudAt = 0;
    let paintedMode: 'glyph' | 'wave' = 'glyph';

    /** 열별 진폭(0~3) → 중앙 행에서 위아래로 대칭으로 켠다(막대 scaleY와 같은 읽기). */
    const waveLit = (amps: number[]): boolean[] => {
      const out = new Array<boolean>(FIELD_COLS * FIELD_ROWS).fill(false);
      const mid = (FIELD_ROWS - 1) / 2;
      for (let c = 0; c < FIELD_COLS; c++) {
        for (let r = 0; r < FIELD_ROWS; r++) {
          if (Math.abs(r - mid) <= amps[c]) out[r * FIELD_COLS + c] = true;
        }
      }
      return out;
    };

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
        // 파형→글리프 전환은 cache 경계다. 첫 글리프 프레임은 전량 써서 DOM을 재동기화한다.
        const enteringGlyph = paintedMode !== 'glyph';
        paint(glyphLit(), enteringGlyph);
        paintedMode = 'glyph';
        rootRef.current?.setAttribute('data-mode', 'glyph');
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
          amps[c] = Math.min(3, Math.max(0, Math.round(peak * 2.4 * 3)));
        }
      } else {
        // 폴백: 레벨 스칼라로 합성한 흐름(analyser 미가용 기기). 양끝은 envelope로 수렴.
        const t = now / 150;
        for (let c = 0; c < FIELD_COLS; c++) {
          const env = Math.sin((c / (FIELD_COLS - 1)) * Math.PI);
          const wave = 0.5 + 0.5 * Math.sin(c * 0.7 + t);
          amps[c] = Math.min(3, Math.max(0, Math.round(lv * env * wave * 3 + 0.5)));
        }
      }
      // 글리프→파형 진입도 첫 프레임은 전량 쓴다. 이후 프레임부터 실제로 달라진 셀만 쓴다.
      const enteringWave = paintedMode !== 'wave';
      paint(waveLit(amps), enteringWave);
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
        gridTemplateColumns: `repeat(${FIELD_COLS}, ${cell}px)`,
        gridTemplateRows: `repeat(${FIELD_ROWS}, ${cell}px)`,
        justifyItems: 'center',
        alignItems: 'center',
        color,
      }}
    >
      {Array.from({ length: FIELD_COLS * FIELD_ROWS }, (_, i) => {
        const r = Math.floor(i / FIELD_COLS);
        const c = i % FIELD_COLS;
        const on = GLYPHS[glyph][r][c] === '#';
        return (
          <span
            key={i}
            ref={(el) => { cellsRef.current[i] = el; }}
            data-cell={`${r},${c}`}
            style={{
              gridColumn: c + 1,
              gridRow: r + 1,
              width: dot,
              height: dot,
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
