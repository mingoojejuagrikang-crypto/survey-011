import { T } from '../../tokens';
import { useAudioLevelVar } from './useAudioLevelVar';

/** v0.34.0 B8 → v0.35.0 FB-B(Vance) — 화면 외곽 상태 글로우(iOS Siri 스타일). 민구 요청: 기존
 *  글로우가 "너무 약함" → **더 좁은 밴드 + 선명한 경계**(blur/spread 축소, 강도↑)로 바꾸고,
 *  **느리고 부드러운 점멸(pulse)**을 정상(초록)·이상치(빨강) 둘 다에 넣는다.
 *
 *  배치: VoiceScreen 루트(position:relative) 직하 absolute inset:0, pointer-events:none. zIndex 54.
 *
 *  합성 구조(모두 합성기 전용 속성 — box-shadow는 절대 매 프레임 재페인트하지 않는다):
 *   - wrapper: 음성 레벨 변조 opacity — calc(0.55 + var(--voice-level)*0.45). rAF가 --voice-level만
 *     갱신(useAudioLevelVar). levelActive=false(일시정지/완료)면 루프를 안 돌려 배터리를 아끼고
 *     --voice-level=0 → baseline 0.55로 톤만 정적 표시.
 *   - pulse layer: `edge-pulse` opacity 키프레임(느린 호흡). wrapper opacity와 **곱**해져 은은한 점멸.
 *   - tone layers 3장: 정적 inset box-shadow(각 1회 페인트) + 톤 전환 opacity 400ms 크로스페이드.
 *  prefers-reduced-motion이면 레벨 루프·pulse·크로스페이드 전부 끄고 정적 표시. */
export type GlowTone = 'green' | 'amber' | 'red';

const TONE_COLOR: Record<GlowTone, string> = {
  green: T.greenGlow,
  amber: T.amberGlow,
  red: T.redGlow,
};
const TONES: readonly GlowTone[] = ['green', 'amber', 'red'];

// 더 좁은 밴드 + 선명한 경계: 밝고 좁은 안쪽 링 + 그보다 넓은 보조 글로우 2겹(기존 90px/12px 단일
// 넓은 blur 대비 경계가 또렷하고 강하다). 색 토큰(alpha 0.32)을 2겹 적층해 강도를 올린다.
const boxShadowFor = (color: string) => `inset 0 0 22px 2px ${color}, inset 0 0 52px 9px ${color}`;

export function EdgeGlow({
  tone, getLevel, levelActive = true,
}: {
  tone: GlowTone;
  getLevel: () => number;
  /** v0.35.0 — false면 레벨 rAF를 돌리지 않는다(일시정지/완료 배터리 보호). 톤은 정적 표시. */
  levelActive?: boolean;
}) {
  const reduced =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const levelOn = !reduced && levelActive;
  const levelRef = useAudioLevelVar<HTMLDivElement>(getLevel, levelOn);
  // v0.35.0 FIX-2(리뷰 라운드1) — levelActive=false(일시정지/완료)면 rAF가 멈춰 `--voice-level`이
  //   직전 큰 값에 고착될 수 있다(useAudioLevelVar cleanup의 0 리셋은 passive effect라 페인트보다
  //   늦다). 이때 opacity를 CSS 변수와 무관하게 baseline으로 강제해 고착 프레임을 없앤다.
  //   reduced-motion=0.72(정적), 그 외 정지=0.55(baseline), 구동 중=레벨 변조 calc.
  const opacity: number = reduced
    ? 0.72
    : levelOn
      ? ('calc(0.55 + var(--voice-level, 0) * 0.45)' as unknown as number)
      : 0.55;
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
        // 레벨 변조는 이 래퍼 opacity에서만(합성기 전용). reduced-motion·정지는 고정 밝기.
        opacity,
      }}
    >
      {/* pulse 레이어 — 느린 opacity 호흡(정상·이상치 공통). wrapper opacity와 곱해진다. */}
      <div
        data-glow-pulse
        style={{
          position: 'absolute',
          inset: 0,
          animation: reduced ? 'none' : 'edge-pulse 2.6s ease-in-out infinite',
          willChange: reduced ? undefined : 'opacity',
        }}
      >
        {TONES.map((t) => (
          <div
            key={t}
            data-glow-layer={t}
            style={{
              position: 'absolute',
              inset: 0,
              boxShadow: boxShadowFor(TONE_COLOR[t]),
              opacity: t === tone ? 1 : 0,
              transition: reduced ? 'none' : 'opacity 400ms ease',
              willChange: 'opacity',
            }}
          />
        ))}
      </div>
    </div>
  );
}
