/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

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
