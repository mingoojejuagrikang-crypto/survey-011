/**
 * v0.35.2 Stage 2 — logEvents 빌더 특성화 테스트 (Node, 서버 불필요 — sessionSync.spec 패턴).
 *
 * 목적: 빌더가 방출하는 extra 문자열을 **리터럴로 고정**한다(SOP-003 파서·과거 zip 바이트 계약).
 * 기대값은 리팩토링 이전 콜사이트의 템플릿 리터럴 산출을 그대로 옮긴 것 — 빌더 구현을 바꿔서
 * 이 테스트를 고치고 싶어지면, 그것은 외부 파서 계약 위반 신호다(anomalyAlert.spec 패턴).
 */
import { test, expect } from '@playwright/test';
import {
  kv,
  withErr,
  settingChanged,
  rowMarked,
  zombieRestart,
  micAutoReconnect,
  recoverTimeout,
  audioRouteRevalidate,
  foregroundReturn,
  wakeLockEvent,
  visibilityContext,
  lifecycleSignal,
  inputControlPanelOpened,
  endReachedRender,
  anomalyAlertCleared,
  clipArmBlocked,
  micTeardown,
} from '../src/lib/logEvents';

test('settingChanged — 기존 4개 콜사이트 산출과 바이트 동일', () => {
  expect(settingChanged('ttsRate', 1.2)).toBe('setting_changed:ttsRate=1.2');
  expect(settingChanged('recognitionTolerance', 0.6)).toBe('setting_changed:recognitionTolerance=0.6');
  expect(settingChanged('fastRecognition', true)).toBe('setting_changed:fastRecognition=true');
  expect(settingChanged('autoScreenCapture', false)).toBe('setting_changed:autoScreenCapture=false');
});

test('rowMarked — row_complete/row_skipped 산출과 바이트 동일', () => {
  expect(rowMarked('row_complete', 3, 'voice')).toBe('row_complete:3,src=voice');
  expect(rowMarked('row_skipped', 12, 'touch')).toBe('row_skipped:12,src=touch');
});

test('withErr — Error/비Error 모두 기존 String((err as Error)?.message ?? err) 산출과 동일', () => {
  expect(withErr('session_persist_failed', new Error('QuotaExceededError'))).toBe(
    'session_persist_failed:QuotaExceededError',
  );
  // 비 Error 값(문자열 reject 등) — message가 없으므로 값 자체를 문자열화.
  expect(withErr('drive_upload:failed', '401 unauthorized')).toBe('drive_upload:failed:401 unauthorized');
  // undefined message 케이스: new Error() → message '' — 기존 표현식과 동일하게 빈 문자열.
  expect(withErr('x', new Error())).toBe('x:');
});

test('kv — 신규 이벤트 표준 표기(key=val 쉼표 연결, 삽입 순서 보존)', () => {
  expect(kv({ row: 3, src: 'voice' })).toBe('row=3,src=voice');
  expect(kv({ total: 12, ko: 4 })).toBe('total=12,ko=4');
  expect(kv({ ok: true })).toBe('ok=true');
});

test('zombieRestart — lifecycle 텔레메트리 바이트 계약(stale_ms → n 순서)', () => {
  expect(zombieRestart(12_345, 2)).toBe('lifecycle:zombie_restart:stale_ms=12345,n=2');
});

test('micAutoReconnect — 자동 재연결 시도/결과 신규 바이트 계약', () => {
  expect(micAutoReconnect('attempt')).toBe('mic_auto_reconnect:attempt');
  expect(micAutoReconnect('ok')).toBe('mic_auto_reconnect:result=ok');
  expect(micAutoReconnect('failed')).toBe('mic_auto_reconnect:result=failed');
});

test('recoverTimeout — 마이크 재획득 타임아웃 신규 바이트 계약', () => {
  expect(recoverTimeout('auto', 7_000)).toBe('clip_recorder_recover_timeout:auto:ms=7000');
});

test('wakeLockEvent — 획득/재획득/해제 전 경로 바이트 계약', () => {
  expect(wakeLockEvent({ action: 'acquire', result: 'attempt' }))
    .toBe('wake_lock:action=acquire,result=attempt');
  expect(wakeLockEvent({ action: 'acquire', result: 'ok' }))
    .toBe('wake_lock:action=acquire,result=ok');
  expect(wakeLockEvent({ action: 'acquire', result: 'failed', reason: 'NotAllowedError' }))
    .toBe('wake_lock:action=acquire,result=failed,reason=NotAllowedError');
  expect(wakeLockEvent({ action: 'acquire', result: 'unsupported' }))
    .toBe('wake_lock:action=acquire,result=unsupported');
  expect(wakeLockEvent({ action: 'reacquire', result: 'failed', reason: 'NotAllowedError' }))
    .toBe('wake_lock:action=reacquire,result=failed,reason=NotAllowedError');
  expect(wakeLockEvent({ action: 'release', result: 'ok', source: 'browser' }))
    .toBe('wake_lock:action=release,result=ok,source=browser');
  expect(wakeLockEvent({ action: 'release', result: 'failed', source: 'cleanup', reason: 'AbortError' }))
    .toBe('wake_lock:action=release,result=failed,source=cleanup,reason=AbortError');
});

test('SCREEN-LOCK-1 — visibility 문맥과 원시 lifecycle 신호 바이트 계약', () => {
  expect(visibilityContext({ state: 'hidden', focus: true, evidence: 'none' }))
    .toBe('visibility_context:state=hidden,focus=true,evidence=none');
  expect(visibilityContext({ state: 'visible', focus: false, evidence: 'blur+pagehide' }))
    .toBe('visibility_context:state=visible,focus=false,evidence=blur+pagehide');
  expect(lifecycleSignal({ signal: 'pagehide', visibility: 'hidden', focus: false, persisted: 'yes' }))
    .toBe('lifecycle_signal:signal=pagehide,vis=hidden,focus=false,persisted=yes');
});

test('inputControlPanelOpened — 조절판 펼침 분모 바이트 계약', () => {
  expect(inputControlPanelOpened('touch')).toBe('input_control_panel:action=open,source=touch');
  expect(inputControlPanelOpened('voice')).toBe('input_control_panel:action=open,source=voice');
});

test('[EXIT-PERSIST-1] 종료 렌더·알람 해제 신규 바이트 계약', () => {
  expect(endReachedRender({ branch: 'end', alertStatus: 'none' }))
    .toBe('end_reached_render:branch=end,alertStatus=none');
  expect(endReachedRender({ branch: 'anomaly', alertStatus: 'corrected' }))
    .toBe('end_reached_render:branch=anomaly,alertStatus=corrected');
  expect(anomalyAlertCleared({ reason: 'end_reached', hadStatus: 'corrected' }))
    .toBe('trend_alert_cleared:reason=end_reached,hadStatus=corrected');
});

test('[CLIP-WINDOW-2] suspend 중 신규 녹음창 차단 바이트 계약', () => {
  expect(clipArmBlocked({ reason: 'feedback_modal', row: 3, col: 'c9' }))
    .toBe('clip_arm_blocked:reason=feedback_modal,row=3,col=c9');
});

/** v0.38.1 [MIC-B2] 실기기 판정 바이트 — 이 문자열이 SOP-003 파서와의 계약이다.
 *  R1 초안은 필드를 ':'로 잇고 evt를 `vis:bg=3000s`로 박아 split(':') 파서가 필드를 쪼갰다.
 *  배포 전에 kv(',') 규약으로 교정했고, 여기서 리터럴로 고정해 되돌아가지 못하게 한다. */
test('foregroundReturn — 복귀마다 1건, teardown 여부를 바이트로 남긴다(F6)', () => {
  // 🔴 이 이벤트가 없어서 2026-07-27 회차의 [MIC-B2] 판정이 통째로 불가능했다.
  //    복귀 처리 결과 4값과 **이벤트 없음**(훅 미동작)의 구분이 다음 회차 판정을 가능하게 만든다.
  expect(foregroundReturn({ backgroundMs: 58_231, teardown: 'skipped', evt: 'vis' }))
    .toBe('foreground_return:bg_s=58,teardown=skipped,evt=vis');
  expect(foregroundReturn({ backgroundMs: 61_000, teardown: 'no_recorder', evt: 'pageshow' }))
    .toBe('foreground_return:bg_s=61,teardown=no_recorder,evt=pageshow');
  expect(foregroundReturn({ backgroundMs: 62_000, teardown: 'completed', evt: 'vis' }))
    .toBe('foreground_return:bg_s=62,teardown=completed,evt=vis');
  expect(foregroundReturn({ backgroundMs: 63_000, teardown: 'failed', evt: 'pageshow' }))
    .toBe('foreground_return:bg_s=63,teardown=failed,evt=pageshow');
});

test('micTeardown — 포그라운드 선-정리 판정 바이트 계약', () => {
  expect(micTeardown({
    found: 'interrupted', closed: 'ok', reattach: 'ok', evt: 'vis', backgroundMs: 3_000_000,
  })).toBe('mic_teardown:found=interrupted,closed=ok,reattach=ok,evt=vis,bg_s=3000');

  // no-op(닫을 게 없었음) 판정도 같은 형식으로 읽혀야 실기기 사다리가 분기할 수 있다.
  expect(micTeardown({
    found: 'none', closed: 'ok', reattach: 'skipped', evt: 'pageshow', backgroundMs: 120_000,
  })).toBe('mic_teardown:found=none,closed=ok,reattach=skipped,evt=pageshow,bg_s=120');

  // 필드 구분자가 ':'로 새지 않는다 — 접두 1개만 ':'를 쓴다(파서 계약).
  const s = micTeardown({
    found: 'running', closed: 'timeout', reattach: 'error', evt: 'vis', backgroundMs: 61_000,
  });
  expect(s.split(':')).toHaveLength(2);
});

/** v0.38.2 F5 — 백그라운드 경로 전환의 **유일한 관측점**. 백그라운드에선 devicechange가 발화하지
 *  않아 2026-07-24 세션B의 BT→스피커 전환이 어떤 이벤트로도 남지 않았다(트리거를 추론으로만 세운 이유).
 *  `mic_teardown`과 같은 복귀 이벤트에서 짝으로 읽히므로 필드 표기도 같은 규약(kv ',')이어야 한다. */
test('audioRouteRevalidate — 오디오 경로 재검증 바이트 계약', () => {
  // 실기기 세션B가 남겼어야 할 바이트: 50분 백그라운드 뒤 BT → 내장으로 전환.
  expect(audioRouteRevalidate({
    before: '블루투스', after: '내장 마이크', track: 'live', status: 'ok', evt: 'vis', backgroundMs: 3_000_000,
  })).toBe('audio_route_revalidate:before=블루투스,after=내장 마이크,track=live,status=ok,evt=vis,bg_s=3000');

  // 진입 스냅샷이 없는 복귀(앱 첫 로드 직후 pageshow 등) — before=unknown으로 읽힌다.
  expect(audioRouteRevalidate({
    before: 'unknown', after: '유선 이어폰', track: 'muted', status: 'ok', evt: 'pageshow', backgroundMs: 60_000,
  })).toBe('audio_route_revalidate:before=unknown,after=유선 이어폰,track=muted,status=ok,evt=pageshow,bg_s=60');

  // 필드 구분자가 ':'로 새지 않는다 — 접두 1개만 ':'를 쓴다(micTeardown과 동일한 파서 계약).
  const s = audioRouteRevalidate({
    before: '내장 마이크', after: '블루투스', track: 'ended', status: 'error', evt: 'vis', backgroundMs: 1_000,
  });

  // 🔴 재검증 실패/미관측은 **'내장 마이크'로 확정되지 않는다**(라운드A 리뷰 Codex #1·#2).
  // 이 구분이 없으면 "재검증했는데 그대로였다"와 "재검증 자체가 실패했다"가 로그에서 같아 보인다.
  expect(audioRouteRevalidate({
    before: '블루투스', after: 'unknown', track: 'none', status: 'unavailable', evt: 'vis', backgroundMs: 90_000,
  })).toBe('audio_route_revalidate:before=블루투스,after=unknown,track=none,status=unavailable,evt=vis,bg_s=90');
  expect(s.split(':')).toHaveLength(2);
});
