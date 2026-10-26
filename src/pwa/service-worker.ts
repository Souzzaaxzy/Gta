/**
 * Service worker registration and offline-readiness reporting.
 *
 * Registration is skipped in development (`import.meta.env.DEV`) because Vite's dev server
 * serves modules the worker would cache and mask.
 */

export interface PrecacheProgress {
  loaded: number;
  total: number;
  done: boolean;
}

export type ServiceWorkerState = 'unsupported' | 'registering' | 'installed' | 'ready' | 'error';

export interface ServiceWorkerStatus {
  state: ServiceWorkerState;
  /** A newer worker is waiting to take over. */
  updateAvailable: boolean;
  /** The precache finished, so the shell can be opened with no network. */
  offlineReady: boolean;
  progress: PrecacheProgress | null;
  error: string | null;
}

export class ServiceWorkerController {
  private status: ServiceWorkerStatus = {
    state: 'unsupported',
    updateAvailable: false,
    offlineReady: false,
    progress: null,
    error: null,
  };

  private readonly listeners = new Set<(status: ServiceWorkerStatus) => void>();

  constructor(private readonly onProgress?: (progress: PrecacheProgress) => void) {}

  get current(): ServiceWorkerStatus {
    return this.status;
  }

  subscribe(listener: (status: ServiceWorkerStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<ServiceWorkerStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }

  async register(): Promise<ServiceWorkerStatus> {
    if (!('serviceWorker' in navigator)) {
      this.set({ state: 'unsupported' });
      return this.status;
    }
    if (import.meta.env.DEV) {
      this.set({ state: 'unsupported', error: 'Service worker desativado no ambiente de desenvolvimento.' });
      return this.status;
    }

    this.set({ state: 'registering' });
    try {
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data as { type?: string; loaded?: number; total?: number; done?: boolean } | null;
        if (data?.type === 'precache-progress' && typeof data.loaded === 'number' && typeof data.total === 'number') {
          const progress: PrecacheProgress = { loaded: data.loaded, total: data.total, done: data.done === true };
          this.set({ progress, offlineReady: progress.done || this.status.offlineReady });
          this.onProgress?.(progress);
        }
      });

      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

      if (registration.waiting) this.set({ updateAvailable: true });

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            this.set({ updateAvailable: true });
          }
        });
      });

      await navigator.serviceWorker.ready;
      this.set({ state: 'ready' });
      return this.status;
    } catch (error) {
      this.set({ state: 'error', error: error instanceof Error ? error.message : String(error) });
      return this.status;
    }
  }

  /** Activate a waiting worker immediately and reload once it takes control. */
  async applyUpdate(): Promise<void> {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.waiting) {
      window.location.reload();
      return;
    }
    const reload = () => window.location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
    registration.waiting.postMessage({ type: 'skip-waiting' });
  }

  /** Ask the worker to drop its caches. */
  async clearCaches(): Promise<void> {
    const registration = await navigator.serviceWorker.getRegistration();
    registration?.active?.postMessage({ type: 'clear-cache' });
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch {
      /* Cache API may be unavailable */
    }
    this.set({ offlineReady: false, progress: null });
  }
}

/**
 * Whether the essential resources are stored and the app can start with no network.
 * Checks the emulator core, which is the single resource the app cannot run without.
 */
export async function checkOfflineReadiness(): Promise<{ ready: boolean; missing: string[] }> {
  if (!('caches' in window)) return { ready: false, missing: ['Cache API indisponível'] };

  const required = ['/emulator/Play.js', '/emulator/Play.wasm'];
  const missing: string[] = [];
  const keys = await caches.keys();
  for (const url of required) {
    let found = false;
    for (const key of keys) {
      const cache = await caches.open(key);
      if (await cache.match(url)) {
        found = true;
        break;
      }
    }
    if (!found) missing.push(url);
  }
  return { ready: missing.length === 0, missing };
}

export function isOnline(): boolean {
  return navigator.onLine;
}

/** Subscribe to connectivity changes. */
export function watchConnectivity(onChange: (online: boolean) => void): () => void {
  const online = () => onChange(true);
  const offline = () => onChange(false);
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  onChange(navigator.onLine);
  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
  };
}
