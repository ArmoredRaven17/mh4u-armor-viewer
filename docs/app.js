// The MH4U Armor Viewer. One figure: a hunter in the game's own armour, played in the game's own motions. MH4U's shading
// is undecoded, so it draws under generic lighting; the hunter's colours are the game's -- each material's colour type
// picks which of hair, skin, pigment and the Features colour multiplies its map (armor.json _about.colors).
//
// THE SHARED VIEWER BASE (docs/base; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md; Phase 1.4, 2026-10-18, ported from
// the MH3U Armor Viewer's Phase 1.3 app.js): the render core (stage, assets, skeleton, material, materials-db, pose, fx,
// lens, grid) and the UI -- the Hunter tab (Hunter Slots, Armor Pieces, Pigment, Weapon, Hunter, Guild Info), the
// Animation, Lighting, Camera and Effects panels, the camera bar, capture and Save / Open -- are the base's, GU's markup
// and behaviour ("Follow the GU app whenever possible"). This file is MH4U's: its data (docs/adapter.js maps it for the
// base), its per-unit colour rules, the helm's hair and face masks with the Features, the Eye Color cell, the inner wear,
// the weapon mount and its stances (the Switch Axe and Charge Blade forms, the Kinsect), the Charge Blade's gauge and
// Shield Charge, the session and set shapes. render/piece.js builds one player model.
//
// Data (scripts/build_armor.py, build_poses.py, build_weapons.py, build_stances.py; see armor.json `_about`):
//   armor.json      the game's five armour tables (names, the model each gender draws, who may wear it, its default
//                   pigment, its rarity), every player model, the clothing drawn under an empty slot, per helm model the
//                   hair and face parts it leaves, the Features, the colour board and pigments, the motion lists
//   materials.json  each material's albedo map, blend state and colour type
//   models/<g>      one glb per model           poses/<g>   one glb per motion list
//   ui/colorscale.png the game's colour board
import * as THREE from 'three';
import { createStage } from './base/render/stage.js';
import { createFx } from './base/render/fx.js';
import { initAssets, loadJson, loadGlb } from './base/render/assets.js';
import { setBiasUnitsPerStep } from './base/render/material.js';
import { loadMaterialsDb } from './base/render/materials-db.js';
import { PoseDriver } from './base/render/pose.js';
import { playerBone, gidBonesOf } from './base/render/skeleton.js';
import { createFloorGrid } from './base/render/grid.js';
import { loadPiece, applyParts, applyColours, releasePiece } from './render/piece.js';
import { loadShading, setShade4u, setGlow4u, playClip4u, step4u, setGaugeLayer4u } from './render/shade4u.js';
import * as adapter from './adapter.js';
import { createLightingPanel } from './base/ui/lighting-panel.js';
import { createEffectsPanel } from './base/ui/effects-panel.js';
import { createGuildPanel } from './base/ui/guild-panel.js';
import { createArmorPanel } from './base/ui/armor-panel.js';
import { createHunterPanel } from './base/ui/hunter-panel.js';
import { createWeaponPanel, orderClasses } from './base/ui/weapon-panel.js';
import { createPigment } from './base/ui/pigment.js';
import { createColourRows } from './base/ui/colour-rows.js';
import { createSaveOpen } from './base/ui/save-open.js';
import { createAnimationPanel } from './base/ui/animation-panel.js';
import { createCameraBar } from './base/ui/camera-bar.js';
import { createCapture } from './base/ui/capture.js';
import { createCameraPanel } from './base/ui/camera-panel.js';

// the game this viewer shows, for the shared base (docs/game.js)
const GAME = window.VIEWER_GAME;
// the Weapon panel's class rows (game.weaponRows: the Charge Blade's gauge and Shield Charge, the Kinsect), shown per class
const weaponPanel = createWeaponPanel(GAME, {});
// the adapter (docs/adapter.js) reads the app's objects through these, lazily: set before anything asks it
adapter.setApp({ get DATA(){ return DATA; }, get WEAPONS(){ return WEAPONS; }, get state(){ return state; }, worn: slot => worn(slot) });

// the page's test hooks; base/ui/capture.js hangs its own on it when it is built, so it exists from the start
window.__view = {};
const errEl = document.getElementById('err');
const errors = [];
window.__errors = errors;
function noteError(msg){ errors.push(String(msg)); errEl.textContent = String(msg); }
addEventListener('error', e => noteError('ERROR: ' + e.message));

const DATA = await loadJson('armor.json');
const WEAPONS = await loadJson('weapons.json');      // the game's weapon tables and every weapon model
const MOUNT = await loadJson('mount.json');          // how the game hangs each part on the hunter
await loadMaterialsDb();
await loadShading();                                 // shading.json: the 4U render path's data (render/shade4u.js)
const SLOTS = DATA.slots;                            // helm, body, arm, wst, leg
const C = DATA.colors;

const MARGIN = 1.25;
const viewport = document.getElementById('viewport');
const stage = createStage(viewport, { margin: MARGIN });
const { renderer, scene, camera, controls, world } = stage;
const head = stage.lights.head;     // the headlight; the render loop keeps it on the camera
// THE GAME'S SHADING, an option (render/shade4u.js): off by default until Raven has looked; remembered per browser
{
  const KEY = 'mh4u-armor-viewer-shade4u', box = document.getElementById('shade4u');
  let on = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch (e) {}
  box.checked = setShade4u(on);
  box.onchange = () => { setShade4u(box.checked); try { localStorage.setItem(KEY, box.checked ? '1' : '0'); } catch (e) {} };
}
initAssets(renderer);
// post-processing (base/render/fx.js), switched in only when an effect is on: with every effect off the frame is the
// plain renderer.render this app has always drawn
const fx = createFx(renderer, scene);
const SCENE = null;                  // GU's dev scene runs (?scene=); this app has none

let restoring = true;                // the boot fires the same handlers; nothing saves until it is done

// ---- Lighting and Effects: the shared base's panels ------------------------------------------------------------------
const lightPanel = createLightingPanel(GAME, { stage, scene, camera: () => camera, onChange: () => saveState() });
let fxFocusLive = 0, fxFocusTick = 0;
const fxPanel = createEffectsPanel(GAME, { fx: () => fx, focusLive: () => fxFocusLive, onChange: () => saveState() });

// ---- the camera bar's icons ------------------------------------------------------------------------------------------
const ICON = {
  orbit:  '<circle cx="12" cy="12" r="3.2"/><ellipse cx="12" cy="12" rx="9.6" ry="4.3" transform="rotate(-30 12 12)"/>',
  pan:    '<path d="M12 3.5v17M3.5 12h17M12 3.5 9.6 6M12 3.5 14.4 6M12 20.5 9.6 18M12 20.5 14.4 18M3.5 12 6 9.6M3.5 12 6 14.4M20.5 12 18 9.6M20.5 12 18 14.4"/>',
  camera: '<path d="M3.5 8.6h3.2L8.2 6.5h7.6l1.5 2.1h3.2v10.4H3.5V8.6Z"/><circle cx="12" cy="13.6" r="3.3"/>',
  rec:    '<circle cx="12" cy="12" r="5.6" fill="currentColor" stroke="none"/>',
  stop:   '<rect x="7" y="7" width="10" height="10" rx="1.6" fill="currentColor" stroke="none"/>',
  check:  '<path d="m5 12.6 4.6 4.6L19 7.4"/>',
  eye:    '<path d="M2.5 12c2.4-4 5.6-6 9.5-6s7.1 2 9.5 6c-2.4 4-5.6 6-9.5 6s-7.1-2-9.5-6Z"/><circle cx="12" cy="12" r="3"/>'
};
function setIcon(btn, key){ btn.querySelector('svg').innerHTML = ICON[key]; }
function setLabel(btn, label, tip){ btn.setAttribute('aria-label', label); btn.title = label + ': ' + tip; }

// ---- pose ---------------------------------------------------------------------------------------------------------------
// The game's own common motions, played on an off-screen proxy -- the gender's inner-wear body, which carries every bone
// the motions drive bar the accessory bones 20-23 -- and copied to every piece by bone id each frame (base/render/
// pose.js). An accessory bone, placed differently by each helm and hair, follows its animated parent.
const pose = new PoseDriver({ frame: world, onError: msg => noteError(msg) });
const mounted = {};                       // helm/body/arm/wst/leg/face/hair -> root
function activeMounts(){ return Object.values(mounted); }

// ---- the camera (base/ui/camera-panel.js) ----------------------------------------------------------------------------
const camPanel = createCameraPanel(GAME, {
  get SCENE(){ return SCENE; },
  get activeMounts(){ return activeMounts; },
  get camera(){ return camera; },
  get controls(){ return controls; },
  get figure(){ return 'hunter'; },
  get figureBounds(){ return figureBounds; },
  get fitPlanes(){ return fitPlanes; },
  get fitRenderer(){ return fitRenderer; },
  get fx(){ return fx; },
  get fxPanel(){ return fxPanel; },
  get head(){ return head; },
  get paintSpin(){ return camBar.paintSpin; },
  get playerBone(){ return playerBone; },
  get pose(){ return pose; },
  get renderer(){ return renderer; },
  get restoring(){ return restoring; },
  get saveState(){ return saveState; },
  get setIcon(){ return setIcon; },
  get setLabel(){ return setLabel; },
  get viewport(){ return viewport; },
  get world(){ return world; },
});
const { FLY_SPEED, applyCameraState, applyLens, cameraState, figureCenter, fly, focalOfSlider, focusDistance, leaveFly,
        lensCamera, lensEdit, lensFileState, paintCamMode, paintFlySpeed, paintOrbitLock, setCamMode, setFaceLock,
        setFlySpeed, setFocal, setFov, speedOfSlider, stepFly, viewDistance } = camPanel;

function fitRenderer(){
  stage.fit();
  const sz = renderer.getSize(new THREE.Vector2());
  fx.setSize(sz.x, sz.y, renderer.getPixelRatio(), camPanel.lensState);
}
// THE ONE RENDER ENTRY for the loop, the Screenshot button and the recorder: the composer when an effect is on, the
// plain render through the lens's camera otherwise. The focus ray is cast only while a depth of field is drawing and
// following -- nothing else reads it, and a cast over skinned meshes costs milliseconds.
const _aniso = new THREE.Vector2(1, 1);
function renderFrame(t){
  camPanel.frameNo++;
  const cam = lensCamera();
  plateUpdate(cam);
  const dof = fxPanel.state.dof;
  const following = fx.active && dof.on && dof.follow;
  const focus = following ? focusDistance(t !== undefined) : dof.focus;
  fxFocusLive = focus;
  _aniso.set(camPanel.lensState.type === 'anamorphic' ? 1 / camPanel.lensState.squeeze : 1, 1);
  fx.feed({ time: t === undefined ? performance.now() / 1000 : t,
            mask: document.documentElement.classList.contains('chroma'), aspect: camera.aspect,
            focus, near: cam.near, far: cam.far, ortho: !!cam.isOrthographicCamera, aniso: _aniso });
  if (following && ((++fxFocusTick) % 15) === 0) fxPanel.paintFocusLive();
  if (fx.active) fx.render(cam); else renderer.render(scene, cam);
}

// ---- framing ------------------------------------------------------------------------------------------------------------
// Under a clip a skinned mesh keeps its rest bounds, so the pose driver's own bounds -- the union of the whole loop --
// and its body centre win where it has them.
function figureBounds(){
  const objs = activeMounts();
  if (!objs.length) return null;
  const box = new THREE.Box3();
  if (pose.bounds && !pose.bounds.isEmpty()) box.copy(pose.bounds);
  else objs.forEach(o => box.expandByObject(o));
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  if (pose.center) c.copy(pose.center);
  return { box, size, c };
}
function frameAll(){
  if (camPanel.camMode === 'fly') leaveFly({ keepTarget: true });   // Fit to View is an orbit view
  const fb = figureBounds();
  if (!fb) return;
  const { box, size, c } = fb;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const reachY = Math.max(box.max.y - c.y, c.y - box.min.y) * 2;
  const reachX = Math.max(box.max.x - c.x, c.x - box.min.x) * 2;
  const dist = Math.max((Math.max(size.y, reachY) * 0.5) / Math.tan(vFov / 2),
                        (Math.max(size.x, reachX) * 0.5) / Math.tan(vFov / 2) / camera.aspect) * MARGIN + size.z * 0.5;
  controls.target.copy(c);
  camera.position.copy(c).add(new THREE.Vector3(0, 0, dist));
  fitPlanes(dist);
  camera.updateProjectionMatrix(); controls.update();
}
document.getElementById('fitBtn').onclick = () => frameAll();
// The clip planes follow the camera's distance every frame (GU's): the near plane set for a quarter-millimetre depth
// step at the target, capped so it never reaches the figure, the far plane twenty distances out with a floor
function fitPlanes(dist){
  if (!(dist > 0)) dist = viewDistance();
  const near = Math.min(dist / 4, Math.max(1e-4, dist * dist / 4194));
  const far = Math.max(50, dist * 20);
  if (Math.abs(near - camera.near) > near * 0.02 || Math.abs(far - camera.far) > far * 0.02){
    camera.near = near; camera.far = far; camera.updateProjectionMatrix();
  }
}
// The ROM's depth bias steps as a fixed push at the model: one step is BIAS_STEP_M, whatever the zoom
const BIAS_STEP_M = 0.0005;
function updateDepthBias(){
  const dist = viewDistance();
  let lsb;
  if (camPanel.lensState.type === 'ortho'){ const rc = lensCamera(); lsb = (rc.far - rc.near) / 16777216; }   // a linear depth buffer
  else lsb = dist * dist / camera.near / 16777216;
  if (lsb > 0) setBiasUnitsPerStep(BIAS_STEP_M / lsb);
}

// ---- the floor grid (base/render/grid.js), a camera bar toggle -----------------------------------------------------
// The floor is where the figure's soles are: the lowest point of its meshes as they stand, taken again whenever the
// pose or the pieces change (GU's rule)
const floorAt = { key: null, y: 0, centre: new THREE.Vector3(), reach: 1 };
function figureFloor(){
  const roots = activeMounts();
  const clip = pose.action ? pose.action.getClip() : null;
  const key = [pose.ground, clip ? clip.uuid : ''].concat(roots.map(r => r.uuid)).join('|');
  if (key === floorAt.key) return floorAt;
  const box = new THREE.Box3(), v = new THREE.Vector3();
  for (const root of roots) root.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    const n = o.geometry.attributes.position.count;
    for (let i = 0; i < n; i += 2){ o.getVertexPosition(i, v); box.expandByPoint(v.applyMatrix4(o.matrixWorld)); }
  });
  if (box.isEmpty()) return floorAt;
  floorAt.key = key;
  floorAt.y = box.min.y;
  box.getCenter(floorAt.centre);
  floorAt.reach = 0.5 * Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  return floorAt;
}
const floorGrid = createFloorGrid({ scene, floor: () => figureFloor().y,
                                    centre: out => out.copy(figureFloor().centre), reach: () => figureFloor().reach });

// ---- the camera bar and the Camera panel's controls (base/ui/camera-bar.js) ----------------------------------------
const camBar = createCameraBar(GAME, {
  get FLY_SPEED(){ return FLY_SPEED; },
  get SCENE(){ return SCENE; },
  get applyLens(){ return applyLens; },
  get camPanel(){ return camPanel; },
  get controls(){ return controls; },
  get floorGrid(){ return floorGrid; },
  get focalOfSlider(){ return focalOfSlider; },
  get fxPanel(){ return fxPanel; },
  get lensEdit(){ return lensEdit; },
  get paintCamMode(){ return paintCamMode; },
  get saveState(){ return saveState; },
  get setCamMode(){ return setCamMode; },
  get setFaceLock(){ return setFaceLock; },
  get setFlySpeed(){ return setFlySpeed; },
  get setFocal(){ return setFocal; },
  get setLabel(){ return setLabel; },
  get speedOfSlider(){ return speedOfSlider; },
});
// no pointer lock (a touch device): the first-person camera is not offered
if (!('requestPointerLock' in document.body)){
  document.getElementById('flyBtn').hidden = true;
  document.querySelector('#camMode option[value=fly]').disabled = true;
}

// ---- what is worn -------------------------------------------------------------------------------------------------------
const LS_KEY = 'mh4u-armor-viewer';
const CHAIN_KEY_OLD = 'mh4u-armor-viewer-chain';     // the chain's own key before the shared Animation panel
const clone = o => JSON.parse(JSON.stringify(o));
const pad3 = n => String(n).padStart(3, '0');
const hexRGB = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbHex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

// The game's colour board (lyt\lobby\texture\lby_colorscale, core_title.arc), inside its black frame. Read here for the
// colours an earlier version saved as a board pixel { x, y } and for the viewer's starting colours, both kept as that
// pixel's RGB.
const boardImg = new Image();
await new Promise((ok, bad) => { boardImg.onload = ok; boardImg.onerror = bad; boardImg.src = C.board.png; });
const boardData = (() => {
  const cv = document.createElement('canvas'); cv.width = C.board.w; cv.height = C.board.h;
  const cx = cv.getContext('2d'); cx.drawImage(boardImg, 0, 0);
  return cx.getImageData(0, 0, C.board.w, C.board.h).data;
})();
const boardRGB = (x, y) => { const i = (y * C.board.w + x) * 4; return [boardData[i], boardData[i + 1], boardData[i + 2]]; };
const isXY = v => !!v && typeof v === 'object' && Number.isInteger(v.x) && Number.isInteger(v.y);

// A slot holds an ARMOUR RECORD id (0 = nothing), not a model: pieces sharing a model can carry different default
// pigments, and the record is what the game colours by.
// THE STARTING COLOURS. Every colour row starts on Default, the game's own Reset colour (adapter.defaultRgb: CharMake's,
// scripts/char_defaults.py). START is the board pixels (14, 22 and 170, 20) the viewer started hair and the Features on
// before; an earlier save's { d: 1 } still means those. Every pigment row starts on Default: the piece's own colour.
// A COLOUR (skinC, hairC, clothC, featC): { u: true } Default, { c: '#rrggbb' } a pick, or an earlier save's { x, y } /
// { d: 1 } (that version's starting colour).
// A PIGMENT ROW (pig[slot]): 'default' (the piece's own colour, following the armour), or { on, hex } -- ticked, its
// colour; unticked, undyed (the shared base's rule). pigDev[slot]: the slot's Rainbow ('Rainbow') or null.
const START = { hairC: rgbHex(boardRGB(14, 22)), featC: rgbHex(boardRGB(170, 20)) };
const PIG_DEFAULT = { helm: 'default', body: 'default', arm: 'default', wst: 'default', leg: 'default' };
const DEFAULTS = { g: 'f', type: 'all', helm: 0, body: 0, arm: 0, wst: 0, leg: 0, face: 0, hair: 0, cloth: 0, feat: 0, eye: 0,
                   skinC: { u: true }, hairC: { u: true }, clothC: { u: true }, featC: { u: true },
                   pig: clone(PIG_DEFAULT), pigDev: [null, null, null, null, null],
                   pose: { list: 'co_0', clip: 'Motion[1]_loop' },
                   // the weapon: class -1 = none; model and pigment pick one of the class's weapons; kinsect is a Kinsect
                   // model (an Insect Glaive); stance a clip of the class's own list (drawn); the Charge Blade's gauge
                   // level (0-3) and Shield Charge (0 off, 1 red, 2 yellow)
                   weapon: { cls: -1, model: 0, pig: 0, kinsect: 1, drawn: false, stance: '', cbGauge: 0, shieldCharge: 0 } };
// a colour as this version holds it, from what any version saved (`key` picks the earlier version's starting colour)
function colourSpecOf(v, key){
  if (!v || typeof v !== 'object') return null;
  if (v.u === true) return { u: true };
  if (isHex(v.c)) return { c: v.c.toLowerCase() };
  if (isXY(v)) return { c: rgbHex(boardRGB(v.x, v.y)) };
  if (v.d === 1) return START[key] ? { c: START[key] } : { u: true };
  return null;
}
// a pigment row as saved by this version, or by the one before the shared base (null = Default, { c } = its own colour,
// { x, y } = a board pixel; all of them drawn ticked)
function pigRowOf(v){
  if (v === 'default' || v === null || v === undefined) return 'default';
  if (v && typeof v === 'object'){
    if (typeof v.on === 'boolean' && isHex(v.hex)) return { on: v.on, hex: v.hex.toLowerCase() };
    if (isHex(v.c)) return { on: true, hex: v.c.toLowerCase() };
    if (isXY(v)) return { on: true, hex: rgbHex(boardRGB(v.x, v.y)) };
  }
  return 'default';
}
const W_CLASS_IDS = new Set(WEAPONS.classes.map(c => c.cls));
// A hunter, every field type-guarded onto the defaults: what a save, a slot or an older version of this app wrote is
// never trusted as it stands.
function hunterOf(h){
  const o = clone(DEFAULTS);
  if (!h || typeof h !== 'object') return o;
  if (h.g === 'f' || h.g === 'm') o.g = h.g;
  if (['all', 'b', 'g'].includes(h.type)) o.type = h.type;
  for (const k of SLOTS.concat(['face', 'hair', 'cloth', 'feat', 'eye'])) if (Number.isInteger(h[k]) && h[k] >= 0) o[k] = h[k];
  for (const k of ['skinC', 'hairC', 'clothC', 'featC']){ const c = colourSpecOf(h[k], k); if (c) o[k] = c; }
  if (h.pig && typeof h.pig === 'object') for (const s of SLOTS) o.pig[s] = pigRowOf(h.pig[s]);
  if (Array.isArray(h.pigDev)) o.pigDev = SLOTS.map((s, i) => h.pigDev[i] === GAME.pigmentRainbow.name ? h.pigDev[i] : null);
  // the Hunter panel's Pose holds the hunter's own pose; a weapon list there (an older save) becomes the weapon's stance
  let oldStance = '';
  if (h.pose && typeof h.pose === 'object' && typeof h.pose.list === 'string' && typeof h.pose.clip === 'string'){
    if (adapter.isWeaponList(h.pose.list)) oldStance = h.pose.clip;
    else o.pose = { list: h.pose.list, clip: h.pose.clip };
  }
  const w = h.weapon;
  if (w && typeof w === 'object' && Number.isInteger(w.cls) && (w.cls === -1 || W_CLASS_IDS.has(w.cls)))
    o.weapon = { cls: w.cls, model: Number.isInteger(w.model) ? w.model : 0, pig: Number.isInteger(w.pig) ? w.pig : 0,
                 kinsect: Number.isInteger(w.kinsect) ? w.kinsect : 1, drawn: w.drawn === true,
                 stance: typeof w.stance === 'string' && w.stance ? w.stance : oldStance,
                 cbGauge: [0, 1, 2, 3].includes(w.cbGauge) ? w.cbGauge : 0,
                 shieldCharge: [0, 1, 2].includes(w.shieldCharge) ? w.shieldCharge : 0 };
  return o;
}
const state = clone(DEFAULTS);
// v2 is the shared base's session (v1 was the app before it; its hunter reads the same through hunterOf)
let SAVED = null;
try { SAVED = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (_) {}
if (!SAVED || typeof SAVED !== 'object' || (SAVED.v !== 1 && SAVED.v !== 2)) SAVED = null;
const savedAny = (() => { try { return localStorage.getItem(LS_KEY) !== null; } catch (_) { return false; } })();
if (SAVED) Object.assign(state, hunterOf(SAVED));
// the chain: in the session from v2, in its own key before (that shape converted once the pose list exists, below)
let savedChain = SAVED && Array.isArray(SAVED.chain) ? { chain: SAVED.chain, chainLoop: !!SAVED.chainLoop } : null;
if (!savedChain) try { const o = JSON.parse(localStorage.getItem(CHAIN_KEY_OLD) || 'null'); if (o && Array.isArray(o.chain)) savedChain = { old: o }; } catch (_) {}

const pieceRec = (g, slot, model) => DATA.pieces[g + '/' + g + '_' + slot + pad3(model)] || null;
const recById = Object.fromEntries(SLOTS.map(s => [s, new Map(DATA.armor[s].map(r => [r.id, r]))]));
const worn = slot => recById[slot].get(state[slot]) || null;

// The model a slot draws: the worn record's model for this gender; with nothing worn, the game's own fallback (0x2f4108)
// -- chest, arms and legs draw the clothing (inner wear) by the Clothing choice, six each (models 60-63, 70, 71); head and
// waist draw model 0, which has no file, so nothing.
function modelFor(slot){
  const r = worn(slot);
  if (r) return r[state.g];
  const inner = DATA.inner[slot];
  return inner ? inner[Math.min(state.cloth, inner.length - 1)] : 0;
}

// ---- the character colours ------------------------------------------------------------------------------------------------
// a colour choice -> [R, G, B] or null (Default: the map as drawn)
const rgbOf = spec => (spec && isHex(spec.c)) ? hexRGB(spec.c) : null;

// THE COLOUR ROWS (the Hunter panel; base/ui/colour-rows.js): Skin Tone, Hair Color, Clothing Color and Feature Color.
// MH4U names no colour in these menus (CharMake's pages for them offer the board and a Reset, game.js colourNames), so
// each row is Default -- the map as drawn -- and Custom, a pixel of the game's colour board, as the MH3U Armor Viewer's
// rows are; and RGB... (Raven, 2026-10-18: "I still want RGB to be an option since the game supports it via save
// editing"): the save holds each of the four as a plain RGBA word (the player data's hair +0x3c, clothing +0x40, skin
// +0x44, Features +0x48), so any colour is one the game draws. Eye Color is no colour row: its value is a cell of the
// eye texture (+0x39), not a colour. The rows hold their state as the base's ('#rrggbb' from the board or RGB..., null
// for Default); the hunter keeps it as { c } and { u }, so a save reads plainly. The tint is this app's
// (ctx.applyColours): the colour types and the per-unit rules below.
const COLOR_ROWS = [
  { key: 'skinC', sel: 'skinColor', part: 'skin' },
  { key: 'hairC', sel: 'hairColor', part: 'hair' },
  { key: 'clothC', sel: 'clothColor', part: 'cloth' },
  { key: 'featC', sel: 'featColor', part: 'feat' },
];
GAME.colourParts = COLOR_ROWS.map(r => [r.sel, r.part]);
// a row's own options from game.js (the Skin Tone's strip) are kept: the board and RGB... are added to them
for (const r of COLOR_ROWS) GAME.colourRows[r.part] = Object.assign({ board: { image: GAME.pigmentBoard.image, region: GAME.pigmentBoard.region }, rgb: true },
                                                                   GAME.colourRows[r.part] || {});
const specOfRow = v => isHex(v) ? { c: v.toLowerCase() } : { u: true };
// a row on Default: the skin's is the game's own colour (the row's state 'default'); the others' the map as drawn (null)
const rowOfSpec = (s, part) => (s && isHex(s.c)) ? s.c.toLowerCase() : (GAME.colourRows[part] && GAME.colourRows[part].default ? 'default' : null);
const colourRows = createColourRows(GAME, {
  // a hunter colour row's palette button: the shared pigment selector in its character mode (base/ui/pigment.js), as GU's
  openPalette: (...a) => pigPanel.openCharacter(...a),   // (label, hex, onPick, onDefault)
  defaultColour: part => adapter.defaultColour(part),   // a row's Default: the game's own colour (the skin's)
  get saveState(){ return saveState; },
  scene,
  // the rows' state into the hunter's, then the game's per-unit colours
  applyColours: cc => {
    for (const r of COLOR_ROWS) state[r.key] = specOfRow(cc[r.part]);
    applyAllColours();
  },
});
colourRows.buildColorLists();
function paintColourRows(){
  for (const r of COLOR_ROWS){ colourRows.charColor[r.part] = rowOfSpec(state[r.key], r.part); colourRows.paintRow(r.part); }
}

// ---- pigment (base/ui/pigment.js) -------------------------------------------------------------------------------------------
// ARMOUR PIGMENT (type 3): the worn piece's own colour, armour record +0x13 into the game's 70-colour table (0x2f854c),
// or a colour of its own -- every worn piece takes one (the item box's "Change your armor color") -- or the game's
// Rainbow (equipment entry +0x12 mode 0x8000; game.js pigmentRainbow), which the base's selector offers and steps
// (stepDeviant). The rows are the base's: they write the colour each row holds into `slotPigment` (the game's bytes, or
// null for an unticked row). An empty Chest, Arms or Legs shows the inner wear, whose dye region takes the Clothing Color.
const rowPig = {};
const slotPigment = {};
let colourQueued = false;
function queueColours(){
  if (colourQueued) return;
  colourQueued = true;
  queueMicrotask(() => { colourQueued = false; applyAllColours(); });
}
for (const sl of SLOTS) Object.defineProperty(slotPigment, sl, {
  enumerable: true, get: () => rowPig[sl] || null, set: v => { rowPig[sl] = v || null; queueColours(); } });
function pigmentOf(slot){
  if (worn(slot)) return rowPig[slot] || null;            // the row: its colour, or undyed
  return rgbOf(state.clothC) || adapter.defaultRgb('cloth');   // the inner wear: the Clothing Color (Default: the type's own)
}
const rgb255 = h => isHex(h) ? hexRGB(h) : null;
const pigPanel = createPigment(GAME, {
  SLOTS, slotPigment, rgb255,
  get saveState(){ return saveState; },
  DEVIANTS: [],                                           // GU's; 4U has none
  deviant: { on: false, a: '#000000', b: '#000000', anim: 'fade' },
  deviantMix: () => 0,
  defaultPigHex: slot => adapter.defaultPigHex(slot),
  dyeable: slot => adapter.dyeable(slot),
  dyeableNoneReason: 'Nothing is worn: the clothing shows, in the Clothing Color',
  pigmentColours: () => adapter.pigmentColours(),
  pigmentSections: () => adapter.pigmentSections(),
});
const { followDefaultPig, paintDyeable, pigOnDef, readSlotPigments, applyPigDef } = pigPanel;
const PIG_NONE = pigPanel.PIG_NONE;
// the rows, as the hunter's state holds them
function pigStateOfRows(){
  const o = {};
  for (const sl of SLOTS) o[sl] = pigOnDef.has(sl) ? 'default'
    : { on: document.getElementById('pgOn_' + sl).checked, hex: document.getElementById('pg_' + sl).value.toLowerCase() };
  return o;
}
// the hunter's rows onto the panel: Default rows take the worn piece's own colour (and follow the armour from here)
function applyPigRows(pig, pigDev){
  applyPigDef(SLOTS.filter(sl => pig[sl] === 'default'));
  for (const sl of SLOTS){
    const v = pig[sl], cb = document.getElementById('pgOn_' + sl), col = document.getElementById('pg_' + sl);
    if (v === 'default'){ const h = adapter.defaultPigHex(sl); cb.checked = !!h; col.value = h || PIG_NONE; }
    else { cb.checked = v.on; col.value = v.hex; }
  }
  document.getElementById('pgOn_all').checked = false; document.getElementById('pg_all').value = PIG_NONE;
  pigPanel.applySlotDev(pigDev || [null, null, null, null, null]);
  readSlotPigments(); paintDyeable();
}
// THE DYE MASK: the pigment region (colour type 3) in magenta, every other material dimmed -- exact here, since the game
// marks the region per material. The region also glows magenta, so a dark map still shows it; each material's own
// emissive is kept and put back when the mask goes off.
const maskCb = document.getElementById('maskdbg');
maskCb.title = 'Show which parts of each piece take its pigment: the pigment region in magenta, the rest dimmed';
const MASK_ON = [255, 0, 255], MASK_OFF = [70, 70, 70];
maskCb.onchange = () => applyAllColours();
function dyeMask(root, on){
  if (on) applyColours(root, { 1: MASK_OFF, 2: MASK_OFF, 3: MASK_ON, 4: MASK_OFF, 5: MASK_OFF, 6: MASK_OFF });
  root.traverse(o => {
    const m = (o.isMesh || o.isSkinnedMesh) && o.material;
    if (!m) return;
    if (on && m.color && !m.userData.ct) m.color.setRGB(MASK_OFF[0] / 255, MASK_OFF[1] / 255, MASK_OFF[2] / 255, THREE.SRGBColorSpace);
    if (!m.emissive) return;
    if (on){
      if (!m.userData.maskEmissive) m.userData.maskEmissive = m.emissive.clone();
      if (m.userData.ct === 3) m.emissive.setRGB(0.45, 0, 0.45); else m.emissive.setRGB(0, 0, 0);
    } else if (m.userData.maskEmissive){ m.emissive.copy(m.userData.maskEmissive); delete m.userData.maskEmissive; }
  });
}

// WHICH UNIT TAKES WHICH COLOUR. The player data holds each colour as RGBA -- hair +0x3c, clothing +0x40, skin +0x44,
// Features +0x48 -- and hands it to the colour-by-type setter 0xb0541c(unit, rgba, type): hair as type 1, skin as 2,
// clothing as 3, the Features as 4 (only while one is chosen, +0x3a). Which units each call reaches is not read
// throughout, so these are the MH3U Armor Viewer's rules on 4U's types: the hair takes the hair colour (1); every other
// unit takes the skin tone (2); the face takes the Features colour (4); an armour or clothing slot takes its pigment (3).
// Type 5, a layer on the female faces, is not identified and is drawn untinted.
function applyAllColours(){
  // a row on Default takes the game's own colour (adapter.defaultRgb: CharMake's Reset colours), never the map untinted
  const skin = rgbOf(state.skinC) || adapter.defaultRgb('skin'), hair = rgbOf(state.hairC) || adapter.defaultRgb('hair'),
        feat = rgbOf(state.featC) || adapter.defaultRgb('feat');
  if (typeof paintColourRows === 'function') for (const r of COLOR_ROWS) if (!rgbOf(state[r.key])) colourRows.paintRow(r.part);   // a Default that follows the hunter
  if (mounted.hair) applyColours(mounted.hair, { 1: hair });
  if (mounted.face) applyColours(mounted.face, { 2: skin, 4: feat });
  for (const slot of SLOTS) if (mounted[slot]) applyColours(mounted[slot], { 2: skin, 3: pigmentOf(slot) });
  for (const k of SLOTS.concat(['hair', 'face'])) if (mounted[k]) dyeMask(mounted[k], maskCb.checked);
}

// ---- mounting -----------------------------------------------------------------------------------------------------------
// Each slot loads on its own ticket: a fast scroll through a list fires faster than models load, and a load that comes
// back stale drops its result instead of mounting it.
const shown = {};                         // the record each slot is showing
const ticket = {};
function unmount(k){
  if (mounted[k]){ world.remove(mounted[k]); releasePiece(mounted[k]); delete mounted[k]; delete shown[k]; }
}
async function mountOne(k, rec){
  const t = ticket[k] = (ticket[k] || 0) + 1;
  if (shown[k] === rec && mounted[k]) return;
  if (!rec){ unmount(k); return; }
  const root = await loadPiece(rec, { wire: camBar.wireOn });
  if (t !== ticket[k]){ releasePiece(root); return; }
  unmount(k);
  root.userData.slot = k;
  world.add(root); mounted[k] = root; shown[k] = rec;
}

// THE HAIR AND FACE UNDER A HELM (0xb0ad80). The helm's MODEL picks a u32 per gender, or a row of 28 -- one per
// hairstyle; its low half is the hair parts left drawn (0-9), its high half the face parts (0-6). Face bit 5 also gates
// the Features (0xb08778): with it set, face part 200 + Features - 1 is drawn and the other eleven are not; without it,
// or with Features (None), none is. Hair parts above 9 (male hair 13's part 13) keep the all-on they start with.
const ALL_ON = 0x7f03ff;                  // what helm 0 holds: every hair part, every face part
function applyHelmMasks(){
  const e = DATA.hairFace[state.g][modelFor('helm')];
  const m = e === undefined ? ALL_ON : Array.isArray(e) ? (e[state.hair] !== undefined ? e[state.hair] : ALL_ON) : e;
  if (mounted.hair) applyParts(mounted.hair, m & 0xffff, 10);
  if (mounted.face){
    const fm = (m >>> 16) & 0x7f;
    const feat = (fm & 0x20) && state.feat ? DATA.features[state.feat - 1] : -1;
    applyParts(mounted.face, fm, 7, { from: DATA.features[0], to: DATA.features[DATA.features.length - 1], show: feat });
  }
}
// THE EYE COLOR (CharMake page 7): a CELL of the eyes' own map, not a tint. Player data +0x39 = v moves the UVs of the
// face's colour-type-0 materials (its `_eye_` material) by (0.25 x (v & 3), -0.25 x (v >> 2)) (0xb08420 -> 0xb05ecc), a
// 4 x 4 atlas whose cells 0-9 are drawn. The game's -0.25 per row is in its own V, which runs up the image; the models'
// V runs down it (glTF), so a row is +0.25 here. Each eye material takes its own handle on the shared map (clone() shares
// the image), so the offset moves only that face's eyes.
function applyEye(){
  const root = mounted.face;
  if (!root) return;
  const v = state.eye;
  root.traverse(o => {
    const m = (o.isMesh || o.isSkinnedMesh) && o.material;
    if (!m || !m.map || m.userData.ct) return;
    if (!m.userData.eyeMap){ m.map = m.map.clone(); m.map.needsUpdate = true; m.userData.eyeMap = true; m.needsUpdate = true; }
    m.map.offset.set(0.25 * (v & 3), 0.25 * (v >> 2));
  });
}

let loads = 0;
function setLoading(on){
  loads = Math.max(0, loads + (on ? 1 : -1));
  document.getElementById('loading').hidden = loads === 0;
}
async function refresh(){
  setLoading(true);
  try {
    const g = state.g, chars = DATA.chars[g];
    const jobs = SLOTS.map(slot => mountOne(slot, pieceRec(g, slot, modelFor(slot))));
    jobs.push(mountOne('face', chars.face[state.face] || null));
    jobs.push(mountOne('hair', chars.hair[state.hair] || null));
    jobs.push(refreshWeapon());
    await Promise.all(jobs);
    applyHelmMasks(); applyEye();
    applyAllColours();
    if (camBar.wireOn) camBar.paintWire();
  } catch (e) { noteError(e && e.message || e); }
  finally { setLoading(false); }
  saveState();
}

// ---- the Armor Pieces panel (base/ui/armor-panel.js) --------------------------------------------------------------------
const filterEl = document.getElementById('filter');
const slotSel = Object.fromEntries(SLOTS.map(s => [s, document.querySelector('select[data-slot="' + s + '"]')]));
function selectToken(sel, slot, v){
  sel.value = v;
  if (sel.value !== v && v){
    sel.insertAdjacentHTML('afterbegin', '<option value="' + v + '">' + armorPanel.labelOf(slot, v) + '</option>');
    sel.value = v;
  }
}
// what follows a new piece in a slot: its Default pigment, the rows it allows
function onPieceChange(slot){
  if (pigOnDef.has(slot)) followDefaultPig(slot);
  paintDyeable();
  saveState();
}
const armorPanel = createArmorPanel(GAME, {
  get SAVED(){ return { hunterType: state.type }; },
  SLOTS,
  get gender(){ return state.g; },
  get saveState(){ return saveState; },
  selectToken,
  setSlot: async (slot, v) => { state[slot] = v === 'none' ? 0 : (+v || 0); await refresh(); },
  onPieceChange,
  armorOptions: (slot, type) => adapter.armorOptions(slot, type),
  armorSpecials: slot => adapter.armorSpecials(slot),
  legacyModel: (slot, v, any) => adapter.legacyModel(slot, v, any),
});
// the Type filter is the panel's view; the hunter keeps it (it saves with the slot, as it always has)
document.getElementById('htype').addEventListener('change', e => { state.type = e.target.value; });
// the five selects from the hunter's records, then the panel's lists around them
function paintArmorSelects(){
  document.getElementById('htype').value = state.type;
  armorPanel.hunterType = state.type;
  for (const slot of SLOTS){
    const tok = adapter.tokenOfRecord(slot, state[slot]);
    if (tok === 'none') state[slot] = 0;                 // a record this gender cannot wear
    slotSel[slot].innerHTML = '<option value="' + tok + '"></option>';
    slotSel[slot].value = tok;
  }
  armorPanel.rebuildSelects(filterEl.value);
}

// ---- the Hunter panel (base/ui/hunter-panel.js) -------------------------------------------------------------------------
const poseSel = document.getElementById('pose');
const hunterPanel = createHunterPanel(GAME, {
  openPalette: (...a) => pigPanel.openCharacter(...a),   // (label, hex, onPick, onDefault)
  charStyles: part => adapter.charStyles(part),
  paintCount: () => adapter.paintCount(),
  clothingOptions: () => adapter.clothingOptions(),
  get clothingDefault(){ return String(state.cloth); },
  poseOptions: () => adapter.poseOptions(),
  facePaint: null,
  get gender(){ return state.g; },
  get saveState(){ return saveState; },
  setGender: g => setGender(g),
  refreshChar: async () => {
    state.face = +document.getElementById('faceStyle').value || 0;
    state.hair = +document.getElementById('hairStyle').value || 0;
    await refresh();
  },
  applyFacePaint(){}, setBody(){},
  setClothing: async () => { state.cloth = +document.getElementById('clothing').value || 0; await refresh(); },
  onPoseChange: v => onPoseChange(v),
});
// THE FEATURES and THE EYE COLOR: MH4U's own rows (game.js hunterRows), plain selects the base builds and this app fills
const featSel = document.getElementById('features'), eyeSel = document.getElementById('eyeColor');
// the Features' Default colour follows the Features chosen (adapter.defaultRgb), so the colours go again
featSel.onchange = () => { state.feat = +featSel.value || 0; applyHelmMasks(); applyAllColours(); saveState(); };
eyeSel.onchange = () => { state.eye = +eyeSel.value || 0; applyEye(); saveState(); };
// the Hunter panel's selects from the hunter's state
function paintHunterRows(){
  document.getElementById('genderSel').value = state.g;
  hunterPanel.buildStyleLists();
  const chars = DATA.chars[state.g];
  state.face = Math.min(state.face, chars.face.length - 1);
  state.hair = Math.min(state.hair, chars.hair.length - 1);
  document.getElementById('faceStyle').value = String(state.face);
  document.getElementById('hairStyle').value = String(state.hair);
  const nCloth = adapter.clothingOptions().length;
  state.cloth = Math.min(state.cloth, nCloth - 1);
  document.getElementById('clothing').value = String(state.cloth);
  featSel.innerHTML = adapter.featureOptions().map(o => '<option value="' + o.value + '">' + o.label + '</option>').join('');
  state.feat = Math.min(state.feat, DATA.features.length); featSel.value = String(state.feat);
  eyeSel.innerHTML = adapter.eyeOptions().map(o => '<option value="' + o.value + '">' + o.label + '</option>').join('');
  state.eye = Math.min(state.eye, adapter.eyeOptions().length - 1); eyeSel.value = String(state.eye);
  rebuildPoseList();
  paintColourRows();
}
// THE HUNTER'S POSE (the Hunter panel's Pose select, GU's): a group per common motion list, its clips the options;
// "Bind Pose" stops the clip. Rebuilt per gender (each gender has its own motion lists).
function poseIndex(){
  const i = adapter.poseOptions().findIndex(p => p.list === state.pose.list && p.clip === state.pose.clip);
  return i >= 0 ? 'g:' + i : '';
}
function rebuildPoseList(){
  const P = poseSet(), lists = (P && P.lists) || [];
  if (!lists.some(l => l.id === state.pose.list)){ state.pose.list = lists.length ? lists[0].id : ''; state.pose.clip = ''; }
  poseSel.innerHTML = '<option value="">Bind Pose</option>';
  hunterPanel.buildPoseList();
  poseSel.value = poseIndex();
  if (!poseSel.value) state.pose.clip = '';
}
function poseFromSelect(){
  const v = poseSel.value;
  const p = /^g:\d+$/.test(v) ? adapter.poseOptions()[+v.slice(2)] : null;
  if (p){ state.pose.list = p.list; state.pose.clip = p.clip; } else state.pose.clip = '';
}
async function onPoseChange(){
  if (!animPanel.chainDriving) animPanel.chainStop();
  sheatheForPose();
  poseFromSelect();
  await playPose(); saveState();
}
async function setGender(g){
  if (g !== 'f' && g !== 'm') return;
  state.g = g;
  // a record the other body cannot wear comes off (paintArmorSelects); the face, hair and clothing keep their index
  paintArmorSelects(); paintHunterRows();
  await refresh();
  for (const sl of SLOTS) if (pigOnDef.has(sl)) followDefaultPig(sl);
  paintDyeable();
  await playPose();
}

// ---- pose playing -----------------------------------------------------------------------------------------------------
function poseSet(){ return DATA.poses && DATA.poses[state.g]; }
function restoreBind(){
  for (const root of Object.values(mounted))
    for (const [node, p, q, s] of (root.userData.bind || [])){ node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s); }
}
// WHAT PLAYS (the MHGU viewer's applyWeaponState): a drawn weapon plays its Stance -- a clip of the class's own list
// (wNN) -- and a sheathed one, or none, the hunter's Pose; the Pose keeps its choice while a stance plays, so sheathing
// returns to it, and picking a pose sheathes the weapon.
function nowPlaying(){
  const w = state.weapon, c = wClass(w.cls);
  if (c && w.drawn && w.stance) return { list: c.key, clip: w.stance, stance: true };
  return { list: state.pose.list, clip: state.pose.clip, stance: false };
}
let poseTicket = 0;
async function playPose(){
  const t = ++poseTicket;
  const P = poseSet(), now = nowPlaying();
  const l = P && P.lists.find(x => x.id === now.list);
  if (!P || !l || !now.clip){ pose.stop(); restoreBind(); return; }
  // stance: true -- a weapon stance, for the base's loop rule (it plays once and holds unless Loop says otherwise)
  await pose.play(Object.assign({ file: l.file, clip: now.clip, model: P.model }, now.stance ? { stance: true } : {}),
                  { joints: P.joints });
  if (t !== poseTicket) return;
}
function sheatheForPose(){
  if (state.weapon.cls < 0 || !state.weapon.drawn) return;
  state.weapon.drawn = false; weaponDrawnSel.value = '0'; buildStanceList();
}

// ---- weapon -------------------------------------------------------------------------------------------------------------
// THE GAME'S OWN WEAPON MOUNT (scripts/build_weapons.py; mount.json). Each part of a weapon is its own model with its own
// little skeleton (joint ids 0-4, not the hunter's). The game's weapon callback places one joint of it -- the part's
// `mountJoint`, 0 for every part but the Long Sword's scabbard (4) -- at the world matrix of a hunter BONE times T(pos)
// R(rot) S, position in centimetres in the bone's own space, rotation in degrees composed Rz Ry Rx (three.js 'ZYX'),
// scale last. Which bone and which record follow the part's carry state: drawn is the hand (bone 8, or 12 for the Dual
// Blades' second blade), sheathed the back or the waist at the class's rest scale; shields and the Kinsect stay on the
// forearm (bone 11), the arrows and the scabbard rest. Only the skeleton moves: the meshes stay where the glb has them and
// the skinning carries them.
//   The pigment (colour type 3) is the game's: record +0x12 into the melee table, +0x1b into the gunner one (0x2f854c;
// weapons.json pigments).
const weaponClassSel = document.getElementById('weaponClass'), weaponModelSel = document.getElementById('weaponModel'),
      weaponDrawnSel = document.getElementById('weaponDrawn'), weaponPoseSel = document.getElementById('weaponPose'),
      kinsectSel = document.getElementById('kinsect'), cbGaugeSel = document.getElementById('cbGauge'),
      shieldChargeSel = document.getElementById('shieldCharge');
// the classes in GU's Guild Card order, by identity (adapter.CLASS_NAME); each class's weapons keep the game's order
const W_CLASSES = orderClasses(WEAPONS.classes, adapter.classNameOf);
const wClass = cls => W_CLASSES.find(c => c.cls === cls) || null;
const isGlaive = c => !!c && c.parts.indexOf('mus') >= 0;
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fieldOf = el => el.closest('.field');
// a class's list: one item per (model, pigment), named by every weapon that draws it -- as the armour lists
function weaponOptions(cls){
  const c = wClass(cls);
  if (!c) return [];
  const groups = new Map();
  for (const r of WEAPONS.weapons[c.key] || []){
    const k = r.model + ':' + r.pig;
    if (!groups.has(k)) groups.set(k, { model: r.model, pig: r.pig, names: [], kinsect: r.kinsect || 0 });
    const e = groups.get(k);
    if (e.names.indexOf(r.name) < 0) e.names.push(r.name);
  }
  return [...groups.values()];
}
// the Kinsects, one item per model, named by every Kinsect that draws it
function kinsectOptions(){
  const groups = new Map();
  for (const k of WEAPONS.kinsects){
    if (!WEAPONS.models['mus/mus' + pad3(k.model)]) continue;
    if (!groups.has(k.model)) groups.set(k.model, { model: k.model, names: [] });
    groups.get(k.model).names.push(k.name);
  }
  return [...groups.values()];
}
function buildWeaponLists(){
  const w = state.weapon, c = wClass(w.cls);
  weaponClassSel.innerHTML = '<option value="-1">— none —</option>' +
    W_CLASSES.map(x => '<option value="' + x.cls + '">' + esc(x.name) + '</option>').join('');
  weaponClassSel.value = String(w.cls);
  const opts = weaponOptions(w.cls);
  if (c && !opts.some(o => o.model === w.model && o.pig === w.pig) && opts.length){ w.model = opts[0].model; w.pig = opts[0].pig; }
  weaponModelSel.innerHTML = opts.map(o => '<option value="' + o.model + ':' + o.pig + '">' + esc(o.names.join(' / ')) + '</option>').join('');
  weaponModelSel.value = w.model + ':' + w.pig;
  const ks = kinsectOptions();
  if (!ks.some(k => k.model === w.kinsect)) w.kinsect = ks.length ? ks[0].model : 0;
  kinsectSel.innerHTML = ks.map(k => '<option value="' + k.model + '">' + esc(k.names.join(' / ')) + '</option>').join('');
  kinsectSel.value = String(w.kinsect);
  // a glaive that brings its own Kinsect (0x2f52a8) shows it, whatever the list says
  const forced = (opts.find(o => o.model === w.model && o.pig === w.pig) || {}).kinsect || 0;
  kinsectSel.disabled = !!forced;
  weaponDrawnSel.value = w.drawn ? '1' : '0';
  cbGaugeSel.value = String(w.cbGauge); shieldChargeSel.value = String(w.shieldCharge);
  fieldOf(weaponModelSel).hidden = !c;
  fieldOf(weaponDrawnSel).hidden = !c;
  weaponPanel.paintRows(c ? c.key : '');
  buildStanceList();
}
// the Kinsect model the glaive on screen carries
function kinsectModel(){
  const w = state.weapon;
  const o = weaponOptions(w.cls).find(x => x.model === w.model && x.pig === w.pig);
  return (o && o.kinsect) || w.kinsect;
}
// the mounted parts: { root, node (the mount joint), part (mount.json's), k, kinsect }
const weaponParts = [];
let weaponShown = '', weaponTicket = 0;
function unmountWeapon(){
  for (const p of weaponParts){ world.remove(p.root); releasePiece(p.root); }
  weaponParts.length = 0; weaponShown = '';
}
async function refreshWeapon(){
  const w = state.weapon, c = wClass(w.cls);
  const key = c ? c.cls + ':' + w.model + ':' + (isGlaive(c) ? kinsectModel() : '') : '';
  if (key === weaponShown && (key || !weaponParts.length)){ applyWeaponLook(); return; }
  const t = ++weaponTicket;
  if (!c){ unmountWeapon(); return; }
  if (stanceNow.key !== c.key){
    stanceNow.key = c.key; stanceNow.data = null;
    loadStance(c.key).then(T => { if (stanceNow.key === c.key) stanceNow.data = T; });
  }
  const M = MOUNT.classes[String(c.cls)];
  // a part the cart has no model for (a Long Sword without a scabbard) is not drawn: the game asks for the file by the
  // weapon's own model number and there is none
  const loaded = await Promise.all(c.parts.map(async (name, k) => {
    const file = name === 'mus' ? 'mus/mus' + pad3(kinsectModel()) : c.dir + '/' + name + pad3(w.model);
    const rec = WEAPONS.models[file];
    if (!rec || !M || !M.parts[k]) return null;
    const root = await loadPiece(rec, { wire: camBar.wireOn });
    return { root, k, part: M.parts[k], kinsect: name === 'mus' };
  }));
  if (t !== weaponTicket){ for (const p of loaded) if (p) releasePiece(p.root); return; }
  unmountWeapon();
  for (const p of loaded){
    if (!p) continue;
    const node = (gidBonesOf(p.root).find(b => b.gid === p.part.mountJoint) || {}).node || null;
    if (!node) continue;
    node.matrixAutoUpdate = false;
    p.node = node;
    world.add(p.root); weaponParts.push(p);
  }
  weaponShown = key;
  applyWeaponLook();
}
// the pigment: the class's own table (melee or gunner); the Kinsect takes none
function applyWeaponLook(){
  const c = wClass(state.weapon.cls);
  const table = c && c.gunner ? WEAPONS.pigments.gunner : WEAPONS.pigments.melee;
  const rgb = table[state.weapon.pig] || table[0];
  for (const p of weaponParts) applyColours(p.root, p.kinsect ? {} : { 3: rgb });
}

// ---- stances --------------------------------------------------------------------------------------------------------------
// WHERE THE GAME PUTS THE WEAPON ON EVERY FRAME, and which of the weapon's own motions it plays (scripts/build_stances.py
// -> stances/wNN.json, from running the game's own per-part update in an emulator, scripts/weapon_state.py). For each clip
// of the class's list (the Weapon panel's Stance, wNN), each part has a timeline of segments {f, state, bone, pos, rot,
// scale, wmot?, hide?} from clip frame f (60 a second): the hunter bone and record for the carry state the motion's
// events and the game's own rules give, and `wmot`, the weapon motions the joint code samples, in order, each [motion,
// slot, frame at f, rate]: their tracks (the stances' weapon glb, the class's weapon\<dir>\mot\wgNN list) set the
// weapon's own joints by joint id, a later one over an earlier one -- the Bow unfolding, the Switch Axe and Charge Blade
// morphing. Joint 0's tracks compose on the mount while the part is held (placeWeapon). The class's models are grouped by
// what the game does with them (`variants`); a weapon shown sheathed takes `rest`.
const STANCES = new Map();                // class key -> Promise<{ S, clips: Map name -> Map gid -> tracks }>
function loadStance(key){
  if (!STANCES.has(key))
    STANCES.set(key, (async () => {
      const S = await loadJson('stances/' + key + '.json');
      const gltf = await loadGlb(S.weapon.file, S.weapon.file);
      // a track names its node by the loader's sanitized name; the glb's own names carry the joint id ("1:1")
      const gidOf = new Map();
      for (const nd of gltf.parser.json.nodes || []){
        const m = /^\d+:(\d+)$/.exec(nd.name || '');
        if (m) gidOf.set(THREE.PropertyBinding.sanitizeNodeName(nd.name), +m[1]);
      }
      const clips = new Map();
      for (const a of gltf.animations){
        const byGid = new Map();
        for (const tr of a.tracks){
          const dot = tr.name.lastIndexOf('.');
          const gid = gidOf.get(tr.name.slice(0, dot));
          if (gid === undefined) continue;
          if (!byGid.has(gid)) byGid.set(gid, {});
          byGid.get(gid)[tr.name.slice(dot + 1)] = tr.createInterpolant();
        }
        clips.set(a.name, byGid);
      }
      return { S, clips };
    })().catch(e => { STANCES.delete(key); noteError('stances/' + key + '.json: ' + (e && e.message || e)); return null; }));
  return STANCES.get(key);
}
const stanceNow = { key: null, data: null };
const formWord = new Map();               // class key -> the form the last declared clip left (not saved)
// the weapon motion M at its own frame F -> the converter's clip and time: a motion with a loop point is split into
// Motion[M]_start (frames 0 .. loop) and Motion[M]_loop (loop .. end, repeating); others are Motion[M]
function weaponClipAt(T, M, F){
  const mo = T.S.weapon.motions[String(M)];
  if (!mo) return null;
  const end = Math.max(0, mo.frames - 1);
  if (mo.loop > 0){
    if (F < mo.loop) return { clip: T.clips.get('Motion[' + M + ']_start'), t: Math.max(0, F) / 60 };
    const span = Math.max(1, end - mo.loop);
    return { clip: T.clips.get('Motion[' + M + ']_loop'), t: ((F - mo.loop) % span) / 60 };
  }
  return { clip: T.clips.get('Motion[' + M + ']'), t: Math.min(Math.max(0, F), mo.frames) / 60 };
}
const segmentAt = (tl, f) => { let s = tl[0]; for (const x of tl){ if (x.f > f) break; s = x; } return s; };
// what plays now for the weapon on screen: the stance timelines of the Stance playing (drawn, on the class's own list),
// else the sheathed look; null while the class's stances load
function stanceState(){
  const w = state.weapon, c = wClass(w.cls);
  if (!c || stanceNow.key !== c.key || !stanceNow.data) return null;
  const T = stanceNow.data, S = T.S;
  let v = Object.keys(S.variants)[0];
  for (const k in S.variants) if (S.variants[k].models.indexOf(w.model) >= 0){ v = k; break; }
  // THE CLIP'S FORM (the Switch Axe and Charge Blade, 1 = sword): what its action declares (scripts/action_modes.py), no
  // viewer control. A clip no action declares (`vf`, built in both) plays in the form the last declared clip left, as the
  // game carries it and the MHGU viewer's setStance keeps its mode word; the sheathe form before any
  const now = nowPlaying();
  const cl = now.list === c.key ? S.clips[now.clip] : null;
  if (cl && cl.form !== undefined && w.drawn) formWord.set(c.key, cl.form);
  const form = cl && cl.form !== undefined ? cl.form : (formWord.has(c.key) ? formWord.get(c.key) : (S.formRest || 0));
  const idle = S.idle && S.idle[String(form)] && S.idle[String(form)][v] || (S.idle && S.idle['0'] && S.idle['0'][v]) || null;
  if (w.drawn && cl && pose.action){
    const frame = pose.action.time * S.fps;
    const set = cl.v || (cl.vf && cl.vf[String(form)]);
    return { T, parts: set[v], frame, idle };
  }
  return w.drawn ? null : { T, parts: S.rest[v], frame: 0 };
}
// the weapon motions for a part onto its own joints: every joint back to its bind, then each motion's tracks in order
// (joint 0 kept aside in p.root0 for the mount). `layers` are the requests whose SLOT is this part -- 0x351798's slot
// picks the part whose joints a motion drives (the Dual Blades' main code drives both blades, the Charge Blade's shield
// its own), so they are gathered from every part's segment
function poseWeaponJoints(p, T, layers, frame){
  if (!p.joints){
    const bind = new Map((p.root.userData.bind || []).map(([o, ps, q, sc]) => [o, [ps, q, sc]]));
    p.joints = gidBonesOf(p.root).filter(b => bind.has(b.node)).map(b => ({ gid: b.gid, node: b.node, bind: bind.get(b.node) }));
  }
  for (const j of p.joints) if (j.node !== p.node){ j.node.position.copy(j.bind[0]); j.node.quaternion.copy(j.bind[1]); j.node.scale.copy(j.bind[2]); }
  if (!layers || !layers.length || p.kinsect) return;
  for (const [M, f0, rate, segF] of layers){
    const at = weaponClipAt(T, M, f0 + rate * (frame - segF));
    if (!at || !at.clip) continue;
    for (const [gid, tr] of at.clip){
      const j = p.joints.find(x => x.gid === gid);
      if (!j) continue;
      if (j.node === p.node){             // joint 0: kept aside for the mount (placeWeapon)
        p.root0 = p.root0 || {};
        if (tr.position) p.root0.p = new THREE.Vector3().fromArray(tr.position.evaluate(at.t));
        if (tr.quaternion) p.root0.q = new THREE.Quaternion().fromArray(tr.quaternion.evaluate(at.t)).normalize();
        if (tr.scale) p.root0.s = new THREE.Vector3().fromArray(tr.scale.evaluate(at.t));
        continue;
      }
      if (tr.position) j.node.position.fromArray(tr.position.evaluate(at.t));
      if (tr.quaternion) j.node.quaternion.fromArray(tr.quaternion.evaluate(at.t)).normalize();
      if (tr.scale) j.node.scale.fromArray(tr.scale.evaluate(at.t));
    }
  }
}
// a part's mesh visibility: every part but the hidden ones (the stand-in layer, parts 100+, stays off); `shown` are
// parts switched ON over that (the Charge Blade's full gauge, part 3)
function maskWeapon(p, hidden, shown){
  const key = (hidden && hidden.size ? [...hidden].sort((a, b) => a - b).join() : '') + '|' + (shown ? shown.join() : '');
  if (key === p.mask) return;
  p.mask = key;
  p.root.traverse(o => {
    if (!(o.isMesh || o.isSkinnedMesh) || o.userData.proxy) return;
    const part = o.userData.part;
    o.visible = (shown && shown.indexOf(part) >= 0) || !(hidden && hidden.has(part));
  });
}
const _wm = new THREE.Matrix4(), _wl = new THREE.Matrix4(), _wi = new THREE.Matrix4(), _wr = new THREE.Matrix4();
const _v0 = new THREE.Vector3(), _q0 = new THREE.Quaternion(), _s1 = new THREE.Vector3(1, 1, 1);
const _we = new THREE.Euler(), _wq = new THREE.Quaternion(), _wp = new THREE.Vector3(), _ws = new THREE.Vector3();
const DEG = Math.PI / 180;
// every frame, after the pose: each part's mount joint = the bone's world * T R S, written as the joint's local matrix
// under its own parent
function placeWeapon(){
  if (!weaponParts.length) return;
  const roots = Object.values(mounted);
  const st = stanceState();
  // every part's segment for this frame, and the weapon-motion requests by the part (slot) they drive
  const segs = st && st.parts ? st.parts.map(tl => tl && tl.length ? segmentAt(tl, st.frame) : null) : [];
  // the mode's idle first (held at its frame), then the clip's own, each over what came before (MHGU's layering)
  const layersFor = k => ((st && st.idle && st.idle[k]) || []).map(w => [w[0], w[1], 0, 0])
    .concat(segs.flatMap(sg => (sg && sg.wmot || []).filter(w => w[1] === k).map(w => [w[0], w[2], w[3], sg.f])));
  // THE PART MASK: the mesh parts the game's code leaves off on the slot's weapon model (player data +0x5bf8 + 0x10f8 *
  // slot, +0x108 -- the Charge Blade in sword mode hides its axe blade 2 and housing 4, which share the sword's one bone),
  // gathered from every part's segment like the motions
  const hiddenFor = k => { const h = new Set(); for (const sg of segs) for (const x of (sg && sg.hide && sg.hide[k]) || []) h.add(x); return h; };
  const cb = state.weapon.cls === 14;
  for (const p of weaponParts){
    // the stance's segment for this frame where there is one, else mount.json's carry placement
    const seg = segs[p.k] || null;
    const pl = seg ? { joint: seg.bone, pos: seg.pos, rot: seg.rot, scale: seg.scale }
                   : (state.weapon.drawn ? p.part.drawn : p.part.sheathed);
    p.root0 = null;
    poseWeaponJoints(p, st && st.T, st ? layersFor(p.k) : null, st ? st.frame : 0);
    // the Charge Blade's blade at gauge level 3 also shows its part 3 (0xb47f84: part mask bit 3)
    maskWeapon(p, st ? hiddenFor(p.k) : null, cb && p.k === 0 && state.weapon.cbGauge === 3 ? [3] : null);
    p.held = seg ? seg.state : (state.weapon.drawn ? 1 : 2);
    const bone = playerBone(roots, pl.joint);
    p.root.visible = !!bone;
    if (!bone) continue;
    bone.updateWorldMatrix(true, false);
    _we.set(pl.rot[0] * DEG, pl.rot[1] * DEG, pl.rot[2] * DEG, MOUNT.order);
    _wq.setFromEuler(_we);
    _wp.set(pl.pos[0] / 100, pl.pos[1] / 100, pl.pos[2] / 100);     // cm -> the models' metres
    _ws.setScalar(pl.scale);
    _wl.compose(_wp, _wq, _ws);
    _wm.multiplyMatrices(bone.matrixWorld, _wl);
    // JOINT 0's TRACKS ride on the mount while the part is HELD (the MHGU viewer's rule: the Charge Blade's shield slides
    // along the sword into the axe head, 4U's Motion[21]); AT REST (states 2 and 3) they do not -- the game asks the
    // sheathed Charge Blade sword for its thrown-sword motion 4 at frame 0, whose joint 0 is metres away, and the sheathed
    // sword sits in its shield only without it (judged by eye: 4U's own rule is not read)
    if (p.root0 && seg && seg.state !== 2 && seg.state !== 3){
      const r = p.root0;
      _wm.multiply(_wr.compose(r.p || _v0, r.q || _q0, r.s || _s1));
    }
    const parent = p.node.parent;
    parent.updateWorldMatrix(true, false);
    p.node.matrix.multiplyMatrices(_wi.copy(parent.matrixWorld).invert(), _wm);
    p.node.matrixWorldNeedsUpdate = true;
    p.root.updateMatrixWorld(true);
  }
}

// ---- the Charge Blade's gauge and Shield Charge (game.js weaponRows: the reads are there) ----------------------------
// Both are the game's material animation (render/shade4u.js; the data is shading.json, scripts/build_shading.py), drawn
// in ANY lighting, as the MHGU Armor Viewer draws its own (Raven, 2026-10-19: "use the GU app as a guide"). With Game
// shading on they are the whole program; with it off, the same program runs without the game's lights, so what is drawn
// is the glow's own part -- the emission over the albedo and the Fresnel rim times Reflect -- over the viewer's lighting
// (GU lays its coat's emission and reflection over its standard material the same way, setMaterialOverride).
//   GAUGE (0xb47f84): the blade's gauge material -- 0x2d6b98(blade, 30): the first colour-type-30 material, in the
// .mrl's order, that has an animation set -- plays its own clip 1 from level 1 and clip 0 from level 2, by index (61
// blades' clips are the 120-frame Reflect loops 2ffb1360 / 059ea070, two blades' are 60-frame Emission loops). Below
// level 1 the game leaves the clip as it was; a fresh blade has none, which is what is drawn.
//   SHIELD CHARGE (0xcc2388 / 0xcc38f4): the shield's colour-type 0 and 3 materials, and the blade's while its hold state
// is not 2 (on the back), take the glow material (0xb06ce0) -- red while charged, yellow in the last 30 s.
function gaugeMaterial(p){
  if (p.gauge !== undefined) return p.gauge;
  let best = null, bi = Infinity;
  p.root.traverse(o => {
    const m = (o.isMesh || o.isSkinnedMesh) && o.material, s = m && m.userData.u4;
    if (s && m.userData.ct === 30 && s.entry.anim && s.entry.mi < bi){ best = m; bi = s.entry.mi; }
  });
  if (best) setGaugeLayer4u(best, true);
  return (p.gauge = best);
}
function stepCharge(tSec){
  const w = state.weapon, cb = w.cls === 14;
  const glow = cb ? [null, 'red', 'yellow'][w.shieldCharge] || null : null;
  for (const p of weaponParts){
    // the shield always; the blade while it is not on the back
    const on = glow && (p.k === 1 || (p.k === 0 && p.held !== 2)) ? glow : null;
    p.root.traverse(o => {
      const m = (o.isMesh || o.isSkinnedMesh) && o.material;
      if (m && m.userData.u4 && m.userData.u4.hasGlow) setGlow4u(m, on, tSec);
    });
    if (p.k !== 0 || !cb) continue;
    const gm = gaugeMaterial(p), clip = w.cbGauge >= 2 ? 0 : w.cbGauge === 1 ? 1 : null;
    if (gm && p.gaugeClip !== clip){ playClip4u(gm, clip, tSec); p.gaugeClip = clip; }
  }
  step4u(tSec);
}

// THE STANCE (the Weapon panel's, GU's): the class's own clips, enabled while drawn; drawing with none picked takes the
// first, as GU's does. The select's values are the clips' indices (the shared Animation panel's chain picks by index);
// the hunter keeps the clip's name.
function stanceClips(){
  const c = wClass(state.weapon.cls), P = poseSet();
  const l = c && P && P.lists.find(x => x.id === c.key);
  return (l && l.clips) || [];
}
function buildStanceList(){
  const w = state.weapon, clips = stanceClips();
  if (w.stance && !clips.some(x => x.clip === w.stance)) w.stance = '';
  if (w.drawn && !w.stance && clips.length) w.stance = clips[0].clip;
  weaponPoseSel.innerHTML = clips.map((x, i) => '<option value="' + i + '" title="' + esc(x.clip + ', ' + x.dur.toFixed(2) + ' s') + '">' + esc(x.clip) + '</option>').join('');
  const i = clips.findIndex(x => x.clip === w.stance);
  weaponPoseSel.value = i >= 0 ? String(i) : (clips.length ? '0' : '');
  weaponPoseSel.disabled = !w.drawn || !clips.length;
  fieldOf(weaponPoseSel).hidden = !wClass(w.cls);
}
weaponClassSel.onchange = async () => {
  const cls = +weaponClassSel.value;
  if (!animPanel.chainDriving) animPanel.chainStop();
  state.weapon.cls = cls; state.weapon.stance = '';      // a new class starts on its first stance
  const opts = weaponOptions(cls);
  if (opts.length){ state.weapon.model = opts[0].model; state.weapon.pig = opts[0].pig; }
  buildWeaponLists(); await refreshWeapon(); await playPose(); saveState();
  animPanel.paintChain();                                // another class's stances go muted, this one's play
};
weaponModelSel.onchange = () => {
  const [m, g] = weaponModelSel.value.split(':').map(Number);
  state.weapon.model = m; state.weapon.pig = g;
  buildWeaponLists(); refreshWeapon().then(saveState);
};
weaponDrawnSel.onchange = async () => { animPanel.chainStop(); await applyWeaponState(); saveState(); };
weaponPoseSel.onchange = async () => { animPanel.chainStop(); await applyWeaponState(); saveState(); };
cbGaugeSel.onchange = () => { state.weapon.cbGauge = +cbGaugeSel.value || 0; saveState(); };
shieldChargeSel.onchange = () => { state.weapon.shieldCharge = +shieldChargeSel.value || 0; saveState(); };
// what the Weapon panel's Carry and Stance and the Pose select say, on screen: the Animation panel's chain and previews
// set those controls and call this (base/ui/animation-panel.js applyWeaponState)
async function applyWeaponState(){
  state.weapon.drawn = weaponDrawnSel.value === '1' && state.weapon.cls >= 0;
  const clips = stanceClips();
  if (weaponPoseSel.value !== '' && clips[+weaponPoseSel.value]) state.weapon.stance = clips[+weaponPoseSel.value].clip;
  poseFromSelect();
  buildStanceList();
  await playPose();
}

// ---- the Animation panel (base/ui/animation-panel.js) ----------------------------------------------------------------------
// A stance is named to the panel by its clip (a class has one list, wNN, so a clip names it).
const stancesOfClass = () => stanceClips().map(x => ({ clip: x.clip, label: x.clip }));
// the old chain's links ({ kind: 'pose', list, clip, label } / { kind: 'stance', cls, clsName, clip, label }) in the
// panel's shape, by this gender's pose list
function chainOfOld(o){
  const poses = adapter.poseOptions(), out = [];
  for (const el of o.chain || []){
    if (!el || typeof el !== 'object' || typeof el.clip !== 'string') continue;
    if (el.kind === 'pose' && typeof el.list === 'string'){
      const i = poses.findIndex(p => p.list === el.list && p.clip === el.clip);
      if (i >= 0) out.push({ kind: 'pose', value: 'g:' + i, label: el.clip });
    } else if (el.kind === 'stance' && Number.isInteger(el.cls))
      out.push({ kind: 'stance', cls: String(el.cls), clsName: typeof el.clsName === 'string' ? el.clsName : String(el.cls),
                 clip: el.clip, label: typeof el.label === 'string' ? el.label : el.clip });
  }
  return { chain: out, chainLoop: !!o.loop };
}
const dummySel = () => ({});
const animPanel = createAnimationPanel(GAME, {
  pose,
  weapon: {
    poses: stancesOfClass,
    classJson: () => { const c = wClass(state.weapon.cls); return c ? { name: c.name } : null; },
    // GU's weapon gimmicks: 4U has the Kinsect (the Insect Glaive's own row); no Form control (the clip's action
    // declares the form), no Arrow, no Kinsect element or motion
    setForm(){}, step(){}, setArrow(){},
    setKinsect: async v => { if (v !== null) state.weapon.kinsect = +v; await refreshWeapon(); },
    setKinsectElement(){}, setKinsectMotion: async () => {},
  },
  weaponClassSel, weaponPoseSel, weaponDrawnSel,
  weaponFormSel: document.getElementById('weaponForm'),
  arrowSel: dummySel(), kinsectSel, kinsectElSel: dummySel(), kinsectMotSel: dummySel(),
  applyWeaponState,
  buildPoseList: () => rebuildPoseList(),
  get saveState(){ return saveState; },
  get SAVED(){ return savedChain && savedChain.old ? chainOfOld(savedChain.old) : savedChain; },
});

// ---- Guild Info (base/ui/guild-panel.js): the Guild Card title words; 4U's name plate is not read ----------------------
const HUNTERS = [];
let hunterIndex = 0, hunterBusy = false, hunterRenaming = false, hunterBoot = true;
const guildPanel = createGuildPanel(GAME, {
  get HUNTERS(){ return HUNTERS; },
  get activeMounts(){ return activeMounts; },
  get figure(){ return 'hunter'; },
  get figureCenter(){ return figureCenter; },
  get hunterIndex(){ return hunterIndex; },
  get playerBone(){ return playerBone; },
  get renderer(){ return renderer; },
  get saveState(){ return saveState; },
  get scene(){ return scene; },
  get weaponClassSel(){ return weaponClassSel; },
});
const { applyPlateFile, paintPlate, plateFileState, plateUpdate, restorePlate } = guildPanel;

// ---- Capture (base/ui/capture.js) ------------------------------------------------------------------------------------------
const capturePanel = createCapture(GAME, {
  get camPanel(){ return camPanel; },
  get camera(){ return camera; },
  get captureName(){ return captureName; },
  get fx(){ return fx; },
  get head(){ return head; },
  get lightPanel(){ return lightPanel; },
  get renderFrame(){ return renderFrame; },
  get renderer(){ return renderer; },
  get setIcon(){ return setIcon; },
  get setLabel(){ return setLabel; },
});
const { recFrame } = capturePanel;
function captureName(ext){
  const who = (HUNTERS[hunterIndex] && HUNTERS[hunterIndex].name) || 'Hunter';
  return 'MH4U ' + who + ' ' + new Date().toISOString().slice(0, 10) + '.' + ext;
}

// ---- the session, the look and the set file -------------------------------------------------------------------------------
// The look (lighting, effects, the Camera panel and the camera bar's settings) rides beside the hunter as `look`; the
// hunter slots as `hunters` / `hunter`; the chain and the Guild Info titles as their own fields.
function lookState(){
  return Object.assign(lightPanel.save(), {
    postfx: fxPanel.save(),
    camera: { fov: +camera.fov.toFixed(2), lens: lensFileState(), orbitLocked: camPanel.orbitLocked,
              spinStep: camBar.spinStep, spinRev: camBar.spinRev, damp: controls.enableDamping,
              zoomCursor: !!controls.zoomToCursor, face: camPanel.faceLock, flySpeed: +fly.speed.toFixed(3),
              wire: camBar.wireOn, cursor: camBar.hideCursor, grid: camBar.floorGridOn } });
}
// every field type-guarded: a save is whatever the last version of the app wrote
function restoreLook(o){
  if (!o || typeof o !== 'object'){ lightPanel.apply('studio'); return; }
  if ((o.lightRig && typeof o.lightRig === 'object') || typeof o.lighting === 'string') lightPanel.restore(o);
  else lightPanel.apply('studio');
  if (o.postfx && typeof o.postfx === 'object') fxPanel.restore(o.postfx);
  const c = o.camera;
  if (!c || typeof c !== 'object') return;
  if (Number.isFinite(c.fov)) setFov(c.fov);
  if (c.lens && typeof c.lens === 'object') applyLens(c.lens);
  if (typeof c.orbitLocked === 'boolean') camPanel.orbitLocked = c.orbitLocked;
  if (typeof c.spinStep === 'number') camBar.spinStep = Math.max(0, c.spinStep | 0) % camBar.SPIN_STEPS.length;
  if (typeof c.spinRev === 'boolean') camBar.spinRev = c.spinRev;
  if (typeof c.damp === 'boolean') controls.enableDamping = c.damp;
  if (typeof c.zoomCursor === 'boolean') controls.zoomToCursor = c.zoomCursor;
  document.getElementById('camDamp').checked = controls.enableDamping;
  document.getElementById('camZoomCursor').checked = !!controls.zoomToCursor;
  if (typeof c.face === 'boolean') setFaceLock(c.face);
  if (Number.isFinite(c.flySpeed)) setFlySpeed(c.flySpeed);
  if (typeof c.wire === 'boolean') camBar.wireOn = c.wire;
  if (typeof c.cursor === 'boolean') camBar.hideCursor = c.cursor;
  if (typeof c.grid === 'boolean') camBar.floorGridOn = c.grid;
  paintOrbitLock(); camBar.paintSpin(); camBar.paintWire(); camBar.paintCursor(); camBar.paintFloorGrid();
}
// the hunter on screen as a set and a slot keep it: its state, with the pigment rows read off the panel
function hunterNow(){ state.pig = pigStateOfRows(); state.pigDev = pigPanel.slotDevState(); return hunterOf(state); }
function saveState(){
  if (restoring) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Object.assign({ v: 2 }, hunterNow(), { look: lookState(), plate: plateFileState() },
      hunterSaveState(), animPanel.chainSaveState())));
  } catch (_) {}
}
function currentSet(){
  return { app: 'MH4U Armor Viewer', version: 1, hunter: hunterNow(), lighting: lightPanel.fileState(),
           effects: fxPanel.save(), view: cameraState(), plate: plateFileState() };
}
const isSet = d => !!d && typeof d === 'object' && (d.app === 'MH4U Armor Viewer' || (d.hunter && typeof d.hunter === 'object'));
// A set onto the page: the hunter, then its lighting, effects and Guild Info where it has them, then its view -- or, with
// none or { view: false }, a fresh framing of the hunter. A hunter slot banked before the shared base keeps its lighting
// as the session's shape (lighting + lightRig).
async function applySet(d, opt){
  opt = opt || {};
  if (!d || typeof d !== 'object') d = {};
  Object.assign(state, hunterOf(d.hunter));
  paintArmorSelects(); paintHunterRows(); buildWeaponLists();
  applyPigRows(state.pig, state.pigDev);
  await refresh();
  applyPigRows(state.pig, state.pigDev);   // the Default rows again, now the pieces are worn
  await playPose();
  if (d.lighting && typeof d.lighting === 'object') lightPanel.applyFile(d.lighting);
  else if ((d.lightRig && typeof d.lightRig === 'object') || typeof d.lighting === 'string') lightPanel.restore(d);
  if (d.effects && typeof d.effects === 'object') fxPanel.restore(d.effects);
  if ('plate' in d || opt.plate) applyPlateFile(d.plate);
  if (!(opt.view !== false && applyCameraState(d.view))) frameAll();
}
const saveOpen = createSaveOpen(GAME, { currentSet, isSet, applySet: d => applyLoadedSet(d) });
async function applyLoadedSet(d){
  if (hunterBusy) return;
  hunterBusy = true; setLoading(true);
  try { await applySet(d, { plate: true }); } finally { hunterBusy = false; setLoading(false); }
  saveState();
}

// ---- hunter slots ---------------------------------------------------------------------------------------------------------------
// The MHGU Armor Viewer's hunter slots (the shared base's Hunter Slots panel). A slot is a named hunter, { name, set }.
// The set is what the page shows of that hunter: what it wears, its face, hair, clothing, colours, pigment, motion and
// weapon (`hunter`, the shape of `state`), its lighting and effects, its Guild Info titles, and its view. Switching banks
// the hunter on screen into its slot and applies the other; a slot without lighting, effects or a view keeps what is on
// screen and frames the hunter. A first visit starts with two slots: the default female hunter and the default male.
const hunterList = document.getElementById('hunterList');
const escHtml = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function freeHunterName(){
  for (let n = 1; ; n++){ const nm = 'Hunter ' + n; if (!HUNTERS.some(h => h.name === nm)) return nm; }
}
{
  const savedHunters = SAVED && SAVED.hunters, savedHunter = SAVED && SAVED.hunter;
  const valid = h => h && typeof h === 'object' && typeof h.name === 'string' && h.name.trim() &&
                     (h.set === null || (h.set && typeof h.set === 'object'));
  if (Array.isArray(savedHunters) && savedHunters.some(h => valid(h) && h.set)){
    for (const h of savedHunters) if (valid(h)) HUNTERS.push({ name: h.name.trim().slice(0, 40), set: h.set, fresh: !!h.fresh });
    hunterIndex = Number.isInteger(savedHunter) && HUNTERS[savedHunter] ? savedHunter : 0;
  } else {
    HUNTERS.push({ name: 'Hunter 1', set: null });          // banked from the page once it is dressed
    if (!savedAny)                                          // a first visit: the other body, untouched
      HUNTERS.push({ name: 'Hunter 2', set: { hunter: Object.assign(clone(DEFAULTS), { g: state.g === 'f' ? 'm' : 'f' }) }, fresh: true });
  }
}
// the view the slot on screen was left with, taken before anything banks over it; the boot puts it back
const bootView = HUNTERS[hunterIndex] && HUNTERS[hunterIndex].set ? HUNTERS[hunterIndex].set.view : null;
function bankHunter(){ if (!hunterBusy && !hunterBoot && HUNTERS[hunterIndex]) HUNTERS[hunterIndex].set = currentSet(); }
// what saveState writes: the slots with the one on screen freshly banked. A hoisted function, so saveState can name it
function hunterSaveState(){
  try {
    bankHunter();
    if (!hunterRenaming) paintHunters();
    return { hunters: HUNTERS.map(h => ({ name: h.name, set: h.set, fresh: h.fresh || undefined })), hunter: hunterIndex };
  } catch (_) { return {}; }
}
function paintHunters(){
  hunterList.innerHTML = HUNTERS.map((h, i) => {
    const g = i === hunterIndex ? state.g : (h.set && h.set.hunter && h.set.hunter.g) || 'f';
    return '<li class="' + (i === hunterIndex ? 'on' : '') + '" data-k="' + i + '" title="' + (i === hunterIndex ? 'The hunter on screen' : 'Switch to this hunter') + '">' +
           '<span class="n">' + (i + 1) + '.</span><span class="lab">' + escHtml(h.name) + '</span>' +
           '<span class="tag">' + (g === 'm' ? 'Male' : 'Female') + '</span></li>';
  }).join('');
  document.getElementById('hunterDelete').disabled = HUNTERS.length < 2;
}
async function switchHunter(k, opt){
  opt = opt || {};
  if (!HUNTERS[k] || (k === hunterIndex && !opt.force) || hunterBusy) return;
  if (!opt.noBank) bankHunter();     // before the busy flag goes up: the bank skips while busy
  hunterBusy = true;
  setLoading(true);
  try {
    const to = HUNTERS[k];
    hunterIndex = k; paintHunters();
    // the Guild Info titles are the hunter's own: a slot without them shows none (GU's rule)
    await applySet(to.set, { plate: true });
    delete to.fresh;
  } finally { hunterBusy = false; setLoading(false); }
  paintPlate();
  saveState();
}
hunterList.onclick = e => {
  const li = e.target && e.target.closest ? e.target.closest('li') : null;
  if (!li || hunterRenaming) return;
  switchHunter(+li.dataset.k);
};
// Copy: a new hunter, a copy of the one on screen
document.getElementById('hunterCopy').onclick = () => {
  if (hunterBusy) return;
  bankHunter();
  HUNTERS.push({ name: freeHunterName(), set: currentSet() });
  hunterIndex = HUNTERS.length - 1;
  paintHunters(); saveState();
};
// New: a hunter of this gender with every Hunter option on its default (GU's): the view's own settings -- the weapon in
// hand, the lighting, the effects and the camera -- stay as they are; the Guild Info titles are the hunter's own, so the
// new one has none
document.getElementById('hunterNew').onclick = async () => {
  if (hunterBusy) return;
  bankHunter();
  const hunter = Object.assign(clone(DEFAULTS), { g: state.g, weapon: clone(state.weapon) });
  HUNTERS.push({ name: freeHunterName(), set: { hunter, view: cameraState() } });
  await switchHunter(HUNTERS.length - 1, { noBank: true });
};
document.getElementById('hunterRename').onclick = () => {
  const li = hunterList.querySelector('li.on'); if (!li || hunterRenaming) return;
  const lab = li.querySelector('.lab'), h = HUNTERS[hunterIndex];
  const inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 40; inp.value = h.name;
  hunterRenaming = true;
  lab.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = keep => {
    if (done) return; done = true; hunterRenaming = false;
    const v = inp.value.trim();
    if (keep && v) h.name = v.slice(0, 40);
    paintHunters(); saveState();
  };
  inp.onkeydown = ev => { if (ev.key === 'Enter') finish(true); else if (ev.key === 'Escape') finish(false); };
  inp.onblur = () => finish(true);
};
document.getElementById('hunterDelete').onclick = async () => {
  if (HUNTERS.length < 2 || hunterBusy) return;
  const h = HUNTERS[hunterIndex];
  if (!confirm('Delete ' + h.name + '? Its look is lost.')) return;
  HUNTERS.splice(hunterIndex, 1);
  const next = Math.min(hunterIndex, HUNTERS.length - 1);
  hunterIndex = -1;
  await switchHunter(next, { noBank: true, force: true });
};
// Reset: the defaults for the hunter on screen -- its gender kept, no armour, the first face, hair and clothing, the
// starting colours and motion, the Studio lighting, no effects and a fresh framing. It replaces a slot's look, so it
// asks first.
document.getElementById('resetBtn').onclick = async () => {
  if (hunterBusy) return;
  const h = HUNTERS[hunterIndex];
  if (!confirm('Reset ' + (h ? h.name : 'the hunter') + ' (' + (state.g === 'm' ? 'male' : 'female') + ') to the defaults? The current look is replaced.')) return;
  filterEl.value = '';
  hunterBusy = true; setLoading(true);
  try {
    await applySet({ hunter: Object.assign(clone(DEFAULTS), { g: state.g }), lighting: { preset: 'studio' }, effects: { preset: 'off' } },
                   { view: false });
  } finally { hunterBusy = false; setLoading(false); }
  saveState();
};

// ---- the loop ---------------------------------------------------------------------------------------------------------------
addEventListener('resize', fitRenderer);
new ResizeObserver(fitRenderer).observe(viewport);
fitRenderer();
renderer.setAnimationLoop(() => {
  if (pose.mixer) pose.step(Object.values(mounted));
  placeWeapon();                           // the weapon follows the bones the pose just set
  const now = performance.now() / 1000;
  pigPanel.stepDeviant(now);               // a Rainbow pigment row steps (the game's own table and blend)
  stepCharge(now);                         // the Charge Blade's gauge and Shield Charge
  fitPlanes(); updateDepthBias();
  animPanel.paintAnim(); animPanel.stepChainHold();
  lightPanel.step();                       // the key light's orbit
  if (camPanel.camMode === 'fly') stepFly(); else controls.update();   // update() would look at the target
  lightPanel.track(); head.position.copy(camera.position);
  renderFrame();
  recFrame();
});

// ---- the boot ---------------------------------------------------------------------------------------------------------------
restoreLook(SAVED && SAVED.look);
paintCamMode(); paintFlySpeed();
paintArmorSelects(); paintHunterRows(); buildWeaponLists();
applyPigRows(state.pig, state.pigDev);
await refresh();
applyPigRows(state.pig, state.pigDev);     // the Default rows take the worn pieces' own colours
await playPose();
animPanel.paintChain();
if (SAVED && SAVED.plate) restorePlate(SAVED.plate); else paintPlate();
frameAll();
// the slot on screen comes back with the view it was left with, as the MHGU Armor Viewer's does
if (bootView) applyCameraState(bootView);
restoring = false;
hunterBoot = false;
bankHunter(); paintHunters(); saveState();   // the hunter on screen into its slot, now that it is dressed
document.dispatchEvent(new Event('viewer-ready'));   // the side panels unlock (base/ui/shell.js)

Object.assign(window.__view, { DATA, state, mounted, scene, camera, controls, world, pose, refresh, frameAll, playPose,
                  applyAllColours, applyHelmMasks, applyEye, renderer, setFocal, setFov, lookState, restoreLook, currentSet, applySet,
                  pigPanel, armorPanel, hunterPanel, animPanel, camPanel, camBar, lightPanel, fxPanel, guildPanel, saveOpen,
                  weaponPanel, slotPigment, pigmentOf,
  weapon: { parts: () => weaponParts.map(p => ({ type: p.part.type, k: p.k, held: p.held, node: p.node, root: p.root })),
            place: placeWeapon, refresh: refreshWeapon, MOUNT, stance: stanceState, playing: nowPlaying,
            stances: stancesOfClass, charge: stepCharge },
  hunters: { list: () => HUNTERS.map((h, i) => ({ name: h.name, g: i === hunterIndex ? state.g : (h.set && h.set.hunter && h.set.hunter.g) || null,
                                                   banked: !!h.set, fresh: !!h.fresh })),
             index: () => hunterIndex, switchTo: k => switchHunter(k) },
  aimPoint: () => camPanel.aimPoint(new THREE.Vector3()).toArray(),
});
