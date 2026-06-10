/**
 * 음성 클립 무음 트리밍 + 프리롤 결합.
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
 *
 * v0.5.0 W6 (CLIP — barge-in 앞부분 미수록):
 *  - `preroll`(AudioRecorder의 PCM 링버퍼에서 startClip 직전 0.5s)을 디코드 결과 **앞에 결합**
 *    한 뒤 트림한다 — barge-in으로 MediaRecorder 시작 전에 발화된 첫 음절을 복구.
 *  - PAD 비대칭: 앞 300ms(첫 음절 강보호) / 뒤 180ms.
 *  - **원본 보존(민구 결정)**: 트림 전 전체 오디오(프리롤 포함)를 함께 반환 — 호출자가
 *    `…:raw` suffix 키로 audioClips store에 저장해 로그 zip(clips/)에 포함시킨다.
 *  - AudioContext 의존부(decodeAudioData)는 processClip에만 두고, 결합·검출·인코딩 로직은
 *    순수 함수로 분리해 Node 단위 테스트가 가능하다.
 */

export const PAD_FRONT_MS = 300;    // 발화 구간 앞 여유(첫 음절 보호 — barge-in 클립 강화)
export const PAD_BACK_MS = 180;     // 발화 구간 뒤 여유
const WIN_MS = 20;                  // RMS 분석 윈도우
const REL_THRESHOLD = 0.08;         // 피크 대비 발화 판정 비율
const ABS_FLOOR = 0.004;            // 절대 무음 바닥(노이즈 게이트)
const TARGET_RATE = 16000;          // 다운샘플 목표 (음성 충분)
const KEEP_RATIO = 0.95;            // 트림 후 길이가 원본의 이 비율 이상이면 효과 미미 → 트림 생략

/** AudioRecorder의 PCM 링버퍼에서 추출한 프리롤 구간(mono). */
export interface PrerollPcm {
  pcm: Float32Array;
  sampleRate: number;
}

/** 클립 저장 직전 처리 결과.
 *  - `blob`: 실제 저장/재생용 클립(트림됨; 프리롤이 있으면 결합본 기준).
 *  - `raw`: 트림 전 전체본(프리롤 포함). `blob`과 내용이 같으면 null(중복 저장 방지). */
export interface ProcessedClip {
  blob: Blob;
  raw: Blob | null;
}

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

// ─── 순수 로직 (Node 단위 테스트 대상 — AudioContext 불필요) ─────────────────

/** 선형 보간 리샘플 (프리롤 sampleRate ↔ 디코드 sampleRate 정렬용). */
export function resampleLinear(src: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate || src.length === 0) return src;
  const ratio = srcRate / dstRate;
  const outLen = Math.max(1, Math.floor(src.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = src[i0] ?? 0;
    const b = src[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** 프리롤 PCM을 본 녹음 mono 앞에 결합. 프리롤은 본 녹음 rate로 리샘플된다. */
export function combineWithPreroll(
  mono: Float32Array,
  sampleRate: number,
  preroll?: PrerollPcm | null,
): { mono: Float32Array; prerollSamples: number } {
  if (!preroll || preroll.pcm.length === 0) return { mono, prerollSamples: 0 };
  const pre = resampleLinear(preroll.pcm, preroll.sampleRate, sampleRate);
  const out = new Float32Array(pre.length + mono.length);
  out.set(pre, 0);
  out.set(mono, pre.length);
  return { mono: out, prerollSamples: pre.length };
}

/** RMS 기반 발화 구간 검출. 미검출/전체 무음이면 null. */
export function findSpeechRange(
  mono: Float32Array,
  sampleRate: number,
): { start: number; end: number } | null {
  const length = mono.length;
  if (!length) return null;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
  }
  if (peak < ABS_FLOOR) return null; // 사실상 전체 무음

  const thr = Math.max(ABS_FLOOR, peak * REL_THRESHOLD);
  const win = Math.max(1, Math.floor((sampleRate * WIN_MS) / 1000));
  let startSample = -1;
  let endSample = -1;
  for (let i = 0; i < length; i += win) {
    const end = Math.min(length, i + win);
    let sum = 0;
    for (let j = i; j < end; j++) sum += mono[j] * mono[j];
    const rms = Math.sqrt(sum / (end - i));
    if (rms >= thr) {
      if (startSample < 0) startSample = i;
      endSample = end;
    }
  }
  if (startSample < 0 || endSample <= startSample) return null;
  return { start: startSample, end: endSample };
}

/** 비대칭 PAD 적용(앞 300ms / 뒤 180ms) + 경계 클램프. */
export function applyAsymmetricPad(
  range: { start: number; end: number },
  sampleRate: number,
  length: number,
): { start: number; end: number } {
  const front = Math.floor((sampleRate * PAD_FRONT_MS) / 1000);
  const back = Math.floor((sampleRate * PAD_BACK_MS) / 1000);
  return {
    start: Math.max(0, range.start - front),
    end: Math.min(length, range.end + back),
  };
}

/** mono PCM [start,end) 구간을 TARGET_RATE로 다운샘플한 16bit PCM WAV로 인코딩. */
export function encodeWavMono(mono: Float32Array, srcRate: number, start: number, end: number): Blob {
  const srcLen = Math.max(0, end - start);
  const seg = mono.subarray(start, end);

  // 다운샘플(업샘플은 하지 않음 — 저품질 마이크 보호)
  const targetRate = Math.min(TARGET_RATE, srcRate);
  const ratio = srcRate / targetRate;
  const outLen = Math.max(1, Math.floor(srcLen / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = seg[i0] ?? 0;
    const b = seg[i0 + 1] ?? a;
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

/** 결합(mono+preroll) PCM에 대해 저장용/원본용 blob 쌍을 만든다 — 순수(테스트 가능).
 *  반환 raw가 null이면 트림 무효(저장본=전체본)라 원본 별도 보존이 불필요하다는 뜻. */
export function buildClipBlobs(
  mono: Float32Array,
  sampleRate: number,
  hadPreroll: boolean,
  originalBlob: Blob,
): ProcessedClip {
  const range = findSpeechRange(mono, sampleRate);
  if (!range) {
    // 발화 미검출: 프리롤이 결합돼 있으면 결합 전체본을 저장본으로(프리롤 증거 보존),
    // 아니면 원본 그대로(현행 동작 유지).
    return hadPreroll
      ? { blob: encodeWavMono(mono, sampleRate, 0, mono.length), raw: null }
      : { blob: originalBlob, raw: null };
  }
  const padded = applyAsymmetricPad(range, sampleRate, mono.length);
  const noEffect = padded.end - padded.start >= mono.length * KEEP_RATIO;
  if (noEffect) {
    // 트림 효과 미미: 프리롤이 있으면 결합 전체본으로 재인코딩(프리롤 포함이 목적),
    // 없으면 원본 유지.
    return hadPreroll
      ? { blob: encodeWavMono(mono, sampleRate, 0, mono.length), raw: null }
      : { blob: originalBlob, raw: null };
  }
  const trimmed = encodeWavMono(mono, sampleRate, padded.start, padded.end);
  // 트림이 실제로 일어남 → 트림 전 전체본(프리롤 포함)을 raw로 보존.
  const raw = hadPreroll
    ? encodeWavMono(mono, sampleRate, 0, mono.length)
    : originalBlob; // 프리롤 없으면 원본 컨테이너(webm/mp4)가 곧 전체본
  return { blob: trimmed, raw };
}

// ─── 브라우저 의존부 ────────────────────────────────────────────────────────

/** decode → (프리롤 결합) → 트림. 실패 시 원본 blob 그대로(raw 없음 — 동일본). */
export async function processClip(blob: Blob, preroll?: PrerollPcm | null): Promise<ProcessedClip> {
  try {
    const ctx = getCtx();
    if (!ctx || !blob || blob.size === 0) return { blob, raw: null };
    const arr = await blob.arrayBuffer();
    // 일부 구현이 입력 ArrayBuffer를 detach하므로 복사본 전달.
    const audio = await ctx.decodeAudioData(arr.slice(0));
    const { sampleRate, numberOfChannels, length } = audio;
    if (!length) return { blob, raw: null };

    // mono mix (트림 분석과 인코딩 모두 mono 기준)
    const mono = new Float32Array(length);
    for (let c = 0; c < numberOfChannels; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += d[i] / numberOfChannels;
    }

    const combined = combineWithPreroll(mono, sampleRate, preroll);
    return buildClipBlobs(combined.mono, sampleRate, combined.prerollSamples > 0, blob);
  } catch {
    return { blob, raw: null }; // decode 미지원/실패 등 — 원본 유지
  }
}

/**
 * 앞뒤 무음을 제거한 WAV blob을 반환한다. 실패/미검출 시 원본 blob 그대로.
 * (기존 시그니처 호환 wrapper — 원본 보존본이 필요하면 processClip을 직접 사용.)
 */
export async function trimSilenceToWav(blob: Blob, preroll?: PrerollPcm | null): Promise<Blob> {
  return (await processClip(blob, preroll)).blob;
}
