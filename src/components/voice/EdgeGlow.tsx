import { useEffect, useRef, useState } from 'react';
import { T } from '../../tokens';
import { useSessionStore } from '../../stores/sessionStore';
import { useAudioLevelVar } from './useAudioLevelVar';

/** v0.34.0 B8 → v0.36.0 코덱스 시안(2026-07-20, 민구 확정) — 화면 **안쪽** 상태 엣지글로우.
 *  물리 베젤 밖은 PWA가 그릴 수 없으므로 외부로 퍼지는 shadow는 금지, 전부 안쪽으로 번진다:
 *   - 5px 고휘도 코어 링(border) + 18px strong / 46px medium / 94px low-alpha 블룸(inset shadow)
 *   - 상태별 모션 언어: 듣는 중 1.75s 순환(코어 호흡 + 가장자리 스윕), 경고 0.7s 빠른 흐름,
 *     일시정지 2.4s 느린 호흡(스윕 없음), 값 확인 1회 확산(edge-confirm) 후 안정.
 *
 *  배치(v0.37.0 FB-A+H): **position:fixed inset:0**으로 뷰포트 full-bleed(물리 화면 가장자리까지).
 *  마운트는 VoiceScreen에 그대로 둔다(레벨 getter가 useVoiceSession 인스턴스에 묶여 있어 상향 불가).
 *  pointer-events:none, zIndex 54(탭바 53 위·팝업/시트 55-60 아래).
 *
 *  성능 규칙(§5.3): 큰 box-shadow는 톤별 정적 레이어로 1회 페인트하고 opacity 크로스페이드로만
 *  전환한다. 매 프레임 갱신은 wrapper opacity(--voice-level, rAF)와 keyframe의 opacity/transform뿐.
 *  스윕 바는 transform 전용(합성기). prefers-reduced-motion이면 스윕·호흡·확산을 전부 끄고
 *  코어 링 + 블룸 + 톤(색)만 정적으로 남긴다. */
export type GlowTone = 'green' | 'amber' | 'red';

const TONE_COLOR: Record<GlowTone, { base: string; soft: string; strong: string; faint: string }> = {
  green: { base: T.green, soft: T.greenGlow, strong: T.greenGlowStrong, faint: T.greenGlowFaint },
  amber: { base: T.amber, soft: T.amberGlow, strong: T.amberGlowStrong, faint: T.amberGlowFaint },
  red: { base: T.red, soft: T.redGlow, strong: T.redGlowStrong, faint: T.redGlowFaint },
};
const TONES: readonly GlowTone[] = ['green', 'amber', 'red'];

/** 상태별 모션 cadence(§5.2). 색만 바꾸지 않는다 — 호흡 주기가 함께 달라진다.
 *  스윕 바는 리뷰 라운드1(Flash+Pro, 배터리) 수용으로 **듣는 중(green + levelActive)에만** 구동 —
 *  amber/red·비청취 구간은 호흡(edge-pulse)만 남긴다(무한 transform 애니메이션 상시 구동 방지). */
const TONE_PULSE_S: Record<GlowTone, number> = { green: 1.75, amber: 2.4, red: 0.7 };
const SWEEP_S = 1.75;

// 4겹 안쪽 적층: 5px 코어는 border가 그리고, 블룸 3겹은 inset shadow(정적 1회 페인트).
const coreStyleFor = (t: GlowTone): React.CSSProperties => ({
  position: 'absolute',
  inset: 0,
  border: `5px solid ${TONE_COLOR[t].base}`,
  boxShadow: [
    `inset 0 0 18px 2px ${TONE_COLOR[t].strong}`,
    `inset 0 0 46px 10px ${TONE_COLOR[t].soft}`,
    `inset 0 0 94px 28px ${TONE_COLOR[t].faint}`,
  ].join(', '),
});

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
  // v0.35.0 FIX-2 — 정지(rAF 중지) 시 --voice-level 고착 프레임 방지: baseline 강제.
  const opacity: number = reduced
    ? 0.72
    : levelOn
      ? ('calc(0.55 + var(--voice-level, 0) * 0.45)' as unknown as number)
      : 0.55;
  const confirmSeq = useConfirmSeq(tone, reduced);
  return (
    <div
      ref={levelRef}
      data-testid="edge-glow"
      data-tone={tone}
      aria-hidden
      // v0.37.0 FB-A+H(민구) — **full-bleed**: position:fixed inset:0으로 뷰포트(물리 화면 가장자리)를
      //   덮는다. 종전 absolute는 App 루트의 safe-area 패딩 안쪽 VoiceScreen 사각형에 갇혀 상단 레터박스가
      //   생기고 탭바 뒤까지 번지지 않았다. fixed는 그 패딩을 벗어나 화면 끝까지 안쪽 글로우가 닿는다
      //   (조상에 transform/filter/backdrop-filter 없음 → 컨테이닝 블록 = 뷰포트, 확인함). pointer-events
      //   :none이라 위를 덮어도 탭바/버튼 터치는 통과(B7 검증).
      style={{ position: 'fixed', inset: 0, zIndex: 54, pointerEvents: 'none', overflow: 'hidden', opacity }}
    >
      {/* 호흡 레이어 — cadence는 톤별 duration. wrapper의 레벨 opacity와 곱해진다. */}
      <div
        data-glow-pulse
        style={{
          position: 'absolute',
          inset: 0,
          animation: reduced ? 'none' : `edge-pulse ${TONE_PULSE_S[tone]}s ease-in-out infinite`,
          willChange: reduced ? undefined : 'opacity',
        }}
      >
        {TONES.map((t) => (
          <div
            key={t}
            data-glow-layer={t}
            style={{
              ...coreStyleFor(t),
              opacity: t === tone ? 1 : 0,
              transition: reduced ? 'none' : 'opacity 400ms ease',
              willChange: 'opacity',
            }}
          />
        ))}
      </div>
      {!reduced && levelActive && tone === 'green' && (
        <SweepBars color={TONE_COLOR.green.base} durationS={SWEEP_S} />
      )}
      {confirmSeq != null && (
        <div
          key={confirmSeq}
          data-glow-confirm
          style={{ ...coreStyleFor('green'), animation: 'edge-confirm 900ms ease-out 1' }}
        />
      )}
    </div>
  );
}

/** 값 확인(깨끗한 커밋 = valueBurst seq 증가) 1회 확산 트리거. 표시 전용 구독 — 로직 무수정.
 *  green(정상 흐름)에서만, reduced-motion이면 항상 null(모션 제거, 코어·색·심볼은 유지).
 *
 *  ⚠️ 리뷰 라운드1(Codex+Pro 공통, 수용) — effect를 3개로 분리한다. 종전 단일 effect는 플래시 도중
 *  tone이 red/amber로 바뀌면 cleanup이 제거 타이머를 취소하고, 재실행은 `next === seen` 조기 반환이라
 *  setSeq(null)이 영영 안 불려 **초록 confirm 레이어가 경고색 위에 영구 잔존**했다.
 *   1) seq 소비(트리거) — tone/reduced 게이트 포함.
 *   2) 제거 타이머 — seq에만 종속(다른 dep 변화가 타이머를 못 자른다).
 *   3) tone 이탈/reduced — 즉시 정리(경고 전환 시 플래시 중단). */
function useConfirmSeq(tone: GlowTone, reduced: boolean): number | null {
  const burst = useSessionStore((st) => st.valueBurst);
  const [seq, setSeq] = useState<number | null>(null);
  const seenRef = useRef<number | null>(null);
  useEffect(() => {
    const next = burst?.seq ?? 0;
    if (seenRef.current === null) { seenRef.current = next; return; } // 마운트 시 기존 버스트 미재생
    if (next === seenRef.current) return;
    seenRef.current = next;
    if (!reduced && tone === 'green') setSeq(next);
  }, [burst, tone, reduced]);
  useEffect(() => {
    if (seq === null) return;
    const t = window.setTimeout(() => setSeq(null), 950); // edge-confirm 900ms 종료 후 레이어 제거
    return () => window.clearTimeout(t);
  }, [seq]);
  useEffect(() => {
    if (tone !== 'green' || reduced) setSeq(null);
  }, [tone, reduced]);
  return seq;
}

/** 가장자리 스윕 바 4개(코덱스 reference-ui 동형) — transform 전용 keyframe, 합성기 컴포지팅.
 *  색 전환은 톤 변경 시에만(드묾) 발생하므로 정적 페인트 원칙과 충돌하지 않는다. */
function SweepBars({ color, durationS }: { color: string; durationS: number }) {
  const glow = `0 0 18px 7px ${color}`;
  const base: React.CSSProperties = {
    position: 'absolute', background: color, boxShadow: glow, opacity: 0.95, willChange: 'transform',
  };
  const x: React.CSSProperties = { width: '42%', height: 7, left: 0 };
  const y: React.CSSProperties = { width: 7, height: '29%', top: 0 };
  return (
    <>
      <div data-glow-sweep="top" style={{ ...base, ...x, top: 0, animation: `edge-sweep-x ${durationS}s linear infinite` }} />
      <div data-glow-sweep="bottom" style={{ ...base, ...x, bottom: 0, top: undefined, animation: `edge-sweep-x-reverse ${durationS}s linear infinite` }} />
      <div data-glow-sweep="right" style={{ ...base, ...y, right: 0, animation: `edge-sweep-y ${durationS}s linear infinite` }} />
      <div data-glow-sweep="left" style={{ ...base, ...y, left: 0, animation: `edge-sweep-y-reverse ${durationS}s linear infinite` }} />
    </>
  );
}
