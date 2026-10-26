import { AppStateStore } from './app-state-store';
import type { AppState } from './app-state';
import { enterFullscreen, exitFullscreen, isFullscreen, landscapeHint, watchDisplay } from './fullscreen';
import { GamepadManager, type GamepadInfo } from '@/controls/gamepad';
import { InputBridge } from '@/controls/input-bridge';
import { PS2_AXIS_KEY_CODES, PS2_KEY_CODES, type Ps2Button } from '@/controls/keymap';
import { TouchPad } from '@/controls/touch-pad';
import { PlayEmulatorAdapter } from '@/emulator/play-adapter';
import type { EmulatorStats } from '@/emulator/types';
import { GameFileManager } from '@/files/game-files';
import { ServiceWorkerController, checkOfflineReadiness, watchConnectivity } from '@/pwa/service-worker';
import { InstallPrompt } from '@/pwa/install-prompt';
import { MemoryCardManager } from '@/saves/memory-card';
import { SaveStateManager } from '@/saves/save-states';
import { detectCapabilities, evaluateCompatibility, type CompatibilityVerdict, type DeviceCapabilities } from '@/settings/capabilities';
import { SettingsStore } from '@/settings/settings-store';
import type { GamepadAction, PerformanceProfile, ResolutionFactor, Settings } from '@/settings/types';
import { LogBuffer } from '@/utils/log-buffer';
import { rafThrottle } from '@/utils/misc';

/**
 * Messages the Play! core prints when it cannot mount or boot a disc.
 *
 * Taken from the core's own source (`Source/ui_js/Ps2VmJs.cpp`, `Source/PS2VM.cpp`). These
 * are the only reliable signal: the core logs and returns instead of throwing.
 */
const CORE_BOOT_FAILURE_PATTERN =
  /Failed to start:|Error mounting cdrom0|No 'SYSTEM\.CNF' file found|Error mounting cdrom/i;

export interface AppSnapshot {
  state: ReturnType<AppStateStore['info']>;
  settings: Settings;
  capabilities: DeviceCapabilities | null;
  compatibility: CompatibilityVerdict | null;
  game: ReturnType<GameFileManager['status']>;
  stats: EmulatorStats | null;
  gamepads: GamepadInfo[];
  fullscreen: boolean;
  online: boolean;
  offlineReady: boolean;
  installState: string;
  memoryCard: Awaited<ReturnType<MemoryCardManager['summary']>> | null;
  saveSlots: Awaited<ReturnType<SaveStateManager['list']>>;
  log: ReturnType<LogBuffer['all']>;
}

/**
 * Wires every subsystem together and owns the boot flow.
 *
 * Nothing here fakes progress: each transition happens because the corresponding real step
 * finished, and failures land in the `error` state with the actual message from the core.
 */
export class App {
  readonly state = new AppStateStore();
  readonly log = new LogBuffer();
  readonly settings: SettingsStore;
  readonly gameFiles = new GameFileManager();
  readonly saveStates = new SaveStateManager();
  readonly memoryCard = new MemoryCardManager();
  readonly installPrompt = new InstallPrompt();
  readonly serviceWorker = new ServiceWorkerController();

  private readonly inputBridge: InputBridge;
  private readonly gamepads: GamepadManager;
  private touchPad: TouchPad | null = null;
  private emulator: PlayEmulatorAdapter | null = null;
  private capabilities: DeviceCapabilities | null = null;
  private compatibility: CompatibilityVerdict | null = null;
  private stats: EmulatorStats | null = null;
  private statsTimer: number | null = null;
  private bootFailureWatcher: (() => void) | null = null;
  private online = navigator.onLine;
  private offlineReady = false;
  private fullscreen = false;
  private gamepadInfo: GamepadInfo[] = [];
  private memoryCardSummary: Awaited<ReturnType<MemoryCardManager['summary']>> | null = null;
  private saveSlots: Awaited<ReturnType<SaveStateManager['list']>> = [];
  private readonly listeners = new Set<(snapshot: AppSnapshot) => void>();
  private readonly cleanups: Array<() => void> = [];
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.settings = new SettingsStore();
    this.inputBridge = new InputBridge(canvas);
    this.gamepads = new GamepadManager((button, pressed) => this.onGamepadButton(button, pressed));
    this.gamepads.onAxisChangeCallback = (axis, direction, pressed) => this.onAxisChange(axis, direction, pressed);
  }

  /** Current snapshot of everything the interface renders. */
  snapshot(): AppSnapshot {
    return {
      state: this.state.info(),
      settings: this.settings.value,
      capabilities: this.capabilities,
      compatibility: this.compatibility,
      game: this.gameFiles.status(),
      stats: this.stats,
      gamepads: this.gamepadInfo,
      fullscreen: this.fullscreen,
      online: this.online,
      offlineReady: this.offlineReady,
      installState: this.installPrompt.current,
      memoryCard: this.memoryCardSummary,
      saveSlots: this.saveSlots,
      log: this.log.all(),
    };
  }

  subscribe(listener: (snapshot: AppSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  /** Boot the shell: probe the device, restore stored state, start background services. */
  async boot(): Promise<void> {
    this.state.transition('booting');
    this.state.subscribe(() => this.notify());
    this.log.subscribe(() => this.notify());

    this.cleanups.push(
      this.settings.subscribe(() => {
        this.applySettings();
        this.notify();
      }),
    );

    this.cleanups.push(watchConnectivity((online) => {
      this.online = online;
      this.notify();
    }));

    this.cleanups.push(watchDisplay(({ fullscreen }) => {
      this.fullscreen = fullscreen;
      this.resizeCanvas();
      this.notify();
    }));

    this.cleanups.push(
      this.gamepads.events.on('presence', ({ count }) => {
        this.gamepadInfo = this.gamepads.list();
        this.log.info(count > 0 ? `Controle físico detectado (${count}).` : 'Nenhum controle físico conectado.');
        this.applyGamepadVisibility();
        this.notify();
      }),
    );
    this.cleanups.push(this.gamepads.events.on('connected', (info) => this.log.info(`Controle conectado: ${info.id}`)));
    this.cleanups.push(
      this.gamepads.events.on('disconnected', (info) => this.log.warn(`Controle desconectado: ${info.id}`)),
    );

    this.installGlobalReleaseHandlers();
    this.gamepads.setMapping(this.settings.value.gamepadMapping);
    this.gamepads.start();

    // Probe the device first: an incompatible browser must not even try to download 2.6 MB.
    this.capabilities = await detectCapabilities();
    this.compatibility = evaluateCompatibility(this.capabilities);
    this.log.info(
      `Aparelho: WebGL2=${this.capabilities.webgl2}, SIMD=${this.capabilities.webAssemblySimd}, threads=${this.capabilities.webAssemblyThreads}, isolado=${this.capabilities.crossOriginIsolated}, RAM≈${
        this.capabilities.deviceMemoryGb ?? '?'
      } GB, núcleos=${this.capabilities.hardwareConcurrency ?? '?'}`,
    );

    if (!this.settings.value.profileOverridden && this.compatibility.suggestedProfile !== this.settings.value.profile) {
      this.settings.applyProfile(this.compatibility.suggestedProfile, { markOverridden: false });
      this.log.info(`Perfil sugerido automaticamente: ${this.compatibility.suggestedProfile}.`);
    }

    void this.serviceWorker.register().then((status) => {
      if (status.state === 'error' && status.error) this.log.warn(`Service worker: ${status.error}`);
      this.notify();
    });

    // Recover the disc and saves stored by a previous session.
    const game = await this.gameFiles.restore();
    if (game.present) {
      this.log.info(`Disco recuperado do armazenamento: ${game.info?.name}.`);
    }
    await this.refreshSaves();
    this.memoryCardSummary = await this.memoryCard.summary();
    this.offlineReady = (await checkOfflineReadiness()).ready;

    if (!this.compatibility.ok) {
      this.state.transition('incompatible', { message: this.compatibility.blockers.join(' ') });
    } else if (game.present) {
      this.state.transition('verifying');
      this.state.transition('awaiting-files', {
        message: `Disco pronto: ${game.info?.name}. Toque em INICIAR JOGO para carregar.`,
      });
    } else {
      this.state.transition('awaiting-files');
    }
    this.notify();
  }

  /** Attach the on-screen pad to a container. */
  mountTouchPad(container: HTMLElement): TouchPad {
    if (this.touchPad) return this.touchPad;
    this.touchPad = new TouchPad({
      onButton: (button, pressed) => {
        const code = PS2_KEY_CODES[button];
        if (pressed) this.inputBridge.press(code);
        else this.inputBridge.release(code);
      },
      onAxis: (axis, direction, pressed) => this.onAxisChange(axis, direction, pressed),
    });
    container.appendChild(this.touchPad.element);
    this.applySettings();
    return this.touchPad;
  }

  /**
   * Watch the core's own output for a boot failure.
   *
   * Play! reports "Failed to start: …" by printing and returning rather than by throwing.
   * Without this, a disc the core cannot mount would leave the interface waiting for frames
   * that never arrive. The patterns below are the core's own messages (`Ps2VmJs.cpp`:
   * "Failed to start: %s." and the cdrom0 mount errors).
   *
   * The subscription is torn down before we log, otherwise our own message would match the
   * pattern and recurse.
   */
  private watchForBootFailure(): { stop: () => void } {
    let stopped = false;
    const stop = this.log.subscribe((entry) => {
      if (stopped) return;
      if (!CORE_BOOT_FAILURE_PATTERN.test(entry.message)) return;
      stopped = true;
      stop();
      this.bootFailureWatcher = null;

      const reason = entry.message.trim();
      this.log.error(`O emulador recusou o disco: ${reason}`);
      if (this.state.state === 'starting-game') {
        this.state.transition('error', {
          message: `O emulador não conseguiu carregar o disco.\n\nMotivo informado pelo núcleo:\n${reason}\n\nVerifique se a imagem é um disco de PlayStation 2 completo e não corrompido.`,
        });
      }
      this.notify();
    });
    return { stop };
  }

  /** Release every held key and every gamepad button. Used by the interface and tests. */
  releaseAllInputs(): void {
    this.inputBridge.releaseAll();
    this.gamepads.releaseEverything();
  }

  /** Keys currently held. Exposed for diagnostics and automated tests. */
  activeKeys(): string[] {
    return this.inputBridge.activeKeys;
  }

  /** The on-screen pad, once mounted. */
  get pad(): TouchPad | null {
    return this.touchPad;
  }

  /** The emulator adapter, once created. */
  get emulatorAdapter(): PlayEmulatorAdapter | null {
    return this.emulator;
  }

  /**
   * Handle a file chosen by the user.
   */
  async selectDisc(file: File): Promise<void> {
    this.state.transition('verifying');
    this.log.info(`Verificando ${file.name} (${(file.size / 1048576).toFixed(1)} MB)…`);
    try {
      const validation = await this.gameFiles.mount(file);
      for (const issue of validation.issues) {
        if (issue.severity === 'error') this.log.error(issue.message);
        else if (issue.severity === 'warning') this.log.warn(issue.message);
        else this.log.info(issue.message);
      }
      if (!validation.valid) {
        this.state.transition('awaiting-files', {
          message: this.gameFiles.status().error ?? 'O arquivo não pôde ser usado.',
        });
        this.notify();
        return;
      }
      this.state.transition('awaiting-files', {
        message: `Disco pronto: ${file.name}. Toque em INICIAR JOGO.`,
      });
    } catch (error) {
      this.fail('Falha ao verificar o arquivo', error);
      return;
    }
    this.notify();
  }

  /**
   * Load the emulator core and create the VM, without mounting a disc.
   *
   * Useful to preload the 2.6 MB core while the user is still choosing a file, and used by
   * the automated tests to verify the core really instantiates.
   *
   * Must be called from a user gesture on iOS: `initVm` creates the WebGL context.
   */
  async loadCore(): Promise<PlayEmulatorAdapter> {
    if (this.emulator) return this.emulator;

    if (this.compatibility && !this.compatibility.ok) {
      throw new Error(this.compatibility.blockers.join(' '));
    }

    this.state.transition('loading-core');
    const adapter = new PlayEmulatorAdapter(this.canvas);
    this.log.info(`Núcleo: ${adapter.descriptor.name} — ${adapter.descriptor.license}`);
    await adapter.load({
      onLog: (level, message) => this.log.push(level, message),
      onProgress: (progress) => {
        if (progress.message) this.log.info(progress.message);
      },
      onContextChange: (state) => {
        if (state === 'lost') this.state.transition('context-lost');
        this.notify();
      },
    });
    this.state.transition('initializing');
    adapter.initVm();
    this.log.info('Máquina virtual criada.');
    this.memoryCard.attach(adapter.raw!);
    this.emulator = adapter;
    this.applySettings();
    this.notify();
    return adapter;
  }

  /**
   * The real start flow. Every step is an actual operation; the first one that fails stops
   * the flow and reports why.
   */
  async startGame(): Promise<void> {
    const game = this.gameFiles.status();
    if (!game.present || !this.gameFiles.currentFile) {
      this.state.transition('awaiting-files', { message: 'Nenhum disco válido está disponível.' });
      this.notify();
      return;
    }
    if (this.compatibility && !this.compatibility.ok) {
      this.state.transition('incompatible', { message: this.compatibility.blockers.join(' ') });
      this.notify();
      return;
    }

    try {
      if (!this.emulator) {
        await this.loadCore();
      } else if (!this.emulator.booted) {
        this.state.transition('initializing');
      }

      const emulator = this.emulator;
      if (!emulator) throw new Error('O núcleo do emulador não foi inicializado.');

      if (emulator.booted) {
        this.state.transition('running');
        this.notify();
        return;
      }

      // Restore the virtual memory card before boot: the game reads it while it starts.
      const restored = await this.memoryCard.restore();
      if (restored > 0) this.log.info(`Cartão de memória restaurado (${restored} arquivos).`);

      this.state.transition('starting-game');
      const file = this.gameFiles.currentFile;
      if (!file) throw new Error('Nenhum arquivo de disco disponível.');
      this.log.info(`Entregando o disco ao emulador: ${file.name}`);

      // The core reports a failed boot by logging and returning, not by throwing. Watch its
      // output so the interface can show the real reason instead of waiting forever.
      const bootFailure = this.watchForBootFailure();
      this.bootFailureWatcher = bootFailure.stop;

      await emulator.boot({ file, name: file.name });
      this.log.info('Disco aceito pelo emulador. Aguardando os primeiros quadros…');

      this.startStatsLoop();
      this.memoryCard.startAutoPersist();
      this.resizeCanvas();

      // Move to `running` only when the core actually renders a frame.
      let framesSeen = false;
      const waitForFrames = () => {
        if (framesSeen || !this.emulator) return;
        const stats = this.emulator.stats();
        if (stats.frames > 0 || stats.fps > 0) {
          framesSeen = true;
          this.log.info('O emulador começou a renderizar.');
          this.state.transition('running');
          if (this.touchPad) this.touchPad.show();
          this.notify();
          return;
        }
        window.setTimeout(waitForFrames, 500);
      };
      window.setTimeout(waitForFrames, 500);
      this.notify();
    } catch (error) {
      this.fail('Não foi possível iniciar o jogo', error);
    }
  }

  pause(): void {
    if (this.state.state !== 'running') return;
    this.inputBridge.releaseAll();
    this.gamepads.releaseEverything();
    this.state.transition('paused');
    this.notify();
  }

  resume(): void {
    if (this.state.state !== 'paused') return;
    this.state.transition('running');
    this.notify();
  }

  async saveState(slot: number): Promise<void> {
    if (!this.emulator) {
      this.log.warn('Nada para salvar: o emulador não está em execução.');
      return;
    }
    this.state.transition('saving');
    this.notify();
    try {
      const bytes = await this.emulator.saveState();
      if (!bytes || bytes.byteLength === 0) {
        throw new Error('O núcleo não produziu um estado de salvamento.');
      }
      await this.saveStates.write(slot, bytes, this.gameFiles.info?.name ?? null);
      this.log.info(`Estado salvo no slot ${slot + 1} (${(bytes.byteLength / 1048576).toFixed(1)} MB).`);
      await this.refreshSaves();
      this.state.transition('running', { message: `Estado salvo no slot ${slot + 1}.` });
    } catch (error) {
      this.log.error(`Falha ao salvar: ${error instanceof Error ? error.message : String(error)}`);
      this.state.transition('storage-error', { message: 'Não foi possível gravar o estado.' });
    }
    this.notify();
  }

  async loadState(slot: number): Promise<void> {
    if (!this.emulator) {
      this.log.warn('Nada para carregar: o emulador não está em execução.');
      return;
    }
    this.state.transition('restoring');
    this.notify();
    try {
      const bytes = await this.saveStates.read(slot);
      if (!bytes) throw new Error(`O slot ${slot + 1} está vazio.`);
      const ok = await this.emulator.loadState(bytes);
      if (!ok) throw new Error('O núcleo recusou o estado de salvamento.');
      this.log.info(`Estado do slot ${slot + 1} restaurado.`);
      this.state.transition('running', { message: `Estado do slot ${slot + 1} restaurado.` });
    } catch (error) {
      this.log.error(`Falha ao restaurar: ${error instanceof Error ? error.message : String(error)}`);
      this.state.transition('error', { message: error instanceof Error ? error.message : 'Falha ao restaurar o estado.' });
    }
    this.notify();
  }

  async deleteState(slot: number): Promise<void> {
    await this.saveStates.remove(slot);
    this.log.info(`Slot ${slot + 1} apagado.`);
    await this.refreshSaves();
    this.notify();
  }

  /** Snapshot the virtual memory card to IndexedDB. */
  async saveMemoryCard(): Promise<void> {
    try {
      const summary = await this.memoryCard.capture();
      this.memoryCardSummary = summary;
      this.log.info(
        summary
          ? `Cartão de memória guardado: ${summary.fileCount} arquivos, ${summary.saveFolders.length} saves.`
          : 'Cartão de memória ainda não está acessível.',
      );
    } catch (error) {
      this.log.error(`Falha ao guardar o cartão: ${error instanceof Error ? error.message : String(error)}`);
      this.state.transition('storage-error', { message: 'Falha ao gravar o cartão de memória.' });
    }
    this.notify();
  }

  async enterGameFullscreen(): Promise<string> {
    const result = await enterFullscreen(document.documentElement, {
      lockLandscape: this.settings.value.requestLandscape,
    });
    this.fullscreen = result.fullscreen;
    this.log.info(result.message);
    if (result.fullscreen && !result.orientationLocked) this.log.warn(landscapeHint());
    this.resizeCanvas();
    this.notify();
    return result.message;
  }

  async exitGameFullscreen(): Promise<void> {
    await exitFullscreen();
    this.fullscreen = isFullscreen();
    this.resizeCanvas();
    this.notify();
  }

  applyProfile(profile: PerformanceProfile): void {
    this.settings.applyProfile(profile);
    this.log.info(`Perfil de desempenho: ${profile}.`);
  }

  setResolutionFactor(factor: ResolutionFactor): void {
    this.settings.update({ resolutionFactor: factor });
    this.emulator?.setResolutionFactor(factor);
    this.log.info(`Resolução interna: ${factor}×.`);
  }

  setFrameLimiter(enabled: boolean): void {
    this.settings.update({ frameLimiter: enabled });
    this.emulator?.setFrameLimiter(enabled);
    this.log.info(`Limitador de quadros: ${enabled ? 'ligado' : 'desligado'}.`);
  }

  setFieldStabilization(enabled: boolean): void {
    this.settings.update({ fieldStabilization: enabled });
    this.emulator?.setFieldStabilization(enabled);
    this.log.info(`Estabilização de campo (anti-tremor): ${enabled ? 'ligada' : 'desligada'}.`);
  }

  setGamepadBinding(action: GamepadAction, buttonIndex: number): void {
    this.settings.setGamepadBinding(action, buttonIndex);
    this.gamepads.setMapping(this.settings.value.gamepadMapping);
    this.notify();
  }

  resetGamepadMapping(): void {
    this.settings.resetGamepadMapping();
    this.gamepads.setMapping(this.settings.value.gamepadMapping);
    this.notify();
  }

  /** Remove the mounted disc from storage (the game files themselves are untouched). */
  async clearStoredDisc(): Promise<void> {
    await this.gameFiles.clear();
    this.log.info('Disco removido do armazenamento local.');
    this.state.transition('awaiting-files', { message: 'Selecione a imagem do disco novamente.' });
    this.notify();
  }

  /** Drop every stored payload. Used from the storage-error state and the settings screen. */
  async clearAllData(): Promise<void> {
    await this.gameFiles.clear();
    await this.memoryCard.clear();
    for (let slot = 0; slot < this.saveStates.slots; slot++) await this.saveStates.remove(slot);
    await this.serviceWorker.clearCaches();
    this.log.warn('Todos os dados locais foram apagados.');
    await this.refreshSaves();
    this.memoryCardSummary = await this.memoryCard.summary();
    this.state.transition('awaiting-files', { message: 'Dados locais apagados.' });
    this.notify();
  }

  async refreshSaves(): Promise<void> {
    this.saveSlots = await this.saveStates.list();
  }

  refreshOfflineReadiness(): Promise<void> {
    return checkOfflineReadiness().then(({ ready }) => {
      this.offlineReady = ready;
      this.notify();
    });
  }

  dispose(): void {
    if (this.statsTimer !== null) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.bootFailureWatcher?.();
    this.bootFailureWatcher = null;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.length = 0;
    this.touchPad?.destroy();
    this.gamepads.stop();
    this.memoryCard.stopAutoPersist();
    this.emulator?.dispose();
    this.emulator = null;
  }

  private onGamepadButton(action: GamepadAction, pressed: boolean): void {
    if (action in PS2_KEY_CODES) {
      const code = PS2_KEY_CODES[action as Ps2Button];
      if (pressed) this.inputBridge.press(code);
      else this.inputBridge.release(code);
      return;
    }
  }

  private onAxisChange(axis: keyof typeof PS2_AXIS_KEY_CODES, direction: 'negative' | 'positive', pressed: boolean): void {
    const code = PS2_AXIS_KEY_CODES[axis][direction];
    if (pressed) this.inputBridge.press(code);
    else this.inputBridge.release(code);
  }

  private applySettings(): void {
    const settings = this.settings.value;
    if (this.emulator) {
      this.emulator.setResolutionFactor(settings.resolutionFactor);
      this.emulator.setFrameLimiter(settings.frameLimiter);
      this.emulator.setFieldStabilization(settings.fieldStabilization);
    }
    if (this.touchPad) {
      this.touchPad.setOpacity(settings.touchOpacity);
      this.touchPad.setScale(settings.touchScale);
    }
    this.gamepads.setMapping(settings.gamepadMapping);
    this.applyGamepadVisibility();
  }

  private applyGamepadVisibility(): void {
    if (!this.touchPad) return;
    const settings = this.settings.value;
    const shouldShow = settings.showTouchControls && !(settings.hideTouchWhenGamepad && this.gamepadInfo.length > 0);
    if (shouldShow && this.state.state === 'running') this.touchPad.show();
    else if (!shouldShow) this.touchPad.hide();
  }

  private startStatsLoop(): void {
    if (this.statsTimer !== null) return;
    this.emulator?.resetStats();
    // Sample once a second: cheap enough not to affect the emulation, frequent enough to
    // be useful. The emulator's own counters reset on read.
    this.statsTimer = window.setInterval(() => {
      if (!this.emulator) return;
      this.stats = this.emulator.stats();
      this.notify();
    }, 1000);
  }

  private readonly resizeCanvas = rafThrottle(() => {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  });

  private installGlobalReleaseHandlers(): void {
    const release = () => {
      this.inputBridge.releaseAll();
      this.gamepads.releaseEverything();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        release();
        // Persist the card when the user leaves, so progress survives an app switch.
        void this.memoryCard.capture().catch(() => undefined);
      }
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

  private fail(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.log.error(`${context}: ${message}`);
    const next: AppState = this.state.canTransitionTo('error') ? 'error' : this.state.state;
    if (next === 'error') {
      this.state.transition('error', { message: `${context}: ${message}` });
    } else {
      this.state.setMessage(`${context}: ${message}`);
    }
    this.notify();
  }
}
