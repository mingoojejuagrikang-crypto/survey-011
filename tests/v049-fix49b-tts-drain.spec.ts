/**
 * v0.49 fix49b 오라클 — **엔진 cancel의 계약을 cancelTts() 밖으로** (max 리뷰 2026-08-12 #1·#5·#10·#11)
 *
 * fix49가 H-2로 심은 드레인은 `cancelTts()` **한 함수 안에만** 있다. 그런데 이 앱에서 엔진을
 * 자르는 지점은 거기만이 아니다 — `speak({interrupt:true})`가 매 호출마다 `engine.cancel()`을
 * 부르고, `say()`의 기본값이 바로 그 `interrupt=true`다. 즉 **주 발화 경로 전체**가 드레인 없이
 * 엔진을 자르고 있었다.
 *
 * 결과는 fix49가 닫았다고 선언한 그 결함이다: 잘린 발화의 2단 워치독(최대 20초)이 살아남아
 * **다음 발화가 재생되는 도중** 만료되고, `done()`이 `unmuteForTts()`를 부른다
 * (`ttsMuted`는 refcount가 아니라 평범한 boolean이다) → 재생 중인 앱 자신의 목소리가 살아 있는
 * 인식기로 들어간다(물림·자기입력).
 *
 *   ① `speak({interrupt:true})`도 앞 발화를 드레인한다 — `cancelTts()` 경유가 아닌 경로(#1)
 *   ② 50ms 창에서 취소된 발화는 **말하지 않는다** — 취소가 성공했다고 해놓고 뒤늦게 말하지 않는다(#11)
 *   ③ 큐에서 차례를 기다리는 발화의 **시작 워치독**이 앞 발화 재생 중에 만료되지 않는다(#5)
 *   ④ FB-3 방어선은 **불변** — in-flight가 없는 첫 발화는 2.5초에 그대로 판정한다(#5의 경계)
 *   ⑤ `cancelTts()`가 실제로 엔진 cancel을 부른다 — 하네스에서도 관측된다(#10)
 *
 * 하네스: speech-lifecycle.spec.ts 계보(Node 직접 import + window shim).
 *   ⚠️ shim은 **import보다 늦다.** 그래서 모듈 상수 `synth`는 굳어 있고, 호출 시점에 엔진을
 *   다시 읽는 함수만 이 하네스에서 엔진에 닿는다 — 그 비대칭 자체가 ⑤가 재는 것이다.
 */

import { test, expect } from '@playwright/test';
import { cancelTts, setActiveController, type SpeechController } from '../src/lib/speech';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs = 2000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timeout');
    await sleep(5);
  }
}

class MockUtterance {
  static all: MockUtterance[] = [];
  text: string; lang = ''; rate = 1; pitch = 1; volume = 1; voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) { this.text = text; MockUtterance.all.push(this); }
}

/** 엔진 호출을 세는 목. `cancel()`은 **onend를 쏘지 않는다** — iOS Safari의 알려진 버그이자
 *  이 라운드가 대비하는 케이스다(정상 브라우저는 쏘므로 드레인이 no-op이 된다). */
const engineCalls: string[] = [];

test.describe('v0.49 fix49b — 엔진 cancel 지점의 드레인 계약', () => {
  let muted = false;

  test.beforeEach(() => {
    MockUtterance.all = [];
    engineCalls.length = 0;
    muted = false;
    (globalThis as any).window = {
      setTimeout, clearTimeout, setInterval, clearInterval,
      speechSynthesis: {
        onvoiceschanged: null, getVoices: () => [],
        cancel() { engineCalls.push('cancel'); },
        resume() { engineCalls.push('resume'); },
        speak(_u: unknown) { engineCalls.push('speak'); },
      },
      SpeechSynthesisUtterance: MockUtterance,
    } as any;
    (globalThis as any).SpeechSynthesisUtterance = MockUtterance;
    setActiveController({
      muteForTts() { muted = true; },
      unmuteForTts() { muted = false; },
      isTtsMuted() { return muted; },
    } as unknown as SpeechController);
    // 🔴 `speak()`의 in-flight 집합은 **모듈 상태**다 — 앞 케이스가 일부러 미종결로 남긴
    //   발화(onend를 안 쏘는 엔진 재현)가 그대로 넘어오면, 다음 케이스의 발화는 「내 앞에
    //   재생 중인 발화가 있다」고 판정해 시작 워치독을 미룬다(#5 앵커의 정상 동작).
    //   케이스 사이를 가르는 것은 하네스의 몫이다 — 여기서 드레인해 각 케이스가 **빈 큐**에서
    //   시작하게 한다. 이 한 줄이 없으면 ④(FB-3)가 앞 케이스의 잔여 때문에 red가 된다.
    cancelTts();
    muted = false;
  });

  test.afterEach(() => {
    setActiveController(null);
    delete (globalThis as any).window;
    delete (globalThis as any).SpeechSynthesisUtterance;
    MockUtterance.all = [];
  });

  test('① speak({interrupt:true})도 앞 발화를 드레인한다 — cancelTts를 안 거치는 주 경로 (#1)', async () => {
    const { speak } = await import('../src/lib/speech');

    // A 재생 중(12자 → 2단 상한 ~5.1초). 엔진은 이 발화의 onend를 끝내 쏘지 않는다.
    const A = '범위 알람 : -78%';
    void speak(A, { interrupt: false });
    await waitFor(() => MockUtterance.all.length >= 1);
    MockUtterance.all[0].onstart?.();
    await sleep(40);
    expect(muted, 'A가 뮤트를 걸어야 한다 — 전제').toBe(true);

    // 🔴 `say()`의 기본 경로다 — `cancelTts()`를 **거치지 않고** 엔진을 자른다.
    //    (예: 조절판 「안내속도 빠르게」의 speak({interrupt:true}), P4 2차 발화 등)
    const B = '입력이 끝났습니다. 종료하려면 종료라고 말씀하거나 종료 버튼을 누르세요.';
    void speak(B, { interrupt: true });
    await waitFor(() => MockUtterance.all.length >= 2, 2000);
    MockUtterance.all[1].onstart?.();
    expect(muted, 'B 재생 중이면 뮤트 상태여야 한다 — 전제').toBe(true);

    // A의 2단 워치독이 만료될 시간. B는 아직 재생 중이다(onend 미발생).
    await sleep(6000);
    expect(
      muted,
      'A의 stale 워치독이 B 재생 중에 뮤트를 풀었다 = 앱 목소리가 STT로 새는 창(물림)',
    ).toBe(true);
  });

  test('② 50ms 창에서 취소된 발화는 끝내 말하지 않는다 (#11)', async () => {
    const { speak } = await import('../src/lib/speech');

    // `interrupt:true`는 engine.cancel() 뒤 50ms를 쉰다(iOS 완화). 그 창에서는 이 발화가
    //   아직 `_pendingSpeakDone`에 없어 **취소도 드레인도 안 된다**.
    void speak('삼십오 점 일', { interrupt: true });
    await sleep(10);                        // 아직 sleep 창 안 — utterance 미생성
    expect(MockUtterance.all.length, '50ms 창 전제 — 아직 발화 전이다').toBe(0);

    // 사용자가 즉시 「취소」/「일시정지」를 말한 상황: 핸들러 선두의 cancelTts().
    cancelTts();
    expect(muted, 'cancel 시점엔 아직 아무도 뮤트를 걸지 않았다 — 전제').toBe(false);

    await sleep(300);
    // 🔴 취소가 "성공"했는데 50ms 뒤 유령 발화가 살아나면, 앱은 사용자가 방금 취소한 값을
    //    되읽고 그 발화 길이 내내 STT를 다시 뮤트한다(사용자의 다음 명령이 통째로 무시된다).
    expect(
      MockUtterance.all.length,
      '취소된 뒤에 발화가 살아났다 — cancelTts가 못 잡는 50ms 사각지대',
    ).toBe(0);
    expect(muted, '유령 발화가 STT를 다시 뮤트했다').toBe(false);
  });

  test('③ 큐 대기 발화의 시작 워치독이 앞 발화 재생 중 만료되지 않는다 (#5)', async () => {
    const { speak } = await import('../src/lib/speech');

    // 앱의 실제 경로: 복귀 안내(26자)를 큐잉하고 곧바로 브리핑을 **또** 큐잉한다
    //   (useVoiceSession :210-213 — 둘 다 interrupt=false).
    const A = '백그라운드에서 돌아왔습니다. 이어서 진행합니다.';
    void speak(A, { interrupt: false });
    await waitFor(() => MockUtterance.all.length >= 1);
    MockUtterance.all[0].onstart?.();        // A 재생 시작(엔진이 A를 물고 있다)

    void speak('두 번째 안내입니다', { interrupt: false });
    await waitFor(() => MockUtterance.all.length >= 2);
    // B는 큐에서 대기 — onstart가 오지 않는다. 그동안 A가 계속 재생된다.

    await sleep(3200);                       // 1단(2.5초)이 지나도록 둔다
    // 🔴 앵커가 enqueue 시점이면 B의 시작 워치독이 여기서 만료된다 → `done()` → unmute.
    //    A는 아직 재생 중이므로 **재생 중인 TTS가 살아 있는 인식기로 들어간다.** 게다가 B가
    //    나중에 실제로 시작해도 `if (settled) return`이 다시 뮤트하는 것을 막아 B는 통째로
    //    언뮤트 상태로 재생된다 — P-1이 세운 뮤트 보장이 구조적으로 무너진다.
    expect(
      muted,
      '큐에서 기다리던 발화의 시작 워치독이 앞 발화 재생 중 뮤트를 풀었다',
    ).toBe(true);
  });

  test('④ FB-3 방어선 불변 — in-flight가 없는 첫 발화는 2.5초에 그대로 판정한다 (#5 경계)', async () => {
    const { speak } = await import('../src/lib/speech');

    // 엔진이 발화를 **시작조차 못 하는** 상태(08-07 실기기 FB-3의 실체). onstart가 영영 안 온다.
    const t0 = Date.now();
    let resolvedAt = -1;
    void speak('횡경', { interrupt: false }).then(() => { resolvedAt = Date.now() - t0; });
    await waitFor(() => MockUtterance.all.length >= 1);

    await sleep(3000);
    // 🔑 이 2.5초가 WP-1이 「110초 마비」를 1/4로 줄인 방어선이다. 큐 앵커를 고치면서
    //    **첫 발화의 판정 시각이 밀리면** 그 방어선이 함께 밀린다 — 여기서 못 박는다.
    expect(resolvedAt, '첫 발화가 2.5초 시작 워치독으로 판정되지 않았다 = FB-3 방어선 약화').toBeGreaterThan(0);
    expect(resolvedAt).toBeLessThan(2900);
    expect(muted, '워치독 판정 뒤에는 뮤트가 풀려야 한다').toBe(false);
  });

  test('⑤ cancelTts()가 실제로 엔진 cancel을 부른다 (#10)', async () => {
    const { speak } = await import('../src/lib/speech');

    void speak('횡경', { interrupt: false });
    await waitFor(() => MockUtterance.all.length >= 1);
    MockUtterance.all[0].onstart?.();
    const before = engineCalls.length;

    cancelTts();

    // 🔴 `speak()`는 P-1에서 **호출 시점에** 엔진을 다시 읽도록 고쳐졌는데 `cancelTts()`는
    //    import 시점에 굳은 모듈 상수를 그대로 읽는다. 그 하네스에서 cancel은 통째로 건너뛰고
    //    **드레인과 unmute만** 실행된다 — 함수 자신의 주석이 「물림 재개방」이라 부르는 그
    //    순서 역전이다. 그래서 순서 계약(①)을 재는 오라클도 cancel을 관측하지 못했다.
    expect(
      engineCalls.slice(before),
      'cancelTts가 엔진 cancel을 부르지 않았다 — 순서 계약이 검증 불가 상태',
    ).toContain('cancel');
  });
});
