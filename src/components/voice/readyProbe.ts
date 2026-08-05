/**
 * v0.45.0 WP-1① — ready 화면(세션 시작 전) 입·출력 상태 프로브.
 *
 * 왜: F15("한 번에 안 붙어") 실랑이는 ready 화면에서 일어나는데(부팅 4회/일 + 들락 3회 실측),
 * 그 화면에는 계측이 없어 "무엇이 안 붙는 것인지"(STT 무반응? TTS 무음? 마이크?)를 로그로 특정할
 * 수 없었다(연구 A6 — 계측 후보 1순위). 이 프로브가 시작 클릭 **전**의 상태를 남긴다.
 *
 * 계약:
 *  - **getUserMedia를 부르지 않는다** — F18(권한 요청 = '음성 입력 시작' 클릭뿐, App.tsx 주석).
 *    마이크 축은 enumerateDevices 개수 + Permissions API 상태까지만.
 *  - **링버퍼 보호**([F5] 계보): ReadyState 마운트마다가 아니라 스로틀(THROTTLE_MS) 통과 시에만
 *    방출한다. 탭을 빠르게 오가도 로그가 쌓이지 않는다. 방출 실패는 조용히 무시(best-effort).
 *  - 세션 전이라 sessionId는 `__app__` sentinel — 시간축으로 다음 세션 시작과 조인한다.
 *  - `voicesKo`는 synth.getVoices() 직접 읽기다. refreshVoices()를 부르지 않는다 —
 *    그쪽은 tts_voices_loaded 텔레메트리를 방출하므로 프로브가 다른 계측을 오염시킨다.
 */
import { logger } from '../../lib/logger';
import { readyProbe } from '../../lib/logEvents';
import { isSpeechSupported } from '../../lib/speech';

/** 연속 마운트 방출 억제 — 같은 ready 체류에서 탭만 오가는 리마운트가 로그를 도배하지 않게. */
const THROTTLE_MS = 10_000;
let lastEmitAt = 0;

function synthState(): 'none' | 'idle' | 'speaking' | 'paused' {
  const synth = window.speechSynthesis as SpeechSynthesis | undefined;
  if (!synth) return 'none';
  // paused를 speaking보다 먼저 본다 — iOS 백그라운드 물림의 시그니처가 paused이고,
  // paused 중에도 speaking이 true로 남는 구현이 있다(paused가 더 특정적인 사실).
  if (synth.paused) return 'paused';
  if (synth.speaking) return 'speaking';
  return 'idle';
}

async function micDeviceCount(): Promise<number | 'unknown'> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput').length;
  } catch {
    return 'unknown';
  }
}

async function micPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const perms = navigator.permissions;
    if (!perms?.query) return 'unknown';
    const status = await perms.query({ name: 'microphone' as PermissionName });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** ReadyState 마운트에서 호출한다(fire-and-forget). 스로틀에 걸리면 아무것도 하지 않는다. */
export function emitReadyProbe(): void {
  const now = Date.now();
  if (now - lastEmitAt < THROTTLE_MS) return;
  lastEmitAt = now;
  const stt = isSpeechSupported() ? 'yes' : 'no';
  const synth = synthState();
  const voicesKo = (() => {
    try {
      return (window.speechSynthesis?.getVoices() ?? [])
        .filter((v) => v.lang?.toLowerCase().startsWith('ko')).length;
    } catch {
      return 0;
    }
  })();
  void Promise.all([micDeviceCount(), micPermission()])
    .then(([mics, perm]) => {
      logger.log({ type: 'app', extra: readyProbe({ stt, synth, voicesKo, mics, perm }) });
    })
    .catch(() => { /* best-effort 계측 — ready 화면 렌더를 절대 막지 않는다 */ });
}
