// Planet looks (Phase 5b): surface textures, body orientation and the 2D globe renderer.
// Classic script loaded after core.js and before mode3d.js / app.js; declarations only, nothing runs at load.
//
// Textures (js/bodies.js tex/texAlt/rings) are fetched lazily through texReady(): only when the caller says it wants
// one — the normal 2D and 3D modes, once the body is TEX_MIN_PX across on screen. The low-resource mode never asks,
// so it never downloads an image (no CSS or HTML refers to them either; ui.test.js checks both).
// 2D normal mode: a small WebGL 2 canvas off screen draws a lit, textured globe (and Saturn's rings) for the visible
// part of a body's disc, then drawImage() copies it onto the 2D plot. The same GLSL helpers (GLOBE_GLSL) are used by
// the 3D view's materials (js/view3d.js).

const TEX_MIN_PX = 6;   // on-screen radius (px) from which a body gets its texture
const TEX_FADE = 300;   // ms: a texture fades in once loaded
const TEXOPT = { venusRadar: false };
const TEXC = new Map(); // file -> { img, ok, err, t }

// what a body looks like: texture spec or null, colour saturation, limb darkening (untextured planets), rings
function lookOf(key) {
  const b = BODIES[key]; if (!b) return null;
  const tex = key === 'venus' ? (TEXOPT.venusRadar ? b.texAlt : null) : b.tex || null;
  return { tex, sat: tex && tex.sat != null ? tex.sat : 1, limb: !tex && b.parent === 'sun', rings: b.rings || null, glow: b.glow ? [...linC(b.glow[0]), b.glow[1]] : [0, 0, 0, 0] };
}
// the image for file once loaded (else null); want: allowed to start the download now
function texReady(file, want) {
  let e = TEXC.get(file);
  if (!e) {
    if (!want) return null;
    e = { img: new Image(), ok: false, err: false, t: 0 };
    e.img.decoding = 'async';
    e.img.onload = () => { e.ok = true; e.t = performance.now(); };
    e.img.onerror = () => { e.err = true; };
    e.img.src = file;
    TEXC.set(file, e);
  }
  return e.ok ? e : null;
}
const texMix = e => (e ? Math.min(1, (performance.now() - e.t) / TEX_FADE) : 0);

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

// Shared GLSL (GLSL ES 3.00): b is a body-fixed unit vector (z north, x the prime meridian), s the Sun direction in the
// same axes, planet radius 1. Equirectangular lookup with seam-free derivatives (two longitude cuts, the smoother
// wins), saturation, soft terminator, Saturn's ring shadow on the globe and the globe's shadow on the rings.
const GLOBE_GLSL = `
uniform float uRingHas;
vec2 globeUV(vec3 b) {
  float u = atan(b.y, b.x) / 6.2831853 + 0.5, v = 0.5 + asin(clamp(b.z, -1.0, 1.0)) / 3.1415927;
  float u2 = fract(u + 0.5) - 0.5;
  return vec2(fwidth(u) <= fwidth(u2) + 1e-6 ? u : u2, v);
}
vec3 globeTex(sampler2D m, vec3 b, float sat) {
  vec3 c = texture(m, globeUV(b)).rgb;
  return mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, sat);
}
float globeDay(vec3 n, vec3 s) { return smoothstep(-0.06, 0.3, dot(n, s)); }
// night side stays nearly black (the albedo is sRGB: 0.035 linear would still show as a dull 20 % grey)
float globeLit(float day) { return 0.004 + 0.996 * day; }
// thin atmosphere glow at the limb (linear colour + strength in a): strong on the lit side, faint at night
vec3 atmGlow(vec3 n, vec3 s, float mu, vec4 a) {
  float rim = pow(clamp(1.0 - mu, 0.0, 1.0), 3.0), lit = 0.06 + 0.94 * smoothstep(-0.3, 0.5, dot(n, s));
  return a.rgb * a.a * rim * lit * 1.6;
}
// ring colour and opacity at radial coordinate x (0..1): the texture, or a flat colour until it has loaded
vec4 ringSample(sampler2D rm, float x) { return uRingHas > 0.5 ? texture(rm, vec2(x, 0.5)) : vec4(0.52, 0.42, 0.29, 0.7); }
// untextured planets: Lambert fall-off towards the terminator and limb darkening (mu: cosine of the view angle)
float plainShade(vec3 n, vec3 s, float mu) { return (0.4 + 0.6 * clamp(dot(n, s), 0.0, 1.0)) * (0.25 + 0.75 * pow(max(mu, 0.0), 0.6)); }
float ringShadow(sampler2D rm, vec2 rr, vec3 p, vec3 s) {
  if (abs(s.z) < 1e-5) return 1.0;
  float t = -p.z / s.z; if (t <= 0.0) return 1.0;
  float r = length(p.xy + t * s.xy); if (r < rr.x || r > rr.y) return 1.0;
  return 1.0 - 0.85 * ringSample(rm, (r - rr.x) / (rr.y - rr.x)).a;
}
float sphereShadow(vec3 p, vec3 s) {
  float b = dot(p, s), c = dot(p, p) - 1.0, d = b * b - c;
  return d > 0.0 && -b - sqrt(d) > 0.0 ? 0.06 : 1.0;
}
float ringLight(vec3 s) { return 0.15 + 0.85 * sqrt(abs(s.z)); }
`;

// ---------- 2D globe renderer (normal 2D mode) ----------
const GLB = { cv: null, gl: null, u: null, tex: new Map(), white: null, fail: false };
const GLOBE_VS = `#version 300 es
in vec2 aP; uniform vec4 uRect; out vec2 vP;
void main() { vP = vec2(uRect.x + aP.x * uRect.z, uRect.y + aP.y * uRect.w); gl_Position = vec4(aP * 2.0 - 1.0, 0.0, 1.0); }`;
// screen axes: x right, y up, z towards the viewer; uRot: body -> screen; output premultiplied sRGB
const GLOBE_FS = `#version 300 es
precision highp float;
in vec2 vP; out vec4 oC;
uniform mat3 uRot; uniform vec3 uSun, uColor; uniform float uTex, uSat, uLimb, uMix, uPx, uRing;
uniform sampler2D uMap, uRingMap; uniform vec2 uRingR; uniform vec4 uGlow;
${GLOBE_GLSL}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 p = vP; float d2 = dot(p, p), d = sqrt(d2);
  mat3 Rt = transpose(uRot); vec3 sO = Rt * uSun;
  vec4 col = vec4(0.0); float zs = -2.0;
  if (d < 1.0 + 1.5 / uPx) {
    vec3 n = vec3(p, sqrt(max(0.0, 1.0 - d2))), b = Rt * n; zs = n.z;
    float day = globeDay(b, sO);
    if (uRing > 0.5) day *= ringShadow(uRingMap, uRingR, b, sO);
    vec3 base = uTex > 0.5 ? mix(uColor, globeTex(uMap, b, uSat), uMix) : uColor;
    vec3 c = toSRGB(base * globeLit(day) * (uLimb > 0.5 ? plainShade(b, sO, n.z) : 1.0) + atmGlow(b, sO, n.z, uGlow));
    float cov = clamp((1.0 - d) * uPx + 0.5, 0.0, 1.0);
    col = vec4(c * cov, cov);
  }
  if (uRing > 0.5) {
    vec3 rn = uRot[2];
    if (abs(rn.z) > 1e-4) {
      float z = -(p.x * rn.x + p.y * rn.y) / rn.z;
      vec3 qb = Rt * vec3(p, z); float r = length(qb.xy);
      if (r >= uRingR.x && r <= uRingR.y && (d2 >= 1.0 || z > zs)) {
        vec4 rc = ringSample(uRingMap, (r - uRingR.x) / (uRingR.y - uRingR.x));
        vec3 c = toSRGB(rc.rgb * ringLight(sO) * sphereShadow(qb, sO));
        col = vec4(c * rc.a, rc.a) + col * (1.0 - rc.a);
      }
    }
  }
  oC = col;
}`;
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
    const u = {}; for (const n of ['uRect', 'uRot', 'uSun', 'uColor', 'uTex', 'uSat', 'uLimb', 'uMix', 'uPx', 'uRing', 'uMap', 'uRingMap', 'uRingR', 'uRingHas', 'uGlow']) u[n] = gl.getUniformLocation(pr, n);
    gl.uniform1i(u.uMap, 0); gl.uniform1i(u.uRingMap, 1);
    GLB.white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, GLB.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    cv.addEventListener('webglcontextlost', e => { e.preventDefault(); GLB.tex.clear(); GLB.gl = null; GLB.fail = true; });
    Object.assign(GLB, { cv, gl, u });
    return true;
  } catch (e) { GLB.fail = true; return false; }
}
function globeTexture(img, repeat) {
  let t = GLB.tex.get(img); if (t) return t;
  const gl = GLB.gl; t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  GLB.tex.set(img, t); return t;
}
const linC = h => { const n = parseInt(h.slice(1), 16), f = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return [f(n >> 16 & 255), f(n >> 8 & 255), f(n & 255)]; };
// Draw a globe of radius r px centred at (x, y) onto ctx (W×H css px, pixel ratio dpr). o: rot (body -> screen,
// row-major), sun (screen axes, unit), color (hex), tex (image entry or null), sat, limb, ring ({ e: image entry,
// r: [inner, outer] in body radii } or null). Only the part of the disc (and rings) inside the canvas is rendered.
// Returns false when it cannot draw (no WebGL 2): the caller draws its plain disc instead.
function drawGlobe(ctx, x, y, r, W, H, dpr, o) {
  if (!globeInit()) return false;
  const gl = GLB.gl, u = GLB.u, ext = r * (o.ring ? o.ring.r[1] : 1) + 1;
  const X0 = Math.max(0, Math.floor(x - ext)), X1 = Math.min(W, Math.ceil(x + ext)), Y0 = Math.max(0, Math.floor(y - ext)), Y1 = Math.min(H, Math.ceil(y + ext));
  if (X1 <= X0 || Y1 <= Y0) return true;
  const w = X1 - X0, h = Y1 - Y0, wd = Math.ceil(w * dpr), hd = Math.ceil(h * dpr);
  if (GLB.cv.width < wd || GLB.cv.height < hd) { GLB.cv.width = Math.max(GLB.cv.width, wd); GLB.cv.height = Math.max(GLB.cv.height, hd); }
  gl.viewport(0, 0, wd, hd);
  gl.uniform4f(u.uRect, (X0 - x) / r, (y - Y1) / r, w / r, h / r);
  const R = o.rot; // GLSL mat3 is column-major: upload the transpose of the row-major matrix
  gl.uniformMatrix3fv(u.uRot, true, R);
  gl.uniform3f(u.uSun, o.sun[0], o.sun[1], o.sun[2]);
  gl.uniform3fv(u.uColor, linC(o.color));
  gl.uniform1f(u.uPx, r * dpr); gl.uniform1f(u.uSat, o.sat); gl.uniform1f(u.uLimb, o.limb ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, o.tex ? globeTexture(o.tex.img, true) : GLB.white);
  gl.uniform1f(u.uTex, o.tex ? 1 : 0); gl.uniform1f(u.uMix, texMix(o.tex));
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, o.ring && o.ring.e ? globeTexture(o.ring.e.img, false) : GLB.white);
  gl.uniform1f(u.uRing, o.ring ? 1 : 0); if (o.ring) { gl.uniform2f(u.uRingR, o.ring.r[0], o.ring.r[1]); gl.uniform1f(u.uRingHas, o.ring.e ? 1 : 0); }
  gl.uniform4fv(u.uGlow, o.glow || [0, 0, 0, 0]);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  ctx.drawImage(GLB.cv, 0, GLB.cv.height - hd, wd, hd, X0, Y0, w, h);
  return true;
}
// the look of body key drawn r px across: allow = the mode draws globes (Q.tex), fetch = new downloads allowed (not
// after the adaptive quality drop); null when a plain disc will do (low-resource mode, too small, nothing loaded yet
// and no plain globe to draw)
function globeLook(key, r, allow, fetch) {
  const L = lookOf(key); if (!L) return null;
  const want = allow && r >= TEX_MIN_PX;
  const tex = L.tex ? texReady(L.tex.file, want && fetch) : null;
  const ring = L.rings ? texReady(L.rings.file, want && fetch) : null;
  if (!want || (!tex && !L.limb && !L.rings)) return null;
  return { tex, sat: L.sat, limb: L.limb, ring: L.rings ? { e: ring, r: L.rings.r.map(q => q * L.rings.req / BODIES[key].radius) } : null, glow: L.glow };
}
