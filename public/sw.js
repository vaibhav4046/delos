// Del Rio · DelOS — offline-shell service worker.
//
// Strategy:
//   • Navigations (HTML)  → network-first (with navigationPreload), fall back
//     to cached shell, then to a branded /offline.html. Keeps content fresh
//     online, app-launchable offline.
//   • Static same-origin   → stale-while-revalidate (instant + self-healing).
//   • /api/* and SSE       → never touched (always live; POST/stream-safe).
//   • Cross-origin         → passthrough to the browser.
// Bump CACHE to invalidate the precache after a deploy.

const CACHE = "delrio-v4";
const OFFLINE_URL = "/offline.html";
const SHELL = [
  "/",
  "/os",
  "/play",
  "/live",
  "/install",
  "/scorecard",
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-192.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // addAll is atomic — one 404 aborts the whole precache. Add individually
      // and tolerate misses so a single missing route never breaks install.
      Promise.all(SHELL.map((u) => c.add(u).catch(() => undefined))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // Enable navigation preload so the network fetch for a navigation starts
      // in parallel with SW boot instead of waiting for it.
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch { /* unsupported */ }
      }
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Allow the page to trigger an immediate activation after an update.
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin → browser
  if (url.pathname.startsWith("/api/")) return;     // live APIs / SSE — never cache

  // Navigations: network-first → cache → offline page.
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const preload = await e.preloadResponse;
          if (preload) {
            caches.open(CACHE).then((c) => c.put(req, preload.clone())).catch(() => {});
            return preload;
          }
          const net = await fetch(req);
          if (net && net.ok && net.type === "basic") {
            caches.open(CACHE).then((c) => c.put(req, net.clone())).catch(() => {});
          }
          return net;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          const shell = await caches.match("/os");
          if (shell) return shell;
          return (await caches.match(OFFLINE_URL)) || Response.error();
        }
      })(),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
