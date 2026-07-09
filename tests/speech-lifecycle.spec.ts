/**
 * SpeechController — 인식기 수명주기(영구 STT 사멸 방지) 단위 테스트.
 *
 * P0 배경(실기기 로그): iOS는 speechSynthesis 재생 중 SpeechRecognition을 죽인다.
 * 구 코드에서 onEnd→scheduleRestart(100ms) 타이머를 muteForTts()가 무조건 취소하고
 * unmuteForTts()는 재예약하지 않아 — 인식기 죽음 + TTS 연발 조합에서 영구 STT 무음
 * (5분간 STT 0건, TTS/클립은 정상)이 발생했다. 두 번째 사멸 경로는 scheduleRestart
 * 타이머 본체의 빈 catch(재시도 없음). 이 스펙은 두 경로의 수정 + watchdog 최후
 * 방어선 + stale-instance 가드를 고정한다.
 *
 * postTtsGuard.spec.ts와 동일하게 DOM 없이 Node에서 직접 import해 실행한다 — 단
 * 여기선 start()/재시작 경로까지 돌므로 window(webkitSpeechRecognition·타이머)를
 * 테스트 전용 MockRec으로 shim한다. speech.ts의 모듈 레벨 `synth`는
 * `typeof window !== 'undefined'` 가드라 import 시점(window 미설정)에 null로
 * 안전하게 초기화되고, createRecognition/타이머는 호출 시점에 window를 읽으므로
 * beforeEach shim이 유효하다(검증됨).
 */

import { test, expect } from '@playwright/test';
import { SpeechController } from '../src/lib/speech';
import { logger } from '../src/lib/logger';

/** 앱과 동일한 이벤트 표면을 가진 SpeechRecognition 목. 생성 시 shared 배열에
 *  push되어 "새 인스턴스가 몇 개 만들어졌나"로 재시작 횟수를 관측한다. */
class MockRec {
  static instances: MockRec[] = [];
  /** start()가 앞으로 N번 throw (재시작 백오프 경로 테스트용). */
  static startThrowsRemaining = 0;
  static reset() {
    MockRec.instances = [];
    MockRec.startThrowsRemaining = 0;
  }

  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;
  started = false;
  aborted = false;
  private listeners: Record<string, ((e: Event) => void)[]> = {};

  constructor() {
    MockRec.instances.push(this);
  }

  addEventListener(type: string, cb: (e: Event) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: (e: Event) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== cb);
  }
  start() {
    if (MockRec.startThrowsRemaining > 0) {
      MockRec.startThrowsRemaining--;
      throw new Error('mock start failure');
    }
    this.started = true;
  }
  stop() { /* noop */ }
  abort() { this.aborted = true; }
  /** 등록된 리스너에 이벤트 디스패치 ('start' | 'end' | 'error' | 'result'). */
  fire(type: string) {
    for (const cb of this.listeners[type] ?? []) cb({ type } as Event);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs = 1000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timeout');
    await sleep(5);
  }
}

/** logger 링버퍼에서 lifecycle 이벤트 extra만 추출. */
function lifecycleEvents(): string[] {
  return logger.getAll()
    .map((e) => e.extra)
    .filter((x): x is string => typeof x === 'string' && x.startsWith('lifecycle:'));
}

test.describe('SpeechController — 인식기 수명주기 (영구 사멸 방지)', () => {
  let ctrl: SpeechController | null = null;

  test.beforeEach(() => {
    MockRec.reset();
    logger.clear();
    (globalThis as any).window = {
      setTimeout, clearTimeout, setInterval, clearInterval,
      webkitSpeechRecognition: MockRec,
    } as any;
  });

  test.afterEach(() => {
    ctrl?.stop();
    ctrl = null;
    delete (globalThis as any).window;
    logger.clear();
    MockRec.reset();
  });

  function makeCtrl() {
    ctrl = new SpeechController({ onFinal: () => {} }, { restartDelayMs: 10, watchdogIntervalMs: 30 });
    return ctrl;
  }

  test('P0: mute가 재시작 타이머를 취소해도 unmute가 반드시 재예약한다', async () => {
    const c = makeCtrl();
    c.start();
    expect(MockRec.instances.length).toBe(1);
    const rec1 = MockRec.instances[0];
    rec1.fire('start');
    rec1.fire('end'); // → 10ms 재시작 예약
    c.muteForTts();   // 타이머 경과 전 취소 (구 코드의 사멸 지점)

    await sleep(30);
    // mute 동안엔 재시작 금지 (barge-in 명령 경로는 handleFinal 필터가 담당)
    expect(MockRec.instances.length).toBe(1);

    c.unmuteForTts(); // ← 수정의 핵심: 취소했던 재시작을 되살린다
    await waitFor(() => MockRec.instances.length === 2);
    const rec2 = MockRec.instances[1];
    expect(rec2.started).toBe(true);
    rec2.fire('start');

    const events = lifecycleEvents();
    expect(events).toContain('lifecycle:restart_cancelled_by_mute');
    expect(events).toContain('lifecycle:restart_resched_after_tts');
  });

  test('P0-2: rec.start() throw 시 백오프(×2)로 무한 재시도한다', async () => {
    const c = makeCtrl();
    c.start();
    const rec1 = MockRec.instances[0];
    rec1.fire('start');
    MockRec.startThrowsRemaining = 2; // 다음 2회 재시작 시도가 throw
    rec1.fire('end'); // → 10ms 후 시도1(throw) → 20ms 후 시도2(throw) → 40ms 후 시도3(성공)

    await waitFor(() => {
      const last = MockRec.instances[MockRec.instances.length - 1];
      return MockRec.instances.length === 4 && last.started;
    });
    MockRec.instances[3].fire('start');

    const retries = lifecycleEvents().filter((e) => e.startsWith('lifecycle:restart_retry:'));
    expect(retries.length).toBeGreaterThanOrEqual(2);
    // 백오프 지연이 커진다 (10 → 20 → 40)
    expect(retries[0]).toBe('lifecycle:restart_retry:delay=20');
    expect(retries[1]).toBe('lifecycle:restart_retry:delay=40');
  });

  test('watchdog: start 이벤트가 영영 안 오는 좀비 인식기를 되살리고, 구 인스턴스의 늦은 end는 무시한다', async () => {
    const c = makeCtrl();
    c.start();
    const rec1 = MockRec.instances[0];
    rec1.fire('start');
    rec1.fire('end'); // → 재시작 예약 → rec2 생성+start() 호출되나 'start' 이벤트가 영영 안 옴(좀비)

    await waitFor(() => MockRec.instances.length === 2);
    const rec2 = MockRec.instances[1];
    expect(rec2.started).toBe(true); // start()는 호출됐지만 이벤트 무응답

    // 유예(watchdogIntervalMs) 경과 후 tick이 좀비를 감지해 rec3을 만든다
    await waitFor(() => MockRec.instances.length === 3);
    expect(rec2.aborted).toBe(true);
    const rec3 = MockRec.instances[2];
    rec3.fire('start'); // 부활 성공 → recRunning=true, watchdog 조용해짐
    expect(lifecycleEvents()).toContain('lifecycle:watchdog_restart');

    // stale-instance 가드: 버려진 rec2의 늦은 'end'가 중복 재시작을 예약하면 안 된다
    rec2.fire('end');
    await sleep(40);
    expect(MockRec.instances.length).toBe(3);
  });

  test('watchdog: TTS mute 중엔 절대 재시작하지 않는다', async () => {
    const c = makeCtrl();
    c.start();
    const rec1 = MockRec.instances[0];
    rec1.fire('start');
    rec1.fire('end');
    c.muteForTts(); // 죽은 인식기 + mute 유지

    await sleep(120); // watchdog tick 여러 번 경과
    expect(MockRec.instances.length).toBe(1);
    expect(lifecycleEvents()).not.toContain('lifecycle:watchdog_restart');
  });

  test('watchdog: 정상 가동 중엔 아무것도 하지 않는다', async () => {
    const c = makeCtrl();
    c.start();
    MockRec.instances[0].fire('start'); // recRunning=true

    await sleep(120);
    expect(MockRec.instances.length).toBe(1);
    expect(lifecycleEvents()).not.toContain('lifecycle:watchdog_restart');
  });

  test('stop()은 watchdog까지 죽인다 (suspendRecognitionForUi 계약: stop 후 어떤 재시작도 없음)', async () => {
    const c = makeCtrl();
    c.start();
    MockRec.instances[0].fire('start');
    c.stop(); // useVoiceSession.suspendRecognitionForUi가 stop()+null 처리하는 경로

    await sleep(120);
    expect(MockRec.instances.length).toBe(1);
    expect(lifecycleEvents()).not.toContain('lifecycle:watchdog_restart');
  });
});
