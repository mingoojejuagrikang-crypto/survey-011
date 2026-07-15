import { useEffect, useRef, useState, type ReactNode } from 'react';
import { T } from '../../tokens';
import { useSessionStore } from '../../stores/sessionStore';
import { useFitScale } from './useFitScale';
import { ReaskCue, type ReaskReason } from './ReaskCue';
import { VoiceWaveform } from './VoiceWaveform';
import type { Column } from '../../types';

/** v0.35.0 (Vance) — 입력 탭의 시각 중심. 민구 실기기 피드백(FB-A/C/F)으로 3-상태 카드로 재설계.
 *  상태는 전부 store 파생 props/구독으로만 들어온다(플로우 로직 무수정).
 *
 *  1) 대기('듣는 중'): 항목명(큰 글씨) + **카드에 통합된 실시간 파형**(VoiceWaveform). "듣는 중"
 *     텍스트는 제거 — 파형이 곧 '듣고 있음' 신호. 패널 자체는 은은한 point 점멸(panel-pulse).
 *  2) 커밋 직후(~1.5s): **굵은 녹색 ✓ + 인식값**을 크게. "확인됨" 텍스트 없음. store `valueBurst`
 *     (write-only로 잔존하던 필드, v0.35.0에 소비자 부활)의 seq 변화로 진입, CONFIRM_MS 뒤 대기 복귀.
 *     ⚠️ 반드시 valueBurst.name/value에서만 읽는다 — advance()가 TTS 전에 포인터를 다음 항목으로
 *     옮기므로 currentCol을 쓰면 "다음 항목 값"으로 오해된다(v0.34.0 A4가 값 표시를 없앤 이유).
 *     그래서 확인 카드는 대기 카드와 **시각적으로 뚜렷이 구분**(밝은 초록 채움 + ✓ 아이콘)한다.
 *  3) 검토(phase 'complete'): "N행 완료 — 명령 대기" 정적 라벨(점멸 없음). completing이 확인
 *     플래시보다 우선(렌더 순서로 강제 — 타이머 레이스 방지).
 *
 *  정정(correct)은 hero가 아니라 ModifyIndicatorPill이 담당(불변). */

const HERO_PANEL = {
  // 대기/검토 공통 초록 계열 패널(현행 의미색 — 입력탭 hero는 확정 흐름).
  bg: 'rgba(10,28,18,0.94)',
  border: T.green,
} as const;

const CONFIRM_PANEL = {
  // 확인 전용 — 대기 카드와 뚜렷이 구분되게 초록을 더 밝게 채운다(오해 방지 핵심).
  bg: 'rgba(0,200,83,0.28)',
  border: T.green,
} as const;

const CONFIRM_MS = 1500;

/** v0.35.0 FIX-6(리뷰 라운드1) — 카드 진입/점멸 애니메이션(flash-green·check-pop·chip-pop·panel-pulse)
 *  reduced-motion 존중용. EdgeGlow·VoiceWaveform과 동일 판정. */
function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function VoiceHero({
  col, review, row, reaskReason, getAudioLevel, getTimeDomainData,
}: {
  col: Column;
  /** true면 phase 'complete'의 정적 라벨("N행 완료 — 명령 대기"). 확인 플래시보다 우선. */
  review: boolean;
  row: number;
  /** 대기(listening)일 때만 비-null. 재질문 사유(소리 불확실/파싱 실패)를 항목명 아래 보조선으로. */
  reaskReason: ReaskReason;
  /** 파동 레벨 getter(recorder 지수평활 레벨 0~1) — analyser 미가용 폴백용. */
  getAudioLevel: () => number;
  /** 시간영역 파형 getter — 실시간 사람 음성 파형. false 반환 시 VoiceWaveform이 레벨 폴백. */
  getTimeDomainData: (out: Uint8Array) => boolean;
}) {
  // ── 확인 플래시 상태(view 전용 — 타이머는 여기 소유해 VoiceScreen을 얇게 유지). ──
  const burst = useSessionStore((st) => st.valueBurst);
  const [confirmed, setConfirmed] = useState<{ name: string; value: string } | null>(null);
  const seenSeqRef = useRef<number | null>(null);
  useEffect(() => {
    const seq = burst?.seq ?? 0;
    if (seenSeqRef.current === null) {
      // 초기 마운트(또는 이상치/수정 복귀): 기존 버스트는 확인 플래시로 재생하지 않는다.
      seenSeqRef.current = seq;
      return;
    }
    // completing은 확인 플래시 억제 — 단 seq는 **소비**해야 한다(v0.35.0 FIX-3, 리뷰 라운드1).
    //   review 중 도착한 burst를 소비 안 하면, 이후 미완료 행 이동(review=false)에서 그 과거 burst가
    //   새 확인값처럼 1.5초 재생돼(화면=이전 행 값, 입력=현재 행) 혼선이 난다.
    if (review) { seenSeqRef.current = seq; setConfirmed(null); return; }
    if (!burst || seq === seenSeqRef.current) return;
    seenSeqRef.current = seq;
    setConfirmed({ name: burst.name, value: burst.value });
    const t = window.setTimeout(() => setConfirmed(null), CONFIRM_MS);
    return () => window.clearTimeout(t); // seq 갱신·언마운트마다 정리(STT-14 계열 dangling timer 방지).
  }, [burst, review]);

  // 렌더 우선순위(명시적 — 타이머 레이스 무관): review > confirm > listening.
  const showConfirm = !review && confirmed !== null;
  const isListening = !review && !showConfirm;
  const fitRef = useFitScale<HTMLDivElement>([review, showConfirm, col.name, row, reaskReason, confirmed?.value]);
  const reduced = prefersReducedMotion();

  const panel = showConfirm ? CONFIRM_PANEL : HERO_PANEL;

  return (
    <div
      ref={fitRef}
      aria-live="polite"
      data-hero-state={review ? 'review' : showConfirm ? 'confirm' : 'listening'}
      style={{
        maxWidth: 'min(560px, 94vw)', width: '100%',
        maxHeight: '100%', minHeight: 0, overflowY: 'auto',
        padding: 'clamp(12px, 2.2vh, 20px) clamp(16px, 4.4vw, 24px)', borderRadius: 18,
        background: panel.bg,
        border: `2px solid ${panel.border}`,
        boxShadow: '0 10px 36px rgba(0,0,0,0.5)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'clamp(6px, 1.2vh, 10px)',
        textAlign: 'center', minWidth: 0,
        // 대기일 때만 패널 자체 은은 점멸(듣는 중 신호). 확인/검토는 점멸하지 않는다.
        // v0.35.0 FIX-6(리뷰 라운드1) — reduced-motion이면 카드 애니메이션(flash-green/panel-pulse)도
        //   존중해 정지(EdgeGlow·VoiceWaveform과 일관). 상태 전환은 애니메이션 없이 즉시.
        animation: reduced
          ? undefined
          : showConfirm
            ? 'flash-green 600ms ease-out'
            : isListening
              ? 'panel-pulse 1.8s ease-in-out infinite'
              : undefined,
        willChange: !reduced && isListening ? 'opacity, box-shadow' : undefined,
      }}
    >
      {review ? (
        // 검토 대기(완료행): 명령 대기 라벨 + N행 완료.
        <>
          <HeroStatusLine>명령 대기</HeroStatusLine>
          <HeroPrimaryLine value={`${row}행 완료`} reduced={reduced} />
        </>
      ) : showConfirm && confirmed ? (
        // 확인 플래시: 항목명(초록) + ✓ + 인식값(크게). "확인됨" 텍스트 없음.
        <>
          <HeroStatusLine>{confirmed.name}</HeroStatusLine>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'clamp(8px, 2vw, 16px)', minWidth: 0, maxWidth: '100%' }}>
            <CheckMark reduced={reduced} />
            <HeroPrimaryLine value={confirmed.value} confirm reduced={reduced} />
          </div>
        </>
      ) : (
        // 대기: 항목명(큰 글씨) + 통합 파형. "듣는 중" 텍스트 제거.
        <>
          <HeroPrimaryLine value={col.name} reduced={reduced} />
          <div style={{ width: '100%', maxWidth: 'min(480px, 88vw)' }}>
            <VoiceWaveform
              active={isListening}
              getLevel={getAudioLevel}
              getTimeDomainData={getTimeDomainData}
            />
          </div>
          <ReaskCue reason={reaskReason} />
        </>
      )}
    </div>
  );
}

/** 굵은 녹색 체크 배지(확인 전용) — 원거리(2~3m)에서 즉시 '확인됨'으로 읽히게 채운 초록 원 + 흰
 *  체크. 대기 카드(파형)와 시각적으로 뚜렷이 구분되는 핵심 요소. check-pop 등장(global.css). */
function CheckMark({ reduced }: { reduced?: boolean }) {
  // 고정 clamp(뷰포트 기반) — fit 스케일 곱은 width에서 0으로 접히는 경우가 있어 배지엔 쓰지 않는다.
  const size = 'clamp(40px, 13vw, 62px)';
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        width: size, height: size, minWidth: size, borderRadius: '50%',
        background: T.green,
        boxShadow: '0 0 18px rgba(0,200,83,0.6)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        animation: reduced ? undefined : 'check-pop 320ms ease-out',
      }}
    >
      <svg viewBox="0 0 24 24" width="62%" height="62%" fill="none" stroke="#fff" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12.5l5 5L20 6" />
      </svg>
    </span>
  );
}

function HeroStatusLine({ children }: { children: ReactNode }) {
  return (
    <span style={{
      fontSize: 'max(14px, calc(clamp(17px, min(4.6vw, 2.6vh), 24px) * var(--fit-lo, 1)))',
      fontWeight: 900,
      color: T.green,
      letterSpacing: -0.2,
      lineHeight: 1.12,
      wordBreak: 'keep-all',
      overflowWrap: 'anywhere',
      textAlign: 'center',
    }}>
      {children}
    </span>
  );
}

/** 항목명(대기)·N행완료(검토)·인식값(확인) 공통 대형 라인. confirm이면 흰 값(초록 배경 대비). */
function HeroPrimaryLine({ value, confirm, reduced }: { value: string; confirm?: boolean; reduced?: boolean }) {
  return (
    <span
      key={value}
      data-testid="hero-primary"
      style={{
        fontSize: 'calc(clamp(30px, min(13vw, 9.4vh), 76px) * var(--fit-hi, 1))',
        fontWeight: 900,
        lineHeight: 1.05,
        color: T.text,
        letterSpacing: -1,
        wordBreak: 'keep-all',
        overflowWrap: 'anywhere',
        maxWidth: '100%',
        textAlign: 'center',
        animation: reduced ? undefined : 'chip-pop 320ms ease-out',
        ...(confirm ? { textShadow: '0 0 18px rgba(0,200,83,0.5)' } : {}),
      }}
    >
      {value}
    </span>
  );
}
