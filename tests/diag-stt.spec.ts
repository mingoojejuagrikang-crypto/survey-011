import { test } from '@playwright/test';

const MOCK_INIT_SCRIPT = `
(function() {
  function MockSTT() { window.__mockSTT = this; }
  MockSTT.prototype.start = function() {};
  MockSTT.prototype.stop = function() {};
  MockSTT.prototype.abort = function() {};
  MockSTT.prototype.addEventListener = function() {};
  MockSTT.prototype.removeEventListener = function() {};
  
  // Try 1: define window.SpeechRecognition
  try {
    Object.defineProperty(window, 'SpeechRecognition', {
      value: MockSTT, writable: true, configurable: true, enumerable: true,
    });
    window.__stt_define_sr_ok = true;
  } catch(e) {
    window.__stt_define_sr_ok = false;
    window.__stt_define_sr_err = String(e);
  }

  // Check webkitSpeechRecognition desc
  var wsrDesc = Object.getOwnPropertyDescriptor(window, 'webkitSpeechRecognition');
  window.__wsr_desc = wsrDesc ? JSON.stringify({
    configurable: wsrDesc.configurable,
    writable: wsrDesc.writable,
    hasValue: !!wsrDesc.value,
    hasGet: !!wsrDesc.get,
  }) : 'undefined (on prototype?)';
  
  // Check prototype
  var wsrProtoDesc = Object.getOwnPropertyDescriptor(Window.prototype, 'webkitSpeechRecognition');
  window.__wsr_proto_desc = wsrProtoDesc ? JSON.stringify({
    configurable: wsrProtoDesc.configurable,
    writable: wsrProtoDesc.writable,
    hasValue: !!wsrProtoDesc.value,
    hasGet: !!wsrProtoDesc.get,
  }) : 'undefined';
})();
`;

test('STT registration diagnostics', async ({ page }) => {
  await page.addInitScript(MOCK_INIT_SCRIPT);
  await page.goto('http://localhost:5175');
  await page.waitForLoadState('domcontentloaded');
  
  const diag = await page.evaluate(() => {
    const w = window as unknown as Record<string,unknown>;
    const srDefined = typeof w.SpeechRecognition !== 'undefined';
    const wsrDefined = typeof w.webkitSpeechRecognition !== 'undefined';
    let srIsMock = false;
    if (srDefined) {
      try { new (w.SpeechRecognition as new()=>object)(); srIsMock = !!w.__mockSTT; } catch(e) {}
    }
    return {
      sr_defined: srDefined,
      wsr_defined: wsrDefined,
      sr_define_ok: w.__stt_define_sr_ok,
      sr_define_err: w.__stt_define_sr_err,
      sr_is_mock: srIsMock,
      wsr_desc: w.__wsr_desc,
      wsr_proto_desc: w.__wsr_proto_desc,
      mock_stt_after_new: !!w.__mockSTT,
    };
  });
  console.log('Diagnostics:', JSON.stringify(diag, null, 2));
});
