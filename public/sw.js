const CACHE = "dataset-analyzer-v1";
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE)); self.skipWaiting(); });
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(res => {
    if (res.ok && new URL(event.request.url).origin === self.location.origin) caches.open(CACHE).then(c => c.put(event.request, res.clone()));
    return res;
  }).catch(() => hit)));
});