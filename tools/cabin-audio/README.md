# Kabin radyosu (tools/cabin-audio)

`encode.js`, kabinin lo-fi radyosu için seçilen HoliznaCC0 parçalarını ve iki NASA plazma dalgası kaydını sitenin çaldığı dosyalara çevirir:

- `audio/cabin/music/<id>.webm` (Opus 64 kb/s, stereo) ve `.mp3` (96 kb/s, Opus çalamayan tarayıcılar için): ses yüksekliği −16 LUFS'e eşitlenir (EBU R128, iki geçişli `loudnorm`, gerçek tepe −1,5 dBTP).
- `audio/cabin/space/<id>.webm` (Opus 48 kb/s, mono) ve `.mp3` (64 kb/s): videonun yalnızca ses izi, −20 LUFS.

Biçim dönüşümü ve ses yüksekliği eşitlemesi dışında hiçbir değişiklik yapılmaz. Parça listesi, süreler ve kaynaklar `js/sounds.js`'te.

## Çalıştırma

ffmpeg projeye bağımlılık olarak eklenmez; depo dışında geçici bir klasöre kurulur. Betik `ffmpeg-static`'i çalıştırıldığı klasörden yükler.

```bash
mkdir -p /tmp/cabin-audio && cd /tmp/cabin-audio && npm i ffmpeg-static@5.2.0
node <depo>/tools/cabin-audio/encode.js --chill "<Chill Beats klasörü>" --happy "<Happy Lo-Fi klasörü>" --nasa <NASA klasörü> --out <depo>/audio/cabin
```

## Girdiler

- **Müzik:** HoliznaCC0, CC0 1.0, OpenGameArt'tan iki koleksiyon. Zip'leri açıp klasörleri `--chill` ve `--happy` ile verin.
  - [Chill Beats](https://opengameart.org/content/chill-beats-collection): `chill_beats.zip`, SHA-1 `baac0fd8ac9bd4476a61d689e7eb87f88f7471e2`.
  - [Happy Lo-Fi](https://opengameart.org/content/happy-lo-fi-lofi-collection): `happy_lo-fi_lofi_collection.zip`, SHA-1 `6baaf2a60f3c6ca1acfdb4b92779b4b2c5f50fc9`.
- **NASA:** JPL Photojournal animasyonları. İkisi aynı klasörde olmalı, `--nasa` ile verilir.
  - [PIA17045](https://science.nasa.gov/photojournal/voyager-captures-sounds-of-interstellar-space/): `PIA17045_20130906-640.mp4`.
  - [PIA25030](https://science.nasa.gov/photojournal/audio-of-junos-ganymede-flyby/): `PIA25030.mov`.

Her kaynak dosyanın SHA-1'i `encode.js` içinde denetlenir; başka bir dosya verilirse betik durur. Seçilen 9 parça, 2026-10-25'te yerel bir önizleme sayfasında dinlenerek belirlendi.
