import { useEffect, useRef, type CSSProperties } from 'react';
import { T } from '../../tokens';

/** v0.38.0 개선요청 #10 — reference-ui의 **막대 파형**(`.waveform span`). 10×78px 막대 13개를
 *  7px 간격으로 배치하고, 각 막대의 `--level`/`scaleY`를 rAF로 실시간 갱신한다
 *  (React 리렌더 0 — ref 배열 직접 스타일 변이).
 *
 *  ⚠️ 존재 이유 = "지금 내 말을 듣고 있나?"를 원거리에서 확인. 따라서 **듣고 있지 않으면 움직이지
 *  않는다**(R3-FIX-3 데이터 무결성 계약, PRINCIPLES §2). reference-ui의 순수 CSS 타이머 애니메이션
 *  (`inset-wave`)은 실제 오디오가 감지될 때만 켠다: 죽은 마이크에 움직이는 파형은 기능의 목적을
 *  배신한다. 무입력·저레벨에서도 세로 막대로 읽히도록 기본 높이 35%는 유지한다.
 *
 *  성능·배터리(종전 canvas와 동일 계약 보존):
 *   - `active=false`(일시정지) → rAF/애니메이션 미가동, 7% 납작 막대 + 그림자 제거.
 *   - `prefers-reduced-motion` → rAF/애니메이션 미가동, 기본 높이 세로 막대.
 *   - `visibilityState==='hidden'` → 스케줄 중단, visibilitychange에서 재개.
 *   - display:none(keep-alive) / 스크롤 이탈 → IntersectionObserver가 즉시 백오프(rAF 정지).
 *   - ~30fps 게이트 — 장시간 현장 세션 배터리/열 부담을 낮춘다. cleanup에서 cancel. */
const FFT = 1024;
const FRAME_MS = 33;

/** reference-ui 파형 치수. */
const BAR_COUNT = 13;
const BAR_HEIGHT = 78;

/** 듣는 중 무입력 기본 높이와 일시정지 높이는 서로 다른 상태 표현이다. */
const BASE_LEVEL = 0.35;
const PAUSED_LEVEL = 0.07;

/** v0.35.0 R3-FIX-3 계승 — 합성 폴백이 움직이기 시작하는 레벨 하한(정확히 0=죽은 마이크는 정지).
 *  근거: recorder 레벨은 `RMS/LEVEL_REF_RMS`(0.1) 지수평활, 프리롤 미가용·teardown 시 **정확히 0**.
 *  대화 발화는 0.2~1.0 → 0.02는 죽은 마이크보다는 확실히 위, 조용한 실제 발화보다는 한참 아래. */
const WAVE_ACTIVE_MIN = 0.02;

export function VoiceWaveform({
  getTimeDomainData,
  getLevel,
  active,
  height,
  color = T.green,
}: {
  getTimeDomainData: (out: Uint8Array) => boolean;
  getLevel: () => number;
  active: boolean;
  height: number;
  color?: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const barsRef = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    const bars = barsRef.current;
    if (!bars.length) return;

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const buf = new Uint8Array(FFT);
    let raf = 0;
    let disposed = false;
    let lastFrameAt = 0;
    let visible = true;

    /** 모든 막대에 레벨을 적용(레이아웃 조회 없음 — transform 전용, 합성기). */
    const paint = (levels: number[], moving: boolean) => {
      const root = rootRef.current;
      if (root && root.dataset.waveMotion !== (moving ? 'active' : 'idle')) {
        root.dataset.waveMotion = moving ? 'active' : 'idle';
      }
      for (let i = 0; i < bars.length; i++) {
        const el = bars[i];
        if (!el) continue;
        const level = levels[i] ?? BASE_LEVEL;
        el.style.setProperty('--level', String(level));
        el.style.transform = `scaleY(${level})`;
      }
    };

    /** 정적 막대 — 일시정지는 7%, 무입력·reduced-motion은 세로 기본 높이 35%. */
    const drawStatic = () => {
      const level = active ? BASE_LEVEL : PAUSED_LEVEL;
      paint(new Array(BAR_COUNT).fill(level), false);
    };

    if (reduced || !active) {
      drawStatic();
      return () => { disposed = true; };
    }

    const schedule = () => {
      if (disposed || !visible || document.visibilityState === 'hidden') return; // onVis/IO가 재개
      if (raf === 0) raf = requestAnimationFrame(render);
    };

    const render = (now: number) => {
      raf = 0;
      if (now - lastFrameAt < FRAME_MS) { schedule(); return; } // ~30fps 게이트
      lastFrameAt = now;

      const ok = getTimeDomainData(buf);
      // 테스트 심(canvas 시절과 동일): __voiceLevelOverride가 있으면 그 값으로 진폭 검증.
      const override = (window as unknown as { __voiceLevelOverride?: number }).__voiceLevelOverride;
      const lv = Math.max(0, Math.min(1, typeof override === 'number' ? override : getLevel()));

      // R3-FIX-3 계승 — analyser 미가용 + 레벨 임계 미만이면 **정지**(평막대). 합성 움직임은 실제로
      //   듣고 있을 때만. (analyser 경로는 무음이면 샘플이 128 근처로 평평해 자연히 낮은 막대다.)
      if (!ok && lv < WAVE_ACTIVE_MIN) {
        drawStatic();
        schedule();
        return;
      }

      const levels = new Array<number>(BAR_COUNT);
      if (ok) {
        // 시간영역 샘플(0~255, 128=무음). 막대 b는 자기 구간의 피크 편차(원거리 판독용 2.4× 증폭).
        const stride = Math.floor(FFT / BAR_COUNT);
        for (let b = 0; b < BAR_COUNT; b++) {
          let peak = 0;
          const start = b * stride;
          for (let k = 0; k < stride; k++) {
            const d = Math.abs(buf[start + k] - 128) / 128;
            if (d > peak) peak = d;
          }
          levels[b] = Math.max(BASE_LEVEL, Math.min(1, peak * 2.4));
        }
      } else {
        // 폴백: 레벨 스칼라로 합성한 흐름(analyser 미가용 기기). 진폭은 레벨에 **비례**(레벨 0 정지 —
        //   위 게이트가 이미 거른다). 시간 위상으로 막대가 흐르되, 양끝은 envelope로 수렴(밴드 정착).
        const t = performance.now() / 150;
        for (let b = 0; b < BAR_COUNT; b++) {
          const env = Math.sin((b / (BAR_COUNT - 1)) * Math.PI); // 양끝 0
          const wave = 0.5 + 0.5 * Math.sin(b * 0.7 + t);
          levels[b] = Math.max(
            BASE_LEVEL,
            Math.min(1, BASE_LEVEL + (1 - BASE_LEVEL) * lv * env * wave),
          );
        }
      }
      paint(levels, levels.some((level) => level > BASE_LEVEL));
      schedule();
    };

    // display:none(keep-alive)·스크롤 이탈 → isIntersecting=false → rAF 정지. 다시 보이면 재개.
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
  }, [active, getTimeDomainData, getLevel]);

  return (
    <div
      ref={rootRef}
      data-testid="voice-waveform"
      role="img"
      aria-hidden
      data-wave-motion="idle"
      className="voice-waveform"
      style={{
        width: '100%',
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        color,
      }}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          className="voice-waveform__bar"
          ref={(el) => { barsRef.current[i] = el; }}
          style={{
            '--level': active ? BASE_LEVEL : PAUSED_LEVEL,
            '--delay': `${i * -73}ms`,
            flex: '0 0 10px',
            width: 10,
            height: BAR_HEIGHT,
            borderRadius: 999,
            background: 'currentColor',
            boxShadow: active ? '0 0 11px currentColor' : 'none',
            transform: `scaleY(${active ? BASE_LEVEL : PAUSED_LEVEL})`,
            transformOrigin: 'center',
            // rAF가 transform을 매 프레임 덮으므로 transition은 두지 않는다(정지 상태 잔여 애니메이션
            //   방지 — 평막대는 즉시 평막대). willChange로 합성 레이어 승격.
            willChange: 'transform',
          } as CSSProperties}
        />
      ))}
    </div>
  );
}
