# Yörünge Transfer Simülatörü

Gök cisimlerini ve kalkış yanmasını seçip yörünge transferini tarayıcıda hesaplayan ve oynatan simülatör. İki model var: gerçek tarihli 3B güneş sistemi (JPL Kepler elemanları, 1800–2050) ve basitleştirilmiş dairesel/düzlemsel model. Dünya–Ay serbest dönüş (8 / S biçimi), Ay'a yörüngeye giriş, Dünya–Mars (2026 penceresi dahil) ve Ay–Mars transferleri, Dünya–Venüs geçişi, Ganymede–Callisto transferi hazır gelir.

## Görünüm modları
Düşük kaynak 2B, Normal 2B ve 3B. 3B görünüm [Three.js](https://threejs.org/) (r186, MIT lisansı, `vendor/three/`) kullanır ve yalnızca 3B seçildiğinde yüklenir; WebGL 2 gerekir. Normal 2B ve 3B modlarda gezegenler yalnızca gerçek gözlem verisinden (NASA, USGS, PDS) dokularla çizilir (`img/planets/`): yaklaştıkça daha keskin dokular (2B'de 2048, 3B'de 4096 piksele kadar), Ay, Mars ve Merkür'de abartısız kabartma ve krater gölgeleri, Dünya'da bulutlar, şehir ışıkları ve okyanus yansıması, Venüs ve Titan'da puslu kenar, Satürn halkalarında Voyager ölçümlerinden saydamlık; arka planda gerçek yıldız haritası (`img/sky/`). Kaynaklar, krediler ve kullanım koşulları sitedeki Kaynakça penceresinde. Düşük kaynak modu hiçbir görsel indirmez; yavaş cihazlarda efektler sırayla kapanır. Site NASA ya da başka bir kurumla bağlantılı değildir.

## Yerelde çalıştırma
Çözücü Web Worker kullandığı için dosyayı çift tıklayıp açmak yerine küçük bir sunucuyla aç:

```bash
python -m http.server 8000
# sonra tarayıcıda: http://localhost:8000
```

VS Code kullanıyorsan "Live Server" eklentisi de olur.

## Testler
```bash
node tests/core.test.js
node tests/ui.test.js
```

## Yayına alma (GitHub Pages)
1. Depoyu GitHub'a gönder.
2. Depo → **Settings → Pages** → Source: **Deploy from a branch**, Branch: `main`, klasör: `/ (root)` → Save.
3. Birkaç dakika sonra site `https://<kullanıcı-adın>.github.io/<depo-adı>/` adresinde yayında olur. Her `git push` siteyi günceller.

## Model
Kısıtlı N-cisim, 3B: cisimler analitik ilerler (gerçek modelde JPL Kepler elemanları, basitleştirilmiş modelde dairesel düzlemsel yörüngeler), yalnızca araç sayısal entegre edilir (Dormand–Prince 5(4)). Yanmalar anlıktır, atmosfer modellenmez. Kaynaklar `js/bodies.js`, ayrıntılar `CLAUDE.md` içinde.
