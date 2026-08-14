/**
 * v0.49 r7 #7 판정 오라클(codex r6#11 · 🔴 민구 컬럼명 계약 정정 2026-08-14 반영)
 *   — **Y10 무효화는 행 수가 실제로 바뀌는 편집에서만 발동한다. 과잉 아니다 → 무수정.**
 *
 * 리뷰 r6#11의 우려는 「Y10의 생성 상태 무효화가 과잉 — rename 같은 편집에서도 발동한다」였다.
 * 민구 계약 정정으로 그 시나리오의 전제부터 바뀌었다: 앱은 **로드 시점의 컬럼명만 준수**하고
 * 컬럼명 변경은 원본 스프레드시트에서 하며, 과거값 비교도 이름 불일치 시 **비교 불가 처리로 충분**
 * ("로직은 그게 맞다"). 그래서 재검증의 질문은 하나로 좁혀졌다 —
 * **행 수가 변하지 않는 편집에서 무효화가 오발동하는가?**
 *
 * 답은 «아니다»이고, 근거는 **불변식 하나**다:
 *   ⓐ 가드 술어가 `computeTotalRows(columns) !== state.totalRows`다 — 행 수를 직접 비교한다.
 *   ⓑ `totalRows`의 **쓰기 주체가 하나뿐**이고(`onGenerateConfirm`) 그 값이
 *      `computeTotalRows(s.columns)`다. 즉 생성 직후 두 항은 **정의상 같다.**
 *   ⓒ `computeTotalRows`는 `isCycling`/`spanOf`만 본다 — 이름·음성확인·추세규칙·소수자리 편집은
 *      그 값을 바꾸지 않는다(③이 실측).
 *   ⓐ+ⓑ+ⓒ ⇒ 일관 상태에서 행수 불변 편집은 **구조적으로** 가드를 통과할 수 없다.
 *
 * ⚠️ 두 항이 이미 어긋난 상태(Y10 이전에 범위를 편집해 `totalRows`가 낡은 채로 영속된 사용자)
 *   에서는 **어떤 편집이든** 무효화가 발동한다. 그건 오발동이 아니라 **밀린 발동**이다 —
 *   그 상태의 생성 스냅샷은 이미 컬럼과 불일치하고, Y10의 목적이 정확히 「사용자가 다시
 *   확인하게 한다」이기 때문이다. 이 성질을 몰라서 「rename이 생성을 되돌렸다」로 읽으면
 *   가드를 좁히게 되고, 그러면 Y10이 닫은 축(끝 도달 판정과 실제 조사 대상의 괴리)이 다시 열린다.
 *
 * 👉 판정: **무수정.** 이 파일은 위 불변식을 잠근다 — ⓑ가 깨지는 순간(`totalRows`에 두 번째
 *   쓰기 주체가 생기는 순간) 무효화는 진짜로 과잉이 된다. 그때 red가 나야 한다.
 */

import { test, expect } from '@playwright/test';
import { computeTotalRows } from '../src/lib/autoValue';
import type { Column } from '../src/types';

function col(over: Partial<Column>): Column {
  return {
    id: 'c1', name: 't', type: 'int', input: 'auto', ttsAnnounce: false,
    auto: { kind: 'fixed', value: '' }, ...over,
  };
}

async function read(path: string): Promise<string> {
  const fs = await import('node:fs');
  return fs.readFileSync(path, 'utf-8');
}

test('[node] ① `totalRows`의 쓰기 주체는 하나이고 그 값은 computeTotalRows다', async () => {
  // v0.49 R1 P1-2 — onGenerateConfirm이 useSettingsActions.ts에서 서브 훅으로 이동.
  const actions = await read('src/lib/useSettingsTableGeneration.ts');
  expect(
    actions,
    '생성이 computeTotalRows 말고 다른 수를 쓰면 가드의 두 항이 처음부터 어긋나 모든 편집이 무효화된다',
  ).toContain('s.set({ tableGenerated: true, totalRows: total, sessionAutoLabel })');
  expect(actions).toContain('const total = computeTotalRows(s.columns);');

  // 두 번째 쓰기 주체가 생기면 이 불변식이 깨진다 — 그 순간 무효화는 진짜로 과잉이 된다.
  const writers = (await Promise.all(
    // v0.49 R1 P1-2 — 설정탭 훅이 4파일로 갈렸다. 쓰기 주체 스캔은 그 전부를 덮는다.
    ['src/lib/useSettingsActions.ts', 'src/lib/useSettingsSheetConnection.ts',
      'src/lib/useSettingsTableGeneration.ts', 'src/lib/useSettingsReset.ts',
      'src/stores/settingsStore.ts', 'src/screens/SettingsScreen.tsx']
      .map(read),
  )).join('\n').match(/totalRows:\s*(?!d\.totalRows|state\.totalRows)[A-Za-z0-9_(.]+/g) ?? [];
  expect(
    writers.filter((w) => !/totalRows:\s*(?:number|50)/.test(w)),
    '`totalRows`에 쓰는 곳이 늘었다 — 가드의 전제(생성 직후 두 항이 같다)가 깨졌는지 확인하라',
  ).toEqual(['totalRows: total']);
});

test('[node] ② 무효화 가드는 행 수를 직접 비교한다(이름·표시 옵션을 보지 않는다)', async () => {
  const store = await read('src/stores/settingsStore.ts');
  const guards = store.match(/state\.tableGenerated && computeTotalRows\(columns\) !== state\.totalRows/g) ?? [];
  expect(
    guards.length,
    '세 액션(updateColumn·addColumn·removeColumn)이 같은 술어를 쓴다 — 하나라도 다르면 축이 갈린다',
  ).toBe(3);
  expect(store, '되돌리는 것은 생성 상태뿐이다(행 수를 몰래 다시 쓰지 않는다)')
    .toContain('{ tableGenerated: false }');
});

test('행수 불변 편집은 computeTotalRows를 바꾸지 않는다 — 무효화가 발동할 수 없다', () => {
  const cyc = col({ id: 'c0', auto: { kind: 'seq', from: 1, to: 5 } });
  const other = col({ id: 'm1', name: '측정항목01', type: 'float', input: 'voice' });
  const base = [cyc, other];
  expect(computeTotalRows(base), '전제: 생성 시점 스냅샷').toBe(5);

  // 민구 계약상 앱이 만질 수 있는 축들 — 전부 행 수 불변이다.
  expect(computeTotalRows([{ ...cyc, name: '조사나무(변경)' }, other]), '이름').toBe(5);
  expect(computeTotalRows([{ ...cyc, ttsAnnounce: true }, other]), '음성확인').toBe(5);
  expect(computeTotalRows([cyc, { ...other, decimals: 2 }]), '소수자리').toBe(5);
  expect(computeTotalRows([cyc, { ...other, trendRule: 'increase' }]), '추세규칙').toBe(5);
  expect(computeTotalRows([cyc, { ...other, sampleKey: true }]), '샘플키').toBe(5);
  expect(
    computeTotalRows([...base, col({ id: 'c9', name: '새 항목', type: 'text' })]),
    '비순환 컬럼 추가(addColumn 기본값)',
  ).toBe(5);
});

test('행수가 실제로 변하는 편집만 값이 달라진다 — Y10이 잡아야 하는 축', () => {
  const cyc = col({ id: 'c0', auto: { kind: 'seq', from: 1, to: 5 } });
  const other = col({ id: 'm1', type: 'float', input: 'voice' });
  expect(computeTotalRows([{ ...cyc, auto: { kind: 'seq', from: 1, to: 3 } }, other]), '범위 축소').toBe(3);
  expect(computeTotalRows([other]), '순환 컬럼 삭제').toBe(1);
  expect(
    computeTotalRows([cyc, other, col({ id: 'c2', auto: { kind: 'seq', from: 1, to: 2 } })]),
    '순환 컬럼 추가 — 행 수는 곱해진다',
  ).toBe(10);
});
