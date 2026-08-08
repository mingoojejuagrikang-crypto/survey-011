/**
 * v0.47.0 W5ⓐ — `font_render_echo` **전수화 확장의 바이트 계약** (Node, 서버 불필요).
 *
 * 왜 새 파일인가: `tests/logEvents.spec.ts`는 v0.35.2 특성화 테스트로서 *"빌더 구현을 바꿔서
 * 이 테스트를 고치고 싶어지면 그것은 외부 파서 계약 위반 신호"* 라는 계약을 머리에 달고 있다.
 * W5ⓐ는 그 계약을 **깨지 않는 방식**(전 필드 optional)으로 확장했으므로 그 파일의 기대값 3건은
 * 손대지 않았다 — **그 3건이 그대로 green인 것이 「기존 호출은 바이트 동일」의 반증 조건이다.**
 * 신규 필드의 계약은 여기가 따로 진다.
 *
 * ## 재는 축
 *  ① 기존 6필드 호출의 산출이 **문자 그대로 종전과 같다**(회귀 가드 — 위 반증 조건의 사본).
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

test('[node] ① 기존 6필드 호출은 바이트 동일 — 신규 필드는 전부 optional이다', () => {
  expect(fontRenderEcho({ hero: 90.1349, w: 402, h: 874, ovX: 0, ovY: 0, len: 4 }))
    .toBe('font_render_echo:hero=90.1,w=402,h=874,ovX=0,ovY=0,len=4');
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
