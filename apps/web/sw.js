// Service worker: a cache for speed, not an offline mode. The app shell (index.html, scripts, styles)
// comes from the cache, so the PWA opens without waiting on a round trip to the server; fonts are cached
// the first time a page needs them. Of the API only word pictures go through here (see below).
//
// vite.config.ts fills in BUILD at build time: a version per build and the files to precache.
const BUILD = __BUILD__;
const PREFIX = "kquiz-shell-";
const CACHE = PREFIX + BUILD.version;
// The previous build's cache stays, so a page still running it can load its lazy files after an update.
const KEEP = 2;
// Pages of the app itself. /oauth/*, /api/* and the rest always go to the network.
const APP_PAGES = new Set(["/", "/index.html", "/login"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(BUILD.precache.map((path) => new Request(path, { cache: "reload" })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const order = (await caches.keys()).filter((key) => key.startsWith(PREFIX) && key !== CACHE);
      const stamps = await Promise.all(order.map(async (key) => [key, await installedAt(key)]));
      stamps.sort((a, b) => b[1] - a[1]);
      await Promise.all(stamps.slice(KEEP - 1).map(([key]) => caches.delete(key)));
      await stampCache(CACHE);
      await sweepPictures().catch(() => {});
      await self.clients.claim();
    })(),
  );
});

const STAMP = "/__installed-at";

async function stampCache(key) {
  const cache = await caches.open(key);
  if (!(await cache.match(STAMP))) await cache.put(STAMP, new Response(String(Date.now())));
}

async function installedAt(key) {
  const res = await (await caches.open(key)).match(STAMP);
  return res ? Number(await res.text()) || 0 : 0;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (request.mode === "navigate") {
    if (APP_PAGES.has(url.pathname)) event.respondWith(appPage(request));
    return;
  }
  if (url.pathname.startsWith("/assets/") || BUILD.precache.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (PICTURE_PATH.test(url.pathname)) {
    event.respondWith(picture(request));
    event.waitUntil(sweepPictures().catch(() => {}));
  }
});

// Word pictures (/api/pictures/<hash>): a new picture gets a new address, so a cached one is never
// stale. They live in a cache of their own, which outlasts builds; the app fetches a session's
// pictures as it starts (lib/pictureCache.ts). Each copy notes when it was last asked for, and one
// not asked for in two weeks is dropped, so the phone keeps only the pictures still in use.
const PICTURES = "kquiz-pictures";
const PICTURE_PATH = /^\/api\/pictures\/[0-9a-f]{32}$/;
const USED = "x-kquiz-used";
const DAY = 24 * 60 * 60 * 1000;
const PICTURE_TTL = 14 * DAY;

async function picture(request) {
  const cache = await caches.open(PICTURES);
  // An <img> and the app's own fetch ask with different headers; the picture is the same.
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) {
    // Noting the use once a day is enough for a two-week limit, and spares rewriting on every look.
    if (Date.now() - (Number(cached.headers.get(USED)) || 0) > DAY) {
      const copy = cached.clone();
      copy.blob().then((body) => cache.put(request, stamped(body, copy.headers))).catch(() => {});
    }
    return cached;
  }
  const res = await fetch(request);
  if (res.ok && res.type === "basic") {
    const copy = res.clone();
    copy.blob().then((body) => cache.put(request, stamped(body, copy.headers))).catch(() => {});
  }
  return res;
}

function stamped(body, headers) {
  const h = new Headers(headers);
  h.set(USED, String(Date.now()));
  return new Response(body, { status: 200, headers: h });
}

// Goes through the cache at most twice a day of the worker's life (it may be stopped and started
// any time, and then sweeps again on its first picture).
let swept = 0;
async function sweepPictures() {
  if (Date.now() - swept < DAY / 2) return;
  swept = Date.now();
  const cache = await caches.open(PICTURES);
  for (const request of await cache.keys()) {
    const res = await cache.match(request, { ignoreVary: true });
    if (!res || Date.now() - (Number(res.headers.get(USED)) || 0) > PICTURE_TTL) await cache.delete(request);
  }
}

// index.html from this build's cache. Updates arrive as a new worker, which the page checks for
// on every launch (main.tsx), so the next launch runs the new build.
async function appPage(request) {
  const cached = await caches.match("/index.html", { cacheName: CACHE });
  return cached ?? fetch(request);
}

// Built files have content hashes in their names, so a cached copy is never stale.
async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return res;
}
