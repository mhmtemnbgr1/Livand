// LIVAND Ofis — estetik yönlendirme (saf işlevler, token harcamaz).
// Sorun (Anthropic, "Improving frontend design through skills"): yönlendirilmeyen model eğitim verisindeki en yaygın,
// en "güvenli" tasarıma yakınsar (Inter, mor gradyan, birbirinin aynısı kartlar). Çözüm: açık estetik kurallar,
// açık yasaklar listesi (impeccable) ve sektöre göre hazır yönler (ui-ux-pro-max). Bu modül üçünü de sağlar.

// yapımcıya ve tasarımcıya giden estetik kurallar (kısa; her ürün görevinde istemde)
export const AESTHETIC_RULES = [
  'Görsel kararları konunun KENDİ dünyasından türet (malzemesi, mekânı, aletleri, dili); önce bu dünyayı 3 somut imgeyle düşün, sonra palet ve tipografiyi buna bağla.',
  'İşe özel bir font çifti seç (Google Fonts): karakterli bir başlık fontu + okunaklı bir gövde fontu. Başlık tipografisini tasarımın ana öğesi olarak kullan (ölçek, ağırlık, harf aralığı).',
  'Palet 4-6 adlandırılmış renk: baskın renk + keskin vurgu; nötrleri markaya doğru hafif renklendir. Renkleri CSS değişkeni yap.',
  'Arka plana atmosfer kat: doku, katmanlı renk alanı, desen, konuya uygun SVG süs; düz beyaz zeminde ortalanmış bloklar dizme.',
  'Yerleşimde bir fikir olsun: asimetri, bölümler arası ritim, beklenmedik ölçek farkı; her bölüm aynı "başlık + 3 kart" kalıbında olmasın.',
  'Hareket az ve anlamlı: sayfa açılışında tek bir düzenlenmiş an, kullanıcı eylemine yanıt veren geçişler; her bölüme fade-in koyma.',
  'İlk ekran (hero) konunun en karakteristik öğesiyle açılsın; ziyaretçi 3 saniyede ne olduğunu ve neden farklı olduğunu anlasın.',
  'Bitirmeden önce ekran görüntüsüne bak ve sor: "Bu, herhangi bir yapay zekâ sitesine benziyor mu?" Benziyorsa en jenerik öğeyi değiştir; sonra bir süs öğesini çıkar.',
];

// açık yasaklar: yapay zekâ çıktısını ele veren kalıplar (impeccable, anthropics/skills frontend-design)
export const ANTI_PATTERNS = [
  'Inter, Roboto, Arial, Open Sans ya da yalnızca system-ui ile yazılmış sayfa',
  'mor/indigo/menekşe gradyanlar, gradyanlı metin (background-clip:text)',
  'krem zemin + terracotta; koyu lacivert/siyah zemin + tek neon vurgu',
  'aynı köşe yarıçapı ve aynı yumuşak gölgeli birbirinin aynısı kart ızgarası, kart içinde kart',
  'başlıkta tek kelimeyi renk/italik/gradyanla vurgulamak (<em>/<span> ile); başlıkların üstünde BÜYÜK HARFLİ küçük etiketler (eyebrow)',
  'büyük sayı + küçük etiket istatistik şeridi (gerçek veri yoksa), her bölümde fade-in/slide-up, her kartta hover zıplaması',
  'emoji ya da jenerik ikonları özellik simgesi olarak kullanmak',
];

// her tıklanabilir öğe gerçek işini yapsın: ziyaretçinin "düğmeler çalışmıyor" dediği durumlar (checks.mjs → usabilitySmells bunları kodla da arar)
export const USABILITY_RULES = [
  'Her düğme ve bağlantı tıklanınca gerçek işini yapsın: "Yol tarifi" doğrudan haritayı açar (https://www.google.com/maps/dir/?api=1&destination=<tam adres>), "Ara" tel:, "WhatsApp" wa.me, sosyal medya adı profil bağlantısıdır; href="#" ya da işlevsiz <button> bırakma.',
  'Harita bağlantısında sayfadaki TAM adres (sokak + numara + semt) olsun; yalnızca semt adı ziyaretçiyi yanlış yere götürür.',
  'Uzun tek sayfada menü yapışkan olsun (position:sticky; top:0) ve bölüm hedeflerine scroll-margin-top ver; mobil menü bağlantıya basınca kapansın.',
  'Gerçek bilgi (telefon, hesap adı, fiyat) yoksa sahte değer (+905XXXXXXXXX) ya da ziyaretçiye görünen "yer tutucu" notu yazma; öğeyi çıkar ve eksik bilgiyi raporunda belirt.',
];
export const usabilityPrompt = () => '\nKULLANILABİLİRLİK (teslimden önce ekran görüntüsünde her düğmeyi düşün: "tıklayınca ne olur?"):\n' + USABILITY_RULES.map(x => '- ' + x).join('\n');

export function aestheticPrompt({ withAnti = true } = {}) {
  return '\nESTETİK YÖN (sıradan "yapay zekâ sitesi" görünümü bu işte BAŞARISIZLIKTIR):\n' + AESTHETIC_RULES.map(x => '- ' + x).join('\n') +
    (withAnti ? '\nYAPMA (yapay zekâ çıktısını ele veren kalıplar; vizyon özellikle istemedikçe):\n' + ANTI_PATTERNS.map(x => '- ' + x).join('\n') : '');
}

// sektöre göre hazır yönler: ekip lideri "tarz"ı bunlardan biriyle (ya da daha iyisiyle) somutlaştırır
// when: brief'te geçince eşleşen kelimeler (küçük harf, kısmi eşleşme)
export const DESIGN_PRESETS = [
  { id: 'kafe', name: 'Kafe, fırın, restoran', when: ['kafe', 'cafe', 'kahve', 'fırın', 'pastane', 'restoran', 'lokanta', 'yemek', 'menü', 'bistro', 'tatlı'],
    yonler: [
      { ad: 'Sıcak zanaat', palet: 'kavrulmuş kahve #3b2418, krema #f3e9dc, karamel #c8813a, zeytin #6b7044', font: 'Fraunces (başlık) + Work Sans (gövde)', yerlesim: 'büyük ürün fotoğrafları, el yazısı notlar, menü bir tahta/kâğıt menü gibi', kacin: 'kurumsal mavi, steril beyaz kartlar' },
      { ad: 'Mahalle tabelası', palet: 'domates kırmızısı #d6452b, kâğıt #fbf6ee, mürekkep #1d1d1b, hardal #e3b23c', font: 'Archivo Black (başlık) + IBM Plex Sans (gövde)', yerlesim: 'kalın tabela tipografisi, fiyatlar büyük, çizgili ayraçlar, harita ve saatler ön planda', kacin: 'gradyan, cam efekti' },
    ] },
  { id: 'perakende', name: 'Dükkan, mağaza, kırtasiye', when: ['dükkan', 'mağaza', 'kırtasiye', 'butik', 'market', 'ürün', 'satış', 'e-ticaret', 'shop', 'kitapçı', 'çiçekçi'],
    yonler: [
      { ad: 'Defter ve mürekkep', palet: 'mürekkep mavisi #1f3a68, kâğıt #faf7f0, kırmızı kalem #c8312c, kurşun #4a4a48', font: 'Recoleta (başlık) + Nunito Sans (gövde)', yerlesim: 'kareli/çizgili kâğıt dokusu, ürünler raf gibi dizilir, el çizimi SVG süsler', kacin: 'jenerik ikon ızgarası' },
      { ad: 'Vitrin', palet: 'canlı vitrin rengi (sektöre göre tek doygun renk) + kırık beyaz + koyu antrasit', font: 'Space Grotesk (başlık) + Manrope (gövde)', yerlesim: 'büyük ürün görselleri, asimetrik vitrin ızgarası, fiyat ve "yol tarifi" düğmesi belirgin', kacin: 'aynı kartların tekrarı' },
    ] },
  { id: 'saglik', name: 'Sağlık, klinik, eczane, terapi', when: ['sağlık', 'klinik', 'doktor', 'diş', 'eczane', 'terapi', 'psikolog', 'hastane', 'fizyoterapi', 'diyet'],
    yonler: [
      { ad: 'Sakin güven', palet: 'adaçayı #7c9a86, kemik #f4f1ea, derin petrol #1f4e5a, yumuşak kum #d9c7a7', font: 'Source Serif 4 (başlık) + Source Sans 3 (gövde)', yerlesim: 'geniş boşluk, insan fotoğrafları, randevu eylemi her ekranda, uzman kartları yerine kısa biyografiler', kacin: 'parlak neon, agresif kırmızı, stok "gülümseyen doktor"' },
      { ad: 'Klinik netlik', palet: 'beyaz #ffffff, cerrahi mavi #1d5fa8, açık gri #eef2f5, güven yeşili #2e8b57', font: 'IBM Plex Sans (başlık ve gövde, ağırlık farkıyla)', yerlesim: 'net bilgi hiyerarşisi, saatler/adres/telefon üstte, SSS akordeon', kacin: 'süs kalabalığı' },
    ] },
  { id: 'finans', name: 'Finans, hukuk, danışmanlık, kurumsal', when: ['finans', 'banka', 'muhasebe', 'hukuk', 'avukat', 'danışman', 'sigorta', 'yatırım', 'kurumsal', 'şirket', 'b2b'],
    yonler: [
      { ad: 'Editoryal ağırbaşlılık', palet: 'koyu orman #1e3329, fildişi #f6f3ea, pirinç #a8834a, grafit #2b2b2b', font: 'Libre Caslon Text (başlık) + Public Sans (gövde)', yerlesim: 'dergi gibi sütunlar, büyük alıntılar, ince çizgi ayraçlar, gerçek vaka/rakam', kacin: 'gradyan, startup illüstrasyonları' },
      { ad: 'Kesin ve modern', palet: 'mürekkep #0f1720, kağıt #f7f7f5, tek vurgu kobalt #2f5bea', font: 'Schibsted Grotesk (başlık) + Newsreader (uzun metin)', yerlesim: 'ızgaraya sıkı bağlı, tablo ve grafik birinci sınıf öğe', kacin: 'mor, cam efekti, emoji' },
    ] },
  { id: 'teknoloji', name: 'Yazılım, SaaS, uygulama, yapay zekâ', when: ['saas', 'yazılım', 'uygulama', 'app', 'platform', 'yapay zeka', 'yapay zekâ', 'api', 'startup', 'girişim', 'panel', 'dashboard'],
    yonler: [
      { ad: 'Ürün odaklı sadelik', palet: 'kırık beyaz #fafaf8, mürekkep #111316, tek imza rengi (mor DIŞI: ör. turuncu #ff5a1f ya da yeşil #00a36c)', font: 'Geist ya da Instrument Sans (başlık) + JetBrains Mono (kod/rakam)', yerlesim: 'ürünün gerçek ekranı hero\'da, özellikler ürün ekranı parçalarıyla anlatılır, kart ızgarası yerine dönüşümlü bölümler', kacin: 'mor gradyan, "AI parıltısı", yüzen 3B küreler' },
      { ad: 'Terminal estetiği', palet: 'grafit #16181d, fosfor #c6f36b, kâğıt #e8e6df, uyarı turuncusu #ff8a3d', font: 'Space Mono / IBM Plex Mono (başlık) + IBM Plex Sans (gövde)', yerlesim: 'komut satırı ve kod blokları süs değil içerik, ızgara çizgileri görünür', kacin: 'neon mor, cam efekti' },
    ] },
  { id: 'egitim', name: 'Eğitim, kurs, okul, çocuk', when: ['eğitim', 'kurs', 'okul', 'öğrenci', 'öğretmen', 'veli', 'çocuk', 'ders', 'akademi', 'kreş', 'anaokulu'],
    yonler: [
      { ad: 'Oyunlu öğrenme', palet: 'güneş sarısı #ffcc33, gökyüzü #4aa3df, domates #ef5b3f, kâğıt #fffaf0, koyu mürekkep #23202a', font: 'Baloo 2 (başlık) + Nunito (gövde)', yerlesim: 'el çizimi şekiller, yuvarlak ama farklı boyutlarda bloklar, sınıf panosu hissi', kacin: 'kurumsal gri, küçük metin' },
      { ad: 'Akademik sıcaklık', palet: 'bordo #6d1f2f, parşömen #f5efe2, lacivert #1d2b4a, altın #b88a2e', font: 'Cormorant Garamond (başlık) + Lato (gövde)', yerlesim: 'kitap sayfası düzeni, program bir ders çizelgesi gibi, öğretmen sözleri alıntı olarak', kacin: 'stok fotoğraf kolajı' },
    ] },
  { id: 'guzellik', name: 'Kuaför, berber, güzellik, spa, moda', when: ['kuaför', 'berber', 'güzellik', 'spa', 'masaj', 'moda', 'giyim', 'kozmetik', 'salon', 'tırnak', 'butik'],
    yonler: [
      { ad: 'Lüks editoryal', palet: 'siyah #0d0d0d, kemik #efe9e1, şampanya #c9a96e, gül kurusu #b77b7b', font: 'Playfair Display (başlık) + Jost (gövde)', yerlesim: 'büyük fotoğraf, dergi kapağı tipografisi, geniş boşluk, hizmet listesi fiyat tablosu gibi', kacin: 'pembe gradyan, emoji' },
      { ad: 'Klasik berber', palet: 'koyu yeşil #1f3b2d, krem #efe6d2, bakır #b0643a, siyah #141414', font: 'Bebas Neue (başlık) + Libre Franklin (gövde)', yerlesim: 'vintage tabela, çizgi süsleri, randevu düğmesi her yerde', kacin: 'pastel SaaS görünümü' },
    ] },
  { id: 'oyun', name: 'Oyun, eğlence, etkinlik', when: ['oyun', 'game', 'eğlence', 'etkinlik', 'festival', 'konser', 'parti', 'turnuva', 'piksel'],
    yonler: [
      { ad: 'Piksel arcade', palet: 'derin lacivert #14182e, arcade kırmızı #ff3b3b, sarı #ffd23f, nane #3ddc97', font: 'Press Start 2P (başlık, az) + Rubik (gövde)', yerlesim: 'oyunun kendisi ekranın merkezi, HUD gibi bilgi çerçeveleri, ekran sarsıntısı ve parçacıklar sadece oyun anında', kacin: 'kart ızgarası, kurumsal düğmeler' },
      { ad: 'Poster', palet: 'tek baskın canlı renk + siyah + kâğıt beyazı, risograf dokusu', font: 'Anton (başlık) + Space Grotesk (gövde)', yerlesim: 'dev tipografi, eğik/kesik bloklar, tarih ve yer büyük', kacin: 'yumuşak gölgeler' },
    ] },
  { id: 'turizm', name: 'Otel, turizm, emlak, mekân', when: ['otel', 'pansiyon', 'tatil', 'turizm', 'tur', 'emlak', 'gayrimenkul', 'villa', 'kamp', 'düğün', 'mekan', 'mekân'],
    yonler: [
      { ad: 'Yerin ruhu', palet: 'mekânın kendi renkleri: deniz #1d6f8a, kireç #f4f0e8, pişmiş toprak #b5643c, zeytin #737a4a', font: 'DM Serif Display (başlık) + DM Sans (gövde)', yerlesim: 'tam genişlik fotoğraf, harita ve mesafeler, oda/ilan sayfası bir gezi defteri gibi', kacin: 'stok "mavi gökyüzü" şablonu' },
    ] },
  { id: 'kisisel', name: 'Portfolyo, kişisel site, ajans, blog', when: ['portfolyo', 'portfolio', 'kişisel', 'cv', 'özgeçmiş', 'ajans', 'fotoğrafçı', 'tasarımcı', 'blog', 'yazar', 'sanatçı'],
    yonler: [
      { ad: 'Kişisel imza', palet: 'kişinin işinden çekilmiş 2 renk + nötr kâğıt', font: 'Instrument Serif (başlık) + Geist (gövde)', yerlesim: 'işler büyük ve önde, kişisel bir detay (el yazısı, fotoğraf, renk) her sayfada', kacin: 'beceri yüzde çubukları, jenerik ikonlar' },
      { ad: 'Brutal ve net', palet: 'saf beyaz, siyah, tek sinyal rengi (#ff4d00)', font: 'Familjen Grotesk (her şey) + bir mono', yerlesim: 'görünür ızgara, büyük numaralı listeler, kenarlıklı bloklar, hover\'da ters renk', kacin: 'yumuşak gölge, yuvarlak kartlar' },
    ] },
];

const lower = s => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i');
// brief'e en uyan sektör(ler): eşleşen kelime sayısına göre en fazla 2
export function presetsFor(text, max = 2) {
  const t = lower(text);
  return DESIGN_PRESETS.map(p => ({ p, hit: p.when.filter(w => t.includes(lower(w))).length })).filter(x => x.hit).sort((a, b) => b.hit - a.hit).slice(0, max).map(x => x.p);
}
// tarz, hazır bir yönün kopyası mı? (paletindeki hex değerlerinin en az 3'ü aynen geçiyorsa) → o yön, değilse null
export function copiedPreset(tarz) {
  const t = String(tarz || '').toLowerCase();
  for (const p of DESIGN_PRESETS) for (const y of p.yonler) { const hex = y.palet.toLowerCase().match(/#[0-9a-f]{6}/g) || []; if (hex.length >= 3 && hex.filter(h => t.includes(h)).length >= 3) return y; }
  return null;
}
const yonText = y => `${y.ad}: palet ${y.palet}; font ${y.font}; yerleşim ${y.yerlesim}; kaçın: ${y.kacin}`;
// ekip liderinin plan istemine: eşleşen sektörün hazır yönleri (eşleşme yoksa genel uyarı)
export function presetPrompt(text) {
  const ps = presetsFor(text);
  const head = '\nTASARIM YÖNÜ (vizyon.tarz): sıradan "yapay zekâ sitesi" görünümünden kaçınmak için tarzı SOMUT yaz: adlandırılmış palet (hex), font çifti (Google Fonts adıyla), yerleşim fikri, konunun dünyasından 3 görsel motif, kaçınılacaklar. Inter/Roboto, mor gradyan ve birbirinin aynısı kart ızgarası önermeyin.';
  if (!ps.length) return head;
  return head + '\nBu sektör için denenmiş yönler. Bunlar BAŞLANGIÇ noktasıdır, şablon değil: birini aynen alma; bu projenin kendine özgü ayrıntılarından (semt, ürün, hikâye, kitle) yola çıkarak palet, font ve yerleşimden en az ikisini değiştir, ya da tamamen yeni bir yön kur. Tarzda yönün adını değil, kendi kararlarını yaz:\n' +
    ps.map(p => `[${p.name}]\n` + p.yonler.map(y => '- ' + yonText(y)).join('\n')).join('\n');
}
