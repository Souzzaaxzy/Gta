import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Play! is a *threaded* WebAssembly build: it needs SharedArrayBuffer, which browsers
 * only expose in a cross-origin isolated document. These three headers create that
 * isolation. They MUST also be served by the host in production — see `public/_headers`
 * (Cloudflare Pages).
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default defineConfig({
  base: '/',
  publicDir: 'public',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    headers: crossOriginIsolation,
  },
  preview: {
    host: true,
    port: 4173,
    headers: crossOriginIsolation,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // Play.wasm is ~2.6 MB and is loaded at runtime from /emulator/, never inlined.
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 700,
  },
  esbuild: {
    legalComments: 'none',
  },
});
