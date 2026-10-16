// LIVAND Ofis — ajan becerileri (saf işlevler, token harcamaz).
// Beceri = bir meslekte gerçekten uygulanan yöntem: adımlar + "bitti sayılması için" ölçütleri.
// Her görevde yalnızca o işe uyan birkaç beceri istem içine girer (az token); üç CLI de aynı şekilde kullanır.

// when: görev metninde geçince beceriyi tetikleyen anahtar kelimeler (küçük harf, kısmi eşleşme); always: her görevde
export const SKILLS = [
  // ---- Tasarımcı ----
  // pin: eşleşme sayısından bağımsız olarak hep öne alınır (sıradan "yapay zekâ sitesi" görünümü en sık kalite sorunu)
  { id: 'ayirt-edici-estetik', role: 'designer', name: 'Ayırt edici estetik', desc: 'Jenerik "yapay zekâ sitesi" görünümü yerine konunun kendi dünyasından gelen, akılda kalan bir görsel yön kurar.',
    when: ['site', 'web', 'sayfa', 'tasarım', 'arayüz', 'landing', 'oyun', 'uygulama', 'marka'], always: true, pin: true,
    steps: ['Konunun dünyasını 3 somut imgeyle yaz (malzeme, mekân, alet, dil) ve her görsel kararı bunlardan birine bağla.', 'İşe özel font çifti seç (Google Fonts): karakterli başlık + okunaklı gövde; Inter/Roboto/Arial kullanma.', '4-6 adlandırılmış renk: baskın renk + keskin vurgu, markaya doğru renklendirilmiş nötrler; mor/indigo gradyan, krem+terracotta, koyu zemin+tek neon kullanma.', 'Bir yerleşim fikri belirle (asimetri, ritim, ölçek farkı); her bölüm "başlık + 3 kart" olmasın.', 'Arka plan atmosferi (doku, desen, katmanlı renk, konuya uygun SVG süs) ve tek bir düzenlenmiş hareket anı tanımla.', 'Kaçınılacakları açıkça yaz; sonunda "bu herhangi bir yapay zekâ sitesine benziyor mu?" diye sor ve en jenerik kararı değiştir.'],
    done: ['Palet hex değerleriyle, fontlar adıyla, motifler ve kaçınılacaklar yazılı.', 'Her karar konunun dünyasına bağlanmış.'] },
  { id: 'tasarim-sistemi', role: 'designer', name: 'Tasarım sistemi', desc: 'Renk, tipografi ve boşluk kararlarını geliştiricinin tahmin etmeden uygulayabileceği tokenlara döker.',
    when: ['site', 'web', 'arayüz', 'ui', 'sayfa', 'uygulama', 'tasarım', 'tema', 'renk', 'stil'],
    steps: ['Renk tokenları: birincil, ikincil, nötr (metin/arka plan/çizgi) ve durum (başarı/uyarı/hata) — hex değerleriyle.', 'Tipografi ölçeği: gövde ≥16px, 1.25 oranlı başlık basamakları, satır yüksekliği 1.5; font yığını ve yedeği.', '4/8px boşluk ölçeği ve köşe yarıçapı, gölge gibi tekrar eden değerler.', 'Bileşen durumları: varsayılan, hover, focus, disabled, hata.', 'Hepsini CSS değişkeni adlarıyla (--renk-birincil gibi) yaz.'],
    done: ['Her metin/arka plan çifti için kontrast oranı yazılı.', 'H1, H2, gövde boyutu ve renkleri tek bakışta belli.'] },
  { id: 'erisilebilir-tasarim', role: 'designer', name: 'Erişilebilir tasarım (WCAG AA)', desc: 'Herkesin kullanabileceği arayüz: kontrast, dokunma hedefi, odak, etiketler.',
    when: ['site', 'web', 'form', 'buton', 'menü', 'erişilebilir', 'arayüz', 'uygulama'],
    steps: ['Metin kontrastı ≥4.5:1, büyük metin ve ikonlar ≥3:1.', 'Dokunma hedefleri ≥44×44px, aralarında en az 8px.', 'Klavye odağı görünür (odak halkası rengi ve kalınlığı belirli).', 'Renk tek başına anlam taşımasın (hata = renk + ikon + metin).', 'Form etiketleri her zaman görünür; yer tutucu etiket yerine geçmez.'],
    done: ['Kontrast değerleri sayıyla yazılı.', 'Odak ve hata durumları tanımlı.'] },
  { id: 'responsive-duzen', role: 'designer', name: 'Duyarlı (responsive) yerleşim', desc: 'Mobil önce yerleşim; her ekran genişliğinde içerik sırası ve menü davranışı.',
    when: ['site', 'web', 'mobil', 'responsive', 'sayfa', 'ekran', 'telefon'],
    steps: ['Mobil önce tasarla (360px), kırılım noktaları 768 / 1024 / 1280px.', 'Her kırılımda ızgara sütun sayısı ve içerik sırası.', 'Mobil menü davranışı (hamburger, açılınca üstte kalma, kapatma).', 'Görsel oranları ve kırpma kuralları.'],
    done: ['360px genişlikte yatay kaydırma olmayacağı açık.', 'Menünün mobilde nasıl çalıştığı yazılı.'] },
  { id: 'ux-akisi', role: 'designer', name: 'Kullanıcı akışı', desc: 'Kullanıcının hedefine giden yolu adım adım ve tüm durumlarıyla tasarlar.',
    when: ['uygulama', 'akış', 'sipariş', 'kayıt', 'giriş', 'sepet', 'rezervasyon', 'panel', 'randevu', 'ödeme'],
    steps: ['Birincil kullanıcıyı ve hedefini tek cümleyle yaz.', 'Ana akışı adım adım çıkar (ekran → eylem → sonuç).', 'Boş, yükleniyor, hata ve başarı durumlarını tanımla.', 'Her ekranda tek bir birincil eylem olsun.'],
    done: ['Akışın her adımı ve hata durumları yazılı.'] },
  { id: 'marka-kimligi', role: 'designer', name: 'Marka kimliği', desc: 'İşletmenin kişiliğini renk, yazı ve görsel diline çevirir.',
    when: ['marka', 'logo', 'dükkan', 'işletme', 'kurumsal', 'kimlik', 'mağaza', 'firma', 'şirket'],
    steps: ['Marka kişiliğini 3 sıfatla tanımla ve renk/yazı seçimlerini buna bağla.', 'Logo yoksa uygulanabilir metin-logo öner (font, ağırlık, renk).', 'Görsel dil: fotoğraf mı ikon mu, hangi tarz; kaçınılacaklar.', 'Sektördeki benzerlerden nasıl ayrışacağını yaz.'],
    done: ['Kişilik → görsel karar bağlantısı her karar için açık.'] },

  // ---- Yazılımcı ----
  { id: 'semantik-html', role: 'developer', name: 'Semantik HTML', desc: 'Doğru elemanlar, başlık sırası ve meta etiketleriyle sağlam sayfa iskeleti.',
    when: ['html', 'site', 'web', 'sayfa', 'landing'],
    steps: ['header / nav / main / section / footer kullan; div çorbasından kaçın.', 'Sayfada tek h1, başlıklar atlanmadan sıralı.', 'meta charset, viewport, anlamlı title ve description.', 'Her görselde anlamlı alt (süs görseli alt="").', 'Bağlantılar gerçek href, eylemler button; anchor hedefleri (id) gerçekten var.'],
    done: ['Tüm iç bağlantıların hedefi mevcut.', 'Başlık sırası ve meta etiketleri tam.'] },
  { id: 'responsive-css', role: 'developer', name: 'Duyarlı CSS', desc: 'Tasarım tokenlarını CSS değişkenine çevirip her ekranda kırılmayan yerleşim kurar.',
    when: ['css', 'site', 'web', 'mobil', 'responsive', 'sayfa', 'stil'],
    steps: ['Tasarım tokenlarını :root içinde CSS değişkeni yap; sabit renk/boyut tekrarlama.', 'Mobil önce yaz, min-width media query ile genişlet.', 'Yerleşimde flex/grid; görsellerde max-width:100%; height:auto.', 'z-index katmanlarını belirle (header < menü < overlay/modal) ve mobil menünün üstte kaldığını doğrula.', '360px genişlikte yatay kaydırma olmasın.'],
    done: ['Mobil menü açılınca içeriğin üstünde.', 'Sabit genişlik yüzünden taşma yok.'] },
  { id: 'erisilebilir-kod', role: 'developer', name: 'Erişilebilir kod', desc: 'Klavye, ekran okuyucu ve form erişilebilirliğini kodda uygular.',
    when: ['html', 'form', 'menü', 'buton', 'site', 'web', 'modal', 'arayüz'],
    steps: ['Her form alanında <label for>; zorunlu alanlar işaretli.', 'Tüm etkileşimler klavyeyle çalışır; :focus-visible stili var.', 'Mobil menü düğmesinde aria-expanded ve aria-controls.', 'Form sonuç/hata mesajları aria-live bölgesinde.', 'İkon düğmelerinde aria-label.'],
    done: ['Fare olmadan tüm akış tamamlanabiliyor.'] },
  { id: 'form-dogrulama', role: 'developer', name: 'Form doğrulama', desc: 'İstemci tarafında sağlam, anlaşılır hata mesajlı form doğrulaması.',
    when: ['form', 'iletişim', 'kayıt', 'giriş', 'sipariş', 'rezervasyon', 'abone', 'randevu'],
    steps: ['HTML5 doğrulama (required, type=email/tel, minlength, pattern) + JS ile ek kontrol.', 'E-posta "ad@alan.uzantı" biçiminde olmalı; "test@" gibi eksikler reddedilir.', 'Hata mesajı alanın yanında: ne yanlış ve nasıl düzeltilir.', 'Gönderimde düğmeyi kilitle (çift gönderim yok), başarıyı açıkça göster.', 'Sunucu yoksa gönderimin demo olduğunu kullanıcıya dürüstçe belirt.'],
    done: ['Geçersiz e-posta, boş zorunlu alan ve başarılı gönderim senaryoları çalışıyor.'] },
  { id: 'js-kalite', role: 'developer', name: 'Temiz JavaScript', desc: 'Hatasız, öngörülebilir ve konsolu temiz kalan istemci kodu.',
    when: ['javascript', 'js', 'script', 'etkileşim', 'uygulama', 'kod', 'interaktif'],
    steps: ['Kodu DOM hazır olunca çalıştır; querySelector sonucunu kullanmadan önce null kontrolü yap.', 'Global değişken bırakma; modül ya da IIFE kullan.', 'Kullanıcı verisini innerHTML ile basma; textContent kullan.', 'Olayları gerekiyorsa üst elemana bağla (event delegation).', 'Konsolda hata veya gereksiz log bırakma.'],
    done: ['HTML\'de olmayan bir id\'ye erişen kod yok.'] },
  { id: 'calistir-dogrula', role: 'developer', name: 'Çalıştır ve doğrula', desc: 'Teslim etmeden önce kodu çalıştırıp kanıtla doğrular.',
    when: ['kod', 'uygulama', 'api', 'fonksiyon', 'test', 'hesap', 'node', 'python', 'script', 'bot', 'sunucu'],
    steps: ['Çalıştırılabiliyorsa çalıştır (node --check, python -m py_compile, mevcut test komutu).', 'Kritik fonksiyonlar için küçük bir test veya örnek çalıştırma ekle.', 'Kenar durumları dene: boş girdi, hatalı girdi, sınır değerler.', 'Nasıl çalıştırılacağını kısa bir README bölümüne yaz.'],
    done: ['Çalıştırma/test çıktısı özetinde var.'] },
  { id: 'performans-seo', role: 'developer', name: 'Performans ve teknik SEO', desc: 'Hızlı açılan ve arama motorlarında doğru görünen sayfa.',
    when: ['site', 'web', 'sayfa', 'seo', 'hız', 'performans', 'google', 'landing'],
    steps: ['Görsellere width/height ve loading="lazy" (ilk ekran hariç).', 'font-display: swap; gereksiz harici kütüphane ekleme.', 'Anlamlı title (≤60) ve description (≤155), Open Graph etiketleri.', 'Yerel işletmeyse LocalBusiness yapılandırılmış verisi (JSON-LD).'],
    done: ['Meta ve OG etiketleri dolu; yer tutucu kalmadı.'] },

  // ---- Araştırmacı ----
  { id: 'kaynak-dogrulama', role: 'researcher', name: 'Kaynak doğrulama', desc: 'Her bulguyu güvenilir, güncel bir kaynağa bağlar; olguyu yorumdan ayırır.',
    when: ['araştır', 'kaynak', 'bilgi', 'veri', 'istatistik', 'güncel', 'pazar', 'trend'], always: true,
    steps: ['3-5 güvenilir kaynak kullan; resmi ve kurumsal kaynakları önceliklendir.', 'Her bulgunun yanına kaynak adı ve tarihi yaz.', 'Kaynaklar çelişiyorsa ikisini de ve olası nedeni belirt.', 'Olguyu yorumdan ayır ("veri:" / "yorum:").', '2 yıldan eski veriyi işaretle.'],
    done: ['Kaynağı olmayan bulgu kalmadı.'] },
  { id: 'rakip-analizi', role: 'researcher', name: 'Rakip ve örnek analizi', desc: 'Benzer işletme/ürünleri inceleyip uygulanabilir farklılaşma önerileri çıkarır.',
    when: ['rakip', 'benzer', 'örnek', 'dükkan', 'mağaza', 'site', 'işletme', 'pazar', 'ürün', 'sektör'],
    steps: ['3-5 benzer örnek bul (aynı sektör, mümkünse aynı ölçek).', 'Her biri için güçlü ve zayıf yanı tek satırda yaz.', 'Ortak örüntüleri çıkar (hepsinde olan şeyler = beklenen standart).', 'Farklılaşma fırsatlarını ve bunlara dayanan 3 uygulanabilir öneriyi yaz.'],
    done: ['Öneriler ekibin hemen kullanabileceği somutlukta.'] },
  { id: 'hedef-kitle', role: 'researcher', name: 'Hedef kitle', desc: 'Kimin için yapıldığını, ihtiyaçlarını ve karar kriterlerini netleştirir.',
    when: ['müşteri', 'kitle', 'kullanıcı', 'pazar', 'işletme', 'dükkan', 'mağaza', 'satış', 'öğrenci', 'veli'],
    steps: ['2-3 kısa persona: kim, ihtiyaç, endişe, karar kriteri.', 'Her personanın sitede/üründe aradığı ilk 3 bilgi.', 'Ulaşım kanalları (arama, harita, sosyal medya, ağızdan ağıza).', 'İçerik ve tasarım için çıkarımlar.'],
    done: ['Personalardan doğrudan içerik önerisi çıkıyor.'] },
  { id: 'yerel-isletme', role: 'researcher', name: 'Yerel işletme görünürlüğü', desc: 'Mahalledeki bir işletmenin bulunabilir olması için gerekenleri araştırır.',
    when: ['dükkan', 'mağaza', 'kırtasiye', 'kafe', 'restoran', 'yerel', 'şube', 'işletme', 'berber', 'kuaför', 'eczane', 'fırın'],
    steps: ['Google İşletme Profili için gerekenler (kategori, saat, fotoğraf, yorum).', 'Ad-adres-telefon (NAP) her yerde birebir aynı olmalı.', 'Yerel anahtar kelimeler ("<semt> kırtasiye" gibi).', 'Hızlı iletişim: tıklanınca arama, WhatsApp, yol tarifi bağlantısı.'],
    done: ['Siteye eklenmesi gereken yerel öğeler listelenmiş.'] },

  // ---- Yazar ----
  { id: 'donusum-metni', role: 'writer', name: 'Dönüşüm odaklı metin', desc: 'Okuru eyleme geçiren, faydayı öne çıkaran sayfa metni.',
    when: ['site', 'sayfa', 'ana sayfa', 'landing', 'satış', 'ürün', 'hizmet', 'dükkan', 'mağaza', 'tanıtım'],
    steps: ['Başlık faydayı söylesin (≤10 kelime); alt başlık nasıl sağlandığını.', 'Her bölüm tek bir mesaj taşısın.', 'Eylem çağrıları fiille başlasın ve ne olacağını söylesin ("Yol tarifi al").', 'Güven unsurları için yer aç (yorum, yıl, adres).', 'Jargon ve boş sıfatlardan kaçın.'],
    done: ['Her bölümün tek mesajı ve net bir eylem çağrısı var.'] },
  { id: 'seo-metin', role: 'writer', name: 'SEO uyumlu metin', desc: 'Arama motorunda bulunan ama insana yazılmış metin.',
    when: ['seo', 'blog', 'makale', 'yazı', 'site', 'içerik', 'google'],
    steps: ['1 ana ve 3 yan anahtar kelimeyi doğal biçimde kullan.', 'H1/H2/H3 yapısı anahtar kelimeyle uyumlu.', 'Meta başlık ≤60, açıklama ≤155 karakter.', 'Paragraflar en fazla 4 satır, listelerle taranabilir.'],
    done: ['Meta başlık ve açıklama yazılı.'] },
  { id: 'marka-sesi', role: 'writer', name: 'Marka sesi', desc: 'Tutarlı ton ve hitapla işletmenin kişiliğini metne taşır.',
    when: ['marka', 'ton', 'dükkan', 'işletme', 'kurumsal', 'sosyal medya', 'mağaza'],
    steps: ['Tonu 3 sıfatla tanımla.', 'Hitabı seç (sen/siz) ve her yerde aynı tut.', 'Kaçınılacak ifadeleri yaz.', 'Örnek bir başlık ve bir eylem çağrısıyla tonu göster.'],
    done: ['Tüm metinlerde hitap tutarlı.'] },
  { id: 'mikro-metin', role: 'writer', name: 'Arayüz metinleri', desc: 'Buton, hata ve boş durum metinlerini kısa ve yardımcı yazar.',
    when: ['buton', 'form', 'hata', 'uygulama', 'arayüz', 'bildirim', 'menü', 'mesaj'],
    steps: ['Butonlar fiille başlasın ("Gönder", "Sepete ekle").', 'Hata mesajı: ne oldu + nasıl düzeltilir, suçlamadan.', 'Boş durum metni bir sonraki adımı söylesin.', 'Başarı mesajı ne olduğunu doğrulasın.'],
    done: ['Her form alanının hata mesajı yazılı.'] },
  { id: 'blog-yazisi', role: 'writer', name: 'Blog yazısı', desc: 'Kancalı girişli, taranabilir ve kaynaklı blog yazısı.',
    when: ['blog', 'makale', 'yazı', 'haber', 'rehber', 'bülten'],
    steps: ['İlk iki cümlede okurun sorununu ve yazının vaadini ver.', 'Alt başlıklarla böl; her bölümde örnek veya veri olsun.', 'Sonuçta özet ve okura tek bir eylem öner.', 'Kullanılan kaynakları sonda listele.'],
    done: ['Her iddianın kaynağı var.'] },

  // ---- Denetçi ----
  { id: 'teslim-kontrolu', role: 'auditor', name: 'Teslim kontrolü', desc: 'İstenen her şeyin gerçekten teslim edildiğini doğrular.', always: true,
    steps: ['Plandaki her teslimat dosyası klasörde var ve dolu mu?', 'Kullanıcının isteğindeki her madde karşılandı mı? Tek tek işaretle.', 'Yer tutucu kaldı mı (lorem ipsum, TODO, örnek@, 000 000 00 00)?', 'Ajanların özetinde söyledikleri dosyalarda gerçekten var mı?'],
    done: ['Eksik teslimatlar düzeltme listesinde.'] },
  { id: 'web-denetimi', role: 'auditor', name: 'Web sitesi denetimi', desc: 'Kırık bağlantı, mobil yerleşim ve teknik hataları dosyaları okuyarak bulur.',
    when: ['html', 'css', 'site', 'web', 'sayfa'],
    steps: ['Her href="#..." için hedef id mevcut mu (Grep ile ara).', 'JS\'nin aradığı id/sınıflar HTML\'de var mı (konsol hatası riski).', 'Mobil: viewport meta, media query\'ler, mobil menünün z-index ve açılma mantığı.', 'Görsellerde alt, sayfada tek h1, meta description.', 'Her bulguyu dosya ve satır/bölüm adıyla yaz.'],
    done: ['Her bulgunun yeri ve önerilen düzeltmesi var.'] },
  { id: 'erisilebilirlik-denetimi', role: 'auditor', name: 'Erişilebilirlik denetimi', desc: 'WCAG AA ölçütlerine göre kontrast, etiket ve klavye kullanımını denetler.',
    when: ['html', 'form', 'site', 'web', 'buton', 'arayüz'],
    steps: ['Renk çiftlerinin kontrastını hesapla (≥4.5:1).', 'Her form alanının label\'ı var mı.', 'Etkileşimli öğeler klavyeyle erişilebilir mi, odak stili var mı.', 'aria özellikleri doğru kullanılmış mı.'],
    done: ['Bulgular WCAG ölçütüyle eşleştirilmiş.'] },
  { id: 'kod-inceleme', role: 'auditor', name: 'Kod incelemesi', desc: 'Mantık hatası, kenar durum ve güvenlik açıklarını arar.',
    when: ['js', 'javascript', 'kod', 'api', 'node', 'python', 'uygulama', 'script', 'sunucu'],
    steps: ['Mantık hataları ve ele alınmamış kenar durumlar.', 'Hata yönetimi: başarısız istek, boş veri.', 'Güvenlik: kullanıcı verisi innerHTML/eval\'e gidiyor mu, gizli anahtar kodda mı.', 'Ölü kod ve tekrar.'],
    done: ['Her bulgu dosya:satır ile.'] },
  { id: 'icerik-denetimi', role: 'auditor', name: 'İçerik denetimi', desc: 'Metinleri doğruluk, tutarlılık ve dil açısından denetler.',
    when: ['metin', 'yazı', 'blog', 'içerik', 'makale', 'md', 'tanıtım'],
    steps: ['Metin kullanıcının isteğine ve hedef kitleye uygun mu.', 'Yazım ve dilbilgisi hataları.', 'Tutarlılık: isim, adres, fiyat, saat her yerde aynı mı.', 'Kaynaksız iddialar.'],
    done: ['Tutarsızlıklar tek tek listelenmiş.'] },

  // ---- Oyun ----
  { id: 'oyun-tasarimi', role: 'designer', name: 'Oyun tasarım belgesi', desc: 'Oyunu oynanabilir kılan kararları ve ekibin uyacağı asset sözleşmesini yazar.',
    when: ['oyun', 'game', 'tasarım belgesi', 'mekanik', 'seviye'],
    steps: ['Tür ve 1 cümlelik temel döngü (oyuncu ne yapar, neden tekrar oynar).', 'Kontroller: klavye ve dokunmatik eşlemesi.', 'Kazanma/kaybetme, skor, zorluğun nasıl arttığı; ekranlar (başlık, oyun, oyun sonu).', 'ASSET LİSTESİ tablosu: ad, tür (karakter/düşman/nesne/karo/arka plan), boyut (16/32/64 px ızgarası), kare sayısı, dosya yolu.', 'Atlas sözleşmesi: assets/atlas.json içindeki kare adları — kod ve assetler buna göre paralel yazılır.'],
    done: ['Her asset listede ölçüsüyle var; kod yazacak kişi soru sormadan başlayabilir.'] },
  { id: 'oyun-asseti', role: 'designer', name: 'Oyun asseti üretimi', desc: 'Tutarlı piksel sanat/SVG assetleri ve animasyon kareleri üretir.',
    when: ['oyun', 'sprite', 'asset', 'piksel', 'karakter', 'düşman', 'atlas', 'animasyon', 'karo'],
    steps: ['Tek bir palet seç (8-16 renk) ve tüm assetlerde onu kullan; karakterlere koyu dış çizgi ver.', 'Izgara boyutuna sadık kal (16/32 px); aynı karakterin tüm kareleri aynı boyut ve hizada.', 'Animasyon: yürüme 4, zıplama 2, boşta 2 kare yeterli; "frames" ile şerit üret.', 'Arka plan saydam olmalı; oyuncu, düşman ve toplanabilir nesne renkleri birbirinden net ayrışmalı.', 'Sonunda atlas.png + atlas.json üret ve kare adlarını tasarım belgesindeki sözleşmeyle eşleştir.'],
    done: ['Atlas.json\'daki her ad tasarım belgesinde var; info ile boyutlar doğrulandı.'] },
  { id: 'oyun-gelistirme', role: 'developer', name: 'Oyun geliştirme (Canvas)', desc: 'Sabit adımlı döngü, girdi, çarpışma ve asset yüklemesiyle oynanabilir tarayıcı oyunu.',
    when: ['oyun', 'game', 'canvas', 'sprite', 'çarpışma', 'skor'],
    steps: ['requestAnimationFrame + sabit zaman adımı (update/render ayrı); sekme gizlenince duraklat.', 'Girdi: klavye (ok/WASD/boşluk) ve dokunmatik düğmeler; tuş durumunu bir nesnede tut.', 'Çarpışma: AABB; hızları delta zamana göre uygula.', 'Assetleri atlas.json ile yükle, hepsi yüklenince başlat; asset yoksa renkli dikdörtgenle çalış (paralel çalışan asset işini bekleme).', 'Başlık ekranı, skor, oyun sonu ve yeniden başlat; en yüksek skoru localStorage\'da tut; canvas\'ı ekrana göre ölçekle (imageSmoothingEnabled=false).'],
    done: ['Oyun tarayıcıda açılınca oynanabilir; konsolda hata yok; asset yolları atlas.json ile tutarlı.'] },
  { id: 'oyun-denetimi', role: 'auditor', name: 'Oyun denetimi', desc: 'Kodu okuyarak oynanabilirliği ve asset tutarlılığını denetler.',
    when: ['oyun', 'game', 'canvas', 'sprite'],
    steps: ['Döngü: sabit adım var mı, oyun sonu ve yeniden başlat çalışıyor mu.', 'Kontroller: tasarım belgesindeki her tuş/dokunma kodda karşılanmış mı.', 'Çarpışma ve skor mantığında kenar durumlar (duvar içine girme, çift sayım).', 'Kodun istediği her atlas karesi atlas.json\'da ve dosya assets/ altında var mı.', 'Mobilde dokunmatik kontroller ve ölçekleme.'],
    done: ['Her bulgu dosya ve fonksiyon adıyla.'] },

  // ---- CEO ----
  { id: 'kapsam-netlestirme', role: 'ceo', name: 'Kapsam netleştirme', desc: 'İsteği açık, ima edilen ve kapsam dışı olarak ayırıp başarı ölçütünü belirler.', always: true,
    steps: ['Kullanıcının açıkça istediğini, ima ettiğini ve kapsam dışını ayır.', 'Başarı ölçütünü tek cümleyle yaz.', 'İlk teslimde en değerli minimum ürünü hedefle.'],
    done: ['Her görev başarı ölçütüne hizmet ediyor.'] },
  { id: 'paralel-planlama', role: 'ceo', name: 'Paralel planlama', desc: 'Bağımlılıkları çıkarıp aynı anda yürüyebilecek işleri ayırır.', always: true,
    steps: ['Görevlerin gerçek bağımlılıklarını çıkar: hangisi hangisinin çıktısını OKUMADAN yapılamaz?', 'Bağımsız işleri paralel başlat; aynı anda çalışanlar farklı dosyalara yazsın.', 'Her görevin teslimatını ve kabul ölçütünü yaz; denetçiyi sona koy.'],
    done: ['Gereksiz bağımlılık yok.'] },
];

export const MAX_SKILLS = 3;   // görev başına istem içine giren beceri sayısı (token tasarrufu)
const ROLE_BY_PRESET = { arastirma: 'researcher', yazilim: 'developer', yazar: 'writer', tasarim: 'designer', denetim: 'auditor' };
export const roleOf = (key, agent = {}) => SKILLS.some(s => s.role === key) ? key : ROLE_BY_PRESET[agent.preset] || null;
// eşleştirme için: Türkçe küçük harf + ı/i farkı yok ("Instagram" → "ınstagram" da "instagram" ile eşleşsin)
const lower = s => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i');
const kw = w => (Array.isArray(w) ? w : String(w || '').split(',')).map(x => lower(x).trim()).filter(Boolean);

// ajanın kullanabildiği beceriler: rolünün kütüphane becerileri + kendi eklediği beceriler; on = açık mı
export function skillsOf(key, agent = {}) {
  const role = roleOf(key, agent), off = new Set(agent.skillsOff || []);
  const lib = SKILLS.filter(s => s.role === role).map(s => ({ ...s, own: false }));
  const own = (agent.customSkills || []).map(s => ({ ...s, when: kw(s.when), always: !kw(s.when).length, own: true }));
  return [...lib, ...own].map(s => ({ ...s, on: !off.has(s.id) }));
}

// görev metnine en uyan açık beceriler: anahtar kelime eşleşme sayısına göre; "always" beceriler eşleşme olmasa da girer.
// Kullanıcının kendi eklediği beceri, uyduğunda hazır becerilerin hep önüne geçer.
export function pickSkills(key, agent, text, max = MAX_SKILLS) {
  const t = lower(text);
  const rank = x => x.hit + (x.s.own ? 100 : 0) + (x.s.pin ? 50 : 0);
  return skillsOf(key, agent).filter(s => s.on)
    .map(s => ({ s, hit: kw(s.when).filter(w => t.includes(w)).length }))
    .filter(x => x.hit > 0 || x.s.always)
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, max).map(x => x.s);
}

export function skillsPrompt(skills) {
  if (!skills.length) return '';
  return '\nBECERİLERİN (bu görevde uygula; ölçütleri karşılamadan teslim etme):\n' + skills.map(s =>
    `## ${s.name}\n` + (s.steps || []).map(x => '- ' + x).join('\n') + ((s.done || []).length ? `\nBitti sayılması için: ${s.done.join(' ')}` : '')).join('\n');
}

// kullanıcının eklediği beceriyi doğrular ve kırpar
export function cleanCustomSkill(s, i = 0) {
  const name = String(s?.name || '').trim().slice(0, 40);
  const steps = (Array.isArray(s?.steps) ? s.steps : String(s?.steps || '').split('\n')).map(x => String(x).replace(/^[-•*\s]+/, '').trim().slice(0, 240)).filter(Boolean).slice(0, 8);
  if (!name || !steps.length) return null;
  const id = /^ozel-[a-z0-9-]{1,40}$/.test(s.id || '') ? s.id : `ozel-${Date.now().toString(36)}${i}`;
  return { id, name, desc: String(s.desc || '').trim().slice(0, 160), when: String(s.when || '').split(',').map(x => x.trim().slice(0, 30)).filter(Boolean).slice(0, 12).join(', '), steps, done: [] };
}
