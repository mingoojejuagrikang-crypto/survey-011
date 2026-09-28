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

async function selectMode(page: Page, mode: 'a' | 'b') {
  await page.locator('[data-testid="tab-settings"]').click();
  await page.locator(`[data-testid="audio-patch-${mode}"]`).click();
  await expect(page.locator(`[data-testid="audio-patch-${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
}

test('A — first value follows real commit; silent old recognizer gets one fresh instance and second column remains correct', async ({ page }) => {
  await boot(page, PHONE_402, { settings: settings as typeof SETTINGS, sttMode: 'firstResultThenSilentAfterPlayback',
    beforeStart: (p) => selectMode(p, 'a') });
  await expect(page.locator('[data-testid="audio-patch-badge"]')).toContainText('A');
  await fireStt(page, '54.6', 1100);
  await expect.poll(async () => (await valueEvents(page)).filter((e) => e.type === 'value').length).toBe(1);
  await expect.poll(() => page.evaluate(() => ((window as any).__mockSTTInstances ?? []).length), { timeout: 15_000 }).toBe(2);
  await fireStt(page, '23.4', 1400);
  await expect.poll(async () => (await valueEvents(page)).filter((e) => e.type === 'value').length).toBe(2);
  const values = (await valueEvents(page)).filter((e) => e.type === 'value');
  expect(values.map((e) => e.colId)).toEqual(['v1', 'v2']);
  const recovery = (await valueEvents(page)).filter((e) => e.extra?.startsWith('stt_recovery:'));
  expect(recovery.some((e) => e.extra?.includes('phase=attempt'))).toBe(true);
  expect(recovery.some((e) => e.extra?.includes('phase=result'))).toBe(true);
  expect((await valueEvents(page)).some((e) => e.extra?.startsWith('ready_beep:'))).toBe(false);
});

test('B — existing half-duplex is forced while setting says barge-in ON; fresh restart waits four seconds', async ({ page }) => {
  await boot(page, PHONE_402, { settings: settings as typeof SETTINGS, sttMode: 'firstResultThenSilentAfterPlayback',
    beforeStart: (p) => selectMode(p, 'b') });
  await fireStt(page, '54.6', 1100);
  await expect.poll(async () => (await valueEvents(page)).filter((e) => e.type === 'value').length).toBe(1);
  await expect.poll(async () => (await valueEvents(page)).some((e) => e.extra?.startsWith('audio_patch_mode:mode=b') && e.extra?.includes('bargeIn=1,halfDuplex=1'))).toBe(true);
  await expect.poll(() => page.evaluate(() => ((window as any).__mockSTTInstances ?? []).length), { timeout: 11_000 }).toBe(2);
  await expect.poll(async () => (await valueEvents(page)).some((e) =>
    e.extra?.startsWith('ready_beep:') && e.extra.includes('phase=play') && e.extra.includes('gain=6'))).toBe(true);
  await fireStt(page, '23.4', 1400);
  const values = (await valueEvents(page)).filter((e) => e.type === 'value');
  expect(values.map((e) => e.colId)).toEqual(['v1', 'v2']);
  const extras = (await valueEvents(page)).map((e) => e.extra ?? '');
  expect(extras.some((e) => e.startsWith('audio_output_edge:') && e.includes('kind=ready_beep'))).toBe(true);
  expect(extras.some((e) => e.startsWith('ready_beep:') && e.includes('phase=first_result'))).toBe(true);
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
  await expect.poll(async () => (await ttsLog(page)).filter((t) => t === '음성 클립 저장이 불안정합니다').length).toBe(1);
  const hero = await page.locator('[data-testid="hero-hold-surface"]').boundingBox();
  if (!hero) throw new Error('hero hold surface missing');
  await page.mouse.move(hero.x + hero.width / 2, hero.y + hero.height / 2);
  await page.mouse.down();
  await expect(page.locator('[data-testid="hero-hold-cue"]')).toContainText('음성 클립 저장이 불안정합니다');
  await page.waitForTimeout(550); // the ordinary hold TTS fires, but must not repeat G1's exact utterance
  await page.mouse.up();
  expect((await ttsLog(page)).filter((t) => t === '음성 클립 저장이 불안정합니다')).toHaveLength(1);
  expect(await setMuted(false)).toBe(true);
  expect(await setMuted(true)).toBe(true);
  await page.waitForTimeout(5_400);
  expect((await ttsLog(page)).filter((t) => t === '음성 클립 저장이 불안정합니다')).toHaveLength(1);
  const extras = (await valueEvents(page)).map((e) => e.extra ?? '');
  expect(extras.some((e) => e.startsWith('clip_input_probe:edge=first_mute'))).toBe(true);
  expect(extras.some((e) => e.startsWith('clip_input_probe:edge=mute_notice'))).toBe(true);
  expect(extras.some((e) => e.startsWith('mic_auto_reconnect:attempt'))).toBe(false);
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
  expect((await valueEvents(page)).some((e) => e.extra?.startsWith('audio_patch_mode:mode=default') &&
    e.extra?.includes('sessionType=on,supported=1,before=auto,after=play-and-record'))).toBe(true);
  await fireStt(page, '종료', 900);
  await expect(page.locator('text=음성 입력 시작').first()).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => (navigator as any).audioSession.type)).toBe('auto');
  expect((await valueEvents(page)).some((e) => e.extra === 'audio_patch_mode_restore:result=ok,type=auto')).toBe(true);
});

test('audio session toggle is disabled when the API is absent', async ({ page }) => {
  await boot(page, PHONE_402, { settings: settings as typeof SETTINGS,
    beforeStart: async (p) => {
      await p.locator('[data-testid="tab-settings"]').click();
      await expect(p.locator('[data-testid="audio-session-play-and-record"]')).toBeDisabled();
      await expect(p.locator('[data-testid="audio-patch-controls"]')).toContainText('미지원');
    } });
  expect((await valueEvents(page)).some((e) => e.extra?.startsWith('audio_patch_mode:mode=default') &&
    e.extra?.includes('sessionType=off,supported=0,before=unreadable,after=unreadable'))).toBe(true);
});
