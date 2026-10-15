// LIVAND Ofis — ofisin yetenekleri ve proje türü rehberleri (saf işlevler, token harcamaz).
// CEO planlarken hangi yeteneğin var olduğunu bilir ve görevlere atar ("yetenekler"); atanan yeteneğin nasıl kullanılacağı
// o görevin istemine girer ve gerekiyorsa göreve ek araç (Bash gibi) açılır. Rehber, proje türüne göre önerilen iş akışını verir.

// how(ctx): ctx.tool = asset aracının tam yolu
export const CAPABILITIES = [
  { id: 'asset-hatti', name: 'Görsel/asset hattı', roles: ['designer', 'developer'], tools: ['Bash'],
    desc: 'Piksel sanatı PNG\'ye çevirir, görsellerin arka planını kaldırır, kırpar, sprite sheet\'i assetlere böler, atlas oluşturur (yalnızca PNG).',
    when: ['oyun', 'game', 'sprite', 'karakter', 'asset', 'piksel', 'pixel', 'arka plan', 'arkaplan', 'atlas', 'animasyon', 'düşman', 'karo', 'tile'],
    how: ({ tool }) => [
      `Asset aracı: node "${tool}" <komut> ... (yollar çalışma klasörüne göre; bu komutlar onay beklemeden çalışır; komutları &&, | veya > ile ZİNCİRLEME, her birini ayrı çalıştır).`,
      'pixel <sanat.json> <out.png> --scale 4 → piksel sanatı. JSON: {"palette":{"k":"#1b1b1b","r":"#d9532a",".":"none"},"rows":["..kk..",".krrk."]}; animasyon için "frames":[[satırlar],[satırlar]] → yatay şerit (her kare aynı boyutta).',
      'nobg <in.png> <out.png> [--tol 32] [--color #rrggbb] → arka planı saydam yapar (kenardan dolgu; karakterin içindeki aynı renk korunur). Kullanıcının verdiği görsellerde önce "info" ile arka plan rengine bak.',
      'split <in.png> <klasör> --auto [--gap 2] ya da --grid 32x32 → sprite sheet\'i tek tek assetlere böler, manifest.json yazar.',
      'pack <klasör> <assets/atlas.png> → assetleri tek atlasa dizer, atlas.json (frames: ad → x,y,w,h) yazar. trim (boşluk kırp), scale --x N (bulanıklaşmadan büyüt), info (boyut/saydamlık).',
      'Kural: tüm oyun görselleri assets/ altında; isimler küçük harf-tire (oyuncu-kos.png); bir karakterin tüm kareleri aynı boyut ve hizada; üretimden sonra info ile boyutu doğrula.',
    ] },
  { id: 'svg-cizim', name: 'Vektör çizim (SVG)', roles: ['designer', 'developer'], tools: [],
    desc: 'Logo, ikon, illüstrasyon, karakter ve arka planı SVG dosyası olarak çizer; tarayıcıda ve oyunda (Canvas drawImage) doğrudan kullanılır.',
    when: ['logo', 'ikon', 'icon', 'illüstrasyon', 'görsel', 'oyun', 'karakter', 'arka plan', 'arkaplan', 'banner', 'svg', 'harita'],
    how: () => [
      'SVG dosyası yaz: viewBox kullan, sabit width/height verme; renkleri tasarım tokenlarından al; metni yola çevirme gereği yoksa <text> kullan.',
      'Oyun arka planları için katmanlı çiz (gökyüzü, uzak, yakın) ve her katmanı ayrı SVG yap ki paralaks yapılabilsin.',
      'Karmaşık gradyan/filtre yerine düz renk ve az düğüm: dosya küçük, çizim hızlı kalsın.',
    ] },
  { id: 'calistir-dogrula', name: 'Çalıştırıp doğrulama', roles: ['developer'], tools: ['Bash'],
    desc: 'Kodu çalıştırır, sözdizimini ve testleri komutla doğrular.',
    when: ['uygulama', 'api', 'sunucu', 'node', 'python', 'script', 'bot', 'hesap', 'test', 'oyun'],
    how: () => ['Teslimden önce sözdizimini doğrula (node --check dosya.js / python -m py_compile dosya.py) ve varsa testleri çalıştır; çıktıyı özetinde belirt.'] },
];

// proje türü rehberleri: CEO'nun istemine "önerilen akış" olarak girer
export const PLAYBOOKS = [
  { id: 'oyun', name: 'Oyun', when: ['oyun', 'game', 'platform', 'arcade', 'bulmaca', 'puzzle', 'yılan', 'snake', 'tetris', 'shooter', 'rpg', 'koşu', 'zıpla', 'uzay', 'labirent'],
    flow: [
      'Oyun tasarım belgesi (designer): tür, temel döngü, kontroller (klavye + dokunmatik), kazanma/kaybetme, zorluk, ekranlar ve ASSET LİSTESİ (her asset: ad, boyut, kare sayısı, dosya yolu) → oyun-tasarimi.md. Ayrıca atlas sözleşmesi: assets/atlas.json içindeki kare adları.',
      'Assetler (designer; yetenekler: asset-hatti, svg-cizim): listedeki karakter/düşman/nesne/karo görsellerini piksel sanatı ya da SVG olarak üret; animasyonlar kare şeridi; kullanıcının verdiği görseller varsa arka planını kaldırıp böl; sonunda assets/atlas.png + atlas.json.',
      'Oyun kodu (developer; yetenek: calistir-dogrula): index.html + game.js (Canvas 2D, harici kütüphane yok), sabit zaman adımlı döngü, girdi, çarpışma, skor, oyun sonu ve yeniden başlat; görselleri atlas.json sözleşmesiyle yükle, asset henüz yoksa renkli dikdörtgenle çalışsın.',
      'Metinler (writer, gerekiyorsa): başlık ekranı, nasıl oynanır, oyun sonu mesajları → metinler.json.',
      'Denetim (auditor): kodu okuyarak oynanabilirliği denetle — döngü, kontroller, çarpışma, kazanma/kaybetme, asset yolları ve atlas adları tutarlı mı.',
    ],
    parallel: 'Tasarım belgesi bitince assetler ile oyun kodu PARALEL yürür (ikisi de atlas sözleşmesine göre çalışır); metinler de paralel yürüyebilir.' },
  { id: 'web-sitesi', name: 'Web sitesi', when: ['site', 'web sitesi', 'websitesi', 'web sayfası', 'landing', 'ana sayfa', 'kurumsal', 'portfolyo', 'dükkan', 'mağaza'],
    flow: [
      'Araştırma (researcher): hedef kitle, rakip/benzer örnekler, yerel işletmeyse yerel görünürlük → arastirma.md.',
      'İçerik (writer): sayfa metinleri, başlıklar, eylem çağrıları, SEO meta → icerik.md.',
      'Tasarım (designer; gerekirse svg-cizim): tasarım sistemi, sayfa yapısı, logo/ikonlar → tasarim.md + assets/.',
      'Kod (developer): semantik, duyarlı, erişilebilir site; içerik ve tasarım dosyalarını uygular.',
      'Denetim (auditor): bağlantılar, mobil, erişilebilirlik, içerik tutarlılığı.',
    ],
    parallel: 'Araştırma ile tasarım iskeleti paralel başlayabilir; içerik araştırmayı, kod içerik ve tasarımı bekler.' },
  { id: 'uygulama', name: 'Web uygulaması / araç', when: ['uygulama', 'app', 'araç', 'panel', 'hesaplayıcı', 'takip', 'yönetim', 'todo', 'yapılacak', 'api', 'bot'],
    flow: [
      'Kapsam ve akış (designer): kullanıcı akışı, ekranlar, veri modeli (hangi veri nerede tutulur) → akis.md.',
      'Kod (developer; yetenek: calistir-dogrula): veri katmanı + arayüz; kalıcılık gerekiyorsa localStorage/JSON; hata ve boş durumlar.',
      'Metinler (writer, gerekiyorsa): arayüz metinleri, hata mesajları, kısa kullanım kılavuzu.',
      'Denetim (auditor): kod incelemesi, kenar durumlar, güvenlik.',
    ],
    parallel: 'Arayüz metinleri akışla paralel yazılabilir.' },
];

const low = s => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i');
const hits = (when, t) => when.filter(w => t.includes(low(w))).length;
export const capById = id => CAPABILITIES.find(c => c.id === id);
export function playbookFor(text) {
  const t = low(text); let best = null;
  for (const p of PLAYBOOKS) { const h = hits(p.when, t); if (h && (!best || h > best.h)) best = { p, h }; }
  return best?.p || null;
}

// CEO istemi: yetenek kataloğu + eşleşen proje türü rehberi
export function catalogPrompt(text, roster = []) {
  const caps = CAPABILITIES.filter(c => c.roles.some(r => roster.includes(r)));
  let s = '\nOFİSİN YETENEKLERİ (görevlere "yetenekler" alanıyla ata; yalnızca listedeki rollere):\n' + caps.map(c => `- ${c.id} — ${c.name}: ${c.desc} [${c.roles.join(', ')}]`).join('\n');
  s += '\nNot: Ofis fotoğraf gerçekliğinde resim ÜRETEMEZ; görseller piksel sanat (asset-hatti) ya da SVG çizim (svg-cizim) ile üretilir, kullanıcının verdiği PNG\'ler işlenebilir.';
  const pb = playbookFor(text);
  if (pb) s += `\nPROJE TÜRÜ: ${pb.name} — önerilen akış (projeye göre uyarla, gereksizini çıkar):\n` + pb.flow.map((x, i) => `${i + 1}. ${x}`).join('\n') + `\nParalellik: ${pb.parallel}`;
  return s;
}

// görev için geçerli yetenekler: CEO'nun atadıkları (karar onundur). auto=true ise (şablon ya da hiç yetenek atamayan plan)
// rehber eşleşmesi + görev metni + rol uyumuna göre tamamlanır
export function capsForTask(t, agentKey, brief = '', { auto = true } = {}) {
  const role = agentKey;
  const given = (Array.isArray(t.yetenekler) ? t.yetenekler : Array.isArray(t.caps) ? t.caps : []).map(capById).filter(c => c && c.roles.includes(role));
  if (given.length || !auto) return given.map(c => c.id);
  const txt = low(`${t.instruction} ${t.deliverable || ''}`), pb = playbookFor(brief);
  return pb ? CAPABILITIES.filter(c => c.roles.includes(role) && hits(c.when, txt) > 0 && (c.id !== 'calistir-dogrula' || role === 'developer')).map(c => c.id) : [];
}

export function capabilityPrompt(ids, ctx) {
  const cs = ids.map(capById).filter(Boolean);
  return cs.length ? '\nYETENEKLERİN (CEO bu görev için verdi; gerektiği yerde kullan):\n' + cs.map(c => `## ${c.name}\n` + c.how(ctx).map(x => '- ' + x).join('\n')).join('\n') : '';
}
export const capTools = ids => [...new Set(ids.map(capById).filter(Boolean).flatMap(c => c.tools))];
