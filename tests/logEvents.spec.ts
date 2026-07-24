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

/** v0.38.1 [MIC-B2] 실기기 판정 바이트 — 이 문자열이 SOP-003 파서와의 계약이다.
 *  R1 초안은 필드를 ':'로 잇고 evt를 `vis:bg=3000s`로 박아 split(':') 파서가 필드를 쪼갰다.
 *  배포 전에 kv(',') 규약으로 교정했고, 여기서 리터럴로 고정해 되돌아가지 못하게 한다. */
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
