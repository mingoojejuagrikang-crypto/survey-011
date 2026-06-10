/**
 * v0.5.0 W8 — "세션 복구" 2단계: Drive 로그 zip에서 세션+클립 복원.
 *
 * 흐름: 로그인 확인 → `survey-011/log` 폴더 검색(캐시 재사용, 생성 없음) → zip 목록
 * 최신순 조회 → zip별 다운로드·파싱(restoreSessionsFromZip) → 로컬에 없는 세션만 복원.
 * 최신 zip부터 처리하고 복원한 id를 localIds에 누적하므로 같은 세션이 여러 zip에 있으면
 * **최신 zip이 우선**한다. sessions.json 없는 구버전 zip은 legacy로 집계만 하고 건너뛴다.
 *
 * 네트워크는 복구 버튼을 눌렀을 때만 발생(평시 0). 토큰 만료/오프라인/개별 zip 실패는
 * 모두 graceful — 이 함수는 throw하지 않고 결과 객체로 보고한다.
 * 전 과정 `recover_*` 계측(W7 'app' 타입) — [REVIEW-1] 관측 대칭성: 성공도 실패도 찍는다.
 */
import {
  findUserLogFolderId,
  invalidateUserLogFolderCache,
  listLogZips,
  downloadDriveFile,
  type DriveLogZip,
} from './driveUpload';
import { getAccessToken } from './googleAuth';
import { restoreSessionsFromZip } from './sessionSnapshot';
import { logger } from './logger';

export interface DriveRecoverResult {
  /** ok: 목록 조회까지 성공(개별 zip 실패는 failedZips로 집계).
   *  not_signed_in: 미로그인/토큰 만료. no_folder: Drive에 로그 폴더 없음(백업 이력 없음).
   *  failed: 폴더 검색/목록 조회 자체가 실패(오프라인 등). */
  status: 'ok' | 'not_signed_in' | 'no_folder' | 'failed';
  /** 새로 복원한 세션 수. */
  sessions: number;
  /** 복원 세션에 속한 복원 클립 수. */
  clips: number;
  /** sessions.json 없는 구버전 zip 수 (결과 메시지의 "구버전 로그 K개 제외"). */
  legacyZips: number;
  /** 다운로드/파싱에 실패한 zip 수. */
  failedZips: number;
  /** 조회된 zip 총 수. */
  zipsScanned: number;
  error?: string;
}

const errMsg = (e: unknown): string => String((e as Error)?.message ?? e);

export async function recoverFromDriveLogs(
  localIds: Set<string>,
  onProgress?: (msg: string) => void,
): Promise<DriveRecoverResult> {
  const base: DriveRecoverResult = {
    status: 'ok', sessions: 0, clips: 0, legacyZips: 0, failedZips: 0, zipsScanned: 0,
  };

  // 토큰 만료(getAccessToken은 만료 1분 전부터 null)도 미로그인과 동일하게 graceful 처리.
  if (!getAccessToken()) {
    logger.log({ type: 'app', extra: 'recover_drive_skipped:not_signed_in' });
    return { ...base, status: 'not_signed_in' };
  }

  logger.log({ type: 'app', extra: 'recover_drive_start' });
  onProgress?.('Drive 로그 목록 조회 중...');

  let zips: DriveLogZip[];
  try {
    let folderId = await findUserLogFolderId();
    if (!folderId) {
      logger.log({ type: 'app', extra: 'recover_drive_list:no_folder' });
      return { ...base, status: 'no_folder' };
    }
    try {
      zips = await listLogZips(folderId);
    } catch (e) {
      // 캐시된 폴더 ID가 stale(삭제/이동)일 수 있음 — 무효화 후 1회 재탐색·재시도.
      invalidateUserLogFolderCache();
      const retryId = await findUserLogFolderId();
      if (!retryId) {
        logger.log({ type: 'app', extra: 'recover_drive_list:no_folder' });
        return { ...base, status: 'no_folder' };
      }
      if (retryId === folderId) throw e; // 같은 폴더면 일시 오류 — 그대로 보고
      folderId = retryId;
      zips = await listLogZips(folderId);
    }
  } catch (e) {
    const msg = errMsg(e);
    logger.log({ type: 'app', extra: `recover_drive_list_failed:${msg}` });
    return { ...base, status: 'failed', error: msg };
  }

  logger.log({ type: 'app', extra: `recover_drive_list:${zips.length}` });

  const result = { ...base, zipsScanned: zips.length };
  for (let i = 0; i < zips.length; i++) {
    const z = zips[i];
    // 클립이 16kHz mono WAV(트림본+raw)라 zip이 클 수 있음 — 진행 표시(1·2차 배치 인계).
    onProgress?.(`Drive 로그 복구 중... (${i + 1}/${zips.length})`);
    try {
      const blob = await downloadDriveFile(z.id);
      const r = await restoreSessionsFromZip(blob, localIds);
      if (r.legacy) {
        result.legacyZips++;
        logger.log({ type: 'app', extra: `recover_zip_legacy:${z.name}` });
      } else {
        result.sessions += r.restoredSessions;
        result.clips += r.restoredClips;
        logger.log({
          type: 'app',
          extra: `recover_zip:${z.name}:sessions=${r.restoredSessions},clips=${r.restoredClips}`,
        });
      }
    } catch (e) {
      // 개별 zip 실패(오프라인 전환·손상 zip)는 전체를 죽이지 않는다 — 집계 + 로깅 후 계속.
      result.failedZips++;
      logger.log({ type: 'app', extra: `recover_zip_failed:${z.name}:${errMsg(e)}` });
    }
  }

  logger.log({
    type: 'app',
    extra:
      `recover_drive_done:sessions=${result.sessions},clips=${result.clips}` +
      `,legacy=${result.legacyZips},failed=${result.failedZips},scanned=${result.zipsScanned}`,
  });
  return result;
}
