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
