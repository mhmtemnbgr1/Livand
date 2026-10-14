// LIVAND — Sanal Ofis: bilgisayarındaki Claude Code'u (aboneliğin) çoklu ajan + arayüzle yöneten yerel sunucu.
// API anahtarı gerekmez: her ajan `claude -p` ile ayrı bir Claude Code süreci olarak çalışır.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { growthPrompt, growthPromptEn, migrateAgent, addLesson, metricLessons, extractSelfReview, levelOf, focusOf, charterFor, baselineOf, savingsOf, MIN_ACCEPT } from './lib/growth.mjs';
import { PROVIDERS, PROVIDER_KEYS, AGENT_PROVIDERS, CATEGORIES, PRIOR_SRC, categoryOf, recordResult, estimate, pickProvider, parseCodexLine, parseAgyLine, newAcc, shellQuote, safeModel } from './lib/providers.mjs';
import { parseUsage, parseReset, cut, validateDir, PATH_RE, norm, insideWs, outsidePaths, SENSITIVE, SAFE_SEG, isSafeReadOnly, DANGER, INSTALL, POP_NPM, POP_PY, lev, typoOf, ageText, fmtN, verdict, parseInstalls, npmSpec, classify, splitSummary, rubricOf, W, scoreTask, TEMPLATES } from './lib/policy.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.OFIS_DATA ? path.resolve(process.env.OFIS_DATA) : path.join(__dir, 'data');   // testler ayrı bir veri klasörü kullanır
const STATE_FILE = path.join(DATA, 'state.json');
const WORK = path.join(DATA, 'workspaces');
fs.mkdirSync(WORK, { recursive: true });
const PORT = Number(process.env.PORT || 3000);
const PARALLEL = Number(process.env.OFIS_PARALLEL || 3);   // aynı anda çalışan Claude süreci (abonelik limitini korur)

// ---------- Claude Code'u bul ----------
function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const exts = process.platform === 'win32' ? ['.exe', '.cmd'] : [''];
  for (const d of (process.env.PATH || '').split(path.delimiter)) for (const e of exts) { const f = path.join(d, 'claude' + e); if (d && fs.existsSync(f)) return f; }
  return null;
}
const CLAUDE = findClaude();
const FORCE_DEMO = process.env.OFIS_DEMO === '1';
const SHOWCASE = FORCE_DEMO && process.env.OFIS_SHOWCASE === '1';   // README görselleri (npm run shots): gerçek CLI'lere hiç sorulmaz, hepsi "bağlı" görünür

// ---------- Diğer CLI'ler: OpenAI Codex CLI (codex) ve Google Antigravity CLI (agy) ----------
function findBin(name, envKey, extra = []) {
  if (process.env[envKey]) return process.env[envKey];
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  for (const d of [...(process.env.PATH || '').split(path.delimiter), ...extra]) for (const e of exts) { const f = path.join(d, name + e); if (d && fs.existsSync(f)) return f; }
  return null;
}
const LAD = process.env.LOCALAPPDATA || '', RAD = process.env.APPDATA || '';
const BINS = {};
const findBins = () => { BINS.codex = findBin('codex', 'CODEX_BIN', [RAD && path.join(RAD, 'npm')]); BINS.antigravity = findBin('agy', 'AGY_BIN', [LAD && path.join(LAD, 'agy', 'bin')]); };
findBins();
// Windows'ta npm kabuğu (.cmd) doğrudan başlatılamaz: içindeki .js betiğini Node ile çalıştır; bulunamazsa güvenli tırnaklarla cmd.exe üzerinden
function spawnSpec(bin, args) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    try {
      const m = fs.readFileSync(bin, 'utf8').match(/%~?dp0%?\\([^"\r\n]+?\.(?:js|mjs|cjs))/i);
      const js = m && path.join(path.dirname(bin), m[1]);
      if (js && fs.existsSync(js)) return { cmd: process.execPath, args: [js, ...args], env: { ELECTRON_RUN_AS_NODE: '1' } };
    } catch {}
    return { cmd: [bin, ...args].map(shellQuote).join(' '), args: [], shell: true };
  }
  return { cmd: bin, args };
}
function spawnBin(bin, args, opts = {}) {
  const s = spawnSpec(bin, args);
  return spawn(s.cmd, s.args, { ...opts, shell: !!s.shell, env: { ...(opts.env || process.env), ...(s.env || {}) } });
}
const provInfo = { claude: { installed: !!CLAUDE }, codex: { installed: !!BINS.codex, ok: false, text: BINS.codex ? 'kontrol ediliyor' : 'kurulu değil' }, antigravity: { installed: !!BINS.antigravity, ok: false, text: BINS.antigravity ? 'kontrol ediliyor' : 'kurulu değil' } };
function checkProviders() {
  findBins();
  for (const k of ['codex', 'antigravity']) if (!BINS[k]) provInfo[k] = { installed: false, ok: false, text: 'kurulu değil' };
  const probe = (k, args, okText, failText) => {
    if (!BINS[k]) return;
    let c; try { c = spawnBin(BINS[k], args, { windowsHide: true }); } catch (e) { provInfo[k] = { installed: true, ok: false, text: cut(e.message, 60) }; return; }
    let out = ''; c.stdout.on('data', d => out += d); c.stderr.on('data', d => out += d); c.stdin.end();
    const t = setTimeout(() => c.kill(), 20000);
    c.on('error', e => { clearTimeout(t); provInfo[k] = { installed: true, ok: false, text: cut(e.message, 60) }; emit('state', publicState()); });
    c.on('close', code => { clearTimeout(t); provInfo[k] = { installed: true, ok: code === 0, text: code === 0 ? cut(okText(out), 60) : failText }; emit('state', publicState()); });
  };
  probe('codex', ['login', 'status'], o => o.trim().split('\n').pop() || 'giriş yapıldı', 'giriş yok — Bağlan');
  // Antigravity'nin belgelenmiş bir giriş durumu komutu yok: girişi Bağlan ile yaptıysan kaydedilir, ilk işte giriş hatası çıkarsa geri alınır
  if (BINS.antigravity) { const g = S.settings.providers.antigravity; provInfo.antigravity = { installed: true, ok: !!g.loggedIn, text: g.loggedIn ? 'giriş yapıldı' : 'giriş yok — Bağlan' }; emit('state', publicState()); }
}

// ---------- Bağlan: CLI'nin kendi tarayıcı girişini başlatır (onayı sen web'de verirsin; parola/anahtar bu uygulamadan geçmez) ----------
const logins = {};   // k -> { child, url, ts, text }
// Windows'ta npm kabuğu (node) durdurulunca asıl CLI süreci geride kalıp portu tutabiliyor: tüm süreç ağacını kapat
function killTree(c) {
  if (!c || c.exitCode != null) return;
  if (process.platform === 'win32' && c.pid) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  else try { c.kill(); } catch {}
}
process.on('exit', () => { for (const L of Object.values(logins)) killTree(L.child); });
// giriş sayfasını varsayılan tarayıcıda aç (gizli süreçten başlayan CLI tarayıcıyı kendisi açamıyor). Sadece resmî giriş adresleri; kabuk kullanılmaz
const AUTH_HOSTS = /^(auth\.openai\.com|accounts\.google\.com|antigravity\.google)$/;
function openAuthUrl(u) {
  let h; try { const x = new URL(u); if (x.protocol !== 'https:') return false; h = x.hostname; } catch { return false; }
  if (!AUTH_HOSTS.test(h)) return false;
  if (process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', u], { detached: true, stdio: 'ignore' }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [u], { detached: true, stdio: 'ignore' }).unref();
  return true;
}
function connectProvider(k) {
  findBins();
  if (!BINS[k]) return { error: `${PROVIDERS[k].label} kurulu değil` };
  const g = S.settings.providers[k];
  if (provInfo[k]?.ok) { g.on = true; save(); emit('state', publicState()); return { ok: true, already: true }; }
  if (logins[k]) return { ok: true, pending: true };
  // Antigravity çoğu zaman Antigravity IDE'nin Google girişini (işletim sistemi anahtarlığı) paylaşır: önce sessizce dene ("agy models" token harcamaz);
  // daha önce bir işte giriş hatası çıktıysa doğrudan giriş penceresini aç
  if (k === 'antigravity' && !g.authFailed && !g.probing) {
    g.probing = true; let ok = false, out = '';
    const c = spawnBin(BINS.antigravity, ['models'], { windowsHide: true, env: cleanEnv() });
    c.stdout.on('data', d => out += d); c.stdin.end();
    const t = setTimeout(() => killTree(c), 30000);
    c.on('error', () => {});
    c.on('close', code => {
      clearTimeout(t); delete g.probing; ok = code === 0 && /gemini|claude|gpt/i.test(out);
      if (ok) { g.loggedIn = true; g.on = true; save(); checkProviders(); emit('state', publicState()); }
      else { g.authFailed = true; connectProvider(k); }   // sessiz deneme olmadı → giriş penceresi
    });
    return { ok: true, pending: true };
  }
  let child;
  try {
    if (k === 'codex') child = spawnBin(BINS.codex, ['login'], { windowsHide: true, env: cleanEnv() });   // tarayıcıyı açar, localhost'a dönüşü bekler
    else if (process.platform === 'win32') child = spawn('cmd.exe', ['/c', 'start', '"Antigravity girişi"', '/wait', `"${BINS.antigravity}"`], { windowsHide: false, windowsVerbatimArguments: true });   // agy girişi etkileşimli: ayrı pencerede açılır
    else return { error: 'Bu sistemde terminalde "agy" çalıştırıp giriş yap' };
  } catch (e) { return { error: e.message }; }
  const L = logins[k] = { child, ts: Date.now(), url: null, text: k === 'codex' ? 'Tarayıcıda onay bekleniyor' : 'Açılan pencerede giriş yap, tarayıcıda onayla, sonra o pencereyi kapat' };
  const grab = d => { const m = String(d).match(/https:\/\/[^\s"'<>]+/); if (m && !L.url) { L.url = m[0]; if (k === 'codex') openAuthUrl(L.url); emit('state', publicState()); } };
  child.stdout?.on('data', grab); child.stderr?.on('data', grab); child.stdin?.end();
  const t = setTimeout(() => killTree(child), 10 * 60 * 1000);
  child.on('close', () => {
    clearTimeout(t); if (logins[k] !== L) return; delete logins[k];
    if (k === 'antigravity') { g.loggedIn = true; delete g.authFailed; }
    g.on = true; save(); checkProviders(); emit('state', publicState());
  });
  child.on('error', e => { clearTimeout(t); delete logins[k]; provInfo[k] = { installed: true, ok: false, text: cut(e.message, 60) }; emit('state', publicState()); });
  emit('state', publicState());
  return { ok: true, pending: true };
}
// Bağlantıyı kes: o CLI'ye yeni iş verilmez, çalışan süreçleri hemen durur (yarım görev Claude Code ile sürer). logout: CLI'nin kendi girişini de sil
function disconnectProvider(k, logout) {
  const g = S.settings.providers[k]; g.on = false;
  if (logins[k]) { const c = logins[k].child; delete logins[k]; killTree(c); }
  for (const c of allProcs) if (c.provider === k) { c.userStop = true; try { c.kill(); } catch {} }
  if (logout && k === 'codex' && BINS.codex) { try { spawnBin(BINS.codex, ['logout'], { windowsHide: true }).on('close', () => checkProviders()); } catch {} }
  if (logout && k === 'antigravity') g.loggedIn = false;
  save(); checkProviders(); emit('state', publicState());
  return { ok: true };
}
let claudeInfo = { ok: false, text: CLAUDE ? 'kontrol ediliyor' : 'claude bulunamadı' };
function checkAuth() {
  if (!CLAUDE) return;
  const env = cleanEnv();
  execFile(CLAUDE, ['auth', 'status'], { env, timeout: 20000, windowsHide: true }, (err, out) => {
    try { const j = JSON.parse(out); claudeInfo = { ok: j.loggedIn !== false && !err, text: j.authMethod || 'giriş yapıldı', method: j.authMethod }; }
    catch { claudeInfo = { ok: !err, text: err ? 'giriş yok (terminalde "claude auth login")' : 'bağlı' }; }
    emit('state', publicState());
    if (claudeInfo.ok && !cliOff()) setTimeout(() => checkLimit().catch(() => {}), 300);   // giriş doğrulanınca kullanım yüzdesini al
  });
}
// Sadece CLI girişleri (abonelik) kullanılır: ortamda bir API anahtarı olsa bile hiçbir CLI'ye geçirilmez
function cleanEnv() {
  const e = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) delete e[k];
  e.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  return e;
}
// ---- Claude abonelik limiti: CLI her çalıştırmada pencere türü, durum ve sıfırlanma zamanını bildirir (yüzde sadece sınıra yaklaşınca gelir) ----
function noteLimit(i) {
  const k = String(i.rateLimitType || 'genel').slice(0, 30);
  S.limits[k] = { status: String(i.status || ''), resetsAt: Number(i.resetsAt) || null, utilization: i.utilization != null ? Number(i.utilization) : null, overage: i.overageStatus || null, usingOverage: !!i.isUsingOverage, ts: Date.now() };
  save(); emit('limits', S.limits);
  if (!S.usage || Date.now() - S.usage.ts > 60000) setTimeout(() => checkLimit().catch(() => {}), 500);
}
// gerçek kullanım yüzdesi: "claude -p /usage" yerel komuttur, model çağırmaz (0 token, ~2 sn)
let checkingLimit = false;
function checkLimit() {
  return new Promise(resolve => {
    if (!liveMode() || cliOff()) return resolve({ error: cliOff() ? 'CLI bağlantısı kapalı' : 'Claude Code bağlı değil' });
    if (checkingLimit) return resolve({ error: 'Zaten denetleniyor' });
    checkingLimit = true; const dir = path.join(DATA, 'limit-check'); fs.mkdirSync(dir, { recursive: true });
    execFile(CLAUDE, ['-p', '--output-format', 'json', '--no-session-persistence', '--setting-sources', 'project', '--strict-mcp-config', '/usage'], { cwd: dir, env: cleanEnv(), windowsHide: true, timeout: 45000, maxBuffer: 1 << 20 }, (err, out) => {
      checkingLimit = false;
      let txt = ''; try { txt = JSON.parse(out).result || ''; } catch { txt = String(out || ''); }
      const items = parseUsage(txt);
      if (!items.length) return resolve({ error: 'Kullanım bilgisi okunamadı' + (err ? ' (' + cut(err.message, 60) + ')' : '') });
      S.usage = { items, ts: Date.now() }; save(); emit('usage', S.usage); resolve({ ok: true, usage: S.usage });
    });
  });
}
setInterval(() => { if (liveMode() && !cliOff()) checkLimit().catch(() => {}); }, 10 * 60 * 1000).unref();   // 10 dakikada bir tazele (token harcamaz)
const liveMode = () => !!CLAUDE && !FORCE_DEMO && claudeInfo.ok !== false;
const cliOff = () => S.settings?.cli === false && !!CLAUDE && !FORCE_DEMO;   // kullanıcı bağlantıyı kendisi kesti (tüm CLI'ler durur)
// bir sağlayıcı şu an kullanılabilir mi? Codex/Antigravity sadece sen açarsan (Analiz → CLI sağlayıcıları) devreye girer
const provUsable = k => !cliOff() && (k === 'claude' ? (liveMode() || FORCE_DEMO) : !!S.settings.providers[k]?.on && (FORCE_DEMO || provInfo[k]?.ok));
function chooseProvider(agentId, cat) {
  const pref = S.agents[agentId]?.provider || 'auto', usable = PROVIDER_KEYS.filter(provUsable);
  if (pref !== 'auto') return usable.includes(pref) || pref === 'claude' ? { provider: pref, why: 'ajan ayarı' } : { provider: 'claude', why: `${PROVIDERS[pref].label} kullanılamıyor, Claude Code ile çalışıldı` };
  return pickProvider(S.routing, cat, usable) || { provider: 'claude', why: 'kullanılabilir başka CLI yok' };
}

// ---------- Varsayılan ajanlar ----------
const READ = 'Read,Glob,Grep', WEB = 'WebSearch,WebFetch';
const DEFAULT_AGENTS = {
  ceo:        { name: 'Defne', title: 'CEO / Proje Yöneticisi', color: '#e0a526', model: 'sonnet', turns: 10, think: true, tools: `${READ},${WEB}`,
                directive: 'İşi en az ajanla çöz. Önce kısa araştırma yap, sonra net, kısa, ölçülebilir görevler ver. Gereksiz görev açma. Kullanıcıya kısa raporla.', memory: [] },
  designer:   { name: 'Mira', title: 'Tasarımcı', color: '#d6489b', model: 'sonnet', turns: 10, think: false, tools: `${READ},Write,Edit,${WEB}`,
                directive: 'Arayüz/görsel tasarım kararları ver: yapı, renk, tipografi, bileşenler. Tasarım kararlarını çalışma klasörüne kısa bir .md dosyası olarak yaz.', memory: [] },
  developer:  { name: 'Kaan', title: 'Yazılımcı', color: '#3b82f6', model: 'sonnet', turns: 24, think: true, tools: `${READ},Write,Edit,Bash`,
                directive: 'Çalışan, sade kod yaz ve dosyaları çalışma klasörüne kaydet. Açıklamayı minimumda tut. Paket kurulumu gibi dış işlemlerden önce gerçekten gerekli mi düşün.', memory: [] },
  researcher: { name: 'Deniz', title: 'Araştırmacı', color: '#14b8a6', model: 'haiku', turns: 10, think: false, tools: `${READ},Write,${WEB}`,
                directive: 'Bulguları madde madde, kaynak/varsayım belirterek ver. Uzatma. Bulguları çalışma klasörüne kısa bir .md dosyası olarak yaz.', memory: [] },
  writer:     { name: 'Elif', title: 'Yazar', color: '#a855f7', model: 'haiku', turns: 8, think: false, tools: `${READ},Write,Edit`,
                directive: 'Net, akıcı, hedef kitleye uygun metin yaz. Süsleme yapma. Metinleri çalışma klasörüne kaydet.', memory: [] },
  auditor:    { name: 'Selim', title: 'Denetçi', color: '#ef4444', model: 'haiku', turns: 8, think: false, tools: READ,
                directive: 'Çıktıları kullanıcının isteğine göre denetle. Sadece gerçek hataları/eksikleri yaz. İyiyse "ONAY" de. Dosya yazma, sonucu doğrudan yanıtında ver.', memory: [] },
};
const USER = { name: 'Sen', color: '#25d366' };

// ---------- Durum ----------
let S = { agents: DEFAULT_AGENTS, projects: [], requests: [] };
try { S = { ...S, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
S.shared ||= { prefs: [] };
S.daily ||= {}; S.log ||= []; S.limits ||= {}; S.settings ||= { lang: 'tr' };
for (const d of Object.values(S.daily)) delete d.cost; for (const r of S.requests || []) delete r.cost;   // eski kayıtlardaki API fiyatı alanları
S.routing ||= {};   // öğrenilen: hangi CLI hangi iş türünde ne puan aldı
S.settings.providers ||= {}; S.settings.providers.codex ||= { on: false, model: '' }; S.settings.providers.antigravity ||= { on: false, model: '', trust: false };
for (const [k, v] of Object.entries(DEFAULT_AGENTS)) S.agents[k] ||= v;
for (const a of Object.values(S.agents)) {
  a.scores ||= []; migrateAgent(a); delete a.memory;
  if (!['sonnet', 'opus', 'haiku', 'fable'].includes(a.model) && !/^claude-/.test(a.model || '')) a.model = 'sonnet';   // eski kayıtlardaki geçersiz model adlarını temizle
  if (/^claude-(sonnet|opus|haiku)/.test(a.model)) a.model = a.model.match(/sonnet|opus|haiku/)[0];
  if (!AGENT_PROVIDERS.includes(a.provider) || !S.settings.autoV1) a.provider = 'auto';
  a.turns ||= 12; a.tools ||= READ; if (a.think === undefined) a.think = DEFAULT_AGENTS[Object.keys(S.agents).find(k => S.agents[k] === a)]?.think ?? false; delete a.maxTokens;
}
S.settings.autoV1 = true;
for (const p of S.projects) if (p.executing || (p.board || []).some(x => x.status === 'çalışıyor')) {
  p.executing = false; p.interrupted = true; for (const x of p.board || []) if (x.status === 'çalışıyor') x.status = 'kesildi';
  p.messages.push({ id: Math.random().toString(36).slice(2, 10), ts: Date.now(), from: 'ceo', to: 'user', text: 'Uygulama kapandığı için yarım kalan iş var. "Devam et" ile kalan görevleri sürdürebilirsin.' });
}
let saveT;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(S), () => {}), 300); };
const uid = () => Math.random().toString(36).slice(2, 10);

const clients = new Set();
const emit = (type, data) => { const m = `data: ${JSON.stringify({ type, data })}\n\n`; for (const c of clients) c.write(m); };
function post(p, from, to, text, extra = {}) {
  const msg = { id: uid(), ts: Date.now(), from, to, text, ...extra };
  p.messages.push(msg); save(); emit('message', { projectId: p.id, msg }); return msg;
}
const status = (agent, state, note = '') => emit('status', { agent, state, note });
const toolKind = n => /^(Read|Glob|Grep)$/.test(n) ? 'read' : /^(WebSearch|WebFetch)$/.test(n) ? 'search' : /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(n) ? 'write' : n === 'Bash' ? 'run' : /^(Task|Agent)$/.test(n) ? 'delegate' : 'think';
function logEv(p, agent, kind, text) {
  const e = { ts: Date.now(), agent, project: p?.id, kind, text: cut(String(text || '').replace(/\s+/g, ' '), 300) };
  S.log.push(e); if (S.log.length > 400) S.log.shift(); emit('log', e);
}

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'proje';
function wsDir(p) { p.dir ||= path.join(WORK, `${slug(p.name)}-${p.id}`); fs.mkdirSync(p.dir, { recursive: true }); return p.dir; }
function listFiles(dir, base = dir, out = []) {
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name.startsWith('.')) continue; const f = path.join(dir, e.name); if (e.isDirectory()) listFiles(f, base, out); else out.push(path.relative(base, f).replace(/\\/g, '/')); if (out.length > 60) break; } } catch {}
  return out;
}

// ---------- Çalışma klasörü seçimi ----------
let picking = false;
function pickFolder() {   // Windows'un kendi klasör seçme penceresi
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve({ error: 'Bu sistemde klasör penceresi yok; yolu elle yaz.' });
    if (picking) return resolve({ error: 'Klasör penceresi zaten açık' });
    picking = true;
    const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $o=New-Object System.Windows.Forms.Form; $o.TopMost=$true; $o.Opacity=0; $o.ShowInTaskbar=$false; $o.StartPosition='CenterScreen'; $o.Show(); $f=New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description='Ajanların çalışacağı klasörü seç'; $f.ShowNewFolderButton=$true; if($f.ShowDialog($o) -eq 'OK'){ Write-Output $f.SelectedPath }";
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { windowsHide: false, timeout: 10 * 60 * 1000 }, (err, out) => { picking = false; const p = String(out || '').trim(); resolve(p ? { path: p } : { cancel: true }); });
  });
}

// ---------- Eşzamanlılık kapısı ----------
const allProcs = new Set();
process.on('exit', () => { for (const c of allProcs) try { c.kill(); } catch {} });
let running = 0; const waiters = [];
const parallel = () => Math.min(3, Math.max(1, Number(S.settings?.parallel) || PARALLEL));
const gate = async fn => { if (running >= parallel()) await new Promise(r => waiters.push(r)); running++; try { return await fn(); } finally { running--; waiters.shift()?.(); } };

// ---------- Onay mekanizması (Claude Code'daki izin istemi gibi) ----------
const approvals = new Map();
const approvalKey = (tool, input) => tool === 'Bash' ? 'Bash:' + String(input?.command || '').trim().split(/\s+/)[0] : tool;
function describeTool(tool, input = {}) {
  if (tool === 'Bash') return `Komut çalıştırmak istiyor:\n${cut(String(input.command || ''), 300)}`;
  if (tool === 'WebFetch') return `İnternetten sayfa çekmek istiyor:\n${input.url}`;
  if (tool === 'WebSearch') return `Web'de arama yapmak istiyor: ${input.query}`;
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) return `Dosya yazmak istiyor:\n${input.file_path || input.notebook_path}`;
  if (tool === 'Read') return `Dosya okumak istiyor:\n${input.file_path}`;
  return `${tool} aracını kullanmak istiyor:\n${cut(JSON.stringify(input), 300)}`;
}
async function jget(url, ms = 6000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } }); if (r.status === 404) return { notFound: true }; if (!r.ok) return null; return await r.json(); } catch { return null; } finally { clearTimeout(t); }
}
async function checkNpm(name, ver, nonRegistry) {
  if (nonRegistry) return verdict(name, { nonRegistry: true, ver, src: 'npm' });
  const enc = name.startsWith('@') ? '@' + encodeURIComponent(name.slice(1)) : encodeURIComponent(name);
  const [lat, dl] = await Promise.all([jget(`https://registry.npmjs.org/${enc}/latest`), jget(`https://api.npmjs.org/downloads/point/last-week/${enc}`)]);
  if (lat?.notFound) return verdict(name, { found: false, ver, src: 'npm', typo: typoOf(name, POP_NPM) });
  if (!lat) return { name, ver, src: 'npm', level: 'Kontrol edilemedi', lvl: 1, facts: [], notes: ['Kayıt defterine ulaşılamadı; elle doğrulayın'] };
  const weekly = dl?.downloads ?? null; let firstAt = null;
  if (weekly == null || weekly < 200000) { const full = await jget(`https://registry.npmjs.org/${enc}`, 8000); firstAt = full?.time?.created || null; }
  const sc = lat.scripts || {};
  return verdict(name, { found: true, ver: ver || lat.version, src: 'npm', weekly, firstAt, deprecated: !!lat.deprecated, scripts: !!(sc.preinstall || sc.install || sc.postinstall), license: typeof lat.license === 'string' ? lat.license : lat.license?.type, maintainers: Array.isArray(lat.maintainers) ? lat.maintainers.length : null, typo: typoOf(name, POP_NPM) });
}
async function checkPypi(name, ver, nonRegistry) {
  if (nonRegistry) return verdict(name, { nonRegistry: true, ver, src: 'pypi' });
  const [j, dl] = await Promise.all([jget(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, 8000), jget(`https://pypistats.org/api/packages/${encodeURIComponent(name.toLowerCase())}/recent`)]);
  if (j?.notFound) return verdict(name, { found: false, ver, src: 'pypi', typo: typoOf(name, POP_PY) });
  if (!j) return { name, ver, src: 'pypi', level: 'Kontrol edilemedi', lvl: 1, facts: [], notes: ['PyPI\'ye ulaşılamadı; elle doğrulayın'] };
  const times = Object.values(j.releases || {}).flat().map(f => f.upload_time_iso_8601).filter(Boolean).sort();
  return verdict(name, { found: true, ver: ver || j.info?.version, src: 'pypi', weekly: dl?.data?.last_week ?? null, firstAt: times[0] || null, deprecated: !!j.info?.yanked, license: j.info?.license?.length < 40 ? j.info.license : (j.info?.classifiers || []).find(c => c.startsWith('License ::'))?.split('::').pop().trim(), typo: typoOf(name, POP_PY) });
}
async function checkPackages(cmd, ws) {
  const { pk, sys } = parseInstalls(cmd, ws), out = [];
  const res = await Promise.race([Promise.all(pk.map(x => (x.src === 'npm' ? checkNpm : checkPypi)(x.name, x.ver, x.nonRegistry).catch(() => ({ name: x.name, src: x.src, level: 'Kontrol edilemedi', lvl: 1, facts: [], notes: [] })))), new Promise(r => setTimeout(() => r(null), 12000))]);
  if (res) out.push(...res);
  if (sys) out.push({ name: 'sistem paketi', src: 'sys', level: 'Dikkat', lvl: 1, facts: [], notes: ['Bu paket yöneticisi için otomatik güvenlik kontrolü yok; bilgisayarını değiştirir'] });
  return out;
}

async function requestApproval({ project, agent, tool_name, input }) {
  const p = S.projects.find(x => x.id === project);
  const ws = p ? wsDir(p) : WORK;
  const key = approvalKey(tool_name, input);
  const cl = classify(tool_name, input, ws);
  if (cl.auto) return { behavior: 'allow', updatedInput: input };                          // çalışma klasöründe zararsız okuma komutları sormadan
  const strict = cl.outside || cl.install || cl.risk === 'high';                            // dış dosya erişimi ve kurulumlar için "hep izin" geçerli değil
  if (!strict && (p?.allow?.[key] || (p?.autoLow && cl.risk === 'low'))) return { behavior: 'allow', updatedInput: input };
  const pkgs = cl.install ? await checkPackages(String(input.command || ''), ws) : [];
  return new Promise(resolve => {
    const id = uid(); const text = describeTool(tool_name, input);
    const a = { id, projectId: project, agent, tool: tool_name, key, text, ts: Date.now(), risk: cl.risk, why: cl.why, strict, pkgs };
    const timer = setTimeout(() => settle('deny', false, 'Zaman aşımı: 15 dk içinde onay verilmedi.'), 15 * 60 * 1000);
    const settle = (decision, always, msg) => {
      clearTimeout(timer); approvals.delete(id);
      if (decision !== 'allow' && p) { (p.denials ||= {})[agent] = (p.denials[agent] || 0) + 1; }
      if (decision === 'allow' && always && p && !strict) (p.allow ||= {})[key] = true;
      const m = p?.messages.find(x => x.approvalId === id); if (m) { m.approval = decision === 'allow' ? (always && !strict ? 'always' : 'allowed') : 'denied'; }
      save(); emit('approval_done', { id, decision, projectId: project, agent });
      status(agent, 'working', 'izin sonrası devam');
      resolve(decision === 'allow' ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: msg || 'Kullanıcı bu işlemi reddetti. Çalışma klasörü dışına çıkma; başka bir yol dene veya işlemsiz devam et.' });
    };
    approvals.set(id, { ...a, settle });
    if (p) post(p, agent, 'user', text, { approvalId: id, approval: 'pending', tool: tool_name, risk: cl.risk, why: cl.why, pkgs, strict });
    emit('approval', a); status(agent, 'waiting', 'onay bekliyor');
  });
}

// ---------- Claude Code süreci ----------
function mockRun({ system, prompt }) {
  const name = (system.match(/Sen ([^,\s]+)/) || [])[1] || 'Ajan';
  let text;
  if (/PLAN_JSON/.test(prompt)) {
    text = JSON.stringify({ reply: 'Projeyi anladım. Önce kısa bir araştırma yapıp tasarım ve kodlama için görev dağılımı çıkardım. (DEMO modu)', research: ['Benzer sitelerde tek sayfalık yapı öne çıkıyor (demo)', 'Mobil öncelikli tasarım öneriliyor (demo)'],
      tasks: [
        { id: 't1', agent: 'researcher', instruction: 'Konuyu kısaca araştır, 5 madde.', needs: [], deliverable: 'arastirma.md' },
        { id: 't2', agent: 'designer', instruction: 'Arayüz yapısını öner.', needs: [], deliverable: 'tasarim.md' },
        { id: 't3', agent: 'developer', instruction: 'Araştırma ve tasarıma göre ilk sürüm kodunu yaz.', needs: ['t1', 't2'], deliverable: 'index.html' },
        { id: 't4', agent: 'auditor', instruction: 'Çıktıyı isteğe göre denetle.', needs: ['t3'], deliverable: '' }],
      needs_approval: ['Gerekirse npm paket kurulumu (demo)'], questions: [] });
  } else if (/DERS_YAZ/.test(prompt)) text = JSON.stringify(Object.fromEntries((prompt.match(/^(\w+) \(/gm) || []).map(k => [k.replace(/ \($/, ''), ['Çıktıyı kısa tut ve önce sonucu yaz.', 'Kullanıcı net örnek verince daha iyi sonuç çıkıyor.']]).concat([['kullanici', ['Kısa ve net yanıtlardan hoşlanıyor.']]])));
  else if (/YONERGE_ANLA/.test(prompt)) text = 'Yönergeyi şöyle anladım: verilen kurallara kısa ve net çıktılarla uyacağım. (DEMO) Netleştirmek istediğim: öncelik hız mı kalite mi?';
  else if (/KALİTE DEĞERLENDİRMESİ/.test(prompt)) { const ag = ((prompt.match(/Değerlendirilecek ajanlar: ([\w,]+)/) || [])[1] || '').split(','); text = 'Dosyaları inceledim (demo).\n' + JSON.stringify(Object.fromEntries(ag.filter(Boolean).map(k => [k, { dogruluk: 7 + Math.floor(Math.random() * 3), tamlik: 6 + Math.floor(Math.random() * 4), talimat: 7 + Math.floor(Math.random() * 3), not: 'demo değerlendirme' }]))); }
  else if (/SORU_SERBEST/.test(prompt) && name === 'Kaan' && !/SORU-CEVAP/.test(prompt)) text = 'SORU@designer: Ana renk paleti hangisi olsun?';
  else if (/SORU\/CEVAP_ISTEGI/.test(prompt)) text = 'Sıcak kahve tonları (#6b4226, #f5e6d3) öneriyorum.';
  else {
    text = `[Test yanıtı — ${name}]\nİstediğin işi çalışma klasöründe yaptım (test modu, gerçek Claude Code çalışmadı).\n---ÖZ--- Teslimden önce dosyaları tek tek kontrol edeceğim\n---ÖZET---\n${name} kendi bölümünü tamamladı (test).`;
  }
  return { text, tin: Math.ceil((system.length + prompt.length) / 4), tout: Math.ceil(text.length / 4), tcache: 0, demo: true, turns: 2 + Math.floor(Math.random() * 5), subtype: 'success' };
}

// araç çağrısını kullanıcının anlayacağı kısa cümleye çevirir ("WebSearch: x" yerine "Web'de aradı: x")
function activityText(name, input = {}) {
  const base = f => String(f || '').split(/[\\/]/).filter(Boolean).pop() || '';
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return cut(String(u || ''), 40); } };
  const q = s => `“${cut(String(s || '').replace(/\s+/g, ' ').trim(), 60)}”`;
  switch (name) {
    case 'WebSearch': return `Web'de aradı: ${q(input.query)}`;
    case 'WebFetch': return `Sayfa okudu: ${host(input.url)}`;
    case 'Read': return `Dosya okudu: ${base(input.file_path)}`;
    case 'Write': return `Dosya yazdı: ${base(input.file_path)}`;
    case 'Edit': case 'MultiEdit': return `Dosya düzenledi: ${base(input.file_path)}`;
    case 'NotebookEdit': return `Not defteri düzenledi: ${base(input.notebook_path)}`;
    case 'Glob': return `Dosyalara baktı: ${cut(String(input.pattern || ''), 40)}`;
    case 'Grep': return `Dosyalarda aradı: ${q(input.pattern)}`;
    case 'Bash': return `Komut çalıştırdı: ${cut(String(input.command || '').split('\n')[0], 60)}`;
    case 'Task': case 'Agent': return `Yardımcı görevlendirdi: ${cut(String(input.description || input.prompt || ''), 50)}`;
    case 'TodoWrite': return 'Yapılacaklar listesini güncelledi';
    default: return name.replace(/^mcp__\w+__/, '');
  }
}

function runClaude({ agentId, p, prompt, system, model, tools, allow, turns, mode, cwd, think }) {
  return new Promise(resolve => {
    const mcp = { mcpServers: { ofis: { command: process.execPath, args: [path.join(__dir, 'approver.js')], env: { OFIS_URL: `http://127.0.0.1:${PORT}`, OFIS_AGENT: agentId, OFIS_PROJECT: p?.id || '', ELECTRON_RUN_AS_NODE: '1' } } } };
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--append-system-prompt', system, '--max-turns', String(turns),
      '--setting-sources', 'project', '--disable-slash-commands', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', JSON.stringify(mcp),
      '--permission-prompt-tool', 'mcp__ofis__approve', '--permission-mode', mode, '--tools', tools,
      '--settings', JSON.stringify({ permissions: { ask: ['Bash'] } })];   // her Bash komutu bize sorulur; zararsızları biz otomatik geçiriyoruz
    if (allow.length) args.push('--allowedTools', ...allow);
    let out = '', err = '', result = null, text = '', limited = false; const subs = new Map();
    const env = cleanEnv(); if (!think) env.MAX_THINKING_TOKENS = '0';   // düşünme tokenlarını kapat (çıktı tokenı tasarrufu)
    const child = spawn(CLAUDE, args, { cwd, env, windowsHide: true });
    const kill = setTimeout(() => child.kill(), 25 * 60 * 1000);
    if (p) (p.procs ||= new Set()).add(child);
    allProcs.add(child);
    child.stdin.end(prompt);
    child.stderr.on('data', d => err += d);
    child.stdout.on('data', d => {
      out += d; let i;
      while ((i = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, i); out = out.slice(i + 1); if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.type === 'assistant') for (const c of m.message?.content || []) {
          if (c.type === 'tool_use') {
            const t = activityText(c.name, c.input), kind = toolKind(c.name);
            if (!m.parent_tool_use_id) { status(agentId, 'working', t); emit('activity', { agent: agentId, text: t, tool: c.name, kind }); }
            logEv(p, agentId, m.parent_tool_use_id ? 'sub' : 'tool', t);
            if (kind === 'delegate') { subs.set(c.id, true); emit('sub', { agent: agentId, id: c.id, on: true, text: cut(c.input?.description || c.input?.prompt || 'yardımcı', 40) }); }
          }
          if (c.type === 'text' && !m.parent_tool_use_id) { text += c.text; if (c.text.trim()) logEv(p, agentId, 'text', c.text); }
        }
        if (m.type === 'user') for (const c of m.message?.content || []) if (c.type === 'tool_result') {
          if (subs.has(c.tool_use_id)) { subs.delete(c.tool_use_id); emit('sub', { agent: agentId, id: c.tool_use_id, on: false }); }
          const b = Array.isArray(c.content) ? c.content.map(x => x.text || '').join(' ') : String(c.content || '');
          if (b.trim()) logEv(p, agentId, c.is_error ? 'error' : 'result', b);
        }
        if (m.type === 'rate_limit_event' && m.rate_limit_info) noteLimit(m.rate_limit_info);
        if (m.type === 'rate_limit_event' && m.rate_limit_info?.status && !/^allowed/.test(m.rate_limit_info.status)) { limited = true; status(agentId, 'limit', 'kullanım limiti'); logEv(p, agentId, 'error', 'Kullanım limiti: ' + m.rate_limit_info.status); }
        if (m.type === 'system' && m.subtype === 'api_retry' && /rate_limit|overloaded/.test(m.error || '')) { limited = true; status(agentId, 'limit', 'limit veya yoğunluk, yeniden deniyor'); }
        if (m.type === 'result') result = m;
      }
    });
    child.on('error', e => { clearTimeout(kill); resolve({ text: `Hata: Claude Code başlatılamadı (${e.message})`, tin: 0, tout: 0, tcache: 0, error: e.message }); });
    child.on('close', code => {
      clearTimeout(kill); p?.procs?.delete(child); allProcs.delete(child);
      for (const id of subs.keys()) emit('sub', { agent: agentId, id, on: false });
      const u = result?.usage || {};
      const body = (result?.result ?? text ?? '').trim();
      const failed = !result || result.is_error || code !== 0;
      const msg = failed ? (body || err.trim().split('\n').slice(-3).join(' ') || `Claude Code çıkış kodu ${code}`) : body;
      resolve({ text: failed ? `Hata: ${cut(msg, 400)}` : body, tin: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0), tout: u.output_tokens || 0, tcache: u.cache_read_input_tokens || 0,
        turns: result?.num_turns, subtype: result?.subtype, error: failed ? msg : undefined, limit: limited || (failed && /usage limit|rate limit|limit reached|quota/i.test(msg)) });
    });
  });
}

// Codex / Antigravity: ofisin onay kutusuna bağlanamazlar (Claude'un --permission-prompt-tool karşılığı yok);
// bu yüzden kendi sandbox'larında, çalışma klasörüyle sınırlı ve onaysız ("asla sorma") modda çalıştırılırlar.
function runOther(provider, { agentId, p, prompt, system, phase, cwd, think }) {
  return new Promise(resolve => {
    const cfg = S.settings.providers[provider] || {}, model = safeModel(cfg.model);
    const full = `${system}\n\n---\n${prompt}`;
    let args, viaStdin = false;
    if (provider === 'codex') {   // https://developers.openai.com/codex/noninteractive
      args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-C', cwd, '-s', phase === 'work' ? 'workspace-write' : 'read-only', '-c', 'approval_policy=never'];
      if (model) args.push('-m', model);
      if (!think) args.push('-c', 'model_reasoning_effort=low');
      args.push('-'); viaStdin = true;   // istem stdin'den: komut satırına kullanıcı metni girmez
    } else {   // https://antigravity.google/docs/cli/headless/
      // agy 1.3.x: --mode plan (salt planlama) | accept-edits (dosya düzenlemelerini kabul eder, komutlar izin ister → başsız modda reddedilir)
      args = ['-p', cut(full, 24000), '--output-format', 'stream-json', '--print-timeout', '25m', '--sandbox', '--disable-slash-commands', '--mode', phase === 'work' ? 'accept-edits' : 'plan'];
      if (model) args.push('--model', model);
      if (!think) args.push('--effort', 'low');
      if (phase === 'work' && cfg.trust) args.push('--dangerously-skip-permissions');   // komutlara da sormadan izin: sadece sen "tam yetki" açtıysan; yine sandbox içinde
    }
    const acc = newAcc(), parse = provider === 'codex' ? parseCodexLine : parseAgyLine;
    let out = '', err = '', child;
    try { child = spawnBin(BINS[provider], args, { cwd, env: cleanEnv(), windowsHide: true }); }
    catch (e) { return resolve({ text: `Hata: ${PROVIDERS[provider].label} başlatılamadı (${e.message})`, tin: 0, tout: 0, tcache: 0, error: e.message }); }
    const kill = setTimeout(() => child.kill(), 25 * 60 * 1000);
    child.provider = provider;
    if (p) (p.procs ||= new Set()).add(child);
    allProcs.add(child);
    child.stdin.end(viaStdin ? full : undefined);   // Antigravity'de stdin açık kalırsa takılıyor (antigravity-cli#76)
    logEv(p, agentId, 'task', `${PROVIDERS[provider].label} ile çalışıyor (kendi sandbox'ında; ofis onay kutusu devre dışı)`);
    child.stderr.on('data', d => err += d);
    child.stdout.on('data', d => {
      out += d; let i;
      while ((i = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, i); out = out.slice(i + 1); if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        for (const e of parse(m, acc)) {
          if (e.kind === 'tool') { const t = activityText(e.name, e.input); status(agentId, 'working', t); emit('activity', { agent: agentId, text: t, tool: e.name, kind: toolKind(e.name) }); logEv(p, agentId, 'tool', t); }
          else if (e.kind === 'text') { if (e.text.trim()) logEv(p, agentId, 'text', e.text); }
          else logEv(p, agentId, e.kind, e.text);
        }
      }
    });
    child.on('error', e => { clearTimeout(kill); p?.procs?.delete(child); allProcs.delete(child); resolve({ text: `Hata: ${PROVIDERS[provider].label} başlatılamadı (${e.message})`, tin: 0, tout: 0, tcache: 0, error: e.message }); });
    child.on('close', code => {
      clearTimeout(kill); p?.procs?.delete(child); allProcs.delete(child);
      const body = acc.text.trim();
      let msg = acc.error || (code !== 0 ? (err.trim().split('\n').slice(-3).join(' ') || `çıkış kodu ${code}`) : null);
      if (child.userStop) msg = `${PROVIDERS[provider].label} bağlantısı kesildi`;
      if (provider === 'antigravity' && msg && /auth|login|sign.?in|credential|unauthenticated/i.test(msg)) { S.settings.providers.antigravity.loggedIn = false; S.settings.providers.antigravity.authFailed = true; checkProviders(); }
      if (!msg && !body) msg = provider === 'antigravity' ? 'Antigravity çıktı vermedi (giriş/kota sorunu ya da bilinen boş çıktı hatası: google-antigravity/antigravity-cli#76)' : 'Codex çıktı vermedi';
      resolve({ text: msg ? `Hata: ${cut(msg, 400)}` : body, tin: acc.tin, tout: acc.tout, tcache: acc.tcache, turns: acc.steps, subtype: msg ? 'error' : 'success', error: msg || undefined, userStop: !!child.userStop,
        limit: !!msg && /usage limit|rate limit|quota|resource_exhausted|429/i.test(msg) });
    });
  });
}

// phase: 'plan' (araştırma, salt-okunur) | 'work' (çalışma klasöründe üretim) | 'text' (araçsız kısa metin)
async function ask(p, agentId, prompt, { purpose = 'görev', phase = 'text', model, turns, cat, provider } = {}) {
  const a = S.agents[agentId];
  const dir = p ? wsDir(p) : WORK;
  const system = `Sen ${a.name}, bu sanal ofiste "${a.title}" rolündesin. Yanıtların kısa ve öz olsun; selamlama, özür, tekrar yok. ${S.settings.lang === 'en' ? 'Write in English.' : 'Türkçe yaz.'}\nYÖNERGE: ${a.directive}` +
    (phase !== 'text' ? (S.settings.lang === 'en' ? growthPromptEn : growthPrompt)(agentId, a, { work: phase === 'work' }) : '') +
    (phase !== 'text' && S.shared.prefs.length ? `\nKULLANICI TERCİHLERİ (hep uy):\n${S.shared.prefs.slice(-10).map(x => '- ' + x).join('\n')}` : '') +
    (phase === 'work' ? `\nÇalışma klasörün: ${dir} — üretilen tüm dosyaları buraya yaz. Yanıtında dosya içeriğini TEKRARLAMA; sadece ne yaptığını 5-8 satırda anlat.` : '') +
    (phase === 'plan' ? `\nBu aşamada hiçbir dosyayı değiştirme; sadece araştır ve planla.` : '') +
    (phase !== 'text' ? `\nGÜVENLİK: Sadece çalışma klasöründeki dosyalarla çalış. Kullanıcı izni olmadan bu klasörün dışındaki hiçbir dosyayı/klasörü okuma, yazma veya listeleme; gerekiyorsa izin iste. Paket kurmadan önce gerçekten gerekli mi düşün, yerleşik yolları tercih et.` : '');
  const cfg = phase === 'text' ? { tools: '', allow: [], turns: 1, mode: 'default', model: model || (agentId === 'ceo' ? a.model : 'haiku') }
    : phase === 'plan' ? { tools: `${READ},${WEB}`, allow: WEB.split(','), turns: turns || a.turns, mode: 'default', model: model || a.model }
    : { tools: a.tools, allow: a.tools.split(',').filter(t => /^(WebSearch|WebFetch)$/.test(t)), turns: turns || a.turns, mode: 'acceptEdits', model: model || a.model };
  // token bütçesi: dolduysa plan/iş çağrıları durur (ders çıkarma gibi kısa metin çağrıları açık kalır)
  if (p && p.budget && (p.spent || 0) >= p.budget && phase !== 'text') {
    if (!p.cancelled) { p.cancelled = true; post(p, 'ceo', 'user', `Token bütçesi doldu (${p.spent}/${p.budget}). Devam etmek için bütçeyi artırıp "Devam et"e bas.`, { budgetWarn: 1 }); emit('notify', { kind: 'budget', text: 'Token bütçesi doldu' }); }
    return { id: uid(), response: 'Hata: token bütçesi doldu', tin: 0, tout: 0, tcache: 0, ms: 0, error: 'budget', turns: 0, maxTurns: 0, subtype: 'budget' };
  }
  if (cliOff()) return { id: uid(), response: 'Hata: CLI bağlantısı kapalı', tin: 0, tout: 0, tcache: 0, ms: 0, error: 'CLI bağlantısı kapalı', turns: 0, maxTurns: 0, subtype: 'offline' };
  // hangi CLI? kısa metin çağrıları hep Claude; plan/iş çağrılarında ajan ayarı veya öğrenen yönlendirici seçer
  cat ||= categoryOf(agentId);
  const pick = phase === 'text' ? { provider: 'claude', why: 'kısa metin' } : provider ? { provider, why: 'zorunlu' } : chooseProvider(agentId, cat);
  const prov = pick.provider;
  if (prov === 'claude' && !liveMode() && !FORCE_DEMO) return { id: uid(), response: 'Hata: Claude Code bağlı değil', tin: 0, tout: 0, tcache: 0, ms: 0, error: CLAUDE ? 'Claude Code girişi yok (terminalde "claude auth login")' : 'Claude Code bulunamadı', turns: 0, maxTurns: 0, subtype: 'offline', provider: prov };
  if (prov !== 'claude' && !['ajan ayarı', 'zorunlu'].includes(pick.why)) logEv(p, agentId, 'task', `${PROVIDERS[prov].label} seçildi — ${pick.why}`);
  const t0 = Date.now(); status(agentId, 'working', purpose);
  const demo = FORCE_DEMO;
  const res = await gate(async () => demo ? (await new Promise(r => setTimeout(r, Number(process.env.OFIS_DEMO_MS) || 3500 + Math.random() * 2500)), mockRun({ system, prompt }))
    : prov === 'claude' ? runClaude({ agentId, p, prompt, system, cwd: dir, think: phase !== 'text' && a.think !== false, ...cfg })
    : runOther(prov, { agentId, p, prompt, system, phase, cwd: dir, think: a.think !== false }));
  if (prov !== 'claude') cfg.model = prov + (safeModel(S.settings.providers[prov]?.model) ? ':' + S.settings.providers[prov].model : '');
  status(agentId, res.error ? (res.limit ? 'limit' : 'error') : 'idle', res.error ? cut(res.error, 60) : '');
  if (res.error) logEv(p, agentId, 'error', res.error);
  const req = { id: uid(), ts: Date.now(), projectId: p?.id, agent: agentId, provider: prov, cat, why: pick.why, model: cfg.model, purpose, phase, system: cut(system, 4000), prompt: cut(prompt, 6000),
    userStop: res.userStop || undefined, response: cut(String(res.text || ''), 6000), tin: res.tin, tout: res.tout, tcache: res.tcache || 0, ms: Date.now() - t0, demo: !!res.demo, error: res.error, turns: res.turns, maxTurns: cfg.turns, subtype: res.subtype };
  S.requests.push(req); if (S.requests.length > 300) S.requests.splice(0, S.requests.length - 300);
  const now0 = new Date(), day = now0.getFullYear() + '-' + String(now0.getMonth() + 1).padStart(2, '0') + '-' + String(now0.getDate()).padStart(2, '0'), dd = (S.daily[day] ||= { runs: 0, tin: 0, tout: 0, tcache: 0 });
  dd.runs++; dd.tin += res.tin || 0; dd.tout += res.tout || 0; dd.tcache += res.tcache || 0;
  if (p) {
    p.spent = (p.spent || 0) + (res.tin || 0) + (res.tout || 0);
    if (p.budget && !p.warned && p.spent >= 0.8 * p.budget) { p.warned = true; post(p, 'ceo', 'user', `Token bütçesinin %80'i kullanıldı (${p.spent}/${p.budget}).`, { budgetWarn: 1 }); emit('notify', { kind: 'budget', text: 'Token bütçesinin %80\'i doldu' }); }
    emit('budget', { id: p.id, spent: p.spent, budget: p.budget || 0 });
  }
  save(); emit('request', reqMeta(req));
  return req;
}

// ---------- Orkestrasyon ----------
// Beklenen çıktı dosyaları çalışma klasöründe gerçekten var mı ve boş değil mi? (0..1, beklenen yoksa null)
function deliveryRatio(p, deliverable) {
  const exp = String(deliverable || '').split(/[,;]|\s+ve\s+/).map(x => x.trim()).filter(x => /\.[a-z0-9]{1,6}$/i.test(x));
  if (!exp.length) return null;
  const dir = wsDir(p), all = listFiles(dir);
  const ok = exp.filter(e => all.some(f => f.toLowerCase().endsWith(e.toLowerCase()) && fs.statSync(path.join(dir, f)).size > 0));
  return ok.length / exp.length;
}


async function runTask(p, t, brief, deps, done) {
  const roster = Object.keys(S.agents).filter(k => k !== t.agent).join('/');
  const isAudit = t.agent === 'auditor';
  const toReview = isAudit ? [...new Set(Object.values(done).map(d => d.agent))].filter(k => k !== 'auditor') : [];
  const base = `GÖREV: ${t.instruction}${t.deliverable ? `\nBEKLENEN ÇIKTI: ${t.deliverable}` : ''}\nPROJE TANIMI: ${cut(brief, 1200)}` + (p.notes ? `\nPROJE NOTLARI: ${cut(p.notes, 800)}` : '') +
    (deps.length ? '\nÖNCEKİ ÇIKTILAR (özet; ayrıntı için çalışma klasöründeki dosyalara bak):\n' + deps.map(d => `[${d.agent}:${S.agents[d.agent].title}] ${d.summary}`).join('\n') : '');
  const rubric = isAudit && toReview.length ? `\n\nKALİTE DEĞERLENDİRMESİ: Çalışma klasöründeki dosyaları OKU ve ajan özetlerini karşılaştır. Değerlendirilecek ajanlar: ${toReview.join(',')}\nHer ajan için 1-10 puan (1-3 kullanılamaz, 4-6 kısmen, 7-8 iyi, 9-10 kusursuz): "dogruluk" (hatasız/doğru mu), "tamlik" (istenenin tamamı var mı), "talimat" (göreve ve kullanıcı isteğine uyum). Somut kanıt göstermeden 8'in üstünü verme.\nYanıtının EN SON satırı SADECE şu JSON olsun: {"<ajan anahtarı>":{"dogruluk":n,"tamlik":n,"talimat":n,"not":"somut kanıt, en fazla 12 kelime"}}` : '';
  const tail = `\n\nSonda "---ÖZET---" yazıp 40 kelimelik özet ekle.` + rubric;
  const askLine = isAudit ? '' : `\nSORU_SERBEST: Sadece işini ENGELLEYEN bir bilgi eksiğin varsa hiçbir araç kullanmadan yanıtın TEK satır olsun: "SORU@<${roster}>: kısa soru". Aksi halde soru sorma, işi yap.`;
  const bt = (p.board || []).find(x => x.id === t.id); if (bt) { bt.status = 'çalışıyor'; bt.startedAt = Date.now(); save(); emit('project', p); }
  logEv(p, t.agent, 'task', 'Görev başladı: ' + cut(t.instruction, 110));
  const m = { agent: t.agent, deliverable: t.deliverable, turns: 0, maxTurns: 0, ms: 0, error: false, subtype: 'success', questions: 0, denials0: (p.denials || {})[t.agent] || 0 };
  const add = r => { m.turns += r.turns || 0; m.maxTurns += r.maxTurns || 0; m.ms += r.ms; if (r.error) m.error = true; if (r.subtype && r.subtype !== 'success') m.subtype = r.subtype; if (r.provider) m.provider = r.provider; };
  const cat = m.cat = categoryOf(t.agent, t.instruction, t.deliverable);
  let r = await ask(p, t.agent, base + askLine + tail, { purpose: cut(t.instruction, 40), phase: 'work', cat }); add(r);
  if (r.error && r.provider && r.provider !== 'claude' && r.subtype !== 'budget' && !p.cancelled && provUsable('claude')) {
    // başka CLI başarısız oldu: bunu öğren (düşük puan) ve görevi Claude Code ile bir kez daha dene
    if (!r.userStop) recordResult(S.routing, r.provider, cat, 1, { failed: true }); m.fallback = r.provider;
    post(p, t.agent, 'ceo', r.userStop ? `${PROVIDERS[r.provider].label} bağlantısı kesildi; göreve Claude Code ile devam ediyorum.` : `${PROVIDERS[r.provider].label} bu görevde hata verdi (${cut(r.error, 120)}). Claude Code ile yeniden deniyorum.`);
    m.error = false; m.subtype = 'success';
    r = await ask(p, t.agent, base + askLine + tail, { purpose: cut(t.instruction, 40), phase: 'work', cat, provider: 'claude' }); add(r);
  }
  if (bt) { bt.provider = m.provider; bt.cat = cat; }
  const q = r.response.match(/^SORU@(\w+):\s*(.+)$/m);
  if (q && S.agents[q[1].toLowerCase()] && q[1].toLowerCase() !== t.agent) {
    const to = q[1].toLowerCase(); m.questions++;
    post(p, t.agent, to, 'Soru: ' + q[2], { reqId: r.id });
    const a = await ask(p, to, `SORU/CEVAP_ISTEGI\n${S.agents[t.agent].title} sana soruyor (görev: ${cut(t.instruction, 150)}): ${q[2]}\nEn fazla 50 kelimeyle yanıtla.`, { purpose: 'soruya yanıt', phase: 'text', model: S.agents[to].model });
    post(p, to, t.agent, a.response, { reqId: a.id });
    r = await ask(p, t.agent, base + `\nSORU-CEVAP: ${q[2]} → ${cut(a.response, 400)}` + tail, { purpose: cut(t.instruction, 40), phase: 'work', cat, provider: m.provider }); add(r);
  }
  const sr = extractSelfReview(r.response); let text = sr.text;
  if (sr.review && !m.error) addLesson(S.agents[t.agent], sr.review, 'oz');
  if (isAudit) { const rb = rubricOf({ response: text }); if (rb) { text = rb.rest; for (const [k, v] of Object.entries(rb.json)) if (S.agents[k.toLowerCase()] && v && typeof v === 'object') (p.quality ||= {})[k.toLowerCase()] = v; } }
  const { body, summary } = splitSummary(text);
  m.denials = ((p.denials || {})[t.agent] || 0) - m.denials0; m.delivered = m.error ? 0 : deliveryRatio(p, t.deliverable);
  done[t.id] = { id: t.id, agent: t.agent, summary, body, metrics: m };
  if (bt && bt.status !== 'iptal') { bt.status = m.error ? 'hata' : 'bitti'; bt.endedAt = Date.now(); bt.summary = summary; bt.metrics = { ...m }; bt.turns = m.turns; save(); emit('project', p); }
  if (!m.error) status(t.agent, 'done', 'tamamlandı');
  logEv(p, t.agent, m.error ? 'error' : 'task', (m.error ? 'Görev hata ile bitti: ' : 'Görev tamamlandı: ') + cut(summary, 110));
  post(p, t.agent, 'ceo', body, { reqId: r.id, summary });
}

// Puan = Teslimat %40 + Kalite (denetçi rubriği) %35 + Verimlilik %15 + Uyum %10 (eksik ölçüt varsa ağırlıklar yeniden dağıtılır)
function scoreProject(p, done) {
  const lines = [];
  for (const d of Object.values(done)) {
    if (d.agent === 'auditor' || !d.metrics) continue;
    const { score, parts, note } = scoreTask(d.metrics, (p.quality || {})[d.agent]);
    const ag = S.agents[d.agent], lv0 = levelOf(ag).index;
    const why = Object.entries(parts).map(([k, v]) => `${k[0].toUpperCase() + k.slice(1)} ${v}`).join(' · ') + (note ? ` — ${note}` : '');
    ag.scores.push({ score, from: 'metrik', why, parts, project: p.name, ts: Date.now() }); ag.scores = ag.scores.slice(-60);
    (p.scores ||= []).push({ from: 'metrik', to: d.agent, score, why });
    const bt = (p.board || []).find(x => x.id === d.id); if (bt) bt.score = score;   // tasarruf hesabı: sadece kabul edilen işler
    if (d.metrics.provider && d.metrics.cat) recordResult(S.routing, d.metrics.provider, d.metrics.cat, score, { failed: !!d.metrics.error });   // hangi CLI bu tür işte ne kadar iyi
    for (const [src, l] of metricLessons(parts, d.metrics, (p.quality || {})[d.agent])) addLesson(ag, l, src);
    const lv = levelOf(ag); if (lv.index > lv0) post(p, d.agent, 'user', `Seviye atladım: ${lv.name}. (${lv.tasks} görev, ortalama ${lv.avg.toFixed(1)}/10)`, { levelUp: lv.key });
    lines.push(`${ag.name} (${d.agent}): ${score.toFixed(1)}/10 — ${why}`);
  }
  if (lines.length) post(p, 'ceo', 'user', 'Puan raporu (ölçülebilir metrikler)\n' + lines.join('\n'), { score: 1 });
}

// 1) Kullanıcı projeyi anlatır → CEO araştırır, plan çıkarır, onay ister
async function handleUser(p, text, { revise } = {}) {
  const roster = Object.entries(S.agents).filter(([k, a]) => k !== 'ceo' && !a.external).map(([k, a]) => `${k}=${a.title} (araçlar: ${a.tools})`).join('; ');
  if (!revise) post(p, 'user', 'ceo', text);
  const brief = revise ? p.brief : text; if (!revise) p.brief = [p.brief, text].filter(Boolean).join('\n').slice(-3000);
  const ctx = (p.summary ? `\nPROJENİN ŞU ANKİ DURUMU (önceki turlar): ${p.summary}` : '') + (p.notes ? `\nPROJE NOTLARI (kullanıcı): ${cut(p.notes, 800)}` : '');
  const files = listFiles(wsDir(p)); const fctx = files.length ? `\nÇALIŞMA KLASÖRÜNDEKİ DOSYALAR: ${files.slice(0, 25).join(', ')}` : '';
  const planReq = await ask(p, 'ceo', `PLAN_JSON\nKullanıcının proje tanımı/isteği: """${revise ? p.brief : text}"""${revise ? `\nKULLANICININ PLAN HAKKINDAKİ DÜZELTMESİ: """${revise}"""` : ''}${ctx}${fctx}\nEkip: ${roster}\n` +
    `Önce gerekiyorsa kısa bir araştırma yap (en fazla 3 web araması), sonra planı çıkar.\n` +
    `Yanıtın SADECE JSON olsun: {"reply":"kullanıcıya 2-3 cümle: neyi anladın, nasıl ilerleyeceksin","research":["en fazla 5 kısa bulgu"],"tasks":[{"id":"t1","agent":"<ekip anahtarı>","instruction":"net kısa görev","needs":["önceki görev id"],"deliverable":"çıktı dosyası adı"}],"needs_approval":["çalışırken izin isteyebilecek kurulum/indirme/komutlar, varsa"],"questions":["kritik eksik bilgi varsa en fazla 2 soru"]}\n` +
    `Kurallar: sadece gerçekten gereken ajanları kullan, en fazla 6 görev, bağımsız görevlerde needs boş olsun. 2 veya daha fazla görevli işlerde son görev olarak denetçiyi (auditor) ekle. Selamlaşma/soru ise tasks boş bırak ve reply'de cevap ver. Kritik bilgi eksikse tasks boş, questions dolu olsun.`,
    { purpose: 'araştırma ve plan', phase: 'plan' });
  let plan; try { plan = JSON.parse(planReq.response.match(/\{[\s\S]*\}/)[0]); } catch { plan = { reply: planReq.response, tasks: [] }; }
  const tasks = (plan.tasks || []).filter(t => S.agents[t.agent] && !S.agents[t.agent].external && t.agent !== 'ceo').slice(0, 6);
  const qs = (plan.questions || []).filter(Boolean);
  if (!tasks.length) { post(p, 'ceo', 'user', [plan.reply || 'Tamam.', ...qs.map(q => '• ' + q)].join('\n'), { reqId: planReq.id }); save(); emit('project', p); return; }
  p.pendingPlan = { id: uid(), tasks, research: (plan.research || []).slice(0, 5), needs: (plan.needs_approval || []).filter(Boolean), reply: plan.reply || '', questions: qs };
  post(p, 'ceo', 'user', plan.reply || 'Plan hazır.', { reqId: planReq.id, plan: p.pendingPlan });
  save(); emit('project', p);
}

// 2) Kullanıcı planı onaylayınca ajanlar işe koyulur
async function executePlan(p, { resume = false } = {}) {
  let tasks, done = {};
  if (resume) {
    const bd = p.board || []; if (!bd.length) return;
    for (const x of bd) if (x.status === 'bitti') done[x.id] = { agent: x.agent, summary: x.summary || '', body: '', metrics: x.metrics };
    for (const x of bd) if (x.status !== 'bitti') { x.status = 'bekliyor'; delete x.startedAt; delete x.endedAt; }
    tasks = bd.filter(x => x.status !== 'bitti').map(x => ({ id: x.id, agent: x.agent, instruction: x.instruction, needs: x.needs, deliverable: x.deliverable }));
    p.interrupted = false; p.cancelled = false;
  } else {
    const plan = p.pendingPlan; if (!plan) return; p.pendingPlan = null; tasks = plan.tasks;
    p.board = tasks.map(t => ({ id: t.id, agent: t.agent, instruction: t.instruction, deliverable: t.deliverable || '', needs: t.needs || [], status: 'bekliyor' }));
    p.runId = uid(); p.runStart = Date.now();
  }
  p.executing = true; save(); emit('project', p);
  const brief = p.brief; let pending = [...tasks];
  try {
    while (pending.length && !p.cancelled) {
      let ready = pending.filter(t => (t.needs || []).every(n => done[n] || !tasks.find(x => x.id === n)));
      if (!ready.length) ready = [pending[0]];
      pending = pending.filter(t => !ready.includes(t));
      await Promise.all(ready.map(async t => {
        const deps = (t.needs || []).map(n => done[n]).filter(Boolean);
        post(p, 'ceo', t.agent, t.instruction);
        for (const d of deps) post(p, d.agent, t.agent, `Çıktımın özeti: ${d.summary}`, { handoff: true });
        await runTask(p, t, brief, deps, done);
      }));
    }
    if (Object.keys(done).length && !p.cancelled) {
      // token harcamadan rapor: ajan özetleri + çıktı dosyaları
      scoreProject(p, done);
      const ds = Object.values(done);
      p.summary = cut(((p.summary || '') + ' ' + ds.map(d => d.summary).join(' ')).trim(), 900);
      p.participants = [...new Set([...(p.participants || []), ...ds.map(d => d.agent)])];
      const files = listFiles(wsDir(p));
      post(p, 'ceo', 'user', `${ds.length} görev tamamlandı.\n` + ds.map(d => `• ${S.agents[d.agent].name}: ${cut(d.summary, 160)}`).join('\n') + (files.length ? `\n\nÇıktı dosyaları (${files.length}):\n` + files.slice(0, 20).map(x => '• ' + x).join('\n') : ''));
    }
    p.tasksLog = [...(p.tasksLog || []), ...tasks.map(t => ({ agent: t.agent, instruction: t.instruction }))].slice(-30);
  } finally {
    p.executing = false; setTimeout(() => checkLimit().catch(() => {}), 1500);
    const snap = { id: p.runId, ts: p.runStart, end: Date.now(), tasks: (p.board || []).map(({ metrics, ...x }) => x) };
    p.runs = (p.runs || []).filter(r => r.id !== snap.id).concat(snap).slice(-20);
    const allDone = (p.board || []).every(x => x.status === 'bitti');
    if (allDone && !p.budgetStopped) emit('celebrate', { id: p.id });
    p.cancelled = false; save(); emit('project', p);
  }
}

function stopProject(p) {
  p.cancelled = true; p.pendingPlan = null;
  for (const x of p.board || []) if (x.status === 'bekliyor' || x.status === 'çalışıyor') x.status = 'iptal';
  for (const c of p.procs || []) try { c.kill(); } catch {}
  for (const a of [...approvals.values()]) if (a.projectId === p.id) a.settle('deny', false, 'Proje durduruldu.');
  post(p, 'user', 'ceo', 'Projeyi durdurdum.'); save(); emit('project', p);
}

async function finishProject(p, rating, note) {
  const fb = `Puan: ${rating}/5. Not: ${note || '-'}`;
  post(p, 'user', 'all', `Proje değerlendirmesi — ${fb}`);
  const ids = ['ceo', ...(p.participants || [])];
  for (const id of new Set(ids)) { const a = S.agents[id]; a.scores.push({ score: rating * 2, from: 'user', why: note || '', project: p.name, ts: Date.now() }); a.scores = a.scores.slice(-40); }
  for (const x of p.board || []) if (x.provider && x.cat && x.status === 'bitti') recordResult(S.routing, x.provider, x.cat, rating * 2, { w: 0.5 });   // senin puanın da CLI seçimine yarım ağırlıkla yansır
  const uniq = [...new Set(ids)];
  const info = uniq.map(id => {
    const got = (p.scores || []).filter(x => x.to === id).map(x => `${x.from}:${x.score}/10 ${x.why}`).join('; ');
    const mine = (p.tasksLog || []).filter(t => t.agent === id).map(t => t.instruction).join(' | ') || 'koordinasyon';
    return `${id} (${S.agents[id].title}): işi=${cut(mine, 200)}${got ? `; aldığı puanlar=${cut(got, 300)}` : ''}`;
  }).join('\n');
  const r = await ask(p, 'ceo', `DERS_YAZ\nProje: ${p.name}. Kullanıcı geri bildirimi → ${fb}\nAjanlar:\n${info}\nHer ajan için gelecek projelerde işe yarayacak EN FAZLA 2 kalıcı ders yaz (somut, bu kullanıcıya özgü, genel geçer laf yok). SADECE JSON: {"<ajan anahtarı>":["ders", "ders"],"kullanici":["bu kullanıcının kalıcı tercihi (varsa, en fazla 2, kısa)"]}`, { purpose: 'dersleri çıkar', phase: 'text', model: 'haiku' });
  let out = {}; try { out = JSON.parse(r.response.match(/\{[\s\S]*\}/)[0]); } catch {}
  for (const x of (Array.isArray(out.kullanici) ? out.kullanici : []).map(String).filter(x => x.length > 6).slice(0, 2)) if (!S.shared.prefs.includes(x)) S.shared.prefs.push(x);
  S.shared.prefs = S.shared.prefs.slice(-12);
  for (const id of uniq) {
    const lessons = (Array.isArray(out[id]) ? out[id] : []).map(String).filter(l => l.length > 8).slice(0, 2);
    const ag = S.agents[id];
    for (const l of lessons) addLesson(ag, l, 'kullanici');
    if (lessons.length) post(p, id, 'user', `Öğrendiklerim:\n${lessons.map(l => '• ' + l).join('\n')}`, { reqId: r.id });
  }
  p.finished = true; save(); emit('state', publicState());
}

async function setDirective(agentId, patch) {
  const a = S.agents[agentId]; const changed = patch.directive != null && patch.directive !== a.directive;
  for (const k of ['name', 'title', 'model', 'directive', 'tools']) if (patch[k] != null) a[k] = patch[k];
  if (patch.think != null) a.think = !!patch.think;
  if (AGENT_PROVIDERS.includes(patch.provider)) a.provider = patch.provider;
  if (patch.turns != null) a.turns = Math.max(1, Math.min(60, +patch.turns || a.turns));
  if (Array.isArray(patch.lessons)) a.lessons = patch.lessons.filter(l => l && typeof l.t === 'string').map(l => ({ t: String(l.t).slice(0, 180), src: String(l.src || 'kullanici'), w: +l.w || 1, n: +l.n || 1, ts: +l.ts || Date.now() })).slice(0, 24);
  save(); emit('state', publicState());
  if (changed) {
    const p = S.projects[S.projects.length - 1]; if (!p) return;
    const r = await ask(p, agentId, `YONERGE_ANLA\nYeni yönergen: """${a.directive}"""\nBunu kendi cümlelerinle en fazla 2 cümlede özetle, sonra yönergede belirsiz bulduğun TEK noktayı soru olarak yaz (yoksa "Net." de).`, { purpose: 'yönerge anlama', phase: 'text', model: a.model });
    post(p, agentId, 'user', r.response, { reqId: r.id });
  }
}

// ---------- Ajan ekleme/silme ----------
const PALETTE = ['#f59e0b', '#22c55e', '#06b6d4', '#f97316', '#e879f9', '#84cc16', '#38bdf8', '#fb7185'];
const PRESETS = { arastirma: `${READ},Write,${WEB}`, yazilim: `${READ},Write,Edit,Bash`, yazar: `${READ},Write,Edit`, tasarim: `${READ},Write,Edit,${WEB}`, denetim: READ };
function addAgent(b) {
  const name = String(b.name || '').trim().slice(0, 20), title = String(b.title || '').trim().slice(0, 30);
  if (!name || !title) throw new Error('Ad ve rol gerekli');
  if (Object.keys(S.agents).length >= 10) throw new Error('En fazla 9 ajan eklenebilir');
  let key = (slug(title).replace(/-/g, '') || 'ajan'); if (['user', 'all', 'kullanici'].includes(key)) key += 'x';
  let k = key, i = 2; while (S.agents[k]) k = key + i++;
  S.agents[k] = { name, title, color: PALETTE[(Object.keys(S.agents).length - 1) % PALETTE.length], model: ['opus', 'sonnet', 'haiku'].includes(b.model) ? b.model : 'haiku', turns: 10, think: false,
    provider: AGENT_PROVIDERS.includes(b.provider) ? b.provider : 'auto', tools: PRESETS[b.preset] || String(b.tools || READ), directive: String(b.directive || '').slice(0, 800) || 'Kısa ve net çalış. Çıktıları çalışma klasörüne yaz.', lessons: [], scores: [] };
  save(); emit('state', publicState()); return k;
}
function removeAgent(id) {
  if (id === 'ceo' || !S.agents[id]) throw new Error('Bu ajan silinemez');
  delete S.agents[id]; for (const p of S.projects) p.participants = (p.participants || []).filter(x => x !== id);
  save(); emit('state', publicState());
}

// ---------- Proje şablonları (araştırma ve plan için token harcamaz) ----------
function templatePlan(key) {
  const t = TEMPLATES[key]; if (!t) return null;
  const tasks = t.tasks.filter(x => S.agents[x.agent]).map(x => ({ ...x }));
  const ids = new Set(tasks.map(x => x.id)); for (const x of tasks) x.needs = x.needs.filter(n => ids.has(n));
  return tasks.length ? { id: uid(), tasks, research: [], needs: [], reply: `"${t.name}" şablonu hazır plan olarak yüklendi; araştırma ve planlama için token harcanmadı. Onaylarsan ekip başlayacak.`, questions: [] } : null;
}

// ---------- HTTP ----------
const strip = a => { const { settle, ...x } = a; return x; };
// tasarruf: tüm projelerin çalıştırma kayıtlarındaki biten görevler (bu ay ve tüm zamanlar)
function savingsState() {
  const now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime(), all = [];
  for (const p of S.projects) for (const r of p.runs || []) for (const t of r.tasks || []) all.push(t);
  const o = S.settings.baseMin || {};
  return { month: savingsOf(all.filter(t => (t.endedAt || 0) >= m0), o), all: savingsOf(all, o), minAccept: MIN_ACCEPT, since: m0 };
}
const reqMeta = ({ system, prompt, response, ...m }) => m;   // ağır metinler arayüze gönderilmez
const publicState = () => ({ agents: Object.fromEntries(Object.entries(S.agents).map(([k, a]) => [k, { ...a, level: levelOf(a), focus: focusOf(a), charter: charterFor(k, S.settings.lang), baseline: baselineOf(k, S.settings.baseMin || {}) }])), user: USER, projects: S.projects.map(({ procs, ...x }) => ({ ...x, own: !!x.dir && path.dirname(path.resolve(x.dir)).toLowerCase() === path.resolve(WORK).toLowerCase() })), requests: S.requests.map(reqMeta), parallel: parallel(), approvals: [...approvals.values()].map(strip),
  live: SHOWCASE ? { claude: true, info: 'bağlı', demo: false, off: false, available: true } : { claude: liveMode() && !cliOff(), info: claudeInfo.text, demo: !liveMode(), off: cliOff(), available: !!CLAUDE && !FORCE_DEMO },
  providers: PROVIDER_KEYS.map(k => ({ key: k, label: PROVIDERS[k].label, installed: SHOWCASE || (k === 'claude' ? !!CLAUDE : !!BINS[k]), ok: SHOWCASE || (k === 'claude' ? liveMode() : !!provInfo[k].ok), text: SHOWCASE ? 'bağlı' : k === 'claude' ? claudeInfo.text : provInfo[k].text, usable: provUsable(k), login: logins[k] ? { url: logins[k].url, text: logins[k].text, ts: logins[k].ts } : null, src: PRIOR_SRC[k], ...(k === 'claude' ? { on: true } : S.settings.providers[k]) })),
  routing: Object.fromEntries(Object.keys(CATEGORIES).map(c => [c, { label: CATEGORIES[c], est: Object.fromEntries(PROVIDER_KEYS.map(k => [k, estimate(S.routing, k, c)])) }])),
  shared: S.shared, daily: S.daily, limits: S.limits, savings: savingsState(), usage: S.usage || null, log: S.log.slice(-300), settings: S.settings, templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, name: t.name, hint: t.hint })) });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const body = req => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });
const json = (res, o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const fail = (p, e) => { post(p, 'ceo', 'user', 'Hata: ' + e.message); p.executing = false; emit('project', p); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const parts = url.pathname.split('/').filter(Boolean);
  try {
    // yerel güvenlik: sadece localhost Host/Origin kabul (başka sitelerden veya ağdan gelen istekleri reddet — DNS rebinding/CSRF)
    const okHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '');
    const okOrigin = !req.headers.origin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin);
    if (!okHost || !okOrigin) { res.writeHead(403); return res.end('yasak'); }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (parts[0] === 'api') {
      if (req.method === 'GET' && parts[1] === 'state') return json(res, publicState());
      if (req.method === 'GET' && parts[1] === 'requests' && parts[2]) { const r = S.requests.find(x => x.id === parts[2]); return r ? json(res, r) : json(res, { error: 'bulunamadı' }, 404); }
      if (req.method === 'POST' && parts[1] === 'approval') { const b = await body(req); return json(res, await requestApproval(b)); }   // approver.js'ten
      if (req.method === 'POST' && parts[1] === 'approvals' && parts[2] === 'bulk') { const b = await body(req); let n = 0; for (const a of [...approvals.values()]) if ((!b.risk || a.risk === b.risk) && (!b.project || a.projectId === b.project)) { a.settle(b.decision === 'allow' ? 'allow' : 'deny', false); n++; } return json(res, { ok: true, n }); }
      if (req.method === 'POST' && parts[1] === 'approvals' && approvals.has(parts[2])) { const b = await body(req); approvals.get(parts[2]).settle(b.decision === 'allow' ? 'allow' : 'deny', !!b.always); return json(res, { ok: true }); }
      if (req.method === 'POST' && parts[1] === 'pick-folder') return json(res, await pickFolder());
      if (req.method === 'POST' && parts[1] === 'projects' && !parts[2]) {
        const b = await body(req); const p = { id: uid(), name: String(b.name || 'Yeni Proje').slice(0, 60), ts: Date.now(), messages: [], summary: '', participants: [], tasksLog: [], allow: {} };
        if (b.dir) { try { p.dir = validateDir(b.dir); } catch (e) { return json(res, { error: e.message }, 400); } }
        wsDir(p); S.projects.push(p);
        const plan = b.template ? templatePlan(b.template) : null;
        if (plan && b.brief) { p.brief = String(b.brief).slice(0, 4000); post(p, 'user', 'ceo', p.brief); p.pendingPlan = plan; post(p, 'ceo', 'user', plan.reply, { plan }); }
        save(); emit('state', publicState()); return json(res, p);
      }
      const p = S.projects.find(x => x.id === parts[2]);
      if (req.method === 'POST' && parts[1] === 'projects' && p) {
        const b = await body(req);
        if (cliOff() && (parts[3] === 'message' || parts[3] === 'resume' || parts[3] === 'rerun' || (parts[3] === 'plan' && (b.action === 'approve' || b.action === 'revise')))) {   // bağlantı kesikken Claude işi başlatılmaz
          post(p, 'ceo', 'user', 'Claude Code CLI bağlantısı kapalı. Üstteki "Bağlan" düğmesine basıp tekrar dene.'); save(); emit('project', p);
          return json(res, { error: 'CLI bağlantısı kapalı' }, 409);
        }
        if (parts[3] === 'message') { json(res, { ok: true }); p.finished = false; p.pendingPlan = null; handleUser(p, String(b.text || '').slice(0, 6000)).catch(e => fail(p, e)); return; }
        if (parts[3] === 'plan') {
          json(res, { ok: true });
          if (b.action === 'approve') { post(p, 'user', 'ceo', 'Planı onaylıyorum.'); executePlan(p).catch(e => fail(p, e)); }
          else if (b.action === 'revise') { p.pendingPlan = null; post(p, 'user', 'ceo', 'Plan için düzeltme: ' + String(b.note || '')); handleUser(p, '', { revise: String(b.note || '') }).catch(e => fail(p, e)); }
          else { p.pendingPlan = null; post(p, 'user', 'ceo', 'Planı iptal ettim.'); save(); emit('project', p); }
          return;
        }
        if (parts[3] === 'folder') { if (p.executing) return json(res, { error: 'Ajanlar çalışırken klasör değiştirilemez' }, 400); try { p.dir = validateDir(b.dir); } catch (e) { return json(res, { error: e.message }, 400); } save(); emit('project', p); return json(res, { ok: true, dir: p.dir }); }
        if (parts[3] === 'notes') { p.notes = String(b.notes || '').slice(0, 1500); save(); emit('project', p); return json(res, { ok: true }); }
        if (parts[3] === 'resume') { json(res, { ok: true }); executePlan(p, { resume: true }).catch(e => fail(p, e)); return; }
        if (parts[3] === 'rerun') { const r = (p.runs || []).find(x => x.id === b.run); if (!r) return json(res, { error: 'çalıştırma bulunamadı' }, 404); p.pendingPlan = { id: uid(), tasks: r.tasks.map(({ id, agent, instruction, deliverable, needs }) => ({ id, agent, instruction, deliverable, needs })), research: [], needs: [], reply: 'Önceki çalıştırmanın planı yeniden yüklendi. Onaylarsan aynı görevler tekrar çalışır.', questions: [] }; post(p, 'ceo', 'user', p.pendingPlan.reply, { plan: p.pendingPlan }); save(); emit('project', p); return json(res, { ok: true }); }
        if (parts[3] === 'settings') { if (b.budget != null) { p.budget = Math.max(0, Math.round(+b.budget || 0)); p.warned = false; if (p.cancelled && !p.executing) p.cancelled = false; } if (b.autoLow != null) p.autoLow = !!b.autoLow; save(); emit('project', p); return json(res, { ok: true }); }
        if (parts[3] === 'delete') {   // projeyi sil: kayıtlar gider; çalışma klasörü SADECE uygulamanın kendi klasörüyse ve istenirse silinir
          if (p.executing) stopProject(p);
          for (const a of [...approvals.values()]) if (a.projectId === p.id) a.settle('deny', false, 'Proje silindi.');
          const dir = p.dir ? path.resolve(p.dir) : null, own = !!dir && path.dirname(dir).toLowerCase() === path.resolve(WORK).toLowerCase();
          S.projects = S.projects.filter(x => x !== p);
          S.requests = S.requests.filter(r => r.projectId !== p.id); S.log = S.log.filter(e => e.project !== p.id);
          for (const a of Object.values(S.agents)) a.scores = (a.scores || []).filter(x => x.project !== p.name || S.projects.some(q => q.name === p.name));
          let removed = false; if (b.files && own) { try { fs.rmSync(dir, { recursive: true, force: true }); removed = true; } catch {} }
          if (!S.projects.length) { const n = { id: uid(), name: 'Yeni proje', ts: Date.now(), messages: [], summary: '', participants: [], tasksLog: [], allow: {} }; wsDir(n); S.projects.push(n); }
          save(); emit('state', publicState()); return json(res, { ok: true, filesRemoved: removed, keptDir: own && !removed ? dir : (!own ? dir : null) });
        }
        if (parts[3] === 'stop') { stopProject(p); return json(res, { ok: true }); }
        if (parts[3] === 'finish') { json(res, { ok: true }); finishProject(p, b.rating || 3, b.note).catch(console.error); return; }
        if (parts[3] === 'open') { if (process.platform === 'win32') spawn('explorer', [wsDir(p)], { detached: true, stdio: 'ignore' }).unref(); return json(res, { ok: true, dir: wsDir(p) }); }
      }
      if (req.method === 'GET' && parts[1] === 'projects' && p && parts[3] === 'files') return json(res, { dir: wsDir(p), files: listFiles(wsDir(p)) });
      if (req.method === 'POST' && parts[1] === 'agents' && !parts[2]) { const b = await body(req); try { return json(res, { ok: true, key: addAgent(b) }); } catch (e) { return json(res, { error: e.message }, 400); } }
      if (req.method === 'POST' && parts[1] === 'agents' && parts[3] === 'delete') { try { removeAgent(parts[2]); return json(res, { ok: true }); } catch (e) { return json(res, { error: e.message }, 400); } }
      if (parts[1] === 'layout') {   // ofis düzeni (data/layout.json)
        const LF = path.join(DATA, 'layout.json');
        if (req.method === 'GET') { try { return json(res, { items: JSON.parse(fs.readFileSync(LF, 'utf8')) }); } catch { return json(res, { items: null }); } }
        const b = await body(req);
        if (b.items == null) { try { fs.unlinkSync(LF); } catch {} return json(res, { ok: true }); }
        const ok = Array.isArray(b.items) && b.items.length <= 200 && b.items.every(x => x && /^[A-Za-z0-9]+$/.test(String(x.m)) && fs.existsSync(path.join(__dir, 'public', 'assets', 'furniture', x.m + '.glb')) && Number.isFinite(+x.x) && Number.isFinite(+x.z));
        if (!ok) return json(res, { error: 'geçersiz düzen' }, 400);
        fs.writeFileSync(LF, JSON.stringify(b.items.map(x => ({ id: String(x.id).slice(0, 12), m: x.m, x: +x.x, z: +x.z, ry: +x.ry || 0, s: +x.s || 2.2, y: +x.y || 0 })))); return json(res, { ok: true });
      }
      if (req.method === 'POST' && parts[1] === 'providers' && ['codex', 'antigravity'].includes(parts[2])) {
        const b = await body(req);
        if (parts[3] === 'connect') return json(res, connectProvider(parts[2]));
        if (parts[3] === 'disconnect') return json(res, disconnectProvider(parts[2], !!b.logout));
        if (parts[3] === 'check') { checkProviders(); return json(res, { ok: true }); }
        if (parts[3] === 'open') { const u = logins[parts[2]]?.url; return json(res, u && openAuthUrl(u) ? { ok: true } : { error: "Açık bir giriş isteği yok; Bağlan'a yeniden bas" }); }
      }
      if (req.method === 'POST' && parts[1] === 'limits' && parts[2] === 'check') { const r = await checkLimit(); return json(res, { ...r, limits: S.limits }); }
      if (req.method === 'POST' && parts[1] === 'cli') {   // CLI bağlantısını aç/kapat
        const b = await body(req);
        if (b.on === false) {
          S.settings.cli = false;
          for (const p of S.projects) if (p.executing) { stopProject(p); post(p, 'ceo', 'user', 'Claude Code CLI bağlantısı kesildi; çalışan ajanlar durduruldu. Yeniden bağlanıp "Devam et" ile kaldığın yerden sürdürebilirsin.'); }
          for (const a of [...approvals.values()]) a.settle('deny', false, 'CLI bağlantısı kesildi.');
          for (const c of allProcs) try { c.kill(); } catch {}
          for (const id of Object.keys(S.agents)) status(id, 'idle');
        } else { S.settings.cli = true; checkAuth(); checkProviders(); }
        save(); emit('state', publicState()); return json(res, { ok: true, on: S.settings.cli !== false });
      }
      if (req.method === 'POST' && parts[1] === 'settings') { const b = await body(req); if (b.lang === 'tr' || b.lang === 'en') S.settings.lang = b.lang; if ([1, 2, 3].includes(+b.parallel)) S.settings.parallel = +b.parallel; if (b.providers && typeof b.providers === 'object') for (const k of ['codex', 'antigravity']) { const v = b.providers[k]; if (!v || typeof v !== 'object') continue; const c = S.settings.providers[k]; if (v.on != null) c.on = !!v.on; if (v.model != null) c.model = safeModel(v.model); if (k === 'antigravity' && v.trust != null) c.trust = !!v.trust; } if (b.resetRouting) S.routing = {}; for (const k of ['subUsd', 'hourTry', 'usdTry']) if (b[k] !== undefined) S.settings[k] = Math.max(0, +b[k] || 0) || null; if (b.baseMin && typeof b.baseMin === 'object') S.settings.baseMin = Object.fromEntries(Object.entries(b.baseMin).filter(([k, v]) => S.agents[k] && +v > 0).map(([k, v]) => [k, Math.min(2400, +v)])); save(); emit('state', publicState()); return json(res, { ok: true }); }
      if (req.method === 'POST' && parts[1] === 'event') {   // dış araçlar durum bildirebilir: {name, state: working|idle|blocked|done, note}
        if (process.env.OFIS_API_TOKEN && req.headers['x-ofis-token'] !== process.env.OFIS_API_TOKEN) return json(res, { error: 'token gerekli' }, 401);
        const b = await body(req); const name = String(b.name || '').trim().slice(0, 24); if (!name) return json(res, { error: 'name gerekli' }, 400);
        const key = 'ext_' + (slug(name).replace(/-/g, '') || 'dis'); let created = false;
        if (!S.agents[key]) { S.agents[key] = { name, title: name, color: PALETTE[Object.keys(S.agents).length % PALETTE.length], model: 'haiku', turns: 1, think: false, tools: '', directive: '', lessons: [], scores: [], external: true }; created = true; }
        S.agents[key].lastSeen = Date.now(); save(); if (created) emit('state', publicState());
        const st = { working: 'working', idle: 'idle', blocked: 'waiting', done: 'done', error: 'error' }[b.state] || 'working';
        status(key, st, String(b.note || '').slice(0, 60)); return json(res, { ok: true, agent: key });
      }
      if (req.method === 'POST' && parts[1] === 'memory') { const b = await body(req); if (Array.isArray(b.prefs)) S.shared.prefs = b.prefs.map(x => String(x).slice(0, 160)).filter(Boolean).slice(-12); save(); emit('state', publicState()); return json(res, { ok: true }); }
      if (req.method === 'POST' && parts[1] === 'agents' && S.agents[parts[2]]) {
        const b = await body(req); json(res, { ok: true }); setDirective(parts[2], b).catch(console.error); return;
      }
    }
    const f = path.join(__dir, 'public', url.pathname === '/' ? 'index.html' : url.pathname.replace(/\.\./g, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(f)); /* no-cache: güncellenen dosya hemen görünsün */ }
    res.writeHead(404); res.end('yok');
  } catch (e) { json(res, { error: e.message }, 500); }
}).on('error', e => { if (e.code === 'EADDRINUSE') console.log('Sunucu zaten çalışıyor; mevcut oturuma bağlanılıyor.'); else throw e; }).listen(PORT, '127.0.0.1', () => {
  console.log(`Ofis hazır → http://localhost:${PORT}  (Claude Code: ${CLAUDE ? CLAUDE : 'bulunamadı'}${FORCE_DEMO ? ', test modu' : ''})`);
  if (!SHOWCASE) { checkAuth(); checkProviders(); }
});

