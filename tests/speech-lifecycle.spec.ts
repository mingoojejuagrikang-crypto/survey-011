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
