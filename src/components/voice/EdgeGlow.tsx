import { T } from '../../tokens';
import { useAudioLevelVar } from './useAudioLevelVar';

/** v0.34.0 B8(Vance) — 화면 외곽 은은한 상태 글로우(iOS Siri 스타일, 민구 요청: "입력중 현
 *  상태(초록/붉은 톤)를 화면 외곽의 은은한 페이드로도 표현").
 *
 *  배치: VoiceScreen 루트(position:relative) 직하 absolute inset:0, pointer-events:none —
 *  아래 컨트롤·칩·카드의 터치를 전부 통과시킨다. zIndex 54: 기존 fixed 오버레이(ExitConfirm/
 *  CommandHelp 55, MicReconnectBanner 60) 아래라 팝업·시트를 가리지 않는다.
 *
 *  톤은 VoiceScreen이 세션 상태에서 파생해 prop으로 준다(anomaly/micLost→red, paused→amber,
 *  그 외 active→green). 세션 비활성(ready/done)엔 VoiceScreen이 아예 렌더하지 않는다(no-op).
 *
 *  성능(⚠️ 대형 blur box-shadow): 톤별 레이어 3장을 **정적** inset box-shadow로 항상 마운트해
 *  두고(각 1회 페인트), 프레임 단위로 바뀌는 것은 opacity뿐이다 — box-shadow 자체를 다시
 *  그리지 않는 레이어 크로스페이드 구조(합성기 전용). 톤 전환은 레이어 opacity 400ms ease
 *  크로스페이드, 음성 레벨(--voice-level, useAudioLevelVar 재사용)은 래퍼 opacity의 calc()로
 *  강도만 변조한다(레벨 0이어도 baseline 0.6으로 톤 표시는 유지 — preroll 미가용 기기 폴백).
 *  prefers-reduced-motion이면 레벨 루프를 켜지 않고 전환도 없이 정적 표시한다. */
export type GlowTone = 'green' | 'amber' | 'red';

const TONE_COLOR: Record<GlowTone, string> = {
  green: T.greenGlow,
  amber: T.amberGlow,
  red: T.redGlow,
};
const TONES: readonly GlowTone[] = ['green', 'amber', 'red'];

export function EdgeGlow({ tone, getLevel }: { tone: GlowTone; getLevel: () => number }) {
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const levelRef = useAudioLevelVar<HTMLDivElement>(getLevel, !reduced);
  return (
    <div
      ref={levelRef}
      data-testid="edge-glow"
      data-tone={tone}
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 54,
        pointerEvents: 'none',
        // 레벨 변조는 래퍼 opacity에서만(합성기 전용) — 레이어의 크로스페이드 transition과
        // 분리해 매 프레임 transition 재타게팅을 피한다. reduced-motion은 고정 밝기.
        opacity: reduced ? 0.7 : ('calc(0.6 + var(--voice-level, 0) * 0.4)' as unknown as number),
      }}
    >
      {TONES.map((t) => (
        <div
          key={t}
          data-glow-layer={t}
          style={{
            position: 'absolute',
            inset: 0,
            boxShadow: `inset 0 0 90px 12px ${TONE_COLOR[t]}`,
            opacity: t === tone ? 1 : 0,
            transition: reduced ? 'none' : 'opacity 400ms ease',
            willChange: 'opacity',
          }}
        />
      ))}
    </div>
  );
}
