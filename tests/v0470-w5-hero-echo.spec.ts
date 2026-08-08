/**
 * v0.47.0 W5ⓐ — `font_render_echo` **전수화 확장의 바이트 계약** (Node, 서버 불필요).
 *
 * ## 🔴 v0.47.0 V-FIX6 — **계약 개정.** 이 파일의 ①이 틀린 것을 재고 있었다 (리뷰 U4)
 *
 * 종전 ①은 *"기존 6필드 호출은 바이트 동일"* 을 단언했고, 초기 커밋 메시지도 그걸 «바이트
 * 호환의 반증 조건»이라고 불렀다. **거짓 안심이었다.** 프로덕션 방출 경로
 * (`fontRenderProbe.scheduleEchoFontRender`)는 **언제나** `n`·`ell`·`fit`·`txt`를 실어 보낸다 —
 * 6필드짜리 호출은 **테스트 안에만 존재한다.** 그러니 그 단언이 green인 것은 프로덕션 이벤트가
 * 옛 파서와 호환된다는 뜻이 전혀 아니었다. Codex가 정확히 이 지점을 짚었다.
 *
 * 사실관계: `$` 앵커를 쓰는 옛 정규식은 v0.47 이벤트를 **전건 미매치**한다.
 *
 * 👉 되돌리지 않고 **계약을 개정한다** (Larry 확정 — teamops·앱 전수 grep 결과 이 이벤트를
 * 실제로 소비하는 파서가 **0건**이라, 지킬 대상이 없는 호환성 때문에 계측을 약하게 둘 이유가 없다):
 *
 *   **`font_render_echo` 한 이벤트에 승인된 예외 = 「접두 불변 + 꼬리 확장 허용」**
 *   ⚠️ V-FIX6b(2차 재검증) — **일반 규칙이 아니다.** 초판 개정문이 이걸 모든 이벤트로 넓혔는데,
 *   근거는 이 이벤트 하나의 소비자 0건뿐이었다. 레포 기본값은 **바이트 영구 불변**이고
 *   예외는 건별 승인이다(정본: `PRINCIPLES.md` §4 예외 목록).
 *   - 앞 6필드(`hero,w,h,ovX,ovY,len`)의 **순서·이름·값 형식은 바이트 불변**이다.
 *   - 신규 필드는 **그 뒤에만** 붙는다. 사이에 끼워 넣는 것은 계약 위반이다.
 *   - 소비자는 `$` 앵커가 아니라 **접두 매칭**으로 읽는다.
 *   (SSOT: `PRINCIPLES.md` §4 · 빌더 주석은 `logEventsInstrumentation.ts`)
 *
 * 그래서 ①은 **프로덕션 형상**(확장 필드 포함)을 재도록 교체했다 — 실제로 나가는 바이트를
 * 재지 않는 오라클은 없느니만 못하다.
 *
 * ## 재는 축
 *  ① **프로덕션 형상**에서 앞 6필드가 접두로 바이트 불변이고 확장은 꼬리에만 붙는다.
 *  ② 신규 필드가 **정해진 순서로** 붙는다(SOP-003 파서는 순서를 읽는다).
 *  ③ `txt` 이스케이프 — `extra`의 `k=v,k=v` 문법을 깨는 문자가 값에 들어와도 파서가 안 무너진다.
 *     🔴 이게 왜 계약인가: 시트 스키마 불특정이 이 앱의 상시 계약이라(민구 지시 08-05) 값에
 *     무엇이 들어올지 **우리는 모른다.** 쉼표 하나가 로그 한 줄을 통째로 오독시킨다.
 *  ④ 길이 상한 — 링버퍼(2000건)를 긴 문자열 하나가 잠식하지 못한다.
 *
 * ## 🔴 안 재는 축
 *  - **발화 여부**(에코마다 1건 · 순번) → `tests/v045-instrumentation.spec.ts` ②.
 *  - **hero에서 ellipsis가 사라졌는가**(W5ⓑ) → 같은 파일 ②의 `ell=0` 단언 + 실렌더 오라클.
 *  - `readBundleId()`(W5ⓐ′) — `document`를 읽으므로 Node에서 못 잰다. 브라우저 오라클 미신설
 *    (「미확인」으로 산출물에 남긴다).
 */
import { test, expect } from '@playwright/test';
import { fontRenderEcho, escapeExtraValue } from '../src/lib/logEvents';

/** `scheduleEchoFontRender`가 실제로 만드는 인자 형상. 여기가 프로덕션과 어긋나면 이 파일
 *  전체가 «테스트에만 있는 형상»을 재게 된다 — V-FIX6이 고친 결함이 정확히 그것이다. */
const PRODUCTION_SHAPE = {
  hero: 90.1349, w: 402, h: 874, ovX: 0, ovY: 0, len: 4,
  n: 3, ell: false, fit: 0.75, px0: 120.5, ovX0: 8, fit0: 1, txt: '33.3',
} as const;

test('[node] ① 프로덕션 형상 — 앞 6필드는 **접두로** 바이트 불변, 확장은 꼬리에만', () => {
  const line = fontRenderEcho({ ...PRODUCTION_SHAPE });

  // ⓐ 접두 바이트 — 옛 6필드 산출이 **문자 그대로** 앞에 그대로 있다(다음 `,`까지 포함).
  expect(line.startsWith('font_render_echo:hero=90.1,w=402,h=874,ovX=0,ovY=0,len=4,')).toBe(true);

  // ⓑ 순서 — 앞 6필드 사이에 새 필드가 끼어들면 red. `$` 앵커를 못 쓰는 대신 이게 엄격함을 진다.
  const keys = line.slice('font_render_echo:'.length).split(',').map((kv) => kv.split('=')[0]);
  expect(keys.slice(0, 6)).toEqual(['hero', 'w', 'h', 'ovX', 'ovY', 'len']);

  // ⓒ 확장이 **실제로** 붙는다 — 이 단언이 없으면 «꼬리가 통째로 사라져도 green»이 된다.
  //    (종전 ①의 실패가 바로 그 모양이었다: 프로덕션이 안 쓰는 조합만 재서 아무것도 못 지켰다.)
  expect(keys.slice(6)).toEqual(['n', 'ell', 'fit', 'px0', 'ovX0', 'fit0', 'txt']);

  // ⓓ 값 형식도 접두 구간에서 불변 — px 소수 1자리 반올림(fontRenderSnapshot 계보).
  expect(/^font_render_echo:hero=\d+(\.\d)?,/.test(line)).toBe(true);
});

/** 🟡 **레거시 형상** — 6필드만 넘기면 옛 바이트가 그대로 나온다(빌더가 optional로 설계돼 있다).
 *  ⚠️ 이건 **프로덕션 호환의 증거가 아니다** — 프로덕션은 이 형상으로 방출하지 않는다.
 *  빌더가 필드를 무조건 채우도록 퇴행하는 것을 잡는 **구현 가드**로만 남긴다(V-FIX6 이후의 위상). */
test('[node] ①′ 레거시 형상(테스트 전용) — optional 설계가 살아 있다', () => {
  expect(fontRenderEcho({ hero: 167.9, w: 402, h: 513, ovX: 12, ovY: 2, len: 4 }))
    .toBe('font_render_echo:hero=167.9,w=402,h=513,ovX=12,ovY=2,len=4');
});

test('[node] ② 신규 필드는 기존 6필드 **뒤에** 정해진 순서로 붙는다', () => {
  // 민구 제보 시나리오: 402×513에서 `29.9`가 확정 프레임에 넘쳤다가 정착 후 수렴한 형상.
  //   정착값(hero/ovX) = 넘침 없음 · 전환 직후(px0/ovX0) = 넘침 12px → 후보 ①의 서명이다.
  expect(fontRenderEcho({
    hero: 169, w: 402, h: 513, ovX: 0, ovY: 0, len: 4,
    n: 7, ell: false, fit: 0.6875, px0: 240.5, ovX0: 12, fit0: 1, txt: '29.9',
  })).toBe(
    'font_render_echo:hero=169,w=402,h=513,ovX=0,ovY=0,len=4,'
    + 'n=7,ell=0,fit=0.688,px0=240.5,ovX0=12,fit0=1,txt=29.9',
  );
  // ellipsis가 살아 있는 번들(= W5ⓑ 이전)에서 온 로그의 형상.
  expect(fontRenderEcho({
    hero: 169, w: 402, h: 513, ovX: 12, ovY: 0, len: 4, n: 1, ell: true, fit: 1, txt: '29…',
  })).toBe('font_render_echo:hero=169,w=402,h=513,ovX=12,ovY=0,len=4,n=1,ell=1,fit=1,txt=29…');
});

test('[node] ③ txt 이스케이프 — 값에 ,·=·%가 들어와도 k=v 파싱이 무너지지 않는다', () => {
  // 🔴 되돌리는 순서가 계약이다: %2C→',' %3D→'=' %25→'%'. `%`를 먼저 escape하지 않으면
  //    원문의 `%2C`와 이스케이프 산출이 구분되지 않아 **가역성이 깨진다**.
  expect(escapeExtraValue('a,b')).toBe('a%2Cb');
  expect(escapeExtraValue('x=1')).toBe('x%3D1');
  expect(escapeExtraValue('100%')).toBe('100%25');
  expect(escapeExtraValue('%2C')).toBe('%252C');
  // 정상 숫자 값은 손대지 않는다(로그 판독의 99%가 이 경로다).
  expect(escapeExtraValue('29.9')).toBe('29.9');
  // 빌더를 통해도 같은 계약 — kv()가 만든 구분자와 값의 문자가 섞이지 않는다.
  const line = fontRenderEcho({ hero: 64, w: 402, h: 874, ovX: 0, ovY: 0, len: 3, txt: 'a,b' });
  expect(line).toBe('font_render_echo:hero=64,w=402,h=874,ovX=0,ovY=0,len=3,txt=a%2Cb');
  // 파서 관점의 반증: 쌍으로 쪼갰을 때 필드 수가 정확히 7이어야 한다(값의 ','가 새 필드를 만들면 8).
  expect(line.slice('font_render_echo:'.length).split(',')).toHaveLength(7);
});

test('[node] ④ 길이 상한 — 긴 문자열 하나가 링버퍼를 잠식하지 못한다', () => {
  const long = '1234567890123456789012345678901234567890';
  expect(escapeExtraValue(long)).toBe('123456789012345678901234~');
  expect(escapeExtraValue(long).length).toBe(25); // 24 + 잘림 표시 '~'
  // 경계: 정확히 상한이면 자르지 않는다(잘림 표시가 거짓으로 붙지 않는다).
  const exact = '123456789012345678901234';
  expect(exact.length).toBe(24);
  expect(escapeExtraValue(exact)).toBe(exact);
});
