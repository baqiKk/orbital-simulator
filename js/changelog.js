// Release notes, "Yenilikler" (2026-11-21, Phase 20A-8; classic script, after prefs.js, before app.js; no DOM). Each
// version: v ('major.minor[.patch]'), date (ISO, UTC), tr / en: 3–6 short items in the user's words (what they can do or
// see, not how it is built), img (optional: a picture or GIF of the highlight under img/changelog/, made from the site
// itself; size: its pixels) with alt (tr / en). Newest first. The notes are the one place where both languages sit side by side; the
// window's own words (title, "Yeni", "Önceki sürümler") come from i18n.js. Rule (CLAUDE.md): every meaningful change a
// user can see adds an item to the coming version; a release gives it a number and a date.
const CHANGELOG = [
  {
    v: '0.9', date: '2026-11-21', img: 'img/changelog/0.9.jpg', size: [1488, 878], // tools/changelog/shot.js
    alt: { tr: 'Alçak Dünya yörüngesinde, motoru yanan bir üst kademe yakından', en: 'An upper stage firing its engine in low Earth orbit, seen up close' },
    tr: [
      'Kendin uç: Dünya, Ay, Mars ya da başka bir cismin çevresinde bir üst kademeyi kendin yönet; manevra düğümleri koy, zamanı hızlandır, transfer penceresini bul.',
      'Motor tasarla: sıvı, hibrit, katı ve tek bileşenli motorlar, değerleri yayımlanmış kaynaklardan; aracın 3B modeli ve canlı kesiti.',
      'Alev ve ses: itki maddesine göre renklenen alev; gazla yükselen, yakıt bitince kesilen motor sesi.',
      'Görevini kaydet: GIF ya da video olarak, yanmalarda yavaşlayan kısa bir film.',
      'Daha net görüntü: her yakınlıkta pürüzsüz yörüngeler, Satürn\'e yakından bir açılış, sol üstte ekrandaki görev ve evresi.',
    ],
    en: [
      'Fly it yourself: steer an upper stage around the Earth, the Moon, Mars or another body; place maneuver nodes, warp time, find the transfer window.',
      'Design an engine: liquid, hybrid, solid and monopropellant engines with published figures; a 3D model of the craft and a live cutaway.',
      'Flame and sound: a plume coloured by its propellant; an engine sound that rises with the throttle and stops when the propellant runs out.',
      'Record your mission: a short GIF or video that slows down during the burns.',
      'A sharper view: orbits smooth at any zoom, a closer opening on Saturn, the mission and its phase at the top left.',
    ],
  },
];
// 'a.b.c' compared part by part as numbers (a missing part is 0): > 0 when a is newer
function verCmp(a, b) {
  const p = String(a).split('.').map(Number), q = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(p.length, q.length); i++) { const d = (p[i] || 0) - (q[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
const NOTES_LAST = CHANGELOG[0].v;
// the versions newer than seen (all when nothing was seen), newest first
const notesUnseen = (list, seen) => (seen ? list.filter(x => verCmp(x.v, seen) > 0) : list.slice());
// The small notice after the welcome: once per new version (shown: the last version it was shown for), and only to
// someone who used the site before (returning: other saved settings exist); a first visit gets only the dot by the link
function notesToast(list, shown, returning) {
  if (shown) return verCmp(list[0].v, shown) > 0;
  return !!returning;
}
if (typeof module !== 'undefined') module.exports = { CHANGELOG, verCmp, NOTES_LAST, notesUnseen, notesToast };
