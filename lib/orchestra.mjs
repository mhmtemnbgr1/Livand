// LIVAND Ofis — ürün modu orkestrasyonu (saf işlevler, token harcamaz).
// Araştırma bulgusu (Cognition "Multi-Agents: What's Actually Working", 2026; Anthropic çoklu ajan araştırma sistemi; MetaGPT):
//  - Birden çok ajanın AYNI ürüne paralel yazması tutarsız sonuç verir (her biri kendi örtük kararını verir).
//  - İşe yarayan: yazma TEK elden (yapımcı), diğer ajanlar zekâ katar: girdi hazırlar, gözden geçirir, öneri verir.
//  - Gözden geçiren temiz bağlamla değişikliklere bakar; yapımcı geri bildirimi kullanıcının isteğine göre süzer (uygula/reddet).
//  - Ajanlar özetle değil tam belgeyle haberleşir; örtük kararlar açıkça yazılır ve herkesle paylaşılır.
import { cut } from './policy.mjs';

const CODE = /\.(html?|css|m?js|cjs|ts|tsx|jsx|py|json|png|svg|gif|jpe?g|webp|mp3|wav|ogg)\b/i;   // ürünün parçası olan dosyalar
const INPUT_DOC = /\.(md|txt)\b/i;
export const isProductTask = t => CODE.test(String(t.deliverable || '')) || /(^|\W)(kod|html|css|javascript|canvas|uygulamayı|siteyi|sayfayı|oyunu)(\W|$)/i.test(`${t.instruction}`) && !INPUT_DOC.test(String(t.deliverable || ''));

// Plandaki ürün işlerini TEK yapımcı görevinde birleştirir; belge üreten işler girdi olarak kalır; denetim görevleri gözden geçirme döngüsüne devredilir.
// Dönen: { mode: 'urun', tasks, builder } ya da ürün işi yoksa { mode: 'ekip', tasks } (içerik/araştırma projeleri eski akışla yürür)
export function productize(tasks, agents) {
  const prod = tasks.filter(t => t.agent !== 'auditor' && isProductTask(t));
  if (!prod.length) return { mode: 'ekip', tasks };
  const builderAgent = agents.developer && !agents.developer.external ? 'developer' : prod[0].agent;
  const inputs = tasks.filter(t => t.agent !== 'auditor' && !prod.includes(t));
  const inputIds = new Set(inputs.map(t => t.id)), prodIds = new Set(prod.map(t => t.id));
  const uniq = a => [...new Set(a.filter(Boolean))];
  const builder = {
    id: prod[0].id, agent: builderAgent, role: 'yapimci',
    instruction: prod.length === 1 ? prod[0].instruction : 'Ürünü baştan sona TEK elden yap; şu işlerin hepsi senin:\n' + prod.map(t => `- ${t.instruction}${t.deliverable ? ` (→ ${t.deliverable})` : ''}`).join('\n'),
    deliverable: uniq(prod.map(t => t.deliverable)).join(', '),
    needs: uniq(prod.flatMap(t => t.needs || []).filter(n => inputIds.has(n))),
    caps: uniq(prod.flatMap(t => t.caps || t.yetenekler || [])), criteria: uniq(prod.flatMap(t => t.criteria || [])),
  };
  // girdiler ürün görevine bağlıysa (ör. "kodu bekle") bu bağımlılık kalkar: girdiler ürünü beklemez
  const ins = inputs.map(t => ({ ...t, needs: (t.needs || []).filter(n => !prodIds.has(n)) }));
  return { mode: 'urun', tasks: [...ins, builder], builder: builder.id };
}

// gözden geçirenler: tasarımcı (görsel), denetçi (ölçüt + hata), yazar (metin girdisi verdiyse), bağlıysa diğer CLI'ler (ikinci görüş)
export function reviewersFor(plan, agents, usable = () => false, builderAgent = 'developer') {
  const has = k => agents[k] && !agents[k].external && k !== builderAgent;
  const out = [];
  if (has('designer')) out.push({ key: 'tasarim', agent: 'designer', label: 'Tasarım incelemesi', focus: 'görsel kalite: hiyerarşi, boşluk, tipografi, renk ve kontrast, hizalama, tutarlılık, mobil görünüm, yönergedeki tarza uyum' });
  if (has('auditor')) out.push({ key: 'denetim', agent: 'auditor', label: 'Denetim', focus: 'kabul ölçütleri (her biri geçti/kaldı, kanıtla), hatalar, kırık bağlantı/dosya, erişilebilirlik, kullanıcı isteğine uyum', audit: true });
  if (has('writer') && plan.some(t => t.agent === 'writer')) out.push({ key: 'metin', agent: 'writer', label: 'Metin incelemesi', focus: 'metinlerin ürüne doğru taşınması, dil, ton, eylem çağrıları, yazım' });
  if (usable('codex') && has('auditor')) out.push({ key: 'codex', agent: 'auditor', provider: 'codex', label: 'İkinci görüş (Codex)', focus: 'kod incelemesi: mantık hataları, kenar durumlar, sağlamlık, sade ve bakımı kolay kod' });
  if (usable('antigravity') && has('designer')) out.push({ key: 'antigravity', agent: 'designer', provider: 'antigravity', label: 'İkinci görüş (Antigravity)', focus: 'kullanıcı deneyimi ve görsel tasarım: ilk izlenim, akış, okunabilirlik, mobil' });
  return out.slice(0, 4);
}

// gözden geçirme yanıtı: {"olmus":[...],"bulgular":[{"onem":"kritik|orta|kucuk","konu":"...","oneri":"..."}]}
const lastJson = (txt, keys) => { let last = null; for (const m of String(txt || '').matchAll(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g)) { try { const j = JSON.parse(m[0]); if (j && typeof j === 'object' && keys.some(k => k in j)) last = j; } catch {} } return last; };
export function findingsOf(txt) {
  const j = lastJson(txt, ['bulgular', 'olmus']); if (!j) return null;
  const sev = s => /kritik|critical|yüksek|high/i.test(s) ? 'kritik' : /k[uü]ç[uü]k|minor|düşük|low/i.test(s) ? 'kucuk' : 'orta';
  return {
    olmus: (Array.isArray(j.olmus) ? j.olmus : []).slice(0, 3).map(x => cut(String(x).trim(), 200)).filter(Boolean),
    bulgular: (Array.isArray(j.bulgular) ? j.bulgular : []).slice(0, 6).map(x => ({ onem: sev(String(x?.onem || '')), text: cut([x?.konu, x?.oneri].filter(Boolean).map(s => String(s).trim()).join(' → '), 320) })).filter(x => x.text),
    raw: j,
  };
}

// yapımcının yanıtındaki bölümler: "---KARARLAR---" (örtük kararlar açıkça) ve "---TRİYAJ---" (her bulguya uygula/reddet)
const section = (txt, name) => { const m = String(txt || '').match(new RegExp(`---\\s*${name}\\s*---([\\s\\S]*?)(?=---\\s*[A-ZÇĞİÖŞÜ]+\\s*---|$)`, 'i')); return m ? m[1] : ''; };
export function decisionsListOf(txt) { return section(txt, 'KARARLAR').split('\n').map(l => l.replace(/^\s*[-•*\d.)]+\s*/, '').trim()).filter(l => l.length > 3).slice(0, 12).map(l => cut(l, 200)); }
export function triageOf(txt) {
  const out = [];
  for (const l of section(txt, 'TR[İI]YAJ').split('\n')) {
    const W = '[\\wçğıöşüÇĞİÖŞÜ]*';   // \w Türkçe harfleri kapsamaz ("uygulandı"nın "ı"sı nota kaçmasın)
    const m = l.match(new RegExp(`^\\s*(\\d+)\\s*[:.)-]\\s*(uygulan${W}|uygula${W}|yap[ıi]ld${W}|reddedil${W}|reddet${W}|k[ıi]smen${W})\\s*[—–:-]?\\s*(.*)$`, 'i')); if (!m) continue;
    out.push({ no: +m[1], karar: /red/i.test(m[2]) ? 'reddedildi' : /k[ıi]smen/i.test(m[2]) ? 'kismen' : 'uygulandi', not: cut(m[3].trim(), 200) });
  }
  return out;
}
export const stripSections = txt => String(txt || '').replace(/---\s*(KARARLAR|TR[İI]YAJ)\s*---[\s\S]*?(?=---\s*[A-ZÇĞİÖŞÜ]+\s*---|$)/gi, '').trim();
