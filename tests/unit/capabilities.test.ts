import { describe, expect, it } from 'vitest';
import { evaluateCompatibility, type DeviceCapabilities } from '@/settings/capabilities';

function capabilities(overrides: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    crossOriginIsolated: true,
    sharedArrayBuffer: true,
    webAssembly: true,
    webAssemblySimd: true,
    webAssemblyThreads: true,
    webgl2: true,
    webgpu: false,
    deviceMemoryGb: 4,
    hardwareConcurrency: 8,
    storageQuotaBytes: 2 * 1024 * 1024 * 1024,
    touchPrimary: true,
    standalone: false,
    userAgent: 'test',
    ...overrides,
  };
}

describe('evaluateCompatibility', () => {
  it('accepts a capable device', () => {
    const verdict = evaluateCompatibility(capabilities());
    expect(verdict.ok).toBe(true);
    expect(verdict.blockers).toEqual([]);
  });

  it('blocks when WebAssembly is missing', () => {
    const verdict = evaluateCompatibility(capabilities({ webAssembly: false }));
    expect(verdict.ok).toBe(false);
    expect(verdict.blockers.join(' ')).toContain('WebAssembly');
  });

  it('blocks when WebGL2 is missing', () => {
    const verdict = evaluateCompatibility(capabilities({ webgl2: false }));
    expect(verdict.ok).toBe(false);
    expect(verdict.blockers.join(' ')).toContain('WebGL2');
  });

  it('blocks when SharedArrayBuffer is missing', () => {
    const verdict = evaluateCompatibility(capabilities({ sharedArrayBuffer: false }));
    expect(verdict.ok).toBe(false);
    expect(verdict.blockers.join(' ')).toContain('SharedArrayBuffer');
  });

  it('blocks when the document is not cross-origin isolated', () => {
    const verdict = evaluateCompatibility(capabilities({ crossOriginIsolated: false }));
    expect(verdict.ok).toBe(false);
    expect(verdict.blockers.join(' ')).toContain('COOP/COEP');
  });

  it('warns, but does not block, without SIMD', () => {
    const verdict = evaluateCompatibility(capabilities({ webAssemblySimd: false }));
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings.join(' ')).toContain('SIMD128');
  });

  it('warns when the reported memory is below the 2 GB target', () => {
    const verdict = evaluateCompatibility(capabilities({ deviceMemoryGb: 1 }));
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings.join(' ')).toContain('2 GB');
  });

  it('warns on very few cores', () => {
    const verdict = evaluateCompatibility(capabilities({ hardwareConcurrency: 2 }));
    expect(verdict.warnings.join(' ')).toContain('núcleos');
  });

  it('warns on a tiny storage quota', () => {
    const verdict = evaluateCompatibility(capabilities({ storageQuotaBytes: 8 * 1024 * 1024 }));
    expect(verdict.warnings.join(' ')).toContain('armazenamento');
  });

  it('suggests the eco profile for a weak device', () => {
    expect(evaluateCompatibility(capabilities({ deviceMemoryGb: 2, hardwareConcurrency: 4 })).suggestedProfile).toBe('eco');
  });

  it('suggests the quality profile for a strong device', () => {
    expect(evaluateCompatibility(capabilities({ deviceMemoryGb: 12, hardwareConcurrency: 12 })).suggestedProfile).toBe('quality');
  });

  it('suggests balanced in the middle', () => {
    expect(evaluateCompatibility(capabilities({ deviceMemoryGb: 6, hardwareConcurrency: 6 })).suggestedProfile).toBe('balanced');
  });

  it('does not treat unknown memory as a weak device on its own', () => {
    const verdict = evaluateCompatibility(capabilities({ deviceMemoryGb: null, hardwareConcurrency: 8 }));
    // With memory unknown we cannot claim the device is strong, so we stay neutral.
    expect(verdict.suggestedProfile).toBe('balanced');
  });
});
