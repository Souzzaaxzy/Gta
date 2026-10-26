import { db, type FileRecord } from '@/storage/idb';
import { digest, extensionOf } from '@/utils/misc';
import { validateDiscFile, type ValidationResult } from './disc-formats';

const GAME_FILE_KEY = 'disc-image';

export interface GameFileInfo {
  name: string;
  size: number;
  lastModified: number;
  savedAt: string;
}

export interface GameFileStatus {
  /** A disc is available to mount right now. */
  present: boolean;
  /** The disc came back from IndexedDB after a reload, so the user did not have to re-pick it. */
  restored: boolean;
  info: GameFileInfo | null;
  validation: ValidationResult | null;
  /** Reason the stored disc could not be used, when that happened. */
  error: string | null;
}

/**
 * Owns the user's disc image.
 *
 * The disc itself is never copied into memory and never leaves the device. We store the
 * `File` handle in IndexedDB, which keeps the bytes in the browser's own file store; a
 * reload can then re-mount the same disc without asking the user again.
 */
export class GameFileManager {
  private file: File | null = null;
  private validation: ValidationResult | null = null;
  private restored = false;
  private error: string | null = null;

  /** The mounted disc, or null. */
  get currentFile(): File | null {
    return this.file;
  }

  get currentValidation(): ValidationResult | null {
    return this.validation;
  }

  get info(): GameFileInfo | null {
    if (!this.file) return null;
    return {
      name: this.file.name,
      size: this.file.size,
      lastModified: this.file.lastModified,
      savedAt: new Date(this.file.lastModified).toISOString(),
    };
  }

  status(): GameFileStatus {
    return {
      present: this.file !== null && this.validation?.valid === true,
      restored: this.restored,
      info: this.info,
      validation: this.validation,
      error: this.error,
    };
  }

  /**
   * Validate and mount a freshly picked file, then persist the handle so it survives a
   * reload. Rejects files whose container is not usable by the emulator.
   */
  async mount(file: File): Promise<ValidationResult> {
    const validation = await validateDiscFile(file);
    this.file = file;
    this.validation = validation;
    this.restored = false;
    this.error = null;

    if (!validation.valid) {
      const firstError = validation.issues.find((issue) => issue.severity === 'error');
      this.error = firstError?.message ?? 'Arquivo inválido.';
      return validation;
    }

    try {
      await this.persist(file, validation);
    } catch (persistError) {
      // Persisting is best-effort: the disc still works for this session.
      this.error = `O disco foi montado, mas não pôde ser guardado para a próxima sessão: ${
        persistError instanceof Error ? persistError.message : String(persistError)
      }`;
    }
    return validation;
  }

  /** Try to re-mount the disc stored by a previous session. */
  async restore(): Promise<GameFileStatus> {
    try {
      const record = await db.get<FileRecord>('files', GAME_FILE_KEY);
      if (!record?.blob) {
        return this.status();
      }
      const file = new File([record.blob], record.name, {
        type: record.type || 'application/octet-stream',
        lastModified: record.lastModified,
      });
      const validation = await validateDiscFile(file);
      this.file = file;
      this.validation = validation;
      this.restored = true;
      this.error = validation.valid ? null : 'O disco guardado anteriormente não é mais válido.';
      return this.status();
    } catch (restoreError) {
      this.error = `Não foi possível recuperar o disco guardado: ${
        restoreError instanceof Error ? restoreError.message : String(restoreError)
      }`;
      return this.status();
    }
  }

  /** Forget the mounted disc and remove the stored handle. */
  async clear(): Promise<void> {
    this.file = null;
    this.validation = null;
    this.restored = false;
    this.error = null;
    try {
      await db.delete('files', GAME_FILE_KEY);
    } catch {
      /* nothing to clean up */
    }
  }

  private async persist(file: File, validation: ValidationResult): Promise<void> {
    const fingerprint = await fingerprintOf(file);
    const record: FileRecord = {
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified,
      blob: file,
      fingerprint,
      savedAt: new Date().toISOString(),
    };
    await db.put('files', GAME_FILE_KEY, record);
    void validation;
  }
}

/**
 * Cheap fingerprint of a large file: hashes the first and last megabyte plus the size.
 * Hashing gigabytes on every boot would be unacceptable, and this is only used to detect
 * a swapped or truncated file, not to prove authenticity.
 */
export async function fingerprintOf(file: File): Promise<string> {
  const megabyte = 1024 * 1024;
  const head = file.slice(0, Math.min(megabyte, file.size));
  const tailStart = Math.max(0, file.size - megabyte);
  const tail = file.slice(tailStart, file.size);
  const headBytes = new Uint8Array(await head.arrayBuffer());
  const tailBytes = new Uint8Array(await tail.arrayBuffer());
  const combined = new Uint8Array(headBytes.length + tailBytes.length + 8);
  combined.set(headBytes, 0);
  combined.set(tailBytes, headBytes.length);
  new DataView(combined.buffer).setFloat64(headBytes.length + tailBytes.length, file.size, true);
  const hash = await digest(combined);
  return `${hash.slice(0, 16)}:${file.size}`;
}

export function fileExtension(file: File): string {
  return extensionOf(file.name);
}
