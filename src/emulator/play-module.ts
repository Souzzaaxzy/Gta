/**
 * Shape of the Play! Emscripten module, limited to what we actually use.
 *
 * The core is built from Play! upstream (BSD-2-Clause) with a small frontend patch that
 * adds save states, the resolution/limiter/field-stabilization knobs and per-frame stats.
 * Only symbols present in the shipped `Play.js` are declared here; anything optional is
 * marked as such and guarded at the call site.
 */
export interface DiscImageDevice {
  /** Called from wasm to pull a byte range into HEAPU8 at `destination`. */
  read(destination: number, offset: number, length: number): void;
  /** Total disc size in bytes. */
  getFileSize(): number;
  /** True once the pending `read` has completed. */
  isDone(): boolean;
  /** The disc backing this device. */
  setFile(file: File): void;
}

export interface EmscriptenFileSystem {
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  mkdir(path: string): void;
}

export interface PlayModuleOptions {
  mainScriptUrlOrBlob?: string;
  locateFile?: (path: string, scriptDirectory: string) => string;
  print?: (message: string) => void;
  printErr?: (message: string) => void;
  canvas?: HTMLCanvasElement;
}

export interface PlayModule {
  /** Raw wasm heap. `read()` writes disc data directly into it. */
  HEAPU8: Uint8Array;

  /** Present only when built with `-sEXPORTED_RUNTIME_METHODS=ccall`. */
  ccall?: (name: string, returnType: string, argTypes: string[], args: unknown[]) => unknown;

  FS: EmscriptenFileSystem;

  /** Must be assigned before `initVm()`; the core reads it from the wasm side. */
  discImageDevice?: DiscImageDevice;

  /** Optional core entry points, guarded by the adapter. */
  bootDiscImage?: (path: string) => void;
  bootElf?: (path: string) => void;
  getFrames?: () => number;
  clearStats?: () => void;
  getEeUsage?: () => number;
  getIopUsage?: () => number;
  getDrawCalls?: () => number;
  saveState?: (path: string) => boolean;
  loadState?: (path: string) => boolean;
  setResolutionFactor?: (factor: number) => void;
  setFrameLimiter?: (enabled: boolean) => void;
  setDeinterlace?: (enabled: boolean) => void;
}

export type PlayFactory = (options: PlayModuleOptions) => Promise<PlayModule>;
