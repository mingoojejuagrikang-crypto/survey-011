/** v0.33.0 항목10-C(Vance) — 비프 재생기. 세그먼트 스펙·스케줄(순수)은 beepVariants.ts로 분리.
 *
 *  playBeep(kind) 시그니처는 유지(호출부 useVoiceSession 무수정):
 *   - 'alert'(이상치 알람)     → 부정 극성 → settingsStore.beepNegativeId 변형 재생
 *   - 'corrected'(정정 완료)   → 긍정 극성 → settingsStore.beepPositiveId 변형 재생
 *   - 'modify'(수정 모드 진입) → 중립 고정음(현행 660Hz/150ms) — 극성 선택과 무관하게 불변.
 *     modify는 "성공/실패"가 아닌 "모드 전환" 신호라 극성 팔레트에 편입하지 않는다(현행 보존).
 *  기본 설정(beepPositiveId='pos-rise', beepNegativeId='neg-fall')에서는 소리가 이전과 동일하다.
 */
import { useSettingsStore } from '../stores/settingsStore';
import {
  buildBeepSchedule,
  getBeepVariant,
  beepVolumeToMultiplier,
  BEEP_VOLUME_MAX,
  type BeepVariant,
  type ScheduledTone,
} from './beepVariants';

// 재노출(기존 import 경로 호환). 매핑·상한 SSOT는 beepVariants.ts(순수·단위 테스트 대상).
export { BEEP_VOLUME_MAX };

type BeepKind = 'alert' | 'corrected' | 'modify';

/** modify(수정 모드 진입) 중립음 — 현행 값 그대로. */
const MODIFY_TONE: ScheduledTone = {
  startMs: 0, stopMs: 150, freq: 660, endFreq: null, gain: 0.04, wave: 'sine',
};

/** store beepVolume(0~1)을 마스터 게인 배수로. 조회 실패/손상 시 순수 매핑이 기본 0.5로 치유. */
function masterMultiplier(): number {
  try {
    return beepVolumeToMultiplier(useSettingsStore.getState().beepVolume);
  } catch {
    return beepVolumeToMultiplier(0.5);
  }
}

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  ctx ??= new AudioCtx();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 절대 스케줄을 WebAudio로 재생(세그먼트별 osc+gain → 마스터 gain → destination). 항상 non-fatal.
 *  v0.35.0 FB-D — 마스터 GainNode에 볼륨 배수를 setValueAtTime으로 건다(0도 안전 — 세그먼트 gain의
 *  exponentialRamp는 그대로 두고 마스터에서만 스케일). `mult`를 넘기면 그 값(미리듣기 라이브 반영),
 *  없으면 store에서 읽는다.
 *
 *  v0.35.0 FIX-1(리뷰 라운드1, Vance) — 마스터 해제는 **실시간 setTimeout이 아니라 각 oscillator의
 *  `onended` 카운팅**으로 한다. ctx가 suspended면 `ctx.currentTime`은 멈춰 있는데 setTimeout은 실시간
 *  이라, resume 지연 시 소리가 나기 전에 disconnect돼 첫 비프가 잘리거나 묵음이 됐고(백그라운드에서
 *  타이머 스로틀 시 노드 누수), onended는 실제 재생 종료에 동기화돼 그 레이스를 없앤다. */
function playSchedule(tones: ScheduledTone[], mult: number = masterMultiplier()): void {
  try {
    const c = getCtx();
    if (!c) return;
    const now = c.currentTime;
    const master = c.createGain();
    // v0.35.0 R2-FIX-6(리뷰 라운드2, Pro) — 상한도 클램프. 종전엔 하한(Math.max(0,·))만 있어, 호출부가
    //   손상된 배수를 넘기면 클리핑/폭주 음량이 날 수 있었다. beepVolumeToMultiplier가 이미 [0,MAX]로
    //   매핑하지만, 재생기 자체에서도 최종 방어선을 둔다(defense in depth).
    master.gain.setValueAtTime(Math.min(Math.max(0, mult), BEEP_VOLUME_MAX), now);
    master.connect(c.destination);
    let pending = tones.length;
    if (pending === 0) { try { master.disconnect(); } catch { /* no-op */ } return; }
    for (const tone of tones) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = tone.wave;
      const t0 = now + tone.startMs / 1000;
      const t1 = now + tone.stopMs / 1000;
      osc.frequency.setValueAtTime(tone.freq, t0);
      if (tone.endFreq != null) {
        osc.frequency.exponentialRampToValueAtTime(tone.endFreq, t1);
      }
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(tone.gain, t0 + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t0);
      osc.stop(t1 + 0.03);
      osc.onended = () => {
        try { osc.disconnect(); gain.disconnect(); } catch { /* no-op */ }
        // 마지막 oscillator가 끝난 뒤에만 마스터 해제(재생 종료에 동기 — setTimeout 레이스 제거).
        if (--pending === 0) { try { master.disconnect(); } catch { /* no-op */ } }
      };
    }
  } catch {
    // Audio feedback is non-critical; never block the voice flow.
  }
}

export function playBeep(kind: BeepKind): void {
  try {
    if (kind === 'modify') {
      playSchedule([MODIFY_TONE]);
      return;
    }
    const s = useSettingsStore.getState();
    const variant = kind === 'corrected'
      ? getBeepVariant(s.beepPositiveId, 'positive')
      : getBeepVariant(s.beepNegativeId, 'negative');
    playSchedule(buildBeepSchedule(variant));
  } catch {
    // 설정 조회 실패 등도 음성 흐름을 막지 않는다.
  }
}

/** 설정탭 칩 미리듣기 — 선택 여부와 무관하게 해당 변형을 즉시 재생.
 *  v0.35.0 FB-D — `volume`(0~1)을 넘기면 그 값으로 즉시 재생(볼륨 슬라이더 라이브 미리듣기). 없으면
 *  현재 store 볼륨. */
export function previewBeep(variant: BeepVariant, volume?: number): void {
  const mult = volume == null ? undefined : beepVolumeToMultiplier(volume);
  playSchedule(buildBeepSchedule(variant), mult);
}
