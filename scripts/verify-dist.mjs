#!/usr/bin/env node
/**
 * Verifies the production build in `dist/`.
 *
 * Confirms the build is complete and, critically, that the deployment will be able to
 * serve the cross-origin isolation headers the emulator needs. A build that is missing the
 * `_headers` file would deploy successfully and then fail at runtime with a confusing
 * error, which is exactly the kind of thing this check exists to catch.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');

const REQUIRED = [
  'index.html',
  'manifest.webmanifest',
  '_headers',
  'sw.js',
  'precache-manifest.json',
  'emulator/Play.js',
  'emulator/Play.wasm',
  'emulator/LICENSE-PLAY.txt',
];

/** Headers that must be present for the threaded core to run. */
const REQUIRED_HEADERS = [
  'Cross-Origin-Opener-Policy: same-origin',
  'Cross-Origin-Embedder-Policy: require-corp',
  'Cross-Origin-Resource-Policy: same-origin',
];

/** Files that must never be published: proprietary or user data. */
const FORBIDDEN_PATTERNS = [
  /\.iso$/i,
  /\.cso$/i,
  /\.isz$/i,
  /\.chd$/i,
  /\.bin$/i,
  /\.ps2$/i,
  /\.state$/i,
  /bios/i,
  /\.env$/i,
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else files.push(full.slice(base.length + 1));
  }
  return files;
}

async function main() {
  const problems = [];
  const warnings = [];

  if (!(await exists(dist))) {
    console.error('verify:dist: dist/ não existe. Rode "npm run build".');
    process.exitCode = 1;
    return;
  }

  for (const file of REQUIRED) {
    if (!(await exists(resolve(dist, file)))) problems.push(`arquivo obrigatório ausente: ${file}`);
  }

  // Headers file must contain the isolation headers.
  if (await exists(resolve(dist, '_headers'))) {
    const headers = await readFile(resolve(dist, '_headers'), 'utf8');
    for (const header of REQUIRED_HEADERS) {
      if (!headers.includes(header)) problems.push(`_headers não contém "${header}".`);
    }
    if (!/wasm[\s\S]*?application\/wasm/.test(headers)) {
      warnings.push('_headers pode não declarar application/wasm para o WebAssembly.');
    }
  }

  // No proprietary or user data may be in the build.
  const files = await walk(dist);
  for (const file of files) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(file)) problems.push(`arquivo proibido no build: ${file}`);
    }
  }

  // The core must be present and plausibly sized.
  if (await exists(resolve(dist, 'emulator/Play.wasm'))) {
    const info = await stat(resolve(dist, 'emulator/Play.wasm'));
    if (info.size < 500_000) problems.push(`emulator/Play.wasm tem apenas ${info.size} bytes.`);
    else console.log(`verify:dist: núcleo Play.wasm = ${(info.size / 1048576).toFixed(2)} MB`);
  }

  // The manifest must list the core.
  if (await exists(resolve(dist, 'precache-manifest.json'))) {
    const manifest = JSON.parse(await readFile(resolve(dist, 'precache-manifest.json'), 'utf8'));
    const urls = new Set((manifest.entries ?? []).map((entry) => entry.url));
    for (const required of ['/emulator/Play.js', '/emulator/Play.wasm']) {
      if (!urls.has(required)) problems.push(`precache-manifest.json não lista ${required}.`);
    }
    console.log(`verify:dist: precache build ${manifest.buildId} com ${manifest.entries?.length ?? 0} arquivos`);
  }

  // Total size, for the deployment notes.
  let total = 0;
  let coreSize = 0;
  for (const file of files) {
    const info = await stat(join(dist, file));
    total += info.size;
    if (file.startsWith('emulator/')) coreSize += info.size;
  }
  console.log(`verify:dist: build total ${(total / 1048576).toFixed(2)} MB, núcleo ${(coreSize / 1048576).toFixed(2)} MB`);
  console.log(`verify:dist: ${files.length} arquivos`);

  for (const warning of warnings) console.log(`  aviso: ${warning}`);
  for (const problem of problems) console.error(`  erro: ${problem}`);

  if (problems.length > 0) {
    console.error(`verify:dist: ${problems.length} problema(s).`);
    process.exitCode = 1;
    return;
  }
  console.log('verify:dist: OK');
}

main().catch((error) => {
  console.error('verify:dist: failed', error);
  process.exitCode = 1;
});
