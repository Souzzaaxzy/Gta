/**
 * Device capability probing.
 *
 * We deliberately do NOT trust `navigator.deviceMemory` alone: it is coarse, absent on
 * many browsers, and reports a capped value. It is used only as one hint among several,
 * and the user can always override the suggested profile.
 */

export interface DeviceCapabilities {
  /** True when the document is cross-origin isolated (SharedArrayBuffer available). */
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  webAssembly: boolean;
  webAssemblySimd: boolean;
  webAssemblyThreads: boolean;
  webgl2: boolean;
  webgpu: boolean;
  /** `navigator.deviceMemory` in GB, when the browser exposes it. */
  deviceMemoryGb: number | null;
  /** `navigator.hardwareConcurrency` (logical cores), when exposed. */
  hardwareConcurrency: number | null;
  /** Best-effort storage quota in bytes, when the browser exposes it. */
  storageQuotaBytes: number | null;
  /** Coarse pointer / touch-only device. */
  touchPrimary: boolean;
  /** Running as an installed PWA (standalone display mode). */
  standalone: boolean;
  userAgent: string;
}

/** Result of evaluating whether this device can run the emulator at all. */
export interface CompatibilityVerdict {
  ok: boolean;
  /** Blocking problems: the emulator cannot start. */
  blockers: string[];
  /** Non-blocking warnings: it may run, but slowly or with limits. */
  warnings: string[];
  /** Suggested profile, derived from the detected hardware. */
  suggestedProfile: 'eco' | 'balanced' | 'quality';
}

/** WebAssembly feature probes. Compiled once; the module is cached by the engine. */
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // type: () -> v128
  0x03, 0x02, 0x01, 0x00, // function section
  0x0a, 0x0a, 0x01, 0x08, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x0b, // v128.const + end
]);

const THREADS_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type: () -> ()
  0x03, 0x02, 0x01, 0x00, // function section
  0x05, 0x03, 0x01, 0x00, 0x01, // memory section (shared, min 1)
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b, // code section (empty body)
]);

function probeWasm(bytes: Uint8Array): boolean {
  try {
    // Copy into a plain ArrayBuffer: WebAssembly.validate rejects SharedArrayBuffer views.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return WebAssembly.validate(copy.buffer);
  } catch {
    return false;
  }
}

function hasWebGl2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function hasWebGpu(): boolean {
  return typeof (navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined';
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const displayStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayStandalone || iosStandalone;
}

export async function detectCapabilities(): Promise<DeviceCapabilities> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  let storageQuotaBytes: number | null = null;
  try {
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      storageQuotaBytes = estimate.quota ?? null;
    }
  } catch {
    storageQuotaBytes = null;
  }

  const crossOriginIsolated =
    typeof window !== 'undefined' ? window.crossOriginIsolated === true : false;

  return {
    crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function',
    webAssembly: typeof WebAssembly === 'object',
    webAssemblySimd: probeWasm(SIMD_PROBE),
    webAssemblyThreads: probeWasm(THREADS_PROBE),
    webgl2: hasWebGl2(),
    webgpu: hasWebGpu(),
    deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    hardwareConcurrency: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    storageQuotaBytes,
    touchPrimary: typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
    standalone: isStandalone(),
    userAgent: navigator.userAgent,
  };
}

export function evaluateCompatibility(capabilities: DeviceCapabilities): CompatibilityVerdict {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!capabilities.webAssembly) blockers.push('WebAssembly não está disponível neste navegador.');
  if (!capabilities.webgl2) blockers.push('WebGL2 não está disponível neste navegador.');
  if (!capabilities.sharedArrayBuffer) {
    blockers.push(
      'SharedArrayBuffer indisponível. O núcleo do Play! usa threads e exige isolamento de origem cruzada (COOP/COEP).',
    );
  } else if (!capabilities.crossOriginIsolated) {
    blockers.push(
      'A página não está em contexto isolado (crossOriginIsolated = false). Os cabeçalhos COOP/COEP não chegaram ao navegador.',
    );
  }
  if (!capabilities.webAssemblyThreads) {
    warnings.push('Suporte a threads em WebAssembly não foi detectado; o núcleo pode não iniciar.');
  }
  if (!capabilities.webAssemblySimd) {
    warnings.push('SIMD128 não detectado: o núcleo roda, porém mais devagar.');
  }

  const memory = capabilities.deviceMemoryGb;
  const cores = capabilities.hardwareConcurrency;

  if (memory !== null && memory < 2) {
    warnings.push(
      `O navegador informa ~${memory} GB de RAM. A meta do projeto é 2 GB ou mais; abaixo disso o desempenho tende a ser ruim.`,
    );
  }
  if (cores !== null && cores <= 2) {
    warnings.push(`Apenas ${cores} núcleos lógicos detectados. O emulador usa múltiplas threads.`);
  }
  if (capabilities.storageQuotaBytes !== null && capabilities.storageQuotaBytes < 64 * 1024 * 1024) {
    warnings.push('Cota de armazenamento muito baixa: salvar o progresso pode falhar.');
  }

  let suggestedProfile: 'eco' | 'balanced' | 'quality' = 'balanced';
  const weak = (memory !== null && memory <= 3) || (cores !== null && cores <= 4);
  const strong = memory !== null && memory >= 8 && cores !== null && cores >= 8;
  if (weak) suggestedProfile = 'eco';
  else if (strong) suggestedProfile = 'quality';

  return { ok: blockers.length === 0, blockers, warnings, suggestedProfile };
}
