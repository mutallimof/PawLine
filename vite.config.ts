import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * PawLine build configuration.
 *
 * The PWA plugin generates the web app manifest and a service worker:
 *  - The app shell (JS/CSS/fonts) is precached, so the UI opens instantly
 *    and works full-screen when installed to the home screen.
 *  - OpenStreetMap tiles and Supabase Storage photos are cached at runtime
 *    (cache-first with expiry) so recently viewed maps/photos still render
 *    on a flaky connection — common in the field during a rescue.
 *  - API/realtime traffic is NOT cached: case status and chat must be live.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Split heavyweight vendors so the app shell paints fast on mobile.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      // injectManifest: we ship our own service worker (src/sw.ts) so it can
      // handle Web Push events in addition to precaching/runtime caching.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'PawLine — Stray Animal Rescue',
        short_name: 'PawLine',
        description:
          'Report injured stray animals, rescue them, and get them to a vet — together.',
        theme_color: '#E85D4A',
        background_color: '#FAF3EE',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'en',
        categories: ['social', 'lifestyle'],
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
});
