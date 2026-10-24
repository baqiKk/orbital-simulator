// Planet looks (Phases 5b, 5c): surface textures and their tiers, body orientation, the 2D globe renderer, the sky and
// the Sun's glare. Classic script loaded after core.js and before mode3d.js / app.js; declarations only.
//
// Textures (js/bodies.js tex / texAlt / rings / relief / clouds / night / ocean, SKY) are fetched lazily through
// texReady(): only when the caller says it wants one — the normal 2D and 3D modes, once the body is TEX_MIN_PX across on
// screen. The low-resource mode never asks, so it never downloads an image (no CSS or HTML refers to them either;
// ui.test.js checks both). Sharper tiers (hi) are asked for only once the globe is large enough on screen for them
// (texTier), at most two 4k ones at a time; a tier unused for EVICT_MS is dropped (its GPU copy too).
// 2D normal mode: a small WebGL 2 canvas off screen draws a lit, textured globe (its rings and haze) for the visible part
// of a body's disc, then drawImage() copies it onto the 2D plot. The same GLSL (GLOBE_GLSL) is used by the 3D view's
// materials (js/view3d.js), so both modes show the same thing.

const TEX_MIN_PX = 6;   // on-screen radius (px) from which a body gets its texture
const TEX_FADE = 300;   // ms: a texture (or a sharper tier) fades in once loaded
const EVICT_MS = 30000; // a sharper tier not drawn for this long is dropped
const BIG_MAX = 2;      // tiers wider than 2048 px held at once
const RELIEF_PX = 40, SHADOW_PX = 140; // on-screen radius from which relief, then cast shadows are drawn
const TEXOPT = { venusRadar: false, clouds: true };
const TEXC = new Map(); // file -> { img, ok, err, t, used, hi }
const TEX_DROP = [];    // callbacks (img) => void: free the GPU copies of a dropped image

// what a body looks like: texture specs or null, colour saturation, limb darkening (untextured planets), rings, layers
function lookOf(key) {
  const b = BODIES[key]; if (!b) return null;
  const tex = key === 'venus' ? (TEXOPT.venusRadar ? b.texAlt : null) : b.tex || null;
  return { b, tex, sat: tex && tex.sat != null ? tex.sat : 1, limb: !tex && b.parent === 'sun', rings: b.rings || null, glow: b.glow ? [...linC(b.glow[0]), b.glow[1]] : [0, 0, 0, 0] };
}
// the image for file once loaded (else null); want: allowed to start the download now
function texReady(file, want) {
  let e = TEXC.get(file);
  if (!e) {
    if (!want) return null;
    e = { img: new Image(), ok: false, err: false, t: 0, used: 0 };
    e.img.decoding = 'async';
    e.img.onload = () => { e.ok = true; e.t = performance.now(); };
    e.img.onerror = () => { e.err = true; };
    e.img.src = file;
    TEXC.set(file, e);
  }
  e.used = performance.now();
  return e.ok ? e : null;
}
const texMix = e => (e ? Math.min(1, (performance.now() - e.t) / TEX_FADE) : 0);

// ---------- tiers ----------
// spec: { file, w?, hi?: [[width, file], …] } -> [[width, file], …] from the base up
const tiersOf = spec => [[spec.w || 1024, spec.file], ...(spec.hi || [])];
// Pure: index of the tier for a globe r px in radius. A tier is enough once it has about one texel per screen pixel at
// the centre of the disc (width ≥ 2π r · 0.75); cap: widest tier allowed (mode, device, quality ladder); cur: the tier
// wanted so far, kept until the lower one has 25 % to spare (no flicker at a threshold).
function texTier(widths, r, cap, cur) {
  const need = 2 * Math.PI * r * 0.75;
  let k = 0;
  while (k + 1 < widths.length && widths[k + 1] <= cap && widths[k] < need) k++;
  if (cur != null && cur > k && cur < widths.length && widths[cur] <= cap && widths[k] < need * 1.25) k = cur;
  return k;
}
const TIER = new Map(); // spec -> { want, shown, prev, t } (tier indices; prev fades out over TEX_FADE)
const BIG = new Map();  // body -> last time a tier wider than 2048 was wanted for one of its layers
// the loaded image entry of spec to draw for a globe r px across (lower tiers stand in until a sharper one loads) and the
// one it replaces while that fades in: { e, old, mix }; owner: the body (at most BIG_MAX bodies hold 4k tiers)
function tierTex(spec, r, cap, fetch, owner) {
  const T = tiersOf(spec), now = performance.now();
  let st = TIER.get(spec); if (!st) TIER.set(spec, st = { want: 0, shown: -1, prev: -1, t: 0 });
  let k = texTier(T.map(t => t[0]), r, cap, st.want);
  if (T[k][0] > 2048) { // at most BIG_MAX bodies hold a 4k tier
    let n = 0; for (const [o, t] of BIG) if (o !== owner && now - t < 2000) n++;
    if (n >= BIG_MAX) k = Math.max(0, T.findIndex(t => t[0] > 2048) - 1); else BIG.set(owner, now);
  }
  st.want = k;
  // the base loads first (small), then the wanted tier; the best loaded one at or below the wanted is shown
  let best = -1, be = null;
  for (let i = 0; i <= k; i++) { const e = texReady(T[i][1], fetch && (i === 0 || i === k)); if (e) { best = i; be = e; } }
  if (best < 0) return null;
  if (best !== st.shown) { st.prev = st.shown; st.shown = best; st.t = now; }
  const f = Math.min(1, (now - st.t) / TEX_FADE), old = st.prev >= 0 && f < 1 ? TEXC.get(T[st.prev][1]) : null;
  if (old) old.used = now;
  return { e: be, old: old && old.ok ? old : null, mix: old ? 1 - f : 0 };
}
// drop sharper tiers nobody drew for EVICT_MS (base files stay)
let evictT = 0;
function texEvict() {
  const now = performance.now(); if (now - evictT < 5000) return; evictT = now;
  const base = new Set(); for (const b of Object.values(BODIES)) for (const s of [b.tex, b.texAlt, b.relief, b.clouds, b.night, b.ocean]) if (s) base.add(s.file);
  for (const [f, e] of TEXC) if (!base.has(f) && e.ok && now - e.used > EVICT_MS && /img\/planets\//.test(f)) { TEXC.delete(f); for (const d of TEX_DROP) d(e.img); }
}

// ---------- body axes ----------
// Body-fixed axes -> ecliptic (row-major, columns = body x, y, z) at t (s since J2000; the simplified model uses its
// own clock): IAU rotation (pole), or a synchronous moon's prime meridian towards its parent (lock; positions and
// velocities P, V with 3 per body, body i, parent p; without the parent in the mission, as for maneuvers about the
// Moon, from the moon's own elements), else the ecliptic axes. The pole of a lock moon is its orbit normal, or its
// IAU pole where the table gives one (axis), the prime meridian then towards the parent projected on the equator.
const LOCK_EL = {};
function bodyAxes(key, t, P, V, i, p, out) {
  const b = BODIES[key];
  if (b && b.pole) return bodyFrame(b.pole, t, out);
  if (b && b.lock && (p >= 0 || b.orb)) {
    let r, v;
    if (p >= 0) {
      r = [P[3 * i] - P[3 * p], P[3 * i + 1] - P[3 * p + 1], P[3 * i + 2] - P[3 * p + 2]];
      v = [V[3 * i] - V[3 * p], V[3 * i + 1] - V[3 * p + 1], V[3 * i + 2] - V[3 * p + 2]];
    } else {
      const q = new Array(6); orbitState(LOCK_EL[key] || (LOCK_EL[key] = orbitElements(b.orb)), t, q, 0);
      r = q.slice(0, 3); v = q.slice(3);
    }
    const rl = Math.hypot(...r);
    let x = r.map(c => -c / rl), z;
    if (b.axis) {
      const F = equatorFrame(b.axis, t, 4), d = x[0] * F[2] + x[1] * F[5] + x[2] * F[8];
      z = [F[2], F[5], F[8]]; x = x.map((c, k) => c - d * z[k]);
      const xl = Math.hypot(...x); x = x.map(c => c / xl);
    } else {
      z = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
      const zl = Math.hypot(...z); z = z.map(c => c / zl);
    }
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    for (let k = 0; k < 3; k++) { out[3 * k] = x[k]; out[3 * k + 1] = y[k]; out[3 * k + 2] = z[k]; }
    return out;
  }
  out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0; out[4] = 1; out[5] = 0; out[6] = 0; out[7] = 0; out[8] = 1;
  return out;
}
// R (rows: view axes in ecliptic coordinates) · A (body -> ecliptic) = body -> view
function axesIn(X, Y, Z, A, out) {
  for (let c = 0; c < 3; c++) {
    out[c] = X[0] * A[c] + X[1] * A[3 + c] + X[2] * A[6 + c];
    out[3 + c] = Y[0] * A[c] + Y[1] * A[3 + c] + Y[2] * A[6 + c];
    out[6 + c] = Z[0] * A[c] + Z[1] * A[3 + c] + Z[2] * A[6 + c];
  }
  return out;
}

// ---------- shared GLSL ----------
// Display values: linear light, a sunlit white surface = 1. Tone mapping only compresses what lies above 0.76 (the Sun,
// glints, glare): the shoulder of Khronos' PBR Neutral operator without its toe, so the albedo maps come out as they
// are (checked against NASA's Blue Marble: ACES would darken and desaturate them).
const TONEMAP_GLSL = `
vec3 toneMap(vec3 c) {
  float peak = max(c.r, max(c.g, c.b));
  if (peak < 0.76) return c;
  float np = 1.0 - 0.0576 / (peak + 0.24 - 0.76);
  c *= np / peak;
  return mix(c, vec3(np), 1.0 - 1.0 / (0.15 * (peak - np) + 1.0));
}`;
// GLSL ES 3.00: b / n is a body-fixed unit vector (z north, x the prime meridian), s the Sun direction and v the
// direction to the viewer in the same axes, planet radius 1. Equirectangular lookup with seam-free derivatives (two
// longitude cuts, the smoother wins), saturation, terminator, relief (normals from the height map, Lommel–Seeliger
// photometry, cast shadows by marching the height map towards the Sun), Earth's layers (clouds and their shadows, city
// lights, the Sun's glint on water), a thin atmosphere glow, a thick hazy shell (single scattering), Saturn's rings from
// their optical depth (lit and unlit face, the planet's shadow, the rings' shadow on the planet).
const GLOBE_GLSL = `
uniform vec3 uColor;
uniform vec4 uGlow;
uniform float uTex, uMix, uMix2, uSat, uLimb, uRing, uRingHas, uTauHas, uPhot, uEmit, uCloudRot;
uniform sampler2D uMap, uMap2, uRingMap, uTau, uClouds, uNight, uOcean, uRelief;
uniform vec2 uRingR;
uniform vec4 uLayers;   // clouds, city lights, glint, relief (1 = on)
uniform vec4 uRelief4;  // lowest and highest height (body radii), cast shadows (1 = on), the Sun's angular radius (rad)
uniform vec4 uHaze;     // on, scale height, vertical optical depth, top (body radii)
uniform vec4 uHazeC;    // haze colour (linear), Henyey–Greenstein g
uniform vec3 uHazeL;    // detached layer: altitude, width (body radii), density relative to the base
vec2 globeUV(vec3 b) {
  float u = atan(b.y, b.x) / 6.2831853 + 0.5, v = 0.5 + asin(clamp(b.z, -1.0, 1.0)) / 3.1415927;
  float u2 = fract(u + 0.5) - 0.5;
  return vec2(fwidth(u) <= fwidth(u2) + 1e-6 ? u : u2, v);
}
vec2 dirUV(vec3 b) { return vec2(atan(b.y, b.x) / 6.2831853 + 0.5, 0.5 + asin(clamp(b.z, -1.0, 1.0)) / 3.1415927); }
vec3 satur(vec3 c, float s) { return mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, s); }
float globeDay(vec3 n, vec3 s) { return smoothstep(-0.06, 0.3, dot(n, s)); }
// night side stays nearly black (the albedo is sRGB: 0.035 linear would still show as a dull 20 % grey)
float globeLit(float day) { return 0.004 + 0.996 * day; }
// thin atmosphere glow towards the limb (linear colour + strength in a): strong on the lit side, faint at night. Its
// shape follows a DSCOVR EPIC full-disc photo (2024-06-21 10:16 UTC): rising from the centre, level from mu ~ 0.45 on,
// so Earth's mean brightness by mu matches the photo (centre 0.191 vs 0.196 linear; the limb dims as in the photo)
vec3 atmGlow(vec3 n, vec3 s, float mu, vec4 a) {
  float rim = pow(clamp((1.0 - mu) / 0.55, 0.0, 1.0), 1.5), lit = 0.06 + 0.94 * smoothstep(-0.3, 0.5, dot(n, s));
  return a.rgb * a.a * rim * lit * 0.2;
}
// ring colour strip at radial coordinate x (0..1): the texture, or a flat colour until it has loaded
vec4 ringSample(sampler2D rm, float x) { return uRingHas > 0.5 ? texture(rm, vec2(x, 0.5)) : vec4(0.52, 0.42, 0.29, 0.7); }
// untextured planets: Lambert fall-off towards the terminator and limb darkening (mu: cosine of the view angle)
float plainShade(vec3 n, vec3 s, float mu) { return (0.4 + 0.6 * clamp(dot(n, s), 0.0, 1.0)) * (0.25 + 0.75 * pow(max(mu, 0.0), 0.6)); }
// rings: normal optical depth at x (the occultation strip, or the colour strip's alpha until it has loaded)
float ringTau(float x) {
  float o = uTauHas > 0.5 ? texture(uTau, vec2(x, 0.5)).r : ringSample(uRingMap, x).a;
  return -log(max(1.0 - o, 0.002));
}
// sunlight getting through the rings to point p
float ringShadow(vec2 rr, vec3 p, vec3 s) {
  if (abs(s.z) < 1e-5) return 1.0;
  float t = -p.z / s.z; if (t <= 0.0) return 1.0;
  float r = length(p.xy + t * s.xy); if (r < rr.x || r > rr.y) return 1.0;
  return exp(-ringTau((r - rr.x) / (rr.y - rr.x)) / abs(s.z));
}
float sphereShadow(vec3 p, vec3 s) {
  float b = dot(p, s), c = dot(p, p) - 1.0, d = b * b - c;
  return d > 0.0 && -b - sqrt(d) > 0.0 ? 0.06 : 1.0;
}
// premultiplied colour of the rings at x: single scattering by a layer of optical depth tau, lit face (Sun and viewer on
// the same side) or light coming through it; scaled so a thick ring seen like the Sun shows its colour strip. The F ring
// (outermost ~0.7 %) is mostly dust and scatters forward (Henyey–Greenstein g = 0.7). sh: the planet's shadow.
vec4 ringShade(float x, vec3 s, vec3 v, float sh) {
  vec3 alb = ringSample(uRingMap, x).rgb;
  float tau = ringTau(x), mu = max(abs(v.z), 0.01), mu0 = abs(s.z), f = 0.0;
  if (mu0 > 1e-4) {
    if (s.z * v.z > 0.0) f = mu0 / (mu0 + mu) * (1.0 - exp(-tau * (1.0 / mu0 + 1.0 / mu)));
    else f = abs(mu0 - mu) < 1e-3 ? tau / mu * exp(-tau / mu) : mu0 / (mu0 - mu) * (exp(-tau / mu0) - exp(-tau / mu));
  }
  float cs = dot(-s, v), hg = 0.51 / pow(1.49 - 1.4 * cs, 1.5);
  vec3 L = alb * 2.0 * f * mix(1.0, hg, smoothstep(0.990, 0.993, x));
  return vec4(L * sh, 1.0 - exp(-tau / mu));
}
// relief: height (body radii) at uv, the mip level matching the screen footprint, normal from the heights, and the
// light left after the terrain towards the Sun (horizon angle against the Sun's elevation, the Sun's disc as penumbra)
float hgt(vec2 uv, float lod) { return mix(uRelief4.x, uRelief4.y, textureLod(uRelief, uv, lod).r); }
float reliefLod(vec2 uv) { vec2 f = fwidth(uv) * vec2(textureSize(uRelief, 0)); return max(0.0, log2(max(max(f.x, f.y), 1e-6))); }
vec3 reliefN(vec3 n, vec2 uv, float lod, out float h0) {
  vec2 d = exp2(lod) / vec2(textureSize(uRelief, 0));
  h0 = hgt(uv, lod);
  float gE = (hgt(uv + vec2(d.x, 0.0), lod) - hgt(uv - vec2(d.x, 0.0), lod)) / (2.0 * d.x * 6.2831853 * max(length(n.xy), 0.02));
  float gN = (hgt(uv + vec2(0.0, d.y), lod) - hgt(uv - vec2(0.0, d.y), lod)) / (2.0 * d.y * 3.1415927);
  vec3 e = normalize(vec3(-n.y, n.x, 0.0) + vec3(1e-7, 0.0, 0.0)), nn = cross(n, e);
  return normalize(n - gE * e - gN * nn);
}
float reliefShadow(vec3 n, vec3 s, float h0, float lod) {
  float mu0 = dot(n, s); vec3 t = s - n * mu0; float tl = length(t);
  if (tl < 1e-4 || mu0 > 0.6) return 1.0;
  t /= tl;
  float elev = atan(mu0, tl), r0 = 1.0 + h0, hor = -2.0, d = 6.2831853 / float(textureSize(uRelief, 0).x) * exp2(lod);
  for (int k = 0; k < 14; k++) {
    vec3 q = n * cos(d) + t * sin(d); float rq = 1.0 + hgt(dirUV(q), lod);
    hor = max(hor, atan(rq * cos(d) - r0, rq * sin(d)));
    d *= 1.5;
  }
  return smoothstep(-uRelief4.w, uRelief4.w, elev - hor);
}
// lit colour (linear, before tone mapping) of the globe at n; rs: sunlight left after the rings
vec3 globeColor(vec3 n, vec3 s, vec3 v, float rs) {
  vec2 uv = globeUV(n);
  vec3 base = uColor;
  if (uTex > 0.5) {
    vec3 t = satur(texture(uMap, uv).rgb, uSat);
    if (uMix2 > 0.0) t = mix(t, satur(texture(uMap2, uv).rgb, uSat), uMix2);
    base = mix(uColor, t, uMix);
  }
  if (uEmit > 0.5) return base * 4.0; // the Sun: well above white, compressed by the tone mapping
  float mu0 = dot(n, s), mu = dot(n, v), lit;
  if (uLayers.w > 0.5) { // relief: Lommel–Seeliger on the terrain's normal, cast shadows
    float lod = reliefLod(uv), h0; vec3 np = reliefN(n, uv, lod, h0);
    float m0 = max(dot(np, s), 0.0);
    lit = min(1.6, 2.0 * m0 / (m0 + max(dot(np, v), 0.0) + 1e-3)) * smoothstep(-0.01, 0.01, mu0);
    if (uRelief4.z > 0.5 && mu0 > -0.05) lit *= reliefShadow(n, s, h0, lod);
  } else if (uPhot > 0.5) lit = max(mu0, 0.0);
  else lit = globeLit(globeDay(n, s));
  lit *= rs;
  vec3 col = base * lit * (uLimb > 0.5 ? plainShade(n, s, mu) : 1.0);
  float ca = 0.0;
  if (uLayers.x > 0.5) { // clouds: their shadow a little towards the Sun (~10 km up), then the clouds themselves
    vec2 du = dFdx(uv), dv = dFdy(uv);
    ca = texture(uClouds, uv + vec2(uCloudRot, 0.0)).r;
    vec3 sp = normalize(n + s * (0.0016 / max(mu0, 0.12)));
    col *= 1.0 - 0.55 * textureGrad(uClouds, dirUV(sp) + vec2(uCloudRot, 0.0), du, dv).r;
  }
  if (uLayers.z > 0.5) { // the Sun's glint on water (Blinn–Phong, Fresnel; same units as the diffuse albedo)
    vec3 w = texture(uOcean, uv).rgb, hv = normalize(s + v);
    float water = smoothstep(0.03, 0.08, max(w.r, max(w.g, w.b)));
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(hv, v), 0.0), 5.0);
    col += vec3(water * (1.0 - ca) * F * 28.5 * pow(max(dot(n, hv), 0.0), 220.0) * max(mu0, 0.0)) * rs;
  }
  if (uLayers.x > 0.5) col = mix(col, vec3(0.85 * lit), ca);
  if (uLayers.y > 0.5) col += texture(uNight, uv).rgb * vec3(1.0, 0.78, 0.5) * 0.6 * (1.0 - smoothstep(-0.12, 0.02, mu0)) * (1.0 - ca);
  return col + atmGlow(n, s, mu, uGlow);
}
// a thick hazy shell (Venus, Titan) along the ray ro + t rd (body radii, planet at the origin): premultiplied colour of
// the light it scatters towards the viewer (single scattering, half Henyey–Greenstein half isotropic for the multiple
// scattering it leaves out) and its opacity; stops at the surface, sunlight dimmed by the slant column above each point
vec4 hazeRay(vec3 ro, vec3 rd, vec3 s) {
  float R1 = 1.0 + uHaze.w, b = dot(ro, rd), D = b * b - dot(ro, ro) + R1 * R1;
  if (D <= 0.0) return vec4(0.0);
  float t0 = max(0.0, -b - sqrt(D)), t1 = -b + sqrt(D), Ds = b * b - dot(ro, ro) + 1.0;
  if (Ds > 0.0) { float ts = -b - sqrt(Ds); if (ts > 0.0) t1 = min(t1, ts); }
  if (t1 <= t0) return vec4(0.0);
  float H = uHaze.y, k = uHaze.z / H, g = uHazeC.a, cs = dot(rd, s);
  float ph = 0.5 + 0.5 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cs, 1.5);
  // steps crowd quadratically towards the ray's lowest point (most of the haze is within a few scale heights of it):
  // 12 before it, 12 after, in order along the ray
  float tc = clamp(-b, t0, t1), tau = 0.0, L = 0.0;
  for (int i = 0; i < 24; i++) {
    float j = i < 12 ? float(11 - i) : float(i - 12), sg = i < 12 ? -1.0 : 1.0, len = i < 12 ? tc - t0 : t1 - tc;
    float dt = len * (2.0 * j + 1.0) / 144.0;
    vec3 p = ro + rd * (tc + sg * len * (j + 0.5) * (j + 0.5) / 144.0); float r = length(p), h = r - 1.0;
    float rho = exp(-h / H) + uHazeL.z * exp(-(h - uHazeL.x) * (h - uHazeL.x) / (uHazeL.y * uHazeL.y)), dtau = k * rho * dt;
    // sunlight at p: the surface's shadow (softened over a scale height) and the slant column towards the Sun, a
    // continuous air mass (Chapman's horizontal value amh at cz = 0, up to twice it below the local horizon)
    float cz = dot(p, s) / r, amh = sqrt(1.5708 * r / H);
    float lit = cz >= 0.0 ? 1.0 : smoothstep(0.0, H, r * sqrt(max(0.0, 1.0 - cz * cz)) - 1.0);
    float am = cz >= 0.0 ? 1.0 / (cz + 1.0 / amh) : amh * (1.0 + min(1.0, -cz * amh));
    L += exp(-tau - 0.5 * dtau) * dtau * lit * exp(-uHaze.z * exp(-h / H) * am);
    tau += dtau;
  }
  return vec4(uHazeC.rgb * 2.0 * L * ph, 1.0 - exp(-tau));
}
`;

// ---------- 2D globe renderer (normal 2D mode) ----------
const GLB = { cv: null, gl: null, u: null, tex: new Map(), white: null, fail: false };
const GLOBE_VS = `#version 300 es
in vec2 aP; uniform vec4 uRect; out vec2 vP;
void main() { vP = vec2(uRect.x + aP.x * uRect.z, uRect.y + aP.y * uRect.w); gl_Position = vec4(aP * 2.0 - 1.0, 0.0, 1.0); }`;
// screen axes: x right, y up, z towards the viewer (orthographic); uRot: body -> screen; output premultiplied sRGB
const GLOBE_FS = `#version 300 es
precision highp float;
in vec2 vP; out vec4 oC;
uniform mat3 uRot; uniform vec3 uSun; uniform float uPx;
${GLOBE_GLSL}
${TONEMAP_GLSL}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 p = vP; float d2 = dot(p, p), d = sqrt(d2);
  mat3 Rt = transpose(uRot); vec3 sO = Rt * uSun, vO = Rt * vec3(0.0, 0.0, 1.0);
  vec4 col = vec4(0.0); float zs = -2.0;
  if (d < 1.0 + 1.5 / uPx) {
    vec3 n = vec3(p, sqrt(max(0.0, 1.0 - d2))), b = Rt * n; zs = n.z;
    vec3 c = globeColor(b, sO, vO, uRing > 0.5 ? ringShadow(uRingR, b, sO) : 1.0);
    float cov = clamp((1.0 - d) * uPx + 0.5, 0.0, 1.0);
    col = vec4(c * cov, cov);
  }
  if (uHaze.x > 0.5) { vec4 h = hazeRay(Rt * vec3(p, 3.0), Rt * vec3(0.0, 0.0, -1.0), sO); col = h + col * (1.0 - h.a); }
  if (uRing > 0.5) {
    vec3 rn = uRot[2];
    if (abs(rn.z) > 1e-4) {
      float z = -(p.x * rn.x + p.y * rn.y) / rn.z;
      vec3 qb = Rt * vec3(p, z); float r = length(qb.xy);
      if (r >= uRingR.x && r <= uRingR.y && (d2 >= 1.0 || z > zs)) {
        vec4 rc = ringShade((r - uRingR.x) / (uRingR.y - uRingR.x), sO, vO, sphereShadow(qb, sO));
        col = rc + col * (1.0 - rc.a);
      }
    }
  }
  oC = col.a > 0.0 ? vec4(toSRGB(toneMap(col.rgb / col.a)) * col.a, col.a) : vec4(0.0);
}`;
const GLB_UNI = ['uRect', 'uRot', 'uSun', 'uColor', 'uTex', 'uSat', 'uLimb', 'uMix', 'uMix2', 'uPx', 'uRing', 'uRingR', 'uRingHas', 'uTauHas', 'uGlow', 'uPhot', 'uEmit',
  'uCloudRot', 'uLayers', 'uRelief4', 'uHaze', 'uHazeC', 'uHazeL'];
const GLB_SAMP = ['uMap', 'uMap2', 'uRingMap', 'uTau', 'uClouds', 'uNight', 'uOcean', 'uRelief']; // texture units 0..7
function globeInit() {
  if (GLB.gl || GLB.fail) return !!GLB.gl;
  try {
    const cv = document.createElement('canvas'), gl = cv.getContext('webgl2', { premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error('no webgl2');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, GLOBE_VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, GLOBE_FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'aP'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = {}; for (const n of [...GLB_UNI, ...GLB_SAMP]) u[n] = gl.getUniformLocation(pr, n);
    GLB_SAMP.forEach((n, i) => gl.uniform1i(u[n], i));
    GLB.white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, GLB.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); GLB.tex.clear(); GLB.gl = null; GLB.fail = true; });
    Object.assign(GLB, { cv, gl, u });
    TEX_DROP.push(img => { const t = GLB.tex.get(img); if (t && GLB.gl) GLB.gl.deleteTexture(t); GLB.tex.delete(img); });
    return true;
  } catch (e) { GLB.fail = true; return false; }
}
// colour images are sRGB (decoded to linear by the sampler); data (heights, cloud cover, masks, optical depth) as stored
function globeTexture(img, repeat, data) {
  let t = GLB.tex.get(img); if (t) return t;
  const gl = GLB.gl; t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, data ? gl.RGBA8 : gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  GLB.tex.set(img, t); return t;
}
const linC = h => { const n = parseInt(h.slice(1), 16), f = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return [f(n >> 16 & 255), f(n >> 8 & 255), f(n & 255)]; };
// the uniform values of a look (both renderers): layer switches, relief, haze, ring optical depth
function lookUniforms(L) {
  return {
    layers: [L && L.clouds ? 1 : 0, L && L.night ? 1 : 0, L && L.ocean ? 1 : 0, L && L.relief ? 1 : 0],
    relief: L && L.relief ? [L.relief.h[0], L.relief.h[1], L.shadow ? 1 : 0, L.sunAng] : [0, 0, 0, 0.0047],
    haze: L && L.haze ? [1, L.haze.H, L.haze.tau, L.haze.top] : [0, 1, 0, 0],
    hazeC: L && L.haze ? [...L.haze.col, L.haze.g] : [0, 0, 0, 0],
    hazeL: L && L.haze && L.haze.layer ? L.haze.layer : [0, 1, 0],
    cloudRot: L && L.clouds ? L.cloudRot : 0,
    phot: L && L.phot ? 1 : 0,
  };
}
// Draw a globe of radius r px centred at (x, y) onto ctx (W×H css px, pixel ratio dpr). o: rot (body -> screen,
// row-major), sun (screen axes, unit), color (hex), look (globeLook). Only the part of the disc (and rings, haze) inside
// the canvas is rendered. Returns false when it cannot draw (no WebGL 2): the caller draws its plain disc instead.
function drawGlobe(ctx, x, y, r, W, H, dpr, o) {
  if (!globeInit()) return false;
  const gl = GLB.gl, u = GLB.u, L = o.look, ring = L.ring, ext = r * Math.max(ring ? ring.r[1] : 1, L.haze ? 1 + L.haze.top : 1) + 1;
  const X0 = Math.max(0, Math.floor(x - ext)), X1 = Math.min(W, Math.ceil(x + ext)), Y0 = Math.max(0, Math.floor(y - ext)), Y1 = Math.min(H, Math.ceil(y + ext));
  if (X1 <= X0 || Y1 <= Y0) return true;
  const w = X1 - X0, h = Y1 - Y0, wd = Math.ceil(w * dpr), hd = Math.ceil(h * dpr);
  if (GLB.cv.width < wd || GLB.cv.height < hd) { GLB.cv.width = Math.max(GLB.cv.width, wd); GLB.cv.height = Math.max(GLB.cv.height, hd); }
  gl.viewport(0, 0, wd, hd);
  gl.uniform4f(u.uRect, (X0 - x) / r, (y - Y1) / r, w / r, h / r);
  gl.uniformMatrix3fv(u.uRot, true, o.rot); // GLSL mat3 is column-major: upload the transpose of the row-major matrix
  gl.uniform3f(u.uSun, o.sun[0], o.sun[1], o.sun[2]);
  gl.uniform3fv(u.uColor, linC(o.color));
  gl.uniform1f(u.uPx, r * dpr); gl.uniform1f(u.uSat, L.sat); gl.uniform1f(u.uLimb, L.limb ? 1 : 0); gl.uniform1f(u.uEmit, 0);
  const bind = (unit, img, repeat, data) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, img ? globeTexture(img, repeat, data) : GLB.white); };
  const t = L.tex;
  bind(0, t && t.e.img, true, false); bind(1, t && t.old && t.old.img, true, false);
  gl.uniform1f(u.uTex, t ? 1 : 0); gl.uniform1f(u.uMix, t ? texMix(t.base) : 0); gl.uniform1f(u.uMix2, t && t.old ? t.mix : 0);
  bind(2, ring && ring.e && ring.e.img, false, false); bind(3, ring && ring.tau && ring.tau.img, false, true);
  gl.uniform1f(u.uRing, ring ? 1 : 0);
  if (ring) { gl.uniform2f(u.uRingR, ring.r[0], ring.r[1]); gl.uniform1f(u.uRingHas, ring.e ? 1 : 0); gl.uniform1f(u.uTauHas, ring.tau ? 1 : 0); }
  bind(4, L.clouds && L.clouds.img, true, true); bind(5, L.night && L.night.img, true, false); bind(6, L.ocean && L.ocean.img, true, true); bind(7, L.relief && L.relief.e.img, true, true);
  const U = lookUniforms(L);
  gl.uniform4fv(u.uLayers, U.layers); gl.uniform4fv(u.uRelief4, U.relief); gl.uniform4fv(u.uHaze, U.haze); gl.uniform4fv(u.uHazeC, U.hazeC); gl.uniform3fv(u.uHazeL, U.hazeL);
  gl.uniform1f(u.uCloudRot, U.cloudRot); gl.uniform1f(u.uPhot, U.phot);
  gl.uniform4fv(u.uGlow, L.glow || [0, 0, 0, 0]);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  ctx.drawImage(GLB.cv, 0, GLB.cv.height - hd, wd, hd, X0, Y0, w, h);
  return true;
}
// the Sun's angular radius (rad) seen from body key: from its (or its planet's) mean distance
function sunAngOf(key) {
  let b = BODIES[key];
  while (b && b.parent && b.parent !== 'sun') b = BODIES[b.parent];
  const a = b && b.orb && b.orb.jpl ? b.orb.jpl[0][0] : 1;
  return 0.004652 / a;
}
// the look of body key drawn r px across: allow = the mode draws globes (Q.tex), fetch = new downloads allowed (not
// after the adaptive quality drop), cap = widest texture tier (px), fx = effects left on by the quality ladder
// ({ clouds, relief, glint }); t: seconds (the clouds' drift). null when a plain disc will do (low-resource mode, too
// small, nothing loaded yet and no plain globe to draw).
function globeLook(key, r, allow, fetch, cap, fx, t) {
  const L = lookOf(key); if (!L) return null;
  const want = allow && r >= TEX_MIN_PX, b = L.b;
  if (want) texEvict();
  const tx = L.tex && want ? tierTex(L.tex, r, cap || 1024, fetch, key) : null;
  if (tx) { const be = TEXC.get(tiersOf(L.tex)[0][1]); tx.base = be && be.ok ? be : tx.e; } // the first fade-in follows the base image
  const ring = L.rings ? texReady(L.rings.file, want && fetch) : null, tau = L.rings && L.rings.tau ? texReady(L.rings.tau.file, want && fetch) : null;
  const layer = (spec, on) => (spec && on && want ? tierTex(spec, r, cap || 1024, fetch, key) : null);
  const rel = layer(b.relief, fx && fx.relief && r >= RELIEF_PX);
  const cl = layer(b.clouds, fx && fx.clouds && TEXOPT.clouds), ni = layer(b.night, true), oc = layer(b.ocean, fx && fx.glint);
  if (!want || (!tx && !L.limb && !L.rings && !b.haze)) return null;
  return { tex: tx, sat: L.sat, limb: L.limb, glow: b.haze ? [0, 0, 0, 0] : L.glow, phot: b.phot === 'lambert',
    ring: L.rings ? { e: ring, tau, r: L.rings.r.map(q => q * L.rings.req / b.radius) } : null,
    relief: rel ? { e: rel.e, h: b.relief.h.map(m => m / 1000 / b.radius) } : null, shadow: !!rel && r >= SHADOW_PX, sunAng: sunAngOf(key),
    clouds: cl && cl.e, cloudRot: ((t || 0) / (20 * 86400)) % 1, night: ni && ni.e, ocean: oc && oc.e,
    haze: b.haze && !(key === 'venus' && TEXOPT.venusRadar) ? { H: b.haze.H / b.radius, tau: b.haze.tau, top: b.haze.top / b.radius, g: b.haze.g, col: linC(b.color),
      layer: b.haze.layer ? [b.haze.layer[0] / b.radius, b.haze.layer[1] / b.radius, b.haze.layer[2]] : null } : null };
}

// ---------- sky ----------
// Milky Way image and the bright stars (unit vectors in ecliptic J2000 axes, V magnitude, linear colour from B−V), loaded
// the first time a mode with stars asks (Q.stars); null until both are in.
const SKYC = { stars: null, req: false, milky: null };
const OBLIQ = 23.4392911 * Math.PI / 180; // J2000 obliquity: equatorial -> ecliptic about +x
function skyReady(want) {
  const m = texReady(SKY.milky.file, want);
  if (want && !SKYC.req) {
    SKYC.req = true;
    fetch(SKY.stars.file).then(r => (r.ok ? r.arrayBuffer() : null)).then(buf => { if (buf) SKYC.stars = starsFrom(new DataView(buf)); }).catch(() => {});
  }
  return m && SKYC.stars ? { milky: m, stars: SKYC.stars } : null;
}
function starsFrom(dv) {
  const n = dv.byteLength / 8, dir = new Float32Array(3 * n), mag = new Float32Array(n), col = new Float32Array(3 * n), ce = Math.cos(OBLIQ), se = Math.sin(OBLIQ);
  for (let i = 0; i < n; i++) {
    const ra = dv.getUint16(8 * i, true) / 65536 * 2 * Math.PI, de = dv.getInt16(8 * i + 2, true) / 32767 * Math.PI / 2, bv = dv.getInt16(8 * i + 6, true);
    const x = Math.cos(de) * Math.cos(ra), y = Math.cos(de) * Math.sin(ra), z = Math.sin(de);
    dir[3 * i] = x; dir[3 * i + 1] = ce * y + se * z; dir[3 * i + 2] = -se * y + ce * z;
    mag[i] = dv.getInt16(8 * i + 4, true) / 100;
    col.set(bv === -32768 ? [1, 1, 1] : starRGB(bv / 1000), 3 * i);
  }
  return { n, dir, mag, col };
}
// star colour (linear sRGB, brightest channel 1) from B−V: temperature (Ballesteros 2012), then a black body seen through
// the CIE 1931 colour matching functions (multi-lobe Gaussian fit, Wyman, Sloan & Shirley 2013)
function starRGB(bv) {
  const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const g = (l, m, s1, s2) => { const t = (l - m) / (l < m ? s1 : s2); return Math.exp(-0.5 * t * t); };
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const B = 1 / (Math.pow(l * 1e-9, 5) * (Math.exp(1.4388e-2 / (l * 1e-9 * T)) - 1));
    X += B * (1.056 * g(l, 599.8, 37.9, 31) + 0.362 * g(l, 442, 16, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2));
    Y += B * (0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1));
    Z += B * (1.217 * g(l, 437, 11.8, 36) + 0.681 * g(l, 459, 26, 13.8));
  }
  const c = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z].map(v => Math.max(v, 0));
  const m = Math.max(...c) || 1;
  return c.map(v => v / m);
}
// star brightness on screen: peak (linear, 1 = white) of a point of V magnitude m; brighter ones grow instead (STAR_M0
// shows as a just-white point)
const STAR_M0 = 1.0;
// the Milky Way's display gain (the map's 99.9th percentile is 1): near black, as next to the Sun's lit bodies (median
// sky ≈ sRGB 2/255, the brightest band ≈ 37/255); and the finest map level it is drawn from (1 = 1024 wide, ≈ 0.35° per
// texel, smoothed further by the cubic filter): the 2048 map's grain and JPEG blocks stay below what shows
const SKY_GAIN = 0.02, SKY_LOD = 1;
const starPeak = m => Math.pow(10, -0.4 * (m - STAR_M0));

// ---------- the Sun's glare ----------
// Radial profile around the Sun (L px: scale from the disc's size), the same in 2D (a sprite) and 3D (GLARE_FS):
// a bright core just outside the disc, a halo and a faint wide skirt (scattering in the eye or a camera's optics).
const GLARE_GLSL = `float glareI(float r) { return exp(-r * r / 0.3) + 0.3 / pow(1.0 + r * r / 1.96, 1.5) + 0.06 / (1.0 + r * r / 36.0); }`;
const glareI = r => Math.exp(-r * r / 0.3) + 0.3 / Math.pow(1 + r * r / 1.96, 1.5) + 0.06 / (1 + r * r / 36);
const glareL = rs => 3 * Math.max(rs, 1.5) + 12; // px
const GLARE_EXT = 20; // the sprite reaches 20 L
let GLARE_CV = null;
function glareSprite() {
  if (GLARE_CV) return GLARE_CV;
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), im = g.createImageData(n, n), col = [255, 243, 214];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const r = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2) * GLARE_EXT, a = Math.min(1, glareI(r) * (1 - Math.min(1, r / GLARE_EXT) ** 4)), k = 4 * (y * n + x);
    im.data[k] = col[0]; im.data[k + 1] = col[1]; im.data[k + 2] = col[2]; im.data[k + 3] = Math.round(255 * a);
  }
  g.putImageData(im, 0, 0);
  return (GLARE_CV = c);
}
