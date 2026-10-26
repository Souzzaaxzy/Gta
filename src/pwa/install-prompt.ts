/**
 * PWA install prompt handling.
 *
 * Chromium browsers fire `beforeinstallprompt` and let the page trigger the install; iOS
 * Safari has no such API and requires the user to use Share → Add to Home Screen. Both
 * paths are surfaced so the interface can give accurate instructions.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState = 'unsupported' | 'available' | 'ios-manual' | 'installed';

export class InstallPrompt {
  private deferred: BeforeInstallPromptEvent | null = null;
  private state: InstallState = 'unsupported';
  private readonly listeners = new Set<(state: InstallState) => void>();

  constructor() {
    if (this.isStandalone()) {
      this.state = 'installed';
      return;
    }
    if (this.isIos()) {
      // iOS never fires beforeinstallprompt; the user installs through the Share sheet.
      this.state = 'ios-manual';
    }
    window.addEventListener('beforeinstallprompt', this.onBeforeInstallPrompt);
    window.addEventListener('appinstalled', this.onInstalled);
  }

  get current(): InstallState {
    return this.state;
  }

  subscribe(listener: (state: InstallState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: InstallState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  private onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    this.deferred = event as BeforeInstallPromptEvent;
    this.set('available');
  };

  private onInstalled = () => {
    this.deferred = null;
    this.set('installed');
  };

  /** Trigger the browser's install prompt. Returns whether the user accepted. */
  async prompt(): Promise<boolean> {
    if (!this.deferred) return false;
    try {
      await this.deferred.prompt();
      const { outcome } = await this.deferred.userChoice;
      this.deferred = null;
      if (outcome === 'accepted') this.set('installed');
      else this.set(this.isIos() ? 'ios-manual' : 'unsupported');
      return outcome === 'accepted';
    } catch {
      return false;
    }
  }

  /** Instructions to show when the browser will not install programmatically. */
  instructions(): string {
    switch (this.state) {
      case 'available':
        return 'Toque em "Instalar" para adicionar o aplicativo à tela inicial.';
      case 'ios-manual':
        return 'No iPhone ou iPad: toque em Compartilhar e depois em "Adicionar à Tela de Início". O Safari não permite instalar automaticamente.';
      case 'installed':
        return 'O aplicativo já está instalado.';
      default:
        return 'Este navegador não oferece instalação. Abra pelo Chrome no Android para adicionar à tela inicial.';
    }
  }

  private isStandalone(): boolean {
    const displayStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return displayStandalone || iosStandalone;
  }

  private isIos(): boolean {
    const ua = navigator.userAgent;
    // iPadOS reports itself as a Mac; the touch point count is the reliable tell.
    const iPadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    return (/iPad|iPhone|iPod/.test(ua) || iPadOs) && !('MSStream' in window);
  }
}

export function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  const iPadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadOs;
}
