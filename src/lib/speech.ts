/**
 * Web Speech API wrapper:
 *  - SpeechRecognition: continuous, interim, ko-KR
 *  - SpeechSynthesis: queue + interrupt + onend
 *
 * Notes:
 *  - Auto-restart on `onend` while active (browsers cut off after silence)
 *  - When TTS speaks, new STT results during TTS still come in (mic is always on)
 *  - On user request to interrupt TTS, we cancel synthesis queue
 */

import { useSettingsStore } from '../stores/settingsStore';
import { logger } from './logger';

type SRCtor = new () => SpeechRecognitionLike;

type WindowWithSR = Window & typeof globalThis & {
  SpeechRecognition?: SRCtor;
  webkitSpeechRecognition?: SRCtor;
};

interface SRAlternative {
  transcript: string;
  confidence: number;
}
interface SRResult {
  isFinal: boolean;
  length: number;
  [index: number]: SRAlternative;
}
interface SRResultList {
  length: number;
  [index: number]: SRResult;
}

interface SREvent extends Event {
  resultIndex: number;
  results: SRResultList;
}

export interface SpeechRecognitionLike {
  start: () => void;
  stop: () => void;
  abort: () => void;
  addEventListener: (type: string, cb: (e: Event) => void) => void;
  removeEventListener: (type: string, cb: (e: Event) => void) => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
}

export function isSpeechSupported(): boolean {
  const w = window as WindowWithSR;
  return typeof w.SpeechRecognition !== 'undefined' || typeof w.webkitSpeechRecognition !== 'undefined';
}

export function createRecognition(): SpeechRecognitionLike | null {
  const w = window as WindowWithSR;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.continuous = true;
  r.interimResults = true;
  r.lang = 'ko-KR';
  r.maxAlternatives = 3;
  return r;
}

export interface SpeechCallbacks {
  onFinal: (text: string, alts: string[], confidence: number) => void;
  onInterim?: (text: string) => void;
  onError?: (kind: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

/** A long-running recognition controller that auto-restarts. */
export class SpeechController {
  private rec: SpeechRecognitionLike | null = null;
  private cb: SpeechCallbacks;
  private active = false;
  private restartingTimer: number | null = null;
  /** True while TTS is speaking — prevents STT restart to avoid echo feedback */
  private ttsMuted = false;

  constructor(cb: SpeechCallbacks) {
    this.cb = cb;
  }

  /** Called when TTS utterance starts — marks STT muted but keeps recognition alive
   *  so command keywords (수정/정정/스킵/종료) can still be detected during playback.
   *  handleFinal in useVoiceSession ignores non-command results while synth.speaking=true. */
  muteForTts() {
    this.ttsMuted = true;
    // Cancel any pending STT restart from a previous unmuteForTts()
    if (this.restartingTimer !== null) {
      window.clearTimeout(this.restartingTimer);
      this.restartingTimer = null;
    }
  }

  /** Called when TTS utterance ends — STT was never aborted so no restart needed */
  unmuteForTts() {
    this.ttsMuted = false;
  }

  /** True while TTS is actively playing — used by handleFinal to filter value inputs. */
  isTtsMuted(): boolean {
    return this.ttsMuted;
  }

  start() {
    if (this.active) return;
    this.rec = createRecognition();
    if (!this.rec) {
      this.cb.onError?.('unsupported');
      return;
    }
    this.active = true;
    this.bind();
    try {
      this.rec.start();
    } catch (e) {
      // recognition already started — schedule restart
      this.scheduleRestart();
    }
  }

  stop() {
    this.active = false;
    this.ttsMuted = false;
    if (this.restartingTimer !== null) {
      window.clearTimeout(this.restartingTimer);
      this.restartingTimer = null;
    }
    try { this.rec?.abort(); } catch { /* ignore */ }
    this.rec = null;
  }

  private bind() {
    if (!this.rec) return;
    const rec = this.rec;

    const onResult = (raw: Event) => {
      const e = raw as SREvent;
      const r = e.results[e.results.length - 1];
      const final = r.isFinal;
      const text = (r[0]?.transcript || '').trim();
      const confidence = r[0]?.confidence ?? 1;
      const alts: string[] = [];
      for (let i = 0; i < r.length; i++) alts.push(r[i].transcript.trim());
      // barge-in TTS 컷 (interim 단계).
      // - 기본(이어폰): 명령어든 값이든 사용자가 말하기 시작하면(interim 비어있지 않음) 즉시 TTS 중단
      //   → v0.4.5 I2: 값도 final까지 기다리지 않고 즉시 끊는다. 값 커밋은 handleFinal에서.
      // - 스피커폰 모드(Q2): TTS 자기 음성이 마이크로 새어 명령(특히 '수정' 에코)을 자가발동/오컷하는
      //   것을 막기 위해 interim 컷을 아예 하지 않는다(안내가 끝난 뒤 입력).
      if (!final && this.ttsMuted) {
        const speakerphone = useSettingsStore.getState().speakerphoneMode;
        if (!speakerphone && text.length > 0) {
          synth?.cancel();
        }
      }
      if (final) this.cb.onFinal(text, alts, confidence);
      else this.cb.onInterim?.(text);
    };
    const onError = (e: Event) => {
      const err = (e as unknown as { error?: string }).error || 'unknown';
      this.cb.onError?.(err);
    };
    const onStart = () => this.cb.onStart?.();
    const onEnd = () => {
      this.cb.onEnd?.();
      if (this.active) this.scheduleRestart();
    };

    rec.addEventListener('result', onResult);
    rec.addEventListener('error', onError);
    rec.addEventListener('start', onStart);
    rec.addEventListener('end', onEnd);
  }

  private scheduleRestart(delay = 100) {
    // v5.2: STT must keep running during TTS so command keywords still work.
    // ttsMuted is no longer a guard here — handleFinal filters non-command results during TTS.
    if (this.restartingTimer !== null) return;
    this.restartingTimer = window.setTimeout(() => {
      this.restartingTimer = null;
      if (!this.active) return;
      try {
        this.rec = createRecognition();
        if (this.rec) {
          this.bind();
          this.rec.start();
        }
      } catch { /* try again next tick */ }
    }, delay);
  }
}

// ─── Active controller reference (for TTS mute integration) ───
let _activeController: SpeechController | null = null;
export function setActiveController(ctrl: SpeechController | null) {
  _activeController = ctrl;
}

// ─── TTS ───────────────────────────────────────────────────────
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voicesCache: SpeechSynthesisVoice[] = [];

const isKo = (v: SpeechSynthesisVoice) => v.lang?.toLowerCase().startsWith('ko');

/** v0.5.0 W1: re-pull the synth voice list on demand. iOS Safari populates getVoices()
 *  lazily (often only after a speak/warmup or app foreground), and `voiceschanged` is
 *  unreliable there — so callers (TtsVoiceSelector mount/visibilitychange/새로고침 버튼,
 *  session start()) re-poll explicitly. Logs `tts_voices_loaded {total,ko}` (type:'app',
 *  '__app__' sentinel — W7) only when the counts actually change, so boot + late-arrival
 *  each produce exactly one telemetry event. */
export function refreshVoices(): { total: number; ko: number } {
  if (!synth) return { total: 0, ko: 0 };
  const prevTotal = voicesCache.length;
  const prevKo = voicesCache.filter(isKo).length;
  voicesCache = synth.getVoices();
  const total = voicesCache.length;
  const ko = voicesCache.filter(isKo).length;
  if (total !== prevTotal || ko !== prevKo) {
    logger.log({ type: 'app', extra: `tts_voices_loaded:total=${total},ko=${ko}` });
  }
  return { total, ko };
}

if (synth) {
  refreshVoices();
  synth.onvoiceschanged = refreshVoices;
}

let _preferredVoiceName = '';
export function setPreferredVoiceName(name: string) { _preferredVoiceName = name; }

function pickKoreanVoice(): SpeechSynthesisVoice | null {
  const candidates = voicesCache.filter(isKo);
  if (_preferredVoiceName) {
    const preferred = candidates.find((v) => v.name === _preferredVoiceName);
    if (preferred) return preferred;
  }
  return candidates[0] || null;
}

/** Returns all available Korean voices. */
export function getKoreanVoices(): SpeechSynthesisVoice[] {
  return voicesCache.filter(isKo);
}

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  /** Cancel any currently-speaking utterance before starting */
  interrupt?: boolean;
  /** Called when the TTS engine actually starts playback. Receives delay in ms from enqueue → start. */
  onStart?: (startDelayMs: number) => void;
}

/** Speak text. Returns a Promise that resolves when finished. */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  if (!synth) return;
  if (opts.interrupt) {
    synth.cancel();
    // iOS Safari: cancel() 직후 speak()하면 onend 미발생 버그 완화
    await new Promise((r) => setTimeout(r, 50));
  }
  const enqueuedAt = Date.now();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickKoreanVoice();
    if (v) try { u.voice = v; } catch { /* ignore — plain-object voice in test/mock env */ }
    u.lang = 'ko-KR';
    u.rate = opts.rate ?? 1.05;
    u.pitch = opts.pitch ?? 1;
    u.volume = opts.volume ?? 1;

    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      if (settled) return;
      settled = true;
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      _activeController?.unmuteForTts();
      resolve();
    };

    u.onstart = () => {
      if (settled) return;
      opts.onStart?.(Date.now() - enqueuedAt);
    };
    u.onend = done;
    u.onerror = done;

    // iOS Safari 안전장치: onend/onerror 미발생 시 10초 후 강제 resolve
    watchdog = setTimeout(done, 10_000);

    // synth.speak → onstart 사이 50~500ms 갭 동안 STT 값이 필터링 안 되는 버그 수정:
    // muteForTts를 onstart가 아닌 synth.speak 직전에 호출
    _activeController?.muteForTts();
    synth.speak(u);
  });
}

export function cancelTts() {
  if (synth) synth.cancel();
}

/** Pre-warm the TTS engine to reduce first-utterance delay.
 *  Uses a near-silent '0' utterance — stronger iOS cold-start warm than an empty string. */
export function warmupTts() {
  if (!synth) return;
  const u = new SpeechSynthesisUtterance('0');
  const v = pickKoreanVoice();
  if (v) try { u.voice = v; } catch { /* ignore — plain-object voice in test/mock env */ }
  u.lang = 'ko-KR';
  u.volume = 0.01;
  u.rate = 1.5;
  synth.speak(u);
}

/**
 * Format a number for natural TTS reading: '35.1' → '삼십오 점 일' is too robotic;
 * the native synthesis voice handles arabic digits well, so just pass-through.
 */
export function formatForTts(value: string): string {
  return value;
}
