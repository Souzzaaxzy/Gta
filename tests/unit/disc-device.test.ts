import { describe, expect, it } from 'vitest';
import { createDiscImageDevice, overallProgress } from '@/emulator/play-adapter';
import type { PlayModule } from '@/emulator/play-module';

/**
 * The disc device is the contract between the page and the wasm core: the core calls
 * `read(dest, offset, length)` synchronously, then spins on `isDone()` until the
 * asynchronous blob read has landed in HEAPU8.
 */
function makeModule(heapSize = 1 << 16): PlayModule {
  const heap = new Uint8Array(heapSize);
  return { HEAPU8: heap, FS: { writeFile: () => {}, readFile: () => new Uint8Array(), unlink: () => {}, mkdir: () => {} } };
}

/** Wait until `predicate` is true, or fail. */
async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for the read to complete');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('createDiscImageDevice', () => {
  it('reports the file size', () => {
    const module = makeModule();
    const device = createDiscImageDevice(module);
    device.setFile(new File([new Uint8Array(1234)], 'game.iso'));
    expect(device.getFileSize()).toBe(1234);
  });

  it('throws when asked for the size before a file is set', () => {
    const device = createDiscImageDevice(makeModule());
    expect(() => device.getFileSize()).toThrow();
  });

  it('starts as not done', () => {
    const device = createDiscImageDevice(makeModule());
    device.setFile(new File([new Uint8Array(16)], 'game.iso'));
    expect(device.isDone()).toBe(false);
  });

  it('copies the requested byte range into HEAPU8 and signals completion', async () => {
    const module = makeModule();
    const payload = new Uint8Array(4096);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256;
    const device = createDiscImageDevice(module);
    device.setFile(new File([payload], 'game.iso'));

    device.read(64, 0, 128);
    expect(device.isDone()).toBe(false);
    await until(() => device.isDone());

    expect([...module.HEAPU8.subarray(64, 64 + 128)]).toEqual([...payload.subarray(0, 128)]);
  });

  it('reads from an arbitrary offset', async () => {
    const module = makeModule();
    const payload = new Uint8Array(2048);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251;
    const device = createDiscImageDevice(module);
    device.setFile(new File([payload], 'game.iso'));

    device.read(0, 1000, 100);
    await until(() => device.isDone());
    expect([...module.HEAPU8.subarray(0, 100)]).toEqual([...payload.subarray(1000, 1100)]);
  });

  it('never loads the whole file into memory', async () => {
    // 4 MB of disc, but only a 64 KB heap: a full load would throw or truncate.
    const module = makeModule(1 << 16);
    const payload = new Uint8Array(4 * 1024 * 1024);
    payload[2_000_000] = 0xab;
    const device = createDiscImageDevice(module);
    device.setFile(new File([payload], 'big.iso'));

    device.read(32, 2_000_000, 8);
    await until(() => device.isDone());
    expect(module.HEAPU8[32]).toBe(0xab);
  });

  it('resets the done flag on each read', async () => {
    const module = makeModule();
    const device = createDiscImageDevice(module);
    device.setFile(new File([new Uint8Array(256)], 'game.iso'));

    device.read(0, 0, 16);
    await until(() => device.isDone());
    device.read(16, 16, 16);
    expect(device.isDone()).toBe(false);
    await until(() => device.isDone());
  });

  it('completes the read even when the underlying blob read fails', async () => {
    const module = makeModule();
    const device = createDiscImageDevice(module);
    const broken = {
      size: 1024,
      slice: () => ({ arrayBuffer: () => Promise.reject(new Error('io error')) }),
    } as unknown as File;
    device.setFile(broken);
    device.read(0, 0, 16);
    // The core spins on isDone(); a failed read must not hang it forever.
    await until(() => device.isDone());
    expect(device.isDone()).toBe(true);
  });
});

describe('overallProgress', () => {
  it('maps wasm download progress into the first 70 percent', () => {
    expect(overallProgress({ phase: 'wasm', ratio: 0, message: '' })).toBe(0);
    expect(overallProgress({ phase: 'wasm', ratio: 1, message: '' })).toBeCloseTo(0.7);
  });

  it('returns null for an indeterminate step', () => {
    expect(overallProgress({ phase: 'instantiate', ratio: null, message: '' })).toBeNull();
  });

  it('reports 1 when ready', () => {
    expect(overallProgress({ phase: 'ready', ratio: 1, message: '' })).toBe(1);
  });
});
