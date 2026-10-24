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
// atm (aerocapture, km): [h_low, h_skip] from AMAT, the Aerocapture Mission Analysis Tool (A. P. Girija),
//   AMAT/planet.py, class Planet — https://github.com/athulpg007/AMAT. Docstring: h_skip "If vehicle altitude
//   exceeds this value, trajectory is cut off and vehicle is assumed to skip off the atmosphere" (the
//   atmosphere's upper edge); h_low "If terminal altitude is below this value vehicle is assumed to be trapped
//   in the atmosphere." Copied for the bodies AMAT gives both for: Venus, Earth, Mars, Titan, Uranus, Neptune
//   (the destinations of Girija's aerocapture design reference missions). Jupiter and Saturn have no h_low
//   there, so aerocapture stays off for them. The app takes h_low as the default pass altitude (editable) and
//   h_skip as the highest one allowed.
//   atmR (km): the radius AMAT measures its altitudes from (planet.py RP, copied as is). It differs from our
//   radius for Earth (6371.0 vs 6371.0084), Titan (2575.0 vs 2574.7) and Uranus (25559 vs 25362; equatorial vs
//   mean); atmAltitudes() converts the AMAT altitudes to ours via the distance from the centre (atmR + h - radius).
// pole (Sun and planets): IAU rotation elements from NAIF PCK pck00011.tpc (N. Bachman, 2022-12-27; IAU WGCCRE 2015
//   report), https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc — BODYnnn_POLE_RA, _POLE_DEC, _PM
//   copied as [α0, α1, δ0, δ1, W0, W1]: α = α0 + α1·T, δ = δ0 + δ1·T (deg, T in Julian centuries from J2000 TDB),
//   W = W0 + W1·d (deg, d in days). Periodic (NUT_PREC) terms over 0.1°, as [cα, cδ, cW, θ0, θ1]: α += cα·sin θ,
//   δ += cδ·cos θ, W += cW·sin θ, θ = θ0 + θ1·T (BODYn_NUT_PREC_ANGLES): Mars (BODY499 RA/DEC/PM coefficients 0.419057,
//   1.591274, 0.584542 with BODY4 angles 15, 20 and 26) and Neptune (BODY899 0.70, −0.51, −0.48 with BODY8 angle N).
//   The smaller ones (Mars ≤ 0.00024°, Jupiter ≤ 0.00012°, Mercury's prime meridian ≤ 0.011°) are left out.
//   Display only (3D view, textured globes). Ceres and Vesta from the same file: BODY2000001 and BODY2000004 _POLE_RA,
//   _POLE_DEC, _PM (no rates on α, δ); their tilt is the angle between that pole and the SBDB orbit normal (4.04°, 27.43°).
// Saturn's moons Mimas, Enceladus, Tethys, Dione, Rhea, Iapetus (orb.sat as above, ephemeris SAT441; checked against
//   https://ssd.jpl.nasa.gov/sats/elem/ on 2026-10-24): gm and radius (mean) from JPL SSD "Planetary Satellite Physical
//   Parameters", https://ssd.jpl.nasa.gov/sats/phys_par/ (SAT441 GM, mean radius), copied as listed. Synchronous (lock);
//   tilt 0 (not tabulated; these moons' spin axes are close to their orbit normals).
// Ceres and Vesta (orb.sb): JPL Small-Body Database, https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1 / 4 with full-prec
//   (orbit solution JPL, 2021-04-13), heliocentric osculating elements, mean ecliptic and equinox of J2000, copied as
//   [epoch JD TDB, a au, e, i, Ω, ω, M (deg), n deg/day]; drawn as a fixed ellipse (two-body), so they drift from the
//   real asteroid away from the epoch (planetary perturbations). gm and radius (diameter / 2) from the same records'
//   physical parameters: Ceres (Park et al. 2016, Nature 537, 515), Vesta (Park et al. 2025, Nat. Astron.). Both are
//   drawn as spheres (Vesta is 569 × 554 × 453 km).
// axis (the Moon): its pole from the same file, BODY301_POLE_RA / _POLE_DEC as [α0, α1, δ0, δ1] and the periodic terms
//   over 0.1° as [cα, cδ, 0, θ0, θ1] (BODY301_NUT_PREC_RA −3.8787 and _DEC 1.5419 on angle E1, RA −0.1204 on E2; BODY3_NUT_PREC_ANGLES
//   E1 = 125.045 − 1935.5364525·T, E2 = 250.089 − 3871.0729050·T). Not a rotation (the Moon is drawn as lock): the equator
//   the orbit maneuvers measure inclinations from and the J2 axis; the globe's pole follows it too.
// j2 (orbit maneuvers, optional oblateness): [J2 × 10⁶, equatorial radius km], the reference radius J2 goes with, from the NSSDCA
//   planetary fact sheets (D. R. Williams), https://nssdc.gsfc.nasa.gov/planetary/factsheet/<body>fact.html, rows
//   'J2 (x 10^-6)' and 'Equatorial radius (km)' (1 bar level for the giants), copied as printed (Saturn '16,298.', Neptune
//   '3411.'). Planets and the Moon.
// glow: [colour, strength] thin limb glow of an atmosphere (display only; strongest on the lit side, faint at night).
// haze (Venus, Titan; display only): a thick hazy limb, single scattering in a spherical shell above the drawn surface,
//   density exp(−h/H) (+ a detached layer [altitude km, width km, density relative to the base]), H scale height (km),
//   tau the vertical optical depth in visible light, top (km) where the shell ends, g the Henyey–Greenstein asymmetry
//   (forward scattering: a backlit body shows a bright ring), the body colour as the haze's colour. Approximate literature
//   values: Titan — haze optical depth ≈ 2.5 near 530 nm and scale height ≈ 65 km from the Huygens DISR descent
//   (Tomasko et al. 2008, Planet. Space Sci. 56, 669), detached layer near 500 km (Porco et al. 2005, Nature 434, 159);
//   Venus — the upper haze above the cloud tops (taken as the drawn surface), H ≈ 5 km, optical depth ≈ 0.3 (Venus
//   Express SPICAV/VMC; Wilquet et al. 2009, J. Geophys. Res. 114, E00B42).
// phot: 'lambert' — the day side darkens as cos(sun elevation) (Earth); bodies with relief use Lommel–Seeliger (a
//   regolith surface: flat at full phase, dark towards the terminator); the others keep the plain lit/unlit look.
// lock: synchronous moon, its prime meridian (texture longitude 0) faces the parent along the orbit (this app's orbit;
//   the PCK rotation of these moons would disagree with our mean elements by the libration and the orbit phase).
// tex: surface texture (equirectangular, longitude 0 in the middle, north up), drawn only in the normal 2D and 3D modes
//   and only once the body is a few pixels across (js/globe.js). src: the TEX_SRC entry; sat: colour saturation
//   (Mercury's enhanced-colour mosaic is toned down). Every file is a real source image, at most downscaled; credits and
//   licences are shown in the app (Sources window), the text in js/i18n.js (cred.*).
//   w: width of the base file (1024 when not given); hi: sharper tiers [width px, file], fetched only once the globe is
//   large enough on screen for them (2048 in the normal 2D mode, up to 4096 in 3D; js/globe.js texTier). The same for
//   relief / clouds / night / ocean. Downscaling averages in linear light (colour) or the stored values (data).
//   Original files (SHA-1):
//   mercury  USGS Astrogeology, mercury_messenger_mdis_basemap_enhancedcolor_mosaic_global_1024.jpg (020fa8cb…), as is;
//            2k / 4k from Mercury_MESSENGER_MDIS_Basemap_EnhancedColor_Mosaic_Global_665m.tif (23040×11520, 701e89ae…)
//   venus    NASA 3D Resources "Venus" (Magellan radar, 1440×720, 59c7464b…) -> 1024×512; optional (texAlt), the
//            default is an untextured cloud-coloured globe
//   earth    NASA Earth Observatory, Blue Marble: Next Generation with Topography, August 2004,
//            world.topo.200408.3x5400x2700.jpg (EO image record 74418, 38cb9d5b…) -> 1024×512, 2048×1024, 4096×2048
//   moon     NASA SVS 4720 "CGI Moon Kit", lroc_color_poles_1k.jpg (2019 colour map, 50bf929b…), as is;
//            lroc_color_poles_2k.tif (c6cdd7d4…) and _4k.tif (079fd0c2…), same size, as JPEG
//   mars     USGS Astrogeology, Mars Viking MDIM 2.1 colourised global mosaic, the official 1 km browse image
//            mars_viking_mdim21_clrmosaic_1km.jpg (21339×10670, 47824122…; the 232 m GeoTIFF is 12.7 GB and not cloud
//            optimised) -> 1024×512, 2048×1024, 4096×2048. Until Phase 5c the 1k file was NASA 3D Resources "Mars"; it was
//            replaced so the tiers match.
//   jupiter  NASA Photojournal PIA07782 "Cassini's Best Maps of Jupiter (Cylindrical Map)", PIA07782.jpg
//            (3601×1801, 81d41667…) -> 2048×1024; the 3D top tier is the file itself (3601×1801)
//   io, europa, ganymede, callisto  NASA 3D Resources "Jupiter - Io (A)", "- Europa", "- Ganymede", "- Callisto"
//            (1440×720; c3320ddd…, 90333182…, c41ae8a7…, 613f8ac1…) -> 1024×512. Io stays at 1k: the USGS colour mosaic
//            (Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif) takes its red from the 756 nm near-infrared filter, so
//            it is not true colour.
//   saturn   NASA Science 3D model Saturn_1_120536.glb (NASA VTAD, 35a05b17…): its 4096×3072 cube-layout base-colour
//            texture reprojected to equirectangular through the model's own UVs (ray from the centre per output pixel,
//            barycentric UV, bilinear sample; every pixel covered), 2048×1024 -> 1024×512; the 2k tier is that
//            reprojection itself (its source cube faces carry no more detail than that)
//   titan    NASA 3D Resources "Saturn - Titan" (720×360, 92932463…), as is
//   mimas, enceladus, tethys, dione, rhea, iapetus  Cassini ISS cartographic maps (DLR, Roatsch et al.; PDS Ring-Moon
//            Systems Node volumes COISS_3006, 3002, 3004, 3003, 3007, 3005), the global simple cylindrical map
//            <id>_0_0_SIMP.IMG of each (8 bit, photometrically corrected by the producers; planetographic west longitude,
//            east to the right): SM_1M (5760×2880, 01e46e08…), SE_400K (15840×7920, centred on 180°: turned by half a
//            width, cb50894c…), ST_1M (11520×5760, 24b1d3be…), SD_1M (23040×11520, 1bf3463a…), SR_1500K (11520×5760,
//            5693a933…), SI_3M (5760×2880, 533b5d84…) -> 1024, 2048, 4096 wide; grey values kept, averaged as sRGB like
//            the other grey mosaics. Their brightness is relative (each map's own stretch), not an albedo.
//   ceres    USGS Astrogeology, Ceres Dawn FC global mosaic 400 m (DLR, 2015), Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif
//            (7383×3691, 0–360° E, 372ca7cb…) -> 1024, 2048, 4096 wide, turned by half a width (longitude 0 in the
//            middle); the black cap near the south pole has no data in the source
//   vesta    USGS Astrogeology, Vesta Dawn FC HAMO global mosaic 60 m (DLR, 2013; shifted by USGS to the IAU "Claudia
//            double prime" longitudes that the PCK rotation below uses), Vesta_Dawn_FC_HAMO_Mosaic_Global_74ppd.tif
//            (26704×13352, d95355b7…) -> 1024, 2048, 4096 wide; the dark north was in its winter night during the survey
//   nodata (Ceres, Vesta): the source's black, data-less cap (lat: the latitude band it lies in, deg) is drawn in the body's
//            mean tone instead (js/globe.js voidFill; the files stay as they are): tone = the area-weighted mean of the
//            4k map's data pixels (value > 12) in linear light, Ceres 136/255, Vesta 88/255
//   Uranus and Neptune have no texture (no real global map exists; the NASA textures are illustrative): plain
//   globes in their colour, with limb darkening, like the cloud-covered Venus.
// rings (Saturn): ring strip from the same GLB (saturn_rings_25sat_outterRings.png, 4096×16 RGBA, as is), u from the
//   inner to the outer edge; r = the GLB ring mesh's inner and outer radius over its planet mesh's equatorial radius
//   (616.1504 / 500.0371 and 1165.4507 / 500.0371), req = Saturn's equatorial radius from the NSSDC Saturnian Rings
//   Fact Sheet (60,268 km; there the C ring starts at 1.239 and the F ring is at 2.320 equatorial radii).
//   tau: the rings' normal optical depth over the same radii, from the Voyager 2 PPS δ Scorpii stellar occultation
//   (PDS Ring-Moon Systems Node, VG_2801/EASYDATA/KM010/PS1P01.TAB, 10 km bins, 72 000–142 500 km, 1a529c7c…; column
//   MEDIAN_NORMAL_OPACITY, 99 = opaque, small negative noise read as 0): stored as 1 − e^(−τ) (8192×1 grey PNG), each
//   pixel the mean transmission over its radii. The shader turns it back into τ: opacity 1 − e^(−τ/μ), the lit and the
//   unlit face from single scattering (the C ring and the Cassini Division glow when backlit, the dense B ring goes dark),
//   the F ring's dust forward-scatters.
// relief: heights (8-bit grey PNG, linear between h[0] and h[1] metres, the same range for every tier) for the shaded
//   relief and cast shadows; no exaggeration.
//   moon     NASA SVS 4720 LOLA heights, ldem_4_uint.tif (1440×720, d04bd9aa…) -> 1024×512; ldem_16_uint.tif
//            (5760×2880, 193594b6…) -> 2048×1024, 4096×2048 (uint16 half-metres over 1727.4 km -> metres over 1737.4 km)
//   mars     MGS MOLA MEGDR topography (PDS Geosciences Node, mgsl_300x), megt90n000cb.img (4 px/°, 9e11c9e3…),
//            megt90n000eb.img (16 px/°, eb6b0d11…), megt90n000fb.img (32 px/°, 891bbf03…), metres over the areoid; the
//            files start at 0° E: turned by half a width so longitude 0 is in the middle
//   mercury  USGS Astrogeology, MESSENGER global DEM 665 m v2, Mercury_Messenger_USGS_DEM_Global_665m_v2.tif
//            (23040×11520, 6766bd33…; int16 × 0.5 m over 2439.4 km, no gaps) -> 1024, 2048, 4096 wide
// clouds / night / ocean (Earth): clouds NASA Visible Earth "Blue Marble: Clouds" (record 57747), cloud_combined_2048.jpg
//   (e210f504…; -> 1024×512, the 2k tier as is) and cloud_combined_8192.tif (57c8587a… -> 4096×2048); the grey value is
//   the cloud cover, drawn over the surface, turning slowly eastwards (display only: no real winds), with its shadow; on
//   or off in the Sources window. Night: NASA Earth Observatory Black Marble 2016 grayscale (record 144897),
//   BlackMarble_2016_01deg_gray.jpg (3600×1800, b2f6ef90… -> 1024, 2048) and BlackMarble_2016_3km_gray.jpg (13500×6750,
//   e580163d… -> 4096): city lights on the night side only, with their own exposure (true to scale they would be about
//   10⁻⁵ of the day side). Ocean: NASA Earth Observatory GEBCO_08 bathymetry (record 73963),
//   gebco_08_rev_bath_3600x1800_color.jpg (185ca845… -> 1024, 2048), as is: land is black, any other value is water,
//   where the Sun's glint is drawn.
// simple: the Phase 1 values of the simplified model, kept as they were so its scenarios reproduce
//   exactly (mass kg, radius km, circular orbit radius a km). Bodies without it derive them (gm, radius, a).

// Valid date range of the planet table (UTC years, inclusive).
const EPHEM_YEARS = [1800, 2050];

const BODIES = {
  sun: { parent: null, gm: 1.32712440041e11, radius: 695700, tilt: 7.25, color: '#ffd27a', pole: [286.13, 0, 63.87, 0, 84.176, 14.18440],
    simple: { mass: 1.98847e30, radius: 695700, a: 0 } },
  mercury: { parent: 'sun', gm: 22031.868551, radius: 2439.4, tilt: 0.03, j2: [50.3, 2440.5], color: '#a9a49c', pole: [281.0103, -0.0328, 61.4155, -0.0049, 329.5988, 6.1385108],
    tex: { file: 'img/planets/mercury.jpg', src: 'usgs', sat: 0.3, hi: [[2048, 'img/planets/mercury_2k.jpg'], [4096, 'img/planets/mercury_4k.jpg']] },
    relief: { file: 'img/planets/mercury_height.png', src: 'usgsDem', h: [-5400, 4500], hi: [[2048, 'img/planets/mercury_height_2k.png'], [4096, 'img/planets/mercury_height_4k.png']] },
    simple: { mass: 3.3011e23, radius: 2439.7, a: 57909050 },
    orb: { jpl: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
                 [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]] } },
  venus: { parent: 'sun', gm: 324858.592, radius: 6051.8, tilt: 177.36, j2: [4.458, 6051.8], color: '#e8c98f', pole: [272.76, 0, 67.16, 0, 160.20, -1.4813688],
    texAlt: { file: 'img/planets/venus_radar.jpg', src: 'nasa3d' }, atm: [60, 180], atmR: 6051.8, haze: { H: 5, tau: 0.3, top: 40, g: 0.7 },
    simple: { mass: 4.8675e24, radius: 6051.8, a: 108210000 },
    orb: { jpl: [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
                 [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]] } },
  earth: { parent: 'sun', gm: 398600.435507, radius: 6371.0084, tilt: 23.44, j2: [1082.63, 6378.137], color: '#5b9cf0', pole: [0, -0.641, 90, -0.557, 190.147, 360.9856235],
    tex: { file: 'img/planets/earth.jpg', src: 'bmng', hi: [[2048, 'img/planets/earth_2k.jpg'], [4096, 'img/planets/earth_4k.jpg']] }, phot: 'lambert',
    clouds: { file: 'img/planets/earth_clouds.jpg', src: 'eoClouds', hi: [[2048, 'img/planets/earth_clouds_2k.jpg'], [4096, 'img/planets/earth_clouds_4k.jpg']] },
    night: { file: 'img/planets/earth_night.jpg', src: 'blackMarble', hi: [[2048, 'img/planets/earth_night_2k.jpg'], [4096, 'img/planets/earth_night_4k.jpg']] },
    ocean: { file: 'img/planets/earth_ocean.jpg', src: 'gebco', hi: [[2048, 'img/planets/earth_ocean_2k.jpg']] }, atm: [50, 120], atmR: 6371, glow: ['#4d8dff', 1],
    simple: { mass: 5.9722e24, radius: 6371, a: 149598000 },
    orb: { jpl: [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
                 [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]] } },
  moon: { parent: 'earth', gm: 4902.800118, radius: 1737.4, tilt: 6.68, j2: [202.7, 1738.1], color: '#cbc8bf', lock: true, axis: [269.9949, 0.0031, 66.5392, 0.0130, [[-3.8787, 1.5419, 0, 125.045, -1935.5364525], [-0.1204, 0, 0, 250.089, -3871.0729050]]],
    tex: { file: 'img/planets/moon.jpg', src: 'svs', hi: [[2048, 'img/planets/moon_2k.jpg'], [4096, 'img/planets/moon_4k.jpg']] },
    relief: { file: 'img/planets/moon_height.png', src: 'svs', h: [-9200, 10800], hi: [[2048, 'img/planets/moon_height_2k.png'], [4096, 'img/planets/moon_height_4k.png']] },
    simple: { mass: 7.342e22, radius: 1737.4, a: 384400 },
    orb: { sat: [384400, 0.0554, 318.15, 135.27, 5.16, 125.08, 27.322, 5.997, 18.600] } },
  mars: { parent: 'sun', gm: 42828.37362, radius: 3389.5, tilt: 25.19, j2: [1960.45, 3396.2], color: '#e0703f', pole: [317.269202, -0.10927547, 54.432516, -0.05827105, 176.049863, 350.891982443297,
      [[0.419057, 0, 0, 79.398797, 0.5042615], [0, 1.591274, 0, 166.325722, 0.5042615], [0, 0, 0.584542, 95.391654, 0.5042615]]],
    tex: { file: 'img/planets/mars.jpg', src: 'mdim', hi: [[2048, 'img/planets/mars_2k.jpg'], [4096, 'img/planets/mars_4k.jpg']] },
    relief: { file: 'img/planets/mars_height.png', src: 'mola', h: [-8300, 21300], hi: [[2048, 'img/planets/mars_height_2k.png'], [4096, 'img/planets/mars_height_4k.png']] }, atm: [50, 120], atmR: 3389.5, glow: ['#e8a478', 0.25],
    simple: { mass: 6.4171e23, radius: 3389.5, a: 227939000 },
    orb: { jpl: [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
                 [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]] } },
  phobos: { parent: 'mars', gm: 7.0875e-4, radius: 11.08, tilt: 0, color: '#a08f7e', lock: true,
    simple: { mass: 1.0659e16, radius: 11.27, a: 9376 },
    orb: { sat: [9375, 0.015, 216.3, 189.7, 1.1, 169.2, 0.3187, 1.1, 2.3], lp: [317.7, 52.9, 0.0] } },
  deimos: { parent: 'mars', gm: 9.6156e-5, radius: 6.2, tilt: 0, color: '#9a8c7f', lock: true,
    orb: { sat: [23457, 0.000, 0.0, 205.0, 1.8, 54.3, 1.2625, 0.0, 56.2], lp: [316.6, 53.5, 0.9] } },
  vesta: { parent: 'sun', gm: 17.2882844, radius: 261.385, tilt: 27.43, color: '#a8a39a', pole: [309.031, 0, 42.235, 0, 285.39, 1617.3329428],
    tex: { file: 'img/planets/vesta.jpg', src: 'dawnVesta', nodata: { lat: [45, 90], tone: '#585858' }, hi: [[2048, 'img/planets/vesta_2k.jpg'], [4096, 'img/planets/vesta_4k.jpg']] },
    orb: { sb: [2461200.5, 2.361365965127599, 0.09020374382834395, 7.143925545058711, 103.701293265032, 151.4686478221564, 81.19015607686903, 0.2716183613599909] } },
  ceres: { parent: 'sun', gm: 62.6284, radius: 469.7, tilt: 4.04, color: '#8e8a84', pole: [291.418, 0, 66.764, 0, 170.650, 952.1532],
    tex: { file: 'img/planets/ceres.jpg', src: 'dawnCeres', nodata: { lat: [-90, -60], tone: '#888888' }, hi: [[2048, 'img/planets/ceres_2k.jpg'], [4096, 'img/planets/ceres_4k.jpg']] },
    orb: { sb: [2461200.5, 2.765552595034094, 0.07969229514816586, 10.58802780183462, 80.24862682043221, 73.29421453021587, 274.4193463761342, 0.21430445064843] } },
  jupiter: { parent: 'sun', gm: 126686531.9, radius: 69911, tilt: 3.13, j2: [14736, 71492], color: '#d9b48c', pole: [268.056595, -0.006499, 64.495303, 0.002413, 284.95, 870.5360000],
    tex: { file: 'img/planets/jupiter.jpg', src: 'pj', w: 2048, hi: [[3601, 'img/planets/jupiter_4k.jpg']] },
    simple: { mass: 1.89813e27, radius: 69911, a: 778570000 },
    orb: { jpl: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
                 [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]] } },
  io: { parent: 'jupiter', gm: 5959.915466, radius: 1821.6, tilt: 0, color: '#e3cf6e', lock: true, tex: { file: 'img/planets/io.jpg', src: 'nasa3d' },
    orb: { sat: [421800, 0.004, 49.1, 330.9, 0.0, 0.0, 1.762732, 1.333, 0.000], lp: [268.1, 64.5, 0.0] } },
  europa: { parent: 'jupiter', gm: 3202.712099, radius: 1560.8, tilt: 0.1, color: '#d4c7ad', lock: true, tex: { file: 'img/planets/europa.jpg', src: 'nasa3d' },
    simple: { mass: 4.7998e22, radius: 1560.8, a: 671034 },
    orb: { sat: [671100, 0.009, 45.0, 345.4, 0.5, 184.0, 3.525463, 1.394, 30.202], lp: [268.1, 64.5, 0.0] } },
  ganymede: { parent: 'jupiter', gm: 9887.832752, radius: 2631.2, tilt: 0.2, color: '#b7aa98', lock: true, tex: { file: 'img/planets/ganymede.jpg', src: 'nasa3d' },
    orb: { sat: [1070400, 0.001, 198.3, 324.8, 0.2, 58.5, 7.155588, 68.301, 137.812], lp: [268.2, 64.6, 0.1] } },
  callisto: { parent: 'jupiter', gm: 7179.283089, radius: 2410.3, tilt: 0, color: '#8a7f70', lock: true, tex: { file: 'img/planets/callisto.jpg', src: 'nasa3d' },
    orb: { sat: [1882700, 0.007, 43.8, 87.4, 0.3, 309.1, 16.690440, 277.921, 577.264], lp: [268.7, 64.8, 0.4] } },
  saturn: { parent: 'sun', gm: 37931206.234, radius: 58232, tilt: 26.73, j2: [16298, 60268], color: '#e3cc94', pole: [40.589, -0.036, 83.537, -0.004, 38.90, 810.7939024],
    tex: { file: 'img/planets/saturn.jpg', src: 'vtad', hi: [[2048, 'img/planets/saturn_2k.jpg']] },
    rings: { file: 'img/planets/saturn_rings.png', src: 'vtad', r: [616.1504 / 500.0371, 1165.4507 / 500.0371], req: 60268, tau: { file: 'img/planets/saturn_rings_tau.png', src: 'pps' } },
    orb: { jpl: [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
                 [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]] } },
  mimas: { parent: 'saturn', gm: 2.50349, radius: 198.2, tilt: 0, color: '#bdbab4', lock: true, tex: { file: 'img/planets/mimas.jpg', src: 'coiss', hi: [[2048, 'img/planets/mimas_2k.jpg'], [4096, 'img/planets/mimas_4k.jpg']] },
    orb: { sat: [186000, 0.020, 160.4, 275.3, 1.6, 66.2, 0.942422, 0.493, 0.986], lp: [40.6, 83.5, 0.0] } },
  enceladus: { parent: 'saturn', gm: 7.21037, radius: 252.1, tilt: 0, color: '#eef1f2', lock: true, tex: { file: 'img/planets/enceladus.jpg', src: 'coiss', hi: [[2048, 'img/planets/enceladus_2k.jpg'], [4096, 'img/planets/enceladus_4k.jpg']] },
    orb: { sat: [238400, 0.005, 119.5, 57.0, 0.0, 0.0, 1.370218, 2.916, 0.000], lp: [40.6, 83.5, 0.0] } },
  tethys: { parent: 'saturn', gm: 41.21353, radius: 531.1, tilt: 0, color: '#d9d7d2', lock: true, tex: { file: 'img/planets/tethys.jpg', src: 'coiss', hi: [[2048, 'img/planets/tethys_2k.jpg'], [4096, 'img/planets/tethys_4k.jpg']] },
    orb: { sat: [295000, 0.001, 335.3, 0.0, 1.1, 273.0, 1.887802, 0.005, 4.982], lp: [40.6, 83.5, 0.0] } },
  dione: { parent: 'saturn', gm: 73.11607, radius: 561.4, tilt: 0, color: '#cbc8c2', lock: true, tex: { file: 'img/planets/dione.jpg', src: 'coiss', hi: [[2048, 'img/planets/dione_2k.jpg'], [4096, 'img/planets/dione_4k.jpg']] },
    orb: { sat: [377700, 0.002, 116.0, 212.0, 0.0, 0.0, 2.736916, 11.698, 0.000], lp: [40.6, 83.5, 0.0] } },
  rhea: { parent: 'saturn', gm: 153.94175, radius: 763.5, tilt: 0, color: '#c6c2bb', lock: true, tex: { file: 'img/planets/rhea.jpg', src: 'coiss', hi: [[2048, 'img/planets/rhea_2k.jpg'], [4096, 'img/planets/rhea_4k.jpg']] },
    orb: { sat: [527200, 0.001, 44.3, 31.5, 0.3, 133.7, 4.517503, 33.939, 35.775], lp: [40.6, 83.5, 0.0] } },
  titan: { parent: 'saturn', gm: 8978.138845, radius: 2574.7, tilt: 0.3, color: '#d9a85b', lock: true, tex: { file: 'img/planets/titan.jpg', src: 'nasa3d', w: 720 }, atm: [300, 1000], atmR: 2575, haze: { H: 65, tau: 2.5, top: 600, g: 0.6, layer: [500, 25, 0.004] },
    orb: { sat: [1221900, 0.029, 78.3, 11.7, 0.3, 78.6, 15.945448, 346.680, 687.370], lp: [36.4, 84.0, 0.6] } },
  iapetus: { parent: 'saturn', gm: 120.51511, radius: 734.3, tilt: 0, color: '#a39684', lock: true, tex: { file: 'img/planets/iapetus.jpg', src: 'coiss', hi: [[2048, 'img/planets/iapetus_2k.jpg'], [4096, 'img/planets/iapetus_4k.jpg']] },
    orb: { sat: [3561700, 0.028, 254.5, 74.8, 7.6, 86.5, 79.331002, 1662.900, 3130.302], lp: [288.7, 78.9, 14.8] } },
  uranus: { parent: 'sun', gm: 5794556.4, radius: 25362, tilt: 97.77, j2: [3343.43, 25559], color: '#9fd7dc', pole: [257.311, 0, -15.175, 0, 203.81, -501.1600928], atm: [10, 1500], atmR: 25559,
    orb: { jpl: [[19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
                 [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]] } },
  neptune: { parent: 'sun', gm: 6836527.10058, radius: 24622, tilt: 28.32, j2: [3411, 24764], color: '#3f63d0', pole: [299.36, 0, 43.46, 0, 249.978, 541.1397757, [[0.70, -0.51, -0.48, 357.85, 52.316]]], atm: [100, 1000], atmR: 24622,
    orb: { jpl: [[30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
                 [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664]] } },
  // simplified model only: a free-form body the user edits
  custom: { color: '#b590f2', simple: { mass: 1e23, radius: 2000, a: 500000 } },
};

// Where the textures come from (credit lines and licence notes: i18n cred.src.<id>, cred.lic.<id>) and the data
// sources listed in the Sources window (i18n cred.data.<id>).
const TEX_SRC = {
  nasa3d: 'https://github.com/nasa/NASA-3D-Resources/tree/master/Images%20and%20Textures',
  usgs: 'https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_basemap_enhanced_color_global_mosaic_665m',
  bmng: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography/',
  svs: 'https://svs.gsfc.nasa.gov/4720/',
  pj: 'https://science.nasa.gov/photojournal/cassinis-best-maps-of-jupiter-cylindrical-map/',
  vtad: 'https://science.nasa.gov/resource/saturn-3d-model/',
  mdim: 'https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m',
  mola: 'https://pds-geosciences.wustl.edu/missions/mgs/megdr.html',
  usgsDem: 'https://astrogeology.usgs.gov/search/map/mercury_messenger_global_dem_665m',
  eoClouds: 'https://science.nasa.gov/earth/earth-observatory/the-blue-marble-true-color-global-imagery-at-1km-resolution/',
  blackMarble: 'https://science.nasa.gov/earth/earth-observatory/earth-at-night/maps/',
  gebco: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/topography-bathymetry-maps/',
  pps: 'https://pds-rings.seti.org/holdings/volumes/VG_28xx/VG_2801/',
  svsStars: 'https://svs.gsfc.nasa.gov/4851/',
  coiss: 'https://pds-rings.seti.org/holdings/volumes/COISS_3xxx/',
  dawnCeres: 'https://astrogeology.usgs.gov/search/map/ceres_dawn_fc_global_mosaic_400m',
  dawnVesta: 'https://astrogeology.usgs.gov/search/map/vesta_dawn_fc_hamo_global_mosaic_60m',
  bsc: 'https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50',
};
// The sky (normal 2D and 3D modes; never in the low-resource mode): the Milky Way — NASA SVS 4851 "Deep Star Maps 2020",
// milkyway_2020_4k.exr (4096×2048 half-float, linear, celestial ICRF/J2000 plate carrée centred on 0h, right ascension
// increasing to the left; the map without the Hipparcos/Tycho stars, 57dd45a9…, values 0..1) through one contrast curve
// on its luminance Y (Rec. 709), each pixel's RGB scaled by S(Y)/Y so the colours stay the source's (5644 pixels of the
// core scaled down to keep their hue at a channel of 1): x = s·ln(1 + e^((Y − b)/s)), S = min(1, x/(Yw − b))^γ with
// b = 0.018 (above the median: the dark sky and its faint grain go to near black, smoothly), s = 0.004, Yw = 0.6,
// γ = 1.1; stored as sRGB JPEG (4:4:4, quality 94): 4096×2048 (the hi tier, fetched only where the screen magnifies the
// base) and 2048×1024 (the base, averaged down in linear light); the app shows S × SKY_GAIN × the viewer's gain × the eye
// adaptation. Stars — the Yale Bright Star Catalogue, 5th ed. (Hoffleit & Warren 1991, CDS V/50,
// catalog.gz, 6c533fd0…): the 9096 entries with a position and V magnitude, packed 8 bytes each (little-endian):
// uint16 RA·65536/360°, int16 Dec·32767/90°, int16 V·100, int16 (B−V)·1000 (−32768: no colour index; 310 stars).
const SKY = { milky: { file: 'img/sky/milkyway.jpg', w: 2048, src: 'svsStars', hi: [[4096, 'img/sky/milkyway_4k.jpg']] }, stars: { file: 'img/sky/bsc5.bin', src: 'bsc' } };
const DATA_SRC = {
  jpl: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html',
  sat: 'https://ssd.jpl.nasa.gov/sats/elem/',
  satPhys: 'https://ssd.jpl.nasa.gov/sats/phys_par/',
  sbdb: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html',
  pck: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc',
  amat: 'https://github.com/athulpg007/AMAT',
  rings: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html',
  nssdc: 'https://nssdc.gsfc.nasa.gov/planetary/planetfact.html',
  three: 'https://threejs.org/',
  usage: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
};

// AMAT [h_low, h_skip] as altitudes above this app's radius (km), or null without atmosphere data.
function atmAltitudes(key) {
  const b = BODIES[key];
  if (!b || !b.atm) return null;
  return b.atm.map(h => b.atmR + h - b.radius);
}

if (typeof module !== 'undefined') module.exports = { BODIES, EPHEM_YEARS, atmAltitudes, TEX_SRC, DATA_SRC, SKY };
