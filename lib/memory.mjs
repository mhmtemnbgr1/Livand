// LIVAND Ofis — uzun süreli bellek (saf işlevler, API ve bağımlılık yok, token harcamaz).
// Şapka başına tutulan en güçlü 24 dersin dışına düşenler, biten projelerin özeti/kararları ve kullanıcı tercihleri burada birikir.
// Arama vektör veritabanı yerine BM25 (anahtar kelime ağırlıklı) + yakınlık ile yapılır: gömme (embedding) modeli ya da API gerekmez.
// Türkçe ekler için kelimeler ilk 5 harfe kısaltılır (kök yaklaşımı): "oyunun", "oyunlar", "oyuncu" → "oyunu"/"oyunl"… ilk 4-5 harf eşleşir.

export const MEM_MAX = 2000;
const STOP = new Set('ve ile bir bu şu da de için gibi ama veya ya çok daha en her hiç ne mi mı mu mü olan olarak sonra önce kadar ise the and for with that this from are was you your not'.split(' '));
const fold = s => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u');
export function tokens(s) {
  return fold(s).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)).map(w => w.slice(0, 5));
}

const norm = s => fold(s).replace(/\s+/g, ' ').trim();
// entry: {kind: 'ders'|'proje'|'karar'|'tercih'|'not', text, hat?, project?, w?}; aynı metin varsa güçlendirilir
export function remember(mem, entry, now = Date.now()) {
  const text = String(entry.text || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  if (text.length < 8) return null;
  mem.items ||= [];
  const key = norm(text), hit = mem.items.find(x => norm(x.text) === key && x.kind === entry.kind);
  if (hit) { hit.n = (hit.n || 1) + 1; hit.ts = now; return hit; }
  const it = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), ts: now, kind: entry.kind || 'not', text, hat: entry.hat || undefined, project: entry.project || undefined, w: entry.w || 1, n: 1 };
  mem.items.push(it);
  if (mem.items.length > MEM_MAX) { mem.items.sort((a, b) => worth(b, now) - worth(a, now)); mem.items.length = MEM_MAX; }
  return it;
}
const worth = (x, now) => (x.w || 1) * (1 + Math.log2(x.n || 1)) * Math.pow(0.5, (now - (x.ts || now)) / (180 * 864e5));   // 6 ayda yarılanır

// BM25 araması: query metnine en ilgili k kayıt. hat verilirse o şapkanın kayıtları ve şapkasız (genel) kayıtlar aranır.
export function recall(mem, query, { k = 5, hat, minScore = 1.2, exclude = [], now = Date.now() } = {}) {
  const items = (mem.items || []).filter(x => (!hat || !x.hat || x.hat === hat) && !exclude.some(e => norm(e) === norm(x.text)));
  const q = [...new Set(tokens(query))];
  if (!q.length || !items.length) return [];
  const docs = items.map(x => tokens(x.text)), avg = docs.reduce((a, d) => a + d.length, 0) / docs.length || 1;
  const df = Object.fromEntries(q.map(t => [t, docs.filter(d => d.includes(t)).length]));
  const N = docs.length, k1 = 1.2, b = 0.75;
  return items.map((x, i) => {
    const d = docs[i]; let s = 0;
    for (const t of q) {
      const f = d.filter(w => w === t).length; if (!f) continue;
      const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avg));
    }
    return { x, s: s * (0.7 + 0.3 * Math.min(1, worth(x, now))) };
  }).filter(r => r.s >= minScore).sort((a, b) => b.s - a.s).slice(0, k).map(r => ({ ...r.x, score: +r.s.toFixed(2) }));
}

const KIND = { ders: 'ders', proje: 'geçmiş proje', karar: 'karar', tercih: 'kullanıcı tercihi', not: 'not' };
export const recallText = list => list.map(x => `- [${KIND[x.kind] || x.kind}${x.project ? ' · ' + x.project : ''}] ${x.text}`).join('\n');
