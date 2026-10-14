import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// §13 PWA: v2計画の設定を継承し名称/URLをMemorixへ変更。
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Memorix',
        short_name: 'Memorix',
        description: '穴埋めクイズをつくる・とく・シェアする',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // §8.4のセッション提出等は絶対にキャッシュしない。
        navigateFallbackDenylist: [/^\/api\/sessions/],
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) =>
              url.pathname.startsWith('/api/discover') || url.pathname.startsWith('/api/subjects'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-discover-subjects',
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/img/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/api/sessions'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  build: {
    outDir: 'dist',
  },
});
