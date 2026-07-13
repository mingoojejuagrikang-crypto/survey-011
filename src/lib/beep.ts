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
  type BeepVariant,
  type ScheduledTone,
} from './beepVariants';

type BeepKind = 'alert' | 'corrected' | 'modify';

/** modify(수정 모드 진입) 중립음 — 현행 값 그대로. */
const MODIFY_TONE: ScheduledTone = {
  startMs: 0, stopMs: 150, freq: 660, endFreq: null, gain: 0.04, wave: 'sine',
};

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  ctx ??= new AudioCtx();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 절대 스케줄을 WebAudio로 재생(세그먼트별 osc+gain, 종료 시 disconnect). 항상 non-fatal. */
function playSchedule(tones: ScheduledTone[]): void {
  try {
    const c = getCtx();
    if (!c) return;
    const now = c.currentTime;
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
      gain.connect(c.destination);
      osc.start(t0);
      osc.stop(t1 + 0.03);
      osc.onended = () => {
        try { osc.disconnect(); gain.disconnect(); } catch { /* no-op */ }
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

/** 설정탭 칩 미리듣기 — 선택 여부와 무관하게 해당 변형을 즉시 재생. */
export function previewBeep(variant: BeepVariant): void {
  playSchedule(buildBeepSchedule(variant));
}
