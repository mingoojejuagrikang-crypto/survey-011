/**
 * v0.50 [CLIP-SILENT-1] — **포커스 인터럽션 지속시간 프로브**(관측 전용).
 *
 * ## 무엇을 재나
 * `window`가 포커스를 잃었다가 되찾기까지의 **경과 ms**를, 그것이 임계를 넘었을 때만 1건 남긴다.
 * `focus_interrupt:ms=<지속>,vis=<visible|hidden>`.
 *
 * ## 왜 필요한가 — 2026-08-19
 * 타앱 알람은 **배너만 띄우고 앱은 계속 `visible`이다**. `visibilitychange`가 안 나므로
 * 복귀 정리 로직(`onForegroundReturn`)이 한 줄도 안 돌고, 남는 자국은 `blur`/`focus`뿐이다.
 * 조사에서 그 구간을 재려면 두 `lifecycle_signal` 이벤트의 ts를 손으로 뺐어야 했다.
 *
 * ## 🔴 중복 계측이 아닌 이유 — 임계가 계약이다
 * `lifecycle_signal`이 이미 전이 **각각**을 남긴다(PRINCIPLES §4는 중복 계측을 금한다).
 * 그래서 이 프로브는 전이를 다시 남기지 않고, **임계를 넘긴 인터럽션의 지속만 요약**한다.
 * 실측상 blur/focus 쌍의 대다수는 1초 미만의 플리커다(탭 전환·키보드·시스템 UI 스침) —
 * 그것까지 남기면 링버퍼(2000)만 갉아먹고 판독은 나아지지 않는다.
 *
 * ## 🔴 복구는 하지 않는다
 * `blur`는 **비특이적 신호**다 — 2026-08-19 정상 세션(강남호)도 같은 `blur,vis=visible`을 맞고
 * 클립 63개를 정상 저장했다. 이 신호로 마이크를 재획득하거나 상태를 바꾸면 멀쩡한 세션을
 * 헤집는다. 감지·복구는 **결과 기반**(`clipHealth`)이 소유한다. 여기는 순수 관측이다.
 */
import { logger } from './logger';
import { kv } from './logEvents';

/** 이 값 미만의 포커스 상실은 남기지 않는다.
 *  근거(2026-08-19 실측): 이원창 세션 발병 시점의 인터럽션은 **1,477ms**였고, 같은 날 로그에
 *  흔한 UI 플리커성 blur/focus 쌍은 0~800ms에 몰려 있다. 1초는 그 사이를 가른다. */
const MIN_INTERRUPT_MS = 1000;

export function installFocusInterruptionProbe(): () => void {
  let blurredAt: number | null = null;

  const onBlur = () => {
    // 이미 blur 상태인데 또 오면(중복 통지) **첫 시각을 유지**한다 — 그래야 ms가 「밖에 있던
    // 시간」이 된다. 덮어쓰면 인터럽션이 짧게 보인다.
    if (blurredAt === null) blurredAt = Date.now();
  };
  const onFocus = () => {
    if (blurredAt === null) return;
    const ms = Date.now() - blurredAt;
    blurredAt = null;
    if (ms < MIN_INTERRUPT_MS) return;
    logger.log({
      type: 'app',
      // vis를 함께 남기는 이유: `hidden`이면 기존 백그라운드 축(복귀 정리 로직이 도는 경로)이고,
      // **`visible`이면 그 로직이 한 줄도 안 도는 사각지대**다. 둘을 로그에서 갈라야 한다.
      extra: `focus_interrupt:${kv({ ms, vis: document.visibilityState === 'hidden' ? 'hidden' : 'visible' })}`,
    });
  };

  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  return () => {
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
  };
}
