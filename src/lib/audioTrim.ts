/**
 * 음성 클립 무음 트리밍.
 *
 * 녹음된 클립(webm/opus 또는 mp4)을 decodeAudioData로 PCM으로 푼 뒤, RMS 진폭 기반으로
 * 실제 발화 구간만 남기고 앞뒤 무음을 잘라 16kHz mono WAV로 재인코딩한다.
 *
 * 설계 의도(2026-06-08 D2):
 *  - "음성 클립에 공백이 너무 많다 → 음성 부분만 저장" 요구 해결.
 *  - iOS Safari에서 onspeechstart/onspeechend로 녹음 자체를 게이팅하면 첫 음절이 잘릴 위험이
 *    있으므로(데이터 손실), 녹음은 현행대로 계속하고 "저장 직전"에만 트림한다.
 *  - decode 불가/음성 미검출/트림 효과 미미 시에는 원본 blob을 그대로 반환한다(안전 우선).
 *  - 16kHz mono 다운샘플로 청취 효율과 용량을 동시에 개선(전화 품질, STT/사람 청취 충분).
 */

const PAD_MS = 180;          // 검출된 발화 구간 앞뒤 여유(첫/끝 음절 보호)
const WIN_MS = 20;           // RMS 분석 윈도우
const REL_THRESHOLD = 0.08;  // 피크 대비 발화 판정 비율
const ABS_FLOOR = 0.004;     // 절대 무음 바닥(노이즈 게이트)
const TARGET_RATE = 16000;   // 다운샘플 목표 (음성 충분)
const KEEP_RATIO = 0.95;     // 트림 후 길이가 원본의 이 비율 이상이면 효과 미미 → 원본 유지

let _ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!_ctx) _ctx = new Ctor();
    return _ctx;
  } catch {
    return null;
  }
}

/**
 * 앞뒤 무음을 제거한 WAV blob을 반환한다. 실패/미검출 시 원본 blob 그대로.
 */
export async function trimSilenceToWav(blob: Blob): Promise<Blob> {
  try {
    const ctx = getCtx();
    if (!ctx || !blob || blob.size === 0) return blob;
    const arr = await blob.arrayBuffer();
    // 일부 구현이 입력 ArrayBuffer를 detach하므로 복사본 전달.
    const audio = await ctx.decodeAudioData(arr.slice(0));
    const { sampleRate, numberOfChannels, length } = audio;
    if (!length) return blob;

    // 분석은 첫 채널 기준(채널 간 상관이 높아 충분).
    const ch0 = audio.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < length; i++) {
      const a = Math.abs(ch0[i]);
      if (a > peak) peak = a;
    }
    if (peak < ABS_FLOOR) return blob; // 사실상 전체 무음 — 손대지 않음

    const thr = Math.max(ABS_FLOOR, peak * REL_THRESHOLD);
    const win = Math.max(1, Math.floor((sampleRate * WIN_MS) / 1000));
    let startSample = -1;
    let endSample = -1;
    for (let i = 0; i < length; i += win) {
      const end = Math.min(length, i + win);
      let sum = 0;
      for (let j = i; j < end; j++) sum += ch0[j] * ch0[j];
      const rms = Math.sqrt(sum / (end - i));
      if (rms >= thr) {
        if (startSample < 0) startSample = i;
        endSample = end;
      }
    }
    if (startSample < 0 || endSample <= startSample) return blob; // 발화 미검출

    const pad = Math.floor((sampleRate * PAD_MS) / 1000);
    startSample = Math.max(0, startSample - pad);
    endSample = Math.min(length, endSample + pad);
    if (endSample - startSample >= length * KEEP_RATIO) return blob; // 효과 미미

    return encodeTrimmedWav(audio, startSample, endSample);
  } catch {
    return blob; // decode 미지원/실패 등 — 원본 유지
  }
}

/** [start,end) 구간을 mono로 믹스 + TARGET_RATE로 다운샘플한 뒤 16bit PCM WAV로 인코딩. */
function encodeTrimmedWav(audio: AudioBuffer, start: number, end: number): Blob {
  const srcRate = audio.sampleRate;
  const numCh = audio.numberOfChannels;
  const srcLen = end - start;

  // mono mix
  const mono = new Float32Array(srcLen);
  for (let c = 0; c < numCh; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < srcLen; i++) mono[i] += d[start + i] / numCh;
  }

  // 다운샘플(업샘플은 하지 않음 — 저품질 마이크 보호)
  const targetRate = Math.min(TARGET_RATE, srcRate);
  const ratio = srcRate / targetRate;
  const outLen = Math.max(1, Math.floor(srcLen / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = mono[i0] ?? 0;
    const b = mono[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }

  // WAV (PCM 16bit mono)
  const bytesPerSample = 2;
  const dataSize = outLen * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  for (let i = 0; i < outLen; i++) {
    const s = Math.max(-1, Math.min(1, out[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
