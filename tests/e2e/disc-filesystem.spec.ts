import { expect, test } from '@playwright/test';

/**
 * Disc loading, end to end, with a real ISO9660 filesystem.
 *
 * The earlier tests used an image with a volume descriptor but no directory records, so the
 * core stopped at "No 'SYSTEM.CNF' file found". These tests go further: the image below is
 * built with `pycdlib`, so it has a real directory tree, a real `SYSTEM.CNF`, and a boot
 * executable named by `BOOT2`. That makes the core walk the whole chain:
 *
 *     ISO9660 filesystem → SYSTEM.CNF → BOOT2 target → load as ELF
 *
 * The core then fails on the last step, because the boot file is not a real MIPS ELF. That
 * failure is the point: it proves every earlier step succeeded. A synthetic file cannot be
 * a runnable PS2 game, and pretending otherwise would be dishonest.
 *
 * Fixture: `tests/fixtures/ps2-disc-test.iso`, built by `scripts/make-test-iso.py`.
 */

const DISC = 'tests/fixtures/ps2-disc-test.iso';

test.describe('disc loading with a real ISO9660 filesystem', () => {
  test('the core walks ISO9660 → SYSTEM.CNF → boot executable', async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto('/');

    await page.setInputFiles('#fileInput', DISC);
    await expect(page.locator('#btnPrimary')).toContainText('INICIAR JOGO', { timeout: 20_000 });

    // The validator must recognise a real ISO9660 disc.
    const validation = await page.evaluate(() => {
      const gta = (window as unknown as { __gta: { app: { gameFiles: { currentValidation: unknown } } } }).__gta;
      return gta.app.gameFiles.currentValidation as {
        valid: boolean;
        format: string;
        volumeDescriptor: string | null;
        looksLikePs2Disc: boolean;
      };
    });
    expect(validation.valid).toBe(true);
    expect(validation.volumeDescriptor).toBe('CD001');
    expect(validation.looksLikePs2Disc, 'SYSTEM.CNF must be found in the image').toBe(true);

    await page.click('#btnPrimary');

    // The core must get past SYSTEM.CNF and reach the boot executable. It then fails to
    // load it as an ELF, which is correct: the fixture is not a real game.
    await expect(page.locator('#statusTitle')).toContainText('Falha na inicialização', { timeout: 180_000 });

    const detail = await page.locator('#statusDetail').textContent();
    expect(detail, 'the core must have found and parsed SYSTEM.CNF').not.toContain('No \'SYSTEM.CNF\' file found');
    expect(
      detail,
      'the core must have reached the boot executable named by BOOT2',
    ).toMatch(/ELF|executable/i);

    // Streaming must still hold: the core read part of the disc, not all of it.
    const disc = await page.evaluate(() => {
      const adapter = (
        window as unknown as { __gta: { app: { emulatorAdapter: { discStats(): unknown } | null } } }
      ).__gta.app.emulatorAdapter;
      return adapter?.discStats() as { readCount: number; bytesRead: number; failedReads: number; fileSize: number };
    });
    expect(disc.readCount, 'the core must have read from the disc').toBeGreaterThan(2);
    expect(disc.failedReads, 'no read may fail').toBe(0);
    expect(disc.bytesRead, 'the disc must not be loaded whole').toBeLessThan(disc.fileSize);
  });

  test('the same disc is restored from IndexedDB and re-validates after a reload', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#fileInput', DISC);
    await expect(page.locator('#requirements')).toContainText('ps2-disc-test.iso', { timeout: 20_000 });

    await page.reload();

    await expect(page.locator('#requirements')).toContainText('Disco guardado', { timeout: 20_000 });
    const validation = await page.evaluate(() => {
      const gta = (window as unknown as { __gta: { app: { gameFiles: { currentValidation: unknown } } } }).__gta;
      return gta.app.gameFiles.currentValidation as { valid: boolean; looksLikePs2Disc: boolean };
    });
    expect(validation.valid).toBe(true);
    expect(validation.looksLikePs2Disc).toBe(true);
  });
});
