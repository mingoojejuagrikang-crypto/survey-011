import { useEffect, useRef, useState, type ReactNode } from 'react';
import { T } from '../../tokens';
import { useSessionStore } from '../../stores/sessionStore';
import { useFitScale } from './useFitScale';
import { HERO_TYPE } from './heroLayout';
import { ReaskCue, type ReaskReason } from './ReaskCue';
import type { GlowTone } from './EdgeGlow';
import type { Column } from '../../types';

/** v0.35.0 → v0.36.0 코덱스 시안(2026-07-20, 민구 확정) — 입력 탭의 시각 중심(hero).
 *  카드 chrome(테두리 박스·패널 배경) 완전 제거 — 화면 전체와 안쪽 엣지글로우가 하나의 상태판으로
 *  읽힌다. 구성: [상태 심볼 원(76~82px)] + [항목명(38~44px, textDim)] + [값].
 *
 *  1) 대기(listening): ◯mic + 항목명. **인식 중이면 STT 원문 문자열(interimValue)을 크게**(56~72px,
 *     "사십이 점…" 스타일 — FB#2). "듣는 중" 같은 중복 문구 없음(파형 밴드가 생존 신호).
 *  2) 커밋 직후(~1.5s): ◯✓ + 항목명 + **확정값(80~100px, tabular)**. store `valueBurst`의 seq
 *     변화로 진입, CONFIRM_MS 뒤 대기 복귀.
 *     ⚠️ 반드시 valueBurst.name/value에서만 읽는다 — advance()가 TTS 전에 포인터를 다음 항목으로
 *     옮기므로 currentCol을 쓰면 "다음 항목 값"으로 오해된다(v0.34.0 A4가 값 표시를 없앤 이유).
 *  3) 검토(phase 'complete'): ◯✓ + **방금 입력한 값**(대형, v0.37.0 FB-E — 종전의 대형 행 번호를
 *     제거). 값 출처는 행의 마지막 음성 컬럼 실제 커밋값(ActiveState 파생). 행 번호 의미는
 *     aria-label("N행 완료, 명령 대기")로 보존. completing이 확인 플래시보다 우선(렌더 순서로 강제).
 *
 *  재질문 프롬프트(ReaskCue)는 TTS say()와 글자까지 일치(voicePrompts SSOT, FB#4) — hero 한 영역에서
 *  인식값과 상호 배타로 표시하고 별도 echo strip은 두지 않는다(§10).
 *  정정(correct)은 hero가 아니라 ModifyIndicatorPill이 담당(불변). */

const CONFIRM_MS = 1500;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function VoiceHero({
  col, review, row, tone, reaskReason, reviewName, reviewValue,
}: {
  col: Column;
  /** true면 phase 'complete'의 검토 표시(✓ + 방금 입력한 값). 확인 플래시보다 우선. */
  review: boolean;
  row: number;
  /** VoiceScreen이 파생한 화면 상태 톤 SSOT(마이크 소실 red 포함). */
  tone: GlowTone;
  /** 대기(listening)일 때만 비-null. 재질문 사유/소수 재질문 프롬프트(TTS 글자 일치). */
  reaskReason: ReaskReason;
  /** v0.37.0 FB-E(민구) — 검토(complete) 표시에서 큰 **행 번호** 대신 방금 입력한 값을 크게 보인다.
   *  값의 출처는 현재 행의 **마지막 음성 컬럼 실제 커밋값**(ActiveState가 rowValues에서 파생) —
   *  valueBurst(네비게이션으로 stale 가능) 대신 행 자체 데이터라 검토 진입 경로와 무관하게 정확하다. */
  reviewName?: string;
  reviewValue?: string;
}) {
  const confirmed = useConfirmFlash(review);
  const interim = useSessionStore((st) => st.interimValue);

  // 렌더 우선순위(명시적 — 타이머 레이스 무관): review > confirm > listening.
  const showConfirm = !review && confirmed !== null;
  const fitRef = useFitScale<HTMLDivElement>([review, showConfirm, col.name, row, reaskReason, confirmed?.value, interim]);
  const reduced = prefersReducedMotion();

  return (
    // 리뷰 라운드1(Codex, 수용) — 루트 aria-live 제거: interim이 매 인식 결과마다 바뀌어 스크린리더
    // 소음이 됐다. live region은 확정 라인(HeroPrimaryLine — 항목명/확정값/행번호)에만 두고,
    // interim 노드는 제외한다(재질문은 ReaskCue 자체 role=status가 담당).
    <div
      ref={fitRef}
      data-hero-state={review ? 'review' : showConfirm ? 'confirm' : 'listening'}
      style={{
        // 카드 chrome 없음 — 배경·테두리·그림자 없이 화면 자체가 상태판(코덱스 §6.1).
        // height:100% — 흡수영역 트랙을 꽉 채운다(콘텐츠는 justifyContent로 중앙). 콘텐츠 높이에
        // 수축시키면 scrollHeight가 clientHeight를 서브픽셀/인라인 여백만큼 상시 초과해 useFitScale이
        // 매 상태 최저 단계까지 내려가는 오작동이 있었다(2026-07-20 실측: 여유 230px에도 lo=0.58).
        width: '100%', maxWidth: 'min(560px, 94vw)',
        height: '100%', maxHeight: '100%', minHeight: 0, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 'clamp(8px, 1.6vh, 16px)',
        textAlign: 'center', minWidth: 0,
      }}
    >
      {review ? (
        // v0.37.0 FB-E(민구) — 큰 행 번호 제거. 방금 입력한 값(reviewValue)을 크게 보인다(§6.1
        //   확정 숫자). 값이 있으면 [항목명 + 값], 없으면(빈 행/비정상 경로) 소형 검토 라벨로 폴백해
        //   거대한 숫자가 화면을 지배하지 않게 한다. 행 번호 의미는 aria-label로 보존(스크린리더).
        <div
          data-testid="hero-review-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`${row}행 완료, 명령 대기`}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'clamp(8px, 1.6vh, 16px)', minWidth: 0, maxWidth: '100%' }}
        >
          <StateBadge kind="check" tone={tone} reduced={reduced} />
          {reviewValue ? (
            <>
              {reviewName ? <HeroNameLine>{reviewName}</HeroNameLine> : null}
              <HeroPrimaryLine value={reviewValue} kind="value" reduced={reduced} live={false} />
            </>
          ) : (
            <HeroPrimaryLine value={`${row}행 검토`} kind="name" reduced={reduced} live={false} />
          )}
        </div>
      ) : showConfirm && confirmed ? (
        <>
          <StateBadge kind="check" tone={tone} reduced={reduced} />
          <HeroNameLine>{confirmed.name}</HeroNameLine>
          <HeroPrimaryLine value={confirmed.value} kind="value" reduced={reduced} />
        </>
      ) : (
        <>
          <StateBadge kind="mic" tone={tone} reduced={reduced} />
          <HeroPrimaryLine value={col.name} kind="name" reduced={reduced} />
          {interim && <InterimLine value={interim} />}
          <ReaskCue reason={reaskReason} />
        </>
      )}
    </div>
  );
}

/** 확인 플래시 상태(view 전용) — valueBurst seq 소비. review 중 도착한 burst도 seq는 소비해
 *  과거 burst가 이후 행에서 재생되는 혼선을 막는다(v0.35.0 FIX-3). */
function useConfirmFlash(review: boolean): { name: string; value: string } | null {
  const burst = useSessionStore((st) => st.valueBurst);
  const [confirmed, setConfirmed] = useState<{ name: string; value: string } | null>(null);
  const seenSeqRef = useRef<number | null>(null);
  useEffect(() => {
    const seq = burst?.seq ?? 0;
    if (seenSeqRef.current === null) { seenSeqRef.current = seq; return; } // 마운트 시 재생 안 함
    if (review) { seenSeqRef.current = seq; setConfirmed(null); return; }
    if (!burst || seq === seenSeqRef.current) return;
    seenSeqRef.current = seq;
    setConfirmed({ name: burst.name, value: burst.value });
    const t = window.setTimeout(() => setConfirmed(null), CONFIRM_MS);
    return () => window.clearTimeout(t); // seq 갱신·언마운트마다 정리(dangling timer 방지)
  }, [burst, review]);
  return confirmed;
}

/** 상태 심볼 원(76~82px, 5px stroke — 코덱스 §6.1). mic=듣는 중, check=확인/검토. 원거리(2~3m)
 *  주변시에서 상태를 즉시 판독하는 1차 신호. 색은 상태 의미색(초록) 토큰만 사용. */
function StateBadge({ kind, tone, reduced }: { kind: 'mic' | 'check'; tone: GlowTone; reduced?: boolean }) {
  const size = 'clamp(60px, min(19vw, 10vh), 82px)';
  const color = tone === 'red' ? T.red : tone === 'amber' ? T.amber : T.green;
  const glow = tone === 'red' ? T.redGlow : tone === 'amber' ? T.amberGlow : T.greenGlow;
  const fill = tone === 'red'
    ? 'rgba(255,82,82,0.14)'
    : tone === 'amber'
      ? 'rgba(255,183,77,0.14)'
      : 'rgba(0,200,83,0.14)';
  return (
    <span
      aria-hidden
      data-testid="voice-state-badge"
      data-tone={tone}
      style={{
        flexShrink: 0,
        width: size, height: size, minWidth: size, borderRadius: '50%',
        border: `5px solid ${color}`,
        background: kind === 'check' ? fill : 'transparent',
        boxShadow: `0 0 18px ${glow}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        animation: reduced ? undefined : kind === 'check' ? 'check-pop 320ms ease-out' : 'breathe 1.75s ease-in-out infinite',
      }}
    >
      {kind === 'mic' ? (
        <svg viewBox="0 0 24 24" width="52%" height="52%" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M19 10v2a7 7 0 01-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="56%" height="56%" fill="none" stroke={color} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12.5l5 5L20 6" />
        </svg>
      )}
    </span>
  );
}

/** 항목명 공용 타이포(HERO_TYPE.name SSOT) — listening의 hero-primary(name)와 confirm의 보조선이
 *  **동일 크기·동일 스타일**을 공유한다(민구 확정: 상태가 바뀌어도 항목명 크기는 불변). */
const HERO_NAME_STYLE: React.CSSProperties = {
  fontSize: HERO_TYPE.name,
  fontWeight: 900,
  lineHeight: 1.04,
  color: T.textDim,
  letterSpacing: -0.6,
  wordBreak: 'keep-all',
  overflowWrap: 'anywhere',
  maxWidth: '100%',
  textAlign: 'center',
};

/** 항목명 보조선(확인 상태 전용 — 값이 주인공일 때 위에 붙는 이름). 크기는 listening과 동일. */
function HeroNameLine({ children }: { children: ReactNode }) {
  return <span style={HERO_NAME_STYLE}>{children}</span>;
}

/** hero 대표 라인(data-testid="hero-primary" — 항상 이 노드가 계약 대상).
 *  kind='name': 대기 상태의 항목명(38~44px, textDim — 코덱스 §6.1).
 *  kind='value': 확정값/행번호(80~100px, tabular). */
function HeroPrimaryLine({
  value, kind, reduced, live = true,
}: {
  value: string;
  kind: 'name' | 'value';
  reduced?: boolean;
  live?: boolean;
}) {
  const isName = kind === 'name';
  return (
    <span
      key={value}
      data-testid="hero-primary"
      aria-live={live ? 'polite' : undefined}
      style={{
        // 타이포 SSOT(HERO_TYPE) — name은 HERO_NAME_STYLE과 동일 크기(상태 간 불변, 민구 확정).
        ...(isName ? HERO_NAME_STYLE : {}),
        fontSize: isName ? HERO_TYPE.name : HERO_TYPE.value,
        ...(isName
          ? {}
          : {
              fontWeight: 900,
              lineHeight: 1.04,
              color: T.text,
              letterSpacing: -2,
              fontVariantNumeric: 'tabular-nums' as const,
              wordBreak: 'keep-all' as const,
              overflowWrap: 'anywhere' as const,
              maxWidth: '100%',
              textAlign: 'center' as const,
            }),
        animation: reduced ? undefined : 'chip-pop 320ms ease-out',
      }}
    >
      {value}
    </span>
  );
}

/** 미확정 인식 원문(FB#2) — "지금 이렇게 들었다(틀렸을 수 있음)"를 STT 원문 그대로 크게(56~72px).
 *  확정값(✓ + tabular 100px)과는 심볼(mic)·크기·흐린 톤으로 구분된다. */
function InterimLine({ value }: { value: string }) {
  return (
    <span
      data-testid="interim-value"
      aria-label={`인식 중: ${value}`}
      style={{
        fontSize: HERO_TYPE.interim,
        fontWeight: 900,
        lineHeight: 1.06,
        color: T.text,
        opacity: 0.92,
        letterSpacing: -1.2,
        wordBreak: 'keep-all',
        overflowWrap: 'anywhere',
        maxWidth: '100%',
        textAlign: 'center',
      }}
    >
      {value}
    </span>
  );
}
