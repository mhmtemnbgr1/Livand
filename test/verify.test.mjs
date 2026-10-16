// Kesin kontroller, kabul ölçütleri ve doğrulama çıktısı okuma istisnası — çalıştır: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkWorkspace, checksText } from '../lib/checks.mjs';
import { criteriaOf, acceptOf, classify } from '../lib/policy.mjs';

const site = files => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'livand-chk-')); for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); } return d; };

test('kesin kontroller: bozuk site her sorunu yakalar', () => {
  const d = site({
    'index.html': '<!doctype html><html><head><title>X</title></head><body><a href="#yok">a</a><a href="#var">b</a><div id="var"></div><img src="assets/logo.png"><script src="app.js"></script><script>let = ;</script></body></html>',
    'app.js': "const i = new Image(); i.src = 'assets/oyuncu.png';\nfunction f( {\n",
    'mod.js': "import x from './a.js';\nexport const y = 1;\n",
    'style.css': 'body{background:url(img/arka.png)}',
    'assets/atlas.json': '{"image":"atlas.png","frames":{}}',
    'veri.json': '{bozuk',
    'notlar.md': 'Lorem ipsum dolor. TODO: bitir',
  });
  try {
    const c = checkWorkspace(d), has = (file, re) => c.issues.some(x => x.file === file && re.test(x.msg));
    assert.ok(has('index.html', /Kırık sayfa içi bağlantı: #yok/));
    assert.ok(!has('index.html', /#var/), 'var olan id kırık sayılmaz');
    assert.ok(has('index.html', /Bulunamayan dosya: assets\/logo\.png/));
    assert.ok(has('index.html', /Sayfa içi betikte SyntaxError/));
    assert.ok(has('index.html', /viewport/) && has('index.html', /alt metni/));
    assert.ok(has('app.js', /SyntaxError/) && has('app.js', /Kodun yüklediği dosya yok: assets\/oyuncu\.png/));
    assert.ok(!c.issues.some(x => x.file === 'mod.js'), 'ES modülü sözdizimi hatası sayılmaz');
    assert.ok(has('style.css', /img\/arka\.png/));
    assert.ok(has('assets/atlas.json', /Atlasın görseli yok/));
    assert.ok(has('veri.json', /Geçersiz JSON/));
    assert.ok(has('notlar.md', /lorem/i) && has('notlar.md', /TODO/));
    assert.ok(c.errors >= 8 && c.warnings >= 4);
    assert.match(checksText(c), /OTOMATİK KONTROLLER/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('kesin kontroller: temiz site sorunsuz', () => {
  const d = site({
    'index.html': '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Temiz</title><link rel="stylesheet" href="s.css"></head><body><a href="#a">a</a><section id="a"><img src="i.png" alt="x"></section><a href="https://ornek.com">dış</a><a href="mailto:a@b.co">e</a><script type="module" src="m.js"></script></body></html>',
    's.css': 'body{margin:0;font-family:"Nunito Sans",sans-serif}', 'i.png': 'x', 'm.js': "export const a = 1;\n",
  });
  try { const c = checkWorkspace(d); assert.equal(c.errors, 0, JSON.stringify(c.issues)); assert.equal(c.warnings, 0); assert.equal(checksText(c), ''); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('kabul ölçütleri: temizleme ve denetçi değerlendirmesi', () => {
  const cr = criteriaOf([{ id: 'k1', olcut: 'Menü mobilde açılır' }, { olcut: 'Form doğrular' }, 'Düz metin ölçüt', { id: 'K1', olcut: 'tekrar' }, { id: 'K9', olcut: '' }]);
  assert.deepEqual(cr.map(c => c.id), ['K1', 'K2', 'K3']);
  assert.equal(cr[2].olcut, 'Düz metin ölçüt');
  const a = acceptOf({ kabul: { K1: 'gecti — menü çalışıyor', k2: 'kaldı — e-posta doğrulanmıyor', K3: { durum: 'geçti', kanit: 'var' }, K7: 'gecti' } }, cr);
  assert.deepEqual(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.durum])), { K1: 'gecti', K2: 'kaldi', K3: 'gecti' });
  assert.equal(a.K2.not, 'e-posta doğrulanmıyor');
  assert.deepEqual(acceptOf({}, cr), {});
});

test('onay politikası: denetçi yalnızca doğrulama klasöründeki ekran görüntülerini onaysız okur', () => {
  const ws = 'C:\\proje', tr = ['C:\\app\\tools\\assets.mjs', 'C:\\app\\data\\shots'];
  assert.equal(classify('Read', { file_path: 'C:\\app\\data\\shots\\p1\\t4\\mobil.png' }, ws, tr).auto, true);
  assert.notEqual(classify('Read', { file_path: 'C:\\app\\data\\state.json' }, ws, tr).auto, true);
  assert.notEqual(classify('Read', { file_path: 'C:\\app\\data\\shots\\..\\state.json' }, ws, tr).auto, true);
  assert.notEqual(classify('Write', { file_path: 'C:\\app\\data\\shots\\x.png' }, ws, tr).auto, true, 'yazma istisnası yok');
});

test('güvenlik: ".." ile çalışma klasöründen çıkan yol içeride sayılmaz', () => {
  assert.equal(classify('Bash', { command: 'type C:\\proje\\..\\gizli.txt' }, 'C:\\proje').risk, 'high');
  assert.equal(classify('Bash', { command: 'type C:/proje/alt/../a.txt' }, 'C:\\proje').risk, 'low');
});

test('gerçek denemeden: kontrol komutları yanlış alarm vermez, kaçamak yollar yine yakalanır', () => {
  const ws = 'C:\\Users\\kullanici\\Desktop\\LIVAND\\data\\workspaces\\k-rtasiye';
  const rx = String.raw`cd "C:\Users\kullanici\Desktop\LIVAND\data\workspaces\k-rtasiye" && node -e "const fs=require('fs');const html=fs.readFileSync('index.html','utf8');console.log(html.match(/tel:\+\d+/g));console.log([...new Set(html.match(/wa\.me\/\d+/g))])"`;
  assert.notEqual(classify('Bash', { command: rx }, ws).risk, 'high', 'JS düzenli ifadesi yol sanılmaz');
  assert.equal(classify('Bash', { command: String.raw`grep -n "sabit-cta\|harita-cerceve" index.html; echo "---"; grep -c "<section" index.html` }, ws).auto, true, 'tırnak içindeki \\| zincir sayılmaz');
  assert.equal(classify('Bash', { command: 'cat /etc/passwd' }, ws).risk, 'high', 'gerçek dış yol yine yakalanır');
  assert.notEqual(classify('Bash', { command: 'echo "$(rm -rf x)"' }, ws).auto, true, 'tırnak içi komut yerleştirme güvenli sayılmaz');
  assert.notEqual(classify('Bash', { command: 'grep x a.txt; rm -rf b' }, ws).auto, true, 'tırnak dışı zincir yine yakalanır');
});

test('gerçek denemeden: "doğrulanamadı" ölçütü kaldı saymaz', () => {
  const cr = [{ id: 'K1', olcut: 'a' }, { id: 'K2', olcut: 'b' }];
  const a = acceptOf({ kabul: { K1: 'doğrulanamadı — dosya okuma engellendi', K2: 'gecti — var' } }, cr);
  assert.equal(a.K1, undefined, 'belirsiz hüküm yok sayılır');
  assert.equal(a.K2.durum, 'gecti');
});
