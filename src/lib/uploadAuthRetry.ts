/**
 * v0.50 [UPLOAD-AUTH-1] — **로그 백업의 인증 실패 자동 재시도**(순수 모듈).
 *
 * ## 왜 있나 — 2026-08-19 실측
 * 로그 백업이 그날 **5회 중 4회 첫 시도에 실패**했고, 실패 4건의 모양이 전부 같았다:
 * ```
 * drive_upload:partial:fail=user_drive,admin_drive     ← 첫 시도(401/403)
 *   → login_prompt_login_clicked → auth_signin_start → auth_token_settled(939~2000ms)
 * drive_upload:ok                                       ← 재시도는 전부 성공
 * ```
 * **만료된 토큰으로 업로드를 시작한 것이 근인**이고, 갱신은 사용자가 로그인 버튼을 눌러야
 * 일어났다. 그 클릭이 없던 세션(양혁진 07:24)은 로그가 **6시간 뒤 수동 재업로드 전까지
 * Drive에 없었다** — 클립 소실 조사의 핵심 증거가 그동안 통째로 비어 있었다.
 *
 * ## 🔴 왜 재시도가 **1회**인가
 * 근인이 「만료된 토큰」이라 갱신 한 번이면 끝난다. 그 이상 반복하면 다른 원인일 때 사용자만
 * 기다리게 된다 — v0.22.0 P0가 자동 재시도 폭주(`clip_empty`×41)로 되돌린 실수를 반복하지 않는다.
 *
 * ## 왜 별도 파일인가
 * `driveUpload.ts`는 `import.meta.env`(Vite 전용)를 읽어 **Node 단위 테스트에서 import가 죽는다.**
 * 이 모듈은 브라우저·env·fetch 의존이 0이라 주입만으로 계약 전체를 잠글 수 있다
 * (`driveFolders.ts` 분리와 같은 계보).
 */

/** 업로드 결과 중 이 모듈이 보는 최소 형태(구조적 타이핑 — `DualUploadResult`가 그대로 들어맞는다). */
export interface UploadLegsResult {
  errors: string[];
  userDriveId?: string;
  adminDriveId?: string;
}

/** 실패 사유가 **인증**인가(401/403). 종전 `useDataActions`의 지역 판정을 여기로 올린다 —
 *  재시도 결정과 재로그인 신호(`needsLogin`)가 같은 기준을 써야 한다. */
export function isAuthError(msg: string): boolean {
  return /\b(401|403)\b/.test(msg) || /로그인이 필요/.test(msg);
}

/** 업로드 실패 사유를 **로그에 남길 수 있는 형태**로 깎는다.
 *
 *  🔴 비밀은 절대 싣지 않는다(`googleAuth` §signOut과 같은 계약): 이메일·액세스 토큰 패턴을
 *  마스킹하고, 개행을 접고, 길이를 자른다. 남는 것은 레그 이름 + status + 짧은 사유뿐이다.
 *  종전엔 `e.split(':')[0]`으로 **레그 이름만** 남아 「왜 죽었는지」가 로그에 없었다 —
 *  그래서 이번 조사도 인증 이벤트와의 **시간 대조**로만 근인을 잡을 수 있었다. */
export function sanitizeUploadError(raw: string): string {
  return raw
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/Bearer\s+\S+/gi, '<token>')
    .replace(/\b(ya29|1\/\/)[\w.\-/]+/g, '<token>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** 인증 실패면 **토큰을 강제 갱신하고 정확히 1회** 다시 올린다.
 *
 *  @param upload 실제 업로드(레그 2개를 자체 처리한다 — 부분 성공도 결과에 담겨 온다)
 *  @param ensureAuth 유효 토큰 보장. `force`는 「서버가 이미 거부했으니 저장 토큰이 만료 전으로
 *    보여도 새로 받아라」다. **throw하지 않고 성공 여부를 돌려주는 계약**이어야 한다.
 *  @param onRetry 재시도 직전 훅(계측 전용).
 *
 *  🔑 제네릭인 이유: 호출부의 결과 타입(`DualUploadResult`의 `adminConfigured` 등)을 **그대로**
 *  통과시킨다. 여기서 좁히면 호출부가 자기 필드를 잃는다. */
export async function withAuthRetry<T extends UploadLegsResult>(deps: {
  /** 🔴 v0.50 r2 [UA-2] — 재시도 호출에는 **이미 성공한 레그**가 `keep`으로 넘어온다.
   *  구현은 그 레그를 다시 올리지 않고 넘겨받은 id를 그대로 결과에 싣는다. 넘기지 않으면
   *  「admin만 401」 같은 부분 실패에서 **user Drive에 같은 파일이 두 개** 생긴다. */
  upload: (keep?: { userDriveId?: string; adminDriveId?: string }) => Promise<T>;
  ensureAuth: (opts?: { force?: boolean }) => Promise<boolean>;
  onRetry?: () => void;
}): Promise<T> {
  const first = await deps.upload();
  if (!first.errors.some(isAuthError)) return first;
  if (!(await deps.ensureAuth({ force: true }))) return first;
  deps.onRetry?.();
  const second = await deps.upload({
    userDriveId: first.userDriveId,
    adminDriveId: first.adminDriveId,
  });
  // 🔑 재시도가 더 나빠지는 경우를 없다고 가정하지 않는다 — 두 번째가 아무 레그도 못 얻었는데
  //    첫 번째가 한쪽이라도 붙였다면 **첫 결과를 지키는 쪽이 데이터 안전이다**(부분 성공 보존).
  const secondGained = !!second.userDriveId || !!second.adminDriveId;
  const firstGained = !!first.userDriveId || !!first.adminDriveId;
  return secondGained || !firstGained ? second : first;
}
