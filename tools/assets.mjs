#!/usr/bin/env node
// LIVAND Ofis — asset aracı (bağımlılıksız; yalnızca Node'un zlib'i). Ajanlar oyun/site görsellerini bununla üretir ve işler.
// Kullanım: node assets.mjs <komut> ...   (yollar çalışma klasörüne göre)
//   info   <in.png>                                  boyut, saydamlık, arka plan rengi tahmini
//   pixel  <sanat.json> <out.png> [--scale 4]          piksel sanatı → PNG ({"palette":{"k":"#000",".":"none"},"rows":[...]} ya da "frames":[[...],[...]] → yatay sprite şeridi)
//   nobg   <in.png> <out.png> [--tol 32] [--color #rrggbb] [--all]   arka planı saydam yapar (varsayılan: kenardan taşma dolgusu; --all: o renkteki tüm pikseller)
//   trim   <in.png> <out.png> [--pad 0]               saydam kenar boşluklarını kırpar
//   split  <in.png> <klasör> [--grid 32x32 | --auto] [--min 16] [--gap 2] [--name sprite]   sprite sheet'i assetlere böler + manifest.json
//   pack   <klasör> <atlas.png> [--pad 2]             klasördeki PNG'leri tek atlasa dizer + atlas.json
//   scale  <in.png> <out.png> --x 4                   en yakın komşu büyütme (piksel sanat bulanıklaşmaz)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// ---------- PNG okuma/yazma ----------
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('PNG değil (yalnızca PNG desteklenir; JPG/WebP önce PNG olarak kaydedilmeli)');
  let i = 8, w, h, depth, type, inter, plte = null, trns = null; const idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i), name = buf.toString('latin1', i + 4, i + 8), d = buf.subarray(i + 8, i + 8 + len); i += 12 + len;
    if (name === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; inter = d[12]; }
    else if (name === 'PLTE') plte = d; else if (name === 'tRNS') trns = d; else if (name === 'IDAT') idat.push(d); else if (name === 'IEND') break;
  }
  if (inter) throw new Error('Taramalı (interlaced) PNG desteklenmiyor; görseli taramasız kaydet');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]; if (!ch) throw new Error('Bilinmeyen PNG renk türü: ' + type);
  const bpp = Math.max(1, (ch * depth) >> 3), stride = Math.ceil((w * ch * depth) / 8), raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * h); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), out = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const pr = () => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
      out[x] = (line[x] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pr())) & 255;
    }
    prev = out;
  }
  const rgba = Buffer.alloc(w * h * 4), max = (1 << depth) - 1;
  const sample = (row, idx) => depth === 8 ? row[idx] : depth === 16 ? row[idx * 2] : (row[(idx * depth) >> 3] >> (8 - depth - ((idx * depth) & 7))) & max;
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4; let r, g, b, al = 255;
      if (type === 3) { const k = sample(row, x); r = plte[k * 3]; g = plte[k * 3 + 1]; b = plte[k * 3 + 2]; if (trns && k < trns.length) al = trns[k]; }
      else if (type === 0 || type === 4) { const v = sample(row, x * ch); r = g = b = depth < 8 ? Math.round(v * 255 / max) : v; if (type === 4) al = sample(row, x * ch + 1); else if (trns && trns.readUInt16BE(0) === v) al = 0; }
      else { r = sample(row, x * ch); g = sample(row, x * ch + 1); b = sample(row, x * ch + 2); if (type === 6) al = sample(row, x * ch + 3); else if (trns && trns.readUInt16BE(0) === r && trns.readUInt16BE(2) === g && trns.readUInt16BE(4) === b) al = 0; }
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = al;
    }
  }
  return { w, h, data: rgba };
}

export function encodePng({ w, h, data }) {
  const chunk = (name, d) => { const n = Buffer.from(name, 'latin1'), l = Buffer.alloc(4), c = Buffer.alloc(4); l.writeUInt32BE(d.length); c.writeUInt32BE(crc32(Buffer.concat([n, d]))); return Buffer.concat([l, n, d, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([SIG, chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- görsel işlemleri ----------
const img = (w, h) => ({ w, h, data: Buffer.alloc(w * h * 4) });
const hex = s => { const m = String(s).trim().replace('#', ''); const x = m.length === 3 ? m.split('').map(c => c + c).join('') : m; if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(x)) return null; return [0, 2, 4, 6].map(i => i < x.length ? parseInt(x.slice(i, i + 2), 16) : 255); };
const dist = (d, o, c) => Math.max(Math.abs(d[o] - c[0]), Math.abs(d[o + 1] - c[1]), Math.abs(d[o + 2] - c[2]));
export function crop(im, x, y, w, h) { const o = img(w, h); for (let r = 0; r < h; r++) im.data.copy(o.data, r * w * 4, ((y + r) * im.w + x) * 4, ((y + r) * im.w + x + w) * 4); return o; }

// kenarlardaki en yaygın renk = arka plan tahmini
export function bgColor(im) {
  const cnt = new Map(), add = (x, y) => { const o = (y * im.w + x) * 4; if (im.data[o + 3] < 8) return; const k = (im.data[o] >> 3) << 10 | (im.data[o + 1] >> 3) << 5 | (im.data[o + 2] >> 3); const e = cnt.get(k) || [0, o]; e[0]++; cnt.set(k, e); };
  for (let x = 0; x < im.w; x++) { add(x, 0); add(x, im.h - 1); } for (let y = 0; y < im.h; y++) { add(0, y); add(im.w - 1, y); }
  let best = null; for (const e of cnt.values()) if (!best || e[0] > best[0]) best = e;
  return best ? [im.data[best[1]], im.data[best[1] + 1], im.data[best[1] + 2]] : null;
}

export function removeBg(im, { tol = 32, color = null, all = false } = {}) {
  const c = color || bgColor(im); if (!c) return { im, removed: 0, color: null };
  const d = im.data, n = im.w * im.h; let removed = 0;
  if (all) { for (let p = 0; p < n; p++) if (d[p * 4 + 3] && dist(d, p * 4, c) <= tol) { d[p * 4 + 3] = 0; removed++; } }
  else {   // kenardan başlayan taşma dolgusu: karakterin içindeki aynı renk korunur
    const seen = new Uint8Array(n), st = [];
    const push = p => { if (!seen[p] && (d[p * 4 + 3] === 0 || dist(d, p * 4, c) <= tol)) { seen[p] = 1; st.push(p); } };
    for (let x = 0; x < im.w; x++) { push(x); push((im.h - 1) * im.w + x); } for (let y = 0; y < im.h; y++) { push(y * im.w); push(y * im.w + im.w - 1); }
    while (st.length) { const p = st.pop(), x = p % im.w; if (d[p * 4 + 3]) removed++; d[p * 4 + 3] = 0; if (x > 0) push(p - 1); if (x < im.w - 1) push(p + 1); if (p >= im.w) push(p - im.w); if (p < n - im.w) push(p + im.w); }
    // kenar yumuşatma: silinen bölgeye komşu, arka plana yakın piksellere yarı saydamlık
    for (let p = 0; p < n; p++) if (d[p * 4 + 3] && !seen[p]) { const x = p % im.w, nb = [x > 0 && p - 1, x < im.w - 1 && p + 1, p >= im.w && p - im.w, p < n - im.w && p + im.w].filter(q => q !== false && seen[q]); if (nb.length && dist(d, p * 4, c) <= tol * 2) d[p * 4 + 3] = Math.round(d[p * 4 + 3] * Math.min(1, dist(d, p * 4, c) / (tol * 2))); }
  }
  return { im, removed, color: c };
}

export function bounds(im, x0 = 0, y0 = 0, w = im.w, h = im.h) {
  let a = w, b = h, c = -1, e = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (im.data[((y0 + y) * im.w + x0 + x) * 4 + 3] > 0) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > e) e = y; }
  return c < 0 ? null : { x: x0 + a, y: y0 + b, w: c - a + 1, h: e - b + 1 };
}
export function trim(im, pad = 0) {
  const bb = bounds(im); if (!bb) return im;
  const o = img(bb.w + pad * 2, bb.h + pad * 2), c = crop(im, bb.x, bb.y, bb.w, bb.h);
  for (let r = 0; r < c.h; r++) c.data.copy(o.data, ((r + pad) * o.w + pad) * 4, r * c.w * 4, (r + 1) * c.w * 4);
  return o;
}

// saydam olmayan bağlı bölgeleri bulur; birbirine "gap" pikselden yakın kutular birleşir (göz, gölge gibi kopuk parçalar aynı assette kalır)
export function components(im, { min = 16, gap = 2 } = {}) {
  const { w, h, data } = im, lab = new Int32Array(w * h).fill(-1); let boxes = [];
  for (let s = 0; s < w * h; s++) {
    if (lab[s] >= 0 || data[s * 4 + 3] === 0) continue;
    const id = boxes.length, st = [s]; lab[s] = id; let bx = { x0: w, y0: h, x1: 0, y1: 0, n: 0 };
    while (st.length) {
      const p = st.pop(), x = p % w, y = (p / w) | 0; bx.n++; if (x < bx.x0) bx.x0 = x; if (x > bx.x1) bx.x1 = x; if (y < bx.y0) bx.y0 = y; if (y > bx.y1) bx.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const q = ny * w + nx; if (lab[q] < 0 && data[q * 4 + 3] > 0) { lab[q] = id; st.push(q); } }
    }
    boxes.push(bx);
  }
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j];
      if (A.x0 - gap <= B.x1 && B.x0 - gap <= A.x1 && A.y0 - gap <= B.y1 && B.y0 - gap <= A.y1) { boxes[i] = { x0: Math.min(A.x0, B.x0), y0: Math.min(A.y0, B.y0), x1: Math.max(A.x1, B.x1), y1: Math.max(A.y1, B.y1), n: A.n + B.n }; boxes.splice(j, 1); merged = true; break; }
    }
  }
  const rowH = Math.max(1, Math.min(...boxes.map(b => b.y1 - b.y0 + 1)) / 2);
  return boxes.filter(b => b.n >= min).sort((a, b) => Math.round(a.y0 / rowH) - Math.round(b.y0 / rowH) || a.x0 - b.x0).map(b => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 }));
}

export function pixelArt(spec, scale = 1) {
  const pal = {}; for (const [k, v] of Object.entries(spec.palette || {})) { if (k.length !== 1) throw new Error(`Palet anahtarı tek karakter olmalı: "${k}"`); pal[k] = /^(none|transparent|saydam)$/i.test(v) ? [0, 0, 0, 0] : hex(v); if (!pal[k]) throw new Error(`Geçersiz renk: ${k}=${v}`); }
  const frames = spec.frames || [spec.rows]; if (!Array.isArray(frames[0]) || !frames[0].length) throw new Error('"rows" ya da "frames" gerekli');
  const fh = frames[0].length, fw = Math.max(...frames.flat().map(r => [...r].length));
  const o = img(fw * frames.length * scale, fh * scale);
  frames.forEach((rows, f) => rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = pal[ch] ?? (ch === '.' || ch === ' ' ? [0, 0, 0, 0] : null); if (!c) throw new Error(`Palette olmayan karakter: "${ch}" (satır ${y + 1})`);
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) { const q = ((y * scale + sy) * o.w + (f * fw + x) * scale + sx) * 4; o.data[q] = c[0]; o.data[q + 1] = c[1]; o.data[q + 2] = c[2]; o.data[q + 3] = c[3]; }
  })));
  return { im: o, frames: frames.length, frameW: fw * scale, frameH: fh * scale };
}

export function scaleNN(im, k) { const o = img(im.w * k, im.h * k); for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) im.data.copy(o.data, (y * o.w + x) * 4, (((y / k) | 0) * im.w + ((x / k) | 0)) * 4, (((y / k) | 0) * im.w + ((x / k) | 0)) * 4 + 4); return o; }

export function pack(items, pad = 2) {   // raf yerleşimi: büyükten küçüğe, satır satır
  const list = [...items].sort((a, b) => b.im.h - a.im.h), width = Math.max(Math.max(...list.map(x => x.im.w)) + pad * 2, Math.ceil(Math.sqrt(list.reduce((s, x) => s + (x.im.w + pad) * (x.im.h + pad), 0)) * 1.2));
  let x = pad, y = pad, rowH = 0; const pos = [];
  for (const it of list) { if (x + it.im.w + pad > width) { x = pad; y += rowH + pad; rowH = 0; } pos.push({ it, x, y }); x += it.im.w + pad; rowH = Math.max(rowH, it.im.h); }
  const o = img(width, y + rowH + pad), frames = {};
  for (const { it, x, y } of pos) { for (let r = 0; r < it.im.h; r++) it.im.data.copy(o.data, ((y + r) * o.w + x) * 4, r * it.im.w * 4, (r + 1) * it.im.w * 4); frames[it.name] = { x, y, w: it.im.w, h: it.im.h }; }
  return { im: o, frames };
}

// ---------- komut satırı ----------
const read = f => decodePng(fs.readFileSync(f));
const write = (f, im) => { fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true }); fs.writeFileSync(f, encodePng(im)); };
function main(argv) {
  const [cmd, ...rest] = argv, pos = [], opt = {};
  for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith('--')) { const k = rest[i].slice(2); opt[k] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; } else pos.push(rest[i]); }
  const need = n => { if (pos.length < n) throw new Error('Eksik argüman. Yardım için: node assets.mjs'); };
  const num = (k, d) => opt[k] == null ? d : (Number.isFinite(+opt[k]) ? +opt[k] : (() => { throw new Error(`--${k} sayı olmalı`); })());
  switch (cmd) {
    case 'info': { need(1); const im = read(pos[0]); let tr = 0; for (let p = 3; p < im.data.length; p += 4) if (im.data[p] < 255) tr++; const c = bgColor(im), bb = bounds(im);
      return { boyut: `${im.w}x${im.h}`, saydam_piksel: tr, arka_plan_tahmini: c && '#' + c.map(v => v.toString(16).padStart(2, '0')).join(''), dolu_alan: bb }; }
    case 'pixel': { need(2); const r = pixelArt(JSON.parse(fs.readFileSync(pos[0], 'utf8')), num('scale', 1)); write(pos[1], r.im); return { yazildi: pos[1], boyut: `${r.im.w}x${r.im.h}`, kare: r.frames, kare_boyutu: `${r.frameW}x${r.frameH}` }; }
    case 'nobg': { need(2); const c = opt.color ? hex(opt.color) : null; if (opt.color && !c) throw new Error('--color #rrggbb olmalı'); const r = removeBg(read(pos[0]), { tol: num('tol', 32), color: c, all: !!opt.all }); write(pos[1], r.im);
      return { yazildi: pos[1], silinen_piksel: r.removed, arka_plan: r.color && '#' + r.color.map(v => v.toString(16).padStart(2, '0')).join('') }; }
    case 'trim': { need(2); const im = trim(read(pos[0]), num('pad', 0)); write(pos[1], im); return { yazildi: pos[1], boyut: `${im.w}x${im.h}` }; }
    case 'scale': { need(2); const k = num('x', 2); if (k < 1 || k > 16 || k % 1) throw new Error('--x 1-16 arası tam sayı'); const im = scaleNN(read(pos[0]), k); write(pos[1], im); return { yazildi: pos[1], boyut: `${im.w}x${im.h}` }; }
    case 'split': {
      need(2); const im = read(pos[0]), name = String(opt.name || 'sprite').replace(/[^\w-]/g, '_'); let boxes;
      if (opt.grid) { const m = String(opt.grid).match(/^(\d+)x(\d+)$/); if (!m) throw new Error('--grid GENxYÜK (örn. 32x32)'); const gw = +m[1], gh = +m[2]; boxes = [];
        for (let y = 0; y + gh <= im.h; y += gh) for (let x = 0; x + gw <= im.w; x += gw) if (bounds(im, x, y, gw, gh)) boxes.push({ x, y, w: gw, h: gh }); }
      else boxes = components(im, { min: num('min', 16), gap: num('gap', 2) });
      fs.mkdirSync(pos[1], { recursive: true });
      const out = boxes.map((b, i) => { const file = `${name}_${i + 1}.png`; write(path.join(pos[1], file), crop(im, b.x, b.y, b.w, b.h)); return { file, ...b }; });
      fs.writeFileSync(path.join(pos[1], 'manifest.json'), JSON.stringify({ source: path.basename(pos[0]), sprites: out }, null, 2));
      return { klasor: pos[1], asset_sayisi: out.length, manifest: path.join(pos[1], 'manifest.json') };
    }
    case 'pack': {
      need(2); const files = fs.readdirSync(pos[0]).filter(f => /\.png$/i.test(f) && path.resolve(pos[0], f) !== path.resolve(pos[1])).sort();
      if (!files.length) throw new Error('Klasörde PNG yok');
      const r = pack(files.map(f => ({ name: f.replace(/\.png$/i, ''), im: read(path.join(pos[0], f)) })), num('pad', 2)); write(pos[1], r.im);
      const js = pos[1].replace(/\.png$/i, '') + '.json'; fs.writeFileSync(js, JSON.stringify({ image: path.basename(pos[1]), size: { w: r.im.w, h: r.im.h }, frames: r.frames }, null, 2));
      return { yazildi: pos[1], atlas_json: js, boyut: `${r.im.w}x${r.im.h}`, kare: files.length };
    }
    default: return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  try { const r = main(process.argv.slice(2)); if (!r) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 10).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(1); } console.log(JSON.stringify(r)); }
  catch (e) { console.error('Hata: ' + e.message); process.exit(1); }
}
