import { test, expect, type Page } from '@playwright/test';

import { BASE } from './baseUrl';

async function installWakeLockMock(page: Page) {
  await page.addInitScript(() => {
    let visibility: DocumentVisibilityState = 'visible';
    let focused = true;
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
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => focused,
    });

    const mock = {
      requests: 0,
      failNextName: null as string | null,
      sentinels,
      setVisibility(next: DocumentVisibilityState) {
        visibility = next;
        document.dispatchEvent(new Event('visibilitychange'));
      },
      setFocus(next: boolean) {
        focused = next;
        window.dispatchEvent(new Event(next ? 'focus' : 'blur'));
      },
      failNext(name: string) {
        mock.failNextName = name;
      },
      async request() {
        mock.requests += 1;
        if (mock.failNextName) {
          const error = new Error('mock wake lock rejection');
          error.name = mock.failNextName;
          mock.failNextName = null;
          throw error;
        }
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

async function logExtras(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    return logger.getAll().map((entry) => entry.extra).filter((extra): extra is string => !!extra);
  });
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

test('[WAKELOCK-LOG-1] 획득·해제·재획득 성공/실패를 모두 기록한다', async ({ page }) => {
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

  await page.evaluate(() => {
    const mock = (
      window as typeof window & {
        __wakeLockMock: {
          failNext: (name: string) => void;
          sentinels: Array<{ browserRelease: () => void }>;
          setVisibility: (state: DocumentVisibilityState) => void;
        };
      }
    ).__wakeLockMock;
    mock.failNext('NotAllowedError');
    mock.setVisibility('hidden');
    mock.sentinels.at(-1)?.browserRelease();
    mock.setVisibility('visible');
  });
  await expect.poll(() => wakeLockRequestCount(page)).toBe(3);

  await expect.poll(async () => (
    await logExtras(page)
  ).filter((extra) => extra.startsWith('wake_lock:'))).toEqual([
    'wake_lock:action=acquire,result=attempt',
    'wake_lock:action=acquire,result=ok',
    'wake_lock:action=release,result=ok,source=browser',
    'wake_lock:action=reacquire,result=attempt',
    'wake_lock:action=reacquire,result=ok',
    'wake_lock:action=release,result=ok,source=browser',
    'wake_lock:action=reacquire,result=attempt',
    'wake_lock:action=reacquire,result=failed,reason=NotAllowedError',
  ]);
});

test('[WAKELOCK-LOG-1] 최초 획득 거부도 조용히 사라지지 않는다', async ({ page }) => {
  await installWakeLockMock(page);
  await page.goto(BASE);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    logger.clear();
    const mock = (
      window as typeof window & {
        __wakeLockMock: { failNext: (name: string) => void };
      }
    ).__wakeLockMock;
    mock.failNext('NotAllowedError');
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    useSessionStore.getState().setPhase('stopping');
  });
  await expect.poll(() => wakeLockRequestCount(page)).toBe(1);
  await expect.poll(async () => (
    await logExtras(page)
  ).filter((extra) => extra.startsWith('wake_lock:'))).toEqual([
    'wake_lock:action=acquire,result=attempt',
    'wake_lock:action=acquire,result=failed,reason=NotAllowedError',
  ]);
});

test('[WAKELOCK-LOG-1] API 미지원도 조용히 사라지지 않는다', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto(BASE);
  await page.locator('[data-testid="tab-voice"]').click();
  await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    logger.clear();
    const { useSessionStore } = await import('/src/stores/sessionStore.ts');
    useSessionStore.getState().setPhase('stopping');
  });
  await expect.poll(async () => (
    await logExtras(page)
  ).filter((extra) => extra.startsWith('wake_lock:'))).toEqual([
    'wake_lock:action=acquire,result=unsupported',
  ]);
});

test('[SCREEN-LOCK-1] visibility와 blur/pagehide 원시 신호를 구별 불가까지 기록한다', async ({ page }) => {
  await installWakeLockMock(page);
  await page.goto(BASE);
  await page.evaluate(async () => {
    const { logger } = await import('/src/lib/logger.ts');
    logger.clear();
  });

  await page.evaluate(() => {
    const mock = (
      window as typeof window & {
        __wakeLockMock: {
          setFocus: (focused: boolean) => void;
          setVisibility: (state: DocumentVisibilityState) => void;
        };
      }
    ).__wakeLockMock;
    // 화면 잠금처럼 visibility 외 선행 신호가 없는 사이클: evidence=none이 판정 불가를 명시한다.
    mock.setVisibility('hidden');
    mock.setVisibility('visible');
    // 앱 전환에서 흔한 관측 순서를 사실 그대로 남긴다. 분석 단계만 분류를 맡는다.
    mock.setFocus(false);
    mock.setVisibility('hidden');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    mock.setVisibility('visible');
  });

  await expect.poll(async () => (
    await logExtras(page)
  ).filter((extra) => (
    extra.startsWith('visibility_context:') || extra.startsWith('lifecycle_signal:')
  ))).toEqual([
    'visibility_context:state=hidden,focus=true,evidence=none',
    'visibility_context:state=visible,focus=true,evidence=none',
    'lifecycle_signal:signal=blur,vis=visible,focus=false,persisted=na',
    'visibility_context:state=hidden,focus=false,evidence=blur',
    'lifecycle_signal:signal=pagehide,vis=hidden,focus=false,persisted=yes',
    'visibility_context:state=visible,focus=false,evidence=blur+pagehide',
  ]);
});
