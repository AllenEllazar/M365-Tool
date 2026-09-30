/* Service worker for the M365 Admin Tool.
 *
 * It exists for two reasons: it makes the app installable on a phone, and it
 * shows a friendly page instead of the browser's error when there's no signal.
 *
 * It deliberately does NOT cache API responses, sign-in routes, or HTML pages.
 * This is an admin tool showing live tenant data behind a Microsoft sign-in;
 * a stale or cached copy of any of that is worse than a clear "you're offline".
 *
 * Bump CACHE_VERSION whenever the precached files below change.
 */

const CACHE_VERSION = "v1";
const CACHE = "m365-admin-" + CACHE_VERSION;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/logo.png", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Fonts, Microsoft sign-in and anything else on another origin: not ours to touch.
  if (url.origin !== self.location.origin) return;

  // Live data and authentication always go straight to the network, uncached.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname === "/gate"
  ) {
    return;
  }

  // Opening the app: always the network. Only if that fails do we show the offline page.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Static files (css, js, images): network first so a new deploy shows up immediately,
  // with the last good copy as a fallback when there's no connection.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
