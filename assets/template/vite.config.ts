import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // 三方库单独分包：react / dexie / supabase / date-fns 变动少，长期命中缓存，
        // 主包只装业务代码，冷启动更快。
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-dom/client'],
          'vendor-dexie': ['dexie', 'dexie-react-hooks'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-date': ['date-fns'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Ledger',
        short_name: 'Ledger',
        description: 'Sponsorship bookkeeping + publishing schedule for creators. Data stays on your device.',
        lang: 'en',
        // #efede6 = el 皮肤页底 --el-bg 字面值（安卓 standalone 状态栏是实色块，
        // 与页底不一致会露出接缝；四个 tab 均为字面浅色皮肤，故单一浅色即正确）
        theme_color: '#efede6',
        background_color: '#efede6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        runtimeCaching: [{
          urlPattern: /^https:\/\/cdn\.fontshare\.com\/.*\.woff2$/i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'fontshare-fonts',
            expiration: { maxEntries: 12, maxAgeSeconds: 31536000 },
            cacheableResponse: { statuses: [0, 200] },
          },
        }],
      },
    }),
  ],
})
