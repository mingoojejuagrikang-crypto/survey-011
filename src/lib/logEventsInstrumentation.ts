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

/** v0.45.0 WP-1① — **ready 화면(세션 시작 전) 입·출력 프로브.** F15("한 번에 안 붙어, 너무
 *  잦아")의 실랑이가 일어나는 곳이 정확히 이 화면인데 여기엔 계측이 없었다(연구 A6 — 세션 중
 *  이벤트는 깨끗한데 사용자는 안 됐다고 한다). "안 붙음"이 STT 미지원인지, TTS 엔진이 얼었는지
 *  (iOS 백그라운드 복귀 후 synth paused 물림), 마이크 장치가 안 보이는지를 로그로 가른다.
 *
 *  [ORCH-47] 겹침 대조: 시작 클릭 후 실패는 `mic_init_failed`·`ui_fx:preroll`이, 음성 목록
 *  로드는 `tts_voices_loaded`가 이미 덮는다 — 이 이벤트는 **시작 클릭 전의 상태**만 신규다.
 *  세션 전이라 sessionId는 `__app__` sentinel로 남는다(시간축으로 다음 세션과 조인).
 *
 *  - `synth`  TTS 엔진 상태. `paused`가 물림 시그니처다(iOS는 백그라운드에서 synthesis를
 *             얼리고, resumeTtsEngine 전까지 speak가 조용히 무음이 된다).
 *  - `voicesKo` 한국어 음성 수. iOS는 목록이 늦게 채워진다 — 0은 "미지원"과 "아직 안 채워짐"
 *             둘 다일 수 있으므로 단독 판정 금지(다음 ready_probe·tts_voices_loaded와 대조).
 *  - `mics`   enumerateDevices의 audioinput 수. 권한 전엔 label이 비지만 개수는 나온다.
 *  - `perm`   Permissions API의 마이크 상태. 미지원 브라우저는 unknown. */
export function readyProbe(fields: {
  stt: 'yes' | 'no';
  synth: 'none' | 'idle' | 'speaking' | 'paused';
  voicesKo: number;
  mics: number | 'unknown';
  perm: 'granted' | 'denied' | 'prompt' | 'unknown';
}): string {
  return `ready_probe:${kv({
    stt: fields.stt,
    synth: fields.synth,
    voicesKo: fields.voicesKo,
    mics: fields.mics,
    perm: fields.perm,
  })}`;
}

/** v0.45.0 WP-1② — **확정(에코) 순간의 hero 실렌더 fontSize.** C3(F4·F6 확정값 잘림)이 로그만으로
 *  판정 불가였던 공백: 기존 `font_render`는 세션 시작 3초 시점 1회 스냅샷이라 확정값 슬롯이 대개
 *  프로브(곡선 해석)였다. 이 이벤트는 확정 플래시(data-hero-state=confirm)가 **실제로 값을 그린
 *  프레임**에서 실렌더만 읽는다 — 요소가 없으면 방출하지 않는다(프로브 폴백 없음: 폴백을 남기면
 *  "확정 순간 실렌더"라는 존재 이유가 사라진다). 세션당 1회(fontRenderProbe.ts가 가드 소유). */
export function fontRenderEcho(fields: { hero: number; w: number; h: number }): string {
  const px = (v: number) => Math.round(v * 10) / 10;
  return `font_render_echo:${kv({ hero: px(fields.hero), w: fields.w, h: fields.h })}`;
}

/** v0.45.0 WP-1④ — **세션-활성 게이트(WP-2)가 hidden에 유지한 구간의 생존 요약.** hidden
 *  사이클당 1건(복귀 또는 임계 도달 시점) — 시계열이 아니라 요약이다([F5] 링버퍼 보호).
 *  WP-2가 "유지"를 선택한 사이클에서 OS가 실제로 무엇을 살려뒀는지가 다음 실기기 판정 축이다:
 *   - `finals`  hidden 동안 도착한 STT final 수 — 유지가 실효였다는 가장 강한 증거(0이면
 *               "발화가 없었다"와 "OS가 죽였다"를 track과 대조해 가른다).
 *   - `stt`     복귀/임계 시점 인식기 인스턴스 존재 여부(ctrl/gone).
 *   - `track`   마이크 트랙 상태(live/muted/ended/none — bg_enter_snapshot과 동일 어휘). */
export function bgKeep(fields: {
  backgroundMs: number;
  finals: number;
  stt: 'ctrl' | 'gone';
  track: string;
}): string {
  return `bg_keep:${kv({
    bg_s: Math.round(fields.backgroundMs / 1000),
    finals: fields.finals,
    stt: fields.stt,
    track: fields.track,
  })}`;
}

/** v0.45.0 WP-2 — 알림 권한 요청·임계 알림 표시 결과. 요청은 세션 시작 클릭(제스처 구간)에서
 *  1회, 표시는 임계 도달 시(backgroundNotify.ts 계약). 조건 거짓도 기록한다([FG-RETURN-LOG-1] —
 *  skipped/no_permission이 없으면 "알림이 안 갔다"와 "배선이 안 붙었다"가 로그에서 같아 보인다). */
export function notifyPerm(fields: {
  src: 'session_start' | 'threshold';
  result: string;
}): string {
  return `notify_perm:${kv({ src: fields.src, result: fields.result })}`;
}
