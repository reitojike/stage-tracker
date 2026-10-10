import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Reuse Next.js's already locked sharp renderer; no new project dependency.
// NODE_PATH can select a provisioned sharp for an isolated asset-only checkout.
const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
  const nextRequire = createRequire(
    require.resolve('next/package.json', {
      paths: [fileURLToPath(new URL('../apps/web/', import.meta.url))],
    }),
  );
  sharp = nextRequire('sharp');
}

const root = fileURLToPath(new URL('../', import.meta.url));
const web = join(root, 'apps/web');
const lock = await readFile(join(root, 'pnpm-lock.yaml'), 'utf8');
const lockedSharp = /^  sharp@([^:]+):$/m.exec(lock)?.[1];
assert.equal(sharp.versions.sharp, lockedSharp, 'Use the sharp version in pnpm-lock.yaml');
const check = process.argv.slice(2);
assert(
  check.length === 0 || (check.length === 1 && check[0] === '--check'),
  'Usage: node scripts/generate-app-icons.mjs [--check]',
);
const source = await readFile(join(web, 'assets/app-icon.svg'), 'utf8');
const normal = source.replace(
  '<g id="stage-mark">',
  '<g id="stage-mark" transform="translate(-30.72 -30.72) scale(1.12)">',
);
assert.notEqual(normal, source, 'The editable SVG must contain stage-mark');

async function render(svg, size) {
  return sharp(Buffer.from(svg), { density: 288 })
    .resize(size, size, { kernel: 'lanczos3' })
    .toColourspace('srgb')
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

async function deliver(path, bytes) {
  if (check.length) {
    assert.deepEqual(await readFile(path), bytes, `${path}: generated asset drift`);
  } else {
    await writeFile(path, bytes);
  }
}

const assets = [
  ['icon-192.png', 192, normal],
  ['icon-512.png', 512, normal],
  ['maskable-icon-512.png', 512, source],
  ['apple-touch-icon.png', 180, normal],
];
const identity = await readFile(join(web, 'src/lib/pwa/app-identity.ts'), 'utf8');
const declared = [
  ...identity.matchAll(/path: "\/pwa\/([^"]+)", size: (\d+), purpose: ("[^"]+"|null)/g),
].map(([, name, size, purpose]) => [name, Number(size), purpose]);
assert.deepEqual(
  declared,
  assets.map(([name, size]) => [
    name,
    size,
    name.startsWith('maskable') ? '"maskable"' : name.startsWith('apple') ? 'null' : '"any"',
  ]),
  'Generation must match the existing manifest asset contract',
);

let safeRadius = 0;
const generated = [];
for (const [name, size, svg] of assets) {
  const bytes = await render(svg, size);
  const { data, info } = await sharp(bytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, size);
  assert.equal(info.height, size);
  for (let i = 0; i < data.length; i += 4) {
    assert.equal(data[i + 3], 255, `${name} must be fully opaque`);
    if (
      name.startsWith('maskable') &&
      (data[i] !== 47 || data[i + 1] !== 74 || data[i + 2] !== 122)
    ) {
      const pixel = i / 4;
      safeRadius = Math.max(
        safeRadius,
        Math.hypot((pixel % size) + 0.5 - size / 2, Math.floor(pixel / size) + 0.5 - size / 2),
      );
    }
  }
  generated.push([join(web, 'public/pwa', name), bytes]);
  console.log(`${name}: ${size} x ${size}, opaque`);
}
assert(safeRadius <= 512 * 0.4, 'All maskable foreground must fit the W3C 40% radius safe zone');
console.log(`Maskable foreground radius: ${safeRadius.toFixed(2)} / 204.80 px`);

// Classic BGRA DIB entries keep the favicon readable in legacy ICO consumers.
const sizes = [16, 32, 48];
const images = [];
for (const size of sizes) {
  const { data } = await sharp(await render(normal, size))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const dib = Buffer.alloc(40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(size, 4);
  dib.writeInt32LE(size * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  dib.writeUInt32LE(size * size * 4, 20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = 40 + ((size - 1 - y) * size + x) * 4;
      dib.set([data[from + 2], data[from + 1], data[from], data[from + 3]], to);
    }
  }
  images.push(dib);
}
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16;
  header[entry] = header[entry + 1] = sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
}
generated.push([join(web, 'src/app/favicon.ico'), Buffer.concat([header, ...images])]);
// Validate every output before writing any asset.
for (const [path, bytes] of generated) await deliver(path, bytes);
console.log(
  `favicon.ico: ${sizes.join(', ')} px; ${check.length ? 'all assets match' : 'assets generated'}`,
);
console.log(
  `Renderer: sharp ${sharp.versions.sharp}, librsvg ${sharp.versions.rsvg}, vips ${sharp.versions.vips}`,
);
