/// <reference lib="webworker" />

// The offline shell. Hand-written rather than generated, because the one
// decision that matters here cannot be expressed in `generateSW` config.
//
// THE ACCESS PROBLEM. This app sits behind Cloudflare Access, which answers an
// expired session by redirecting to a login page on another origin. The obvious
// service worker — precache index.html, serve it for every navigation — turns
// that into a lockout: the app boots from cache, /api/* fails, and the reload
// that would normally take the user to Access is served from cache too. There
// is no way back in short of clearing site data. An Access session expires on a
// schedule (24h by default), so this is a daily event, not an edge case.
//
// So navigations go to the NETWORK FIRST and fall back to the cache only when
// the network does not answer at all. Online, that is exactly the behaviour
// without a service worker, Access redirect included. Offline, it is the whole
// app. The cost is one request per page load, which is what the browser was
// doing anyway — and the app uses hash routing, so a page load happens once.
//
// Static assets go cache-first, which is where the actual speed comes from and
// is safe because Vite content-hashes their filenames: a changed file is a
// changed URL, never a stale hit.
//
// /api/* is never touched, in either direction. A cached /api/sync/me would
// hand the app a role the server has revoked; a cached pull would apply old
// rows over newer local ones.

interface ManifestEntry {
  url: string;
  revision: string | null;
}

// `__WB_MANIFEST` is written into this file by the build, so it is not on the
// standard ServiceWorkerGlobalScope type.
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: ManifestEntry[] };

// Injected at build time by vite-plugin-pwa (injectManifest). The literal name
// is what the injection looks for — do not rename or destructure it.
const MANIFEST: ManifestEntry[] = self.__WB_MANIFEST;

// One cache per build. Derived from the manifest rather than from a version
// constant nobody would remember to bump: every asset URL is content-hashed, so
// this string changes exactly when the built output does.
function fingerprint(entries: ManifestEntry[]): string {
  const source = entries.map((e) => `${e.url}#${e.revision ?? ""}`).join("|");
  // djb2. Not a security hash — it only has to differ between builds.
  let h = 5381;
  for (let i = 0; i < source.length; i++) h = ((h << 5) + h + source.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const CACHE = `invoice-shell-${fingerprint(MANIFEST)}`;

// The document served for a navigation we cannot reach the network for. Located
// rather than hardcoded because the two deploy targets mount at different bases
// (/invoice/ on GitHub Pages, / on Workers) and the manifest already carries the
// right one.
const SHELL =
  MANIFEST.find((e) => e.url.endsWith("index.html"))?.url ?? "index.html";

// ---------- lifecycle ----------

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(MANIFEST.map((e) => e.url))),
  );
  // Deliberately NO skipWaiting here. A new build waits until the user accepts
  // it (UpdatePrompt.tsx) or every tab closes; swapping the worker underneath a
  // running page can serve it assets from a build its HTML does not match.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every other build's cache. Without this, each deploy leaves its
      // full asset set behind forever.
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("invoice-shell-") && n !== CACHE)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// Sent by `updateSW(true)` when the user accepts the update. This is the only
// thing that promotes a waiting worker early.
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

// ---------- fetch ----------

async function shell(request: Request): Promise<Response> {
  try {
    // Any answer from the network wins, including a 302 into Access and
    // including a 500. Only a transport failure — genuinely offline — falls
    // through, which is what keeps an expired session recoverable.
    return await fetch(request);
  } catch {
    const cached = await caches.match(SHELL, { cacheName: CACHE });
    return cached ?? Response.error();
  }
}

async function asset(request: Request): Promise<Response> {
  const cached = await caches.match(request, { cacheName: CACHE });
  if (cached) return cached;
  // Not precached: a font, an image added later, a chunk from a build whose
  // cache has been cleaned. Fetch it, but do not store it — anything worth
  // keeping offline is in the manifest, and caching opportunistically here is
  // how a service worker quietly accumulates responses nobody reasoned about.
  return fetch(request);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Cross-origin (CDN, Access itself) and the API are both left entirely to the
  // browser. Returning without calling respondWith is what "not our business"
  // looks like — it is not the same as fetching and passing the result through,
  // which would strip the request of its default handling.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(shell(request));
    return;
  }
  event.respondWith(asset(request));
});

export {};
