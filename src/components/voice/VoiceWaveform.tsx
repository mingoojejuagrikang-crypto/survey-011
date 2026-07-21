import { useEffect, useRef } from 'react';
import { T } from '../../tokens';

/** v0.37.0 FB-D(민구, Vance) — 코덱스 reference-ui의 **막대 파형**(`.waveform span`). 종전 canvas
 *  선 파형을 굵은 세로 막대 N개로 교체한다(원거리 2~3m 판독성↑, 시안 일치). 각 막대의 `scaleY`를
 *  rAF로 실시간 갱신한다(React 리렌더 0 — ref 배열 직접 스타일 변이).
 *
 *  ⚠️ 존재 이유 = "지금 내 말을 듣고 있나?"를 원거리에서 확인. 따라서 **듣고 있지 않으면 움직이지
 *  않는다**(R3-FIX-3 데이터 무결성 계약, PRINCIPLES §2). reference-ui의 순수 CSS 타이머 애니메이션
 *  (`inset-wave` infinite — 레벨 0에서도 흔들림)은 **채택하지 않는다**: 죽은 마이크에 움직이는 파형은
 *  기능의 목적을 배신한다. 막대 높이는 오직 실제 오디오(getTimeDomainData) 또는 레벨(getLevel)에서만
 *  파생하고, 레벨이 임계 미만이면 정지(평막대)한다.
 *
 *  성능·배터리(종전 canvas와 동일 계약 보존):
 *   - `active=false`(듣는 중 아님/일시정지) → rAF 미가동, 평막대.
 *   - `prefers-reduced-motion` → rAF 미가동, 평막대.
 *   - `visibilityState==='hidden'` → 스케줄 중단, visibilitychange에서 재개.
 *   - display:none(keep-alive) / 스크롤 이탈 → IntersectionObserver가 즉시 백오프(rAF 정지).
 *   - ~30fps 게이트 — 장시간 현장 세션 배터리/열 부담을 낮춘다. cleanup에서 cancel. */
const FFT = 1024;
const FRAME_MS = 33;

/** 막대 개수 — reference-ui는 13개(폭 10px). 밴드 폭이 넓으므로 24개로 촘촘히 채운다. */
const NBARS = 24;

/** 평막대(정지) scaleY — 죽은 마이크·일시정지·reduced에서 얇은 평선처럼 보이는 최소 높이. */
const FLAT = 0.08;

/** v0.35.0 R3-FIX-3 계승 — 합성 폴백이 움직이기 시작하는 레벨 하한(정확히 0=죽은 마이크는 정지).
 *  근거: recorder 레벨은 `RMS/LEVEL_REF_RMS`(0.1) 지수평활, 프리롤 미가용·teardown 시 **정확히 0**.
 *  대화 발화는 0.2~1.0 → 0.02는 죽은 마이크보다는 확실히 위, 조용한 실제 발화보다는 한참 아래. */
const WAVE_ACTIVE_MIN = 0.02;

export function VoiceWaveform({
  getTimeDomainData,
  getLevel,
  active,
  height = 68,
  color = T.green,
}: {
  getTimeDomainData: (out: Uint8Array) => boolean;
  getLevel: () => number;
  active: boolean;
  height?: number;
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

    /** 모든 막대에 scaleY 배열을 적용(레이아웃 조회 없음 — transform 전용, 합성기). */
    const paint = (heights: number[]) => {
      for (let i = 0; i < bars.length; i++) {
        const el = bars[i];
        if (el) el.style.transform = `scaleY(${heights[i] ?? FLAT})`;
      }
    };

    /** 평막대(정지) — 안 듣는 중(비활성·reduced·레벨 0/마이크 사망)의 시각 표현. */
    const drawStatic = () => paint(new Array(NBARS).fill(FLAT));

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

      const heights = new Array<number>(NBARS);
      if (ok) {
        // 시간영역 샘플(0~255, 128=무음). 막대 b는 자기 구간의 피크 편차(원거리 판독용 2.4× 증폭).
        const stride = Math.floor(FFT / NBARS);
        for (let b = 0; b < NBARS; b++) {
          let peak = 0;
          const start = b * stride;
          for (let k = 0; k < stride; k++) {
            const d = Math.abs(buf[start + k] - 128) / 128;
            if (d > peak) peak = d;
          }
          heights[b] = Math.max(FLAT, Math.min(1, peak * 2.4));
        }
      } else {
        // 폴백: 레벨 스칼라로 합성한 흐름(analyser 미가용 기기). 진폭은 레벨에 **비례**(레벨 0 정지 —
        //   위 게이트가 이미 거른다). 시간 위상으로 막대가 흐르되, 양끝은 envelope로 수렴(밴드 정착).
        const t = performance.now() / 150;
        for (let b = 0; b < NBARS; b++) {
          const env = Math.sin((b / (NBARS - 1)) * Math.PI); // 양끝 0
          const wave = 0.5 + 0.5 * Math.sin(b * 0.7 + t);
          heights[b] = Math.max(FLAT, Math.min(1, FLAT + (1 - FLAT) * lv * env * wave));
        }
      }
      paint(heights);
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
  }, [active, getTimeDomainData, getLevel, height, color]);

  return (
    <div
      ref={rootRef}
      data-testid="voice-waveform"
      role="img"
      aria-hidden
      style={{
        width: '100%',
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}
    >
      {Array.from({ length: NBARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => { barsRef.current[i] = el; }}
          style={{
            flex: '1 1 0',
            minWidth: 3,
            maxWidth: 11,
            height: '100%',
            borderRadius: 999,
            background: color,
            boxShadow: `0 0 10px ${color}`,
            transform: `scaleY(${FLAT})`,
            transformOrigin: 'center',
            // rAF가 transform을 매 프레임 덮으므로 transition은 두지 않는다(정지 상태 잔여 애니메이션
            //   방지 — 평막대는 즉시 평막대). willChange로 합성 레이어 승격.
            willChange: 'transform',
          }}
        />
      ))}
    </div>
  );
}
