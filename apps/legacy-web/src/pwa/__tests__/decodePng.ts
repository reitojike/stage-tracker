import { inflateSync } from 'node:zlib';

/**
 * Minimal PNG decoder for the icon tests (Issue #304).
 *
 * The icons are hand-supplied artwork, so the only way to assert anything
 * real about them is to look at their pixels. Comparing the container
 * bytes is not enough: exporting the same artwork twice produces
 * different files (different compression, different ancillary chunks),
 * so a byte comparison would call two identical images "different".
 *
 * Deliberately supports only what the committed icons actually use -
 * 8-bit, non-interlaced, truecolour with or without alpha. Anything else
 * throws rather than being silently mis-read, which is the safe direction
 * for a check whose whole purpose is to catch a bad export.
 */

const PNG_SIGNATURE = '89504e470d0a1a0a';

export interface DecodedPng {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  /** Row-major, `channels` bytes per pixel, no row padding. */
  readonly pixels: Buffer;
}

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function unfilter(raw: Buffer, width: number, height: number, bpp: number): Buffer {
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let read = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw.readUInt8(read);
    read += 1;
    const rowStart = y * stride;

    for (let i = 0; i < stride; i += 1) {
      const value = raw.readUInt8(read + i);
      const left = i >= bpp ? out.readUInt8(rowStart + i - bpp) : 0;
      const up = y > 0 ? out.readUInt8(rowStart - stride + i) : 0;
      const upLeft = y > 0 && i >= bpp ? out.readUInt8(rowStart - stride + i - bpp) : 0;

      let restored: number;
      if (filter === 0) restored = value;
      else if (filter === 1) restored = value + left;
      else if (filter === 2) restored = value + up;
      else if (filter === 3) restored = value + ((left + up) >> 1);
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const dLeft = Math.abs(estimate - left);
        const dUp = Math.abs(estimate - up);
        const dUpLeft = Math.abs(estimate - upLeft);
        const predictor = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
        restored = value + predictor;
      } else {
        throw new Error(`unsupported PNG row filter ${String(filter)}`);
      }

      out[rowStart + i] = restored & 0xff;
    }

    read += stride;
  }

  return out;
}

export function decodePng(file: Buffer): DecodedPng {
  if (file.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) {
    throw new Error('not a PNG file');
  }

  let offset = 8;
  let header: { width: number; height: number; channels: number } | null = null;
  const idat: Buffer[] = [];

  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.subarray(offset + 4, offset + 8).toString('latin1');
    const data = file.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      const depth = data.readUInt8(8);
      const colorType = data.readUInt8(9);
      const interlace = data.readUInt8(12);
      if (depth !== 8) throw new Error(`unsupported PNG bit depth ${String(depth)}`);
      if (interlace !== 0) throw new Error('interlaced PNG is not supported');
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(`unsupported PNG colour type ${String(colorType)}`);
      }
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        channels: colorType === 6 ? 4 : 3,
      };
    } else if (type === 'tRNS') {
      // Colour-key transparency: for a truecolour image tRNS names one
      // colour that is fully transparent, without adding an alpha channel.
      // Ignoring it would make an image with transparent pixels decode as
      // `channels === 3` and report itself fully opaque, which is exactly
      // what the opacity check exists to catch. Rejecting rather than
      // honouring it keeps this decoder small and errs the safe way; the
      // committed icons are colour type 6, where tRNS is not permitted.
      throw new Error('PNG colour-key transparency (tRNS) is not supported');
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  if (header === null) throw new Error('PNG has no IHDR chunk');
  if (idat.length === 0) throw new Error('PNG has no IDAT chunk');

  const { width, height, channels } = header;
  const pixels = unfilter(inflateSync(Buffer.concat(idat)), width, height, channels);
  return { width, height, channels, pixels };
}

export function pixelAt(image: DecodedPng, x: number, y: number): Rgba {
  const offset = (y * image.width + x) * image.channels;
  return {
    r: image.pixels.readUInt8(offset),
    g: image.pixels.readUInt8(offset + 1),
    b: image.pixels.readUInt8(offset + 2),
    a: image.channels === 4 ? image.pixels.readUInt8(offset + 3) : 255,
  };
}

/**
 * The image as 4 bytes per pixel, always.
 *
 * Comparing two decoded images by their raw buffers would call the same
 * artwork "different" when one was exported as RGB (colour type 2) and the
 * other as fully opaque RGBA (colour type 6): 3 versus 4 bytes per pixel.
 * Both are formats this decoder accepts, so any comparison between images
 * has to normalise first.
 */
export function toRgbaBytes(image: DecodedPng): Buffer {
  if (image.channels === 4) return image.pixels;

  const rgba = Buffer.alloc(image.width * image.height * 4);
  for (let source = 0, target = 0; source < image.pixels.length; source += 3, target += 4) {
    rgba[target] = image.pixels.readUInt8(source);
    rgba[target + 1] = image.pixels.readUInt8(source + 1);
    rgba[target + 2] = image.pixels.readUInt8(source + 2);
    rgba[target + 3] = 255;
  }
  return rgba;
}

/** The lowest alpha anywhere in the image; 255 means fully opaque. */
export function minimumAlpha(image: DecodedPng): number {
  if (image.channels !== 4) return 255;
  let lowest = 255;
  for (let offset = 3; offset < image.pixels.length; offset += 4) {
    const alpha = image.pixels.readUInt8(offset);
    if (alpha < lowest) lowest = alpha;
  }
  return lowest;
}

/**
 * How far the artwork reaches from the centre, as a fraction of the icon's
 * width - i.e. the diameter the mark occupies.
 *
 * "Artwork" is every pixel that differs from the corner colour by more
 * than `tolerance` per channel summed, which keeps edge antialiasing
 * against the background from counting as reach. This is what a maskable
 * icon's safe zone is expressed in: content must stay inside the centred
 * circle whose diameter is 80% of the icon.
 */
export function markDiameterFraction(image: DecodedPng, tolerance = 24): number {
  const background = pixelAt(image, 0, 0);
  const centerX = (image.width - 1) / 2;
  const centerY = (image.height - 1) / 2;
  let furthest = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = pixelAt(image, x, y);
      const distanceFromBackground =
        Math.abs(pixel.r - background.r) +
        Math.abs(pixel.g - background.g) +
        Math.abs(pixel.b - background.b);
      if (distanceFromBackground < tolerance) continue;
      const reach = Math.hypot(x - centerX, y - centerY);
      if (reach > furthest) furthest = reach;
    }
  }

  return (furthest * 2) / image.width;
}
