/**
 * v0.49 P-1 — TTS 워치독 「시작 감시 / 종료 감시」 2단 분리 오라클.
 *
 * 재는 축:
 *   ① 2.5초를 넘겨 재생되는 정상 발화가 워치독에 잘리지 않는가 (onend를 기다리는가)
 *   ② onstart조차 안 오는 발화가 여전히 ~2.5초에 풀리는가 (FB-3 방어선 보존)
 *   ③ onstart는 왔는데 onend가 영영 안 오는 발화를 2단 안전망이 잡는가
 *   ④ 워치독 이후 도착한 onend/onerror가 계측되는가 (「늦게 옴 vs 끝내 안 옴」 판별용)
 *
 * 안 재는 축: 실제 iOS 음성 엔진의 onend 도착 여부(실기기 전용) · muteForTts/STT 연동 ·
 *            say() 반환값 계약(useVoiceSession 소유).
 *
 * 하네스: speech.ts의 모듈 레벨 `synth`는 **import 시점**에 `window.speechSynthesis`로
 * 고정된다(`speech.ts:518`). 그래서 speech-lifecycle.spec.ts의 beforeEach shim 방식으로는
 * speak()에 도달할 수 없다 — window를 먼저 세우고 **동적 import**해야 한다.
 * 기대값은 전부 **리터럴**이다. 제품의 상한식을 import하면 식을 바꿀 때 테스트가 따라간다
 * (`gates/15-test-verdict.md` [TEAMOPS-38]).
 */

import { test, expect } from '@playwright/test';

/** 앱이 쓰는 표면만 가진 SpeechSynthesisUtterance 목. 발화 이벤트는 테스트가 손으로 쏜다. */
class MockUtterance {
  static last: MockUtterance | null = null;
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  voice: unknown = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
    MockUtterance.last = this;
  }
}

class MockSynth {
  static cancelCount = 0;
  onvoiceschanged: (() => void) | null = null;
  getVoices() { return []; }
  cancel() { MockSynth.cancelCount++; }
  resume() { /* noop */ }
  speak(_u: unknown) { /* 발화는 테스트가 이벤트로 흉내낸다 */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** window/전역 shim을 세운 뒤 speech.ts를 **처음** 로드한다. 모듈 캐시가 워커 단위로
 *  공유되므로 이 파일은 자기 워커에서 speech.ts를 최초로 import하는 쪽이어야 한다 —
 *  `--workers=1` 단독 실행에서도 성립하도록 import를 이 함수 안에 가둔다. */
async function loadSpeech() {
  const g = globalThis as any;
  g.window = {
    setTimeout, clearTimeout, setInterval, clearInterval,
    speechSynthesis: new MockSynth(),
    SpeechSynthesisUtterance: MockUtterance,
  };
  g.SpeechSynthesisUtterance = MockUtterance;
  g.speechSynthesis = g.window.speechSynthesis;
  return await import('../src/lib/speech');
}

/** MockUtterance가 만들어질 때까지 기다린다(speak()는 동기 speak 호출이라 즉시 생긴다). */
async function waitUtterance(timeoutMs = 500): Promise<MockUtterance> {
  const t0 = Date.now();
  while (!MockUtterance.last) {
    if (Date.now() - t0 > timeoutMs) throw new Error('utterance not created');
    await sleep(2);
  }
  return MockUtterance.last;
}

test.describe('v0.49 P-1 — TTS 워치독 2단 분리', () => {
  test.beforeEach(() => {
    MockUtterance.last = null;
    MockSynth.cancelCount = 0;
  });

  test('① 2.5초를 넘겨 재생되는 긴 발화를 자르지 않는다 — onend(4초)를 기다린다', async () => {
    const { speak } = await loadSpeech();
    const { logger } = await import('../src/lib/logger');
    logger.clear();

    // 08-12 실기기에서 100%(7/7) 워치독행이던 길이대. 리터럴로 박는다.
    const LONG = '입력이 끝났습니다. 종료하려면 \'종료\'라고 말씀하거나 종료 버튼을 누르세요.';
    expect(LONG.length).toBeGreaterThanOrEqual(30);

    const t0 = Date.now();
    let resolvedAt = 0;
    const p = speak(LONG, { interrupt: false }).then(() => { resolvedAt = Date.now() - t0; });

    const u = await waitUtterance();
    u.onstart?.();               // 정상 시작
    await sleep(4000);           // 2.5초 문턱을 훌쩍 넘긴 정상 재생
    u.onend?.();                 // 그제서야 종료
    await p;

    // 워치독이 아니라 onend가 resolve했다 → 4초 근처여야 한다(2.5초면 잘린 것).
    expect(resolvedAt).toBeGreaterThanOrEqual(3900);
    const fired = logger.getAll().filter((e) => String(e.extra ?? '').startsWith('tts_watchdog_fired'));
    expect(fired).toHaveLength(0);
  });

  test('② onstart가 영영 안 오면 여전히 ~2.5초에 풀린다 (FB-3 방어선 보존)', async () => {
    const { speak } = await loadSpeech();
    const { logger } = await import('../src/lib/logger');
    logger.clear();

    const t0 = Date.now();
    let resolvedAt = 0;
    const p = speak('처리 시험, 조사나무 1, 조사과실 1.', { interrupt: false })
      .then(() => { resolvedAt = Date.now() - t0; });

    await waitUtterance();       // onstart를 **쏘지 않는다** = 08-07 FB-3 시그니처
    await p;

    expect(resolvedAt).toBeGreaterThanOrEqual(2400);
    expect(resolvedAt).toBeLessThan(3200);
    const fired = logger.getAll()
      .map((e) => String(e.extra ?? ''))
      .filter((x) => x.startsWith('tts_watchdog_fired'));
    expect(fired).toHaveLength(1);
    expect(fired[0]).toContain('started=no');
  });

  test('③ onstart 후 onend가 영영 안 와도 2단 안전망이 잡고, 2단임이 로그로 갈린다', async () => {
    const { speak } = await loadSpeech();
    const { logger } = await import('../src/lib/logger');
    logger.clear();

    // 짧은 텍스트 = 짧은 2단 상한. 리터럴 기대: 12자면 상한이 6초 미만이어야 테스트가 돈다.
    const SHORT = '범위 알람 : -78%';
    const t0 = Date.now();
    let resolvedAt = 0;
    const p = speak(SHORT, { interrupt: false }).then(() => { resolvedAt = Date.now() - t0; });

    const u = await waitUtterance();
    u.onstart?.();               // 시작은 왔다
    await p;                     // onend/onerror는 영영 안 온다 → 2단이 풀어야 한다

    // 1단(2.5초)에 잘리지 않았고, 그래도 무한 hang은 아니다.
    expect(resolvedAt).toBeGreaterThan(2600);
    expect(resolvedAt).toBeLessThan(10_000);
    const fired = logger.getAll()
      .map((e) => String(e.extra ?? ''))
      .filter((x) => x.startsWith('tts_watchdog_fired'));
    expect(fired).toHaveLength(1);
    expect(fired[0]).toContain('started=yes');   // 판독 파이프 호환(브리프 규약)
    expect(fired[0]).toContain('stage=end');     // 1단과 갈린다
  });

  test('⑤ interrupt:true(앱의 주 경로)에서도 2단이 무장된다 — cancel 왕복이 앵커를 흘리지 않는다', async () => {
    const { speak } = await loadSpeech();
    const { logger } = await import('../src/lib/logger');
    logger.clear();

    // 🔑 앱은 이 경로를 상시 탄다: say()의 기본값이 interrupt=true이고(useVoiceSession.ts:418),
    //    echo 발화도 true다(:2740). ①~④가 전부 interrupt:false라 주 경로가 미측정이었다.
    //    cancel()은 앞 utterance의 onend를 유발하므로, 그 종료 처리가 새 발화의 stage/watchdog을
    //    흘리면(클로저 격리 실패) 2단이 무장되지 않고 다시 2.5초에 잘린다.
    const LONG = '입력이 끝났습니다. 종료하려면 \'종료\'라고 말씀하거나 종료 버튼을 누르세요.';

    const t0 = Date.now();
    let resolvedAt = 0;
    const p = speak(LONG, { interrupt: true }).then(() => { resolvedAt = Date.now() - t0; });

    const u = await waitUtterance();
    expect(MockSynth.cancelCount).toBeGreaterThanOrEqual(1);  // cancel 왕복이 실제로 일어났다
    u.onstart?.();
    await sleep(4000);
    u.onend?.();
    await p;

    expect(resolvedAt).toBeGreaterThanOrEqual(3900);
    const fired = logger.getAll().filter((e) => String(e.extra ?? '').startsWith('tts_watchdog_fired'));
    expect(fired).toHaveLength(0);
  });

  test('④ 워치독 이후 도착한 onend를 계측한다 — 「늦게 옴 vs 끝내 안 옴」 판별용', async () => {
    const { speak } = await loadSpeech();
    const { logger } = await import('../src/lib/logger');
    logger.clear();

    const p = speak('처리 시험, 조사나무 1, 조사과실 1.', { interrupt: false });
    await waitUtterance();
    const u = MockUtterance.last!;
    await p;                     // onstart 없이 1단 워치독으로 resolve

    u.onend?.();                 // 워치독이 판정한 **뒤에** 도착한 종료 이벤트
    await sleep(20);

    const late = logger.getAll()
      .map((e) => String(e.extra ?? ''))
      .filter((x) => x.startsWith('tts_late_end'));
    expect(late).toHaveLength(1);
    expect(late[0]).toContain('reason=end');
  });
});
