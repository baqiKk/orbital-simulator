// 3D renderer (Phase 5): a thin Three.js layer, loaded with import() only when the 3D mode is picked.
// No physics and no text here: mode3d.js hands over positions in metres (float64, view-frame coordinates) and
// this file turns them into Three.js objects. Precision: everything is drawn relative to the camera target
// (floating origin, recomputed in float64 each frame) and lines are split into chunks with their own float64
// origin, so the float32 vertex data only ever holds small offsets. Depth: logarithmic depth buffer; the custom
// shader materials below include Three's logdepthbuf chunks so they share the depth space of the built-in ones
// (and of LineMaterial), otherwise a body would not hide the path behind it.
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const KM = 1e-3;           // scene unit: km (positions arrive in metres)
export const FOV = 45;     // vertical field of view, degrees
const CHUNK = 256;         // points per line chunk (at most)
const CHUNK_REL = 1e5;     // a chunk ends when a point is this many local steps away from its origin

// Bodies: the unit sphere's object space is the body-fixed frame (the mesh is turned by the body's axes), so the
// object-space position is the surface direction. uSun: Sun direction, uCam: the camera (body radii) in those axes.
// Everything else — textures and their tiers, relief, Earth's layers, rings, haze — is the shared GLSL of js/globe.js
// (GLOBE_GLSL, a classic script loaded before this module), so 2D and 3D look the same. uEmit 1 = self-lit (the Sun).
// Colours are linear with a sunlit white = 1; the renderer's tone mapping (TONEMAP_GLSL) compresses what is brighter.
// uAx: a triaxial body's semi-axes over its radius (Phobos; else 1, 1, 1): the mesh is scaled by them, the texture is
// looked up along the planetocentric direction of the surface point and lit on the ellipsoid's normal (the Sun and the
// viewer turned by the rotation taking that normal onto the lookup direction, so the photometry sees the true angles).
export const BODY_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vO;
void main() {
  vO = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
export const BODY_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun, uCam, uAx;
varying vec3 vO;
${GLOBE_GLSL}
// the rotation taking unit a onto unit b, applied to x
vec3 rotTo(vec3 a, vec3 b, vec3 x) { vec3 c = cross(a, b); float d = dot(a, b); return x * d + cross(c, x) + c * dot(c, x) / max(1.0 + d, 1e-6); }
void main() {
  #include <logdepthbuf_fragment>
  vec3 o = normalize(vO), p = o * uAx, n = normalize(p), nl = normalize(o / uAx);
  vec3 s = rotTo(nl, n, uSun), v = rotTo(nl, n, normalize(uCam - p));
  gl_FragColor = vec4(globeColor(n, s, v, uRing > 0.5 ? ringShadow(uRingR, n, uSun) : 1.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// Saturn's rings: a flat annulus in the planet's equatorial plane (object space, planet radius 1), radial coordinate
// from the inner to the outer edge; optical depth, lit or unlit face and the planet's shadow (premultiplied output).
export const RING_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vR;
void main() {
  vR = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
export const RING_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun, uCam;
varying vec3 vR;
${GLOBE_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  vec3 p = vec3(vR.xy, 0.0);
  gl_FragColor = ringShade((length(vR.xy) - uRingR.x) / (uRingR.y - uRingR.x), uSun, normalize(uCam - p), sphereShadow(p, uSun));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// Thick hazy shell (Venus, Titan): a sphere of radius 1 + top around the body; each fragment integrates the haze along
// the ray from the camera (premultiplied output). Seen from inside the shell its far side is drawn instead.
export const HAZE_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vO;
void main() {
  vO = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
export const HAZE_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSun, uCam;
uniform float uInside;
varying vec3 vO;
${GLOBE_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  if (gl_FrontFacing == (uInside > 0.5)) discard;
  gl_FragColor = hazeRay(uCam, normalize(vO * (1.0 + uHaze.w) - uCam), uSun);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// Sky: the Milky Way on a sphere around the camera (object space = ecliptic J2000 axes; the mesh is turned into the
// view frame), the map in celestial coordinates (right ascension increasing to the left, 0h in the middle). Soft on
// purpose: a cubic B-spline (four bilinear taps) from mip level SKY_LOD or coarser, so the map's JPEG blocks and grain
// never show when it is magnified; dithered (no banding in the dark gradients); uGain: SKY_GAIN × the viewer's gain ×
// the eye adaptation. The stars are separate sharp points (STAR_*), scaled by the same adaptation.
const SKY_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vD;
void main() {
  vD = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const SKY_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMilky;
uniform float uGain;
varying vec3 vD;
#include <dithering_pars_fragment>
vec3 skyCubic(vec2 uv, int l) {
  vec2 sz = vec2(textureSize(uMilky, l)), p = uv * sz - 0.5, f = fract(p), i = p - f;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0, w3 = f * f * f / 6.0, w1 = 2.0 / 3.0 - f * f * (1.0 - 0.5 * f), w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3, s0 = (i - 0.5 + w1 / g0) / sz, s1 = (i + 1.5 + w3 / g1) / sz;
  float L = float(l);
  return g0.y * (g0.x * textureLod(uMilky, s0, L).rgb + g1.x * textureLod(uMilky, vec2(s1.x, s0.y), L).rgb)
       + g1.y * (g0.x * textureLod(uMilky, vec2(s0.x, s1.y), L).rgb + g1.x * textureLod(uMilky, s1, L).rgb);
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 e = normalize(vD);
  const float c = 0.9174820621, s = 0.3977771559; // J2000 obliquity: ecliptic -> equatorial
  vec3 q = vec3(e.x, c * e.y - s * e.z, s * e.y + c * e.z);
  float u = 0.5 - atan(q.y, q.x) / 6.2831853, u2 = fract(u + 0.5) - 0.5;
  vec2 uv = vec2(fract(u), 0.5 + asin(clamp(q.z, -1.0, 1.0)) / 3.1415927);
  // the screen footprint in texels of the full map (the u seam has a jump in u, not in u2)
  vec2 fp = vec2(min(fwidth(u), fwidth(u2)), fwidth(uv.y)) * vec2(textureSize(uMilky, 0));
  float lod = max(${SKY_LOD.toFixed(1)}, log2(max(max(fp.x, fp.y), 1e-6))), l0 = floor(lod);
  // towards the map's poles a pixel covers many columns but few rows: an isotropic level there draws radial streaks,
  // so beyond ~55° of declination the anisotropic hardware filter takes over (seam-free derivatives)
  float wp = smoothstep(0.80, 0.90, abs(q.z)), uf = fwidth(u) <= fwidth(u2) ? u : u2;
  vec2 gx = vec2(dFdx(uf), dFdx(uv.y)), gy = vec2(dFdy(uf), dFdy(uv.y));
  vec3 m = wp < 1.0 ? mix(skyCubic(uv, int(l0)), skyCubic(uv, int(l0) + 1), lod - l0) : vec3(0.0);
  if (wp > 0.0) m = mix(m, textureGrad(uMilky, uv, gx, gy).rgb, wp);
  gl_FragColor = vec4(m * uGain, 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}`;
// bright stars: points along their directions (ecliptic axes, same mesh turning), a Gaussian of the pixel ratio's size
// whose peak follows the flux; brighter than white, it widens instead (the light it carries keeps growing)
const STAR_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aPeak;
attribute vec3 aCol;
uniform float uDpr, uGain;
varying vec3 vC;
varying float vS;
void main() {
  float g = clamp(pow(aPeak, 0.35), 1.0, 4.0);
  vS = 0.6 * uDpr * g;
  vC = aCol * min(aPeak, 1.0) * uGain;
  gl_PointSize = 2.0 * ceil(3.0 * vS) + 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const STAR_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vC;
varying float vS;
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = (gl_PointCoord - 0.5) * (2.0 * ceil(3.0 * vS) + 1.0);
  gl_FragColor = vec4(vC * exp(-dot(d, d) / (2.0 * vS * vS)), 1.0);
  #include <colorspace_fragment>
}`;
// the Sun's glare: a screen-space quad (pixels) drawn after the scene, additive; profile GLARE_GLSL (js/globe.js)
const GLARE_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const GLARE_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uI, uExt;
varying vec2 vP;
${GLARE_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vP) * uExt, w = 1.0 - pow(min(1.0, r / uExt), 4.0);
  gl_FragColor = vec4(uColor * uI * glareI(r) * w, 1.0);
  #include <colorspace_fragment>
}`;
// Reference-plane grid: unit lattice scaled per frame, fading out towards its edge (uR, lattice units).
const GRID_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
const GRID_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uAlpha;
uniform float uR;
varying vec2 vP;
void main() {
  #include <logdepthbuf_fragment>
  float a = uAlpha * (1.0 - smoothstep(0.35 * uR, uR, length(vP)));
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

// The craft (Phase 18b): a plain low-poly model by engine type, lit by the Sun (uSun, world axes); the inside of an
// opened shell darker and plain; the cut faces of the cutaway (tank contents, grain) flat (uFlat). Colours are the
// theme's tokens. 2026-11-14: the outer surfaces carry procedural textures (uTex, uMap: canvases painted at build time
// from the tokens, no files: foam or foil insulation with seams, a composite case, cooling channels and heat tint on a
// nozzle), and a soft Sun highlight (uSpec, foil and metal shine).
export const CRAFT_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN, vW;
varying vec2 vUv;
varying float vY;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vUv = uv; vY = position.y;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;
export const CRAFT_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor, uSun, uBack;
uniform float uFlat, uTex, uSpec, uClip;
uniform sampler2D uMap;
varying vec3 vN, vW;
varying vec2 vUv;
varying float vY;
void main() {
  #include <logdepthbuf_fragment>
  if (vY > uClip) discard; // a liquid's surface (the cutaway's fills)
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  float d = dot(n, uSun), l = 0.3 + 0.7 * max(d, 0.0);
  vec3 base = uColor * (uTex > 0.5 && gl_FrontFacing ? texture2D(uMap, vUv).rgb : vec3(1.0));
  vec3 V = normalize(cameraPosition - vW), H = normalize(uSun + V);
  float sp = gl_FrontFacing && d > 0.0 ? uSpec * pow(max(dot(n, H), 0.0), 28.0) : 0.0;
  vec3 c = uFlat > 0.5 ? uColor * 0.92 : gl_FrontFacing ? base * l + sp : uBack * 0.38;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;
// ---- the craft's procedural textures (2026-11-14): 2D canvases, u around the body, v along its profile (v = 0 at the
// profile's first point: a tank's aft end, a nozzle's throat; three.js flips canvases, so v = 0 is the bottom row).
// C: the theme's colours (hex). One canvas per kind and palette, cached.
const hx = (a, b, f) => { const p = h => parseInt(h.slice(1), 16), x = p(a), y = p(b), c = k => Math.round(((x >> k) & 255) * (1 - f) + ((y >> k) & 255) * f); return '#' + ((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1); };
const rgba = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
function rnd(seed) { let t = seed >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }
const PAINT = {
  // white foam insulation (cryogenic tanks): off-white, speckled, weld rings at the domes and a few panel seams
  foam(x, w, h, C) {
    const r = rnd(7); x.fillStyle = hx(C.ink, C.warn, 0.1); x.fillRect(0, 0, w, h);
    for (let i = 0; i < 3200; i++) { x.fillStyle = r() < 0.5 ? rgba(C.solid, 0.07 + 0.08 * r()) : rgba('#ffffff', 0.1 * r()); x.fillRect(r() * w, r() * h, 1 + 2 * r(), 1 + 2 * r()); }
    for (let i = 0; i < 6; i++) { const g = x.createLinearGradient(0, 0, w, 0), u = r(); g.addColorStop(Math.max(0, u - 0.1), rgba(C.solid, 0)); g.addColorStop(u, rgba(C.solid, 0.06)); g.addColorStop(Math.min(1, u + 0.1), rgba(C.solid, 0)); x.fillStyle = g; x.fillRect(0, 0, w, h); }
    x.strokeStyle = rgba(C.faint, 0.85); x.lineWidth = 3;
    for (const v of [0.13, 0.87]) { x.beginPath(); x.moveTo(0, h * (1 - v)); x.lineTo(w, h * (1 - v)); x.stroke(); }
    x.strokeStyle = rgba(C.faint, 0.6); x.lineWidth = 1.5;
    for (const v of [0.37, 0.62]) { x.beginPath(); x.moveTo(0, h * (1 - v)); x.lineTo(w, h * (1 - v)); x.stroke(); }
    for (const u of [0, 0.25, 0.5, 0.75]) { x.beginPath(); x.moveTo(u * w + 0.5, h * 0.13); x.lineTo(u * w + 0.5, h * 0.87); x.stroke(); }
  },
  // quilted blanket insulation (2026-11-15, instead of gold foil): stitched squares, each a little puffed (lighter in the
  // middle), fine crinkles, taped seams; silver-grey
  quiltA(x, w, h, C) { quilt(x, w, h, C, hx(C.dim, C.ink, 0.5)); },
  // bare aluminium (an RP-1 tank): brushed grey, weld rings
  alu(x, w, h, C) {
    const r = rnd(5), b = hx(C.dim, C.ink, 0.3); x.fillStyle = b; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { x.fillStyle = rgba(r() < 0.5 ? C.solid : '#ffffff', 0.04 * r()); x.fillRect(0, r() * h, w, 1); }
    x.strokeStyle = rgba(C.faint, 0.8); x.lineWidth = 2;
    for (const v of [0.13, 0.5, 0.87]) { x.beginPath(); x.moveTo(0, h * (1 - v)); x.lineTo(w, h * (1 - v)); x.stroke(); }
  },
  // a composite case (a hybrid's): dark carbon weave and filament-wound helices
  carbon(x, w, h, C) {
    const b = hx(C.solid, C.faint, 0.3), k = 8; x.fillStyle = b; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w / k; i++) for (let j = 0; j < h / k; j++) {
      const g = (i + j) % 2 ? x.createLinearGradient(i * k, j * k, i * k + k, j * k) : x.createLinearGradient(i * k, j * k, i * k, j * k + k);
      g.addColorStop(0, rgba(C.solid, 0.5)); g.addColorStop(0.5, rgba(C.dim, 0.22)); g.addColorStop(1, rgba(C.solid, 0.5));
      x.fillStyle = g; x.fillRect(i * k, j * k, k, k);
    }
    x.strokeStyle = rgba(C.dim, 0.18); x.lineWidth = 1;
    for (let i = -h; i < w + h; i += 12) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h * 0.6, h); x.stroke(); x.beginPath(); x.moveTo(i, h); x.lineTo(i + h * 0.6, 0); x.stroke(); }
    x.strokeStyle = rgba(C.dim, 0.6); x.lineWidth = 2;
    for (const v of [0.1, 0.9]) { x.beginPath(); x.moveTo(0, h * (1 - v)); x.lineTo(w, h * (1 - v)); x.stroke(); }
  },
  // a solid motor's case: light grey metal, a lighter band, joint rings
  case(x, w, h, C) {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, hx(C.dim, C.ink, 0.45)); g.addColorStop(1, hx(C.dim, C.ink, 0.25));
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = rgba(C.ink, 0.25); x.fillRect(0, h * 0.42, w, h * 0.1);
    x.strokeStyle = rgba(C.faint, 0.9); x.lineWidth = 2;
    for (const v of [0.08, 0.3, 0.7, 0.92]) { x.beginPath(); x.moveTo(0, h * (1 - v)); x.lineTo(w, h * (1 - v)); x.stroke(); }
  },
  // a regeneratively cooled nozzle: from the throat (v = 0) the cooling channels in heat tint, gold at the throat
  // turning blue, then bare metal; the radiatively cooled extension (v > 0.45) dark metal
  nozLiq(x, w, h, C) {
    // v = 0 at the chamber's top: the chamber and the convergent part in plain channelled metal, the heat tint about the
    // throat (C.vt), the channels to the extension's joint (C.ve)
    const y = v => h * (1 - v), vt = C.vt, ve = C.ve, g = x.createLinearGradient(0, y(0), 0, y(ve));
    const at = v => Math.max(0, Math.min(1, v / ve));
    g.addColorStop(0, C.dim); g.addColorStop(at(vt - 0.12), hx(C.dim, C.orbit, 0.35)); g.addColorStop(at(vt - 0.04), hx(C.accent, C.warn, 0.4)); g.addColorStop(at(vt + 0.03), hx(C.warn, C.burn, 0.25)); g.addColorStop(at(vt + 0.1), hx(C.orbit, C.bad, 0.25)); g.addColorStop(at(vt + 0.2), hx(C.orbit, C.dim, 0.5)); g.addColorStop(1, C.dim);
    x.fillStyle = g; x.fillRect(0, y(ve), w, h * ve);
    for (let i = 0; i < w; i += 4) { x.fillStyle = rgba(C.solid, 0.35); x.fillRect(i, y(ve), 1, h * ve); x.fillStyle = rgba('#ffffff', 0.12); x.fillRect(i + 2, y(ve), 1, h * ve); }
    const e = x.createLinearGradient(0, y(ve), 0, 0); e.addColorStop(0, hx(C.solid, C.faint, 0.55)); e.addColorStop(1, hx(C.solid, C.faint, 0.3));
    x.fillStyle = e; x.fillRect(0, 0, w, y(ve));
    x.fillStyle = rgba(C.dim, 0.8); x.fillRect(0, y(ve) - 2, w, 3);
    x.strokeStyle = rgba(C.faint, 0.25); x.lineWidth = 1;
    for (let v = ve + 0.08; v < 1; v += 0.09) { x.beginPath(); x.moveTo(0, y(v)); x.lineTo(w, y(v)); x.stroke(); }
  },
  // an ablative nozzle (hybrid, solid): dark carbon-phenolic in wrapped bands, the graphite throat a little lighter
  nozAbl(x, w, h, C) {
    const y = v => h * (1 - v), g = x.createLinearGradient(0, y(0), 0, y(1)), vt = C.vt;
    g.addColorStop(0, hx(C.solid, C.faint, 0.45)); g.addColorStop(vt, hx(C.faint, C.dim, 0.35)); g.addColorStop(Math.min(1, vt + 0.15), hx(C.solid, C.faint, 0.5)); g.addColorStop(1, hx(C.solid, C.faint, 0.35));
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const r = rnd(3);
    for (let v = 0.05; v < 1; v += 0.035 + 0.02 * r()) { x.fillStyle = rgba(r() < 0.5 ? C.solid : C.dim, 0.18); x.fillRect(0, y(v), w, 2); }
  },
};
function quilt(x, w, h, C, base) {
  const r = rnd(13), n = 8, cw = w / n, ch = h / (n * 1.6);
  x.fillStyle = base; x.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) for (let j = 0; j < n * 1.6; j++) {
    const cx = (i + 0.5) * cw, cy = (j + 0.5) * ch, g = x.createRadialGradient(cx, cy, 0, cx, cy, Math.max(cw, ch) * 0.7);
    g.addColorStop(0, rgba('#ffffff', 0.18 + 0.06 * r())); g.addColorStop(0.7, rgba('#ffffff', 0)); g.addColorStop(1, rgba(C.solid, 0.22));
    x.fillStyle = g; x.fillRect(i * cw, j * ch, cw, ch);
  }
  for (let i = 0; i < 1400; i++) { x.fillStyle = rgba(r() < 0.5 ? C.solid : '#ffffff', 0.06 * r()); x.fillRect(r() * w, r() * h, 1 + 2 * r(), 1); }
  x.strokeStyle = rgba(C.solid, 0.35); x.lineWidth = 1; x.setLineDash([2, 2]);
  for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * cw, 0); x.lineTo(i * cw, h); x.stroke(); }
  for (let j = 0; j <= n * 1.6; j++) { x.beginPath(); x.moveTo(0, j * ch); x.lineTo(w, j * ch); x.stroke(); }
  x.setLineDash([]); x.strokeStyle = rgba(hx(base, '#ffffff', 0.4), 0.7); x.lineWidth = 3;
  for (const v of [0.12, 0.88]) { x.beginPath(); x.moveTo(0, h * (1 - v)); x.lineTo(w, h * (1 - v)); x.stroke(); }
}
// the storables' tank finish: A of three compared (silver-grey quilted, white-grey quilted, painted aluminium; 2026-11-15)
const TANK_FIN = 'quiltA';
const TEXC = new Map();
function craftTex(kind, C) {
  const key = kind + '|' + Object.values(C).join(',');
  let t = TEXC.get(key);
  if (!t) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    PAINT[kind](cv.getContext('2d'), 256, 256, C);
    t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
    TEXC.set(key, t);
  }
  return t;
}
// The plume (Phase 18c; redone 2026-11-14): a flame, not a cone. One quad per plume along the thrust axis, turned about
// that axis to face the camera (a vacuum plume is round, so its look from the side is its line integral: a Gaussian
// across stays a Gaussian), its half width growing wide out of the nozzle (uR0 → uR1 over uLen, model units). Three
// layers: a short bright core at the exit, the body widening and fading, a faint wide halo; the body broken up by value
// noise drifting outwards (uT) and wavering sideways; no shock diamonds. Additive (ONE, ONE), no depth writes. Seen along
// its axis the quad thins out (vSin → 0) and the nozzle glow (PGLOW) takes over. uSimple: no noise (the low quality).
export const PLUME_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uLen, uR0, uR1;
varying vec2 vP;
varying float vSin;
void main() {
  vec3 O = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 Ay = mat3(modelMatrix) * vec3(0.0, -1.0, 0.0);
  float sc = length(Ay); vec3 A = Ay / sc;
  vec3 V = normalize(cameraPosition - O), S = cross(A, V);
  float sn = length(S);
  S = sn > 1e-4 ? S / sn : normalize(cross(A, abs(A.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  float a = uv.y, r = mix(uR0, uR1, pow(a, 0.7)) * 1.6, x = uv.x * 2.0 - 1.0;
  vec3 w = O + A * (a * uLen * sc) + S * (x * r * sc);
  vP = vec2(x * 1.6, a); vSin = sn;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  #include <logdepthbuf_vertex>
}`;
export const PLUME_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCore, uBody;
uniform float uI, uT, uSimple, uSeed;
varying vec2 vP;
varying float vSin;
// a hash without sin (float precision holds on every GPU; the clock is wrapped in mode3d.js)
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  #include <logdepthbuf_fragment>
  float a = vP.y, x = vP.x, n = 0.5;
  if (uSimple < 0.5) {
    float n1 = vnoise(vec2(a * 7.0 - uT * 4.0, x * 1.4 + uSeed)), n2 = vnoise(vec2(a * 16.0 - uT * 9.0, x * 3.0 - uSeed));
    n = 0.62 * n1 + 0.38 * n2;
    x += (n1 - 0.5) * 0.45 * a;
  }
  float start = smoothstep(0.0, 0.02, a);
  float body = exp(-x * x * 3.0) * pow(1.0 - a, 2.2) * (0.3 + 0.8 * n) * 0.75;
  float halo = exp(-x * x * 0.9) * pow(1.0 - a, 3.0) * 0.12;
  float core = exp(-x * x * 9.0) * exp(-a * 7.0) * 1.3;
  float tot = body + halo + core;
  float I = tot * start * uI * smoothstep(0.02, 0.3, vSin);
  vec3 c = mix(uBody, uCore, clamp(core / (tot + 1e-4), 0.0, 1.0));
  gl_FragColor = vec4(c * I, I);
  #include <colorspace_fragment>
}`;
// the nozzle glow: a camera-facing disc at the exit (uSize, model units), strongest seen along the plume's axis
export const PGLOW_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uSize;
varying vec2 vQ;
varying float vCos;
void main() {
  vec3 O = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 Ay = mat3(modelMatrix) * vec3(0.0, -1.0, 0.0);
  float sc = length(Ay);
  vec3 Rr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), Uu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vQ = uv * 2.0 - 1.0;
  vCos = abs(dot(Ay / sc, normalize(cameraPosition - O)));
  gl_Position = projectionMatrix * viewMatrix * vec4(O + (Rr * vQ.x + Uu * vQ.y) * uSize * sc, 1.0);
  #include <logdepthbuf_vertex>
}`;
export const PGLOW_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCore;
uniform float uI;
varying vec2 vQ;
varying float vCos;
void main() {
  #include <logdepthbuf_fragment>
  float d = dot(vQ, vQ), I = (exp(-d * 9.0) * 0.8 + exp(-d * 2.5) * 0.12) * uI * vCos * vCos;
  gl_FragColor = vec4(uCore * I, I);
  #include <colorspace_fragment>
}`;

// Tone mapping: the custom operator of js/globe.js (highlights only), through Three's CustomToneMapping hook
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }',
  TONEMAP_GLSL + '\nvec3 CustomToneMapping( vec3 color ) { return toneMap( color * toneMappingExposure ); }');
// every uniform GLOBE_GLSL declares, for each material that includes it
function globeUniforms(white) {
  const U = { uSun: new THREE.Vector3(1, 0, 0), uCam: new THREE.Vector3(0, 0, 5), uColor: new THREE.Color(1, 1, 1), uGlow: new THREE.Vector4(),
    uTex: 0, uMix: 0, uMix2: 0, uSat: 1, uLimb: 0, uRing: 0, uRingHas: 0, uTauHas: 0, uPhot: 0, uEmit: 0, uCloudRot: 0,
    uMap: white, uMap2: white, uRingMap: white, uTau: white, uClouds: white, uNight: white, uOcean: white, uRelief: white,
    uRingR: new THREE.Vector2(1, 2), uLayers: new THREE.Vector4(), uRelief4: new THREE.Vector4(), uHaze: new THREE.Vector4(), uHazeC: new THREE.Vector4(), uHazeL: new THREE.Vector3(0, 1, 0),
    uVoid: new THREE.Vector4(), uVoidZ: new THREE.Vector2(), uAx: new THREE.Vector3(1, 1, 1) };
  const o = {}; for (const k in U) o[k] = { value: U[k] }; return o;
}

// opts: fov (deg), void (clear colour), grid (grid colour), antialias (MSAA; false saves memory: the cabin on phones)
export function create(canvas, opts) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.antialias !== false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setClearColor(new THREE.Color(opts.void), 1);
  renderer.toneMapping = THREE.CustomToneMapping;
  renderer.autoClear = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov || FOV, 1, 1e-6, 1e13);
  const roots = { sim: new THREE.Group(), map: new THREE.Group() };
  for (const g of Object.values(roots)) scene.add(g);
  let W = 1, H = 1, DPR = 1, active = 'sim', lost = false;
  const T = [0, 0, 0];      // camera target, metres (view frame); the render origin
  const mats = new Set();   // LineMaterials (their resolution follows the canvas size)
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; });
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
  // images (js/globe.js texture cache entries) -> Three.js textures; colour images are sRGB, data as stored; a tier the
  // cache drops (js/globe.js TEX_DROP) leaves the GPU too
  const texs = new Map(), maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  function texOf(img, repeat, data) {
    let t = texs.get(img); if (t) return t;
    t = new THREE.Texture(img); t.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = maxAniso;
    t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    texs.set(img, t); return t;
  }
  TEX_DROP.push(img => { const t = texs.get(img); if (t) { t.dispose(); texs.delete(img); } });

  // ---- sky: the Milky Way and the bright stars, around the camera, turned from ecliptic into view-frame axes; opaque
  // (drawn first, added onto the clear colour), so bodies cover them ----
  const sky = new THREE.Group(); sky.visible = false; scene.add(sky);
  let milky = null, stars = null;
  function skySet(d) { // d: js/globe.js skyReady(); a sharper map tier replaces the base once it has loaded
    if (!d) return;
    if (milky) { milky.material.uniforms.uMilky.value = texOf(d.milky.img, true, false); return; }
    milky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, dithering: true,
      depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, uniforms: { uMilky: { value: texOf(d.milky.img, true, false) }, uGain: { value: SKY_GAIN } } }));
    milky.renderOrder = -11; milky.frustumCulled = false; sky.add(milky);
    const S = d.stars, g = new THREE.BufferGeometry(), pk = new Float32Array(S.n);
    for (let i = 0; i < S.n; i++) pk[i] = starPeak(S.mag[i]);
    g.setAttribute('position', new THREE.BufferAttribute(S.dir, 3)); g.setAttribute('aPeak', new THREE.BufferAttribute(pk, 1)); g.setAttribute('aCol', new THREE.BufferAttribute(S.col, 3));
    stars = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, depthTest: false, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending, uniforms: { uDpr: { value: 1 }, uGain: { value: 1 } } }));
    stars.renderOrder = -10; stars.frustumCulled = false; sky.add(stars);
  }

  // ---- the Sun's glare: screen-space (pixels, y up), after the scene ----
  const over = new THREE.Scene(), ocam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const glare = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: GLARE_VS, fragmentShader: GLARE_FS, depthTest: false, depthWrite: false,
    toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, uniforms: { uColor: { value: new THREE.Color('#fff3d6') }, uI: { value: 0 }, uExt: { value: GLARE_EXT } } }));
  glare.visible = false; glare.frustumCulled = false; over.add(glare);

  // ---- bodies ----
  const sphere = new THREE.SphereGeometry(1, 64, 32), sphereLo = new THREE.SphereGeometry(1, 48, 24);
  const sets = { sim: [], map: [] };
  function bodies(set, list) {
    for (const b of sets[set]) {
      for (const m of [b.mesh, b.ring, b.haze]) if (m) { roots[set].remove(m); m.material.dispose(); }
      if (b.ring) b.ring.geometry.dispose();
    }
    sets[set] = list.map(d => {
      const uni = globeUniforms(white); uni.uColor.value.set(d.color); uni.uEmit.value = d.sun ? 1 : 0;
      const mesh = new THREE.Mesh(sphere, new THREE.ShaderMaterial({ vertexShader: BODY_VS, fragmentShader: BODY_FS, uniforms: uni }));
      mesh.visible = false; roots[set].add(mesh);
      return { set, mesh, ring: null, haze: null, hazeTop: 0, p: [0, 0, 0], r: 1, ax: [1, 1, 1], rot: null, sun: new THREE.Vector3(1, 0, 0) };
    });
  }
  // the ring annulus (radii in body radii) and the haze shell of a body, made on first use; they share the body's
  // uniform values (the same objects), so one update serves all three
  function ringOf(b, rr) {
    if (b.ring) return b.ring;
    const mat = new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, premultipliedAlpha: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: b.mesh.material.uniforms });
    b.ring = new THREE.Mesh(new THREE.RingGeometry(rr[0], rr[1], 256, 1), mat); b.ring.visible = false; roots[b.set].add(b.ring);
    return b.ring;
  }
  function hazeOf(b) {
    if (b.haze) return b.haze;
    const uni = { ...b.mesh.material.uniforms, uInside: { value: 0 } };
    b.haze = new THREE.Mesh(sphereLo, new THREE.ShaderMaterial({ vertexShader: HAZE_VS, fragmentShader: HAZE_FS, transparent: true, premultipliedAlpha: true, depthWrite: false,
      side: THREE.DoubleSide, uniforms: uni }));
    b.haze.renderOrder = 1; b.haze.visible = false; roots[b.set].add(b.haze);
    return b.haze;
  }
  // body i of a set at p (metres), drawn radius r (metres), sun: unit vector towards the Sun in world axes (null keeps
  // it). o (optional): rot (body axes -> world, row-major), look (js/globe.js globeLook), mix (first fade-in), shape
  // (semi-axes over r: a triaxial body)
  const _m4 = new THREE.Matrix4();
  function body(set, i, p, r, sun, show, o) {
    const b = sets[set][i]; if (!b) return;
    b.p[0] = p[0]; b.p[1] = p[1]; b.p[2] = p[2]; b.r = r;
    b.mesh.visible = show;
    if (sun) b.sun.set(sun[0], sun[1], sun[2]);
    const u = b.mesh.material.uniforms;
    b.rot = o && o.rot ? o.rot : null;
    if (b.rot) { const m = b.rot; b.mesh.quaternion.setFromRotationMatrix(_m4.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1)); }
    else b.mesh.quaternion.identity();
    const ax = o && o.shape ? o.shape : [1, 1, 1]; b.ax[0] = ax[0]; b.ax[1] = ax[1]; b.ax[2] = ax[2]; u.uAx.value.set(ax[0], ax[1], ax[2]);
    const L = o && o.look, tx = L && L.tex;
    u.uTex.value = tx ? 1 : 0; u.uMap.value = tx ? texOf(tx.e.img, true) : white; u.uMix.value = tx ? o.mix : 0;
    u.uMap2.value = tx && tx.old ? texOf(tx.old.img, true) : white; u.uMix2.value = tx && tx.old ? tx.mix : 0;
    if (L && L.glow) u.uGlow.value.fromArray(L.glow); else u.uGlow.value.set(0, 0, 0, 0);
    u.uSat.value = L ? L.sat : 1; u.uLimb.value = L && L.limb ? 1 : 0;
    const U = lookUniforms(L);
    u.uLayers.value.fromArray(U.layers); u.uRelief4.value.fromArray(U.relief); u.uHaze.value.fromArray(U.haze); u.uHazeC.value.fromArray(U.hazeC); u.uHazeL.value.fromArray(U.hazeL);
    u.uCloudRot.value = U.cloudRot; u.uPhot.value = U.phot; u.uVoid.value.fromArray(U.void); u.uVoidZ.value.fromArray(U.voidZ);
    u.uClouds.value = L && L.clouds ? texOf(L.clouds.img, true, true) : white; u.uNight.value = L && L.night ? texOf(L.night.img, true) : white;
    u.uOcean.value = L && L.ocean ? texOf(L.ocean.img, true, true) : white; u.uRelief.value = L && L.relief ? texOf(L.relief.e.img, true, true) : white;
    const ring = L && L.ring && show ? ringOf(b, L.ring.r) : null;
    u.uRing.value = ring ? 1 : 0;
    if (ring) {
      u.uRingHas.value = L.ring.e ? 1 : 0; u.uRingMap.value = L.ring.e ? texOf(L.ring.e.img, false) : white; u.uRingR.value.set(L.ring.r[0], L.ring.r[1]);
      u.uTauHas.value = L.ring.tau ? 1 : 0; u.uTau.value = L.ring.tau ? texOf(L.ring.tau.img, false, true) : white;
    }
    if (b.ring) b.ring.visible = !!ring;
    const hz = L && L.haze && show ? hazeOf(b) : null;
    b.hazeTop = hz ? L.haze.top : 0;
    if (b.haze) b.haze.visible = !!hz;
  }

  // ---- lines ----
  // A line is a group placed at (anchor − target); its chunks hold float32 offsets from their own float64 origin.
  // opts: color, opacity, width, glow: [width, opacity] (an extra wide faint line on the same geometry),
  // additive, colors (Float32Array, 3 per point, linear RGB), closed.
  const lines = { sim: new Map(), map: new Map() };
  function material(color, opacity, width, opts) {
    const m = new LineMaterial({ color: new THREE.Color(color), linewidth: width, transparent: true, opacity, depthWrite: false, vertexColors: !!opts.vertexColors, toneMapped: false });
    if (opts.additive) m.blending = THREE.AdditiveBlending;
    m.userData.base = opacity; m.userData.w = width;
    m.resolution.set(W, H); mats.add(m); return m;
  }
  // Close to the craft (2026-11-15): the lines flow past the camera at orbital speed. fadeSet scales every line of a set
  // (k: 0 hides them; the ids in own, the craft's own path, by kOwn and thinner) on top of each material's own opacity.
  const FADE = { sim: { k: 1, own: new Set(), kOwn: 1 }, map: { k: 1, own: new Set(), kOwn: 1 } };
  function fadeApply(set, id, m) {
    const F = FADE[set], own = F.own.has(id), f = own ? F.kOwn : F.k;
    m.opacity = m.userData.base * f; m.linewidth = m.userData.w * (own ? 0.55 + 0.45 * F.kOwn : 1); m.visible = f > 0.004;
  }
  function fadeSet(set, k, own, kOwn) {
    const F = FADE[set];
    if (F.k === k && F.kOwn === kOwn && F.own === own) return;
    F.k = k; F.own = own; F.kOwn = kOwn;
    for (const [id, h] of lines[set]) for (const m of h.mats) fadeApply(set, id, m);
    for (const [id, d] of dyns[set]) fadeApply(set, id, d.mat);
  }
  function chunkLine(h, pts, n, opts) {
    const closed = !!opts.closed, N = closed ? n + 1 : n, at = i => (i % n) * 3;
    let i0 = 0;
    while (i0 < N - 1) {
      const o = [pts[at(i0)], pts[at(i0) + 1], pts[at(i0) + 2]];
      let i1 = i0 + 1;
      for (; i1 < N - 1 && i1 - i0 < CHUNK - 1; i1++) {
        const k = at(i1), k1 = at(i1 + 1);
        const step = Math.hypot(pts[k1] - pts[k], pts[k1 + 1] - pts[k + 1], pts[k1 + 2] - pts[k + 2]);
        if (step > 0 && Math.hypot(pts[k1] - o[0], pts[k1 + 1] - o[1], pts[k1 + 2] - o[2]) > CHUNK_REL * step) break;
      }
      const m = i1 - i0 + 1, a = new Float32Array(3 * m);
      for (let j = 0; j < m; j++) { const k = at(i0 + j); a[3 * j] = (pts[k] - o[0]) * KM; a[3 * j + 1] = (pts[k + 1] - o[1]) * KM; a[3 * j + 2] = (pts[k + 2] - o[2]) * KM; }
      const geo = new LineGeometry(); geo.setPositions(a);
      if (opts.colors) { const c = new Float32Array(3 * m); for (let j = 0; j < m; j++) { const k = at(i0 + j); c[3 * j] = opts.colors[k]; c[3 * j + 1] = opts.colors[k + 1]; c[3 * j + 2] = opts.colors[k + 2]; } geo.setColors(c); }
      const add = mat => { const l = new LineSegments2(geo, mat); l.position.set(o[0] * KM, o[1] * KM, o[2] * KM); if (h.dashed) l.computeLineDistances(); h.group.add(l); return l; };
      h.chunks.push({ i0, i1, geo, lines: h.mats.map(add) });
      i0 = i1;
    }
  }
  function line(set, id, pts, n, opts = {}) {
    lineDrop(set, id);
    const h = { group: new THREE.Group(), anchor: [0, 0, 0], chunks: [], mats: [], show: true };
    h.mats.push(material(opts.color || '#ffffff', opts.opacity == null ? 1 : opts.opacity, opts.width || 1, { vertexColors: !!opts.colors, additive: opts.additive }));
    if (opts.dash > 0) { const m = h.mats[0]; m.dashed = true; m.dashSize = m.gapSize = opts.dash * KM; m.dashScale = 1; h.dashed = true; }
    if (opts.glow) h.mats.push(material(opts.color || '#ffffff', opts.glow[1], opts.glow[0], { additive: true }));
    if (n >= 2) chunkLine(h, pts, n, opts);
    roots[set].add(h.group); lines[set].set(id, h);
    return h;
  }
  function lineDrop(set, id) {
    const h = lines[set].get(id); if (!h) return;
    roots[set].remove(h.group);
    for (const c of h.chunks) c.geo.dispose();
    for (const m of h.mats) { m.dispose(); mats.delete(m); }
    lines[set].delete(id);
  }
  function lineDropAll(set, prefix) { for (const id of [...lines[set].keys()]) if (id.startsWith(prefix)) lineDrop(set, id); }
  // draw points 0..k only (k < 0: nothing)
  function lineUpTo(set, id, k) {
    const h = lines[set].get(id); if (!h) return;
    for (const c of h.chunks) {
      const segs = Math.max(0, Math.min(c.i1 - c.i0, k - c.i0));
      c.geo.instanceCount = segs;
      for (const l of c.lines) l.visible = segs > 0;
    }
  }
  function lineSet(set, id, anchor, show, rot) {
    const h = lines[set].get(id); if (!h) return;
    if (anchor) { h.anchor[0] = anchor[0]; h.anchor[1] = anchor[1]; h.anchor[2] = anchor[2]; }
    h.show = show; h.group.visible = show;
    if (rot) h.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().set(rot[0], rot[1], rot[2], 0, rot[3], rot[4], rot[5], 0, rot[6], rot[7], rot[8], 0, 0, 0, 0, 1));
  }
  function lineOpacity(set, id, opacity) { const h = lines[set].get(id); if (h) { h.mats[0].userData.base = opacity; fadeApply(set, id, h.mats[0]); } }
  function lineGlow(set, id, on) { const h = lines[set].get(id); if (h && h.mats[1]) for (const c of h.chunks) c.lines[1].visible = on && c.lines[0].visible; }

  // Dynamic line (trail, the bit up to the craft): one chunk with a fixed capacity, rewritten in place.
  const dyns = { sim: new Map(), map: new Map() };
  function dyn(set, id, cap, opts = {}) {
    let d = dyns[set].get(id);
    if (d && d.cap >= cap) return d;
    if (d) { roots[set].remove(d.line); d.geo.dispose(); d.mat.dispose(); mats.delete(d.mat); }
    const geo = new LineGeometry(); geo.setPositions(new Float32Array(3 * cap));
    if (opts.vertexColors) geo.setColors(new Float32Array(3 * cap));
    const mat = material(opts.color || '#ffffff', opts.opacity == null ? 1 : opts.opacity, opts.width || 1, opts);
    const l = new LineSegments2(geo, mat); l.frustumCulled = false; l.visible = false;
    roots[set].add(l);
    d = { cap, geo, mat, line: l, o: [0, 0, 0] };
    dyns[set].set(id, d); fadeApply(set, id, mat);
    return d;
  }
  // pts: metres, 3 per point (n points); colors: linear RGB per point or null
  function dynSet(set, id, pts, n, colors) {
    const d = dyns[set].get(id); if (!d) return;
    n = Math.min(n, d.cap);
    if (n < 2) { d.line.visible = false; return; }
    d.o[0] = pts[0]; d.o[1] = pts[1]; d.o[2] = pts[2];
    const A = d.geo.attributes.instanceStart.data, a = A.array;
    for (let j = 0; j < n - 1; j++) for (let q = 0; q < 2; q++) for (let c = 0; c < 3; c++) a[6 * j + 3 * q + c] = (pts[3 * (j + q) + c] - d.o[c]) * KM;
    A.needsUpdate = true;
    if (colors && d.geo.attributes.instanceColorStart) {
      const B = d.geo.attributes.instanceColorStart.data, b = B.array;
      for (let j = 0; j < n - 1; j++) for (let q = 0; q < 2; q++) for (let c = 0; c < 3; c++) b[6 * j + 3 * q + c] = colors[3 * (j + q) + c];
      B.needsUpdate = true;
    }
    d.geo.instanceCount = n - 1; d.line.visible = true;
  }
  function dynHide(set, id) { const d = dyns[set].get(id); if (d) d.line.visible = false; }

  // ---- reference-plane grid: two lattices (spacing s and 10 s) that cross-fade with the zoom ----
  const grid = (() => {
    const N = 20, p = [];
    for (let k = -N; k <= N; k++) p.push(k, -N, 0, k, N, 0, -N, k, 0, N, k, 0);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    const mk = () => {
      const m = new THREE.ShaderMaterial({ vertexShader: GRID_VS, fragmentShader: GRID_FS, transparent: true, depthWrite: false, toneMapped: false,
        uniforms: { uColor: { value: new THREE.Color(opts.grid) }, uAlpha: { value: 0 }, uR: { value: N } } });
      const l = new THREE.LineSegments(g, m); l.frustumCulled = false; l.visible = false; scene.add(l); return l;
    };
    return { N, a: mk(), b: mk(), c: [0, 0, 0], s: 1, alpha: [0, 0], rot: null, show: false };
  })();
  // grid in the plane spanned by the view frame's x, y axes through c (metres), spacing s; alpha per lattice
  function gridSet(show, c, s, aMinor, aMajor) {
    grid.show = show;
    if (!show) return;
    grid.c[0] = c[0]; grid.c[1] = c[1]; grid.c[2] = c[2]; grid.s = s; grid.alpha[0] = aMinor; grid.alpha[1] = aMajor;
  }

  // ---- the craft (Phase 18b) and its plume (18c) ----
  // Model units: length 1 along +y (nose at +0.5, nozzle exit at −0.5), scaled by the craft's length. Shells are lathe
  // surfaces, whole or (cutaway) the half x ≤ 0. +x is fixed to the craft's body (2026-11-15: o.side, the view frame's
  // reference-plane normal made square to the nose; before, +x faced the camera): one side is cut open, and turning the
  // camera round shows the whole shell on the other. The cutaway's contents are flat faces in the plane x = 0 (tank liquids filling from the aft end,
  // a hybrid's grain on both sides of its port, a solid's grain about its core) and half cylinders for the port walls.
  const craftG = { group: null, key: '', shells: [], fills: {}, mats: {}, plumes: [], ports: [] };
  // a lathe surface; its v runs by length along the profile (three.js spaces it by point), so the textures are not
  // squeezed into a tank's few cylinder points
  // A profile running downwards (a nozzle: throat to exit) is turned round so the outside is the front face (the
  // inside of an opened shell is drawn plain), its v still 0 at the profile's first point.
  const lathe = (pts0, half) => {
    const rev = pts0[0][1] > pts0[pts0.length - 1][1], pts = rev ? pts0.slice().reverse() : pts0;
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 28, half ? Math.PI : 0, half ? Math.PI : Math.PI * 2);
    const cum = [0]; for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
    const uv = g.attributes.uv, np = pts.length, tot = cum[np - 1] || 1;
    for (let k = 0; k < uv.count; k++) uv.setY(k, rev ? 1 - cum[k % np] / tot : cum[k % np] / tot);
    return g;
  };
  // a capsule tank: radius r from y0 to y1, domes of height k·r
  const tankPts = (r, y0, y1, k = 0.5) => { const p = []; for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2; p.push([r * Math.sin(a), y0 + k * r * (1 - Math.cos(a))]); } for (let i = 6; i >= 0; i--) { const a = i / 6 * Math.PI / 2; p.push([r * Math.sin(a), y1 - k * r * (1 - Math.cos(a))]); } return p; };
  const bellPts = (r0, r1, y0, y1) => { const p = []; for (let i = 0; i <= 8; i++) { const f = i / 8; p.push([r0 + (r1 - r0) * Math.sqrt(f), y0 - (y0 - y1) * f]); } return p; };
  // One continuous engine profile (2026-11-15), top to exit [r, y]: an injector dome (liquids), the cylindrical chamber
  // (rc from yc0), a rounded convergent part into the throat (rt) through a circular fillet, then the bell to the exit
  // (re at -0.5): no kinks or gaps where they meet. Returns the points and the throat's and the extension joint's share
  // of the profile's length (the nozzle texture's heat tint and channels).
  function engineProfile(o) {
    const { rc, rt, re, yc0, Lc, Lv, dome } = o, pts = [];
    if (dome) for (let i = 0; i <= 6; i++) { const a = i / 6 * Math.PI / 2; pts.push([rc * Math.sin(a), yc0 + dome * Math.cos(a)]); }
    else pts.push([rc, yc0]);
    const yc1 = yc0 - Lc, yt = yc1 - Lv; // chamber end, throat
    for (let i = 1; i <= 4; i++) pts.push([rc, yc0 - Lc * i / 4]);
    // convergent + throat fillet: a cosine blend from rc to rt (zero slope at both ends: smooth into the chamber and the throat)
    for (let i = 1; i <= 10; i++) { const f = i / 10, b = 0.5 - 0.5 * Math.cos(Math.PI * f); pts.push([rc + (rt - rc) * b, yc1 - Lv * f]); }
    // the bell: leaves the throat with zero slope (f/(f + 0.04)), opens quickly and flattens towards the exit
    const Lb = yt + 0.5;
    for (let i = 1; i <= 18; i++) { const f = i / 18, q = (1 - Math.pow(1 - f, 2.4)) * f / (f + 0.04) * 1.04; pts.push([rt + (re - rt) * q, yt - Lb * f]); }
    const cum = [0]; for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
    const tot = cum[cum.length - 1], it = (dome ? 7 : 1) + 4 + 10 - 1;
    return { pts, vt: cum[it] / tot, ve: (cum[it] + 0.45 * (tot - cum[it])) / tot, yt };
  }
  // a tube along points (feed lines)
  const tube = (P, r, mat) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(P.map(p => new THREE.Vector3(...p))), 24, r, 8, false), mat);
  const quad = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2), halfCyl = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true, Math.PI, Math.PI);
  // a material: a flat colour, or (tex: a PAINT kind) a textured outer surface whose inside stays the plain colour;
  // spec: the Sun's highlight
  function craftMat(color, flat, tex, C, spec = 0.12) {
    return new THREE.ShaderMaterial({ vertexShader: CRAFT_VS, fragmentShader: CRAFT_FS, side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uColor: { value: new THREE.Color(tex ? '#ffffff' : color) }, uBack: { value: new THREE.Color(color) }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uFlat: { value: flat ? 1 : 0 },
        uTex: { value: tex ? 1 : 0 }, uMap: { value: tex ? craftTex(tex, C) : null }, uSpec: { value: flat ? 0 : spec }, uClip: { value: 1e9 } } });
  }
  // a plume: the flame quad (placed at the nozzle exit, its axis −y of the model) and, for a main engine, the nozzle glow;
  // additive: blending ONE, ONE (premultiplied), no depth writes, drawn after the model
  const flameQuad = new THREE.PlaneGeometry(1, 1, 1, 20).translate(0.5, 0.5, 0), glowQuad = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
  const ADD = { transparent: true, premultipliedAlpha: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false };
  function plumeMesh(glow) {
    const f = new THREE.Mesh(flameQuad, new THREE.ShaderMaterial({ vertexShader: PLUME_VS, fragmentShader: PLUME_FS, ...ADD, uniforms: { uCore: { value: new THREE.Color() }, uBody: { value: new THREE.Color() },
      uI: { value: 0 }, uT: { value: 0 }, uSimple: { value: 0 }, uSeed: { value: Math.random() * 50 }, uLen: { value: 1 }, uR0: { value: 0.1 }, uR1: { value: 0.6 } } }));
    f.visible = false; f.renderOrder = 2; f.frustumCulled = false;
    if (glow) {
      const g = new THREE.Mesh(glowQuad, new THREE.ShaderMaterial({ vertexShader: PGLOW_VS, fragmentShader: PGLOW_FS, ...ADD, uniforms: { uCore: { value: new THREE.Color() }, uI: { value: 0 }, uSize: { value: 0.2 } } }));
      g.visible = false; g.renderOrder = 2; g.frustumCulled = false; f.userData.glow = g;
    }
    return f;
  }
  // build the model for engine type ty (grain for a solid); col: { metal, nozzle, fuel, ox, tex (the theme's colours for
  // the textures) }; prop: the propellant (the tanks' finish: foam on cryogenic ones, gold foil on storables, bare metal
  // for RP-1, a composite case for a hybrid's nitrous oxide); fo: the oxidizer tank's share of a liquid engine's tank
  // length (their volumes)
  function craftBuild(ty, grain, col, prop, fo) {
    if (craftG.group) { roots.sim.remove(craftG.group); craftG.group.traverse(o => { if (o.material) o.material.dispose(); if (o.geometry && ![quad, halfCyl, flameQuad, glowQuad].includes(o.geometry)) o.geometry.dispose(); }); }
    const g = new THREE.Group(); g.visible = false;
    const C = col.tex, cryo = /^lox/.test(prop || ''), T = (k, o) => craftMat(col.metal, false, k, o ? { ...C, ...o } : C, k === 'foam' ? 0.06 : k.startsWith('quilt') ? 0.18 : 0.25);
    const fin = TANK_FIN;
    const M = { metal: craftMat(col.metal), nozzle: craftMat(col.nozzle), fuel: craftMat(col.fuel, true), ox: craftMat(col.ox, true), wall: craftMat(col.fuel),
      fuelL: craftMat(col.fuel, true), oxL: craftMat(col.ox, true), line: craftMat(col.tex.ink), valve: craftMat(col.nozzle),
      oxTank: T(cryo ? 'foam' : prop === 'n2o_htpb' ? 'carbon' : fin), fuelTank: T(prop === 'lox_lh2' ? 'foam' : prop === 'lox_rp1' ? 'alu' : fin),
      caseC: T(ty === 'sol' ? 'case' : 'carbon') };
    M.wall.uniforms.uColor.value.multiplyScalar(0.4); // the port's burning wall, darker than the grain's cut face
    M.line.uniforms.uSpec.value = 0.5; M.valve.uniforms.uColor.value.multiplyScalar(0.8);
    const shells = [], fills = {}, ports = [], plumes = [];
    const shell = (pts, mat) => { const a = new THREE.Mesh(lathe(pts, false), mat), b = new THREE.Mesh(lathe(pts, true), mat); b.visible = false; g.add(a, b); shells.push([a, b]); };
    const fill = (name, mat, r, y0, y1) => { const m = new THREE.Mesh(quad, mat); m.visible = false; g.add(m); fills[name] = { m, r, y0, y1 }; };
    // a liquid in the cut plane: the tank's inside outline (shell radius r, domes k·r high), filled from the aft end
    // (y0) to its level by volume (core.js engTankLevel), the surface a clip height in the shader
    const liquid = (name, mat, r, y0, y1, k) => {
      const ri = r - 0.005, a0 = y0 + 0.005, a1 = y1 - 0.005, ki = (k * r - 0.005) / ri, P = tankPts(ri, a0, a1, ki), sh = new THREE.Shape();
      P.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y))); for (let i = P.length - 1; i >= 0; i--) sh.lineTo(-P[i][0], P[i][1]);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh, 4).rotateY(-Math.PI / 2), mat); m.position.x = 0.001; m.visible = false; g.add(m);
      fills[name] = { m, liq: true, r: ri, y0: a0, y1: a1, k: ki };
    };
    const port = (name, r, y0, y1) => { const m = new THREE.Mesh(halfCyl, M.wall); m.visible = false; g.add(m); ports.push(m); fills[name] = { m, r, y0, y1, wall: true }; };
    const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); g.add(m); return m; };
    let exitR = 0.095;
    if (ty === 'liq') {
      // the two tanks share 0.48 … −0.22 (less a gap) in proportion to their volumes, each at least 0.15 long
      const span = 0.67, lo = Math.max(0.15, Math.min(span - 0.15, span * (fo > 0 ? fo : 0.5))), y0 = 0.48 - lo, y1 = y0 - 0.03;
      shell(tankPts(0.12, y0, 0.48), M.oxTank); liquid('ox', M.oxL, 0.12, y0, 0.48, 0.5);
      shell(tankPts(0.12, -0.22, y1), M.fuelTank); liquid('fuel', M.fuelL, 0.12, -0.22, y1, 0.5);
      // the engine (proportions after an RL10 under a Centaur-sized tank): thrust cone, gimbal block, injector dome,
      // chamber, nozzle in one profile; feed lines with valves; a turbopump (cryogenic pairs) or pressurant bottles
      shell([[0.105, -0.205], [0.03, -0.275]], M.metal); // the thrust cone under the tank
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.016, 16), M.valve), 0, -0.283, 0); // the gimbal block
      add(new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.003, 6, 20).rotateX(Math.PI / 2), M.metal), 0, -0.29, 0);
      const ep = engineProfile({ rc: 0.024, rt: 0.0115, re: 0.062, yc0: -0.302, Lc: 0.03, Lv: 0.022, dome: 0.01 });
      M.nozLiq = T('nozLiq', { vt: ep.vt, ve: ep.ve });
      shell(ep.pts, M.nozLiq); exitR = 0.062;
      const pump = cryo, ps = pump ? [0.045, -0.305, 0.02] : null;
      // the fuel line from the fuel tank's aft dome; the oxidizer line down the outside of the fuel tank
      g.add(tube([[0.03, -0.205, 0.05], [0.04, -0.25, 0.05], pump ? [0.045, -0.29, 0.03] : [0.03, -0.3, 0.03], [0.026, -0.31, 0.015]], 0.0045, M.line));
      g.add(tube([[0.0, y0 - 0.0, -0.118], [0.0, (y0 + y1) / 2 - 0.15, -0.126], [0.0, -0.19, -0.126], [-0.02, -0.25, -0.07], [-0.025, -0.3, -0.025]], 0.0045, M.line));
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.014, 12), M.valve), 0.04, -0.255, 0.05); // valves
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.014, 12), M.valve), -0.02, -0.255, -0.068);
      if (pump) { add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.035, 14), M.metal), ...ps); add(new THREE.Mesh(new THREE.SphereGeometry(0.014, 14, 10), M.valve), ps[0], ps[1] - 0.02, ps[2]); }
      else for (const z of [0.075, -0.075]) add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), M.line), 0.07, -0.245, z); // helium bottles
    } else if (ty === 'hyb') {
      shell(tankPts(0.12, 0.1, 0.48), M.oxTank); liquid('ox', M.oxL, 0.12, 0.1, 0.48, 0.5);
      shell(tankPts(0.125, -0.36, 0.07, 0.25), M.caseC); fill('grainA', M.fuel, 0.115, -0.33, 0.04); fill('grainB', M.fuel, 0.115, -0.33, 0.04); port('port', 0.115, -0.33, 0.04);
      g.add(tube([[0.0, 0.1, 0.0], [0.0, 0.085, 0.0], [0.0, 0.075, 0.0]], 0.01, M.line)); // the oxidizer feed and its valve
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 14), M.valve), 0, 0.087, 0);
      const ep = engineProfile({ rc: 0.06, rt: 0.022, re: 0.085, yc0: -0.352, Lc: 0.004, Lv: 0.03 });
      M.nozAbl = T('nozAbl', { vt: ep.vt }); shell(ep.pts, M.nozAbl); exitR = 0.085;
    } else if (ty === 'sol') {
      shell(tankPts(0.15, -0.38, 0.45, 0.6), M.caseC); fill('grainA', M.fuel, 0.14, -0.3, 0.38); fill('grainB', M.fuel, 0.14, -0.3, 0.38); port('port', 0.14, -0.3, 0.38);
      const ep = engineProfile({ rc: 0.07, rt: 0.025, re: 0.095, yc0: -0.37, Lc: 0.004, Lv: 0.035 });
      M.nozAbl = T('nozAbl', { vt: ep.vt }); shell(ep.pts, M.nozAbl); exitR = 0.095;
    } else {
      shell(tankPts(0.2, -0.05, 0.37, 1), M.oxTank); liquid('fuel', M.fuelL, 0.2, -0.05, 0.37, 1);
      shell([[0.16, -0.25], [0.16, -0.05]], M.metal);
      for (const [x, z] of [[0.12, 0.12], [-0.12, 0.12], [0.12, -0.12], [-0.12, -0.12]]) { const t = new THREE.Mesh(lathe(bellPts(0.012, 0.03, -0.25, -0.33), false), M.nozzle); t.position.set(x, 0, z); g.add(t); }
    }
    craftG.exitR = exitR;
    const nPl = ty === 'mono' ? 4 : 1;
    for (let i = 0; i < nPl; i++) { const p = plumeMesh(nPl === 1); g.add(p); if (p.userData.glow) g.add(p.userData.glow); plumes.push(p); }
    roots.sim.add(g);
    Object.assign(craftG, { group: g, shells, fills, ports, plumes, mats: M, ty, grain });
  }
  // o: { show, p (metres), axis (unit, the nose), L (m), sun (unit, world), cut, type, grain, col, st: core.js engState,
  //      plume: { color, a, len (model lengths) } }
  const _cx = new THREE.Vector3(), _cy = new THREE.Vector3(), _cz = new THREE.Vector3(), _cm = new THREE.Matrix4();
  function craft(o) {
    if (!o.show) { if (craftG.group) craftG.group.visible = false; return; }
    const fo = Math.round((o.fo || 0.5) * 100) / 100, key = [o.type, o.grain, o.prop, fo, o.col.metal, o.col.fuel, o.col.ox, o.col.nozzle].join('|');
    if (craftG.key !== key) { craftBuild(o.type, o.grain, o.col, o.prop, fo); craftG.key = key; }
    const g = craftG.group, L = o.L * KM, st = o.st || {};
    g.visible = true; g.scale.setScalar(L); g.position.set((o.p[0] - T[0]) * KM, (o.p[1] - T[1]) * KM, (o.p[2] - T[2]) * KM); // after view(): T is this frame's
    for (const m of Object.values(craftG.mats)) m.uniforms.uSun.value.set(o.sun[0], o.sun[1], o.sun[2]);
    // orientation: +y the nose, +x the body's side (o.side square to the nose; the cut opens towards it)
    _cy.set(o.axis[0], o.axis[1], o.axis[2]).normalize();
    const sd = o.side || [0, 0, 1];
    _cx.set(sd[0], sd[1], sd[2]); _cx.addScaledVector(_cy, -_cx.dot(_cy));
    if (_cx.lengthSq() < 1e-6) { _cx.set(1, 0, 0); _cx.addScaledVector(_cy, -_cx.dot(_cy)); }
    _cx.normalize();
    _cz.crossVectors(_cx, _cy);
    g.quaternion.setFromRotationMatrix(_cm.makeBasis(_cx, _cy, _cz));
    for (const [a, b] of craftG.shells) { a.visible = !o.cut; b.visible = !!o.cut; }
    // the cutaway's contents
    for (const [name, f] of Object.entries(craftG.fills)) {
      const m = f.m; m.visible = !!o.cut;
      if (!o.cut) continue;
      const len = f.y1 - f.y0;
      if (f.liq) { // the level by volume in the domed tank: the shader cuts the outline at the surface
        const k = Math.max(0, Math.min(1, name === 'ox' ? st.ox : st.fuel)); m.visible = k > 0.002;
        m.material.uniforms.uClip.value = f.y0 + f.r * engTankLevel(k, len / f.r, f.k); continue;
      }
      // grains: the hybrid's port (st.port of the outer radius) and a solid's web (core.js SOL_GRAIN shapes)
      let ri, ro;
      if (craftG.ty === 'hyb') { ri = st.port || 0; ro = 1; } else if (craftG.grain === 'rod') { ri = 0; ro = 1 - 0.6 * (st.web || 0); } else { ri = 0.5 + 0.5 * (st.web || 0); ro = 1; }
      const w = (ro - ri) * f.r;
      if (f.wall) { m.visible = ri > 0.01 || craftG.grain === 'rod'; const rr = craftG.grain === 'rod' ? ro : ri; m.scale.set(rr * f.r, len, rr * f.r); m.position.set(0, (f.y0 + f.y1) / 2, 0); continue; }
      m.visible = w > 1e-4; m.scale.set(1, len, craftG.grain === 'rod' && craftG.ty === 'sol' ? 2 * ro * f.r : w);
      const zc = craftG.grain === 'rod' && craftG.ty === 'sol' ? 0 : (name === 'grainA' ? 1 : -1) * (ri * f.r + w / 2);
      m.position.set(0.001, (f.y0 + f.y1) / 2, zc);
      if (name === 'grainB' && craftG.grain === 'rod' && craftG.ty === 'sol') m.visible = false;
    }
    // the plume(s): while the engine burns and the moment after its cut (o.plume.I goes to 0); length, width and
    // brightness by thrust (o.plume: { core, body (colours), I, len (model lengths), t (s, the noise's drift), simple })
    const pl = o.plume || { I: 0 }, on = pl.I > 0.002, mono = craftG.plumes.length > 1;
    craftG.plumes.forEach((p, i) => {
      const gl = p.userData.glow;
      p.visible = on; if (gl) gl.visible = on;
      if (!on) return;
      const U = p.material.uniforms, len = mono ? pl.len * 0.3 : pl.len, r0 = mono ? 0.03 : craftG.exitR || 0.095;
      U.uCore.value.set(pl.core); U.uBody.value.set(pl.body); U.uI.value = pl.I; U.uT.value = pl.t || 0; U.uSimple.value = pl.simple ? 1 : 0;
      U.uLen.value = len; U.uR0.value = r0; U.uR1.value = r0 + len * 0.28;
      if (mono) { const s = [[0.12, 0.12], [-0.12, 0.12], [0.12, -0.12], [-0.12, -0.12]][i]; p.position.set(s[0], -0.33, s[1]); } else p.position.set(0, -0.5, 0);
      if (gl) { gl.position.copy(p.position); const G = gl.material.uniforms; G.uCore.value.set(pl.core); G.uI.value = pl.I; G.uSize.value = r0 * 1.6; }
    });
  }

  // ---- frame ----
  function size(w, h, dpr) {
    W = w; H = h; DPR = dpr;
    ocam.right = w; ocam.top = h; ocam.updateProjectionMatrix();
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    for (const m of mats) m.resolution.set(w, h);
  }
  // camera: target t (metres), basis rows r (right), u (up), d (target → camera), distance (metres);
  // the target projects to (cx, cy) px (view offset), so it can sit in the middle of the free plot area;
  // fov (optional): a new vertical field of view, degrees (the cabin's glass follows its window)
  function view(t, r, u, d, dist, cx, cy, fov) {
    if (fov) camera.fov = fov;
    T[0] = t[0]; T[1] = t[1]; T[2] = t[2];
    camera.position.set(d[0] * dist * KM, d[1] * dist * KM, d[2] * dist * KM);
    camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...r), new THREE.Vector3(...u), new THREE.Vector3(...d)));
    camera.aspect = W / H;
    camera.near = Math.max(1e-6, dist * KM * 1e-7); camera.far = Math.max(1e7, dist * KM * 1e7);
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    camera.updateProjectionMatrix();
  }
  const _q = new THREE.Quaternion();
  function setActive(set) { active = set; for (const k in roots) roots[k].visible = k === set; if (set !== 'sim' && craftG.group) craftG.group.visible = false; }
  // opts: stars (draw the sky), sky (ecliptic -> view frame, row-major; null: the ecliptic axes), skyGain (the viewer's
  // gain × the eye adaptation), glare ({ x, y px from the top left, L px, i intensity } or null)
  const _sk = new THREE.Matrix4();
  function render(opts) {
    if (lost) return;
    sky.visible = !!opts.stars && !!milky;
    if (sky.visible) {
      const m = opts.sky; sky.position.copy(camera.position); sky.scale.setScalar(camera.far * 0.5);
      if (m) sky.quaternion.setFromRotationMatrix(_sk.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1)); else sky.quaternion.identity();
      stars.material.uniforms.uDpr.value = DPR;
      const k = opts.skyGain == null ? 1 : opts.skyGain;
      milky.material.uniforms.uGain.value = SKY_GAIN * k; stars.material.uniforms.uGain.value = k;
    }
    const rel = (p, o) => o.set((p[0] - T[0]) * KM, (p[1] - T[1]) * KM, (p[2] - T[2]) * KM);
    for (const b of sets[active] || []) { // active 'none': no set (the sky alone)
      if (!b.mesh.visible) continue;
      rel(b.p, b.mesh.position); b.mesh.scale.set(b.r * KM * b.ax[0], b.r * KM * b.ax[1], b.r * KM * b.ax[2]);
      // Sun and camera in the body's axes (camera in body radii)
      const u = b.mesh.material.uniforms, q = _q.copy(b.mesh.quaternion).invert();
      u.uSun.value.copy(b.sun).applyQuaternion(q);
      u.uCam.value.copy(camera.position).sub(b.mesh.position).divideScalar(b.r * KM).applyQuaternion(q);
      if (b.ring && b.ring.visible) { b.ring.position.copy(b.mesh.position); b.ring.quaternion.copy(b.mesh.quaternion); b.ring.scale.copy(b.mesh.scale); }
      if (b.haze && b.haze.visible) {
        b.haze.position.copy(b.mesh.position); b.haze.quaternion.copy(b.mesh.quaternion); b.haze.scale.setScalar(b.r * KM * (1 + b.hazeTop));
        b.haze.material.uniforms.uInside.value = u.uCam.value.length() < 1 + b.hazeTop ? 1 : 0;
      }
    }
    if (lines[active]) for (const h of lines[active].values()) if (h.show) rel(h.anchor, h.group.position);
    if (dyns[active]) for (const d of dyns[active].values()) if (d.line.visible) rel(d.o, d.line.position);
    const gs = [grid.a, grid.b];
    gs.forEach((l, j) => {
      const s = grid.s * (j ? 10 : 1), a = grid.alpha[j];
      l.visible = grid.show && a > 0.002;
      if (!l.visible) return;
      // lattice centred on the grid point nearest c, so lines stay put while the target moves
      const p = [Math.round(grid.c[0] / s) * s, Math.round(grid.c[1] / s) * s, grid.c[2]];
      rel(p, l.position); l.scale.setScalar(s * KM);
      l.material.uniforms.uAlpha.value = a;
    });
    renderer.clear();
    renderer.render(scene, camera);
    const g = opts.glare;
    if (g && g.i > 0.003) {
      glare.visible = true; glare.position.set(g.x, H - g.y, 0); glare.scale.setScalar(g.L * GLARE_EXT);
      glare.material.uniforms.uI.value = g.i;
      renderer.render(over, ocam);
    }
  }
  function dispose() { renderer.dispose(); }

  return { size, view, setActive, render, bodies, body, skySet, line, lineDrop, lineDropAll, lineUpTo, lineSet, lineOpacity, lineGlow, fadeSet, dyn, dynSet, dynHide, gridSet, craft, dispose,
    get gl() { return renderer.getContext(); }, renderer };
}
