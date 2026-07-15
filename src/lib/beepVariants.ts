/** v0.33.0 항목10-C(Vance) — 비프음 세그먼트 스펙(순수 모듈).
 *
 *  긍정(값 수용/정정 완료)·부정(이상치 알람) 각 5종을 선언적 세그먼트로 정의하고,
 *  `buildBeepSchedule`이 재생기(beep.ts)가 소비할 절대 스케줄로 변환한다. WebAudio·store 의존이
 *  없어 Node/Playwright에서 직접 import해 검증할 수 있다(호출부 playBeep 시그니처는 beep.ts 유지).
 *
 *  제약(민구 확정): 모든 주파수 500–1200Hz, 변형당 총 길이 ≤350ms. 기본값 = 현행 사운드
 *  (긍정=상승스윕(구 corrected), 부정=하강스윕(구 alert)) — 기본 설정에서 소리 변화 없음.
 */

export type BeepPolarity = 'positive' | 'negative';

export interface BeepSegment {
  /** 세그먼트 시작 시점(변형 원점 대비 ms) */
  atMs: number;
  /** 세그먼트 길이(ms) */
  durationMs: number;
  /** 시작 주파수(Hz) */
  freq: number;
  /** 지수 램프 목표 주파수(Hz). 생략 시 고정음. */
  endFreq?: number;
  /** 피크 게인(현행 0.04~0.055 대역 준수 — 필드 TTS 대비 과대음량 방지) */
  gain: number;
  /** 파형(기본 'sine') */
  wave?: OscillatorType;
}

export interface BeepVariant {
  id: string;
  polarity: BeepPolarity;
  /** 설정탭 칩 라벨(짧게 — 402px에 5칩 한 줄) */
  label: string;
  segments: BeepSegment[];
}

export const DEFAULT_POSITIVE_BEEP_ID = 'pos-rise';
export const DEFAULT_NEGATIVE_BEEP_ID = 'neg-fall';

export const BEEP_VARIANTS: BeepVariant[] = [
  // ── 긍정(값 수용 확인) ──────────────────────────────────────────────
  {
    // 현행 corrected(520→880/180ms/0.045) 그대로 — 기본값.
    id: 'pos-rise', polarity: 'positive', label: '상승',
    segments: [{ atMs: 0, durationMs: 180, freq: 520, endFreq: 880, gain: 0.045 }],
  },
  {
    id: 'pos-fifth', polarity: 'positive', label: '5도',
    segments: [
      { atMs: 0, durationMs: 110, freq: 587, gain: 0.045 },
      { atMs: 120, durationMs: 150, freq: 880, gain: 0.045 },
    ],
  },
  {
    id: 'pos-triad', polarity: 'positive', label: '화음',
    segments: [
      { atMs: 0, durationMs: 85, freq: 523, gain: 0.04 },
      { atMs: 95, durationMs: 85, freq: 659, gain: 0.04 },
      { atMs: 190, durationMs: 130, freq: 784, gain: 0.045 },
    ],
  },
  {
    // 벨: 기본음 + 약한 상부 부분음 동시 발음(긴 감쇠) — 전 주파수 ≤1200Hz 준수.
    id: 'pos-bell', polarity: 'positive', label: '벨',
    segments: [
      { atMs: 0, durationMs: 320, freq: 988, gain: 0.05 },
      { atMs: 0, durationMs: 220, freq: 1174, gain: 0.02 },
    ],
  },
  {
    id: 'pos-pop', polarity: 'positive', label: '팝',
    segments: [{ atMs: 0, durationMs: 70, freq: 700, endFreq: 1100, gain: 0.05 }],
  },

  // ── 부정(이상치 알람) ──────────────────────────────────────────────
  {
    // 현행 alert(740→520/210ms/0.055) 그대로 — 기본값.
    id: 'neg-fall', polarity: 'negative', label: '하강',
    segments: [{ atMs: 0, durationMs: 210, freq: 740, endFreq: 520, gain: 0.055 }],
  },
  {
    // 단2도(반음) 동시 발음 — 맥놀이(beating)로 버즈 질감.
    id: 'neg-buzz', polarity: 'negative', label: '버즈',
    segments: [
      { atMs: 0, durationMs: 260, freq: 554, gain: 0.035 },
      { atMs: 0, durationMs: 260, freq: 523, gain: 0.035 },
    ],
  },
  {
    id: 'neg-doublelow', polarity: 'negative', label: '더블',
    segments: [
      { atMs: 0, durationMs: 110, freq: 523, gain: 0.055 },
      { atMs: 170, durationMs: 110, freq: 523, gain: 0.055 },
    ],
  },
  {
    // 트라이톤 하행(F#5→C5) — 불협 간격으로 경고성 강조.
    id: 'neg-tritone', polarity: 'negative', label: '불협',
    segments: [
      { atMs: 0, durationMs: 130, freq: 740, gain: 0.05 },
      { atMs: 145, durationMs: 170, freq: 523, gain: 0.055 },
    ],
  },
  {
    id: 'neg-trill', polarity: 'negative', label: '트릴',
    segments: [
      { atMs: 0, durationMs: 55, freq: 660, gain: 0.045 },
      { atMs: 60, durationMs: 55, freq: 622, gain: 0.045 },
      { atMs: 120, durationMs: 55, freq: 660, gain: 0.045 },
      { atMs: 180, durationMs: 55, freq: 622, gain: 0.045 },
    ],
  },
];

/** id가 해당 극성의 실존 변형인지(persist 손상/미상 id 방어 — settingsStore migrate가 사용). */
export function isBeepVariantId(id: unknown, polarity: BeepPolarity): boolean {
  return typeof id === 'string' && BEEP_VARIANTS.some((v) => v.id === id && v.polarity === polarity);
}

/** v0.35.0 FB-D — 비프 마스터 볼륨 배수 상한. settingsStore.beepVolume(0~1)을 [0, MAX] 배수로 매핑해
 *  세그먼트 gain(0.04~0.055)에 곱한다. 기본 0.5 → 3×(현행 1×보다 큼, 피크 ≈0.17). 최대 1.0 → 6×.
 *  주파수·클립경계 제약은 위 변형 정의에서 불변. */
export const BEEP_VOLUME_MAX = 6;

/** v0.35.0 FIX-1(리뷰 라운드1) — beepVolume(0~1) → 마스터 게인 배수(순수 함수, 단위 테스트 가능).
 *  손상값(NaN/±Inf/범위 밖)은 기본 0.5로 치유해 침묵/폭주를 막는다. */
export function beepVolumeToMultiplier(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0.5;
  const clamped = Math.max(0, Math.min(1, n));
  return clamped * BEEP_VOLUME_MAX;
}

/** 극성별 변형 조회 — 미상 id는 그 극성의 기본 변형으로 폴백(재생이 절대 침묵하지 않게). */
export function getBeepVariant(id: string, polarity: BeepPolarity): BeepVariant {
  const found = BEEP_VARIANTS.find((v) => v.id === id && v.polarity === polarity);
  if (found) return found;
  const fallbackId = polarity === 'positive' ? DEFAULT_POSITIVE_BEEP_ID : DEFAULT_NEGATIVE_BEEP_ID;
  return BEEP_VARIANTS.find((v) => v.id === fallbackId)!;
}

/** 재생기가 소비하는 절대 스케줄 항목. stopMs = atMs + durationMs. */
export interface ScheduledTone {
  startMs: number;
  stopMs: number;
  freq: number;
  endFreq: number | null;
  gain: number;
  wave: OscillatorType;
}

/** 세그먼트 스펙 → 절대 스케줄(순수 변환, startMs 오름차순). Node/Playwright에서 직접 검증 가능. */
export function buildBeepSchedule(variant: BeepVariant): ScheduledTone[] {
  return [...variant.segments]
    .sort((a, b) => a.atMs - b.atMs)
    .map((s) => ({
      startMs: s.atMs,
      stopMs: s.atMs + s.durationMs,
      freq: s.freq,
      endFreq: s.endFreq != null && s.endFreq !== s.freq ? s.endFreq : null,
      gain: s.gain,
      wave: s.wave ?? 'sine',
    }));
}
