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
varying float vY, vZ;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vUv = uv; vY = position.y; vZ = position.z;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;
export const CRAFT_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor, uSun, uBack;
uniform float uFlat, uTex, uSpec, uClip, uPort, uRod;
uniform sampler2D uMap;
varying vec3 vN, vW;
varying vec2 vUv;
varying float vY, vZ;
void main() {
  #include <logdepthbuf_fragment>
  if (vY > uClip) discard; // a liquid's surface (the cutaway's fills)
  if (abs(vZ) < uPort || abs(vZ) > uRod) discard; // a solid grain's bore, a rod's outside
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
  // a skirt (2026-11-16: forward, intertank, payload fitting): aluminium with vertical stringers, frames and rivet rows
  skirt(x, w, h, C) {
    const r = rnd(9), b = hx(C.dim, C.ink, 0.38); x.fillStyle = b; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { x.fillStyle = rgba(r() < 0.5 ? C.solid : '#ffffff', 0.04 * r()); x.fillRect(r() * w, 0, 1, h); }
    for (let i = 0; i < 32; i++) { const u = (i + 0.5) / 32 * w; x.fillStyle = rgba(C.solid, 0.32); x.fillRect(u - 1, 0, 2, h); x.fillStyle = rgba('#ffffff', 0.16); x.fillRect(u + 1, 0, 1, h); }
    x.fillStyle = rgba(C.solid, 0.4);
    for (const v of [0.08, 0.5, 0.92]) { x.fillRect(0, h * (1 - v) - 2, w, 4); for (let u = 4; u < w; u += 8) { x.fillStyle = rgba('#ffffff', 0.35); x.fillRect(u, h * (1 - v) - 5, 1.5, 1.5); x.fillRect(u, h * (1 - v) + 4, 1.5, 1.5); x.fillStyle = rgba(C.solid, 0.4); } }
  },
  // an equipment deck: a honeycomb panel's face sheet (faint cells), an edge closeout band
  deck(x, w, h, C) {
    x.fillStyle = hx(C.solid, C.dim, 0.6); x.fillRect(0, 0, w, h);
    x.strokeStyle = rgba(C.solid, 0.25); x.lineWidth = 1;
    for (let j = 0, k = 9; j * k * 0.87 < h + k; j++) for (let i = 0; i * k < w + k; i++) { const cx = i * k + (j % 2) * k / 2, cy = j * k * 0.87; x.beginPath(); for (let a = 0; a < 6; a++) { const t = a * Math.PI / 3 + Math.PI / 6; x.lineTo(cx + 0.55 * k * Math.cos(t), cy + 0.55 * k * Math.sin(t)); } x.closePath(); x.stroke(); }
    x.fillStyle = rgba(C.ink, 0.25); x.fillRect(0, h * 0.42, w, h * 0.16);
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
// The plume (Phase 18c; redone 2026-11-14, 2026-11-15; a volume 2026-11-16): a flame along the thrust axis drawn as a
// volume, not as planes or a sprite. One hull (a cone round the axis, −y of the plume from the nozzle exit, sized by
// uniforms in the vertex shader) only gives the pixels; for each one the fragment shader marches the view ray through
// an axisymmetric density between its entry and exit (the bounding cylinder and the two end planes, found
// analytically), so from the side, obliquely and end on the flame has no edges or crossings to show. Its width grows
// out of the nozzle (uR0 → uR1 over uLen, model units); layers: a dense bright core at the exit, the body widening,
// thinning and wavering with 3D value noise drifting downstream (uT), a faint wide halo; the light adds up and
// saturates softly. Additive (ONE, ONE), no depth writes; the hull's front faces, its back faces when the camera is
// inside it (uCam: the camera in the plume's axes). uSimple: fewer steps, no noise (the low quality).
export const PLUME_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uLen, uRh0, uRh1;
varying vec3 vL;
void main() {
  float a = -position.y, rh = mix(uRh0, uRh1, a);
  vL = vec3(position.x * rh, position.y * uLen, position.z * rh);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vL, 1.0);
  #include <logdepthbuf_vertex>
}`;
export const PLUME_FS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCore, uBody, uCam;
uniform float uI, uT, uSimple, uSeed, uLen, uR0, uR1, uRh1;
varying vec3 vL;
// a hash without sin (float precision holds on every GPU; the clock is wrapped in mode3d.js)
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1.0, 0.0, 0.0)), f.x), mix(h31(i + vec3(0.0, 1.0, 0.0)), h31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(h31(i + vec3(0.0, 0.0, 1.0)), h31(i + vec3(1.0, 0.0, 1.0)), f.x), mix(h31(i + vec3(0.0, 1.0, 1.0)), h31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 ro = uCam, rd = normalize(vL - uCam);
  // the ray's stretch inside the bounding cylinder (radius uRh1) between the exit plane y = 0 and the tip y = −uLen
  float t0 = 0.0, t1 = 1e9, A = dot(rd.xz, rd.xz), B = dot(ro.xz, rd.xz), C = dot(ro.xz, ro.xz) - uRh1 * uRh1;
  if (A > 1e-9) { float D = B * B - A * C; if (D <= 0.0) discard; float q = sqrt(D); t0 = (-B - q) / A; t1 = (-B + q) / A; }
  else if (C > 0.0) discard;
  if (abs(rd.y) > 1e-7) { float ta = -ro.y / rd.y, tb = (-uLen - ro.y) / rd.y; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
  else if (ro.y > 0.0 || ro.y < -uLen) discard;
  t0 = max(t0, 0.0); if (t1 <= t0) discard;
  const int N = 28;
  int n = uSimple > 0.5 ? 10 : N;
  float dt = (t1 - t0) / float(n), j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); // per-pixel offset: no banding
  vec3 acc = vec3(0.0); float tot = 0.0;
  for (int i = 0; i < N; i++) {
    if (i >= n) break;
    vec3 p = ro + rd * (t0 + (float(i) + j) * dt);
    float a = clamp(-p.y / uLen, 0.0, 1.0), w = mix(uR0, uR1, pow(a, 0.65)), r = length(p.xz) / w, nz = 0.5;
    if (uSimple < 0.5) {
      vec3 q = vec3(p.x / uR1 * 2.2, (p.y + uT * uLen * 1.4) / uLen * 5.0, p.z / uR1 * 2.2) + uSeed;
      nz = 0.65 * vnoise(q) + 0.35 * vnoise(q * 2.3 + 7.1);
      r *= 1.0 + (nz - 0.5) * 0.5 * a; // the envelope wavers, more downstream
    }
    float fade = (1.0 - a) * (1.0 - a), core = exp(-r * r * 7.0) * (exp(-a * 6.0) * 4.5 + exp(-a * 1.8) * 0.45 * fade);
    float body = exp(-r * r * 3.2) * pow(1.0 - a, 1.9) * (0.25 + 0.95 * nz);
    float halo = exp(-r * r * 0.9) * pow(1.0 - a, 3.0) * 0.1;
    float d = (core + body + halo) * dt / w * smoothstep(0.0, 0.02, a) * smoothstep(1.0, 0.85, a); // no edge at the exit plane or the tip
    acc += mix(uBody, uCore, clamp(core / (core + body + 0.4 * halo + 1e-4), 0.0, 1.0)) * d; tot += d;
  }
  float I = (1.0 - exp(-tot * 1.1)) * uI;
  gl_FragColor = vec4(acc / max(tot, 1e-5) * I, I);
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
    uRingR: new THREE.Vector2(1, 2), uLayers: new THREE.Vector4(), uNightLo: 0, uRelief4: new THREE.Vector4(), uHaze: new THREE.Vector4(), uHazeC: new THREE.Vector4(), uHazeL: new THREE.Vector3(0, 1, 0),
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
    u.uLayers.value.fromArray(U.layers); u.uNightLo.value = U.nightLo; u.uRelief4.value.fromArray(U.relief); u.uHaze.value.fromArray(U.haze); u.uHazeC.value.fromArray(U.hazeC); u.uHazeL.value.fromArray(U.hazeL);
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
  // pts: metres, 3 per point (n points); colors: linear RGB per point or null; dash (optional, Phase 19c): segments per
  // dash, every other run of dash segments left out (a provisional path: the free flight's patched prediction)
  function dynSet(set, id, pts, n, colors, dash) {
    const d = dyns[set].get(id); if (!d) return;
    n = Math.min(n, d.cap);
    if (n < 2) { d.line.visible = false; return; }
    d.o[0] = pts[0]; d.o[1] = pts[1]; d.o[2] = pts[2];
    const A = d.geo.attributes.instanceStart.data, a = A.array;
    for (let j = 0; j < n - 1; j++) { const gap = dash > 0 && Math.floor(j / dash) % 2 === 1; for (let q = 0; q < 2; q++) for (let c = 0; c < 3; c++) a[6 * j + 3 * q + c] = (pts[3 * (j + (gap ? 0 : q)) + c] - d.o[c]) * KM; }
    A.needsUpdate = true;
    if (colors && d.geo.attributes.instanceColorStart) {
      const B = d.geo.attributes.instanceColorStart.data, b = B.array;
      for (let j = 0; j < n - 1; j++) for (let q = 0; q < 2; q++) for (let c = 0; c < 3; c++) b[6 * j + 3 * q + c] = colors[3 * (j + q) + c];
      B.needsUpdate = true;
    }
    d.geo.instanceCount = n - 1; d.line.visible = true;
  }
  function dynHide(set, id) { const d = dyns[set].get(id); if (d) d.line.visible = false; }
  function dynOpacity(set, id, opacity) { const d = dyns[set].get(id); if (d && d.mat.userData.base !== opacity) { d.mat.userData.base = opacity; fadeApply(set, id, d.mat); } }

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
  const craftG = { group: null, key: '', shells: [], fills: {}, mats: {}, plumes: [], ports: [], rcs: [] };
  // a lathe surface; its v runs by length along the profile (three.js spaces it by point), so the textures are not
  // squeezed into a tank's few cylinder points
  // A profile running downwards (a nozzle: throat to exit) is turned round so the outside is the front face (the
  // inside of an opened shell is drawn plain), its v still 0 at the profile's first point.
  const lathe = (pts0, half) => {
    const rev = pts0[0][1] > pts0[pts0.length - 1][1], pts = rev ? pts0.slice().reverse() : pts0;
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 40, half ? Math.PI : 0, half ? Math.PI : Math.PI * 2);
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
        uTex: { value: tex ? 1 : 0 }, uMap: { value: tex ? craftTex(tex, C) : null }, uSpec: { value: flat ? 0 : spec }, uClip: { value: 1e9 }, uPort: { value: -1 }, uRod: { value: 1e9 } } });
  }
  // a plume (2026-11-16: a volume): one hull along its axis (−y of the model, from the nozzle exit), the fragment shader
  // marches it; additive: blending ONE, ONE (premultiplied), no depth writes, after the model
  const rcsBlock = new THREE.BoxGeometry(0.03, 0.028, 0.03), rcsNoz = new THREE.CylinderGeometry(0.0035, 0.0075, 0.012, 10, 1, true), _Y = new THREE.Vector3(0, 1, 0), _nY = new THREE.Vector3(0, -1, 0);
  const ADD = { transparent: true, premultipliedAlpha: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false };
  const plumeHull = new THREE.CylinderGeometry(1, 1, 1, 32, 1, false).translate(0, -0.5, 0);
  function plumeMesh() {
    const grp = new THREE.Group(), mat = new THREE.ShaderMaterial({ vertexShader: PLUME_VS, fragmentShader: PLUME_FS, ...ADD, side: THREE.FrontSide, uniforms: { uCore: { value: new THREE.Color() }, uBody: { value: new THREE.Color() },
      uI: { value: 0 }, uT: { value: 0 }, uSimple: { value: 0 }, uSeed: { value: Math.random() * 50 }, uLen: { value: 1 }, uR0: { value: 0.1 }, uR1: { value: 0.6 }, uRh0: { value: 0.3 }, uRh1: { value: 1.5 }, uCam: { value: new THREE.Vector3() } } });
    const h = new THREE.Mesh(plumeHull, mat); h.renderOrder = 2; h.frustumCulled = false; grp.add(h);
    grp.userData.mat = mat; grp.userData.hull = h; grp.visible = false; return grp;
  }
  // a plume's shape (model units: its length, its half width at the exit and at the tip) and the camera in its axes
  // (after the craft's transform): the hull 2.6 half widths out, its back faces when the camera is inside it
  const _pc = new THREE.Vector3();
  function plumeSet(p, len, r0, r1) {
    const U = p.userData.mat.uniforms; U.uLen.value = len; U.uR0.value = r0; U.uR1.value = r1; U.uRh0.value = 2.6 * r0; U.uRh1.value = 2.6 * r1;
    p.userData.hull.worldToLocal(_pc.copy(camera.position)); U.uCam.value.copy(_pc);
    const a = -_pc.y / len, inside = a >= 0 && a <= 1 && Math.hypot(_pc.x, _pc.z) < 2.6 * (r0 + (r1 - r0) * a);
    const side = inside ? THREE.BackSide : THREE.FrontSide; if (p.userData.mat.side !== side) { p.userData.mat.side = side; p.userData.mat.needsUpdate = true; }
  }
  // build the model for engine type ty (grain for a solid); col: { metal, nozzle, fuel, ox, tex (the theme's colours for
  // the textures) }; prop: the propellant (the tanks' finish: foam on cryogenic ones, gold foil on storables, bare metal
  // for RP-1, a composite case for a hybrid's nitrous oxide); fo: the oxidizer tank's share of a liquid engine's tank
  // length (their volumes)
  function craftBuild(ty, grain, col, prop, fo) {
    if (craftG.group) { if (craftG.group.parent) craftG.group.parent.remove(craftG.group); /* a mission's set or free flight's map */ craftG.group.traverse(o => { if (o.material) o.material.dispose(); if (o.geometry && ![quad, halfCyl, plumeHull, rcsBlock, rcsNoz].includes(o.geometry)) o.geometry.dispose(); }); }
    const g = new THREE.Group(); g.visible = false;
    const C = col.tex, cryo = /^lox/.test(prop || ''), T = (k, o) => craftMat(col.metal, false, k, o ? { ...C, ...o } : C, k === 'foam' ? 0.06 : k.startsWith('quilt') ? 0.18 : 0.25);
    const fin = TANK_FIN;
    const M = { metal: craftMat(col.metal), nozzle: craftMat(col.nozzle), fuel: craftMat(col.fuel, true), ox: craftMat(col.ox, true), wall: craftMat(col.fuel),
      fuelL: craftMat(col.fuel, true), oxL: craftMat(col.ox, true), line: craftMat(col.tex.ink), valve: craftMat(col.nozzle),
      oxTank: T(cryo ? 'foam' : prop === 'n2o_htpb' ? 'carbon' : fin), fuelTank: T(prop === 'lox_lh2' ? 'foam' : prop === 'lox_rp1' ? 'alu' : fin),
      caseC: T(ty === 'sol' ? 'case' : 'carbon'), skirt: T('skirt'), deck: T('deck'), copv: T('carbon'), ductC: craftMat(hx(C.ink, C.warn, 0.12)) };
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
    const port = (name, r, y0, y1, k = 0) => { const m = new THREE.Mesh(halfCyl, M.wall); m.visible = false; g.add(m); ports.push(m); fills[name] = { m, r, y0, y1, wall: true, k }; };
    // a solid's grain in the cut plane (2026-11-16): the case's inner outline (radius r, domes k·r), the bore and a rod's
    // outside clipped in the shader (uPort, uRod), so the grain follows the domes
    const grainFill = (name, mat0, r, y0, y1, k) => {
      const mat = craftMat(col.fuel, true), P = tankPts(r, y0, y1, k), sh = new THREE.Shape();
      P.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y))); for (let i = P.length - 1; i >= 0; i--) sh.lineTo(-P[i][0], P[i][1]);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(sh, 6).rotateY(-Math.PI / 2), mat); m.position.x = 0.001; m.visible = false; g.add(m);
      M['grain_' + name] = mat; fills[name] = { m, grainO: true, r, y0, y1, k };
    };
    const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); g.add(m); return m; };
    let exitR = 0.095;
    // ---- shared parts (2026-11-16) ----
    // a band (flange, joint or attach ring): inner radius r, at y, h tall, t thick; cut like the shells
    const band = (r, y, h, t, mat = M.metal) => shell([[r, y - h / 2], [r + t, y - h / 2], [r + t, y + h / 2], [r, y + h / 2], [r, y - h / 2]], mat);
    // a straight member between two points (struts, brackets, actuators)
    const V3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);
    const strut = (a, b, r, mat = M.metal) => {
      const A = V3(a), B = V3(b), d = B.clone().sub(A), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 8), mat);
      m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(_Y, d.normalize()); g.add(m); return m;
    };
    // a pipe along points (a smooth centripetal spline, so it does not overshoot its bends), flanges at both ends
    const pipe = (P, r, mat = M.line, fl = true) => {
      const cv = new THREE.CatmullRomCurve3(P.map(V3), false, 'centripetal');
      g.add(new THREE.Mesh(new THREE.TubeGeometry(cv, Math.max(24, P.length * 14), r, 10, false), mat));
      if (fl) for (const u of [0, 1]) { const f = new THREE.Mesh(new THREE.TorusGeometry(r * 1.35, r * 0.45, 6, 16), M.valve); f.position.copy(cv.getPointAt(u)); f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), cv.getTangentAt(u)); g.add(f); }
      return cv;
    };
    // a valve on a pipe at u: a body across it and an actuator box
    const valve = (cv, u, r, mat = M.valve) => {
      const p = cv.getPointAt(u), t = cv.getTangentAt(u), b = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.9, r * 1.9, r * 3.2, 12), mat);
      b.position.copy(p); b.quaternion.setFromUnitVectors(_Y, t); g.add(b);
      const side = new THREE.Vector3().crossVectors(t, Math.abs(t.y) < 0.9 ? _Y : new THREE.Vector3(1, 0, 0)).normalize(), a = new THREE.Mesh(new THREE.BoxGeometry(r * 2.4, r * 2.4, r * 2.4), M.metal);
      a.position.copy(p).addScaledVector(side, r * 2.6); g.add(a);
    };
    const sphere = (r, p, mat) => add(new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat), p[0], p[1], p[2]);
    // the point on a tank's dome (radius R, pole at yp, dome height kR, going up (+1) or down (−1) from the pole) at an angle a from the axis
    const dome = (R, yp, k, s, a, az = 0) => [Math.cos(az) * R * Math.sin(a), yp + s * k * R * (1 - Math.cos(a)), Math.sin(az) * R * Math.sin(a)];
    if (ty === 'liq') {
      // Upper stage after a Centaur / Delta upper stage: forward skirt and payload ring, the oxidizer tank, an intertank
      // skirt over the two domes, the fuel tank, an aft ring and a truss thrust structure to the gimbal; the engine's one
      // profile (injector dome, chamber, bell); a turbopump pair for a cryogenic engine (fuel and oxidizer pumps beside
      // the chamber, their discharge into the injector) or, pressure-fed, a valve block and helium bottles. The
      // oxidizer duct leaves the upper tank's aft dome, runs down the outside of the fuel tank on standoffs and along the
      // truss into its pump (or valve); the fuel duct drops from the lower dome through the truss.
      const R = 0.12, dh = 0.5 * R, top = 0.47, bot = -0.21, gap = 0.05, span = top - bot - gap;
      const lo = Math.max(0.16, Math.min(span - 0.16, span * (fo > 0 ? fo : 0.5))), yO0 = top - lo, yF1 = yO0 - gap;
      shell(tankPts(R, yO0, top), M.oxTank); liquid('ox', M.oxL, R, yO0, top, 0.5);
      shell(tankPts(R, bot, yF1), M.fuelTank); liquid('fuel', M.fuelL, R, bot, yF1, 0.5);
      shell([[R + 0.002, top - dh + 0.015], [R + 0.002, 0.492]], M.skirt); band(R - 0.012, 0.492, 0.012, 0.016); // forward skirt, payload interface ring
      shell([[R + 0.002, yF1 - dh + 0.012], [R + 0.002, yO0 + dh - 0.012]], M.skirt); band(R, yF1 - dh + 0.012, 0.008, 0.006); band(R, yO0 + dh - 0.012, 0.008, 0.006); // intertank
      const yA = bot + dh * 0.55; band(R - 0.014, yA, 0.01, 0.018); // the aft ring the thrust structure hangs from
      const yG = -0.274; band(0.012, yG, 0.008, 0.014); // the gimbal mount ring
      for (let i = 0; i < 8; i++) { const a0 = (i + 0.5) / 8 * 2 * Math.PI, a1 = a0 + (i % 2 ? -1 : 1) * Math.PI / 8; strut([Math.cos(a0) * (R - 0.01), yA - 0.004, Math.sin(a0) * (R - 0.01)], [Math.cos(a1) * 0.022, yG, Math.sin(a1) * 0.022], 0.0035); }
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.012, 16), M.valve), 0, yG - 0.008, 0); // gimbal block
      add(new THREE.Mesh(new THREE.TorusGeometry(0.0125, 0.0028, 6, 20).rotateZ(Math.PI / 2), M.metal), 0, yG - 0.008, 0); // its cross pin
      const ep = engineProfile({ rc: 0.026, rt: 0.0122, re: 0.064, yc0: -0.302, Lc: 0.03, Lv: 0.022, dome: 0.012 });
      M.nozLiq = T('nozLiq', { vt: ep.vt, ve: ep.ve });
      shell(ep.pts, M.nozLiq); exitR = 0.064;
      band(0.026, -0.318, 0.006, 0.004); // the chamber collar the actuators hold
      for (const z of [1, -1]) strut([0, yA - 0.006, z * (R - 0.02)], [0, -0.318, z * 0.031], 0.0042, M.valve); // gimbal actuators (pitch, yaw)
      const duct = cryo ? M.ductC : M.line, rD = 0.0062, rF = 0.0058;
      // the oxidizer duct: off the upper tank's aft dome, out through the intertank, down the fuel tank, along the truss
      const o0 = dome(R, yO0, 0.5, 1, 1.05, Math.PI), xo = -(R + 0.017);
      const oxIn = cryo ? [-0.067, -0.296, 0] : [-0.014, -0.286, 0];
      const oxP = [o0, [o0[0] - 0.006, o0[1] - 0.02, 0], [xo, yO0 - 0.004, 0], [xo, (yO0 + yA) / 2, 0], [xo, yA + 0.01, 0], [xo + 0.012, yA - 0.03, 0], [-0.088, -0.255, 0], [oxIn[0] - 0.004, oxIn[1] + 0.014, 0], oxIn];
      const oc = pipe(oxP, rD, duct); valve(oc, 0.82, rD);
      for (let i = 1; i <= 3; i++) { const y = yO0 - 0.01 + (yA + 0.01 - yO0 + 0.01) * i / 4; strut([xo + rD * 0.6, y, 0], [-R + 0.002, y, 0], 0.0028); strut([xo, y, -0.006], [-R * Math.cos(0.12), y, -R * Math.sin(0.12)], 0.0022); } // standoffs
      // the fuel duct: from the lower dome through the truss
      const f0 = dome(R, bot, 0.5, 1, 0.75, 0), fuIn = cryo ? [0.067, -0.296, 0] : [0.014, -0.286, 0];
      const fc = pipe([f0, [f0[0] + 0.004, f0[1] - 0.02, 0], [0.085, -0.24, 0], [fuIn[0] + 0.006, fuIn[1] + 0.016, 0], fuIn], rF, duct); valve(fc, 0.6, rF);
      if (cryo) { // the turbopumps beside the chamber (fuel at +x, oxidizer at −x), their discharge ducts into the injector dome
        for (const s of [1, -1]) {
          const x = s * 0.06, y = -0.312;
          add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.013, 0.03, 16), M.metal), x, y, 0);
          add(new THREE.Mesh(new THREE.TorusGeometry(0.0135, 0.0048, 8, 20).rotateX(Math.PI / 2), M.valve), x, y + 0.006, 0); // the volute
          add(new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.012, 14), M.valve), x, y - 0.019, 0); // the turbine
          pipe([[x, y + 0.016, 0], [x - s * 0.006, -0.288, 0], [s * 0.024, -0.286, 0], [s * 0.012, -0.291, 0]], 0.0042, M.line);
          strut([x - s * 0.012, y, 0], [s * 0.026, y - 0.004, 0], 0.0025); // its mount on the chamber
        }
        pipe([[0.06, -0.327, 0], [0.05, -0.335, 0.015], [0.0, -0.326, 0.028], [-0.05, -0.335, 0.015], [-0.06, -0.327, 0]], 0.0028, M.line, false); // the turbine drive (hydrogen) line
      } else { // pressure-fed: the bipropellant valve block on the injector, helium bottles and their regulator on the truss
        add(new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.012, 0.022), M.valve), 0, -0.287, 0);
        for (const z of [0.082, -0.082]) {
          sphere(0.027, [0.0, -0.238, z], M.copv);
          strut([0, -0.238 + 0.02, z * 0.82], [0, yA - 0.004, z * 1.2], 0.0024); strut([0, -0.262, z * 0.85], [0, yG, z * 0.25], 0.0024);
        }
        pipe([[0.0, -0.238, 0.055], [0.03, -0.235, 0.03], [0.05, -0.215, 0.012], [f0[0] - 0.02, f0[1] - 0.006, 0.006]], 0.0022, M.line, false);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, 0.012), M.metal), 0.03, -0.235, 0.03);
      }
      craftG.rcsAt = [R, 0.405, R, bot + dh + 0.02];
    } else if (ty === 'hyb') {
      // A hybrid stage: the nitrous oxide tank (composite overwrap) under a forward skirt, an interstage skirt hiding the
      // feed with its main oxidizer valve, the motor case with bolted forward and aft flanges (pre- and post-combustion
      // chambers in its domes), the grain and its port; the ablative nozzle on an aft closure
      const R = 0.12;
      shell(tankPts(R, 0.1, 0.47), M.oxTank); liquid('ox', M.oxL, R, 0.1, 0.47, 0.5);
      shell([[R + 0.002, 0.43], [R + 0.002, 0.492]], M.skirt); band(R - 0.012, 0.492, 0.012, 0.016);
      const rc = 0.125, cT = 0.03, cB = -0.36, kc = 0.3;
      shell([[R + 0.004, cT - kc * rc + 0.008], [R + 0.004, 0.1 + 0.5 * R - 0.008]], M.skirt); // interstage
      band(R + 0.004, 0.1 + 0.5 * R - 0.008, 0.008, 0.005);
      const fc = pipe([[0, 0.1, 0], [0, 0.07, 0], [0, cT + 0.004, 0]], 0.009, M.line); valve(fc, 0.5, 0.009);
      shell(tankPts(rc, cB, cT, kc), M.caseC); fill('grainA', M.fuel, 0.115, -0.33, -0.005); fill('grainB', M.fuel, 0.115, -0.33, -0.005); port('port', 0.115, -0.33, -0.005);
      band(rc, cT - kc * rc, 0.012, 0.006, M.valve); band(rc, cB + kc * rc, 0.012, 0.006, M.valve); // the case's bolted flanges
      for (let i = 0; i < 16; i++) { const a = i / 16 * 2 * Math.PI; for (const y of [cT - kc * rc, cB + kc * rc]) add(new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.006), M.metal), Math.cos(a) * (rc + 0.0065), y, Math.sin(a) * (rc + 0.0065)); } // bolt heads
      band(0.056, cB + 0.004, 0.014, 0.012, M.metal); // the aft closure
      const ep = engineProfile({ rc: 0.058, rt: 0.022, re: 0.088, yc0: -0.357, Lc: 0.004, Lv: 0.03 });
      M.nozAbl = T('nozAbl', { vt: ep.vt }); shell(ep.pts, M.nozAbl); exitR = 0.088;
      craftG.rcsAt = [R, 0.4, rc, -0.25];
    } else if (ty === 'sol') {
      // A solid kick motor after the STAR 48: a near-spherical case with a short cylinder, attach rings at the dome
      // joints, the payload attach fitting and its ring on the forward dome, the igniter boss, the long submerged nozzle
      // (carbon exit cone) on its aft flange; the cutaway's grain fills the case round its bore (an outline, the port a
      // clip in the shader), so it follows the domes
      const rc = 0.21, cB = -0.2, cT = 0.3, kc = 0.92, j1 = cT - kc * rc, j0 = cB + kc * rc;
      shell(tankPts(rc, cB, cT, kc), M.caseC); grainFill('grain', M.fuel, rc - 0.008, cB + 0.008, cT - 0.008, kc); port('port', rc - 0.008, cB + 0.008, cT - 0.008, kc);
      band(rc, j1, 0.012, 0.006, M.valve); band(rc, j0, 0.012, 0.006, M.valve);
      shell([[0.105, cT - 0.012], [0.098, cT + 0.03], [0.092, cT + 0.062]], M.skirt); band(0.08, cT + 0.062, 0.01, 0.018); // payload attach fitting
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.02, 14), M.valve), 0, cT + 0.004, 0); // the igniter boss
      band(0.062, cB + 0.004, 0.014, 0.016, M.metal); // the nozzle's aft flange
      const ep = engineProfile({ rc: 0.07, rt: 0.03, re: 0.135, yc0: -0.17, Lc: 0.004, Lv: 0.035 });
      M.nozAbl = T('nozAbl', { vt: ep.vt }); shell(ep.pts, M.nozAbl); exitR = 0.135;
      craftG.rcsAt = [0.1, cT + 0.035, 0.075, cB - 0.02];
    } else {
      // A monopropellant craft after a small probe's hydrazine system: the spherical propellant tank (its diaphragm's
      // liquid in the cutaway) on a girth ring and four legs, the equipment deck, a helium pressurant bottle (composite)
      // with its regulator and line to the tank's gas port, the propellant line from the tank's outlet through a filter
      // and a latch valve into the manifold ring, and four canted thrusters under the deck (valve, thermal standoff,
      // catalyst bed with heater bands, bell); their plumes along their axes
      const R = 0.19, yc = 0.155, yD = -0.135;
      shell(tankPts(R, yc - R, yc + R, 1), M.oxTank); liquid('fuel', M.fuelL, R, yc - R, yc + R, 1);
      band(R, yc, 0.014, 0.008, M.valve); // girth ring
      for (let i = 0; i < 4; i++) { const a = (i + 0.5) / 4 * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a); strut([c * (R + 0.006), yc - 0.004, s * (R + 0.006)], [c * 0.235, yD + 0.012, s * 0.235], 0.0055); strut([c * (R + 0.006), yc - 0.004, s * (R + 0.006)], [Math.cos(a + 0.5) * 0.2, yD + 0.012, Math.sin(a + 0.5) * 0.2], 0.0035); }
      shell([[0.0, yD - 0.013], [0.255, yD - 0.013], [0.255, yD + 0.012], [0.0, yD + 0.012]], M.deck); // the deck
      const pP = [0.185, yD + 0.072, 0.0];
      sphere(0.06, pP, M.copv); // the pressurant bottle
      add(new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.014, 0.018), M.valve), pP[0], pP[1] + 0.07, 0); // regulator
      const gas = dome(R, yc + R, 1, -1, 0.35, 0);
      const gc = pipe([[pP[0], pP[1] + 0.058, 0], [pP[0], pP[1] + 0.078, 0], [0.205, yc, 0.0], [0.19 * Math.sin(0.8) + 0.015, yc + 0.19 * Math.cos(0.8) + 0.01, 0], gas], 0.0035, M.line);
      valve(gc, 0.25, 0.0035);
      const out = [0, yc - R, 0], pc = pipe([out, [0, yc - R - 0.03, 0], [0, yD + 0.035, 0]], 0.0055, M.line);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.026, 12), M.metal), 0, yc - R - 0.03, 0); // filter
      valve(pc, 0.8, 0.0055); // latch valve
      add(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.004, 6, 40).rotateX(Math.PI / 2), M.line), 0, yD + 0.022, 0); // manifold ring
      pipe([[0, yD + 0.035, 0], [0.04, yD + 0.025, 0], [0.15, yD + 0.022, 0]], 0.0035, M.line, false);
      const cant = 10 * Math.PI / 180, thr = [];
      for (let i = 0; i < 4; i++) {
        const a = (i + 0.5) / 4 * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a), tg = new THREE.Group();
        tg.position.set(c * 0.15, yD - 0.013, s * 0.15);
        tg.quaternion.setFromUnitVectors(_nY, new THREE.Vector3(c * Math.sin(cant), -Math.cos(cant), s * Math.sin(cant)));
        const part = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; tg.add(m); };
        part(new THREE.CylinderGeometry(0.013, 0.013, 0.02, 14), M.valve, -0.01); // the valve
        part(new THREE.CylinderGeometry(0.0035, 0.0035, 0.018, 8), M.line, -0.028); // thermal standoff
        part(new THREE.CylinderGeometry(0.011, 0.011, 0.03, 14), M.metal, -0.051); // catalyst bed
        for (const y of [-0.042, -0.058]) part(new THREE.TorusGeometry(0.0115, 0.0018, 6, 18).rotateX(Math.PI / 2), M.valve, y); // heater bands
        const bell = new THREE.Mesh(lathe(bellPts(0.0075, 0.024, -0.066, -0.115), false), M.nozzle); tg.add(bell);
        g.add(tg); tg.updateMatrix();
        thr.push({ p: new THREE.Vector3(0, -0.115, 0).applyMatrix4(tg.matrix), d: new THREE.Vector3(0, -1, 0).applyQuaternion(tg.quaternion) });
        strut([c * 0.15, yD + 0.022, s * 0.15], [c * 0.15, yD + 0.012, s * 0.15], 0.0035, M.line);
      }
      craftG.thr = thr; exitR = 0.024;
      craftG.rcsAt = [R + 0.006, yc + 0.02, 0.255, yD];
    }
    craftG.exitR = exitR;
    // the RCS (2026-11-16): four quads round the body near the nose and four near the tail ([radius, y nose, y tail]),
    // each a block with a nozzle pointing out and a small puff along its exhaust; a nozzle's torque on the craft
    // p × (−e) picks which fire for a turn (js/fly.js flyRcs: a pair at the nose and the opposite pair at the tail)
    const RQ = craftG.rcsAt || [0.12, 0.4, 0.12, -0.15], rcs = [];
    for (const [rq, y] of [[RQ[0], RQ[1]], [RQ[2], RQ[3]]]) for (const [cx, cz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const r = rq + 0.012, e = new THREE.Vector3(cx, 0, cz), p = new THREE.Vector3(cx * r, y, cz * r);
      add(new THREE.Mesh(rcsBlock, M.valve), p.x, y, p.z);
      const nz = add(new THREE.Mesh(rcsNoz, M.nozzle), cx * (r + 0.019), y, cz * (r + 0.019)); nz.quaternion.setFromUnitVectors(_Y, e);
      const pm = plumeMesh(); pm.position.set(cx * (r + 0.025), y, cz * (r + 0.025)); pm.quaternion.setFromUnitVectors(_nY, e); g.add(pm);
      rcs.push({ m: pm, tau: new THREE.Vector3().crossVectors(p, e.clone().negate()).normalize() });
    }
    craftG.rcsAt = null;
    const nPl = ty === 'mono' ? 4 : 1;
    for (let i = 0; i < nPl; i++) { const p = plumeMesh(); g.add(p); plumes.push(p); }
    roots.sim.add(g);
    Object.assign(craftG, { group: g, shells, fills, ports, plumes, mats: M, ty, grain, rcs });
  }
  // o: { show, p (metres), axis (unit, the nose), L (m), sun (unit, world), cut, type, grain, col, st: core.js engState,
  //      plume: { color, a, len (model lengths) } }
  const _cx = new THREE.Vector3(), _cy = new THREE.Vector3(), _cz = new THREE.Vector3(), _cm = new THREE.Matrix4();
  function craft(o) {
    if (!o.show) { if (craftG.group) craftG.group.visible = false; return; }
    const fo = Math.round((o.fo || 0.5) * 100) / 100, key = [o.type, o.grain, o.prop, fo, o.col.metal, o.col.fuel, o.col.ox, o.col.nozzle].join('|');
    if (craftG.key !== key) { craftBuild(o.type, o.grain, o.col, o.prop, fo); craftG.key = key; }
    const g = craftG.group, L = o.L * KM, st = o.st || {}, root = roots[o.set || 'sim'];
    if (g.parent !== root) root.add(g); // a mission's view or free flight's map (Phase 19d)
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
      if (f.grainO) { const U = m.material.uniforms; U.uPort.value = ri > 0.001 ? ri * f.r : -1; U.uRod.value = craftG.grain === 'rod' ? ro * f.r : 1e9; m.visible = w > 1e-4; continue; }
      if (f.wall) {
        m.visible = ri > 0.01 || craftG.grain === 'rod'; const rr = (craftG.grain === 'rod' ? ro : ri) * f.r, dy = f.k * f.r * (1 - Math.sqrt(Math.max(0, 1 - (rr / f.r) ** 2))); // within the domes
        m.scale.set(rr, Math.max(1e-4, len - 2 * dy), rr); m.position.set(0, (f.y0 + f.y1) / 2, 0); continue;
      }
      m.visible = w > 1e-4; m.scale.set(1, len, craftG.grain === 'rod' && craftG.ty === 'sol' ? 2 * ro * f.r : w);
      const zc = craftG.grain === 'rod' && craftG.ty === 'sol' ? 0 : (name === 'grainA' ? 1 : -1) * (ri * f.r + w / 2);
      m.position.set(0.001, (f.y0 + f.y1) / 2, zc);
      if (name === 'grainB' && craftG.grain === 'rod' && craftG.ty === 'sol') m.visible = false;
    }
    g.updateMatrixWorld(true); // the plumes need the camera in their axes
    // the RCS puffs (o.rcs: { a (the angular acceleration's axis, model axes), k, core, body }): the nozzles whose torque
    // lies along it
    const rc = o.rcs, al = rc ? Math.hypot(rc.a[0], rc.a[1], rc.a[2]) || 1 : 1;
    for (const q of craftG.rcs) {
      const f = rc && rc.k > 0.01 ? (q.tau.x * rc.a[0] + q.tau.y * rc.a[1] + q.tau.z * rc.a[2]) / al : 0, I = rc ? rc.k * Math.max(0, Math.min(1, (f - 0.5) / 0.4)) : 0;
      q.m.visible = I > 0.01; if (!q.m.visible) continue;
      const U = q.m.userData.mat.uniforms; U.uCore.value.set(rc.core); U.uBody.value.set(rc.body); U.uI.value = 0.9 * I; U.uT.value = (o.plume && o.plume.t) || 0;
      U.uSimple.value = o.plume && o.plume.simple ? 1 : 0; plumeSet(q.m, 0.06 + 0.05 * I, 0.005, 0.016 + 0.012 * I);
    }
    // the plume(s): while the engine burns and the moment after its cut (o.plume.I goes to 0); length, width and
    // brightness by thrust (o.plume: { core, body (colours), I, len (model lengths), t (s, the noise's drift), simple })
    const pl = o.plume || { I: 0 }, on = pl.I > 0.002, mono = craftG.plumes.length > 1;
    craftG.plumes.forEach((p, i) => {
      p.visible = on; if (!on) return;
      const U = p.userData.mat.uniforms, len = mono ? pl.len * 0.3 : pl.len, r0 = mono ? 0.024 : craftG.exitR || 0.095;
      U.uCore.value.set(pl.core); U.uBody.value.set(pl.body); U.uI.value = pl.I; U.uT.value = pl.t || 0; U.uSimple.value = pl.simple ? 1 : 0;
      if (mono && craftG.thr) { const q = craftG.thr[i]; p.position.copy(q.p); p.quaternion.setFromUnitVectors(_nY, q.d); } else p.position.set(0, -0.5, 0);
      p.updateMatrixWorld(true); plumeSet(p, len, r0 * 0.8, r0 + len * 0.17);
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
  function setActive(set) { active = set; for (const k in roots) roots[k].visible = k === set; if (craftG.group && craftG.group.parent !== roots[set]) craftG.group.visible = false; }
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

  return { size, view, setActive, render, bodies, body, skySet, line, lineDrop, lineDropAll, lineUpTo, lineSet, lineOpacity, lineGlow, fadeSet, dyn, dynSet, dynHide, dynOpacity, gridSet, craft, dispose,
    get gl() { return renderer.getContext(); }, renderer };
}
