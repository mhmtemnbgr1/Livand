// Ürün modu orkestrasyonu testleri — çalıştır: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { productize, reviewersFor, findingsOf, decisionsListOf, triageOf, stripSections, isProductTask } from '../lib/orchestra.mjs';

const AG = { ceo: {}, designer: {}, developer: {}, researcher: {}, writer: {}, auditor: {} };

test('ürün işi tek yapımcıda birleşir; belgeler girdi kalır; denetim döngüye devredilir', () => {
  const plan = [
    { id: 't1', agent: 'designer', instruction: 'Oyun tasarım belgesi yaz.', needs: [], deliverable: 'oyun-tasarimi.md' },
    { id: 't2', agent: 'designer', instruction: 'Assetleri üret.', needs: ['t1'], deliverable: 'assets/atlas.png', caps: ['asset-hatti'], criteria: ['K2'] },
    { id: 't3', agent: 'developer', instruction: 'Oyun kodunu yaz.', needs: ['t1'], deliverable: 'index.html, game.js', caps: ['calistir-dogrula'], criteria: ['K1', 'K2'] },
    { id: 't4', agent: 'auditor', instruction: 'Denetle.', needs: ['t2', 't3'], deliverable: '' },
    { id: 't5', agent: 'writer', instruction: 'Metinleri yaz.', needs: ['t3'], deliverable: 'metinler.md' },
  ];
  const o = productize(plan, AG);
  assert.equal(o.mode, 'urun');
  assert.deepEqual(o.tasks.map(t => t.id), ['t1', 't5', 't2']);
  const b = o.tasks.find(t => t.role === 'yapimci');
  assert.equal(b.agent, 'developer', 'yapımcı yazılımcı');
  assert.match(b.instruction, /TEK elden/); assert.match(b.instruction, /Assetleri üret/); assert.match(b.instruction, /Oyun kodunu yaz/);
  assert.equal(b.deliverable, 'assets/atlas.png, index.html, game.js');
  assert.deepEqual(b.caps, ['asset-hatti', 'calistir-dogrula']); assert.deepEqual(b.criteria, ['K2', 'K1']);
  assert.deepEqual(b.needs, ['t1'], 'yapımcı girdileri bekler');
  assert.deepEqual(o.tasks.find(t => t.id === 't5').needs, [], 'girdi ürünü beklemez');
  assert.ok(!o.tasks.some(t => t.agent === 'auditor'));
});

test('ürün işi yoksa ekip modu; tek ürün görevi aynen kalır', () => {
  const blog = [{ id: 't1', agent: 'researcher', instruction: 'Kaynak topla', deliverable: 'kaynaklar.md' }, { id: 't2', agent: 'writer', instruction: 'Yazı yaz', deliverable: 'yazi.md', needs: ['t1'] }, { id: 't3', agent: 'auditor', instruction: 'Denetle' }];
  assert.equal(productize(blog, AG).mode, 'ekip');
  assert.equal(productize(blog, AG).tasks.length, 3);
  const one = productize([{ id: 't1', agent: 'developer', instruction: 'Hesap makinesi yap', deliverable: 'index.html' }], AG);
  assert.equal(one.tasks[0].instruction, 'Hesap makinesi yap');
  assert.ok(isProductTask({ instruction: 'Siteyi yap', deliverable: '' }));
  assert.ok(!isProductTask({ instruction: 'Sayfa metinlerini yaz', deliverable: 'icerik.md' }));
});

test('gözden geçirenler: tasarım + denetim, yazar varsa metin, bağlı CLI\'ler ikinci görüş', () => {
  const plan = [{ agent: 'writer' }, { agent: 'developer' }];
  assert.deepEqual(reviewersFor(plan, AG, () => false).map(r => r.key), ['tasarim', 'denetim', 'metin']);
  const all = reviewersFor(plan, AG, k => ['codex', 'antigravity'].includes(k));
  assert.equal(all.length, 4, 'en fazla 4');
  assert.ok(all.some(r => r.provider === 'codex'));
  assert.ok(!reviewersFor([{ agent: 'developer' }], AG, () => false).some(r => r.key === 'metin'), 'yazar planda yoksa metin incelemesi yok');
});

test('bulgu, karar ve triyaj ayrıştırma', () => {
  const f = findingsOf('Baktım.\n{"olmus":["Renkler iyi"],"bulgular":[{"onem":"Kritik","konu":"Menü mobilde açılmıyor","oneri":"aria-expanded ve JS ekle"},{"onem":"minor","konu":"Boşluk"},{"konu":""}],"kabul":{"K1":"gecti — var"}}');
  assert.deepEqual(f.olmus, ['Renkler iyi']);
  assert.deepEqual(f.bulgular.map(x => x.onem), ['kritik', 'kucuk']);
  assert.equal(f.bulgular[0].text, 'Menü mobilde açılmıyor → aria-expanded ve JS ekle');
  assert.equal(f.raw.kabul.K1, 'gecti — var');
  assert.equal(findingsOf('JSON yok'), null);
  const txt = 'Yaptım.\n---KARARLAR---\n- Palet: lacivert\n2. Yazı: Inter\n---TRİYAJ---\n1: uygulandı — menüyü düzelttim\n2: reddedildi — kapsam dışı\n3) kısmen — sadece mobil\n---ÖZET---\nözet';
  assert.deepEqual(decisionsListOf(txt), ['Palet: lacivert', 'Yazı: Inter']);
  assert.deepEqual(triageOf(txt).map(x => [x.no, x.karar]), [[1, 'uygulandi'], [2, 'reddedildi'], [3, 'kismen']]);
  assert.equal(triageOf(txt)[1].not, 'kapsam dışı');
  assert.equal(triageOf(txt)[0].not, 'menüyü düzelttim', 'Türkçe harf nota kaçmaz');
  assert.equal(triageOf(txt)[2].not, 'sadece mobil');
  assert.equal(stripSections(txt), 'Yaptım.\n---ÖZET---\nözet');
});
