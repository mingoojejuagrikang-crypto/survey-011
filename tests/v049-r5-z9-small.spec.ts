/**
 * v0.49 r5 Z9 오라클 — 소형 4건(claude #10·#11·#12·#13). 게이트 편입 2건은 Z9-a에서 처리했다.
 *
 * ① **#10 소수 문맥 재기록이 사유를 잃는다** — `armLanding`이 소수 큐를 **다시 그릴 때**
 *   `setDecimalReason(whole)`을 사유 없이 불러 기본값 `'parse_failed'`로 굳혔다. 저신뢰로 거절된
 *   소수 재질문이 일시정지→재시작만 거치면 화면 `data-reason`이 **사실과 다른 사유**가 된다.
 *   M3가 그 인자를 만든 이유가 정확히 이것인데 이 재기록만 안 쓰고 있었다.
 * ② **#11 M6의 두 번째 소비자** — `trendEvaluate`가 `!freshIndex`를 그대로 stale로 읽었다.
 *   M6가 설정 요약에서 기각한 그 술어다: **TTL만 지난 자기 조회**는 백업이 아니다.
 *   출처 판정을 `readIndexWithProvenance`(M6가 세운 SSOT)로 통일했다.
 * ③ **#12 unqueryable dedupe 키** — 사유 하나로만 dedupe해, 스키마를 고쳤다가 **다른 스키마에서
 *   같은 사유로 또 막히면** 앱 수명 내내 두 번째가 안 남았다. 형제 `staleKey`의 계약
 *   (*"답이 바뀌면 다시 기록돼야 한다 — 그건 새 사건이다"*)과 어긋나 있었다.
 * ④ **#13 fit deps** — `ReaskCue`는 정수부가 실리면 훨씬 긴 문구를 그리는데 `reaskReason`은
 *   그 전환에서 값이 안 바뀐다(`'parse_failed'` 그대로) → 재측정이 안 돌아 낡은 배율로 그린다.
 *
 * ②③④는 `[node]` 소스 계약이다 — ②는 TTL 만료를 e2e로 만들려면 시간을 조작해야 하고(그러면
 * 오라클이 시계에 종속된다), ③④는 렌더 결과가 아니라 **배선**이 계약이기 때문이다.
 * ①은 실제 화면 속성으로 잰다.
 */

import { test, expect, type Page } from '@playwright/test';
import { boot, PHONE_402, PREV_ROUND, SETTINGS as AZ_SETTINGS } from './fixtures/activeZones';
import { fireStt, waitForTtsIdle } from './fixtures/stt';

test.setTimeout(120_000);

const COLS = [
  { id: 'cd', name: '조사일자', type: 'date', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '오늘' }, sampleKey: false },
  { id: 'cf', name: '농가명', type: 'text', input: 'auto', ttsAnnounce: false, auto: { kind: 'fixed', value: '이원창' }, sampleKey: true },
  { id: 'c0', name: '조사나무', type: 'int', input: 'auto', ttsAnnounce: true, auto: { kind: 'seq', from: 1, to: 1 }, sampleKey: true },
  { id: 'm1', name: '측정항목01', type: 'float', input: 'voice', ttsAnnounce: true, auto: { kind: 'fixed', value: '' }, decimals: 1, sampleKey: false },
];

const bootZ9 = (page: Page) => boot(page, PHONE_402, {
  settings: {
    ...AZ_SETTINGS,
    state: { ...AZ_SETTINGS.state, columns: COLS, totalRows: 1, sessionAutoLabel: 'r5-z9' },
  } as unknown as typeof AZ_SETTINGS,
  headers: ['조사일자', '농가명', '조사나무', '측정항목01'],
  sheetRows: [[PREV_ROUND, '이원창', '1', '100.0']],
});

const cue = (page: Page) => page.locator('[data-testid="reask-cue"]');

test('① 저신뢰로 선 소수 문맥은 재개(일시정지→재시작) 후에도 사유를 유지한다 (#10)', async ({ page }) => {
  await bootZ9(page);

  // 소수 문맥을 세운다(parse_failed) → 그 위에서 **저신뢰 명령 거절**로 사유를 low_confidence로 바꾼다.
  await fireStt(page, '백십일 점 에', 1800);
  await waitForTtsIdle(page);
  await expect(cue(page), '전제: 소수 문맥이 섰다').toContainText('111 점, 소수점 아래');
  await fireStt(page, '수정', 1500, 0.2); // 저신뢰 명령 거절 → 사유 low_confidence로 재기록
  await waitForTtsIdle(page);
  await expect(cue(page), '전제: 사유가 저신뢰로 바뀌었다').toHaveAttribute('data-reason', 'low_confidence');

  // 재개 경로가 `armLanding`의 소수 재기록을 탄다.
  await fireStt(page, '일시 정지', 1500);
  await waitForTtsIdle(page);
  await fireStt(page, '재시작', 2000);
  await waitForTtsIdle(page);

  await expect(cue(page), '재개 후 소수 문맥이 사라졌다').toContainText('111 점, 소수점 아래');
  await expect(
    cue(page),
    '재개가 사유를 parse_failed로 굳혔다 — 화면이 거절 사유를 사실과 다르게 말한다',
  ).toHaveAttribute('data-reason', 'low_confidence');
});

test('[node] ② trend 출처 판정이 M6 SSOT를 쓴다 — TTL만 지난 자기 조회를 백업으로 세지 않는다 (#11)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync('src/lib/trendEvaluate.ts', 'utf-8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  expect(code, 'M6가 세운 출처 SSOT를 쓰지 않는다').toContain('readIndexWithProvenance()');
  expect(code, '출처 판정을 `stale` 플래그로 하지 않는다').toContain('src!.stale');
  // 🔴 종전 술어(`!freshIndex`)를 **계측 조건**으로 되돌리면 M6가 닫은 과대집계가 재발한다.
  expect(
    code.slice(code.indexOf('if (!freshIndex)')),
    '갱신 nudge와 계측을 다시 한 조건으로 묶었다 — TTL 만료가 stale로 다시 세어진다',
  ).not.toMatch(/if \(!freshIndex\) \{\s*const builtAt/);
  // 갱신 nudge 자체는 종전 계약대로 남아 있어야 한다(좁힌 것은 계측뿐이다).
  expect(code, '신선 캐시 없을 때의 재시도 nudge가 사라졌다(v0.14.0 A 계약)').toContain('ensurePastIndex()');
});

test('[node] ③ unqueryable dedupe 키가 스키마 축을 포함한다 (#12)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync('src/components/settings/SettingsSummaryModal.tsx', 'utf-8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  const keyLine = code.slice(code.indexOf('const unqueryableKey'), code.indexOf('const unqueryableReason'));
  expect(keyLine, 'dedupe 키가 사유 단독이다 — 다른 스키마의 같은 사유가 영영 안 남는다').toContain('roundDateColId');
  expect(keyLine, '고정 키 컬럼 구성이 키에 없다').toContain('sampleKey');
  expect(code, 'dedupe 집합이 키가 아니라 사유로 채워진다').toContain('unqueryableLogged.add(unqueryableKey)');
  // 로그 바이트는 불변이어야 한다(§4) — 사유 단독.
  expect(code, '로그 extra 바이트가 바뀌었다(SOP-003 파서 계약)')
    .toContain('past_index_unqueryable:summary,reason=${unqueryableReason}');
});

test('[node] ④ 소수 정수부가 fit deps에 있다 — 두 거절 표면 모두 (#13)', async () => {
  const fs = await import('node:fs');
  for (const path of ['src/components/voice/VoiceHero.tsx', 'src/components/voice/ModifyIndicatorPill.tsx']) {
    const src = fs.readFileSync(path, 'utf-8');
    const from = src.indexOf('useFitGroup<HTMLDivElement>(');
    expect(from, `${path}: fit 그룹을 찾지 못했다`).toBeGreaterThan(0);
    const deps = src.slice(from, from + src.slice(from).indexOf(']'));
    const depsCode = deps.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(depsCode, `${path}: reaskReason이 fit 축에서 빠졌다(r3 #5 계약)`).toContain('reaskReason');
    expect(
      depsCode,
      `${path}: 정수부가 fit 축에 없다 — 사유는 안 바뀌고 문구만 길어지는 전환에서 재측정이 안 돈다`,
    ).toContain('decimalWhole');
  }
});
