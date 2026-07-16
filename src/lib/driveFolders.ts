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

/** Drive 폴더 ensure fetch 상한(ms) — 리뷰 라운드2(Codex Medium) 반영: settle되지 않는 fetch가
 *  inFlight dedup 항목을 영구 점유하면 온라인 복귀 후 재시도까지 같은 pending Promise에 붙잡힌다.
 *  타임아웃으로 반드시 settle시켜 Map이 정리되게 한다(30s — 현장 LTE 최악 왕복 대비 여유). */
const ENSURE_FETCH_TIMEOUT_MS = 30_000;

/** 타임아웃 signal — AbortSignal.timeout 미지원 환경은 AbortController+setTimeout으로 폴백해
 *  같은 계약(반드시 settle → inFlight 정리)을 유지한다(리뷰 라운드3 Codex Medium). 폴백 타이머는
 *  30s 일회성 no-op이라 해제 훅 없이 무해. 둘 다 불가한 환경만 signal 없이 진행(종전 동작). */
function timeoutSignal(): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(ENSURE_FETCH_TIMEOUT_MS);
  } catch { /* 폴백으로 */ }
  try {
    const c = new AbortController();
    setTimeout(() => c.abort(new Error('drive folder ensure timeout')), ENSURE_FETCH_TIMEOUT_MS);
    return c.signal;
  } catch {
    return undefined;
  }
}

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

/** 계정 결합 폴더 캐시 — v0.35.1 리뷰(Codex High) 반영. 종전의 맨 폴더 ID 캐시는 같은 기기에서
 *  A 로그아웃 → B 로그인 시 A의 하위 폴더 ID를 그대로 재사용해, 관리자 공유 폴더(팀원 전원
 *  Editor)에서 B의 로그가 A 이름 폴더로 혼입될 수 있었다. 캐시에 어떤 계정의 것인지(email)를
 *  함께 저장하고, 현재 검증된 이메일과 일치할 때만 사용한다. */
export interface FolderCache {
  email: string;
  id: string;
}

/** persist에서 읽은 값(형태 불명)을 현재 이메일로 검증해 폴더 ID를 돌려준다.
 *  이메일 불일치·형태 손상·legacy 맨 문자열(계정 미상)은 전부 null = 캐시 미스(재검색). */
export function cachedFolderIdFor(cache: unknown, currentEmail: string | null): string | null {
  if (!currentEmail || !cache || typeof cache !== 'object') return null;
  const c = cache as Partial<FolderCache>;
  if (typeof c.email !== 'string' || typeof c.id !== 'string') return null;
  return c.email === currentEmail ? c.id : null;
}

/** FolderCache 타입가드 — persist coercion(settingsStore migrate)용. */
export function isFolderCache(v: unknown): v is FolderCache {
  return (
    typeof v === 'object' && v !== null &&
    typeof (v as FolderCache).email === 'string' &&
    typeof (v as FolderCache).id === 'string'
  );
}

/** v0.35.1 리뷰(Codex Medium) — 동시 생성 레이스 dedup. 캐시가 빈 상태에서 같은 (parent,email)
 *  ensure 두 건이 겹치면 양쪽 다 검색 미스 → 각자 생성해 중복 폴더가 갈라진다([RACE-6]의 잔여
 *  절반 — 캐시는 "다음" 호출만 보호). 같은 키의 in-flight Promise를 공유해 모듈 안에서 직렬화한다. */
const inFlight = new Map<string, Promise<string>>();

/** parentId 폴더 안의 {userEmail}/ 하위 폴더 ID를 찾거나 생성해 반환한다.
 *  같은 (parentId,userEmail) 동시 호출은 첫 호출의 Promise를 공유한다. */
export function ensureEmailSubFolder(
  parentId: string,
  userEmail: string,
  opts: EnsureEmailSubFolderOpts,
): Promise<string> {
  const key = JSON.stringify([parentId, userEmail]);
  const existing = inFlight.get(key);
  if (existing) return existing;
  const p = ensureEmailSubFolderUncached(parentId, userEmail, opts);
  inFlight.set(key, p);
  void p.finally(() => inFlight.delete(key)).catch(() => {});
  return p;
}

async function ensureEmailSubFolderUncached(
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
  const sr = await fetch(searchUrl, { headers: opts.headers, signal: timeoutSignal() });
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
    signal: timeoutSignal(),
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => `HTTP ${createRes.status}`);
    throw new Error(`${opts.errorLabels.create}: ${err}`);
  }
  const created = (await createRes.json()) as { id: string };
  opts.writeCache?.(created.id);
  return created.id;
}
