// Ajan becerileri testleri — çalıştır: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS, skillsOf, pickSkills, skillsPrompt, cleanCustomSkill, roleOf, MAX_SKILLS } from '../lib/skills.mjs';

test('kütüphane: her rolün becerisi var, kimlikler benzersiz, adımlar dolu', () => {
  for (const r of ['ceo', 'designer', 'developer', 'researcher', 'writer', 'auditor']) assert.ok(SKILLS.some(s => s.role === r), r);
  assert.equal(new Set(SKILLS.map(s => s.id)).size, SKILLS.length);
  for (const s of SKILLS) { assert.ok(s.name && s.desc && s.steps.length >= 3, s.id); assert.ok(s.always || s.when.length, s.id + ' tetikleyici'); }
});

test('rol: varsayılan ajan anahtarı ya da eklenen ajanın şablonu', () => {
  assert.equal(roleOf('developer'), 'developer');
  assert.equal(roleOf('pazarlamaci', { preset: 'yazar' }), 'writer');
  assert.equal(roleOf('pazarlamaci', {}), null);
});

test('seçim: göreve uyan beceriler, en fazla 3, kapalılar girmez', () => {
  const t = 'GÖREV: index.html ve style.css ile responsive kırtasiye sitesi yap, iletişim formu olsun';
  const pick = pickSkills('developer', {}, t);
  assert.ok(pick.length <= MAX_SKILLS && pick.length > 0);
  assert.ok(pick.some(s => s.id === 'responsive-css'));
  const off = pickSkills('developer', { skillsOff: ['responsive-css'] }, t);
  assert.ok(!off.some(s => s.id === 'responsive-css'), 'kapatılan beceri seçilmez');
  assert.deepEqual(pickSkills('developer', {}, 'alakasız bir cümle'), [], 'eşleşme yoksa beceri yok');
  // "always" beceriler eşleşme olmadan da girer
  assert.ok(pickSkills('auditor', {}, 'alakasız').some(s => s.id === 'teslim-kontrolu'));
});

test('kendi becerisi: tetikleyiciyle ya da her görevde seçilir, önceliklidir', () => {
  const a = { customSkills: [cleanCustomSkill({ name: 'Instagram gönderisi', when: 'instagram, sosyal', steps: '- Görsel 1080x1080\nKısa açıklama\n\n' })] };
  assert.deepEqual(a.customSkills[0].steps, ['Görsel 1080x1080', 'Kısa açıklama']);
  assert.ok(a.customSkills[0].id.startsWith('ozel-'));
  assert.equal(pickSkills('writer', a, 'Instagram için blog yazısı ve SEO metni')[0].name, 'Instagram gönderisi');
  const all = { customSkills: [cleanCustomSkill({ name: 'Hep', steps: 'x' })] };
  assert.ok(pickSkills('writer', all, 'alakasız').some(s => s.name === 'Hep'));
  assert.ok(skillsOf('writer', all).find(s => s.name === 'Hep').own);
  assert.equal(cleanCustomSkill({ name: '', steps: 'x' }), null);
  assert.equal(cleanCustomSkill({ name: 'x', steps: '' }), null);
});

test('istem: beceri adı, adımlar ve bitti ölçütü yazılır', () => {
  const p = skillsPrompt(pickSkills('developer', {}, 'form doğrulama olan iletişim formu'));
  assert.match(p, /BECERİLERİN/);
  assert.match(p, /## Form doğrulama/);
  assert.match(p, /Bitti sayılması için:/);
  assert.equal(skillsPrompt([]), '');
});
