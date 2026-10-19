// PIGMENT for the shared viewer base (docs/base/ui; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md): one row per
// dyeable slot (tick / hex / swatch / palette button), the All row (a write-through), the Clothing Color row, the
// Palico's rows and their All, the game's own pigments in the palette modal, Default tracking (a row on Default follows
// the piece's authored colour) and the Deviant pigments (per-slot pairs with Fade / Fast Fade / Pulse). Moved verbatim
// from GU's index.html (2026-10-18). Raven, 2026-10-18 (Phase 1.2, to build next): tick off = undyed (as here); All =
// write-through plus a "Mixed" readout; undyeable rows disabled with a reason; one combined picker with a tab per game.
// createPigment(game, ctx): ctx names the app's objects lazily -- the slots, the game's pigment table, the piece data
// (defaultPigHex reads the equipped piece's own colour), the save, the Esurient step.
import * as THREE from 'three';
import { tint, applyTint, armorMats } from '../render/material.js';

import { createRgbPicker } from './rgb-picker.js';
import { paintField } from './colour-field.js';
export function createPigment(game, ctx){
  // ---- one RGB pigment per armour piece --------------------------------------
  // the dyeable slots' labels (game.pigmentSlotLabels), and the rows a game adds: GU's Clothing Color row and the Palico's
  // two (game.pigmentCloth / game.pigmentPalico). DEV_SLOTS' order is a saved shape (slotDev): a game's rows keep theirs.
  const SLOT_LABEL = game.pigmentSlotLabels || {};
  const CLOTH = game.pigmentCloth ? ['cloth'] : [];
  const OT_ROWS = game.pigmentPalico ? ['oall', 'ohelm', 'obody'] : [];
  function pigRow(id, label, title){
    return '<div class="field" id="pgRow_'+id+'"><label for="pg_'+id+'">'+label+'</label>' +
      '<div class="row gap">' +
      '<input type="checkbox" id="pgOn_'+id+'" aria-label="Dye '+label+'">' +
      '<input type="text" class="hexbtn colourfield" id="pgHex_'+id+'" maxlength="7" spellcheck="false" ' +
      'autocomplete="off" title="Type or paste a hex value; click to select and copy" value="#c0c0c0">' +
      '<input type="color" id="pg_'+id+'" class="rgb-input" title="'+title+'">' +
      '<button type="button" class="palbtn" id="pgPal_'+id+'" title="In-game pigments" ' +
      'aria-label="In-game pigments for '+label+'">&#9638;</button></div></div>';
  }
  document.getElementById('slotPig').innerHTML =
    pigRow('all', 'All', 'Pigment for every piece') +
    '<hr style="border:0;border-top:1px solid var(--line);margin:8px 0">' +
    ctx.SLOTS.map(sl => pigRow(sl, SLOT_LABEL[sl], 'Pigment for ' + SLOT_LABEL[sl])).join('');
  // The clothing takes ONE colour across every part it covers, so it gets a single row of
  // its own rather than being driven by the five armor slots. It lives beside the Clothing
  // select in the Hunter panel because that is where the game puts it -- "Clothing Color"
  // sits with Skin Tone / Eye Color / Hair Color in CharMakeMsg.
  if (CLOTH.length && document.getElementById('clothPig')){
    document.getElementById('clothPig').innerHTML =
      pigRow('cloth', 'Clothing Color', 'Pigment for the clothing');
    // NO TICK (Raven, 2026-10-18: "Remove the check box for clothing color, it should be pigmented like armors"): the
    // row shows its current colour -- the hex, or "Default" (the clothing as drawn) -- and its palette button opens the
    // whole selector (Default, Pigments, board, RGB). The tick, hex field and colour input stay in the page, hidden, as
    // the row's state, so a save keeps its shape and an old one with the tick off loads as Default.
  }
  // The Palico's two pieces get their own rows and their own All, built here so the hex
  // field, the palette button and persistence all wire themselves the same way the
  // hunter's do -- the two figures simply never write over each other.
  if (OT_ROWS.length && document.getElementById('otSlotPig'))
    document.getElementById('otSlotPig').innerHTML =
      pigRow('oall', 'All', 'Pigment for both Palico pieces') +
      '<hr style="border:0;border-top:1px solid var(--line);margin:8px 0">' +
      pigRow('ohelm', 'Head', 'Pigment for the Palico head') +
      pigRow('obody', 'Chest', 'Pigment for the Palico chest');
  // THE PIGMENT UNDER EACH PIECE (Raven, 2026-10-18: "Let's combine Armor Piece and Pigment panels, list the pigment under
  // each piece"): the rows are built as before, then MOVED into the pieces' panel -- All above the first piece (it has no
  // piece of its own), each slot's row right under its piece select (its label "Pigment", the piece's name being just
  // above), the Dye mask at the panel's end -- and the emptied Pigment panel is hidden. Ids, handlers and the save are
  // untouched. The Palico pane does the same with its own Equipment panel.
  // each moved row names its piece (Raven, 2026-10-19: "Update the Armor Piece Pigments to say which armor piece they
  // belong to"): the game's own wording where game.js gives it (pigmentRowLabels, e.g. MH3U's StMenu "Pigment: Head"),
  // else "Pigment: " and the slot's label
  const rowLabel = (id, slotLabel) => (game.pigmentRowLabels && game.pigmentRowLabels[id]) || ('Pigment: ' + slotLabel);
  function underPieces(selId, rows, allId, pigBox, labels){
    const first = document.getElementById(selId(rows[0]));
    if (!first) return false;
    const body = first.closest('.panel-body');
    const all = allId && document.getElementById('pgRow_' + allId);
    if (all){
      first.closest('.field').parentElement.insertBefore(all, first.closest('.field'));
      all.classList.add('piece-pig');
      const lab = all.querySelector('label'); if (lab) lab.textContent = rowLabel(allId, 'All');
    }
    for (const sl of rows){
      const sel = document.getElementById(selId(sl)), row = document.getElementById('pgRow_' + sl);
      if (!sel || !row) continue;
      const f = sel.closest('.field');
      f.parentElement.insertBefore(row, f.nextSibling);
      row.classList.add('piece-pig');   // the end of a piece's group (base.css: a little space before the next piece)
      const lab = row.querySelector('label'); if (lab) lab.textContent = rowLabel(sl, labels[sl] || sl);
    }
    const box = document.getElementById(pigBox), panel = box && box.closest('.panel');
    const dye = panel && panel.querySelector('#maskdbg');
    if (dye) body.appendChild(dye.closest('label'));
    if (panel){ const wrap = document.getElementById('pigmentPanel'); (pigBox === 'slotPig' && wrap ? wrap : panel).hidden = true; }
    return true;
  }
  underPieces(sl => 's_' + sl, ctx.SLOTS, 'all', 'slotPig', SLOT_LABEL);
  if (OT_ROWS.length) underPieces(sl => 'o_' + sl.slice(1), OT_ROWS.slice(1), 'oall', 'otSlotPig', { ohelm: 'Head', obody: 'Chest' });
  // every pigment row, including the ones outside the Pigment panel
  const PIG_ROWS = ctx.SLOTS.concat(['all'], CLOTH, OT_ROWS);
  // NO TICKS (Raven, 2026-10-18: "remove the checkboxes keep the pigments enabled at all times"): every pigment row's
  // tick and colour input stay in the page, hidden, as its state; the row shows its colour in its hex field
  for (const id of PIG_ROWS){
    for (const pre of ['pgOn_', 'pg_']){ const e = document.getElementById(pre + id); if (e) e.hidden = true; }
  }
  const OT_PIG = OT_ROWS.slice(1);
  const pigOnDef = new Set();   // the rows on Default (see the Default button)

  // the hex label doubles as a copy button
  // THE ALL ROWS READ "Mixed" WHEN THE ROWS THEY SPEAK FOR DIFFER (Raven, 2026-10-18, the shared base: All is GU's
  // write-through, plus 3U / 4U's "Mixed" readout when the slots differ): a row that is off, on Default or on its own
  // colour each count; a row the worn piece cannot take (paintDyeable) is left out, as it is from 3U's All.
  function allMixed(id){
    const rows = (id === 'all' ? ctx.SLOTS : id === 'oall' ? OT_PIG : []).filter(sl => {
      const cb = document.getElementById('pgOn_' + sl); return cb && !cb.disabled;
    });
    const vals = rows.map(sl => !document.getElementById('pgOn_' + sl).checked ? 'off'
      : pigOnDef.has(sl) ? 'default' : document.getElementById('pg_' + sl).value.toLowerCase());
    return new Set(vals).size > 1;
  }
  function paintHexLabels(){
    for (const id of PIG_ROWS){
      const b = document.getElementById('pgHex_'+id);
      if (b && b.dataset.busy !== '1' && document.activeElement !== b)
        // a row on Default says so (Raven, 2026-10-02: "We can have the hex code show Default")
        b.value = (id === 'all' || id === 'oall') && allMixed(id) ? 'Mixed'
                : pigOnDef.has(id) ? 'Default' : document.getElementById('pg_'+id).value;
      // the field shows the row's colour (Raven: "the text field shows the colors now ... I like it"): its own, on
      // Default the piece's default, none on Mixed or an undyed clothing
      if (b && document.activeElement !== b){
        const on = document.getElementById('pgOn_' + id).checked, mixed = b.value === 'Mixed';
        paintField(b, on && !mixed ? document.getElementById('pg_' + id).value : null,
          mixed ? 'Mixed' : (on ? b.value.toUpperCase().replace('DEFAULT', 'Default') : 'Default'));
      }
    }
  }
  // DISABLED ROWS WITH A REASON (Raven, 2026-10-18, the shared base; GU takes it too for its undyeable pieces): the
  // app's adapter says whether the piece worn in a slot takes a pigment (ctx.dyeable(slot) -> { can, reason }); a row
  // that cannot is greyed out with the reason as its tooltip, its value kept for when a dyeable piece comes back.
  // Called whenever a slot's piece changes.
  function paintDyeable(){
    // ALWAYS PIGMENTED: a worn, dyeable piece's row found undyed (an old save with its tick off) is on its Default
    let moved = false;
    for (const sl of ctx.SLOTS.concat(OT_PIG)){
      const cb = document.getElementById('pgOn_' + sl);
      if (!cb || cb.checked) continue;
      const hex = defaultPigHex(sl);
      if (!hex || (ctx.dyeable && !(ctx.dyeable(sl) || { can: true }).can)) continue;
      cb.checked = true; document.getElementById('pg_' + sl).value = hex; pigOnDef.add(sl); moved = true;
    }
    if (moved) readSlotPigments();
    if (!ctx.dyeable){ paintHexLabels(); return; }
    for (const sl of ctx.SLOTS.concat(OT_PIG)){
      const r = ctx.dyeable(sl) || { can: true };
      for (const pre of ['pgOn_', 'pgHex_', 'pg_', 'pgPal_']){
        const e = document.getElementById(pre + sl); if (e) e.disabled = !r.can;
      }
      const row = document.getElementById('pgRow_' + sl);
      if (row){ row.title = r.can ? '' : (r.reason || ''); row.classList.toggle('off', !r.can); }
    }
    for (const id of ['all', 'oall']){
      const rows = id === 'all' ? ctx.SLOTS : OT_PIG;
      if (!rows.length) continue;
      const any = rows.some(sl => { const cb = document.getElementById('pgOn_' + sl); return cb && !cb.disabled; });
      for (const pre of ['pgOn_', 'pgHex_', 'pg_', 'pgPal_']){
        const e = document.getElementById(pre + id); if (e) e.disabled = !any;
      }
      const row = document.getElementById('pgRow_' + id);
      if (row) row.title = any ? '' : (ctx.dyeableNoneReason || '');
    }
    paintHexLabels();
  }
  // The hex field is the only place a value can be TYPED -- it accepts nothing but a hex
  // triple. The swatch beside it still opens the platform picker, which cannot be limited
  // to hex, so this is the hex-only route in and out.
  for (const id of PIG_ROWS){
    const f = document.getElementById('pgHex_'+id);
    const col = document.getElementById('pg_'+id);
    // one click selects the whole value, ready to copy. On a row on Default the field shows its
    // hex again and the row counts as modified from here (Raven, 2026-10-02: "if a user selects
    // the field have it revert to the hex value so they can copy it and then it is considered
    // modified"): the colour stays when the armor changes.
    f.onfocus = () => {
      if (pigOnDef.delete(id)) { f.value = col.value; ctx.saveState(); }
      f.select();
    };
    f.onclick = () => { if (f.selectionStart === f.selectionEnd) f.select(); };
    function commit(){
      let v = f.value.trim();
      if (v[0] !== '#') v = '#' + v;
      if (/^#[0-9a-f]{3}$/i.test(v))                       // #abc -> #aabbcc
        v = '#' + v.slice(1).split('').map(c => c + c).join('');
      if (!/^#[0-9a-f]{6}$/i.test(v)) { paintHexLabels(); return; }   // reject, snap back
      v = v.toLowerCase();
      col.value = v;
      const cb = document.getElementById('pgOn_'+id);
      if (!cb.checked) cb.checked = true;
      if (id === 'all') pushAll();
      else if (id === 'oall') otPushAll();
      else if (id === 'cloth') readSlotPigments();      // its own thing; All does not speak for it
      else if (OT_PIG.indexOf(id) >= 0) { if (otAllCb) otAllCb.checked = false; readSlotPigments(); }
      else { if (allCb) allCb.checked = false; readSlotPigments(); }
      paintHexLabels();
      ctx.saveState();
    }
    f.onchange = commit;
    f.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); commit(); f.blur(); } };
  }
  function readSlotPigments(){
    for (const sl of ctx.SLOTS.concat(CLOTH, OT_PIG)){
      const on = document.getElementById('pgOn_'+sl).checked;
      const hex = document.getElementById('pg_'+sl).value;
      if (!on) { ctx.slotPigment[sl] = null; continue; }
      // THE GAME'S BYTES, as the ROM's own colours reach a channel (render/material.js setChannelColor decodes them like a
      // texel: Option A, 2026-10-15). `new THREE.Color(hex)` decoded them here already, so a picked colour and the same colour
      // on Default (the piece's own mSymbolCol, raw) used to differ.
      ctx.slotPigment[sl] = ctx.rgb255(hex);
    }
    armorMats.forEach(applyTint);
    paintHexLabels();
  }
  // The colour a row shows when it carries no pigment. Undyed is the absence of a tint,
  // not a colour, so this is only what the swatch reads at rest.
  const PIG_NONE = '#c0c0c0';
  for (const sl of ctx.SLOTS){
    const cb = document.getElementById('pgOn_'+sl), col = document.getElementById('pg_'+sl);
    col.value = PIG_NONE;
    // touching one piece means the set is no longer uniform, so All stops claiming it is
    cb.onchange  = () => { allCb.checked = false; readSlotPigments(); ctx.saveState(); };
    col.oninput  = () => { if (!cb.checked) cb.checked = true; allCb.checked = false; readSlotPigments(); };
    col.onchange = ctx.saveState;
  }
  // the Clothing Color row (game.pigmentCloth; MH3U / MH4U have none)
  if (CLOTH.length){
    const cb = document.getElementById('pgOn_cloth'), col = document.getElementById('pg_cloth');
    col.value = PIG_NONE;
    cb.onchange  = () => { readSlotPigments(); ctx.saveState(); };
    col.oninput  = () => { if (!cb.checked) cb.checked = true; readSlotPigments(); };
    col.onchange = ctx.saveState;
  }
  // "All" is a convenience that writes through to the five, rather than a sixth pigment --
  // so the per-piece rows always show the truth and a set stays one colour per slot.
  const allCb = document.getElementById('pgOn_all'), allCol = document.getElementById('pg_all');
  allCol.value = PIG_NONE;
  function pushAll(){
    for (const sl of ctx.SLOTS){
      document.getElementById('pgOn_'+sl).checked = true;    // always pigmented (no tick, Raven 2026-10-18)
      document.getElementById('pg_'+sl).value = allCol.value;
    }
    readSlotPigments();
    paintHexLabels();
  }
  allCb.onchange  = () => { pushAll(); ctx.saveState(); };
  allCol.oninput  = () => { if (!allCb.checked) allCb.checked = true; pushAll(); };
  allCol.onchange = ctx.saveState;

  // the same three controls again for the Palico, against its own two rows (game.pigmentPalico; null without them)
  const otAllCb = document.getElementById('pgOn_oall'), otAllCol = document.getElementById('pg_oall');
  if (otAllCol) otAllCol.value = PIG_NONE;
  function otPushAll(){
    for (const sl of OT_PIG){
      document.getElementById('pgOn_' + sl).checked = true;
      document.getElementById('pg_' + sl).value = otAllCol.value;
    }
    readSlotPigments();
    paintHexLabels();
  }
  if (otAllCb){
    otAllCb.onchange  = () => { otPushAll(); ctx.saveState(); };
    otAllCol.oninput  = () => { if (!otAllCb.checked) otAllCb.checked = true; otPushAll(); };
    otAllCol.onchange = ctx.saveState;
  }
  for (const sl of OT_PIG){
    const cb = document.getElementById('pgOn_' + sl), col = document.getElementById('pg_' + sl);
    col.value = PIG_NONE;
    cb.onchange  = () => { otAllCb.checked = false; readSlotPigments(); ctx.saveState(); };
    col.oninput  = () => { if (!cb.checked) cb.checked = true; otAllCb.checked = false; readSlotPigments(); };
    col.onchange = ctx.saveState;
  }

  // ---- the game's own pigments, reachable from each row -----------------------
  // Picking a swatch is deliberately NOT a second pigment interface: it writes the hex into that row's hex field and
  // fires its own commit handler, so the RGB swatch, the All write-through, the dye-region shader and persistence all
  // behave exactly as they do for a value typed by hand. The grid itself is the selector's tab one (below).
  const pigModal = document.getElementById('pigModal');
  let pigTarget = null;
  const pigTile = (hex, title) =>
    '<button type="button" data-hex="' + hex + '" title="' + title + '" ' +
    'style="background:' + hex + '"></button>';
  // The Deviant pigments' two colors, offered as ordinary STATIC swatches as well -- the
  // pair is what the game animates between, but either half is a perfectly good flat color
  // and there is no other way to reach them. Named so the source is obvious on hover. Every half of every pair, in the
  // table's order, repeats kept (Raven, 2026-10-18: "each half of each pair"; the 125 are on their own tab now).
  {
    const extra = [];
    for (const [name, a, b] of ctx.DEVIANTS)
      for (const [hex, half] of [[a, 'A'], [b, 'B']])
        extra.push(pigTile(hex, name + ' ' + half + ' — ' + hex.toUpperCase()));
    if (extra.length)
      document.getElementById('pigDeviant').innerHTML =
        '<h3 class="stage-h">Deviant colors</h3><div class="pig-grid">' + extra.join('') + '</div>';
  }
  // A Deviant pigment is a PER-PIECE choice in game -- armorSeriesData stores a 5-bit
  // pigment id for each of the five armour slots -- so it is assigned from this modal, which
  // already knows which row it was opened for. That replaces the old single global deviant,
  // which had no way to say which piece it applied to.
  const slotDeviant = { helm:null, body:null, arm:null, wst:null, leg:null, cloth:null,
                        ohelm:null, obody:null };
  // The rows ON DEFAULT: Default puts a piece's own pigment in a row and marks it, and a marked
  // row follows the armor -- a new piece brings its own default (Raven, 2026-10-02: "make it so
  // Default Pigment updates on armor selection"). Any edit of the row after that keeps the
  // colour where it is ("If a user updates a pigment field after applying the default, we
  // maintain that color"), so the mark is the Default button's, never a colour that happens to
  // match a default. (pigOnDef itself is declared with PIG_ROWS, ahead of paintHexLabels.)
  const PIG_DEF_ROWS = ctx.SLOTS.concat(OT_PIG);
  function pigDefState(){ return PIG_DEF_ROWS.filter(sl => pigOnDef.has(sl)); }
  function applyPigDef(list){
    pigOnDef.clear();
    if (Array.isArray(list)) for (const sl of list) if (PIG_DEF_ROWS.indexOf(sl) >= 0) pigOnDef.add(sl);
  }
  // the rows an edit of `id` speaks for: All writes through to its figure's pieces
  const pigRowsOf = id => id === 'all' ? ctx.SLOTS : id === 'oall' ? OT_PIG : [id];
  // an edit by hand -- the checkbox, the swatch, the hex field -- is the row's own colour. A COLOUR typed or picked in
  // the row (its hex field, its colour input; on All, every row All speaks for) also ends a Deviant or Rainbow there,
  // as a pick in the modal does (commitHex): the animation kept running over the new colour (Raven, 2026-10-18:
  // "When selecting a non-Deviant pigment after selecting a Deviant pigment, it maintains the Deviant Pigment"). The
  // checkbox alone does not: unticking pauses the animation and ticking resumes it.
  // (the rows now live under their pieces -- underPieces -- so their panels listen too)
  const editBoxes = ['slotPig', 'otSlotPig', 'clothPig'].map(id => document.getElementById(id))
    .concat(['pgRow_helm', 'pgRow_ohelm'].map(id => { const r = document.getElementById(id); return r && r.closest('.panel-body'); }));
  for (const el of new Set(editBoxes)){
    if (!el) continue;
    const unmark = e => {
      const m = /^pg(On|Hex)?_(\w+)$/.exec(e.target.id || '');
      if (!m) return;
      for (const sl of pigRowsOf(m[2])){
        pigOnDef.delete(sl);
        if (m[1] !== 'On' && sl in slotDeviant) slotDeviant[sl] = null;
      }
    };
    el.addEventListener('input', unmark, true);
    el.addEventListener('change', unmark, true);
  }
  // every row a deviant pigment can be assigned to. The Palico's two were missing from all
  // of these lists, so a deviant could be PICKED for a Palico piece and then never animated,
  // never saved and never restored.
  const DEV_SLOTS = ctx.SLOTS.concat(CLOTH, OT_PIG);
  const ANIM_OPTS = a =>
    '<option value="fade"' + (a === 'fade' ? ' selected' : '') + '>Fade</option>' +
    '<option value="fastfade"' + (a === 'fastfade' ? ' selected' : '') + '>Fast Fade</option>' +
    '<option value="pulse"' + (a === 'pulse' ? ' selected' : '') + '>Pulse</option>';
  document.getElementById('pigDevList').innerHTML =
    '<h3 class="stage-h">Deviant pigments</h3>' +
    ctx.DEVIANTS.map((d, i) =>
      '<div class="devrow">' +
      '<button type="button" class="devpick" data-dev="' + i + '">' +
      '<span class="sw" style="background:' + d[1] + '"></span>' +
      '<span class="sw" style="background:' + d[2] + '"></span>' +
      '<span class="nm">' + d[0] + '</span>' +
      '<span class="hx">' + d[1].toUpperCase() + ' / ' + d[2].toUpperCase() + '</span></button>' +
      '<select class="devanim" data-dev="' + i + '">' + ANIM_OPTS(d[3]) + '</select>' +
      '</div>').join('') +
    '<h3 class="stage-h">Custom</h3>' +
    '<div class="devrow">' +
    '<input type="color" id="cusA" class="rgb-input" value="#0089ec" title="Color A">' +
    '<input type="color" id="cusB" class="rgb-input" value="#ff4033" title="Color B">' +
    '<select class="devanim" id="cusAnim">' + ANIM_OPTS('pulse') + '</select>' +
    '<button type="button" class="btn tiny" id="cusApply">Apply</button>' +
    '</div>';
  function setSlotDeviant(sl, idx){
    const d = ctx.DEVIANTS[idx];
    slotDeviant[sl] = d ? { name:d[0], a:d[1], b:d[2], anim:d[3] } : null;
    const cb = document.getElementById('pgOn_' + sl);
    if (d && !cb.checked) cb.checked = true;
    if (d) document.getElementById('pg_' + sl).value = d[1];   // rest colour until it steps
  }
  // resolve saved deviant names back to table entries; unknown names simply drop
  // THE ONE PIGMENT SELECTOR (Raven, 2026-10-18: "The intent was to have each game's pigments shows in a single
  // control for all apps"; the same control in every app, each showing ITS OWN game's colours only). Tab one is laid out
  // as the MH4U Armor Viewer's selector: EVERY colour list the game has for armour pigment, each its own section in 4U's
  // tile layout (Raven, 2026-10-18: "Any in game pigment should be listed, just in case someone likes a certain one they
  // can use it"), then the game's Rainbow where it has one, then the game's colour board at the bottom with room below
  // it. GU adds tab two, the Deviant pigments (game.pigmentDeviants). The sections come from the app
  // (ctx.pigmentSections(): [{ label, colours: [{ hex, name }] }] in the game's order; a label is the game's text where it
  // has one, else neutral; name null = the game gives none), the board and the Rainbow from game.js. An app with one list
  // may give ctx.pigmentColours() instead: one section, "Armor pigments" (4U's heading).
  let pigBefore = 0;          // the colours the sections hold before the dedupe (a check: pigmentCounts())
  const pigSections = ctx.pigmentSections ? ctx.pigmentSections()
    : [{ label: 'Armor pigments', colours: ctx.pigmentColours ? ctx.pigmentColours() : [] }];
  // ONE COLLECTION (Raven, 2026-10-18: "We can call them Pigments, since they will include all pigments, not just armor
  // pigments. We also won't need groups ... we can simply display them as one collection"): every section's colours in
  // the game's order under one "Pigments" heading, EACH DISTINCT COLOUR ONCE (Raven, 2026-10-18: "dedup the color
  // choices we don't need a color shown multiple times"): compared by exact RGB, kept at its first place in the game's
  // order (armour lists first, then the hunter's), its title naming every source it came from ("Hair Color 3 · Clothing
  // Color / Features 7"), else its hex.
  const pigAll = [];
  {
    const at = new Map();
    for (const c of [].concat(...pigSections.map(sec => sec.colours))){
      const k = String(c.hex).toLowerCase();
      const kept = at.get(k);
      if (!kept){ const e = { hex: c.hex, names: c.name ? [c.name] : [] }; at.set(k, e); pigAll.push(e); }
      else if (c.name && kept.names.indexOf(c.name) < 0) kept.names.push(c.name);
    }
    for (const e of pigAll) e.name = e.names.length ? e.names.join(' · ') : null;
  }
  pigBefore = [].concat(...pigSections.map(sec => sec.colours)).length;
  document.getElementById('pigPalettes').innerHTML =
    '<h3 class="stage-h">Pigments <span class="hx">' + pigAll.length + ' colors</span></h3>' +
    '<div class="pig-grid">' + pigAll.map(c => pigTile(c.hex, (c.name ? c.name + ' \u2014 ' : '') + c.hex.toUpperCase())).join('') +
    '</div>';
  // THE GAME'S RAINBOW (game.pigmentRainbow: { name, table: [[r,g,b] ...], unitsPerColour, unitsPerSecond }, read from
  // the game's code; none in a game whose Rainbow is not read): a colour per `unitsPerColour` game units, blending to the
  // next, the table looping; every piece on Rainbow shows the same colour at once (one timer per player, as in game).
  const RB = game.pigmentRainbow || null;
  // the Rainbow's key in a save: the game's name where it gives one (GU / 4U "Rainbow"), else a fixed token -- a game
  // that names it nothing (MHFU, name: null) shows no name anywhere, but its pick still saves and loads
  const RB_KEY = RB ? (RB.name || 'rainbow') : null;
  const rbHex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  // Rainbow is a tile like the others, the LAST of the Pigments grid (Raven, 2026-10-18: "make Rainbow like the other
  // pigments selections, at the end of the pigment choices"): its 8 colours as a gradient, the game's name as its title
  if (RB){
    const grid = document.querySelector('#pigPalettes .pig-grid');
    const tile = document.createElement('button');
    tile.type = 'button'; tile.id = 'pigRainbow'; tile.dataset.rainbow = '1'; tile.title = RB.name || '';
    // the static gradient of its 8 colours, left to right, as the first Rainbow row's square had it (Raven, 2026-10-18:
    // "keep the gradient in its square from the original implementation")
    tile.style.background = 'linear-gradient(90deg,' + RB.table.map(rbHex).join(',') + ')';
    grid.appendChild(tile);
    const head = document.querySelector('#pigPalettes .hx');
    if (head) head.textContent = (grid.children.length) + ' colors';
  }
  function rainbowAt(t){
    const u = Math.floor(t * (RB.unitsPerSecond || 60)), per = RB.unitsPerColour || 16, n = RB.table.length;
    const i = Math.floor(u / per) % n, j = (i + 1) % n, f = (u % per) / per;
    // round down per channel, as the game does
    return RB.table[i].map((v, k) => Math.floor(v * (1 - f) + RB.table[j][k] * f));
  }
  // THE GAME'S COLOUR BOARD (game.pigmentBoard: { image, region }, an image under base/; the region INCLUSIVE, [x0, y0,
  // x1, y1] with x1 / y1 the board's last column / row, as the 3U / 4U viewers read theirs), at the bottom of tab one under
  // 4U's heading; a click picks the colour under the pointer
  if (game.pigmentBoard){
    const b = game.pigmentBoard, [x0, y0, x1, y1] = b.region;
    const wrap = document.createElement('div'); wrap.id = 'pigBoard'; wrap.className = 'pig-board';
    wrap.innerHTML = '<h3 class="stage-h">Color board</h3>' +
      '<canvas data-board="' + b.image + '" data-region="' + b.region.join(',') + '" width="' + (x1 - x0 + 1) +
      '" height="' + (y1 - y0 + 1) + '" title="Click to pick a color from the game\'s own color board"></canvas>';
    const at = document.getElementById('pigPalettes');
    at.parentElement.insertBefore(wrap, at.nextSibling);
  }
  // RGB... ALWAYS, after the board, in every app (Raven, 2026-10-18: "... while providing the basic RGB choice"; "The
  // Color Board is pretty close to RGB, but I find it lacks in some ways compared to a true RGB selection"): a true RGB
  // selection (base/ui/rgb-picker.js). It dyes the row live through the row's own commit path and the selector stays
  // open, so the colour can be judged on the armour; Close ends it.
  let pigRgb = null;
  {
    const wrap = document.createElement('div'); wrap.id = 'pigRgb'; wrap.className = 'field';
    wrap.innerHTML = '<h3 class="stage-h">RGB\u2026</h3>';
    pigRgb = createRgbPicker({ onInput: hex => commitHex(hex, true), onCommit: hex => commitHex(hex, true) });
    pigRgb.el.querySelector('input[type=color]').id = 'pigRgbPick';
    wrap.appendChild(pigRgb.el);
    const at = document.getElementById(game.pigmentBoard ? 'pigBoard' : 'pigPalettes');
    at.parentElement.insertBefore(wrap, at.nextSibling);
  }
  // TAB TWO, THE DEVIANT PIGMENTS (GU: game.pigmentDeviants; Raven, 2026-10-18: "I want tabs within the modal"): the
  // static halves first, then the animated pairs. A game without them shows tab one alone, with no tab bar.
  const TAB_ONE = ['pigPalettes', 'pigBoard', 'pigRgb'], TAB_TWO = ['pigDeviant', 'pigDevList'];
  let showOwnTab = null;
  if (game.pigmentDeviants){
    const labels = game.pigmentTabLabels || [];
    const first = document.getElementById(TAB_ONE[0]);
    const own = document.createElement('div'); own.id = 'pigOwn';
    first.parentElement.insertBefore(own, first);
    const bar = document.createElement('div'); bar.className = 'row gap pig-tabs'; bar.id = 'pigOwnTabs';
    own.appendChild(bar);
    const panes = [TAB_ONE, TAB_TWO].map((parts, i) => {
      const pane = document.createElement('div'); pane.className = 'pig-pane'; pane.dataset.tab = String(i);
      for (const id of parts){ const e = document.getElementById(id); if (e) pane.appendChild(e); }
      own.appendChild(pane);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn tiny'; b.dataset.tab = String(i);
      b.textContent = labels[i] || ''; bar.appendChild(b);
      return pane;
    });
    const show = i => {
      panes.forEach((p, j) => { p.hidden = j !== i; });
      for (const b of bar.children) b.classList.toggle('on', +b.dataset.tab === i);
    };
    bar.onclick = e => { const b = e.target.closest('button[data-tab]'); if (b) show(+b.dataset.tab); };
    show(0);
    showOwnTab = show;
  } else {
    for (const id of TAB_TWO){ const e = document.getElementById(id); if (e) e.hidden = true; }
  }
  function applySlotDev(list){
    if (!Array.isArray(list)) return;
    DEV_SLOTS.forEach((sl, i) => {
      const v = list[i];
      if (!v) { slotDeviant[sl] = null; return; }
      // a preset is stored by NAME so reordering cannot shift it; a custom pair stores itself
      if (typeof v === 'object'){ slotDeviant[sl] = { name:'Custom', a:v.a, b:v.b, anim:v.anim }; return; }
      if (RB && v === RB_KEY){ slotDeviant[sl] = { name: RB.name, rainbow: true }; return; }
      const d = ctx.DEVIANTS.find(x => x[0] === v);
      slotDeviant[sl] = d ? { name:d[0], a:d[1], b:d[2], anim:d[3] } : null;
    });
  }
  // one entry per slot: a preset name, or {a,b,anim} for a custom pair
  function slotDevState(){
    return DEV_SLOTS.map(sl => {
      const d = slotDeviant[sl];
      if (!d) return null;
      return d.rainbow ? RB_KEY : d.name === 'Custom' ? { a:d.a, b:d.b, anim:d.anim } : d.name;
    });
  }
  // Which rows the open picker writes to. This used to be `pigTarget === 'all' ? SLOTS :
  // [pigTarget]`, which meant the Palico's own All row looped over the HUNTER's five slots
  // and edited the wrong figure entirely.
  function pigTargets(){
    if (pigTarget === 'all') return ctx.SLOTS;
    if (pigTarget === 'oall') return OT_PIG;
    return [pigTarget];
  }
  function pigIsOtomo(){ return pigTarget === 'oall' || OT_PIG.indexOf(pigTarget) >= 0; }
  function pigAllCb(){ return pigIsOtomo() ? otAllCb : allCb; }
  function pigAllCol(){ return pigIsOtomo() ? otAllCol : allCol; }
  function closePig(){ pigModal.classList.add('hidden'); if (charPick) endCharacter(); }
  // THE CHARACTER MODE (Raven, 2026-10-18: a palette button on each hunter colour row): the same selector, opened for a
  // hunter colour row; a pick (a swatch, the board, RGB...) goes to that row through onPick(hex), its own path (it sets
  // the row to RGB with the hex), and the armour rows are untouched. Default, Rainbow and the Deviant tab are the
  // armour's, so they are hidden here (a hunter row keeps its own Rainbow in its list).
  let charPick = null, charDefault = null;
  // Default STAYS in the character mode (Raven, 2026-10-18: the rows have no select, so Default is chosen here): the row
  // answers it (onDefault: its game colour, or the map as drawn)
  const CHAR_HIDE = ['pigRainbow', 'pigOwnTabs'];
  // THE ROW'S OWN GAME CONTROL, first in the character mode (Raven, 2026-10-18: the Skin Tone's own board "shown in the
  // modal when the palette button is pressed on Skin Tone, ahead of the Pigments grid"): opts.strip ([[r, g, b] ...], the
  // game's strip, e.g. MH3U's skin) is drawn as a band of cells titled with the row's label; a click calls
  // opts.onIndex(i), so the row returns to that strip position (not a free colour). A game's skin BOARD comes the same
  // way once read (opts.board, to build).
  let charStripWrap = null;
  function showCharStrip(label, opts){
    if (charStripWrap){ charStripWrap.remove(); charStripWrap = null; }
    const st = opts && opts.strip;
    if (!st || !st.length) return;
    charStripWrap = document.createElement('div'); charStripWrap.className = 'pig-strip';
    const n = st.length, cv = document.createElement('canvas'); cv.width = n; cv.height = 1;
    const cx = cv.getContext('2d'), img = cx.createImageData(n, 1);
    st.forEach((c, i) => { img.data.set([c[0], c[1], c[2], 255], i * 4); });
    cx.putImageData(img, 0, 0);
    cv.title = 'Click to pick a ' + label + ' from the game\'s own strip';
    cv.onclick = e => {
      const r = cv.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left) / r.width * n)));
      if (opts.onIndex) opts.onIndex(i);
      closePig();
    };
    const h = document.createElement('h3'); h.className = 'stage-h'; h.textContent = label;
    charStripWrap.appendChild(h); charStripWrap.appendChild(cv);
    const grid = document.getElementById('pigPalettes');
    grid.parentElement.insertBefore(charStripWrap, grid);
  }
  function openCharacter(label, hex, onPick, onDefault, opts){
    charPick = onPick; charDefault = onDefault || null;
    showCharStrip(label, opts);
    const dflt = document.getElementById('pigDefault'); if (dflt) dflt.hidden = !charDefault;
    document.getElementById('pigTitle').textContent = label;
    for (const id of CHAR_HIDE){ const e = document.getElementById(id); if (e) e.hidden = true; }
    if (showOwnTab) showOwnTab(0);
    const cur = String(hex || '').toLowerCase();
    for (const b of pigModal.querySelectorAll('button[data-hex]')) b.classList.toggle('sel', b.dataset.hex.toLowerCase() === cur);
    if (pigRgb && /^#[0-9a-f]{6}$/i.test(cur)) pigRgb.set(cur);
    pigModal.classList.remove('hidden');
  }
  function endCharacter(){
    charPick = null; charDefault = null;
    if (charStripWrap){ charStripWrap.remove(); charStripWrap = null; }
    const dflt = document.getElementById('pigDefault'); if (dflt) dflt.hidden = false;
    for (const id of CHAR_HIDE){ const e = document.getElementById(id); if (e) e.hidden = false; }
  }
  // a board image: 'boards/...' is the shared base's copy (docs/base/boards); any other path is the APP's own file under
  // its docs/ (each app shows only its own game, so a board may be the app's data; a leading '../' is taken the same way)
  const boardSrc = img => /^boards\//.test(img) ? 'base/' + img : img.replace(/^(\.\.\/)+/, '');
  // a board canvas draws its region once shown; a click on it is a pick of the colour under the pointer
  pigModal.addEventListener('click', e => {
    const cv = e.target.closest && e.target.closest('canvas[data-board]');
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / r.width * cv.width), y = Math.floor((e.clientY - r.top) / r.height * cv.height);
    const d = cv.getContext('2d').getImageData(Math.min(cv.width - 1, x), Math.min(cv.height - 1, y), 1, 1).data;
    commitHex('#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''));
  });
  new MutationObserver(() => {
    for (const cv of pigModal.querySelectorAll('canvas[data-board]:not([data-drawn])')){
      cv.dataset.drawn = '1';
      const img = new Image();
      img.onload = () => { const [x0, y0, x1, y1] = cv.dataset.region.split(',').map(Number);
        cv.getContext('2d').drawImage(img, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, cv.width, cv.height); };
      img.src = boardSrc(cv.dataset.board);
    }
  }).observe(pigModal, { childList: true, subtree: true });
  function openPig(id, label){
    if (charPick) endCharacter();
    pigTarget = id;
    document.getElementById('pigTitle').textContent = label;
    const cur = document.getElementById('pg_' + id).value.toLowerCase();
    const on  = document.getElementById('pgOn_' + id).checked;
    for (const b of pigModal.querySelectorAll('button[data-hex]'))
      b.classList.toggle('sel', on && b.dataset.hex.toLowerCase() === cur);
    if (pigRgb && /^#[0-9a-f]{6}$/i.test(cur)) pigRgb.set(cur);   // the RGB selection opens on the row's colour
    pigModal.classList.remove('hidden');
  }
  pigModal.querySelector('.modal-card').onclick = e => {
    const dev = e.target.closest('button[data-dev]');
    if (dev) {
      const idx = +dev.dataset.dev;
      for (const sl of pigTargets()){ setSlotDeviant(sl, idx); pigOnDef.delete(sl); }
      if (pigTarget === 'all' || pigTarget === 'oall') {
        pigAllCb().checked = false; pigAllCol().value = PIG_NONE;
      }
      readSlotPigments(); paintHexLabels(); ctx.saveState(); closePig();
      return;
    }
    if (RB && e.target.closest('button[data-rainbow]')){
      for (const sl of pigTargets()){
        if (DEV_SLOTS.indexOf(sl) < 0) continue;
        slotDeviant[sl] = { name: RB.name, rainbow: true };
        pigOnDef.delete(sl);
        document.getElementById('pgOn_' + sl).checked = true;
        document.getElementById('pg_' + sl).value = rbHex(RB.table[0]);   // rest colour until it steps
      }
      readSlotPigments(); paintHexLabels(); ctx.saveState(); closePig();
      return;
    }
    const b = e.target.closest('button[data-hex]');
    if (!b) return;
    commitHex(b.dataset.hex);
  };
  function commitHex(hex, keepOpen){
    if (charPick){ charPick(hex); if (!keepOpen) closePig(); return; }   // a hunter colour row's pick (openCharacter)
    for (const sl of pigTargets()){ slotDeviant[sl] = null; pigOnDef.delete(sl); }
    const f = document.getElementById('pgHex_' + pigTarget);
    f.value = hex;
    f.onchange();            // the one commit path -- validates, ticks the row, pushes All
    if (!keepOpen) closePig();
  }
  // Every armour has a default pigment, so Default RESTORES it rather than removing the tint: the app's adapter reads
  // the equipped piece's own colour (docs/adapter.js defaultPigHex); null = nothing to restore, and the row goes off.
  function defaultPigHex(slot){ return ctx.defaultPigHex ? ctx.defaultPigHex(slot) : null; }
  // Default on All restores each piece SEPARATELY -- it must not go through pushAll(),
  // which writes one colour into all five and would stamp All's colour over every piece.
  document.getElementById('pigDefault').onclick = () => {
    if (charPick){ if (charDefault) charDefault(); closePig(); return; }   // a hunter colour row's Default
    for (const sl of pigTargets()){
      slotDeviant[sl] = null;
      // the clothing belongs to no armor series, so it has no mSymbolCol to restore
      const hex = sl === 'cloth' ? null : defaultPigHex(sl);
      const cb = document.getElementById('pgOn_' + sl), col = document.getElementById('pg_' + sl);
      cb.checked = !!hex;
      col.value = hex || PIG_NONE;
      if (sl !== 'cloth') pigOnDef.add(sl);     // and it follows the armor from here
    }
    // the rows are now each on their own default, so All no longer speaks for them
    if (pigTarget !== 'cloth') pigAllCb().checked = false;
    if (pigTarget === 'all' || pigTarget === 'oall') pigAllCol().value = PIG_NONE;
    readSlotPigments(); paintHexLabels(); ctx.saveState();
    closePig();
  };
  // The new piece's default goes in, the same as the Default button would put there
  function followDefaultPig(sl){
    const hex = defaultPigHex(sl);
    document.getElementById('pgOn_' + sl).checked = !!hex;
    document.getElementById('pg_' + sl).value = hex || PIG_NONE;
    readSlotPigments();
  }
  document.getElementById('pigClose').onclick = closePig;
  pigModal.onclick = e => { if (e.target === pigModal) closePig(); };
  // Changing a pigment's animation rewrites the table entry and follows through to every
  // piece already wearing it, so the choice is a property of the pigment, not of the picker.
  const devAnimOverride = {};
  for (const selEl of document.querySelectorAll('select.devanim[data-dev]')){
    selEl.onchange = () => {
      const i = +selEl.dataset.dev, a = selEl.value;
      ctx.DEVIANTS[i][3] = a; devAnimOverride[ctx.DEVIANTS[i][0]] = a;
      for (const sl of DEV_SLOTS)
        if (slotDeviant[sl] && slotDeviant[sl].name === ctx.DEVIANTS[i][0]) slotDeviant[sl].anim = a;
      ctx.saveState();
    };
  }
  document.getElementById('cusApply').onclick = () => {
    const a = document.getElementById('cusA').value,
          b = document.getElementById('cusB').value,
          an = document.getElementById('cusAnim').value;
    for (const sl of pigTargets()){
      slotDeviant[sl] = { name:'Custom', a, b, anim:an };
      pigOnDef.delete(sl);
      const cb = document.getElementById('pgOn_' + sl);
      if (cb && !cb.checked) cb.checked = true;
      document.getElementById('pg_' + sl).value = a;
    }
    if (pigTarget === 'all' || pigTarget === 'oall'){
      pigAllCb().checked = false; pigAllCol().value = PIG_NONE;
    }
    readSlotPigments(); paintHexLabels(); ctx.saveState(); closePig();
  };
  function applyDevAnimOverrides(o){
    if (!o) return;
    for (const [nm, a] of Object.entries(o)){
      const i = ctx.DEVIANTS.findIndex(x => x[0] === nm);
      if (i < 0 || (a !== 'fade' && a !== 'pulse' && a !== 'fastfade')) continue;
      ctx.DEVIANTS[i][3] = a; devAnimOverride[nm] = a;
      const selEl = document.querySelector('select.devanim[data-dev="' + i + '"]');
      if (selEl) selEl.value = a;
    }
  }
  const PIG_ROW_LABEL = Object.assign(
    { all: 'All', cloth: 'Clothing Color',
      oall: 'Palico — All', ohelm: 'Palico — Head', obody: 'Palico — Chest' }, SLOT_LABEL);
  for (const id of PIG_ROWS)
    document.getElementById('pgPal_' + id).onclick = () => openPig(id, PIG_ROW_LABEL[id]);

  // ---- Deviant pigment (hidden for now, kept wired) ---------------------------
  const devOn=document.getElementById('devOn'), devBox=document.getElementById('devBox'),
        devA=document.getElementById('devA'), devB=document.getElementById('devB'),
        devAnim=document.getElementById('devAnim'), devPreset=document.getElementById('devPreset');
  devPreset.innerHTML='<option value="">Custom</option>' +
    ctx.DEVIANTS.map((d,i)=>'<option value="'+i+'">'+d[0]+'</option>').join('');
  devA.value=ctx.deviant.a; devB.value=ctx.deviant.b;
  function paintDeviant(){
    devBox.hidden = !devOn.checked;
    ctx.deviant.on = devOn.checked;
    ctx.deviant.a = devA.value; ctx.deviant.b = devB.value; ctx.deviant.anim = devAnim.value;
    if (!ctx.deviant.on) { tint.pigment = null; armorMats.forEach(applyTint); }
  }
  devOn.onchange = () => { paintDeviant(); ctx.saveState(); };
  devAnim.onchange = () => { paintDeviant(); ctx.saveState(); };
  devPreset.onchange = () => {
    const d = ctx.DEVIANTS[+devPreset.value];
    if (d) { devA.value=d[1]; devB.value=d[2]; }
    paintDeviant(); ctx.saveState();
  };
  for (const el of [devA,devB]){
    el.oninput = () => { devPreset.value=''; paintDeviant(); };
    el.onchange = ctx.saveState;
  }
  // stepped from the render loop; mixes A->B by the chosen animation and drives the
  // existing pigment path, so it lands on exactly the _sym_ region like any other colour
  // Per slot, because a Deviant pigment is assigned per armour piece. Overwrites that slot's
  // entry in slotPigment each frame; readSlotPigments sets the resting colour, this animates
  // it. A slot whose row is unticked is skipped, so unticking stops the animation too.

  function stepDeviant(t){
    if (ctx.stepRegion) ctx.stepRegion(t);    // the app's own region animation (GU: the Esurient fade)
    let any = false;
    for (const sl of DEV_SLOTS){
      const d = slotDeviant[sl];
      if (!d) continue;
      const cb = document.getElementById('pgOn_' + sl);
      if (cb && !cb.checked) continue;
      if (d.rainbow){ if (RB){ ctx.slotPigment[sl] = rainbowAt(t); any = true; } continue; }
      // the blend in the game's bytes, as the slot pigments are held (setChannelColor decodes them)
      const pa = ctx.rgb255(d.a) || [0, 0, 0], pb = ctx.rgb255(d.b) || [0, 0, 0], k = ctx.deviantMix(t, d.anim);
      ctx.slotPigment[sl] = [pa[0] + (pb[0] - pa[0]) * k, pa[1] + (pb[1] - pa[1]) * k, pa[2] + (pb[2] - pa[2]) * k];
      any = true;
    }
    if (any) armorMats.forEach(applyTint);
  }

  return {
    paintDyeable, openCharacter,
    pigmentCounts: () => ({ before: pigBefore, shown: document.querySelectorAll('#pigPalettes button[data-hex]').length }),
    DEV_SLOTS, OT_PIG, PIG_NONE, applyDevAnimOverrides, applyPigDef, applySlotDev, devA, devAnim,
    devAnimOverride, devB, devOn, devPreset, followDefaultPig, paintDeviant, paintHexLabels, pigDefState,
    pigOnDef, readSlotPigments, slotDevState, slotDeviant, stepDeviant
  };
}
