// Generates the app icons as PNGs with zero dependencies: a dusk sky over
// lake water with a gold sun — drawn pixel by pixel, encoded by hand.
// Run: node scripts/make-icons.mjs   (writes assets/icons/*.png)
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, pixelFn) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x / width, y / height, x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

// The icon: dusk gradient sky, gold sun low left, dark water lower third
// with a lighter waterline — the app in one glance.
const SKY_TOP = [35, 43, 85], SKY_LOW = [201, 106, 74];
const WATER_HI = [84, 71, 106], WATER_LO = [24, 20, 44];
const SUN = [255, 201, 138];

function pixel(u, v) {
  const horizon = 0.64;
  if (v < horizon) {
    let c = mix(SKY_TOP, SKY_LOW, Math.pow(v / horizon, 1.4));
    const dx = u - 0.38, dy = (v - 0.52) * 1.1;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.10) c = SUN;
    else if (d < 0.30) c = mix(c, SUN, Math.pow(1 - (d - 0.10) / 0.20, 2) * 0.55);
    return c;
  }
  if (v < horizon + 0.012) return [236, 226, 214]; // waterline glint
  return mix(WATER_HI, WATER_LO, (v - horizon) / (1 - horizon));
}

mkdirSync(new URL('../assets/icons/', import.meta.url), { recursive: true });
for (const [name, size] of [
  ['icon-512.png', 512], ['icon-192.png', 192],
  ['apple-touch-icon.png', 180], ['favicon-32.png', 32],
]) {
  const out = new URL(`../assets/icons/${name}`, import.meta.url);
  writeFileSync(out, png(size, size, pixel));
  console.log('wrote', name);
}
