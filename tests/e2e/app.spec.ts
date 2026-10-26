import { expect, test } from '@playwright/test';

/**
 * These tests run against the production build served with the cross-origin isolation
 * headers, so they exercise the same code path Cloudflare Pages serves.
 *
 * They drive the application through `window.__gta`, the same hooks the interface uses.
 * Nothing here simulates a running game and then declares success: the core test either
 * really instantiates the WebAssembly module or it fails.
 */

/** Minimal structurally valid ISO9660 image, built in the browser. */
const BUILD_ISO = () => {
  const size = 0x8000 + 0x2000;
  const bytes = new Uint8Array(size);
  bytes[0x8000] = 0x01;
  bytes.set([0x43, 0x44, 0x30, 0x30, 0x31], 0x8001); // CD001
  bytes[0x8006] = 0x01;
  bytes.set([...'SYSTEM.CNF;1'].map((c) => c.charCodeAt(0)), 0x9000);
  return [...bytes];
};

test.describe('shell', () => {
  test('loads, becomes cross-origin isolated, and shows the home screen', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');

    // The emulator cannot start without SharedArrayBuffer, so isolation is a hard requirement.
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);

    await expect(page.locator('.title')).toContainText('San Andreas');
    await expect(page.locator('#btnPrimary')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('serves the emulator core with the right MIME type', async ({ request }) => {
    const wasm = await request.get('/emulator/Play.wasm');
    expect(wasm.ok()).toBe(true);
    expect(wasm.headers()['content-type']).toContain('application/wasm');

    const js = await request.get('/emulator/Play.js');
    expect(js.ok()).toBe(true);
    expect(js.headers()['content-type']).toMatch(/javascript/);
  });

  test('declares a web app manifest with the required fields', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe('fullscreen');
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  test('registers a service worker', async ({ page }) => {
    await page.goto('/');
    const registration = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return { scope: reg.scope, hasActive: Boolean(reg.active) };
    });
    expect(registration.hasActive).toBe(true);
  });

  test('precache manifest lists the emulator core', async ({ request }) => {
    const response = await request.get('/precache-manifest.json');
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    const urls = manifest.entries.map((entry: { url: string }) => entry.url);
    expect(urls).toContain('/emulator/Play.js');
    expect(urls).toContain('/emulator/Play.wasm');
  });
});

test.describe('file selection', () => {
  test('rejects an invalid disc file with a real explanation', async ({ page }) => {
    await page.goto('/');

    await page.setInputFiles('#fileInput', {
      name: 'fake.iso',
      mimeType: 'application/octet-stream',
      buffer: Buffer.alloc(1024, 0),
    });

    await expect(page.locator('#statusTitle')).toContainText('Prepare o jogo', { timeout: 15_000 });
    await expect(page.locator('#requirements')).toContainText('CD001');
    // The primary button must NOT claim a game can start.
    await expect(page.locator('#btnPrimary')).toContainText('ESCOLHER ARQUIVO DO JOGO');
  });

  test('accepts a structurally valid ISO and enables the start button', async ({ page }) => {
    await page.goto('/');
    const iso = await page.evaluate(BUILD_ISO);

    await page.setInputFiles('#fileInput', {
      name: 'san-andreas.iso',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(iso),
    });

    await expect(page.locator('#statusTitle')).toContainText('Prepare o jogo', { timeout: 15_000 });
    await expect(page.locator('#requirements')).toContainText('san-andreas.iso');

    // The validator must have recognised the disc. The interface deliberately hides
    // informational findings, so assert against the validation result itself.
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
    expect(validation.format).toBe('iso');
    expect(validation.volumeDescriptor).toBe('CD001');
    expect(validation.looksLikePs2Disc, 'SYSTEM.CNF marker should be detected').toBe(true);

    // BIOS must be reported as not required.
    await expect(page.locator('#requirements')).toContainText('não é necessária');
    await expect(page.locator('#btnPrimary')).toContainText('INICIAR JOGO');
    await expect(page.locator('#btnPrimary')).toBeEnabled();
  });
});

test.describe('panels', () => {
  test('opens the settings panel and applies a profile', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Configurações' }).click();
    await expect(page.locator('#panelTitle')).toHaveText('Configurações');
    await expect(page.locator('#panelBody')).toContainText('Perfil de desempenho');

    await page.getByRole('button', { name: 'Econômico' }).click();
    const stored = await page.evaluate(() => localStorage.getItem('gta.settings'));
    expect(stored).toContain('eco');
  });

  test('opens the saves panel and lists the three slots', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Salvamentos' }).click();
    await expect(page.locator('#panelBody')).toContainText('Slot 1');
    await expect(page.locator('#panelBody')).toContainText('Slot 2');
    await expect(page.locator('#panelBody')).toContainText('Slot 3');
  });

  test('shows the real GTA: San Andreas compatibility notes', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Compatibilidade' }).click();
    await expect(page.locator('#panelBody')).toContainText('InGame');
    await expect(page.locator('#panelBody')).toContainText('15 a 30 FPS');
    await expect(page.locator('#panelBody')).toContainText('2 GB');
  });

  test('opens the controls panel with the mapping table', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Controles' }).click();
    await expect(page.locator('#panelBody')).toContainText('Controle físico');
    await expect(page.locator('.mapping-row')).toHaveCount(16);
  });

  test('opens the log panel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Registro' }).click();
    await expect(page.locator('#panelBody')).toContainText('Estado atual');
  });
});

test.describe('persistence', () => {
  test('settings survive a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Configurações' }).click();
    await page.getByRole('button', { name: 'Qualidade' }).click();
    await page.reload();

    const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('gta.settings') ?? '{}'));
    expect(settings.settings.profile).toBe('quality');
    expect(settings.settings.resolutionFactor).toBe(2);
  });

  test('a selected disc is restored from IndexedDB after a reload', async ({ page }) => {
    await page.goto('/');
    const iso = await page.evaluate(BUILD_ISO);

    await page.setInputFiles('#fileInput', {
      name: 'persisted.iso',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(iso),
    });
    await expect(page.locator('#requirements')).toContainText('persisted.iso', { timeout: 15_000 });

    await page.reload();
    await expect(page.locator('#requirements')).toContainText('persisted.iso', { timeout: 15_000 });
    await expect(page.locator('#requirements')).toContainText('Disco guardado');
  });
});

test.describe('touch controls', () => {
  test('dispatches the exact key codes the core binds', async ({ page }) => {
    await page.goto('/');

    const events = await page.evaluate(() => {
      const canvas = document.getElementById('outputCanvas') as HTMLCanvasElement;
      const received: string[] = [];
      canvas.addEventListener('keydown', (event) => received.push(`down:${(event as KeyboardEvent).code}`));
      canvas.addEventListener('keyup', (event) => received.push(`up:${(event as KeyboardEvent).code}`));

      // Drive the real on-screen pad element, not a stub.
      const host = document.getElementById('touchPadHost') as HTMLElement;
      const cross = host.querySelector<HTMLElement>('[data-button="cross"]')!;
      cross.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      cross.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      return received;
    });

    expect(events).toEqual(['down:KeyZ', 'up:KeyZ']);
  });

  test('releases every held button when input is released', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const app = (window as unknown as { __gta: { app: { activeKeys(): string[]; releaseAllInputs(): void } } }).__gta.app;
      const host = document.getElementById('touchPadHost') as HTMLElement;
      const cross = host.querySelector<HTMLElement>('[data-button="cross"]')!;
      const up = host.querySelector<HTMLElement>('[data-button="dpadUp"]');
      cross.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      if (up) up.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2 }));
      const before = app.activeKeys().length;
      app.releaseAllInputs();
      return { before, after: app.activeKeys().length };
    });
    expect(result.before).toBeGreaterThan(0);
    expect(result.after).toBe(0);
  });

  test('the pad has all the PlayStation 2 buttons', async ({ page }) => {
    await page.goto('/');
    const buttons = await page.evaluate(() => {
      const host = document.getElementById('touchPadHost') as HTMLElement;
      return [...host.querySelectorAll('[data-button]')].map((element) => element.getAttribute('data-button'));
    });
    for (const expected of [
      'cross',
      'circle',
      'square',
      'triangle',
      'l1',
      'l2',
      'l3',
      'r1',
      'r2',
      'r3',
      'start',
      'select',
    ]) {
      expect(buttons, `missing button ${expected}`).toContain(expected);
    }
  });
});

test.describe('gamepad', () => {
  test('reports no controller but still explains how to connect one', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Controles' }).click();
    await expect(page.locator('#panelBody')).toContainText('Nenhum controle detectado');
    await expect(page.locator('#panelBody')).toContainText('Bluetooth');
  });

  test('lists a synthetic controller reported by the Gamepad API', async ({ page }) => {
    await page.addInitScript(() => {
      const pad = {
        id: 'Synthetic Pad (STANDARD GAMEPAD Vendor: 045e)',
        index: 0,
        connected: true,
        mapping: 'standard',
        timestamp: 0,
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
        axes: [0, 0, 0, 0],
        vibrationActuator: null,
      };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Controles' }).click();
    await expect(page.locator('#panelBody')).toContainText('Synthetic Pad');
    await expect(page.locator('#panelBody')).toContainText('1 controle(s) detectado(s)');
  });

  test('a synthetic button press reaches the canvas as the mapped key', async ({ page }) => {
    await page.addInitScript(() => {
      const pressed = new Set<number>();
      const pad = {
        id: 'Synthetic Pad (STANDARD GAMEPAD Vendor: 045e)',
        index: 0,
        connected: true,
        mapping: 'standard',
        timestamp: 0,
        buttons: Array.from({ length: 17 }, (_, index) => ({
          get pressed() {
            return pressed.has(index);
          },
          touched: false,
          value: 0,
        })),
        axes: [0, 0, 0, 0],
        vibrationActuator: null,
      };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true });
      (window as unknown as { __pressPadButton: (index: number) => void }).__pressPadButton = (index: number) => {
        pressed.add(index);
      };
    });

    await page.goto('/');

    const events = await page.evaluate(async () => {
      const canvas = document.getElementById('outputCanvas') as HTMLCanvasElement;
      const received: string[] = [];
      canvas.addEventListener('keydown', (event) => received.push((event as KeyboardEvent).code));
      (window as unknown as { __pressPadButton: (index: number) => void }).__pressPadButton(0);
      // The gamepad manager polls on rAF, so give it a few frames.
      await new Promise((resolve) => setTimeout(resolve, 300));
      return received;
    });

    // Button 0 is cross, which the core binds to KeyZ.
    expect(events).toContain('KeyZ');
  });
});

test.describe('emulator core', () => {
  test('instantiates the WebAssembly module and creates the VM', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');

    // Preload the core through the application, exactly as the start button would.
    const result = await page.evaluate(async () => {
      const gta = (window as unknown as { __gta: { app: { loadCore(): Promise<unknown>; emulatorAdapter: unknown } } }).__gta;
      await gta.app.loadCore();
      const adapter = gta.app.emulatorAdapter as {
        ready: boolean;
        descriptor: { name: string; hleBios: boolean };
        raw: { bootDiscImage?: unknown; saveState?: unknown; FS?: unknown } | null;
      };
      return {
        ready: adapter.ready,
        name: adapter.descriptor.name,
        hleBios: adapter.descriptor.hleBios,
        hasBootDisc: typeof adapter.raw?.bootDiscImage === 'function',
        hasSaveState: typeof adapter.raw?.saveState === 'function',
        hasFs: typeof adapter.raw?.FS === 'object',
      };
    });

    expect(result.ready, 'the core must instantiate').toBe(true);
    expect(result.name).toBe('Play!');
    expect(result.hleBios, 'Play! uses HLE BIOS, so no BIOS file is required').toBe(true);
    expect(result.hasBootDisc, 'bootDiscImage must be exposed by the core').toBe(true);
    expect(result.hasSaveState, 'saveState must be exposed by the patched core').toBe(true);
    expect(result.hasFs).toBe(true);
  });
});
