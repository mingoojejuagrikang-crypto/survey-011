import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { T } from '../../tokens';
import { useSessionStore } from '../../stores/sessionStore';
import { useFitGroup } from './useFitGroup';
import {
  HERO_BASE_FONT_PX,
  HERO_GAP_PX,
  HERO_LABEL_RESERVE_SCALE,
  HERO_TYPE,
  HERO_VALUE_SLOT_MIN_PX,
} from './heroLayout';
import { ReaskCue, type ReaskReason } from './ReaskCue';
import { scheduleEchoFontRender } from './fontRenderProbe';
import type { GlowTone } from './EdgeGlow';
import type { Column } from '../../types';

/** 입력 탭의 시각 중심(hero). 카드 chrome 없이 화면 전체가 하나의 상태판으로 읽힌다.
 *  v0.38.0 #2·#8·#9·#10: 상태 아이콘을 없애고 [항목명 슬롯] + [값 슬롯]을 모든 상태가 공유한다.
 *  확인 표시는 항목명 왼쪽에 인라인으로 붙고, interim→확정 전환에도 값의 중심은 움직이지 않는다.
 *
 *  1) 대기(listening): 중앙 항목명 없음. **인식 중이면 STT 원문 문자열(interimValue)을 크게**,
 *     "사십이 점…" 스타일 — FB#2). "듣는 중" 같은 중복 문구 없음(파형 밴드가 생존 신호).
 *  2) 커밋 직후(~1.5s): **확정값(80~100px, tabular)** + ✓ 항목명은 **활성 칩이 다른 항목일
 *     때만**(§C7 판별식 — 활성칩 == 중앙 항목이면 중복이라 숨긴다. 터미널 컬럼·echo 창 포함).
 *     store `valueBurst`의 seq 변화로 진입, CONFIRM_MS 뒤 대기 복귀.
 *     ⚠️ 반드시 valueBurst.name/value에서만 읽는다 — advance()가 TTS 전에 포인터를 다음 항목으로
 *     옮기므로 currentCol을 쓰면 "다음 항목 값"으로 오해된다(v0.34.0 A4가 값 표시를 없앤 이유).
 *  3) 검토(phase 'complete'): **방금 입력한 값**. 활성 칩이 같은 항목을 가리키면 중앙 항목명은
 *     중복이라 숨기고, 검토 중 다른 항목을 수정해 활성 칩과 영수증 항목이 다를 때만 항목명을 남긴다.
 *     행 완료 상태는 aria-label("N행 완료, 명령 대기")로 보존한다.
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
  col, review, row, tone, reaskReason, reviewCommit, confirmBurst = null,
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
  /** 🔴 v0.46.1 FB-10 — **store burst를 관통하는 확정 표시 트리거**(부모가 파생해 내린다).
   *
   *  이상치 정정이 정상으로 판명되면 CenterStage가 알람 카드를 접고 이 컴포넌트를 붙이는데,
   *  그 마운트와 `valueBurst` 갱신이 **같은 React 배치**에 들어가 아래 `useConfirmFlash`의
   *  *마운트 시점 burst 미재생* 가드(v0.35.0 FIX-3)에 삼켜진다 — 실측으로 확인했다(알람 카드는
   *  사라졌는데 `hero=listening`, 플래시 0회). **바로 위 `reviewCommit`이 겪은 것과 같은 함정이고
   *  처방도 같다**: 항상 마운트돼 있는 부모에서 파생해 prop으로 내리면 remount를 관통한다.
   *
   *  이 경로는 store를 안 건드리므로 v0.15.0 A4의 「정정 커밋은 burst를 밀지 않는다」 억제가
   *  그대로 살아 있다 — 값이 크게 뜨는 횟수는 여전히 **1회**다. */
  confirmBurst?: { name: string; value: string } | null;
}) {
  const confirmed = useConfirmFlash(review, confirmBurst);
  const interim = useSessionStore((st) => st.interimValue);

  // 렌더 우선순위(명시적 — 타이머 레이스 무관): review > confirm > listening.
  const showConfirm = !review && confirmed !== null;
  // 🔴 v0.47.0 W5ⓐ(민구 FB-F 확정 08-08) — 확정 플래시가 뜬 프레임의 hero 실렌더 계측을
  //    **에코 표시마다** 낸다(종전: 세션당 1회 — 가드는 fontRenderProbe가 소유했다).
  //    ⚠️ deps에 `confirmed.seq`가 **반드시** 있어야 한다. 연속 커밋은 `armFlash`가 값만
  //    갈아끼우므로 `showConfirm`은 true → true로 **변하지 않고**, seq가 없으면 두 번째
  //    커밋부터 계측이 조용히 사라진다(전수화의 목적이 통째로 무산된다).
  const confirmSeq = confirmed?.seq ?? 0;
  useEffect(() => {
    if (showConfirm) scheduleEchoFontRender();
  }, [showConfirm, confirmSeq]);
  const labelFitRef = useRef<HTMLSpanElement>(null);
  const valueFitRef = useRef<HTMLSpanElement>(null);
  const fitRef = useFitGroup<HTMLDivElement>(
    [review, showConfirm, col.name, row, reaskReason, confirmed?.value, reviewCommit?.value, interim],
    [
      {
        variable: '--fit-value',
        members: [valueFitRef],
        // 같은 변수의 value(64px)·interim(44px) 중 작은 쪽으로 첫 probe를 넉넉하게 유도한다.
        searchBasePx: HERO_BASE_FONT_PX.interim,
      },
      {
        variable: '--fit-label',
        members: [labelFitRef],
        searchBasePx: HERO_BASE_FONT_PX.name,
        reserveScale: HERO_LABEL_RESERVE_SCALE,
      },
    ],
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
  // GL-007은 상태 이름이 아니라 실제 정보 채널로 판별한다 — 판별식은 「활성 칩(col)이 그 항목을
  // 가리키는가」 하나다(ui-standard §1). review: 일반 행 완료는 영수증 항목 == 활성 칩이라 숨기고,
  // 완료행 검토 중 다른 항목을 수정하면 enterReviewWait가 활성 칩을 첫 컬럼으로 되돌려 다를 때만
  // 남긴다. 영수증 없는 완료행 재방문의 `${row}행 완료` 시각 문구도 톤·진행·aria와 중복이라 숨긴다.
  const reviewLabelNeeded = review && reviewCommit !== null && reviewCommit.name !== col.name;
  // 🔴 v0.45.0 UI③(민구 확정 08-05, 추가요청2) — **confirm의 '✓+항목명' 라벨은 전면 삭제.**
  // §C7 판별식(활성칩 != 중앙 항목일 때만 표시)으로도 남던 잔여 표시("여전히 잠깐씩 표시되고
  // 있음" — 민구 재지적)를 조건 없이 거둔다. 성공 표시는 칩존이 승계한다: 방금 확정된 칩의
  // '✓' 마크(useVoiceCommitMark) + 하이라이트. **값 플래시(1.5초)는 유지**(민구 선택 — 방금
  // 인식된 값의 시각 확인 + font_render_echo 계측 대상). 항목명·값은 아래 aria-label이 보존.
  const accent = tone === 'red' ? T.red : tone === 'amber' ? T.amber : T.green;
  const accessibleState = review
    ? `${row}행 완료, 명령 대기`
    : showConfirm && confirmed
      ? `${confirmed.name} ${confirmed.value} 입력 완료`
      : interim
        ? `${col.name} 인식 중: ${interim}`
        : `${col.name} 듣는 중`;

  return (
    // 리뷰 라운드1(Codex, 수용) — 루트 aria-live 제거: interim이 매 인식 결과마다 바뀌어 스크린리더
    // 소음이 됐다. live region은 확정 라인(HeroPrimaryLine — 항목명/확정값/행번호)에만 두고,
    // interim 노드는 제외한다(재질문은 ReaskCue 자체 role=status가 담당).
    <div
      ref={fitRef}
      data-hero-state={review ? 'review' : showConfirm ? 'confirm' : 'listening'}
      data-testid={review ? 'hero-review-status' : undefined}
      role={review ? 'status' : 'group'}
      aria-live={review ? 'polite' : undefined}
      aria-atomic={review ? 'true' : undefined}
      aria-label={accessibleState}
      style={{
        // 카드 chrome 없음 — 배경·테두리·그림자 없이 화면 자체가 상태판(코덱스 §6.1).
        // height:100% — 흡수영역 트랙을 꽉 채운다(콘텐츠는 justifyContent로 중앙). 콘텐츠 높이에
        // 수축시키면 scrollHeight가 clientHeight를 서브픽셀/인라인 여백만큼 상시 초과해 useFitScale이
        // 매 상태 최저 단계까지 내려가는 오작동이 있었다(2026-07-20 실측: 여유 230px에도 lo=0.58).
        width: '100%', maxWidth: 'min(560px, 94vw)',
        height: '100%', maxHeight: '100%', minHeight: 0, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: `max(${HERO_GAP_PX.min}px, calc(${HERO_GAP_PX.base}px * var(--fit-label, 1)))`,
        textAlign: 'center', minWidth: 0,
      }}
    >
      {/* 🔴 fb-27-2(민구 확정 2026-07-27) — **대기(listening)에서는 항목명을 렌더하지 않는다.**
          근거(민구 원문): "중앙 히어로 영역의 입력 항목 삭제. 칩이 사이즈 업 되었고, 진행 항목
          하이라이트 하기에 없어도 됨." v0.40.0에서 칩이 트랙 한 행을 통째로 써서 항목명이 크게
          보이고 활성 칩이 하이라이트되므로, 중앙의 같은 글자는 중복이다. 비운 공간은 인식값을
          크게 쓰는 데 쓴다.

          🔴 §C7 F01·F05(v0.44.0) — confirm·review 모두 **판별식**으로 렌더한다:
          `활성칩 == 중앙 항목`이면 중복이라 숨긴다(GL-007 원칙 1). 종전 이 주석이 "confirm은
          활성 칩이 이미 다음 항목으로 옮겨가므로 반드시 남긴다"로 **상태 이름에 굳어 있었고**,
          터미널 컬럼(종경)에서는 칩이 못 넘어가 그 전제가 거짓이었다 — 세션당 18회 중복.
          칩이 실제로 다음 항목으로 옮겨간 뒤에만 남는다. 렌더를 통째로 건너뛰므로 빈 줄
          간격도 남지 않는다. 오라클: v039-active-zones '§C7 F01·F05 — 터미널 컬럼 커밋'. */}
      {!interimValue && review && reviewLabelNeeded && (
        <HeroNameLine
          checked={checked}
          accent={accent}
          reduced={reduced}
          primary={labelIsPrimary}
          fitRef={labelFitRef}
        >
          {label}
        </HeroNameLine>
      )}
      <HeroValueSlot>
        {value && (
          interimValue
            ? <InterimLine value={value} fitRef={valueFitRef} />
            : <HeroPrimaryLine value={value} reduced={reduced} live={!review} fitRef={valueFitRef} />
        )}
      </HeroValueSlot>
      {interimValue && <ReaskCue reason={reaskReason} />}
    </div>
  );
}

/** 확인 플래시 상태(view 전용) — valueBurst seq 소비. review 중 도착한 burst도 seq는 소비해
 *  과거 burst가 이후 행에서 재생되는 혼선을 막는다(v0.35.0 FIX-3).
 *
 *  v0.46.1 FB-10 — 트리거가 둘이 됐다: ①store `valueBurst`(정상 커밋) ②`external` prop(이상치
 *  정정 완료 — 위 `confirmBurst` 주석의 remount 함정 때문에 store를 못 탄다). **표시는 하나다** —
 *  둘 다 같은 `confirmed`로 들어가 같은 `HeroPrimaryLine`을 그린다(값 위계를 가르지 않는다). */
function useConfirmFlash(
  review: boolean,
  external: { name: string; value: string } | null,
): { name: string; value: string; seq: number } | null {
  const burst = useSessionStore((st) => st.valueBurst);
  // v0.47.0 W5ⓐ — `seq`는 **표시에 쓰이지 않는다.** 연속 확정(값만 갈리고 상태는 confirm 유지)을
  //   계측 effect가 구분할 수 있게 하는 유일한 축이다(위 `confirmSeq` deps 주석이 근거).
  const [confirmed, setConfirmed] = useState<{ name: string; value: string; seq: number } | null>(null);
  const flashSeqRef = useRef(0);
  const seenSeqRef = useRef<number | null>(null);
  // 🔴 타이머를 effect cleanup이 아니라 ref로 든다(아래 external effect와 공유).
  //  external은 advance가 알람을 내리면 non-null → null로 바뀌는데, 타이머가 cleanup에 묶여
  //  있으면 그 전환이 **아직 안 끝난 1.5초 타이머를 죽여** 값이 화면에 영구 고착된다.
  const timerRef = useRef<number | null>(null);
  const armFlash = (next: { name: string; value: string }) => {
    setConfirmed({ ...next, seq: ++flashSeqRef.current });
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setConfirmed(null), CONFIRM_MS);
  };
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current); // 언마운트 정리
  }, []);
  useEffect(() => {
    const seq = burst?.seq ?? 0;
    if (seenSeqRef.current === null) { seenSeqRef.current = seq; return; } // 마운트 시 재생 안 함
    if (review) { seenSeqRef.current = seq; setConfirmed(null); return; }
    if (!burst || seq === seenSeqRef.current) return;
    seenSeqRef.current = seq;
    armFlash({ name: burst.name, value: burst.value });
  }, [burst, review]);
  // ② 외부 트리거 — **up-edge만** 잡는다(null→값). 같은 값이 리렌더마다 재무장하면 타이머가
  //    계속 밀려 1.5초 계약이 무한정 늘어난다. 해제(null)되면 다음 정정을 위해 마커를 비운다.
  //    🔴 key는 **비교 전용**이다 — 여기서 name/value를 도로 파싱하지 않는다. 항목명에 무엇이
  //    들어오는지 우리는 모른다(공백·구분자 포함 가능 — 시트 불특정 계약, 민구 지시 08-05).
  //    표시할 값은 항상 `externalRef`에서 객체째로 읽는다.
  const extKey = external ? JSON.stringify([external.name, external.value]) : null;
  const seenExtRef = useRef<string | null>(null);
  const externalRef = useRef(external);
  externalRef.current = external;
  useEffect(() => {
    if (extKey === null) { seenExtRef.current = null; return; }
    if (seenExtRef.current === extKey) return;
    seenExtRef.current = extKey;
    if (review) return; // 검토 표시가 확정 플래시보다 우선(위 렌더 우선순위와 같은 계약)
    const ext = externalRef.current;
    if (ext) armFlash({ name: ext.name, value: ext.value });
  }, [extKey, review]);
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
  children, checked, accent, reduced, primary, fitRef,
}: {
  children: ReactNode;
  checked: boolean;
  accent: string;
  reduced: boolean;
  primary: boolean;
  fitRef: RefObject<HTMLSpanElement>;
}) {
  return (
    <span
      ref={fitRef}
      data-fit-group="label"
      style={{
        ...HERO_NAME_STYLE,
        display: 'inline-flex', alignItems: 'baseline', justifyContent: 'center', gap: '0.22em',
        width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', flexShrink: 0,
      }}
    >
      {checked && (
        <span
          aria-hidden
          style={{ color: accent, flexShrink: 0, animation: reduced ? undefined : 'check-pop 320ms ease-out' }}
        >
          ✓
        </span>
      )}
      <span data-testid={primary ? 'hero-primary' : undefined}>{children}</span>
    </span>
  );
}

/** interim과 확정값이 공유하는 content-sized 슬롯. 실제 line box가 높이를 정하고, 72px floor는
 *  긴 interim처럼 line box가 그보다 작아질 때만 남는 공간을 완충한다. */
function HeroValueSlot({ children }: { children?: ReactNode }) {
  return (
    <div style={{
      width: '100%',
      height: 'auto', minHeight: HERO_VALUE_SLOT_MIN_PX,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 0, flexShrink: 0,
    }}>
      {children}
    </div>
  );
}

/** 확정값 대표 라인(data-testid="hero-primary", tabular hero). */
function HeroPrimaryLine({
  value, reduced, live = true, fitRef,
}: {
  value: string;
  reduced?: boolean;
  live?: boolean;
  fitRef: RefObject<HTMLSpanElement>;
}) {
  return (
    <span
      key={value}
      ref={fitRef}
      data-fit-group="value"
      data-testid="hero-primary"
      aria-live={live ? 'polite' : undefined}
      style={{
        fontSize: HERO_TYPE.value,
        fontWeight: 900,
        lineHeight: 1.04,
        color: T.text,
        letterSpacing: -2,
        fontVariantNumeric: 'tabular-nums',
        // 🔴 v0.47.0 W5ⓑ(민구 FB-F 확정 08-08) — **`textOverflow:'ellipsis'`를 제거했다.**
        //    민구 확정 원문(08-07, `heroLayout.ts` VOICE_TYPE.sheetDisplay 주석에 보존):
        //    *"축약(\"...\")을 금지하고 폭에 맞춰서 글자 크기를 조절하는걸로."*
        //    그 처방(FB-11/WP-9 `6d69165`)은 **ManualValueSheet 전용**이었고 hero는 빠져 있었다 —
        //    "여전히 축약된다"는 이번 제보의 1차 답이 그 누락이다(triage §중복·이력).
        //    🔑 넘침을 막는 것은 `useFitGroup`이고, ellipsis는 그 fit이 늦은 프레임에서
        //    **틀린 값을 그럴듯하게 그려 보이는 폴백**이었다(`29.9` → `29…`). 폴백을 지우면
        //    같은 프레임이 «잘린 글리프»로 남아 **오독이 아니라 결함으로 보인다** — 로그
        //    `font_render_echo`의 `ovX`/`txt`가 그 프레임을 잡는다(W5ⓐ).
        //    ⚠️ `overflow:'hidden'`은 남긴다. 지우면 넘친 글자가 hero 밖으로 흘러 칩존·밴드
        //    위에 겹쳐 그려진다(레이아웃 계약 파손 — 잘림보다 나쁘다).
        display: 'block', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden',
        wordBreak: 'normal',
        overflowWrap: 'normal',
        textAlign: 'center',
        animation: reduced ? undefined : 'chip-pop 320ms ease-out',
      }}
    >
      {value}
    </span>
  );
}

/** 미확정 인식 원문(FB#2) — "지금 이렇게 들었다(틀렸을 수 있음)"를 STT 원문 그대로 크게(56~72px).
 *  확정값(✓ + tabular 100px)과는 심볼(mic)·크기·흐린 톤으로 구분된다. */
function InterimLine({ value, fitRef }: { value: string; fitRef: RefObject<HTMLSpanElement> }) {
  return (
    <span
      data-testid="interim-value"
      ref={fitRef}
      data-fit-group="value"
      aria-label={`인식 중: ${value}`}
      style={{
        fontSize: HERO_TYPE.interim,
        fontWeight: 900,
        lineHeight: 1.06,
        color: T.text,
        opacity: 0.92,
        letterSpacing: -1.2,
        // 🟡 v0.47.0 W5ⓑ — **여기는 ellipsis를 남긴다**(확정 라인에서만 제거했다). 브리핑은 두
        //    라인 모두 제거를 지시했으나 **기존 계약과 충돌해 확정 라인으로 범위를 좁혔다.**
        //    ① 민구 제보(FB-F)는 *"중앙 숫자 … **확정 시에만**"* 이고 triage 실측도
        //       *"실시간(interim) 중은 정상"* 이다 — interim은 결함 대상이 아니다.
        //    ② `tests/v043-fit-group.spec.ts:333`이 *"무표식 잘림 금지"* 를 **긴 interim에 대해**
        //       명시적으로 단언한다: 하한(24px)에 닿고도 넘치는 STT 원문은 «…»로 손실을
        //       드러내야 한다는 계약이다. 그 계약은 **지금도 옳다** — 확정값은 짧은 숫자라
        //       fit이 항상 맞출 수 있지만, 인식 원문은 임의 길이라 맞출 수 없다.
        //    🔑 두 라인의 차이는 «내용 종류»다: 숫자는 잘리면 **다른 숫자로 오독**되고(29.9→29…),
        //       문장은 잘려도 «뒤가 더 있다»로 읽힌다. 같은 `--fit-value`를 공유하는 것은
        //       **배율**이지 넘침 표기 규칙이 아니다.
        //    → 범위 확대(interim도 제거) 판단은 `_ASK-implvisual.md` 🟡 #2에 올렸다.
        display: 'block', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        wordBreak: 'normal',
        overflowWrap: 'normal',
        textAlign: 'center',
      }}
    >
      {value}
    </span>
  );
}
