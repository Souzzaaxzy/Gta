import { db } from '@/storage/idb';

/**
 * Full backup: one file with everything the user has on this device.
 *
 * The container is a JSON envelope with base64 payloads rather than a zip, so no
 * compression library is needed and the format is easy to inspect and diff. Save states
 * are already large; base64 adds ~33%, which is acceptable for a manual backup the user
 * triggers on purpose.
 *
 * The disc image is deliberately NOT included: it is gigabytes, and it is the user's own
 * file. The backup records its name and size so the interface can remind them.
 */

export const BACKUP_FORMAT = 'gta-backup';
export const BACKUP_VERSION = 1;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  app: { name: string; version: string };
  disc: { name: string; size: number; fingerprint: string } | null;
  saveStates: Array<{ slot: number; sizeBytes: number; savedAt: string; checksum: string; base64: string }>;
  memoryCard: { fileCount: number; totalBytes: number; savedAt: string; checksum: string; files: unknown[] } | null;
  settings: Record<string, unknown> | null;
}

interface SaveStateRecord {
  bytes: ArrayBuffer;
  savedAt: string;
  checksum: string;
  sizeBytes: number;
  gameName: string | null;
}

interface MemoryCardRecord {
  files: Array<{ path: string; bytes: ArrayBuffer; modifiedAt: number }>;
  savedAt: string;
  fileCount: number;
  totalBytes: number;
  checksum: string;
}

interface FileRecord {
  name: string;
  size: number;
  fingerprint: string;
}

export interface BackupSummary {
  createdAt: string;
  discName: string | null;
  saveStateCount: number;
  memoryCardFiles: number;
  totalBytes: number;
}

export async function createBackup(settings: Record<string, unknown> | null): Promise<{ blob: Blob; manifest: BackupManifest }> {
  const slots: BackupManifest['saveStates'] = [];
  for (let slot = 0; slot < 3; slot++) {
    const record = await db.get<SaveStateRecord>('savestates', `slot-${slot}`);
    if (!record) continue;
    slots.push({
      slot,
      sizeBytes: record.sizeBytes,
      savedAt: record.savedAt,
      checksum: record.checksum,
      base64: bytesToBase64(new Uint8Array(record.bytes)),
    });
  }

  const cardRecord = await db.get<MemoryCardRecord>('memorycard', 'mc0');
  const discRecord = await db.get<FileRecord>('files', 'disc-image');

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    app: { name: 'Gta', version: '0.1.0' },
    disc: discRecord ? { name: discRecord.name, size: discRecord.size, fingerprint: discRecord.fingerprint } : null,
    saveStates: slots,
    memoryCard: cardRecord
      ? {
          fileCount: cardRecord.fileCount,
          totalBytes: cardRecord.totalBytes,
          savedAt: cardRecord.savedAt,
          checksum: cardRecord.checksum,
          files: cardRecord.files.map((file) => ({
            path: file.path,
            modifiedAt: file.modifiedAt,
            base64: bytesToBase64(new Uint8Array(file.bytes)),
          })),
        }
      : null,
    settings,
  };

  const json = JSON.stringify(manifest);
  return { blob: new Blob([json], { type: 'application/json' }), manifest };
}

/**
 * Restore a backup. Returns a summary of what was written.
 *
 * The whole payload is validated before anything is stored, so a corrupt or foreign file
 * cannot leave the device in a half-restored state.
 */
export async function restoreBackup(file: File): Promise<BackupSummary> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('O arquivo de backup não é um JSON válido.');
  }

  const manifest = parsed as Partial<BackupManifest>;
  if (manifest.format !== BACKUP_FORMAT) {
    throw new Error(`Formato não reconhecido. Esperado "${BACKUP_FORMAT}".`);
  }
  if (typeof manifest.version !== 'number' || manifest.version > BACKUP_VERSION) {
    throw new Error(`Versão de backup incompatível (${String(manifest.version)}).`);
  }

  const slots = Array.isArray(manifest.saveStates) ? manifest.saveStates : [];
  const card = manifest.memoryCard ?? null;

  // Validate everything up front.
  for (const slot of slots) {
    if (typeof slot.base64 !== 'string' || typeof slot.slot !== 'number') {
      throw new Error('O backup contém um estado de salvamento inválido.');
    }
  }
  const cardFiles: Array<{ path: string; bytes: ArrayBuffer; modifiedAt: number }> = [];
  if (card && Array.isArray(card.files)) {
    for (const entry of card.files as Array<{ path?: unknown; base64?: unknown; modifiedAt?: unknown }>) {
      if (typeof entry.path !== 'string' || typeof entry.base64 !== 'string') continue;
      const bytes = base64ToBytes(entry.base64);
      cardFiles.push({
        path: entry.path,
        bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        modifiedAt: typeof entry.modifiedAt === 'number' ? entry.modifiedAt : Date.now(),
      });
    }
  }

  // Now write.
  for (const slot of slots) {
    const bytes = base64ToBytes(slot.base64);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    await db.put('savestates', `slot-${slot.slot}`, {
      bytes: copy.buffer,
      savedAt: slot.savedAt ?? new Date().toISOString(),
      checksum: slot.checksum ?? '',
      sizeBytes: copy.byteLength,
      gameName: null,
    } satisfies SaveStateRecord);
  }

  let memoryCardFiles = 0;
  if (cardFiles.length > 0) {
    let totalBytes = 0;
    for (const f of cardFiles) totalBytes += f.bytes.byteLength;
    await db.put('memorycard', 'mc0', {
      files: cardFiles,
      savedAt: card?.savedAt ?? new Date().toISOString(),
      fileCount: cardFiles.length,
      totalBytes,
      checksum: card?.checksum ?? '',
    } satisfies MemoryCardRecord);
    memoryCardFiles = cardFiles.length;
  }

  return {
    createdAt: manifest.createdAt ?? '',
    discName: manifest.disc?.name ?? null,
    saveStateCount: slots.length,
    memoryCardFiles,
    totalBytes: file.size,
  };
}

/** Read a backup file without writing anything, so the interface can preview it. */
export async function inspectBackup(file: File): Promise<BackupSummary> {
  const text = await file.text();
  const manifest = JSON.parse(text) as Partial<BackupManifest>;
  if (manifest.format !== BACKUP_FORMAT) throw new Error('Formato não reconhecido.');
  const card = manifest.memoryCard as { fileCount?: number } | null | undefined;
  return {
    createdAt: manifest.createdAt ?? '',
    discName: manifest.disc?.name ?? null,
    saveStateCount: Array.isArray(manifest.saveStates) ? manifest.saveStates.length : 0,
    memoryCardFiles: card?.fileCount ?? 0,
    totalBytes: file.size,
  };
}

/** Trigger a browser download for a blob. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next macrotask so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
