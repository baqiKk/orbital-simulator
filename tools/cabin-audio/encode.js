// Cabin radio pipeline (Phase 11): encodes the chosen HoliznaCC0 tracks and the two NASA plasma-wave recordings into
// what kabin.html plays: Opus in WebM (first choice) and MP3 (for browsers without Opus), loudness-matched. Not part of
// the site; needs ffmpeg (ffmpeg-static), installed outside the repo (see README.md).
//
//   node tools/cabin-audio/encode.js --chill <dir> --happy <dir> --lofichill <dir> --sad <dir> --tad <dir> --ccby <dir>
//     --nasa <dir> --out audio/cabin [--force]
//
// Music: two-pass EBU R128 loudnorm to −16 LUFS (true peak −1.5 dBTP), Opus 64 kb/s stereo, MP3 96 kb/s stereo 44.1 kHz.
// NASA: audio track only, −20 LUFS (they sit under the music), mono, Opus 48 kb/s, MP3 64 kb/s. Prints each output's
// duration and size; the source files' SHA-1s are checked so a different download is noticed. An output that exists
// already is kept (the files are never re-encoded by accident) unless --force; a collection whose folder is not given
// is skipped. --json <file> writes the encoded durations (for js/sounds.js).
'use strict';
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const { createRequire } = require('module');
const FF = createRequire(path.join(process.cwd(), 'x.js'))('ffmpeg-static');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', 'audio/cabin');
// chosen by listening (2026-10-25); [id, collection, source file, SHA-1 of the source MP3]
const MUSIC = [
  ['families', 'chill', '03 HoliznaCC0 - Families.mp3', '07e7fb9228a9b780f512ddfea727c3f34469be85'],
  ['opinions', 'chill', '05 HoliznaCC0 - Opinions.mp3', 'f9d9fcb180acf3ecd5e54b40401249a1a1c5b25e'],
  ['old-age', 'chill', '06 HoliznaCC0 - Old Age.mp3', '71cd2f3f0cc44b6e3d71c44b550b9646eb088146'],
  ['dream-pop', 'chill', '08 HoliznaCC0 - Dream Pop.mp3', 'ad19b55003e6105de53b4e8b7be5912cc603b14e'],
  ['autumn', 'chill', '28 HoliznaCC0 - Autumn.mp3', 'c01e38293c19d89e82ee09b43324b8de6d71287a'],
  ['poor-but-happy', 'happy', '01 HoliznaCC0 - Poor, But Happy.mp3', '33e3ade3ee2e62d2cbeca846069b3e3074020c75'],
  ['blue-skies', 'happy', '03 HoliznaCC0 - Blue Skies.mp3.mp3', '8fdd10a884803dd28f20876375e5336ed3aee7b7'],
  ['letting-go-of-the-past', 'happy', '16 HoliznaCC0 - Letting Go Of The Past.mp3', 'e06d139269ac1ef58a0f471f7475a361edc03c4b'],
  ['happy-but-a-little-off', 'happy', '22 HoliznaCC0 - Happy, but a little off.mp3', '0b0dc8d28837979a05a1c313711565e82efe8be9'],
  // added 2026-11-07, chosen by listening: HoliznaCC0 Lo-Fi and Chill and Sad Lo-Fi (CC0; paths inside the unzipped
  // collections), TAD and four single CC BY 4.0 tracks (OpenGameArt; WAV/FLAC where published)
  ['first-snow', 'lofichill', 'Lo-Fi And Chill (Lofi Collection)/01 HoliznaCC0 - First Snow.mp3.mp3', '3b109adba0355a352f10e01399af21f6f95f37b3'],
  ['laundry-on-the-wire', 'lofichill', 'Lo-Fi And Chill (Lofi Collection)/01 HoliznaCC0 - Laundry On The Wire.mp3.mp3', 'd93fa1138f899539c83a0fd7fdea8e59cf47061b'],
  ['everything-you-ever-dreamed', 'lofichill', 'Lo-Fi And Chill (Lofi Collection)/02 HoliznaCC0 - Everything You Ever Dreamed.mp3', '1dc5bcbd4bab3acbf3dbe1bb4428c4701ae27b19'],
  ['keeping-cool', 'lofichill', 'Lo-Fi And Chill (Lofi Collection)/02 HoliznaCC0 - Keeping Cool.mp3', '1728f32488fa0f308e4d41991f77ceed1da44cb6'],
  ['windows-down', 'lofichill', 'Lo-Fi And Chill (Lofi Collection)/02 HoliznaCC0 - Windows Down.mp3.mp3', '01d45805be91ce8b99062ed7dfe2f669e17bb195'],
  ['glad-to-be-stuck-inside', 'lofichill', 'Lo-Fi And Chill (Lofi Collection) 2/07 HoliznaCC0 - Glad To Be Stuck Inside.mp3.mp3', '849bdca6dabf9fb2c6252f09b3dace9c31c392b1'],
  ['vintage', 'lofichill', 'Lo-Fi And Chill (Lofi Collection) 2/08 HoliznaCC0 - Vintage.mp3.mp3', '5d1cc4bdd1ac994fc394a063b0a69bfdf894ecc1'],
  ['morning-coffee', 'lofichill', 'Lo-Fi And Chill (Lofi Collection) 2/09 HoliznaCC0 - Morning Coffee.mp3', '2957ad6e2f9370fba591c30cbbf6b29f83e2addf'],
  ['a-little-shade', 'lofichill', 'Lo-Fi And Chill (Lofi Collection) 2/10 HoliznaCC0 - A Little Shade.mp3', '0ca068c82bcbf99682dcd6573694f79508953747'],
  ['ghosts', 'lofichill', 'Lo-Fi And Chill (Lofi Collection) 2/12 HoliznaCC0 - Ghosts.mp3', '7cca7f1b2a971cbedf30932b2475aa15adb8c4cf'],
  ['whatever', 'lofichill', 'Lo-Fi And Chill (Lofi Collection) 2/14 HoliznaCC0 - Whatever.mp3', '0e1c45f488b054486128db5b0780616d42b30818'],
  ['ramen', 'lofichill', 'Lo-Fi And Chill (Lofi Collection) 2/20 HoliznaCC0 - Ramen.mp3.mp3', 'c408be40ade49d5c953011d46575b7316c3c69f9'],
  ['pretty-little-lies', 'lofichill', 'Lo-Fi And Chill (Lofi Collection) 3/03 HoliznaCC0 - Pretty Little Lies.mp3', 'bb60e9a9d844ed0fec5193a94be3ff5df30b620a'],
  ['so-broke', 'lofichill', 'Lo-Fi And Chill (Lofi Collection) 3/03 HoliznaCC0 - So Broke.mp3', '670ba57db0ebc75e32e4ed470e1a4b2a2cf6b0a9'],
  ['come-again', 'lofichill', 'Lo-Fi And Chill (Lofi Collection) 3/04 HoliznaCC0 - Come Again.mp3', 'ceb4fe5631ab1de5419501de41ae92219924fcf1'],
  ['waves', 'lofichill', 'Lo-Fi And Chill (Lofi Collection) 3/04 HoliznaCC0 - Waves.mp3.mp3', '5af42e07f651d7a3cea29dbb02159a184f3dffbc'],
  ['creature-comforts', 'lofichill', 'Lo-Fi And Chill (Lofi Collection) 3/23 HoliznaCC0 - Creature Comforts.mp3', '0c7649f149666939ed2147739e339b4bfae7b36b'],
  ['not-it', 'sad', 'Sad Lofi 1/01 HoliznaCC0 - Not It (Lofi).mp3.mp3', '1f754e404b66e799a3e19f08bd7ca29c20e304dc'],
  ['fire-place', 'sad', 'Sad Lofi 1/04 HoliznaCC0 - Fire Place.mp3', 'a018d1f400626834e5eda248c64f2d5417e837de'],
  ['small-towns-smaller-lives', 'sad', 'Sad Lofi 1/05 HoliznaCC0 - Small Towns Smaller Lives.mp3', '0f4c093f5688b521aedb9cceae26f005b2437974'],
  ['winter-blues', 'sad', 'Sad Lofi 1/05 HoliznaCC0 - Winter Blues.mp3', 'e4feaaa1338e10e5d7b350f32a727bfc9e4825ae'],
  ['all-the-way-sad', 'sad', 'Sad Lofi 1/11 HoliznaCC0 - All The Way Sad.mp3', '92cceecbe17edb6d85c53869b9937d0fc5f268a0'],
  ['shut-up-or-shut-in', 'sad', 'Sad Lofi 1/13 HoliznaCC0 - Shut up, or shut in.mp3', '17fcdf8c7e2f2bfb64a55ea2c47b86de0dfb4698'],
  ['yesterday', 'sad', 'Sad Lofi 1/15 HoliznaCC0 - Yesterday.mp3', '00943739981e1a8b795e72608ed4037618de48a1'],
  ['cellar-door', 'sad', 'Sad Lofi 2/17 HoliznaCC0 - Cellar Door.mp3', 'ea2dd77a4598dfefdd125ea06632ff03e66d20e3'],
  ['mixed-signals', 'sad', 'Sad Lofi 2/25 HoliznaCC0 - Mixed Signals.mp3', '43e20158506c89062edbea6bf533189332652c84'],
  ['static', 'sad', 'Sad Lofi 2/29 HoliznaCC0 - Static.mp3', '29a6f7b10c3199be02ad479e2400096f8e1cc7f3'],
  ['cold-lake', 'tad', '8_bit_cold_lake_lofi.wav', 'fd6f9240d583d18266d0b6adc5ddd3df517bb720'],
  ['thawing-village', 'tad', 'thawing_village_8_bit_lofi.wav', '0a2f9c8899a9424c2e6d7bdb1dca7bcfd1cbafef'],
  ['rainy-village', 'tad', 'rainy_village_8_bit_lofi_0.mp3', '7ea1392d2629615060bf75be9fc242bf4d65a237'],
  ['unbounded-daydream', 'tad', '8_bit_unbounded_daydream_lofi_0.mp3', '1adc2743614aff33f3c7d68ccbbe892626aa31ad'],
  ['6-am-riverside-town', 'tad', '8_bit_6am_riverside_lofi_0.mp3', 'f1efe189ee8f0aa7f9fcc345a3749344f9a4cc2c'],
  ['remnants-of-the-festival', 'tad', 'remnants_of_the_festival_3.mp3', '42e7e187b883ba54fa3696223d9a126a7c7d3eff'],
  ['arukas-bloom', 'tad', 'arukas_bloom_0.mp3', '22d874f55fa46e61044aa71d7e93b5b955ee40e0'],
  ['since-2-am', 'tad', 'since_2_a.m.wav', '8333fb666128c0ffc21262c570082dec94dabdba'],
  ['ooame', 'tad', '8_bit_ooame_lofi_0.mp3', 'a304c10214d5a226640920fd520c1584dc3fdf5e'],
  ['sleepy-little-mouse', 'ccby', 'sleepy_little_mouse.flac', 'aecc1647c0416184b35f8d1fe46785ac9d28e029'],
  ['glory-hotel', 'ccby', '55._guitar_2.mp3', '9030d7f3fd6a3289e323669be91db8aa8ec7a943'],
  ['coffee-jazz-lofi', 'ccby', 'Coffee Jazz Lofi.mp3', 'b4a94eb0925a2f3fbea716e5c0d26cfec37a3651'],
  ['diminishing-returns', 'ccby', 'diminishingreturnsinstr.wav', '9bf44d13724b91eb7baf2588f8af70b58880b8f3'],
];
const NASA = [
  ['voyager', 'PIA17045_20130906-640.mp4', 'db0ffb95fc5997769c25570ecef63e6067d74f40'],
  ['juno', 'PIA25030.mov', '788b452284256a3705bbb3a272ce0854f40b89d0'],
];

const sha1 = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const ff = args => execFileSync(FF, ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
const ffErr = args => spawnSync(FF, ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8', maxBuffer: 1 << 26 }).stderr; // ffmpeg reports on stderr
function measure(src, I, TP, LRA, extra) { // loudnorm first pass: the JSON it prints
  const log = ffErr(['-i', src, ...extra, '-af', `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`, '-f', 'null', '-']);
  return JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
}
function encode(src, dst, I, TP, LRA, mono, opusK, mp3K) {
  const extra = ['-vn', ...(mono ? ['-ac', '1'] : [])];
  const j = measure(src, I, TP, LRA, extra);
  const ln = `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
  ff(['-y', '-i', src, ...extra, '-af', ln, '-ar', '48000', '-c:a', 'libopus', '-b:a', opusK, '-vbr', 'on', '-map_metadata', '-1', '-f', 'webm', dst + '.webm']);
  ff(['-y', '-i', src, ...extra, '-af', ln, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', mp3K, '-map_metadata', '-1', '-id3v2_version', '0', dst + '.mp3']);
  const info = ffErr(['-i', dst + '.webm']), d = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
  return { dur: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0, webm: fs.statSync(dst + '.webm').size, mp3: fs.statSync(dst + '.mp3').size, inI: +j.input_i };
}

fs.mkdirSync(path.join(OUT, 'music'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'space'), { recursive: true });
const FORCE = process.argv.includes('--force'), rows = [], durs = {};
const dirs = Object.fromEntries(['chill', 'happy', 'lofichill', 'sad', 'tad', 'ccby'].map(k => [k, arg(k)]));
const done = dst => !FORCE && fs.existsSync(dst + '.webm') && fs.existsSync(dst + '.mp3');
const report = (id, r) => { rows.push([id, r]); durs[id] = +r.dur.toFixed(2); console.log(id.padEnd(28), r.dur.toFixed(2) + ' s', (r.webm / 1024).toFixed(0) + ' KB webm', (r.mp3 / 1024).toFixed(0) + ' KB mp3', 'in ' + r.inI + ' LUFS'); };
for (const [id, col, file, hash] of MUSIC) {
  const dst = path.join(OUT, 'music', id);
  if (done(dst) || !dirs[col]) continue;
  const src = path.join(dirs[col], file);
  if (sha1(src) !== hash) throw new Error('unexpected source: ' + src);
  report(id, encode(src, dst, -16, -1.5, 11, false, '64k', '96k'));
}
for (const [id, file, hash] of NASA) {
  const dst = path.join(OUT, 'space', id);
  if (done(dst) || !arg('nasa')) continue;
  const src = path.join(arg('nasa'), file);
  if (sha1(src) !== hash) throw new Error('unexpected source: ' + src);
  report(id, encode(src, dst, -20, -2, 11, true, '48k', '64k'));
}
const tot = rows.reduce((s, [, r]) => [s[0] + r.webm, s[1] + r.mp3], [0, 0]);
console.log(rows.length + ' encoded;', (tot[0] / 1048576).toFixed(1) + ' MB webm', (tot[1] / 1048576).toFixed(1) + ' MB mp3');
if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(durs, null, 1));
