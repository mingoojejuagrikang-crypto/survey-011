/**
 * v0.49 R1 리팩토링 P2 — 데이터탭 «세션 복구» 서브 훅 (useDataActions에서 순수 이동 — [ENV-12] #0
 * 해소 계획 명시분: recover 절 분리).
 * busy/msg·loginPrompt는 조립 훅(useDataActions) 소유 — setter를 받는다(재로그인 resume 배선은
 * 동기화 절과 공유라 이동 대상이 아니다). 로직·계측은 이동 전과 바이트 동일.
 */
import { useCallback, useState } from 'react';
import { useDataStore } from '../stores/dataStore';
import { resetDb } from './db';
import { hydrateSessions } from './hydrate';
import { getAccessToken } from './googleAuth';
import { restoreSelectedSessions, type ZipCache } from './recoverFromDrive';
import { logger } from './logger';

export function useRecoverActions(deps: {
  setBusy: (v: string | null) => void;
  setMsg: (v: string | null) => void;
  setLoginPrompt: (v: { reason: string; resume: () => void } | null) => void;
}) {
  const { setBusy, setMsg, setLoginPrompt } = deps;
  const [recoverModalOpen, setRecoverModalOpen] = useState(false);

  // 세션 복구: 앱 업데이트/새로고침으로 목록에서 사라져 보이는 세션을 IDB에서 다시 불러온다.
  // (v0.4.4: 입력은 값 커밋마다 증분 저장되므로 진행 중이던 행도 함께 복구됨.)
  // (v0.4.5 D1: resetDb()로 stale/끊긴 IDB 연결을 버리고 새로 열어 재시도 — 앱 업데이트 후 복구 실패 방지.)
  // (v0.5.0 W8: 2단계 — 로그인 상태면 Drive의 로그 zip(sessions.json + clips/)에서
  //  로컬에 없는 세션+클립까지 복원. 다운로드는 이 버튼을 눌렀을 때만 발생.)
  const handleRecoverClick = async () => {
    setMsg(null);
    setBusy('세션 복구 중...');
    // v0.5.0 W7(T-19): 복구 버튼 계측 — 사용자가 복구에 의존하는 빈도/성패를 로그로 확인.
    logger.log({ type: 'app', extra: 'recover_clicked' });
    try {
      // ── 1단계: 로컬 IDB 재하이드레이션 (현행) ──
      const before = useDataStore.getState().sessions.length;
      resetDb();
      await hydrateSessions();
      const after = useDataStore.getState().sessions.length;
      const err = useDataStore.getState().hydrationError;
      logger.log({
        type: 'app',
        extra: err ? `recover_result:error:${err}` : `recover_result:ok:${before}->${after}`,
      });
      if (err) {
        setMsg('복구 실패: ' + err);
      } else if (after > before) {
        setMsg(`✓ 세션 ${after - before}개를 복구했습니다.`);
      } else {
        setMsg(`✓ 저장된 세션 ${after}개를 모두 불러왔습니다.`);
      }

      // ── 2단계: 로그인 상태면 RecoverModal(기간 조회 + 세션 선택) 오픈. DB가 깨진 상태(1단계
      //    실패)에 덮어쓰는 것을 피하기 위해 1단계 성공 시에만 진행한다. 미로그인이면 안내만. ──
      if (!err) {
        if (getAccessToken()) {
          setRecoverModalOpen(true);
        } else {
          // v0.20.0 Phase 2 — 미로그인/토큰 만료면 안내 텍스트만 남기던 것을 로그인 팝업으로 승격.
          // 재로그인 성공 시 Drive 복구 모달을 바로 연다(graceful resume). 로컬 IDB 재하이드레이션
          // (1단계)은 이미 끝났으므로 여기서는 Drive 2단계만 이어가면 된다.
          setLoginPrompt({
            reason: 'Drive에서 세션을 복구하려면 로그인이 필요합니다.',
            resume: () => { setRecoverModalOpen(true); },
          });
        }
      }
    } finally {
      setBusy(null);
    }
  };

  // RecoverModal "선택 복구" 완료 콜백 — 선택 세션을 IDB에 저장한 뒤 재하이드레이션해 카드로 노출.
  const handleRecoverRestore = useCallback(async (
    selectedIds: Set<string>,
    cache: ZipCache,
    onProgress: (msg: string) => void,
  ) => {
    const localIds = new Set(useDataStore.getState().sessions.map((s) => s.id));
    const r = await restoreSelectedSessions(selectedIds, localIds, cache, onProgress);
    if (r.sessions > 0) {
      await hydrateSessions();
    }
    return r;
  }, []);

  return {
    recoverModalOpen, setRecoverModalOpen,
    handleRecoverClick, handleRecoverRestore,
  };
}
