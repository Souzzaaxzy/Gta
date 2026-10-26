#!/usr/bin/env node
/**
 * Verifies the vendored emulator core.
 *
 * The core is an Emscripten build, so its symbols are split:
 *   - `initVm` is a raw wasm export, reachable through `Module.ccall('initVm')`.
 *   - the rest are embind functions registered at runtime; their names live in the wasm
 *     binary's embind registry and they appear on `Module` once the runtime initialises.
 *   - the threading runtime (`em-pthread`, `SharedArrayBuffer`) lives in the JavaScript.
 *
 * This script checks all three, plus the recorded hashes. That is what makes it safe to
 * claim the emulator is really integrated rather than assumed to be.
 *
 * Run with `--update` to record the current hashes after an intentional upgrade.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const emulatorDir = resolve(root, 'public/emulator');
const provenancePath = resolve(emulatorDir, 'PROVENANCE.json');

const REQUIRED_FILES = ['Play.js', 'Play.wasm', 'LICENSE-PLAY.txt'];

/** Names that must exist in the wasm embind registry. */
const REQUIRED_WASM_SYMBOLS = ['bootDiscImage', 'bootElf', 'getFrames', 'clearStats'];

/** Names the frontend patch adds. Absent means a stock upstream build without our patch. */
const OPTIONAL_WASM_SYMBOLS = [
  'saveState',
  'loadState',
  'setResolutionFactor',
  'setFrameLimiter',
  'setDeinterlace',
  'getEeUsage',
  'getIopUsage',
  'getDrawCalls',
];

/** Markers proving the JavaScript side is a threaded Emscripten build. */
const REQUIRED_JS_MARKERS = ['initVm', 'ccall', 'export default'];
const THREAD_JS_MARKERS = ['em-pthread', 'SharedArrayBuffer', 'mainScriptUrlOrBlob'];

async function sha256(path) {
  const buffer = await readFile(path);
  return createHash('sha256').update(buffer).digest('hex');
}

/** Does `haystack` contain `needle` as raw bytes? Works on binary and text alike. */
function containsBytes(haystack, needle) {
  return haystack.indexOf(Buffer.from(needle, 'utf8')) !== -1;
}

async function main() {
  const update = process.argv.includes('--update');
  const problems = [];
  const warnings = [];

  const hashes = {};
  for (const file of REQUIRED_FILES) {
    const path = resolve(emulatorDir, file);
    try {
      const info = await stat(path);
      if (info.size === 0) {
        problems.push(`${file} está vazio.`);
        continue;
      }
      hashes[file] = { sha256: await sha256(path), size: info.size };
    } catch {
      problems.push(`${file} não foi encontrado em public/emulator/.`);
    }
  }

  // WebAssembly container validity and symbol presence.
  try {
    const wasm = await readFile(resolve(emulatorDir, 'Play.wasm'));
    if (wasm[0] !== 0x00 || wasm[1] !== 0x61 || wasm[2] !== 0x73 || wasm[3] !== 0x6d) {
      problems.push('Play.wasm não começa com a assinatura WebAssembly (\\0asm).');
    }
    if (wasm.byteLength < 500_000) {
      problems.push(`Play.wasm tem apenas ${wasm.byteLength} bytes; parece truncado.`);
    }
    for (const symbol of REQUIRED_WASM_SYMBOLS) {
      if (!containsBytes(wasm, symbol)) problems.push(`Play.wasm não contém o símbolo "${symbol}".`);
    }
    for (const symbol of OPTIONAL_WASM_SYMBOLS) {
      if (!containsBytes(wasm, symbol)) {
        warnings.push(`Play.wasm não contém "${symbol}" (recurso opcional indisponível).`);
      }
    }
  } catch {
    /* already reported */
  }

  // JavaScript runtime.
  try {
    const js = await readFile(resolve(emulatorDir, 'Play.js'), 'utf8');
    for (const marker of REQUIRED_JS_MARKERS) {
      if (!js.includes(marker)) problems.push(`Play.js não contém "${marker}".`);
    }
    for (const marker of THREAD_JS_MARKERS) {
      if (!js.includes(marker)) warnings.push(`Play.js não menciona "${marker}"; pode não ser um build com threads.`);
    }
  } catch {
    /* already reported */
  }

  // Provenance comparison.
  let provenance = null;
  try {
    provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  } catch {
    warnings.push('PROVENANCE.json não encontrado; não é possível comparar os hashes.');
  }

  if (provenance && !update) {
    for (const [file, expected] of Object.entries(provenance.hashes ?? {})) {
      const actual = hashes[file];
      if (!actual) continue;
      if (actual.sha256 !== expected) {
        problems.push(
          `${file} difere do hash registrado (esperado ${String(expected).slice(0, 16)}…, obtido ${actual.sha256.slice(0, 16)}…).`,
        );
      }
    }
  }

  if (update) {
    const record = provenance ?? { note: 'Proveniência dos binários do emulador.' };
    record.hashes = Object.fromEntries(Object.entries(hashes).map(([file, info]) => [file, info.sha256]));
    record.hashesUpdatedAt = new Date().toISOString();
    await writeFile(provenancePath, `${JSON.stringify(record, null, 2)}\n`);
    console.log('verify:emulator: hashes registrados em public/emulator/PROVENANCE.json');
    return;
  }

  console.log('verify:emulator: relatório');
  for (const [file, info] of Object.entries(hashes)) {
    console.log(`  ${file}: ${(info.size / 1048576).toFixed(2)} MB, sha256 ${info.sha256.slice(0, 16)}…`);
  }
  for (const warning of warnings) console.log(`  aviso: ${warning}`);
  for (const problem of problems) console.error(`  erro: ${problem}`);

  if (problems.length > 0) {
    console.error(`verify:emulator: ${problems.length} problema(s) encontrado(s).`);
    process.exitCode = 1;
    return;
  }
  console.log('verify:emulator: OK');
}

main().catch((error) => {
  console.error('verify:emulator: failed', error);
  process.exitCode = 1;
});
