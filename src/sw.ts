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

// Case / delivery photos from Supabase Storage. Migration 018 (A2) made the
// bucket private: URLs are now short-lived SIGNED ones
// (/object/sign/... with a ?token=... query string that changes on every
// re-sign), not permanent /object/public/... ones.
//
// ignoreSearch is load-bearing, not cosmetic: without it, every fresh
// fetchCases() call mints a NEW token for the same unchanged photo, so the
// cache would never hit — every load would silently become a live fetch,
// quietly breaking the 7-day offline goal this route exists for. With it,
// the cache keys on the path alone, which case-photos already relies on
// (case_photos rows are never updated/deleted — no upload ever changes what
// a given path points to), so ignoring the token doesn't risk serving
// stale content — the underlying bytes for that path never change.
//
// What this does NOT do: retroactively purge a photo a device already
// cached before its case was hidden — CacheFirst never re-validates a hit
// against the network at all. See the 'purge-case-photos' message handler
// below for the mitigation (same-tab and same-session reach, not a global
// revoke — there is no such thing for a per-device cache).
registerRoute(
  ({ url }) =>
    url.hostname.endsWith('.supabase.co') &&
    url.pathname.startsWith('/storage/v1/object/sign/'),
  new CacheFirst({
    cacheName: 'case-photos',
    matchOptions: { ignoreSearch: true },
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 })],
  })
);

// ---------------------------------------------------------------------------
// Cache purge on hide (migration 018, A2)
// ---------------------------------------------------------------------------
// Triggered from the app (api.ts purgeCachedCasePhotos()) directly on admin
// hide, and from every other open tab's useCases()/useCase() reacting to
// the realtime UPDATE — so any tab that had this case's photos cached drops
// them close to immediately, instead of waiting out the 7-day expiry above.
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as { type?: string; caseId?: string } | undefined;
  if (data?.type === 'purge-case-photos' && data.caseId) {
    event.waitUntil(purgeCasePhotoCache(data.caseId));
  }
});

async function purgeCasePhotoCache(caseId: string): Promise<void> {
  const cache = await caches.open('case-photos');
  const requests = await cache.keys();
  const marker = `/case-photos/${caseId}/`;
  await Promise.all(
    requests.filter((req) => req.url.includes(marker)).map((req) => cache.delete(req))
  );
}

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
