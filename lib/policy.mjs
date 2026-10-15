// LIVAND Ofis — saf (yan etkisiz) politika, güvenlik ve puanlama işlevleri. server.js bunları kullanır; test/ klasörü bunları sınar.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const cut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

function validateDir(d) {
  d = path.resolve(String(d || '').trim());
  let st; try { st = fs.statSync(d); } catch { throw new Error('Klasör bulunamadı'); }
  if (!st.isDirectory()) throw new Error('Bu bir klasör değil');
  const n = d.toLowerCase().replace(/[\\/]+$/, ''), home = os.homedir().toLowerCase();
  if (/^[a-z]:$/.test(n) || n === home || n === path.dirname(home).toLowerCase() || /^[a-z]:\\(windows|program files|program files \(x86\)|programdata)(\\|$)/.test(n) || n.startsWith(home + '\\appdata'))
    throw new Error('Bu klasör çok geniş veya bir sistem klasörü. Proje için ayrı bir klasör seç.');
  return d;
}

// ---- yol ve komut analizi ----
const URL_RE = /\b(?:https?|ftps?|wss?|ssh|git\+https?|git\+ssh):\/\/[^\s"'|&;<>]*/gi;   // ağ adresleri dosya yolu sayılmaz (file:// sayılır)
const PATH_RE = /[A-Za-z]:[\\/][^\s"'|&;<>]*|\\\\[^\s"'|&;<>]+|~[\\/][^\s"'|&;<>]*|%[A-Za-z_]+%[\\/]?[^\s"'|&;<>]*|\$HOME[^\s"'|&;<>]*|(?<![\w:./\\-])\.\.[\\/][^\s"'|&;<>]*|(?<![\w:.\\-])\/(?!\/)[A-Za-z0-9_.][^\s"'|&;<>]*/g;
// ".." ve "." bölümleri çözülür: "C:\proje\..\başka" proje içinde SAYILMAZ
const norm = x => { const s = String(x).replace(/\//g, '\\'); return (/^[A-Za-z]:\\/.test(s) || s.startsWith('\\\\') ? path.win32.normalize(s) : s).replace(/\\+$/, '').toLowerCase(); };
const insideWs = (p, ws) => { const n = norm(p), w = norm(ws); return n === w || n.startsWith(w + '\\'); };
// "/tel:\+\d+/g)" gibi JS düzenli ifadeleri yol değildir: kaçış dizisi içerir VE /bayrak ile biter (ya da yalnızca "/g)" artığıdır)
const isRegexLiteral = p => p[0] === '/' && (/^\/[gimsuy]+[)\]};,.]*$/.test(p) || (/\\[dDwWsSbB.+*?()[\]{}|/]/.test(p) && /\/[gimsuy]*[)\]};,.]*$/.test(p)));
function outsidePaths(cmd, ws) {
  const out = [];
  for (const m of String(cmd).replace(URL_RE, ' ').matchAll(PATH_RE)) { const p = m[0]; if (p.length <= 2 || p === '/dev/null' || isRegexLiteral(p)) continue; if (/^[A-Za-z]:[\\/]/.test(p) && insideWs(p, ws)) continue; out.push(p); }
  return [...new Set(out)];
}
const SENSITIVE = /(\.ssh|\.aws|\.env|id_rsa|credentials|appdata|\.gnupg|password|passwd|\.git-credentials|wallet|keychain|cookies|login data)/i;
const SAFE_SEG = /^(cd\s+("[^"]*"|\S+)|ls\b|dir\b|pwd\b|echo\b|cat\b|type\b|head\b|tail\b|wc\b|sort\b|uniq\b|which\b|where\b|findstr\b|grep\b|rg\b|find\b|node\s+(-v|--version)\b|npm\s+(-v|--version|ls|list|outdated|view)\b|git\s+(status|log|diff|branch|show)\b|python3?\s+(-V|--version)\b)/i;
// tırnak içindeki ; | && komut ayırıcı değildir (grep "a\|b" gibi); komut yerleştirme ($( ) ve `) varsa hiçbir zaman güvenli sayılmaz
const isSafeReadOnly = cmd => !/(-delete|-exec|xargs|>\s*[^\s&|]*\b(sh|bat|cmd|ps1)\b)/i.test(cmd) && !/\$\(|`/.test(cmd) && String(cmd).replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '""').split(/&&|\|\||;|\||\n/).map(x => x.trim()).filter(Boolean).every(x => SAFE_SEG.test(x));
const DANGER = /\b(rm|rmdir|del|erase|rd|format|mkfs|shutdown|taskkill|kill|chmod|chown|sudo|reg|Remove-Item|Set-ExecutionPolicy|iex|Invoke-Expression)\b|git\s+(push|reset\s+--hard|clean)|(^|[\s;&|])(curl|wget|iwr|Invoke-WebRequest)\b|\|\s*(sh|bash|powershell)/i;
const INSTALL = /(^|[\s;&|])(npm|pnpm|yarn|bun)\s+(i|install|add)\b|(^|[\s;&|])npx\s|(^|[\s;&|])(pip3?|python3?\s+-m\s+pip|py\s+-m\s+pip)\s+install\b|\b(choco|winget|apt|apt-get|brew|scoop)\s+(install|add)\b/i;

// ---- paket güvenlik kontrolü (npm ve PyPI herkese açık kayıtları; sadece paket adı gönderilir) ----
const POP_NPM = 'react react-dom lodash express axios chalk commander typescript webpack vite next vue eslint prettier jest mocha moment dayjs uuid dotenv cors mongoose mysql pg redis socket.io jquery bootstrap tailwindcss rimraf glob yargs inquirer node-fetch request async underscore debug fs-extra colors cheerio puppeteer sharp three d3 rxjs zod nodemon concurrently cross-env classnames redux angular svelte webpack-cli babel-core body-parser multer passport jsonwebtoken bcrypt ws http-server serve'.split(' ');
const POP_PY = 'requests numpy pandas flask django scipy matplotlib pytest boto3 urllib3 setuptools pip pillow beautifulsoup4 sqlalchemy fastapi uvicorn pydantic tensorflow torch scikit-learn opencv-python selenium aiohttp httpx jinja2 click pyyaml cryptography openai anthropic lxml tqdm seaborn keras'.split(' ');
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) { d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); } return d[a.length][b.length]; }   // harf yer değiştirmeyi de 1 sayar
function typoOf(name, list) { const n = name.toLowerCase().replace(/^@[^/]+\//, ''); if (n.length < 5) return null; for (const p of list) { if (p === n) return null; if (lev(n, p) <= (n.length >= 9 ? 2 : 1)) return p; } return null; }

const ageText = d => { const days = (Date.now() - new Date(d)) / 864e5; return days < 30 ? `${Math.round(days)} günlük` : days < 365 ? `${Math.round(days / 30)} aylık` : `${(days / 365).toFixed(1)} yıllık`; };
const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
function verdict(name, st) {   // st: {found, weekly, firstAt, deprecated, scripts, license, maintainers, typo, nonRegistry, ver}
  const notes = [], facts = []; let lvl = 0; const bump = (l, t) => { lvl = Math.max(lvl, l); notes.push(t); };
  if (st.nonRegistry) bump(2, 'Kayıt defteri dışı kaynak (git/URL/yerel); içeriği doğrulanamaz');
  else if (!st.found) bump(2, 'Kayıt defterinde bulunamadı (uydurma veya yazım hatası olabilir)');
  else {
    if (st.typo) bump(2, `Popüler "${st.typo}" paketine çok benziyor (yazım hatası tuzağı olabilir)`);
    if (st.deprecated) bump(2, 'Yazar tarafından kullanımdan kaldırılmış');
    if (/security/i.test(st.ver || '')) bump(2, 'npm güvenlik ekibinin kaldırdığı zararlı paketin yer tutucusu olabilir');
    if (st.weekly != null) { facts.push(`haftalık ${fmtN(st.weekly)} indirme`); if (st.weekly < 500) bump(2, 'Çok az kullanılıyor'); else if (st.weekly < 5000) bump(1, 'Az kullanılıyor'); }
    if (st.firstAt) { facts.push(ageText(st.firstAt)); const days = (Date.now() - new Date(st.firstAt)) / 864e5; if (days < 7) bump(2, 'Çok yeni (bir haftadan genç)'); else if (days < 60) bump(1, 'Yeni paket'); }
    facts.push(st.license ? String(st.license) : 'lisans yok'); if (!st.license) bump(1, 'Lisans bilgisi yok');
    if (st.scripts) { facts.push('kurulum betiği VAR'); if (!(st.weekly > 1e6)) bump(1, 'Kurulum sırasında kod çalıştırıyor (preinstall/postinstall)'); } else if (st.src === 'npm') facts.push('kurulum betiği yok');
    if (st.maintainers != null) facts.push(`${st.maintainers} bakımcı`);
  }
  return { name, ver: st.ver || '', src: st.src, level: ['Güvenilir', 'Dikkat', 'Riskli'][lvl], lvl, facts, notes };
}

function parseInstalls(cmd, ws) {
  const pk = [];   // {src, name, ver, nonRegistry}
  let sys = false;
  for (const seg of String(cmd).split(/&&|;|\|\||\||\n/).map(x => x.replace(/\s\d*>+&?\d*\S*/g, ' ').trim())) {   // yönlendirmeleri (2>&1, > dosya) paket sanma
    let m;
    if ((m = seg.match(/^(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\b(.*)$/i))) {
      const toks = (m[1].match(/"[^"]*"|'[^']*'|\S+/g) || []).map(x => x.replace(/^["']|["']$/g, '')).filter(x => !x.startsWith('-'));
      if (!toks.length) { try { const pj = JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf8')); for (const n of Object.keys({ ...pj.dependencies, ...pj.devDependencies }).slice(0, 12)) pk.push({ src: 'npm', name: n }); } catch {} }
      for (const t of toks) pk.push(npmSpec(t));
    } else if ((m = seg.match(/^npx\s+((?:-\S+\s+)*)(\S+)/i))) pk.push(npmSpec(m[2]));
    else if ((m = seg.match(/^(?:pip3?|python3?\s+-m\s+pip|py\s+-m\s+pip)\s+install\b(.*)$/i))) {
      const toks = (m[1].match(/"[^"]*"|'[^']*'|\S+/g) || []).map(x => x.replace(/^["']|["']$/g, '')); let skip = false;
      for (const t of toks) { if (skip) { skip = false; continue; } if (/^-(r|c|e|-requirement|-constraint|-editable)$/.test(t)) { skip = true; pk.push({ src: 'pypi', name: t === '-r' ? 'requirements dosyası' : t, nonRegistry: true }); continue; } if (t.startsWith('-')) continue; const mm = t.match(/^([A-Za-z0-9_.\-]+)\s*(?:[=<>~!]=?\s*(.+))?$/); pk.push(mm && !/[\\/]|^git\+|^https?:/i.test(t) ? { src: 'pypi', name: mm[1], ver: mm[2] } : { src: 'pypi', name: t, nonRegistry: true }); }
    } else if (/\b(choco|winget|apt|apt-get|brew|scoop)\s+(install|add)\b/i.test(seg)) sys = true;
  }
  return { pk: pk.filter(x => x.name).slice(0, 12), sys };
}
function npmSpec(t) {
  if (/^(\.|\/|[A-Za-z]:|git|http|github:|file:|link:|npm:)/i.test(t)) return { src: 'npm', name: t, nonRegistry: true };
  const m = t.match(/^(@[^/@]+\/[^@]+|[^@]+)(?:@(.+))?$/); return { src: 'npm', name: m ? m[1] : t, ver: m?.[2] };
}

// ofisin kendi aracı mı? yalnızca: [cd <çalışma klasörü içi> &&] node "<güvenilir betik>" <argümanlar>; argümanlarda zincirleme/yönlendirme yok ve
// tüm yollar çalışma klasörü içinde. Böyle bir komut onay beklemeden çalışır.
function trustedToolCmd(cmd, ws, trusted) {
  let c = String(cmd).trim();
  const cd = c.match(/^cd\s+("([^"]+)"|(\S+))\s*&&\s*/);
  if (cd) { const d = cd[2] || cd[3]; if (/^[A-Za-z]:[\\/]/.test(d) ? !insideWs(d, ws) : /(^|[\\/])\.\.([\\/]|$)/.test(d)) return false; c = c.slice(cd[0].length); }
  const m = c.match(/^node\s+("([^"]+)"|(\S+))(\s+[\s\S]*)?$/); if (!m) return false;
  const script = m[2] || m[3], rest = m[4] || '';
  if (!trusted.some(t => norm(t) === norm(script))) return false;
  if (/[;&|`$<>\n\r]|%[A-Za-z_]+%/.test(rest)) return false;
  return !outsidePaths(rest, ws).length;
}

function classify(tool, input = {}, ws = '', trusted = []) {
  const cmd = String(input.command || '');
  if (tool === 'Bash') {
    if (trusted.length && trustedToolCmd(cmd, ws, trusted)) return { risk: 'low', why: 'Ofisin asset aracı (çalışma klasörü içinde)', auto: true };
    const out = outsidePaths(cmd, ws);
    if (out.length) return { risk: 'high', why: 'Çalışma klasörü dışındaki yola erişim: ' + cut(out.join(', '), 120) + (out.some(p => SENSITIVE.test(p)) ? ' (hassas olabilir)' : ''), outside: true };
    if (INSTALL.test(cmd)) return { risk: 'high', why: 'Harici paket/program indirme ve kurma', install: true };
    if (DANGER.test(cmd)) return { risk: 'high', why: 'Silme, indirme veya sistemi değiştiren komut' };
    if (isSafeReadOnly(cmd)) return { risk: 'low', why: 'Çalışma klasöründe salt okunur komut', auto: true };
    return { risk: 'medium', why: 'Komut çalıştırma (çalışma klasörü içinde)' };
  }
  const fp = String(input.file_path || input.notebook_path || input.path || '');
  if (tool === 'Read' && fp && trusted.some(t => insideWs(fp, t))) return { risk: 'low', why: 'Ofisin doğrulama çıktısı (ekran görüntüsü)', auto: true };
  if (/^(Read|Glob|Grep)$/.test(tool)) return { risk: 'high', why: 'Çalışma klasörü dışındaki dosyayı/klasörü okuma' + (SENSITIVE.test(fp + ' ' + (input.pattern || '')) ? ' (hassas olabilir)' : ''), outside: true };
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) return { risk: 'high', why: 'Çalışma klasörü dışına/korumalı yola yazma', outside: true };
  if (tool === 'WebFetch') return { risk: 'medium', why: 'Dış siteden veri çekme' };
  if (tool === 'WebSearch') return { risk: 'low', why: 'Web araması' };
  return { risk: 'medium', why: 'Bilinmeyen araç' };
}

const splitSummary = t => { const [body, sum] = t.split(/---\s*ÖZET\s*---/i); return { body: body.trim(), summary: (sum || cut(body.replace(/\s+/g, ' '), 220)).trim() }; };

// denetçi rubriği: yanıttaki SON geçerli JSON nesnesi (```json bloğu içinde de olabilir)
const rubricOf = r => {
  const txt = String(r.response || ''); let last = null;
  for (const m of txt.matchAll(/\{(?:[^{}]|\{[^{}]*\})*\}/g)) { try { const j = JSON.parse(m[0]); if (j && typeof j === 'object' && Object.values(j).some(v => v && typeof v === 'object')) last = { j, i: m.index }; } catch {} }
  if (!last) return null;
  return { json: last.j, rest: txt.slice(0, last.i).replace(/```(?:json)?\s*$/i, '').replace(/[-*\s]*\**DEĞERLENDİRME:?\**\s*$/i, '').trim() };
};

// akran incelemesi: yanıttaki SON {"karar":...} nesnesi → { karar: 'onay'|'revize', oneriler, guclu, rest }
// öneri yoksa "revize" anlamsızdır, onaya çevrilir; JSON bulunamazsa null (inceleme yok sayılır)
const reviewOf = txt => {
  txt = String(txt || ''); let last = null;
  for (const m of txt.matchAll(/\{(?:[^{}]|\{[^{}]*\})*\}/g)) { try { const j = JSON.parse(m[0]); if (j && typeof j === 'object' && 'karar' in j) last = { j, i: m.index }; } catch {} }
  if (!last) return null;
  const oneriler = (Array.isArray(last.j.oneriler) ? last.j.oneriler : []).map(x => cut(String(x || '').trim(), 300)).filter(Boolean).slice(0, 5);
  const karar = /revize/i.test(String(last.j.karar)) && oneriler.length ? 'revize' : 'onay';
  return { karar, oneriler, guclu: cut(String(last.j.guclu || '').trim(), 120), rest: txt.slice(0, last.i).replace(/```(?:json)?\s*$/i, '').trim() };
};

// yanıttaki SON geçerli JSON nesnesi (keys'ten en az birini içeren); bulunamazsa null
const lastJson = (txt, keys) => {
  let last = null;
  for (const m of String(txt || '').matchAll(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g)) { try { const j = JSON.parse(m[0]); if (j && typeof j === 'object' && keys.some(k => k in j)) last = j; } catch {} }
  return last;
};
const arr = (x, n) => (Array.isArray(x) ? x : []).slice(0, n);
const str = (x, n) => cut(String(x ?? '').trim(), n);

// ekip toplantısı — bir ajanın ürünü bütün olarak değerlendirmesi: olmuş / olmamış / olabilir
const critiqueOf = txt => {
  const j = lastJson(txt, ['olmus', 'olmamis', 'olabilir']); if (!j) return null;
  const item = x => ({ sahip: str(x?.sahip, 30).toLowerCase(), text: str([x?.konu, x?.oneri].filter(Boolean).join(' → '), 300) });
  return { olmus: arr(j.olmus, 3).map(x => str(x, 200)).filter(Boolean), olmamis: arr(j.olmamis, 3).map(item).filter(x => x.text), olabilir: arr(j.olabilir, 2).map(item).filter(x => x.text) };
};
// eleştiriye yanıt: maddeler numarasıyla; karar katiliyorum | kismen | katilmiyorum
const repliesOf = txt => {
  const j = lastJson(txt, ['yanitlar']); if (!j) return [];
  const norm = k => /katılmıyorum|katilmiyorum|hay[ıi]r|red/i.test(k) ? 'katilmiyorum' : /k[ıi]smen/i.test(k) ? 'kismen' : 'katiliyorum';
  return arr(j.yanitlar, 20).filter(x => Number.isInteger(+x?.no)).map(x => ({ no: +x.no, karar: norm(String(x.karar || '')), not: str(x.not, 200) }));
};
// kabul ölçütleri: CEO'nun planındaki [{id:"K1",olcut:"..."}] → temiz liste (en fazla 8, kimlikler K1..K8)
const criteriaOf = list => arr(list, 8).map((x, i) => ({ id: /^K\d{1,2}$/.test(String(x?.id || '').toUpperCase()) ? String(x.id).toUpperCase() : `K${i + 1}`, olcut: str(typeof x === 'string' ? x : x?.olcut, 240) }))
  .filter((x, i, a) => x.olcut && a.findIndex(y => y.id === x.id) === i);
// denetçinin kabul değerlendirmesi: {"K1":"gecti — kanıt","K2":"kaldi — neden"} → { K1: { durum: 'gecti'|'kaldi', not } }
const acceptOf = (json, criteria = []) => {
  const out = {}, ids = new Set(criteria.map(c => c.id));
  for (const [k, v] of Object.entries(json?.kabul && typeof json.kabul === 'object' ? json.kabul : {})) {
    const id = k.toUpperCase(), s = String(typeof v === 'object' ? `${v?.durum || ''} ${v?.not || v?.kanit || ''}` : v || '');
    if (!ids.has(id)) continue;
    // yalnızca açık hüküm sayılır: "doğrulanamadı" gibi belirsiz yanıt ölçütü kaldı ya da geçti yapmaz (incelenemediyse önceki durum korunur)
    const durum = /^\s*(kald[ıi]|karşılanmad|karsilanmad|hay[ıi]r|fail|✗)/i.test(s) ? 'kaldi' : /^\s*(geçti|gecti|karşıland|karsilandi|evet|pass|✓)/i.test(s) ? 'gecti' : null;
    if (durum) out[id] = { durum, not: str(s.replace(/^\s*\S+\s*[—–:-]?\s*/, ''), 200) };
  }
  return out;
};

// CEO'nun toplantı kararı
const decisionsOf = txt => {
  const j = lastJson(txt, ['kararlar']); if (!j) return null;
  return { ozet: str(j.ozet, 600), kararlar: arr(j.kararlar, 12).map(x => ({ sahip: str(x?.sahip, 30).toLowerCase(), is: str(x?.is, 400) })).filter(x => x.sahip && x.is),
    reddedilen: arr(j.reddedilen, 12).map(x => ({ no: +x?.no || 0, neden: str(x?.neden, 160) })).filter(x => x.neden) };
};

// denetçinin düzeltme listesi: {"duzeltmeler":[{"ajan":"developer","is":"..."}]} → { developer: ['...'] } (ajan başına en fazla 5)
const fixesOf = json => {
  const out = {};
  for (const f of Array.isArray(json?.duzeltmeler) ? json.duzeltmeler : []) {
    const k = String(f?.ajan || '').toLowerCase().trim(), w = cut(String(f?.is || '').trim(), 300);
    if (k && w && (out[k] ||= []).length < 5) out[k].push(w);
  }
  return out;
};

const W = { teslimat: 0.40, kalite: 0.35, verimlilik: 0.15, uyum: 0.10 };
function scoreTask(m, q) {
  const parts = {};
  parts.teslimat = m.error ? 0 : /max_turns/.test(m.subtype) ? 25 : m.delivered == null ? 100 : m.delivered === 0 ? 20 : Math.round(100 * m.delivered);
  if (m.maxTurns) { const u = m.turns / m.maxTurns; parts.verimlilik = Math.round(u <= 0.5 ? 100 : Math.max(0, 100 - (u - 0.5) * 120)); }
  parts.uyum = Math.max(0, 100 - 30 * (m.denials || 0) - 15 * (m.questions || 0));
  if (q) { const v = ['dogruluk', 'tamlik', 'talimat'].map(k => +q[k]).filter(x => x >= 1 && x <= 10); if (v.length) parts.kalite = Math.round(10 * v.reduce((a, b) => a + b, 0) / v.length); }
  let sum = 0, wt = 0; for (const [k, v] of Object.entries(parts)) { sum += W[k] * v; wt += W[k]; }
  return { score: Math.min(10, Math.max(1, Math.round(sum / wt / 10 * 10) / 10)), parts, note: q?.not };
}

const TEMPLATES = {
  landing: { name: 'Tanıtım sitesi', hint: 'İşletmeni veya ürününü anlat', tasks: [
    { id: 't1', agent: 'researcher', instruction: 'Proje tanımına göre hedef kitleyi ve 3-4 benzer web sitesini kısaca araştır; sayfa bölümleri ve içerik için 5 maddelik öneri yaz.', needs: [], deliverable: 'arastirma.md' },
    { id: 't2', agent: 'designer', instruction: 'Renk paleti, yazı tipi ve sayfa bölümlerini belirle; kısa bir tasarım rehberi yaz.', needs: ['t1'], deliverable: 'tasarim.md' },
    { id: 't3', agent: 'writer', instruction: 'Tasarım rehberindeki bölümler için başlık, kısa metin ve çağrı butonu metinlerini yaz.', needs: ['t1', 't2'], deliverable: 'icerik.md' },
    { id: 't4', agent: 'developer', instruction: 'Tasarım ve içeriği kullanarak tek sayfalık, mobil uyumlu bir web sitesi yap.', needs: ['t2', 't3'], deliverable: 'index.html, style.css' },
    { id: 't5', agent: 'auditor', instruction: 'Çıktıları proje tanımına göre denetle.', needs: ['t4'], deliverable: '' }] },
  research: { name: 'Araştırma raporu', hint: 'Neyi araştırmak istiyorsun?', tasks: [
    { id: 't1', agent: 'researcher', instruction: 'Konuyu web\'de araştır; bulguları kaynaklarıyla madde madde yaz.', needs: [], deliverable: 'bulgular.md' },
    { id: 't2', agent: 'writer', instruction: 'Bulguları yönetici özeti ve sonuç bölümüyle okunaklı bir rapora dönüştür.', needs: ['t1'], deliverable: 'rapor.md' },
    { id: 't3', agent: 'auditor', instruction: 'Raporu bulgularla karşılaştırarak denetle.', needs: ['t2'], deliverable: '' }] },
  mobile: { name: 'Mobil uygulama planı', hint: 'Uygulama fikrini anlat', tasks: [
    { id: 't1', agent: 'researcher', instruction: 'Benzer uygulamaları ve hedef kullanıcıyı araştır; 5 temel özellik öner.', needs: [], deliverable: 'pazar.md' },
    { id: 't2', agent: 'designer', instruction: 'Ana ekranları ve kullanıcı akışını tarif et; renk ve bileşen önerisi yaz.', needs: ['t1'], deliverable: 'ekranlar.md' },
    { id: 't3', agent: 'developer', instruction: 'Teknik mimariyi, veri modelini ve aşamalı yapılacaklar listesini yaz (kod yazma).', needs: ['t1', 't2'], deliverable: 'mimari.md' },
    { id: 't4', agent: 'auditor', instruction: 'Planın tutarlılığını ve eksiklerini denetle.', needs: ['t3'], deliverable: '' }] },
  blog: { name: 'Blog yazısı', hint: 'Konu ve hedef okuru yaz', tasks: [
    { id: 't1', agent: 'researcher', instruction: 'Konuda güncel ve güvenilir 4-5 bilgi/kaynak topla.', needs: [], deliverable: 'kaynaklar.md' },
    { id: 't2', agent: 'writer', instruction: 'Kaynaklara dayanarak başlık, giriş, alt başlıklar ve sonuçla bir blog yazısı yaz.', needs: ['t1'], deliverable: 'yazi.md' },
    { id: 't3', agent: 'auditor', instruction: 'Yazıyı doğruluk ve akıcılık açısından denetle.', needs: ['t2'], deliverable: '' }] },
};

// "claude -p /usage" çıktısını ayrıştırır
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function parseReset(t) {
  const m = String(t).match(/([A-Z][a-z]{2})\s+(\d{1,2})(?:,?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i);
  if (!m || MON[m[1]] == null) { const m2 = String(t).match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i); if (!m2) return null; let h = +m2[1] % 12 + (/pm/i.test(m2[3]) ? 12 : 0); const d = new Date(); d.setHours(h, +(m2[2] || 0), 0, 0); if (d < Date.now()) d.setDate(d.getDate() + 1); return d.getTime(); }
  let h = m[3] ? +m[3] % 12 + (/pm/i.test(m[5]) ? 12 : 0) : 0; const now = new Date();
  let d = new Date(now.getFullYear(), MON[m[1]], +m[2], h, +(m[4] || 0)); if (d.getTime() < now.getTime() - 864e5) d = new Date(now.getFullYear() + 1, MON[m[1]], +m[2], h, +(m[4] || 0));
  return d.getTime();
}
function parseUsage(txt) {
  const items = [];
  for (const line of String(txt).split('\n')) {
    const m = line.trim().match(/^(Current [^:]+):\s*(\d+(?:\.\d+)?)%\s*used(?:\s*[·•-]\s*resets\s+(.+))?$/i); if (!m) continue;
    const k = m[1].toLowerCase(), sub = (/\(([^)]+)\)/.exec(m[1])?.[1] || '').replace(/all models|\s*only/gi, '').trim().toLowerCase();
    const id = /session/.test(k) ? 'session' : /week/.test(k) ? (sub ? 'week_' + sub.replace(/\W+/g, '_') : 'week') : k.replace(/\W+/g, '_');
    items.push({ id, label: m[1].replace(/^Current\s+/i, ''), pct: +m[2], resets: m[3] ? m[3].replace(/\s*\([^)]*\)\s*$/, '').trim() : '', resetsAt: m[3] ? parseReset(m[3]) : null });
  }
  return items;
}

export { parseUsage, parseReset, validateDir, PATH_RE, norm, insideWs, outsidePaths, SENSITIVE, SAFE_SEG, isSafeReadOnly, DANGER, INSTALL, POP_NPM, POP_PY, lev, typoOf, ageText, fmtN, verdict, parseInstalls, npmSpec, classify, splitSummary, rubricOf, reviewOf, fixesOf, critiqueOf, repliesOf, decisionsOf, criteriaOf, acceptOf, W, scoreTask, TEMPLATES };
