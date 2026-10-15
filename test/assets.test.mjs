// Asset aracı, yetenek kataloğu ve asset aracı onay istisnası testleri — çalıştır: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodePng, decodePng, pixelArt, removeBg, components, trim, pack, scaleNN, bgColor } from '../tools/assets.mjs';
import { playbookFor, catalogPrompt, capsForTask, capabilityPrompt, capTools } from '../lib/capabilities.mjs';
import { classify } from '../lib/policy.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOOL = path.join(root, 'tools', 'assets.mjs');
const px = (im, x, y) => [...im.data.subarray((y * im.w + x) * 4, (y * im.w + x) * 4 + 4)];
// yeşil zemin üzerinde iki karakter; soldakinin içinde zemin renginde bir "ağız" var
const SHEET = { palette: { g: '#22cc44', k: '#111111', r: '#dd3322' }, rows: ['gggggggggg', 'gkkkggggkg', 'gkgkggggkg', 'gkkkgggggg', 'gggggggggg'] };

test('PNG: yaz → oku birebir aynı', () => {
  const { im } = pixelArt(SHEET, 2);
  const back = decodePng(encodePng(im));
  assert.equal(back.w, 20); assert.equal(back.h, 10);
  assert.deepEqual(back.data, im.data);
  assert.throws(() => decodePng(Buffer.from('JFIF')), /PNG değil/);
});

test('PNG: depodaki gerçek ekran görüntüsü okunur', () => {
  const f = path.join(root, 'docs', 'img', 'pano.png');
  if (!fs.existsSync(f)) return;
  const im = decodePng(fs.readFileSync(f));
  assert.ok(im.w > 100 && im.h > 100 && im.data.length === im.w * im.h * 4);
});

test('piksel sanat: palet, saydamlık, kareler ve hatalar', () => {
  const r = pixelArt({ palette: { a: '#ff0000', '.': 'none' }, frames: [['a.', '.a'], ['.a', 'a.']] }, 3);
  assert.equal(r.frames, 2); assert.equal(r.im.w, 12); assert.equal(r.im.h, 6);
  assert.deepEqual(px(r.im, 0, 0), [255, 0, 0, 255]);
  assert.equal(px(r.im, 3, 0)[3], 0);
  assert.throws(() => pixelArt({ palette: { a: '#f00' }, rows: ['ab'] }), /Palette olmayan/);
  assert.throws(() => pixelArt({ palette: { ab: '#f00' }, rows: ['a'] }), /tek karakter/);
});

test('arka plan kaldırma: kenardan dolgu içteki aynı rengi korur, --all korumaz', () => {
  const a = pixelArt(SHEET).im;
  assert.deepEqual(bgColor(a), [0x22, 0xcc, 0x44]);
  removeBg(a);
  assert.equal(px(a, 0, 0)[3], 0, 'zemin saydam');
  assert.equal(px(a, 2, 2)[3], 255, 'karakterin içindeki zemin rengi korunur');
  assert.equal(px(a, 1, 1)[3], 255, 'karakter korunur');
  const b = pixelArt(SHEET).im; removeBg(b, { all: true });
  assert.equal(px(b, 2, 2)[3], 0);
});

test('bölme, kırpma, atlas ve büyütme', () => {
  const im = pixelArt(SHEET).im; removeBg(im);
  const cs = components(im, { min: 1 });
  assert.equal(cs.length, 2);
  assert.deepEqual(cs[0], { x: 1, y: 1, w: 3, h: 3 });
  assert.deepEqual(cs[1], { x: 8, y: 1, w: 1, h: 2 });
  assert.equal(components(im, { min: 1, gap: 6 }).length, 1, 'yakın parçalar birleşir');
  const t = trim(im); assert.equal(t.w, 8); assert.equal(t.h, 3);
  const at = pack([{ name: 'a', im: trim(im) }, { name: 'b', im: scaleNN(trim(im), 2) }], 1);
  assert.deepEqual(Object.keys(at.frames).sort(), ['a', 'b']);
  assert.ok(at.im.w >= 17 && at.im.h >= 10);
});

test('komut satırı: pixel → nobg → split → pack zinciri dosya üretir', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'livand-assets-'));
  try {
    fs.writeFileSync(path.join(d, 's.json'), JSON.stringify(SHEET));
    const run = (...a) => JSON.parse(execFileSync(process.execPath, [TOOL, ...a], { cwd: d, encoding: 'utf8' }));
    assert.equal(run('pixel', 's.json', 's.png', '--scale', '4').boyut, '40x20');
    assert.ok(run('nobg', 's.png', 'c.png').silinen_piksel > 0);
    assert.equal(run('split', 'c.png', 'parca', '--auto', '--min', '1').asset_sayisi, 2);
    const m = JSON.parse(fs.readFileSync(path.join(d, 'parca', 'manifest.json'), 'utf8'));
    assert.equal(m.sprites.length, 2);
    assert.equal(run('pack', 'parca', 'assets/atlas.png').kare, 2);
    assert.ok(fs.existsSync(path.join(d, 'assets', 'atlas.json')));
    assert.throws(() => execFileSync(process.execPath, [TOOL, 'scale', 's.png', 'x.png', '--x', '99'], { cwd: d, stdio: 'pipe' }));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('yetenekler: oyun rehberi, katalog, CEO ataması ve yedek eşleşme', () => {
  assert.equal(playbookFor('Bana bir uzay oyunu yap')?.id, 'oyun');
  assert.equal(playbookFor('Kırtasiye dükkanım için web sitesi')?.id, 'web-sitesi');
  assert.equal(playbookFor('merhaba'), null);
  const cat = catalogPrompt('platform oyunu', ['designer', 'developer', 'auditor']);
  assert.match(cat, /asset-hatti/); assert.match(cat, /PROJE TÜRÜ: Oyun/); assert.match(cat, /ÜRETEMEZ/);
  // CEO'nun verdiği yetenek role uymuyorsa atılır
  assert.deepEqual(capsForTask({ instruction: 'x', yetenekler: ['asset-hatti', 'yok'] }, 'designer'), ['asset-hatti']);
  assert.deepEqual(capsForTask({ instruction: 'x', yetenekler: ['asset-hatti'] }, 'writer'), []);
  // CEO atamadıysa: oyun projesinde sprite işi tasarımcıya asset hattı getirir
  assert.ok(capsForTask({ instruction: 'Karakter sprite\'larını üret' }, 'designer', 'zıplama oyunu').includes('asset-hatti'));
  assert.deepEqual(capsForTask({ instruction: 'Karakter sprite\'larını üret' }, 'designer', 'merhaba'), []);
  assert.deepEqual(capsForTask({ instruction: 'Karakter sprite\'larını üret' }, 'designer', 'zıplama oyunu', { auto: false }), [], 'CEO başka görevlere yetenek atadıysa yedek eşleşme yok');
  const pr = capabilityPrompt(['asset-hatti'], { tool: 'C:\\app\\tools\\assets.mjs' });
  assert.match(pr, /node "C:\\app\\tools\\assets\.mjs"/);
  assert.deepEqual(capTools(['asset-hatti', 'svg-cizim']), ['Bash']);
});

test('onay politikası: asset aracı yalnızca çalışma klasörü içinde ve zincirsiz onaysız çalışır', () => {
  const ws = 'C:\\proje', tr = ['C:\\app\\tools\\assets.mjs'];
  const c = cmd => classify('Bash', { command: cmd }, ws, tr);
  assert.equal(c('node "C:\\app\\tools\\assets.mjs" nobg a.png b.png').auto, true);
  assert.equal(c('node C:/app/tools/assets.mjs split assets/s.png assets/parca --auto').auto, true);
  assert.equal(c('cd "C:\\proje" && node "C:\\app\\tools\\assets.mjs" info a.png').auto, true);
  assert.equal(c('node "C:\\app\\tools\\assets.mjs" nobg C:\\Users\\x\\gizli.png b.png').risk, 'high', 'dış yol');
  assert.notEqual(c('node "C:\\app\\tools\\assets.mjs" info a.png && del a.png').auto, true, 'zincirleme');
  assert.notEqual(c('node "C:\\app\\tools\\assets.mjs" info a.png > ../x').auto, true, 'yönlendirme');
  assert.notEqual(c('cd .. && node "C:\\app\\tools\\assets.mjs" info a.png').auto, true, 'üst klasöre çıkma');
  assert.notEqual(c('node "C:\\baska\\assets.mjs" info a.png').auto, true, 'başka betik');
  assert.notEqual(classify('Bash', { command: 'node "C:\\app\\tools\\assets.mjs" info a.png' }, ws).auto, true, 'güvenilir liste yoksa istisna yok');
});
