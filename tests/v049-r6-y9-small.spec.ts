/**
 * v0.49 r6 Y9~Y12 오라클(claude #10·#11·#12·#9) — 소형 4건.
 *
 * 넷 다 **배선이 계약**인 건이라 `[node]` 소스 계약으로 잠근다(fixr5 `v049-r5-z9-small`의 ②③④와
 * 같은 전례). 각 항목의 「왜 렌더 결과가 아니라 배선인가」는 테스트별 헤더에 적었다.
 */

import { test, expect } from '@playwright/test';

async function read(path: string): Promise<string> {
  const fs = await import('node:fs');
  return fs.readFileSync(path, 'utf-8');
}

/**
 * Y9(claude #10) — `CompleteSummary`의 fit **의존**에 `reaskReason`.
 *
 * 렌더로 재려면 「큐가 붙었을 때 `X / N`이 몇 px인가」를 봐야 하는데, 그 값은 fit 이진탐색의
 * 결과라 뷰포트·폰트 로딩에 흔들린다(UI-FIT 계열이 반복해 겪은 flake). 계약은 **재계산이
 * 트리거되는가** 하나뿐이므로 그 형태를 잠근다.
 */
test('[node] Y9 완료 요약의 fit 의존이 거절 큐를 포함한다', async () => {
  const src = await read('src/components/voice/CompleteSummary.tsx');
  const deps = src.slice(src.indexOf('useFitGroup<HTMLDivElement>('), src.indexOf('[\n      {'));
  expect(
    deps,
    '큐가 붙으면 컨테이너 높이가 줄어드는데 재계산이 안 돈다 — `X / N`이 낡은 배율로 남는다',
  ).toContain('reaskReason]');
});

/**
 * Y10(claude #11) — 행 수가 바뀌는 컬럼 편집은 **생성 상태를 무효화**한다.
 *
 * `totalRows`는 「생성」 시점의 `computeTotalRows(columns)` 스냅샷이다. 그 뒤 순환 컬럼의 범위를
 * 편집해도 종전에는 아무도 다시 세지 않아, `tableGenerated:true`인 채 화면·세션은 **옛 행 수**를
 * 쓰고 자동값 조합은 **새 span**을 따랐다. 세 액션(수정·추가·삭제)이 모두 행 수를 바꿀 수 있어
 * 하나라도 빠지면 그 경로로 같은 불일치가 다시 들어온다 — 그래서 **개수**를 센다.
 */
test('[node] Y10 컬럼 편집 세 액션이 행 수 변화 시 생성 상태를 되돌린다', async () => {
  const src = await read('src/stores/settingsStore.ts');
  const guards = src.match(/state\.tableGenerated && computeTotalRows\(columns\) !== state\.totalRows/g) ?? [];
  expect(
    guards.length,
    '컬럼 편집 액션 중 행 수 재검증이 빠진 곳이 있다(updateColumn · addColumn · removeColumn)',
  ).toBe(3);
  expect(src, '보수적 처방 — 되돌리는 것은 생성 상태뿐이다(행 수를 몰래 다시 쓰지 않는다)')
    .toContain('{ tableGenerated: false }');
});

/**
 * Y11(claude #12) — 조회 불가 계측의 dedupe 키가 **실제 판정 술어**를 쓴다.
 *
 * 이 키는 「같은 사유라도 스키마가 달라지면 새 사건」을 성립시키려고 Z9 #12가 넣었다. 그런데
 * 판정을 실제로 하는 `pastValues.fixedKeyColumns`는 `effectiveSampleKey`(columnFlags SSOT)를
 * 쓰는데 키만 원시 플래그 `c.sampleKey`를 읽어, **자동 유추로만 갈린 스키마 변경**이 여전히
 * 같은 키로 묶였다. 로그 방출은 세션·모듈 스코프 dedupe 뒤에 일어나 e2e로 재기 어렵다.
 */
test('[node] Y11 unqueryable dedupe 키가 effectiveSampleKey를 쓴다', async () => {
  const src = await read('src/components/settings/SettingsSummaryModal.tsx');
  // 주석이 옛 형태를 설명으로 인용하므로 **키 표현식 줄만** 본다.
  const keyLine = src.split('\n').find((l) => l.includes('${state.reason}:${roundDateColId'));
  expect(keyLine, 'dedupe 키 표현식을 못 찾았다 — 형태가 바뀌었으면 이 계약도 옮겨라').toBeTruthy();
  expect(keyLine!, 'dedupe 키가 원시 플래그를 읽는다 — 자동 유추로 갈린 스키마 변경이 삼켜진다')
    .toContain('effectiveSampleKey(c)');
  expect(keyLine!, '원시 플래그 사용이 남아 있다').not.toContain('c.sampleKey');
  // 판정 쪽 SSOT가 바뀌면 이 계약의 전제도 바뀐다 — 함께 갱신하라는 신호.
  expect(await read('src/lib/pastValues.ts'), '판정 술어가 더 이상 effectiveSampleKey가 아니다')
    .toContain('columns.filter((c) => effectiveSampleKey(c))');
});

/**
 * Y12(claude #9) — 단조 가드 분기가 **낡은 스냅샷으로 세션을 되돌리지 않는다.**
 *
 * `mySeq < persistAppliedSeqRef.current`는 「내 스냅샷은 낡았다」는 판정이다. 그 상태에서
 * `upsertSession(session)`을 하면 더 나중 persist가 이미 반영한 값을 옛 값으로 덮는다 —
 * 단조 가드가 막으려던 바로 그 일을 가드 안에서 한 셈이다. 그럼에도 걷어야 하는 것은
 * `pendingValidationPersisting`(=[확인]을 막는 UI 잠금)뿐이라, 그 플래그만 벗긴다.
 * 재현하려면 두 persist의 완료 순서를 뒤집고 그 사이에 후보를 세워야 해서 e2e 비용이 크다.
 */
test('[node] Y12 단조 가드 분기는 게이트 플래그만 벗긴다', async () => {
  const src = await read('src/lib/useVoiceSession.ts');
  const branch = src.slice(
    src.indexOf('if (mySeq < persistAppliedSeqRef.current) {'),
    src.indexOf('persistAppliedSeqRef.current = mySeq;'),
  );
  expect(branch, '낡은 스냅샷을 그대로 다시 올린다 — 나중 persist의 값이 되돌아간다')
    .not.toContain('upsertSession(session)');
  expect(branch, '게이트 플래그를 걷지 않으면 [확인]이 영구히 막힌다')
    .toContain('pendingValidationPersisting: _drop');
});
