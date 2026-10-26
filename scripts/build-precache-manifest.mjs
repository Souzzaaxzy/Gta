#!/usr/bin/env node
/**
 * Builds the service worker precache manifest from `dist/`.
 *
 * The manifest lists every file the app needs to open and run with no network: the shell,
 * its assets, and the emulator core. It is written after the main and worker builds, and
 * the service worker reads it at install time.
 *
 * Files are hashed into a build id so a new deploy produces a new cache and the old one is
 * cleaned up on activation.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');

/** Never precache these: they are fetched on demand or are the manifest itself. */
const EXCLUDE = new Set(['precache-manifest.json', 'sw.js', '_headers', '_routes.json', '.DS_Store']);

/** Precache these even though they are large: the core is required to start at all. */
const REQUIRED_PREFIXES = ['/emulator/'];

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full, base)));
    } else if (entry.isFile()) {
      files.push(relative(base, full).split(sep).join('/'));
    }
  }
  return files;
}

async function main() {
  let info;
  try {
    info = await stat(dist);
  } catch {
    console.error('precache: dist/ não existe. Rode "npm run build" primeiro.');
    process.exitCode = 1;
    return;
  }
  if (!info.isDirectory()) throw new Error('dist não é um diretório');

  const all = await walk(dist);
  const entries = [];
  let totalBytes = 0;

  for (const file of all) {
    if (EXCLUDE.has(file)) continue;
    if (file.startsWith('emulator/patches/')) continue; // build provenance, not runtime
    const full = join(dist, file);
    const fileStat = await stat(full);
    // Skip anything absurdly large that is not a required asset.
    const url = `/${file}`;
    const required = REQUIRED_PREFIXES.some((prefix) => url.startsWith(prefix));
    if (!required && fileStat.size > 8 * 1024 * 1024) continue;
    entries.push({ url, size: fileStat.size });
    totalBytes += fileStat.size;
  }

  // Guarantee the core is listed, and fail loudly if it is missing: without it the app
  // cannot start, so silently shipping a build without it would be a real bug.
  const required = ['/emulator/Play.js', '/emulator/Play.wasm'];
  for (const url of required) {
    if (!entries.some((entry) => entry.url === url)) {
      throw new Error(`precache: recurso obrigatório ausente em dist: ${url}`);
    }
  }

  const hash = createHash('sha256');
  for (const entry of entries.sort((a, b) => a.url.localeCompare(b.url))) {
    hash.update(entry.url);
    hash.update(String(entry.size));
  }
  const buildId = hash.digest('hex').slice(0, 12);

  const manifest = {
    buildId,
    generatedAt: new Date().toISOString(),
    entries: entries.sort((a, b) => a.url.localeCompare(b.url)),
  };

  await writeFile(join(dist, 'precache-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `precache: ${entries.length} arquivos, ${(totalBytes / 1048576).toFixed(2)} MB, build ${buildId}`,
  );
  const core = entries.find((entry) => entry.url === '/emulator/Play.wasm');
  if (core) console.log(`precache: núcleo Play.wasm = ${(core.size / 1048576).toFixed(2)} MB`);
}

main().catch((error) => {
  console.error('precache: failed', error);
  process.exitCode = 1;
});
