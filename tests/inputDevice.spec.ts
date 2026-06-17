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
import { classifyInputDevice } from '../src/lib/inputDevice';

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
