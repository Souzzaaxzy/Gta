import { EventBus } from '@/utils/event-bus';
import type { GamepadAction, GamepadMapping } from '@/settings/types';
import { DEFAULT_GAMEPAD_MAPPING } from '@/settings/types';
import {
  AXIS_DEAD_ZONE,
  GAMEPAD_AXES,
  guessLayoutFromId,
  STANDARD_GAMEPAD_LAYOUT,
} from './keymap';

export interface GamepadInfo {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  buttons: number;
  axes: number;
}

export interface GamepadEvents {
  connected: GamepadInfo;
  disconnected: { index: number; id: string };
  /** Emitted when any pad is present, so the interface can hide the touch controls. */
  presence: { count: number };
}

/**
 * Polls the Gamepad API and converts physical pads into logical PS2 buttons.
 *
 * The API is poll-based: there is no reliable event for a button going down, so a
 * requestAnimationFrame loop samples every pad. Only state *changes* are emitted, so the
 * emulator receives one key event per physical press.
 */
export class GamepadManager {
  readonly events = new EventBus<GamepadEvents>();

  private running = false;
  private rafHandle = 0;
  private previousButtons = new Map<string, boolean>();
  private previousAxes = new Map<string, boolean>();
  private mapping: GamepadMapping = { ...DEFAULT_GAMEPAD_MAPPING };
  private lastIds = new Map<number, string>();

  constructor(private readonly onButtonChange: (button: GamepadAction, pressed: boolean) => void) {}

  /** Replace the active button mapping. Safe to call at any time. */
  setMapping(mapping: GamepadMapping): void {
    this.mapping = { ...mapping };
  }

  getMapping(): GamepadMapping {
    return { ...this.mapping };
  }

  /** Snapshot of every connected pad. */
  list(): GamepadInfo[] {
    return this.readPads().map(toInfo);
  }

  /** The first connected pad, or null. */
  primary(): GamepadInfo | null {
    return this.list()[0] ?? null;
  }

  get isConnected(): boolean {
    return this.list().length > 0;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener('gamepadconnected', this.handleConnected);
    window.addEventListener('gamepaddisconnected', this.handleDisconnected);
    // Some browsers only expose pads after a button is pressed; the initial scan catches
    // pads that are already paired.
    this.emitPresence();
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
    window.removeEventListener('gamepadconnected', this.handleConnected);
    window.removeEventListener('gamepaddisconnected', this.handleDisconnected);
    this.releaseEverything();
  }

  /** Release every button the pads are currently holding. */
  releaseEverything(): void {
    for (const [key, pressed] of this.previousButtons) {
      if (!pressed) continue;
      const action = key.split(':')[1] as GamepadAction;
      this.onButtonChange(action, false);
    }
    this.previousButtons.clear();
    this.previousAxes.clear();
  }

  private handleConnected = (event: Event) => {
    const gamepad = (event as GamepadEvent).gamepad;
    if (gamepad) {
      const layout = guessLayoutFromId(gamepad.id);
      void layout;
      this.events.emit('connected', toInfo(gamepad));
    }
    this.emitPresence();
  };

  private handleDisconnected = (event: Event) => {
    const gamepad = (event as GamepadEvent).gamepad;
    if (gamepad) this.events.emit('disconnected', { index: gamepad.index, id: gamepad.id });
    this.releaseEverything();
    this.emitPresence();
  };

  private emitPresence(): void {
    this.events.emit('presence', { count: this.list().length });
  }

  private readPads(): Gamepad[] {
    if (typeof navigator.getGamepads !== 'function') return [];
    const pads = navigator.getGamepads();
    const result: Gamepad[] = [];
    for (const pad of pads) {
      if (pad?.connected) result.push(pad);
    }
    return result;
  }

  private loop = () => {
    if (!this.running) return;
    this.poll();
    this.rafHandle = requestAnimationFrame(this.loop);
  };

  private poll(): void {
    const pads = this.readPads();
    const seenIndices = new Set<number>();

    for (const pad of pads) {
      seenIndices.add(pad.index);
      const previousId = this.lastIds.get(pad.index);
      if (previousId !== pad.id) {
        this.lastIds.set(pad.index, pad.id);
        this.events.emit('connected', toInfo(pad));
      }

      // Buttons, by index in the user's mapping.
      for (const action of Object.keys(this.mapping) as GamepadAction[]) {
        const buttonIndex = this.mapping[action];
        const button = pad.buttons[buttonIndex];
        const pressed = Boolean(button?.pressed) || (button?.value ?? 0) > 0.5;
        const key = `${pad.index}:${action}`;
        const wasPressed = this.previousButtons.get(key) ?? false;
        if (pressed !== wasPressed) {
          this.previousButtons.set(key, pressed);
          this.onButtonChange(action, pressed);
        }
      }

      // Analog sticks, converted to the four simulated axes Play! expects.
      for (const [axisName, axisIndex] of Object.entries(GAMEPAD_AXES)) {
        const value = pad.axes[axisIndex] ?? 0;
        const negativeKey = `${pad.index}:${axisName}:-`;
        const positiveKey = `${pad.index}:${axisName}:+`;
        const negative = value < -AXIS_DEAD_ZONE;
        const positive = value > AXIS_DEAD_ZONE;

        if (negative !== (this.previousAxes.get(negativeKey) ?? false)) {
          this.previousAxes.set(negativeKey, negative);
          this.onAxisChange(axisName as keyof typeof GAMEPAD_AXES, 'negative', negative);
        }
        if (positive !== (this.previousAxes.get(positiveKey) ?? false)) {
          this.previousAxes.set(positiveKey, positive);
          this.onAxisChange(axisName as keyof typeof GAMEPAD_AXES, 'positive', positive);
        }
      }
    }

    // Forget pads that vanished without firing a disconnect event.
    for (const index of [...this.lastIds.keys()]) {
      if (!seenIndices.has(index)) {
        this.lastIds.delete(index);
        this.releaseEverything();
        this.emitPresence();
      }
    }
  }

  private onAxisChange(axis: keyof typeof GAMEPAD_AXES, direction: 'negative' | 'positive', pressed: boolean): void {
    this.onAxisChangeCallback?.(axis, direction, pressed);
  }

  /** Set by the owner to route axis changes to the input bridge. */
  onAxisChangeCallback: ((axis: keyof typeof GAMEPAD_AXES, direction: 'negative' | 'positive', pressed: boolean) => void) | null =
    null;
}

function toInfo(gamepad: Gamepad): GamepadInfo {
  return {
    index: gamepad.index,
    id: gamepad.id,
    mapping: gamepad.mapping || 'unknown',
    connected: gamepad.connected,
    buttons: gamepad.buttons.length,
    axes: gamepad.axes.length,
  };
}

/** Utility used by the settings screen to label a button index. */
export function describeButtonIndex(index: number): string {
  const standard: Record<number, string> = {
    0: 'A / ✕',
    1: 'B / ○',
    2: 'X / □',
    3: 'Y / △',
    4: 'LB / L1',
    5: 'RB / R1',
    6: 'LT / L2',
    7: 'RT / R2',
    8: 'Back / Select',
    9: 'Start',
    10: 'L3',
    11: 'R3',
    12: 'D-pad ↑',
    13: 'D-pad ↓',
    14: 'D-pad ←',
    15: 'D-pad →',
  };
  return standard[index] ?? `Botão ${index}`;
}

export { STANDARD_GAMEPAD_LAYOUT };
