/**
 * v0.38.0 [ENV-12] — **마이크 PCM 상시 캡처 탭**(링버퍼 + 입력 레벨 + 시간영역 파형).
 *
 * `AudioRecorder`에서 분리했다. 한 가지 책임만 진다 — "살아 있는 MediaStream에서 오디오를
 * 계속 읽어, ①직전 N ms를 언제든 스냅샷할 수 있게 보관하고 ②UI가 읽을 레벨·파형을 만든다".
 * 클립 녹음(MediaRecorder 슬롯)·장치 생명주기(getUserMedia·devicechange)는 알지 못한다.
 *
 * 존재 이유(원본 계약 그대로): 클립이 시작되기 **전** 0.5초를 살려 barge-in 첫 음절 유실을
 * 막고(W6), 같은 그래프의 tap에서 파형·레벨을 얻는다 — **새 AudioContext/AnalyserNode를 따로
 * 만들지 않는다**(iOS Safari 제스처·suspended 함정).
 *
 * 실패는 언제나 폴백이다: 워크릿·스크립트 프로세서 둘 다 실패하면 `clip_preroll_unavailable`만
 * 남기고 캡처 없이 진행한다. 프리롤은 enhancement이지 클립 저장의 전제가 아니다(안전선).
 */
import { logger } from './logger';
import type { PrerollPcm } from './audioTrim';

/** 링버퍼 보관량 / startClip 시 스냅샷할 프리롤 길이. */
const RING_BUFFER_MS = 1500;
export const PREROLL_MS = 500;

// ── v0.34.0 B7 — 입력 레벨(음성 반응 파동) 상수. 캡처 그래프의 push(pcm) 공통 경로에서 chunk
//    RMS를 지수평활한 0~1 레벨을 만든다. 캡처 미가용 기기는 push가 아예 안 불려 레벨 0 고정
//    = 파동 무동작이 자연 폴백(no-op 원칙). ──
/** RMS→레벨 정규화 기준(대화 발화 RMS ~0.02-0.15, echoCancellation·AGC-off 기준). 이 값에서 1.0. */
const LEVEL_REF_RMS = 0.1;
/** 지수평활 계수 — 상승(attack)은 빠르게(발화 반응성), 하강(release)은 느리게(파동 잔향). */
const LEVEL_ATTACK = 0.55;
const LEVEL_RELEASE = 0.15;
/** wave_stats activePct 판정 하한 — 이 레벨 이상인 chunk를 '발화 활성'으로 센다. */
const LEVEL_ACTIVE_MIN = 0.15;

/** 마이크 PCM 상시 캡처 그래프 (worklet 또는 script-processor). */
interface PrerollCapture {
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode | ScriptProcessorNode;
  /** silent sink — keeps the graph pulled without audible output. */
  sink: GainNode;
  /** v0.35.0 (Vance) — 시간영역 파형 탭. VoiceWaveform이 getByteTimeDomainData로 실시간 사람 음성
   *  파형을 그린다(레벨 스칼라와 별개 — 실제 파형은 시간영역 샘플이 필요). source→analyser→sink로
   *  연결해 WebKit이 사이드 브랜치를 확실히 pull하게 한다(sink는 gain 0 → 무음). null이면 미가용. */
  analyser: AnalyserNode | null;
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

export class MicPrerollTap {
  private capture: PrerollCapture | null = null;
  /** `detach()`가 진행 중인 비동기 attach를 무효화한다. 다음 attach는 새 세대로 정상 시작한다. */
  private attachGeneration = 0;
  /** v0.34.0 B7 — 지수평활된 마이크 입력 레벨(0~1). push(pcm)에서만 갱신되고 UI(rAF)가
   *  getLevel()로 읽는다. React state 아님 — 리렌더 0. 캡처 미가용이면 0에 머문다. */
  private inputLevel = 0;
  /** v0.34.0 D11b — 세션 파동 통계 누적(min/max/avg/활성비율용 카운터만 — **고빈도 로깅 절대
   *  금지**, ring buffer 2000 보호). 로깅은 useVoiceSession이 세션 stop 직전 1건으로 요약한다. */
  private waveStats = { peak: 0, sum: 0, count: 0, active: 0 };

  /** AudioContext + Worklet(폴백 ScriptProcessor)으로 PCM 링버퍼를 구성. 실패 시 프리롤 없이 진행.
   *  이미 붙어 있으면 no-op(원본 `if (this.preroll || !this.stream) return` 계약 그대로). */
  async attach(stream: MediaStream | null): Promise<void> {
    if (this.capture || !stream) return;
    const generation = ++this.attachGeneration;
    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let sink: GainNode | null = null;
    let analyser: AnalyserNode | null = null;
    const cancelled = () => generation !== this.attachGeneration;
    const closePending = () => {
      try {
        source?.disconnect();
        analyser?.disconnect();
        sink?.disconnect();
      } catch { /* ignore */ }
      try { void ctx?.close().catch(() => {}); } catch { /* ignore */ }
    };
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
      if (cancelled()) {
        closePending();
        return;
      }

      source = ctx.createMediaStreamSource(stream);
      sink = ctx.createGain();
      sink.gain.value = 0; // 그래프를 destination까지 연결하되 무음 출력(에코 방지)
      sink.connect(ctx.destination);

      // v0.35.0 (Vance) — 시간영역 파형 탭. source→analyser→sink(무음)로 연결해 브랜치가
      //   pull되게 한다(연결만으론 WebKit이 사이드 브랜치를 안 돌릴 수 있음). fftSize 1024로
      //   한 프레임 1024 샘플(≈21ms@48k) — 캔버스 폭에 충분. 실패해도 파형만 폴백(레벨 기반).
      try {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        analyser.connect(sink);
      } catch { analyser = null; }

      const capture: PrerollCapture = {
        ctx, source, sink, analyser,
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
        // v0.34.0 B7 — 파동 레벨 tap: chunk(2048샘플 ≈43ms@48k) RMS → 지수평활 레벨(0~1).
        // worklet/script 공통 경로라 어느 폴백이든 동일 동작. 여기서는 절대 로깅하지 않는다.
        let sq = 0;
        for (let i = 0; i < pcm.length; i++) { const v = pcm[i]; sq += v * v; }
        const target = Math.min(1, Math.sqrt(sq / pcm.length) / LEVEL_REF_RMS);
        this.inputLevel += (target - this.inputLevel) *
          (target > this.inputLevel ? LEVEL_ATTACK : LEVEL_RELEASE);
        const st = this.waveStats;
        st.count++;
        st.sum += this.inputLevel;
        if (this.inputLevel > st.peak) st.peak = this.inputLevel;
        if (this.inputLevel >= LEVEL_ACTIVE_MIN) st.active++;
      };

      try {
        // 1순위: AudioWorklet (렌더 스레드 캡처 — 메인스레드 지터 없음)
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        if (cancelled()) {
          closePending();
          return;
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
        if (cancelled()) {
          closePending();
          return;
        }
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

      this.capture = capture;
      logger.log({ type: 'clip', extra: `clip_preroll_ready:${capture.kind}:${capture.sampleRate}` });
    } catch (e) {
      // 둘 다 실패 — 프리롤 없이 현행 동작으로 폴백(안전선). 진단만 남긴다.
      logger.log({ type: 'clip', extra: `clip_preroll_unavailable:${String((e as Error)?.message ?? e)}` });
      try { ctx?.close().catch(() => {}); } catch { /* ignore */ }
      this.capture = null;
    }
  }

  /** 캡처 그래프 해제(stream stop 전에 — source가 stream을 참조). dispose·재획득에서 호출. */
  detach(): void {
    this.attachGeneration++;
    const cap = this.capture;
    this.capture = null;
    // v0.34.0 B7 — 캡처 그래프가 내려가면 push가 멈추므로 레벨을 0으로 되돌린다(파동 정지).
    this.inputLevel = 0;
    if (!cap) return;
    try {
      if (cap.kind === 'worklet') (cap.node as AudioWorkletNode).port.onmessage = null;
      else (cap.node as ScriptProcessorNode).onaudioprocess = null;
      cap.source.disconnect();
      cap.node.disconnect();
      cap.analyser?.disconnect(); // v0.35.0 (Vance) — 파형 탭 해제.
      cap.sink.disconnect();
    } catch { /* ignore */ }
    void cap.ctx.close().catch(() => {});
  }

  /** iOS: 백그라운드 전환 등으로 suspended가 되었으면 재개 시도(fire-and-forget). */
  resumeIfSuspended(): void {
    if (this.capture && this.capture.ctx.state === 'suspended') {
      void this.capture.ctx.resume().catch(() => {});
    }
  }

  /** 링버퍼의 마지막 `ms` 구간을 mono PCM으로 스냅샷 (startClip 시점 = 마크). */
  snapshot(ms: number): PrerollPcm | null {
    const cap = this.capture;
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

  /** v0.34.0 B7 — 현재 마이크 입력 레벨(0~1, 지수평활). rAF 소비자(useAudioLevelVar)가 매 프레임
   *  읽는다 — 읽기 전용 스칼라라 비용 0. 캡처 미가용(`clip_preroll_unavailable`)이면 항상 0. */
  getLevel(): number {
    return this.inputLevel;
  }

  /** v0.35.0 (Vance) — 시간영역 파형 샘플을 `out`(길이=fftSize=1024)에 채운다. 채웠으면 true.
   *  analyser 미가용(캡처 미지원 기기)이면 false → 소비자(VoiceWaveform)가 레벨 기반 폴백으로
   *  전환한다. 읽기 전용(getByteTimeDomainData)이라 rAF마다 불러도 비용 낮음. */
  getTimeDomainData(out: Uint8Array): boolean {
    const a = this.capture?.analyser;
    if (!a) return false;
    try {
      // TS 5.7+ DOM 타입은 Uint8Array<ArrayBuffer>로 좁아졌다 — 공개 API는 plain Uint8Array 유지,
      // 여기서만 캐스트(런타임 동작 동일).
      a.getByteTimeDomainData(out as Parameters<AnalyserNode['getByteTimeDomainData']>[0]);
      return true;
    } catch {
      return false;
    }
  }

  /** v0.34.0 D11b — 캡처 종류(계측용). null = 미가용(ui_fx에서 'unavailable'로 표기). */
  getKind(): 'worklet' | 'script' | null {
    return this.capture?.kind ?? null;
  }

  /** v0.34.0 D11b — 세션 파동 통계 요약. push가 한 번도 안 불렸으면(캡처 미가용) null. */
  getWaveStats(): { peak: number; avg: number; activePct: number } | null {
    const st = this.waveStats;
    if (st.count === 0) return null;
    return {
      peak: st.peak,
      avg: st.sum / st.count,
      activePct: Math.round((st.active / st.count) * 100),
    };
  }

  /** v0.34.0 D11b — 통계 리셋(세션 시작 시). prewarm(입력탭 마운트)이 세션 전부터 캡처를 돌리므로
   *  세션 밖 구간이 통계에 섞이지 않게 start()가 호출한다. */
  resetWaveStats(): void {
    this.waveStats = { peak: 0, sum: 0, count: 0, active: 0 };
  }
}
