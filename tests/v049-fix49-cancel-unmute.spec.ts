/**
 * v0.49 fix49 오라클 C — `cancelTts()`는 **STT 뮤트를 즉시 푼다** (리뷰 2026-08-12 revc H-2)
 *
 * ## 왜 필요한가
 *
 * `speak()`는 `engine.speak(u)` 직전에 `muteForTts()`를 걸고, 뮤트 해제는 `done()`이 한다
 * (`onend`/`onerror` 또는 워치독). 즉 **TTS 종료 워치독 지속시간 = STT가 죽어 있는 시간의 상한**
 * 이다. v0.49 P-1이 그 상한을 2.5초 고정에서 **최대 20초**로 넓혔다(정상 발화 절단을 막는 옳은
 * 방향이지만, 「`onstart`는 왔는데 `onend`가 끝내 안 오는」 축의 피해는 8배가 됐다).
 *
 * 그런데 `cancelTts()`는 `synth.cancel()`만 불렀다 — **앱이 스스로 자른 발화**인데도 뮤트 해제를
 * 엔진 이벤트에 맡긴 것이다. iOS Safari의 「cancel() 직후 onend 미발생」은 이미 알려진 버그이고
 * (`speak()`가 50ms 지연으로 완화 중), 그게 실패하는 케이스가 정확히 이 축이다.
 * 장갑 낀 손으로 2~3m 떨어진 폰에 대고 말하는 사용자가 최대 20초간 무시된다.
 *
 * ## 처방 — revc 후보 (c), Larry 확정. clamp 20s는 **유지**한다
 *
 * cancel이 오디오를 죽이므로 TTS tail 누출은 이론상 없다(①이 그 순서를 고정한다).
 * ⚠️ clamp를 내리는 후보 (a)는 채택하지 않았다 — 긴 발화에서 워치독이 재생 중 `done()`을 불러
 * **뮤트만 풀리고 TTS는 계속** = 물림(자기입력) 재개방 위험. 20s의 실기기 판정은 P-1이 심은
 * `tts_late_end` 계측이 다음 로그 수거에서 한다.
 *
 *   ① `cancel()` **다음에** unmute — 순서가 뒤집히면 아직 살아 있는 오디오가 STT로 샌다(물림)
 *   ② 재생 중 cancel → 뮤트가 **즉시** 풀린다(엔진 이벤트를 기다리지 않는다)
 *   ③ half-duplex(barge-in OFF)에서 내려갔던 인식기가 **되살아난다** = STT 수신 재개
 *   ④ 뮤트가 아닐 때는 **아무 일도 안 한다** — `cancelTts()`는 명령 핸들러 선두에서 방어적으로
 *      수십 곳에서 불린다. 무조건 unmute하면 그 전량에 `halfDuplexHold` 해제·재시작 예약
 *      부작용이 붙는다(로그 빈도도 함께 뛴다 — _ASK-fix49 Q3).
 *   ⑤ 늦게 도착한 `onend`의 `done()`이 unmute를 **한 번 더** 불러도 재시작이 두 번 나지 않는다
 *
 * ⚠️ 이 처방이 U1/C-FIX4를 건드리지 않는 근거: interim barge-in 컷(`speech.ts:353`)은
 * `cancelTts()`가 **아니라** `synth?.cancel()`을 직접 부른다. 그래서 `handleInterim`이
 * `isTtsMuted() === true`를 읽는 전제(v0.48.1 r3 U1 4절)는 그대로 산다 — 코드로 확인했고
 * 해당 스펙 실행으로도 확인했다(worklog).
 *
 * 하네스: speech-lifecycle.spec.ts와 같은 Node 직접 import + window shim.
 */

import { test, expect } from '@playwright/test';
import { SpeechController, cancelTts, setActiveController, setBargeInEnabled } from '../src/lib/speech';
import { logger } from '../src/lib/logger';

/** 앱과 동일한 이벤트 표면을 가진 SpeechRecognition 목(speech-lifecycle.spec.ts 계보). */
class MockRec {
  static instances: MockRec[] = [];
  static reset() { MockRec.instances = []; }

  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;
  started = false;
  aborted = false;
  private listeners: Record<string, ((e: Event) => void)[]> = {};

  constructor() { MockRec.instances.push(this); }
  addEventListener(type: string, cb: (e: Event) => void) { (this.listeners[type] ??= []).push(cb); }
  removeEventListener(type: string, cb: (e: Event) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== cb);
  }
  start() { this.started = true; }
  stop() { /* noop */ }
  abort() { this.aborted = true; }
  fire(type: string) {
    for (const cb of this.listeners[type] ?? []) cb({ type } as unknown as Event);
  }
}

/** 호출 순서를 관측하는 synth 목 — ①(cancel → unmute 순서)의 계측 도구. */
const callOrder: string[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs = 1000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timeout');
    await sleep(5);
  }
}

test.describe('v0.49 fix49 — cancelTts()의 강제 unmute (STT 뮤트 사망 상한 축소)', () => {
  let ctrl: SpeechController | null = null;

  test.beforeEach(() => {
    MockRec.reset();
    logger.clear();
    callOrder.length = 0;
    (globalThis as any).window = {
      setTimeout, clearTimeout, setInterval, clearInterval,
      webkitSpeechRecognition: MockRec,
      // 🔴 v0.49 fix49b(max 리뷰 #10) — **①이 무엇을 재는지 바뀐다.** 종전엔 `cancelTts()`가
      //   import 시점에 굳은 모듈 상수를 읽어 이 하네스에서 엔진 cancel을 통째로 건너뛰었고,
      //   그래서 ①의 단언에 'cancel'이 아예 없었다(스펙 본문이 "synth를 끼워 넣을 수는 없다"고
      //   적어 둔 그 한계). fix49b가 `getEngine()`으로 통일하면서 관측이 가능해졌으므로
      //   **순서 계약의 진짜 절반**(cancel이 unmute보다 먼저)을 여기서 고정한다 —
      //   그게 없으면 cancel을 지우거나 뒤로 옮기는 회귀가 이 스펙을 전부 통과한다.
      speechSynthesis: {
        onvoiceschanged: null, getVoices: () => [],
        cancel() { callOrder.push('cancel'); },
        resume() {}, speak(_u: unknown) {},
      },
    } as any;
    setBargeInEnabled(true);
  });

  test.afterEach(() => {
    ctrl?.stop();
    ctrl = null;
    setActiveController(null);
    setBargeInEnabled(true);
    delete (globalThis as any).window;
    logger.clear();
    MockRec.reset();
  });

  /** 순서 관측용으로 unmute를 감싼 컨트롤러. 계약 자체는 원본 메서드가 수행한다.
   *  ⚠️ `watchdogIntervalMs`를 올려 쓰는 케이스가 있다 — liveness 워치독(좀비 인식기 복구)이
   *  **재시작 인스턴스를 하나 더 만들어** 「unmute가 몇 번 재시작했나」를 오염시키기 때문이다
   *  (⑤ 첫 구현이 그 3번째 인스턴스를 이중 unmute로 오판했다 — 실측으로 갈랐다). */
  function makeCtrl(watchdogIntervalMs = 30): SpeechController {
    const c = new SpeechController({ onFinal: () => {} }, { restartDelayMs: 10, watchdogIntervalMs });
    const origUnmute = c.unmuteForTts.bind(c);
    c.unmuteForTts = () => { callOrder.push('unmute'); origUnmute(); };
    ctrl = c;
    setActiveController(c);
    return c;
  }

  test('②③ 재생 중 cancel → 뮤트가 즉시 풀리고 내려갔던 인식기가 되살아난다', async () => {
    // barge-in OFF = half-duplex: muteForTts가 인식기를 **물리적으로 내린다**(v0.44.0 §D1).
    // 여기가 「STT가 죽어 있는 시간」이 실재하는 경로다.
    setBargeInEnabled(false);
    const c = makeCtrl();
    c.start();
    await waitFor(() => MockRec.instances.length === 1);
    const rec1 = MockRec.instances[0];
    rec1.fire('start');

    c.muteForTts();                       // speak()가 engine.speak 직전에 거는 것과 동일
    expect(c.isTtsMuted()).toBe(true);
    expect(rec1.aborted, 'half-duplex에서 인식기가 내려가야 한다 — 전제').toBe(true);
    rec1.fire('end');                     // abort의 'end' → restartPendingAfterTts로 보류

    await sleep(40);
    expect(MockRec.instances.length, '뮤트 중엔 재시작하지 않는다(전제)').toBe(1);

    // 🔴 여기가 처방 지점 — 엔진의 onend를 **기다리지 않는다.**
    cancelTts();
    expect(c.isTtsMuted(), 'cancel 후에도 뮤트가 남아 있다 = STT 사망이 워치독까지 이어진다').toBe(false);

    // ③ 뮤트 해제가 보류된 재시작을 되살려 STT가 실제로 돌아온다.
    await waitFor(() => MockRec.instances.length === 2, 500);
    expect(MockRec.instances[1].started).toBe(true);
  });

  test('① unmute는 cancel **다음**이다 — 순서가 뒤집히면 살아 있는 오디오가 STT로 샌다', async () => {
    const c = makeCtrl();
    c.start();
    await waitFor(() => MockRec.instances.length === 1);
    MockRec.instances[0].fire('start');
    c.muteForTts();

    // unmute는 cancelTts() **안에서** 일어나야 하고(호출 전후가 아니라), 그 앞에 cancel이 있다.
    // 🔴 fix49b(#10) 이후 **엔진 cancel까지 관측된다** — 이 한 칸이 순서 계약의 본체다:
    //   뒤집히면 아직 재생 중인 오디오가 살아 있는 인식기로 샌다(물림·자기입력).
    callOrder.push('before-cancelTts');
    cancelTts();
    callOrder.push('after-cancelTts');

    expect(callOrder).toEqual(['before-cancelTts', 'cancel', 'unmute', 'after-cancelTts']);
    expect(c.isTtsMuted()).toBe(false);
  });

  test('④ 뮤트가 아니면 아무 일도 안 한다 — 방어적 cancelTts 호출에 부작용을 붙이지 않는다', async () => {
    setBargeInEnabled(false);
    const c = makeCtrl();
    c.start();
    await waitFor(() => MockRec.instances.length === 1);
    MockRec.instances[0].fire('start');

    // 재생 중이 아니다(뮤트 아님) — 명령 핸들러 선두의 방어적 호출이 이 상태다.
    expect(c.isTtsMuted()).toBe(false);
    cancelTts();
    cancelTts();

    // ⚠️ 재는 것은 **unmute 부작용의 부재**다 — 엔진 cancel 자체는 뮤트가 아니어도 무해하게
    //   불린다(큐를 비우는 것이 이 함수의 원래 일이다. fix49b #10 이후 그게 관측된다).
    expect(callOrder.filter((c) => c === 'unmute'), 'no-op cancel이 unmute 부작용을 만들었다').toEqual([]);
    await sleep(40);
    expect(MockRec.instances.length, '유령 재시작이 생겼다').toBe(1);
  });

  test('⑤ 늦게 온 onend가 unmute를 한 번 더 불러도 재시작이 두 번 나지 않는다(멱등)', async () => {
    setBargeInEnabled(false);
    // liveness 워치독을 재운다 — 여기서 재는 것은 「unmute가 재시작을 몇 번 예약하나」다.
    const c = makeCtrl(10_000);
    c.start();
    await waitFor(() => MockRec.instances.length === 1);
    MockRec.instances[0].fire('start');
    c.muteForTts();
    MockRec.instances[0].fire('end');

    cancelTts();                              // 앱이 자른다 → 여기서 재시작 예약
    await waitFor(() => MockRec.instances.length === 2, 500);
    MockRec.instances[1].fire('start');       // 새 인식기 정상 가동

    // speak()의 done()이 뒤늦게 도착한 onend로 unmute를 한 번 더 부르는 상황.
    c.unmuteForTts();
    await sleep(60);
    expect(MockRec.instances.length, '이중 unmute가 인식기를 하나 더 만들었다').toBe(2);
  });
});

// ══ ⑥⑦ 잘린 발화의 워치독·프라미스 종결 ═══════════════════════════════════════════
//
// 🔴 unmute만으로는 **브리프가 지목한 「물림(자기입력) 미발생」 축이 안 닫힌다** — 실측으로
//   확인했다. 엔진이 `cancel()`에 `onend`를 안 쏘면(iOS 알려진 버그) 잘린 발화의 **2단 워치독이
//   살아남아**, 다음 안내가 재생되는 도중 만료되며 `done()`이 unmute를 부른다. 그 순간 재생 중인
//   TTS가 STT로 새는 창이 열린다. 처방 전 실측:
//     A(12자, 2단 상한 ~5.1s) 재생 → cancelTts() → B 재생 시작 → A 워치독 만료 → **muted=false**
//   같은 기전으로 `await say(...)`도 워치독까지 매달렸다(실측 4.9초/12자, clamp면 최대 20초).
//   → `cancelTts()`가 in-flight `speak()`의 `done()`을 드레인한다(브리프가 조건부로 연 축:
//     *"cancel 경로에서 promise도 함께 정리되면 그렇게(단, epoch·큐 계약 불변)"*).

/** 앱이 쓰는 표면만 가진 utterance 목 — 발화 이벤트는 테스트가 손으로 쏜다(p1 스펙 계보). */
class MockUtterance {
  static all: MockUtterance[] = [];
  text: string; lang = ''; rate = 1; pitch = 1; volume = 1; voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) { this.text = text; MockUtterance.all.push(this); }
}

test.describe('v0.49 fix49 — 잘린 발화의 워치독·프라미스 종결', () => {
  let muted = false;

  test.beforeEach(() => {
    MockUtterance.all = [];
    muted = false;
    // ⚠️ `speak()`는 호출 시점에 `window.speechSynthesis`를 다시 읽는다(P-1의 하네스 처방) —
    //   그래서 모듈 상수 `synth`가 이미 굳었어도 이 shim으로 발화 경로에 도달할 수 있다.
    (globalThis as any).window = {
      setTimeout, clearTimeout, setInterval, clearInterval,
      speechSynthesis: {
        onvoiceschanged: null, getVoices: () => [],
        cancel() { /* iOS 버그 케이스: onend를 쏘지 않는다 */ },
        resume() {}, speak(_u: unknown) {},
      },
      SpeechSynthesisUtterance: MockUtterance,
    } as any;
    (globalThis as any).SpeechSynthesisUtterance = MockUtterance;
    setActiveController({
      muteForTts() { muted = true; },
      unmuteForTts() { muted = false; },
      isTtsMuted() { return muted; },
    } as unknown as SpeechController);
  });

  test.afterEach(() => {
    setActiveController(null);
    delete (globalThis as any).window;
    delete (globalThis as any).SpeechSynthesisUtterance;
    MockUtterance.all = [];
  });

  test('⑥ 잘린 발화의 워치독이 **다음 발화 재생 중** unmute하지 않는다 (물림 창)', async () => {
    const { speak } = await import('../src/lib/speech');

    const A = '범위 알람 : -78%';                 // 12자 → 2단 상한 ~5.1초
    void speak(A, { interrupt: false });
    await waitFor(() => MockUtterance.all.length >= 1);
    MockUtterance.all[0].onstart?.();             // 재생 시작(2단 무장) — onend는 영영 안 온다
    await sleep(60);
    expect(muted, 'speak가 뮤트를 걸어야 한다 — 전제').toBe(true);

    cancelTts();                                   // 앱이 A를 자른다
    expect(muted).toBe(false);

    // 곧바로 다음 안내 B(앱의 주 경로).
    const B = '입력이 끝났습니다. 종료하려면 종료라고 말씀하거나 종료 버튼을 누르세요.';
    void speak(B, { interrupt: true });
    await waitFor(() => MockUtterance.all.length >= 2, 1500);
    MockUtterance.all[1].onstart?.();
    expect(muted, 'B 재생 중이면 뮤트 상태여야 한다 — 전제').toBe(true);

    // 🔴 A의 2단 워치독이 만료될 시간을 준다. B는 아직 재생 중(onend 미발생)이다.
    await sleep(6000);
    expect(muted, 'A의 stale 워치독이 B 재생 중에 뮤트를 풀었다 = TTS가 STT로 새는 창(물림)').toBe(true);
  });

  test('⑦ cancel이 speak() 프라미스를 즉시 종결한다 — 워치독까지 매달리지 않는다', async () => {
    const { speak } = await import('../src/lib/speech');

    const t0 = Date.now();
    let resolvedAt = -1;
    const p = speak('범위 알람 : -78%', { interrupt: false }).then(() => { resolvedAt = Date.now() - t0; });
    await waitFor(() => MockUtterance.all.length >= 1);
    MockUtterance.all[0].onstart?.();
    await sleep(100);

    cancelTts();
    await p;

    // 처방 전 실측 4904ms(2단 상한 ~5145ms에 붙는다). 워치독을 기다리지 않아야 한다.
    expect(resolvedAt).toBeGreaterThanOrEqual(0);
    expect(resolvedAt, 'cancel 후에도 프라미스가 워치독까지 매달린다').toBeLessThan(1000);
  });
});
