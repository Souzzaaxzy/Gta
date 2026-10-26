import { describe, expect, it } from 'vitest';
import { validateDiscFile } from '@/files/disc-formats';
import { formatFromExtension, describeFormat, ACCEPTED_EXTENSIONS } from '@/files/disc-formats';

/** Build a File whose bytes we control. */
function makeFile(name: string, bytes: Uint8Array, type = ''): File {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], name, { type });
}

/** A minimal but structurally valid ISO9660 image: PVD "CD001" at sector 16. */
function makeIsoBytes(extra: { systemCnf?: boolean } = {}): Uint8Array {
  const size = 0x8000 + 0x2000;
  const bytes = new Uint8Array(size);
  // Primary Volume Descriptor: type 1 at 0x8000, then "CD001" at offset +1.
  bytes[0x8000] = 0x01;
  bytes.set([0x43, 0x44, 0x30, 0x30, 0x31], 0x8001); // CD001
  bytes[0x8006] = 0x01; // version
  if (extra.systemCnf) {
    bytes.set([...'SYSTEM.CNF;1'].map((c) => c.charCodeAt(0)), 0x9000);
  }
  return bytes;
}

describe('disc format detection', () => {
  it('maps extensions to formats', () => {
    expect(formatFromExtension('game.iso')).toBe('iso');
    expect(formatFromExtension('game.CSO')).toBe('cso');
    expect(formatFromExtension('game.chd')).toBe('chd');
    expect(formatFromExtension('game.isz')).toBe('isz');
    expect(formatFromExtension('game.elf')).toBe('elf');
    expect(formatFromExtension('game.cue')).toBe('cue');
    expect(formatFromExtension('noextension')).toBe('unknown');
    expect(formatFromExtension('game.rar')).toBe('unknown');
  });

  it('accepts the documented extension list', () => {
    for (const extension of ACCEPTED_EXTENSIONS) {
      expect(describeFormat(formatFromExtension(`x${extension}`)).supported).toBe(true);
    }
  });
});

describe('validateDiscFile', () => {
  it('rejects an empty file', async () => {
    const result = await validateDiscFile(makeFile('game.iso', new Uint8Array(0)));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('vazio'))).toBe(true);
  });

  it('rejects an unsupported extension', async () => {
    const result = await validateDiscFile(makeFile('game.rar', new Uint8Array(1024)));
    expect(result.valid).toBe(false);
    expect(result.format).toBe('unknown');
  });

  it('accepts a well-formed ISO with the CD001 descriptor', async () => {
    const result = await validateDiscFile(makeFile('san-andreas.iso', makeIsoBytes()));
    expect(result.valid).toBe(true);
    expect(result.format).toBe('iso');
    expect(result.volumeDescriptor).toBe('CD001');
  });

  it('detects the SYSTEM.CNF marker of a PS2 disc', async () => {
    const result = await validateDiscFile(makeFile('san-andreas.iso', makeIsoBytes({ systemCnf: true })));
    expect(result.looksLikePs2Disc).toBe(true);
  });

  it('rejects an ISO without the CD001 descriptor', async () => {
    const bytes = new Uint8Array(0x8000 + 512);
    const result = await validateDiscFile(makeFile('notreally.iso', bytes));
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.message.includes('CD001'))).toBe(true);
  });

  it('accepts a CHD with the right magic', async () => {
    const bytes = new Uint8Array(4096);
    bytes.set([...'MComprHD'].map((c) => c.charCodeAt(0)), 0);
    const result = await validateDiscFile(makeFile('game.chd', bytes));
    expect(result.valid).toBe(true);
    expect(result.format).toBe('chd');
  });

  it('rejects a CHD without the magic', async () => {
    const result = await validateDiscFile(makeFile('game.chd', new Uint8Array(4096)));
    expect(result.valid).toBe(false);
  });

  it('accepts a CSO with the right magic and warns about decompression cost', async () => {
    const bytes = new Uint8Array(4096);
    bytes.set([...'CISO'].map((c) => c.charCodeAt(0)), 0);
    const result = await validateDiscFile(makeFile('game.cso', bytes));
    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('compactada'))).toBe(true);
  });

  it('accepts an ISZ with the right magic', async () => {
    const bytes = new Uint8Array(4096);
    bytes.set([...'IsZ!'].map((c) => c.charCodeAt(0)), 0);
    const result = await validateDiscFile(makeFile('game.isz', bytes));
    expect(result.valid).toBe(true);
  });

  it('accepts a MIPS ELF and rejects other architectures', async () => {
    const mips = new Uint8Array(2048);
    mips.set([0x7f, 0x45, 0x4c, 0x46], 0);
    mips[4] = 1; // 32-bit
    mips[5] = 1; // little endian
    mips[18] = 0x08; // MIPS
    const mipsResult = await validateDiscFile(makeFile('boot.elf', mips));
    expect(mipsResult.valid).toBe(true);

    const x86 = new Uint8Array(2048);
    x86.set([0x7f, 0x45, 0x4c, 0x46], 0);
    x86[4] = 2;
    x86[5] = 1;
    x86[18] = 0x3e; // x86-64
    const x86Result = await validateDiscFile(makeFile('boot.elf', x86));
    expect(x86Result.valid).toBe(false);
    expect(x86Result.issues.some((issue) => issue.message.includes('MIPS'))).toBe(true);
  });

  it('rejects an ELF without the signature', async () => {
    const result = await validateDiscFile(makeFile('boot.elf', new Uint8Array(2048)));
    expect(result.valid).toBe(false);
  });

  it('warns about a suspiciously small disc image', async () => {
    const result = await validateDiscFile(makeFile('small.iso', makeIsoBytes()));
    expect(result.issues.some((issue) => issue.severity === 'warning' && issue.message.includes('MB'))).toBe(true);
  });

  it('treats a .cue without a FILE directive as invalid', async () => {
    const text = new TextEncoder().encode('REM not a real cue\n');
    const result = await validateDiscFile(makeFile('game.cue', text));
    expect(result.valid).toBe(false);
  });

  it('accepts a .cue with a FILE directive and warns about the companion .bin', async () => {
    const text = new TextEncoder().encode('FILE "game.bin" BINARY\n  TRACK 01 MODE2/2352\n');
    const result = await validateDiscFile(makeFile('game.cue', text));
    expect(result.valid).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes('.bin'))).toBe(true);
  });
});
