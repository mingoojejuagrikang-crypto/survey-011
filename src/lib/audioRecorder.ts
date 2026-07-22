/* eslint-disable max-lines -- [ENV-12] 기존 초과 파일(GL-006 §5 도입 시점), 단일 책임 클래스 — 분리 경계 검토 후 해소. 해소 시 이 주석 제거. */
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
import { classifyInputDevice } from './inputDevice';

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
  /** B5: pending delayed recorder.stop() (post-roll). Cleared + stopped immediately when the
   *  next clip starts or the recorder is disposed (graceful truncation protecting the next clip). */
  delayedStopTimer: ReturnType<typeof setTimeout> | null;
  /** B5: performance.now() at stopClip request — onstop logs postrollMs = actualStop − this.
   *  null = this clip was never stop-requested (e.g. replaced by a re-ask restart). */
  stopRequestedAt: number | null;
}

/** stopClip()이 호출자에게 돌려주는 결과 — 트림본 + 트림 전 원본(다르면) + 프리롤 길이. */
export interface ClipResult {
  /** 저장/재생용 클립(트림됨; 프리롤 결합 반영). 녹음 실패 시 null. */
  blob: Blob | null;
  /** 트림 전 전체본(프리롤 포함). blob과 동일 내용이면 null — `…:raw` 중복 저장 방지. */
  raw: Blob | null;
  /** 이 클립에 결합된 프리롤 길이(ms). 프리롤 없으면 0. clip_duration 텔레메트리와 동일 값. */
  prerollMs: number;
  /** v0.20.0 BL-2 — 트림이 예외(decodeAudioData 실패 등)로 생략됐는지. true면 저장본은 원본(미트림)
   *  webm/mp4. 호출자(useVoiceSession)가 row/colId와 함께 clip_trim_failed를 남긴다. */
  trimFailed?: boolean;
  /** v0.20.0 BL-2 — 트림 실패 사유. trimFailed가 true일 때만. */
  trimFailReason?: string;
}

/** onstop이 끝내 발화하지 않는 환경(iOS Safari 마이크 점유 등)에서 hang을 막는 안전장치.
 *  B5: 실제 stop은 POSTROLL_MS 지연되므로 가드 스케줄 시 POSTROLL_MS를 더해 건다. */
const STOP_TIMEOUT_MS = 2000;
/** B5 — 클립 후반 0.5s post-roll: stopClip 요청 후에도 0.5s 더 녹음한 뒤 stop한다(지연 정지).
 *  발화 꼬리가 STT final 직후 잘리던 후반 짤림 보강. 음성 플로우는 stopClip을 await하지 않으므로
 *  체감 지연 0. 다음 클립이 0.5s 안에 시작되면 타이머를 클리어하고 즉시 stop(우아한 절단). */
const POSTROLL_MS = 500;
/** 링버퍼 보관량 / startClip 시 스냅샷할 프리롤 길이. */
const RING_BUFFER_MS = 1500;
const PREROLL_MS = 500;
/** v0.14.0 B-1 — 스트림 재획득(recoverStream) 최소 간격. 연속 빈 클립/잦은 devicechange에 폭주
 *  하지 않도록 쿨다운을 둔다(장치 토글은 초당 수회씩 일어나지 않음). */
const RECOVER_COOLDOWN_MS = 3000;

// ── v0.34.0 B7 — 입력 레벨(음성 반응 파동) 상수. 기존 preroll 캡처 그래프의 push(pcm) 공통
//    경로에서 chunk RMS를 지수평활한 0~1 레벨을 만든다. **새 AudioContext/AnalyserNode를 만들지
//    않는다**(iOS Safari 제스처/suspended 함정 — 기존 그래프 tap만). preroll 미가용 기기는 push가
//    아예 안 불려 레벨 0 고정 = 파동 무동작이 자연 폴백(no-op 원칙). ──
/** RMS→레벨 정규화 기준(대화 발화 RMS ~0.02-0.15, echoCancellation·AGC-off 기준). 이 값에서 1.0. */
const LEVEL_REF_RMS = 0.1;
/** 지수평활 계수 — 상승(attack)은 빠르게(발화 반응성), 하강(release)은 느리게(파동 잔향). */
const LEVEL_ATTACK = 0.55;
const LEVEL_RELEASE = 0.15;
/** wave_stats activePct 판정 하한 — 이 레벨 이상인 chunk를 '발화 활성'으로 센다. */
const LEVEL_ACTIVE_MIN = 0.15;

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

export class AudioRecorder {
  private stream: MediaStream | null = null;
  /** v0.25.0 기능2(prewarm) — 진행 중 init() Promise 공유(동시 획득 직렬화). prewarm(입력탭 마운트)과
   *  start()의 init()이 겹치면 this.stream이 아직 없어 getUserMedia가 두 번 호출된다(스트림 누수·
   *  리스너 이중등록·iOS Safari 동시호출 거부). 진행 중 Promise를 공유해 정확히 1회만 획득하고,
   *  정착(성공/실패) 시 클리어한다 — 실패 시 다음 호출이 재획득하는 폴백을 보존. */
  private initPromise: Promise<boolean> | null = null;
  /** v0.25.0 기능2 — 마지막 init() 실패 사유(DOMException.name 등). prewarm 텔레메트리 `_denied`가 읽는다. */
  private lastInitError: string | null = null;
  /** Active (recording) slot — only this one can be stopped via stopClip(). */
  private active: ClipSlot | null = null;
  /** Settings of the audio track actually granted by getUserMedia, captured at init().
   *  Lets the session log attribute STT accuracy to the real input device (built-in vs Shokz). */
  private activeInput: ActiveInputInfo | null = null;
  /** W6: 상시 PCM 링버퍼 캡처. null이면 프리롤 미지원(현행 동작). */
  private preroll: PrerollCapture | null = null;
  /** v0.13.0 R8 — 입력장치 변경(예: 음성입력 중 블루투스 해제)을 라이브로 배지에 반영하기 위한
   *  구독 핸들/대상 트랙. 라벨은 init()에서 1회만 캡처되던 frozen 값이라(민구 보고: 음성입력 중
   *  OS에서 BT를 끊어도 배지가 안 바뀜), devicechange/track ended·mute 신호 시 비파괴
   *  enumerateDevices로 activeInput.label을 갱신한다. 재-getUserMedia는 하지 않는다([IOS-5] 종결
   *  정책 + 진행 중 클립 손실 회귀 방지). dispose에서 반드시 해제(리스너 누수·좀비 콜백 방지). */
  private deviceChangeHandler: (() => void) | null = null;
  private listenedTrack: MediaStreamTrack | null = null;
  private trackChangeHandler: (() => void) | null = null;
  /** v0.14.0 B-1/D — 스트림 재획득(recoverStream) 동시성/쿨다운 가드. */
  private recovering = false;
  // v0.38.0 — 쿨다운은 **연속** 재획득을 막기 위한 것이지 첫 회복을 막으면 안 된다. 0으로 두면
  // 비교값이 performance.now()(페이지 로드 후 경과 ms)라 **로드 직후 3초간 모든 recoverStream이
  // 조용히 차단**됐다. #5 자동 재연결은 사고 시점에 즉시 발화하므로 이 구간에 걸리면 getUserMedia를
  // 부르지도 못한 채 1회 가드만 소진하고 수동 배너로 떨어진다.
  private lastRecoverAt = -RECOVER_COOLDOWN_MS;
  /** v0.34.0 B7 — 지수평활된 마이크 입력 레벨(0~1). preroll push(pcm)에서만 갱신되고 UI(rAF)가
   *  getInputLevel()로 읽는다. React state 아님 — 리렌더 0. preroll 미가용이면 0에 머문다. */
  private inputLevel = 0;
  /** v0.34.0 D11b — 세션 파동 통계 누적(min/max/avg/활성비율용 카운터만 — **고빈도 로깅 절대
   *  금지**, ring buffer 2000 보호). 로깅은 useVoiceSession이 세션 stop 직전 1건으로 요약한다.
   *  솔직한 한계: 일시정지→재개는 새 AudioRecorder 인스턴스라 재개 이후 구간만 담긴다. */
  private waveStats = { peak: 0, sum: 0, count: 0, active: 0 };

  /** The microphone actually in use for this recorder (null until init() succeeds). */
  getActiveInput(): ActiveInputInfo | null {
    return this.activeInput;
  }

  /** v0.13.0 R8 — 활성 입력장치 라벨을 비파괴로 다시 읽어 activeInput을 갱신한다.
   *  - 활성 트랙이 ended(트랙 종료=장치 분리)면 라벨을 비워 classifyInputDevice가 '내장'으로 폴백.
   *  - 트랙이 살아있으면 enumerateDevices로 현재 deviceId 존재 여부를 확인해 사라졌으면 내장 폴백,
   *    있으면 최신 라벨(트랙 라벨 우선)로 갱신. 모든 단계 best-effort(권한 전 빈 라벨 등 무해).
   *  주의: track.muted는 '장치 분리'가 아니라 UA가 일시적으로 미디어 전달을 멈춘 상태(통화/Siri
   *  인터럽션, 라우트 변경 등)다. muted를 분리로 처리하면 BT/유선 연결 중 일시 mute에도 배지가
   *  '내장'으로 깜빡인다. 진짜 분리는 'ended' 또는 enumerate의 deviceId 부재로 잡으므로 muted는 보지
   *  않는다(unmute 리스너는 일시 mute 회복 시 라벨 재확인용으로 그대로 둔다). */
  private async refreshActiveInputLabel(): Promise<void> {
    if (!this.activeInput) return;
    const prevLabel = this.activeInput.label;
    try {
      const track = this.stream?.getAudioTracks()[0] ?? null;
      if (!track || track.readyState === 'ended') {
        this.activeInput = { ...this.activeInput, label: '' };
        this.emitInputDeviceChanged(prevLabel, '', 'refresh:track_ended');
        return;
      }
      const id = this.activeInput.deviceId;
      const enumerate = navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices);
      if (enumerate) {
        const inputs = (await enumerate()).filter((d) => d.kind === 'audioinput');
        const match = id ? inputs.find((d) => d.deviceId === id) : undefined;
        if (id && !match) {
          // 활성 장치가 목록에서 사라짐 → 끊김으로 간주, 내장 폴백.
          this.activeInput = { ...this.activeInput, label: '' };
          this.emitInputDeviceChanged(prevLabel, '', 'refresh:device_gone');
          return;
        }
        if (match?.label) {
          this.activeInput = { ...this.activeInput, label: match.label };
          this.emitInputDeviceChanged(prevLabel, match.label, 'refresh:enumerate');
          return;
        }
      }
      // 트랙이 살아있고 라벨이 있으면 트랙 라벨을 신뢰(가장 정확).
      if (track.label) {
        this.activeInput = { ...this.activeInput, label: track.label };
        this.emitInputDeviceChanged(prevLabel, track.label, 'refresh:track_label');
      }
    } catch { /* best-effort — 갱신 실패 시 직전 라벨 유지 */ }
  }

  /** v0.19.0 W7 — 입력장치 라벨이 실제로 바뀐 순간에만(old !== new) logger 이벤트를 방출한다.
   *  B-1 텔레메트리 갭(세션 시작/종료 meta만 기록 → 세션 중 route 변화 불가시) 보강. 분석이
   *  "어떤 입력 경로로 들었는지"를 세션 중 변화까지 식별할 수 있게 한다. classifyInputDevice로
   *  CATEGORY(내장/블루투스/유선)도 함께 싣는다. 기존 `session` 타입에 `extra`로 실어 LogEntry
   *  union·로그 파서(log-replay 등)를 건드리지 않는다(신규 이벤트 타입 무첨가 — 기존 로그 호환).
   *
   *  ⚠️ 솔직한 한계(iOS PWA): STT(Web Speech)는 자체 오디오 캡처라, 여기서 읽는 클립 레코더의
   *  getUserMedia track.label이 STT의 실제 입력 경로와 다를 수 있다. BT가 연결돼 있어도 getUserMedia가
   *  내장 default를 잡아 "iPhone 마이크"로 찍힐 수 있다(v0.18.0 로그가 그 증거 — BT/스피커폰을 실제로
   *  썼는데 두 세션 모두 내장으로 기록). route-change 계측은 신호를 늘리지만 iOS는 BT/내장을 완전
   *  구분 못 할 수 있다(AUDIO-ROUTE-1 네이티브 셸 영역, 본 계측 비범위). 그래도 enumerate/route-change
   *  신호는 다음 분석에 가치가 있다. */
  private emitInputDeviceChanged(oldLabel: string, newLabel: string, reason: string): void {
    if (oldLabel === newLabel) return;
    try {
      const oldCat = classifyInputDevice(oldLabel).text;
      const newCat = classifyInputDevice(newLabel).text;
      // v0.20.0 Phase 5 #5 — 직전 입력장치 전이를 stash해 clip_empty 컨텍스트로 동봉할 수 있게 한다.
      // BT clip_empty(이원창 row1)는 항상 직전 input_device_changed(내장↔블루투스 thrash)와 상관 —
      // 그 전이를 clip_empty 이벤트에 붙이면 다음 분석이 BT 라우팅 원인을 즉시 잇는다(W7 연계).
      this.lastInputChange = { reason, transition: `${oldCat}→${newCat}`, at: Date.now() };
      logger.log({
        type: 'session',
        extra: `input_device_changed:${reason}:${oldCat}→${newCat}`,
        text: `${oldLabel || '(빈)'}→${newLabel || '(빈)'}`,
      });
    } catch { /* best-effort 계측 */ }
  }

  /** v0.20.0 Phase 5 #5 — 가장 최근 입력장치 전이(있으면). useVoiceSession이 clip_empty 로그에 동봉. */
  private lastInputChange: { reason: string; transition: string; at: number } | null = null;
  getLastInputChange(): { reason: string; transition: string; at: number } | null {
    return this.lastInputChange;
  }

  /** v0.22.0 P0 — 장치 변경(devicechange / track ended·mute·unmute) 처리.
   *  근인(2026-06-25 실기기 로그): v0.14.0이 **유휴 중 devicechange에서 자동 재-getUserMedia**
   *  (recoverStream)를 켰는데, iOS Safari는 **사용자 제스처 밖 getUserMedia를 NotAllowedError로
   *  거부**한다. recoverStream이 살아있던 스트림을 먼저 파괴(트랙 stop, this.stream=null)한 뒤
   *  재획득에 실패 → 살아있던 스트림까지 잃고 클립이 영구 소실됐다(세션시작 +2.6s devicechange
   *  1회 → clip_no_stream×56·clip_empty×41, 이후 1537 자동 재시도도 제스처 밖이라 전부 실패 폭주).
   *  → [IOS-5] 종결 정책("유휴 devicechange에서 재-getUserMedia 하지 않는다")으로 복귀한다:
   *   - **녹음 중이든 유휴든** 비파괴 라벨 갱신만(refreshActiveInputLabel). 스트림을 절대 버리지
   *     않으므로 클립이 계속 녹음되고, clip_empty 자동 재시도(useVoiceSession:1537)도 터지지 않는다.
   *  스트림/트랙이 실제로 죽은 경우의 복구는 **사용자 제스처 경로**(reconnectMic→recoverStream
   *  ('user_gesture'))로만 한다 — iOS가 getUserMedia를 거부하지 않는 유일한 컨텍스트. */
  private handleDeviceChange(): void {
    void this.refreshActiveInputLabel();
  }

  /** v0.22.0 P0 — 클립 레코더 스트림이 실제로 죽었는지(녹음 불가) 여부. 자동 복구를 멈추고
   *  사용자 제스처 재연결(reconnectMic)을 띄울지 판정하는 데 쓴다(useVoiceSession.micLost).
   *  스트림이 null이거나 활성 오디오 트랙이 없거나 ended면 죽은 것으로 본다. */
  isStreamLost(): boolean {
    if (!this.stream) return true;
    const track = this.stream.getAudioTracks()[0] ?? null;
    return !track || track.readyState === 'ended';
  }

  /** v0.33.0 항목4 — 포그라운드 복귀 시 마이크 트랙 정밀 판정용 스냅샷(관찰 전용, 재획득 없음 —
   *  [IOS-5]). 'ended'만 진짜 사망(micLost 래치 대상). 'muted'는 UA가 미디어 전달을 일시 정지한
   *  상태(통화/Siri 인터럽션·라우트 변경)로, unmute 대기가 옳다(래치하면 멀쩡한 마이크에 재연결
   *  배너가 뜬다 — refreshActiveInputLabel 주석의 동일 원칙). 'none'은 레코더 미초기화/해제
   *  (일시정지 등 의도된 상태)로 판정 대상이 아니다. */
  getTrackState(): 'none' | 'ended' | 'muted' | 'live' {
    const track = this.stream?.getAudioTracks()[0] ?? null;
    if (!track) return 'none';
    if (track.readyState === 'ended') return 'ended';
    if (track.muted) return 'muted';
    return 'live';
  }

  /** v0.33.0 항목4 — 활성 트랙의 다음 unmute 1회 관찰(once). 복귀 시 muted였던 트랙이 실제로
   *  회복되는지 텔레메트리로 잇는 용도. 트랙이 없으면 no-op. 관찰 전용(스트림 불변). */
  onceTrackUnmuted(cb: () => void): void {
    const track = this.stream?.getAudioTracks()[0] ?? null;
    if (!track) return;
    try { track.addEventListener('unmute', () => cb(), { once: true }); } catch { /* best-effort */ }
  }

  /** v0.14.0 B-1 — 스트림을 재획득해 죽은 레코더/스테일 입력장치를 되살린다(재-getUserMedia).
   *  빈/극소 클립 감지(useVoiceSession) 또는 유휴 중 장치 변경 시 호출. 진행 중 active 슬롯은
   *  이미 실패(빈 클립)했거나 유휴이므로 정리 후 새 스트림으로 교체한다. 쿨다운/동시성 가드로
   *  연속 호출에 폭주하지 않는다. 성공/실패 모두 텔레메트리를 남긴다([REVIEW-1] 관측 대칭성). */
  async recoverStream(reason: string): Promise<boolean> {
    if (this.recovering) return false;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - this.lastRecoverAt < RECOVER_COOLDOWN_MS) return false;
    this.recovering = true;
    this.lastRecoverAt = now;
    // v0.19.0 W7 — 재획득 전 라벨을 기억해 재획득 후 실제 변화가 있으면 route-change 이벤트를 방출.
    const prevLabel = this.activeInput?.label ?? '';
    try {
      // 기존 그래프 정리 — 리스너 먼저(track.stop의 'ended'가 핸들러 재진입 못 하게), 프리롤, 스트림.
      this.detachDeviceListeners();
      this.teardownPreroll();
      const stale = this.active;
      this.active = null;
      if (stale && !stale.finalized) {
        if (stale.delayedStopTimer) { clearTimeout(stale.delayedStopTimer); stale.delayedStopTimer = null; }
        if (stale.stopTimer) { clearTimeout(stale.stopTimer); stale.stopTimer = null; }
        stale.finalized = true;
        try { if (stale.recorder.state !== 'inactive') stale.recorder.stop(); } catch { /* ignore */ }
        stale.resolveStop?.(null);
        stale.resolveStop = null;
      }
      if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; }
      this.activeInput = null;
      // 재획득
      this.stream = await this.acquireStream();
      try {
        const track = this.stream.getAudioTracks()[0];
        if (track) {
          const settings = track.getSettings();
          this.activeInput = { deviceId: settings.deviceId ?? '', label: track.label ?? '' };
        }
      } catch { /* getSettings 미지원 — activeInput은 다음 refresh에서 채움 */ }
      this.attachDeviceListeners();
      await this.initPrerollCapture();
      logger.log({ type: 'clip', extra: `clip_recorder_recovered:${reason}:${this.activeInput?.label || 'default'}` });
      // v0.19.0 W7 — 재획득으로 입력 경로가 실제로 바뀌었으면 route-change 이벤트 방출(old !== new만).
      this.emitInputDeviceChanged(prevLabel, this.activeInput?.label ?? '', `recover:${reason}`);
      return true;
    } catch (e) {
      this.stream = null;
      logger.log({ type: 'error', extra: `clip_recorder_recover_failed:${reason}:${String((e as Error)?.message ?? e)}` });
      return false;
    } finally {
      this.recovering = false;
    }
  }

  /** v0.13.0 R8 — devicechange + 활성 트랙 ended/mute/unmute 구독 등록(init 성공 직후 1회). */
  private attachDeviceListeners(): void {
    try {
      const md = navigator.mediaDevices;
      if (md?.addEventListener && !this.deviceChangeHandler) {
        this.deviceChangeHandler = () => { this.handleDeviceChange(); };
        md.addEventListener('devicechange', this.deviceChangeHandler);
      }
      const track = this.stream?.getAudioTracks()[0] ?? null;
      if (track && !this.trackChangeHandler) {
        this.listenedTrack = track;
        this.trackChangeHandler = () => { this.handleDeviceChange(); };
        track.addEventListener('ended', this.trackChangeHandler);
        track.addEventListener('mute', this.trackChangeHandler);
        track.addEventListener('unmute', this.trackChangeHandler); // BT 재연결 등 회복도 반영
      }
    } catch { /* best-effort */ }
  }

  /** v0.13.0 R8 — 구독 해제(dispose). track.stop()의 'ended'가 핸들러를 깨우지 않도록 먼저 호출. */
  private detachDeviceListeners(): void {
    try {
      const md = navigator.mediaDevices;
      if (md?.removeEventListener && this.deviceChangeHandler) {
        md.removeEventListener('devicechange', this.deviceChangeHandler);
      }
    } catch { /* ignore */ }
    this.deviceChangeHandler = null;
    if (this.listenedTrack && this.trackChangeHandler) {
      try {
        this.listenedTrack.removeEventListener('ended', this.trackChangeHandler);
        this.listenedTrack.removeEventListener('mute', this.trackChangeHandler);
        this.listenedTrack.removeEventListener('unmute', this.trackChangeHandler);
      } catch { /* ignore */ }
    }
    this.listenedTrack = null;
    this.trackChangeHandler = null;
  }

  /** getUserMedia 제약 — echoCancellation은 항상 ON(이어피스 기본; TTS 에코 되먹임 억제).
   *  noiseSuppression/autoGainControl은 소음 현장 정책 유지. */
  private acquireStream(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression: true,
        // 항상 ON(이어피스 기본) — TTS 에코가 마이크로 되먹임되는 것을 억제.
        echoCancellation: true,
        autoGainControl: false,
      },
      video: false,
    });
  }

  async init(): Promise<boolean> {
    if (this.stream) return true;
    // v0.25.0 기능2(prewarm) — 동시 init() 직렬화. prewarm(입력탭 마운트)과 start()의 init()이 겹치면
    // this.stream이 아직 없어 getUserMedia가 두 번 호출된다(스트림 누수·리스너 이중등록·iOS 동시거부).
    // 진행 중 Promise를 공유해 정확히 1회만 획득하고, 정착 시 finally에서 클리어한다(실패 후 재획득
    // 폴백 보존 + dispose 후 재-init(StrictMode 이중마운트·재개) 시 정상 재획득). ⚠️ 핫마이크 주의:
    // acquireStream 대기 중 dispose()가 끼어들면 갓 켠 스트림이 잠깐 살 수 있다(빠른 탭 이탈, 창 ms급).
    // "disposed면 재-init 차단" 하드가드는 StrictMode 이중마운트에서 같은 인스턴스 재사용을 영구
    // 차단해 클립 녹음을 깨므로 채택하지 않음 — 다음 실기기 로그의 워치아이템으로 관찰(핸드오프).
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async (): Promise<boolean> => {
      try {
        // 소음 환경(비닐하우스 등) 대응: 브라우저 내장 DSP 활성화 — 추가 지연 없음(1초 제약 무관).
        // echoCancellation은 이제 항상 ON(이어피스 기본) — TTS 에코가 마이크로 되먹임되는 것도 줄여줌.
        // (v0.15.0 A6: 스피커폰 소프트 half-duplex 모드 및 post-TTS 가드는 삭제됨 — 이어폰 barge-in 기본.)
        // autoGainControl은 소음 환경(빗소리 등)에서 무음 구간 게인을 키워 노이즈를 증폭할 수 있어 끔.
        this.stream = await this.acquireStream();
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

        // v0.13.0 R8 — 입력장치 변경(BT 해제 등)을 배지에 라이브 반영하기 위한 구독 등록.
        this.attachDeviceListeners();

        // W6: 프리롤 캡처는 best-effort — 어떤 실패도 init 성공(현행 녹음 동작)을 막지 않는다.
        await this.initPrerollCapture();
        this.lastInitError = null;
        return true;
      } catch (e) {
        // v0.25.0 기능2 — prewarm 텔레메트리 `_denied`가 읽도록 실패 사유(NotAllowedError 등)를 보존.
        this.lastInitError = (e as Error)?.name || 'unknown';
        return false;
      } finally {
        this.initPromise = null;
      }
    })();
    return this.initPromise;
  }

  /** v0.25.0 기능2 — 마지막 init() 실패 사유(DOMException.name). 성공 시 null. prewarm이 `_denied`에 싣는다. */
  getLastInitError(): string | null {
    return this.lastInitError;
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

      // v0.35.0 (Vance) — 시간영역 파형 탭. source→analyser→sink(무음)로 연결해 브랜치가
      //   pull되게 한다(연결만으론 WebKit이 사이드 브랜치를 안 돌릴 수 있음). fftSize 1024로
      //   한 프레임 1024 샘플(≈21ms@48k) — 캔버스 폭에 충분. 실패해도 파형만 폴백(레벨 기반).
      let analyser: AnalyserNode | null = null;
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

  /** v0.34.0 B7 — 현재 마이크 입력 레벨(0~1, 지수평활). rAF 소비자(useAudioLevelVar)가 매 프레임
   *  읽는다 — 읽기 전용 스칼라라 비용 0. preroll 미가용(`clip_preroll_unavailable`)이면 항상 0. */
  getInputLevel(): number {
    return this.inputLevel;
  }

  /** v0.35.0 (Vance) — 시간영역 파형 샘플을 `out`(길이=fftSize=1024)에 채운다. 채웠으면 true.
   *  analyser 미가용(preroll 미지원 기기)이면 false → 소비자(VoiceWaveform)가 레벨 기반 폴백으로
   *  전환한다. 읽기 전용(getByteTimeDomainData)이라 rAF마다 불러도 비용 낮음. */
  getTimeDomainData(out: Uint8Array): boolean {
    const a = this.preroll?.analyser;
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

  /** v0.34.0 D11b — 프리롤 캡처 종류(계측용). null = 미가용(ui_fx에서 'unavailable'로 표기). */
  getPrerollKind(): 'worklet' | 'script' | null {
    return this.preroll?.kind ?? null;
  }

  /** v0.34.0 D11b — 세션 파동 통계 요약. push가 한 번도 안 불렸으면(프리롤 미가용) null. */
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
      // B5: a delayed post-roll stop may still be pending — clear it and stop IMMEDIATELY so the
      // post-roll of the previous clip can never bleed into (or delay) the next clip. This is the
      // graceful-truncation path: the previous clip keeps everything captured so far.
      if (prev.delayedStopTimer) { clearTimeout(prev.delayedStopTimer); prev.delayedStopTimer = null; }
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
        // B5 telemetry: this clip WAS stop-requested but its post-roll got truncated by the next
        // clip's start. onstop won't log clip_duration (finalized guard) — log it here so the
        // measured duration + actually-delivered postrollMs (<POSTROLL_MS) stay observable.
        // Clips never stop-requested (re-ask restarts) keep their pre-B5 behavior: no event.
        if (prev.stopRequestedAt != null) {
          logger.log({
            type: 'clip',
            extra: 'clip_duration',
            durationMs: Math.round(performance.now() - prev.startedAt),
            prerollMs: prev.preroll ? Math.round((prev.preroll.pcm.length / prev.preroll.sampleRate) * 1000) : 0,
            postrollMs: Math.max(0, Math.round(performance.now() - prev.stopRequestedAt)),
          });
        }
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
        delayedStopTimer: null,
        stopRequestedAt: null,
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
        // B5: postrollMs 동봉 — stop 요청 → 실제 stop까지 실측(≈POSTROLL_MS = 후반 보강 작동,
        // <POSTROLL_MS = 다음 클립 시작으로 절단). stop 요청이 없던 클립엔 미동봉.
        logger.log({
          type: 'clip',
          extra: 'clip_duration',
          durationMs: Math.round(performance.now() - slot.startedAt),
          prerollMs: slot.preroll ? Math.round((slot.preroll.pcm.length / slot.preroll.sampleRate) * 1000) : 0,
          ...(slot.stopRequestedAt != null
            ? { postrollMs: Math.max(0, Math.round(performance.now() - slot.stopRequestedAt)) }
            : {}),
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
    // v0.20.0 BL-2 — 트림 실패 신호를 ClipResult로 전파(이벤트는 row/colId가 있는 useVoiceSession에서).
    return {
      blob: processed.blob, raw: processed.raw, prerollMs,
      ...(processed.trimFailed ? { trimFailed: true, trimFailReason: processed.trimFailReason } : {}),
    };
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
      slot.stopRequestedAt = performance.now();
      // onstop이 끝내 발화하지 않는 환경(iOS 마이크 점유)에서 hang 방지:
      // timeout 시 지금까지 수집된 chunks로 blob을 만들어 resolve.
      // B5: 실제 stop이 POSTROLL_MS 늦게 나가므로 가드도 POSTROLL_MS만큼 연장 — 정상 post-roll이
      // timeout으로 오인 절단되지 않게 한다(iOS onstop 미발화 보호는 그대로 유지).
      slot.stopTimer = setTimeout(() => {
        if (slot.finalized) return;
        slot.finalized = true;
        slot.stopTimer = null;
        if (slot.delayedStopTimer) { clearTimeout(slot.delayedStopTimer); slot.delayedStopTimer = null; }
        const blob = slot.chunks.length > 0
          ? new Blob(slot.chunks, { type: slot.mimeType || 'audio/webm' })
          : null;
        logger.log({ type: 'error', extra: `clip_stop_timeout:${slot.chunks.length}` });
        slot.resolveStop?.(blob);
        slot.resolveStop = null;
      }, STOP_TIMEOUT_MS + POSTROLL_MS);
      // B5 지연 정지: 즉시 stop하지 않고 POSTROLL_MS 동안 더 녹음한다(꼬리 발화 수록).
      // 이어붙임 없는 연속 녹음 — 같은 recorder가 계속 도는 것이라 별도 결합 처리가 없다.
      // startClip(prev-detach)/dispose()가 이 타이머를 클리어하고 즉시 stop해 다음 클립을 보호한다.
      slot.delayedStopTimer = setTimeout(() => {
        slot.delayedStopTimer = null;
        if (slot.finalized) return;
        try { slot.recorder.stop(); } catch { /* ignore */ }
      }, POSTROLL_MS);
    });
  }

  /** 프리롤 캡처 그래프 해제(stream stop 전에 — source가 stream을 참조). dispose()에서 호출. */
  private teardownPreroll(): void {
    const cap = this.preroll;
    this.preroll = null;
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

  dispose(): void {
    // v0.13.0 R8 — 입력장치 구독 먼저 해제(아래 track.stop()의 'ended'가 핸들러를 깨우지 않도록).
    this.detachDeviceListeners();
    // Resolve any pending stopClip first so awaiters don't hang.
    const slot = this.active;
    this.active = null;
    if (slot && !slot.finalized) {
      // B5: pending post-roll delayed stop — clear FIRST and stop immediately (the stream is
      // about to be torn down; a late delayed stop would fire on a dead recorder).
      if (slot.delayedStopTimer) { clearTimeout(slot.delayedStopTimer); slot.delayedStopTimer = null; }
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
    this.teardownPreroll();
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }
}
