/**
 * v0.18.0 — 샘플 식별 라벨용 순수 셀렉터 (view 전용, SSOT 미러).
 *
 * 입력탭 hero 패널 상단의 "현재 샘플 식별 라벨"을 그리기 위한 순수 함수들이다.
 * `useVoiceSession.ts`의 announceRowDiff(:401)/announceRowComplete(:420)가 행을
 * 호명할 때 쓰는 **동일 술어**(`c.input === 'auto' && c.ttsAnnounce`)를 그대로 미러한다.
 *
 * 왜 미러인가(중복 아님): hook의 announce 루프는 TTS 발화를 만들고(side-effecting,
 * `say()` 의존), view는 화면 라벨만 그린다(읽기 전용). 같은 술어를 공유하되 hook 자체는
 * 건드리지 않는다(v0.17.0 레인 분리 회귀 가드 + 본 릴리스 zero-diff 가드). announce가
 * 호명하는 컬럼 집합과 view가 강조하는 컬럼 집합이 술어 한 곳에서 갈라지지 않도록,
 * 술어를 이 파일의 상수 `isAnnounceColumn`으로 단일화한다.
 *
 * 컬럼명 하드코딩 금지 — 다른 양식 스프레드시트에서도 `c.ttsAnnounce` 플래그만으로 동작한다.
 * 브라우저 의존이 없어 Node 단위 테스트에서 직접 import 가능(columnFlags.ts 패턴).
 */
import type { Column } from '../types';

/** announceRowDiff/announceRowComplete가 호명 대상으로 삼는 컬럼 술어(SSOT 미러). */
export function isAnnounceColumn(col: Pick<Column, 'input' | 'ttsAnnounce'>): boolean {
  return col.input === 'auto' && col.ttsAnnounce === true;
}

/** TTS 호명 대상(auto + ttsAnnounce) 컬럼만 추린다(원래 순서 보존). */
export function getAnnounceColumns(columns: Column[]): Column[] {
  return columns.filter(isAnnounceColumn);
}

export interface AnnounceLabelPart {
  col: Column;
  /** 현재 행에서의 자동값(buildCyclingValues 산출). */
  value: string;
  /**
   * 이전 행과 값이 달라 announceRowDiff가 호명하는 "순차적으로 변하는" 컬럼인지.
   * prevValues가 null(첫 행)이면 모든 비어있지 않은 값이 변화로 간주된다
   * (announceRowDiff의 `fromAuto === null` 분기와 동일).
   */
  changed: boolean;
}

/**
 * hero 샘플 라벨에 그릴 파트 목록을 만든다.
 *   - curValues/prevValues = buildCyclingValues(columns, row) / (row-1) 결과(view에서 주입).
 *   - 빈 값 컬럼은 제외(announce 루프의 `if (!tv) continue`와 동일).
 *   - changed = 이전 행과 값이 다른 컬럼(= announceRowDiff가 호명하는 순차변화 부분).
 * announceRowComplete(:420)와 동일하게 prevValues가 null이면 전부 변화로 본다.
 */
export function getSampleLabelParts(
  columns: Column[],
  curValues: Record<string, string>,
  prevValues: Record<string, string> | null,
): AnnounceLabelPart[] {
  const parts: AnnounceLabelPart[] = [];
  for (const c of getAnnounceColumns(columns)) {
    const tv = curValues[c.id] ?? '';
    if (!tv) continue;
    const fv = prevValues?.[c.id] ?? '';
    const changed = prevValues === null || fv !== tv;
    parts.push({ col: c, value: tv, changed });
  }
  return parts;
}
