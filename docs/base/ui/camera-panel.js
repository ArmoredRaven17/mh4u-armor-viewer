// THE CAMERA PANEL of the shared viewer base (docs/base/ui; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md): the
// first-person camera (flight, look, speed, face lock), the aim point and the focus distance it gives the depth of field,
// the orbit lock, the camera's saved state, the field of view / focal length and the lens types. Moved verbatim from
// GU's index.html (2026-10-18). createCameraPanel(game, ctx): ctx names the app's own objects lazily (stage pieces, the
// pose, the figure's bounds, the save); game.aimJoints names the joints the aim takes.
import * as THREE from 'three';
import { renderCameraFor, LENS_DEFAULT, LENS_TYPES, SQUEEZES } from '../render/lens.js';

export function createCameraPanel(game, ctx){
  // ---- The first-person camera (Raven, 2026-09-04: a user "wanted like a FPS camera where they
  // can move around like a game character with WASD and Mouse"; planned as the first of the
  // advanced camera functions). A MODE beside the orbit camera, 'orbit' | 'fly'. Spectator
  // fly: W/S move where you look, up and down included, A/D strafe level, Q/C down, E/Space
  // up, Shift three times faster, the wheel changes the speed. Mouse look takes the pointer
  // lock on a click in the view (a game's capture), Esc frees the mouse; the keys act ONLY
  // while the mouse is captured, so they can never land in the sidebar's controls, and the
  // camera flies only then. Yaw turns about the world's up and pitch about the camera's own
  // X, roll never (YXZ with z = 0, the PointerLockControls convention), so the horizon stays
  // level. OrbitControls is switched off in fly and back on when the view returns to orbit,
  // with the target put back on the figure so orbiting resumes around it. ----
  let camMode = 'orbit';
  const FLY_SPEED = 1.2, FLY_FAST = 3, FLY_TAU = 0.08, FLY_SENS = 0.0025;
  const FLY_SPEED_MIN = 0.05, FLY_SPEED_MAX = 20, FLY_PITCH_MAX = THREE.MathUtils.degToRad(89);
  const FLY_KEYS = { KeyW: 'f', KeyS: 'b', KeyA: 'l', KeyD: 'r', KeyE: 'u', Space: 'u', KeyQ: 'd', KeyC: 'd',
                     ShiftLeft: 'fast', ShiftRight: 'fast' };      // e.code: the physical WASD cluster
  const fly = { yaw: 0, pitch: 0, speed: FLY_SPEED, vel: new THREE.Vector3(), keys: new Set(), prev: 0, moved: false, skip: 0 };
  let flyAnchor = null;                 // the figure's centre when no pose supplies one
  const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _fc = new THREE.Vector3(), _want = new THREE.Vector3(), _eul = new THREE.Euler(), _q = new THREE.Quaternion();
  const _aim = new THREE.Vector3(), _off = new THREE.Vector3();
  const flyEl = ctx.renderer.domElement, flyBtn = document.getElementById('flyBtn');
  const FLY_TIP_OFF = 'Fly the camera: WASD moves, the mouse looks. Click the view to look around, Esc frees the mouse';
  const FLY_TIP_ON = 'On. Click the view to look around, Esc frees the mouse; press again for the orbit camera';
  const flyLocked = () => document.pointerLockElement === flyEl;
  function applyFlyLook(){ ctx.camera.quaternion.setFromEuler(_eul.set(fly.pitch, fly.yaw, 0, 'YXZ')); }
  function flyFromCamera(){
    _eul.setFromQuaternion(ctx.camera.quaternion, 'YXZ');
    fly.yaw = _eul.y; fly.pitch = Math.min(FLY_PITCH_MAX, Math.max(-FLY_PITCH_MAX, _eul.x));
    applyFlyLook();
  }
  function flyTurn(dyaw, dpitch){
    fly.yaw += dyaw; fly.pitch = Math.min(FLY_PITCH_MAX, Math.max(-FLY_PITCH_MAX, fly.pitch + dpitch));
    applyFlyLook(); fly.moved = true;
  }
  // the figure's centre: the playing pose's own, else the one seeded when fly began, else the
  // orbit target
  function figureCenter(out){ return out.copy(ctx.pose.center || flyAnchor || ctx.controls.target); }
  // The aim point (Raven, 2026-09-04: "locking focus on the hunter"): the head or chest bone of
  // the figure on screen, live, or its centre. Shared by the depth of field's focus follow and
  // the first-person face lock; the Palico's head and chest are not mapped, so it takes the
  // centre. The choice lives in the effects state (dof.aim) so it saves with the rest.
  // the joint ids by aim, the game's skeleton's (game.aimJoints; GU's hunter: head 4, chest 2)
  const AIM_GID = game.aimJoints || {};
  function aimPoint(out){
    const gid = AIM_GID[ctx.fxPanel.state.dof.aim];
    const b = gid !== undefined && ctx.figure !== 'palico' ? ctx.playerBone(ctx.activeMounts(), gid) : null;
    if (!b) return figureCenter(out);
    b.getWorldPosition(out);
    // the joint is the skull's base; aim at the head's middle (game.aimHeadLift: GU 0.1, MH3U 0.05 measured)
    if (ctx.fxPanel.state.dof.aim === 'head') out.y += (game.aimHeadLift != null ? game.aimHeadLift : 0.1);
    return out;
  }
  // The focus goes to the SURFACE the aim point is seen through, not to the joint under it:
  // the head joint sits at the back of the skull, so a focus at its depth left the face 23 cm
  // in front of the plane and the chest sharper than the head (Raven, 2026-09-04: "Depth of
  // Field when focused on the head, still has the chest more in focus than the head"). A ray
  // from the camera to the aim point finds the first visible surface. Skinned meshes make a
  // cast cost a few milliseconds, so it runs every few frames (fewer when it is slow) and the
  // last answer is kept between; a shot asks for a fresh one.
  const _ray = new THREE.Raycaster(); const aimHit = { depth: 0, at: -1, every: 6, cost: 0, hit: false };
  // A skinned mesh's bounding sphere is computed once (three r169), in the pose it had then; under a clip the ray is
  // rejected before any triangle and the focus falls back to the joint's depth (the MH3U Monster Viewer, Rathian,
  // 2026-10-04). game.aimRefreshSkinBounds recomputes the shown ones before a cast -- opt-in: it costs a pass over the
  // vertices, and GU has not been reviewed with it.
  function refreshSkinBounds(shown){
    if (!game.aimRefreshSkinBounds) return;
    ctx.world.traverse(o => { if (o.isSkinnedMesh && shown(o)){ o.computeBoundingSphere(); o.boundingBox = null; } });
  }
  let frameNo = 0;
  function aimSurfaceDepth(force){
    aimPoint(_aim); ctx.camera.getWorldDirection(_fwd);
    const jointDepth = _off.copy(_aim).sub(ctx.camera.position).dot(_fwd);
    if (force || aimHit.at < 0 || frameNo - aimHit.at >= aimHit.every){
      const t0 = performance.now();
      _off.copy(_aim).sub(ctx.camera.position); const len = _off.length();
      let depth = -1;
      if (len > 1e-4){
        _ray.set(ctx.camera.position, _off.multiplyScalar(1 / len)); _ray.near = 0; _ray.far = len + 0.5;
        // everything drawn: armour, face and hair, clothing, the weapon. The raycaster ignores a
        // hidden PARENT, so the chain is checked (the other figure's stowed pieces hide that way)
        const shown = o => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return !(o.material && o.material.visible === false); };
        refreshSkinBounds(shown);
        for (const h of _ray.intersectObjects(ctx.world.children, true)){
          if (!shown(h.object)) continue;
          depth = h.point.sub(ctx.camera.position).dot(_fwd); break;
        }
      }
      aimHit.hit = depth > 0;
      aimHit.depth = aimHit.hit ? depth : jointDepth - 0.1;
      aimHit.at = frameNo; aimHit.cost = performance.now() - t0;
      aimHit.every = aimHit.cost > 4 ? 30 : 6;
    }
    return aimHit.depth;
  }
  function focusDistance(force){ return Math.max(ctx.camera.near * 2, aimSurfaceDepth(force)); }
  // the face lock: in first person the camera keeps facing the aim point while the keys move
  // it, a game's lock-on; the mouse rests while it is on, and L toggles it
  let faceLock = false;
  function setFaceLock(on){
    faceLock = !!on;
    const cb = document.getElementById('camFace'); if (cb) cb.checked = faceLock;
    if (faceLock && camMode === 'fly'){ ctx.camera.lookAt(aimPoint(_fc)); flyFromCamera(); }
    if (typeof paintCamMode === 'function' && flyBtn) paintCamMode();
  }
  // what the clip planes and the depth bias measure: the orbit target's distance, or in fly the
  // figure's, floored so passing through it never collapses the near plane
  function viewDistance(){
    if (camMode !== 'fly') return ctx.camera.position.distanceTo(ctx.controls.target);
    return Math.max(0.2, ctx.camera.position.distanceTo(figureCenter(_fc)));
  }
  function flyWant(out){
    let f = 0, r = 0, u = 0, fast = false;
    for (const k of fly.keys){
      const a = FLY_KEYS[k];
      if (a === 'f') f++; else if (a === 'b') f--; else if (a === 'r') r++; else if (a === 'l') r--;
      else if (a === 'u') u++; else if (a === 'd') u--; else if (a === 'fast') fast = true;
    }
    // in the camera's own frame (x right, y up, z forward), so the eased velocity turns with
    // the camera instead of lagging it: under the face lock a strafe stays a strafe
    out.set(r, u, f);
    if (out.lengthSq() > 1) out.normalize();        // a diagonal is no faster
    return out.multiplyScalar(fly.speed * (fast ? FLY_FAST : 1));
  }
  // stepped from the render loop (its own clock, capped like stepLighting, and only while the
  // mouse is captured) or by the harness with a dt of its own
  function stepFly(dtArg){
    if (camMode !== 'fly') return;
    let dt = dtArg;
    if (dt === undefined){
      const now = performance.now();
      dt = fly.prev ? Math.min((now - fly.prev) / 1000, 0.1) : 0; fly.prev = now;
      if (!flyLocked()) dt = 0;
    }
    if (dt > 0) fly.vel.lerp(flyWant(_want), 1 - Math.exp(-dt / FLY_TAU));      // an 80 ms approach and glide
    if (dt > 0 && fly.vel.lengthSq() <= 1e-8) fly.vel.set(0, 0, 0);
    if (faceLock){                       // every frame: a playing pose moves the aim point too
      // A lock-on moves in ORBIT terms around the aim point (Raven, 2026-09-04: "when moving
      // with A and D, the model moves farther away", then "That's more of a spiral, not a
      // circle", "Locking the camera to the hunter means I shouldn't need to do W inputs to
      // rotate around with S", then "Allow Q and E to move down even when locked onto the
      // hunter"): a straight sideways step lengthens the radius, and a step kept on the sphere
      // still follows a great circle that slides toward the hunter's level. So every key
      // orbits, with the free-flight meanings kept: A and D turn the azimuth on a level circle,
      // E and Q (Space and C) climb and dip (the elevation), W and S move closer and farther,
      // as does the wheel, and the camera is placed from those each frame; nothing else can
      // move it.
      aimPoint(_aim);
      if (dt > 0 && fly.vel.lengthSq() > 0){
        _off.copy(ctx.camera.position).sub(_aim);
        let d = Math.max(0.05, _off.length());
        let theta = Math.atan2(_off.x, _off.z), phi = Math.asin(Math.min(1, Math.max(-1, _off.y / d)));
        theta += fly.vel.x * dt / (d * Math.max(0.05, Math.cos(phi)));
        phi = Math.min(FLY_PITCH_MAX, Math.max(-FLY_PITCH_MAX, phi + fly.vel.y * dt / d));
        d = Math.max(0.05, d - fly.vel.z * dt);
        ctx.camera.position.set(_aim.x + d * Math.cos(phi) * Math.sin(theta), _aim.y + d * Math.sin(phi), _aim.z + d * Math.cos(phi) * Math.cos(theta));
        fly.moved = true;
      }
      _q.copy(ctx.camera.quaternion);
      ctx.camera.lookAt(_aim); flyFromCamera();
      if (_q.angleTo(ctx.camera.quaternion) > 1e-4) fly.moved = true;
    } else if (dt > 0 && fly.vel.lengthSq() > 0){
      ctx.camera.getWorldDirection(_fwd); _right.set(1, 0, 0).applyQuaternion(ctx.camera.quaternion);
      ctx.camera.position.addScaledVector(_right, fly.vel.x * dt).addScaledVector(_fwd, fly.vel.z * dt);
      ctx.camera.position.y += fly.vel.y * dt;
      fly.moved = true;
    }
    if (fly.moved){ fly.moved = false; queueCameraSave(); }
  }
  function flyRelease(){
    if (flyLocked()) document.exitPointerLock();
    fly.keys.clear(); fly.vel.set(0, 0, 0); fly.prev = 0;
  }
  function enterFly(opt){
    opt = opt || {};
    if (camMode === 'fly') return;
    if (lensState.type === 'ortho') applyLens({ type: 'standard' });   // a parallel view has nothing to fly through
    if (opt.drain !== false){          // apply any glide the orbit still owed, now, not on return
      const d = ctx.controls.enableDamping; ctx.controls.enableDamping = false; ctx.controls.update(); ctx.controls.enableDamping = d;
    }
    flyFromCamera();
    const fb = ctx.figureBounds(); flyAnchor = fb ? fb.c.clone() : ctx.controls.target.clone();
    fly.vel.set(0, 0, 0); fly.keys.clear(); fly.prev = 0;
    ctx.controls.enabled = false; camMode = 'fly';
    paintCamMode();
  }
  function leaveFly(opt){
    opt = opt || {};
    if (camMode !== 'fly') return;
    flyRelease();
    ctx.camera.getWorldDirection(_fwd);
    if (!opt.keepTarget){
      // the orbit resumes around the figure: its centre projected onto the line of sight
      const d = Math.max(0.3, figureCenter(_fc).sub(ctx.camera.position).dot(_fwd));
      ctx.controls.target.copy(ctx.camera.position).addScaledVector(_fwd, d);
    }
    ctx.controls.enabled = true; camMode = 'orbit';
    paintCamMode();
    ctx.controls.update(); ctx.fitPlanes();
  }
  function setCamMode(m){ if (m === 'fly') enterFly(); else leaveFly(); }
  const speedOfSlider = v => FLY_SPEED_MIN * Math.pow(FLY_SPEED_MAX / FLY_SPEED_MIN, v / 1000);
  const sliderOfSpeed = v => 1000 * Math.log(v / FLY_SPEED_MIN) / Math.log(FLY_SPEED_MAX / FLY_SPEED_MIN);
  function setFlySpeed(v){ fly.speed = Math.min(FLY_SPEED_MAX, Math.max(FLY_SPEED_MIN, +v || FLY_SPEED)); paintFlySpeed(); }
  function paintFlySpeed(){
    const sl = document.getElementById('camSpeed');
    if (document.activeElement !== sl) sl.value = String(Math.round(sliderOfSpeed(fly.speed)));
    document.getElementById('camSpeedVal').textContent = (fly.speed < 1 ? fly.speed.toFixed(2) : fly.speed.toFixed(1)) + ' m/s';
  }
  function paintCamMode(){
    const on = camMode === 'fly', locked = flyLocked();
    flyBtn.classList.toggle('on', on); ctx.setIcon(flyBtn, 'eye'); ctx.setLabel(flyBtn, 'First person', on ? FLY_TIP_ON : FLY_TIP_OFF);
    document.getElementById('spinBtn').disabled = on; document.getElementById('orbitLock').disabled = on;
    for (const id of ['camSpin', 'camSpinRev']) document.getElementById(id).disabled = on;
    const sel = document.getElementById('camMode'); if (document.activeElement !== sel) sel.value = camMode;
    // the first-person controls are shown over the view itself (flyHint below), so the panel does
    // not repeat them (Raven, 2026-09-18: "remove the tool tip under Lens for First person")
    document.getElementById('camSpeedField').hidden = !on;
    document.getElementById('camFace').disabled = !on;          // the lock is a first-person thing
    const oo = document.querySelector('#camLens option[value=ortho]'); if (oo) oo.disabled = on;
    const hint = document.getElementById('flyHint');
    hint.hidden = !on;
    hint.textContent = locked
      ? (faceLock ? 'Locked on the hunter: A/D round, E/Q up and down, W/S closer and farther, L releases' : 'WASD move, Q/E up and down, Shift fast, L locks on the hunter, Esc frees the mouse')
      : 'Click to look around · WASD move · Q/E up/down · Shift fast · Esc frees the mouse';
    ctx.viewport.classList.toggle('fly', on);
    ctx.paintSpin();                          // the turntable is off while flying
  }
  // the camera's moves reach the session save through one debounce, whichever camera made them
  let camTimer = null;
  function queueCameraSave(){
    if (ctx.restoring || ctx.SCENE) return;
    clearTimeout(camTimer);              // OrbitControls' 'change' fires every frame of a drag
    camTimer = setTimeout(ctx.saveState, 400);
  }
  // the mouse is captured on a click in the view; #bar and the overlays are siblings of
  // #viewport, so a click on the toolbar never asks for it. The request is refused when it
  // comes too soon after Esc or without a real gesture: the mode stays on and the prompt
  // stays up, and the next click asks again.
  ctx.viewport.addEventListener('click', e => {
    if (camMode !== 'fly' || flyLocked() || e.button !== 0) return;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    try { const r = flyEl.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {}
  });
  {
    const onLock = () => { fly.keys.clear(); fly.vel.set(0, 0, 0); fly.prev = 0; fly.skip = flyLocked() ? 1 : 0; paintCamMode(); };
    document.addEventListener('pointerlockchange', onLock);
    document.addEventListener('pointerlockerror', onLock);
  }
  document.addEventListener('mousemove', e => {
    if (camMode !== 'fly' || !flyLocked()) return;
    if (fly.skip > 0){ fly.skip--; return; }         // Chrome's spurious first movement after a lock
    if (faceLock) return;                            // the lock owns the view
    const dx = Math.max(-300, Math.min(300, e.movementX || 0)), dy = Math.max(-300, Math.min(300, e.movementY || 0));
    flyTurn(-dx * FLY_SENS, -dy * FLY_SENS);
  });
  document.addEventListener('keydown', e => {
    if (camMode === 'fly' && flyLocked() && e.code === 'KeyL'){ setFaceLock(!faceLock); ctx.saveState(); e.preventDefault(); return; }
    if (camMode !== 'fly' || !flyLocked() || !FLY_KEYS[e.code]) return;
    fly.keys.add(e.code); e.preventDefault();
  });
  document.addEventListener('keyup', e => { fly.keys.delete(e.code); });
  window.addEventListener('blur', () => { fly.keys.clear(); fly.vel.set(0, 0, 0); });
  document.addEventListener('visibilitychange', () => { if (document.hidden){ fly.keys.clear(); fly.vel.set(0, 0, 0); } });
  // with the face lock on, a notch of the wheel moves a tenth closer or farther
  function flyZoom(n){
    aimPoint(_aim); _off.copy(ctx.camera.position).sub(_aim);
    const d = Math.max(0.05, _off.length() * Math.pow(0.9, n));
    if (_off.lengthSq() > 1e-10) ctx.camera.position.copy(_aim).addScaledVector(_off.normalize(), d);
    fly.moved = true;
  }
  ctx.viewport.addEventListener('wheel', e => {
    if (camMode !== 'fly' || !flyLocked()) return;
    e.preventDefault();
    const n = Math.max(-1, Math.min(1, -e.deltaY / 100));   // one notch a step, whatever the device
    if (faceLock) flyZoom(n); else setFlySpeed(fly.speed * Math.pow(1.15, n));
    queueCameraSave();
  }, { passive: false });
  ctx.viewport.addEventListener('contextmenu', e => { if (camMode === 'fly') e.preventDefault(); });
  flyBtn.onclick = () => { setCamMode(camMode === 'fly' ? 'orbit' : 'fly'); ctx.saveState(); };

  let orbitLocked = false;
  const orbitLockBtn = document.getElementById('orbitLock');
  // The button names the mode that is ACTIVE: dragging orbits, or dragging pans.
  const ORBIT_TIP = 'Lock the orbit so dragging pans the view instead of rotating it; the right button always does the other one';
  function paintOrbitLock(){
    ctx.setIcon(orbitLockBtn, orbitLocked ? 'pan' : 'orbit');
    ctx.setLabel(orbitLockBtn, orbitLocked ? 'Pan' : 'Orbit', ORBIT_TIP);
    orbitLockBtn.classList.toggle('on', !orbitLocked);
    ctx.controls.mouseButtons.LEFT = orbitLocked ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    // the right button is the other one (Raven, 2026-09-05: "Ensure the Right Click Button does
    // the opposite of the Orbit/Pan button"); before, it panned whichever way the left was set
    ctx.controls.mouseButtons.RIGHT = orbitLocked ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    ctx.controls.touches.ONE = orbitLocked ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  }
  function toggleOrbitLock(){ orbitLocked = !orbitLocked; paintOrbitLock(); ctx.saveState(); }
  orbitLockBtn.onclick = toggleOrbitLock;

  // middle-click toggles it too, as in the Weapon Tree -- but only on a CLICK, since
  // OrbitControls still uses a middle DRAG to dolly and that must keep working
  let midAt = null;
  ctx.viewport.addEventListener('pointerdown', e => { if (e.button === 1) midAt = [e.clientX, e.clientY]; });
  ctx.viewport.addEventListener('auxclick', e => {
    if (e.button !== 1 || !midAt || camMode === 'fly') return;
    const moved = Math.abs(e.clientX - midAt[0]) + Math.abs(e.clientY - midAt[1]);
    midAt = null;
    if (moved < 5) { e.preventDefault(); toggleOrbitLock(); }
  });


  // Where the user left the camera. Kept as position + target so it survives a window
  // resize, unlike a raw matrix, and so Fit to View can still override it cleanly.
  // The first-person camera keeps the shape: its t is a look point one metre ahead, and it
  // adds mode: 'fly'. An orbit view is written exactly as before, so every older file, slot
  // and default reads as the orbit camera.
  function cameraState(){
    try {
      const t = camMode === 'fly' ? ctx.camera.getWorldDirection(new THREE.Vector3()).add(ctx.camera.position) : ctx.controls.target;
      const c = { p: ctx.camera.position.toArray().map(n => +n.toFixed(4)),
                  t: t.toArray().map(n => +n.toFixed(4)),
                  fov: +ctx.camera.fov.toFixed(2) };
      if (camMode === 'fly') c.mode = 'fly';
      if (lensState.type !== 'standard') c.lens = lensFileState();
      return c;
    } catch (_) { return null; }
  }
  function applyCameraState(c){
    if (!c || !Array.isArray(c.p) || !Array.isArray(c.t)) return false;
    if (!c.p.every(Number.isFinite) || !c.t.every(Number.isFinite)) return false;
    const wantFly = c.mode === 'fly';              // absent or anything else: the orbit camera
    if (!wantFly && camMode === 'fly') leaveFly({ keepTarget: true });
    ctx.camera.position.fromArray(c.p); ctx.controls.target.fromArray(c.t);
    // the lens the view was saved with; a view saved before the Camera panel had the default
    setFov(Number.isFinite(c.fov) ? c.fov : FOV_DEFAULT);
    ctx.camera.lookAt(ctx.controls.target);
    if (wantFly){ if (camMode === 'fly') flyFromCamera(); else enterFly({ drain: false }); }
    else ctx.controls.update();
    applyLens(c.lens && typeof c.lens === 'object' ? c.lens : { type: 'standard' });   // a view without one is Standard
    return true;
  }
  // The lens (Raven, 2026-09-04: a user "wanted to be able to change focal length /
  // perspective depth", then "we may need a Camera Panel as well for more control over the
  // camera behavior"). A 35 mm-equivalent focal length: the vertical field of view the stage
  // has always used, 38 degrees, is a 35 mm lens on a 24 mm-high frame (f = 12 / tan(fov / 2)),
  // so the default reads as the lens it is. Changing it keeps the FRAMING: the camera steps
  // along its line of sight by the ratio of the two half-angle tangents, so the orbit target
  // stays the same size on screen and only the depth of the perspective changes (the dolly
  // zoom). The lens is saved with the camera, so it follows a hunter slot and a set file like
  // the view itself does. The Camera panel's controls are wired beside the turntable's.
  // The lens runs 5 mm to 300 mm (Raven, 2026-09-04: "Give me the max range of focal
  // lengths", then "The higher focal lengths don't seem to do anything"): 5 mm is a
  // 135-degree view, about as wide as a flat projection can go before the edges smear. At
  // the long end the framing is kept, so all a longer lens does is flatten the depth, and
  // that runs out: the front of a figure half a metre deep is 12% larger than its back at
  // 35 mm, 2% at 200 mm, 1.4% at 300 mm and 0.4% at 1000 mm -- the range once ran to 1000
  // and its top third changed nothing anyone could see. The slider is logarithmic, since a
  // lens reads as a ratio -- 5 to 10 mm is as big a change as 100 to 200 -- so the wide end
  // is not crammed into a few pixels; its value is a position along that curve.
  const FOV_DEFAULT = 38;
  const FOCAL_MIN = 5, FOCAL_MAX = 300;
  const fovOfFocal = mm => THREE.MathUtils.radToDeg(2 * Math.atan(12 / mm));
  const focalOfFov = fov => 12 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const focalOfSlider = v => FOCAL_MIN * Math.pow(FOCAL_MAX / FOCAL_MIN, v / 1000);
  const sliderOfFocal = mm => 1000 * Math.log(mm / FOCAL_MIN) / Math.log(FOCAL_MAX / FOCAL_MIN);
  function paintFocal(){
    const sl = document.getElementById('camFocal'), mmExact = focalOfFov(ctx.camera.fov);
    const mm = mmExact < 10 ? +mmExact.toFixed(1) : Math.round(mmExact);
    if (document.activeElement !== sl) sl.value = String(Math.round(sliderOfFocal(Math.min(FOCAL_MAX, Math.max(FOCAL_MIN, mmExact)))));
    document.getElementById('camFocalVal').textContent = mm + ' mm \u00b7 ' + (ctx.camera.fov < 10 ? ctx.camera.fov.toFixed(1) : ctx.camera.fov.toFixed(0)) + '\u00b0';
  }
  // THE LENS HOLDS WHAT IT FRAMES, IN BOTH MODES (Raven, 2026-09-18: "First Person Camera has
  // some issues since it doesn't maintain framing", reworking the Monster Viewer's quick fix).
  // A field of view change on its own is only a crop: the picture scales and the perspective
  // never moves, which is what first person did here, camera fixed. So the camera steps along
  // the line to a pivot by the factor the field of view changed by. That holds the pivot EXACTLY
  // -- the same spot on screen and the same size -- and changes only the depth of the
  // perspective, the reason to reach for a focal length at all. Orbit pivots on its target, as
  // it always has.
  //
  // The question first person raises is WHICH point to hold. The Monster Viewer's quick fix
  // holds the figure's centre, and its math is right; but up close in first person you are
  // usually framing something else -- a face, a weapon -- and pinning the waist lets the thing
  // you aimed at slide and resize. So the pivot is what the view is actually on:
  //   face lock on  the locked aim point, since the camera is held on it (the head or chest here,
  //                 not the centre, so the centre would disagree with the lock);
  //   otherwise     the surface at the centre of the view, by the same visible-only raycast the
  //                 focus follow uses;
  //   nothing there the figure's centre -- the quick fix exactly, so looking away still holds it.
  function framingPivot(out){
    if (camMode !== 'fly') return out.copy(ctx.controls.target);
    if (faceLock) return aimPoint(out);
    ctx.camera.getWorldDirection(_fwd);
    _ray.set(ctx.camera.position, _fwd); _ray.near = 0; _ray.far = 1000;
    const shown = o => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return !(o.material && o.material.visible === false); };
    refreshSkinBounds(shown);
    for (const h of _ray.intersectObjects(ctx.world.children, true)){
      if (shown(h.object)) return out.copy(h.point);
    }
    return figureCenter(out);
  }
  function setFov(fov, keepFraming){
    fov = Math.min(150, Math.max(1, fov));
    if (keepFraming){
      const k = Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
      if (camMode === 'fly'){
        // stops a fifth of a metre short of the pivot on the way in, so it never flies through
        const q = framingPivot(new THREE.Vector3());
        const off = ctx.camera.position.clone().sub(q), len = off.length();
        if (len > 1e-4){
          ctx.camera.position.copy(q).addScaledVector(off.divideScalar(len), Math.max(0.2, len * k));
          fly.moved = true;                         // rides the first-person save, as flying does
        }
      } else {
        const dir = ctx.camera.position.clone().sub(ctx.controls.target);
        ctx.camera.position.copy(ctx.controls.target).add(dir.multiplyScalar(k));
      }
    }
    ctx.camera.fov = fov; ctx.camera.updateProjectionMatrix();
    ctx.fitPlanes();
    paintFocal();
  }
  function setFocal(mm, keepFraming){ setFov(fovOfFocal(Math.min(FOCAL_MAX, Math.max(FOCAL_MIN, +mm || 35))), keepFraming !== false); }
  paintFocal();

  // ---- Lens types (Raven, 2026-09-04: "lens types"): Standard, Fisheye, Orthographic, Anamorphic
  // and Tilt-shift, through render/lens.js (the camera a frame renders through) and render/fx.js
  // (the passes a lens needs). The lens is part of the view, so it rides in the camera state
  // with the position, the target and the focal length: it follows a hunter slot and a set
  // file, and a view saved without one is Standard. Orthographic is orbit-only. ----
  let lensState = Object.assign({}, LENS_DEFAULT);
  function lensFileState(){
    const l = { type: lensState.type };
    if (l.type === 'fisheye') l.view = lensState.view;
    if (l.type === 'anamorphic') l.squeeze = lensState.squeeze;
    if (l.type === 'tiltshift'){ l.band = lensState.band; l.bandY = lensState.bandY; }
    return l;
  }
  function applyLens(spec){
    spec = spec || {};
    const num = (v, d, lo, hi) => Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d;
    let type = LENS_TYPES.includes(spec.type) ? spec.type : 'standard';
    if (type === 'ortho' && camMode === 'fly') type = 'standard';
    const sq = num(spec.squeeze, lensState.squeeze, 1, 3);
    lensState = { type, view: num(spec.view, lensState.view, 90, 160),
                  squeeze: SQUEEZES.reduce((a, b) => Math.abs(b - sq) < Math.abs(a - sq) ? b : a, SQUEEZES[0]),
                  band: num(spec.band, lensState.band, 0.05, 0.9), bandY: num(spec.bandY, lensState.bandY, 0, 1) };
    ctx.fx.setLens(lensState);
    ctx.fitRenderer();
    paintLens();
  }
  function lensCamera(){ return renderCameraFor(ctx.camera, lensState, viewDistance(), ctx.camera.aspect); }
  const LENS_P = {
    fisheye:    [{ key: 'view', label: 'View angle', min: 90, max: 160, fmt: v => Math.round(v) + '\u00b0' }],
    anamorphic: [{ key: 'squeeze', label: 'Squeeze', min: 1.33, max: 2, fmt: v => v.toFixed(2) + 'x' }],
    tiltshift:  [{ key: 'band', label: 'Sharp band', min: 0.05, max: 0.9, fmt: v => Math.round(v * 100) + '%' },
                 { key: 'bandY', label: 'Band position', min: 0, max: 1, fmt: v => Math.round(v * 100) + '% up' }]
  };
  function paintLens(){
    const sel = document.getElementById('camLens'); if (document.activeElement !== sel) sel.value = lensState.type;
    const ps = LENS_P[lensState.type] || [];
    for (let i = 0; i < 2; i++){
      const f = document.getElementById('lensP' + (i + 1) + 'Field'), p = ps[i];
      f.hidden = !p; if (!p) continue;
      document.getElementById('lensP' + (i + 1) + 'Label').textContent = p.label;
      const sl = document.getElementById('lensP' + (i + 1));
      if (document.activeElement !== sl) sl.value = String(Math.round(1000 * (lensState[p.key] - p.min) / (p.max - p.min)));
      document.getElementById('lensP' + (i + 1) + 'Val').textContent = p.fmt(lensState[p.key]);
    }
  }
  function lensEdit(){
    const ps = LENS_P[lensState.type] || []; const spec = { type: lensState.type };
    ps.forEach((p, i) => { spec[p.key] = p.min + (p.max - p.min) * (+document.getElementById('lensP' + (i + 1)).value / 1000); });
    applyLens(spec);
  }

  return {
    FLY_KEYS, FLY_PITCH_MAX, FLY_SPEED, LENS_P, aimPoint, aimSurfaceDepth, applyCameraState, applyFlyLook,
    applyLens, cameraState, figureCenter, fly, flyBtn, flyLocked, flyRelease, flyTurn,
    flyZoom, focalOfSlider, focusDistance, leaveFly, lensCamera, lensEdit, lensFileState, paintCamMode,
    paintFlySpeed, paintOrbitLock, queueCameraSave, setCamMode, setFaceLock, setFlySpeed, setFocal, setFov,
    speedOfSlider, stepFly, viewDistance,
    get camMode(){ return camMode; },
    get faceLock(){ return faceLock; },
    get frameNo(){ return frameNo; }, set frameNo(v){ frameNo = v; },
    get lensState(){ return lensState; },
    get orbitLocked(){ return orbitLocked; }, set orbitLocked(v){ orbitLocked = v; }
  };
}
