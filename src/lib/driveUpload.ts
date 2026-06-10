import { getAccessToken, getCurrentEmail } from './googleAuth';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * Drive log backup target — 관리자(팀 리더) 드라이브의 공유 폴더 ID.
 * 환경변수 VITE_ADMIN_LOGS_FOLDER_ID로 설정. 미설정 시 admin 업로드 단계 건너뜀.
 * 팀원들은 이 폴더에 Editor 권한으로 공유받아야 함.
 */
export const LOG_FOLDER_ID =
  import.meta.env.VITE_ADMIN_LOGS_FOLDER_ID || '123Qag3EJK2R4imt0vfeZwvJyvQ3yL-lw';

const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
const FILES_API = 'https://www.googleapis.com/drive/v3/files';

/** Google Drive Q 문자열 리터럴 escape — backslash, single-quote 모두 처리. */
function escapeDriveQ(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

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
 * 중복 폴더가 있어도 가장 오래된 것을 선택해 일관성 유지.
 */
async function ensureTeamSubFolder(parentId: string, userEmail: string): Promise<string> {
  // 1. 캐시 확인
  const cached = useSettingsStore.getState().teamFolderId;
  if (cached) {
    return cached;
  }

  const safeName = escapeDriveQ(userEmail);
  const safeParent = escapeDriveQ(parentId);
  // createdTime asc 정렬 → 중복이 있더라도 가장 오래된 폴더로 통일
  const q = `'${safeParent}' in parents and name='${safeName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `${FILES_API}?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime)&orderBy=createdTime&spaces=drive`;
  const headers = await authHeader();
  const sr = await fetch(searchUrl, { headers });
  if (sr.ok) {
    const data = (await sr.json()) as { files?: { id: string; createdTime?: string }[] };
    if (data.files && data.files.length > 0) {
      const canonicalId = data.files[0].id;
      // 캐시에 저장 → 다음부터 검색 안 함
      useSettingsStore.getState().set({ teamFolderId: canonicalId });
      return canonicalId;
    }
  } else {
    const errText = await sr.text().catch(() => `HTTP ${sr.status}`);
    throw new Error(`팀원 폴더 검색 실패: ${errText}`);
  }
  // 2. 없으면 생성
  const createRes = await fetch(FILES_API, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: userEmail,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => `HTTP ${createRes.status}`);
    throw new Error(`팀원 하위 폴더 생성 실패: ${err}`);
  }
  const created = (await createRes.json()) as { id: string };
  useSettingsStore.getState().set({ teamFolderId: created.id });
  return created.id;
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

/** 사용자 본인 드라이브 + 관리자 공유 폴더 둘 다 업로드. 하나 실패해도 다른 쪽은 진행. */
export async function uploadLogToBothDrives(
  zipBlob: Blob,
  filename: string,
): Promise<DualUploadResult> {
  const result: DualUploadResult = { errors: [], adminConfigured: !!LOG_FOLDER_ID };

  // 1. 사용자 본인 드라이브 (survey-011/log/)
  try {
    result.userDriveId = await uploadLogToUserDrive(zipBlob, filename);
  } catch (e) {
    result.errors.push(`user_drive: ${e instanceof Error ? e.message : String(e)}`);
    // 캐시된 폴더 ID가 삭제/이동돼 실패했을 수 있음 — 무효화해 다음 시도에 재탐색/재생성.
    if (useSettingsStore.getState().userLogFolderId) {
      useSettingsStore.getState().set({ userLogFolderId: null });
    }
  }

  // 2. 관리자 폴더의 팀원 하위 폴더 — LOG_FOLDER_ID 설정된 경우만
  if (LOG_FOLDER_ID) {
    try {
      result.adminDriveId = await uploadLogToAdminTeamFolder(zipBlob, filename);
    } catch (e) {
      result.errors.push(`admin_drive: ${e instanceof Error ? e.message : String(e)}`);
      // 캐시된 폴더 ID로 업로드 실패 시 캐시 무효화 — 다음 시도에 재검색
      if (useSettingsStore.getState().teamFolderId) {
        useSettingsStore.getState().set({ teamFolderId: null });
      }
    }
  }

  return result;
}

/** @deprecated v0.10부터 uploadLogToBothDrives 사용 권장. 호환성을 위해 유지. */
export async function uploadLogToDrive(zipBlob: Blob, filename: string): Promise<string> {
  return uploadZip(zipBlob, filename, LOG_FOLDER_ID);
}
