// Kayıt noktaları (gölge git), değişiklik denetimi, uzun süreli bellek ve ekip araçları — çalıştır: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitAvailable, checkpoint, changes, restore, exists, fileAt } from '../lib/checkpoints.mjs';
import { riskyChanges, changeSummary } from '../lib/changes.mjs';
import { remember, recall, tokens, MEM_MAX } from '../lib/memory.mjs';
import { addLesson } from '../lib/growth.mjs';
import { providerFits, pickProvider, cliGuide, canWeb, canImage } from '../lib/providers.mjs';
import { catalogPrompt, capsForTask, capabilityPrompt } from '../lib/capabilities.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'livand-'));

test('kayıt noktası: kullanıcının .git\'ine dokunmaz, büyük klasörde de çalışır, geri alma sonradan oluşanı taşır', async t => {
  if (!(await gitAvailable())) return t.skip('git yok');
  const base = tmp(), work = path.join(base, 'is'), repo = path.join(base, 'veri', 'repo.git'), trash = path.join(base, 'cop');
  fs.mkdirSync(path.join(work, '.git'), { recursive: true }); fs.writeFileSync(path.join(work, '.git', 'HEAD'), 'kullanicinin');
  fs.mkdirSync(path.join(work, 'node_modules', 'x'), { recursive: true }); fs.writeFileSync(path.join(work, 'node_modules', 'x', 'i.js'), '1');
  fs.writeFileSync(path.join(work, 'a.txt'), 'bir'); fs.writeFileSync(path.join(work, 'sil.txt'), 'kalacak');
  fs.writeFileSync(path.join(work, 'buyuk.bin'), Buffer.alloc(60 * 1024 * 1024, 7));   // eski yöntemin 50 MB sınırının üstü
  try {
    const c1 = await checkpoint(repo, work, 't1');
    assert.match(c1, /^[0-9a-f]{40}$/); assert.ok(await exists(repo, work, c1));
    fs.writeFileSync(path.join(work, 'a.txt'), 'iki'); fs.writeFileSync(path.join(work, 'yeni.txt'), 'sonradan'); fs.rmSync(path.join(work, 'sil.txt'));
    const c2 = await checkpoint(repo, work, 't1-son');
    const ch = await changes(repo, work, c1, c2);
    assert.deepEqual(ch.map(x => x.status + ' ' + x.file).sort(), ['A yeni.txt', 'D sil.txt', 'M a.txt']);
    assert.ok(!ch.some(x => /node_modules|\.git\//.test(x.file)), 'node_modules ve .git kaydedilmez');
    assert.equal(await fileAt(repo, work, c1, 'a.txt'), 'bir');
    const r = await restore(repo, work, c1, trash);
    assert.equal(fs.readFileSync(path.join(work, 'a.txt'), 'utf8'), 'bir');
    assert.equal(fs.readFileSync(path.join(work, 'sil.txt'), 'utf8'), 'kalacak', 'silinen dosya geri gelir');
    assert.ok(!fs.existsSync(path.join(work, 'yeni.txt')) && fs.existsSync(path.join(trash, 'yeni.txt')) && r.moved.includes('yeni.txt'), 'sonradan oluşan silinmez, taşınır');
    assert.equal(fs.readFileSync(path.join(work, '.git', 'HEAD'), 'utf8'), 'kullanicinin', 'kullanıcının deposu değişmez');
    assert.ok(fs.existsSync(path.join(work, 'buyuk.bin')));
    await restore(repo, work, r.before, path.join(base, 'cop2'));   // geri almanın kendisi de geri alınır
    assert.equal(fs.readFileSync(path.join(work, 'a.txt'), 'utf8'), 'iki');
    // paralel kayıt noktaları sıraya girer (index.lock çakışması yok)
    const many = await Promise.all([1, 2, 3, 4].map(i => (fs.writeFileSync(path.join(work, `p${i}.txt`), String(i)), checkpoint(repo, work, 'p' + i))));
    assert.equal(new Set(many).size, 4);
    await assert.rejects(restore(repo, work, 'f'.repeat(40), trash), /bulunamadı/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('değişiklik denetimi: betik, gizli dosya, toplu silme ve kurulum betiği yakalanır; sıradan değişiklik temiz', () => {
  assert.deepEqual(riskyChanges([{ status: 'M', file: 'index.html' }, { status: 'A', file: 'assets/hero.png' }]), []);
  const f = riskyChanges([{ status: 'A', file: 'run.ps1' }, { status: 'A', file: '.env' }, { status: 'M', file: '.github/workflows/ci.yml' }, { status: 'M', file: 'package.json' }],
    { pkgBefore: '{"dependencies":{"a":"1"}}', pkgAfter: '{"dependencies":{"a":"1","lefpad":"1"},"scripts":{"postinstall":"node x.js"}}' });
  const why = f.map(x => x.file + ':' + x.level).join(' ');
  assert.match(why, /run\.ps1:yuksek/); assert.match(why, /\.env:yuksek/); assert.match(why, /ci\.yml:orta/);
  assert.ok(f.some(x => /lefpad/.test(x.why)) && f.some(x => /postinstall/.test(x.why) && x.level === 'yuksek'));
  assert.ok(riskyChanges(['a', 'b', 'c', 'd', 'e'].map(file => ({ status: 'D', file }))).some(x => /5 dosya silindi/.test(x.why)));
  assert.equal(changeSummary([{ status: 'A' }, { status: 'M' }, { status: 'D' }]), '3 dosya (1 yeni, 1 değişti, 1 silindi)');
});

test('bellek: Türkçe ekler eşleşir, ilgisiz kayıt gelmez, şapka süzgeci ve tekrar birleştirme', () => {
  const mem = {};
  assert.deepEqual(tokens('Oyunların Işıkları'), ['oyunl', 'isikl']);
  remember(mem, { kind: 'ders', hat: 'designer', text: 'Piksel sanat oyunlarında sprite boyutunu 32x32 tut, ölçeklemeyi kodda yap' });
  remember(mem, { kind: 'karar', text: 'Kafe sitesinde koyu kahve paleti ve el yazısı başlık fontu seçildi' });
  remember(mem, { kind: 'ders', hat: 'writer', text: 'Blog yazılarında alt başlıkları soru biçiminde yaz' });
  const again = remember(mem, { kind: 'karar', text: 'Kafe  sitesinde koyu kahve paleti ve el yazısı başlık fontu seçildi' });
  assert.equal(mem.items.length, 3); assert.equal(again.n, 2);
  const r = recall(mem, 'piksel sanat bir oyun için sprite hazırla', { hat: 'designer' });
  assert.equal(r[0]?.kind, 'ders'); assert.match(r[0].text, /sprite/);
  assert.ok(!recall(mem, 'piksel oyun sprite', { hat: 'developer' }).some(x => x.hat === 'designer'), 'başka şapkanın dersi gelmez');
  assert.deepEqual(recall(mem, 'muhasebe raporu excel'), [], 'ilgisiz sorgu boş döner');
  assert.ok(recall(mem, 'kafe için palet', { k: 5 }).some(x => x.kind === 'karar'), 'şapkasız kayıtlar herkese açık');
  assert.deepEqual(recall(mem, 'piksel sprite oyun', { exclude: [mem.items[0].text] }).filter(x => x.kind === 'ders'), [], 'istemde zaten olan ders tekrar gelmez');
  const big = {}; for (let i = 0; i < MEM_MAX + 5; i++) remember(big, { text: `kayıt numarası ${i} farklı içerik` });
  assert.equal(big.items.length, MEM_MAX);
});

test('dersler: 24\'ün dışına düşen ders kaybolmaz, belleğe gider', () => {
  const ag = { lessons: [] }, gone = [];
  const w = 'elma armut kiraz erik dut incir nar ayva vişne kavun karpuz muz kivi ananas limon portakal mandalina greyfurt üzüm çilek böğürtlen ahududu yaban mersini hurma badem ceviz fındık'.split(' ');
  for (let i = 0; i < 26; i++) addLesson(ag, `${w[i]}-${w[i]}-${w[i]}`, 'oz', Date.now() - i * 864e5, l => gone.push(l));
  assert.equal(ag.lessons.length, 24); assert.equal(gone.length, 2);
});

test('Codex web araması: kullanıcı açarsa araştırmaya verilir, kapalıyken verilmez', () => {
  assert.equal(canWeb('codex', {}), false); assert.equal(canWeb('codex', { web: true }), true);
  assert.equal(providerFits('codex', { web: true }, {}).ok, false);
  assert.equal(providerFits('codex', { web: true }, { web: true }).ok, true);
  assert.equal(pickProvider({}, 'arastirma', ['codex', 'claude'], { explore: 0 }).provider, 'claude');
  assert.equal(pickProvider({}, 'arastirma', ['codex'], { explore: 0, cfgs: { codex: { web: true } } }).provider, 'codex');
  assert.match(cliGuide('codex', { web: true }), /web arama aracın açık/); assert.match(cliGuide('codex', {}), /AĞ KAPALI/);
});

test('görsel üretimi: yalnızca Codex + ChatGPT girişi + açık ayar; kapalıyken katalogda ve görevde yok, otomatik eklenmez', () => {
  const on = { images: true, planAuth: true };
  assert.equal(canImage('codex', on), true);
  assert.equal(canImage('codex', { images: true, planAuth: false }), false, 'API anahtarıyla giriş: ücretli olur, kapalı');
  assert.equal(canImage('codex', { images: false, planAuth: true }), false);
  assert.equal(canImage('antigravity', on), false);
  assert.equal(providerFits('antigravity', { image: true }, on).ok, false);
  assert.equal(providerFits('codex', { image: true }, on).ok, true);
  assert.equal(pickProvider({}, 'arayuz', ['claude', 'codex'], { image: true, cfgs: { codex: on } }).provider, 'codex');
  assert.equal(pickProvider({}, 'arayuz', ['claude', 'codex'], { image: true, cfgs: { codex: {} } }), null);
  const off = catalogPrompt('bir platform oyunu yap', ['designer', 'developer']);
  assert.ok(!/gorsel-uret/.test(off) && /ÜRETEMEZ/.test(off));
  const yes = catalogPrompt('bir platform oyunu yap', ['designer', 'developer'], { imagegen: true, max: 5 });
  assert.match(yes, /gorsel-uret/); assert.match(yes, /en fazla 5 görsel/);
  const t = { instruction: 'Oyunun karakter sprite görsellerini hazırla', yetenekler: ['gorsel-uret', 'asset-hatti'] };
  assert.deepEqual(capsForTask(t, 'designer', 'oyun'), ['asset-hatti'], 'kapalıyken lider atasa da girmez');
  assert.deepEqual(capsForTask(t, 'designer', 'oyun', { imagegen: true }), ['gorsel-uret', 'asset-hatti']);
  assert.ok(!capsForTask({ instruction: 'karakter sprite hazırla' }, 'designer', 'platform oyunu', { imagegen: true }).includes('gorsel-uret'), 'otomatik eklenmez (limit harcar)');
  const how = capabilityPrompt(['gorsel-uret'], { tool: 'x', imgDir: 'C:/u/.codex/generated_images', left: 3, imagegen: true });
  assert.match(how, /en fazla 3 görsel/); assert.match(how, /OPENAI_API_KEY tanımlama/); assert.match(how, /generated_images/);
  assert.equal(capabilityPrompt(['gorsel-uret'], { tool: 'x', imagegen: false }), '');
});

test('MCP aracı: ekip ve bellek araçları listelenir, Codex/Antigravity modunda onay aracı gizli kalır', async () => {
  const list = async env => {
    const c = spawn(process.execPath, [path.join(root, 'approver.js')], { env: { ...process.env, ...env }, windowsHide: true });
    let out = ''; c.stdout.on('data', d => out += d);
    c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
    for (let i = 0; i < 50 && !out.includes('\n'); i++) await new Promise(r => setTimeout(r, 50));
    c.kill(); return JSON.parse(out.split('\n')[0]).result.tools.map(t => t.name);
  };
  const all = await list({});
  for (const n of ['approve', 'screenshot', 'team_message', 'team_inbox', 'team_ask', 'team_request', 'memory_search']) assert.ok(all.includes(n), n);
  const only = await list({ OFIS_ONLY_SHOT: '1' });
  assert.ok(!only.includes('approve') && only.includes('team_ask'));
});
