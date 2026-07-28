import { useEffect, useRef } from 'react';
import { logger } from './logger';
import { wakeLockEvent } from './logEvents';

type Sentinel = {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
};

function failureReason(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return /^[A-Za-z][A-Za-z0-9_]*$/.test(error.name) ? error.name : 'Error';
  }
  return 'unknown';
}

/**
 * Keeps the screen on while `active` is true.
 * Re-acquires on visibility change (mobile browsers release on tab hide).
 * Silently no-ops on unsupported browsers.
 */
export function useWakeLock(active: boolean) {
  const sentinelRef = useRef<Sentinel | null>(null);

  useEffect(() => {
    if (!active) return;
    let released = false;
    const releaseSources = new WeakMap<Sentinel, 'browser' | 'cleanup' | 'late_request'>();
    const releaseLogged = new WeakSet<Sentinel>();
    const log = (fields: Parameters<typeof wakeLockEvent>[0]) => {
      logger.log({ type: 'app', extra: wakeLockEvent(fields) });
    };

    const logRelease = (
      sentinel: Sentinel,
      result: 'ok' | 'failed',
      source = releaseSources.get(sentinel) ?? 'browser',
      error?: unknown,
    ) => {
      if (releaseLogged.has(sentinel)) return;
      releaseLogged.add(sentinel);
      log({
        action: 'release',
        result,
        source,
        ...(result === 'failed' ? { reason: failureReason(error) } : {}),
      });
    };

    const releaseSentinel = (sentinel: Sentinel, source: 'cleanup' | 'late_request') => {
      releaseSources.set(sentinel, source);
      void sentinel.release()
        .then(() => logRelease(sentinel, 'ok', source))
        .catch((error) => logRelease(sentinel, 'failed', source, error));
    };

    const acquire = async (action: 'acquire' | 'reacquire') => {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (t: string) => Promise<Sentinel> };
      };
      if (!nav.wakeLock) {
        log({ action, result: 'unsupported' });
        return;
      }
      log({ action, result: 'attempt' });
      try {
        const s = await nav.wakeLock.request('screen');
        log({ action, result: 'ok' });
        if (released) {
          releaseSentinel(s, 'late_request');
          return;
        }
        const onRelease = () => {
          s.removeEventListener?.('release', onRelease);
          if (sentinelRef.current === s) sentinelRef.current = null;
          logRelease(s, 'ok');
        };
        s.addEventListener?.('release', onRelease);
        sentinelRef.current = s;
        if (s.released) onRelease();
      } catch (error) {
        log({ action, result: 'failed', reason: failureReason(error) });
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && active && !sentinelRef.current) {
        void acquire('reacquire');
      }
    };

    void acquire('acquire');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinelRef.current) releaseSentinel(sentinelRef.current, 'cleanup');
      sentinelRef.current = null;
    };
  }, [active]);
}

/** Best-effort portrait lock. Silently fails when not supported. */
export async function lockPortrait() {
  try {
    const so = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    if (so?.lock) await so.lock('portrait');
  } catch {
    /* ignore — many browsers throw outside fullscreen */
  }
}
