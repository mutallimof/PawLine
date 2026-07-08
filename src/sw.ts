/// <reference lib="webworker" />
/* ============================================================================
 * PawLine — custom service worker (vite-plugin-pwa injectManifest strategy).
 *
 * Replaces the previous auto-generated worker so we can handle Web Push:
 *  - Precache the app shell (same behavior as before).
 *  - Runtime-cache OSM tiles + case photos (same behavior as before).
 *  - `push` → show a system notification even when the app is closed.
 *  - `notificationclick` → focus/open the app at the deep link.
 *
 * NOTE: this file is bundled by vite-plugin-pwa (not the app's tsc pass),
 * hence it's excluded from tsconfig.app.json's include list.
 * ==========================================================================*/

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

// App shell — injected at build time.
precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// (Google Maps tiles are deliberately NOT runtime-cached: their URLs are
// session-tokenized and caching them violates the Maps ToS.)

// Case / delivery photos from Supabase Storage.
registerRoute(
  ({ url }) =>
    url.hostname.endsWith('.supabase.co') &&
    url.pathname.startsWith('/storage/v1/object/public/'),
  new CacheFirst({
    cacheName: 'case-photos',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 })],
  })
);

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

interface PushPayload {
  title?: string;
  body?: string;
  url?: string;
}

self.addEventListener('push', (event: PushEvent) => {
  let data: PushPayload = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() ?? '' };
  }

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'PawLine', {
      body: data.body ?? '',
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      data: { url: data.url ?? '/' },
      tag: data.url ?? undefined, // collapse repeat alerts for the same case
    })
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/';

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse an open PawLine window if there is one.
      for (const client of all) {
        if ('focus' in client) {
          await (client as WindowClient).focus();
          if ('navigate' in client) await (client as WindowClient).navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
