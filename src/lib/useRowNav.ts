/**
 * [ENV-12] Stage 3 서브 훅 #3 — **행 이동 계열 내비게이션**. `useVoiceSession`에 대한
 * 노출 표면 12개를 소유하는 진입점이며, 실제 구현은 두 층이다:
 *  · 행을 **고르는** 셋(행 점프 공유 코어 jumpToRow·gotoAdjacentRow + F13 goNextRow) — 이 파일.
 *  · 고른 자리에 **착지하는** 9종(announceEndReached·enterReviewWait·enterCellWait·
 *    announceOrCellWait·notify*PersistFailed + 재료 3) — `useRowLanding.ts`(r2-nearcap 분리).
 * 세션 컨텍스트는 여전히 `useVoiceSession`이 소유하므로 주입받는다(`useClipCapture`와 같은 계약).
 * ⚠️ 규범 이탈 자진 신고 — `awaitingFieldRef`·`epochRef`는 getter가 아니라 **ref 그대로** 받는다:
 * ①본체(handleFinal·advance)와 이 훅이 함께 읽고 쓰는 다중 기록자 조정 상태라 접근자 분해는
 * 간접층만 늘린다 ②소스 계약 스펙(r5-z2 ③④·r6-y3 ②·r4-m5 ③·prev-survey)이
 * `awaitingFieldRef.current =`·`epochRef.current` 바이트 형태를 잠근다. getter 전환 금지.
 * (그 스펙들의 소스 경로는 착지/이동에 따라 갈린다 — 착지 계약은 `useRowLanding.ts`를 읽는다.)
 */
import { useCallback, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { computeTotalRows } from './autoValue';
import { rowMarked } from './logEvents';
import { cancelTts } from './speech';
import type { Column } from '../types';
import { useRowLanding, type RowLandingDeps } from './useRowLanding';

export interface RowNavDeps extends RowLandingDeps {
  announceRowDiff: (fromRow: number | null, toRow: number) => Promise<void>;
  persistSession: () => Promise<boolean>;
  firstIncompleteColIdx: (row: number, vCols: Column[]) => number;
  isManualHoldBlocked: (reason: string) => boolean;
  epochRef: { current: number };
}

export function useRowNav(deps: RowNavDeps) {
  // 주입 deps를 ref로 받아 **노출 함수 identity를 영구 고정**한다(useClipCapture:57-63 계약 —
  // 반환 함수들이 본체 handleFinal 의존성에 들어가므로 identity가 흔들리면 STT 배선이 요동친다).
  const depsRef = useRef(deps);
  depsRef.current = deps;
  // [ENV-12 · r2-nearcap] 착지 계열 9종은 `useRowLanding`이 소유한다(그 헤더 참조). 아래 행 이동
  // 셋이 착지의 **호출부**이므로 의존은 한 방향(nav → landing)이고, 반환은 이 훅이 그대로 되돌려
  // 노출 표면 12개를 보존한다 — `useVoiceSession`의 destructure는 불변이다.
  // 🔴 identity: 착지 9종도 전부 `useCallback(..., [])` 고정이라, 아래 `[]`-고정 콜백이 초회 렌더의
  //   바인딩을 캡처해도 영원히 같은 함수다(분리 전 같은 파일 안에서 성립하던 성질 그대로).
  //   `deps`를 통째로 넘기는 것이 성립하는 근거는 `RowNavDeps extends RowLandingDeps`다.
  const {
    formatRowList, listEmptyRows, buildEndReachedTts, announceEndReached, enterReviewWait,
    enterCellWait, announceOrCellWait, notifyCellPersistFailed, notifyRowPersistFailed,
  } = useRowLanding(deps);
  // ── public: jump to a specific row (auto-chip change / 행 이동 공용) ──────
  const jumpToRow = useCallback(
    async (targetRow: number, options?: { setReturn?: boolean; source?: 'voice' | 'touch' }) => {
      const { voiceColsList, getSessionColumns, logCell, epochRef, awaitingFieldRef,
        isRowVoiceComplete, announceRowDiff, announceField, firstIncompleteColIdx } = depsRef.current;
      const sess = useSessionStore.getState();
      const vc = voiceColsList();
      const total = computeTotalRows(getSessionColumns());
      if (targetRow < 1 || targetRow > total) return;
      const cur = sess.activeRow;
      if (targetRow === cur) return;
      // 🔴 v0.49 r6 Y3(claude #3) — **행 이동 공유 코어에도 종료 가드를 건다.** Z2가 착지 넷을
      //   `armLanding`으로 모으며 stopping을 거절하게 했지만, 이 코어는 그 착지들의 **호출부**라
      //   가드 밖에 있었다: 거절은 착지에서 일어나고 그 **앞**의 `setReturn`·`setActiveRow`·
      //   `epoch` bump·`cancelTts`·행 낭독은 이미 다 실행된 뒤다. 종료 절차가 스냅샷을 뜨는
      //   동안 활성 행이 옮겨지면 `persistSession`의 `activeHasData` 판정이 다른 행을 본다.
      //   ⚠️ 형제 콜러 둘(`gotoAdjacentRow`:2117 · `goNextRow`)은 각자 이 가드를 갖고 있었고
      //     **공유 코어만 없었다** — 새 콜러(자동입력 칩 편집 → `computeRowFromAutoChange`)가
      //     그 사이로 들어온다. 가드를 콜러마다 복사하는 대신 코어에 둔다(Z2의 교훈).
      if (sess.phase === 'stopping') {
        logCell({ type: 'session', extra: `jump_refused:stopping:${cur}->${targetRow}` });
        return;
      }
      // v0.33.0 B-1 — 행 이동 attribution 오염 해소: 음성 '이전'/'다음' 경유 이동이 'touch:'로
      // 하드코딩되던 것을 source 파라미터화(pause/resume의 phase:<source> 패턴). extra 형태는
      // `<source>:<from>-><to>`로 유지해 기존 `touch:` 파서와 모양 호환.
      const source = options?.source ?? 'touch';
      logCell({ type: 'command', parsed: 'jump', extra: `${source}:${cur}->${targetRow}`, row: targetRow });
      // 🔴 v0.49 r6 Y8(claude #8) — **예약은 스택이다. 행 이동만 그걸 통째로 갈아엎고 있었다.**
      //   `setReturn`은 구현이 `returnStack: [{row, colIdx}]` — **전체 교체**다(sessionStore:333).
      //   그래서 P1 교차행 알람이 `pushReturn`으로 쌓아 둔 **바깥 예약**이, 그 사이 들어온 행
      //   이동('이전행'·자동칩 점프) 한 번에 사라졌다. v0.47.0-r3 codex f3가 「안쪽 출발점을
      //   버리지 않으려고」 스택으로 일반화한 바로 그 자료구조를, 형제 하나가 계속 단일 슬롯으로
      //   다뤘던 셈이다. 이제 **쌓는다** — 소비는 종전대로 `advance()`의 pop 하나뿐이라 LIFO가
      //   그대로 성립하고, 예약 없는 이동('다음행'의 `setReturn(null, null)`)은 스택을 비우는
      //   기존 의미 그대로다.
      //   ⚠️ 관측 차이는 좁다: 예약 목적지가 「떠나온 바로 아래 행」이면 자연 전진과 일치해
      //     교체든 push든 결과가 같다(m5 ⓓ가 증명한 성질). 갈리는 것은 **자연 전진과 다른 행을
      //     가리키는 예약**(= P1 중첩)이 함께 서 있을 때뿐이고, 그게 이 수정의 대상이다.
      if (options?.setReturn ?? true) sess.pushReturn(cur, sess.activeColIdx);
      sess.setActiveRow(targetRow);
      cancelTts();
      // v5.2: bump epoch so in-flight handleFinal's advance() guard aborts
      epochRef.current++;
      // 🔴 v0.49 r6 Y3(claude #7) — bump **직후** 값을 잡아 둔다(`gotoAdjacentRow` 경계 :2146의
      //   패턴). 아래 두 착지는 `await announceRowDiff(...)` **뒤**에 무장하는데, 그 안내 중
      //   barge-in 명령이 들어오면 그 핸들러가 이미 커서와 대기 상태를 옮긴 뒤다 — 낡은 좌표로
      //   재무장하면 사용자가 귀로 들은 대상과 실제 커밋 대상이 갈린다(무음도 오류도 아닌
      //   **정상처럼 보이는 오귀속**). 경계 둘은 fix49b #6에서 이미 이 가드를 받았고 공유 코어만
      //   빠져 있었다.
      const startEpoch = epochRef.current;
      awaitingFieldRef.current = null;
      // v0.33.0 백로그 A(민구 결정 3) — 완료 행 착지: 첫 필드 재안내(값 수신) 대신 "값 읽어주기+대기".
      // (기존 함정: firstIncompleteColIdx 폴백 0 → 첫 필드 재안내 → bare 값이 첫 항목만 덮어쓴 뒤
      //  advance가 returnRow로 튕겨 복귀 — 2번째 이후 항목은 음성으로 접근 불가.)
      if (isRowVoiceComplete(targetRow, vc)) {
        await announceRowDiff(cur, targetRow);
        if (epochRef.current !== startEpoch) return;
        await enterReviewWait(targetRow);
        return;
      }
      const targetCol = firstIncompleteColIdx(targetRow, vc);
      sess.setActiveCol(targetCol);
      sess.setRecognized('');
      // 검토 대기/종료 대기(phase 'complete')에서 미완료 행으로 이동한 경우에만 값 수신 상태로 복귀
      // ('paused' 등 다른 phase는 건드리지 않는다 — 일시정지 해제는 resume()만의 소관).
      if (sess.phase === 'complete') sess.setPhase('active');
      await announceRowDiff(cur, targetRow);
      if (epochRef.current !== startEpoch) return;
      if (vc[targetCol]) await announceField(vc[targetCol]);
    },
    [],
  );

  // ── public: move to the previous row (◀이전 버튼 + 음성 '이전' 공용 — v0.33.0 백로그 A 통일) ──
  // Review/edit semantics: jumpToRow(setReturn:true) so finishing the visited row returns the
  // flow to where the user was. (복귀 대상이 그 사이 완료되면 advance의 NAV-1 가드가 복귀를 차단.)
  // 완료 행 착지는 jumpToRow의 검토 대기(값 낭독 + 명령 대기)로 이어진다(민구 결정 3).
  // On a boundary we REPROMPT instead of silently stalling (REVIEW-4).
  const gotoAdjacentRow = useCallback(
    async (delta: -1, source: 'voice' | 'touch' = 'touch') => {
      const { isManualHoldBlocked, epochRef, say, voiceColsList, isRowVoiceComplete } = depsRef.current;
      const sess = useSessionStore.getState();
      if (sess.phase === 'stopping') return;
      // v0.34.0 리뷰 라운드2(Codex High) — manualHold 중엔 **모든 비해소 이동을 거부**한다.
      // STT만 막고 터치 이동을 열어두면 [확인]/[수정] 대기 중 [이전]을 눌러 미확인 이상치를
      // 우회할 수 있었다(announceField가 알람을 null로 지워 검증 절차 자체가 소멸).
      if (isManualHoldBlocked('prev')) return;
      const target = sess.activeRow + delta;
      cancelTts();
      if (target < 1) {
        epochRef.current++;
        // 🔴 v0.49 r5 Z2 — bump **직후** 값을 잡아 둔다(fix49b #6 패턴 — `gotoAdjacentField`
        //   경계 :2146의 복제). 이 분기는 `await say(...)` **뒤에** 재무장하는 지점이고,
        //   `advance()`는 그런 지점마다 재확인 가드를 둔다. F13/fix49가 이 두 경계를 만들 때
        //   bump만 복사하고 재확인을 빠뜨렸다(codex R4-F2가 지목한 세 경로 중 하나).
        const startEpoch = epochRef.current;
        const msg = '첫 행입니다.';
        useSessionStore.getState().setLastTts(msg);
        const vc = voiceColsList();
        await say(msg);
        // 🔴 경계 안내 중 barge-in이 들어오면 그 명령의 핸들러가 이미 커서와 대기 상태를 옮긴
        //   뒤다. 낡은 좌표로 재무장하면 사용자가 귀로 들은 대상과 실제 커밋 대상이 갈린다 —
        //   무음도 오류도 아닌 **정상처럼 보이는 오귀속**이라 시트에서만 뒤늦게 드러난다.
        //   ⚠️ 종료(stopping) 축은 이 가드가 **못 닫는다** — `stop()`은 epoch를 올리지 않는다.
        //     그쪽은 `armLanding`의 거절이 닫는다(그 헤더 참조). 두 축은 별개다.
        if (epochRef.current !== startEpoch) return;
        // v0.33.0 — 첫 행이 이미 완료면(검토 대기 중 '이전' 등) 값 수신 재안내 대신 검토 대기 재무장
        // (announceField는 bare 값 커밋을 열어 결정 3의 덮어쓰기 금지 계약을 깬다).
        if (isRowVoiceComplete(sess.activeRow, vc)) {
          await enterReviewWait(sess.activeRow);
          return;
        }
        // 🔴 v0.49 fix49(_ASK-fix49 Q1 — Larry 승인 08-12) — 행이 **미완료**여도 커서가 값 있는
        //   셀에 서 있을 수 있다. 그 조합은 F-1 이전엔 도달 불가였다(activeColIdx 기록자 전량이
        //   빈 칸/cascade clear된 칸만 가리켰다) — 항목 이동이 커서를 filled 셀에 **주차**시킬 수
        //   있게 되면서 이 낡은 줄이 B-1과 같은 문이 됐다. 실측 3발화로 재현·확인했다
        //   (35.1 → 「이전」 주차 → 1행에서 「이전행」 → 경계 → "99.9" → 셀이 99.9).
        const cur = vc[sess.activeColIdx];
        if (cur) await announceOrCellWait(cur);
        return;
      }
      await jumpToRow(target, { setReturn: true, source });
    },
    [],
  );

  // ── v0.44.0 §C8 F13(민구 확정 08-02): '다음' = '이전'과 대칭인 **항상 +1 이동** ──────────
  // v0.5.0 NAV-1이 여기 두었던 「findNextIncompleteRow로 완료 행 건너뛰기」를 제거했다 —
  // 실기기 로그 실측(08-02)에서 '다음'의 jump delta가 +2·+4로 튀던 원인이 그 건너뛰기다.
  // (findNextIncompleteRow 자체는 advance()의 행 완료 자동 전진에 남아 있다 — F13의 대상 아님.)
  //
  // 🔴 NAV-1 무한루프 방지 계약의 **대체 = 「마지막 행에서 멈춤」**:
  //   · returnRow 미등록(setReturn(null))은 그대로다 — 완료 행 자동 복귀 경로 자체가 없다.
  //   · 전진은 항상 아래로 +1, 마지막 행에서는 이동 없이 재안내만 한다(무음 금지 REVIEW-4 —
  //     gotoAdjacentRow의 '첫 행입니다' REPROMPT와 대칭). wrap-around가 없으므로 완료 행
  //     재프롬프트 루프(NAV-1)는 여전히 구조적으로 불가능하다.
  //   · 완료 행 착지는 jumpToRow의 검토 대기(enterReviewWait — 값 낭독+명령 대기)가 받는다.
  //     값 수신 재프롬프트가 아니므로 NAV-1의 「완료 행 재프롬프트」도 부활하지 않는다.
  //   · 이 경계 멈춤이 구 [EXIT-REACH-1] 분기(완료 행 검토 중 '다음'의 announceEndReached 재발화
  //     방지)를 흡수한다: '다음'은 더 이상 announceEndReached를 부르지 않는다 — 끝 도달 전환은
  //     advance()(행 완료)와 종료 명령의 소관이다.
  // skip 개념(값 없이 지나간 행 = complete:false placeholder)은 유지 — **실제로 행을 떠날 때만**
  // 마킹한다(경계 멈춤은 이동이 아니므로 마킹하지 않는다).
  // 오라클: tests/v0440-c8-flow.spec.ts (jump delta 전 구간 ±1 · 경계 멈춤 · skip placeholder).
  const goNextRow = useCallback(async (source: 'voice' | 'touch' = 'touch') => {
    const { isManualHoldBlocked, voiceColsList, getSessionColumns, epochRef, logCell, say, isRowVoiceComplete, persistSession } = depsRef.current;
    if (useSessionStore.getState().phase === 'stopping') return;
    // v0.34.0 리뷰 라운드2(Codex High) — manualHold 중 행 이동 거부(위 gotoAdjacentRow와 동일 근거:
    // [다음]으로 미확인 이상치를 남긴 채 다음 행으로 새어나가던 경로).
    if (isManualHoldBlocked('next')) return;
    const sess = useSessionStore.getState();
    const vc = voiceColsList();
    const total = computeTotalRows(getSessionColumns());
    cancelTts();
    epochRef.current++; // in-flight advance/안내 체인 무효화 (RACE-1 패턴 유지)
    // 🔴 v0.49 r5 Z2 — bump 직후 값을 잡아 둔다(fix49b #6 패턴 :2146 복제). 아래 마지막 행
    //   경계가 `await say(...)` 뒤에 재무장하는 지점이다 — 근거는 `gotoAdjacentRow`의 첫 행
    //   경계에 붙인 같은 가드의 주석(두 경계는 대칭이므로 처리도 대칭이다).
    const startEpoch = epochRef.current;
    sess.setReturn(null, null);
    const row = sess.activeRow;
    if (row >= total) {
      // F13 — 마지막 행 경계: 멈춘다. 완료 행이면 검토 대기 재무장(값 재낭독), 미완료면 현재
      // 필드 재안내(둘 다 무음 금지). endReached 전환 없음 — 종료는 '종료' 명령/버튼만.
      logCell({
        type: 'command', parsed: 'nextRow', extra: rowMarked('row_last_stop', row, source),
        row,
      });
      const msg = '마지막 행입니다.';
      sess.setLastTts(msg);
      await say(msg);
      // 🔴 v0.49 r5 Z2 — 경계 안내 뒤 재확인(위 bump 지점 주석 참조). 종료(stopping) 축은
      //   `armLanding`이 닫는다 — `stop()`은 epoch를 올리지 않으므로 이 가드로는 못 닫는다.
      if (epochRef.current !== startEpoch) return;
      if (isRowVoiceComplete(row, vc)) {
        await enterReviewWait(row);
        return;
      }
      // 🔴 v0.49 fix49b(max 리뷰 #2) — 미완료 행이어도 **커서가 값 있는 칸에 서 있을 수 있다.**
      //   `gotoAdjacentRow`의 첫 행 경계(:1633)가 fix49에서 정확히 같은 이유로 전환됐다 —
      //   두 경계는 대칭이므로 처리도 대칭이어야 한다(한쪽만 고치면 '이전행'은 안전하고
      //   '다음행'은 값을 잃는, 사용자가 예측할 수 없는 비대칭이 남는다).
      const cur = vc[sess.activeColIdx];
      if (cur) await announceOrCellWait(cur);
      return;
    }
    if (!isRowVoiceComplete(row, vc)) {
      sess.markRowSkipped(row);
      logCell({
        type: 'command', parsed: 'nextRow', extra: rowMarked('row_skipped', row, source),
        row,
      });
      void persistSession(); // skip 즉시 영속화 — 데이터탭에 빈 행 placeholder가 바로 보이도록
    } else {
      // v0.33.0 B-3 — 완료 행에서의 '다음' 이동도 기록(이전엔 skip 시에만 로깅 → 이동 공백).
      logCell({
        type: 'command', parsed: 'nextRow', extra: rowMarked('row_complete', row, source),
        row,
      });
    }
    // 완료 행 착지는 jumpToRow가 검토 대기로, 미완료 행 착지는 첫 미완료 필드 안내로 처리한다.
    await jumpToRow(row + 1, { setReturn: false, source });
  }, []);
  return { formatRowList, listEmptyRows, buildEndReachedTts, announceEndReached, enterReviewWait,
    enterCellWait, announceOrCellWait, notifyCellPersistFailed, notifyRowPersistFailed, jumpToRow, gotoAdjacentRow, goNextRow };
}
