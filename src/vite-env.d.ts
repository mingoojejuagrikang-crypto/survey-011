/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
/** v0.46.0 — 테스트 배포본(`PREVIEW_BUILD=1`)인가. 화면 배지 + 로그 `appVersion` 접미사에 쓴다.
 *  프리뷰는 bump를 안 해 프로덕션과 버전 문자열이 같아질 수 있다(08-06 실측) — 이게 유일한 구분축. */
declare const __PREVIEW_BUILD__: boolean;

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_GOOGLE_API_KEY?: string;
  readonly VITE_ADMIN_LOGS_FOLDER_ID?: string;
  /** v0.33.0 항목11 — 개선요청 zip 관리자 수신 폴더(미설정 시 관리자 레그 skip). */
  readonly VITE_ADMIN_FEEDBACK_FOLDER_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
