// THE LIGHTING PANEL of the shared viewer base (docs/base/ui; the plan: C:\\Coding Repos\\VIEWER-BASE-PLAN.md): the
// presets (GU's: Raven, 2026-10-18, "Lighting presets are GU's"), the key / rim / fill / ambient rig the sliders edit,
// the headlight and the key's orbit, and the rig's place fixed to the VIEW. Moved verbatim from GU's index.html
// (2026-10-18). The lights themselves are docs/base/render/stage.js's (stage.lights).
//   createLightingPanel(game, ctx) wires the panel's controls (ids lightRow, lKeyAz, lKeyEl, lKey, lKeyCol, lRim, lFill,
// lAmb, lHead, lSpin) and returns the panel: `.name` (the preset, 'custom' once a slider moves), `.rig`, `.presets`,
// apply(name), restore(saved) (the session save's shape), save(), fileState() / applyFile(l) (the set file's shape; a
// file or a slot without one keeps the rig on screen), step() (the orbit, every frame), track() (the rig follows the
// view's yaw, every frame). ctx: { stage, scene, camera() (the view camera), onChange() (the app's save) }.
//   A game whose ambient model differs supplies it apart (GU's SH ambient is docs/render/rom/ambient.js, the app's).
import * as THREE from 'three';

export function createLightingPanel(game, ctx){
  const _fwd = new THREE.Vector3();
  // Lighting presets (Raven, 2026-09-04: "Let's do presets to start"). Each is the whole
  // six-light rig: the hemisphere's sky and ground, the key, rim and fill (colour, intensity
  // and position), the ambient, and the headlight's intensity for when the headlight is on.
  // Rebalanced the same day after Raven: "turning the model doesn't change where the lighting
  // applies". The first cut was a balanced studio -- a key front-right, a rim of similar weight
  // behind-left, a light riding on the camera, a high ambient floor -- so every angle saw much
  // the same light. Now the key carries the scene, the rim is a rim, the floor is low and the
  // headlight is off unless asked for; lit side to far side is about 2:1 in Studio. Even is flat
  // on purpose,
  // for reading dye colours. The sphere-map sheen still follows the camera: the game samples
  // it by the view-space normal, so that part is right as it is.
  const LIGHT_PRESETS = {
    studio: { hemi: [0xbfd4ff, 0x30281f, 0.8], key: [0xffffff, 3.0, [3, 5, 4]], rim: [0x88aaff, 0.9, [-4, 3, -5]],
              fill: [0xffffff, 0.35, [0, -3, 2]], ambient: [0xffffff, 0.25], head: 0.9 },
    warm:   { hemi: [0xffe3c2, 0x3a2a1c, 0.7], key: [0xffd9a8, 3.1, [4, 4, 3]], rim: [0xff9a5a, 0.8, [-4, 3, -5]],
              fill: [0xffe9d0, 0.3, [0, -3, 2]], ambient: [0xffe6cc, 0.25], head: 0.8 },
    cool:   { hemi: [0xc9dcff, 0x1e2430, 0.8], key: [0xdbe8ff, 2.9, [3, 5, 4]], rim: [0x9ec6ff, 1.2, [-5, 3, -4]],
              fill: [0xd8e6ff, 0.3, [0, -3, 2]], ambient: [0xdde8ff, 0.25], head: 0.9 },
    even:   { hemi: [0xffffff, 0xffffff, 1.2], key: [0xffffff, 1.2, [0, 5, 5]], rim: [0xffffff, 0.8, [0, 3, -5]],
              fill: [0xffffff, 0.8, [0, -3, 2]], ambient: [0xffffff, 1.2], head: 0.6 },
    rim:    { hemi: [0x8fa8d0, 0x101418, 0.4], key: [0xffffff, 0.8, [3, 5, 4]], rim: [0xbfd8ff, 2.6, [-4, 3, -5]],
              fill: [0xffffff, 0.15, [0, -3, 2]], ambient: [0xffffff, 0.15], head: 0.3 },
    dusk:   { hemi: [0x6f7fb0, 0x2a1a12, 0.6], key: [0xffb070, 2.6, [5, 2, 2]], rim: [0x6f8cff, 0.9, [-4, 2, -5]],
              fill: [0xffc9a0, 0.25, [0, -3, 2]], ambient: [0xa88c78, 0.25], head: 0.6 }
  };
  // The rig the panel's sliders edit (Raven, 2026-09-04: "Can we add more dynamic lighting"):
  // the key light's direction as an angle around the figure and a height, its strength and
  // colour, the rim / fill / ambient strengths, the headlight, and a slow orbit for the key.
  // A preset fills the rig in and lights the buttons; touching a slider makes it "custom"
  // (no button lit). The rim and fill keep the preset's colours and positions; only the key
  // moves. Saved with the state, preset name and rig both, so a custom rig survives a reload.
  const KEY_RADIUS = 7;
  // The rig is fixed to the VIEW, not the world (Raven, 2026-09-04: "turning the model doesn't
  // change where the lighting applies"; then, with a red key: "rotating the model, the back
  // remained lit despite doing a full 180"). Orbiting is how the figure is turned, and Raven
  // expects a turntable: the lights stay where they are around the viewer and the figure turns
  // through them, so a key at 40 degrees lights the front from the front view and the back
  // from the back view. World-fixed lights (the first cut, twice) turn WITH the figure, so the
  // lit regions on it never change however it is turned. So the key, rim and fill live in a
  // group whose yaw follows the camera's around the orbit target; the hemisphere keeps the
  // world's up and the headlight rides on the camera as before.
  const lightRigGroup = new THREE.Group(); lightRigGroup.name = 'lightRig';
  ctx.scene.add(lightRigGroup);
  lightRigGroup.add(ctx.stage.lights.key, ctx.stage.lights.rim, ctx.stage.lights.fill);
  function trackLights(){
    // the yaw of the view itself: for the orbit camera this is exactly the camera-to-target
    // angle it used to take, and it holds for the first-person camera, which has no target
    ctx.camera().getWorldDirection(_fwd);
    lightRigGroup.rotation.y = Math.atan2(-_fwd.x, -_fwd.z);
  }

  let lightingName = 'studio';
  let lightRig = null;
  let lightSpinAt = 0;
  function rigFromPreset(P){
    const [x, y, z] = P.key[2], len = Math.hypot(x, y, z) || 1;
    return { preset: P, az: (THREE.MathUtils.radToDeg(Math.atan2(x, z)) + 360) % 360,
             el: THREE.MathUtils.radToDeg(Math.asin(y / len)),
             key: P.key[1], keyColor: '#' + P.key[0].toString(16).padStart(6, '0'),
             rim: P.rim[1], fill: P.fill[1], ambient: P.ambient[1], head: false, spin: false };
  }
  function keyPosition(){
    const az = THREE.MathUtils.degToRad(lightRig.az + lightSpinAt), el = THREE.MathUtils.degToRad(lightRig.el);
    ctx.stage.lights.key.position.set(KEY_RADIUS * Math.cos(el) * Math.sin(az), KEY_RADIUS * Math.sin(el), KEY_RADIUS * Math.cos(el) * Math.cos(az));
  }
  function applyRig(){
    const P = lightRig.preset, L = ctx.stage.lights;
    L.hemi.color.setHex(P.hemi[0]); L.hemi.groundColor.setHex(P.hemi[1]); L.hemi.intensity = P.hemi[2];
    for (const k of ['rim', 'fill']){ L[k].color.setHex(P[k][0]); L[k].position.set(P[k][2][0], P[k][2][1], P[k][2][2]); }
    L.ambient.color.setHex(P.ambient[0]);
    L.key.color.set(lightRig.keyColor); L.key.intensity = lightRig.key;
    L.rim.intensity = lightRig.rim; L.fill.intensity = lightRig.fill; L.ambient.intensity = lightRig.ambient;
    L.head.intensity = lightRig.head ? P.head : 0;
    keyPosition();
    document.querySelectorAll('#lightRow .btn').forEach(b => b.classList.toggle('on', b.dataset.light === lightingName));
    const set = (id, v) => { const e = document.getElementById(id); if (e && document.activeElement !== e) e.value = v; };
    set('lKeyAz', Math.round(lightRig.az)); set('lKeyEl', Math.round(lightRig.el)); set('lKey', lightRig.key); set('lKeyCol', lightRig.keyColor);
    set('lRim', lightRig.rim); set('lFill', lightRig.fill); set('lAmb', lightRig.ambient);
    document.getElementById('lHead').checked = lightRig.head; document.getElementById('lSpin').checked = lightRig.spin;
  }
  function applyLighting(name){
    lightingName = LIGHT_PRESETS[name] ? name : 'studio';
    lightRig = rigFromPreset(LIGHT_PRESETS[lightingName]);
    lightSpinAt = 0;
    applyRig();
  }
  // a slider edit keeps the preset's colours and positions but the rig is now the user's
  function rigEdit(){
    lightingName = 'custom';
    lightRig.az = +document.getElementById('lKeyAz').value; lightRig.el = +document.getElementById('lKeyEl').value;
    lightRig.key = +document.getElementById('lKey').value; lightRig.keyColor = document.getElementById('lKeyCol').value;
    lightRig.rim = +document.getElementById('lRim').value; lightRig.fill = +document.getElementById('lFill').value;
    lightRig.ambient = +document.getElementById('lAmb').value;
    lightRig.head = document.getElementById('lHead').checked; lightRig.spin = document.getElementById('lSpin').checked;
    applyRig();
  }
  // the orbit: a slow turn of the key light around the figure, one lap in 12 s. Timed on its
  // own clock, so a stalled frame (a hidden tab) cannot fling it round
  let lightPrev = 0;
  function stepLighting(){
    const now = performance.now();
    const dt = lightPrev ? Math.min((now - lightPrev) / 1000, 0.1) : 0;
    lightPrev = now;
    if (!lightRig || !lightRig.spin) return;
    lightSpinAt = (lightSpinAt + dt * 30) % 360;
    keyPosition();
  }
  // what the save keeps, and what a restored save gives back
  function lightingSaveState(){
    if (!lightRig) return {};
    const r = Object.assign({}, lightRig); delete r.preset;
    return { lighting: lightingName, lightRig: Object.assign(r, { base: presetNameOf(lightRig.preset) }) };
  }
  function presetNameOf(P){ for (const k in LIGHT_PRESETS) if (LIGHT_PRESETS[k] === P) return k; return 'studio'; }
  function restoreLighting(saved){
    if (saved && saved.lightRig && typeof saved.lightRig === 'object'){
      const r = saved.lightRig, base = LIGHT_PRESETS[r.base] || LIGHT_PRESETS.studio;
      lightRig = Object.assign(rigFromPreset(base), {
        az: +r.az || 0, el: Number.isFinite(+r.el) ? +r.el : 45, key: Number.isFinite(+r.key) ? +r.key : base.key[1],
        keyColor: /^#[0-9a-f]{6}$/i.test(r.keyColor) ? r.keyColor : rigFromPreset(base).keyColor,
        rim: Number.isFinite(+r.rim) ? +r.rim : base.rim[1], fill: Number.isFinite(+r.fill) ? +r.fill : base.fill[1],
        ambient: Number.isFinite(+r.ambient) ? +r.ambient : base.ambient[1], head: r.head === true, spin: !!r.spin });
      lightingName = LIGHT_PRESETS[saved.lighting] ? saved.lighting : 'custom';
      applyRig();
    } else applyLighting(saved && saved.lighting);
  }
  // The set file's shape (Save / Save As, and each hunter slot's bank, since a slot banks
  // currentSet): the preset by name and the rig spelled out, so a shared file reads plainly
  // (Raven, 2026-09-04: "I want it to be stored by slot and to the JSON"). A file or a slot
  // without one keeps the rig on screen, as a slot without a camera keeps the view.
  function lightingFileState(){
    if (!lightRig) return null;
    return { preset: lightingName, base: presetNameOf(lightRig.preset),
             keyAngle: Math.round(lightRig.az * 10) / 10, keyHeight: Math.round(lightRig.el * 10) / 10,
             key: lightRig.key, keyColor: lightRig.keyColor, rim: lightRig.rim, fill: lightRig.fill,
             ambient: lightRig.ambient, headlight: !!lightRig.head, orbit: !!lightRig.spin };
  }
  function applyLightingFile(l){
    if (!l || typeof l !== 'object') return;
    if (l.keyAngle === undefined && LIGHT_PRESETS[l.preset]){ applyLighting(l.preset); return; }   // a preset alone
    restoreLighting({ lighting: l.preset, lightRig: {
      base: l.base, az: l.keyAngle, el: l.keyHeight, key: l.key, keyColor: l.keyColor, rim: l.rim, fill: l.fill,
      ambient: l.ambient, head: l.headlight === true, spin: l.orbit === true } });
  }
  document.querySelectorAll('#lightRow .btn').forEach(b => b.onclick = () => { applyLighting(b.dataset.light); ctx.onChange(); });
  for (const id of ['lKeyAz', 'lKeyEl', 'lKey', 'lKeyCol', 'lRim', 'lFill', 'lAmb']){
    const e = document.getElementById(id); e.oninput = rigEdit; e.onchange = () => { rigEdit(); ctx.onChange(); };
  }
  for (const id of ['lHead', 'lSpin']) document.getElementById(id).onchange = () => { rigEdit(); ctx.onChange(); };

  return {
    get name(){ return lightingName; },
    get rig(){ return lightRig; },
    presets: LIGHT_PRESETS,
    apply: applyLighting, restore: restoreLighting, save: lightingSaveState,
    fileState: lightingFileState, applyFile: applyLightingFile, step: stepLighting, track: trackLights
  };
}
