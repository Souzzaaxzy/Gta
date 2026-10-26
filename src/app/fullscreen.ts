/**
 * Fullscreen and screen orientation helpers.
 *
 * Mobile browsers differ a lot here. Safari on iPhone does not implement
 * `Element.requestFullscreen` for arbitrary elements, and almost no mobile browser allows
 * `screen.orientation.lock()` outside fullscreen. Every call therefore returns a result
 * object instead of throwing, so the interface can tell the user exactly what worked and
 * what they have to do by hand.
 */

export interface FullscreenResult {
  fullscreen: boolean;
  orientationLocked: boolean;
  /** Human-readable explanation of what happened, for the interface. */
  message: string;
}

export interface OrientationInfo {
  type: string;
  angle: number;
  isLandscape: boolean;
}

type OrientationLockType =
  | 'any'
  | 'natural'
  | 'landscape'
  | 'portrait'
  | 'portrait-primary'
  | 'portrait-secondary'
  | 'landscape-primary'
  | 'landscape-secondary';

type LockableOrientation = Omit<ScreenOrientation, 'unlock'> & {
  lock?: (orientation: OrientationLockType) => Promise<void>;
  unlock?: () => void;
};

export function isFullscreenSupported(element: Element): boolean {
  return typeof element.requestFullscreen === 'function';
}

export function isFullscreen(): boolean {
  return document.fullscreenElement !== null;
}

export function currentOrientation(): OrientationInfo {
  const orientation = screen.orientation;
  const type: string = orientation?.type ?? 'unknown';
  const angle = orientation?.angle ?? 0;
  const isLandscape =
    type.startsWith('landscape') || (type === 'unknown' && window.innerWidth > window.innerHeight);
  return { type, angle, isLandscape };
}

/**
 * Enter fullscreen and, where allowed, ask for landscape.
 *
 * Order matters: the orientation lock is only accepted while the document is fullscreen,
 * so fullscreen is requested first and the lock attempted after it resolves.
 */
export async function enterFullscreen(element: HTMLElement, options: { lockLandscape?: boolean } = {}): Promise<FullscreenResult> {
  const lockLandscape = options.lockLandscape ?? true;

  if (!isFullscreenSupported(element)) {
    return {
      fullscreen: false,
      orientationLocked: false,
      message:
        'Este navegador não permite tela cheia para esta página (comum no Safari do iPhone). Gire o aparelho manualmente para a horizontal.',
    };
  }

  try {
    if (!isFullscreen()) {
      await element.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch (error) {
    return {
      fullscreen: false,
      orientationLocked: false,
      message: `Não foi possível entrar em tela cheia: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let orientationLocked = false;
  if (lockLandscape) {
    orientationLocked = await lockLandscapeOrientation();
  }

  return {
    fullscreen: true,
    orientationLocked,
    message: orientationLocked
      ? 'Tela cheia ativa, orientação travada na horizontal.'
      : 'Tela cheia ativa. A rotação automática não pôde ser travada; gire o aparelho manualmente se a tela não estiver na horizontal.',
  };
}

export async function exitFullscreen(): Promise<boolean> {
  if (!isFullscreen()) return true;
  try {
    await document.exitFullscreen();
    return true;
  } catch {
    return false;
  }
}

/** Attempt to lock the screen orientation to landscape. Returns whether it worked. */
export async function lockLandscapeOrientation(): Promise<boolean> {
  const orientation = screen.orientation as LockableOrientation | undefined;
  if (typeof orientation?.lock !== 'function') return false;
  try {
    await orientation.lock('landscape');
    return true;
  } catch {
    return false;
  }
}

export function unlockOrientation(): void {
  const orientation = screen.orientation as LockableOrientation | undefined;
  try {
    orientation?.unlock?.();
  } catch {
    /* unlock is optional and may throw outside fullscreen */
  }
}

/** Subscribe to fullscreen and orientation changes. Returns an unsubscribe function. */
export function watchDisplay(onChange: (state: { fullscreen: boolean; orientation: OrientationInfo }) => void): () => void {
  const emit = () => onChange({ fullscreen: isFullscreen(), orientation: currentOrientation() });
  const events: Array<[EventTarget, string]> = [
    [document, 'fullscreenchange'],
    [screen.orientation ?? window, 'change'],
    [window, 'resize'],
    [window, 'orientationchange'],
  ];
  for (const [target, event] of events) target.addEventListener(event, emit);
  emit();
  return () => {
    for (const [target, event] of events) target.removeEventListener(event, emit);
  };
}

/** Guidance shown when the browser cannot force landscape. */
export function landscapeHint(): string {
  return 'Gire o aparelho para a horizontal. O navegador não permite bloquear a orientação nesta situação.';
}
