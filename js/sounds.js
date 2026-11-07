// Cabin radio and sound layers (kabin.html, Phase 11): data only, no text. Track titles and the artist are proper names
// and stay as published; labels live in js/i18n.js (kab.audio.*), credits in cred.cabin.* (Kaynakça > Kabin).
// Files: audio/cabin/{music,space}/<id>.webm (Opus) and .mp3, made by tools/cabin-audio/encode.js from the sources below
// (loudness-matched: music −16 LUFS, space −20 LUFS; nothing else changed). dur: seconds, from the encoded file.
//
// music: chosen by listening (9 tracks 2026-10-25, 40 more 2026-11-07); lic: 'cc0' (public domain dedication; credited
//   anyway) or 'ccby' (CC BY 4.0: the artist and the licence are shown while the track plays and in the Sources window).
//   Each source file's SHA-1 is in tools/cabin-audio/encode.js; src: the page it came from (SND_SRC).
//   HoliznaCC0, CC0 1.0, OpenGameArt collections posted 2024-04-11: "Chill Beats" (chill_beats.zip, SHA-1
//     baac0fd8ac9bd4476a61d689e7eb87f88f7471e2), "Happy Lo-Fi (Lofi Collection)" (happy_lo-fi_lofi_collection.zip,
//     6baaf2a60f3c6ca1acfdb4b92779b4b2c5f50fc9), "Lo-Fi and Chill (Collection)" (three zips: 1e3e0ab5…, 83d32ed6…,
//     65f380a6…) and "Sad Lo-Fi (Lofi Collectioni)" (two zips: 1b5eb95f…, fbf189b5…); 320 kb/s MP3s inside.
//   TAD, OpenGameArt (2021–2022): 8-bit lo-fi hip hop, CC BY 4.0 except Since 2 A.M. (CC0); Ooame is published under
//     both and credited as CC BY. WAV where the page offers one.
//   Single CC BY 4.0 tracks, OpenGameArt: Tsorthan Grove "Sleepy Little Mouse" (FLAC, 2022), migfus20 "Glory Hotel - Lofi"
//     (2021), marcelofg55 "Coffee Jazz Lofi" (2025), tcarisland "Diminishing Returns" (WAV, 2021; the artist asks to be
//     told of uses, not as a condition).
// space: NASA plasma-wave recordings, the audio track of two JPL Photojournal animations (JPL image use policy: images
//   and video may be used for any purpose without prior permission; no endorsement implied, no NASA/JPL logos).
//   voyager: PIA17045 "Voyager Captures Sounds of Interstellar Space" (Voyager 1 plasma wave instrument, 2012–2013),
//     PIA17045_20130906-640.mp4, SHA-1 db0ffb95fc5997769c25570ecef63e6067d74f40; credit NASA/JPL-Caltech/University of Iowa.
//   juno: PIA25030 "Audio of Juno's Ganymede Flyby" (Waves instrument, 7 June 2021, shifted into the audible band),
//     PIA25030.mov, SHA-1 788b452284256a3705bbb3a272ce0854f40b89d0; credit NASA/JPL-Caltech/SwRI/Univ of Iowa.
const MUSIC = [
  { id: 'families', title: 'Families', artist: 'holizna', album: 'chill', lic: 'cc0', src: 'chill', dur: 144.01 },
  { id: 'opinions', title: 'Opinions', artist: 'holizna', album: 'chill', lic: 'cc0', src: 'chill', dur: 167.96 },
  { id: 'old-age', title: 'Old Age', artist: 'holizna', album: 'chill', lic: 'cc0', src: 'chill', dur: 213.90 },
  { id: 'dream-pop', title: 'Dream Pop', artist: 'holizna', album: 'chill', lic: 'cc0', src: 'chill', dur: 241.69 },
  { id: 'autumn', title: 'Autumn', artist: 'holizna', album: 'chill', lic: 'cc0', src: 'chill', dur: 169.81 },
  { id: 'poor-but-happy', title: 'Poor, But Happy', artist: 'holizna', album: 'happy', lic: 'cc0', src: 'happy', dur: 127.95 },
  { id: 'blue-skies', title: 'Blue Skies', artist: 'holizna', album: 'happy', lic: 'cc0', src: 'happy', dur: 175.57 },
  { id: 'letting-go-of-the-past', title: 'Letting Go Of The Past', artist: 'holizna', album: 'happy', lic: 'cc0', src: 'happy', dur: 179.58 },
  { id: 'happy-but-a-little-off', title: 'Happy, but a little off', artist: 'holizna', album: 'happy', lic: 'cc0', src: 'happy', dur: 117.30 },
  // added 2026-11-07
  { id: 'first-snow', title: 'First Snow', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 174.11 },
  { id: 'laundry-on-the-wire', title: 'Laundry On The Wire', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 180.01 },
  { id: 'everything-you-ever-dreamed', title: 'Everything You Ever Dreamed', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 220.04 },
  { id: 'keeping-cool', title: 'Keeping Cool', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 153.13 },
  { id: 'windows-down', title: 'Windows Down', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 165.78 },
  { id: 'glad-to-be-stuck-inside', title: 'Glad To Be Stuck Inside', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 160.91 },
  { id: 'vintage', title: 'Vintage', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 174.01 },
  { id: 'morning-coffee', title: 'Morning Coffee', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 191.96 },
  { id: 'a-little-shade', title: 'A Little Shade', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 178.54 },
  { id: 'ghosts', title: 'Ghosts', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 90.30 },
  { id: 'whatever', title: 'Whatever', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 236.96 },
  { id: 'ramen', title: 'Ramen', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 112.90 },
  { id: 'pretty-little-lies', title: 'Pretty Little Lies', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 210.01 },
  { id: 'so-broke', title: 'So Broke', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 221.96 },
  { id: 'come-again', title: 'Come Again', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 182.96 },
  { id: 'waves', title: 'Waves', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 140.53 },
  { id: 'creature-comforts', title: 'Creature Comforts', artist: 'holizna', album: 'lofichill', lic: 'cc0', src: 'lofichill', dur: 174.82 },
  { id: 'not-it', title: 'Not It', artist: 'holizna', album: 'sad', lic: 'cc0', src: 'sad', dur: 177.34 },
  { id: 'fire-place', title: 'Fire Place', artist: 'holizna', album: 'sad', lic: 'cc0', src: 'sad', dur: 170.31 },
  { id: 'small-towns-smaller-lives', title: 'Small Towns Smaller Lives', artist: 'holizna', album: 'sad', lic: 'cc0', src: 'sad', dur: 146.05 },
  { id: 'winter-blues', title: 'Winter Blues', artist: 'holizna', album: 'sad', lic: 'cc0', src: 'sad', dur: 223.45 },
  { id: 'all-the-way-sad', title: 'All The Way Sad', artist: 'holizna', album: 'sad', lic: 'cc0', src: 'sad', dur: 186.30 },
  { id: 'shut-up-or-shut-in', title: 'Shut up, or shut in', artist: 'holizna', album: 'sad', lic: 'cc0', src: 'sad', dur: 119.96 },
  { id: 'yesterday', title: 'Yesterday', artist: 'holizna', album: 'sad', lic: 'cc0', src: 'sad', dur: 150.80 },
  { id: 'cellar-door', title: 'Cellar Door', artist: 'holizna', album: 'sad', lic: 'cc0', src: 'sad', dur: 132.37 },
  { id: 'mixed-signals', title: 'Mixed Signals', artist: 'holizna', album: 'sad', lic: 'cc0', src: 'sad', dur: 109.33 },
  { id: 'static', title: 'Static', artist: 'holizna', album: 'sad', lic: 'cc0', src: 'sad', dur: 149.10 },
  { id: 'cold-lake', title: 'Cold Lake', artist: 'tad', album: null, lic: 'ccby', src: 'oga-cold-lake', dur: 223.01 },
  { id: 'thawing-village', title: 'Thawing Village', artist: 'tad', album: null, lic: 'ccby', src: 'oga-thawing-village', dur: 298.70 },
  { id: 'rainy-village', title: 'Rainy Village', artist: 'tad', album: null, lic: 'ccby', src: 'oga-rainy-village', dur: 243.11 },
  { id: 'unbounded-daydream', title: 'Unbounded Daydream', artist: 'tad', album: null, lic: 'ccby', src: 'oga-unbounded-daydream', dur: 296.71 },
  { id: '6-am-riverside-town', title: '6 A.M. Riverside Town', artist: 'tad', album: null, lic: 'ccby', src: 'oga-6-am-riverside-town', dur: 297.31 },
  { id: 'remnants-of-the-festival', title: 'Remnants of the Festival', artist: 'tad', album: null, lic: 'ccby', src: 'oga-remnants-of-the-festival', dur: 206.11 },
  { id: 'arukas-bloom', title: 'Arukas Bloom', artist: 'tad', album: null, lic: 'ccby', src: 'oga-arukas-bloom', dur: 268.31 },
  { id: 'since-2-am', title: 'Since 2 A.M.', artist: 'tad', album: null, lic: 'cc0', src: 'oga-since-2-am', dur: 291.01 },
  { id: 'ooame', title: 'Ooame', artist: 'tad', album: null, lic: 'ccby', src: 'oga-ooame', dur: 254.21 },
  { id: 'sleepy-little-mouse', title: 'Sleepy Little Mouse', artist: 'grove', album: null, lic: 'ccby', src: 'oga-sleepy-little-mouse', dur: 180.01 },
  { id: 'glory-hotel', title: 'Glory Hotel', artist: 'migfus', album: null, lic: 'ccby', src: 'oga-glory-hotel-lofi', dur: 154.11 },
  { id: 'coffee-jazz-lofi', title: 'Coffee Jazz Lofi', artist: 'marcelo', album: null, lic: 'ccby', src: 'oga-coffee-jazz-lofi', dur: 184.54 },
  { id: 'diminishing-returns', title: 'Diminishing Returns', artist: 'tcar', album: null, lic: 'ccby', src: 'oga-diminishing-returns', dur: 318.81 },
];
// artists as published (proper names); albums: the collections' published names (single tracks have none)
const MUSIC_ARTISTS = { holizna: 'HoliznaCC0', tad: 'TAD', grove: 'Tsorthan Grove', migfus: 'migfus20', marcelo: 'marcelofg55', tcar: 'tcarisland' };
const MUSIC_ALBUM = { chill: 'Chill Beats', happy: 'Happy Lo-Fi', lofichill: 'Lo-Fi and Chill', sad: 'Sad Lo-Fi' };
const SPACE_SND = [
  { id: 'voyager', dur: 61.41, credit: 'NASA/JPL-Caltech/University of Iowa', src: 'pia17045' },
  { id: 'juno', dur: 48.98, credit: 'NASA/JPL-Caltech/SwRI/Univ of Iowa', src: 'pia25030' },
];
const SND_SRC = {
  chill: 'https://opengameart.org/content/chill-beats-collection',
  happy: 'https://opengameart.org/content/happy-lo-fi-lofi-collection',
  lofichill: 'https://opengameart.org/content/lo-fi-and-chill-collection',
  sad: 'https://opengameart.org/content/sad-lo-fi-lofi-collectioni',
  holizna: 'https://holiznacc0.bandcamp.com',
  'oga-cold-lake': 'https://opengameart.org/content/cold-lake',
  'oga-thawing-village': 'https://opengameart.org/content/thawing-village',
  'oga-rainy-village': 'https://opengameart.org/content/rainy-village',
  'oga-unbounded-daydream': 'https://opengameart.org/content/unbounded-daydream',
  'oga-6-am-riverside-town': 'https://opengameart.org/content/6-am-riverside-town',
  'oga-remnants-of-the-festival': 'https://opengameart.org/content/remnants-of-the-festival',
  'oga-arukas-bloom': 'https://opengameart.org/content/arukas-bloom',
  'oga-since-2-am': 'https://opengameart.org/content/since-2-am',
  'oga-ooame': 'https://opengameart.org/content/ooame',
  'oga-sleepy-little-mouse': 'https://opengameart.org/content/sleepy-little-mouse',
  'oga-glory-hotel-lofi': 'https://opengameart.org/content/glory-hotel-lofi',
  'oga-coffee-jazz-lofi': 'https://opengameart.org/content/coffee-jazz-lofi',
  'oga-diminishing-returns': 'https://opengameart.org/content/diminishing-returns',
  cc0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  ccby: 'https://creativecommons.org/licenses/by/4.0/',
  pia17045: 'https://science.nasa.gov/photojournal/voyager-captures-sounds-of-interstellar-space/',
  pia25030: 'https://science.nasa.gov/photojournal/audio-of-junos-ganymede-flyby/',
  jpl: 'https://www.jpl.nasa.gov/jpl-image-use-policy/',
};

if (typeof module !== 'undefined') module.exports = { MUSIC, MUSIC_ARTISTS, MUSIC_ALBUM, SPACE_SND, SND_SRC };
