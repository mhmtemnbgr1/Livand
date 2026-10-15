// Çoklu CLI sağlayıcısı ve öğrenen yönlendirici (saf işlevler) — çalıştır: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryOf, recordResult, estimate, pickProvider, parseCodexLine, parseAgyLine, newAcc, shellQuote, safeModel, PRIORS, PRIOR_N, providerFits, cliGuide, mountWorkspaceMcp } from '../lib/providers.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('iş türü: rol ve görev metninden çıkar', () => {
  assert.equal(categoryOf('auditor', 'kodu incele'), 'denetim');
  assert.equal(categoryOf('ceo'), 'plan');
  assert.equal(categoryOf('developer', 'npm install ile bağımlılıkları kur ve testleri çalıştır'), 'terminal');
  assert.equal(categoryOf('developer', 'Ana sayfayı yaz', 'index.html'), 'arayuz');
  assert.equal(categoryOf('developer', 'API sunucusunu yaz', 'server.js'), 'kod');
  assert.equal(categoryOf('writer', 'Blog yazısı', 'yazi.md'), 'yazi');
  assert.equal(categoryOf('researcher', 'Rakipleri araştır'), 'arastirma');
  assert.equal(categoryOf('designer', 'renk önerisi'), 'arayuz');   // eşleşme yoksa rolün varsayılanı
});

test('öğrenme: ön bilgi gerçek puanlarla güncellenir', () => {
  const st = {};
  const e0 = estimate(st, 'codex', 'kod');
  assert.ok(Math.abs(e0.mean - PRIORS.codex.kod) < 1e-9); assert.equal(e0.n, 0);
  for (let i = 0; i < 5; i++) recordResult(st, 'codex', 'kod', 9.5);
  const e1 = estimate(st, 'codex', 'kod');
  assert.equal(e1.n, 5);
  assert.ok(Math.abs(e1.mean - (PRIORS.codex.kod * PRIOR_N + 5 * 9.5) / (PRIOR_N + 5)) < 1e-9);
  recordResult(st, 'codex', 'kod', 1, { failed: true, w: 0.5 });
  assert.equal(estimate(st, 'codex', 'kod').fails, 1);
  recordResult(st, 'yok', 'kod', 5); recordResult(st, 'codex', 'yok', 5);   // geçersizler yok sayılır
  assert.deepEqual(Object.keys(st), ['codex']);
  assert.deepEqual(Object.keys(st.codex), ['kod']);
});

test('seçim: en iyi tahmin kazanır, az denenene keşif şansı, ağsız CLI araştırmaya verilmez', () => {
  const st = {}, all = ['claude', 'codex', 'antigravity'];
  for (let i = 0; i < 6; i++) { recordResult(st, 'codex', 'terminal', 9); recordResult(st, 'claude', 'terminal', 6); recordResult(st, 'antigravity', 'terminal', 5); }
  assert.equal(pickProvider(st, 'terminal', all, { rand: () => 0.99 }).provider, 'codex');
  assert.equal(pickProvider(st, 'terminal', ['claude'], { rand: () => 0.99 }).provider, 'claude');
  // hiç denenmemişse keşif (rand < explore) ikinci en iyiye şans verir
  const fresh = pickProvider({}, 'kod', all, { rand: () => 0.01 });
  assert.notEqual(fresh.provider, 'claude'); assert.match(fresh.why, /deneme/);
  assert.equal(pickProvider({}, 'kod', all, { rand: () => 0.99 }).provider, 'claude');
  assert.notEqual(pickProvider({}, 'arastirma', ['codex', 'antigravity'], { rand: () => 0.01 }).provider, 'codex');
  assert.equal(pickProvider({}, 'arastirma', ['codex'], { rand: () => 0.99 }).provider, 'codex');   // tek seçenekse yine de kullanılır
  assert.equal(pickProvider({}, 'kod', []), null);
});

test('Codex JSON olayları ortak biçime çevrilir', () => {
  const acc = newAcc(), ev = [];
  for (const m of [
    { type: 'thread.started', thread_id: 'x' }, { type: 'turn.started' },
    { type: 'item.started', item: { id: 'i1', type: 'command_execution', command: 'bash -lc ls', status: 'in_progress' } },
    { type: 'item.completed', item: { id: 'i1', type: 'command_execution', command: 'bash -lc ls', aggregated_output: 'a.txt', exit_code: 0 } },
    { type: 'item.completed', item: { id: 'i2', type: 'file_change', changes: [{ path: 'index.html', kind: 'add' }] } },
    { type: 'item.completed', item: { id: 'i3', type: 'agent_message', text: 'Bitti.' } },
    { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } },
  ]) ev.push(...parseCodexLine(m, acc));
  assert.deepEqual(ev.filter(e => e.kind === 'tool').map(e => e.name), ['Bash', 'Write']);
  assert.equal(acc.text, 'Bitti.'); assert.equal(acc.tin, 200); assert.equal(acc.tcache, 800); assert.equal(acc.tout, 50); assert.equal(acc.steps, 2);
  const a2 = newAcc(); parseCodexLine({ type: 'turn.failed', error: { message: 'usage limit reached' } }, a2);
  assert.equal(a2.error, 'usage limit reached');
});

test('Antigravity stream-json olayları ortak biçime çevrilir', () => {
  const acc = newAcc(), ev = [];
  for (const m of [
    { type: 'init', cwd: '/x' },
    { type: 'step_update', step_index: 1, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { command: 'ls' } },
    { type: 'step_update', step_index: 1, state: 'DONE', step_type: 'tool', tool_name: 'run_command' },
    { type: 'step_update', step_index: 2, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Mer' },
    { type: 'result', status: 'SUCCESS', response: 'Merhaba', num_turns: 3, usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 2, cache_read_tokens: 4 } },
  ]) ev.push(...parseAgyLine(m, acc));
  assert.deepEqual(ev.filter(e => e.kind === 'tool').map(e => e.name), ['Bash']);
  assert.equal(acc.text, 'Merhaba'); assert.equal(acc.tout, 7); assert.equal(acc.tcache, 4); assert.equal(acc.steps, 3);
  const a2 = newAcc(); parseAgyLine({ type: 'result', status: 'ERROR', error: 'quota' }, a2);
  assert.equal(a2.error, 'quota');
});

test('Antigravity 1.3.x gerçek (iç içe) çıktısı da okunur', () => {
  const acc = newAcc();
  for (const l of [
    '{"event":"init","conversation_id":"c1","init":{"cwd":"C:\\\\x","tools":["run_command"]}}',
    '{"event":"step_update","step_update":{"conversation_id":"c1","step_index":0,"state":"DONE","step_type":"user_input"}}',
    '{"event":"step_update","step_update":{"conversation_id":"c1","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"tamam"}}',
    '{"event":"result","result":{"conversation_id":"c1","status":"SUCCESS","response":"tamam\\n","num_turns":1,"usage":{"input_tokens":13685,"output_tokens":2,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":13687}}}',
  ]) parseAgyLine(JSON.parse(l), acc);
  assert.equal(acc.text.trim(), 'tamam'); assert.equal(acc.tin, 13685); assert.equal(acc.tout, 2); assert.equal(acc.done, true); assert.equal(acc.error, null);
});

test('güvenli argüman ve model adı', () => {
  assert.equal(shellQuote('exec'), 'exec');
  assert.equal(shellQuote('C:\\Users\\A B\\proje'), '"C:\\Users\\A B\\proje"');
  for (const bad of ['a & del x', 'x"y', '%PATH%', 'a|b']) assert.throws(() => shellQuote(bad));
  assert.equal(safeModel('gpt-5.5-codex'), 'gpt-5.5-codex');
  assert.equal(safeModel('x; rm -rf'), '');
});

test('CLI uygunluğu: işi yapamayacak CLI seçilmez', () => {
  assert.equal(providerFits('codex', { web: true }).ok, false, 'Codex ağsız: web araştırması yok');
  assert.equal(providerFits('codex', { bash: true }).ok, true, 'Codex komut çalıştırır');
  assert.equal(providerFits('antigravity', { bash: true }).ok, false, 'tam yetki kapalıyken komut yok');
  assert.equal(providerFits('antigravity', { bash: true }, { trust: true }).ok, true);
  assert.equal(providerFits('antigravity', { web: true }).ok, true);
  assert.equal(providerFits('claude', { web: true, bash: true }).ok, true);
  assert.match(providerFits('antigravity', { bash: true }).why, /tam yetki/);
});

test('CLI yönergesi: her CLI kendi ortamını ve sınırlarını öğrenir', () => {
  const cx = cliGuide('codex', { phase: 'work' }), cxr = cliGuide('codex', { phase: 'plan' });
  assert.match(cx, /Codex CLI/); assert.match(cx, /AĞ KAPALI/); assert.match(cx, /asset aracı/); assert.match(cxr, /SALT OKUNURSUN/);
  assert.match(cliGuide('antigravity', { phase: 'work' }), /KOMUT ÇALIŞTIRAMAZSIN/);
  assert.match(cliGuide('antigravity', { phase: 'work', trust: true }), /sormadan çalıştırabilirsin/);
  assert.match(cliGuide('antigravity', { phase: 'plan' }), /Plan modundasın/);
  for (const k of ['codex', 'antigravity']) assert.match(cliGuide(k), /HARFİYEN/, 'yanıt biçimine uyma notu');
  assert.equal(cliGuide('claude'), '', 'Claude Code istemi zaten ona göre');
});

test('geçici MCP ayarı: kullanıcının dosyası korunup geri yazılır, yoksa silinir, eşzamanlı çalıştırmalar sayılır', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livand-mcp-')), f = path.join(dir, '.agents', 'mcp_config.json'), srv = { command: 'node', args: ['a.js'] };
  try {
    // dosya yokken: eklenir, son çalıştırma bitince dosya ve boş klasör silinir
    const off1 = mountWorkspaceMcp(f, 'ofis', srv), off2 = mountWorkspaceMcp(f, 'ofis', srv);
    assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')).mcpServers.ofis, srv);
    off1(); off1(); assert.ok(fs.existsSync(f), 'diğer çalıştırma sürerken dosya kalır (aynı kapatma iki kez sayılmaz)');
    off2(); assert.ok(!fs.existsSync(f) && !fs.existsSync(path.dirname(f)), 'son çalıştırma bitince temizlenir');
    // kullanıcının kendi dosyası: sunucusu korunur, sonra aynen geri yazılır
    const mine = JSON.stringify({ mcpServers: { benim: { command: 'x' } }, not: 1 });
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, mine);
    const off3 = mountWorkspaceMcp(f, 'ofis', srv), j = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.ok(j.mcpServers.benim && j.mcpServers.ofis && j.not === 1);
    off3(); assert.equal(fs.readFileSync(f, 'utf8'), mine, 'birebir geri yazılır');
    // bozuk dosyaya dokunulmaz
    fs.writeFileSync(f, '{bozuk'); assert.equal(mountWorkspaceMcp(f, 'ofis', srv), null); assert.equal(fs.readFileSync(f, 'utf8'), '{bozuk');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('CLI notu: ekran görüntüsü aracı varsa Antigravity bilir, yoksa verilen yolları kullanır', () => {
  assert.match(cliGuide('antigravity', { phase: 'plan', shot: true }), /screenshot/);
  assert.match(cliGuide('antigravity', { phase: 'plan' }), /Ekran görüntüsü aracın yok/);
  assert.match(cliGuide('codex', { phase: 'plan' }), /TÜM dosyalara erişimin var/);
});
