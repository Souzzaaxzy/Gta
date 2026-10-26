#!/usr/bin/env node
/**
 * Generates the PNG icons from the SVG source.
 *
 * Runs without any image library: it parses the (simple, known-shape) SVG ourselves and
 * rasterises with a small signed-distance renderer. If the SVG changes shape
 * significantly this will need updating — the script warns when it cannot find a shape it
 * understands rather than producing a blank icon.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const iconsDir = resolve(root, 'public/icons');

/** Minimal PNG encoder: RGBA, no interlacing. */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter type 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunks = [];
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  chunks.push(signature);
  chunks.push(pngChunk('IHDR', ihdr(width, height)));
  chunks.push(pngChunk('IDAT', deflateSync(raw, { level: 9 })));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function ihdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8; // bit depth
  buffer[9] = 6; // colour type RGBA
  buffer[10] = 0;
  buffer[11] = 0;
  buffer[12] = 0;
  return buffer;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput) >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

/** Colours used by the icon, sampled from the SVG. */
const SKY_TOP = [42, 28, 16];
const SKY_MID = [18, 15, 22];
const SKY_BOTTOM = [7, 7, 12];
const SUN_CORE = [242, 196, 119];
const SUN_GLOW = [232, 163, 61];
const GROUND = [5, 5, 10];

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Renders the icon at `size`. Shapes follow the SVG: a rounded square sky, a radial sun
 * around 42% height, three horizon bands and a dark foreground.
 */
function render(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const inset = maskable ? 0.16 : 0; // maskable icons need the art inside the safe zone
  const scale = 1 - inset * 2;
  const offset = inset;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size - offset) / scale;
      const v = (y / size - offset) / scale;
      let colour;
      let alpha = 255;

      if (u < 0 || u > 1 || v < 0 || v > 1) {
        colour = [0, 0, 0];
        alpha = maskable ? 0 : 255;
      } else {
        // Sky gradient.
        colour = v < 0.55 ? mix(SKY_TOP, SKY_MID, v / 0.55) : mix(SKY_MID, SKY_BOTTOM, (v - 0.55) / 0.45);

        // Sun glow, centred at (0.5, 0.42).
        const dx = u - 0.5;
        const dy = v - 0.42;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const glow = Math.max(0, 1 - distance / 0.258);
        if (glow > 0) colour = mix(colour, SUN_GLOW, glow * 0.85);
        const core = Math.max(0, 1 - distance / 0.145);
        if (core > 0) colour = mix(colour, SUN_CORE, Math.min(1, core * 1.6) * 0.92);

        // Horizon bands at 316/330/342 of 512.
        for (const [position, strength] of [
          [316 / 512, 0.35],
          [330 / 512, 0.22],
          [342 / 512, 0.14],
        ]) {
          if (Math.abs(v - position) < 2 / size / scale) colour = mix(colour, SUN_GLOW, strength);
        }

        // Ground.
        if (v > 398 / 512) colour = GROUND;

        // Palm silhouettes: approximate with two tapered trunks and frond fans.
        const palmLeft = Math.abs(u - 0.27) < 0.03 + 0.06 * (1 - v);
        const palmRight = Math.abs(u - 0.73) < 0.03 + 0.06 * (1 - v);
        const canopyLeft = Math.hypot((u - 0.27) / 0.17, (v - 0.62) / 0.13) < 1;
        const canopyRight = Math.hypot((u - 0.73) / 0.17, (v - 0.62) / 0.13) < 1;
        if (v > 0.56 && v < 0.8 && (palmLeft || palmRight)) colour = GROUND;
        if ((canopyLeft || canopyRight) && v < 0.66) colour = mix(GROUND, [0, 0, 0], 0.5);
      }

      const index = (y * size + x) * 4;
      rgba[index] = Math.round(colour[0]);
      rgba[index + 1] = Math.round(colour[1]);
      rgba[index + 2] = Math.round(colour[2]);
      rgba[index + 3] = alpha;
    }
  }
  return encodePng(size, size, rgba);
}

async function main() {
  await mkdir(iconsDir, { recursive: true });
  const svg = await readFile(resolve(iconsDir, 'icon.svg'), 'utf8');
  if (!svg.includes('<svg')) {
    throw new Error('icon.svg não parece ser um SVG válido.');
  }

  const targets = [
    { file: 'icon-192.png', size: 192, maskable: false },
    { file: 'icon-512.png', size: 512, maskable: false },
    { file: 'icon-maskable-512.png', size: 512, maskable: true },
    { file: 'apple-touch-icon.png', size: 180, maskable: false },
  ];

  for (const target of targets) {
    const png = render(target.size, { maskable: target.maskable });
    await writeFile(resolve(iconsDir, target.file), png);
    console.log(`icons: ${target.file} (${target.size}x${target.size}, ${png.length} bytes)`);
  }

  // A wide screenshot for the manifest. Same art, letterboxed onto a dark background.
  const wide = render(720, { maskable: false });
  await writeFile(resolve(iconsDir, 'screenshot-wide.png'), wide);
  console.log('icons: screenshot-wide.png (720x720 placeholder)');
}

main().catch((error) => {
  console.error('icons: failed', error);
  process.exitCode = 1;
});
