import*as o from"three";import{LineSegments2 as ot}from"three/addons/lines/LineSegments2.js";import{LineGeometry as nt}from"three/addons/lines/LineGeometry.js";import{LineMaterial as Et}from"three/addons/lines/LineMaterial.js";const N=.001;export const FOV=45;const jt=256,Nt=1e5;export const BODY_VS=`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vO;
void main() {
  vO = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`,BODY_FS=`
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
}`,RING_VS=`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vR;
void main() {
  vR = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`,RING_FS=`
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
}`,HAZE_VS=`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vO;
void main() {
  vO = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`,HAZE_FS=`
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
}`;const Ut=`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vD;
void main() {
  vD = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`,Wt=`
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
}`,Ht=`
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
}`,Yt=`
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vC;
varying float vS;
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = (gl_PointCoord - 0.5) * (2.0 * ceil(3.0 * vS) + 1.0);
  gl_FragColor = vec4(vC * exp(-dot(d, d) / (2.0 * vS * vS)), 1.0);
  #include <colorspace_fragment>
}`,Xt=`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`,Kt=`
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
}`,Zt=`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`,$t=`
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
}`;export const CRAFT_VS=`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN, vW;
varying vec2 vUv;
varying float vY, vZ, vX;
void main() {
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vUv = uv; vY = position.y; vZ = position.z; vX = position.x;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`,CRAFT_FS=`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor, uSun, uBack;
uniform float uFlat, uTex, uSpec, uClip, uPort, uRod, uCutX;
uniform sampler2D uMap;
varying vec3 vN, vW;
varying vec2 vUv;
varying float vY, vZ, vX;
void main() {
  #include <logdepthbuf_fragment>
  if (vY > uClip) discard; // a liquid's surface (the cutaway's fills)
  if (vX > uCutX) discard; // the cutaway opening (2026-11-21): a plane sweeping in from the camera's side
  if (abs(vZ) < uPort || abs(vZ) > uRod) discard; // a solid grain's bore, a rod's outside
  vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  float d = dot(n, uSun), l = 0.3 + 0.7 * max(d, 0.0);
  vec3 base = uColor * (uTex > 0.5 && gl_FrontFacing ? texture2D(uMap, vUv).rgb : vec3(1.0));
  vec3 V = normalize(cameraPosition - vW), H = normalize(uSun + V);
  float sp = gl_FrontFacing && d > 0.0 ? uSpec * pow(max(dot(n, H), 0.0), 28.0) : 0.0;
  vec3 c = uFlat > 0.5 ? uColor * 0.92 : gl_FrontFacing ? base * l + sp : uBack * 0.38;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;const Q=(n,g,u)=>{const l=R=>parseInt(R.slice(1),16),y=l(n),d=l(g),v=R=>Math.round((y>>R&255)*(1-u)+(d>>R&255)*u);return"#"+((1<<24)+(v(16)<<16)+(v(8)<<8)+v(0)).toString(16).slice(1)},F=(n,g)=>{const u=parseInt(n.slice(1),16);return`rgba(${u>>16&255},${u>>8&255},${u&255},${g})`};function Le(n){let g=n>>>0;return()=>{g=g+1831565813>>>0;let u=Math.imul(g^g>>>15,1|g);return u^=u+Math.imul(u^u>>>7,61|u),((u^u>>>14)>>>0)/4294967296}}const Qt={foam(n,g,u,l){const y=Le(7);n.fillStyle=Q(l.ink,l.warn,.1),n.fillRect(0,0,g,u);for(let d=0;d<3200;d++)n.fillStyle=y()<.5?F(l.solid,.07+.08*y()):F("#ffffff",.1*y()),n.fillRect(y()*g,y()*u,1+2*y(),1+2*y());for(let d=0;d<6;d++){const v=n.createLinearGradient(0,0,g,0),R=y();v.addColorStop(Math.max(0,R-.1),F(l.solid,0)),v.addColorStop(R,F(l.solid,.06)),v.addColorStop(Math.min(1,R+.1),F(l.solid,0)),n.fillStyle=v,n.fillRect(0,0,g,u)}n.strokeStyle=F(l.faint,.85),n.lineWidth=3;for(const d of[.13,.87])n.beginPath(),n.moveTo(0,u*(1-d)),n.lineTo(g,u*(1-d)),n.stroke();n.strokeStyle=F(l.faint,.6),n.lineWidth=1.5;for(const d of[.37,.62])n.beginPath(),n.moveTo(0,u*(1-d)),n.lineTo(g,u*(1-d)),n.stroke();for(const d of[0,.25,.5,.75])n.beginPath(),n.moveTo(d*g+.5,u*.13),n.lineTo(d*g+.5,u*.87),n.stroke()},quiltA(n,g,u,l){Jt(n,g,u,l,Q(l.dim,l.ink,.5))},alu(n,g,u,l){const y=Le(5),d=Q(l.dim,l.ink,.3);n.fillStyle=d,n.fillRect(0,0,g,u);for(let v=0;v<400;v++)n.fillStyle=F(y()<.5?l.solid:"#ffffff",.04*y()),n.fillRect(0,y()*u,g,1);n.strokeStyle=F(l.faint,.8),n.lineWidth=2;for(const v of[.13,.5,.87])n.beginPath(),n.moveTo(0,u*(1-v)),n.lineTo(g,u*(1-v)),n.stroke()},carbon(n,g,u,l){const y=Q(l.solid,l.faint,.3),d=8;n.fillStyle=y,n.fillRect(0,0,g,u);for(let v=0;v<g/d;v++)for(let R=0;R<u/d;R++){const O=(v+R)%2?n.createLinearGradient(v*d,R*d,v*d+d,R*d):n.createLinearGradient(v*d,R*d,v*d,R*d+d);O.addColorStop(0,F(l.solid,.5)),O.addColorStop(.5,F(l.dim,.22)),O.addColorStop(1,F(l.solid,.5)),n.fillStyle=O,n.fillRect(v*d,R*d,d,d)}n.strokeStyle=F(l.dim,.18),n.lineWidth=1;for(let v=-u;v<g+u;v+=12)n.beginPath(),n.moveTo(v,0),n.lineTo(v+u*.6,u),n.stroke(),n.beginPath(),n.moveTo(v,u),n.lineTo(v+u*.6,0),n.stroke();n.strokeStyle=F(l.dim,.6),n.lineWidth=2;for(const v of[.1,.9])n.beginPath(),n.moveTo(0,u*(1-v)),n.lineTo(g,u*(1-v)),n.stroke()},case(n,g,u,l){const y=n.createLinearGradient(0,0,0,u);y.addColorStop(0,Q(l.dim,l.ink,.45)),y.addColorStop(1,Q(l.dim,l.ink,.25)),n.fillStyle=y,n.fillRect(0,0,g,u),n.fillStyle=F(l.ink,.25),n.fillRect(0,u*.42,g,u*.1),n.strokeStyle=F(l.faint,.9),n.lineWidth=2;for(const d of[.08,.3,.7,.92])n.beginPath(),n.moveTo(0,u*(1-d)),n.lineTo(g,u*(1-d)),n.stroke()},skirt(n,g,u,l){const y=Le(9),d=Q(l.dim,l.ink,.38);n.fillStyle=d,n.fillRect(0,0,g,u);for(let v=0;v<260;v++)n.fillStyle=F(y()<.5?l.solid:"#ffffff",.04*y()),n.fillRect(y()*g,0,1,u);for(let v=0;v<32;v++){const R=(v+.5)/32*g;n.fillStyle=F(l.solid,.32),n.fillRect(R-1,0,2,u),n.fillStyle=F("#ffffff",.16),n.fillRect(R+1,0,1,u)}n.fillStyle=F(l.solid,.4);for(const v of[.08,.5,.92]){n.fillRect(0,u*(1-v)-2,g,4);for(let R=4;R<g;R+=8)n.fillStyle=F("#ffffff",.35),n.fillRect(R,u*(1-v)-5,1.5,1.5),n.fillRect(R,u*(1-v)+4,1.5,1.5),n.fillStyle=F(l.solid,.4)}},deck(n,g,u,l){n.fillStyle=Q(l.solid,l.dim,.6),n.fillRect(0,0,g,u),n.strokeStyle=F(l.solid,.25),n.lineWidth=1;for(let y=0,d=9;y*d*.87<u+d;y++)for(let v=0;v*d<g+d;v++){const R=v*d+y%2*d/2,O=y*d*.87;n.beginPath();for(let V=0;V<6;V++){const U=V*Math.PI/3+Math.PI/6;n.lineTo(R+.55*d*Math.cos(U),O+.55*d*Math.sin(U))}n.closePath(),n.stroke()}n.fillStyle=F(l.ink,.25),n.fillRect(0,u*.42,g,u*.16)},nozLiq(n,g,u,l){const y=U=>u*(1-U),d=l.vt,v=l.ve,R=n.createLinearGradient(0,y(0),0,y(v)),O=U=>Math.max(0,Math.min(1,U/v));R.addColorStop(0,l.dim),R.addColorStop(O(d-.12),Q(l.dim,l.orbit,.35)),R.addColorStop(O(d-.04),Q(l.accent,l.warn,.4)),R.addColorStop(O(d+.03),Q(l.warn,l.burn,.25)),R.addColorStop(O(d+.1),Q(l.orbit,l.bad,.25)),R.addColorStop(O(d+.2),Q(l.orbit,l.dim,.5)),R.addColorStop(1,l.dim),n.fillStyle=R,n.fillRect(0,y(v),g,u*v);for(let U=0;U<g;U+=4)n.fillStyle=F(l.solid,.35),n.fillRect(U,y(v),1,u*v),n.fillStyle=F("#ffffff",.12),n.fillRect(U+2,y(v),1,u*v);const V=n.createLinearGradient(0,y(v),0,0);V.addColorStop(0,Q(l.solid,l.faint,.55)),V.addColorStop(1,Q(l.solid,l.faint,.3)),n.fillStyle=V,n.fillRect(0,0,g,y(v)),n.fillStyle=F(l.dim,.8),n.fillRect(0,y(v)-2,g,3),n.strokeStyle=F(l.faint,.25),n.lineWidth=1;for(let U=v+.08;U<1;U+=.09)n.beginPath(),n.moveTo(0,y(U)),n.lineTo(g,y(U)),n.stroke()},nozAbl(n,g,u,l){const y=O=>u*(1-O),d=n.createLinearGradient(0,y(0),0,y(1)),v=l.vt;d.addColorStop(0,Q(l.solid,l.faint,.45)),d.addColorStop(v,Q(l.faint,l.dim,.35)),d.addColorStop(Math.min(1,v+.15),Q(l.solid,l.faint,.5)),d.addColorStop(1,Q(l.solid,l.faint,.35)),n.fillStyle=d,n.fillRect(0,0,g,u);const R=Le(3);for(let O=.05;O<1;O+=.035+.02*R())n.fillStyle=F(R()<.5?l.solid:l.dim,.18),n.fillRect(0,y(O),g,2)}};function Jt(n,g,u,l,y){const d=Le(13),v=8,R=g/v,O=u/(v*1.6);n.fillStyle=y,n.fillRect(0,0,g,u);for(let V=0;V<v;V++)for(let U=0;U<v*1.6;U++){const re=(V+.5)*R,Me=(U+.5)*O,te=n.createRadialGradient(re,Me,0,re,Me,Math.max(R,O)*.7);te.addColorStop(0,F("#ffffff",.18+.06*d())),te.addColorStop(.7,F("#ffffff",0)),te.addColorStop(1,F(l.solid,.22)),n.fillStyle=te,n.fillRect(V*R,U*O,R,O)}for(let V=0;V<1400;V++)n.fillStyle=F(d()<.5?l.solid:"#ffffff",.06*d()),n.fillRect(d()*g,d()*u,1+2*d(),1);n.strokeStyle=F(l.solid,.35),n.lineWidth=1,n.setLineDash([2,2]);for(let V=0;V<=v;V++)n.beginPath(),n.moveTo(V*R,0),n.lineTo(V*R,u),n.stroke();for(let V=0;V<=v*1.6;V++)n.beginPath(),n.moveTo(0,V*O),n.lineTo(g,V*O),n.stroke();n.setLineDash([]),n.strokeStyle=F(Q(y,"#ffffff",.4),.7),n.lineWidth=3;for(const V of[.12,.88])n.beginPath(),n.moveTo(0,u*(1-V)),n.lineTo(g,u*(1-V)),n.stroke()}const eo="quiltA",it=new Map;function to(n,g){const u=n+"|"+Object.values(g).join(",");let l=it.get(u);if(!l){const y=document.createElement("canvas");y.width=256,y.height=256,Qt[n](y.getContext("2d"),256,256,g),l=new o.CanvasTexture(y),l.colorSpace=o.SRGBColorSpace,l.wrapS=o.RepeatWrapping,l.anisotropy=4,it.set(u,l)}return l}export const PLUME_VS=`
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uLen, uRh0, uRh1;
varying vec3 vL;
void main() {
  float a = -position.y, rh = mix(uRh0, uRh1, a);
  vL = vec3(position.x * rh, position.y * uLen, position.z * rh);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vL, 1.0);
  #include <logdepthbuf_vertex>
}`,PLUME_FS=`
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
}`;o.ShaderChunk.tonemapping_pars_fragment=o.ShaderChunk.tonemapping_pars_fragment.replace("vec3 CustomToneMapping( vec3 color ) { return color; }",TONEMAP_GLSL+`
vec3 CustomToneMapping( vec3 color ) { return toneMap( color * toneMappingExposure ); }`);function oo(n){const g={uSun:new o.Vector3(1,0,0),uCam:new o.Vector3(0,0,5),uColor:new o.Color(1,1,1),uGlow:new o.Vector4,uTex:0,uMix:0,uMix2:0,uSat:1,uLimb:0,uRing:0,uRingHas:0,uTauHas:0,uPhot:0,uEmit:0,uCloudRot:0,uMap:n,uMap2:n,uRingMap:n,uTau:n,uClouds:n,uNight:n,uOcean:n,uRelief:n,uRingR:new o.Vector2(1,2),uLayers:new o.Vector4,uNightLo:0,uRelief4:new o.Vector4,uHaze:new o.Vector4,uHazeC:new o.Vector4,uHazeL:new o.Vector3(0,1,0),uVoid:new o.Vector4,uVoidZ:new o.Vector2,uAx:new o.Vector3(1,1,1)},u={};for(const l in g)u[l]={value:g[l]};return u}export function create(n,g){const u=new o.WebGLRenderer({canvas:n,antialias:g.antialias!==!1,logarithmicDepthBuffer:!0,powerPreference:"high-performance"});u.setClearColor(new o.Color(g.void),1),u.toneMapping=o.CustomToneMapping,u.autoClear=!1;const l=new o.Scene,y=new o.PerspectiveCamera(g.fov||FOV,1,1e-6,1e13),d={sim:new o.Group,map:new o.Group};for(const e of Object.values(d))l.add(e);let v=1,R=1,O=1,V="sim",U=!1;const re=[0,0,0],Me=new Set;n.addEventListener("webglcontextlost",e=>{e.preventDefault(),U=!0}),n.addEventListener("webglcontextrestored",()=>{U=!1});const te=new o.DataTexture(new Uint8Array([255,255,255,255]),1,1);te.needsUpdate=!0;const Te=new Map,at=Math.min(8,u.capabilities.getMaxAnisotropy());function ce(e,r,a){let i=Te.get(e);return i||(i=new o.Texture(e),i.colorSpace=a?o.NoColorSpace:o.SRGBColorSpace,i.anisotropy=at,i.wrapS=r?o.RepeatWrapping:o.ClampToEdgeWrapping,i.needsUpdate=!0,Te.set(e,i),i)}TEX_DROP.push(e=>{const r=Te.get(e);r&&(r.dispose(),Te.delete(e))});const fe=new o.Group;fe.visible=!1,l.add(fe);let pe=null,xe=null;function rt(e){if(!e)return;if(pe){pe.material.uniforms.uMilky.value=ce(e.milky.img,!0,!1);return}pe=new o.Mesh(new o.SphereGeometry(1,48,24),new o.ShaderMaterial({vertexShader:Ut,fragmentShader:Wt,side:o.BackSide,dithering:!0,depthTest:!1,depthWrite:!1,toneMapped:!1,blending:o.AdditiveBlending,uniforms:{uMilky:{value:ce(e.milky.img,!0,!1)},uGain:{value:SKY_GAIN}}})),pe.renderOrder=-11,pe.frustumCulled=!1,fe.add(pe);const r=e.stars,a=new o.BufferGeometry,i=new Float32Array(r.n);for(let t=0;t<r.n;t++)i[t]=starPeak(r.mag[t]);a.setAttribute("position",new o.BufferAttribute(r.dir,3)),a.setAttribute("aPeak",new o.BufferAttribute(i,1)),a.setAttribute("aCol",new o.BufferAttribute(r.col,3)),xe=new o.Points(a,new o.ShaderMaterial({vertexShader:Ht,fragmentShader:Yt,depthTest:!1,depthWrite:!1,toneMapped:!1,blending:o.AdditiveBlending,uniforms:{uDpr:{value:1},uGain:{value:1}}})),xe.renderOrder=-10,xe.frustumCulled=!1,fe.add(xe)}const Ue=new o.Scene,Pe=new o.OrthographicCamera(0,1,1,0,-1,1),Se=new o.Mesh(new o.PlaneGeometry(2,2),new o.ShaderMaterial({vertexShader:Xt,fragmentShader:Kt,depthTest:!1,depthWrite:!1,toneMapped:!1,transparent:!0,blending:o.AdditiveBlending,uniforms:{uColor:{value:new o.Color("#fff3d6")},uI:{value:0},uExt:{value:GLARE_EXT}}}));Se.visible=!1,Se.frustumCulled=!1,Ue.add(Se);const lt=new o.SphereGeometry(1,64,32),st=new o.SphereGeometry(1,48,24),Ge={sim:[],map:[]};function ut(e,r){for(const a of Ge[e]){for(const i of[a.mesh,a.ring,a.haze])i&&(d[e].remove(i),i.material.dispose());a.ring&&a.ring.geometry.dispose()}Ge[e]=r.map(a=>{const i=oo(te);i.uColor.value.set(a.color),i.uEmit.value=a.sun?1:0;const t=new o.Mesh(lt,new o.ShaderMaterial({vertexShader:BODY_VS,fragmentShader:BODY_FS,uniforms:i}));return t.visible=!1,d[e].add(t),{set:e,mesh:t,ring:null,haze:null,hazeTop:0,p:[0,0,0],r:1,ax:[1,1,1],rot:null,sun:new o.Vector3(1,0,0)}})}function ct(e,r){if(e.ring)return e.ring;const a=new o.ShaderMaterial({vertexShader:RING_VS,fragmentShader:RING_FS,transparent:!0,premultipliedAlpha:!0,depthWrite:!1,side:o.DoubleSide,uniforms:e.mesh.material.uniforms});return e.ring=new o.Mesh(new o.RingGeometry(r[0],r[1],256,1),a),e.ring.visible=!1,d[e.set].add(e.ring),e.ring}function ft(e){if(e.haze)return e.haze;const r={...e.mesh.material.uniforms,uInside:{value:0}};return e.haze=new o.Mesh(st,new o.ShaderMaterial({vertexShader:HAZE_VS,fragmentShader:HAZE_FS,transparent:!0,premultipliedAlpha:!0,depthWrite:!1,side:o.DoubleSide,uniforms:r})),e.haze.renderOrder=1,e.haze.visible=!1,d[e.set].add(e.haze),e.haze}const dt=new o.Matrix4;function mt(e,r,a,i,t,c,f){const m=Ge[e][r];if(!m)return;m.p[0]=a[0],m.p[1]=a[1],m.p[2]=a[2],m.r=i,m.mesh.visible=c,t&&m.sun.set(t[0],t[1],t[2]);const p=m.mesh.material.uniforms;if(m.rot=f&&f.rot?f.rot:null,m.rot){const h=m.rot;m.mesh.quaternion.setFromRotationMatrix(dt.set(h[0],h[1],h[2],0,h[3],h[4],h[5],0,h[6],h[7],h[8],0,0,0,0,1))}else m.mesh.quaternion.identity();const _=f&&f.shape?f.shape:[1,1,1];m.ax[0]=_[0],m.ax[1]=_[1],m.ax[2]=_[2],p.uAx.value.set(_[0],_[1],_[2]);const b=f&&f.look,s=b&&b.tex;p.uTex.value=s?1:0,p.uMap.value=s?ce(s.e.img,!0):te,p.uMix.value=s?f.mix:0,p.uMap2.value=s&&s.old?ce(s.old.img,!0):te,p.uMix2.value=s&&s.old?s.mix:0,b&&b.glow?p.uGlow.value.fromArray(b.glow):p.uGlow.value.set(0,0,0,0),p.uSat.value=b?b.sat:1,p.uLimb.value=b&&b.limb?1:0;const z=lookUniforms(b);p.uLayers.value.fromArray(z.layers),p.uNightLo.value=z.nightLo,p.uRelief4.value.fromArray(z.relief),p.uHaze.value.fromArray(z.haze),p.uHazeC.value.fromArray(z.hazeC),p.uHazeL.value.fromArray(z.hazeL),p.uCloudRot.value=z.cloudRot,p.uPhot.value=z.phot,p.uVoid.value.fromArray(z.void),p.uVoidZ.value.fromArray(z.voidZ),p.uClouds.value=b&&b.clouds?ce(b.clouds.img,!0,!0):te,p.uNight.value=b&&b.night?ce(b.night.img,!0):te,p.uOcean.value=b&&b.ocean?ce(b.ocean.img,!0,!0):te,p.uRelief.value=b&&b.relief?ce(b.relief.e.img,!0,!0):te;const Z=b&&b.ring&&c?ct(m,b.ring.r):null;p.uRing.value=Z?1:0,Z&&(p.uRingHas.value=b.ring.e?1:0,p.uRingMap.value=b.ring.e?ce(b.ring.e.img,!1):te,p.uRingR.value.set(b.ring.r[0],b.ring.r[1]),p.uTauHas.value=b.ring.tau?1:0,p.uTau.value=b.ring.tau?ce(b.ring.tau.img,!1,!0):te),m.ring&&(m.ring.visible=!!Z);const L=b&&b.haze&&c?ft(m):null;m.hazeTop=L?b.haze.top:0,m.haze&&(m.haze.visible=!!L)}const se={sim:new Map,map:new Map};function Ve(e,r,a,i){const t=new Et({color:new o.Color(e),linewidth:a,transparent:!0,opacity:r,depthWrite:!1,vertexColors:!!i.vertexColors,toneMapped:!1});return i.additive&&(t.blending=o.AdditiveBlending),t.userData.base=r,t.userData.w=a,t.resolution.set(v,R),Me.add(t),t}const We={sim:{k:1,own:new Set,kOwn:1},map:{k:1,own:new Set,kOwn:1}};function _e(e,r,a){const i=We[e],t=i.own.has(r),c=r==="road"?1:t?i.kOwn:i.k;a.opacity=a.userData.base*c,a.linewidth=a.userData.w*(t?.55+.45*i.kOwn:1),a.visible=c>.004}function vt(e,r,a,i){const t=We[e];if(!(t.k===r&&t.kOwn===i&&t.own===a)){t.k=r,t.own=a,t.kOwn=i;for(const[c,f]of se[e])for(const m of f.mats)_e(e,c,m);for(const[c,f]of he[e])_e(e,c,f.mat)}}function pt(e,r,a,i){const t=!!i.closed,c=t?a+1:a,f=p=>p%a*3;let m=0;for(;m<c-1;){const p=[r[f(m)],r[f(m)+1],r[f(m)+2]];let _=m+1;for(;_<c-1&&_-m<jt-1;_++){const L=f(_),h=f(_+1),P=Math.hypot(r[h]-r[L],r[h+1]-r[L+1],r[h+2]-r[L+2]);if(P>0&&Math.hypot(r[h]-p[0],r[h+1]-p[1],r[h+2]-p[2])>Nt*P)break}const b=_-m+1,s=new Float32Array(3*b);for(let L=0;L<b;L++){const h=f(m+L);s[3*L]=(r[h]-p[0])*N,s[3*L+1]=(r[h+1]-p[1])*N,s[3*L+2]=(r[h+2]-p[2])*N}const z=new nt;if(z.setPositions(s),i.colors){const L=new Float32Array(3*b);for(let h=0;h<b;h++){const P=f(m+h);L[3*h]=i.colors[P],L[3*h+1]=i.colors[P+1],L[3*h+2]=i.colors[P+2]}z.setColors(L)}const Z=L=>{const h=new ot(z,L);return h.position.set(p[0]*N,p[1]*N,p[2]*N),e.dashed&&h.computeLineDistances(),e.group.add(h),h};e.chunks.push({i0:m,i1:_,geo:z,lines:e.mats.map(Z)}),m=_}}function ht(e,r,a,i,t={}){Fe(e,r);const c={group:new o.Group,anchor:[0,0,0],chunks:[],mats:[],show:!0};if(c.mats.push(Ve(t.color||"#ffffff",t.opacity==null?1:t.opacity,t.width||1,{vertexColors:!!t.colors,additive:t.additive})),t.dash>0){const f=c.mats[0];f.dashed=!0,f.dashSize=f.gapSize=t.dash*N,f.dashScale=1,c.dashed=!0}return t.glow&&c.mats.push(Ve(t.color||"#ffffff",t.glow[1],t.glow[0],{additive:!0})),i>=2&&pt(c,a,i,t),d[e].add(c.group),se[e].set(r,c),c}function Fe(e,r){const a=se[e].get(r);if(a){d[e].remove(a.group);for(const i of a.chunks)i.geo.dispose();for(const i of a.mats)i.dispose(),Me.delete(i);se[e].delete(r)}}function gt(e,r){for(const a of[...se[e].keys()])a.startsWith(r)&&Fe(e,a)}function yt(e,r,a){const i=se[e].get(r);if(i)for(const t of i.chunks){const c=Math.max(0,Math.min(t.i1-t.i0,a-t.i0));t.geo.instanceCount=c;for(const f of t.lines)f.visible=c>0}}function wt(e,r,a,i,t){const c=se[e].get(r);c&&(a&&(c.anchor[0]=a[0],c.anchor[1]=a[1],c.anchor[2]=a[2]),c.show=i,c.group.visible=i,t&&c.group.quaternion.setFromRotationMatrix(new o.Matrix4().set(t[0],t[1],t[2],0,t[3],t[4],t[5],0,t[6],t[7],t[8],0,0,0,0,1)))}function Mt(e,r,a){const i=se[e].get(r);i&&(i.mats[0].userData.base=a,_e(e,r,i.mats[0]))}function St(e,r,a){const i=se[e].get(r);if(i&&i.mats[1])for(const t of i.chunks)t.lines[1].visible=a&&t.lines[0].visible}const he={sim:new Map,map:new Map};function bt(e,r,a,i={}){let t=he[e].get(r);if(t&&t.cap>=a)return t;t&&(d[e].remove(t.line),t.geo.dispose(),t.mat.dispose(),Me.delete(t.mat));const c=new nt;c.setPositions(new Float32Array(3*a)),i.vertexColors&&c.setColors(new Float32Array(3*a));const f=Ve(i.color||"#ffffff",i.opacity==null?1:i.opacity,i.width||1,i),m=new ot(c,f);return m.frustumCulled=!1,m.visible=!1,d[e].add(m),t={cap:a,geo:c,mat:f,line:m,o:[0,0,0]},he[e].set(r,t),_e(e,r,f),t}function Rt(e,r,a,i,t,c,f){const m=he[e].get(r);if(!m)return;if(i=Math.min(i,m.cap),i<2){m.line.visible=!1;return}const p=f||a;m.o[0]=p[0],m.o[1]=p[1],m.o[2]=p[2];const _=m.geo.attributes.instanceStart.data,b=_.array,s=c&&typeof c=="object";for(let z=0;z<i-1;z++){const Z=s?!!c[z]:c>0&&Math.floor(z/c)%2===1;for(let L=0;L<2;L++)for(let h=0;h<3;h++)b[6*z+3*L+h]=(a[3*(z+(Z?0:L))+h]-m.o[h])*N}if(_.needsUpdate=!0,t&&m.geo.attributes.instanceColorStart){const z=m.geo.attributes.instanceColorStart.data,Z=z.array;for(let L=0;L<i-1;L++)for(let h=0;h<2;h++)for(let P=0;P<3;P++)Z[6*L+3*h+P]=t[3*(L+h)+P];z.needsUpdate=!0}m.geo.instanceCount=i-1,m.line.visible=!0}function xt(e,r){const a=he[e].get(r);a&&(a.line.visible=!1)}function _t(e,r,a){const i=he[e].get(r);i&&i.mat.userData.base!==a&&(i.mat.userData.base=a,_e(e,r,i.mat))}const oe=(()=>{const r=[];for(let t=-20;t<=20;t++)r.push(t,-20,0,t,20,0,-20,t,0,20,t,0);const a=new o.BufferGeometry;a.setAttribute("position",new o.Float32BufferAttribute(r,3));const i=()=>{const t=new o.ShaderMaterial({vertexShader:Zt,fragmentShader:$t,transparent:!0,depthWrite:!1,toneMapped:!1,uniforms:{uColor:{value:new o.Color(g.grid)},uAlpha:{value:0},uR:{value:20}}}),c=new o.LineSegments(a,t);return c.frustumCulled=!1,c.visible=!1,l.add(c),c};return{N:20,a:i(),b:i(),c:[0,0,0],s:1,alpha:[0,0],rot:null,show:!1}})();function kt(e,r,a,i,t){oe.show=e,e&&(oe.c[0]=r[0],oe.c[1]=r[1],oe.c[2]=r[2],oe.s=a,oe.alpha[0]=i,oe.alpha[1]=t)}const C={group:null,key:"",shells:[],fills:{},mats:{},plumes:[],ports:[],rcs:[]},qe=(e,r)=>{const a=e[0][1]>e[e.length-1][1],i=a?e.slice().reverse():e,t=new o.LatheGeometry(i.map(([_,b])=>new o.Vector2(_,b)),40,r?Math.PI:0,r?Math.PI:Math.PI*2),c=[0];for(let _=1;_<i.length;_++)c.push(c[_-1]+Math.hypot(i[_][0]-i[_-1][0],i[_][1]-i[_-1][1]));const f=t.attributes.uv,m=i.length,p=c[m-1]||1;for(let _=0;_<f.count;_++)f.setY(_,a?1-c[_%m]/p:c[_%m]/p);return t},ge=(e,r,a,i=.5)=>{const t=[];for(let c=0;c<=6;c++){const f=c/6*Math.PI/2;t.push([e*Math.sin(f),r+i*e*(1-Math.cos(f))])}for(let c=6;c>=0;c--){const f=c/6*Math.PI/2;t.push([e*Math.sin(f),a-i*e*(1-Math.cos(f))])}return t},zt=(e,r,a,i)=>{const t=[];for(let c=0;c<=8;c++){const f=c/8;t.push([e+(r-e)*Math.sqrt(f),a-(a-i)*f])}return t};function Ie(e){const{rc:r,rt:a,re:i,yc0:t,Lc:c,Lv:f,dome:m}=e,p=[];if(m)for(let h=0;h<=6;h++){const P=h/6*Math.PI/2;p.push([r*Math.sin(P),t+m*Math.cos(P)])}else p.push([r,t]);const _=t-c,b=_-f;for(let h=1;h<=4;h++)p.push([r,t-c*h/4]);for(let h=1;h<=10;h++){const P=h/10,G=.5-.5*Math.cos(Math.PI*P);p.push([r+(a-r)*G,_-f*P])}const s=b+.5;for(let h=1;h<=18;h++){const P=h/18,G=(1-Math.pow(1-P,2.4))*P/(P+.04)*1.04;p.push([a+(i-a)*G,b-s*P])}const z=[0];for(let h=1;h<p.length;h++)z.push(z[h-1]+Math.hypot(p[h][0]-p[h-1][0],p[h][1]-p[h-1][1]));const Z=z[z.length-1],L=(m?7:1)+4+10-1;return{pts:p,vt:z[L]/Z,ve:(z[L]+.45*(Z-z[L]))/Z,yt:b}}const no=(e,r,a)=>new o.Mesh(new o.TubeGeometry(new o.CatmullRomCurve3(e.map(i=>new o.Vector3(...i))),24,r,8,!1),a),He=new o.PlaneGeometry(1,1).rotateY(Math.PI/2),Ye=new o.CylinderGeometry(1,1,1,24,1,!0,Math.PI,Math.PI);function le(e,r,a,i,t=.12){return new o.ShaderMaterial({vertexShader:CRAFT_VS,fragmentShader:CRAFT_FS,side:o.DoubleSide,toneMapped:!1,uniforms:{uColor:{value:new o.Color(a?"#ffffff":e)},uBack:{value:new o.Color(e)},uSun:{value:new o.Vector3(1,0,0)},uFlat:{value:r?1:0},uTex:{value:a?1:0},uMap:{value:a?to(a,i):null},uSpec:{value:r?0:t},uClip:{value:1e9},uPort:{value:-1},uRod:{value:1e9},uCutX:{value:1e9}}})}const Xe=new o.BoxGeometry(.03,.028,.03),Ke=new o.CylinderGeometry(.0035,.0075,.012,10,1,!0),Ae=new o.Vector3(0,1,0),Be=new o.Vector3(0,-1,0),Ct={transparent:!0,premultipliedAlpha:!0,blending:o.AdditiveBlending,depthWrite:!1,side:o.DoubleSide,toneMapped:!1},Ze=new o.CylinderGeometry(1,1,1,32,1,!1).translate(0,-.5,0);function $e(){const e=new o.Group,r=new o.ShaderMaterial({vertexShader:PLUME_VS,fragmentShader:PLUME_FS,...Ct,side:o.FrontSide,uniforms:{uCore:{value:new o.Color},uBody:{value:new o.Color},uI:{value:0},uT:{value:0},uSimple:{value:0},uSeed:{value:Math.random()*50},uLen:{value:1},uR0:{value:.1},uR1:{value:.6},uRh0:{value:.3},uRh1:{value:1.5},uCam:{value:new o.Vector3}}}),a=new o.Mesh(Ze,r);return a.renderOrder=2,a.frustumCulled=!1,e.add(a),e.userData.mat=r,e.userData.hull=a,e.visible=!1,e}const ke=new o.Vector3;function Qe(e,r,a,i){const t=e.userData.mat.uniforms;t.uLen.value=r,t.uR0.value=a,t.uR1.value=i,t.uRh0.value=2.6*a,t.uRh1.value=2.6*i,e.userData.hull.worldToLocal(ke.copy(y.position)),t.uCam.value.copy(ke);const c=-ke.y/r,m=c>=0&&c<=1&&Math.hypot(ke.x,ke.z)<2.6*(a+(i-a)*c)?o.BackSide:o.FrontSide;e.userData.mat.side!==m&&(e.userData.mat.side=m,e.userData.mat.needsUpdate=!0)}function Lt(e,r,a,i,t,c){C.group&&(C.group.parent&&C.group.parent.remove(C.group),C.group.traverse(w=>{w.material&&w.material.dispose(),w.geometry&&![He,Ye,Ze,Xe,Ke].includes(w.geometry)&&w.geometry.dispose()}));const f=new o.Group;f.visible=!1;const m=a.tex,p=/^lox/.test(i||""),_=(w,S)=>le(a.metal,!1,w,S?{...m,...S}:m,w==="foam"?.06:w.startsWith("quilt")?.18:.25),b=eo,s={metal:le(a.metal),nozzle:le(a.nozzle),fuel:le(a.fuel,!0),ox:le(a.ox,!0),wall:le(a.fuel),fuelL:le(a.fuel,!0),oxL:le(a.ox,!0),line:le(a.tex.ink),valve:le(a.nozzle),oxTank:_(p?"foam":i==="n2o_htpb"?"carbon":b),fuelTank:_(i==="lox_lh2"?"foam":i==="lox_rp1"?"alu":b),caseC:_(e==="sol"?"case":"carbon"),skirt:_("skirt"),deck:_("deck"),copv:_("carbon"),ductC:le(Q(m.ink,m.warn,.12))};s.wall.uniforms.uColor.value.multiplyScalar(.4),s.line.uniforms.uSpec.value=.5,s.valve.uniforms.uColor.value.multiplyScalar(.8);const z=[],Z={},L=[],h=[],P=(w,S)=>{const M=new o.Mesh(qe(w,!1),S),k=new o.Mesh(qe(w,!0),S);k.visible=!1,f.add(M,k),z.push([M,k])},G=(w,S,M,k,x)=>{const T=new o.Mesh(He,S);T.visible=!1,f.add(T),Z[w]={m:T,r:M,y0:k,y1:x}},A=(w,S,M,k,x,T)=>{const I=M-.005,q=k+.005,D=x-.005,H=(T*M-.005)/I,B=ge(I,q,D,H),Y=new o.Shape;B.forEach(([K,ae],me)=>me?Y.lineTo(K,ae):Y.moveTo(K,ae));for(let K=B.length-1;K>=0;K--)Y.lineTo(-B[K][0],B[K][1]);const X=new o.Mesh(new o.ShapeGeometry(Y,4).rotateY(-Math.PI/2),S);X.position.x=.001,X.visible=!1,f.add(X),Z[w]={m:X,liq:!0,r:I,y0:q,y1:D,k:H}},j=(w,S,M,k,x=0)=>{const T=new o.Mesh(Ye,s.wall);T.visible=!1,f.add(T),L.push(T),Z[w]={m:T,r:S,y0:M,y1:k,wall:!0,k:x}},ie=(w,S,M,k,x,T)=>{const I=le(a.fuel,!0),q=ge(M,k,x,T),D=new o.Shape;q.forEach(([B,Y],X)=>X?D.lineTo(B,Y):D.moveTo(B,Y));for(let B=q.length-1;B>=0;B--)D.lineTo(-q[B][0],q[B][1]);const H=new o.Mesh(new o.ShapeGeometry(D,6).rotateY(-Math.PI/2),I);H.position.x=.001,H.visible=!1,f.add(H),s["grain_"+w]=I,Z[w]={m:H,grainO:!0,r:M,y0:k,y1:x,k:T}},E=(w,S=0,M=0,k=0)=>(w.position.set(S,M,k),f.add(w),w);let ee=.095;const $=(w,S,M,k,x=s.metal)=>P([[w,S-M/2],[w+k,S-M/2],[w+k,S+M/2],[w,S+M/2],[w,S-M/2]],x),ze=w=>new o.Vector3(w[0],w[1],w[2]),J=(w,S,M,k=s.metal)=>{const x=ze(w),T=ze(S),I=T.clone().sub(x),q=new o.Mesh(new o.CylinderGeometry(M,M,I.length(),8),k);return q.position.copy(x).addScaledVector(I,.5),q.quaternion.setFromUnitVectors(Ae,I.normalize()),f.add(q),q},ue=(w,S,M=s.line,k=!0)=>{const x=new o.CatmullRomCurve3(w.map(ze),!1,"centripetal");if(f.add(new o.Mesh(new o.TubeGeometry(x,Math.max(24,w.length*14),S,10,!1),M)),k)for(const T of[0,1]){const I=new o.Mesh(new o.TorusGeometry(S*1.35,S*.45,6,16),s.valve);I.position.copy(x.getPointAt(T)),I.quaternion.setFromUnitVectors(new o.Vector3(0,0,1),x.getTangentAt(T)),f.add(I)}return x},Ce=(w,S,M,k=s.valve)=>{const x=w.getPointAt(S),T=w.getTangentAt(S),I=new o.Mesh(new o.CylinderGeometry(M*1.9,M*1.9,M*3.2,12),k);I.position.copy(x),I.quaternion.setFromUnitVectors(Ae,T),f.add(I);const q=new o.Vector3().crossVectors(T,Math.abs(T.y)<.9?Ae:new o.Vector3(1,0,0)).normalize(),D=new o.Mesh(new o.BoxGeometry(M*2.4,M*2.4,M*2.4),s.metal);D.position.copy(x).addScaledVector(q,M*2.6),f.add(D)},et=(w,S,M)=>E(new o.Mesh(new o.SphereGeometry(w,20,14),M),S[0],S[1],S[2]),Oe=(w,S,M,k,x,T=0)=>[Math.cos(T)*w*Math.sin(x),S+k*M*w*(1-Math.cos(x)),Math.sin(T)*w*Math.sin(x)];if(e==="liq"){const T=.6299999999999999,I=Math.max(.16,Math.min(T-.16,T*(t>0?t:.5))),q=.47-I,D=q-.05;P(ge(.12,q,.47),s.oxTank),A("ox",s.oxL,.12,q,.47,.5),P(ge(.12,-.21,D),s.fuelTank),A("fuel",s.fuelL,.12,-.21,D,.5),P([[.12+.002,.47-.06+.015],[.12+.002,.492]],s.skirt),$(.12-.012,.492,.012,.016),P([[.12+.002,D-.06+.012],[.12+.002,q+.06-.012]],s.skirt),$(.12,D-.06+.012,.008,.006),$(.12,q+.06-.012,.008,.006);const H=-.21+.06*.55;$(.12-.014,H,.01,.018);const B=-.274;$(.012,B,.008,.014);for(let W=0;W<8;W++){const ne=(W+.5)/8*2*Math.PI,ve=ne+(W%2?-1:1)*Math.PI/8;J([Math.cos(ne)*(.12-.01),H-.004,Math.sin(ne)*(.12-.01)],[Math.cos(ve)*.022,B,Math.sin(ve)*.022],.0035)}E(new o.Mesh(new o.CylinderGeometry(.011,.014,.012,16),s.valve),0,B-.008,0),E(new o.Mesh(new o.TorusGeometry(.0125,.0028,6,20).rotateZ(Math.PI/2),s.metal),0,B-.008,0);const Y=Ie({rc:.026,rt:.0122,re:.064,yc0:-.302,Lc:.03,Lv:.022,dome:.012});s.nozLiq=_("nozLiq",{vt:Y.vt,ve:Y.ve}),P(Y.pts,s.nozLiq),ee=.064,$(.026,-.318,.006,.004);for(const W of[1,-1])J([0,H-.006,W*(.12-.02)],[0,-.318,W*.031],.0042,s.valve);const X=p?s.ductC:s.line,K=.0062,ae=.0058,me=Oe(.12,q,.5,1,1.05,Math.PI),ye=-(.12+.017),Re=p?[-.067,-.296,0]:[-.014,-.286,0],Ee=[me,[me[0]-.006,me[1]-.02,0],[ye,q-.004,0],[ye,(q+H)/2,0],[ye,H+.01,0],[ye+.012,H-.03,0],[-.088,-.255,0],[Re[0]-.004,Re[1]+.014,0],Re],je=ue(Ee,K,X);Ce(je,.82,K);for(let W=1;W<=3;W++){const ne=q-.01+(H+.01-q+.01)*W/4;J([ye+K*.6,ne,0],[-.12+.002,ne,0],.0028),J([ye,ne,-.006],[-.12*Math.cos(.12),ne,-.12*Math.sin(.12)],.0022)}const we=Oe(.12,-.21,.5,1,.75,0),Ne=p?[.067,-.296,0]:[.014,-.286,0],Ot=ue([we,[we[0]+.004,we[1]-.02,0],[.085,-.24,0],[Ne[0]+.006,Ne[1]+.016,0],Ne],ae,X);if(Ce(Ot,.6,ae),p){for(const W of[1,-1]){const ne=W*.06,ve=-.312;E(new o.Mesh(new o.CylinderGeometry(.012,.013,.03,16),s.metal),ne,ve,0),E(new o.Mesh(new o.TorusGeometry(.0135,.0048,8,20).rotateX(Math.PI/2),s.valve),ne,ve+.006,0),E(new o.Mesh(new o.CylinderGeometry(.009,.011,.012,14),s.valve),ne,ve-.019,0),ue([[ne,ve+.016,0],[ne-W*.006,-.288,0],[W*.024,-.286,0],[W*.012,-.291,0]],.0042,s.line),J([ne-W*.012,ve,0],[W*.026,ve-.004,0],.0025)}ue([[.06,-.327,0],[.05,-.335,.015],[0,-.326,.028],[-.05,-.335,.015],[-.06,-.327,0]],.0028,s.line,!1)}else{E(new o.Mesh(new o.BoxGeometry(.034,.012,.022),s.valve),0,-.287,0);for(const W of[.082,-.082])et(.027,[0,-.238,W],s.copv),J([0,-.238+.02,W*.82],[0,H-.004,W*1.2],.0024),J([0,-.262,W*.85],[0,B,W*.25],.0024);ue([[0,-.238,.055],[.03,-.235,.03],[.05,-.215,.012],[we[0]-.02,we[1]-.006,.006]],.0022,s.line,!1),E(new o.Mesh(new o.BoxGeometry(.012,.01,.012),s.metal),.03,-.235,.03)}C.rcsAt=[.12,.405,.12,-.21+.06+.02]}else if(e==="hyb"){P(ge(.12,.1,.47),s.oxTank),A("ox",s.oxL,.12,.1,.47,.5),P([[.12+.002,.43],[.12+.002,.492]],s.skirt),$(.12-.012,.492,.012,.016);const S=.125,M=.03,k=-.36,x=.3;P([[.12+.004,M-x*S+.008],[.12+.004,.1+.5*.12-.008]],s.skirt),$(.12+.004,.1+.5*.12-.008,.008,.005);const T=ue([[0,.1,0],[0,.07,0],[0,M+.004,0]],.009,s.line);Ce(T,.5,.009),P(ge(S,k,M,x),s.caseC),G("grainA",s.fuel,.115,-.33,-.005),G("grainB",s.fuel,.115,-.33,-.005),j("port",.115,-.33,-.005),$(S,M-x*S,.012,.006,s.valve),$(S,k+x*S,.012,.006,s.valve);for(let q=0;q<16;q++){const D=q/16*2*Math.PI;for(const H of[M-x*S,k+x*S])E(new o.Mesh(new o.BoxGeometry(.006,.006,.006),s.metal),Math.cos(D)*(S+.0065),H,Math.sin(D)*(S+.0065))}$(.056,k+.004,.014,.012,s.metal);const I=Ie({rc:.058,rt:.022,re:.088,yc0:-.357,Lc:.004,Lv:.03});s.nozAbl=_("nozAbl",{vt:I.vt}),P(I.pts,s.nozAbl),ee=.088,C.rcsAt=[.12,.4,S,-.25]}else if(e==="sol"){const w=c||{caseLD:2,k:.5,noz:.5,exit:.55,thr:.12},S=.94/(w.caseLD+w.noz),M=S/2,k=w.k,x=.44,T=x-w.caseLD*S,I=x-k*M,q=T+k*M;P(ge(M,T,x,k),s.caseC),ie("grain",s.fuel,M-.008,T+.008,x-.008,k),j("port",M-.008,T+.008,x-.008,k),$(M,I,.012,.006,s.valve),$(M,q,.012,.006,s.valve);const D=Math.min(.105,M*.5),H=x-k*M*(1-Math.sqrt(1-(D/M)**2));P([[D,H],[D*.93,x+.025],[D*.88,x+.05]],s.skirt),$(D*.76,x+.05,.01,D*.17),E(new o.Mesh(new o.CylinderGeometry(D*.19,D*.23,.02,14),s.valve),0,x+.004,0);const B=Math.max(.008,w.thr*M),Y=w.exit*M,X=Math.min(M*.6,Math.max(B*2.2,Y*.55));$(X*.9,T+.004,.014,.016,s.metal);const K=Ie({rc:X,rt:B,re:Y,yc0:T+.03,Lc:.004,Lv:Math.max(.02,(X-B)*1.2)});s.nozAbl=_("nozAbl",{vt:K.vt}),P(K.pts,s.nozAbl),ee=Y,C.rcsAt=[D*.95,x+.035,X*.9,T-.012]}else{P(ge(.19,.155-.19,.155+.19,1),s.oxTank),A("fuel",s.fuelL,.19,.155-.19,.155+.19,1),$(.19,.155,.014,.008,s.valve);for(let B=0;B<4;B++){const Y=(B+.5)/4*2*Math.PI,X=Math.cos(Y),K=Math.sin(Y);J([X*(.19+.006),.155-.004,K*(.19+.006)],[X*.235,-.135+.012,K*.235],.0055),J([X*(.19+.006),.155-.004,K*(.19+.006)],[Math.cos(Y+.5)*.2,-.135+.012,Math.sin(Y+.5)*.2],.0035)}P([[0,-.135-.013],[.255,-.135-.013],[.255,-.135+.012],[0,-.135+.012]],s.deck);const k=[.185,-.135+.072,0];et(.06,k,s.copv),E(new o.Mesh(new o.BoxGeometry(.018,.014,.018),s.valve),k[0],k[1]+.07,0);const x=Oe(.19,.155+.19,1,-1,.35,0),T=ue([[k[0],k[1]+.058,0],[k[0],k[1]+.078,0],[.205,.155,0],[.19*Math.sin(.8)+.015,.155+.19*Math.cos(.8)+.01,0],x],.0035,s.line);Ce(T,.25,.0035);const I=[0,.155-.19,0],q=ue([I,[0,.155-.19-.03,0],[0,-.135+.035,0]],.0055,s.line);E(new o.Mesh(new o.CylinderGeometry(.011,.011,.026,12),s.metal),0,.155-.19-.03,0),Ce(q,.8,.0055),E(new o.Mesh(new o.TorusGeometry(.15,.004,6,40).rotateX(Math.PI/2),s.line),0,-.135+.022,0),ue([[0,-.135+.035,0],[.04,-.135+.025,0],[.15,-.135+.022,0]],.0035,s.line,!1);const D=10*Math.PI/180,H=[];for(let B=0;B<4;B++){const Y=(B+.5)/4*2*Math.PI,X=Math.cos(Y),K=Math.sin(Y),ae=new o.Group;ae.position.set(X*.15,-.135-.013,K*.15),ae.quaternion.setFromUnitVectors(Be,new o.Vector3(X*Math.sin(D),-Math.cos(D),K*Math.sin(D)));const me=(Re,Ee,je)=>{const we=new o.Mesh(Re,Ee);we.position.y=je,ae.add(we)};me(new o.CylinderGeometry(.013,.013,.02,14),s.valve,-.01),me(new o.CylinderGeometry(.0035,.0035,.018,8),s.line,-.028),me(new o.CylinderGeometry(.011,.011,.03,14),s.metal,-.051);for(const Re of[-.042,-.058])me(new o.TorusGeometry(.0115,.0018,6,18).rotateX(Math.PI/2),s.valve,Re);const ye=new o.Mesh(qe(zt(.0075,.024,-.066,-.115),!1),s.nozzle);ae.add(ye),f.add(ae),ae.updateMatrix(),H.push({p:new o.Vector3(0,-.115,0).applyMatrix4(ae.matrix),d:new o.Vector3(0,-1,0).applyQuaternion(ae.quaternion)}),J([X*.15,-.135+.022,K*.15],[X*.15,-.135+.012,K*.15],.0035,s.line)}C.thr=H,ee=.024,C.rcsAt=[.19+.006,.155+.02,.255,-.135]}C.exitR=ee;const De=C.rcsAt||[.12,.4,.12,-.15],tt=[];for(const[w,S]of[[De[0],De[1]],[De[2],De[3]]])for(const[M,k]of[[1,0],[0,1],[-1,0],[0,-1]]){const x=w+.012,T=new o.Vector3(M,0,k),I=new o.Vector3(M*x,S,k*x);E(new o.Mesh(Xe,s.valve),I.x,S,I.z),E(new o.Mesh(Ke,s.nozzle),M*(x+.019),S,k*(x+.019)).quaternion.setFromUnitVectors(Ae,T);const D=$e();D.position.set(M*(x+.025),S,k*(x+.025)),D.quaternion.setFromUnitVectors(Be,T),f.add(D),tt.push({m:D,tau:new o.Vector3().crossVectors(I,T.clone().negate()).normalize()})}C.rcsAt=null;const Bt=e==="mono"?4:1;for(let w=0;w<Bt;w++){const S=$e();f.add(S),h.push(S)}d.sim.add(f),Object.assign(C,{group:f,shells:z,fills:Z,ports:L,plumes:h,mats:s,ty:e,grain:r,rcs:tt,rx:null})}const de=new o.Vector3,be=new o.Vector3,Je=new o.Vector3,Tt=new o.Matrix4;function Pt(e){if(!e.show){C.group&&(C.group.visible=!1);return}const r=Math.round((e.fo||.5)*100)/100,a=e.sol?[e.sol.caseLD,e.sol.k,e.sol.noz,e.sol.exit,e.sol.thr].map(G=>Math.round(G*100)/100):null,i=[e.type,e.grain,e.prop,r,a,e.col.metal,e.col.fuel,e.col.ox,e.col.nozzle].join("|");C.key!==i&&(Lt(e.type,e.grain,e.col,e.prop,r,e.sol),C.key=i);const t=C.group,c=e.L*N,f=e.st||{},m=d[e.set||"sim"];t.parent!==m&&m.add(t),t.visible=!0,t.scale.setScalar(c),t.position.set((e.p[0]-re[0])*N,(e.p[1]-re[1])*N,(e.p[2]-re[2])*N);for(const G of Object.values(C.mats))G.uniforms.uSun.value.set(e.sun[0],e.sun[1],e.sun[2]);be.set(e.axis[0],e.axis[1],e.axis[2]).normalize();const p=e.side||[0,0,1];de.set(p[0],p[1],p[2]),de.addScaledVector(be,-de.dot(be)),de.lengthSq()<1e-6&&(de.set(1,0,0),de.addScaledVector(be,-de.dot(be))),de.normalize(),Je.crossVectors(de,be),t.quaternion.setFromRotationMatrix(Tt.makeBasis(de,be,Je));const _=e.cutK==null?+!!e.cut:e.cutK,b=_>0&&_<1;if(C.rx==null){const G=new o.Box3;for(const[A]of C.shells)A.geometry.computeBoundingBox(),G.union(A.geometry.boundingBox);C.rx=Math.max(.05,G.max.x)}const s=b?.004+C.rx*(1-_*_*(3-2*_)):1e9;for(const[G,A]of C.shells)G.visible=!e.cut,A.visible=!!e.cut,G.material.uniforms.uCutX&&(G.material.uniforms.uCutX.value=s);for(const[G,A]of Object.entries(C.fills)){const j=A.m;if(j.visible=!!e.cut||b,!j.visible)continue;const ie=A.y1-A.y0;if(A.liq){const J=Math.max(0,Math.min(1,G==="ox"?f.ox:f.fuel));j.visible=J>.002,j.material.uniforms.uClip.value=A.y0+A.r*engTankLevel(J,ie/A.r,A.k);continue}let E,ee;C.ty==="hyb"?(E=f.port||0,ee=1):C.grain==="rod"?(E=0,ee=1-.6*(f.web||0)):(E=.5+.5*(f.web||0),ee=1);const $=(ee-E)*A.r;if(A.grainO){const J=j.material.uniforms;J.uPort.value=E>.001?E*A.r:-1,J.uRod.value=C.grain==="rod"?ee*A.r:1e9,j.visible=$>1e-4;continue}if(A.wall){j.visible=E>.01||C.grain==="rod";const J=(C.grain==="rod"?ee:E)*A.r,ue=A.k*A.r*(1-Math.sqrt(Math.max(0,1-(J/A.r)**2)));j.scale.set(J,Math.max(1e-4,ie-2*ue),J),j.position.set(0,(A.y0+A.y1)/2,0);continue}j.visible=$>1e-4,j.scale.set(1,ie,C.grain==="rod"&&C.ty==="sol"?2*ee*A.r:$);const ze=C.grain==="rod"&&C.ty==="sol"?0:(G==="grainA"?1:-1)*(E*A.r+$/2);j.position.set(.001,(A.y0+A.y1)/2,ze),G==="grainB"&&C.grain==="rod"&&C.ty==="sol"&&(j.visible=!1)}t.updateMatrixWorld(!0);const z=e.rcs,Z=z&&Math.hypot(z.a[0],z.a[1],z.a[2])||1;for(const G of C.rcs){const A=z&&z.k>.01?(G.tau.x*z.a[0]+G.tau.y*z.a[1]+G.tau.z*z.a[2])/Z:0,j=z?z.k*Math.max(0,Math.min(1,(A-.5)/.4)):0;if(G.m.visible=j>.01,!G.m.visible)continue;const ie=G.m.userData.mat.uniforms;ie.uCore.value.set(z.core),ie.uBody.value.set(z.body),ie.uI.value=.9*j,ie.uT.value=e.plume&&e.plume.t||0,ie.uSimple.value=e.plume&&e.plume.simple?1:0,Qe(G.m,.06+.05*j,.005,.016+.012*j)}const L=e.plume||{I:0},h=L.I>.002,P=C.plumes.length>1;C.plumes.forEach((G,A)=>{if(G.visible=h,!h)return;const j=G.userData.mat.uniforms,ie=P?L.len*.3:L.len,E=P?.024:C.exitR||.095;if(j.uCore.value.set(L.core),j.uBody.value.set(L.body),j.uI.value=L.I,j.uT.value=L.t||0,j.uSimple.value=L.simple?1:0,P&&C.thr){const ee=C.thr[A];G.position.copy(ee.p),G.quaternion.setFromUnitVectors(Be,ee.d)}else G.position.set(0,-.5,0);G.updateMatrixWorld(!0),Qe(G,ie,E*.8,E+ie*.17)})}function Gt(e,r,a){v=e,R=r,O=a,Pe.right=e,Pe.top=r,Pe.updateProjectionMatrix(),u.setPixelRatio(a),u.setSize(e,r,!1);for(const i of Me)i.resolution.set(e,r)}function At(e,r,a,i,t,c,f,m){m&&(y.fov=m),re[0]=e[0],re[1]=e[1],re[2]=e[2],y.position.set(i[0]*t*N,i[1]*t*N,i[2]*t*N),y.quaternion.setFromRotationMatrix(new o.Matrix4().makeBasis(new o.Vector3(...r),new o.Vector3(...a),new o.Vector3(...i))),y.aspect=v/R,y.near=Math.max(1e-6,t*N*1e-7),y.far=Math.max(1e7,t*N*1e7),y.setViewOffset(v,R,v/2-c,R/2-f,v,R),y.updateProjectionMatrix()}const Dt=new o.Quaternion;function Vt(e){V=e;for(const r in d)d[r].visible=r===e;C.group&&C.group.parent!==d[e]&&(C.group.visible=!1)}const Ft=new o.Matrix4;function qt(e){if(U)return;if(fe.visible=!!e.stars&&!!pe,fe.visible){const t=e.sky;fe.position.copy(y.position),fe.scale.setScalar(y.far*.5),t?fe.quaternion.setFromRotationMatrix(Ft.set(t[0],t[1],t[2],0,t[3],t[4],t[5],0,t[6],t[7],t[8],0,0,0,0,1)):fe.quaternion.identity(),xe.material.uniforms.uDpr.value=O;const c=e.skyGain==null?1:e.skyGain;pe.material.uniforms.uGain.value=SKY_GAIN*c,xe.material.uniforms.uGain.value=c}const r=(t,c)=>c.set((t[0]-re[0])*N,(t[1]-re[1])*N,(t[2]-re[2])*N);for(const t of Ge[V]||[]){if(!t.mesh.visible)continue;r(t.p,t.mesh.position),t.mesh.scale.set(t.r*N*t.ax[0],t.r*N*t.ax[1],t.r*N*t.ax[2]);const c=t.mesh.material.uniforms,f=Dt.copy(t.mesh.quaternion).invert();c.uSun.value.copy(t.sun).applyQuaternion(f),c.uCam.value.copy(y.position).sub(t.mesh.position).divideScalar(t.r*N).applyQuaternion(f),t.ring&&t.ring.visible&&(t.ring.position.copy(t.mesh.position),t.ring.quaternion.copy(t.mesh.quaternion),t.ring.scale.copy(t.mesh.scale)),t.haze&&t.haze.visible&&(t.haze.position.copy(t.mesh.position),t.haze.quaternion.copy(t.mesh.quaternion),t.haze.scale.setScalar(t.r*N*(1+t.hazeTop)),t.haze.material.uniforms.uInside.value=c.uCam.value.length()<1+t.hazeTop?1:0)}if(se[V])for(const t of se[V].values())t.show&&r(t.anchor,t.group.position);if(he[V])for(const t of he[V].values())t.line.visible&&r(t.o,t.line.position);[oe.a,oe.b].forEach((t,c)=>{const f=oe.s*(c?10:1),m=oe.alpha[c];if(t.visible=oe.show&&m>.002,!t.visible)return;const p=[Math.round(oe.c[0]/f)*f,Math.round(oe.c[1]/f)*f,oe.c[2]];r(p,t.position),t.scale.setScalar(f*N),t.material.uniforms.uAlpha.value=m}),u.clear(),u.render(l,y);const i=e.glare;i&&i.i>.003&&(Se.visible=!0,Se.position.set(i.x,R-i.y,0),Se.scale.setScalar(i.L*GLARE_EXT),Se.material.uniforms.uI.value=i.i,u.render(Ue,Pe))}function It(){u.dispose()}return{size:Gt,view:At,setActive:Vt,render:qt,bodies:ut,body:mt,skySet:rt,line:ht,lineDrop:Fe,lineDropAll:gt,lineUpTo:yt,lineSet:wt,lineOpacity:Mt,lineGlow:St,fadeSet:vt,dyn:bt,dynSet:Rt,dynHide:xt,dynOpacity:_t,gridSet:kt,craft:Pt,dispose:It,get gl(){return u.getContext()},renderer:u}}
