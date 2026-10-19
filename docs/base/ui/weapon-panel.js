// THE WEAPON PANEL'S ROWS of the shared viewer base (docs/base/ui; the plan: C:\Coding Repos\VIEWER-BASE-PLAN.md; Raven,
// 2026-10-18: "each app has the same UI" -- and on the Weapon panel: "We have things like stances, but we also need
// things like the Bowgun attachment options. Then we have things like Charge Blade charge levels, which only apply to
// 4U and GU"). Class, Weapon, Carry, Stance and the Attachment / Form row are the panel's own markup in every app; the
// rows a class adds (a gauge, an oil, a mode, the Charge Blade's charge levels ...) are the GAME's: game.weaponRows
// lists them in panel order, each
//   { field, kind: 'check' | 'select' | 'box', input, label, title?, options?: [[value, label] ...], after?,
//     classes: ['wNN' ...] }
// field / input are the row's and its control's element ids (GU's ids), kind 'box' an empty container the app fills
// (GU: the Hunter Art levels), options a select's fixed list (a select without them is filled by the app), after any
// markup that follows the select, classes the weapon classes that show the row (none: hidden for every class).
// base/ui/hunter-tab.js builds the rows (it runs before any script looks them up); this module shows each one for its
// classes (paintRows). What a row DOES is the app's, wired by its ids. A game lists only the rows it has, so 3U lists no
// Charge Blade row: 3U has no Charge Blade.
// THE CLASS ORDER, every app's (Raven, 2026-10-18: "I want weapons to be in GU's Guild Card order, if you are unsure
// what this means check the Save Editor"): the Guild Card's weapon-use list (the GU Save Editor's WEAPON_DISPLAY,
// src/components/PlayerTab.tsx), hunter classes only -- its Prowler entry is the Palico's. By class IDENTITY: each app's
// adapter gives its own classes' canonical names; a game shows only the classes it has, in this order, and a class's
// weapons keep the game's own order inside it.
export const CLASS_ORDER = ['Great Sword', 'Long Sword', 'Sword & Shield', 'Dual Blades', 'Hammer', 'Hunting Horn', 'Lance',
  'Gunlance', 'Switch Axe', 'Charge Blade', 'Insect Glaive', 'Light Bowgun', 'Heavy Bowgun', 'Bow'];
// a game's classes in that order: nameOf(c) is the class's canonical name (the adapter's); a name not in the list keeps
// its own place after the known ones (never dropped)
export function orderClasses(list, nameOf){
  const rank = c => { const i = CLASS_ORDER.indexOf(nameOf(c)); return i < 0 ? CLASS_ORDER.length : i; };
  return list.map((c, i) => [c, rank(c), i]).sort((a, b) => (a[1] - b[1]) || (a[2] - b[2])).map(x => x[0]);
}
export function createWeaponPanel(game, ctx){
  const ROWS = game.weaponRows || [];
  // show the rows of a weapon class, hide the rest (a 'box' row is the app's to show)
  function paintRows(cls){
    for (const r of ROWS){
      if (r.kind === 'box') continue;
      const e = document.getElementById(r.field);
      if (e) e.style.display = (r.classes || []).indexOf(cls) >= 0 ? '' : 'none';
    }
  }
  return { paintRows };
}
