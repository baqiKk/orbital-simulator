# Site simgeleri (tools/icons)

Kaynaklar elle çizilmiş iki SVG (depo kökünde): `favicon.svg` (ana site: koyu disk, halkalı gezegen, kesik çizgili transfer yörüngesi, araç noktası) ve `favicon-kabin.svg` (kabin: pirinç lomboz, içinde küçük gezegen, önünde beyaz kedinin kulakları). Renkler `css/style.css` token'larından. İki SVG de boyuta göre sadeleşir (SVG içinde `@media (max-width: …)`): 40 px'e kadar uzun kesikler, sekme boyutunda (≤ 24 px) kesik ve ince ayrıntı yok, çizgiler kalın.

`render.js` PNG'leri bu SVG'lerden üretir:

| Dosya | Boyut | Not |
| --- | --- | --- |
| `favicon-32.png` | 32 × 32 | saydam, SVG desteklemeyen tarayıcılar için |
| `apple-touch-icon.png` | 180 × 180 | saydam değil (`--bg`), kenar boşluklu |
| `icon-192.png`, `icon-512.png` | 192, 512 | `site.webmanifest`, "any maskable": disk %80 güvenli bölgenin içinde |
| `favicon-kabin-32.png`, `apple-touch-icon-kabin.png` | 32, 180 | kabin sayfaları |

## Çalıştırma

Playwright depoya girmez; depo dışında geçici bir klasöre kurulur (WebKit yeterli):

```bash
mkdir -p /tmp/icons && cd /tmp/icons && npm i playwright-core@1.49.1 && npx playwright-core install webkit
cp <depo>/tools/icons/render.js . && node render.js <depo> /tmp/icons
```

İkinci argüman verilirse o klasöre `icons-preview.png` da yazılır: 16, 32 ve 180 px, koyu ve açık sekme zemininde.
