# ROADMAP

## Genel ilkeler
- Fizik çekirdeği 3B vektörlerle çalışır; 2B modlar ekliptik düzlemine izdüşümdür. Fizik kodu çizimden tamamen ayrı kalır (DOM yok, worker ve Node testlerinde çalışır).
- Üç görünüm modu: Düşük kaynak 2B, Normal 2B, 3B. Her modda "Güneş sistemi haritası" görünümü açılabilir.
- Arayüz sade: varsayılan olarak sadece gerekenler görünür, ayrıntılar katlanır panellerde.
- Görsel dil EVE Online arayüzlerinden esinlenir ama özgündür: yarı saydam koyu paneller, ince 1px kenarlar, keskin köşeler, küçük büyük harfli başlıklar, soluk camgöbeği/beyaz tonlar ve tek bir vurgu rengi; solda dar dikey ikon çubuğu, sürüklenebilir/katlanabilir pencereler, "overview" tarzı tablolar. EVE'ye ait logo, ikon, font dosyası veya görsel varlık kullanılmaz.
- Her fazda: önce plan sun ve onay bekle; bitince test ekle, `node tests/core.test.js` çalıştır, sayfayı yerelde aç ve konsolu kontrol et, commit at ve pushla.

## Faz 1 — Arayüz yeniden tasarımı ve mod sistemi ✅ tamamlandı (2026-10-21)
- Yukarıdaki görsel dille yeniden tasarım; mevcut tüm özellikler korunur.
- Sağ üstte veya ekranın uygun bir köşesinde mod seçici: Düşük kaynak 2B / Normal 2B / 3B (3B şimdilik "yakında" olarak pasif).
- İlk açılışta Normal 2B yüklenir ve bir uyarı penceresi çıkar: "Düşük kaynak moduna geçmek ister misin?" [Düşük kaynak moduna geç] [Normal modda devam et]. İkisi de seçimi localStorage'da hatırlar (try/catch ile), bir daha sorulmaz.
- Normal modda otomatik kalite düşürme devreye girerse köşede kapatılabilir, modal olmayan öneri: "Performans düşük görünüyor. Düşük kaynak moduna geç?" [Geç] [Kapat]; oturum başına en fazla bir kez.
- Varsayılan açık pencereler: Görev (üstte kompakt senaryo seçici) ve Sonuçlar; Dünya–Ay serbest dönüşte yörüngeyi örtmez. İkon çubuğunda "Pencereleri sıfırla"; ekran boyutu değişince pencereler görünür alana çekilir. ~1100 px'ten dar masaüstünde Sonuçlar ilk açılışta katlı gelir (kayıtlı düzen varsa ona dokunulmaz).
- Düşük kaynak 2B: yıldız arka planı yok, parlama/gradyan/gölge/bulanıklık yok, piksel oranı 1, kare hızı 30 fps ile sınırlı, yörünge çizgisinde daha az nokta, HUD metni seyrek güncellenir, animasyonlu geçişler kapalı.
- Varsa önceki hata: Güneş merkezli senaryoda "Cisim ekle" ile eklenen özel cisim Güneş'in içine düşüyor; varsayılan yörünge yarıçapını makul yap. (3f95ac7'de düzeltilmişti; Faz 1'de tarayıcıda yeniden doğrulandı.)

## Faz 2 — Gerçek güneş sistemi çekirdeği (3B fizik) ✅ tamamlandı (2026-10-22)
- Durum vektörleri 3B. Gezegenler için JPL "Approximate Positions of the Planets" Kepler elemanları (J2000 + yüzyıllık değişim oranları): a, e, i, Ω, ϖ, L. Kepler denklemi çözümüyle tarih → konum/hız. Büyük uydular (Ay, Phobos, Deimos, Galile uyduları, Titan) için uygun ortalama elemanlar.
- Her cisim için eksen eğikliği, yarıçap, μ, renk; tek bir veri dosyası (js/bodies.js).
- Zaman artık gerçek tarih: tarih seçici, "Şimdi" düğmesi, hız kontrolü.
- Mevcut senaryolar "Basitleştirilmiş model (dairesel, düzlemsel)" seçeneğiyle aynen çalışmaya devam eder; mevcut testler geçer. Gerçek model için yeni testler: bilinen bir tarihte Dünya ve Mars'ın Güneş'e uzaklığı JPL değerleriyle birkaç binde bir içinde uyuşmalı.
- Uygulananlar: Tablo 1 (1800–2050, Plüton yok) ve JPL uydu ortalama elemanları (Ay ekliptiğe, diğerleri yerel Laplace düzlemine göre; ω̇ = +360°/Papsis, Ω̇ = −360°/Pnode). Kepler denklemi Newton–Raphson ile çözülür; hız konumun tam türevi. Park yörüngesi A–B görev düzleminde; gezegenler arası transferlerde çözücü düzlem dışı açı β'yı da ayarlar. 2B izdüşüm: eylemsiz görünüm ekliptiğe, iki cisimli görünümler görev düzlemine. Basitleştirilmiş model Faz 1 sonuçlarını birebir üretir (aynı adım sayısı). Yeni senaryolar: gerçek Dünya–Ay serbest dönüş, 2026 Mars penceresi, Ganymede→Callisto.
- **Kısmen yapıldı — Horizons karşılaştırması:** JPL Horizons'a bağlanılamadığı için bağımsız kontroller yapıldı (perihel/afel = a(1∓e), Mars 686,98 g ve Dünya–Ay ağırlık merkezi 365,256 g periyot, Mars 1,85° ve Ay ≈5,1° eğim, Ay 356–407 bin km, Ay ϖ periyodu 8,85 yıl, anomalistik/drakonik ay). Ayrıca tarihe bağlı gökyüzü olayları test edildi (`core.test.js` 12b; bilinen gökyüzü olayları, Horizons yerine bağımsız kontrol): Mars (2025-01-16, 2027-02-19), Satürn (2025-09-21), Jüpiter (2026-01-10) karşı konumu ve Venüs iç kavuşumu (2025-03-23) için güneş merkezli ekliptik boylamlar 0,2–0,3° içinde eşit; Dünya–Ay ağırlık merkezi günberisi 2026-01-03'te 0,98330 ± 0,0001 AU. Hâlâ bekleyen (Horizons erişimi olduğunda): birkaç tarihte Dünya ve Mars'ın Güneş uzaklığını (DE441) testlere sabit olarak ekle; `js/bodies.js`'teki uydu tablosunu https://ssd.jpl.nasa.gov/sats/elem/ ile karşılaştır. gm/yarıçap/eksen eğikliği değerleri DE440 ve IAU değerleriyle elle karşılaştırıldı, uyuşuyor.

## Faz 3 — Güneş sistemi haritası ve gezegen seçici ✅ tamamlandı (2026-10-22)
- Yan panelde "overview" tablosu: gezegenler ve uyduları, ağaç yapısında; satıra tıklayınca kalkış/hedef olarak seçilir veya görünüm o cisme ortalanır.
- Güneş sistemi haritası: tüm gezegen yörüngeleri, gerçek tarihteki konumları, logaritmik/doğrusal ölçek seçeneği, cisim etiketleri.
- Harita her üç modda açılabilir; düşük kaynak modunda sade çizim.
- Uygulananlar: "Genel bakış" penceresi (Güneş → gezegenler → uydular ağacı, uydular gezegen başına katlanır; uzaklıklar zaman çizelgesindeki tarihe göre). Kalkış/Hedef seçimi en küçük cisim listesini kurar (A, B ve ortak ataya kadar ebeveynler, en çok 4; `missionChain`), gerçek modele geçer (basit modelden gelince kalkış bugün), Hohmann tahminini uygular ve "Hedefe göre çöz" yönlendirmesi gösterir; ay–gezegen çifti dışında serbest dönüş yörüngeye girişe çevrilir. Ad tıklaması görevdeki cismi takip eder, görevde olmayanı haritada ortalar. Genel bakış ≥ 1440 px ekranlarda ilk açılışta Sonuçlar'ın altında açık gelir (kayıtlı düzene dokunulmaz). Harita (HUD "Harita" düğmesi / M tuşu) her zaman gerçek güneş sistemidir: gerçek modelde görev tarihi, basit modelde bugün + zaman çizelgesi; ayrı kamera; doğrusal ölçekte uydular yeterince yakınlaşınca görünür, logaritmik ölçek (r → AU·ln(1 + r/0,05 AU)) yalnızca gezegenler; gerçek modelde araç yolu güneş merkezli olarak bindirilir. 3B mod henüz yok; harita moddan bağımsız yazıldı.

## Faz 4 — Gezegenler arası transfer: Lambert ve porkchop
- Lambert çözücü (ör. Izzo yöntemi) core.js'te, testli.
- Porkchop grafiği: kalkış tarihi × yolculuk süresi ızgarası, toplam Δv renk haritası; hesap Web Worker'da, ızgara çözünürlüğü moda göre (düşük kaynakta seyrek).
- Grafikte bir noktaya tıklayınca görev o tarih ve süreyle kurulur, yol simülasyonda oynatılır.
- Δv dökümü: park yörüngesinden kaçış, eğim değişimi, varışta yakalama; atmosferli hedeflerde "aerofren" seçeneği. C3 ve v∞ gösterilir.

## Faz 5 — 3B mod
- Three.js, sabit sürümlü (ör. vendor/ klasörüne indirilmiş dosya). Yalnızca 3B mod seçildiğinde yüklenir; 2B modlar Three.js indirmez.
- Eğik ve eliptik yörüngeler, eksen eğikliğiyle dönen gezegen küreleri, Güneş ışığı, ekliptik ızgarası, düğüm noktaları (yükselen/alçalan düğüm) işaretleri.
- Kamera: döndürme, yakınlaştırma, cisme kilitlenme; dokunmatik destek.
- Aynı zaman çizelgesi, olay işaretleri ve HUD 3B'de de çalışır.

## Faz 6 — Dünya merkezli yörünge manevraları
- Yeni görev türü "Yörünge manevrası" (merkez cisim seçilebilir, varsayılan Dünya).
- Hohmann (LEO→MEO/GEO), bi-eliptik, eğim değişimi (ayrı veya birleşik), çok yanmalı transferler; hedef yörünge: irtifa, eksantrisite, eğim.
- Sonlu yanma modu: itki (N), Isp (s), ıslak/kuru kütle; yanma süresi, harcanan yakıt, yerçekimi kaybı ve anlık yanmaya göre fark gösterilir. Düşük itkide çok turlu spiral yükseltme.
- İsteğe bağlı J2 (basıklık) etkisi.

## Faz 7 — Önceki bekleyen maddeler
- "Atmosfer yok, devam et": dönüş periapsisi atmosferin üstündeyse simülasyon durmaz, sonraki karşılaşmalar gösterilir.
- Dünya–Ay cycler senaryosu: dönen çerçevede periyodik yörüngeyi bulan çözücü; gerekirse tur başına düzeltme yanması ve Δv bütçesi.
