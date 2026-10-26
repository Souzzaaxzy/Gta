import { db } from '@/storage/idb';
import type { PlayModule } from '@/emulator/play-module';
import { digest } from '@/utils/misc';

/**
 * Virtual memory card.
 *
 * Play! does not emulate a raw 8 MB `.ps2` card. It registers the I/O processor's `mc0`
 * device as a *directory* (`vfs/mc0`, see `PS2VM.cpp`), and games create ordinary folders
 * and files inside it. Persisting the card therefore means capturing that folder tree and
 * writing it back into the emulator's in-memory filesystem before the game boots.
 *
 * Everything is stored in IndexedDB and never leaves the device.
 *
 * `.ps2` interoperability (the 8 MB image PCSX2 uses) needs a filesystem layer with the
 * card's superblock, FAT and ECC. That is a separate, optional module; see
 * `docs/LEGAL-ASSETS.md` and `src/saves/ps2-image.ts`.
 */

const CARD_KEY = 'mc0';
const CARD_ROOT = '/vfs/mc0';
const MAX_DEPTH = 6;
const MAX_FILES = 4000;

export interface MemoryCardFile {
  /** Path relative to the card root, using forward slashes. */
  path: string;
  bytes: ArrayBuffer;
  modifiedAt: number;
}

export interface MemoryCardRecord {
  files: MemoryCardFile[];
  savedAt: string;
  fileCount: number;
  totalBytes: number;
  checksum: string;
}

export interface MemoryCardSummary {
  present: boolean;
  savedAt: string | null;
  fileCount: number;
  totalBytes: number;
  /** Save folders found on the card (folders containing `icon.sys`). */
  saveFolders: string[];
}

interface Dirent {
  name: string;
  isDirectory(): boolean;
}

interface EmscriptenFsWithReaddir {
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
}

/** Turn a mode bitmask into a directory test, working with either FS shape. */
function isDirectory(module: PlayModule, path: string): boolean {
  const fs = module.FS as unknown as Partial<EmscriptenFsWithReaddir>;
  if (typeof fs.stat === 'function' && typeof fs.isDir === 'function') {
    try {
      return fs.isDir(fs.stat(path).mode);
    } catch {
      return false;
    }
  }
  // Fall back to listing: a directory lists, a file throws.
  try {
    fs.readdir?.(path);
    return true;
  } catch {
    return false;
  }
}

function listDirectory(module: PlayModule, path: string): string[] {
  const fs = module.FS as unknown as Partial<EmscriptenFsWithReaddir>;
  try {
    const entries = fs.readdir?.(path) ?? [];
    return entries.filter((name: string) => name !== '.' && name !== '..');
  } catch {
    return [];
  }
}

function ensureDirectory(module: PlayModule, path: string): void {
  const parts = path.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    try {
      module.FS.mkdir(current);
    } catch {
      /* already exists */
    }
  }
}

/**
 * Captures and restores the `mc0` tree.
 *
 * Call `capture()` before the page unloads or periodically, and `restore()` before
 * `bootDiscImage()`. Restoring early matters: the game reads the card while it boots.
 */
export class MemoryCardManager {
  private module: PlayModule | null = null;
  private intervalHandle: number | null = null;

  attach(module: PlayModule): void {
    this.module = module;
  }

  /** True when the card filesystem is reachable. */
  get available(): boolean {
    if (!this.module) return false;
    return isDirectory(this.module, '/vfs') || this.tryCreateRoot();
  }

  private tryCreateRoot(): boolean {
    if (!this.module) return false;
    try {
      ensureDirectory(this.module, CARD_ROOT);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read the card from the emulator filesystem and store it.
   * Returns the summary, or null when the filesystem is not reachable yet.
   */
  async capture(): Promise<MemoryCardSummary | null> {
    const module = this.module;
    if (!module) return null;
    this.tryCreateRoot();

    const files: MemoryCardFile[] = [];
    let totalBytes = 0;

    const walk = (path: string, depth: number): void => {
      if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
      for (const name of listDirectory(module, path)) {
        const child = `${path}/${name}`;
        if (isDirectory(module, child)) {
          walk(child, depth + 1);
        } else {
          try {
            const bytes = module.FS.readFile(child);
            const copy = new Uint8Array(bytes.byteLength);
            copy.set(bytes);
            files.push({
              path: child.slice(CARD_ROOT.length + 1),
              bytes: copy.buffer,
              modifiedAt: Date.now(),
            });
            totalBytes += copy.byteLength;
          } catch (error) {
            console.warn(`[memory-card] could not read ${child}`, error);
          }
        }
      }
    };

    walk(CARD_ROOT, 0);

    if (files.length === 0) {
      // An empty card is a legitimate state: keep it, so the summary reflects reality.
      const empty: MemoryCardRecord = {
        files: [],
        savedAt: new Date().toISOString(),
        fileCount: 0,
        totalBytes: 0,
        checksum: '',
      };
      await db.put('memorycard', CARD_KEY, empty);
      return { present: true, savedAt: empty.savedAt, fileCount: 0, totalBytes: 0, saveFolders: [] };
    }

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const file of files) {
      combined.set(new Uint8Array(file.bytes), offset);
      offset += file.bytes.byteLength;
    }
    const checksum = (await digest(combined)).slice(0, 16);

    const record: MemoryCardRecord = {
      files,
      savedAt: new Date().toISOString(),
      fileCount: files.length,
      totalBytes,
      checksum,
    };
    await db.put('memorycard', CARD_KEY, record);
    return summarize(record);
  }

  /** Write the stored card back into the emulator filesystem. */
  async restore(): Promise<number> {
    const module = this.module;
    if (!module) return 0;
    const record = await db.get<MemoryCardRecord>('memorycard', CARD_KEY);
    if (!record || record.files.length === 0) return 0;

    ensureDirectory(module, CARD_ROOT);
    let restored = 0;
    for (const file of record.files) {
      const target = `${CARD_ROOT}/${file.path}`;
      const parent = target.slice(0, target.lastIndexOf('/'));
      try {
        ensureDirectory(module, parent);
        module.FS.writeFile(target, new Uint8Array(file.bytes));
        restored++;
      } catch (error) {
        console.warn(`[memory-card] could not restore ${target}`, error);
      }
    }
    return restored;
  }

  async summary(): Promise<MemoryCardSummary> {
    const record = await db.get<MemoryCardRecord>('memorycard', CARD_KEY);
    if (!record) return { present: false, savedAt: null, fileCount: 0, totalBytes: 0, saveFolders: [] };
    return summarize(record);
  }

  /** Export the stored card as a portable JSON bundle (original format, no proprietary data). */
  async exportBundle(): Promise<Blob | null> {
    const record = await db.get<MemoryCardRecord>('memorycard', CARD_KEY);
    if (!record) return null;
    const payload = {
      format: 'gta-memcard-bundle',
      version: 1,
      savedAt: record.savedAt,
      checksum: record.checksum,
      files: record.files.map((file) => ({
        path: file.path,
        modifiedAt: file.modifiedAt,
        base64: bytesToBase64(new Uint8Array(file.bytes)),
      })),
    };
    return new Blob([JSON.stringify(payload)], { type: 'application/json' });
  }

  /**
   * Import a bundle produced by `exportBundle()`.
   * Paths are treated as untrusted input: absolute paths, `..` segments and control
   * characters are rejected rather than sanitised silently.
   */
  async importBundle(file: File): Promise<MemoryCardSummary> {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('O arquivo não é um JSON válido.');
    }
    const payload = parsed as { format?: string; version?: number; files?: unknown };
    if (payload.format !== 'gta-memcard-bundle') {
      throw new Error('Formato de arquivo não reconhecido. Esperado "gta-memcard-bundle".');
    }
    if (!Array.isArray(payload.files)) {
      throw new Error('O arquivo não contém uma lista de arquivos.');
    }

    const files: MemoryCardFile[] = [];
    let totalBytes = 0;
    for (const entry of payload.files as Array<{ path?: unknown; base64?: unknown; modifiedAt?: unknown }>) {
      const path = typeof entry.path === 'string' ? entry.path : null;
      const base64 = typeof entry.base64 === 'string' ? entry.base64 : null;
      if (!path || !base64) continue;
      assertSafePath(path);
      const bytes = base64ToBytes(base64);
      totalBytes += bytes.byteLength;
      files.push({
        path,
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        modifiedAt: typeof entry.modifiedAt === 'number' ? entry.modifiedAt : Date.now(),
      });
    }

    if (files.length === 0) throw new Error('Nenhum arquivo válido encontrado no pacote.');

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const f of files) {
      combined.set(new Uint8Array(f.bytes), offset);
      offset += f.bytes.byteLength;
    }
    const checksum = (await digest(combined)).slice(0, 16);
    const record: MemoryCardRecord = {
      files,
      savedAt: new Date().toISOString(),
      fileCount: files.length,
      totalBytes,
      checksum,
    };
    await db.put('memorycard', CARD_KEY, record);
    return summarize(record);
  }

  async clear(): Promise<void> {
    await db.delete('memorycard', CARD_KEY);
  }

  /** Snapshot the card periodically and whenever the page is hidden. */
  startAutoPersist(intervalMs = 20_000): void {
    this.stopAutoPersist();
    const persist = () => {
      void this.capture().catch((error) => console.warn('[memory-card] auto persist failed', error));
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') persist();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', persist);
    this.intervalHandle = window.setInterval(persist, intervalMs);
    this.cleanups.push(() => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', persist);
    });
  }

  stopAutoPersist(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
  }

  private readonly cleanups: Array<() => void> = [];
}

function summarize(record: MemoryCardRecord): MemoryCardSummary {
  const folders = new Set<string>();
  for (const file of record.files) {
    const parts = file.path.split('/');
    if (parts.length >= 2 && parts[1].toLowerCase() === 'icon.sys') folders.add(parts[0]);
  }
  return {
    present: true,
    savedAt: record.savedAt,
    fileCount: record.fileCount,
    totalBytes: record.totalBytes,
    saveFolders: [...folders].sort(),
  };
}

/** Reject paths that could escape the card root or corrupt the filesystem. */
export function assertSafePath(path: string): void {
  if (!path || path.length > 512) throw new Error(`Caminho inválido: ${JSON.stringify(path)}`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(path)) throw new Error('O caminho contém caracteres de controle.');
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) throw new Error(`Caminho absoluto não é permitido: ${path}`);
  for (const segment of path.split('/')) {
    if (segment === '..' || segment === '.') throw new Error(`Caminho relativo não é permitido: ${path}`);
    if (segment.length === 0) throw new Error(`Caminho com segmento vazio: ${path}`);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type { Dirent };
