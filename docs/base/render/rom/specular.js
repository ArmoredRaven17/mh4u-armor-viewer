// THE SPECULAR TERM AND THE FRESNEL'S SCOPE, from the ROM's own final combine.
//
// `FFinalCombiner` (AppShaderPackage.mfx, decoded in build/notes/chunk5-shaders.md Part 14) is:
//
//     out.rgb = MC.albedo * MC.diffuse  +  MC.specular * MC.fresnel
//     out.a   = MC.transparency * CBROPTest.fGlobalTransparency * MC.global_transparency
//
// and the terms feeding it:
//
//     FSpecularMap      MC.specular = ( MC.specular * fSpecularColor + FReflect() )
//                                     * FChannelSpecularMap( tSpecularMap sample ) * MC.occlusion
//                       MC.fresnel  = FFresnel()
//     FFresnelSchlick   = F0 + (1 - F0) * pow( 1 - dot( normal, -eye_dir ), 5 )
//
// TWO DIFFERENCES from the shared material.js path, both read from the package rather than inferred:
//
//   1. FRESNEL MULTIPLIES THE WHOLE SPECULAR TERM. The combine is `specular * fresnel`, and
//      MC.fresnel is read by FFinalCombiner, FSpecular, FSpecularMap and
//      FSpecularMapBlendTransparencyMap. material.js applies its Schlick term only inside
//      `if ( uEnvAmt > 0.0 )`, i.e. to the sphere map. Its FORMULA is right -- it matches the ROM
//      operand for operand -- but its SCOPE is narrower. 460 monster materials select
//      fresnel=Schlick.
//
//   2. THE SPECULAR MAP IS FULL RGB, NOT LUMINANCE. `FChannelSpecularMap`'s body is `tmp0` -- the
//      identity. That is deliberate on the ROM's part, not a gap in the decode: the sibling records
//      FChannelR / FChannelG / FChannelB / FChannelA all carry a real swizzle, so the package
//      expresses channel selection where it wants it and declines to here. material.js reduces the
//      map with dot(rgb, luma). A COLOURED specular map tints the lobe in the ROM and merely scales
//      it in the viewer.
//
// A SIGN CONVENTION worth keeping in view: `initMaterialContext` sets
// `MC.eye_dir = normalize(wposition - fCameraPos)`, i.e. camera TO surface, which is why
// FFresnelSchlick negates it before the dot. Getting that backwards moves a Fresnel rim from the
// silhouette to the facing side.
import * as THREE from 'three';

// DEFAULT OFF. This rewrites text that the SHARED material.js emits, so it is switched on
// deliberately and reviewed, not inherited. It also changes the brightness of every material that
// binds a specular map, and that is a judgement no automated check here can make.
let enabled = false;
export function enableRomSpecular(on){ enabled = !!on; }
export function romSpecularEnabled(){ return enabled; }

// The exact strings material.js emits today. If either stops matching -- because the shared module
// moved upstream -- this module MUST no-op rather than half-apply, so the anchors are asserted and
// a miss is reported instead of silently doing nothing.
const A_SPEC_END = 'reflectedLight.indirectSpecular *= uSpecRGB * specMask;';
const A_GLOSS = 'gGloss = uSpecOn > 0.5 ? dot( texture2D( uSpec, vMapUv ).rgb, vec3( 0.299, 0.587, 0.114 ) ) : texel.a;';

const misses = [];
export function anchorMisses(){ return misses.slice(); }

function chain(mat, fn){
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => { if (prev) prev(sh, r); fn(sh, r); };
  mat.needsUpdate = true;
}
// An onBeforeCompile edit is invisible to three.js's program cache key, so two materials with
// matching parameters share one compiled program and the first to compile decides whose injected
// GLSL everyone runs. See the full note in rom/shader.js. Every injection must tag the material.
function tagProgram(mat, tag){
  const tags = (mat.userData.progTags || '') + '|' + tag;
  mat.userData.progTags = tags;
  mat.customProgramCacheKey = () => tags;
  mat.needsUpdate = true;
}


// ---- FReflectGlobalCubeMap: the reflection the ROM adds INSIDE the specular term ----------------
// Raven, 2026-09-13: "Fix the reflection. The goal is to get as close to in-game as possible" --
// Boltreaver's charged membrane has a black albedo and draws 80% see-through, and its charge colour
// is this term: fReflectiveColor goes to (0.65, 0.875, 0.125) and (0.125, 0.875, 0.875), shown
// through the bright pattern of its specular map. 391 monster materials select it.
//
// THE MATHS, from the feature bodies (build/notes monster-shader-model.md):
//     FReflectGlobalCubeMap = sample( tGlobalEnvMap, MC.reflect_dir ).rgb * CBMaterial.fReflectiveColor
//                             * lerp( 1, 1 - max(light_mask.x, light_mask.y), CBAmbient.fEnvMapMask )
//     FSpecularMap          MC.specular = ( MC.specular * fSpecularColor + FReflect() ) * specMap * occlusion
//     FFinalCombiner        out += MC.specular * MC.fresnel
// so the reflection is added beside the lights' specular AFTER fSpecularColor and BEFORE the map and
// the fresnel. Here that is indirectSpecular += reflection * specMask, inside material.js's block and
// ahead of this module's romMul (fresnel * RGB map), which then scales it exactly as it scales the
// lights' term. The light-mask factor is taken as 1 (no monster material carries a light mask to make
// it anything else -- a READING, like occlusion at 1).
//
// THE TEXTURE. tGlobalEnvMap is the stage's; with no stage there is the engine's own default,
// system\texture\DefaultCube_CM, which the executable loads in the renderer's system-texture setup
// (0xbc99ec, beside sysfont) and as the default environment texture of the cube-map light class
// (constructor 0x920bbc). Decoded from the ROM: TEX type 6, 64x64, 7 mips, format 32 (BC3), faces in
// the standard +X -X +Y -Y +Z -Z order, sky blue up and brown ground down. Hunting areas ship their
// own (92 *_CM textures in the stage archives), so in a hunt the reflection is that area's; this is
// the engine default. Only the top mip is used and the GPU builds the rest.
//
// The reflection vector is MC.reflect_dir, the eye direction reflected about the normal, in world
// space, looked up with the same numbers the ROM uses (no axis flip: the model data is right-handed,
// arm_l sits at +X on a monster facing +Z). Whether the face images mirror X is not verified; on this
// sky/ground map it would swap left and right horizon detail only.
const GLOBAL_ENV = { value: null };
const GLOBAL_REFL_ON = { value: 1 };
export function setGlobalEnvCube(tex){ GLOBAL_ENV.value = tex; }
export function setGlobalReflection(on){ GLOBAL_REFL_ON.value = on ? 1 : 0; return !!GLOBAL_REFL_ON.value; }
export function globalReflectionOn(){ return !!GLOBAL_REFL_ON.value; }

// ---- FBRDF's specular lobe: the lights' highlight as the ROM computes it ------------------------
// Raven, 2026-09-16: "When he is fully charged, the membrane should also glow green." Astalos'
// charged membrane (XfBAN__E1_wing_taiden, part 42) carries no clip, and its class makes no material
// call. Its green is its own fSpecularColor, (0.42, 0.6, 0). The specular map (em081_00_BM+A) is
// exactly its pane mask: 255 on every pane texel, 0 on every vein. So the lights light the panes
// yellow-green, and that is the one term of its program this viewer did not draw as the ROM does.
//
// FBRDF, read as a program (efx/shader/mfxprog.py FBRDF), once per light:
//     h = normalize( light.direction - mc.eye_dir )
//     mc.specular += light.specular * pow( max( dot( mc.normal, h ), 1e-5 ), mc.shininess )
// Blinn-Phong with $Globals.fShininess as the exponent, NO normalisation and NO N.L factor. The
// Standard class draws that lobe with three.js's GGX instead. The roughness that rom/material.js
// bridges the exponent to is authored (80 -> 0.50), and at its peak GGX gives about 0.05 of the
// light, where the ROM gives all of it. On Astalos' panes that is the whole charge colour.
//
// With this on, the lights' direct specular IS that sum. material.js still multiplies it by
// fSpecularColor and the map's gloss, and romMul below still applies the fresnel and the RGB map:
//     FSpecularMap   ( mc.specular * fSpecularColor + FReflect ) * specMap * occlusion
// So only the lobe changes.
//
// THE LIGHT'S STRENGTH is not the ROM's. Lights are scene state, and this viewer's rig is its own.
// The rig was tuned against three.js's Lambert, albedo * color * N.L / pi, where FBRDF's diffuse is
// `light.diffuse * N.L` with no pi. So in the ROM's terms each light here is color / pi, and the lobe
// takes the same color / pi: the ROM's ratio of highlight to diffuse, taking the light's specular
// colour as its diffuse one (a READING; the ROM carries them separately). The scale is a knob.
//
// DEFAULT: on for BLINN_PHONG_DEFAULT_REFS only, the way the alpha treatments were staged. It
// changes the highlight on every lit material: 469 monster materials, shininess 0.01..80, 197 at 16.
// A monster joins at Raven's word.
//   __romBlinnPhong()                   readback
//   __romBlinnPhong(true / false)       every lit monster material
//   __romBlinnPhong('default')          back to the per-monster defaults
//   __romBlinnPhong('scale', k)         the light factor (default 1 / pi)
export const BLINN_PHONG_DEFAULT_REFS = new Set(['em/081_00', 'em/081_00/tail']);
let romBlinnPhong = null;                    // null: per-monster defaults; true / false: every material
const BP_SCALE = { value: 1 / Math.PI };
const bpMats = new Set();                    // { u: uniform holder, ref }
function bpFor(ref){ return romBlinnPhong === null ? BLINN_PHONG_DEFAULT_REFS.has(ref) : romBlinnPhong; }
export function enableRomBlinnPhong(on){
  romBlinnPhong = (on === 'default' || on === null) ? null : !!on;
  for (const e of bpMats) e.u.value = bpFor(e.ref) ? 1 : 0;
  return romBlinnPhongState();
}
export function romBlinnPhongState(){
  return { on: romBlinnPhong === null ? 'default' : romBlinnPhong, scale: +BP_SCALE.value.toFixed(4),
           materials: bpMats.size, usingRomLobe: [...bpMats].filter(e => e.u.value).length };
}
if (typeof window !== 'undefined'){
  window.__romBlinnPhong = (on, k) => {
    if (on === undefined) return romBlinnPhongState();
    if (on === 'scale'){ BP_SCALE.value = +k; return romBlinnPhongState(); }
    return enableRomBlinnPhong(on);
  };
}
// The lights three.js hands a Standard program, each lobe as FBRDF writes it. `geometryPosition` is
// declared by lights_fragment_begin, earlier in main(), and is still in scope here.
const BP_GLSL =
  '\tif ( uRomBP > 0.5 ) {\n' +
  '\t\treflectedLight.directSpecular = vec3( 0.0 );\n' +
  '\t\tvec3 bpV = normalize( vViewPosition );\n' +
  '\t\tvec3 bpN = normalize( normal );\n' +
  '\t\tIncidentLight bpL;\n' +
  '#if NUM_DIR_LIGHTS > 0\n' +
  '\t\tfor ( int bi = 0; bi < NUM_DIR_LIGHTS; bi ++ ) {\n' +
  '\t\t\tgetDirectionalLightInfo( directionalLights[ bi ], bpL );\n' +
  '\t\t\treflectedLight.directSpecular += bpL.color * uRomBPScale * pow( max( dot( bpN, normalize( bpL.direction + bpV ) ), 1e-5 ), uRomShin );\n' +
  '\t\t}\n' +
  '#endif\n' +
  '#if NUM_POINT_LIGHTS > 0\n' +
  '\t\tfor ( int bi = 0; bi < NUM_POINT_LIGHTS; bi ++ ) {\n' +
  '\t\t\tgetPointLightInfo( pointLights[ bi ], geometryPosition, bpL );\n' +
  '\t\t\treflectedLight.directSpecular += bpL.color * uRomBPScale * pow( max( dot( bpN, normalize( bpL.direction + bpV ) ), 1e-5 ), uRomShin );\n' +
  '\t\t}\n' +
  '#endif\n' +
  '#if NUM_SPOT_LIGHTS > 0\n' +
  '\t\tfor ( int bi = 0; bi < NUM_SPOT_LIGHTS; bi ++ ) {\n' +
  '\t\t\tgetSpotLightInfo( spotLights[ bi ], geometryPosition, bpL );\n' +
  '\t\t\treflectedLight.directSpecular += bpL.color * uRomBPScale * pow( max( dot( bpN, normalize( bpL.direction + bpV ) ), 1e-5 ), uRomShin );\n' +
  '\t\t}\n' +
  '#endif\n' +
  '\t}\n';
const A_LIGHTS_END = '#include <lights_fragment_end>';

export function installRomSpecular(mat, rom, ref){
  if (!enabled) return mat;
  if (!mat || !mat.isMeshStandardMaterial) return mat;
  const u = mat.userData.u;
  if (!u || !u.uF0) return mat;                 // needs material.js's uniforms to be present
  u.uRomSpecAmount = u.uRomSpecAmount || { value: 1 };
  const globalRefl = !!(rom && rom.feat && rom.feat.reflect === 'GlobalCubeMap');
  if (globalRefl){
    const cr = rom.cbm && rom.cbm.reflective;
    u.uReflRGB = u.uReflRGB || { value: new THREE.Vector3(cr ? cr[0] : 0, cr ? cr[1] : 0, cr ? cr[2] : 0) };
  }
  // FBRDF's lobe needs the material's own exponent; a material without one keeps three.js's lobe
  const shin = rom && rom.glob && typeof rom.glob.shininess === 'number' ? rom.glob.shininess : null;
  const bp = shin !== null;
  if (bp){
    u.uRomBP = u.uRomBP || { value: bpFor(ref) ? 1 : 0 };
    u.uRomShin = u.uRomShin || { value: shin };
    bpMats.add({ u: u.uRomBP, ref });
    mat.addEventListener('dispose', () => { for (const e of bpMats) if (e.u === u.uRomBP) bpMats.delete(e); });
  }

  tagProgram(mat, (globalRefl ? 'romSpec|globalRefl' : 'romSpec') + (bp ? '|romBP' : ''));
  chain(mat, sh => {
    Object.assign(sh.uniforms, { uRomSpecAmount: u.uRomSpecAmount });
    if (globalRefl) Object.assign(sh.uniforms, { uGlobalEnv: GLOBAL_ENV, uGlobalReflOn: GLOBAL_REFL_ON, uReflRGB: u.uReflRGB });
    let f = sh.fragmentShader;
    if (globalRefl) f = 'uniform samplerCube uGlobalEnv;\nuniform float uGlobalReflOn;\nuniform vec3 uReflRGB;\n' + f;
    // The lobe goes directly after the lights, which puts it AHEAD of material.js's
    // `directSpecular *= uSpecRGB * specMask` block: material.js ran first and left the include in place.
    if (bp){
      if (f.indexOf(A_LIGHTS_END) >= 0){
        Object.assign(sh.uniforms, { uRomBP: u.uRomBP, uRomShin: u.uRomShin, uRomBPScale: BP_SCALE });
        f = 'uniform float uRomBP;\nuniform float uRomShin;\nuniform float uRomBPScale;\n' +
            f.replace(A_LIGHTS_END, A_LIGHTS_END + '\n' + BP_GLSL);
      } else { misses.push('lightsEnd'); }
    }

    // DECLARE the uniform, by PREPENDING rather than by replacing an anchor. Adding it to
    // sh.uniforms alone does not put it in the GLSL, and the omission is silent in JS: the
    // shader fails to compile with "undeclared identifier", the material falls back to an
    // invalid program, and nothing throws.
    //
    // It anchored on 'void main() {' until 2026-09-08. That string is rewritten by six other
    // handlers in this chain (material.js, monster.js x3, ambient.js, shader.js x3), so the
    // replace was order-dependent for no reason; three.js concatenates its own prefix ahead of
    // this body, so a bare uniform at the top is valid GLSL wherever main ends up.
    //
    // This did NOT fix the two 'uRomSpecAmount : undeclared identifier' errors three.js logs on
    // first compile -- they survive the prepend, and remain UNEXPLAINED. What was measured on
    // 2026-09-08: a WebGL2RenderingContext.shaderSource hook saw the declaration present, ahead
    // of its use, in every source handed to GL (0 missing); all linked programs report
    // LINK_STATUS true; forcing all 21 lit materials to recompile raises no error. So the drawn
    // result is not what the log describes. Do not treat those two lines as fixed.
    f = 'uniform float uRomSpecAmount;\n' + f;

    // (2) full RGB. Keep gGloss (material.js uses it for the sphere map) but also carry the
    //     unreduced colour, which is what FChannelSpecularMap's identity hands on.
    if (f.indexOf(A_GLOSS) >= 0){
      f = f.replace(A_GLOSS,
        'vec3 romSpecTex = uSpecOn > 0.5 ? texture2D( uSpec, vMapUv ).rgb : vec3( texel.a );\n' +
        '             gRomSpecRGB = romSpecTex;\n' +
        '             ' + A_GLOSS);
      f = f.replace('float gGloss = 0.0;', 'float gGloss = 0.0; vec3 gRomSpecRGB = vec3( 1.0 );');
    } else { misses.push('gloss'); }

    // (1) fresnel over the whole specular term, and the map applied as colour.
    //     material.js has already multiplied by `uSpecRGB * specMask` (a scalar mask); this
    //     divides that scalar back out per channel and re-applies the map as RGB, then multiplies
    //     the ROM's Fresnel over both specular accumulators.
    if (f.indexOf(A_SPEC_END) >= 0){
      f = f.replace(A_SPEC_END, A_SPEC_END + '\n' +
        // FReflectGlobalCubeMap, added beside the lights' specular before the map and the fresnel
        (globalRefl
          ? '             if ( uGlobalReflOn > 0.5 ) {\n' +
            '               vec3 romRv = inverseTransformDirection( reflect( -normalize( vViewPosition ), normalize( normal ) ), viewMatrix );\n' +
            '               reflectedLight.indirectSpecular += textureCube( uGlobalEnv, romRv ).rgb * uReflRGB * specMask;\n' +
            '             }\n'
          : '') +
        '             {\n' +
        '               vec3 romN = normalize( normal );\n' +
        // eye_dir is camera->surface in the ROM; vViewPosition is surface->camera, so the ROM's
        // `dot( normal, -eye_dir )` is dot( N, normalize(vViewPosition) ) here.
        '               vec3 romV = normalize( vViewPosition );\n' +
        '               vec3 romF = uF0 + ( vec3( 1.0 ) - uF0 ) * pow( 1.0 - clamp( dot( romN, romV ), 0.0, 1.0 ), 5.0 );\n' +
        '               vec3 romMap = ( uSpecOn > 0.5 ) ? gRomSpecRGB / max( gGloss, 1e-4 ) : vec3( 1.0 );\n' +
        '               vec3 romMul = mix( vec3( 1.0 ), romF * romMap, uRomSpecAmount );\n' +
        '               reflectedLight.directSpecular   *= romMul;\n' +
        '               reflectedLight.indirectSpecular *= romMul;\n' +
        '             }');
    } else { misses.push('specEnd'); }

    sh.fragmentShader = f;
  });
  mat.userData.romSpecular = true;
  return mat;
}

// Review knob: 0 leaves the shared path untouched, 1 is the ROM's scope.
export function setRomSpecularAmount(a){
  for (const m of tracked) if (m.userData.u && m.userData.u.uRomSpecAmount) m.userData.u.uRomSpecAmount.value = a;
}
const tracked = new Set();
export function trackRomSpecular(mat){ tracked.add(mat); }
