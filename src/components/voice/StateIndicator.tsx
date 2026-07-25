import { useEffect, useState } from 'react';
import { T } from '../../tokens';
import { VoiceWaveform } from './VoiceWaveform';
import { StateDots, type DotGlyph } from './StateDots';
import { useAudioLevelVar } from './useAudioLevelVar';
import type { GlowTone } from './EdgeGlow';

/** 와이어프레임 §공통규칙5 — 하단 `<` `>` **가운데**에 놓이는 상태 인디케이터.
 *  대기(무음)에는 상태별 **도트 아이콘**이 숨쉬고, 음성이 들어오면 같은 자리가 **역동 세로파형**이
 *  된다("기존 파형이 피드백이 약했음 → 더 역동적으로").
 *
 *  🔴 전환은 **마운트 교체가 아니라 표시 전환**이다. 도트와 파형은 둘 다 항상 마운트돼 있고
 *  `--voice-level`(useAudioLevelVar의 rAF, 리렌더 0)로 opacity만 교차한다. 조건부 렌더로 바꾸면
 *  VoiceWaveform의 rAF·IntersectionObserver가 발화마다 teardown/재생성돼 [STT-16] 계열 사고와
 *  같은 방식으로 관측 파이프라인이 흔들린다.
 *
 *  `LiveListenBand`(v0.36.0 상시 파형 밴드)의 후신이다. `data-testid="live-listen-band"`와
 *  밴드 높이 산식(뷰포트 비례, 상태 간 고정)은 그대로 유지한다 — 상태가 바뀌어도 인디케이터
 *  높이는 변하지 않아야 `<` `>`가 위아래로 튀지 않는다. */
const TONE_COLOR: Record<GlowTone, string> = { green: T.green, amber: T.amber, red: T.red };

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
  /** 있으면 인디케이터 전체가 버튼이 된다(와이어프레임에 일시정지 터치 경로가 없어 여기로 통합).
   *  없으면 표시 전용(완료 상태 — 일시정지 버튼이 존재하지 않아야 한다). */
  control?: { title: string; label: string; status: string; onClick: () => void };
}) {
  const height = useBandHeight();
  const levelRef = useAudioLevelVar<HTMLDivElement>(getAudioLevel, levelActive);
  const color = TONE_COLOR[tone];

  const stack = (
    <div
      ref={levelRef}
      style={{
        width: '100%', height: '100%', maxHeight: '100%', minWidth: 0,
        display: 'grid', placeItems: 'center',
      }}
    >
      {/* 도트: 무음(level≈0)에서 100%, 발화가 시작되면 즉시 사라진다(×8 게인 = 레벨 0.125에서 0). */}
      <div
        style={{
          gridArea: '1 / 1', display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: 'max(0, calc(1 - var(--voice-level, 0) * 8))',
        }}
      >
        <StateDots glyph={glyph} color={color} size={height} />
      </div>
      {/* 파형: 반대 위상. 레이아웃에 영향을 주지 않는 opacity만 바뀐다(useFitScale 계약과 무간섭). */}
      <div
        style={{
          gridArea: '1 / 1', width: '100%', minWidth: 0,
          opacity: 'min(1, calc(var(--voice-level, 0) * 8))',
        }}
      >
        <VoiceWaveform
          active={waveActive}
          getLevel={getAudioLevel}
          getTimeDomainData={getTimeDomainData}
          height={height}
          color={color}
        />
      </div>
    </div>
  );

  return (
    <div
      data-testid="live-listen-band"
      style={{
        // 밴드 박스 높이 = 인디케이터 높이(뷰포트 파생). 하단 트랙을 꽉 채우지 않고 가운데 정렬돼,
        // "상태가 바뀌어도 밴드 높이 고정"이라는 기존 계약(v034/v035)이 그대로 유지된다.
        flex: '1 1 0', minWidth: 0, height, maxHeight: '100%',
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
            border: 'none', background: 'transparent', padding: 0,
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

/** 짧은 화면의 중앙 50%를 보존하면서, 같은 뷰포트 안에서는 모든 상태가 같은 높이를 쓴다.
 *  ⚠️ 뷰포트 파생이다(ResizeObserver 아님) — 인디케이터 높이를 실측으로 잡으면 "밴드 높이 →
 *  파형 높이 → 밴드 높이" 순환이 생긴다([useFitScale의 진동]과 같은 계열). */
function useBandHeight(): number {
  const calc = () => Math.round(Math.min(100, Math.max(60, window.innerHeight * 0.105)));
  const [height, setHeight] = useState(calc);
  useEffect(() => {
    const onResize = () => setHeight(calc());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return height;
}
