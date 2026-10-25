# Uçuş planları (tools/flight-plans)

`build.js`, kabindeki pomodoronun uçuş planları için yörüngeleri `js/core.js` ile hesaplar ve `js/flightdata.js` dosyasını (`FLIGHT_DATA`) yazar. Planların tanımı (hangi senaryo, hangi uydular, irtifalar, bakış) `js/flightplans.js` içindeki `FLIGHT_PLANS`'ta.

- **Dünya–Ay serbest dönüş** ve **Mars seyri:** simülatörün `r_em_free` ve `r_e_mars` senaryoları, uygulamanın yaptığı gibi simüle edilir (`js/app.js` `SCENARIOS`'tan okunur).
- **Satürn uyduları** ve **Jüpiter sistemi:** her bacak bir önceki varıştan sonra (ilki planın tarihinden) iki sinodik dönem × 0,5–1,6 Hohmann süresi ızgarasında en düşük Δv'li Lambert yayıyla başlar; N-cisimde `lambertSeed` + `refineSeed` ile hedef yörüngeye yakalanacak biçimde düzeltilir. Periapsis 1 km'den fazla sapan aday atlanır, sıradakine geçilir.

Her iz, entegratörün kendi noktalarından seçilir: bir nokta, komşuları arasındaki kübik Hermite ara değeri atılan her noktayı en yakın cisme uzaklığın 2·10⁻⁵'i içinde verdiği sürece atılır. Konumlar 1 m'ye, hızlar 0,1 mm/s'ye, zamanlar 1 ms'ye yuvarlanır.

## Çalıştırma

Bağımlılık yok; birkaç saniye sürer.

```bash
node tools/flight-plans/build.js
```

`js/core.js`'te fiziği değiştiren bir değişiklikten sonra yeniden çalıştırılmalı: `tests/core.test.js` her izi kayıtlı görevden yeniden simüle eder, noktalar tutmazsa test düşer.
