# Yörünge Transfer Simülatörü

Gök cisimlerini ve kalkış yanmasını seçip yörünge transferini tarayıcıda hesaplayan ve oynatan simülatör. Dünya–Ay serbest dönüş (8 / S biçimi), Ay'a yörüngeye giriş, Dünya–Mars ve Ay–Mars Hohmann transferleri, Dünya–Venüs geçişi hazır gelir.

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
```

## Yayına alma (GitHub Pages)
1. Depoyu GitHub'a gönder.
2. Depo → **Settings → Pages** → Source: **Deploy from a branch**, Branch: `main`, klasör: `/ (root)` → Save.
3. Birkaç dakika sonra site `https://<kullanıcı-adın>.github.io/<depo-adı>/` adresinde yayında olur. Her `git push` siteyi günceller.

## Model
Düzlemsel kısıtlı N-cisim: cisimler dairesel Kepler yörüngelerinde analitik ilerler, yalnızca araç sayısal entegre edilir (Dormand–Prince 5(4)). Yanmalar anlıktır, atmosfer modellenmez. Ayrıntılar `CLAUDE.md` içinde.
