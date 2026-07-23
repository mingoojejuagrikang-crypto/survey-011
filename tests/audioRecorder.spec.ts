/**
 * v0.22.0 P0 — AudioRecorder.isStreamLost() 단위 검증 (pastValues.spec.ts 패턴:
 * 브라우저 의존부 getUserMedia/AudioContext는 건드리지 않고, 순수 판정 로직만 Node에서 검증).
 *
 * 배경(2026-06-25 실기기 로그 근인): iOS Safari가 제스처 밖 getUserMedia를 NotAllowedError로
 * 거부하므로, 빈 클립마다 자동 recoverStream을 부르면 살아있던 스트림까지 죽이며 폭주했다
 * (clip_empty×41). v0.22.0은 스트림이 **실제로 죽었는지**(isStreamLost)를 보고 micLost로 래치 →
 * 자동 재시도를 멈추고 사용자 제스처(reconnectMic)로만 복구한다. isStreamLost의 정확성이 그
 * 게이트의 토대라 직접 검증한다.
 *
 * isStreamLost() 계약:
 *  - 스트림 null → true (죽음)
 *  - 오디오 트랙 0개 → true
 *  - 트랙 readyState 'ended' → true
 *  - 트랙 readyState 'live' → false (멀쩡 — 자동복구 불필요, 다음 클립이 자가 치유)
 */
import { test, expect } from '@playwright/test';
import { AudioRecorder } from '../src/lib/audioRecorder';
import { MicPrerollTap } from '../src/lib/micPrerollTap';
import { logger } from '../src/lib/logger';

/** 최소 MediaStream stub — isStreamLost는 getAudioTracks()[0].readyState만 본다. */
function fakeStream(tracks: Array<{ readyState: 'live' | 'ended' }>): MediaStream {
  return {
    getAudioTracks: () => tracks,
  } as unknown as MediaStream;
}

/** private `stream` 필드를 주입(테스트 전용). init()은 getUserMedia를 호출하므로 Node에서 못 돈다. */
function withStream(rec: AudioRecorder, stream: MediaStream | null): AudioRecorder {
  (rec as unknown as { stream: MediaStream | null }).stream = stream;
  return rec;
}

test.describe('AudioRecorder.isStreamLost() — micLost 게이트 판정', () => {
  test('스트림 null → lost(true)', () => {
    const rec = withStream(new AudioRecorder(), null);
    expect(rec.isStreamLost()).toBe(true);
  });

  test('오디오 트랙 0개 → lost(true)', () => {
    const rec = withStream(new AudioRecorder(), fakeStream([]));
    expect(rec.isStreamLost()).toBe(true);
  });

  test("트랙 readyState 'ended' → lost(true)", () => {
    const rec = withStream(new AudioRecorder(), fakeStream([{ readyState: 'ended' }]));
    expect(rec.isStreamLost()).toBe(true);
  });

  test("트랙 readyState 'live' → 멀쩡(false): 자동복구 불필요, 다음 클립이 자가 치유", () => {
    const rec = withStream(new AudioRecorder(), fakeStream([{ readyState: 'live' }]));
    expect(rec.isStreamLost()).toBe(false);
  });

  test('첫 오디오 트랙만 본다: live 트랙이 첫째면 ended 트랙이 뒤에 있어도 멀쩡', () => {
    const rec = withStream(
      new AudioRecorder(),
      fakeStream([{ readyState: 'live' }, { readyState: 'ended' }]),
    );
    expect(rec.isStreamLost()).toBe(false);
  });
});

/**
 * v0.38.0 [CLIP-R1] — 재획득 쿨다운이 **첫 회복**을 막지 않는지 결정론적으로 고정.
 *
 * 근인: 쿨다운 비교값이 `performance.now()`(페이지 로드 후 경과 ms)인데 `lastRecoverAt`이 0이면
 * 로드 직후 3초 동안 `now - 0 < 3000`이 성립해 **모든 recoverStream이 조용히 차단**된다.
 * #5 자동 재연결은 사고 시점에 즉시 발화하므로 이 구간에 걸리면 getUserMedia를 부르지도 못한 채
 * 1회 가드만 소진한다.
 *
 * 이 테스트가 필요한 이유: 같은 결함의 통합 회귀(v034-wave-glow B8)는 **격리 실행에서만** 실패하고
 * 병렬 전체 실행에서는 부하 지연으로 3초가 지나가 통과한다. 즉 통합 테스트만으로는 재발을 못 잡는다.
 * 여기서는 시계에 의존하지 않고 초기값 자체를 검증한다.
 */
test('[CLIP-R1] 새로 만든 레코더의 첫 recoverStream은 쿨다운에 걸리지 않는다', () => {
  const rec = new AudioRecorder();
  const lastRecoverAt = (rec as unknown as { lastRecoverAt: number }).lastRecoverAt;

  // performance.now()가 0에 가까운 시점(페이지 로드 직후)에도 쿨다운 창 밖이어야 한다.
  expect(lastRecoverAt).toBeLessThanOrEqual(-3000);
  expect(performance.now() - lastRecoverAt).toBeGreaterThanOrEqual(3000);
});

/**
 * v0.38.0 리뷰#1(Codex Medium) — 자동 복구가 즉시 실패해 쿨다운이 남은 상태에서, 사용자가 배너를
 * **바로 한 번 탭하면** 실제 재획득이 시도돼야 한다. 쿨다운은 자동 폭주를 막는 장치지 사용자
 * 제스처를 삼키는 장치가 아니다(iOS에선 제스처가 getUserMedia를 허용하는 유일한 창이라 더 중요).
 * 통합 테스트는 3.5초를 기다린 뒤 클릭해 이 경계를 가린다 — 여기서 시계 비의존으로 고정한다.
 */
test('[리뷰#1] 자동 시도 직후 쿨다운이 남아도 사용자 제스처 복구는 차단되지 않는다', async () => {
  const rec = new AudioRecorder();
  const priv = rec as unknown as { lastRecoverAt: number; recovering: boolean };
  let calls = 0;
  (rec as unknown as { acquireStream: () => Promise<MediaStream> }).acquireStream = async () => {
    calls++;
    return fakeStream([{ readyState: 'live' }]);
  };

  // 자동 시도가 방금 일어난 상태(쿨다운 창 한복판)를 만든다.
  priv.lastRecoverAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  expect(await rec.recoverStream('auto')).toBe(false);      // 자동 경로는 종전대로 쿨다운 준수
  expect(calls).toBe(0);

  expect(await rec.recoverStream('user_gesture', { bypassCooldown: true })).toBe(true);
  expect(calls).toBe(1);                                    // 제스처는 첫 탭에 실제로 시도된다
});

/**
 * v0.38.0 리뷰#1(Codex High) — `getUserMedia`가 **보류**될 때 재획득이 영구 교착되지 않는지.
 *
 * 근인: 브라우저가 권한 요청을 resolve도 reject도 하지 않으면 `await acquireStream()`이 영원히
 * 멈춘다. 그러면 ①`recovering`이 true로 고정돼 이후 모든 재획득이 즉시 false ②호출부
 * (`useVoiceSession.reconnectMic`)의 in-flight ref도 고정돼 **수동 탭조차 같은 미해결 Promise를
 * 돌려받고** ③실패 폴백(수동 재연결 배너)이 `.then()` 안이라 **배너조차 뜨지 않는다**.
 * 게다가 teardown은 이미 끝난 뒤라 레코더가 종전보다 더 해체된 채 남는다 = 세션 내내 녹음 사망.
 * **거부보다 보류가 위험하다** — 반드시 결말을 만들어야 한다.
 *
 * 시계 의존을 피하려고 인스턴스 타임아웃(`acquireTimeoutMs`)을 짧게 주입한다(실제 7초 대기 없음).
 */
test('[리뷰#1] getUserMedia가 응답 없이 보류돼도 재획득은 타임아웃으로 결말이 난다', async () => {
  const rec = new AudioRecorder();
  const priv = rec as unknown as {
    acquireTimeoutMs: number;
    recovering: boolean;
    acquireStream: () => Promise<MediaStream>;
  };
  priv.acquireTimeoutMs = 30;
  priv.acquireStream = () => new Promise<MediaStream>(() => { /* 영원히 보류 */ });

  // 결말이 난다(무한대기 아님) — 이 await가 끝나는 것 자체가 회귀 방지의 핵심이다.
  expect(await rec.recoverStream('auto')).toBe(false);

  // 가드가 풀려야 다음 시도(수동 배너 탭)가 실제로 진행된다. 안 풀리면 세션 내내 사망.
  expect(priv.recovering).toBe(false);

  let secondCall = 0;
  priv.acquireStream = async () => { secondCall++; return fakeStream([{ readyState: 'live' }]); };
  expect(await rec.recoverStream('user_gesture', { bypassCooldown: true })).toBe(true);
  expect(secondCall).toBe(1);
});

test.describe('AudioRecorder.recoverStream() — 실패 텔레메트리 상호배타 분기', () => {
  test.beforeEach(() => logger.clear());
  test.afterEach(() => logger.clear());

  test('getUserMedia 보류는 recover_timeout만 남긴다', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireTimeoutMs: number;
      acquireStream: () => Promise<MediaStream>;
    };
    priv.acquireTimeoutMs = 30;
    priv.acquireStream = () => new Promise<MediaStream>(() => { /* 영원히 보류 */ });

    expect(await rec.recoverStream('auto')).toBe(false);

    const extras = logger.getAll().map((entry) => entry.extra ?? '');
    expect(extras.filter((extra) => extra.startsWith('clip_recorder_recover_timeout:'))).toEqual([
      'clip_recorder_recover_timeout:auto:ms=30',
    ]);
    expect(extras.filter((extra) => extra.startsWith('clip_recorder_recover_failed:'))).toEqual([]);
  });

  test('getUserMedia NotAllowedError reject는 recover_failed만 남긴다', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
    };
    priv.acquireStream = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));

    expect(await rec.recoverStream('auto')).toBe(false);

    const extras = logger.getAll().map((entry) => entry.extra ?? '');
    expect(extras.filter((extra) => extra.startsWith('clip_recorder_recover_failed:'))).toEqual([
      'clip_recorder_recover_failed:auto:Permission denied',
    ]);
    expect(extras.filter((extra) => extra.startsWith('clip_recorder_recover_timeout:'))).toEqual([]);
  });
});

test('[리뷰#1] 타임아웃 후 뒤늦게 열린 스트림은 즉시 닫힌다(핫마이크 방지)', async () => {
  const rec = new AudioRecorder();
  const priv = rec as unknown as {
    acquireTimeoutMs: number;
    acquireStream: () => Promise<MediaStream>;
  };
  priv.acquireTimeoutMs = 30;

  let stopped = 0;
  let resolveLate: ((s: MediaStream) => void) | null = null;
  const lateStream = {
    getAudioTracks: () => [{ readyState: 'live' }],
    getTracks: () => [{ stop: () => { stopped++; } }],
  } as unknown as MediaStream;
  priv.acquireStream = () => new Promise<MediaStream>((res) => { resolveLate = res; });

  expect(await rec.recoverStream('auto')).toBe(false);   // 타임아웃으로 포기
  expect(stopped).toBe(0);                               // 아직 열리지 않았다

  resolveLate!(lateStream);                              // 포기한 뒤에 늦게 성공
  await Promise.resolve(); await Promise.resolve();      // 폐기 핸들러 마이크로태스크 소진

  // 아무도 참조하지 않는 마이크가 켜진 채 남으면 안 된다(인디케이터 상시 점등 + 배터리).
  expect(stopped).toBe(1);
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

class StubAudioNode {
  disconnectCalls = 0;
  connect(target: unknown): unknown { return target; }
  disconnect(): void { this.disconnectCalls++; }
}

class StubWorkletNode extends StubAudioNode {
  readonly port = { onmessage: null as ((event: MessageEvent) => void) | null };
}

class StubAudioContext {
  readonly source = new StubAudioNode();
  readonly sink = Object.assign(new StubAudioNode(), { gain: { value: 1 } });
  readonly analyser = Object.assign(new StubAudioNode(), { fftSize: 0 });
  readonly destination = new StubAudioNode();
  readonly sampleRate = 48_000;
  readonly audioWorklet: { addModule: () => Promise<void> };
  closeCalls = 0;

  constructor(addModule: () => Promise<void>) {
    this.audioWorklet = { addModule };
  }

  async resume(): Promise<void> {}
  createMediaStreamSource(): MediaStreamAudioSourceNode {
    return this.source as unknown as MediaStreamAudioSourceNode;
  }
  createGain(): GainNode { return this.sink as unknown as GainNode; }
  createAnalyser(): AnalyserNode { return this.analyser as unknown as AnalyserNode; }
  createScriptProcessor(): ScriptProcessorNode {
    return new StubAudioNode() as unknown as ScriptProcessorNode;
  }
  close(): Promise<void> { this.closeCalls++; return Promise.resolve(); }
}

type MicTapPrivate = { capture: { ctx: AudioContext } | null };
type TestAudioGlobals = typeof globalThis & { window?: unknown; AudioWorkletNode?: unknown };

function installAudioContextStub(
  addModules: Array<() => Promise<void>>,
): { contexts: StubAudioContext[]; restore: () => void } {
  const globals = globalThis as TestAudioGlobals;
  const previousWindow = globals.window;
  const previousWorkletNode = globals.AudioWorkletNode;
  const contexts: StubAudioContext[] = [];
  class AudioContextStub extends StubAudioContext {
    constructor() {
      const addModule = addModules.shift();
      if (!addModule) throw new Error('AudioContext stub plan exhausted');
      super(addModule);
      contexts.push(this);
    }
  }
  globals.window = { AudioContext: AudioContextStub };
  globals.AudioWorkletNode = StubWorkletNode;
  return {
    contexts,
    restore: () => {
      if (previousWindow === undefined) delete globals.window;
      else globals.window = previousWindow;
      if (previousWorkletNode === undefined) delete globals.AudioWorkletNode;
      else globals.AudioWorkletNode = previousWorkletNode;
    },
  };
}

test.describe('MicPrerollTap attach/detach 수명주기', () => {
  test('attach가 addModule 대기 중 detach되면 뒤늦은 그래프를 닫는다', async () => {
    const moduleGate = deferred<void>();
    const moduleStarted = deferred<void>();
    const env = installAudioContextStub([
      () => { moduleStarted.resolve(); return moduleGate.promise; },
    ]);
    const tap = new MicPrerollTap();
    try {
      const attaching = tap.attach({} as MediaStream);
      await moduleStarted.promise;

      tap.detach();
      moduleGate.resolve();
      await attaching;

      expect(env.contexts[0].closeCalls).toBe(1);
      expect((tap as unknown as MicTapPrivate).capture).toBeNull();
    } finally {
      tap.detach();
      env.restore();
    }
  });

  test('attach 취소를 위한 detach 후 다시 attach하면 정상 연결한다', async () => {
    const firstModuleGate = deferred<void>();
    const firstModuleStarted = deferred<void>();
    const env = installAudioContextStub([
      () => { firstModuleStarted.resolve(); return firstModuleGate.promise; },
      () => Promise.resolve(),
    ]);
    const tap = new MicPrerollTap();
    try {
      const firstAttach = tap.attach({} as MediaStream);
      await firstModuleStarted.promise;
      tap.detach();
      firstModuleGate.resolve();
      await firstAttach;

      await tap.attach({} as MediaStream);

      expect(env.contexts).toHaveLength(2);
      expect(env.contexts[0].closeCalls).toBe(1);
      expect((tap as unknown as MicTapPrivate).capture?.ctx).toBe(env.contexts[1]);
      expect(tap.getKind()).toBe('worklet');
    } finally {
      tap.detach();
      env.restore();
    }
  });
});

/**
 * v0.38.0 [리뷰#6] 진행 중인 마이크 획득을 `dispose()`가 무효화하는지 — **핫마이크 방지**.
 *
 * 근인: `getUserMedia`는 취소할 수 없다. 대기 중 세션 종료·탭 이탈로 `dispose()`가 불리면 그 시점엔
 * 닫을 스트림이 없고, 뒤늦게 획득이 성공하면 **이미 폐기된 인스턴스에** 스트림·장치 리스너·프리롤
 * 그래프가 다시 붙는다. 그 인스턴스는 호출부 ref에서 빠진 뒤라 아무도 `dispose()`를 부르지 않아
 * **마이크가 켜진 채 남는다**. 원거리 현장에서 사용자는 이를 알 방법이 없다(프라이버시).
 *
 * `isDisposed` 하드가드는 StrictMode 이중마운트에서 재-init을 영구 차단해 클립 녹음을 깨므로 쓸 수
 * 없다 — 세대 비교여야 한다. 그래서 "폐기 후 새 init은 정상 동작"까지 함께 고정한다.
 */
test.describe('[리뷰#6] dispose()가 진행 중인 획득을 무효화한다 (핫마이크 방지)', () => {
  /** stop() 호출을 세는 스트림 stub — 실제로 닫혔는지가 이 테스트의 전부다. */
  function countingStream(): { stream: MediaStream; stopped: () => number } {
    let stops = 0;
    const track = {
      readyState: 'live' as const,
      stop: () => { stops += 1; },
      addEventListener: () => { /* noop */ },
      removeEventListener: () => { /* noop */ },
      getSettings: () => ({ deviceId: 'dev', label: 'mic' }),
      label: 'mic',
    };
    const stream = {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream;
    return { stream, stopped: () => stops };
  }

  test('init() 대기 중 dispose()되면 뒤늦게 열린 스트림을 즉시 닫는다', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
      stream: MediaStream | null;
    };
    const late = countingStream();
    let release: (() => void) | null = null;
    priv.acquireStream = () => new Promise<MediaStream>((resolve) => {
      release = () => { resolve(late.stream); };
    });

    const initing = rec.init();
    await Promise.resolve();                 // acquireStream이 대기에 들어가게 한다
    rec.dispose();                           // 이 시점엔 닫을 stream이 없다 — 종전엔 여기서 새는 게 확정
    release!();                              // 권한이 뒤늦게 승인된다

    expect(await initing).toBe(false);       // 폐기된 인스턴스의 init은 성공으로 끝나면 안 된다
    expect(late.stopped()).toBe(1);          // 갓 열린 마이크가 즉시 닫혔다
    expect(priv.stream).toBeNull();          // 폐기된 인스턴스에 스트림이 붙지 않았다
  });

  test('recoverStream() 대기 중 dispose()되면 뒤늦게 열린 스트림을 즉시 닫는다', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
      stream: MediaStream | null;
      recovering: boolean;
    };
    const late = countingStream();
    let release: (() => void) | null = null;
    priv.acquireStream = () => new Promise<MediaStream>((resolve) => {
      release = () => { resolve(late.stream); };
    });

    const recovering = rec.recoverStream('auto');
    await Promise.resolve();
    rec.dispose();
    release!();

    expect(await recovering).toBe(false);
    expect(late.stopped()).toBe(1);
    expect(priv.stream).toBeNull();
    expect(priv.recovering).toBe(false);     // 가드는 풀려야 한다(세션 사망 방지, [리뷰#1] 계약)
  });

  /**
   * v0.38.0 [리뷰#7 Critical] `init()`과 `recoverStream()`은 서로를 직렬화하지 않는다
   * (`initPromise`는 init끼리, `recovering`은 recover끼리만). v0.37.0부터 있던 구조다.
   *
   * 시나리오: 입력탭 prewarm `init()`이 권한 응답을 기다리는 동안 첫 클립이 빈 채로 끝나
   * `micLost` 자동복구가 `recoverStream()`을 시작한다. **둘이 각자 스트림을 연다.** 나중에 도착한
   * 쪽이 `this.stream`을 덮어쓰고, `dispose()`는 마지막 하나만 stop하므로 **다른 하나는 참조 없이
   * 마이크를 계속 쓴다**(영구 핫마이크). 도착 순서가 뒤바뀌어도 같은 문제라 양방향을 다 고정한다.
   */
  test('[리뷰#7] init()과 recoverStream()이 겹치면 진 쪽 스트림이 즉시 닫힌다 (init 먼저 도착)', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as { acquireStream: () => Promise<MediaStream>; stream: MediaStream | null };
    const a = countingStream();   // init이 여는 스트림
    const b = countingStream();   // recover가 여는 스트림
    let releaseA: (() => void) | null = null;
    let releaseB: (() => void) | null = null;

    priv.acquireStream = () => new Promise<MediaStream>((resolve) => { releaseA = () => resolve(a.stream); });
    const initing = rec.init();
    await Promise.resolve();

    priv.acquireStream = () => new Promise<MediaStream>((resolve) => { releaseB = () => resolve(b.stream); });
    const recovering = rec.recoverStream('mic_lost', { bypassCooldown: true });
    await Promise.resolve();

    releaseA!();                                  // init이 먼저 도착 — 이미 recover에 밀린 상태다
    expect(await initing).toBe(false);
    expect(a.stopped()).toBe(1);                  // 진 쪽은 즉시 닫힌다(누수 없음)

    releaseB!();
    expect(await recovering).toBe(true);
    expect(priv.stream).toBe(b.stream);           // 나중에 시작된 획득이 인스턴스를 소유한다

    rec.dispose();
    expect(b.stopped()).toBe(1);
    expect(a.stopped()).toBe(1);                  // dispose 후 **두 스트림 모두** 멈춰 있어야 한다
  });

  test('[리뷰#7] init()과 recoverStream()이 겹치면 진 쪽 스트림이 즉시 닫힌다 (recover 먼저 도착)', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as { acquireStream: () => Promise<MediaStream>; stream: MediaStream | null };
    const a = countingStream();
    const b = countingStream();
    let releaseA: (() => void) | null = null;
    let releaseB: (() => void) | null = null;

    priv.acquireStream = () => new Promise<MediaStream>((resolve) => { releaseA = () => resolve(a.stream); });
    const initing = rec.init();
    await Promise.resolve();

    priv.acquireStream = () => new Promise<MediaStream>((resolve) => { releaseB = () => resolve(b.stream); });
    const recovering = rec.recoverStream('mic_lost', { bypassCooldown: true });
    await Promise.resolve();

    releaseB!();                                  // 도착 순서를 뒤집는다
    expect(await recovering).toBe(true);
    expect(priv.stream).toBe(b.stream);

    releaseA!();
    expect(await initing).toBe(false);
    expect(a.stopped()).toBe(1);                  // 늦게 도착한 진 쪽도 반드시 닫힌다
    expect(priv.stream).toBe(b.stream);           // 이긴 쪽을 덮어쓰지 않는다

    rec.dispose();
    expect(b.stopped()).toBe(1);
  });

  test('폐기 뒤 새 init()은 정상 획득한다 — 하드가드가 아니라 세대 비교여야 하는 이유', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
      stream: MediaStream | null;
    };
    const first = countingStream();
    priv.acquireStream = async () => first.stream;

    expect(await rec.init()).toBe(true);
    rec.dispose();
    expect(first.stopped()).toBe(1);

    // StrictMode 이중마운트·세션 재개는 **같은 인스턴스**를 다시 쓴다. 여기서 막히면 녹음이 깨진다.
    const second = countingStream();
    priv.acquireStream = async () => second.stream;
    expect(await rec.init()).toBe(true);
    expect(priv.stream).toBe(second.stream);
    expect(second.stopped()).toBe(0);
  });
});
