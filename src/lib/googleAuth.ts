/**
 * Google Identity Services (GIS) token-client wrapper.
 *
 * Uses the browser implicit OAuth flow (no server, no client secret).
 * The user signs in with their own Google account and gets a short-lived
 * access token scoped to spreadsheets.
 *
 * Required env var:
 *   VITE_GOOGLE_CLIENT_ID=<your OAuth 2.0 Web Client ID>
 *
 * Authorized JavaScript origins must include the dev + deploy URLs
 * (http://localhost:5173 and https://<github>.github.io).
 */

import { logger } from './logger';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface GoogleAccountsOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
    error_callback?: (err: { type: string; message?: string }) => void;
  }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
  revoke: (token: string, cb?: () => void) => void;
}

interface GoogleGlobal {
  accounts: { oauth2: GoogleAccountsOAuth2 };
}

declare global {
  // eslint-disable-next-line no-var
  var google: GoogleGlobal | undefined;
}

const STORAGE_KEY = 'gs10_google_token';

interface StoredToken {
  access_token: string;
  expires_at: number; // ms epoch
  email?: string;
}

let scriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export function getClientId(): string | null {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || null;
}

export function isConfigured(): boolean {
  return !!getClientId();
}

export function getStoredToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as StoredToken;
    if (t.expires_at < Date.now() + 60_000) return null; // expire 1 min early
    return t;
  } catch {
    return null;
  }
}

function storeToken(t: StoredToken) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
}

function clearToken() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getAccessToken(): string | null {
  return getStoredToken()?.access_token || null;
}

export function getCurrentEmail(): string | null {
  return getStoredToken()?.email || null;
}

// ── one-click sign-in (S-1) ──────────────────────────────────────────────────
// "popup_failed_to_open" on the FIRST click happened because signIn() awaited the GIS
// script (a network load) BEFORE opening the popup, so the popup left the user-gesture
// task and the browser blocked it; the second click worked only because the script was
// cached by then. Fix: warm the script + token client up front (warmupGoogleAuth on
// Settings mount), and open the popup SYNCHRONOUSLY inside the click. The token client is
// created once, so a single set of pending resolvers bridges its callback to signIn().

let tokenClient: { requestAccessToken: (opts?: { prompt?: string }) => void } | null = null;
let pending: {
  resolve: (v: { email: string; token: string }) => void;
  reject: (e: Error) => void;
  settled: boolean;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
} | null = null;

// A7: standalone PWA에서 GIS tokenClient 콜백이 미발화하면 signIn() promise가 영구 hang →
// "Google 로그인 중…"에 고착. 모듈 싱글톤(tokenClient/pending)이라 reload 없는 standalone에선
// 프로세스 kill(재부팅)만이 해소였다. 타임아웃으로 reject + 싱글톤 리셋해 재시도를 가능케 한다.
const SIGNIN_TIMEOUT_MS = 15_000;

// 마지막 sign-in 시작 시각. pending이 (타임아웃으로) 비워진 뒤 지각 콜백이 도착해도 실제 소요ms를
// 산출해 auth_token_settled에 싣기 위함 — standalone 콜백 wedge가 "영구 미발화"인지 "지각 발화"인지
// 다음 실기기 로그로 판별하는 핵심 신호.
let lastSignInStartedAt = 0;

/** pending을 단 한 번만 settle하는 게이트. 콜백/타임아웃/error_callback 어느 경로든 여기로 모인다.
 *  settled 가드로 늦게 도착한 콜백을 안전하게 무시하고, 타이머를 정리한다. */
function settlePending(outcome:
  | { ok: true; value: { email: string; token: string } }
  | { ok: false; error: Error }): void {
  const p = pending;
  if (!p || p.settled) return;
  p.settled = true;
  if (p.timer) { clearTimeout(p.timer); p.timer = null; }
  pending = null;
  if (outcome.ok) p.resolve(outcome.value);
  else p.reject(outcome.error);
}

/** 타임아웃으로 고착이 검출되면, 늦게라도 콜백이 와도 재시도가 가능하도록 tokenClient 싱글톤을 버린다.
 *  다음 signIn()이 ensureTokenClient로 새 클라이언트를 만든다(콜백 wedge 해소). */
function resetTokenClient(): void {
  tokenClient = null;
  logger.log({ type: 'app', extra: 'auth_tokenclient_reset' });
}

/** Create the GIS token client once (idempotent). Returns false if GIS isn't ready yet. */
function ensureTokenClient(): boolean {
  if (tokenClient) return true;
  const clientId = getClientId();
  const g = window.google;
  if (!clientId || !g?.accounts?.oauth2) return false;
  tokenClient = g.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: async (resp) => {
      // A7 계측: 콜백 도착 + 소요ms. standalone에서 이 이벤트가 안 보이면 콜백 wedge가 확정된다.
      // lastSignInStartedAt 기준이라 pending이 타임아웃으로 비워진 뒤 온 지각 콜백도 실제 소요를 싣는다.
      const settledMs = lastSignInStartedAt ? Date.now() - lastSignInStartedAt : -1;
      const late = !pending || pending.settled; // pending이 없거나 이미 settle됐으면 지각 콜백
      logger.log({ type: 'app', extra: `auth_token_settled:ms=${settledMs},late=${late}` });
      if (!resp.access_token) {
        settlePending({ ok: false, error: new Error('No access token received') });
        return;
      }
      const expires_at = Date.now() + (resp.expires_in || 3600) * 1000;
      try {
        const email = await fetchEmail(resp.access_token);
        storeToken({ access_token: resp.access_token, expires_at, email });
        settlePending({ ok: true, value: { email, token: resp.access_token } });
      } catch {
        // Even if email lookup fails, we still have a usable token.
        storeToken({ access_token: resp.access_token, expires_at });
        settlePending({ ok: true, value: { email: '연결됨', token: resp.access_token } });
      }
    },
    error_callback: (err) => {
      // popup_failed_to_open: browser blocked the popup (lost gesture / blocker). With warm-up
      // this should not occur; surface a clear, actionable message if it ever does.
      const msg = err.type === 'popup_failed_to_open'
        ? '로그인 창이 열리지 않았습니다. 팝업 차단을 해제하고 다시 시도해 주세요.'
        : err.type === 'popup_closed'
        ? '로그인 창이 닫혔습니다. 다시 시도해 주세요.'
        : (err.type || 'OAuth error');
      logger.log({ type: 'app', extra: `auth_signin_error:${err.type || 'unknown'}` });
      settlePending({ ok: false, error: new Error(msg) });
    },
  });
  return true;
}

/**
 * Preload GIS + token client so the first sign-in click opens the popup in one shot.
 * Safe to call repeatedly; call it on Settings mount. Fire-and-forget.
 */
export async function warmupGoogleAuth(): Promise<void> {
  if (!getClientId()) return;
  try {
    await loadGisScript();
    ensureTokenClient();
  } catch {
    /* network failure — signIn() will retry the load and surface the error */
  }
}

/** Initiate sign-in via popup. MUST be called directly from a click handler. Resolves with email. */
export function signIn(): Promise<{ email: string; token: string }> {
  const clientId = getClientId();
  if (!clientId) {
    return Promise.reject(
      new Error('Google OAuth Client ID가 설정되지 않았습니다. .env.local의 VITE_GOOGLE_CLIENT_ID를 확인하세요.'),
    );
  }
  return new Promise((resolve, reject) => {
    if (pending) {
      reject(new Error('이미 로그인 진행 중입니다.'));
      return;
    }
    const startedAt = Date.now();
    lastSignInStartedAt = startedAt;
    logger.log({ type: 'app', extra: 'auth_signin_start' });
    // A7: 콜백 wedge 검출 타임아웃. 발화되면 pending을 reject하고 tokenClient 싱글톤을 버려
    // 다음 시도가 새 클라이언트로 가능하게 한다(고착 해소). settlePending의 settled 가드가
    // 늦게 도착한 콜백을 안전하게 무시한다.
    const timer = setTimeout(() => {
      if (!pending || pending.settled) return;
      logger.log({ type: 'app', extra: `auth_signin_timeout:ms=${SIGNIN_TIMEOUT_MS}` });
      resetTokenClient();
      settlePending({
        ok: false,
        error: new Error('로그인 응답이 지연되어 취소되었습니다. 다시 시도해 주세요.'),
      });
    }, SIGNIN_TIMEOUT_MS);
    pending = { resolve, reject, settled: false, startedAt, timer };
    // Fast path: client already warmed up → open the popup synchronously within the gesture.
    if (ensureTokenClient()) {
      tokenClient!.requestAccessToken({ prompt: '' });
      return;
    }
    // Cold fallback (warm-up not finished): load then request. The popup may be gesture-blocked
    // on this first attempt; a second click hits the fast path above.
    loadGisScript()
      .then(() => {
        if (ensureTokenClient()) {
          tokenClient!.requestAccessToken({ prompt: '' });
        } else {
          settlePending({ ok: false, error: new Error('Google Identity Services unavailable') });
        }
      })
      .catch((e) => {
        settlePending({ ok: false, error: e instanceof Error ? e : new Error(String(e)) });
      });
  });
}

export async function signOut() {
  const t = getStoredToken();
  if (t && window.google?.accounts?.oauth2) {
    await new Promise<void>((resolve) => {
      window.google!.accounts.oauth2.revoke(t.access_token, () => resolve());
    });
  }
  clearToken();
}

async function fetchEmail(token: string): Promise<string> {
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error('userinfo fetch failed');
  const d = (await r.json()) as { email?: string };
  return d.email || '연결됨';
}
