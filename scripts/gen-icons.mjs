/**
 * Pure Node.js PNG icon generator (zero native deps) for iOS Apple Touch Icon & PWA Manifest.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function blendPixel(buf, idx, r, g, b, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  const inv = 1 - a;
  buf[idx] = Math.round(buf[idx] * inv + r * a);
  buf[idx + 1] = Math.round(buf[idx + 1] * inv + g * a);
  buf[idx + 2] = Math.round(buf[idx + 2] * inv + b * a);
  buf[idx + 3] = 255;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const maxR = size * 0.42;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const nx = x / size;
      const ny = y / size;

      // Deep cinema obsidian gradient background
      rgba[idx] = Math.round(9 + nx * 10 + ny * 8);
      rgba[idx + 1] = Math.round(14 + nx * 16 + ny * 12);
      rgba[idx + 2] = Math.round(28 + nx * 24 + ny * 18);
      rgba[idx + 3] = 255;

      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);

      // Subtle radial IMAX cyan glow
      if (dist < maxR * 1.15) {
        const glow = Math.pow(1 - dist / (maxR * 1.15), 2.2) * 0.22;
        blendPixel(rgba, idx, 14, 165, 233, glow);
      }

      // Radar rings
      for (const frac of [0.95, 0.68, 0.41]) {
        const ringR = maxR * frac;
        const delta = Math.abs(dist - ringR);
        const thickness = size * 0.015;
        if (delta < thickness) {
          const alpha = (1 - delta / thickness) * (frac === 0.95 ? 0.65 : 0.45);
          blendPixel(rgba, idx, 56, 189, 248, alpha);
        }
      }

      // Sweep wedge (upper-right quadrant)
      const angle = Math.atan2(dy, dx);
      if (dist < maxR * 0.95 && angle > -1.35 && angle < -0.25) {
        const sweepAlpha = ((angle + 1.35) / 1.1) * 0.28;
        blendPixel(rgba, idx, 56, 189, 248, sweepAlpha);
      }

      // Center golden star / ticket beacon
      const starR = maxR * 0.22;
      if (dist < starR) {
        const starAngle = Math.atan2(dy, dx) + Math.PI / 2;
        const k = Math.cos(5 * starAngle);
        const starBound = starR * (0.62 + 0.38 * Math.pow(Math.max(0, k), 0.75));
        if (dist <= starBound) {
          const edge = Math.min(1, (starBound - dist) / (size * 0.012 + 0.8));
          blendPixel(rgba, idx, 251, 191, 36, edge);
        }
      }
    }
  }

  return encodePng(size, size, rgba);
}

async function main() {
  const outDir = path.resolve('web/icons');
  await fs.mkdir(outDir, { recursive: true });
  const specs = [
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'icon-192.png', size: 192 },
    { name: 'icon-512.png', size: 512 }
  ];
  for (const s of specs) {
    const png = renderIcon(s.size);
    await fs.writeFile(path.join(outDir, s.name), png);
    console.log(`Generated ${s.name} (${png.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
