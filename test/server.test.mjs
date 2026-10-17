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
  const port = opts.port || 4300 + 2 * Math.floor(Math.random() * 300);   // çift port: önizleme (port+1) başka bir test sunucusuyla çakışmasın
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

test('durum: 3 ajan (CLI), şapkalar, varsayılan ofis ve ayarlar', async () => {
  const { json } = await S.api('state');
  assert.deepEqual(Object.keys(json.agents), ['claude', 'codex', 'antigravity'], 'ajan = CLI');
  for (const k of ['ceo', 'designer', 'developer', 'researcher', 'writer', 'auditor']) assert.ok(json.hats[k], k + ' şapkası yok');
  assert.equal(json.offices.length, 1); assert.equal(json.offices[0].lead, 'claude');
  assert.deepEqual(json.offices[0].members, ['claude', 'codex', 'antigravity']);
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
  assert.ok(st.ext.ext_githubci, 'dış araç ofisin ajanlarına karışmaz');
  assert.ok(!st.agents.ext_githubci);
  assert.equal(st.ext.ext_githubci.external, true);
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
  assert.equal(done.board.filter(t => !t.kind).length, 3);
  assert.ok(done.board.some(t => t.kind === "ekip toplantısı" && /onayladı/.test(t.summary)), "itiraz yoksa toplantı onayla biter");
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
  const w = st.hats.writer;
  assert.ok(w.lessons.some(l => l.src === 'oz'), 'öz değerlendirme dersi (şapkanın)');
  assert.ok(w.lessons.some(l => l.src === 'metrik'), 'ölçülebilir ders');
  assert.ok(w.charter.standards.length, 'şapkanın yönergesi');
  assert.ok(st.agents.claude.level.tasks >= 1, 'seviye ajanın (CLI)');
  assert.ok(done.board.filter(t => !t.kind).every(t => t.cli === 'claude'), 'her görevin ajanı belli');
  assert.ok(done.messages.some(m => m.from === 'writer' && m.cli === 'claude'), 'mesajda şapkayı takan ajan');
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
  assert.equal(fin.board.filter(t => !t.kind).length, 3);
});

test('doğrulanmadı: gözden geçirenler inceleyemezse puan kaydedilmez, rapor uyarır', { timeout: 120000 }, async () => {
  const R = startServer({ OFIS_DEMO_REVIEW: 'kor', OFIS_DEMO_MS: '300' }); await R.ready;
  try {
    const p = (await R.api('projects', { name: 'Kör' })).json;
    await R.api(`projects/${p.id}/message`, { text: 'Kafem için tek sayfalık site' });
    const get = async () => (await R.api('state')).json.projects.find(x => x.id === p.id);
    await waitFor(async () => (await get()).pendingPlan, 30000, 300);
    await R.api(`projects/${p.id}/plan`, { action: 'approve' });
    const done = await waitFor(async () => { const q = await get(); return q.board?.length && !q.executing && q.board.some(t => t.kind === 'gözden geçirme') && q; }, 100000, 500);
    assert.equal(done.board.find(t => t.kind === 'gözden geçirme').status, 'hata');
    assert.ok(!(done.scores || []).some(s => s.from === 'metrik'), 'denetim yoksa metrik puanı kaydedilmez');
    assert.ok(done.messages.some(m => m.score && /DOĞRULANMADI/.test(m.text)));
    assert.ok(done.messages.some(m => /^⚠ DOĞRULANMADI/.test(m.text) && /görev tamamlandı/.test(m.text)), 'son rapor uyarıyla başlar');
    const st = (await R.api('state')).json;
    assert.ok(!Object.values(st.agents).some(a => (a.scores || []).some(s => s.project === 'Kör')), 'seviye etkilenmez');
  } finally { await R.stop(); }
});

test('ekip içi kalite: akran incelemesi öneri verir, denetçi düzeltme turu açar, yeniden denetler', { timeout: 120000 }, async () => {
  const R = startServer({ OFIS_DEMO_REVIEW: 'revize', OFIS_DEMO_MS: '300' }); await R.ready; R.listen();
  try {
    const p = (await R.api('projects', { name: 'İnceleme', brief: 'Kahve yazısı', template: 'blog' })).json;
    await R.api(`projects/${p.id}/plan`, { action: 'approve' });
    const get = async () => (await R.api('state')).json.projects.find(x => x.id === p.id);
    const done = await waitFor(async () => { const q = await get(); return q.board?.length && !q.executing && q.board.every(t => t.status === 'bitti') && q; }, 100000, 500);
    // araştırmacının çıktısını, onun üzerine çalışacak yazar inceler ve öneriler uygulanır
    const t1 = done.board.find(t => t.id === 't1');
    assert.equal(t1.review?.by, 'writer');
    assert.equal(t1.review.karar, 'revize');
    assert.ok(t1.review.applied, 'öneriler uygulanmalı');
    assert.ok(!t1.phase, 'inceleme aşaması temizlenmeli');
    // yazarın çıktısını yalnızca denetçi kullanır: ayrıca akran incelemesi yok
    assert.ok(!done.board.find(t => t.id === 't2').review);
    // ekip toplantısı: herkes bütünü değerlendirir, eleştiri alan yanıt verir, CEO karar verir
    const mt = done.board.find(t => t.kind === 'ekip toplantısı');
    assert.ok(mt && mt.status === 'bitti' && !mt.phase, 'toplantı panoda ve bitmiş olmalı');
    assert.ok(mt.meeting.decisions >= 1, 'en az bir karar');
    assert.ok(mt.meeting.rejected >= 1, 'itiraz edilen öneri reddedilir');
    const meet = done.messages.filter(m => m.meet);
    assert.ok(meet.some(m => m.from === 'researcher' && /Olmuş:/.test(m.text)) && meet.some(m => m.from === 'writer' && /Olmamış/.test(m.text)), 'iki ajan da değerlendirme yazar');
    assert.ok(meet.some(m => /Katılmıyorum/.test(m.text)), 'tartışma: itiraz görünür');
    assert.ok(meet.some(m => m.from === 'ceo' && /Kararlar:/.test(m.text) && /Reddedilenler:/.test(m.text)), 'CEO kararı');
    // kararlar paralel düzeltme görevi olur, ardından yeniden denetim (varsayılan 1 tur)
    const fx = done.board.filter(t => t.kind === 'düzeltme'), ra = done.board.filter(t => t.kind === 'yeniden denetim');
    assert.ok(fx.length >= 1 && fx.every(t => ['researcher', 'writer'].includes(t.agent)) && /toplantı/.test(fx[0].instruction));
    assert.equal(ra.length, 1);
    assert.deepEqual(ra[0].needs, fx.map(t => t.id));
    assert.ok(done.messages.some(m => m.review === 'revize' && m.from === 'writer' && m.to === 'researcher'), 'öneri mesajı sohbete düşer');
    assert.ok(done.messages.some(m => /akran incelemesi/.test(m.text) && /ekip toplantısı/.test(m.text)), 'sonuç raporu ekip içi kaliteyi anar');
    // düzeltmeler ayrı puanlanmaz: puan sadece asıl görevlere
    assert.equal(done.scores.filter(s => s.from === 'metrik').length, 2);
    // ayar kapalıyken inceleme ve düzeltme turu yok
    await R.api('settings', { review: 0 });
    assert.equal((await R.api('state')).json.settings.review, 0);
    const p2 = (await R.api('projects', { name: 'Kapalı', brief: 'x', template: 'blog' })).json;
    await R.api(`projects/${p2.id}/plan`, { action: 'approve' });
    const d2 = await waitFor(async () => { const q = (await R.api('state')).json.projects.find(x => x.id === p2.id); return q.board?.length && !q.executing && q.board.every(t => t.status === 'bitti') && q; }, 100000, 500);
    assert.equal(d2.board.length, 3);
    assert.ok(!d2.board.some(t => t.review));
  } finally { R.closeSse(); await R.stop(); }
});

test('beceriler: ajan kartından açılıp kapatılır, kendi becerisi eklenir ve görevde istem içine girer', { timeout: 120000 }, async () => {
  const st0 = (await S.api('state')).json;
  assert.ok(st0.hats.writer.skillList.some(s => s.id === 'blog-yazisi' && s.on), 'hazır beceriler arayüze gelir');
  await S.api('hats/writer', { skillsOff: ['seo-metin', 'yok-boyle-bir-beceri'], customSkills: [{ name: 'Kahve sözlüğü', when: 'kahve', steps: 'Terimleri açıkla\nÖrnek ver' }, { name: '', steps: 'geçersiz' }] });
  const w = (await waitFor(async () => { const a = (await S.api('state')).json.hats.writer; return a.customSkills?.length && a; }, 5000, 100));
  assert.deepEqual(w.skillsOff, ['seo-metin'], 'bilinmeyen beceri kimliği saklanmaz');
  assert.equal(w.customSkills.length, 1, 'geçersiz beceri atılır');
  assert.equal(w.skillList.find(s => s.id === 'seo-metin').on, false);
  const p = (await S.api('projects', { name: 'Beceri Testi', brief: 'Kahve hakkında blog yazısı', template: 'blog' })).json;
  await S.api(`projects/${p.id}/plan`, { action: 'approve' });
  const done = await waitFor(async () => { const q = (await S.api('state')).json.projects.find(x => x.id === p.id); return q.board?.length && !q.executing && q.board.every(t => t.status === 'bitti') && q; }, 100000, 1000);
  const t2 = done.board.find(t => t.agent === 'writer');
  assert.ok(t2.skills.includes('Kahve sözlüğü') && t2.skills.includes('Blog yazısı'), 'panoda kullanılan beceriler: ' + t2.skills);
  assert.ok(!t2.skills.includes('SEO uyumlu metin'), 'kapatılan beceri kullanılmaz');
  const st = (await S.api('state')).json;
  const rq = st.requests.filter(r => r.projectId === p.id && r.agent === 'writer' && r.phase === 'work').pop();
  const full = (await S.api('requests/' + rq.id)).json;
  assert.match(full.system, /## Kahve sözlüğü/);
  await S.api('hats/writer', { skillsOff: [], customSkills: [] });   // diğer testleri etkilemesin
});

test('oyun projesi: CEO yetenek kataloğunu görür, asset hattını tasarımcıya verir, istem aracın yolunu taşır', { timeout: 120000 }, async () => {
  const p = (await S.api('projects', { name: 'Oyun Testi' })).json;
  await S.api(`projects/${p.id}/message`, { text: 'Bana basit bir zıplama oyunu yap' });
  const get = async () => (await S.api('state')).json.projects.find(x => x.id === p.id);
  const pl = (await waitFor(async () => (await get()).pendingPlan, 30000, 300));
  const st0 = (await S.api('state')).json;
  const planReq = st0.requests.filter(r => r.projectId === p.id && r.agent === 'ceo').pop();
  const full = (await S.api('requests/' + planReq.id)).json;
  assert.match(full.prompt, /OFİSİN YETENEKLERİ/); assert.match(full.prompt, /PROJE TÜRÜ: Oyun/);
  assert.match(full.prompt, /ÜRÜN MODELİ/, 'CEO tek yapımcı modelini bilir');
  assert.match(full.prompt, /TASARIM YÖNÜ[\s\S]*Piksel arcade/, 'CEO sektörün hazır tasarım yönlerini görür');
  assert.ok(st0.capabilities.some(c => c.id === 'asset-hatti'), 'arayüze yetenek adları gider');
  // ürün modu: assetler ve kod tek yapımcıda (yazılımcı) birleşir; tasarım belgesi girdi kalır; denetim döngüye devredilir
  assert.equal(pl.mode, 'urun');
  const bt = pl.tasks.find(t => t.role === 'yapimci');
  assert.equal(bt.agent, 'developer'); assert.deepEqual(bt.needs, ['t1']);
  assert.ok(bt.caps.includes('asset-hatti') && bt.caps.includes('calistir-dogrula'));
  assert.ok(!pl.tasks.some(t => t.agent === 'auditor'));
  await S.api('settings', { explore: true });   // yön keşfi açık: yapımcıdan önce çalışır
  await S.api(`projects/${p.id}/plan`, { action: 'approve' });
  const done = await waitFor(async () => { const q = await get(); return q.board?.length && !q.executing && q.board.every(t => t.status === 'bitti') && q; }, 100000, 1000);
  const st = (await S.api('state')).json;
  const wrs = await Promise.all(st.requests.filter(r => r.projectId === p.id && r.agent === 'developer' && r.phase === 'work').map(async r => (await S.api('requests/' + r.id)).json));
  const wfull = wrs.find(r => /YAPIMCI_GOREVI/.test(r.prompt));
  assert.ok(wfull, 'yapımcı isteği bulunmalı');
  assert.match(wfull.prompt, /YETENEKLERİN/); assert.match(wfull.prompt, /tools[\\/]+assets\.mjs/);
  assert.match(wfull.prompt, /GİRDİLER \(ekibin hazırladığı belgeler, tam metin/, 'girdi tam metin gider');
  assert.ok(wfull.system.includes('Oyun geliştirme (Canvas)'), 'oyun becerisi seçilir');
  assert.deepEqual(done.decisions.length, 3, 'yapımcının kararları kayıtlı');
  assert.ok(done.messages.some(m => m.meet && /Verdiğim kararlar/.test(m.text)));
  // gözden geçirme: tasarımcı ve denetçi baktı, ciddi bulgu yok → tek turda onay
  const g = done.board.filter(t => t.kind === 'gözden geçirme');
  assert.equal(g.length, 1); assert.ok(!done.board.some(t => t.kind === 'düzeltme'));
  assert.ok(st.requests.some(r => r.projectId === p.id && r.agent === 'designer' && r.purpose === 'Tasarım incelemesi'));
  assert.ok(done.messages.some(m => /ürün gözden geçirmeden geçti/.test(m.text)));
  // yön keşfi: test yanıtında yön yok → yapımcı vizyondaki tarzla başlar, akış durmaz
  const yk = done.board.find(t => t.kind === 'yön keşfi');
  assert.ok(yk && yk.status === 'bitti' && /üretilemedi/.test(yk.summary), JSON.stringify(yk));
  assert.match(wfull.prompt, /ESTETİK YÖN[\s\S]*YAPMA/, 'yapımcı estetik kuralları ve yasakları alır');
  await S.api('settings', { explore: false });
});

test('proje yönetimi: kabul ölçütleri, kesin kontroller, önizleme güvenliği ve geri alma', { timeout: 150000 }, async () => {
  const R = startServer({ OFIS_DEMO_REVIEW: 'revize', OFIS_DEMO_MS: '300' }); await R.ready;
  try {
    const p = (await R.api('projects', { name: 'Yönetim' })).json;
    const get = async () => (await R.api('state')).json.projects.find(x => x.id === p.id);
    const dir = (await get()).dir, BROKEN = '<!doctype html><html><head><title>K</title></head><body><a href="#yok">x</a></body></html>';
    fs.writeFileSync(path.join(dir, 'index.html'), BROKEN);
    await R.api(`projects/${p.id}/message`, { text: 'Mahalledeki kırtasiye dükkanım için web sitesi' });
    const pl = await waitFor(async () => (await get()).pendingPlan, 30000, 300);
    assert.deepEqual(pl.criteria.map(c => c.id), ['K1', 'K2']);
    assert.deepEqual(pl.tasks.find(t => t.role === 'yapimci').criteria, ['K1', 'K2']);
    await R.api(`projects/${p.id}/plan`, { action: 'approve' });
    const done = await waitFor(async () => { const q = await get(); return q.board?.length && !q.executing && q.board.every(t => t.status === 'bitti') && q; }, 120000, 500);
    // kabul: K1 ilk gözden geçirmede kaldı → yapımcıya bulgu olarak gitti → sonraki turda geçti
    assert.equal(done.acceptance.K1.durum, 'gecti'); assert.equal(done.acceptance.K2.durum, 'gecti');
    assert.ok(done.messages.some(m => /Kabul ölçütleri: 2\/2 karşılandı/.test(m.text)), 'son rapor kabul durumunu verir');
    const st = (await R.api('state')).json;
    // yapımcı tek yazar: geri bildirim (kalan ölçüt + kesin kontrol + tasarım bulgusu) ona gider, triyaj yapar
    const fx = await Promise.all(st.requests.filter(r => r.projectId === p.id && r.agent === 'developer' && r.phase === 'work').map(async r => (await R.api('requests/' + r.id)).json));
    const tri = fx.find(r => /GERI_BILDIRIM_TRIYAJ \(tur 1\)/.test(r.prompt));
    assert.ok(tri, 'triyaj isteği');
    assert.match(tri.prompt, /\[kritik\] \(Denetim\) K1 karşılanmadı/);
    assert.match(tri.prompt, /\[kritik\] \(Otomatik kontrol\) index\.html: Kırık sayfa içi bağlantı: #yok/);
    assert.match(tri.prompt, /\(Tasarım incelemesi\) Başlık hiyerarşisi zayıf/);
    assert.match(tri.prompt, /ÖNCEKİ RAPORUN/, 'yapımcı kendi raporunu görür');
    assert.ok(done.messages.some(m => m.from === 'developer' && /Geri bildirime yanıtım:[\s\S]*Reddedildi — kapsam dışı/.test(m.text)), 'triyaj sohbette');
    const rv2 = await Promise.all(st.requests.filter(r => r.projectId === p.id && r.purpose === 'Tasarım incelemesi').map(async r => (await R.api('requests/' + r.id)).json));
    assert.ok(rv2.some(r => /GEREKÇESİYLE REDDETTİKLERİ/.test(r.prompt)), 'sonraki tur gözden geçiren reddedilenleri görür');
    assert.ok(!st.requests.some(r => r.projectId === p.id && r.purpose === 'toplantı kararı'), 'ürün modunda toplantı yok');
    assert.ok(done.board.every(t => t.agent !== 'designer' || !t.role), 'tasarımcı ürün dosyası yazmaz');
    assert.ok(done.loop.tur >= 2 && done.loop.uygulandi >= 1 && done.loop.reddedildi >= 1);
    assert.ok(done.verify && done.verify.tag === 'son' && done.verify.checks.errors >= 1);
    // önizleme: ayrı port, yalnızca proje klasörü, yalnızca GET, doğru Host
    const pv = (await R.api(`projects/${p.id}/preview`)).json;
    assert.equal(pv.entry, 'index.html'); assert.equal(pv.port, R.port + 1);
    const page = await fetch(pv.base + 'index.html'); assert.equal(page.status, 200); assert.equal(await page.text(), BROKEN);
    assert.equal((await fetch(`http://127.0.0.1:${pv.port}/${p.id}/..%2f..%2fstate.json`)).status, 403, 'klasör dışına çıkılamaz');
    assert.equal((await fetch(`http://127.0.0.1:${pv.port}/yok/index.html`)).status, 404);
    fs.mkdirSync(path.join(dir, '.livand-yonler'), { recursive: true }); fs.writeFileSync(path.join(dir, '.livand-yonler', 'yon-1.html'), '<h1>y</h1>');
    fs.mkdirSync(path.join(dir, '.gizli'), { recursive: true }); fs.writeFileSync(path.join(dir, '.gizli', 'a.txt'), 'x');
    assert.equal((await fetch(pv.base + '.livand-yonler/yon-1.html')).status, 200, 'yön denemeleri önizlenebilir');
    assert.equal((await fetch(pv.base + '.gizli/a.txt')).status, 403, 'diğer gizli klasörler sunulmaz');
    fs.rmSync(path.join(dir, '.livand-yonler'), { recursive: true, force: true }); fs.rmSync(path.join(dir, '.gizli'), { recursive: true, force: true });
    assert.equal(await rawGet(pv.port, `/${p.id}/index.html`, { host: 'evil.example.com' }), 403, 'DNS rebinding');
    assert.equal((await fetch(`http://127.0.0.1:${pv.port}/${p.id}/index.html`, { method: 'POST' })).status, 403);
    const cross = await fetch(R.base + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${pv.port}` }, body: '{"review":0}' });
    assert.equal(cross.status, 403, 'önizlemedeki sayfa uygulama API\'sini çağıramaz');
    // geri alma: t1 öncesine dön → içerik geri gelir, sonradan oluşan dosya silinmez taşınır, adımlar sıraya döner
    const t1 = done.board.find(t => t.id === 't1'); assert.ok(t1.snap, 'adımın anlık görüntüsü var');
    fs.writeFileSync(path.join(dir, 'index.html'), 'DEĞİŞTİ'); fs.writeFileSync(path.join(dir, 'yeni.txt'), 'sonradan');
    const rv = (await R.api(`projects/${p.id}/revert`, { snap: t1.snap })).json;
    assert.equal(rv.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), BROKEN);
    assert.ok(!fs.existsSync(path.join(dir, 'yeni.txt')) && rv.moved.includes('yeni.txt') && fs.existsSync(path.join(rv.trash, 'yeni.txt')), 'sonradan oluşan dosya taşınır');
    const after = await get();
    assert.ok(after.board.filter(t => !t.kind).every(t => t.status === 'bekliyor'), 'adımlar sıraya döner');
    assert.ok(!after.board.some(t => t.kind), 'toplantı/düzeltme adımları kalkar');
    assert.equal((await R.api(`projects/${p.id}/revert`, { snap: 'yok' })).status, 404);
  } finally { await R.stop(); }
});

test('ekip araçları: mesaj sohbete ve gelen kutusuna düşer, yanlış alıcı reddedilir, istek proje çalışmıyorken açılmaz; bellek ucu', async () => {
  const p = (await S.api('projects', { name: 'Ekip araçları' })).json;
  const call = b => S.api('team', { project: p.id, agent: 'claude', ...b }).then(r => r.json.text);
  assert.match(await call({ op: 'message', to: 'designer', text: 'x' }), /görev çalışırken/, 'şapka/görev yoksa kullanılamaz');
  assert.match(await call({ hat: 'developer', op: 'message', to: 'designer', text: 'Karakter 32x32 olsun' }), /İletildi/);
  assert.match(await call({ hat: 'developer', op: 'message', to: 'developer', text: 'kendime' }), /Geçersiz alıcı/);
  assert.match(await call({ hat: 'designer', op: 'inbox' }), /Karakter 32x32/);
  assert.match(await call({ hat: 'designer', op: 'inbox' }), /boş/, 'okunan mesaj tekrar gelmez');
  assert.match(await call({ hat: 'developer', op: 'request', to: 'designer', work: 'yürüme kareleri' }), /çalışmıyor/);
  const st = (await S.api('state')).json, pr = st.projects.find(x => x.id === p.id);
  assert.ok(pr.messages.some(m => m.mail && /32x32/.test(m.text)), 'mesaj sohbette görünür');
  assert.match(await call({ hat: 'developer', op: 'memory', query: 'hiç olmayan konu' }), /bulunamadı/);
  const lm = (await S.api('longmem')).json; assert.equal(typeof lm.total, 'number'); assert.equal(st.memory.total, lm.total);
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
  for (const a of Object.values(st.hats)) assert.equal(a.provider, 'auto', 'varsayılan: ofis/lider seçer');
  assert.equal(st.providers.find(x => x.key === 'codex').usable, false, 'açılmadan kullanılmaz');
  await S.api('settings', { providers: { codex: { on: true, model: 'gpt; kötü' } } });
  st = (await S.api('state')).json;
  const cx = st.providers.find(x => x.key === 'codex');
  assert.equal(cx.on, true); assert.equal(cx.model, '', 'güvensiz model adı temizlenir'); assert.equal(cx.usable, true);
  await S.api('hats/writer', { provider: 'codex' });
  await waitFor(async () => (await S.api('state')).json.hats.writer.provider === 'codex', 5000, 100);
  const p = (await S.api('projects', { name: 'CLI Testi', brief: 'Çay hakkında yazı', template: 'blog' })).json;
  await S.api(`projects/${p.id}/plan`, { action: 'approve' });
  const done = await waitFor(async () => { const q = (await S.api('state')).json.projects.find(x => x.id === p.id); return q.board?.length && !q.executing && q.board.every(t => t.status === 'bitti') && q; }, 100000, 1000);
  const wt = done.board.find(t => t.agent === 'writer');
  assert.equal(wt.provider, 'codex'); assert.equal(wt.cli, 'codex'); assert.ok(wt.cat);
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
  await S.api('hats/writer', { provider: 'auto' });
});

test('ofisler: kurulur, projeler ofise bağlanır, lider üyelerden olur, son ofis silinmez', async () => {
  const bad = (await S.api('offices', { name: 'Tasarım stüdyosu', lead: 'yok', members: ['codex', 'hayali'] })).json;
  assert.equal(bad.office.lead, 'codex', 'lider üyelerden'); assert.deepEqual(bad.office.members, ['codex']);
  const o = bad.office;
  await S.api('offices/' + o.id, { members: ['claude', 'codex'], lead: 'claude' });
  let st = (await S.api('state')).json;
  assert.equal(st.offices.find(x => x.id === o.id).lead, 'claude');
  const p = (await S.api('projects', { name: 'Stüdyo işi', officeId: o.id })).json;
  assert.equal(p.officeId, o.id);
  const q = (await S.api('projects', { name: 'Ofissiz', officeId: 'yok' })).json;
  assert.equal(q.officeId, st.offices[0].id, 'bilinmeyen ofis → ilk ofis');
  assert.equal((await S.api('offices/' + o.id + '/delete', {})).json.ok, true);
  st = (await S.api('state')).json;
  assert.equal(st.projects.find(x => x.id === p.id).officeId, st.offices[0].id, 'projeler silinmez, ilk ofise taşınır');
  assert.equal((await S.api('offices/' + st.offices[0].id + '/delete', {})).status, 400, 'son ofis silinemez');
  for (const x of [p, q]) await S.api('projects/' + x.id + '/delete', { files: true });
});
