/**
 * Key/byte storage on IndexedDB.
 *
 * Used for everything that does not fit in `localStorage`: the mounted disc file handle,
 * the virtual memory-card folder, save-state blobs and exported backups.
 *
 * IndexedDB is also what makes offline play possible: a `File` object survives a page
 * reload here, so the user can mount the same disc again without re-picking it.
 */

const DB_NAME = 'gta-store';
const DB_VERSION = 1;

/** Object stores. Keep them coarse: one store per data class, keyed by string. */
export type StoreName = 'kv' | 'files' | 'savestates' | 'memorycard';

const STORES: StoreName[] = ['kv', 'files', 'savestates', 'memorycard'];

export interface FileRecord {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  /** The original File/Blob handle. Storing it keeps the data on disk, not in RAM. */
  blob: Blob;
  /** SHA-256 of the first and last megabyte, used as a cheap integrity fingerprint. */
  fingerprint: string;
  savedAt: string;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

export class IndexedDbStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName: string = DB_NAME) {}

  get available(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
    });
    return this.dbPromise;
  }

  async put<T>(store: StoreName, key: string, value: T): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    await transactionDone(tx);
  }

  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    const db = await this.open();
    const tx = db.transaction(store, 'readonly');
    const result = await promisify<T | undefined>(tx.objectStore(store).get(key) as IDBRequest<T | undefined>);
    await transactionDone(tx);
    return result;
  }

  async delete(store: StoreName, key: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await transactionDone(tx);
  }

  async keys(store: StoreName): Promise<string[]> {
    const db = await this.open();
    const tx = db.transaction(store, 'readonly');
    const result = await promisify<IDBValidKey[]>(tx.objectStore(store).getAllKeys());
    await transactionDone(tx);
    return result.map(String);
  }

  async entries<T>(store: StoreName): Promise<T[]> {
    const db = await this.open();
    const tx = db.transaction(store, 'readonly');
    const result = await promisify<T[]>(tx.objectStore(store).getAll() as IDBRequest<T[]>);
    await transactionDone(tx);
    return result;
  }

  async clear(store: StoreName): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    await transactionDone(tx);
  }

  async close(): Promise<void> {
    if (!this.dbPromise) return;
    const db = await this.dbPromise;
    db.close();
    this.dbPromise = null;
  }
}

/** A single shared instance for the whole application. */
export const db = new IndexedDbStore();

/** Ask the browser to keep our data when it is under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface StorageEstimate {
  usageBytes: number | null;
  quotaBytes: number | null;
  persisted: boolean;
}

export async function estimateStorage(): Promise<StorageEstimate> {
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  let persisted = false;
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      usageBytes = estimate.usage ?? null;
      quotaBytes = estimate.quota ?? null;
    }
    if (navigator.storage?.persisted) persisted = await navigator.storage.persisted();
  } catch {
    /* browsers may throw when the API is restricted */
  }
  return { usageBytes, quotaBytes, persisted };
}

/** Classify an IndexedDB write failure so the interface can explain what happened. */
export function describeStorageError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') {
      return 'Espaço de armazenamento esgotado. Libere espaço ou reduza os dados salvos.';
    }
    if (error.name === 'AbortError') {
      return 'A gravação foi interrompida antes de terminar.';
    }
    return `Falha de armazenamento: ${error.name}.`;
  }
  if (error instanceof Error) return `Falha de armazenamento: ${error.message}`;
  return 'Falha de armazenamento desconhecida.';
}
