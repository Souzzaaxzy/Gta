import type { App, AppSnapshot } from '@/app/app';
import { APP_STATES, type AppAction } from '@/app/app-state';
import { formatBytes, formatFps } from '@/utils/format';
import { Panel, type PanelId } from './panel';

/**
 * Binds the application to the DOM.
 *
 * Everything rendered here comes from an `AppSnapshot`, so the interface can never show a
 * state the application is not actually in. The primary button is disabled until the
 * application says a disc is mounted and verified — it never pretends to start a game.
 */
export class Ui {
  private readonly panel: Panel;
  private snapshot: AppSnapshot | null = null;
  private toastTimer: number | null = null;
  private readonly elements: {
    home: HTMLElement;
    stage: HTMLElement;
    canvas: HTMLCanvasElement;
    topbar: HTMLElement;
    statusDot: HTMLElement;
    statusTitle: HTMLElement;
    statusDetail: HTMLElement;
    progressWrap: HTMLElement;
    progressBar: HTMLElement;
    requirements: HTMLElement;
    primary: HTMLButtonElement;
    secondary: HTMLButtonElement;
    fpsBadge: HTMLElement;
    netBadge: HTMLElement;
    padBadge: HTMLElement;
    toast: HTMLElement;
    fileInput: HTMLInputElement;
    panel: HTMLElement;
    panelTitle: HTMLElement;
    panelBody: HTMLElement;
    stageScrim: HTMLElement;
  };

  constructor(private readonly app: App) {
    this.elements = {
      home: must('home'),
      stage: must('stage'),
      canvas: must('outputCanvas') as HTMLCanvasElement,
      topbar: must('topbar'),
      statusDot: must('statusDot'),
      statusTitle: must('statusTitle'),
      statusDetail: must('statusDetail'),
      progressWrap: must('progressWrap'),
      progressBar: must('progressBar'),
      requirements: must('requirements'),
      primary: must('btnPrimary') as HTMLButtonElement,
      secondary: must('btnSecondary') as HTMLButtonElement,
      fpsBadge: must('fpsBadge'),
      netBadge: must('netBadge'),
      padBadge: must('padBadge'),
      toast: must('toast'),
      fileInput: must('fileInput') as HTMLInputElement,
      panel: must('panel'),
      panelTitle: must('panelTitle'),
      panelBody: must('panelBody'),
      stageScrim: must('stageScrim'),
    };

    this.panel = new Panel(this.app, this.elements.panel, this.elements.panelTitle, this.elements.panelBody, () => {
      this.elements.panel.hidden = true;
    });

    this.app.mountTouchPad(must('touchPadHost'));
    this.wireEvents();
  }

  /** Subscribe and render. */
  start(): () => void {
    return this.app.subscribe((snapshot) => {
      this.snapshot = snapshot;
      this.render(snapshot);
    });
  }

  toast(message: string): void {
    this.elements.toast.textContent = message;
    this.elements.toast.hidden = false;
    this.elements.toast.classList.add('visible');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.elements.toast.classList.remove('visible');
      window.setTimeout(() => {
        this.elements.toast.hidden = true;
      }, 220);
    }, 3200);
  }

  private wireEvents(): void {
    this.elements.primary.addEventListener('click', () => {
      void this.handlePrimaryAction();
    });

    this.elements.secondary.addEventListener('click', () => {
      this.elements.fileInput.click();
    });

    this.elements.fileInput.addEventListener('change', () => {
      const file = this.elements.fileInput.files?.[0];
      this.elements.fileInput.value = '';
      if (file) void this.app.selectDisc(file);
    });

    must('btnMenu').addEventListener('click', () => this.panel.open('settings'));
    must('btnPanelClose').addEventListener('click', () => this.panel.close());
    this.elements.panel.addEventListener('click', (event) => {
      if (event.target === this.elements.panel) this.panel.close();
    });

    must('btnFullscreen').addEventListener('click', () => {
      void this.toggleFullscreen();
    });

    for (const button of document.querySelectorAll<HTMLElement>('[data-open]')) {
      button.addEventListener('click', () => {
        const id = button.dataset.open as PanelId;
        if (id === 'controls') this.panel.open('controls');
        else this.panel.open(id);
      });
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (this.panel.isOpen) this.panel.close();
        else if (this.snapshot?.state.state === 'running') this.app.pause();
      }
      // Never let the page scroll while the game has focus.
      if (this.snapshot?.state.state === 'running' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
        if (document.activeElement === this.elements.canvas) event.preventDefault();
      }
    });

    // Re-apply settings that affect layout when the viewport changes.
    window.addEventListener('resize', () => this.updateStageLayout());
    window.addEventListener('orientationchange', () => this.updateStageLayout());
  }

  private async handlePrimaryAction(): Promise<void> {
    const snapshot = this.snapshot;
    if (!snapshot) return;
    switch (snapshot.state.state) {
      case 'awaiting-files':
        if (snapshot.game.present) await this.app.startGame();
        else this.elements.fileInput.click();
        break;
      case 'paused':
        this.app.resume();
        break;
      case 'running':
      case 'starting-game':
        this.app.pause();
        break;
      case 'error':
      case 'storage-error':
        await this.app.startGame();
        break;
      case 'context-lost':
        window.location.reload();
        break;
      default:
        break;
    }
  }

  private async toggleFullscreen(): Promise<void> {
    const message = this.snapshot?.fullscreen
      ? (await this.app.exitGameFullscreen(), 'Tela cheia desativada.')
      : await this.app.enterGameFullscreen();
    this.toast(message);
  }

  private render(snapshot: AppSnapshot): void {
    const state = snapshot.state;
    const playing = ['running', 'starting-game', 'paused', 'saving', 'restoring'].includes(state.state);

    this.elements.home.classList.toggle('hidden', playing);
    this.elements.topbar.hidden = !playing;
    document.body.classList.toggle('fullscreen-active', snapshot.fullscreen);

    this.elements.statusTitle.textContent = state.title;
    this.elements.statusDetail.textContent = state.detail;
    this.elements.statusDot.className = 'status-dot';
    if (state.busy) this.elements.statusDot.classList.add('busy');
    else if (state.state === 'error' || state.state === 'storage-error' || state.state === 'context-lost' || state.state === 'incompatible') {
      this.elements.statusDot.classList.add('error');
    } else if (state.state === 'running') {
      this.elements.statusDot.classList.add('ok');
    }

    this.renderRequirements(snapshot);
    this.renderProgress(snapshot);
    this.renderButtons(snapshot);
    this.renderBadges(snapshot);
    this.updateStageLayout();
  }

  private renderRequirements(snapshot: AppSnapshot): void {
    const list = this.elements.requirements;
    list.replaceChildren();

    const game = snapshot.game;
    const compatibility = snapshot.compatibility;

    if (compatibility && !compatibility.ok) {
      for (const blocker of compatibility.blockers) list.append(requirement(blocker, 'error'));
    }

    if (game.info) {
      const label = game.restored ? 'Disco guardado' : 'Disco selecionado';
      list.append(requirement(`${label}: ${game.info.name} (${formatBytes(game.info.size)})`, game.present ? 'ok' : 'error'));
      if (game.validation) {
        for (const issue of game.validation.issues) {
          if (issue.severity === 'info') continue;
          list.append(requirement(issue.message, issue.severity === 'error' ? 'error' : 'warn'));
        }
      }
    } else {
      list.append(requirement('Nenhuma imagem de disco selecionada.', 'warn'));
    }

    list.append(requirement('BIOS: não é necessária (o Play! usa BIOS HLE).', 'ok'));

    if (snapshot.capabilities) {
      const memory = snapshot.capabilities.deviceMemoryGb;
      if (memory !== null) {
        list.append(
          requirement(
            `RAM informada pelo navegador: ${memory} GB${memory < 2 ? ' — abaixo da meta de 2 GB.' : ''}`,
            memory < 2 ? 'warn' : 'ok',
          ),
        );
      }
    }

    if (snapshot.memoryCard?.present) {
      list.append(
        requirement(
          `Cartão de memória guardado: ${snapshot.memoryCard.fileCount} arquivos.`,
          snapshot.memoryCard.saveFolders.length > 0 ? 'ok' : 'warn',
        ),
      );
    }

    if (snapshot.offlineReady) list.append(requirement('Recursos essenciais guardados para uso offline.', 'ok'));
    if (!snapshot.online) list.append(requirement('Sem conexão: o modo offline depende dos recursos já guardados.', 'warn'));
  }

  private renderProgress(snapshot: AppSnapshot): void {
    const state = snapshot.state;
    const show = state.busy && (state.state === 'loading-core' || state.state === 'verifying' || state.state === 'starting-game');
    this.elements.progressWrap.hidden = !show;
    if (!show) return;

    // Indeterminate animation while the real ratio is unknown.
    const ratio = state.state === 'loading-core' ? 0.5 : state.state === 'starting-game' ? 0.9 : 0.2;
    this.elements.progressBar.style.width = `${Math.round(ratio * 100)}%`;
  }

  private renderButtons(snapshot: AppSnapshot): void {
    const state = snapshot.state;
    const game = snapshot.game;

    let primaryLabel = 'INICIAR JOGO';
    let primaryEnabled = false;

    switch (state.state) {
      case 'awaiting-files':
        if (game.present) {
          primaryLabel = 'INICIAR JOGO';
          primaryEnabled = true;
        } else {
          primaryLabel = 'ESCOLHER ARQUIVO DO JOGO';
          primaryEnabled = true;
        }
        break;
      case 'running':
      case 'starting-game':
        primaryLabel = 'PAUSAR';
        primaryEnabled = true;
        break;
      case 'paused':
        primaryLabel = 'CONTINUAR';
        primaryEnabled = true;
        break;
      case 'error':
      case 'storage-error':
        primaryLabel = 'TENTAR NOVAMENTE';
        primaryEnabled = true;
        break;
      case 'context-lost':
        primaryLabel = 'RECARREGAR';
        primaryEnabled = true;
        break;
      case 'incompatible':
        primaryLabel = 'NAVEGADOR INCOMPATÍVEL';
        primaryEnabled = false;
        break;
      default:
        primaryLabel = state.busy ? 'AGUARDE…' : 'INICIAR JOGO';
        primaryEnabled = false;
    }

    this.elements.primary.textContent = primaryLabel;
    this.elements.primary.disabled = !primaryEnabled;

    // The secondary button only makes sense before a disc is mounted.
    const showSecondary = !game.present && !state.busy;
    this.elements.secondary.hidden = !showSecondary;
  }

  private renderBadges(snapshot: AppSnapshot): void {
    const stats = snapshot.stats;
    if (stats && stats.fps > 0) {
      this.elements.fpsBadge.hidden = false;
      this.elements.fpsBadge.textContent = `${formatFps(stats.fps)} · EE ${stats.eeUsage.toFixed(0)}%`;
      this.elements.fpsBadge.className = `badge ${stats.fps >= 25 ? 'good' : stats.fps >= 15 ? 'warn' : ''}`;
    } else {
      this.elements.fpsBadge.hidden = true;
    }

    this.elements.netBadge.hidden = snapshot.online;
    if (!snapshot.online) {
      this.elements.netBadge.textContent = 'offline';
      this.elements.netBadge.className = 'badge warn';
    }

    if (snapshot.gamepads.length > 0) {
      this.elements.padBadge.hidden = false;
      this.elements.padBadge.textContent = `controle: ${snapshot.gamepads.length}`;
      this.elements.padBadge.className = 'badge good';
    } else {
      this.elements.padBadge.hidden = true;
    }
  }

  private updateStageLayout(): void {
    // The canvas keeps its CSS size; the emulator scales its output into it. Keeping the
    // canvas visible behind the home screen avoids recreating the WebGL context.
    const rect = this.elements.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.elements.canvas.width !== width) this.elements.canvas.width = width;
    if (this.elements.canvas.height !== height) this.elements.canvas.height = height;
  }
}

function must(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Elemento obrigatório ausente: #${id}`);
  return element;
}

function requirement(message: string, kind: 'ok' | 'warn' | 'error' | 'info'): HTMLElement {
  const item = document.createElement('li');
  item.className = kind === 'info' ? '' : kind;
  item.textContent = message;
  return item;
}

export { APP_STATES };
export type { AppAction };
