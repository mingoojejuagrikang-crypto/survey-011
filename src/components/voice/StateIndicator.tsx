import { useEffect, useState } from 'react';
import { T } from '../../tokens';
import { StateDots, type DotGlyph } from './StateDots';
import type { GlowTone } from './EdgeGlow';

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
  const color = TONE_COLOR[tone];

  // 격자 하나. 도트와 파형이 **같은 셀 집합**을 공유하므로 겹쳐 보이는 상태가 존재하지 않는다.
  const stack = (
    <div style={{ width: '100%', height: '100%', maxHeight: '100%', minWidth: 0, display: 'grid', placeItems: 'center' }}>
      <StateDots
        glyph={glyph}
        color={color}
        size={height}
        active={waveActive && levelActive}
        getLevel={getAudioLevel}
        getTimeDomainData={getTimeDomainData}
      />
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
