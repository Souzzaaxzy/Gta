import { defineConfig } from 'vite';

/**
 * Second, tiny build that emits the service worker as a classic script at `dist/sw.js`.
 *
 * It runs after the main build (`emptyOutDir: false`) so the worker lands beside the app
 * without disturbing the hashed asset names the main build produced.
 *
 * The worker is emitted as IIFE rather than an ES module: module workers are not available
 * in every mobile browser we target, and a classic worker has no import graph to break.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    minify: 'esbuild',
    lib: {
      entry: 'src/pwa/sw.ts',
      formats: ['iife'],
      name: 'GtaServiceWorker',
      fileName: () => 'sw.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  esbuild: {
    legalComments: 'none',
  },
});
