// LIVAND Ofis — çıktıların kesin kontrolleri (token harcamaz, model yorumuna bırakılmaz).
// Kırık sayfa içi bağlantı, bulunamayan dosya, JS/JSON sözdizimi, atlas tutarlılığı, unutulmuş yer tutucular, temel HTML eksikleri.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TEXT = /\.(html?|css|m?js|cjs|json|md|txt|svg)$/i;
const SKIP_DIR = n => n === 'node_modules' || n.startsWith('.');
export function walk(dir, max = 400) {
  const out = [];
  const rec = d => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { if (out.length >= max) return; const f = path.join(d, e.name); if (e.isDirectory()) { if (!SKIP_DIR(e.name)) rec(f); } else out.push(f); } };
  rec(dir); return out;
}
const rel = (dir, f) => path.relative(dir, f).replace(/\\/g, '/');
const isRemote = u => /^(https?:|\/\/|data:|mailto:|tel:|javascript:|blob:|#|about:)/i.test(u) || /^\{\{|\$\{/.test(u);
const clean = u => decodeURIComponent(u.split(/[?#]/)[0]);
const exists = (base, u) => { try { return fs.existsSync(path.resolve(base, clean(u).replace(/^\//, ''))); } catch { return true; } };

// JS sözdizimi: önce klasik betik, import/export varsa modül olarak denetle (kod ÇALIŞTIRILMAZ, yalnızca ayrıştırılır)
export function jsSyntax(file) {
  const run = f => spawnSync(process.execPath, ['--check', f], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  let r = run(file);
  if (r.status !== 0 && /Cannot use import statement|Unexpected token 'export'|import\.meta/.test(r.stderr) && !/\.mjs$/i.test(file)) {
    const tmp = path.join(os.tmpdir(), `livand-chk-${process.pid}-${Date.now()}.mjs`);
    try { fs.copyFileSync(file, tmp); r = run(tmp); } finally { fs.rmSync(tmp, { force: true }); }
  }
  if (r.status === 0) return null;
  const line = (r.stderr.match(/:(\d+)\r?\n/) || [])[1], msg = (r.stderr.match(/SyntaxError: [^\r\n]+/) || ['Sözdizimi hatası'])[0];
  return `${msg}${line ? ` (satır ${line})` : ''}`;
}

export function checkWorkspace(dir) {
  const files = walk(dir), issues = [];
  const add = (sev, f, msg) => { if (issues.length < 60) issues.push({ sev, file: rel(dir, f), msg }); };
  for (const f of files) {
    if (!TEXT.test(f)) continue;
    let st; try { st = fs.statSync(f); } catch { continue; } if (st.size > 2e6) continue;
    const txt = fs.readFileSync(f, 'utf8'), base = path.dirname(f), ext = path.extname(f).toLowerCase();
    if (st.size === 0) { add('hata', f, 'Dosya boş'); continue; }
    if (/^\.html?$/.test(ext)) {
      const ids = new Set([...txt.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]));
      for (const m of new Set([...txt.matchAll(/href\s*=\s*["']#([^"']+)["']/gi)].map(m => m[1]))) if (!ids.has(m)) add('hata', f, `Kırık sayfa içi bağlantı: #${m} (bu id sayfada yok)`);
      for (const m of new Set([...txt.matchAll(/\s(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]))) if (!isRemote(m) && !exists(base, m)) add('hata', f, `Bulunamayan dosya: ${m}`);
      if (!/<meta[^>]+name\s*=\s*["']viewport["']/i.test(txt)) add('uyari', f, 'Mobil görünüm için <meta name="viewport"> yok');
      if (!/<title>\s*[^<\s][^<]*<\/title>/i.test(txt)) add('uyari', f, 'Sayfa başlığı (<title>) yok ya da boş');
      const noAlt = [...txt.matchAll(/<img\b(?![^>]*\balt\s*=)[^>]*>/gi)].length; if (noAlt) add('uyari', f, `${noAlt} görselde alt metni yok`);
      for (const m of txt.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\bsrc\s*=/.test(m[1]) || /type\s*=\s*["'](?!text\/javascript|module)[^"']+["']/i.test(m[1]) || !m[2].trim()) continue;
        const tmp = path.join(os.tmpdir(), `livand-inl-${process.pid}-${Date.now()}${/module/.test(m[1]) ? '.mjs' : '.js'}`);
        try { fs.writeFileSync(tmp, m[2]); const e = jsSyntax(tmp); if (e) add('hata', f, `Sayfa içi betikte ${e}`); } finally { fs.rmSync(tmp, { force: true }); }
      }
    }
    if (ext === '.css') for (const m of new Set([...txt.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map(m => m[1]))) if (!isRemote(m) && !exists(base, m)) add('hata', f, `CSS'teki dosya bulunamadı: ${m}`);
    if (/^\.(m?js|cjs)$/.test(ext)) {
      const e = jsSyntax(f); if (e) add('hata', f, e);
      for (const m of new Set([...txt.matchAll(/["'`]((?:\.\/)?(?:assets|img|images|sprites|sounds?|audio|media)\/[^"'`\s$]+\.(?:png|jpe?g|gif|svg|webp|mp3|wav|ogg|json))["'`]/gi)].map(m => m[1])))
        if (!exists(base, m) && !exists(dir, m)) add('hata', f, `Kodun yüklediği dosya yok: ${m}`);
    }
    if (ext === '.json') {
      let j; try { j = JSON.parse(txt); } catch (e) { add('hata', f, 'Geçersiz JSON: ' + e.message.slice(0, 80)); continue; }
      if (j && typeof j === 'object' && j.frames && typeof j.frames === 'object' && typeof j.image === 'string' && !exists(base, j.image)) add('hata', f, `Atlasın görseli yok: ${j.image}`);
    }
    if (/^\.(html?|md|m?js|json|txt)$/.test(ext)) {
      if (/lorem ipsum/i.test(txt)) add('uyari', f, 'Yer tutucu metin kalmış (lorem ipsum)');
      if (/\b(TODO|FIXME)\b/.test(txt)) add('uyari', f, 'Bitmemiş iş işareti kalmış (TODO/FIXME)');
    }
  }
  const n = s => issues.filter(x => x.sev === s).length;
  return { ts: Date.now(), files: files.length, errors: n('hata'), warnings: n('uyari'), issues };
}

export const checksText = c => !c || !c.issues.length ? '' : `\nOTOMATİK KONTROLLER (kodla yapıldı, kesin; ${c.errors} hata, ${c.warnings} uyarı):\n` + c.issues.slice(0, 20).map(x => `- [${x.sev}] ${x.file}: ${x.msg}`).join('\n');
