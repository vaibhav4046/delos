// Del Rio · DelOS — offline shell service worker.
// Caches static shell so /os boots without network. APIs never cached.

const CACHE = "delrio-v3";
const SHELL = [
  "/",
  "/os",
  "/play",
  "/demo",
  "/scorecard",
  "/icon.svg",
  "/logo.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(SHELL).catch(() => {
        // tolerate partial cache — install must not fail
      }),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache APIs or SSE streams
  if (url.pathname.startsWith("/api/")) return;
  // Cross-origin → let browser handle
  if (url.origin !== self.location.origin) return;
  // Stale-while-revalidate for shell
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
