'use strict';

/**
 * Pure Node.js zero-dependency icon generator for TicketTab.
 * Produces:
 *   - build/icon.png   (512x512 RGBA PNG for macOS & Linux)
 *   - build/icon.ico   (Multi-size 256/64/48/32/16 PNG-in-ICO for Windows)
 *   - assets/tray-icon.png (64x64 crisp tray icon)
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter None
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function encodeICO(pngEntries) {
  const count = pngEntries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;

  for (const { size, data } of pngEntries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngEntries.map((e) => e.data)]);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function blendPixel(buf, idx, r, g, b, a) {
  if (a <= 0) return;
  const sa = clamp(a, 0, 1);
  const da = buf[idx + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) return;
  buf[idx] = Math.round((r * sa + buf[idx] * da * (1 - sa)) / outA);
  buf[idx + 1] = Math.round((g * sa + buf[idx + 1] * da * (1 - sa)) / outA);
  buf[idx + 2] = Math.round((b * sa + buf[idx + 2] * da * (1 - sa)) / outA);
  buf[idx + 3] = Math.round(outA * 255);
}

function roundedRectSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return out + inside - r;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.2 / size;

  for (let py = 0; py < size; py++) {
    const y = (py + 0.5) / size;
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size;
      const idx = (py * size + px) * 4;

      // 1. Editorial warm terracotta-seal rounded squircle background
      const bgDist = roundedRectSDF(x, y, 0.5, 0.5, 0.44, 0.44, 0.14);
      const bgAlpha = clamp(0.5 - bgDist / aa, 0, 1);
      if (bgAlpha > 0) {
        const t = clamp((y - 0.06) / 0.88, 0, 1);
        const r = Math.round(mix(214, 188, t));
        const g = Math.round(mix(98, 74, t));
        const b = Math.round(mix(78, 56, t));
        blendPixel(rgba, idx, r, g, b, bgAlpha);
      }

      // 2. Dark printer slot at top
      const slotDist = roundedRectSDF(x, y, 0.5, 0.20, 0.28, 0.032, 0.02);
      const slotAlpha = clamp(0.5 - slotDist / aa, 0, 1);
      if (slotAlpha > 0) {
        blendPixel(rgba, idx, 36, 18, 14, slotAlpha * 0.42);
      }

      // 3. Warm-ivory receipt sheet emerging from slot with serrated bottom teeth
      const teethWave = Math.abs(((x - 0.24) * 14) % 1 - 0.5) * 0.055;
      const bottomLimit = 0.82 - teethWave;
      const inPaperX = x >= 0.25 && x <= 0.75;
      const inPaperY = y >= 0.20 && y <= bottomLimit;
      if (inPaperX && inPaperY) {
        // Soft anti-aliased edge on sides and top/bottom
        const ex = Math.min(x - 0.25, 0.75 - x);
        const ey = Math.min(y - 0.20, bottomLimit - y);
        const edge = Math.min(ex, ey);
        const paperAlpha = clamp(edge / aa + 0.5, 0, 1);
        const shade = mix(252, 246, clamp((y - 0.2) / 0.62, 0, 1));
        blendPixel(rgba, idx, shade, shade - 4, shade - 12, paperAlpha);
      }

      // 4. Receipt ink bars & coral highlight strip
      const bar1 = roundedRectSDF(x, y, 0.49, 0.34, 0.17, 0.026, 0.015);
      const bar2 = roundedRectSDF(x, y, 0.45, 0.47, 0.13, 0.026, 0.015);
      const bar3 = roundedRectSDF(x, y, 0.50, 0.60, 0.16, 0.026, 0.015);
      const b1a = clamp(0.5 - bar1 / aa, 0, 1);
      const b2a = clamp(0.5 - bar2 / aa, 0, 1);
      const b3a = clamp(0.5 - bar3 / aa, 0, 1);

      if (b1a > 0) blendPixel(rgba, idx, 34, 31, 27, b1a * 0.88);
      if (b2a > 0) blendPixel(rgba, idx, 34, 31, 27, b2a * 0.48);
      if (b3a > 0) blendPixel(rgba, idx, 201, 86, 66, b3a * 0.96);
    }
  }

  return encodePNG(size, size, rgba);
}

function main() {
  const root = path.resolve(__dirname, '..');
  const buildDir = path.join(root, 'build');
  const assetsDir = path.join(root, 'assets');
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const png512 = renderIcon(512);
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);

  const tray64 = renderIcon(64);
  fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), tray64);

  const icoSizes = [256, 64, 48, 32, 16];
  const entries = icoSizes.map((size) => ({ size, data: renderIcon(size) }));
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), encodeICO(entries));

  console.log('Generated build/icon.png, build/icon.ico, assets/tray-icon.png');
}

main();
