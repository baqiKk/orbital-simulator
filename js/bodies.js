// Body data for both models (real solar system and the simplified circular/planar model).
// Text-free: names come from i18n 'body.<key>'. core.js never reads this file — the app passes the
// numbers to buildSystem, so the solver worker needs no copy. Loaded before app.js; Node tests require it.
//
// ---- Sources ----
// Planet orbits (orb.jpl): JPL SSD, "Approximate Positions of the Planets" (E. M. Standish), Table 1.
//   https://ssd.jpl.nasa.gov/planets/approx_pos.html — valid 1800 AD to 2050 AD,
//   mean ecliptic and equinox of J2000. Rows copied verbatim:
//   [a au, e, I deg, L deg, ϖ deg, Ω deg] at J2000, then the same quantities' rates per Julian century.
//   Earth uses the "EM Bary" row (Earth–Moon barycentre); with the Moon in the list the barycentre
//   bookkeeping in core.js puts Earth at its own place. Pluto is not part of Table 1 any more.
// Satellite orbits (orb.sat): JPL SSD, "Planetary Satellite Mean Elements", epoch 2000-01-01.5 TDB.
//   https://ssd.jpl.nasa.gov/sats/elem/ — columns copied verbatim:
//   [a km, e, ω deg, M deg, i deg, Ω deg, P days (sidereal), Pw years (precession period of ω),
//    Pnode years (regression period of Ω)]; lp = Laplace-plane pole [RA deg, Dec deg, tilt deg] (ICRF).
//   The Moon's elements are referred to the ecliptic (no lp); the others to their local Laplace plane,
//   node measured from that plane's ascending node on the ICRF equator.
//   These values were supplied through a summary tool; ssd.jpl.nasa.gov could not be reached from here
//   to compare them with the page.
// gm (km³/s²): JPL DE440 / satellite ephemeris values; planet-only GM where the body's moons are listed
//   here (Earth, Mars, Jupiter, Saturn), system GM otherwise. radius: mean radius (km), IAU WGCCRE 2015.
//   tilt: axial tilt (obliquity to the body's own orbit, deg). These three were not supplied with the
//   orbit tables and were not re-checked online.
// simple: the Phase 1 values of the simplified model, kept as they were so its scenarios reproduce
//   exactly (mass kg, radius km, circular orbit radius a km). Bodies without it derive them (gm, radius, a).

// Valid date range of the planet table (UTC years, inclusive).
const EPHEM_YEARS = [1800, 2050];

const BODIES = {
  sun: { parent: null, gm: 1.32712440041e11, radius: 695700, tilt: 7.25, color: '#ffd27a',
    simple: { mass: 1.98847e30, radius: 695700, a: 0 } },
  mercury: { parent: 'sun', gm: 22031.868551, radius: 2439.4, tilt: 0.03, color: '#a9a49c',
    simple: { mass: 3.3011e23, radius: 2439.7, a: 57909050 },
    orb: { jpl: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
                 [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]] } },
  venus: { parent: 'sun', gm: 324858.592, radius: 6051.8, tilt: 177.36, color: '#e8c98f',
    simple: { mass: 4.8675e24, radius: 6051.8, a: 108210000 },
    orb: { jpl: [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
                 [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]] } },
  earth: { parent: 'sun', gm: 398600.435507, radius: 6371.0084, tilt: 23.44, color: '#5b9cf0',
    simple: { mass: 5.9722e24, radius: 6371, a: 149598000 },
    orb: { jpl: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
                 [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]] } },
  moon: { parent: 'earth', gm: 4902.800118, radius: 1737.4, tilt: 6.68, color: '#cbc8bf',
    simple: { mass: 7.342e22, radius: 1737.4, a: 384400 },
    orb: { sat: [384400, 0.0554, 318.15, 135.27, 5.16, 125.08, 27.322, 5.997, 18.600] } },
  mars: { parent: 'sun', gm: 42828.37362, radius: 3389.5, tilt: 25.19, color: '#e0703f',
    simple: { mass: 6.4171e23, radius: 3389.5, a: 227939000 },
    orb: { jpl: [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
                 [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]] } },
  phobos: { parent: 'mars', gm: 7.0875e-4, radius: 11.08, tilt: 0, color: '#a08f7e',
    simple: { mass: 1.0659e16, radius: 11.27, a: 9376 },
    orb: { sat: [9375, 0.015, 216.3, 189.7, 1.1, 169.2, 0.3187, 1.1, 2.3], lp: [317.7, 52.9, 0.0] } },
  deimos: { parent: 'mars', gm: 9.6156e-5, radius: 6.2, tilt: 0, color: '#9a8c7f',
    orb: { sat: [23457, 0.000, 0.0, 205.0, 1.8, 54.3, 1.2625, 0.0, 56.2], lp: [316.6, 53.5, 0.9] } },
  jupiter: { parent: 'sun', gm: 126686531.9, radius: 69911, tilt: 3.13, color: '#d9b48c',
    simple: { mass: 1.89813e27, radius: 69911, a: 778570000 },
    orb: { jpl: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
                 [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]] } },
  io: { parent: 'jupiter', gm: 5959.915466, radius: 1821.6, tilt: 0, color: '#e3cf6e',
    orb: { sat: [421800, 0.004, 49.1, 330.9, 0.0, 0.0, 1.762732, 1.333, 0.000], lp: [268.1, 64.5, 0.0] } },
  europa: { parent: 'jupiter', gm: 3202.712099, radius: 1560.8, tilt: 0.1, color: '#d4c7ad',
    simple: { mass: 4.7998e22, radius: 1560.8, a: 671034 },
    orb: { sat: [671100, 0.009, 45.0, 345.4, 0.5, 184.0, 3.525463, 1.394, 30.202], lp: [268.1, 64.5, 0.0] } },
  ganymede: { parent: 'jupiter', gm: 9887.832752, radius: 2631.2, tilt: 0.2, color: '#b7aa98',
    orb: { sat: [1070400, 0.001, 198.3, 324.8, 0.2, 58.5, 7.155588, 68.301, 137.812], lp: [268.2, 64.6, 0.1] } },
  callisto: { parent: 'jupiter', gm: 7179.283089, radius: 2410.3, tilt: 0, color: '#8a7f70',
    orb: { sat: [1882700, 0.007, 43.8, 87.4, 0.3, 309.1, 16.690440, 277.921, 577.264], lp: [268.7, 64.8, 0.4] } },
  saturn: { parent: 'sun', gm: 37931206.234, radius: 58232, tilt: 26.73, color: '#e3cc94',
    orb: { jpl: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
                 [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]] } },
  titan: { parent: 'saturn', gm: 8978.138845, radius: 2574.7, tilt: 0.3, color: '#d9a85b',
    orb: { sat: [1221900, 0.029, 78.3, 11.7, 0.3, 78.6, 15.945448, 346.680, 687.370], lp: [36.4, 84.0, 0.6] } },
  uranus: { parent: 'sun', gm: 5794556.4, radius: 25362, tilt: 97.77, color: '#9fd7dc',
    orb: { jpl: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
                 [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]] } },
  neptune: { parent: 'sun', gm: 6836527.10058, radius: 24622, tilt: 28.32, color: '#6f8fe8',
    orb: { jpl: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
                 [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]] } },
  // simplified model only: a free-form body the user edits
  custom: { color: '#b590f2', simple: { mass: 1e23, radius: 2000, a: 500000 } },
};

if (typeof module !== 'undefined') module.exports = { BODIES, EPHEM_YEARS };
