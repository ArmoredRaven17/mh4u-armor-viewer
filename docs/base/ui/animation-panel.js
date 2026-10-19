// THE ANIMATION PANEL of the shared viewer base (docs/base/ui; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md): the
// transport over the playing clip (play / pause, loop, frame steps, the scrubber, the frame readout) and the CHAIN, a
// playlist of poses and weapon stances held CHAIN_HOLD seconds a link, saved with the session. Moved verbatim from GU's
// index.html (2026-10-18). createAnimationPanel(game, ctx): ctx.pose is the app's PoseDriver; ctx.weapon /
// ctx.weaponClassSel / ctx.applyWeaponState / ctx.buildPoseList are the app's weapon-stance and pose-list hooks (a game
// with no weapon stances passes ones that list none).
import * as THREE from 'three';

export function createAnimationPanel(game, ctx){
  // ---- animation controls -------------------------------------------------------------
  // Raven, 2026-09-03: "Basic controls like Looping or not, being able to step through frame
  // by frame, chain stances together." The LMT motions run at 60 frames a second: (frames - 1)
  // over the clip length is 59.5 on the Heavy Bowgun's clips (37 frames over 0.617 s, 363 over
  // 6.05 s), so a frame step is 1/60 s. The transport drives the pose driver's action; the
  // weapon's own motion follows that action's time as it always has.
  const FRAME = 1 / 60;
  const animBar = document.getElementById('anim'), animScrub = document.getElementById('animScrub'),
        animFrameEl = document.getElementById('animFrame'), animPlayBtn = document.getElementById('animPlay'),
        animLoopBtn = document.getElementById('animLoop');
  // null = each animation's own default (stances hold their last frame, the lobby poses loop);
  // true or false once Loop has been pressed, and it then applies to every animation
  let animLoopPref = null;
  // A chain plays each one-shot stance once so the next can start as it ends. A `_loop`
  // stance is a short cycle -- the drawn idle is a single frame -- so played once it is gone
  // before it is seen (Raven, 2026-09-03: "Play Chain only loops the last stance added"):
  // inside a chain a loop stance, or a hunter pose (the lobby poses are held loops), keeps
  // cycling for CHAIN_HOLD seconds, then the chain moves on; as the LAST link of a chain that
  // does not repeat it keeps looping, the held state the sequence lands in (a `_start` into
  // its `_loop`: "some appear to be a sequence broken up").
  const CHAIN_HOLD = 3;
  const isLoopClip = entry => /_loop$/.test((entry && entry.clip) || '');
  // a weapon stance: GU's live under poses/weapons/; another game's entry says so itself (stance: true)
  const isStanceEntry = entry => !!entry && (entry.stance === true || /poses\/weapons\//.test(entry.file || ''));
  const holdsInChain = entry => isLoopClip(entry) || !isStanceEntry(entry);
  ctx.pose.loopMode = entry => chainRunning
    ? (holdsInChain(entry) ? 'repeat' : 'once')
    : (animLoopPref === null ? null : (animLoopPref ? 'repeat' : 'once'));
  const clipDur = act => Math.max(0, act.getClip().duration - 1e-3);
  function setLoop(on){
    animLoopPref = on;
    const act = ctx.pose.action;
    if (!act) return;
    act.loop = on ? THREE.LoopRepeat : THREE.LoopOnce;
    act.clampWhenFinished = !on; act.repetitions = Infinity;
    if (on && (act.paused || !act.isRunning())){
      if (act.time >= clipDur(act)) act.time = 0;
      act.paused = false; act.enabled = true; act.play();
    }
  }
  animLoopBtn.onclick = () => setLoop(!(ctx.pose.action ? ctx.pose.action.loop === THREE.LoopRepeat : !!animLoopPref));
  function seek(t){
    const act = ctx.pose.action; if (!act) return;
    act.paused = true; act.enabled = true;
    act.time = Math.min(Math.max(0, t), clipDur(act));
  }
  document.getElementById('animFirst').onclick = () => seek(0);
  document.getElementById('animLast').onclick  = () => { if (ctx.pose.action) seek(clipDur(ctx.pose.action)); };
  document.getElementById('animPrev').onclick  = () => { if (ctx.pose.action) seek((Math.round(ctx.pose.action.time / FRAME) - 1) * FRAME); };
  document.getElementById('animNext').onclick  = () => { if (ctx.pose.action) seek((Math.round(ctx.pose.action.time / FRAME) + 1) * FRAME); };
  animPlayBtn.onclick = () => {
    const act = ctx.pose.action; if (!act) return;
    if (act.paused || !act.isRunning()){
      if (act.loop === THREE.LoopOnce && act.time >= clipDur(act)) act.reset();
      act.paused = false; act.enabled = true; act.play();
    } else act.paused = true;
  };
  animScrub.oninput = () => seek(+animScrub.value * FRAME);
  // the Play button keeps the width of its wider label, so the row never shifts as it toggles
  {
    const keep = animPlayBtn.textContent; animPlayBtn.textContent = 'Pause';
    const w = Math.ceil(animPlayBtn.getBoundingClientRect().width);
    if (w) animPlayBtn.style.setProperty('--play-w', w + 'px');
    animPlayBtn.textContent = keep;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
      const t = animPlayBtn.textContent; animPlayBtn.textContent = 'Pause';
      const w2 = Math.ceil(animPlayBtn.getBoundingClientRect().width);
      if (w2) animPlayBtn.style.setProperty('--play-w', w2 + 'px');
      animPlayBtn.textContent = t;
    });
  }
  let animLast = '', animTick = 0;
  function paintAnim(){
    if ((++animTick % 60) === 0) syncChainSelects();     // the chain's pickers follow the Pose and Stance lists
    const act = ctx.pose.action;
    animBar.classList.toggle('idle', !act);
    if (!act) { if (animLast !== ''){ animLast = ''; animFrameEl.textContent = 'no animation playing'; } return; }
    const dur = clipDur(act), total = Math.round(dur / FRAME), cur = Math.min(total, Math.round(act.time / FRAME));
    const playing = !act.paused && act.isRunning();
    const key = cur + '/' + total + (playing ? 'p' : 's') + (act.loop === THREE.LoopRepeat ? 'L' : '');
    if (key === animLast) return;
    animLast = key;
    animFrameEl.textContent = 'frame ' + cur + ' of ' + total + '  (' + (cur / 60).toFixed(2) + ' s)';
    animScrub.max = String(total); animScrub.value = String(cur);
    animPlayBtn.textContent = playing ? 'Pause' : 'Play';
    animLoopBtn.classList.toggle('on', act.loop === THREE.LoopRepeat);
  }
  // The chain: hunter poses and weapon stances played back to back (Raven, 2026-09-03: "This
  // way people can chain stances into poses or vice versa"). A link is { kind: 'pose', value:
  // 'g:N', label } or { kind: 'stance', cls, clsName, clip, label }; a pose link sheathes the
  // weapon, a stance link draws it. The Animation panel carries copies of the Pose and Stance
  // selects to pick from; the x on a row removes it.
  // Raven, 2026-09-03: "Ensure Chain Animation sequences persist when switching between male,
  // female and palico." The chain is never emptied by the viewer, only by Clear: a stance link
  // names its class and clip rather than an index into the current list, so the stance list
  // rebuilding (a class change, Reset, Open, the male default's weapon) keeps it, and a link
  // whose class is not the one equipped shows muted and is skipped when the chain plays. A
  // chain that is running when the body or the figure switches resumes at the same link once
  // the switch is done (the Palico takes the pose system while it is on screen, so the
  // hunter's chain waits for the Hunter tab).
  const chain = [];
  let chainPos = -1, chainRunning = false, chainLoop = false, chainDriving = false;
  let chainResume = -1;      // the link to resume at when the hunter comes back on screen
  // the index of a stance link in the CURRENT class's list, or -1 when it belongs to another
  function chainStanceIndex(el){
    if (el.kind !== 'stance' || el.cls !== ctx.weaponClassSel.value) return -1;
    return ctx.weapon.poses().findIndex(p => p.clip === el.clip);
  }
  const chainPlayable = el => el.kind === 'pose' || chainStanceIndex(el) >= 0;
  const chainList = document.getElementById('chainList');
  const chainPoseSel = document.getElementById('chainPoseSel'), chainStanceSel = document.getElementById('chainStanceSel');
  let chainSelSig = '';
  function syncChainSelects(){
    const poseOpts = [...document.getElementById('pose').options].filter(o => o.value.startsWith('g:'));
    const stanceOpts = [...ctx.weaponPoseSel.options].filter(o => o.value !== '');
    const sig = poseOpts.length + ':' + stanceOpts.length + ':' + (stanceOpts[0] ? stanceOpts[0].title : '');
    if (sig === chainSelSig) return;
    chainSelSig = sig;
    chainPoseSel.innerHTML = poseOpts.map(o => '<option value="' + o.value + '">' + o.text + '</option>').join('');
    chainStanceSel.innerHTML = stanceOpts.map(o => '<option value="' + o.value + '" title="' + o.title + '">' + o.text + '</option>').join('');
    chainStanceSel.disabled = !stanceOpts.length; document.getElementById('chainAddStance').disabled = !stanceOpts.length;
  }
  function chainLabel(el){
    if (el.kind === 'pose'){ const o = [...chainPoseSel.options].find(o => o.value === el.value); return o ? o.text : (el.label || el.value); }
    return chainPlayable(el) ? el.label : el.label + ' (' + (el.clsName || el.cls) + ')';
  }
  function paintChain(){
    syncChainSelects();
    chainList.innerHTML = chain.map((el, k) => {
      const off = !chainPlayable(el);
      return '<li class="' + (k === chainPos ? 'on' : '') + (off ? ' off' : '') + '" data-i="' + k + '"' +
        (off ? ' title="A stance of another weapon class: it plays when that class is equipped"' : '') + '>' +
        '<span class="grip" title="Drag to reorder">&#8942;&#8942;</span>' +
        '<span class="n">' + (k + 1) + '.</span><span class="lab">' + chainLabel(el) + '</span>' +
        '<span class="x" data-k="' + k + '" title="Remove from the chain">&times;</span></li>';
    }).join('');
    document.getElementById('chainLoop').classList.toggle('on', chainLoop);
  }
  // The hold counts on the animation's clock, not the wall's: a held link (a pose or a loop
  // stance) waits CHAIN_HOLD seconds of PLAYING time, so pausing the animation -- Pause, the
  // scrubber, a frame step -- pauses the chain with it (Raven, 2026-09-04: "When I pause an
  // animation during chain, it proceeds forward still to the next segment"; it was a
  // setTimeout). A link with no animation to pause counts as before. Stepped from the loop.
  let chainHold = 0, chainHoldK = -1, chainHoldPrev = 0;
  function chainClearHold(){ chainHold = 0; chainHoldK = -1; }
  function stepChainHold(){
    const now = performance.now();
    const dt = chainHoldPrev ? Math.min((now - chainHoldPrev) / 1000, 0.1) : 0;
    chainHoldPrev = now;
    if (!chainRunning || chainHold <= 0 || chainHoldK !== chainPos) return;
    const act = ctx.pose.action;
    if (act && (act.paused || !act.isRunning())) return;
    chainHold -= dt;
    if (chainHold <= 0){ chainClearHold(); chainPlayFrom(chainPos + 1); }
  }
  function chainReset(){ chainClearHold(); chain.length = 0; chainPos = -1; chainRunning = false; paintChain(); }
  function chainStop(){ chainClearHold(); if (!chainRunning && chainPos < 0) return; chainRunning = false; chainPos = -1; paintChain(); }
  async function chainPlayFrom(k){
    chainClearHold();
    if (!chain.some(chainPlayable)){ chainStop(); return; }      // nothing of this class to play
    if (k >= chain.length){ if (chainLoop && chain.length) k = 0; else { chainStop(); return; } }
    const el = chain[k];
    if (!chainPlayable(el)){ chainPos = k; chainRunning = true; return chainPlayFrom(k + 1); }   // another class's stance: skipped
    chainPos = k; chainRunning = true; paintChain();
    if (el.kind === 'pose'){
      ctx.weaponDrawnSel.value = '0';
      const ps = document.getElementById('pose');
      if ([...ps.options].some(o => o.value === el.value)) ps.value = el.value;
    } else {
      ctx.weaponDrawnSel.value = '1'; ctx.weaponPoseSel.value = String(chainStanceIndex(el));
    }
    chainDriving = true;
    try { await ctx.applyWeaponState(); } finally { chainDriving = false; }
    // a pose or a loop stance never "finishes": it holds for CHAIN_HOLD, unless it is the last
    // link of a chain that does not repeat
    const holds = el.kind === 'pose' || isLoopClip(ctx.weapon.poses()[chainStanceIndex(el)]);
    const last = k === chain.length - 1;
    if (chainRunning && chainPos === k && holds && !(last && !chainLoop)){ chainHold = CHAIN_HOLD; chainHoldK = k; }
  }
  // what saveState writes for the chain: the links as they are, and the Loop flag. A hoisted
  // function so saveState can name it from higher up; before the chain exists it returns nothing
  function chainSaveState(){
    try { return { chain: chain.map(el => Object.assign({}, el)), chainLoop }; } catch (_) { return {}; }
  }
  document.getElementById('chainAddPose').onclick = () => {
    if (!chainPoseSel.value) return;
    chain.push({ kind: 'pose', value: chainPoseSel.value, label: chainPoseSel.options[chainPoseSel.selectedIndex].text });
    paintChain(); ctx.saveState();
  };
  // Preview: play the picked pose or stance now, exactly as picking it in the Hunter or Weapon
  // panel would (Raven, 2026-09-03: "Add a preview button for both Animation Pose and Stance
  // drop downs")
  document.getElementById('chainPrevPose').onclick = async () => {
    if (!chainPoseSel.value) return;
    const ps = document.getElementById('pose'); ps.value = chainPoseSel.value; ctx.weaponDrawnSel.value = '0';
    await ctx.applyWeaponState(); ctx.saveState();
  };
  document.getElementById('chainPrevStance').onclick = async () => {
    if (chainStanceSel.value === '') return;
    ctx.weaponPoseSel.value = chainStanceSel.value; ctx.weaponDrawnSel.value = '1';
    await ctx.applyWeaponState(); ctx.saveState();
  };
  // picking in either list previews it at once (Raven: "Have Stances and Poses auto preview on
  // selection"); the buttons stay for replaying the pick
  chainPoseSel.onchange = () => document.getElementById('chainPrevPose').onclick();
  chainStanceSel.onchange = () => document.getElementById('chainPrevStance').onclick();
  document.getElementById('chainAddStance').onclick = () => {
    if (chainStanceSel.value === '') return;
    const p = ctx.weapon.poses()[+chainStanceSel.value]; if (!p) return;
    const cj = ctx.weapon.classJson();
    chain.push({ kind: 'stance', cls: ctx.weaponClassSel.value, clsName: cj ? cj.name : ctx.weaponClassSel.value, clip: p.clip, label: p.label });
    paintChain(); ctx.saveState();
  };
  document.getElementById('chainClear').onclick = () => { chainReset(); ctx.saveState(); };
  document.getElementById('chainLoop').onclick = () => { chainLoop = !chainLoop; paintChain(); ctx.saveState(); };
  document.getElementById('chainPlay').onclick = () => { if (chain.length) chainPlayFrom(0); };
  chainList.onclick = e => {
    const k = e.target && e.target.dataset ? e.target.dataset.k : undefined;
    if (k === undefined) return;
    chain.splice(+k, 1); if (chainPos >= chain.length) chainPos = -1; paintChain(); ctx.saveState();
  };
  // Reordering by drag (Raven, 2026-09-04: "Being able to rearrange the segments would be
  // useful, can we drag and drop the list items?"). Pointer events on the row's grip, so a
  // mouse and a finger both work and the page does not scroll under a touch drag. The row
  // under the pointer shows a line above or below it for where the drop lands; the running
  // link keeps its identity, so moving it (or moving another row past it) leaves the chain
  // playing the same link, hold and all.
  function chainMove(from, ins){
    if (from === ins || from + 1 === ins) return;
    const cur = chainPos >= 0 ? chain[chainPos] : null;
    const [el] = chain.splice(from, 1);
    chain.splice(ins > from ? ins - 1 : ins, 0, el);
    if (cur){ chainPos = chain.indexOf(cur); if (chainHoldK >= 0) chainHoldK = chainPos; }
    paintChain(); ctx.saveState();
  }
  {
    let from = -1, ins = -1, grip = null;
    const rows = () => [...chainList.querySelectorAll('li')];
    const clear = () => { rows().forEach(li => li.classList.remove('drag', 'ins-before', 'ins-after')); chainList.classList.remove('dragging'); };
    const place = (x, y) => {
      const list = rows(); if (!list.length) return -1;
      const under = document.elementFromPoint(x, y), li = under && under.closest ? under.closest('#chainList li') : null;
      if (li){ const r = li.getBoundingClientRect(), i = +li.dataset.i; return y < r.top + r.height / 2 ? i : i + 1; }
      const first = list[0].getBoundingClientRect(), last = list[list.length - 1].getBoundingClientRect();
      return y < first.top ? 0 : (y > last.bottom ? list.length : -1);
    };
    const paintIns = () => {
      const list = rows(); list.forEach(li => li.classList.remove('ins-before', 'ins-after'));
      if (ins < 0 || ins === from || ins === from + 1) return;
      if (ins < list.length) list[ins].classList.add('ins-before'); else list[list.length - 1].classList.add('ins-after');
    };
    chainList.addEventListener('pointerdown', e => {
      const g = e.target && e.target.closest ? e.target.closest('.grip') : null;
      if (!g || e.button) return;
      const li = g.closest('li'); from = +li.dataset.i; ins = -1; grip = g;
      li.classList.add('drag'); chainList.classList.add('dragging');
      try { g.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    chainList.addEventListener('pointermove', e => {
      if (from < 0) return;
      ins = place(e.clientX, e.clientY); paintIns();
    });
    const end = e => {
      if (from < 0) return;
      const f = from, i = e.type === 'pointerup' ? place(e.clientX, e.clientY) : -1;
      try { if (grip && grip.hasPointerCapture && grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId); } catch (_) {}
      from = -1; ins = -1; grip = null; clear();
      if (i >= 0) chainMove(f, i);
    };
    chainList.addEventListener('pointerup', end);
    chainList.addEventListener('pointercancel', end);
  }
  ctx.pose.onFinished = () => { if (chainRunning) chainPlayFrom(chainPos + 1); };
  // The saved chain comes back on load, checked link by link (Raven, 2026-09-03: "Make the
  // chain survive a page reload too"). Labels are stored with the links, so this needs neither
  // the pose list nor the class's stance list; a stance of a class not yet equipped shows muted
  // until the boot restores the weapon. It is listed, not started.
  if (ctx.SAVED && Array.isArray(ctx.SAVED.chain)){
    for (const el of ctx.SAVED.chain){
      if (!el || typeof el !== 'object') continue;
      if (el.kind === 'pose' && typeof el.value === 'string' && el.value.startsWith('g:'))
        chain.push({ kind: 'pose', value: el.value, label: typeof el.label === 'string' ? el.label : el.value });
      else if (el.kind === 'stance' && typeof el.cls === 'string' && typeof el.clip === 'string')
        chain.push({ kind: 'stance', cls: el.cls, clsName: typeof el.clsName === 'string' ? el.clsName : el.cls,
                     clip: el.clip, label: typeof el.label === 'string' ? el.label : el.clip });
    }
    chainLoop = !!ctx.SAVED.chainLoop;
    paintChain();
  }
  ctx.weaponFormSel.onchange  = () => { ctx.weapon.setForm(ctx.weaponFormSel.value === '' ? null : +ctx.weaponFormSel.value); ctx.weapon.step(); ctx.saveState(); };
  ctx.arrowSel.onchange       = () => { ctx.weapon.setArrow(ctx.arrowSel.value || null); ctx.saveState(); };
  ctx.kinsectSel.onchange     = async () => { await ctx.weapon.setKinsect(ctx.kinsectSel.value || null); ctx.saveState(); };
  ctx.kinsectElSel.onchange   = () => { ctx.weapon.setKinsectElement(ctx.kinsectElSel.value); ctx.saveState(); };
  ctx.kinsectMotSel.onchange  = async () => { await ctx.weapon.setKinsectMotion(ctx.kinsectMotSel.value || null); ctx.saveState(); };

  ctx.buildPoseList();

  return {
    chainPlayFrom, chainStop, clipDur, paintAnim, paintChain, stepChainHold, chainSaveState,
    get chainDriving(){ return chainDriving; },
    get chainHold(){ return chainHold; },
    get chainPos(){ return chainPos; },
    get chainResume(){ return chainResume; }, set chainResume(v){ chainResume = v; },
    get chainRunning(){ return chainRunning; }
  };
}
