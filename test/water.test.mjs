// Su ayak izi tahmini — çalıştır: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { waterOf, addTokens, fmtWater, waterCompare, WATER_SCENARIOS } from '../lib/water.mjs';

test('su: kaynaklarla tutarlı büyüklük, sıralı aralık, önbellek ucuz', () => {
  // tipik sohbet yanıtı (500 girdi, 500 çıktı): Google'ın 0,26 mL ölçümü aralığın içinde, orta ~1 mL
  const chat = waterOf({ tin: 500, tout: 500 });
  assert.ok(chat.dusuk <= 0.26 && 0.26 <= chat.yuksek, `0,26 mL aralıkta olmalı: ${chat.dusuk}–${chat.yuksek}`);
  assert.ok(chat.orta > 0.5 && chat.orta < 2);
  assert.ok(chat.dusuk < chat.orta && chat.orta < chat.yuksek);
  // önbellekten okunan girdi yeni girdiden ucuz, çıktı en pahalı
  assert.ok(waterOf({ tcache: 10000 }).orta < waterOf({ tin: 10000 }).orta);
  assert.ok(waterOf({ tin: 10000 }).orta < waterOf({ tout: 10000 }).orta);
  // gerçek Codex görsel turu (22k yeni girdi, 76k önbellek, 520 çıktı): birkaç mL
  const turn = waterOf({ tin: 22072, tcache: 75648, tout: 520 });
  assert.ok(turn.orta > 2 && turn.orta < 10, String(turn.orta)); assert.ok(turn.wh > 1 && turn.wh < 5);
  assert.deepEqual(waterOf({}), { dusuk: 0, orta: 0, yuksek: 0, wh: 0 });
  assert.deepEqual(addTokens({ tin: 1, tout: 2 }, { tin: 3, tcache: 4 }), { tin: 4, tout: 2, tcache: 4 });
  assert.equal(Object.keys(WATER_SCENARIOS).length, 3);
});

test('su: okunur biçim ve gündelik karşılık', () => {
  assert.equal(fmtWater(0.42), '0,4 mL'); assert.equal(fmtWater(250), '250 mL'); assert.equal(fmtWater(1500), '1,5 L');
  assert.equal(waterCompare(0.3), 'birkaç damla'); assert.match(waterCompare(400), /su bardağı/); assert.match(waterCompare(5000), /pet şişe/); assert.match(waterCompare(200000), /duş/);
});
