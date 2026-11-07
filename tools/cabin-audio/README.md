# Kabin radyosu (tools/cabin-audio)

`encode.js`, kabinin lo-fi radyosu için seçilen parçaları ve iki NASA plazma dalgası kaydını sitenin çaldığı dosyalara çevirir:

- `audio/cabin/music/<id>.webm` (Opus 64 kb/s, stereo) ve `.mp3` (96 kb/s, Opus çalamayan tarayıcılar için): ses yüksekliği −16 LUFS'e eşitlenir (EBU R128, iki geçişli `loudnorm`, gerçek tepe −1,5 dBTP).
- `audio/cabin/space/<id>.webm` (Opus 48 kb/s, mono) ve `.mp3` (64 kb/s): videonun yalnızca ses izi, −20 LUFS.

Biçim dönüşümü ve ses yüksekliği eşitlemesi dışında hiçbir değişiklik yapılmaz. Parça listesi, sanatçılar, lisanslar, süreler ve kaynaklar `js/sounds.js`'te.

## Çalıştırma

ffmpeg projeye bağımlılık olarak eklenmez; depo dışında geçici bir klasöre kurulur. Betik `ffmpeg-static`'i çalıştırıldığı klasörden yükler.

```bash
mkdir -p /tmp/cabin-audio && cd /tmp/cabin-audio && npm i ffmpeg-static@5.2.0
node <depo>/tools/cabin-audio/encode.js --chill <dir> --happy <dir> --lofichill <dir> --sad <dir> --tad <dir> --ccby <dir> --milkyway <dir> --nasa <dir> --out <depo>/audio/cabin
```

Var olan çıktılar korunur (yanlışlıkla yeniden kodlanmaz); yeniden kodlamak için `--force`. Klasörü verilmeyen kaynak atlanır, yani yalnızca yeni bir koleksiyonun klasörünü vermek yeter. `--json <dosya>` kodlanan parçaların sürelerini yazar (`js/sounds.js` için).

## Girdiler

Her kaynak dosyanın SHA-1'i `encode.js` içinde denetlenir; başka bir dosya verilirse betik durur.

- **HoliznaCC0** (CC0 1.0, OpenGameArt koleksiyonları). Zip'leri açın; aynı koleksiyonun zip'leri tek klasöre açılır (içlerindeki klasör adları farklıdır).
  - `--chill` [Chill Beats](https://opengameart.org/content/chill-beats-collection): `chill_beats.zip`, SHA-1 `baac0fd8ac9bd4476a61d689e7eb87f88f7471e2`.
  - `--happy` [Happy Lo-Fi](https://opengameart.org/content/happy-lo-fi-lofi-collection): `happy_lo-fi_lofi_collection.zip`, SHA-1 `6baaf2a60f3c6ca1acfdb4b92779b4b2c5f50fc9`.
  - `--lofichill` [Lo-Fi and Chill](https://opengameart.org/content/lo-fi-and-chill-collection): `lo-fi_and_chill_lofi_collection.zip` (`1e3e0ab5a0c17285a3c6b3ed87c1598f7f1eb7c7`), `_2.zip` (`83d32ed67fcfe34534f33e3fd90f2e86ef97b7c6`), `_3.zip` (`65f380a66be4095819bf0b773e574b0d1f7a0e1f`).
  - `--sad` [Sad Lo-Fi](https://opengameart.org/content/sad-lo-fi-lofi-collectioni): `sad_lofi_1.zip` (`1b5eb95fc93e8ac271ceb2d6c0708e32af9e63b2`), `sad_lofi_2.zip` (`fbf189b543073f543eab57ed8b658864d787bfe0`).
- **`--milkyway`**: HoliznaCC0, "Only In The Milky Way" (Free Music Archive, CC0 1.0, her parçanın sayfasında doğrulandı): Part [1](https://freemusicarchive.org/music/holiznacc0/only-in-the-milky-way-part-1), [2](https://freemusicarchive.org/music/holiznacc0/only-in-the-milky-way-part-2), [3](https://freemusicarchive.org/music/holiznacc0/only-in-the-milky-way-part-3). FMA'dan indirilen MP3'ler tek klasörde (`HoliznaCC0 - <Ad>.mp3`).
- **`--tad`**: TAD'ın OpenGameArt parçaları, sayfalarındaki dosya adlarıyla tek klasörde (WAV yayımlanmışsa WAV). Since 2 A.M. CC0; diğerleri CC BY 4.0 (Ooame CC BY 4.0 / CC0, CC BY olarak atfedilir).
- **`--ccby`**: tek parçalar, CC BY 4.0, OpenGameArt: Tsorthan Grove `sleepy_little_mouse.flac`, migfus20 `55._guitar_2.mp3`, marcelofg55 `coffee_jazz_lofi.zip` (açılmış: `Coffee Jazz Lofi.mp3`; zip SHA-1 `d842cbc75702fc19f6f1a67e20f6b7ed1f2b67f8`), tcarisland `diminishingreturnsinstr.wav`.
- **NASA** (`--nasa`): JPL Photojournal animasyonları, ikisi aynı klasörde.
  - [PIA17045](https://science.nasa.gov/photojournal/voyager-captures-sounds-of-interstellar-space/): `PIA17045_20130906-640.mp4`.
  - [PIA25030](https://science.nasa.gov/photojournal/audio-of-junos-ganymede-flyby/): `PIA25030.mov`.

İlk 9 parça 2026-10-25'te, eklenen 40 parça 2026-11-07'de, 7 parça 2026-11-08'de yerel bir önizleme sayfasında dinlenerek seçildi.
