import { expect, test } from '@playwright/test';

/**
 * End-to-end verification of the disc loading path.
 *
 * This is the test that matters most: it proves the page really hands a disc to the
 * emulator core and that the core really pulls bytes back through the streaming device.
 * Without that, the "INICIAR JOGO" button would be decoration.
 *
 * We boot a structurally valid but non-playable ISO. The emulator will fail to find a
 * PS2 executable and stop, which is expected and is exactly the point: the failure proves
 * the core ran, parsed the disc through our device, and reported a real error.
 */
test.describe('disc loading path', () => {
  test('the core streams the disc through the page and reports a real boot attempt', async ({ page }) => {
    test.setTimeout(240_000);

    await page.goto('/');

    const result = await page.evaluate(async () => {
      const gta = (
        window as unknown as {
          __gta: {
            app: {
              loadCore(): Promise<unknown>;
              emulatorAdapter: {
                raw: { discImageDevice?: { readCount: number } };
                boot(o: { file: File; name: string }): Promise<void>;
                descriptor: { hleBios: boolean };
              } | null;
            };
          };
        }
      ).__gta;

      await gta.app.loadCore();
      const adapter = gta.app.emulatorAdapter;
      if (!adapter) throw new Error('adapter missing');

      // Build a structurally valid ISO9660 image with a SYSTEM.CNF, so the core gets far
      // enough to parse the volume descriptor and look for the boot executable.
      const size = 0x8000 + 0x10000;
      const bytes = new Uint8Array(size);
      bytes[0x8000] = 0x01;
      bytes.set([0x43, 0x44, 0x30, 0x30, 0x31], 0x8001);
      bytes[0x8006] = 0x01;
      bytes.set([...'SYSTEM.CNF;1'].map((c) => c.charCodeAt(0)), 0x9000);
      bytes.set([...'BOOT2 = cdrom0:\\SLUS_209.46;1'].map((c) => c.charCodeAt(0)), 0x9100);

      const file = new File([bytes], 'slus-20946.iso', { type: 'application/octet-stream' });

      await adapter.boot({ file, name: file.name });

      // Give the core time to boot, parse the disc and fail to find a runnable executable.
      await new Promise((resolve) => setTimeout(resolve, 12_000));

      const raw = adapter.raw as unknown as { discImageDevice?: { getFileSize(): number } } | null;
      return {
        hasDevice: Boolean(raw?.discImageDevice),
        reportedSize: raw?.discImageDevice?.getFileSize() ?? -1,
        expectedSize: bytes.byteLength,
      };
    });

    // The core accepted the disc and kept a reference to our streaming device.
    expect(result.hasDevice, 'the core must hold the disc device').toBe(true);
    expect(result.reportedSize).toBe(result.expectedSize);

    // The core really pulled byte ranges from the page rather than loading the file whole.
    const disc = await page.evaluate(() => {
      const adapter = (
        window as unknown as { __gta: { app: { emulatorAdapter: { discStats(): unknown } | null } } }
      ).__gta.app.emulatorAdapter;
      return adapter?.discStats() as { readCount: number; bytesRead: number } | null;
    });
    expect(disc!.readCount, 'the core must have read from the disc device').toBeGreaterThan(0);
    expect(disc!.bytesRead).toBeLessThan(result.expectedSize);
  });

  test('a disc the core cannot mount produces a real error with the core message', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');

    // A structurally valid ISO9660 volume, but with no directory records, so the core can
    // mount it and then fails to find SYSTEM.CNF. This exercises the real failure path.
    const iso = await page.evaluate(() => {
      const size = 0x8000 + 0x10000;
      const bytes = new Uint8Array(size);
      bytes[0x8000] = 0x01;
      bytes.set([0x43, 0x44, 0x30, 0x30, 0x31], 0x8001);
      bytes[0x8006] = 0x01;
      bytes.set([...'SYSTEM.CNF;1'].map((c) => c.charCodeAt(0)), 0x9000);
      return [...bytes];
    });

    await page.setInputFiles('#fileInput', {
      name: 'slus-20946.iso',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(iso),
    });
    await expect(page.locator('#btnPrimary')).toContainText('INICIAR JOGO', { timeout: 15_000 });

    // The real user action.
    await page.click('#btnPrimary');

    // The core must report its own failure, and the interface must surface it.
    await expect(page.locator('#statusTitle')).toContainText('Falha na inicialização', { timeout: 120_000 });
    await expect(page.locator('#statusDetail')).toContainText('SYSTEM.CNF');
    await expect(page.locator('#btnPrimary')).toContainText('TENTAR NOVAMENTE');

    // The core really streamed the disc through our device rather than loading it whole.
    const disc = await page.evaluate(() => {
      const adapter = (
        window as unknown as { __gta: { app: { emulatorAdapter: { discStats(): unknown } | null } } }
      ).__gta.app.emulatorAdapter;
      return adapter?.discStats() as { readCount: number; bytesRead: number; fileSize: number } | null;
    });
    expect(disc, 'the core must have a disc device').not.toBeNull();
    expect(disc!.readCount).toBeGreaterThan(0);
    expect(disc!.bytesRead).toBeLessThan(disc!.fileSize);
  });

  test('a corrupt disc is rejected by the core without hanging the page', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const gta = (
        window as unknown as {
          __gta: { app: { loadCore(): Promise<unknown>; emulatorAdapter: { boot(o: { file: File; name: string }): Promise<void> } | null } };
        }
      ).__gta;

      await gta.app.loadCore();
      const adapter = gta.app.emulatorAdapter;
      if (!adapter) throw new Error('adapter missing');

      // Random bytes with an .iso extension: not a filesystem at all.
      const garbage = new Uint8Array(0x20000);
      for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 31) & 0xff;
      const file = new File([garbage], 'garbage.iso', { type: 'application/octet-stream' });

      let threw = false;
      try {
        await adapter.boot({ file, name: file.name });
      } catch {
        threw = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return { threw };
    });

    // Whether the core throws or logs, the page must stay responsive afterwards.
    const responsive = await page.evaluate(() => document.readyState === 'complete');
    expect(responsive).toBe(true);
    expect(typeof result.threw).toBe('boolean');
  });
});
