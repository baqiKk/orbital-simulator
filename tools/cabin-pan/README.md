# Kabinde kaydırma bellek denemesi (tools/cabin-pan)

`pan50.js`, kabini WebKit'te iPhone 13 öykünmesiyle açar ve odayı sayfanın okuduğu biçimde yapay dokunma işaretçisi olaylarıyla kaydırır: N yavaş sürükleme, hızlı fırlatmalar (40 ms'de 300 px), kenara çarpan fırlatmalar (esneme ve geri yaylanma), birbirinin atalet kaymasını yakalayan art arda N hızlı fırlatma. Bunların arasında görünüm yüksekliğini indirip kaldırır; Safari'nin araç çubuğu böyle davranır, testte bu hem kaydırma sırasında hem dururken yapılır. Ardından telefonu döndürür ve iki kez cama gidip masaya döner. `?debug=1` ile açılan sayfanın `CVS` sayaçlarını okur (`js/cabin.js`: o ana kadar ayrılmış toplam tuval alanı, yeniden boyutlandırma, `layout`, `place`, `sizeLife`, çözme ve kaydırma evrelerinde olanlar `dur`) ve şunları denetler:

- Kaydırma adımlarında hiçbir tuval ayrılmıyor ya da yeniden boyutlanmıyor; `layout`, `sizeLife` ve görsel çözme yok.
- Yükseklik değişimi (genişlik aynı) yalnızca yeniden konumlandırıyor (`place`): `layout` yok, tuval boyutlandırma yok. Tam `layout` yalnızca döndürmede.
- Sürüklerken sahne `translate3d` ile kayıyor.
- Bırakınca dönüşüm 2B ve tam pikselde, kaydırma aralığın içinde.
- Geçiş tuvalleri (`kMoveA`, `kMoveB`) telefonda bir kez ayrılıyor; ikinci gidiş-dönüşte sayıları artmıyor.

Sayfa hatası ya da başarısız denetim varsa çıkış kodu 1 olur.

## Çalıştırma

Playwright projeye bağımlılık olarak eklenmez; depo dışında geçici bir klasöre kurulur. Betik, Playwright'ı çalıştırıldığı klasörden yükler. Denemeden önce yerel sunucuyu başlat (`npx serve` ya da başka bir yerel sunucu).

```bash
mkdir -p /tmp/cabin-pan && cd /tmp/cabin-pan && npm i playwright@1.49.1 && npx playwright install webkit
cp <depo>/tools/cabin-pan/pan50.js . && node pan50.js "http://localhost:8765/kabin.html?debug=1" 50
node pan50.js "http://localhost:8765/kabin.html?debug=1" 50 1   # güvenlik ağının hafif modu (önceki açılış çökmüş sayılır)
```

Öykünme gerçek iOS Safari'nin tuval bellek sınırını taşımaz. Betik yalnızca sayfanın kaydırma sırasında tuval ayırmadığını gösterir; gerçek cihazda son denetim yine iPhone'da yapılır.
