# Site simgeleri (tools/icons)

Kaynaklar elle çizilmiş, düz renkli iki SVG (depo kökünde): `favicon.svg` (ana site: yuvarlak köşeli koyu kare `#0b1116`, yarısı gölgeli mavi gezegen, arkasından ve önünden geçen amber yörünge, önde beyaz dört köşeli parıltı (araç), köşede küçük yıldız; geometri ve renkler sabit) ve `favicon-kabin.svg` (kabin: aynı kare ve renkler, sert gölgeli pirinç lomboz, camında aynı gezegen ve yörünge, önünde beyaz kedinin kulakları; gradyan ve parlama yok). Diğer renkler `css/style.css` token'larından. İki SVG de sekme boyutunda (≤ 24 px, SVG içinde `@media (max-width: 24px)`) sadeleşir: köşedeki yıldız ve perçinler kalkar, yörünge ve çerçeve kalınlaşır.

`render.js` PNG'leri bu SVG'lerden üretir:

| Dosya | Boyut | Not |
| --- | --- | --- |
| `favicon-32.png` | 32 × 32 | saydam, SVG desteklemeyen tarayıcılar için |
| `apple-touch-icon.png` | 180 × 180 | saydam değil, karenin renginde tam boy (köşeleri iOS yuvarlar) |
| `icon-192.png`, `icon-512.png` | 192, 512 | `site.webmanifest`, "any maskable": karenin renginde, yörüngenin uçları güvenli dairenin (%40 yarıçap) içinde (%88 ölçek) |
| `favicon-kabin-32.png`, `apple-touch-icon-kabin.png` | 32, 180 | kabin sayfaları |

## Çalıştırma

Playwright depoya girmez; depo dışında geçici bir klasöre kurulur (WebKit yeterli):

```bash
mkdir -p /tmp/icons && cd /tmp/icons && npm i playwright-core@1.49.1 && npx playwright-core install webkit
cp <depo>/tools/icons/render.js . && node render.js <depo> /tmp/icons
```

İkinci argüman verilirse o klasöre `icons-preview.png` da yazılır: 16, 32 ve 180 px, koyu ve açık sekme zemininde.
