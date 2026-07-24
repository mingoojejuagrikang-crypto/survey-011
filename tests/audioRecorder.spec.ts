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

/** teardown/recover 소유권 테스트용 live MediaStream. stop 횟수와 스트림 identity를 함께 본다. */
function trackedStream(label = 'test mic', muted = false): {
  stream: MediaStream;
  stopped: () => number;
} {
  let stopCalls = 0;
  const track = {
    readyState: 'live' as MediaStreamTrackState,
    muted,
    label,
    getSettings: () => ({ deviceId: label }),
    addEventListener: () => {},
    removeEventListener: () => {},
    stop: () => { stopCalls++; },
  } as unknown as MediaStreamTrack;
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, stopped: () => stopCalls };
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
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
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
  /** v0.38.1 [MIC-B2] iOS/WebKit이 노출하는 컨텍스트 상태. 기본은 정상 'running'이고, 백그라운드
   *  인터럽션 재현이 필요한 테스트만 'interrupted'로 바꾼다(계측 바이트 검증용). */
  state = 'running';
  /** v0.38.1 [MIC-B2] `close()` 동작 주입 훅 — **물린 세션에서 close 자체가 멈추는** 상황을 재현한다.
   *  기본은 즉시 resolve라 기존 테스트 동작은 그대로다. */
  closeImpl: () => Promise<void> = () => Promise.resolve();

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
  close(): Promise<void> { this.closeCalls++; return this.closeImpl(); }
}

type MicTapPrivate = { capture: { ctx: AudioContext } | null };
type TestAudioGlobals = typeof globalThis & { window?: unknown; AudioWorkletNode?: unknown };

function installAudioContextStub(
  addModules: Array<() => Promise<void>>,
  opts: { onWorkletConstruct?: () => void } = {},
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
  class WorkletNodeStub extends StubWorkletNode {
    constructor() {
      super();
      opts.onWorkletConstruct?.();
    }
  }
  globals.window = { AudioContext: AudioContextStub };
  globals.AudioWorkletNode = WorkletNodeStub;
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

  test('노드 생성 중 취소된 옛 attach는 publish 직전 세대 확인으로 새 스트림을 덮지 않는다', async () => {
    const oldStream = {} as MediaStream;
    const currentStream = {} as MediaStream;
    let tap!: MicPrerollTap;
    let workletConstructions = 0;
    const env = installAudioContextStub(
      [() => Promise.resolve(), () => Promise.resolve()],
      {
        onWorkletConstruct: () => {
          workletConstructions++;
          // 마지막 await(addModule) 뒤, capture 게시 직전 재진입으로 detach를 끼운다.
          if (workletConstructions === 1) void tap.detach().catch(() => {});
        },
      },
    );
    tap = new MicPrerollTap();
    try {
      await tap.attach(oldStream);
      expect(tap.isAttachedTo(oldStream)).toBe(false);
      expect(env.contexts[0].closeCalls).toBe(1);

      await tap.attach(currentStream);
      expect(tap.isAttachedTo(currentStream)).toBe(true);
      expect(tap.isAttachedTo(oldStream)).toBe(false);
    } finally {
      void tap.detach().catch(() => {});
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

  test('init() 성공 후 dispose()하면 활성 입력장치 정보를 비운다', async () => {
    const rec = new AudioRecorder();
    const acquired = countingStream();
    (rec as unknown as { acquireStream: () => Promise<MediaStream> }).acquireStream =
      async () => acquired.stream;

    expect(await rec.init()).toBe(true);
    expect(rec.getActiveInput()).toEqual({ deviceId: 'dev', label: 'mic' });

    rec.dispose();

    expect(rec.getActiveInput()).toBeNull();
    expect(acquired.stopped()).toBe(1);
  });

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

  test('[리뷰#8] init() 대기 중 dispose() 후 재호출하면 새 스트림을 획득한다', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
      stream: MediaStream | null;
    };
    const stale = countingStream();
    const fresh = countingStream();
    const firstAcquire = deferred<MediaStream>();
    const secondAcquire = deferred<MediaStream>();
    let acquireCalls = 0;
    priv.acquireStream = () => {
      acquireCalls += 1;
      return acquireCalls === 1 ? firstAcquire.promise : secondAcquire.promise;
    };

    const staleInit = rec.init();
    rec.dispose();
    const freshInit = rec.init();
    expect(acquireCalls).toBe(2);             // dispose 뒤 낡은 initPromise를 물려받지 않는다

    secondAcquire.resolve(fresh.stream);
    expect(await freshInit).toBe(true);
    expect(priv.stream).toBe(fresh.stream);

    firstAcquire.resolve(stale.stream);       // 폐기 전 획득이 더 늦게 성공해도 새 스트림을 건드리지 않는다
    expect(await staleInit).toBe(false);
    expect(stale.stopped()).toBe(1);
    expect(fresh.stopped()).toBe(0);
    expect(priv.stream).toBe(fresh.stream);
  });

  test('[리뷰#8] 낡은 init의 finally가 진행 중인 새 initPromise를 지우지 않는다', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
      initPromise: Promise<boolean> | null;
    };
    const stale = countingStream();
    const fresh = countingStream();
    const firstAcquire = deferred<MediaStream>();
    const secondAcquire = deferred<MediaStream>();
    let acquireCalls = 0;
    priv.acquireStream = () => {
      acquireCalls += 1;
      return acquireCalls === 1 ? firstAcquire.promise : secondAcquire.promise;
    };

    const staleInit = rec.init();
    rec.dispose();
    const freshInit = rec.init();
    const registeredFreshInit = priv.initPromise;
    expect(acquireCalls).toBe(2);

    firstAcquire.resolve(stale.stream);
    expect(await staleInit).toBe(false);
    expect(priv.initPromise).toBe(registeredFreshInit);

    const sharedFreshInit = rec.init();
    expect(acquireCalls).toBe(2);             // 새 획득이 진행 중이므로 세 번째 획득은 시작하지 않는다
    secondAcquire.resolve(fresh.stream);
    expect(await freshInit).toBe(true);
    expect(await sharedFreshInit).toBe(true);
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

  test('[리뷰#8] dispose()는 낡은 recovering 가드를 분리하고 새 복구 가드를 보존한다', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
      stream: MediaStream | null;
      recovering: boolean;
    };
    const stale = countingStream();
    const fresh = countingStream();
    const firstAcquire = deferred<MediaStream>();
    const secondAcquire = deferred<MediaStream>();
    let acquireCalls = 0;
    priv.acquireStream = () => {
      acquireCalls += 1;
      return acquireCalls === 1 ? firstAcquire.promise : secondAcquire.promise;
    };

    const staleRecovery = rec.recoverStream('stale', { bypassCooldown: true });
    rec.dispose();
    const freshRecovery = rec.recoverStream('fresh', { bypassCooldown: true });
    expect(acquireCalls).toBe(2);

    firstAcquire.resolve(stale.stream);
    expect(await staleRecovery).toBe(false);
    expect(priv.recovering).toBe(true);       // 낡은 finally가 새 복구의 진행 가드를 풀지 않는다
    expect(await rec.recoverStream('third', { bypassCooldown: true })).toBe(false);
    expect(acquireCalls).toBe(2);

    secondAcquire.resolve(fresh.stream);
    expect(await freshRecovery).toBe(true);
    expect(priv.recovering).toBe(false);
    expect(priv.stream).toBe(fresh.stream);
    expect(stale.stopped()).toBe(1);
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

  test('[리뷰#9] init attach가 밀려도 이긴 recover 스트림을 끊지 않는다', async () => {
    const firstAttachGate = deferred<void>();
    const firstAttachStarted = deferred<void>();
    const env = installAudioContextStub([
      () => { firstAttachStarted.resolve(); return firstAttachGate.promise; },
      () => Promise.resolve(),
    ]);
    const rec = new AudioRecorder();
    const priv = rec as unknown as { acquireStream: () => Promise<MediaStream>; stream: MediaStream | null };
    const stale = countingStream();
    const winner = countingStream();
    let calls = 0;
    priv.acquireStream = async () => {
      calls += 1;
      return calls === 1 ? stale.stream : winner.stream;
    };

    try {
      const staleInit = rec.init();
      await firstAttachStarted.promise;
      const winningRecovery = rec.recoverStream('winner', { bypassCooldown: true });
      expect(await winningRecovery).toBe(true);
      expect(priv.stream).toBe(winner.stream);

      firstAttachGate.resolve();
      expect(await staleInit).toBe(false);
      expect(stale.stopped()).toBeGreaterThan(0);
      expect(winner.stopped()).toBe(0);
      expect(priv.stream).toBe(winner.stream);
    } finally {
      rec.dispose();
      env.restore();
    }
  });

  test('[리뷰#9] recover attach가 밀려도 dispose 뒤 이긴 init 스트림을 끊지 않는다', async () => {
    const firstAttachGate = deferred<void>();
    const firstAttachStarted = deferred<void>();
    const env = installAudioContextStub([
      () => { firstAttachStarted.resolve(); return firstAttachGate.promise; },
      () => Promise.resolve(),
    ]);
    const rec = new AudioRecorder();
    const priv = rec as unknown as { acquireStream: () => Promise<MediaStream>; stream: MediaStream | null };
    const stale = countingStream();
    const winner = countingStream();
    let calls = 0;
    priv.acquireStream = async () => {
      calls += 1;
      return calls === 1 ? stale.stream : winner.stream;
    };

    try {
      const staleRecovery = rec.recoverStream('stale', { bypassCooldown: true });
      await firstAttachStarted.promise;
      rec.dispose();
      const winningInit = rec.init();
      expect(await winningInit).toBe(true);
      expect(priv.stream).toBe(winner.stream);

      firstAttachGate.resolve();
      expect(await staleRecovery).toBe(false);
      expect(stale.stopped()).toBeGreaterThan(0);
      expect(winner.stopped()).toBe(0);
      expect(priv.stream).toBe(winner.stream);
    } finally {
      rec.dispose();
      env.restore();
    }
  });

  test('[리뷰#9] init attach 예외는 자기 획득 스트림을 닫고 실제 실패 사유를 남긴다', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
      prerollTap: MicPrerollTap;
      stream: MediaStream | null;
    };
    const acquired = countingStream();
    priv.acquireStream = async () => acquired.stream;
    priv.prerollTap.attach = async () => { throw new Error('attach failed'); };

    expect(await rec.init()).toBe(false);
    expect(acquired.stopped()).toBe(1);
    expect(priv.stream).toBeNull();
    expect(rec.getLastInitError()).toBe('Error');
  });

  test('[리뷰#9] recover attach 예외는 자기 획득 스트림을 닫는다', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
      prerollTap: MicPrerollTap;
      stream: MediaStream | null;
    };
    const acquired = countingStream();
    priv.acquireStream = async () => acquired.stream;
    priv.prerollTap.attach = async () => { throw new Error('attach failed'); };

    expect(await rec.recoverStream('attach_throw', { bypassCooldown: true })).toBe(false);
    expect(acquired.stopped()).toBe(1);
    expect(priv.stream).toBeNull();
  });

  test('[리뷰#9] 밀린 init attach 예외는 이긴 recover 스트림을 보존한다', async () => {
    const firstAttach = deferred<void>();
    const firstAttachStarted = deferred<void>();
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
      prerollTap: MicPrerollTap;
      stream: MediaStream | null;
    };
    const stale = countingStream();
    const winner = countingStream();
    let acquireCalls = 0;
    let attachCalls = 0;
    priv.acquireStream = async () => {
      acquireCalls += 1;
      return acquireCalls === 1 ? stale.stream : winner.stream;
    };
    priv.prerollTap.attach = async () => {
      attachCalls += 1;
      if (attachCalls === 1) {
        firstAttachStarted.resolve();
        return firstAttach.promise;
      }
    };

    try {
      const staleInit = rec.init();
      await firstAttachStarted.promise;
      const winningRecovery = rec.recoverStream('winner', { bypassCooldown: true });
      expect(await winningRecovery).toBe(true);
      expect(priv.stream).toBe(winner.stream);

      firstAttach.reject(new Error('late attach failed'));
      expect(await staleInit).toBe(false);
      expect(stale.stopped()).toBeGreaterThan(0);
      expect(winner.stopped()).toBe(0);
      expect(priv.stream).toBe(winner.stream);
    } finally {
      rec.dispose();
    }
  });

  test('[리뷰#9] stale init은 이전 실패 사유를 권한 거부처럼 재사용하지 않는다', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
      lastInitError: string | null;
    };
    const stale = countingStream();
    const acquire = deferred<MediaStream>();
    priv.lastInitError = 'NotAllowedError';
    priv.acquireStream = () => acquire.promise;

    const staleInit = rec.init();
    rec.dispose();
    acquire.resolve(stale.stream);

    expect(await staleInit).toBe(false);
    expect(rec.getLastInitError()).toBeNull();
  });

  /**
   * v0.38.0 [리뷰#8 검수 보완 — Larry] Codex가 태스크 범위 밖에서 추가한 가드 2건에 반증을 붙인다.
   * 방향은 옳지만 **테스트가 없으면 [ORCH-18] "반증되지 않는 가드"** 라 다음 리팩토링에 조용히 사라진다.
   *
   * ①`recoverStream`의 `catch`가 무조건 `this.stream = null`을 하면, 밀린 복구가 뒤늦게 실패할 때
   *   **이긴 획득이 확보한 스트림 참조를 지워** 마이크가 살아 있는데도 앱은 없다고 믿는다(=녹음 사망 +
   *   아무도 stop하지 않는 트랙).
   * ②`lastInitError`도 같다 — 밀린 init의 실패 사유가 현재 상태를 덮으면 prewarm 텔레메트리
   *   `_denied`가 **엉뚱한 원인**을 싣는다(SOP-003 판독이 틀어진다).
   */
  test('[리뷰#8+] 밀린 복구가 뒤늦게 실패해도 이긴 획득의 스트림·실패사유를 덮지 않는다', async () => {
    const rec = new AudioRecorder();
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
      stream: MediaStream | null;
      lastInitError: string | null;
    };
    const fresh = countingStream();
    // 이 파일의 deferred 헬퍼에는 reject가 없다 — 거부 경로가 필요하므로 여기서 직접 만든다.
    let rejectStale: ((e: unknown) => void) | null = null;
    let resolveFresh: ((s: MediaStream) => void) | null = null;
    const stalePromise = new Promise<MediaStream>((_, rej) => { rejectStale = rej; });
    const freshPromise = new Promise<MediaStream>((res) => { resolveFresh = res; });
    stalePromise.catch(() => { /* 아래에서 recoverStream이 처리한다 — 미처리 거부 경고 방지 */ });
    let calls = 0;
    priv.acquireStream = () => {
      calls += 1;
      return calls === 1 ? stalePromise : freshPromise;
    };

    const staleRecovery = rec.recoverStream('stale', { bypassCooldown: true });
    await Promise.resolve();
    const winningInit = rec.init();          // 나중에 시작 → 이긴다(acquireGen 증가)
    await Promise.resolve();
    expect(calls).toBe(2);

    resolveFresh!(fresh.stream);
    expect(await winningInit).toBe(true);
    expect(priv.stream).toBe(fresh.stream);

    rejectStale!(new DOMException('denied', 'NotAllowedError'));
    expect(await staleRecovery).toBe(false);

    // 밀린 쪽의 실패가 이긴 쪽의 상태를 건드리면 안 된다.
    expect(priv.stream).toBe(fresh.stream);  // ①스트림 참조 보존 — null이면 마이크가 고아가 된다
    expect(fresh.stopped()).toBe(0);
    expect(priv.lastInitError).toBeNull();   // ②성공한 init의 "실패 사유 없음"이 유지된다
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

/**
 * v0.38.1 [MIC-B2] **포그라운드 복귀 선-정리(`teardownAudioGraph`)** — 낡은 오디오 그래프 해제와 계측.
 *
 * 근인(2026-07-24 실기기 확증): 앱 50분 백그라운드 + BT→스피커 경로전환 뒤, 권한이 허용 상태인데도
 * 재연결 `getUserMedia`가 8회 전부 `NotAllowedError`로 ~10ms 내 거부됐다(0클립, STT는 생존).
 * 유력 원인은 iOS 오디오 세션이 interrupted로 물린 채 낡은 `AudioContext`가 붙들고 있는 것인데,
 * **첫 재연결 시도가 이미 `detach()`로 그 참조를 버린 뒤라 2회차부터는 닫을 대상조차 없었다.**
 * 그래서 닫을 수 있는 유일한 창이 "재연결 시도 이전, 포그라운드 복귀 직후"다.
 *
 * 이 수정의 원인가설(P1)·효과(P2)는 **미검증**이고 실기기가 최종 판정자다. 그러므로 여기서 고정할
 * 계약은 "iOS가 고쳐졌다"가 아니라 **판정에 필요한 바이트가 정확히 남는가**이다(#12-bis):
 *  - `found=none`      → 닫을 게 없었다(수정이 no-op) — 원인은 JS측 컨텍스트가 아니다
 *  - `closed=timeout`  → close 자체가 물렸다
 *  - `found=interrupted:closed=ok` 후 획득 성공 → P1·P2 확정
 * 이 구분이 없으면 "고쳐도 안 풀린 것"과 "애초에 아무것도 안 한 것"을 영원히 못 가른다.
 */
test.describe('v0.38.1 [MIC-B2] teardownAudioGraph() — 낡은 그래프 해제 + 판정 바이트', () => {
  test.beforeEach(() => logger.clear());
  test.afterEach(() => logger.clear());

  const teardownExtras = (): string[] =>
    logger.getAll().map((e) => e.extra ?? '').filter((x) => x.startsWith('mic_teardown:'));

  const tapOf = (rec: AudioRecorder): MicPrerollTap =>
    (rec as unknown as { prerollTap: MicPrerollTap }).prerollTap;

  test('물린 컨텍스트를 실제로 닫고 found=interrupted:closed=ok를 남긴다', async () => {
    const env = installAudioContextStub([() => Promise.resolve()]);
    const rec = new AudioRecorder();
    try {
      await tapOf(rec).attach({} as MediaStream);
      env.contexts[0].state = 'interrupted'; // iOS 백그라운드 인터럽션 재현

      await rec.teardownAudioGraph('vis', 3000_000);

      expect(env.contexts[0].closeCalls).toBe(1);
      expect(teardownExtras()).toEqual([
        'mic_teardown:found=interrupted,closed=ok,reattach=skipped,evt=vis,bg_s=3000',
      ]);
    } finally {
      env.restore();
    }
  });

  /** **반증 테스트(#12-bis).** `teardownAudioGraph`의 `withTimeout` 경계를 제거하면 이 테스트는
   *  영원히 멈춰 실패해야 한다 — 그래야 "정리 코드가 되레 다음 획득을 막는" 회귀를 테스트가 잡는다. */
  test('close가 물려 멈춰도 경계 안에서 끝나고 closed=timeout을 남긴다', async () => {
    const env = installAudioContextStub([() => Promise.resolve()]);
    const rec = new AudioRecorder();
    try {
      (rec as unknown as { teardownTimeoutMs: number }).teardownTimeoutMs = 20;
      await tapOf(rec).attach({} as MediaStream);
      env.contexts[0].state = 'interrupted';
      env.contexts[0].closeImpl = () => new Promise<void>(() => { /* 영원히 멈춘 close */ });

      await rec.teardownAudioGraph('vis', 3000_000);

      expect(teardownExtras()).toEqual([
        'mic_teardown:found=interrupted,closed=timeout,reattach=skipped,evt=vis,bg_s=3000',
      ]);
    } finally {
      env.restore();
    }
  });

  test('닫을 그래프가 없으면 found=none — no-op이 조용한 성공으로 읽히지 않는다', async () => {
    const rec = new AudioRecorder();

    await rec.teardownAudioGraph('pageshow', 120_000);

    expect(teardownExtras()).toEqual([
      'mic_teardown:found=none,closed=ok,reattach=skipped,evt=pageshow,bg_s=120',
    ]);
  });

  /** 회귀 방지: 정리만 하고 끝내면 "백그라운드 다녀오면 파형·프리롤이 죽는" 새 결함을 만든다 —
   *  마이크는 멀쩡한데도. 트랙이 살아 있으면 캡처 탭을 다시 붙여 원상 복구한다. */
  test('정리 후 트랙이 살아 있으면 캡처를 재부착한다(복귀 후 파형 사망 방지)', async () => {
    const env = installAudioContextStub([() => Promise.resolve(), () => Promise.resolve()]);
    const current = trackedStream();
    const rec = withStream(new AudioRecorder(), current.stream);
    try {
      await tapOf(rec).attach({} as MediaStream);

      await rec.teardownAudioGraph('vis', 90_000);

      expect(env.contexts[0].closeCalls).toBe(1); // 낡은 컨텍스트는 닫혔고
      expect(env.contexts).toHaveLength(2);       // 새 그래프로 다시 붙었다
      expect(tapOf(rec).isAttachedTo(current.stream)).toBe(true);
      expect(teardownExtras()).toEqual([
        'mic_teardown:found=running,closed=ok,reattach=ok,evt=vis,bg_s=90',
      ]);
    } finally {
      env.restore();
    }
  });

  test('close가 reject하면 closed=error를 기록하고 거짓 성공으로 바꾸지 않는다', async () => {
    const env = installAudioContextStub([() => Promise.resolve()]);
    const rec = new AudioRecorder();
    try {
      await tapOf(rec).attach({} as MediaStream);
      env.contexts[0].state = 'interrupted';
      env.contexts[0].closeImpl = () => Promise.reject(new Error('close rejected'));

      await rec.teardownAudioGraph('vis', 61_000);

      expect(teardownExtras()).toEqual([
        'mic_teardown:found=interrupted,closed=error,reattach=skipped,evt=vis,bg_s=61',
      ]);
    } finally {
      env.restore();
    }
  });

  test('close timeout 뒤에도 소유권과 live 트랙이 같으면 재부착해 프리롤·파형을 되살린다', async () => {
    const env = installAudioContextStub([() => Promise.resolve(), () => Promise.resolve()]);
    const current = trackedStream();
    const rec = withStream(new AudioRecorder(), current.stream);
    (rec as unknown as { teardownTimeoutMs: number }).teardownTimeoutMs = 20;
    try {
      await tapOf(rec).attach(current.stream);
      env.contexts[0].closeImpl = () => new Promise<void>(() => {});

      await rec.teardownAudioGraph('vis', 62_000);

      expect(env.contexts).toHaveLength(2);
      expect(tapOf(rec).isAttachedTo(current.stream)).toBe(true);
      expect(teardownExtras()).toEqual([
        'mic_teardown:found=running,closed=timeout,reattach=ok,evt=vis,bg_s=62',
      ]);
    } finally {
      void tapOf(rec).detach().catch(() => {});
      env.restore();
    }
  });

  test('readyState가 live인 muted 트랙도 배너 사망이 아니므로 재부착을 시도한다', async () => {
    const env = installAudioContextStub([() => Promise.resolve(), () => Promise.resolve()]);
    const current = trackedStream('muted-live', true);
    const rec = withStream(new AudioRecorder(), current.stream);
    try {
      await tapOf(rec).attach(current.stream);

      await rec.teardownAudioGraph('pageshow', 62_000);

      expect(tapOf(rec).isAttachedTo(current.stream)).toBe(true);
      expect(teardownExtras()).toEqual([
        'mic_teardown:found=running,closed=ok,reattach=ok,evt=pageshow,bg_s=62',
      ]);
    } finally {
      void tapOf(rec).detach().catch(() => {});
      env.restore();
    }
  });

  test('재부착이 내부 폴백까지 소진해 capture를 못 게시하면 reattach=error를 남긴다', async () => {
    const env = installAudioContextStub([() => Promise.resolve()]);
    const current = trackedStream();
    const rec = withStream(new AudioRecorder(), current.stream);
    const tap = tapOf(rec);
    try {
      await tap.attach(current.stream);
      tap.attach = async () => { /* 실패를 내부에서 삼킨 attach의 외부 관측 형태 */ };

      await rec.teardownAudioGraph('pageshow', 63_000);

      expect(teardownExtras()).toEqual([
        'mic_teardown:found=running,closed=ok,reattach=error,evt=pageshow,bg_s=63',
      ]);
    } finally {
      env.restore();
    }
  });

  test('재부착 timeout은 늦은 attach를 취소하고 reattach=timeout으로 계측한다', async () => {
    const attachGate = deferred<void>();
    const env = installAudioContextStub([
      () => Promise.resolve(),
      () => attachGate.promise,
    ]);
    const current = trackedStream();
    const rec = withStream(new AudioRecorder(), current.stream);
    const tap = tapOf(rec);
    (rec as unknown as { teardownTimeoutMs: number }).teardownTimeoutMs = 20;
    try {
      await tap.attach(current.stream);

      await rec.teardownAudioGraph('vis', 64_000);
      attachGate.resolve();
      await Promise.resolve();

      expect(tap.isAttachedTo(current.stream)).toBe(false);
      expect(env.contexts[1].closeCalls).toBe(1);
      expect(teardownExtras()).toEqual([
        'mic_teardown:found=running,closed=ok,reattach=timeout,evt=vis,bg_s=64',
      ]);
    } finally {
      env.restore();
    }
  });

  test('close 대기 중 recover가 새 스트림을 차지하면 teardown은 재부착을 건너뛰고 새 capture를 보존한다', async () => {
    const closeGate = deferred<void>();
    const env = installAudioContextStub([() => Promise.resolve(), () => Promise.resolve()]);
    const old = trackedStream('old');
    const current = trackedStream('current');
    const rec = withStream(new AudioRecorder(), old.stream);
    const tap = tapOf(rec);
    const priv = rec as unknown as {
      acquireStream: () => Promise<MediaStream>;
      stream: MediaStream | null;
    };
    priv.acquireStream = async () => current.stream;
    try {
      await tap.attach(old.stream);
      env.contexts[0].closeImpl = () => closeGate.promise;

      const teardown = rec.teardownAudioGraph('vis', 65_000);
      expect(env.contexts[0].closeCalls).toBe(1);

      expect(await rec.recoverStream('race', { bypassCooldown: true })).toBe(true);
      expect(priv.stream).toBe(current.stream);
      expect(tap.isAttachedTo(current.stream)).toBe(true);

      closeGate.resolve();
      await teardown;

      expect(tap.isAttachedTo(current.stream)).toBe(true);
      expect(tap.isAttachedTo(old.stream)).toBe(false);
      expect(teardownExtras()).toEqual([
        'mic_teardown:found=running,closed=ok,reattach=skipped,evt=vis,bg_s=65',
      ]);
    } finally {
      rec.dispose();
      env.restore();
    }
  });
});

/**
 * v0.38.1 [MIC-B2] `detach()`를 awaitable로 승격하면서 **깨지면 안 되는 계약**: 동기 구간은 여전히
 * 호출 즉시 끝난다.
 *
 * 왜 중요한가: `recoverStream()`/`releaseAcquiredStream()`/`dispose()`는 이 메서드를 `void`로 부른다.
 * getUserMedia 직전에 `close()` 완료를 기다리면 제스처 창을 소모하거나 hung close가 획득을 막아
 * **정상 경로(같은 날 세션A는 78클립 정상)** 까지 깨뜨린다(Pax §6 안티패턴). 그래서 "그래프 해제는
 * 즉시, close는 뒤로" 라는 분리가 유지되는지 못 박는다.
 */
test('[MIC-B2] detach()의 동기 구간은 close를 기다리지 않는다 — gUM 경로 비차단 계약', async () => {
  const env = installAudioContextStub([() => Promise.resolve()]);
  const tap = new MicPrerollTap();
  try {
    await tap.attach({} as MediaStream);
    env.contexts[0].closeImpl = () => new Promise<void>(() => { /* close가 멈춰 있어도 */ });

    const pending = tap.detach(); // 획득 경로와 동일하게 await하지 않는다

    // await 한 번도 없이 이미 해제돼 있어야 한다 — 그래야 호출부가 곧바로 gUM으로 진행한다.
    expect((tap as unknown as MicTapPrivate).capture).toBeNull();
    expect(tap.getContextState()).toBe('none');
    expect(env.contexts[0].closeCalls).toBe(1);
    void pending;
  } finally {
    env.restore();
  }
});
