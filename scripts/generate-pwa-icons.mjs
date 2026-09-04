import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { PWA_ICON_ASSETS } from '../src/pwa/appIdentity.ts';

// Draws the PWA application icons (Issue #304) into public/pwa/.
//
// Run with:  npm run pwa:icons
//
// The icons are committed rather than generated at build time - a manifest
// icon has to be a real file at a stable URL. This script exists so the
// committed binaries stay reviewable and reproducible: a reviewer can
// re-run it and diff, instead of having to take four opaque PNGs on trust.
// It deliberately uses no image dependency (only node:zlib), so
// regenerating needs nothing beyond the repo's existing toolchain.
//
// The geometry below is the only place the mark is defined; sizes and
// purposes come from PWA_ICON_ASSETS, so this script cannot drift from the
// manifest that lists the files it writes.

// --- Mark geometry -------------------------------------------------------
//
// A proscenium: an arch outline (the stage opening) above a separate bar
// (the stage floor). All coordinates are fractions of a unit square whose
// side is `markScale` of the icon and which is centred in the icon, so one
// definition renders at every size.
//
// The inner opening is inset by exactly ARCH_STROKE on the left, right and
// top, which is what keeps the outline an even weight: that inset makes the
// inner dome concentric with the outer one (outer radius 0.34 centred at
// y = 0.38, inner radius 0.205 centred at the same y), so the stroke is
// ARCH_STROKE at the crown as well as down the legs.

const ARCH_LEFT = 0.16;
const ARCH_RIGHT = 0.84;
const ARCH_TOP = 0.04;
const ARCH_BOTTOM = 0.7;
const ARCH_STROKE = 0.135;

const FLOOR_LEFT = 0.02;
const FLOOR_RIGHT = 0.98;
const FLOOR_TOP = 0.8;
const FLOOR_BOTTOM = 0.96;
const FLOOR_RADIUS = 0.05;

// --color-accent and --color-neutral-0 from src/ui/tokens.css. The icon is
// fully opaque: iOS composites a transparent Home Screen icon onto black,
// and an Android adaptive icon needs its background to reach the edge.
const BACKGROUND_RGB = [0x2f, 0x4a, 0x7a];
const INK_RGB = [0xff, 0xff, 0xff];

// 4x4 samples per pixel. The mark is only straight edges and circular arcs,
// so ordered supersampling anti-aliases it well enough; there is no thin
// detail that would need a higher rate.
const SUPERSAMPLE = 4;

/**
 * How much of the icon the mark occupies.
 *
 * A maskable icon must keep its content inside the 80%-diameter safe-zone
 * circle, because the launcher chooses the mask. A square of side s centred
 * in the icon has its corners at radius s * sqrt(2) / 2, so s must stay
 * below 0.8 / sqrt(2) = 0.5657 for those corners to survive a circular
 * mask; 0.56 sits just inside it. The `any` icons are never masked by the
 * launcher and use the larger mark, and iOS only rounds the corners of the
 * Apple icon, so that one sits between the two.
 */
function markScaleFor(asset) {
  if (asset.purpose === 'maskable') return 0.56;
  if (asset.role === 'apple-touch') return 0.68;
  return 0.72;
}

/**
 * An arch: a rectangle whose top is closed by a semicircle of the same
 * width. Used for both the outer silhouette and the inner opening.
 */
function insideArch(x, y, left, right, top, bottom) {
  if (x < left || x > right || y > bottom) return false;
  const radius = (right - left) / 2;
  const centerX = (left + right) / 2;
  const centerY = top + radius;
  if (y >= centerY) return true;
  const dx = x - centerX;
  const dy = y - centerY;
  return dx * dx + dy * dy <= radius * radius;
}

function insideRoundedRect(x, y, left, right, top, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const nearestX = Math.min(Math.max(x, left + radius), right - radius);
  const nearestY = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function isInk(x, y) {
  if (insideRoundedRect(x, y, FLOOR_LEFT, FLOOR_RIGHT, FLOOR_TOP, FLOOR_BOTTOM, FLOOR_RADIUS)) {
    return true;
  }
  if (!insideArch(x, y, ARCH_LEFT, ARCH_RIGHT, ARCH_TOP, ARCH_BOTTOM)) return false;
  // The opening runs past the arch's own bottom edge so the legs stay open
  // instead of being closed off by an inner floor.
  return !insideArch(
    x,
    y,
    ARCH_LEFT + ARCH_STROKE,
    ARCH_RIGHT - ARCH_STROKE,
    ARCH_TOP + ARCH_STROKE,
    1,
  );
}

/** Renders one icon as packed 8-bit RGB, row-major, no padding. */
function renderIcon(size, markScale) {
  const pixels = Buffer.alloc(size * size * 3);
  const markSize = size * markScale;
  const markOrigin = (size - markSize) / 2;
  const step = 1 / SUPERSAMPLE;
  const samplesPerPixel = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        const y = (py + (sy + 0.5) * step - markOrigin) / markSize;
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px + (sx + 0.5) * step - markOrigin) / markSize;
          if (isInk(x, y)) hits += 1;
        }
      }
      const coverage = hits / samplesPerPixel;
      const offset = (py * size + px) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const background = BACKGROUND_RGB[channel];
        pixels[offset + channel] = Math.round(
          background + (INK_RGB[channel] - background) * coverage,
        );
      }
    }
  }

  return pixels;
}

// --- Minimal PNG encoder -------------------------------------------------
//
// 8-bit truecolour, no interlacing, filter type 0 on every row. The art is
// large flat areas, so per-row filtering would buy little over what deflate
// already removes, and leaving it off keeps the encoder small enough to
// read in one sitting.

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0; // compression method: deflate
  header[11] = 0; // filter method: adaptive
  header[12] = 0; // interlace method: none

  const stride = size * 3;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type: None
    pixels.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Entry point ---------------------------------------------------------

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const asset of PWA_ICON_ASSETS) {
  const destination = path.join(repositoryRoot, 'public', ...asset.path.split('/').filter(Boolean));
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, encodePng(asset.size, renderIcon(asset.size, markScaleFor(asset))));
  console.log(`wrote ${asset.path} (${String(asset.size)}x${String(asset.size)})`);
}
