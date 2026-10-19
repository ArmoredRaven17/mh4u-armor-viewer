// THIS VIEWER'S DATA, MAPPED FOR THE SHARED BASE (docs/base; the plan: C:\\Coding Repos\\VIEWER-BASE-PLAN.md). The base's
// modules never read armor.json or weapons.json themselves: what they need comes through here. Each function reads the
// app's live objects through `app`, set once at the top of the page (setApp): DATA (armor.json), state (the hunter on
// screen), worn(slot) (the armour record worn there, or null). The MH3U Armor Viewer's adapter, on MH4U's rules.
let app = null;
export function setApp(a){ app = a; }

const rgbHex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

// THE PIECE'S OWN PIGMENT (Default, base/ui/pigment.js): armour record +0x13 into the game's 70-colour table (READ
// 0x2f854c: its armour branch takes the table at [0x2f8674] = 0xf57750, record + 0x13, bytes R, G, B -- checked
// 2026-10-18; equipment kinds 0 and 6 read black). Null when nothing is worn: the slot then shows the inner wear, whose colour is the Clothing Color.
export function defaultPigHex(slot){
  const r = app.worn(slot);
  if (!r) return null;
  const c = app.DATA.colors.pigments[r.pig];
  return c ? rgbHex(c) : null;
}

// WHETHER THE PIECE WORN IN A SLOT TAKES A PIGMENT (the rows' disabled state): every worn piece does (the item box's
// "Change your armor color"; MH4U marks none undyeable). An empty Chest, Arms or Legs draws the inner wear (0x2f4108),
// whose dye region takes the Clothing Color (the Hunter panel); an empty Head or Waist draws nothing.
export function dyeable(slot){
  if (app.worn(slot)) return { can: true };
  return { can: false, reason: app.DATA.inner[slot]
    ? 'Nothing is worn: the clothing shows, in the Clothing Color (Hunter panel)' : 'Nothing is worn in this slot' };
}

// ---- THE ARMOR LISTS (base/ui/armor-panel.js): the game's own table order, grouped by rarity ----
// One item per (model, default pigment) this gender can wear, named by every piece in it -- a Blademaster and a Gunner
// piece usually share one -- valued by the first record's id (a record id is what a slot holds: pieces sharing a model
// can carry different default pigments, and the record is what the game colours by). Grouped by the rarity of the item's
// first record (armor.json `rar`), as the GU and 3U lists are. `type` is the Type filter: 'all', 'b' or 'g'.
const pad3 = n => String(n).padStart(3, '0');
// The item's value comes from the whole list (Both), so one item keeps one value under every Type filter: the panel
// re-inserts the worn item by value when the filter would hide it.
export function armorOptions(slot, type){
  const g = app.state.g;
  const groups = new Map();
  for (const r of app.DATA.armor[slot]){
    if (r.wear.indexOf(g) < 0) continue;
    const k = r[g] + ':' + r.pig;
    if (!groups.has(k)) groups.set(k, { id: r.id, model: r[g], rare: r.rar, ids: [], names: [] });
    const e = groups.get(k);
    e.ids.push(r.id);
    // the name and the Type filter count the pieces of that type only. A helm's type is its SET's (armor.json `ht`,
    // build_armor.py helm_types): the game lets nearly every helm be worn by both, so its wear bits say 'bg'; with
    // Settings -> Equipment's "Treat Head Armors as Blademaster/Gunner" the panel asks for 'all' and the game's rule stands
    const kind = (slot === 'helm' && r.ht) ? r.ht : r.wear;
    if (type !== 'all' && kind.indexOf(type) < 0) continue;
    if (e.names.indexOf(r.name) < 0) e.names.push(r.name);
  }
  const out = [];
  for (const e of groups.values()){
    if (!e.names.length) continue;                 // no piece of this type in it
    if (!app.DATA.pieces[g + '/' + g + '_' + slot + pad3(e.model)]) continue;
    out.push({ value: String(e.id), label: e.names.join(' / '), model: e.model, ids: e.ids, rare: e.rare,
               group: 'Rarity ' + e.rare });
  }
  // One group per rarity, ascending, the game's table order kept inside each (a stable sort): 4U's armour table runs
  // set by set (178 rarity changes in the Head list), so breaking on every change would head every few rows.
  return out.sort((a, b) => a.rare - b.rare);
}
export function armorSpecials(){ return []; }
// the item a record id belongs to, for a slot holding a record that is not an item's first (an older save, or a record
// another gender's list grouped differently)
export function legacyModel(slot, v){
  const id = +v;
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = app.DATA.armor[slot].find(x => x.id === id);
  return r ? r[app.state.g] : null;
}
// the token the select holds for a record id: the value of the item that lists it ('none' for nothing)
export function tokenOfRecord(slot, id, type){
  if (!id) return 'none';
  const o = armorOptions(slot, type || 'all').find(x => x.ids.indexOf(id) >= 0);
  return o ? o.value : 'none';
}

// ---- THE HUNTER PANEL'S LISTS (base/ui/hunter-panel.js) ----
// the face and hair styles of the gender shown, in the game's order; they have no names in game, so Type 1..N
export function charStyles(part){
  return (app.DATA.chars[app.state.g][part] || []).map((e, i) => ({ label: 'Type ' + (i + 1), rec: e }));
}
// MH4U has no face paint
export function paintCount(){ return 0; }
// the inner wear an empty Chest, Arms or Legs draws by the Clothing choice: six each (u16 tables 0xf3fc8c / 0xf3fc98 /
// 0xf3fca4, models 60-63, 70, 71), the game's `Type %d`
export function clothingOptions(){
  const n = Math.max(...Object.values(app.DATA.inner).map(a => a.length));
  return Array.from({ length: n }, (_, i) => ({ value: String(i), label: 'Type ' + (i + 1) }));
}
// the Features (CharMake: Features): (None), then Type 1-12 = face parts 200-211 (0xb08778)
export function featureOptions(){
  return [{ value: '0', label: '(None)' }].concat(app.DATA.features.map((p, i) => ({ value: String(i + 1), label: 'Type ' + (i + 1) })));
}
// the Eye Color cells: player data +0x39 moves the face's colour-type-0 (`_eye_`) material's UVs to cell v of a 4 x 4
// atlas, (0.25 x (v & 3), -0.25 x (v >> 2)) (0xb08420 -> 0xb05ecc). Cells 0-9 are drawn on both genders' eye maps, 10-15
// are blank; the menu's own count and labels are not read, so they are Type 1-10. `cell` is [column, row].
export function eyeOptions(){
  return Array.from({ length: 10 }, (_, v) => ({ value: String(v), label: 'Type ' + (v + 1), cell: [v & 3, v >> 2] }));
}
// the hunter's own motion lists (player\mot\co\co_*, lco_*, pl_make, pl_gc, pl_arena), a group per list, its clips the
// entries (the clips carry no names in the game data); the weapon classes' lists (wNN) are the Weapon panel's Stance.
// The option value is 'g:<index>' into this flat list.
export const LIST_NAMES = { co_0: 'Common 0', co_1: 'Common 1', co_2: 'Common 2', co_4: 'Common 4',
  lco_0: 'Lobby 0', lco_1: 'Lobby 1', lco_2: 'Lobby 2', lco_3: 'Lobby 3', lco_0p: 'Lobby 0p', lco_2p: 'Lobby 2p', lco_3p: 'Lobby 3p',
  pl_make: 'Character Creation', pl_gc: 'Guild Card', pl_arena: 'Arena' };
export const listName = id => LIST_NAMES[id] || id;
export const isWeaponList = id => /^w\d\d$/.test(id || '');
export function poseOptions(){
  const P = app.DATA.poses && app.DATA.poses[app.state.g];
  const out = [];
  for (const l of (P && P.lists) || []){
    if (isWeaponList(l.id)) continue;
    for (const c of l.clips)
      out.push({ label: c.clip, group: listName(l.id), src: listName(l.id), clip: c.clip, dur: c.dur, list: l.id });
  }
  return out;
}
// the game's 70 armour pigments (0xf57750, READ 0x2f854c), in the game's order; no names (none found on the cart)
export function pigmentColours(){ return app.DATA.colors.pigments.map(c => ({ hex: rgbHex(c), name: null })); }

// EVERY COLOUR LIST THE GAME HAS (base/ui/pigment.js pigmentSections; Raven, 2026-10-18: "Any in game pigment should be
// listed"), in this order: the 70 armour pigments, then the weapons' own two tables, which the same read (0x2f854c)
// takes for a weapon -- the melee classes' 15 (0xf57822, record +0x12) and the gunners' 4 (0xf5784f, record +0x1b;
// weapons.json pigments). The game names none of them: each swatch's name is its list and place, so the merged
// collection says where a colour comes from. No hunter colour list exists to add: CharMake's Skin Tone, Hair, Clothing
// and Feature Color pages offer the colour board alone (game.js colourNames), Eye Color is ten texture cells, not
// colours, and CharMake 172-177 (White, Black, Red, Indigo, Yellow, Green) are not placed on any page.
export function pigmentSections(){
  const list = (rows, label) => rows.map((c, i) => ({ hex: rgbHex(c), name: label + ' ' + (i + 1) }));
  const W = app.WEAPONS && app.WEAPONS.pigments;
  return [{ label: 'Armor pigments', colours: list(app.DATA.colors.pigments, 'Armor pigment') }]
    .concat(W ? [{ label: 'Blademaster weapon colors', colours: list(W.melee, 'Blademaster weapon color') },
                 { label: 'Gunner weapon colors', colours: list(W.gunner, 'Gunner weapon color') }] : []);
}

// THE WEAPON CLASSES BY IDENTITY (base/ui/weapon-panel.js orderClasses: GU's Guild Card order): MH4U's class id (the
// weapon type, weapons.json classes[].cls) -> the family's canonical name
export const CLASS_NAME = { 0: 'Great Sword', 7: 'Long Sword', 1: 'Sword & Shield', 11: 'Dual Blades', 2: 'Hammer',
  12: 'Hunting Horn', 3: 'Lance', 9: 'Gunlance', 8: 'Switch Axe', 14: 'Charge Blade', 13: 'Insect Glaive',
  6: 'Light Bowgun', 4: 'Heavy Bowgun', 10: 'Bow' };
export const classNameOf = c => CLASS_NAME[c.cls] || c.name;

// THE GAME'S DEFAULT COLOURS OF THE HUNTER COLOUR ROWS (base/ui/colour-rows.js `default: true`; Raven's rule: Default
// gives the game's true default): CharMake's Reset colours, as the game computes them (scripts/char_defaults.py, which
// runs the boot initialiser 0xd33004 for the colour table and reads the index tables):
//   skin      the constant 0xc0eec0 writes, (233, 214, 204) -- also a new character's (0xb7ab14); off the skin strip
//   hair      0xc0eea0: table entry 12                                        (Reset 0x22c958 -> player data +0x3c)
//   cloth     0xc0f258 by the clothing type (+0x35): entry 17 + byte[0xe063f0 + type]   (Reset 0x22ca10 -> +0x40)
//   feat      0xc10a78 by gender (+0x34) and Features (+0x3a): entry byte[0xe063e6 + byte[0xe064f8 + 13 g + f]]
//                                                                              (Reset 0x22ca8c -> +0x48)
export const CHAR_DEFAULTS = {"skin": [233, 214, 204], "hair": [57, 30, 14], "cloth": [[139, 161, 80], [250, 245, 230], [139, 161, 80], [250, 245, 230], [139, 161, 80], [250, 245, 230]], "feat": {"m": [[100, 69, 11], [100, 69, 11], [100, 69, 11], [100, 69, 11], [70, 62, 45], [250, 245, 230], [70, 62, 45], [237, 53, 60], [237, 53, 60], [237, 53, 60], [70, 62, 45], [250, 245, 230], [250, 245, 230]], "f": [[100, 69, 11], [70, 62, 45], [237, 53, 60], [70, 62, 45], [70, 62, 45], [70, 62, 45], [237, 53, 60], [250, 245, 230], [250, 245, 230], [250, 245, 230], [70, 62, 45], [70, 62, 45], [237, 53, 60]]}};
export const SKIN_DEFAULT = CHAR_DEFAULTS.skin;
// the row's default as [r, g, b] for the hunter as it stands (the clothing's follows its type, the Features' the gender
// and the Features chosen), or null
export function defaultRgb(part){
  const st = app.state, D = CHAR_DEFAULTS;
  if (part === 'skin') return D.skin;
  if (part === 'hair') return D.hair;
  if (part === 'cloth') return D.cloth[Math.min(Math.max(st.cloth | 0, 0), D.cloth.length - 1)];
  if (part === 'feat'){ const row = D.feat[st.g] || D.feat.f; return row[Math.min(Math.max(st.feat | 0, 0), row.length - 1)]; }
  return null;
}
export function defaultColour(part){ const c = defaultRgb(part); return c ? rgbHex(c) : null; }

// THE CLIP'S LOOP FLAG (base/ui/animation-panel.js clipLoops, when it lands; Raven, 2026-10-19: "play animations based on
// this flag"): true / false / null. MH4U's LMT v67 motion entry holds a signed loop frame at +0xc (read from the files;
// the game's own accessor rMotion::getLoopFrame, 0xd036e4, returns it): -1 = played once, 0 = the whole motion loops,
// k > 0 = played from 0, then looped from frame k. The converter names the clips by it, so the name carries the flag:
// Motion[N] (-1) plays once, Motion[N]_loop (0, or the looping part of a split motion) loops, Motion[N]_start (the lead-in
// of a split motion) plays once and hands over to its _loop. Anything else: null (the panel's own rule).
export function clipLoops(clip){
  const name = String((clip && (clip.clip || clip.name)) || clip || '');
  if (/^Motion\[\d+\]_loop$/.test(name)) return true;
  if (/^Motion\[\d+\](?:_start)?$/.test(name)) return false;
  return null;
}
