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
  for (const x of usabilitySmells(dir, files)) add('kullanim', path.join(dir, x.file), x.msg);
  for (const x of designSmells(dir, files)) add('tasarim', path.join(dir, x.file), x.msg);
  const n = s => issues.filter(x => x.sev === s).length;
  return { ts: Date.now(), files: files.length, errors: n('hata'), warnings: n('uyari'), usability: n('kullanim'), design: n('tasarim'), issues };
}

// Kullanılabilirlik denetimi: tıklanınca hiçbir şey yapmayan ya da beklenen işi yapmayan öğeler (token harcamaz).
// Sözdizimi doğru ama ziyaretçinin "düğmeler çalışmıyor" diyeceği durumları yakalar; gözden geçirmede yapımcıya gider.
const textOf = h => h.replace(/<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1];
const MAPS = /(google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|maps\.apple\.com|yandex\.[a-z.]+\/maps|waze\.com|openstreetmap\.org|geo:)/i;
const SOCIAL = { instagram: /instagram\.com/i, facebook: /facebook\.com|fb\.com/i, tiktok: /tiktok\.com/i, linkedin: /linkedin\.com/i, youtube: /youtube\.com|youtu\.be/i };
export function usabilitySmells(dir, files = walk(dir)) {
  const pages = files.filter(f => /\.html?$/i.test(f)).filter(f => { try { return fs.statSync(f).size < 2e6; } catch { return false; } });
  const scripts = files.filter(f => /\.(m?js|cjs)$/i.test(f)).map(f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');
  const css = files.filter(f => /\.css$/i.test(f)).map(f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');
  const out = [];
  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8'), file = rel(dir, f), add = msg => out.push({ file, msg });
    const js = scripts + '\n' + [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
    const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({ tag: m[0].slice(0, m[0].indexOf('>') + 1), href: attr(m[0].slice(0, m[0].indexOf('>') + 1), 'href'), text: textOf(m[2]).trim(), at: m.index }));
    const navRanges = [...html.matchAll(/<nav\b[\s\S]*?<\/nav>/gi)].map(m => [m.index, m.index + m[0].length]);
    const inNav = a => navRanges.some(([s, e]) => a.at >= s && a.at < e);
    const handled = tag => { const id = attr(tag, 'id'), cls = (attr(tag, 'class') || '').split(/\s+/).filter(Boolean); return /\son[a-z]+\s*=/i.test(tag) || (id && js.includes(id)) || cls.some(c => c.length > 2 && js.includes(c)) || /\sdata-[\w-]+/.test(tag) && /dataset|data-/.test(js); };
    // 1) hiçbir yere gitmeyen bağlantılar (href="#", boş href, javascript:) — JS ile bağlanmamışsa
    const isLogo = a => /\b(logo|brand|marka)\b/i.test(attr(a.tag, 'class') || '') && a.href === '#';   // logo → sayfa başı: geçerli
    const dead = anchors.filter(a => (a.href === undefined || a.href === '' || a.href === '#' || /^javascript:/i.test(a.href)) && !isLogo(a) && !handled(a.tag));
    if (dead.length) add(`${dead.length} bağlantı tıklanınca hiçbir yere gitmiyor (href="#"/boş): ${dead.slice(0, 3).map(a => `"${a.text.slice(0, 30) || '(metinsiz)'}"`).join(', ')}. Gerçek hedef ver ya da düğmeye çevirip işlev bağla.`);
    // 2) işlevi olmayan düğmeler: form göndermeyen ve hiçbir betiğin bağlanmadığı <button>
    const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map(m => [m.index, m.index + m[0].length]);
    const deadBtn = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].filter(m => {
      const tag = m[0].slice(0, m[0].indexOf('>') + 1), type = (attr(tag, 'type') || '').toLowerCase();
      if (forms.some(([s, e]) => m.index >= s && m.index < e) && type !== 'button') return false;   // formu gönderir
      return !handled(tag);
    });
    if (deadBtn.length) add(`${deadBtn.length} düğmeye hiçbir işlev bağlanmamış (tıklanınca bir şey olmuyor): ${deadBtn.slice(0, 3).map(m => `"${textOf(m[1]).trim().slice(0, 30) || attr(m[0], 'aria-label') || '(metinsiz)'}"`).join(', ')}.`);
    // 3) yol tarifi / harita düğmesi haritayı açmıyor (menüdeki bölüm bağlantıları hariç)
    const dirCta = anchors.filter(a => !inNav(a) && /yol tarifi|haritada|haritay[ıi] a[çc]|directions|get directions|konuma git/i.test(a.text) && !MAPS.test(a.href || ''));
    if (dirCta.length) add(`"${dirCta[0].text.slice(0, 40)}" haritayı açmıyor (${dirCta[0].href || 'hedef yok'}). Yol tarifi düğmesi doğrudan harita bağlantısı olsun (google.com/maps/dir/?api=1&destination=<tam adres>).`);
    // 4) harita bağlantısı sayfadaki adresi içermiyor (yalnızca semt adı → yanlış yere götürür)
    const street = (html.match(/"streetAddress"\s*:\s*"([^"]+)"/) || [])[1] || textOf((html.match(/<address\b[^>]*>([\s\S]*?)<\/address>/i) || [])[1] || '');
    const key = (String(street).match(/([A-ZÇĞİÖŞÜ][\wçğıöşüÇĞİÖŞÜ]{3,})\s+(?:Sok|Cad|Cd|Sk|Bulvar|Bulv|Street|St|Ave|Road|Rd)/) || [])[1];   // sokak/cadde adı (mahalle adı yetmez)
    const maps = anchors.filter(a => MAPS.test(a.href || ''));
    if (key && maps.length) { const lo = s => s.toLocaleLowerCase('tr'); const bad = maps.filter(a => { let u = a.href; try { u = decodeURIComponent(u.replace(/\+/g, ' ')); } catch {} return !lo(u).includes(lo(key)); }); if (bad.length) add(`${bad.length} harita bağlantısı sayfadaki adresi ("${key}…") içermiyor; ziyaretçiyi yanlış yere götürür. Tam adresi bağlantıya yaz.`); }
    // 5) bağlantısız sosyal medya / telefon / e-posta
    const vis = textOf(html), links = anchors.map(a => a.href || '').join(' ');
    for (const [name, re] of Object.entries(SOCIAL)) if (new RegExp(`\\b${name}\\b`, 'i').test(vis) && !re.test(links)) add(`Metinde ${name[0].toUpperCase() + name.slice(1)} geçiyor ama profile bağlantı yok; tıklanabilir yap.`);
    if (/(?:\+90|\b0)\s?\(?[2-5]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/.test(vis) && !/href\s*=\s*["']tel:/i.test(html)) add('Telefon numarası yazılı ama tel: bağlantısı yok; mobilde dokununca arama başlamalı.');
    if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(vis) && !/href\s*=\s*["']mailto:/i.test(html)) add('E-posta adresi yazılı ama mailto: bağlantısı yok.');
    // sahte numaraya giden arama/WhatsApp düğmeleri (tel:+905XXXXXXXXX gibi)
    const fake = anchors.filter(a => /^(tel:|https?:\/\/(wa\.me|api\.whatsapp\.com))/i.test(a.href || '') && /x{3,}|0{6,}|1234567|5550{3}/i.test(a.href));
    if (fake.length) add(`${fake.length} arama/WhatsApp düğmesi sahte numaraya gidiyor (${fake[0].href.slice(0, 40)}). Gerçek numara yoksa düğmeyi kaldır ya da kullanıcıya sor.`);
    // 6) ziyaretçiye görünen yer tutucu notları
    const ph = vis.match(/(yer tutucu|placeholder|gerçek[^.]{0,25}(?:ile|la|le) (?:değiştir|güncellen)|buraya [^.]{0,20}(?:gelecek|yazın|eklenecek))[^.]{0,20}/i);
    if (ph) add(`Ziyaretçiye görünen yer tutucu notu: "${ph[0].trim().slice(0, 70)}". Gerçek içerik koy ya da notu HTML yorumuna taşı.`);
    // 7) uzun sayfada kaydırınca kaybolan menü
    const targets = new Set(anchors.filter(a => /^#[\w-]+$/.test(a.href || '') && inNav(a)).map(a => a.href));
    if (/<nav\b/i.test(html) && targets.size >= 3 && !/position\s*:\s*(sticky|fixed)/i.test(html + css) && !/\b(sticky|fixed)\b/.test(attr((html.match(/<header\b[^>]*>/i) || [''])[0], 'class') || '')) add('Menü sayfanın başında kalıyor; uzun tek sayfada kaydırınca kaybolur. Başlığı yapışkan yap (position:sticky; top:0) ve hedeflere scroll-margin-top ver.');
  }
  return out;
}

// "Yapay zekâ görünümü" denetimi (impeccable'ın kodla tespit fikri): sıradan/jenerik tasarımı ele veren kalıplar.
// Hata değildir; gözden geçirmede "tasarım" bulgusu olarak yapımcıya gider. Tüm HTML+CSS birlikte değerlendirilir.
const GENERIC_FONTS = new Set(['inter', 'roboto', 'arial', 'helvetica', 'helvetica neue', 'open sans', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'sans-serif', 'serif', 'monospace', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'apple color emoji', 'segoe ui emoji', 'noto color emoji', 'inherit', 'initial', 'cursive', 'emoji']);
const hueOf = hex => {   // doygun bir rengin tonu (0-360); gri/koyu renkler için null
  let h = hex.slice(1); if (h.length <= 4) h = [...h.slice(0, 3)].map(c => c + c).join(''); h = h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); if ([r, g, b].some(Number.isNaN)) return null;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d || mx < 0.15) return null;
  if (d / (1 - Math.abs(mx + mn - 1)) < 0.3) return null;
  const hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (hue * 60 + 360) % 360;
};
export function designSmells(dir, files = walk(dir)) {
  const web = files.filter(f => /\.(html?|css)$/i.test(f)).filter(f => { try { return fs.statSync(f).size < 2e6; } catch { return false; } });
  const pages = web.filter(f => /\.html?$/i.test(f)); if (!pages.length) return [];
  const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  const html = pages.map(read).join('\n'), all = html + '\n' + web.filter(f => /\.css$/i.test(f)).map(read).join('\n');
  const main = rel(dir, pages.find(f => /^index\.html?$/i.test(path.basename(f))) || pages[0]), out = [], add = msg => out.push({ file: main, msg });
  // 1) tipografi: yalnızca yaygın/varsayılan fontlar
  const fams = new Set();
  for (const m of all.matchAll(/(?:font-family|--[\w-]*font[\w-]*)\s*:\s*([^;}<>\n]+)/gi)) for (const x of m[1].split(',')) fams.add(x.trim().replace(/^['"]+|['"]+$/g, '').toLowerCase());
  for (const m of all.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi)) for (const x of m[1].matchAll(/family=([^:&]+)/g)) fams.add(decodeURIComponent(x[1]).replace(/\+/g, ' ').toLowerCase());
  const named = [...fams].filter(x => x && !GENERIC_FONTS.has(x) && !x.startsWith('var('));
  const seen = [...fams].filter(x => x && !x.startsWith('var('));
  if (!named.length) add(`Tipografi jenerik: ${seen.length ? 'yalnızca ' + seen.slice(0, 3).join(', ') : 'hiç font seçilmemiş (tarayıcı varsayılanı)'}. İşe özel bir başlık + gövde font çifti seç.`);
  // 2) mor/indigo gradyan ve gradyanlı metin
  const grads = [...all.matchAll(/(?:linear|radial|conic)-gradient\(([^;{}]+)\)/gi)].map(m => m[1]);
  const purple = grads.some(g => /\b(purple|indigo|violet|blueviolet|mediumpurple|rebeccapurple)\b/i.test(g) || [...g.matchAll(/#[0-9a-f]{3,8}\b/gi)].some(m => { const h = hueOf(m[0]); return h != null && h >= 245 && h <= 295; }))
    || /\b(?:from|via|to)-(?:purple|indigo|violet|fuchsia)-\d{2,3}\b/.test(html);
  if (purple) add('Mor/indigo gradyan kullanılmış: yapay zekâ sitelerinin en tanıdık kalıbı. Paleti konunun dünyasından seç.');
  if (/background-clip\s*:\s*text|\bbg-clip-text\b/i.test(all)) add('Gradyanlı metin (background-clip:text): jenerik bir süs; başlığı tipografiyle öne çıkar.');
  // 3) birbirinin aynısı kart ızgarası
  const cards = [...html.matchAll(/class\s*=\s*["'][^"']*\bcard\b[^"']*["']/gi)].length;
  if (cards >= 6) add(`${cards} adet "card" öğesi: birbirinin aynısı kart ızgarası jenerik görünür. Bölümleri farklı yerleşimlerle (liste, dönüşümlü görsel+metin, tablo, zaman çizelgesi) anlat.`);
  // 4) her yere giriş animasyonu
  const reveals = [...html.matchAll(/\b(?:fade-?in(?:-?up)?|fadeInUp|slide-?up|data-aos|reveal|animate-on-scroll)\b/gi)].length;
  if (reveals >= 5) add(`${reveals} yerde kaydırınca beliren animasyon: her bölüme fade-in jenerik. Tek bir düzenlenmiş an bırak.`);
  // 5) emoji ikonlar
  const emo = (html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').match(/\p{Extended_Pictographic}/gu) || []).filter(e => !/[©®™]/.test(e)).length;
  if (emo >= 4) add(`${emo} emoji kullanılmış: emoji ikonlar ucuz görünür. Konuya özel SVG ikon/illüstrasyon çiz.`);
  // 6) başlıkta tek kelimeyi vurgulama
  if (/<h1\b[^>]*>(?:(?!<\/h1>)[\s\S])*<(?:(?:em|i|mark)\b|(?:span|strong)\b[^>]*class\s*=\s*["'][^"']*(?:gradient|highlight|accent|text-(?:primary|accent|brand)))/i.test(html)) add('Ana başlıkta tek kelime renk/italik/gradyanla vurgulanmış: yapay zekâ başlık kalıbı. Başlığı bütün olarak tasarla.');
  // 7) başlıkların üstünde küçük büyük harfli etiketler (eyebrow)
  const eyebrows = [...html.matchAll(/class\s*=\s*["'][^"']*\b(?:eyebrow|kicker|overline|section-label|pretitle|subtitle-label)\b/gi)].length;
  if (eyebrows >= 2) add(`${eyebrows} başlığın üstünde küçük etiket (eyebrow): yapay zekâ bölüm kalıbı. Başlıklar etiketsiz de anlaşılır olsun.`);
  return out;
}

export const checksText = c => !c || !c.issues.length ? '' : `\nOTOMATİK KONTROLLER (kodla yapıldı, kesin; ${c.errors} hata, ${c.warnings} uyarı${c.usability ? `, ${c.usability} kullanılabilirlik sorunu` : ''}${c.design ? `, ${c.design} jenerik tasarım kalıbı` : ''}):\n` + c.issues.slice(0, 20).map(x => `- [${x.sev}] ${x.file}: ${x.msg}`).join('\n');
