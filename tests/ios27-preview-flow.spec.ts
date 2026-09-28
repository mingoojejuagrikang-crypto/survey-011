import { test, expect, type Page } from '@playwright/test';
import { boot, COLUMNS, PHONE_402, SETTINGS } from './fixtures/activeZones';
import { fireStt, ttsLog } from './fixtures/stt';

test.setTimeout(70_000);

const settings = {
  ...SETTINGS,
  state: { ...SETTINGS.state, columns: [...COLUMNS.slice(0, 3), ...COLUMNS.slice(4, 6)],
    totalRows: 2, sessionAutoLabel: 'ios27-preview-test', bargeInEnabled: true },
};

async function valueEvents(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve) => {
      const req = indexedDB.open('agri-voicenote');
      req.onsuccess = () => resolve(req.result);
    });
    const events = await new Promise<Array<{ type?: string; parsed?: string; colId?: string; extra?: string }>>((resolve) => {
      const req = db.transaction('logEvents', 'readonly').objectStore('logEvents').getAll();
      req.onsuccess = () => resolve(req.result as Array<{ type?: string; parsed?: string; colId?: string; extra?: string }>);
    });
    db.close();
    return events;
  });
}

test('hybrid — real first and second values commit once across fresh recognizers', async ({ page }) => {
  await boot(page, PHONE_402, { settings: { ...settings, state: { ...settings.state, refreshRecognitionAfterTts: true } } as typeof SETTINGS,
    sttMode: 'firstResultThenSilentAfterPlayback' });
  await fireStt(page, '54.6', 1100);
  await expect.poll(async () => (await valueEvents(page)).filter((e) => e.type === 'value').length).toBe(1);
  await expect.poll(async () => (await valueEvents(page)).some((e) => e.extra?.startsWith('stt_hybrid_swap:'))).toBe(true);
  await fireStt(page, '23.4', 1400);
  await expect.poll(async () => (await valueEvents(page)).filter((e) => e.type === 'value').length).toBe(2);
  const values = (await valueEvents(page)).filter((e) => e.type === 'value');
  expect(values.map((e) => e.colId)).toEqual(['v1', 'v2']);
  expect((await valueEvents(page)).some((e) => e.extra === 'stt_hybrid_policy:platform=other,option=1,enabled=1,bargeIn=1')).toBe(true);
  expect((await valueEvents(page)).some((e) => e.extra?.startsWith('ready_beep:'))).toBe(false);
});

test('ready beep — ordinary barge-in OFF also cues listening after fresh onstart', async ({ page }) => {
  const offSettings = { ...settings, state: { ...settings.state, bargeInEnabled: false } };
  await boot(page, PHONE_402, { settings: offSettings as typeof SETTINGS });
  await expect.poll(async () => (await valueEvents(page)).some((e) =>
    e.extra?.startsWith('ready_beep:') && e.extra.includes('phase=onstart'))).toBe(true);
  const extras = (await valueEvents(page)).map((e) => e.extra ?? '');
  const start = extras.findIndex((e) => e.startsWith('stt_raw:') && e.includes('evt=start'));
  const cue = extras.findIndex((e) => e.startsWith('ready_beep:') && e.includes('phase=onstart'));
  expect(start).toBeGreaterThanOrEqual(0);
  expect(cue).toBeGreaterThan(start);
});

test('G1 — five-second clip mute uses the existing interruption status and speaks once per session', async ({ page }) => {
  await boot(page, PHONE_402, { settings: settings as typeof SETTINGS });
  const setMuted = (v: boolean) => page.evaluate((next) => (window as any).__setFakeTrackMuted?.(next) === true, v);
  expect(await setMuted(true)).toBe(true);
  await expect(page.locator('[data-testid="mic-interrupt-status"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="mic-interrupt-status"]'), 'same interruption surface escalates after threshold')
    .toHaveText('음성 클립 저장이 불안정합니다', { timeout: 7_000 });
  expect((await ttsLog(page)).filter((t) => t === '음성 클립 저장이 불안정합니다')).toHaveLength(0);
  const hero = await page.locator('[data-testid="hero-hold-surface"]').boundingBox();
  if (!hero) throw new Error('hero hold surface missing');
  await page.mouse.move(hero.x + hero.width / 2, hero.y + hero.height / 2);
  await page.mouse.down();
  await expect(page.locator('[data-testid="hero-hold-cue"]')).toContainText('음성 클립 저장이 불안정합니다');
  await page.waitForTimeout(550); // the ordinary hold TTS fires, but must not repeat G1's exact utterance
  await page.mouse.up();
  expect((await ttsLog(page)).filter((t) => t === '음성 클립 저장이 불안정합니다')).toHaveLength(0);
  expect(await setMuted(false)).toBe(true);
  await expect.poll(async () => (await ttsLog(page)).filter((t) => t === '음성 클립 저장이 불안정합니다').length).toBe(1);
  expect((await ttsLog(page)).filter((t) => t.includes('마이크가 잠시 멈춰 있었습니다')).length).toBe(0);
  expect(await setMuted(true)).toBe(true);
  await page.waitForTimeout(5_400);
  expect((await ttsLog(page)).filter((t) => t === '음성 클립 저장이 불안정합니다')).toHaveLength(1);
  const extras = (await valueEvents(page)).map((e) => e.extra ?? '');
  expect(extras.some((e) => e.startsWith('clip_input_probe:edge=first_mute'))).toBe(true);
  expect(extras.some((e) => e.startsWith('clip_input_probe:edge=mute_notice'))).toBe(true);
  expect(extras.some((e) => e.startsWith('mic_auto_reconnect:attempt'))).toBe(false);
  expect(extras.some((e) => e.startsWith('clip_mute_voice:phase=started,n=1'))).toBe(true);
});

test('G1 — missing utterance onstart is attempted, then retried once after unmute', async ({ page }) => {
  await boot(page, PHONE_402, { settings: settings as typeof SETTINGS });
  await page.evaluate(() => {
    const synth = speechSynthesis;
    const original = synth.speak.bind(synth);
    let skipped = false;
    (synth as any).speak = (utterance: SpeechSynthesisUtterance) => {
      if (utterance.text === '음성 클립 저장이 불안정합니다' && !skipped) {
        skipped = true;
        setTimeout(() => utterance.onerror?.(new Event('error') as SpeechSynthesisErrorEvent), 0);
        return;
      }
      original(utterance);
    };
  });
  const setMuted = (v: boolean) => page.evaluate((next) => (window as any).__setFakeTrackMuted?.(next) === true, v);
  expect(await setMuted(true)).toBe(true);
  await expect(page.locator('[data-testid="mic-interrupt-status"]')).toHaveText('음성 클립 저장이 불안정합니다', { timeout: 7_000 });
  expect(await setMuted(false)).toBe(true);
  await expect.poll(async () => (await valueEvents(page)).some((e) => e.extra?.startsWith('clip_mute_voice:phase=started,n=2')), { timeout: 5_000 }).toBe(true);
  expect((await ttsLog(page)).filter((t) => t === '음성 클립 저장이 불안정합니다')).toHaveLength(1);
  const attempts = (await valueEvents(page)).map((e) => e.extra ?? '').filter((e) => e.startsWith('clip_mute_voice:phase=attempt'));
  expect(attempts).toHaveLength(2);
});

test('audio session toggle is independent and restores the original type on session end', async ({ page }) => {
  await page.addInitScript(() => {
    const audioSession = { type: 'auto', state: 'inactive' };
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: audioSession });
  });
  await boot(page, PHONE_402, { settings: settings as typeof SETTINGS,
    beforeStart: async (p) => {
      await p.locator('[data-testid="tab-settings"]').click();
      await p.locator('[data-testid="audio-session-play-and-record"]').check();
    } });
  expect(await page.evaluate(() => (navigator as any).audioSession.type)).toBe('play-and-record');
  expect((await valueEvents(page)).some((e) => e.extra?.startsWith('audio_session_experiment:') &&
    e.extra?.includes('sessionType=on,supported=1,before=auto,after=play-and-record'))).toBe(true);
  await fireStt(page, '종료', 900);
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => (navigator as any).audioSession.type)).toBe('auto');
  expect((await valueEvents(page)).some((e) => e.extra === 'audio_patch_mode_restore:result=ok,type=auto')).toBe(true);
});

test('audio session type restores in background and reapplies on foreground', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'audioSession', {
    configurable: true, value: { type: 'auto', state: 'active' },
  }));
  await boot(page, PHONE_402, { settings: settings as typeof SETTINGS,
    beforeStart: async (p) => {
      await p.locator('[data-testid="tab-settings"]').click();
      await p.locator('[data-testid="audio-session-play-and-record"]').check();
    } });
  expect(await page.evaluate(() => (navigator as any).audioSession.type)).toBe('play-and-record');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => (navigator as any).audioSession.type)).toBe('auto');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => (navigator as any).audioSession.type)).toBe('play-and-record');
  expect((await valueEvents(page)).some((e) => e.extra?.startsWith('audio_patch_mode_reapply:reason=foreground'))).toBe(true);
});

test('audio session type restores on VoiceScreen unmount and reapplies on live remount', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'audioSession', {
    configurable: true, value: { type: 'auto', state: 'active' },
  }));
  await boot(page, PHONE_402, { settings: settings as typeof SETTINGS,
    beforeStart: async (p) => {
      await p.locator('[data-testid="tab-settings"]').click();
      await p.locator('[data-testid="audio-session-play-and-record"]').check();
    } });
  expect(await page.evaluate(() => (navigator as any).audioSession.type)).toBe('play-and-record');
  await page.locator('[data-testid="tab-data"]').click();
  await page.evaluate(async () => (await import('/src/stores/sessionStore.ts')).useSessionStore.getState().setPhase('ready'));
  await expect.poll(() => page.evaluate(() => (navigator as any).audioSession.type)).toBe('auto');
  await page.evaluate(async () => (await import('/src/stores/sessionStore.ts')).useSessionStore.getState().setPhase('active'));
  await expect.poll(() => page.evaluate(() => (navigator as any).audioSession.type)).toBe('play-and-record');
  expect((await valueEvents(page)).some((e) => e.extra?.startsWith('audio_patch_mode_reapply:reason=remount'))).toBe(true);
});

test('audio session toggle is disabled when the API is absent', async ({ page }) => {
  await boot(page, PHONE_402, { settings: settings as typeof SETTINGS,
    beforeStart: async (p) => {
      await p.locator('[data-testid="tab-settings"]').click();
      await expect(p.locator('[data-testid="audio-session-play-and-record"]')).toBeDisabled();
      await expect(p.locator('[data-testid="audio-patch-controls"]')).toContainText('미지원');
    } });
  expect((await valueEvents(page)).some((e) => e.extra?.startsWith('audio_session_experiment:') &&
    e.extra?.includes('sessionType=off,supported=0,before=unreadable,after=unreadable'))).toBe(true);
});
