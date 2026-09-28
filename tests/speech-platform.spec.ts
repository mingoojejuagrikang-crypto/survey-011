import { test, expect } from '@playwright/test';
import { isIOSDevice, hybridPolicy, HYBRID_DEFER_MS } from '../src/lib/speechPlatform';
import { migrateSettings } from '../src/stores/settingsMigrate';
import { BASE } from './baseUrl';

for (const [ua, touches, ios] of [
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)', 5, true],
  ['Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X)', 5, true],
  ['Mozilla/5.0 (iPod touch; CPU iPhone OS 18_7 like Mac OS X)', 1, true],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5, true],
  ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0, false],
  ['Mozilla/5.0 (Linux; Android 14; Lenovo Y700)', 10, false],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 10, false],
] as const) {
  test(`F4 platform ${ua} touch=${touches}`, () => {
    expect(isIOSDevice({ userAgent: ua, maxTouchPoints: touches })).toBe(ios);
    expect(hybridPolicy(false, ios).enabled).toBe(ios);
    expect(hybridPolicy(true, ios).enabled).toBe(true);
  });
}
test('F4 hybrid defaults and additive migration preserve explicit boolean options', () => {
  expect(HYBRID_DEFER_MS).toBe(5000);
  for (const version of [4, 12, 13]) {
    for (const option of [undefined, null, 'true', 1, false, true]) {
      const migrated = migrateSettings({ refreshRecognitionAfterTts: option }, version);
      expect(migrated.refreshRecognitionAfterTts).toBe(option === true);
      expect(migrateSettings(migrated, version).refreshRecognitionAfterTts).toBe(option === true);
    }
  }
});

for (const { version, option, expected } of [
  { version: 12, option: undefined, expected: false },
  { version: 13, option: undefined, expected: false },
  { version: 13, option: 'true', expected: false },
  { version: 13, option: false, expected: false },
  { version: 13, option: true, expected: true },
]) {
  test(`F4 settings hydrate v${version} option=${JSON.stringify(option)}, toggle persists`, async ({ page }) => {
    await page.addInitScript(({ version, option }) => {
      if (!sessionStorage.getItem('f4-seeded')) {
        localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify({ version,
          state: { refreshRecognitionAfterTts: option, bargeInEnabled: true } }));
        sessionStorage.setItem('f4-seeded', '1');
      }
    }, { version, option });
    await page.goto(BASE);
    await page.getByTestId('tab-settings').click();
    const toggle = page.getByTestId('refresh-recognition-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', String(expected));
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', String(!expected));
    await page.reload(); await page.getByTestId('tab-settings').click();
    await expect(toggle).toHaveAttribute('aria-pressed', String(!expected));
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('agri-voicenote-settings-v3')!).version)).toBe(13);
  });
}

test('F4 iOS settings show always on and disabled, independent of saved opt-out', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 });
    localStorage.setItem('agri-voicenote-settings-v3', JSON.stringify({ version: 13,
      state: { refreshRecognitionAfterTts: false } }));
  });
  await page.goto(BASE); await page.getByTestId('tab-settings').click();
  const toggle = page.getByTestId('refresh-recognition-toggle');
  await expect(toggle).toHaveText('항상 켜짐(iOS)');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toBeDisabled();
  await expect(page.getByTestId('audio-patch-a')).toHaveCount(0);
  await expect(page.getByTestId('audio-patch-b')).toHaveCount(0);
});
