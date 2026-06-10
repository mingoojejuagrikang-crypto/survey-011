/**
 * audioTrim — pure-logic unit tests (v0.5.0 W6: 0.5s 프리롤 결합 + 비대칭 PAD + 원본 보존).
 *
 * koreanNum.spec.ts와 같은 패턴: AudioContext 의존부(processClip/decodeAudioData)는 제외하고,
 * 분리된 순수 함수(resampleLinear/combineWithPreroll/findSpeechRange/applyAsymmetricPad/
 * buildClipBlobs)를 합성 PCM으로 Node에서 직접 검증한다. encodeWavMono는 Node 18+의
 * global Blob으로 동작하므로 크기(=샘플 수) 검증이 가능하다.
 */

import { test, expect } from '@playwright/test';
import {
  resampleLinear,
  combineWithPreroll,
  findSpeechRange,
  applyAsymmetricPad,
  encodeWavMono,
  buildClipBlobs,
  PAD_FRONT_MS,
  PAD_BACK_MS,
} from '../src/lib/audioTrim';

const RATE = 16000; // TARGET_RATE와 동일 — encodeWavMono가 다운샘플하지 않아 샘플 수 계산이 정확

/** [silence|speech|silence] 합성 mono PCM. speech 구간은 진폭 0.5 구형파(RMS 0.5). */
function synth(silenceA: number, speech: number, silenceB: number, amp = 0.5): Float32Array {
  const out = new Float32Array(silenceA + speech + silenceB);
  for (let i = 0; i < speech; i++) out[silenceA + i] = i % 2 === 0 ? amp : -amp;
  return out;
}

/** WAV blob(16bit mono)의 PCM 샘플 수. */
function wavSamples(b: Blob): number {
  return (b.size - 44) / 2;
}

test.describe('resampleLinear', () => {
  test('same rate → identity (no copy)', () => {
    const src = synth(0, 100, 0);
    expect(resampleLinear(src, RATE, RATE)).toBe(src);
  });
  test('48k → 16k: length /3', () => {
    const src = new Float32Array(4800).fill(0.3);
    const out = resampleLinear(src, 48000, 16000);
    expect(out.length).toBe(1600);
    expect(out[0]).toBeCloseTo(0.3, 5);
    expect(out[out.length - 1]).toBeCloseTo(0.3, 5);
  });
});

test.describe('combineWithPreroll', () => {
  test('no preroll → passthrough, prerollSamples 0', () => {
    const mono = synth(100, 100, 100);
    const r = combineWithPreroll(mono, RATE, null);
    expect(r.mono).toBe(mono);
    expect(r.prerollSamples).toBe(0);
  });
  test('preroll PCM이 본 녹음 앞에 결합된다', () => {
    const mono = synth(0, 100, 0, 0.5);
    const pre = new Float32Array(50).fill(0.25);
    const r = combineWithPreroll(mono, RATE, { pcm: pre, sampleRate: RATE });
    expect(r.prerollSamples).toBe(50);
    expect(r.mono.length).toBe(150);
    expect(r.mono[0]).toBeCloseTo(0.25, 5);  // 프리롤이 앞
    expect(r.mono[50]).toBeCloseTo(0.5, 5);  // 본 녹음이 뒤
  });
  test('프리롤 rate가 다르면 본 녹음 rate로 리샘플된다 (48k 0.5s → 16k 0.5s)', () => {
    const mono = synth(0, 100, 0);
    const pre = new Float32Array(24000).fill(0.2); // 0.5s @ 48k
    const r = combineWithPreroll(mono, RATE, { pcm: pre, sampleRate: 48000 });
    expect(r.prerollSamples).toBe(8000); // 0.5s @ 16k
    expect(r.mono.length).toBe(8100);
  });
});

test.describe('findSpeechRange', () => {
  test('무음만 → null', () => {
    expect(findSpeechRange(new Float32Array(RATE), RATE)).toBeNull();
  });
  test('발화 구간을 윈도우 정밀도로 찾는다', () => {
    // 0.5s 무음 + 0.25s 발화 + 0.25s 무음
    const mono = synth(8000, 4000, 4000);
    const r = findSpeechRange(mono, RATE);
    expect(r).not.toBeNull();
    const win = (RATE * 20) / 1000; // WIN_MS=20 → 320 samples
    expect(Math.abs(r!.start - 8000)).toBeLessThanOrEqual(win);
    expect(Math.abs(r!.end - 12000)).toBeLessThanOrEqual(win);
  });
});

test.describe('applyAsymmetricPad — 앞 300ms / 뒤 180ms', () => {
  test('padding 적용 + 경계 클램프', () => {
    const length = RATE; // 1s
    const padded = applyAsymmetricPad({ start: 8000, end: 12000 }, RATE, length);
    expect(padded.start).toBe(8000 - (RATE * PAD_FRONT_MS) / 1000); // 8000-4800=3200
    expect(padded.end).toBe(Math.min(length, 12000 + (RATE * PAD_BACK_MS) / 1000)); // 14880
    // 클램프: 시작 직후 발화
    const clamped = applyAsymmetricPad({ start: 100, end: length - 100 }, RATE, length);
    expect(clamped.start).toBe(0);
    expect(clamped.end).toBe(length);
  });
});

test.describe('buildClipBlobs — 트림 + 원본 보존 계약', () => {
  const original = new Blob([new Uint8Array(1000)], { type: 'audio/webm' });

  test('프리롤 없음 + 트림 발생 → blob=트림 WAV, raw=원본 컨테이너', () => {
    // 2s: 1s 무음 + 0.5s 발화 + 0.5s 무음 → 충분히 트림됨
    const mono = synth(16000, 8000, 8000);
    const r = buildClipBlobs(mono, RATE, false, original);
    expect(r.blob).not.toBe(original);
    expect(r.blob.type).toBe('audio/wav');
    expect(r.raw).toBe(original); // 트림 전 전체본 = 원본 webm
    // 트림본 길이 ≈ 발화 0.5s + 앞 300ms + 뒤 180ms (윈도우 오차 허용)
    const samples = wavSamples(r.blob);
    const expected = 8000 + 4800 + 2880;
    expect(Math.abs(samples - expected)).toBeLessThanOrEqual(2 * 320);
  });

  test('프리롤 있음 + 트림 발생 → 트림본에 프리롤 발화 포함, raw=결합 전체 WAV', () => {
    // 프리롤 0.5s: 끝 0.1s에 발화(barge-in 첫 음절), 본 녹음: 0.3s 발화 + 1.2s 무음
    const pre = synth(6400, 1600, 0, 0.4); // 8000 samples
    const rec = synth(0, 4800, 19200);     // 24000 samples
    const { mono, prerollSamples } = combineWithPreroll(rec, RATE, { pcm: pre, sampleRate: RATE });
    expect(prerollSamples).toBe(8000);
    const r = buildClipBlobs(mono, RATE, true, original);
    expect(r.blob.type).toBe('audio/wav');
    expect(r.raw).not.toBeNull();
    expect(r.raw!.type).toBe('audio/wav');
    expect(wavSamples(r.raw!)).toBe(mono.length); // raw = 트림 전 결합 전체본 (32000 샘플)
    // 발화는 결합본의 [6400, 12800) — 프리롤 끝 0.1s + 본 녹음 앞 0.3s가 연속.
    // PAD: start 6400-4800=1600, end 12800+2880=15680 → 트림본 ≈ 14080 샘플.
    const trimmedSamples = wavSamples(r.blob);
    expect(Math.abs(trimmedSamples - 14080)).toBeLessThanOrEqual(3 * 320);
    // 핵심 계약: 트림 시작점(≈1600)이 프리롤 발화 시작(6400)보다 앞 →
    // barge-in 첫 음절(프리롤 구간)이 저장 클립에 포함된다.
    expect(trimmedSamples).toBeGreaterThanOrEqual(14080 - 3 * 320);
  });

  test('발화 미검출 + 프리롤 없음 → 원본 그대로, raw 없음 (현행 폴백)', () => {
    const mono = new Float32Array(RATE); // 전부 무음
    const r = buildClipBlobs(mono, RATE, false, original);
    expect(r.blob).toBe(original);
    expect(r.raw).toBeNull();
  });

  test('발화 미검출 + 프리롤 있음 → 결합 전체본 저장(프리롤 증거 보존), raw 없음(동일본)', () => {
    const mono = new Float32Array(RATE + 8000); // 결합본 전부 무음
    const r = buildClipBlobs(mono, RATE, true, original);
    expect(r.blob).not.toBe(original);
    expect(wavSamples(r.blob)).toBe(mono.length);
    expect(r.raw).toBeNull();
  });

  test('트림 효과 미미(전체가 발화) + 프리롤 없음 → 원본 유지, raw 없음', () => {
    const mono = synth(0, RATE, 0); // 1s 전체 발화
    const r = buildClipBlobs(mono, RATE, false, original);
    expect(r.blob).toBe(original);
    expect(r.raw).toBeNull();
  });
});

test.describe('encodeWavMono — WAV 헤더/크기 계약', () => {
  test('16bit mono, 44바이트 헤더 + 2바이트/샘플', () => {
    const mono = synth(0, 1000, 0);
    const b = encodeWavMono(mono, RATE, 0, 1000);
    expect(b.type).toBe('audio/wav');
    expect(b.size).toBe(44 + 1000 * 2);
  });
});
