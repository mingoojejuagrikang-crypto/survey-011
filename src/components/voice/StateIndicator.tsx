import { useEffect, useRef, useState, type RefObject } from 'react';
import { T } from '../../tokens';
import { StateDots, type DotGlyph } from './StateDots';
import type { GlowTone } from './EdgeGlow';
import { VOICE_TYPE } from './heroLayout';

/** 와이어프레임 §공통규칙5 — 하단 `<` `>` **가운데**에 놓이는 상태 인디케이터.
 *
 *  v0.40.0 — **도트 격자 하나**가 상태 글리프와 음성 파형을 둘 다 그린다(`StateDots`).
 *  종전의 "도트 레이어 + 파형 레이어 opacity 교차"는 사라졌다.
 *
 *  🔴 그래서 [UI-WAVE-1](도트·파형 동시 렌더)이 **구조적으로 소멸**했다 — 겹칠 두 번째 레이어가
 *  존재하지 않는다. `--voice-level` 기반 크로스페이드 게이트도 함께 제거했다(이 파일에서 그
 *  두 개의 opacity 식이 결함의 원인이었다). 되살리지 마라.
 *
 *  🔴 **전환은 여전히 마운트 교체가 아니다.** `StateDots`는 상태와 무관하게 계속 마운트되고
 *  내부에서 켜지는 셀만 바뀐다. 조건부 렌더로 바꾸면 rAF·IntersectionObserver가 발화마다
 *  teardown/재생성돼 [STT-16] 계열 사고(62초 사공백)가 된다.
 *
 *  `LiveListenBand`(v0.36.0 상시 파형 밴드)의 후신이다. `data-testid="live-listen-band"`와
 *  밴드 높이 산식(뷰포트 비례, 상태 간 고정)은 그대로 유지한다 — 상태가 바뀌어도 인디케이터
 *  높이는 변하지 않아야 `<` `>`가 위아래로 튀지 않는다. */
const TONE_COLOR: Record<GlowTone, string> = { green: T.green, amber: T.amber, red: T.red, mono: T.mono };

export function StateIndicator({
  glyph, tone, waveActive, levelActive, getAudioLevel, getTimeDomainData, control,
}: {
  glyph: DotGlyph;
  /** 상태 톤(VoiceScreen glowTone SSOT) — 도트·파형이 엣지글로우와 같은 색으로 상태를 말한다. */
  tone: GlowTone;
  /** 파형 rAF 가동 여부(일시정지=false → 평막대 + rAF 미가동). */
  waveActive: boolean;
  /** 레벨 rAF 가동 여부 — 도트↔파형 교차의 입력. 일시정지에선 꺼서 도트만 남긴다. */
  levelActive: boolean;
  getAudioLevel: () => number;
  getTimeDomainData: (out: Uint8Array) => boolean;
  /** 있으면 인디케이터 전체가 버튼이 된다. 기본은 도트 일시정지 경로이고,
   *  visibleLabel이 있으면 고정 밴드 안에서 도트를 숨긴 채 라벨 컨트롤이 자리를 승계한다. */
  control?: {
    title: string;
    label: string;
    status: string;
    onClick: () => void;
    visibleLabel?: string;
    accent?: string;
    accentBg?: string;
  };
}) {
  const bandRef = useRef<HTMLDivElement | null>(null);
  const height = useBandHeight(bandRef);
  const color = TONE_COLOR[tone];

  // 격자 하나. 도트와 파형이 **같은 셀 집합**을 공유하므로 겹쳐 보이는 상태가 존재하지 않는다.
  const stack = (
    <div
      style={{
        width: '100%', height: '100%', maxHeight: '100%', minWidth: 0,
        display: 'grid', placeItems: 'center',
      }}
    >
      {/* 상태 전환에도 StateDots는 계속 마운트한다([STT-16]). 종료가 자리를 승계할 때만 숨긴다. */}
      <div
        aria-hidden={control?.visibleLabel ? true : undefined}
        style={{
          gridArea: '1 / 1',
          width: '100%', height: '100%',
          display: 'grid', placeItems: 'center',
          visibility: control?.visibleLabel ? 'hidden' : 'visible',
        }}
      >
        <StateDots
          glyph={glyph}
          color={color}
          size={height}
          active={waveActive && levelActive}
          getLevel={getAudioLevel}
          getTimeDomainData={getTimeDomainData}
        />
      </div>
      {control?.visibleLabel && (
        <span
          style={{
            gridArea: '1 / 1',
            color: control.accent ?? T.textDim,
            fontSize: VOICE_TYPE.statusLabel,
            fontWeight: 900,
            letterSpacing: -0.3,
            whiteSpace: 'nowrap',
          }}
        >
          {control.visibleLabel}
        </span>
      )}
    </div>
  );

  return (
    <div
      ref={bandRef}
      data-testid="live-listen-band"
      style={{
        // ui-standard §2 — 하단 1행이 밴드 높이를 정한다. 평상시 60px 가독 하한만 남기고
        // 상한은 두지 않는다. review가 더 짧은 슬롯을 배정한 경우에는 부모 containment가
        // 우선해 인접 행을 침범하지 않는다(v034/v037 계약).
        flex: '1 1 0', minWidth: 0, height: '100%', minHeight: 'min(60px, 100%)', maxHeight: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {control ? (
        <button
          type="button"
          data-testid="voice-status-control"
          data-tone={tone}
          data-status={control.status}
          onClick={control.onClick}
          title={control.title}
          aria-label={control.label}
          style={{
            width: '100%', minWidth: 0, height: '100%',
            border: control.accent ? `2px solid ${control.accent}` : 'none',
            borderRadius: control.accent ? 16 : 0,
            background: control.accentBg ?? 'transparent',
            padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', touchAction: 'manipulation',
          }}
        >
          {stack}
        </button>
      ) : (
        stack
      )}
    </div>
  );
}

/** 하단 1행이 정한 실제 높이를 도트 지름 계산에 전달한다. 밴드 높이는 부모가 정하므로
 *  이 측정값을 밴드 스타일에 되먹이지 않는다 — 측정→레이아웃 순환이 없다. */
function useBandHeight(bandRef: RefObject<HTMLDivElement | null>): number {
  const [height, setHeight] = useState(60);
  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    const measure = () => {
      const measured = Math.round(band.getBoundingClientRect().height);
      if (measured > 0) setHeight(measured);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(band);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [bandRef]);
  return height;
}
