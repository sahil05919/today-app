// Generates PNG icons (sage rounded square + white check) with no dependencies.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [0x5b, 0x8a, 0x72];
  const radius = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.8 : 1; // keep the glyph inside the maskable safe zone
  const segDist = (px_, py_, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px_ - ax) * dx + (py_ - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px_ - (ax + t * dx), py_ - (ay + t * dy));
  };
  const P = (x, y) => [size * (0.5 + (x - 0.5) * scale), size * (0.5 + (y - 0.5) * scale)];
  const [a1x, a1y] = P(0.29, 0.52), [a2x, a2y] = P(0.44, 0.67), [a3x, a3y] = P(0.72, 0.36);
  const stroke = size * 0.065 * scale;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    // rounded-rect alpha (anti-aliased)
    const cx = Math.min(x + 0.5, size - x - 0.5), cy = Math.min(y + 0.5, size - y - 0.5);
    let alpha = 1;
    if (radius > 0 && cx < radius && cy < radius) {
      const d = Math.hypot(radius - cx, radius - cy);
      alpha = Math.max(0, Math.min(1, radius - d + 0.5));
    }
    const d = Math.min(segDist(x + 0.5, y + 0.5, a1x, a1y, a2x, a2y), segDist(x + 0.5, y + 0.5, a2x, a2y, a3x, a3y));
    const ink = Math.max(0, Math.min(1, stroke - d + 0.5));
    px[i] = Math.round(bg[0] + (255 - bg[0]) * ink);
    px[i + 1] = Math.round(bg[1] + (255 - bg[1]) * ink);
    px[i + 2] = Math.round(bg[2] + (255 - bg[2]) * ink);
    px[i + 3] = Math.round(alpha * 255);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
writeFileSync("public/icon-192.png", png(192, {}));
writeFileSync("public/icon-512.png", png(512, {}));
writeFileSync("public/icon-maskable-512.png", png(512, { maskable: true }));
writeFileSync("public/apple-touch-icon.png", png(180, { maskable: true }));
console.log("icons written");
