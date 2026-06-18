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
/** v0.14.0 B-2: 발화 판정 임계의 기준 피크를 max(|sample|) 대신 상위 백분위로 잡는다. 초반의 짧은
 *  transient(클릭/팝/TTS 잔향)가 단일 샘플 최대치를 끌어올려 thr를 부풀리면, 정작 더 조용한 실제
 *  발화가 thr 미만으로 묻혀 엉뚱한(무음) 구간만 보존되던 문제(v0.13.0 클립 다수가 값 미수록)를
 *  완화한다. 백분위 피크는 소수의 이상 샘플에 둔감하다. */
const PEAK_PERCENTILE = 0.97;
/** v0.14.0 B-2: 트림 결과가 이보다 짧으면 검출이 값 구간을 놓쳤다고 보고 트림을 포기(전체본 유지).
 *  값 발화("삼십삼점삼" 등)는 보통 0.8s 이상 — 0.6s 미만 클립은 값이 잘렸을 가능성이 높다.
 *  raw가 따로 보존되더라도 사용자가 실제 재생하는 것은 blob이므로, blob을 안전한 전체본으로 둔다. */
const MIN_KEPT_MS = 600;
const TARGET_RATE = 16000;          // 다운샘플 목표 (음성 충분)
const KEEP_RATIO = 0.95;            // 트림 후 길이가 원본의 이 비율 이상이면 효과 미미 → 트림 생략
/** v0.9.0 CLIP-BLANK-1: 발화 세그먼트 사이 무음이 이보다 짧으면 같은 발화로 보고 합친다(어절 내
 *  미세 정지). 이보다 긴 무음은 "긴 공백"으로 간주해 클립에서 제거한다(선언↔값 사이 긴 정지 등). */
const MERGE_GAP_MS = 150;
/** v0.13.0 R4: 다중 보존 범위를 이어붙일 때 각 내부 경계에 적용하는 선형 페이드 길이(ms). 보존 범위
 *  직결 자리의 진폭 불연속(클릭/팝)이 "부자연" 체감의 1차 원인이라, 짧은 램프로 이음새를 부드럽게
 *  한다. 단일 범위(트림 효과 미미·단일 발화)는 concatRanges를 타지 않아 바이트 불변이 보존된다. */
const SPLICE_FADE_MS = 3;

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

/** v0.14.0 B-2 — transient에 둔감한 기준 피크(상위 PEAK_PERCENTILE 백분위의 |sample|).
 *  max(|sample|)는 단일 클릭에 끌려가 thr를 부풀리지만, 백분위 피크는 소수 이상치에 강건하다.
 *  비용 절감 위해 최대 ~20k개로 균일 서브샘플 후 정렬(클립당 수 ms, 정확도 충분). */
export function robustPeak(mono: Float32Array): number {
  const n = mono.length;
  if (!n) return 0;
  const MAX_SAMPLES = 20000;
  const stride = Math.max(1, Math.floor(n / MAX_SAMPLES));
  const mags: number[] = [];
  for (let i = 0; i < n; i += stride) mags.push(Math.abs(mono[i]));
  if (mags.length === 0) return 0;
  mags.sort((a, b) => a - b);
  const idx = Math.min(mags.length - 1, Math.floor(mags.length * PEAK_PERCENTILE));
  return mags[idx];
}

/** RMS 기반 발화 구간 검출. 미검출/전체 무음이면 null. */
export function findSpeechRange(
  mono: Float32Array,
  sampleRate: number,
): { start: number; end: number } | null {
  const length = mono.length;
  if (!length) return null;
  const peak = robustPeak(mono);
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

/** v0.9.0 CLIP-BLANK-1 — RMS 기반 **다중** 발화 세그먼트 검출. findSpeechRange가 [첫 발화, 마지막
 *  발화] 단일 구간(내부 긴 무음 포함)을 돌려주던 것과 달리, 발화 덩어리들을 각각 분리해 돌려준다.
 *  MERGE_GAP_MS보다 짧은 무음은 같은 세그먼트로 합쳐 어절 내 미세 정지로 인한 과분할을 막는다.
 *  전체 무음/미검출이면 빈 배열. */
export function findSpeechSegments(
  mono: Float32Array,
  sampleRate: number,
): { start: number; end: number }[] {
  const length = mono.length;
  if (!length) return [];
  const peak = robustPeak(mono); // v0.14.0 B-2: transient 둔감 백분위 피크
  if (peak < ABS_FLOOR) return [];

  const thr = Math.max(ABS_FLOOR, peak * REL_THRESHOLD);
  const win = Math.max(1, Math.floor((sampleRate * WIN_MS) / 1000));
  const mergeGap = Math.floor((sampleRate * MERGE_GAP_MS) / 1000);
  const segs: { start: number; end: number }[] = [];
  let curStart = -1;
  let curEnd = -1;
  for (let i = 0; i < length; i += win) {
    const end = Math.min(length, i + win);
    let sum = 0;
    for (let j = i; j < end; j++) sum += mono[j] * mono[j];
    const rms = Math.sqrt(sum / (end - i));
    if (rms >= thr) {
      if (curStart < 0) {
        curStart = i;
        curEnd = end;
      } else if (i - curEnd <= mergeGap) {
        curEnd = end; // 짧은 갭 → 같은 발화로 이어붙임
      } else {
        segs.push({ start: curStart, end: curEnd }); // 긴 갭 → 세그먼트 분리
        curStart = i;
        curEnd = end;
      }
    }
  }
  if (curStart >= 0) segs.push({ start: curStart, end: curEnd });
  return segs;
}

/** 각 세그먼트를 앞 PAD_FRONT / 뒤 PAD_BACK만큼 확장한 뒤, 겹치거나 맞닿는 범위는 합쳐서 "보존
 *  범위" 목록을 만든다. 합쳐지지 않은 범위 사이의 긴 무음은 결과에서 빠진다(공백 제거). 단일
 *  세그먼트면 applyAsymmetricPad와 동일한 단일 범위가 나온다(기존 동작 보존). */
export function buildKeptRanges(
  segments: { start: number; end: number }[],
  sampleRate: number,
  length: number,
): { start: number; end: number }[] {
  const front = Math.floor((sampleRate * PAD_FRONT_MS) / 1000);
  const back = Math.floor((sampleRate * PAD_BACK_MS) / 1000);
  const ranges: { start: number; end: number }[] = [];
  for (const seg of segments) {
    const start = Math.max(0, seg.start - front);
    const end = Math.min(length, seg.end + back);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end) {
      if (end > last.end) last.end = end; // 확장 후 겹침 → 합침(연속 보존, 갭 없음)
    } else {
      ranges.push({ start, end });
    }
  }
  return ranges;
}

/** 보존 범위들의 실제 오디오를 순서대로 이어붙인 mono PCM. 범위 사이 무음은 제거된다.
 *  v0.13.0 R4 — 각 내부 경계(이전 범위 끝/다음 범위 시작)에 짧은 선형 페이드를 적용해 직결 자리의
 *  진폭 불연속(클릭/팝)을 부드럽게 한다. 페이드 길이는 구간 절반을 넘지 않게 클램프(짧은 구간 보호). */
function concatRanges(
  mono: Float32Array,
  ranges: { start: number; end: number }[],
  sampleRate: number,
): Float32Array {
  let total = 0;
  for (const r of ranges) total += r.end - r.start;
  const out = new Float32Array(total);
  const ramp = Math.max(1, Math.floor((sampleRate * SPLICE_FADE_MS) / 1000));
  let pos = 0;
  for (let ri = 0; ri < ranges.length; ri++) {
    const r = ranges[ri];
    const len = r.end - r.start;
    out.set(mono.subarray(r.start, r.end), pos);
    const fade = Math.min(ramp, len >> 1);
    if (fade > 0) {
      // 들어오는 구간 시작 페이드인(첫 범위 제외 — 클립 맨 앞은 원형 유지).
      if (ri > 0) for (let i = 0; i < fade; i++) out[pos + i] *= i / fade;
      // 나가는 구간 끝 페이드아웃(마지막 범위 제외 — 클립 맨 끝은 원형 유지).
      if (ri < ranges.length - 1) for (let i = 0; i < fade; i++) out[pos + len - 1 - i] *= i / fade;
    }
    pos += len;
  }
  return out;
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
  // v0.9.0 CLIP-BLANK-1 — 다중 세그먼트 검출 + 내부 긴 공백 제거(선언·값은 각각 ±패딩으로 보존).
  const segments = findSpeechSegments(mono, sampleRate);
  if (segments.length === 0) {
    // 발화 미검출: 프리롤이 결합돼 있으면 결합 전체본을 저장본으로(프리롤 증거 보존),
    // 아니면 원본 그대로(현행 동작 유지).
    return hadPreroll
      ? { blob: encodeWavMono(mono, sampleRate, 0, mono.length), raw: null }
      : { blob: originalBlob, raw: null };
  }
  const ranges = buildKeptRanges(segments, sampleRate, mono.length);
  let keptSamples = 0;
  for (const r of ranges) keptSamples += r.end - r.start;
  const noEffect = keptSamples >= mono.length * KEEP_RATIO;
  // v0.14.0 B-2 — 트림본이 MIN_KEPT_MS보다 짧으면 검출이 값 구간을 놓쳤다고 보고 트림을 포기한다
  // (전체본 유지). 단, 원본 자체가 그보다 짧으면(아주 짧은 발화) 트림해도 그 길이라 폴백 무의미 →
  // 정상 트림. 즉 "원본은 충분히 긴데 트림 결과만 과도하게 짧은" 경우만 값 잘림으로 보고 막는다.
  const keptMs = (keptSamples / sampleRate) * 1000;
  const monoMs = (mono.length / sampleRate) * 1000;
  const overTrimmed = keptMs < MIN_KEPT_MS && monoMs >= MIN_KEPT_MS;
  if (noEffect || overTrimmed) {
    // 트림 효과 미미(거의 전부 발화) 또는 과도 축소(값 잘림 의심): 프리롤이 있으면 결합 전체본으로
    // 재인코딩(프리롤 포함이 목적), 없으면 원본 유지.
    return hadPreroll
      ? { blob: encodeWavMono(mono, sampleRate, 0, mono.length), raw: null }
      : { blob: originalBlob, raw: null };
  }
  // 단일 범위면 연속 인코딩(기존 동작과 바이트 동일). 다중이면 범위들을 이어붙여 내부 공백 제거.
  const trimmed =
    ranges.length === 1
      ? encodeWavMono(mono, sampleRate, ranges[0].start, ranges[0].end)
      : encodeWavMono(concatRanges(mono, ranges, sampleRate), sampleRate, 0, keptSamples);
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
