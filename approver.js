// Claude Code'un izin isteklerini ofis arayüzüne yönlendiren küçük MCP sunucusu (stdio, bağımlılık yok).
// Claude Code, onay gerektiren her araç çağrısı için buradaki "approve" aracını çağırır; biz de arayüzde sana soruyoruz.
// "screenshot" aracı: ajan ürettiği sayfayı gizli tarayıcıda tam sayfa çekip kendi gözüyle görür (yaz → bak → düzelt).
import readline from 'node:readline';
import http from 'node:http';

const BASE = new URL(process.env.OFIS_URL || 'http://127.0.0.1:3000');
const send = o => process.stdout.write(JSON.stringify(o) + '\n');

// fetch'in 5 dk başlık zaman aşımı olmasın diye düz http kullanıyoruz (onay beklemesi uzun sürebilir)
function postJson(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request({ hostname: BASE.hostname, port: BASE.port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

// ekip araçları: ajanlar çalışırken birbirine yazar, soru sorar, iş ister; geçmiş projelerin belleğini arar
const str = d => ({ type: 'string', description: d });
const TEAM = [
  { name: 'team_message', op: 'message', description: 'Leave a short note for a teammate (by hat key, e.g. "designer", "developer") or "all": a shared decision you made, or a change that affects their work. Non-blocking.',
    inputSchema: { type: 'object', properties: { to: str('Teammate hat key or "all"'), text: str('The message') }, required: ['to', 'text'] } },
  { name: 'team_inbox', op: 'inbox', description: 'Read unread messages your teammates left for you (and file-conflict warnings).', inputSchema: { type: 'object', properties: {} } },
  { name: 'team_ask', op: 'ask', description: 'Ask a teammate a question that blocks your work and get the answer right away (max 3 per task).',
    inputSchema: { type: 'object', properties: { to: str('Teammate hat key'), question: str('The question') }, required: ['to', 'question'] } },
  { name: 'team_request', op: 'request', description: 'Give a teammate a separate piece of work (e.g. ask the designer for a sprite or asset). It runs in parallel; you get a message in team_inbox when it is done. Do not wait for it (max 3 per project).',
    inputSchema: { type: 'object', properties: { to: str('Teammate hat key'), work: str('What to do, concretely'), deliverable: str('Expected file(s), e.g. "assets/hero-walk.png"') }, required: ['to', 'work'] } },
  { name: 'memory_search', op: 'memory', description: "Search the office's long-term memory (lessons, decisions and summaries from past projects, user preferences).",
    inputSchema: { type: 'object', properties: { query: str('What to look for') }, required: ['query'] } },
];

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ofis', version: '1.0.0' } } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [
    ...(process.env.OFIS_ONLY_SHOT === '1' ? [] : [{ name: 'approve', description: 'Handles permission prompts', inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] } }]),   // Codex'te yalnızca ekran görüntüsü aracı
    { name: 'screenshot', description: 'Renders an HTML page from the working folder in a headless browser (waits for network idle, web fonts and images), captures full-page desktop (1280px) and mobile (390px) screenshots as viewport-high slices, and reports console errors and horizontal overflow. Returns PNG file paths: open them with Read to actually see the page.',
      inputSchema: { type: 'object', properties: { page: { type: 'string', description: 'HTML path relative to the working folder; empty = entry page (index.html)' } } } },
    ...TEAM.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  ] } });
  const team = TEAM.find(t => t.name === m.params?.name);
  if (m.method === 'tools/call' && team) {   // ekip araçları: sunucu mesajı iletir, soruyu yanıtlatır, işi panoya ekler ya da belleği arar
    let text;
    try { text = (await postJson('/api/team', { project: process.env.OFIS_PROJECT, agent: process.env.OFIS_AGENT, task: process.env.OFIS_TASK, hat: process.env.OFIS_HAT, op: team.op, ...(m.params?.arguments || {}) })).text; }
    catch { text = 'Ofis sunucusuna ulaşılamadı.'; }
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(text || 'Yanıt yok.') }] } });
  }
  if (m.method === 'tools/call' && m.params?.name === 'screenshot') {   // ekran görüntüsü: sunucu sayfayı gizli tarayıcıda çeker
    let text;
    try { text = (await postJson('/api/self-shot', { project: process.env.OFIS_PROJECT, agent: process.env.OFIS_AGENT, page: m.params?.arguments?.page || '' })).text; }
    catch { text = 'Ofis sunucusuna ulaşılamadı; ekran görüntüsü alınamadı.'; }
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(text || 'Ekran görüntüsü alınamadı.') }] } });
  }
  if (m.method === 'tools/call' && (process.env.OFIS_ONLY_SHOT === '1' || m.params?.name !== 'approve')) return send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'bilinmeyen araç' } });
  if (m.method === 'tools/call') {
    let out;
    try { out = await postJson('/api/approval', { project: process.env.OFIS_PROJECT, agent: process.env.OFIS_AGENT, ...(m.params?.arguments || {}) }); }
    catch { out = { behavior: 'deny', message: 'Ofis sunucusuna ulaşılamadı, işlem reddedildi.' }; }
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } });
  }
  if (m.id != null && m.method === 'ping') return send({ jsonrpc: '2.0', id: m.id, result: {} });
  if (m.id != null) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } });
});
