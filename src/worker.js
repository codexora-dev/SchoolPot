/* global self, caches */
const VERSION = '__BUILD_VERSION__';
const CACHE = `schoolpot-ui-${VERSION}`;
const FILES = '__PRECACHE_FILES__';
const base = new URL('./', self.location.href);
const urls = (Array.isArray(FILES) ? FILES : []).map((file) => new URL(file, base).href);
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(urls)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Retain the previous shell for tabs which have not accepted the update yet.
      const keys = (await caches.keys()).filter(
        (key) => key.startsWith('schoolpot-ui-') && key !== CACHE,
      );
      await Promise.all(keys.slice(0, -1).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
  if (event.data?.type === 'VERSION') event.ports[0]?.postMessage(VERSION);
});
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== base.origin ||
    !url.pathname.startsWith(base.pathname)
  )
    return;
  if (request.mode === 'navigate') {
    // Never cache navigation responses, authentication, API responses or user content.
    event.respondWith(fetch(request).catch(() => caches.match(new URL('offline.html', base).href)));
  } else if (urls.includes(url.href)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        return cached || fetch(request);
      })(),
    );
  }
});
function notificationPath(value) {
  return typeof value === 'string' &&
    /^#\/(notifications|account-status|profile|feedback|activity\?kind=reports|admin\?tab=(appeals|requests|feedback)|post\/[0-9a-f-]{36}(\?comment=[0-9a-f-]{36})?|notice\/[0-9a-f-]{36})$/.test(
      value,
    )
    ? value
    : '#/notifications';
}
self.addEventListener('push', (event) => {
  // Fixed generic content: no message bodies, usernames, sanctions or endpoint data on lock screens.
  let tag = 'schoolpot-news',
    path = '#/notifications';
  try {
    const data = event.data?.json();
    tag = String(data?.tag || tag).slice(0, 100);
    path = notificationPath(data?.path);
  } catch {
    /* Generic notification remains valid. */
  }
  event.waitUntil(
    self.registration.showNotification('스쿨팟', {
      body: '새로운 소식이 있어요. 앱에서 확인해 주세요.',
      icon: new URL('icons/icon-192.png', base).href,
      badge: new URL('icons/icon-192.png', base).href,
      tag,
      data: { path },
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL('./' + notificationPath(event.notification.data?.path), base).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((client) => client.url.startsWith(base.href));
      if (existing) {
        await existing.navigate(target);
        await existing.focus();
      } else await self.clients.openWindow(target);
    })(),
  );
});
