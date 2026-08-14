/**
 * [ENV-12] Stage 3 서브 훅 #3 — **행 이동 계열 내비게이션**(구획 3개의 순수 이동):
 * end-of-table 착지 계열(announceEndReached·enterReviewWait·enterCellWait·announceOrCellWait·
 * notify*PersistFailed) + 행 점프 공유 코어(jumpToRow·gotoAdjacentRow) + F13 goNextRow.
 * 세션 컨텍스트는 여전히 `useVoiceSession`이 소유하므로 주입받는다(`useClipCapture`와 같은 계약).
 * ⚠️ 규범 이탈 자진 신고 — `awaitingFieldRef`·`epochRef`는 getter가 아니라 **ref 그대로** 받는다:
 * ①본체(handleFinal·advance)와 이 훅이 함께 읽고 쓰는 다중 기록자 조정 상태라 접근자 분해는
 * 간접층만 늘린다 ②소스 계약 스펙(r5-z2 ③④·r6-y3 ②·prev-survey W3-10)이
 * `awaitingFieldRef.current =`·`epochRef.current` 바이트 형태를 잠근다. getter 전환 금지.
 */
import { useCallback, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { computeTotalRows } from './autoValue';
import { playBeep } from './beep';
import { useCellPersistError } from './cellPersistError';
import { rowMarked } from './logEvents';
import type { logger } from './logger';
import { cancelTts, formatForTts } from './speech';
import type { Column } from '../types';
import type { AwaitingField } from './useVoiceSession';
import { endReachedTts } from './voicePrompts';

type LogCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>) => void;

export interface RowNavDeps {
  logCell: LogCell;
  say: (text: string) => Promise<boolean>;
  armLanding: (opts: { reason: string; phase: 'active' | 'complete'; endReached?: boolean }) => boolean;
  announceField: (col: Column) => Promise<void>;
  announceRowDiff: (fromRow: number | null, toRow: number) => Promise<void>;
  persistSession: () => Promise<boolean>;
  getSessionColumns: () => Column[];
  voiceColsList: () => Column[];
  isRowVoiceComplete: (row: number, vCols: Column[]) => boolean;
  firstIncompleteColIdx: (row: number, vCols: Column[]) => number;
  isManualHoldBlocked: (reason: string) => boolean;
  awaitingFieldRef: { current: AwaitingField | null };
  epochRef: { current: number };
}

export function useRowNav(deps: RowNavDeps) {
  // 주입 deps를 ref로 받아 **노출 함수 identity를 영구 고정**한다(useClipCapture:57-63 계약 —
  // 반환 함수들이 본체 handleFinal 의존성에 들어가므로 identity가 흔들리면 STT 배선이 요동친다).
  const depsRef = useRef(deps);
  depsRef.current = deps;
  // (이동 커밋 한정 임시 배선 — 다음 수정 커밋에서 콜백 내부 destructure로 전환한다.)
  const {
    logCell, say, armLanding, announceField, announceRowDiff, persistSession, getSessionColumns,
    voiceColsList, isRowVoiceComplete, firstIncompleteColIdx, isManualHoldBlocked, awaitingFieldRef, epochRef,
  } = depsRef.current;

  /** "3행, 7행" 식 행 목록 포맷. 목록이 길면 TTS가 늘어지므로 3개 + "외 N개 행"으로 요약. */
  const formatRowList = (rows: number[]): string =>
    rows.length <= 5
      ? rows.map((r) => `${r}행`).join(', ')
      : `${rows.slice(0, 3).map((r) => `${r}행`).join(', ')} 외 ${rows.length - 3}개 행`;

  const listEmptyRows = (total: number, vCols: Column[]): number[] => {
    const out: number[] = [];
    for (let r = 1; r <= total; r++) {
      if (!isRowVoiceComplete(r, vCols)) out.push(r);
    }
    return out;
  };

  /** 끝 도달 안내(확정표 #5+6 통합) — **트리거 두 곳이 이 한 줄을 공유한다**(`announceEndReached`
   *  진입 · atEnd 값 흡수). 종전엔 두 곳이 서로 다른 문구를 인라인으로 들고 있었다.
   *  🔴 완료 행 수는 **화면 `X / N`의 X와 같은 출처**(`completedRows.length`)를 쓴다 —
   *  `total - empties.length`로 새로 세면 부분 입력·스킵 처리에서 화면과 갈린다(§2 의미 동등). */
  const buildEndReachedTts = (empties: number[]): string => endReachedTts(
    useSessionStore.getState().completedRows.length,
    empties.length > 0 ? formatRowList(empties) : null,
  );

  /** v0.23.0 입력탭#4(민구 결정 — "안내 후 대기"): 마지막 행 너머에 더 갈 곳이 없어도 **자동 종료하지
   *  않는다**. 빈 행이 있으면 함께 안내하고, 어느 경우든 안내 후 세션을 active로 유지한다.
   *  🔴 v0.49 r2 A13(codex F6) — 이 자리의 종전 서술 *"어느 경우든 「종료하려면 '종료' 또는 종료
   *  버튼」 안내 후"* 는 **현행과 반대다**: W2(확정표 #5+6)가 그 종료 꼬리를 삭제했다(종료 수단은
   *  하단 ⏹과 '종료' 명령으로 상시 노출되므로 매번 되풀이하지 않는다). 문구의 정본은
   *  `voicePrompts.endReachedTts`이고, 바이트는 v023-voice B4·a1-atend-row가 전체 일치로 잠근다.
   *  awaiting을 마지막 음성 필드에 atEnd 센티넬로 둬서 '종료'/'수정' 등 명령은
   *  계속 dispatch되되(handleFinal `if(!awaiting) return` 게이트 통과), 일반 값 발화는 atEnd 가드가
   *  새 행 커밋 대신 종료 재안내로 흡수한다. 종료는 '종료' 음성 명령 또는 종료 버튼으로만 일어난다. */
  const announceEndReached = useCallback(async () => {
    const sess = useSessionStore.getState();
    // 🔴 v0.49 r5 Z2 — 착지 리셋 4종 + `endReached`는 `armLanding`이 소유한다(그 헤더 참조).
    //   v0.47.0 W2(FB-G①, 실기기 08-08)의 「종단 착지에서 수정 표시 명시 해제」도 그 안에 있다 —
    //   해제 유일 지점이 announceField뿐이라 마지막 행을 수정으로 마감하면 완료 화면까지 amber가
    //   고착됐던 그 계약이다. `endReached: true`가 phase 전이와 **한 쌍으로** 나간다.
    //   ⚠️ 종료 중이면 여기서 끝난다 — 센티넬도 완료 화면도 열지 않는다.
    if (!armLanding({ reason: 'end_reached', phase: 'complete', endReached: true })) return;
    const vc = voiceColsList();
    const total = computeTotalRows(getSessionColumns());
    const empties = listEmptyRows(total, vc);
    const lastCol = vc[vc.length - 1] ?? null;
    // 🔴 v0.49 r3 #2(claude r2 HIGH) — **커서를 센티넬 컬럼에 주차한다 — 한 상태에 커서는 하나다.**
    //   A1이 센티넬의 행 축을 `activeRow`로 고쳤지만 컬럼 축은 「마지막 음성 필드」로 고정돼 있고,
    //   `advance()`의 전진 스캔은 **커서를 옮기지 않은 채** 끝 도달로 떨어질 수 있다(뒤 칸이 전부
    //   차 있으면 while이 `vc.length`까지 가고 `activeColIdx`는 그대로다 — 셀 검토 중 '유지' 등).
    //   그러면 화면 활성 칩은 앞 컬럼인데 센티넬 `colId`는 마지막 컬럼이라, bare '수정'이
    //   **사용자가 만진 적 없는 확정 셀**을 비우고(소비자 전부가 `a.colId`를 읽는다: enterModifyMode ·
    //   cmdModify · cmdKeep · 명령 클립 키) 항목 이동만 `activeColIdx`를 본다 — 한 상태 두 커서.
    //   ⚠️ **반대 방향(센티넬을 `activeColIdx`로)은 안 된다.** atEnd의 bare '수정'은 `reviewTarget`이
    //   서지 않아(:2335가 atEnd를 제외한다) `clearEnd = vc.length` **행 스코프**로 지운다 —
    //   앞 컬럼을 타깃으로 삼으면 「첫 항목부터 행 끝까지 —」, 정확히 [MODIFY-TARGET-1]이 닫은
    //   그 증상이 되살아난다. 그래서 화면을 센티넬에 맞춘다(센티넬 컬럼 계약은 불변).
    //   오라클: tests/v049-r3-02-atend-cursor.spec.ts
    if (lastCol) sess.setActiveCol(vc.length - 1);
    // 명령 컨텍스트 유지용 atEnd 센티넬(마지막 음성 필드). 값 커밋은 handleFinal의 atEnd 가드가 차단.
    // 🔴 v0.49 r2 A1(리뷰 합집합 C1) — **행은 `total`이 아니라 `activeRow`다.** 끝 도달은 「아래로
    //   미완료 행이 없다」는 뜻일 뿐 「마지막 행에 서 있다」는 뜻이 아니다(`findNextIncompleteRow`는
    //   아래 방향만 본다 — 위쪽 미완료 행은 `empties`로 남는다). 순서 밖으로 완주하면(3행 먼저 →
    //   되돌아와 2행) 사용자는 2행에 서 있는데 센티넬만 3행을 가리켰고, 이 센티넬을 `a.row`로 읽는
    //   소비자 전부가 **다른 행**을 만졌다: bare '수정'(enterModifyMode :1256)과 "수정 <컬럼명>"
    //   (cmdModify :2204)이 3행의 칸을 지우고 `markRowIncomplete(3)`로 **완료 행을 미완료로 되돌렸고**,
    //   '유지'(:2127)는 다른 행 값을 읽고, 명령 클립(preserveCommandClip :2172·armClipForCell :2181)은
    //   틀린 셀 키로 저장됐다(D1/CLIP-CMD가 막으려던 orphan 형태). 순서대로 채운 경우엔
    //   `activeRow === total`이라 로그 `row=` 바이트도 종전과 동일하다 — 갈리는 것은 순서 밖뿐이다.
    //   ⚠️ 컬럼 축은 그대로다([MODIFY-TARGET-1] — 센티넬 컬럼 = 마지막 음성 필드).
    //   오라클: tests/v049-r2-a1-atend-row.spec.ts
    awaitingFieldRef.current = lastCol
      ? { kind: 'atEnd', row: sess.activeRow, colId: lastCol.id, name: lastCol.name }
      : null;
    sess.setRecognized('');
    // (phase='complete' + endReached=true는 위 `armLanding`이 세웠다.) phase 'complete'는 hero를
    // 정적 대기 라벨("N행 완료 — 명령 대기", v0.34.0 A4)로 둬 마지막 컬럼이 '듣는 중'처럼 보이는
    // 오해를 막는다. STT는 계속 돌아 '종료'/'수정' 음성 명령이 처리되되(handleFinal는 paused만
    // 게이트) early-commit(active 전용)은 멈춘다. 종료는 '종료' 음성·종료 버튼만.
    // `endReached=true`는 조사 완료 화면(UI-c: 시각 상태어 없는 `X / N` + 종료 버튼)의 유일한
    // 진입점이다 — 완료 행 검토 대기(enterReviewWait)는 같은 phase지만 [1] active 레이아웃을 쓴다.
    const msg = buildEndReachedTts(empties);
    sess.setLastTts(msg);
    logCell({
      type: 'session',
      extra: empties.length > 0 ? `end_reached_waiting:empty=${empties.join(',')}` : 'end_reached_waiting',
    });
    await say(msg);
  }, [armLanding, say]);

  // ── v0.33.0 백로그 A(민구 결정 3): 완료 행 착지 → "값 읽어주기 + 명령 대기" ─────
  /** 완료 행에 착지('이전' 음성/◀ 버튼/행 점프)하면 그 행의 음성입력 기록값을 TTS로 읽어주고
   *  명령 대기 상태로 둔다. awaiting은 reviewWait 센티넬(v0.34.0 A3: 그 행 **포인터=첫 음성 필드**.
   *  이전엔 마지막 필드였는데, 실기기 피드백 "포인터가 자동으로 마지막 값으로 이동 — 첫 항목값은
   *  수동 입력 외 수정 불가"로 첫 컬럼 착지로 전환. bare '수정'은 포인터 컬럼, "수정 <컬럼명>"으로
   *  다른 컬럼 지목 가능 — handleFinal modify 분기 참조)로 무장 —
   *  명령('수정'/'유지'/'다음'/'이전'/'종료' 등)은 계속 dispatch되되, bare 값 발화는 handleFinal의
   *  reviewWait 가드가 흡수한다(덮어쓰기 금지 — 수정은 '수정' 명령으로만). phase='complete'로 둬
   *  착지 필드가 '듣는 중'처럼 보이지 않게 하고 early-commit(active 전용)도 함께 멈춘다(atEnd 패턴). */
  const enterReviewWait = useCallback(async (row: number) => {
    const sess = useSessionStore.getState();
    // 🔴 v0.49 r5 Z2 — 착지 리셋 4종 + `endReached`는 `armLanding`이 소유한다(그 헤더 참조).
    //   v0.47.0 W2(FB-G①)의 「검토 대기 진입도 종단 착지 = 수정 표시 명시 해제」가 그 안에 있다 —
    //   검토 출신 수정("수정 88.9" 직접값 등)이 여기로 복귀할 때의 잔존 방지.
    //   `endReached: false`는 와이어프레임 §[4] 대비다: 검토 대기는 '조사 완료'가 아니다(끝 도달
    //   후 '이전'으로 되돌아온 경우까지 포함해 명시적으로 내린다). [1] active 레이아웃 + hero ✓.
    if (!armLanding({ reason: 'review_wait', phase: 'complete', endReached: false })) return;
    const vc = voiceColsList();
    const values = sess.getRowValues(row);
    const parts = vc
      .filter((c) => (values[c.id] ?? '') !== '')
      .map((c) => `${c.name} ${formatForTts(values[c.id])}`);
    const firstCol = vc[0] ?? null;
    sess.setActiveCol(0);
    sess.setRecognized('');
    awaitingFieldRef.current = firstCol
      ? { kind: 'reviewWait', row, colId: firstCol.id, name: firstCol.name }
      : null;
    // v0.34.0 A3 계측(D11c) — 검토 대기 진입은 이전까지 무로깅이라 실기기 분석에서 착지 컬럼을
    // 재구성할 수 없었다. 기존 command 타입 재사용(신규 LogEntry type 없음 — log-replay 호환).
    logCell({
      type: 'command', parsed: 'review_wait', extra: `review_wait:row=${row},col=first`,
      row, ...(firstCol ? { colId: firstCol.id } : {}),
    });
    const msg = `${row}행 완료됨. ${parts.join(', ')}.`;
    sess.setLastTts(msg);
    await say(msg);
  }, [armLanding, say]);

  // ── 🔴 v0.49 fix49(리뷰 B-1 blocker): 값이 든 셀 착지 → "값 읽어주기 + 명령 대기" ─────
  /** 항목 이동(`gotoAdjacentField`)·행 경계 재안내가 **이미 값이 있는 셀**에 커서를 세울 때의
   *  착지 처리. `announceField`를 부르면 그 셀에 `kind:'value'`가 열려 **뒤이은 bare 숫자가
   *  확정된 값을 조용히 덮는다** — 이 앱은 커밋 지점(`setRowValue`)에 셀 단위 거절 게이트가
   *  없어서, 「커서를 filled 셀 위에 `kind:'value'`로 세우지 않는다」가 유일한 방어선이다.
   *
   *  의미론은 완료 행 착지(`enterReviewWait`, v0.33.0 결정 3)와 **같다** — 값을 낭독하고
   *  명령을 기다린다. 다른 것은 스코프(행→셀)와, 그래서 **이동을 막지 않는다**는 점이다.
   *
   *  🔴 **문구를 reviewWait/atEnd와 공유하지 마라.** 이 앱은 안내 문구를 계약으로 다룬다
   *  (v0.47.0 V-FIX4): 셀 하나에 대고 "행 완료됨"/"입력이 끝났습니다"라고 하면 사용자는
   *  있지도 않은 상태를 찾는다(F-1 마지막 커밋 `18776ca`가 atEnd를 가른 것과 같은 이유).
   *  ⚠️ 문구를 늘리지 마라 — [TTS-WATCHDOG-1]에서 긴 발화일수록 절단률이 단조 증가한다.
   *
   *  phase는 `active` 그대로 둔다(reviewWait과 다른 점). 이 행은 아직 진행 중이라
   *  `complete`로 내리면 히어로 ✓·레이아웃이 「조사 완료」로 바뀐다. 대신 조기확정(early-commit)은
   *  `handleInterim`의 kind 게이트가 명시적으로 막는다 — phase에 기대지 않는다.
   *  오라클: tests/v049-fix49-cell-guard.spec.ts ①②⑥
   *  (v0.49 r2 — 종전 이 줄이 지목하던 `v049-fix49-nav-guards.spec.ts`는 **실재한 적이 없다**.
   *   ①②⑥은 cell-guard의 항목 번호와 정확히 대응한다.) */
  const enterCellWait = useCallback(async (col: Column, value: string) => {
    const sess = useSessionStore.getState();
    const row = sess.activeRow;
    // 🔴 v0.49 r5 Z2 — 착지 리셋 4종은 `armLanding`이 소유한다(그 헤더 참조). 여기 있던
    //   `setPhase('active')`(r4 M8)는 위 헤더의 *"phase는 `active` 그대로 둔다"* 를 선언에서
    //   집행으로 바꾼 줄이었다 — 행 경계 착지는 검토/끝 도달 국면에서 들어올 수 있어
    //   'complete'가 남으면 `CenterStage`의 `completing` 게이트가 거절 큐를 억제해 비프만 남는다.
    //   `clearAnomalyAlert`(fix49b #14)도 같은 묶음이다: 「빈 칸에 착지하면 팝업이 사라지고 값
    //   있는 칸에 착지하면 남는」 비대칭을 없앤 v0.9.0 계약의 세 번째 착지 지점.
    if (!armLanding({ reason: 'cell_wait', phase: 'active' })) return;
    sess.setRecognized('');
    awaitingFieldRef.current = {
      kind: 'cellWait', row, colId: col.id, name: col.name, previousValue: value,
    };
    logCell({
      type: 'command', parsed: 'cell_wait', extra: `cell_wait:${col.id}`,
      row, colId: col.id,
    });
    // "횡경 기록값 35.1." — 「기록값」이 이 상태의 판별어다(안내 프롬프트 "횡경."과 구분되고,
    //   행 검토의 "N행 완료됨"과도 겹치지 않는다). 흡수 안내가 정정 진입로를 가르친다.
    const msg = `${col.name} 기록값 ${formatForTts(value)}.`;
    sess.setLastTts(msg);
    await say(msg);
  }, [armLanding, say]);

  /** 착지 셀의 현재 값(음성 컬럼) — 있으면 cellWait, 없으면 종전 `announceField`. */
  const announceOrCellWait = useCallback(async (col: Column) => {
    const v = useSessionStore.getState().getRowValues(useSessionStore.getState().activeRow)[col.id] ?? '';
    if (v !== '') { await enterCellWait(col, v); return; }
    await announceField(col);
  }, [announceField, enterCellWait]);

  /** v0.47.0 C-FIX2 — 셀 영속 실패 고지(수동·터치 공통 · manualHold 실패 처리와 대칭 목적).
   *  경고 트릴 + 발화 — 현장은 폰을 2~3m 떨어뜨려 둬 화면을 못 본다(PRINCIPLES §2).
   *  🟡 값은 화면에 남긴다(manualHold의 롤백과 다른 선택): 그쪽 롤백은 pending 태그 없는
   *  후보가 reload에 확정처럼 보이는 반쪽 상태를 막는 장치고, 여기는 검증을 통과한 값의
   *  내구화만 실패한 경우다 — 지우면 입력이 유실되고, 남기면 재시도가 그 값을 그대로 쓴다.
   *  근거는 산출물 리뷰 대응 절에.
   *  C-FIX2b(2차 재검증) — 소리·발화는 순간이라 놓칠 수 있다: **지속 배너 + 명시 재시도**를
   *  함께 세운다(cellPersistError.arm → VoiceScreen이 CellPersistErrorBanner 렌더 · [다시 저장]
   *  = commitManualValue 재실행 → 성공 시 원래 커밋 플로우 전체 재개). 기존 persistError는
   *  stop 전용 의미론(성공 재시도 = 세션 종료)이라 셀 스코프 변형 — 근거는 cellPersistError.ts.
   *  ⚠️ v0.49 r6 Y1 — 정의 위치만 옮겼다(종전 `commitTouchValue` 바로 위). 행 완료 부기의
   *   durable 실패도 같은 배너로 고지해야 하는데(아래 `notifyRowPersistFailed`), 그 소비자가
   *   `finalizeRowCompletion`/`advance`라 여기 있어야 참조된다. 본문 무변경. */
  const notifyCellPersistFailed = useCallback((row: number, colId: string, value: string) => {
    useCellPersistError.getState().arm({ row, colId, value });
    playBeep('alert');
    const msg = '저장하지 못했습니다. 다시 저장 버튼을 눌러 주세요.';
    useSessionStore.getState().setLastTts(msg);
    void say(msg);
  }, [say]);

  /** 🔴 v0.49 r6 Y1 — **행 완료 부기의 durable 실패 고지.** 셀 실패 배너를 그대로 재사용한다.
   *
   *  왜 셀 배너인가: 이 배너의 재시도는 `commitManualValue(row,colId,value)` 재실행이고, 그
   *  경로가 `persistCellValue`(→ 세션이 아직 없으면 `persistSession`) → `finalizeRowCompletion`
   *  **전체를 다시 태운다**. 즉 행 부기 실패도 같은 버튼 하나로 실제 회복된다 — 「실패는 화면에
   *  남기고 재시도 경로를 제공한다」(PRINCIPLES §1)를 새 UI 없이 만족하는 유일한 기존 깔때기다.
   *  좌표는 **그 행에서 값이 있는 마지막 음성 컬럼** = 방금 행을 완성시킨 칸이다(재커밋해도 값이
   *  같아 부작용이 없고, 배너 문구가 사용자가 마지막으로 넣은 값을 가리킨다).
   *
   *  🔴 v0.49 r7 #1(codex R6-F3 High) — **좌표 정본은 흐름 소유자(`landing`)다.** 위 「마지막 음성
   *   컬럼 = 방금 행을 완성시킨 칸」은 순차 입력에서만 참이다. 빈 칸을 지나쳐 뒤 칸을 먼저 채운 뒤
   *   `row_gap_return`(:advance)이 커서를 되돌려 **앞 칸에서** 행이 완성되면 둘이 갈린다 —
   *   완성시킨 칸은 앞 칸인데 배너는 뒤 칸을 가리켰다.
   *   피해는 배너 문구 오표기가 아니라 **재시도가 흐름을 회복하지 못하는 것**이다: 배너의 재시도는
   *   `commitManualValue(row,colId,value)`이고, 그 안의 `ownsCell`이 **`awaiting.colId` 일치**를
   *   요구한다. 좌표가 갈리면 `ownsFlow=false`가 돼 값·부기는 저장되는데 `proceedAfterCommit`
   *   착지가 안 돌고, 복원된 awaiting이 **앞 칸에 걸린 채** 남아 다음 발화가 방금 넣은 값을
   *   덮어쓴다(값 손상 꼬리).
   *   👉 `landing`이 그 행의 실재 값을 가진 칸을 가리키면 그것을 쓴다. `reviewWait`은 **행 스코프**라
   *      좌표를 요구하지 않으므로(그쪽 `ownsReviewWait`은 행만 본다) 종전 폴백에 맡긴다. */
  const notifyRowPersistFailed = useCallback((row: number, landing?: AwaitingField | null) => {
    const values = useSessionStore.getState().getRowValues(row);
    if (landing && landing.kind !== 'reviewWait' && landing.row === row
      && (values[landing.colId] ?? '') !== '') {
      notifyCellPersistFailed(row, landing.colId, values[landing.colId]!);
      return;
    }
    const target = [...voiceColsList()].reverse().find((c) => (values[c.id] ?? '') !== '');
    if (!target) return;
    notifyCellPersistFailed(row, target.id, values[target.id]!);
  }, [notifyCellPersistFailed]);

  // ── public: jump to a specific row (auto-chip change / 행 이동 공용) ──────
  const jumpToRow = useCallback(
    async (targetRow: number, options?: { setReturn?: boolean; source?: 'voice' | 'touch' }) => {
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
    [announceField, announceRowDiff, enterReviewWait],
  );

  // ── public: move to the previous row (◀이전 버튼 + 음성 '이전' 공용 — v0.33.0 백로그 A 통일) ──
  // Review/edit semantics: jumpToRow(setReturn:true) so finishing the visited row returns the
  // flow to where the user was. (복귀 대상이 그 사이 완료되면 advance의 NAV-1 가드가 복귀를 차단.)
  // 완료 행 착지는 jumpToRow의 검토 대기(값 낭독 + 명령 대기)로 이어진다(민구 결정 3).
  // On a boundary we REPROMPT instead of silently stalling (REVIEW-4).
  const gotoAdjacentRow = useCallback(
    async (delta: -1, source: 'voice' | 'touch' = 'touch') => {
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
    [announceOrCellWait, enterReviewWait, jumpToRow, say],
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
  }, [announceOrCellWait, enterReviewWait, jumpToRow, persistSession, say]);
  return { formatRowList, listEmptyRows, buildEndReachedTts, announceEndReached, enterReviewWait,
    enterCellWait, announceOrCellWait, notifyCellPersistFailed, notifyRowPersistFailed, jumpToRow, gotoAdjacentRow, goNextRow };
}
