/** v0.47.0 W2(FB-C+FB-G①, 민구 08-08) — 수정 국면의 「성공 커밋 여부」 신호.
 *
 *  민구 확정: 수정 **진입~재청취**는 amber(§C4 의미 보존), **성공 커밋 순간부터 green**.
 *  수정 국면 자체는 sessionStore.modifyIndicator({name,colId})가 담지만 그 shape에는
 *  "성공했는가"가 없다 — 이 전용 store가 그 한 비트를 담고, VoiceScreen의 톤 파생(SSOT)이
 *  둘을 합성한다: `modifyIndicator && !committed → amber`, 그 외 green.
 *
 *  쓰기 지점(전부 useVoiceSession):
 *   - announceField — 수정 진입/일반 안내 공히 false(재청취 국면 시작 또는 국면 종료).
 *   - handleFinal 수정 성공 커밋(kind='modify') · commitManualValue 수정 중 수동 재커밋 — true.
 *   - 종단 착지(announceEndReached·enterReviewWait·stop) — false(modifyIndicator 해제와 동행).
 */
import { create } from 'zustand';

interface ModifyPhaseState {
  /** true = 수정 성공 커밋 직후(green 국면). false = 재청취 중이거나 수정 국면 아님. */
  committed: boolean;
  setCommitted: (committed: boolean) => void;
}

export const useModifyPhase = create<ModifyPhaseState>((set) => ({
  committed: false,
  setCommitted: (committed) => set({ committed }),
}));
