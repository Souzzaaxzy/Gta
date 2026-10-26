import { describe, expect, it } from 'vitest';
import { assertSafePath } from '@/saves/memory-card';

/**
 * Path validation is the security boundary for imported memory cards and backups: the
 * paths come from a file the user picked, so they are untrusted input.
 */
describe('assertSafePath', () => {
  it('accepts ordinary relative paths', () => {
    expect(() => assertSafePath('BASLUS-20946GTA50000/icon.sys')).not.toThrow();
    expect(() => assertSafePath('folder/file.bin')).not.toThrow();
    expect(() => assertSafePath('a')).not.toThrow();
  });

  it('rejects an absolute path', () => {
    expect(() => assertSafePath('/etc/passwd')).toThrow(/absoluto/i);
  });

  it('rejects a Windows drive path', () => {
    expect(() => assertSafePath('C:/windows/system32')).toThrow(/absoluto/i);
  });

  it('rejects parent traversal', () => {
    expect(() => assertSafePath('../secret')).toThrow(/relativo/i);
    expect(() => assertSafePath('folder/../../etc/passwd')).toThrow(/relativo/i);
  });

  it('rejects a current-directory segment', () => {
    expect(() => assertSafePath('./file')).toThrow(/relativo/i);
  });

  it('rejects empty segments', () => {
    expect(() => assertSafePath('folder//file')).toThrow(/vazio/i);
  });

  it('rejects an empty path', () => {
    expect(() => assertSafePath('')).toThrow(/inválido/i);
  });

  it('rejects control characters', () => {
    expect(() => assertSafePath('folder/\u0000evil')).toThrow(/controle/i);
    expect(() => assertSafePath('folder/\u001b[31m')).toThrow(/controle/i);
  });

  it('rejects an over-long path', () => {
    expect(() => assertSafePath('a'.repeat(600))).toThrow(/inválido/i);
  });
});
