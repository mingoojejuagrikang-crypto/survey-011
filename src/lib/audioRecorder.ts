/**
 * MediaRecorder wrapper for per-field voice clip recording.
 * Records from the microphone independently of SpeechRecognition.
 *
 * Codex 4차 HIGH: 인스턴스별 상태 격리.
 * 각 녹음 슬롯이 자체 chunks/recorder/resolveStop을 소유하므로,
 * 이전 recorder의 큐잉된 ondataavailable/onstop 콜백이 새 슬롯 상태를 오염시키지 않음.
 *
 * v0.5.0 W6 — 클립 0.5s 프리롤 (CLIP: barge-in 앞부분 미수록):
 * init()에서 AudioContext + AudioWorklet(폴백 ScriptProcessor)으로 마이크 PCM을 1.5s
 * 링버퍼에 상시 캡처한다. startClip()이 직전 0.5s를 스냅샷해 슬롯에 마크하고, stopClip()이
 * 그 프리롤을 audioTrim(processClip)에 전달해 디코드 결과 앞에 결합한다. 워크릿·스크립트
 * 프로세서 모두 실패하면 `clip_preroll_unavailable`만 남기고 **현행 동작 그대로** 진행한다
 * (프리롤은 enhancement, 실패가 클립 저장을 막아선 안 됨 — 안전선).
 */

import { logger } from './logger';
import { processClip, type PrerollPcm } from './audioTrim';

interface ClipSlot {
  recorder: MediaRecorder;
  chunks: Blob[];
  mimeType: string;
  resolveStop: ((b: Blob | null) => void) | null;
  finalized: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
  /** #2: wall-clock start (performance.now ms) so we can emit a measured clip duration —
   *  webm output from MediaRecorder has no duration cue (analysis sees N/A). This is a cheap
   *  measured fallback that fills the gap without remuxing the header. */
  startedAt: number;
  /** W6: PCM snapshot of the 0.5s BEFORE this clip started (barge-in first-syllable rescue).
   *  Captured synchronously at startClip() from the live ring buffer; null when preroll
   *  capture is unavailable on this device. */
  preroll: PrerollPcm | null;
}

/** stopClip()이 호출자에게 돌려주는 결과 — 트림본 + 트림 전 원본(다르면) + 프리롤 길이. */
export interface ClipResult {
  /** 저장/재생용 클립(트림됨; 프리롤 결합 반영). 녹음 실패 시 null. */
  blob: Blob | null;
  /** 트림 전 전체본(프리롤 포함). blob과 동일 내용이면 null — `…:raw` 중복 저장 방지. */
  raw: Blob | null;
  /** 이 클립에 결합된 프리롤 길이(ms). 프리롤 없으면 0. clip_duration 텔레메트리와 동일 값. */
  prerollMs: number;
}

/** onstop이 끝내 발화하지 않는 환경(iOS Safari 마이크 점유 등)에서 hang을 막는 안전장치. */
const STOP_TIMEOUT_MS = 2000;
/** 링버퍼 보관량 / startClip 시 스냅샷할 프리롤 길이. */
const RING_BUFFER_MS = 1500;
const PREROLL_MS = 500;

export interface ActiveInputInfo {
  deviceId: string;
  label: string;
}

/** 마이크 PCM 상시 캡처 그래프 (worklet 또는 script-processor). */
interface PrerollCapture {
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode | ScriptProcessorNode;
  /** silent sink — keeps the graph pulled without audible output. */
  sink: GainNode;
  kind: 'worklet' | 'script';
  chunks: Float32Array[];
  totalSamples: number;
  sampleRate: number;
}

/** AudioWorkletProcessor 모듈(블롭 URL 로드) — 2048샘플(~43ms@48k) 단위로 배치 전송해
 *  메시지 빈도를 낮춘다. 메인스레드 링버퍼가 보관량을 관리한다. */
const WORKLET_SOURCE = `
class PrerollCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(2048);
    this._len = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      let i = 0;
      while (i < ch.length) {
        const n = Math.min(ch.length - i, this._buf.length - this._len);
        this._buf.set(ch.subarray(i, i + n), this._len);
        this._len += n;
        i += n;
        if (this._len === this._buf.length) {
          const out = this._buf;
          this.port.postMessage(out, [out.buffer]);
          this._buf = new Float32Array(2048);
          this._len = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('preroll-capture', PrerollCaptureProcessor);
`;

export class AudioRecorder {
  private stream: MediaStream | null = null;
  /** Active (recording) slot — only this one can be stopped via stopClip(). */
  private active: ClipSlot | null = null;
  /** Settings of the audio track actually granted by getUserMedia, captured at init().
   *  Lets the session log attribute STT accuracy to the real input device (built-in vs Shokz). */
  private activeInput: ActiveInputInfo | null = null;
  /** W6: 상시 PCM 링버퍼 캡처. null이면 프리롤 미지원(현행 동작). */
  private preroll: PrerollCapture | null = null;

  /** The microphone actually in use for this recorder (null until init() succeeds). */
  getActiveInput(): ActiveInputInfo | null {
    return this.activeInput;
  }

  async init(): Promise<boolean> {
    if (this.stream) return true;
    try {
      // 소음 환경(비닐하우스 등) 대응: 브라우저 내장 DSP 활성화 — 추가 지연 없음(1초 제약 무관).
      // echoCancellation은 TTS 에코가 마이크로 되먹임되는 것도 줄여줌.
      // autoGainControl은 소음 환경(빗소리 등)에서 무음 구간 게인을 키워 노이즈를 증폭할 수 있어 끔.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: false,
        },
        video: false,
      });
      // Capture which input device was actually granted (built-in vs external mic like Shokz).
      // Numeric/string metadata only — device.json already enumerates the same deviceId+label set,
      // so this introduces no new PII category, it just records which of the known devices was used.
      try {
        const track = this.stream.getAudioTracks()[0];
        if (track) {
          const settings = track.getSettings();
          this.activeInput = {
            deviceId: settings.deviceId ?? '',
            label: track.label ?? '',
          };
        }
      } catch { /* getSettings unsupported — leave activeInput null */ }

      // W6: 프리롤 캡처는 best-effort — 어떤 실패도 init 성공(현행 녹음 동작)을 막지 않는다.
      await this.initPrerollCapture();
      return true;
    } catch {
      return false;
    }
  }

  /** AudioContext + Worklet(폴백 ScriptProcessor)으로 PCM 링버퍼를 구성. 실패 시 프리롤 없이 진행. */
  private async initPrerollCapture(): Promise<void> {
    if (this.preroll || !this.stream) return;
    let ctx: AudioContext | null = null;
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        logger.log({ type: 'clip', extra: 'clip_preroll_unavailable:no_audiocontext' });
        return;
      }
      ctx = new Ctor();
      // iOS: AudioContext는 사용자 제스처 밖에서 'suspended'로 생성될 수 있다. init()는 세션
      // 시작 버튼 탭의 콜스택에서 불리지만 getUserMedia await 뒤라 제스처가 소실됐을 수 있어
      // 명시적으로 resume한다(실패해도 startClip에서 재시도).
      try { await ctx.resume(); } catch { /* startClip()에서 재시도 */ }

      const source = ctx.createMediaStreamSource(this.stream);
      const sink = ctx.createGain();
      sink.gain.value = 0; // 그래프를 destination까지 연결하되 무음 출력(에코 방지)
      sink.connect(ctx.destination);

      const capture: PrerollCapture = {
        ctx, source, sink,
        node: null as unknown as AudioWorkletNode, // 아래에서 채움
        kind: 'worklet',
        chunks: [],
        totalSamples: 0,
        sampleRate: ctx.sampleRate,
      };
      const push = (pcm: Float32Array) => {
        capture.chunks.push(pcm);
        capture.totalSamples += pcm.length;
        const cap = Math.ceil((capture.sampleRate * RING_BUFFER_MS) / 1000);
        while (
          capture.chunks.length > 1 &&
          capture.totalSamples - capture.chunks[0].length >= cap
        ) {
          capture.totalSamples -= capture.chunks[0].length;
          capture.chunks.shift();
        }
      };

      try {
        // 1순위: AudioWorklet (렌더 스레드 캡처 — 메인스레드 지터 없음)
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const node = new AudioWorkletNode(ctx, 'preroll-capture', {
          numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1,
        });
        node.port.onmessage = (e: MessageEvent) => {
          const data = e.data as Float32Array;
          if (data && data.length) push(data);
        };
        source.connect(node);
        node.connect(sink);
        capture.node = node;
        capture.kind = 'worklet';
      } catch {
        // 2순위: ScriptProcessor (deprecated지만 iOS 구형 Safari 포함 광범위 지원)
        const node = ctx.createScriptProcessor(2048, 1, 1);
        node.onaudioprocess = (e: AudioProcessingEvent) => {
          push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };
        source.connect(node);
        node.connect(sink);
        capture.node = node;
        capture.kind = 'script';
      }

      this.preroll = capture;
      logger.log({ type: 'clip', extra: `clip_preroll_ready:${capture.kind}:${capture.sampleRate}` });
    } catch (e) {
      // 둘 다 실패 — 프리롤 없이 현행 동작으로 폴백(안전선). 진단만 남긴다.
      logger.log({ type: 'clip', extra: `clip_preroll_unavailable:${String((e as Error)?.message ?? e)}` });
      try { ctx?.close().catch(() => {}); } catch { /* ignore */ }
      this.preroll = null;
    }
  }

  /** 링버퍼의 마지막 `ms` 구간을 mono PCM으로 스냅샷 (startClip 시점 = 마크). */
  private snapshotPreroll(ms: number): PrerollPcm | null {
    const cap = this.preroll;
    if (!cap || cap.totalSamples === 0) return null;
    const want = Math.min(cap.totalSamples, Math.floor((cap.sampleRate * ms) / 1000));
    if (want <= 0) return null;
    const out = new Float32Array(want);
    let remaining = want;
    let writePos = want;
    for (let i = cap.chunks.length - 1; i >= 0 && remaining > 0; i--) {
      const chunk = cap.chunks[i];
      const take = Math.min(chunk.length, remaining);
      writePos -= take;
      out.set(chunk.subarray(chunk.length - take), writePos);
      remaining -= take;
    }
    return { pcm: remaining > 0 ? out.subarray(writePos) : out, sampleRate: cap.sampleRate };
  }

  startClip(): void {
    if (!this.stream) {
      logger.log({ type: 'clip', extra: 'clip_no_stream' });
      return;
    }
    // iOS: 백그라운드 전환 등으로 suspended가 되었으면 재개 시도(fire-and-forget).
    if (this.preroll && this.preroll.ctx.state === 'suspended') {
      void this.preroll.ctx.resume().catch(() => {});
    }

    // Detach the previous active slot first — its callbacks will continue to read
    // ONLY its own captured `slot` reference, so they cannot pollute the new slot.
    const prev = this.active;
    if (prev) {
      // If prev still has a pending stopClip waiter, resolve it now with whatever it captured.
      // The actual onstop may still fire later, but it will be a no-op (finalized guard).
      if (!prev.finalized && prev.recorder.state !== 'inactive') {
        try { prev.recorder.stop(); } catch { /* ignore */ }
      }
      if (!prev.finalized && prev.resolveStop) {
        prev.finalized = true;
        if (prev.stopTimer) { clearTimeout(prev.stopTimer); prev.stopTimer = null; }
        const blob = prev.chunks.length > 0
          ? new Blob(prev.chunks, { type: prev.mimeType || 'audio/webm' })
          : null;
        prev.resolveStop(blob);
        prev.resolveStop = null;
      }
    }

    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';
      const recorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream);

      const slot: ClipSlot = {
        recorder,
        chunks: [],
        mimeType: recorder.mimeType || mimeType,
        resolveStop: null,
        finalized: false,
        stopTimer: null,
        startedAt: performance.now(),
        // W6 마크: 이 클립 시작 직전 0.5s — barge-in으로 잘린 첫 음절이 이 안에 있다.
        preroll: this.snapshotPreroll(PREROLL_MS),
      };

      // Callbacks close over `slot` exclusively — no `this.*` access, so a stale recorder
      // can never observe or corrupt the next slot's state.
      recorder.ondataavailable = (e) => {
        if (slot.finalized) return;
        if (e.data && e.data.size > 0) slot.chunks.push(e.data);
      };
      recorder.onstop = () => {
        if (slot.finalized) return;
        slot.finalized = true;
        if (slot.stopTimer) { clearTimeout(slot.stopTimer); slot.stopTimer = null; }
        const blob = slot.chunks.length > 0
          ? new Blob(slot.chunks, { type: slot.mimeType || 'audio/webm' })
          : null;
        // #2: measured clip duration (webm header has no duration cue → ffprobe sees N/A).
        // W6: prerollMs 동봉 — 이 클립에 결합될 프리롤 길이(0 = 프리롤 없음).
        logger.log({
          type: 'clip',
          extra: 'clip_duration',
          durationMs: Math.round(performance.now() - slot.startedAt),
          prerollMs: slot.preroll ? Math.round((slot.preroll.pcm.length / slot.preroll.sampleRate) * 1000) : 0,
        });
        slot.resolveStop?.(blob);
        slot.resolveStop = null;
      };

      this.active = slot;
      // timeslice 250ms: 짧은(1초 미만) 발화도 stop/timeout 전에 chunk를 확보하도록 자주 flush.
      // iOS Safari에서 stop 시 final dataavailable이 지연돼 timeout이 먼저 닫혀도 누락을 줄임.
      recorder.start(250);
      logger.log({ type: 'clip', extra: `clip_started:${slot.mimeType || 'default'}` });
    } catch (e) {
      this.active = null;
      logger.log({ type: 'error', extra: `clip_start_failed:${String((e as Error)?.message ?? e)}` });
    }
  }

  /** 녹음 정지 후 (프리롤 결합 →) 앞뒤 무음을 트림한 클립을 반환한다(D2/W6).
   *  트림이 실제로 일어났으면 트림 전 전체본(프리롤 포함)을 `raw`로 함께 돌려준다 —
   *  호출자가 `…:raw` 키로 보존(민구 결정). 트림/프리롤 실패 시 원본 그대로(현행 폴백). */
  async stopClip(): Promise<ClipResult> {
    const slot = this.active; // stopClipRaw 진행 중 active가 교체될 수 있어 미리 캡처
    const preroll = slot?.preroll ?? null;
    const rawRecording = await this.stopClipRaw();
    if (!rawRecording) return { blob: null, raw: null, prerollMs: 0 };
    const prerollMs = preroll ? Math.round((preroll.pcm.length / preroll.sampleRate) * 1000) : 0;
    const processed = await processClip(rawRecording, preroll);
    if (processed.blob !== rawRecording) {
      logger.log({ type: 'clip', extra: `clip_trimmed:${rawRecording.size}->${processed.blob.size}`, prerollMs });
    }
    return { blob: processed.blob, raw: processed.raw, prerollMs };
  }

  private stopClipRaw(): Promise<Blob | null> {
    const slot = this.active;
    return new Promise((resolve) => {
      if (!slot || slot.finalized) {
        resolve(null);
        return;
      }
      if (slot.recorder.state === 'inactive') {
        // Already stopped synchronously by startClip(); we should have resolved there but be defensive.
        slot.finalized = true;
        const blob = slot.chunks.length > 0
          ? new Blob(slot.chunks, { type: slot.mimeType || 'audio/webm' })
          : null;
        resolve(blob);
        return;
      }
      slot.resolveStop = resolve;
      // onstop이 끝내 발화하지 않는 환경(iOS 마이크 점유)에서 hang 방지:
      // timeout 시 지금까지 수집된 chunks로 blob을 만들어 resolve.
      slot.stopTimer = setTimeout(() => {
        if (slot.finalized) return;
        slot.finalized = true;
        slot.stopTimer = null;
        const blob = slot.chunks.length > 0
          ? new Blob(slot.chunks, { type: slot.mimeType || 'audio/webm' })
          : null;
        logger.log({ type: 'error', extra: `clip_stop_timeout:${slot.chunks.length}` });
        slot.resolveStop?.(blob);
        slot.resolveStop = null;
      }, STOP_TIMEOUT_MS);
      try { slot.recorder.stop(); } catch { /* ignore */ }
    });
  }

  dispose(): void {
    // Resolve any pending stopClip first so awaiters don't hang.
    const slot = this.active;
    this.active = null;
    if (slot && !slot.finalized) {
      slot.finalized = true;
      if (slot.stopTimer) { clearTimeout(slot.stopTimer); slot.stopTimer = null; }
      if (slot.recorder.state !== 'inactive') {
        try { slot.recorder.stop(); } catch { /* ignore */ }
      }
      if (slot.resolveStop) {
        slot.resolveStop(null);
        slot.resolveStop = null;
      }
    }
    // W6: 프리롤 캡처 그래프 해제 (stream stop 전에 — source가 stream을 참조).
    const cap = this.preroll;
    this.preroll = null;
    if (cap) {
      try {
        if (cap.kind === 'worklet') (cap.node as AudioWorkletNode).port.onmessage = null;
        else (cap.node as ScriptProcessorNode).onaudioprocess = null;
        cap.source.disconnect();
        cap.node.disconnect();
        cap.sink.disconnect();
      } catch { /* ignore */ }
      void cap.ctx.close().catch(() => {});
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }
}
