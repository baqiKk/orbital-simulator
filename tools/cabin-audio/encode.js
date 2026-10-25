// Cabin radio pipeline (Phase 11): encodes the chosen HoliznaCC0 tracks and the two NASA plasma-wave recordings into
// what kabin.html plays: Opus in WebM (first choice) and MP3 (for browsers without Opus), loudness-matched. Not part of
// the site; needs ffmpeg (ffmpeg-static), installed outside the repo (see README.md).
//
//   node tools/cabin-audio/encode.js --chill <Chill Beats dir> --happy <Happy Lo-Fi dir> --nasa <dir> --out audio/cabin
//
// Music: two-pass EBU R128 loudnorm to −16 LUFS (true peak −1.5 dBTP), Opus 64 kb/s stereo, MP3 96 kb/s stereo 44.1 kHz.
// NASA: audio track only, −20 LUFS (they sit under the music), mono, Opus 48 kb/s, MP3 64 kb/s. Prints each output's
// duration and size; the source files' SHA-1s are checked so a different download is noticed.
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
const dirs = { chill: arg('chill'), happy: arg('happy') }, rows = [];
for (const [id, col, file, hash] of MUSIC) {
  const src = path.join(dirs[col], file);
  if (sha1(src) !== hash) throw new Error('unexpected source: ' + src);
  const r = encode(src, path.join(OUT, 'music', id), -16, -1.5, 11, false, '64k', '96k');
  rows.push([id, r]); console.log(id.padEnd(24), r.dur.toFixed(2) + ' s', (r.webm / 1024).toFixed(0) + ' KB webm', (r.mp3 / 1024).toFixed(0) + ' KB mp3', 'in ' + r.inI + ' LUFS');
}
for (const [id, file, hash] of NASA) {
  const src = path.join(arg('nasa'), file);
  if (sha1(src) !== hash) throw new Error('unexpected source: ' + src);
  const r = encode(src, path.join(OUT, 'space', id), -20, -2, 11, true, '48k', '64k');
  rows.push([id, r]); console.log(id.padEnd(24), r.dur.toFixed(2) + ' s', (r.webm / 1024).toFixed(0) + ' KB webm', (r.mp3 / 1024).toFixed(0) + ' KB mp3', 'in ' + r.inI + ' LUFS');
}
const tot = rows.reduce((s, [, r]) => [s[0] + r.webm, s[1] + r.mp3], [0, 0]);
console.log('total', (tot[0] / 1048576).toFixed(1) + ' MB webm', (tot[1] / 1048576).toFixed(1) + ' MB mp3');
