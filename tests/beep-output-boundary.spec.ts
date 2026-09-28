import { test, expect } from '@playwright/test';

async function exercise(page: import('@playwright/test').Page, mode: 'suspended' | 'suspended_stuck' | 'interrupted' | 'partial' | 'no_end') {
  await page.goto('/');
  return page.evaluate(async (failureMode) => {
    const trace = { edges: [] as string[], starts: 0, stops: 0, disconnects: 0, creates: 0, extras: [] as string[] };
    const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    class FakeAudioContext {
      state = failureMode === 'suspended' || failureMode === 'suspended_stuck' ? 'suspended'
        : failureMode === 'interrupted' ? 'interrupted' : 'running';
      currentTime = 0;
      destination = {};
      private oscillators: Array<{ onended: (() => void) | null }> = [];
      constructor() {
        if (this.state === 'interrupted') setTimeout(() => this.resume(), 0);
      }
      resume() {
        if (failureMode === 'suspended_stuck') return Promise.resolve();
        setTimeout(() => {
          this.state = 'running';
          setTimeout(() => this.oscillators.forEach((osc) => osc.onended?.()), 20);
        }, 0);
        return Promise.resolve();
      }
      createGain() { return { gain: param, connect() {}, disconnect() { trace.disconnects++; } }; }
      createOscillator() {
        if (++trace.creates === 2 && failureMode === 'partial') throw new Error('partial schedule');
        const osc = { frequency: param, type: 'sine', onended: null as (() => void) | null,
          connect() {}, disconnect() { trace.disconnects++; },
          start() { trace.starts++; }, stop() { trace.stops++; } };
        this.oscillators.push(osc);
        return osc;
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
    const speech = await import('/src/lib/speech.ts');
    const beep = await import('/src/lib/beep.ts');
    const { logger } = await import('/src/lib/logger.ts');
    logger.clear();
    speech.setActiveController({
      beginOutput: () => 1,
      outputEdge: (_seq: number, _kind: string, evt: string) => { trace.edges.push(evt); },
    } as any);
    beep.playBeep('commit');
    await new Promise((resolve) => setTimeout(resolve,
      failureMode === 'no_end' || failureMode === 'suspended_stuck' ? 2_300 : 50));
    trace.extras = logger.getAll().map((entry) => entry.extra ?? '').filter((extra) => extra.startsWith('beep_play:'));
    speech.setActiveController(null);
    return trace;
  }, mode);
}

test('still-suspended context retains scheduled tones but releases the output token on the wall-clock cap', async ({ page }) => {
  const trace = await exercise(page, 'suspended_stuck');
  expect(trace.starts).toBe(3);
  expect(trace.edges).toEqual(['skip']);
  expect(trace.extras).toEqual(['beep_play:kind=commit,result=suspended,ctx=suspended,gain=12,tones=3']);
});

for (const state of ['suspended', 'interrupted'] as const) {
  test(`${state} AudioContext schedules the original tones, plays on resume, and preserves beep_play bytes`, async ({ page }) => {
    const trace = await exercise(page, state);
    expect(trace.starts).toBe(3);
    expect(trace.edges).toEqual(['end']);
    expect(trace.extras).toEqual([
      `beep_play:kind=commit,result=suspended,ctx=${state},gain=12,tones=3`,
    ]);
  });
}

test('partial oscillator schedule stops the started node and settles exactly once', async ({ page }) => {
  const trace = await exercise(page, 'partial');
  expect(trace.edges).toEqual(['skip']);
  expect(trace.starts).toBe(1);
  expect(trace.stops).toBeGreaterThanOrEqual(1);
  expect(trace.disconnects).toBeGreaterThanOrEqual(2);
});

test('missing oscillator onended is bounded and releases the beep output token', async ({ page }) => {
  const trace = await exercise(page, 'no_end');
  expect(trace.edges).toEqual(['skip']);
  expect(trace.starts).toBeGreaterThan(0);
  expect(trace.stops).toBeGreaterThan(0);
});
