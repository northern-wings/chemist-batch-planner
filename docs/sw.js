// Service worker: makes the planner work offline once it has been opened once.
// Strategy: answer from the cache immediately, refresh the cache in the background, so a new version
// shows up the next time the app is opened. Bump CACHE only if you want to force a clean slate.
const CACHE = "chem-planner-v1";
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./fonts/fonts.css",
  "./fonts/noto-sans-latin-400-normal.woff2",
  "./fonts/noto-sans-latin-500-normal.woff2",
  "./fonts/noto-sans-latin-600-normal.woff2",
  "./fonts/noto-sans-latin-700-normal.woff2",
  "./fonts/noto-sans-mono-latin-400-normal.woff2",
  "./fonts/noto-sans-mono-latin-600-normal.woff2",
  "./fonts/pixelify-sans-latin-500-normal.woff2",
  "./fonts/pixelify-sans-latin-700-normal.woff2",
  "./fonts/vt323-latin-400-normal.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req)
        .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      const res = await net;
      if (res) return res;
      if (req.mode === "navigate") return (await cache.match("./index.html")) || Response.error();
      return Response.error();
    })
  );
});
