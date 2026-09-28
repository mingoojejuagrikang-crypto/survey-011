/** A cancel return / application timeout is not evidence that native TTS stopped.
 * Poll only while a consumer is waiting; expiry never grants permission. */
const ENGINE_SILENCE_POLL_MS = 50;
const ENGINE_SILENCE_TIMEOUT_MS = 2_000;

export class EngineSilenceGate {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waitingSince: number | null = null;
  private expired = false;

  constructor(
    private readonly getEngine: () => Pick<SpeechSynthesis, 'speaking' | 'pending'> | null,
    private readonly onSilent: () => void,
    private readonly onTimeout: () => void,
  ) {}

  check(): boolean {
    const engine = this.getEngine();
    if (!engine || (engine.speaking === false && engine.pending === false)) {
      this.reset();
      return true;
    }
    this.waitingSince ??= Date.now();
    if (!this.expired && this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (Date.now() - this.waitingSince! >= ENGINE_SILENCE_TIMEOUT_MS) {
          this.expired = true;
        }
        if (this.check()) this.onSilent();
        else if (this.expired) this.onTimeout();
      }, ENGINE_SILENCE_POLL_MS);
    }
    return false;
  }

  /** A new output or a stopped session invalidates the previous wait. */
  reset() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.waitingSince = null;
    this.expired = false;
  }
}
