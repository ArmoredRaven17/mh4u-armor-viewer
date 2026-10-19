// COLOUR ROWS for the shared viewer base (docs/base/ui; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md): one select
// per character colour (Default, the game's named colours, RGB... with a picker), the state they write (null = the
// authored colour, a number = a named colour, '#rrggbb' = a custom pick), and the one tint path that applies them to
// the face, hair, skin and the Palico. Moved verbatim from GU's index.html (2026-10-18). Raven, 2026-10-18: character
// colours are GU colour rows in the Hunter panel; a game's own options (3U's skin strip) go inside the row (to build).
// createColourRows(game, ctx): ctx.scene is walked to tint the materials.
//
// A ROW'S OWN OPTIONS (game.colourRows[part]; in GU only the skin's strip). For the MH3U / MH4U Armor
// Viewers (2026-10-18, the 4U agent's Phase 1.4 draft, through the General), each optional, the row's shape GU's:
//   board: { image, region, label? }  the game's colour board (an image under base/; the region INCLUSIVE, x1 / y1 the
//                                     last board column / row, as the 3U / 4U viewers read theirs): an
//                                     extra choice (label: 'Custom', the 3U / 4U viewers' own word for a board pick)
//                                     shows the board under the row; a click commits the pixel under the pointer, held
//                                     like an RGB pick ('#rrggbb')
//   rgb: false                        no RGB... choice (a game whose rows pick from the board only)
//   default: true                     Default is the GAME's colour for the row, from the app (ctx.defaultColour(part)
//                                     -> '#rrggbb' or null), not the untinted map; the state is 'default'
//   untinted: 'label'                 untinted (the map as drawn) as its own choice, under the game's own label, where
//                                     the game has one
//   strip: 'file.json'                the game's own colour strip for the row (GU's Skin Tone, 2026-10-19), an APP file
//                                     ({ first, default, colours: [[r, g, b] ...] }, one per position, as the game reads
//                                     them): a range in the row over its positions, and the same strip first in the
//                                     selector (openCharacter's opts.strip / onIndex). A position's colour is held like a
//                                     pick ('#rrggbb'); the range shows the position whose colour EQUALS the row's (the
//                                     way the game finds it back) and no position otherwise (an RGB colour, Default)
// paintRow(part) puts the row's state back into its controls (after a restore).
//
// A ROW'S OWN LIST (a colourParts entry's third element, { names?, off? }; none in GU): names [[name, '#rrggbb'] ...]
// replaces game.colourNames for that row (MH3U: the 12 hair presets on Hair Color, the 12 others on Clothing Color and
// the features, labelled "1".."12" as the game prints them); a named choice is held as its INDEX in the row's list.
// off: 'label' adds an Off choice (state 'off'; MH3U's features: a colour with R = 0 turns the feature off, 0x23f83c).
// ctx.applyColours(charColor, t), when the app gives one, applies every row's state in place of the built-in tint (the
// game's own colour channel and per-unit rules, MH3U).
import * as THREE from 'three';
import { setCharColor, setChannelColor } from '../render/material.js';

import { paintField, wireField } from './colour-field.js';
export function createColourRows(game, ctx){
  // The game's own color names, read from nativeNX/eng/table/CharMakeMsg_eng.gmd
  // (89 labels / 89 strings, an exact fit to EOF -- an earlier pass called this file
  // encrypted only because it missed the 1024-byte bucket table between the info table
  // and the labels). The NAMES are the game's; the hex values are ours, because the
  // palette RGB lives in the executable, not in romfs.
  // the game's named colours, [name, '#rrggbb' or null for a cycling one] (game.colourNames)
  const CHAR_COLORS = game.colourNames || [];
  // [select id, colour part] per row (game.colourParts), and the second figure's (game.colourPartsPalico)
  const CHAR_PARTS = game.colourParts || [];
  // The Palico's two are the same kind of control -- one texture per gender, recoloured at
  // runtime -- so they run through the same palette, the same shader path and the same
  // "Default / 24 names / RGB..." list rather than a parallel implementation.
  const OT_CHAR_PARTS = game.colourPartsPalico || [];
  const ALL_CHAR_PARTS = CHAR_PARTS.concat(OT_CHAR_PARTS);
  // null = the authored color; a NUMBER indexes CHAR_COLORS; a '#rrggbb' STRING is a
  // custom RGB pick. Keeping the game's palette and a free colour in one field means every
  // path -- render, save, export -- handles both without a second flag.
  const charColor = {};
  for (const [, part] of CHAR_PARTS.concat(OT_CHAR_PARTS)) charColor[part] = null;

  let rainbowOn = false;
  const CHAR_SYNC = [];
  const ROWOPT = game.colourRows || {};
  const opt = part => ROWOPT[part] || {};
  // a row's own list and Off (the colourParts entry's third element), else the game's names
  const rowCfg = part => { const r = ALL_CHAR_PARTS.find(x => x[1] === part); return (r && r[2]) || {}; };
  const names = part => rowCfg(part).names || CHAR_COLORS;
  const boardMode = {};                     // a row whose string colour came from its board (vs RGB...)
  function buildColorLists(){
    for (const [id, part] of ALL_CHAR_PARTS){
      const o = opt(part);
      document.getElementById(id).innerHTML =
        (o.untinted ? '<option value="none">' + o.untinted + '</option>' : '') +
        '<option value="">Default</option>' +
        (rowCfg(part).off ? '<option value="off">' + rowCfg(part).off + '</option>' : '') +
        names(part).map((c,i) => '<option value="'+i+'">'+c[0]+'</option>').join('') +
        (o.rgb === false ? '' : '<option value="rgb">RGB…</option>') +
        (o.board ? '<option value="board">' + (o.board.label || 'Custom') + '</option>' : '');
    }
  }
  // One tint path for the face, the hair AND the body skin the armor exposes -- they
  // share the shader, so a skin tone cannot come out different on the face than on the
  // hands. Rainbow is a real in-game option, so it cycles rather than being dropped.
  function applyCharColors(t){
    rainbowOn = false;
    if (ctx.applyColours){ ctx.applyColours(charColor, t); return; }   // the app's own tint (MH3U)
    const cols = {};
    for (const [, part] of ALL_CHAR_PARTS){
      // a named choice the row no longer lists (an older save, a list the game.js emptied) is the row's Default
      if (typeof charColor[part] === 'number' && !names(part)[charColor[part]]){
        charColor[part] = opt(part).default ? 'default' : null;
        if (ROW_PAINT[part]) ROW_PAINT[part]();
      }
      const v = charColor[part];
      if (v === null || v === undefined) { cols[part] = null; continue; }
      if (v === 'default') { cols[part] = ctx.defaultColour ? ctx.defaultColour(part) : null; continue; }   // the game's
      if (v === 'off') { cols[part] = null; continue; }
      if (typeof v === 'string') { cols[part] = v; continue; }   // custom RGB
      const hex = (names(part)[v] || [])[1];
      if (hex) cols[part] = hex;
      else { rainbowOn = true; cols[part] = new THREE.Color().setHSL(((t||0)*0.12)%1, .8, .55); }
    }
    // A part the game hands to a material colour CHANNEL (game.colourChannel: one { channel, part, exceptSlot? } or a
    // list) takes it as the game does -- over fAlbedoColor, a plain multiply (setChannelColor), the Kinsect's and the
    // pigment's path -- on every material of that channel, not the luminance tint below; exceptSlot (a regex on the
    // material's slot) leaves out another figure's materials on the same channel (GU: the Palico's fur is channel 2 too).
    // A material of such a part's tint class on another channel takes no colour (the game gives it none).
    const CH = [].concat(game.colourChannel || []).map(e => ({ ...e, rgb: rgb255(cols[e.part]),
      skip: e.exceptSlot ? new RegExp(e.exceptSlot) : null }));
    const chParts = new Set(CH.map(e => e.part));
    ctx.scene.traverse(o => {
      const m = o.material, ud = m && m.userData;
      if (!ud || !ud.u) return;
      const e = ud.rom && CH.find(c => ud.rom.ch === c.channel && !(c.skip && c.skip.test(ud.slot || '')));
      if (e){ setChannelColor(m, e.rgb); if (ud.tintClass) setCharColor(m, null); return; }
      if (!ud.tintClass) return;
      setCharColor(m, chParts.has(ud.tintClass) ? null : cols[ud.tintClass]);
    });
  }
  // a colour as applyCharColors holds it ('#rrggbb', or a THREE.Color for Rainbow) as the
  // [r, g, b] bytes setChannelColor takes -- through the hex, so a picked colour reaches the
  // channel exactly as the ROM's own channel colours do (render/kinsect.js), digit for digit
  function rgb255(c){
    if (!c) return null;
    const m = /^#?([0-9a-f]{6})$/i.exec(typeof c === 'string' ? c : '#' + c.getHexString());
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  // a board image: 'boards/...' is the shared base's copy (docs/base/boards); any other path is the APP's own file under
  // its docs/ (each app shows only its own game, so a board may be the app's data; a leading '../' is taken the same way)
  const boardSrc = img => /^boards\//.test(img) ? 'base/' + img : img.replace(/^(\.\.\/)+/, '');
  // a row's board: drawn once, under the row, shown while its board choice is picked
  function makeBoard(id, part, b){
    const field = document.getElementById(id).closest('.field');
    const wrap = document.createElement('div'); wrap.className = 'field pig-board'; wrap.hidden = true;
    const [x0, y0, x1, y1] = b.region;
    const cv = document.createElement('canvas'); cv.width = x1 - x0 + 1; cv.height = y1 - y0 + 1;
    cv.title = "Click to pick a color from the game's own color board";
    wrap.appendChild(cv);
    field.parentElement.insertBefore(wrap, field.nextSibling);
    const img = new Image();
    img.onload = () => cv.getContext('2d').drawImage(img, x0, y0, cv.width, cv.height, 0, 0, cv.width, cv.height);
    img.src = boardSrc(b.image);
    cv.onclick = e => {
      const r = cv.getBoundingClientRect();
      const x = Math.min(cv.width - 1, Math.floor((e.clientX - r.left) / r.width * cv.width));
      const y = Math.min(cv.height - 1, Math.floor((e.clientY - r.top) / r.height * cv.height));
      const d = cv.getContext('2d').getImageData(x, y, 1, 1).data;
      charColor[part] = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
      boardMode[part] = true;
      applyCharColors(performance.now()/1000);
      ctx.saveState();
    };
    return wrap;
  }
  const ROW_PAINT = {};
  for (const [id, part] of ALL_CHAR_PARTS){
    const sel = document.getElementById(id), rgb = document.getElementById(id + 'RGB');
    const o = opt(part);
    const pal = document.getElementById(id + 'Pal');
    // THE SWATCH ROW (Raven, 2026-10-18: "There is no need for a drop down to select Default or RGB"): a row with a
    // palette button shows a swatch of its colour and chooses everything -- Default, a pigment, the board, RGB -- in the
    // selector; its select stays in the page, hidden, as the place the app reads and restores the row's state. A row
    // without one (the Palico's, in its own pane) keeps its select.
    const swatchRow = !!(pal && ctx.openPalette);
    const board = (!swatchRow && o.board) ? makeBoard(id, part, o.board) : null;
    // the row's colour field (base/ui/colour-field.js): the current colour, its hex on it -- typed or pasted, it sets the
    // row (RGB with that hex) through the row's own path
    let chip = null;
    // the row's game strip (o.strip): its colours once loaded, and its range in the row
    let strip = null, stripEl = null;
    if (swatchRow){
      sel.hidden = true;
      chip = document.getElementById(id + 'Hex');
      if (!chip){
        chip = document.createElement('input'); chip.type = 'text'; chip.className = 'hexbtn colourfield'; chip.id = id + 'Hex';
        chip.maxLength = 7; pal.parentElement.insertBefore(chip, pal);
      }
      wireField(chip, hex => {
        if (rgb){ sel.value = 'rgb'; rgb.value = hex; boardMode[part] = false; }
        charColor[part] = hex;
        syncRgbVisibility(); applyCharColors(performance.now()/1000); ctx.saveState();
      }, () => paintChip());
    }
    // a strip position as the row's colour: held like a pick, so every save and restore path carries it unchanged
    const hexOf = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
    function pickStrip(i, save){
      const hex = hexOf(strip[i]);
      if (rgb){ sel.value = 'rgb'; rgb.value = hex; boardMode[part] = false; }
      charColor[part] = hex;
      syncRgbVisibility(); applyCharColors(performance.now()/1000);
      if (save) ctx.saveState();
    }
    if (o.strip && chip){
      stripEl = document.createElement('input'); stripEl.type = 'range'; stripEl.className = 'strip free';
      stripEl.min = '0'; stripEl.step = '1';
      chip.parentElement.insertBefore(stripEl, chip);
      fetch(boardSrc(o.strip)).then(r => r.json()).then(j => {
        strip = j.colours; stripEl.max = String(strip.length - 1);
        const first = j.first || 0;
        stripEl.style.background = 'linear-gradient(to right,' + strip.map(c => 'rgb(' + c.join(',') + ')').join(',') + ')';
        stripEl.title = "The game's own strip: position " + first + '..' + (first + strip.length - 1) +
          (j['default'] != null ? ' (a new character starts at ' + j['default'] + ')' : '');
        paintChip();
      }).catch(e => console.warn('colour strip', o.strip, e));
      stripEl.oninput = () => { if (strip) pickStrip(+stripEl.value, false); };
      stripEl.onchange = () => { if (strip) ctx.saveState(); };
    }
    // the range on the position whose colour equals the row's, else no position (its thumb hidden). The range keeps its
    // own position while that colour is still the row's (neighbouring positions can share a colour: the game's search
    // finds the first, a step from it must not fall back)
    function paintStripPos(hex){
      if (!stripEl || !strip) return;
      const want = hex ? String(hex).toLowerCase() : null, here = strip[+stripEl.value];
      if (want && here && !stripEl.classList.contains('free') && hexOf(here) === want) return;
      const i = want ? strip.findIndex(c => hexOf(c) === want) : -1;
      stripEl.classList.toggle('free', i < 0);
      if (i >= 0) stripEl.value = String(i);
    }
    // the row's colour as its swatch shows it, and its tooltip: "Default" on the row's default (the game's colour, or the
    // map as drawn), the preset's name, else the hex
    function paintChip(){
      if (!chip) return;
      const v = charColor[part];
      let hex = null, tip = null;
      if (v === null || v === undefined || v === 'default'){
        hex = (v === 'default' && ctx.defaultColour) ? ctx.defaultColour(part) : null; tip = 'Default';
      }
      else if (v === 'off') tip = rowCfg(part).off || 'Off';
      else if (typeof v === 'number'){ const n = names(part)[v]; hex = n && n[1]; tip = n ? n[0] : null; }
      else { hex = v; tip = String(v).toUpperCase(); }
      // the current colour on the field (Raven, 2026-10-18: "Instead we would want to display the current color"): the
      // hex, "Default", or the preset's name
      paintField(chip, hex, tip && tip[0] !== '#' ? tip : null);
      paintStripPos(typeof v === 'string' && v[0] === '#' ? v : null);
      chip.title = 'Type or paste a hex value; click to select and copy' + (rowCfg(part).tip ? ' \u2014 ' + rowCfg(part).tip : '');
    }
    // the picker only exists while RGB is the choice, so the row stays quiet otherwise (and the board while it is)
    // An RGB colour shows as the row's swatch (its own <input type=color>, shown while RGB... is the choice); the RGB
    // selection itself is the pigment selector's (Raven, 2026-10-18: "the RGB sliders are handled in the modal, so no
    // need for them to be in panel"), so a click on the swatch opens the selector for this row
    function syncRgbVisibility(){
      if (rgb) rgb.hidden = swatchRow || sel.value !== 'rgb';
      if (board) board.hidden = sel.value !== 'board';
      paintChip();
    }
    // the state back into the controls (a restore): untinted / the game's default / a name / a hex from RGB or the board
    ROW_PAINT[part] = () => {
      const v = charColor[part];
      if (v === null || v === undefined) sel.value = o.untinted ? 'none' : '';
      else if (v === 'default') sel.value = '';
      else if (v === 'off') sel.value = 'off';
      else if (typeof v === 'number') sel.value = String(v);
      else if (o.board && (o.rgb === false || boardMode[part])) sel.value = 'board';
      else { sel.value = 'rgb'; if (rgb) rgb.value = v; }
      syncRgbVisibility();
    };
    // a row's game rule, in its tooltip (the colourParts entry's tip; MH3U: a colour with R = 0 switches a feature off)
    if (rowCfg(part).tip) sel.title = rowCfg(part).tip;
    // THE PALETTE BUTTON (Raven, 2026-10-18): the shared pigment selector for this row (ctx.openPalette -> base/ui/
    // pigment.js openCharacter); a pick sets the row to RGB with the hex, through the row's own path, the game's rules
    // as the game applies them (the app's tint)
    if (rgb && swatchRow) rgb.addEventListener('click', e => { e.preventDefault(); pal.click(); });
    if (swatchRow){
      pal.onclick = () => {
        const v = charColor[part];
        const now = typeof v === 'string' && v[0] === '#' ? v : typeof v === 'number' ? (names(part)[v] || [])[1] : null;
        const label = (sel.closest('.field').querySelector('label') || {}).textContent || part;
        ctx.openPalette(label, now, hex => {
          if (rgb){ sel.value = 'rgb'; rgb.value = hex; boardMode[part] = false; }
          charColor[part] = hex;
          syncRgbVisibility();
          applyCharColors(performance.now()/1000);
          ctx.saveState();
        }, () => {
          // the selector's Default: the game's colour for the row (ctx.defaultColour), or the map as drawn
          charColor[part] = o.default ? 'default' : null;
          sel.value = '';
          syncRgbVisibility();
          applyCharColors(performance.now()/1000);
          ctx.saveState();
        }, strip ? { strip, onIndex: i => pickStrip(i, true) } : undefined);   // the row's game strip, first
      };
    }
    sel.onchange = () => {
      // RGB...: the row takes its swatch's colour, and the selector opens on it (the RGB selection is there)
      if (sel.value === 'rgb') { charColor[part] = rgb.value; boardMode[part] = false; if (pal && ctx.openPalette) setTimeout(() => pal.click()); }
      else if (sel.value === 'board') {
        // the board's colour shows once a pixel is picked; until then the row keeps the colour it had
        if (!boardMode[part]) { boardMode[part] = true; }
      }
      else if (sel.value === 'none') charColor[part] = null;
      else if (sel.value === 'off') charColor[part] = 'off';
      else if (sel.value === '') charColor[part] = o.default ? 'default' : null;
      else charColor[part] = +sel.value;
      syncRgbVisibility();
      applyCharColors(performance.now()/1000);
      ctx.saveState();
    };
    // (an RGB colour is set through the selector: its pick handler above applies and saves)
    sel.dataset.syncRgb = '1';
    CHAR_SYNC.push(syncRgbVisibility);
  }

  return {
    ALL_CHAR_PARTS, CHAR_COLORS, CHAR_PARTS, CHAR_SYNC, applyCharColors, buildColorLists, charColor, rgb255,
    paintRow: part => { if (ROW_PAINT[part]) ROW_PAINT[part](); },
    get rainbowOn(){ return rainbowOn; }
  };
}
