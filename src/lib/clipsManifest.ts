/**
 * v0.27.0 — export zip 동봉용 `clips-manifest.json` 빌더 (클립 감사 SOP-003 §3 자동화).
 *
 * 클립 파일 ↔ 커밋값(sessions.json) ↔ STT 텍스트/confidence(events.json) ↔ 종류(파일명 서픽스)를
 * 한 매핑으로 묶는다. 분석 세션이 zip만 열고도 "어느 클립이 어느 셀의 몇 번째 시도이고,
 * 최종 커밋값·마지막 인식 결과가 무엇이었는지"를 코드로 join할 수 있게 한다.
 *
 * 설계 원칙:
 * - **순수 계층** — IDB/Drive/import.meta.env 의존 없음(sessionSnapshot.ts 패턴).
 *   Node 단위 테스트(tests/v027-clips-manifest.spec.ts)에서 직접 검증 가능.
 * - **추측 금지, 정직한 null** — sessions/events에서 매칭이 안 되면 null. 키 파싱이 안 되는
 *   클립도 버리지 않고 kind:'unknown' + null 필드로 그대로 실어 감사가 누락을 보게 한다.
 * - **additive** — 기존 zip 구조(device/events/sessions/clips)는 불변, 파일 하나만 추가.
 *   복구(restoreSessionsFromZip)는 clips/ 프리픽스만 읽으므로 영향 없음.
 *
 * 클립 키 규약(useVoiceSession.ts가 SSOT, 여기선 파싱만):
 *   `<sessionId>:<row>:<colId>`            → 최종 커밋 발화(kind 'final')
 *   `<sessionId>:<row>:<colId>:a<N>`       → 정정으로 보관된 N번째 시도(kind 'a<N>')
 *   `<sessionId>:<row>:<colId>:cmd<N>`     → 명령 발화(kind 'cmd<N>')
 *   `... :raw`                             → 트림 전 원본(kind에 ':raw' 서픽스, 단독이면 'raw')
 *   sessionId는 `sess_<ts>` 형태(콜론 없음), colId는 `c<N>` 형태 — split(':') 파싱 안전.
 */
import type JSZip from 'jszip';
import type { Session } from '../types';

export const CLIPS_MANIFEST_SCHEMA = 1;
export const CLIPS_MANIFEST_FILENAME = 'clips-manifest.json';

/** events.json 항목 중 manifest가 읽는 최소 형상(LogEntry의 부분집합 — 방어적 접근). */
export interface ManifestSourceEvent {
  type?: unknown;
  sessionId?: unknown;
  row?: unknown;
  colId?: unknown;
  text?: unknown;
  parsed?: unknown;
  confidence?: unknown;
}

export interface ClipManifestEntry {
  /** zip 내 경로 (예: `clips/sess_1:1:c8.wav`). */
  file: string;
  sessionId: string;
  /** 키 파싱 실패 시 null. */
  row: number | null;
  colId: string | null;
  /** 'final' | 'a<N>' | 'cmd<N>' | 'raw' | 'a<N>:raw' | 'cmd<N>:raw' | 'unknown'(키 형식 불일치). */
  kind: string;
  /** sessions.json의 해당 row/col 최종값. 세션/행/컬럼 매칭 실패 시 null ('' 는 실값으로 보존). */
  committedValue: string | null;
  /** 해당 셀의 마지막 value/stt 이벤트의 원문 text. 매칭 실패 시 null. */
  sttText: string | null;
  /** 위 이벤트의 confidence. 이벤트가 없거나 confidence 미탑재(iOS 등) 시 null. */
  confidence: number | null;
}

export interface ClipsManifest {
  schema: number;
  appVersion: string;
  generatedAt: string;
  clipCount: number;
  clips: ClipManifestEntry[];
}

interface ParsedClipKey {
  sessionId: string;
  row: number | null;
  colId: string | null;
  kind: string;
}

/** 클립 IDB 키 → sessionId/row/colId/kind. 형식이 어긋나면 null 필드 + kind 'unknown'. */
export function parseClipKey(key: string): ParsedClipKey {
  const parts = key.split(':');
  const sessionId = parts[0] ?? '';
  const row = parts.length >= 3 ? Number(parts[1]) : NaN;
  if (parts.length < 3 || !Number.isFinite(row) || parts[2] === '') {
    return { sessionId, row: null, colId: null, kind: 'unknown' };
  }
  const suffixes = parts.slice(3);
  // 서픽스는 a<N> / cmd<N> / raw 만 알려져 있다. 모르는 서픽스도 버리지 않고 그대로 실어
  // (추측 금지) 감사가 신종 키를 발견할 수 있게 한다.
  const kind = suffixes.length === 0 ? 'final' : suffixes.join(':');
  return { sessionId, row, colId: parts[2], kind };
}

function findCommittedValue(
  sessions: Session[],
  sessionId: string,
  row: number | null,
  colId: string | null,
): string | null {
  if (row === null || colId === null) return null;
  const session = sessions.find((s) => s && s.id === sessionId);
  if (!session || !Array.isArray(session.rows)) return null;
  const r = session.rows.find((x) => x && x.index === row);
  const v = r?.values?.[colId];
  return v === undefined ? null : v;
}

function findLastCellEvent(
  events: ManifestSourceEvent[],
  sessionId: string,
  row: number | null,
  colId: string | null,
): { sttText: string | null; confidence: number | null } {
  if (row === null || colId === null) return { sttText: null, confidence: null };
  // events.json은 append 순서(시간순) — 배열 뒤에서부터 첫 매칭이 "마지막" 이벤트.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || (e.type !== 'value' && e.type !== 'stt')) continue;
    if (e.sessionId !== sessionId || e.row !== row || e.colId !== colId) continue;
    return {
      sttText: typeof e.text === 'string' ? e.text : null,
      confidence: typeof e.confidence === 'number' ? e.confidence : null,
    };
  }
  return { sttText: null, confidence: null };
}

/** zip 내 clips/ 항목 목록에서 manifest를 만든다. 입력이 뭐가 빠져 있든 throw하지 않고
 *  해당 필드를 null로 채우는 것이 계약(호출부 try/catch는 최후 방어선일 뿐). */
export function buildClipsManifest(
  clipFiles: { file: string; key: string }[],
  sessions: Session[],
  events: ManifestSourceEvent[],
  appVersion: string,
): ClipsManifest {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeEvents = Array.isArray(events) ? events : [];
  const clips: ClipManifestEntry[] = clipFiles.map(({ file, key }) => {
    const { sessionId, row, colId, kind } = parseClipKey(key);
    const { sttText, confidence } = findLastCellEvent(safeEvents, sessionId, row, colId);
    return {
      file,
      sessionId,
      row,
      colId,
      kind,
      committedValue: findCommittedValue(safeSessions, sessionId, row, colId),
      sttText,
      confidence,
    };
  });
  return {
    schema: CLIPS_MANIFEST_SCHEMA,
    appVersion,
    generatedAt: new Date().toISOString(),
    clipCount: clips.length,
    clips,
  };
}

/** zip의 clips/*.{wav,mp4,webm}을 스캔해 manifest를 생성·동봉한다(exportLogZip 마지막 단계).
 *  파일명 파싱 정규식은 restoreSessionsFromZip(sessionSnapshot.ts)과 동일 규약 — 키에 ':'가
 *  여럿 있으므로 마지막 확장자만 뗀다. 반환값은 테스트/계측용. */
export function attachClipsManifest(
  zip: JSZip,
  sessions: Session[],
  events: ManifestSourceEvent[],
  appVersion: string,
): ClipsManifest {
  const clipFiles: { file: string; key: string }[] = [];
  zip.forEach((path, entry) => {
    if (entry.dir || !path.startsWith('clips/')) return;
    const m = path.slice('clips/'.length).match(/^(.+)\.(wav|mp4|webm)$/);
    if (!m) return;
    clipFiles.push({ file: path, key: m[1] });
  });
  const manifest = buildClipsManifest(clipFiles, sessions, events, appVersion);
  zip.file(CLIPS_MANIFEST_FILENAME, JSON.stringify(manifest, null, 2));
  return manifest;
}
