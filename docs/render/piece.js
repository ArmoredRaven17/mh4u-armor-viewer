// One player model -- an armour piece, an inner-wear piece, a face or a hair -- built the way the MH3U
// viewers build theirs (this module is the MH3U Armor Viewer's), because MH4U is the same converter on
// the same platform and the same .mrl:
//   * the material is createMaterial() handed the game's own material record from materials.json:
//     the blend state picks the lit, alpha-blended or additive path, and the albedo is all that is
//     bound (MH4U's shading is undecoded, so no LUT, sphere or extend map)
//   * a primitive whose mesh-table row lacks the draw bit (+0 bit 0) is the proxy layer and is not
//     drawn (`hideIdx`, by ordinal in the file's own order)
//   * every mesh keeps its PART id (glTF "Group[n]"): the hair and face are switched part by part by
//     the helm (applyParts below), exactly as the game writes the model's PartsDisp bits
import * as THREE from 'three';
import { loadGlb, getTexture } from './assets.js';
import { skeletonClone, meshGroupId } from './skeleton.js';
import { createMaterial, allMats } from './material.js';
import { specFor, refForGlb } from './materials-db.js';

export const pieceMats = [];

export async function loadPiece(rec, ctx){
  const gltf = await loadGlb(rec.glb, rec.glb);
  const root = skeletonClone(gltf.scene);
  const hideIdx = new Set(rec.hideIdx || []);
  const ref = refForGlb(rec.glb);
  const jobs = [], mats = [];
  let prim = -1;
  root.traverse(o => {
    if (!(o.isMesh || o.isSkinnedMesh)) return;
    const srcName = (o.material && o.material.name) || '';
    o.userData.part = meshGroupId(o);
    o.frustumCulled = false;              // skinned: the bind-pose bounds say nothing once posed
    prim++;
    if (hideIdx.has(prim)){ o.visible = false; o.userData.proxy = true; }
    const rom = specFor(ref, srcName);
    const mat = createMaterial({ srcName, rom, alphaCut: 0, noTint: true,
                                 unlit: !!(rom && rom.cls && rom.cls !== 'Std'),
                                 wire: !!(ctx && ctx.wire) });
    // the material's COLOUR TYPE (materials.json `ct`, .mrl record +0x18 bits 23-30): which of the
    // player's colours the game writes into its fMaterialStdAlbedoColor (applyColours below)
    mat.userData.ct = (rom && rom.m && rom.m.ct) || 0;
    // BSBlendAlpha BLENDS BY THE ALBEDO MAP'S ALPHA. material.js takes a map's alpha only where an MHGU
    // feature record says so, and 3DS materials carry none, so every blended material drew as a solid
    // quad: the face's makeup layers came out as white boxes (make03 is a quad whose texture region is
    // 95% alpha 0). The blend state reads the fragment alpha and the map is what carries the shape; the
    // 3DS's own alpha combiner stage is not read.
    if (rom && rom.state && rom.state.blend === 'blend' && mat.userData.u) mat.userData.u.uAlphaCut.value = 1;
    o.material = mat; allMats.push(mat); pieceMats.push(mat); mats.push(mat);
    if (mat.userData.renderOrder) o.renderOrder = mat.userData.renderOrder;
    if (rom && rom.albedo) jobs.push(getTexture(rom.albedo).then(t => {
      mat.map = t; if (mat.userData.emissiveFromMap) mat.emissiveMap = t;
      mat.needsUpdate = true; }));
  });
  await Promise.all(jobs);
  root.userData.joints = rec.joints || [];
  root.userData.mats = mats;
  // the rest pose, so "Bind Pose" can put a posed piece back (the pose driver writes the bones directly)
  root.userData.bind = [];
  root.traverse(o => root.userData.bind.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  return root;
}

// The game's PartsDisp bits for this model: part n is drawn when bit n of `mask` is set. Only the
// parts the mask's loop covers are touched (MH4U: the hair's 0-9, the face's 0-6 -- `bits`); a part
// above that keeps the all-on the model was built with. `pick` = { from, to, show }: of the parts
// from..to (the face's Features, 200-211) only `show` is drawn (-1: none), as 0xb08778 sets them.
// The proxy layer stays hidden whatever the mask says.
export function applyParts(root, mask, bits, pick){
  root.traverse(o => {
    if (!(o.isMesh || o.isSkinnedMesh) || o.userData.proxy) return;
    const p = o.userData.part;
    if (pick && p >= pick.from && p <= pick.to) o.visible = p === pick.show;
    else o.visible = p >= bits ? true : !!((mask >>> p) & 1);
  });
}

// THE GAME'S COLOURS, 0x199598(unit, type, rgba): every material whose colour type is `type` has the
// colour written into its CBMaterialStd fMaterialStdAlbedoColor (the setter 0x567b54), which multiplies
// its albedo map. `byType` maps a type to [R, G, B] (0-255) for THIS unit -- the caller applies the
// game's per-unit rules (the hair takes 1 and 4, the face 2, 4, 5 and 6, an armour slot 2, 3 and 4).
// A material whose type has no colour here draws its map as it is. The 3DS multiplies in its own
// 8-bit space; the colour is converted from sRGB so the product matches on a linear-light renderer.
export function applyColours(root, byType){
  root.traverse(o => {
    if (!(o.isMesh || o.isSkinnedMesh)) return;
    const m = o.material;
    if (!m || !m.color) return;
    const c = m.userData.ct ? byType[m.userData.ct] : null;
    if (c) m.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
    else m.color.setRGB(1, 1, 1);
  });
}

// Give a model's materials and geometry back when it leaves the scene.
export function releasePiece(root){
  if (!root) return;
  root.traverse(o => {
    if (!(o.isMesh || o.isSkinnedMesh)) return;
    const m = o.material;
    if (m){
      for (const list of [allMats, pieceMats]){ const i = list.indexOf(m); if (i >= 0) list.splice(i, 1); }
      m.dispose();
    }
  });
}
