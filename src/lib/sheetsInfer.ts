/**
 * 시트 표본 → `Column[]` 유추 (순수 함수 — 네트워크·브라우저 의존 없음).
 *
 * [ENV-12] `sheets.ts`에서 분리했다(2026-08-15). 경계는 **네트워크 경계**다: 이 파일은 이미
 * 받아온 헤더·표본 문자열만 보고 컬럼 형태를 판정하고, HTTP를 아는 코드는 `sheets.ts`에 남는다.
 * 그래서 여기 함수들은 토큰·API key 없이 Node 단위 테스트로 그대로 잰다
 * (`tests/sheets-infer-columns.spec.ts` · `tests/v0460-wp-j-options.spec.ts`).
 *
 * ⚠️ import 방향은 **단방향**이다 — 이 파일은 `sheets.ts`를 import하지 않는다.
 * (`sheets.ts`가 `uniqueValuesRecentFirst`를 쓰고 `inferColumns`·`preserveInferredColumnIds`를
 *  재수출한다. 역방향이 생기면 `[LOGEVENTS-CYCLE-1]`과 같은 배럴 순환이 된다.)
 */
import type { Column, DataType } from '../types';

/**
 * 값 목록 → 고유값, **최근 등장 우선**(마지막에 나온 값이 맨 앞).
 *
 * v0.46.0 WP-J J-1 (민구 R12 확정) — 종전 **빈도순**을 대체한다. 빈도순은 "옛날에 많이 쓴 값"을
 * 위로 올려, 오늘 새로 조사한 농가가 목록 끝으로 밀렸다. 정렬은 눈에 보이지 않는 계약이라
 * 오라클(tests/v0460-wp-j-options.spec.ts)이 이 함수를 직접 잰다 — 없으면 빈도순으로 조용히
 * 되돌아가도 아무도 모른다.
 *
 * ⚠️ 정규화하지 않는다. `신례리 1365-1`(공백 있음)과 `신례리816-1`(공백 없음)은 **서로 다른 값**으로
 * 남는다(J-6) — 손입력 표기 흔들림일 수도, 진짜 다른 농가일 수도 있어 앱이 판단할 근거가 없다.
 * 합치는 것은 사용자의 몫이고, 그 수단이 J-4의 선택지 삭제다.
 */
export function uniqueValuesRecentFirst(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = values.length - 1; i >= 0; i--) {
    const v = (values[i] ?? '').toString().trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** Guess a DataType from a string sample value */
function guessType(value: string): DataType {
  const v = value.trim();
  if (!v) return 'text';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(v)) return 'date';
  if (/^-?\d+$/.test(v)) return 'int';
  if (/^-?\d+\.\d+$/.test(v)) return 'float';
  return 'text';
}

/**
 * 🔴 v0.46.0 콜드 리뷰 L2-1(critical) 처방 — **text 컬럼의 리스트 승격 판정 기준.**
 *
 * **평균 반복 횟수**(채워진 값 수 ÷ 고유값 수)가 이 값 이상이면 「반복 사용되는 선택지」로 보고
 * `options`로 승격한다. 미달이면 **자유서술 칸**이므로 승격하지 않고 수동 입력으로 둔다.
 *
 * 🔑 **왜 「절대 개수」가 아니라 「반복성」인가** — 종전 `uniqVals.size <= 20`이 이 자리에 있었고,
 * J-2가 그 상한을 폐지하자(농가 21곳 절벽 제거, 민구 R7-b) **자유서술 컬럼의 보호막까지 함께
 * 사라졌다.** 08-06 콜드 리뷰 실측: 다른 스키마 시트의 메모 칸이 `options`+`input:'auto'`로 승격돼
 * **「가장 최근 값」이 전 행에 합성돼 시트에 기록**됐다. 절대 개수는 시트 크기에 따라 의미가
 * 바뀌므로 두 요구(*"농가 21곳은 리스트로 남는다"* · *"메모 칸은 승격되지 않는다"*)를 동시에
 * 만족시킬 수 없다. **반복성은 만족시킨다.**
 *
 * **실측 근거**(민구 시트 2,902행 · 08-05 WP-A 진단 §시트 실측 + 08-06 콜드 리뷰):
 * | 컬럼 성격 | 고유값 | 평균 반복 | 판정 |
 * |---|---|---|---|
 * | 조사과실(자동입력) | 5 | **580회** | 승격 |
 * | 농가명 21곳(J-2가 살리려던 것) | 21 | **138회** | 승격 |
 * | 자유서술 메모 | 2,902 | **1.0회** | 승격 안 함 |
 * → 임계 `2`는 살릴 쪽 최솟값(138)의 **1/69**이고 막을 쪽(1.0)의 **2배**다. 양쪽 마진이 크다.
 *
 * ⚠️ 표본은 **시트 전량**이다(J-1이 `A1:Z1001` 상한을 없앴다) — 비율이 실제 비율이다.
 * ⚠️ 값이 **하나뿐**인 컬럼은 이 판정 앞에서 `fixed`로 갈린다(기존 동작 유지).
 * 🔴 **이 값을 만지려면 위 표를 다시 재라.** 근거 없는 리터럴이 이 결함의 출발이었다.
 */
const OPTIONS_MIN_REPEAT = 2;

/**
 * Build Column[] from sheet header + sample data.
 * Heuristics:
 *  - If majority of samples are date/int/float → that type, mode 'voice' for numeric.
 *  - If text and values repeat (≥ OPTIONS_MIN_REPEAT on average) → 'options' with available pre-filled.
 *  - If text and values barely repeat → 자유서술 칸: 'text' + input 'touch' (사람이 채운다).
 *  - Otherwise → 'text', input 'auto', ttsAnnounce false.
 */
export function inferColumns(headers: string[], sample: string[][]): Column[] {
  const seenNames = new Map<string, number>();
  return headers.map((name, ci) => {
    const normalizedName = normalizeHeaderName(name || `열 ${ci + 1}`);
    const occurrence = (seenNames.get(normalizedName) ?? 0) + 1;
    seenNames.set(normalizedName, occurrence);
    const samples = sample.map((row) => row[ci]).filter(Boolean);
    let type: DataType = 'text';
    if (samples.length) {
      const counts: Record<DataType, number> = { date: 0, text: 0, int: 0, float: 0, options: 0, name: 0 };
      samples.forEach((v) => {
        counts[guessType(v)]++;
      });
      type = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as DataType) || 'text';
    }

    let auto: Column['auto'] = { kind: 'fixed', value: '' };
    let input: 'auto' | 'voice' | 'touch' = 'auto';
    let ttsAnnounce = false;
    let decimals: number | undefined;

    const filledVals = samples.map((v) => v.trim()).filter(Boolean);
    const uniqVals = new Set(filledVals);

    if (type === 'int' || type === 'float') {
      const nums = samples.map(Number).filter((n) => !isNaN(n));

      if (type === 'float') {
        const maxDec = samples.reduce((max, s) => {
          const dot = s.indexOf('.');
          return dot >= 0 ? Math.max(max, s.length - dot - 1) : max;
        }, 1);
        decimals = maxDec;
      }

      if (uniqVals.size === 1) {
        input = 'auto';
        ttsAnnounce = false;
        auto = { kind: 'fixed', value: [...uniqVals][0] };
      } else if (nums.length >= 5) {
        const sorted = [...new Set(nums)].sort((a, b) => a - b);
        const isSeq = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
        if (isSeq) {
          input = 'auto';
          ttsAnnounce = true;
          auto = { kind: 'seq', from: sorted[0], to: sorted[sorted.length - 1] };
        } else {
          input = 'voice';
          ttsAnnounce = true;
          auto = { kind: 'fixed', value: '' };
        }
      } else {
        input = 'voice';
        ttsAnnounce = true;
        auto = { kind: 'fixed', value: '' };
      }
    } else if (type === 'date') {
      input = 'auto';
      ttsAnnounce = false;
      auto = { kind: 'fixed', value: '오늘' };
    } else if (type === 'text') {
      if (uniqVals.size === 1) {
        auto = { kind: 'fixed', value: [...uniqVals][0] };
        input = 'auto';
      } else if (uniqVals.size > 0 && filledVals.length / uniqVals.size >= OPTIONS_MIN_REPEAT) {
        // v0.46.0 WP-J J-2 (민구 R7-b: "리스트는 무한") — 종전 `uniqVals.size <= 20` 상한을
        // 폐지했다. 농가가 21곳이 되는 순간 리스트가 통째로 사라지던 절벽을 없앤다.
        // 🔑 목록이 길어지는 문제는 상한이 아니라 J-4의 **선택지 삭제**가 푼다(제외 목록 = J-5).
        type = 'options';
        // 최근 등장 우선 — fetchColumnUniqueValues와 같은 정렬 계약을 표본 경로에도 적용한다.
        // 파생: 기본 선택값(slice(0,1))이 "표본에서 처음 본 값"이 아니라 "가장 최근에 쓴 값"이 된다.
        const available = uniqueValuesRecentFirst(samples);
        auto = { kind: 'options', available, selected: available.slice(0, 1) };
        input = 'auto';
      } else if (uniqVals.size > 0) {
        // 🔴 v0.46.0 콜드 리뷰 L2-1(critical) — **반복되지 않는 값은 선택지가 아니다.**
        //    사람이 그때그때 적는 칸(메모·특이사항)이다 → 민구 계약대로 **수동 입력**으로 둔다.
        auto = { kind: 'fixed', value: '' };
        input = 'touch';
      } else {
        auto = { kind: 'fixed', value: '' };
        input = 'auto';
      }
      ttsAnnounce = false;
    }

    // 항목명 기반 의미 기본값(파일/시트 불문):
    //  - "비고" → 터치 입력(메모). 사용자가 자유롭게 메모.
    // (v0.4.3 롤백: "농가명"/"이름" → '이름' 데이터형 강제는 제거. 세션명은 이름 문자열로 식별.)
    const trimmed = (name || '').trim();
    if (trimmed === '비고') input = 'touch';

    return {
      id: stableColumnId(name || `열 ${ci + 1}`, occurrence),
      name: name || `열 ${ci + 1}`,
      type,
      input,
      ttsAnnounce,
      auto,
      decimals,
    };
  });
}

function normalizeHeaderName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function stableColumnId(name: string, occurrence: number): string {
  const key = `${normalizeHeaderName(name)}#${occurrence}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `c${(hash >>> 0).toString(36)}`;
}

/**
 * Keep live/local session values addressable when the same sheet is re-analyzed.
 *
 * Pre-v0.30 columns used `Date.now()` IDs. If reconnecting the same sheet replaces every ID,
 * already-entered row values remain under the old IDs and later sync reads blanks. Preserve an
 * existing ID only when that column name is unique on both sides; duplicates fall back to the new
 * deterministic ID because name-only preservation would be ambiguous.
 */
export function preserveInferredColumnIds(inferred: Column[], existing: Column[]): Column[] {
  const existingByName = new Map<string, Column[]>();
  const inferredCounts = new Map<string, number>();
  for (const c of existing) {
    const key = normalizeHeaderName(c.name);
    existingByName.set(key, [...(existingByName.get(key) ?? []), c]);
  }
  for (const c of inferred) {
    const key = normalizeHeaderName(c.name);
    inferredCounts.set(key, (inferredCounts.get(key) ?? 0) + 1);
  }
  return inferred.map((c) => {
    const key = normalizeHeaderName(c.name);
    const candidates = existingByName.get(key) ?? [];
    if (candidates.length === 1 && inferredCounts.get(key) === 1) {
      return { ...c, id: candidates[0].id };
    }
    return c;
  });
}
