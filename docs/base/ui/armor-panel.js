// THE ARMOR PIECES PANEL of the shared viewer base (docs/base/ui; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md;
// Raven, 2026-10-18: "each app has the same UI for things like pigments, armor selection, player model customizations"):
// the Type filter (a VIEW over the lists), the name filter, the five slot selects grouped as the game lists them, the
// Settings -> Equipment preference (the Head list as Both), and the tokens a save holds. Moved from GU's index.html
// (2026-10-18). WHAT a slot lists is the game's: ctx.armorOptions(slot, type) answers [{ value, label, model, group }]
// in the game's own order, ctx.armorSpecials(slot) the entries above them (GU: Chakra), ctx.legacyModel(slot, v) a
// model id for an old save's token; ctx.onPieceChange(slot) is the app's mount.

export function createArmorPanel(game, ctx){
  // select values are tokens now (s<series> / u<model>) because two Smithy rows can share a
  // model -- a bare id could not tell Jaggi Helm from Jaggi Helm S on reload
  // restored before the lists are first built, so a saved choice is reflected from the start
  let hunterType = (ctx.SAVED && (ctx.SAVED.hunterType === 'b' || ctx.SAVED.hunterType === 'g'))
                 ? ctx.SAVED.hunterType : 'all';
  // SETTINGS -> EQUIPMENT (Raven, 2026-09-30: "Users want to be able to combine Blademaster (Helm) and Gunner (Caps) in the
  // armor drop down even when Blademaster or Gunner are selected", "This basically uses Both behavior for either filter"):
  // with the toggle on, the Head list ignores the Type filter -- Both's list -- so a Blademaster helm and a Gunner cap are
  // both offered whichever type is picked; the other slots keep the filter. A view preference, app chrome like the capture
  // settings: its own localStorage key, not part of a saved set or a hunter slot. Read here, before the lists are built.
  const EQUIP_KEY = game.storagePrefix + '-equipment';
  const equipPrefs = { headBoth: false };
  try { Object.assign(equipPrefs, JSON.parse(localStorage.getItem(EQUIP_KEY) || '{}')); } catch (_) {}
  equipPrefs.headBoth = equipPrefs.headBoth === true;
  // the type a slot's list is filtered by
  function typeFor(slot){ return (slot === 'helm' && equipPrefs.headBoth) ? 'all' : hunterType; }
  const OPT_CACHE = {};
  // the game's list for a slot and a type (ctx.armorOptions: [{ value, label, model, group }] in the game's own order)
  function optionsCached(slot, type = typeFor(slot)){
    const k = ctx.gender + type + slot;
    return OPT_CACHE[k] || (OPT_CACHE[k] = ctx.armorOptions(slot, type));
  }
  // the type filter is a VIEW, so resolution always runs against the unfiltered list --
  // otherwise picking Gunner would unequip the Blademaster armour already being worn
  function optionsAll(slot){ return optionsCached(slot, 'all'); }
  // the entries above a slot's list, after "- none -" (ctx.armorSpecials: [{ value, label }]; GU: Chakra, which has no
  // mesh of its own -- the clothing renders in its place)
  const specials = slot => (ctx.armorSpecials ? ctx.armorSpecials(slot) : []);
  const isSpecial = (slot, v) => specials(slot).some(x => x.value === v);
  function modelOf(slot, v){
    if (!v || v === 'none' || isSpecial(slot, v)) return null;   // a special (GU's Chakra) has no mesh of its own
    const o = optionsAll(slot).find(x => x.value === v);
    if (o) return o.model;
    // legacy saves held a bare model id: the app's adapter says whether it is a piece (ctx.legacyModel)
    return (!/^[su]/.test(v) && ctx.legacyModel) ? ctx.legacyModel(slot, v) : null;
  }
  // Resolve whatever a save happens to hold to a token in the CURRENT list. Three shapes
  // have existed: a bare model id (pre-Smithy), a 'u<model>' from a build where that model
  // was not yet in the forge list, and a live 's<series>'. Falling back to the model keeps
  // an old save from silently emptying a slot, which is what happened when the Gunner rows
  // moved 200-odd models out of Uncraftable.
  function tokenFor(slot, v){
    if (!v || v === 'none') return 'none';
    if (isSpecial(slot, v)) return v;
    const opts = optionsAll(slot);
    if (opts.some(o => o.value === v)) return v;
    // an older token: the model it meant, as the app's adapter reads it (ctx.legacyModel), then that model's entry now
    const model = ctx.legacyModel ? ctx.legacyModel(slot, v, true) : null;
    const m = model && opts.find(o => o.model === model);
    return m ? m.value : 'none';
  }
  function labelOf(slot, v){
    const sp = specials(slot).find(x => x.value === v);
    if (sp) return sp.label;
    const o = optionsAll(slot).find(x => x.value === v);
    return o ? o.label : v;
  }

  function rebuildSelects(filter){
    const f = (filter || '').trim().toLowerCase();
    for (const slot of ctx.SLOTS){
      const sel = document.querySelector('select[data-slot="' + slot + '"]');
      const cur = sel.value;
      let opts = optionsCached(slot);
      // whatever is equipped stays listed even when the type filter would hide it
      if (cur !== 'none' && !opts.some(o => o.value === cur)){
        const all = optionsAll(slot), keep = all.find(o => o.value === cur);
        // put it back where the forge list has it, so the order still reads as the game's
        if (keep){
          const at = all.indexOf(keep);
          let i = 0;
          while (i < opts.length && all.indexOf(opts[i]) < at) i++;
          opts = opts.slice(0, i).concat([keep], opts.slice(i));
        }
      }
      if (f) opts = opts.filter(o => o.label.toLowerCase().includes(f) || o.value === cur);
      // Grouped by rarity. A model is shared by its rank variants and those have DIFFERENT
      // rarities (Leather R1 / Leather S R4 / Leather X R8) -- the same reason the labels
      // collapse to "(Base/S/X)". So group by the LOWEST, the rank the label leads with.
      // The span is in the manifest as rarityMax but is deliberately NOT appended to the
      // option: these names run past 60 chars and the select ellipsises at 165px, so a
      // suffix is the first thing cut -- it would show on short names and vanish on long.
      let html = '<option value="none">— none —</option>' +
                 specials(slot).map(x => '<option value="' + x.value + '">' + x.label + '</option>').join(''), group = null;
      for (const o of opts){
        if (o.group !== group){
          if (group !== null) html += '</optgroup>';
          group = o.group;
          html += '<optgroup label="' + group + '">';
        }   // breaks on every rarity CHANGE, so the run structure survives
        html += '<option value="' + o.value + '">' + o.label + '</option>';
      }
      if (group !== null) html += '</optgroup>';
      sel.innerHTML = html;
      // Blademaster / Gunner and the name box are VIEWS over the list. Neither may change
      // what is equipped, so the selection is restored unconditionally rather than falling
      // back to 'none' when the filtered list happens not to contain it.
      //
      // That fallback silently unequipped CHAKRA on any type change: `opts` holds forge
      // rows only, so it never contains the Chakra token (nor 'none'), and the "keep what is
      // equipped" re-insert above could not find it either. The select then read "- none -",
      // and htype's handler saves immediately, so the loss was persisted -- taking the
      // clothing with it, since the clothing is what Chakra renders.
      ctx.selectToken(sel, slot, cur);
    }
  }

  for (const slot of ctx.SLOTS) {
    const sel = document.querySelector('select[data-slot="' + slot + '"]');
    // the app mounts the piece and does what follows a new piece (ctx.onPieceChange)
    sel.onchange = () => ctx.setSlot(slot, sel.value).then(() => ctx.onPieceChange(slot));
  }
  document.getElementById('filter').oninput = e => rebuildSelects(e.target.value);
  document.getElementById('htype').onchange = e => {
    hunterType = e.target.value;
    rebuildSelects(document.getElementById('filter').value);
    ctx.saveState();
  };
  // Settings -> Equipment: the Head list as Both (typeFor); a view, so what is equipped stays (rebuildSelects)
  {
    const cb = document.getElementById('setHeadBoth');
    cb.checked = equipPrefs.headBoth;
    cb.onchange = () => {
      equipPrefs.headBoth = cb.checked;
      try { localStorage.setItem(EQUIP_KEY, JSON.stringify(equipPrefs)); } catch (_) {}
      rebuildSelects(document.getElementById('filter').value);
    };
  }

  return {
    OPT_CACHE, labelOf, modelOf, rebuildSelects, tokenFor,
    get hunterType(){ return hunterType; }, set hunterType(v){ hunterType = v; }
  };
}
