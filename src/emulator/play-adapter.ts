import type { ResolutionFactor } from '@/settings/types';
import type { PlayFactory, PlayModule, PlayModuleOptions } from './play-module';
import type {
  BootOptions,
  EmulatorAdapter,
  EmulatorCallbacks,
  EmulatorDescriptor,
  EmulatorLoadProgress,
  EmulatorStats,
} from './types';

const STATE_PATH = '/work/state.bin';

/**
 * Adapter over the Play! web core.
 *
 * Verified facts about the core, from its source (Play! `83700b2` + the frontend patch
 * shipped in `public/emulator/`):
 *
 * - It is a *threaded* Emscripten build. It needs `SharedArrayBuffer`, therefore a
 *   cross-origin isolated document.
 * - It uses HLE BIOS: no BIOS file is required.
 * - `initVm()` creates the VM, the WebGL2 context (looked up by the selector
 *   `#outputCanvas`) and the input bindings. It must be called inside a user gesture on
 *   iOS, otherwise the context comes back unusable.
 * - Disc data is pulled through `Module.discImageDevice`, which the core calls from wasm
 *   (`MAIN_THREAD_EM_ASM`). The device must exist before `bootDiscImage()`.
 * - Input is keyboard only, dispatched to `#outputCanvas`; see `src/controls/keymap.ts`.
 */
export class PlayEmulatorAdapter implements EmulatorAdapter {
  readonly descriptor: EmulatorDescriptor = {
    id: 'play',
    name: 'Play!',
    version: 'web build, upstream 83700b2',
    license: 'BSD-2-Clause (Jean-Philip Desjardins)',
    hleBios: true,
  };

  private module: PlayModule | null = null;
  private callbacks: EmulatorCallbacks = {};
  private vmInitialized = false;
  private isBooted = false;
  private discDevice: ReturnType<typeof createDiscImageDevice> | null = null;
  private lastFrameCount = 0;
  private lastStatsAt = 0;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly baseUrl: string = import.meta.env.BASE_URL,
  ) {}

  get ready(): boolean {
    return this.module !== null;
  }

  get booted(): boolean {
    return this.isBooted;
  }

  /** The instantiated core, for callers that need the raw module (tests, diagnostics). */
  get raw(): PlayModule | null {
    return this.module;
  }

  /**
   * How much of the disc the core has actually pulled from the page.
   *
   * This is the evidence that streaming works: mounting a multi-gigabyte image should show
   * a byte count far smaller than the file, not a full load.
   */
  discStats(): { readCount: number; bytesRead: number; failedReads: number; fileSize: number } | null {
    return this.discDevice?.stats() ?? null;
  }

  private assetUrl(path: string): string {
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    return new URL(`${base}emulator/${path}`, window.location.href).href;
  }

  async load(callbacks: EmulatorCallbacks = {}): Promise<void> {
    if (this.module) return;
    this.callbacks = callbacks;

    const jsUrl = this.assetUrl('Play.js');
    const wasmUrl = this.assetUrl('Play.wasm');

    callbacks.onProgress?.({ phase: 'wasm', ratio: 0, message: 'Baixando o núcleo do emulador…' });
    const wasmBinary = await this.fetchWasm(wasmUrl, callbacks);

    callbacks.onProgress?.({ phase: 'instantiate', ratio: null, message: 'Instanciando o WebAssembly…' });

    const factory = await this.importFactory(jsUrl);

    const options: PlayModuleOptions & { wasmBinary?: Uint8Array } = {
      // The pthread workers are spawned from this URL, so it must be absolute and correct.
      mainScriptUrlOrBlob: jsUrl,
      locateFile: (path) => this.assetUrl(path),
      wasmBinary,
      print: (message) => callbacks.onLog?.('info', message),
      printErr: (message) => {
        const level = /error|assert|abort|fail|exception/i.test(message) ? 'error' : 'warn';
        callbacks.onLog?.(level, message);
      },
    };

    this.module = await factory(options);
    this.bindContextEvents();
    callbacks.onProgress?.({ phase: 'ready', ratio: 1, message: 'Núcleo pronto.' });
  }

  private async fetchWasm(url: string, callbacks: EmulatorCallbacks): Promise<Uint8Array> {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`Não foi possível baixar ${url} (HTTP ${response.status}).`);
    }
    const total = Number(response.headers.get('content-length') ?? 0);
    if (!response.body || total === 0) {
      return new Uint8Array(await response.arrayBuffer());
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      callbacks.onProgress?.({
        phase: 'wasm',
        ratio: Math.min(1, received / total),
        message: `Baixando o núcleo do emulador… ${(received / 1048576).toFixed(1)} MB de ${(total / 1048576).toFixed(1)} MB`,
      });
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }

  private async importFactory(jsUrl: string): Promise<PlayFactory> {
    // The core is served as a static asset, not bundled: it must keep its own worker URLs.
    const imported = (await import(/* @vite-ignore */ jsUrl)) as { default: PlayFactory };
    if (typeof imported.default !== 'function') {
      throw new Error('O núcleo do emulador não exportou uma função de inicialização.');
    }
    return imported.default;
  }

  initVm(): void {
    const module = this.requireModule();
    if (this.vmInitialized) return;
    if (!window.crossOriginIsolated) {
      throw new Error(
        'Contexto não isolado: SharedArrayBuffer está indisponível. A página precisa dos cabeçalhos COOP/COEP.',
      );
    }
    if (typeof module.ccall === 'function') {
      module.ccall('initVm', '', [], []);
    } else {
      throw new Error('O núcleo não expõe initVm().');
    }
    this.vmInitialized = true;
  }

  async boot({ file, name }: BootOptions): Promise<void> {
    const module = this.requireModule();
    if (this.isBooted) throw new Error('Um jogo já está em execução. Recarregue a página para trocar de disco.');
    if (!this.vmInitialized) throw new Error('A máquina virtual ainda não foi inicializada.');

    const isElf = /\.elf$/i.test(name);
    if (isElf) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        module.FS.unlink(name);
      } catch {
        /* the file did not exist yet */
      }
      module.FS.writeFile(name, bytes);
      if (typeof module.bootElf !== 'function') throw new Error('O núcleo não expõe bootElf().');
      module.bootElf(name);
    } else {
      // Streamed reads: the core asks for byte ranges, so the disc never enters RAM whole.
      const device = createDiscImageDevice(module);
      device.setFile(file);
      this.discDevice = device;
      module.discImageDevice = device;
      if (typeof module.bootDiscImage !== 'function') throw new Error('O núcleo não expõe bootDiscImage().');
      module.bootDiscImage(name);
    }

    this.isBooted = true;
    this.lastStatsAt = performance.now();
    this.lastFrameCount = 0;
    this.watchFirstFrame();
  }

  setResolutionFactor(factor: ResolutionFactor): void {
    this.module?.setResolutionFactor?.(factor);
  }

  setFrameLimiter(enabled: boolean): void {
    this.module?.setFrameLimiter?.(enabled);
  }

  setFieldStabilization(enabled: boolean): void {
    this.module?.setDeinterlace?.(enabled);
  }

  stats(): EmulatorStats {
    const module = this.module;
    const now = performance.now();
    const frames = module?.getFrames?.() ?? 0;
    const elapsed = this.lastStatsAt > 0 ? (now - this.lastStatsAt) / 1000 : 0;
    const deltaFrames = Math.max(0, frames - this.lastFrameCount);
    const fps = elapsed > 0 ? deltaFrames / elapsed : 0;

    const result: EmulatorStats = {
      frames: deltaFrames,
      fps,
      eeUsage: module?.getEeUsage?.() ?? -1,
      iopUsage: module?.getIopUsage?.() ?? -1,
      drawCalls: module?.getDrawCalls?.() ?? -1,
    };

    this.lastFrameCount = frames;
    this.lastStatsAt = now;
    return result;
  }

  resetStats(): void {
    this.module?.clearStats?.();
    this.lastFrameCount = 0;
    this.lastStatsAt = performance.now();
  }

  async saveState(): Promise<Uint8Array | null> {
    const module = this.requireModule();
    if (typeof module.saveState !== 'function') return null;
    try {
      module.FS.mkdir('/work');
    } catch {
      /* the directory already exists */
    }
    const ok = module.saveState(STATE_PATH);
    if (!ok) return null;
    try {
      return module.FS.readFile(STATE_PATH);
    } catch {
      return null;
    }
  }

  async loadState(bytes: Uint8Array): Promise<boolean> {
    const module = this.requireModule();
    if (typeof module.loadState !== 'function') return false;
    try {
      module.FS.mkdir('/work');
    } catch {
      /* the directory already exists */
    }
    try {
      module.FS.writeFile(STATE_PATH, bytes);
    } catch {
      return false;
    }
    return module.loadState(STATE_PATH) === true;
  }

  dispose(): void {
    this.disposed = true;
    this.isBooted = false;
    this.vmInitialized = false;
    this.module = null;
    this.discDevice = null;
    this.callbacks = {};
  }

  private watchFirstFrame(): void {
    let reported = false;
    const tick = () => {
      if (reported || this.disposed) return;
      const frames = this.module?.getFrames?.() ?? 0;
      if (frames > 0) {
        reported = true;
        this.callbacks.onFirstFrame?.();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private bindContextEvents(): void {
    this.canvas.addEventListener('webglcontextlost', (event) => {
      // Losing the GL context is fatal for the current session; the user must reload.
      event.preventDefault();
      this.callbacks.onLog?.('error', 'Contexto WebGL perdido. Recarregue a página para continuar.');
      this.callbacks.onContextChange?.('lost');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.callbacks.onLog?.('info', 'Contexto WebGL restaurado.');
      this.callbacks.onContextChange?.('restored');
    });
  }

  private requireModule(): PlayModule {
    if (!this.module) throw new Error('O núcleo do emulador ainda não foi carregado.');
    return this.module;
  }
}

/**
 * Streaming disc device.
 *
 * The core calls `read(destination, offset, length)` from wasm, writes into `HEAPU8` and
 * then spins on `isDone()`. `read` must therefore return immediately and complete
 * asynchronously, which is exactly what `blob.slice().arrayBuffer()` gives us.
 *
 * `stats()` reports how many ranges the core has pulled and how many bytes it has read.
 * That is the evidence that streaming is working: a disc mounted from a multi-gigabyte
 * file shows a small, growing byte count instead of a full load.
 */
export function createDiscImageDevice(module: PlayModule) {
  let file: File | null = null;
  let done = false;
  let readCount = 0;
  let bytesRead = 0;
  let failedReads = 0;

  return {
    setFile(next: File) {
      file = next;
      done = false;
      readCount = 0;
      bytesRead = 0;
      failedReads = 0;
    },
    getFileSize(): number {
      if (!file) throw new Error('Nenhum arquivo de disco foi definido.');
      return file.size;
    },
    isDone(): boolean {
      return done;
    },
    /** Number of byte-range reads the core has requested, and the volume of data. */
    stats(): { readCount: number; bytesRead: number; failedReads: number; fileSize: number } {
      return { readCount, bytesRead, failedReads, fileSize: file?.size ?? 0 };
    },
    read(destination: number, offset: number, length: number): void {
      if (!file) throw new Error('Nenhum arquivo de disco foi definido.');
      done = false;
      readCount++;
      bytesRead += length;
      const target = file;
      target
        .slice(offset, offset + length)
        .arrayBuffer()
        .then((buffer) => {
          module.HEAPU8.set(new Uint8Array(buffer), destination);
          done = true;
        })
        .catch(() => {
          // Signal completion so the core does not spin forever on a failed read.
          failedReads++;
          done = true;
        });
    },
  };
}

export type DiscImageDevice = ReturnType<typeof createDiscImageDevice>;

/** Progress helper so callers can render a single 0..1 bar across phases. */
export function overallProgress(progress: EmulatorLoadProgress): number | null {
  if (progress.ratio === null) return null;
  switch (progress.phase) {
    case 'wasm':
      return progress.ratio * 0.7;
    case 'instantiate':
      return 0.85;
    case 'ready':
      return 1;
    default:
      return null;
  }
}
