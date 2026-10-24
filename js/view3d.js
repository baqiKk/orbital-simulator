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
uniform vec3 uSun, uCam;
varying vec3 vO;
${GLOBE_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vO);
  gl_FragColor = vec4(globeColor(n, uSun, normalize(uCam - n), uRing > 0.5 ? ringShadow(uRingR, n, uSun) : 1.0), 1.0);
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
// view frame), the map in celestial coordinates (right ascension increasing to the left, 0h in the middle)
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
void main() {
  #include <logdepthbuf_fragment>
  vec3 e = normalize(vD);
  const float c = 0.9174820621, s = 0.3977771559; // J2000 obliquity: ecliptic -> equatorial
  vec3 q = vec3(e.x, c * e.y - s * e.z, s * e.y + c * e.z);
  float u = 0.5 - atan(q.y, q.x) / 6.2831853, u2 = fract(u + 0.5) - 0.5;
  vec2 uv = vec2(fwidth(u) <= fwidth(u2) + 1e-6 ? u : u2, 0.5 + asin(clamp(q.z, -1.0, 1.0)) / 3.1415927);
  gl_FragColor = vec4(texture(uMilky, uv).rgb * uGain, 1.0);
  #include <colorspace_fragment>
}`;
// bright stars: points along their directions (ecliptic axes, same mesh turning), a Gaussian of the pixel ratio's size
// whose peak follows the flux; brighter than white, it widens instead (the light it carries keeps growing)
const STAR_VS = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aPeak;
attribute vec3 aCol;
uniform float uDpr;
varying vec3 vC;
varying float vS;
void main() {
  float g = clamp(pow(aPeak, 0.35), 1.0, 4.0);
  vS = 0.6 * uDpr * g;
  vC = aCol * min(aPeak, 1.0);
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

// Tone mapping: the custom operator of js/globe.js (highlights only), through Three's CustomToneMapping hook
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace('vec3 CustomToneMapping( vec3 color ) { return color; }',
  TONEMAP_GLSL + '\nvec3 CustomToneMapping( vec3 color ) { return toneMap( color * toneMappingExposure ); }');
// every uniform GLOBE_GLSL declares, for each material that includes it
function globeUniforms(white) {
  const U = { uSun: new THREE.Vector3(1, 0, 0), uCam: new THREE.Vector3(0, 0, 5), uColor: new THREE.Color(1, 1, 1), uGlow: new THREE.Vector4(),
    uTex: 0, uMix: 0, uMix2: 0, uSat: 1, uLimb: 0, uRing: 0, uRingHas: 0, uTauHas: 0, uPhot: 0, uEmit: 0, uCloudRot: 0,
    uMap: white, uMap2: white, uRingMap: white, uTau: white, uClouds: white, uNight: white, uOcean: white, uRelief: white,
    uRingR: new THREE.Vector2(1, 2), uLayers: new THREE.Vector4(), uRelief4: new THREE.Vector4(), uHaze: new THREE.Vector4(), uHazeC: new THREE.Vector4(), uHazeL: new THREE.Vector3(0, 1, 0) };
  const o = {}; for (const k in U) o[k] = { value: U[k] }; return o;
}

// opts: fov (deg), void (clear colour), grid (grid colour)
export function create(canvas, opts) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
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
  function skySet(d) { // d: js/globe.js skyReady()
    if (milky || !d) return;
    milky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide,
      depthTest: false, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, uniforms: { uMilky: { value: texOf(d.milky.img, true, false) }, uGain: { value: SKY_GAIN } } }));
    milky.renderOrder = -11; milky.frustumCulled = false; sky.add(milky);
    const S = d.stars, g = new THREE.BufferGeometry(), pk = new Float32Array(S.n);
    for (let i = 0; i < S.n; i++) pk[i] = starPeak(S.mag[i]);
    g.setAttribute('position', new THREE.BufferAttribute(S.dir, 3)); g.setAttribute('aPeak', new THREE.BufferAttribute(pk, 1)); g.setAttribute('aCol', new THREE.BufferAttribute(S.col, 3));
    stars = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: STAR_VS, fragmentShader: STAR_FS, depthTest: false, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending, uniforms: { uDpr: { value: 1 } } }));
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
      return { set, mesh, ring: null, haze: null, hazeTop: 0, p: [0, 0, 0], r: 1, rot: null, sun: new THREE.Vector3(1, 0, 0) };
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
  // it). o (optional): rot (body axes -> world, row-major), look (js/globe.js globeLook), mix (first fade-in)
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
    const L = o && o.look, tx = L && L.tex;
    u.uTex.value = tx ? 1 : 0; u.uMap.value = tx ? texOf(tx.e.img, true) : white; u.uMix.value = tx ? o.mix : 0;
    u.uMap2.value = tx && tx.old ? texOf(tx.old.img, true) : white; u.uMix2.value = tx && tx.old ? tx.mix : 0;
    if (L && L.glow) u.uGlow.value.fromArray(L.glow); else u.uGlow.value.set(0, 0, 0, 0);
    u.uSat.value = L ? L.sat : 1; u.uLimb.value = L && L.limb ? 1 : 0;
    const U = lookUniforms(L);
    u.uLayers.value.fromArray(U.layers); u.uRelief4.value.fromArray(U.relief); u.uHaze.value.fromArray(U.haze); u.uHazeC.value.fromArray(U.hazeC); u.uHazeL.value.fromArray(U.hazeL);
    u.uCloudRot.value = U.cloudRot; u.uPhot.value = U.phot;
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
    m.resolution.set(W, H); mats.add(m); return m;
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
      const add = mat => { const l = new LineSegments2(geo, mat); l.position.set(o[0] * KM, o[1] * KM, o[2] * KM); h.group.add(l); return l; };
      h.chunks.push({ i0, i1, geo, lines: h.mats.map(add) });
      i0 = i1;
    }
  }
  function line(set, id, pts, n, opts = {}) {
    lineDrop(set, id);
    const h = { group: new THREE.Group(), anchor: [0, 0, 0], chunks: [], mats: [], show: true };
    h.mats.push(material(opts.color || '#ffffff', opts.opacity == null ? 1 : opts.opacity, opts.width || 1, { vertexColors: !!opts.colors, additive: opts.additive }));
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
  function lineOpacity(set, id, opacity) { const h = lines[set].get(id); if (h) h.mats[0].opacity = opacity; }
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
    dyns[set].set(id, d);
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

  // ---- frame ----
  function size(w, h, dpr) {
    W = w; H = h; DPR = dpr;
    ocam.right = w; ocam.top = h; ocam.updateProjectionMatrix();
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    for (const m of mats) m.resolution.set(w, h);
  }
  // camera: target t (metres), basis rows r (right), u (up), d (target → camera), distance (metres);
  // the target projects to (cx, cy) px (view offset), so it can sit in the middle of the free plot area
  function view(t, r, u, d, dist, cx, cy) {
    T[0] = t[0]; T[1] = t[1]; T[2] = t[2];
    camera.position.set(d[0] * dist * KM, d[1] * dist * KM, d[2] * dist * KM);
    camera.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...r), new THREE.Vector3(...u), new THREE.Vector3(...d)));
    camera.aspect = W / H;
    camera.near = Math.max(1e-6, dist * KM * 1e-7); camera.far = Math.max(1e7, dist * KM * 1e7);
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    camera.updateProjectionMatrix();
  }
  const _q = new THREE.Quaternion();
  function setActive(set) { active = set; for (const k in roots) roots[k].visible = k === set; }
  // opts: stars (draw the sky), sky (ecliptic -> view frame, row-major; null: the ecliptic axes), glare ({ x, y px from
  // the top left, L px, i intensity } or null)
  const _sk = new THREE.Matrix4();
  function render(opts) {
    if (lost) return;
    sky.visible = !!opts.stars && !!milky;
    if (sky.visible) {
      const m = opts.sky; sky.position.copy(camera.position); sky.scale.setScalar(camera.far * 0.5);
      if (m) sky.quaternion.setFromRotationMatrix(_sk.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1)); else sky.quaternion.identity();
      stars.material.uniforms.uDpr.value = DPR;
    }
    const rel = (p, o) => o.set((p[0] - T[0]) * KM, (p[1] - T[1]) * KM, (p[2] - T[2]) * KM);
    for (const b of sets[active]) {
      if (!b.mesh.visible) continue;
      rel(b.p, b.mesh.position); b.mesh.scale.setScalar(b.r * KM);
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
    for (const h of lines[active].values()) if (h.show) rel(h.anchor, h.group.position);
    for (const d of dyns[active].values()) if (d.line.visible) rel(d.o, d.line.position);
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

  return { size, view, setActive, render, bodies, body, skySet, line, lineDrop, lineDropAll, lineUpTo, lineSet, lineOpacity, lineGlow, dyn, dynSet, dynHide, gridSet, dispose,
    get gl() { return renderer.getContext(); }, renderer };
}
