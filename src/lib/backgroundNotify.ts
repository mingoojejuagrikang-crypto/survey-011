/**
 * v0.45.0 WP-2 — 장기 백그라운드(10분 임계) 기기 알림.
 *
 * Q2 민구 확정: 임계 도달 시 ①음성 고지 ②**기기 알림** ③저장 ④정지. 백그라운드 10분 시점엔
 * iOS가 TTS를 이미 막았을 수 있어 **Notification이 주 채널**이다(플랜 §4 — TTS는 best-effort).
 *
 * 계약:
 *  - **권한 요청은 세션 시작 클릭의 동기 구간에서만**(iOS 제스처 요건). start()가 첫 await 전에
 *    requestNotifyPermissionOnce()를 부른다 — 앱 수명당 1회, 이미 결정돼 있으면 no-op.
 *    설치형 PWA + iOS 16.4+ 전제(미지원 환경은 조용히 unsupported로 기록만).
 *  - **표시는 Service Worker 경유가 정본**이다 — iOS는 페이지 컨텍스트의 `new Notification()`을
 *    지원하지 않는다(웹 푸시/로컬 알림 모두 SW showNotification 경로). SW가 없으면 데스크톱
 *    브라우저 폴백으로만 생성자를 시도한다.
 *  - 결과는 호출부가 `notify_perm:`/`bg_mic` 계측으로 남긴다 — 이 모듈은 로깅하지 않는다
 *    (logger 순환 의존 회피 + 호출부가 이벤트 문맥을 소유).
 */

let permissionRequested = false;

/** 앱 수명당 1회, 미결정(default) 상태에서만 요청한다. 결과를 Promise로 돌려준다 —
 *  'skipped'는 이미 결정됐거나 미지원이라 요청 자체를 안 한 경우다. */
export function requestNotifyPermissionOnce(): Promise<NotificationPermission | 'skipped'> {
  if (permissionRequested) return Promise.resolve('skipped');
  permissionRequested = true;
  try {
    if (!('Notification' in window)) return Promise.resolve('skipped');
    if (Notification.permission !== 'default') return Promise.resolve('skipped');
    return Notification.requestPermission().catch(() => 'skipped' as const);
  } catch {
    return Promise.resolve('skipped');
  }
}

export type BackgroundNotifyResult = 'shown' | 'no_permission' | 'unsupported' | 'error';

/** 임계 도달 알림. 실패를 던지지 않는다 — 결과 분류만 돌려준다(계측용). */
export async function showBackgroundOffNotification(): Promise<BackgroundNotifyResult> {
  try {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission !== 'granted') return 'no_permission';
    const title = '음성 입력이 정지되었습니다';
    const body =
      '10분간 자리 비움 — 입력한 값은 저장돼 있습니다. 앱으로 돌아오면 자동으로 다시 시작합니다.';
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, tag: 'bg-off' });
      return 'shown';
    }
    // SW 미등록(데스크톱 브라우저 탭 등) 폴백 — iOS에선 이 경로가 throw라 위 SW 경로가 정본.
    new Notification(title, { body, tag: 'bg-off' });
    return 'shown';
  } catch {
    return 'error';
  }
}
