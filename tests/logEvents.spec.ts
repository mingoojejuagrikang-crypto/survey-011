/**
 * v0.35.2 Stage 2 — logEvents 빌더 특성화 테스트 (Node, 서버 불필요 — sessionSync.spec 패턴).
 *
 * 목적: 빌더가 방출하는 extra 문자열을 **리터럴로 고정**한다(SOP-003 파서·과거 zip 바이트 계약).
 * 기대값은 리팩토링 이전 콜사이트의 템플릿 리터럴 산출을 그대로 옮긴 것 — 빌더 구현을 바꿔서
 * 이 테스트를 고치고 싶어지면, 그것은 외부 파서 계약 위반 신호다(anomalyAlert.spec 패턴).
 */
import { test, expect } from '@playwright/test';
import { kv, withErr, settingChanged, rowMarked, zombieRestart, micAutoReconnect } from '../src/lib/logEvents';

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
