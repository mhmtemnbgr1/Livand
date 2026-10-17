// LIVAND Ofis — ajanların tahmini su ayak izi (saf işlevler, token harcamaz).
// Su = enerji (Wh) × su yoğunluğu (mL/Wh). Enerji token sayılarından tahmin edilir: çıktı tokenı (üretim) pahalı, yeni girdi tokenı
// (prefill) çok daha ucuz, önbellekten okunan girdi en ucuz. Şirketler model başına kesin rakam yayımlamadığı için TEK sayı değil,
// düşük / orta / yüksek aralık verilir; arayüz "orta"yı gösterir, aralığı da yazar.
//
// Dayanaklar:
// - Google (2025, arXiv:2508.15734): ortanca Gemini metin istemi 0,24 Wh ve 0,26 mL su (veri merkezi soğutması dahil, eğitim hariç) → ≈1,1 mL/Wh.
// - OpenAI (Altman, 2025): ortalama ChatGPT sorgusu ≈0,34 Wh, ≈0,32 mL (doğrulanmamış beyan).
// - Epoch AI: tipik sorgu ≈0,3 Wh; Microsoft Research (Joule): uzun/akıl yürütmeli yanıt ≈3,9 Wh.
// - Li ve ark. (2023, "Making AI Less Thirsty"): elektriğin üretildiği santralin suyu da sayılınca toplam ≈ yerinde suyun birkaç katı.
// - Mistral Large 2 yaşam döngüsü analizi (2025): 400 tokenlık yanıt başına 45 mL (donanım üretimi dahil, en geniş kapsam).
export const WATER_SCENARIOS = {
  dusuk:  { label: 'düşük',  outWh: 0.3, inWh: 0.015, cacheWh: 0.003, mlPerWh: 1.1, note: 'Google ölçümüne yakın: verimli donanım, yalnızca veri merkezi soğutması' },
  orta:   { label: 'orta',   outWh: 1.0, inWh: 0.05,  cacheWh: 0.01,  mlPerWh: 1.8, note: 'büyük model, sektör ortalaması su verimliliği (≈1,8 L/kWh)' },
  yuksek: { label: 'yüksek', outWh: 2.0, inWh: 0.1,   cacheWh: 0.02,  mlPerWh: 5.0, note: 'akıl yürütmeli uzun işler + elektrik üretimindeki su (Li ve ark. kapsamı)' },
};   // outWh/inWh/cacheWh: 1000 token başına Wh

// t: {tin (önbellek dışı girdi), tout (çıktı), tcache (önbellekten okunan girdi)} → {dusuk, orta, yuksek} mL ve orta senaryonun Wh'si
export function waterOf(t = {}) {
  const k = x => Math.max(0, +x || 0) / 1000, out = {};
  for (const [id, s] of Object.entries(WATER_SCENARIOS)) {
    const wh = k(t.tout) * s.outWh + k(t.tin) * s.inWh + k(t.tcache) * s.cacheWh;
    out[id] = wh * s.mlPerWh;
    if (id === 'orta') out.wh = wh;
  }
  return out;
}
export const addTokens = (a, b) => ({ tin: (a?.tin || 0) + (b?.tin || 0), tout: (a?.tout || 0) + (b?.tout || 0), tcache: (a?.tcache || 0) + (b?.tcache || 0) });

// mL → okunur metin ve gündelik karşılık
export function fmtWater(ml) {
  const v = Math.max(0, +ml || 0);
  return v >= 1000 ? (v / 1000).toLocaleString('tr', { maximumFractionDigits: v >= 10000 ? 0 : 1 }) + ' L' : v >= 10 ? Math.round(v) + ' mL' : v.toLocaleString('tr', { maximumFractionDigits: 1 }) + ' mL';
}
export function waterCompare(ml) {
  const v = Math.max(0, +ml || 0);
  if (v < 1) return 'birkaç damla';
  if (v < 200) return `≈ ${Math.max(1, Math.round(v / 20))} yemek kaşığı`;
  if (v < 1500) return `≈ ${(v / 200).toLocaleString('tr', { maximumFractionDigits: 1 })} su bardağı`;
  if (v < 60000) return `≈ ${(v / 500).toLocaleString('tr', { maximumFractionDigits: 0 })} pet şişe (0,5 L)`;
  return `≈ ${(v / 80000).toLocaleString('tr', { maximumFractionDigits: 1 })} duş (8 dk)`;
}
