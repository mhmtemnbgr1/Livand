// Claude Code'un izin isteklerini ofis arayüzüne yönlendiren küçük MCP sunucusu (stdio, bağımlılık yok).
// Claude Code, onay gerektiren her araç çağrısı için buradaki "approve" aracını çağırır; biz de arayüzde sana soruyoruz.
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

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ofis', version: '1.0.0' } } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'approve', description: 'Handles permission prompts', inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] } }] } });
  if (m.method === 'tools/call') {
    let out;
    try { out = await postJson('/api/approval', { project: process.env.OFIS_PROJECT, agent: process.env.OFIS_AGENT, ...(m.params?.arguments || {}) }); }
    catch { out = { behavior: 'deny', message: 'Ofis sunucusuna ulaşılamadı, işlem reddedildi.' }; }
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } });
  }
  if (m.id != null && m.method === 'ping') return send({ jsonrpc: '2.0', id: m.id, result: {} });
  if (m.id != null) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'method not found' } });
});
