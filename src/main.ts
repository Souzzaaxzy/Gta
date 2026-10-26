import './styles/tokens.css';
import './styles/base.css';
import './styles/touch-pad.css';
import './styles/components.css';

import { App } from './app/app';
import { Ui } from './ui/ui';

/**
 * Entry point.
 *
 * Boot order matters: the canvas must exist before the application is constructed, because
 * the emulator binds its WebGL context to that exact element.
 */
async function main(): Promise<void> {
  const canvas = document.getElementById('outputCanvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('A tela do jogo (#outputCanvas) não foi encontrada.');
  }

  const app = new App(canvas);
  const ui = new Ui(app);
  const unsubscribe = ui.start();

  // Expose the application for automated tests and manual diagnostics. Read-only use.
  (window as unknown as { __gta?: unknown }).__gta = {
    app,
    ui,
    snapshot: () => app.snapshot(),
  };

  window.addEventListener('pagehide', () => {
    unsubscribe();
    app.dispose();
  });

  await app.boot();

  // Register the service worker after the first paint so it never delays the interface.
  if ('serviceWorker' in navigator && !import.meta.env.DEV) {
    window.setTimeout(() => {
      void navigator.serviceWorker.ready.then(() => app.refreshOfflineReadiness());
    }, 2000);
  }
}

main().catch((error) => {
  console.error('[main] fatal', error);
  const detail = document.getElementById('statusDetail');
  const title = document.getElementById('statusTitle');
  if (title) title.textContent = 'Falha ao iniciar a interface';
  if (detail) detail.textContent = error instanceof Error ? error.message : String(error);
});
