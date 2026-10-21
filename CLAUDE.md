# Yörünge Transfer Simülatörü

Tarayıcıda çalışan, düzlemsel (2B) yörünge transfer simülatörü. Kullanıcı 2–4 gök cismi seçer (kütle, yarıçap, yörünge yarıçapı, faz), bir kalkış yanması tanımlar; araç yolu hesaplanır ve video gibi oynatılır. Herkese açık statik site olarak yayınlanır (GitHub Pages).

## Kurallar
- Arayüz dili **Türkçe**. Kod, yorumlar ve commit mesajları İngilizce olabilir.
- **Build adımı yok.** Saf HTML/CSS/vanilla JS. Framework, bundler, npm bağımlılığı ekleme. Dış kaynak olarak sadece Google Fonts var.
- Fizik `js/core.js` içinde kalır ve **DOM'a dokunmaz**: hem sayfada, hem Web Worker'da (`importScripts`), hem Node testlerinde çalışmalı.
- Fizikte değişiklik yaptıktan sonra `node tests/core.test.js` çalıştır; yeni davranış için test ekle.
- Tarayıcı yükü düşük kalmalı: kare başına iş O(çizilen nokta). Ağır hesap (çözücü) Web Worker'da.
- Yörünge noktası adları cisme göre: Dünya perigee/apogee, Ay perilune/apolune, Güneş perihelion/aphelion, Mars periareion, Venüs pericytherion, Jüpiter perijove; diğerleri periapsis. `app.js` içindeki `APSIS` tablosunu kullan.
- Tek tema: koyu uzay. Renkler `css/style.css` başındaki `:root` token'larında; yeni renk ekleme, token kullan.
- Mobil (≈400 px) genişlikte de çalışmalı; yatay sayfa kaydırması olmamalı.

## Dosyalar
- `index.html` — işaretleme (panel, sahne, HUD, zaman çizelgesi, sözlük paneli).
- `css/style.css` — tüm stiller.
- `js/core.js` — fizik:
  - `buildSystem(list)`: cisim hiyerarşisi (her cisim bir ebeveyn etrafında dairesel Kepler yörüngesinde; tek kök sabit merkez). Ağırlık merkezleri korunur. SOI = a·(m/M)^0.4.
  - `states(s, t, P, V)`: t anında tüm cisimlerin konum/hızı (analitik).
  - `simulate(s, M, opts)`: araç için Dormand–Prince 5(4) uyarlamalı entegrasyon. Olaylar: kalkış yanması, hedef periapsisi (SOI içinde), yakalama yanması (capture modunda), dönüş periapsisi, çarpma. Serbest dönüşte dönüş periapsisinde durur (atmosfer girişi varsayımı).
  - `hohmannGuess(s, M)`: patched-conic başlangıç tahmini (iç hedef / ebeveyne dönüş / kardeş cisimler, iç içe kalkış).
  - `optimize(s, M, opt)`: açı taraması + Levenberg–Marquardt; θ, Δv ve (gezegenler arası ise) t₀ üzerinde. Hedefler: hedef periapsis irtifası (isteğe bağlı prograd/retrograd), serbest dönüşte dönüş irtifası.
- `js/app.js` — arayüz, hazır senaryolar (`SCENARIOS`), cisim önayarları (`BODY_PRESETS`), görünüm çerçeveleri (eylemsiz / A / B / dönen A–B), canvas çizimi, zaman çizelgesi, sözlük (`GLOSS`), çözücü worker'ı.
- `tests/core.test.js` — fizik regresyon testleri (Node, bağımlılıksız).

## Model varsayımları
Düzlemsel, dairesel cisim yörüngeleri, anlık yanmalar, kısıtlı N-cisim (araç cisimleri çekmez), atmosfer yok. Yakalamadan sonraki tur animasyonu analitik dairesel iki-cisimdir.

## Yol haritası (sırayla)
1. **"Atmosfer yok, devam et" seçeneği:** Dönüş periapsisi atmosferin üstündeyse simülasyon durmasın; sonraki (kaotik) karşılaşmalar görünsün. Süre sınırı ve çarpma/kaçış olayları korunmalı.
2. **Dünya–Ay cycler senaryosu:** Çözücü, dönen çerçevede kendini tekrarlayan periyodik yörüngeyi bulsun (ör. başlangıç durumu = N tur sonraki durum). Gerekirse tur başına küçük düzeltme yanması, Δv bütçesi sonuçlarda gösterilsin.
3. Yayın: GitHub Pages, `README.md` içindeki adımlar.
Sonrası için fikirler: eliptik/eğik yörüngeler, gerçek efemeris tarihleri, sonlu süreli yanma (düşük itki), 3B görünüm, URL ile senaryo paylaşma.
