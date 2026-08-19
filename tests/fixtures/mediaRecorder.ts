/**
 * v0.50 [CLIP-SILENT-1] — **MediaRecorder 스텁**(getUserMedia 스텁과 짝).
 *
 * ## 왜 필요해졌나
 * `GUM_GRANT_SCRIPT`의 fake 스트림은 **진짜 `MediaStream`이 아니라서 `MediaRecorder` 생성자가
 * 던진다**(fixtures/gum.ts 헤더가 명시). 그래서 종전 e2e는 **모든 세션에서 클립이 항상 비었다** —
 * 실기기에서는 정상 세션이면 클립이 저장되는데(2026-08-19 4세션 중 3세션이 그 증거),
 * 테스트 환경만 「마이크가 늘 죽어 있는 세계」였다.
 *
 * 그 비현실성이 v0.50 [CLIP-SILENT-1](빈 클립 연속 2회 → `micLost` 래치)에서 드러났다:
 * 래치가 **전 스펙에서 상시 발동**해 자동 재연결이 쿨다운(3s)에 걸리는 순간 재연결 배너와
 * red 톤이 서고, 「정정 확정 순간부터 green」 류 단언이 깨졌다(v0461-fb10 · v047-cfix1).
 * 👉 **제품을 테스트에 맞추는 대신 테스트를 실기기에 맞춘다.**
 *
 * ## 계약
 *  · 기본: 정지 시 **정상 크기 blob 1개**(`EMPTY_CLIP_BYTES=200`을 크게 넘는다) → `clip_saved`.
 *  · 트랙이 `ended`면: **데이터 없음** → `clip_empty`. v0.49 r3 #11(세션 중 스트림 사망)이
 *    `__lastFakeTrack.readyState = 'ended'`로 만드는 그 경로가 **그대로 산다.**
 *  · `window.__clipSilentMode`로 **무음 사고**를 명시적으로 재현한다:
 *      `'tiny'` → 5바이트(2026-08-19 실측 형상 · `clip_too_small`)
 *      `'none'` → chunk 0 (`clip_stop_resolved:null` · `clip_empty`)
 *
 * ⚠️ 이 blob은 **디코드 가능한 webm이 아니다.** `audioTrim.processClip`의 `decodeAudioData`가
 * 실패해 `clip_trim_failed:decode:*`가 남고 **원본이 그대로 저장**된다(v0.20.0 BL-2 폴백).
 * 저장·포인터·매니페스트 경로를 재는 데는 충분하고, 트림 결과 자체를 재려면 `audioTrim.spec.ts`
 * (합성 PCM 단위 테스트)를 봐라.
 */

/** 정상 클립 1건의 바이트 수 — 실측 정상 세션 최소치(29,484B)와 같은 자릿수로 둔다. */
export const STUB_CLIP_BYTES = 30_000;

export const MEDIA_RECORDER_STUB_SCRIPT = `
(function () {
  if (window.__mediaRecorderStubbed) return;
  window.__mediaRecorderStubbed = true;
  // null(기본) | 'tiny'(5바이트) | 'none'(chunk 0) — 스펙이 런타임에 갈아끼운다.
  if (typeof window.__clipSilentMode === 'undefined') window.__clipSilentMode = null;

  /** 조각 하나. emitted는 이 레코더가 지금까지 낸 조각 수(무음 모드가 그걸 본다). */
  function payloadFor(stream, emitted) {
    var mode = window.__clipSilentMode;
    if (mode === 'none') return null;                       // chunk 0 → clip_stop_resolved:null
    // 'tiny': **첫 조각만** 5바이트를 내고 그 뒤로는 아무것도 안 낸다 —
    // 2026-08-19 실측이 「클립 전체가 5바이트」였다(조각이 쌓여 임계 200을 넘으면 안 된다).
    if (mode === 'tiny') return emitted === 0 ? new Blob([new Uint8Array(5)], { type: 'audio/webm' }) : null;
    var track = null;
    try { track = (stream && stream.getAudioTracks && stream.getAudioTracks()[0]) || null; } catch (e) {}
    // 트랙이 죽었으면 레코더도 아무것도 못 낸다 — 실기기의 헤드셋 낙하와 같은 표면.
    if (!track || track.readyState === 'ended') return null;
    return new Blob([new Uint8Array(${STUB_CLIP_BYTES})], { type: 'audio/webm' });
  }

  function FakeRecorder(stream, opts) {
    this.stream = stream;
    this.mimeType = (opts && opts.mimeType) || 'audio/webm;codecs=opus';
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
    this._emitted = 0;
    this._timer = null;
  }
  FakeRecorder.prototype._emit = function () {
    var blob = payloadFor(this.stream, this._emitted);
    if (!blob) return;
    this._emitted++;
    if (typeof this.ondataavailable === 'function') this.ondataavailable({ data: blob });
  };
  /** 🔴 **timeslice를 실물처럼 지킨다.** 제품은 start(250)으로 녹음 **중에도** 조각을 받아
   *  두는데(iOS에서 stop 시 final dataavailable이 지연되는 것에 대한 방어), 스텁이 stop에서만
   *  내면 **다음 클립이 post-roll 0.5s 안에 시작해 우아하게 절단하는 경로**에서 chunks가 통째로
   *  비어 clip_empty가 된다(08-19 구현 회차 실측 — 정상 커밋 흐름이 전부 빈 클립이 됐다). */
  FakeRecorder.prototype.start = function (timeslice) {
    this.state = 'recording';
    var self = this;
    var ms = typeof timeslice === 'number' && timeslice > 0 ? timeslice : 250;
    this._emit(); // 첫 조각은 즉시 — 아주 짧은 클립도 데이터를 갖는다.
    this._timer = setInterval(function () {
      if (self.state !== 'recording') return;
      self._emit();
    }, ms);
  };
  FakeRecorder.prototype.pause = function () { this.state = 'paused'; };
  FakeRecorder.prototype.resume = function () { this.state = 'recording'; };
  FakeRecorder.prototype.stop = function () {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    var self = this;
    // 실물처럼 **비동기**로 전달한다 — 동기로 부르면 stopClip의 resolveStop 등록 전에 도착한다.
    setTimeout(function () {
      self._emit();
      if (typeof self.onstop === 'function') self.onstop();
    }, 0);
  };
  FakeRecorder.isTypeSupported = function (t) {
    return t === 'audio/webm;codecs=opus' || t === 'audio/webm';
  };
  window.MediaRecorder = FakeRecorder;
})();
`;
