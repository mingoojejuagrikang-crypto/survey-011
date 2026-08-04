/**
 * v0.44.0 §5-1 계측 빌더 3종 — logEvents.ts에서 분리(GL-006 §5 500줄 게이트).
 * 소비처는 계속 `./logEvents`에서 import한다(아래 re-export) — 바이트 계약·파서 매핑 불변.
 * ⚠️ `kv`를 logEvents에서 가져오는 순환 import는 안전하다: 두 파일 모두 최상위 실행 없이
 * 함수 정의만 export한다(ESM 함수 호이스팅 — 호출은 런타임에만 일어난다).
 */
import { kv } from './logEvents';

/** §5-1 ③ — **활성 입력장치 종류.** §D의 인과(스피커폰이면 half-duplex가 필요하다)를 다음
 *  실기기 로그에서 로그만으로 확정하기 위한 축. 세션 시작 시 1회 + 장치 변경 감지 시
 *  (`emitInputDeviceChanged`의 라벨 실제 전이 게이트에 동승 — 링버퍼 잠식 없음) 방출한다.
 *
 *  🔴 유니온에 `speakerphone`이 **없다** — 출력 경로(스피커 vs 이어피스)는 Web API로 직접 못
 *  잰다(`classifyAudioInputClass` 주석). 스피커폰은 사후에 `cls=builtin` + TTS 재생창 안
 *  `stt_barge_in` 밀도(08-02 실측: 771발화/45셀 시그니처)로 추정한다.
 *
 *  원시 라벨은 extra가 아니라 이벤트의 `text` 필드에 싣는다(`input_device_changed` 계보 —
 *  extra는 저카디널리티로 유지해 SOP-003 파서 대조를 지키고, 분류가 틀렸을 때 사후 재분류의
 *  근거는 text가 남긴다). */
export function audioInputClass(fields: {
  cls: 'earphone' | 'builtin';
  src: 'session_start' | 'device_change';
}): string {
  return `audio_input_class:${kv({ cls: fields.cls, src: fields.src })}`;
}

/** §5-1 ④ — **음성 화면 주요 슬롯의 실렌더 fontSize(px).** 실기기 점검 항목 "곡선 3항만 값
 *  변화"를 세 회차째 판정 못 한 공백 — 폰트 실렌더값이 로그에 없었다.
 *
 *  세션당 1회(안정 시점 — `fontRenderProbe.ts`가 계약을 코드로 보장)만 방출한다.
 *  px는 소수 1자리 반올림(부동소수 꼬리 방지 — beepPlay gain 계보). 뷰포트(w/h)를 함께 실어
 *  같은 곡선이 그 기기에서 왜 그 값으로 해석됐는지를 로그만으로 재현 가능하게 한다.
 *
 *  🔴 `probe`는 **그 슬롯 값이 실렌더 요소가 아니라 프로브(보이지 않는 측정용 노드)로 해석된
 *  값**임을 남긴다('+' 연결, 없으면 'none' — visibilityContext evidence 표기 계보). 세션 시작
 *  직후엔 히어로 값 슬롯이 비어 있고 알람 카드도 없으므로 둘은 대개 프로브다 — 출처를 숨기면
 *  "실측"과 "곡선 해석"이 로그에서 같아 보인다(계측이 자기 한계를 숨기지 않는다는 원칙). */
export function fontRenderSnapshot(fields: {
  hero: number;
  alarmLabel: number;
  alarmValue: number;
  chipLabel: number;
  chipValue: number;
  w: number;
  h: number;
  probe: string;
}): string {
  const px = (v: number) => Math.round(v * 10) / 10;
  return `font_render:${kv({
    hero: px(fields.hero),
    alarmLabel: px(fields.alarmLabel),
    alarmValue: px(fields.alarmValue),
    chipLabel: px(fields.chipLabel),
    chipValue: px(fields.chipValue),
    w: fields.w,
    h: fields.h,
    probe: fields.probe,
  })}`;
}

/** §5-1 ② — `stt_barge_in`의 text가 **빈 final 대신 같은 발화의 마지막 interim**에서 채워졌다는
 *  출처 마커. 08-02 실기기 167건 전부 text=''/confidence=0이라 "무엇을 들었는지"가 로그에 없었고
 *  §D2(종경 컬럼) 판정이 미결로 남았다. 이 마커가 없으면 "final이 원래 그 텍스트였다"와
 *  "interim 폴백이었다"가 로그에서 같아 보인다. final 원문이 그대로면 extra 자체가 없다
 *  (과거 로그와 동형 — 기존 이벤트 바이트 불변). */
export function bargeInTextSource(src: 'interim'): string {
  return kv({ text_src: src });
}
