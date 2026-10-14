<div align="center">

<img src="public/icon.svg" width="88" alt="LIVAND">

# LIVAND Ofis

**Yapay zekâ ajanlarından oluşan bir ekibi 3B sanal ofiste yönet.**<br>
Sen projeyi anlatırsın → CEO plan çıkarır → sen onaylarsın → ekip senin klasöründe çalışır.

![Node](https://img.shields.io/badge/Node.js-20%2B-3c873a?logo=node.js&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-masa%C3%BCst%C3%BC-47848f?logo=electron&logoColor=white)
![Claude Code](https://img.shields.io/badge/Claude_Code-CLI-d97757)
![Codex](https://img.shields.io/badge/Codex-CLI-111111?logo=openai&logoColor=white)
![Antigravity](https://img.shields.io/badge/Antigravity-CLI-4285f4?logo=google&logoColor=white)
![API anahtarı yok](https://img.shields.io/badge/API_anahtar%C4%B1-gerekmez-2e7a58)

<img src="docs/img/ofis-calisiyor.png" alt="Ajanlar çalışırken ofis" width="900">

</div>

## Neden LIVAND?
- **API anahtarı yok, sadece CLI:** Ajanlar bilgisayarındaki **Claude Code**, **Codex** ve **Antigravity** komut satırı araçlarıyla, kendi aboneliğinle çalışır. Hesap bilgilerin uygulamadan geçmez; ortamda bir API anahtarı olsa bile CLI'lere aktarılmaz.
- **Her işe en iyi CLI:** Görevler iş türüne ayrılır (kod, terminal, arayüz, araştırma, metin, denetim, plan). "Otomatik" ajanlar o işte en iyi sonucu veren bağlı CLI'yi seçer ve projelerdeki puanlarla zamanla öğrenir.
- **Gelişen ekip:** Her ajanın mesleki standartları, seviyesi, gelişim alanı ve kanıta dayalı dersleri var. Her görevden sonra ölçülebilir puan alır ve öğrendiklerini sonraki işlerde kullanır.
- **Güvenli çalışma:** Ajanlar yalnızca seçtiğin proje klasöründe serbesttir. Klasör dışı erişim, silme ve paket kurulumu gibi riskli işlemler onay kutusuna düşer; paket kurulumunda paket güvenliği gösterilir.
- **Görünür süreç:** Canlı görev panosu, adım adım günlük, token analizi ve tasarruf hesabı.

## Ekranlar
| Görev panosu | Günlük |
|---|---|
| ![Pano](docs/img/pano.png) | ![Günlük](docs/img/gunluk.png) |
| **CLI sağlayıcıları ve "kim neyde iyi"** | **Ajan gelişimi** |
| ![Analiz](docs/img/analiz.png) | ![Ajan](docs/img/ajan.png) |
| **Sohbet ve plan** | **Ofis düzenleyici** |
| ![Akış](docs/img/ofis.png) | ![Düzenleyici](docs/img/duzenle.png) |

> Görseller test modunda (gerçek CLI çalışmadan) örnek veriyle `npm run shots` ile üretilmiştir; sayılar örnektir.

## Hızlı başlangıç

### 1. Gereksinimler
- **Windows 10/11** (sunucu macOS/Linux'ta da çalışır; klasör seçme penceresi ve masaüstü kısayolu Windows içindir)
- **[Node.js](https://nodejs.org) 20 veya üstü**
- **Claude Code** (zorunlu; ana CLI ve onay kutusu buna bağlı)
- İsteğe bağlı: **Codex CLI** ve **Antigravity CLI**

### 2. Uygulamayı indir ve kur
```bash
git clone <bu deponun adresi> livand
cd livand
npm install
```

### 3. CLI'leri kur ve giriş yap
| CLI | Kurulum | Giriş |
|---|---|---|
| **Claude Code** (zorunlu) | `npm install -g @anthropic-ai/claude-code` | terminalde `claude` → `/login` (tarayıcıda onay) |
| **Codex** (isteğe bağlı) | `npm install -g @openai/codex` | uygulamada **Bağlan** (tarayıcıda onay) |
| **Antigravity** (isteğe bağlı) | PowerShell: `irm https://antigravity.google/cli/install.ps1 \| iex` | uygulamada **Bağlan** (Google girişi) |

> Antigravity **IDE** ile Antigravity **CLI** aynı şey değildir: ajanlar için `agy` komutu gerekir. IDE'de Google ile giriş yaptıysan CLI aynı girişi kullanır.

### 4. Çalıştır
```bash
npm run electron
```
Ya da `Ofis.cmd` dosyasına çift tıkla. Sadece sunucu için `npm start` → http://localhost:3000

### 5. Bağlan ve başla
1. Üstteki **CLI** düğmesi yeşilse Claude Code hazırdır.
2. **Analiz → CLI sağlayıcıları** kartında Codex ve Antigravity için **Bağlan**'a bas, onayı tarayıcıda ver.
3. **+** ile yeni proje aç, çalışılacak klasörü seç ve projeni anlat (veya hazır bir şablon seç).
4. CEO'nun planını onayla; ekip çalışmaya başlar.

## CLI bağlantısı
Üst çubuğun solundaki **CLI** düğmesi Claude Code bağlantısını gösterir: yeşil = bağlı, kırmızı "BAĞLI DEĞİL" = Claude Code yok veya giriş yapılmamış (tıklayınca yeniden denetler), gri **Bağlan** = bağlantıyı sen kestin.
- Bağlıyken tıkla → onay sorar → **Bağlantıyı kes**: çalışan tüm CLI süreçleri hemen sonlandırılır, bekleyen onaylar reddedilir, yarım görevler "iptal" olur; bağlantı kesikken hiçbir ajan çalışmaz. Tercih kaydedilir, uygulama yeniden açılınca da kesik kalır.
- **Bağlan**'a basınca giriş durumu yeniden denetlenir; yarım kalan proje "Devam et" ile kaldığı yerden sürer.

## Çoklu CLI: Claude Code, Codex, Antigravity
Ajanlar Claude Code'un yanında **OpenAI Codex CLI** (`codex exec --json`) ve **Google Antigravity CLI** (`agy -p --output-format stream-json`) ile de çalışabilir.
- **Bağlan:** **Analiz → CLI sağlayıcıları** kartında **Bağlan**'a bas. Codex tarayıcıda OpenAI giriş sayfasını açar. Antigravity önce Antigravity IDE'deki Google girişini sessizce dener (`agy models`, token harcamaz); giriş yoksa ayrı bir pencere açar ve tarayıcıda Google girişi istenir. Onayı web'de sen verirsin; parola ya da anahtar bu uygulamadan geçmez. Tarayıcı açılmazsa kartta **Onay sayfasını aç** düğmesi çıkar.
- **Bağlantıyı kes:** O CLI'ye yeni iş verilmez ve çalışan süreçleri hemen durur; yarım kalan görev Claude Code ile sürer. **Çıkış yap**, CLI'nin bu bilgisayardaki girişini de siler.
- Model alanı boşsa CLI'nin kendi varsayılan modeli kullanılır.
- **Ajan başına seçim:** Varsayılan **Otomatik**'tir: sistem her görevi o işte en iyi olan bağlı CLI'ye verir. İstersen ajana tıklayıp sabit bir CLI seçebilirsin.
- **Kim neyde iyi?** Otomatik ajan, görevin iş türünde en yüksek tahmine sahip CLI'yi seçer; az denenmiş bir CLI'ye ara sıra (%10) şans verir.
- **Tahmin nereden gelir?** Başlangıçta kamuya açık kıyaslardan gelen hafif bir ön bilgi (Claude: gerçek depo hatası düzeltme/SWE-bench; Codex: terminal görevleri/Terminal-Bench; Antigravity/Gemini: web arayüzü ve Google aramalı araştırma); bu bilgi sadece 3 görev ağırlığındadır. Sonra projelerindeki ölçülebilir puanlar (teslimat, denetçi kalitesi, verimlilik) ve Bitir'de verdiğin puan (yarım ağırlık) eklendikçe tablo senin kullanımına göre değişir. Tablo kartta görünür; ⟲ ile sıfırlanır.
- **Hata olursa:** Codex/Antigravity bir görevde hata verirse bu 1 puan sayılır ve görev Claude Code ile bir kez daha denenir.
- **Güvenlik farkı:** Codex ve Antigravity ofisin onay kutusuna bağlanamaz (Claude Code'daki `--permission-prompt-tool` karşılığı yok). Bu yüzden kendi sandbox'larında, çalışma klasörüyle sınırlı ve onay sormadan çalışırlar: Codex `--sandbox workspace-write` (ağ kapalı, bu yüzden web araştırmasına atanmaz), planlamada `read-only`; Antigravity `--sandbox --mode accept-edits` (dosya düzenleyebilir; komut çalıştırma sadece "tam yetki" açıksa). Paket kurma veya klasör dışı erişim gerektiren riskli işlerde ajanı Claude Code'da tut.
- Kısa metin çağrıları (soru-cevap, ders çıkarma) her zaman Claude Code ile yapılır.

## Claude limiti
**Analiz** sekmesinin en üstünde oturum (5 saatlik) ve haftalık kullanım yüzdesi, çubuk ve yenilenme zamanı görünür. Değerler Claude Code'un kendi `/usage` komutundan (`claude -p /usage`) okunur; bu komut model çağırmaz, **token harcamaz**. Açılışta, her çalıştırma bitince ve 10 dakikada bir kendiliğinden tazelenir; ↻ ile elle yenilenir. Üstteki CLI düğmesi oturum yüzdesini gösterir (örn. "CLI %48"); limit dolarsa "Limit doldu" olur. Kimlik bilgisi dosyalarına erişilmez.

## Akış
1. Yeni proje → klasör seç (veya varsayılan) → projeyi anlat ya da hazır şablon seç.
2. CEO kısa araştırma yapıp görev planı çıkarır; planı onaylarsın (veya değişiklik istersin).
3. Ajanlar (tasarımcı, geliştirici, araştırmacı, yazar, denetçi + senin eklediklerin) görevleri sırayla/paralel yapar; riskli her işlem onay kutusuna düşer.
4. Bitirince puan verirsin; ajanlar dersler çıkarır ve sonraki projelerde kullanır.

## Panel sekmeleri
- **Akış**: sohbet, plan kartı, onay kartları.
- **Pano**: canlı görev panosu (Bekliyor / Çalışıyor / Bitti / Sorunlu); her görevde süre, çalıştıran CLI ve puan; altta **geçmiş çalıştırmalar** ve "Tekrar çalıştır".
- **Günlük**: ajanların yaptığı her adım (araç, sonuç, hata, alt ajan, CLI seçimi, görev başladı/bitti) canlı akar.
- **Analiz**: Claude limiti, CLI sağlayıcıları ve "kim neyde iyi" tablosu, tasarruf, toplam/proje/ajan bazında token, son 13 haftanın ısı haritası, proje başına token bütçesi.

## Ajanların gelişimi
Her ajanın **mesleki standartları** ve **teslim öncesi kontrol listesi** vardır (CEO, tasarımcı, geliştirici, araştırmacı, yazar, denetçi; eklenen ajanlar genel bir yönerge alır). Her görevde istemine şunlar eklenir: standartları, seviyesi, **gelişim alanı** (son görevlerdeki en zayıf ölçütü) ve en güçlü 6 dersi.
- **Dersler kendiliğinden oluşur:** Görevden sonra ölçülebilir puandan (eksik dosya, çok adım, reddedilen işlem, gereksiz soru) ve denetçinin notundan token harcamadan ders çıkar; ajan da her işin sonunda tek cümlelik **öz değerlendirme** yazar. Projeyi bitirince senin puanından çıkan dersler en yüksek ağırlığı alır.
- Benzer dersler birleşip güçlenir, eskiler zamanla zayıflar (30 günde yarılanır); en fazla 24 ders tutulur.
- **Seviye:** Stajyer → Yardımcı → Uzman → Kıdemli → Usta. Deneyim her görevin puanı kadar artar; ortalama kalite düşükse seviye sınırlanır. Seviye atlayınca ajan sohbette haber verir.
- Ajana tıklayınca seviye, ilerleme, gelişim alanı, güçlü yönler, standartlar ve dersler (kaynağıyla) görünür; istemediğin dersi silebilirsin.

## Puanlama (ölçülebilir)
Puan (1-10) = Teslimat %40 + Kalite %35 + Verimlilik %15 + Uyum %10.
- **Teslimat:** hata yok mu, beklenen dosya klasörde var ve boş değil mi.
- **Kalite:** denetçinin dosyaları okuyarak verdiği doğruluk, tamlık ve talimata uyum puanları.
- **Verimlilik:** kullanılan adım sayısı / izin verilen adım.
- **Uyum:** reddedilen izin ve ajanlar arası soru sayısı.

Kullanıcı puanı (Bitir) ayrıca eklenir. Ölçüt hesaplanamıyorsa ağırlıklar kalanlara yeniden dağıtılır.

## Tasarruf (yöntem)
**Analiz → Bu ay tasarruf** kartı şu formülü kullanır:
- **Kazanılan süre** = puanı ≥ 6 olan her biten iş için (insanın aynı işi yapay zekâsız yapma süresi − ajanın ölçülen çalışma süresi). Düşük puanlı ve bitmeyen işler sayılmaz; sonuç hiçbir zaman eksi olmaz.
- **Kâr %** = (kazanılan süre × senin saatlik ücretin − aboneliğin bu ana kadarki payı) ÷ abonelik payı. Abonelik ($/ay), saatlik ücret (₺) ve kuru sen girersin.

İnsan referans süreleri:

| Rol | Dakika | Dayanak |
|---|---|---|
| Geliştirici | 161 | Ölçülmüş — [Peng ve ark. 2023, arXiv:2302.06590](https://arxiv.org/abs/2302.06590): kontrollü deney, yapay zekâsız grup JavaScript HTTP sunucusunu ortalama 160,89 dk'da bitirdi (yapay zekâlı grup %55,8 hızlı). |
| Yazar | 26 | Ölçülmüş — [Noy & Zhang 2023, Science 381:187](https://doi.org/10.1126/science.adh2586): meslek yazısı görevleri; yapay zekâ süreyi %40 kısalttı, kaliteyi %18 artırdı. 26 dk ek dosyadaki ortalamadır. |
| Araştırmacı | 60 | Varsayım (doğrulanmış ölçüm yok) |
| Tasarımcı | 90 | Varsayım |
| CEO | 30 | Varsayım |
| Denetçi | 30 | Varsayım |

Varsayımları kartın "Yöntem ve kaynaklar" bölümünden kendi iş sürelerinle değiştirebilirsin. Görev türleri çalışmalardaki görevlerle birebir aynı değildir; sonuç bir tahmindir.

## Güvenlik politikası
- Ajanlar sadece proje çalışma klasöründe serbest: o klasörün dışında dosya okuma/yazma/listeleme ve klasör dışı yol içeren her komut onay kutusuna düşer (YÜKSEK risk). Bunlar için "Bu projede hep izin ver" yoktur.
- Her Bash komutu önce yerel sunucudan geçer: çalışma klasöründe zararsız okuma komutları (ls, cat, git status...) sormadan çalışır, diğerleri sorulur.
- Paket kurulumunda (npm/pnpm/yarn/pip/npx; choco/winget/apt/brew için uyarı) onay kartında paket güvenliği gösterilir: kayıt defterinde var mı, haftalık indirme, yaş, lisans, kurulum betiği, kullanımdan kaldırılmış mı, popüler bir pakete benzer mi (yazım hatası tuzağı). Sadece paket adı npm/PyPI kayıt defterine sorulur.
- WebSearch/WebFetch (web okuma) araştırma için otomatik izinlidir; bunu istemezsen ajanın araçlarından çıkar.
- Çalışma klasörü seçiminde sürücü kökü, Windows/Program Files ve kullanıcı ana klasörü reddedilir.
- Sunucu yalnızca `127.0.0.1` dinler ve yabancı Host/Origin başlıklarını reddeder.
- Onay kutusu: izin istekleri risk seviyesine göre sıralanır (Yüksek: silme/kurulum/indirme/klasör dışı, Orta: komut/dosya yazma, Düşük: salt okunur). "Düşük riski otomatik onayla" seçeneği ve toplu onay vardır.

## Token bütçesi ve kurtarma
- Proje başına token bütçesi koy (Analiz sekmesi). %80'de uyarır; dolunca yeni iş başlatmaz, çalışan görevi bitirir ve durur. Bütçeyi artırıp **Devam et** ile kaldığı yerden sürdürürsün.
- Uygulama ortasında kapanırsa açılışta yarım kalan projeler "kesildi" işaretlenir ve **Devam et** ile sürer; biten görevler tekrar çalıştırılmaz.
- Token tasarrufu: kısa yönergeler, düşünme kapalı seçeneği, şablonlarda araştırma/plan atlama, sadece özet aktarma, düşük riskli komutlar için sorusuz çalışma.

## Ofiste neler görünür
- Çalışma animasyonları araca göre değişir: yazan klavyeye hızlı vurur, komut çalıştıran farklı ritimde, arayan elini çeneye koyar, okuyan ekrana eğilir; yakınlaşınca küçük bir işlem balonu çıkar.
- Durumlar: çalışıyor, onay bekliyor ("Onay?"), **hata**, **limit** (kullanım sınırı), **bitti**; hepsi balon ve etiket rengiyle görünür.
- Alt ajan (Task/Agent aracı) çalışınca masanın yanında küçük bir "yardımcı" karakter belirir.
- Ofis olayları: boştaki ajan ara sıra kahve alır; tüm görevler bitince konfeti ve kutlama; gün/akşam/gece ışığı bilgisayar saatine göre değişir.
- **Ofis düzenleyici** (`Düzenle` düğmesi veya `E`): eşya ekle, sürükle (0,25 ızgara), döndür (`R`), sil (`Del`), geri/ileri al (`Ctrl+Z/Y`), JSON olarak dışa/içe aktar, sıfırla. Düzen `data/layout.json` içinde saklanır; yürüyüş yolları yeni düzene göre güncellenir.
- **Mini** düğmesi: masaüstü uygulamasında aynı pencere küçülüp sağ alt köşede her zaman üstte kalır; "Ana pencere" ile eski boyutuna döner. Tarayıcıda küçük bir açılır pencere açar.
- **Kart** düğmesi: projenin ofis görüntüsü, görev durumu, token ve ekip puanıyla paylaşılabilir 1200×630 PNG üretir (indirmeyi sen başlatırsın).

## Dil ve erişilebilirlik
- Üstteki **TR/EN** düğmesi arayüzü, ajanların mesleki standartlarını ve yanıt dilini değiştirir (seçim kaydedilir). Ajanların yazdığı içerik (mesajlar, görev metinleri, dersler) çevrilmez.
- Klavye: `/` mesaj kutusu, `1 2 3 4` sekmeler, `+ − 0` yakınlaş/sıfırla, oklar kamerayı kaydırır, `E` düzenleme, `?` kısayol listesi, `Esc` kapat. Pencerelerde odak tuzağı, durum değişiklikleri ekran okuyucuya duyurulur, odak halkaları görünür, ekip listesi klavyeyle kullanılır.
- `prefers-reduced-motion` açıksa hareketler azaltılır (konfeti kapanır, titreme/sekme azalır).

## Bellek (RAM)
- Uygulama boştayken ~430 MB (Electron: ana süreç, ekran, GPU, ağ). Ajan çalışırken her ajan ayrı bir CLI süreci açar (~150-300 MB). **Analiz → Aynı anda ajan** (1/2/3) ile tepe RAM'i sınırlarsın; 1-2 seçmek RAM'i azaltır ama işi yavaşlatır.
- "Kalite: Düşük" GPU belleğini ve işlemciyi daha da azaltır. Boştayken sahne 30 FPS'te çizilir; pencere küçültülünce çizim durur.

## Dış araçlardan durum bildirme
Başka bir araç (CI, betik, başka bir ajan) ofiste kendi karakteriyle görünebilir:

```bash
curl -X POST http://localhost:3000/api/event -H "content-type: application/json" -d '{"name":"CI","state":"working","note":"build çalışıyor"}'
```
`state`: `working` · `idle` · `blocked` (onay bekliyor) · `done` · `error`. İlk istekte ajan ve masa kendiliğinden oluşur (`ext_…` kimliğiyle; görev almaz). İsteğe bağlı: `OFIS_API_TOKEN` ortam değişkeni tanımlarsan istekler `x-ofis-token` başlığı ister.

## Diğer özellikler
- Bildirim: izin/plan/iş bitti/hata/limit olaylarında kısa ses ve (pencere arka plandaysa) masaüstü bildirimi. Üstteki çan ile kapatılır.
- Ajan ekleme/silme: ekip panelinde "+ Ajan"; masa ve karakter otomatik oluşur (en fazla 9 ajan).
- Şablonlar: yeni projede hazır plan seçilirse CEO araştırması atlanır (token harcanmaz).
- Hafıza: ortak tercihler (tüm ajanlar uyar), proje notları ve her ajanın kendi dersleri; proje bitirilince otomatik öğrenilir.
- Kamera: sürükle = kaydır, tekerlek/pinch = yakınlaş, rol etiketine tıkla = odaklan (çift tıkla = ayarlar), boşluğa çift tıkla = sıfırla.
- Kalite: sol alttaki düğme (Düşük/Yüksek); düşükte ağaç, gölge ve ışık azalır. Grafik bağlamı kaybolur veya çok yavaşlarsa otomatik düşük kaliteye geçer.

## Verilerin nerede?
Tüm durum (projeler, ajanların dersleri, ayarlar, ofis düzeni, Electron profili) proje içindeki `data/` klasöründe tutulur ve depoya eklenmez (`.gitignore`). CLI girişleri her CLI'nin kendi yerinde (işletim sistemi anahtarlığı vb.) kalır; uygulama bunları okumaz ve kopyalamaz.

## Geliştirme
- `npm test`: Node'un yerleşik test çalıştırıcısıyla, test modunda (gerçek CLI çalışmaz, token harcanmaz):
  - `test/policy.test.mjs`: klasör dışı yol tespiti, komut sınıflandırma, paket ayrıştırma ve yazım hatası tuzağı, paket güvenlik kararı, puanlama, klasör doğrulama, şablon tutarlılığı.
  - `test/growth.test.mjs`: dersler, seviye, gelişim alanı, tasarruf hesabı.
  - `test/providers.test.mjs`: iş türü ayrımı, öğrenme/seçim, Codex ve Antigravity çıktı ayrıştırma, güvenli argüman.
  - `test/server.test.mjs`: ayrı bir veri klasörüyle gerçek sunucu — Host/Origin koruması, dış olay girişi, düzen, plan→pano→puan→geçmiş akışı, token bütçesi, çökme sonrası kurtarma, çoklu CLI yönlendirme.
- `npm run shots`: README görsellerini (animasyon dahil) test modunda yeniden üretir.
- `node tools/make-icon.mjs`: "VL" ikonunu üretir (`public/icon.svg`, `public/icon-256.png`, `electron/icon.ico`).
- Arayüzün 3B kısmı (animasyonlar, düzenleyici, mini pencere) otomatik test edilmez; elle denenir.

## Görsel kaynaklar
- Kenney Furniture Kit ve Mini Characters (CC0) — https://kenney.nl (`public/assets/*`)
- Three.js r160 (MIT) — `public/vendor/`
