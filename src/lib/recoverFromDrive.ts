/**
 * v0.6.0 W8 — "세션 복구" 2단계(기간 조회 + 세션 선택).
 *
 * 기존 단일 함수(zip 전량 무조건 복구)를 2단계 API로 분리한다:
 *   1) listRecoverableSessionsFromDrive(since) — 기간 내(zip createdTime 기준) zip을 다운로드해
 *      sessions.json 메타만 파싱·집계하고, blob/snapshot은 메모리 ZipCache에 보관한다(IDB 미기록).
 *   2) restoreSelectedSessions(selectedIds, localIds, cache) — 캐시된 zip에서 **선택된 세션만**
 *      IDB로 저장 + 소속 클립 복원(restoreSessionsFromZip 로직 재사용).
 *
 * 네트워크는 "목록 조회" 버튼을 눌렀을 때만 발생(평시 0). 토큰 만료/오프라인/개별 zip 실패는
 * 모두 graceful — throw하지 않고 결과 객체로 보고. 전 과정 `recover_*` 계측(W7 'app' 타입).
 */
import {
  findUserLogFolderId,
  invalidateUserLogFolderCache,
  listLogZips,
  downloadDriveFile,
  type DriveLogZip,
} from './driveUpload';
import { getAccessToken } from './googleAuth';
import JSZip from 'jszip';
import {
  parseSessionsSnapshot,
  restoreFromCachedZip,
  type CachedZip,
  type SessionsSnapshot,
} from './sessionSnapshot';
import { logger } from './logger';

/** 한 세션의 복구 미리보기 메타 (체크리스트 렌더용). 본문(클립/행 전체)은 캐시에만 둔다. */
export interface ZipSessionMeta {
  id: string;
  date: string;
  label?: string;
  completedRows: number;
  syncedRows: number;
  startedAt: number;
  rowCount: number;
  /** 이 세션이 들어있던 zip의 Drive id (복구 단계에서 해당 zip 캐시를 찾는 키). */
  zipId: string;
}

/** zipId → 다운로드한 zip blob + 파싱한 스냅샷 + legacy 여부. restore 단계에서 재사용. */
export type ZipCache = Map<string, CachedZip>;

export interface ListRecoverResult {
  /** ok: 목록 조회까지 성공. not_signed_in: 미로그인/토큰 만료. no_folder: 백업 이력 없음.
   *  failed: 폴더 검색/목록 조회 자체 실패(오프라인 등). */
  status: 'ok' | 'not_signed_in' | 'no_folder' | 'failed';
  /** 기간 필터를 통과한 zip에서 복구 가능한 세션 메타(최신 zip 우선, 중복 세션 1개로 dedupe). */
  sessions: ZipSessionMeta[];
  /** sessions.json 없는 구버전 zip 수 (UI "구버전 로그 K개 제외"). */
  legacyZips: number;
  /** 다운로드/파싱 실패 zip 수. */
  failedZips: number;
  /** 기간 필터 통과 후 실제 조회한 zip 수. */
  zipsScanned: number;
  /** 기간 필터로 제외된 zip 수(전체 zip 중 since 이전). */
  zipsFilteredOut: number;
  error?: string;
}

export interface ListRecoverReturn {
  result: ListRecoverResult;
  cache: ZipCache;
}

export interface RestoreSelectedResult {
  sessions: number;
  clips: number;
  /** 캐시에 없거나(만료) 파싱 실패로 복구 못 한 세션 수. */
  skipped: number;
}

const errMsg = (e: unknown): string => String((e as Error)?.message ?? e);

/**
 * 1단계 — 기간(since) 내 Drive 로그 zip 메타를 조회한다.
 *
 * @param since createdTime이 이 시각 이후인 zip만 조회. null이면 전체 기간.
 * @param onProgress "Drive 로그 목록 조회 중... (n/m)" 진행 콜백.
 */
export async function listRecoverableSessionsFromDrive(
  since: Date | null,
  onProgress?: (msg: string) => void,
): Promise<ListRecoverReturn> {
  const cache: ZipCache = new Map();
  const base: ListRecoverResult = {
    status: 'ok', sessions: [], legacyZips: 0, failedZips: 0,
    zipsScanned: 0, zipsFilteredOut: 0,
  };

  if (!getAccessToken()) {
    logger.log({ type: 'app', extra: 'recover_drive_skipped:not_signed_in' });
    return { result: { ...base, status: 'not_signed_in' }, cache };
  }

  logger.log({ type: 'app', extra: `recover_drive_start:since=${since ? since.toISOString() : 'all'}` });
  onProgress?.('Drive 로그 목록 조회 중...');

  let zips: DriveLogZip[];
  try {
    let folderId = await findUserLogFolderId();
    if (!folderId) {
      logger.log({ type: 'app', extra: 'recover_drive_list:no_folder' });
      return { result: { ...base, status: 'no_folder' }, cache };
    }
    try {
      zips = await listLogZips(folderId);
    } catch (e) {
      // 캐시된 폴더 ID가 stale(삭제/이동)일 수 있음 — 무효화 후 1회 재탐색·재시도.
      invalidateUserLogFolderCache();
      const retryId = await findUserLogFolderId();
      if (!retryId) {
        logger.log({ type: 'app', extra: 'recover_drive_list:no_folder' });
        return { result: { ...base, status: 'no_folder' }, cache };
      }
      if (retryId === folderId) throw e;
      folderId = retryId;
      zips = await listLogZips(folderId);
    }
  } catch (e) {
    const msg = errMsg(e);
    logger.log({ type: 'app', extra: `recover_drive_list_failed:${msg}` });
    return { result: { ...base, status: 'failed', error: msg }, cache };
  }

  // 기간 필터: createdTime이 since 이후인 zip만. since=null이면 전체.
  const sinceMs = since ? since.getTime() : null;
  const inRange = zips.filter((z) => {
    if (sinceMs === null) return true;
    const t = Date.parse(z.createdTime);
    return Number.isFinite(t) ? t >= sinceMs : true; // 파싱 불가 createdTime은 포함(보수적)
  });
  const result: ListRecoverResult = {
    ...base,
    zipsScanned: inRange.length,
    zipsFilteredOut: zips.length - inRange.length,
  };
  logger.log({
    type: 'app',
    extra: `recover_drive_list:${zips.length},in_range=${inRange.length}`,
  });

  // listLogZips는 createdTime desc(최신순)이므로 그 순서대로 처리 → 같은 세션이 여러 zip에 있으면
  // 최신 zip이 이긴다(seen Set으로 dedupe). 메타만 모으고 blob/snapshot은 캐시에 보관.
  const seen = new Set<string>();
  for (let i = 0; i < inRange.length; i++) {
    const z = inRange[i];
    onProgress?.(`Drive 로그 목록 조회 중... (${i + 1}/${inRange.length})`);
    try {
      const blob = await downloadDriveFile(z.id);
      // V15: keep the loaded JSZip so restoreFromCachedZip can reuse it (no second loadAsync).
      const { snapshot, zip } = await parseZipSnapshot(blob);
      if (!snapshot) {
        cache.set(z.id, { blob, snapshot: null, legacy: true, zip });
        result.legacyZips++;
        logger.log({ type: 'app', extra: `recover_zip_legacy:${z.name}` });
        continue;
      }
      cache.set(z.id, { blob, snapshot, legacy: false, zip });
      for (const s of snapshot.sessions) {
        if (seen.has(s.id)) continue; // 최신 zip 우선
        seen.add(s.id);
        result.sessions.push({
          id: s.id,
          date: s.date,
          label: s.label,
          completedRows: s.completedRows,
          syncedRows: s.syncedRows,
          startedAt: s.startedAt,
          rowCount: Array.isArray(s.rows) ? s.rows.length : 0,
          zipId: z.id,
        });
      }
    } catch (e) {
      result.failedZips++;
      logger.log({ type: 'app', extra: `recover_zip_failed:${z.name}:${errMsg(e)}` });
    }
  }

  logger.log({
    type: 'app',
    extra:
      `recover_list_done:sessions=${result.sessions.length},legacy=${result.legacyZips}` +
      `,failed=${result.failedZips},scanned=${result.zipsScanned}`,
  });
  return { result, cache };
}

/** zip blob을 한 번 풀어 JSZip 인스턴스와 sessions.json 스냅샷을 함께 돌려준다(메타 추출용).
 *  sessions.json이 없거나 파싱 불가면 snapshot=null(legacy zip)이되, zip 인스턴스는 보관해
 *  restore 단계의 중복 loadAsync를 막는다(V15). */
async function parseZipSnapshot(
  blob: Blob,
): Promise<{ snapshot: SessionsSnapshot | null; zip: JSZip }> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const snapFile = zip.file('sessions.json');
  if (!snapFile) return { snapshot: null, zip };
  return { snapshot: parseSessionsSnapshot(await snapFile.async('text')), zip };
}

/**
 * 2단계 — 캐시된 zip에서 선택한 세션만 IDB로 복원한다.
 *
 * @param selectedIds 사용자가 체크한 세션 id 집합.
 * @param localIds 이미 로컬에 있는 세션 id(중복 저장 방지 — restoreFromCachedZip이 필터).
 * @param cache 1단계가 반환한 ZipCache(zipId → blob/snapshot).
 */
export async function restoreSelectedSessions(
  selectedIds: Set<string>,
  localIds: Set<string>,
  cache: ZipCache,
  onProgress?: (msg: string) => void,
): Promise<RestoreSelectedResult> {
  const out: RestoreSelectedResult = { sessions: 0, clips: 0, skipped: 0 };
  if (selectedIds.size === 0) return out;

  // zip별로 그 zip이 담당하는 선택 세션을 모은다(한 zip을 한 번만 풀도록).
  const byZip = new Map<string, Set<string>>();
  for (const [zipId, cached] of cache) {
    if (!cached.snapshot) continue;
    for (const s of cached.snapshot.sessions) {
      if (!selectedIds.has(s.id) || localIds.has(s.id)) continue;
      let set = byZip.get(zipId);
      if (!set) { set = new Set(); byZip.set(zipId, set); }
      set.add(s.id);
    }
  }

  const handled = new Set<string>();
  let zi = 0;
  const zipCount = byZip.size;
  for (const [zipId, ids] of byZip) {
    zi++;
    onProgress?.(`복구 중... (${zi}/${zipCount})`);
    const cached = cache.get(zipId);
    if (!cached) continue;
    try {
      // 이 zip에서 아직 처리 안 된 선택 세션만 복원(여러 zip 중복은 최신 zip이 먼저 처리됨).
      const wanted = new Set([...ids].filter((id) => !handled.has(id)));
      if (wanted.size === 0) continue;
      const r = await restoreFromCachedZip(cached, wanted, localIds);
      out.sessions += r.restoredSessions;
      out.clips += r.restoredClips;
      for (const id of wanted) { handled.add(id); localIds.add(id); }
      logger.log({
        type: 'app',
        extra: `recover_restore_zip:sessions=${r.restoredSessions},clips=${r.restoredClips}`,
      });
    } catch (e) {
      logger.log({ type: 'app', extra: `recover_restore_failed:${zipId}:${errMsg(e)}` });
    }
  }

  // 선택했지만 캐시/스냅샷에서 못 찾은 세션(만료 등) 집계.
  out.skipped = [...selectedIds].filter((id) => !handled.has(id) && !localIds.has(id)).length;
  logger.log({
    type: 'app',
    extra: `recover_restore_done:sessions=${out.sessions},clips=${out.clips},skipped=${out.skipped}`,
  });
  return out;
}
