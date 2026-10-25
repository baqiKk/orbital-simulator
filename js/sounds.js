// Cabin radio and sound layers (kabin.html, Phase 11): data only, no text. Track titles and the artist are proper names
// and stay as published; labels live in js/i18n.js (kab.audio.*), credits in cred.cabin.* (Kaynakça > Kabin).
// Files: audio/cabin/{music,space}/<id>.webm (Opus) and .mp3, made by tools/cabin-audio/encode.js from the sources below
// (loudness-matched: music −16 LUFS, space −20 LUFS; nothing else changed). dur: seconds, from the encoded file.
//
// music: HoliznaCC0, CC0 1.0 (public domain dedication; no credit required, credited anyway). Chosen by listening from
//   two OpenGameArt collections (posted 2024-04-11): "Chill Beats" (chill_beats.zip, SHA-1
//   baac0fd8ac9bd4476a61d689e7eb87f88f7471e2) and "Happy Lo-Fi (Lofi Collection)" (happy_lo-fi_lofi_collection.zip, SHA-1
//   6baaf2a60f3c6ca1acfdb4b92779b4b2c5f50fc9); 320 kb/s MP3s inside, each source file's SHA-1 in encode.js.
// space: NASA plasma-wave recordings, the audio track of two JPL Photojournal animations (JPL image use policy: images
//   and video may be used for any purpose without prior permission; no endorsement implied, no NASA/JPL logos).
//   voyager: PIA17045 "Voyager Captures Sounds of Interstellar Space" (Voyager 1 plasma wave instrument, 2012–2013),
//     PIA17045_20130906-640.mp4, SHA-1 db0ffb95fc5997769c25570ecef63e6067d74f40; credit NASA/JPL-Caltech/University of Iowa.
//   juno: PIA25030 "Audio of Juno's Ganymede Flyby" (Waves instrument, 7 June 2021, shifted into the audible band),
//     PIA25030.mov, SHA-1 788b452284256a3705bbb3a272ce0854f40b89d0; credit NASA/JPL-Caltech/SwRI/Univ of Iowa.
const MUSIC = [
  { id: 'families', title: 'Families', album: 'chill', dur: 144.01 },
  { id: 'opinions', title: 'Opinions', album: 'chill', dur: 167.96 },
  { id: 'old-age', title: 'Old Age', album: 'chill', dur: 213.90 },
  { id: 'dream-pop', title: 'Dream Pop', album: 'chill', dur: 241.69 },
  { id: 'autumn', title: 'Autumn', album: 'chill', dur: 169.81 },
  { id: 'poor-but-happy', title: 'Poor, But Happy', album: 'happy', dur: 127.95 },
  { id: 'blue-skies', title: 'Blue Skies', album: 'happy', dur: 175.57 },
  { id: 'letting-go-of-the-past', title: 'Letting Go Of The Past', album: 'happy', dur: 179.58 },
  { id: 'happy-but-a-little-off', title: 'Happy, but a little off', album: 'happy', dur: 117.30 },
];
const MUSIC_ARTIST = 'HoliznaCC0', MUSIC_LIC = 'cc0';
const MUSIC_ALBUM = { chill: 'Chill Beats', happy: 'Happy Lo-Fi' }; // the collections' published names
const SPACE_SND = [
  { id: 'voyager', dur: 61.41, credit: 'NASA/JPL-Caltech/University of Iowa', src: 'pia17045' },
  { id: 'juno', dur: 48.98, credit: 'NASA/JPL-Caltech/SwRI/Univ of Iowa', src: 'pia25030' },
];
const SND_SRC = {
  chill: 'https://opengameart.org/content/chill-beats-collection',
  happy: 'https://opengameart.org/content/happy-lo-fi-lofi-collection',
  holizna: 'https://holiznacc0.bandcamp.com',
  cc0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  pia17045: 'https://science.nasa.gov/photojournal/voyager-captures-sounds-of-interstellar-space/',
  pia25030: 'https://science.nasa.gov/photojournal/audio-of-junos-ganymede-flyby/',
  jpl: 'https://www.jpl.nasa.gov/jpl-image-use-policy/',
};

if (typeof module !== 'undefined') module.exports = { MUSIC, MUSIC_ARTIST, MUSIC_LIC, MUSIC_ALBUM, SPACE_SND, SND_SRC };
