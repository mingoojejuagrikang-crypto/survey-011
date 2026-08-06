import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

const BUILD_DATE = (() => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
})();

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
  plugins: [
    react(),
    VitePWA({
      // 🔴 v0.46.0 — **실기기 테스트 배포에서는 서비스워커를 끈다**(`PREVIEW_BUILD=1`).
      //   왜: ①민구 기기에 이미 프로덕션 PWA가 설치돼 있고 그 SW의 scope가 `/survey-011/`이다.
      //      테스트본이 캐시에 걸리면 **고친 것을 확인하러 갔다가 옛 화면을 본다**(그리고 그것을
      //      「안 고쳐졌다」로 오판한다 — v0.44.1 배포 때 실제로 겪었다: "앱을 완전히 껐다 다시
      //      열어야 받는다"). ②테스트본이 기기에 **두 번째 PWA로 설치되는 것**도 막는다.
      //   👉 캐시가 없으므로 재배포하면 새로고침만으로 최신이 보인다. 프로덕션 빌드는 무영향
      //      (환경변수가 없으면 종전 그대로).
      //   ⚠️ `process.env`를 직접 쓰지 않는다 — 이 파일은 `@types/node` 없이 타입 검사되므로
      //      `Cannot find name 'process'`로 빌드가 죽는다(실측). `--mode`로 가르는 길도 있으나
      //      mode는 빌드 최적화 경로에 영향을 줄 수 있어 **테스트본과 프로덕션의 번들이 갈린다.**
      //      그래서 mode는 건드리지 않고 환경변수만 타입 안전하게 읽는다.
      disable:
        (globalThis as { process?: { env?: Record<string, string | undefined> } })
          .process?.env?.PREVIEW_BUILD === '1',
      // v0.18.0 1f — 비강제(프롬프트) 업데이트. autoUpdate의 silent 강제 리로드를 제거하고
      // main.tsx의 registerSW(onNeedRefresh/onRegisteredSW)로 수동 등록한다. injectRegister:null로
      // 플러그인 자동 주입을 끄고(이중 등록 방지) main에서 한 번만 등록한다. iOS standalone에서
      // 새 버전을 silent 리로드 없이 "새 버전" 배너로 안내(현장 음성 측정 중 강제 리로드 금지).
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icon.svg', 'icon-192.svg', 'icon-512.svg', 'maskable-icon-512.svg'],
      manifest: {
        name: 'survey-011',
        short_name: 'survey-011',
        description: '음성 입력 기반 현장 측정 기록 PWA',
        lang: 'ko',
        theme_color: '#0E0F11',
        background_color: '#0E0F11',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' },
          { src: 'maskable-icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-fonts',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
