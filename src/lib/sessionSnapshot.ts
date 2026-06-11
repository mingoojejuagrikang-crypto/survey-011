/**
 * v0.5.0 W8 — 로그 zip 복구용 세션 스냅샷 (민구 결정 2번: 별도 백업 업로드 없이 기존 로그 zip 활용).
 *
 * exportLogZip이 zip에 `sessions.json`(export 범위 세션의 전체 Session 객체 배열 +
 * {schema, appVersion} 래퍼)을 동봉하고, "세션 복구" 2단계가 Drive의 로그 zip에서
 * 이 스냅샷과 clips/를 읽어 IDB로 복원한다. 클립은 zip의 기존 clips/를 그대로 공유한다
 * (중복 업로드 금지).
 *
 * 이 모듈은 Drive/OAuth에 의존하지 않는 순수 직렬화·zip 파싱 계층이다 —
 * import.meta.env를 쓰는 모듈(googleAuth/driveUpload)을 import하지 않아
 * Node 단위 테스트(tests/sessionSnapshot.spec.ts)에서 직접 round-trip 검증이 가능하다
 * (audioTrim.spec.ts / koreanNum.spec.ts 패턴).
 */
import JSZip from 'jszip';
import type { Session } from '../types';
import { saveSession as dbSaveSession, saveAudioClip as dbSaveAudioClip } from './db';

export const SNAPSHOT_SCHEMA = 1;

export interface SessionsSnapshot {
  schema: number;
  appVersion: string;
  sessions: Session[];
}

/** export 범위 세션 전체를 sessions.json 본문 문자열로 직렬화. */
export function buildSessionsSnapshot(sessions: Session[], appVersion: string): string {
  const snapshot: SessionsSnapshot = { schema: SNAPSHOT_SCHEMA, appVersion, sessions };
  return JSON.stringify(snapshot, null, 2);
}

/** 최소 구조 검증 — 깨진 세션 하나가 복구 전체를 죽이지 않도록 세션 단위로 거른다. */
export function isValidSession(v: unknown): v is Session {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Partial<Session>;
  return (
    typeof s.id === 'string' && s.id.length > 0 &&
    typeof s.date === 'string' &&
    Array.isArray(s.columns) &&
    Array.isArray(s.rows) &&
    typeof s.completedRows === 'number' &&
    typeof s.syncedRows === 'number' &&
    typeof s.startedAt === 'number' && Number.isFinite(s.startedAt)
  );
}

/** sessions.json 파싱. 형식이 스냅샷이 아니면 null(호출부가 구버전 zip으로 취급).
 *  schema는 1 이상이면 수용(필드는 additive 전제) — 미래 버전 zip도 best-effort 복원. */
export function parseSessionsSnapshot(text: string): SessionsSnapshot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as { schema?: unknown; appVersion?: unknown; sessions?: unknown };
  if (typeof o.schema !== 'number' || o.schema < 1) return null;
  if (!Array.isArray(o.sessions)) return null;
  return {
    schema: o.schema,
    appVersion: typeof o.appVersion === 'string' ? o.appVersion : '?',
    sessions: o.sessions.filter(isValidSession),
  };
}

/** zip clips/ 항목의 확장자 → Blob MIME (exportLog.ts의 역방향). */
const EXT_TO_MIME: Record<string, string> = {
  wav: 'audio/wav',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
};

export interface ZipRestoreResult {
  /** sessions.json이 없거나 파싱 불가 — 구버전 zip(복구용 스냅샷 없음). */
  legacy: boolean;
  /** 이 zip에서 새로 저장한 세션 수 (localIds에 이미 있던 세션은 건너뜀). */
  restoredSessions: number;
  /** 새로 저장한 세션에 속한 복원 클립 수. */
  restoredClips: number;
}

export interface ZipRestoreDeps {
  saveSession: (s: Session) => Promise<void>;
  saveAudioClip: (key: string, blob: Blob) => Promise<void>;
}

/**
 * 로그 zip 하나에서 로컬에 없는 세션을 복원한다.
 *
 * - `localIds`에 없는 세션만 saveSession — 호출부가 zip을 **최신순**으로 돌리고,
 *   복원된 id를 이 Set에 더해 나가므로 같은 세션이 여러 zip에 있으면 최신 zip이 이긴다.
 * - clips/는 **키 문자열 그대로** round-trip한다(1·2차 배치 인계: 키에 `:raw`,
 *   `:cmd<n>:raw` suffix가 있어 `split(':')`은 5조각까지 나옴 — 파싱해 행 매핑 금지).
 *   세션 귀속 판정만 첫 `:` 앞 sessionId prefix로 한다(exportLog/deleteSession과 동일 규약).
 * - deps 주입으로 Node 단위 테스트 가능(기본값은 실제 IDB 저장).
 */
export async function restoreSessionsFromZip(
  data: Blob | ArrayBuffer | Uint8Array,
  localIds: Set<string>,
  deps: ZipRestoreDeps = { saveSession: dbSaveSession, saveAudioClip: dbSaveAudioClip },
): Promise<ZipRestoreResult> {
  const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
  const zip = await JSZip.loadAsync(bytes);

  const snapFile = zip.file('sessions.json');
  if (!snapFile) return { legacy: true, restoredSessions: 0, restoredClips: 0 };
  const snapshot = parseSessionsSnapshot(await snapFile.async('text'));
  if (!snapshot) return { legacy: true, restoredSessions: 0, restoredClips: 0 };

  // 전량 모드: localIds에 없는 모든 세션. (v0.6.0 selectedIds=null 위임)
  return restoreSessionTargets(zip, snapshot, null, localIds, deps);
}

/** zip + 파싱된 스냅샷에서 대상 세션을 복원하는 공용 코어.
 *  @param selectedIds null이면 localIds에 없는 전 세션, Set이면 그 교집합만 복원(v0.6.0 선택 복구). */
async function restoreSessionTargets(
  zip: JSZip,
  snapshot: SessionsSnapshot,
  selectedIds: Set<string> | null,
  localIds: Set<string>,
  deps: ZipRestoreDeps,
): Promise<ZipRestoreResult> {
  const targets = snapshot.sessions.filter(
    (s) => !localIds.has(s.id) && (selectedIds === null || selectedIds.has(s.id)),
  );
  if (targets.length === 0) return { legacy: false, restoredSessions: 0, restoredClips: 0 };

  // 세션 먼저 저장 — 클립 일부가 실패해도 세션 데이터(값)는 살아남는다.
  for (const session of targets) {
    await deps.saveSession(session);
    localIds.add(session.id);
  }

  const targetIds = new Set(targets.map((s) => s.id));
  const clipEntries: { key: string; entry: JSZip.JSZipObject; mime: string }[] = [];
  zip.forEach((path, entry) => {
    if (entry.dir || !path.startsWith('clips/')) return;
    // 키에 ':'가 여럿 들어가므로 마지막 확장자만 떼고 나머지는 그대로 보존.
    const m = path.slice('clips/'.length).match(/^(.+)\.(wav|mp4|webm)$/);
    if (!m) return;
    const key = m[1];
    if (!targetIds.has(key.split(':')[0])) return; // 복원 대상 세션의 클립만
    clipEntries.push({ key, entry, mime: EXT_TO_MIME[m[2]] });
  });

  let restoredClips = 0;
  for (const { key, entry, mime } of clipEntries) {
    const buf = await entry.async('arraybuffer');
    await deps.saveAudioClip(key, new Blob([buf], { type: mime }));
    restoredClips++;
  }

  return { legacy: false, restoredSessions: targets.length, restoredClips };
}

/** v0.6.0 "세션 복구" 2단계: 1단계가 다운로드해 캐시한 zip blob + 파싱 스냅샷.
 *  V15: 1단계가 이미 loadAsync한 JSZip 인스턴스를 보관해 restore 단계의 중복 loadAsync(같은
 *  blob 두 번 해제)를 제거한다. 구버전 캐시(zip 미보관) 호환을 위해 optional. */
export interface CachedZip {
  blob: Blob;
  snapshot: SessionsSnapshot | null;
  legacy: boolean;
  /** 1단계에서 파싱한 JSZip 인스턴스(있으면 restore가 재사용 — blob 재해제 방지). */
  zip?: JSZip;
}

/**
 * 캐시된 zip에서 **선택된 세션만** 복원한다(restoreSessionsFromZip의 선택 복구 변형).
 * V15: 1단계가 보관한 JSZip 인스턴스가 있으면 재사용하고, 없을 때만 blob을 다시 푼다.
 * 세션은 selectedIds ∩ (localIds 밖)만 저장한다.
 */
export async function restoreFromCachedZip(
  cached: CachedZip,
  selectedIds: Set<string>,
  localIds: Set<string>,
  deps: ZipRestoreDeps = { saveSession: dbSaveSession, saveAudioClip: dbSaveAudioClip },
): Promise<ZipRestoreResult> {
  if (!cached.snapshot) return { legacy: true, restoredSessions: 0, restoredClips: 0 };
  const zip = cached.zip ?? (await JSZip.loadAsync(await cached.blob.arrayBuffer()));
  return restoreSessionTargets(zip, cached.snapshot, selectedIds, localIds, deps);
}
