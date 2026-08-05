import { useEffect, useRef, useState } from 'react';
import { T } from '../../tokens';
import { COMPLETE_RECEIPT_BASE_FONT_PX, COMPLETE_SUMMARY_BASE_FONT_PX, STATE_TYPE } from './heroLayout';
import { useFitGroup } from './useFitGroup';

/** 마지막 커밋 영수증을 완료 화면에 띄워 두는 시간(민구 확정 2026-07-25).
 *  이후에는 와이어프레임 §[4] 그대로(요약 + 종료 버튼)로 정착한다. */
export const COMPLETE_RECEIPT_MS = 3000;

/** 조사 전체가 끝났을 때 중앙 요약.
 *
 * ```
 *              16 / 18
 * ```
 *  - `X / N` — X는 **실제로 값이 채워진 행 수**다. '다음' 스킵·샘플손실로 못 넣은 행은
 *    빠지므로 항상 N 이하다(sessionStore: `markRowComplete`가 완료 행만 `completedRows`에 넣고
 *    스킵 행은 `skippedRows`로 갈라 둔다 — 두 목록은 서로 배타적이다).
 *  - 🔴 **중앙 `종료` 버튼은 없다** (v0.44.0 §C3, F15·F21 — 민구 확정 08-02).
 *    하단 ⏹(`voice-status-control[data-status="exit"]`)과 완전히 같은 동작의 중복이었다.
 *    와이어프레임 §[4]의 "요약+종료버튼" 재설계(v0.37.0)가 v0.33.0 FB#4의 삭제 결정을
 *    덮어쓴 재발 사례다(W2 §3-2) — **여기 버튼을 되살리지 마라.** 종료 진입은 하단이 유일하다.
 *
 *  범위 밖(보고 대상): "데이터탭 업로드는 종료 버튼 활성 이후에만 가능"은 DataScreen의 업로드
 *  게이트라 입력화면 UI가 아니다 — 이번 라운드에서 구현하지 않았다. */
export function CompleteSummary({
  completedCount, totalRows, reviewCommit,
}: {
  completedCount: number;
  totalRows: number;
  /** v0.37.0 리뷰#1(민구: 커밋 영수증) — 마지막으로 확정된 셀.
   *
   *  **왜 와이어프레임 §[4]에 없는 요소를 그리나:** 마지막 행의 마지막 셀을 채우는 순간이 곧 끝
   *  도달이라, 이 줄이 없으면 사용자가 방금 넣은 값을 화면에서 **한 번도 확인하지 못한 채** 완료
   *  화면으로 넘어간다(수동 입력·이상치 정정 경로에서 특히 위험 — 그 오표시를 잡으려고 만든 계약).
   *
   *  **민구 확정(2026-07-25): 3초만 보여주고 와이어프레임대로 전환한다.** 값 확인 기회는 주되
   *  완료 화면의 최종 형태는 §[4] 그대로 두는 절충이다. */
  reviewCommit: { name: string; value: string } | null;
}) {
  // 3초 뒤 영수증을 걷는다. `reviewCommit`이 바뀌면(다른 값으로 재확정) 타이머를 다시 건다.
  // 언마운트·값 변경 시 정리해 좀비 타이머가 남지 않게 한다(ActiveControlSteppers의 미정리 타이머가
  // 리뷰 지적으로 남아 있는 상태라 같은 실수를 반복하지 않는다).
  const [receiptVisible, setReceiptVisible] = useState(true);
  useEffect(() => {
    if (!reviewCommit) return;
    setReceiptVisible(true);
    const t = setTimeout(() => setReceiptVisible(false), COMPLETE_RECEIPT_MS);
    return () => clearTimeout(t);
  }, [reviewCommit]);
  const showReceipt = reviewCommit !== null && receiptVisible;

  const countFitRef = useRef<HTMLSpanElement>(null);
  const receiptFitRef = useRef<HTMLSpanElement>(null);
  // UI-c 규칙 1: 시각 상태어를 지운 폭은 완료 수치가 가져간다. 고정 px 상한을 올리는 대신
  // 실제 중앙 영역과 `X / N` 렌더 폭을 읽어 열린 배율을 찾는다(GL-007 원칙 2·4).
  //
  // 🔴 v0.46.0 WP-B — 영수증도 같은 계약으로 끌어온다(민구 확정 08-05, 안 (a)).
  //  그룹 배열 **순서가 우선순위**다: `X / N`(주 정보)이 먼저 공간을 가져가고 영수증이 뒤를 받는다.
  const fitRef = useFitGroup<HTMLDivElement>(
    [completedCount, totalRows, reviewCommit?.value, showReceipt],
    [
      {
        variable: '--fit-summary',
        members: [countFitRef],
        searchBasePx: COMPLETE_SUMMARY_BASE_FONT_PX,
      },
      {
        variable: '--fit-receipt',
        members: [receiptFitRef],
        searchBasePx: COMPLETE_RECEIPT_BASE_FONT_PX,
      },
    ],
  );
  return (
    <div
      ref={fitRef}
      data-testid="complete-summary"
      role="status"
      aria-live="polite"
      aria-label={`조사 완료, 전체 ${totalRows}행 중 ${completedCount}행 입력됨`}
      style={{
        width: '100%', maxWidth: 'min(560px, 94vw)',
        height: '100%', maxHeight: '100%', minHeight: 0, overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 'max(10px, calc(clamp(14px, 2.6vh, 28px) * var(--fit-lo, 1)))',
        textAlign: 'center',
      }}
    >
      {showReceipt && reviewCommit && (
        <span
          ref={receiptFitRef}
          data-testid="complete-receipt"
          data-fit-group="receipt"
          aria-label={`${reviewCommit.name} ${reviewCommit.value} 입력됨`}
          style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '0.3em',
            // 🔴 `maxWidth`가 아니라 `width: 100%`다 — `maxWidth`만 두면 박스가 잉크에 딱 붙는
            //    shrink-to-fit이 되어 **넘침 경계가 잉크와 함께 움직여** 이진탐색이 상한을 못
            //    찾는다(`AnomalyAlertPopup.tsx:191-194`가 같은 이유로 같은 처방을 쓴다).
            width: '100%', maxWidth: '100%',
            color: T.textDim,
            // 🔴 인라인 하드코딩에서 상수 계층으로 승격 + 26px 고정 상한 삭제(v0.46.0 WP-B).
            fontSize: STATE_TYPE.completeReceipt,
            fontWeight: 850,
            lineHeight: 1.1,
            letterSpacing: -0.3,
            wordBreak: 'keep-all',
          }}
        >
          <span aria-hidden style={{ color: T.green }}>✓</span>
          <span>{reviewCommit.name}</span>
          <span data-testid="complete-receipt-value" style={{ color: T.text, fontVariantNumeric: 'tabular-nums' }}>
            {reviewCommit.value}
          </span>
        </span>
      )}
      <span
        ref={countFitRef}
        data-testid="complete-count"
        data-fit-group="summary"
        style={{
          fontSize: STATE_TYPE.completeSummary,
          fontWeight: 900,
          lineHeight: 1.05,
          letterSpacing: -1.2,
          color: T.text,
          fontVariantNumeric: 'tabular-nums',
          display: 'block', width: '100%', maxWidth: '100%',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          textAlign: 'center',
        }}
      >
        {completedCount} / {totalRows}
      </span>
    </div>
  );
}
