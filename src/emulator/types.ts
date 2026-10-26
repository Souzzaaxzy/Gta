import type { ResolutionFactor } from '@/settings/types';

/** Runtime statistics reported by the emulator core. */
export interface EmulatorStats {
  /** Frames rendered since the previous `resetStats()` call. */
  frames: number;
  fps: number;
  /** Emotion Engine (+VU) utilisation as a percentage. 100 means the CPU is the bottleneck. */
  eeUsage: number;
  /** I/O processor utilisation as a percentage. */
  iopUsage: number;
  /** Draw calls issued in the sampled window. */
  drawCalls: number;
}

export interface EmulatorLoadProgress {
  phase: 'wasm' | 'instantiate' | 'ready';
  /** 0..1 when the size is known, otherwise null (indeterminate). */
  ratio: number | null;
  message: string;
}

export type EmulatorLogLevel = 'info' | 'warn' | 'error';

export interface EmulatorDescriptor {
  id: string;
  name: string;
  version: string;
  license: string;
  /** True when the core supplies its own BIOS (HLE), so the user needs no BIOS file. */
  hleBios: boolean;
}

export interface EmulatorCallbacks {
  onLog?: (level: EmulatorLogLevel, message: string) => void;
  onProgress?: (progress: EmulatorLoadProgress) => void;
  /** Called when the emulator starts producing frames for the first time. */
  onFirstFrame?: () => void;
  /** Called when the WebGL context is lost or restored. */
  onContextChange?: (state: 'lost' | 'restored') => void;
}

export interface BootOptions {
  file: File;
  /** File name to hand to the core. Play! keys off the extension to pick a container. */
  name: string;
}

/**
 * Contract every emulator integration must satisfy. Keeping the interface narrow lets the
 * interface layer stay independent of which core is underneath.
 */
export interface EmulatorAdapter {
  readonly descriptor: EmulatorDescriptor;
  /** True once the WebAssembly module is instantiated and the VM is created. */
  readonly ready: boolean;
  /** True once a disc has been handed to the core. */
  readonly booted: boolean;

  load(callbacks?: EmulatorCallbacks): Promise<void>;
  /**
   * Create the VM and its WebGL2 context. Must run inside a user gesture: iOS Safari
   * refuses to create a usable WebGL context outside one.
   */
  initVm(): void;
  boot(options: BootOptions): Promise<void>;

  setResolutionFactor(factor: ResolutionFactor): void;
  setFrameLimiter(enabled: boolean): void;
  setFieldStabilization(enabled: boolean): void;

  stats(): EmulatorStats;
  resetStats(): void;

  /** Capture a save state. Returns the raw bytes, or null when the core refused. */
  saveState(): Promise<Uint8Array | null>;
  /** Restore a save state from raw bytes. */
  loadState(bytes: Uint8Array): Promise<boolean>;

  /** Release the core. After this the adapter must not be used again. */
  dispose(): void;
}
