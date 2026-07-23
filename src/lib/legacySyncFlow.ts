/**
 * v0.38.0 [리뷰#6 Critical] — 대상(target) 없는 legacy 세션의 목적지 확정 흐름(순수 로직).
 *
 * ⚠️ 핵심 불변식: **업로드 이력이 있는 세션은 반드시 하나씩 묻는다.**
 * `assignLegacySessionTarget(_, _, 'same-sheet')`는 기존 `sheetRow`를 그대로 보존한다. 여러 세션을
 * 한 번에 묶어 물으면 A시트 42행에 올렸던 세션과 B시트 17행에 올렸던 세션이 **같은 답**을 받고,
 * B 세션이 A target + `sheetRow:17`을 얻어 **다른 농가의 17행을 덮어쓴다**. 혼합 배치에는 안전한
 * 단일 답이 존재하지 않으므로 세션별로 답을 받는 것 외에 방법이 없다.
 *
 * 업로드 이력이 없는 세션은 좌표가 없어 어느 답이든 append다 — 교차 오염이 불가능하므로 묶어서
 * 한 번만 확인받는다(질문 수를 불필요하게 늘리지 않는다).
 *
 * UI/로직 분리(GL-006 §7~8): 상태 전이는 여기서 순수 함수로 고정하고, 훅은 IDB 저장·팝업 배선만 한다.
 */
import type { Session, SessionTarget } from '../types';
import { sessionEverUploaded } from './sessionSync';

export interface LegacySyncPrompt {
  /** 동기화 대상 전체(legacy가 아닌 세션 포함) — 확인이 끝나면 이 목록으로 동기화한다. */
  ids: string[];
  autoDelete: boolean;
  target: SessionTarget;
  targetLabel: string;
  /** 업로드 이력이 있어 **세션별 확인**이 필요한 대기열. 앞에서부터 하나씩 묻는다. */
  pending: string[];
  /** 업로드 이력이 없는 legacy 세션 — 좌표 위험 없음, 마지막에 한 번만 확인한다. */
  plain: string[];
  /** 지금 묻고 있는 세션이 어느 것인지 화면에 밝힌다. `pending`이 비면 빈 문자열. */
  currentLabel: string;
  /** 진행 표시("2/3"). */
  askedIndex: number;
  /** `pending` 소진까지의 총 질문 수. */
  askTotal: number;
}

/** 팝업 본문에 쓰는 세션 식별 라벨 — 어느 세션의 대상을 고르는지 사용자가 알아야 한다. */
export function legacySessionLabel(s: Session): string {
  return `${s.date} 세션 · ${s.completedRows}행${s.label ? ` (${s.label})` : ''}`;
}

/** 동기화 선택분에서 legacy 세션을 갈라 첫 질문 상태를 만든다. legacy가 없으면 null(=바로 동기화). */
export function buildLegacySyncPrompt(
  sessions: Session[],
  ids: string[],
  autoDelete: boolean,
  target: SessionTarget,
  targetLabel: string,
): LegacySyncPrompt | null {
  const legacy = sessions.filter((s) => !s.target);
  if (legacy.length === 0) return null;
  const uploaded = legacy.filter(sessionEverUploaded);
  const plain = legacy.filter((s) => !sessionEverUploaded(s));
  return {
    ids,
    autoDelete,
    target,
    targetLabel,
    pending: uploaded.map((s) => s.id),
    plain: plain.map((s) => s.id),
    currentLabel: uploaded.length > 0 ? legacySessionLabel(uploaded[0]) : '',
    askedIndex: 1,
    askTotal: uploaded.length,
  };
}

/** 한 세션의 답을 받은 뒤의 다음 상태. null이면 확인이 끝났다는 뜻(=동기화 시작).
 *  `sessions`는 라벨을 만들기 위한 현재 목록이다. */
export function advanceLegacySyncPrompt(
  prompt: LegacySyncPrompt,
  sessions: Session[],
): LegacySyncPrompt | null {
  const [current, ...rest] = prompt.pending;
  if (!current) return null;               // plain 단계까지 끝났다.
  if (rest.length > 0) {
    const next = sessions.find((s) => s.id === rest[0]);
    return {
      ...prompt,
      pending: rest,
      currentLabel: next ? legacySessionLabel(next) : '',
      askedIndex: prompt.askedIndex + 1,
    };
  }
  // 좌표 있는 세션을 다 물었다 — 좌표 없는 나머지의 확인만 이어서 받는다.
  if (prompt.plain.length > 0) return { ...prompt, pending: [], currentLabel: '' };
  return null;
}
