import { getAccessToken, getCurrentEmail } from './googleAuth';
import { useSettingsStore } from '../stores/settingsStore';
import { FILES_API, escapeDriveQ, ensureEmailSubFolder } from './driveFolders';

/**
 * Drive log backup target — 관리자(팀 리더) 드라이브의 공유 폴더 ID.
 * 환경변수 VITE_ADMIN_LOGS_FOLDER_ID로 설정. 미설정 시 admin 업로드 단계 건너뜀.
 * 팀원들은 이 폴더에 Editor 권한으로 공유받아야 함.
 */
export const LOG_FOLDER_ID =
  import.meta.env.VITE_ADMIN_LOGS_FOLDER_ID || '123Qag3EJK2R4imt0vfeZwvJyvQ3yL-lw';

/**
 * v0.33.0 항목11 — 개선요청(feedback) zip의 관리자 수신 폴더 ID.
 * 환경변수 VITE_ADMIN_FEEDBACK_FOLDER_ID(.env.example 참조). 로그 폴더와 달리 **기본값 없음** —
 * 미설정 시 관리자 레그는 조용히 skip(사용자 Drive 레그만 수행).
 */
export const FEEDBACK_FOLDER_ID = import.meta.env.VITE_ADMIN_FEEDBACK_FOLDER_ID || '';

const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

/** RFC 5322 단순 검증 (Drive 폴더명으로 받기 전에). */
function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function authHeader(): Promise<Record<string, string>> {
  const token = getAccessToken();
  if (!token) throw new Error('Google 로그인이 필요합니다.');
  return { Authorization: `Bearer ${token}` };
}

async function uploadZip(zipBlob: Blob, filename: string, parentId?: string): Promise<string> {
  const metadata: Record<string, unknown> = {
    name: filename,
    mimeType: 'application/zip',
  };
  if (parentId) metadata.parents = [parentId];

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', zipBlob);

  const res = await fetch(UPLOAD_API, {
    method: 'POST',
    headers: await authHeader(),
    body: form,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Drive 업로드 실패: ${err}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * 관리자 공유 폴더 내에 팀원 이메일 이름의 하위 폴더를 찾거나 생성한다.
 * Codex 리뷰 반영: race condition 방지를 위해 settingsStore에 캐시, 검색 시 createdTime 정렬로
 * 중복 폴더가 있어도 가장 오래된 것을 선택해 일관성 유지. 공용 로직은 ensureEmailSubFolder
 * (driveFolders.ts — [RACE-6] 계약)로 통합, 여기서는 **로그 폴더 전용** 캐시(teamFolderId)만 배선한다.
 */
async function ensureTeamSubFolder(parentId: string, userEmail: string): Promise<string> {
  return ensureEmailSubFolder(parentId, userEmail, {
    headers: await authHeader(),
    readCache: () => useSettingsStore.getState().teamFolderId,
    writeCache: (id) => useSettingsStore.getState().set({ teamFolderId: id }),
    errorLabels: { search: '팀원 폴더 검색 실패', create: '팀원 하위 폴더 생성 실패' },
  });
}

const APP_FOLDER_NAME = 'survey-011';
const USER_LOG_SUBFOLDER = 'log';

/** 사용자 Drive에서 `name` 폴더를 parent(미지정=루트) 아래에서 검색만 한다(생성 없음).
 *  중복이 있으면 createdTime asc로 가장 오래된 것을 선택해 일관성 유지. 미존재 시 null. */
async function findFolder(name: string, parentId?: string): Promise<string | null> {
  const headers = await authHeader();
  const safeName = escapeDriveQ(name);
  const parentClause = parentId ? `'${escapeDriveQ(parentId)}' in parents` : `'root' in parents`;
  const q = `${parentClause} and name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `${FILES_API}?q=${encodeURIComponent(q)}&fields=files(id,createdTime)&orderBy=createdTime&spaces=drive`;
  const sr = await fetch(searchUrl, { headers });
  if (!sr.ok) {
    const errText = await sr.text().catch(() => `HTTP ${sr.status}`);
    throw new Error(`폴더 검색 실패(${name}): ${errText}`);
  }
  const data = (await sr.json()) as { files?: { id: string }[] };
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

/** 사용자 Drive에서 `name` 폴더를 parent(미지정=루트) 아래에서 찾거나 생성해 ID 반환. */
async function ensureFolder(name: string, parentId?: string): Promise<string> {
  const found = await findFolder(name, parentId);
  if (found) return found;
  const headers = await authHeader();
  const createRes = await fetch(FILES_API, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => `HTTP ${createRes.status}`);
    throw new Error(`폴더 생성 실패(${name}): ${err}`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

/** 사용자 Drive `survey-011/log/` 폴더 ID (settingsStore 캐시 우선). */
async function ensureUserLogFolder(): Promise<string> {
  const cached = useSettingsStore.getState().userLogFolderId;
  if (cached) return cached;
  const appId = await ensureFolder(APP_FOLDER_NAME);
  const logId = await ensureFolder(USER_LOG_SUBFOLDER, appId);
  useSettingsStore.getState().set({ userLogFolderId: logId });
  return logId;
}

/** 사용자 본인 드라이브 `survey-011/log/` 폴더에 업로드 (v0.4.5 Q1b: 루트 대신 전용 폴더). */
export async function uploadLogToUserDrive(zipBlob: Blob, filename: string): Promise<string> {
  const folderId = await ensureUserLogFolder();
  return uploadZip(zipBlob, filename, folderId);
}

// ─── v0.5.0 W8: 로그 zip 기반 세션 복구 — Drive 읽기 경로 ──────────────────────
// 업로드와 같은 폴더 규약(`survey-011/log`)·캐시(settingsStore.userLogFolderId)를 재사용하되,
// 복구는 읽기 전용이므로 폴더를 **생성하지 않는다**(없으면 백업도 없음).

/** `survey-011/log` 폴더 ID를 검색만으로 찾는다(캐시 우선, 생성 없음). 미존재 시 null. */
export async function findUserLogFolderId(): Promise<string | null> {
  const cached = useSettingsStore.getState().userLogFolderId;
  if (cached) return cached;
  const appId = await findFolder(APP_FOLDER_NAME);
  if (!appId) return null;
  const logId = await findFolder(USER_LOG_SUBFOLDER, appId);
  if (logId) useSettingsStore.getState().set({ userLogFolderId: logId });
  return logId;
}

/** 캐시된 로그 폴더 ID 무효화 — 폴더 삭제/이동으로 stale해진 캐시를 재탐색하게 한다. */
export function invalidateUserLogFolderCache(): void {
  if (useSettingsStore.getState().userLogFolderId) {
    useSettingsStore.getState().set({ userLogFolderId: null });
  }
}

export interface DriveLogZip {
  id: string;
  name: string;
  createdTime: string;
}

/** 로그 폴더의 zip 목록을 **최신순**(createdTime desc)으로 조회. 페이지네이션 포함. */
export async function listLogZips(folderId: string): Promise<DriveLogZip[]> {
  const headers = await authHeader();
  const q = `'${escapeDriveQ(folderId)}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`;
  const files: DriveLogZip[] = [];
  let pageToken: string | undefined;
  do {
    const url =
      `${FILES_API}?q=${encodeURIComponent(q)}` +
      `&fields=${encodeURIComponent('nextPageToken,files(id,name,createdTime)')}` +
      `&orderBy=${encodeURIComponent('createdTime desc')}&pageSize=100&spaces=drive` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(`로그 목록 조회 실패: ${errText}`);
    }
    const data = (await res.json()) as { nextPageToken?: string; files?: DriveLogZip[] };
    files.push(...(data.files ?? []).filter((f) => f.name.toLowerCase().endsWith('.zip')));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}

/** Drive 파일 본문 다운로드 (zip 바이너리). 복구 시에만 호출 — 평시 네트워크 0. */
export async function downloadDriveFile(fileId: string): Promise<Blob> {
  const headers = await authHeader();
  const res = await fetch(`${FILES_API}/${encodeURIComponent(fileId)}?alt=media`, { headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`로그 다운로드 실패: ${errText}`);
  }
  return res.blob();
}

/** 관리자 공유 폴더 내 {userEmail}/ 하위 폴더에 업로드.
 *  Codex 리뷰: 이메일은 토큰의 검증된 값(`getCurrentEmail`)을 사용 — settingsStore stale 방지.
 */
export async function uploadLogToAdminTeamFolder(zipBlob: Blob, filename: string): Promise<string> {
  if (!LOG_FOLDER_ID) throw new Error('관리자 폴더 ID 미설정');
  const verifiedEmail = getCurrentEmail();
  if (!verifiedEmail || !isLikelyEmail(verifiedEmail)) {
    throw new Error('토큰에서 검증된 이메일을 가져올 수 없음');
  }
  const teamFolderId = await ensureTeamSubFolder(LOG_FOLDER_ID, verifiedEmail);
  return uploadZip(zipBlob, filename, teamFolderId);
}

export interface DualUploadResult {
  userDriveId?: string;
  adminDriveId?: string;
  /** 관리자 폴더가 설정되어 있는지 — backupOk 판정에 사용. */
  adminConfigured: boolean;
  errors: string[];
}

/** v0.35.1 Stage 1-3 — 사용자 Drive + 관리자 폴더 이중 업로드 공용 골격. 한 레그 실패해도 다른
 *  레그는 진행하고, 실패는 기존 접두('user_drive: '/'admin_drive: ') 그대로 errors[]에 쌓는다
 *  (로그 zip 하위호환). 레그별 실패 후처리(캐시 무효화 등)는 훅으로 주입한다. */
async function uploadToBothLegs(opts: {
  adminConfigured: boolean;
  userLeg: () => Promise<string>;
  adminLeg: () => Promise<string>;
  onUserError?: () => void;
  onAdminError?: () => void;
}): Promise<DualUploadResult> {
  const result: DualUploadResult = { errors: [], adminConfigured: opts.adminConfigured };
  try {
    result.userDriveId = await opts.userLeg();
  } catch (e) {
    result.errors.push(`user_drive: ${e instanceof Error ? e.message : String(e)}`);
    opts.onUserError?.();
  }
  if (opts.adminConfigured) {
    try {
      result.adminDriveId = await opts.adminLeg();
    } catch (e) {
      result.errors.push(`admin_drive: ${e instanceof Error ? e.message : String(e)}`);
      opts.onAdminError?.();
    }
  }
  return result;
}

/** 사용자 본인 드라이브 + 관리자 공유 폴더 둘 다 업로드. 하나 실패해도 다른 쪽은 진행. */
export async function uploadLogToBothDrives(
  zipBlob: Blob,
  filename: string,
): Promise<DualUploadResult> {
  return uploadToBothLegs({
    adminConfigured: !!LOG_FOLDER_ID,
    userLeg: () => uploadLogToUserDrive(zipBlob, filename),
    adminLeg: () => uploadLogToAdminTeamFolder(zipBlob, filename),
    // 캐시된 폴더 ID가 삭제/이동돼 실패했을 수 있음 — 무효화해 다음 시도에 재탐색/재생성.
    onUserError: () => {
      if (useSettingsStore.getState().userLogFolderId) {
        useSettingsStore.getState().set({ userLogFolderId: null });
      }
    },
    onAdminError: () => {
      if (useSettingsStore.getState().teamFolderId) {
        useSettingsStore.getState().set({ teamFolderId: null });
      }
    },
  });
}

// ─── v0.33.0 항목11 — 개선요청(feedback) 이중 업로드 ─────────────────────────

const USER_FEEDBACK_SUBFOLDER = 'feedback';

/** 사용자 Drive `survey-011/feedback/` 폴더 ID. 로그 폴더(userLogFolderId 캐시)와 달리 별도
 *  settings 캐시를 두지 않는다 — 개선요청은 빈도가 낮아 검색 2회 비용이 무해하고, persist 필드
 *  추가(마이그레이션 비용)를 피한다. */
async function ensureUserFeedbackFolder(): Promise<string> {
  const appId = await ensureFolder(APP_FOLDER_NAME);
  return ensureFolder(USER_FEEDBACK_SUBFOLDER, appId);
}

/** 관리자 feedback 폴더 내 {userEmail}/ 하위 폴더를 찾거나 생성한다.
 *  ⚠️ **무캐시**인 이유([RACE-6] parent별 캐시 분리): settingsStore.teamFolderId 캐시는 **로그
 *  폴더의** 하위 폴더 ID를 담고 있어, 다른 parent(feedback 폴더)에 재사용하면 로그 하위 폴더로
 *  오업로드된다. 개선요청은 빈도가 낮아 검색 비용이 무해하고 persist 필드 추가도 피한다(v0.33.0). */
async function ensureFeedbackSubFolder(parentId: string, userEmail: string): Promise<string> {
  return ensureEmailSubFolder(parentId, userEmail, {
    headers: await authHeader(),
    errorLabels: { search: '피드백 하위 폴더 검색 실패', create: '피드백 하위 폴더 생성 실패' },
  });
}

/** 사용자 Drive `survey-011/feedback/`에 업로드. */
export async function uploadFeedbackToUserDrive(zipBlob: Blob, filename: string): Promise<string> {
  const folderId = await ensureUserFeedbackFolder();
  return uploadZip(zipBlob, filename, folderId);
}

/** 관리자 feedback 폴더의 {검증된 이메일}/ 하위 폴더에 업로드. FEEDBACK_FOLDER_ID 미설정이면 throw
 *  하지 않도록 호출 전에 adminConfigured로 분기할 것(uploadFeedbackToBothDrives가 담당). */
export async function uploadFeedbackToAdminFolder(zipBlob: Blob, filename: string): Promise<string> {
  if (!FEEDBACK_FOLDER_ID) throw new Error('관리자 피드백 폴더 ID 미설정');
  const verifiedEmail = getCurrentEmail();
  if (!verifiedEmail || !isLikelyEmail(verifiedEmail)) {
    throw new Error('토큰에서 검증된 이메일을 가져올 수 없음');
  }
  const subId = await ensureFeedbackSubFolder(FEEDBACK_FOLDER_ID, verifiedEmail);
  return uploadZip(zipBlob, filename, subId);
}

/** 개선요청 이중 업로드 결과 — DualUploadResult와 동일 형태(adminConfigured=FEEDBACK_FOLDER_ID
 *  설정 여부, 미설정이면 admin 레그는 '해당 없음'). */
export type FeedbackUploadResult = DualUploadResult;

/** 사용자 Drive + 관리자 폴더 이중 업로드(uploadToBothLegs 공용 골격). 한 레그 실패해도 다른
 *  레그는 진행. 관리자 레그 실패는 non-fatal — 호출자(feedback.ts)가 사용자 레그 성공 시 성공
 *  처리하고 관리자 레그만 재시도 큐에 남긴다(캐시가 없는 경로라 실패 훅도 없음). */
export async function uploadFeedbackToBothDrives(
  zipBlob: Blob,
  filename: string,
): Promise<FeedbackUploadResult> {
  return uploadToBothLegs({
    adminConfigured: !!FEEDBACK_FOLDER_ID,
    userLeg: () => uploadFeedbackToUserDrive(zipBlob, filename),
    adminLeg: () => uploadFeedbackToAdminFolder(zipBlob, filename),
  });
}
