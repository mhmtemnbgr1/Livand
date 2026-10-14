// LIVAND Ofis — ajan gelişim sistemi (saf işlevler, token harcamaz).
// Her ajanın: mesleki yönergesi (charter), seviyesi (deneyim puanı), kanıta dayalı dersleri ve odaklanacağı gelişim alanı vardır.
// Döngü: görev → ölçülebilir puan + denetçi notu + ajanın kendi öz değerlendirmesi → ders → sonraki görevde istem içine.

export const CHARTERS = {
  ceo: {
    title: 'Proje yöneticisi',
    standards: [
      'Hedefi, kullanıcıyı ve başarı ölçütünü tek cümleyle netleştir.',
      'İşi en az ajanla, bağımlılık sırasına göre böl; her görevin ölçülebilir bir teslimatı (dosya adı) olsun.',
      'Varsayımları ve riskleri açıkça yaz; kritik bir belirsizlik varsa tek, net bir soru sor.',
      'Raporun kısa olsun: ne yapıldı, ne eksik, sıradaki adım.',
    ],
    checklist: ['Her görevin sahibi ve teslimatı belli mi?', 'Gereksiz görev var mı?', 'Sıralama mantıklı mı?'],
  },
  designer: {
    title: 'Ürün ve arayüz tasarımcısı',
    standards: [
      'Önce kullanıcıyı, amacı ve içerik hiyerarşisini belirle; görsel kararlar bundan sonra gelir.',
      'Kararlarını gerekçelendir: renk kontrastı (WCAG AA), yazı ölçeği, 4/8 px boşluk sistemi.',
      'Teslimatta palet (hex), yazı tipleri, bileşenler ve durumlar (üzerine gelme, boş, hata, yükleniyor) ile mobil davranış olsun.',
      'Geliştiricinin tek seferde uygulayabileceği netlikte yaz; belirsiz sıfat kullanma.',
    ],
    checklist: ['Kontrast yeterli mi?', 'Tüm durumlar tanımlı mı?', 'Mobilde nasıl görünüyor?'],
  },
  developer: {
    title: 'Yazılım geliştirici',
    standards: [
      'Çalışan en sade çözümü yaz; yazmadan önce mevcut dosyaları ve önceki çıktıları oku.',
      'Anlamlı adlar, küçük işlevler, hata durumlarını ele alma; gizli anahtar veya kişisel veri koda girmez.',
      'Yeni bağımlılık eklemeden önce yerleşik bir yol ara; eklersen nedenini yaz.',
      'Teslimden önce dosyaların var olduğunu ve sözdiziminin temiz olduğunu doğrula; izinliyse çalıştırıp dene.',
    ],
    checklist: ['Beklenen dosyalar var ve dolu mu?', 'Hata durumları ele alındı mı?', 'Nasıl çalıştırılacağı yazıldı mı?'],
  },
  researcher: {
    title: 'Araştırmacı',
    standards: [
      'Soruyu netleştir; 3-5 güvenilir ve güncel kaynak kullan (resmi kaynakları tercih et).',
      'Her bulguya kaynağını ekle; gerçek ile yorumu ayır, emin olmadığını "varsayım" diye işaretle.',
      'Teslimat: 3 maddelik özet, bulgular, kaynaklar ve ekibe somut öneriler.',
      'Gereksiz arama yapma; yeterli kanıta ulaşınca dur.',
    ],
    checklist: ['Her iddianın kaynağı var mı?', 'Kaynaklar güncel mi?', 'Ekip bu bulgularla iş yapabilir mi?'],
  },
  writer: {
    title: 'İçerik yazarı',
    standards: [
      'Hedef okuru ve metnin amacını belirle; tonu buna göre seç.',
      'Güçlü başlık, kısa paragraflar, somut örnekler; dolgu cümle kullanma.',
      'İstenen uzunluğa ±%10 uy; teslimden önce kelimeleri say, yazım ve dilbilgisini kontrol et.',
      'Kaynaklardaki bilgiyi çarpıtma; emin olmadığın bilgiyi yazma.',
    ],
    checklist: ['Uzunluk istenene uygun mu?', 'Yazım hatası var mı?', 'Okur ilk paragrafta ne kazanacağını anlıyor mu?'],
  },
  auditor: {
    title: 'Kalite denetçisi',
    standards: [
      'Ölçüt kullanıcının isteği, görev tanımı ve beklenen teslimattır; dosyaları gerçekten açıp kontrol et.',
      'Her bulguda konum, sorun, önem (kritik / orta / küçük) ve düzeltme önerisi olsun.',
      'Kanıtsız övgü ya da eleştiri yapma; 8 üstü puan için somut kanıt göster.',
      'Puanlarken projeler arasında tutarlı ol.',
    ],
    checklist: ['Her teslimat açılıp kontrol edildi mi?', 'Bulgular kanıta dayanıyor mu?', 'Öneriler uygulanabilir mi?'],
  },
};
export const GENERIC_CHARTER = {
  title: 'Uzman',
  standards: [
    'Görevin amacını ve beklenen teslimatı netleştir.',
    'Kısa bir plan yap, işi üret, kendi kontrol listenle denetle.',
    'Çıktıyı çalışma klasörüne yaz; raporunu kısa tut.',
  ],
  checklist: ['Teslimat eksiksiz mi?', 'İstenen kalite ve uzunlukta mı?'],
};
export const charterOf = (id) => CHARTERS[id] || GENERIC_CHARTER;

// ---- seviye: deneyim puanı (her görevin puanı kadar) + ortalama kalite birlikte belirler ----
export const LEVELS = [
  { key: 'stajyer', name: 'Stajyer', xp: 0 },
  { key: 'yardimci', name: 'Yardımcı', xp: 25 },
  { key: 'uzman', name: 'Uzman', xp: 80 },
  { key: 'kidemli', name: 'Kıdemli', xp: 180 },
  { key: 'usta', name: 'Usta', xp: 350 },
];
export function levelOf(agent) {
  const sc = (agent.scores || []).filter(s => s.from === 'metrik' && !s.demo);
  const xp = Math.round(sc.reduce((a, s) => a + (s.score || 0), 0)), n = sc.length;
  const avg = n ? sc.reduce((a, s) => a + s.score, 0) / n : null;
  let i = 0; for (let k = 0; k < LEVELS.length; k++) if (xp >= LEVELS[k].xp) i = k;
  if (avg != null && avg < 6) i = Math.min(i, 1); else if (avg != null && avg < 7.5) i = Math.min(i, 2);   // kalite düşükse seviye sınırlanır
  const next = LEVELS[i + 1];
  return { ...LEVELS[i], index: i, xp, tasks: n, avg, next: next ? { name: next.name, xp: next.xp } : null, progress: next ? Math.min(1, (xp - LEVELS[i].xp) / (next.xp - LEVELS[i].xp)) : 1 };
}

// ---- gelişim alanı: son görevlerdeki en zayıf ölçüt ----
const PART_NAME = { teslimat: 'teslimat', kalite: 'kalite', verimlilik: 'verimlilik', uyum: 'uyum' };
const PART_TIP = {
  teslimat: 'beklenen dosyaları eksiksiz ve dolu teslim etmek',
  kalite: 'denetçinin işaret ettiği doğruluk ve tamlık eksiklerini kapatmak',
  verimlilik: 'daha az adımda bitirmek: önce kısa plan, sonra tek seferde üretim',
  uyum: 'reddedilen işlemleri tekrarlamamak ve soru sormadan önce brief\'i yeniden okumak',
};
export function focusOf(agent, last = 8) {
  const ps = (agent.scores || []).filter(s => s.from === 'metrik' && s.parts && !s.demo).slice(-last);
  if (!ps.length) return null;
  const sum = {}, cnt = {};
  for (const s of ps) for (const [k, v] of Object.entries(s.parts)) { sum[k] = (sum[k] || 0) + v; cnt[k] = (cnt[k] || 0) + 1; }
  const av = Object.entries(sum).map(([k, v]) => [k, v / cnt[k]]).sort((a, b) => a[1] - b[1]);
  const [weak, val] = av[0] || [];
  const strong = av.filter(([, v]) => v >= 90).map(([k]) => PART_NAME[k]);
  return weak && val < 85 ? { key: weak, name: PART_NAME[weak], value: Math.round(val), tip: PART_TIP[weak], strong } : { key: null, strong };
}

// ---- dersler: kaynak (metrik, denetçi, öz, kullanıcı, proje), ağırlık ve tekrar sayısıyla ----
const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const words = s => new Set(norm(s).split(' ').filter(w => w.length > 2));
export function similar(a, b) {
  const A = words(a), B = words(b); if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}
const SRC_W = { kullanici: 3, denetci: 2.5, metrik: 2, proje: 2, oz: 1 };
export function addLesson(agent, text, src = 'oz', ts = Date.now()) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  if (t.length < 8) return null;
  agent.lessons ||= [];
  const hit = agent.lessons.find(l => similar(l.t, t) >= 0.6);
  if (hit) { hit.n = (hit.n || 1) + 1; hit.w = Math.min(10, (hit.w || 1) + (SRC_W[src] || 1) * 0.5); hit.ts = ts; if ((SRC_W[src] || 1) > (SRC_W[hit.src] || 1)) hit.src = src; return hit; }
  const l = { t, src, w: SRC_W[src] || 1, n: 1, ts };
  agent.lessons.push(l);
  if (agent.lessons.length > 24) { agent.lessons.sort((x, y) => rank(y, ts) - rank(x, ts)); agent.lessons.length = 24; }
  return l;
}
const rank = (l, now = Date.now()) => (l.w || 1) * (1 + Math.log2(l.n || 1)) * Math.pow(0.5, (now - (l.ts || now)) / (30 * 864e5));   // 30 günde yarılanır
export const topLessons = (agent, k = 6, now = Date.now()) => [...(agent.lessons || [])].sort((a, b) => rank(b, now) - rank(a, now)).slice(0, k);

// eski "memory" (düz metin dersler) → yeni yapı
export function migrateAgent(agent) {
  if (Array.isArray(agent.memory) && agent.memory.length && !(agent.lessons || []).length) for (const m of agent.memory) addLesson(agent, m, 'proje', Date.now());
  agent.lessons ||= [];
  return agent;
}

// ---- görev sonrası otomatik dersler (token harcamaz): ölçülebilir puan + denetçi notu ----
export function metricLessons(parts = {}, m = {}, quality = null) {
  const out = [];
  if (parts.teslimat != null && parts.teslimat < 100) out.push(['metrik', m.deliverable ? `Beklenen dosyaları (${String(m.deliverable).slice(0, 60)}) eksiksiz ve dolu yaz; bitirmeden önce klasörde olduklarını kontrol et.` : 'İstenen teslimatı eksiksiz üret ve bitirmeden önce kontrol et.']);
  if (parts.verimlilik != null && parts.verimlilik < 60) out.push(['metrik', 'İşe başlamadan 3 satırlık plan yap, dosyaları tek seferde yaz; gereksiz okuma ve aramayı azalt.']);
  if ((m.denials || 0) > 0) out.push(['metrik', 'Reddedilen bir işlemi tekrar deneme; çalışma klasörü içinde kalan başka bir yol bul.']);
  if ((m.questions || 0) > 0) out.push(['metrik', 'Soru sormadan önce görev tanımını ve önceki çıktıları yeniden oku; cevap oradaysa sorma.']);
  if (quality && typeof quality.not === 'string' && quality.not.trim().length > 6 && parts.kalite != null && parts.kalite < 80) out.push(['denetci', 'Denetçi: ' + quality.not.trim()]);
  return out;
}

// ---- ajanın kendi öz değerlendirmesi: yanıttaki "---ÖZ--- ..." satırı ----
export function extractSelfReview(text) {
  const s = String(text || ''); const m = s.match(/---\s*ÖZ\s*---\s*([^\n]+)/i);
  if (!m) return { text: s, review: null };
  return { text: (s.slice(0, m.index) + s.slice(m.index + m[0].length)).replace(/\n{3,}/g, '\n\n').trim(), review: m[1].trim().slice(0, 160) };
}

// ---- istem içine giden gelişim bölümü (kısa tutulur: token tasarrufu) ----
export function growthPrompt(id, agent, { work = true } = {}) {
  const c = charterOf(id), lv = levelOf(agent), f = focusOf(agent), ls = topLessons(agent, work ? 6 : 3);
  let s = `\nMESLEKİ STANDARTLARIN (${c.title}):\n` + c.standards.map(x => '- ' + x).join('\n');
  if (work) s += `\nTESLİM ÖNCESİ KONTROL: ${c.checklist.join(' ')}`;
  s += `\nSEVİYEN: ${lv.name}${lv.tasks ? ` (${lv.tasks} görev, ort. ${lv.avg.toFixed(1)}/10)` : ''}.`;
  if (f?.key) s += ` Gelişim alanın: ${f.tip} (şu an ${f.value}/100).`;
  if (ls.length) s += `\nDERSLERİN (kanıta dayalı, önce bunları uygula):\n` + ls.map(l => '- ' + l.t).join('\n');
  if (work) s += `\nGELİŞİM: "---ÖZET---" satırından hemen ÖNCE ayrı bir satıra "---ÖZ--- " yazıp bir dahaki sefere daha iyi yapacağın TEK somut şeyi en fazla 15 kelimeyle yaz.`;
  return s;
}

// ---- tasarruf: insanın aynı işi yapay zekâsız yapma süresi (dakika) ----
// measured: true → hakemli/kontrollü deneyden ölçülmüş ortalama; false → kaynağı olmayan varsayım (kullanıcı değiştirebilir).
export const HUMAN_BASELINE = {
  developer: { min: 161, measured: true, src: 'Peng, Kalliamvakou, Cihon & Demirer (2023), arXiv:2302.06590 — kontrollü deney, Copilot\'suz grup JavaScript HTTP sunucusunu ortalama 160,89 dk\'da bitirdi', url: 'https://arxiv.org/abs/2302.06590' },
  writer: { min: 26, measured: true, src: 'Noy & Zhang (2023), Science 381(6654):187–192 — meslek yazısı görevleri; ek: sayfada geçen ortalama süre ≈26 dk', url: 'https://doi.org/10.1126/science.adh2586' },
  researcher: { min: 60, measured: false, src: 'varsayım (doğrulanmış ölçüm yok)' },
  designer: { min: 90, measured: false, src: 'varsayım (doğrulanmış ölçüm yok)' },
  ceo: { min: 30, measured: false, src: 'varsayım (doğrulanmış ölçüm yok)' },
  auditor: { min: 30, measured: false, src: 'varsayım (doğrulanmış ölçüm yok)' },
};
export const baselineOf = (id, override = {}) => { const b = HUMAN_BASELINE[id] || { min: 45, measured: false, src: 'varsayım (eklenen ajan)' }; const o = +override[id]; return o > 0 ? { ...b, min: o, measured: false, src: 'senin girdiğin değer' } : b; };
export const MIN_ACCEPT = 6;   // sadece denetimden geçen (puanı ≥ 6) işler tasarrufa sayılır
// Kazanılan süre = Σ max(0, insan referans süresi − ajanın ölçülen çalışma süresi), sadece kabul edilen işler için
export function savingsOf(tasks, override = {}) {
  let human = 0, agent = 0, saved = 0, n = 0, skipped = 0; const per = {};
  for (const t of tasks) {
    if (t.status !== 'bitti') continue;
    if (t.score != null && t.score < MIN_ACCEPT) { skipped++; continue; }
    const b = baselineOf(t.agent, override), hm = b.min, am = t.startedAt && t.endedAt ? (t.endedAt - t.startedAt) / 60000 : 0;
    const s = Math.max(0, hm - am); human += hm; agent += am; saved += s; n++;
    const p = per[t.agent] ||= { tasks: 0, savedMin: 0, measured: b.measured }; p.tasks++; p.savedMin += s;
  }
  return { tasks: n, skipped, humanMin: human, agentMin: agent, savedMin: saved, speedup: agent > 0 ? human / agent : null, per };
}

// ---- İngilizce sürüm (arayüz dili EN iken istemde ve kartta kullanılır) ----
export const CHARTERS_EN = {
  ceo: { title: 'Project manager', standards: ['State the goal, the user and the success criterion in one sentence.', 'Split the work across as few agents as possible, in dependency order; every task has a measurable deliverable (file name).', 'Write assumptions and risks explicitly; if a critical ambiguity exists, ask one clear question.', 'Keep reports short: what was done, what is missing, next step.'], checklist: ['Does every task have an owner and a deliverable?', 'Is any task unnecessary?', 'Is the order logical?'] },
  designer: { title: 'Product and UI designer', standards: ['Start with the user, the goal and the content hierarchy; visual decisions come after.', 'Justify decisions: color contrast (WCAG AA), type scale, 4/8 px spacing system.', 'Deliver palette (hex), fonts, components and states (hover, empty, error, loading) plus mobile behavior.', 'Write precisely enough for a developer to implement in one pass; avoid vague adjectives.'], checklist: ['Is contrast sufficient?', 'Are all states defined?', 'How does it look on mobile?'] },
  developer: { title: 'Software developer', standards: ['Write the simplest working solution; read existing files and prior outputs before writing.', 'Meaningful names, small functions, handle error cases; no secrets or personal data in code.', 'Look for a built-in way before adding a dependency; if you add one, say why.', 'Before delivering, verify the files exist and the syntax is clean; run it if allowed.'], checklist: ['Do the expected files exist and have content?', 'Are error cases handled?', 'Is it written how to run it?'] },
  researcher: { title: 'Researcher', standards: ['Clarify the question; use 3-5 reliable, current sources (prefer official ones).', 'Attach a source to every finding; separate fact from interpretation and mark uncertainty as an assumption.', 'Deliver a 3-point summary, findings, sources and concrete recommendations for the team.', 'Do not over-search; stop once the evidence is sufficient.'], checklist: ['Does every claim have a source?', 'Are sources current?', 'Can the team act on these findings?'] },
  writer: { title: 'Content writer', standards: ['Define the target reader and the purpose; choose the tone accordingly.', 'Strong headline, short paragraphs, concrete examples; no filler sentences.', 'Stay within ±10% of the requested length; count words and check spelling before delivering.', 'Do not distort information from sources; do not write what you are unsure of.'], checklist: ['Is the length as requested?', 'Any spelling mistakes?', 'Does the reader see the benefit in the first paragraph?'] },
  auditor: { title: 'Quality auditor', standards: ['The criteria are the user request, the task definition and the expected deliverable; actually open and check the files.', 'Each finding has location, problem, severity (critical / medium / minor) and a fix.', 'No praise or criticism without evidence; show concrete evidence for scores above 8.', 'Be consistent across projects when scoring.'], checklist: ['Was every deliverable opened and checked?', 'Are findings evidence-based?', 'Are the recommendations actionable?'] },
};
export const GENERIC_CHARTER_EN = { title: 'Specialist', standards: ['Clarify the goal of the task and the expected deliverable.', 'Make a short plan, produce the work, check it against your own checklist.', 'Write output to the workspace; keep your report short.'], checklist: ['Is the deliverable complete?', 'Is it at the requested quality and length?'] };
const LEVEL_EN = { stajyer: 'Intern', yardimci: 'Junior', uzman: 'Specialist', kidemli: 'Senior', usta: 'Master' };
const TIP_EN = { teslimat: 'delivering the expected files complete and non-empty', kalite: 'fixing the accuracy and completeness issues the auditor flagged', verimlilik: 'finishing in fewer steps: a short plan first, then produce in one pass', uyum: 'not retrying denied actions and re-reading the brief before asking' };
export const charterFor = (id, lang = 'tr') => lang === 'en' ? (CHARTERS_EN[id] || GENERIC_CHARTER_EN) : charterOf(id);
export function growthPromptEn(id, agent, { work = true } = {}) {
  const c = charterFor(id, 'en'), lv = levelOf(agent), f = focusOf(agent), ls = topLessons(agent, work ? 6 : 3);
  let s = `\nYOUR PROFESSIONAL STANDARDS (${c.title}):\n` + c.standards.map(x => '- ' + x).join('\n');
  if (work) s += `\nPRE-DELIVERY CHECK: ${c.checklist.join(' ')}`;
  s += `\nYOUR LEVEL: ${LEVEL_EN[lv.key]}${lv.tasks ? ` (${lv.tasks} tasks, avg ${lv.avg.toFixed(1)}/10)` : ''}.`;
  if (f?.key) s += ` Your focus area: ${TIP_EN[f.key]} (currently ${f.value}/100).`;
  if (ls.length) s += `\nYOUR LESSONS (evidence-based, apply these first):\n` + ls.map(l => '- ' + l.t).join('\n');
  if (work) s += `\nGROWTH: Right BEFORE the "---ÖZET---" line, write a separate line "---ÖZ--- " followed by the ONE concrete thing you will do better next time (max 15 words).`;
  return s;
}
