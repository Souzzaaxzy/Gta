import {
  DEFAULT_GAMEPAD_MAPPING,
  DEFAULT_SETTINGS,
  PROFILE_PRESETS,
  SETTINGS_VERSION,
  type GamepadAction,
  type GamepadMapping,
  type PerformanceProfile,
  type Settings,
  type SettingsEnvelope,
} from './types';

const STORAGE_KEY = 'gta.settings';

/**
 * Settings store.
 *
 * Settings are small and read synchronously at boot, so `localStorage` is the right
 * tool here. Large payloads (disc images, memory cards, save states) never go here —
 * they belong in IndexedDB (see `src/storage/`).
 */
export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<(settings: Settings) => void>();

  constructor(private readonly storage: Storage = localStorage) {
    this.current = this.load();
  }

  get value(): Readonly<Settings> {
    return this.current;
  }

  /** Merge a partial update, persist, and notify. Returns the new settings. */
  update(patch: Partial<Settings>): Settings {
    this.current = { ...this.current, ...patch };
    this.save();
    this.notify();
    return this.current;
  }

  /** Apply a performance profile and mark the profile as user-chosen. */
  applyProfile(profile: PerformanceProfile, options: { markOverridden?: boolean } = {}): Settings {
    const preset = PROFILE_PRESETS[profile];
    this.current = {
      ...this.current,
      ...preset,
      profile,
      profileOverridden: options.markOverridden ?? true,
    };
    this.save();
    this.notify();
    return this.current;
  }

  setGamepadBinding(action: GamepadAction, buttonIndex: number): Settings {
    const gamepadMapping: GamepadMapping = { ...this.current.gamepadMapping, [action]: buttonIndex };
    return this.update({ gamepadMapping });
  }

  resetGamepadMapping(): Settings {
    return this.update({ gamepadMapping: { ...DEFAULT_GAMEPAD_MAPPING } });
  }

  reset(): Settings {
    this.current = { ...DEFAULT_SETTINGS, gamepadMapping: { ...DEFAULT_GAMEPAD_MAPPING } };
    this.save();
    this.notify();
    return this.current;
  }

  subscribe(listener: (settings: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.current);
  }

  private save(): void {
    const envelope: SettingsEnvelope = { version: SETTINGS_VERSION, settings: this.current };
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    } catch (error) {
      console.warn('[settings] could not persist settings', error);
    }
  }

  private load(): Settings {
    const fallback: Settings = { ...DEFAULT_SETTINGS, gamepadMapping: { ...DEFAULT_GAMEPAD_MAPPING } };
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch {
      return fallback;
    }
    if (!raw) return fallback;

    try {
      const parsed = JSON.parse(raw) as Partial<SettingsEnvelope>;
      const stored = parsed.settings as Partial<Settings> | undefined;
      if (!stored) return fallback;
      // Unknown or missing keys fall back to the defaults; the version field lets us
      // migrate the shape later without discarding the user's choices.
      return {
        ...fallback,
        ...stored,
        gamepadMapping: { ...DEFAULT_GAMEPAD_MAPPING, ...(stored.gamepadMapping ?? {}) },
      };
    } catch {
      return fallback;
    }
  }
}
