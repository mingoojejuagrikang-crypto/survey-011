/**
 * 입력 마이크 CATEGORY 분류 (IOS-5 후속 — v0.12.0 AREA1).
 *
 * 입력탭 배지는 raw 장치명이 아니라 CATEGORY(내장/블루투스/유선)만 보여준다(민구 확정).
 * `track.label`은 브라우저/OS마다 표기가 제각각이라(빈 문자열, "iPhone 마이크",
 * "OpenDots ONE by Shokz", "Default" 등) 소문자 휴리스틱으로 큰 범주만 가른다.
 * 출력 라우팅(스피커/이어피스)은 iOS가 Web에 노출하지 않으므로 표시하지 않는다.
 */

export interface InputDeviceCategory {
  /** 배지 아이콘 이모지. */
  icon: string;
  /** 한국어 CATEGORY 라벨. */
  text: string;
}

const BUILT_IN: InputDeviceCategory = { icon: '📱', text: '내장 마이크' };
const BLUETOOTH: InputDeviceCategory = { icon: '🎧', text: '블루투스' };
const WIRED: InputDeviceCategory = { icon: '🎧', text: '유선 이어폰' };

/**
 * `track.label`을 소문자 휴리스틱으로 입력 장치 CATEGORY로 분류한다.
 * 순서가 중요: 내장(빈 문자열/미정의 포함) → 블루투스 → 유선 → 그 외 비어있지 않은
 * 미지 장치명은 외장으로 보아 블루투스로 처리한다.
 */
export function classifyInputDevice(label: string | null | undefined): InputDeviceCategory {
  const l = (label ?? '').trim().toLowerCase();

  // 빈 문자열·내장 마이크 계열 → 📱 내장. (빈/미정의 fallback도 여기로.)
  if (
    l === '' ||
    l.includes('iphone') ||
    l.includes('내장') ||
    l.includes('built-in') ||
    l.includes('default')
  ) {
    return BUILT_IN;
  }

  // 블루투스/무선 이어폰 계열.
  if (
    l.includes('bluetooth') ||
    l.includes('airpod') ||
    l.includes('shokz') ||
    l.includes('opendots') ||
    l.includes('bt')
  ) {
    return BLUETOOTH;
  }

  // 유선/USB 헤드셋 계열.
  if (
    l.includes('wired') ||
    l.includes('usb') ||
    l.includes('headset') ||
    l.includes('유선')
  ) {
    return WIRED;
  }

  // 비어있지 않은 미지 장치명 → 외장으로 간주(블루투스).
  return BLUETOOTH;
}

/** v0.44.0 §5-1 ③ — 계측용 입력장치 분류. */
export type AudioInputClass = 'earphone' | 'builtin';

/**
 * 활성 입력 트랙 라벨을 계측 축(earphone/builtin)으로 분류한다.
 *
 * 휴리스틱: 배지 CATEGORY(classifyInputDevice — bluetooth/airpods/shokz/headset/usb/wired 등)를
 * SSOT로 재사용해 파생한다 — 내장(빈 라벨·iphone·built-in·default 포함) → 'builtin', 그 외
 * (블루투스·유선·버즈류 상표명 같은 비어있지 않은 미지 외장) → 'earphone'. 목록을 여기 복붙하면
 * 두 분류가 갈라진다(복붙된 판단이 결함의 뿌리 — v0.38.0 리뷰#1 계보).
 *
 * 🔴 솔직한 한계(주석 계약 — §5-1 ③):
 *  1. **출력 경로는 Web API로 직접 못 잰다.** 'speakerphone'이 반환값에 없는 이유다 —
 *     스피커폰(내장 마이크 + 스피커 출력)과 이어피스 폰귀대기는 입력 라벨이 같다. 스피커폰은
 *     사후 분석이 `builtin` + TTS 재생창 안 stt_barge_in 밀도(08-02 실측 시그니처)로 추정한다.
 *  2. **라벨은 frozen일 수 있다**([AUDIO-INPUT-2]). getUserMedia 라벨은 init() 시점 스냅샷이고
 *     iOS는 STT(Web Speech)가 자체 캡처라 클립 레코더의 라벨이 STT 실제 경로와 다를 수 있다
 *     (BT 연결 중에도 "iPhone 마이크"로 찍힌 v0.18.0 실기기 전례). 그래서 이 분류는
 *     best-effort이고, 원시 라벨을 이벤트 text에 함께 남겨 사후 재분류를 가능하게 한다.
 */
export function classifyAudioInputClass(label: string | null | undefined): AudioInputClass {
  return classifyInputDevice(label) === BUILT_IN ? 'builtin' : 'earphone';
}
