# Sürüm notu görselleri (tools/changelog)

"Yenilikler" penceresindeki (js/changelog.js) öne çıkan görsel, sitenin kendi ekran görüntüsüdür; `img/changelog/<sürüm>.jpg`. Elle düzenlenmez, `shot.js` üretir: başlangıç ekranından "Kendin uç" → Dünya (400 km), araca yaklaşma, tam gaz; arayüz gizli, yalnızca sahne (sol çubuk dışarıda), 1040 × 585 CSS px, 1,5×, JPEG kalite 80. Boyutu `CHANGELOG[].size` alanına yazılır.

## Çalıştırma

Playwright depoya girmez (bkz. `tests/smoke.js`); site herhangi bir statik sunucuyla açılır:

```bash
npm i --prefix <klasör> playwright@1.49.1 && <klasör>/node_modules/.bin/playwright install chromium
PLAYWRIGHT_MODULE=<klasör>/node_modules/playwright node tools/changelog/shot.js http://localhost:8765/ img/changelog/0.9.jpg
```

Yeni sürümün görseli için betiğe o sürümün öne çıkan sahnesini ekleyip çıktıyı `img/changelog/<sürüm>.jpg` olarak kaydet.
