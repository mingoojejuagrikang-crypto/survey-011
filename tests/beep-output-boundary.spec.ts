import { test, expect } from '@playwright/test';

async function exercise(page: import('@playwright/test').Page, mode: 'suspended' | 'partial' | 'no_end') {
  await page.goto('/');
  return page.evaluate(async (failureMode) => {
    const trace = { edges: [] as string[], starts: 0, stops: 0, disconnects: 0, creates: 0 };
    const param = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    class FakeAudioContext {
      state = failureMode === 'suspended' ? 'suspended' : 'running';
      currentTime = 0;
      destination = {};
      resume() { return Promise.resolve(); }
      createGain() { return { gain: param, connect() {}, disconnect() { trace.disconnects++; } }; }
      createOscillator() {
        if (++trace.creates === 2 && failureMode === 'partial') throw new Error('partial schedule');
        return { frequency: param, type: 'sine', onended: null,
          connect() {}, disconnect() { trace.disconnects++; },
          start() { trace.starts++; }, stop() { trace.stops++; } };
      }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext });
    const speech = await import('/src/lib/speech.ts');
    const beep = await import('/src/lib/beep.ts');
    speech.setActiveController({
      beginOutput: () => 1,
      outputEdge: (_seq: number, _kind: string, evt: string) => { trace.edges.push(evt); },
    } as any);
    beep.playBeep('commit');
    await new Promise((resolve) => setTimeout(resolve, failureMode === 'no_end' ? 2_300 : 50));
    speech.setActiveController(null);
    return trace;
  }, mode);
}

test('suspended AudioContext settles the beep output token without scheduling audio', async ({ page }) => {
  const trace = await exercise(page, 'suspended');
  expect(trace.edges).toEqual(['skip']);
  expect(trace.starts).toBe(0);
});

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
