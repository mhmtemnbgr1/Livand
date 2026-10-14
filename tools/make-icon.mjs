// "VL" uygulama ikonunu üretir (bağımlılık yok): public/icon.svg, public/icon-256.png, electron/icon.ico
// Çalıştırma: node tools/make-icon.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- tasarım (100x100 birim) ----
const V = [[11, 26], [26, 26], [38, 61], [50, 26], [65, 26], [45.5, 79], [30.5, 79]];
const L = [[67, 26], [81, 26], [81, 65], [93, 65], [93, 79], [67, 79]];
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BG = [hex('#241c52'), hex('#6a3f8f'), hex('#e0735f')];
const VCOL = [hex('#ffe3b0'), hex('#ff9a58')], LCOL = [hex('#fff8e8'), hex('#ffd9a0')];

const inPoly = (x, y, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const inRR = (x, y, r = 22) => { if (x < 0 || x > 100 || y < 0 || y > 100) return false; const cx = x < r ? r : x > 100 - r ? 100 - r : x, cy = y < r ? r : y > 100 - r ? 100 - r : y; return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; };

function sample(x, y) {   // -> [r,g,b,a]
  if (!inRR(x, y)) return [0, 0, 0, 0];
  const t = (x + y) / 200;
  let c = t < 0.55 ? mix(BG[0], BG[1], t / 0.55) : mix(BG[1], BG[2], (t - 0.55) / 0.45);
  c = mix(c, [255, 255, 255], Math.max(0, 0.14 - Math.hypot(x - 22, y - 18) / 160));   // sol üstte hafif parlama
  if (inPoly(x - 2, y - 3, V) || inPoly(x - 2, y - 3, L)) c = mix(c, [10, 6, 30], 0.38);      // harf gölgesi
  if (inPoly(x, y, V)) c = mix(VCOL[0], VCOL[1], (y - 26) / 53);
  else if (inPoly(x, y, L)) c = mix(LCOL[0], LCOL[1], (y - 26) / 53);
  return [c[0], c[1], c[2], 255];
}

function raster(size) {
  const SS = 4, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const s = sample((px + (sx + 0.5) / SS) * 100 / size, (py + (sy + 0.5) / SS) * 100 / size);
      r += s[0] * s[3]; g += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
    }
    const o = (py * size + px) * 4, n = SS * SS;
    buf[o] = a ? r / a : 0; buf[o + 1] = a ? g / a : 0; buf[o + 2] = a ? b / a : 0; buf[o + 3] = Math.round(a / n);
  }
  return buf;
}

// ---- PNG / ICO kodlayıcı ----
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(size) {
  const px = raster(size), raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(size, 0); ih.writeUInt32BE(size, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(sizes) {
  const imgs = sizes.map(s => png(s)), head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let off = 6 + 16 * sizes.length; const dir = sizes.map((s, i) => { const e = Buffer.alloc(16); e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(off, 12); off += imgs[i].length; return e; });
  return Buffer.concat([head, ...dir, ...imgs]);
}

// ---- SVG ----
const pts = p => p.map(q => q.join(',')).join(' ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="256" height="256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#241c52"/><stop offset=".55" stop-color="#6a3f8f"/><stop offset="1" stop-color="#e0735f"/></linearGradient>
    <linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe3b0"/><stop offset="1" stop-color="#ff9a58"/></linearGradient>
    <linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8e8"/><stop offset="1" stop-color="#ffd9a0"/></linearGradient>
    <radialGradient id="hl" cx=".22" cy=".18" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="url(#bg)"/><rect width="100" height="100" rx="22" fill="url(#hl)"/>
  <g transform="translate(2 3)" fill="#0a061e" opacity=".38"><polygon points="${pts(V)}"/><polygon points="${pts(L)}"/></g>
  <polygon points="${pts(V)}" fill="url(#v)"/><polygon points="${pts(L)}" fill="url(#l)"/>
</svg>
`;

fs.writeFileSync(path.join(root, 'public', 'icon.svg'), svg);
fs.writeFileSync(path.join(root, 'public', 'icon-256.png'), png(256));
fs.mkdirSync(path.join(root, 'electron'), { recursive: true });
fs.writeFileSync(path.join(root, 'electron', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
console.log('ikonlar yazıldı: public/icon.svg, public/icon-256.png, electron/icon.ico');
