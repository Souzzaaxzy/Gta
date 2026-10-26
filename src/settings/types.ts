/** Shape of every setting the interface can change, plus the persisted envelope. */

/** Performance profiles offered to the user. */
export type PerformanceProfile = 'eco' | 'balanced' | 'quality';

/** Internal render resolution factor. Play!'s renderer only upscales; it cannot go sub-native. */
export type ResolutionFactor = 1 | 2;

export interface Settings {
  profile: PerformanceProfile;
  /** `true` when the user overrode the profile, so we stop auto-applying suggestions. */
  profileOverridden: boolean;
  resolutionFactor: ResolutionFactor;
  frameLimiter: boolean;
  fieldStabilization: boolean;
  /** Overlay with FPS / EE% / IOP% / draw calls. */
  showStats: boolean;
  /** Show the on-screen touch controls. */
  showTouchControls: boolean;
  touchOpacity: number;
  /** Scale multiplier for the touch control layout. */
  touchScale: number;
  /** Hide the touch controls while a physical gamepad is being used. */
  hideTouchWhenGamepad: boolean;
  /** Force landscape request when entering fullscreen. */
  requestLandscape: boolean;
  /** Remembered gamepad button mapping, keyed by logical action. */
  gamepadMapping: GamepadMapping;
}

/** Logical PS2 actions the user can bind to a physical gamepad button. */
export type GamepadAction =
  | 'cross'
  | 'circle'
  | 'square'
  | 'triangle'
  | 'l1'
  | 'l2'
  | 'l3'
  | 'r1'
  | 'r2'
  | 'r3'
  | 'start'
  | 'select'
  | 'dpadUp'
  | 'dpadDown'
  | 'dpadLeft'
  | 'dpadRight';

export type GamepadMapping = Record<GamepadAction, number>;

export const DEFAULT_GAMEPAD_MAPPING: GamepadMapping = {
  cross: 0,
  circle: 1,
  square: 2,
  triangle: 3,
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  select: 8,
  start: 9,
  l3: 10,
  r3: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
};

export const DEFAULT_SETTINGS: Settings = {
  profile: 'balanced',
  profileOverridden: false,
  resolutionFactor: 1,
  frameLimiter: true,
  fieldStabilization: false,
  showStats: false,
  showTouchControls: true,
  touchOpacity: 0.5,
  touchScale: 1,
  hideTouchWhenGamepad: false,
  requestLandscape: true,
  gamepadMapping: { ...DEFAULT_GAMEPAD_MAPPING },
};

/** Profile presets. Only levers Play! actually exposes are used. */
export const PROFILE_PRESETS: Record<PerformanceProfile, Pick<Settings, 'resolutionFactor' | 'frameLimiter' | 'fieldStabilization'>> = {
  eco: { resolutionFactor: 1, frameLimiter: true, fieldStabilization: true },
  balanced: { resolutionFactor: 1, frameLimiter: true, fieldStabilization: false },
  quality: { resolutionFactor: 2, frameLimiter: true, fieldStabilization: false },
};

export const SETTINGS_VERSION = 1;

export interface SettingsEnvelope {
  version: number;
  settings: Settings;
}
