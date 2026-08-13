/**
 * v0.44.1 — getUserMedia 스텁 공용 픽스처 (승인/거부 짝).
 *
 * 왜 필요한가: 헤드리스 크로미엄은 getUserMedia를 **기본 거부**한다. v0.44.0까지는 그 거부가
 * 제품에서 무음이라 세션 시작 스펙들이 우연히 지나갔지만, v0.44.1 [CLIP-INIT-SILENT-1]부터
 * 시작 init() 실패가 **의도적으로 시끄럽다**(mic_lost 래치 → 재연결 배너 role=alert가 상단 고정).
 * 세션을 시작하고 상단 요소(도움말 버튼 등)를 클릭하는 스펙은 배너에 클릭을 뺏기므로,
 * "정상 마이크" 전제의 스펙은 GUM_GRANT_SCRIPT를 addInitScript로 깔아야 한다.
 * (v0440-c8-flow.spec.ts의 로컬 GUM_GRANT_SCRIPT가 원본 — 호출 횟수 계측이 그 스펙의 오라클
 * 계약이라 그쪽은 로컬 사본을 유지한다.)
 *
 * ⚠️ fake 트랙은 **진짜 MediaStream이 아니다** — createMediaStreamSource·MediaRecorder가
 * 던지지만 둘 다 제품이 catch한다(프리롤은 unavailable 폴백, 클립은 clip_arm 실패 경로).
 * 이 픽스처가 보장하는 것은 "init() 성공 = 배너 없음"까지다. 클립 바이트 검증에는 못 쓴다.
 */

export const GUM_GRANT_SCRIPT = `
(function() {
  window.__gumCalls = [];
  // 🔴 v0.49 r3 #11 — 마지막으로 만든 fake 트랙을 **노출한다**(\`window.__lastFakeTrack\`).
  //   세션 **중** 스트림이 죽는 경로(블루투스 낙하)를 e2e로 재현하려면 트랙의 readyState를
  //   밖에서 'ended'로 뒤집을 수 있어야 한다 — 제품의 판정(\`isStreamLost\`)이 정확히 그 필드를
  //   본다(audioRecorder :290). 종전 스텁은 트랙을 클로저에 가둬 그 경로가 e2e로 도달 불가였고,
  //   B3가 deny 스텁으로 옮겨 가면서 「세션 중 소실 → 재연결」 커버리지가 통째로 비었다.
  //   ⚠️ 노출만 한다 — grant 스텁의 기본 동작(항상 live 스트림)은 종전과 완전히 같다.
  function nextStream() {
    var fakeTrack = {
      kind: 'audio', label: 'Fake Mic', readyState: 'live', muted: false,
      getSettings: function(){ return { deviceId: 'fake-mic' }; },
      addEventListener: function(){}, removeEventListener: function(){}, stop: function(){},
    };
    window.__lastFakeTrack = fakeTrack;
    return { getAudioTracks: function(){ return [fakeTrack]; }, getTracks: function(){ return [fakeTrack]; } };
  }
  if (!navigator.mediaDevices) { try { navigator.mediaDevices = {}; } catch(e){} }
  try {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: function(){
        window.__gumCalls.push(Date.now());
        // #11 — 재획득 실패 스위치(기본 off). activeZones의 사본과 같은 계약.
        if (window.__gumDeny) return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
        return Promise.resolve(nextStream());
      },
      writable: true, configurable: true,
    });
  } catch(e){}
})();
`;

/** 거부 스텁 — 실기기 물림([MIC-B2]·[CLIP-INIT-SILENT-1])과 동일한 표면:
 *  호출 즉시 NotAllowedError reject. */
export const GUM_DENY_SCRIPT = `
(function() {
  window.__gumCalls = [];
  if (!navigator.mediaDevices) { try { navigator.mediaDevices = {}; } catch(e){} }
  try {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: function(){
        window.__gumCalls.push(Date.now());
        return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      },
      writable: true, configurable: true,
    });
  } catch(e){}
})();
`;
