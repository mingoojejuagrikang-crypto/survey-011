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
import { SpeechController, setBargeInEnabled, setActiveController, speak, cancelTts } from '../src/lib/speech';
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
  /** 등록된 리스너에 이벤트 디스패치 ('start' | 'end' | 'error'). */
  fire(type: string, error?: string) {
    for (const cb of this.listeners[type] ?? []) cb({ type, error } as unknown as Event);
  }
  /** onresult 이벤트 디스패치(liveness 신호). 좀비 감지는 interim 결과로도 갱신돼야 하므로
   *  isFinal 기본 false. speech.ts onResult는 e.results[last]만 읽으므로 최소 payload면 충분. */
  fireResult(transcript = '1', isFinal = false) {
    const ev = {
      type: 'result', resultIndex: 0,
      results: { length: 1, 0: { isFinal, length: 1, 0: { transcript, confidence: 0.9 } } },
    };
    for (const cb of this.listeners['result'] ?? []) cb(ev as unknown as Event);
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
    setBargeInEnabled(true);
    MockRec.reset();
    logger.clear();
    (globalThis as any).window = {
      setTimeout, clearTimeout, setInterval, clearInterval,
      webkitSpeechRecognition: MockRec,
    } as any;
  });

  test.afterEach(() => {
    setBargeInEnabled(true);
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

  // ─── FB#3 + [STT-18]: 좀비(started-but-silent) 인식기 감지 ──────────────────
  // 실기기 로그: audio-capture **에러 후** fresh 인스턴스가 start까지 성공(recRunning=true)했으나
  // onresult 0건으로 57초간 영구 사망. r1 리뷰(3모델 공통)로 판정 정밀화: 좀비 = 에러 이력
  // (erroredSinceLastResult) ∧ 실제 결과 0건(!hadResultSinceStart) ∧ stale > 유효 임계(백오프 반영)
  // ∧ start 유예 경과. 에러 이력 없는 건강한 장기 무음은 발동하지 않는다(Web Speech 명세는
  // continuous 무음 중 end 발생을 보장하지 않으므로, stale-only 판정은 오판·churn을 만든다).
  //
  // 압축 타이머 스케일(실기기 12000/4000/100ms의 축소판 — 수치가 아니라 **관계**가 계약):
  //   restartDelayMs(10) < watchdogIntervalMs(30) < zombieStaleMs(50) = start 유예(50)
  // 좀비 판정은 stale>50 **및** start 유예(lastStartAttemptAt 후 50ms 초과) 둘 다 필요하므로,
  // 감지는 인스턴스 start 후 50ms를 넘긴 첫 tick(≈60~90ms)에서 결정적으로 일어난다 —
  // "1차 tick(30ms)이 유예에 막혀 우연히 통과"하는 타이밍 의존이 아니라 유예(50) > interval(30)
  // 이라는 스케일 관계가 보장하는 동작이다.
  function makeZombieCtrl() {
    ctrl = new SpeechController(
      { onFinal: () => {} },
      { restartDelayMs: 10, watchdogIntervalMs: 30, zombieStaleMs: 50 },
    );
    return ctrl;
  }

  test('좀비: 에러 후 fresh 인스턴스가 결과 0건으로 임계를 넘기면 감지·재시작한다', async () => {
    const c = makeZombieCtrl();
    c.start();
    const rec1 = MockRec.instances[0];
    rec1.fire('start');
    rec1.fire('error', 'audio-capture'); // 확인된 실기기 사망 시그니처 → 좀비 자격
    rec1.fire('end');   // 스펙상 error 후 항상 end → scheduleRestart(10ms) → fresh rec2

    await waitFor(() => MockRec.instances.length === 2);
    const rec2 = MockRec.instances[1];
    rec2.fire('start'); // recRunning=true, 결과는 영영 0건 — 실기기 좀비 재현

    // 유효 임계(50ms)+유예 경과 후 watchdog tick이 좀비를 감지해 fresh 인스턴스를 만든다.
    await waitFor(() => MockRec.instances.length === 3, 2000);
    expect(rec2.aborted).toBe(true);
    const rec3 = MockRec.instances[2];
    expect(rec3.started).toBe(true);
    rec3.fire('start'); // 부활 → recRunning=true, lastResultAt 재앵커

    const zombie = lifecycleEvents().filter((e) => e.startsWith('lifecycle:zombie_restart:stale_ms='));
    expect(zombie.length).toBeGreaterThanOrEqual(1);
    // stale_ms 값은 zombieStaleMs(50)를 초과해야 트리거된 것 + 연속 횟수 n=1 동봉.
    expect(Number(zombie[0].split('stale_ms=')[1].split(',')[0])).toBeGreaterThan(50);
    expect(zombie[0]).toMatch(/^lifecycle:zombie_restart:stale_ms=\d+,n=1$/);
  });

  test('좀비 미발동(r1 핵심 회귀): 에러 이력 없는 건강한 인식기는 임계 초과 장기 무음에도 재시작하지 않는다', async () => {
    const c = makeZombieCtrl();
    c.start();
    const rec1 = MockRec.instances[0];
    rec1.fire('start');
    // 에러 0건·결과 0건·natural end도 미발생(명세상 continuous 무음 중 end 보장 없음) = 사용자가
    // 그냥 오래 말이 없는 것. 구 stale-only 판정이면 여기서 abort→재시작 churn이 났다.
    await sleep(200); // zombieStaleMs(50)의 4배 경과
    expect(MockRec.instances.length).toBe(1); // 재시작 없음
    expect(lifecycleEvents().some((e) => e.startsWith('lifecycle:zombie_restart'))).toBe(false);
  });

  test('좀비 미발동: 에러 후라도 결과가 1건이라도 오면 이후 무음에 재시작하지 않는다', async () => {
    const c = makeZombieCtrl();
    c.start();
    const rec1 = MockRec.instances[0];
    rec1.fire('start');
    rec1.fire('error', 'audio-capture'); // erroredSinceLastResult=true
    rec1.fireResult('1', false); // interim 1건 = 건강 증명 → 에러 플래그·streak 해제
    await sleep(200);            // 임계(50) 훨씬 초과 무음
    expect(MockRec.instances.length).toBe(1); // 재시작 없음
    expect(lifecycleEvents().some((e) => e.startsWith('lifecycle:zombie_restart'))).toBe(false);
  });

  test('좀비 백오프: 결과 없는 연속 좀비 재시작 시 유효 임계가 ×2로 배가된다', async () => {
    const c = makeZombieCtrl();
    c.start();
    const rec1 = MockRec.instances[0];
    rec1.fire('start');
    rec1.fire('error', 'audio-capture');
    rec1.fire('end');
    await waitFor(() => MockRec.instances.length === 2);
    MockRec.instances[1].fire('start'); // fresh 인스턴스, 결과 0건

    // 1차 좀비: 유효 임계 50ms → rec3
    await waitFor(() => MockRec.instances.length === 3, 2000);
    MockRec.instances[2].fire('start'); // 여전히 결과 0건 — streak=1, 유효 임계 100ms로 배가
    // 2차 좀비: 배가된 임계(100ms)를 넘겨야 발동 → rec4
    await waitFor(() => MockRec.instances.length === 4, 3000);

    const zombie = lifecycleEvents().filter((e) => e.startsWith('lifecycle:zombie_restart:stale_ms='));
    expect(zombie.length).toBe(2);
    expect(zombie[0]).toContain(',n=1');
    expect(zombie[1]).toContain(',n=2');
    // 2차 stale_ms는 배가된 임계(100)를 초과해야 트리거된 것 — 임계 배가의 관측 가능한 증거.
    expect(Number(zombie[1].split('stale_ms=')[1].split(',')[0])).toBeGreaterThan(100);
  });

  test('좀비 미발동(자연 순환): 정상 무음 자연 end→restart 순환은 오발동하지 않는다', async () => {
    const c = makeZombieCtrl();
    c.start();
    // iOS 정상 무음: recRunning이 start↔end로 주기적 토글되므로 zombieStaleMs 넘게 고착되지 않고,
    // [STT-18] 이후로는 에러 이력도 없어 이중으로 면제된다.
    for (let i = 0; i < 4; i++) {
      const rec = MockRec.instances[MockRec.instances.length - 1];
      rec.fire('start');       // recRunning=true (lastResultAt 재앵커)
      await sleep(20);         // zombieStaleMs(50) 미만 유지
      rec.fire('end');         // recRunning=false → scheduleRestart → 새 인스턴스
      await waitFor(() => MockRec.instances.length === i + 2, 1000);
    }
    expect(lifecycleEvents().some((e) => e.startsWith('lifecycle:zombie_restart'))).toBe(false);
  });

  for (const kind of ['no-speech', 'aborted', 'not-allowed']) {
    test(`좀비 미발동: ${kind} 오류는 fresh 인스턴스의 장기 무음에 자격을 주지 않는다`, async () => {
      const c = makeZombieCtrl();
      c.start();
      const rec1 = MockRec.instances[0];
      rec1.fire('start');
      rec1.fire('error', kind);
      rec1.fire('end');
      await waitFor(() => MockRec.instances.length === 2);
      MockRec.instances[1].fire('start');
      await sleep(200);
      expect(MockRec.instances.length).toBe(2);
      expect(lifecycleEvents().some((e) => e.startsWith('lifecycle:zombie_restart'))).toBe(false);
    });
  }

  test('TTS mute는 mute 구간만 stale에서 제외하고, 반복 unmute가 기존 무응답 시간을 지우지 않는다', async () => {
    const c = makeZombieCtrl();
    c.start();
    const rec1 = MockRec.instances[0];
    rec1.fire('start');
    rec1.fire('error', 'audio-capture');
    rec1.fire('end');
    await waitFor(() => MockRec.instances.length === 2);
    MockRec.instances[1].fire('start');

    // 실제 무응답 30ms + mute 25ms + 실제 무응답 30ms = 60ms > 임계 50ms.
    // 종전 코드는 unmute마다 lastResultAt=now라 마지막 30ms만 남아 복구가 무기한 밀렸다.
    await sleep(30);
    c.muteForTts();
    await sleep(25);
    c.unmuteForTts();
    await sleep(30);
    await waitFor(() => MockRec.instances.length === 3, 2000);
    expect(lifecycleEvents().some((e) => /^lifecycle:zombie_restart:stale_ms=\d+,n=1$/.test(e))).toBe(true);
  });
});

test.describe('Hybrid — output boundary and ready beep', () => {
  let ctrl: SpeechController | null = null;
  test.beforeEach(() => {
    MockRec.reset(); logger.clear(); setBargeInEnabled(true);
    (globalThis as any).window = { setTimeout, clearTimeout, setInterval, clearInterval, webkitSpeechRecognition: MockRec };
  });
  test.afterEach(() => {
    ctrl?.stop(); ctrl = null; setBargeInEnabled(true); logger.clear(); MockRec.reset();
    delete (globalThis as any).window;
  });

  function startHybrid(onFinal: (text: string) => void | Promise<void> = () => {}, deferMs = 40) {
    ctrl = new SpeechController({ onFinal }, { hybridOption: true, hybridDeferMs: deferMs, watchdogIntervalMs: 1000 });
    ctrl.start(); MockRec.instances[0].fire('start');
    return ctrl;
  }
  function ttsStart(c: SpeechController) {
    c.muteForTts();
    const seq = c.beginOutput('tts'); c.outputEdge(seq, 'tts', 'start');
    return seq;
  }
  function ttsEnd(c: SpeechController, seq: number, evt: 'end' | 'watchdog' | 'error' = 'end') {
    c.outputEdge(seq, 'tts', evt); c.unmuteForTts();
  }

  test('hybrid F4: iOS controller applies without opt-in even with frozen UA version', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true,
      value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)', maxTouchPoints: 5 } });
    try {
      ctrl = new SpeechController({ onFinal: () => {} }, { hybridOption: false });
      ctrl.start(); MockRec.instances[0].fire('start');
      ttsEnd(ctrl, ttsStart(ctrl));
      expect(MockRec.instances).toHaveLength(2);
      expect(logger.getAll().some((e) => e.extra === 'stt_hybrid_policy:platform=ios,option=0,enabled=1,bargeIn=1')).toBe(true);
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete (globalThis as any).navigator;
    }
  });

  test('hybrid F4: end swaps once, stale events cannot commit, second value is delivered once', () => {
    const values: string[] = [];
    const c = startHybrid((text) => { values.push(text); });
    const old = MockRec.instances[0]; old.fireResult('54.6', true);
    const seq = ttsStart(c);
    expect(old.aborted).toBe(false); // barge-in listening remains alive during TTS
    ttsEnd(c, seq);
    expect(old.aborted).toBe(true);
    expect(MockRec.instances).toHaveLength(2);
    expect(MockRec.instances[1].started).toBe(true);
    ttsEnd(c, seq); // duplicate native edge
    old.fire('end'); old.fire('error', 'audio-capture'); old.fire('start'); old.fireResult('999', true);
    expect(MockRec.instances).toHaveLength(2);
    MockRec.instances[1].fire('start'); MockRec.instances[1].fireResult('23.4', true);
    expect(values).toEqual(['54.6', '23.4']);
    expect(logger.getAll().filter((e) => e.extra?.startsWith('stt_hybrid_swap:'))).toHaveLength(1);
  });

  test('F5 P1-1: started error owes a swap, but preserves the pending final callback', async () => {
    const values: string[] = [];
    let finish!: () => void;
    const c = startHybrid((text) => new Promise<void>((resolve) => {
      values.push(text); finish = resolve;
    }), 500);
    const old = MockRec.instances[0];
    const seq = ttsStart(c); old.fireResult('수정 14');
    ttsEnd(c, seq, 'error');
    expect(old.aborted).toBe(false);
    old.fireResult('수정 140', true);
    expect(MockRec.instances).toHaveLength(1);
    finish(); await sleep(0);
    expect(values).toEqual(['수정 140']);
    expect(old.aborted).toBe(true);
    expect(MockRec.instances).toHaveLength(2);
    ttsEnd(c, seq, 'error');
    expect(MockRec.instances).toHaveLength(2);
  });

  test('hybrid F4: an interim during TTS defers swap until its final callback completes', async () => {
    const values: string[] = [];
    let finish!: () => void;
    const c = startHybrid((text) => new Promise<void>((resolve) => {
      values.push(text); finish = resolve;
    }), 200);
    const old = MockRec.instances[0];
    const seq = ttsStart(c); old.fireResult('수정 14');
    ttsEnd(c, seq);
    expect(MockRec.instances).toHaveLength(1);
    expect(old.aborted).toBe(false);
    old.fireResult('수정 140', true);
    expect(values).toEqual(['수정 140']);
    expect(MockRec.instances).toHaveLength(1);
    finish(); await sleep(0);
    expect(MockRec.instances).toHaveLength(2);
    expect(logger.getAll().some((e) => e.extra?.startsWith('stt_hybrid_swap:reason=deferred_final,'))).toBe(true);
  });

  test('hybrid F4: final can synchronously finish TTS without being cut before processing', () => {
    const trace: string[] = [];
    let seq = 0;
    const c = startHybrid(() => {
      ttsEnd(c, seq);
      expect(MockRec.instances).toHaveLength(1);
      trace.push('committed');
    });
    seq = ttsStart(c); MockRec.instances[0].fireResult('140', true);
    expect(trace).toEqual(['committed']);
    expect(MockRec.instances).toHaveLength(2);
  });

  test('hybrid F4: missing final swaps at the bounded deadline, no late double commit', async () => {
    const values: string[] = [];
    const c = startHybrid((text) => { values.push(text); });
    const old = MockRec.instances[0]; const seq = ttsStart(c); old.fireResult('14');
    ttsEnd(c, seq);
    await sleep(15); expect(MockRec.instances).toHaveLength(1);
    await waitFor(() => MockRec.instances.length === 2);
    old.fireResult('140', true); expect(values).toEqual([]);
    expect(logger.getAll().some((e) => e.extra?.startsWith('stt_hybrid_swap:reason=defer_timeout,'))).toBe(true);
    await sleep(50); expect(MockRec.instances).toHaveLength(2);
  });

  test('hybrid F4: even a missing TTS onstart watchdog preserves the active utterance', () => {
    const values: string[] = [];
    const c = startHybrid((text) => { values.push(text); });
    c.muteForTts(); const seq = c.beginOutput('tts');
    MockRec.instances[0].fireResult('14');
    ttsEnd(c, seq, 'watchdog');
    expect(MockRec.instances).toHaveLength(1);
    MockRec.instances[0].fireResult('140', true);
    expect(values).toEqual(['140']); expect(MockRec.instances).toHaveLength(2);
  });

  test('hybrid F4: watchdog completion swaps once and late native end is inert', () => {
    const c = startHybrid(); const seq = ttsStart(c);
    ttsEnd(c, seq, 'watchdog');
    expect(MockRec.instances).toHaveLength(2);
    ttsEnd(c, seq);
    expect(MockRec.instances).toHaveLength(2);
  });

  test('hybrid F4: a brief background return preserves the owed swap', async () => {
    const c = startHybrid(); const seq = ttsStart(c);
    MockRec.instances[0].fireResult('14'); ttsEnd(c, seq);
    c.onBackgroundHidden();
    c.kick();
    await waitFor(() => MockRec.instances.length === 2);
    expect(MockRec.instances[1].started).toBe(true);
    expect(logger.getAll().some((e) => e.extra?.startsWith('stt_hybrid_swap:reason=defer_timeout,'))).toBe(true);
  });

  test('hybrid F4: stop cancels pending swap', async () => {
    const c = startHybrid(); const seq = ttsStart(c);
    MockRec.instances[0].fireResult('14'); ttsEnd(c, seq); c.stop();
    await sleep(65); expect(MockRec.instances).toHaveLength(1);
  });

  test('hybrid F4: natural restart during deferral invalidates the old swap', async () => {
    const c = startHybrid(() => {}, 200); const seq = ttsStart(c);
    MockRec.instances[0].fireResult('14'); ttsEnd(c, seq); MockRec.instances[0].fire('end');
    await waitFor(() => MockRec.instances.length === 2);
    await sleep(220); expect(MockRec.instances).toHaveLength(2);
  });

  test('hybrid F4: non-iOS default remains unchanged, OFF remains half-duplex with opt-in', async () => {
    ctrl = new SpeechController({ onFinal: () => {} }, { watchdogIntervalMs: 1000 });
    ctrl.start(); MockRec.instances[0].fire('start');
    ttsEnd(ctrl, ttsStart(ctrl)); expect(MockRec.instances).toHaveLength(1);
    ctrl.stop(); setBargeInEnabled(false);
    const c = startHybrid(); const old = MockRec.instances.at(-1)!;
    const seq = ttsStart(c); expect(old.aborted).toBe(true); old.fire('end');
    ttsEnd(c, seq); expect(MockRec.instances).toHaveLength(2);
    await waitFor(() => MockRec.instances.length === 3);
    expect(logger.getAll().filter((e) => e.extra?.startsWith('stt_hybrid_swap:'))).toHaveLength(0);
  });

  test('ready beep: OFF waits for real onstart, observes first result, and never repeats on consecutive restarts', async () => {
    setBargeInEnabled(false);
    const heard: number[] = [];
    ctrl = new SpeechController({ onFinal: () => {}, onReadyToListen: (inst) => heard.push(inst) },
      { restartDelayMs: 10, watchdogIntervalMs: 1000 });
    ctrl.start();
    expect(heard).toEqual([]);
    const first = MockRec.instances[0];
    first.fire('start');
    first.fire('start');
    expect(heard).toEqual([1]);
    first.fire('error', 'audio-capture');
    first.fire('end');
    await waitFor(() => MockRec.instances.length === 2);
    MockRec.instances[1].fire('start');
    expect(heard).toEqual([1]); // failed listen must not make a chirp loop
    const events = logger.getAll().map((e) => e.extra);
    expect(events).toContainEqual(expect.stringMatching(/^ready_beep:inst=1,phase=error,ms=\d+,anchor=onstart,code=audio-capture$/));
    expect(events).toContainEqual(expect.stringMatching(/^ready_beep:inst=1,phase=end,ms=\d+,anchor=onstart$/));

    ctrl.muteForTts();
    MockRec.instances[1].fire('end');
    ctrl.unmuteForTts();
    await waitFor(() => MockRec.instances.length === 3);
    MockRec.instances[2].fire('start');
    expect(heard).toEqual([1, 3]);
    MockRec.instances[2].fireResult('7');
    expect(logger.getAll().map((e) => e.extra)).toContainEqual(
      expect.stringMatching(/^ready_beep:inst=3,phase=first_result,ms=\d+,anchor=onstart$/));
  });

  test('ready beep: ON gives no cue, OFF waits for successful start', async () => {
    const heard: number[] = [];
    ctrl = new SpeechController({ onFinal: () => {}, onReadyToListen: (inst) => heard.push(inst) });
    ctrl.start(); MockRec.instances[0].fire('start');
    expect(heard).toEqual([]);
    ctrl.stop();
    setBargeInEnabled(false);
    ctrl = new SpeechController({ onFinal: () => {}, onReadyToListen: (inst) => heard.push(inst) });
    MockRec.startThrowsRemaining = 1;
    ctrl.start();
    expect(heard).toEqual([]);
    await waitFor(() => MockRec.instances.length >= 3);
    MockRec.instances.at(-1)!.fire('start');
    expect(heard).toEqual([2]);
  });

  test('ready beep: first session cue waits for field output and onstart', () => {
    setBargeInEnabled(false);
    const heard: number[] = [];
    ctrl = new SpeechController({ onFinal: () => {}, onReadyToListen: (inst) => heard.push(inst) },
      { deferInitialReadyBeep: true });
    ctrl.start(); MockRec.instances[0].fire('start');
    expect(heard).toEqual([]);
    const tts = ctrl.beginOutput('tts');
    ctrl.enableReadyBeep();
    expect(heard).toEqual([]);
    ctrl.outputEdge(tts, 'tts', 'end');
    expect(heard).toEqual([1]);
  });

  test('ready beep: first result latency is anchored to actual cue output end', () => {
    setBargeInEnabled(false);
    ctrl = new SpeechController({ onFinal: () => {}, onReadyToListen: () => {
      const seq = ctrl!.beginOutput('ready_beep');
      ctrl!.outputEdge(seq, 'ready_beep', 'end');
    } });
    ctrl.start();
    MockRec.instances[0].fire('start');
    MockRec.instances[0].fireResult('8');
    expect(logger.getAll().map((e) => e.extra)).toContainEqual(
      expect.stringMatching(/^ready_beep:inst=1,phase=first_result,ms=\d+,anchor=output_end$/));
  });

  test('ready beep: OFF keeps its watchdog fresh restart but waits for real output end to sound', async () => {
    setBargeInEnabled(false);
    const heard: number[] = [];
    ctrl = new SpeechController({ onFinal: () => {}, onReadyToListen: (inst) => heard.push(inst) },
      { restartDelayMs: 10, watchdogIntervalMs: 1000 });
    ctrl.start(); MockRec.instances[0].fire('start');
    expect(heard).toEqual([1]);
    const tts = ctrl.beginOutput('tts');
    ctrl.muteForTts(); MockRec.instances[0].fire('end');
    ctrl.outputEdge(tts, 'tts', 'watchdog');
    ctrl.unmuteForTts();
    await waitFor(() => MockRec.instances.length === 2);
    MockRec.instances[1].fire('start');
    expect(heard).toEqual([1]);
    ctrl.outputEdge(tts, 'tts', 'end');
    expect(heard).toEqual([1, 2]);
  });
});

// Exercise real speak() → native callbacks → controller wiring, not just outputEdge.
test.describe('F5 — native TTS error / missing cancel completion', () => {
  let ctrl: SpeechController;
  let utterances: SpeechSynthesisUtterance[];
  let heard: number[];
  let engine: { speaking: boolean; pending: boolean; cancel: () => void; speak: (u: SpeechSynthesisUtterance) => void };
  let cancels: number;

  test.beforeEach(() => {
    MockRec.reset(); logger.clear(); setBargeInEnabled(true);
    utterances = []; heard = []; cancels = 0;
    engine = {
      speaking: false, pending: false,
      speak: (u) => { utterances.push(u); engine.speaking = true; },
      cancel: () => { cancels++; engine.speaking = false; engine.pending = false; },
    };
    (globalThis as any).window = { setTimeout, clearTimeout, setInterval, clearInterval,
      webkitSpeechRecognition: MockRec, speechSynthesis: engine };
    (globalThis as any).SpeechSynthesisUtterance = class {
      constructor(public text: string) {}
    };
  });
  test.afterEach(() => {
    engine.cancel = () => { engine.speaking = false; engine.pending = false; };
    setActiveController(null); cancelTts(); ctrl?.stop();
    setBargeInEnabled(true); logger.clear(); MockRec.reset();
    delete (globalThis as any).window;
    delete (globalThis as any).SpeechSynthesisUtterance;
  });
  function start(bargeIn: boolean, hybridOption = true) {
    setBargeInEnabled(bargeIn);
    ctrl = new SpeechController({ onFinal: () => {}, onReadyToListen: (inst) => heard.push(inst) },
      { hybridOption, restartDelayMs: 10, watchdogIntervalMs: 10_000 });
    setActiveController(ctrl); ctrl.start(); MockRec.instances[0].fire('start');
  }
  function event(u: SpeechSynthesisUtterance, type: 'start' | 'end' | 'error') {
    (u[`on${type}`] as (() => void) | null)?.();
  }

  for (const [bargeIn, hybridOption] of [[true, false], [false, false], [false, true], [true, true]]) {
    test(`F6 P1-3: error queue bargeIn=${bargeIn} option=${hybridOption} preserves B outside hybrid`, async () => {
      start(bargeIn, hybridOption);
      const queue: SpeechSynthesisUtterance[] = [];
      const played: string[] = [];
      engine.speak = (u) => { utterances.push(u); queue.push(u); engine.pending = true; };
      engine.cancel = () => {
        cancels++; queue.length = 0; engine.speaking = false; engine.pending = false;
      };
      const playNext = () => {
        const u = queue.shift()!;
        engine.pending = queue.length > 0; engine.speaking = true;
        played.push(u.text); event(u, 'start');
        return u;
      };
      let secondDone = false;
      const first = speak('첫 안내', { interrupt: false });
      const second = speak('다음 안내', { interrupt: false }).then(() => { secondDone = true; });
      const a = playNext();
      expect(queue).toHaveLength(1);
      event(a, 'error'); await first;
      if (bargeIn && hybridOption) {
        await second;
        expect(cancels).toBe(1); expect(queue).toHaveLength(0);
        expect(played).toEqual(['첫 안내']);
      } else {
        expect(cancels).toBe(0); expect(queue).toHaveLength(1);
        expect(secondDone).toBe(false);
        const b = playNext();
        expect(played).toEqual(['첫 안내', '다음 안내']);
        expect(secondDone).toBe(false);
        engine.speaking = false; event(b, 'end'); await second;
        expect(secondDone).toBe(true); expect(cancels).toBe(0);
      }
    });
  }

  // r7 P1 — hybrid cancel synchronously errors the never-started queued B while A's
  // audio is still out. B's done() must not release the mute A's started output owns.
  for (const trigger of ['error', 'watchdog'] as const) {
    test(`r7 P1: queued B sync onerror during A ${trigger} cancel keeps mute until engine silence`, async () => {
      setBargeInEnabled(true);
      const finals: { text: string; muted: boolean }[] = [];
      ctrl = new SpeechController({ onFinal: (text) => { finals.push({ text, muted: ctrl.isTtsMuted() }); } },
        { hybridOption: true, restartDelayMs: 10, watchdogIntervalMs: 10_000 });
      setActiveController(ctrl); ctrl.start(); MockRec.instances[0].fire('start');
      const old = MockRec.instances[0];
      const queue: SpeechSynthesisUtterance[] = [];
      engine.speak = (u) => { utterances.push(u); queue.push(u); engine.pending = true; };
      engine.cancel = () => {
        cancels++;
        const dropped = queue.splice(0);
        engine.pending = false; // A's output stays audible: speaking remains true
        for (const u of dropped) event(u, 'error');
      };
      const first = speak('1', { interrupt: false });
      const second = speak('2', { interrupt: false });
      const a = queue.shift()!;
      engine.pending = queue.length > 0; engine.speaking = true; event(a, 'start');
      if (trigger === 'error') event(a, 'error');
      await first; await second; // watchdog: A's 2.5s end watchdog cancels the engine
      expect(cancels).toBe(1);
      expect(engine.speaking).toBe(true);
      expect(ctrl.isTtsMuted()).toBe(true);
      expect(old.aborted).toBe(false); expect(MockRec.instances).toHaveLength(1);
      old.fireResult('999', true); // echo reaching the old recognizer is filtered by the app mute gate
      expect(finals).toEqual([{ text: '999', muted: true }]);
      engine.speaking = false;
      await waitFor(() => MockRec.instances.length === 2);
      expect(ctrl.isTtsMuted()).toBe(false); expect(old.aborted).toBe(true);
      expect(logger.getAll().filter((e) => e.extra?.startsWith('stt_hybrid_swap:'))).toHaveLength(1);
    });
  }

  test('F6 P1-1: cancel throw keeps mute and old recognizer, bounds polling, then accepts late native end', async () => {
    start(true);
    const old = MockRec.instances[0];
    engine.cancel = () => { cancels++; throw new Error('native cancel failed'); };
    const p = speak('1'); const u = utterances[0]; event(u, 'start');
    event(u, 'error'); await p;
    expect(cancels).toBe(1);
    expect(logger.getAll().map((e) => e.extra)).toContain('tts_error_cancel_failed');
    expect(ctrl.isTtsMuted()).toBe(true);
    expect(old.aborted).toBe(false); expect(MockRec.instances).toHaveLength(1);
    // A natural end / foreground kick cannot route around the completion hold.
    old.fire('end'); ctrl.kick(); await sleep(100);
    expect(MockRec.instances).toHaveLength(1);
    let reads = 0;
    let speaking = true;
    Object.defineProperty(engine, 'speaking', { configurable: true,
      get: () => { reads++; return speaking; }, set: (value: boolean) => { speaking = value; } });
    await waitFor(() => logger.getAll().some((e) => e.extra === 'tts_engine_silence_timeout'), 3000);
    const readsAtExpiry = reads;
    await sleep(150);
    expect(reads).toBe(readsAtExpiry);
    expect(logger.getAll().filter((e) => e.extra === 'tts_engine_silence_timeout')).toHaveLength(1);
    expect(ctrl.isTtsMuted()).toBe(true);
    expect(old.aborted).toBe(false); expect(MockRec.instances).toHaveLength(1);
    Object.defineProperty(engine, 'speaking', { configurable: true, writable: true, value: false });
    event(u, 'end');
    expect(ctrl.isTtsMuted()).toBe(false);
    expect(old.aborted).toBe(true); expect(MockRec.instances).toHaveLength(2);
    event(u, 'end'); expect(MockRec.instances).toHaveLength(2);
  });

  test('F6 P1-1: asynchronous cancel waits for both engine flags without a native end', async () => {
    start(true);
    const old = MockRec.instances[0];
    engine.cancel = () => { cancels++; }; // returns successfully before native output stops
    const p = speak('1'); event(utterances[0], 'start');
    event(utterances[0], 'error'); await p;
    await sleep(350);
    expect(ctrl.isTtsMuted()).toBe(true);
    expect(old.aborted).toBe(false); expect(MockRec.instances).toHaveLength(1);
    engine.pending = true; engine.speaking = false;
    await sleep(100); expect(MockRec.instances).toHaveLength(1);
    engine.pending = false;
    await waitFor(() => MockRec.instances.length === 2);
    expect(ctrl.isTtsMuted()).toBe(false); expect(old.aborted).toBe(true);
    await sleep(100); expect(MockRec.instances).toHaveLength(2);
  });

  test('F6 P1-1: stop cancels a hybrid engine-silence wait', async () => {
    start(true);
    engine.cancel = () => { cancels++; };
    const p = speak('1'); event(utterances[0], 'start'); event(utterances[0], 'error'); await p;
    ctrl.stop(); engine.speaking = false;
    await sleep(150);
    expect(MockRec.instances).toHaveLength(1);
    expect(logger.getAll().some((e) => e.extra?.startsWith('stt_hybrid_swap:'))).toBe(false);
  });

  test('F6 P1-1: watchdog also waits for engine silence before a hybrid swap', async () => {
    start(true);
    const old = MockRec.instances[0];
    engine.cancel = () => { cancels++; };
    await speak('1'); // real start watchdog, cancel returns before the engine is quiet
    await sleep(350);
    expect(ctrl.isTtsMuted()).toBe(true);
    expect(old.aborted).toBe(false); expect(MockRec.instances).toHaveLength(1);
    engine.speaking = false;
    await waitFor(() => MockRec.instances.length === 2);
    expect(ctrl.isTtsMuted()).toBe(false); expect(old.aborted).toBe(true);
  });

  test('F6 P1-1: late completion cannot release mute owned by a newer output', async () => {
    start(true);
    engine.cancel = () => { cancels++; };
    const first = speak('1'); event(utterances[0], 'start'); event(utterances[0], 'error'); await first;
    const second = speak('2'); event(utterances[1], 'start');
    MockRec.instances[0].fire('end'); await sleep(30);
    engine.speaking = false; // engine flags can fall before the current native callback
    event(utterances[0], 'end');
    expect(ctrl.isTtsMuted()).toBe(true); expect(MockRec.instances).toHaveLength(1);
    event(utterances[1], 'end'); await second;
    expect(ctrl.isTtsMuted()).toBe(false); expect(MockRec.instances).toHaveLength(2);
  });

  for (const startBeforeSilence of [true, false]) {
    test(`F6 P1-2: late engine silence recovers the SAME ready cue, onstart first=${startBeforeSilence}`, async () => {
      start(false);
      engine.cancel = () => { cancels++; };
      const p = speak('1'); MockRec.instances[0].fire('end'); await p;
      await waitFor(() => MockRec.instances.length === 2);
      const fresh = MockRec.instances[1];
      if (startBeforeSilence) fresh.fire('start');
      await sleep(350); // native end/error never arrives, beyond the 250ms token expiry
      expect(logger.getAll().map((e) => e.extra)).toContain('tts_cancel_settled:seq=1,reason=native_timeout');
      expect(heard).toEqual([1]);
      engine.speaking = false; engine.pending = true;
      await sleep(100); expect(heard).toEqual([1]);
      engine.pending = false;
      if (!startBeforeSilence) {
        await sleep(100); expect(heard).toEqual([1]);
        fresh.fire('start');
      }
      await waitFor(() => heard.length === 2);
      expect(heard).toEqual([1, 2]);
      fresh.fire('start'); await sleep(150);
      expect(heard).toEqual([1, 2]); expect(MockRec.instances).toHaveLength(2);
    });
  }

  test('F6 P1-2: stop cancels a ready-cue engine-silence wait', async () => {
    start(false);
    engine.cancel = () => { cancels++; };
    const p = speak('1'); MockRec.instances[0].fire('end'); await p;
    await waitFor(() => MockRec.instances.length === 2);
    MockRec.instances[1].fire('start'); await sleep(350);
    ctrl.stop(); engine.speaking = false;
    await sleep(150); expect(heard).toEqual([1]);
  });

  test('F6 P1-2: a newer announcement invalidates the previous pending cue', async () => {
    start(false);
    engine.cancel = () => { cancels++; };
    const p = speak('1'); MockRec.instances[0].fire('end'); await p;
    await waitFor(() => MockRec.instances.length === 2);
    MockRec.instances[1].fire('start'); await sleep(350); // actively polling now
    const next = speak('2'); event(utterances[1], 'start'); MockRec.instances[1].fire('end');
    engine.speaking = false; // flags alone cannot bypass the new output/mute boundary
    await sleep(150); expect(heard).toEqual([1]);
    event(utterances[1], 'end'); await next;
    await waitFor(() => MockRec.instances.length === 3);
    expect(heard).toEqual([1]);
    MockRec.instances[2].fire('start');
    expect(heard).toEqual([1, 3]);
  });

  for (const started of [false, true]) {
    test(`F5 P1-1: native error started=${started} cancels before swapping only a played TTS`, async () => {
      start(true);
      const old = MockRec.instances[0];
      const p = speak('1'); const u = utterances[0];
      if (started) event(u, 'start');
      const duringCancel: boolean[][] = [];
      engine.cancel = () => {
        cancels++;
        event(u, 'end'); // synchronous reentry must not swap inside cancel
        duringCancel.push([old.aborted, ctrl.isTtsMuted()]);
        engine.speaking = false; engine.pending = false;
      };
      event(u, 'error'); await p;
      expect(ctrl.isTtsMuted()).toBe(false);
      expect(cancels).toBe(started ? 1 : 0);
      expect(duringCancel).toEqual(started ? [[false, true]] : []);
      expect(old.aborted).toBe(started);
      expect(MockRec.instances).toHaveLength(started ? 2 : 1);
      event(u, 'error'); event(u, 'end');
      expect(MockRec.instances).toHaveLength(started ? 2 : 1);
    });
  }

  test('F5 P1-2: missing native end after watchdog cancel recovers this and the next ready beep', async () => {
    start(false);
    expect(heard).toEqual([1]);
    const p = speak('1'); event(utterances[0], 'start'); MockRec.instances[0].fire('end');
    await p; // real watchdog cancels; NEVER inject native end/error for utterance 0
    expect(cancels).toBe(1);
    await waitFor(() => MockRec.instances.length === 2);
    MockRec.instances[1].fire('start');
    expect(heard).toEqual([1]); // not before the cancellation settle window
    await waitFor(() => heard.length === 2);
    expect(heard).toEqual([1, 2]);
    expect(logger.getAll().map((e) => e.extra)).toContain('tts_cancel_settled:seq=1,reason=native_timeout');
    const next = speak('2'); event(utterances[1], 'start'); MockRec.instances[1].fire('end');
    engine.speaking = false; event(utterances[1], 'end'); await next;
    await waitFor(() => MockRec.instances.length === 3);
    MockRec.instances[2].fire('start');
    expect(heard).toEqual([1, 2, 3]);
    await sleep(300); expect(heard).toEqual([1, 2, 3]);
  });

  test('F5 P1-2: cancel deadline cannot sound over a newer TTS; its normal end restores the cue', async () => {
    start(false);
    const p = speak('1'); MockRec.instances[0].fire('end'); await p;
    await waitFor(() => MockRec.instances.length === 2);
    MockRec.instances[1].fire('start');
    const next = speak('2'); event(utterances[1], 'start'); MockRec.instances[1].fire('end');
    await sleep(300);
    expect(heard).toEqual([1]);
    engine.speaking = false; event(utterances[1], 'end'); await next;
    await waitFor(() => MockRec.instances.length === 3);
    MockRec.instances[2].fire('start'); expect(heard).toEqual([1, 3]);
  });

  test('F5 P1-2: engine still reporting output blocks the cue after token expiry', async () => {
    start(false);
    engine.cancel = () => { cancels++; }; // cancellation did not yet stop native output
    const p = speak('1'); MockRec.instances[0].fire('end'); await p;
    await waitFor(() => MockRec.instances.length === 2);
    MockRec.instances[1].fire('start'); await sleep(300);
    expect(heard).toEqual([1]);
    const next = speak('2'); event(utterances[1], 'start'); MockRec.instances[1].fire('end');
    engine.speaking = false; event(utterances[1], 'end'); await next;
    await waitFor(() => MockRec.instances.length === 3);
    MockRec.instances[2].fire('start'); expect(heard).toEqual([1, 3]);
  });

  test('F5 P1-2: stop clears cancellation timer without a post-session cue or log', async () => {
    start(false);
    const p = speak('1'); MockRec.instances[0].fire('end'); await p;
    ctrl.stop(); await sleep(300);
    expect(heard).toEqual([1]);
    expect(logger.getAll().some((e) => e.extra?.startsWith('tts_cancel_settled:'))).toBe(false);
  });
});
