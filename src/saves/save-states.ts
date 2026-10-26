import { db } from '@/storage/idb';
import { digest } from '@/utils/misc';

/**
 * Save-state slots.
 *
 * A save state is a snapshot the *emulator* produces. It is not the game's own save: the
 * game still writes to the virtual memory card. Both are offered, and the interface
 * explains the difference, because conflating them is the usual source of "my progress
 * disappeared".
 *
 * States are stored as raw bytes in IndexedDB, never in `localStorage`, which caps out at
 * a few megabytes.
 */

const SLOT_COUNT = 3;

export interface SaveStateSlot {
  slot: number;
  present: boolean;
  sizeBytes: number;
  savedAt: string | null;
  /** Short digest so the user can tell two snapshots apart. */
  checksum: string | null;
  gameName: string | null;
}

interface SaveStateRecord {
  bytes: ArrayBuffer;
  savedAt: string;
  checksum: string;
  sizeBytes: number;
  gameName: string | null;
}

const keyFor = (slot: number) => `slot-${slot}`;

export class SaveStateManager {
  constructor(private readonly slotCount: number = SLOT_COUNT) {}

  get slots(): number {
    return this.slotCount;
  }

  async list(): Promise<SaveStateSlot[]> {
    const result: SaveStateSlot[] = [];
    for (let slot = 0; slot < this.slotCount; slot++) {
      const record = await db.get<SaveStateRecord>('savestates', keyFor(slot));
      result.push({
        slot,
        present: Boolean(record),
        sizeBytes: record?.sizeBytes ?? 0,
        savedAt: record?.savedAt ?? null,
        checksum: record?.checksum ?? null,
        gameName: record?.gameName ?? null,
      });
    }
    return result;
  }

  async write(slot: number, bytes: Uint8Array, gameName: string | null): Promise<SaveStateSlot> {
    this.assertSlot(slot);
    const checksum = (await digest(bytes)).slice(0, 16);
    // Copy into a plain ArrayBuffer: a SharedArrayBuffer-backed view cannot be stored.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const record: SaveStateRecord = {
      bytes: copy.buffer,
      savedAt: new Date().toISOString(),
      checksum,
      sizeBytes: bytes.byteLength,
      gameName,
    };
    await db.put('savestates', keyFor(slot), record);
    return { slot, present: true, sizeBytes: record.sizeBytes, savedAt: record.savedAt, checksum, gameName };
  }

  async read(slot: number): Promise<Uint8Array | null> {
    this.assertSlot(slot);
    const record = await db.get<SaveStateRecord>('savestates', keyFor(slot));
    if (!record) return null;
    return new Uint8Array(record.bytes);
  }

  async remove(slot: number): Promise<void> {
    this.assertSlot(slot);
    await db.delete('savestates', keyFor(slot));
  }

  async exportSlot(slot: number): Promise<Blob | null> {
    const bytes = await this.read(slot);
    if (!bytes) return null;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy.buffer], { type: 'application/octet-stream' });
  }

  /**
   * Import a state file. The format is opaque, so we validate size and record a checksum;
   * we cannot tell whether the state belongs to this disc, and the interface says so.
   */
  async importSlot(slot: number, file: File): Promise<SaveStateSlot> {
    this.assertSlot(slot);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength < 1024) {
      throw new Error('O arquivo é pequeno demais para ser um estado de salvamento.');
    }
    return this.write(slot, bytes, null);
  }

  /** Read a state file without storing it, for validation. */
  static async inspect(file: File): Promise<{ sizeBytes: number; checksum: string }> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { sizeBytes: bytes.byteLength, checksum: (await digest(bytes)).slice(0, 16) };
  }

  private assertSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.slotCount) {
      throw new RangeError(`Slot inválido: ${slot}`);
    }
  }
}

export { SLOT_COUNT };
