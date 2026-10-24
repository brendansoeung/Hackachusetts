// Draws the MakeWeight app icons as PNG files (no image tools needed).
// Same design as icons/icon.svg: tan ring + bone-white down arrow on near-black.
// Run with: node scripts/make-icons.mjs

import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [15, 14, 12];
const RING = [193, 154, 107];
const ARROW = [236, 230, 220];

// CRC32 for PNG chunks.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed distance helpers, in 512-unit design space.
const segDist = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
};
const roundRectDist = (px, py, r) => {
  const qx = Math.abs(px - 256) - (256 - r), qy = Math.abs(py - 256) - (256 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

/** Renders the icon. rounded: transparent rounded corners; scale: shrink artwork (for maskable safe zone). */
function render(size, { rounded, scale = 1 }) {
  const out = Buffer.alloc(size * size * 4);
  const px = 512 / size; // design units per pixel
  const cover = (d, half) => Math.max(0, Math.min(1, 0.5 - (d - half) / px));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const X = (x + 0.5) * px, Y = (y + 0.5) * px;
      // Artwork coordinates (scaled around the center).
      const ax = 256 + (X - 256) / scale, ay = 256 + (Y - 256) / scale;
      const bgA = rounded ? Math.max(0, Math.min(1, 0.5 - roundRectDist(X, Y, 112) / px)) : 1;
      const ringA = cover(Math.abs(Math.hypot(ax - 256, ay - 256) - 168) * scale, 18 * scale);
      const arrowD = Math.min(
        segDist(ax, ay, 256, 150, 256, 338),
        segDist(ax, ay, 180, 268, 256, 344),
        segDist(ax, ay, 332, 268, 256, 344),
      );
      const arrowA = cover(arrowD * scale, 20 * scale);
      let c = BG;
      const mix = (from, to, a) => from.map((v, i) => v + (to[i] - v) * a);
      c = mix(c, RING, ringA);
      c = mix(c, ARROW, arrowA);
      const i = (y * size + x) * 4;
      out[i] = Math.round(c[0]);
      out[i + 1] = Math.round(c[1]);
      out[i + 2] = Math.round(c[2]);
      out[i + 3] = Math.round(bgA * 255);
    }
  }
  return encodePng(size, out);
}

const files = [
  ['icon-192.png', 192, { rounded: true }],
  ['icon-512.png', 512, { rounded: true }],
  ['icon-maskable-512.png', 512, { rounded: false, scale: 0.8 }],
  ['apple-touch-icon.png', 180, { rounded: false, scale: 0.9 }],
];
for (const [name, size, opts] of files) {
  writeFileSync(new URL(`../icons/${name}`, import.meta.url), render(size, opts));
  console.log(`icons/${name}`);
}
