import { useEffect, useRef, useState, type ReactNode } from 'react';
import { T } from '../../tokens';
import { useSessionStore } from '../../stores/sessionStore';
import { HERO_FIT_STEPS, useFitScale } from './useFitScale';
import { HERO_TYPE } from './heroLayout';
import { ReaskCue, type ReaskReason } from './ReaskCue';
import type { GlowTone } from './EdgeGlow';
import type { Column } from '../../types';

/** 입력 탭의 시각 중심(hero). 카드 chrome 없이 화면 전체가 하나의 상태판으로 읽힌다.
 *  v0.38.0 #2·#8·#9·#10: 상태 아이콘을 없애고 [항목명 슬롯] + [값 슬롯]을 모든 상태가 공유한다.
 *  확인 표시는 항목명 왼쪽에 인라인으로 붙고, interim→확정 전환에도 값의 중심은 움직이지 않는다.
 *
 *  1) 대기(listening): 항목명. **인식 중이면 STT 원문 문자열(interimValue)을 크게**(56~72px,
 *     "사십이 점…" 스타일 — FB#2). "듣는 중" 같은 중복 문구 없음(파형 밴드가 생존 신호).
 *  2) 커밋 직후(~1.5s): ✓ 항목명 + **확정값(80~100px, tabular)**. store `valueBurst`의 seq
 *     변화로 진입, CONFIRM_MS 뒤 대기 복귀.
 *     ⚠️ 반드시 valueBurst.name/value에서만 읽는다 — advance()가 TTS 전에 포인터를 다음 항목으로
 *     옮기므로 currentCol을 쓰면 "다음 항목 값"으로 오해된다(v0.34.0 A4가 값 표시를 없앤 이유).
 *  3) 검토(phase 'complete'): ✓ 항목명 + **방금 입력한 값**(대형, v0.37.0 FB-E — 종전의 대형 행 번호를
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
  col, review, row, tone, reaskReason, reviewCommit,
}: {
  col: Column;
  /** true면 phase 'complete'의 검토 표시(✓ + 방금 입력한 값). 확인 플래시보다 우선. */
  review: boolean;
  row: number;
  /** VoiceScreen이 파생한 화면 상태 톤 SSOT(마이크 소실 red 포함). */
  tone: GlowTone;
  /** 대기(listening)일 때만 비-null. 재질문 사유/소수 재질문 프롬프트(TTS 글자 일치). */
  reaskReason: ReaskReason;
  // v0.37.0 리뷰 #1(Codex High, 민구: 커밋 영수증) — 검토 표시의 '방금 입력한 값'. **부모(ActiveState)가
  //   useReviewCommit으로 파생해 prop으로 내린다** — 이상치/일시정지 카드가 뜨는 동안 VoiceHero가
  //   언마운트됐다 재마운트되면 내부 mount-guard가 방금 발행된 영수증을 삼켜(검토가 중립 라벨로 폴백)
  //   버리기 때문이다. 항상 마운트돼 있는 ActiveState에서 파생하면 remount를 관통해 값이 살아남는다.
  reviewCommit: { name: string; value: string } | null;
}) {
  const confirmed = useConfirmFlash(review);
  const interim = useSessionStore((st) => st.interimValue);

  // 렌더 우선순위(명시적 — 타이머 레이스 무관): review > confirm > listening.
  const showConfirm = !review && confirmed !== null;
  const fitRef = useFitScale<HTMLDivElement>(
    [review, showConfirm, col.name, row, reaskReason, confirmed?.value, reviewCommit?.value, interim],
    HERO_FIT_STEPS,
    0,
  );
  const reduced = prefersReducedMotion();
  const checked = review || showConfirm;
  const label = review
    ? reviewCommit?.name ?? `${row}행 완료`
    : showConfirm && confirmed
      ? confirmed.name
      : col.name;
  const value = review ? reviewCommit?.value : showConfirm ? confirmed?.value : interim;
  const interimValue = !review && !showConfirm;
  const labelIsPrimary = interimValue || !value;
  const accent = tone === 'red' ? T.red : tone === 'amber' ? T.amber : T.green;

  return (
    // 리뷰 라운드1(Codex, 수용) — 루트 aria-live 제거: interim이 매 인식 결과마다 바뀌어 스크린리더
    // 소음이 됐다. live region은 확정 라인(HeroPrimaryLine — 항목명/확정값/행번호)에만 두고,
    // interim 노드는 제외한다(재질문은 ReaskCue 자체 role=status가 담당).
    <div
      ref={fitRef}
      data-hero-state={review ? 'review' : showConfirm ? 'confirm' : 'listening'}
      data-testid={review ? 'hero-review-status' : undefined}
      role={review ? 'status' : undefined}
      aria-live={review ? 'polite' : undefined}
      aria-atomic={review ? 'true' : undefined}
      aria-label={review ? `${row}행 완료, 명령 대기` : undefined}
      style={{
        // 카드 chrome 없음 — 배경·테두리·그림자 없이 화면 자체가 상태판(코덱스 §6.1).
        // height:100% — 흡수영역 트랙을 꽉 채운다(콘텐츠는 justifyContent로 중앙). 콘텐츠 높이에
        // 수축시키면 scrollHeight가 clientHeight를 서브픽셀/인라인 여백만큼 상시 초과해 useFitScale이
        // 매 상태 최저 단계까지 내려가는 오작동이 있었다(2026-07-20 실측: 여유 230px에도 lo=0.58).
        width: '100%', maxWidth: 'min(560px, 94vw)',
        height: '100%', maxHeight: '100%', minHeight: 0, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 'max(4px, calc(clamp(8px, 1.6vh, 18px) * var(--fit-lo, 1)))',
        textAlign: 'center', minWidth: 0,
      }}
    >
      <HeroNameLine
        checked={checked}
        accent={accent}
        reduced={reduced}
        primary={labelIsPrimary}
      >
        {label}
      </HeroNameLine>
      <HeroValueSlot>
        {value && (
          interimValue
            ? <InterimLine value={value} />
            : <HeroPrimaryLine value={value} reduced={reduced} live={!review} />
        )}
      </HeroValueSlot>
      {interimValue && <ReaskCue reason={reaskReason} />}
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

/** v0.37.0 리뷰 #1(민구: 커밋 영수증) — 검토(complete) 표시가 보여줄 '방금 커밋된 셀'을 store
 *  commitReceipt에서 파생한다(§10 읽기 전용 — 표시 계층에서 seq/행으로만 판별). 영수증은 음성·수동·
 *  이상치 정정 **모든** 커밋 경로가 발행하므로, 종전 valueBurst 파생(음성 전용)이 마지막 셀을 수동/
 *  정정으로 채웠을 때 내던 stale·거부값 오표시가 사라진다.
 *
 *  fresh-commit(값 표시) vs navigation-revisit(중립 라벨) 판별:
 *   - commitReceipt.seq가 바뀌면 = 실제 커밋 발생 → 영수증이 담은 행(receipt.row = 커밋 셀의 행)과 함께
 *     'fresh'로 보관한다. 커밋 직후 완료·마지막 행 완료가 이 창으로 들어온다.
 *   - 현재 검토 행(row prop)이 그 커밋 행을 벗어나면 fresh 창을 닫는다 → 이후 '이전'/점프로 완료행을
 *     재방문한 검토(enterReviewWait, 새 영수증 없음)는 stale 값 대신 null(중립 "N행 완료")을 낸다.
 *  useConfirmFlash(valueBurst 소비)와 독립 seenSeqRef를 유지한다(커플링 회피).
 *  ⚠️ **ActiveState에서 호출한다**(VoiceHero가 아니라). 이상치/일시정지 카드가 뜨는 동안 VoiceHero는
 *     언마운트되므로, 여기에 두면 mount-guard가 방금 발행된 영수증을 삼켜 검토가 중립으로 폴백한다.
 *     ActiveState는 세션 내내 마운트돼 있어 seenSeqRef/freshRef가 remount를 관통해 살아남는다. */
export function useReviewCommit(review: boolean, row: number): { name: string; value: string } | null {
  const receipt = useSessionStore((st) => st.commitReceipt);
  const [reviewVal, setReviewVal] = useState<{ name: string; value: string } | null>(null);
  const seenSeqRef = useRef<number | null>(null);
  const freshRef = useRef<{ value: { name: string; value: string }; row: number } | null>(null);
  useEffect(() => {
    const seq = receipt?.seq ?? 0;
    if (seenSeqRef.current === null) { seenSeqRef.current = seq; return; } // 마운트: 과거 영수증 재생 안 함
    // 새 커밋(seq 변화) = 방금 커밋 영수증. 영수증이 담은 행과 함께 fresh 창을 연다.
    if (seq !== seenSeqRef.current && receipt) {
      seenSeqRef.current = seq;
      freshRef.current = { value: { name: receipt.name, value: receipt.value }, row: receipt.row };
    }
    // 검토 행이 커밋 행에서 벗어나면(다른 행으로 이동/재방문) fresh 창을 닫는다 → 재방문 검토는 중립.
    if (freshRef.current && freshRef.current.row !== row) freshRef.current = null;
    setReviewVal(review && freshRef.current ? freshRef.current.value : null);
  }, [receipt, review, row]);
  return reviewVal;
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

/** 모든 상태가 공유하는 항목명 슬롯. 확인 표시는 항목명과 같은 행에 둔다. */
function HeroNameLine({
  children, checked, accent, reduced, primary,
}: {
  children: ReactNode;
  checked: boolean;
  accent: string;
  reduced: boolean;
  primary: boolean;
}) {
  return (
    <span
      data-testid={primary ? 'hero-primary' : undefined}
      style={{ ...HERO_NAME_STYLE, display: 'inline-flex', alignItems: 'baseline', justifyContent: 'center', gap: '0.22em' }}
    >
      {checked && (
        <span
          aria-hidden
          style={{ color: accent, flexShrink: 0, animation: reduced ? undefined : 'check-pop 320ms ease-out' }}
        >
          ✓
        </span>
      )}
      <span>{children}</span>
    </span>
  );
}

/** interim과 확정값이 공유하는 고정 높이 슬롯. 빈 listening 상태에도 공간을 예약해 점프를 막는다. */
function HeroValueSlot({ children }: { children?: ReactNode }) {
  return (
    <div style={{
      width: '100%',
      height: 'max(72px, calc(clamp(104px, min(34vw, 18vh), 184px) * var(--fit-hi, 1)))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 0, flexShrink: 0,
    }}>
      {children}
    </div>
  );
}

/** 확정값 대표 라인(data-testid="hero-primary", tabular hero). */
function HeroPrimaryLine({
  value, reduced, live = true,
}: {
  value: string;
  reduced?: boolean;
  live?: boolean;
}) {
  return (
    <span
      key={value}
      data-testid="hero-primary"
      aria-live={live ? 'polite' : undefined}
      style={{
        fontSize: HERO_TYPE.value,
        fontWeight: 900,
        lineHeight: 1.04,
        color: T.text,
        letterSpacing: -2,
        fontVariantNumeric: 'tabular-nums',
        wordBreak: 'keep-all',
        overflowWrap: 'anywhere',
        maxWidth: '100%',
        textAlign: 'center',
        animation: reduced ? undefined : 'chip-pop 320ms ease-out',
      }}
    >
      {value}
    </span>
  );
}

/** v0.37.0 FB-F(민구) — 이상치/범위 알람 카드 **아래**, 파형 **위**에 뜨는 미확정 인식값 좁은 스트립.
 *  알람 응답 대기 중(값 정정 발화) 사용자가 "지금 이렇게 들렸다"를 카드를 가리지 않고 확인한다.
 *
 *  ⚠️ §10 시각·청각 일치 — 여기 표시값은 **오직 실제 인식 원문**(store `interimValue`, handleInterim의
 *  STT 원문 trim)만 쓴다. `lastTts`나 항목명으로 추정하지 않는다(그건 들은 문장과 어긋날 수 있다).
 *  interim이 없으면 null(알람 카드만). ActiveState를 매 interim마다 리렌더하지 않도록 이 컴포넌트가
 *  interimValue를 **자체 구독**한다(칩·컨트롤 리렌더 회피). */
export function AlarmInterimStrip() {
  const interim = useSessionStore((st) => st.interimValue);
  return (
    <div
      data-testid={interim ? 'interim-value' : undefined}
      aria-label={interim ? `인식 중: ${interim}` : undefined}
      aria-hidden={interim ? undefined : true}
      style={{
        flexShrink: 0,
        width: '100%', height: 'clamp(46px, 6.5vh, 68px)',
        padding: '2px 8px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: T.text,
        fontSize: 'clamp(24px, min(8vw, 4.8vh), 42px)',
        fontWeight: 900,
        lineHeight: 1.15,
        letterSpacing: -0.8,
        textAlign: 'center',
        wordBreak: 'keep-all',
        overflowWrap: 'anywhere',
        visibility: interim ? 'visible' : 'hidden',
      }}
    >
      {interim}
    </div>
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
