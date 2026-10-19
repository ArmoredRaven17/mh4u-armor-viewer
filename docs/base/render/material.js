// The MHGU material: MeshStandardMaterial plus the onBeforeCompile pigment / matcap shader,
// driven by what the game's own material file (.mrl) says about each material, resolved
// through the shader package into docs/materials.json (Phase 3, 2026-09-03). The shader
// text, the uniform block and the pigment math are what the single script carried, kept
// verbatim; index.html writes `tint` and calls applyTint on armorMats when a pigment changes.
//
// What the ROM decides here, per material (spec.rom, from materials-db.js specFor):
//   blend state  BSSolid opaque; BSBlendAlpha transparent, no depth write, drawn after the
//                opaque parts; BSAddAlpha additive and unlit (the glow parts); BSRevSubAlpha
//                the same but reverse-subtracted, so it DARKENS instead (monsters only:
//                Khezu's blood, Old Fatalis' face_sub, Grimclaw Tigrex's angry_arm)
//   cull         RSMesh back -> front faces only; RSMeshCN -> both; RSMeshCF -> back faces
//   depth bias   RSMeshBiasN (-32 N) -> a constant polygon offset of that many depth units
//                toward the camera, no slope term (decal layers such as the Charge Blade 064
//                shield face and the Lecturer's Footwear cuff band). A slope-scaled offset
//                pushed the cuff band through the boot shell at grazing angles (Raven,
//                2026-09-03: "a little bit of the black material ... peek out"); the constant
//                offset at the ROM's value shows none.
//   alpha        the alpha TEST is bit 20 of the material's feature word (with FTransparency
//                Alpha): discard texels at or below fAlphaClipThreshold, 0.0 on every material
//                seen, so only the exact-zero holes go. The Alpha feature without that bit
//                (Nerscylla's mail, 2,819 materials) only feeds alpha to a blend state -- the
//                game draws them whole. AlphaConstant -> the constant transparency
//   albedo tint  fAlbedoColor x fDiffuseColor multiplies the map (greys 0.8..0.95 on some)
//   emission     fEmissionColor, as self-illumination proportional to the map
//   sphere map   FReflect SphereMap -> the tSphereMap binding, scaled by fReflectiveColor
//                (0 switches it off on 31 materials that carry the feature) and the gloss:
//                the map's alpha when tSpecularMap is the albedo, else the separate specular
//                map's luminance (a greyscale mask, alpha 1.0). GlobalCubeMap is the stage's
//                reflection, which the viewer has no stand-in for: no term
//   Fresnel      Schlick with fFresnelSchlickRGB as F0 (1.0 on 246 of 264 globals: no change)
//   pigment      flag 0x20 marks the dyeable region (the `_sym_` materials, 99% of them);
//                flag 0x40 without 0x20 is the colour-override class (skin, fur, face)
// Approximations kept from before: the studio lights, roughness .85 (lowered only where
// fShininess exceeds 16), and GGX for the lights' highlight where the ROM's FBRDF is Blinn-Phong. The sphere map is the
// ROM's combine since 2026-10-07 (ROM_SPHERE); the screen-blended matcap at envAmount is its switch-off.
import * as THREE from 'three';
import { installRomSpecular, trackRomSpecular } from './rom/specular.js';

// ---- pigment state -----------------------------------------------------------------------
// Owned here so every armour material reads one truth. The picker, the per-slot rows and the
// Deviant stepper in index.html write these and then re-apply the tint.
export const tint = {
  pigment: null,        // null = the armor's own colors, untinted
  useDefaults: false,   // apply each piece's OWN authored pigment instead of one global color
  // One pigment per equipment slot, which is how the game itself stores it:
  // cArmorColorBase is mHeadColorIndex / mTorsoColorIndex / mArmColorIndex /
  // mWaistColorIndex / mLegColorIndex -- five indices, one per piece.
  slotPigment: { helm:null, body:null, arm:null, wst:null, leg:null }
};

// MHGU dyes armor with a pigment. The _bm alpha channel is the mask: bright on the
// metal/cloth trim, dark on monster-part scales -- which matches what the game lets you
// dye. So tint by alpha rather than washing the whole piece.
// matcap strength: the slider is gone, the env contribution stays at this level
export const envAmount = 0.55;

// ---- registries --------------------------------------------------------------------------
// every material the viewer built (the wireframe toggle walks this)
export const allMats = [];
// pigment applies to ARMOUR only -- never the hunter's face or hair
export const armorMats = [];
// the dye-mask view's state (setDebug)
let dyeMaskOn = 0;
// THE SPHERE MAP AS THE ROM COMBINES IT -- ON (2026-10-07; Raven: "review each armor to ensure we are accurately rendering
// them"). FSpecularMap / FFinalCombiner add FReflectSphereMap INSIDE the specular:
//     MC.specular = ( lights * fSpecularColor + sample( tSphereMap, view normal ) * fReflectiveColor ) * specMap
//     out.rgb    += MC.specular * MC.fresnel
// where this path SCREENS the map over the finished colour, weighted by gloss squared and envAmount (an approximation tuned
// by eye so bright armour does not clip). On, the term is added beside the lights' specular, ahead of render/rom/specular.js's
// Fresnel and RGB map, and the screen is skipped; __romSphere(false) brings the old screen back to compare. The arithmetic
// runs on the renderer's linear values, as its lighting does, where the ROM's runs on the texels as stored.
export const ROM_SPHERE = { value: 1 };
// THE PIGMENT AS THE GAME APPLIES IT -- ON (2026-10-07; Raven: "Pigment however is in the game"). The armour pigment is
// colour channel 3 (0x0053a0e4 -> the material's vfunc +0x2c): it REPLACES fAlbedoColor of the dye-region material, a plain
// multiply of its texels. This path used to RECOLOUR by luminance instead (uTint x (0.30 + luma x 1.35)), chosen by eye
// because a multiply only darkens; setRomPigment(false) / __romPigment(false) brings that back to compare.
export const ROM_PIGMENT = { value: 1 };
export function setRomPigment(on){ ROM_PIGMENT.value = on ? 1 : 0; for (const m of armorMats) applyTint(m); return !!ROM_PIGMENT.value; }
export function setRomSphere(on){ ROM_SPHERE.value = on ? 1 : 0; return !!ROM_SPHERE.value; }
// A ROM COLOUR CONSTANT IN THE SPACE THIS RENDERER SHADES IN (Option A, 2026-10-15; Raven: "A, I noticed some colors were
// off with things like pigment and I want things to be more accurate to in game"). The game's model pass works in GAMMA
// space: texels as stored, every colour constant raw, nothing encoded (sRender.mSRGBEnable = 0, 0xbb9dfc; FAlbedoMap =
// tex.rgb * fAlbedoColor -- the Monster Viewer's dev/model-pass-colour-space.md). This renderer DECODES each texel to linear
// and ENCODES the output, so the game's product t x k comes out only if the constant is decoded the same way:
// encode(decode(t) x decode(k)) = t x k. Written raw, a 0.2 tint showed as ~0.48. 0 and 1 are unchanged. The curve is
// three.js's own SRGBToLinear, so it equals setRGB(..., SRGBColorSpace). NOT decoded, on purpose: the sphere-map screen's
// weights (uReflTint, uEnvAmt) and the reflection overlay's uRefl, whose shaders already work in display values.
export function romLinear(c){
  if (!THREE.ColorManagement.enabled) return c;
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}
function romLinear3(v){ const g = v[1] === undefined ? v[0] : v[1], b = v[2] === undefined ? v[0] : v[2]; return [romLinear(v[0]), romLinear(g), romLinear(b)]; }
// the reflective colour ADDED into the linear specular (the ROM sphere path): decoded
function setReflRaw(m, rgb){ const u = m.userData.u; if (u && u.uReflRaw) u.uReflRaw.value.fromArray(romLinear3(rgb)); }

// ---- the ROM's render states ---------------------------------------------------------------
// The rasterizer's cull mode. RSMesh culls BACK faces, so the front faces render: FrontSide.
const SIDE = { back: THREE.FrontSide, none: THREE.DoubleSide, front: THREE.BackSide };
// The game discards a <= fAlphaClipThreshold; three.js discards a < alphaTest, so the
// threshold moves up by less than one 8-bit step: exactly the zero texels go.
const ALPHA_EPS = 1 / 512;
// Raven's comparison knob: null = the ROM threshold on every cutout material, a number
// forces that threshold on all of them (0.5 was the old hunter rule)
let alphaOverride = null;
// The ROM's depth bias (RSMeshBiasN, -32 a step) is in depth-buffer units, whose real size
// depends on the projection: with this viewer's near plane a unit at the model is far larger
// than in the game, so the Shadow Shades (bias -512) drew their arms through the head once
// the camera backed off (Raven, 2026-09-03: "the part that should be hidden by the head
// model is visible"). The page re-expresses a step as a fixed push in metres each frame
// (setBiasUnitsPerStep, from the camera distance and near plane); until it does, a step is
// the raw 32 units.
const biasMats = new Set();
let biasUnitsPerStep = 32;
// RSMeshBiasN pulls a layer toward the camera. Every path that builds a material has to apply it,
// so it lives here rather than being repeated: the additive and reverse-subtract branches returned
// before the copy that used to sit further down, which silently dropped the bias on EVERY additive
// material that carries one. Counted 2026-09-06: 72 of the monsters' 78 add/revsub materials, and
// 375 of the 970 additive armour and weapon materials -- so this is NOT monster-only and it does
// change what this app draws (m680's _add_ layers, m576_helm's bma01, o072's symadd00, and 372
// more). Those are decal layers meant to sit ON the surface; with no bias they z-fight it.
// Raven, 2026-09-06, on Savage Deviljho's groups 0/3/12/100: "we need to be better able to render
// these", and "we don't 'decide' how, we let the ROM tell us how the game does it" -- the ROM says
// bias -512 on that group's XfB__m02_body_k, so it gets bias -512.
// DEPTH WRITE, FROM THE ROM'S OWN DEPTH-STENCIL STATE. The Monster Viewer's rule, brought back
// (Raven, 2026-09-27: "update the armor viewer with the lessons learned"). Every blended and
// additive material here was forced to write no depth, which is the safe guess but not what the
// state record says: DSZTestWrite writes, DSZTest only tests. Counted over this app's own data,
// 442 armour and weapon materials carry a WRITING state and were letting everything draw through
// them. Unrecognised names fall back to the old blend-derived guess rather than inventing one.
function romDepthWrite(st, fallback){
  const ds = st && st.ds;
  if (!ds) return fallback;
  if (ds === 'DSZTestWrite' || ds === 'DSZTestWriteStencilWrite') return true;
  if (ds === 'DSZTest' || ds === 'DSZTestStencilWrite') return false;
  return fallback;
}
// THE OVERLAY'S COLOUR AND ALPHA. The additive and reverse-subtract branches build a
// MeshBasicMaterial and return before the lit path's colour work, so three ROM terms never reached
// them; this holds all three in one place so the two branches cannot drift apart.
//
//   1. THE ALBEDO TINT, fAlbedoColor. The lit and unlit paths apply it; add/revsub did not.
//   2. fConstantColor, where the feature word asks for it: FAlbedoMapConstant means the albedo is
//      the map MULTIPLIED BY fConstantColor, whose base value is glob.constant -- the same float4
//      the material animation's fConstantColor track writes. Its ALPHA counts too, and a constant
//      alpha of 0 means invisible at rest until a clip ramps it up.
//   3. THE ALPHA TEST for feat.transp === 'Alpha' with the material's alphaTest bit; those
//      overlays were drawing their cut texels.
//
// AND THE TRANSPARENCY FEATURE THE RIGHT WAY ROUND. FTransparencyAlpha is
// `mc.Alpha * CBMaterial.fTransparency`; FTransparencyAlphaConstant is `mc.Alpha` ALONE -- the
// ROM's own doc string for it is "just returns the transparency" and it references no constant
// buffer. This app had it inverted (it applied cbm.transparency under AlphaConstant and never
// under Alpha), which drew at full strength the layers the ROM starts faint.
//
// NOT applied, deliberately: fEmissionColor. MeshBasicMaterial has no emissive term and an
// additive pass is already a sum, so there is nowhere faithful to put it. An explicit gap.
function romOverlayShade(mat, rom){
  const ft = rom && rom.feat, cb = rom && rom.cbm, gl = rom && rom.glob;
  if (gl){
    const k = (ft && ft.albedo === 'MapConstant' && gl.constant) ? gl.constant : [1, 1, 1, 1];
    mat.color.setRGB(gl.albedo[0] * k[0], gl.albedo[1] * k[1], gl.albedo[2] * k[2], THREE.SRGBColorSpace);   // decoded (romLinear)
  }
  let a = 1;
  if (cb && ft && ft.transp === 'Alpha') a *= cb.transparency;
  if (ft && ft.albedo === 'MapConstant' && gl && gl.constant) a *= gl.constant[3];
  if (a !== 1) mat.opacity = a;
  if (ft && ft.transp === 'Alpha' && rom.alphaTest)
    mat.alphaTest = Math.max(0, gl ? gl.clip : 0) + ALPHA_EPS;
  return mat;
}
function applyRomBias(mat, st){
  if (!(st && st.bias)) return mat;
  mat.polygonOffset = true; mat.polygonOffsetFactor = 0;   // constant only: a slope term put a
  mat.userData.romBias = st.bias;                          // black sliver on the Lecturer's boots
  mat.polygonOffsetUnits = st.bias / 32 * biasUnitsPerStep;
  biasMats.add(mat);
  mat.addEventListener('dispose', () => biasMats.delete(mat));
  return mat;
}
export function setBiasUnitsPerStep(v){
  if (!(v > 0) || Math.abs(v - biasUnitsPerStep) < biasUnitsPerStep * 0.05) return false;
  biasUnitsPerStep = v;
  for (const m of biasMats) m.polygonOffsetUnits = m.userData.romBias / 32 * v;
  return true;
}
export function setAlphaOverride(v){
  alphaOverride = (v === null || v === undefined || v === '') ? null : +v;
  for (const m of allMats) if (m.userData.cutout) m.alphaTest = alphaOverride === null ? m.userData.romCut : alphaOverride;
  return alphaOverride;
}

// THE REFLECTION OVERLAY: the additive layer a weapon's own state lights -- the Sword & Shield's oils and the Long Sword's
// Spirit Gauge on colour channel 2 (render/weapon-state.js), 123 + 123 models, and the Dual Blades' 242 -- drawn with the
// game's own formula, not the albedo. PS_MaterialStd, as efx/shader/glsl.py translates it for these materials
// (one134.mrl, ken122.mrl; 2026-09-30):
//   colour = albedo x FDiffuse + FSpecularMap x FFresnel, alpha = vertex alpha x FTransparencyAlpha, blended BSAddAlpha
//   FDiffuse        = (light + FAmbient) x CBMaterial.fDiffuseColor -- (0, 0, 0) on 245 of the 246, so NOTHING
//   FSpecularMap    = ((light specular x $Globals.fSpecularColor) + FReflect) x tSpecularMap.rgb x occlusion
//   FReflectSphereMap = tSphereMap(uv) x CBMaterial.fReflectiveColor, uv = normalize(View x normal).xy x 0.5 + 0.5, v flipped
//   FFresnelSchlick = fFresnelSchlick + (1 - it) x (1 - N.V)^5, and fFresnelSchlick is 1.0: no term
//   FTransparencyAlpha = transparency x CBMaterial.fTransparency; FAlbedoMap (not ColorOnly) first multiplies the
//                    transparency by the albedo map's alpha
// So what shows is the SPHERE MAP TINTED BY fReflectiveColor -- the colour the oils write (0x53a254) and the Spirit clips
// animate -- faded by fTransparency. The old additive path drew the albedo map instead, which the ROM multiplies by zero,
// and hid the layers that bind no albedo (the Sword & Shield's): both wrong for these.
//   UNBOUND TEXTURES: none of these layers binds tSpecularMap, and 120 Sword & Shield layers bind no albedo either. Read
// as black, the spec map would zero the only term there is and no oil or Spirit level could ever show, which the game's
// own authoring (a sphere map, a colour, an animated fade on a layer that is otherwise nothing) rules out: they read as
// white here, the albedo's alpha as 1.
//   NOT DRAWN, deliberately: the lights' specular term (x fSpecularColor, which the Spirit clips colour; the viewer's lights
// are a studio stand-in) and the albedo term of the one layer whose fDiffuseColor is not zero (the Sword & Shield 151).
// fUVTransform2 is the second UV set, which the sphere lookup does not read.
// The arithmetic runs on the texel as the file holds it (the sRGB-encoded value) and is decoded again, as the lit path's
// sheen is: the ROM's colour constants act on its texture values.
// THE CHARGE BLADE'S PHIAL LAYER is the same layer on channel 30 (2026-10-03; Raven: "it does not show the phial color on
// the weapon"): `m30_gaxeNNN_add_`, additive, a sphere map, fDiffuseColor (0, 0, 0), no specular or emission -- and its two
// clips, "red" and "yellow", drive fReflectiveColor and fTransparency, which the albedo path drew as a white fade. The
// sword's part code picks the clip by the Charge Gauge (render/weapon-state.js cbPhialTriggers). Only the Charge Blade's:
// the Switch Axe's and the Hammer's channel-30 layers are drawn as before (the board).
const CB_PHIAL = /_gaxe\d+_/;
function isReflectOverlay(rom, name){
  if (!(rom && rom.feat && rom.feat.reflect === 'SphereMap' && rom.sphere && rom.cbm)) return false;
  if (rom.ch === 2) return true;
  const d = rom.cbm.diffuse;
  return rom.ch === 30 && CB_PHIAL.test(name || '') && !!d && !(d[0] || d[1] || d[2]);
}
const OVERLAY_VS = `
#include <common>
#include <skinning_pars_vertex>
attribute vec4 color;
varying vec3 vOvNormal;
varying float vOvAlpha;
varying vec2 vOvUv;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vOvNormal = transformedNormal;
  vOvAlpha = color.a;       // COLOR_0's alpha where the mesh has one (the Long Sword's fade at the blade's ends), else 1
  vOvUv = uv;
}`;
const OVERLAY_FS_SRGB = `
uniform sampler2D uSphere; uniform float uSphereOn;
uniform sampler2D uAlb; uniform float uAlbOn; uniform float uAlbView;
uniform vec3 uRefl; uniform float uTransp;
varying vec3 vOvNormal; varying float vOvAlpha; varying vec2 vOvUv;
//OV_PAIR
void main() {
  vec3 n = normalize( vOvNormal );
  #ifdef DOUBLE_SIDED
    if ( ! gl_FrontFacing ) n = - n;
  #endif
  vec2 suv = n.xy * 0.5 + 0.5;
  suv.y = 1.0 - suv.y;
  vec3 raw = uSphereOn > 0.5 ? ovOetf( texture2D( uSphere, suv ).rgb ) : vec3( 0.0 );
  float a = vOvAlpha * uTransp;
  if ( uAlbOn > 0.5 ) a *= texture2D( uAlb, uAlbView > 0.5 ? suv : vOvUv ).a;
  gl_FragColor = vec4( ovEotf( raw * uRefl ), clamp( a, 0.0, 1.0 ) );
  #include <colorspace_fragment>
}`;
// the overlay's encode / decode pair: the identity with colour management off (?space=game), as the main shader's
function overlayFs(){
  const pair = THREE.ColorManagement.enabled
    ? 'vec3 ovOetf( vec3 c ){ c = max( c, vec3( 0.0 ) ); return mix( pow( c, vec3( 1.0 / 2.4 ) ) * 1.055 - 0.055, c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) ); }\n' +
      'vec3 ovEotf( vec3 c ){ c = max( c, vec3( 0.0 ) ); return mix( pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), c / 12.92, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) ); }'
    : 'vec3 ovOetf( vec3 c ){ return max( c, vec3( 0.0 ) ); }\nvec3 ovEotf( vec3 c ){ return max( c, vec3( 0.0 ) ); }';
  return OVERLAY_FS_SRGB.replace('//OV_PAIR', pair);
}
function createReflectOverlay(spec, rom, st, side){
  const ft = rom.feat, cb = rom.cbm;
  const ov = {
    uSphere: { value: null }, uSphereOn: { value: 0 },
    uAlb: { value: null }, uAlbOn: { value: 0 }, uAlbView: { value: ft.uvAlbedoMap === 'UVViewNormal' ? 1 : 0 },
    uRefl: { value: new THREE.Vector3().fromArray(cb.reflective) },
    uTransp: { value: ft.transp === 'Alpha' ? cb.transparency : 1 },
  };
  // BSAddAlpha on the colour: dst + src x srcAlpha. The DESTINATION ALPHA is left as it is: the game never shows its
  // framebuffer's alpha, and this canvas is composited over the page by it -- three's AdditiveBlending adds srcAlpha^2
  // there too, so the sphere map's black rim, which adds no colour, laid a dark veil over the floor grid behind the blade.
  const mat = new THREE.ShaderMaterial({ name: spec.srcName, uniforms: ov, vertexShader: OVERLAY_VS, fragmentShader: overlayFs(),
                                         side, transparent: true, blending: THREE.CustomBlending,
                                         blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
                                         blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
                                         depthWrite: romDepthWrite(st, false), wireframe: !!spec.wire });
  mat.userData.ov = ov;
  mat.userData.rom = rom; mat.userData.unlit = true; mat.userData.noTint = true;
  mat.userData.renderOrder = 20;
  return applyRomBias(mat, st);
}
// the overlay's albedo, once loaded: only its alpha counts, and only under FAlbedoMap
export function setOverlayAlbedo(mat, t){
  const ov = mat.userData.ov, ft = mat.userData.rom && mat.userData.rom.feat;
  if (!ov) return false;
  ov.uAlb.value = t; ov.uAlbOn.value = (t && ft && ft.albedo === 'Map') ? 1 : 0;
  return true;
}

export function applyTint(mat){
  // Own the uniform OBJECTS up front and hand the same ones to onBeforeCompile, so
  // changing pigment or sheen is just a .value write -- no recompile.
  if (!mat.userData.u){
    mat.userData.u = {
      uTint: { value: new THREE.Color(1,1,1) },
      uAmt:  { value: 0 },
      uEnv:  { value: null },
      uEnvAmt: { value: 0 },
      // fReflectiveColor's HUE on the sphere map, as a multiplier of the scalar weight above: (1, 1, 1), the lit path's
      // long-standing average, everywhere except under a part's material override (setMaterialOverride), which draws the
      // ROM's colour as it is -- the Lance's Healing Shield pulses the shield's reflection green. (17 CBMaterial records
      // and 654 clip tracks carry a non-grey reflective colour elsewhere and are still averaged: a separate matter.)
      uReflTint: { value: new THREE.Vector3(1, 1, 1) },
      uReflRaw: { value: new THREE.Vector3(1, 1, 1) },   // fReflectiveColor as it is (ROM_SPHERE)
      uRomSphere: ROM_SPHERE,
      uDbg: { value: dyeMaskOn },     // the dye-mask view: on for a material built while it is shown
      uKey: { value: new THREE.Color(1,1,1) },          // the armor's AUTHORED color
      uHasKey: { value: 0 },
      uKeyTol: { value: 0.15 },
      uSatBoost: { value: 1.0 },   // debug: exaggerate color so neutral areas stand out
      // Cut at the VALLEY between the two populations, not inside one of them.
      // An armour texture is bimodal in saturation: the neutral (dyeable) lobe runs
      // 0..~0.45 and the coloured armour sits at 0.5+, with a clear trough between.
      // The old 0.06-0.30 window ended mid-lobe, so it selected the whitest part of a
      // dyeable band and dropped the rest -- "correct area, but not the full area".
      uSat: { value: new THREE.Vector2(0.20, 0.45) },   // saturation window
      uVal: { value: new THREE.Vector2(0.15, 0.35) },   // brightness gate
      uChar: { value: new THREE.Color(1,1,1) },  // hair / eye / skin color
      uCharAmt: { value: 0 },
      uRegion: { value: 0 },  // 1 on the material that IS the dyeable region
      // 1 where the texture's ALPHA is a real cutout and must reach alphaTest.
      //
      // This shader replaces <map_fragment> wholesale, and the replacement only ever
      // multiplied diffuseColor.RGB -- so the sampled alpha was dropped on the floor and
      // `alphaTest` compared against a diffuseColor.a that was always 1. Nothing was ever
      // discarded. It shows up on the Palico's eyes, whose quads are deliberately
      // oversized so one mesh covers every eye option: the surround is authored fully
      // transparent (92-95% of those texels sit at alpha exactly 0) and was drawing solid.
      //
      // Opt-IN: on most armour the `_bm` alpha is a GLOSS ramp, not opacity. The ROM's
      // FTransparency feature is what turns it on now (createMaterial), the name prefix
      // only where the database has no entry.
      uAlphaCut: { value: 0 },
      // the separate specular map (tSpecularMap when it is not the albedo): its luminance
      // is the gloss that scales the sphere map
      uSpec: { value: null },
      uSpecOn: { value: 0 },
      // fSpecularColor, $Globals float3 @44 -- the specular lobe's own colour and intensity, read
      // by no code until now. Of the 24,062 material instances that take the LIT path here, 5,056
      // ship exactly ZERO (matte in the ROM, shiny on screen), 18,799 ship something else -- 0.4
      // on most of them -- and only 207 ship the 1.0 they were all effectively drawn with.
      uSpecRGB: { value: new THREE.Vector3(1, 1, 1) },
      // An iris mask for the character colour, sampled at the albedo UV: 1 on the iris, 0 on
      // everything else. Off, the tint covers the whole material as it always has, which is
      // right for skin, hair and fur. On, only the iris takes the eye colour -- the hunter's
      // eye texture paints sclera, pupil, glint and lids into the same material, and the old
      // whole-material tint coloured the white of the eye hardest (Raven, 2026-09-14).
      uIris: { value: null },
      uIrisOn: { value: 0 },
      // the albedo sampled by the view-space normal (uvAlbedoMap UVViewNormal, the glow
      // materials) instead of the mesh's UVs
      uViewUv: { value: 0 },
      // Schlick's F0 for the sphere map (fFresnelSchlickRGB)
      uF0: { value: new THREE.Vector3(1, 1, 1) },
      // 0..1: how far the dye region (and the material's glow) is pulled toward black.
      // The Esurient animation drives it (setRegionDark); nothing else touches it.
      uDark: { value: 0 },
      // The game's colour for this material's CHANNEL (setChannelColor), white when it has
      // none. It multiplies the texel, so it reaches the lit colour and the glow alike.
      uChan: { value: new THREE.Color(1,1,1) }
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, mat.userData.u);
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {',
                 'uniform vec3 uTint; uniform float uAmt;' +
                 ' uniform sampler2D uEnv; uniform float uEnvAmt; uniform vec3 uReflTint; uniform float uDbg; uniform vec3 uReflRaw; uniform float uRomSphere;' +
                 ' uniform vec2 uSat; uniform vec2 uVal;' +
                 ' uniform vec3 uKey; uniform float uHasKey; uniform float uKeyTol;' +
                 ' uniform float uSatBoost;' +
                 ' uniform vec3 uChar; uniform float uCharAmt; uniform float uRegion;' +
                 ' uniform float uAlphaCut;' +
                 ' uniform sampler2D uSpec; uniform float uSpecOn; uniform float uViewUv; uniform vec3 uF0;' +
                 ' uniform vec3 uSpecRGB;' +
                 ' uniform sampler2D uIris; uniform float uIrisOn;' +
                 ' uniform float uDark; uniform vec3 uChan;' +
                 ' float gGloss = 0.0; vec3 gBase = vec3( 1.0 );' +
                 // With colour management OFF (the Monster Viewer's opt-in ?space=game, render/colour-space.js: the game's gamma
                 // space, no output encode) the fragment colour already IS the display value, so the pair is the identity there
                 (THREE.ColorManagement.enabled
                   ? ' vec3 viewSrgbOetf( vec3 c ){ c = max( c, vec3( 0.0 ) ); return mix( pow( c, vec3( 1.0 / 2.4 ) ) * 1.055 - 0.055, c * 12.92, vec3( lessThanEqual( c, vec3( 0.0031308 ) ) ) ); }' +
                     ' vec3 viewSrgbEotf( vec3 c ){ c = max( c, vec3( 0.0 ) ); return mix( pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), c / 12.92, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) ); }'
                   : ' vec3 viewSrgbOetf( vec3 c ){ return max( c, vec3( 0.0 ) ); }' +
                     ' vec3 viewSrgbEotf( vec3 c ){ return max( c, vec3( 0.0 ) ); }') +
                 ' void main() {')
        // THE SPECULAR MAP REACHED ONLY THE MATERIALS THAT ALSO BIND A SPHERE MAP, and
        // fSpecularColor reached nothing at all. gGloss is computed in map_fragment and was used
        // ONLY inside `if ( uEnvAmt > 0.0 )`, which needs a sphere map -- so on every lit material
        // without one the specular mask was discarded. A specular MAP is a mask on the specular
        // LOBE, so that is where it goes: both accumulators are scaled by it, which is the term
        // the ROM is masking. fSpecularColor ($Globals float3 @44) scales the same lobe.
        // The Monster Viewer's, brought back (Raven, 2026-09-27).
        .replace('#include <lights_fragment_end>',
          `#include <lights_fragment_end>
           {
             float specMask = ( uSpecOn > 0.5 || gGloss > 0.0 ) ? gGloss : 1.0;
             reflectedLight.directSpecular   *= uSpecRGB * specMask;
             reflectedLight.indirectSpecular *= uSpecRGB * specMask;
           }`)
        .replace('#include <map_fragment>',
          `#ifdef USE_MAP
             vec2 mapUv = vMapUv;
             if ( uViewUv > 0.5 ) { vec3 vnm = normalize( vNormal ); mapUv = vnm.xy * 0.5 + 0.5; }
             vec4 texel = texture2D( map, mapUv );
             // the gloss that scales the sphere map: the map's own alpha, or the separate
             // specular map's luminance where the material binds one
             gGloss = uSpecOn > 0.5 ? dot( texture2D( uSpec, vMapUv ).rgb, vec3( 0.299, 0.587, 0.114 ) ) : texel.a;
             // MHGU authors the dyeable part of a texture as DESATURATED white/grey so a
             // pigment can be multiplied into it -- undyed, those areas read as the white
             // sashes and boots you see. So the mask is low saturation, not the alpha:
             // colorful areas (monster hide, painted trim) keep their own color, and
             // near-black is skipped so shadowed cloth does not light up.
             float mxC = max( texel.r, max( texel.g, texel.b ) );
             float mnC = min( texel.r, min( texel.g, texel.b ) );
             float sat = mxC > 0.0 ? ( mxC - mnC ) / mxC : 0.0;
             // THE REGION IS THE MATERIAL. Rendering the Yukumo kasa with one hue per
             // material shows the _sym_ material is exactly the band that dyes -- the
             // texel heuristics were approximating a shape the model already states
             // outright, which is why they always caught "the right area but not all of
             // it". uRegion is 1 only on that material (the ROM's flag 0x20 now).
             //
             // The saturation window is kept as a fallback for the handful of pieces
             // whose dye area is not a separate material.
             float dye = uRegion > 0.5 ? 1.0
                       : ( 1.0 - smoothstep( uSat.x, uSat.y, sat ) )
                         * smoothstep( uVal.x, uVal.y, mxC ) * 0.0;
             float luma = dot( texel.rgb, vec3(0.299, 0.587, 0.114) );
             if ( uDbg > 0.5 ) {
               // magenta = what the mask selects, greyscale = left alone
               diffuseColor.rgb *= mix( vec3(luma * 0.55), vec3(1.0, 0.0, 0.85), dye );
             } else {
               // A plain multiply can only DARKEN, so a dark piece barely moves when
               // dyed -- Astalos reads as unchanged -- while in game it visibly takes the
               // colour. Recolour by luminance instead, the same treatment the hair and
               // skin tints use, so the pigment's hue survives on dark armour while the
               // weave and shading still come through the luma term.
               vec3 dyed = uTint * ( 0.30 + luma * 1.35 );
               vec3 base = mix( texel.rgb, dyed, uAmt * dye );
               // Debug: push saturation so COLOURED areas go vivid and the neutral
               // (dyeable) ones stay grey -- greying the rest out, as the mask view does,
               // makes those two indistinguishable.
               base = clamp( vec3(luma) + ( base - vec3(luma) ) * uSatBoost, 0.0, 1.0 );
             // Hair / eye / skin color. Recolor by LUMINANCE rather than multiplying:
             // a multiply can only ever darken, so a dark brown hair texture could never
             // reach blonde. Scaling the chosen color by luma (x2, so mid-grey lands on
             // the color itself) keeps the strand and shading detail while actually
             // changing the hue.
             if ( uCharAmt > 0.0 ) {
               float irisW = uIrisOn > 0.5 ? texture2D( uIris, vMapUv ).r : 1.0;
               base = mix( base, uChar * luma * 2.0, uCharAmt * irisW );
             }
               // the channel colour stands in for fAlbedoColor, a plain multiply (setChannelColor)
               base *= uChan;
               gBase = base;           // the dyed albedo, for the glow below
               diffuseColor.rgb *= base;
             }
             // the region fades toward black by uDark (the Esurient animation); on a region
             // material dye is 1 everywhere, so the whole material goes with it
             diffuseColor.rgb *= 1.0 - uDark * dye;
             // hand the sampled alpha to alphaTest / blending where the map is a real cutout
             diffuseColor.a *= mix( 1.0, texel.a, uAlphaCut );
           #endif`)
        // The glow is the emission constant times the DYED albedo, not the raw map. With the
        // raw map the dye region -- authored whitish so a pigment can be multiplied in --
        // glowed grey over whatever pigment was on it and washed it out (Raven, 2026-09-04:
        // "The female Esurient armors seem to wash out the pigment"; green read as
        // (119,162,114) with the glow and (15,117,16) without). Undyed materials are
        // unchanged: gBase is then the map texel, which is what the stock chunk sampled.
        // And the glow goes to black with the region.
        .replace('#include <emissivemap_fragment>',
          `#ifdef USE_EMISSIVEMAP
             totalEmissiveRadiance *= gBase;
           #endif
           totalEmissiveRadiance *= 1.0 - uDark;
           // the dye-mask view greys the glow too: no colour but the mask's magenta
           if ( uDbg > 0.5 ) totalEmissiveRadiance = vec3( dot( totalEmissiveRadiance, vec3( 0.299, 0.587, 0.114 ) ) * 0.55 );`)
        // MHGU shades armor with a 64x64 spherical env map (a matcap) scaled by gloss.
        // Sample it with the view-space normal and screen it over the lit colour. The screen
        // has always run on the sRGB-ENCODED colour -- it sat after <colorspace_fragment>,
        // on the canvas -- so it runs here on an explicit encode and is decoded again: the
        // same pixels on the canvas, and right in a linear render target too, where three's
        // own <colorspace_fragment> is the identity (Raven, 2026-09-04: post-processing).
        .replace('#include <colorspace_fragment>',
          `if ( uEnvAmt > 0.0 && uRomSphere < 0.5 ) {
             vec3 vn = normalize( normal );
             vec2 muv = vn.xy * 0.5 + 0.5;
             vec3 env = texture2D( uEnv, muv ).rgb;
             // gloss^2 biases the sheen toward genuinely reflective texels: ~400 pieces
             // have a near-solid gloss mask and a linear term washes them out.
             float g = gGloss * gGloss;
             // Schlick: F0 + (1 - F0)(1 - N.V)^5, with F0 = fFresnelSchlickRGB (1.0 on nearly
             // every material, which leaves the term at 1)
             vec3 fres = uF0 + ( vec3( 1.0 ) - uF0 ) * pow( 1.0 - clamp( vn.z, 0.0, 1.0 ), 5.0 );
             // SCREEN blend, not additive -- a + b*(1-a) cannot exceed 1, so bright
             // armor keeps its detail instead of clipping to white.
             vec3 enc = viewSrgbOetf( gl_FragColor.rgb );
             enc += env * uReflTint * g * uEnvAmt * fres * ( 1.0 - enc );
             gl_FragColor.rgb = viewSrgbEotf( enc );
           }
           #include <colorspace_fragment>`);
    };
    mat.needsUpdate = true;
  }
  const u = mat.userData.u;
  // the dye region is the ARMOUR pigment's: a material the pigment never reaches (the face, the hair -- whose ROM flag
  // marks the hair colour's region -- the weapon) is no dye region, so the dye-mask view greys it
  u.uRegion.value = mat.userData.dyeRegion && !mat.userData.noTint ? 1 : 0;
  const own = tint.useDefaults && mat.userData.own ? mat.userData.own.rgb : null;
  const slotCol = tint.slotPigment[mat.userData.slot] || null;
  const use = own || slotCol || (tint.useDefaults ? null : tint.pigment);
  const key = mat.userData.own;                 // authored color = the region key
  u.uHasKey.value = key ? 1 : 0;
  if (key) u.uKey.value.setRGB(key.rgb[0]/255, key.rgb[1]/255, key.rgb[2]/255);
  const region = mat.userData.dyeRegion && !mat.userData.noTint;
  if (ROM_PIGMENT.value){
    // THE GAME'S PIGMENT: the colour goes over fAlbedoColor of the dye region (channel 3) and multiplies its texels
    // (setChannelColor, the same write the weapons' and the Kinsect's colours take). No pigment: the texels as they are.
    u.uAmt.value = 0;
    if (region) setChannelColor(mat, use || null);
  } else if (use && !mat.userData.noTint){
    if (region && mat.userData.chanRgb) setChannelColor(mat, null);
    u.uTint.value.setRGB(use[0]/255, use[1]/255, use[2]/255, THREE.SRGBColorSpace);   // game bytes, as setChannelColor takes
    u.uAmt.value = 1;
  } else {
    if (region && mat.userData.chanRgb) setChannelColor(mat, null);
    u.uAmt.value = 0;
  }
  u.uEnvAmt.value = envStrength(mat);
}
export const setTint = applyTint;

// How far a material's dye region and glow sit toward black, 0 (its colour) to 1 (black).
// Written every frame by the Esurient animation in index.html.
export function setRegionDark(mat, k){
  const u = mat.userData.u;
  if (u) u.uDark.value = k;
}

// The sphere map's weight: nothing without a map; with the ROM's material, the reflective
// colour scales it (fReflectiveColor); without one, the old rule -- an env token in the name.
function envStrength(mat){
  const u = mat.userData.u;
  if (!u.uEnv.value) return 0;
  if (mat.userData.rom) return envAmount * (mat.userData.reflective === undefined ? 1 : mat.userData.reflective);
  return /env/i.test(mat.name || '') ? envAmount : 0;
}

// The one material every mesh gets -- armour, character parts, Palico and weapons all take
// this path. `spec`:
//   srcName    the glTF material name (kept as mat.name)
//   rom        the material's entry from materials.json (materials-db.js specFor), or null
//              for the exporter's placeholders; decides everything listed at the top
//   alphaCut   fallback alphaTest threshold when there is no rom entry (0 = no cutout)
//   noTint     never takes the armour pigment
//   tintClass  'skin' | 'hair' | 'eye' | 'fur' | 'oeye' -- takes the character colour instead
//   dyeRegion  fallback: 1 on the `_sym_` material when there is no rom entry
//   slot       the pigment row this material reads ('helm'..'leg', 'cloth', 'ohelm', 'obody')
//   own        the piece's authored default pigment ({i, hex, rgb}) or null
//   wire       the wireframe toggle's current state
//   unlit      OPT-IN: draw this material unlit (the map as the colour), honouring the ROM's
//              cull mode and blend state. The MRL's class is nDraw::MaterialConstant or
//              MaterialConstantFog on 325 hunter/weapon materials as well as the monsters'
//              eyes, but this app has always drawn those through the lit path, and switching
//              them wholesale would change armour that Raven has already reviewed. So the
//              CALLER opts in (render/monster.js does; nothing in the Armor Viewer does).
// The result carries userData.renderOrder (10 blended, 20 additive) for the mesh, and
// userData.emissiveFromMap when the caller should hand the loaded map to emissiveMap too.
export function createMaterial(spec){
  const rom = spec.rom || null;
  const st = rom && rom.state, ft = rom && rom.feat, cb = rom && rom.cbm, gl = rom && rom.glob;
  const side = (st && st.cull in SIDE) ? SIDE[st.cull] : THREE.DoubleSide;   // FrontSide is 0: no || here
  if (st && st.blend === 'add' && isReflectOverlay(rom, spec.srcName)) return createReflectOverlay(spec, rom, st, side);
  if (st && st.blend === 'add'){
    // Additive materials are the glow parts, drawn unlit and added over what is behind:
    // the Charge Blade's phial box (part 24, XfB_0__m30_gaxe064_add_) is a 12-vertex box
    // whose texel is black, so it adds nothing until its material animation lights it
    // (triggers 28/29). Lit and opaque it was the "black mass" on the drawn sword, and lit
    // with the matcap it still left a grey box (Raven, 2026-09-03). No matcap, no lights.
    // An additive material that binds NO albedo map (the Sword & Shield 134 "one134_add_"
    // binds only a sphere map) draws nothing here: the game samples an unbound albedo as
    // black, so the overlay adds nothing until a material animation lights it -- the same
    // story as the Charge Blade's phial box. Drawn unlit and mapless it was a flat white
    // shield and a white blade; the Phase 2 fallback (the table's first map, added over
    // itself) doubled the blade's brightness instead. Its sphere map is kept on userData
    // for the day the material animations are read.
    const mat = new THREE.MeshBasicMaterial({ name: spec.srcName, side, blending: THREE.AdditiveBlending,
                                              transparent: true, depthWrite: romDepthWrite(st, false),
                                              wireframe: !!spec.wire });
    if (rom && !rom.albedo){ mat.visible = false; mat.userData.maplessOverlay = true; }
    romOverlayShade(mat, rom);
    mat.userData.rom = rom; mat.userData.unlit = true; mat.userData.noTint = true;
    mat.userData.renderOrder = 20;
    return applyRomBias(mat, st);
  }
  if (st && st.blend === 'revsub'){
    // The additive path's mirror image: same source and destination factors, the opposite
    // equation. The MRL blend word says so -- 0x20802 is BSAddAlpha and 0x4020802 is
    // BSRevSubAlpha, differing only in bit 0x4000000 -- so this is dst - src*srcAlpha where
    // add is dst + src*srcAlpha: a layer that DARKENS what is behind it.
    //
    // It went unmapped in mfx.py until Raven found Khezu "covered in ... a mesh"
    // (2026-09-04). An unrecognised blend word falls through to the lit opaque path, and a
    // darkening overlay drawn opaque is a solid black shell over the animal -- Khezu's
    // m03_blood over its back and wings, Old Fatalis' m01_face_sub across its neck.
    //
    // Three materials in the ROM use it, all monsters (the third is Grimclaw Tigrex's
    // m60_angry_arm); no armour or weapon material does, so this branch is unreachable in the
    // Armor Viewer and its rendering is unchanged.
    const mat = new THREE.MeshBasicMaterial({ name: spec.srcName, side, transparent: true,
                                              depthWrite: romDepthWrite(st, false), wireframe: !!spec.wire,
                                              blending: THREE.CustomBlending,
                                              blendEquation: THREE.ReverseSubtractEquation,
                                              blendSrc: THREE.SrcAlphaFactor,
                                              blendDst: THREE.OneFactor });
    // an overlay that binds no albedo samples black, and black subtracts nothing
    if (rom && !rom.albedo){ mat.visible = false; mat.userData.maplessOverlay = true; }
    romOverlayShade(mat, rom);
    mat.userData.rom = rom; mat.userData.unlit = true; mat.userData.noTint = true;
    mat.userData.renderOrder = 20;
    return applyRomBias(mat, st);
  }
  if (spec.unlit){
    // The map IS the colour: no lights, no matcap, no pigment. The ROM's cull mode and blend
    // state still apply, so a transparent constant material still sorts and a two-sided one
    // still draws both faces -- which a hard-coded MeshBasicMaterial in the caller would lose.
    const mat = new THREE.MeshBasicMaterial({ name: spec.srcName, side, wireframe: !!spec.wire });
    if (st && st.blend === 'blend'){
      mat.transparent = true; mat.depthWrite = romDepthWrite(st, false); mat.userData.renderOrder = 10;
      if (cb) mat.opacity = cb.transparency;
    }
    if (ft && (ft.transp === 'Alpha' || ft.transp === 'AlphaConstant') && rom.alphaTest)
      mat.alphaTest = Math.max(0, gl ? gl.clip : 0) + ALPHA_EPS;
    // fConstantColor BELONGS ON THIS PATH TOO: FAlbedoMapConstant means the albedo is the map
    // multiplied by fConstantColor, and this is where the ROM's MaterialConstant classes land.
    if (gl && cb){
      const k = (ft && ft.albedo === 'MapConstant' && gl.constant) ? gl.constant : [1, 1, 1, 1];
      mat.color.setRGB(gl.albedo[0] * cb.diffuse[0] * k[0],
                       gl.albedo[1] * cb.diffuse[1] * k[1],
                       gl.albedo[2] * cb.diffuse[2] * k[2], THREE.SRGBColorSpace);   // decoded (romLinear)
    }
    applyRomBias(mat, st);
    mat.userData.rom = rom; mat.userData.unlit = true; mat.userData.noTint = true;
    return mat;
  }
  const mat = new THREE.MeshStandardMaterial({
    roughness:.85, metalness:.0, side, name:spec.srcName, transparent:false, alphaTest: 0 });
  mat.userData.rom = rom;
  // alpha: the ROM's transparency feature, else the caller's name rule
  let cut = 0, texAlpha = false;
  if (ft){
    if (ft.transp === 'Alpha' && rom.alphaTest){ cut = Math.max(0, gl ? gl.clip : 0) + ALPHA_EPS; texAlpha = true; }
  } else if (spec.alphaCut){ cut = spec.alphaCut; texAlpha = true; }
  mat.userData.cutout = texAlpha; mat.userData.romCut = cut;
  mat.alphaTest = (texAlpha && alphaOverride !== null) ? alphaOverride : cut;
  // blend state
  if (st && st.blend === 'blend'){
    mat.transparent = true; mat.depthWrite = romDepthWrite(st, false); mat.userData.renderOrder = 10;
    if (cb) mat.opacity = cb.transparency;
    if (ft && ft.transp) texAlpha = true;
  }
  applyRomBias(mat, st);
  // albedo tint, emission, shininess
  // the colour constants decoded like a texel (romLinear): the game multiplies the raw texel by the raw constant
  if (gl && cb) mat.color.setRGB(gl.albedo[0] * cb.diffuse[0], gl.albedo[1] * cb.diffuse[1], gl.albedo[2] * cb.diffuse[2], THREE.SRGBColorSpace);
  if (gl && (gl.emission[0] + gl.emission[1] + gl.emission[2]) > 0){
    mat.emissive.setRGB(gl.emission[0], gl.emission[1], gl.emission[2], THREE.SRGBColorSpace);
    mat.userData.emissiveFromMap = true;
  }
  if (gl && gl.shininess > 16) mat.roughness = Math.min(0.85, Math.max(0.4, 0.85 - Math.log2(gl.shininess / 16) * 0.15));
  mat.userData.reflective = cb ? (cb.reflective[0] + cb.reflective[1] + cb.reflective[2]) / 3 : 1;
  // THE FRESNEL SOURCE IS CHOSEN BY THE FEATURE, and reading the wrong one neuters the term.
  // $Globals declares BOTH: fFresnelSchlick (float, floatOffset 40) and fFresnelSchlickRGB
  // (float3, floatOffset 41), and FFresnel's variants pick between them -- Schlick takes the
  // SCALAR, SchlickRGB the TRIPLE. Averaging the triple for everything gave F0 = 1 wherever the
  // scalar was the real value, and fres = 1 + (1-1)*(...) = 1 is no Fresnel at all. A material
  // with no FFresnel feature keeps F0 = 1, the same no-op the ROM gets by not running the term.
  mat.userData.f0 = (!gl) ? [1, 1, 1]
    : (ft && ft.fresnel === 'SchlickRGB') ? gl.fresnelSchlickRGB.slice(0, 3)
    : (ft && ft.fresnel === 'Schlick')    ? [gl.fresnel, gl.fresnel, gl.fresnel]
    : [1, 1, 1];
  mat.userData.viewUv = !!(ft && ft.uvAlbedoMap === 'UVViewNormal');
  // pigment and colour override
  mat.userData.noTint = !!spec.noTint;
  if (spec.tintClass) mat.userData.tintClass = spec.tintClass;
  mat.userData.dyeRegion = rom ? rom.pigment : !!spec.dyeRegion;
  if (spec.slot !== undefined) mat.userData.slot = spec.slot;
  mat.userData.own = (spec.own !== undefined) ? spec.own : null;
  mat.wireframe = !!spec.wire;
  applyTint(mat);
  const u = mat.userData.u;
  u.uAlphaCut.value = texAlpha ? 1 : 0;
  u.uViewUv.value = mat.userData.viewUv ? 1 : 0;
  u.uF0.value.fromArray(mat.userData.f0);
  // AFTER applyTint, which is what creates `u`: written above it this threw on the first lit
  // material and the app did not load at all (the Monster Viewer's lesson, 2026-09-07).
  if (gl && gl.specular) u.uSpecRGB.value.fromArray(romLinear3(gl.specular));   // decoded: it scales linear accumulators
  // fReflectiveColor as FReflectGlobalCubeMap's multiplier (uReflRGB): rom/specular.js (shared, verbatim) builds it RAW
  // from cbm.reflective only when the holder is missing, so it is put here first, decoded, and specular.js keeps it
  if (cb && cb.reflective && !u.uReflRGB) u.uReflRGB = { value: new THREE.Vector3().fromArray(romLinear3(cb.reflective)) };
  // THE ROM'S SPECULAR, as the Monster Viewer draws it (render/rom/specular.js, taken verbatim 2026-10-07; Raven: "review
  // each armor to ensure we are accurately rendering them"): FReflectGlobalCubeMap -- the reflection 9,533 armour
  // materials select, on the engine's default cube DefaultCube_CM, which this path drew as no term -- and FFinalCombiner's
  // scope, the Fresnel over the whole specular and the specular map as full RGB. Installed only while enableRomSpecular
  // is on (index.html), so the shared path is untouched otherwise.
  if (cb) setReflRaw(mat, cb.reflective);
  installRomSpecular(mat, rom, spec.ref || null); trackRomSpecular(mat);
  if (mat.userData.romSpecular){
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      const A = '               vec3 romN = normalize( normal );';
      if (sh.fragmentShader.indexOf(A) < 0) return;
      sh.fragmentShader = sh.fragmentShader.replace(A,
        '               if ( uRomSphere > 0.5 && uEnvAmt > 0.0 ) {\n' +
        '                 vec3 rsN = normalize( normal );\n' +
        '                 reflectedLight.indirectSpecular += texture2D( uEnv, rsN.xy * 0.5 + 0.5 ).rgb * uReflRaw * specMask;\n' +
        '               }\n' + A);
    };
    mat.userData.progTags = (mat.userData.progTags || '') + '|romSphere';
    const tags = mat.userData.progTags;
    mat.customProgramCacheKey = () => tags;
    mat.needsUpdate = true;
  }
  return mat;
}

// THE STATIC UV TRANSFORM, cbm.uv -- decoded into materials.json and never applied until now.
// CBMaterial declares three of them (mfx: fUVTransform @float 8, fUVTransform2 @16, fUVTransform3
// @24, each `float2x4`), so the 24 floats are THREE 2x4 affine matrices laid out
//     [ a  b  0  tx ]
//     [ c  d  0  ty ]
// with identity [1,0,0,0, 0,1,0,0]. The animated fUVTransform tracks build exactly this matrix at
// runtime (0xb0ca90..0xb0caf0: sin/cos into [sx*cos, -sy*sin, 0, tx] / [sx*sin, sy*cos, 0, ty]).
//
// Only the PRIMARY matrix maps onto a three.js texture's offset/repeat, and over this app's own
// data that is 8 material instances -- the bulk of the non-identity rows sit in fUVTransform2, the
// SECOND UV set, which belongs to the TypeExtend two-map albedo path and has no home here yet.
// Rotation is effectively unused (of 3,058 animated UV keys in the library exactly one carries a
// non-zero angle), so `center` stays at three.js's default rather than moving to the ROM's pivot.
//
// THE TEXTURE IS SHARED, so a non-identity transform gets its own handle: getTexture hands every
// material binding a file ONE cached object, and writing offset/repeat onto it would move every
// other material drawing that texture. Texture.clone() shares `source`, which is what three.js
// keys the GPU upload on, so the copy costs an object and no pixels -- the same trick the material
// animation's baseOf uses for an animated fUVTransform.
export function applyRomUv(mat, t){
  const cb = mat.userData.rom && mat.userData.rom.cbm;
  const uv = cb && cb.uv;
  if (!uv || !t) return t;
  const f = Array.isArray(uv[0]) ? [].concat.apply([], uv) : uv;
  if (f.length < 8) return t;
  const a = f[0], b = f[1], tx = f[3], c = f[4], d = f[5], ty = f[7];
  if (a === 1 && b === 0 && tx === 0 && c === 0 && d === 1 && ty === 0) return t;
  const own = t.clone();
  own.repeat.set(a, d);
  own.offset.set(tx, ty);
  if (b || c) own.rotation = Math.atan2(c, a);   // the shear terms, where a material carries any
  own.needsUpdate = true;
  return own;
}

// the env matcap, once its texture has loaded
export function setEnvTexture(mat, t){
  if (mat.userData.ov){ mat.userData.ov.uSphere.value = t; mat.userData.ov.uSphereOn.value = t ? 1 : 0; return; }
  if (mat.isMeshMatcapMaterial){ mat.matcap = t; mat.needsUpdate = true; return; }
  if (!mat.userData.u) return;                 // an unlit additive material takes none
  mat.userData.u.uEnv.value = t;
  mat.userData.u.uEnvAmt.value = envStrength(mat);
  mat.needsUpdate = true;
}
// the iris mask, once loaded: the character colour then reaches only the iris
export function setIrisMask(mat, t){
  if (!mat.userData.u) return;
  mat.userData.u.uIris.value = t;
  mat.userData.u.uIrisOn.value = 1;
  mat.needsUpdate = true;
}
// the separate specular map, once loaded: its luminance is the gloss
export function setSpecTexture(mat, t){
  if (!mat.userData.u) return;
  mat.userData.u.uSpec.value = t;
  mat.userData.u.uSpecOn.value = 1;
  mat.needsUpdate = true;
}

// The colour the game hands to this material's CHANNEL (spec.rom.ch), as [r, g, b] 0-255, or
// null for the material's own constants. What the game does with it, read from the ROM
// (Raven, 2026-09-18, the Kinsect and Insect Glaive colours): 0x0053a0e4 walks the model's
// materials and, on each whose channel matches, calls the material's vfunc +0x2c or +0x24,
// picked by the model byte +0x1368, which the model constructor (0x00538b34) sets to 1 and
// nothing a hunter, weapon or Kinsect builds clears. +0x2c (0x00b0ad0c) writes the colour's
// RGB over $Globals.fAlbedoColor and its alpha over CBMaterial.fTransparency. So the colour
// REPLACES fAlbedoColor: it drops out of mat.color (fAlbedoColor x fDiffuseColor) and
// multiplies the texel instead, where it reaches the glow as well -- the glow takes
// fAlbedoColor in game, which is what the Esurient pigment showed. The alpha is 255 on every
// colour the game writes here, the fTransparency every such material already has.
export function setChannelColor(mat, rgb){
  const u = mat.userData.u;
  if (!u || !u.uChan) return;                  // the unlit paths take no channel colour
  const rom = mat.userData.rom, gl = rom && rom.glob, cb = rom && rom.cbm;
  const alb = (rgb || !gl) ? [1, 1, 1] : gl.albedo, dif = cb ? cb.diffuse : [1, 1, 1];
  if (gl && cb) mat.color.setRGB(alb[0] * dif[0], alb[1] * dif[1], alb[2] * dif[2], THREE.SRGBColorSpace);
  // the GAME's bytes (a pigment, a weapon's or the Kinsect's colour, the face paint), decoded like a texel (romLinear)
  if (rgb) u.uChan.value.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
  else u.uChan.value.setRGB(1, 1, 1);
  mat.userData.chanRgb = rgb || null;
}

// hair / eye / skin / fur colour: a '#rrggbb' string or a THREE.Color, or null for the
// authored map
export function setCharColor(mat, c){
  const u = mat.userData.u;
  if (!u) return;
  if (!c) { u.uCharAmt.value = 0; return; }
  u.uCharAmt.value = 1;
  u.uChar.value.set(c);
}

export function setWire(mats, on){
  mats.forEach(m => m.wireframe = on);
}

// the dye-mask debug view (magenta = selected, every other texel grey): it covers EVERY material the viewer builds --
// the hunter's face, hair and body and the weapon, not only the armour (Raven, 2026-10-01: "the hunters face does not
// gray out when Dye Mask is displayed, I would like everything non-dye to be grayed out") -- and a material built while
// it is shown (a piece swapped in, a weapon drawn) starts in it (dyeMaskOn, with the registries)
export function setDebug(mats, v){
  dyeMaskOn = v ? 1 : 0;
  mats.forEach(m => { const u = m.userData.u; if (u && u.uDbg) u.uDbg.value = dyeMaskOn; });
}

// the saturation / value window the fallback mask uses, plus the debug boost
export function setMaskWindow(mats, s0, s1, v0, kt, sb){
  mats.forEach(m => { const u = m.userData.u; if (!u) return;
    u.uSat.value.set(s0, s1); u.uVal.value.set(v0, v0 + 0.20);
    u.uKeyTol.value = kt; u.uSatBoost.value = sb; });
}

// ---- MATERIAL ANIMATION -------------------------------------------------------------------
// The evaluator is the Monster Viewer's (its render/material.js, written there to be taken back:
// "it is not monster-specific and the Armor Viewer needs it"). Raven, 2026-09-27: "I would like to
// update the armor viewer with the lessons learned". The .mrl carries an animation block per
// material -- decoded by build-matanim.py -- and 1,486 of this app's materials have one (370
// armour pieces, 1,116 weapons, 5,174 tracks, 1,177 clips auto-play). They were all drawn frozen at
// frame 0: materials.json shipped the blocks for monsters only until the builder's armour pass was
// run here (2026-09-27), and nothing played them.
//
// THE CLIP-SELECTION POLICY STAYS WITH THE CALLER. The ROM's own default is the auto-play bit
// (AUTO_CLIP), which is what this app wants; the monster app layers a rage state machine over it.
//
// THE FRAME RATE is an assumption, not a reading, and it is the Monster Viewer's: the evaluator's
// clock is `slotTime += material[+0x20] * dt` and the sum is compared against the clip's frame
// count, so the two share a unit -- but material[+0x20] itself is written by code nobody has found,
// so the wall-clock rate is open. 60 is the value that library was reviewed at; the argument for 30
// (a rate multiplier's neutral value is 1.0, so dt would be in ticks, and MHGU ticks at ~30) is
// real and recorded there, and changing it globally there regressed a monster already signed off.
// Same number here, so the two apps agree, and it belongs in a control rather than a constant swap.
export const MAT_FPS = 60;

const animBase = new WeakMap();

// A material's shipped values, snapshotted the first time it is stepped, so every frame can start
// from a known state: the ROM rebuilds its constant buffer from the material's own values each
// frame, while these writes land on a three.js material and would otherwise accumulate.
//
// THE TEXTURE HANDLE IS THIS APP'S ONE DEPARTURE. fUVTransform drives the texture object, and the
// monster app may write it because a monster owns its maps -- here the pool is content-addressed
// and shared, and all 168 materials that animate the primary UV share their map with another
// material of the same piece (a helm's scrolling glow beside its still body texture). So a material
// that animates UV gets its own handle on the same image: Texture.clone() shares `source`, which is
// what three.js keys the GPU upload on, so this costs a texture object and no pixels.
function baseOf(m){
  let b = animBase.get(m);
  if (b) return b;
  const rom = m.userData && m.userData.rom;
  const gl = rom && rom.glob;
  const drives = t => ((rom && rom.anim) || []).some(c => (c.tracks || []).some(k => k.target === t));
  const drivesUv = drives('fUVTransform');
  // AN ANIMATED EMISSION NEEDS THE MAP UNDER IT, exactly as a static one does. createMaterial sets
  // `emissiveFromMap` wherever the ROM's emission constant is non-zero, and the caller then binds the
  // ALBEDO as the emissive map, because the ROM's emission is the constant TIMES the albedo -- the
  // shader's `totalEmissiveRadiance *= gBase` lives inside `#ifdef USE_EMISSIVEMAP`. A material whose
  // constant is zero gets no such map, so when a CLIP writes fEmissionColor onto it the emission is a
  // flat glow over the whole surface instead of the map's own bright texels.
  //   That is the Esurient sets (Raven, 2026-09-27: "Esurient armor glows oddly, the armor itself is
  // glowing not the pigment"): their `_env_` materials ship emission 0, so they had no emissive map,
  // and their clips write a small emission that lit the entire piece rather than the dye region. Give
  // such a material the same map the static path would have given it, once, before the first write.
  //   ONLY A MATERIAL WITH AN EMISSIVE TERM CAN TAKE ONE. An additive or constant material is a
  // MeshBasicMaterial: no `.emissive`, and no `emissiveMap` uniform either, so three.js's uniform refresh
  // throws on the map (`uniforms.emissiveMap` is undefined) and the throw takes the whole frame with it.
  // That was Raikou Works (Raven, 2026-09-29: "Raikou Works has a bug"): its `axe147_add_` layer is
  // additive and its two clips drive fEmissionColor, so mounting the axe stopped the viewer drawing.
  // Eleven weapon models ship such a layer (w01 2, w02 3, w08 1, w09 2, w12 1, w14 2; no armour). The
  // track itself needs no map there: applyTrack adds it into the layer's colour, the map's own texels
  // already being the layer.
  if (m.map && !m.emissiveMap && m.emissive && drives('fEmissionColor')){
    m.emissiveMap = m.map;
    m.userData.emissiveFromMap = true;
    m.needsUpdate = true;
  }
  if (drivesUv && m.map){
    const own = m.map.clone(); own.needsUpdate = true;
    if (m.emissiveMap === m.map) m.emissiveMap = own;
    if (m.alphaMap === m.map) m.alphaMap = own;
    m.map = own;
    m.needsUpdate = true;
  }
  b = { color: m.color ? m.color.clone() : null, opacity: m.opacity, transparent: m.transparent,
        albedo: (gl && gl.albedo) ? gl.albedo.slice(0, 3) : [1, 1, 1],
        emissive: m.emissive ? m.emissive.clone() : null,
        reflective: m.userData ? m.userData.reflective : undefined,
        envAmt: (m.userData.u && m.userData.u.uEnvAmt) ? m.userData.u.uEnvAmt.value : undefined,
        specRGB: (m.userData.u && m.userData.u.uSpecRGB) ? m.userData.u.uSpecRGB.value.clone() : null,
        // the destinations only an app that installs them has (applyTrack): the shipped map for a kind-3 swap, the
        // distortion, the second map's transform and tint
        map: m.map || null,
        distFac: (m.userData.u && m.userData.u.uDistFac) ? m.userData.u.uDistFac.value : undefined,
        distBlend: (m.userData.u && m.userData.u.uDistBlend) ? m.userData.u.uDistBlend.value : undefined,
        extXf: (m.userData.u && m.userData.u.uExtXf) ? m.userData.u.uExtXf.value.clone() : null,
        extTint: (m.userData.u && m.userData.u.uExtTint) ? m.userData.u.uExtTint.value.clone() : null,
        uv: (drivesUv && m.map) ? { offset: m.map.offset.clone(), repeat: m.map.repeat.clone(), rotation: m.map.rotation } : null,
        // from the ROM's own constants, not the uniforms: a colour write may already stand when the first frame is stepped
        ov: m.userData.ov ? { refl: new THREE.Vector3().fromArray(rom.cbm.reflective),
                              transp: rom.feat.transp === 'Alpha' ? rom.cbm.transparency : 1 } : null };
  animBase.set(m, b);
  return b;
}
function restoreBase(m, b){
  if (b.ov && m.userData.ov){
    m.userData.ov.uRefl.value.copy(b.ov.refl); m.userData.ov.uTransp.value = b.ov.transp;
    if (m.userData.cbWrite) writeCb(m, m.userData.cbWrite);   // what the weapon's own code wrote stands under the clips
  }
  if (b.color && m.color) m.color.copy(b.color);
  if (b.opacity !== undefined) m.opacity = b.opacity;
  if (b.transparent !== undefined) m.transparent = b.transparent;
  if (b.emissive && m.emissive) m.emissive.copy(b.emissive);
  if (m.userData){
    if (b.reflective !== undefined) m.userData.reflective = b.reflective;
    const u = m.userData.u;
    if (u && u.uEnvAmt && b.envAmt !== undefined) u.uEnvAmt.value = b.envAmt;
    if (u && u.uSpecRGB && b.specRGB) u.uSpecRGB.value.copy(b.specRGB);
    if (u && u.uDistFac && b.distFac !== undefined) u.uDistFac.value = b.distFac;
    if (u && u.uDistBlend && b.distBlend !== undefined) u.uDistBlend.value = b.distBlend;
    if (u && u.uExtXf && b.extXf) u.uExtXf.value.copy(b.extXf);
    if (u && u.uExtTint && b.extTint) u.uExtTint.value.copy(b.extTint);
    if (m.userData.texSwap && b.map && m.map !== b.map){ m.map = b.map; m.needsUpdate = true; }
  }
  if (b.uv && m.map){
    m.map.offset.copy(b.uv.offset);
    m.map.repeat.copy(b.uv.repeat);
    m.map.rotation = b.uv.rotation;
  }
}

// One track at frame f. Kinds 2, 3 and 5 are STEP tracks in the ROM (their handlers go from the key
// search straight to the writer); interp 0 holds, 2 and 4 are cubic Hermite with tangents built
// from the neighbouring keys (the format stores none), everything else is linear.
function sampleTrack(tr, f){
  const k = tr.keys;
  if (!k || !k.length) return null;
  if (k.length === 1 || f <= k[0][0]) return k[0].slice(1);
  const last = k[k.length - 1];
  if (f >= last[0]) return last.slice(1);
  let i = 0;
  while (i < k.length - 1 && k[i + 1][0] <= f) i++;
  const a = k[i], b = k[i + 1];
  if (tr.interp === 0) return a.slice(1);
  if (tr.kind === 2 || tr.kind === 3 || tr.kind === 5) return a.slice(1);
  const span = b[0] - a[0];
  const t = span > 0 ? (f - a[0]) / span : 0;
  const n = Math.min(a.length, b.length);
  if ((tr.interp === 2 || tr.interp === 4) && span > 0){
    const p = k[i - 1] || a, c2 = k[i + 2] || b;
    const rPA = (a[0] - p[0]) > 0 ? span / (a[0] - p[0]) : 0;
    const rBC = (c2[0] - b[0]) > 0 ? span / (c2[0] - b[0]) : 0;
    const u2 = t * t, u3 = u2 * t;
    const out = [];
    for (let c = 1; c < n; c++){
      const A = a[c], B = b[c];
      const P = (p[c] === undefined) ? A : p[c];
      const C = (c2[c] === undefined) ? B : c2[c];
      const mA = 0.5 * ((B - A) + (A - P) * rPA);
      const mB = 0.5 * ((C - B) * rBC + (B - A));
      out.push(A + mA * t + (3 * B - 3 * A - 2 * mA - mB) * u2 + (2 * A - 2 * B + mA + mB) * u3);
    }
    return out;
  }
  const out = [];
  for (let c = 1; c < n; c++) out.push(a[c] + (b[c] - a[c]) * t);
  return out;
}

// AN ANIMATED ALPHA ONLY REACHES A MATERIAL THAT IS ACTUALLY BLENDED, which is the gate the static
// path already applies: createMaterial writes cbm.transparency onto `opacity` under `st.blend ===
// 'blend'` and on the two overlay branches, and nowhere else. The ROM's FTransparencyAlpha is
// `mc.Alpha * CBMaterial.fTransparency` -- it scales the material's ALPHA, and on a BSSolid material
// nothing blends that alpha, so the value changes no pixel.
//   Writing it anyway did two things at once (Raven, 2026-09-27: "On the female armors, I saw the
// pigment go transparent", "Which then made parts of the arm vanish along with them"). The Esurient
// `_sym_` materials are blend=opaque with an fTransparency clip that sweeps 0.1 -> 1.0 -> 0.1, so the
// dye region faded to a tenth; and flipping `transparent` on moved it out of the opaque pass into the
// sorted one, where it stopped occluding and took what it covered with it.
//   So: honour the value where the shipped material was blended, ignore it where it was not. `b` is
// baseOf's snapshot of how the material shipped, taken before any track had run.
function setAlpha(m, b, a){
  if (!b.transparent) return;
  m.opacity = a;
  m.transparent = true;
}

function applyTrack(m, tr, f){
  const v = sampleTrack(tr, f);
  if (!v) return;
  const b = baseOf(m);
  // THE REFLECTION OVERLAY draws two of the members its clips drive: fReflectiveColor, its tint, and fTransparency, its
  // fade (FTransparencyAlpha). fDiffuseColor and fAlbedoColor feed the albedo term, fSpecularColor the lights' term and
  // fUVTransform2 the second UV set -- none of which it draws (createReflectOverlay).
  const ov = m.userData.ov;
  if (ov){
    if (tr.target === 'fReflectiveColor') ov.uRefl.value.set(v[0], v[1] === undefined ? v[0] : v[1], v[2] === undefined ? v[0] : v[2]);
    else if (tr.target === 'fTransparency' && m.userData.rom.feat.transp === 'Alpha') ov.uTransp.value = v[0];
    return;
  }
  // the ROM writes only as many floats as the member word asks for (the vector writer returns
  // early on cols-1), so a 3-column track must not have its fourth component applied
  const cols = tr.cols || v.length;
  switch (tr.target){
    // offsetU, offsetV, scaleU, scaleV, rotation -- on this material's own handle (see baseOf)
    case 'fUVTransform': {
      for (const key of ['map', 'emissiveMap', 'alphaMap']){
        const tex = m[key];
        if (!tex) continue;
        tex.offset.set(v[0], v[1]);
        tex.repeat.set(v[2] === 0 ? 1 : v[2], v[3] === 0 ? 1 : v[3]);
        tex.rotation = v[4] || 0;
      }
      break;
    }
    case 'fConstantColor':                       // rgb + alpha, written not scaled
      if (m.color) m.color.setRGB(b.albedo[0] * v[0], b.albedo[1] * v[1], b.albedo[2] * v[2], THREE.SRGBColorSpace);   // decoded (romLinear)
      if (cols > 3) setAlpha(m, b, v[3]);
      break;
    case 'fAlbedoColor': case 'fDiffuseColor':
      if (m.color) m.color.setRGB(b.albedo[0] * v[0], b.albedo[1] * v[1], b.albedo[2] * v[2], THREE.SRGBColorSpace);   // decoded (romLinear)
      break;
    // READ AS sRGB, the space this pipeline's maps are decoded in: the ROM's colour constants sit
    // in the same space as its textures and this term is ADDED, so writing it into the working
    // (linear) space made it several times too bright -- the Monster Viewer's lesson, where it
    // whited out Crimson Fatalis. An additive material has no .emissive; there the term adds into
    // the colour the layer contributes, because an additive pass is already a sum.
    case 'fEmissionColor': {
      const g = v[1] === undefined ? v[0] : v[1], bl = v[2] === undefined ? v[0] : v[2];
      if (m.emissive){ m.emissive.setRGB(v[0], g, bl, THREE.SRGBColorSpace); break; }
      if (m.color) m.color.setRGB(b.albedo[0] + v[0], b.albedo[1] + g, b.albedo[2] + bl, THREE.SRGBColorSpace);   // the factor on the texel: decoded as one
      break;
    }
    case 'fTransparency':
      setAlpha(m, b, v[0]);
      break;
    // fReflectiveColor scales the sphere-map reflection, the same value envStrength() reads
    case 'fReflectiveColor': {
      const u = m.userData.u;
      if (u && u.uEnvAmt){
        const avg = (v[0] + (v[1] === undefined ? v[0] : v[1]) + (v[2] === undefined ? v[0] : v[2])) / 3;
        m.userData.reflective = avg;
        setReflRaw(m, v);
        if (u.uEnv && u.uEnv.value) u.uEnvAmt.value = envStrength(m);
      }
      break;
    }
    // AN ANIMATED fSpecularColor IS A COLOUR, as its static value is: it goes where the static
    // value lives, uSpecRGB, which multiplies both specular accumulators. (The Monster Viewer
    // reached this the long way round -- it wrote the luminance to a scalar on the gloss, so a
    // clip could brighten the specular but never change its hue, and Raven caught it on
    // Boltreaver's membrane: "Fix the specular colour". Its monster-side override becomes
    // redundant once it syncs this file.)
    //   IT BARELY MATTERS IN THIS APP, and that is worth saying plainly: 612 tracks carry the
    // target here, but 611 of them sit on ADDITIVE materials, which are MeshBasicMaterial with no
    // specular lobe and no `u` at all -- the guard below drops them. Exactly one lit material has
    // one (the Light Bowgun 086 emia_, two keys both at 0.4). It is the monsters' 32 tracks that
    // this case is really for, and this is the file they share.
    case 'fSpecularColor': {
      const u = m.userData.u;
      if (u && u.uSpecRGB){
        const g = v[1] === undefined ? v[0] : v[1], bl = v[2] === undefined ? v[0] : v[2];
        u.uSpecRGB.value.fromArray(romLinear3([v[0], g, bl]));   // decoded, as the static value
      }
      break;
    }
    // THE TWO-MAP ALBEDO, THE DISTORTION AND THE TEXTURE SWITCH (the Monster Viewer's cases, 2026-10-18 shared base): each
    // writes a uniform or a map list only an app that installs it has (uExtXf / uExtTint for the TypeExtend second map,
    // uDistFac / uDistBlend for the Refract distortion, userData.texSwap for a kind-3 track), so where the app has none the
    // track is dropped, as before. fUVTransform2 / 3 drive the SECOND-UV map's transform (feat.uvxf routes slot 1 to
    // fUVTransform2, slot 3 to fUVTransform3), never the primary map.
    case 'fUVTransform2': case 'fUVTransform3': {
      const u = m.userData.u;
      if (u && u.uExtXf) u.uExtXf.value.set(v[2] === 0 ? 1 : v[2], v[3] === 0 ? 1 : v[3], v[0], v[1]);
      break;
    }
    // fAlbedoBlendColor tints the second albedo map: rgb decoded like a texel (romLinear); .a stays raw -- on MapBlend it
    // is a lerp FACTOR, not a colour
    case 'fAlbedoBlendColor': {
      const u = m.userData.u;
      if (u && u.uExtTint){
        const c = romLinear3(v);
        u.uExtTint.value.set(c[0], c[1], c[2], cols > 3 ? v[3] : 1);
      }
      break;
    }
    case 'fDistortionFactor': { const u = m.userData.u; if (u && u.uDistFac) u.uDistFac.value = v[0]; break; }
    case 'fDistortionBlend': { const u = m.userData.u; if (u && u.uDistBlend) u.uDistBlend.value = v[0]; break; }
    // a kind-3 track switches the albedo map by index, through the material's own writer (vtable +0x60): 1 = the first
    // entry of the app's userData.texSwap list
    case 'tex': {
      const idx = v[0] | 0, swap = m.userData && m.userData.texSwap;
      if (swap && idx >= 1 && swap[idx - 1] && m.map !== swap[idx - 1]){ m.map = swap[idx - 1]; m.needsUpdate = true; }
      break;
    }
    // STILL NO DESTINATION, so dropped rather than misapplied:
    //   fUVTransform2 / fUVTransform3 (378) -- the second and third UV sets, which belong to the
    //     two-map albedo path this app does not have. Writing them to the primary map would
    //     scroll the wrong texture.
    //   fAlbedoBlendColor, fDistortionFactor, fDistortionBlend -- the same two paths.
    // There are no kind-3 (texture switch) tracks in this app's data at all.
    default: break;
  }
}

function stepOneSlot(m, clip, tSec){
  if (!clip || !clip.frames || !clip.tracks) return;
  const fr = Math.max(0, tSec) * MAT_FPS;
  // Clamped to frameCount, NOT frameCount-1: the ROM stores frameCount itself for a non-looping
  // clip. That is this evaluator's rule, not uModel::Motion's LMT rule.
  const f = clip.loop ? fr % clip.frames : Math.min(fr, clip.frames);
  for (const tr of clip.tracks) if (!tr.unsupported) applyTrack(m, tr, f);
}

// Drive every animated material under `root`. `pickClip(clips, rom, tSec)` returns the clip index
// to play, an array of up to four (the ROM runs four slots, later ones writing over earlier), or
// -1 for none; pass AUTO_CLIP for the ROM's own default. Returns how many materials it drove.
// NOTHING SELECTED MEANS THE MATERIAL'S OWN VALUES: the restore is unconditional, so a material
// that stops matching a clip goes back to how it shipped instead of keeping the last frame written.
export function stepMaterialAnim(root, tSec, pickClip){
  if (!root) return 0;
  lastClock = tSec;
  let n = 0;
  root.traverse(o => {
    const m = o.material;
    if (!m || !m.userData) return;
    const clips = m.userData.rom && m.userData.rom.anim;
    const ovr = m.userData.override;
    // A PART'S OVERRIDE WITH A CLIP OF ITS OWN RUNS ON ANY MATERIAL, animated or not: the player steps its part-state
    // materials' clips every frame (0x27bcb8) and the part copies the moving members on (0x3063cc) -- the Lance's
    // Healing Shield on a shield whose own materials have no clip at all
    if ((!clips || !clips.length) && !(ovr && ovr.anim)) return;
    const list = [];
    if (clips && clips.length){
      const pick = pickClip ? pickClip(clips, m.userData.rom, tSec, m) : AUTO_CLIP(clips);
      const raw = Array.isArray(pick) ? pick : [pick];
      for (const e of raw){
        const i = Array.isArray(e) ? e[0] : e;
        if (!(i >= 0)) continue;
        const t0 = Array.isArray(e) && typeof e[1] === 'number' ? e[1] : 0;
        list.push([i, tSec - t0]);
        if (list.length === 4) break;
      }
      restoreBase(m, baseOf(m));
      for (const [ci, t] of list) stepOneSlot(m, clips[ci], t);
    }
    if (ovr) writeOverride(m, ovr, tSec);   // a part's override lands after the clips
    if (list.length || (ovr && ovr.anim)) n++;
  });
  return n;
}
// The ROM's own default: clip+0x04 bit 1 is the auto-play flag, and at load the engine writes every
// bit-1 clip into the next free slot. Everything else waits for a setClip call from game state.
export function AUTO_CLIP(clips){ return clips.findIndex(c => c.auto); }

// SLOT 0 AS THE GAME'S OWN CODE SETS IT. 0xb09ae8(material, slot, clip) puts `clip` in the slot at time 0 (+0x50 + slot * 8,
// the time +0x54 zeroed); a weapon's gimmick trigger does it with the record's `anime` (render/weapon-state.js), and the
// colour writer 0x53a254 with its flag sets clip 0xffff, which plays nothing. `t0` is the clock value (the one
// stepMaterialAnim is handed) at which the clip starts; clip -1 is none. Until something sets it, the slot holds what the
// engine put there at load, the auto-play clip -- SLOT_CLIP, the picker the page runs, answers exactly that.
export function setMaterialClip(mat, clip, t0){ mat.userData.slot0 = { clip, t0 }; }
export function clearMaterialClip(mat){ delete mat.userData.slot0; }
export function SLOT_CLIP(clips, rom, tSec, m){
  const s = m && m.userData.slot0;
  if (!s) return AUTO_CLIP(clips);
  return (s.clip >= 0 && s.clip < clips.length) ? [[s.clip, s.t0]] : -1;
}
// WHAT THE WEAPON'S CODE WRITES INTO A MATERIAL'S CONSTANTS, and what stands until something writes over it: the colour
// writers 0x53a254 (fReflectiveColor), 0x53a3bc ($Globals.fSpecularColor) and 0x53a738 (fTransparency). `w` is
// { reflective: [r, g, b], specular: [r, g, b], transparency }, any of them, or null for the material's own values. The
// material's clips still write over it each frame, member by member, as the ROM's evaluator does. Drawn on the reflection
// overlay; fSpecularColor is kept but has no term there (createReflectOverlay).
export function setCbWrite(mat, w){
  mat.userData.cbWrite = w || null;
  const ov = mat.userData.ov, cb = mat.userData.rom && mat.userData.rom.cbm;
  if (!ov || !cb) return;
  ov.uRefl.value.fromArray(cb.reflective);
  ov.uTransp.value = mat.userData.rom.feat.transp === 'Alpha' ? cb.transparency : 1;
  if (w) writeCb(mat, w);
}
function writeCb(m, w){
  const ov = m.userData.ov;
  if (w.reflective) ov.uRefl.value.fromArray(w.reflective);
  if (typeof w.transparency === 'number' && m.userData.rom.feat.transp === 'Alpha') ov.uTransp.value = w.transparency;
}

// A MATERIAL LAID OVER A WEAPON PART'S OWN, as the part unit does it (0x305f3c, every frame the part holds an override at
// +0x13b0), into each of the part's materials whose colour channel is not masked out:
//   * THE FRAME IT CHANGES (0x30679c): CBMaterial.fDiffuseColor and fReflectiveColor, $Globals.fSpecularColor (+0xb0) and
//     fEmissionColor (+0xc0), the CBAmbient colour where both carry one, the tFresnelMap / tShininessMap bindings where
//     the override binds them -- the override material's values AT THAT MOMENT;
//   * EVERY FRAME AFTER (0x3063cc): fReflectiveColor and fEmissionColor only, again as they stand now.
// "As they stand" because the override is a live material with its own clip: the player keeps a clone of each part-state
// material (0x2895d4: res->vt+0x44(0), ->vt+0x1c) and steps them all every frame by its own frame delta (vtable +0x60 =
// 0x27bcb8 -> each material's vt+0x20 = 0xb0cffc, the clip evaluator 0xb0ba84), from the moment it is loaded -- not from
// the moment it is laid on. So fSpecularColor keeps whatever value the clip had on the frame the override took hold.
// `o` is { diffuse, reflective, specular, emission } (each [r, g, b] or absent) and, when the override material is
// animated, `anim`: its auto-play clip (build-matanim.py's shape), evaluated on the clock stepMaterialAnim is handed; or
// null to give the material back its own. The Lance's Healing Shield puts player/mod/common/pl_lance_up.mrl on the
// shield this way (render/weapon-state.js LANCE_UP). On the lit path: the colour is fAlbedoColor x fDiffuseColor,
// fReflectiveColor the sphere map's weight AND hue (uReflTint), fSpecularColor uSpecRGB, fEmissionColor the emissive
// over the albedo map (the ROM's PS_MaterialStd adds FEmissionConstant into mc.diffuse, which FFinalCombiner multiplies
// by the albedo); on the reflection overlay only fReflectiveColor has a term. A material's own clips run under it: the
// part writes the override after them, every frame (stepMaterialAnim).
let lastClock = 0;                               // the clock stepMaterialAnim was last handed
export function setMaterialOverride(mat, o){
  mat.userData.override = o || null;
  restoreOwn(mat);
  // an animated material's snapshot of how it shipped must be taken before anything is laid over it
  if (mat.userData.rom && mat.userData.rom.anim && mat.userData.rom.anim.length) baseOf(mat);
  if (!o){ unbindOverrideEmission(mat); delete mat.userData.overrideSpec; return; }
  mat.userData.overrideSpec = sampleOverride(o, 'fSpecularColor', lastClock) || o.specular || null;   // the frame it changes
  bindOverrideEmission(mat, o);
  writeOverride(mat, o, lastClock);
}
// the override's own clip at `tSec` for one member, [r, g, b] (3 columns written), or null when it does not drive it
function sampleOverride(o, target, tSec){
  const c = o && o.anim;
  if (!c || !c.frames || !c.tracks) return null;
  const tr = c.tracks.find(t => t.target === target && !t.unsupported);
  if (!tr) return null;
  const fr = Math.max(0, tSec) * MAT_FPS;
  const v = sampleTrack(tr, c.loop ? fr % c.frames : Math.min(fr, c.frames));
  return v ? [v[0], v[1] === undefined ? v[0] : v[1], v[2] === undefined ? v[0] : v[2]] : null;
}
// AN EMISSION LAID ON NEEDS THE ALBEDO UNDER IT, as baseOf gives an animated one (the Esurient rule): a part material
// that ships emission 0 has no emissive map, and the override's glow would light the whole surface flat
function overrideEmits(o){
  const e = o.emission, tr = o.anim && o.anim.tracks && o.anim.tracks.find(t => t.target === 'fEmissionColor');
  return !!tr || !!(e && (e[0] + e[1] + e[2]) > 0);
}
function bindOverrideEmission(m, o){
  if (!m.map || !m.emissive || m.emissiveMap || !overrideEmits(o)) return;
  m.emissiveMap = m.map;
  m.userData.emissiveFromOverride = true;
  m.needsUpdate = true;
}
function unbindOverrideEmission(m){
  if (!m.userData.emissiveFromOverride) return;
  m.emissiveMap = null;
  delete m.userData.emissiveFromOverride;
  m.needsUpdate = true;
}
function setReflective(m, rgb){
  setReflRaw(m, rgb);
  const u = m.userData.u, avg = (rgb[0] + rgb[1] + rgb[2]) / 3;
  m.userData.reflective = avg;
  if (u.uReflTint){
    if (avg > 1e-6) u.uReflTint.value.set(rgb[0] / avg, rgb[1] / avg, rgb[2] / avg);
    else u.uReflTint.value.set(1, 1, 1);
  }
  if (u.uEnvAmt) u.uEnvAmt.value = envStrength(m);
}
function restoreOwn(m){
  const rom = m.userData.rom, gl = rom && rom.glob, cb = rom && rom.cbm, u = m.userData.u;
  if (m.userData.ov){ if (cb) setCbWrite(m, m.userData.cbWrite); return; }
  if (!gl || !cb) return;
  if (u && m.color) m.color.setRGB(gl.albedo[0] * cb.diffuse[0], gl.albedo[1] * cb.diffuse[1], gl.albedo[2] * cb.diffuse[2], THREE.SRGBColorSpace);
  m.userData.reflective = (cb.reflective[0] + cb.reflective[1] + cb.reflective[2]) / 3;
  setReflRaw(m, cb.reflective);
  if (u && u.uReflTint) u.uReflTint.value.set(1, 1, 1);
  if (u && u.uEnvAmt) u.uEnvAmt.value = envStrength(m);
  if (u && u.uSpecRGB && gl.specular) u.uSpecRGB.value.fromArray(romLinear3(gl.specular));
  if (m.emissive) m.emissive.setRGB(gl.emission[0], gl.emission[1], gl.emission[2], THREE.SRGBColorSpace);
}
function writeOverride(m, o, tSec){
  const refl = sampleOverride(o, 'fReflectiveColor', tSec) || o.reflective;
  const emis = sampleOverride(o, 'fEmissionColor', tSec) || o.emission;
  if (m.userData.ov){ if (refl) m.userData.ov.uRefl.value.fromArray(refl); return; }
  const rom = m.userData.rom, gl = rom && rom.glob, u = m.userData.u;
  if (!u) return;                                // an unlit layer: nothing here takes these constants
  const alb = gl ? gl.albedo : [1, 1, 1];
  if (o.diffuse && m.color) m.color.setRGB(alb[0] * o.diffuse[0], alb[1] * o.diffuse[1], alb[2] * o.diffuse[2], THREE.SRGBColorSpace);
  if (refl) setReflective(m, refl);
  const spec = m.userData.overrideSpec || o.specular;
  if (spec && u.uSpecRGB) u.uSpecRGB.value.fromArray(romLinear3(spec));
  // read as sRGB, as applyTrack reads a clip's fEmissionColor (the Monster Viewer's lesson: linear is several times too bright)
  if (emis && m.emissive) m.emissive.setRGB(emis[0], emis[1], emis[2], THREE.SRGBColorSpace);
}
