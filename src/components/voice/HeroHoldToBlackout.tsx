import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { T } from '../../tokens';
import { VOICE_TYPE } from './heroLayout';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { logger } from '../../lib/logger';
import { speak } from '../../lib/speech';

/**
 * v0.47.0 W7 — **중앙(히어로) 영역 3초 홀드로 검은 화면 모드에 들어간다.**
 *
 * 민구 원문(08-08): *"화면 중앙 히어로 영역을 사용자가 터치하면 안내음성/문구+진행바와 함께
 * 3초 유지하면 화면 끔. 화면 꺼진 상태에서 중앙 영역 잠깐이라도 터치하면 화면 켬으로 하자."*
 *
 * ## 왜 버튼이 아니라 홀드인가
 * t9 조사가 **전원 버튼 대체를 불가로 확정**했고(10분 백그라운드 캡이 세션을 정지시킨다),
 * 그 대안이던 「정지 버튼을 화면끔 버튼으로 전환」안은 충돌 5종(종료 3단계화·일시정지 중
 * 화면끔 소실·슬롯 오터치 레이스 등)을 낳았다. 홀드는 **버튼 4개를 그대로 두고** 진입만
 * 추가하므로 그 충돌이 전부 무효가 된다. 종전 유일 진입이던 음성 「화면」도 그대로 산다
 * (계측이 `src:voice`/`src:hold`로 둘을 가른다).
 *
 * ## 🔴 설계 계약 4가지 — 각각이 실패 모드 하나를 막는다
 *
 * ① **홀드 상태는 리렌더와 독립이다.** 진행 상태를 ref + rAF로 들고, 화면 갱신용 `progress`
 *    state는 **이 컴포넌트 안에만** 산다. `children`(히어로)은 prop으로 받은 **같은 엘리먼트
 *    객체**라 이 컴포넌트가 60fps로 리렌더돼도 React가 그 서브트리를 건너뛴다. 홀드 도중
 *    값이 확정돼 히어로가 리렌더돼도 rAF는 끊기지 않는다.
 *    ⚠️ 다만 **분기 전환(이상치·수정 카드)은 언마운트**라 홀드가 취소된다 — 의도한 동작이다.
 *    알람이 뜨는 순간은 사용자가 화면을 **봐야** 하는 순간이고, 그때 화면이 꺼지면 사고다.
 *
 * ② **`touchAction:'none'`** — iOS는 터치가 네이티브 스크롤로 전환되는 순간 `pointercancel`을
 *    쏜다(W3=FB-D와 같은 기전). 히어로 루트는 `overflowY:'auto'`라 **실제로 스크롤 컨테이너다**
 *    (브리핑의 "히어로는 비스크롤 영역"은 코드와 어긋난다 — `VoiceHero.tsx`의 height 계약 주석).
 *    이 표면에서 브라우저 팬을 아예 시작시키지 않는 것이 가장 확실한 방어다.
 *    🟡 대가: 히어로 안쪽을 손가락으로 스크롤할 수 없다. 히어로는 내용이 항상 중앙 정렬된
 *    표시 전용 영역이라 실사용 스크롤이 없다고 판단했다(`overflowY:auto`는 fit 높이 판정을
 *    위한 것이지 스크롤 UX를 위한 것이 아니다 — 그 주석이 근거).
 *
 * ③ **에코 가드는 새로 만들지 않는다.** 안내 TTS가 STT에 되먹임되는 축은 `speech.ts`의
 *    `muteForTts`/`halfDuplexHold`가 이미 utterance 수명으로 막는다. 그래서 그냥 `speak()`를
 *    부른다 — `speech.ts`는 **수정하지 않는다**.
 *
 * ④ **진입은 커밋 지점이 하나다.** rAF가 1.0에 도달한 그 프레임에서만 `setBlackout(true)`이고,
 *    같은 프레임에 `firedRef`를 세워 다음 프레임의 중복 진입을 막는다.
 */

/** 민구 확정: **3초**. 오터치로 화면이 꺼지면 현장에서 값이 날아간 것처럼 보인다 —
 *  0.9초(종전 해제 홀드)보다 길게 잡은 이유가 그것이다. */
export const HOLD_TO_BLACKOUT_MS = 3000;

/** 안내 문구 — 화면 문구와 TTS가 **글자까지 같다**(voicePrompts SSOT 계보 · FB#4 원칙). */
const HOLD_HINT = '계속 누르면 화면을 끕니다';
const HOLD_TTS = '계속 누르면 화면을 끕니다. 음성 입력은 계속됩니다.';

export function HeroHoldToBlackout({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const firedRef = useRef(false);

  const stopHold = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setProgress(0);
  }, []);

  // 언마운트 정리 — 남으면 히어로가 사라진 뒤에도 프레임이 돌고, 최악의 경우 **화면이 안 보이는
  //   상태에서 blackout으로 진입**한다(분기 전환 = 홀드 취소 계약의 실효 지점이다).
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const beginHold = useCallback((e: PointerEvent<HTMLDivElement>) => {
    // 멀티터치·보조 버튼 무시. 이미 검은 화면이면 진입 자체가 무의미하다(오버레이가 위를 덮는다).
    if (!e.isPrimary || rafRef.current !== null) return;
    if (useSessionStore.getState().blackout) return;
    // 🔴 포인터 캡처 — 손가락이 히어로 밖으로 밀려도 `pointerup`이 **이 요소로** 온다.
    //    없으면 경계에서 뗀 손가락이 취소를 못 보내 홀드가 떠 있는 채로 남는다.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 캡처 미지원 — rAF는 그대로 */ }
    firedRef.current = false;
    startRef.current = performance.now();
    void speak(HOLD_TTS, {
      interrupt: false, // 진행 중 안내를 자르지 않는다 — 이 발화는 보조 정보다
      rate: useSettingsStore.getState().ttsRate || 1.05,
    });
    const tick = () => {
      const p = Math.min(1, (performance.now() - startRef.current) / HOLD_TO_BLACKOUT_MS);
      setProgress(p);
      if (p >= 1) {
        rafRef.current = null;
        if (firedRef.current) return;
        firedRef.current = true;
        useSessionStore.getState().setBlackout(true);
        // 계측 — 음성 진입(`useVoiceSession.ts` `src:voice`)과 **같은 이벤트·같은 필드**로
        //   남기고 출처만 가른다. 새 이벤트 타입을 만들지 않는다(SOP-003 파서 계약).
        //   sessionId는 logger가 현재 세션 컨텍스트에서 자동 첨부한다(`logger.ts:189`).
        logger.log({ type: 'command', parsed: 'screen_off', extra: 'src:hold' });
        setProgress(0);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const holding = progress > 0;
  return (
    <div
      data-testid="hero-hold-surface"
      onPointerDown={beginHold}
      onPointerUp={stopHold}
      onPointerCancel={stopHold}
      onPointerLeave={stopHold}
      style={{
        position: 'relative',
        width: '100%', height: '100%', minHeight: 0, minWidth: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        // 계약 ② — 브라우저 팬을 시작시키지 않는다(iOS pointercancel 차단).
        touchAction: 'none',
        // 길게 누르는 동안 iOS가 텍스트 선택·확대 메뉴를 띄우지 않게.
        userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
      }}
    >
      {children}
      {holding && (
        <div
          data-testid="hero-hold-cue"
          role="status"
          aria-label={HOLD_HINT}
          style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            // 히어로 값 위에 겹치므로 배경을 깔아 둘이 섞여 읽히지 않게 한다(알람 시트와 같은 판단).
            background: T.bg, padding: '8px 12px',
            pointerEvents: 'none', // 홀드 표면이 포인터를 계속 받아야 한다
          }}
        >
          <span
            style={{
              fontSize: VOICE_TYPE.caption,
              fontWeight: 800, color: T.textDim, letterSpacing: -0.2, whiteSpace: 'nowrap',
            }}
          >
            {HOLD_HINT}
          </span>
          {/* 차오르는 진행바 — 민구 지시의 "진행바". BlackoutOverlay의 차오르는 원과 같은 역할
              (*"피드백이 없으면 «왜 안 켜지지»가 된다"*)을 진입 쪽에서 맡는다. */}
          <div
            data-testid="hero-hold-track"
            style={{ width: '70%', height: 6, borderRadius: 3, background: T.line, overflow: 'hidden' }}
          >
            <div
              data-testid="hero-hold-fill"
              data-progress={progress.toFixed(3)}
              style={{ width: `${(progress * 100).toFixed(1)}%`, height: '100%', background: T.green }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
