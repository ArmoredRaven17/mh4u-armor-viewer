// MH4U's own shading for nDraw::MaterialStd, as the 3DS draws it (notes/shading-decode.md, steps 1-5). An OPTION:
// the generic lighting stays the default until Raven has looked (setShade4u). Every MaterialStd keeps the shared
// base material it was built with (masks, colours, the dye view, visibility all still act on it); this module
// chains one more step onto its shader that, while the option is on, replaces the fragment colour with the PICA's:
//
//   vertex colour  the vertex shader's SH ambient from the scene's hemisphere light (0x6c00e0 -> 0x3a1fa0 ->
//                  0x5a42ec): 0.375 (C + R) + 0.25 (C - R) (N . d), C = mColor, R = mRevColor, d = mDir
//   fragment primary / secondary  the PICA's fragment lighting with the program's registers (lfx program 31 +0x48:
//                  CONFIG0 0x880b041d, CONFIG1 0x00070000, LUTINPUT_ABS 0x22, SELECT 0x2400, SCALE 0) and one
//                  directional light: primary = emission + diffuse x max(N . L, 0); secondary = (specular0 +
//                  specular1 x RR(|N . H|)) x [N . L > 0]; both alphas = FR(|N . V|)
//   the six TEV stages  each material's own, as the game's apply (0x62a900) left them (scripts/build_shading.py,
//                  shading.json `tev` / `k`), generated into GLSL per program, with the combiner buffer's one-stage
//                  delay (3dbrew; stage i reads the buffer as of stage i - 2)
//
// Everything runs on the texels as stored (the sampled colour is encoded back to sRGB first, as the base material's
// screen blend does) and the result is decoded again for three's output. The light set is the character-creation
// scene's (player\char_make-f): the only light file outside the stages (step 5).
//
// NOT MODELLED (logged in the notes): the 8-bit precision of the combiners; the shadow map (texture 0) and fog; the
// texture units' own coordinates (every unit samples the mesh's one UV set here); the vertex shader's prelit and
// flat-Ambient paths (no shipped mesh with vertex colours takes the 4U path); the post filters.
import * as THREE from 'three';
import { loadJson, getTexture } from '../base/render/assets.js';

let DB = null;
export async function loadShading(){
  if (!DB){
    try { DB = await loadJson('shading.json'); } catch (e) { DB = null; }
    if (DB && DB.light) setLightSet(DB.light);
  }
  return DB;
}
export function shadingDb(){ return DB; }

// ---- the scene's lights, shared by every material ------------------------------------------------------------------
const ON = { value: 0 };
const LIGHT = {
  u4LDir:   { value: new THREE.Vector3(0, 0, 1) },   // towards the light, world space (mDir)
  u4LDiff8: { value: new THREE.Vector3() },          // the light's DIFFUSE word, 0-255 per channel
  u4LSpec8: { value: new THREE.Vector3() },          // specular0 = specular1 (0x956ee4 writes both alike)
  u4HDir:   { value: new THREE.Vector3(0, 1, 0) },
  u4HC:     { value: new THREE.Vector3() },
  u4HR:     { value: new THREE.Vector3() }
};

// uLight's move (0x956ee4): mColor split by mBalance b into diffuse and specular, each min(x, 1) x 255, truncated
// (VectorFloatToUnsigned, mode 3)
function splitBalance(c, b){
  const k = 1 - Math.abs(b) * 0.5;
  const q = x => Math.trunc(Math.min(x, 1) * 255);
  return { diff: c.map(x => q(x * (b + 1) * k * 0.5)), spec: c.map(x => q(x * (1 - b) * k * 0.5)) };
}
export function setLightSet(ls){
  const s = splitBalance(ls.infinite.color, ls.infinite.balance || 0);
  LIGHT.u4LDir.value.fromArray(ls.infinite.dir);
  LIGHT.u4LDiff8.value.fromArray(s.diff);
  LIGHT.u4LSpec8.value.fromArray(s.spec);
  LIGHT.u4HDir.value.fromArray(ls.hemi.dir);
  LIGHT.u4HC.value.fromArray(ls.hemi.color);
  LIGHT.u4HR.value.fromArray(ls.hemi.rev);
}

// ---- the switch -----------------------------------------------------------------------------------------------------
const attached = new Set();
export function shade4uOn(){ return ON.value > 0.5; }
export function setShade4u(on){
  ON.value = on ? 1 : 0;
  // an additive material that binds no albedo is hidden on the generic path (it would add a flat colour); on the
  // 4U path the unbound map samples black and the material still adds Specular.a x (Fresnel x Reflect + specular)
  for (const m of attached) if (m.userData.maplessOverlay) m.visible = !!on;
  return shade4uOn();
}

// ---- the LUTs: 257 samples -> a texture of (value, delta), quantised as the PICA holds them (0x6359e4: the value
// x 4095, the delta x 2048) --------------------------------------------------------------------------------------------
const LUTS = [];
function lutTexture(i){
  if (LUTS[i]) return LUTS[i];
  const v = DB.lut[i], data = new Float32Array(256 * 2);
  for (let k = 0; k < 256; k++){
    const a = Math.round(v[k] * 4095) / 4095;
    data[2 * k] = a; data[2 * k + 1] = Math.round((v[k + 1] - v[k]) * 2048) / 2048;
  }
  const t = new THREE.DataTexture(data, 256, 1, THREE.RGFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return (LUTS[i] = t);
}

// ---- the TEV program -> GLSL ----------------------------------------------------------------------------------------
const SRC = { 0: 's4Vtx', 1: 's4Pri', 2: 's4Sec', 3: 'vec4( 0.0 )', 4: 's4Alb', 5: 's4Ext', 6: 'vec4( 0.0 )',
              13: 's4Buf', 15: 's4Prev' };
function srcOf(s, n){ return s === 14 ? 'u4K[' + n + ']' : (SRC[s] || 'vec4( 0.0 )'); }
function opRgb(x, o){
  switch (o){
    case 0: return x + '.rgb';           case 1: return '( 1.0 - ' + x + '.rgb )';
    case 2: return 'vec3( ' + x + '.a )'; case 3: return 'vec3( 1.0 - ' + x + '.a )';
    case 4: return 'vec3( ' + x + '.r )'; case 5: return 'vec3( 1.0 - ' + x + '.r )';
    case 8: return 'vec3( ' + x + '.g )'; case 9: return 'vec3( 1.0 - ' + x + '.g )';
    case 12: return 'vec3( ' + x + '.b )'; case 13: return 'vec3( 1.0 - ' + x + '.b )';
  }
  return x + '.rgb';
}
function opA(x, o){
  return ['', '1.0 - ', '', '1.0 - ', '', '1.0 - ', '', '1.0 - '][o & 7] + x + '.' + 'aarrggbb'[o & 7];
}
const NARGS = [1, 2, 2, 2, 3, 2, 2, 2, 3, 3];
function combine(c, a, b, d, one){
  switch (c){
    case 0: return a;
    case 1: return a + ' * ' + b;
    case 2: return a + ' + ' + b;
    case 3: return a + ' + ' + b + ' - ' + one + '( 0.5 )';
    case 4: return a + ' * ' + d + ' + ' + b + ' * ( ' + one + '( 1.0 ) - ' + d + ' )';
    case 5: return a + ' - ' + b;
    case 6: case 7: return one + '( 4.0 * dot( ' + a + ' - vec3( 0.5 ), ' + b + ' - vec3( 0.5 ) ) )';
    case 8: return a + ' * ' + b + ' + ' + d;
    case 9: return 'min( ' + a + ' + ' + b + ', ' + one + '( 1.0 ) ) * ' + d;
  }
  return a;
}
const PROGS = new Map();
export function tevGlsl(p){
  if (PROGS.has(p)) return PROGS.get(p);
  const [, upd, stages] = DB.tev[p];
  const lines = ['s4Buf = vec4( 0.0 ); s4Next = vec4( 0.0 ); s4Prev = vec4( 0.0 );'];
  stages.forEach(([src, op, comb, scale], n) => {
    const cr = comb & 0xf, ca = (comb >> 16) & 0xf;
    const rs = [0, 1, 2].map(k => opRgb(srcOf((src >> (4 * k)) & 0xf, n), (op >> (4 * k)) & 0xf));
    const as = [0, 1, 2].map(k => opA(srcOf((src >> (16 + 4 * k)) & 0xf, n), (op >> (12 + 4 * k)) & 0x7));
    const sr = 1 << (scale & 3), sa = 1 << ((scale >> 16) & 3);
    const rgb = combine(cr, ...rs.map(x => '( ' + x + ' )'), 'vec3');
    const alpha = cr === 7 ? null : combine(ca, ...as.map(x => '( ' + x + ' )'), 'float');
    lines.push('{ vec3 r = clamp( ( ' + rgb + ' ) * ' + sr.toFixed(1) + ', 0.0, 1.0 );');
    lines.push('  float a = ' + (alpha ? 'clamp( ( ' + alpha + ' ) * ' + sa.toFixed(1) + ', 0.0, 1.0 )' : 'r.r') + ';');
    lines.push('  s4Prev = vec4( r, a );');
    lines.push('  s4Buf = s4Next;');
    if (n < 4 && ((upd >> (8 + n)) & 1)) lines.push('  s4Next.rgb = s4Prev.rgb;');
    if (n < 4 && ((upd >> (12 + n)) & 1)) lines.push('  s4Next.a = s4Prev.a;');
    lines.push('}');
  });
  const code = lines.join('\n');
  PROGS.set(p, code);
  return code;
}

// packed 10-bit colour word (R 20-29, G 10-19, B 0-9) -> [r, g, b]
const unpack = w => [(w >>> 20) & 0x3ff, (w >>> 10) & 0x3ff, w & 0x3ff];
const rgba = w => new THREE.Vector4(((w >>> 24) & 0xff) / 255, ((w >>> 16) & 0xff) / 255, ((w >>> 8) & 0xff) / 255, (w & 0xff) / 255);

// ---- one material ---------------------------------------------------------------------------------------------------
// The shading.json entry of material `name` in the piece / weapon entry `ref`, or null.
export function entry4u(ref, name){
  if (!DB || !ref) return null;
  const sec = ref.startsWith('w/') ? DB.weapons : DB.pieces;
  return (sec && sec[ref] && sec[ref][name]) || null;
}

// Chain the 4U path onto `mat` (built by the base's createMaterial). `rom` is its materials-db spec (for the extend
// map's path). Returns false where the material is no MaterialStd the build read.
export function attach4u(mat, ref, name, rom){
  const e = entry4u(ref, name);
  if (!e || mat.userData.u4) return false;
  const k = e.k.map(rgba);
  const u = {
    u4On: ON, ...LIGHT,
    u4K: { value: k.map(v => v.clone()) },
    u4Emis8: { value: new THREE.Vector3().fromArray(unpack(e.c[1])) },     // global ambient = emission (scene ambient 0)
    u4MDiff: { value: new THREE.Vector3().fromArray(unpack(e.c[2])) },     // 256 = 1.0
    u4MSpec0: { value: new THREE.Vector3().fromArray(unpack(e.c[3])) },
    u4MSpec1: { value: new THREE.Vector3().fromArray(unpack(e.c[4])) },
    u4RR: { value: e.rr !== undefined ? lutTexture(e.rr) : null },
    u4FR: { value: e.fr !== undefined ? lutTexture(e.fr) : null },
    u4Ext: { value: null },
    u4Opaque: { value: (rom && rom.state && rom.state.blend !== 'opaque') ? 0 : 1 }
  };
  // the Charge Blade's Shield Charge (setGlow4u): its colour type 0 and 3 materials can take the glow material
  const glow = DB.cbGlow && ref && ref.startsWith('w/gaxe/') && (mat.userData.ct === 0 || mat.userData.ct === 3) ? DB.cbGlow : null;
  u.u4Alt = { value: 0 };
  u.u4Gen = { value: 0 };          // the generic path's glow: 0 none, 1 added over the lit colour, 2 the gauge layer's own
  mat.userData.u4 = { entry: e, u, k0: k, own: ownState(e, k), glow: null, base: null, play: [], hasGlow: !!glow };
  mat.userData.u4.base = mat.userData.u4.own;
  // a clip that starts by itself (flag bit 1) plays from the material's creation (0xcfb070 / 0x637f2c)
  (e.clips || []).forEach((c, i) => { if (c.f & 2) mat.userData.u4.play.push({ clip: c, t0: clock() }); });
  if (mat.userData.u4.play.length) playing.add(mat);
  const ext = e.x && rom && rom.entry && rom.entry.tex ? rom.entry.tex[e.x - 1] : null;
  if (ext) getTexture(ext).then(t => { u.u4Ext.value = t; });
  const tev = glow
    ? 'if ( u4Alt > 0.5 ) {\n' + tevGlsl(glow.red.p) + '\n} else {\n' + tevGlsl(e.p) + '\n}'
    : tevGlsl(e.p);
  const enc = THREE.ColorManagement.enabled
    ? 'vec3 s4Enc( vec3 c ){ c = max( c, vec3( 0.0 ) ); return mix( pow( c, vec3( 1.0 / 2.4 ) ) * 1.055 - 0.055, c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) ); }\n' +
      'vec3 s4Dec( vec3 c ){ c = max( c, vec3( 0.0 ) ); return mix( pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), c / 12.92, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) ); }\n'
    : 'vec3 s4Enc( vec3 c ){ return max( c, vec3( 0.0 ) ); }\nvec3 s4Dec( vec3 c ){ return max( c, vec3( 0.0 ) ); }\n';
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying vec3 v4uN; varying vec3 v4uV;\nvoid main() {')
      .replace('#include <project_vertex>',
        `#include <project_vertex>
         #ifdef USE_SKINNING
           v4uN = transformedNormal;
         #else
           v4uN = normalMatrix * normal;
         #endif
         v4uV = - mvPosition.xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {',
        `varying vec3 v4uN; varying vec3 v4uV;
         uniform float u4On; uniform vec3 u4LDir; uniform vec3 u4LDiff8; uniform vec3 u4LSpec8;
         uniform vec3 u4HDir; uniform vec3 u4HC; uniform vec3 u4HR;
         uniform vec4 u4K[ 6 ]; uniform vec3 u4Emis8; uniform vec3 u4MDiff; uniform vec3 u4MSpec0; uniform vec3 u4MSpec1;
         uniform sampler2D u4RR; uniform sampler2D u4FR; uniform sampler2D u4Ext; uniform float u4Opaque; uniform float u4Alt; uniform float u4Gen;
         ${enc}
         // a PICA LUT read for an absolute input: entry floor(x * 256) (at most 255) plus its delta times the fraction
         float s4Lut( sampler2D t, float x ){
           float i = clamp( x, 0.0, 1.0 ) * 256.0; float f = min( floor( i ), 255.0 );
           vec2 e = texelFetch( t, ivec2( int( f ), 0 ), 0 ).rg;
           return e.r + e.g * ( i - f );
         }
         // (light word 0-255 x material word, 256 = 1.0) >> 8, as the driver writes the register (0xbf9780)
         vec3 s4Reg( vec3 l8, vec3 m10 ){ return floor( l8 * m10 / 256.0 ) / 255.0; }
         void main() {`)
      .replace('#include <colorspace_fragment>',
        `if ( u4On > 0.5 || u4Gen > 0.5 ) {
           vec3 N = normalize( v4uN );
           vec3 V = normalize( v4uV );
           float fr = s4Lut( u4FR, abs( dot( N, V ) ) );
           vec3 emis = min( u4Emis8, vec3( 255.0 ) ) / 255.0;
           vec4 s4Pri, s4Sec, s4Vtx;
           if ( u4On > 0.5 ) {
             vec3 Lv = normalize( ( viewMatrix * vec4( u4LDir, 0.0 ) ).xyz );
             vec3 H = normalize( Lv + V );
             float NL = dot( N, Lv );
             float rr = s4Lut( u4RR, abs( dot( N, H ) ) );
             float hi = NL <= 0.0 ? 0.0 : 1.0;            // CONFIG0 clamp highlights
             vec3 pri = clamp( emis + s4Reg( u4LDiff8, u4MDiff ) * max( NL, 0.0 ), 0.0, 1.0 );
             vec3 sec = clamp( ( s4Reg( u4LSpec8, u4MSpec0 ) + s4Reg( u4LSpec8, u4MSpec1 ) * rr ) * hi, 0.0, 1.0 );
             s4Pri = vec4( pri, fr ); s4Sec = vec4( sec, fr );       // Fresnel selector 3: FR into both alphas
             vec3 dh = ( viewMatrix * vec4( u4HDir, 0.0 ) ).xyz;      // mDir rotated, not normalised (0x3a1fa0)
             s4Vtx = vec4( clamp( 0.375 * ( u4HC + u4HR ) + 0.25 * ( u4HC - u4HR ) * dot( N, dh ), 0.0, 1.0 ), 1.0 );
           } else {
             // THE GENERIC PATH'S GLOW TERMS: the same program with the game's lights taken out (no hemisphere vertex
             // colour, no light diffuse or specular). What is left is the material's own: the emission over the albedo
             // and the Fresnel table (a view angle, not a light) times Reflect. The viewer's lights do the rest.
             s4Pri = vec4( emis, fr ); s4Sec = vec4( vec3( 0.0 ), fr ); s4Vtx = vec4( vec3( 0.0 ), 1.0 );
           }
           #ifdef USE_MAP
             vec4 s4Alb = texture2D( map, vMapUv ); s4Alb.rgb = s4Enc( s4Alb.rgb );
           #else
             vec4 s4Alb = vec4( 0.0 );                   // an unbound texture unit samples black
           #endif
           #ifdef USE_MAP
             vec4 s4Ext = texture2D( u4Ext, vMapUv ); s4Ext.rgb = s4Enc( s4Ext.rgb );
           #else
             vec4 s4Ext = vec4( 0.0 );
           #endif
           vec4 s4Buf, s4Next, s4Prev;
           ${tev}
           if ( u4On > 0.5 ) gl_FragColor = vec4( s4Dec( s4Prev.rgb ), u4Opaque > 0.5 ? 1.0 : s4Prev.a );
           // the gauge's additive layer: the program's own output (its alpha is Reflect's, the pulse)
           else if ( u4Gen > 1.5 ) gl_FragColor = vec4( s4Dec( s4Prev.rgb ), s4Prev.a );
           // a glowing lit material: the glow terms added to the generic colour, clamped as the combiners clamp
           else gl_FragColor.rgb = s4Dec( min( s4Enc( gl_FragColor.rgb ) + s4Prev.rgb, vec3( 1.0 ) ) );
         }
         #include <colorspace_fragment>`);
  };
  const tags = (mat.userData.progTags || '') + '|u4p' + e.p + (glow ? 'g' + glow.red.p : '');
  mat.userData.progTags = tags;
  mat.customProgramCacheKey = () => tags;
  mat.needsUpdate = true;
  attached.add(mat);
  mat.addEventListener('dispose', () => { attached.delete(mat); playing.delete(mat); });
  if (mat.userData.maplessOverlay && ON.value) mat.visible = true;
  return true;
}

// fMaterialStdAlbedoColor: the game writes the unit's colour for the material's colour type into it (0x199598 ->
// 0x567b54) and the apply puts it in TEV stage 0's constant (step 1). rgb = [R, G, B] 0-255, or null for the
// material's own.
export function setAlbedoColour4u(mat, rgb){
  const s = mat && mat.userData && mat.userData.u4;
  if (!s) return;
  s.colour = rgb ? rgb.slice() : null;
  writeBase(mat);
}

// ---- the material's register state, and what writes over it --------------------------------------------------------
// `own` is the material as built; `glow` the Charge Blade's glow material while it is on (setGlow4u); the base is the
// one in force. Every frame the base is written, then the unit's colour, then the playing clips' tracks.
function ownState(e, k){
  return { k: k.map(v => v.clone()), c: e.c.slice(), rr: e.rr, fr: e.fr, alt: 0 };
}
function writeBase(mat){
  const s = mat.userData.u4, u = s.u, b = s.base;
  b.k.forEach((v, i) => u.u4K.value[i].copy(v));
  // fMaterialStdAlbedoColor (TEV 0's constant) takes the unit's colour for the material's colour type. The colour types
  // are written every frame (0xb0a2c0 runs the Rainbow through them), so the colour sits over a swapped-in glow CB too.
  if (s.colour) u.u4K.value[0].set(s.colour[0] / 255, s.colour[1] / 255, s.colour[2] / 255, b.k[0].w);
  u.u4Emis8.value.fromArray(unpack(b.c[1]));
  u.u4MDiff.value.fromArray(unpack(b.c[2]));
  u.u4MSpec0.value.fromArray(unpack(b.c[3]));
  u.u4MSpec1.value.fromArray(unpack(b.c[4]));
  u.u4RR.value = b.rr !== undefined ? lutTexture(b.rr) : null;
  u.u4FR.value = b.fr !== undefined ? lutTexture(b.fr) : null;
  u.u4Alt.value = b.alt;
}

// ---- material animation (the Charge Blade's clips; scripts/build_shading.py reads them) ------------------------------
// A track writes a CBMaterialStd member; the two the clips use reach the registers as the apply puts them (checked
// against the emulated apply on every key at build time): fMaterialStdEmission (float 0) -> the lighting emission word,
// min(x * 0.5, 1) * 255; fMaterialStdReflect (float 12) -> TEV stage 3's constant, min(x, 1) * 255 per byte. Keys are
// linear, the clip loops, and its frame runs at the engine's 60 units a second (the clip stepper itself is not read).
const FPS = 60;
const playing = new Set();
let clockFn = () => performance.now() / 1000;
const clock = () => clockFn();
export function setClock4u(fn){ clockFn = fn; }
function sample(keys, f){
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] <= f) i++;
  const a = keys[i], b = keys[i + 1] || a, span = b[0] - a[0];
  const t = span > 0 ? Math.min(1, Math.max(0, (f - a[0]) / span)) : 0;
  return [1, 2, 3, 4].map(k => a[k] + (b[k] - a[k]) * t);
}
const q8 = x => Math.trunc(Math.min(Math.max(x, 0), 1) * 255);
function writeClips(mat, tSec){
  const s = mat.userData.u4, u = s.u;
  for (const p of s.play){
    const f = ((tSec - p.t0) * FPS) % p.clip.n;
    for (const [off, keys] of p.clip.t){
      const v = sample(keys, f < 0 ? f + p.clip.n : f);
      if (off === 0) u.u4Emis8.value.set(Math.trunc(Math.min(v[0] * 0.5, 1) * 255), Math.trunc(Math.min(v[1] * 0.5, 1) * 255),
                                         Math.trunc(Math.min(v[2] * 0.5, 1) * 255));
      else if (off === 12) u.u4K.value[3].set(q8(v[0]) / 255, q8(v[1]) / 255, q8(v[2]) / 255, q8(v[3]) / 255);
    }
  }
}
// play clip `index` of the material's own clips (null: none) from `tSec` -- the gauge (0xb47f84) does this by index
export function playClip4u(mat, index, tSec){
  const s = mat && mat.userData && mat.userData.u4;
  if (!s) return;
  const clips = (s.glow ? s.glowClips : s.entry.clips) || [];
  s.play = index !== null && clips[index] ? [{ clip: clips[index], t0: tSec }] : [];
  writeBase(mat);
  if (s.play.length) playing.add(mat); else playing.delete(mat);
}
// THE SHIELD CHARGE'S GLOW (0xb06ce0): 'red' / 'yellow' / null. The material takes the glow material's tLutFresnel,
// tLutShininess and CBMaterialStd, keeps its own maps, re-runs the apply (the result is the glow's own state: checked on
// all 207 Charge Blade materials of colour types 0 and 3), and plays the glow's clips from frame 0 (0x637f2c).
export function setGlow4u(mat, colour, tSec){
  const s = mat && mat.userData && mat.userData.u4;
  if (!s || !s.hasGlow || (s.glow || null) === (colour || null)) return;
  s.glow = colour || null;
  if (colour){
    const g = DB.cbGlow[colour];
    s.base = { k: g.k.map(rgba), c: g.c.slice(), rr: g.rr, fr: g.fr, alt: 1 };
    s.glowClips = g.clips || [];
    s.play = s.glowClips.filter(c => c.f & 2).map(clip => ({ clip, t0: tSec }));
  } else {
    s.base = s.own; s.glowClips = null;
    s.play = (s.entry.clips || []).filter(c => c.f & 2).map(clip => ({ clip, t0: tSec }));
  }
  s.u.u4Gen.value = colour ? 1 : 0;
  writeBase(mat);
  if (s.play.length) playing.add(mat); else playing.delete(mat);
}
// THE GAUGE LAYER ON THE GENERIC PATH: drawn as its own program without the game's lights (on = it is the gauge material)
export function setGaugeLayer4u(mat, on){
  const s = mat && mat.userData && mat.userData.u4;
  if (s) s.u.u4Gen.value = on ? 2 : (s.glow ? 1 : 0);
}
// every frame: the playing clips over their materials' base state
export function step4u(tSec){
  for (const m of playing){ writeBase(m); writeClips(m, tSec); }
}
