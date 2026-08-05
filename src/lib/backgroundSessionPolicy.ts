/**
 * v0.45.0 WP-2 [D1] — 세션-활성 게이트(hidden 정책) 순수 정책.
 *
 * 민구 확정(08-05): *"세션이 진행중엔 음성 입력 출력 모두 가능하게. 세션 종료 이후에도
 * 작동했다는 게 문제였을 뿐."* — v0.43.0 [MIC-BG-STOP-1]("앱 이탈 시 중지")의 원 의도가
 * "세션 밖에서 돌지 마라"였음이 08-05 실사용 정정으로 확인됐다. v0.43.0은 세션 **안**까지
 * 정지한 과잉 교정이었고, 그 정지가 복귀마다의 인식기 재생성 + BT HFP 재협상 왕복(세션7에서
 * 6회)을 만들었다(플랜 §1-③). 이 모듈이 그 경계를 정의한다:
 *
 *  - **세션 중**(active·paused·complete) — hidden(화면끔·앱이탈 불문)에도 STT·TTS·클립 캡처
 *    유지. 화면끔 vs 앱이탈 구분은 웹에서 불가능하다([SCREEN-LOCK-1] — 53/53 evidence=blur
 *    실측)는 전제 위의 설계다. complete 포함은 민구 확정(08-05): 완료 화면에서 화면 끈 채
 *    '종료' 음성 명령이 가능해야 하고, 기존 복원 게이트(resumeRecognitionForUi)와도 일치한다.
 *  - **세션 밖**(ready·stopping·done) — 지금처럼 확실히 정지. "세션 밖 마이크 0"이 이 안의
 *    성립 조건이다(위반 시 v0.42 이전의 원 문제가 재발한다).
 *  - **장기 임계 10분**(Q2 민구 확정) — 백그라운드가 임계를 넘으면 ①음성 고지(best-effort)
 *    ②기기 알림 ③저장 ④정지(물림 예방 선-정리 포함). 복귀 시 자동 재개 + 재고지.
 *
 * ⚠️ iOS는 화면잠금·백그라운드에서 Web Audio·마이크를 OS 재량으로 중단시킬 수 있다(연구
 * §3-B — 공식 확인). 이 게이트가 보장하는 것은 "앱이 스스로 죽이지 않는다"까지고, OS가 죽이는
 * 창은 임계·복귀 재개(foregroundReturnPolicy teardown + mic_track 판정)가 받는다.
 *
 * 순수 모듈 — 브라우저 전역·스토어 import 없음(Node 단위 스펙 계약, foregroundReturnPolicy 계보).
 */

/** hidden에도 세션을 유지하는 phase 집합. */
export const BG_KEEP_PHASES = ['active', 'paused', 'complete'] as const;

/** 장기 백그라운드 임계(Q2 민구 확정: 10분). 도달 시 고지+알림+저장+정지. */
export const LONG_BACKGROUND_OFF_MS = 600_000;

export function shouldKeepInBackground(phase: string): boolean {
  return (BG_KEEP_PHASES as readonly string[]).includes(phase);
}
