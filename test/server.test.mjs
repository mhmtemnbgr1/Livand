// Sunucu uçtan uca testleri (DEMO modu: gerçek Claude çalışmaz, token harcanmaz) — çalıştır: npm test
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(extraEnv = {}, opts = {}) {
  const port = opts.port || 4300 + Math.floor(Math.random() * 600);
  const dataDir = path.join(here, `.data-${port}`);
  const proc = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root, windowsHide: true,
    env: { ...process.env, PORT: String(port), OFIS_DEMO: '1', OFIS_DATA: dataDir, ...extraEnv },
  });
  let out = ''; proc.stdout.on('data', d => out += d); proc.stderr.on('data', d => out += d);
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('sunucu açılmadı: ' + out)), 15000);
    const iv = setInterval(() => { if (/Ofis hazır/.test(out)) { clearTimeout(t); clearInterval(iv); res(); } }, 50);
    proc.on('exit', c => { clearTimeout(t); clearInterval(iv); rej(new Error('sunucu kapandı (' + c + '): ' + out)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const api = async (p, body, headers = {}) => {
    const r = await fetch(base + '/api/' + p, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const stop = async () => { try { proc.kill(); } catch {} await sleep(300); fs.rmSync(dataDir, { recursive: true, force: true }); };
  // SSE olaylarını toplar
  const events = [];
  const ctl = new AbortController();
  const listen = async () => {
    try {
      const r = await fetch(base + '/events', { signal: ctl.signal }); const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const m = buf.slice(0, i); buf = buf.slice(i + 2); if (m.startsWith('data: ')) { try { events.push(JSON.parse(m.slice(6))); } catch {} } } }
    } catch {}
  };
  return { port, base, api, ready, stop, events, listen, closeSse: () => ctl.abort(), proc };
}
const waitFor = async (fn, ms = 60000, step = 400) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('zaman aşımı'); await sleep(step); } };
const rawGet = (port, p, headers) => new Promise((res, rej) => { http.get({ host: '127.0.0.1', port, path: p, headers }, r => { r.resume(); res(r.statusCode); }).on('error', rej); });

let S;
before(async () => { S = startServer(); await S.ready; S.listen(); });
after(async () => { S.closeSse(); await S.stop(); });

test('durum: varsayılan ajanlar ve ayarlar', async () => {
  const { json } = await S.api('state');
  for (const k of ['ceo', 'designer', 'developer', 'researcher', 'writer', 'auditor']) assert.ok(json.agents[k], k + ' yok');
  assert.equal(json.settings.lang, 'tr');
  assert.equal(json.live.demo, true);
});

test('güvenlik: yabancı Host ve Origin başlıkları reddedilir', async () => {
  assert.equal(await rawGet(S.port, '/api/state', { host: 'evil.example.com' }), 403);
  assert.equal(await rawGet(S.port, '/api/state', { origin: 'http://evil.example.com' }), 403);
  assert.equal(await rawGet(S.port, '/api/state', {}), 200);
});

test('proje klasörü: geniş/sistem klasörleri reddedilir', async () => {
  for (const d of ['C:\\', 'C:\\Windows', process.env.USERPROFILE || 'C:\\Users']) {
    const r = await S.api('projects', { name: 'x', dir: d });
    assert.equal(r.status, 400, d);
  }
});

test('dil ayarı kaydedilir', async () => {
  assert.equal((await S.api('settings', { lang: 'en' })).status, 200);
  assert.equal((await S.api('state')).json.settings.lang, 'en');
  await S.api('settings', { lang: 'xx' });   // geçersiz değer yok sayılır
  assert.equal((await S.api('state')).json.settings.lang, 'en');
  await S.api('settings', { lang: 'tr' });
});

test('ofis düzeni: doğrulama, kaydetme, sıfırlama', async () => {
  assert.equal((await S.api('layout', { items: [{ id: 'a', m: '../../etc/passwd', x: 1, z: 1 }] })).status, 400);
  assert.equal((await S.api('layout', { items: [{ id: 'a', m: 'yokBoyleModel', x: 1, z: 1 }] })).status, 400);
  assert.equal((await S.api('layout', { items: 'x' })).status, 400);
  const ok = await S.api('layout', { items: [{ id: 'i1', m: 'rugDoormat', x: 8, z: 1, ry: 0, s: 1.9, y: 0.05 }] });
  assert.equal(ok.status, 200);
  assert.equal((await S.api('layout')).json.items.length, 1);
  await S.api('layout', { items: null });
  assert.equal((await S.api('layout')).json.items, null);
});

test('dış HTTP girdisi: ajan oluşur, durum yayınlanır', async () => {
  assert.equal((await S.api('event', { name: '' })).status, 400);
  const r = await S.api('event', { name: 'GitHub CI', state: 'error', note: 'test kırıldı' });
  assert.equal(r.json.agent, 'ext_githubci');
  const st = (await S.api('state')).json;
  assert.ok(st.agents.ext_githubci);
  assert.equal(st.agents.ext_githubci.external, true);
  await waitFor(() => S.events.some(e => e.type === 'status' && e.data.agent === 'ext_githubci' && e.data.state === 'error'), 3000, 100);
  await S.api('event', { name: 'GitHub CI', state: 'blocked' });
  await waitFor(() => S.events.some(e => e.type === 'status' && e.data.agent === 'ext_githubci' && e.data.state === 'waiting'), 3000, 100);
});

test('dış HTTP girdisi: belirteç tanımlıysa zorunlu', async () => {
  const T = startServer({ OFIS_API_TOKEN: 'gizli123' }); await T.ready;
  try {
    assert.equal((await T.api('event', { name: 'x' })).status, 401);
    assert.equal((await T.api('event', { name: 'x' }, { 'x-ofis-token': 'yanlis' })).status, 401);
    assert.equal((await T.api('event', { name: 'x' }, { 'x-ofis-token': 'gizli123' })).status, 200);
  } finally { await T.stop(); }
});

test('görev akışı: plan → onay → pano → puan → çalıştırma geçmişi', { timeout: 120000 }, async () => {
  const p = (await S.api('projects', { name: 'Blog Testi', brief: 'Kahve hakkında yazı', template: 'blog' })).json;
  assert.ok(p.pendingPlan, 'şablon planı yüklenmeli');
  S.events.length = 0;
  await S.api(`projects/${p.id}/plan`, { action: 'approve' });
  const get = async () => (await S.api('state')).json.projects.find(x => x.id === p.id);
  const done = await waitFor(async () => { const q = await get(); return q.board?.length && !q.executing && q.board.every(t => t.status === 'bitti') && q; }, 100000, 1000);
  assert.equal(done.board.length, 3);
  assert.equal(done.runs.length, 1);
  assert.ok(done.spent > 0, 'token harcaması kaydedilmeli');
  assert.ok(S.events.some(e => e.type === 'celebrate'), 'kutlama olayı yayınlanmalı');
  assert.ok(S.events.some(e => e.type === 'log' && /Görev başladı/.test(e.data.text)), 'günlük kaydı');
  assert.ok(S.events.some(e => e.type === 'status' && e.data.state === 'done'), 'görev bitti durumu');
  const st = (await S.api('state')).json;
  const day = Object.values(st.daily || {});
  assert.ok(day.length >= 1 && day[0].runs > 0, 'günlük istatistik');
  const today = new Date(), key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  assert.ok(st.daily[key], 'günlük istatistik yerel tarih anahtarıyla tutulmalı');
  // gelişim: öz değerlendirme ve ölçülebilir dersler kaydedilir, seviye ve yönerge arayüze gider
  const w = st.agents.writer;
  assert.ok(w.lessons.some(l => l.src === 'oz'), 'öz değerlendirme dersi');
  assert.ok(w.lessons.some(l => l.src === 'metrik'), 'ölçülebilir ders');
  assert.ok(w.level && w.level.tasks >= 1 && w.charter.standards.length, 'seviye ve yönerge');
  assert.ok(!done.messages.some(m => /---ÖZ---/.test(m.text)), 'öz satırı sohbete düşmez');
  const sv = (await S.api('state')).json.savings;
  assert.ok(sv && sv.all.tasks + sv.all.skipped >= 2, 'biten işler tasarruf hesabına girer');
  assert.ok(sv.all.humanMin >= 0 && sv.all.savedMin <= sv.all.humanMin);
  // geçmiş çalıştırmayı yeniden çalıştır → yeni bir plan beklenir
  const re = await S.api(`projects/${p.id}/rerun`, { run: done.runs[0].id });
  assert.equal(re.status, 200);
  assert.ok((await get()).pendingPlan, 'yeniden çalıştırma planı onay bekler');
  assert.equal((await S.api(`projects/${p.id}/rerun`, { run: 'yok' })).status, 404);
});

test('token bütçesi: aşılınca durur, bütçe artınca devam eder', { timeout: 120000 }, async () => {
  const p = (await S.api('projects', { name: 'Bütçe Testi', brief: 'Kısa yazı', template: 'blog' })).json;
  await S.api(`projects/${p.id}/settings`, { budget: 100 });
  await S.api(`projects/${p.id}/plan`, { action: 'approve' });
  const get = async () => (await S.api('state')).json.projects.find(x => x.id === p.id);
  const stopped = await waitFor(async () => { const q = await get(); return q.board?.length && !q.executing && q; }, 60000, 500);
  assert.ok(stopped.board.some(t => t.status !== 'bitti'), 'bütçe dolunca bazı görevler bitmemeli');
  assert.ok(stopped.spent >= 100);
  assert.ok(S.events.some(e => e.type === 'budget' && e.data.id === p.id));
  await S.api(`projects/${p.id}/settings`, { budget: 100000 });
  await S.api(`projects/${p.id}/resume`, {});
  const fin = await waitFor(async () => { const q = await get(); return !q.executing && q.board.every(t => t.status === 'bitti') && q; }, 100000, 1000);
  assert.equal(fin.board.length, 3);
});

test('CLI düğmesi: demo modunda bağlantı kesme Claude yokmuş gibi davranmaz, durum döner', async () => {
  const r = await S.api('cli', { on: false });
  assert.equal(r.status, 200);
  const st = (await S.api('state')).json;
  assert.equal(st.settings.cli, false);
  assert.equal(st.live.off, false);   // DEMO zorlandığında kesme etkisizdir (Claude zaten çağrılmaz)
  await S.api('cli', { on: true });
  assert.equal((await S.api('state')).json.settings.cli, true);
});

test('yeniden başlatma: yarım kalan proje "kesildi" olarak işaretlenir', { timeout: 60000 }, async () => {
  const R = startServer(); await R.ready;
  try {
    const p = (await R.api('projects', { name: 'Kesinti', brief: 'x', template: 'blog' })).json;
    await R.api(`projects/${p.id}/plan`, { action: 'approve' });
    await waitFor(async () => (await R.api('state')).json.projects.find(x => x.id === p.id)?.executing, 10000, 200);
    await sleep(500);
    R.proc.kill();   // ani kapanma
    await sleep(800);
    // aynı veri klasörüyle yeniden aç
    const R2 = startServer({}, { port: R.port }); await R2.ready;
    try {
      const q = (await R2.api('state')).json.projects.find(x => x.id === p.id);
      assert.equal(q.executing, false);
      assert.equal(q.interrupted, true);
      assert.ok(q.board.some(t => t.status === 'kesildi' || t.status === 'bekliyor'));
    } finally { R2.proc.kill(); await sleep(300); }
  } finally { try { R.proc.kill(); } catch {} await sleep(300); fs.rmSync(path.join(here, `.data-${R.port}`), { recursive: true, force: true }); }
});

test('proje silme: kayıtlar gider, uygulama klasörü istenirse silinir, son proje silinince yenisi açılır', async () => {
  const p = (await S.api('projects', { name: 'Silinecek' })).json;
  fs.writeFileSync(path.join(p.dir, 'not.txt'), 'x');
  const r = await S.api(`projects/${p.id}/delete`, { files: true });
  assert.equal(r.json.ok, true); assert.equal(r.json.filesRemoved, true);
  assert.equal(fs.existsSync(p.dir), false);
  const st = (await S.api('state')).json;
  assert.ok(!st.projects.some(x => x.id === p.id));
  assert.ok(st.projects.length >= 1);
  // kullanıcının seçtiği klasördeki dosyalara dokunulmaz
  const own = path.join(here, '.data-userdir-' + S.port); fs.mkdirSync(own, { recursive: true }); fs.writeFileSync(path.join(own, 'benim.txt'), 'x');
  try {
    const q = (await S.api('projects', { name: 'Klasörlü', dir: own })).json;
    await S.api(`projects/${q.id}/delete`, { files: true });
    assert.ok(fs.existsSync(path.join(own, 'benim.txt')), 'kullanıcı klasörü silinmemeli');
  } finally { fs.rmSync(own, { recursive: true, force: true }); }
  for (const x of (await S.api('state')).json.projects) await S.api(`projects/${x.id}/delete`, { files: true });
  const st2 = (await S.api('state')).json;
  assert.equal(st2.projects.length, 1); assert.equal(st2.projects[0].name, 'Yeni proje');
});

test('çoklu CLI: ajan Codex\'e atanır, görev Codex ile çalışır ve sonuç öğrenilir', { timeout: 120000 }, async () => {
  let st = (await S.api('state')).json;
  assert.deepEqual(st.providers.map(x => x.key), ['claude', 'codex', 'antigravity']);
  for (const a of Object.values(st.agents)) if (!a.external) assert.equal(a.provider, 'auto', 'varsayılan: sistem CLI seçer');
  assert.equal(st.providers.find(x => x.key === 'codex').usable, false, 'açılmadan kullanılmaz');
  await S.api('settings', { providers: { codex: { on: true, model: 'gpt; kötü' } } });
  st = (await S.api('state')).json;
  const cx = st.providers.find(x => x.key === 'codex');
  assert.equal(cx.on, true); assert.equal(cx.model, '', 'güvensiz model adı temizlenir'); assert.equal(cx.usable, true);
  await S.api('agents/writer', { provider: 'codex' });
  await waitFor(async () => (await S.api('state')).json.agents.writer.provider === 'codex', 5000, 100);
  const p = (await S.api('projects', { name: 'CLI Testi', brief: 'Çay hakkında yazı', template: 'blog' })).json;
  await S.api(`projects/${p.id}/plan`, { action: 'approve' });
  const done = await waitFor(async () => { const q = (await S.api('state')).json.projects.find(x => x.id === p.id); return q.board?.length && !q.executing && q.board.every(t => t.status === 'bitti') && q; }, 100000, 1000);
  const wt = done.board.find(t => t.agent === 'writer');
  assert.equal(wt.provider, 'codex'); assert.ok(wt.cat);
  st = (await S.api('state')).json;
  assert.ok(st.routing[wt.cat].est.codex.n >= 1, 'Codex sonucu öğrenildi');
  assert.ok(st.requests.some(r => r.agent === 'writer' && r.provider === 'codex' && /^codex/.test(r.model)));
  await S.api('settings', { resetRouting: true });
  assert.equal((await S.api('state')).json.routing[wt.cat].est.codex.n, 0);
  // bağlantıyı kes: o CLI'ye iş verilmez
  assert.equal((await S.api('providers/codex/disconnect', {})).status, 200);
  st = (await S.api('state')).json;
  assert.equal(st.providers.find(x => x.key === 'codex').usable, false);
  assert.equal(st.providers.find(x => x.key === 'codex').on, false);
  assert.equal((await S.api('providers/yok/connect', {})).status, 404);
  await S.api('agents/writer', { provider: 'auto' });
});
