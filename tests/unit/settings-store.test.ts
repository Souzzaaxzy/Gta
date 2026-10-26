import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_GAMEPAD_MAPPING, DEFAULT_SETTINGS } from '@/settings/types';
import { SettingsStore } from '@/settings/settings-store';

/** In-memory Storage stand-in, so the store is tested without a real browser. */
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('SettingsStore', () => {
  let storage: MemoryStorage;
  let store: SettingsStore;

  beforeEach(() => {
    storage = new MemoryStorage();
    store = new SettingsStore(storage);
  });

  it('starts from the defaults', () => {
    expect(store.value).toEqual(DEFAULT_SETTINGS);
    expect(store.value.gamepadMapping).toEqual(DEFAULT_GAMEPAD_MAPPING);
  });

  it('persists and reloads an update', () => {
    store.update({ showStats: true, touchOpacity: 0.8 });
    const reloaded = new SettingsStore(storage);
    expect(reloaded.value.showStats).toBe(true);
    expect(reloaded.value.touchOpacity).toBe(0.8);
  });

  it('applies a profile preset and marks it as user-chosen', () => {
    const result = store.applyProfile('quality');
    expect(result.profile).toBe('quality');
    expect(result.resolutionFactor).toBe(2);
    expect(result.profileOverridden).toBe(true);
  });

  it('applies a suggested profile without marking it as user-chosen', () => {
    const result = store.applyProfile('eco', { markOverridden: false });
    expect(result.profile).toBe('eco');
    expect(result.resolutionFactor).toBe(1);
    expect(result.profileOverridden).toBe(false);
  });

  it('notifies subscribers on change', () => {
    const seen: number[] = [];
    store.subscribe((settings) => seen.push(settings.touchScale));
    store.update({ touchScale: 1.2 });
    store.update({ touchScale: 1.4 });
    expect(seen).toEqual([1.2, 1.4]);
  });

  it('stops notifying after unsubscribe', () => {
    let count = 0;
    const off = store.subscribe(() => count++);
    store.update({ showStats: true });
    off();
    store.update({ showStats: false });
    expect(count).toBe(1);
  });

  it('sets and resets an individual gamepad binding', () => {
    store.setGamepadBinding('cross', 5);
    expect(store.value.gamepadMapping.cross).toBe(5);
    store.resetGamepadMapping();
    expect(store.value.gamepadMapping).toEqual(DEFAULT_GAMEPAD_MAPPING);
  });

  it('falls back to defaults when stored JSON is corrupt', () => {
    storage.setItem('gta.settings', '{ not json');
    const reloaded = new SettingsStore(storage);
    expect(reloaded.value).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial stored payload over the defaults', () => {
    storage.setItem('gta.settings', JSON.stringify({ version: 1, settings: { showStats: true } }));
    const reloaded = new SettingsStore(storage);
    expect(reloaded.value.showStats).toBe(true);
    // Missing keys keep their defaults rather than becoming undefined.
    expect(reloaded.value.resolutionFactor).toBe(DEFAULT_SETTINGS.resolutionFactor);
    expect(reloaded.value.gamepadMapping).toEqual(DEFAULT_GAMEPAD_MAPPING);
  });

  it('restores defaults on reset', () => {
    store.update({ showStats: true, touchScale: 1.5 });
    store.reset();
    expect(store.value).toEqual(DEFAULT_SETTINGS);
  });

  it('survives a storage that throws on write', () => {
    const hostile = new MemoryStorage();
    hostile.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const tolerant = new SettingsStore(hostile);
    expect(() => tolerant.update({ showStats: true })).not.toThrow();
    expect(tolerant.value.showStats).toBe(true);
  });
});
