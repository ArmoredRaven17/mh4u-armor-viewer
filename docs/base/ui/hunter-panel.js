// THE HUNTER PANEL of the shared viewer base (docs/base/ui; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md; Raven,
// 2026-10-18: "each app has the same UI for things like pigments, armor selection, player model customizations"):
// Gender; Face with its show toggle and style; Face Paint; Hair with its toggle and style; Body; Clothing; Pose. Moved
// from GU's index.html (2026-10-18); the markup and its ids are GU's. Every colour row (Face Paint, Eye, Hair, Skin) is
// base/ui/colour-rows.js and the Clothing Color row is base/ui/pigment.js's cloth row: this module only lists and
// wires the selects and toggles.
//
// WHAT a list holds is the game's, through the app's adapter: ctx.charStyles(part) the face / hair styles
// ([{ label }], in the game's order), ctx.paintCount() the face paints of the face shown, ctx.clothingOptions()
// ([{ value, label }]) and ctx.clothingDefault, ctx.poseOptions() the held poses ([{ label, group, src, clip, dur }]).
// A 'strip' row (3U's Skin Tone) is painted from ctx.strip(id) and reports to ctx.onStrip(id, index) (below).
// WHAT a change does is the app's: ctx.setGender(g), ctx.refreshChar(), ctx.applyFacePaint(), ctx.setBody(on),
// ctx.setClothing(), ctx.onPoseChange(value); ctx.facePaint is the paint shown (null = none).
// The rows are built by base/ui/hunter-tab.js from game.hunterRows; a row the game has not got is simply not there.
import { paintField, wireField } from './colour-field.js';
export function createHunterPanel(game, ctx){
  const $ = id => document.getElementById(id);

  // the face and hair styles, keeping the one shown (or the one a restore asked for, dataset.want)
  function buildStyleLists(){
    for (const part of ['face','hair']){
      const list = ctx.charStyles(part);
      const sel = $(part + 'Style');
      if (!sel) continue;
      const cur = sel.value;
      sel.innerHTML = list.map((e,i) => '<option value="'+i+'">'+e.label+'</option>').join('');
      const want = sel.dataset.want;
      if (want !== undefined && +want < list.length){ sel.value = want; delete sel.dataset.want; }
      else if (cur && +cur < list.length) sel.value = cur;
    }
    buildPaintList();
  }
  // the face's paints: they have no names in game, so they are Type 1..N as the faces and hairs are (Raven, 2026-09-24)
  function buildPaintList(){
    const sel = $('facePaint');
    if (!sel) return;
    const n = ctx.paintCount();
    sel.innerHTML = '<option value="">None</option>' +
      Array.from({ length: n }, (_, i) => '<option value="' + i + '">Type ' + (i + 1) + '</option>').join('');
    if (ctx.facePaint !== null && ctx.facePaint >= n) ctx.facePaint = null;
    sel.value = ctx.facePaint === null ? '' : String(ctx.facePaint);
  }
  // the game's poses go in their own group, after the two authored stances
  function buildPoseList(){
    const sel = $('pose');
    if (!sel) return;
    const list = ctx.poseOptions();
    if (!list.length) return;
    // Only the game's own held poses are offered. `relaxed` and `t-pose` were ours, authored
    // before the lobby motions were found; `relaxed` survives as the internal resting stance
    // behind a weapon stance, but it is not something to pick any more.
    // One optgroup per `group` in first-seen order (Raven, 2026-09-05: every player motion list
    // is shipped now); the entries without one are the original held poses, whose g:N index
    // every saved set relies on, so they come first and keep their numbers.
    const order = [], byGroup = new Map();
    list.forEach((p, i) => {
      const g = p.group || 'Game poses';
      if (!byGroup.has(g)){ byGroup.set(g, []); order.push(g); }
      byGroup.get(g).push('<option value="g:' + i + '" title="' + (p.src ? p.src + ' ' : '') + p.clip + (p.dur ? ', ' + p.dur.toFixed(2) + ' s' : ', one frame') + '">' + p.label + '</option>');
    });
    sel.insertAdjacentHTML('beforeend', order.map(g => '<optgroup label="' + g + '">' + byGroup.get(g).join('') + '</optgroup>').join(''));
  }

  // the clothing: none stays a choice beside the game's (Raven, 2026-09-03: "Making Clothing Type 1 the default, but
  // leave none an option")
  const clothSel = $('clothing');
  if (clothSel){
  // game.clothingNone === false: no bare choice (MH3U: an empty piece draws the inner wear, 0x892a14)
  clothSel.innerHTML = (game.clothingNone === false ? '' : '<option value="">&mdash; none &mdash;</option>') +
    ctx.clothingOptions().map(o => '<option value="' + o.value + '">' + o.label + '</option>').join('');
  if (ctx.clothingDefault !== undefined) clothSel.value = ctx.clothingDefault;
  clothSel.onchange = () => ctx.setClothing().then(ctx.saveState);
  }

  const genderSel = $('genderSel');
  if (genderSel){
    genderSel.value = ctx.gender;
    genderSel.onchange = () => ctx.setGender(genderSel.value).then(ctx.saveState);
  }
  const on = (id, f) => { const e = $(id); if (e) e.onchange = f; };
  on('pose', e => ctx.onPoseChange(e.target.value));
  on('facePaint', e => {
    ctx.facePaint = e.target.value === '' ? null : +e.target.value;
    ctx.applyFacePaint(); ctx.saveState();
  });
  for (const id of ['faceStyle', 'hairStyle', 'face', 'hair'])
    on(id, () => ctx.refreshChar().then(ctx.saveState));
  on('body', e => { ctx.setBody(e.target.checked); ctx.saveState(); });

  // A STRIP ROW (game.hunterRows kind 'strip'; 3U's Skin Tone): a range over the game's own colour strip. The value is
  // an index and its colour is that texel, exactly (no blend). ctx.strip(id) -> [[r, g, b] ...] is the app's strip (its
  // adapter's data); the track shows the whole strip, the chip the colour picked. ctx.onStrip(id, value) is the app's,
  // live while dragging. setStrip(id, value) puts a restored value back and repaints.
  //   RGB... (the row's rgb: true; Raven, 2026-10-18: "I still want RGB to be an option since the game supports it via
  // save editing" -- the game's save holds the colour as RGB): any colour, set directly. The VALUE is then '#rrggbb'
  // instead of an index: the chip shows it and the strip marks no position (its thumb hidden) until it is dragged again.
  // An index-only value (an older save) loads as before.
  // A checkbox row with `always: true` (GU's Face / Hair / Body, hidden) is held ON: its `checked` reads true and a write
  // is ignored, so every restore path -- a session, a set file, a hunter slot -- lands it on, while the app's code that
  // reads it stays as it was (a Debug switch could bring the row back)
  for (const r of (game.hunterRows || []).filter(r => r.kind === 'check' && r.always)){
    const el = $(r.input);
    if (el) Object.defineProperty(el, 'checked', { get(){ return true; }, set(){}, configurable: true });
  }
  const STRIPS = (game.hunterRows || []).filter(r => r.kind === 'strip');
  const rgb = c => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  const stripFree = {};                     // the row's colour when RGB... set it, else null
  function paintStrip(r){
    const el = $(r.input), s = ctx.strip ? ctx.strip(r.input) : null;
    if (!el || !s || !s.length) return;
    el.style.background = 'linear-gradient(to right,' + s.map(rgb).join(',') + ')';
    const free = stripFree[r.input];
    el.classList.toggle('free', !!free);
    const chip = r.chip && $(r.chip), c = s[Math.max(0, Math.min(s.length - 1, +el.value))];
    if (chip) chip.style.background = free || (c ? rgb(c) : '');
    // the strip row's colour field: the strip colour's hex, or the free colour's (Raven, 2026-10-18: "Same for hair color
    // and skin tone")
    paintField($(r.input + 'Hex'), free || (c ? '#' + c.map(v => v.toString(16).padStart(2, '0')).join('') : null));
  }
  for (const r of STRIPS){
    const el = $(r.input);
    if (!el) continue;
    paintStrip(r);
    // a hex typed or pasted makes the row's colour free ('#rrggbb'), as a pick in the selector does
    wireField($(r.input + 'Hex'), hex => {
      stripFree[r.input] = hex; paintStrip(r); if (ctx.onStrip) ctx.onStrip(r.input, hex);
    }, () => paintStrip(r));
    el.oninput = () => {
      stripFree[r.input] = null;
      paintStrip(r); if (ctx.onStrip) ctx.onStrip(r.input, +el.value);
    };
    // the palette button (Raven, 2026-10-18): the shared pigment selector, its RGB selection included ("the RGB sliders are
    // handled in the modal"); a pick makes the row's colour free ('#rrggbb'), and dragging the strip returns to an index
    const pal = $(r.input + 'Pal');
    if (pal && ctx.openPalette) pal.onclick = () => {
      const s = ctx.strip ? ctx.strip(r.input) : null, c = s && s[+el.value];
      const now = stripFree[r.input] || (c ? '#' + c.map(v => v.toString(16).padStart(2, '0')).join('') : null);
      ctx.openPalette(r.label || r.input, now, hex => {
        stripFree[r.input] = hex; paintStrip(r); if (ctx.onStrip) ctx.onStrip(r.input, hex);
      }, () => {
        // the selector's Default: the strip's default position (game.js `default`)
        stripFree[r.input] = null;
        if (r['default'] != null) el.value = String(r['default']);
        paintStrip(r); if (ctx.onStrip) ctx.onStrip(r.input, +el.value);
      }, {
        // the game's own strip, first in the selector; a cell is that strip position, as a drag is
        strip: s || null,
        onIndex: i => { stripFree[r.input] = null; el.value = String(i); paintStrip(r); if (ctx.onStrip) ctx.onStrip(r.input, i); }
      });
    };
  }
  function setStrip(id, v){
    const r = STRIPS.find(x => x.input === id), el = $(id);
    if (!r || !el) return;
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) stripFree[id] = v.toLowerCase();
    else { stripFree[id] = null; el.value = String(v); }
    paintStrip(r);
  }

  return { buildPaintList, buildPoseList, buildStyleLists, setStrip };
}
