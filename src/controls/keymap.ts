import type { GamepadAction } from '@/settings/types';

/**
 * The keyboard codes Play! listens for.
 *
 * This table is not a guess: it mirrors `Source/ui_js/Main.cpp` of Play! at commit
 * `83700b2`, which binds each PS2 control to a `KeyboardEvent.code`. The core only reads
 * the keyboard, so every input source (touch, gamepad) is translated into these codes and
 * dispatched to the canvas.
 */
export const PS2_KEY_CODES = {
  cross: 'KeyZ',
  circle: 'KeyX',
  square: 'KeyA',
  triangle: 'KeyS',
  l1: 'Key1',
  l2: 'Key2',
  l3: 'Key3',
  r1: 'Key8',
  r2: 'Key9',
  r3: 'Key0',
  start: 'Enter',
  select: 'Backspace',
  dpadUp: 'ArrowUp',
  dpadDown: 'ArrowDown',
  dpadLeft: 'ArrowLeft',
  dpadRight: 'ArrowRight',
} as const satisfies Record<GamepadAction, string>;

/** Simulated analog stick axes. Play! turns key pairs into a stick, not a digital pad. */
export const PS2_AXIS_KEY_CODES = {
  leftX: { negative: 'KeyF', positive: 'KeyH' },
  leftY: { negative: 'KeyT', positive: 'KeyG' },
  rightX: { negative: 'KeyJ', positive: 'KeyL' },
  rightY: { negative: 'KeyI', positive: 'KeyK' },
} as const;

export type Ps2Button = keyof typeof PS2_KEY_CODES;
export type Ps2Axis = keyof typeof PS2_AXIS_KEY_CODES;

export const PS2_BUTTONS: Ps2Button[] = [
  'cross',
  'circle',
  'square',
  'triangle',
  'l1',
  'l2',
  'l3',
  'r1',
  'r2',
  'r3',
  'start',
  'select',
  'dpadUp',
  'dpadDown',
  'dpadLeft',
  'dpadRight',
];

/** Button label shown on the touch pad, using the PlayStation glyphs. */
export const PS2_BUTTON_LABELS: Record<Ps2Button, string> = {
  cross: '✕',
  circle: '○',
  square: '□',
  triangle: '△',
  l1: 'L1',
  l2: 'L2',
  l3: 'L3',
  r1: 'R1',
  r2: 'R2',
  r3: 'R3',
  start: 'START',
  select: 'SELECT',
  dpadUp: '▲',
  dpadDown: '▼',
  dpadLeft: '◀',
  dpadRight: '▶',
};

/** All keyboard codes the core understands, for validation and tests. */
export const ALL_KEY_CODES: string[] = [
  ...Object.values(PS2_KEY_CODES),
  ...Object.values(PS2_AXIS_KEY_CODES).flatMap((axis) => [axis.negative, axis.positive]),
];

export function keyCodeFor(button: Ps2Button): string {
  return PS2_KEY_CODES[button];
}

/**
 * The "standard" gamepad layout, as the W3C Gamepad API specifies for Xbox-style pads.
 * Most Android controllers follow it; PlayStation pads exposed by the browser usually do
 * too, but the mapping is user-configurable because that is not guaranteed.
 */
export const STANDARD_GAMEPAD_LAYOUT: Record<GamepadAction, number> = {
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

/**
 * When the browser reports a layout that is clearly not the standard one, offer a
 * PlayStation-style alternative as a starting point. The user can always remap.
 */
export const PLAYSTATION_GAMEPAD_LAYOUT: Record<GamepadAction, number> = {
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

/** Axis indices for a standard gamepad: LX, LY, RX, RY. */
export const GAMEPAD_AXES = {
  leftX: 0,
  leftY: 1,
  rightX: 2,
  rightY: 3,
} as const;

/** Dead zone applied before an axis counts as pressed. */
export const AXIS_DEAD_ZONE = 0.4;

/**
 * Guess which button layout a pad uses from its reported id.
 * Returns `null` when we cannot tell, in which case the standard layout is assumed.
 */
export function guessLayoutFromId(id: string): Record<GamepadAction, number> | null {
  const lower = id.toLowerCase();
  if (/playstation|dualshock|dualsense|ps[3-5]|sony|054c/.test(lower)) {
    return PLAYSTATION_GAMEPAD_LAYOUT;
  }
  if (/xbox|xinput|045e|microsoft/.test(lower)) {
    return STANDARD_GAMEPAD_LAYOUT;
  }
  return null;
}
