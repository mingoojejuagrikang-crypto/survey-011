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
import { TimeoutError, withTimeout } from './async';
import { recoverTimeout } from './logEvents';
import { processClip, type PrerollPcm } from './audioTrim';
// [ENV-12] 마이크 PCM 캡처(링버퍼·레벨·파형)는 MicPrerollTap이 소유한다 — 이 클래스는 위임만.
import { MicPrerollTap, PREROLL_MS } from './micPrerollTap';
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
/** v0.14.0 B-1 — 스트림 재획득(recoverStream) 최소 간격. 연속 빈 클립/잦은 devicechange에 폭주
 *  하지 않도록 쿨다운을 둔다(장치 토글은 초당 수회씩 일어나지 않음). */
const RECOVER_COOLDOWN_MS = 3000;
/** v0.38.0 리뷰#1(Codex High) — 재획득 `getUserMedia` 응답 대기 상한.
 *
 *  **왜 필요한가:** 브라우저가 권한 요청을 resolve도 reject도 하지 않고 보류하면 `recovering`과
 *  호출부의 in-flight 가드가 영구히 잠긴다. 그러면 실패 폴백(수동 재연결 배너)이 `.then()` 안에
 *  있어 **배너조차 뜨지 않고**, teardown은 이미 끝난 뒤라 레코더가 종전보다 더 해체된 채 남는다
 *  = 세션 내내 조용한 녹음 사망. 거부보다 보류가 위험하다 — 반드시 결말을 만든다.
 *
 *  값 근거: 네트워크 왕복이 아니라 **권한 프롬프트 응답 대기**라 길 이유가 없다. 이미 권한이 있으면
 *  즉시 resolve되고, 사용자가 프롬프트를 보고 있다면 그건 제스처 경로(수동 배너)에서 다시 시도된다. */
const RECOVER_ACQUIRE_TIMEOUT_MS = 7000;

/** 스트림의 모든 트랙을 멈춘다(마이크 인디케이터 해제). 실패해도 호출부를 막지 않는다. */
function stopAllTracks(stream: MediaStream | null): void {
  if (!stream) return;
  for (const t of stream.getTracks()) {
    try { t.stop(); } catch { /* 이미 종료된 트랙 */ }
  }
}

export interface ActiveInputInfo {
  deviceId: string;
  label: string;
}

export class AudioRecorder {
  private stream: MediaStream | null = null;
  /** v0.25.0 기능2(prewarm) — 진행 중 init() Promise 공유(동시 획득 직렬화). prewarm(입력탭 마운트)과
   *  start()의 init()이 겹치면 this.stream이 아직 없어 getUserMedia가 두 번 호출된다(스트림 누수·
   *  리스너 이중등록·iOS Safari 동시호출 거부). 진행 중 Promise를 공유해 정확히 1회만 획득하고,
   *  정착(성공/실패) 시 클리어한다 — 실패 시 다음 호출이 재획득하는 폴백을 보존. */
  private initPromise: Promise<boolean> | null = null;
  /** v0.25.0 기능2 — 마지막 init() 실패 사유(DOMException.name 등). prewarm 텔레메트리 `_denied`가 읽는다. */
  private lastInitError: string | null = null;
  /** v0.38.0 [리뷰#6·#7] **획득 세대.** `dispose()`와 **모든 스트림 획득 시작**이 올린다.
   *  획득을 시작한 쪽은 자기 세대를 잡아 두고, 결과가 도착했을 때 세대가 그대로일 때만 그 스트림을
   *  인스턴스에 꽂는다. 어긋나면(=폐기됐거나 더 나중 획득에 밀렸으면) 트랙을 즉시 stop한다.
   *  `getUserMedia`는 취소할 수 없으므로, **결과가 온 뒤에 닫는 것**이 유일한 수단이다.
   *
   *  막는 것 두 가지:
   *  1. [리뷰#6] **폐기 후 늦게 열린 스트림.** 대기 중 `dispose()`되면 그 시점엔 닫을 스트림이 없고,
   *     뒤늦게 획득이 성공하면 이미 폐기된 인스턴스에 스트림·리스너·프리롤이 다시 붙는다. 그 인스턴스는
   *     호출부 ref에서 빠진 뒤라 아무도 `dispose()`를 부르지 않아 **마이크가 켜진 채 남는다**.
   *  2. [리뷰#7] **`init()`과 `recoverStream()`의 상호 경합.** `initPromise`는 init끼리만,
   *     `recovering`은 recover끼리만 직렬화한다(v0.37.0부터). prewarm `init()`이 권한 응답을 기다리는
   *     동안 `micLost` 자동복구가 `recoverStream()`을 시작하면 **둘이 각자 스트림을 연다.** 나중 것이
   *     `this.stream`을 덮어쓰고 `dispose()`는 마지막 하나만 stop하므로 **다른 하나가 영구 누수**된다.
   *     → 나중에 **시작된** 획득이 이긴다(recover는 이미 옛 스트림을 헐어낸 뒤라 그게 옳다).
   *
   *  `isDisposed` 하드가드는 StrictMode 이중마운트에서 같은 인스턴스의 재-init을 **영구** 차단해
   *  클립 녹음을 깨므로 쓸 수 없다. 세대 비교는 그 부작용이 없다 — 폐기 후 새 `init()`은 새 세대를
   *  잡고 정상 획득한다. */
  private acquireGen = 0;
  /** Active (recording) slot — only this one can be stopped via stopClip(). */
  private active: ClipSlot | null = null;
  /** Settings of the audio track actually granted by getUserMedia, captured at init().
   *  Lets the session log attribute STT accuracy to the real input device (built-in vs Shokz). */
  private activeInput: ActiveInputInfo | null = null;
  /** W6: 상시 PCM 링버퍼 캡처. null이면 프리롤 미지원(현행 동작). */
  /** [ENV-12] 마이크 PCM 상시 캡처 탭(링버퍼·입력 레벨·시간영역 파형). 스트림 수명에 맞춰 붙이고 뗀다. */
  private prerollTap = new MicPrerollTap();
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
  /** dispose 뒤 새 복구를 허용하되, 폐기 전 복구의 finally가 새 가드를 풀지 못하게 한다. */
  private recoveryGuardGen = 0;
  // v0.38.0 — 쿨다운은 **연속** 재획득을 막기 위한 것이지 첫 회복을 막으면 안 된다. 0으로 두면
  // 비교값이 performance.now()(페이지 로드 후 경과 ms)라 **로드 직후 3초간 모든 recoverStream이
  // 조용히 차단**됐다. #5 자동 재연결은 사고 시점에 즉시 발화하므로 이 구간에 걸리면 getUserMedia를
  // 부르지도 못한 채 1회 가드만 소진하고 수동 배너로 떨어진다.
  private lastRecoverAt = -RECOVER_COOLDOWN_MS;
  /** v0.38.0 리뷰#1 — 재획득 응답 대기 상한. 인스턴스 필드로 둬서 단위 테스트가 실제 7초를
   *  기다리지 않고 타임아웃 경로를 결정론적으로 재현할 수 있게 한다(`lastRecoverAt`와 같은 패턴). */
  private acquireTimeoutMs = RECOVER_ACQUIRE_TIMEOUT_MS;
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
  async recoverStream(reason: string, opts?: { bypassCooldown?: boolean }): Promise<boolean> {
    if (this.recovering) return false;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // v0.38.0 리뷰#1(Codex Medium) — 쿨다운은 **자동 폭주**를 막는 장치지, 사용자의 명시적
    // 재연결 탭을 삼키라는 게 아니다. 자동 시도가 즉시 실패한 직후(쿨다운 3초가 남은 상태)
    // 사용자가 배너를 바로 누르면, 실제 getUserMedia 호출 없이 실패하고 두 번 눌러야 했다.
    // 제스처 경로는 iOS가 getUserMedia를 허용하는 유일한 창이라 소모하면 안 된다.
    if (!opts?.bypassCooldown && now - this.lastRecoverAt < RECOVER_COOLDOWN_MS) return false;
    this.recovering = true;
    const recoveryGuardGen = ++this.recoveryGuardGen;
    this.lastRecoverAt = now;
    // v0.38.0 [리뷰#6·#7] 재획득 대기 중 dispose()·진행 중 init()이 끼어드는 핫마이크 레이스 —
    // init()과 **같은 카운터**를 쓴다. 여기서 올리는 순간 진행 중이던 init()의 획득은 stale이 된다.
    const gen = ++this.acquireGen;
    // v0.19.0 W7 — 재획득 전 라벨을 기억해 재획득 후 실제 변화가 있으면 route-change 이벤트를 방출.
    const prevLabel = this.activeInput?.label ?? '';
    let timedOut = false;
    let acquired: MediaStream | null = null;
    try {
      // 기존 그래프 정리 — 리스너 먼저(track.stop의 'ended'가 핸들러 재진입 못 하게), 프리롤, 스트림.
      this.detachDeviceListeners();
      this.prerollTap.detach();
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
      stopAllTracks(this.stream);
      this.stream = null;
      this.activeInput = null;
      // 재획득 — v0.38.0 리뷰#1(Codex High): getUserMedia가 보류되면(권한 프롬프트 무응답)
      // 여기서 영원히 멈춰 recovering·호출부 in-flight 가드가 잠기고 배너조차 뜨지 않았다.
      // 타임아웃으로 반드시 결말을 만든다.
      const pending = this.acquireStream();
      try {
        acquired = await withTimeout(pending, this.acquireTimeoutMs);
      } catch (e) {
        // 이 시도는 결과를 **포기**했다. 원본 Promise는 취소할 수 없으므로, 뒤늦게 열리는 스트림은
        // 여기서 반드시 닫는다 — 안 그러면 아무도 참조하지 않는 마이크가 켜진 채 남는다(핫마이크).
        // 폐기 등록은 **포기 경로에서만** 한다(성공 경로에 걸면 쓰려던 스트림을 닫아버린다).
        void pending.then(stopAllTracks, () => { /* 늦은 실패는 폐기할 자원이 없다 */ });
        timedOut = e instanceof TimeoutError;
        throw e;
      }
      // [리뷰#6] 대기 중 dispose()가 있었으면 주인이 없는 스트림이다 — 꽂기 전에 닫고 실패로 끝낸다.
      if (this.acquireGen !== gen) {
        this.releaseAcquiredStream(acquired);
        return false;
      }
      this.stream = acquired;
      try {
        const track = this.stream.getAudioTracks()[0];
        if (track) {
          const settings = track.getSettings();
          this.activeInput = { deviceId: settings.deviceId ?? '', label: track.label ?? '' };
        }
      } catch { /* getSettings 미지원 — activeInput은 다음 refresh에서 채움 */ }
      this.attachDeviceListeners();
      await this.prerollTap.attach(this.stream);
      // [리뷰#9] attach 대기 중 다른 획득이 이기면 공유 필드가 아니라 이 작업의 스트림만 닫는다.
      if (this.acquireGen !== gen) {
        this.releaseAcquiredStream(acquired);
        return false;
      }
      logger.log({ type: 'clip', extra: `clip_recorder_recovered:${reason}:${this.activeInput?.label || 'default'}` });
      // v0.19.0 W7 — 재획득으로 입력 경로가 실제로 바뀌었으면 route-change 이벤트 방출(old !== new만).
      this.emitInputDeviceChanged(prevLabel, this.activeInput?.label ?? '', `recover:${reason}`);
      return true;
    } catch (e) {
      // [리뷰#9] attach 예외도 이 작업이 획득한 스트림을 반드시 닫는다. 더 최신 스트림의
      // 리스너·프리롤·공유 참조는 `releaseAcquiredStream`의 동일성 가드가 보존한다.
      this.releaseAcquiredStream(acquired);
      const message = String((e as Error)?.message ?? e);
      // v0.38.0 리뷰#1 — 보류(타임아웃)와 거부/오류를 로그에서 분리한다. 현장 원인이 다르다.
      // 기존 clip_recorder_recover_failed 문자열은 그대로 두고 신규 이벤트만 추가(바이트 계약).
      if (timedOut) logger.log({ type: 'error', extra: recoverTimeout(reason, this.acquireTimeoutMs) });
      else logger.log({ type: 'error', extra: `clip_recorder_recover_failed:${reason}:${message}` });
      return false;
    } finally {
      if (this.recoveryGuardGen === recoveryGuardGen) this.recovering = false;
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

  /** 획득 작업이 소유한 스트림을 닫는다. 공유 자원은 아직 그 스트림을 가리킬 때만 정리한다. */
  private releaseAcquiredStream(acquired: MediaStream | null): void {
    if (!acquired) return;
    if (this.stream === acquired) {
      this.detachDeviceListeners();
      this.prerollTap.detach();
      stopAllTracks(acquired);
      this.stream = null;
      this.activeInput = null;
      return;
    }
    stopAllTracks(acquired);
  }

  async init(): Promise<boolean> {
    if (this.stream) return true;
    // v0.25.0 기능2(prewarm) — 동시 init() 직렬화. prewarm(입력탭 마운트)과 start()의 init()이 겹치면
    // this.stream이 아직 없어 getUserMedia가 두 번 호출된다(스트림 누수·리스너 이중등록·iOS 동시거부).
    // 진행 중 Promise를 공유해 정확히 1회만 획득하고, 정착 시 finally에서 클리어한다(실패 후 재획득
    // 폴백 보존 + dispose 후 재-init(StrictMode 이중마운트·재개) 시 정상 재획득). ⚠️ 핫마이크 주의:
    // v0.38.0 [리뷰#6·#7] 획득 대기 중 dispose()·다른 획득이 끼어드는 핫마이크 레이스는 **세대**로
    // 막는다(하드가드는 StrictMode 이중마운트를 깨므로 쓰지 않는다 — `acquireGen` 주석 참조).
    if (this.initPromise) return this.initPromise;
    // [리뷰#9] 새 시도의 false가 실제 실패인지 stale 조기반환인지 호출부가 구분하도록 이전 오류를
    // 비운다. 실제 catch만 현재 세대일 때 사유를 다시 채우며, stale은 null을 유지한다.
    this.lastInitError = null;
    const gen = ++this.acquireGen;
    const initPromise = (async (): Promise<boolean> => {
      let acquired: MediaStream | null = null;
      try {
        // 소음 환경(비닐하우스 등) 대응: 브라우저 내장 DSP 활성화 — 추가 지연 없음(1초 제약 무관).
        // echoCancellation은 이제 항상 ON(이어피스 기본) — TTS 에코가 마이크로 되먹임되는 것도 줄여줌.
        // (v0.15.0 A6: 스피커폰 소프트 half-duplex 모드 및 post-TTS 가드는 삭제됨 — 이어폰 barge-in 기본.)
        // autoGainControl은 소음 환경(빗소리 등)에서 무음 구간 게인을 키워 노이즈를 증폭할 수 있어 끔.
        acquired = await this.acquireStream();
        // [리뷰#6] 대기 중 dispose()가 있었으면 이 스트림의 주인은 이미 없다 — 즉시 닫고 실패로 끝낸다.
        // this.stream에 꽂기 **전에** 판정해야 리스너·프리롤이 폐기된 인스턴스에 붙지 않는다.
        if (this.acquireGen !== gen) {
          this.releaseAcquiredStream(acquired);
          return false;
        }
        this.stream = acquired;
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
        await this.prerollTap.attach(this.stream);
        // [리뷰#6] attach도 대기 구간이다(AudioContext.resume·worklet 로드가 지연될 수 있다).
        // 그 사이 더 최신 획득이 이기면 공유 필드가 아니라 이 작업의 스트림만 정리한다.
        if (this.acquireGen !== gen) {
          this.releaseAcquiredStream(acquired);
          return false;
        }
        this.lastInitError = null;
        return true;
      } catch (e) {
        // attach가 던져도 이 작업의 마이크는 남기지 않는다. 이긴 스트림은 동일성 가드로 보호한다.
        this.releaseAcquiredStream(acquired);
        // v0.25.0 기능2 — prewarm 텔레메트리 `_denied`가 읽도록 실패 사유(NotAllowedError 등)를 보존.
        if (this.acquireGen === gen) this.lastInitError = (e as Error)?.name || 'unknown';
        return false;
      }
    })().finally(() => {
      if (this.initPromise === initPromise) this.initPromise = null;
    });
    this.initPromise = initPromise;
    return initPromise;
  }

  /** v0.25.0 기능2 — 마지막 init() 실패 사유(DOMException.name). 성공 시 null. prewarm이 `_denied`에 싣는다. */
  getLastInitError(): string | null {
    return this.lastInitError;
  }

  // ── 마이크 캡처 탭 위임(공개 API는 종전 그대로 — 호출부 무수정) ──────────────
  /** v0.34.0 B7 — 현재 마이크 입력 레벨(0~1, 지수평활). 캡처 미가용이면 항상 0. */
  getInputLevel(): number { return this.prerollTap.getLevel(); }

  /** v0.35.0 (Vance) — 시간영역 파형 샘플을 `out`에 채운다. 채웠으면 true, analyser 미가용이면
   *  false(소비자가 레벨 기반 폴백으로 전환). */
  getTimeDomainData(out: Uint8Array): boolean { return this.prerollTap.getTimeDomainData(out); }

  /** v0.34.0 D11b — 프리롤 캡처 종류(계측용). null = 미가용. */
  getPrerollKind(): 'worklet' | 'script' | null { return this.prerollTap.getKind(); }

  /** v0.34.0 D11b — 세션 파동 통계 요약. 캡처가 한 번도 안 돌았으면 null. */
  getWaveStats(): { peak: number; avg: number; activePct: number } | null {
    return this.prerollTap.getWaveStats();
  }

  /** v0.34.0 D11b — 통계 리셋(세션 시작 시). */
  resetWaveStats(): void { this.prerollTap.resetWaveStats(); }

  startClip(): void {
    if (!this.stream) {
      logger.log({ type: 'clip', extra: 'clip_no_stream' });
      return;
    }
    // iOS: 백그라운드 전환 등으로 suspended가 되었으면 재개 시도(fire-and-forget).
    this.prerollTap.resumeIfSuspended();

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
        preroll: this.prerollTap.snapshot(PREROLL_MS),
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

  dispose(): void {
    // v0.38.0 [리뷰#6] 진행 중인 획득을 무효화한다 — 뒤늦게 열리는 스트림이 폐기된 인스턴스에
    // 다시 붙지 않도록. 취소할 수 없는 getUserMedia는 결과가 오는 즉시 stop된다(init/recoverStream).
    this.acquireGen += 1;
    // 진행 중 작업은 취소할 수 없으므로 참조만 분리한다. 각 finally는 자기 세대/Promise만 정리한다.
    this.initPromise = null;
    this.recoveryGuardGen += 1;
    this.recovering = false;
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
    this.prerollTap.detach();
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.activeInput = null;
  }
}
