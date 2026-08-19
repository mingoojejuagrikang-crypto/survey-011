/**
 * v0.50 [DECIMAL-DISPLAY-1] — **시트 셀 숫자 서식 계획**(순수 모듈).
 *
 * ## 민구 제보 (2026-08-19 07:30)
 * > *"값 입력시 실수는 소수점까지 저장. 예: 40 >> 40.0 / 각 항목마다 유효 소수점이 존재"*
 *
 * ## 🔴 왜 「문자열 패딩」이 아니라 「셀 서식」인가 — 함정이 실재한다
 * `appendRow`/`appendRows`가 `valueInputOption=USER_ENTERED`로 보낸다(`sheets.ts`).
 * 그러면 **`"40.0"` 문자열을 보내도 Sheets가 숫자 40으로 강제**하고 화면 표시는 셀 서식이 정한다.
 * 즉 값 쪽을 아무리 깎아도 시트에는 `40`으로 보인다 — **「고쳤는데 안 고쳐진」 형상**이다.
 * 👉 값은 숫자 그대로 두고(정렬·집계·차트가 살아 있어야 한다) **표시만** 자리수를 채운다.
 *
 * ## 무엇을 건드리고 무엇을 안 건드리나
 *  · `type === 'float'`이고 `decimals`가 있는 컬럼 **만**.
 *  · `int`·`text`·`date`는 손대지 않는다 — 정수에 `0.0`을 씌우면 되레 오해를 만들고,
 *    text/date는 숫자 서식의 대상이 아니다.
 *  · 헤더(1행)는 제외한다(`startRowIndex: 1`) — 헤더는 문자열이고, 서식을 씌울 이유가 없다.
 *
 * ## 로컬 `decimals`의 종전 역할
 * `col.decimals`는 지금까지 **입력 상한**으로만 쓰였다(`valueParseAttempt.ts` · `manualInput.ts`).
 * 저장·기록 포맷에는 관여하지 않는다 — 이 모듈이 그 값을 **표시 계약**으로 처음 확장한다.
 */

/** 로컬 컬럼 중 이 모듈이 보는 최소 형태(구조적 타이핑). */
export interface NumberFormatColumn {
  id: string;
  name: string;
  type?: string;
  decimals?: number;
}

/** 한 열에 적용할 서식 — `repeatCell` 요청 1건으로 변환된다. */
export interface NumberFormatSpec {
  /** 시트 헤더에서의 0-based 열 인덱스. */
  colIndex: number;
  /** 표시 자리수. */
  decimals: number;
  /** Sheets `numberFormat.pattern`. */
  pattern: string;
  /** 계측·디버깅용(요청에는 안 실린다). */
  columnName: string;
}

/** 자리수 → Sheets 패턴. 0이면 소수점을 붙이지 않는다(`'0'`). */
export function numberFormatPattern(decimals: number): string {
  const d = Math.max(0, Math.min(9, Math.floor(decimals)));
  return d === 0 ? '0' : `0.${'0'.repeat(d)}`;
}

/**
 * 헤더와 로컬 컬럼을 이름으로 맞춰 **서식을 씌울 열 목록**을 만든다.
 *
 * 🔑 위치가 아니라 **이름**으로 맞춘다 — `sync.ts`의 `mapColumnsToHeader`와 같은 계약이다.
 * 위치로 맞추면 시트 열 순서가 바뀐 순간 **남의 열에 서식을 씌운다**(값을 안 건드려도
 * 다른 팀의 표시를 깨는 건 같은 종류의 사고다).
 *
 * 헤더에 없는 컬럼은 조용히 건너뛴다 — 그 경고는 이미 sync가 `columnWarnings`로 낸다.
 */
export function planNumberFormats(
  columns: readonly NumberFormatColumn[],
  headers: readonly string[],
): NumberFormatSpec[] {
  const specs: NumberFormatSpec[] = [];
  const seen = new Set<number>();
  for (const col of columns) {
    if (col.type !== 'float') continue;
    if (col.decimals == null) continue;
    const colIndex = headers.indexOf(col.name);
    if (colIndex < 0) continue;
    // 같은 이름이 헤더에 두 번 있으면 `indexOf`가 늘 첫 번째를 준다 — 중복 요청만 막는다.
    if (seen.has(colIndex)) continue;
    seen.add(colIndex);
    specs.push({
      colIndex,
      decimals: col.decimals,
      pattern: numberFormatPattern(col.decimals),
      columnName: col.name,
    });
  }
  return specs;
}

/** Sheets `batchUpdate` 요청 본문(`repeatCell`)으로 변환한다.
 *  `fields`를 `userEnteredFormat.numberFormat`으로 좁혀 **다른 서식(색·테두리·글꼴)은 건드리지
 *  않는다** — 남의 시트 꾸밈을 지우는 건 데이터 사고와 같은 급의 신뢰 손상이다. */
export function buildNumberFormatRequests(sheetId: number, specs: readonly NumberFormatSpec[]): unknown[] {
  return specs.map((s) => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1, // 헤더 제외
        startColumnIndex: s.colIndex,
        endColumnIndex: s.colIndex + 1,
      },
      cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: s.pattern } } },
      fields: 'userEnteredFormat.numberFormat',
    },
  }));
}
