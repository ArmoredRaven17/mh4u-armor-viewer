// THE CAMERA BAR of the shared viewer base (docs/base/ui; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md): the turntable
// (Off -> ten speeds -> Off), Wireframe, Hide Cursor and Floor Grid buttons over the render, and the Camera panel's own
// controls (focal length, turntable and direction, damping, zoom to cursor, camera mode, flight speed, face lock, aim and
// follow, the lens and its parameters, Reset). The Fit, orbit lock, first-person, screenshot and record buttons belong to
// the camera panel and capture modules. Moved verbatim from GU's index.html (2026-10-18). createCameraBar(game, ctx):
// ctx names the app's objects lazily; ctx.floorGrid is the app's render/grid.js floor.
import { setWire, allMats } from '../render/material.js';

export function createCameraBar(game, ctx){
  // Off -> ten increasing speeds -> Off. The speed is not written on the button: you can
  // see how fast it is going. Only the top step renames, to Turbo.
  // The ramp is geometric (x1.55 a step) rather than linear -- rotation reads as a RATIO,
  // so even steps of +17 would feel like one jump then nine barely-different fast settings.
  const SPIN_SPEEDS = [3, 5, 7, 11, 18, 27, 42, 66, 103, 160];
  const SPIN_STEPS = [{ label: 'Rotate', speed: 0 }].concat(
    SPIN_SPEEDS.map((v, i) => ({ label: i === SPIN_SPEEDS.length - 1 ? 'Turbo' : 'Rotate', speed: v })));
  let spinStep = 0;
  const spinBtn = document.getElementById('spinBtn');
  let spinRev = false;
  function paintSpin(){
    const st = SPIN_STEPS[spinStep];
    ctx.setLabel(spinBtn, st.label, 'Cycle the turntable speed');
    spinBtn.classList.toggle('on', st.speed > 0);
    ctx.controls.autoRotate = ctx.camPanel.camMode === 'orbit' && st.speed > 0;
    ctx.controls.autoRotateSpeed = (st.speed || 3) * (spinRev ? -1 : 1);
    const sl = document.getElementById('camSpin');
    if (document.activeElement !== sl) sl.value = String(spinStep);
    document.getElementById('camSpinVal').textContent = st.speed ? st.speed + ' deg/s' : 'off';
    document.getElementById('camSpinRev').checked = spinRev;
  }
  spinBtn.onclick = () => { spinStep = (spinStep + 1) % SPIN_STEPS.length; paintSpin(); ctx.saveState(); };
  paintSpin();
  // the Camera panel's controls: the lens, the turntable (the bar's steps, with a direction),
  // and two orbit behaviours of the controls themselves
  {
    const focal = document.getElementById('camFocal');
    focal.oninput = () => ctx.setFocal(ctx.focalOfSlider(+focal.value));
    focal.onchange = () => { ctx.setFocal(ctx.focalOfSlider(+focal.value)); ctx.saveState(); };
    const spin = document.getElementById('camSpin');
    spin.oninput = () => { spinStep = Math.min(SPIN_STEPS.length - 1, Math.max(0, +spin.value)); paintSpin(); };
    spin.onchange = () => { spin.oninput(); ctx.saveState(); };
    document.getElementById('camSpinRev').onchange = e => { spinRev = e.target.checked; paintSpin(); ctx.saveState(); };
    const damp = document.getElementById('camDamp'), zoomCur = document.getElementById('camZoomCursor');
    damp.checked = ctx.controls.enableDamping; zoomCur.checked = !!ctx.controls.zoomToCursor;
    damp.onchange = () => { ctx.controls.enableDamping = damp.checked; ctx.saveState(); };
    zoomCur.onchange = () => { ctx.controls.zoomToCursor = zoomCur.checked; ctx.saveState(); };
    const mode = document.getElementById('camMode');
    mode.onchange = () => { ctx.setCamMode(mode.value); ctx.saveState(); };
    const speed = document.getElementById('camSpeed');
    speed.oninput = () => ctx.setFlySpeed(ctx.speedOfSlider(+speed.value));
    speed.onchange = () => { speed.oninput(); ctx.saveState(); };
    const face = document.getElementById('camFace');
    face.onchange = () => { ctx.setFaceLock(face.checked); ctx.saveState(); };
    const aim = document.getElementById('camAim');
    aim.onchange = () => { ctx.fxPanel.state.dof.aim = aim.value; ctx.fxPanel.paint(); ctx.saveState(); };
    const follow = document.getElementById('camFollow');
    follow.onchange = () => { ctx.fxPanel.state.dof.follow = follow.checked; ctx.fxPanel.apply(); ctx.fxPanel.paint(); ctx.saveState(); };
    // Reset (Raven, 2026-09-04: "Add a reset button for Camera Panel"): every setting in the
    // panel back to its default; the view is left alone, Fit to View is the button for that
    document.getElementById('camReset').onclick = () => {
      ctx.setCamMode('orbit'); ctx.setFaceLock(false);
      ctx.fxPanel.state.dof.aim = 'head'; ctx.fxPanel.state.dof.follow = true; ctx.fxPanel.apply(); ctx.fxPanel.paint();
      ctx.applyLens({ type: 'standard' });
      ctx.setFocal(35);
      spinStep = 0; spinRev = false; paintSpin();
      ctx.controls.enableDamping = true; damp.checked = true;
      ctx.controls.zoomToCursor = false; zoomCur.checked = false;
      ctx.setFlySpeed(ctx.FLY_SPEED);
      floorGridOn = FLOOR_GRID_DEFAULT; paintFloorGrid();
      ctx.paintCamMode(); ctx.saveState();
    };
    const lensSel = document.getElementById('camLens');
    lensSel.onchange = () => { ctx.applyLens({ type: lensSel.value }); ctx.saveState(); };
    for (const id of ['lensP1', 'lensP2']){ const e = document.getElementById(id); e.oninput = ctx.lensEdit; e.onchange = () => { ctx.lensEdit(); ctx.saveState(); }; }
  }

  let wireOn = false;
  const wireBtn = document.getElementById('wireBtn');
  function paintWire(){
    wireBtn.classList.toggle('on', wireOn);
    setWire(allMats, wireOn);
  }
  wireBtn.onclick = () => { wireOn = !wireOn; paintWire(); ctx.saveState(); };


  // Hide the mouse pointer over the model -- a clean look at a set, and clean screenshots.
  let hideCursor = false;
  const cursorBtn = document.getElementById('cursorBtn');
  function paintCursor(){
    cursorBtn.classList.toggle('on', hideCursor);
    document.getElementById('viewport').classList.toggle('nocursor', hideCursor);
  }
  cursorBtn.onclick = () => { hideCursor = !hideCursor; paintCursor(); ctx.saveState(); };

  const FLOOR_GRID_DEFAULT = true;
  let floorGridOn = FLOOR_GRID_DEFAULT;

  const gridBtn = document.getElementById('gridBtn');
  function paintFloorGrid(){
    ctx.floorGrid.set(floorGridOn && !ctx.SCENE);
    gridBtn.classList.toggle('on', floorGridOn);
  }
  gridBtn.onclick = () => { floorGridOn = !floorGridOn; paintFloorGrid(); ctx.saveState(); };
  paintFloorGrid();

  return {
    SPIN_STEPS, paintCursor, paintFloorGrid, paintSpin, paintWire,
    get floorGridOn(){ return floorGridOn; }, set floorGridOn(v){ floorGridOn = v; },
    get hideCursor(){ return hideCursor; }, set hideCursor(v){ hideCursor = v; },
    get spinRev(){ return spinRev; }, set spinRev(v){ spinRev = v; },
    get spinStep(){ return spinStep; }, set spinStep(v){ spinStep = v; },
    get wireOn(){ return wireOn; }, set wireOn(v){ wireOn = v; }
  };
}
