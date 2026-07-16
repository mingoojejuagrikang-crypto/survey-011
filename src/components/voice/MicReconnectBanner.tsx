import { useEffect } from 'react';
import { T } from '../../tokens';
import { I } from '../icons';

/** v0.22.0 P0(UI) — "마이크 재연결" 배너. 클립 마이크가 죽어(블루투스 끊김·OS 인터럽션 등) 사용자
 *  제스처로 재획득해야 할 때만(micLost) 화면 상단에 띄운다. 장갑·원거리·소음 현장 기준:
 *   - 화면 가로 폭 전체를 쓰는 RED 배너(주변 톤과 확실히 구분 — 이상치 RED와 달리 상단 고정).
 *   - 버튼은 큰 터치 타깃(min 56px 높이)·큰 글자(18px)·명확한 라벨("마이크 재연결").
 *   - 기존 토큰(T.red/T.card)·safe-area 패턴(PausedCard와 동일) 재사용.
 *  micLost=false면 아무것도 렌더하지 않는다. 버튼 탭 → onReconnect(=sess.reconnectMic).
 *  v0.23.0 입력탭#3 — 쿨다운 피드백: reconnecting=true 동안 버튼을 비활성+스피너+"재연결 중…"으로
 *   바꿔, RECOVER_COOLDOWN_MS(~3s) 내 더블탭이 죽은 버튼처럼 보이던 문제를 없앤다. 탭 시 호출자가
 *   reconnecting을 켜고, 이 컴포넌트가 3s 타이머로 onCooldownEnd를 호출해 해제한다(언마운트 시
 *   cleanup으로 setState-after-unmount 방지 — micLost가 false로 바뀌면 배너 자체가 언마운트됨). */
export function MicReconnectBanner({
  micLost, reconnecting, onReconnect, onCooldownEnd,
}: {
  micLost: boolean;
  reconnecting: boolean;
  onReconnect: () => void;
  onCooldownEnd: () => void;
}) {
  // 쿨다운 타이머: reconnecting이 켜지면 3s(=audioRecorder RECOVER_COOLDOWN_MS) 후 해제 콜백.
  //   ⚠️ deps는 [reconnecting]만 — onCooldownEnd를 deps에 넣으면 부모(VoiceScreen)가 confidence
  //   폴링(300ms)으로 매 렌더 새 함수 정체성을 주어, 타이머가 발화 전에 매번 리셋돼 "재연결 중…"이
  //   영영 안 풀리는 새 버그가 된다. onCooldownEnd는 안정 setter만 호출하므로 rising edge 캡처로 안전.
  //   언마운트(=micLost false로 배너 제거) 시 clearTimeout으로 정리(setState-after-unmount 방지).
  useEffect(() => {
    if (!reconnecting) return;
    const id = window.setTimeout(() => onCooldownEnd(), 3000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconnecting]);

  if (!micLost) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60,
        display: 'flex', justifyContent: 'center',
        // safe-area(노치·상태바) 침범 방지 — standalone 설치형 대응(App.tsx/PausedCard 패턴).
        paddingTop: 'max(8px, var(--sat))',
        paddingLeft: 'max(10px, var(--sal))',
        paddingRight: 'max(10px, var(--sar))',
        pointerEvents: 'none', // 컨테이너는 통과, 내부 카드만 인터랙티브.
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          width: '100%', maxWidth: 560,
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', borderRadius: 16,
          background: 'rgba(34,18,18,0.97)', border: `2px solid ${T.red}`,
          boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
        }}
      >
        <span style={{ flexShrink: 0, display: 'flex', color: T.red }} aria-hidden>{I.mic(24, T.red)}</span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span
            style={{
              fontSize: 18, fontWeight: 900, color: T.red, letterSpacing: -0.3,
              wordBreak: 'keep-all', overflowWrap: 'anywhere', lineHeight: 1.2,
            }}
          >
            마이크 연결 끊김
          </span>
        </div>
        <button
          type="button"
          onClick={onReconnect}
          disabled={reconnecting}
          aria-busy={reconnecting}
          data-testid="mic-reconnect-btn"
          style={{
            flexShrink: 0,
            minHeight: 56, padding: '0 18px', borderRadius: 14,
            border: 'none', cursor: reconnecting ? 'wait' : 'pointer',
            background: reconnecting ? '#7a2e2e' : T.red, color: '#fff',
            opacity: reconnecting ? 0.85 : 1,
            fontSize: 18, fontWeight: 900, letterSpacing: -0.3,
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: reconnecting ? 'none' : '0 4px 14px rgba(255,82,82,0.4)',
          }}
          title={reconnecting ? '재연결 중…' : '재연결'}
        >
          {reconnecting ? (
            <>
              {/* spin 키프레임은 index.css 전역(다른 스피너와 공유). 없으면 정적 아이콘으로 폴백돼도 의미 전달. */}
              <span
                aria-hidden
                style={{
                  width: 20, height: 20, flexShrink: 0,
                  border: '3px solid rgba(255,255,255,0.4)', borderTopColor: '#fff',
                  borderRadius: '50%', display: 'inline-block',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              재연결 중…
            </>
          ) : (
            <>재연결</>
          )}
        </button>
      </div>
    </div>
  );
}
