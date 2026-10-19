// THE EFFECTS PANEL of the shared viewer base (docs/base/ui; the plan: C:\\Coding Repos\\VIEWER-BASE-PLAN.md): the presets,
// the bloom / depth of field / lens / grade controls, and the one readable state the session save, a set file and every
// slot share. Moved verbatim from GU's index.html (2026-10-18). The render side is docs/base/render/fx.js.
//   createEffectsPanel(game, ctx) wires the panel's controls (ids fxRow, fxBloomOn ... fxDofFocus, camAim, camFollow) and
// returns the panel: `.state` (the live object), `.name` (the preset, 'custom' once a control is touched), apply(),
// paint(), applyPreset(name), edit(), save() (the readable state), restore(state) (a file or a slot without one keeps
// what is on screen), paintFocusLive(), FX_IDS. ctx: { fx() (the render/fx.js composer), focusLive() (the followed focus
// distance, metres), onChange() (the app's save) }.
export function createEffectsPanel(game, ctx){
  // ---- Effects (Raven, 2026-09-04: "Let's plan more advance effects, lens types, locking focus
  // on the hunter"): bloom, lens character and colour grading through render/fx.js, depth of
  // field to follow. The same shape as the lighting: a preset fills the controls and lights its
  // button, touching a control makes it "custom", and one readable object serves the session
  // save, the set file and every hunter slot. A file or a slot without one keeps the effects
  // on screen, as it keeps the lighting; Reset names Off. ----
  const FX_NEUTRAL = {
    bloom: { on: false, strength: 0.6, threshold: 0.8, radius: 0.5 },
    dof:   { on: false, follow: true, aim: 'head', focus: 2.5, aperture: 3, maxBlur: 0.02 },
    lens:  { vignette: 0, aberration: 0, grain: 0 },
    grade: { exposure: 1, contrast: 1, saturation: 1, toneMap: 'none' }
  };
  const FX_PRESETS = {
    off:       {},
    photo:     { bloom: { on: true, strength: 0.25, threshold: 0.9, radius: 0.5 }, lens: { vignette: 0.25, grain: 0.05 }, grade: { contrast: 1.05, saturation: 1.05 } },
    cinematic: { bloom: { on: true, strength: 0.4, threshold: 0.75, radius: 0.7 }, dof: { on: true, aperture: 4, maxBlur: 0.025 },
                 lens: { vignette: 0.45, aberration: 0.3, grain: 0.12 }, grade: { contrast: 1.1, saturation: 0.9, toneMap: 'aces' } },
    glow:      { bloom: { on: true, strength: 1.2, threshold: 0.5, radius: 0.8 }, lens: { vignette: 0.2 }, grade: { toneMap: 'reinhard' } },
    noir:      { bloom: { on: true, strength: 0.3, threshold: 0.8, radius: 0.6 }, lens: { vignette: 0.6, grain: 0.25 }, grade: { contrast: 1.3, saturation: 0, toneMap: 'neutral' } }
  };
  function fxMerge(base, over){ const o = {}; for (const k in base) o[k] = Object.assign({}, base[k], (over && over[k]) || {}); return o; }
  let fxName = 'off', fxState = fxMerge(FX_NEUTRAL, {});
  // dof.follow and dof.aim are the Camera panel's hunter-tracking controls (Raven, 2026-09-04:
  // "Face the Hunter and Keep the Hunter in focus may make more sense as camera options"); they
  // stay in the effects state, since the focus is the depth of field's
  const FX_IDS = { 'bloom.on': 'fxBloomOn', 'bloom.strength': 'fxBloomStr', 'bloom.threshold': 'fxBloomThr', 'bloom.radius': 'fxBloomRad',
    'dof.on': 'fxDofOn', 'dof.aperture': 'fxDofAper', 'dof.maxBlur': 'fxDofBlur',
    'lens.vignette': 'fxVig', 'lens.aberration': 'fxAber', 'lens.grain': 'fxGrain',
    'grade.exposure': 'fxExp', 'grade.contrast': 'fxCon', 'grade.saturation': 'fxSat', 'grade.toneMap': 'fxTone' };
  const FX_FOCUS_MIN = 0.1, FX_FOCUS_MAX = 50;
  const focusOfSlider = v => FX_FOCUS_MIN * Math.pow(FX_FOCUS_MAX / FX_FOCUS_MIN, v / 1000);
  const sliderOfFocus = m => 1000 * Math.log(m / FX_FOCUS_MIN) / Math.log(FX_FOCUS_MAX / FX_FOCUS_MIN);
  function fxApply(){ ctx.fx().setState(fxState); }
  function paintFocusLive(){
    const m = fxState.dof.follow ? ctx.focusLive() : fxState.dof.focus;
    document.getElementById('fxDofFocusVal').textContent = (m < 1 ? m.toFixed(2) : m.toFixed(1)) + ' m' + (fxState.dof.follow ? ' (following the hunter, see Camera)' : '');
  }
  function paintFx(){
    document.querySelectorAll('#fxRow .btn').forEach(b => b.classList.toggle('on', b.dataset.fx === fxName));
    for (const path in FX_IDS){
      const e = document.getElementById(FX_IDS[path]); if (!e) continue;
      const [g, k] = path.split('.'); const v = fxState[g][k];
      if (e.type === 'checkbox') e.checked = !!v;
      else if (document.activeElement !== e) e.value = String(v);
    }
    const ca = document.getElementById('camAim'); if (ca && document.activeElement !== ca) ca.value = fxState.dof.aim;
    document.getElementById('camFollow').checked = !!fxState.dof.follow;
    const fs = document.getElementById('fxDofFocus');
    if (document.activeElement !== fs) fs.value = String(Math.round(sliderOfFocus(fxState.dof.focus)));
    fs.disabled = fxState.dof.follow;
    paintFocusLive();
    document.getElementById('fxBloomStrVal').textContent = fxState.bloom.strength.toFixed(2);
    document.getElementById('fxExpVal').textContent = fxState.grade.exposure.toFixed(2);
  }
  function applyFxPreset(name){
    fxName = FX_PRESETS[name] ? name : 'off';
    fxState = fxMerge(FX_NEUTRAL, FX_PRESETS[fxName]);
    fxApply(); paintFx();
  }
  function fxEdit(){
    fxName = 'custom';
    for (const path in FX_IDS){
      const e = document.getElementById(FX_IDS[path]); if (!e) continue;
      const [g, k] = path.split('.');
      fxState[g][k] = e.type === 'checkbox' ? e.checked : (e.tagName === 'SELECT' ? e.value : +e.value);
    }
    fxState.dof.focus = focusOfSlider(+document.getElementById('fxDofFocus').value);
    fxApply(); paintFx();
  }
  // one readable shape for the session save, the set file and the hunter slots
  function effectsState(){ return Object.assign({ preset: fxName }, fxMerge(fxState, {})); }
  function restoreEffects(e){
    if (!e || typeof e !== 'object') return;
    const num = (v, d, lo, hi) => Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d;
    const oneOf = (v, list, d) => list.includes(v) ? v : d;
    const base = fxMerge(FX_NEUTRAL, FX_PRESETS[e.preset] || {});
    const b = e.bloom || {}, d = e.dof || {}, l = e.lens || {}, g = e.grade || {};
    fxState = {
      bloom: { on: b.on === true || (b.on === undefined && base.bloom.on), strength: num(b.strength, base.bloom.strength, 0, 2),
               threshold: num(b.threshold, base.bloom.threshold, 0, 1.5), radius: num(b.radius, base.bloom.radius, 0, 1) },
      dof:   { on: d.on === true || (d.on === undefined && base.dof.on), follow: d.follow !== false, aim: oneOf(d.aim, ['head', 'chest', 'center'], base.dof.aim),
               focus: num(d.focus, base.dof.focus, FX_FOCUS_MIN, FX_FOCUS_MAX), aperture: num(d.aperture, base.dof.aperture, 0, 10), maxBlur: num(d.maxBlur, base.dof.maxBlur, 0, 0.05) },
      lens:  { vignette: num(l.vignette, base.lens.vignette, 0, 1), aberration: num(l.aberration, base.lens.aberration, 0, 1), grain: num(l.grain, base.lens.grain, 0, 1) },
      grade: { exposure: num(g.exposure, base.grade.exposure, 0.25, 4), contrast: num(g.contrast, base.grade.contrast, 0.5, 2),
               saturation: num(g.saturation, base.grade.saturation, 0, 2), toneMap: oneOf(g.toneMap, ['none', 'aces', 'reinhard', 'neutral'], base.grade.toneMap) }
    };
    fxName = FX_PRESETS[e.preset] ? e.preset : 'custom';
    fxApply(); paintFx();
  }
  const applyEffectsFile = restoreEffects;     // a file or a slot without a block keeps what is on screen

  // the panel's own controls
  document.querySelectorAll('#fxRow .btn').forEach(b => b.onclick = () => { applyFxPreset(b.dataset.fx); ctx.onChange(); });
  for (const path in FX_IDS){
    const e = document.getElementById(FX_IDS[path]); if (!e) continue;
    if (e.type === 'checkbox' || e.tagName === 'SELECT') e.onchange = () => { fxEdit(); ctx.onChange(); };
    else { e.oninput = fxEdit; e.onchange = () => { fxEdit(); ctx.onChange(); }; }
  }
  { const fs = document.getElementById('fxDofFocus'); fs.oninput = fxEdit; fs.onchange = () => { fxEdit(); ctx.onChange(); }; }

  return {
    get state(){ return fxState; },
    get name(){ return fxName; },
    set name(v){ fxName = v; },
    FX_IDS, apply: fxApply, paint: paintFx, applyPreset: applyFxPreset, edit: fxEdit, save: effectsState,
    restore: restoreEffects, applyFile: applyEffectsFile, paintFocusLive
  };
}
