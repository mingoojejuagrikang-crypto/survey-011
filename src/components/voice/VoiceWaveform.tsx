import { useEffect, useRef } from 'react';
import { T } from '../../tokens';

/** v0.35.0 (Vance) — 중앙 카드에 통합된 실시간 음성 파형(민구 요청: "듣는 중" 텍스트를 없애고
 *  항목명 + 파형으로). 실제 사람 음성 파형은 **시간영역 샘플**이 필요하므로 recorder의 AnalyserNode
 *  탭(getTimeDomainData, fftSize=1024)을 canvas에 rAF로 그린다. 원거리 판독성(폰 2~3m)이 핵심이라
 *  굵은 선 + 초록 글로우로 크게 그린다.
 *
 *  ⚠️ 이 파형의 존재 이유 = "지금 내 말을 듣고 있나?"를 2~3m 밖에서 확인하는 것. 따라서 **듣고 있지
 *  않을 때 움직여선 안 된다** — 죽은 마이크에 움직이는 파형은 기능의 목적을 배신한다(R3-FIX-3).
 *
 *  성능·배터리(useAudioLevelVar와 동일 계약):
 *   - `active=false`(듣는 중 아님) → rAF 미가동, 정적 표시.
 *   - `prefers-reduced-motion` → rAF 미가동, 정적 라인.
 *   - `visibilityState==='hidden'` → 스케줄 중단, visibilitychange에서 재개.
 *   - keep-alive display:none(세션 중 탭 이탈, App.tsx [STT-16]) → IntersectionObserver가 감지해
 *     즉시 백오프(rAF 정지), 다시 보이면 재개.
 *   - 렌더 상한 ~30fps + 파형 다운샘플 — 장시간 현장 세션의 배터리/열 부담을 낮춘다.
 *   - cleanup에서 cancel.
 *
 *  폴백: analyser 미가용(preroll 미지원 기기)이면 getTimeDomainData가 false → 레벨 스칼라(getLevel)로
 *  합성한 파형. 단 레벨이 임계 미만이면 **정적 선**(아래 WAVE_ACTIVE_MIN). React state 미사용 — 리렌더 0. */
const FFT = 1024;

/** v0.35.0 R3-FIX-4(리뷰 라운드3, Codex Medium·perf) — 렌더 상한(~30fps). 파형은 "듣고 있다"는
 *  신호이지 애니메이션 품질이 목적이 아니라 30fps로 충분하다(60fps 대비 draw 비용 절반). */
const FRAME_MS = 33;

/** v0.35.0 R3-FIX-4 — analyser 경로 다운샘플 목표 점수. 1,024개 선분을 폭 ~480px 카드에 그리면
 *  픽셀당 2개 이상이라 시각적 이득 없이 비용만 든다. 128점이면 육안상 동일하면서 선분 8× 감소.
 *  (스트라이드 샘플링 — 원 신호의 피크를 놓칠 수 있으나 이 파형은 계측이 아니라 생존 신호다.) */
const WAVE_POINTS = 128;

/** v0.35.0 R3-FIX-3(리뷰 라운드3, Codex Medium) — 합성 폴백이 움직이기 시작하는 레벨 하한.
 *  종전엔 진폭이 `0.12 + lv*0.88`이라 **레벨 0에서도 12% 진폭으로 계속 흔들렸다** → 마이크/프리롤
 *  초기화가 실패해 아무것도 안 듣고 있는데도 사용자는 "듣고 있다"고 오해했다(2~3m 원거리에선 이
 *  파형이 유일한 판단 근거라 치명적).
 *
 *  임계 선정 근거: recorder의 레벨은 `RMS/LEVEL_REF_RMS`(=0.1)를 지수평활한 값이고, 프리롤 미가용·
 *  teardown 시 **정확히 0**으로 고정된다(audioRecorder `inputLevel`). 대화 발화 RMS는 0.02~0.15 →
 *  레벨 0.2~1.0. 즉 0.02는 죽은 마이크(정확히 0)보다는 확실히 위, 조용한 실제 발화(≥0.2)보다는
 *  한참 아래라 **원거리 작은 목소리를 정적으로 오판하지 않으면서** 죽은 마이크만 정지시킨다.
 *  (환경 소음으로 레벨이 이 위에 머물면 파형은 움직인다 — 그건 정직한 표시다: 마이크가 살아 있고
 *  실제로 무언가를 듣고 있다는 뜻.) */
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const buf = new Uint8Array(FFT);
    let raf = 0;
    let disposed = false;
    let lastFrameAt = 0;
    // v0.35.0 R3-FIX-4 — 크기 캐시. 종전엔 **매 프레임** clientWidth를 읽어 레이아웃 조회(reflow)를
    //   강제했다. ResizeObserver가 바뀔 때만 갱신하고, 렌더 루프는 캐시만 읽는다.
    let cssW = 0;
    // v0.35.0 R3-FIX-4 — 가시성 캐시. 종전엔 매 프레임 offsetParent를 읽었다(역시 레이아웃 조회).
    //   IntersectionObserver가 display:none(박스 없음 → 교차 0)·스크롤 이탈을 모두 콜백으로 알려주므로
    //   폴링이 필요 없다. 라운드2 취지(숨겨지면 즉시 백오프)는 그대로 — 수단만 저비용으로 교체.
    let visible = true;

    const applySize = () => {
      const nextW = Math.max(1, Math.round(cssW * dpr));
      const nextH = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== nextW) canvas.width = nextW;
      if (canvas.height !== nextH) canvas.height = nextH;
    };

    /** 정적 선 — 안 듣는 중(비활성·reduced-motion·레벨 0/마이크 사망). "듣고 있지 않다"의 시각 표현. */
    const drawStatic = () => {
      applySize();
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.shadowBlur = 0; // 정적 선엔 글로우 없음(살아있는 파형과 구분).
      ctx.lineWidth = Math.max(2, 3 * dpr);
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    const measure = () => {
      cssW = canvas.clientWidth || canvas.parentElement?.clientWidth || 300;
    };
    measure();

    const onResize = () => {
      measure();
      if (!active || reduced || !visible) drawStatic(); // 정적 상태에서도 리사이즈는 반영.
    };
    // useFitScale과 같은 feature-detect 계약. 구형 WebKit은 window resize로 보수적으로 갱신한다.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(canvas);
    if (!ro) window.addEventListener('resize', onResize);

    if (reduced || !active) {
      drawStatic();
      return () => {
        ro?.disconnect();
        if (!ro) window.removeEventListener('resize', onResize);
      };
    }

    const schedule = () => {
      if (disposed || !visible || document.visibilityState === 'hidden') return; // onVis/IO가 재개
      if (raf === 0) raf = requestAnimationFrame(render);
    };

    const render = (now: number) => {
      raf = 0;
      // ~30fps 게이트: 프레임 예산 미달이면 그리지 않고 다음 rAF만 예약(draw 비용 절반).
      if (now - lastFrameAt < FRAME_MS) { schedule(); return; }
      lastFrameAt = now;
      applySize();
      const w = canvas.width;
      const h = canvas.height;
      const mid = h / 2;

      const ok = getTimeDomainData(buf);
      // 테스트 심(useAudioLevelVar와 동일): __voiceLevelOverride가 있으면 그 값으로 진폭 검증.
      const override = (window as unknown as { __voiceLevelOverride?: number }).__voiceLevelOverride;
      const lv = Math.max(0, Math.min(1, typeof override === 'number' ? override : getLevel()));

      // R3-FIX-3 — analyser 미가용 + 레벨이 임계 미만이면 **정지**. 합성 움직임은 실제로 듣고 있을
      //   때만. (analyser 경로는 무음이면 샘플이 128로 평평해 이미 정직하게 정적이다.)
      if (!ok && lv < WAVE_ACTIVE_MIN) {
        drawStatic();
        schedule();
        return;
      }

      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = Math.max(2.5, 3.5 * dpr);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 9 * dpr; // 원거리 판독용 글로우
      ctx.beginPath();

      if (ok) {
        // 시간영역 샘플(0~255, 128=무음). 작은 발화도 원거리에서 보이게 2.6× 증폭 후 클램프.
        // R3-FIX-4 — 1024 전부가 아니라 WAVE_POINTS개로 스트라이드 다운샘플.
        const amp = h * 0.44;
        const stride = Math.max(1, Math.floor(FFT / WAVE_POINTS));
        const pts = Math.floor((FFT - 1) / stride) + 1;
        const step = w / (pts - 1);
        for (let p = 0; p < pts; p++) {
          const v = Math.max(-1, Math.min(1, ((buf[p * stride] - 128) / 128) * 2.6));
          const y = mid - v * amp;
          if (p === 0) ctx.moveTo(0, y);
          else ctx.lineTo(p * step, y);
        }
      } else {
        // 폴백: 레벨 스칼라로 합성한 흐름(analyser 미가용 기기). 진폭은 레벨에 **비례**한다 —
        //   종전의 0.12 하한(레벨 0에서도 흔들림)을 제거했다(R3-FIX-3).
        const amp = h * 0.4 * lv;
        const tphase = performance.now() / 260;
        const segs = 72;
        const step = w / segs;
        for (let i = 0; i <= segs; i++) {
          const env = Math.sin((i / segs) * Math.PI); // 양끝 0으로 수렴(카드 안 정착)
          const y = mid - Math.sin(i * 0.5 + tphase) * amp * env;
          if (i === 0) ctx.moveTo(0, y);
          else ctx.lineTo(i * step, y);
        }
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      schedule();
    };

    // display:none(keep-alive)·스크롤 이탈 → isIntersecting=false → rAF 정지. 다시 보이면 재개.
    // IntersectionObserver 미지원 브라우저는 document visibility만으로 백오프한다. hidden 탭에서는
    // rAF를 중단하고, visible 복귀 시 재개한다. keep-alive display:none은 브라우저 rAF 자체 throttling에
    // 맡기는 보수적 폴백이며 레이아웃을 프레임마다 조회하지 않는다(R3-FIX-4 취지 보존).
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          const next = entries[entries.length - 1]?.isIntersecting ?? true;
          if (next === visible) return;
          visible = next;
          if (visible) schedule();
          else if (raf) { cancelAnimationFrame(raf); raf = 0; }
        })
      : null;
    io?.observe(canvas);

    const onVis = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    document.addEventListener('visibilitychange', onVis);
    schedule();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
      ro?.disconnect();
      if (!ro) window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [active, getTimeDomainData, getLevel, height, color]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="voice-waveform"
      aria-hidden
      style={{ width: '100%', height, display: 'block' }}
    />
  );
}
