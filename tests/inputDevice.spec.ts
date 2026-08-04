/**
 * Input-device CATEGORY classifier — pure-function unit tests (v0.12.0 AREA1, IOS-5 후속).
 *
 * inputDevice.ts has no DOM/browser deps, so we import it directly and run in Node via the
 * project's existing Playwright runner (no new tooling). Spec lives under tests/ to match the
 * project's testDir convention (koreanNum.spec.ts 등) so it is discovered by the runner.
 *
 * Coverage focus:
 *  - empty / undefined / null fallback → 📱 내장 마이크
 *  - iPhone built-in label → 📱 내장 마이크
 *  - OpenDots / Shokz / AirPods / bluetooth → 🎧 블루투스
 *  - USB / wired / headset → 🎧 유선 이어폰
 *  - non-empty unknown device name → 🎧 블루투스 (외장 간주)
 */

import { test, expect } from '@playwright/test';
import { classifyInputDevice, classifyAudioInputClass } from '../src/lib/inputDevice';

test.describe('classifyInputDevice — CATEGORY heuristic', () => {
  const cases: Array<[string | null | undefined, string, string]> = [
    // empty / missing → built-in fallback
    ['', '📱', '내장 마이크'],
    [undefined, '📱', '내장 마이크'],
    [null, '📱', '내장 마이크'],
    // built-in family
    ['iPhone 마이크', '📱', '내장 마이크'],
    ['Built-In Microphone', '📱', '내장 마이크'],
    ['Default', '📱', '내장 마이크'],
    // bluetooth family (incl. the OpenDots/Shokz earphone from [STT-12])
    ['OpenDots ONE by Shokz', '🎧', '블루투스'],
    ['AirPods Pro', '🎧', '블루투스'],
    ['Bluetooth Headphones', '🎧', '블루투스'],
    // wired family
    ['USB Audio Device', '🎧', '유선 이어폰'],
    ['Wired Headset', '🎧', '유선 이어폰'],
    ['유선 이어폰', '🎧', '유선 이어폰'],
    // non-empty unknown → 외장(블루투스)
    ['Some Unknown Mic 9000', '🎧', '블루투스'],
  ];

  for (const [label, icon, text] of cases) {
    test(`${JSON.stringify(label)} → ${icon} ${text}`, () => {
      const r = classifyInputDevice(label);
      expect(r.icon).toBe(icon);
      expect(r.text).toBe(text);
    });
  }
});

/** v0.44.0 §5-1 ③ — 계측용 입력장치 분류(earphone/builtin). 배지 CATEGORY(classifyInputDevice)를
 *  SSOT로 재사용해 파생한다: 내장 → builtin, 그 외(블루투스·유선·미지 외장) → earphone.
 *  🔴 'speakerphone'은 반환값에 없다 — 출력 경로(스피커 vs 이어피스)는 Web API로 못 잰다.
 *  스피커폰 추정은 사후 분석(builtin + TTS 재생창 내 barge-in 밀도)의 몫이다. */
test.describe('classifyAudioInputClass — §5-1 ③ 계측 분류 (fake 라벨 주입)', () => {
  const cases: Array<[string | null | undefined, 'earphone' | 'builtin']> = [
    // builtin: 빈/미정의 폴백 + 내장 계열 + default
    ['', 'builtin'],
    [undefined, 'builtin'],
    [null, 'builtin'],
    ['iPhone 마이크', 'builtin'],
    ['Built-In Microphone', 'builtin'],
    ['Default - MacBook Pro Microphone', 'builtin'],
    // earphone: bluetooth/airpods/shokz 계열
    ['AirPods Pro', 'earphone'],
    ['OpenDots ONE by Shokz', 'earphone'],
    ['Bluetooth Headphones', 'earphone'],
    // earphone: 유선/USB/헤드셋 계열
    ['USB Audio Device', 'earphone'],
    ['Wired Headset', 'earphone'],
    // earphone: 미지 외장(버즈류 상표명 등 — CATEGORY 휴리스틱의 "비어있지 않은 미지 → 외장" 폴백)
    ['Galaxy Buds2 Pro', 'earphone'],
    ['Fake Mic', 'earphone'],
  ];
  for (const [label, cls] of cases) {
    test(`${JSON.stringify(label)} → ${cls}`, () => {
      expect(classifyAudioInputClass(label)).toBe(cls);
    });
  }
});
