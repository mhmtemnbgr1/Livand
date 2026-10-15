// LIVAND Ofis — çoklu CLI sağlayıcısı (Claude Code, OpenAI Codex CLI, Google Antigravity CLI) ve öğrenen yönlendirici (saf işlevler, token harcamaz).
// Her görev bir kategoriye ayrılır; hangi CLI'nin o kategoride iyi olduğu önce dış kaynaklardan gelen hafif bir ön bilgiyle başlar,
// sonra senin projelerindeki gerçek puanlarla (teslimat, denetçi kalitesi, verimlilik, senin puanın) öğrenilir.

import fs from 'node:fs';
import path from 'node:path';

export const PROVIDERS = {
  claude:      { label: 'Claude Code', bin: 'claude', web: true },
  codex:       { label: 'Codex CLI',   bin: 'codex',  web: false },   // workspace-write sandbox'ta ağ kapalı → web araştırmasına verilmez
  antigravity: { label: 'Antigravity CLI', bin: 'agy', web: true },
};
export const PROVIDER_KEYS = Object.keys(PROVIDERS);
export const AGENT_PROVIDERS = [...PROVIDER_KEYS, 'auto'];

// Görevin zorunlu ihtiyacına göre bu CLI işi yapabilir mi? web: dış bilgi gerekir; bash: komut çalıştırmak şart (asset aracı, çalıştırıp doğrulama)
export function providerFits(k, { web = false, bash = false } = {}, cfg = {}) {
  if (!PROVIDERS[k]) return { ok: false, why: 'bilinmeyen CLI' };
  if (web && !PROVIDERS[k].web) return { ok: false, why: `${PROVIDERS[k].label}'de ağ kapalı, web araştırması yapamaz` };
  if (bash && k === 'antigravity' && !cfg.trust) return { ok: false, why: 'Antigravity "tam yetki" kapalıyken komut çalıştıramaz' };
  return { ok: true };
}

// Claude dışındaki CLI'lere çalışma ortamı notu: istemler Claude Code'a göre yazıldı (Read, Grep, WebSearch, onay kutusu);
// her CLI aynı işi kendi araçlarıyla nasıl yapacağını ve sınırlarını bilsin.
export function cliGuide(k, { phase = 'work', trust = false, shot = false } = {}) {
  const work = phase === 'work';
  const common = '\nProjenin çalışma klasörü senin de çalışma klasörün: içindeki TÜM dosyalara erişimin var; incelerken dosyaları kendin aç ve oku, özete güvenme.' +
    '\nYanıt biçimine (JSON satırı, ---KARARLAR---, ---TRİYAJ---, ---ÖZ---, ---ÖZET--- gibi bölümler) HARFİYEN uy; ofis yanıtını bu bölümlerden okur. Ekran görüntüsü yolu verilmişse görselleri açabiliyorsan bak; açamıyorsan kodu ve otomatik kontrol sonuçlarını kullan ve bunu belirt.';
  if (k === 'codex') return `\nÇALIŞMA ORTAMIN (Codex CLI): İstemdeki Claude Code araç adları (Read, Glob, Grep, Write, Edit, WebSearch) ve onay kutusu sende yok; aynı işi kendi araçlarınla yap: okumak ve aramak için kabuk komutları (rg, Get-Content/type), değiştirmek için dosya düzenleme aracın. AĞ KAPALI: web'e erişemezsin; dış bilgi gerekiyorsa varsayım olarak işaretle.` +
    ' Ofisin "screenshot" MCP aracı sende de var (mcp__ofis__screenshot yazan yerde onu kullan): sayfanın tam sayfa ekran görüntüsünü alır ve PNG yollarını döndürür; görselleri görüntüleme aracınla aç.' +
    (work ? ' Yalnızca çalışma klasörüne yazabilirsin; komutlar sandbox içinde onaysız çalışır (asset aracı gibi verilen komutları çalıştırabilirsin).' : ' Bu aşamada SALT OKUNURSUN: hiçbir dosyayı değiştirme.') + common;
  if (k === 'antigravity') return `\nÇALIŞMA ORTAMIN (Antigravity CLI): İstemdeki Claude Code araç adları (Read, Glob, Grep, Write, Edit, WebSearch) ve onay kutusu sende yok; aynı işi kendi okuma, arama ve düzenleme araçlarınla yap.` +
    (shot ? ' Ofisin "ofis" MCP sunucusundaki "screenshot" aracı sende de var (mcp__ofis__screenshot yazan yerde onu kullan): sayfanın tam sayfa ekran görüntüsünü alır ve PNG yollarını döndürür; görselleri dosya görüntüleme aracınla aç.' : ' Ekran görüntüsü aracın yok: mcp__ofis__screenshot yazan yerde verilen ekran görüntüsü yollarını aç, yoksa kodu oku.') +
    (!work ? ' Plan modundasın: yalnızca oku, hiçbir dosyayı değiştirme.' : trust ? ' Dosya düzenleyebilir, komutları sandbox içinde sormadan çalıştırabilirsin.' : ' Dosya düzenleyebilirsin ama KOMUT ÇALIŞTIRAMAZSIN (izin reddedilir): komut gerektiren adımı tekrar deneme; atla ve yanıtında ne yapılması gerektiğini yaz.') + common;
  return '';
}

export const CATEGORIES = {
  kod: 'Kod yazma / hata düzeltme', terminal: 'Komut, kurulum, test, derleme', arayuz: 'Arayüz / ön yüz (HTML, CSS, UI)',
  arastirma: 'Web araştırması', yazi: 'Metin / içerik', denetim: 'Denetim / kod inceleme', plan: 'Planlama',
};

// Ön bilgi (1-10). Bilerek dar aralıkta (6,3-7,2) tutulur ve sadece PRIOR_N sanal görev ağırlığındadır: birkaç gerçek görevden sonra senin verin belirler.
// Kaynaklar resmî duyurular ve kıyas tablolarıdır; sürümler hızlı değiştiği için kesin sıralama değil, başlangıç eğilimidir.
export const PRIOR_N = 3;
export const PRIOR_SRC = {
  claude: 'SWE-bench Verified (gerçek depo hatası düzeltme) kıyaslarında önde; uzun ajan işlerinde güçlü',
  codex: 'Terminal-Bench (terminal/komut görevleri) kıyaslarında önde veya başa baş; OpenAI kodlama ajanı olarak konumluyor',
  antigravity: 'Google Gemini modelleri: WebDev Arena (web arayüzü) ve Google araması ile araştırmada güçlü; ucuz/hızlı Flash varsayılanı',
};
export const PRIORS = {
  claude:      { kod: 7.2, terminal: 6.8, arayuz: 6.8, arastirma: 6.7, yazi: 7.0, denetim: 7.0, plan: 7.0 },
  codex:       { kod: 6.9, terminal: 7.2, arayuz: 6.5, arastirma: 6.0, yazi: 6.3, denetim: 6.8, plan: 6.5 },
  antigravity: { kod: 6.5, terminal: 6.4, arayuz: 7.0, arastirma: 6.9, yazi: 6.5, denetim: 6.3, plan: 6.5 },
};

const ROLE_CAT = { developer: 'kod', designer: 'arayuz', researcher: 'arastirma', writer: 'yazi', auditor: 'denetim', ceo: 'plan' };
export function categoryOf(agentId, instruction = '', deliverable = '') {
  if (agentId === 'auditor') return 'denetim';
  if (agentId === 'ceo') return 'plan';
  const s = `${instruction} ${deliverable}`.toLowerCase();
  if (/\b(npm|pip|kur(ulum)?|install|derle|build|deploy|terminal|komut|script|betik|test(ler)?i? çalıştır|cli)\b/.test(s)) return 'terminal';
  if (/\.(html|css|jsx|tsx|vue|svelte)\b|arayüz|ön yüz|frontend|\bui\b|landing|sayfa tasarım|responsive/.test(s)) return 'arayuz';
  if (/\.(js|ts|mjs|py|go|rs|java|cs|php|rb|sql)\b|\bkod|api|hata düzelt|bug|refactor|fonksiyon|endpoint/.test(s)) return 'kod';
  if (/araştır|kaynak|karşılaştır|rakip|pazar|research/.test(s)) return 'arastirma';
  if (/denetle|incele|review|kontrol et/.test(s)) return 'denetim';
  if (/\.(md|txt|docx)\b|metin|yazı|blog|içerik|e-?posta|makale|copy/.test(s)) return 'yazi';
  return ROLE_CAT[agentId] || 'kod';
}

// ---- öğrenme: stats[provider][cat] = { n, sum, fails, ts } (n ağırlıklı görev sayısı) ----
export function recordResult(stats, provider, cat, score, { w = 1, failed = false, ts = Date.now() } = {}) {
  if (!PROVIDERS[provider] || !CATEGORIES[cat] || !Number.isFinite(+score)) return stats;
  const c = ((stats[provider] ||= {})[cat] ||= { n: 0, sum: 0, fails: 0, ts: 0 });
  c.n = +(c.n + w).toFixed(3); c.sum = +(c.sum + w * Math.min(10, Math.max(1, +score))).toFixed(3); if (failed) c.fails++; c.ts = ts;
  return stats;
}
export function estimate(stats, provider, cat) {
  const c = stats?.[provider]?.[cat] || { n: 0, sum: 0, fails: 0 };
  const prior = PRIORS[provider]?.[cat] ?? 6.5;
  return { mean: (prior * PRIOR_N + c.sum) / (PRIOR_N + c.n), n: c.n, fails: c.fails || 0, prior };
}

// Seçim: en yüksek tahmin kazanır; ama bir sağlayıcı bu kategoride henüz MIN_TRIALS görev almadıysa explore olasılığıyla ona da şans verilir.
export const MIN_TRIALS = 3;
export function pickProvider(stats, cat, available, { explore = 0.1, rand = Math.random } = {}) {
  let cand = available.filter(k => PROVIDERS[k] && (cat !== 'arastirma' || PROVIDERS[k].web));
  if (!cand.length) cand = available.filter(k => PROVIDERS[k]);
  if (!cand.length) return null;
  const est = Object.fromEntries(cand.map(k => [k, estimate(stats, k, cat)]));
  const best = [...cand].sort((a, b) => est[b].mean - est[a].mean)[0];
  const fresh = cand.filter(k => k !== best && est[k].n < MIN_TRIALS);
  if (fresh.length && rand() < explore) {
    const k = fresh[Math.floor(rand() * fresh.length) % fresh.length];
    return { provider: k, why: `deneme: ${PROVIDERS[k].label} bu işte az denendi (${est[k].n} görev)`, est };
  }
  return { provider: best, why: `${CATEGORIES[cat]} için en iyi tahmin: ${est[best].mean.toFixed(1)}/10 (${est[best].n ? est[best].n + ' görev' : 'ön bilgi'})`, est };
}

// ---- Codex CLI (codex exec --json) olaylarını ortak biçime çevirir ----
// https://developers.openai.com/codex/noninteractive : thread.started, turn.*, item.started/completed (agent_message, command_execution, file_change, web_search, mcp_tool_call), error
export function parseCodexLine(m, acc) {
  const ev = [];
  const it = m.item || {};
  if (m.type === 'item.started' || (m.type === 'item.completed' && it.type === 'file_change')) {
    if (it.type === 'command_execution' && m.type === 'item.started') { acc.steps++; ev.push({ kind: 'tool', name: 'Bash', input: { command: it.command } }); }
    else if (it.type === 'file_change') { acc.steps++; for (const c of it.changes || []) ev.push({ kind: 'tool', name: c.kind === 'add' ? 'Write' : 'Edit', input: { file_path: c.path } }); }
    else if (it.type === 'web_search' && m.type === 'item.started') { acc.steps++; ev.push({ kind: 'tool', name: 'WebSearch', input: { query: it.query } }); }
    else if (it.type === 'mcp_tool_call' && m.type === 'item.started') { acc.steps++; ev.push({ kind: 'tool', name: String(it.tool || 'mcp'), input: {} }); }
  }
  if (m.type === 'item.completed') {
    if (it.type === 'agent_message' && it.text) { acc.text = it.text; ev.push({ kind: 'text', text: it.text }); }
    if (it.type === 'command_execution') ev.push({ kind: it.exit_code ? 'error' : 'result', text: String(it.aggregated_output || '').slice(-400) || `çıkış kodu ${it.exit_code ?? '?'}` });
  }
  if (m.type === 'turn.completed' && m.usage) {
    const u = m.usage, cached = u.cached_input_tokens || 0;
    acc.tin += Math.max(0, (u.input_tokens || 0) - cached); acc.tcache += cached; acc.tout += (u.output_tokens || 0); acc.done = true;
  }
  if (m.type === 'turn.failed' || m.type === 'error') { acc.error = String(m.error?.message || m.message || 'Codex hatası'); ev.push({ kind: 'error', text: acc.error }); }
  return ev;
}

// ---- Antigravity CLI (agy -p --output-format stream-json) ----
// https://antigravity.google/docs/cli/headless/ : init, step_update (step_type: user_input|agent_response|tool|checkpoint), result
export function agyToolName(n = '') {
  const s = String(n).toLowerCase();
  if (/command|shell|terminal|run/.test(s)) return 'Bash';
  if (/write|create_file|edit|replace|patch/.test(s)) return 'Edit';
  if (/search_web|web|url|fetch|browse/.test(s)) return 'WebSearch';
  if (/read|view|list|grep|find|glob/.test(s)) return 'Read';
  return String(n || 'araç');
}
export function parseAgyLine(m, acc) {
  const ev = [];
  // agy 1.3.x gerçek çıktısı iç içe: {"event":"result","result":{...}} — belgedeki düz biçime çevir
  if (m && m.event && !m.type) m = { type: m.event, ...(m[m.event] || {}) };
  if (m.type === 'step_update') {
    if (m.step_type === 'tool' && m.state === 'ACTIVE' && m.tool_name && !acc.seen.has(m.step_index)) {
      acc.seen.add(m.step_index); acc.steps++;
      const ti = m.tool_info || {};
      ev.push({ kind: 'tool', name: agyToolName(m.tool_name), raw: m.tool_name, input: { command: ti.command, file_path: ti.path || ti.file_path, query: ti.query, url: ti.url } });
    }
    if (m.step_type === 'agent_response' && m.text_delta) acc.text += m.text_delta;
  }
  if (m.type === 'result') {
    const u = m.usage || {};
    acc.tin += u.input_tokens || 0; acc.tout += (u.output_tokens || 0) + (u.thinking_tokens || 0); acc.tcache += u.cache_read_tokens || 0;
    if (m.response) acc.text = String(m.response);
    if (m.num_turns) acc.steps = Math.max(acc.steps, m.num_turns);
    acc.done = true;
    if (m.status && m.status !== 'SUCCESS') { acc.error = String(m.error?.message || m.error || `Antigravity durumu: ${m.status}`); ev.push({ kind: 'error', text: acc.error }); }
  }
  return ev;
}
export const newAcc = () => ({ text: '', tin: 0, tout: 0, tcache: 0, steps: 0, error: null, done: false, seen: new Set() });

// cmd.exe üzerinden (npm .cmd kabuğu) çalıştırılacak argümanlar: sadece güvenli karakterler, boşluk varsa tırnak
export function shellQuote(a) {
  const s = String(a);
  if (/["%^&|<>!\r\n]/.test(s)) throw new Error('Güvensiz karakter içeren argüman: ' + s.slice(0, 40));
  return /[\s()]/.test(s) || !s ? `"${s}"` : s;
}
export const safeModel = m => /^[\w.\-:/]{1,64}$/.test(String(m || '')) ? String(m) : '';

// ---- Proje klasörüne geçici MCP sunucusu (Antigravity: çalıştırma başına MCP bayrağı yok, .agents/mcp_config.json okunur) ----
// Kullanıcının kendi dosyası varsa korunur ve son çalıştırma bitince aynen geri yazılır; yoksa dosya (ve boş klasörü) silinir.
// Aynı dosyayı kullanan eşzamanlı çalıştırmalar sayılır. Bozuk JSON'a dokunulmaz (null döner: araç bu çalıştırmada yok).
const mounts = new Map();   // dosya → { n, prev }
export function mountWorkspaceMcp(file, name, server) {
  let e = mounts.get(file);
  if (!e) {
    let prev = null; try { prev = fs.readFileSync(file, 'utf8'); } catch {}
    let j; try { j = prev ? JSON.parse(prev) : {}; } catch { return null; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    (j.mcpServers ||= {})[name] = server;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(j, null, 2)); } catch { return null; }
    mounts.set(file, e = { n: 0, prev });
  }
  e.n++;
  let done = false;
  return () => { if (done) return; done = true; if (--e.n > 0) return; mounts.delete(file); restoreMount(file, e.prev); };
}
function restoreMount(file, prev) {
  try { if (prev == null) { fs.rmSync(file, { force: true }); try { fs.rmdirSync(path.dirname(file)); } catch {} } else fs.writeFileSync(file, prev); } catch {}
}
export const restoreAllMounts = () => { for (const [f, e] of mounts) restoreMount(f, e.prev); mounts.clear(); };
