// THE HUNTER TAB of the shared viewer base (docs/base/ui; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md). Raven,
// 2026-10-18: "now we need to ensure the Hunter tabs are more consistent" -- the shared base builds the tab, every app
// the same: Hunter Slots, Armor Pieces, Pigment, Weapon and Hunter, in that order, named and laid out as the GU Armor
// Viewer's ("Follow the GU app whenever possible"). What a game has comes from its game.js:
//   weaponRows  the Weapon panel's class rows (see base/ui/weapon-panel.js, which shows them per class)
//   hunterRows  the Hunter panel's rows in panel order, each
//     { kind: 'select', input, label?, title?, options?: [[value, label] ...] }   a select (no label: a bare one)
//     { kind: 'check', input, label, checked?, hidden?, always? }               a checkbox (hidden: not shown;
//                                                                                 always: held on -- base/ui/hunter-panel.js)
//     { kind: 'colour', input, label, title? }                                   a colour row (base/ui/colour-rows.js:
//                                                                                 the select and its RGB picker)
//     { kind: 'box', id }                                                        an empty container the app fills
//     { kind: 'strip', input, label, min, max, step?, default?, chip? }          a range over the game's own colour
//                                                                                 strip (3U's Skin Tone: the value is an
//                                                                                 index, the colour that texel); chip:
//                                                                                 the id of the swatch beside it; rgb:
//                                                                                 true adds an RGB... picker (any colour,
//                                                                                 where the game's save holds RGB). The
//                                                                                 strip is painted by base/ui/hunter-
//                                                                                 panel.js from the app (ctx.strip)
//   hunterNewTitle  the Hunter Slots New button's tooltip (what New makes in this game)
//   weaponHint      the Weapon panel's closing note (GU: the effects and animations; none: no note)
// A CLASSIC script, run after docs/game.js and BEFORE base/ui/shell.js, which wires the panels' accordion: it replaces
// <div id="hunterTab"></div> with the panels, so every id exists before any script looks it up. What each control does
// is the app's, wired by id. The app keeps its own panels after these (GU: Guild Info, then the shared Animation,
// Lighting, Camera and Effects).
(function () {
  var G = window.VIEWER_GAME || {};
  var host = document.getElementById('hunterTab');
  if (!host) return;
  var esc = function (t) {
    return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  };
  var title = function (t) { return t ? ' title="' + esc(t) + '"' : ''; };
  var options = function (o) {
    return (o || []).map(function (p) { return '<option value="' + esc(p[0]) + '">' + esc(p[1]) + '</option>'; }).join('');
  };

  var slots =
    '<section class="panel" id="huntersPanel" data-open="false">' +
    '<button class="panel-head">Hunter Slots <span class="chev">&#9662;</span></button>' +
    '<div class="panel-body">' +
    '<ol id="hunterList" class="chain hunters"></ol>' +
    '<div class="row">' +
    '<button id="hunterNew" class="btn tiny"' + title(G.hunterNewTitle) + '>New</button>' +
    '<button id="hunterCopy" class="btn tiny" title="A new hunter, a copy of this one">Copy</button>' +
    '<button id="hunterRename" class="btn tiny" title="Rename this hunter">Rename</button>' +
    '<button id="hunterDelete" class="btn tiny" title="Delete this hunter">Delete</button>' +
    '</div></div></section>';

  var armor =
    '<section class="panel" data-open="true">' +
    '<button class="panel-head">Armor Pieces <span class="chev">&#9662;</span></button>' +
    '<div class="panel-body">' +
    '<div class="field"><label for="htype">Type</label><select id="htype">' +
    '<option value="all">Both</option><option value="b">Blademaster</option><option value="g">Gunner</option></select></div>' +
    '<div class="field"><input type="text" id="filter" placeholder="filter by name&hellip;"></div>' +
    [['helm', 'Head'], ['body', 'Chest'], ['arm', 'Arms'], ['wst', 'Waist'], ['leg', 'Legs']].map(function (s) {
      return '<div class="field"><label for="s_' + s[0] + '">' + s[1] + '</label><select id="s_' + s[0] + '" data-slot="' +
        s[0] + '"></select></div>';
    }).join('') +
    '</div></section>';

  // the pigment rows are base/ui/pigment.js's (#slotPig); the hidden parts are the old single Deviant pigment and the
  // first palette, which that module still keeps for old saves. The panel itself is BUILT HIDDEN: pigment.js moves every
  // row under its piece (Raven, 2026-10-19: "they briefly show Pigment panel still then hide it" -- it was hidden only
  // once the module ran, after the first paint)
  var pigment =
    '<span id="pigmentPanel" hidden><section class="panel" data-open="false">' +
    '<button class="panel-head">Pigment <span class="chev">&#9662;</span></button>' +
    '<div class="panel-body">' +
    '<label class="chk" style="display:none"><input type="checkbox" id="defpig">Use in-game default</label>' +
    '<p class="hint" id="pigNote"></p>' +
    '<label class="chk"><input type="checkbox" id="maskdbg">Dye mask</label>' +
    '<div id="slotPig"></div>' +
    '<span id="legacyPig" hidden><div id="pig"></div></span>' +
    '<span id="devLegacy" hidden>' +
    '<label class="chk"><input type="checkbox" id="devOn">Deviant pigment</label>' +
    '<span id="devBox" hidden>' +
    '<div class="field"><label for="devPreset">Preset</label><select id="devPreset"></select></div>' +
    '<div class="field"><label>Colors</label><div class="row gap">' +
    '<input type="color" id="devA" class="rgb-input" title="Colour A">' +
    '<input type="color" id="devB" class="rgb-input" title="Colour B"></div></div>' +
    '<div class="field"><label for="devAnim">Animation</label><select id="devAnim">' +
    '<option value="fade">Fade A &harr; B</option><option value="fastfade">Fast Fade A &harr; B</option>' +
    '<option value="pulse">Pulse to B</option></select></div>' +
    '</span></span>' +
    '</div></section></span>';

  // the Weapon panel: Class, Weapon, Carry, Stance and the Attachment / Form row in every app, then the class rows
  var weaponRow = function (r) {
    if (r.kind === 'box') return '<div id="' + r.field + '" class="' + (r.cls || '') + '"></div>';
    if (r.kind === 'check')
      return '<label class="chk" id="' + r.field + '" style="display:none"><input type="checkbox" id="' + r.input + '"' +
        title(r.title) + '>' + esc(r.label) + '</label>';
    return '<div class="field" id="' + r.field + '" style="display:none"><label for="' + r.input + '">' + esc(r.label) +
      '</label><select id="' + r.input + '"' + title(r.title) + '>' + options(r.options) + '</select>' + (r.after || '') + '</div>';
  };
  var weapon =
    '<section class="panel" id="weaponPanel" data-open="false">' +
    '<button class="panel-head">Weapon <span class="chev">&#9662;</span></button>' +
    '<div class="panel-body">' +
    '<div class="field"><label for="weaponClass">Class</label><select id="weaponClass"></select></div>' +
    '<div class="field"><label for="weaponModel">Weapon</label><select id="weaponModel"></select></div>' +
    '<div class="field"><label for="weaponDrawn">Carry</label><select id="weaponDrawn"><option value="1">Drawn</option>' +
    '<option value="0">Sheathed</option></select></div>' +
    '<div class="field"><label for="weaponPose">Stance</label><select id="weaponPose"></select></div>' +
    '<div class="field" id="weaponFormField" style="display:none"><label for="weaponForm">Form</label><select id="weaponForm"></select></div>' +
    (G.weaponRows || []).map(weaponRow).join('') +
    (G.weaponHint ? '<p class="hint">' + esc(G.weaponHint) + '</p>' : '') +
    '</div></section>';

  // the palette button of a hunter colour row (Raven, 2026-10-18): the shared pigment selector, every in-game colour, for
  // this row (base/ui/colour-rows.js / hunter-panel.js wire it)
  var palBtn = function (r) {
    return '<button type="button" class="palbtn" id="' + r.input + 'Pal" title="Pigments" aria-label="Pigments for ' +
      esc(r.label || '') + '">&#9638;</button>';
  };
  var hunterRow = function (r) {
    if (r.kind === 'box') return '<div id="' + r.id + '"></div>';
    if (r.kind === 'check')
      return '<label class="chk"' + (r.hidden ? ' hidden' : '') + '><input type="checkbox" id="' + r.input + '"' +
        (r.checked ? ' checked' : '') + '>' + esc(r.label) + '</label>';
    var lab = r.label ? '<label for="' + r.input + '">' + esc(r.label) + '</label>' : '';
    if (r.kind === 'strip')
      return '<div class="field">' + lab + '<div class="row gap"><input type="range" class="strip" id="' + r.input +
        '" min="' + (r.min || 0) + '" max="' + r.max + '" step="' + (r.step || 1) + '"' +
        (r['default'] != null ? ' value="' + r['default'] + '"' : '') + title(r.title) + '>' +
        (r.chip ? '<span class="chip" id="' + r.chip + '"></span>' : '') +
        '<input type="text" class="hexbtn colourfield" id="' + r.input + 'Hex" maxlength="7" spellcheck="false" ' +
        'autocomplete="off" title="Type or paste a hex value; click to select and copy">' +
        (r.rgb ? palBtn(r) : '') +
        '</div></div>';
    if (r.kind === 'colour')
      return '<div class="field">' + lab + '<div class="row gap"><select id="' + r.input + '"' + title(r.title) + ' hidden></select>' +
        '<input type="color" id="' + r.input + 'RGB" class="rgb-input" title="Pick a color" hidden>' +
        '<input type="text" class="hexbtn colourfield" id="' + r.input + 'Hex" maxlength="7" spellcheck="false" ' +
        'autocomplete="off" title="Type or paste a hex value; click to select and copy">' + palBtn(r) + '</div></div>';
    return '<div class="field">' + lab + '<select id="' + r.input + '"' + title(r.title) + '>' + options(r.options) + '</select></div>';
  };
  var hunter =
    '<section class="panel" data-open="false">' +
    '<button class="panel-head">Hunter <span class="chev">&#9662;</span></button>' +
    '<div class="panel-body">' + (G.hunterRows || []).map(hunterRow).join('') + '</div></section>';

  // GUILD INFO (game.guildInfo; base/ui/guild-panel.js runs it): the name plate over the hunter -- its name and the
  // Hunter Rank band that colours it -- in a game whose bands are read (guildInfo.hrBands), and, in a game with Guild Card
  // titles (guildInfo.titles), the title words and the Unlock Requirements modal (appended to the page); Shows (what the
  // plate reads) needs both. A game with titles and no bands yet (MH3U, Phase 1.3) gets the titles alone: never a
  // stand-in colour, font or glyph.
  // a tag (guildInfo.tag: one colour, no rank bands; MH3U) is a plate too, without the Hunter Rank row
  var GI = G.guildInfo, titled = !!(GI && GI.titles), ranked = !!(GI && GI.hrBands && GI.hrBands.length),
      plated = ranked || !!(GI && GI.tag);
  var guild = !GI ? '' :
    '<section class="panel" id="platePanel" data-open="false">' +
    '<button class="panel-head">Guild Info <span class="chev">&#9662;</span></button>' +
    '<div class="panel-body">' +
    (!plated ? '' :
    '<label class="chk"><input type="checkbox" id="plateOn">Show the name plate</label>' +
    '<div class="field"><label for="plateName">Name</label><input id="plateName" type="text" maxlength="24" ' +
    'placeholder="this slot\'s name" title="The name on the plate. Empty uses the slot\'s name from the Hunters list, so ' +
    'several slots can share one hunter"></div>' +
    (!ranked ? '' : '<div class="field"><label for="plateHr">Hunter Rank</label><select id="plateHr" title="The rank ' +
    'band sets the plate\'s colour, as the game does"></select></div>')) +
    (!titled ? '' :
      (!plated ? '' : '<div class="field"><label for="plateShow">Shows</label><select id="plateShow" title="What the plate reads: the ' +
      'name, the guild card title alone (only the icon until words are chosen), or the name with the title under it in ' +
      'brackets"><option value="name">Name</option><option value="title">Guild card title</option>' +
      '<option value="both">Name and title</option></select></div>') +
      '<div class="field"><label for="plateT1">Title #1</label><select id="plateT1" title="The first word of the guild ' +
      'card title"><option>(None)</option></select></div>' +
      '<div class="field"><label for="plateT2">Joined by</label><select id="plateT2" title="The connector between the ' +
      'two words"><option>(None)</option></select></div>' +
      '<div class="field"><label for="plateT3">Title #2</label><select id="plateT3" title="The second word of the guild ' +
      'card title"><option>(None)</option></select></div>' +
      '<button id="plateUnlocks" class="btn block" title="Every title word in the Guild Card\'s order, with what ' +
      'unlocks it">Unlock Requirements</button>') +
    '</div></section>';
  if (titled){
    var modal = document.createElement('div');
    modal.id = 'titleModal'; modal.className = 'modal hidden';
    modal.innerHTML =
      '<div class="modal-card">' +
      '<h2>Guild Card Titles</h2>' +
      '<div class="row gap"><input id="titleFilter" type="search" placeholder="Filter by word or requirement" ' +
      'autocomplete="off"><span class="pager"><button id="titlePagePrev" class="btn tiny" title="Previous page" ' +
      'aria-label="Previous page">&lt;</button><input id="titlePage" type="number" min="1" placeholder="Page" ' +
      'title="Jump to a page of the in-game menu" aria-label="Page"><button id="titlePageNext" class="btn tiny" ' +
      'title="Next page" aria-label="Next page">&gt;</button></span><span id="titleCount" class="muted"></span></div>' +
      '<p class="hint" id="titlePageNote">Page numbers assume you have every title unlocked.<br><br>The requirements are ' +
      'listed.<br><br>Hopefully this helps you find the titles in-game</p>' +
      '<div id="titleList"></div>' +
      '<div class="row end gap"><button id="titleClose" class="btn">Close</button></div>' +
      '</div>';
    var before = document.getElementById('themeModal');
    if (before) before.parentNode.insertBefore(modal, before); else document.body.appendChild(modal);
  }

  host.outerHTML = slots + armor + pigment + weapon + hunter + guild;
})();
