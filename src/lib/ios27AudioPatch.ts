/** iOS 27 preview experiment. Selection lives only in memory; each session snapshots it. */
export type AudioPatchMode = 'default' | 'a' | 'b';
export interface AudioPatchSelection {
  mode: AudioPatchMode;
  playAndRecord: boolean;
  selectedAt: number;
}

// Larry/Mingoo 2026-09-28: experimental values, deliberately gathered in one place.
export const IOS27_AUDIO_TIMING = {
  aSilenceMs: 8_000,
  aUnconfirmedMs: 8_000,
  bRestartDelayMs: 4_000,
  bOutputUncertainMs: 8_000,
  clipMuteNoticeMs: 5_000,
} as const;

const preview = typeof __PREVIEW_BUILD__ !== 'undefined' && __PREVIEW_BUILD__;
let selected: AudioPatchSelection = { mode: 'default', playAndRecord: false, selectedAt: 0 };
/** Session snapshot survives a VoiceScreen unmount; it is never persisted. */
let liveAudioSessionChoice: { sessionId: string; enabled: boolean } | null = null;
export function rememberSessionAudioChoice(sessionId: string, enabled: boolean): void {
  liveAudioSessionChoice = { sessionId, enabled };
}
export function sessionAudioChoice(sessionId: string): boolean {
  return liveAudioSessionChoice?.sessionId === sessionId && liveAudioSessionChoice.enabled;
}
export function forgetSessionAudioChoice(sessionId: string): void {
  if (liveAudioSessionChoice?.sessionId === sessionId) liveAudioSessionChoice = null;
}
const listeners = new Set<() => void>();

export function audioPatchAvailable(): boolean { return preview; }
export function getAudioPatchSelection(): AudioPatchSelection { return selected; }
export function subscribeAudioPatchSelection(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function selectAudioPatch(next: Pick<AudioPatchSelection, 'mode' | 'playAndRecord'>): void {
  if (!preview) return;
  selected = { ...next, selectedAt: Date.now() };
  for (const cb of listeners) cb();
}
export function snapshotAudioPatch(): AudioPatchSelection {
  return preview ? { ...selected } : { mode: 'default', playAndRecord: false, selectedAt: 0 };
}

type AudioSessionLike = { type?: string; state?: string };
function session(): AudioSessionLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession ?? null;
}
function read(s: AudioSessionLike | null, key: 'type' | 'state'): string {
  try { return s?.[key] ?? 'unreadable'; } catch { return 'unreadable'; }
}
export function audioSessionTypeSupported(): boolean {
  const s = session();
  return !!s && read(s, 'type') !== 'unreadable';
}

export interface AudioSessionPatchResult {
  supported: boolean;
  before: string;
  after: string;
  state: string;
  set: 'off' | 'ok' | 'unsupported' | 'error';
  restore: () => { result: 'off' | 'ok' | 'error'; type: string };
}

/** Called in the session-start gesture before audio unlock; restore is idempotent. */
export function applyAudioSessionPatch(enabled: boolean): AudioSessionPatchResult {
  const s = session();
  const before = read(s, 'type');
  const supported = audioSessionTypeSupported();
  let set: AudioSessionPatchResult['set'] = 'off';
  let changed = false;
  if (enabled) {
    if (!supported || !s) set = 'unsupported';
    else {
      try { s.type = 'play-and-record'; changed = true; set = 'ok'; }
      catch { set = 'error'; }
    }
  }
  let restored = false;
  return {
    supported, before, after: read(s, 'type'), state: read(s, 'state'), set,
    restore: () => {
      if (restored || !changed || !s) return { result: 'off', type: read(s, 'type') };
      restored = true;
      try { s.type = before; return { result: 'ok', type: read(s, 'type') }; }
      catch { return { result: 'error', type: read(s, 'type') }; }
    },
  };
}
