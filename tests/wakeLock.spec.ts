import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';

async function installWakeLockMock(page: Page) {
  await page.addInitScript(() => {
    let visibility: DocumentVisibilityState = 'visible';
    const sentinels: Array<{
      released: boolean;
      release: () => Promise<void>;
      browserRelease: () => void;
      addEventListener: (type: 'release', listener: () => void) => void;
      removeEventListener: (type: 'release', listener: () => void) => void;
    }> = [];

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });

    const mock = {
      requests: 0,
      sentinels,
      setVisibility(next: DocumentVisibilityState) {
        visibility = next;
        document.dispatchEvent(new Event('visibilitychange'));
      },
      async request() {
        mock.requests += 1;
        const listeners = new Set<() => void>();
        const sentinel = {
          released: false,
          async release() {
            sentinel.browserRelease();
          },
          browserRelease() {
            if (sentinel.released) return;
            sentinel.released = true;
            listeners.forEach((listener) => listener());
          },
          addEventListener(_type: 'release', listener: () => void) {
            listeners.add(listener);
          },
          removeEventListener(_type: 'release', listener: () => void) {
            listeners.delete(listener);
          },
        };
        sentinels.push(sentinel);
        return sentinel;
      },
    };

    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: () => mock.request() },
    });
    (window as typeof window & { __wakeLockMock: typeof mock }).__wakeLockMock = mock;
  });
}

async function wakeLockRequestCount(page: Page): Promise<number> {
  return page.evaluate(() => (
    window as typeof window & { __wakeLockMock: { requests: number } }
  ).__wakeLockMock.requests);
}

async function releaseForHiddenThenShow(page: Page) {
  await page.evaluate(() => {
    const mock = (
      window as typeof window & {
        __wakeLockMock: {
          sentinels: Array<{ browserRelease: () => void }>;
          setVisibility: (state: DocumentVisibilityState) => void;
        };
      }
    ).__wakeLockMock;
    mock.setVisibility('hidden');
    mock.sentinels.at(-1)?.browserRelease();
    mock.setVisibility('visible');
  });
}

test('[WAKELOCK-REACQUIRE-1] browser release 뒤 visible 복귀마다 wake lock을 재획득한다', async ({ page }) => {
  await installWakeLockMock(page);
  await page.goto(BASE);
  await page.locator('[data-testid="tab-voice"]').click();

  await page.evaluate(async () => {
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    useSessionStore.getState().setPhase('stopping');
  });
  await expect.poll(() => wakeLockRequestCount(page)).toBe(1);

  await releaseForHiddenThenShow(page);
  await expect.poll(() => wakeLockRequestCount(page)).toBe(2);

  await releaseForHiddenThenShow(page);
  await expect.poll(() => wakeLockRequestCount(page)).toBe(3);
});
