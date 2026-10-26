import { PS2_BUTTON_LABELS, PS2_KEY_CODES, PS2_AXIS_KEY_CODES, type Ps2Button } from './keymap';

export interface TouchPadOptions {
  /** Called when a PS2 button changes state. */
  onButton: (button: Ps2Button, pressed: boolean) => void;
  /** Called when a simulated analog axis changes state. */
  onAxis: (axis: keyof typeof PS2_AXIS_KEY_CODES, direction: 'negative' | 'positive', pressed: boolean) => void;
  /** Called when the left cluster switches between D-pad and analog stick. */
  onModeChange?: (mode: 'dpad' | 'stick') => void;
}

type ClusterMode = 'dpad' | 'stick';

/**
 * On-screen PlayStation 2 pad.
 *
 * Design constraints that shaped this implementation:
 * - Multi-touch: every control uses pointer events with pointer capture, so a finger can
 *   hold a direction while another presses a face button.
 * - Multi-button: buttons keep their own state, so combinations (run + jump) work.
 * - No stuck buttons: every pointer release path (up, cancel, lost capture) releases, and
 *   the whole pad is released when the page is hidden or loses focus.
 * - Layout is sized in `vmin`, so the controls keep the same physical size in portrait
 *   and landscape; only the spacing changes.
 * - Safe-area insets are respected so nothing sits under a notch or the home indicator.
 */
export class TouchPad {
  readonly element: HTMLElement;

  private readonly bridgePress: (button: Ps2Button, pressed: boolean) => void;
  private readonly axisPress: TouchPadOptions['onAxis'];
  private readonly modeListener: TouchPadOptions['onModeChange'];
  private readonly cleanups: Array<() => void> = [];
  private mode: ClusterMode = 'dpad';
  private stickPointerId: number | null = null;
  private readonly heldButtons = new Set<Ps2Button>();
  private readonly heldAxes = new Set<string>();
  private opacity = 0.5;
  private scale = 1;

  constructor(options: TouchPadOptions) {
    this.bridgePress = options.onButton;
    this.axisPress = options.onAxis;
    this.modeListener = options.onModeChange;
    this.element = this.build();
    this.installGlobalReleaseHandlers();
  }

  show(): void {
    this.element.classList.add('visible');
  }

  hide(): void {
    this.element.classList.remove('visible');
    this.releaseAll();
  }

  get visible(): boolean {
    return this.element.classList.contains('visible');
  }

  setOpacity(value: number): void {
    this.opacity = Math.min(1, Math.max(0.1, value));
    this.element.style.setProperty('--pad-opacity', String(this.opacity));
  }

  setScale(value: number): void {
    this.scale = Math.min(1.6, Math.max(0.7, value));
    this.element.style.setProperty('--pad-scale', String(this.scale));
  }

  setMode(mode: ClusterMode): void {
    this.mode = mode;
    this.releaseAll();
    this.element.classList.toggle('stick-mode', mode === 'stick');
    const toggle = this.element.querySelector<HTMLElement>('[data-role="mode"]');
    if (toggle) toggle.textContent = mode === 'dpad' ? 'D-PAD' : 'ANALÓGICO';
    this.modeListener?.(mode);
  }

  getMode(): ClusterMode {
    return this.mode;
  }

  /** Release every held control. */
  releaseAll(): void {
    for (const button of [...this.heldButtons]) {
      this.heldButtons.delete(button);
      this.bridgePress(button, false);
    }
    for (const key of [...this.heldAxes]) {
      const [axis, direction] = key.split(':') as [keyof typeof PS2_AXIS_KEY_CODES, 'negative' | 'positive'];
      this.heldAxes.delete(key);
      this.axisPress(axis, direction, false);
    }
    for (const el of this.element.querySelectorAll('.tp-btn.held')) el.classList.remove('held');
    this.resetStickVisual();
    this.stickPointerId = null;
  }

  destroy(): void {
    this.releaseAll();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.element.remove();
  }

  private build(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'touch-pad';
    root.setAttribute('aria-hidden', 'true');
    root.style.setProperty('--pad-opacity', String(this.opacity));
    root.style.setProperty('--pad-scale', String(this.scale));

    root.innerHTML = `
      <div class="tp-shoulders tp-left">
        <button class="tp-btn tp-shoulder" data-button="l2" type="button">L2</button>
        <button class="tp-btn tp-shoulder" data-button="l1" type="button">L1</button>
      </div>
      <div class="tp-shoulders tp-right">
        <button class="tp-btn tp-shoulder" data-button="r1" type="button">R1</button>
        <button class="tp-btn tp-shoulder" data-button="r2" type="button">R2</button>
      </div>

      <div class="tp-cluster tp-left-cluster">
        <div class="tp-stick" data-role="stick">
          <span class="tp-arrow tp-up">▲</span>
          <span class="tp-arrow tp-down">▼</span>
          <span class="tp-arrow tp-left">◀</span>
          <span class="tp-arrow tp-right">▶</span>
          <span class="tp-nub" data-role="nub"></span>
        </div>
      </div>

      <div class="tp-cluster tp-face">
        <button class="tp-btn tp-face-btn tp-triangle" data-button="triangle" type="button">${PS2_BUTTON_LABELS.triangle}</button>
        <button class="tp-btn tp-face-btn tp-square" data-button="square" type="button">${PS2_BUTTON_LABELS.square}</button>
        <button class="tp-btn tp-face-btn tp-circle" data-button="circle" type="button">${PS2_BUTTON_LABELS.circle}</button>
        <button class="tp-btn tp-face-btn tp-cross" data-button="cross" type="button">${PS2_BUTTON_LABELS.cross}</button>
      </div>

      <div class="tp-system">
        <button class="tp-btn tp-small" data-button="l3" type="button">L3</button>
        <button class="tp-btn tp-wide" data-button="select" type="button">SELECT</button>
        <button class="tp-btn tp-wide" data-button="start" type="button">START</button>
        <button class="tp-btn tp-small" data-button="r3" type="button">R3</button>
      </div>

      <div class="tp-tools">
        <button class="tp-btn tp-tool" data-role="mode" type="button">D-PAD</button>
      </div>
    `;

    for (const button of root.querySelectorAll<HTMLElement>('[data-button]')) {
      this.bindButton(button);
    }
    this.bindStick(root.querySelector<HTMLElement>('[data-role="stick"]')!);
    root.querySelector<HTMLElement>('[data-role="mode"]')?.addEventListener('click', () => {
      this.setMode(this.mode === 'dpad' ? 'stick' : 'dpad');
    });

    return root;
  }

  private bindButton(element: HTMLElement): void {
    const button = element.dataset.button as Ps2Button;
    if (!(button in PS2_KEY_CODES)) return;

    const down = (event: PointerEvent) => {
      event.preventDefault();
      if (this.heldButtons.has(button)) return;
      this.heldButtons.add(button);
      element.classList.add('held');
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        /* capture is best-effort */
      }
      this.bridgePress(button, true);
    };

    const up = (event: PointerEvent) => {
      event.preventDefault();
      if (!this.heldButtons.has(button)) return;
      this.heldButtons.delete(button);
      element.classList.remove('held');
      this.bridgePress(button, false);
    };

    element.addEventListener('pointerdown', down, { passive: false });
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('lostpointercapture', up);
    // Stop the browser from showing a context menu or selecting the glyph.
    element.addEventListener('contextmenu', (event) => event.preventDefault());
    element.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });

    this.cleanups.push(() => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      element.removeEventListener('lostpointercapture', up);
    });
  }

  private bindStick(element: HTMLElement): void {
    const nub = element.querySelector<HTMLElement>('[data-role="nub"]')!;

    const setAxes = (dx: number, dy: number) => {
      // Horizontal axis: F (negative) / H (positive). Vertical axis: T (negative) / G (positive).
      this.setAxisState('leftX', 'negative', dx < -0.3);
      this.setAxisState('leftX', 'positive', dx > 0.3);
      this.setAxisState('leftY', 'negative', dy < -0.3);
      this.setAxisState('leftY', 'positive', dy > 0.3);
    };

    const move = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const radius = rect.width / 2;
      let dx = (event.clientX - centerX) / radius;
      let dy = (event.clientY - centerY) / radius;
      const magnitude = Math.hypot(dx, dy);
      if (magnitude > 1) {
        dx /= magnitude;
        dy /= magnitude;
      }
      nub.style.transform = `translate(${dx * radius * 0.5}px, ${dy * radius * 0.5}px)`;
      setAxes(dx, dy);
      this.updateArrowHighlights(dx, dy);
    };

    const down = (event: PointerEvent) => {
      event.preventDefault();
      this.stickPointerId = event.pointerId;
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        /* best-effort */
      }
      if (this.mode === 'dpad') {
        this.setMode('stick');
      }
      move(event);
    };

    const up = (event: PointerEvent) => {
      if (this.stickPointerId !== event.pointerId) return;
      event.preventDefault();
      this.stickPointerId = null;
      this.releaseAll();
    };

    element.addEventListener('pointerdown', down, { passive: false });
    element.addEventListener('pointermove', (event) => {
      if (this.stickPointerId === event.pointerId) move(event);
    });
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('lostpointercapture', up);

    // In D-pad mode a tap on a quadrant presses the matching direction.
    element.addEventListener('pointerdown', (event) => {
      if (this.mode !== 'dpad') return;
      const rect = element.getBoundingClientRect();
      const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      if (Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2) return;
      if (Math.abs(dx) > Math.abs(dy)) this.pressDpad(dx > 0 ? 'dpadRight' : 'dpadLeft');
      else this.pressDpad(dy > 0 ? 'dpadDown' : 'dpadUp');
    });
  }

  private pressDpad(button: Ps2Button): void {
    if (this.heldButtons.has(button)) return;
    this.heldButtons.add(button);
    this.bridgePress(button, true);
    const element = this.element.querySelector<HTMLElement>(`[data-button="${button}"]`);
    element?.classList.add('held');
    const release = () => {
      if (!this.heldButtons.has(button)) return;
      this.heldButtons.delete(button);
      element?.classList.remove('held');
      this.bridgePress(button, false);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
    window.addEventListener('pointerup', release, { once: true });
    window.addEventListener('pointercancel', release, { once: true });
  }

  private setAxisState(axis: keyof typeof PS2_AXIS_KEY_CODES, direction: 'negative' | 'positive', pressed: boolean): void {
    const key = `${axis}:${direction}`;
    if (pressed && !this.heldAxes.has(key)) {
      this.heldAxes.add(key);
      this.axisPress(axis, direction, true);
    } else if (!pressed && this.heldAxes.has(key)) {
      this.heldAxes.delete(key);
      this.axisPress(axis, direction, false);
    }
  }

  private updateArrowHighlights(dx: number, dy: number): void {
    const up = this.element.querySelector('.tp-arrow.tp-up');
    const down = this.element.querySelector('.tp-arrow.tp-down');
    const left = this.element.querySelector('.tp-arrow.tp-left');
    const right = this.element.querySelector('.tp-arrow.tp-right');
    up?.classList.toggle('active', dy < -0.3);
    down?.classList.toggle('active', dy > 0.3);
    left?.classList.toggle('active', dx < -0.3);
    right?.classList.toggle('active', dx > 0.3);
  }

  private resetStickVisual(): void {
    const nub = this.element.querySelector<HTMLElement>('[data-role="nub"]');
    if (nub) nub.style.transform = 'translate(0px, 0px)';
    for (const arrow of this.element.querySelectorAll('.tp-arrow.active')) arrow.classList.remove('active');
  }

  private installGlobalReleaseHandlers(): void {
    // A phone call, an app switch or a tab change must never leave a button held.
    const release = () => this.releaseAll();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') release();
    };
    window.addEventListener('blur', release);
    window.addEventListener('pagehide', release);
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => {
      window.removeEventListener('blur', release);
      window.removeEventListener('pagehide', release);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }
}
