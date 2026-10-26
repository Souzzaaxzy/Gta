import { describe, expect, it } from 'vitest';
import { InputBridge, isKnownKeyCode } from '@/controls/input-bridge';
import { PS2_AXIS_KEY_CODES, PS2_KEY_CODES, STANDARD_GAMEPAD_LAYOUT, guessLayoutFromId } from '@/controls/keymap';

function makeTarget(): { element: HTMLElement; events: Array<{ type: string; code: string }> } {
  const element = document.createElement('div');
  const events: Array<{ type: string; code: string }> = [];
  for (const type of ['keydown', 'keyup'] as const) {
    element.addEventListener(type, (event) => {
      events.push({ type, code: (event as KeyboardEvent).code });
    });
  }
  return { element, events };
}

describe('keymap', () => {
  it('matches the mapping the Play! core binds (verified against its source)', () => {
    // Source/ui_js/Main.cpp at commit 83700b2.
    expect(PS2_KEY_CODES.cross).toBe('KeyZ');
    expect(PS2_KEY_CODES.circle).toBe('KeyX');
    expect(PS2_KEY_CODES.square).toBe('KeyA');
    expect(PS2_KEY_CODES.triangle).toBe('KeyS');
    expect(PS2_KEY_CODES.l1).toBe('Key1');
    expect(PS2_KEY_CODES.l2).toBe('Key2');
    expect(PS2_KEY_CODES.l3).toBe('Key3');
    expect(PS2_KEY_CODES.r1).toBe('Key8');
    expect(PS2_KEY_CODES.r2).toBe('Key9');
    expect(PS2_KEY_CODES.r3).toBe('Key0');
    expect(PS2_KEY_CODES.start).toBe('Enter');
    expect(PS2_KEY_CODES.select).toBe('Backspace');
    expect(PS2_KEY_CODES.dpadUp).toBe('ArrowUp');
    expect(PS2_KEY_CODES.dpadDown).toBe('ArrowDown');
    expect(PS2_KEY_CODES.dpadLeft).toBe('ArrowLeft');
    expect(PS2_KEY_CODES.dpadRight).toBe('ArrowRight');
  });

  it('uses the documented simulated axis keys', () => {
    expect(PS2_AXIS_KEY_CODES.leftX).toEqual({ negative: 'KeyF', positive: 'KeyH' });
    expect(PS2_AXIS_KEY_CODES.leftY).toEqual({ negative: 'KeyT', positive: 'KeyG' });
    expect(PS2_AXIS_KEY_CODES.rightX).toEqual({ negative: 'KeyJ', positive: 'KeyL' });
    expect(PS2_AXIS_KEY_CODES.rightY).toEqual({ negative: 'KeyI', positive: 'KeyK' });
  });

  it('rejects unknown key codes', () => {
    expect(isKnownKeyCode('KeyZ')).toBe(true);
    expect(isKnownKeyCode('F13')).toBe(false);
  });

  it('recognises PlayStation and Xbox style pads from their id', () => {
    expect(guessLayoutFromId('Wireless Controller (STANDARD GAMEPAD Vendor: 054c)')).toEqual(
      expect.objectContaining({ cross: 0 }),
    );
    expect(guessLayoutFromId('Xbox Wireless Controller (Vendor: 045e)')).toEqual(STANDARD_GAMEPAD_LAYOUT);
    expect(guessLayoutFromId('Some Unknown Pad')).toBeNull();
  });
});

describe('InputBridge', () => {
  it('dispatches keydown then keyup', () => {
    const { element, events } = makeTarget();
    const bridge = new InputBridge(element);
    bridge.press('KeyZ');
    bridge.release('KeyZ');
    expect(events).toEqual([
      { type: 'keydown', code: 'KeyZ' },
      { type: 'keyup', code: 'KeyZ' },
    ]);
  });

  it('reference-counts the same key held by two sources', () => {
    const { element, events } = makeTarget();
    const bridge = new InputBridge(element);
    bridge.press('KeyZ'); // touch
    bridge.press('KeyZ'); // gamepad
    bridge.release('KeyZ'); // one source lets go
    expect(events).toEqual([{ type: 'keydown', code: 'KeyZ' }]);
    bridge.release('KeyZ');
    expect(events).toEqual([
      { type: 'keydown', code: 'KeyZ' },
      { type: 'keyup', code: 'KeyZ' },
    ]);
  });

  it('ignores a release for a key that is not held', () => {
    const { element, events } = makeTarget();
    const bridge = new InputBridge(element);
    bridge.release('KeyZ');
    expect(events).toEqual([]);
  });

  it('releases every held key with releaseAll', () => {
    const { element, events } = makeTarget();
    const bridge = new InputBridge(element);
    bridge.press('KeyZ');
    bridge.press('ArrowUp');
    bridge.press('Enter');
    bridge.releaseAll();
    expect(events.filter((event) => event.type === 'keyup')).toHaveLength(3);
    expect(bridge.activeKeys).toEqual([]);
  });

  it('forceRelease ignores the reference count', () => {
    const { element, events } = makeTarget();
    const bridge = new InputBridge(element);
    bridge.press('KeyZ');
    bridge.press('KeyZ');
    bridge.forceRelease('KeyZ');
    expect(events.filter((event) => event.type === 'keyup')).toHaveLength(1);
    expect(bridge.isDown('KeyZ')).toBe(false);
  });

  it('retainOnly releases everything except the listed keys', () => {
    const { element, events } = makeTarget();
    const bridge = new InputBridge(element);
    bridge.press('KeyZ');
    bridge.press('ArrowUp');
    bridge.retainOnly(['KeyZ']);
    const released = events.filter((event) => event.type === 'keyup').map((event) => event.code);
    expect(released).toEqual(['ArrowUp']);
    expect(bridge.activeKeys).toEqual(['KeyZ']);
  });
});
