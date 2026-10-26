/** Small helpers shared across modules. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Yield to the event loop so long-running work does not block the interface. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Coalesce rapid calls into one per animation frame. Keeps the measurement overlay
 * and canvas resizing cheap during gameplay.
 */
export function rafThrottle<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  let scheduled = false;
  let lastArgs: A;
  return (...args: A) => {
    lastArgs = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...lastArgs);
    });
  };
}

/** Extension (lowercase, with dot) of a file name. Returns '' when there is none. */
export function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  if (index <= 0) return '';
  return fileName.slice(index).toLowerCase();
}

/** Byte length, in bytes, of a base64 string. */
export function base64ByteLength(base64: string): number {
  const clean = base64.replace(/=+$/, '');
  return Math.floor((clean.length * 3) / 4);
}

/** Deterministic hex digest of a byte buffer. Used for integrity checks, never for security. */
export async function digest(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Copy into a fresh buffer so a SharedArrayBuffer-backed view is accepted by SubtleCrypto.
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const hash = await crypto.subtle.digest('SHA-256', copy);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
