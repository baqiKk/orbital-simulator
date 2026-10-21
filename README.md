# Yörünge Transfer Simülatörü

Gök cisimlerini ve kalkış yanmasını seçip yörünge transferini tarayıcıda hesaplayan ve oynatan simülatör. İki model var: gerçek tarihli 3B güneş sistemi (JPL Kepler elemanları, 1800–2050) ve basitleştirilmiş dairesel/düzlemsel model. Dünya–Ay serbest dönüş (8 / S biçimi), Ay'a yörüngeye giriş, Dünya–Mars (2026 penceresi dahil) ve Ay–Mars transferleri, Dünya–Venüs geçişi, Ganymede–Callisto transferi hazır gelir.

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
