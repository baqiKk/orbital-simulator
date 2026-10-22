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
// object-space position is the surface direction. uSun / uView: Sun and camera directions in those axes. Texture
// (equirectangular, fading in with uMix), saturation, limb darkening for untextured planets, Saturn's ring shadow;
// uEmit 1 = self-lit (the Sun). GLOBE_GLSL comes from js/globe.js (a classic script loaded before this module).
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
uniform vec3 uColor, uSun, uView;
uniform vec4 uGlow;
uniform float uEmit, uTex, uMix, uSat, uLimb, uRing;
uniform sampler2D uMap, uRingMap;
uniform vec2 uRingR;
varying vec3 vO;
${GLOBE_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vO);
  float day = globeDay(n, uSun);
  if (uRing > 0.5) day *= ringShadow(uRingMap, uRingR, n, uSun);
  vec3 base = uTex > 0.5 ? mix(uColor, globeTex(uMap, n, uSat), uMix) : uColor;
  float limb = uLimb > 0.5 ? plainShade(n, uSun, dot(n, uView)) : 1.0;
  gl_FragColor = vec4(base * mix(globeLit(day) * limb, 1.0, uEmit) + atmGlow(n, uSun, dot(n, uView), uGlow), 1.0);
  #include <colorspace_fragment>
}`;
// Saturn's rings: a flat annulus in the planet's equatorial plane (object space, planet radius 1), radial texture
// coordinate from the inner to the outer edge, lit by the Sun's elevation over the ring plane, in the planet's shadow.
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
uniform vec3 uSun;
uniform sampler2D uRingMap;
uniform vec2 uRingR;
varying vec3 vR;
${GLOBE_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  vec4 rc = ringSample(uRingMap, (length(vR.xy) - uRingR.x) / (uRingR.y - uRingR.x));
  gl_FragColor = vec4(rc.rgb * ringLight(uSun) * sphereShadow(vec3(vR.xy, 0.0), uSun), rc.a);
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

// opts: fov (deg), void (clear colour), grid (grid colour)
export function create(canvas, opts) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  renderer.setClearColor(new THREE.Color(opts.void), 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov || FOV, 1, 1e-6, 1e13);
  const roots = { sim: new THREE.Group(), map: new THREE.Group() };
  for (const g of Object.values(roots)) scene.add(g);
  let W = 1, H = 1, active = 'sim', lost = false;
  const T = [0, 0, 0];      // camera target, metres (view frame); the render origin
  const mats = new Set();   // LineMaterials (their resolution follows the canvas size)
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; });

  // ---- stars: fixed directions, drawn first, around the camera ----
  const stars = (() => {
    let seed = 7654321; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = 2600, p = new Float32Array(3 * n), c = new Float32Array(3 * n), R = 1e9;
    for (let i = 0; i < n; i++) {
      const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), s = Math.sqrt(1 - z * z);
      p[3 * i] = R * s * Math.cos(a); p[3 * i + 1] = R * s * Math.sin(a); p[3 * i + 2] = R * z;
      const m = rnd(), b = m > 0.985 ? 0.95 : m > 0.9 ? 0.6 : 0.32 + 0.2 * rnd(), t = rnd();
      const col = new THREE.Color(t > 0.85 ? 0xffd6aa : t > 0.7 ? 0xaac8ff : 0xe6ecf8).multiplyScalar(b);
      c[3 * i] = col.r; c[3 * i + 1] = col.g; c[3 * i + 2] = col.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthTest: false, depthWrite: false }));
    pts.renderOrder = -10; pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  })();

  // ---- bodies ----
  const sphere = new THREE.SphereGeometry(1, 64, 32);
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.22, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const sets = { sim: [], map: [] };
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
  // images (js/globe.js texture cache entries) -> Three.js textures
  const texs = new WeakMap(), maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  function texOf(img, repeat) {
    let t = texs.get(img); if (t) return t;
    t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
    t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.needsUpdate = true;
    texs.set(img, t); return t;
  }
  function bodies(set, list) {
    for (const b of sets[set]) {
      for (const m of [b.mesh, b.glow, b.ring]) if (m) { roots[set].remove(m); m.material.dispose(); }
      if (b.ring) b.ring.geometry.dispose();
    }
    sets[set] = list.map(d => {
      const mat = new THREE.ShaderMaterial({ vertexShader: BODY_VS, fragmentShader: BODY_FS,
        uniforms: { uColor: { value: new THREE.Color(d.color) }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uView: { value: new THREE.Vector3(0, 0, 1) },
          uEmit: { value: d.sun ? 1 : 0 }, uTex: { value: 0 }, uMix: { value: 0 }, uSat: { value: 1 }, uLimb: { value: 0 }, uRing: { value: 0 },
          uGlow: { value: new THREE.Vector4() }, uRingHas: { value: 0 }, uMap: { value: white }, uRingMap: { value: white }, uRingR: { value: new THREE.Vector2(1, 2) } } });
      const mesh = new THREE.Mesh(sphere, mat); mesh.visible = false; roots[set].add(mesh);
      let glow = null;
      if (d.sun) { glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(d.color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); glow.visible = false; roots[set].add(glow); }
      return { set, mesh, glow, ring: null, p: [0, 0, 0], r: 1, rot: null, sun: new THREE.Vector3(1, 0, 0) };
    });
  }
  // the ring annulus of a body, made on first use (radii in body radii)
  function ringOf(b, rr) {
    if (b.ring) return b.ring;
    const mat = new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uRingHas: { value: 0 }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uRingMap: { value: white }, uRingR: { value: new THREE.Vector2(rr[0], rr[1]) } } });
    b.ring = new THREE.Mesh(new THREE.RingGeometry(rr[0], rr[1], 256, 1), mat); b.ring.visible = false; roots[b.set].add(b.ring);
    return b.ring;
  }
  // body i of a set at p (metres), drawn radius r (metres), sun: unit vector towards the Sun in world axes (null keeps
  // it). o (optional): rot (body axes -> world, row-major), tex / ring (js/globe.js look: image entries, mix, sat,
  // limb, ring radii)
  const _m4 = new THREE.Matrix4();
  function body(set, i, p, r, sun, show, glowOn, o) {
    const b = sets[set][i]; if (!b) return;
    b.p[0] = p[0]; b.p[1] = p[1]; b.p[2] = p[2]; b.r = r;
    b.mesh.visible = show;
    if (sun) b.sun.set(sun[0], sun[1], sun[2]);
    if (b.glow) b.glow.visible = show && glowOn;
    const u = b.mesh.material.uniforms;
    b.rot = o && o.rot ? o.rot : null;
    if (b.rot) { const m = b.rot; b.mesh.quaternion.setFromRotationMatrix(_m4.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1)); }
    else b.mesh.quaternion.identity();
    const L = o && o.look;
    u.uTex.value = L && L.tex ? 1 : 0; u.uMap.value = L && L.tex ? texOf(L.tex.img, true) : white; u.uMix.value = L && L.tex ? o.mix : 0;
    if (L && L.glow) u.uGlow.value.fromArray(L.glow); else u.uGlow.value.set(0, 0, 0, 0);
    u.uSat.value = L ? L.sat : 1; u.uLimb.value = L && L.limb ? 1 : 0;
    const ring = L && L.ring && show ? ringOf(b, L.ring.r) : null;
    u.uRing.value = ring ? 1 : 0;
    if (ring) { u.uRingHas.value = ring.material.uniforms.uRingHas.value = L.ring.e ? 1 : 0; u.uRingMap.value = L.ring.e ? texOf(L.ring.e.img, false) : white; u.uRingR.value.set(L.ring.r[0], L.ring.r[1]); ring.material.uniforms.uRingMap.value = u.uRingMap.value; }
    if (b.ring) b.ring.visible = !!ring;
  }

  // ---- lines ----
  // A line is a group placed at (anchor − target); its chunks hold float32 offsets from their own float64 origin.
  // opts: color, opacity, width, glow: [width, opacity] (an extra wide faint line on the same geometry),
  // additive, colors (Float32Array, 3 per point, linear RGB), closed.
  const lines = { sim: new Map(), map: new Map() };
  function material(color, opacity, width, opts) {
    const m = new LineMaterial({ color: new THREE.Color(color), linewidth: width, transparent: true, opacity, depthWrite: false, vertexColors: !!opts.vertexColors });
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
      const m = new THREE.ShaderMaterial({ vertexShader: GRID_VS, fragmentShader: GRID_FS, transparent: true, depthWrite: false,
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
    W = w; H = h;
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
  function render(opts) {
    if (lost) return;
    stars.visible = !!opts.stars;
    stars.position.copy(camera.position);
    const rel = (p, o) => o.set((p[0] - T[0]) * KM, (p[1] - T[1]) * KM, (p[2] - T[2]) * KM);
    for (const b of sets[active]) {
      if (!b.mesh.visible) continue;
      rel(b.p, b.mesh.position); b.mesh.scale.setScalar(b.r * KM);
      if (b.glow) { b.glow.position.copy(b.mesh.position); b.glow.scale.setScalar(b.r * KM * 9); }
      // Sun and camera directions in the body's axes
      const u = b.mesh.material.uniforms, q = _q.copy(b.mesh.quaternion).invert();
      u.uSun.value.copy(b.sun).applyQuaternion(q);
      u.uView.value.copy(camera.position).sub(b.mesh.position).normalize().applyQuaternion(q);
      if (b.ring && b.ring.visible) {
        b.ring.position.copy(b.mesh.position); b.ring.quaternion.copy(b.mesh.quaternion); b.ring.scale.copy(b.mesh.scale);
        b.ring.material.uniforms.uSun.value.copy(u.uSun.value);
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
    renderer.render(scene, camera);
  }
  function dispose() { renderer.dispose(); }

  return { size, view, setActive, render, bodies, body, line, lineDrop, lineDropAll, lineUpTo, lineSet, lineOpacity, lineGlow, dyn, dynSet, dynHide, gridSet, dispose,
    get gl() { return renderer.getContext(); }, renderer };
}
