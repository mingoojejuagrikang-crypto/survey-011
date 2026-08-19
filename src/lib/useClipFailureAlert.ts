/**
 * v0.50 [CLIP-SILENT-1] — **클립 캡처 실패 고지**(단일 배선 지점).
 *
 * `micLost`가 서는 **상승 에지에서 한 번**: ① 화면 끄기(blackout)를 자동으로 푼다 ② TTS로 한
 * 문장 말한다. 그게 전부다 — 복구는 하지 않는다(기존 `reconnectMic` 경로 소유).
 *
 * ## 왜 별도 훅인가
 * PRINCIPLES §3(기능 격리): 고지는 **앱 본체와 단일 배선 지점으로만** 연결한다. `useVoiceSession`
 * (동결 코어)에는 호출 한 줄만 남고, 이 파일을 지우면 기능이 통째로 사라진다.
 *
 * ## 왜 두 가지를 같이 하는가 — 2026-08-19 실측
 *  · 이원창 A: 세션 +14s에 화면 끄기 → 그 뒤 40분 60클립 전량 소실. `BlackoutOverlay`가
 *    `zIndex 9999`, `MicReconnectBanner`가 `zIndex 60`이라 **배너가 떴어도 완전히 가렸다.**
 *    해제는 「중앙 2초 홀드」뿐이고 경고에 의한 자동 해제 경로가 **없었다.**
 *  · 양혁진 A: 화면 끄기를 **쓰지 않았는데도** 2분 26초·9셀을 잃는 동안 아무것도 안 떴다.
 *  👉 화면을 열어주는 것(①)과 귀에 말하는 것(②)은 **둘 다 있어야** 사용자에게 도달한다.
 *
 * 🔑 `interrupt: false`인 이유: 실패는 값 커밋 직후에 나고 그 순간 **echo TTS가 진행 중**이다.
 *    끊으면 방금 커밋한 값의 되읽기를 못 듣는다 — 고지는 그 뒤에 이어 붙인다.
 */
import { useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { CLIP_FAIL_ALERT_TTS } from './voicePrompts';
import type { logger } from './logger';

type LogCell = (entry: Omit<Parameters<typeof logger.log>[0], 'sessionId'>) => void;

export interface ClipFailureAlertDeps {
  /** 마이크 소실 래치 상태(`useVoiceSession.micLost`). false로 내려가면 다음 사고를 위해 재무장. */
  micLost: boolean;
  say: (text: string, interrupt?: boolean) => Promise<boolean>;
  logCell: LogCell;
}

export function useClipFailureAlert({ micLost, say, logCell }: ClipFailureAlertDeps): void {
  // 🔴 에지 가드를 ref로 두는 이유: `micLost`가 유지되는 동안 effect가 재실행돼도(say/logCell
  //    identity 변화 등) **한 번만** 말한다. 반복 고지는 그 자체가 현장 방해다.
  const announcedRef = useRef(false);
  // 최신 참조를 ref로 잡아 effect deps에서 뺀다 — deps에 함수를 넣으면 호출부가 인라인 화살표를
  // 넘길 때 매 렌더 재실행되고, 그때마다 위 가드에만 의존하게 돼 의도가 흐려진다.
  const sayRef = useRef(say);
  sayRef.current = say;
  const logRef = useRef(logCell);
  logRef.current = logCell;

  useEffect(() => {
    if (!micLost) {
      announcedRef.current = false;
      return;
    }
    if (announcedRef.current) return;
    announcedRef.current = true;
    // ① 화면부터 연다 — 배너·재연결 버튼이 사용자에게 보이려면 이게 먼저다.
    const wasBlackout = useSessionStore.getState().blackout;
    if (wasBlackout) useSessionStore.getState().setBlackout(false);
    // 계측: 고지가 실제로 나갔는지, 그때 화면이 꺼져 있었는지. 이 두 사실이 없으면 다음 사고에서
    // 「고지했는데 못 봤다」와 「고지 자체가 안 나갔다」를 구분할 수 없다([REVIEW-1]).
    logRef.current({ type: 'clip', extra: `clip_fail_alert:blackout=${wasBlackout ? 'released' : 'off'}` });
    // ② 귀로 말한다. 진행 중 echo를 끊지 않는다(헤더 🔑).
    void sayRef.current(CLIP_FAIL_ALERT_TTS, false);
  }, [micLost]);
}
