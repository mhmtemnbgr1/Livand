// Ajan gelişim sistemi testleri — çalıştır: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARTERS, charterOf, levelOf, focusOf, addLesson, topLessons, migrateAgent, metricLessons, extractSelfReview, growthPrompt, similar } from '../lib/growth.mjs';

const sc = (score, parts) => ({ from: 'metrik', score, parts });

test('her varsayılan ajanın mesleki yönergesi var', () => {
  for (const k of ['ceo', 'designer', 'developer', 'researcher', 'writer', 'auditor']) {
    assert.ok(CHARTERS[k].standards.length >= 3, k);
    assert.ok(CHARTERS[k].checklist.length >= 2, k);
  }
  assert.ok(charterOf('pazarlamaci').standards.length >= 2, 'eklenen ajanlar genel yönerge alır');
});

test('seviye: deneyimle yükselir, düşük kalite seviyeyi sınırlar', () => {
  assert.equal(levelOf({ scores: [] }).name, 'Stajyer');
  const good = { scores: Array.from({ length: 30 }, () => sc(9, {})) };
  assert.equal(levelOf(good).name, 'Kıdemli');   // 270 deneyim
  const weak = { scores: Array.from({ length: 30 }, () => sc(5, {})) };
  assert.equal(levelOf(weak).name, 'Yardımcı');  // 150 deneyim ama ortalama < 6
  const mid = { scores: Array.from({ length: 30 }, () => sc(7, {})) };
  assert.equal(levelOf(mid).name, 'Uzman');      // 210 deneyim ama ortalama < 7.5
  assert.ok(levelOf({ scores: [sc(9, {})] }).progress > 0);
  assert.equal(levelOf({ scores: [{ from: 'user', score: 10 }] }).tasks, 0, 'kullanıcı puanı görev sayılmaz');
});

test('gelişim alanı: en zayıf ölçüt seçilir', () => {
  const a = { scores: [sc(8, { teslimat: 100, verimlilik: 40, uyum: 100 }), sc(8, { teslimat: 100, verimlilik: 60, uyum: 90 })] };
  const f = focusOf(a);
  assert.equal(f.key, 'verimlilik'); assert.equal(f.value, 50);
  assert.deepEqual([...f.strong].sort(), ['teslimat', 'uyum']);
  assert.equal(focusOf({ scores: [sc(10, { teslimat: 100, uyum: 100 })] }).key, null);
  assert.equal(focusOf({ scores: [] }), null);
});

test('dersler: benzerler birleşir ve güçlenir, sınır korunur', () => {
  const a = {};
  addLesson(a, 'Teslimden önce kelime sayısını kontrol et', 'oz');
  addLesson(a, 'Kelime sayısını teslimden önce kontrol et.', 'denetci');
  assert.equal(a.lessons.length, 1);
  assert.equal(a.lessons[0].n, 2);
  assert.equal(a.lessons[0].src, 'denetci', 'daha güvenilir kaynak öne geçer');
  assert.equal(addLesson(a, 'kısa', 'oz'), null, 'çok kısa ders alınmaz');
  for (let i = 0; i < 40; i++) addLesson(a, `Benzersiz ders numarası ${i} için ayrıntılı açıklama ${'x'.repeat(i)}`, 'metrik');
  assert.ok(a.lessons.length <= 24);
  assert.ok(similar('kelime sayısını kontrol et', 'kontrol et kelime sayısını') > 0.9);
});

test('dersler: kullanıcı geri bildirimi en üstte', () => {
  const a = {};
  addLesson(a, 'Kendi notum: daha hızlı çalışmalıyım', 'oz');
  addLesson(a, 'Kullanıcı tablolu özet istiyor, düz metin değil', 'kullanici');
  assert.equal(topLessons(a, 1)[0].src, 'kullanici');
});

test('eski düz metin dersler yeni yapıya taşınır', () => {
  const a = migrateAgent({ memory: ['Kullanıcı kısa metin seviyor, uzatma.'] });
  assert.equal(a.lessons.length, 1); assert.equal(a.lessons[0].src, 'proje');
});

test('ölçülebilir dersler: token harcamadan puandan çıkar', () => {
  const ls = metricLessons({ teslimat: 50, verimlilik: 30, kalite: 50 }, { deliverable: 'yazi.md', denials: 1, questions: 1 }, { not: 'Yazı 206 kelime, hedef 300' });
  const all = ls.map(x => x[1]).join(' | ');
  assert.match(all, /yazi\.md/); assert.match(all, /plan/); assert.match(all, /Reddedilen/); assert.match(all, /görev tanımını/); assert.match(all, /Denetçi: Yazı 206/);
  assert.deepEqual(metricLessons({ teslimat: 100, verimlilik: 100, uyum: 100, kalite: 95 }, {}), []);
});

test('öz değerlendirme satırı ayrıştırılır ve yanıttan çıkarılır', () => {
  const r = extractSelfReview('Yazıyı bitirdim.\n---ÖZ--- Kelime sayısını teslimden önce sayacağım\n---ÖZET---\nKısa özet');
  assert.equal(r.review, 'Kelime sayısını teslimden önce sayacağım');
  assert.ok(!r.text.includes('---ÖZ---')); assert.ok(r.text.includes('---ÖZET---'));
  assert.equal(extractSelfReview('öz yok').review, null);
});

test('istem bölümü: standartlar, seviye, gelişim alanı ve dersler içerir', () => {
  const a = { scores: [sc(8, { teslimat: 100, verimlilik: 40 })] };
  addLesson(a, 'Kullanıcı tablolu özet istiyor', 'kullanici');
  const p = growthPrompt('writer', a);
  assert.match(p, /MESLEKİ STANDARTLARIN \(İçerik yazarı\)/); assert.match(p, /SEVİYEN: Stajyer/); assert.match(p, /Gelişim alanın/); assert.match(p, /tablolu özet/); assert.match(p, /---ÖZ---/);
  assert.ok(!growthPrompt('writer', a, { work: false }).includes('---ÖZ---'), 'plan aşamasında öz değerlendirme istenmez');
});

import { HUMAN_BASELINE, baselineOf, savingsOf, MIN_ACCEPT } from '../lib/growth.mjs';

test('tasarruf: ölçülmüş referanslar kaynaklı, varsayımlar işaretli', () => {
  assert.equal(HUMAN_BASELINE.developer.min, 161); assert.equal(HUMAN_BASELINE.developer.measured, true); assert.match(HUMAN_BASELINE.developer.url, /2302\.06590/);
  assert.equal(HUMAN_BASELINE.writer.measured, true); assert.match(HUMAN_BASELINE.writer.url, /science\.adh2586/);
  for (const k of ['researcher', 'designer', 'ceo', 'auditor']) assert.equal(HUMAN_BASELINE[k].measured, false, k + ' varsayım olarak işaretli olmalı');
  assert.equal(baselineOf('developer', { developer: 120 }).min, 120); assert.equal(baselineOf('developer', { developer: 120 }).measured, false);
  assert.equal(baselineOf('pazarlamaci').measured, false);
});

test('tasarruf: sadece kabul edilen işler, ajan süresi düşülür', () => {
  const t0 = 1_000_000;
  const tasks = [
    { agent: 'developer', status: 'bitti', score: 8, startedAt: t0, endedAt: t0 + 11 * 60000 },   // 161 - 11 = 150 dk
    { agent: 'writer', status: 'bitti', score: 9, startedAt: t0, endedAt: t0 + 6 * 60000 },       // 26 - 6 = 20 dk
    { agent: 'writer', status: 'bitti', score: MIN_ACCEPT - 1, startedAt: t0, endedAt: t0 + 60000 }, // düşük puan: sayılmaz
    { agent: 'designer', status: 'hata', score: 9 },                                               // bitmedi: sayılmaz
    { agent: 'developer', status: 'bitti', score: 7, startedAt: t0, endedAt: t0 + 200 * 60000 },  // ajan insandan yavaş: 0 (negatif değil)
  ];
  const s = savingsOf(tasks);
  assert.equal(s.tasks, 3); assert.equal(s.skipped, 1);
  assert.equal(Math.round(s.savedMin), 170);
  assert.equal(Math.round(s.humanMin), 161 + 26 + 161);
  assert.equal(Math.round(s.agentMin), 11 + 6 + 200);
  assert.equal(s.per.developer.tasks, 2); assert.equal(s.per.writer.measured, true);
  assert.deepEqual(savingsOf([]), { tasks: 0, skipped: 0, humanMin: 0, agentMin: 0, savedMin: 0, speedup: null, per: {} });
});
