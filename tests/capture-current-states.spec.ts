/**
 * F3 입력화면 **현재 상태** 실렌더 캡처 → design-sync 프리뷰 카드.
 *
 * 이 스펙은 계약을 검증하지 않는다(그건 `v039-active-zones.spec.ts`가 한다). 하는 일은 하나 —
 * 민구가 눈으로 보고 코멘트할 수 있게 **지금 화면을 상태별로 충실히 뽑는 것**이다.
 * 개선안을 만들지 않고, `src/`를 건드리지 않는다.
 *
 * 산출:
 *   design-sync/_previews/<이름>.html            self-contained 카드(외부 참조 0)
 *   design-sync/_previews/_live/<이름>.png        같은 상태의 라이브 스크린샷
 *   design-sync/_previews/_live/<이름>.preview.png  프리뷰를 다시 렌더한 것(나란히 대조용)
 *   design-sync/_previews/_report.md             자기검증 수치
 *
 * 🔴 각 케이스는 프리뷰가 실화면과 **수치로 같음**을 증명하지 못하면 실패한다. 어긋난 카드를
 *    통과시키면 민구가 잘못된 화면을 보고 결정하게 되고 그 결정이 통째로 무효가 된다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';

import { boot } from './fixtures/activeZones';
import { CASES, type Measurements, type StateCase } from './fixtures/captureCases';
import {
  DEVICE, LIVE_DIR, PREVIEW_DIR,
  assertSelfContained, buildPreviewHtml, collectWebFonts, serializeLive, writePreview,
  type CardMeta, type FontCollector,
} from './fixtures/previewCapture';
import { diffFingerprints, diffStability, fingerprint, pixelDiff } from './fixtures/previewVerify';

test.setTimeout(180_000);

const VERSION = '0.39.0';
const COMMIT = (() => {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
})();

const reportLines: string[] = [];

test.beforeAll(() => {
  fs.mkdirSync(LIVE_DIR, { recursive: true });
});

for (const c of CASES) {
  test(`캡처 ${c.name} — ${c.title}`, async ({ page, context }) => {
    const fonts = collectWebFonts(page);
    await boot(page, DEVICE);
    const measured = (await c.drive(page)) ?? {};
    await captureAndVerify(page, context, c, fonts, measured);
  });
}

/** 🔴 여기까지의 검증은 전부 `setContent()`(about:blank)로 했다 — 존재하는 가장 관대한 컨텍스트다.
 *  민구는 카드를 **파일로 열거나 Design 패널**에서 본다. 특히 `09`는 스크롤 복원 **인라인 스크립트가
 *  실행돼야** 맞는 화면이 되고, 안 되면 에러 없이 `01`과 똑같아 보인다. 실제 로드 경로에서 한 번 확인한다. */
test('실제 로드 경로 — file:// 로 열어도 스크롤 상태가 살아 있다(09)', async ({ page }) => {
  const file = path.join(PREVIEW_DIR, '09-chipzone-overflow.html');
  expect(fs.existsSync(file), '먼저 캡처가 돌아야 한다').toBe(true);
  await page.setViewportSize({ width: 520, height: 1000 });
  await page.goto(`file://${file}`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const fp = await fingerprint(page);
  expect(fp.chipScrollTop, 'file://에서 스크롤 복원 스크립트가 실행되지 않았다').toBeGreaterThan(0);
  expect(fp.nodes['[data-testid="interim-value"]'] ?? fp.nodes['[data-hero-state]']).toBeTruthy();
  console.log(`[capture] file:// 로드 검증 — chipScrollTop=${fp.chipScrollTop}`);
});

test.afterAll(() => {
  if (reportLines.length === 0) return;
  fs.writeFileSync(
    path.join(PREVIEW_DIR, '_report.md'),
    `# design-sync 프리뷰 자기검증 — survey-011 v${VERSION} (commit ${COMMIT})\n\n`
    // 카드 수를 헤더에 박는다 — 일부만 돌린 실행이 이 파일을 덮어써도 잘렸다는 사실이 바로 보이게.
    + `**카드 ${reportLines.length} / ${CASES.length}** · `
    + `뷰포트 ${DEVICE.width}×${DEVICE.height}. 라이브 DOM 직렬화 → self-contained HTML → 재렌더 → 지문 대조.\n`
    + `"어긋남 0"은 프리뷰의 모든 추적 노드가 라이브와 텍스트·fontSize·lineHeight·opacity 동일,`
    + ` 상자 좌표 ±1.0px 이내라는 뜻이다.\n\n`
    + reportLines.sort().join('\n') + '\n',
    'utf8',
  );
});

async function captureAndVerify(
  page: Page, context: BrowserContext, meta: StateCase, fonts: FontCollector, measured: Measurements,
): Promise<void> {
  // 1. 라이브 — 지문과 스크린샷을 연달아 뜬다(파형 rAF가 프레임을 바꾸기 전에).
  const liveFp = await fingerprint(page);
  const serialized = await serializeLive(page);
  const livePng = path.join(LIVE_DIR, `${meta.name}.png`);
  const previewPng = path.join(LIVE_DIR, `${meta.name}.preview.png`);
  await page.screenshot({ path: livePng });
  // 과도 상태 카드 — 캡처 도중에 창이 닫혔다면 위 산출물은 다른 화면이다. 여기서 잡는다.
  if (meta.holdSelector) {
    await expect(
      page.locator(meta.holdSelector),
      `${meta.name}: 캡처가 끝나기 전에 상태가 닫혔다 — 카드가 다른 화면을 담고 있다`,
    ).toBeVisible();
  }

  // 2. 프리뷰 조립 — 실제로 로드됐던 웹폰트만 data: URI로 임베드한다.
  const { css: fontCss, embedded, dropped } = await fonts.embeddedCss();
  const fontNote = embedded > 0
    ? `실제 로드된 @font-face ${embedded}개를 woff2 data URI로 인라인(대체 아님, 원본 임베드). 미다운로드 서브셋 ${dropped}개는 제거.`
    : 'Pretendard는 원격에서 제공되지 않아 라이브도 시스템 sans 폴백으로 렌더된다 — 프리뷰와 차이 없음.';
  const html = buildPreviewHtml(meta, serialized, fontCss, { version: VERSION, commit: COMMIT, fontNote });
  assertSelfContained(html, meta.name);
  const file = writePreview(meta.name, html);
  expect(html.startsWith(`<!-- @dsCard group="${meta.group}" -->`), '첫 줄 카드 마커').toBe(true);

  // 3. 프리뷰를 실제로 렌더해 같은 지문을 뜬다.
  const preview = await context.newPage();
  try {
    await preview.setViewportSize({ width: 520, height: 1000 });
    await preview.setContent(html, { waitUntil: 'load' });
    await preview.evaluate(() => document.fonts.ready);
    await preview.waitForTimeout(250);
    const previewFp = await fingerprint(preview);
    await preview.locator('.ds-stage').screenshot({ path: previewPng });

    // 4. 창 크기를 크게 바꿔도 카드가 흔들리지 않아야 한다(vw/vh 동결이 실제로 먹었는가).
    await preview.setViewportSize({ width: 1100, height: 1400 });
    await preview.waitForTimeout(250);
    const resizedFp = await fingerprint(preview);

    const drift = diffFingerprints(liveFp, previewFp);
    const unstable = diffStability(previewFp, resizedFp);
    const pixels = await pixelDiff(preview, livePng, previewPng);

    const cf = liveFp.crossfade;
    const ov = liveFp.dotsOverflow;
    reportLines.push(
      `## ${meta.name}\n`
      + `- 파일: \`${path.relative(PREVIEW_DIR, file)}\` (${Math.round(html.length / 1024)} KB) · 그룹 \`${meta.group}\` · ${meta.feedback}\n`
      + `- 추적 노드 ${Object.keys(liveFp.nodes).length}개 · 동결 타이포 ${serialized.frozenTypography} / 뷰포트단위 박스 ${serialized.frozenBoxes} / 스크롤 ${serialized.scrollNodes}\n`
      + (cf ? `- 크로스페이드: --voice-level=\`${cf.voiceLevel}\` → 도트 opacity ${cf.dots} · 파형 opacity ${cf.wave}\n` : '')
      + (ov ? `- 도트 넘침: 위 ${ov.top}px · 아래 ${ov.bottom}px (도트 ${ov.dotsH}px vs 밴드 ${ov.bandH}px)\n` : '')
      + Object.entries(measured).map(([k, v]) => `- 실측 ${k}: **${v}**\n`).join('')
      + `- 화소 대조: ${pixels.width}×${pixels.height} 일치 · 차이 화소 ${pixels.changed}/${pixels.total} (**${pixels.pct}%**)\n`
      + `- **라이브 대비 어긋남: ${drift.length}건** / 창크기 불안정: ${unstable.length}건\n`
      + (drift.length ? `\n\`\`\`\n${drift.join('\n')}\n\`\`\`\n` : '')
      + (unstable.length ? `\n불안정:\n\`\`\`\n${unstable.slice(0, 10).join('\n')}\n\`\`\`\n` : ''),
    );

    // 콘솔에도 남긴다 — 실패 시 러너 출력만 봐도 원인이 보이게.
    console.log(`[capture] ${meta.name}: drift=${drift.length} unstable=${unstable.length} px=${pixels.pct}% nodes=${Object.keys(liveFp.nodes).length}`
      + (cf ? ` level=${cf.voiceLevel} dots=${cf.dots} wave=${cf.wave}` : '')
      + (ov ? ` overflow=${ov.top}/${ov.bottom} dots=${ov.dotsH} band=${ov.bandH}` : ''));

    expect(drift, `${meta.name}: 프리뷰가 실화면과 어긋난다`).toEqual([]);
    expect(unstable, `${meta.name}: 카드가 뷰어 창 크기에 따라 흔들린다`).toEqual([]);
    // 브리핑 요구 — "두 이미지의 뷰포트 크기 일치".
    expect({ w: pixels.width, h: pixels.height }, `${meta.name}: 두 이미지 크기 불일치`)
      .toEqual({ w: DEVICE.width, h: DEVICE.height });
    expect(pixels.pct, `${meta.name}: 화소가 ${pixels.pct}% 다르다`).toBeLessThan(1);
  } finally {
    await preview.close();
  }
}
