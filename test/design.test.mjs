// Estetik yönlendirme: jenerik tasarım dedektörü, sektör yönleri, estetik becerisi — çalıştır: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkWorkspace, checksText, designSmells, usabilitySmells } from '../lib/checks.mjs';
import { presetsFor, presetPrompt, aestheticPrompt, copiedPreset, DESIGN_PRESETS } from '../lib/design.mjs';
import { pickSkills } from '../lib/skills.mjs';
import { reviewersFor } from '../lib/orchestra.mjs';

const site = files => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'livand-tsr-')); for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); } return d; };
const cards = n => Array.from({ length: n }, (_, i) => `<div class="card fade-in"><span>✨</span><h3>Özellik ${i}</h3></div>`).join('');

test('jenerik tasarım: yapay zekâ kalıplarının hepsi yakalanır', () => {
  const d = site({
    'index.html': `<!doctype html><html><head><title>X</title><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="style.css"></head><body><h1>Geleceği <span class="gradient-text">bugün</span> kur</h1><span class="eyebrow">A</span><h2>B</h2><span class="eyebrow">C</span><h2>D</h2>${cards(6)}</body></html>`,
    'hakkinda.html': '<h1>Komşu <em>Kapısı</em></h1>',
    'style.css': 'body{font-family:Inter, system-ui, sans-serif} .hero{background:linear-gradient(135deg,#6d28d9,#4f46e5)} .gradient-text{-webkit-background-clip:text;background-clip:text}',
  });
  try {
    const s = designSmells(d).map(x => x.msg).join('\n');
    for (const re of [/Tipografi jenerik/, /Mor\/indigo gradyan/, /Gradyanlı metin/, /6 adet "card"/, /kaydırınca beliren/, /emoji/, /tek kelime/, /2 başlığın üstünde küçük etiket/]) assert.match(s, re);
    const c = checkWorkspace(d);
    assert.equal(c.design, 8); assert.ok(c.issues.every(x => x.sev !== 'tasarim' || x.file === 'index.html'));
    assert.match(checksText(c), /8 jenerik tasarım kalıbı/);
    fs.writeFileSync(path.join(d, 'index.html'), '<h1>Komşu <em>Kapısı</em></h1>'); fs.rmSync(path.join(d, 'hakkinda.html'));
    assert.match(designSmells(d).map(x => x.msg).join('\n'), /tek kelime renk\/italik/, 'sınıfsız <em> vurgusu da yakalanır');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('jenerik tasarım: özgün sayfa temiz geçer, yön denemeleri ve sayfasız klasör sayılmaz', () => {
  const d = site({
    'index.html': '<!doctype html><html><head><title>Kırtasiye</title><link href="https://fonts.googleapis.com/css2?family=Recoleta:wght@600&family=Nunito+Sans&display=swap" rel="stylesheet"></head><body><h1>Defterin burada</h1></body></html>',
    'style.css': ':root{--font-govde:"Nunito Sans",sans-serif} body{font-family:var(--font-govde);background:#faf7f0} h1{font-family:Recoleta,serif;color:#1f3a68} .k{background:linear-gradient(#faf7f0,#f1e8d6)}',
    '.livand-yonler/yon-1.html': `<h1>x</h1>${cards(8)}`,
  });
  try { assert.deepEqual(designSmells(d), []); } finally { fs.rmSync(d, { recursive: true, force: true }); }
  const e = site({ 'notlar.md': '# not' });
  try { assert.deepEqual(designSmells(e), []); } finally { fs.rmSync(e, { recursive: true, force: true }); }
});

test('kullanılabilirlik: çalışmayan düğme ve bağlantılar yakalanır', () => {
  const sections = ['hikaye', 'menu', 'adres'].map(id => `<section id="${id}"><h2>${id}</h2></section>`).join('');
  const d = site({
    'index.html': `<!doctype html><html><head><title>K</title><style>header{position:relative}</style></head><body><header><a href="#" class="logo">Logo</a><nav><a href="#hikaye">Hikaye</a><a href="#menu">Menü</a><a href="#adres">Adres &amp; Yol Tarifi</a></nav></header>` +
      `<a href="#adres" class="btn">Yol Tarifi Al</a><a href="#">Detay</a><button class="sepet">Sepete ekle</button><button id="ac">Aç</button><a href="tel:+905XXXXXXXXX">Ara</a>${sections}` +
      `<address>Caferağa Mah. Bademaltı Sok. No: 14, Moda</address><a href="https://maps.google.com/?q=Moda+Kad%C4%B1k%C3%B6y" target="_blank">Haritada gör</a>` +
      `<p>Instagram: @ornek (yer tutucu hesap adı — gerçek hesapla güncellenecek)</p><p>Telefon: 0216 555 12 34</p><script>document.getElementById('ac').onclick=()=>{}</script></body></html>`,
  });
  try {
    const s = usabilitySmells(d).map(x => x.msg).join('\n');
    assert.match(s, /1 bağlantı tıklanınca hiçbir yere gitmiyor[^\n]*"Detay"/, 'logo href="#" sayılmaz');
    assert.match(s, /1 düğmeye hiçbir işlev[^\n]*"Sepete ekle"/, 'betiğe bağlı düğme sayılmaz');
    assert.match(s, /"Yol Tarifi Al" haritayı açmıyor/); assert.doesNotMatch(s, /"Adres & Yol Tarifi" haritayı/, 'menüdeki bölüm bağlantısı sayılmaz');
    assert.match(s, /harita bağlantısı sayfadaki adresi \("Bademaltı/);
    assert.match(s, /Instagram geçiyor ama profile bağlantı yok/);
    assert.match(s, /sahte numaraya/); assert.match(s, /yer tutucu notu/); assert.match(s, /yapışkan/);
    assert.match(checksText(checkWorkspace(d)), /kullanılabilirlik sorunu/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
  const ok = site({ 'index.html': `<header style="position:sticky;top:0"><nav><a href="#a">A</a><a href="#b">B</a><a href="#c">C</a></nav></header><address>Bademaltı Sok. No: 14</address><a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=Bademalt%C4%B1+Sok.+No%3A14">Yol Tarifi Al</a><a href="https://www.instagram.com/x/">Instagram</a><a href="tel:+902165551234">0216 555 12 34</a><form><button>Gönder</button></form>` });
  try { assert.deepEqual(usabilitySmells(ok), []); } finally { fs.rmSync(ok, { recursive: true, force: true }); }
});

test('sektör yönleri: brief\'e uyan sektör gelir, her yönde palet/font/kaçın var', () => {
  assert.equal(presetsFor('Mahalledeki kırtasiye dükkanım için site')[0].id, 'perakende');
  assert.equal(presetsFor('KAHVE dükkanı ve fırın')[0].id, 'kafe');
  assert.deepEqual(presetsFor('xyz'), []);
  for (const p of DESIGN_PRESETS) for (const y of p.yonler) for (const k of ['ad', 'palet', 'font', 'yerlesim', 'kacin']) assert.ok(y[k], `${p.id}.${k}`);
  assert.match(presetPrompt('diş kliniği'), /Sağlık[\s\S]*Sakin güven/);
  assert.match(presetPrompt('xyz'), /TASARIM YÖNÜ/); assert.doesNotMatch(presetPrompt('xyz'), /denenmiş yönler/);
  assert.match(aestheticPrompt(), /YAPMA[\s\S]*mor\/indigo/);
  assert.match(presetPrompt('kahve dükkanı'), /BAŞLANGIÇ noktasıdır, şablon değil/);
  // gerçek denemede lider "Sıcak zanaat"ı aynen almıştı: kopya tanınır, uyarlanmış yön tanınmaz
  assert.equal(copiedPreset('Sıcak zanaat: palet kavrulmuş kahve #3b2418, krema #f3e9dc, karamel #c8813a, zeytin #6b7044').ad, 'Sıcak zanaat');
  assert.equal(copiedPreset('Moda iskelesi: deniz #1d4e6b, kahve #3b2418, kum #e8dcc4, tuğla #a4472f'), null);
});

test('estetik becerisi tasarımcıda hep öne alınır; tasarım incelemesi özgünlüğe bakar', () => {
  const sk = pickSkills('designer', {}, 'erişilebilir site formu menü buton arayüz', 2);
  assert.equal(sk[0].id, 'ayirt-edici-estetik');
  const des = reviewersFor({ designer: {}, auditor: {} }, { members: ['claude', 'codex'] }).find(r => r.agent === 'designer');
  assert.match(des.focus, /ÖZGÜNLÜK/);
});
