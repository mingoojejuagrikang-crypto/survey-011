/** v0.47.0 C-FIX2b(2차 재검증, major) — **셀 영속 실패**의 화면 지속 상태(셀 스코프 persistError 변형).
 *
 *  왜 기존 `sessionStore.persistError`를 재사용하지 않나(소비 의미론 확인 결과 — Larry 지시):
 *   - 그 플래그는 **최종 저장(stop) 실패** 전용이다: PersistErrorBanner 문구가 "종료되지 않음"으로
 *     고정돼 있고, [다시 저장]=retryFinalPersist는 성공 시 `setPhase('ready')`로 **세션을 끝낸다**.
 *     입력 중 셀 실패에 그대로 세우면 성공 재시도가 세션을 종료시키는 의미론 충돌 — 그래서
 *     Larry가 허용한 「셀 스코프 변형」으로 간다(sessionStore는 타 레인 소유라 필드 추가 불가이기도 하다).
 *   - 두 배너가 동시에 설 수 있는 창(셀 실패 → 곧바로 종료 시도 실패)은 VoiceScreen이 stop 모달을
 *     우선한다(더 큰 사고가 위).
 *
 *  계약(PRINCIPLES §1 「실패는 화면에 남기고 재시도 경로를 제공한다」):
 *   - arm: persistCellValue durable 실패 시(useVoiceSession.notifyCellPersistFailed) — 실패한
 *     (row,colId,value)를 담아 지속 배너를 세운다. TTS를 놓쳐도 화면에 남는다.
 *   - 해소는 **같은 셀의 durable 성공뿐**(persistCellValue 성공 시 clearIfMatches) — 배너의
 *     [다시 저장]이 commitManualValue 재실행으로 그 성공을 만든다(성공 시 화음·에코·✓·진행까지
 *     원래 커밋 플로우 전체가 재개된다 — 반쪽 재현 없음).
 *   - 세션 경계(start/stop)에서 clear — stop은 자체 persistSession+persistError 경로가 이어받는다.
 */
import { create } from 'zustand';

interface FailedCellCommit {
  row: number;
  colId: string;
  value: string;
}

interface CellPersistErrorState {
  /** 실패한 셀 커밋(배너 표시 + 재시도 페이로드). null=정상. */
  pending: FailedCellCommit | null;
  /** 재시도 IDB 쓰기 진행 중(버튼 잠금 — PersistErrorBanner retrying과 동일 계약). */
  retrying: boolean;
  arm: (p: FailedCellCommit) => void;
  setRetrying: (retrying: boolean) => void;
  /** 같은 셀의 durable 성공만 해소한다(다른 셀 성공으로 미저장 셀 배너가 사라지면 안 된다). */
  clearIfMatches: (row: number, colId: string) => void;
  clear: () => void;
}

export const useCellPersistError = create<CellPersistErrorState>((set) => ({
  pending: null,
  retrying: false,
  arm: (pending) => set({ pending, retrying: false }),
  setRetrying: (retrying) => set({ retrying }),
  clearIfMatches: (row, colId) =>
    set((s) => (s.pending && s.pending.row === row && s.pending.colId === colId
      ? { pending: null, retrying: false }
      : s)),
  clear: () => set({ pending: null, retrying: false }),
}));
