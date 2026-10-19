// GUILD INFO of the shared viewer base (docs/base/ui; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md; Raven, 2026-10-18:
// "We also have Guild Info" / "Which will need to look into each game's guild card titles, the colors for HR ranges"):
// the name plate's state, the Guild Info panel (built by base/ui/hunter-tab.js) and the Unlock Requirements modal. Moved
// from GU's index.html (2026-10-18). The game's data is game.guildInfo: hrBands, titles (the title words file, or null),
// titlePage (the title menu's entries to a page), icons / iconCell / iconCells (the weapon glyph strip) and font;
// base/render/plate.js draws the plate.
import * as THREE from 'three';
import { createPlate, hrColor } from '../render/plate.js';
export function createGuildPanel(game, ctx){
  // ---- The name plate (Raven, 2026-09-05: "we have our name along with a weapon icon float above
  // our hunters, this can be toggled to show our guild card names ... an HR Drop Down for the
  // different ranges (i.e. colors). A drop down for the first title, then a 2nd for the in-between
  // char values and 3rd for the second title. Once populated, display the nameplate over the
  // hunters head"). base/render/plate.js draws it; this block owns the state, the panel and where
  // it rides. The rank bands, the title words (GU: its own pools, GC_Title_1 and GC_Title_2), the
  // title menu's page size, the weapon glyphs and the font are the game's (game.guildInfo). The
  // state saves with the session, the set file and every hunter slot; a file or a slot without a
  // block keeps what is on screen, as lighting and effects do. ----
  const GI = game.guildInfo || {};
  const BANDS = GI.hrBands || [];
  // A TAG WITHOUT RANK BANDS (game.guildInfo.tag = { colour, font, icons, iconCell, iconCells }; Raven, 2026-10-19, for
  // MH3U: "there is a name tag with weapon icon. However, the colors were white. For now, assume not rank color"): the
  // plate in that one colour -- the weapon glyph, then the name -- with Name and Shows, and no Hunter Rank row
  const TAG = GI.tag || null;
  const RANKED = BANDS.length > 0;
  const TITLED = !!GI.titles;                // a game without Guild Card titles has no title rows or modal
  // a game whose rank bands are not read has no plate: no stand-in colour, font or glyph (MH3U, Phase 1.3: the titles
  // alone); its title words still save and restore with the rest of the plate state
  const PLATED = RANKED || !!TAG;
  const pick = k => (TAG && TAG[k] !== undefined) ? TAG[k] : GI[k];
  const plate = PLATED ? createPlate({ iconUrl: pick('icons'), iconCell: pick('iconCell'), font: pick('font') }) : null;
  if (plate) ctx.scene.add(plate.sprite);
  const PLATE_UP = 0.32;             // metres above the head joint (the joint sits at the skull's base)
  const PLATE_NONE = '(None)';
  const PLATE_SHOWS = ['name', 'title', 'both'];
  // weapon folder -> the glyph's cell in the game's icon strip (game.guildInfo.iconCells)
  const PLATE_ICON = pick('iconCells') || {};
  let plateState = { on: false, show: 'name', name: '', hr: 1, title: [PLATE_NONE, PLATE_NONE, PLATE_NONE] };
  let plateWords = { words: [PLATE_NONE], joins: [PLATE_NONE] };
  let plateTitleRows = { words: [], joins: [], note: '' };   // {w, req, id} per word, the table's order
  // the title menu's entries to a page (game.guildInfo.titlePage; GU: a 4 x 2 grid, eight, Raven 2026-09-09)
  const PAGE_ROWS = GI.titlePage || 8;
  function plateTitle(){ return plateState.title.filter(w => w && w !== PLATE_NONE).join(' '); }
  // the plate's own name (Raven, 2026-09-05: several slots may hold one hunter), else the slot's, live
  function plateName(){ return plateState.name || (ctx.HUNTERS[ctx.hunterIndex] ? ctx.HUNTERS[ctx.hunterIndex].name : 'Hunter'); }
  function platePaint(){
    // Title alone shows the title and nothing else (just the icon until words are chosen), so
    // the switch is always visible (Raven, 2026-09-05: "Shows does not seem to switch between
    // Name, Title or Both successfully" -- it fell back to the name while the title was empty)
    if (!plate) return;
    const t = plateTitle();
    const line1 = plateState.show === 'title' ? t : plateName();
    const line2 = plateState.show === 'both' && t ? '(' + t + ')' : '';
    const icon = PLATE_ICON[ctx.weaponClassSel.value];
    plate.paint({ line1, line2, color: RANKED ? hrColor(BANDS, plateState.hr) : TAG.colour, icon: icon === undefined ? -1 : icon });
  }
  const _plateAnchor = new THREE.Vector3(), _plateSize = new THREE.Vector2();
  function plateUpdate(cam){
    if (!plate) return;
    const on = plateState.on && ctx.figure !== 'palico';
    plate.setVisible(on);
    if (!on) return;
    platePaint();                                   // repaints only when something changed
    const b = ctx.playerBone(ctx.activeMounts(), 4);        // the head joint, live under the pose
    if (b){ b.getWorldPosition(_plateAnchor); _plateAnchor.y += PLATE_UP; }
    else { ctx.figureCenter(_plateAnchor); _plateAnchor.y += 1.0; }
    plate.sprite.position.copy(_plateAnchor);
    plate.update(cam, ctx.renderer.getSize(_plateSize).y);
  }
  function plateFileState(){
    return { on: plateState.on, show: plateState.show, name: plateState.name, hr: plateState.hr, title: plateState.title.slice() };
  }
  function restorePlate(p){
    if (!p || typeof p !== 'object') return;
    const t = Array.isArray(p.title) ? p.title : [];
    const word = v => (typeof v === 'string' && v.trim()) ? v.trim().slice(0, 40) : PLATE_NONE;
    plateState = {
      on: p.on === true,
      show: PLATE_SHOWS.includes(p.show) ? p.show : 'name',
      name: typeof p.name === 'string' ? p.name.trim().slice(0, 24) : '',
      hr: Number.isFinite(+p.hr) ? Math.max(0, Math.min(999, Math.round(+p.hr))) : 1,
      title: [word(t[0]), word(t[1]), word(t[2])]
    };
    paintPlate();
  }
  // A slot or a file WITHOUT a plate block shows no plate: the plate is the hunter's own (name,
  // rank, title), not a view setting, so nothing carries over from the hunter before (Raven,
  // 2026-09-05: "Ensure nameplate settings persist between slots" -- a slot banked before the
  // plate existed kept showing the previous hunter's).
  function applyPlateFile(p){ restorePlate(p && typeof p === 'object' ? p : { on: false }); }
  function fillPlateWords(){
    const fill = (id, list) => {
      const sel = document.getElementById(id); sel.textContent = '';
      for (const w of list){ const o = document.createElement('option'); o.value = w; o.textContent = w; sel.appendChild(o); }
    };
    fill('plateT1', plateWords.words); fill('plateT3', plateWords.words); fill('plateT2', plateWords.joins);
  }
  function paintPlate(){
    const g = id => document.getElementById(id);
    if (PLATED){
      g('plateOn').checked = plateState.on;
      if (document.activeElement !== g('plateName')) g('plateName').value = plateState.name;
      g('plateName').placeholder = ctx.HUNTERS[ctx.hunterIndex] ? ctx.HUNTERS[ctx.hunterIndex].name : "this slot's name";
      if (RANKED){
        const band = BANDS.find(b => plateState.hr <= b.max) || BANDS[BANDS.length - 1];
        g('plateHr').value = String(band.hr);
      }
    }
    if (!TITLED) return;
    if (PLATED) g('plateShow').value = plateState.show;
    ['plateT1', 'plateT2', 'plateT3'].forEach((id, i) => {
      const sel = g(id), w = plateState.title[i];
      sel.value = w; if (sel.value !== w) sel.value = PLATE_NONE;   // a word the list lacks shows as (None), the plate still says it
    });
  }
  function plateEdit(){
    const g = id => document.getElementById(id);
    if (PLATED){
      plateState.on = g('plateOn').checked;
      plateState.name = g('plateName').value.trim().slice(0, 24);
      if (RANKED) plateState.hr = +g('plateHr').value || 1;
    }
    if (TITLED){
      if (PLATED) plateState.show = PLATE_SHOWS.includes(g('plateShow').value) ? g('plateShow').value : 'name';
      plateState.title = ['plateT1', 'plateT2', 'plateT3'].map(id => g(id).value || PLATE_NONE);
    }
    paintPlate(); platePaint(); ctx.saveState();
  }
  if (RANKED) document.getElementById('plateHr').innerHTML = BANDS.map(b => '<option value="' + b.hr + '">' + b.label + '</option>').join('');
  for (const id of (PLATED ? ['plateOn'].concat(RANKED ? ['plateHr'] : []) : []).concat(TITLED ? (PLATED ? ['plateShow'] : []).concat(['plateT1', 'plateT2', 'plateT3']) : []))
    document.getElementById(id).onchange = plateEdit;
  if (PLATED){ const n = document.getElementById('plateName'); n.oninput = () => { plateState.name = n.value.trim().slice(0, 24); platePaint(); }; n.onchange = plateEdit; }
  if (TITLED) fetch(GI.titles).then(r => r.json()).then(j => {
    // TWO ORDERS, one per place they are read, because the two asks are different (Raven,
    // 2026-09-05: "List the Titles in the drop downs in alphabetical order"; 2026-09-06, of the
    // Unlock Requirements modal: "this list should use the In Game order as they appear in the
    // Guild Card"). plateTitleRows keeps the game's table order and the modal reads it; the
    // dropdowns sort a copy alphabetically, (None) first. Reading the second ask as covering the
    // dropdowns too undid the first one, which is what Raven caught on 2026-09-08: "the Nameplate
    // titles are not in alphabetical order".
    // Each word carries the unlock text the game shows for it (build-guild-card-titles.py).
    // `hidden` names table slots shown to be absent from the GAME rather than from a save. It is
    // empty: the menu hides titles the save has not unlocked (confirmed), which accounts for at
    // least one of the seven slots Raven's card differs by, and whether any of the rest are
    // missing from the release itself is not established.
    const gone = new Set(Array.isArray(j.hidden) ? j.hidden : []);
    const rows = list => (list || []).map(x => typeof x === 'string' ? { w: x } : x)
      .filter(x => x && typeof x.w === 'string' && x.w !== PLATE_NONE && x.w !== 'Reserve cell' && !gone.has(x.id));
    plateTitleRows = { words: rows(j.words), joins: rows(j.joins), note: typeof j.note === 'string' ? j.note : '',
                       noneReq: typeof j.noneReq === 'string' ? j.noneReq : '' };
    const az = list => [PLATE_NONE].concat(list.map(x => x.w)
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true })));
    plateWords = { words: az(plateTitleRows.words), joins: az(plateTitleRows.joins) };
    fillPlateWords(); paintPlate();
  }).catch(e => console.warn('name plate: the title words did not load', e));
  // The Unlock Requirements modal (Raven, 2026-09-06: "can we have a modal that list the unlock
  // requirement?"): every title word in the Guild Card's order with its unlock text, the
  // connectors after it; the words on the plate are marked; the filter matches words and texts.
  const titleModal = document.getElementById('titleModal');
  function paintTitleModal(){
    const list = document.getElementById('titleList'), q = document.getElementById('titleFilter').value.trim().toLowerCase();
    const chosen = new Set(plateState.title.filter(w => w && w !== PLATE_NONE));
    const frag = document.createDocumentFragment();
    let shown = 0;
    const heading = t => { const h = document.createElement('div'); h.className = 'title-h'; h.textContent = t; frag.appendChild(h); };
    const divider = (t, which, n) => {
      const h = document.createElement('div'); h.className = 'title-pg'; h.textContent = t;
      h.dataset.list = which; h.dataset.page = n; frag.appendChild(h);
    };
    // The page a word sits on in the game's own menu (Raven, 2026-09-09: "In Game, the menu is
    // broken up into pages, with eight entries per page ... I want to be able to tell the user
    // what page a title is on", and on the shape of it: "157 Pages, 4 rows, 2 columns"). The
    // order here is the table's, which is the order the menu walks, so the page is just the
    // entry's place in it. Each list is numbered from its own page 1, since the connectors are
    // their own menu. A divider heads each page while the list is whole; filtered, the rows
    // carry their page instead, which is the whole point of being able to search it.
    const rows = (list, req, which) => {
      let page = 0;
      // Every pool opens with (None), which the game's menu shows as slot 1 (Raven, 2026-09-09:
      // "(None) should be the first slot in the Modal ... It doesn't need to be an option.
      // However, it should be displayed in the modal to ensure we display the correct pages").
      // It is a row here and nothing else: the dropdowns supply their own (None) for clearing a
      // word, and this one is never selectable. Counting it is the point -- leave it out and
      // every page number after slot 8 is one too high.
      const slots = [{ w: PLATE_NONE, req: plateTitleRows.noneReq, none: true }].concat(list);
      slots.forEach((x, i) => {
        const p = Math.floor(i / PAGE_ROWS) + 1;
        const text = x.none ? x.req : (req === undefined ? x.req : req);
        if (q && !(x.w.toLowerCase().includes(q) || (text || '').toLowerCase().includes(q))) return;
        if (!q && p !== page){ divider('Page ' + p, which, p); page = p; }
        const on = !x.none && chosen.has(x.w);
        const a = document.createElement('div'), n = document.createElement('div'), b = document.createElement('div');
        a.className = 'title-w' + (on ? ' sel' : '') + (x.none ? ' title-none' : '');
        n.className = 'title-p'; b.className = 'title-r' + (on ? ' sel' : '');
        a.textContent = x.w; n.textContent = 'p. ' + p; b.textContent = text || '';
        frag.appendChild(a); frag.appendChild(n); frag.appendChild(b); shown++;
      });
    };
    heading('Titles'); rows(plateTitleRows.words, undefined, 'words');
    heading('Connectors'); rows(plateTitleRows.joins, plateTitleRows.note, 'joins');
    list.textContent = ''; list.appendChild(frag);
    // + 2 for the (None) slot each pool opens with, which is a row here like any other
    document.getElementById('titleCount').textContent = shown + ' of ' + (plateTitleRows.words.length + plateTitleRows.joins.length + 2);
  }
  function openTitleModal(){ document.getElementById('titleFilter').value = ''; paintTitleModal(); titleModal.classList.remove('hidden'); document.getElementById('titleFilter').focus(); }
  function closeTitleModal(){ titleModal.classList.add('hidden'); }
  // Jump to a page of the titles list. There is no in-game list to diff against here, so
  // finding which slots MHGU leaves out is a matter of walking the two side by side (Raven,
  // 2026-09-09: "I need to find where the pages line up still until they stop", "You also don't
  // have the in game list to compare"); scrolling 1,376 rows by hand to reach page 94 is what
  // this avoids. Clearing the filter first, since the dividers only exist on the whole list.
  function titlePageMax(){ return Math.max(1, Math.ceil((plateTitleRows.words.length + 1) / PAGE_ROWS)); }
  function goTitlePage(n){
    const box = document.getElementById('titlePage'), list = document.getElementById('titleList');
    const p = Math.min(titlePageMax(), Math.max(1, n | 0));
    const prev = document.getElementById('titlePagePrev'), next = document.getElementById('titlePageNext');
    prev.disabled = p <= 1; next.disabled = p >= titlePageMax();
    const f = document.getElementById('titleFilter');
    if (f.value){ f.value = ''; paintTitleModal(); }
    box.value = String(p);
    list.querySelectorAll('.title-pg.hit').forEach(h => h.classList.remove('hit'));
    const hit = list.querySelector('.title-pg[data-list="words"][data-page="' + p + '"]');
    if (hit){ hit.classList.add('hit'); hit.scrollIntoView({ block: 'start' }); }
  }
  if (TITLED){
    document.getElementById('plateUnlocks').onclick = openTitleModal;
    document.getElementById('titleClose').onclick = closeTitleModal;
    document.getElementById('titleFilter').oninput = paintTitleModal;
    {
      const box = document.getElementById('titlePage');
      const cur = () => parseInt(box.value, 10) || 1;
      box.oninput = () => { const n = parseInt(box.value, 10); if (n) goTitlePage(n); };
      document.getElementById('titlePagePrev').onclick = () => goTitlePage(cur() - 1);
      document.getElementById('titlePageNext').onclick = () => goTitlePage(cur() + 1);
    }
    titleModal.onclick = e => { if (e.target === titleModal) closeTitleModal(); };
  }

  return {
    _plateAnchor, applyPlateFile, paintPlate, plate, plateFileState, plateName, platePaint, plateTitle,
    plateUpdate, restorePlate,
    get plateWords(){ return plateWords; }
  };
}
