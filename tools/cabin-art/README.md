# Kabin görselleri (tools/cabin-art)

`build.js`, kabin illüstrasyonunu (`master.png`) ve ondan kesilmiş kediyi (`cat.png`) kabin sayfasının katmanlarına çevirir:

- `img/cabin/<genişlik>/room.webp`: oda; cam saydam (akvaryum ve sarkan bitkinin yaprakları camın önünde kalır), kedi pervazdan silinmiş, saat ve dizüstü ekranı düz koyu, kartın ve afişlerin yazıları silinmiş, afiş paneli ve fotoğraf alanı boş, akvaryumdaki boyalı balıklar ve kabarcıklar silinmiş.
- `img/cabin/<genişlik>/body.webp`, `tail.webp`, `earL.webp`, `earR.webp`: kedinin gövdesi, kuyruğu ve kulakları (kuyruk ve kulakların kökü gövdenin altında kalır; dönme noktaları `layout.json`'da).
- `img/cabin/<genişlik>/shadow.webp`: kedinin pervaza düşen temas gölgesi (siyah, saydamlıkla).
- `img/cabin/layout.json`: tüm ölçüler (cam şekli, katmanların yeri ve boyu, saat / dizüstü / kart / afiş dörtgenleri), master pikseli (7136 × 3528) cinsinden.

Genişlik kademeleri: 1600, 2560, 3840, 7136 px.

## Çalıştırma

`sharp` projeye bağımlılık olarak eklenmez; depo dışında geçici bir klasöre kurulur. Betik `sharp`'ı çalıştırıldığı klasörden yükler.

```bash
mkdir -p /tmp/cabin-art && cd /tmp/cabin-art && npm i sharp@0.34.3
node <depo>/tools/cabin-art/build.js --in <girdi klasörü> --out <depo>/img/cabin
```

- `--in`: `master.png` ve `cat.png`'yi içeren klasör (varsayılan `img/cabin/art`; bu klasör depoya girmez, `.gitignore`'da).
- `--out`: çıktı klasörü (varsayılan `img/cabin`).
- `--preview <klasör>`: isteğe bağlı; odanın ve katmanların tam çözünürlüklü PNG'lerini de yazar.

Süre ≈ 30 s. Girdiler değişmedikçe çıktı aynıdır.

## Girdiler

| Dosya | Boyut | SHA-1 |
|---|---|---|
| `master.png` (aslında JPEG) | 7136 × 3528 | `38312f6b13321cb4084ff60ef20d5730a08962ec` |
| `cat.png` (RGBA) | 830 × 1266 | `8c34ab5d949f2c54dea007693c3e5984836dabca` |

Kabin illüstrasyonu: Ahmet Baki Kırışgil. Ölçüler bu iki dosyada yapıldı; görsel değişirse `build.js` başındaki sabitler (cam köşeleri, kedinin yeri, kesim çizgileri) yeniden ölçülmelidir.
