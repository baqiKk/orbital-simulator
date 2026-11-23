const TEX_MIN_PX=6,TEX_FADE=300,EVICT_MS=3e4,BIG_MAX=2,RELIEF_PX=40,SHADOW_PX=140,TEXOPT={venusRadar:!1,clouds:!0,keepBase:!0},TEXC=new Map,TEX_DROP=[];function lookOf(e){const t=BODIES[e];if(!t)return null;const n=e==="venus"?TEXOPT.venusRadar?t.texAlt:null:t.tex||null;return{b:t,tex:n,sat:n&&n.sat!=null?n.sat:1,limb:!n&&t.parent==="sun",rings:t.rings||null,glow:t.glow?[...linC(t.glow[0]),t.glow[1]]:[0,0,0,0]}}function texReady(e,t){let n=TEXC.get(e);if(!n){if(!t)return null;n={img:new Image,ok:!1,err:!1,t:0,used:0},n.img.decoding="async",n.img.onload=()=>{n.ok=!0,n.t=performance.now()},n.img.onerror=()=>{n.err=!0},n.img.src=e,TEXC.set(e,n)}return n.used=performance.now(),n.ok?n:null}const texMix=e=>e?Math.min(1,(performance.now()-e.t)/300):0,tiersOf=e=>[[e.w||1024,e.file],...e.hi||[]];function texTier(e,t,n,r){const l=2*Math.PI*t*.75;let u=0;for(;u+1<e.length&&e[u+1]<=n&&e[u]<l;)u++;return r!=null&&r>u&&r<e.length&&e[r]<=n&&e[u]<l*1.25&&(u=r),u}const TIER=new Map,BIG=new Map;function tierTex(e,t,n,r,l){const u=tiersOf(e),s=performance.now();let i=TIER.get(e);i||TIER.set(e,i={want:0,shown:-1,prev:-1,t:0});let a=texTier(u.map(d=>d[0]),t,n,i.want);if(u[a][0]>2048){let d=0;for(const[h,v]of BIG)h!==l&&s-v<2e3&&d++;d>=2?a=Math.max(0,u.findIndex(h=>h[0]>2048)-1):BIG.set(l,s)}i.want=a;let o=-1,f=null;for(let d=0;d<=a;d++){const h=texReady(u[d][1],r&&(d===0||d===a));h&&(o=d,f=h)}if(o<0)return null;o!==i.shown&&(i.prev=i.shown,i.shown=o,i.t=s);const c=Math.min(1,(s-i.t)/300),m=i.prev>=0&&c<1?TEXC.get(u[i.prev][1]):null;return m&&(m.used=s),{e:f,old:m&&m.ok?m:null,mix:m?1-c:0}}let evictT=0;function texEvict(){const e=performance.now();if(e-evictT<5e3)return;evictT=e;const t=new Set;for(const n of Object.values(BODIES))for(const r of[n.tex,n.texAlt,n.relief,n.clouds,n.night,n.ocean])r&&t.add(r.file);for(const[n,r]of TEXC)if((!t.has(n)||!TEXOPT.keepBase)&&r.ok&&e-r.used>3e4&&/img\/planets\//.test(n)){TEXC.delete(n);for(const l of TEX_DROP)l(r.img)}}const LOCK_EL={};function bodyAxes(e,t,n,r,l,u,s){const i=BODIES[e];if(i&&i.pole)return bodyFrame(i.pole,t,s);if(i&&i.lock&&(u>=0||i.orb)){let a,o;if(u>=0)a=[n[3*l]-n[3*u],n[3*l+1]-n[3*u+1],n[3*l+2]-n[3*u+2]],o=[r[3*l]-r[3*u],r[3*l+1]-r[3*u+1],r[3*l+2]-r[3*u+2]];else{const h=new Array(6);orbitState(LOCK_EL[e]||(LOCK_EL[e]=orbitElements(i.orb)),t,h,0),a=h.slice(0,3),o=h.slice(3)}const f=Math.hypot(...a);let c=a.map(h=>-h/f),m;if(i.axis){const h=equatorFrame(i.axis,t,4),v=c[0]*h[2]+c[1]*h[5]+c[2]*h[8];m=[h[2],h[5],h[8]],c=c.map((b,g)=>b-v*m[g]);const p=Math.hypot(...c);c=c.map(b=>b/p)}else{m=[a[1]*o[2]-a[2]*o[1],a[2]*o[0]-a[0]*o[2],a[0]*o[1]-a[1]*o[0]];const h=Math.hypot(...m);m=m.map(v=>v/h)}const d=[m[1]*c[2]-m[2]*c[1],m[2]*c[0]-m[0]*c[2],m[0]*c[1]-m[1]*c[0]];for(let h=0;h<3;h++)s[3*h]=c[h],s[3*h+1]=d[h],s[3*h+2]=m[h];return s}return s[0]=1,s[1]=0,s[2]=0,s[3]=0,s[4]=1,s[5]=0,s[6]=0,s[7]=0,s[8]=1,s}function axesIn(e,t,n,r,l){for(let u=0;u<3;u++)l[u]=e[0]*r[u]+e[1]*r[3+u]+e[2]*r[6+u],l[3+u]=t[0]*r[u]+t[1]*r[3+u]+t[2]*r[6+u],l[6+u]=n[0]*r[u]+n[1]*r[3+u]+n[2]*r[6+u];return l}const TONEMAP_GLSL=`
vec3 toneMap(vec3 c) {
  float peak = max(c.r, max(c.g, c.b));
  if (peak < 0.76) return c;
  float np = 1.0 - 0.0576 / (peak + 0.24 - 0.76);
  c *= np / peak;
  return mix(c, vec3(np), 1.0 - 1.0 / (0.15 * (peak - np) + 1.0));
}`,GLOBE_GLSL=`
uniform vec3 uColor;
uniform vec4 uGlow;
uniform float uTex, uMix, uMix2, uSat, uLimb, uRing, uRingHas, uTauHas, uPhot, uEmit, uCloudRot;
uniform sampler2D uMap, uMap2, uRingMap, uTau, uClouds, uNight, uOcean, uRelief;
uniform vec2 uRingR;
uniform vec4 uLayers;   // clouds, city lights (their strength 0 … 1), glint, relief (1 = on)
uniform float uNightLo; // the night side's faint light seen close (0 … 1: as the city lights fade out; nightLow)
const float NIGHT_LO = 0.05;
uniform vec4 uRelief4;  // lowest and highest height (body radii), cast shadows (1 = on), the Sun's angular radius (rad)
uniform vec4 uHaze;     // on, scale height, vertical optical depth, top (body radii)
uniform vec4 uHazeC;    // haze colour (linear), Henyey–Greenstein g
uniform vec3 uHazeL;    // detached layer: altitude, width (body radii), density relative to the base
uniform vec4 uVoid;     // a mosaic's data-less cap: fill tone (linear), on
uniform vec2 uVoidZ;    // the latitude band (sine) it lies in
vec2 globeUV(vec3 b) {
  float u = atan(b.y, b.x) / 6.2831853 + 0.5, v = 0.5 + asin(clamp(b.z, -1.0, 1.0)) / 3.1415927;
  float u2 = fract(u + 0.5) - 0.5;
  return vec2(fwidth(u) <= fwidth(u2) + 1e-6 ? u : u2, v);
}
vec2 dirUV(vec3 b) { return vec2(atan(b.y, b.x) / 6.2831853 + 0.5, 0.5 + asin(clamp(b.z, -1.0, 1.0)) / 3.1415927); }
// a mosaic's black, data-less cap (Ceres' south pole, Vesta's north) filled with the body's mean tone: black pixels in the
// band, and over the gap's edge the map fades into the tone (where its 256-wide mip level, ~1.4° a texel, is dark)
vec3 voidFill(sampler2D m, vec3 t, vec2 uv, float z) {
  float band = smoothstep(uVoidZ.x - 0.04, uVoidZ.x, z) * (1.0 - smoothstep(uVoidZ.y, uVoidZ.y + 0.04, z));
  if (band <= 0.0) return t;
  float g = dot(textureLod(m, uv, log2(float(textureSize(m, 0).x) / 256.0)).rgb, vec3(1.0 / 3.0)) / max(uVoid.g, 1e-3);
  float w = max(1.0 - smoothstep(0.006, 0.04, dot(t, vec3(1.0 / 3.0))), 1.0 - smoothstep(0.08, 0.4, g));
  return mix(t, uVoid.rgb, band * w);
}
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
  // in the planet's shadow (2026-11-21, Phase 20A-5) only the ring itself darkens: its sparse parts (gaps, the dust out to
  // the F ring), seen at a grazing angle, would otherwise cover the sky behind as a hard dark wedge, where in sunlight
  // their own glow hides it
  float a = 1.0 - exp(-tau / mu);
  if (sh < 1.0) a *= mix(smoothstep(0.05, 0.4, tau), 1.0, sh);
  return vec4(L * sh, a);
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
    if (uVoid.a > 0.5) t = voidFill(uMap, t, uv, n.z);
    if (uMix2 > 0.0) {
      vec3 t2 = satur(texture(uMap2, uv).rgb, uSat);
      t = mix(t, uVoid.a > 0.5 ? voidFill(uMap2, t2, uv, n.z) : t2, uMix2);
    }
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
  if (uNightLo > 0.0) col += mix(base, vec3(0.85), ca) * uNightLo * NIGHT_LO * (1.0 - smoothstep(-0.12, 0.02, mu0));
  if (uLayers.y > 0.001) col += texture(uNight, uv).rgb * vec3(1.0, 0.78, 0.5) * 0.6 * uLayers.y * (1.0 - smoothstep(-0.12, 0.02, mu0)) * (1.0 - ca);
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
`,GLB={cv:null,gl:null,u:null,tex:new Map,white:null,fail:!1},GLOBE_VS=`#version 300 es
in vec2 aP; uniform vec4 uRect; out vec2 vP;
void main() { vP = vec2(uRect.x + aP.x * uRect.z, uRect.y + aP.y * uRect.w); gl_Position = vec4(aP * 2.0 - 1.0, 0.0, 1.0); }`,GLOBE_FS=`#version 300 es
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
}`,GLB_UNI=["uRect","uRot","uSun","uColor","uTex","uSat","uLimb","uMix","uMix2","uPx","uRing","uRingR","uRingHas","uTauHas","uGlow","uPhot","uEmit","uCloudRot","uLayers","uNightLo","uRelief4","uHaze","uHazeC","uHazeL","uVoid","uVoidZ"],GLB_SAMP=["uMap","uMap2","uRingMap","uTau","uClouds","uNight","uOcean","uRelief"];function globeInit(){if(GLB.gl||GLB.fail)return!!GLB.gl;try{const e=document.createElement("canvas"),t=e.getContext("webgl2",{premultipliedAlpha:!0,antialias:!1,depth:!1,stencil:!1});if(!t)throw new Error("no webgl2");const n=(i,a)=>{const o=t.createShader(i);if(t.shaderSource(o,a),t.compileShader(o),!t.getShaderParameter(o,t.COMPILE_STATUS))throw new Error(t.getShaderInfoLog(o));return o},r=t.createProgram();if(t.attachShader(r,n(t.VERTEX_SHADER,GLOBE_VS)),t.attachShader(r,n(t.FRAGMENT_SHADER,GLOBE_FS)),t.linkProgram(r),!t.getProgramParameter(r,t.LINK_STATUS))throw new Error(t.getProgramInfoLog(r));t.useProgram(r);const l=t.createBuffer();t.bindBuffer(t.ARRAY_BUFFER,l),t.bufferData(t.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),t.STATIC_DRAW);const u=t.getAttribLocation(r,"aP");t.enableVertexAttribArray(u),t.vertexAttribPointer(u,2,t.FLOAT,!1,0,0);const s={};for(const i of[...GLB_UNI,...GLB_SAMP])s[i]=t.getUniformLocation(r,i);return GLB_SAMP.forEach((i,a)=>t.uniform1i(s[i],a)),GLB.white=t.createTexture(),t.bindTexture(t.TEXTURE_2D,GLB.white),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,new Uint8Array([255,255,255,255])),e.addEventListener("webglcontextlost",i=>{i.preventDefault(),GLB.tex.clear(),GLB.gl=null,GLB.fail=!0}),Object.assign(GLB,{cv:e,gl:t,u:s}),TEX_DROP.push(i=>{const a=GLB.tex.get(i);a&&GLB.gl&&GLB.gl.deleteTexture(a),GLB.tex.delete(i)}),!0}catch{return GLB.fail=!0,!1}}function globeTexture(e,t,n){let r=GLB.tex.get(e);if(r)return r;const l=GLB.gl;return r=l.createTexture(),l.bindTexture(l.TEXTURE_2D,r),l.pixelStorei(l.UNPACK_FLIP_Y_WEBGL,!0),l.texImage2D(l.TEXTURE_2D,0,n?l.RGBA8:l.SRGB8_ALPHA8,l.RGBA,l.UNSIGNED_BYTE,e),l.generateMipmap(l.TEXTURE_2D),l.texParameteri(l.TEXTURE_2D,l.TEXTURE_MIN_FILTER,l.LINEAR_MIPMAP_LINEAR),l.texParameteri(l.TEXTURE_2D,l.TEXTURE_WRAP_S,t?l.REPEAT:l.CLAMP_TO_EDGE),l.texParameteri(l.TEXTURE_2D,l.TEXTURE_WRAP_T,l.CLAMP_TO_EDGE),GLB.tex.set(e,r),r}const linC=e=>{const t=parseInt(e.slice(1),16),n=r=>(r/=255,r<=.04045?r/12.92:Math.pow((r+.055)/1.055,2.4));return[n(t>>16&255),n(t>>8&255),n(t&255)]};function lookUniforms(e){return{nightLo:e&&e.nightLo?e.nightLo:0,layers:[e&&e.clouds?1:0,e&&e.night?e.nightK==null?1:e.nightK:0,e&&e.ocean?1:0,e&&e.relief?1:0],relief:e&&e.relief?[e.relief.h[0],e.relief.h[1],e.shadow?1:0,e.sunAng]:[0,0,0,.0047],haze:e&&e.haze?[1,e.haze.H,e.haze.tau,e.haze.top]:[0,1,0,0],hazeC:e&&e.haze?[...e.haze.col,e.haze.g]:[0,0,0,0],hazeL:e&&e.haze&&e.haze.layer?e.haze.layer:[0,1,0],cloudRot:e&&e.clouds?e.cloudRot:0,phot:e&&e.phot?1:0,void:e&&e.nodata?[...linC(e.nodata.tone),1]:[0,0,0,0],voidZ:e&&e.nodata?e.nodata.lat.map(t=>Math.sin(t*Math.PI/180)):[0,0]}}function drawGlobe(e,t,n,r,l,u,s,i){if(!globeInit())return!1;const a=GLB.gl,o=GLB.u,f=i.look,c=f.ring,m=r*Math.max(c?c.r[1]:1,f.haze?1+f.haze.top:1)+1,d=Math.max(0,Math.floor(t-m)),h=Math.min(l,Math.ceil(t+m)),v=Math.max(0,Math.floor(n-m)),p=Math.min(u,Math.ceil(n+m));if(h<=d||p<=v)return!0;const b=h-d,g=p-v,z=Math.ceil(b*s),y=Math.ceil(g*s);(GLB.cv.width<z||GLB.cv.height<y)&&(GLB.cv.width=Math.max(GLB.cv.width,z),GLB.cv.height=Math.max(GLB.cv.height,y)),a.viewport(0,0,z,y),a.uniform4f(o.uRect,(d-t)/r,(n-p)/r,b/r,g/r),a.uniformMatrix3fv(o.uRot,!0,i.rot),a.uniform3f(o.uSun,i.sun[0],i.sun[1],i.sun[2]),a.uniform3fv(o.uColor,linC(i.color)),a.uniform1f(o.uPx,r*s),a.uniform1f(o.uSat,f.sat),a.uniform1f(o.uLimb,f.limb?1:0),a.uniform1f(o.uEmit,0);const R=(M,E,T,S)=>{a.activeTexture(a.TEXTURE0+M),a.bindTexture(a.TEXTURE_2D,E?globeTexture(E,T,S):GLB.white)},x=f.tex;R(0,x&&x.e.img,!0,!1),R(1,x&&x.old&&x.old.img,!0,!1),a.uniform1f(o.uTex,x?1:0),a.uniform1f(o.uMix,x?texMix(x.base):0),a.uniform1f(o.uMix2,x&&x.old?x.mix:0),R(2,c&&c.e&&c.e.img,!1,!1),R(3,c&&c.tau&&c.tau.img,!1,!0),a.uniform1f(o.uRing,c?1:0),c&&(a.uniform2f(o.uRingR,c.r[0],c.r[1]),a.uniform1f(o.uRingHas,c.e?1:0),a.uniform1f(o.uTauHas,c.tau?1:0)),R(4,f.clouds&&f.clouds.img,!0,!0),R(5,f.night&&f.night.img,!0,!1),R(6,f.ocean&&f.ocean.img,!0,!0),R(7,f.relief&&f.relief.e.img,!0,!0);const w=lookUniforms(f);return a.uniform4fv(o.uLayers,w.layers),a.uniform1f(o.uNightLo,w.nightLo),a.uniform4fv(o.uRelief4,w.relief),a.uniform4fv(o.uHaze,w.haze),a.uniform4fv(o.uHazeC,w.hazeC),a.uniform3fv(o.uHazeL,w.hazeL),a.uniform1f(o.uCloudRot,w.cloudRot),a.uniform1f(o.uPhot,w.phot),a.uniform4fv(o.uVoid,w.void),a.uniform2fv(o.uVoidZ,w.voidZ),a.uniform4fv(o.uGlow,f.glow||[0,0,0,0]),a.clearColor(0,0,0,0),a.clear(a.COLOR_BUFFER_BIT),a.drawArrays(a.TRIANGLE_STRIP,0,4),e.drawImage(GLB.cv,0,GLB.cv.height-y,z,y,d,v,b,g),!0}function sunAngOf(e){let t=BODIES[e];for(;t&&t.parent&&t.parent!=="sun";)t=BODIES[t.parent];return .004652/(t&&t.orb?t.orb.jpl?t.orb.jpl[0][0]:t.orb.sb?t.orb.sb[1]:1:1)}function nightFade(e,t){const n=t&&t.img&&(t.img.naturalWidth||t.img.width)||0;if(!n)return 1;const r=2*Math.PI*e/n;return Math.max(0,Math.min(1,(5-r)/3))}function nightLow(e,t){return 1-(t?nightFade(e,t):Math.max(0,Math.min(1,(5-2*Math.PI*e/4096)/3)))}function globeLook(e,t,n,r,l,u,s){const i=lookOf(e);if(!i)return null;const a=n&&t>=6,o=i.b;a&&texEvict();const f=i.tex&&a?tierTex(i.tex,t,l||1024,r,e):null;if(f){const g=TEXC.get(tiersOf(i.tex)[0][1]);f.base=g&&g.ok?g:f.e}const c=i.rings?texReady(i.rings.file,a&&r):null,m=i.rings&&i.rings.tau?texReady(i.rings.tau.file,a&&r):null,d=(g,z)=>g&&z&&a?tierTex(g,t,l||1024,r,e):null,h=d(o.relief,u&&u.relief&&t>=40),v=d(o.clouds,u&&u.clouds&&TEXOPT.clouds),p=d(o.night,!0),b=d(o.ocean,u&&u.glint);return!a||!f&&!i.limb&&!i.rings&&!o.haze?null:{tex:f,sat:i.sat,limb:i.limb,nodata:f&&i.tex.nodata,glow:o.haze?[0,0,0,0]:i.glow,phot:o.phot==="lambert",ring:i.rings?{e:c,tau:m,r:i.rings.r.map(g=>g*i.rings.req/o.radius)}:null,relief:h?{e:h.e,h:o.relief.h.map(g=>g/1e3/o.radius)}:null,shadow:!!h&&t>=140,sunAng:sunAngOf(e),clouds:v&&v.e,cloudRot:(s||0)/(20*86400)%1,night:p&&p.e,ocean:b&&b.e,nightK:nightFade(t,p&&p.e),nightLo:o.night?nightLow(t,p&&p.e):0,haze:o.haze&&!(e==="venus"&&TEXOPT.venusRadar)?{H:o.haze.H/o.radius,tau:o.haze.tau,top:o.haze.top/o.radius,g:o.haze.g,col:linC(o.color),layer:o.haze.layer?[o.haze.layer[0]/o.radius,o.haze.layer[1]/o.radius,o.haze.layer[2]]:null}:null}}const SKYC={stars:null,req:!1},OBLIQ=23.4392911*Math.PI/180;function skyReady(e,t){const n=tiersOf(SKY.milky);let r=null;return n.forEach(([,l],u)=>{const s=texReady(l,e&&(u===0||!!t&&u===n.length-1));s&&(r=s)}),e&&!SKYC.req&&(SKYC.req=!0,fetch(SKY.stars.file).then(l=>l.ok?l.arrayBuffer():null).then(l=>{l&&(SKYC.stars=starsFrom(new DataView(l)))}).catch(()=>{})),r&&SKYC.stars?{milky:r,stars:SKYC.stars}:null}function starsFrom(e){const t=e.byteLength/8,n=new Float32Array(3*t),r=new Float32Array(t),l=new Float32Array(3*t),u=Math.cos(OBLIQ),s=Math.sin(OBLIQ);for(let i=0;i<t;i++){const a=e.getUint16(8*i,!0)/65536*2*Math.PI,o=e.getInt16(8*i+2,!0)/32767*Math.PI/2,f=e.getInt16(8*i+6,!0),c=Math.cos(o)*Math.cos(a),m=Math.cos(o)*Math.sin(a),d=Math.sin(o);n[3*i]=c,n[3*i+1]=u*m+s*d,n[3*i+2]=-s*m+u*d,r[i]=e.getInt16(8*i+4,!0)/100,l.set(f===-32768?[1,1,1]:starRGB(f/1e3),3*i)}return{n:t,dir:n,mag:r,col:l}}function starRGB(e){const t=4600*(1/(.92*e+1.7)+1/(.92*e+.62)),n=(a,o,f,c)=>{const m=(a-o)/(a<o?f:c);return Math.exp(-.5*m*m)};let r=0,l=0,u=0;for(let a=380;a<=780;a+=5){const o=1/(Math.pow(a*1e-9,5)*(Math.exp(.014388/(a*1e-9*t))-1));r+=o*(1.056*n(a,599.8,37.9,31)+.362*n(a,442,16,26.7)-.065*n(a,501.1,20.4,26.2)),l+=o*(.821*n(a,568.8,46.9,40.5)+.286*n(a,530.9,16.3,31.1)),u+=o*(1.217*n(a,437,11.8,36)+.681*n(a,459,26,13.8))}const s=[3.2406*r-1.5372*l-.4986*u,-.9689*r+1.8758*l+.0415*u,.0557*r-.204*l+1.057*u].map(a=>Math.max(a,0)),i=Math.max(...s)||1;return s.map(a=>a/i)}const STAR_M0=1,SKY_GAIN=.5,SKY_LOD=0,skyHiNeed=e=>e>1.3*tiersOf(SKY.milky)[0][0]/360,starPeak=e=>Math.pow(10,-.4*(e-STAR_M0)),GLARE_GLSL="float glareI(float r) { return exp(-r * r / 0.3) + 0.3 / pow(1.0 + r * r / 1.96, 1.5) + 0.06 / (1.0 + r * r / 36.0); }",glareI=e=>Math.exp(-e*e/.3)+.3/Math.pow(1+e*e/1.96,1.5)+.06/(1+e*e/36),glareL=e=>3*Math.max(e,1.5)+12,GLARE_EXT=20;let GLARE_CV=null;function glareSprite(){if(GLARE_CV)return GLARE_CV;const e=512,t=document.createElement("canvas");t.width=t.height=e;const n=t.getContext("2d"),r=n.createImageData(e,e),l=[255,243,214];for(let u=0;u<e;u++)for(let s=0;s<e;s++){const i=Math.hypot(s+.5-e/2,u+.5-e/2)/(e/2)*GLARE_EXT,a=Math.min(1,glareI(i)*(1-Math.min(1,i/GLARE_EXT)**4)),o=4*(u*e+s);r.data[o]=l[0],r.data[o+1]=l[1],r.data[o+2]=l[2],r.data[o+3]=Math.round(255*a)}return n.putImageData(r,0,0),GLARE_CV=t}
