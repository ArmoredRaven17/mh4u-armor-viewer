// THE GAME'S COLOUR SPACE, OPT-IN: `?space=game` (Option B of dev/model-pass-colour-space.md, 2026-10-15).
//
// The game's model pass is GAMMA-space throughout: every texture is sampled as stored (UNORM formats, no
// sRGB bit, DecodeMode 0), every colour constant is used raw, lights and emission are summed on those
// values, and nothing is encoded on the way to the RGBA8 UNORM target -- sRender.mSRGBEnable = 0
// (0xbb9dfc / 0xbb9e04; the .tex loader's version check 0xb4e4dc is the control). The default viewer
// renders LINEAR (decode every colour map, encode the output) and, since Option A, decodes every colour
// constant too, which reproduces the game's PRODUCTS (texel x constant) but not its SUMS (light + light,
// diffuse + emission, specular added) or the falloff of a light across a surface.
//
// This switch renders the model in the game's space instead:
//   * colour management OFF: Color.setRGB / setHex take values as given, so every ROM constant is raw
//     (rom/material.js romLinear and every `setRGB(..., SRGBColorSpace)` become the identity) and so is
//     every light colour;
//   * every texture sampled as stored: Texture.prototype.colorSpace is pinned to NoColorSpace, so no map
//     anywhere (assets.js, live.js, background.js are shared or synced copies and are not edited) is
//     decoded;
//   * no output encode: the renderer writes linear (identity) to the canvas, and fx.js's grade pass has
//     its sRGB transfer removed (applyGameSpace below);
//   * material.js's sphere-map screen drops its encode/decode pair (it tests ColorManagement.enabled).
//
// IT MUST LOAD FIRST: index.html imports it straight after three, before any module creates a colour or a
// texture. Off (the default) it does nothing at all.
import * as THREE from 'three';

let on = false;
try { on = new URLSearchParams(location.search).get('space') === 'game'; } catch (e) { on = false; }
export const GAME_SPACE = on;

if (on){
  THREE.ColorManagement.enabled = false;
  // An accessor on the prototype turns the constructor's own `this.colorSpace = ...` into a call to this
  // setter, so no texture ever gets an own property and every one reads as stored.
  Object.defineProperty(THREE.Texture.prototype, 'colorSpace', {
    configurable: true,
    get(){ return THREE.NoColorSpace; },
    set(v){ /* the game decodes nothing */ }
  });
}

// THE ENGINE'S DEFAULT AMBIENT, for the game-space render's default light. uAmbientLight's constructor loads
// system\texture\DefaultCube_CM as the scene cube when a stage names none (0x920cdc..0x920d44), and the
// stage ambient SH is the 27 float32 at +0x10 of that .tex, nine per channel (dev/rom-map.md, "the stage
// ambient SH"). Packed into CBAmbient.fSHCoef's float4[7] exactly as main.text+0xbced0c does
// (build-map-areas.py pack_sh), from romfs\nativeNX\system\texture\DefaultCube_CM.tex, 2026-10-15:
// raw L0 = (1.90767, 1.999219, 2.084841). It evaluates to (0.652, 0.739, 0.834) facing +y and
// (0.345, 0.327, 0.311) facing -y -- irradiance / pi, multiplied straight into the albedo by FAmbientSH.
// rom/ambient.js's STUDIO_SH is authored; this set is the ROM's.
export const DEFAULT_CUBE_SH = [
  [0.114174, 0.153051, -0.068148, 0.533678],
  [0.102209, 0.206038, -0.068669, 0.561441],
  [0.084699, 0.26156, -0.071149, 0.589726],
  [0.102665, -0.126027, 0.013397, -0.141916],
  [0.087018, -0.110352, 0.007583, -0.131814],
  [0.069649, -0.09492, -0.004811, -0.117298],
  [0.035149, 0.028137, 0.017356, 1.0],
];

// Called once the renderer and the fx chain exist.
export function applyGameSpace(renderer, fx){
  if (!on) return false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const grade = fx && fx.passes && fx.passes.grade;
  if (grade && grade.material){
    const A = 'c = viewOetf( clamp( c, 0.0, 1.0 ) );';
    const f = grade.material.fragmentShader;
    if (f.indexOf(A) >= 0){
      grade.material.fragmentShader = f.replace(A, 'c = clamp( c, 0.0, 1.0 );');
      grade.material.needsUpdate = true;
    } else console.warn('[colour-space] fx grade anchor missed: the effects chain still encodes');
  }
  return true;
}
