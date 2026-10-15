// LIVAND — Sanal Ofis: bilgisayarındaki Claude Code'u (aboneliğin) çoklu ajan + arayüzle yöneten yerel sunucu.
// API anahtarı gerekmez: her ajan `claude -p` ile ayrı bir Claude Code süreci olarak çalışır.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pickSkills, skillsPrompt, skillsOf, cleanCustomSkill } from './lib/skills.mjs';
import { CAPABILITIES, catalogPrompt, capsForTask, capabilityPrompt, capTools } from './lib/capabilities.mjs';
import { checkWorkspace, checksText, walk } from './lib/checks.mjs';
import { productize, reviewersFor, findingsOf, decisionsListOf, triageOf, stripSections } from './lib/orchestra.mjs';
import { createRequire } from 'node:module';
import { growthPrompt, growthPromptEn, migrateAgent, addLesson, metricLessons, extractSelfReview, levelOf, focusOf, charterFor, baselineOf, savingsOf, MIN_ACCEPT } from './lib/growth.mjs';
import { PROVIDERS, PROVIDER_KEYS, AGENT_PROVIDERS, CATEGORIES, PRIOR_SRC, categoryOf, recordResult, estimate, pickProvider, parseCodexLine, parseAgyLine, newAcc, shellQuote, safeModel, providerFits, cliGuide } from './lib/providers.mjs';
import { parseUsage, parseReset, cut, validateDir, PATH_RE, norm, insideWs, outsidePaths, SENSITIVE, SAFE_SEG, isSafeReadOnly, DANGER, INSTALL, POP_NPM, POP_PY, lev, typoOf, ageText, fmtN, verdict, parseInstalls, npmSpec, classify, splitSummary, rubricOf, reviewOf, fixesOf, critiqueOf, repliesOf, decisionsOf, criteriaOf, acceptOf, W, scoreTask, TEMPLATES } from './lib/policy.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.OFIS_DATA ? path.resolve(process.env.OFIS_DATA) : path.join(__dir, 'data');   // testler ayrı bir veri klasörü kullanır
const STATE_FILE = path.join(DATA, 'state.json');
const WORK = path.join(DATA, 'workspaces');
fs.mkdirSync(WORK, { recursive: true });
const PORT = Number(process.env.PORT || 3000);
const PARALLEL = Number(process.env.OFIS_PARALLEL || 2);   // CLI başına aynı anda çalışan süreç (abonelik limitini korur)

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
function chooseProvider(agentId, cat, need = {}) {
  const pref = S.hats[agentId]?.provider || 'auto', fit = k => k === 'claude' ? { ok: true } : providerFits(k, need, S.settings.providers?.[k] || {});
  const usable = PROVIDER_KEYS.filter(k => provUsable(k) && fit(k).ok);
  if (pref !== 'auto' && pref !== 'claude' && provUsable(pref) && !fit(pref).ok) return { provider: 'claude', why: `${fit(pref).why} → bu görev Claude Code ile çalışıldı` };
  if (pref !== 'auto') return usable.includes(pref) || pref === 'claude' ? { provider: pref, why: 'ajan ayarı' } : { provider: 'claude', why: `${PROVIDERS[pref].label} kullanılamıyor, Claude Code ile çalışıldı` };
  return pickProvider(S.routing, cat, usable) || { provider: 'claude', why: 'kullanılabilir başka CLI yok' };
}
// ---------- Ofis: lider, üyeler, görev ataması ----------
const officeOf = p => S.offices.find(o => o.id === p?.officeId) || S.offices[0];
const membersOf = p => { const m = officeOf(p).members.filter(provUsable); return m.length ? m : ['claude']; };   // şu an çalışabilen üyeler (en az Claude)
const leadOf = p => { const o = officeOf(p); return provUsable(o.lead) ? o.lead : membersOf(p)[0]; };
// görevi kim yapar: liderin seçtiği üye → şapkanın sabit tercihi → "kim neyde iyi" tablosu (yalnızca bu ofisin üyeleri arasından)
function assignCli(p, t) {
  if (t.agent === 'ceo') return leadOf(p);
  const mem = membersOf(p), cat = categoryOf(t.agent, t.instruction, t.deliverable);
  const need = { web: cat === 'arastirma' && /WebSearch|WebFetch/.test(S.hats[t.agent]?.tools || ''), bash: capTools(t.caps || []).includes('Bash') };
  const fits = k => k === 'claude' || providerFits(k, need, S.settings.providers?.[k] || {}).ok;
  if (t.cli && mem.includes(t.cli) && fits(t.cli)) return t.cli;
  const pref = S.hats[t.agent]?.provider;
  if (pref && pref !== 'auto' && mem.includes(pref) && fits(pref)) return pref;
  return pickProvider(S.routing, cat, mem.filter(fits))?.provider || mem.find(fits) || 'claude';
}
// mesaj/günlük için: şapka anahtarını o şapkayı takan ajana (CLI) çevirir
const cliOf = (p, k) => S.agents[k] ? k : k === 'ceo' ? leadOf(p) : p?.team?.[k];

// ---------- Ajanlar ve şapkalar ----------
// Ajan = CLI (Claude Code, Codex, Antigravity). Şapka = işin rolü (lider, yazılımcı, tasarımcı, araştırmacı, yazar, denetçi):
// yönergesi, araçları, becerileri ve dersleri vardır; proje başına ekip lideri hangi ajanın hangi şapkayı takacağına karar verir.
const READ = 'Read,Glob,Grep', WEB = 'WebSearch,WebFetch', SELF_SHOT = 'mcp__ofis__screenshot';   // SELF_SHOT: approver.js'teki ekran görüntüsü aracı (onaysız)
const ASSET_TOOL = path.join(__dir, 'tools', 'assets.mjs');   // ajanların görsel/asset aracı (onay beklemeden çalışır)
const SHOT_TOOL = path.join(__dir, 'tools', 'shot.cjs'), SHOTS = path.join(DATA, 'shots');
const SNAPS = path.join(DATA, 'snaps'), SNAP_MAX_BYTES = 50 * 1024 * 1024, SNAP_KEEP = 20;   // görev başına anlık görüntüler (geri alma)   // görsel doğrulama: ekran görüntüleri uygulamanın veri klasöründe
let ELECTRON = null; try { const e = createRequire(import.meta.url)('electron'); if (typeof e === 'string' && fs.existsSync(e)) ELECTRON = e; } catch {}
const DEFAULT_HATS = {
  ceo:        { name: 'Defne', title: 'Ekip lideri', color: '#e0a526', model: 'sonnet', turns: 10, think: true, tools: `${READ},${WEB}`,
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
const DEFAULT_CREW = {
  claude:      { name: 'Claude', color: '#d97757', model: 'sonnet' },
  codex:       { name: 'Codex', color: '#10a37f' },
  antigravity: { name: 'Antigravity', color: '#4285f4' },
};
const USER = { name: 'Sen', color: '#25d366' };

// ---------- Durum ----------
let S = { hats: DEFAULT_HATS, agents: {}, projects: [], requests: [] };
try { S = { ...S, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
// göç: eski sürümde S.agents rol ajanlarıydı → şapkalar olur (dersleri, becerileri, yönergeleri korunur); dış araç ajanları ayrılır
if (S.agents && !S.agents.claude && Object.values(S.agents).some(a => a && a.directive !== undefined)) {
  S.hats = Object.fromEntries(Object.entries(S.agents).filter(([, a]) => !a.external));
  S.ext = Object.fromEntries(Object.entries(S.agents).filter(([, a]) => a.external));
  S.agents = {};
  if (S.hats.ceo?.title === 'CEO / Proje Yöneticisi') S.hats.ceo.title = 'Ekip lideri';
}
S.ext ||= {};
for (const [k, v] of Object.entries(DEFAULT_CREW)) { const a = S.agents[k] ||= { ...v }; a.scores ||= []; a.lessons ||= []; a.name ||= v.name; a.color ||= v.color; }
for (const k of Object.keys(S.agents)) if (!DEFAULT_CREW[k]) delete S.agents[k];
if (!['sonnet', 'opus', 'haiku', 'fable'].includes(S.agents.claude.model)) S.agents.claude.model = 'sonnet';
// ofisler: her ofisin bir lideri ve üyeleri (CLI'ler) vardır; projeler bir ofise bağlıdır
S.offices ||= [{ id: 'ana', name: 'Ana ofis', lead: 'claude', members: Object.keys(DEFAULT_CREW), ts: Date.now() }];
for (const o of S.offices) { o.members = (o.members || []).filter(k => DEFAULT_CREW[k]); if (!o.members.length) o.members = ['claude']; if (!o.members.includes(o.lead)) o.lead = o.members[0]; }
for (const p of S.projects || []) if (!S.offices.some(o => o.id === p.officeId)) p.officeId = S.offices[0].id;
S.shared ||= { prefs: [] };
S.daily ||= {}; S.log ||= []; S.limits ||= {}; S.settings ||= { lang: 'tr' };
for (const d of Object.values(S.daily)) delete d.cost; for (const r of S.requests || []) delete r.cost;   // eski kayıtlardaki API fiyatı alanları
S.routing ||= {};   // öğrenilen: hangi CLI hangi iş türünde ne puan aldı
S.settings.providers ||= {}; S.settings.providers.codex ||= { on: false, model: '' }; S.settings.providers.antigravity ||= { on: false, model: '', trust: false };
for (const [k, v] of Object.entries(DEFAULT_HATS)) S.hats[k] ||= v;
for (const a of Object.values(S.hats)) {
  a.scores ||= []; migrateAgent(a); delete a.memory;
  if (!['sonnet', 'opus', 'haiku', 'fable'].includes(a.model) && !/^claude-/.test(a.model || '')) a.model = 'sonnet';   // eski kayıtlardaki geçersiz model adlarını temizle
  if (/^claude-(sonnet|opus|haiku)/.test(a.model)) a.model = a.model.match(/sonnet|opus|haiku/)[0];
  if (!AGENT_PROVIDERS.includes(a.provider) || !S.settings.autoV1) a.provider = 'auto';
  a.turns ||= 12; a.tools ||= READ; if (a.think === undefined) a.think = DEFAULT_HATS[Object.keys(S.hats).find(k => S.hats[k] === a)]?.think ?? false; delete a.maxTokens;
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
// from/to şapka (ceo, developer…), ajan (claude…) ya da user/all olabilir; şapkadan gelen mesaja o şapkayı takan ajan (cli) eklenir
function post(p, from, to, text, extra = {}) {
  const msg = { id: uid(), ts: Date.now(), from, to, text, ...extra };
  if (S.hats[from] && !msg.cli) { const c = cliOf(p, from); if (c) msg.cli = c; }
  p.messages.push(msg); save(); emit('message', { projectId: p.id, msg }); return msg;
}
const status = (agent, state, note = '', hat) => emit('status', { agent, state, note, hat });
const toolKind = n => /^(Read|Glob|Grep)$/.test(n) ? 'read' : /^(WebSearch|WebFetch)$/.test(n) ? 'search' : /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(n) ? 'write' : n === 'Bash' ? 'run' : /^(Task|Agent)$/.test(n) ? 'delegate' : 'think';
function logEv(p, agent, kind, text) {
  const hat = S.hats[agent] ? agent : undefined; if (hat) agent = cliOf(p, hat) || hat;   // günlük ajan (CLI) bazında; şapka ayrıca tutulur
  const e = { ts: Date.now(), agent, hat, project: p?.id, kind, text: cut(String(text || '').replace(/\s+/g, ' '), 300) };
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
// CLI başına ayrı kapı: her CLI kendi aboneliğiyle çalışır; ofisler paralel yürür, bir CLI'nin sınırı dolunca o CLI'nin işleri sıraya girer
const running = {}, waiters = {};
const parallel = () => Math.min(3, Math.max(1, Number(S.settings?.parallel) || PARALLEL));
const gate = async (k, fn) => {
  const q = waiters[k] ||= [];
  if ((running[k] || 0) >= parallel()) await new Promise(r => q.push(r));
  running[k] = (running[k] || 0) + 1;
  try { return await fn(); } finally { running[k]--; q.shift()?.(); }
};

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
  const cl = classify(tool_name, input, ws, [ASSET_TOOL, SHOTS]);
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
const DEMO_REVIEW = process.env.OFIS_DEMO_REVIEW === 'revize';   // testler: akran incelemesi öneri versin, denetçi düzeltme istesin
function mockRun({ system, prompt }) {
  const name = (system.match(/Sen ([^,\s]+)/) || [])[1] || 'Ajan';
  let text;
  if (/PLAN_JSON/.test(prompt) && /PROJE TÜRÜ: Oyun/.test(prompt)) {
    text = JSON.stringify({ reply: 'Bir oyun istiyorsun: önce tasarım belgesi ve asset listesi, sonra assetler ile oyun kodu paralel yürüyecek. (DEMO modu)', vizyon: { amac: 'Kısa, eğlenceli bir tarayıcı oyunu (demo)', kitle: 'Herkes (demo)', basari: 'Klavye ve dokunmatikle oynanır, skor tutar (demo)', kapsam: 'Tek seviye (demo)' }, kabul: [{ id: 'K1', olcut: 'Oyun klavyeyle oynanır (demo)' }, { id: 'K2', olcut: 'Tüm görseller atlasla yüklenir (demo)' }], research: [],
      tasks: [
        { id: 't1', agent: 'designer', instruction: 'Oyun tasarım belgesi ve asset listesi yaz.', needs: [], deliverable: 'oyun-tasarimi.md' },
        { id: 't2', agent: 'designer', instruction: 'Asset listesindeki karakter ve nesneleri piksel sanatı olarak üret, atlas oluştur.', needs: ['t1'], deliverable: 'assets/atlas.png', yetenekler: ['asset-hatti', 'svg-cizim'], kriterler: ['K2'] },
        { id: 't3', agent: 'developer', instruction: 'Canvas ile oyun kodunu yaz, assetleri atlas.json ile yükle.', needs: ['t1'], deliverable: 'index.html, game.js', yetenekler: ['calistir-dogrula'], kriterler: ['K1', 'K2'] },
        { id: 't4', agent: 'auditor', instruction: 'Oynanabilirliği denetle.', needs: ['t2', 't3'], deliverable: '' }],
      needs_approval: [], questions: [] });
  } else if (/PLAN_JSON/.test(prompt)) {
    text = JSON.stringify({ reply: 'Projeyi anladım. Önce kısa bir araştırma yapıp tasarım ve kodlama için görev dağılımı çıkardım. (DEMO modu)', vizyon: { amac: 'Ziyaretçinin aradığını hızla bulması (demo)', kitle: 'Yerel müşteriler (demo)', basari: 'Ziyaretçi 3 tıkta iletişime geçebilir (demo)', kapsam: 'Tek sayfa site; ödeme yok (demo)' }, kabul: [{ id: 'K1', olcut: 'Ana sayfa mobilde düzgün görünür (demo)' }, { id: 'K2', olcut: 'İletişim bilgisi tek tıkla ulaşılabilir (demo)' }], research: ['Benzer sitelerde tek sayfalık yapı öne çıkıyor (demo)', 'Mobil öncelikli tasarım öneriliyor (demo)'],
      tasks: [
        { id: 't1', agent: 'researcher', instruction: 'Konuyu kısaca araştır, 5 madde.', needs: [], deliverable: 'arastirma.md' },
        { id: 't2', agent: 'designer', instruction: 'Arayüz yapısını öner.', needs: [], deliverable: 'tasarim.md' },
        { id: 't3', agent: 'developer', instruction: 'Araştırma ve tasarıma göre ilk sürüm kodunu yaz.', needs: ['t1', 't2'], deliverable: 'index.html', kriterler: ['K1', 'K2'] },
        { id: 't4', agent: 'auditor', instruction: 'Çıktıyı isteğe göre denetle.', needs: ['t3'], deliverable: '' }],
      needs_approval: ['Gerekirse npm paket kurulumu (demo)'], questions: [] });
  } else if (/DERS_YAZ/.test(prompt)) text = JSON.stringify(Object.fromEntries((prompt.match(/^(\w+) \(/gm) || []).map(k => [k.replace(/ \($/, ''), ['Çıktıyı kısa tut ve önce sonucu yaz.', 'Kullanıcı net örnek verince daha iyi sonuç çıkıyor.']]).concat([['kullanici', ['Kısa ve net yanıtlardan hoşlanıyor.']]])));
  else if (/YONERGE_ANLA/.test(prompt)) text = 'Yönergeyi şöyle anladım: verilen kurallara kısa ve net çıktılarla uyacağım. (DEMO) Netleştirmek istediğim: öncelik hız mı kalite mi?';
  else if (/EKIP_DEGERLENDIRME/.test(prompt)) {
    const others = [...prompt.matchAll(/^\[(\w+):/gm)].map(m => m[1]).filter(k => !system.includes(`"${S.hats[k]?.title}"`));
    text = 'Ürünü baştan sona okudum (demo).\n' + JSON.stringify(DEMO_REVIEW && others[0]
      ? { olmus: ['Bölümler birbirini tamamlıyor (demo)'], olmamis: [{ sahip: others[0], konu: 'Giriş bölümü vizyonla çelişiyor (demo)', oneri: 'Hedef kitleye göre yeniden yaz (demo)' }], olabilir: [{ sahip: others[0], oneri: 'Kısa bir özet kutusu ekle (demo)' }] }
      : { olmus: ['Ürün amaca hizmet ediyor (demo)'], olmamis: [], olabilir: [] });
  }
  else if (/ELESTIRI_YANIT/.test(prompt)) { const nos = [...prompt.matchAll(/^(\d+)\. \[/gm)].map(m => +m[1]); text = JSON.stringify({ yanitlar: nos.map((no, i) => ({ no, karar: i === nos.length - 1 && nos.length > 1 ? 'katilmiyorum' : 'katiliyorum', not: i === nos.length - 1 && nos.length > 1 ? 'kapsam dışı (demo)' : 'haklı, düzeltirim (demo)' })) }); }
  else if (/TOPLANTI_KARAR/.test(prompt)) {
    const its = [...prompt.matchAll(/^(\d+)\. \[(\w+) → (\w+)\][^|\n]*(?:\| yanıt: (\w+))?/gm)];
    text = JSON.stringify({ ozet: 'Ekibin önerilerini tarttım (demo).', kararlar: its.filter(m => m[4] !== 'katilmiyorum').map(m => ({ sahip: m[3], is: `Madde ${m[1]} uygulanacak (demo)` })), reddedilen: its.filter(m => m[4] === 'katilmiyorum').map(m => ({ no: +m[1], neden: 'gerekçe ikna edici (demo)' })) });
  }
  else if (/AKRAN_INCELEME/.test(prompt)) text = 'Dosyaları okudum (demo).\n' + JSON.stringify(DEMO_REVIEW ? { karar: 'revize', guclu: 'yapı net (demo)', oneriler: ['Başlıkları daha açıklayıcı yap (demo)', 'Eksik bölümü tamamla (demo)'] } : { karar: 'onay', guclu: 'demo onay', oneriler: [] });
  else if (/KALİTE DEĞERLENDİRMESİ/.test(prompt)) {
    const ag = ((prompt.match(/Değerlendirilecek ajanlar: ([\w,]+)/) || [])[1] || '').split(',').filter(Boolean);
    const j = Object.fromEntries(ag.map(k => [k, { dogruluk: 7 + Math.floor(Math.random() * 3), tamlik: 6 + Math.floor(Math.random() * 4), talimat: 7 + Math.floor(Math.random() * 3), not: 'demo değerlendirme' }]));
    j.duzeltmeler = DEMO_REVIEW && !/YENİDEN DENETİM/.test(prompt) && ag[0] ? [{ ajan: ag[0], is: 'Kritik eksik bölümü ekle (demo)' }] : [];
    const ks = [...prompt.matchAll(/^- (K\d+): /gm)].map(m => m[1]); if (ks.length) j.kabul = Object.fromEntries(ks.map((k, i) => [k, DEMO_REVIEW && i === 0 && !/YENİDEN DENETİM/.test(prompt) ? 'kaldi — demo eksik' : 'gecti — demo kanıt']));
    text = 'Dosyaları inceledim (demo).\n' + JSON.stringify(j);
  }
  else if (/GERI_BILDIRIM_TRIYAJ/.test(prompt)) { const nos = [...prompt.matchAll(/^(\d+)\. \[/gm)].map(m => +m[1]); text = `Geri bildirimi süzdüm (demo).\n---TRİYAJ---\n${nos.map((n, i) => i === nos.length - 1 && nos.length > 1 ? `${n}: reddedildi — kapsam dışı (demo)` : `${n}: uygulandı — düzelttim (demo)`).join('\n')}\n---ÖZ--- Geri bildirimi daha erken iste\n---ÖZET---\n${name} geri bildirimi uyguladı (demo).`; }
  else if (/YAPIMCI_GOREVI/.test(prompt)) text = `Ürünü baştan sona yazdım (demo).\n---KARARLAR---\n- Palet: lacivert ve turuncu (demo)\n- Yazı tipi: sistem yazı tipleri (demo)\n- Tek sayfa, bölümler anchor ile (demo)\n---ÖZ--- Kararları daha erken yaz\n---ÖZET---\n${name} ürünü yaptı (demo).`;
  else if (/GOZDEN_GECIRME/.test(prompt)) {
    const first = /\(tur 1\)/.test(prompt), ks = [...prompt.matchAll(/^- (K\d+): /gm)].map(m => m[1]), audit = /"kabul"/.test(prompt);
    const j = { olmus: ['Bütünlüklü görünüyor (demo)'], bulgular: DEMO_REVIEW && first ? [{ onem: 'kritik', konu: 'Başlık hiyerarşisi zayıf (demo)', oneri: 'H1 büyüt (demo)' }, { onem: 'kucuk', konu: 'Boşluklar (demo)', oneri: '8px ızgara (demo)' }] : [] };
    if (audit) { j.kabul = Object.fromEntries(ks.map((k, i) => [k, DEMO_REVIEW && first && i === 0 ? 'kaldi — demo eksik' : 'gecti — demo kanıt'])); j.puan = { dogruluk: 8, tamlik: 8, talimat: 8, not: 'demo' }; }
    text = 'Ürüne baktım (demo).\n' + JSON.stringify(j);
  }
  else if (/SORU_SERBEST/.test(prompt) && /"Yazılımcı" şapkası/.test(system) && !/SORU-CEVAP/.test(prompt)) text = 'SORU@designer: Ana renk paleti hangisi olsun?';
  else if (/SORU\/CEVAP_ISTEGI/.test(prompt)) text = 'Sıcak kahve tonları (#6b4226, #f5e6d3) öneriyorum.';
  else {
    text = `[Test yanıtı — ${name}]\nİstediğin işi çalışma klasöründe yaptım (test modu, gerçek Claude Code çalışmadı).\n---ÖZ--- Teslimden önce dosyaları tek tek kontrol edeceğim\n---ÖZET---\n${name} kendi bölümünü tamamladı (test).`;
  }
  return { text, tin: Math.ceil((system.length + prompt.length) / 4), tout: Math.ceil(text.length / 4), tcache: 0, demo: true, turns: 2 + Math.floor(Math.random() * 5), subtype: 'success' };
}

// test modu: gerçek CLI yerine bekler; iş aşamasında bir stajyer (alt ajan) açıp kapatır ki ofiste görünsün
async function demoWait(prov, phase) {
  const ms = Number(process.env.OFIS_DEMO_MS) || 3500 + Math.random() * 2500, id = phase === 'work' ? 'demo-' + uid() : null;
  if (id) emit('sub', { agent: prov, id, on: true, text: 'Dosyaları tarıyor' });
  await new Promise(r => setTimeout(r, ms));
  if (id) emit('sub', { agent: prov, id, on: false });
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
    const full = `${system}${cliGuide(provider, { phase, trust: !!cfg.trust })}\n\n---\n${prompt}`;
    let args, viaStdin = false;
    if (provider === 'codex') {   // https://developers.openai.com/codex/noninteractive
      args = ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-C', cwd, '-s', phase === 'work' ? 'workspace-write' : 'read-only', '-c', 'approval_policy=never'];
      if (model) args.push('-m', model);
      if (!think) args.push('-c', 'model_reasoning_effort=low');
      // ekran görüntüsü aracı: ofisin MCP sunucusu yalnızca bu çalıştırma için (-c), kullanıcının ~/.codex ayarı değişmez; onay aracı gizlenir
      const env = { OFIS_URL: `http://127.0.0.1:${PORT}`, OFIS_AGENT: 'codex', OFIS_PROJECT: p?.id || '', OFIS_ONLY_SHOT: '1', ELECTRON_RUN_AS_NODE: '1' };
      args.push('-c', `mcp_servers.ofis.command=${JSON.stringify(process.execPath)}`, '-c', `mcp_servers.ofis.args=${JSON.stringify([path.join(__dir, 'approver.js')])}`,
        '-c', `mcp_servers.ofis.env={${Object.entries(env).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',')}}`, '-c', 'mcp_servers.ofis.tools.screenshot.approval_mode="approve"');
      // Windows: yönetici kurulumu olmadan sandbox (aksi halde salt okunur/çalışma modunda tüm kabuk komutları "blocked by policy" ile reddediliyor ve Codex dosya okuyamıyor)
      if (process.platform === 'win32') args.push('-c', 'windows.sandbox="unelevated"');
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
async function ask(p, agentId, prompt, { purpose = 'görev', phase = 'text', model, turns, cat, provider, extraTools = [] } = {}) {
  const a = S.hats[agentId];   // şapka: yönerge, araçlar, beceriler, dersler
  const dir = p ? wsDir(p) : WORK;
  const tools = phase === 'text' ? '' : phase === 'plan' ? `${READ},${WEB}` : [...new Set([...a.tools.split(','), ...extraTools])].filter(Boolean).join(',');
  // token bütçesi: dolduysa plan/iş çağrıları durur (ders çıkarma gibi kısa metin çağrıları açık kalır)
  if (p && p.budget && (p.spent || 0) >= p.budget && phase !== 'text') {
    if (!p.cancelled) { p.cancelled = true; post(p, 'ceo', 'user', `Token bütçesi doldu (${p.spent}/${p.budget}). Devam etmek için bütçeyi artırıp "Devam et"e bas.`, { budgetWarn: 1 }); emit('notify', { kind: 'budget', text: 'Token bütçesi doldu' }); }
    return { id: uid(), response: 'Hata: token bütçesi doldu', tin: 0, tout: 0, tcache: 0, ms: 0, error: 'budget', turns: 0, maxTurns: 0, subtype: 'budget' };
  }
  if (cliOff()) return { id: uid(), response: 'Hata: CLI bağlantısı kapalı', tin: 0, tout: 0, tcache: 0, ms: 0, error: 'CLI bağlantısı kapalı', turns: 0, maxTurns: 0, subtype: 'offline' };
  // hangi ajan (CLI)? kısa metin çağrıları hep Claude; plan/iş çağrılarında görevi atanan ajan (yoksa liderin/şapkanın ajanı)
  cat ||= categoryOf(agentId);
  if (phase !== 'text') provider ||= cliOf(p, agentId) || assignCli(p, { agent: agentId, instruction: purpose });
  const need = { web: cat === 'arastirma' && /WebSearch|WebFetch/.test(tools), bash: extraTools.includes('Bash') };   // bu görevin olmazsa olmazları (web: araştırma VE şapkanın web aracı var)
  const forcedFit = provider && provider !== 'claude' ? providerFits(provider, need, S.settings.providers?.[provider] || {}) : { ok: true };
  const usable = !provider || provider === 'claude' || provUsable(provider);
  const pick = phase === 'text' ? { provider: 'claude', why: 'kısa metin' } : provider && forcedFit.ok && usable ? { provider, why: 'atama' } : provider ? { provider: 'claude', why: `${usable ? forcedFit.why : PROVIDERS[provider].label + ' kullanılamıyor'} → Claude Code ile çalışıldı` } : chooseProvider(agentId, cat, need);
  const prov = pick.provider, me = S.agents[prov];
  if (prov === 'claude' && !liveMode() && !FORCE_DEMO) return { id: uid(), response: 'Hata: Claude Code bağlı değil', tin: 0, tout: 0, tcache: 0, ms: 0, error: CLAUDE ? 'Claude Code girişi yok (terminalde "claude auth login")' : 'Claude Code bulunamadı', turns: 0, maxTurns: 0, subtype: 'offline', provider: prov };
  if (/Claude Code ile çalışıldı$/.test(pick.why)) logEv(p, prov, 'task', pick.why);   // uygun olmayan CLI yerine Claude: nedeni görünsün
  const system = `Sen ${me.name}, bu sanal ofiste "${a.title}" şapkasıyla çalışan ajansın. Yanıtların kısa ve öz olsun; selamlama, özür, tekrar yok. ${S.settings.lang === 'en' ? 'Write in English.' : 'Türkçe yaz.'}\nYÖNERGE: ${a.directive}` +
    (phase !== 'text' ? (S.settings.lang === 'en' ? growthPromptEn : growthPrompt)(agentId, a, { work: phase === 'work' }) : '') +
    (phase !== 'text' && S.shared.prefs.length ? `\nKULLANICI TERCİHLERİ (hep uy):\n${S.shared.prefs.slice(-10).map(x => '- ' + x).join('\n')}` : '') +
    (phase === 'work' ? `\nÇalışma klasörün: ${dir} — üretilen tüm dosyaları buraya yaz. Yanıtında dosya içeriğini TEKRARLAMA; sadece ne yaptığını 5-8 satırda anlat.` : '') +
    (phase === 'plan' ? `\nBu aşamada hiçbir dosyayı değiştirme; sadece araştır ve planla.` : '') +
    (phase !== 'text' ? `\nGÜVENLİK: Sadece çalışma klasöründeki dosyalarla çalış. Kullanıcı izni olmadan bu klasörün dışındaki hiçbir dosyayı/klasörü okuma, yazma veya listeleme; gerekiyorsa izin iste. Paket kurmadan önce gerçekten gerekli mi düşün, yerleşik yolları tercih et.` : '');
  const cmodel = S.agents.claude.model || 'sonnet';
  const cfg = phase === 'text' ? { tools: '', allow: [], turns: 1, mode: 'default', model: model || (agentId === 'ceo' ? cmodel : 'haiku') }
    : phase === 'plan' ? { tools, allow: [...WEB.split(','), SELF_SHOT], turns: turns || a.turns, mode: 'default', model: model || cmodel }
    : { tools, allow: [...a.tools.split(',').filter(t => /^(WebSearch|WebFetch)$/.test(t)), SELF_SHOT], turns: turns || a.turns, mode: 'acceptEdits', model: model || cmodel };
  const sk = phase === 'text' ? [] : pickSkills(agentId, a, prompt);
  const fullSystem = system + skillsPrompt(sk);
  const t0 = Date.now(); status(prov, 'working', purpose, agentId);
  const demo = FORCE_DEMO;
  const res = await gate(prov, async () => demo ? (await demoWait(prov, phase), mockRun({ system: fullSystem, prompt }))
    : prov === 'claude' ? runClaude({ agentId: prov, p, prompt, system: fullSystem, cwd: dir, think: phase !== 'text' && a.think !== false, ...cfg })
    : runOther(prov, { agentId: prov, p, prompt, system: fullSystem, phase, cwd: dir, think: a.think !== false }));
  if (prov !== 'claude') cfg.model = prov + (safeModel(S.settings.providers[prov]?.model) ? ':' + S.settings.providers[prov].model : '');
  status(prov, res.error ? (res.limit ? 'limit' : 'error') : 'idle', res.error ? cut(res.error, 60) : '');
  if (res.error) logEv(p, prov, 'error', res.error);
  const req = { id: uid(), ts: Date.now(), projectId: p?.id, agent: agentId, cli: prov, provider: prov, cat, why: pick.why, model: cfg.model, purpose, phase, skills: sk.map(x => x.name), system: cut(fullSystem, 6000), prompt: cut(prompt, 6000),
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
  const cli = t.cli = t.provider || t.cli || assignCli(p, t);   // bu görevi yapan ajan (CLI)
  const roster = Object.keys(S.hats).filter(k => k !== t.agent).join('/');
  const isAudit = t.agent === 'auditor';
  const toReview = isAudit ? [...new Set(Object.values(done).map(d => d.agent))].filter(k => k !== 'auditor') : [];
  // aynı anda çalışan ekip arkadaşları: birbirlerinin dosyalarını ezmesinler, işi bölüşsünler
  const depIds = new Set(t.needs || []);
  const mates = isAudit ? [] : (p.board || []).filter(x => x.id !== t.id && !depIds.has(x.id) && ['bekliyor', 'çalışıyor'].includes(x.status) && x.agent !== 'auditor');
  const base = `GÖREV: ${t.instruction}${t.deliverable ? `\nBEKLENEN ÇIKTI: ${t.deliverable}` : ''}\nPROJE TANIMI: ${cut(brief, 1200)}` + visionText(p) + (p.notes ? `\nPROJE NOTLARI: ${cut(p.notes, 800)}` : '') +
    (deps.length ? '\nÖNCEKİ ÇIKTILAR (özet; ayrıntı için çalışma klasöründeki dosyalara bak):\n' + deps.map(d => `[${d.agent}:${S.hats[d.agent].title}] ${d.summary}`).join('\n') : '') +
    (mates.length ? '\nEKİP (seninle paralel çalışanlar): ' + mates.map(x => `${S.hats[x.agent]?.title || x.agent} → ${x.deliverable || cut(x.instruction, 60)}`).join('; ') + '\nOnların dosyalarına yazma; ortak bir karar gerekiyorsa varsayımını kendi çıktında açıkça belirt.' : '');
  const caps = t.caps || [], capText = capabilityPrompt(caps, { tool: ASSET_TOOL });
  const myCrit = (p.criteria || []).filter(c => (t.criteria || []).includes(c.id));
  const critText = myCrit.length && !isAudit ? '\nBU GÖREVİN KARŞILAMASI GEREKEN KABUL ÖLÇÜTLERİ (teslimden önce her birini kendin kontrol et):\n' + myCrit.map(c => `- ${c.id}: ${c.olcut}`).join('\n') : '';
  const rubric = isAudit && toReview.length ? `\n\nKALİTE DEĞERLENDİRMESİ: Çalışma klasöründeki dosyaları OKU ve ajan özetlerini karşılaştır. Değerlendirilecek ajanlar: ${toReview.join(',')}\nHer ajan için 1-10 puan (1-3 kullanılamaz, 4-6 kısmen, 7-8 iyi, 9-10 kusursuz): "dogruluk" (hatasız/doğru mu), "tamlik" (istenenin tamamı var mı), "talimat" (göreve ve kullanıcı isteğine uyum). Somut kanıt göstermeden 8'in üstünü verme.\n` +
    ((p.criteria || []).length ? `KABUL ÖLÇÜTLERİ (her birini dosyalara bakarak tek tek kontrol et; kanıt göster):\n${p.criteria.map(c => `- ${c.id}: ${c.olcut}`).join('\n')}\nJSON'a "kabul" alanı ekle: {"K1":"gecti — kanıt","K2":"kaldi — ne eksik"}. Kalan her ölçütü düzeltmeler listesine de ekle.\n` : '') +
    `Dosya yazamazsın; bulgularını yanıtında ver. Bulduğun her önemli sorunu (kritik/orta) "duzeltmeler" listesine, düzeltmesi gereken ajana atayarak, dosya/bölüm adıyla ve uygulanabilir şekilde yaz; ajan başına en fazla 5. Küçük zevk farklarını yazma; sorun yoksa liste boş olsun.\n` +
    `Yanıtının EN SON satırı SADECE şu JSON olsun: {"<ajan anahtarı>":{"dogruluk":n,"tamlik":n,"talimat":n,"not":"somut kanıt, en fazla 12 kelime"},"duzeltmeler":[{"ajan":"<ajan anahtarı>","is":"ne, nerede, nasıl düzeltilecek"}]}` : '';
  const tail = `\n\nSonda "---ÖZET---" yazıp 40 kelimelik özet ekle.` + rubric;
  const askLine = isAudit ? '' : `\nSORU_SERBEST: Sadece işini ENGELLEYEN bir bilgi eksiğin varsa hiçbir araç kullanmadan yanıtın TEK satır olsun: "SORU@<${roster}>: kısa soru". Aksi halde soru sorma, işi yap.`;
  const bt = (p.board || []).find(x => x.id === t.id); if (bt && !isAudit) bt.snap = snapshot(p, t.id); if (bt) { bt.status = 'çalışıyor'; bt.cli = cli; bt.startedAt = Date.now(); save(); emit('project', p); }
  logEv(p, cli, 'task', 'Görev başladı: ' + cut(t.instruction, 110));
  const m = { agent: t.agent, deliverable: t.deliverable, turns: 0, maxTurns: 0, ms: 0, error: false, subtype: 'success', questions: 0, denials0: (p.denials || {})[cli] || 0 };
  const add = r => { m.turns += r.turns || 0; m.maxTurns += r.maxTurns || 0; m.ms += r.ms; if (r.error) m.error = true; if (r.subtype && r.subtype !== 'success') m.subtype = r.subtype; if (r.provider) m.provider = r.provider; };
  const cat = m.cat = categoryOf(t.agent, t.instruction, t.deliverable);
  const xt = capTools(caps);
  const vText = isAudit ? verifyText(await verifyProject(p, t.id)) : '';
  const builderText = t.role === 'yapimci' && !t.kind ? builderPrompt(p, t, deps) : '';
  const prior = t.kind === 'düzeltme' ? Object.values(done).filter(d => d.agent === t.agent && !d.fix && d.body).map(d => cut(d.body, 900)).join('\n---\n') : '';
  const priorText = prior ? `\nÖNCEKİ RAPORUN (bu işi sen yaptın; dosyaları baştan keşfetme, yalnızca kararla ilgili yerleri aç ve düzenle):\n${cut(prior, 1800)}` : '';
  const turns = t.role === 'yapimci' ? Math.max(S.hats[t.agent].turns || 24, 60) : undefined;   // tüm ürünü yazan yapımcıya daha çok adım (ekran görüntüsüne bakıp düzeltmek de adım harcar)
  let r = await ask(p, t.agent, base + builderText + critText + capText + vText + priorText + askLine + tail, { purpose: cut(t.instruction, 40), phase: 'work', cat, extraTools: xt, turns, provider: cli }); add(r);   // yapımcının düzeltmeleri aynı CLI'de kalır
  if (r.error && r.provider && r.provider !== 'claude' && r.subtype !== 'budget' && !p.cancelled && provUsable('claude')) {
    // başka CLI başarısız oldu: bunu öğren (düşük puan) ve görevi Claude Code ile bir kez daha dene
    if (!r.userStop) recordResult(S.routing, r.provider, cat, 1, { failed: true }); m.fallback = r.provider;
    post(p, t.agent, 'ceo', r.userStop ? `${PROVIDERS[r.provider].label} bağlantısı kesildi; göreve Claude Code ile devam ediyorum.` : `${PROVIDERS[r.provider].label} bu görevde hata verdi (${cut(r.error, 120)}). Claude Code ile yeniden deniyorum.`, { cli: r.provider });
    m.error = false; m.subtype = 'success';
    r = await ask(p, t.agent, base + capText + askLine + tail, { purpose: cut(t.instruction, 40), phase: 'work', cat, provider: 'claude', extraTools: xt }); add(r);
  }
  if (bt) { bt.provider = m.provider; bt.cat = cat; bt.skills = r.skills || []; }
  const q = r.response.match(/^SORU@(\w+):\s*(.+)$/m);
  if (q && S.hats[q[1].toLowerCase()] && q[1].toLowerCase() !== t.agent) {
    const to = q[1].toLowerCase(); m.questions++;
    post(p, t.agent, to, 'Soru: ' + q[2], { reqId: r.id, cli: m.provider });
    const a = await ask(p, to, `SORU/CEVAP_ISTEGI\n${S.hats[t.agent].title} sana soruyor (görev: ${cut(t.instruction, 150)}): ${q[2]}\nEn fazla 50 kelimeyle yanıtla.`, { purpose: 'soruya yanıt', phase: 'text', model: S.hats[to].model });
    post(p, to, t.agent, a.response, { reqId: a.id });
    r = await ask(p, t.agent, base + capText + `\nSORU-CEVAP: ${q[2]} → ${cut(a.response, 400)}` + tail, { purpose: cut(t.instruction, 40), phase: 'work', cat, provider: m.provider, extraTools: xt }); add(r);
  }
  let fixes = null, accept = null, newDecisions = null, tri = [];
  const parse = r => {
    const sr = extractSelfReview(r.response); let text = sr.text;
    if (t.role === 'yapimci') { const ds = decisionsListOf(text); if (ds.length) newDecisions = ds; tri = triageOf(text); text = stripSections(text); }
    if (sr.review && !m.error) addLesson(S.hats[t.agent], sr.review, 'oz');
    if (isAudit) { const rb = rubricOf({ response: text }); if (rb) { text = rb.rest; fixes = fixesOf(rb.json); accept = acceptOf(rb.json, p.criteria || []); for (const [k, v] of Object.entries(accept)) (p.acceptance ||= {})[k] = { ...v, ts: Date.now() }; for (const [k, v] of Object.entries(rb.json)) if (S.hats[k.toLowerCase()] && v && typeof v === 'object' && !Array.isArray(v)) (p.quality ||= {})[k.toLowerCase()] = v; } }
    return splitSummary(text);
  };
  let { body, summary } = parse(r);
  // akran incelemesi: çıktıyı devralacak ekip arkadaşı dosyaları okur, somut öneri verir; gerekirse sahibi bir kez düzeltir
  const rev = t.reviewer;
  if (rev && rev !== t.agent && S.hats[rev] && !m.error && !p.cancelled && !cliOff()) {
    if (bt) { bt.phase = 'inceleme'; bt.reviewer = rev; save(); emit('project', p); }
    logEv(p, rev, 'task', `${S.hats[t.agent].title} çıktısını inceliyor`);
    const rq = await ask(p, rev, `AKRAN_INCELEME\nBu projede ${S.hats[rev].title} olarak ${S.hats[t.agent].title} (${S.agents[m.provider || cli].name}) ekip arkadaşının çıktısını inceliyorsun; sonraki adımda bu çıktının üzerine sen çalışacaksın.\n` +
      `İNCELENEN GÖREV: ${t.instruction}${t.deliverable ? `\nBEKLENEN ÇIKTI: ${t.deliverable}` : ''}\nARKADAŞININ ÖZETİ: ${summary}\nPROJE TANIMI: ${cut(brief, 1000)}\n` +
      `Çalışma klasöründeki ilgili dosyaları OKU. Kendi uzmanlığın açısından projeyi gerçekten daha iyi yapacak, dosya/bölüm adı veren, uygulanabilir önerileri yaz. Genel övgü, belirsiz tavsiye veya zevk farkı yazma. Hata, eksik ya da senin işini zorlaştıracak bir sorun yoksa "onay" ver.\n` +
      `Yanıtının EN SON satırı SADECE şu JSON olsun: {"karar":"onay" veya "revize","guclu":"en güçlü yanı, en fazla 12 kelime","oneriler":["en fazla 5 somut öneri"]}`,
      { purpose: 'akran incelemesi', phase: 'plan', cat: categoryOf(rev, 'inceleme denetim review', '') });
    const rv = !rq.error && reviewOf(rq.response);
    if (rv) {
      if (bt) bt.review = { by: rev, karar: rv.karar, guclu: rv.guclu, oneriler: rv.oneriler };
      post(p, rev, t.agent, rv.karar === 'revize' ? `Çıktını inceledim${rv.guclu ? ' — güçlü yanı: ' + rv.guclu : ''}. Önerilerim:\n` + rv.oneriler.map(x => '• ' + x).join('\n') : `Çıktını inceledim, onaylıyorum.${rv.guclu ? ' Güçlü yanı: ' + rv.guclu : ''}`, { reqId: rq.id, review: rv.karar });
      if (rv.karar === 'revize' && !p.cancelled) {
        if (bt) { bt.phase = 'düzeltme'; save(); emit('project', p); }
        logEv(p, m.provider || cli, 'task', `Akran önerilerini uyguluyor (${rv.oneriler.length})`);
        const r2 = await ask(p, t.agent, base + capText + `\nAZ ÖNCEKİ RAPORUN (dosyaları baştan keşfetme, yalnızca önerilerle ilgili yerleri aç):\n${cut(body, 1200)}` + `\nAKRAN GERİ BİLDİRİMİ — ${S.hats[rev].title} (${S.agents[cliOf(p, rev)]?.name || rev}) çıktını inceledi ve şunları öneriyor:\n` + rv.oneriler.map(x => '- ' + x).join('\n') +
          `\nBu önerileri mevcut dosyalarında UYGULA (baştan yazma, düzenle). Katılmadığın bir öneri varsa uygulamadan tek cümleyle gerekçesini yaz.` + tail,
          { purpose: 'akran önerilerini uyguluyor', phase: 'work', cat, provider: m.provider, extraTools: xt }); add(r2);
        if (!r2.error) { r = r2; ({ body, summary } = parse(r2)); if (bt) bt.review.applied = true; }
      }
    }
    if (bt) { delete bt.phase; save(); emit('project', p); }
  }
  m.denials = ((p.denials || {})[cli] || 0) - m.denials0; m.delivered = m.error ? 0 : deliveryRatio(p, t.deliverable);
  done[t.id] = { id: t.id, agent: t.agent, summary, body, metrics: m, fix: !!t.kind, fixes, accept, triage: tri };
  if (newDecisions) { p.decisions = newDecisions; post(p, t.agent, 'all', 'Verdiğim kararlar (ekip bunlara göre değerlendirecek):\n' + newDecisions.map(x => '• ' + x).join('\n'), { meet: 1, cli: m.provider || cli }); }
  if (bt && bt.status !== 'iptal') { bt.status = m.error ? 'hata' : 'bitti'; bt.endedAt = Date.now(); bt.summary = summary; bt.metrics = { ...m }; bt.turns = m.turns; save(); emit('project', p); }
  if (!m.error) status(m.provider || cli, 'done', 'tamamlandı', t.agent);
  logEv(p, m.provider || cli, m.error ? 'error' : 'task', (m.error ? 'Görev hata ile bitti: ' : 'Görev tamamlandı: ') + cut(summary, 110));
  post(p, t.agent, 'ceo', body, { reqId: r.id, summary, cli: m.provider || cli });
}

// Puan = Teslimat %40 + Kalite (denetçi rubriği) %35 + Verimlilik %15 + Uyum %10 (eksik ölçüt varsa ağırlıklar yeniden dağıtılır)
function scoreProject(p, done) {
  const lines = [];
  for (const d of Object.values(done)) {
    if (d.agent === 'auditor' || !d.metrics || d.fix) continue;   // düzeltme turları ayrı puanlanmaz; kalitesi yeniden denetimle asıl göreve yansır
    const { score, parts, note } = scoreTask(d.metrics, (p.quality || {})[d.agent]);
    const ag = S.hats[d.agent], me = S.agents[d.metrics.provider] || S.agents.claude, lv0 = levelOf(me).index;   // seviye ajanın (CLI), gelişim alanı ve dersler şapkanın
    const why = Object.entries(parts).map(([k, v]) => `${k[0].toUpperCase() + k.slice(1)} ${v}`).join(' · ') + (note ? ` — ${note}` : '');
    const sc = { score, from: 'metrik', why, parts, hat: d.agent, project: p.name, ts: Date.now() };
    ag.scores.push(sc); ag.scores = ag.scores.slice(-60); me.scores.push(sc); me.scores = me.scores.slice(-60);
    (p.scores ||= []).push({ from: 'metrik', to: d.agent, score, why });
    const bt = (p.board || []).find(x => x.id === d.id); if (bt) bt.score = score;   // tasarruf hesabı: sadece kabul edilen işler
    if (d.metrics.provider && d.metrics.cat) recordResult(S.routing, d.metrics.provider, d.metrics.cat, score, { failed: !!d.metrics.error });   // hangi CLI bu tür işte ne kadar iyi
    for (const [src, l] of metricLessons(parts, d.metrics, (p.quality || {})[d.agent])) addLesson(ag, l, src);
    const lv = levelOf(me); if (lv.index > lv0) post(p, d.agent, 'user', `Seviye atladım: ${lv.name}. (${lv.tasks} görev, ortalama ${lv.avg.toFixed(1)}/10)`, { levelUp: lv.key, cli: d.metrics.provider });
    lines.push(`${me.name} · ${ag.title}: ${score.toFixed(1)}/10 — ${why}`);
  }
  if (lines.length) post(p, 'ceo', 'user', 'Puan raporu (ölçülebilir metrikler)\n' + lines.join('\n'), { score: 1 });
}

// ortak ürün vizyonu: CEO planla birlikte yazar, tüm ajanların istemine ve ekip toplantısına girer
function visionOf(v) {
  if (!v || typeof v !== 'object') return null;
  const o = Object.fromEntries(['amac', 'kitle', 'basari', 'kapsam', 'tarz', 'yapi'].map(k => [k, cut(String(v[k] || '').trim(), 240)]).filter(([, x]) => x));
  return Object.keys(o).length ? o : null;
}
const VIS_LBL = { amac: 'Amaç', kitle: 'Kitle', basari: 'Başarı ölçütü', kapsam: 'Kapsam', tarz: 'Tarz', yapi: 'Yapı' };
const visionText = p => p.vision ? '\nORTAK ÜRÜN VİZYONU (tüm ekip buna hizmet eder; kendi parçanı bütünle uyumlu yap):\n' + Object.entries(p.vision).map(([k, v]) => `- ${VIS_LBL[k] || k}: ${v}`).join('\n') : '';

// 1) Kullanıcı projeyi anlatır → CEO araştırır, plan çıkarır, onay ister
async function handleUser(p, text, { revise } = {}) {
  const roster = Object.entries(S.hats).filter(([k, a]) => k !== 'ceo' && !a.external).map(([k, a]) => `${k}=${a.title} (araçlar: ${a.tools})`).join('; ');
  const mem = membersOf(p), best = k => Object.keys(CATEGORIES).map(c => [c, estimate(S.routing, k, c).mean]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => `${CATEGORIES[c]} ${v.toFixed(1)}`).join(', ');
  const crew = mem.map(k => `${k}=${PROVIDERS[k].label} (en iyi olduğu işler: ${best(k)}${k === 'codex' ? '; ağ kapalı: web araştırması yapamaz' : ''})`).join('; ');
  if (!revise) post(p, 'user', 'ceo', text);
  const brief = revise ? p.brief : text; if (!revise) p.brief = [p.brief, text].filter(Boolean).join('\n').slice(-3000);
  const ctx = (p.summary ? `\nPROJENİN ŞU ANKİ DURUMU (önceki turlar): ${p.summary}` : '') + (p.notes ? `\nPROJE NOTLARI (kullanıcı): ${cut(p.notes, 800)}` : '');
  const files = listFiles(wsDir(p)); const fctx = files.length ? `\nÇALIŞMA KLASÖRÜNDEKİ DOSYALAR: ${files.slice(0, 25).join(', ')}` : '';
  const planReq = await ask(p, 'ceo', `PLAN_JSON\nKullanıcının proje tanımı/isteği: """${revise ? p.brief : text}"""${revise ? `\nKULLANICININ PLAN HAKKINDAKİ DÜZELTMESİ: """${revise}"""` : ''}${ctx}${fctx}\nŞAPKALAR (görev rolleri, task.agent): ${roster}\nAJANLAR (bu ofisin üyeleri, task.kim — her göreve işe en uygun ajanı ata): ${crew}${catalogPrompt((revise ? p.brief : text) + ' ' + (revise || ''), Object.keys(S.hats))}\n` +
    `Önce gerekiyorsa kısa bir araştırma yap (en fazla 3 web araması), sonra planı çıkar.\n` +
    `Yanıtın SADECE JSON olsun: {"reply":"kullanıcıya 2-3 cümle: neyi anladın, nasıl ilerleyeceksin","vizyon":{"amac":"ürün kimin hangi sorununu çözecek, 1 cümle","kitle":"birincil kullanıcılar","basari":"bitmiş ve başarılı sayılması için ölçülebilir ölçüt","kapsam":"bu turda var olacaklar / olmayacaklar","tarz":"YARATICI YÖN: ruh hali, renk fikri, tipografi, görsel dil, örnek/benzer referans","yapi":"sayfa/ekran yapısı ve bölümleri sırasıyla"},"kabul":[{"id":"K1","olcut":"gözlemlenebilir, kontrol edilebilir ölçüt"}],"research":["en fazla 5 kısa bulgu"],"tasks":[{"id":"t1","agent":"<şapka anahtarı>","kim":"<ajan anahtarı>","instruction":"net kısa görev","needs":["önceki görev id"],"deliverable":"çıktı dosyası adı","yetenekler":["gerekiyorsa yetenek id"],"kriterler":["bu görevin karşıladığı kabul ölçütü id'leri"]}],"needs_approval":["çalışırken izin isteyebilecek kurulum/indirme/komutlar, varsa"],"questions":["kritik eksik bilgi varsa en fazla 2 soru"]}\n` +
    `BÜTÜNCÜL DÜŞÜN: Projeyi sadece ön yüz/görsel iş olarak değil, kullanıcıya değer üreten BÜTÜN bir ürün olarak ele al: amaç ve kitle (araştırma), içerik ve dil (metin), deneyim ve görsel (tasarım), teknik altyapı (kod, veri, çalıştırma ve yayına alma), kalite (denetim). İşin gerektirdiği her uzmanlığı kullan, gerektirmeyeni ekleme. Vizyonu tüm ekip görecek ve ekip sonda ürünü bu vizyona göre birlikte değerlendirecek.\n` +
    `ÜRÜN MODELİ: Site/uygulama/oyun gibi bir ürünü TEK bir yapımcı (developer şapkasını takan tek ajan) baştan sona yazar — tasarımı da kodla birlikte o yapar. Gözden geçirmeyi ofis, mümkünse yapımcıdan FARKLI bir ajana verir (farklı model kendi işini övmez). Ürünü parçalara bölüp farklı ajanlara yazdırma (paralel yazanlar birbirinin kararlarını göremez, sonuç tutarsız olur). Araştırmacı, yazar ve tasarımcı yapımcıya GİRDİ belgesi hazırlar (.md: bulgular, sayfa metinleri, tasarım yönü); tasarımcı ve denetçi sonra ürünün ekran görüntülerine bakarak gözden geçirir, yapımcı geri bildirimi süzüp uygular. Vizyondaki "tarz" ve "yapi" yapımcının yaratıcı yönergesidir: somut yaz.\n` +
    `YAŞAM DÖNGÜSÜ: (1) Gereksinim → 3-8 KABUL ÖLÇÜTÜ yaz: her biri gözlemlenebilir ve kontrol edilebilir olsun (ör. "Mobilde menü açılıp kapanıyor", "İletişim formu hatalı e-postayı reddediyor"); belirsiz ifade ("güzel olsun") yazma. (2) Sözleşme → birden fazla kişinin aynı ürüne katkı verdiği işlerde İLK görev ortak bir sözleşme belgesi olsun (dosya yapısı, dosya/sınıf/kare adları, renk-yazı tokenları, veri biçimleri) ve ona dayanan görevler needs ile ona bağlansın. (3) Uygulama → sözleşmeye göre paralel. (4) Doğrulama → denetçi her kabul ölçütünü tek tek kontrol eder; ekip sonra toplanıp düzeltir. Her ölçüt en az bir görevin "kriterler" alanında olsun.\n` +
    `Kurallar: en fazla 6 görev. PARALELLİK: needs'e yalnızca o çıktıyı OKUMADAN yapılamayacak önceki görevleri yaz; birbirine gerçekten bağlı olmayan işler (ör. araştırma ile tasarım, metin ile görsel yapı) aynı anda yürüsün diye needs boş olsun. Aynı anda çalışan görevler FARKLI dosyalara yazsın. Her instruction'da ne yapılacağını ve kabul ölçütünü (bitmiş sayılması için ne olmalı) 1-3 cümleyle somut yaz. 2 veya daha fazla görevli işlerde son görev olarak denetçiyi (auditor) ekle; ekip birbirinin çıktısını zaten inceleyip öneri verecek ve denetçinin bulguları ayrıca düzeltilecek, bu yüzden ayrı 'gözden geçir/düzelt' görevi ekleme. Selamlaşma/soru ise tasks boş bırak ve reply'de cevap ver. Kritik bilgi eksikse tasks boş, questions dolu olsun.`,
    { purpose: 'araştırma ve plan', phase: 'plan' });
  let plan; try { plan = JSON.parse(planReq.response.match(/\{[\s\S]*\}/)[0]); } catch { plan = { reply: planReq.response, tasks: [] }; }
  const ceoCaps = (plan.tasks || []).some(t => Array.isArray(t.yetenekler) && t.yetenekler.length);   // CEO yetenek atadıysa karar onundur
  const tasks = (plan.tasks || []).filter(t => S.hats[t.agent] && !S.hats[t.agent].external && t.agent !== 'ceo').slice(0, 6).map(t => ({ ...t, caps: capsForTask(t, t.agent, `${p.brief} ${text || ""}`, { auto: !ceoCaps }) }));
  for (const t of tasks) t.cli = assignCli(p, { ...t, cli: String(t.kim || '').toLowerCase() });   // liderin seçimi ofis üyesiyse ve işe uygunsa geçerli
  const qs = (plan.questions || []).filter(Boolean);
  if (!tasks.length) { post(p, 'ceo', 'user', [plan.reply || 'Tamam.', ...qs.map(q => '• ' + q)].join('\n'), { reqId: planReq.id }); save(); emit('project', p); return; }
  const criteria = criteriaOf(plan.kabul), cids = new Set(criteria.map(c => c.id));
  for (const t of tasks) t.criteria = (Array.isArray(t.kriterler) ? t.kriterler : []).map(x => String(x).toUpperCase()).filter(x => cids.has(x));
  const orch = productize(tasks, S.hats);   // ürün modu: tek yapımcı + girdiler + gözden geçirme döngüsü
  p.pendingPlan = { id: uid(), tasks: orch.tasks, mode: orch.mode, criteria, vision: visionOf(plan.vizyon), research: (plan.research || []).slice(0, 5), needs: (plan.needs_approval || []).filter(Boolean), reply: plan.reply || '', questions: qs };
  post(p, 'ceo', 'user', plan.reply || 'Plan hazır.', { reqId: planReq.id, plan: p.pendingPlan });
  save(); emit('project', p);
}

// Bağımlılık grafiğini çalıştırır: her görev kendi önkoşulları biter bitmez başlar (eşzamanlılığı gate sınırlar)
async function runDag(p, list, done, runOne) {
  let pending = [...list]; const live = new Map();
  while ((pending.length || live.size) && !p.cancelled) {
    let ready = pending.filter(t => (t.needs || []).every(n => done[n] || !list.some(x => x.id === n)));
    if (!ready.length && !live.size) ready = [pending[0]];   // çözülemeyen bağımlılık: kilitlenmek yerine sıradakini çalıştır
    for (const t of ready) { pending = pending.filter(x => x !== t); live.set(t.id, runOne(t).finally(() => live.delete(t.id))); }
    if (live.size) await Promise.race(live.values());
  }
  await Promise.allSettled(live.values());
}
const reviewRounds = () => [0, 1, 2].includes(S.settings?.review) ? S.settings.review : 2;
// akran incelemecisi: bu çıktının üzerine çalışacak (denetçi olmayan) ilk ekip arkadaşı; çıktıyı yalnızca denetçi kullanıyorsa son denetim yeter
function reviewerFor(t, tasks) {
  if (t.agent === 'auditor' || t.kind || t.role) return null;
  const next = tasks.find(x => (x.needs || []).includes(t.id) && x.agent !== t.agent && x.agent !== 'auditor' && !x.kind);
  if (next) return next.agent;
  return !tasks.some(x => x.agent === 'auditor') && S.hats.auditor ? 'auditor' : null;
}

// ---------- Anlık görüntü ve geri alma ----------
// Görev başlamadan önce çalışma klasörünün kopyası uygulamanın veri klasörüne alınır. Geri alınca o andaki hâline dönülür;
// sonradan oluşan dosyalar SİLİNMEZ, anlık görüntünün "geri-alinanlar" klasörüne taşınır.
function snapshot(p, tag) {
  const dir = wsDir(p), files = walk(dir, 3000); let size = 0;
  for (const f of files) { try { size += fs.statSync(f).size; } catch {} if (size > SNAP_MAX_BYTES) { logEv(p, 'ceo', 'task', 'Anlık görüntü alınmadı: çalışma klasörü 50 MB\'tan büyük'); return null; } }
  const id = `${Date.now().toString(36)}-${String(tag).replace(/[^\w-]/g, '')}`, to = path.join(SNAPS, p.id, id);
  try {
    for (const f of files) { const r = path.relative(dir, f), d = path.join(to, 'files', r); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(f, d); }
    fs.mkdirSync(to, { recursive: true }); fs.writeFileSync(path.join(to, 'meta.json'), JSON.stringify({ id, tag, ts: Date.now(), files: files.map(f => path.relative(dir, f).replace(/\\/g, '/')), size }));
  } catch (e) { logEv(p, 'ceo', 'error', 'Anlık görüntü alınamadı: ' + e.message); return null; }
  const all = fs.readdirSync(path.join(SNAPS, p.id)).sort();   // en eski görüntüler silinir (yalnızca uygulamanın kendi kopyaları)
  for (const old of all.slice(0, Math.max(0, all.length - SNAP_KEEP))) fs.rmSync(path.join(SNAPS, p.id, old), { recursive: true, force: true });
  return id;
}
function restoreSnapshot(p, id) {
  if (!/^[\w-]+$/.test(id || '')) throw new Error('geçersiz anlık görüntü');
  const from = path.join(SNAPS, p.id, id); let meta; try { meta = JSON.parse(fs.readFileSync(path.join(from, 'meta.json'), 'utf8')); } catch { throw new Error('Anlık görüntü bulunamadı (eskiler otomatik silinir)'); }
  const before = snapshot(p, 'geri-almadan-once');   // geri almanın kendisi de geri alınabilsin
  const dir = wsDir(p), keep = new Set(meta.files.map(x => x.toLowerCase())), moved = [], trash = path.join(from, 'geri-alinanlar', Date.now().toString(36));
  for (const f of walk(dir, 3000)) { const r = path.relative(dir, f).replace(/\\/g, '/'); if (keep.has(r.toLowerCase())) continue; const d = path.join(trash, r); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.renameSync(f, d); moved.push(r); }
  for (const r of meta.files) { const d = path.join(dir, r); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(from, 'files', r), d); }
  return { restored: meta.files.length, moved, trash: moved.length ? trash : null, ts: meta.ts, before };
}

// ---------- Otomatik doğrulama ----------
// kesin kontroller (token yok) + giriş sayfası varsa gizli tarayıcıda masaüstü/mobil ekran görüntüsü ve konsol hataları
function entryHtml(dir) {
  const hs = walk(dir, 300).filter(f => /\.html?$/i.test(f)).sort((a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length);
  return hs.find(f => /^index\.html?$/i.test(path.basename(f))) || hs[0] || null;
}
// page: çalışma klasörüne göre göreli sayfa yolu (boşsa giriş sayfası); klasör dışına çıkamaz
function screenshots(p, tag, page) {
  const dir = wsDir(p);
  let html = entryHtml(dir);
  if (page) { const f = path.resolve(dir, String(page).replace(/^[\\/]+/, '')); html = f.toLowerCase().startsWith(dir.toLowerCase() + path.sep) && /\.html?$/i.test(f) && fs.existsSync(f) ? f : null; }
  if (!html || !ELECTRON || (FORCE_DEMO && !process.env.OFIS_SHOTS)) return Promise.resolve(null);
  const out = path.join(SHOTS, p.id, tag); fs.rmSync(out, { recursive: true, force: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  return new Promise(resolve => execFile(ELECTRON, [SHOT_TOOL, html, out], { env, windowsHide: true, timeout: 100000 }, () => {
    try { const r = JSON.parse(fs.readFileSync(path.join(out, 'sonuc.json'), 'utf8')); resolve(r.error ? null : { page: path.relative(dir, html).replace(/\\/g, '/'), shots: (r.shots || []).map(x => path.basename(x)), dir: out, errors: r.errors || [], warnings: r.warnings || [], pages: r.pages || {} }); } catch { resolve(null); }
  }));
}
// ekran görüntüsü dilimlerinin açıklaması: "masaüstü 3 dilim (2400px), mobil 4 dilim (3300px)"
const shotPlan = v => Object.entries(v.pages || {}).map(([k, x]) => `${k === 'mobil' ? 'mobil' : 'masaüstü'} ${x.tiles} dilim (${x.height}px${x.truncated ? ', sayfanın sonu kesildi' : ''})`).join(', ');
// yapımcının kendi aracı (approver.js → mcp__ofis__screenshot): sayfayı tam sayfa çeker, dosya yollarını ve tarayıcı sorunlarını döndürür
let selfShotN = 0;
async function selfShot({ project, agent, page }) {
  const p = S.projects.find(x => x.id === project); if (!p) return { text: 'Proje bulunamadı.' };
  if (!ELECTRON) return { text: 'Ekran görüntüsü alınamıyor: Electron bulunamadı (npm install).' };
  const pdir = path.join(SHOTS, p.id);
  try { const old = fs.readdirSync(pdir).filter(x => x.startsWith('oz-')).sort(); for (const x of old.slice(0, Math.max(0, old.length - 3))) fs.rmSync(path.join(pdir, x), { recursive: true, force: true }); } catch {}
  logEv(p, agent, 'tool', 'Sayfanın ekran görüntüsünü alıyor');
  const v = await screenshots(p, `oz-${Date.now()}-${++selfShotN}`, page);
  if (!v) return { text: page ? `Sayfa bulunamadı ya da açılamadı: ${page} (çalışma klasörüne göre göreli bir .html yolu ver).` : 'Çalışma klasöründe açılacak bir .html sayfası yok ya da sayfa açılamadı.' };
  return { text: `${v.page} gizli tarayıcıda açıldı; fontlar ve görseller yüklendikten sonra tam sayfa çekildi: ${shotPlan(v)}.\n` +
    `Her dilim bir ekran yüksekliği; sırayla Read ile aç ve gerçekten gördüğünü değerlendir:\n${v.shots.map(x => path.join(v.dir, x)).join('\n')}\n` +
    `TARAYICI: ${v.errors.length ? v.errors.map(e => '\n- ' + e).join('') : 'konsol hatası yok, yatay taşma yok.'}${v.warnings.length ? '\nUYARI: ' + v.warnings.join(' | ') : ''}` };
}
async function verifyProject(p, tag) {
  const checks = checkWorkspace(wsDir(p)), visual = await screenshots(p, tag);
  p.verify = { ts: Date.now(), tag, checks, visual };
  logEv(p, 'auditor', 'task', `Otomatik doğrulama: ${checks.errors} hata, ${checks.warnings} uyarı${visual ? `, tarayıcıda ${visual.errors.length} sorun` : ''}`);
  save(); emit('project', p); return p.verify;
}
const verifyText = v => !v ? '' : checksText(v.checks) + (v.visual ? `\nTARAYICI KONTROLÜ (${v.visual.page} gizli tarayıcıda açıldı): ${v.visual.errors.length ? v.visual.errors.map(e => '\n- ' + e).join('') : 'konsol hatası yok, yatay taşma yok.'}\nEKRAN GÖRÜNTÜLERİ (tam sayfa, fontlar yüklü; ${shotPlan(v.visual)}; sırayla Read ile aç ve masaüstü/mobil görünümü baştan sona değerlendir): ${v.visual.shots.map(x => path.join(v.visual.dir, x)).join(' , ')}` : '');
// dosyanın sorumlusu: o dosyayı teslim eden görevin ajanı; yoksa dosya türüne göre
function ownerOfFile(p, file) {
  const ok = k => S.hats[k] && !['ceo', 'auditor'].includes(k) && !S.hats[k].external;
  const b = path.basename(file).toLowerCase(), t = (p.board || []).find(x => !x.kind && ok(x.agent) && String(x.deliverable || '').toLowerCase().includes(b));
  if (t) return t.agent;
  const pref = /\.(png|jpe?g|gif|svg|webp)$/i.test(file) ? ['designer', 'developer'] : /\.md$/i.test(file) ? ['writer', 'designer', 'developer'] : ['developer', 'designer', 'writer'];
  return pref.find(ok) || Object.keys(S.hats).find(ok) || null;
}

// ---------- Ekip toplantısı ----------
// 1) her ajan ürünü BÜTÜN olarak değerlendirir (olmuş / olmamış / olabilir), 2) eleştiri alan ajan yanıt verir (katılıyorum / kısmen / katılmıyorum),
// 3) CEO tartışmayı tartıp karar verir. Dönen: { ajan: ['yapılacak iş', ...] } — boşsa değişiklik yok
const roleName = k => k === 'sistem' ? 'Otomatik kontrol' : S.hats[k]?.title || k;
async function teamMeeting(p, done, round) {
  const ok = k => S.hats[k] && !['ceo', 'auditor'].includes(k) && !S.hats[k].external;
  const items = [];
  for (const d of Object.values(done)) if (d.agent === 'auditor' && d.fixes && !d.fixesUsed) {   // denetçinin bulguları gündeme girer
    d.fixesUsed = true;
    for (const [k, list] of Object.entries(d.fixes)) for (const x of list) items.push({ from: 'auditor', sahip: k, tur: 'olmamis', text: x });
  }
  for (const d of Object.values(done)) if (d.accept && !d.acceptUsed) {   // kalan kabul ölçütü → ölçütü taşıyan görevin sahibine
    d.acceptUsed = true;
    for (const [id, v] of Object.entries(d.accept)) if (v.durum === 'kaldi') {
      const c = (p.criteria || []).find(x => x.id === id), owner = (p.board || []).find(x => !x.kind && (x.criteria || []).includes(id) && ok(x.agent))?.agent;
      if (c && owner && !items.some(x => x.text.includes(id + ' '))) items.push({ from: 'auditor', sahip: owner, tur: 'olmamis', text: `${id} karşılanmadı: ${c.olcut}${v.not ? ' — ' + v.not : ''}` });
    }
  }
  const v = await verifyProject(p, `m${round}`);
  for (const x of v.checks.issues.filter(x => x.sev === 'hata').slice(0, 8)) { const o = ownerOfFile(p, x.file); if (o) items.push({ from: 'sistem', sahip: o, tur: 'olmamis', text: `${x.file}: ${x.msg}` }); }
  if (v.visual) for (const e of v.visual.errors.slice(0, 5)) { const o = ownerOfFile(p, v.visual.page); if (o) items.push({ from: 'sistem', sahip: o, tur: 'olmamis', text: `Tarayıcıda: ${e}` }); }
  const work = Object.values(done).filter(d => !d.fix && d.agent !== 'auditor' && d.agent !== 'ceo');
  const members = round === 1 ? [...new Set(work.map(d => d.agent))].filter(k => S.hats[k] && !S.hats[k].external) : [];
  if (!members.length && !items.some(x => ok(x.sahip))) return {};
  const bt = { id: `m${round}`, agent: 'ceo', kind: 'ekip toplantısı', needs: [], deliverable: '', status: 'çalışıyor', startedAt: Date.now(),
    instruction: round === 1 ? 'Ekip ürünü bütün olarak değerlendiriyor: olmuş / olmamış / olabilir → itirazlar tartışılıyor → CEO karar veriyor' : 'Denetçinin yeni bulguları için CEO karar veriyor' };
  (p.board ||= []).push(bt);
  const phase = ph => { bt.phase = ph; save(); emit('project', p); };
  const close = (status, summary) => { bt.status = status; bt.endedAt = Date.now(); bt.summary = summary; delete bt.phase; save(); emit('project', p); };
  const files = listFiles(wsDir(p)).slice(0, 30);
  const roster = Object.entries(S.hats).filter(([k, a]) => k !== 'ceo' && !a.external).map(([k, a]) => `${k}=${a.title}`).join(', ');
  // 1) değerlendirme: herkes aynı anda, dosyaları okuyarak (salt okunur)
  if (members.length) {
    phase('değerlendirme'); logEv(p, 'ceo', 'task', 'Ekip toplantısı başladı');
    post(p, 'ceo', 'all', 'Ekip toplantısı: ilk sürüm hazır. Herkes ürünü bütün olarak incelesin — neler olmuş, neler olmamış, neler daha iyi olabilir?', { meet: 1 });
    const team = work.map(d => `[${d.agent}:${roleName(d.agent)}] ${cut(d.summary, 220)}`).join('\n');
    await Promise.all(members.map(async k => {
      const r = await ask(p, k, `EKIP_DEGERLENDIRME\nEkip projenin ilk sürümünü bitirdi. Şimdi ürünü BÜTÜN olarak değerlendiriyorsunuz; sadece kendi parçana değil, kullanıcının eline geçecek ürünün tamamına bak: amaca ve vizyona hizmet ediyor mu, parçalar (araştırma, içerik, tasarım, kod) birbiriyle tutarlı ve birbirini tamamlıyor mu, eksik kalan bir taraf var mı?\n` +
        `PROJE TANIMI: ${cut(p.brief || '', 1000)}${visionText(p)}\nEKİBİN YAPTIKLARI:\n${team}\nÇALIŞMA KLASÖRÜNDEKİ DOSYALAR: ${files.join(', ') || '(yok)'}\nEKİP ANAHTARLARI: ${roster}\n` +
        `Dosyaları OKU. ${roleName(k)} olarak kendi uzmanlığının gözüyle ama ürünün bütünü için yaz:\n- olmus: gerçekten iyi olan en fazla 2 şey\n- olmamis: kullanıcıya zarar veren hata, eksik ya da parçalar arası tutarsızlık; en fazla 3; her birinin sorumlusu ("sahip", ekip anahtarı) ve somut düzeltmesiyle\n- olabilir: ürünü belirgin şekilde iyileştirecek en fazla 2 öneri, sahibiyle\n` +
        `Kendi işindeki sorunları da dürüstçe yaz. Zevk farkı, belirsiz öneri ve kapsam dışı büyük işler yazma.\nYanıtının EN SON satırı SADECE şu JSON olsun: {"olmus":["..."],"olmamis":[{"sahip":"<anahtar>","konu":"ne, nerede","oneri":"nasıl düzeltilir"}],"olabilir":[{"sahip":"<anahtar>","oneri":"..."}]}`,
        { purpose: 'ekip değerlendirmesi', phase: 'plan', cat: categoryOf(k, 'inceleme denetim review', '') });
      const c = !r.error && critiqueOf(r.response); if (!c) return;
      const lines = [...c.olmus.map(x => '✓ Olmuş: ' + x), ...c.olmamis.map(x => `✗ Olmamış (${roleName(x.sahip)}): ${x.text}`), ...c.olabilir.map(x => `→ Olabilir (${roleName(x.sahip)}): ${x.text}`)];
      if (lines.length) post(p, k, 'all', lines.join('\n'), { reqId: r.id, meet: 1 });
      for (const x of c.olmamis) items.push({ from: k, sahip: x.sahip, tur: 'olmamis', text: x.text });
      for (const x of c.olabilir) items.push({ from: k, sahip: x.sahip, tur: 'olabilir', text: x.text });
    }));
  }
  if (p.cancelled) { close('iptal', 'Toplantı yarıda kesildi.'); return {}; }
  const agenda = items.filter(x => ok(x.sahip)).slice(0, 16).map((x, i) => ({ ...x, no: i + 1 }));
  if (!agenda.length) { close('bitti', 'Değiştirilecek bir şey bulunmadı; ekip ürünü onayladı.'); post(p, 'ceo', 'all', bt.summary, { meet: 1 }); return {}; }
  // 2) tartışma: eleştiri alan ajan her maddeye katılıp katılmadığını gerekçesiyle söyler (kısa metin, araçsız)
  const bySahip = {}; for (const x of agenda) if (x.from !== x.sahip) (bySahip[x.sahip] ||= []).push(x);
  if (Object.keys(bySahip).length) {
    phase('tartışma');
    await Promise.all(Object.entries(bySahip).map(async ([k, list]) => {
      const mine = work.filter(d => d.agent === k).map(d => cut(d.summary, 200)).join(' | ');
      const r = await ask(p, k, `ELESTIRI_YANIT\nEkip toplantısındasın. Arkadaşların senin işin hakkında şunları söyledi:\n` + list.map(x => `${x.no}. [${roleName(x.from)}] ${x.tur === 'olmamis' ? 'olmamış' : 'olabilir'}: ${x.text}`).join('\n') +
        `\nSENİN YAPTIĞIN: ${mine || '(özet yok)'}${visionText(p)}\nHer madde için karar ver: "katiliyorum" (yapacağım), "kismen" (neyi nasıl yapacağını söyle) ya da "katilmiyorum" (somut gerekçeyle: kullanıcının isteğine ters, kapsam dışı, zaten var vb.). Savunmacı olma; ürün için en iyisini düşün.\n` +
        `Yanıtın SADECE JSON olsun: {"yanitlar":[{"no":<madde no>,"karar":"katiliyorum|kismen|katilmiyorum","not":"en fazla 20 kelime"}]}`,
        { purpose: 'toplantıda yanıt', phase: 'text' });
      const ys = repliesOf(r.response).filter(y => list.some(x => x.no === y.no)); if (!ys.length) return;
      for (const y of ys) list.find(x => x.no === y.no).yanit = y;
      const ic = { katiliyorum: '✓ Katılıyorum', kismen: '◐ Kısmen', katilmiyorum: '✗ Katılmıyorum' };
      post(p, k, 'all', 'Bana gelen önerilere yanıtım:\n' + ys.map(y => `${y.no}. ${ic[y.karar]}${y.not ? ' — ' + y.not : ''}`).join('\n'), { reqId: r.id, meet: 1 });
    }));
  }
  if (p.cancelled) { close('iptal', 'Toplantı yarıda kesildi.'); return {}; }
  // 3) CEO kararı
  phase('karar');
  const r = await ask(p, 'ceo', `TOPLANTI_KARAR\nPROJE: ${cut(p.brief || '', 800)}${visionText(p)}\nEkip ürünü değerlendirdi. Gündem (madde no. [öneren → sorumlu] tür: öneri | sorumlunun yanıtı):\n` +
    agenda.map(x => `${x.no}. [${x.from} → ${x.sahip}] ${x.tur === 'olmamis' ? 'olmamış' : 'olabilir'}: ${x.text}${x.yanit ? ` | yanıt: ${x.yanit.karar}${x.yanit.not ? ' — ' + x.yanit.not : ''}` : ''}`).join('\n') +
    `\nÜrünün bütünü ve kullanıcının amacı için hangi değişikliklerin yapılacağına karar ver. Hataları ve vizyona hizmet eden önerileri kabul et; gerekçesi ikna edici itirazları, zevk meselelerini ve kapsam dışı işleri reddet; tekrar edenleri birleştir. Her kararın tek bir sorumlusu olsun (ekip anahtarı), iş somut ve uygulanabilir yazılsın; ajan başına en fazla 4 karar.\n` +
    `Yanıtın SADECE JSON olsun: {"ozet":"ekibe 2-3 cümle: neye karar verildi ve neden","kararlar":[{"sahip":"<anahtar>","is":"ne, nerede, nasıl"}],"reddedilen":[{"no":<madde no>,"neden":"kısa"}]}`,
    { purpose: 'toplantı kararı', phase: 'text' });
  let dec = !r.error && decisionsOf(r.response);
  if (!dec) dec = { ozet: 'Karar metni okunamadı; itiraz edilmeyen maddeler uygulanacak.', kararlar: agenda.filter(x => x.yanit?.karar !== 'katilmiyorum').map(x => ({ sahip: x.sahip, is: x.text })), reddedilen: [] };
  const out = {}; for (const d of dec.kararlar) if (ok(d.sahip) && (out[d.sahip] ||= []).length < 4) out[d.sahip].push(d.is);
  for (const k of Object.keys(out)) if (!out[k].length) delete out[k];
  const n = Object.values(out).reduce((a, l) => a + l.length, 0);
  post(p, 'ceo', 'all', (dec.ozet ? dec.ozet + '\n\n' : '') + (n ? 'Kararlar:\n' + Object.entries(out).map(([k, l]) => l.map(x => `• ${S.agents[cliOf(p, k)]?.name || k} (${roleName(k)}): ${x}`).join('\n')).join('\n') : 'Değişiklik kararı çıkmadı.') +
    (dec.reddedilen.length ? '\n\nReddedilenler:\n' + dec.reddedilen.map(x => `• ${x.no ? x.no + '. madde' : 'Madde'}: ${x.neden}`).join('\n') : ''), { reqId: r.id, meet: 1 });
  bt.meeting = { items: agenda.length, decisions: n, rejected: dec.reddedilen.length };
  close('bitti', `${agenda.length} madde konuşuldu, ${n} karar alındı${dec.reddedilen.length ? `, ${dec.reddedilen.length} öneri reddedildi` : ''}.`);
  logEv(p, 'ceo', 'task', 'Ekip toplantısı bitti: ' + bt.summary);
  return out;
}

// ---------- Ürün modu: tek yapımcı ↔ gözden geçirenler ----------
// Girdiler yapımcıya ÖZET değil TAM belge olarak gider (MetaGPT); yapımcı örtük kararlarını açıkça yazar (Cognition).
function inputDocs(p, deps) {
  const dir = wsDir(p); let total = 0; const out = [];
  for (const d of deps) {
    const bt = (p.board || []).find(x => x.id === d.id), files = String(bt?.deliverable || '').split(/[,;]|\s+ve\s+/).map(x => x.trim()).filter(x => /\.(md|txt)$/i.test(x));
    let txt = '';
    for (const fl of files) { const fp = path.resolve(dir, fl); if (fp.toLowerCase().startsWith(dir.toLowerCase()) && fs.existsSync(fp)) txt += `=== ${fl} (${roleName(d.agent)}) ===\n${cut(fs.readFileSync(fp, 'utf8'), 6000)}\n`; }
    if (!txt) txt = `=== ${roleName(d.agent)} raporu ===\n${cut(d.body || d.summary || '', 3000)}\n`;
    if (total + txt.length > 16000) txt = cut(txt, Math.max(0, 16000 - total)); total += txt.length; if (txt) out.push(txt);
  }
  return out.join('\n');
}
const SHOT_HINT = `"${SELF_SHOT}" aracın varsa onu çağır (sayfayı tam sayfa, fontlar yüklü masaüstü+mobil çeker) ve dönen PNG dilimlerini Read ile açıp gerçekten gör.`;
function builderPrompt(p, t, deps) {
  const ins = inputDocs(p, deps), dsk = S.hats.designer ? skillsPrompt(pickSkills('designer', S.hats.designer, `${t.instruction} ${p.brief || ''}`, 2)) : '';
  return `\nYAPIMCI_GOREVI: Bu ürünün TEK yazarı sensin; tasarımı da kodla birlikte sen yapıyorsun — usta bir ürün tasarımcısı-geliştirici gibi çalış. Başka kimse ürün dosyalarına yazmayacak; ekip girdi hazırladı ve sonra ekran görüntülerine bakarak gözden geçirecek.` +
    `\n- Önce girdileri ve vizyondaki tarz/yapıyı oku. Görsel yönü (renk paleti, tipografi ölçeği, boşluk, köşe, gölge) CSS değişkenleriyle kur ve ürünün tamamına tutarlı uygula; sıradan şablon görünümünden kaçın, net bir görsel hiyerarşi kur.` +
    `\n- Girdilerdeki gerçek içeriği kullan; yer tutucu bırakma. Mobilde ve masaüstünde düzgün görünsün; etkileşimler çalışsın.` +
    `\n- GÖREREK ÇALIŞ: ${SHOT_HINT} İlk çalışan taslaktan hemen sonra ve her büyük görsel değişiklikten sonra sayfaya bak; gördüğün sorunları (hiyerarşi, boşluk, hizalama, kontrast, taşma, mobil düzen, boş/kırık bölüm) düzelt ve tekrar bak. Kodu okuyarak "iyi görünüyordur" deme.` +
    `\n- Bitirmeden önce dosyalarını yeniden aç ve kabul ölçütlerini tek tek kontrol et.` +
    `\n- Yanıtının sonunda (---ÖZ--- satırından önce) "---KARARLAR---" başlığı altında verdiğin örtük kararları madde madde yaz: palet, yazı tipleri, yerleşim, dosya yapısı, önemli etkileşimler. Ekip bunlara göre değerlendirecek.` +
    (ins ? `\nGİRDİLER (ekibin hazırladığı belgeler, tam metin — özet değil):\n${ins}` : '') + (dsk ? '\n(Tasarım becerileri de senin)' + dsk : '');
}
// gözden geçirme döngüsü: gözden geçirenler (temiz bağlam, yazmaz) → yapımcı süzer ve uygular (tek yazar) → tekrar; ciddi bulgu kalmayınca biter
async function buildLoop(p, done, rounds, runOne) {
  const bt0 = (p.board || []).find(x => x.role === 'yapimci' && !x.kind); if (!bt0) return;
  const builder = bt0.agent, builderCli = bt0.cli || bt0.provider || 'claude', revs = reviewersFor(S.hats, { builderAgent: builder, builderCli, members: membersOf(p) });
  const who = R => `${R.label} (${S.agents[R.provider]?.name || R.provider})`;
  const rejected = [], stats = p.loop = { tur: 0, bulgu: 0, uygulandi: 0, reddedildi: 0 };
  for (let round = 1; round <= rounds + 1 && !p.cancelled; round++) {
    const v = await verifyProject(p, `g${round}`), files = listFiles(wsDir(p)).slice(0, 40);
    const rb = { id: `g${round}`, agent: revs[0]?.agent || 'auditor', kind: 'gözden geçirme', needs: [], deliverable: '', status: 'çalışıyor', startedAt: Date.now(), instruction: `Gözden geçirme (tur ${round}): ${revs.map(who).join(', ') || 'otomatik kontroller'}` };
    p.board.push(rb); save(); emit('project', p);
    const findings = [], failed = [];
    if (revs.length) post(p, 'ceo', 'all', `Gözden geçirme turu ${round}: ${revs.map(who).join(', ')} ürüne bakıyor.`, { meet: 1 });
    await Promise.all(revs.map(async R => {
      const crit = (p.criteria || []).length ? `\nKABUL ÖLÇÜTLERİ:\n${p.criteria.map(c => `- ${c.id}: ${c.olcut}`).join('\n')}` : '';
      const prov0 = R.provider && provUsable(R.provider) ? R.provider : 'claude';   // yapımcıdan farklı ajan; kullanılamıyorsa Claude Code
      const review = prov => ask(p, R.agent, `GOZDEN_GECIRME (tur ${round})\nBu ürünün ${R.label} sorumlususun. Ürünü TEK bir yapımcı (${S.agents[builderCli]?.name || builderCli}, ${roleName(builder)}) yazdı; sen dosya YAZMAZSIN, yalnızca bakar ve somut geri bildirim verirsin. Odak: ${R.focus}.\n` +
        `PROJE TANIMI: ${cut(p.brief || '', 1000)}${visionText(p)}${crit}` +
        ((p.decisions || []).length ? `\nYAPIMCININ KARARLARI (bilinçli seçimler; ancak kullanıcıya zarar veriyorsa itiraz et):\n${p.decisions.map(x => '- ' + x).join('\n')}` : '') +
        `\nÜRÜN DOSYALARI (çalışma klasöründe; hepsine erişimin var, kendin oku): ${files.join(', ') || '(yok)'}${verifyText(v)}` +
        (rejected.length ? `\nYAPIMCININ GEREKÇESİYLE REDDETTİKLERİ (ikna edici değilse tekrar et, değilse önerme):\n${rejected.slice(-8).map(x => `- ${x.text} → ${x.not}`).join('\n')}` : '') +
        `\nDosyaları OKU${R.agent === 'designer' && v.visual ? ' ve ekran görüntülerini Read ile aç' : ''}. Kullanıcı bu ürünü gerçekten beğensin diye en önemli sorunları bul. En fazla 6 bulgu; zevk farkı ve belirsiz öneri yazma. Önem: kritik = kullanıcıyı engelliyor ya da açıkça kötü görünüyor; orta = belirgin kalite sorunu; kucuk = cila. Dosyaları okuyamadıysan ya da ürünü göremediysen tahmin yürütme: JSON'a "incelenemedi":true ekle.\n` +
        `Yanıtının EN SON satırı SADECE şu JSON olsun: {"olmus":["en fazla 3 güçlü yan"],"bulgular":[{"onem":"kritik|orta|kucuk","konu":"ne, nerede (dosya/bölüm)","oneri":"nasıl düzeltilir, somut"}]${R.audit ? ',"kabul":{"K1":"gecti — kanıt"},"puan":{"dogruluk":n,"tamlik":n,"talimat":n,"not":"somut kanıt"}' : ''}}`,
        { purpose: R.label, phase: 'plan', provider: prov, cat: categoryOf(R.agent, 'inceleme denetim review', '') });
      const blind = r => !r.error && (/"incelenemedi"\s*:\s*true/.test(r.response) || !findingsOf(r.response));
      let r = await review(prov0);
      // inceleyemeyen (dosya okuyamayan, biçime uymayan) ajanın boş listesi "sorun yok" sayılmaz: inceleme Claude Code ile bir kez daha yapılır
      if (blind(r) && r.provider !== 'claude' && provUsable('claude')) { logEv(p, r.provider, 'task', `${R.label}: ürünü inceleyemedi, Claude Code ile yeniden inceleniyor`); r = await review('claude'); }
      if (r.error) { failed.push(r.error); return; }
      if (blind(r)) { failed.push(`${R.label} ürünü inceleyemedi`); return; }
      const fd = findingsOf(r.response);
      if (R.audit) {
        const acc = acceptOf(fd.raw, p.criteria || []); for (const [k, x] of Object.entries(acc)) (p.acceptance ||= {})[k] = { ...x, ts: Date.now() };
        for (const [id, x] of Object.entries(acc)) if (x.durum === 'kaldi') { const c = p.criteria.find(y => y.id === id); fd.bulgular.push({ onem: 'kritik', text: `${id} karşılanmadı: ${c?.olcut || ''}${x.not ? ' — ' + x.not : ''}` }); }
        if (fd.raw.puan && typeof fd.raw.puan === 'object') (p.quality ||= {})[builder] = fd.raw.puan;
      }
      const ic = { kritik: '✗ Kritik', orta: '! Orta', kucuk: '· Küçük' };
      const lines = [...fd.olmus.map(x => '✓ ' + x), ...fd.bulgular.map(x => `${ic[x.onem]}: ${x.text}`)];
      post(p, R.agent, 'all', `${R.label}:\n` + (lines.join('\n') || 'Sorun görmedim.'), { reqId: r.id, meet: 1, cli: r.provider });
      for (const x of fd.bulgular) findings.push({ ...x, from: R.label });
    }));
    if (revs.length && failed.length === revs.length) { rb.status = 'hata'; rb.endedAt = Date.now(); rb.summary = 'Gözden geçirenler çalışamadı: ' + cut(failed[0], 120); post(p, 'ceo', 'user', `Gözden geçirme durdu: ${cut(failed[0], 160)}. Limit dolduysa sıfırlanınca "Devam et" ile sürdürebilirsin.`); save(); emit('project', p); break; }
    for (const x of v.checks.issues.filter(x => x.sev === 'hata').slice(0, 8)) findings.push({ onem: 'kritik', text: `${x.file}: ${x.msg}`, from: 'Otomatik kontrol' });
    if (v.visual) for (const e of v.visual.errors.slice(0, 5)) findings.push({ onem: 'kritik', text: 'Tarayıcıda: ' + e, from: 'Otomatik kontrol' });
    const serious = findings.filter(x => x.onem !== 'kucuk');
    rb.status = 'bitti'; rb.endedAt = Date.now(); rb.summary = `${findings.length} bulgu (${serious.length} ciddi)`; stats.tur = round; stats.bulgu += findings.length; save(); emit('project', p);
    if (!serious.length) { post(p, 'ceo', 'all', `Tur ${round}: ciddi bulgu kalmadı${findings.length ? ` (${findings.length} küçük cila önerisi)` : ''}; ürün gözden geçirmeden geçti.`, { meet: 1 }); break; }
    if (round > rounds || p.cancelled) break;   // son tur yalnızca kontrol içindir
    // yapımcı geri bildirimi süzer (uygula/reddet) ve kabul ettiklerini TEK elden uygular
    const items = [...serious, ...findings.filter(x => x.onem === 'kucuk')].slice(0, 14).map((x, i) => ({ ...x, no: i + 1 }));
    const ft = { id: `d${round}`, agent: builder, kind: 'düzeltme', role: 'yapimci', needs: [], provider: provUsable(builderCli) ? builderCli : undefined, caps: bt0.caps || [], criteria: bt0.criteria || [], deliverable: bt0.deliverable,
      instruction: `GERI_BILDIRIM_TRIYAJ (tur ${round}): Gözden geçirenler ürünün hakkında şunları söyledi. Her maddeye kullanıcının isteği, vizyon ve kendi kararların açısından bak: kullanıcıya fayda sağlıyorsa UYGULA; isteğe ters, kapsam dışı ya da yanlışsa gerekçesiyle REDDET — körü körüne her şeyi uygulama.\n` +
        items.map(x => `${x.no}. [${x.onem}] (${x.from}) ${x.text}`).join('\n') +
        `\nKabul ettiklerini dosyalarında düzelt (yalnızca ilgili yerleri); görsel düzeltmelerden sonra ${SHOT_HINT} Yanıtının sonunda (---ÖZ--- satırından önce) "---TRİYAJ---" başlığı altında her madde için tek satır yaz: "1: uygulandı — ne yaptın" ya da "2: reddedildi — gerekçe". Kararların değiştiyse "---KARARLAR---" altında güncel listeyi yaz.` };
    p.board.push({ id: ft.id, agent: ft.agent, cli: ft.provider || builderCli, kind: ft.kind, role: ft.role, caps: ft.caps, criteria: ft.criteria, instruction: `Geri bildirimi süz ve uygula (tur ${round}): ${items.length} madde`, deliverable: ft.deliverable, needs: [], status: 'bekliyor' });
    save(); emit('project', p);
    await runOne(ft);
    if (done[ft.id]?.metrics?.error) { post(p, 'ceo', 'user', `Yapımcının düzeltme turu hatayla bitti (${cut(String(done[ft.id].summary || ''), 160)}); gözden geçirme döngüsü durduruldu. Limit dolduysa sıfırlanınca "Devam et" ile sürdürebilirsin.`); break; }
    const tr = done[ft.id]?.triage || [];
    if (tr.length) {
      const ic = { uygulandi: '✓ Uygulandı', kismen: '◐ Kısmen', reddedildi: '✗ Reddedildi' };
      post(p, builder, 'all', 'Geri bildirime yanıtım:\n' + tr.map(y => `${y.no}. ${ic[y.karar]}${y.not ? ' — ' + y.not : ''}`).join('\n'), { meet: 1, cli: done[ft.id]?.metrics?.provider || builderCli });
      for (const y of tr) { const it = items.find(x => x.no === y.no); if (!it) continue; if (y.karar === 'reddedildi') { rejected.push({ text: it.text, not: y.not }); stats.reddedildi++; } else stats.uygulandi++; }
    }
    save(); emit('project', p);
  }
}

// 2) Kullanıcı planı onaylayınca ajanlar işe koyulur
async function executePlan(p, { resume = false } = {}) {
  let tasks, done = {};
  if (resume) {
    const bd = p.board = (p.board || []).filter(x => !(['ekip toplantısı', 'gözden geçirme'].includes(x.kind) && x.status !== 'bitti'));   // yarım kalan toplantı yeniden yapılır
    if (!bd.length) return;
    for (const x of bd) if (x.status === 'bitti') done[x.id] = { agent: x.agent, summary: x.summary || '', body: '', metrics: x.metrics };
    for (const x of bd) if (x.status !== 'bitti') { x.status = 'bekliyor'; delete x.startedAt; delete x.endedAt; }
    tasks = bd.filter(x => x.status !== 'bitti').map(x => ({ id: x.id, agent: x.agent, cli: x.cli, instruction: x.instruction, needs: x.needs, deliverable: x.deliverable, kind: x.kind, caps: x.caps, criteria: x.criteria, role: x.role }));
    p.interrupted = false; p.cancelled = false;
  } else {
    const plan = p.pendingPlan; if (!plan) return; p.pendingPlan = null; tasks = plan.tasks; if (plan.vision) p.vision = plan.vision; p.criteria = plan.criteria || []; p.acceptance = {};
    for (const t of tasks) t.caps ||= capsForTask(t, t.agent, p.brief);
    if (!plan.mode) { const o = productize(tasks, S.hats); tasks = o.tasks; plan.mode = o.mode; }
    p.mode = plan.mode; p.decisions = []; p.loop = null;
    for (const t of tasks) t.cli = assignCli(p, t);
    p.board = tasks.map(t => ({ id: t.id, agent: t.agent, cli: t.cli, instruction: t.instruction, deliverable: t.deliverable || '', needs: t.needs || [], caps: t.caps, criteria: t.criteria || [], role: t.role, status: 'bekliyor' }));
    p.runId = uid(); p.runStart = Date.now();
  }
  for (const t of tasks) t.cli ||= assignCli(p, t);
  // ekip haritası: hangi şapkayı hangi ajan takıyor (mesaj, günlük ve düzeltme görevleri bunu kullanır)
  p.team = { ceo: leadOf(p) }; for (const x of [...(p.board || []), ...tasks]) if (x.cli && !x.kind) p.team[x.agent] ||= x.cli;
  p.crew = [...new Set([...(p.crew || []), ...Object.values(p.team)])];
  p.executing = true; save(); emit('project', p);
  const brief = p.brief, rounds = reviewRounds();
  if (rounds && p.mode !== 'urun') for (const t of tasks) t.reviewer = reviewerFor(t, tasks);   // ürün modunda gözden geçirme döngüsü yapar
  const runOne = async t => {
    const deps = (t.needs || []).map(n => done[n]).filter(Boolean);
    post(p, 'ceo', t.agent, t.instruction);
    for (const d of deps) post(p, d.agent, t.agent, `Çıktımın özeti: ${d.summary}`, { handoff: true });
    await runTask(p, t, brief, deps, done);
  };
  try {
    await runDag(p, tasks, done, runOne);
    if (p.mode === 'urun' && rounds) await buildLoop(p, done, rounds, runOne);
    // ekip modu (içerik/araştırma): ekip toplantısı (olmuş/olmamış/olabilir → tartışma → CEO kararı) → kararlar paralel uygulanır → denetçi yeniden bakar
    else for (let round = 1; round <= rounds && !p.cancelled; round++) {
      const fixes = await teamMeeting(p, done, round);
      const ks = Object.keys(fixes); if (!ks.length || p.cancelled) break;
      const capsOf = k => [...new Set((p.board || []).filter(x => x.agent === k && !x.kind).flatMap(x => x.caps || []))];
      const tag = `r${round}`, ft = ks.map((k, i) => ({ id: `${tag}-${i + 1}`, agent: k, cli: p.team[k], kind: 'düzeltme', needs: [], caps: capsOf(k),
        instruction: `Ekip toplantısı kararlarını uygula (tur ${round}):\n` + fixes[k].slice(0, 6).map(x => '- ' + x).join('\n'),
        deliverable: [...new Set((p.board || []).filter(x => x.agent === k && !x.kind && x.deliverable).map(x => x.deliverable))].join(', ') }));
      const re = S.hats.auditor ? [{ id: `${tag}-a`, agent: 'auditor', cli: p.team.auditor, kind: 'yeniden denetim', needs: ft.map(x => x.id), deliverable: '',
        instruction: `YENİDEN DENETİM (tur ${round}): kararlaştırılan değişiklikler yapıldı mı, yeni bir sorun çıktı mı kontrol et. Kararlar:\n` + ks.map(k => `${k}: ${fixes[k].slice(0, 6).join(' | ')}`).join('\n') }] : [];
      const extra = [...ft, ...re];
      p.board.push(...extra.map(t => ({ id: t.id, agent: t.agent, cli: t.cli, kind: t.kind, caps: t.caps, instruction: t.instruction, deliverable: t.deliverable, needs: t.needs, status: 'bekliyor' })));
      tasks.push(...extra); save(); emit('project', p);
      await runDag(p, extra, done, runOne);
    }
    if (Object.keys(done).length && !p.cancelled) {
      // token harcamadan rapor: ajan özetleri + çıktı dosyaları
      scoreProject(p, done);
      const fin = await verifyProject(p, 'son');
      const ds = Object.values(done), main = ds.filter(d => !d.fix);
      const revs = (p.board || []).filter(x => x.review), applied = revs.filter(x => x.review.applied).length;
      const meets = (p.board || []).filter(x => x.meeting), decN = meets.reduce((a, x) => a + x.meeting.decisions, 0), rejN = meets.reduce((a, x) => a + x.meeting.rejected, 0);
      p.summary = cut(((p.summary || '') + ' ' + main.map(d => d.summary).join(' ')).trim(), 900);
      p.participants = [...new Set([...(p.participants || []), ...ds.map(d => d.agent)])];
      const files = listFiles(wsDir(p)), cr = p.criteria || [], acc = p.acceptance || {}, passN = cr.filter(c => acc[c.id]?.durum === 'gecti').length;
      const accText = cr.length ? `\n\nKabul ölçütleri: ${passN}/${cr.length} karşılandı` + (cr.some(c => acc[c.id]?.durum !== 'gecti') ? '\n' + cr.filter(c => acc[c.id]?.durum !== 'gecti').map(c => `• ${c.id} ${acc[c.id] ? 'karşılanmadı' : 'denetlenmedi'}: ${c.olcut}${acc[c.id]?.not ? ' — ' + acc[c.id].not : ''}`).join('\n') : '') : '';
      post(p, 'ceo', 'user', `${main.length} görev tamamlandı.\n` + main.map(d => `• ${S.agents[d.metrics?.provider || cliOf(p, d.agent)]?.name || d.agent} · ${roleName(d.agent)}: ${cut(d.summary, 160)}`).join('\n') +
        (p.loop ? `\n\nYapımcı ↔ gözden geçirme: ${p.loop.tur} tur, ${p.loop.bulgu} bulgu, ${p.loop.uygulandi} uygulandı, ${p.loop.reddedildi} gerekçeyle reddedildi.` : '') +
        (revs.length || meets.length ? `\n\nEkip içi kalite: ${revs.length} akran incelemesi (${applied} tanesinde öneriler uygulandı)${meets.length ? `, ${meets.length} ekip toplantısı (${decN} karar uygulandı${rejN ? `, ${rejN} öneri reddedildi` : ''})` : ''}.` : '') +
        accText + `\n\nOtomatik doğrulama: ${fin.checks.errors} hata, ${fin.checks.warnings} uyarı${fin.visual ? `, tarayıcıda ${fin.visual.errors.length} sorun` : ''}.` + (files.length ? `\n\nÇıktı dosyaları (${files.length}):\n` + files.slice(0, 20).map(x => '• ' + x).join('\n') : ''));
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
  for (const id of new Set(ids)) { const a = S.hats[id]; a.scores.push({ score: rating * 2, from: 'user', why: note || '', project: p.name, ts: Date.now() }); a.scores = a.scores.slice(-40); }
  for (const k of new Set(p.crew || [])) { const a = S.agents[k]; if (a) { a.scores.push({ score: rating * 2, from: 'user', why: note || '', project: p.name, ts: Date.now() }); a.scores = a.scores.slice(-60); } }   // ajanın (CLI) seviyesi
  for (const x of p.board || []) if (x.provider && x.cat && x.status === 'bitti') recordResult(S.routing, x.provider, x.cat, rating * 2, { w: 0.5 });   // senin puanın da CLI seçimine yarım ağırlıkla yansır
  const uniq = [...new Set(ids)];
  const info = uniq.map(id => {
    const got = (p.scores || []).filter(x => x.to === id).map(x => `${x.from}:${x.score}/10 ${x.why}`).join('; ');
    const mine = (p.tasksLog || []).filter(t => t.agent === id).map(t => t.instruction).join(' | ') || 'koordinasyon';
    return `${id} (${S.hats[id].title}): işi=${cut(mine, 200)}${got ? `; aldığı puanlar=${cut(got, 300)}` : ''}`;
  }).join('\n');
  const r = await ask(p, 'ceo', `DERS_YAZ\nProje: ${p.name}. Kullanıcı geri bildirimi → ${fb}\nAjanlar:\n${info}\nHer ajan için gelecek projelerde işe yarayacak EN FAZLA 2 kalıcı ders yaz (somut, bu kullanıcıya özgü, genel geçer laf yok). SADECE JSON: {"<ajan anahtarı>":["ders", "ders"],"kullanici":["bu kullanıcının kalıcı tercihi (varsa, en fazla 2, kısa)"]}`, { purpose: 'dersleri çıkar', phase: 'text', model: 'haiku' });
  let out = {}; try { out = JSON.parse(r.response.match(/\{[\s\S]*\}/)[0]); } catch {}
  for (const x of (Array.isArray(out.kullanici) ? out.kullanici : []).map(String).filter(x => x.length > 6).slice(0, 2)) if (!S.shared.prefs.includes(x)) S.shared.prefs.push(x);
  S.shared.prefs = S.shared.prefs.slice(-12);
  for (const id of uniq) {
    const lessons = (Array.isArray(out[id]) ? out[id] : []).map(String).filter(l => l.length > 8).slice(0, 2);
    const ag = S.hats[id];
    for (const l of lessons) addLesson(ag, l, 'kullanici');
    if (lessons.length) post(p, id, 'user', `Öğrendiklerim:\n${lessons.map(l => '• ' + l).join('\n')}`, { reqId: r.id });
  }
  p.finished = true; save(); emit('state', publicState());
}

// şapka ayarları: yönerge, araçlar, beceriler, dersler, sabit ajan tercihi
async function setDirective(agentId, patch) {
  const a = S.hats[agentId]; const changed = patch.directive != null && patch.directive !== a.directive;
  for (const k of ['name', 'title', 'model', 'directive', 'tools']) if (patch[k] != null) a[k] = patch[k];
  if (patch.think != null) a.think = !!patch.think;
  if (AGENT_PROVIDERS.includes(patch.provider)) a.provider = patch.provider;
  if (patch.turns != null) a.turns = Math.max(1, Math.min(60, +patch.turns || a.turns));
  if (Array.isArray(patch.customSkills)) a.customSkills = patch.customSkills.map(cleanCustomSkill).filter(Boolean).slice(0, 12);
  if (Array.isArray(patch.skillsOff)) { const ids = new Set(skillsOf(agentId, a).map(x => x.id)); a.skillsOff = patch.skillsOff.filter(x => ids.has(x)); }
  if (Array.isArray(patch.lessons)) a.lessons = patch.lessons.filter(l => l && typeof l.t === 'string').map(l => ({ t: String(l.t).slice(0, 180), src: String(l.src || 'kullanici'), w: +l.w || 1, n: +l.n || 1, ts: +l.ts || Date.now() })).slice(0, 24);
  save(); emit('state', publicState());
  if (changed) {
    const p = S.projects[S.projects.length - 1]; if (!p) return;
    const r = await ask(p, agentId, `YONERGE_ANLA\nYeni yönergen: """${a.directive}"""\nBunu kendi cümlelerinle en fazla 2 cümlede özetle, sonra yönergede belirsiz bulduğun TEK noktayı soru olarak yaz (yoksa "Net." de).`, { purpose: 'yönerge anlama', phase: 'text', model: a.model });
    post(p, agentId, 'user', r.response, { reqId: r.id });
  }
}

// ajan (CLI) ayarları: görünen ad, renk ve (Claude için) model
function setAgent(k, patch) {
  const a = S.agents[k];
  if (patch.name != null) a.name = String(patch.name).trim().slice(0, 20) || DEFAULT_CREW[k].name;
  if (/^#[0-9a-f]{6}$/i.test(patch.color || '')) a.color = patch.color;
  if (k === 'claude' && ['sonnet', 'opus', 'haiku', 'fable'].includes(patch.model)) a.model = patch.model;
  if (Array.isArray(patch.lessons)) a.lessons = patch.lessons.filter(l => l && typeof l.t === 'string').slice(0, 24);
  save(); emit('state', publicState());
}

// ---------- Ofisler ----------
function cleanOffice(o, b) {
  const members = [...new Set((Array.isArray(b.members) ? b.members : o.members || []).filter(k => DEFAULT_CREW[k]))];
  if (b.name != null) o.name = String(b.name).trim().slice(0, 30) || o.name || 'Ofis';
  o.members = members.length ? members : ['claude'];
  o.lead = DEFAULT_CREW[b.lead] && o.members.includes(b.lead) ? b.lead : o.members.includes(o.lead) ? o.lead : o.members[0];
  return o;
}
function addOffice(b) {
  if (S.offices.length >= 8) throw new Error('En fazla 8 ofis');
  const o = cleanOffice({ id: uid(), name: 'Yeni ofis', members: ['claude'], ts: Date.now() }, b);
  S.offices.push(o); save(); emit('state', publicState()); return o;
}
function removeOffice(id) {
  const o = S.offices.find(x => x.id === id); if (!o) throw new Error('ofis yok');
  if (S.offices.length === 1) throw new Error('Son ofis silinemez');
  if (S.projects.some(p => p.officeId === id && p.executing)) throw new Error('Bu ofiste çalışan proje var');
  S.offices = S.offices.filter(x => x !== o);
  for (const p of S.projects) if (p.officeId === id) p.officeId = S.offices[0].id;   // projeler silinmez, ilk ofise taşınır
  save(); emit('state', publicState());
}

// ---------- Şapka ekleme/silme (kendi rolün) ----------
const PALETTE = ['#f59e0b', '#22c55e', '#06b6d4', '#f97316', '#e879f9', '#84cc16', '#38bdf8', '#fb7185'];
const PRESETS = { arastirma: `${READ},Write,${WEB}`, yazilim: `${READ},Write,Edit,Bash`, yazar: `${READ},Write,Edit`, tasarim: `${READ},Write,Edit,${WEB}`, denetim: READ };
function addAgent(b) {
  const name = String(b.name || '').trim().slice(0, 20), title = String(b.title || '').trim().slice(0, 30);
  if (!name || !title) throw new Error('Ad ve rol gerekli');
  if (Object.keys(S.hats).length >= 10) throw new Error('En fazla 9 ajan eklenebilir');
  let key = (slug(title).replace(/-/g, '') || 'ajan'); if (['user', 'all', 'kullanici'].includes(key)) key += 'x';
  let k = key, i = 2; while (S.hats[k]) k = key + i++;
  S.hats[k] = { name, title, color: PALETTE[(Object.keys(S.hats).length - 1) % PALETTE.length], model: ['opus', 'sonnet', 'haiku'].includes(b.model) ? b.model : 'haiku', turns: 10, think: false,
    provider: AGENT_PROVIDERS.includes(b.provider) ? b.provider : 'auto', tools: PRESETS[b.preset] || String(b.tools || READ), preset: PRESETS[b.preset] ? b.preset : undefined, directive: String(b.directive || '').slice(0, 800) || 'Kısa ve net çalış. Çıktıları çalışma klasörüne yaz.', lessons: [], scores: [] };
  save(); emit('state', publicState()); return k;
}
function removeAgent(id) {
  if (id === 'ceo' || !S.hats[id]) throw new Error('Bu ajan silinemez');
  delete S.hats[id]; for (const p of S.projects) p.participants = (p.participants || []).filter(x => x !== id);
  save(); emit('state', publicState());
}

// ---------- Proje şablonları (araştırma ve plan için token harcamaz) ----------
function templatePlan(key) {
  const t = TEMPLATES[key]; if (!t) return null;
  const tasks = t.tasks.filter(x => S.hats[x.agent]).map(x => ({ ...x }));
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
const hatsState = () => Object.fromEntries(Object.entries(S.hats).map(([k, a]) => [k, { ...a, level: levelOf(a), focus: focusOf(a), charter: charterFor(k, S.settings.lang), baseline: baselineOf(k, S.settings.baseMin || {}), skillList: skillsOf(k, a).map(({ id, name, desc, when, steps, done, on, own, always }) => ({ id, name, desc, when: Array.isArray(when) ? when.join(', ') : when, steps, done, on, own, always: !!always })) }]));
const publicState = () => ({ capabilities: CAPABILITIES.map(({ id, name, desc, roles }) => ({ id, name, desc, roles })), hats: hatsState(),
  agents: Object.fromEntries(Object.entries(S.agents).map(([k, a]) => [k, { ...a, label: PROVIDERS[k].label, level: levelOf(a), usable: provUsable(k), installed: k === 'claude' ? !!CLAUDE || FORCE_DEMO : !!BINS[k] || FORCE_DEMO }])),
  offices: S.offices, ext: S.ext, user: USER, projects: S.projects.map(({ procs, ...x }) => ({ ...x, own: !!x.dir && path.dirname(path.resolve(x.dir)).toLowerCase() === path.resolve(WORK).toLowerCase() })), requests: S.requests.map(reqMeta), parallel: parallel(), approvals: [...approvals.values()].map(strip),
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
    const okOrigin = !req.headers.origin || new RegExp(`^http://(localhost|127\\.0\\.0\\.1):${PORT}$`).test(req.headers.origin);
    if (!okHost || !okOrigin) { res.writeHead(403); return res.end('yasak'); }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (parts[0] === 'api') {
      if (req.method === 'GET' && parts[1] === 'state') return json(res, publicState());
      if (req.method === 'GET' && parts[1] === 'requests' && parts[2]) { const r = S.requests.find(x => x.id === parts[2]); return r ? json(res, r) : json(res, { error: 'bulunamadı' }, 404); }
      if (req.method === 'POST' && parts[1] === 'approval') { const b = await body(req); return json(res, await requestApproval(b)); }   // approver.js'ten
      if (req.method === 'POST' && parts[1] === 'self-shot') { const b = await body(req); return json(res, await selfShot(b)); }   // approver.js'ten: ajanın ekran görüntüsü aracı
      if (req.method === 'POST' && parts[1] === 'approvals' && parts[2] === 'bulk') { const b = await body(req); let n = 0; for (const a of [...approvals.values()]) if ((!b.risk || a.risk === b.risk) && (!b.project || a.projectId === b.project)) { a.settle(b.decision === 'allow' ? 'allow' : 'deny', false); n++; } return json(res, { ok: true, n }); }
      if (req.method === 'POST' && parts[1] === 'approvals' && approvals.has(parts[2])) { const b = await body(req); approvals.get(parts[2]).settle(b.decision === 'allow' ? 'allow' : 'deny', !!b.always); return json(res, { ok: true }); }
      if (req.method === 'POST' && parts[1] === 'pick-folder') return json(res, await pickFolder());
      if (req.method === 'POST' && parts[1] === 'projects' && !parts[2]) {
        const b = await body(req); const p = { id: uid(), name: String(b.name || 'Yeni Proje').slice(0, 60), officeId: S.offices.some(o => o.id === b.officeId) ? b.officeId : S.offices[0].id, ts: Date.now(), messages: [], summary: '', participants: [], tasksLog: [], allow: {} };
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
        if (parts[3] === 'revert') {
          if (p.executing) return json(res, { error: 'Ajanlar çalışırken geri alınamaz' }, 400);
          const bt = (p.board || []).find(x => x.snap === b.snap); if (!bt) return json(res, { error: 'adım bulunamadı' }, 404);
          let r; try { r = restoreSnapshot(p, b.snap); } catch (e) { return json(res, { error: e.message }, 400); }
          const from = bt.startedAt || r.ts;   // bu adım ve sonrası: asıl görevler sıraya döner, toplantı/düzeltme adımları kalkar
          p.board = (p.board || []).filter(x => !(x.kind && (x.startedAt || 0) >= from));
          for (const x of p.board) if (x === bt || (x.startedAt || 0) >= from) { x.status = 'bekliyor'; for (const k of ['startedAt', 'endedAt', 'summary', 'metrics', 'review', 'score', 'snap', 'skills']) delete x[k]; }
          p.acceptance = {};
          post(p, 'ceo', 'user', `Çalışma klasörü "${cut(bt.instruction, 60)}" adımından önceki hâline döndürüldü: ${r.restored} dosya geri yüklendi${r.moved.length ? `, sonradan oluşan ${r.moved.length} dosya silinmedi, şuraya taşındı: ${r.trash}` : ''}. "Devam et" ile bu adımdan itibaren yeniden çalıştırabilirsin.`);
          save(); emit('project', p); return json(res, { ok: true, ...r });
        }
        if (parts[3] === 'rerun') { const r = (p.runs || []).find(x => x.id === b.run); if (!r) return json(res, { error: 'çalıştırma bulunamadı' }, 404); p.pendingPlan = { id: uid(), tasks: r.tasks.filter(x => !x.kind).map(({ id, agent, instruction, deliverable, needs }) => ({ id, agent, instruction, deliverable, needs })), research: [], needs: [], reply: 'Önceki çalıştırmanın planı yeniden yüklendi. Onaylarsan aynı görevler tekrar çalışır.', questions: [] }; post(p, 'ceo', 'user', p.pendingPlan.reply, { plan: p.pendingPlan }); save(); emit('project', p); return json(res, { ok: true }); }
        if (parts[3] === 'settings') { if (b.budget != null) { p.budget = Math.max(0, Math.round(+b.budget || 0)); p.warned = false; if (p.cancelled && !p.executing) p.cancelled = false; } if (b.autoLow != null) p.autoLow = !!b.autoLow; save(); emit('project', p); return json(res, { ok: true }); }
        if (parts[3] === 'delete') {   // projeyi sil: kayıtlar gider; çalışma klasörü SADECE uygulamanın kendi klasörüyse ve istenirse silinir
          if (p.executing) stopProject(p);
          for (const a of [...approvals.values()]) if (a.projectId === p.id) a.settle('deny', false, 'Proje silindi.');
          const dir = p.dir ? path.resolve(p.dir) : null, own = !!dir && path.dirname(dir).toLowerCase() === path.resolve(WORK).toLowerCase();
          S.projects = S.projects.filter(x => x !== p);
          S.requests = S.requests.filter(r => r.projectId !== p.id); S.log = S.log.filter(e => e.project !== p.id);
          for (const a of Object.values(S.hats)) a.scores = (a.scores || []).filter(x => x.project !== p.name || S.projects.some(q => q.name === p.name));
          let removed = false; if (b.files && own) { try { fs.rmSync(dir, { recursive: true, force: true }); removed = true; } catch {} }
          if (!S.projects.length) { const n = { id: uid(), name: 'Yeni proje', ts: Date.now(), messages: [], summary: '', participants: [], tasksLog: [], allow: {} }; wsDir(n); S.projects.push(n); }
          save(); emit('state', publicState()); return json(res, { ok: true, filesRemoved: removed, keptDir: own && !removed ? dir : (!own ? dir : null) });
        }
        if (parts[3] === 'stop') { stopProject(p); return json(res, { ok: true }); }
        if (parts[3] === 'finish') { json(res, { ok: true }); finishProject(p, b.rating || 3, b.note).catch(console.error); return; }
        if (parts[3] === 'open') { if (process.platform === 'win32') spawn('explorer', [wsDir(p)], { detached: true, stdio: 'ignore' }).unref(); return json(res, { ok: true, dir: wsDir(p) }); }
      }
      if (req.method === 'GET' && parts[1] === 'projects' && p && parts[3] === 'files') return json(res, { dir: wsDir(p), files: listFiles(wsDir(p)) });
      if (req.method === 'GET' && parts[1] === 'projects' && parts[3] === 'preview' && S.projects.find(x => x.id === parts[2])) {
        const p = S.projects.find(x => x.id === parts[2]), dir = wsDir(p), entry = entryHtml(dir);
        const pages = walk(dir, 300).filter(x => /\.html?$/i.test(x)).map(x => path.relative(dir, x).replace(/\\/g, '/')).slice(0, 30);
        return json(res, { port: PREVIEW_PORT, base: PREVIEW_PORT ? `http://127.0.0.1:${PREVIEW_PORT}/${p.id}/` : null, entry: entry ? path.relative(dir, entry).replace(/\\/g, '/') : null, pages });
      }
      if (req.method === 'GET' && parts[1] === 'shot' && /^[\w-]+$/.test(parts[2] || '') && /^[\w-]+$/.test(parts[3] || '') && /^(masaustu|mobil)(-\d+)?\.png$/.test(parts[4] || '')) {
        const fp = path.join(SHOTS, parts[2], parts[3], parts[4]); if (!fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(fp));
      }
      if (req.method === 'POST' && parts[1] === 'hats' && !parts[2]) { const b = await body(req); try { return json(res, { ok: true, key: addAgent(b) }); } catch (e) { return json(res, { error: e.message }, 400); } }
      if (req.method === 'POST' && parts[1] === 'hats' && parts[3] === 'delete') { try { removeAgent(parts[2]); return json(res, { ok: true }); } catch (e) { return json(res, { error: e.message }, 400); } }
      if (req.method === 'POST' && parts[1] === 'offices' && !parts[2]) { const b = await body(req); try { return json(res, { ok: true, office: addOffice(b) }); } catch (e) { return json(res, { error: e.message }, 400); } }
      if (req.method === 'POST' && parts[1] === 'offices' && parts[3] === 'delete') { try { removeOffice(parts[2]); return json(res, { ok: true }); } catch (e) { return json(res, { error: e.message }, 400); } }
      if (req.method === 'POST' && parts[1] === 'offices' && S.offices.some(o => o.id === parts[2])) { const b = await body(req); cleanOffice(S.offices.find(o => o.id === parts[2]), b); save(); emit('state', publicState()); return json(res, { ok: true }); }
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
      if (req.method === 'POST' && parts[1] === 'settings') { const b = await body(req); if (b.lang === 'tr' || b.lang === 'en') S.settings.lang = b.lang; if ([1, 2, 3].includes(+b.parallel)) S.settings.parallel = +b.parallel; if (b.review !== undefined && [0, 1, 2].includes(+b.review)) S.settings.review = +b.review; if (b.providers && typeof b.providers === 'object') for (const k of ['codex', 'antigravity']) { const v = b.providers[k]; if (!v || typeof v !== 'object') continue; const c = S.settings.providers[k]; if (v.on != null) c.on = !!v.on; if (v.model != null) c.model = safeModel(v.model); if (k === 'antigravity' && v.trust != null) c.trust = !!v.trust; } if (b.resetRouting) S.routing = {}; for (const k of ['subUsd', 'hourTry', 'usdTry']) if (b[k] !== undefined) S.settings[k] = Math.max(0, +b[k] || 0) || null; if (b.baseMin && typeof b.baseMin === 'object') S.settings.baseMin = Object.fromEntries(Object.entries(b.baseMin).filter(([k, v]) => S.hats[k] && +v > 0).map(([k, v]) => [k, Math.min(2400, +v)])); save(); emit('state', publicState()); return json(res, { ok: true }); }
      if (req.method === 'POST' && parts[1] === 'event') {   // dış araçlar durum bildirebilir: {name, state: working|idle|blocked|done, note}
        if (process.env.OFIS_API_TOKEN && req.headers['x-ofis-token'] !== process.env.OFIS_API_TOKEN) return json(res, { error: 'token gerekli' }, 401);
        const b = await body(req); const name = String(b.name || '').trim().slice(0, 24); if (!name) return json(res, { error: 'name gerekli' }, 400);
        const key = 'ext_' + (slug(name).replace(/-/g, '') || 'dis'); let created = false;
        if (!S.ext[key]) { S.ext[key] = { name, title: name, color: PALETTE[Object.keys(S.ext).length % PALETTE.length], external: true }; created = true; }
        S.ext[key].lastSeen = Date.now(); save(); if (created) emit('state', publicState());
        const st = { working: 'working', idle: 'idle', blocked: 'waiting', done: 'done', error: 'error' }[b.state] || 'working';
        status(key, st, String(b.note || '').slice(0, 60)); return json(res, { ok: true, agent: key });
      }
      if (req.method === 'POST' && parts[1] === 'memory') { const b = await body(req); if (Array.isArray(b.prefs)) S.shared.prefs = b.prefs.map(x => String(x).slice(0, 160)).filter(Boolean).slice(-12); save(); emit('state', publicState()); return json(res, { ok: true }); }
      if (req.method === 'POST' && parts[1] === 'hats' && S.hats[parts[2]]) {
        const b = await body(req); json(res, { ok: true }); setDirective(parts[2], b).catch(console.error); return;
      }
      if (req.method === 'POST' && parts[1] === 'agents' && S.agents[parts[2]]) { const b = await body(req); setAgent(parts[2], b); return json(res, { ok: true }); }
    }
    const f = path.join(__dir, 'public', url.pathname === '/' ? 'index.html' : url.pathname.replace(/\.\./g, ''));
    if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); return res.end(fs.readFileSync(f)); /* no-cache: güncellenen dosya hemen görünsün */ }
    res.writeHead(404); res.end('yok');
  } catch (e) { json(res, { error: e.message }, 500); }
}).on('error', e => { if (e.code === 'EADDRINUSE') console.log('Sunucu zaten çalışıyor; mevcut oturuma bağlanılıyor.'); else throw e; }).listen(PORT, '127.0.0.1', () => {
  console.log(`Ofis hazır → http://localhost:${PORT}  (Claude Code: ${CLAUDE ? CLAUDE : 'bulunamadı'}${FORCE_DEMO ? ', test modu' : ''})`);
  if (!SHOWCASE) { checkAuth(); checkProviders(); }
});

// ---------- Canlı önizleme ----------
// Üretilen site/oyun AYRI bir porttan, salt okunur ve yalnızca projenin çalışma klasöründen sunulur. Ayrı port = ayrı köken:
// sayfanın JavaScript'i uygulamanın API'sine istek atamaz (API yalnızca kendi portundan gelen tarayıcı isteklerini kabul eder).
const PREVIEW_MIME = { ...MIME, '.htm': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8' };
let PREVIEW_PORT = Number(process.env.OFIS_PREVIEW_PORT || PORT + 1);
http.createServer((req, res) => {
  try {
    const host = req.headers.host || '';
    if (!new RegExp(`^(localhost|127\\.0\\.0\\.1):${PREVIEW_PORT}$`).test(host) || req.method !== 'GET') { res.writeHead(403); return res.end('yasak'); }
    const url = new URL(req.url, 'http://x'), [pid, ...rest] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const p = S.projects.find(x => x.id === pid); if (!p) { res.writeHead(404); return res.end('proje yok'); }
    const root = wsDir(p), fp = path.resolve(root, rest.join('/') || 'index.html');
    if (!(fp === root || fp.toLowerCase().startsWith(root.toLowerCase() + path.sep)) || rest.some(x => x.startsWith('.'))) { res.writeHead(403); return res.end('yasak'); }
    const file = fs.existsSync(fp) && fs.statSync(fp).isDirectory() ? path.join(fp, 'index.html') : fp;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Dosya yok: ' + rest.join('/')); }
    res.writeHead(200, { 'content-type': PREVIEW_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  } catch { res.writeHead(500); res.end(); }
}).on('error', e => { console.log(`Önizleme sunucusu açılamadı (${e.code}); önizleme kapalı.`); PREVIEW_PORT = 0; }).listen(PREVIEW_PORT, '127.0.0.1');

