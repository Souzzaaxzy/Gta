import { ALL_KEY_CODES } from './keymap';

/**
 * Dispatches virtual key presses to the canvas.
 *
 * Play! registers its keyboard callbacks on the `#outputCanvas` element, not on
 * `document`. The events must therefore be dispatched on the canvas and bubble.
 *
 * Presses are reference-counted: the same key may be held by the touch pad and by a
 * physical controller at the same time, and releasing one must not release the other.
 */
export class InputBridge {
  private readonly counts = new Map<string, number>();
  private readonly downCodes = new Set<string>();

  constructor(private readonly target: HTMLElement) {}

  /** Number of distinct keys currently held. Exposed for diagnostics and tests. */
  get activeKeys(): string[] {
    return [...this.downCodes];
  }

  isDown(code: string): boolean {
    return this.downCodes.has(code);
  }

  press(code: string): void {
    if (!code) return;
    const count = this.counts.get(code) ?? 0;
    this.counts.set(code, count + 1);
    if (count === 0) {
      this.dispatch('keydown', code);
      this.downCodes.add(code);
    }
  }

  release(code: string): void {
    if (!code) return;
    const count = this.counts.get(code) ?? 0;
    if (count <= 0) return;
    if (count === 1) {
      this.counts.delete(code);
      this.dispatch('keyup', code);
      this.downCodes.delete(code);
    } else {
      this.counts.set(code, count - 1);
    }
  }

  /** Force a release regardless of the reference count. Used when a pointer is lost. */
  forceRelease(code: string): void {
    if (!this.counts.has(code)) return;
    this.counts.delete(code);
    this.dispatch('keyup', code);
    this.downCodes.delete(code);
  }

  /** Release every held key. Called on blur, visibility change and teardown. */
  releaseAll(): void {
    for (const code of [...this.downCodes]) {
      this.counts.delete(code);
      this.dispatch('keyup', code);
    }
    this.downCodes.clear();
  }

  /** Keep only the given codes held; release the rest. */
  retainOnly(codes: Iterable<string>): void {
    const keep = new Set(codes);
    for (const code of [...this.downCodes]) {
      if (!keep.has(code)) this.forceRelease(code);
    }
  }

  private dispatch(type: 'keydown' | 'keyup', code: string): void {
    try {
      this.target.dispatchEvent(
        new KeyboardEvent(type, {
          code,
          key: code,
          bubbles: true,
          cancelable: true,
        }),
      );
    } catch (error) {
      console.warn('[input-bridge] could not dispatch key event', error);
    }
  }
}

/** Guard against typos: only codes the core actually binds should ever be dispatched. */
export function isKnownKeyCode(code: string): boolean {
  return ALL_KEY_CODES.includes(code);
}
