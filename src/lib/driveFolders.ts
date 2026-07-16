/**
 * v0.35.1 Stage 1-3 — Drive 폴더 ensure 서비스 (driveUpload에서 분리).
 *
 * ensureTeamSubFolder(로그)·ensureFeedbackSubFolder(개선요청)에 중복이던 "{userEmail}/ 하위 폴더
 * 찾기(createdTime asc 최고참 선택)-없으면 생성" 로직을 캐시 파라미터화 1함수로 통합한다.
 *
 * [RACE-6] 계약:
 *  - 검색 실패는 silent fall-through 하지 않고 throw.
 *  - 중복 폴더가 있어도 createdTime asc 정렬로 가장 오래된 것을 선택해 일관성 유지.
 *  - 캐시는 **호출부가 parent별로 분리해 주입**한다(readCache/writeCache). 로그 폴더 캐시
 *    (settingsStore.teamFolderId)를 다른 parent(feedback 폴더)에 재사용하면 로그 하위 폴더로
 *    오업로드되므로, 이 모듈은 캐시를 소유하지 않는다 — 주입받은 접근자만 쓴다(개선요청 경로는
 *    무캐시: 빈도가 낮아 검색 비용이 무해하고 persist 필드 추가를 피한다, v0.33.0 결정).
 *
 * 스토어·인증을 모르는 주입형 서비스라 Node에서 fetch 스텁만으로 단위 테스트된다
 * (tests/driveFolders.spec.ts — [RACE-6] 회귀).
 */

export const FILES_API = 'https://www.googleapis.com/drive/v3/files';

/** Google Drive Q 문자열 리터럴 escape — backslash, single-quote 모두 처리. */
export function escapeDriveQ(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export interface EnsureEmailSubFolderOpts {
  /** 인증 헤더(호출부의 authHeader() 산출물). */
  headers: Record<string, string>;
  /** parent별로 분리된 캐시 접근자. 미주입 = 무캐시(매 호출 검색). */
  readCache?: () => string | null;
  writeCache?: (id: string) => void;
  /** 실패 메시지 라벨(기존 경로별 문구 보존 — 로그 zip errors[]에 실린다). */
  errorLabels: { search: string; create: string };
}

/** parentId 폴더 안의 {userEmail}/ 하위 폴더 ID를 찾거나 생성해 반환한다. */
export async function ensureEmailSubFolder(
  parentId: string,
  userEmail: string,
  opts: EnsureEmailSubFolderOpts,
): Promise<string> {
  const cached = opts.readCache?.();
  if (cached) return cached;

  const q =
    `'${escapeDriveQ(parentId)}' in parents and name='${escapeDriveQ(userEmail)}'` +
    ` and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `${FILES_API}?q=${encodeURIComponent(q)}&fields=files(id,createdTime)&orderBy=createdTime&spaces=drive`;
  const sr = await fetch(searchUrl, { headers: opts.headers });
  if (!sr.ok) {
    const errText = await sr.text().catch(() => `HTTP ${sr.status}`);
    throw new Error(`${opts.errorLabels.search}: ${errText}`);
  }
  const data = (await sr.json()) as { files?: { id: string }[] };
  if (data.files && data.files.length > 0) {
    const canonicalId = data.files[0].id; // createdTime asc — 중복 시 최고참으로 통일
    opts.writeCache?.(canonicalId);
    return canonicalId;
  }

  const createRes = await fetch(FILES_API, {
    method: 'POST',
    headers: { ...opts.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: userEmail,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => `HTTP ${createRes.status}`);
    throw new Error(`${opts.errorLabels.create}: ${err}`);
  }
  const created = (await createRes.json()) as { id: string };
  opts.writeCache?.(created.id);
  return created.id;
}
