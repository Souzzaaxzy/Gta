/// <reference lib="webworker" />

/**
 * Service worker for the Gta shell.
 *
 * Responsibilities:
 * - Precache the application shell and the emulator core, so the site opens offline after
 *   the first visit.
 * - Serve cached assets for navigation and static requests, revalidating in the background.
 * - Report download progress to the page.
 *
 * It deliberately does NOT cache or touch the user's disc image, save states or memory
 * card. Those live in IndexedDB, which is not reachable from here.
 */

declare const self: ServiceWorkerGlobalScope;

interface PrecacheEntry {
  url: string;
  size: number;
}

interface PrecacheManifest {
  buildId: string;
  generatedAt: string;
  entries: PrecacheEntry[];
}

const CACHE_PREFIX = 'gta-shell-';
const RUNTIME_CACHE = 'gta-runtime';
const MANIFEST_URL = '/precache-manifest.json';

/** Assets that must never be served stale: the worker itself and the manifest. */
const NEVER_CACHE = [MANIFEST_URL, '/sw.js'];

function cacheNameFor(buildId: string): string {
  return `${CACHE_PREFIX}${buildId}`;
}

async function readManifest(): Promise<PrecacheManifest> {
  const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`precache manifest: HTTP ${response.status}`);
  return (await response.json()) as PrecacheManifest;
}

async function postProgress(loaded: number, total: number, done: boolean): Promise<void> {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'precache-progress', loaded, total, done });
  }
}

async function precache(): Promise<void> {
  const manifest = await readManifest();
  const cacheName = cacheNameFor(manifest.buildId);
  const cache = await caches.open(cacheName);

  const existing = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
  const pending = manifest.entries.filter((entry) => !existing.has(entry.url));
  const total = manifest.entries.length;
  let loaded = total - pending.length;

  await postProgress(loaded, total, false);

  // Fetch in small batches: a single Promise.all over the 2.6 MB wasm plus dozens of
  // chunks can exhaust the connection pool and stall the install.
  const BATCH = 6;
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (entry) => {
        try {
          const response = await fetch(entry.url, { cache: 'no-cache' });
          if (response.ok) await cache.put(entry.url, response);
        } catch (error) {
          console.warn('[sw] failed to precache', entry.url, error);
        } finally {
          loaded++;
          await postProgress(loaded, total, false);
        }
      }),
    );
  }

  await postProgress(total, total, true);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await precache();
      } catch (error) {
        // A failed precache must not block activation: the app still works online.
        console.warn('[sw] precache failed', error);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const buildId = await currentBuildId();
      const keep = cacheNameFor(buildId);
      const keys = await caches.keys();
      // Drop old shell caches; the runtime cache is versionless and is kept.
      await Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== keep).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

let cachedBuildId: string | null = null;
async function currentBuildId(): Promise<string> {
  if (cachedBuildId) return cachedBuildId;
  try {
    const manifest = await readManifest();
    cachedBuildId = manifest.buildId;
  } catch {
    cachedBuildId = 'unknown';
  }
  return cachedBuildId;
}

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === 'skip-waiting') {
    void self.skipWaiting();
  }
  if (data?.type === 'clear-cache') {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) || key === RUNTIME_CACHE).map((key) => caches.delete(key)));
      })(),
    );
  }
});

/** True for the immutable, content-addressed or versioned assets under /emulator/ and /assets/. */
function isImmutable(url: URL): boolean {
  return url.pathname.startsWith('/emulator/') || url.pathname.startsWith('/assets/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.includes(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isImmutable(url)) {
    event.respondWith(handleImmutable(request));
    return;
  }

  event.respondWith(handleRuntime(request));
});

/**
 * Navigation: prefer the network so a new deploy is picked up immediately, but fall back to
 * the cached shell so the app still opens with no connection.
 */
async function handleNavigation(request: Request): Promise<Response> {
  const buildId = await currentBuildId();
  try {
    const response = await fetch(request);
    const cache = await caches.open(cacheNameFor(buildId));
    if (response.ok) await cache.put('/index.html', response.clone());
    return response;
  } catch {
    const cache = await caches.open(cacheNameFor(buildId));
    const cached = (await cache.match(request)) ?? (await cache.match('/index.html'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:system-ui;background:#08080c;color:#e8e4d8;padding:2rem"><h1>Sem conexão</h1><p>Abra o aplicativo uma vez com internet para que os arquivos essenciais sejam guardados.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

/** Immutable assets: cache first, no revalidation. */
async function handleImmutable(request: Request): Promise<Response> {
  const buildId = await currentBuildId();
  const cache = await caches.open(cacheNameFor(buildId));
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
  }
  return response;
}

/** Everything else: serve the cache, refresh it in the background. */
async function handleRuntime(request: Request): Promise<Response> {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const response = await network;
  if (response) return response;
  return new Response('Recurso indisponível offline.', {
    status: 504,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export {};
