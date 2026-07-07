type BeepKind = 'alert' | 'corrected' | 'modify';

const TONES: Record<BeepKind, { freq: number; endFreq?: number; durationMs: number; gain: number }> = {
  alert: { freq: 740, endFreq: 520, durationMs: 210, gain: 0.055 },
  corrected: { freq: 520, endFreq: 880, durationMs: 180, gain: 0.045 },
  modify: { freq: 660, endFreq: 660, durationMs: 150, gain: 0.04 },
};

let ctx: AudioContext | null = null;

export function playBeep(kind: BeepKind): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    ctx ??= new AudioCtx();
    if (ctx.state === 'suspended') void ctx.resume();

    const tone = TONES[kind];
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(tone.freq, now);
    if (tone.endFreq && tone.endFreq !== tone.freq) {
      osc.frequency.exponentialRampToValueAtTime(tone.endFreq, now + tone.durationMs / 1000);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(tone.gain, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + tone.durationMs / 1000 + 0.03);
    osc.onended = () => {
      try { osc.disconnect(); gain.disconnect(); } catch { /* no-op */ }
    };
  } catch {
    // Audio feedback is non-critical; never block the voice flow.
  }
}
